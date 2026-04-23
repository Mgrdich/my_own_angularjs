/**
 * Scanner for interpolation templates.
 *
 * Splits an input string into alternating literal text chunks and raw
 * expression sources, delimited by a configurable pair of symbols (defaults
 * are `{{` / `}}`). The scanner is pure — all validation and error surfacing
 * happens at scan time, independent of expression parsing.
 *
 * Escape semantics (AngularJS 1.x parity — `angular.js:src/ng/interpolate.js`):
 * A backslash before EACH character of the start or end symbol produces a
 * literal delimiter in the emitted text segment (e.g. `\{\{` → `{{`). Because
 * `indexOf` never matches `{{` inside `\{\{`, escaped delimiters are naturally
 * skipped during scanning; the only extra work is stripping the backslashes
 * from the emitted text segments. Escapes are recognised ONLY in literal text
 * state — inside an expression body the scanner passes every character
 * through to `parse()` verbatim, backslashes included.
 */

export interface ScanResult {
  readonly textSegments: string[];
  readonly expressions: string[];
}

/**
 * Scan an interpolation template into text segments and raw expression sources.
 *
 * Invariants:
 * - `textSegments.length === expressions.length + 1`
 * - When `expressions.length === 0`, `textSegments === [unescape(text)]` (single literal chunk)
 * - Adjacent expressions produce empty string separators in `textSegments`
 * - The `::` one-time prefix is retained verbatim in the raw expression source
 *
 * @throws if an opening `startSymbol` has no matching closing `endSymbol`
 * @throws if an expression body is empty or whitespace-only
 */
export function scan(text: string, startSymbol: string, endSymbol: string): ScanResult {
  const textSegments: string[] = [];
  const expressions: string[] = [];

  const startLen = startSymbol.length;
  const endLen = endSymbol.length;

  const escapedStartRegexp = buildEscapedDelimiterRegExp(startSymbol);
  const escapedEndRegexp = buildEscapedDelimiterRegExp(endSymbol);
  const unescape = (segment: string) =>
    segment.replace(escapedStartRegexp, startSymbol).replace(escapedEndRegexp, endSymbol);

  let index = 0;
  while (index < text.length) {
    const startIdx = text.indexOf(startSymbol, index);
    if (startIdx === -1) {
      textSegments.push(unescape(text.slice(index)));
      return { textSegments, expressions };
    }

    textSegments.push(unescape(text.slice(index, startIdx)));

    const exprStart = startIdx + startLen;
    const endIdx = text.indexOf(endSymbol, exprStart);
    if (endIdx === -1) {
      throw new Error(`Unterminated expression in interpolation: ${text}`);
    }

    const rawExpression = text.slice(exprStart, endIdx);
    if (rawExpression.trim().length === 0) {
      throw new Error(`Empty expression in interpolation string: ${text}`);
    }
    expressions.push(rawExpression);

    index = endIdx + endLen;
  }

  // Loop exited because we consumed everything right after a closing delimiter —
  // append an empty trailing segment so `textSegments.length === expressions.length + 1`.
  textSegments.push('');
  return { textSegments, expressions };
}

/**
 * Build a global regex that matches `delimiter` preceded by a backslash escape
 * on EVERY character (AngularJS parity — `\{\{` for `{{`, `\[\[` for `[[`).
 * Each character of the delimiter is regex-escaped so arbitrary delimiter
 * shapes (including regex metachars like `[` or `.`) are matched literally.
 */
function buildEscapedDelimiterRegExp(delimiter: string) {
  let pattern = '';
  for (const ch of delimiter) {
    pattern += '\\\\' + escapeRegExpChar(ch);
  }
  return new RegExp(pattern, 'g');
}

function escapeRegExpChar(ch: string) {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
