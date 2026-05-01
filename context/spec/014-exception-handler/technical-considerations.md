<!--
This document describes HOW to build the feature at an architectural level.
It is NOT a copy-paste implementation guide.
-->

# Technical Specification: `$exceptionHandler` — Centralized Exception Routing

- **Functional Specification:** [`context/spec/014-exception-handler/functional-spec.md`](./functional-spec.md)
- **Status:** Completed
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Introduce a new `src/exception-handler/` module that ships a thin, typed exception-routing primitive consumed by the digest loop and by `$interpolate`. Per architecture.md § 1's "one domain → one module subpath" rule, this lands as a dedicated subpath (`./exception-handler`, alias `@exception-handler/*`), mirroring the spec 011/012/013 layout.

The implementation has three concentric layers:

1. **ESM primary layer (stateless, pure):** A typed function alias `ExceptionHandler = (exception: unknown, cause?: string) => void`, two ready-made implementations (`consoleErrorExceptionHandler`, `noopExceptionHandler`), a default-instance export (`exceptionHandler`), and a public recursion-guarded helper `invokeExceptionHandler(handler, exception, cause?)`. No factory — there is nothing to configure beyond which function to plug in.
2. **DI compat layer (one-line registration):** `ngModule.factory('$exceptionHandler', () => consoleErrorExceptionHandler)`. Apps override via `$provide.factory('$exceptionHandler', factory)` in a `config()` block — the AngularJS 1.x idiom. No provider class, no decorator-style chaining; full replacement only. This matches AngularJS upstream where `$exceptionHandler` is also a plain factory.
3. **Integration layer (call-site rewrites):** Six `console.error` sites in `src/core/scope.ts` and the TTL `throw` site become `invokeExceptionHandler(this.$root.$$exceptionHandler, e, '<cause>')`. The `$interpolate` render fn gains a try/catch around each `parsedFn(context)` call that routes through the configured handler. The recursion-guard helper hides the "if the handler itself throws, fall back to console.error" branch from every call site.

`Scope.create()` gains an optional `exceptionHandler` field on the existing `ScopeOptions` bag. Default is `consoleErrorExceptionHandler` — observable behavior is preserved exactly. The handler is captured into the root scope as `$$exceptionHandler`, and digest call sites read `this.$root.$$exceptionHandler` (mirroring how `$$ttl` is stored on root and read via `this.$root.$$ttl`). Child scopes do NOT each store their own copy — there is one canonical handler per scope tree.

`createInterpolate({ exceptionHandler? })` accepts the same option (default = `consoleErrorExceptionHandler`). The DI shim `$InterpolateProvider.$get` gains `'$exceptionHandler'` as a dep and forwards it. ESM consumers calling `createInterpolate()` directly get the default, identical to today.

The cause-descriptor vocabulary is locked at eight tokens (`watchFn`, `watchListener`, `$evalAsync`, `$applyAsync`, `$$postDigest`, `eventListener`, `$digest`, `$interpolate`) exported as a frozen const and a TypeScript union. Apps that switch on `cause` to route different errors to different sinks have a stable contract.

No new dependencies, no new build tooling, no new test frameworks. The bundle adds a few hundred bytes — a single typed function alias and four small implementations.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1. New Module Layout — `src/exception-handler/`

| Path | Responsibility |
| --- | --- |
| `src/exception-handler/index.ts` | Public barrel: `ExceptionHandler` (type), `ExceptionHandlerCause` (type), `EXCEPTION_HANDLER_CAUSES` (frozen const), `consoleErrorExceptionHandler`, `noopExceptionHandler`, `exceptionHandler` (default), `invokeExceptionHandler`. |
| `src/exception-handler/exception-handler-types.ts` | `ExceptionHandler` callable type, `ExceptionHandlerCause` string-literal union, `EXCEPTION_HANDLER_CAUSES` frozen tuple constant. |
| `src/exception-handler/exception-handler.ts` | `consoleErrorExceptionHandler`, `noopExceptionHandler`, `exceptionHandler` (= `consoleErrorExceptionHandler`), `invokeExceptionHandler` (recursion-guarded dispatcher). All as exported `const` values; no classes. |
| `src/exception-handler/__tests__/exception-handler.test.ts` | Pure-ESM unit tests — default handler logs to `console.error`, noop handler is silent, `invokeExceptionHandler` forwards normal calls and falls back to `console.error` on handler-throws. |
| `src/exception-handler/__tests__/cause-vocabulary.test.ts` | `EXCEPTION_HANDLER_CAUSES` is frozen, contains the eight tokens, and matches the `ExceptionHandlerCause` union (compile-time + runtime check). |

