import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_URI_PATTERN } from '@sanitize/sanitize-allow-lists';
import { $SanitizeProvider } from '@sanitize/sanitize-provider';
import type { SanitizeService } from '@sanitize/sanitize-types';

/**
 * Drains the provider's `$get` invokable to obtain the configured service.
 * The shape is a readonly tuple `[() => SanitizeService]` — destructure to
 * avoid tuple-narrowing friction at the call site.
 */
function drain(provider: $SanitizeProvider): SanitizeService {
  const [factory] = provider.$get;
  return factory();
}

describe('$SanitizeProvider — Slice 4 (config-phase configurator)', () => {
  let provider: $SanitizeProvider;

  beforeEach(() => {
    provider = new $SanitizeProvider();
  });

  describe('defaults', () => {
    it('enableSvg() defaults to false', () => {
      expect(provider.enableSvg()).toBe(false);
    });

    it('uriPattern() returns DEFAULT_URI_PATTERN by reference', () => {
      // The provider stores the default pattern directly (no defensive clone),
      // so the getter must return the very same RegExp instance.
      expect(provider.uriPattern()).toBe(DEFAULT_URI_PATTERN);
    });

    it('uriPattern() return value matches the default source/flags', () => {
      const pattern = provider.uriPattern();
      expect(pattern.source).toBe(DEFAULT_URI_PATTERN.source);
      expect(pattern.flags).toBe(DEFAULT_URI_PATTERN.flags);
    });

    it('$get drains to a service that strips <script> and its content (default behaviour)', () => {
      const service = drain(provider);
      expect(service('<script>x</script>y')).toBe('y');
    });

    it('$get drains to a service that strips <svg> by default (SVG opt-in is off)', () => {
      const service = drain(provider);
      expect(service('<svg></svg>')).toBe('');
    });
  });

  describe('fluent chaining', () => {
    it('addValidElements returns the provider', () => {
      expect(provider.addValidElements(['x'])).toBe(provider);
    });

    it('addValidAttrs returns the provider', () => {
      expect(provider.addValidAttrs(['y'])).toBe(provider);
    });

    it('enableSvg(boolean) returns the provider', () => {
      expect(provider.enableSvg(true)).toBe(provider);
    });

    it('uriPattern(regex) returns the provider', () => {
      expect(provider.uriPattern(/^myapp:/)).toBe(provider);
    });

    it('a chain of all four setters returns the same provider instance', () => {
      const result = provider
        .addValidElements(['x'])
        .addValidAttrs(['y'])
        .enableSvg(true)
        .uriPattern(/^myapp:/);
      expect(result).toBe(provider);
    });
  });

  describe('addValidElements — setter validation', () => {
    it('throws on a numeric argument', () => {
      expect(() =>
        provider.addValidElements(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- exercising runtime validation path with an invalid argument type
          42 as any,
        ),
      ).toThrow(/^\$sanitizeProvider\.addValidElements:/);
    });

    it('throws on an array containing a non-string entry', () => {
      expect(() =>
        provider.addValidElements(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- exercising runtime validation path with an invalid array entry
          [42] as any,
        ),
      ).toThrow(/^\$sanitizeProvider\.addValidElements:/);
    });

    it('throws on an array containing an empty string entry', () => {
      expect(() => provider.addValidElements([''])).toThrow(/^\$sanitizeProvider\.addValidElements:/);
    });

    it('throws on a bucketed object whose htmlElements bucket has a non-string entry', () => {
      expect(() =>
        provider.addValidElements(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- exercising runtime validation path with an invalid bucket entry
          { htmlElements: [42] } as any,
        ),
      ).toThrow(/^\$sanitizeProvider\.addValidElements:/);
    });

    it('throws on an empty bare string', () => {
      expect(() => provider.addValidElements('')).toThrow(/^\$sanitizeProvider\.addValidElements:/);
    });
  });

  describe('addValidAttrs — setter validation', () => {
    it('throws on a null argument', () => {
      expect(() =>
        provider.addValidAttrs(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- exercising runtime validation path with a non-array argument
          null as any,
        ),
      ).toThrow(/^\$sanitizeProvider\.addValidAttrs:/);
    });

    it('throws on an array containing a non-string entry', () => {
      expect(() =>
        provider.addValidAttrs(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- exercising runtime validation path with an invalid array entry
          [42] as any,
        ),
      ).toThrow(/^\$sanitizeProvider\.addValidAttrs:/);
    });

    it('throws on an array containing an empty string entry', () => {
      expect(() => provider.addValidAttrs([''])).toThrow(/^\$sanitizeProvider\.addValidAttrs:/);
    });
  });

  describe('enableSvg — setter validation', () => {
    it("throws on a string argument, message names 'string'", () => {
      expect(() =>
        provider.enableSvg(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- exercising runtime validation path with an invalid argument type
          'true' as any,
        ),
      ).toThrow(/^\$sanitizeProvider\.enableSvg:.*string/);
    });

    it("throws on a numeric argument, message names 'number'", () => {
      expect(() =>
        provider.enableSvg(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- exercising runtime validation path with an invalid argument type
          1 as any,
        ),
      ).toThrow(/^\$sanitizeProvider\.enableSvg:.*number/);
    });

    it('throws on a null argument (typeof null === "object", not boolean)', () => {
      expect(() =>
        provider.enableSvg(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- exercising runtime validation path with a non-boolean object argument
          null as any,
        ),
      ).toThrow(/^\$sanitizeProvider\.enableSvg:/);
    });
  });

  describe('uriPattern — setter validation', () => {
    it('throws on a plain string argument', () => {
      expect(() =>
        provider.uriPattern(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- exercising runtime validation path with an invalid argument type
          'not regex' as any,
        ),
      ).toThrow(/^\$sanitizeProvider\.uriPattern:/);
    });

    it('throws when a string snapshot of a RegExp source is passed (still a string)', () => {
      expect(() =>
        provider.uriPattern(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- exercising runtime validation path with an invalid argument type
          /abc/.source as any,
        ),
      ).toThrow(/^\$sanitizeProvider\.uriPattern:/);
    });

    it('throws on a plain object', () => {
      expect(() =>
        provider.uriPattern(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- exercising runtime validation path with a non-RegExp object
          {} as any,
        ),
      ).toThrow(/^\$sanitizeProvider\.uriPattern:/);
    });
  });

  describe('idempotent calls (Set semantics — duplicates collapse)', () => {
    it('addValidElements(["x"]) called twice still produces a single <x> in output', () => {
      provider.addValidElements(['x']).addValidElements(['x']);
      const service = drain(provider);
      expect(service('<x>hi</x>')).toBe('<x>hi</x>');
    });

    it('addValidAttrs(["data-test"]) called twice still preserves the attribute exactly once', () => {
      provider.addValidAttrs(['data-test']).addValidAttrs(['data-test']);
      const service = drain(provider);
      const result = service('<a data-test="1" href="https://x">y</a>');
      // The attribute should appear exactly once in the output.
      const occurrences = result.match(/data-test="1"/g) ?? [];
      expect(occurrences).toHaveLength(1);
    });
  });

  describe('$get produces a service that respects configured extras', () => {
    it('addValidElements(["my-tag"]) is honoured by the produced service', () => {
      provider.addValidElements(['my-tag']);
      const service = drain(provider);
      expect(service('<my-tag>x</my-tag>')).toBe('<my-tag>x</my-tag>');
    });

    it('bucketed addValidElements({ htmlElements: ["my-tag"] }) is honoured', () => {
      provider.addValidElements({ htmlElements: ['my-tag'] });
      const service = drain(provider);
      expect(service('<my-tag>x</my-tag>')).toBe('<my-tag>x</my-tag>');
    });

    it('addValidAttrs(["data-test"]) keeps the custom attr alongside an allowed href', () => {
      provider.addValidAttrs(['data-test']);
      const service = drain(provider);
      const result = service('<a data-test="1" href="https://x">y</a>');
      expect(result).toContain('data-test="1"');
      expect(result).toContain('href="https://x"');
      expect(result).toContain('y');
    });

    it('enableSvg(true) lets the produced service pass <svg> through', () => {
      provider.enableSvg(true);
      const service = drain(provider);
      const result = service('<svg></svg>');
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('svg');
    });

    it('uriPattern(/^myapp:/) drops https:// hrefs but keeps myapp: hrefs', () => {
      provider.uriPattern(/^myapp:/);
      const service = drain(provider);
      // myapp: href survives.
      expect(service('<a href="myapp:profile">x</a>')).toBe('<a href="myapp:profile">x</a>');
      // https:// no longer matches the replaced pattern, so the href is stripped.
      expect(service('<a href="https://x">y</a>')).toBe('<a>y</a>');
    });
  });

  describe('getter overload behaviour', () => {
    it('enableSvg() returns the current boolean before and after a setter call', () => {
      expect(provider.enableSvg()).toBe(false);
      provider.enableSvg(true);
      expect(provider.enableSvg()).toBe(true);
      provider.enableSvg(false);
      expect(provider.enableSvg()).toBe(false);
    });

    it('uriPattern() returns the current pattern before and after a setter call', () => {
      expect(provider.uriPattern()).toBe(DEFAULT_URI_PATTERN);
      const custom = /^myapp:/;
      provider.uriPattern(custom);
      expect(provider.uriPattern()).toBe(custom);
    });

    it('enableSvg(undefined) reaches the getter branch (does not throw)', () => {
      // A JavaScript caller passing `undefined` slips past the typed overload
      // and hits the same no-arg branch as `enableSvg()`. Documented here as
      // the intended fall-through.
      expect(
        provider.enableSvg(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- exercising the JS-caller path where `undefined` slips past the type system
          undefined as any,
        ),
      ).toBe(false);
      provider.enableSvg(true);
      expect(
        provider.enableSvg(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- exercising the JS-caller path where `undefined` slips past the type system
          undefined as any,
        ),
      ).toBe(true);
    });

    it('uriPattern(undefined) reaches the getter branch (does not throw)', () => {
      // Same JS-caller fall-through contract as `enableSvg(undefined)`.
      expect(
        provider.uriPattern(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- exercising the JS-caller path where `undefined` slips past the type system
          undefined as any,
        ),
      ).toBe(DEFAULT_URI_PATTERN);
    });
  });
});
