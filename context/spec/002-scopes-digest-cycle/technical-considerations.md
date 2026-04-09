# Technical Specification: Scopes & Digest Cycle

- **Functional Specification:** `context/spec/002-scopes-digest-cycle/functional-spec.md`
- **Status:** Completed
- **Author(s):** Poe (AI Assistant)

---

## 1. High-Level Technical Approach

Implement a generic `Scope<T>` class that serves as the foundational runtime data structure for the framework. The class lives in `src/core/` and uses:

1. **Generic type parameter `T`** — allows consumers to define their scope's data shape (`Scope<{ name: string }>`) while internal code uses `Scope` (defaults to `Record<string, unknown>`)
2. **`Object.create(this)`** — creates child scopes via prototypal inheritance, matching AngularJS's behavior
3. **`structuredClone`** — replaces lodash `cloneDeep` for value-based watch snapshots (zero dependencies)
4. **Custom `isEqual`** — replaces lodash `isEqual` for deep equality comparison in dirty checking (avoids cloning overhead)
5. **Sentinel-null pattern** — safely handles watcher/listener deregistration during iteration (set to `null`, skip nulls, compact later)

No external dependencies are introduced. The module exports clean TypeScript types for downstream consumption by DI, Compiler, and Parser modules.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1. File Organization

| File | Responsibility |
|------|---------------|
| `src/core/scope.ts` | `Scope<T>` class — all public methods and internal digest logic |
| `src/core/scope-types.ts` | All type definitions, interfaces, and type aliases |
| `src/core/is-equal.ts` | Custom deep equality utility function |
| `src/core/index.ts` | Barrel export — re-exports `Scope` class and all public types |
| `src/core/__tests__/scope.test.ts` | Comprehensive test suite with nested `describe` blocks |

### 2.2. Type Definitions (`scope-types.ts`)

| Type | Shape | Purpose |
|------|-------|---------|
| `WatchFn<T>` | `(scope: Scope) => T` | Watch function passed to `$watch` |
| `ListenerFn<T>` | `(newValue: T, oldValue: T, scope: Scope) => void` | Listener called when watch value changes |
| `DeregisterFn` | `() => void` | Returned by `$watch`, `$watchGroup`, `$on` |
| `Watcher<T>` | `{ watchFn: WatchFn<T>; listenerFn: ListenerFn<T>; last: T \| UniqueSymbol; valueEq: boolean }` | Internal watcher record |
| `ScopeEvent` | `{ name: string; targetScope: Scope; currentScope: Scope \| null; defaultPrevented: boolean; stopPropagation(): void; preventDefault(): void }` | Event object passed to listeners |
| `EventListener` | `(event: ScopeEvent, ...args: unknown[]) => void` | Listener registered via `$on` |
| `AsyncTask` | `{ scope: Scope; expression: WatchFn<unknown> }` | Queued async expression |
| `ScopePhase` | `'$digest' \| '$apply' \| null` | Phase tracking literal union |

**Initial watch value sentinel:** Use a unique `Symbol('initWatchVal')` as the initial `last` value on watchers. This avoids the problem of any real value (including `undefined`) matching the initial state.

### 2.3. Scope Class Design (`scope.ts`)

**Generic parameter:** `Scope<T extends Record<string, unknown> = Record<string, unknown>>`

The class uses an index signature `& { [K in keyof T]: T[K] }` via a mapped type intersection so that:
- `new Scope<{ name: string }>()` gives typed property access
- `new Scope()` allows arbitrary `unknown` property access via bracket notation
- Internal framework code operates on unparameterized `Scope`

**Internal properties** (initialized in constructor):

| Property | Type | Initial Value |
|----------|------|--------------|
| `$root` | `Scope` | `this` (overridden in child scopes) |
| `$parent` | `Scope \| null` | `null` |
| `$$watchers` | `(Watcher \| null)[] \| null` | `[]` |
| `$$children` | `Scope[]` | `[]` |
| `$$listeners` | `Record<string, (EventListener \| null)[]>` | `{}` |
| `$$asyncQueue` | `AsyncTask[]` | `[]` (shared from root) |
| `$$applyAsyncQueue` | `AsyncTask[]` | `[]` (shared from root) |
| `$$postDigestQueue` | `(() => void)[]` | `[]` (shared from root) |
| `$$lastDirtyWatch` | `Watcher \| null` | `null` |
| `$$applyAsyncId` | `ReturnType<typeof setTimeout> \| null` | `null` (only on root) |
| `$$phase` | `ScopePhase` | `null` |