A new path alias `@exception-handler/*` is added to `tsconfig.json`, `vitest.config.ts`, and `rollup.config.mjs` (`tsPathAliases` + a new `exception-handler/index` build entry). `package.json` exports map gains a `./exception-handler` entry — same shape as `./sce`, `./interpolate`, `./sanitize`.

### 2.2. ESM Surface — Types and Values

| Export | Signature / Value | Purpose |
| --- | --- | --- |
| `ExceptionHandler` | `(exception: unknown, cause?: string) => void` | Public callable type. Matches AngularJS 1.x signature. |
| `ExceptionHandlerCause` | `'watchFn' \| 'watchListener' \| '$evalAsync' \| '$applyAsync' \| '$$postDigest' \| 'eventListener' \| '$digest' \| '$interpolate'` | String-literal union of all framework-internal cause tokens. |
| `EXCEPTION_HANDLER_CAUSES` | `readonly ExceptionHandlerCause[]` (frozen) | Runtime value matching the union. Apps can iterate / build switch tables type-safely. |
| `consoleErrorExceptionHandler` | `ExceptionHandler` | Default. Calls `console.error('[$exceptionHandler]', exception, cause)` when `cause` is provided; calls `console.error('[$exceptionHandler]', exception)` when omitted. |
| `noopExceptionHandler` | `ExceptionHandler` | A `() => {}` constant. For tests that want to silence log output or assert no error was reported. |
| `exceptionHandler` | `ExceptionHandler` | Default-instance export, equal to `consoleErrorExceptionHandler`. Symmetric with `sce` / `sanitize` / `interpolate`. |
| `invokeExceptionHandler` | `(handler: ExceptionHandler, exception: unknown, cause?: string) => void` | Recursion-guarded dispatcher. Used by the framework at every internal call site. Public so third-party services (e.g., a future custom `$http`) can use the same guard. |

All exports are re-exported from the root `src/index.ts` and from the `./exception-handler` subpath.

### 2.3. Recursion-Guard Helper — `invokeExceptionHandler`

The helper centralizes the "if the handler itself throws, fall back to `console.error` and do NOT recurse" contract from FS § 2.6. Pseudocode:

```
function invokeExceptionHandler(handler, exception, cause) {
  try {
    handler(exception, cause);
  } catch (secondary) {
    console.error('[$exceptionHandler] handler threw while reporting:', secondary, 'original exception was:', exception);
    // Intentionally NOT re-invoking the handler — we'd risk infinite recursion.
  }
}
```

Notes:

- The helper returns `void` regardless of outcome. Callers that need to re-throw the original exception (e.g., the TTL site) keep their own reference and re-throw outside the helper call.
- The helper is the ONLY place in the codebase that catches handler exceptions. Every call site (six in scope, one in interpolate, one for TTL) goes through it.
- The secondary-exception log uses `console.error` directly (not `invokeExceptionHandler` recursively). This is the documented escape hatch when the configured handler is broken.

### 2.4. Default Implementation — `consoleErrorExceptionHandler`

Logging format: prefixed.

```
const consoleErrorExceptionHandler: ExceptionHandler = (exception, cause) => {
  if (cause === undefined) {
    console.error('[$exceptionHandler]', exception);
  } else {
    console.error('[$exceptionHandler]', exception, cause);
  }
};
```

The conditional avoids logging a literal `undefined` arg when `cause` is omitted. The prefix tells app developers the call came from the framework's exception routing, not a hand-rolled `console.error` somewhere in their own code.

`noopExceptionHandler` is a no-arg `() => {}` that satisfies the `ExceptionHandler` type — used in tests that assert no error was reported, and as the override in unit tests that want to silence log noise.

### 2.5. DI Registration on `ngModule`

**`src/core/ng-module.ts`** — additive change:

```typescript
import { consoleErrorExceptionHandler, type ExceptionHandler } from '@exception-handler/index';
// (existing imports preserved)

declare module '@di/di-types' {
  interface ModuleRegistry {
    ng: {
      registry: {
        $exceptionHandler: ExceptionHandler;  // new
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
  .factory('$exceptionHandler', () => consoleErrorExceptionHandler)  // new — first registration
  .provider('$sceDelegate', $SceDelegateProvider)
  .provider('$sce', $SceProvider)
  .provider('$interpolate', $InterpolateProvider);
```

The registry augmentation is colocated in `ng-module.ts` next to the registration line. The factory has zero DI dependencies — `$exceptionHandler` resolves before any other service that consumes it.

