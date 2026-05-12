/**
 * Public TypeScript types for the template-loading module (spec 019).
 *
 * The module ships two ESM-first services (`$templateCache` and
 * `$templateRequest`) plus the DDO-side type widening for inline
 * `template` and async `templateUrl`. Slice 1 surfaces only the
 * type signatures — the factory and provider implementations land
 * in Slices 2 and 3.
 *
 * The file is intentionally type-only — no runtime imports — so it
 * can be re-exported as `export type` from the public barrel and
 * pulled into the compiler's DDO types via a single
 * `@template/template-types` import.
 */

import type { Attributes } from '@compiler/directive-types';

/**
 * Introspection payload returned by {@link TemplateCacheService.info}.
 *
 * The literal `id: 'templates'` discriminator matches the
 * AngularJS-canonical shape so consumers can distinguish a template
 * cache from future caches that may share the same surface (e.g. a
 * potential `$httpCache` in a later phase).
 *
 * @example
 * ```ts
 * const info = $templateCache.info();
 * if (info.id === 'templates') {
 *   console.log(`Cache holds ${info.size} templates`);
 * }
 * ```
 */
export interface TemplateCacheInfo {
  /** Literal cache identifier. Always `'templates'`. */
  readonly id: 'templates';
  /** Number of entries currently stored in the cache. */
  readonly size: number;
}

/**
 * The user-facing `$templateCache` service surface (spec 019 §2.5).
 *
 * A simple Map-backed key-value store keyed by template URL (or any
 * arbitrary string, for apps that want to seed templates at boot
 * under stable identifiers). `put` returns the stored content for
 * chaining convenience, matching the AngularJS-canonical shape.
 *
 * Each injector receives its own isolated cache instance (the DI
 * factory invokes `createTemplateCache()` fresh per injector), so
 * test isolation does not require manual `removeAll()` between
 * cases — a fresh `createInjector(['ng'])` starts with an empty
 * cache.
 *
 * @example
 * ```ts
 * // Seed the cache from a config() block:
 * module.config(['$templateCache', ($templateCache) => {
 *   $templateCache.put('/tpl/card.html', '<div class="card">…</div>');
 * }]);
 *
 * // Read later from a directive's compile / link phase:
 * const html = $templateCache.get('/tpl/card.html');
 * if (html !== undefined) {
 *   // …install synchronously…
 * }
 * ```
 */
export interface TemplateCacheService {
  /**
   * Store `content` under `key` and return `content` unchanged for
   * chaining convenience.
   */
  put(key: string, content: string): string;
  /** Return the stored content for `key`, or `undefined` on miss. */
  get(key: string): string | undefined;
  /** Remove a single entry. No-op if `key` is not present. */
  remove(key: string): void;
  /** Clear every entry from the cache. */
  removeAll(): void;
  /** Return a snapshot of cache metadata — the literal id and size. */
  info(): TemplateCacheInfo;
}

/**
 * The injectable fetch function shape used internally by
 * `$templateRequest`. The default implementation routes through
 * `globalThis.fetch` and reads the response body as text; tests
 * replace it via `createTemplateRequest({ fetcher: vi.fn() })` to
 * avoid touching the network.
 *
 * @example
 * ```ts
 * import { createTemplateRequest, createTemplateCache } from 'my-own-angularjs/template';
 *
 * const mockFetcher: TemplateFetcher = vi.fn().mockResolvedValue('<p>hi</p>');
 * const request = createTemplateRequest({
 *   cache: createTemplateCache(),
 *   fetcher: mockFetcher,
 * });
 * await request('/tpl.html'); // hits mockFetcher, not the network
 * ```
 */
export type TemplateFetcher = (url: string) => Promise<string>;

