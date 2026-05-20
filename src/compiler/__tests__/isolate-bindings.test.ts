/**
 * Unit tests for `parseBindingSpec` and `parseIsolateBindings` —
 * the binding-spec parser introduced by spec 022 Slice 1.
 *
 * Two surfaces under test:
 *
 *   1. `parseBindingSpec(directiveName, localName, raw)` — parses a
 *      single binding-spec string into a `NormalizedBindingSpec`,
 *      throws `InvalidIsolateBindingError` for malformed input.
 *   2. `parseIsolateBindings(directiveName, scopeObj)` — convenience
 *      wrapper that maps every entry through `parseBindingSpec`.
 *
 * The wiring strategies (`@`, `<`, `=`, `&`) are exercised by the
 * higher-level isolate-scope integration tests in
 * `isolate-scope.test.ts`; this file stays focused on the parser's
 * shape.
 */

import { describe, expect, it } from 'vitest';

import { InvalidIsolateBindingError } from '@compiler/compile-error';
import { parseBindingSpec, parseIsolateBindings } from '@compiler/isolate-bindings';

describe('parseBindingSpec', () => {
  it('parses each of the four binding kinds with no optional / alias', () => {
    expect(parseBindingSpec('myDir', 'value', '=')).toEqual({
      mode: '=',
      optional: false,
      attrName: 'value',
    });
    expect(parseBindingSpec('myDir', 'label', '@')).toEqual({
      mode: '@',
      optional: false,
      attrName: 'label',
    });
    expect(parseBindingSpec('myDir', 'item', '<')).toEqual({
      mode: '<',
      optional: false,
      attrName: 'item',
    });
    expect(parseBindingSpec('myDir', 'onDone', '&')).toEqual({
      mode: '&',
      optional: false,
      attrName: 'onDone',
    });
  });

  it('marks the binding optional when the `?` modifier is present', () => {
    expect(parseBindingSpec('myDir', 'value', '=?')).toEqual({
      mode: '=',
      optional: true,
      attrName: 'value',
    });
    expect(parseBindingSpec('myDir', 'label', '@?')).toEqual({
      mode: '@',
      optional: true,
      attrName: 'label',
    });
    expect(parseBindingSpec('myDir', 'item', '<?')).toEqual({
      mode: '<',
      optional: true,
      attrName: 'item',
    });
    expect(parseBindingSpec('myDir', 'onDone', '&?')).toEqual({
      mode: '&',
      optional: true,
      attrName: 'onDone',
    });
  });

  it('uses the alias when the spec contains a trailing identifier (any kind)', () => {
    expect(parseBindingSpec('myDir', 'localName', '<sourceAttr')).toEqual({
      mode: '<',
      optional: false,
      attrName: 'sourceAttr',
    });
    expect(parseBindingSpec('myDir', 'title', '@?heading')).toEqual({
      mode: '@',
      optional: true,
      attrName: 'heading',
    });
    expect(parseBindingSpec('myDir', 'value', '=onChange')).toEqual({
      mode: '=',
      optional: false,
      attrName: 'onChange',
    });
    expect(parseBindingSpec('myDir', 'cb', '&trigger')).toEqual({
      mode: '&',
      optional: false,
      attrName: 'trigger',
    });
  });

  it('defaults attrName to the local name when no alias is supplied', () => {
    expect(parseBindingSpec('myDir', 'someAttr', '<').attrName).toBe('someAttr');
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseBindingSpec('myDir', 'value', '  =  ')).toEqual({
      mode: '=',
      optional: false,
      attrName: 'value',
    });
    expect(parseBindingSpec('myDir', 'value', ' < src ')).toEqual({
      mode: '<',
      optional: false,
      attrName: 'src',
    });
  });

  it('throws InvalidIsolateBindingError for unparseable strings', () => {
    const cases: readonly string[] = [
      '', // empty
      'foo', // no leading kind
      '==', // double equals
      '==value', // double equals + alias
      '#bad', // bad leading char
      '=?9bad', // alias starts with digit
      '= name name', // two trailing identifiers
      '%', // unsupported kind
    ];
    for (const raw of cases) {
      expect(() => parseBindingSpec('myDir', 'value', raw)).toThrow(InvalidIsolateBindingError);
    }
  });

  it('rejects the deferred `=*` collection-mode form', () => {
    expect(() => parseBindingSpec('myDir', 'list', '=*')).toThrow(InvalidIsolateBindingError);
  });

  it('error message names the directive, the binding key, and the raw spec', () => {
    try {
      parseBindingSpec('myCard', 'value', '==');
      expect.fail('expected throw');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('myCard');
      expect(msg).toContain('value');
      expect(msg).toContain('==');
      // The message references the four-kind shape expected.
      expect(msg).toMatch(/=, @, <, &/);
    }
  });

  it('rejects a non-string runtime input', () => {
    // Defensive: `scope` value entries are typed `string` but consumer
    // code may pass arbitrary runtime values. The parser must still
    // throw a typed error rather than crashing on `.exec(non-string)`.
    expect(() => parseBindingSpec('myDir', 'value', 42 as unknown as string)).toThrow(InvalidIsolateBindingError);
  });
});

describe('parseIsolateBindings', () => {
  it('parses every entry in the scope map', () => {
    const result = parseIsolateBindings('myCard', {
      value: '=',
      title: '@',
      item: '<',
      onDone: '&',
      hint: '@?',
      name: '<sourceAttr',
    });
    expect(result).toEqual({
      value: { mode: '=', optional: false, attrName: 'value' },
      title: { mode: '@', optional: false, attrName: 'title' },
      item: { mode: '<', optional: false, attrName: 'item' },
      onDone: { mode: '&', optional: false, attrName: 'onDone' },
      hint: { mode: '@', optional: true, attrName: 'hint' },
      name: { mode: '<', optional: false, attrName: 'sourceAttr' },
    });
  });

  it('aborts on the first malformed entry', () => {
    expect(() =>
      parseIsolateBindings('myCard', {
        value: '=',
        bad: 'nope',
      }),
    ).toThrow(InvalidIsolateBindingError);
  });

  it('returns an empty map for an empty scope declaration', () => {
    expect(parseIsolateBindings('myCard', {})).toEqual({});
  });
});
