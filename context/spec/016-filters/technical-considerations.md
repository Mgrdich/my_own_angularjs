<!--
This document describes HOW to build the feature at an architectural level.
It is NOT a copy-paste implementation guide.
-->

# Technical Specification: Filters — `$filterProvider`, `$filter`, and the Nine Built-ins

- **Functional Specification:** [`context/spec/016-filters/functional-spec.md`](./functional-spec.md)
- **Status:** Draft
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

The feature lands in five coordinated layers, each cleanly separable so that tests, types, and code review can scope to one layer at a time:

1. **Parser layer (in-place edits to `src/parser/`).** Add `|` to the lexer's single-char `SYMBOLS` set. The existing greedy multi-char-first ordering already matches `||` (logical-OR) before any single-`|`, so this is a one-token addition with zero collision risk. In `src/parser/ast.ts`, insert a new `filterChain` production that sits BETWEEN `assignment` and `ternary` — that is, `assignment()` reads `filterChain()` instead of `ternary()`, and `filterChain` consumes `|` zero-or-more times after a ternary expression. A new `FilterExpression` AST node holds `{ input, name, arguments }`. The interpreter adds one case for that node type, plus a tiny mechanism (described in §2.4) to thread the per-evaluation `$filter` lookup through to the filter call site. `isConstant` in `src/parser/ast-flags.ts` is extended to recurse into `FilterExpression` inputs/args; runtime `$stateful` checking happens at watch install (§2.6).

2. **New `src/filter/` subpath.** A self-contained module that hosts the registry, `$filterProvider`, `$filter`, `$locale`, the nine built-in filter factories, and shared formatting helpers. Mirrors the established `src/sce/` and `src/sanitize/` layout. New `@filter/*` path alias, new `./filter` package export, new Rollup entry. `src/filter/index.ts` is the public barrel; the cross-cutting helpers (`format-number.ts`, `format-date.ts`) live in the same folder but are NOT re-exported.

3. **`ngModule` extension (`src/core/ng-module.ts`).** Register `$filterProvider` (provider recipe), `$filter` (factory), `$locale` (factory returning the en-US default), and the nine built-ins via `$filterProvider.register(...)` in a new `.config([...])` block on `ngModule`. The nine built-ins are NOT registered as `module.factory(...)` calls — they go through `$filterProvider.register` so that they live in the same registry every consumer-registered filter does, which is what makes the `<name>Filter` provider naming and the decorator path work uniformly.

4. **Module DSL `.filter`.** Add a `.filter(name, factory)` method to the `Module` class in `src/di/module.ts`. The simplest correct implementation: `.filter` is a thin chainable wrapper that pushes a `['provider', '<name>Filter', { $get: factory }]` record into the `$$invokeQueue` — i.e. it uses the existing `provider` recipe with the conventional name suffix. No new recipe type, no new branch in `applyRegistrationRecord`. Last-wins, decorator stacking, and `$provide.provider('<name>Filter', …)` parity all fall out for free.

5. **Exception-handler integration.** Add `'$filter'` as the ninth token in `EXCEPTION_HANDLER_CAUSES`. The interpreter throws `Unknown filter: <name>` when `$filter(name)` returns no match. That throw bubbles up through the existing scope/`$digest` watch-evaluation try/catch (which already routes through `$exceptionHandler` per spec 014). The new cause token is supplied at the digest's catch site for filter-origin errors; identifying "filter-origin" requires either (a) a structured error type — a `FilterLookupError extends Error` — that scope checks via `instanceof`, or (b) a marker property. We pick **(a)** because it gives type-safe narrowing in tests.

### Type-safety stance

Same baseline as the codebase: TypeScript `strict` + `noUncheckedIndexedAccess`, no `any`, inference preferred over explicit annotations except on exported public-API boundaries. Specifics:

- **`FilterFn`** is a public type: `type FilterFn = ((value: unknown, ...args: unknown[]) => unknown) & { $stateful?: boolean }`. The `$stateful` property is optional and intentionally not part of the call signature — it's a marker on the function reference.
- **`FilterFactory`** is `Invokable<FilterFn>` — reuses the existing DI typing machinery.
- **`$filter` service type** is `<F extends FilterFn = FilterFn>(name: string) => F`. Generic over the returned filter type so consumers can narrow with explicit annotations: `$filter<typeof currencyFilter>('currency')(5, '$')` retains the call signature.
- **Built-in factories** are exported with their concrete return-type signatures (e.g., `currencyFilterFactory: ['$locale', ($locale: LocaleService) => CurrencyFilterFn]`) so that decorators get strong `$delegate` typing.
- **`LocaleService`** is a typed interface in `src/filter/locale-types.ts` matching AngularJS's `$locale` shape exactly: `{ id: string; NUMBER_FORMATS: NumberFormats; DATETIME_FORMATS: DatetimeFormats }`. Each sub-shape is a fully typed interface; no `Record<string, unknown>` placeholders.
- **`$filterProvider.register`** is overloaded: `(name: string, factory: FilterFactory): this` and `(map: Record<string, FilterFactory>): this`. The map form mirrors AngularJS parity (FS §2.2).
- **Module-DSL `.filter`** signature: `<K extends string, F extends FilterFn>(name: K, factory: Invokable<F>): Module<…>`. Returns the module for chaining. It does NOT augment the typed `Registry` — filters are looked up at evaluation time via `$filter(name)`, not via `injector.get(name)` directly, so adding `<name>: F` to the typed registry would mislead. The `<name>Filter` provider entry IS added to the typed registry (so `$injector.get('currencyFilter')` typed-resolves), via the same mechanism `module.provider` already uses.
- **`FilterExpression` AST node** is a discriminated-union member of `ASTNode`: `{ type: 'FilterExpression'; input: ASTNode; name: string; arguments: ASTNode[] }`. `name` is a string, NOT an `Identifier` node — filter names are syntactically distinct from scope identifiers in AngularJS expressions and cannot be expressions.

