# `@cache` — the general-purpose cache factory: `$cacheFactory`

`$cacheFactory` produces named, `Map`-backed key-value caches. It is a small,
standalone store — useful on its own, and the backing store behind `$http`'s
optional response cache (see `@http`). The shape mirrors `$templateCache`
(`put` / `get` / `remove` / `removeAll` / `info`) and adds `destroy()`, which
detaches a cache from its factory's registry so the id can be reused.

The service ships as a PURE ESM-first factory (`createCacheFactory`) plus a DI
registration on `ngModule`. Each `createCacheFactory()` call builds a fresh
registry closure, so per-injector isolation is automatic.

```ts
const injector = createInjector(['ng']);
const $cacheFactory = injector.get<CacheFactory>('$cacheFactory');
```

## Creating and using a cache

```ts
const cache = $cacheFactory<number>('counters');

cache.put('hits', 1); // returns the value (1) for chaining
cache.get('hits'); // => 1
cache.get('miss'); // => undefined
cache.remove('hits'); // single-entry removal (no-op on a miss)
cache.removeAll(); // clear every entry (cache stays usable)
cache.info(); // => { id: 'counters', size: 0 }
```

`get` is typed by the `T` the cache was created with, so a typed cache returns
typed values:

```ts
const users = $cacheFactory<User>('users');
const u = users.get('u-1'); // u: User | undefined
```

## The registry surface

The factory itself carries a small registry surface so created caches can be
looked up and enumerated:

```ts
const cache = $cacheFactory('myData');
$cacheFactory.get('myData') === cache; // true
$cacheFactory.info();
// => { myData: { id: 'myData', size: 0 } }
```

Creating a cache under an id that is already in use throws (AngularJS parity —
`cacheId <id> taken`). Call `destroy()` to free the id first:

```ts
cache.destroy(); // clears entries AND removes the cache from the registry
$cacheFactory.get('myData'); // => undefined — the id is free again
$cacheFactory('myData'); // OK — re-creatable
```

`destroy()` detaches the cache from the registry but the instance you still
hold remains usable; it is simply no longer discoverable through
`$cacheFactory.get`.

## Intentional deviations (documented)

- **No LRU / `capacity` eviction.** AngularJS's `options.capacity` LRU policy
  is OUT of scope. Every cache is an unbounded `Map`; entries live until
  `remove` / `removeAll` / `destroy`. The `CacheOptions` bag (`{ capacity? }`)
  is accepted for shape parity but ignored — reserved so a future spec can
  light eviction up without a signature break. AngularJS's LRU is rarely used
  in practice, and a plain unbounded `Map` keeps the implementation
  clarity-first.

## Forward-pointers

- **`$http` response caching** builds on this — see `@http`'s README for the
  GET-only opt-in + concurrent-request dedup semantics.
- **A `$cacheFactoryProvider`** that layers `capacity`/LRU back on may land in
  a future spec without changing the current zero-config shape.
