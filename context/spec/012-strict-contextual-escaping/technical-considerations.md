<!--
This document describes HOW to build the feature at an architectural level.
It is NOT a copy-paste implementation guide.
-->

# Technical Specification: `$sce` — Strict Contextual Escaping

- **Functional Specification:** [`context/spec/012-strict-contextual-escaping/functional-spec.md`](./functional-spec.md)
- **Status:** Draft
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Introduce a new `src/sce/` module that implements Strict Contextual Escaping as **two layered surfaces**, matching the project's ES-module-first convention (architecture § 1 and the spec-011 precedent):

1. **ES module layer (primary, stateless):**
   - `createSceDelegate(options?)` → `SceDelegateService` — pure factory holding the trusted-value class hierarchy, the compiled resource-URL allow/block matchers, and the strict trust-unwrapping logic. Always strict.
   - `createSce(options?)` → `SceService` — pure factory returning the user-facing façade. Holds the `enabled` flag (default `true`) and the shortcut methods. Short-circuits to pass-through when strict mode is disabled.
   - `sceDelegate` / `sce` — pre-configured default exports (equivalent to the factories called with no options), mirroring the `interpolate` default export.
   - `SCE_CONTEXTS` constant, `TrustedValue` base + per-context subclasses, type guards.

2. **DI / AngularJS-compat layer (thin shims):**
   - `$SceDelegateProvider` / `$SceProvider` — hold config state (`$$allowList`, `$$blockList`, `$$enabled`) and delegate to the ES factories in their `$get`. Registered on the existing `ng` core module via the spec-008 `.provider(...)` recipe.
   - Zero duplicate logic: the providers own only config state.

Trusted values are represented by a **per-context class hierarchy** (`TrustedHtml`, `TrustedUrl`, `TrustedResourceUrl extends TrustedUrl`, `TrustedJs`, `TrustedCss`, plus an internal `TrustedValueAny`). Identity is established via `instanceof` — the natural fit for TS and a 1:1 match with AngularJS 1.x internals.

`$interpolate` gains real `trustedContext` behavior. `createInterpolate` stays stateless: it already accepts two optional callbacks on its options bag (`sceGetTrusted`, `sceIsEnabled`) per the design below. Pure-ESM consumers can wire those callbacks themselves (`createInterpolate({ sceGetTrusted: sce.getTrusted, sceIsEnabled: sce.isEnabled })`), and `$InterpolateProvider.$get` wires them via DI — both paths are fully functional.

Resource-URL list matching uses the platform `URL` constructor with `document.baseURI` as the base. String patterns with `**` / `*` wildcards are compiled to regex once per list-set call; `'self'` is compared against `document.location` (`protocol` + `host` + `port`). Matches AngularJS 1.x `urlIsSameOrigin` semantics.

No new dependencies, no new build targets, no new test frameworks.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1. New Module Layout — `src/sce/`