### 2.4. Child Scope Creation (`$new`)

**Normal child scope (`$new()` or `$new(false)`):**

```
const child = Object.create(this) as Scope;
```

Then shadow own properties: `$$watchers = []`, `$$children = []`, `$$listeners = {}`. The prototype chain provides property inheritance. Add child to `this.$$children`.

**Isolated child scope (`$new(true)`):**

```
const child = new Scope();
```

Manually copy shared references: `$root`, `$$asyncQueue`, `$$applyAsyncQueue`, `$$postDigestQueue`. Set `child.$parent = this`. Add to `this.$$children`.

**Custom parent (`$new(false, customParent)`):**

Same as normal child, but set `child.$parent = customParent` and add to `customParent.$$children` instead.

### 2.5. Digest Cycle Algorithm

1. **`$digest()`** sets `$$phase = '$digest'`, resets `$$lastDirtyWatch = null`
2. Loops up to **TTL = 10** iterations:
   a. Drain `$$asyncQueue` — execute each task, catch and log errors
   b. Call `$$digestOnce()` — returns `dirty` boolean
   c. If not dirty and `$$asyncQueue` is empty, break
   d. If TTL exceeded, throw `'10 digest iterations reached'`
3. Drain `$$applyAsyncQueue` if pending (cancel `$$applyAsyncId` timeout)
4. Clear `$$phase`
5. Drain `$$postDigestQueue` — execute each, catch and log errors

**`$$digestOnce()`** uses `$$everyScope()` to recursively traverse the scope tree. For each scope, iterates `$$watchers` in **reverse order**. Compares `newValue` vs `watcher.last`:
- Reference equality by default (`!==`)
- Custom `isEqual()` when `valueEq` is `true`
- NaN self-equality check: `typeof newValue === 'number' && isNaN(newValue) && typeof last === 'number' && isNaN(last)`

When dirty: clone via `structuredClone` if `valueEq`, call `listenerFn(newValue, oldValue, scope)`, set `$$lastDirtyWatch = watcher`.

**Short-circuit:** If current watcher === `$$lastDirtyWatch` and not dirty, return `false` from `$$everyScope` to stop early.

### 2.6. `$watchCollection` Algorithm

Uses a **change counter** pattern — the watch function returns an incrementing integer whenever a change is detected, and the listener is the user's actual callback.

Internal watch function:
1. Get `newValue` from user's `watchFn(scope)`
2. Compare against tracked `internalOldValue`:
   - **Array:** Compare length, then element-by-element (reference equality + NaN check)
   - **Object:** Compare property count, then key-by-key value comparison
   - **Primitive:** Standard reference check + NaN
3. If changed: increment `changeCount`, update `internalOldValue` shallow copy
4. Return `changeCount` (triggers the standard `$watch` dirty check)

Internal listener function: calls user's `listenerFn(newValue, veryOldValue, scope)`. Only tracks `veryOldValue` if the listener function accepts more than 1 argument (`listenerFn.length > 1`) to avoid unnecessary cloning.

### 2.7. Event System

**`$on(eventName, listener)`:** Push listener to `$$listeners[eventName]` array. Return `DeregisterFn` that sets the array slot to `null`.

**`$emit(eventName, ...args)`:** Create `ScopeEvent` object. Walk upward from `this` through `$parent` chain. On each scope, fire listeners via `$$fireEventOnScope`. Stop if `stopPropagation()` was called. Return event.

**`$broadcast(eventName, ...args)`:** Create `ScopeEvent` object. Recursively visit `this` and all `$$children` (depth-first). Fire listeners via `$$fireEventOnScope` on each. `stopPropagation` is a no-op for broadcast. Return event.

