import { describe, it, expect } from 'vitest';
import { lex } from '@parser/lexer';
import { buildAST } from '@parser/ast';
import { containsStatefulFilter, isConstant, isLiteral } from '@parser/ast-flags';
import type { FilterFn, FilterService } from '@filter/filter-types';

/**
 * Drive the full lex → buildAST pipeline so tests exercise real AST nodes
 * instead of hand-authored fixtures that could drift from the parser's shape.
 */
function astOf(expr: string) {
  return buildAST(lex(expr));
}

describe('isConstant', () => {
  describe('primitives', () => {
    const cases: Array<[string, boolean]> = [
      ['42', true],
      ["'x'", true],
      ['"string"', true],
      ['true', true],
      ['false', true],
      ['null', true],
    ];

    cases.forEach(([expr, expected]) => {
      it(`isConstant(${JSON.stringify(expr)}) === ${String(expected)}`, () => {
        expect(isConstant(astOf(expr).body)).toBe(expected);
      });
    });
  });

  describe('identifiers and this', () => {
    const cases: Array<[string, boolean]> = [
      ['a', false],
      ['this', false],
    ];

    cases.forEach(([expr, expected]) => {
      it(`isConstant(${JSON.stringify(expr)}) === ${String(expected)}`, () => {
        expect(isConstant(astOf(expr).body)).toBe(expected);
      });
    });
  });

  describe('member access', () => {
    const cases: Array<[string, boolean]> = [
      ['a.b', false],
      ['a[b]', false],
      ['a.b.c', false],
    ];

    cases.forEach(([expr, expected]) => {
      it(`isConstant(${JSON.stringify(expr)}) === ${String(expected)}`, () => {
        expect(isConstant(astOf(expr).body)).toBe(expected);
      });
    });
  });

  describe('call expressions', () => {
    const cases: Array<[string, boolean]> = [
      ['fn()', false],
      ['fn(1, 2)', false],
      ['a.b(c)', false],
    ];

    cases.forEach(([expr, expected]) => {
      it(`isConstant(${JSON.stringify(expr)}) === ${String(expected)}`, () => {
        expect(isConstant(astOf(expr).body)).toBe(expected);
      });
    });
  });

  describe('assignment', () => {
    const cases: Array<[string, boolean]> = [
      ['a = 1', false],
      ['a.b = 2', false],
    ];

    cases.forEach(([expr, expected]) => {
      it(`isConstant(${JSON.stringify(expr)}) === ${String(expected)}`, () => {
        expect(isConstant(astOf(expr).body)).toBe(expected);
      });
    });
  });

  describe('arrays', () => {
    describe('of constants → true', () => {
      const cases: Array<[string, boolean]> = [
        ['[]', true],
        ['[1, 2, 3]', true],
        ["[1, 'x', true]", true],
        ['[[1, 2], [3, 4]]', true],
      ];

      cases.forEach(([expr, expected]) => {
        it(`isConstant(${JSON.stringify(expr)}) === ${String(expected)}`, () => {
          expect(isConstant(astOf(expr).body)).toBe(expected);
        });
      });
    });

    describe('with identifier → false', () => {
      const cases: Array<[string, boolean]> = [
        ['[a]', false],
        ['[1, a]', false],
        ['[1, [a]]', false],
      ];

      cases.forEach(([expr, expected]) => {
        it(`isConstant(${JSON.stringify(expr)}) === ${String(expected)}`, () => {
          expect(isConstant(astOf(expr).body)).toBe(expected);
        });
      });
    });
  });

  describe('objects', () => {
    describe('of constants → true', () => {
      const cases: Array<[string, boolean]> = [
        ['{}', true],
        ['{x: 1}', true],
        ["{x: 1, y: 'a'}", true],
        ['{x: {y: 1}}', true],
      ];

      cases.forEach(([expr, expected]) => {
        it(`isConstant(${JSON.stringify(expr)}) === ${String(expected)}`, () => {
          expect(isConstant(astOf(expr).body)).toBe(expected);
        });
      });
    });

    describe('with identifier value → false', () => {
      const cases: Array<[string, boolean]> = [
        ['{x: a}', false],
        ['{x: 1, y: b}', false],
      ];

      cases.forEach(([expr, expected]) => {
        it(`isConstant(${JSON.stringify(expr)}) === ${String(expected)}`, () => {
          expect(isConstant(astOf(expr).body)).toBe(expected);
        });
      });
    });
  });

  describe('unary', () => {
    describe('over constants → true', () => {
      const cases: Array<[string, boolean]> = [
        ['!true', true],
        ['-1', true],
        ['+2', true],
        ['!!0', true],
      ];

      cases.forEach(([expr, expected]) => {
        it(`isConstant(${JSON.stringify(expr)}) === ${String(expected)}`, () => {
          expect(isConstant(astOf(expr).body)).toBe(expected);
        });
      });
    });

    describe('over identifier → false', () => {
      const cases: Array<[string, boolean]> = [
        ['!a', false],
        ['-a', false],
      ];

      cases.forEach(([expr, expected]) => {
        it(`isConstant(${JSON.stringify(expr)}) === ${String(expected)}`, () => {
          expect(isConstant(astOf(expr).body)).toBe(expected);
        });
      });
    });
  });

  describe('binary', () => {
    describe('over constants → true', () => {
      const cases: Array<[string, boolean]> = [
        ['1 + 2', true],
        ['3 * 4', true],
        ["'a' + 'b'", true],
        ['1 == 1', true],
        ['2 < 3', true],
      ];

      cases.forEach(([expr, expected]) => {
        it(`isConstant(${JSON.stringify(expr)}) === ${String(expected)}`, () => {
          expect(isConstant(astOf(expr).body)).toBe(expected);
        });
      });
    });

    describe('with identifier → false', () => {
      const cases: Array<[string, boolean]> = [
        ['a + 1', false],
        ['1 + a', false],
        ['a == b', false],
      ];

      cases.forEach(([expr, expected]) => {
        it(`isConstant(${JSON.stringify(expr)}) === ${String(expected)}`, () => {
          expect(isConstant(astOf(expr).body)).toBe(expected);
        });
      });
    });
  });

  describe('logical', () => {
    describe('over constants → true', () => {
      const cases: Array<[string, boolean]> = [
        ['true && false', true],
        ['1 || 0', true],
      ];

      cases.forEach(([expr, expected]) => {
        it(`isConstant(${JSON.stringify(expr)}) === ${String(expected)}`, () => {
          expect(isConstant(astOf(expr).body)).toBe(expected);
        });
      });
    });

    describe('with identifier → false', () => {
      const cases: Array<[string, boolean]> = [
        ['a && true', false],
        ['true && a', false],
      ];

      cases.forEach(([expr, expected]) => {
        it(`isConstant(${JSON.stringify(expr)}) === ${String(expected)}`, () => {
          expect(isConstant(astOf(expr).body)).toBe(expected);
        });
      });
    });
  });

  describe('ternary', () => {
    describe('over constants → true', () => {
      const cases: Array<[string, boolean]> = [
        ['true ? 1 : 2', true],
        ["1 ? 'x' : 'y'", true],
      ];

      cases.forEach(([expr, expected]) => {
        it(`isConstant(${JSON.stringify(expr)}) === ${String(expected)}`, () => {
          expect(isConstant(astOf(expr).body)).toBe(expected);
        });
      });
    });

    describe('with identifier → false', () => {
      const cases: Array<[string, boolean]> = [
        ['a ? 1 : 2', false],
        ['true ? a : 2', false],
        ['true ? 1 : a', false],
      ];

      cases.forEach(([expr, expected]) => {
        it(`isConstant(${JSON.stringify(expr)}) === ${String(expected)}`, () => {
          expect(isConstant(astOf(expr).body)).toBe(expected);
        });
      });
    });
  });
});

