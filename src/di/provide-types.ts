/**
 * Type definitions for the `$provide` config-phase injectable.
 *
 * Per FS §2.10 ("loosely typed — no `MergeRegistries` integration in this
 * spec"): the six methods on {@link ProvideService} mirror the same
 * `Invokable` / provider-source / value shapes that the module DSL accepts,
 * but they DO NOT augment the typed `MergeRegistries<Mods>` registry that
 * `createInjector` returns. Config blocks run AFTER `createInjector`'s
 * return type has already been computed, so retroactive registry extension
 * isn't possible without deferred-typing machinery this spec doesn't take
 * on. The methods still type-check their inputs strictly; only the
 * consumer-side `injector.get('newName')` resolution returns `unknown` for
 * names that were registered exclusively through `$provide.*`.
 */

import type { Invokable, ResolveDeps } from './di-types';

/**
 * Lifecycle phase of an injector. Set to `'config'` while config blocks
 * run; flipped to `'run'` immediately after the last config block returns
 * (and before any run block fires). The `$provide` injectable inspects
 * this on every method call to enforce the config-phase exclusivity rule.
 */
export type PhaseState = 'config' | 'run';

/**
 * The shape of the `$provide` object that resolves inside a `config()`
 * block via DI. Mirrors the six recipes already on the module DSL —
 * `factory`, `service`, `value`, `constant`, `provider`, `decorator` —
 * with the same registration semantics (last-wins, same `Invokable`
 * shapes accepted, same DI dep rules).
 *
 * Every method is **config-phase-only**: invoking any of them after the
 * run phase begins (including via a captured-reference saved during a
 * config block) throws synchronously with a message of the form
 * `$provide.<method> is only callable during the config phase; ...`.
 * This is enforced inside the implementation by reading a `getPhase()`
 * thunk on every call, not by snapshotting at factory build time.
 */
export interface ProvideService {
  /**
   * Register a factory under `name`. Mirrors `module.factory`.
   *
   * Config-phase only — throws synchronously with
   * `$provide.factory is only callable during the config phase; calling it after the run phase begins is not supported`
   * if invoked after the run phase begins (including via a captured
   * `$provide` reference saved during a config block).
   *
   * Note that bare arrow functions like `() => 'hello'` are not
   * auto-annotated by `annotate` (they have no `$inject` and no parameter
   * names to scrape), so canonical use passes either the array form
   * `[() => 'hello']` or an explicitly `$inject`-annotated function. This
   * is a property of `annotate`, not specific to `$provide`.
   *
   * @example Override `$exceptionHandler` to forward to Sentry from a config block
   * ```typescript
   * appModule.config([
   *   '$provide',
   *   ($provide: ProvideService) => {
   *     $provide.factory('$exceptionHandler', [() => mySentryHandler]);
   *   },
   * ]);
   * ```
   */
  factory<Return>(name: string, invokable: Invokable<Return>): void;

  /**
   * Register a service constructor under `name` — bare-constructor form
   * with no deps. Mirrors `module.service`. Config-phase only — throws
   * synchronously when called after the run phase begins.
   *
   * @example Register a class-style service with deps via the array form
   * ```typescript
   * class Greeter {
   *   constructor(private readonly log: Logger) {}
   *   hello(name: string): string { return `hi ${name}`; }
   * }
   *
   * appModule.config([
   *   '$provide',
   *   ($provide: ProvideService) => {
   *     $provide.service('greeter', ['$log', Greeter]);
   *   },
   * ]);
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- `Ctor` is preserved so call sites infer the constructor's literal class shape, mirroring `module.service`'s typed bare-ctor overload.
  service<Ctor extends new (...args: never[]) => unknown>(name: string, ctor: Ctor): void;

  /** Register a service via array-style annotation — see the bare-ctor overload for the canonical example. Config-phase only. */
  service<
    const Deps extends readonly string[],
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- `Ctor` is preserved for inference parity with `module.service`'s typed array-form overload (constructor type captured at the call site).
    Ctor extends new (...args: ResolveDeps<Record<string, unknown>, Deps>) => unknown,
  >(
    name: string,
    invokable: readonly [...Deps, Ctor],
  ): void;

  /** Wide fallback for dynamic cases. Config-phase only. */
  service(name: string, invokable: Invokable): void;

