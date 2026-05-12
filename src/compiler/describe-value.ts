/**
 * Short human-readable description of an arbitrary runtime value, used
 * by compiler error classes that report a "bad shape" diagnostic
 * (e.g. {@link InvalidTranscludeValueError} from `normalizeDirective`
 * and {@link TemplateFunctionReturnedNonStringError} from the inline
 * template install pre-pass).
 *
 * Format examples — `42 (number)`, `'true' (string)`, `[] (array)`,
 * `null (null)`, `[object] (object)`. The leading literal is intended
 * for human reading; the trailing parenthesized type token is a stable
 * machine-readable discriminator that tests assert against.
 */
export function describeValue(value: unknown): string {
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
  // bypassed the slot path (e.g. `Date`, a class instance). The
  // bracketed-type fallback is acceptable; the error class also names
  // the directive so the author can debug.
  return `[${typeof value}] (${typeof value})`;
}