Apps override via the spec 008 recipes:

```typescript
// In a config() block
ngModule.config(['$provide', ($provide: $Provide) => {
  $provide.factory('$exceptionHandler', () => mySentryHandler);
}]);

// Or via module-level .factory before createInjector runs
appModule.factory('$exceptionHandler', () => mySentryHandler);

// Or via .decorator() to wrap rather than replace
appModule.decorator('$exceptionHandler', ['$delegate', ($delegate: ExceptionHandler) =>
  (e, c) => { mySpy(e, c); $delegate(e, c); }
]);
```

No `$exceptionHandlerProvider` is exposed. AngularJS 1.x doesn't have one either — the override path is `$provide.factory` (or its module-DSL alias).

### 2.6. Scope Integration — `src/core/scope.ts`

Two coordinated changes inside the existing class:

**A. Store the handler on root.** Mirror the existing `$$ttl` pattern.

`scope-types.ts` — extend `ScopeOptions`:

```typescript
export interface ScopeOptions {
  ttl?: number;
  exceptionHandler?: ExceptionHandler;  // new
}
```

`scope.ts` — extend the class field set and `Scope.create`:

```typescript
export class Scope {
  $$ttl: number;
  $$exceptionHandler: ExceptionHandler;  // new — only meaningful on the root scope

  constructor() {
    this.$$ttl = TTL;
    this.$$exceptionHandler = consoleErrorExceptionHandler;  // new
    // …existing init unchanged
  }

  static create<T extends …>(options?: ScopeOptions): TypedScope<T> & T {
    if (options?.ttl !== undefined && options.ttl < 2) throw new Error(/* existing */);
    const scope = new Scope();
    scope.$$ttl = options?.ttl ?? TTL;
    scope.$$exceptionHandler = options?.exceptionHandler ?? consoleErrorExceptionHandler;  // new
    return scope as TypedScope<T> & T;
  }
}
```

Children created via `$new` do NOT copy the handler. They reach `this.$root.$$exceptionHandler` at call sites, exactly as they reach `this.$root.$$ttl`.

**B. Replace each `console.error` with the routed call.** Six sites:

| Current line | Becomes |
| --- | --- |
| `src/core/scope.ts:275` — `console.error('Error in watch listener:', e);` | `invokeExceptionHandler(this.$root.$$exceptionHandler, e, 'watchListener');` |
| `src/core/scope.ts:285` — `console.error('Error in watch function:', e);` | `invokeExceptionHandler(this.$root.$$exceptionHandler, e, 'watchFn');` |
| `src/core/scope.ts:317` — `console.error('Error in $evalAsync expression:', e);` | `invokeExceptionHandler(this.$root.$$exceptionHandler, e, '$evalAsync');` |
| `src/core/scope.ts:349` — `console.error('Error in $$postDigest function:', e);` | `invokeExceptionHandler(this.$root.$$exceptionHandler, e, '$$postDigest');` |
| `src/core/scope.ts:775` — `console.error('Error in event listener:', e);` | `invokeExceptionHandler(this.$root.$$exceptionHandler, e, 'eventListener');` |
| `src/core/scope.ts:793` — `console.error('Error in $applyAsync expression:', e);` | `invokeExceptionHandler(this.$root.$$exceptionHandler, e, '$applyAsync');` |

The "log and continue" semantics are preserved exactly — `invokeExceptionHandler` returns `void`, the surrounding loop continues unchanged.

`$$fireEventOnScope` is non-static (instance method on `Scope`); it has access to `this` and reaches the root via `this.$root`. The other sites are likewise instance methods.

### 2.7. Digest TTL Routing — `src/core/scope.ts:330`

Current behavior: TTL exhaustion constructs an `Error` and `throw`s it. New behavior: the handler is invoked first (recursion-guarded), then the same `Error` is re-thrown.

```typescript
if ((dirty || this.$$asyncQueue.length > 0) && --ttl <= 0) {
  this.$clearPhase();
  const lastDirtyWatch = this.$root.$$lastDirtyWatch as Watcher<unknown> | null;
  const lastDirtyInfo = lastDirtyWatch !== null ? `\nLast dirty watcher: ${lastDirtyWatch.watchFn.toString()}` : '';
  const ttlValue = String(this.$root.$$ttl);
  const ttlError = new Error(`${ttlValue} digest iterations reached. Aborting!${lastDirtyInfo}`);
  invokeExceptionHandler(this.$root.$$exceptionHandler, ttlError, '$digest');  // new
  throw ttlError;
}
```

