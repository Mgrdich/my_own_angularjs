/**
 * `createFilter` — factory used by `$FilterProvider.$get` to produce
 * the runtime `$filter` service.
 *
 * `$filter(name)` resolves through `$injector.get(name + 'Filter')` so
 * the decorator chain and any last-wins overrides stacked on the
 * `<name>Filter` factory are visible to every lookup. The result is
 * cached in a per-`$filter` Map so the service-identity invariant
 * (`$filter(name) === $filter(name)`) holds across calls — even though
 * `$injector.get` itself caches singletons too, the local cache shields
 * `$filter` from a mid-test decorator-cache invalidation by storing the
 * exact reference handed back on first lookup.
 *
 * The `registeredNames` set is consulted before reaching into the
 * injector so unknown names surface as `FilterLookupError` (the canonical
 * filter-lookup error) instead of the generic `Unknown provider: <name>Filter`
 * — the type-narrowing `instanceof` check in scope's exception-routing
 * site (Slice 4) keys off `FilterLookupError`.
 */

import type { Injector } from '@di/di-types';

import { FilterLookupError } from './filter-error';
import type { FilterFn, FilterService } from './filter-types';

/**
 * Build a `$filter` service backed by `$injector` and the set of
 * registered filter names.
 *
 * The returned function is a closure over a private cache: every lookup
 * of the same name resolves to the same {@link FilterFn} instance.
 *
 * @example
 * ```ts
 * const $filter = createFilter(injector, registeredNames);
 * $filter('uppercase')('hi'); // => 'HI'
 * $filter('uppercase') === $filter('uppercase'); // => true
 * ```
 */
export function createFilter($injector: Injector, registeredNames: ReadonlySet<string>): FilterService {
  const cache = new Map<string, FilterFn>();

  return function $filter(name: string): FilterFn {
    const cached = cache.get(name);
    if (cached !== undefined) {
      return cached;
    }

    if (!registeredNames.has(name)) {
      throw new FilterLookupError(name);
    }

    const resolved = $injector.get<FilterFn>(`${name}Filter`);
    cache.set(name, resolved);
    return resolved;
  };
}
