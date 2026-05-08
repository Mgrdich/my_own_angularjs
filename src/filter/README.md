# `@filter` — filter pipeline + nine built-ins

Filters are the AngularJS expression-language transformation layer: a `value | filterName : arg1 : arg2` pipeline that runs at every binding site
(`{{ subtotal | currency:'$' }}`, `ng-repeat="user in users | filter:query | orderBy:'name'"`). Three pieces compose the surface:

- **Pipe operator in the parser.** The lexer emits `|` as its own token; the parser places a `Filter` production just above assignment, so filters
  bind below ternary and below logical OR (`||` is unaffected).
- **Registration via `$filterProvider` (config-phase) or `module.filter(name, factory)` (chainable shorthand).** Both writers funnel into one
  registry — `$filterProvider.register(name, factory)` is functionally equivalent to `$provide.factory(name + 'Filter', factory)`. That's the
  `<name>Filter` provider naming convention; it's what makes the existing decorator stack work on filters at zero extra cost.
- **`$filter` lookup service** — `injector.get('$filter')(name)` returns the singleton filter function, usable from any service / factory / run
  block / test, not just templates.

The nine built-ins (`filter`, `orderBy`, `limitTo`, `currency`, `number`, `date`, `uppercase`, `lowercase`, `json`) ship registered on the core
`ng` module — no opt-in dependency required (unlike `ngSanitize`, which IS opt-in).

## Built-in filters

| Filter | Purpose | Key behaviors |
| --- | --- | --- |
| `filter` | Array filtering | string / object / predicate matching; `!` prefix negation; `$` wildcard key (overridable via `anyPropertyKey` arg); `comparator` `true` = strict equality, function = custom |
| `orderBy` | Array sorting | string / function / array predicates; `+` / `-` direction prefixes; `reverse` arg flips the entire result; custom comparator; stable; `null` / `undefined` always sort to the end |
| `limitTo` | Truncation | array / string / number-coerced-to-string; positive limit takes the first N (with optional `begin`); negative limit takes the last \|N\| (ignores `begin`); `Infinity` returns the whole input |
| `currency` | Number → currency string | uses `$locale.NUMBER_FORMATS.PATTERNS[1]`; `¤` placeholder is substituted with the resolved symbol; en-US default `$1,234.50`, accounting parens for negatives |
| `number` | Number formatting | uses `$locale.NUMBER_FORMATS.PATTERNS[0]`; trailing-zero trim when `fractionSize` is omitted, padding when explicit; `Infinity` / `-Infinity` → `'∞'` / `'-∞'`; `NaN` and non-numeric → `''` |
| `date` | Date formatting | 27 tokens (`yyyy`, `MMMM`, `EEEE`, `HH`, `Z`, …); 8 named formats (`medium`, `short`, `fullDate`, `longDate`, `mediumDate`, `shortDate`, `mediumTime`, `shortTime`); single-quote-escaped literal runs; UTC + numeric-offset timezones |
| `uppercase` / `lowercase` | String case transformation | string → upper / lower; non-string inputs pass through unchanged |
| `json` | JSON serialization | default 2-space indent; numeric `spacing` arg overrides; delegates to `JSON.stringify`, so circular refs throw and functions / symbols are dropped |

## `$locale` swap pattern

Only the en-US default ships with this package. Apps reaching for non-English locales bring their own `$locale` object — there is no bundled
locale-data archive. The `currency`, `number`, and `date` filters read `$locale` lazily on each invocation, so a `module.factory('$locale', …)`
swap at config time takes effect immediately at run time.

