import { describe, expect, it } from 'vitest';

// TrustedValueAny is deliberately not on the public barrel — we import it
// directly from the module (alongside the public exports) so the "any"
// context is exercised end-to-end.
import {
  TrustedCss,
  TrustedHtml,
  TrustedJs,
  TrustedResourceUrl,
  TrustedUrl,
  TrustedValue,
  TrustedValueAny,
  isTrustedFor,
  isTrustedValue,
} from '@sce/trusted-values';

describe('TrustedValue hierarchy', () => {
  describe('toString() and $$unwrapTrustedValue', () => {
    it('exposes the raw string via $$unwrapTrustedValue', () => {
      expect(new TrustedHtml('x').$$unwrapTrustedValue).toBe('x');
    });

    it('returns the raw string from toString()', () => {
      expect(new TrustedHtml('x').toString()).toBe('x');
    });

    it('returns the raw string from String(wrapper)', () => {
      expect(String(new TrustedHtml('hello'))).toBe('hello');
    });

    it('preserves the raw string across all concrete subclasses', () => {
      expect(new TrustedUrl('u').toString()).toBe('u');
      expect(new TrustedResourceUrl('r').toString()).toBe('r');
      expect(new TrustedJs('j').toString()).toBe('j');
      expect(new TrustedCss('c').toString()).toBe('c');
    });
  });

  describe('instanceof chain', () => {
    it('TrustedHtml is instanceof TrustedValue and TrustedHtml', () => {
      const w = new TrustedHtml('x');
      expect(w instanceof TrustedValue).toBe(true);
      expect(w instanceof TrustedHtml).toBe(true);
    });

    it('TrustedHtml is NOT instanceof TrustedUrl or TrustedResourceUrl', () => {
      const w = new TrustedHtml('x');
      expect(w instanceof TrustedUrl).toBe(false);
      expect(w instanceof TrustedResourceUrl).toBe(false);
    });

    it('TrustedResourceUrl is instanceof TrustedValue, TrustedUrl, and TrustedResourceUrl', () => {
      const w = new TrustedResourceUrl('x');
      expect(w instanceof TrustedValue).toBe(true);
      expect(w instanceof TrustedUrl).toBe(true);
      expect(w instanceof TrustedResourceUrl).toBe(true);
    });

    it('TrustedUrl is NOT instanceof TrustedResourceUrl', () => {
      const w = new TrustedUrl('x');
      expect(w instanceof TrustedResourceUrl).toBe(false);
    });
  });

  describe('isTrustedValue', () => {
    it('returns true for every trusted wrapper', () => {
      expect(isTrustedValue(new TrustedHtml('x'))).toBe(true);
      expect(isTrustedValue(new TrustedUrl('x'))).toBe(true);
      expect(isTrustedValue(new TrustedResourceUrl('x'))).toBe(true);
      expect(isTrustedValue(new TrustedJs('x'))).toBe(true);
      expect(isTrustedValue(new TrustedCss('x'))).toBe(true);
      expect(isTrustedValue(new TrustedValueAny('x'))).toBe(true);
    });

    it('returns false for plain strings and nullish values', () => {
      expect(isTrustedValue('plain')).toBe(false);
      expect(isTrustedValue(null)).toBe(false);
      expect(isTrustedValue(undefined)).toBe(false);
      expect(isTrustedValue({})).toBe(false);
    });
  });

  describe('isTrustedFor', () => {
    it('accepts a matching wrapper for every public context', () => {
      expect(isTrustedFor('html', new TrustedHtml('x'))).toBe(true);
      expect(isTrustedFor('url', new TrustedUrl('x'))).toBe(true);
      expect(isTrustedFor('resourceUrl', new TrustedResourceUrl('x'))).toBe(true);
      expect(isTrustedFor('js', new TrustedJs('x'))).toBe(true);
      expect(isTrustedFor('css', new TrustedCss('x'))).toBe(true);
    });

    it('rejects a TrustedHtml for every non-html context', () => {
      const w = new TrustedHtml('x');
      expect(isTrustedFor('url', w)).toBe(false);
      expect(isTrustedFor('resourceUrl', w)).toBe(false);
      expect(isTrustedFor('js', w)).toBe(false);
      expect(isTrustedFor('css', w)).toBe(false);
    });

    it('accepts a TrustedResourceUrl for the "url" context (subtype acceptance)', () => {
      expect(isTrustedFor('url', new TrustedResourceUrl('x'))).toBe(true);
    });

    it('rejects a bare TrustedUrl for the "resourceUrl" context (no reverse subtype)', () => {
      expect(isTrustedFor('resourceUrl', new TrustedUrl('x'))).toBe(false);
    });

    it('rejects a TrustedUrl for the "html" context', () => {
      expect(isTrustedFor('html', new TrustedUrl('x'))).toBe(false);
    });

    it('rejects plain strings for every public context', () => {
      expect(isTrustedFor('html', 'plain string')).toBe(false);
      expect(isTrustedFor('url', 'plain string')).toBe(false);
      expect(isTrustedFor('resourceUrl', 'plain string')).toBe(false);
      expect(isTrustedFor('js', 'plain string')).toBe(false);
      expect(isTrustedFor('css', 'plain string')).toBe(false);
    });

    it('rejects null and undefined for every public context', () => {
      for (const ctx of ['html', 'url', 'resourceUrl', 'js', 'css'] as const) {
        expect(isTrustedFor(ctx, null)).toBe(false);
        expect(isTrustedFor(ctx, undefined)).toBe(false);
      }
    });

    it('accepts TrustedValueAny for every public context (escape hatch)', () => {
      const w = new TrustedValueAny('x');
      expect(isTrustedFor('html', w)).toBe(true);
      expect(isTrustedFor('url', w)).toBe(true);
      expect(isTrustedFor('resourceUrl', w)).toBe(true);
      expect(isTrustedFor('js', w)).toBe(true);
      expect(isTrustedFor('css', w)).toBe(true);
    });
  });
});
