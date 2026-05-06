/**
 * Per-record registration helper for the DI module.
 *
 * Slice 2 (spec 015) extracted the switch body that `loadModule` in
 * `./injector.ts` used to inline for every entry of a module's
 * `$$invokeQueue`. Drains a single `[recipe, name, value]` tuple into the
 * appropriate backing map (or, for the `provider` recipe, normalizes the
 * registration source into a provider instance + lazy `$get` invokable).
 *
 * Slice 3 added the constant-override guard at the top of
 * {@link applyRegistrationRecord}: any non-`constant` recipe targeting a
 * name already registered via `.constant(...)` throws synchronously. The
 * guard fires uniformly through both the module-DSL path (`loadModule`) and
 * the `$provide` path (Slice 4+).
 *
 * Slice 7 added the last-wins eviction step (FS §2.9): a new producer
 * recipe wipes prior producer entries for the same `name` from the other
 * backing maps so the run-phase `get`'s ordered fallback returns the most
 * recent producer's value rather than a stale earlier one.
 *
 * Internal-only: not re-exported from `./index.ts`.
 */

import { isArray, isFunction } from '@core/utils';

import { annotate as annotateInvokable } from './annotate';
import type { Injector, Invokable } from './di-types';
import type { RecipeType } from './module';

/**
 * Typed bag of backing maps + sets that {@link applyRegistrationRecord}
 * (and the private {@link registerProvider} helper) writes into when
 * draining a module's `$$invokeQueue`.
 *
 * The `readonly` modifier on each property refers to the **binding** —
 * callers can't reassign `deps.factoryInvokables` to a fresh `Map` — but
 * the maps themselves are deliberately mutable, since the whole point of
 * this helper is to populate them.
 *
 * `getProviderInjector` is a thunk rather than a direct `Injector`
 * reference so that `createInjector` can construct `RegistrationDeps`
 * before `providerInjector` itself is initialized — the thunk is only
 * dereferenced when a `provider` recipe with array-style deps actually
 * needs to resolve them through the config-phase injector.
 */
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

/**
 * Apply a single `[recipe, name, value]` invoke-queue tuple to the
 * appropriate backing map in `deps`. The dispatch mirrors the original
 * inline switch in `loadModule`:
 *
 * - `value` / `constant` → `providerCache`
 * - `factory` → `factoryInvokables`
 * - `service` → `serviceCtors`
 * - `decorator` → `decorators` (appended to the per-name chain)
 * - `provider` → routed through {@link registerProvider}
 *
 * Throws `Cannot override constant "<name>" — already registered via
 * .constant(...)` synchronously when a non-`constant` recipe targets a
 * name that was previously registered as a `.constant`. The guard runs
 * uniformly for both module-DSL and `$provide` registrations.
 *
 * After the guard, a new producer recipe (anything other than `decorator`)
 * evicts any prior producer entries for the same `name` from the OTHER
 * backing maps, implementing FS §2.9 last-wins across the unified
 * registration timeline. Decorators stack on the current producer rather
 * than replacing it, so they skip the eviction step.
 */
export function applyRegistrationRecord(
  recipe: RecipeType,
  name: string,
  value: unknown,
  deps: RegistrationDeps,
): void {
  if (recipe !== 'constant' && deps.constantNames.has(name)) {
    throw new Error(`Cannot override constant "${name}" — already registered via .constant(...)`);
  }

  // Last-wins across the unified registration timeline (FS §2.9): a new
  // producer recipe supersedes any prior producer entry under `name`. Evict
  // stale entries from the OTHER producer slots so the run-phase `get`'s
  // ordered fallback (`providerCache → factoryInvokables → serviceCtors →
  // providerGetInvokables`) returns the most-recent producer's value, not a
  // stale earlier one. The `decorator` recipe does NOT evict — decorators
  // stack on whatever producer is current at resolution time.
  if (recipe !== 'decorator') {
    deps.providerCache.delete(name);
    deps.factoryInvokables.delete(name);
    deps.serviceCtors.delete(name);
    deps.providerInstances.delete(`${name}Provider`);
    deps.providerGetInvokables.delete(name);
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
      // Factories are lazy: stash the invokable now and invoke it on the
      // first `get(name)` call. The invoke-queue entry's `value` slot holds
      // the raw `Invokable` passed to `module.factory(name, invokable)`.
      deps.factoryInvokables.set(name, value as Invokable);
      break;
    case 'service':
      // Services are also lazy: stash the constructor now and `new`-it on
      // the first `get(name)` call. The invoke-queue entry's `value` slot
      // holds the raw `Invokable` passed to `module.service(name, invokable)`,
      // which can be either a bare constructor or a `[...deps, Ctor]`
      // array-style annotation.
      deps.serviceCtors.set(name, value as Invokable);
      break;
    case 'decorator': {
      // Decorators are stashed per target service name in registration
      // order. The actual wrapping happens later during `get` resolution
      // via a `$delegate` locals override. Appending here preserves the
      // intra-module ordering that the queue drain relies on; cross-module
      // ordering is governed by the post-order module walk.
      const existing = deps.decorators.get(name);
      if (existing === undefined) {
        deps.decorators.set(name, [value as Invokable]);
      } else {
        existing.push(value as Invokable);
      }
      break;
    }
    case 'provider':
      // Normalize the registration source (Form 1/2/3) into a provider
      // instance and extract its `$get` invokable. Runs eagerly so that
      // later providers in the same invoke queue can depend on earlier
      // ones via the config-phase injector.
      registerProvider(name, value, deps);
      break;
  }
}

