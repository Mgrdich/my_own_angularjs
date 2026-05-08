import { describe, expect, it } from 'vitest';
import { lex } from '@parser/lexer';
import { buildAST } from '@parser/ast';
import type { ASTNode } from '@parser/parse-types';

function astBodyOf(expr: string): ASTNode {
  return buildAST(lex(expr)).body;
}

describe('buildAST — filter chain', () => {
  it('produces a FilterExpression for `value | uppercase`', () => {
    const body = astBodyOf('value | uppercase');
    expect(body).toEqual({
      type: 'FilterExpression',
      input: { type: 'Identifier', name: 'value' },
      name: 'uppercase',
      arguments: [],
    });
  });

  it('chains filters left-to-right: `a | f1 | f2` is `f2(f1(a))`', () => {
    const body = astBodyOf('a | f1 | f2');
    expect(body).toEqual({
      type: 'FilterExpression',
      input: {
        type: 'FilterExpression',
        input: { type: 'Identifier', name: 'a' },
        name: 'f1',
        arguments: [],
      },
      name: 'f2',
      arguments: [],
    });
  });

  it('collects colon-separated arguments after the filter name', () => {
    const body = astBodyOf('value | filterName : arg1 : arg2');
    expect(body.type).toBe('FilterExpression');
    if (body.type === 'FilterExpression') {
      expect(body.name).toBe('filterName');
      expect(body.arguments).toEqual([
        { type: 'Identifier', name: 'arg1' },
        { type: 'Identifier', name: 'arg2' },
      ]);
    }
  });

  it('parses each filter argument as a full expression', () => {
    const body = astBodyOf('items | limitTo : count + 1 : start');
    expect(body.type).toBe('FilterExpression');
    if (body.type === 'FilterExpression') {
      expect(body.arguments).toHaveLength(2);
      expect(body.arguments[0]).toEqual({
        type: 'BinaryExpression',
        operator: '+',
        left: { type: 'Identifier', name: 'count' },
        right: { type: 'Literal', value: 1 },
      });
      expect(body.arguments[1]).toEqual({ type: 'Identifier', name: 'start' });
    }
  });

  it('binds the filter to the result of `+` (filter has lower precedence than additive)', () => {
    const body = astBodyOf('a + b | uppercase');
    expect(body).toEqual({
      type: 'FilterExpression',
      input: {
        type: 'BinaryExpression',
        operator: '+',
        left: { type: 'Identifier', name: 'a' },
        right: { type: 'Identifier', name: 'b' },
      },
      name: 'uppercase',
      arguments: [],
    });
  });

  it('binds the filter to the entire ternary (filter has lower precedence than `?:`)', () => {
    const body = astBodyOf('a ? b : c | uppercase');
    expect(body).toEqual({
      type: 'FilterExpression',
      input: {
        type: 'ConditionalExpression',
        test: { type: 'Identifier', name: 'a' },
        consequent: { type: 'Identifier', name: 'b' },
        alternate: { type: 'Identifier', name: 'c' },
      },
      name: 'uppercase',
      arguments: [],
    });
  });

  it('parses `a = b | f` as `a = (b | f)`', () => {
    const body = astBodyOf('a = b | f');
    expect(body).toEqual({
      type: 'AssignmentExpression',
      left: { type: 'Identifier', name: 'a' },
      right: {
        type: 'FilterExpression',
        input: { type: 'Identifier', name: 'b' },
        name: 'f',
        arguments: [],
      },
    });
  });

  it('throws on `a | f = b` because a FilterExpression is not an l-value', () => {
    expect(() => astBodyOf('a | f = b')).toThrow(/non l-value/);
  });

  it('does not collide with `||` — `a || b` still produces a LogicalExpression', () => {
    const body = astBodyOf('a || b');
    expect(body).toEqual({
      type: 'LogicalExpression',
      operator: '||',
      left: { type: 'Identifier', name: 'a' },
      right: { type: 'Identifier', name: 'b' },
    });
  });

  it('produces equivalent ASTs regardless of whitespace around `|` and `:`', () => {
    expect(astBodyOf('a|f:1:2')).toEqual(astBodyOf('a | f : 1 : 2'));
  });
});
