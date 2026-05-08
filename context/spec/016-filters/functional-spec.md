# Functional Specification: Filters — `$filterProvider`, `$filter`, and the Nine Built-ins

- **Roadmap Item:** Phase 2 — Expressions, Filters & DOM > Filters (Filter Registration & Pipeline + Module DSL `.filter` + Built-in Filters)
- **Status:** Completed
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Templates in AngularJS lean on the pipe operator to apply common transformations right at the binding site:

```html
<p>Total: {{ subtotal + tax | currency:'$' }}</p>
<ul><li ng-repeat="user in users | filter:query | orderBy:'name'">…</li></ul>
<time>{{ post.publishedAt | date:'medium' }}</time>
```

Without filters, every binding either pushes the formatting work into the scope (cluttering controllers with display logic) or simply doesn't compile — `{{ subtotal | currency }}` does not currently parse, because the lexer has no pipe handling.

This spec closes Phase 2's Filters bullet end-to-end:

1. **Pipe syntax in the expression language.** The lexer emits a `|` token; the parser consumes filter chains after the assignment-precedence rule; the interpreter resolves filter names lazily via `$filter(name)` and applies them with the parsed argument list.
2. **A registration surface developers already know.** `$filterProvider.register(name, factoryFn)` for the canonical AngularJS pattern, plus a thin `module.filter(name, factory)` shorthand that writes into the same registry. The internal provider name is `<name>Filter` (so `currency` becomes `currencyFilter`) — this matches AngularJS exactly and means our existing decorator mechanism works on filters at zero extra cost.
3. **A `$filter` lookup service** that's injectable anywhere — in factories, services, controllers, route resolvers, tests — not just in template expressions.
4. **Nine built-in filters** with full AngularJS 1.x behavior parity: `filter`, `orderBy`, `limitTo`, `currency`, `number`, `date`, `uppercase`, `lowercase`, `json`.
5. **A swappable `$locale` service** carrying en-US defaults (currency symbol, decimal separator, grouping separator, day/month names, AM/PM markers, date-format aliases). Developers reaching for non-English locales register a replacement via `module.factory('$locale', …)` or `$provide.factory('$locale', …)`.
6. **Stateful filter support.** A filter function may declare `$stateful = true` to opt out of the digest's input-identity short-circuit. All nine built-ins are stateless; the flag exists for future filters that depend on live data outside their inputs (clocks, async lookups, etc.).

**Success criteria:**

- `parse('subtotal | currency:"$"')(scope)` returns a formatted currency string when `scope.subtotal` is a number and the `ng` module is loaded into the injector.
- `injector.get('$filter')('uppercase')('hello') === 'HELLO'` from any service or factory.
- `createModule('app', ['ng']).filter('shout', () => (s) => `${String(s).toUpperCase()}!`)` registers a filter usable as `{{ msg | shout }}` and resolvable as `$filter('shout')`.
- `module.decorator('currencyFilter', ['$delegate', ($delegate) => …])` wraps the built-in `currency` filter.
- Unknown filters surface as `Unknown filter: <name>` through `$exceptionHandler` at digest time, NOT at parse time — the digest continues per the spec-014 contract.
- `{{ ::items | orderBy:'name' }}` deregisters once the filtered output stabilizes (matching the spec-010 one-time delegate).
- All existing tests (specs 002, 003, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015) continue to pass; behavior is purely additive.

---

## 2. Functional Requirements (The "What")

### 2.1. Pipe Operator in the Expression Language

