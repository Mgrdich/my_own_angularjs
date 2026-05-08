import { describe, expect, it } from 'vitest';
import { lex } from '@parser/lexer';

describe('lex — pipe (`|`) token', () => {
  it('preserves `||` as a single logical-OR token', () => {
    const tokens = lex('a||b');
    expect(tokens.map((t) => t.text)).toEqual(['a', '||', 'b']);
  });

  it('emits `|` as a standalone single-character symbol token', () => {
    const tokens = lex('a|b');
    expect(tokens.map((t) => t.text)).toEqual(['a', '|', 'b']);
  });

  it('preserves the identifier flag on identifiers around a pipe', () => {
    const tokens = lex('a|b');
    expect(tokens[0]?.identifier).toBe(true);
    expect(tokens[1]?.identifier).toBeUndefined();
    expect(tokens[2]?.identifier).toBe(true);
  });

  it('chains multiple `|` tokens left-to-right', () => {
    const tokens = lex('a|b|c');
    expect(tokens.map((t) => t.text)).toEqual(['a', '|', 'b', '|', 'c']);
  });

  it('is whitespace-tolerant: `a | b` matches `a|b`', () => {
    expect(lex('a | b').map((t) => t.text)).toEqual(lex('a|b').map((t) => t.text));
  });

  it('does not mis-tokenize `||` when wedged between identifiers with whitespace', () => {
    const tokens = lex('foo || bar');
    expect(tokens.map((t) => t.text)).toEqual(['foo', '||', 'bar']);
  });

  it('handles a pipe followed by a colon-separated argument list', () => {
    const tokens = lex('value | f : 1 : 2');
    expect(tokens.map((t) => t.text)).toEqual(['value', '|', 'f', ':', '1', ':', '2']);
  });
});
