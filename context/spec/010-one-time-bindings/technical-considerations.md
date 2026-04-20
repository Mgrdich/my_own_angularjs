# Technical Specification: One-Time Bindings (`::` Prefix) & Constant Watch Optimization

- **Functional Specification:** [`context/spec/010-one-time-bindings/functional-spec.md`](./functional-spec.md)
- **Status:** Draft
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

The implementation extends two existing subsystems — the expression parser (`src/parser/`) and the Scope runtime (`src/core/scope.ts`) — without introducing new architectural concepts. Every change is additive: the parser gains prefix-stripping and three metadata flags on the returned function; the Scope gains three "watch delegates" that wrap the normal watcher behavior for `::`-prefixed and constant expressions.

The approach mirrors AngularJS 1.x's `$$watchDelegate` mechanism, but scoped down to the two delegates this spec needs (`oneTimeWatchDelegate`, `constantWatchDelegate`) plus a literal-aware variant. The `inputsWatchDelegate` optimization and the filter-pipeline `addInterceptor` chain from AngularJS are explicitly out of scope per the functional spec.

No new dependencies, no new build targets, no new test frameworks. All changes ship within the existing package.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1. Parser Changes

**File: `src/parser/parse.ts`** — extend `parse()` to:

1. Trim leading/trailing whitespace.
2. If the trimmed string begins with `::`, set `oneTime = true` and strip the prefix (AngularJS-parity; matches `getAst` at `angular.js:parse.js:1655`).
3. Validate the stripped remainder is non-empty (else throw a descriptive parse error).
4. Tokenize/AST-build the remainder normally.
5. Compute `constant` and `literal` flags from the AST (see 2.2).
6. Assign `oneTime`, `constant`, `literal` as properties on the returned `ExpressionFn`.

**File: `src/parser/ast-flags.ts`** (new) — exports two pure functions over `ASTNode`:

| Helper         | Responsibility                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `isConstant`   | Recursive: returns `true` only if every node in the tree is a `Literal`, `ArrayExpression`/`ObjectExpression` of constants. `Identifier`, `MemberExpression`, `CallExpression`, `AssignmentExpression`, and any `ThisExpression` short-circuit to `false`. |
| `isLiteral`    | Non-recursive: returns `true` iff the top-level `Program.body` is a `Literal`, `ArrayExpression`, or `ObjectExpression`.    |

Matches AngularJS's `isConstant`/`isLiteral` semantics (see `angular.js:parse.js:629` for `isPure` and the `constant`/`literal` flag logic at `1649-1650`).

**File: `src/parser/parse-types.ts`** — extend the `ExpressionFn` type:

```ts
export type ExpressionFn = ((scope?: Record<string, unknown>, locals?: Record<string, unknown>) => unknown) & {
  readonly oneTime: boolean;
  readonly constant: boolean;
  readonly literal: boolean;
};
```

All three flags are always present (required, not optional) — AngularJS parity and simpler type narrowing.

### 2.2. Lexer — No Changes Required

The `::` is consumed before the lexer runs (pure string operation in `parse()`). The existing lexer does not need to recognize `:` as a special multi-character token; nested/mid-expression `::` will naturally produce a parse error via the existing single-`:` rules (e.g., ternary colon misuse).

### 2.3. Scope Runtime Changes

**File: `src/core/scope.ts`** — modify `compileToWatchFn` and `$watch`:

- `compileToWatchFn` currently returns a raw `WatchFn`. Refactor it so that for a string input, it returns BOTH the compiled watch fn AND the parsed-fn flags. Two shape options, pick one during implementation (small detail, no architectural impact): return an object `{ fn, oneTime, constant, literal }`, OR keep returning the fn but attach flags to it. The second option matches `ExpressionFn` precedent.
- `$watch` inspects the compiled-fn flags:
  - `constant === true` → delegate to `constantWatchDelegate`.
  - `constant === false && oneTime === true && literal === true` → delegate to `oneTimeLiteralWatchDelegate`.
  - `constant === false && oneTime === true && literal === false` → delegate to `oneTimeWatchDelegate`.
  - Otherwise → existing watcher registration path (unchanged).
- Function-form watch expressions have no flags → always take the existing path.

**File: `src/core/scope-watch-delegates.ts`** (new) — exports three delegate functions. Each has signature:

```
delegate(
  scope: Scope,
  watchFn: WatchFn,
  listenerFn: ListenerFn,
  valueEq: boolean
): DeregisterFn
```