- The lexer recognizes `|` as a single-character token. The AST grammar adds a `Filter` production sitting just above assignment, so `a = b | f` parses as `a = (b | f)` and `a | f = b` is a parse error (filters can't appear on the left of an assignment, matching AngularJS).
  - **Acceptance Criteria:**
    - [x] `parse('value | uppercase')` produces an AST with a `CallExpression`/`Filter` node wrapping the `value` identifier with the filter `uppercase`
    - [x] `parse('a | f1 | f2')` chains left-to-right: `f2(f1(a))` semantics
    - [x] `parse('value | filterName : arg1 : arg2')` collects `arg1` and `arg2` as additional arguments after `value`
    - [x] Each argument is itself a full expression: `parse('items | limitTo : count + 1 : start')` evaluates `count + 1` and `start` against scope
    - [x] `parse('a + b | uppercase')` binds the filter to the result of `a + b` (filter has lower precedence than `+`)
    - [x] `parse('a ? b : c | uppercase')` binds the filter to the entire ternary result (filter has lower precedence than `?:`)
    - [x] `parse('a = b | f')` parses as `a = (b | f)` — assignment of a filtered value
    - [x] `parse('a | f = b')` throws a parse error mentioning that filters cannot be the assignment target
    - [x] The pipe token does NOT collide with the existing `||` (logical-OR) lexing — `parse('a || b')` still produces a `LogicalExpression`, not a filter chain
    - [x] Whitespace around `|` and `:` is optional: `parse('a|f:1:2')` and `parse('a | f : 1 : 2')` produce equivalent ASTs

### 2.2. `$filterProvider` — Config-Phase Registration

- `$filterProvider` is a provider registered on the `ng` module. It exposes a single method, `register(name, factoryFn)`, that registers a filter by name. The factory function is annotated and invoked via `$injector.invoke(...)` lazily on first lookup; its return value is the filter function itself.
  - **Acceptance Criteria:**
    - [x] `appModule.config(['$filterProvider', ($fp) => $fp.register('shout', () => (s) => `${s}!`)])` — `$filter('shout')('hi') === 'hi!'` at run-phase
    - [x] Array-style annotations work: `$filterProvider.register('multiply', ['factor', (factor) => (n) => n * factor])` resolves `factor` from the registry
    - [x] `register(name, factoryFn)` returns `$filterProvider` to allow chaining: `$fp.register('a', …).register('b', …)`
    - [x] Object form: `$filterProvider.register({ shout: () => (s) => …, whisper: () => (s) => … })` registers each key as a separate filter (AngularJS parity)
    - [x] Last-wins: registering the same filter name twice replaces the prior factory — the factory is re-invoked on the next `$filter('name')` lookup
    - [x] `$filterProvider` is resolvable in any module's `config()` block as long as the module depends (transitively) on `ng`
    - [x] Calling `$filterProvider.register(...)` after the run phase throws `$provide.<recipe> is only callable during the config phase…` — inherits the spec-015 phase guard since registration goes through `$provide.provider`

### 2.3. `$filter` — Run-Phase Lookup Service

- `$filter` is a service registered on the `ng` module. Calling `$filter(name)` returns the filter function for `name` or throws if no such filter is registered. The returned function is the same reference across calls (filters are singletons; the factory runs at most once per registration).
  - **Acceptance Criteria:**
    - [x] `injector.get('$filter')` returns a function
    - [x] `$filter('uppercase')('hello') === 'HELLO'` (built-in available out of the box)
    - [x] `$filter('uppercase') === $filter('uppercase')` — same reference returned on repeated lookups
    - [x] `$filter('nonexistent')` throws `Unknown filter: nonexistent` synchronously at the lookup site
    - [x] `$filter` is injectable into any factory, service, run block, or other consumer: `module.factory('formatter', ['$filter', ($filter) => (n) => $filter('currency')(n, '$')])` works
    - [x] `$filter` is NOT available in config blocks (it's a run-phase service, not a provider) — `module.config(['$filter', …])` throws `Unknown provider: $filterProvider` only if no provider exists; in our case, the lookup of `$filter` itself is run-phase

### 2.4. Module DSL — `module.filter(name, factory)`

- `createModule(...)` exposes a `.filter(name, factory)` method that delegates to `$filterProvider.register(name, factory)`. Mechanically identical to writing a `config(['$filterProvider', ($fp) => $fp.register(name, factory)])` block — the chainable shorthand is purely sugar over the same shared registry.
  - **Acceptance Criteria:**
    - [x] `createModule('app', ['ng']).filter('shout', () => (s) => `${s}!`)` registers a filter usable as `$filter('shout')` and as `{{ msg | shout }}`
    - [x] `.filter` returns the module to keep the chain: `createModule(...).filter('a', …).filter('b', …).factory(...)`
    - [x] Array-style annotations: `.filter('multiply', ['factor', (factor) => (n) => n * factor])` resolves `factor` from the registry
    - [x] Last-wins across the chain: `.filter('shout', oldFactory).filter('shout', newFactory)` — the second registration replaces the first
    - [x] Last-wins across `module.filter` and `$filterProvider.register`: a `$filterProvider.register('shout', newFactory)` in a config block overrides a prior `module.filter('shout', oldFactory)` on a parent module
    - [x] `.filter(name, factory)` writes into the SAME registry as `$filterProvider.register` and `$provide.provider('<name>Filter', …)` — there is no parallel filter map
    - [x] Calling `.filter` without arguments or with a non-string name is a TypeScript compile-time error; passing a non-Invokable factory is also a compile-time error

### 2.5. Internal Provider-Name Convention — `<name>Filter`

- Each filter is internally registered as a provider named `<name>Filter`. This is the AngularJS-canonical convention and is what makes the existing spec-008 decorator stack work on filters with no extra wiring.
  - **Acceptance Criteria:**
    - [x] `module.filter('currency', currencyFactory)` is functionally equivalent to `module.provider('currencyFilter', { $get: currencyFactory })` — verified by the fact that `injector.get('currencyFilter')` returns the same value as `$filter('currency')`
    - [x] `injector.get('currencyFilter')` returns the same reference as `$filter('currency')`
    - [x] Filter names that already end in `Filter` (e.g., `register('myFilter', …)`) register the provider as `myFilterFilter` — no special-casing; matches AngularJS literally
    - [x] Documented limitation: a filter name that contains characters invalid for an injectable identifier is rejected at registration time with a clear error
    - [x] `injector.has('currencyFilter') === true` and `injector.has('$filter') === true` after `ng` loads

### 2.6. Decorator Support for Filters

- Filters participate in the existing `module.decorator` / `$provide.decorator` mechanism by virtue of the `<name>Filter` provider naming. Decorators stack in registration order, just like decorators on any other service.
  - **Acceptance Criteria:**
    - [x] `module.decorator('currencyFilter', ['$delegate', ($delegate) => (n, sym) => `[${$delegate(n, sym)}]`])` wraps the built-in `currency` filter — `$filter('currency')(5, '$')` returns `[$5.00]`
    - [x] `$provide.decorator('uppercaseFilter', ['$delegate', …])` works equivalently from a config block
    - [x] Multiple decorators on the same filter compose in registration order — the later decorator wraps the earlier one
    - [x] Decorating a not-yet-registered filter follows existing decorator semantics: `injector.get(...)` throws `Unknown provider: <name>Filter` at resolution time
    - [x] Decorator return value MUST be a function (or `$stateful`-flagged function); other shapes are passed through unchanged but produce a TypeScript warning where possible

### 2.7. Stateful Filters — `$stateful` Opt-In

- Filter functions are pure by default: the digest treats `someValue | someFilter` as a stable computation when the input identity is unchanged. A filter function may declare `$stateful = true` (a property on the returned filter function) to opt out — the digest then re-evaluates the filter every cycle even when the input is identity-stable.
  - **Acceptance Criteria:**
    - [x] Default behavior: a filter whose factory returns `function f(input) { … }` (no `$stateful` flag) is treated as stateless — the parser may mark `expr | f` as constant when both `expr` and `f` are constant/stateless
    - [x] Opt-in: a filter factory returning `Object.assign((input) => Date.now(), { $stateful: true })` causes the digest to re-run the filter every cycle even when `input` hasn't changed — a watch with the filter expression observes a changing value across digests with the same scope state
    - [x] All nine built-in filters are stateless — none of them declare `$stateful`
    - [x] `$stateful` is a property on the FILTER FUNCTION (the value the factory returns), not on the factory itself — matches AngularJS
    - [x] An expression containing a stateful filter is NOT eligible for the constant/literal/one-time delegate fast paths; spec 010's `oneTimeWatchDelegate` and `constantWatchDelegate` selection rules treat stateful-filter expressions as ordinary watches

### 2.8. Unknown Filter — Error Handling at Digest Time

- `parse('x | nonexistent')` succeeds; the failure happens when the resulting expression is evaluated and the interpreter calls `$filter('nonexistent')`. The `Unknown filter: nonexistent` error is routed through `$exceptionHandler` (cause: a new `'$filter'` token added to `EXCEPTION_HANDLER_CAUSES`) so the digest continues.
  - **Acceptance Criteria:**
    - [x] `parse('x | nonexistent')` does NOT throw at parse time — returns a callable expression
    - [x] Calling that expression on a scope inside `$digest` causes `Unknown filter: nonexistent` to be reported via `$exceptionHandler` and the watch returns `undefined` for that cycle
    - [x] The digest continues — sibling watches in the same cycle still run; the TTL counter is unaffected
    - [x] Outside a digest, calling the parsed expression (e.g., from a service that imports `parse`) throws synchronously at the call site (no exception handler context to route through)
    - [x] `$filter('nonexistent')` called directly throws synchronously — only the in-digest path routes through `$exceptionHandler`
    - [x] The `EXCEPTION_HANDLER_CAUSES` public-API list gains a new token `'$filter'` documenting this routing point — extending the list is a public-API addition, called out in the changelog

### 2.9. One-Time Bindings With Filters

- Spec 010's `oneTimeWatchDelegate` and `oneTimeLiteralWatchDelegate` treat a filter chain as part of the watched expression: stabilization is checked on the FILTERED OUTPUT, not on the raw input. Once the filtered output is defined and equals itself across two consecutive digests, the watch deregisters.
  - **Acceptance Criteria:**
    - [x] `{{ ::items | orderBy:'name' }}` deregisters once the orderBy output is a defined array (not when `items` itself becomes defined)
    - [x] If the filter returns `undefined` for a defined input (e.g., `currency` on a non-numeric value returns `''`, but a custom filter could return `undefined`), the one-time binding does NOT stabilize until the filter output is defined — matches AngularJS
    - [x] Stateful filters (`$stateful: true`) downgrade the watch to a regular watcher, NOT a one-time delegate, even when prefixed with `::`
    - [x] Constant inputs through stateless filters can be marked constant: `parse("'hi' | uppercase")` is `constant: true` on the AST, allowing `constantWatchDelegate` to deregister after the first stable evaluation

### 2.10. `$sce` / Trusted-Context Interaction

- A filter expression used inside a `trustedContext` interpolation (e.g., `$interpolate('{{ html | uppercase }}', false, { trustedContext: SCE_CONTEXTS.HTML })`) runs the filter chain first, then passes the final value to `$sce.getTrusted(context, value)`. Filters do NOT bypass SCE; they're a transformation that happens before the trust check.
  - **Acceptance Criteria:**
    - [x] `$interpolate('{{ markup | uppercase }}', false, { trustedContext: SCE_CONTEXTS.HTML })(scope)` where `scope.markup` is a plain string and `ngSanitize` is loaded — runs `uppercase`, then routes through `$sce.getTrustedHtml`, then through `$sanitize`
    - [x] Same expression with `ngSanitize` NOT loaded and a plain-string `markup` — throws "unsafe value used in HTML context" per spec-012 §strict-mode
    - [x] A filter that returns a `TrustedHtml` wrapper (e.g., a custom filter calling `$sce.trustAsHtml`) — the wrapper survives through the filter chain and `$sce.getTrustedHtml` unwraps it directly without calling `$sanitize`
    - [x] The `{{expr}}` single-binding rule (spec 011 `strictTrustActive`) still applies — `'<p>{{ x | uppercase }}</p>'` (filter inside a multi-segment interpolation) throws when `trustedContext` is set

### 2.11. Built-in: `filter` (Array Filtering)

- `array | filter : expression : comparator? : anyPropertyKey?` — returns a NEW array containing items from `array` that match `expression`. Full AngularJS parity.
  - **Acceptance Criteria:**
    - [x] String expression: `[{n:'Adam'}, {n:'Beth'}] | filter:'a'` returns items whose ANY string property contains `'a'` (case-insensitive substring match) — `[{n:'Adam'}]`
    - [x] String expression with `!` prefix: `users | filter:'!Adam'` returns items NOT matching
    - [x] Object expression with property keys: `users | filter:{ name: 'Adam' }` matches only on the `name` property (substring, case-insensitive)
    - [x] Object expression with `$` key: `users | filter:{ $: 'Adam' }` matches `'Adam'` against ANY property — equivalent to the string form
    - [x] Predicate function: `users | filter: (u) => u.age > 18` returns items where the predicate returns truthy
    - [x] Comparator `true`: strict-equality match instead of substring — `[{n:'Adam'},{n:'Adamantium'}] | filter:{n:'Adam'}:true` returns only `{n:'Adam'}`
    - [x] Comparator function: `users | filter:'a':(actual, expected) => actual.startsWith(expected)` uses the custom comparator
    - [x] `anyPropertyKey` parameter (default `'$'`): `users | filter:{ ANY: 'Adam' }:false:'ANY'` — uses `ANY` instead of `$` as the wildcard key
    - [x] Returns the input unchanged when `expression` is `undefined`, `null`, or `''` (matches AngularJS)
    - [x] Returns a new array — does NOT mutate the input
    - [x] Non-array input returns input unchanged (matches AngularJS)
    - [x] Nested object property matching: `users | filter:{ address: { city: 'Boston' } }` recurses into nested objects

### 2.12. Built-in: `orderBy` (Array Sorting)

- `array | orderBy : expression : reverse? : comparator?` — returns a NEW array sorted by `expression`. Full AngularJS parity.
  - **Acceptance Criteria:**
    - [x] String predicate: `users | orderBy:'name'` sorts by the `name` property ascending
    - [x] `+` / `-` prefix: `users | orderBy:'-name'` sorts descending; `users | orderBy:'+name'` sorts ascending (explicit)
    - [x] Function predicate: `users | orderBy: (u) => u.lastName.toLowerCase()` sorts by the function result
    - [x] Array of predicates: `users | orderBy: ['lastName', 'firstName']` sorts by `lastName` first, breaking ties with `firstName`
    - [x] Mixed array: `users | orderBy: ['-age', 'name']` — descending age, ascending name on ties
    - [x] `reverse` argument: `users | orderBy:'name':true` reverses the entire sort order
    - [x] Custom comparator: `users | orderBy:'name':false:(a, b) => …` uses the custom function for comparison
    - [x] Default ordering rules (matches AngularJS): numbers compare numerically, strings compare via `localeCompare`-like semantics, `null`/`undefined` sort to the end, mixed types compare by `typeof` precedence
    - [x] `'+'` (empty predicate) sorts by item identity itself: `[3,1,2] | orderBy:'+'` returns `[1,2,3]`
    - [x] Returns a new array — does NOT mutate the input
    - [x] Non-array input returns input unchanged
    - [x] Stable sort: items with equal sort keys retain their relative order

### 2.13. Built-in: `limitTo` (Truncation)

- `value | limitTo : limit : begin?` — returns a slice of an array or string. Full AngularJS parity.
  - **Acceptance Criteria:**
    - [x] Positive limit: `[1,2,3,4,5] | limitTo:3` returns `[1,2,3]`
    - [x] Negative limit: `[1,2,3,4,5] | limitTo:-2` returns `[4,5]` (last 2)
    - [x] String input: `'hello' | limitTo:3` returns `'hel'`; `'hello' | limitTo:-2` returns `'lo'`
    - [x] `begin` argument with positive limit: `[1,2,3,4,5] | limitTo:2:1` returns `[2,3]`
    - [x] Limit greater than length: `[1,2,3] | limitTo:10` returns `[1,2,3]` (no padding)
    - [x] Numeric input: `12345 | limitTo:3` returns `'123'` (number coerced to string)
    - [x] `Infinity` limit: `[1,2,3] | limitTo:Infinity` returns the entire array
    - [x] Non-array, non-string, non-number input returns input unchanged
    - [x] Returns a new array/string — does NOT mutate the input

### 2.14. Built-in: `currency` (Number → Currency String)

- `number | currency : symbol? : fractionSize?` — formats a number using the current `$locale.NUMBER_FORMATS.CURRENCY_SYM` and pattern. Full AngularJS parity.
  - **Acceptance Criteria:**
    - [x] Default symbol & fraction size from `$locale`: `1234.5 | currency` returns `'$1,234.50'` (en-US locale, 2-fraction-digit default)
    - [x] Custom symbol: `1234.5 | currency:'€'` returns `'€1,234.50'`
    - [x] Custom fraction size: `1234.5 | currency:'$':0` returns `'$1,235'` (rounded to nearest integer)
    - [x] Negative number: `-1234.5 | currency:'$'` returns `'($1,234.50)'` per AngularJS's default negative pattern (parentheses), configurable via `$locale.NUMBER_FORMATS.PATTERNS`
    - [x] Non-numeric input: returns `''` (empty string) — matches AngularJS
    - [x] `null` / `undefined` input: returns `''`
    - [x] Integer input: `42 | currency:'$':2` returns `'$42.00'`
    - [x] Very small number: `0.001 | currency:'$':2` returns `'$0.00'` (rounding)
    - [x] Symbol position respects `$locale.NUMBER_FORMATS.PATTERNS[1].posPre` (en-US default: prefix)

### 2.15. Built-in: `number` (Number Formatting)

- `number | number : fractionSize?` — formats a number using `$locale.NUMBER_FORMATS.DECIMAL_SEP`, `GROUP_SEP`, and pattern. Full AngularJS parity.
  - **Acceptance Criteria:**
    - [x] Default: `1234567.89 | number` returns `'1,234,567.89'` (en-US grouping, 3 fraction digits trimmed to actual)
    - [x] Explicit fraction size: `1234.5678 | number:2` returns `'1,234.57'` (rounded)
    - [x] Zero fraction size: `1234.5 | number:0` returns `'1,235'`
    - [x] Negative number: `-1234.5 | number:1` returns `'-1,234.5'` (default en-US negative prefix is `-`)
    - [x] Non-numeric input: returns `''`
    - [x] `Infinity` / `-Infinity`: returns `'∞'` / `'-∞'`
    - [x] `NaN`: returns `''`
    - [x] Very large number: `1e21 | number` falls back to scientific notation handling (matches AngularJS — uses the exponent form when the number exceeds the pattern's max digits)
    - [x] Trailing zero trimming with no explicit fraction size: `1.5 | number` returns `'1.5'`, NOT `'1.500'`
    - [x] Padding with explicit fraction size: `1.5 | number:3` returns `'1.500'`

### 2.16. Built-in: `date` (Date Formatting)

- `value | date : format? : timezone?` — formats a Date / number-of-ms / ISO-8601-string using a format string of tokens or a named format. Full AngularJS parity for the documented token set and named formats.
  - **Acceptance Criteria:**
    - [x] Date instance input: `(new Date(2026, 4, 7, 14, 30, 45)) | date:'yyyy-MM-dd HH:mm:ss'` returns `'2026-05-07 14:30:45'`
    - [x] ISO-8601 string input: `'2026-05-07T14:30:45Z' | date:'yyyy-MM-dd'` returns `'2026-05-07'` (in UTC; timezone arg respected when given)
    - [x] Numeric ms input: `1747401045000 | date:'yyyy'` returns `'2025'` (or appropriate year for the timestamp)
    - [x] Year tokens: `yyyy` (4-digit), `yy` (2-digit), `y` (year, no padding)
    - [x] Month tokens: `MMMM` (full name from `$locale.DATETIME_FORMATS.MONTH`), `MMM` (short name from `SHORTMONTH`), `MM` (2-digit), `M` (no padding)
    - [x] Day tokens: `dd`, `d`, `EEEE` (full day name from `DAY`), `EEE` (short from `SHORTDAY`)
    - [x] Hour tokens: `HH` (24h, padded), `H` (24h), `hh` (12h, padded), `h` (12h)
    - [x] Minute/second tokens: `mm`, `m`, `ss`, `s`, `sss` (milliseconds, padded), `.sss`
    - [x] AM/PM token: `a` — uses `$locale.DATETIME_FORMATS.AMPMS`
    - [x] Timezone tokens: `Z` (RFC 822, e.g. `'-0700'`), `ZZ` (alt), `ww` / `w` (ISO week of year)
    - [x] Named formats: `'medium'`, `'short'`, `'fullDate'`, `'longDate'`, `'mediumDate'`, `'shortDate'`, `'mediumTime'`, `'shortTime'` — resolved via `$locale.DATETIME_FORMATS`
    - [x] Default format when omitted: `'mediumDate'` (matches AngularJS)
    - [x] Timezone argument: `date | date:'yyyy-MM-dd HH:mm':'UTC'` — formats in UTC regardless of the runtime's local timezone
    - [x] Non-date input that doesn't parse: returns input unchanged (matches AngularJS for non-numeric, non-string, non-Date inputs)
    - [x] `null` / `undefined` input: returns `''`
    - [x] Literal text in format string is preserved: `date | date:"yyyy 'year'"` returns `'2026 year'` (single quotes escape literal text)

### 2.17. Built-in: `uppercase`

- `value | uppercase` — returns the input string in uppercase, or the input unchanged if not a string.
  - **Acceptance Criteria:**
    - [x] String input: `'hello' | uppercase` returns `'HELLO'`
    - [x] Mixed-case: `'Hello World' | uppercase` returns `'HELLO WORLD'`
    - [x] Non-string input: numbers, booleans, objects, `null`, `undefined` are returned unchanged (matches AngularJS — note that AngularJS originally returned `''` for non-strings; we follow the documented `String.prototype.toUpperCase` semantics: only call `.toUpperCase()` if the input has it)
    - [x] Empty string: `'' | uppercase` returns `''`
    - [x] Already uppercase: `'HELLO' | uppercase` returns `'HELLO'` (idempotent)

### 2.18. Built-in: `lowercase`

- `value | lowercase` — symmetrical to `uppercase`.
  - **Acceptance Criteria:**
    - [x] `'HELLO' | lowercase` returns `'hello'`
    - [x] `'Hello World' | lowercase` returns `'hello world'`
    - [x] Non-string input is returned unchanged
    - [x] Empty string: `'' | lowercase` returns `''`
    - [x] Already lowercase: idempotent

### 2.19. Built-in: `json` (JSON Stringification)

- `value | json : spacing?` — serializes the value to a JSON string. Full AngularJS parity.
  - **Acceptance Criteria:**
    - [x] Default spacing: `{a:1, b:2} | json` returns `'{\n  "a": 1,\n  "b": 2\n}'` (2-space indent — AngularJS default)
    - [x] Custom spacing: `{a:1} | json:4` returns `'{\n    "a": 1\n}'` (4-space indent)
    - [x] Zero spacing: `{a:1} | json:0` returns `'{"a":1}'` (compact)
    - [x] Array input: `[1,2,3] | json:0` returns `'[1,2,3]'`
    - [x] String input: `'hello' | json` returns `'"hello"'` (JSON-escaped)
    - [x] Number input: `42 | json` returns `'42'`
    - [x] `null` input: returns `'null'`
    - [x] `undefined` input: returns `undefined` (matches AngularJS — `JSON.stringify(undefined)` is `undefined`)
    - [x] Circular references: throws (delegates to `JSON.stringify` semantics)
    - [x] Functions/symbols in objects: omitted from output (delegates to `JSON.stringify` semantics)

### 2.20. `$locale` Provider — en-US Defaults, Swappable

- `$locale` is a service registered on the `ng` module. It carries `id` (locale identifier), `NUMBER_FORMATS` (decimal/grouping/currency patterns), and `DATETIME_FORMATS` (day/month names, AM/PM, named-format strings). The default ships with en-US values; developers swap the entire object via `module.factory('$locale', () => …)` or `$provide.factory('$locale', …)`.
  - **Acceptance Criteria:**
    - [x] `injector.get('$locale').id === 'en-us'` by default
    - [x] `$locale.NUMBER_FORMATS.DECIMAL_SEP === '.'`, `.GROUP_SEP === ','`, `.CURRENCY_SYM === '$'` by default
    - [x] `$locale.NUMBER_FORMATS.PATTERNS` contains exactly two patterns: index 0 for `number`, index 1 for `currency`, each with `minInt`, `minFrac`, `maxFrac`, `posPre`/`posSuf`, `negPre`/`negSuf`, `gSize`, `lgSize` — matches AngularJS's `$locale` shape exactly
    - [x] `$locale.DATETIME_FORMATS.DAY` is `['Sunday', 'Monday', …, 'Saturday']`; `.SHORTDAY` is `['Sun', 'Mon', …]`
    - [x] `$locale.DATETIME_FORMATS.MONTH` is `['January', …, 'December']`; `.SHORTMONTH` is `['Jan', …, 'Dec']`
    - [x] `$locale.DATETIME_FORMATS.AMPMS === ['AM', 'PM']`
    - [x] Named formats `medium`, `short`, `fullDate`, `longDate`, `mediumDate`, `shortDate`, `mediumTime`, `shortTime` are present with AngularJS's en-US default values
    - [x] Swapping: `appModule.factory('$locale', () => ({ id: 'de-de', NUMBER_FORMATS: { …, CURRENCY_SYM: '€', DECIMAL_SEP: ',', GROUP_SEP: '.' }, DATETIME_FORMATS: { … } }))` — `1234.5 | currency` returns `'1.234,50 €'` (or whatever the new pattern dictates)
    - [x] `$locale` is read by `currency`, `number`, and `date` filters lazily on each invocation — swapping at config time takes effect immediately at run time
    - [x] No additional locale files ship in this spec — only the en-US default

### 2.21. Module Layout / Exports

- A new `src/filter/` subpath houses the registry, `$filterProvider`, `$filter`, the nine built-ins, and `$locale`. Followed the existing pattern of `src/sce/`, `src/interpolate/`, `src/sanitize/`.
  - **Acceptance Criteria:**
    - [x] New TypeScript path alias `@filter/*` resolves to `src/filter/*` (matches `@core`, `@parser`, `@di`, `@interpolate`, `@sce`, `@sanitize`, `@exception-handler`)
    - [x] `package.json` `exports` map gains a `./filter` entry pointing at the built `.mjs`/`.cjs`/`.d.ts`
    - [x] `rollup.config.mjs` gains a `./filter` build entry
    - [x] The root barrel re-exports the public surface: `createFilter` (or equivalent factory; ESM-first naming), `filter` default, `$filter` type, `$filterProvider` type, all nine built-in filter factories, `$locale` default, locale type definitions
    - [x] `module.filter` is registered on `createModule(...)` in `src/di/module.ts` as part of this spec — chainable, last-wins, writes through `$filterProvider.register`
    - [x] All nine built-ins + `$filter` + `$filterProvider` + `$locale` register on the `ng` module by default — no opt-in required for built-in filters
    - [x] Tests live under `src/filter/__tests__/*.test.ts` — one file per filter (`filter.test.ts`, `orderBy.test.ts`, `limitTo.test.ts`, `currency.test.ts`, `number.test.ts`, `date.test.ts`, `case.test.ts` for upper+lower, `json.test.ts`), plus `filter-provider.test.ts`, `filter-injectable.test.ts`, `module-dsl.test.ts`, `parser.test.ts` (for the pipe-syntax additions on the parser), `locale.test.ts`, `decorator.test.ts`, `sce-interaction.test.ts`, `one-time-binding.test.ts`

### 2.22. Backward Compatibility

- Adding filters is purely additive. No existing API is renamed, removed, or behavior-changed.
  - **Acceptance Criteria:**
    - [x] All tests from specs 002, 003, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015 continue to pass unchanged
    - [x] The lexer's existing token shape is unchanged for all non-`|` characters; `|` was previously not emitted (lexer would fail or skip), now emits a `|` symbol token
    - [x] The parser's existing grammar productions (assignment, ternary, logical-OR, logical-AND, equality, relational, additive, multiplicative, unary, primary, member-access, call) retain their current shape; the new `Filter` production sits between assignment and ternary
    - [x] `parse('a || b')` still produces a `LogicalExpression` with operator `'||'` — the new `|` token does NOT break double-pipe handling
    - [x] The `EXCEPTION_HANDLER_CAUSES` token list gains exactly one new entry (`'$filter'`); existing tokens are unchanged in name and meaning
    - [x] No existing public export is renamed or removed
    - [x] `createModule(...)` chain methods retain their current signatures; `.filter` is a NEW method that does not collide with any existing one

### 2.23. Documentation

- Filters get the same documentation treatment as `$sce`, `$sanitize`, and `$exceptionHandler`.
  - **Acceptance Criteria:**
    - [x] `CLAUDE.md` "Modules" table gains a new row for `./filter` listing the public exports
    - [x] `CLAUDE.md` "Non-obvious invariants" gains a bullet covering: filters are internally `<name>Filter` providers (decorator path); stateful filters opt out of the digest fast path via `$stateful = true`; `$locale` swap is a single-factory replacement; unknown filters route through `$exceptionHandler` (cause `'$filter'`) at digest time
    - [x] `CLAUDE.md` "Where to look when…" gains rows for: "How is `<expr> | filter` parsed?" → `src/parser/ast.ts` (Filter production) + `src/parser/interpreter.ts` (filter-call evaluation); "How are filters registered from a module?" → `src/filter/filter-provider.ts` + `src/di/module.ts`; "How does the `date` filter format tokens?" → `src/filter/date.ts`
    - [x] TSDoc on every public export (the nine built-in factories, `$filterProvider.register`, `$filter`, `$locale`, `module.filter`) carries at least one usage example
    - [x] `src/filter/README.md` documents the en-US-default-only stance, the swap pattern for non-English locales, the `$stateful` flag, and how to write a custom filter (factory shape + array-style annotations)

---

## 3. Scope and Boundaries

### In-Scope

- Pipe (`|`) token in the lexer; `Filter` production in the AST; filter-call evaluation in the interpreter
- `$filterProvider` (config-phase registration) and `$filter` (run-phase lookup service) on the `ng` module
- `module.filter(name, factory)` chainable shorthand on `createModule(...)`, sharing the same registry
- Internal `<name>Filter` provider naming convention (decorator support comes free)
- `$stateful = true` opt-in for stateful filters; default is stateless
- Unknown-filter error routing through `$exceptionHandler` at digest time (new `'$filter'` cause token)
- One-time bindings stabilize on filtered output; constant-expression delegate selection respects stateless filters
- All nine built-ins with full AngularJS 1.x behavior parity: `filter`, `orderBy`, `limitTo`, `currency`, `number`, `date`, `uppercase`, `lowercase`, `json`
- `$locale` service with en-US defaults; swappable via standard DI registration
- New `src/filter/` subpath, `@filter/*` alias, `./filter` package export, Rollup build entry
- TSDoc + `src/filter/README.md` + `CLAUDE.md` updates
- All prior spec test suites continue to pass

### Out-of-Scope

- **`ng-bind-html` and other directives that consume filtered output** — depends on `$compile`, separate roadmap item under "Directives & DOM Compilation"
- **Application Bootstrap (`bootstrapInjector`, `bootstrap`, `autoBootstrap`)** — separate roadmap item; this spec lands ahead of bootstrap, so tests instantiate the injector via `createInjector([…, 'ng'])` directly
- **Service Text Diagrams (Phase 2 wrap-up)** — separate roadmap item; the per-service text diagram for `$filter` + `$filterProvider` will land with that wrap-up
- **Additional locale files (de-DE, fr-FR, etc.)** — only en-US ships; the swap pattern is documented but no extra locale data is bundled
- **`ng-csp` / CSP-aware compilation** — separate concern under Directives & DOM Compilation; the parser remains a tree-walking interpreter regardless
- **Phase 5 `angular.module` namespace** — `angular.module(...).filter(...)` works automatically once `angular.module` lands because it's a thin wrapper over `createModule`; no extra wiring in this spec
- **`$q`, `$timeout`, `$interval`, `$http`, Forms, Routing, Animations** — separate phases per the roadmap
- **Performance optimizations** — straightforward implementations using native JS (e.g., `Array.prototype.sort` for `orderBy`, `Intl`-free formatting for `currency`/`number`/`date` to retain full pattern control). No micro-optimizations or memoization beyond filter-singleton caching (already provided by `$injector`)
- **Async filters** — filter functions are synchronous; `$asyncValidators`-style async pipelines are a Forms concern (Phase 3)
- **Removal of the spec-014 deferred runtime-error gap for parser code paths** — the new `'$filter'` cause is the one new digest-time error route added by this spec; broader render-time error sweeping is already complete per spec 014
