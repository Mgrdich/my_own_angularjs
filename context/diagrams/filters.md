# Filters & the filter pipeline

## Purpose

Filters are the expression-language transformation layer: `value | filterName : arg1
: arg2`. The parser emits a `Filter` production for the `|` token; at evaluation time
that production looks the named filter up through `$filter(name)` and invokes the
filter function with the piped value plus any colon-separated arguments. Nine filters
ship built-in on the core `ng` module (`filter`, `orderBy`, `limitTo`, `currency`,
`number`, `date`, `uppercase`, `lowercase`, `json`); apps register more through
`$filterProvider.register` or the `module.filter(name, factory)` shorthand. The
locale-aware filters (`currency`, `number`, `date`) read the swappable `$locale`
service lazily on each call.

## Collaborators & call order

```text
  parse('items | orderBy:"name" | limitTo:10')
       │  (lexer emits the '|' token; parser builds a Filter production
       │   just above assignment — '||' logical-OR is unaffected)
       ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ ExpressionFn(scope, locals)  — runs EVERY evaluation          │
  │   evaluate the Filter node:                                   │
  │     1. evaluate the input expression  → value                 │
  │     2. evaluate each ':'-separated arg → args[]               │
  │     3. fn = $filter('orderBy')                                │
  │     4. return fn(value, ...args)                              │
  └───────────────────────────────┬──────────────────────────────┘
                                  │ $filter(name)
                                  ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ $filter(name)  — createFilter($injector, registeredNames)     │
  │   cache hit?  → return cached FilterFn (identity-stable)       │
  │   name NOT in registeredNames → throw FilterLookupError ──────┼──┐
  │   else: fn = $injector.get(name + 'Filter')  ────────────────┐│  │
  │         cache.set(name, fn); return fn                       ││  │
  └─────────────────────────────────────────────────────────────┼┼──┘
                                                                 ││  │ (Unknown filter)
                  ┌──────────────────────────────────────────────┘│  ▼
                  ▼                                                │ $exceptionHandler('$filter')
  ┌──────────────────────────────────────────────────────────────┐│  (digest continues; see
  │ <name>Filter provider  ($provide.factory(name + 'Filter', …)) ││   exception-handler.md)
  │   register(name, factory) is sugar for:                      ││
  │     $provide.factory(name + 'Filter', factory)              ││
  │   ⇒ injector.get('orderByFilter') === $filter('orderBy')    ││
  │   ⇒ module.decorator('orderByFilter', …) wraps it for free  ││
  └───────────────────────────────┬──────────────────────────────┘│
                                  │  the resolved FilterFn         │
                                  ▼                                │
  ┌──────────────────────────────────────────────────────────────┐│
  │ FilterFn(value, ...args)                                     ││
  │   currency / number / date  ── read $locale lazily ──────────┼┘
  │       (NUMBER_FORMATS / DATETIME_FORMATS, en-US default,      │
  │        swappable via module.factory('$locale', …))           │
  │   $stateful === true on the fn  → opts OUT of the digest      │
  │       input-identity short-circuit (re-runs every cycle)      │
  └──────────────────────────────────────────────────────────────┘
```

Collaborators: the **parser** (emits the `|` token and the `Filter` AST production),
the **`$filter` lookup service** (`createFilter` — caches by name, gates unknown
names behind `FilterLookupError`), the **`<name>Filter` provider** that
`$filterProvider.register` writes through `$provide.factory(name + 'Filter', …)` —
so `injector.get('currencyFilter')` and `$filter('currency')` resolve the same
singleton, and a `module.decorator('currencyFilter', …)` reaches the filter with no
extra wiring — the swappable **`$locale`** service (read lazily by `currency` /
`number` / `date`), and the **`$exceptionHandler`** sink where an unknown-filter
`FilterLookupError` is routed at digest time with cause `'$filter'` so the digest
continues. A filter function may set `$stateful = true` (on the function, not the
factory) to opt out of the digest's input-identity short-circuit; all nine built-ins
are stateless.

## Using it the primary way

The ESM-first API: `createFilter` builds the `$filter` lookup service from an injector
and the set of registered names; the nine built-in factories and the frozen en-US
`defaultLocale` are exported for hand-wiring outside the DI layer.

```typescript
import {
  createFilter,
  uppercaseFilterFactory,
  currencyFilterFactory,
  defaultLocale,
} from 'my-own-angularjs/filter';

// The built-in factories are zero/one-dep Invokable arrays. The last element
// is the factory function that returns the FilterFn.
const uppercase = uppercaseFilterFactory[uppercaseFilterFactory.length - 1]();
uppercase('hello'); // 'HELLO'

// defaultLocale is the frozen en-US literal consumed by currency/number/date.
defaultLocale.id; // 'en-us'
```

`createFilter($injector, registeredNames)` is what `$FilterProvider.$get` calls to
produce the runtime `$filter`; in normal apps you reach `$filter` through the injector
rather than constructing it by hand.

## Using it the dependency-injection way

Reached as `$filter` at run time; configured through `$filterProvider` during
`config()` — or, equivalently, via the chainable `module.filter(name, factory)`
shorthand (sugar for one config block forwarding to `$filterProvider.register`).
`$locale` is a single-factory swap point: `module.factory('$locale', () => myLocale)`
replaces the en-US default, and `currency` / `number` / `date` pick it up at run time
because they read it lazily.

```typescript
import { createModule, createInjector } from 'my-own-angularjs/di';

createModule('app', [])
  // Register a custom filter (sugar forwarding to $filterProvider.register).
  .filter('shout', [() => (s: unknown) => `${String(s)}!`])
  // Swap the locale wholesale — currency/number/date read it lazily at run time.
  .factory('$locale', [() => ({ /* …LocaleService literal with pluralCat… */ })]);

const injector = createInjector(['ng', 'app']);
const $filter = injector.get('$filter');

$filter('shout')('hi'); // 'hi!'
$filter('shout') === $filter('shout'); // true — identity-stable
injector.get('shoutFilter') === $filter('shout'); // true — same singleton
```

`$filterProvider.register(name, factory)` and `module.filter(name, factory)` both
funnel into `$provide.factory(name + 'Filter', factory)`, so last-wins on repeat keys
and decorator stacking on `<name>Filter` fall out of the shared DI machinery for free.

## Related diagrams

- [Expression parser](./expression-parser.md) — emits the `|` token and the `Filter` AST production that drives `$filter` lookup at evaluation time
- [Centralized exception handling](./exception-handler.md) — where an unknown-filter `FilterLookupError` routes at digest time (cause `'$filter'`)
- [Injector & module system](./injector-and-modules.md) — how `$filterProvider` registers `<name>Filter` providers and how `$locale` is swapped
- [Scopes & digest cycle](./scope-and-digest.md) — the digest evaluates `value | filter` expressions and short-circuits on input identity unless `$stateful`
- [Diagram index](./README.md)
