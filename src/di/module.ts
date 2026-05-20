import type { $CompileProvider } from '@compiler/compile-provider';
import type { Directive, DirectiveFactory } from '@compiler/directive-types';
import type { ControllerInvokable, IControllerProvider } from '@controller/controller-types';
import type { FilterFn, IFilterProvider } from '@filter/filter-types';

import type { Invokable, InvokableReturn, RequiredConfigRegistry, RequiredRunRegistry, ResolveDeps } from './di-types';

/**
 * Recipe types supported by the module system. At Slice 1 only the identifier
 * strings are needed -- the actual `value`, `constant`, and `factory` methods
 * will be added to the `Module` class in later slices.
 */
export type RecipeType = 'value' | 'constant' | 'factory' | 'service' | 'provider' | 'decorator';

/**
 * @internal
 * A single pending registration in a module's invoke queue. The tuple is
 * `[recipeType, name, value]` where `value` is the raw argument passed to the
 * registration method (a plain value for `value`/`constant`, or an
 * {@link Invokable} for `factory`). The queue is drained by the injector when
 * it is created from the module graph.
 *
 * Not part of the public API: used internally by the `di` module (the
 * {@link Module} class stores it on `$$invokeQueue`, and {@link createInjector}
 * drains it at load time). Subject to change without notice.
 */
export type InvokeQueueEntry = readonly [RecipeType, string, unknown];

/**
 * The most-general `Module` type, used by the internal registry which must
 * hold modules of any concrete `Registry` / `ConfigRegistry` / `Name` /
 * `Requires` shape.
 */
export type AnyModule = Module<Record<string, unknown>, Record<string, unknown>>;

/**
 * Module-scoped registry of all modules created via {@link createModule}.
 * Keyed by module name. Kept private to this file -- both `createModule` and
 * `getModule` go through this registry so there is a single source of truth.
 */
const registry = new Map<string, AnyModule>();

/**
 * A declarative module: a named collection of pending service registrations
 * plus a list of module dependencies.
 *
 * The class is generic over four type parameters:
 *
 * - `Registry` -- a mapped type carrying the accumulated static registry of
 *   registered service names to their types. Each registration method
 *   (`value`, `constant`, `factory`) returns `this` cast to a widened
 *   `Module<Registry & { [K in Name]: T }, ConfigRegistry, Name, Requires>`
 *   so the builder pattern can accumulate precise static types for downstream
 *   injector lookups while keeping a single runtime instance.
 * - `ConfigRegistry` -- a mapped type carrying only the entries that are
 *   resolvable during the module-config phase (currently just `constant`
 *   registrations; spec 008 will add `<name>Provider` entries here). This is
 *   the type-system groundwork for the dual-registry split between the
 *   config-time and run-time injector views.
 * - `Name` -- the string-literal type of this module's own name, preserved
 *   so that callers can statically track identity across the builder chain
 *   and so `createInjector` can reject references to unknown modules at
 *   compile time.
 * - `Requires` -- the readonly-tuple type of this module's declared
 *   dependencies, preserved for the same reason.
 */

export class Module<
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- `{}` (not `Record<string, never>`) is the correct "empty registry" starting type: its `keyof` is `never`, which lets the typed-factory overloads reject dep names against newly-added literal keys. `Record<string, never>` has a wide `string` index signature that swallows literal keys and breaks `Module` subtype variance between the class and `AnyModule`.
  Registry extends Record<string, unknown> = {},
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- same reasoning as `Registry` above.
  ConfigRegistry extends Record<string, unknown> = {},
  Name extends string = string,
  Requires extends readonly string[] = readonly string[],
