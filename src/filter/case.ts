/**
 * `uppercase` and `lowercase` — string-case built-in filters.
 *
 * Both are stateless, dep-free, and pass-through on non-string input
 * (matching the documented FS §§2.17, 2.18 wording — narrower than
 * AngularJS's "return `''` on non-string"; the pass-through form is what
 * the functional spec pins down for this rewrite).
 *
 * The factories are exported as zero-dep `Invokable` arrays. Bare arrow
 * factories without `$inject` annotations are rejected by `annotate.ts`
 * unless the function takes no parameters; the array form `[() => fn]`
 * is the canonical, unambiguous shape used throughout the project.
 */

import type { Invokable } from '@di/di-types';

import type { FilterFn } from './filter-types';

const uppercaseFilter: FilterFn = (input) => (typeof input === 'string' ? input.toUpperCase() : input);

const lowercaseFilter: FilterFn = (input) => (typeof input === 'string' ? input.toLowerCase() : input);

/**
 * Factory for the `uppercase` built-in filter.
 *
 * Calling the produced filter with a string returns the upper-cased
 * string. Calling it with any non-string value (numbers, booleans,
 * objects, `null`, `undefined`) returns the input unchanged — this is
 * the pass-through behavior pinned by FS §2.17.
 *
 * @example
 * ```ts
 * const $filter = injector.get('$filter');
 * $filter('uppercase')('hello');        // => 'HELLO'
 * $filter('uppercase')(42);             // => 42 (unchanged)
 * // Inside an expression / interpolation:
 * // {{ name | uppercase }}             // => 'WORLD' when scope.name === 'world'
 * ```
 */
export const uppercaseFilterFactory: Invokable<FilterFn> = [() => uppercaseFilter];

/**
 * Factory for the `lowercase` built-in filter — symmetric counterpart
 * to {@link uppercaseFilterFactory}.
 *
 * @example
 * ```ts
 * const $filter = injector.get('$filter');
 * $filter('lowercase')('HELLO');        // => 'hello'
 * $filter('lowercase')({});             // => {} (unchanged)
 * // {{ greeting | lowercase }}         // => 'hi' when scope.greeting === 'Hi'
 * ```
 */
export const lowercaseFilterFactory: Invokable<FilterFn> = [() => lowercaseFilter];
