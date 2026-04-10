# Tasks: Utility Functions

- **Specification:** `context/spec/004-utility-functions/`
- **Status:** Not Started

---

- [ ] **Slice 1: Primitive Type Guards**
  - [ ] Implement `isString`, `isNumber`, `isBoolean`, `isFunction`, `isNull`, `isUndefined`, `isDefined` in `src/core/utils.ts` as TypeScript type guard functions accepting `unknown`. Use `typeof` checks. **[Agent: typescript-framework]**
  - [ ] Add comprehensive tests in `src/core/__tests__/utils.test.ts` — test each guard against all JS value types (string, number, boolean, null, undefined, object, array, function, Symbol, NaN, Infinity). Verify type narrowing works in test assertions. **[Agent: vitest-testing]**
  - [ ] Verify: `pnpm test` passes, `pnpm typecheck` passes, no lint errors. **[Agent: typescript-framework]**

- [ ] **Slice 2: Complex Type Detection Guards**
  - [ ] Implement `isArray`, `isObject`, `isDate`, `isRegExp`, `isNaN`, `isWindow`, `isBlankObject`, `isTypedArray`, `isArrayBuffer`, `isArrayLike` in `src/core/utils.ts`. Use `instanceof` for built-ins, `Object.prototype.toString.call()` for typed arrays, duck typing for `isWindow` and `isArrayLike`. **[Agent: typescript-framework]**
  - [ ] Add tests for all new guards. Key edge cases: `isObject(null)` → `false`, `isNumber(NaN)` → `true`, `isNaN(undefined)` → `false`, `isArrayLike('string')` → `true`, `isArrayLike({length: 0})` → `true`, `isBlankObject(Object.create(null))` → `true`. Test typed arrays (Uint8Array, Float32Array, etc.) and ArrayBuffer. **[Agent: vitest-testing]**
  - [ ] Verify: `pnpm test` passes, `pnpm typecheck` passes, no lint errors. **[Agent: typescript-framework]**

- [ ] **Slice 3: Update `isEqual` to Match Legacy Behavior**
  - [ ] Modify the existing `isEqual` function in `src/core/utils.ts` to skip `$`-prefixed keys and function-valued properties during recursive object comparison, matching the original AngularJS `angular.equals` behavior. **[Agent: typescript-framework]**
  - [ ] Add targeted tests for the new behavior: objects with `$`-prefixed keys are equal when only those keys differ, objects with function-valued properties are equal when only those properties differ. Ensure existing `isEqual` tests still pass (primitives, NaN, arrays, nested objects, Date, RegExp). **[Agent: vitest-testing]**
  - [ ] Run full Scope test suite (`src/core/__tests__/scope.test.ts`) to verify dirty-checking is not broken by the behavior change. **[Agent: vitest-testing]**
  - [ ] Verify: `pnpm test` passes (all tests, not just utils). **[Agent: typescript-framework]**

- [ ] **Slice 4: Iteration — `forEach`**
  - [ ] Implement `forEach` in `src/core/utils.ts` with overloaded TypeScript signatures for array and object iteration. Array variant: `iteratee(value, index, array)`. Object variant: `iteratee(value, key, object)`. Early exit when iteratee returns `false` (strict `=== false` check). Iterate own enumerable properties only. **[Agent: typescript-framework]**
  - [ ] Add tests: iterate arrays (check value, index, collection args), iterate objects (check value, key, collection args), early exit on `return false`, verify inherited properties are skipped, verify `null`/`undefined` collection is handled gracefully. **[Agent: vitest-testing]**
  - [ ] Verify: `pnpm test` passes, `pnpm typecheck` passes. **[Agent: typescript-framework]**

- [ ] **Slice 5: Deep Clone — `copy`**
  - [ ] Implement `copy(source, destination?)` in `src/core/utils.ts`. Handle: primitives (return as-is), Date (`new Date(getTime())`), RegExp (`new RegExp(source)`), typed arrays (constructor + buffer slice), ArrayBuffer (`.slice()`), plain objects and arrays (recursive). Use a `Set` for circular reference detection — throw an error when detected. Support optional `destination` parameter to copy into an existing target. **[Agent: typescript-framework]**
  - [ ] Add tests: clone primitives, clone nested objects (verify independence — mutate clone, original unchanged), clone arrays, clone Date/RegExp/typed arrays/ArrayBuffer (verify correct type and value), circular reference detection (expect throw), `destination` parameter (copy into existing object/array), edge cases (empty objects, empty arrays, `null`). **[Agent: vitest-testing]**
  - [ ] Verify: `pnpm test` passes, `pnpm typecheck` passes. **[Agent: typescript-framework]**

- [ ] **Slice 6: Object & Math Utilities**
  - [ ] Implement `noop`, `createMap`, and `range` in `src/core/utils.ts`. `noop`: empty function typed `() => void`. `createMap<T>`: returns `Object.create(null)` typed as `Record<string, T>`. `range`: overloaded signatures for 1/2/3 argument forms (lodash-style). **[Agent: typescript-framework]**
  - [ ] Add tests: `noop()` returns `undefined`, `createMap()` has null prototype, `range(4)` → `[0,1,2,3]`, `range(1,5)` → `[1,2,3,4]`, `range(0,10,2)` → `[0,2,4,6,8]`, `range(5,0,-1)` → `[5,4,3,2,1]`, `range(0)` → `[]`. **[Agent: vitest-testing]**
  - [ ] Verify: `pnpm test` passes, `pnpm typecheck` passes. **[Agent: typescript-framework]**

- [ ] **Slice 7: Public API Exports**
  - [ ] Re-export all utility functions from `src/core/index.ts` (barrel export from `./utils`). Ensure `src/index.ts` re-exports the core barrel. **[Agent: typescript-framework]**
  - [ ] Verify the build output includes all exports: run `pnpm build`, check that the generated `.d.ts` declarations include all utility function signatures. **[Agent: rollup-build]**
  - [ ] Verify: `pnpm test` passes, `pnpm build` succeeds, `pnpm typecheck` passes. **[Agent: typescript-framework]**
