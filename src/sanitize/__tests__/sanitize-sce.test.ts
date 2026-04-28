import { beforeEach, describe, expect, it } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { ngSanitize } from '@sanitize/ng-sanitize-module';
import { sanitize } from '@sanitize/sanitize';
import { $SanitizeProvider } from '@sanitize/sanitize-provider';
import type { SanitizeService } from '@sanitize/sanitize-types';
import { createSce } from '@sce/sce';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';

describe('$sanitize ↔ $sce cross-module integration — Slice 5', () => {
  // The `ng` and `ngSanitize` value-exports are constructed at module-load
  // time and wired into the DI registry then. A neighbouring test that
  // calls `resetRegistry()` evicts them, so we re-register both here per
  // test to keep this file self-contained — mirroring the precedent in
  // `sanitize-di.test.ts` and `sce-di.test.ts`.
  beforeEach(() => {
    resetRegistry();
    createModule('ng', [])
      .provider('$sceDelegate', $SceDelegateProvider)
      .provider('$sce', $SceProvider)
      .provider('$interpolate', $InterpolateProvider);
    createModule('ngSanitize', []).provider('$sanitize', $SanitizeProvider);
  });

  describe('A. createInjector([ngModule, ngSanitize]) — sanitize fallback wired', () => {
    it('getTrustedHtml("plain text") returns "plain text" (sanitize ran, no throw)', () => {
      const injector = createInjector([ngModule, ngSanitize]);
      const $sce = injector.get('$sce');
      expect($sce.getTrustedHtml('plain text')).toBe('plain text');
    });

    it('getTrustedHtml("<p>x</p>") returns "<p>x</p>" (allowed tag survives)', () => {
      const injector = createInjector([ngModule, ngSanitize]);
      const $sce = injector.get('$sce');
      expect($sce.getTrustedHtml('<p>x</p>')).toBe('<p>x</p>');
    });

    it('getTrustedHtml("<script>alert(1)</script>safe") returns "safe" (script stripped)', () => {
      const injector = createInjector([ngModule, ngSanitize]);
      const $sce = injector.get('$sce');
      expect($sce.getTrustedHtml('<script>alert(1)</script>safe')).toBe('safe');
    });

    it('getTrustedHtml(\'<a href="javascript:alert(1)">x</a>\') returns "<a>x</a>" (js: scheme stripped)', () => {
      const injector = createInjector([ngModule, ngSanitize]);
      const $sce = injector.get('$sce');
      expect($sce.getTrustedHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    });
  });

  describe('B. createInjector([ngModule]) — no ngSanitize, baseline preserved', () => {
    it('getTrustedHtml("<p>x</p>") throws (no fallback wired)', () => {
      const injector = createInjector([ngModule]);
      const $sce = injector.get('$sce');
      // Same delegate-layer error as spec-012 (`sce-di.test.ts` pins the
      // exact form): when no fallback is wired, a plain-string getTrusted
      // for the html context surfaces the `not trusted for context 'html'`
      // delegate error — proving the fallback is genuinely opt-in.
      expect(() => $sce.getTrustedHtml('<p>x</p>')).toThrow(/not trusted for context 'html'/);
    });

    it('getTrustedHtml(null) returns null (nullish pass-through preserved)', () => {
      const injector = createInjector([ngModule]);
      const $sce = injector.get('$sce');
      expect($sce.getTrustedHtml(null)).toBeNull();
    });

    it('getTrustedHtml(undefined) returns undefined', () => {
      const injector = createInjector([ngModule]);
      const $sce = injector.get('$sce');
      expect($sce.getTrustedHtml(undefined)).toBeUndefined();
    });
  });

  describe('C. Trusted wrapper unwraps directly even when ngSanitize is loaded', () => {
    it('getTrustedHtml(trustAsHtml("<p>raw</p>")) returns "<p>raw</p>" without invoking $sanitize', () => {
      // Spy on $sanitize via decorator: `$delegate` is the original service,
      // and the decorator returns a wrapped service that records every call
      // to a `calls` array before forwarding. This is the cleanest way to
      // observe whether $sanitize fired during a getTrusted call.
      //
      // The recording maps non-string inputs to a `<non-string>` sentinel
      // rather than calling `String(input)` so we side-step
      // `@typescript-eslint/no-base-to-string` (the seam passes only string
      // inputs to `$sanitize` — see `createSce.getTrusted`'s
      // `typeof value === 'string'` guard — so the non-string branch is
      // unreachable here, but the type signature still admits `unknown`).
      const calls: string[] = [];
      const myApp = createModule('myApp', ['ngSanitize']).decorator('$sanitize', [
        '$delegate',
        ($delegate: SanitizeService): SanitizeService => {
          return (input: unknown): string => {
            calls.push(typeof input === 'string' ? input : '<non-string>');
            return $delegate(input);
          };
        },
      ]);

      const injector = createInjector([ngModule, ngSanitize, myApp]);
      const $sce = injector.get('$sce');

      const wrapped = $sce.trustAsHtml('<p>raw</p>');
      // The wrapper carries the input verbatim — no sanitization was
      // applied, so the literal source is what comes back.
      expect($sce.getTrustedHtml(wrapped)).toBe('<p>raw</p>');
      // Stronger proof: the spy never recorded a call.
      expect(calls).toEqual([]);
    });
  });

  describe('D. Strict mode OFF — sanitize NOT invoked', () => {
    it('getTrustedHtml("<script>x</script>x") returns the input unchanged and does not call $sanitize', () => {
      const calls: string[] = [];
      const myApp = createModule('myApp', ['ngSanitize']).decorator('$sanitize', [
        '$delegate',
        ($delegate: SanitizeService): SanitizeService => {
          return (input: unknown): string => {
            calls.push(typeof input === 'string' ? input : '<non-string>');
            return $delegate(input);
          };
        },
      ]);
      const configModule = createModule('strictOff', ['ng']).config([
        '$sceProvider',
        (p: $SceProvider) => {
          p.enabled(false);
        },
      ]);

      const injector = createInjector([ngModule, ngSanitize, myApp, configModule]);
      const $sce = injector.get('$sce');

      // Strict OFF short-circuits getTrusted to delegate.valueOf BEFORE the
      // sanitize seam is consulted (the `if (!enabled) return delegate.valueOf(...)`
      // line in `createSce.getTrusted`). Plain strings pass through unchanged.
      expect($sce.getTrustedHtml('<script>x</script>x')).toBe('<script>x</script>x');
      expect(calls).toEqual([]);
    });
  });

  describe('E. Other contexts unaffected — only html consults the sanitize seam', () => {
    it('getTrustedUrl("https://example.com/x") returns the string (URL context lets plain strings through)', () => {
      const injector = createInjector([ngModule, ngSanitize]);
      const $sce = injector.get('$sce');
      expect($sce.getTrustedUrl('https://example.com/x')).toBe('https://example.com/x');
    });

    it('getTrustedJs("plainJs") throws (no sanitize fallback for js)', () => {
      const injector = createInjector([ngModule, ngSanitize]);
      const $sce = injector.get('$sce');
      expect(() => $sce.getTrustedJs('plainJs')).toThrow(/not trusted for context 'js'/);
    });

    it('getTrustedCss("plainCss") throws (no sanitize fallback for css)', () => {
      const injector = createInjector([ngModule, ngSanitize]);
      const $sce = injector.get('$sce');
      expect(() => $sce.getTrustedCss('plainCss')).toThrow(/not trusted for context 'css'/);
    });

    it('getTrustedResourceUrl("https://example.com/x") throws (default allow-list is ["self"], cross-origin URL fails)', () => {
      const injector = createInjector([ngModule, ngSanitize]);
      const $sce = injector.get('$sce');
      expect(() => $sce.getTrustedResourceUrl('https://example.com/x')).toThrow(/did not match/);
    });
  });

  describe('F. ESM-first equivalent — createSce({ sanitize }) matches the DI-wired fallback', () => {
    // Pure ESM — no DI involvement. Proves the seam is correctly typed and
    // that the DI path is just a thin wrapper over this same factory call.
    it('createSce({ sanitize }).getTrustedHtml strips a script tag', () => {
      const sce = createSce({ sanitize });
      expect(sce.getTrustedHtml('<script>x</script>safe')).toBe('safe');
    });

    it('createSce({ sanitize }).getTrustedHtml preserves an allowed tag', () => {
      const sce = createSce({ sanitize });
      expect(sce.getTrustedHtml('<p>x</p>')).toBe('<p>x</p>');
    });

    it('createSce({ sanitize }).getTrustedHtml(null) === null (nullish pass-through preserved)', () => {
      const sce = createSce({ sanitize });
      expect(sce.getTrustedHtml(null)).toBeNull();
    });

    it('createSce({ sanitize }).getTrustedHtml on a TrustedHtml wrapper unwraps verbatim (sanitize is bypassed)', () => {
      const sce = createSce({ sanitize });
      const wrapped = sce.trustAsHtml('<p>raw</p>');
      expect(sce.getTrustedHtml(wrapped)).toBe('<p>raw</p>');
    });
  });
});
