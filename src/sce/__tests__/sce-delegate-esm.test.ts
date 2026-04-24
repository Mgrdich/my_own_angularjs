import { describe, expect, it } from 'vitest';

import { SCE_CONTEXT_ANY, type SceContext } from '@sce/sce-contexts';
import { createSceDelegate } from '@sce/sce-delegate';
import {
  TrustedCss,
  TrustedHtml,
  TrustedJs,
  TrustedResourceUrl,
  TrustedUrl,
  TrustedValue,
  TrustedValueAny,
} from '@sce/trusted-values';

describe('createSceDelegate (always strict ESM factory)', () => {
  describe('defaults', () => {
    it('returns an object with trustAs, getTrusted, valueOf methods', () => {
      const delegate = createSceDelegate();
      expect(typeof delegate.trustAs).toBe('function');
      expect(typeof delegate.getTrusted).toBe('function');
      expect(typeof delegate.valueOf).toBe('function');
    });

    it('does not throw when called with no options', () => {
      expect(() => createSceDelegate()).not.toThrow();
    });

    it('does not throw when called with an empty options object', () => {
      expect(() => createSceDelegate({})).not.toThrow();
    });
  });

  describe('trustAs — happy path', () => {
    it('wraps a string for the html context as TrustedHtml', () => {
      const delegate = createSceDelegate();
      const w = delegate.trustAs('html', 'x');
      expect(w).toBeInstanceOf(TrustedHtml);
      expect((w as TrustedHtml).$$unwrapTrustedValue).toBe('x');
    });

    it('wraps a string for the url context as TrustedUrl', () => {
      const delegate = createSceDelegate();
      const w = delegate.trustAs('url', 'x');
      expect(w).toBeInstanceOf(TrustedUrl);
      expect((w as TrustedUrl).$$unwrapTrustedValue).toBe('x');
    });

    it('wraps a string for the resourceUrl context as TrustedResourceUrl', () => {
      const delegate = createSceDelegate();
      const w = delegate.trustAs('resourceUrl', 'x');
      expect(w).toBeInstanceOf(TrustedResourceUrl);
      expect((w as TrustedResourceUrl).$$unwrapTrustedValue).toBe('x');
    });

    it('wraps a string for the js context as TrustedJs', () => {
      const delegate = createSceDelegate();
      const w = delegate.trustAs('js', 'x');
      expect(w).toBeInstanceOf(TrustedJs);
      expect((w as TrustedJs).$$unwrapTrustedValue).toBe('x');
    });

    it('wraps a string for the css context as TrustedCss', () => {
      const delegate = createSceDelegate();
      const w = delegate.trustAs('css', 'x');
      expect(w).toBeInstanceOf(TrustedCss);
      expect((w as TrustedCss).$$unwrapTrustedValue).toBe('x');
    });

    it('wraps a string for the $$ANY$$ pseudo-context as TrustedValueAny', () => {
      const delegate = createSceDelegate();
      // The $$ANY$$ pseudo-context is accepted at runtime by the delegate
      // but deliberately kept off the public SceContext union — the cast
      // here exercises the runtime escape hatch.
      const w = delegate.trustAs(SCE_CONTEXT_ANY as unknown as SceContext, 'x');
      expect(w).toBeInstanceOf(TrustedValueAny);
      expect(w).toBeInstanceOf(TrustedValue);
      expect((w as TrustedValueAny).$$unwrapTrustedValue).toBe('x');
    });
  });

  describe('trustAs — re-wrap', () => {
    it('re-wraps an already-trusted value for the new context, peeling the inner string', () => {
      const delegate = createSceDelegate();
      const inner = delegate.trustAs('html', 'x');
      const outer = delegate.trustAs('url', inner);
      expect(outer).toBeInstanceOf(TrustedUrl);
      expect(outer).not.toBeInstanceOf(TrustedHtml);
      expect((outer as TrustedUrl).$$unwrapTrustedValue).toBe('x');
    });
  });

  describe('trustAs — nullish pass-through', () => {
    it('returns null unchanged', () => {
      const delegate = createSceDelegate();
      expect(delegate.trustAs('html', null)).toBeNull();
    });

    it('returns undefined unchanged', () => {
      const delegate = createSceDelegate();
      expect(delegate.trustAs('html', undefined)).toBeUndefined();
    });
  });

  describe('trustAs — invalid input', () => {
    it('throws for a number input, mentioning "number" in the message', () => {
      const delegate = createSceDelegate();
      expect(() => delegate.trustAs('html', 42)).toThrow(/number/);
    });

    it('throws for a plain-object input, mentioning "object" in the message', () => {
      const delegate = createSceDelegate();
      expect(() => delegate.trustAs('html', {})).toThrow(/object/);
    });

    it('throws for a boolean input', () => {
      const delegate = createSceDelegate();
      expect(() => delegate.trustAs('html', true)).toThrow();
    });

    it('throws for an unknown context string, mentioning the context in the message', () => {
      const delegate = createSceDelegate();
      // Exercise the runtime-validation path: cast through `unknown` to
      // bypass the compile-time SceContext narrowing and feed a bogus ctx.
      expect(() => delegate.trustAs('bogus' as unknown as SceContext, 'x')).toThrow(/bogus/);
    });

    it('throws an Error instance (catchable via standard try/catch)', () => {
      const delegate = createSceDelegate();
      let caught: unknown;
      try {
        delegate.trustAs('html', 42);
      } catch (e: unknown) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
    });
  });

  describe('valueOf', () => {
    it('unwraps a trusted wrapper to its raw string', () => {
      const delegate = createSceDelegate();
      const w = delegate.trustAs('html', 'x');
      expect(delegate.valueOf(w)).toBe('x');
    });

    it('returns a plain string unchanged', () => {
      const delegate = createSceDelegate();
      expect(delegate.valueOf('plain')).toBe('plain');
    });

    it('returns null unchanged', () => {
      const delegate = createSceDelegate();
      expect(delegate.valueOf(null)).toBeNull();
    });

    it('returns undefined unchanged', () => {
      const delegate = createSceDelegate();
      expect(delegate.valueOf(undefined)).toBeUndefined();
    });

    it('returns a number unchanged', () => {
      const delegate = createSceDelegate();
      expect(delegate.valueOf(42)).toBe(42);
    });

    it('returns an object reference-equal to the input', () => {
      const delegate = createSceDelegate();
      const obj = { a: 1 };
      expect(delegate.valueOf(obj)).toBe(obj);
    });
  });

  describe('getTrusted — nullish pass-through', () => {
    it('returns null unchanged', () => {
      const delegate = createSceDelegate();
      expect(delegate.getTrusted('html', null)).toBeNull();
    });

    it('returns undefined unchanged', () => {
      const delegate = createSceDelegate();
      expect(delegate.getTrusted('html', undefined)).toBeUndefined();
    });
  });

  describe('getTrusted — context-matched wrapper', () => {
    it('returns the unwrapped string for a matching html wrapper', () => {
      const delegate = createSceDelegate();
      expect(delegate.getTrusted('html', delegate.trustAs('html', 'x'))).toBe('x');
    });

    it('returns the unwrapped string for a matching url wrapper', () => {
      const delegate = createSceDelegate();
      expect(delegate.getTrusted('url', delegate.trustAs('url', 'x'))).toBe('x');
    });

    it('returns the unwrapped string for a matching js wrapper', () => {
      const delegate = createSceDelegate();
      expect(delegate.getTrusted('js', delegate.trustAs('js', 'x'))).toBe('x');
    });

    it('returns the unwrapped string for a matching css wrapper', () => {
      const delegate = createSceDelegate();
      expect(delegate.getTrusted('css', delegate.trustAs('css', 'x'))).toBe('x');
    });

    it('unwraps a $$ANY$$ wrapper for the html context (escape hatch)', () => {
      const delegate = createSceDelegate();
      const any = delegate.trustAs(SCE_CONTEXT_ANY as unknown as SceContext, 'x');
      expect(delegate.getTrusted('html', any)).toBe('x');
    });

    it('unwraps a $$ANY$$ wrapper for every public context (escape hatch)', () => {
      const delegate = createSceDelegate();
      const any = delegate.trustAs(SCE_CONTEXT_ANY as unknown as SceContext, 'x');
      expect(delegate.getTrusted('html', any)).toBe('x');
      expect(delegate.getTrusted('url', any)).toBe('x');
      expect(delegate.getTrusted('js', any)).toBe('x');
      expect(delegate.getTrusted('css', any)).toBe('x');
    });
  });

  describe('getTrusted — context mismatch', () => {
    it('throws for a url wrapper requested as html, naming html and hinting at trustAsHtml', () => {
      const delegate = createSceDelegate();
      const urlWrapper = delegate.trustAs('url', 'x');
      expect(() => delegate.getTrusted('html', urlWrapper)).toThrow(/html/);
      expect(() => delegate.getTrusted('html', urlWrapper)).toThrow(/trustAsHtml/);
    });

    it('throws for an html wrapper requested as resourceUrl (falls through to list check and fails)', () => {
      // An html-wrapped value is NOT isTrustedFor('resourceUrl'), so the
      // delegate extracts the raw string and runs the list checks on it.
      // With an empty allow-list, nothing matches so the call throws.
      const delegate = createSceDelegate({ trustedResourceUrlList: [] });
      const htmlWrapper = delegate.trustAs('html', 'https://anything.com/x');
      expect(() => delegate.getTrusted('resourceUrl', htmlWrapper)).toThrow(/did not match/);
    });

    it('throws for a plain string requested as html', () => {
      const delegate = createSceDelegate();
      expect(() => delegate.getTrusted('html', 'plain')).toThrow();
    });

    it('throws for a number requested as html (non-string, non-wrapper input)', () => {
      const delegate = createSceDelegate();
      expect(() => delegate.getTrusted('html', 42)).toThrow();
    });

    it('throws an Error instance', () => {
      const delegate = createSceDelegate();
      let caught: unknown;
      try {
        delegate.getTrusted('html', 'plain');
      } catch (e: unknown) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
    });
  });

  describe("getTrusted — 'url' context pass-through", () => {
    it('returns a plain http URL unchanged', () => {
      const delegate = createSceDelegate();
      expect(delegate.getTrusted('url', 'http://example.com')).toBe('http://example.com');
    });

    it('returns a plain relative path unchanged (any string is trusted for url)', () => {
      const delegate = createSceDelegate();
      expect(delegate.getTrusted('url', '/relative/path')).toBe('/relative/path');
    });

    it('throws when a wrapper of a non-url context is passed', () => {
      const delegate = createSceDelegate();
      const htmlWrapper = delegate.trustAs('html', 'x');
      expect(() => delegate.getTrusted('url', htmlWrapper)).toThrow();
    });

    it('unwraps a properly wrapped url value', () => {
      const delegate = createSceDelegate();
      expect(delegate.getTrusted('url', delegate.trustAs('url', 'x'))).toBe('x');
    });

    it('unwraps a TrustedResourceUrl for the url context (subtype)', () => {
      const delegate = createSceDelegate();
      expect(delegate.getTrusted('url', delegate.trustAs('resourceUrl', 'x'))).toBe('x');
    });
  });

  describe("getTrusted — 'resourceUrl' context", () => {
    describe('explicit allow-list, no block-list', () => {
      it('returns the URL when it matches the allow-list', () => {
        const delegate = createSceDelegate({
          trustedResourceUrlList: ['https://api.example.com/**'],
        });
        expect(delegate.getTrusted('resourceUrl', 'https://api.example.com/v1/users')).toBe(
          'https://api.example.com/v1/users',
        );
      });

      it('throws with a "did not match" message when the URL is outside the allow-list', () => {
        const delegate = createSceDelegate({
          trustedResourceUrlList: ['https://api.example.com/**'],
        });
        expect(() => delegate.getTrusted('resourceUrl', 'https://evil.com/x')).toThrow(/did not match/);
        expect(() => delegate.getTrusted('resourceUrl', 'https://evil.com/x')).toThrow(/https:\/\/evil\.com\/x/);
      });

      it('accepts a trusted resourceUrl wrapper and bypasses the allow-list', () => {
        const delegate = createSceDelegate({
          trustedResourceUrlList: ['https://api.example.com/**'],
        });
        expect(delegate.getTrusted('resourceUrl', delegate.trustAs('resourceUrl', 'https://anything.com/x'))).toBe(
          'https://anything.com/x',
        );
      });

      it('accepts a $$ANY$$ wrapper and bypasses the allow-list', () => {
        const delegate = createSceDelegate({
          trustedResourceUrlList: ['https://api.example.com/**'],
        });
        const any = delegate.trustAs(SCE_CONTEXT_ANY as unknown as SceContext, 'https://anything.com/x');
        expect(delegate.getTrusted('resourceUrl', any)).toBe('https://anything.com/x');
      });
    });

    describe('allow-list with block-list', () => {
      it('returns the URL when it matches the allow-list and not the block-list', () => {
        const delegate = createSceDelegate({
          trustedResourceUrlList: ['https://**'],
          bannedResourceUrlList: ['https://evil.com/**'],
        });
        expect(delegate.getTrusted('resourceUrl', 'https://good.com/x')).toBe('https://good.com/x');
      });

      it('throws with a "banned" message when the URL matches the block-list (block precedence)', () => {
        const delegate = createSceDelegate({
          trustedResourceUrlList: ['https://**'],
          bannedResourceUrlList: ['https://evil.com/**'],
        });
        expect(() => delegate.getTrusted('resourceUrl', 'https://evil.com/x')).toThrow(/banned/);
        expect(() => delegate.getTrusted('resourceUrl', 'https://evil.com/x')).toThrow(/https:\/\/evil\.com\/x/);
      });
    });

    describe('empty allow-list', () => {
      it('throws for any plain URL — empty allow-list matches nothing', () => {
        const delegate = createSceDelegate({ trustedResourceUrlList: [] });
        expect(() => delegate.getTrusted('resourceUrl', 'https://api.example.com/x')).toThrow(/did not match/);
      });

      it('still accepts an explicit resourceUrl wrapper', () => {
        const delegate = createSceDelegate({ trustedResourceUrlList: [] });
        expect(delegate.getTrusted('resourceUrl', delegate.trustAs('resourceUrl', 'https://api.example.com/x'))).toBe(
          'https://api.example.com/x',
        );
      });
    });

    describe("defaults (['self'])", () => {
      it('accepts a same-origin relative URL under jsdom', () => {
        const delegate = createSceDelegate();
        expect(delegate.getTrusted('resourceUrl', '/x')).toBe('/x');
      });
    });
  });

  describe('AngularJS parity — upstream sceSpecs.js scenarios', () => {
    // AngularJS parity: sceSpecs.js — "should NOT unwrap values that had
    // not been wrapped". A foreign object that superficially looks like a
    // trust wrapper (owns `$unwrapTrustedValue`) must NOT be accepted —
    // only `instanceof TrustedValue` counts.
    it('rejects a foreign wrapper-shaped object that is not a TrustedValue instance', () => {
      const delegate = createSceDelegate();
      // Duck-typed shape — never an `instanceof TrustedValue`.
      const fake = { $$unwrapTrustedValue: 'originalValue' };
      expect(() => delegate.getTrusted('html', fake)).toThrow();
    });

    // AngularJS parity: sceSpecs.js — "should have the banned resource URL
    // list override the trusted resource URL list" using 'self' as the
    // block entry. Same-origin URL rejected even though allow-list also
    // contains 'self' (block precedence).
    it("block-list containing 'self' rejects same-origin URLs even when allow-list also has 'self'", () => {
      const delegate = createSceDelegate({
        trustedResourceUrlList: ['self'],
        bannedResourceUrlList: ['self'],
      });
      expect(() => delegate.getTrusted('resourceUrl', '/relative')).toThrow(/banned/);
    });

    // AngularJS parity: sceSpecs.js — "should support multiple items in
    // both lists". Integration test that combines regex, 'self', and
    // block-list regex entries.
    it('multiple items in allow-list and block-list: regex + self, with block precedence', () => {
      const delegate = createSceDelegate({
        trustedResourceUrlList: [
          /^http:\/\/example\.com\/1$/,
          /^http:\/\/example\.com\/2$/,
          /^http:\/\/example\.com\/3$/,
          'self',
        ],
        bannedResourceUrlList: [/^http:\/\/example\.com\/3$/, /.*\/open_redirect/],
      });
      expect(delegate.getTrusted('resourceUrl', '/same_domain')).toBe('/same_domain');
      expect(delegate.getTrusted('resourceUrl', 'http://example.com/1')).toBe('http://example.com/1');
      expect(delegate.getTrusted('resourceUrl', 'http://example.com/2')).toBe('http://example.com/2');
      // Matches allow AND block — block wins.
      expect(() => delegate.getTrusted('resourceUrl', 'http://example.com/3')).toThrow(/banned/);
      // Matches 'self' for allow, but open_redirect regex on block-list blocks it.
      expect(() => delegate.getTrusted('resourceUrl', '/open_redirect')).toThrow(/banned/);
    });

    // AngularJS parity: sceSpecs.js — "should support strings as matchers".
    // A literal string pattern treats '.' as a literal, so the hyphen-host
    // form must not match.
    it('string pattern treats "." as a literal character, not regex any-char', () => {
      const delegate = createSceDelegate({ trustedResourceUrlList: ['http://example.com/foo'] });
      expect(delegate.getTrusted('resourceUrl', 'http://example.com/foo')).toBe('http://example.com/foo');
      expect(() => delegate.getTrusted('resourceUrl', 'http://example-com/foo')).toThrow(/did not match/);
    });
  });
});
