/**
 * Typed error classes used by the compiler module.
 *
 * Mirrors `src/filter/filter-error.ts`: each class carries a literal
 * `name` brand so callers can narrow with `err instanceof <Class>`
 * instead of relying on string-matching the message. Messages are
 * deliberately stable — the strings are part of the public contract
 * and locked by tests.
 */

/**
 * Thrown by `$compileProvider.directive(name, factory)` when `name` is
 * not a valid camelCase JavaScript identifier (empty, contains
 * whitespace, starts with a digit, etc.).
 *
 * @example
 * ```ts
 * try {
 *   $compileProvider.directive('1bad', () => ({}));
 * } catch (err) {
 *   if (err instanceof InvalidDirectiveNameError) {
 *     console.warn('Fix the directive name:', err.message);
 *   } else {
 *     throw err;
 *   }
 * }
 * ```
 */
export class InvalidDirectiveNameError extends Error {
  readonly name = 'InvalidDirectiveNameError' as const;

  constructor(directiveName: string) {
    super(`Invalid directive name: ${directiveName}`);
  }
}

/**
 * Thrown by `$compileProvider.directive(name, factory)` when `factory`
 * is falsy (`null`, `undefined`, empty string, `0`, etc.) or otherwise
 * cannot be invoked as a directive factory.
 *
 * @example
 * ```ts
 * try {
 *   $compileProvider.directive('myDir', null);
 * } catch (err) {
 *   if (err instanceof InvalidDirectiveFactoryError) {
 *     console.warn(err.message);
 *   }
 * }
 * ```
 */
export class InvalidDirectiveFactoryError extends Error {
  readonly name = 'InvalidDirectiveFactoryError' as const;

  constructor(directiveName: string) {
    super(`Invalid directive factory for ${directiveName}`);
  }
}

/**
 * Thrown when a directive factory returns a Directive Definition
 * Object whose `scope` property is the isolate-scope object form
 * (`scope: { foo: '=' }`). Spec 017 deliberately rejects isolate
 * scope at registration time so a future spec can add it without a
 * silent semantic change.
 *
 * @example
 * ```ts
 * $compileProvider.directive('myDir', () => ({ scope: { foo: '=' } }));
 * // throws IsolateScopeNotSupportedError
 * ```
 */
export class IsolateScopeNotSupportedError extends Error {
  readonly name = 'IsolateScopeNotSupportedError' as const;

  constructor(directiveName: string) {
    super(`Isolate scope is not yet supported (spec 017 ships only scope: false | true). Directive: ${directiveName}`);
  }
}
