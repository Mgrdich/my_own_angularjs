/**
 * Date/time family parse + format helpers (spec 039 Slice 3 / FS §2.4,
 * technical-considerations §2.4, §2.5 `timezone`).
 *
 * The `date` / `datetime-local` / `time` / `month` / `week` input types
 * bind a **`Date`** model value. Each type has its own HTML `value`
 * string format (see the per-type regex + formatter below); this module
 * owns the string ↔ `Date` conversion, isolated here so Slice 6's
 * `ngModelOptions.timezone` wiring can thread a real timezone in cleanly.
 *
 * **Timezone seam.** Every parse/format helper takes an explicit
 * {@link Timezone} value. Slice 3 always passes the {@link LOCAL_TIMEZONE}
 * sentinel (`undefined`), which means "use the host's local timezone" —
 * exactly today's behavior. Slice 6 will resolve `ngModelOptions.timezone`
 * to an offset (e.g. `'UTC'` / `'+0500'`) and pass it here without
 * touching any call site's structure. Keep the timezone the LAST
 * parameter of every helper so the Slice-6 handoff is purely additive.
 *
 * The parse/format logic mirrors AngularJS `src/ng/directive/input.js`
 * (`createDateParser` / the per-type `inputType` entries). We build a
 * `Date` from local-time components (so a round-trip through the local
 * timezone is lossless), then — when a non-local timezone is requested —
 * shift by the requested offset relative to local.
 */

/**
 * A resolved timezone. `undefined` (the {@link LOCAL_TIMEZONE} sentinel)
 * means the host's local timezone; a number is the minutes-east-of-UTC
 * offset (e.g. `'UTC'` → `0`, `'+0500'` → `300`). Slice 6 resolves the
 * `ngModelOptions.timezone` string into this shape.
 */
export type Timezone = number | undefined;

/**
 * The Slice-3 default timezone sentinel: the host's local timezone. Slice
 * 6 replaces this at the call sites with a resolved offset.
 */
export const LOCAL_TIMEZONE: Timezone = undefined;

/**
 * Resolve an `ngModelOptions.timezone` string into a {@link Timezone} offset
 * (spec 039 Slice 6). Mirrors AngularJS's `timezoneToOffset`:
 *
 *  - `undefined` / `''` → {@link LOCAL_TIMEZONE} (the host's local zone).
 *  - `'UTC'` / `'Z'` → `0`.
 *  - `'+HHMM'` / `'-HHMM'` / `'+HH:MM'` → the signed minutes-east-of-UTC.
 *
 * An unrecognized string falls back to the local sentinel (never throws —
 * a bad timezone silently degrades to local, matching the framework's other
 * lenient option parses).
 */
export function resolveTimezone(timezone: string | undefined): Timezone {
  if (timezone === undefined || timezone === '') {
    return LOCAL_TIMEZONE;
  }
  const upper = timezone.toUpperCase();
  if (upper === 'UTC' || upper === 'Z' || upper === 'GMT') {
    return 0;
  }
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(timezone);
  if (m) {
    const sign = m[1] === '-' ? -1 : 1;
    const hours = Number.parseInt(m[2] ?? '0', 10);
    const minutes = Number.parseInt(m[3] ?? '0', 10);
    return sign * (hours * 60 + minutes);
  }
  return LOCAL_TIMEZONE;
}

/**
 * Discriminator for the five date/time input types. Drives per-type regex,
 * parse, and format selection.
 */
export type DateInputKind = 'date' | 'datetime-local' | 'time' | 'month' | 'week';

/** Zero-pad a number to a fixed width (AngularJS `padNumber`). */
function pad(value: number, digits: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const str = String(abs);
  return sign + str.padStart(digits, '0');
}

/**
 * Apply a timezone offset (minutes east of UTC) to a `Date` built from
 * local components, converting it into the equivalent instant. When
 * `timezone` is the local sentinel this is a no-op — the `Date` already
 * carries the correct instant for a local round-trip. Otherwise we adjust
 * so the produced components match the requested zone.
 *
 * Mirrors AngularJS `timezoneToOffset` + `convertTimezoneToLocal`: the
 * requested offset is combined with the host's own offset so that
 * formatting the same `Date` later yields the requested-zone components.
 */
function applyTimezone(date: Date, timezone: Timezone, reverse: boolean): Date {
  if (timezone === undefined) {
    return date;
  }
  // `getTimezoneOffset` is minutes WEST of UTC (positive for zones behind
  // UTC), so negate to get minutes east. `timezone` is minutes east.
  const localOffset = -date.getTimezoneOffset();
  const delta = (timezone - localOffset) * (reverse ? -1 : 1);
  return new Date(date.getTime() + delta * 60_000);
}

/** Result of a per-type parse: a `Date`, or `null` on a malformed value. */
type ParseResult = Date | null;

