/**
 * `formatNumber` — internal numeric-formatting helper shared by the
 * `currency` and `number` built-in filters.
 *
 * Takes a finite `value`, a {@link NumberPattern}, a resolved
 * `fractionSize`, and the active {@link LocaleService}. Returns the
 * grouped-and-separated string. Special values (`NaN`, `Infinity`,
 * `-Infinity`) short-circuit per FS §2.15. The `¤` placeholder in the
 * pattern's prefix/suffix is preserved verbatim — symbol substitution
 * is the caller's job (the `currency` filter calls
 * `replace(/¤/g, sym)` after this helper returns).
 *
 * NOT re-exported from `@filter/index` — internal to the module per
 * technical-considerations §2.1.
 */

import type { LocaleService, NumberPattern } from './locale-types';

/**
 * Format `value` according to `pattern` and `locale`.
 *
 * Algorithm:
 * 1. Handle `NaN` (`''`), `Infinity` (`'∞'`), `-Infinity` (`'-∞'`).
 * 2. Capture sign; work with `Math.abs(value)`.
 * 3. Round to `fractionSize` decimal places using half-away-from-zero
 *    via `Math.round(value * 10**n) / 10**n`. Construct integer +
 *    fractional digit strings from the rounded value's `toFixed`
 *    representation — `toFixed` already pads to `fractionSize` digits.
 * 4. Pad integer part with leading zeros up to `pattern.minInt`.
 * 5. Apply group separator: rightmost group is `gSize` digits, every
 *    subsequent group is `lgSize` digits.
 * 6. Concatenate `integerPart + (frac ? DECIMAL_SEP + frac : '')`.
 * 7. Wrap with `posPre`/`posSuf` (positive) or `negPre`/`negSuf`
 *    (negative).
 *
 * The `fractionSize` parameter is taken as final — the caller is
 * responsible for clamping it against `pattern.minFrac` /
 * `pattern.maxFrac` and for deciding whether to trim trailing zeros
 * (the `number` filter does this; `currency` does not).
 */
export function formatNumber(
  value: number,
  pattern: NumberPattern,
  fractionSize: number,
  locale: LocaleService,
): string {
  if (Number.isNaN(value)) {
    return '';
  }
  if (value === Number.POSITIVE_INFINITY) {
    return '∞';
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return '-∞';
  }

  const isNegative = value < 0;
  const abs = Math.abs(value);

  // Round to `fractionSize` decimals via the abs trick. `Math.round`
  // is half-away-from-zero on positives; we always round the absolute
  // value, so negatives get the symmetric treatment AngularJS pins.
  const factor = Math.pow(10, fractionSize);
  const rounded = Math.round(abs * factor) / factor;

  // `toFixed(fractionSize)` produces "12345.6700" — exactly the
  // padded form the pattern needs. Empty fractional segment when
  // `fractionSize === 0` (`toFixed(0)` returns "12345" with no dot).
  const fixed = rounded.toFixed(fractionSize);
  const dotIndex = fixed.indexOf('.');
  const rawIntegerPart = dotIndex === -1 ? fixed : fixed.slice(0, dotIndex);
  const fractionPart = dotIndex === -1 ? '' : fixed.slice(dotIndex + 1);

  // Pad to `minInt` leading zeros if the integer part is shorter.
  let integerPart = rawIntegerPart;
  while (integerPart.length < pattern.minInt) {
    integerPart = `0${integerPart}`;
  }

  // Group from the right: rightmost group is `gSize`, all earlier
  // groups are `lgSize`. The first split takes the trailing `gSize`
  // digits; the loop chunks the head from the right at `lgSize`.
  const sep = locale.NUMBER_FORMATS.GROUP_SEP;
  let groupedInt: string;
  if (integerPart.length <= pattern.gSize) {
    groupedInt = integerPart;
  } else {
    const tail = integerPart.slice(integerPart.length - pattern.gSize);
    let head = integerPart.slice(0, integerPart.length - pattern.gSize);
    const headChunks: string[] = [];
    while (head.length > pattern.lgSize) {
      headChunks.unshift(head.slice(head.length - pattern.lgSize));
      head = head.slice(0, head.length - pattern.lgSize);
    }
    if (head.length > 0) {
      headChunks.unshift(head);
    }
    groupedInt = `${headChunks.join(sep)}${sep}${tail}`;
  }

  const decimalSep = locale.NUMBER_FORMATS.DECIMAL_SEP;
  const numberBody = fractionPart.length > 0 ? `${groupedInt}${decimalSep}${fractionPart}` : groupedInt;

  if (isNegative) {
    return `${pattern.negPre}${numberBody}${pattern.negSuf}`;
  }
  return `${pattern.posPre}${numberBody}${pattern.posSuf}`;
}
