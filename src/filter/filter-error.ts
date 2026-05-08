/**
 * Error class for filter-lookup failures.
 *
 * Thrown by the filter interpreter case (and, in later slices, by the
 * `$filter` lookup service) when a referenced filter name is not registered
 * in the active filter registry. Scope's digest-time catch site narrows on
 * this class to route the error through `$exceptionHandler` with cause
 * `'$filter'` (Slice 4).
 */

/**
 * Error thrown when a filter referenced by name cannot be resolved.
 *
 * The error message has the form `Unknown filter: <name>`, matching the
 * AngularJS 1.x convention. The `name` brand on the instance lets callers
 * narrow with `err instanceof FilterLookupError` instead of relying on
 * string-matching the message.
 *
 * @example
 * ```ts
 * try {
 *   parsedFilterExpr(scope, { $$filter: name => myLookup(name) });
 * } catch (err) {
 *   if (err instanceof FilterLookupError) {
 *     console.warn('Missing filter — fix registration:', err.message);
 *   } else {
 *     throw err;
 *   }
 * }
 * ```
 */
export class FilterLookupError extends Error {
  readonly name = 'FilterLookupError' as const;

  constructor(filterName: string) {
    super(`Unknown filter: ${filterName}`);
  }
}
