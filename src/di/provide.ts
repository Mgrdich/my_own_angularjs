/**
 * Factory for the `$provide` config-phase injectable.
 *
 * `createProvideService(deps, getPhase)` returns the object that resolves
 * under the name `'$provide'` inside `config()` blocks. Each of the six
 * methods (`factory`, `service`, `value`, `constant`, `provider`,
 * `decorator`) (a) reads `getPhase()` on every call to enforce the
 * config-phase exclusivity rule from FS §2.8, then (b) delegates to the
 * shared {@link applyRegistrationRecord} helper so that both the module
 * DSL path (drained from `$$invokeQueue` in `loadModule`) and the
 * `$provide` path produce identical side effects on the backing maps.
 *
 * The `getPhase()` thunk is invoked on every method call (NOT snapshotted
 * at factory build time) so a `$provide` reference captured inside a
 * config block and called after the run phase begins still trips the
 * guard — matching FS §2.8's captured-reference acceptance criterion.
 *
 * Internal-only: not re-exported from `./index.ts` (only the
 * {@link ProvideService} type is part of the public surface).
 */

import type { Invokable } from './di-types';
import { applyRegistrationRecord, type RegistrationDeps } from './registration';
import type { PhaseState, ProvideService } from './provide-types';

export function createProvideService(deps: RegistrationDeps, getPhase: () => PhaseState): ProvideService {
  const guard = (method: string): void => {
    if (getPhase() !== 'config') {
      throw new Error(
        `$provide.${method} is only callable during the config phase; calling it after the run phase begins is not supported`,
      );
    }
  };

  // The interface declares overloaded signatures for `provider`, `service`,
  // and `decorator`; TypeScript can't synthesize a single contextual
  // signature for those methods inside an object literal, so the
  // implementation parameters fall back to the widest-input shape that
  // matches every overload of each method (`unknown` for `provider`'s
  // source, `Invokable` for `service`/`decorator`'s callable arg). The
  // single-signature methods (`factory`, `value`, `constant`) infer their
  // parameter types from the interface contextually and need no
  // annotations.
  return {
    provider(name: string, source: unknown): void {
      guard('provider');
      applyRegistrationRecord('provider', name, source, deps);
    },
    factory(name, invokable) {
      guard('factory');
      applyRegistrationRecord('factory', name, invokable, deps);
    },
    service(name: string, ctor: Invokable): void {
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
    decorator(name: string, fn: Invokable): void {
      guard('decorator');
      applyRegistrationRecord('decorator', name, fn, deps);
    },
  };
}
