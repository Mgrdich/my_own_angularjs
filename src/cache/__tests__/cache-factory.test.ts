/**
 * Tests for `$cacheFactory` (spec 038 Slice 1 / FS §2.2 / §2.13).
 *
 * Two layers are exercised:
 *
 * 1. **ESM factory layer** — `createCacheFactory()` produces a fresh,
 *    isolated factory. Created caches support put / get / remove /
 *    removeAll / destroy / info; named caches are independent; the
 *    factory registry (`get` / `info`) reflects live caches; a
 *    duplicate id throws (AngularJS parity); generic value typing flows
 *    through `put` / `get`.
 * 2. **DI layer** — `injector.get('$cacheFactory')` returns the service
 *    after `createInjector(['ng'])`; each injector gets a closure-fresh
 *    factory.
 */

import { describe, expect, it } from 'vitest';

import { createCacheFactory } from '@cache/cache-factory';
import type { Cache } from '@cache/cache-types';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';

describe('createCacheFactory() — ESM factory (FS §2.2)', () => {
  describe('put / get round-trip', () => {
    it('stores a value and reads it back verbatim', () => {
      const $cacheFactory = createCacheFactory();
      const cache = $cacheFactory('data');
      const stored = cache.put('key', { hello: 'world' });

      expect(stored).toEqual({ hello: 'world' });
      expect(cache.get('key')).toEqual({ hello: 'world' });
    });

    it('put returns the stored value for chaining convenience', () => {
      const cache = createCacheFactory()('data');
      expect(cache.put('n', 42)).toBe(42);
    });

    it('get returns undefined on a miss', () => {
      const cache = createCacheFactory()('data');
      expect(cache.get('missing')).toBeUndefined();
    });

    it('put overwrites an existing key (last-wins)', () => {
      const cache = createCacheFactory()('data');
      cache.put('k', 1);
      cache.put('k', 2);
      expect(cache.get('k')).toBe(2);
    });
  });

  describe('remove / removeAll', () => {
    it('remove deletes a single entry, leaving others intact', () => {
      const cache = createCacheFactory()('data');
      cache.put('a', 1);
      cache.put('b', 2);
      cache.remove('a');

      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
    });

    it('remove is a no-op for a key that is not present', () => {
      const cache = createCacheFactory()('data');
      cache.put('a', 1);
      expect(() => {
        cache.remove('absent');
      }).not.toThrow();
      expect(cache.get('a')).toBe(1);
    });

    it('removeAll clears every entry but keeps the cache usable', () => {
      const cache = createCacheFactory()('data');
      cache.put('a', 1);
      cache.put('b', 2);
      cache.removeAll();

      expect(cache.info().size).toBe(0);
      cache.put('c', 3);
      expect(cache.get('c')).toBe(3);
    });
  });

  describe('info', () => {
    it('reports the id and current size', () => {
      const cache = createCacheFactory()('counters');
      expect(cache.info()).toEqual({ id: 'counters', size: 0 });

      cache.put('hits', 1);
      expect(cache.info()).toEqual({ id: 'counters', size: 1 });
    });
  });

  describe('destroy', () => {
    it('clears entries and detaches the cache from the factory registry', () => {
      const $cacheFactory = createCacheFactory();
      const cache = $cacheFactory('ephemeral');
      cache.put('a', 1);

      cache.destroy();

      expect(cache.info().size).toBe(0);
      expect($cacheFactory.get('ephemeral')).toBeUndefined();
      expect($cacheFactory.info()).toEqual({});
    });

    it('frees the id for re-creation', () => {
      const $cacheFactory = createCacheFactory();
      const first = $cacheFactory('shared');
      first.destroy();

      expect(() => {
        const second = $cacheFactory('shared');
        expect(second).not.toBe(first);
      }).not.toThrow();
    });
  });

  describe('named-cache isolation', () => {
    it('two ids are independent stores', () => {
      const $cacheFactory = createCacheFactory();
      const users = $cacheFactory('users');
      const posts = $cacheFactory('posts');

      users.put('1', 'alice');
      posts.put('1', 'hello world');

      expect(users.get('1')).toBe('alice');
      expect(posts.get('1')).toBe('hello world');

      users.removeAll();
      expect(users.get('1')).toBeUndefined();
      expect(posts.get('1')).toBe('hello world');
    });
  });

  describe('registry surface (get / info)', () => {
    it('get(id) returns the same cache instance', () => {
      const $cacheFactory = createCacheFactory();
      const cache = $cacheFactory('myData');
      expect($cacheFactory.get('myData')).toBe(cache);
    });

    it('get(id) returns undefined for an unknown id', () => {
      expect(createCacheFactory().get('nope')).toBeUndefined();
    });

    it('info() maps every live id to its CacheInfo payload', () => {
      const $cacheFactory = createCacheFactory();
      const a = $cacheFactory('a');
      const b = $cacheFactory('b');
      a.put('x', 1);
      b.put('y', 1);
      b.put('z', 2);

      expect($cacheFactory.info()).toEqual({
        a: { id: 'a', size: 1 },
        b: { id: 'b', size: 2 },
      });
    });
  });

  describe('duplicate-id guard (AngularJS parity)', () => {
    it('throws "cacheId <id> taken" when an id is re-used', () => {
      const $cacheFactory = createCacheFactory();
      $cacheFactory('dup');
      expect(() => $cacheFactory('dup')).toThrow('cacheId dup taken');
    });
  });

  describe('generic value typing', () => {
    it('a typed cache returns the requested value type', () => {
      const $cacheFactory = createCacheFactory();
      const cache: Cache<number> = $cacheFactory<number>('nums');
      cache.put('a', 10);
      const value: number | undefined = cache.get('a');
      expect(value).toBe(10);
    });
  });

  describe('factory isolation', () => {
    it('two factories have independent registries', () => {
      const factoryA = createCacheFactory();
      const factoryB = createCacheFactory();

      factoryA('shared');

      // Same id is free on the other factory.
      expect(() => factoryB('shared')).not.toThrow();
      expect(factoryB.get('shared')).not.toBe(factoryA.get('shared'));
    });
  });
});

describe('$cacheFactory — DI registration on ngModule (FS §2.13)', () => {
  it("injector.get('$cacheFactory') returns the service after createInjector(['ng'])", () => {
    const injector = createInjector([ngModule]);
    const $cacheFactory = injector.get('$cacheFactory');

    const cache = $cacheFactory('http-ish');
    cache.put('url', { status: 200 });
    expect(cache.get('url')).toEqual({ status: 200 });
  });

  it('returns the same factory instance per injector (singleton)', () => {
    const injector = createInjector([ngModule]);
    const a = injector.get('$cacheFactory');
    const b = injector.get('$cacheFactory');
    expect(a).toBe(b);
  });

  it('two createInjector calls produce independent factories (per-injector isolation)', () => {
    const injectorA = createInjector([ngModule]);
    const injectorB = createInjector([ngModule]);

    injectorA.get('$cacheFactory')('isolated');

    // The same id is free on the other injector's factory.
    expect(() => injectorB.get('$cacheFactory')('isolated')).not.toThrow();
  });
});
