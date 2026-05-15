/**
 * `formatDate` — internal datetime-formatting helper used by the `date`
 * built-in filter.
 *
 * Takes a value (Date / numeric ms / ISO-8601 string / null / undefined),
 * a format string (token-based or named), an optional `timezone`
 * argument, and the active {@link LocaleService}. Returns the formatted
 * string. Special values (`null` / `undefined`) short-circuit to `''`;
 * non-parseable strings return the input unchanged (FS §2.16).
 *
 * NOT re-exported from `@filter/index` — internal to the module per
 * technical-considerations §2.1.
 *
 * Algorithm:
 *
 * 1. Null / undefined → `''`.
 * 2. Parse `input` to a `Date`:
 *    - Date instance → use as-is.
 *    - number → `new Date(input)`.
 *    - string → try ISO-8601 component parse first (matches AngularJS's
 *      `R_ISO8601_STR` regex), fall through to `Date.parse`. Invalid →
 *      return the input unchanged.
 * 3. Resolve named formats (`'medium'` etc.) against
 *    `locale.DATETIME_FORMATS` — substitute once, then re-scan.
 * 4. If `timezone` is provided, build a "shifted Date" so that UTC
 *    accessors return values for the requested zone. `'UTC'` shifts by
 *    the local timezone offset; `±HHmm` parses the offset and shifts
 *    accordingly.
 * 5. Scan the format string for tokens, longest-first. Honor
 *    single-quoted literal runs (`'literal'` emits the literal text
 *    minus the surrounding quotes; `''` emits one literal apostrophe).
 *    Outside quotes, match each token in the static dispatch table by
 *    descending key length; un-matched characters emit verbatim.
 */

import type { DatetimeFormats, LocaleService } from './locale-types';

/** ISO-8601 regex matching AngularJS's `R_ISO8601_STR`. Captures: year, month, day, hour, minute, second, ms, tz-sign, tz-hours, tz-minutes. */
const ISO_8601_REGEX =
  /^(\d{4})-?(\d\d)-?(\d\d)(?:T(\d\d)(?::?(\d\d)(?::?(\d\d)(?:\.(\d+))?)?)?(Z|([+-])(\d\d):?(\d\d))?)?$/;

/** Plain `±HHmm` (or `±HH:mm`) timezone-argument regex. */
const TIMEZONE_OFFSET_REGEX = /^([+-])(\d{2}):?(\d{2})$/;

/** Token getter signature: read a Date part either via UTC or local accessors based on the resolved timezone. */
type DateGetter = (date: Date) => number;

interface DateAccessors {
  readonly fullYear: DateGetter;
  readonly month: DateGetter;
  readonly date: DateGetter;
  readonly day: DateGetter;
  readonly hours: DateGetter;
  readonly minutes: DateGetter;
  readonly seconds: DateGetter;
  readonly milliseconds: DateGetter;
  /** Offset in minutes WEST of UTC (e.g. PDT → 420). For non-local zones this is fixed at the resolved offset. */
  readonly offsetMinutes: number;
}

const LOCAL_ACCESSORS: DateAccessors = {
  fullYear: (d) => d.getFullYear(),
  month: (d) => d.getMonth(),
  date: (d) => d.getDate(),
  day: (d) => d.getDay(),
  hours: (d) => d.getHours(),
  minutes: (d) => d.getMinutes(),
  seconds: (d) => d.getSeconds(),
  milliseconds: (d) => d.getMilliseconds(),
  // Sentinel: a per-instance value will be substituted at scan time
  // when no timezone arg is supplied (we read `date.getTimezoneOffset()`
  // off the actual Date). Stored as `NaN` so any accidental token use
  // surfaces obviously.
  offsetMinutes: Number.NaN,
};

const UTC_ACCESSORS: DateAccessors = {
  fullYear: (d) => d.getUTCFullYear(),
  month: (d) => d.getUTCMonth(),
  date: (d) => d.getUTCDate(),
  day: (d) => d.getUTCDay(),
  hours: (d) => d.getUTCHours(),
  minutes: (d) => d.getUTCMinutes(),
  seconds: (d) => d.getUTCSeconds(),
  milliseconds: (d) => d.getUTCMilliseconds(),
  offsetMinutes: 0,
};