If the configured handler throws inside this path, `invokeExceptionHandler` catches and logs the secondary; the original `ttlError` is then re-thrown from the next line. Handler failure does NOT mask the TTL signal — the throw still propagates to `$apply` and to the caller.

### 2.8. `$interpolate` Integration — `src/interpolate/`

Two coordinated changes, both small.

**`src/interpolate/interpolate-types.ts`** — extend `InterpolateOptions`:

```typescript
export interface InterpolateOptions {
  startSymbol?: string;
  endSymbol?: string;
  sceGetTrusted?: SceGetTrustedFn;
  sceIsEnabled?: () => boolean;
  exceptionHandler?: ExceptionHandler;  // new
}
```

**`src/interpolate/interpolate.ts`** — wrap each `parsedFn(context)` call inside the render fn in try/catch:

```typescript
const handler = options.exceptionHandler ?? consoleErrorExceptionHandler;

const render = (context: Record<string, unknown>): string | undefined => {
  let out = textSegments[0] ?? '';
  for (let i = 0; i < parsedFns.length; i++) {
    const fn = parsedFns[i];
    const segment = textSegments[i + 1] ?? '';
    let value: unknown;
    try {
      value = fn === undefined ? undefined : fn(context);
    } catch (err) {
      invokeExceptionHandler(handler, err, '$interpolate');
      value = undefined;  // failed expression renders as '' via toInterpolationString(undefined)
    }
    const trusted = strictTrustActive ? sceGetTrusted(trustedContext, value) : value;
    if ((allOrNothing === true || oneTime) && trusted === undefined) {
      return undefined;  // a throw is treated equivalently to undefined for short-circuit semantics
    }
    out += toInterpolationString(trusted) + segment;
  }
  return out;
};
```

Notes:

- The catch is INSIDE the per-expression loop, so a throw on expression N does NOT poison expressions 0..N−1 (already accumulated into `out`) or N+1..end (still rendered with their own errors caught independently if they fail too).
- Setting `value = undefined` after the catch funnels the failed slot into the existing `toInterpolationString(undefined)` branch which returns `''`. No new branch in the value-stringification path.
- `allOrNothing === true` AND `oneTime === true` short-circuits to `undefined` when ANY expression resolves (or throws-and-falls-back) to `undefined`. This is a deliberate design choice from FS § 2.12 — a throw is semantically equivalent to "no value" for the purpose of short-circuit gating.
- Compile-time errors from `parse()` continue to throw synchronously at the `$interpolate(text)` call site, BEFORE the render fn is constructed. They are NOT routed through `$exceptionHandler` (programming errors, not runtime evaluation errors).
- Strict-trust compile-time errors from spec 012 (single-binding rule) likewise continue to throw synchronously.

**`src/interpolate/interpolate-provider.ts`** — extend `$get` deps:

```typescript
$get = [
  '$sce',
  '$exceptionHandler',  // new dep
  ($sce: SceService, $exceptionHandler: ExceptionHandler): InterpolateService =>
    createInterpolate({
      startSymbol: this.$$startSymbol,
      endSymbol: this.$$endSymbol,
      sceGetTrusted: $sce.getTrusted.bind($sce),
      sceIsEnabled: () => $sce.isEnabled(),
      exceptionHandler: $exceptionHandler,
    }),
] as const;
```

`$exceptionHandler` resolves before `$interpolate` because it has no DI deps and is registered as a plain factory; the DI graph orders it ahead of `$interpolate`. ESM consumers calling `createInterpolate()` without the option get the default `consoleErrorExceptionHandler` — identical behavior to today on success paths, plus newly silent error swallowing on failure paths (apps that want to observe interpolation errors must pass the option).

### 2.9. Cause Descriptor Vocabulary

| Token | Site | Notes |
| --- | --- | --- |
| `'watchFn'` | `src/core/scope.ts:283-286` | Throw inside the watch function (the function that produces the value to watch). |
| `'watchListener'` | `src/core/scope.ts:273-276` | Throw inside the watch listener (the callback fired when the value changes). |
| `'$evalAsync'` | `src/core/scope.ts:314-318` | Throw while draining the `$evalAsync` queue at the start of a digest pass. |
| `'$applyAsync'` | `src/core/scope.ts:790-794` | Throw while draining the `$applyAsync` queue (deferred-apply task). |
| `'$$postDigest'` | `src/core/scope.ts:346-350` | Throw inside a `$$postDigest` callback after the digest cycle completes. |
| `'eventListener'` | `src/core/scope.ts:772-776` | Throw inside a `$on` listener during `$emit` / `$broadcast`. |
| `'$digest'` | `src/core/scope.ts:330` (TTL site) | TTL exhaustion `Error` reported via the handler before being re-thrown. |
| `'$interpolate'` | `src/interpolate/interpolate.ts` (render fn) | Throw during per-expression evaluation inside an interpolation render. |

