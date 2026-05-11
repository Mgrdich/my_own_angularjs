/**
 * `$CompileProvider` — DI-facing configurator for the `$compile`
 * service.
 *
 * Mirrors `$FilterProvider` (`src/filter/filter-provider.ts:33`):
 * a `$provide`-injected constructor; private state for the
 * registered names and per-name factory list; a string-form +
 * object-form `directive(...)` registration surface; and an
 * `as const` `$get` array that delegates to `createCompile` at
 * run-phase.
 *
 * Multiple-factories-per-name semantics (FS §2.3): every call to
 * `directive(name, factory)` appends to `$$factoryMap.get(name)`.
 * The FIRST registration for a given name installs a single
 * `<name>Directive` provider whose `$get` reads the up-to-date
 * factory list lazily — subsequent registrations only mutate the
 * map and become visible on the next lookup.
 *
 * `IsolateScopeNotSupportedError` fires lazily, at provider-`$get`
 * time, NOT at `directive(...)` registration time. This matches
 * AngularJS where DDO validation runs when the directive is first
 * compiled. The error message is the spec-canonical one.
 */

import type { Injector } from '@di/di-types';
import type { ProvideService } from '@di/provide-types';
import { invokeExceptionHandler, type ExceptionHandler } from '@exception-handler/index';
import type { InterpolateService } from '@interpolate/interpolate-types';

import { createCompile } from './compile';
import {
  DuplicateTranscludeSelectorError,
  ElementTranscludeNotSupportedError,
  InvalidDirectiveFactoryError,
  InvalidDirectiveNameError,
  InvalidTranscludeSelectorError,
  InvalidTranscludeSlotNameError,
  InvalidTranscludeValueError,
  IsolateScopeNotSupportedError,
} from './compile-error';
import { directiveNormalize } from './directive-normalize';
import type {
  CompileFn,
  CompileService,
  Directive,
  DirectiveDefinition,
  DirectiveFactory,
  DirectiveFactoryReturn,
  LinkFn,
} from './directive-types';
import type { NormalizedTransclude, TranscludeSlot, TranscludeSlotMap } from './transclude-types';

const VALID_DIRECTIVE_NAME = /^[a-zA-Z][a-zA-Z0-9]*$/;

/**
 * Suffix appended to every directive name when it is registered as a
 * DI provider. `$compileProvider.directive('myDir', …)` installs a
 * `myDirDirective` provider whose `$get` returns the array of
 * normalized directives. The compiler reads back via the same suffix
 * (`$injector.get('myDirDirective')`), so both call sites MUST stay in
 * lockstep — the const exists to enforce that.
 */
const DIRECTIVE_PROVIDER_SUFFIX = 'Directive';

/**
 * Module-level monotonically-increasing counter assigned to each
 * directive object produced from a factory invocation. Two factories
 * registered under the same name receive distinct `index` values, so
 * they tie-break deterministically inside the priority-sort even when
 * their priorities are equal.
 */
let $$globalDirectiveIndex = 0;

export class $CompileProvider {
  // The config-phase `$provide` reference is injected via the
  // provider constructor (`['$provide', $CompileProvider]` form on
  // `ngModule`). Used to register each `<name>Directive` provider
  // exactly once on the FIRST registration of that name.
  private readonly $$provide: ProvideService;

  /**
   * Names that have a `<name>Directive` provider already registered
   * with `$provide.provider`. Read at `$get` time to short-circuit
   * `getDirectivesByName(unknown)` without going through `$injector.get`
   * (which would throw "Unknown provider").
   */
  private readonly $$registeredNames = new Set<string>();

  /**
   * Per-name accumulator of unresolved factories. Mutated in place by
   * subsequent `directive(name, factory)` calls; the `<name>Directive`
   * provider's `$get` reads this map lazily at lookup time so later
   * registrations are visible.
   */
  private readonly $$factoryMap = new Map<string, DirectiveFactory[]>();

  constructor($provide: ProvideService) {
    this.$$provide = $provide;
  }

