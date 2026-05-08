/**
 * Filter ↔ `$sce` ↔ `$interpolate` cross-module integration tests
 * (Slice 12 / FS §2.10).
 *
 * Verifies — without any source-code changes — that a filter chain used
 * inside a `trustedContext` interpolation composes correctly with the
 * spec-012 strict-mode rules and the spec-013 `ngSanitize` opt-in. The
 * runtime wiring is already in place from prior slices: the parser's
 * filter-call evaluation runs first; the resulting value is then routed
 * through `$sce.getTrusted(context, value)` by the `$interpolate` render
 * loop. These tests pin the four FS §2.10 acceptance criteria end-to-end.
 *
 * The four scenarios:
 *   (a) ngSanitize loaded: filter runs → `$sce.getTrustedHtml` → `$sanitize`.
 *   (b) ngSanitize NOT loaded + plain string: throws at render time with
 *       the spec-012 delegate error (proves strict-mode is active).
 *   (c) Custom filter that returns a `TrustedHtml` wrapper: the wrapper
 *       survives the chain and `$sce.getTrustedHtml` unwraps directly,
 *       bypassing `$sanitize` even when `ngSanitize` is loaded.
 *   (d) Multi-segment interpolation with a trusted context and a filter
 *       chain: the spec-011 single-binding rule still throws at compile
 *       time — filters do not weaken the rule.
 */

import { describe, expect, it } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule } from '@di/module';
import { ngSanitize } from '@sanitize/ng-sanitize-module';
import type { SanitizeService } from '@sanitize/sanitize-types';
import { SCE_CONTEXTS } from '@sce/sce-contexts';
import type { SceService } from '@sce/sce-types';

