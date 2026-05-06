<!--
This document describes HOW to build the feature at an architectural level.
It is NOT a copy-paste implementation guide.
-->

# Technical Specification: `$provide` — Config-Phase Service Registration

- **Functional Specification:** [`context/spec/015-provide-service/functional-spec.md`](./functional-spec.md)
- **Status:** Completed
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Extend the DI core with a config-phase injectable `$provide` that exposes the same six registration recipes already on the module DSL. The key insight: the six recipes already have a single source of truth — `loadModule`'s switch on `recipe` (lines 327-360 of `src/di/injector.ts`) — that walks each module's `$$invokeQueue` and writes into the backing maps (`factoryInvokables`, `serviceCtors`, `providerInstances`, `providerGetInvokables`, `providerCache`, `decorators`). `$provide` reuses that exact path.

Implementation has three coordinated changes:

1. **Extract a shared recipe-handler helper.** Pull the per-record switch from `loadModule` into a small helper `applyRegistrationRecord(recipe, name, value, deps)` exported from a new `src/di/registration.ts` module. `loadModule` and `$provide`'s six methods both call it — single source of truth for recipe dispatch, no duplication. Internal type narrowing inside the switch matches the recipe to its expected value shape.

2. **New `src/di/provide.ts` module.** Exports `createProvideService(deps, getPhaseState)` which returns a `ProvideService`. The factory closes over the backing maps (passed in as a typed `RegistrationDeps` interface) and the phase-state probe (a thunk returning `'config' | 'run'`). Each of the six methods validates the phase first (throws if `'run'`), then delegates to `applyRegistrationRecord`.

3. **Phase-state flag inside `createInjector`.** A `let phase: 'config' | 'run' = 'config';` binding flips to `'run'` after the "Phase 2 — Config blocks" loop completes. `$provide` is registered into `providerCache` under `'$provide'` (alongside the existing self-registration of `'$injector'` at line 680) so that `providerInjector.get('$provide')` resolves it during config invocation. Post-Phase-2, `'$provide'` is deleted from `providerCache` so `injector.get('$provide')` throws the canonical "Unknown provider" error.

### Type-safety stance

Every typing surface is pushed to the strictest practical bound. No `any`. No `unknown` where a precise type fits. Inference is preferred — explicit annotations only on exported public-API boundaries where the declared shape is part of the contract (per `CLAUDE.md` "Coding conventions"). Specifically:

- The six `ProvideService` methods mirror the typed overloads of their `module.<recipe>` counterparts: `factory<Return>` infers `Return` from the trailing function of the supplied `Invokable<Return>`; `provider` overloads mirror `TypedModule.provider`'s constructor / object-literal / array-form variants with `InvokableReturn`-based service type extraction; `service` overloads infer constructor instance type; `decorator`'s array form infers the trailing-callback return type and dep parameter types.
- `RegistrationDeps` is a fully-typed interface (concrete `Map`/`Set` types, no escape hatches).
- `applyRegistrationRecord` discriminates on `recipe` inside its switch — each case gets a narrowed `value` parameter type matching the recipe's contract.
- The phase-probe thunk's return type is the literal union `'config' | 'run'`, NOT `string`.
- Local variables inside the implementation rely on inference (e.g., `const guard = (method: string) => { ... }` infers its own return type as `void`).