| Path | Responsibility |
| --- | --- |
| `src/sce/index.ts` | Public barrel: `createSce`, `sce`, `createSceDelegate`, `sceDelegate`, `$SceProvider`, `$SceDelegateProvider`, `SCE_CONTEXTS`, all `Trusted*` classes, type guards, all public types. |
| `src/sce/sce-contexts.ts` | Frozen `SCE_CONTEXTS` constant (`{ HTML, URL, RESOURCE_URL, JS, CSS }`) and internal `SCE_CONTEXT_ANY` pseudo-key. `SceContext` TS union. `isValidSceContext` runtime guard. |
| `src/sce/trusted-values.ts` | Abstract `TrustedValue` base (with `toString()` returning the raw string) and the six subclasses. `isTrustedValue`, `isTrustedFor(ctx, value)` guards. |
| `src/sce/resource-url-matcher.ts` | Pure helpers: `compileMatchers(list)`, `matches(url, matchers, baseUrl)`, `isSameOrigin(url, baseUrl)`. String-pattern → regex compilation lives here. |
| `src/sce/sce-delegate.ts` | `createSceDelegate(options)` ES factory — returns a `SceDelegateService` object with `trustAs` / `getTrusted` / `valueOf` methods closed over the compiled matchers. Always strict. |
| `src/sce/sce.ts` | `createSce(options)` ES factory — returns a `SceService` object with `isEnabled`, generic `trustAs` / `getTrusted` / `parseAs`, and the 15 per-context shortcuts. Short-circuits to pass-through when `enabled: false`. |
| `src/sce/sce-delegate-provider.ts` | `$SceDelegateProvider` class — holds `$$allowList` / `$$blockList`, exposes fluent setters, `$get` calls `createSceDelegate(...)`. |
| `src/sce/sce-provider.ts` | `$SceProvider` class — holds `$$enabled`, exposes fluent `enabled(value?)`, `$get = ['$sceDelegate', delegate => createSce({ delegate, enabled: this.$$enabled })]`. |
| `src/sce/sce-types.ts` | Public types: `SceContext`, `SceService`, `SceDelegateService`, `SceOptions`, `SceDelegateOptions`, `ResourceUrlListEntry`. |
| `src/sce/__tests__/trusted-values.test.ts` | Class-hierarchy, `toString`, type guards. |
| `src/sce/__tests__/resource-url-matcher.test.ts` | Pattern compilation, wildcard semantics, `'self'`, RegExp entries. |
| `src/sce/__tests__/sce-delegate-esm.test.ts` | `createSceDelegate` factory behavior in isolation (no DI). |
| `src/sce/__tests__/sce-esm.test.ts` | `createSce` factory: strict on/off, shortcuts, `parseAs*`, errors. Pure-ESM path. |
| `src/sce/__tests__/sce-delegate-provider.test.ts` | Provider config-phase setters, defaults, validation. |
| `src/sce/__tests__/sce-provider.test.ts` | `enabled()` getter/setter semantics. |
| `src/sce/__tests__/sce-di.test.ts` | Full DI integration + ESM/DI parity guard. |

A new path alias `@sce/*` is added to `tsconfig.json`, `vitest.config.ts`, and the ESLint `no-restricted-imports` list (consistent with `@core`, `@parser`, `@di`, `@interpolate`).

### 2.2. Dual API Surface

**ES module layer (primary):**

| Export | Signature | Purpose |
| --- | --- | --- |
| `createSceDelegate(options?)` | `(options?: SceDelegateOptions) => SceDelegateService` | Factory returning an always-strict delegate. Compiles matchers at call time. |
| `sceDelegate` | `SceDelegateService` | `createSceDelegate()` with defaults (`allowList: ['self']`, `blockList: []`). |
| `createSce(options?)` | `(options?: SceOptions) => SceService` | Factory returning the façade. `options.delegate` defaults to a fresh `createSceDelegate()`; `options.enabled` defaults to `true`. |
| `sce` | `SceService` | `createSce()` with defaults. |
| `SCE_CONTEXTS` | const | Frozen `{ HTML, URL, RESOURCE_URL, JS, CSS }`. |
| `TrustedValue`, `TrustedHtml`, `TrustedUrl`, `TrustedResourceUrl`, `TrustedJs`, `TrustedCss` | classes | Public for `instanceof` checks by consumers. |
| `isTrustedValue`, `isTrustedFor` | guards | Public type guards. |
| `SceContext`, `SceService`, `SceDelegateService`, `SceOptions`, `SceDelegateOptions` | types | Public types. |

`SceService` and `SceDelegateService` are plain record types (objects of bound methods) rather than classes — consumers can destructure them (`const { trustAsHtml, getTrustedHtml } = sce`) and the DI layer can return the same shape.

**DI layer (AngularJS compat):**

`$SceDelegateProvider` holds allow/block-list state during `config()`; its `$get` calls `createSceDelegate(...)`. `$SceProvider` holds the `enabled` flag; its `$get` depends on `$sceDelegate` and calls `createSce(...)`. Both are registered on the `ng` module via spec-008's `.provider(...)` recipe. Exactly one implementation — the providers own only config state.

