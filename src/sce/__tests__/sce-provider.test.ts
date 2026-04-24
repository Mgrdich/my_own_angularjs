import { describe, expect, it } from 'vitest';

import { $SceProvider } from '@sce/sce-provider';
import { TrustedHtml } from '@sce/trusted-values';
import type { SceDelegateService, SceService } from '@sce/sce-types';

/**
 * Minimal `$sceDelegate` stub for exercising `$SceProvider.$get`. Only the
 * three method slots are required — the façade produced by `createSce` calls
 * through to these when strict mode is ON, and short-circuits `trustAs` /
 * `getTrusted` when strict mode is OFF.
 */
function makeStubDelegate(): SceDelegateService {
  return {
    trustAs: (_ctx, value) => new TrustedHtml(String(value)),
    getTrusted: (_ctx, value) => (value instanceof TrustedHtml ? value.$$unwrapTrustedValue : value),
    valueOf: (value) => (value instanceof TrustedHtml ? value.$$unwrapTrustedValue : value),
  };
}

describe('$SceProvider — Slice 5 (config-phase configurator)', () => {
  describe('default state', () => {
    it('enabled() returns true by default', () => {
      const provider = new $SceProvider();
      expect(provider.enabled()).toBe(true);
    });
  });

  describe('fluent setter', () => {
    it('enabled(false) returns the provider for chaining', () => {
      const provider = new $SceProvider();
      expect(provider.enabled(false)).toBe(provider);
    });

    it('enabled(true) returns the provider for chaining', () => {
      const provider = new $SceProvider();
      expect(provider.enabled(true)).toBe(provider);
    });

    it('after enabled(false), getter returns false', () => {
      const provider = new $SceProvider();
      provider.enabled(false);
      expect(provider.enabled()).toBe(false);
    });

    it('after enabled(true), getter returns true again', () => {
      const provider = new $SceProvider();
      provider.enabled(false);
      provider.enabled(true);
      expect(provider.enabled()).toBe(true);
    });
  });

  describe('setter validation', () => {
    it("throws on a string argument, message names 'string'", () => {
      const provider = new $SceProvider();
      expect(() =>
        provider.enabled(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- exercising runtime validation path with an invalid argument type
          'true' as any,
        ),
      ).toThrow(/\$sceProvider\.enabled: value must be a boolean, got string/);
    });

    it("throws on a numeric argument, message names 'number'", () => {
      const provider = new $SceProvider();
      expect(() =>
        provider.enabled(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- exercising runtime validation path with an invalid argument type
          1 as any,
        ),
      ).toThrow(/\$sceProvider\.enabled: value must be a boolean, got number/);
    });

    it('throws on a null argument', () => {
      const provider = new $SceProvider();
      expect(() =>
        provider.enabled(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- exercising runtime validation path with an invalid argument type
          null as any,
        ),
      ).toThrow(/value must be a boolean/);
    });

    it('enabled(undefined) routes to the no-arg getter branch (does not throw)', () => {
      const provider = new $SceProvider();
      // Both a TS-typed caller writing `.enabled()` and a JavaScript caller
      // writing `.enabled(undefined)` reach the same no-arg branch via the
      // `value?: boolean` overload — documented here as the intended
      // fall-through behavior. The overload signatures deliberately do
      // not surface `undefined` as a valid setter argument, so the cast
      // below simulates a JavaScript caller slipping past type safety.
      expect(
        provider.enabled(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- exercising the JS-caller path where `undefined` slips past the type system
          undefined as any,
        ),
      ).toBe(true);
      provider.enabled(false);
      expect(
        provider.enabled(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- exercising the JS-caller path where `undefined` slips past the type system
          undefined as any,
        ),
      ).toBe(false);
    });
  });

  describe('$get factory', () => {
    it('$get is a readonly array-style invokable with exactly one dep ($sceDelegate)', () => {
      const provider = new $SceProvider();
      expect(provider.$get).toHaveLength(2);
      expect(provider.$get[0]).toBe('$sceDelegate');
      expect(provider.$get[1]).toBeTypeOf('function');
    });

    it('produces a SceService with isEnabled() reflecting the default flag (true)', () => {
      const provider = new $SceProvider();
      const factory = provider.$get[1];
      const service: SceService = factory(makeStubDelegate());
      expect(service.isEnabled()).toBe(true);
    });

    it('produces a pass-through SceService when enabled(false) was called', () => {
      const provider = new $SceProvider();
      provider.enabled(false);
      const factory = provider.$get[1];
      const service: SceService = factory(makeStubDelegate());
      expect(service.isEnabled()).toBe(false);
      // Under pass-through, trustAs returns the input unchanged (no wrapper).
      expect(service.trustAs('html', 'x')).toBe('x');
      expect(service.trustAsHtml('x')).toBe('x');
    });

    it('flipping enabled between drains produces services with independent captured flags', () => {
      const provider = new $SceProvider();

      provider.enabled(true);
      const on = provider.$get[1](makeStubDelegate());

      provider.enabled(false);
      const off = provider.$get[1](makeStubDelegate());

      expect(on.isEnabled()).toBe(true);
      expect(off.isEnabled()).toBe(false);
    });
  });
});