### What this spec deliberately does NOT change

- **No code generation, no `new Function`, no `eval`.** The tree-walking interpreter remains the only evaluation path, per the project's CSP-safety invariant in `CLAUDE.md`.
- **No new build tooling.** Vitest + jsdom + TypeScript + Rollup as today.
- **No changes to `Scope.create()` core API.** The watcher mechanism that catches and routes errors through `$exceptionHandler` is already in place from spec 014; we only piggyback on it via a new error class.
- **No changes to `$sce` / `$sanitize` / `$exceptionHandler` source files** beyond adding `'$filter'` to the `EXCEPTION_HANDLER_CAUSES` tuple. The composition with filters is established at the call site (interpolate's render pass already routes through the configured handler; filters' errors flow up through that path).

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1. New Module Layout

| Path | Responsibility |
| --- | --- |
| `src/filter/index.ts` | Public barrel. Re-exports `$filterProvider`, `$filter` (default factory), `$locale` (default), all nine built-in factories by name, `FilterFn` / `FilterFactory` / `LocaleService` types, and `FilterLookupError`. Does NOT re-export the format helpers. |
| `src/filter/filter-provider.ts` | `$FilterProvider` class. Holds the registration map; exposes `register(name, factory)` (config-time), and a `$get` invokable that returns the `$filter` service. Same pattern as `$SceProvider`, `$InterpolateProvider`. |
| `src/filter/filter-service.ts` | `createFilter(injector, registrations): FilterService`. The factory used by `$FilterProvider.$get`. Walks the registration map, invokes each factory via `$injector.invoke(...)` lazily on first lookup, caches the result, and returns a closure: `(name: string) => FilterFn`. Also exports `FilterLookupError`. |
| `src/filter/filter-types.ts` | `FilterFn`, `FilterFactory`, `FilterService`, `$FilterProvider` interface (the public face), `FilterLookupError` type. No runtime exports. |
| `src/filter/locale.ts` | `defaultLocale: LocaleService` — the en-US `$locale` literal. Pure data, no DI deps. |
| `src/filter/locale-types.ts` | `LocaleService`, `NumberFormats`, `NumberPattern`, `DatetimeFormats` interfaces. No runtime exports. |
| `src/filter/filter-filter.ts` | `filterFilterFactory` — the array-filter built-in. |
| `src/filter/order-by.ts` | `orderByFilterFactory`. |
| `src/filter/limit-to.ts` | `limitToFilterFactory`. |
| `src/filter/currency.ts` | `currencyFilterFactory` — depends on `$locale` and the shared `formatNumber` helper. |
| `src/filter/number.ts` | `numberFilterFactory` — depends on `$locale` and `formatNumber`. |
| `src/filter/date.ts` | `dateFilterFactory` — depends on `$locale` and the shared `formatDate` / token-table helpers. |
| `src/filter/case.ts` | `uppercaseFilterFactory`, `lowercaseFilterFactory` — colocated since they're symmetric and trivial. |
| `src/filter/json.ts` | `jsonFilterFactory`. |
| `src/filter/format-number.ts` | Internal shared helper: `formatNumber(value, pattern, fractionSize, locale)`. Used by `currency` and `number`. NOT exported from `index.ts`. |
| `src/filter/format-date.ts` | Internal shared helper: `formatDate(date, format, timezone, locale)` plus the token-table dispatch. Used only by `date`. NOT exported from `index.ts`. |
| `src/filter/README.md` | en-US-default-only stance, swap pattern for non-English locales, `$stateful` flag, custom-filter authoring guide. |
| `src/filter/__tests__/*.test.ts` | Per-filter behavior tests + parser-pipe tests + DI-integration tests + decorator tests + locale-swap test + one-time-binding test + SCE-interaction test + `$exceptionHandler` integration test. See §4. |

`src/parser/lexer.ts`: a one-line addition — `'|'` joins the `SYMBOLS` set.

`src/parser/parse-types.ts`: add `FilterExpression` interface and include it in the `ASTNode` union.

`src/parser/ast.ts`: insert `filterChain()` between `assignment()` and `ternary()`. `assignment()` calls `filterChain()` for its left-hand operand instead of `ternary()`. `filterChain()` reads a `ternary()` and then loops on `expect('|')`, each iteration consuming `identifier()` for the filter name plus zero-or-more `:`-prefixed `assignment()` arguments.

`src/parser/interpreter.ts`: a new `case 'FilterExpression'` block. Resolves the filter via a `$filter` lookup function passed alongside `scope`/`locals` (see §2.4 for the exact mechanism — it reuses the existing `locals` parameter under a reserved key `$$filter`).

`src/parser/ast-flags.ts`: extend `isConstant` to handle `FilterExpression` — returns `isConstant(input) && arguments.every(isConstant)`. The runtime `$stateful` check is layered on top at watch-install time (§2.6).

`src/core/ng-module.ts`: append a new `.config([...])` block (or equivalent — could be a single combined `.config` at the end of the chain) that pulls `$filterProvider` and registers the nine built-ins. Plus `.provider('$filter', $FilterProvider)` and `.factory('$locale', () => defaultLocale)`. Plus a typed-registry augmentation for the new entries.

`src/di/module.ts`: add `.filter<K, F>(name: K, factory: Invokable<F>): this` method on `Module`. Implementation: pushes `['provider', '<K>Filter', { $get: factory }]` onto `$$invokeQueue`. Type augmentation: `Module` becomes `Module<Registry & { [P in `${K}Filter`]: F }, ConfigRegistry & { [P in `${K}FilterProvider`]: ProviderInstance }, …>`. (Type wiring lifts the existing `.provider` machinery — no new generic gymnastics.)

`src/exception-handler/exception-handler-types.ts`: a one-line addition — `'$filter'` joins the `EXCEPTION_HANDLER_CAUSES` tuple. The derived `ExceptionHandlerCause` union picks it up automatically.

`tsconfig.json`: add `"@filter/*": ["./src/filter/*"]` to `paths`.

