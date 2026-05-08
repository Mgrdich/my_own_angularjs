/**
 * `number` built-in filter tests (Slice 7 / FS §2.15).
 *
 * Locks down the ten FS §2.15 acceptance criteria. Includes the
 * trailing-zero-trim path (no explicit `fractionSize`), the
 * `Infinity` / `NaN` short-circuits, and the very-large-number
 * fall-through to scientific notation that AngularJS pins for values
 * above the pattern's max representable digits.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';

describe('number built-in filter (FS §2.15)', () => {
  beforeEach(() => {
    resetRegistry();
    createModule('ng', []);
  });

  it('formats a default value with grouping (trailing zeros trimmed)', () => {
    const injector = createInjector([ngModule]);
    const $filter = injector.get('$filter');

    expect($filter('number')(1234567.89)).toBe('1,234,567.89');
  });

  it('honors an explicit fractionSize (rounds at 2 digits)', () => {
    const injector = createInjector([ngModule]);
    const $filter = injector.get('$filter');

    expect($filter('number')(1234.5678, 2)).toBe('1,234.57');
  });

  it('zero fractionSize rounds to integer', () => {
    const injector = createInjector([ngModule]);
    const $filter = injector.get('$filter');

    expect($filter('number')(1234.5, 0)).toBe('1,235');
  });

  it('negative values use the "-" negPre prefix', () => {
    const injector = createInjector([ngModule]);
    const $filter = injector.get('$filter');

    expect($filter('number')(-1234.5, 1)).toBe('-1,234.5');
  });

  it('non-numeric input returns ""', () => {
    const injector = createInjector([ngModule]);
    const $filter = injector.get('$filter');

    expect($filter('number')('not-a-number')).toBe('');
    expect($filter('number')(null)).toBe('');
    expect($filter('number')(undefined)).toBe('');
  });

  it('Infinity returns "∞" and -Infinity returns "-∞"', () => {
    const injector = createInjector([ngModule]);
    const $filter = injector.get('$filter');

    expect($filter('number')(Number.POSITIVE_INFINITY)).toBe('∞');
    expect($filter('number')(Number.NEGATIVE_INFINITY)).toBe('-∞');
  });

  it('NaN returns ""', () => {
    const injector = createInjector([ngModule]);
    const $filter = injector.get('$filter');

    expect($filter('number')(NaN)).toBe('');
  });

  it('falls back to scientific notation for very large numbers (1e21)', () => {
    const injector = createInjector([ngModule]);
    const $filter = injector.get('$filter');

    // AngularJS parity — the number filter cannot represent the
    // exponent through pattern-based grouping, so it returns the
    // bare `String(value)` form.
    expect($filter('number')(1e21)).toBe(String(1e21));
  });

  it('trims trailing zeros when fractionSize is omitted', () => {
    const injector = createInjector([ngModule]);
    const $filter = injector.get('$filter');

    expect($filter('number')(1.5)).toBe('1.5');
  });

  it('pads trailing zeros when fractionSize is explicitly larger', () => {
    const injector = createInjector([ngModule]);
    const $filter = injector.get('$filter');

    expect($filter('number')(1.5, 3)).toBe('1.500');
  });
});
