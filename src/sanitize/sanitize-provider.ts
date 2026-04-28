/**
 * `$SanitizeProvider` — DI-facing configurator for the `$sanitize` service.
 *
 * Exposes fluent `addValidElements` / `addValidAttrs` / `enableSvg` /
 * `uriPattern` getter / setter methods intended for use from
 * `config(['$sanitizeProvider', p => ...])` blocks, and a `$get` invokable
 * that the run-phase injector drains to produce the actual service via
 * `createSanitize`.
 *
 * Mirrors AngularJS 1.x `$sanitizeProvider`. The `$` prefix on the class
 * name is the AngularJS convention for built-in service providers; the `$$`
 * prefix on the instance fields signals "private / not part of the public
 * API" and mirrors existing conventions (`$SceDelegateProvider.$$allowList`,
 * `$InterpolateProvider.$$startSymbol`).
 *
 * Setter validation fires immediately — misconfiguration (e.g. a non-RegExp
 * `uriPattern` or a non-string element entry) surfaces during the `config()`
 * phase, not at first sanitization. The actual allow-list merge runs at
 * `$get` time so late setter changes still take effect if somehow invoked.
 *
 * Note on the bucketed `addValidElements` object form: AngularJS distinguishes
 * `htmlVoidElements` / `htmlElements` / `svgElements` because each bucket is
 * fed into a different upstream allow-list set. Our ESM-first `createSanitize`
 * accepts a single flat `extraValidElements` array — so all entries from any
 * bucket are merged into a single `Set` here. SVG support is gated separately
 * by `enableSvg(true)` (which switches on the SVG element/attr defaults).
 */

import { createSanitize } from '@sanitize/sanitize';
import { DEFAULT_URI_PATTERN } from '@sanitize/sanitize-allow-lists';
import type { AddValidElementsArg, SanitizeService } from '@sanitize/sanitize-types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNonEmptyStringArray(value: unknown, methodName: string, context: string): asserts value is string[] {
  if (!Array.isArray(value)) {
    throw new Error(`$sanitizeProvider.${methodName}: ${context} must be an array, got ${typeof value}`);
  }
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new Error(`$sanitizeProvider.${methodName}: ${context} entries must be non-empty strings`);
    }
  }
}

export class $SanitizeProvider {
  // `$$` prefix mirrors the AngularJS "internal / not part of the public
  // API" convention. Kept private so callers are routed through the
  // validated setters.
  private readonly $$extraValidElements: Set<string> = new Set();
  private readonly $$extraValidAttrs: Set<string> = new Set();
  private $$svgEnabled: boolean = false;
  private $$uriPattern: RegExp = DEFAULT_URI_PATTERN;

  /**
   * Register additional element names to merge into the active allow-list.
   *
   * Accepts:
   * - a single string element name,
   * - a `string[]` of element names, or
   * - a bucketed object `{ htmlVoidElements?, htmlElements?, svgElements? }`
   *   — bucket distinctions are preserved by AngularJS but flattened here:
   *   every entry from any present bucket is merged into the single
   *   `extraValidElements` set consumed by `createSanitize`. SVG support is
   *   gated separately by {@link enableSvg}.
   *
   * Validation is synchronous — non-string entries, empty strings, or an
   * unrecognised argument shape throw immediately. Returns `this` for
   * fluent chaining.
   *
   * @example
   * ```ts
   * createModule('app', ['ngSanitize']).config([
   *   '$sanitizeProvider',
   *   (p: $SanitizeProvider) => {
   *     p.addValidElements('my-tag')
   *      .addValidElements(['custom-a', 'custom-b'])
   *      .addValidElements({ svgElements: ['my-svg-tag'] });
   *   },
   * ]);
   * ```
   */
  addValidElements(arg: AddValidElementsArg): this {
    if (typeof arg === 'string') {
      if (arg.length === 0) {
        throw new Error('$sanitizeProvider.addValidElements: element name must be a non-empty string');
      }
      this.$$extraValidElements.add(arg);
      return this;
    }
    if (Array.isArray(arg)) {
      assertNonEmptyStringArray(arg, 'addValidElements', 'array');
      for (const name of arg) {
        this.$$extraValidElements.add(name);
      }
      return this;
    }
    if (isPlainObject(arg)) {
      const buckets = ['htmlVoidElements', 'htmlElements', 'svgElements'] as const;
      for (const bucket of buckets) {
        const entries = arg[bucket];
        if (entries === undefined) {
          continue;
        }
        assertNonEmptyStringArray(entries, 'addValidElements', bucket);
        for (const name of entries) {
          this.$$extraValidElements.add(name);
        }
      }
      return this;
    }
    throw new Error(
      `$sanitizeProvider.addValidElements: argument must be a string, string[], or bucketed object, got ${typeof arg}`,
    );
  }