describe('isLiteral', () => {
  describe('primitive bodies → true', () => {
    const cases: Array<[string, boolean]> = [
      ['42', true],
      ["'x'", true],
      ['true', true],
      ['null', true],
    ];

    cases.forEach(([expr, expected]) => {
      it(`isLiteral(${JSON.stringify(expr)}) === ${String(expected)}`, () => {
        expect(isLiteral(astOf(expr))).toBe(expected);
      });
    });
  });

  describe('array bodies → true (non-recursive: contents do not matter)', () => {
    const cases: Array<[string, boolean]> = [
      ['[]', true],
      ['[1, 2]', true],
      ['[a, b]', true],
      ['[[1, 2]]', true],
    ];

    cases.forEach(([expr, expected]) => {
      it(`isLiteral(${JSON.stringify(expr)}) === ${String(expected)}`, () => {
        expect(isLiteral(astOf(expr))).toBe(expected);
      });
    });
  });

  describe('object bodies → true (non-recursive: contents do not matter)', () => {
    const cases: Array<[string, boolean]> = [
      ['{}', true],
      ['{x: 1}', true],
      ['{x: a}', true],
    ];

    cases.forEach(([expr, expected]) => {
      it(`isLiteral(${JSON.stringify(expr)}) === ${String(expected)}`, () => {
        expect(isLiteral(astOf(expr))).toBe(expected);
      });
    });
  });

  describe('non-literal bodies → false', () => {
    const cases: Array<[string, boolean]> = [
      ['a', false],
      ['a.b', false],
      ['fn()', false],
      ['a = 1', false],
      ['1 + 2', false],
      ['!a', false],
      ['true && false', false],
      ['a ? 1 : 2', false],
      ['this', false],
    ];

    cases.forEach(([expr, expected]) => {
      it(`isLiteral(${JSON.stringify(expr)}) === ${String(expected)}`, () => {
        expect(isLiteral(astOf(expr))).toBe(expected);
      });
    });
  });
});

