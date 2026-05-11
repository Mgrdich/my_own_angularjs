/**
 * AngularJS-canonical directive name normalization.
 *
 * Converts a DOM-form directive name (kebab-case, with optional
 * `data-` / `x-` prefix and `:` / `_` / `-` separators) into the
 * camelCase JavaScript identifier the directive was registered under.
 *
 * The algorithm is a direct port of AngularJS 1.x's `directiveNormalize`
 * (see `compile.js` in the reference implementation):
 *
 * 1. Strip a leading `(x|data)[:\-_]` prefix (case-insensitive).
 * 2. Camelize the remainder by replacing each run of `[:\-_]+` with the
 *    uppercase of the immediately following character (or empty string
 *    if no character follows).
 *
 * Results are memoized in a private `Map<string, string>` keyed on the
 * raw input — repeated lookups for the same DOM-form name return the
 * cached camelCase result without re-running the regex. The hot-path
 * matters because every attribute on every element is normalized during
 * a `$compile` walk.
 *
 * @example
 * ```ts
 * directiveNormalize('my-directive');        // 'myDirective'
 * directiveNormalize('data-my-directive');   // 'myDirective'
 * directiveNormalize('x-my-directive');      // 'myDirective'
 * directiveNormalize('my:directive');        // 'myDirective'
 * directiveNormalize('my_directive');        // 'myDirective'
 * directiveNormalize('myDirective');         // 'myDirective' (idempotent)
 * ```
 */

const PREFIX_REGEX = /^((?:x|data)[:\-_])/i;
const SPECIAL_CHARS_REGEX = /[:\-_]+(.)?/g;

const cache = new Map<string, string>();

/**
 * Normalizes a DOM-form directive or attribute name to the camelCase
 * identifier used at registration time. Memoized on the raw input.
 */
export function directiveNormalize(name: string): string {
  const cached = cache.get(name);
  if (cached !== undefined) {
    return cached;
  }

  const prefixMatch = PREFIX_REGEX.exec(name);
  const stripped = prefixMatch ? name.slice(prefixMatch[0].length) : name;

  const camelCased = stripped.replace(SPECIAL_CHARS_REGEX, (_match: string, letter?: string) =>
    letter ? letter.toUpperCase() : '',
  );

  cache.set(name, camelCased);
  return camelCased;
}
