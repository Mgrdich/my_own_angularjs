/**
 * `$ControllerProvider` — DI-facing configurator for the `$controller`
 * service (spec 020 Slice 3).
 *
 * Registration goes through `$controllerProvider.register(name, fn)` from
 * inside a `config()` block:
 *
 * ```ts
 * appModule.config(['$controllerProvider', ($cp: $ControllerProvider) => {
 *   $cp.register('Greeter', ['$scope', ($s) => { ($s as { msg: string }).msg = 'hi'; }]);
 * }]);
 * ```
 *
 * Unlike `$FilterProvider`, the controller provider owns its own
 * `$$registry: Map<string, ControllerInvokable>` rather than routing
 * through `$provide.factory(...)`. AngularJS deliberately keeps controllers
 * out of the DI service graph: they are user-code consumed at directive
 * link time, not services any other component would inject. Storing them
 * in the provider's own map keeps the DI registry uncluttered and matches
 * AngularJS 1.x's `$controllerProvider.register` semantics.
 *
 * **Last-wins on duplicate `register(name, ...)`** — matches services and
 * filters. The `$$registry.set(...)` call overwrites the prior factory; no
 * accumulation (contrast with directives).
 *
 * **Config-phase only.** Every `register` call reads `$provide.$$getPhase()`
 * on entry; out-of-phase calls throw
 * {@link ControllerRegistrationOutOfPhaseError} synchronously. The
 * `$$getPhase` thunk is captured from `$provide` (`['$provide', $ControllerProvider]`)
 * so a `$controllerProvider` reference saved during a config block and
 * called from a `run()` block still trips the guard — matching the
 * captured-reference safety in `$provide` itself. This is a programming
 * error and is **not** routed through `$exceptionHandler`.
 *
 * `has(name)` is reachable in both phases (no guard).
 *
 * `$get` is the array-style invokable that builds the run-phase
 * `$controller` service via `createController({ injector, registry })`. The
 * registry passed to the factory is the same `Map` the provider mutates —
 * the `ReadonlyMap` cast is a type-only seam (`Map` is structurally
 * assignable to `ReadonlyMap`), so registrations from later config blocks
 * are reflected by the live `$controller` service without extra wiring.
 */

import type { Injector } from '@di/di-types';
import type { PhaseState, ProvideService } from '@di/provide-types';

import { createController } from './controller';
import {
  ControllerRegistrationOutOfPhaseError,
  InvalidControllerFactoryError,
  InvalidControllerNameError,
} from './controller-errors';
import type { ControllerInvokable, ControllerService, IControllerProvider } from './controller-types';

/** Shape rule for controller names — non-empty, no whitespace. */
const VALID_CONTROLLER_NAME = /^\S+$/;

/**
 * Render `value` as a short shape descriptor for {@link InvalidControllerFactoryError}
 * messages. Mirrors the local `describe` helper in `controller.ts` — kept
 * inline here rather than imported across files because cross-file helper
 * imports for a four-line function add more noise than they save.
 */
function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return value.length === 0 ? 'empty array' : `array(length ${String(value.length)})`;
  }
  if (typeof value === 'string') return `string "${value}"`;
  if (typeof value === 'number') return `number ${String(value)}`;
  if (typeof value === 'boolean') return `boolean ${String(value)}`;
  if (typeof value === 'bigint') return `bigint ${String(value)}`;
  if (typeof value === 'undefined') return 'undefined';
  return typeof value;
}

/**
 * Configurator for the `$controller` service. Implements
 * {@link IControllerProvider}.
 *
 * Constructed via `['$provide', $ControllerProvider]` on the `ng` module so
 * the captured `$provide.$$getPhase` thunk reads the same phase flag as
 * `$provide`'s own method guards.
 *
 * @example Register and consume a controller from `config` and `run` blocks
 * ```ts
 * appModule
 *   .config(['$controllerProvider', ($cp: $ControllerProvider) => {
 *     $cp.register('Greeter', ['$scope', ($scope: Scope) => {
 *       ($scope as Record<string, unknown>).greeting = 'hi';
 *     }]);
 *   }])
 *   .run(['$controller', '$rootScope', ($controller, $rootScope) => {
 *     // assume $rootScope is registered; see roadmap "Application Bootstrap"
 *     $controller('Greeter', { $scope: $rootScope });
 *   }]);
 * ```
 */