  /**
   * Register a static value under `name`. Mirrors `module.value`. `V` is
   * inferred from the literal. Throws if `name` was previously registered
   * as a constant. Config-phase only — throws synchronously when called
   * after the run phase begins.
   *
   * @example Override an API URL for tests from a config block
   * ```typescript
   * testModule.config([
   *   '$provide',
   *   ($provide: ProvideService) => {
   *     $provide.value('apiUrl', '/test/api');
   *   },
   * ]);
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- `V` is the inferred argument type at the call site; preserving it keeps inference parity with `module.value<K, T>`.
  value<V>(name: string, value: V): void;

  /**
   * Register a constant under `name`. Mirrors `module.constant`. `V` is
   * inferred from the literal. Resolvable in both the config phase and
   * the run phase. Config-phase only at the registration call site —
   * throws synchronously when called after the run phase begins.
   *
   * Once a name is registered as a constant, any subsequent attempt to
   * override it via `value` / `factory` / `service` / `provider` / `decorator`
   * (through either the module DSL or `$provide`) throws
   * `Cannot override constant "<name>" — already registered via .constant(...)`.
   *
   * @example Inject a build-time secret consumable by both config and run blocks
   * ```typescript
   * appModule.config([
   *   '$provide',
   *   ($provide: ProvideService) => {
   *     $provide.constant('SECRET', 'abc');
   *   },
   * ]);
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- `V` is the inferred argument type at the call site; preserving it keeps inference parity with `module.constant<K, T>`.
  constant<V>(name: string, value: V): void;

  /**
   * Register a provider as a constructor function (no deps). The injector
   * calls `new Ctor()` immediately at registration to produce the provider
   * instance, which must carry a `$get` method. Mirrors `module.provider`.
   * Config-phase only — throws synchronously when called after the run
   * phase begins.
   *
   * @example Register a configurable service via the object-literal form
   * ```typescript
   * appModule.config([
   *   '$provide',
   *   ($provide: ProvideService) => {
   *     $provide.provider('greeting', {
   *       prefix: 'hello',
   *       setPrefix(p: string) { this.prefix = p; },
   *       $get: [() => `${this.prefix}, world`],
   *     });
   *   },
   * ]);
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- `Ctor` is preserved so call sites infer the literal provider class shape, mirroring `module.provider`'s typed bare-ctor overload.
  provider<Ctor extends new () => { $get: Invokable }>(name: string, ctor: Ctor): void;

  /** Register a provider as an object literal with a `$get` method. Mirrors `module.provider`. Config-phase only. */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- `P` is preserved so call sites infer the literal provider object shape, mirroring `module.provider`'s typed object-literal overload.
  provider<P extends { $get: Invokable }>(name: string, obj: P): void;

  /** Register a provider via array-style annotation with typed dependencies from the (opaque) config registry. Config-phase only. */
  provider<
    const Deps extends readonly string[],
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- `Ctor` is preserved for inference parity with `module.provider`'s typed array-form overload (constructor type captured at the call site).
    Ctor extends new (...args: ResolveDeps<Record<string, unknown>, Deps>) => { $get: Invokable },
  >(
    name: string,
    invokable: readonly [...Deps, Ctor],
  ): void;

  /** Wide fallback for dynamic provider sources. Config-phase only. */
  provider(name: string, source: unknown): void;

  /**
   * Register a decorator that wraps an existing service. The first entry
   * MUST be `'$delegate'`; remaining names are run-phase deps. The trailing
   * callback receives the delegate (typed `unknown` because the registry
   * is opaque inside config blocks) and the resolved deps. Mirrors
   * `module.decorator`'s array form. Config-phase only — throws
   * synchronously when called after the run phase begins.
   *
   * Decorators STACK on the current producer rather than replacing it;
   * registering a new producer for the same name does not evict prior
   * decorators.
   *
   * @example Wrap an existing service to add logging on every call
   * ```typescript
   * appModule.config([
   *   '$provide',
   *   ($provide: ProvideService) => {
   *     $provide.decorator('$http', [
   *       '$delegate',
   *       ($delegate: HttpService): HttpService => (config) => {
   *         console.log('[$http]', config.url);
   *         return $delegate(config);
   *       },
   *     ]);
   *   },
   * ]);
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- `Return` is preserved so the trailing callback's inferred return type is captured at the call site, mirroring `module.decorator`'s typed array-form overload.
  decorator<const Deps extends readonly string[], Return>(
    name: string,
    invokable: readonly [
      '$delegate',
      ...Deps,
      (delegate: unknown, ...rest: ResolveDeps<Record<string, unknown>, Deps>) => Return,
    ],
  ): void;

  /** Wide fallback for dynamic decorator invokables. Config-phase only. */
  decorator(name: string, fn: Invokable): void;
}