| Delegate                         | Behavior                                                                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `constantWatchDelegate`          | Registers a watcher that, on first invocation, captures the value, deregisters itself, and returns the value. Listener fires normally (via the next digest's change-detection). Mirrors `angular.js:parse.js:1939`. |
| `oneTimeWatchDelegate`           | Registers a wrapped watch fn. On each digest, evaluates the underlying fn; if result `!== undefined`, schedules `scope.$$postDigest(unwatch)`. Subsequent digests before post-digest fire-up still re-check (the value may flip back to undefined — AngularJS rechecks at post-digest time). Mirrors `angular.js:parse.js:1894`. |
| `oneTimeLiteralWatchDelegate`    | Same as above but uses `isAllDefined(value)` (every element/property of the result is `!== undefined`) as the stability predicate. Mirrors `angular.js:parse.js:1931`.                       |

Each delegate returns the existing deregister fn from `$watch`, so callers of `$watch` see no signature change.

### 2.4. `$watchGroup` — No Code Changes Required

`$watchGroup` already calls `this.$watch(watchFn, ...)` for each entry (`scope.ts:438`). Because `$watch` now honors the parsed-fn flags for string inputs, each entry's `::` / constant behavior flows through automatically. Per-entry deregistration already exists (each entry gets its own unwatch pushed into `deregisterFns`).

One subtle case: the functional spec (§2.6) requires that `::a`'s slot in `newValues` retains its last stable value after its individual watch deregisters. This already falls out of the existing implementation — `newValues[i]` is only written by that entry's listener, which no longer fires once deregistered. Verified by reading `scope.ts:437-446`.

### 2.5. `$watchCollection` — Targeted Change

`$watchCollection` builds an internal change-counter `WatchFn` (not a string) and calls `$watch(internalWatchFn, ...)`. Because the internal fn is a function (not a string), it has no flags — so the new routing in `$watch` never sees `oneTime`.

To fix this without duplicating the delegate logic: in `$watchCollection`, detect if the INPUT `watchFn` is a string with `oneTime === true` on its parsed form, and if so, set a local flag `isOneTime = true`. Then wrap the `internalListenerFn` so that on first fire with a non-`undefined` `newValue`, it schedules `this.$$postDigest(() => deregister())`. A single local boolean + a `$$postDigest` call, no delegate plumbing.

For constant collection expressions (e.g., `$watchCollection('[1,2,3]', fn)`), similar treatment: if the parsed fn is `constant`, schedule immediate deregistration after the first invocation.

### 2.6. `$eval` / `$apply` / `$evalAsync` / `$applyAsync` — No Code Changes Required

These methods already route string expressions through `parse()` (via the existing spec-009 integration). Since `parse()` now strips `::` before building the AST, `::a + b` evaluates identically to `a + b`. The `oneTime` flag is inert here because no watcher is registered.

### 2.7. Module Exports

`src/parser/index.ts`, `src/core/index.ts`, and `src/index.ts` need no new public exports. The `ExpressionFn` type gains new properties (additive). The `ast-flags.ts` helpers and `scope-watch-delegates.ts` functions are internal implementation details — not exported from the package root.

---

## 3. Impact and Risk Analysis

### System Dependencies

- **Parser pipeline (`lexer.ts` → `ast.ts` → `interpreter.ts`):** No behavioral changes to any stage; only an additive prefix-strip step before the lexer and a new post-AST analysis pass for flags.
- **Scope runtime (`scope.ts`):** The `$watch` registration path gains a flag-inspection branch. All existing function-form watchers and string-form non-prefixed/non-constant watchers take the same code path as today.
- **Consumers of `parse()`:** None outside the Scope module currently exist. The `ExpressionFn` type gaining three required properties is technically a source-level type change, but any in-repo callers only USE the fn as a callable and don't spread/destructure it — verified by grepping for `parse(` and `ExpressionFn` usages.

### Potential Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| `::` prefix stripping at the parser level changes the error-message surface for malformed expressions like `::` or `::   ` | Explicit check in `parse()` after stripping: if the remainder is empty/whitespace, throw `"Empty expression after '::'"` — descriptive and tested (per functional spec §2.9). |
| `oneTimeWatchDelegate` uses `$$postDigest` — in a nested `$apply`/`$digest`, the callback may run at an unexpected phase | `$$postDigestQueue` is already shared across the scope tree (`scope.ts:151`) and drained at the end of each digest (`scope.ts:286`). This matches AngularJS exactly; no change needed. |
| Deregistering a watcher during digest iteration must remain safe | `$watch`'s deregister fn nulls the slot rather than splicing (`scope.ts:127-129`). The existing digest loop handles nulls. `$$postDigest` runs AFTER digest iteration completes, so deregistration timing is safe by construction. |
| Literal-aware `isAllDefined` traversal on large array/object literals could add per-digest cost | Only runs for `::`-prefixed literal expressions — a rare authoring pattern. When the literal's children are constants, the check is O(n) over the literal's own definition (not the data it contains), which is bounded by the parsed expression size. Acceptable. |
| Flags missing on fn-form watch expressions could cause `undefined` narrowing bugs | `$watch` only checks flags when the input was a STRING (goes through `compileToWatchFn`). Function-form watch expressions take the pre-existing registration path unchanged. No code reads flags off a function-form watchFn. |
| Confusion between `literal` and `constant` — `[1, 2]` is both, `[a, b]` is literal-only, `a` is neither | Clear JSDoc on both helpers in `ast-flags.ts` with concrete examples. Full unit test coverage of edge cases (see §4). |
| AngularJS also unwatches `oneTime` literals only after post-digest re-check; implementing this incorrectly would leak a watcher or prematurely unwatch | Follow AngularJS's exact flow: schedule `$$postDigest(unwatchIfStillDone)` where the post-digest fn re-checks stability before unwatching. Tested directly against parity scenarios. |

---

## 4. Testing Strategy

All tests use Vitest (the project standard). No new test infrastructure needed.

### 4.1. Parser Unit Tests — `src/parser/__tests__/parse.test.ts` (extend)

Add test blocks for:

- `::` prefix detection: `oneTime` flag true/false parity
- Whitespace handling around `::`
- Sub-expression `::` errors (`a + ::b`, `::a + ::b`, `foo(::x)`)
- Lone `::` error
- `oneTime` flag does not affect evaluated value (stripped expression evaluates identically)

### 4.2. AST Flag Unit Tests — `src/parser/__tests__/ast-flags.test.ts` (new)

Independent unit tests for `isConstant` and `isLiteral`:

- Primitives (`42`, `'x'`, `true`, `null`) — both `true`
- Identifier (`a`) — both `false`
- Member access (`a.b`) — both `false`
- Array of constants (`[1, 2, 3]`) — both `true`
- Array with identifiers (`[a, 2]`) — literal `true`, constant `false`
- Object of constants (`{x: 1}`) — both `true`
- Object with identifiers (`{x: a}`) — literal `true`, constant `false`
- Nested literals — correct recursive behavior
- Function calls — both `false` regardless of arguments
- Assignment — both `false`
- Unary/binary/logical/ternary operators over constants — constant `true`, literal `false`

### 4.3. Scope Integration Tests — `src/core/__tests__/scope-string-expr.test.ts` (extend)

Add a `describe('one-time bindings', ...)` block covering each acceptance criterion from the functional spec:

- `$watch('::expr', fn)` — defers listener until value non-undefined; deregisters post-digest
- `$watch('::expr', fn)` — stability treats `null`, `0`, `''`, `false`, `NaN` as stable
- `$watch('::[a, b]', fn)` — literal stability rule (all elements defined)
- `$watch('::{x: a}', fn)` — object literal stability rule
- `$watch('::[]', fn)`, `$watch('::{}', fn)` — empty literals deregister immediately
- `$watch('42', fn)`, `$watch('::42', fn)` — constant one-shot + deregister
- `$watch('[1, 2]', fn)` — constant-array one-shot
- Manual deregister before stabilization — listener never fires
- Never-stabilizing `::` — watcher remains live
- `$watchGroup(['::a', 'b'], fn)` — per-entry deregistration
- `$watchCollection('::items', fn)` — collection one-time
- `$watchCollection('items', fn)` — unchanged normal behavior
- `$eval('::a + b')`, `$apply('::x = 1')`, `$evalAsync('::x')`, `$applyAsync('::y = 1')` — prefix stripped, no watcher side-effects
- Parse errors for `::`, `a + ::b` surface synchronously at `$watch` registration

### 4.4. Regression Tests

Entire existing suites (spec 003 parser, spec 009 parser/scope-integration, spec 006 digest-TTL, spec 002 scope) must continue to pass unchanged. CI runs them on every push.

### 4.5. AngularJS Parity Cross-Reference

Per `context/product/architecture.md` § 2, cross-reference the AngularJS repo test files:

- `angular/angular.js/test/ng/parseSpec.js` — one-time bindings test block (search "oneTime" / "::")
- `angular/angular.js/test/ng/rootScopeSpec.js` — `$watch`/`$watchGroup`/`$watchCollection` one-time scenarios

Port scenarios that aren't already covered by the §4.3 list. This is a manual review step before marking the spec Completed, analogous to the process used in spec 005.