  /**
   * Register a directive factory under `name`.
   *
   * Two forms:
   * - **String form**: `directive(name, factory)` registers a single
   *   factory. Repeated calls with the same name accumulate (FS §2.3)
   *   — both factories run on a matched node, both participate in
   *   priority sorting independently.
   * - **Object form**: `directive({ a: factoryA, b: factoryB })`
   *   iterates the entries and recurses into the string form. An
   *   empty object is a no-op.
   *
   * Returns `this` for chaining.
   *
   * @example
   * ```ts
   * appModule.config([
   *   '$compileProvider',
   *   ($cp: $CompileProvider) => {
   *     $cp.directive('greet', () => ({
   *       link: (_scope, el, attrs) => {
   *         el.textContent = `Hello, ${attrs['name']}`;
   *       },
   *     }));
   *   },
   * ]);
   * ```
   */
  directive(name: string, factory: DirectiveFactory): this;
  directive(map: Record<string, DirectiveFactory>): this;
  directive(nameOrMap: string | Record<string, DirectiveFactory>, factory?: DirectiveFactory): this {
    if (typeof nameOrMap === 'string') {
      this.$$registerSingle(nameOrMap, factory);
      return this;
    }
    for (const [key, value] of Object.entries(nameOrMap)) {
      this.$$registerSingle(key, value);
    }
    return this;
  }

  private $$registerSingle(name: string, factory: unknown): void {
    if (!VALID_DIRECTIVE_NAME.test(name)) {
      throw new InvalidDirectiveNameError(name);
    }
    if (!isValidFactoryShape(factory)) {
      throw new InvalidDirectiveFactoryError(name);
    }

    let factories = this.$$factoryMap.get(name);
    if (factories === undefined) {
      factories = [];
      this.$$factoryMap.set(name, factories);
      // First registration for `name` — install the `<name>Directive`
      // provider exactly once. Subsequent registrations only mutate the
      // captured factory list; the provider's `$get` reads it lazily so
      // late additions are visible.
      //
      // Slice 11: the `<name>Directive` provider's `$get` ALSO depends
      // on `$exceptionHandler` so each per-factory invocation can be
      // wrapped in `try/catch` and routed through the configured
      // handler with cause `'$compile'`. A throwing factory is treated
      // as if it returned `undefined` — the directive is omitted from
      // the returned array, but other factories under the same name
      // (and at other names) continue to resolve normally.
      this.$$provide.provider(`${name}${DIRECTIVE_PROVIDER_SUFFIX}`, {
        $get: ['$injector', '$exceptionHandler', this.$$buildDirectiveArrayProvider(name)] as const,
      });
      this.$$registeredNames.add(name);
    }
    factories.push(factory);
  }

  /**
   * Returns the factory function used by the `<name>Directive`
   * provider's `$get` invokable. It reads `$$factoryMap.get(name)!`
   * lazily at lookup time, invokes each factory via `$injector.invoke`,
   * normalizes the result into a {@link Directive} object, and assigns
   * a globally-unique `index` for tie-breaking.
   *
   * Slice 11: each per-factory `$injector.invoke(factory)` AND each
   * subsequent `normalizeDirective` call is wrapped in a single
   * `try/catch`. On throw the error is routed via
   * `invokeExceptionHandler(handler, err, '$compile')` and the
   * directive is silently omitted from the returned array — other
   * factories under the same name continue to resolve. This matches
   * FS §2.16: "A throwing factory […] error is reported via
   * `$exceptionHandler(err, '$compile')`; the directive is treated as
   * if it returned `undefined` (no compile, no link); other directives
   * on the same node continue."
   *
   * The `IsolateScopeNotSupportedError` thrown by `normalizeDirective`
   * is also caught here because that validation happens lazily at
   * lookup time (per the Slice-2 deviation). Registration-time errors
   * (`InvalidDirectiveNameError`, `InvalidDirectiveFactoryError`)
   * still throw synchronously to the caller from `$$registerSingle`
   * — those are programmer errors and are not routed through
   * `$exceptionHandler`.
   */
  private $$buildDirectiveArrayProvider(
    name: string,
  ): ($injector: Injector, $exceptionHandler: ExceptionHandler) => Directive[] {
    return ($injector: Injector, $exceptionHandler: ExceptionHandler): Directive[] => {
      const factories = this.$$factoryMap.get(name) ?? [];
      const directives: Directive[] = [];
      for (const factory of factories) {
        try {
          const factoryReturn = $injector.invoke(factory);
          directives.push(normalizeDirective(name, factoryReturn));
        } catch (err) {
          invokeExceptionHandler($exceptionHandler, err, '$compile');
          // Skip this directive — fall through to the next factory in
          // the list. The walker will see whatever directives DID
          // resolve successfully and link them as usual.
        }
      }
      return directives;
    };
  }