```ts
import { createModule } from 'my-own-angularjs/di';
import type { LocaleService } from 'my-own-angularjs/filter';

const deDE: LocaleService = {
  id: 'de-de',
  NUMBER_FORMATS: {
    DECIMAL_SEP: ',',
    GROUP_SEP: '.',
    CURRENCY_SYM: '€',
    PATTERNS: [
      // index 0: number
      { minInt: 1, minFrac: 0, maxFrac: 3, posPre: '', posSuf: '', negPre: '-', negSuf: '', gSize: 3, lgSize: 3 },
      // index 1: currency — '¤' is the placeholder substituted by the filter
      { minInt: 1, minFrac: 2, maxFrac: 2, posPre: '', posSuf: ' ¤', negPre: '-', negSuf: ' ¤', gSize: 3, lgSize: 3 },
    ],
  },
  DATETIME_FORMATS: {
    DAY: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
    SHORTDAY: ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'],
    MONTH: [
      'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
      'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
    ],
    SHORTMONTH: ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'],
    AMPMS: ['vorm.', 'nachm.'],
    medium: 'd. MMMM y HH:mm:ss',
    short: 'dd.MM.yy HH:mm',
    fullDate: 'EEEE, d. MMMM y',
    longDate: 'd. MMMM y',
    mediumDate: 'd. MMMM y',
    shortDate: 'dd.MM.yy',
    mediumTime: 'HH:mm:ss',
    shortTime: 'HH:mm',
    FIRSTDAYOFWEEK: 0,
    WEEKENDRANGE: [5, 6],
    ERAS: ['v. Chr.', 'n. Chr.'],
    ERANAMES: ['vor Christus', 'nach Christus'],
  },
};

createModule('app', ['ng']).factory('$locale', [() => deDE]);
```

## `$stateful` flag

Filters are pure by default — the digest treats `value | someFilter` as a stable computation when `value`'s identity is unchanged. A filter
function may opt out by declaring `$stateful = true` ON THE FILTER FUNCTION (not on the factory):

```ts
import type { FilterFn } from 'my-own-angularjs/filter';

const tickFilter: FilterFn = Object.assign(() => Date.now(), {
  $stateful: true as const,
});

createModule('app', ['ng']).filter('tick', [() => tickFilter]);
```

A stateful filter:

- re-evaluates on every digest cycle even when its inputs haven't changed,
- is NOT eligible for the spec-010 one-time-binding fast path (`{{ ::value | tick }}` is downgraded to a regular watcher), and
- prevents the `parse(...)` AST-`constant`/`literal` flag-driven `constantWatchDelegate` from selecting itself.

All nine built-ins are stateless. Reach for `$stateful` only when the filter's output genuinely depends on data outside its arguments (clocks,
async lookups, registry probes).

## Custom filter authoring

Factories must be DI `Invokable`s — array-style is the canonical shape. A bare anonymous function without an `$inject` annotation is rejected
by `annotate.ts` unless it takes zero parameters (in which case the array form is still preferred for clarity).

```ts
import { createModule } from 'my-own-angularjs/di';
import type { FilterFn } from 'my-own-angularjs/filter';

const exclaim: FilterFn = (value) => `${String(value)}!`;

createModule('app', ['ng']).filter('exclaim', [() => exclaim]);

// Array-style annotation with deps: $injector.invoke resolves 'factor'
// against the registry and passes the value into the closure.
createModule('app', ['ng']).filter('multiply', [
  'factor',
  (factor: number): FilterFn => (value) => Number(value) * factor,
]);
```

The factory return type is `FilterFn`: `(value: unknown, ...args: unknown[]) => unknown`. The first argument is the piped value; subsequent
positional args come from the `: arg : arg` segments of the expression.

## Decorators

Because every filter is internally registered as a `<name>Filter` provider, the spec-008 decorator stack reaches them via the standard
`module.decorator('<name>Filter', [...])` syntax. Decorators wrap the filter function transparently — `$filter(name)`, `injector.get('<name>Filter')`,
and any binding site all see the wrapped form.

```ts
import type { FilterFn } from 'my-own-angularjs/filter';

createModule('app', ['ng']).decorator('currencyFilter', [
  '$delegate',
  ($delegate: FilterFn): FilterFn => (amount, sym) => `[${$delegate(amount, sym)}]`,
]);

// $filter('currency')(5, '$') now returns '[$5.00]'.
```

Multiple decorators on the same filter compose in registration order — a later decorator wraps the earlier one. Decorating an unregistered
filter follows the existing decorator semantics: `injector.get(...)` throws `Unknown provider: <name>Filter` at resolution time.