### 2.3. Trusted-Value Representation

**File: `src/sce/trusted-values.ts`**

| Symbol | Kind | Purpose |
| --- | --- | --- |
| `TrustedValue` | abstract class | Base. Holds the raw string as `readonly $$unwrapTrustedValue: string`. `toString()` returns the raw string so `String(wrapper)` yields the original value, not `[object Object]`. |
| `TrustedHtml`, `TrustedUrl`, `TrustedJs`, `TrustedCss` | concrete classes | One per public context. Extend `TrustedValue`. |
| `TrustedResourceUrl` | concrete | `extends TrustedUrl`. AngularJS parity: a trusted resource URL is accepted where a trusted URL is expected, but not vice-versa. |
| `TrustedValueAny` | concrete (internal) | The `$$ANY$$` escape hatch. Not exported. Unwraps for every `getTrusted` call. |
| `isTrustedValue(v)` | guard | `v instanceof TrustedValue`. |
| `isTrustedFor(ctx, v)` | guard | Maps the context string to the expected class and runs `instanceof`, honoring the `TrustedResourceUrl extends TrustedUrl` subtype rule. |

Rationale for classes: TS types stay nominally distinct (consumers can type-narrow against `TrustedHtml` specifically), and `instanceof` is the same predicate AngularJS 1.x uses.

### 2.4. `SCE_CONTEXTS` Constant

**File: `src/sce/sce-contexts.ts`**

- Exported as a `readonly` object with literal-type values:
  ```
  export const SCE_CONTEXTS = {
    HTML: 'html',
    URL: 'url',
    RESOURCE_URL: 'resourceUrl',
    JS: 'js',
    CSS: 'css',
  } as const;
  export type SceContext = typeof SCE_CONTEXTS[keyof typeof SCE_CONTEXTS];
  ```
- Internal-only sentinel: `const SCE_CONTEXT_ANY = '$$ANY$$' as const` — not re-exported.
- `isValidSceContext(v: string)` runtime guard used by `createSceDelegate`, `createSce`, and `createInterpolate` to reject unknown context keys with a descriptive error.

### 2.5. `createSceDelegate` ES Factory

**File: `src/sce/sce-delegate.ts`**

```
createSceDelegate({
  trustedResourceUrlList?: ResourceUrlListEntry[],  // default: ['self']
  bannedResourceUrlList?:  ResourceUrlListEntry[],  // default: []
}): SceDelegateService
```

The factory:
1. Compiles the allow/block lists via `compileMatchers(list)` (see § 2.6) — validation throws synchronously on invalid entries.
2. Returns a plain object with three methods, closed over the compiled matchers.

