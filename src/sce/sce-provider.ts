/**
 * `$SceProvider` — DI-facing configurator for the `$sce` service.
 *
 * Exposes a fluent `enabled` getter / setter intended for use from
 * `config(['$sceProvider', p => p.enabled(false)])` blocks, and a `$get`
 * invokable that the run-phase injector drains to produce the actual
 * service via `createSce`. `$get` declares `$sceDelegate` as a dependency
 * so the DI graph instantiates the delegate before this façade — the
 * classic AngularJS 1.x `$sce` registration pattern.
 *
 * Mirrors AngularJS 1.x `$sceProvider`. The `$` prefix on the class name
 * is the AngularJS convention for built-in service providers; the `$$`
 * prefix on the instance field signals "private / not part of the public
 * API" and mirrors existing conventions (`$InterpolateProvider.$$startSymbol`,
 * `$SceDelegateProvider.$$allowList`).
 *
 * Setter validation fires immediately — a non-boolean argument throws
 * synchronously during the `config()` phase rather than being silently
 * coerced.
 */

import { createSce } from '@sce/sce';
import type { SceDelegateService, SceService } from '@sce/sce-types';

export class $SceProvider {
  // `$$` prefix mirrors the AngularJS "internal / not part of the public
  // API" convention. Strict mode is ON by default (AngularJS 1.x parity).
  private $$enabled: boolean = true;

  /**
   * Get or set the strict-mode flag. With no argument, returns the current
   * boolean. With a boolean argument, stores it and returns `this` so the
   * call is chainable. Any non-boolean argument throws a descriptive error
   * naming the received `typeof`.
   *
   * Strict mode can only be toggled at config time — the produced `$sce`
   * captures the flag in force at `$get` time and exposes no runtime
   * setter. AngularJS 1.x parity.
   *
   * Note on the `value?: boolean` overload: a JavaScript caller writing
   * `provider.enabled(undefined)` reaches the no-arg branch (the getter),
   * not a throw. This matches the overloaded getter/setter pattern used
   * across the project's providers.
   */
  enabled(): boolean;
  enabled(value: boolean): this;
  enabled(value?: boolean): boolean | this {
    if (value === undefined) {
      return this.$$enabled;
    }
    if (typeof value !== 'boolean') {
      throw new Error(`$sceProvider.enabled: value must be a boolean, got ${typeof value}`);
    }
    this.$$enabled = value;
    return this;
  }

  /**
   * Injector-facing factory. Array-style invokable declaring `$sceDelegate`
   * as its only dependency — the injector resolves the delegate first and
   * passes it in, guaranteeing correct ordering without explicit wiring.
   * The closure captures `this` so the flag in force at `$get` time (i.e.
   * after all `config()` blocks have run) is the one baked into the
   * produced service.
   */
  $get = [
    '$sceDelegate',
    (delegate: SceDelegateService): SceService => createSce({ delegate, enabled: this.$$enabled }),
  ] as const;
}
