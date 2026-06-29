/**
 * Public TypeScript types for the `@cache` module (spec 038 Slice 1).
 *
 * `$cacheFactory` produces named, Map-backed key-value caches — the
 * general-purpose store that backs `$http`'s optional response cache
 * (spec 038 §2.13) and is also usable standalone. The shape mirrors
 * `$templateCache` (`put` / `get` / `remove` / `removeAll` / `info`)
 * and adds `destroy()`, which removes the cache from its factory's
 * registry so a fresh cache may later be created under the same id.
 *
 * The file is intentionally type-only — no runtime imports — so it can
 * be re-exported as `export type` from the public barrel and the root
 * barrel without dragging runtime code along.
 *
 * **Out of scope (documented deviation):** AngularJS's `options.capacity`
 * LRU eviction is NOT implemented. Every cache is an unbounded `Map`;
 * entries live until `remove` / `removeAll` / `destroy`. AngularJS's LRU
 * is rarely used in practice, and a plain unbounded Map keeps the
 * implementation clarity-first. A future spec may add a
 * `$cacheFactoryProvider` around this factory to layer eviction back on
 * without breaking the current zero-config shape.
 */

/**
 * Introspection payload returned by {@link Cache.info} and (per-cache)
 * by {@link CacheFactory.info}.
 *
 * @example
 * ```ts
 * const cache = $cacheFactory('users');
 * cache.put('a', 1);
 * cache.info();
 * // => { id: 'users', size: 1 }
 * ```
 */
export interface CacheInfo {
  /** The id the cache was created under. */
  readonly id: string;
  /** Number of entries currently stored in the cache. */
  readonly size: number;
}

/**
 * A single named cache produced by {@link CacheFactory}.
 *
 * Generic over the stored value `T` (defaults to `unknown`), so a typed
 * cache (`$cacheFactory<HttpResponse>('$http')`) returns correctly-typed
 * values from `get`.
 *
 * @example
 * ```ts
 * const cache = $cacheFactory<number>('counters');
 * cache.put('hits', 1);
 * const n = cache.get('hits'); // n: number | undefined
 * cache.remove('hits');
 * cache.destroy(); // removed from the factory registry
 * ```
 */
export interface Cache<T = unknown> {
  /**
   * Store `value` under `key` and return `value` unchanged for chaining
   * convenience (matching the AngularJS-canonical shape).
   */
  put(key: string, value: T): T;
  /** Return the stored value for `key`, or `undefined` on miss. */
  get(key: string): T | undefined;
  /** Remove a single entry. No-op if `key` is not present. */
  remove(key: string): void;
  /** Clear every entry from the cache (the cache itself stays usable). */
  removeAll(): void;
  /**
   * Clear every entry AND remove this cache from its factory's registry,
   * so {@link CacheFactory.get} no longer returns it and the id becomes
   * free for re-creation. The instance itself remains usable but is
   * detached from the registry.
   */
  destroy(): void;
  /** Return a snapshot of cache metadata — the id and current size. */
  info(): CacheInfo;
}

/**
 * The `$cacheFactory` service surface (spec 038 §2.2).
 *
 * A callable that creates named caches, with a small registry surface
 * (`get` / `info`) hanging off the function so created caches can be
 * looked up by id and enumerated.
 *
 * Creating a cache with an id that is already taken throws (AngularJS
 * parity — `cacheId <id> taken`). Calling {@link Cache.destroy} frees
 * the id for re-creation.
 *
 * @example
 * ```ts
 * const $cacheFactory = injector.get('$cacheFactory');
 *
 * const cache = $cacheFactory('myData');
 * cache.put('key', { hello: 'world' });
 *
 * $cacheFactory.get('myData') === cache; // true
 * $cacheFactory.info();
 * // => { myData: { id: 'myData', size: 1 } }
 * ```
 */
export interface CacheFactory {
  /**
   * Create a new named cache. `options` is accepted for AngularJS shape
   * parity but currently ignored (LRU/`capacity` is out of scope — see
   * the module-level doc note). Throws if `id` is already in use.
   */
  <T = unknown>(id: string, options?: CacheOptions): Cache<T>;
  /** Return the cache previously created under `id`, or `undefined`. */
  get<T = unknown>(id: string): Cache<T> | undefined;
  /**
   * Return a snapshot mapping every live cache id to its
   * {@link CacheInfo} payload.
   */
  info(): Record<string, CacheInfo>;
}

/**
 * Options bag accepted by {@link CacheFactory}. Present for AngularJS
 * shape parity; `capacity` (LRU eviction) is OUT of scope this spec —
 * the field is reserved so a future spec can light it up without a
 * signature break. Today it is ignored.
 */
export interface CacheOptions {
  /**
   * Reserved for a future LRU eviction policy (NOT implemented — see the
   * module-level doc note). Currently ignored.
   */
  readonly capacity?: number;
}
