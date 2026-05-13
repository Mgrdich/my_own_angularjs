/**
 * Tests for `$templateCache` (spec 019 Slice 2 / FS §2.5).
 *
 * Two layers are exercised:
 *
 * 1. **ESM factory layer** — `createTemplateCache()` produces a
 *    fresh, isolated `TemplateCacheService` with put / get / remove /
 *    removeAll / info semantics matching the AngularJS-canonical
 *    contract. Two independently-constructed instances do not share
 *    state.
 * 2. **DI layer** — `injector.get('$templateCache')` returns the
 *    service after `createInjector(['ng'])`; each injector gets a
 *    closure-fresh instance; entries seeded from a `run()` block
 *    survive into the run phase.
 *
 * The provider/run-phase split for `$templateCache` is intentionally
 * thin in Slice 2 — the service is a plain factory with no config
 * surface, so there is no `$templateCacheProvider` class. The
 * `config()` block seeding pattern lands when `$templateRequest` ships
 * in Slice 3 (which needs `$templateCache` available at run phase to
 * route through). Slice 2 covers the run-phase seeding pattern via a
 * `run()` block — the most common app-bootstrap shape.
 */

import { describe, expect, it } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule } from '@di/module';
import { $TemplateCacheProvider, createTemplateCache, templateCache } from '@template/index';
import type { TemplateCacheService } from '@template/template-types';

describe('createTemplateCache() — ESM factory (FS §2.5)', () => {
  describe('put / get round-trip', () => {
    it('stores content and reads it back verbatim', () => {
      const cache = createTemplateCache();
      cache.put('/k', '<p>hi</p>');

      expect(cache.get('/k')).toBe('<p>hi</p>');
    });

    it('returns the stored content from `put` for chaining', () => {
      const cache = createTemplateCache();
      expect(cache.put('/k', '<p>hi</p>')).toBe('<p>hi</p>');
    });

    it('returns `undefined` for a missing key', () => {
      const cache = createTemplateCache();
      expect(cache.get('/nope')).toBeUndefined();
    });

    it('overwrites existing entries on a repeated `put`', () => {
      const cache = createTemplateCache();
      cache.put('/k', '<p>v1</p>');
      cache.put('/k', '<p>v2</p>');

      expect(cache.get('/k')).toBe('<p>v2</p>');
      expect(cache.info().size).toBe(1);
    });

    it('preserves the stored string exactly (no parsing, no normalization)', () => {
      const cache = createTemplateCache();
      const raw = '   <p>raw   spaces </p>\n<!-- comment -->';
      cache.put('/k', raw);

      expect(cache.get('/k')).toBe(raw);
    });
  });

  describe('remove + removeAll', () => {
    it('`remove` deletes a single entry; subsequent `get` returns `undefined`', () => {
      const cache = createTemplateCache();
      cache.put('/a', '<p>a</p>');
      cache.put('/b', '<p>b</p>');

      cache.remove('/a');

      expect(cache.get('/a')).toBeUndefined();
      expect(cache.get('/b')).toBe('<p>b</p>');
      expect(cache.info().size).toBe(1);
    });

    it('`remove` of a missing key is a no-op', () => {
      const cache = createTemplateCache();
      cache.put('/a', '<p>a</p>');

      expect(() => {
        cache.remove('/missing');
      }).not.toThrow();
      expect(cache.info().size).toBe(1);
    });

    it('`removeAll` clears every entry', () => {
      const cache = createTemplateCache();
      cache.put('/a', '<p>a</p>');
      cache.put('/b', '<p>b</p>');
      cache.put('/c', '<p>c</p>');

      cache.removeAll();

      expect(cache.get('/a')).toBeUndefined();
      expect(cache.get('/b')).toBeUndefined();
      expect(cache.get('/c')).toBeUndefined();
      expect(cache.info().size).toBe(0);
    });
  });

  describe('info()', () => {
    it("reports the literal id 'templates'", () => {
      const cache = createTemplateCache();
      expect(cache.info().id).toBe('templates');
    });

    it('reports size = 0 for a fresh cache', () => {
      const cache = createTemplateCache();
      expect(cache.info().size).toBe(0);
    });

    it('reflects entry count accurately as `put` / `remove` mutate the cache', () => {
      const cache = createTemplateCache();
      expect(cache.info().size).toBe(0);

      cache.put('/a', '<p>a</p>');
      expect(cache.info().size).toBe(1);

      cache.put('/b', '<p>b</p>');
      expect(cache.info().size).toBe(2);

      cache.remove('/a');
      expect(cache.info().size).toBe(1);

      cache.removeAll();
      expect(cache.info().size).toBe(0);
    });
  });

  describe('per-instance isolation', () => {
    it('two `createTemplateCache()` instances are independent', () => {
      const a = createTemplateCache();
      const b = createTemplateCache();

      a.put('/k', '<p>from a</p>');

      expect(a.get('/k')).toBe('<p>from a</p>');
      expect(b.get('/k')).toBeUndefined();
      expect(a.info().size).toBe(1);
      expect(b.info().size).toBe(0);
    });

    it('`removeAll` on one instance does not affect another', () => {
      const a = createTemplateCache();
      const b = createTemplateCache();

      a.put('/x', 'A');
      b.put('/x', 'B');

      a.removeAll();

      expect(a.get('/x')).toBeUndefined();
      expect(b.get('/x')).toBe('B');
    });
  });

  describe('default `templateCache` singleton', () => {
    it('is a valid TemplateCacheService instance', () => {
      const info = templateCache.info();
      expect(info.id).toBe('templates');
      expect(typeof info.size).toBe('number');
    });

    it('is independent of caches obtained via `createTemplateCache()`', () => {
      const fresh = createTemplateCache();
      fresh.put('/scoped', '<p>scoped</p>');

      expect(templateCache.get('/scoped')).toBeUndefined();
    });
  });
});