export class $ControllerProvider implements IControllerProvider {
  /**
   * Captured phase oracle. Read on every `register` call so a
   * `$controllerProvider` reference saved during config and invoked from
   * `run()` still trips the guard. Mirrors `createProvideService`'s pattern
   * (`src/di/provide.ts:26-33`).
   */
  private readonly $$getPhase: () => PhaseState;

  /**
   * Owned registry. `register` writes here; `$get` hands a `ReadonlyMap`
   * view (type-only seam — same live `Map` at runtime) to `createController`
   * so later registrations are visible to the run-phase `$controller`.
   */
  private readonly $$registry = new Map<string, ControllerInvokable>();

  constructor($provide: ProvideService) {
    this.$$getPhase = $provide.$$getPhase.bind($provide);
  }

  /**
   * Register a controller factory under `name`.
   *
   * The string-form takes a name plus a {@link ControllerInvokable}
   * (either a bare function or an array-style annotation whose trailing
   * element is a function) and stores it in the provider's `$$registry`.
   * Last-wins on repeat keys: a later `register('foo', fnB)` overwrites
   * any earlier `register('foo', fnA)` registration.
   *
   * The object-form takes a `Record<string, ControllerInvokable>` and
   * iterates over its own enumerable string-keyed entries, registering
   * each via the same validation path. Matches AngularJS 1.x's bulk-
   * register shorthand exactly.
   *
   * Both forms return `this` so calls chain naturally.
   *
   * **Config-phase only.** Throws {@link ControllerRegistrationOutOfPhaseError}
   * when invoked after the run phase begins, including via a captured
   * reference saved during a config block. The guard fires BEFORE any
   * name/factory validation runs, so the surfaced error always identifies
   * the actual mistake (out-of-phase) when both shapes are wrong.
   *
   * **Validation.** Name must be a non-empty string with no whitespace
   * and not the reserved literal `'hasOwnProperty'` (a prototype-pollution
   * guard inherited from AngularJS) — otherwise
   * {@link InvalidControllerNameError}. Factory must be a function or a
   * non-empty array whose last element is a function — otherwise
   * {@link InvalidControllerFactoryError}.
   *
   * @example
   * ```ts
   * appModule.config(['$controllerProvider', ($cp: $ControllerProvider) => {
   *   $cp
   *     .register('Greeter', ['$scope', ($scope: Scope) => { void $scope; }])
   *     .register({
   *       Counter: function ($scope) { void $scope; },
   *       Alarm: ['$scope', '$log', ($scope, $log) => { void $scope; void $log; }],
   *     });
   * }]);
   * ```
   */
  register(name: string, fn: ControllerInvokable): this;
  register(map: Record<string, ControllerInvokable>): this;
  // Implementation signature widens the first argument to `unknown` so the
  // runtime "primitive / null" branch below isn't flagged as a redundant
  // narrowing by `@typescript-eslint/no-unnecessary-condition`. The two
  // overloads above still constrain external callers to the documented
  // shapes; the widening is internal only.
  register(nameOrMap: unknown, fn?: ControllerInvokable): this {
    this.$$guard('register');

    if (typeof nameOrMap === 'string') {
      this.$$validateName(nameOrMap);
      if (fn === undefined) {
        throw new InvalidControllerFactoryError(nameOrMap, describeValue(fn));
      }
      this.$$validateFactory(nameOrMap, fn);
      this.$$registry.set(nameOrMap, fn);
      return this;
    }

    // Non-string input that isn't a plain object reaches the validator
    // upfront so callers passing `null` / `42` / etc. as the first argument
    // surface `InvalidControllerNameError` (the AngularJS-canonical
    // "missing-name" diagnosis) rather than a confusing `Object.entries`
    // TypeError or a silent no-op on a primitive (where `Object.entries(42)`
    // returns `[]`). The validator's stringification surfaces the offending
    // value in the error message.
    if (nameOrMap === null || typeof nameOrMap !== 'object') {
      this.$$validateName(nameOrMap);
      // `$$validateName` always throws for non-string input — the throw
      // below is unreachable but keeps the type narrowing tidy.
      throw new InvalidControllerNameError(String(nameOrMap));
    }

    // Object form. The guard above already fired once for the bulk call;
    // intentionally skip re-guarding per entry — a phase flip mid-loop
    // is impossible since the loop is synchronous.
    for (const [key, value] of Object.entries(nameOrMap as Record<string, unknown>)) {
      this.$$validateName(key);
      this.$$validateFactory(key, value);
      this.$$registry.set(key, value as ControllerInvokable);
    }
    return this;
  }

