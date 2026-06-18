/**
 * Unit tests for the compiler-level `sanitizeUri` helper (spec 034
 * Slice 2 / technical-considerations §2.2).
 *
 * `sanitizeUri(uri, isMediaUrl, pattern)` is a pure function: it returns
 * the URI unchanged when it matches `pattern`, else prefixes it with
 * `unsafe:`. These tests exercise the function in isolation against the
 * two AngularJS-standard default patterns (mirrored here so the unit
 * test stays decoupled from the provider's internal field values — the
 * integration test in `sanitize-uri-integration.test.ts` proves the
 * provider actually wires these defaults).
 */

import { describe, expect, it } from 'vitest';

import { sanitizeUri } from '@compiler/sanitize-uri';

// Mirrors `DEFAULT_A_HREF_SANITIZATION_TRUSTED_URL_LIST` in
// `compile-provider.ts` — known-safe schemes + relative URLs.
const A_HREF_PATTERN = /^\s*(https?|s?ftp|mailto|tel|sms|file):|^\s*[^:/?#]*(?:[/?#]|$)/i;

// Mirrors `DEFAULT_IMG_SRC_SANITIZATION_TRUSTED_URL_LIST` in
// `compile-provider.ts` — known-safe fetch schemes + data:image/ +
// relative URLs.
const IMG_SRC_PATTERN = /^\s*((https?|ftp|file|blob):|data:image\/)|^\s*[^:/?#]*(?:[/?#]|$)/i;

describe('sanitizeUri (pure helper)', () => {
  describe('href (link) default pattern', () => {
    it.each([
      ['https://example.com/path', true],
      ['http://example.com', true],
      ['ftp://files.example.com/x', true],
      ['mailto:user@example.com', true],
      ['tel:+15551234567', true],
      ['/relative/path', true],
      ['relative/path', true],
      ['#fragment', true],
      ['?query=1', true],
      ['', true],
      ['javascript:alert(1)', false],
      ['JavaScript:alert(1)', false],
      ['vbscript:msgbox(1)', false],
      ['data:text/html,<script>alert(1)</script>', false],
    ])('classifies %s (safe=%s)', (uri, safe) => {
      const result = sanitizeUri(uri, false, A_HREF_PATTERN);
      if (safe) {
        expect(result).toBe(uri);
      } else {
        expect(result).toBe(`unsafe:${uri}`);
      }
    });
  });

  describe('img (media) default pattern', () => {
    it.each([
      ['https://cdn.example.com/a.png', true],
      ['http://cdn.example.com/a.png', true],
      ['ftp://files.example.com/a.png', true],
      ['blob:https://example.com/uuid', true],
      ['data:image/png;base64,AAAA', true],
      ['data:image/svg+xml;utf8,<svg/>', true],
      ['/images/a.png', true],
      ['relative.png', true],
      ['data:text/html,<script>alert(1)</script>', false],
      ['javascript:alert(1)', false],
    ])('classifies %s (safe=%s)', (uri, safe) => {
      const result = sanitizeUri(uri, true, IMG_SRC_PATTERN);
      if (safe) {
        expect(result).toBe(uri);
      } else {
        expect(result).toBe(`unsafe:${uri}`);
      }
    });
  });

  describe('contract', () => {
    it('returns the URI unchanged on a match', () => {
      expect(sanitizeUri('https://ok', false, /^https:/)).toBe('https://ok');
    });

    it('prefixes a non-match with exactly one "unsafe:"', () => {
      expect(sanitizeUri('javascript:x', false, /^https:/)).toBe('unsafe:javascript:x');
    });

    it('ignores the isMediaUrl flag (caller resolves the pattern)', () => {
      // The same URI + same pattern yields the same result regardless of
      // the informational `isMediaUrl` argument.
      const pattern = /^https:/;
      expect(sanitizeUri('https://ok', false, pattern)).toBe(sanitizeUri('https://ok', true, pattern));
      expect(sanitizeUri('ftp://no', false, pattern)).toBe(sanitizeUri('ftp://no', true, pattern));
    });

    it('does not mutate its arguments', () => {
      const uri = 'javascript:x';
      const pattern = /^https:/;
      sanitizeUri(uri, false, pattern);
      expect(uri).toBe('javascript:x');
      expect(pattern.source).toBe('^https:');
    });
  });
});