describe('$templateCache — DI registration on ngModule (FS §2.5)', () => {
  it("injector.get('$templateCache') returns the service after createInjector(['ng'])", () => {
    const injector = createInjector([ngModule]);
    const cache = injector.get('$templateCache');

    expect(typeof cache.put).toBe('function');
    expect(typeof cache.get).toBe('function');
    expect(typeof cache.remove).toBe('function');
    expect(typeof cache.removeAll).toBe('function');
    expect(typeof cache.info).toBe('function');
    expect(cache.info().id).toBe('templates');
    expect(cache.info().size).toBe(0);
  });

  it("injector.has('$templateCache') === true", () => {
    const injector = createInjector([ngModule]);
    expect(injector.has('$templateCache')).toBe(true);
  });

  it('repeated lookups within a single injector return the same singleton', () => {
    const injector = createInjector([ngModule]);
    const a: TemplateCacheService = injector.get('$templateCache');
    const b: TemplateCacheService = injector.get('$templateCache');

    expect(a).toBe(b);
  });

  it('two createInjector calls produce independent cache instances (per-injector isolation)', () => {
    const injectorA = createInjector([ngModule]);
    const injectorB = createInjector([ngModule]);

    const cacheA = injectorA.get('$templateCache');
    const cacheB = injectorB.get('$templateCache');

    expect(cacheA).not.toBe(cacheB);

    cacheA.put('/seed', '<p>only in A</p>');
    expect(cacheA.get('/seed')).toBe('<p>only in A</p>');
    expect(cacheB.get('/seed')).toBeUndefined();
  });

  it('entries seeded from a run() block survive into the run phase', () => {
    const appModule = createModule('app-templatecache-run-seed', ['ng']).run([
      '$templateCache',
      ($templateCache: TemplateCacheService) => {
        $templateCache.put('/seed.html', '<p>seeded</p>');
      },
    ]);

    const injector = createInjector([ngModule, appModule]);
    const cache = injector.get('$templateCache');

    expect(cache.get('/seed.html')).toBe('<p>seeded</p>');
    expect(cache.info().size).toBe(1);
  });
});

describe('$TemplateCacheProvider — config-phase provider shim (FS §2.13)', () => {
  it("module.config(['$templateCacheProvider', …]) receives a $TemplateCacheProvider instance", () => {
    let captured: $TemplateCacheProvider | undefined;
    const appModule = createModule('app-templatecache-provider-config', ['ng']).config([
      '$templateCacheProvider',
      (provider: $TemplateCacheProvider) => {
        captured = provider;
      },
    ]);

    createInjector([ngModule, appModule]);

    expect(captured).toBeInstanceOf($TemplateCacheProvider);
  });

  it("the provider's $get produces a working TemplateCacheService reachable via injector.get('$templateCache')", () => {
    const injector = createInjector([ngModule]);
    const cache = injector.get('$templateCache');

    // Round-trip a put/get to confirm the run-phase service produced by
    // the provider's $get is fully functional. This is the
    // belt-and-braces check that swapping `.factory(...)` for
    // `.provider(...)` on `ngModule` did not regress the run-phase
    // surface.
    cache.put('/via-provider.html', '<p>installed via provider</p>');
    expect(cache.get('/via-provider.html')).toBe('<p>installed via provider</p>');
    expect(cache.info().id).toBe('templates');
  });
});