  /**
   * Run-phase `$get` invokable. Resolves `$injector`, `$interpolate`,
   * and `$exceptionHandler`, then constructs the `CompileService` via
   * `createCompile`. The closure over `this.$$registeredNames` keeps
   * the lookup short-circuit synchronous — unknown names skip the
   * `$injector.get` round-trip entirely.
   */
  $get = [
    '$injector',
    '$interpolate',
    '$exceptionHandler',
    ($injector: Injector, $interpolate: InterpolateService, $exceptionHandler: ExceptionHandler): CompileService =>
      createCompile({
        getDirectivesByName: (name: string): Directive[] =>
          this.$$registeredNames.has(name) ? $injector.get<Directive[]>(`${name}${DIRECTIVE_PROVIDER_SUFFIX}`) : [],
        injector: $injector,
        interpolate: $interpolate,
        exceptionHandler: $exceptionHandler,
      }),
  ] as const;
}

function isValidFactoryShape(factory: unknown): factory is DirectiveFactory {
  if (factory === null || factory === undefined) {
    return false;
  }
  if (typeof factory === 'function') {
    return true;
  }
  if (Array.isArray(factory) && factory.length > 0) {
    return true;
  }
  return false;
}

/**
 * Slot-name validator (camelCase JS identifier). Used by
 * `normalizeDirective` to reject keys like `'1bad'`, `''`, `'has space'`.
 */
const VALID_SLOT_NAME = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * Selector validator (kebab-case tag name). Used by `normalizeDirective`
 * to reject values like `''`, `'NotKebab'`, `'42abc'`. Applied AFTER the
 * optional leading `?` has been stripped.
 */
const VALID_SLOT_SELECTOR = /^[a-z][a-z0-9-]*$/;

/**
 * Short human-readable description of an arbitrary runtime value, used
 * when reporting an {@link InvalidTranscludeValueError} from
 * `normalizeDirective`. The format follows the spec-018 acceptance
 * examples (`42 (number)`, `'true' (string)`, `[] (array)`,
 * `null (null)`).
 */
function describeValue(value: unknown): string {
  if (value === null) {
    return 'null (null)';
  }
  if (Array.isArray(value)) {
    return '[] (array)';
  }
  if (typeof value === 'string') {
    return `'${value}' (string)`;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `${value.toString()} (${typeof value})`;
  }
  if (typeof value === 'symbol') {
    return `${value.toString()} (symbol)`;
  }
  // Reachable for `function` and the rare `object`-typed value that
  // bypassed the multi-slot path (e.g. `Date`, a class instance). The
  // bracketed-type fallback is acceptable; the error class also names
  // the directive so the author can debug.
  return `[${typeof value}] (${typeof value})`;
}

/**
 * Validates and normalizes the `transclude` DDO field per spec-018
 * Slice 2 / technical-considerations §2.3.
 *
 * Returns the post-normalize {@link NormalizedTransclude} discriminated
 * union for `true` and the multi-slot object form, or `undefined` when
 * the directive opts out (`undefined`, `false`, or the field omitted).
 *
 * Throws on any other input — all throws are routed through
 * `$exceptionHandler('$compile')` by the factory-invocation try/catch
 * in {@link $$buildDirectiveArrayProvider} above.
 */