  /**
   * Register additional attribute names to merge into the active allow-list.
   *
   * `attrs` must be an array of non-empty strings; any other shape throws
   * synchronously. Returns `this` for fluent chaining.
   *
   * Note: adding event-handler names like `onclick` defeats the purpose of
   * sanitization. The provider does not block such entries (parity with
   * AngularJS) — callers are responsible for not punching a hole in their
   * own allow-list.
   *
   * @example
   * ```ts
   * createModule('app', ['ngSanitize']).config([
   *   '$sanitizeProvider',
   *   (p: $SanitizeProvider) => p.addValidAttrs(['data-test-id', 'aria-busy']),
   * ]);
   * ```
   */
  addValidAttrs(attrs: string[]): this {
    assertNonEmptyStringArray(attrs, 'addValidAttrs', 'attrs');
    for (const name of attrs) {
      this.$$extraValidAttrs.add(name);
    }
    return this;
  }

  /**
   * Get or set the SVG-support flag. With no argument, returns the current
   * boolean. With a boolean argument, stores it and returns `this` so the
   * call is chainable. Any non-boolean argument throws a descriptive error
   * naming the received `typeof`.
   *
   * Defaults to `false` — AngularJS 1.x parity. SVG support is opt-in
   * because malformed SVG was the vector behind multiple historical mXSS
   * advisories.
   *
   * @example
   * ```ts
   * createModule('app', ['ngSanitize']).config([
   *   '$sanitizeProvider',
   *   (p: $SanitizeProvider) => p.enableSvg(true),
   * ]);
   * ```
   */
  enableSvg(): boolean;
  enableSvg(value: boolean): this;
  enableSvg(value?: boolean): boolean | this {
    if (value === undefined) {
      return this.$$svgEnabled;
    }
    if (typeof value !== 'boolean') {
      throw new Error(`$sanitizeProvider.enableSvg: value must be a boolean, got ${typeof value}`);
    }
    this.$$svgEnabled = value;
    return this;
  }

  /**
   * Get or set the URI-attribute protocol regex applied to attributes whose
   * values are interpreted as URIs (`href`, `src`, `xlink:href`, …). With no
   * argument, returns the current pattern. With a `RegExp` argument, stores
   * it and returns `this` for chaining. Anything that is not a `RegExp`
   * instance (e.g. a plain string) throws synchronously.
   *
   * Defaults to {@link DEFAULT_URI_PATTERN} (accepts `http`, `https`,
   * `s?ftp`, `mailto`, `tel`, `file`, plus relative URLs). Supplying a
   * custom pattern replaces the default outright — there is no merge / union
   * semantics, only one active pattern.
   *
   * @example
   * ```ts
   * createModule('app', ['ngSanitize']).config([
   *   '$sanitizeProvider',
   *   (p: $SanitizeProvider) => p.uriPattern(/^myapp:/i),
   * ]);
   * ```
   */
  uriPattern(): RegExp;
  uriPattern(pattern: RegExp): this;
  uriPattern(pattern?: RegExp): RegExp | this {
    if (pattern === undefined) {
      return this.$$uriPattern;
    }
    if (!(pattern instanceof RegExp)) {
      throw new Error(`$sanitizeProvider.uriPattern: pattern must be a RegExp, got ${typeof pattern}`);
    }
    this.$$uriPattern = pattern;
    return this;
  }

  /**
   * Injector-facing factory. Array-style invokable with no dependencies —
   * the closure captures `this` so the configuration in force at `$get`
   * time (i.e. after all `config()` blocks have run) is what gets baked
   * into the produced service.
   */
  $get = [
    (): SanitizeService =>
      createSanitize({
        extraValidElements: [...this.$$extraValidElements],
        extraValidAttrs: [...this.$$extraValidAttrs],
        svgEnabled: this.$$svgEnabled,
        uriPattern: this.$$uriPattern,
      }),
  ] as const;
}