/**
 * Normalize a provider registration to a provider instance + lazy `$get`
 * invokable. Handles all three registration forms:
 *
 * 1. **Array-style** `[...deps, Ctor]` — instantiate `Ctor` via the
 *    config-phase injector so its dependencies resolve from the current
 *    `providerCache` and `providerInstances`. The resulting object is
 *    the provider instance.
 * 2. **Constructor function** — call `new Ctor()` directly (no deps).
 * 3. **Object literal** — use the value directly as the provider instance.
 *
 * Throws with a clear error if the source is none of these forms or if
 * the resulting instance has no `$get` method.
 */
function registerProvider(name: string, providerSource: unknown, deps: RegistrationDeps): void {
  let providerInstance: { $get: Invokable };

  if (isArray(providerSource)) {
    // Form 3: array-style `[...deps, Ctor]`. Resolve deps via the
    // config-phase injector so that providers can depend on constants and
    // on other providers (via their `<name>Provider` key). We can't route
    // through `providerInjector.invoke` because that calls the trailing
    // function with `.apply(self, resolvedDeps)` — we need `new Ctor(...)`.
    //
    // `isArray` narrows a `T | readonly unknown[]` input to the
    // array-shaped subtype via `Extract`, which collapses to `never`
    // when the input is plain `unknown`, so we hold on to a separately
    // typed alias of the source before indexing into it.
    const providerArray = providerSource;
    const providerInjector = deps.getProviderInjector();
    const annotated = annotateInvokable(providerArray as unknown as Invokable);
    const resolvedDeps = annotated.map((depName) => providerInjector.get(depName));
    const Ctor = providerArray[providerArray.length - 1] as new (...args: unknown[]) => unknown;
    providerInstance = new Ctor(...resolvedDeps) as { $get: Invokable };
  } else if (isFunction(providerSource)) {
    // Form 1: bare constructor function with no deps.
    const Ctor = providerSource as new () => unknown;
    providerInstance = new Ctor() as { $get: Invokable };
  } else if (providerSource !== null && typeof providerSource === 'object' && '$get' in providerSource) {
    // Form 2: object literal with a `$get` method.
    providerInstance = providerSource as { $get: Invokable };
  } else {
    throw new Error(`Expected provider for "${name}" to be a function, array, or object with $get`);
  }

  // All three forms must produce an instance with a `$get` method. Form 2
  // is pre-checked by the `'$get' in providerSource` guard, but Form 1 and
  // Form 3 may construct an object that omits `$get` (e.g. a constructor
  // that forgets to assign it), so re-validate here as the single choke
  // point for the error message. TypeScript already believes `$get` is
  // present on `providerInstance` (we annotated it that way to keep the
  // rest of the function honest), so we widen through `unknown` to run
  // the runtime check without tripping `no-unnecessary-condition`.
  if ((providerInstance as { $get?: unknown }).$get === undefined) {
    throw new Error(`Provider "${name}" has no $get method`);
  }

  // Register the instance under its `<name>Provider` key so config blocks
  // can inject and mutate it. Stash `$get` (with its owning provider
  // instance as the `this` binding) into the lazy invocation map so the
  // run-phase `get` can materialize the final service singleton from it.
  deps.providerInstances.set(`${name}Provider`, providerInstance);
  deps.providerGetInvokables.set(name, {
    invokable: providerInstance.$get,
    providerInstance,
  });
}
