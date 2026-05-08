/**
 * Public type surface for the filter pipeline.
 *
 * Slice 1 shipped `FilterFn`; Slice 2 adds the registry and service
 * types alongside `$filterProvider` / `$filter`. Keeping the types
 * isolated in their own module mirrors the established pattern in
 * `@exception-handler/exception-handler-types`.
 */

import type { Invokable } from '@di/di-types';

/**
 * The runtime contract of a filter function.
 *
 * Filters take a piped value as their first argument plus zero or more
 * arguments resolved from the expression's `: arg : arg` segments. They
 * return any value — typed `unknown` because filters span string
 * formatters (`uppercase` → string), array transforms (`limitTo` →
 * Array), and arbitrary user-defined transformations.
 *
 * The optional `$stateful` brand opts a filter out of the digest's
 * input-identity short-circuit. All nine built-ins (Slices 5-10) are
 * stateless; the brand exists for future filters whose output depends
 * on data outside their inputs (clocks, async lookups, etc.).
 *
 * @example
 * ```ts
 * // A trivial stateless filter.
 * const exclaim: FilterFn = (value) => `${String(value)}!`;
 *
 * // A stateful filter — opts out of the digest fast-path.
 * const tickFilter: FilterFn = Object.assign(() => Date.now(), { $stateful: true });
 * ```
 */
export type FilterFn = ((value: unknown, ...args: unknown[]) => unknown) & { $stateful?: boolean };

/**
 * The DI-invokable shape that produces a {@link FilterFn} when drained
 * by `$injector.invoke`. Reuses the project's standard `Invokable<T>`
 * machinery so filter factories share annotation handling with every
 * other DI registration form (plain function, `$inject`-tagged
 * function, or array-style `[...deps, fn]`).
 *
 * @example
 * ```ts
 * // Zero-dep factory.
 * const exclaimFactory: FilterFactory = () => (value) => `${String(value)}!`;
 *
 * // Array-style factory with deps resolved by $injector.invoke.
 * const multiplyFactory: FilterFactory = ['factor', (factor: number) => (n) => (n as number) * factor];
 * ```
 */
export type FilterFactory = Invokable<FilterFn>;

/**
 * The runtime `$filter` lookup service. Invoked with a registered
 * filter name; returns the resolved {@link FilterFn} (cached as a
 * singleton across calls). Throws `FilterLookupError` synchronously
 * if `name` is not in the registry.
 *
 * @example
 * ```ts
 * const $filter = injector.get('$filter');
 * const upper = $filter('uppercase');
 * upper('hi'); // => 'HI'
 * $filter('uppercase') === upper; // => true (singleton)
 * ```
 */
export type FilterService = (name: string) => FilterFn;

/**
 * Public face of the `$filterProvider` config-phase API. Callers reach
 * this through `config(['$filterProvider', ($fp) => …])`. The two
 * overloads mirror AngularJS 1.x: a string-form for one-off
 * registrations and an object-form for bulk registration of a name → factory map.
 *
 * Both overloads return `this` to keep the call chainable.
 *
 * @example
 * ```ts
 * appModule.config(['$filterProvider', ($fp: IFilterProvider) => {
 *   $fp.register('shout', () => (s) => `${String(s)}!`)
 *      .register({ whisper: () => (s) => `*${String(s)}*` });
 * }]);
 * ```
 */
export interface IFilterProvider {
  register(name: string, factory: FilterFactory): this;
  register(map: Record<string, FilterFactory>): this;
}
