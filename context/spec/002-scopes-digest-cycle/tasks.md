# Tasks: Scopes & Digest Cycle

---

## Slice 1: Basic Scope with `$watch` and `$digest`

_After this slice: a root Scope can be created, watchers registered, and a digest cycle runs dirty checking with TTL protection. Tests pass._

- [ ] **Slice 1: Root Scope, `$watch`, and `$digest`**
  - [ ] Create `src/core/scope-types.ts` with core types: `WatchFn`, `ListenerFn`, `DeregisterFn`, `Watcher`, `ScopePhase`, `AsyncTask` **[Agent: typescript-framework]**
  - [ ] Create `src/core/scope.ts` with `Scope<T>` class — constructor initializing all internal properties, `$watch` (reference equality only), `$$digestOnce`, `$digest` with TTL=10, `$eval`, `$apply` **[Agent: typescript-framework]**
  - [ ] Update `src/core/index.ts` and `src/index.ts` barrel exports to re-export `Scope` and public types **[Agent: typescript-framework]**
  - [ ] Create `src/core/__tests__/scope.test.ts` with tests for: watch registration, listener invocation, dirty checking, chained watchers, TTL exception, NaN handling, short-circuit optimization, watcher deregistration, deregistration during digest, `$eval`, `$apply` with phase management **[Agent: vitest-testing]**
  - [ ] **Verify:** `pnpm lint` + `pnpm typecheck` + `pnpm test` all pass. `pnpm build` produces output including Scope exports. **[Agent: typescript-framework]**

---

## Slice 2: Value-based watching and `isEqual`

_After this slice: `$watch` supports deep value comparison via `valueEq: true`. Custom `isEqual` utility is tested independently._

- [ ] **Slice 2: Value-based `$watch` and `isEqual` utility**
  - [ ] Create `src/core/is-equal.ts` with deep equality function supporting primitives, NaN, arrays, objects, Date, RegExp **[Agent: typescript-framework]**
  - [ ] Add `valueEq` support to `$watch` — use `structuredClone` for snapshotting, `isEqual` for comparison **[Agent: typescript-framework]**
  - [ ] Add tests for `isEqual` (primitives, NaN, nested objects, arrays, Date, RegExp, empty structures) **[Agent: vitest-testing]**
  - [ ] Add tests for value-based `$watch` (array mutation detection, nested object changes, reference vs value mode) **[Agent: vitest-testing]**
  - [ ] **Verify:** `pnpm lint` + `pnpm typecheck` + `pnpm test` all pass **[Agent: typescript-framework]**

---

## Slice 3: Scope hierarchy (`$new`, `$destroy`)

_After this slice: child scopes (normal, isolated, custom parent) can be created, digests propagate through the tree, and scopes can be destroyed._

- [ ] **Slice 3: Scope hierarchy and destruction**
  - [ ] Implement `$new(isolated?, parent?)` — normal child via `Object.create`, isolated child via `new Scope()` with shared queues, custom parent support **[Agent: typescript-framework]**
  - [ ] Implement `$$everyScope` for recursive scope tree traversal, integrate into `$$digestOnce` **[Agent: typescript-framework]**
  - [ ] Implement `$destroy` — broadcast `$destroy` event, remove from parent `$$children`, nullify `$$watchers`, clear `$$listeners` **[Agent: typescript-framework]**
  - [ ] Add tests for: prototype inheritance, property shadowing, isolated scope isolation, shared queues, custom parent, nested scope digest, destruction cleanup **[Agent: vitest-testing]**
  - [ ] **Verify:** `pnpm lint` + `pnpm typecheck` + `pnpm test` all pass **[Agent: typescript-framework]**

---

## Slice 4: Async scheduling (`$evalAsync`, `$applyAsync`, `$$postDigest`)

_After this slice: async expressions can be scheduled and coalesced, post-digest callbacks work._

