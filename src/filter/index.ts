/**
 * Public barrel for the `@filter` module — the AngularJS filter
 * pipeline plus the nine built-in filters and the swappable `$locale`
 * service.
 *
 * Filters are the AngularJS expression-language transformation layer:
 * `value | filterName : arg1 : arg2`. Three pieces compose the surface:
 *
 * 1. **Pipe operator in the parser.** The lexer emits `|` as its own
 *    token; the parser places a `Filter` production just above
 *    assignment. `||` (logical OR) is unaffected.
 * 2. **Registration via `$filterProvider` (config-phase) or
 *    `module.filter(name, factory)` (chainable shorthand).** Both
 *    funnel into one registry — `register(name, factory)` is sugar for
 *    `$provide.factory(name + 'Filter', factory)`. That `<name>Filter`
 *    provider naming is what makes the existing decorator stack reach
 *    filters at zero extra cost: `module.decorator('currencyFilter',
 *    ['$delegate', …])` wraps the underlying filter and is visible
 *    through both `$filter('currency')` and `injector.get('currencyFilter')`.
 * 3. **`$filter` lookup service.** `injector.get('$filter')(name)`
 *    returns the singleton filter function, usable from any service /
 *    factory / run block / test, not just templates.
 *
 * The nine built-in factories ship registered on the core `ng` module —
 * no opt-in dependency required (unlike `ngSanitize`).
 *
 * `$locale` is a single-factory swap point: `module.factory('$locale',
 * () => myLocale)` replaces the en-US default. The `currency`, `number`,
 * and `date` filters read it lazily on each invocation, so config-time
 * replacement takes immediate effect at run time. Only the en-US default
 * ships; non-English locales bring their own `LocaleService` literal.
 *
 * Filters are pure by default — the digest treats `value | filter` as
 * stable when `value`'s identity is unchanged. A filter function may
 * declare `$stateful = true` (on the function returned by the factory,
 * NOT on the factory itself) to opt out: it then re-evaluates every
 * digest cycle and disqualifies the expression from spec-010 one-time
 * and constant-watch fast paths.
 *
 * Two surfaces co-exist, mirroring the `@sce` and `@sanitize` pattern:
 *
 * - **ESM-first** — `createFilter($injector, registeredNames)` is the
 *   pure factory used by `$FilterProvider.$get` to produce the runtime
 *   `$filter` service. `defaultLocale` is the frozen en-US literal
 *   (`Object.freeze`'d recursively). The nine built-in factories
 *   (`uppercaseFilterFactory`, etc.) are exported as zero/one-dep
 *   `Invokable` arrays so apps wiring filters outside the DI layer can
 *   call them by hand.
 * - **DI layer** — `$FilterProvider` is the config-phase registrar
 *   (`config(['$filterProvider', ($fp) => $fp.register(...)])`). It is
 *   bound onto `ngModule` together with the nine built-ins and the
 *   default `$locale`; the run-phase `$filter` injectable is produced
 *   from the provider's `$get`.
 */

export { lowercaseFilterFactory, uppercaseFilterFactory } from './case';
export { currencyFilterFactory } from './currency';
export { dateFilterFactory } from './date';
export { FilterLookupError } from './filter-error';
export { filterFilterFactory } from './filter-filter';
export { $FilterProvider } from './filter-provider';
export { createFilter } from './filter-service';
export type { FilterFactory, FilterFn, FilterService, IFilterProvider } from './filter-types';
export { jsonFilterFactory } from './json';
export { limitToFilterFactory } from './limit-to';
export { defaultLocale } from './locale';
export type { LocaleService } from './locale-types';
export { numberFilterFactory } from './number';
export { orderByFilterFactory } from './order-by';