> {
  /** The unique name of this module within the module registry. */
  readonly name: Name;

  /** Names of other modules this module depends on. */
  readonly requires: Requires;

  /**
   * @internal
   * Queue of pending registrations accumulated by calls to `value`, `constant`,
   * `factory`, `service`, and `provider`. The injector drains this queue once
   * during `createInjector`. Prefixed with `$$` to match the AngularJS internal-
   * state convention used in `Scope` (`$$watchers`, `$$children`, etc.) — not
   * part of the public API and subject to change without notice.
   */
  readonly $$invokeQueue: InvokeQueueEntry[];

  /**
   * @internal
   * Config-phase lifecycle blocks accumulated by calls to `config`. Drained by
   * `createInjector` after the module graph has been loaded but before any
   * service, value, or factory is instantiated — giving config blocks access
   * to providers (via `<name>Provider` names) and constants, but not to
   * run-phase services. Prefixed with `$$` to match the AngularJS internal-
   * state convention used alongside {@link $$invokeQueue} — not part of the
   * public API and subject to change without notice.
   */
  readonly $$configBlocks: Invokable[];

  /**
   * @internal
   * Run-phase lifecycle blocks accumulated by calls to `run`. Drained by
   * `createInjector` after all config blocks have executed and after the
   * run-phase injector has been built — giving run blocks access to any
   * service, value, constant, or factory (the full run-phase registry is
   * available). Prefixed with `$$` to match the AngularJS internal-state
   * convention used alongside {@link $$invokeQueue} and {@link $$configBlocks}
   * — not part of the public API and subject to change without notice.
   */
  readonly $$runBlocks: Invokable[];

  constructor(name: Name, requires: Requires) {
    this.name = name;
    this.requires = requires;
    this.$$invokeQueue = [];
    this.$$configBlocks = [];
    this.$$runBlocks = [];
  }

  /**
   * Register a plain value under `name`. The registration is appended to
   * {@link $$invokeQueue} as `['value', name, value]` and actually materialized
   * when an injector drains the queue. Returns the same module instance with
   * its `Registry` type widened to include the new entry.
   *
   * @param name - The name to register the value under.
   * @param value - The value to associate with `name`.
   */
  value<K extends string, T>(name: K, value: T): Module<Registry & { [P in K]: T }, ConfigRegistry, Name, Requires> {
    this.$$invokeQueue.push(['value', name, value]);
    return this as unknown as Module<Registry & { [P in K]: T }, ConfigRegistry, Name, Requires>;
  }

  /**
   * Register a constant under `name`. Constants are semantically identical to
   * values for the module-loading phase; the injector distinguishes them at
   * drain time. The registration is appended to {@link $$invokeQueue} as
   * `['constant', name, value]`. Returns the same module instance with both
   * its `Registry` and `ConfigRegistry` type parameters widened to include the
   * new entry — constants are the only recipe that is injectable in both the
   * config phase and the run phase, which is why the dual widening is
   * correct here (and incorrect for `value` / `factory`).
   *
   * @param name - The name to register the constant under.
   * @param value - The constant value to associate with `name`.
   */
  constant<K extends string, T>(
    name: K,
    value: T,
  ): Module<Registry & { [P in K]: T }, ConfigRegistry & { [P in K]: T }, Name, Requires> {
    this.$$invokeQueue.push(['constant', name, value]);
    return this as unknown as Module<Registry & { [P in K]: T }, ConfigRegistry & { [P in K]: T }, Name, Requires>;
  }

  /**
   * Register a factory function under `name`. The factory will be called by the
   * injector to produce the service instance, with its declared dependencies
   * resolved and passed in. The factory is a {@link Invokable} — either an
   * array-style annotation `['dep1', 'dep2', fn]` or a function with a
   * `$inject` property. Unlike `value` and `constant`, which store the literal
   * argument, `factory` registrations are lazy: the function runs only when
   * the service is first requested, and the result is cached as a singleton.
   *
   * `Return` is inferred from the trailing function of the supplied invokable
   * so that `injector.get(name)` resolves to the factory's actual return type
   * without any explicit annotation. Callers may still provide `Return`
   * explicitly (e.g. `.factory<'svc', MyShape>(...)`) as an escape hatch.
   *
   * Note: the compile-time typed overloads that validate dep names against
   * this module's `Registry` live on {@link TypedModule}, not on the class.
   * `createModule` returns the same runtime instance cast to `TypedModule`,
   * which is where callers get the typed `.factory(...)` experience. Keeping
   * the class signature wide here preserves the covariance of `Module` in
   * `Registry`, which `AnyModule` and `createInjector` rely on.
   *
   * @param name - The name to register the factory under.
   * @param invokable - The factory, as an array-style annotation or an
   *   `$inject`-annotated function.
   */
  factory<K extends string, Return>(
    name: K,
    invokable: Invokable<Return>,
  ): Module<Registry & { [P in K]: Return }, ConfigRegistry, Name, Requires> {
    this.$$invokeQueue.push(['factory', name, invokable]);
    return this as unknown as Module<Registry & { [P in K]: Return }, ConfigRegistry, Name, Requires>;
  }

  /**
   * Register a service by constructor. The injector calls
   * `new ServiceClass(...deps)` on first `get(name)`, where dependencies come
   * from the service constructor's `$inject` property or from array-style
   * annotation. Unlike `factory`, which uses a plain function to produce the
   * service, `service` uses `new` — making it the natural fit for class-based
   * services.
   *
   * The registration is appended to {@link $$invokeQueue} as
   * `['service', name, invokable]`. Returns the same module instance with its
   * `Registry` type widened to include the new entry. `ConfigRegistry` is
   * unchanged — services are only available in the run phase, not during the
   * module-config phase (unlike `constant`, which widens both registries).
   *
   * Note: the compile-time typed overloads that infer `InstanceType<Ctor>`
   * from a constructor live on {@link TypedModule}, not on the class. Keeping
   * the class signature wide here preserves the covariance of `Module` in
   * `Registry`, which `AnyModule` and `createInjector` rely on — mirroring
   * the rationale documented on {@link factory}.
   *
   * @param name - The name to register the service under.
   * @param invokable - The service constructor, either directly (with
   *   optional `$inject` annotation) or as an array-style invokable
   *   `[...deps, Ctor]`.
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- explicit caller-provided return type for registry inference
  service<K extends string, Return>(
    name: K,
    invokable: Invokable,
  ): Module<Registry & { [P in K]: Return }, ConfigRegistry, Name, Requires> {
    this.$$invokeQueue.push(['service', name, invokable]);
    return this as unknown as Module<Registry & { [P in K]: Return }, ConfigRegistry, Name, Requires>;
  }

  /**
   * Register a provider under `name`. A provider is a configurable service —
   * during the config phase, the provider **instance** is injectable under the
   * name `<name>Provider` so config blocks can mutate it. During the run
   * phase, the provider's `$get` method is invoked to produce the actual
   * service instance, which is then cached as a singleton under `<name>`.
   *
   * Three registration forms are supported; the injector normalizes them
   * all to a provider instance at load time:
   *
   * 1. **Constructor function** — `function LoggerProvider() { this.$get = ... }`
   *    The injector calls `new LoggerProvider()` during config phase.
   * 2. **Object literal** — `{ $get: [...deps, fn] }`
   *    Used directly as the provider instance.
   * 3. **Array-style with constructor** — `['configDep', function(cfg) { this.$get = ... }]`
   *    The injector invokes the constructor via the config-phase injector,
   *    passing in the resolved dependencies.
   *
   * The registration is appended to {@link $$invokeQueue} as
   * `['provider', name, providerSource]`. Returns the same module instance
   * with its `Registry` type widened to include the new service and its
   * `ConfigRegistry` widened with the `<name>Provider` entry.
   *
   * **Wide-signature form** — the typed overloads that infer
   * `InvokableReturn<$get>` and `ProviderInstance<P>` from the provider
   * argument live on `TypedModule.provider`.
   *
   * @param name - The name to register the service under. The provider
   *   instance is registered under `<name>Provider` automatically.
   * @param providerSource - The provider, in one of the three registration
   *   forms described above.
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- explicit caller-provided types for registry/config-registry inference
  provider<K extends string, Service, ProviderShape>(
    name: K,
    providerSource: unknown,
  ): Module<
    Registry & { [P in K]: Service },
    ConfigRegistry & { [P in K as `${P}Provider`]: ProviderShape },
    Name,
    Requires
  > {
    this.$$invokeQueue.push(['provider', name, providerSource]);
    return this as unknown as Module<
      Registry & { [P in K]: Service },
      ConfigRegistry & { [P in K as `${P}Provider`]: ProviderShape },
      Name,
      Requires
    >;
  }

  /**
   * Register a decorator that wraps an existing service by name. The
   * decorator invokable must include `'$delegate'` as a dep — the injector
   * binds `$delegate` to the original (or previously-decorated) service
   * instance via a locals override at invocation time. The decorator can
   * also inject other services from the run-phase registry alongside
   * `$delegate`. The return value replaces the service in the injector's
   * cache.
   *
   * Decorators chain in registration order: each decorator sees the result
   * of the previous one as `$delegate`. Decorating a service name that has
   * no registered producer throws a clear error at injector creation time.
   *
   * The registration is appended to {@link $$invokeQueue} as
   * `['decorator', name, invokable]`. Returns the same module instance
   * with its `Registry` type unchanged — at the wide-signature level,
   * neither the runtime nor the types know what the decorator returns,
   * so we leave `Registry` untouched. The typed overload on
   * `TypedModule.decorator` uses `Omit<Registry, K> & { [P in K]: Return }`
   * to replace the service type with the decorator's return type.
   *
   * @param name - The name of the service to decorate.
   * @param invokable - The decorator function, as an `$inject`-annotated
   *   function or an array-style invokable `['$delegate', ...deps, fn]`.
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- explicit `K` literal type parameter preserved so the typed overload on `TypedModule.decorator` can narrow `Registry` under this exact name.
  decorator<K extends string>(name: K, invokable: Invokable): Module<Registry, ConfigRegistry, Name, Requires> {
    this.$$invokeQueue.push(['decorator', name, invokable]);
    return this as unknown as Module<Registry, ConfigRegistry, Name, Requires>;
  }

  /**
   * Register a config-phase lifecycle block. The invokable runs during
   * `createInjector`, after the module graph has been loaded but before
   * any service, value, or factory is instantiated. Config blocks may
   * inject providers (via `<name>Provider` names) and constants, but not
   * services — attempting to inject a service during the config phase
   * throws at run time. The typed overload on `TypedModule.config` enforces
   * the config-phase constraint at compile time.
   *
   * Unlike the recipe methods, `config` does not widen `Registry` or
   * `ConfigRegistry`: it registers a side-effecting hook, not a service.
   * The block is appended to {@link $$configBlocks} and executed in
   * registration order within the module and dependency order across
   * the module graph.
   *
   * @param invokable - The config block, as an `$inject`-annotated
   *   function or an array-style invokable.
   */
  config(invokable: Invokable): Module<Registry, ConfigRegistry, Name, Requires> {
    this.$$configBlocks.push(invokable);
    return this as unknown as Module<Registry, ConfigRegistry, Name, Requires>;
  }

  /**
   * Register a run-phase lifecycle block. The invokable runs during
   * `createInjector`, after all config blocks have executed and after
   * the run-phase injector has been built. Run blocks may inject any
   * service, value, constant, or factory — the full run-phase registry
   * is available. The typed overload on `TypedModule.run` constrains
   * dep names to `keyof Registry & string` at compile time.
   *
   * Unlike the recipe methods, `run` does not widen `Registry` or
   * `ConfigRegistry`: it registers a side-effecting hook, not a service.
   * The block is appended to {@link $$runBlocks} and executed in
   * registration order within the module and dependency order across
   * the module graph.
   *
   * @param invokable - The run block, as an `$inject`-annotated
   *   function or an array-style invokable.
   */
  run(invokable: Invokable): Module<Registry, ConfigRegistry, Name, Requires> {
    this.$$runBlocks.push(invokable);
    return this as unknown as Module<Registry, ConfigRegistry, Name, Requires>;
  }

  /**
   * Register a filter under `name`. Sugar for the canonical AngularJS pair —
   * a provider under `<name>Filter` whose `$get` proxies through `$filter`,
   * plus a config block that calls `$filterProvider.register(name, factory)`.
   * The dual-write keeps `injector.get('<name>Filter')` and
   * `$filter('<name>')` referencing the same singleton, while the actual
   * registration map remains authoritative inside `$filterProvider`.
   *
   * Mechanically equivalent to writing:
   *
   * ```ts
   * module
   *   .provider(`${name}Filter`, { $get: ['$filter', $f => $f(name)] })
   *   .config(['$filterProvider', $fp => $fp.register(name, factory)]);
   * ```
   *
   * The factory accepts any {@link Invokable} shape — array-style annotation,
   * a `$inject`-tagged function, or a bare function with no deps. The factory
   * is invoked once on first `$filter('<name>')` lookup and the resulting
   * filter function is cached as a singleton (same lifecycle as every other
   * `factory`/`service` registration).
   *
   * Last-wins applies both within a single `.filter` chain and across the
   * boundary with `$filterProvider.register(...)` — both writers share one
   * registration map.
   *
   * @example
   * ```ts
   * createModule('app', ['ng']).filter('shout', [() => (s: unknown) => `${String(s)}!`]);
   * // injector.get('$filter')('shout')('hi') === 'hi!'
   * // injector.get('shoutFilter')           === injector.get('$filter')('shout')
   * ```
   */

  filter<K extends string, F extends FilterFn>(
    name: K,
    factory: Invokable<F>,
  ): Module<Registry & { [P in K as `${P}Filter`]: F }, ConfigRegistry, Name, Requires> {
    // `.filter()` is sugar over `.config(['$filterProvider', $fp =>
    // $fp.register(name, factory)])`. `$filterProvider.register` itself
    // routes through `$provide.factory(name + 'Filter', factory)`, so the
    // filter ends up as a normal injector-resolvable factory under
    // `<name>Filter` — making `module.decorator('<name>Filter', …)` reach
    // it and making last-wins across multiple registrations (`.filter` /
    // `$filterProvider.register` / `$provide.factory`) work uniformly
    // through the shared `applyRegistrationRecord` timeline.
    this.$$configBlocks.push([
      '$filterProvider',
      ($filterProvider: IFilterProvider) => {
        $filterProvider.register(name, factory);
      },
    ]);

    return this as unknown as Module<Registry & { [P in K as `${P}Filter`]: F }, ConfigRegistry, Name, Requires>;
  }

  /**
   * Register a directive under `name`. Sugar for opening a config block
   * by hand and reaching for `$compileProvider`:
   *
   * ```ts
   * module.config(['$compileProvider', ($cp: $CompileProvider) => {
   *   $cp.directive(name, factory);
   * }]);
   * ```
   *
   * The method owns no state and adds no validation — it pushes ONE
   * config block onto {@link $$configBlocks} that forwards verbatim to
   * `$compileProvider.directive(...)`. Accumulation (two registrations of
   * the same name BOTH run on a matched element), priority/terminal
   * sorting, name/factory validation, and registration timing are all
   * inherited unchanged from the provider.
   *
   * Two forms:
   *
   * - **String form** — `directive(name, factory)` registers a single
   *   directive factory.
   * - **Bulk-map form** — `directive({ a: factoryA, b: factoryB })`
   *   registers every entry in the object in a single call (still ONE
   *   config block).
   *
   * Returns the same module instance so the call can be chained with
   * every other module-builder method.
   *
   * @param nameOrMap - The directive name (string form) or a map of
   *   `{ name: factory }` entries (bulk-map form).
   * @param factory - The directive factory, required in the string form
   *   and ignored in the bulk-map form. An {@link Invokable} of any
   *   shape (array-style annotation, `$inject`-tagged function, or a
   *   bare zero-dep function).
   *
   * @example
   * ```ts
   * createModule('app', ['ng']).directive('myWidget', () => ({
   *   restrict: 'E',
   *   link: (_scope, el) => {
   *     el.textContent = 'hello';
   *   },
   * }));
   * // injector.get('$compile')(node)(scope) matches <my-widget> and links it.
   * ```
   */
  directive(
    nameOrMap: string | Record<string, DirectiveFactory>,
    factory?: DirectiveFactory,
  ): Module<Registry, ConfigRegistry, Name, Requires> {
    // `.directive()` is sugar over `.config(['$compileProvider', $cp =>
    // $cp.directive(nameOrMap, factory)])`. Branch on the argument shape
    // so the provider's matching overload is called: the string form
    // forwards `(name, factory)`, the bulk-map form forwards `(map)`.
    // `$cp.directive`'s implementation signature accepts `factory?`, so a
    // missing `factory` in the string branch is the provider's misuse to
    // surface — the DSL adds no validation of its own.
    if (typeof nameOrMap === 'string') {
      const name = nameOrMap;
      this.$$configBlocks.push([
        '$compileProvider',
        ($compileProvider: $CompileProvider) => {
          $compileProvider.directive(name, factory as DirectiveFactory);
        },
      ]);
    } else {
      const map = nameOrMap;
      this.$$configBlocks.push([
        '$compileProvider',
        ($compileProvider: $CompileProvider) => {
          $compileProvider.directive(map);
        },
      ]);
    }

    return this as unknown as Module<Registry, ConfigRegistry, Name, Requires>;
  }

  /**
   * Register a controller under `name`. Sugar for opening a config block
   * by hand and reaching for `$controllerProvider`:
   *
   * ```ts
   * module.config(['$controllerProvider', ($cp: IControllerProvider) => {
   *   $cp.register(name, fn);
   * }]);
   * ```
   *
   * The method owns no state and adds no validation — it pushes ONE
   * config block onto {@link $$configBlocks} that forwards verbatim to
   * `$controllerProvider.register(...)`. Last-wins on duplicate names
   * (a later registration overwrites the earlier one — contrast with
   * `.directive`, which accumulates), name/factory validation, and
   * registration timing are all inherited unchanged from the provider.
   *
   * Two forms:
   *
   * - **String form** — `controller(name, fn)` registers a single
   *   controller factory.
   * - **Bulk-map form** — `controller({ HomeCtrl: fnA, AboutCtrl: fnB })`
   *   registers every entry in the object in a single call (still ONE
   *   config block).
   *
   * Returns the same module instance so the call can be chained with
   * every other module-builder method.
   *
   * **No registry widening.** Unlike `.filter` (which routes through
   * `$provide.factory` as `<name>Filter`) and `.directive` (which
   * registers a `<name>Directive` provider), controllers are stored in
   * `$ControllerProvider`'s private `$$registry` Map and are NEVER
   * injector-resolvable services. There is no injector key to widen the
   * typed `Registry` with — this is an intrinsic fact about how
   * `$controllerProvider` works, not a design choice. Both typed
   * overloads on {@link TypedModule} therefore return the module type
   * unchanged.
   *
   * @param nameOrMap - The controller name (string form) or a map of
   *   `{ name: fn }` entries (bulk-map form).
   * @param fn - The controller factory, required in the string form
   *   and ignored in the bulk-map form. A {@link ControllerInvokable}
   *   — either a bare function or an array-style annotation whose
   *   trailing element is the function.
   *
   * @example
   * ```ts
   * createModule('app', ['ng']).controller('HomeCtrl', [
   *   '$scope',
   *   ($scope) => {
   *     ($scope as { title: string }).title = 'Home';
   *   },
   * ]);
   * // injector.get('$controller')('HomeCtrl', { $scope }) runs the factory.
   * ```
   */
  controller(
    nameOrMap: string | Record<string, ControllerInvokable>,
    fn?: ControllerInvokable,
  ): Module<Registry, ConfigRegistry, Name, Requires> {
    // `.controller()` is sugar over `.config(['$controllerProvider', $cp =>
    // $cp.register(nameOrMap, fn)])`. Branch on the argument shape so the
    // provider's matching overload is called: the string form forwards
    // `(name, fn)`, the bulk-map form forwards `(map)`. `$cp.register`'s
    // implementation signature accepts `fn?`, so a missing `fn` in the
    // string branch is the provider's misuse to surface — the DSL adds no
    // validation of its own.
    if (typeof nameOrMap === 'string') {
      const name = nameOrMap;
      this.$$configBlocks.push([
        '$controllerProvider',
        ($controllerProvider: IControllerProvider) => {
          $controllerProvider.register(name, fn as ControllerInvokable);
        },
      ]);
    } else {
      const map = nameOrMap;
      this.$$configBlocks.push([
        '$controllerProvider',
        ($controllerProvider: IControllerProvider) => {
          $controllerProvider.register(map);
        },
      ]);
    }

    return this as unknown as Module<Registry, ConfigRegistry, Name, Requires>;
  }
}

