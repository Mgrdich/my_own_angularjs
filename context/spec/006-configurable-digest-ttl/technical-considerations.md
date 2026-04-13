# Technical Specification: Scopes — Configurable Digest TTL

- **Functional Specification:** `context/spec/006-configurable-digest-ttl/functional-spec.md`
- **Status:** Completed
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Modify the existing Scope module to support a configurable digest TTL. The TTL is stored on the root scope instance and shared across the hierarchy. The `Scope.create()` factory gains an optional options parameter. The `$digest()` method reads the TTL from the root scope instead of a module-level constant. The error message on TTL breach includes `watchFn.toString()` of the last dirty watcher.

No new files. No architectural changes. Changes are confined to `src/core/scope.ts` and its test file.

---

## 2. Proposed Solution & Implementation Plan

### Component Breakdown

**File: `src/core/scope.ts`**

1. **Add `ScopeOptions` interface:**
   - `{ ttl?: number }` — optional, defaults to 10
   - Validate `ttl >= 2` at creation time, throw if invalid

2. **Add `$$ttl` property to Scope class:**
   - Stored on every scope instance, set from root during `$new()`
   - Root scope sets it from `ScopeOptions.ttl ?? 10`

3. **Update `Scope.create()`:**
   - Accept optional `ScopeOptions` parameter: `Scope.create<T>(options?: ScopeOptions)`
   - Pass `ttl` to the constructor or set after creation

4. **Update `$digest()`:**
   - Replace `let ttl = TTL` with `let ttl = this.$root.$$ttl`
   - On TTL breach, build error message including:
     - The configured TTL value (interpolated, not hardcoded `'10'`)
     - `this.$root.$$lastDirtyWatch.watchFn.toString()` to identify the unstable watcher
   - Remove or keep the module-level `const TTL = 10` as a default constant

5. **Update `$new()`:**
   - Child scopes (both prototypal and isolated) inherit `$$ttl` from `this.$root.$$ttl`

### Key Implementation Details

| Change | Location | Detail |
|---|---|---|
| `ScopeOptions` type | `src/core/scope-types.ts` or inline in `scope.ts` | `{ ttl?: number }` |
| `$$ttl` property | Scope class | `number`, default `10`, set in constructor |
| `Scope.create()` | Factory method | Add optional `options?: ScopeOptions` param |
| `$digest()` TTL usage | Line ~219, ~241-242 | Use `this.$root.$$ttl`, interpolate in error |
| Error message | Line ~241-242 | Include TTL value and `watchFn.toString()` |
| TTL validation | `Scope.create()` | Throw if `ttl < 2` |

---

## 3. Impact and Risk Analysis

### System Dependencies

- **No external dependencies.** Changes are internal to the Scope module.
- **Backward compatible.** `Scope.create()` with no arguments behaves identically to before (TTL defaults to 10).
- **Test file:** Existing TTL tests may need adjustment since the error message format changes.

### Potential Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Changing the error message breaks existing test assertions | Low | Update test assertions to match new message format |
| `watchFn.toString()` output varies across environments | Low | Used only in error messages, not for logic. Acceptable variance. |
| `$$ttl` property name conflicts | Very low | `$$` prefix follows AngularJS convention for internal properties |

---

## 4. Testing Strategy

- **Location:** `src/core/__tests__/scope.test.ts`
- **Framework:** Vitest
- **New tests:**
  - `Scope.create()` with no args uses default TTL of 10
  - `Scope.create({ ttl: 20 })` allows 20 iterations before throwing
  - `Scope.create({ ttl: 5 })` throws after 5 iterations
  - `Scope.create({ ttl: 1 })` throws at creation time (minimum 2)
  - `Scope.create({ ttl: 0 })` throws at creation time
  - Child scopes inherit root's TTL
  - Isolated scopes inherit root's TTL
  - Error message includes the TTL value
  - Error message includes the watch function string
- **Existing tests:** Update any tests that assert on the exact error message `'10 digest iterations reached'`
