/**
 * Public type surface for the `$sanitize` HTML scrubber.
 *
 * Concrete value exports (`createSanitize`, `sanitize`, `$SanitizeProvider`,
 * `ngSanitize`) land in subsequent slices of spec 013 and are re-exported
 * from the `@sanitize/index` barrel. This file holds only the type
 * declarations that the public API references.
 */

/**
 * The shape accepted by `$SanitizeProvider.addValidElements` (and the
 * upstream `addValidElements` setter in AngularJS 1.x).
 *
 * - A bare `string` is treated as a single element name.
 * - A `string[]` is treated as a list of element names — all merged into
 *   the regular HTML element allow-list (no SVG inference).
 * - The object form lets callers explicitly bucket additions into the
 *   void-element, regular HTML, or SVG-element groups. Each bucket is
 *   optional; missing buckets are equivalent to an empty list.
 */
export type AddValidElementsArg =
  | string
  | string[]
  | {
      htmlVoidElements?: string[];
      htmlElements?: string[];
      svgElements?: string[];
    };

/**
 * The callable `$sanitize` service.
 *
 * Coercion contract:
 * - `null` and `undefined` return the empty string `''`.
 * - Any other non-string is coerced via `String(input)` before sanitization.
 * - String inputs (including `''`) are sanitized and returned as the
 *   resulting safe-HTML string.
 *
 * The service never throws on user input — malformed HTML is recovered via
 * the tokenizer's auto-close path. Misconfiguration of the provider (e.g.
 * a non-RegExp `uriPattern`) throws at config time, not at call time.
 */
export type SanitizeService = (input: unknown) => string;

/**
 * Options bag for `createSanitize`.
 *
 * All fields are optional and additive over the frozen defaults exported
 * from `sanitize-allow-lists.ts`. Each option is captured by value at
 * factory call time — the returned service is closed over a frozen
 * snapshot, so post-construction mutation of the caller's arrays cannot
 * affect sanitization.
 */
export interface SanitizeOptions {
  /**
   * Extra HTML element names to merge into the default `VALID_ELEMENTS`
   * set. These are treated as regular HTML elements; for SVG additions,
   * use the provider's `addValidElements` object form.
   */
  readonly extraValidElements?: readonly string[];
  /**
   * Extra attribute names to merge into the default `VALID_ATTRS` set.
   * Note: adding `on*` event-handler names (e.g. `onclick`) is never safe
   * and defeats the entire purpose of the sanitizer.
   */
  readonly extraValidAttrs?: readonly string[];
  /**
   * When `true`, the SVG element and attribute allow-lists
   * (`SVG_ELEMENTS`, `SVG_ATTRS`) are merged into the active sets.
   * Defaults to `false` to mirror AngularJS 1.x's opt-in behavior.
   */
  readonly svgEnabled?: boolean;
  /**
   * Override for the URI-attribute protocol regex. Defaults to
   * `DEFAULT_URI_PATTERN`. Supplying a custom pattern replaces the
   * default outright (no merge / union semantics — there is only ever
   * one active pattern).
   */
  readonly uriPattern?: RegExp;
}