  /**
   * Returns `true` when `name` has been registered via {@link register}
   * (string or object form). Reachable in both the config phase and the
   * run phase — no phase guard.
   *
   * @example
   * ```ts
   * appModule.config(['$controllerProvider', ($cp: $ControllerProvider) => {
   *   if (!$cp.has('Greeter')) {
   *     $cp.register('Greeter', function ($scope) { void $scope; });
   *   }
   * }]);
   * ```
   */
  has(name: string): boolean {
    return this.$$registry.has(name);
  }

  /**
   * Injector-facing factory. Array-style invokable declaring `$injector`
   * as its only dependency. The returned `$controller` service closes over
   * a {@link ReadonlyMap} view of the provider's `$$registry` — same live
   * `Map` at runtime, so later config-phase registrations are visible.
   *
   * The `ReadonlyMap` cast is a type-only seam. The runtime registry is
   * the same `Map` the provider mutates; `createController` only needs
   * read access (it never writes to the map).
   */
  $get = [
    '$injector',
    ($injector: Injector): ControllerService =>
      createController({
        injector: $injector,
        // Type-only seam: `Map` is structurally assignable to `ReadonlyMap`.
        // No runtime cost; `createController` only reads.
        registry: this.$$registry as ReadonlyMap<string, ControllerInvokable>,
      }),
  ] as const;

  /**
   * Phase guard. Reads the captured `$$getPhase` thunk so a
   * `$controllerProvider` reference saved during config and invoked from
   * `run()` still trips the guard.
   */
  private $$guard(method: string): void {
    if (this.$$getPhase() !== 'config') {
      throw new ControllerRegistrationOutOfPhaseError(method);
    }
  }

  /**
   * Shape rules for controller names — non-empty string, no whitespace,
   * not `'hasOwnProperty'` (prototype-pollution guard). The error message
   * includes the stringified offending input so a non-string slip-through
   * (via a `as unknown as string` cast at the call site) surfaces a
   * useful diagnostic rather than a cryptic `[object Object]`.
   */
  private $$validateName(name: unknown): void {
    if (typeof name !== 'string') {
      throw new InvalidControllerNameError(String(name));
    }
    if (!VALID_CONTROLLER_NAME.test(name)) {
      throw new InvalidControllerNameError(name);
    }
    if (name === 'hasOwnProperty') {
      throw new InvalidControllerNameError(name);
    }
  }

  /**
   * Shape rules for controller factories — bare function or non-empty
   * array whose trailing element is a function. Mirrors the equivalent
   * validation in `createController` at lookup time so registration-time
   * misuse is caught immediately rather than deferred to first instantiation.
   */
  private $$validateFactory(name: string, fn: unknown): void {
    if (typeof fn === 'function') return;
    if (Array.isArray(fn)) {
      const arr = fn as unknown[];
      if (arr.length === 0) {
        throw new InvalidControllerFactoryError(name, describeValue(arr));
      }
      const tail = arr[arr.length - 1];
      if (typeof tail !== 'function') {
        throw new InvalidControllerFactoryError(name, describeValue(arr));
      }
      return;
    }
    throw new InvalidControllerFactoryError(name, describeValue(fn));
  }
}