/**
 * The `$templateRequest` service signature (spec 019 §2.6).
 *
 * Reads from `$templateCache` first; on miss, calls the configured
 * `TemplateFetcher`, writes the response back to the cache, and
 * returns the body. Concurrent requests for the same URL share a
 * single in-flight promise via an internal `inFlight` map.
 *
 * `ignoreRequestError`:
 * - `false` / `undefined` (default) — fetch failures reject the
 *   promise; callers can `.catch` to handle.
 * - `true` — fetch failures resolve with `undefined`; callers that
 *   want to render a fallback skip the error path entirely.
 *
 * @example
 * ```ts
 * const html = await $templateRequest('/tpl/card.html');
 * // html: string — cache hit OR fresh fetch
 *
 * const fallback = await $templateRequest('/maybe-missing.html', true);
 * // fallback: string | undefined — undefined on any error
 * ```
 */
export type TemplateRequestFn = (url: string, ignoreRequestError?: boolean) => Promise<string | undefined>;

/**
 * Function-form `template` value (spec 019 §2.2).
 *
 * Invoked at compile time with the raw host `Element` and the
 * populated {@link Attributes} bag (same instance passed to
 * `compile` / `link` callbacks). Returns the HTML string to install
 * as the host element's children. Called EXACTLY ONCE per compile
 * invocation per host element — memoized so subsequent linker
 * invocations against different scopes reuse the resolved template
 * string.
 *
 * A function that returns a non-string value at compile time is
 * routed via `$exceptionHandler('$compile')` as a
 * `TemplateFunctionReturnedNonStringError`; the element stays empty
 * and the directive's other behavior (link, compile) runs.
 *
 * @example
 * ```ts
 * $compileProvider.directive('myDir', () => ({
 *   template: (element, attrs) => `<p>${attrs.label ?? ''}</p>`,
 * }));
 * // <my-dir label="hi"></my-dir> → <my-dir><p>hi</p></my-dir>
 * ```
 */
export type TemplateFn = (element: Element, attrs: Attributes) => string;

/**
 * Function-form `templateUrl` value (spec 019 §2.4).
 *
 * Invoked at compile time with the raw host `Element` and the
 * populated {@link Attributes} bag; returns the URL string to pass
 * to `$templateRequest`. Called EXACTLY ONCE per compile
 * invocation per host element.
 *
 * A function that returns a non-string value is routed via
 * `$exceptionHandler('$compile')` as
 * `TemplateUrlFunctionReturnedNonStringError`; the element stays
 * empty and the directive's other behavior runs.
 *
 * @example
 * ```ts
 * $compileProvider.directive('myDir', () => ({
 *   templateUrl: (element, attrs) => `/tpl/${attrs.kind}.html`,
 * }));
 * // <my-dir kind="card"></my-dir> → fetches '/tpl/card.html'
 * ```
 */
export type TemplateUrlFn = (element: Element, attrs: Attributes) => string;

/**
 * Internal post-normalize template shape stored on the
 * {@link import('@compiler/directive-types').Directive} record.
 *
 * The discriminated union unifies inline vs. async storage so the
 * compiler runtime can switch on `kind` to choose between
 * synchronous installation (`inline-string` / `inline-fn`) and
 * deferred-drain installation (`url-string` / `url-fn`).
 *
 * Populated by `normalizeDirective` in Slice 4 and consumed by the
 * walker in Slices 5 / 6. Re-exported from `@compiler/directive-types`
 * for forward use by structural directives; NOT exposed in the
 * public root barrel (kept internal so future shape changes don't
 * break consumers).
 *
 * @example
 * ```ts
 * // Inline string form
 * const a: NormalizedTemplate = { kind: 'inline-string', value: '<p>hi</p>' };
 *
 * // Async URL form
 * const b: NormalizedTemplate = { kind: 'url-string', value: '/tpl/card.html' };
 *
 * // Function-form variants
 * const c: NormalizedTemplate = { kind: 'inline-fn', value: (el, attrs) => '<p>hi</p>' };
 * const d: NormalizedTemplate = { kind: 'url-fn', value: (el, attrs) => '/tpl/card.html' };
 * ```
 */
export type NormalizedTemplate =
  | { readonly kind: 'inline-string'; readonly value: string }
  | { readonly kind: 'inline-fn'; readonly value: TemplateFn }
  | { readonly kind: 'url-string'; readonly value: string }
  | { readonly kind: 'url-fn'; readonly value: TemplateUrlFn };
