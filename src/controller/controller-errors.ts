/**
 * Typed error classes used by the `@controller` module (spec 020).
 *
 * Mirrors `src/compiler/compile-error.ts` and `src/filter/filter-error.ts`:
 * each class extends `Error`, carries a literal `readonly name` brand so
 * callers can narrow with `err instanceof <Class>` (and switch on
 * `err.name` without string-matching the message), and produces a single
 * deterministic message in its constructor. The messages are part of the
 * public contract and locked by `__tests__/controller-errors-foundation.test.ts`.
 *
 * **Routing.** Two of the six are programming errors thrown directly to
 * the caller (`ControllerRegistrationOutOfPhaseError`,
 * `UnknownControllerError` on the direct-call path); the rest are also
 * direct throws at their primary call site (registration time or parse
 * time). Compile-time invocations of `$controller(...)` are wrapped by
 * the spec-020 Slice 4 seam in a `try/catch` that routes through
 * `$exceptionHandler('$compile')` — no new `EXCEPTION_HANDLER_CAUSES`
 * entry is added (the tuple stays at 10).
 */

/**
 * Thrown by `$controllerProvider.register(...)` (and any future
 * config-phase-only method) when invoked after the run phase has begun.
 *
 * Mirrors the wording from `src/di/provide.ts`'s `$provide.*` guard so
 * users hitting one phase guard recognize the same pattern from the
 * other. This is a programming error — it is thrown directly to the
 * caller and is NOT routed through `$exceptionHandler`.
 *
 * @example
 * ```ts
 * let cp: IControllerProvider | undefined;
 * module.config(['$controllerProvider', ($cp) => {
 *   cp = $cp; // capture a reference for later misuse
 * }]);
 * createInjector(['ng', module]);
 * try {
 *   cp!.register('Late', function () {});
 * } catch (err) {
 *   if (err instanceof ControllerRegistrationOutOfPhaseError) {
 *     console.warn(err.message);
 *   }
 * }
 * ```
 */
export class ControllerRegistrationOutOfPhaseError extends Error {
  readonly name = 'ControllerRegistrationOutOfPhaseError' as const;

  constructor(method: string) {
    super(
      `$controllerProvider.${method} is only callable during the config phase; calling it after the run phase begins is not supported`,
    );
  }
}

/**
 * Thrown by `$controllerProvider.register(name, ...)` when `name` is
 * empty, contains whitespace, is non-string (callers stringify the
 * offending input before constructing this error), or is the reserved
 * literal `'hasOwnProperty'` (a prototype-pollution guard inherited
 * from AngularJS).
 *
 * Direct throw at registration time.
 *
 * @example
 * ```ts
 * try {
 *   $controllerProvider.register('has space', function () {});
 * } catch (err) {
 *   if (err instanceof InvalidControllerNameError) {
 *     console.warn(err.message);
 *   }
 * }
 * ```
 */
export class InvalidControllerNameError extends Error {
  readonly name = 'InvalidControllerNameError' as const;

  constructor(received: string) {
    super(
      `Invalid controller name: ${received} (must be a non-empty string with no whitespace; "hasOwnProperty" is reserved)`,
    );
  }
}

/**
 * Thrown when a controller's factory value is not a function and not a
 * non-empty array whose last element is a function. Reused by:
 *
 * - `$controllerProvider.register(name, fn)` — direct throw at
 *   registration; `name` is the registered name.
 * - `$controller(badInput, ...)` — direct throw at lookup; `name` is
 *   the sentinel `'<inline>'` because there is no registered name.
 *
 * `description` is a human-readable shape descriptor (e.g.
 * `"null"`, `"number"`, `"empty array"`) so the surfaced message names
 * the offending value's category without leaking its full content.
 *
 * @example
 * ```ts
 * try {
 *   $controllerProvider.register('X', null as unknown as ControllerInvokable);
 * } catch (err) {
 *   if (err instanceof InvalidControllerFactoryError) {
 *     console.warn(err.message);
 *   }
 * }
 * ```
 */
export class InvalidControllerFactoryError extends Error {
  readonly name = 'InvalidControllerFactoryError' as const;

  constructor(name: string, description: string) {
    super(`Invalid controller factory for "${name}": ${description}`);
  }
}

/**
 * Thrown by `$controller(name, ...)` when `name` does not resolve to a
 * registered controller in the provider's `$$registry`.
 *
 * **Routing asymmetry** — direct callers see this error propagate
 * (no `$exceptionHandler` interception, matching AngularJS). When the
 * lookup happens inside `$compile`'s per-element seam (Slice 4), that
 * seam's `try/catch` routes the error through `$exceptionHandler('$compile')`
 * and continues to the next directive.
 *
 * @example
 * ```ts
 * try {
 *   $controller('NotRegistered', {});
 * } catch (err) {
 *   if (err instanceof UnknownControllerError) {
 *     console.warn(err.message); // 'Unknown controller: NotRegistered'
 *   }
 * }
 * ```
 */
export class UnknownControllerError extends Error {
  readonly name = 'UnknownControllerError' as const;

  constructor(name: string) {
    super(`Unknown controller: ${name}`);
  }
}

/**
 * Thrown when the `'Name as alias'` suffix or a directive's
 * `controllerAs` value fails the alias-shape rules:
 *
 * - empty alias after `as` (e.g. `'Name as '`)
 * - alias-only form (e.g. `' as vm'`)
 * - alias that is not a valid identifier (e.g. `'Name as 123'`)
 * - leading whitespace before `as` is significant — the regex is
 *   anchored on the whole trimmed string
 *
 * Direct throw at the parse site (`parseControllerName` in Slice 2 and
 * the registration-time `controllerAs` validation in Slice 4).
 *
 * @example
 * ```ts
 * try {
 *   $controller('Greeter as 123', { $scope });
 * } catch (err) {
 *   if (err instanceof MalformedControllerAliasError) {
 *     console.warn(err.message);
 *   }
 * }
 * ```
 */
export class MalformedControllerAliasError extends Error {
  readonly name = 'MalformedControllerAliasError' as const;

  constructor(received: string) {
    super(`Malformed controller alias: "${received}" — expected "Name as alias" where alias is a valid identifier`);
  }
}

/**
 * Thrown at directive **registration** time (Slice 4) when a Directive
 * Definition Object declares `controllerAs` without a `controller`. The
 * two fields must always be paired — `controllerAs` carries the alias
 * under which the `controller`'s instance is exposed on its scope, and
 * an alias with nothing to alias is a programming error.
 *
 * Routed via `$exceptionHandler('$compile')` from the existing factory
 * try/catch in `$$buildDirectiveArrayProvider`, alongside the
 * `IsolateScopeNotSupportedError` precedent.
 *
 * @example
 * ```ts
 * $compileProvider.directive('myDir', () => ({ controllerAs: 'vm' }));
 * // routes ControllerAsWithoutControllerError via $exceptionHandler('$compile')
 * ```
 */
export class ControllerAsWithoutControllerError extends Error {
  readonly name = 'ControllerAsWithoutControllerError' as const;

  constructor(directiveName: string) {
    super(`Directive "${directiveName}" declares controllerAs without a controller; both must be present together`);
  }
}