/**
 * Typed builder view of a {@link Module}, returned by {@link createModule}.
 *
 * At runtime this is exactly the same object as the underlying `Module` class
 * instance. At the type level it overlays three additional `factory` overloads
 * that validate dependency names against this module's own `Registry`:
 *
 * 1. **Array-style with typed deps** — each leading entry is constrained to
 *    `keyof Registry & string`, and the trailing callback's parameters are
 *    inferred from {@link ResolveDeps}. When every dep is a registered
 *    literal key, the callback arguments come back typed; when some dep is
 *    unknown to the local registry, the overload falls through to #3 below
 *    (see the typo-detection note on the overload itself).
 * 2. **`$inject`-annotated with typed deps** — the function's `$inject`
 *    property must be a `readonly` literal tuple of `keyof Registry & string`
 *    entries. Users must annotate `$inject` with `as const` (or a readonly
 *    tuple type) so TypeScript sees the literal dep names.
 * 3. **Untyped fallback** — the original `Invokable<Return>` signature,
 *    preserved for backward compatibility with factories that reference deps
 *    from transitively-required modules, factories whose `$inject` is a wider
 *    `string[]`, and existing call sites that explicitly annotate
 *    `.factory<'name', Shape>(...)`.
 *
 * The typed overloads live on this interface rather than on the class itself
 * because adding Registry-dependent parameter types to a class method puts
 * `Registry` in a contravariant position on the method. That breaks the
 * covariant subtype relationship `Module<A> <: Module<B>` when `A <: B`,
 * which `AnyModule` and `createInjector` rely on. Keeping the typed overloads
 * on `TypedModule` sidesteps the variance conflict: the interface extends the
 * class instance side but never participates in the `AnyModule` widening
 * check — the cast to `AnyModule` goes through the bare `Module` class.
 */