`EXCEPTION_HANDLER_CAUSES` is the frozen tuple of the eight strings, in this exact order. The TypeScript union `ExceptionHandlerCause` is its `(typeof EXCEPTION_HANDLER_CAUSES)[number]`. Future specs that add framework-internal call sites extend this list as part of their public-API change.

### 2.10. Public Exports

**`src/exception-handler/index.ts`:**

```typescript
export { invokeExceptionHandler, consoleErrorExceptionHandler, noopExceptionHandler, exceptionHandler } from './exception-handler';
export { EXCEPTION_HANDLER_CAUSES } from './exception-handler-types';
export type { ExceptionHandler, ExceptionHandlerCause } from './exception-handler-types';
```

**`src/index.ts`:** add to existing exports:

```typescript
export {
  invokeExceptionHandler,
  consoleErrorExceptionHandler,
  noopExceptionHandler,
  exceptionHandler,
  EXCEPTION_HANDLER_CAUSES,
} from './exception-handler/index';
export type { ExceptionHandler, ExceptionHandlerCause } from './exception-handler/index';
```

All seven exports are public API.

### 2.11. Build & Packaging Updates

| File | Change |
| --- | --- |
| `tsconfig.json` | Add `@exception-handler/*` → `src/exception-handler/*` to `paths`. |
| `vitest.config.ts` | Add `@exception-handler` to the `tsPathAliases` block. |
| `rollup.config.mjs` | Add `@exception-handler` to `tsPathAliases`; add a new build entry `exception-handler/index` (mirrors the `sce/index` and `sanitize/index` entries — emits `.mjs`, `.cjs`, `.d.ts`). |
| `package.json` | Add `"./exception-handler"` to the `exports` map with the standard `import` / `require` / `types` triplet. |

No version bump policy change. No new runtime dependencies.

### 2.12. `CLAUDE.md` Updates

- **Modules table** gains an `./exception-handler` row: "Centralized exception routing — replaces the inline `console.error` swallowing in scope and routes `$interpolate` render-time errors. Default handler logs to `console.error` (observable behavior unchanged); apps override via `$provide.factory('$exceptionHandler', …)`. Public exports: `ExceptionHandler`, `consoleErrorExceptionHandler`, `noopExceptionHandler`, `exceptionHandler`, `invokeExceptionHandler`, `EXCEPTION_HANDLER_CAUSES`, `ExceptionHandlerCause`."
- **Non-obvious invariants** gains: "**The digest's 'log and continue' contract is preserved through `$exceptionHandler`.** A failing watcher / listener / async task is reported via the configured handler and the digest proceeds; only TTL exhaustion re-throws (after first reporting via the handler). The default handler is `console.error`, so today's logs continue to appear unchanged. A custom handler that itself throws is caught by `invokeExceptionHandler` and degrades to `console.error` — the digest still does not crash."
- **Where to look when…** gains: "How are runtime errors routed?" → `src/exception-handler/exception-handler.ts` (default handler + recursion guard); `src/core/scope.ts` (six call sites + TTL); `src/interpolate/interpolate.ts` (render-time catch).
- A short `src/exception-handler/README.md` documents the override pattern, the eight cause descriptors, and the recursion-guard contract — same shape as `src/sanitize/README.md`.

---

## 3. Impact and Risk Analysis

### System Dependencies