function pad(value: number, width: number) {
  return String(value).padStart(width, '0');
}

/**
 * Parse a string input to a Date. Returns `undefined` if the string is
 * not parseable as either an ISO-8601 timestamp or a `Date.parse`-able
 * format. The caller treats `undefined` as the "non-parseable" branch
 * and returns the original input unchanged (FS §2.16).
 */
function parseDateString(input: string) {
  // ISO-8601 component parse first — AngularJS does this so that strings
  // like `'2026-05-07'` (date-only) and `'2026-05-07T14:30:45Z'` produce
  // consistent UTC values regardless of the runtime's `Date.parse`
  // quirks (date-only ISO strings are parsed as UTC; older browsers used
  // local time).
  const match = ISO_8601_REGEX.exec(input);
  if (match !== null) {
    const [, year, month, day, hour, minute, second, ms, tz, tzSign, tzHours, tzMinutes] = match;
    // The non-null assertions are safe — the regex grouping guarantees
    // these slots exist when the regex matches.
    const date = new Date(0);
    date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
    date.setUTCHours(Number(hour ?? '0'), Number(minute ?? '0'), Number(second ?? '0'), Number(ms ?? '0'));
    if (tz !== undefined && tz !== 'Z') {
      // Adjust by the embedded timezone offset (e.g. `'-0700'`).
      const sign = tzSign === '-' ? 1 : -1;
      const offset = sign * (Number(tzHours ?? '0') * 60 + Number(tzMinutes ?? '0'));
      date.setUTCMinutes(date.getUTCMinutes() + offset);
    }
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }
    return date;
  }

  const parsed = Date.parse(input);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return new Date(parsed);
}

/**
 * Resolve a `timezone` argument into the accessor strategy and offset
 * minutes. `undefined` → local accessors. `'UTC'` → UTC accessors.
 * `±HHmm` / `±HH:mm` → a "shifted date" approach: the date is rewound
 * by the local offset (so UTC accessors see local-time fields) and then
 * pushed by the requested offset.
 */
function resolveTimezone(date: Date, timezone: string | undefined) {
  if (timezone === undefined) {
    return {
      accessors: { ...LOCAL_ACCESSORS, offsetMinutes: date.getTimezoneOffset() },
      date,
    };
  }
  if (timezone === 'UTC') {
    return { accessors: UTC_ACCESSORS, date };
  }
  const match = TIMEZONE_OFFSET_REGEX.exec(timezone);
  if (match === null) {
    // Unknown timezone string — fall back to local accessors. Matches
    // AngularJS's permissive behavior (it would also produce a weird
    // result rather than throw).
    return {
      accessors: { ...LOCAL_ACCESSORS, offsetMinutes: date.getTimezoneOffset() },
      date,
    };
  }
  const [, sign, hours, minutes] = match;
  // Convention: `offsetMinutes` is minutes WEST of UTC (the same sign
  // convention `Date.prototype.getTimezoneOffset` uses). `+0530` (IST,
  // east of UTC) → -330; `-0700` (PDT, west of UTC) → 420.
  const offsetMinutes = (sign === '-' ? 1 : -1) * (Number(hours) * 60 + Number(minutes));
  // Build a shifted Date such that UTC accessors return values for the
  // target zone. Subtracting `offsetMinutes * 60000` from epoch ms is
  // independent of the runtime's local timezone — `getUTCFoo()` on the
  // shifted date reads the target-zone wall clock fields.
  const shifted = new Date(date.getTime() - offsetMinutes * 60 * 1000);
  return {
    accessors: { ...UTC_ACCESSORS, offsetMinutes },
    date: shifted,
  };
}

/**
 * ISO 8601 week of year. Week 1 contains the first Thursday of the year
 * (equivalently, the week containing Jan 4). The implementation walks
 * through Thursdays so it sidesteps the off-by-one issues most ad-hoc
 * formulas have at year boundaries.
 */
