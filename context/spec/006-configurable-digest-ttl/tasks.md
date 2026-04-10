# Tasks: Scopes — Configurable Digest TTL

- **Specification:** `context/spec/006-configurable-digest-ttl/`
- **Status:** Not Started

---

- [ ] **Slice 1: Configurable TTL via Scope.create()**
  - [ ] Add `ScopeOptions` interface (`{ ttl?: number }`) and `$$ttl` property to the Scope class. Update `Scope.create()` to accept optional `ScopeOptions`. Validate `ttl >= 2` at creation time. Update `$digest()` to use `this.$root.$$ttl` instead of the hardcoded constant. Ensure child and isolated scopes inherit root's TTL. **[Agent: typescript-framework]**
  - [ ] Add tests: default TTL of 10, custom TTL (`{ ttl: 20 }`, `{ ttl: 5 }`), validation rejects `ttl < 2`, child scopes inherit TTL, isolated scopes inherit TTL. Update existing tests that assert on the hardcoded error message. **[Agent: vitest-testing]**
  - [ ] Verify: `pnpm test` passes, `pnpm typecheck` passes, `pnpm lint` passes. **[Agent: typescript-framework]**

- [ ] **Slice 2: Improved TTL Error Message**
  - [ ] Update the TTL breach error in `$digest()` to include the configured TTL value and `watchFn.toString()` of the last dirty watcher (`$$lastDirtyWatch`). **[Agent: typescript-framework]**
  - [ ] Add tests: error message includes the TTL value, error message includes the watch function source string. **[Agent: vitest-testing]**
  - [ ] Verify: `pnpm test` passes, `pnpm typecheck` passes, `pnpm lint` passes. **[Agent: typescript-framework]**