function normalizeTransclude(directiveName: string, transclude: unknown): NormalizedTransclude | undefined {
  if (transclude === undefined || transclude === false) {
    return undefined;
  }
  if (transclude === true) {
    return { kind: 'content' };
  }
  if (transclude === 'element') {
    throw new ElementTranscludeNotSupportedError(directiveName);
  }
  if (typeof transclude === 'object' && transclude !== null && !Array.isArray(transclude)) {
    const slots: TranscludeSlot[] = [];
    const seenNormalizedSelectors = new Map<string, string>();
    for (const [key, rawValue] of Object.entries(transclude as Record<string, unknown>)) {
      if (!VALID_SLOT_NAME.test(key)) {
        throw new InvalidTranscludeSlotNameError(directiveName, key);
      }
      if (typeof rawValue !== 'string' || rawValue.length === 0) {
        throw new InvalidTranscludeSelectorError(directiveName, key);
      }
      const optional = rawValue.charAt(0) === '?';
      const selector = optional ? rawValue.slice(1) : rawValue;
      if (!VALID_SLOT_SELECTOR.test(selector)) {
        throw new InvalidTranscludeSelectorError(directiveName, key);
      }
      const normalizedSelector = directiveNormalize(selector);
      if (seenNormalizedSelectors.has(normalizedSelector)) {
        throw new DuplicateTranscludeSelectorError(directiveName, selector);
      }
      seenNormalizedSelectors.set(normalizedSelector, key);
      slots.push({ name: key, selector, normalizedSelector, required: !optional });
    }
    const frozenSlots: TranscludeSlotMap = Object.freeze([...slots]);
    return { kind: 'slots', slots: frozenSlots };
  }
  throw new InvalidTranscludeValueError(directiveName, describeValue(transclude));
}

function normalizeDirective(name: string, factoryReturn: DirectiveFactoryReturn): Directive {
  if (typeof factoryReturn === 'function') {
    // Sugar form: `() => function postLink(scope, el, attrs) {…}`.
    const linkFn: LinkFn = factoryReturn;
    return {
      name,
      restrict: 'EA',
      priority: 0,
      terminal: false,
      index: $$globalDirectiveIndex++,
      compile: () => linkFn,
      link: linkFn,
      scope: false,
    };
  }

  const ddo: DirectiveDefinition = factoryReturn;

  // Reject isolate-scope `{...}` per FS §2.4. `scope: true` and
  // `scope: false` (or omitted) are accepted; any other object form
  // (including arrays) is the isolate form and we reject it.
  let scope: false | true;
  if (ddo.scope === undefined || ddo.scope === false) {
    scope = false;
  } else if (ddo.scope === true) {
    scope = true;
  } else {
    throw new IsolateScopeNotSupportedError(name);
  }

  // Validate + normalize the `transclude` field per spec-018 Slice 2.
  // The DDO field is user-supplied and may carry any runtime value, so
  // it is read via an `unknown`-typed view rather than the typed
  // `DirectiveDefinition` interface. The returned shape becomes the
  // `Directive.transclude` field; `undefined` means the directive
  // opted out and the property is omitted from the normalized object.
  const rawTransclude = (ddo as { transclude?: unknown }).transclude;
  const transclude = normalizeTransclude(name, rawTransclude);

  const priority = ddo.priority ?? 0;
  if (Number.isNaN(priority)) {
    throw new Error(`Invalid priority for directive ${name}: NaN`);
  }

  // Derive `compile` per FS §2.8: `compile` wins over `link`; sugar
  // `link: fn` becomes `compile: () => fn`; `link: { pre, post }`
  // becomes `compile: () => ({ pre, post })`.
  let compile: CompileFn | undefined;
  if (ddo.compile !== undefined) {
    compile = ddo.compile;
  } else if (typeof ddo.link === 'function') {
    const linkFn = ddo.link;
    compile = () => linkFn;
  } else if (ddo.link !== undefined && typeof ddo.link === 'object') {
    const linkPair = ddo.link;
    compile = () => linkPair;
  } else {
    compile = undefined;
  }

  const directive: Directive = {
    name: ddo.name ?? name,
    restrict: ddo.restrict ?? 'EA',
    priority,
    terminal: ddo.terminal ?? false,
    index: $$globalDirectiveIndex++,
    compile,
    link: ddo.link,
    scope,
  };
  if (transclude !== undefined) {
    directive.transclude = transclude;
  }
  return directive;
}