export interface TypedModule<
  Registry extends Record<string, unknown>,
  ConfigRegistry extends Record<string, unknown>,
  Name extends string,
  Requires extends readonly string[],
> extends Module<Registry, ConfigRegistry, Name, Requires> {
  value<const K extends string, T>(
    name: K,
    value: T,
  ): TypedModule<Registry & { [P in K]: T }, ConfigRegistry, Name, Requires>;

  constant<const K extends string, T>(
    name: K,
    value: T,
  ): TypedModule<Registry & { [P in K]: T }, ConfigRegistry & { [P in K]: T }, Name, Requires>;

  /**
   * Array-style factory with deps validated against `Registry`. Each leading
   * entry must be a literal key of the current `Registry`, and the trailing
   * callback's parameters are inferred from {@link ResolveDeps} — so each
   * callback argument is typed from the earlier `value` / `constant` /
   * `factory` registration on this module.
   *
   * **Typo detection limitation.** When a dep name is a typo (or a name that
   * lives on a transitively-required module), this overload silently fails
   * to match and call sites fall through to the untyped fallback overload
   * below. TypeScript's overload resolution is "first success wins", so the
   * constraint error on this overload does not surface. Typed param inference
   * still works for valid cases; typo detection via the type system would
   * require a different, more invasive design and is intentionally out of
   * scope here.
   */
  factory<const K extends string, const Deps extends readonly (keyof Registry & string)[], Return>(
    name: K,
    invokable: readonly [...Deps, (...args: ResolveDeps<Registry, Deps>) => Return],
  ): TypedModule<Registry & { [P in K]: Return }, ConfigRegistry, Name, Requires>;

  /**
   * `$inject`-annotated factory with deps validated against `Registry`. The
   * function's `$inject` property must be a `readonly` literal tuple whose
   * entries are keys of `Registry`; the function's parameters are validated
   * against {@link ResolveDeps}.
   */
  factory<const K extends string, const Inject extends readonly (keyof Registry & string)[], Return>(
    name: K,
    invokable: ((...args: ResolveDeps<Registry, Inject>) => Return) & { $inject: Inject },
  ): TypedModule<Registry & { [P in K]: Return }, ConfigRegistry, Name, Requires>;

  /**
   * Untyped fallback — used when deps can't be validated statically (e.g.
   * cross-module deps from a `requires` dependency, wide `string[]` `$inject`
   * properties, or explicit `.factory<'name', Shape>(...)` return annotations).
   */
  factory<K extends string, Return>(
    name: K,
    invokable: Invokable<Return>,
  ): TypedModule<Registry & { [P in K]: Return }, ConfigRegistry, Name, Requires>;

  /**
   * Register a service by passing the constructor directly — no deps. The
   * resulting `Registry` is widened with `InstanceType<Ctor>` under `name`, so
   * `injector.get(name)` resolves to the class instance type automatically
   * without an explicit generic.
   *
   * The `Ctor` constraint uses `new (...args: never[]) => unknown` so that any
   * class is assignable: a no-arg class matches trivially, and classes whose
   * constructor takes parameters still match at the type level (their deps
   * must then be supplied via the array-style overload or a `$inject`
   * annotation at runtime — the injector resolves them from the registry).
   */
  service<const K extends string, Ctor extends new (...args: never[]) => unknown>(
    name: K,
    ctor: Ctor,
  ): TypedModule<Registry & { [P in K]: InstanceType<Ctor> }, ConfigRegistry, Name, Requires>;

  /**
   * Array-style service with deps validated against `Registry`. Each leading
   * entry must be a literal key of the current `Registry`, and the trailing
   * constructor's parameters are inferred from {@link ResolveDeps} — so each
   * constructor argument is typed from the earlier `value` / `constant` /
   * `factory` / `service` registration on this module. The resulting
   * `Registry` is widened with `InstanceType<Ctor>` under `name`.
   *
   * **Typo detection limitation.** As with the typed `factory` overloads,
   * when a dep name is a typo (or lives on a transitively-required module),
   * this overload silently fails to match and call sites fall through to the
   * untyped fallback below. Typed param inference still works for valid
   * cases.
   */
  service<
    const K extends string,
    const Deps extends readonly (keyof Registry & string)[],
    Ctor extends new (...args: ResolveDeps<Registry, Deps>) => unknown,
  >(
    name: K,
    invokable: readonly [...Deps, Ctor],
  ): TypedModule<Registry & { [P in K]: InstanceType<Ctor> }, ConfigRegistry, Name, Requires>;

  /**
   * Untyped fallback for `service` — used when deps can't be validated
   * statically (e.g. cross-module deps from a `requires` dependency, wide
   * `string[]` `$inject` properties, or explicit
   * `.service<'name', Shape>(...)` return annotations).
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- explicit caller-provided return type for registry inference
  service<K extends string, Return>(
    name: K,
    invokable: Invokable,
  ): TypedModule<Registry & { [P in K]: Return }, ConfigRegistry, Name, Requires>;

  /**
   * Register a provider as a constructor function. The injector calls
   * `new Ctor()` at load time to produce the provider instance, which must
   * carry a `$get` method. The service type is extracted from `$get`'s
   * return type.
   *
   * Use this form when the provider constructor has no dependencies from
   * the config-phase injector.
   */
  provider<const K extends string, Ctor extends new () => { $get: Invokable }>(
    name: K,
    ctor: Ctor,
  ): TypedModule<
    Registry & { [P in K]: InvokableReturn<InstanceType<Ctor>['$get']> },
    ConfigRegistry & { [P in K as `${P}Provider`]: InstanceType<Ctor> },
    Name,
    Requires
  >;

  /**
   * Register a provider as an object literal with a `$get` method. The
   * service type is extracted from `$get`'s return type.
   */
  provider<const K extends string, P extends { $get: Invokable }>(
    name: K,
    obj: P,
  ): TypedModule<
    Registry & { [Q in K]: InvokableReturn<P['$get']> },
    ConfigRegistry & { [Q in K as `${Q}Provider`]: P },
    Name,
    Requires
  >;

  /**
   * Register a provider via array-style annotation with typed dependencies
   * from the module's `ConfigRegistry`. The dependency names must be keys
   * of `ConfigRegistry` (constants or `<name>Provider` entries registered
   * earlier in the builder chain). The provider constructor's parameter
   * types are inferred from {@link ResolveDeps} applied to `ConfigRegistry`.
   */
  provider<
    const K extends string,
    const Deps extends readonly (keyof ConfigRegistry & string)[],
    Ctor extends new (...args: ResolveDeps<ConfigRegistry, Deps>) => { $get: Invokable },
  >(
    name: K,
    invokable: readonly [...Deps, Ctor],
  ): TypedModule<
    Registry & { [P in K]: InvokableReturn<InstanceType<Ctor>['$get']> },
    ConfigRegistry & { [P in K as `${P}Provider`]: InstanceType<Ctor> },
    Name,
    Requires
  >;

  /**
   * Fallback overload for pre-built provider values or dynamic cases where
   * literal inference isn't possible. Matches the wide signature on the
   * `Module` class.
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- explicit caller-provided types for registry/config-registry inference
  provider<K extends string, Service, ProviderShape>(
    name: K,
    providerSource: unknown,
  ): TypedModule<
    Registry & { [P in K]: Service },
    ConfigRegistry & { [P in K as `${P}Provider`]: ProviderShape },
    Name,
    Requires
  >;

  /**
   * Array-style decorator with deps validated against `Registry`. The first
   * entry of the invokable must be the literal string `'$delegate'`, followed
   * by zero or more additional dep names that are keys of the current
   * `Registry`. The trailing callback receives `$delegate` typed as
   * `Registry[K]` (the current type of the service being decorated) and the
   * remaining parameters inferred from {@link ResolveDeps}.
   *
   * The decorator's `Return` type replaces the existing service type in the
   * registry via `Omit<Registry, K> & { [P in K]: Return }`, so chained
   * decorators can narrow or widen the service type. Because `K` is
   * constrained to `keyof Registry & string`, decorating a name that is not
   * already registered is a compile error — typos surface immediately rather
   * than failing at injector creation time.
   *
   * **Typo detection limitation.** As with the typed `factory` / `service`
   * overloads, when a dep name beyond `$delegate` is a typo (or lives on a
   * transitively-required module), overload resolution silently falls through
   * to the untyped fallback below. Typed param inference still works for
   * valid cases.
   */
  decorator<const K extends keyof Registry & string, const Deps extends readonly (keyof Registry & string)[], Return>(
    name: K,
    invokable: readonly ['$delegate', ...Deps, (delegate: Registry[K], ...rest: ResolveDeps<Registry, Deps>) => Return],
  ): TypedModule<Omit<Registry, K> & { [P in K]: Return }, ConfigRegistry, Name, Requires>;

  /**
   * Untyped fallback for `decorator` — used when deps can't be validated
   * statically (e.g. cross-module deps from a `requires` dependency, wide
   * `string[]` `$inject` properties, or pre-built invokables). Matches the
   * wide signature on the `Module` class and leaves `Registry` unchanged.
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- explicit `K` literal type parameter preserved to match the wide-signature shape on the `Module` class `decorator` method.
  decorator<K extends string>(name: K, invokable: Invokable): TypedModule<Registry, ConfigRegistry, Name, Requires>;

  /**
   * Array-style config block with deps validated against `ConfigRegistry`
   * (not `Registry`). Each leading entry must be a literal key of the current
   * `ConfigRegistry` — i.e. a constant or a `<name>Provider` entry registered
   * earlier in the builder chain — and the trailing callback's parameters are
   * inferred from {@link ResolveDeps} applied to `ConfigRegistry`. This gives
   * config blocks compile-time enforcement of the config-phase constraint:
   * referencing a run-phase-only service (e.g. `'logger'` instead of
   * `'loggerProvider'`) is a type error because that name is not a key of
   * `ConfigRegistry`.
   *
   * The callback return type is `void` — config blocks are side-effecting
   * hooks, and their return value is discarded by the injector. Return type
   * of the method is `TypedModule<Registry, ConfigRegistry, Name, Requires>`
   * unchanged — `config` does not widen either registry.
   *
   * **Cross-module config deps are inferred.** Dep names from a required
   * module's config phase (e.g. `'$interpolateProvider'` from `'ng'`) are
   * resolved via {@link RequiredConfigRegistry} — which reads each augmented
   * entry in {@link ModuleRegistry} for the names in `Requires` and unions
   * them with the local `ConfigRegistry`. Required modules must augment
   * `ModuleRegistry` to participate; un-augmented modules contribute nothing
   * and their deps fall through to the untyped fallback below.
   *
   * **Typo fallback.** When a dep name is neither a local `ConfigRegistry`
   * key nor a `RequiredConfigRegistry<Requires>` key, this overload silently
   * fails to match and call sites fall through to the untyped fallback below.
   * Typed param inference still works for valid cases.
   *
   * **Variance note.** The callback is routed through a `Fn` type parameter
   * constrained to `(...args: ResolveDeps<…, Deps>) => void` rather than
   * being written inline as a parameter type. Inlining the `ResolveDeps<…>`
   * expression directly would put `ConfigRegistry` (and now `Requires`) in a
   * contravariant position on the method, which breaks the structural
   * assignability check `ExtractRegistry` performs against
   * `TypedModule<infer R, Record<string, unknown>, string, readonly string[]>`
   * in `injector.ts` — callers of `createInjector` would lose all registry
   * inference. Routing through `Fn` keeps both in constraint position only,
   * matching the pattern used by the typed `provider` overloads above.
   */
  config<
    const Deps extends readonly (keyof (ConfigRegistry & RequiredConfigRegistry<Requires>) & string)[],
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- `Fn` is intentionally a single-use type parameter to keep `ConfigRegistry` and `Requires` out of the method parameter's variance position; see the variance note above.
    Fn extends (...args: ResolveDeps<ConfigRegistry & RequiredConfigRegistry<Requires>, Deps>) => void,
  >(
    invokable: readonly [...Deps, Fn],
  ): TypedModule<Registry, ConfigRegistry, Name, Requires>;

  /**
   * Untyped fallback for `config` — used when deps can't be validated
   * statically (e.g. cross-module config deps from a `requires` dependency,
   * wide `string[]` `$inject` properties, or pre-built invokables). Matches
   * the wide signature on the `Module` class `config` method.
   */
  config(invokable: Invokable): TypedModule<Registry, ConfigRegistry, Name, Requires>;

  /**
   * Array-style run block with deps validated against `Registry` (the full
   * run-phase registry). Each leading entry must be a literal key of the
   * current `Registry` — i.e. any service, factory, value, or constant
   * registered earlier in the builder chain — and the trailing callback's
   * parameters are inferred from {@link ResolveDeps} applied to `Registry`.
   * This gives run blocks compile-time enforcement of the run-phase
   * constraint: referencing a name that is not a key of `Registry` is a type
   * error because that name is unknown to the registry.
   *
   * The callback return type is `void` — run blocks are side-effecting hooks,
   * and their return value is discarded by the injector. Return type of the
   * method is `TypedModule<Registry, ConfigRegistry, Name, Requires>`
   * unchanged — `run` does not widen either registry.
   *
   * **Cross-module run deps are inferred.** Dep names from a required
   * module's run phase (e.g. `'$interpolate'` from `'ng'`) are resolved via
   * {@link RequiredRunRegistry} — which reads each augmented entry in
   * {@link ModuleRegistry} for the names in `Requires` and unions them with
   * the local `Registry`. Required modules must augment `ModuleRegistry` to
   * participate; un-augmented modules contribute nothing and their deps fall
   * through to the untyped fallback below.
   *
   * **Typo fallback.** When a dep name is neither a local `Registry` key
   * nor a `RequiredRunRegistry<Requires>` key, this overload silently fails
   * to match and call sites fall through to the untyped fallback below.
   * Typed param inference still works for valid cases.
   *
   * **Variance note.** The callback is routed through a `Fn` type parameter
   * constrained to `(...args: ResolveDeps<…, Deps>) => void` rather than
   * being written inline as a parameter type. Inlining the `ResolveDeps<…>`
   * expression directly would put `Registry` (and now `Requires`) in a
   * contravariant position on the method, which breaks the structural
   * assignability check `ExtractRegistry` performs against
   * `TypedModule<infer R, Record<string, unknown>, string, readonly string[]>`
   * in `injector.ts` — callers of `createInjector` would lose all registry
   * inference. Routing through `Fn` keeps both in constraint position only,
   * matching the pattern used by the typed `config` and `provider` overloads
   * above.
   */
  run<
    const Deps extends readonly (keyof (Registry & RequiredRunRegistry<Requires>) & string)[],
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- `Fn` is intentionally a single-use type parameter to keep `Registry` and `Requires` out of the method parameter's variance position; see the variance note on the `config` overload above.
    Fn extends (...args: ResolveDeps<Registry & RequiredRunRegistry<Requires>, Deps>) => void,
  >(
    invokable: readonly [...Deps, Fn],
  ): TypedModule<Registry, ConfigRegistry, Name, Requires>;

  /**
   * Untyped fallback for `run` — used when deps can't be validated statically
   * (e.g. cross-module run deps from a `requires` dependency, wide `string[]`
   * `$inject` properties, or pre-built invokables). Matches the wide
   * signature on the `Module` class `run` method.
   */
  run(invokable: Invokable): TypedModule<Registry, ConfigRegistry, Name, Requires>;

  /**
   * Register a filter under `name`. Sugar for the canonical AngularJS
   * dual-write — a `<name>Filter` provider shim plus a config block that
   * routes through `$filterProvider.register(name, factory)`. The chain is
   * widened to record `${K}Filter: F` so a downstream
   * `decorator('shoutFilter', ['$delegate', …])` call gets `$delegate` typed
   * as the filter shape registered here.
   *
   * The factory is an {@link Invokable} of any shape (array-style annotation,
   * `$inject`-tagged function, or a bare zero-dep function). Last-wins
   * applies both within a single chain (`a` then `b` for the same name) and
   * across the boundary with `$filterProvider.register(...)`.
   *
   * @example
   * ```ts
   * createModule('app', ['ng']).filter('shout', [() => (s: unknown) => `${String(s)}!`]);
   * // injector.get('$filter')('shout')('hi') === 'hi!'
   * // injector.get('shoutFilter') === injector.get('$filter')('shout')
   * ```
   */
  filter<const K extends string, F extends FilterFn>(
    name: K,
    factory: Invokable<F>,
  ): TypedModule<Registry & { [P in K as `${P}Filter`]: F }, ConfigRegistry, Name, Requires>;

  /**
   * Register a single directive under `name`. Sugar for a config block
   * that forwards to `$compileProvider.directive(name, factory)` — the
   * DSL owns no state and adds no validation; accumulation,
   * priority/terminal sorting, and error messages are all inherited
   * from the provider.
   *
   * The chain is widened to record `${K}Directive: Directive[]` so a
   * downstream `injector.get('myWidgetDirective')` lookup or a
   * `decorator('myWidgetDirective', ['$delegate', …])` call gets typed
   * — the `$delegate` of such a decorator is the `Directive[]` array
   * registered under this name (directives accumulate per name, which
   * is why the registry value is an array rather than a single object).
   *
   * @example
   * ```ts
   * createModule('app', ['ng']).directive('myWidget', () => ({
   *   restrict: 'E',
   *   link: (_scope, el) => {
   *     el.textContent = 'hello';
   *   },
   * }));
   * // injector.get('myWidgetDirective') is typed as Directive[].
   * ```
   */
  directive<const K extends string>(
    name: K,
    factory: DirectiveFactory,
  ): TypedModule<Registry & { [P in K as `${P}Directive`]: Directive[] }, ConfigRegistry, Name, Requires>;

  /**
   * Register several directives at once from a `{ name: factory }` map.
   * Sugar for a single config block that forwards the whole map to
   * `$compileProvider.directive(map)`.
   *
   * **Deliberate limitation: the bulk-map form does NOT widen the
   * registry.** Unlike the single-name form, this overload returns the
   * module type unchanged — no `${K}Directive` keys are added. Building
   * a mapped type that widens over an arbitrary object's keys is a
   * high type-system cost for low value; users who want typed widening
   * (and therefore a typed `decorator('xDirective', …)`) should use the
   * single-name form, which is the common case.
   *
   * @example
   * ```ts
   * createModule('app', ['ng']).directive({
   *   widgetA: () => ({ restrict: 'E' }),
   *   widgetB: () => ({ restrict: 'A' }),
   * });
   * // Both directives are registered; the module type is unchanged.
   * ```
   */
  directive(map: Record<string, DirectiveFactory>): TypedModule<Registry, ConfigRegistry, Name, Requires>;

  /**
   * Untyped fallback for `directive` — matches the wide signature on the
   * `Module` class. Used by dynamic call sites where `nameOrMap` is not
   * a string literal. Leaves the registry unchanged.
   */
  directive(
    nameOrMap: string | Record<string, DirectiveFactory>,
    factory?: DirectiveFactory,
  ): TypedModule<Registry, ConfigRegistry, Name, Requires>;

  /**
   * Register a single controller under `name`. Sugar for a config block
   * that forwards to `$controllerProvider.register(name, fn)` — the DSL
   * owns no state and adds no validation; last-wins on duplicate names
   * and error messages are all inherited from the provider.
   *
   * **No registry widening.** This overload returns the module type
   * unchanged — no key is added to `Registry`. Controllers live in
   * `$ControllerProvider`'s private `$$registry` Map and are never
   * injector-resolvable services (unlike filters, which route through
   * `$provide.factory` as `<name>Filter`, and directives, which register
   * a `<name>Directive` provider). There is simply no injector key to
   * widen the typed `Registry` with — this is an intrinsic fact about
   * how `$controllerProvider` works, not a design choice.
   *
   * @example
   * ```ts
   * createModule('app', ['ng']).controller('HomeCtrl', [
   *   '$scope',
   *   ($scope) => {
   *     ($scope as { title: string }).title = 'Home';
   *   },
   * ]);
   * // The module type is unchanged — no `HomeCtrl` key on the registry.
   * ```
   */
  controller(name: string, fn: ControllerInvokable): TypedModule<Registry, ConfigRegistry, Name, Requires>;

  /**
   * Register several controllers at once from a `{ name: fn }` map.
   * Sugar for a single config block that forwards the whole map to
   * `$controllerProvider.register(map)`.
   *
   * **No registry widening** — for the same reason the single-name form
   * does not widen (see above): controllers are never injector-resolvable
   * services, so there is no key to add to `Registry`. This overload
   * returns the module type unchanged.
   *
   * @example
   * ```ts
   * createModule('app', ['ng']).controller({
   *   HomeCtrl: ['$scope', ($scope) => { void $scope; }],
   *   AboutCtrl: ['$scope', ($scope) => { void $scope; }],
   * });
   * // Both controllers are registered; the module type is unchanged.
   * ```
   */
  controller(map: Record<string, ControllerInvokable>): TypedModule<Registry, ConfigRegistry, Name, Requires>;

  /**
   * Untyped fallback for `controller` — matches the wide signature on the
   * `Module` class. Used by dynamic call sites where `nameOrMap` is not
   * a string literal. Leaves the registry unchanged.
   */
  controller(
    nameOrMap: string | Record<string, ControllerInvokable>,
    fn?: ControllerInvokable,
  ): TypedModule<Registry, ConfigRegistry, Name, Requires>;
}

