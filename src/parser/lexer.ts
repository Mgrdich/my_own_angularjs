/**
 * Lexer for AngularJS expressions.
 *
 * Tokenizes an expression string into an array of {@link Token} objects.
 * Handles numbers (including scientific notation), strings (with escape sequences),
 * identifiers, keywords (`true`, `false`, `null`, `this`), and symbol characters.
 */

import type { Token } from './parse-types';
import { isKeyOf } from '@core/utils';

/** Escape sequence map for string literals. */
const ESCAPES = {
  n: '\n',
  f: '\f',
  r: '\r',
  t: '\t',
  v: '\v',
  "'": "'",
  '"': '"',
  '\\': '\\',
} as const satisfies Record<string, string>;

/** Keyword literals that produce a Token with a parsed value. */
const KEYWORDS = {
  true: true,
  false: false,
  null: null,
} as const satisfies Record<string, boolean | null>;

/** Characters that are single-character symbol tokens. */
const SYMBOLS = new Set(['[', ']', '{', '}', '(', ')', ',', ':']);

/**
 * Check whether a character is an ASCII digit.
 */
function isDigit(ch: string) {
  return ch >= '0' && ch <= '9';
}

/**
 * Check whether a character can start an identifier.
 */
function isIdentifierStart(ch: string) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
}

/**
 * Check whether a character can continue an identifier.
 */
function isIdentifierPart(ch: string) {
  return isIdentifierStart(ch) || isDigit(ch);
}

/**
 * Check whether a character is whitespace.
 */
function isWhitespace(ch: string) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/**
 * Check whether a character is valid in the exponent part of a number.
 */
function isExpOperator(ch: string) {
  return ch === '-' || ch === '+' || isDigit(ch);
}

/**
 * Tokenize an AngularJS expression string into an array of tokens.
 *
 * @param input - The expression string to tokenize
 * @returns Array of tokens
 * @throws When encountering invalid numbers, unterminated strings, or unexpected characters
 */
export function lex(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const ch = input.charAt(index);

    // Numbers: digit or dot-followed-by-digit
    if (isDigit(ch) || (ch === '.' && index + 1 < input.length && isDigit(input.charAt(index + 1)))) {
      index = readNumber(input, index, tokens);
      continue;
    }

    // Strings: single or double quote
    if (ch === "'" || ch === '"') {
      index = readString(input, index, tokens);
      continue;
    }

    // Dot as symbol (not followed by a digit — that case is handled above)
    if (ch === '.') {
      tokens.push({ text: '.' });
      index++;
      continue;
    }

    // Single-character symbols
    if (SYMBOLS.has(ch)) {
      tokens.push({ text: ch });
      index++;
      continue;
    }

    // Identifiers and keywords
    if (isIdentifierStart(ch)) {
      index = readIdentifier(input, index, tokens);
      continue;
    }

    // Whitespace — skip silently
    if (isWhitespace(ch)) {
      index++;
      continue;
    }

    throw new Error(`Unexpected next character: ${ch}`);
  }

  return tokens;
}

/**
 * Read a number token starting at `start`. Handles integers, floats, and scientific notation.
 *
 * @returns The index position after the number
 */
function readNumber(input: string, start: number, tokens: Token[]) {
  let index = start;
  let numberStr = '';

  while (index < input.length) {
    const ch = input.charAt(index).toLowerCase();

    if (ch === '.' || isDigit(ch)) {
      numberStr += ch;
    } else if (ch === 'e') {
      const nextCh = index + 1 < input.length ? input.charAt(index + 1) : '';
      if (isExpOperator(nextCh)) {
        numberStr += ch;
      } else {
        throw new Error('Invalid exponent');
      }
    } else if (ch === '+' || ch === '-') {
      const prevCh = numberStr.charAt(numberStr.length - 1);
      const nextCh = index + 1 < input.length ? input.charAt(index + 1) : '';
      if (prevCh === 'e' && nextCh !== '' && isDigit(nextCh)) {
        numberStr += ch;
      } else if (prevCh === 'e') {
        throw new Error('Invalid exponent');
      } else {
        break;
      }
    } else {
      break;
    }

    index++;
  }

  tokens.push({ text: numberStr, value: Number(numberStr) });
  return index;
}

/**
 * Read a string token starting at `start` (the opening quote character).
 * Handles escape sequences including `\n`, `\t`, `\\`, `\'`, `\"`, and `\uXXXX`.
 *
 * @returns The index position after the closing quote
 */
function readString(input: string, start: number, tokens: Token[]) {
  const quote = input.charAt(start);
  let index = start + 1; // skip opening quote
  let str = '';
  let escape = false;

  while (index < input.length) {
    const ch = input.charAt(index);

    if (escape) {
      if (ch === 'u') {
        const hex = input.substring(index + 1, index + 5);
        if (!/[\da-f]{4}/i.test(hex)) {
          throw new Error('Invalid unicode escape');
        }
        index += 4; // skip the 4 hex digits
        str += String.fromCharCode(parseInt(hex, 16));
      } else if (isKeyOf(ESCAPES, ch)) {
        str += ESCAPES[ch];
      } else {
        str += ch;
      }
      escape = false;
    } else if (ch === quote) {
      // Closing quote found
      index++;
      tokens.push({ text: str, value: str });
      return index;
    } else if (ch === '\\') {
      escape = true;
    } else {
      str += ch;
    }

    index++;
  }

  throw new Error('Unmatched quote');
}

/**
 * Read an identifier or keyword token starting at `start`.
 * Keywords `true`, `false`, and `null` produce tokens with parsed values.
 * The keyword `this` produces an identifier token.
 *
 * @returns The index position after the identifier
 */
function readIdentifier(input: string, start: number, tokens: Token[]) {
  let index = start;
  let text = '';

  while (index < input.length) {
    const ch = input.charAt(index);
    if (isIdentifierPart(ch)) {
      text += ch;
    } else {
      break;
    }
    index++;
  }

  // Keywords (true, false, null) are pushed without identifier flag
  // so the AST builder can distinguish them from regular identifiers.
  // Their value is resolved by the AST builder via the CONSTANTS table.
  if (isKeyOf(KEYWORDS, text)) {
    tokens.push({ text });
    return index;
  }

  tokens.push({ text, identifier: true });
  return index;
}