const DATE_RE = /^(\d{4,})-(\d{2})-(\d{2})$/;
const DATETIME_LOCAL_RE = /^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const MONTH_RE = /^(\d{4,})-(\d{2})$/;
const WEEK_RE = /^(\d{4,})-W(\d{2})$/;

/** Coerce a captured group to an int (0 when the optional group is absent). */
function intOf(group: string | undefined): number {
  return group === undefined ? 0 : Number.parseInt(group, 10);
}

/** Milliseconds from a captured fractional-seconds group (`.5` → 500ms). */
function millisOf(group: string | undefined): number {
  if (group === undefined) {
    return 0;
  }
  return Number.parseInt(group.padEnd(3, '0').slice(0, 3), 10);
}

/**
 * Convert an ISO week number + year to the `Date` of that week's Monday
 * (AngularJS `getFirstThursdayOfYear` + week-offset arithmetic). Weeks are
 * ISO-8601: week 1 contains the year's first Thursday.
 */
function dateFromWeek(year: number, week: number): Date {
  const firstThursday = new Date(year, 0, 1);
  const dayOfWeek = firstThursday.getDay();
  // Shift to the first Thursday (getDay(): 0=Sun..6=Sat; ISO wants Thu=4).
  const offsetToThursday = (dayOfWeek <= 4 ? 4 : 11) - dayOfWeek;
  firstThursday.setDate(firstThursday.getDate() + offsetToThursday);
  // Monday of the requested week: back up 3 days from that week's Thursday.
  const thursdayOfWeek = new Date(firstThursday.getTime());
  thursdayOfWeek.setDate(firstThursday.getDate() + (week - 1) * 7);
  const monday = new Date(thursdayOfWeek.getTime());
  monday.setDate(thursdayOfWeek.getDate() - 3);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/** ISO week number (1..53) for a `Date` (AngularJS `weekParser` inverse). */
function isoWeek(date: Date): { year: number; week: number } {
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // Thursday of the current week determines the ISO year.
  const day = (target.getDay() + 6) % 7; // Mon=0..Sun=6
  target.setDate(target.getDate() - day + 3);
  const isoYear = target.getFullYear();
  const firstThursday = new Date(isoYear, 0, 4);
  const firstDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDay + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return { year: isoYear, week };
}

/**
 * Parse an input `value` string of the given `kind` into a `Date` in the
 * requested `timezone`, or `null` when the string is malformed / empty.
 */
export function parseDateInput(kind: DateInputKind, value: string, timezone: Timezone): ParseResult {
  if (value === '') {
    return null;
  }

  let local: Date | null = null;
  switch (kind) {
    case 'date': {
      const m = DATE_RE.exec(value);
      if (m) {
        local = new Date(intOf(m[1]), intOf(m[2]) - 1, intOf(m[3]), 0, 0, 0, 0);
      }
      break;
    }
    case 'datetime-local': {
      const m = DATETIME_LOCAL_RE.exec(value);
      if (m) {
        local = new Date(
          intOf(m[1]),
          intOf(m[2]) - 1,
          intOf(m[3]),
          intOf(m[4]),
          intOf(m[5]),
          intOf(m[6]),
          millisOf(m[7]),
        );
      }
      break;
    }
    case 'time': {
      const m = TIME_RE.exec(value);
      if (m) {
        // AngularJS anchors time-only values to 1970-01-01 (local).
        local = new Date(1970, 0, 1, intOf(m[1]), intOf(m[2]), intOf(m[3]), millisOf(m[4]));
      }
      break;
    }
    case 'month': {
      const m = MONTH_RE.exec(value);
      if (m) {
        local = new Date(intOf(m[1]), intOf(m[2]) - 1, 1, 0, 0, 0, 0);
      }
      break;
    }
    case 'week': {
      const m = WEEK_RE.exec(value);
      if (m) {
        local = dateFromWeek(intOf(m[1]), intOf(m[2]));
      }
      break;
    }
  }

  if (local === null || Number.isNaN(local.getTime())) {
    return null;
  }
  return applyTimezone(local, timezone, false);
}

/**
 * Format a `Date` model value into the HTML `value` string for the given
 * `kind`, in the requested `timezone`. A non-`Date` / invalid `Date`
 * yields `''` (so the control shows blank rather than `Invalid Date`).
 */
export function formatDateInput(kind: DateInputKind, value: unknown, timezone: Timezone): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return '';
  }
  const date = applyTimezone(value, timezone, true);

  switch (kind) {
    case 'date':
      return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
    case 'datetime-local':
      return (
        `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}` +
        `T${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}` +
        `.${pad(date.getMilliseconds(), 3)}`
      );
    case 'time':
      return (
        `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}` +
        `.${pad(date.getMilliseconds(), 3)}`
      );
    case 'month':
      return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}`;
    case 'week': {
      const { year, week } = isoWeek(date);
      return `${pad(year, 4)}-W${pad(week, 2)}`;
    }
  }
}