/**
 * Create a new {@link Module} and register it in the module-scoped registry.
 *
 * Creating a module with the same name as an existing module replaces the
 * previous registration.
 *
 * The `const` modifier on the type parameters forces TypeScript to infer
 * string-literal and tuple-literal types for `name` and `requires` instead of
 * widening them to `string` / `readonly string[]`. This is what enables
 * compile-time verification of the module dependency graph.
 *
 * @param name - Unique name for the module within the registry.
 * @param requires - Names of other modules this module depends on. Defaults
 *   to an empty array when no dependencies are required.
 */
export function createModule<const TName extends string, const TRequires extends readonly string[] = readonly []>(
  name: TName,
  requires: TRequires = [] as unknown as TRequires,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- see note on the `Module` class declaration for why `{}` is the correct empty-registry starting type.
): TypedModule<{}, {}, TName, TRequires> {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- see above.
  const module = new Module<{}, {}, TName, TRequires>(name, requires);
  registry.set(name, module as unknown as AnyModule);
  // Cast through `unknown` to expose the same runtime instance under the
  // typed-factory `TypedModule` view. The underlying `Module` class method is
  // untyped (for variance reasons — see the class's `factory` JSDoc); the
  // typed overloads live on `TypedModule` and are applied only from this
  // public entry point.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- see above.
  return module as unknown as TypedModule<{}, {}, TName, TRequires>;
}