function isoWeek(date: Date, accessors: DateAccessors) {
  // Build a UTC-equivalent Date of the SAME calendar fields the
  // accessors see, so we can use the standard ISO-week algorithm
  // independent of the runtime's local timezone. This is the trick
  // most reference implementations use.
  const target = new Date(Date.UTC(accessors.fullYear(date), accessors.month(date), accessors.date(date)));
  // ISO-day: Mon = 1 ... Sun = 7. Native UTC day is Sun = 0 ... Sat = 6.
  const dayNum = target.getUTCDay() || 7;
  // Shift to the Thursday of the same ISO week.
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const diffMs = target.getTime() - yearStart.getTime();
  return Math.ceil((diffMs / 86400000 + 1) / 7);
}

/**
 * Format `Z` / `ZZ` token output: `±HHmm` (RFC 822) or `±HH:mm` (ISO
 * 8601 extended). Uses the `offsetMinutes` resolved via
 * {@link resolveTimezone} so the output matches the active zone.
 */
function formatOffset(offsetMinutes: number, withColon: boolean) {
  // `offsetMinutes` is positive WEST of UTC (PDT → 420). The output
  // sign is the inverse: `'-0700'`. UTC → `'+0000'`.
  const sign = offsetMinutes <= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hours = pad(Math.floor(abs / 60), 2);
  const minutes = pad(abs % 60, 2);
  return withColon ? `${sign}${hours}:${minutes}` : `${sign}${hours}${minutes}`;
}

/** Token implementation signature. */
type TokenFn = (date: Date, accessors: DateAccessors, datetimeFormats: DatetimeFormats) => string;

/**
 * Static token table. Order matters: longer tokens MUST come before
 * shorter prefixes (`MMMM` before `MMM` before `MM` before `M`), or the
 * scanner will mis-tokenize. The table is iterated in order at each
 * scan position; the first match wins.
 *
 * `.sss` precedes `sss` for the same reason — the leading dot is part
 * of the token, not literal text.
 */
const TOKEN_TABLE: ReadonlyArray<readonly [string, TokenFn]> = [
  ['yyyy', (d, a) => pad(a.fullYear(d), 4)],
  ['EEEE', (d, a, f) => f.DAY[a.day(d)] ?? ''],
  ['MMMM', (d, a, f) => f.MONTH[a.month(d)] ?? ''],
  ['LLLL', (d, a, f) => f.MONTH[a.month(d)] ?? ''], // standalone month — same as MMMM in en-US
  ['.sss', (d, a) => `.${pad(a.milliseconds(d), 3)}`],
  ['EEE', (d, a, f) => f.SHORTDAY[a.day(d)] ?? ''],
  ['MMM', (d, a, f) => f.SHORTMONTH[a.month(d)] ?? ''],
  ['sss', (d, a) => pad(a.milliseconds(d), 3)],
  ['yy', (d, a) => pad(a.fullYear(d) % 100, 2)],
  ['MM', (d, a) => pad(a.month(d) + 1, 2)],
  ['dd', (d, a) => pad(a.date(d), 2)],
  ['HH', (d, a) => pad(a.hours(d), 2)],
  [
    'hh',
    (d, a) => {
      const h = a.hours(d) % 12;
      return pad(h === 0 ? 12 : h, 2);
    },
  ],
  ['mm', (d, a) => pad(a.minutes(d), 2)],
  ['ss', (d, a) => pad(a.seconds(d), 2)],
  ['ww', (d, a) => pad(isoWeek(d, a), 2)],
  ['ZZ', (_d, a) => formatOffset(a.offsetMinutes, true)],
  ['y', (d, a) => String(a.fullYear(d))],
  ['M', (d, a) => String(a.month(d) + 1)],
  ['d', (d, a) => String(a.date(d))],
  ['H', (d, a) => String(a.hours(d))],
  [
    'h',
    (d, a) => {
      const h = a.hours(d) % 12;
      return String(h === 0 ? 12 : h);
    },
  ],
  ['m', (d, a) => String(a.minutes(d))],
  ['s', (d, a) => String(a.seconds(d))],
  ['a', (d, a, f) => f.AMPMS[a.hours(d) < 12 ? 0 : 1]],
  ['Z', (_d, a) => formatOffset(a.offsetMinutes, false)],
  ['w', (d, a) => String(isoWeek(d, a))],
];

/**
 * Resolve the eight named formats to their underlying token strings,
 * once. Non-named formats pass through unchanged.
 */
