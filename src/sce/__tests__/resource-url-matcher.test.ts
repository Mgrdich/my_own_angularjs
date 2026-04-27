import { describe, expect, it } from 'vitest';

import { compileMatchers, isSameOrigin, matches, type CompiledMatcher } from '@sce/resource-url-matcher';
import type { ResourceUrlListEntry } from '@sce/sce-types';

describe('compileMatchers', () => {
  it('returns an empty array for an empty list', () => {
    expect(compileMatchers([])).toEqual([]);
  });

  it("produces a 'self' matcher for the literal string 'self'", () => {
    const compiled = compileMatchers(['self']);
    expect(compiled).toHaveLength(1);
    expect(compiled[0]).toEqual({ kind: 'self' });
  });

  it('reuses a user-supplied RegExp as-is (no clone)', () => {
    const userRegex = /^https:\/\/api\./;
    const compiled = compileMatchers([userRegex]);
    expect(compiled).toHaveLength(1);
    const first = compiled[0];
    expect(first?.kind).toBe('regex');
    if (first?.kind === 'regex') {
      expect(first.pattern).toBe(userRegex);
    }
  });

  it('compiles a string pattern into a regex matcher (different identity from input)', () => {
    const compiled = compileMatchers(['https://api.example.com/**']);
    const first = compiled[0];
    expect(first?.kind).toBe('regex');
  });

  it('returns a fresh array (callers may mutate without touching input)', () => {
    const input: ResourceUrlListEntry[] = ['self'];
    const out = compileMatchers(input);
    expect(out).not.toBe(input as unknown as CompiledMatcher[]);
    out.push({ kind: 'self' });
    expect(input).toHaveLength(1);
  });

  it('does not mutate the caller input array', () => {
    const input: ResourceUrlListEntry[] = ['self', 'https://api.example.com/**'];
    const copy = [...input];
    compileMatchers(input);
    expect(input).toEqual(copy);
  });

  it('throws on a number entry with a descriptive message', () => {
    expect(() =>
      compileMatchers([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising runtime validation from outside the type system
        42 as any,
      ]),
    ).toThrow(/invalid list entry.*number/i);
  });

  it('throws on a plain-object entry', () => {
    expect(() =>
      compileMatchers([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising runtime validation from outside the type system
        {} as any,
      ]),
    ).toThrow(/invalid list entry.*object/i);
  });

  it('throws on a boolean entry', () => {
    expect(() =>
      compileMatchers([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising runtime validation from outside the type system
        true as any,
      ]),
    ).toThrow(/invalid list entry.*boolean/i);
  });

  it('throws on null', () => {
    expect(() =>
      compileMatchers([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising runtime validation from outside the type system
        null as any,
      ]),
    ).toThrow(/invalid list entry/i);
  });
});

describe('compileMatchers — string pattern compilation + matches()', () => {
  it('"**" matches across slashes', () => {
    const compiled = compileMatchers(['https://api.example.com/**']);
    expect(matches('https://api.example.com/v1/users', compiled)).toBe(true);
  });

  it('"**" matches zero characters (trailing empty segment)', () => {
    const compiled = compileMatchers(['https://api.example.com/**']);
    expect(matches('https://api.example.com/', compiled)).toBe(true);
  });

  it('"*" does NOT cross slashes (single-segment wildcard)', () => {
    const compiled = compileMatchers(['https://api.example.com/*']);
    expect(matches('https://api.example.com/users', compiled)).toBe(true);
    expect(matches('https://api.example.com/v1/users', compiled)).toBe(false);
  });

  it('"*" does cross dots within a hostname segment (AngularJS parity — only ":/?#" block it)', () => {
    const compiled = compileMatchers(['https://*.example.com/x']);
    expect(matches('https://foo.bar.example.com/x', compiled)).toBe(true);
  });

  it('"*" matches a single hostname segment', () => {
    const compiled = compileMatchers(['https://api.*.com/x']);
    expect(matches('https://api.my.com/x', compiled)).toBe(true);
  });

  it('escapes regex metacharacters in string patterns (dot is literal, not "any char")', () => {
    const compiled = compileMatchers(['https://example.com/a.b']);
    expect(matches('https://example.com/a.b', compiled)).toBe(true);
    expect(matches('https://example.com/aXb', compiled)).toBe(false);
  });

  it('anchors patterns so a longer URL with the same prefix does not match', () => {
    const compiled = compileMatchers(['https://example.com/x']);
    expect(matches('https://example.com/x', compiled)).toBe(true);
    expect(matches('https://example.com/x/y', compiled)).toBe(false);
  });

  it('anchors patterns at the start (prefix-only URLs do not match)', () => {
    const compiled = compileMatchers(['https://example.com/x']);
    expect(matches('evil.comhttps://example.com/x', compiled)).toBe(false);
  });
});

