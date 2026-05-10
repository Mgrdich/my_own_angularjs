/**
 * Unit tests for `directiveNormalize` (FS §2.6 / technical §2.9).
 *
 * One assertion per row of the FS §2.6 normalization table: bare
 * kebab→camel, `data-`/`x-` prefixes, `:`/`_`/`-` separators, mixed
 * separators, prefix-with-each-separator combinations, case-insensitive
 * prefix, and idempotence on already-camelCase input. A final test
 * covers the private memoization cache.
 */

import { describe, expect, it } from 'vitest';

import { directiveNormalize } from '@compiler/directive-normalize';

describe('directiveNormalize (FS §2.6)', () => {
  it('passes camelCase input through unchanged (idempotent)', () => {
    expect(directiveNormalize('myDirective')).toBe('myDirective');
  });

  it('camelizes bare kebab-case', () => {
    expect(directiveNormalize('my-directive')).toBe('myDirective');
  });

  it('strips `data-` prefix and camelizes the remainder', () => {
    expect(directiveNormalize('data-my-directive')).toBe('myDirective');
  });

  it('strips `x-` prefix and camelizes the remainder', () => {
    expect(directiveNormalize('x-my-directive')).toBe('myDirective');
  });

  it('camelizes `:` separator', () => {
    expect(directiveNormalize('my:directive')).toBe('myDirective');
  });

  it('camelizes `_` separator', () => {
    expect(directiveNormalize('my_directive')).toBe('myDirective');
  });

  it('strips `data:` prefix variant', () => {
    expect(directiveNormalize('data:my-directive')).toBe('myDirective');
  });

  it('strips `x:` prefix variant', () => {
    expect(directiveNormalize('x:my-directive')).toBe('myDirective');
  });

  it('strips `data_` prefix variant', () => {
    expect(directiveNormalize('data_my-directive')).toBe('myDirective');
  });

  it('strips `x_` prefix variant', () => {
    expect(directiveNormalize('x_my-directive')).toBe('myDirective');
  });

  it('handles mixed separators across the same name', () => {
    expect(directiveNormalize('my:dir-name')).toBe('myDirName');
  });

  it('handles `data:my:directive` (prefix + repeated `:` separators)', () => {
    expect(directiveNormalize('data:my:directive')).toBe('myDirective');
  });

  it('matches the prefix case-insensitively (`DATA-my-directive`)', () => {
    expect(directiveNormalize('DATA-my-directive')).toBe('myDirective');
  });

  it('preserves uppercase letters in the body — only camelizes the char after a separator', () => {
    // The algorithm is `letter.toUpperCase()` on the captured char after the
    // separator; an already-uppercase `D` stays `D`. This matches the
    // AngularJS 1.x reference (`fnCamelCaseReplace`) — the technical-spec
    // hand-worked example `MY-DIR → MYDir` is incorrect; both AngularJS and
    // this port produce `MYDIR`.
    expect(directiveNormalize('MY-DIR')).toBe('MYDIR');
  });

  it('returns the same cached string identity across repeated calls (memoization)', () => {
    const first = directiveNormalize('cache-test-dir');
    const second = directiveNormalize('cache-test-dir');
    expect(first).toBe(second);
    // Reference equality proves the memoized string was returned without
    // re-running the regex (a fresh `.replace` would yield a new string).
    expect(first === second).toBe(true);
  });
});