The ONE typing concession (called out explicitly in FS §2.10): `$provide.factory(...)` does NOT augment the `MergeRegistries<Mods>` registry that `createInjector` returns. This is a structural constraint, not a typing oversight — the injector's typed registry is computed at `createInjector` return, and config blocks run AFTER. Retroactive registry augmentation would require deferred-typing architecture this spec doesn't take on. The methods still type-check their inputs strictly; only the consumer-side `injector.get('newName')` resolution returns `unknown` (the typed registry doesn't know about `$provide`-registered names). A future spec can layer typed-DI integration if usage patterns demand it.

The constant-override guard (FS §2.5 decision: throw, stricter than AngularJS) lives inside `applyRegistrationRecord`: when registering `value` / `factory` / `service` / `provider` for a name already present in `constantNames`, throw synchronously with `Cannot override constant "<name>" — already registered via .constant(...)`. This guard runs uniformly whether the registration came from a module's `$$invokeQueue` or from a `$provide.*` call — no special-case branching.

Provider eager-instantiation for config-phase visibility: when `$provide.provider(name, source)` runs inside a config block, it MUST instantiate the provider immediately (so a subsequent config block in the same phase can inject `'<name>Provider'` and see the new instance). This is identical to the path `loadModule` already runs at registration time — the shared helper handles it for both call sites.

No new dependencies, no new build tooling, no new test framework.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1. New Module Layout

| Path | Responsibility |
| --- | --- |
| `src/di/provide.ts` | `createProvideService(deps, getPhase): ProvideService`. Builds the `$provide` object with the six methods. Closes over the backing maps and phase probe. No I/O, no module registry knowledge — it's a pure factory. |
| `src/di/registration.ts` | `applyRegistrationRecord(recipe, name, value, deps)`. The shared helper extracted from `loadModule`. Knows nothing about modules or `$$invokeQueue`; just handles ONE record at a time, dispatching by recipe type with internal type narrowing. |
| `src/di/provide-types.ts` | `ProvideService` interface (the typed shape of the `$provide` object) with overloaded method signatures mirroring `TypedModule`; `RegistrationDeps` interface (the typed bag of backing maps the helper needs); `PhaseState = 'config' \| 'run'`. |
| `src/di/__tests__/provide.test.ts` | Unit tests for each `$provide.*` method in isolation, plus phase-guard tests, plus override-semantics tests, plus the constant-override-throws test. |
| `src/di/__tests__/registration.test.ts` | Unit tests for `applyRegistrationRecord` covering each recipe and the constant-override guard. |
| `src/di/__tests__/provide-integration.test.ts` | End-to-end DI tests exercising `$provide` from inside `config()` blocks. |

`src/di/injector.ts` shrinks slightly: the per-record switch in `loadModule` (lines 327-360) is replaced by a single call to `applyRegistrationRecord(...)`. The `let phase` flag, the `constantNames: Set<string>` declaration, and the `providerCache.set('$provide', provideService)` self-registration are added inline.

`src/di/index.ts` re-exports the `ProvideService` type but NOT the value `createProvideService` (the `$provide` instance is only resolvable via `injector.get` inside a config block — there's no public ESM construction path).

No path alias changes — everything lives under `@di/*` which already exists.

### 2.2. Shared Recipe-Handler Helper — `src/di/registration.ts`

The helper takes a discriminated `recipe` and a `value` typed `unknown` at the boundary, narrowing inside each case:

```typescript
import type { Injector, Invokable, RecipeType } from './di-types';

export interface RegistrationDeps {
  readonly factoryInvokables: Map<string, Invokable>;
  readonly serviceCtors: Map<string, Invokable>;
  readonly providerInstances: Map<string, unknown>;
  readonly providerGetInvokables: Map<string, { invokable: Invokable; providerInstance: unknown }>;
  readonly providerCache: Map<string, unknown>;
  readonly decorators: Map<string, Invokable[]>;
  readonly constantNames: Set<string>;
  /** Thunk to forward-resolve the provider-phase injector (built after the maps). */
  readonly getProviderInjector: () => Injector;
}

export function applyRegistrationRecord(
  recipe: RecipeType,
  name: string,
  value: unknown,
  deps: RegistrationDeps,
): void {
  // Constant-override guard runs first — fires uniformly for module-DSL and
  // $provide registrations.
  if (recipe !== 'constant' && deps.constantNames.has(name)) {
    throw new Error(`Cannot override constant "${name}" — already registered via .constant(...)`);
  }

  switch (recipe) {
    case 'value':
      deps.providerCache.set(name, value);
      break;
    case 'constant':
      deps.providerCache.set(name, value);
      deps.constantNames.add(name);
      break;
    case 'factory':
      deps.factoryInvokables.set(name, value as Invokable);
      break;
    case 'service':
      deps.serviceCtors.set(name, value as Invokable);
      break;
    case 'provider':
      // Eager instantiation via providerInjector — lifted from the existing
      // loadModule path (lines 222-264 of injector.ts) — populates
      // providerInstances, providerGetInvokables, providerCache for the
      // <name>Provider key. Implementation detail: see §2.7.
      registerProvider(name, value, deps);
      break;
    case 'decorator':
      const existing = deps.decorators.get(name) ?? [];
      existing.push(value as Invokable);
      deps.decorators.set(name, existing);
      break;
  }
}
```

The two `as Invokable` casts inside `case 'factory'` and `case 'service'` are unavoidable at this boundary — the public `RecipeType` union doesn't carry type information about each recipe's expected `value` shape. We keep them confined to the helper; everywhere else (module DSL typed overloads, `ProvideService` typed methods) the `Invokable` shape is statically enforced at the registration call site.

The body is the literal extraction of the existing switch in `loadModule` (lines 327-360 of `injector.ts`) plus the new constant-override guard at the top. No behavior changes to existing code paths — the switch produces identical side effects on the backing maps.

`registerProvider(name, value, deps)` is a small private helper (also inside `registration.ts`) that lifts the existing provider-instantiation logic from `loadModule`. Same code, refactored for reuse.

### 2.3. `createProvideService` Factory — `src/di/provide.ts`

```typescript
import { applyRegistrationRecord, type RegistrationDeps } from './registration';
import type { ProvideService, PhaseState } from './provide-types';

export function createProvideService(
  deps: RegistrationDeps,
  getPhase: () => PhaseState,
): ProvideService {
  const guard = (method: string): void => {
    if (getPhase() !== 'config') {
      throw new Error(
        `$provide.${method} is only callable during the config phase; calling it after the run phase begins is not supported`,
      );
    }
  };

  return {
    provider(name, source) {
      guard('provider');
      applyRegistrationRecord('provider', name, source, deps);
    },
    factory(name, invokable) {
      guard('factory');
      applyRegistrationRecord('factory', name, invokable, deps);
    },
    service(name, ctor) {
      guard('service');
      applyRegistrationRecord('service', name, ctor, deps);
    },
    value(name, val) {
      guard('value');
      applyRegistrationRecord('value', name, val, deps);
    },
    constant(name, val) {
      guard('constant');
      applyRegistrationRecord('constant', name, val, deps);
    },
    decorator(name, fn) {
      guard('decorator');
      applyRegistrationRecord('decorator', name, fn, deps);
    },
  };
}
```

The closure is small. `getPhase` is read on every call (not captured by reference) so the flag in the enclosing `createInjector` closure is always the current truth. Method parameter types come from `ProvideService` via contextual typing — no explicit annotations on the lambda parameters.

The return type annotation `ProvideService` is the only explicit type on the factory; everything else is inferred (`guard`'s return type, the object literal's shape, lambda parameter types). The only `as` cast in the body is none — there are zero casts.

### 2.4. Phase-State Tracking in `createInjector`

Two small additions inside the existing `createInjector` body:

```typescript
// Near the top of createInjector, alongside the other Map decls:
const constantNames = new Set<string>();
let phase: PhaseState = 'config';
const getPhase = (): PhaseState => phase;

// Build the provideService (after providerInjector is constructed, since
// RegistrationDeps.getProviderInjector references it):
const provideService = createProvideService(
  {
    factoryInvokables,
    serviceCtors,
    providerInstances,
    providerGetInvokables,
    providerCache,
    decorators,
    constantNames,
    getProviderInjector: () => providerInjector,
  },
  getPhase,
);

// Self-register $provide into the providerCache, alongside $injector's
// existing self-registration at line 680:
providerCache.set('$provide', provideService);

// At the END of "Phase 2 — Config blocks" (after the loop that invokes
// every collectedConfigBlock through providerInjector):
phase = 'run';
providerCache.delete('$provide');
```

The thunk pattern (`getProviderInjector: () => providerInjector`) sidesteps the chicken-and-egg between the maps and `providerInjector` — same pattern the existing `let runInjector: Injector` forward-declaration at line 194 uses.

### 2.5. Each Method's Contract

The six methods on `ProvideService` mirror the typed overloads of their `TypedModule.<recipe>` counterparts. `applyRegistrationRecord` does the recipe dispatch, so the per-method runtime behavior is uniform.

| Method | Typed signature (mirrors TypedModule) | Runtime side effect |
| --- | --- | --- |
| `factory<Return>` | `(name: string, invokable: Invokable<Return>): void` — `Return` inferred from the trailing function of the supplied invokable | `factoryInvokables.set(name, invokable)` |
| `service` (3 overloads) | `(name: string, ctor: Ctor)` for bare constructor; `(name: string, invokable: readonly [...Deps, Ctor])` for array-form — `Deps extends readonly string[]`; constructor instance type extracted via `InstanceType<Ctor>` | `serviceCtors.set(name, ctor)` |
| `value<V>` | `(name: string, value: V): void` — `V` inferred from the literal | `providerCache.set(name, value)` (throws if `name` is in `constantNames`) |
| `constant<V>` | `(name: string, value: V): void` — `V` inferred from the literal | `providerCache.set(name, value)` AND `constantNames.add(name)` |
| `provider` (4 overloads) | Constructor / object-literal / array-form / wide-fallback — mirrors `TypedModule.provider` exactly. Service type extracted via `InvokableReturn<P['$get']>`; provider shape via `InstanceType<Ctor>` | Eager instantiation via `getProviderInjector().invoke(...)`; populates `providerInstances`, `providerGetInvokables`, `providerCache` for `<name>Provider` |
| `decorator` (2 overloads) | Array form: `(name: string, invokable: readonly ['$delegate', ...Deps, (delegate: unknown, ...rest: ResolveDeps<unknown, Deps>) => Return])`; wide fallback: `(name: string, fn: Invokable)` | Appends to `decorators.get(name)` (creates entry if missing); decorator is applied at run-phase resolution |

The decorator's `delegate: unknown` parameter type is a deliberate concession: inside a config block, the `Registry` of services is opaque (config blocks may run at any point in module loading order, and the service being decorated may have already been wrapped by a prior decorator). Apps can narrow `delegate` via a typed callback parameter or a cast inside the decorator body.

The validation inside `applyRegistrationRecord` is the same validation `loadModule` already performs implicitly via the switch (e.g., `factory` requires `Invokable`-shaped value because the invoker calls it; `provider` requires `$get`). Most of these are passed through to the existing machinery — `applyRegistrationRecord` doesn't add new validation beyond what's already there, plus the constant-override guard.

### 2.6. Constant-Override Guard

When `applyRegistrationRecord` is called with `recipe !== 'constant'` and `deps.constantNames.has(name)`, it throws:

```
Cannot override constant "<name>" — already registered via .constant(...)
```

This protects developers from a class of subtle bug where a `.value('foo', x)` or `$provide.value('foo', x)` silently shadows a constant that other modules depend on (constants are resolvable in config blocks, so a downstream config block could be reading the OLD value via injection at the moment a config block re-registers it as a value).

The guard runs uniformly:
- Inside `loadModule` (when a downstream module's `$$invokeQueue` tries to override a parent's `.constant`).
- Inside `$provide.*` methods (when a config block tries to override an earlier `.constant`).

Per FS §2.12 backwards-compatibility, existing tests must continue to pass. We need to verify that no existing test relies on the AngularJS silent-override behavior. **Action item for the implementation slice:** grep the existing test suite for patterns where `.constant('x', ...)` is followed by `.value('x', ...)` (or vice versa). Spec 007/008 test fixtures use `.constant` heavily — check those specifically. If any are found, classify as (a) intentional override pattern (rare; flag for spec discussion), or (b) accidental name reuse (already a bug; tests need a tweak). The implementation slice's first sub-task is this audit.

The guard message is exact-string-asserted in `registration.test.ts` so future log-format edits don't silently regress.

### 2.7. Provider Eager-Instantiation — `registerProvider(name, source, deps)`

Lifted from `loadModule` lines 222-264. Signature:

```typescript
function registerProvider(name: string, source: unknown, deps: RegistrationDeps): void {
  // Three accepted source shapes — same as module.provider:
  //   (a) constructor: `new Ctor()` produces the provider instance
  //   (b) object literal with $get
  //   (c) array-style invokable that produces the provider instance
  const providerInstance = instantiateProviderSource(source, deps.getProviderInjector());
  if (typeof providerInstance !== 'object' || providerInstance === null || !('$get' in providerInstance)) {
    throw new Error(`Provider "${name}" must produce an object with a $get method`);
  }
  const providerKey = `${name}Provider`;
  deps.providerInstances.set(providerKey, providerInstance);
  deps.providerCache.set(providerKey, providerInstance);
  deps.providerGetInvokables.set(name, {
    invokable: providerInstance.$get as Invokable,
    providerInstance,
  });
}
```

`instantiateProviderSource` is a tiny private helper (also inside `registration.ts`) that picks the right instantiation strategy based on the source's shape — same logic as the existing inline branches in `loadModule`. The cast on `.$get` is the only one in the helper; it's gated by the in-line shape check on the previous line.

The `<name>Provider` key is written to BOTH `providerInstances` AND `providerCache` so subsequent config blocks injecting `'fooProvider'` resolve via the providerCache fast-path (line 621 of injector.ts).

Provider instantiation is eager — runs at registration time, including during `$provide.provider(...)` calls inside a config block. This matches the existing `loadModule` behavior and ensures FS §2.6's "subsequent config block sees the new provider instance" semantics work without additional plumbing.

### 2.8. `ProvideService` Interface — Full Typed Surface

In `src/di/provide-types.ts`:

```typescript
import type { Invokable, InvokableReturn, ResolveDeps } from './di-types';

export type PhaseState = 'config' | 'run';

export interface ProvideService {
  // ─── factory ──────────────────────────────────────────────────────────────
  /**
   * Register a factory under `name`. Mirrors `module.factory`.
   * `Return` is inferred from the trailing function of the supplied invokable.
   */
  factory<Return>(name: string, invokable: Invokable<Return>): void;

  // ─── service ──────────────────────────────────────────────────────────────
  /** Bare constructor form. Service type is `InstanceType<Ctor>`. */
  service<Ctor extends new (...args: never[]) => unknown>(name: string, ctor: Ctor): void;
  /** Array-style annotation form; deps and constructor inferred from the tuple. */
  service<const Deps extends readonly string[], Ctor extends new (...args: ResolveDeps<Record<string, unknown>, Deps>) => unknown>(
    name: string,
    invokable: readonly [...Deps, Ctor],
  ): void;
  /** Wide fallback for dynamic cases. */
  service(name: string, invokable: Invokable): void;

  // ─── value ────────────────────────────────────────────────────────────────
  /** `V` inferred from the literal. Throws if `name` is already a constant. */
  value<V>(name: string, value: V): void;

  // ─── constant ─────────────────────────────────────────────────────────────
  /** `V` inferred from the literal. */
  constant<V>(name: string, value: V): void;

  // ─── provider (mirrors TypedModule.provider) ──────────────────────────────
  /** Constructor form with no deps. Service type extracted from `$get`. */
  provider<Ctor extends new () => { $get: Invokable }>(name: string, ctor: Ctor): void;
  /** Object-literal form. Service type extracted from `$get`. */
  provider<P extends { $get: Invokable }>(name: string, obj: P): void;
  /** Array-style annotation form. Deps inferred from the tuple. */
  provider<
    const Deps extends readonly string[],
    Ctor extends new (...args: ResolveDeps<Record<string, unknown>, Deps>) => { $get: Invokable },
  >(
    name: string,
    invokable: readonly [...Deps, Ctor],
  ): void;
  /** Wide fallback for dynamic cases. */
  provider(name: string, source: unknown): void;

  // ─── decorator ────────────────────────────────────────────────────────────
  /**
   * Array-style form. The first dep MUST be `'$delegate'`; remaining names are
   * dep names. The trailing callback receives the delegate (typed `unknown`
   * because the registry is opaque inside config blocks) and the resolved deps.
   */
  decorator<const Deps extends readonly string[], Return>(
    name: string,
    invokable: readonly ['$delegate', ...Deps, (delegate: unknown, ...rest: ResolveDeps<Record<string, unknown>, Deps>) => Return],
  ): void;
  /** Wide fallback. */
  decorator(name: string, fn: Invokable): void;
}
```

Key typing notes:

- `factory<Return>` infers `Return` from the trailing function of `Invokable<Return>` — same mechanism as `module.factory<K, Return>` but without the registry-accumulation type parameter `K` (since the registry doesn't get extended at this layer).
- `service` overloads use `InstanceType<Ctor>` to extract the service type from a constructor — but since this is purely an INPUT-side narrowing (we're not exporting that type into a registry), it lives inside the constraint `Ctor extends new (...) => unknown`.
- `value<V>` and `constant<V>` infer `V` purely for the input-side type-check; the registered value isn't surfaced anywhere typed.
- `provider`'s overloads mirror `TypedModule.provider` — three "narrow" forms plus a wide fallback. Same constraint shapes (`{ $get: Invokable }`, `new () => { $get: Invokable }`, array-style with `ResolveDeps`).
- `decorator`'s `delegate: unknown` is deliberate — see §2.5.
- `ResolveDeps<Record<string, unknown>, Deps>` is used in array-form decorators / providers / services because we don't have a typed registry to resolve against at this layer; `Record<string, unknown>` is the wide-but-typed default.

Re-export from `src/di/index.ts`:

```typescript
export type { ProvideService, PhaseState } from './provide-types';
// (no value export — $provide is only obtained via injection in a config block)
```

`createProvideService`, `applyRegistrationRecord`, and `RegistrationDeps` are NOT re-exported from the public barrel. They're internal factories consumed only by `createInjector`.

### 2.9. `loadModule` Refactor

The existing switch in `loadModule` (lines 327-360 of `injector.ts`) is replaced by a one-liner:

```typescript
// Before:
for (const [recipe, name, value] of mod.$$invokeQueue) {
  // ~30 lines of switch dispatch
}

// After:
for (const [recipe, name, value] of mod.$$invokeQueue) {
  applyRegistrationRecord(recipe, name, value, registrationDeps);
}
```

Where `registrationDeps` is the same `RegistrationDeps` bag that `createProvideService` receives (constructed once near the top of `createInjector`).

The shrink: `injector.ts` drops ~25 lines (the switch body). `registration.ts` adds ~50 lines (the helper + types). Net ~25 line increase across the DI package, but `injector.ts` itself moves further toward the 500-line refactor target.

### 2.10. `$provide` Registration into `providerInjector`

`providerCache.set('$provide', provideService)` happens BEFORE Phase 2 (config blocks execution). This makes `'$provide'` resolvable during config-phase invocation via the existing `providerInjector.get` path (line 621-622 of injector.ts).

The runtime injector (`runInjector`, line 194/680) does NOT expose `'$provide'`:
- `providerCache.delete('$provide')` runs at the same time `phase = 'run'` flips, so post-Phase-2 `runInjector.get('$provide')` throws "Unknown provider" via the existing fallback.
- A captured `$provide` reference (saved in a config block, used post-Phase-2) STILL throws via the `getPhase()` check inside the `guard` helper. Two complementary defenses.

This satisfies FS §2.1 "`injector.get('$provide')` (post-bootstrap) — throws ‘Unknown provider: $provide’" cleanly without divergence in error wording.

### 2.11. Spec 014 Skipped Test Activation

`src/exception-handler/__tests__/di.test.ts` lines 84-105 contain the skipped test waiting for this spec. As part of THIS spec's implementation:

1. Remove the `// The canonical AngularJS override path...` comment block (lines 84-90).
2. Flip `it.skip(...)` to `it(...)`.
3. Remove the local `ProvideService` type alias on line 93 — replace with `import type { ProvideService } from '@di/index';` at the top of the file.
4. Run the test — it must pass: `injector.get('$exceptionHandler')` returns `mySpy` after the config block registers it via `$provide.factory`.

Per FS §2.11 [SUGGESTED] note: the orchestrator can re-run `/awos:verify` on spec 014 after this spec ships to flip the two `[ ] NOT MET` criteria to `[x]`. This is a manual follow-up; not part of THIS spec's automated success criteria, but suggested in the task list.

### 2.12. Public Exports

**`src/di/provide-types.ts`** (new):
```typescript
export interface ProvideService { /* full overloaded shape from §2.8 */ }
export type PhaseState = 'config' | 'run';
```

**`src/di/registration.ts`** (new):
```typescript
export function applyRegistrationRecord(...): void;
export interface RegistrationDeps { /* internal — exported for createProvideService */ }
```

**`src/di/provide.ts`** (new):
```typescript
export function createProvideService(deps: RegistrationDeps, getPhase: () => PhaseState): ProvideService;
```

**`src/di/index.ts`** additions:
```typescript
export type { ProvideService, PhaseState } from './provide-types';
```

**`src/index.ts`** additions:
```typescript
export type { ProvideService } from './di/index';
```

`createProvideService`, `applyRegistrationRecord`, and `RegistrationDeps` are NOT re-exported from the public barrel — internal-only.

### 2.13. `CLAUDE.md` Update

- **Modules table** `./di` row gains an inline addition: "now includes `$provide` config-phase injectable for dynamic registration overrides".
- **Non-obvious invariants** gains: "**`$provide` is config-phase only.** The injectable `'$provide'` resolves inside `config()` blocks across any module in the dependency graph. After the config phase ends, calling any `$provide.*` method throws synchronously, and `injector.get('$provide')` throws 'Unknown provider'. This is intentional — the registration timeline is a single ordered queue (chain-time module DSL + config-phase `$provide`), and allowing run-phase mutation would break determinism. Constants are protected by an override guard: `$provide.value` / `.factory` / `.service` / `.provider` calls that target a name already registered as a constant throw."
- **Where to look when…** gains: "How are services registered from inside config blocks?" → `src/di/provide.ts` (the injectable), `src/di/registration.ts` (the shared recipe handler).

No change to `src/di/README.md` if it doesn't already exist; the inline TSDoc on `ProvideService` carries the documentation.

---

## 3. Impact and Risk Analysis

### System Dependencies

- **`src/di/injector.ts`** — modifications: extract switch body into `applyRegistrationRecord` call (lines 327-360); add `constantNames: Set<string>`, `phase: PhaseState`, and the `provideService` build / seed near the existing Map decls; flip `phase = 'run'` and `providerCache.delete('$provide')` at end of Phase 2. Net change: ~30 line reduction in switch body, ~10 line addition for new declarations and seed/cleanup. Crosses the 700-line threshold downward (was 734).
- **`src/di/module.ts`** — UNCHANGED. The module DSL chain methods (`module.factory`, etc.) write to `$$invokeQueue`; `loadModule` (in injector.ts) still drains that queue. The split is at the `loadModule` / `$provide` boundary, not the module DSL boundary.
- **`src/di/di-types.ts`** — UNCHANGED. `Invokable`, `InvokableReturn`, `ResolveDeps`, and `RecipeType` types are used by both the module DSL and `$provide`; no new exports needed at this layer.
- **`src/di/index.ts`** — additive: export `ProvideService` and `PhaseState` types.
- **`src/exception-handler/__tests__/di.test.ts`** — Slice-style modification: flip the skipped test to active; remove the local `ProvideService` type alias and import the canonical one; remove the explanatory TODO comment block.
- **`src/core/`, `src/parser/`, `src/interpolate/`, `src/sce/`, `src/sanitize/`, `src/exception-handler/`** — UNCHANGED. None of them inspect `$$invokeQueue`, the backing maps, or `providerCache` directly. The new constant-override guard COULD theoretically affect a service that registers a constant and then a value of the same name — none observed today.
- **Existing tests** (specs 002, 003, 006, 007, 008, 009, 010, 011, 012, 013, 014) — must pass unchanged. The shared helper produces identical side effects to the existing switch; the constant-override guard fires only on a new pattern (constant → non-constant override) that no existing test exercises.

### Potential Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The constant-override guard breaks an existing test that depended on the AngularJS silent-override behavior. | Pre-flight grep before implementation: search the test suite for `.constant\(` followed by `.value\(\|.factory\(` of the same name. Spec 007/008 test fixtures use `.constant` heavily — check those specifically. The implementation slice's first sub-task is this audit. |
| Extracting `applyRegistrationRecord` introduces a regression in `loadModule`'s existing behavior. | The helper is a literal copy-paste of the switch body, NOT a rewrite. The implementation slice runs the full test suite (`pnpm test`) immediately after the extraction, BEFORE wiring `$provide`. Any regression surfaces as a known set of failing tests, with the only possible cause being the extraction itself — bisect window is one commit. |
| A captured `$provide` reference (saved in a config block, used in a run block) bypasses the phase guard. | The phase flag is local to `createInjector` and only mutated in ONE place (end of Phase 2). The guard reads via a thunk (not a captured snapshot). A unit test in `provide.test.ts` explicitly captures `$provide` in a closure, runs Phase 2 to completion, then invokes the captured method — must throw. |
| Provider eager-instantiation inside `$provide.provider(...)` runs `providerInjector.invoke`, which can recursively resolve other providers — could cycle. | Existing `loadModule` already eagerly instantiates providers via the same path (line 260+); cycle detection is built into the existing `providerInjector` machinery via the resolution stack (line 196-198 of injector.ts). `$provide.provider` reuses that exact path with no new logic. |
| The TypedModule signatures already use `InvokableReturn`, `ResolveDeps`, etc. — `ProvideService` mirroring those carries the same type-system risks (e.g., overload-resolution silently falling back to the wide form on a typo). | This is identical to the existing `TypedModule` situation, where typo-detection on dep names beyond the first has the same documented limitation (`module.ts` lines 576-580 call this out explicitly). Same docs/test patterns apply: the typed overloads work for the common case; typos surface as `unknown` or fall to the wide overload. |
| The new file `src/di/registration.ts` introduces a circular import with `injector.ts`. | The helper takes `getProviderInjector: () => Injector` via the `RegistrationDeps` thunk. Type-only imports of `Injector` are fine; the value is passed at runtime. No import cycle, just a forward-declared reference. |
| Provider eager-instantiation requires `providerInjector` to exist when `$provide.provider(...)` runs — but `providerInjector` is constructed AFTER the maps. | The `getProviderInjector` thunk pattern means `RegistrationDeps` can be constructed before `providerInjector`; the thunk is only INVOKED when `$provide.provider` actually runs (always inside a config block, by which time `providerInjector` is built). Same forward-declaration pattern as the existing `let runInjector: Injector` at line 194. |
| The decorator's `delegate: unknown` parameter type forces apps to cast inside the decorator body. | Same as the existing TypedModule.decorator wide-fallback overload. Documented in TSDoc on `ProvideService.decorator`. Apps wanting a typed delegate use the array-form with explicit casting OR rely on the same module's `module.decorator(name, ...)` which DOES have the typed `delegate: Registry[K]` parameter. |
| `providerCache.delete('$provide')` at end of Phase 2 leaves a brief window where a synchronous run-block first in line could still see the entry. | The deletion happens AFTER the config-block loop and BEFORE the run-block invocation. Run blocks see `runInjector.get('$provide')` throwing "Unknown provider" — correct semantics. Lock down with a unit test: register a run block that injects `'$provide'`, expect throw. |

---

## 4. Testing Strategy

All tests use Vitest (project standard). Target 90%+ line coverage on `src/di/provide.ts` and `src/di/registration.ts`. Existing 90% threshold for `src/di/` is preserved.

### 4.1. `applyRegistrationRecord` Unit Tests — `src/di/__tests__/registration.test.ts`

- One test per recipe (`provider`, `factory`, `service`, `value`, `constant`, `decorator`) — verifies the helper writes the correct backing map on input. Use a freshly-constructed `RegistrationDeps` per test so state doesn't leak.
- Constant-override guard fires when `recipe !== 'constant'` and `name` is in `constantNames`. Test: register `('constant', 'X', 'a', deps)`; then register `('value', 'X', 'b', deps)` — expect throw with message containing `'Cannot override constant "X"'`.
- Constant-over-constant is allowed (same recipe, last-wins): register `('constant', 'X', 'a', deps)`; then register `('constant', 'X', 'b', deps)` — no throw, `providerCache.get('X') === 'b'`.
- Decorator stacking: register `('decorator', 'svc', d1, deps)` then `('decorator', 'svc', d2, deps)` — `decorators.get('svc')` is `[d1, d2]`.
- Provider eager-instantiation: register `('provider', 'foo', class { $get = () => 'v'; }, deps)` — `providerInstances.get('fooProvider')` is the instance; `providerCache.get('fooProvider')` is the same reference; `providerGetInvokables.get('foo')` carries `$get` and `providerInstance`.

### 4.2. `createProvideService` Unit Tests — `src/di/__tests__/provide.test.ts`

- All six methods reject calls when `getPhase() === 'run'` — each method throws with message containing `$provide.<method>` and `config phase`.
- Constant-override guard surfaces through `$provide` too: `$provide.constant('X', 'a')` then `$provide.value('X', 'b')` — throws.
- Each method, called during config phase, correctly delegates to `applyRegistrationRecord` (mock the helper or use a real `RegistrationDeps` and assert the resulting maps).
- Captured-reference test: save `$provide` reference inside a config block; flip `phase = 'run'`; calling `savedProvide.factory(...)` throws.
- Type-system tests: write a few `expectTypeOf` (or `// @ts-expect-error`) assertions confirming that (a) `$provide.factory<'X', number>('X', () => 'string')` is a type error (return mismatch); (b) `$provide.value('X', 5)` infers `V` as `number`; (c) `$provide.decorator('X', ['$delegate', (d) => 'y'])` infers the array-form correctly.

### 4.3. End-to-End DI Integration — `src/di/__tests__/provide-integration.test.ts`

- `config(['$provide', $p => $p.factory('greeting', () => 'hello')])` — `injector.get('greeting')` returns `'hello'` post-bootstrap.
- `config(['$provide', ...])` block in module A; module B (downstream) writes `config(['$provide', ...])` registering the same name — module B wins (last-wins).
- `config(['$provide', $p => $p.provider('my', MyProvider)])` followed by a SECOND config block in the same module reading `'myProvider'` and mutating it — the run-phase service reflects the mutation.
- `config(['$provide', $p => $p.decorator('foo', ['$delegate', $d => $d + '!'])])` — `injector.get('foo')` returns the decorated value.
- `module.factory('foo', oldFn)` + `config(['$provide', $p => $p.factory('foo', newFn)])` — `injector.get('foo')` resolves via `newFn`.
- Run-block injection rejection: `module.run(['$provide', () => {}])` — throws "Unknown provider: $provide" at run-phase invocation.
- Post-bootstrap `injector.get('$provide')` throws "Unknown provider: $provide".
- All six recipes covered: at least one integration test per `factory` / `service` / `value` / `constant` / `provider` / `decorator`.

### 4.4. Spec 014 Skipped Test Activation — `src/exception-handler/__tests__/di.test.ts`

- The previously-skipped `it.skip("config(['$provide', $p => $p.factory(...)]) replaces the default", ...)` test is flipped to `it(...)`.
- Local `ProvideService` type alias is removed, replaced with `import type { ProvideService } from '@di/index';`.
- The TODO explanatory comment is removed.
- Test passes: `$provide.factory('$exceptionHandler', () => mySpy)` in a config block makes `mySpy` the resolved handler.
- This test serves as the integration-level acceptance for spec 015's deliverables AND closes the spec 014 gap.

### 4.5. Regression Tests

Entire existing suites (specs 002, 003, 006, 007, 008, 009, 010, 011, 012, 013, 014) continue to pass unchanged. The constant-override guard is the only new behavior that COULD cause a regression — the pre-flight grep audit (Risk table item 1) catches any dependent test before the implementation slice begins.

CI runs the full suite on every push.
