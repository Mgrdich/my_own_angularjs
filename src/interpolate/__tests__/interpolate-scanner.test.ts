import { describe, it, expect } from 'vitest';
import { scan } from '@interpolate/interpolate-scanner';

describe('interpolate scanner', () => {
  describe('plain text (no markers)', () => {
    it('returns a single text segment and no expressions', () => {
      const result = scan('hello world', '{{', '}}');
      expect(result.textSegments).toEqual(['hello world']);
      expect(result.expressions).toEqual([]);
    });

    it('returns an empty text segment for empty input', () => {
      const result = scan('', '{{', '}}');
      expect(result.textSegments).toEqual(['']);
      expect(result.expressions).toEqual([]);
    });
  });

  describe('single expression', () => {
    it('splits leading text and expression with trailing empty segment', () => {
      const result = scan('Hello {{name}}', '{{', '}}');
      expect(result.textSegments).toEqual(['Hello ', '']);
      expect(result.expressions).toEqual(['name']);
    });

    it('splits expression with leading and trailing text', () => {
      const result = scan('Hello {{name}}!', '{{', '}}');
      expect(result.textSegments).toEqual(['Hello ', '!']);
      expect(result.expressions).toEqual(['name']);
    });

    it('handles an expression with no surrounding text', () => {
      const result = scan('{{name}}', '{{', '}}');
      expect(result.textSegments).toEqual(['', '']);
      expect(result.expressions).toEqual(['name']);
    });
  });

  describe('multiple expressions', () => {
    it('splits two expressions separated by text', () => {
      const result = scan('{{a}} and {{b}}', '{{', '}}');
      expect(result.textSegments).toEqual(['', ' and ', '']);
      expect(result.expressions).toEqual(['a', 'b']);
    });

    it('splits three expressions with interleaved text', () => {
      const result = scan('pre {{x}} mid {{y}} and {{z}} post', '{{', '}}');
      expect(result.textSegments).toEqual(['pre ', ' mid ', ' and ', ' post']);
      expect(result.expressions).toEqual(['x', 'y', 'z']);
    });
  });

  describe('adjacent expressions', () => {
    it('yields an empty text segment between adjacent markers', () => {
      const result = scan('{{a}}{{b}}', '{{', '}}');
      expect(result.textSegments).toEqual(['', '', '']);
      expect(result.expressions).toEqual(['a', 'b']);
    });
  });

  describe('errors', () => {
    it('throws for an unterminated expression', () => {
      expect(() => scan('Hello {{name', '{{', '}}')).toThrow(
        /Unterminated expression in interpolation: Hello \{\{name/,
      );
    });

    it('throws for an empty expression body', () => {
      expect(() => scan('{{}}', '{{', '}}')).toThrow(/Empty expression in interpolation string: \{\{\}\}/);
    });

    it('throws for a whitespace-only expression body', () => {
      expect(() => scan('x {{ }} y', '{{', '}}')).toThrow(/Empty expression in interpolation string: x \{\{ \}\} y/);
    });
  });

  describe('one-time binding prefix', () => {
    it('retains the :: prefix verbatim in the raw expression', () => {
      const result = scan('Hello {{::name}}', '{{', '}}');
      expect(result.expressions).toEqual(['::name']);
      expect(result.textSegments).toEqual(['Hello ', '']);
    });

    it('retains :: for each one-time expression in a multi-expression template', () => {
      const result = scan('{{::a}} and {{::b}}', '{{', '}}');
      expect(result.expressions).toEqual(['::a', '::b']);
    });
  });

  describe('custom delimiters', () => {
    it('scans plain text with no markers against custom delimiters', () => {
      const result = scan('hello world', '[[', ']]');
      expect(result.textSegments).toEqual(['hello world']);
      expect(result.expressions).toEqual([]);
    });

    it('scans a single expression with custom delimiters', () => {
      const result = scan('Hello [[name]]!', '[[', ']]');
      expect(result.textSegments).toEqual(['Hello ', '!']);
      expect(result.expressions).toEqual(['name']);
    });

    it('scans multiple expressions with custom delimiters', () => {
      const result = scan('[[a]] and [[b]]', '[[', ']]');
      expect(result.textSegments).toEqual(['', ' and ', '']);
      expect(result.expressions).toEqual(['a', 'b']);
    });
  });

  describe('escape sequences in literal text', () => {
    it('unescapes a fully-escaped opening delimiter into literal text', () => {
      const result = scan('\\{\\{not an expression\\}\\}', '{{', '}}');
      expect(result.textSegments).toEqual(['{{not an expression}}']);
      expect(result.expressions).toEqual([]);
    });

    it('unescapes a lone escaped opening delimiter with no closing escape', () => {
      const result = scan('pre \\{\\{ mid', '{{', '}}');
      expect(result.textSegments).toEqual(['pre {{ mid']);
      expect(result.expressions).toEqual([]);
    });

    it('unescapes a lone escaped closing delimiter', () => {
      const result = scan('pre \\}\\} post', '{{', '}}');
      expect(result.textSegments).toEqual(['pre }} post']);
      expect(result.expressions).toEqual([]);
    });

    it('leaves a single partial escape (\\{) unchanged because AngularJS only unescapes full delimiter sequences', () => {
      // AngularJS parity: the escape regex is built per-character against the
      // FULL delimiter — `\{` alone is NOT treated as an escape and passes through.
      const result = scan('a \\{ b', '{{', '}}');
      expect(result.textSegments).toEqual(['a \\{ b']);
      expect(result.expressions).toEqual([]);
    });
  });

  describe('escape sequences inside expression body', () => {
    it('passes backslashes inside an expression body through verbatim to parse()', () => {
      // The scanner does not interpret escapes inside an expression body — the
      // raw expression source is whatever lies between start and end markers.
      const result = scan('{{a\\+b}}', '{{', '}}');
      expect(result.expressions).toEqual(['a\\+b']);
      expect(result.textSegments).toEqual(['', '']);
    });

    it('does not treat \\}\\} inside an expression body as a closing escape', () => {
      // `\}\}` has no literal `}}` in it, so the next real `}}` closes the
      // expression and the `\}\}` becomes part of the raw expression source.
      const result = scan('{{a\\}\\}b}}', '{{', '}}');
      expect(result.expressions).toEqual(['a\\}\\}b']);
      expect(result.textSegments).toEqual(['', '']);
    });
  });

  describe('mixed escape + expression', () => {
    it('unescapes literal delimiters around a real expression', () => {
      const result = scan('{{a}} and \\{\\{literal\\}\\}', '{{', '}}');
      expect(result.textSegments).toEqual(['', ' and {{literal}}']);
      expect(result.expressions).toEqual(['a']);
    });

    it('unescapes literal delimiters before a real expression', () => {
      const result = scan('\\{\\{literal\\}\\} and {{b}}', '{{', '}}');
      expect(result.textSegments).toEqual(['{{literal}} and ', '']);
      expect(result.expressions).toEqual(['b']);
    });
  });

  describe('custom delimiters with escape', () => {
    it('unescapes per-character backslash escapes against custom delimiters', () => {
      // AngularJS builds the escape regex per-character of the delimiter, so
      // `\[\[` / `\]\]` escape `[[` / `]]` the same way `\{\{` escapes `{{`.
      const result = scan('\\[\\[literal\\]\\]', '[[', ']]');
      expect(result.textSegments).toEqual(['[[literal]]']);
      expect(result.expressions).toEqual([]);
    });

    it('unescapes custom delimiters around a real expression', () => {
      const result = scan('[[a]] and \\[\\[literal\\]\\]', '[[', ']]');
      expect(result.textSegments).toEqual(['', ' and [[literal]]']);
      expect(result.expressions).toEqual(['a']);
    });
  });

  describe('escape-position edge cases (Slice 7 parity)', () => {
    it('preserves a backslash followed by a non-delimiter character verbatim', () => {
      // `a\b` (JS source: `'a\\b'`) has no delimiter-matching escape sequence,
      // so the backslash passes through untouched.
      const result = scan('a\\b', '{{', '}}');
      expect(result.textSegments).toEqual(['a\\b']);
      expect(result.expressions).toEqual([]);
    });

    it('unescapes a leading escaped-delimiter pair at the very start of the input', () => {
      const result = scan('\\{\\{a\\}\\}trailing', '{{', '}}');
      expect(result.textSegments).toEqual(['{{a}}trailing']);
      expect(result.expressions).toEqual([]);
    });

    it('unescapes a trailing escaped-delimiter pair at the very end of the input', () => {
      const result = scan('leading\\{\\{a\\}\\}', '{{', '}}');
      expect(result.textSegments).toEqual(['leading{{a}}']);
      expect(result.expressions).toEqual([]);
    });

    it('unescapes two consecutive escaped delimiter pairs (no real expression)', () => {
      // `\{\{a\}\}\{\{b\}\}` → `{{a}}{{b}}` — both pairs are literal text.
      const result = scan('\\{\\{a\\}\\}\\{\\{b\\}\\}', '{{', '}}');
      expect(result.textSegments).toEqual(['{{a}}{{b}}']);
      expect(result.expressions).toEqual([]);
    });

    it('handles escape-expression-escape interleaved in one template', () => {
      const result = scan('\\{\\{x\\}\\} {{y}} \\{\\{z\\}\\}', '{{', '}}');
      expect(result.textSegments).toEqual(['{{x}} ', ' {{z}}']);
      expect(result.expressions).toEqual(['y']);
    });
  });

  describe('alternative custom delimiters (Slice 7 parity)', () => {
    it('scans a template using Rails/ERB-style <% / %> delimiters', () => {
      const result = scan('Value: <%x%>', '<%', '%>');
      expect(result.textSegments).toEqual(['Value: ', '']);
      expect(result.expressions).toEqual(['x']);
    });

    it('scans a template using single-character distinct delimiters (# and $)', () => {
      // Single-char delimiters are permitted when they differ — `#x$` is a
      // valid expression body between them.
      const result = scan('pre #x$ post', '#', '$');
      expect(result.textSegments).toEqual(['pre ', ' post']);
      expect(result.expressions).toEqual(['x']);
    });

    it('scans a template using multi-character asymmetric <<< / >>> delimiters', () => {
      const result = scan('a <<<x>>> b <<<y>>> c', '<<<', '>>>');
      expect(result.textSegments).toEqual(['a ', ' b ', ' c']);
      expect(result.expressions).toEqual(['x', 'y']);
    });
  });
});
