import { beforeEach, describe, expect, it } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { sce, sceDelegate } from '@sce/index';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import type { SceDelegateService, SceService } from '@sce/sce-types';
import { TrustedHtml } from '@sce/trusted-values';

describe('$sce DI integration — Slice 5', () => {
  // The `ng` module is registered at import time; a `resetRegistry()` in a
  // neighbouring test would evict it. Re-registering here (in the SAME order
  // as `ng-module.ts` for readability — the DI graph tolerates any order)
  // keeps each test in this file self-contained while still exercising
  // `ngModule` by identity.
  beforeEach(() => {
    resetRegistry();
    createModule('ng', [])
      .provider('$sceDelegate', $SceDelegateProvider)
      .provider('$sce', $SceProvider)
      .provider('$interpolate', $InterpolateProvider);
  });

  describe('basic resolution', () => {
    it('exposes $sce as a SceService via createInjector([ngModule])', () => {
      const injector = createInjector([ngModule]);
      const service = injector.get('$sce');
      expect(service).toBeTypeOf('object');
      // `typeof` side-steps the lint rule that flags bare method references
      // (which lose `this`) — we only care that the slot holds a function.
      expect(typeof service.isEnabled).toBe('function');
      expect(typeof service.trustAsHtml).toBe('function');
      expect(typeof service.getTrustedHtml).toBe('function');
      expect(typeof service.parseAsHtml).toBe('function');
    });

    it('exposes $sceDelegate as a SceDelegateService via createInjector([ngModule])', () => {
      const injector = createInjector([ngModule]);
      const delegate = injector.get('$sceDelegate');
      expect(delegate).toBeTypeOf('object');
      expect(typeof delegate.trustAs).toBe('function');
      expect(typeof delegate.getTrusted).toBe('function');
      expect(typeof delegate.valueOf).toBe('function');
    });

    it('$sce is a singleton across injector.get calls', () => {
      const injector = createInjector([ngModule]);
      const a = injector.get('$sce');
      const b = injector.get('$sce');
      expect(a).toBe(b);
    });

    it('$sceDelegate is a singleton across injector.get calls', () => {
      const injector = createInjector([ngModule]);
      const a = injector.get('$sceDelegate');
      const b = injector.get('$sceDelegate');
      expect(a).toBe(b);
    });

    it('$sce.isEnabled() returns true by default', () => {
      const injector = createInjector([ngModule]);
      expect(injector.get('$sce').isEnabled()).toBe(true);
    });
  });

  describe('provider access lifecycle', () => {
    it('resolving $sceProvider at run time throws (config-phase only)', () => {
      const injector = createInjector([ngModule]);
      expect(() => injector.get('$sceProvider')).toThrow(/Unknown provider: \$sceProvider/);
    });

    it('resolving $sceDelegateProvider at run time throws (config-phase only)', () => {
      const injector = createInjector([ngModule]);
      expect(() => injector.get('$sceDelegateProvider')).toThrow(/Unknown provider: \$sceDelegateProvider/);
    });

    it('config block on $sceDelegateProvider configures the block-list observed at runtime', () => {
      const appModule = createModule('app', ['ng']).config([
        '$sceDelegateProvider',
        (p: $SceDelegateProvider) => {
          p.bannedResourceUrlList(['https://bad.example.com/**']);
        },
      ]);

      const injector = createInjector([appModule]);
      const service: SceService = injector.get('$sce');
      // A blocked URL is rejected with the documented block-match error.
      expect(() => service.getTrustedResourceUrl('https://bad.example.com/evil')).toThrow(
        /matched a banned resource URL list entry/,
      );
      // Same-origin (default 'self' allow) still passes through.
      expect(service.getTrustedResourceUrl('/relative-path')).toBe('/relative-path');
    });

    it('config block on $sceProvider(enabled=false) produces a pass-through $sce', () => {
      const appModule = createModule('app', ['ng']).config([
        '$sceProvider',
        (p: $SceProvider) => {
          p.enabled(false);
        },
      ]);

      const injector = createInjector([appModule]);
      const service: SceService = injector.get('$sce');
      expect(service.isEnabled()).toBe(false);
      // With strict mode OFF, trustAsHtml returns the input unchanged (no wrapper).
      expect(service.trustAsHtml('x')).toBe('x');
      // ...and getTrustedHtml on a plain string no longer throws.
      expect(service.getTrustedHtml('x')).toBe('x');
    });
  });

  describe('chained config blocks', () => {
    it('a single config block can configure both providers', () => {
      const appModule = createModule('app', ['ng']).config([
        '$sceProvider',
        '$sceDelegateProvider',
        (sceProvider: $SceProvider, delegateProvider: $SceDelegateProvider) => {
          sceProvider.enabled(true);
          delegateProvider.trustedResourceUrlList(['https://api.trusted.example.com/**']);
        },
      ]);

      const injector = createInjector([appModule]);
      const service: SceService = injector.get('$sce');
      expect(service.isEnabled()).toBe(true);
      expect(service.getTrustedResourceUrl('https://api.trusted.example.com/v1/users')).toBe(
        'https://api.trusted.example.com/v1/users',
      );
      expect(() => service.getTrustedResourceUrl('https://evil.example.com/x')).toThrow(
        /did not match any trusted resource URL list entry/,
      );
    });
  });

  describe('parity: DI path vs ES-module path', () => {
    it('DI-resolved $sce and the ESM sce export both wrap an HTML value as TrustedHtml with the same raw string', () => {
      const injector = createInjector([ngModule]);
      const diService: SceService = injector.get('$sce');

      const diWrapped = diService.trustAsHtml('x');
      const esmWrapped = sce.trustAsHtml('x');

      expect(diWrapped).toBeInstanceOf(TrustedHtml);
      expect(esmWrapped).toBeInstanceOf(TrustedHtml);
      expect((diWrapped as TrustedHtml).$$unwrapTrustedValue).toBe('x');
      expect((esmWrapped as TrustedHtml).$$unwrapTrustedValue).toBe('x');
    });

    it('getTrustedHtml round-trip yields the same string on both paths', () => {
      const injector = createInjector([ngModule]);
      const diService: SceService = injector.get('$sce');

      const diValue = diService.getTrustedHtml(diService.trustAsHtml('x'));
      const esmValue = sce.getTrustedHtml(sce.trustAsHtml('x'));

      expect(diValue).toBe('x');
      expect(esmValue).toBe('x');
      expect(diValue).toBe(esmValue);
    });

    it('parseAsHtml evaluates + unwraps identically on both paths for a matching scope', () => {
      const injector = createInjector([ngModule]);
      const diService: SceService = injector.get('$sce');

      const scope = { user: { bio: diService.trustAsHtml('hello') } };
      const diResult = diService.parseAsHtml('user.bio')(scope);

      const esmScope = { user: { bio: sce.trustAsHtml('hello') } };
      const esmResult = sce.parseAsHtml('user.bio')(esmScope);

      expect(diResult).toBe('hello');
      expect(esmResult).toBe('hello');
      expect(diResult).toBe(esmResult);
    });

    it('DI-resolved $sceDelegate and the ESM sceDelegate export accept trustAs identically', () => {
      const injector = createInjector([ngModule]);
      const diDelegate: SceDelegateService = injector.get('$sceDelegate');

      const diWrapped = diDelegate.trustAs('html', 'x');
      const esmWrapped = sceDelegate.trustAs('html', 'x');

      expect(diWrapped).toBeInstanceOf(TrustedHtml);
      expect(esmWrapped).toBeInstanceOf(TrustedHtml);
      expect((diWrapped as TrustedHtml).$$unwrapTrustedValue).toBe('x');
      expect((esmWrapped as TrustedHtml).$$unwrapTrustedValue).toBe('x');
    });

    it('DI-resolved $sceDelegate and the ESM sceDelegate export reject a plain-string getTrusted identically', () => {
      const injector = createInjector([ngModule]);
      const diDelegate: SceDelegateService = injector.get('$sceDelegate');

      expect(() => diDelegate.getTrusted('html', 'plain')).toThrow(/not trusted for context 'html'/);
      expect(() => sceDelegate.getTrusted('html', 'plain')).toThrow(/not trusted for context 'html'/);
    });
  });
});