- **`src/core/ng-module.ts`** — additive: new `.factory('$exceptionHandler', …)` registration prepended to the module chain; new line in the `declare module '@di/di-types'` block. Order matters only insofar as `$exceptionHandler` must be registered before any service that depends on it; since registration order on `ngModule` does not gate DI resolution (the dep graph does), this is purely cosmetic. New import of `consoleErrorExceptionHandler` and `ExceptionHandler` from `@exception-handler/index`.
- **`src/core/scope.ts`** — six surgical edits (each replacing one `console.error` line with one `invokeExceptionHandler` line) plus the TTL site (one extra line before the throw) plus two field initializations (`$$exceptionHandler`) plus one option read in `Scope.create`. New import of `invokeExceptionHandler` and `consoleErrorExceptionHandler` from `@exception-handler/index`. The file's line count grows by ~10 — does not push it past any threshold, but the file is already a refactor candidate per `CLAUDE.md` (827 lines); this spec does NOT refactor.
- **`src/core/scope-types.ts`** — additive: one optional field on `ScopeOptions`. New import of `ExceptionHandler` type.
- **`src/interpolate/interpolate-types.ts`** — additive: one optional field on `InterpolateOptions`. New import of `ExceptionHandler` type.
- **`src/interpolate/interpolate.ts`** — one try/catch around `parsedFn(context)` plus one call to `invokeExceptionHandler`. Render-fn body grows by ~5 lines.
- **`src/interpolate/interpolate-provider.ts`** — adds `'$exceptionHandler'` to the `$get` dep array and forwards the resolved value into the `createInterpolate({ exceptionHandler })` call. Two-line change.
- **`src/sce/`, `src/sanitize/`, `src/parser/`, `src/di/`** — UNCHANGED. None of them currently swallow exceptions; their existing error-handling contracts (synchronous throws on parse-time / config-time errors) are preserved exactly.
- **Existing tests** (specs 003, 007, 008, 009, 010, 011, 012, 013) — must pass unchanged. The default observable output (`console.error` writes for swallowed digest errors) is preserved exactly because the default handler IS `console.error`. Tests that asserted on `console.error` calls before this spec continue to pass; tests that newly assert on the routed handler use the spy override path.

### Potential Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The default observable output changes (e.g., the `[$exceptionHandler]` prefix breaks a test that was matching exact `console.error` arguments). | Pre-flight check: grep the existing test suite for any `expect(console.error).toHaveBeenCalledWith('Error in …', …)` assertions; if found, port them to the new prefix-aware assertion BEFORE the call-site rewrites land. The default-handler test in `__tests__/exception-handler.test.ts` locks the format. |
| A custom handler registered in a `config()` block runs DURING the config phase (when no scope yet exists) and is dropped — the scope reads `$$exceptionHandler` from its constructor-time default. | Document in `CLAUDE.md`: the `Scope.create({ exceptionHandler })` option captures at construction; the DI override path applies once the injector / scope are wired together (which happens via `$rootScope` registration in the bootstrap spec, not this spec). For this spec, ESM users explicitly pass the option; DI users — until `$rootScope` lands — cannot get a scope through DI at all, so the question is moot. The interpolate integration DOES go through DI today and observes the override correctly. |
| A `$rootScope` factory landing in the bootstrap spec forgets to forward `$exceptionHandler` into `Scope.create`. | Document the contract in `CLAUDE.md` "Non-obvious invariants" so the bootstrap spec author (and reviewers) see it. The bootstrap spec's tests will catch the regression — they MUST assert that an injector-resolved `$rootScope` whose `$exceptionHandler` is overridden routes digest errors to the override. |
| Recursion: a custom `$exceptionHandler` calls a function that throws, that function's catch-block calls `$exceptionHandler` again, and a chain forms. | `invokeExceptionHandler` catches secondary throws but does NOT re-call the handler — only `console.error`. So one level of recursion is bounded. Apps that explicitly design their handler to recurse on its own throws are doing it on purpose. Documented in TSDoc + `src/exception-handler/README.md`. |
| The `$interpolate` render-fn try/catch shifts from "throw bubbles to caller" (today) to "swallow + log". Apps that today catch interpolation throws upstream see those throws disappear. | This is the intended behavior change — FS § 2.12 makes it explicit, and the spec 011 §2.10 deferral note already foreshadowed it. The mitigation is clear documentation in `CLAUDE.md` (Non-obvious invariants gain a sentence), TSDoc on `createInterpolate`, and a regression test that asserts a thrown expression no longer propagates to the `$interpolate(text)(context)` caller. |
| Cause descriptor list grows ad-hoc as future specs add call sites — without governance, the union becomes meaningless. | The `EXCEPTION_HANDLER_CAUSES` const is the single source of truth. Future specs MUST extend the const and the union together. The `cause-vocabulary.test.ts` test asserts the const has exactly N entries (locked at 8 today); adding a new token bumps the assertion AND requires the new test that exercises the new call site. Combined: a new cause descriptor cannot be silently added. |
| Importing `consoleErrorExceptionHandler` into `src/core/ng-module.ts` and `src/core/scope.ts` creates a `core ↔ exception-handler` dependency. | Acceptable: `@exception-handler/*` has zero internal dependencies (no `core`, `parser`, `di`, `interpolate`, `sce`, `sanitize` imports). The arrow is one-way (core → exception-handler). No cycle is introduced. The `noUncheckedIndexedAccess` and other strict TS settings continue to apply. |
| The new module's bundle adds duplicate code if rollup tree-shaking misses it. | The exports are all const values or types — nothing is class-based, nothing has side effects on import. Tree-shaking is exact. The new build entry follows the same pattern as `./sce` / `./interpolate` / `./sanitize`, which already bundle cleanly today. |
| `noopExceptionHandler` is misused in production code (silencing real errors). | `noopExceptionHandler` is named explicitly and documented as "for tests / silencing log output". TSDoc warns against production use. Code review is the human backstop; an ESLint custom rule could be added later if the misuse pattern emerges. |
| The TTL throw site invokes the handler before the throw, which means a custom handler that does expensive work (e.g., network call to Sentry) blocks the throw. | This is by design — the handler is synchronous, callers expect synchronous reporting. Apps that need async reporting wrap the work in `setTimeout` / `queueMicrotask` inside their handler. Documented in TSDoc. |