describe('Filter ↔ $sce / $interpolate cross-module integration (FS §2.10)', () => {
  // `ngModule` and `ngSanitize` are constructed at module-load and wired
  // into the DI registry under their string names. Calling `resetRegistry()`
  // evicts those entries, which would break the `createModule('app',
  // ['ng', 'ngSanitize'])` named-dependency lookup in test (c). The
  // sibling `integration.test.ts` follows the same no-reset convention; the
  // `sanitize-sce.test.ts` precedent re-registers the modules in
  // `beforeEach` because it constructs providers directly rather than
  // routing through `ngModule`/`ngSanitize` value-exports.

  describe('(a) ngSanitize loaded — filter runs first, then trustedHtml routes through $sanitize', () => {
    it('renders a single-binding filter chain through uppercase → getTrustedHtml → $sanitize', () => {
      const injector = createInjector([ngModule, ngSanitize]);
      const $interpolate = injector.get('$interpolate');

      const fn = $interpolate('{{ markup | uppercase }}', false, SCE_CONTEXTS.HTML);
      // Pipeline:
      //   'uppercase' filter:           '<b>hello</b>'  → '<B>HELLO</B>'
      //   $sce.getTrustedHtml (plain):  routes plain string through $sanitize
      //   $sanitize lower-cases tag names but preserves character data
      //                                 '<B>HELLO</B>'  → '<b>HELLO</b>'
      expect(fn({ markup: '<b>hello</b>' })).toBe('<b>HELLO</b>');
    });

    it('strips a script tag from the filter output (sanitize fired)', () => {
      const injector = createInjector([ngModule, ngSanitize]);
      const $interpolate = injector.get('$interpolate');

      const fn = $interpolate('{{ markup | uppercase }}', false, SCE_CONTEXTS.HTML);
      // The uppercased `<SCRIPT>` is dropped by $sanitize because the tag
      // (lower-cased to `script` for matching) is not in the allow-list.
      // The trailing literal text survives.
      expect(fn({ markup: '<script>x</script>safe' })).toBe('SAFE');
    });
  });

  describe('(b) ngSanitize NOT loaded — plain string in html context throws at render time', () => {
    it('throws "not trusted for context \'html\'" when the filter output is a plain string', () => {
      // No `ngSanitize` in the dependency chain — the lazy
      // `$injector.has('$sanitize')` probe in `$SceProvider.$get` returns
      // false, so `getTrustedHtml` falls back to the delegate's strict
      // throw for plain strings.
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get('$interpolate');

      const fn = $interpolate('{{ markup | uppercase }}', false, SCE_CONTEXTS.HTML);
      expect(() => fn({ markup: '<b>hello</b>' })).toThrow(/not trusted for context 'html'/);
    });

    it('does NOT throw at compile time — the failure is deferred to render', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get('$interpolate');

      // `$interpolate(...)` succeeds; only invoking the returned render
      // function on a plain string surfaces the trust error.
      expect(() => $interpolate('{{ markup | uppercase }}', false, SCE_CONTEXTS.HTML)).not.toThrow();
    });
  });

  describe('(c) Custom filter wrapping via $sce.trustAsHtml — wrapper survives, $sanitize is bypassed', () => {
    it('renders the unwrapped raw inner string even with ngSanitize loaded (no sanitize call)', () => {
      // Spy on `$sanitize` via the existing decorator pattern from
      // `sanitize-sce.test.ts` — records every input, then forwards. If
      // the trust wrapper survives correctly through the filter chain,
      // `$sce.getTrustedHtml` short-circuits via `delegate.getTrusted`
      // (instanceof check) and never reaches the sanitize seam.
      const calls: string[] = [];
      const appModule = createModule('app', ['ng', 'ngSanitize'])
        .filter('trustHtml', [
          '$sce',
          ($sce: SceService) =>
            (value: unknown): unknown =>
              $sce.trustAsHtml(String(value)),
        ])
        .decorator('$sanitize', [
          '$delegate',
          ($delegate: SanitizeService): SanitizeService =>
            (input: unknown): string => {
              calls.push(typeof input === 'string' ? input : '<non-string>');
              return $delegate(input);
            },
        ]);

      const injector = createInjector([ngModule, ngSanitize, appModule]);
      const $interpolate = injector.get('$interpolate');

      const fn = $interpolate('{{ markup | trustHtml }}', false, SCE_CONTEXTS.HTML);
      // Dangerous content survives intact because the custom filter
      // explicitly wrapped the value as TrustedHtml — proof that the
      // wrapper bypasses $sanitize.
      expect(fn({ markup: '<script>alert(1)</script>' })).toBe('<script>alert(1)</script>');
      // Stronger proof: the spy never recorded a call.
      expect(calls).toEqual([]);
    });
  });

  describe('(d) Single-binding rule still applies for multi-segment interpolation in trusted contexts', () => {
    it('throws at compile time for "<p>{{ markup | uppercase }}</p>" in html context', () => {
      const injector = createInjector([ngModule, ngSanitize]);
      const $interpolate = injector.get('$interpolate');

      // The `<p>` and `</p>` literal segments make this a multi-segment
      // interpolation. Spec-011's `strictTrustActive` check fires before
      // any rendering happens — filters in the binding don't relax the
      // rule because the surrounding text is what triggers it.
      expect(() => $interpolate('<p>{{ markup | uppercase }}</p>', false, SCE_CONTEXTS.HTML)).toThrow(
        /interpolations in trusted contexts must have exactly one \{\{expression\}\}/,
      );
    });

    it('throws for two adjacent filtered expressions in html context', () => {
      const injector = createInjector([ngModule, ngSanitize]);
      const $interpolate = injector.get('$interpolate');

      // Two `{{...}}` segments — even with both filtered — violates the
      // single-binding rule.
      expect(() => $interpolate('{{ a | uppercase }}{{ b | uppercase }}', false, SCE_CONTEXTS.HTML)).toThrow(
        /interpolations in trusted contexts must have exactly one \{\{expression\}\}/,
      );
    });
  });
});
