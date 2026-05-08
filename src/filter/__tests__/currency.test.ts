/**
 * `currency` built-in filter tests (Slice 7 / FS §2.14).
 *
 * Locks down the nine FS §2.14 acceptance criteria. Each `it` block
 * maps directly to one criterion. The full chain is exercised:
 *   ngModule → `.filter()` DSL → `$filterProvider` → `$filter('currency')`
 * which in turn resolves `$locale` via DI before calling the filter.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';

describe('currency built-in filter (FS §2.14)', () => {
  beforeEach(() => {
    resetRegistry();
    createModule('ng', []);
  });

  it('uses the en-US default symbol and 2-digit fraction size', () => {
    const injector = createInjector([ngModule]);
    const $filter = injector.get('$filter');

    expect($filter('currency')(1234.5)).toBe('$1,234.50');
  });

  it('substitutes a custom symbol argument', () => {
    const injector = createInjector([ngModule]);
    const $filter = injector.get('$filter');

    expect($filter('currency')(1234.5, '€')).toBe('€1,234.50');
  });

  it('honors a custom fractionSize argument (rounds when narrower)', () => {
    const injector = createInjector([ngModule]);
    const $filter = injector.get('$filter');

    expect($filter('currency')(1234.5, '$', 0)).toBe('$1,235');
  });

  it('renders negative values with the en-US accounting-parentheses pattern', () => {
    const injector = createInjector([ngModule]);
    const $filter = injector.get('$filter');

    expect($filter('currency')(-1234.5, '$')).toBe('($1,234.50)');
  });

  it('returns "" for non-numeric input (string)', () => {
    const injector = createInjector([ngModule]);
    const $filter = injector.get('$filter');

    expect($filter('currency')('foo')).toBe('');
  });

  it('returns "" for null and undefined input', () => {
    const injector = createInjector([ngModule]);
    const $filter = injector.get('$filter');

    expect($filter('currency')(null)).toBe('');
    expect($filter('currency')(undefined)).toBe('');
  });

  it('formats integer input with full fractional padding', () => {
    const injector = createInjector([ngModule]);
    const $filter = injector.get('$filter');

    expect($filter('currency')(42, '$', 2)).toBe('$42.00');
  });

  it('rounds a tiny value (0.001) to 0.00 at 2-digit fractionSize', () => {
    const injector = createInjector([ngModule]);
    const $filter = injector.get('$filter');

    expect($filter('currency')(0.001, '$', 2)).toBe('$0.00');
  });

  it('uses the en-US posPre pattern (symbol prefix, no suffix)', () => {
    const injector = createInjector([ngModule]);
    const $filter = injector.get('$filter');

    // posPre = '¤' (substituted to '$') and posSuf = ''. The symbol
    // appears before the number, with no trailing space or suffix.
    const out = $filter('currency')(7) as string;
    expect(out.startsWith('$')).toBe(true);
    expect(out.endsWith('0')).toBe(true);
    expect(out).toBe('$7.00');
  });

  it('NaN input returns ""', () => {
    const injector = createInjector([ngModule]);
    const $filter = injector.get('$filter');

    expect($filter('currency')(NaN)).toBe('');
  });
});