---

## 4. Testing Strategy

All tests use Vitest (project standard). Target 90%+ line coverage on `src/exception-handler/` (architecture § 2). Existing 90% thresholds for `src/core/` and `src/interpolate/` are preserved.

### 4.1. ESM Unit Tests — `src/exception-handler/__tests__/exception-handler.test.ts`

- `consoleErrorExceptionHandler(err)` calls `console.error` exactly once, with `'[$exceptionHandler]'` and the error.
- `consoleErrorExceptionHandler(err, 'watchFn')` calls `console.error` exactly once, with `'[$exceptionHandler]'`, the error, and `'watchFn'` — no trailing `undefined`.
- `consoleErrorExceptionHandler('a string')` does not throw — total over input domain.
- `consoleErrorExceptionHandler(null)` does not throw.
- `noopExceptionHandler(new Error('x'), 'cause')` returns `undefined` and produces no `console.error` calls.
- `exceptionHandler === consoleErrorExceptionHandler` (default-instance identity).
- `invokeExceptionHandler(noopExceptionHandler, err, 'cause')` calls the handler exactly once and returns `undefined`.
- `invokeExceptionHandler(throwingHandler, originalErr, 'cause')` — the throwing handler is invoked once, `console.error` is called once with the secondary-exception prefix and BOTH errors visible, and `invokeExceptionHandler` itself does NOT throw.
- `invokeExceptionHandler` does NOT recurse on handler throws — the throwing handler is invoked exactly once per call.

### 4.2. Cause Vocabulary — `src/exception-handler/__tests__/cause-vocabulary.test.ts`

- `EXCEPTION_HANDLER_CAUSES` is frozen — `Object.isFrozen(EXCEPTION_HANDLER_CAUSES) === true`.
- `EXCEPTION_HANDLER_CAUSES.length === 8`; entries match the eight tokens in declared order.
- TypeScript compile-time check: `(EXCEPTION_HANDLER_CAUSES[0] satisfies ExceptionHandlerCause)` for each index — ensures the union and the const cannot drift.
- Adding a ninth token breaks the assertion (lock-in test for future specs).

### 4.3. DI Registration — `src/exception-handler/__tests__/di.test.ts`

- `createInjector([ngModule])` exposes `$exceptionHandler`; `injector.has('$exceptionHandler') === true`.
- `injector.get('$exceptionHandler') === consoleErrorExceptionHandler` (default identity).
- `injector.get('$exceptionHandler')` returns the same singleton across calls.
- `config(['$provide', $p => $p.factory('$exceptionHandler', () => mySpy)])` — `injector.get('$exceptionHandler') === mySpy`.
- `appModule.factory('$exceptionHandler', () => mySpy)` — same effect when registered before `createInjector`.
- `appModule.decorator('$exceptionHandler', ['$delegate', $d => (e, c) => { mySpy(e, c); $d(e, c); }])` — wrapper is invoked AND the default still runs.
- `injector.get('$exceptionHandlerProvider')` throws "Unknown provider" — there is no provider class.

### 4.4. Scope Integration — `src/core/__tests__/scope-exception-handler.test.ts`

A new test file (matches the existing `src/core/__tests__/scope*.test.ts` family naming).