| Method | Semantics |
| --- | --- |
| `trustAs(ctx, value)` | `null` / `undefined` → return unchanged. Non-string value → throw `"invalid value for sceDelegate.trustAs: expected string, got <typeof>"`. Unknown `ctx` → throw. Otherwise construct the context-matching `Trusted*` subclass and return it. Already-trusted input is re-wrapped for the requested context (AngularJS parity). |
| `valueOf(value)` | If `isTrustedValue(value)`, return `value.$$unwrapTrustedValue`. Otherwise return `value` unchanged. |
| `getTrusted(ctx, value)` | `null` / `undefined` → return unchanged. For the `url` context, plain strings pass through (AngularJS parity — `href`/`src` don't execute code). For `resourceUrl`, consult lists first (block before allow); if it passes, return the raw URL (unwrapping if it was a `TrustedResourceUrl`). For every other context, require `isTrustedFor(ctx, value)` — throw on mismatch. On success, return `valueOf(value)`. |

Errors are always `Error` instances with descriptive messages naming the context and, for list rejections, the URL and which check failed.

### 2.6. Resource-URL Matcher

**File: `src/sce/resource-url-matcher.ts`**

Pure, no dependencies on `$sce`. Converts a heterogeneous list into a uniform matcher form and exposes a single `match` function.

| Input entry | Compiled form |
| --- | --- |
| `'self'` | `{ kind: 'self' }` — at match time, resolves the URL via `new URL(url, document.baseURI)` and compares `{ protocol, host, port }` with `document.location`. |
| `RegExp` | `{ kind: 'regex', pattern: RegExp }` — tested against the full URL string. |
| `string` pattern | `{ kind: 'regex', pattern: RegExp }` — compiled by: anchoring (`^…$`), escaping regex metacharacters (except `*`), translating `**` → `.*`, and `*` → `[^:/?#]*` (greedy but does not cross `/`, `:`, `?`, `#`, matching AngularJS). Compilation is cached per unique string within a single list. |
| Any other type | Throw at compile time: `"invalid list entry: expected string, RegExp, or 'self'"`. |

`match(url, matchers, baseUrl)` returns `true` if any matcher matches. `isSameOrigin(url, baseUrl)` is exported for direct test access.

### 2.7. `createSce` ES Factory

**File: `src/sce/sce.ts`**

```
createSce({
  delegate?: SceDelegateService,   // default: createSceDelegate()
  enabled?:  boolean,               // default: true
}): SceService
```

Returns a plain object. All methods are bound at construction so the façade is safely destructurable.

| Method | Semantics |
| --- | --- |
| `isEnabled()` | Returns the captured `enabled` flag. Read-only — no setter. |
| `trustAs(ctx, v)` | If `!enabled`, return `v` unchanged. Else `delegate.trustAs(ctx, v)`. |
| `getTrusted(ctx, v)` | If `!enabled`, return `delegate.valueOf(v)` (strips wrapper if present, otherwise pass-through). Else `delegate.getTrusted(ctx, v)`. |
| `valueOf(v)` | Pure delegation to `delegate.valueOf(v)`. Not strict-mode-gated. |
| `parseAs(ctx, expr)` | `parse(expr)` from `@parser/index`; return `(scope, locals?) => this.getTrusted(ctx, parsed(scope, locals))`. Preserves `.literal`, `.constant`, `.oneTime` metadata from `parsed`. |
| `trustAsHtml` / `…Url` / `…ResourceUrl` / `…Js` / `…Css` | Thin wrappers over `trustAs(ctx, v)`. |
| `getTrustedHtml` / `…Url` / `…ResourceUrl` / `…Js` / `…Css` | Thin wrappers over `getTrusted(ctx, v)`. |
| `parseAsHtml` / `…Url` / `…ResourceUrl` / `…Js` / `…Css` | Thin wrappers over `parseAs(ctx, expr)`. |

### 2.8. `$SceDelegateProvider`

**File: `src/sce/sce-delegate-provider.ts`**

Instance state: `$$allowList: ResourceUrlListEntry[] = ['self']`, `$$blockList: ResourceUrlListEntry[] = []`.

Fluent getter/setter pattern, same style as `$InterpolateProvider.startSymbol`:

| Method | Contract |
| --- | --- |
| `trustedResourceUrlList(): ResourceUrlListEntry[]` | Returns a shallow copy so callers can't mutate internal state. |
| `trustedResourceUrlList(list)` | Validates entries, stores a defensive copy, returns `this`. |
| `bannedResourceUrlList(): ResourceUrlListEntry[]` / `bannedResourceUrlList(list)` | Symmetric. |
| `$get = [(): SceDelegateService => createSceDelegate({ trustedResourceUrlList: this.$$allowList, bannedResourceUrlList: this.$$blockList })]` | Array-style invokable with no deps. |

### 2.9. `$SceProvider`

**File: `src/sce/sce-provider.ts`**

Instance state: `$$enabled: boolean = true` (strict mode ON by default).

| Method | Contract |
| --- | --- |
| `enabled(): boolean` | Returns current flag. |
| `enabled(value: boolean): this` | Validates boolean, stores, returns `this`. |
| `$get = ['$sceDelegate', (delegate: SceDelegateService): SceService => createSce({ delegate, enabled: this.$$enabled })]` | Array-style invokable. Depending on `$sceDelegate` forces the DI graph to instantiate the delegate first. |

### 2.10. `ng` Module Registration

**File: `src/core/ng-module.ts`** — extended:

```
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import type { SceService, SceDelegateService } from '@sce/sce-types';

declare module '@di/di-types' {
  interface ModuleRegistry {
    ng: {
      registry: {
        $interpolate: InterpolateService;
        $sceDelegate: SceDelegateService;
        $sce: SceService;
      };
      config: {
        $interpolateProvider: $InterpolateProvider;
        $sceDelegateProvider: $SceDelegateProvider;
        $sceProvider: $SceProvider;
      };
    };
  }
}

export const ngModule = createModule('ng', [])
  .provider('$sceDelegate', $SceDelegateProvider)
  .provider('$sce', $SceProvider)
  .provider('$interpolate', $InterpolateProvider);
```

Registration order is informational; actual instantiation order is driven by the DI dependency graph (spec 008).

### 2.11. `$interpolate` Integration

**File: `src/interpolate/interpolate.ts`** — changes:

1. `InterpolateOptions` gains two optional callbacks (already planned in spec 011 for this hand-off):
   - `sceGetTrusted?: (ctx: SceContext, value: unknown) => unknown`
   - `sceIsEnabled?: () => boolean`
2. The service signature narrows `trustedContext` from `string` to `SceContext | undefined`.
3. On `$interpolate(text, mustHaveExpression?, trustedContext?, allOrNothing?)`:
   - If `trustedContext !== undefined`, validate via `isValidSceContext` — throw on unknown.
   - **Compile-time single-binding check:** if `trustedContext !== undefined` AND `sceIsEnabled?.() === true`, scan the template; if any `textSegments[i] !== ''` OR `expressions.length > 1`, throw `"interpolations in trusted contexts must consist of exactly one expression: <text>"` including the offending source and context.
   - A literal-only template with `trustedContext` is allowed — nothing to sanitize.
4. **Render-time:** when `trustedContext` is set AND the single-binding check passed AND there is exactly one expression, route the evaluated value through `sceGetTrusted!(trustedContext, value)` BEFORE stringification. Trust violations surface synchronously.
5. Remove the `TODO(spec-$sce)` comment and the `void trustedContext;` no-op.

**File: `src/interpolate/interpolate-provider.ts`** — `$get` extended:

```
$get = [
  '$sce',
  ($sce: SceService): InterpolateService =>
    createInterpolate({
      startSymbol: this.$$startSymbol,
      endSymbol:   this.$$endSymbol,
      sceGetTrusted: (ctx, v) => $sce.getTrusted(ctx, v),
      sceIsEnabled:  () => $sce.isEnabled(),
    }),
] as const;
```

**File: `src/interpolate/interpolate-types.ts`** — `trustedContext` parameter type on `InterpolateService` narrows from `string` to `SceContext`.

### 2.12. Pure-ESM Consumer Path

ESM consumers wire `$sce` into `$interpolate` themselves — no footgun, no silent skip:

```
import { createInterpolate, sce } from 'my-own-angularjs';

const interp = createInterpolate({
  sceGetTrusted: sce.getTrusted,
  sceIsEnabled:  sce.isEnabled,
});
interp('{{trustedValue}}', false, 'html'); // full $sce enforcement
```

A consumer who omits the callbacks (`createInterpolate()`) gets the spec-011 pass-through behavior: `trustedContext` is accepted but not enforced. This is documented in JSDoc on `createInterpolate` and in `CLAUDE.md` as an explicit opt-in.

### 2.13. Public Exports

**File: `src/index.ts`** — extended:

```
export {
  createSce,
  sce,
  createSceDelegate,
  sceDelegate,
  SCE_CONTEXTS,
  TrustedValue,
  TrustedHtml,
  TrustedUrl,
  TrustedResourceUrl,
  TrustedJs,
  TrustedCss,
  isTrustedValue,
  isTrustedFor,
} from './sce/index';
export type {
  SceContext,
  SceService,
  SceDelegateService,
  SceOptions,
  SceDelegateOptions,
  ResourceUrlListEntry,
} from './sce/index';
```

`$SceProvider` / `$SceDelegateProvider` remain internal — reachable via `injector.get('$sceProvider')` / `injector.get('$sceDelegateProvider')` during `config()`, which is the AngularJS-idiomatic surface.

### 2.14. `CLAUDE.md` Update

- Add `./sce` to the Modules table with a one-liner on strict-mode default, the ESM `createSce` / `sce` entry points, and `TrustedValue` identity via `instanceof`.
- Add a "Non-obvious invariants" bullet: "Strict mode is frozen after config phase — `$sceProvider.enabled(false)` is the only way to disable it."
- Add a "Where to look when..." row: "How does `$sce` decide whether a resource URL is allowed?" → `src/sce/resource-url-matcher.ts`.

---

## 3. Impact and Risk Analysis

### System Dependencies

- **`src/parser/`** — consumed read-only via `parse(expr)` inside `createSce`'s `parseAs`. No changes.
- **`src/core/ng-module.ts`** — extended: two new `.provider(...)` registrations and the matching `ModuleRegistry` augmentation.
- **`src/interpolate/interpolate.ts` and `interpolate-provider.ts`** — modified: real `trustedContext` behavior, single-binding check, DI wiring of `sceGetTrusted` / `sceIsEnabled`. `TODO(spec-$sce)` removed.
- **`src/di/`** — consumed read-only. Uses existing `.provider(...)` recipe and array-style injectable `$get` from spec 008.
- **`src/core/scope.ts`** — untouched. `$sce` does not participate in the digest.
- **Existing tests** (specs 003, 007, 008, 009, 010, 011) — must pass unchanged. Spec-011 interpolate tests that exercise `trustedContext` as a no-op still work via the pure-ESM path without callbacks.

### Potential Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Circular import between `src/sce/` and `src/interpolate/`. | `src/sce/` depends only on `@parser/index` and `@di/*`. `src/interpolate/` imports from `@sce/sce-types` only as a type-only import for `SceContext`. The `$sce` runtime is supplied via DI in `$InterpolateProvider.$get` or directly by the ESM consumer. Cycle-free. |
| Breaking TS change: `trustedContext` on `InterpolateService` narrows from `string` to `SceContext`. | `SceContext` is a union of string literals; structural assignability from literal strings still works. Variables typed as bare `string` need a cast — documented in `CLAUDE.md`. All internal callers pass one of the five known context keys. |
| `'self'` resolution relies on `document` / `document.baseURI`, unavailable in pure-Node contexts. | Lazy resolution — `document` is read inside `match()` at call time, not at factory construction. Tests use jsdom (Vitest default). A `getBaseUrl()` helper centralizes the lookup and throws a descriptive error if `document` is missing so misuse is obvious. |
| String-pattern → regex compilation is subtle (`**` vs `*` vs escaped metacharacters). | Dedicated tests in `resource-url-matcher.test.ts` cover each wildcard behavior and AngularJS-documented edge cases (`*` doesn't cross `/`, `:`, `?`, `#`). Test vectors ported from AngularJS `sceSpecs.js`. |
| Provider lists are mutable if the setter exposes the stored arrays. | Defensive copy on set AND on get. Compilation runs only at `$get` time so late mutations can't affect an already-instantiated delegate. |
| Strict-mode OFF should be a total no-op, including no `Trusted*` wrappers. | Façade check: `sce.trustAs` returns the value unchanged when `!enabled`. Tests assert the no-wrapper contract under strict-off. |
| ESM consumers might silently skip `$sce` by forgetting the callbacks. | Documented loudly in `createInterpolate` JSDoc and `CLAUDE.md`. Example snippets show both paths. An ESM/DI parity test asserts both paths produce identical output when configured equivalently. |
| Pre-commit `$interpolate` single-binding check adds per-call cost even when strict mode is off. | Check is gated behind `sceIsEnabled?.() === true`. No callback → no cost. Off-strict → no cost beyond the existing scan. |
| `parseAs` consumers expect `.literal` / `.constant` / `.oneTime` from the inner `ExpressionFn` to survive. | `parseAs` copies those flags onto the returned function via `Object.defineProperties`, same pattern as `createInterpolate`. Tested. |
| Subclass subtype rule (`TrustedResourceUrl extends TrustedUrl`) could confuse `instanceof` users who expect them disjoint. | Documented on the class JSDoc and in `isTrustedFor`. AngularJS parity is the reason — migration-safe for classic code. |
| Future `$compile` integration (out of scope) may want different semantics for HTML attributes. | Non-blocking: `sce.parseAs` returns the trust-unwrapping fn; future `$compile` can either reuse it or compose its own on top of `sce.getTrusted`. This spec records no commitment. |
| Block-list / allow-list evaluation order ambiguity. | Explicit contract: block wins. Evaluate block first, reject short-circuit; otherwise require allow to match. Dedicated test: URL matching both lists is rejected. |

---

## 4. Testing Strategy

All tests use Vitest (project standard). Target 90%+ coverage on `src/sce/` (architecture § 2).

### 4.1. Trusted-Value Tests — `src/sce/__tests__/trusted-values.test.ts`

- `new TrustedHtml('x').toString() === 'x'`; `String(new TrustedHtml('x')) === 'x'`.
- `new TrustedHtml('x') instanceof TrustedValue` and `TrustedHtml`; NOT `TrustedUrl`.
- `new TrustedResourceUrl('x') instanceof TrustedUrl` (subtype), `TrustedResourceUrl`, `TrustedValue`.
- `isTrustedFor('html', new TrustedHtml('x')) === true`; false for other contexts.
- `isTrustedFor('url', new TrustedResourceUrl('x')) === true` (subtype acceptance).
- `isTrustedFor('resourceUrl', new TrustedUrl('x')) === false` (no reverse subtype).

### 4.2. Resource-URL Matcher Tests — `src/sce/__tests__/resource-url-matcher.test.ts`

- String pattern `'https://api.example.com/**'` matches `'https://api.example.com/v1/users'`.
- `*` does NOT match across `/` (e.g. `'https://api.*.com/x'` matches `'https://api.my.com/x'` but not `'https://api.my.corp.com/x'`).
- `**` DOES match across `/`.
- `'self'` matches relative URLs and same-origin absolute URLs; rejects cross-origin.
- Protocol-relative URLs (`//other.com/x`) resolve against `document.baseURI`.
- RegExp entries test against the full URL string.
- Empty allow-list → nothing matches.
- Invalid entries throw at compile time.
- Re-compiling the same list is idempotent.

### 4.3. `createSceDelegate` ESM Tests — `src/sce/__tests__/sce-delegate-esm.test.ts`

- `createSceDelegate()` with defaults: `allowList: ['self']`, `blockList: []`.
- `trustAs('html', 'x')` returns a `TrustedHtml` instance.
- `trustAs('html', null)` returns `null`; `trustAs('html', undefined)` returns `undefined`.
- `trustAs('html', 42)` throws naming `typeof`.
- Re-wrap: `trustAs('url', trustAs('html', 'x'))` returns a `TrustedUrl`.
- `getTrusted('html', trustedHtml)` returns the string; `getTrusted('url', trustedHtml)` throws.
- `getTrusted('url', 'http://example.com')` returns the string unchanged.
- `getTrusted('resourceUrl', ...)`: allow-list match → returns URL; no match → throws; block-list match → throws (precedence).
- `valueOf(trustedHtml)` returns the string; `valueOf('plain')` returns `'plain'`.

### 4.4. `createSce` ESM Tests — `src/sce/__tests__/sce-esm.test.ts`

- `createSce()`: `isEnabled() === true`; all 15 shortcuts delegate correctly.
- Strict OFF: `createSce({ enabled: false })` — `trustAs('html', 'x') === 'x'` (no wrapper); `getTrusted('html', 'x') === 'x'`; no errors.
- Strict ON: `getTrusted('html', 'x')` throws; `getTrusted('html', trustAsHtml('x'))` returns the string.
- `parseAs('html', 'user.bio')(scope)` unwraps a `TrustedHtml` at `scope.user.bio`.
- `parseAs` preserves `.literal`, `.constant`, `.oneTime` from `parse()`.
- Methods are safely destructurable: `const { trustAsHtml } = sce; trustAsHtml('x')` works.
- Explicit delegate injection: `createSce({ delegate: customDelegate })` routes through the custom delegate.

### 4.5. `$SceDelegateProvider` Unit Tests — `src/sce/__tests__/sce-delegate-provider.test.ts`

- Defaults: `trustedResourceUrlList() === ['self']`, `bannedResourceUrlList() === []`.
- Fluent chaining: `provider.trustedResourceUrlList([...]).bannedResourceUrlList([...])`.
- Returned lists are copies (mutation doesn't affect the provider).
- Invalid entries throw at setter call time.

### 4.6. `$SceProvider` Unit Tests — `src/sce/__tests__/sce-provider.test.ts`

- `enabled() === true` by default.
- `enabled(false)` disables; `enabled()` returns `false`.
- `enabled(false)` returns `this`.

### 4.7. DI Integration + ESM/DI Parity Tests — `src/sce/__tests__/sce-di.test.ts`

- `createInjector([ngModule])` exposes `$sce` and `$sceDelegate` at runtime.
- `$sceProvider` / `$sceDelegateProvider` only accessible during `config()`.
- `config(['$sceDelegateProvider', p => p.bannedResourceUrlList([...])])` is observed by `$sce.getTrustedResourceUrl`.
- `config(['$sceProvider', p => p.enabled(false)])` produces a pass-through `$sce` instance.
- **ESM/DI parity:** for a representative set of inputs, `sce` (ESM default export) and the DI-resolved `$sce` produce identical outputs. Same for `sceDelegate` vs. `$sceDelegate`.

### 4.8. `$interpolate` ↔ `$sce` Integration — extend `src/interpolate/__tests__/interpolate-di.test.ts` (or a new `interpolate-sce.test.ts`)

- Strict ON, HTML: `$interpolate('{{trustedValue}}', false, 'html')(scope)` returns the unwrapped string for a `TrustedHtml`.
- Strict ON, HTML: `$interpolate('Hello {{trustedValue}}', false, 'html')` throws at compile time (single-expression).
- Strict ON, HTML: `$interpolate('{{a}}{{b}}', false, 'html')` throws at compile time.
- Strict ON, HTML, plain-string scope value: `$interpolate('{{x}}', false, 'html')(scope)` throws at render (trust violation).
- Strict OFF: `$interpolate('Hello {{name}}', false, 'html')(scope)` works like spec-011 (literal text allowed, no trust check).
- Literal-only template with `trustedContext`: `$interpolate('Hello world', false, 'html')(scope)` returns `'Hello world'`.
- Invalid context: `$interpolate('{{x}}', false, 'bogus')` throws.
- `mustHaveExpression`, `allOrNothing`, `::` behaviors interoperate with `trustedContext`.
- **Pure-ESM wiring:** `createInterpolate({ sceGetTrusted: sce.getTrusted, sceIsEnabled: sce.isEnabled })` enforces trust identically to the DI-resolved `$interpolate`.

### 4.9. AngularJS Parity Cross-Reference

Per architecture § 2, cross-reference `angular/angular.js/test/ng/sceSpecs.js` and `sceDelegateSpecs.js`. Port scenarios not covered by § 4.1–4.8. Manual review step before marking the spec Completed (same process as specs 005, 010, 011).

### 4.10. Regression Tests

Entire existing suites (specs 003, 007, 008, 009, 010, 011) continue to pass unchanged. CI runs them on every push.