function resolveNamedFormat(format: string, datetimeFormats: DatetimeFormats) {
  switch (format) {
    case 'medium':
      return datetimeFormats.medium;
    case 'short':
      return datetimeFormats.short;
    case 'fullDate':
      return datetimeFormats.fullDate;
    case 'longDate':
      return datetimeFormats.longDate;
    case 'mediumDate':
      return datetimeFormats.mediumDate;
    case 'shortDate':
      return datetimeFormats.shortDate;
    case 'mediumTime':
      return datetimeFormats.mediumTime;
    case 'shortTime':
      return datetimeFormats.shortTime;
    default:
      return format;
  }
}

/**
 * Scan the format string and produce the substituted output. Handles
 * single-quote-escaped literal runs and longest-first token matching.
 */
function scanFormat(format: string, date: Date, accessors: DateAccessors, datetimeFormats: DatetimeFormats) {
  let out = '';
  let i = 0;
  while (i < format.length) {
    const ch = format.charAt(i);
    if (ch === "'") {
      // Quoted-literal run. Two consecutive quotes (`''`) emit one
      // literal apostrophe; otherwise everything up to the next
      // single quote is emitted verbatim.
      if (format.charAt(i + 1) === "'") {
        out += "'";
        i += 2;
        continue;
      }
      // Scan to the closing quote — or end-of-string if unterminated
      // (AngularJS is forgiving here; we match that).
      i += 1;
      while (i < format.length && format.charAt(i) !== "'") {
        out += format.charAt(i);
        i += 1;
      }
      // Skip the closing quote (or noop if unterminated).
      if (i < format.length) {
        i += 1;
      }
      continue;
    }

    // Token match — first-hit wins on a sorted-by-length-DESC table.
    let matched = false;
    for (const [token, fn] of TOKEN_TABLE) {
      if (format.startsWith(token, i)) {
        out += fn(date, accessors, datetimeFormats);
        i += token.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/**
 * Format a date / number / string using the provided format string and
 * locale. See file-level docstring for the full algorithm.
 *
 * @example
 * ```ts
 * import { defaultLocale } from '@filter/locale';
 * formatDate(new Date(2026, 4, 7, 14, 30, 45), 'yyyy-MM-dd HH:mm:ss', undefined, defaultLocale);
 * // => '2026-05-07 14:30:45' (in local time)
 *
 * formatDate('2026-05-07T14:30:45Z', 'yyyy-MM-dd', 'UTC', defaultLocale);
 * // => '2026-05-07'
 *
 * formatDate(new Date(2026, 4, 7), 'medium', undefined, defaultLocale);
 * // => 'May 7, 2026 12:00:00 AM'  (medium → 'MMM d, y h:mm:ss a')
 *
 * formatDate(null, 'yyyy', undefined, defaultLocale);     // => ''
 * formatDate('not a date', 'yyyy', undefined, defaultLocale); // => 'not a date' (passthrough)
 * ```
 */
export function formatDate(
  input: Date | number | string | null | undefined,
  format: string,
  timezone: string | undefined,
  locale: LocaleService,
): string {
  if (input === null || input === undefined) {
    return '';
  }

  let date: Date;
  if (input instanceof Date) {
    date = input;
  } else if (typeof input === 'number') {
    date = new Date(input);
  } else if (typeof input === 'string') {
    const parsed = parseDateString(input);
    if (parsed === undefined) {
      // Non-parseable strings are returned unchanged per FS §2.16.
      return input;
    }
    date = parsed;
  } else {
    // Non-Date / non-numeric / non-string input: AngularJS returns the
    // input verbatim. We coerce to string for our `string` return type;
    // the `date` filter wrapper handles the typed pass-through.
    return String(input);
  }

  if (Number.isNaN(date.getTime())) {
    // A `new Date(badNumber)` produced an invalid Date — treat the
    // original input as non-formattable and pass through stringified.
    return String(input);
  }

  const resolvedFormat = resolveNamedFormat(format, locale.DATETIME_FORMATS);
  const { accessors, date: shiftedDate } = resolveTimezone(date, timezone);
  return scanFormat(resolvedFormat, shiftedDate, accessors, locale.DATETIME_FORMATS);
}