describe("matches — 'self' semantics (jsdom default base http://localhost:3000/)", () => {
  it('matches a relative URL against the document.baseURI when no baseUrl is passed', () => {
    const compiled = compileMatchers(['self']);
    expect(matches('/relative/path', compiled)).toBe(true);
  });

  it('matches a same-origin absolute URL with an explicit baseUrl', () => {
    const compiled = compileMatchers(['self']);
    expect(matches('http://localhost/x', compiled, 'http://localhost/')).toBe(true);
  });

  it('matches a relative path against an explicit baseUrl', () => {
    const compiled = compileMatchers(['self']);
    expect(matches('/relative/path', compiled, 'http://localhost/')).toBe(true);
  });

  it('rejects a cross-origin absolute URL', () => {
    const compiled = compileMatchers(['self']);
    expect(matches('http://other.com/x', compiled, 'http://localhost/')).toBe(false);
  });

  it('rejects a protocol-relative URL pointing at a different host', () => {
    const compiled = compileMatchers(['self']);
    expect(matches('//other.com/x', compiled, 'http://localhost/')).toBe(false);
  });

  it('accepts a protocol-relative URL pointing at the same host', () => {
    const compiled = compileMatchers(['self']);
    expect(matches('//localhost/x', compiled, 'http://localhost/')).toBe(true);
  });

  it('rejects a URL that fails to parse (does not throw)', () => {
    const compiled = compileMatchers(['self']);
    // An unterminated IPv6 bracket is one of the few inputs the whatwg URL
    // parser rejects even when given an absolute base URL.
    expect(() => matches('http://[invalid', compiled, 'http://localhost/')).not.toThrow();
    expect(matches('http://[invalid', compiled, 'http://localhost/')).toBe(false);
  });

  it('returns false when the given baseUrl itself is invalid', () => {
    const compiled = compileMatchers(['self']);
    expect(matches('http://localhost/x', compiled, 'not a valid base')).toBe(false);
  });

  it('differentiates ports (same host, different port, not same-origin)', () => {
    const compiled = compileMatchers(['self']);
    expect(matches('http://localhost:8080/x', compiled, 'http://localhost:3000/')).toBe(false);
  });

  it('differentiates protocols (http vs https is cross-origin)', () => {
    const compiled = compileMatchers(['self']);
    expect(matches('https://localhost/x', compiled, 'http://localhost/')).toBe(false);
  });
});

describe('matches — RegExp entries', () => {
  it('tests the user RegExp against the full URL string', () => {
    const compiled = compileMatchers([/^https:\/\/api\./]);
    expect(matches('https://api.x.com/y', compiled)).toBe(true);
  });

  it('does not anchor a user RegExp beyond what the user wrote', () => {
    // Unanchored regex — matches anywhere in the URL.
    const compiled = compileMatchers([/api\.x/]);
    expect(matches('https://something.api.x.com/y', compiled)).toBe(true);
  });

  it('rejects a URL that does not match the user regex', () => {
    const compiled = compileMatchers([/^https:\/\/api\./]);
    expect(matches('http://api.x.com/y', compiled)).toBe(false);
  });
});

describe('matches — empty / mixed lists', () => {
  it('returns false for any URL when the matcher list is empty', () => {
    expect(matches('http://anywhere.com/x', [])).toBe(false);
    expect(matches('http://anywhere.com/x', [], 'http://localhost/')).toBe(false);
  });

  it('returns true as soon as any matcher matches (short-circuit)', () => {
    const compiled = compileMatchers([/never-matches/, 'https://api.example.com/**']);
    expect(matches('https://api.example.com/v1/users', compiled)).toBe(true);
  });

  it('returns false when no matcher matches in a mixed list', () => {
    const compiled = compileMatchers([/never-matches/, 'https://api.example.com/**']);
    expect(matches('https://other.com/v1/users', compiled)).toBe(false);
  });
});

describe('compileMatchers — idempotence', () => {
  it('compiling the same list twice yields matchers that accept the same URLs', () => {
    const list: ResourceUrlListEntry[] = ['self', 'https://api.example.com/**', /^https:\/\/cdn\./];
    const a = compileMatchers(list);
    const b = compileMatchers(list);
    const samples = [
      '/relative/path',
      'https://api.example.com/v1/users',
      'https://cdn.example.com/assets/x.js',
      'https://other.com/x',
    ];
    for (const url of samples) {
      expect(matches(url, a, 'http://localhost/')).toBe(matches(url, b, 'http://localhost/'));
    }
  });
});

describe('isSameOrigin', () => {
  it('returns true for identical origins', () => {
    expect(isSameOrigin('http://localhost/x', 'http://localhost/')).toBe(true);
  });

  it('returns true when comparing a resolved relative URL to its base', () => {
    expect(isSameOrigin(new URL('/x', 'http://localhost/').href, 'http://localhost/')).toBe(true);
  });

  it('returns false for different hosts', () => {
    expect(isSameOrigin('http://other.com/x', 'http://localhost/')).toBe(false);
  });

  it('returns false for different protocols (http vs https)', () => {
    expect(isSameOrigin('https://localhost/x', 'http://localhost/')).toBe(false);
  });

  it('returns false for different explicit ports', () => {
    expect(isSameOrigin('http://localhost:8080/x', 'http://localhost:3000/')).toBe(false);
  });

  it('normalizes default ports (http://host:80 vs http://host is same-origin)', () => {
    expect(isSameOrigin('http://localhost:80/x', 'http://localhost/')).toBe(true);
  });

  it('returns false for an unparseable URL', () => {
    // Unterminated IPv6 bracket — one of the few inputs whatwg URL rejects
    // even with a base URL.
    expect(isSameOrigin('http://[invalid', 'http://localhost/')).toBe(false);
  });

  it('returns false for an unparseable base URL', () => {
    expect(isSameOrigin('http://localhost/x', 'not a base')).toBe(false);
  });
});
