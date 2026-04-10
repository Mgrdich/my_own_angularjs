# Functional Specification: Utility Functions

- **Roadmap Item:** Rewrite helper/utility functions in TypeScript (Phase 0 — Reimplement Existing Features)
- **Status:** Completed
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

The legacy codebase contains ~24+ utility functions across two files (`legacy/src/util/LibHelper.ts` and `legacy/src/util/functions.js`) that provide foundational helpers for type checking, deep equality, deep cloning, iteration, and object manipulation. Currently, only `isEqual()` has been reimplemented in `src/core/utils.ts`.

These utilities underpin virtually every other module in the framework — Scope uses `isEqual` for dirty checking, and upcoming modules (Dependency Injection, Directives, HTTP, Forms) will depend on type guards, deep cloning, and iteration helpers. Completing this rewrite is the final step before the "Validate & Remove Legacy" milestone can begin.

**Problem:** Without a complete set of typed utilities, subsequent modules cannot be built cleanly, and the legacy folder cannot be removed.

**Desired outcome:** A complete, fully-typed set of utility functions exported as public API, leveraging TypeScript type guards for type narrowing — a significant improvement over the original AngularJS utilities.

---

## 2. Functional Requirements (The "What")

All utility functions from the legacy codebase must be reimplemented in clean TypeScript with full type safety. They must be exported as named exports (modern TypeScript style) and serve as public API for framework consumers.

### 2.1 Type-Checking Functions (as Type Guards)

The following type-checking functions must be implemented as TypeScript type guards (returning `x is Type`) to enable type narrowing in conditionals:

- `isNumber(value): value is number`
- `isString(value): value is string`
- `isFunction(value): value is Function`
- `isArray(value): value is Array`
- `isObject(value): value is object`
- `isNull(value): value is null`
- `isUndefined(value): value is undefined`
- `isDefined(value)` — inverse of `isUndefined`
- `isDate(value): value is Date`
- `isRegExp(value): value is RegExp`
- `isWindow(value)` — detects the global `window` object
- `isNaN(value)` — detects `NaN` (not the same as global `isNaN`)
- `isBlankObject(value)` — detects objects created with `Object.create(null)`
- `isTypedArray(value)` — detects typed arrays (Uint8Array, Float32Array, etc.)
- `isArrayBuffer(value): value is ArrayBuffer`
- `isArrayLike(value)` — detects array-like objects (has numeric `length`)
- `isBoolean(value): value is boolean` [NEEDS CLARIFICATION: The legacy code doesn't include `isBoolean` — should we add it for completeness?]

**Acceptance Criteria:**

- [x] Each type-checking function returns the correct boolean for all JavaScript value types (primitives, objects, null, undefined, NaN, typed arrays, etc.)
- [x] Each function acts as a TypeScript type guard, narrowing the type in conditional branches
- [x] Edge cases are handled: `isNumber(NaN)` returns `true` (NaN is typeof number), `isObject(null)` returns `false`, `isArray([])` returns `true`

### 2.2 Equality

- `isEqual(a, b): boolean` — Deep recursive equality comparison
  - Already reimplemented in `src/core/utils.ts`; must be validated against full legacy test cases

**Acceptance Criteria:**

- [x] Correctly compares primitives, NaN (NaN === NaN should be `true`), arrays, nested objects, Date, and RegExp
- [x] Existing implementation passes all legacy equivalent tests

### 2.3 Deep Clone

- `copy(source, destination?)` — Deep clone with circular reference detection
  - Supports primitives, plain objects, arrays, Date, RegExp, typed arrays, ArrayBuffer
  - Detects and handles circular references (throws or handles gracefully)
  - Optional `destination` parameter to copy into an existing object/array

**Acceptance Criteria:**

- [x] Cloning a nested object produces a fully independent copy (mutations to clone do not affect original)
- [x] Circular references are detected and handled (not infinite recursion)
- [x] Date, RegExp, typed arrays, and ArrayBuffer are cloned correctly (not just by reference)
- [x] If `destination` is provided, properties are copied into it rather than creating a new object

### 2.4 Iteration

- `forEach(collection, iteratee)` — Iterates over arrays and objects with early exit support
  - For arrays: `iteratee(value, index, collection)`
  - For objects: `iteratee(value, key, collection)`
  - Early exit when iteratee returns `false`

**Acceptance Criteria:**

- [x] Iterates all elements of an array, passing value, index, and the array
- [x] Iterates all own enumerable properties of an object, passing value, key, and the object
- [x] Stops iteration when the iteratee explicitly returns `false`
- [x] Skips inherited properties (own properties only)

### 2.5 Object Utilities

- `createMap()` — Creates a bare object with no prototype (`Object.create(null)`)
- `noop()` — A no-operation function that does nothing

**Acceptance Criteria:**

- [x] `createMap()` returns an object where `Object.getPrototypeOf(result)` is `null`
- [x] `noop()` returns `undefined` and has no side effects

### 2.6 Math / Number Utilities

- `range(start, end, step?)` — Generates an array of numbers in a range
  - Follows lodash-style behavior: `range(4)` → `[0,1,2,3]`, `range(1,5)` → `[1,2,3,4]`, `range(0,10,2)` → `[0,2,4,6,8]`

**Acceptance Criteria:**

- [x] Single argument: `range(n)` produces `[0, 1, ..., n-1]`
- [x] Two arguments: `range(start, end)` produces values from start (inclusive) to end (exclusive)
- [x] Three arguments: `range(start, end, step)` steps by the given increment
- [x] Negative step for descending ranges: `range(5, 0, -1)` → `[5, 4, 3, 2, 1]`

---

## 3. Scope and Boundaries

### In-Scope

- Full reimplementation of all utility functions from `legacy/src/util/LibHelper.ts` and `legacy/src/util/functions.js`
- TypeScript type guards for all type-checking functions
- Deep clone with circular reference handling
- forEach with array/object support and early exit
- All utilities exported as named exports (public API)
- Comprehensive test suite for every utility function

### Out-of-Scope

- **Scopes & Digest Cycle (remaining)** — Phase tracking and TTL configuration are separate roadmap items (Phase 1)
- **Dependency Injection** — Module system, injector, providers are separate roadmap items (Phase 1)
- **Expressions & Parser enhancements** — One-time bindings, interpolation are separate roadmap items (Phase 2)
- **Filters** — Filter registration and built-in filters are separate (Phase 2)
- **Directives & DOM Compilation** — Compiler, linking, transclusion are separate (Phase 2)
- **Validate & Remove Legacy** — Will be addressed after this spec is complete
- **angular namespace object** — No `angular.isString()` style API; modern named exports only