describe('containsStatefulFilter', () => {
  const stateless: FilterFn = (v: unknown) => v;
  const stateful: FilterFn = Object.assign((v: unknown) => v, { $stateful: true });
  const lookup =
    (registry: Record<string, FilterFn>): FilterService =>
    (name: string) => {
      const fn = registry[name];
      if (!fn) {
        throw new Error(`Unknown filter: ${name}`);
      }
      return fn;
    };

  it('returns false for an expression with no filters', () => {
    const $filter = lookup({});
    expect(containsStatefulFilter(astOf('a + b').body, $filter)).toBe(false);
  });

  it('returns false when every filter in the chain is stateless', () => {
    const $filter = lookup({ a: stateless, b: stateless });
    expect(containsStatefulFilter(astOf('value | a | b').body, $filter)).toBe(false);
  });

  it('returns true when any filter in the chain is stateful', () => {
    const $filter = lookup({ a: stateless, b: stateful });
    expect(containsStatefulFilter(astOf('value | a | b').body, $filter)).toBe(true);
  });

  it('returns true when a stateful filter sits at the head of the chain', () => {
    const $filter = lookup({ a: stateful, b: stateless });
    expect(containsStatefulFilter(astOf('value | a | b').body, $filter)).toBe(true);
  });

  it('walks into filter arguments and detects nested stateful filters', () => {
    const $filter = lookup({ outer: stateless, nested: stateful });
    // The nested filter sits inside an argument expression. The walk must
    // descend into argument trees.
    expect(containsStatefulFilter(astOf('value | outer : (n | nested)').body, $filter)).toBe(true);
  });

  it('walks into the filter input and detects upstream stateful filters', () => {
    const $filter = lookup({ outer: stateless, inner: stateful });
    // Equivalent shape: outer's input is itself a filter expression.
    expect(containsStatefulFilter(astOf('value | inner | outer').body, $filter)).toBe(true);
  });

  it('walks structural nodes (binary, conditional, call) without filters', () => {
    const $filter = lookup({});
    expect(containsStatefulFilter(astOf('a + b * c').body, $filter)).toBe(false);
    expect(containsStatefulFilter(astOf('a ? b : c').body, $filter)).toBe(false);
    expect(containsStatefulFilter(astOf('fn(a, b)').body, $filter)).toBe(false);
    expect(containsStatefulFilter(astOf('[1, 2, 3]').body, $filter)).toBe(false);
    expect(containsStatefulFilter(astOf('{a: 1, b: 2}').body, $filter)).toBe(false);
  });
});