**`$$fireEventOnScope(event, args)`:** Iterate `$$listeners[event.name]`. Skip `null` entries. Catch and log exceptions from individual listeners. After iteration, compact the array (remove nulls) to prevent unbounded growth.

### 2.8. Deep Equality Utility (`is-equal.ts`)

A minimal recursive deep equality function supporting:
- Primitives (strict equality + NaN)
- Arrays (length + element-by-element recursion)
- Plain objects (key count + key-by-key recursion)
- `null` / `undefined`
- `Date` objects (getTime comparison)
- `RegExp` objects (source + flags comparison)

Does NOT need to handle: `Map`, `Set`, `WeakMap`, `WeakRef`, `ArrayBuffer`, circular references, or class instances beyond `Date`/`RegExp`. This keeps it simple and fast for the Scope use case.

---

## 3. Impact and Risk Analysis

**System Dependencies:**
- `src/core/index.ts` barrel export must be updated to re-export `Scope` and all public types
- `src/index.ts` must re-export from `./core`
- The Rollup build config already handles `src/index.ts` as entry — no changes needed
- ESLint, Vitest, and TypeScript configs already cover `src/` — no changes needed

**Potential Risks & Mitigations:**

| Risk | Impact | Mitigation |
|------|--------|------------|
| `Object.create()` loses TypeScript type narrowing for child scopes | Child scope methods may need explicit casts | Cast `Object.create(this) as Scope` — methods are on the prototype so they remain accessible |
| `structuredClone` doesn't handle functions or DOM nodes | Value-based watches on scopes containing functions will break | Document that `valueEq: true` is for data values only; functions should use reference watching |
| Generic `Scope<T>` adds complexity to internal code | Internal methods must work with any `T` | Internal code uses unparameterized `Scope` (defaults to `Record<string, unknown>`); only consumer-facing code benefits from `T` |
| `setTimeout` in `$evalAsync` / `$applyAsync` complicates testing | Tests with async scheduling need timer mocking | Use `vi.useFakeTimers()` in Vitest for deterministic async tests |
| Custom `isEqual` may have edge cases vs lodash | Behavioral divergence in deep comparison | Test `isEqual` independently with edge cases (NaN, nested objects, empty objects/arrays, Date, RegExp) |

---

## 4. Testing Strategy

**Test file:** `src/core/__tests__/scope.test.ts` — single file with nested `describe` blocks mirroring the legacy test structure.

**Test organization (describe blocks):**

| Block | Covers |
|-------|--------|
| `Scope` > `$digest` | Basic watch/digest, listener invocation, dirty checking, TTL, NaN handling, short-circuit optimization |
| `Scope` > `$watch` | Registration, deregistration, deregistration during digest, value vs reference equality |
| `Scope` > `$watchGroup` | Grouped watches, empty array, deregistration |
| `Scope` > `$watchCollection` | Array mutations, object mutations, type changes, NaN in arrays, shallow-only behavior |
| `Scope` > `$eval` and `$apply` | Expression evaluation, phase management, root digest trigger |
| `Scope` > `$evalAsync` | Queue execution, auto-digest scheduling, error handling |
| `Scope` > `$applyAsync` | Coalescing, flush during digest, error isolation |
| `Scope` > `$$postDigest` | Post-digest execution, no re-digest, error handling |
| `Scope` > `$$phase` | Phase tracking, nested call prevention |
| `Scope` > `inheritance` | `$new`, prototype chain, property shadowing, isolated scopes, custom parent |
| `Scope` > `$destroy` | Event broadcast, parent removal, watcher nullification, listener cleanup |
| `Scope` > `events` | `$on`, `$emit`, `$broadcast`, event object shape, stopPropagation, deregistration during fire |
| `isEqual` | Primitives, NaN, arrays, objects, Date, RegExp, nested structures |

**Approach:**
- Port legacy test behaviors 1:1 — each legacy `it()` block gets a corresponding Vitest `it()` block
- Use `vi.useFakeTimers()` for `$evalAsync` and `$applyAsync` tests
- Use `vi.fn()` for spy/mock assertions on listener calls
- Target 90%+ line coverage per the project's coverage threshold
