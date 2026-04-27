import { describe, expect, it } from 'vitest';

import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import type { ResourceUrlListEntry, SceDelegateService } from '@sce/sce-types';
import { TrustedResourceUrl } from '@sce/trusted-values';

describe('$SceDelegateProvider — Slice 5 (config-phase configurator)', () => {
  describe('default lists', () => {
    it("returns ['self'] as the default trusted resource-URL allow-list", () => {
      const provider = new $SceDelegateProvider();
      expect(provider.trustedResourceUrlList()).toEqual(['self']);
    });

    it('returns [] as the default banned resource-URL block-list', () => {
      const provider = new $SceDelegateProvider();
      expect(provider.bannedResourceUrlList()).toEqual([]);
    });
  });

  describe('fluent setters', () => {
    it('trustedResourceUrlList(list) returns the provider for chaining', () => {
      const provider = new $SceDelegateProvider();
      expect(provider.trustedResourceUrlList(['self', 'https://api.example.com/**'])).toBe(provider);
    });

    it('bannedResourceUrlList(list) returns the provider for chaining', () => {
      const provider = new $SceDelegateProvider();
      expect(provider.bannedResourceUrlList(['https://bad.example.com/**'])).toBe(provider);
    });

    it('subsequent getter reflects the configured allow-list', () => {
      const provider = new $SceDelegateProvider();
      provider.trustedResourceUrlList(['https://api.example.com/**']);
      expect(provider.trustedResourceUrlList()).toEqual(['https://api.example.com/**']);
    });

    it('subsequent getter reflects the configured block-list', () => {
      const provider = new $SceDelegateProvider();
      provider.bannedResourceUrlList(['https://bad.example.com/**']);
      expect(provider.bannedResourceUrlList()).toEqual(['https://bad.example.com/**']);
    });

    it('chained allow + block setters configure both', () => {
      const provider = new $SceDelegateProvider()
        .trustedResourceUrlList(['self', 'https://api.example.com/**'])
        .bannedResourceUrlList(['https://bad.example.com/**']);
      expect(provider.trustedResourceUrlList()).toEqual(['self', 'https://api.example.com/**']);
      expect(provider.bannedResourceUrlList()).toEqual(['https://bad.example.com/**']);
    });
  });

  describe('defensive copies on get', () => {
    it('mutating the array returned by trustedResourceUrlList() does not affect the provider', () => {
      const provider = new $SceDelegateProvider();
      const first = provider.trustedResourceUrlList() as ResourceUrlListEntry[];
      first.push('https://attacker.example.com/**');
      expect(provider.trustedResourceUrlList()).toEqual(['self']);
    });

    it('mutating the array returned by bannedResourceUrlList() does not affect the provider', () => {
      const provider = new $SceDelegateProvider();
      const first = provider.bannedResourceUrlList() as ResourceUrlListEntry[];
      first.push('https://attacker.example.com/**');
      expect(provider.bannedResourceUrlList()).toEqual([]);
    });
  });

  describe('defensive copies on set', () => {
    it('mutating the allow-list array after passing it in does not affect the provider', () => {
      const provider = new $SceDelegateProvider();
      const arr: ResourceUrlListEntry[] = ['https://api.example.com/**'];
      provider.trustedResourceUrlList(arr);
      arr.push('https://attacker.example.com/**');
      expect(provider.trustedResourceUrlList()).toEqual(['https://api.example.com/**']);
    });

    it('mutating the block-list array after passing it in does not affect the provider', () => {
      const provider = new $SceDelegateProvider();
      const arr: ResourceUrlListEntry[] = ['https://bad.example.com/**'];
      provider.bannedResourceUrlList(arr);
      arr.push('https://attacker.example.com/**');
      expect(provider.bannedResourceUrlList()).toEqual(['https://bad.example.com/**']);
    });
  });

  describe('setter validation — allow-list', () => {
    it('throws when passed a numeric entry', () => {
      const provider = new $SceDelegateProvider();
      expect(() =>
        provider.trustedResourceUrlList([
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising runtime validation path with an invalid entry type
          42 as any,
        ]),
      ).toThrow(/invalid list entry/);
    });

    it('throws when passed a boolean entry', () => {
      const provider = new $SceDelegateProvider();
      expect(() =>
        provider.trustedResourceUrlList([
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising runtime validation path with an invalid entry type
          true as any,
        ]),
      ).toThrow(/invalid list entry/);
    });

    it('throws when passed a plain-object entry', () => {
      const provider = new $SceDelegateProvider();
      expect(() =>
        provider.trustedResourceUrlList([
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising runtime validation path with an invalid entry type
          {} as any,
        ]),
      ).toThrow(/invalid list entry/);
    });

    it('does not mutate state when an invalid entry throws', () => {
      const provider = new $SceDelegateProvider();
      provider.trustedResourceUrlList(['https://api.example.com/**']);
      expect(() =>
        provider.trustedResourceUrlList([
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising runtime validation path with an invalid entry type
          42 as any,
        ]),
      ).toThrow();
      // Previous value preserved — throw was observed before the store.
      expect(provider.trustedResourceUrlList()).toEqual(['https://api.example.com/**']);
    });
  });

  describe('setter validation — block-list', () => {
    it('throws when passed a numeric entry', () => {
      const provider = new $SceDelegateProvider();
      expect(() =>
        provider.bannedResourceUrlList([
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising runtime validation path with an invalid entry type
          42 as any,
        ]),
      ).toThrow(/invalid list entry/);
    });

    it('throws when passed a boolean entry', () => {
      const provider = new $SceDelegateProvider();
      expect(() =>
        provider.bannedResourceUrlList([
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising runtime validation path with an invalid entry type
          true as any,
        ]),
      ).toThrow(/invalid list entry/);
    });

    it('throws when passed a plain-object entry', () => {
      const provider = new $SceDelegateProvider();
      expect(() =>
        provider.bannedResourceUrlList([
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising runtime validation path with an invalid entry type
          {} as any,
        ]),
      ).toThrow(/invalid list entry/);
    });

    it('does not mutate state when an invalid entry throws', () => {
      const provider = new $SceDelegateProvider();
      provider.bannedResourceUrlList(['https://bad.example.com/**']);
      expect(() =>
        provider.bannedResourceUrlList([
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising runtime validation path with an invalid entry type
          42 as any,
        ]),
      ).toThrow();
      expect(provider.bannedResourceUrlList()).toEqual(['https://bad.example.com/**']);
    });
  });

  describe('$get factory', () => {
    it('$get is a readonly array-style invokable with zero deps (length 1)', () => {
      const provider = new $SceDelegateProvider();
      expect(provider.$get).toHaveLength(1);
      expect(provider.$get[0]).toBeTypeOf('function');
    });

    it('produces a delegate that honors the configured allow-list', () => {
      const provider = new $SceDelegateProvider();
      provider.trustedResourceUrlList(['https://api.example.com/**']);
      const factory = provider.$get[0];
      const delegate: SceDelegateService = factory();
      expect(delegate.getTrusted('resourceUrl', 'https://api.example.com/v1/users')).toBe(
        'https://api.example.com/v1/users',
      );
      expect(() => delegate.getTrusted('resourceUrl', 'https://evil.example.com/v1/users')).toThrow(
        /did not match any trusted resource URL list entry/,
      );
    });

    it('with default settings, produces a delegate where same-origin resource URLs pass via self', () => {
      const provider = new $SceDelegateProvider();
      const delegate: SceDelegateService = provider.$get[0]();
      // Under jsdom the document origin is http://localhost/; a relative path
      // resolves same-origin and the 'self' allow-entry accepts it.
      expect(delegate.getTrusted('resourceUrl', '/relative-path')).toBe('/relative-path');
    });

    it('produces a delegate that honors the configured block-list with precedence over allow', () => {
      const provider = new $SceDelegateProvider();
      provider
        .trustedResourceUrlList(['https://api.example.com/**'])
        .bannedResourceUrlList(['https://api.example.com/admin/**']);
      const delegate: SceDelegateService = provider.$get[0]();
      expect(delegate.getTrusted('resourceUrl', 'https://api.example.com/v1/users')).toBe(
        'https://api.example.com/v1/users',
      );
      expect(() => delegate.getTrusted('resourceUrl', 'https://api.example.com/admin/panel')).toThrow(
        /matched a banned resource URL list entry/,
      );
    });

    it('produced delegate accepts TrustedResourceUrl wrappers short-circuiting list checks', () => {
      const provider = new $SceDelegateProvider();
      // Even with a restrictive allow-list, a pre-wrapped TrustedResourceUrl
      // passes — the author has taken responsibility.
      provider.trustedResourceUrlList([]);
      const delegate: SceDelegateService = provider.$get[0]();
      const wrapped = new TrustedResourceUrl('https://anything.example.com/x');
      expect(delegate.getTrusted('resourceUrl', wrapped)).toBe('https://anything.example.com/x');
    });
  });
});
