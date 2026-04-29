/**
 * Public type surface for the `$exceptionHandler` service.
 *
 * `EXCEPTION_HANDLER_CAUSES` locks the framework-internal cause-descriptor
 * vocabulary at the eight tokens defined in FS § 2.13. The list is frozen
 * at both the type level (`as const` tuple) and runtime (`Object.freeze`)
 * so callers cannot widen it accidentally — and so the derived
 * `ExceptionHandlerCause` union and the runtime constant cannot drift.
 *
 * Future specs that introduce new internal call sites must extend this
 * tuple as part of their public-API change; see `src/exception-handler/README.md`
 * for what each token means.
 */

/**
 * The callable contract of `$exceptionHandler`.
 *
 * The framework invokes this whenever a runtime error needs reporting —
 * watch functions, listeners, async tasks, event handlers, render-time
 * interpolation, and TTL exhaustion all route through here. The default
 * implementation is {@link consoleErrorExceptionHandler} (logs to
 * `console.error`); apps override the registration to forward errors to
 * Sentry, Datadog, or any other reporter.
 *
 * The handler MUST NOT re-throw — if it does, {@link invokeExceptionHandler}
 * catches the secondary throw and degrades to `console.error`. The handler
 * is never re-invoked recursively.
 *
 * @param exception The thrown value as observed by the framework. Typed
 *   as `unknown` because JavaScript allows throwing any value, not only
 *   `Error` instances. Narrow with `instanceof Error` before reading
 *   `.stack` / `.message`.
 * @param cause Optional cause-descriptor identifying the call site —
 *   one of the eight tokens in {@link EXCEPTION_HANDLER_CAUSES}. The
 *   framework always supplies a cause; third-party callers using
 *   {@link invokeExceptionHandler} may omit it.
 *
 * @example
 * // A custom handler that forwards to Sentry while preserving local logs.
 * const sentryHandler: ExceptionHandler = (exception, cause) => {
 *   Sentry.captureException(exception, { extra: { cause } });
 *   console.error('[app]', exception);
 * };
 */
export type ExceptionHandler = (exception: unknown, cause?: string) => void;

/**
 * Frozen tuple of every cause-descriptor token the framework emits.
 *
 * This is the runtime mirror of {@link ExceptionHandlerCause}. The tuple
 * is `Object.freeze`d so accidental mutation is a TypeError in strict
 * mode; the `as const` annotation locks the literal types so the derived
 * union cannot drift from the runtime values.
 *
 * Future specs that introduce new internal call sites must extend this
 * tuple — adding a token is a public-API change.
 *
 * @example
 * // Build a per-cause counter without ever forgetting one.
 * const counts = new Map<ExceptionHandlerCause, number>();
 * for (const cause of EXCEPTION_HANDLER_CAUSES) {
 *   counts.set(cause, 0);
 * }
 *
 * @example
 * // Use as the basis of an exhaustive switch table.
 * function describe(cause: ExceptionHandlerCause): string {
 *   switch (cause) {
 *     case 'watchFn':       return 'watch function threw';
 *     case 'watchListener': return 'watch listener threw';
 *     case '$evalAsync':    return '$evalAsync task threw';
 *     case '$applyAsync':   return '$applyAsync task threw';
 *     case '$$postDigest':  return '$$postDigest callback threw';
 *     case 'eventListener': return '$on listener threw';
 *     case '$digest':       return 'digest TTL exhausted';
 *     case '$interpolate':  return 'interpolation render threw';
 *   }
 * }
 */
export const EXCEPTION_HANDLER_CAUSES = Object.freeze([
  'watchFn',
  'watchListener',
  '$evalAsync',
  '$applyAsync',
  '$$postDigest',
  'eventListener',
  '$digest',
  '$interpolate',
] as const);

/**
 * Type-level union of the eight cause-descriptor strings.
 *
 * Derived from {@link EXCEPTION_HANDLER_CAUSES} so the runtime tuple and
 * compile-time union stay in lockstep. Use this in custom handlers when
 * you need type-safe narrowing on the `cause` argument.
 *
 * @example
 * // Type-narrow `cause` inside a custom handler so the compiler can flag
 * // typos and warn when the framework adds new tokens in a future spec.
 * function handle(exception: unknown, cause?: ExceptionHandlerCause) {
 *   if (cause === '$digest') {
 *     // TTL exhaustion is fatal-ish — flag it loudly.
 *     console.error('[fatal] digest TTL exhausted', exception);
 *     return;
 *   }
 *   console.warn(`[${cause ?? 'unknown'}]`, exception);
 * }
 */
export type ExceptionHandlerCause = (typeof EXCEPTION_HANDLER_CAUSES)[number];