/**
 * Retrieve a previously-registered module by name.
 *
 * Because the registry is a runtime `Map<string, AnyModule>`, there is no way
 * for TypeScript to automatically infer a specific module's typed shape from
 * just a string lookup. Two usage modes are supported:
 *
 * **Dynamic (default):**
 *
 * ```ts
 * const mod = getModule('app'); // typed as AnyModule
 * ```
 *
 * **Typed via witness:** Supply an explicit type argument `M` — typically
 * `typeof someKnownModule`. The `name` parameter is then constrained to that
 * module's own `Name` literal, so typos become compile errors. The cast is
 * checked by TypeScript against the registry entry at the call site, so it is
 * safe as long as the witness type actually matches what was registered.
 *
 * ```ts
 * const app = createModule('app', ['common']).value('apiUrl', 'https://...');
 * // Later, from somewhere without direct access to `app`:
 * const sameApp = getModule<typeof app>('app'); // fully typed
 * const typo    = getModule<typeof app>('apx'); // compile error
 * ```
 *
 * When a typed reference is already in scope, prefer using it directly instead
 * of going through `getModule`.
 *
 * @param name - Name of the module to look up.
 * @throws {Error} with message `Module not found: <name>` when no module with
 *   the given name has been registered.
 */
export function getModule<M extends AnyModule = AnyModule>(name: M['name']) {
  const module = registry.get(name);
  if (module === undefined) {
    throw new Error(`Module not found: ${name}`);
  }
  return module as M;
}

/**
 * Clear the module registry. Intended for use in test setup hooks
 * (`beforeEach(() => resetRegistry())`) to guarantee isolation between tests
 * that exercise the shared module registry.
 */
export function resetRegistry() {
  registry.clear();
}
