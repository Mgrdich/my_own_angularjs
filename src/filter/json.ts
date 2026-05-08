/**
 * `json` — JSON-stringification built-in filter.
 *
 * Thin wrapper over `JSON.stringify` with AngularJS's 2-space-indent
 * default (FS §2.19). Numeric `spacing` arguments are forwarded
 * verbatim; any other arg type falls back to the 2-space default.
 *
 * Edge-case behavior is `JSON.stringify`'s: `undefined` input returns
 * the literal `undefined` (not the string `'undefined'`), `null`
 * returns the string `'null'`, circular references throw, and
 * functions / symbols inside objects are dropped.
 */

import type { Invokable } from '@di/di-types';

import type { FilterFn } from './filter-types';

const jsonFilter: FilterFn = (input, spacing) => JSON.stringify(input, null, typeof spacing === 'number' ? spacing : 2);

/**
 * Factory for the `json` built-in filter.
 *
 * The default 2-space indent matches AngularJS 1.x. Pass `0` for
 * compact output, or any other positive integer for a wider indent.
 *
 * @example
 * ```ts
 * const $filter = injector.get('$filter');
 * $filter('json')({ a: 1, b: 2 });
 * // => '{\n  "a": 1,\n  "b": 2\n}'
 *
 * $filter('json')({ a: 1 }, 0);
 * // => '{"a":1}'
 *
 * // {{ payload | json:0 }} renders the compact form inside templates.
 * ```
 */
export const jsonFilterFactory: Invokable<FilterFn> = [() => jsonFilter];