- [ ] **Slice 4: Async scheduling**
  - [ ] Implement `$evalAsync` — queue expression, auto-schedule digest via `setTimeout` if none running **[Agent: typescript-framework]**
  - [ ] Implement `$applyAsync` — coalesce multiple calls into single `setTimeout` + `$apply`, drain during active digest **[Agent: typescript-framework]**
  - [ ] Implement `$$postDigest` — queue functions to run after digest completes **[Agent: typescript-framework]**
  - [ ] Add tests using `vi.useFakeTimers()` for: `$evalAsync` queue execution and auto-digest, `$applyAsync` coalescing and flush-during-digest, `$$postDigest` timing and no-redigest behavior, error isolation in all three **[Agent: vitest-testing]**
  - [ ] **Verify:** `pnpm lint` + `pnpm typecheck` + `pnpm test` all pass **[Agent: typescript-framework]**

---

## Slice 5: `$watchGroup`

_After this slice: multiple watchers can be grouped with a single listener callback._

- [ ] **Slice 5: `$watchGroup`**
  - [ ] Implement `$watchGroup(watchFns, listenerFn)` — register individual watches, call listener once per digest with `[newValues, oldValues]` arrays, return deregister function **[Agent: typescript-framework]**
  - [ ] Add tests for: grouped watch notification, empty array edge case, deregistration, first-call oldValues === newValues **[Agent: vitest-testing]**
  - [ ] **Verify:** `pnpm lint` + `pnpm typecheck` + `pnpm test` all pass **[Agent: typescript-framework]**

---

## Slice 6: `$watchCollection`

_After this slice: shallow collection watching detects element-level array changes and property-level object changes._

- [ ] **Slice 6: `$watchCollection`**
  - [ ] Implement `$watchCollection(watchFn, listenerFn)` — change counter pattern, separate array/object/primitive branches, shallow comparison, NaN handling, `veryOldValue` tracking only when `listenerFn.length > 1` **[Agent: typescript-framework]**
  - [ ] Add tests for: array additions/removals/reorderings, object property add/remove/change, type transitions (primitive → array → object), NaN in arrays, shallow-only verification (nested changes not detected), oldValue tracking **[Agent: vitest-testing]**
  - [ ] **Verify:** `pnpm lint` + `pnpm typecheck` + `pnpm test` all pass **[Agent: typescript-framework]**

---

## Slice 7: Event system (`$on`, `$emit`, `$broadcast`)

_After this slice: the full event system works with upward/downward propagation, stopPropagation, and safe deregistration during fire._

- [ ] **Slice 7: Event system**
  - [ ] Add `ScopeEvent` and `EventListener` types to `scope-types.ts` **[Agent: typescript-framework]**
  - [ ] Implement `$on(eventName, listener)` — register listener, return deregister function using null-sentinel pattern **[Agent: typescript-framework]**
  - [ ] Implement `$emit(eventName, ...args)` — upward propagation through `$parent` chain, stopPropagation support **[Agent: typescript-framework]**
  - [ ] Implement `$broadcast(eventName, ...args)` — downward propagation through `$$children` tree, stopPropagation is no-op **[Agent: typescript-framework]**
  - [ ] Implement `$$fireEventOnScope` — iterate listeners, skip nulls, catch errors, compact array after iteration **[Agent: typescript-framework]**
  - [ ] Add tests for: registration, multiple listeners, deregistration, deregistration during fire, `$emit` upward propagation, `$broadcast` downward propagation, event object shape (name, targetScope, currentScope, defaultPrevented), stopPropagation on emit only, additional args passing **[Agent: vitest-testing]**
  - [ ] **Verify:** `pnpm lint` + `pnpm typecheck` + `pnpm test` all pass **[Agent: typescript-framework]**

---

## Slice 8: End-to-end validation and build

_After this slice: full integration verified, build output includes all Scope exports with types._

- [ ] **Slice 8: End-to-end validation**
  - [ ] Run full command sequence: `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm build` — all pass **[Agent: general-purpose]**
  - [ ] Verify `dist/types/` contains Scope type declarations **[Agent: general-purpose]**
  - [ ] Verify test coverage meets 90% threshold on `src/core/` files **[Agent: vitest-testing]**
