/**
 * Typed error classes thrown SYNCHRONOUSLY by the DOM `bootstrap` entry point
 * (spec 036 Slice 4 / technical-considerations §2.6–2.7).
 *
 * Mirrors `src/compiler/compile-error.ts`: each class carries a literal `name`
 * brand so callers can narrow with `err instanceof <Class>` instead of
 * string-matching the message. Messages are deliberately stable — the strings
 * are part of the public contract and locked by tests.
 *
 * These are PROGRAMMER errors surfaced directly to the caller — they are NOT
 * routed through `$exceptionHandler` (the `EXCEPTION_HANDLER_CAUSES` tuple stays
 * at 10). Unregistered string-name modules reuse `getModule`'s existing
 * `Module not found: <name>` throw rather than a new class.
 */

/**
 * Thrown by `bootstrap(element, …)` when `element` already carries the
 * `$$ngBootstrapped` marker — i.e. an application has already been started on
 * that element. Parity with AngularJS's `ng:btstrpd`.
 *
 * @example
 * ```ts
 * bootstrap(el, [appModule]);
 * try {
 *   bootstrap(el, [appModule]); // same element again
 * } catch (err) {
 *   if (err instanceof AlreadyBootstrappedError) {
 *     console.warn(err.message);
 *   }
 * }
 * ```
 */
export class AlreadyBootstrappedError extends Error {
  readonly name = 'AlreadyBootstrappedError' as const;

  constructor(tagName: string) {
    super(`App already bootstrapped with this element '${tagName}'`);
  }
}

/**
 * Thrown by `bootstrap(element, …)` when `element` is `null` / `undefined` —
 * there is no host node to prepare, connect, and compile.
 *
 * @example
 * ```ts
 * try {
 *   bootstrap(document.querySelector('#missing'), [appModule]);
 * } catch (err) {
 *   if (err instanceof BootstrapTargetMissingError) {
 *     console.warn(err.message);
 *   }
 * }
 * ```
 */
export class BootstrapTargetMissingError extends Error {
  readonly name = 'BootstrapTargetMissingError' as const;

  constructor() {
    super('Bootstrap target element is missing (null or undefined)');
  }
}