`rollup.config.mjs`: add `{ name: 'filter/index', input: 'src/filter/index.ts' }` to `entries`, and `'@filter/*': ['src/filter/*']` to `tsPathAliases`.

`package.json`: add `"./filter"` entry to `exports` mapping the built `.mjs`/`.cjs`/`.d.ts`.

`CLAUDE.md`: documentation updates per FS §2.23 (new "Modules" row, "Non-obvious invariants" bullet, "Where to look when…" rows).

### 2.2. Lexer Change

`src/parser/lexer.ts:32` — add `'|'` to `SYMBOLS`:

```typescript
const SYMBOLS = new Set(['[', ']', '{', '}', '(', ')', ',', ':', '!', '+', '-', '*', '/', '%', '<', '>', '?', '=', '|']);
```

That's the entire lexer change. The greedy multi-char ordering at `lexer.ts:108-120` (three-char first, then two-char, then single-char) ensures `||` continues to be tokenized as a single `||` token before `|` is even considered. New regression test asserts `lex('a||b')` produces `[a, ||, b]` while `lex('a|b')` produces `[a, |, b]`.

### 2.3. AST Grammar Change

The existing precedence chain is `assignment → ternary → logicalOR → logicalAND → equality → …`. Filters in AngularJS bind tighter than `=` but looser than `?:` — so the new `filterChain` slots between `assignment` and `ternary`:

```
program     → assignment
assignment  → filterChain ('=' assignment)?         // changed: was `ternary` on the LHS
filterChain → ternary ('|' ident (':' assignment)*)*  // NEW
ternary     → logicalOR ('?' ternary ':' ternary)?
…
```

Implementation in `src/parser/ast.ts`:

- A new function `filterChain(): ASTNode` reads a `ternary()` into `left`, then while `expect('|')` succeeds:
  - Read an `identifier()` for the filter name (call it `nameToken`).
  - Read a list of `:`-prefixed arguments via a small helper that loops on `expect(':')` and pushes `assignment()` results into an array (matches the call-argument helper, but with `:` separators instead of `,`).
  - Wrap as `left = { type: 'FilterExpression', input: left, name: nameToken.name, arguments: args }`.
- `assignment()` calls `filterChain()` instead of `ternary()` for the left-hand expression.

The existing `assignment()` l-value check (`left.type !== 'Identifier' && left.type !== 'MemberExpression'`) automatically rejects `a | f = b` — `FilterExpression` is neither an Identifier nor a MemberExpression, so the throw fires with the existing error message (`'Trying to assign a value to a non l-value'`). That message is sufficient for FS §2.1 acceptance criterion (parse error mentioning that filters cannot be the assignment target); we will assert against the message text in tests.

`PropertyNode` keys still use `identifier()` directly — filter parsing doesn't touch object-literal parsing.

### 2.4. Interpreter Change — Threading `$filter` Through

The interpreter currently takes `(node, scope?, locals?)`. It needs access to a `$filter` lookup function at filter-call sites. Two mechanisms were considered:

| Option | Tradeoff |
| --- | --- |
| **A.** Add a fourth `$filter?` parameter to `evaluate(...)`. | Cleanest signature; but every recursive call in the interpreter would need to thread it through, and `parse(expr)`'s public return signature doesn't naturally expose a slot for it. Touches every line of `interpreter.ts`. |
| **B.** Reserve a key `$$filter` inside `locals` and read it lazily inside the `FilterExpression` case. | Zero changes to the interpreter signature or any non-Filter case. The reserved name is `$$`-prefixed — the existing project convention for "private / not part of the public API". Tests can pass `$$filter` directly via `parse(expr)(scope, { $$filter: myLookup })` without infrastructure. |
| **C.** Store the `$filter` lookup on a closure inside `parse`. | Would require `parse(expr, deps)` to take an injector reference, breaking `parse`'s deliberately dep-free signature. |

**Pick: (B).** The `$$filter` reserved-name approach minimizes blast radius and matches the `$$`-prefix convention. The interpreter's `Identifier` case already does a `hasOwnProperty` check on `locals` before falling through to `scope`, so `$$filter` lookups are isolated to the new `FilterExpression` case. Scope's watch installation (in `src/core/scope.ts`) is the place that actually plugs `$$filter` into `locals` — when a watch's `watchExp` is a parsed expression, scope wraps the call to inject `$$filter` from its captured injector reference.

The `FilterExpression` case body, in pseudocode:

```typescript
case 'FilterExpression': {
  const $filter = locals?.$$filter as ((name: string) => FilterFn) | undefined;
  if (typeof $filter !== 'function') {
    throw new FilterLookupError(`Unknown filter: ${node.name}`); // raised when expression is evaluated outside an injector context
  }
  const filterFn = $filter(node.name); // throws FilterLookupError if not registered
  const inputValue = evaluate(node.input, scope, locals);
  const argValues = node.arguments.map((a) => evaluate(a, scope, locals));
  return filterFn(inputValue, ...argValues);
}
```

`FilterLookupError` is a new exported class from `src/filter/filter-service.ts` extending `Error` with a `readonly name = 'FilterLookupError'` brand — this is what scope's catch site uses to attach the `'$filter'` cause when routing through `$exceptionHandler`.

### 2.5. Scope Wiring — Plugging `$$filter` Into Watch Evaluation

`src/core/scope.ts` currently evaluates parsed expressions via `expr(scope, locals)`. The change: when `Scope.create` is constructed via the injector path, the injector hands scope a `$filter` reference at construction time. Scope stashes it on the prototype (or a private symbol) and, at every `$watch` evaluation, merges `{ $$filter }` into the `locals` object passed to the parsed-expression call.

Concretely:

