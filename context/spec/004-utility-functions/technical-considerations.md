# Technical Specification: Utility Functions

- **Functional Specification:** `context/spec/004-utility-functions/functional-spec.md`
- **Status:** Draft
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Expand the existing `src/core/utils.ts` file with all utility functions from the legacy codebase. All functions are standalone named exports (not a class), accepting `unknown` parameters with TypeScript type guard return types where applicable. The utilities are re-exported through `src/index.ts` as part of the public API. Tests extend the existing `src/core/__tests__/utils.test.ts` file. `isScope` is excluded from utils to avoid circular dependencies — it remains in the Scope module.

---

## 2. Proposed Solution & Implementation Plan

### Component Breakdown

All utilities live in a single file: **`src/core/utils.ts`**

**Type Guards** (~16 functions):

- `isNumber`, `isString`, `isBoolean`, `isFunction`, `isArray`, `isObject`, `isNull`, `isUndefined`, `isDefined`, `isDate`, `isRegExp`, `isWindow`, `isNaN`, `isBlankObject`, `isTypedArray`, `isArrayBuffer`, `isArrayLike`
- All accept `unknown`, return `value is T` type guard predicates
- Use `typeof` checks for primitives, `instanceof` for built-in objects, `Object.prototype.toString.call()` for edge cases (typed arrays)

**Equality** (modify existing):

- `isEqual(a, b)` — update to match legacy behavior: skip `$`-prefixed keys and function-valued properties during object comparison

**Deep Clone**:

- `copy(source, destination?)` — recursive deep clone
- Handles: primitives (return as-is), Date (`new Date(source.getTime())`), RegExp (`new RegExp(source)`), typed arrays (via constructor + buffer slice), ArrayBuffer (`.slice()`), plain objects and arrays (recursive)
- Circular reference detection via a `Set` — throws error when detected
- Optional `destination` parameter: copy properties into existing target

**Iteration**:

- `forEach(collection, iteratee)` — overloaded signatures for array and object variants
- Array: `iteratee(value, index, array)`, Object: `iteratee(value, key, object)`
- Early exit when iteratee returns `false` (strict `=== false` check)

**Object Utilities**:

- `createMap()` — returns `Object.create(null)` typed as `Record<string, T>`
- `noop()` — empty function, typed as `() => void`

**Math Utilities**:

- `range(start, end?, step?)` — overloaded signatures for 1/2/3 argument forms

### Public API Exposure

- **File:** `src/core/index.ts` — add re-exports from `./utils`
- **File:** `src/index.ts` — ensure core barrel is re-exported
- Consumers: `import { isString, copy, forEach } from 'my-own-angularjs'`

### Key Implementation Details

| Function | Input Type | Return Type | Strategy |
|---|---|---|---|
| `isString` | `unknown` | `value is string` | `typeof value === 'string'` |
| `isNumber` | `unknown` | `value is number` | `typeof value === 'number'` |
| `isFunction` | `unknown` | `value is Function` | `typeof value === 'function'` |
| `isObject` | `unknown` | `value is object` | `value !== null && typeof value === 'object'` |
| `isBlankObject` | `unknown` | `boolean` | `isObject(value) && !Object.getPrototypeOf(value)` |
| `isWindow` | `unknown` | `boolean` | `isObject(value) && (value as any).window === value` |
| `isTypedArray` | `unknown` | `boolean` | `TYPED_ARRAY_REGEXP.test(Object.prototype.toString.call(value))` |
| `isArrayLike` | `unknown` | `boolean` | `isArray(value) \|\| (isObject && has numeric length <= MAX_SAFE_INTEGER)` |
| `isEqual` | `unknown, unknown` | `boolean` | Recursive, skip `$`-prefixed keys and function values |
| `copy` | `T, T?` | `T` | Recursive clone, `Set` for cycle detection, throws on circular |
| `forEach` | `T[], (v,i,a)=>void\|false` | `void` | Overloaded for array/object, early exit on `false` |
| `range` | `number, number?, number?` | `number[]` | Overloaded 1/2/3 args |

---

## 3. Impact and Risk Analysis

### System Dependencies

- **Scope module (`src/core/scope.ts`):** Already imports `isEqual` from `@core/utils`. Changing `isEqual` to skip `$`-prefixed keys changes dirty-checking behavior — all existing Scope tests must be re-validated.
- **Parser module (`src/parser/`):** Imports `isKeyOf` from `@core/utils`. No impact expected.
- **Future modules (DI, Directives, HTTP):** Will depend on type guards, `copy`, and `forEach`. This spec establishes the foundation they build on.

### Potential Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `isEqual` behavior change breaks Scope dirty-checking | High — core functionality regression | Run full Scope test suite after change; add targeted tests for `$`-prefix skipping |
| `copy()` performance on large nested objects | Medium — could impact scope `$watchCollection` deep copies | Benchmark with nested objects; use iterative approach if recursion depth is a concern |
| Public API surface too large | Low — hard to remove exports later | Start with all exports as documented; mark internal-only helpers with `@internal` JSDoc if needed |

---

## 4. Testing Strategy

- **Location:** `src/core/__tests__/utils.test.ts` (extend existing file)
- **Framework:** Vitest with `describe`/`it`/`expect`
- **Approach:** One `describe` block per function category (type guards, equality, clone, iteration, math)
- **Coverage targets:**
  - Every type guard tested against all JS value types (string, number, boolean, null, undefined, object, array, Date, RegExp, function, Symbol, typed arrays, ArrayBuffer, NaN, Infinity)
  - `isEqual`: primitives, NaN, arrays, nested objects, Date, RegExp, `$`-prefix skipping, function value skipping
  - `copy`: primitives, nested objects, arrays, Date, RegExp, typed arrays, circular reference (expect throw), destination parameter
  - `forEach`: arrays, objects, early exit, skip inherited properties
  - `range`: 1/2/3 argument forms, negative step, edge cases (empty range)
- **Reference:** Legacy tests in `legacy/` used as behavioral reference to ensure parity
