/**
 * `$FilterProvider` — DI-facing configurator for the `$filter` service.
 *
 * `register(name, factory)` is sugar for `$provide.factory(name + 'Filter', factory)`:
 * each registration installs a normal injector-resolvable factory under the
 * `<name>Filter` provider name. This single channel is what makes:
 *
 * - `module.decorator('<name>Filter', …)` reach the filter (the AngularJS-canonical
 *   decoration path),
 * - last-wins across `module.filter(name, …)` and `$filterProvider.register(name, …)`
 *   work uniformly (both writes flow through `$provide.factory`, which the
 *   shared `applyRegistrationRecord` already handles), and
 * - the `<name>Filter` provider lookup return the same singleton as `$filter(name)`.
 *
 * Mirrors AngularJS 1.x `$filterProvider`. The `$` prefix on the class
 * name is the AngularJS convention for built-in service providers.
 *
 * Filter names must be non-empty strings with no whitespace — any
 * whitespace would conflict with the parser's treatment of filter
 * names as identifier tokens. Validation fires at registration time
 * so misuse surfaces synchronously inside the offending `config()`
 * block, not later during a digest.
 */

import type { Injector } from '@di/di-types';
import type { ProvideService } from '@di/provide-types';

import { createFilter } from './filter-service';
import type { FilterFactory, FilterService, IFilterProvider } from './filter-types';

const VALID_FILTER_NAME = /^\S+$/;

export class $FilterProvider implements IFilterProvider {
  // The config-phase `$provide` reference is injected via the provider
  // constructor (`['$provide', $FilterProvider]` form on `ngModule`).
  // `register` delegates to `$provide.factory(name + 'Filter', factory)` so
  // every filter is just a normal factory under a conventionally-named
  // `<name>Filter` provider — making decorators reach filters with no extra
  // wiring.
  private readonly $$provide: ProvideService;

  /**
   * Names that have been registered through this provider's `register`
   * method. The set acts as the source of truth for "have we seen this
   * filter name?" used by `$filter`'s lookup fallback (so unknown names
   * surface `FilterLookupError` rather than the generic
   * `Unknown provider: <name>Filter`). The actual factory is owned by the
   * `$provide` registration map; we don't store factories here.
   */
  private readonly $$registeredNames = new Set<string>();

  constructor($provide: ProvideService) {
    this.$$provide = $provide;
  }

  /**
   * Register a filter factory under `name`.
   *
   * The string-form takes a name plus a {@link FilterFactory} and routes
   * it through `$provide.factory(name + 'Filter', factory)` — last-wins
   * on repeat keys so a later `register('foo', …)` replaces any earlier
   * registration of `'foo'` through the same shared registration timeline
   * the rest of the DI machinery uses.
   *
   * The object-form takes a `Record<string, FilterFactory>` and iterates
   * over its own enumerable string-keyed entries, calling the string-form
   * for each. This matches AngularJS 1.x's bulk-register shorthand exactly.
   *
   * Both forms return `this` so `register` calls chain naturally.
   *
   * @example
   * ```ts
   * appModule.config(['$filterProvider', ($fp: $FilterProvider) => {
   *   $fp
   *     .register('shout', [() => (s) => `${String(s)}!`])
   *     .register({ whisper: [() => (s) => `*${String(s)}*`] });
   * }]);
   * ```
   */
  register(name: string, factory: FilterFactory): this;
  register(map: Record<string, FilterFactory>): this;
  register(nameOrMap: string | Record<string, FilterFactory>, factory?: FilterFactory): this {
    if (typeof nameOrMap === 'string') {
      if (factory === undefined) {
        throw new Error(`$filterProvider.register: factory is required when name is a string`);
      }
      if (!VALID_FILTER_NAME.test(nameOrMap)) {
        throw new Error(
          `$filterProvider.register: filter name must be a non-empty string with no whitespace, got ${JSON.stringify(nameOrMap)}`,
        );
      }
      this.$$registeredNames.add(nameOrMap);
      // Route through `$provide.factory` so the registration goes into the
      // unified factory map. Last-wins, decorator stacking, and the
      // constant-override guard all fall out of the shared
      // `applyRegistrationRecord` machinery — no parallel storage.
      this.$$provide.factory(`${nameOrMap}Filter`, factory);
      return this;
    }

    for (const [key, value] of Object.entries(nameOrMap)) {
      this.register(key, value);
    }
    return this;
  }

  /**
   * Injector-facing factory. Array-style invokable declaring `$injector`
   * as its only dependency — the produced `$filter` service routes every
   * lookup through `$injector.get(name + 'Filter')` so the decorator chain
   * (and any later registration) is always reflected.
   */
  $get = [
    '$injector',
    ($injector: Injector): FilterService => createFilter($injector, this.$$registeredNames),
  ] as const;
}