- `Scope.create()` — `scope.$$exceptionHandler === consoleErrorExceptionHandler`.
- `Scope.create({ exceptionHandler: spy })` — `scope.$$exceptionHandler === spy`.
- `Scope.create({ ttl: 5, exceptionHandler: spy })` — both options honored.
- A child scope (`scope.$new()`) reads its handler from `this.$root.$$exceptionHandler` — replacing the spy on the root scope is reflected in child watcher behavior.
- Watch-function throw: register a watcher whose `watchFn` throws on every tick; the spy is called once per dirty pass with `cause === 'watchFn'`; the digest still terminates via TTL; other clean watchers still run.
- Watch-listener throw: register a watcher whose listener throws; the spy is called once with `cause === 'watchListener'`; the dirty bookkeeping (`watcher.last`) is still updated.
- `$evalAsync` queue throw: enqueue five tasks; the third throws; the spy is called once with `cause === '$evalAsync'`; tasks 1, 2, 4, 5 evaluate; the digest terminates normally (no TTL).
- `$applyAsync` queue throw: same shape as `$evalAsync`, with `cause === '$applyAsync'`.
- `$$postDigest` queue throw: enqueue five `$$postDigest` fns; the third throws; the spy is called once with `cause === '$$postDigest'`; the others run.
- Event listener throw: register three `$on('foo', …)` listeners; the middle one throws; broadcast `foo`; the spy is called once with `cause === 'eventListener'`; the first and third listeners both fire.
- TTL exhaustion: `Scope.create({ ttl: 2, exceptionHandler: spy })`, register a watcher that always reports dirty, call `$apply(() => …)`. Assert (a) the spy is called once with `cause === '$digest'` and the `Error` instance carrying the AngularJS-style message, (b) `$apply` re-throws the same `Error` to the caller, (c) the message contains "iterations reached" and the last-dirty-watch info.
- Recursion guard from a scope site: register a `watchFn` that throws; configure `Scope.create({ exceptionHandler: throwingHandler })`; the digest does NOT crash; `console.error` is called with the secondary-exception prefix; the digest continues.
- Backwards compatibility: existing tests that use `Scope.create()` with no args continue to log to `console.error` as before — assert `console.error` is still called when an unhandled watch throws (the default handler IS `console.error`).

### 4.5. `$interpolate` Integration — `src/interpolate/__tests__/interpolate-exception-handler.test.ts`

- `createInterpolate()` — render fn catches expression throws and routes to the default handler.
- `createInterpolate({ exceptionHandler: spy })` — render fn calls the spy with `cause === '$interpolate'` on a thrown expression; failed slot renders as `''`; surrounding text renders normally.
- `createInterpolate({ exceptionHandler: spy })` for `'a {{x.y.z}} b'` where `x` is undefined — the render returns `'a  b'`; spy called once.
- Multiple expressions, only one throws: `'{{a}} and {{b.c}}'` where `b` is undefined; render returns `'A and '` (or whatever `a` stringifies to plus an empty slot); spy called once with `'$interpolate'`.
- `allOrNothing === true` AND any expression throws — render returns `undefined`; spy still called.
- `oneTime === true` AND any expression throws — render returns `undefined` for that pass; spy called; the watcher does NOT deregister on a throw (assert via `$watch($interpolate('::a'), …)` integration).
- DI integration: `createInjector([ngModule])` with `$exceptionHandler` overridden via `$provide.factory(…)` — `$interpolate('{{boom()}}')(scope)` (where `scope.boom = () => { throw new Error('x'); }`) routes through the overridden handler.
- Compile-time errors NOT routed: `$interpolate('a {{b +}}')` still throws synchronously at the call site; the handler is NOT called.
- Spec 012 strict-trust compile-time errors NOT routed: `$interpolate('hello {{x}} world', false, 'html')` (with surrounding text in a trusted context) still throws synchronously; the handler is NOT called.

### 4.6. Cross-Service Integration — `src/__tests__/exception-handler-integration.test.ts` (or under `src/exception-handler/__tests__/`)

End-to-end smoke tests that exercise the full DI graph:

- `createInjector([ngModule])` with a custom `$exceptionHandler` registered via `$provide.factory` AND `$interpolate` resolved AND a scope created via `Scope.create({ exceptionHandler: injector.get('$exceptionHandler') })` — a thrown watcher AND a thrown interpolation expression both route to the same custom handler with the correct cause descriptors.
- Decorator pattern: `appModule.decorator('$exceptionHandler', ['$delegate', $d => (e, c) => { mySpy(e, c); $d(e, c); }])` — `mySpy` AND the original `console.error` both fire on a digest error.

### 4.7. Regression Tests

Entire existing suites (specs 002, 003, 006, 007, 008, 009, 010, 011, 012, 013) continue to pass unchanged. The default observable output (`console.error` writes for swallowed digest errors) is preserved because the default handler IS `console.error` — every existing test that asserted on `console.error` behavior continues to pass.

CI runs the full suite on every push.