- `Scope.create({ ... })` already accepts an options bag (used by spec 014 for `exceptionHandler`). Add an optional `filterLookup?: (name: string) => FilterFn` to that bag.
- `ngModule`'s `$rootScope` factory (when it lands as part of the Bootstrap roadmap item — out of scope here) will pass `$filter` to `Scope.create({ filterLookup: $filter })`. Until then, tests construct scope directly with the option.
- Inside `$digest`'s watch-evaluation loop, when calling `watchFn(scope, locals)`, scope merges `$$filter` into a fresh `locals` object: `watchFn(scope, { ...locals, $$filter: this.$$filterLookup })`. The merge is conditional — if `filterLookup` was not provided, no `$$filter` is added (so expressions without filters still evaluate cleanly, and expressions WITH filters throw `Unknown filter:` because the resolver is missing).
- The catch site in `$digest` that routes through `$exceptionHandler` checks `err instanceof FilterLookupError`. When true, it routes with `cause: '$filter'` instead of `'watchFn'`. This mapping is the public contract called out in FS §2.8.

`$interpolate` (spec 011) also evaluates parsed expressions during its render pass. Its render-time catch site (in `src/interpolate/interpolate.ts`) gets the same instanceof check and uses cause `'$filter'` for filter-lookup failures. (Today it routes everything as `'$interpolate'`; we're refining the mapping — the test for the interpolate render path is added in §4.)

This is the only cross-module edit beyond adding the `'$filter'` token. Scope and interpolate already have catch sites; we're just refining the cause selection inside them.

### 2.6. One-Time / Constant Watch Delegate Selection With Filters

Spec 010 selects watch delegates based on `parsed.constant` and `parsed.literal` flags computed at parse time. A filter expression is constant iff:

1. The filter's input is constant (recursive — handled by `isConstant`).
2. All filter arguments are constant.
3. The filter function itself does NOT have `$stateful: true`.

Condition 3 is a runtime fact — `$filter('foo')` may not be called yet at parse time. AngularJS handles this by deferring the constant-check to watch-install time. We follow the same approach:

- `parse(expr)` marks `constant: false` for any expression containing a `FilterExpression`. This is conservative but correct (false negatives, never false positives).
- At watch-install time inside scope, when the `watchFn` is a parsed expression with at least one `FilterExpression` AND `parsed.oneTime === true`, scope re-checks: it walks the AST (a new helper, `containsStatefulFilter(ast, $filter)`), invoking `$filter(name).$stateful` for each filter encountered. If NO filter is stateful AND `isConstant(...)` over the rest of the tree is true, the watch is upgraded to `constantWatchDelegate` / `oneTimeLiteralWatchDelegate` accordingly. If ANY filter is stateful, the watch stays as a regular watcher even when prefixed with `::`.
- This re-check happens once per watch installation, not per digest cycle. Cost is amortized to setup time.

The walk helper `containsStatefulFilter(ast, $filter)` is exported from `src/parser/ast-flags.ts` (it's a pure tree walk that needs the runtime `$filter` lookup, so it accepts that as a parameter). It's used by scope's watch-delegate selection logic only.

### 2.7. `$filterProvider` and the `$filter` Service

Provider class (`src/filter/filter-provider.ts`):

```typescript
export class $FilterProvider {
  private readonly $$registrations = new Map<string, FilterFactory>();

  register(name: string, factory: FilterFactory): this;
  register(map: Record<string, FilterFactory>): this;
  register(nameOrMap: string | Record<string, FilterFactory>, factory?: FilterFactory): this {
    // Object form: iterate and recurse.
    // String form: validate name, store factory in map.
    // Throws on invalid identifier per FS §2.5 (last bullet).
  }

  $get = ['$injector', ($injector: Injector) => createFilter($injector, this.$$registrations)] as const;
}
```

`createFilter(injector, registrations)` returns the `$filter` service — a function that:

- Maintains a per-injector `Map<string, FilterFn>` cache of resolved filters.
- On first call for a given name, looks up the registration, calls `injector.invoke(factory)`, caches the result, returns it.
- On subsequent calls for the same name, returns the cached function.
- If `name` is not in the registration map, throws `new FilterLookupError(`Unknown filter: ${name}`)`.

The `<name>Filter` provider naming convention is enforced by the consumers of `$filterProvider` (the module DSL `.filter` and the `ngModule` registration block): both write a `provider` recipe under `<name>Filter` AND a `$filterProvider.register(name, factory)` call. To keep the registry single-sourced, `$filterProvider.register` is the canonical write — the `<name>Filter` provider entry exists as a thin alias (its `$get` resolves the filter via `$filter(name)` so that `$injector.get('<name>Filter')` returns the same reference as `$filter('<name>')`).

In other words, the `<name>Filter` providers are derived shims, not parallel storage. `applyRegistrationRecord` doesn't grow a new branch — it sees a normal `provider` record whose `$get` happens to delegate to `$filter`.

The `.filter` module DSL is the canonical writer: the user writes `.filter('foo', factoryFn)`, the implementation pushes a `provider` record under `'fooFilter'` whose `$get` calls `$filter('foo')`, AND the implementation also queues a `$filterProvider.register('foo', factoryFn)` call to be drained during the config phase. Both writes go into `$$invokeQueue` as separate entries. Last-wins semantics still hold: a second `.filter('foo', otherFactory)` rewrites both entries.

**Reconsidering the `<name>Filter` shim:** an alternative is to make `.filter('foo', f)` push ONLY a `provider` record under `'fooFilter'` and have `$filterProvider.register` itself read from `$injector` lazily (looking up `<name>Filter` whenever `$filter(name)` is called). That would collapse to a single registration. The downside: `$filterProvider.register` couldn't accept registrations directly from a `config()` block without that block also pushing into the provider map — which is exactly what the dual-write approach already does cleanly. We pick the dual-write path because it keeps `$filterProvider.register` synchronously authoritative and avoids cyclic lookup logic.

### 2.8. Module DSL `.filter`

`src/di/module.ts`: a new `.filter` method on `Module`. Implementation:

```typescript
filter<K extends string, F extends FilterFn>(
  name: K,
  factory: Invokable<F>,
): Module<Registry & { [P in `${K}Filter`]: F }, ConfigRegistry, Name, Requires> {
  // Push two coordinated records: the <name>Filter provider shim and the
  // $filterProvider.register call (via a config block).
  this.$$invokeQueue.push(['provider', `${name}Filter`, {
    $get: ['$filter', ($filter: FilterService) => $filter(name)],
  }]);
  this.$$invokeQueue.push(['config', '', [
    '$filterProvider',
    ($fp: $FilterProvider) => $fp.register(name, factory),
  ]]);
  return this as never;
}
```

The second push uses an existing recipe-like channel — module-level `config()` blocks are already drained in the config phase. This means `.filter` is sugar for `.provider('<name>Filter', shim).config(['$filterProvider', $fp => $fp.register(name, factory)])`. The implementation of `.config` already exists and accepts an `Invokable`, so we reuse that path. (If the existing config-block storage isn't in `$$invokeQueue`, the `.filter` implementation calls `this.config([...])` directly.)

The `as never` cast on the return is a small concession — TypeScript's type-system limits make it hard to widen the registry purely structurally without some narrowing. Spec 015 used the same pattern. The runtime is correct; the cast is a typing convenience.

### 2.9. The Nine Built-in Filters — Implementation Notes

Each built-in filter is a factory function exported by name. All nine are stateless. The complex three (`filter`, `orderBy`, `date`) get their own files; the others may be smaller but each lives in its own file for test isolation.

| Filter | File | Dependencies | Notable details |
| --- | --- | --- | --- |
| `filter` | `filter-filter.ts` | None | Recursive matcher: string/object/predicate dispatch; `!` negation; `$` wildcard property; comparator argument (boolean / function); nested-object matching via mutual recursion. |
| `orderBy` | `order-by.ts` | None | Predicate normalization step turns `'name'` / `'-name'` / `'+name'` / function / array into a unified `[{ getter, reverse }, …]` array. Comparison uses native `localeCompare` for strings and arithmetic for numbers. Stable sort via decorate-sort-undecorate (since ES `Array.prototype.sort` is now spec-stable but we want behavior parity with AngularJS, which used a stable comparator pre-ES2019). |
| `limitTo` | `limit-to.ts` | None | Branches on `Array.isArray(input)` / `typeof input === 'string'` / `typeof input === 'number'`. `Infinity` handled via `Math.min(Math.abs(limit), input.length)` with a sign check. |
| `currency` | `currency.ts` | `$locale` | Thin wrapper over `formatNumber(value, locale.NUMBER_FORMATS.PATTERNS[1], fractionSize, locale)` with the symbol substitution per `posPre`/`posSuf`. |
| `number` | `number.ts` | `$locale` | Thin wrapper over `formatNumber(value, locale.NUMBER_FORMATS.PATTERNS[0], fractionSize, locale)`. Handles `Infinity`/`NaN` early. |
| `date` | `date.ts` | `$locale` | Token-table dispatch: a `Map<string, (date, locale, timezone?) => string>` keyed by token text. Format-string scanner: regex-based or hand-coded greedy match on the token list. Single-quote-escaped literals supported (`yyyy 'year'` → emits literal `year`). Named formats (`'medium'` etc.) are resolved against `locale.DATETIME_FORMATS` first, then re-parsed as a token string. |
| `uppercase` | `case.ts` | None | `typeof input === 'string' ? input.toUpperCase() : input`. |
| `lowercase` | `case.ts` | None | Symmetric with `uppercase`. |
| `json` | `json.ts` | None | `JSON.stringify(value, null, spacing ?? 2)`. Default-spacing is 2 (AngularJS parity). |

The shared `formatNumber` helper takes a `NumberPattern` (decimal sep, group sep, min/max digits, group sizes, prefix/suffix) and produces the formatted string. Round-half-to-even isn't AngularJS's default — it uses standard `toFixed`-style rounding (round-half-away-from-zero for positives). We match that behavior; the test suite locks it down.

The shared `formatDate` helper is the most code-heavy piece. The token table covers: `yyyy`, `yy`, `y`, `MMMM`, `MMM`, `MM`, `M`, `LLLL` (standalone month — same as MMMM in en-US), `dd`, `d`, `EEEE`, `EEE`, `HH`, `H`, `hh`, `h`, `mm`, `m`, `ss`, `s`, `sss`, `.sss`, `a`, `Z`, `ww`, `w`. Tokens are matched by descending length (longest-first) inside the format-string scanner so `MMMM` is matched before `MMM` before `MM` before `M`.

### 2.10. `$locale` — en-US Default

`src/filter/locale.ts` exports `defaultLocale: LocaleService` as a frozen literal:

```typescript
export const defaultLocale: LocaleService = Object.freeze({
  id: 'en-us',
  NUMBER_FORMATS: Object.freeze({
    DECIMAL_SEP: '.',
    GROUP_SEP: ',',
    CURRENCY_SYM: '$',
    PATTERNS: Object.freeze([
      // index 0: number
      Object.freeze({ minInt: 1, minFrac: 0, maxFrac: 3, posPre: '', posSuf: '', negPre: '-', negSuf: '', gSize: 3, lgSize: 3 }),
      // index 1: currency
      Object.freeze({ minInt: 1, minFrac: 2, maxFrac: 2, posPre: '¤', posSuf: '', negPre: '(¤', negSuf: ')', gSize: 3, lgSize: 3 }),
    ]),
  }),
  DATETIME_FORMATS: Object.freeze({
    DAY: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
    SHORTDAY: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
    MONTH: ['January','February','March','April','May','June','July','August','September','October','November','December'],
    SHORTMONTH: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    AMPMS: ['AM','PM'],
    medium: 'MMM d, y h:mm:ss a',
    short: 'M/d/yy h:mm a',
    fullDate: 'EEEE, MMMM d, y',
    longDate: 'MMMM d, y',
    mediumDate: 'MMM d, y',
    shortDate: 'M/d/yy',
    mediumTime: 'h:mm:ss a',
    shortTime: 'h:mm a',
    // Plus first-day-of-week, ERAS, ERANAMES — match AngularJS en-US.
  }),
});
```

The `¤` placeholder in the currency pattern is the international currency-symbol marker; the `currency` filter substitutes it with `locale.NUMBER_FORMATS.CURRENCY_SYM` (or the user-provided symbol argument). This matches AngularJS's pattern format exactly.

`ngModule` registers `.factory('$locale', () => defaultLocale)`. Apps swap via `module.factory('$locale', () => myLocale)` or `$provide.factory('$locale', () => myLocale)` — last-wins per the existing DI semantics.

### 2.11. `ngModule` Registration

`src/core/ng-module.ts` grows by approximately one chained `.provider('$filter', $FilterProvider)`, one `.factory('$locale', () => defaultLocale)`, and one `.config([...])` block that registers the nine built-ins:

```typescript
.config(['$filterProvider', ($fp: $FilterProvider) => {
  $fp.register('filter', filterFilterFactory);
  $fp.register('orderBy', orderByFilterFactory);
  $fp.register('limitTo', limitToFilterFactory);
  $fp.register('currency', currencyFilterFactory);
  $fp.register('number', numberFilterFactory);
  $fp.register('date', dateFilterFactory);
  $fp.register('uppercase', uppercaseFilterFactory);
  $fp.register('lowercase', lowercaseFilterFactory);
  $fp.register('json', jsonFilterFactory);
}])
```

Plus a typed-registry augmentation (`declare module '@di/di-types'`) listing the nine `<name>Filter` provider entries and `$filter` / `$locale` / `$filterProvider` in the `ng` registry, so consumers get strong typing on `injector.get('currencyFilter')` and friends.

### 2.12. Exception-Handler Cause Token

`src/exception-handler/exception-handler-types.ts`: a single tuple-element addition:

```typescript
export const EXCEPTION_HANDLER_CAUSES = Object.freeze([
  'watchFn',
  'watchListener',
  '$evalAsync',
  '$applyAsync',
  '$$postDigest',
  'eventListener',
  '$digest',
  '$interpolate',
  '$filter',  // NEW
] as const);
```

The derived `ExceptionHandlerCause` union type updates automatically. CLAUDE.md's "Non-obvious invariants" bullet about extending the list is honored: this is a public-API addition called out in the changelog and in the spec.

### 2.13. CLAUDE.md Updates (Mechanical)

Per FS §2.23:

- New "Modules" table row: `./filter` — purpose: "Filters & locale" — key exports: `createFilter`, `filter`, `$FilterProvider`, `$filter`, `$locale`, `defaultLocale`, the nine factories, `FilterFn`, `FilterFactory`, `LocaleService`, `FilterLookupError`.
- New "Non-obvious invariants" bullet: filters are internally `<name>Filter` providers (decorator path); stateful filters opt out of the digest fast path via `$stateful = true`; `$locale` swap is a single-factory replacement; unknown filters route through `$exceptionHandler` (cause `'$filter'`) at digest time; `parse(expr)` marks any filter-containing expression as `constant: false` at parse time and re-evaluates constness at watch install once `$filter` is reachable.
- New "Where to look when…" rows.

---

## 3. Impact and Risk Analysis

### 3.1. System Dependencies

This spec touches the parser, DI, scope, interpolate, and exception-handler modules. The dependency edges are:

- **Parser → no external runtime deps.** The lexer/AST/interpreter changes are self-contained. The `$$filter` reservation in `locals` is a contract with scope, not a runtime dep.
- **`src/filter/` → `@di`, `@core`, `@exception-handler`.** Only for type imports (the runtime is registered through the standard provider mechanism). `defaultLocale` has zero deps.
- **Scope (`src/core/scope.ts`) → `@parser/index`, `@filter/filter-service` (for `FilterLookupError` instanceof check).** The instanceof check is a single import. Scope already depends on parser for spec 011/014 reasons.
- **`$interpolate` (`src/interpolate/interpolate.ts`) → `@filter/filter-service`** (same instanceof check).
- **`ngModule` (`src/core/ng-module.ts`) → `@filter/index`** for the provider class, factories, and `defaultLocale`.

The `@core` ↔ `@filter` edge introduces a new dependency: `@core/ng-module.ts` imports from `@filter`. This is fine — the project already has `@core/ng-module.ts` importing from `@interpolate`, `@sce`, `@exception-handler`. Filter joins that list. No cycle: `@filter` does NOT import from `@core/ng-module` (it imports from `@core/utils` and DI types only).

### 3.2. Potential Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| **Lexer regression on `||`.** Adding `|` to `SYMBOLS` could mis-tokenize `||` if the greedy-multi-char-first ordering is broken. | Low | High (breaks all existing logical-OR expressions) | Explicit regression test: `lex('a || b')` produces a single `||` token. Existing tests for `parse('a || b')` continue to pass. The greedy-first ordering at `lexer.ts:108-120` is well-established and unchanged. |
| **Filter precedence wrong relative to `?:` or `=`.** `a ? b : c | f` could bind the filter to `c` instead of the whole ternary; `a = b | f` could parse as `(a = b) | f` instead of `a = (b | f)`. | Medium | Medium (semantic divergence from AngularJS) | Acceptance criteria in FS §2.1 lock in the correct precedence: filter binds to the entire ternary, and assignment of a filtered value works. The grammar slot (between `assignment` and `ternary`) is the only correct place — verified by reading AngularJS's `parser.js`. Tests assert the AST shapes directly. |
| **`{` / `}` in expressions inside `$interpolate`.** Filter args inside an interpolation may contain `:` which collides with the existing AngularJS interpolation symbol parsing. | Low | Low | `$interpolate`'s segment parser already handles arbitrary expression text between `{{` and `}}`; the `:` within filter args is just a normal expression character. Existing interpolate tests don't exercise filters yet — new test cases under `interpolate-filter.test.ts` cover the integration. |
| **One-time binding regression.** Spec 010's tests verify `oneTime` deregistration. If our parser change accidentally flips `oneTime` for non-filter expressions, those tests fail. | Low | Medium | The `oneTime` flag is unchanged for any expression that does not contain `\|`. `parse('::value')` produces no `FilterExpression` — the flag is set purely from the leading `::` strip. New tests add coverage for `parse('::value | uppercase')` to verify the constant re-check at watch install. |
| **Stateful-filter detection ordering.** If `$filter('foo')` isn't registered yet when scope's watch installs, the `containsStatefulFilter` walk can't resolve it. | Medium | Low | The walk is invoked at watch-install time, which is post-injector-construction (run phase). Filters registered via `module.filter(...)` or `$filterProvider.register(...)` in any config block are present by the time any watcher runs. If `$filter('foo')` IS missing at install time (developer typo), `$filter('foo')` throws `FilterLookupError`, which `containsStatefulFilter` rethrows — the watcher fails to install, and the error routes through `$exceptionHandler` with cause `'$filter'`. This is the expected behavior. |
| **`date` filter timezone handling.** Browser timezone offsets vary; tests must be deterministic. | Medium | Low | Tests pin a specific timezone via the `timezone` argument (`'UTC'`) for all assertions on absolute time output. The "no timezone arg" path is tested only for tokens that don't depend on timezone (year/month/day in local time, with `vi.setSystemTime` and a frozen Date). |
| **`filter` filter recursion on cyclic objects.** A user object with circular references could infinite-loop the recursive matcher. | Low | High (browser hang) | `filter` does NOT recurse into nested-object matching when the comparator is a function or `true` (strict equality). Default substring-match recursion is bounded by the structure of the EXPRESSION object (the user-provided object pattern), not the input — so input cycles don't cause recursion. This matches AngularJS exactly. A regression test passes a circular input to verify it doesn't hang. |
| **`$locale` swap timing.** If `$locale` is swapped via a `decorator` instead of `factory`, do the built-in filters see the swap? | Low | Low | The built-in filter factories declare `'$locale'` as a dep; `$injector` resolves through any decorators, so the swap is visible regardless of registration mechanism. Test covers both `module.factory('$locale', ...)` and `module.decorator('$locale', ...)`. |
| **Public API surface growth — `EXCEPTION_HANDLER_CAUSES`.** Adding a token is technically a non-breaking API addition (existing handlers receiving the new cause won't crash because they treat `cause` as opaque), but custom handlers using the typed `ExceptionHandlerCause` for exhaustive `switch` statements will get a TypeScript warning on the next compile. | Low | Low | Document the addition in the spec, in CLAUDE.md, and in the changelog. The warning is a soft-deprecation signal that's correctly directing the developer to handle the new case. |
| **Performance — `formatDate` token-table dispatch on hot paths.** `ng-repeat` with date filters could loop over thousands of items per digest. | Low | Medium | The token table is built once per `dateFilterFactory` invocation (filter singleton). Token matching uses string indexing, not regex backtracking. This matches AngularJS's perf profile. If profiling reveals a hotspot, we can memoize the format-string parsing per (format, locale) pair. Out of scope for this spec. |
| **Decorator-on-built-in TypeScript edge case.** `module.decorator('currencyFilter', …)` — does TS know `$delegate` is `CurrencyFilterFn`? | Medium | Low (typing only) | The `<name>Filter` providers are added to the typed registry per §2.11, so `$delegate` narrows correctly. Test `decorator.test.ts` exercises this with a TypeScript type-assertion (`expectType<…>(...)`) to lock the type contract. |
| **Filter argument expressions that throw at evaluation time.** `items | limitTo : someFnThatThrows()` — does the throw get routed correctly? | Low | Low | Argument evaluation goes through `evaluate(arg, scope, locals)` — a normal expression eval. Any throw bubbles up to the watch try/catch, which routes through `$exceptionHandler` with cause `'watchFn'` (NOT `'$filter'` — this is a watch-evaluation error, not a filter-lookup error). The instanceof check distinguishes `FilterLookupError` from any other Error. Test covered. |
| **`module.filter(...)` chainability after `factory(...)`.** `Module<…>` widening via the `${K}Filter` template-literal type — does the chain still type-check? | Low | Low (typing only) | Reuses the existing `.provider` widening pattern. Spec 015 already proved this pattern works. New chain test in `module-dsl.test.ts` exercises `.filter(...)` followed by `.factory(...)` followed by `.filter(...)`. |

### 3.3. Backward Compatibility

Per FS §2.22, additive only. Specific verifications:

- All 12 prior spec test suites continue to pass — verified by `pnpm test` after the implementation lands.
- The lexer's existing token shape is unchanged for all non-`|` characters.
- `parse('a || b')` still produces a `LogicalExpression`.
- The `EXCEPTION_HANDLER_CAUSES` addition is the only public-API-list change.
- `createModule(...)` chain methods retain their current signatures.

---

## 4. Testing Strategy

Tests use Vitest + jsdom (the project standard). Coverage threshold: 90%+ on the new `src/filter/` module (project-wide rule per architecture document §2). All test files live under `src/filter/__tests__/` except for parser-pipe tests, which join the existing `src/parser/__tests__/`.

### 4.1. Per-Filter Behavior Tests (one file per built-in)

| File | Coverage |
| --- | --- |
| `filter-filter.test.ts` | All 11 acceptance criteria from FS §2.11. |
| `order-by.test.ts` | All 13 acceptance criteria from FS §2.12, including stable-sort assertion via a sentinel-property pattern. |
| `limit-to.test.ts` | All 9 acceptance criteria from FS §2.13. |
| `currency.test.ts` | All 9 acceptance criteria from FS §2.14, including the negative-pattern parentheses behavior. |
| `number.test.ts` | All 10 acceptance criteria from FS §2.15. |
| `date.test.ts` | All 17 acceptance criteria from FS §2.16. Tests pin the system timezone via `vi.setSystemTime` for determinism. The full token surface gets at least one assertion per token. |
| `case.test.ts` | All 5 acceptance criteria each from FS §2.17 / §2.18. |
| `json.test.ts` | All 10 acceptance criteria from FS §2.19. |

### 4.2. Parser & Interpreter Tests

Files in `src/parser/__tests__/`:

| File | Coverage |
| --- | --- |
| `lexer-pipe.test.ts` | `lex('a||b')` vs `lex('a|b')`; `lex('a|b|c')` produces alternating ident/pipe tokens; whitespace tolerance. |
| `ast-filter.test.ts` | The 10 acceptance criteria from FS §2.1, including the `a | f = b` parse-error message check, the precedence assertions (with `+`, `?:`, `=`), and the chain-direction (left-to-right) AST shape. |
| `interpreter-filter.test.ts` | A `FilterExpression` evaluation produces the correct value when `$$filter` is supplied via `locals`; throws `FilterLookupError` when `$$filter` is absent or returns no match; argument evaluation order is left-to-right; `this`-binding inside filter args resolves to scope. |

### 4.3. DI Integration Tests

Files in `src/filter/__tests__/`:

| File | Coverage |
| --- | --- |
| `filter-provider.test.ts` | All 7 acceptance criteria from FS §2.2: array form, object form, chaining, last-wins, cross-module config-block resolution, post-run-phase throw. |
| `filter-injectable.test.ts` | All 6 acceptance criteria from FS §2.3: `$filter` is a function; built-ins resolvable; identity stability; unknown-filter throw; injectable into other services; not in config blocks. |
| `module-dsl.test.ts` | All 7 acceptance criteria from FS §2.4: `.filter(...)` registration, return-this chaining, array-style annotations, last-wins (within chain and cross-module), shared-registry behavior, TypeScript compile-time errors (`expectError` from `tsd` or compiler-driven assertions). |
| `provider-name-convention.test.ts` | All 5 acceptance criteria from FS §2.5: `<name>Filter` resolution, identity-with-`$filter`, no special-casing of `Filter`-suffixed names, invalid-identifier rejection, `injector.has` truths. |
| `decorator.test.ts` | All 5 acceptance criteria from FS §2.6: `module.decorator('currencyFilter', …)`, `$provide.decorator(...)` parity, decorator stacking order, missing-target error, non-function decorator return. |

### 4.4. Cross-Cutting Tests

Files in `src/filter/__tests__/`:

| File | Coverage |
| --- | --- |
| `stateful.test.ts` | All 5 acceptance criteria from FS §2.7: default-stateless, opt-in stateful re-runs every digest, all 9 built-ins are stateless (assertion loops through them), `$stateful` on the function (not factory), one-time/constant downgrade for stateful expressions. |
| `exception-handler-integration.test.ts` | All 6 acceptance criteria from FS §2.8: parse-time success, digest-time `$exceptionHandler` routing with cause `'$filter'`, digest continuation, outside-digest synchronous throw, `$filter` direct-call synchronous throw, `EXCEPTION_HANDLER_CAUSES` includes `'$filter'`. |
| `one-time-binding.test.ts` | All 4 acceptance criteria from FS §2.9: filtered-output stabilization, undefined-filtered-output non-stabilization, stateful-filter downgrade, constant-input + stateless-filter constness. Builds on spec 010's existing one-time test infrastructure. |
| `sce-interaction.test.ts` | All 4 acceptance criteria from FS §2.10: filter-then-`$sce.getTrustedHtml`-then-`$sanitize` pipeline (with `ngSanitize` loaded), filter-then-throw (without `ngSanitize`), `TrustedHtml` wrapper survival through filter chain, `{{expr}}` single-binding rule with filters. |
| `locale.test.ts` | All 8 acceptance criteria from FS §2.20: en-US defaults, `$locale` swap via `module.factory`, swap via `$provide.factory`, lazy reading (so config-time swap takes effect at run time), absence of additional locale files. |

### 4.5. Module-Layout Tests

Files in `src/filter/__tests__/`:

| File | Coverage |
| --- | --- |
| `index.test.ts` | All 7 acceptance criteria from FS §2.21: barrel re-exports, `$filter` registration on `ng`, `module.filter` on `createModule`, the test for the `@filter/*` alias is implicit (any test importing from `@filter/...` would fail to compile if the alias is missing). |

### 4.6. Backward-Compatibility Suite

| Action | Verification |
| --- | --- |
| `pnpm test` | Full prior 12-spec test suite continues to pass. |
| `pnpm typecheck` | TypeScript strict mode passes for all source and test files. |
| `pnpm lint` | ESLint passes (every new `eslint-disable` carries an inline justification). |
| `pnpm format:check` | Prettier passes. |
| `pnpm build` | Rollup dual-format build succeeds for all 10 entries (the existing 9 + the new `./filter`). The build is not yet in CI per CLAUDE.md, but the tech spec's verification step runs it locally. |

### 4.7. AngularJS Parity Reference

For each built-in filter, port the corresponding test vectors from `angular/angular.js/test/ng/filter/` (e.g., `currencySpec.js`, `dateSpec.js`, `filterSpec.js`, `limitToSpec.js`, `numberSpec.js`, `orderBySpec.js`, `jsonSpec.js`). The ported vectors live alongside our hand-authored cases in each per-filter test file; comments mark which assertions are AngularJS-port versus original. This is the same pattern spec 013's sanitizer used for CVE regression vectors.

### 4.8. Out-of-Scope for Tests

- **Performance benchmarks.** No microbenchmarks ship in this spec. If profiling reveals a hot path post-merge, a separate spec adds memoization or other optimizations.
- **Browser-end-to-end tests.** Vitest + jsdom is sufficient — the project doesn't run real-browser tests anywhere else, and adding them for filters specifically would create asymmetric coverage.
- **CLI / SSR scenarios.** The bootstrap roadmap item is a separate spec; filters in headless environments are exercised via direct injector construction in tests.
