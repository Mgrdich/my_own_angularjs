/**
 * `$InterpolateProvider` — DI-facing configurator for the `$interpolate`
 * service. Exposes fluent `startSymbol` / `endSymbol` getter/setter methods
 * intended for use from `config(['$interpolateProvider', p => ...])` blocks,
 * and a `$get` invokable that the run-phase injector drains to produce the
 * actual service via `createInterpolate`.
 *
 * Mirrors AngularJS 1.x `$interpolateProvider` — the two APIs are identical
 * from a user's perspective, just typed. The `$` prefix on the class name is
 * the AngularJS convention for built-in service providers.
 */

import { DEFAULT_END_SYMBOL, DEFAULT_START_SYMBOL, validateDelimiters } from './interpolate-delimiters';
import { createInterpolate } from './interpolate';
import type { InterpolateService } from './interpolate-types';

export class $InterpolateProvider {
  // `$$` prefix mirrors the AngularJS "internal / not part of the public API"
  // convention used elsewhere (`Scope.$$watchers`, `Module.$$invokeQueue`).
  // Kept private so callers are routed through the validated setters.
  private $$startSymbol: string = DEFAULT_START_SYMBOL;
  private $$endSymbol: string = DEFAULT_END_SYMBOL;

  /**
   * Get or set the interpolation start symbol. With no argument, returns the
   * current start symbol. With a string argument, validates the new symbol
   * against the current end symbol and stores it, returning `this` so the
   * call is chainable.
   *
   * Validation (non-empty, not equal to the opposing delimiter) matches
   * `createInterpolate`'s rules exactly — misconfiguration surfaces at
   * setter-call time, not at first render.
   */
  startSymbol(): string;
  startSymbol(value: string): this;
  startSymbol(value?: string): string | this {
    if (value === undefined) {
      return this.$$startSymbol;
    }
    validateDelimiters(value, this.$$endSymbol);
    this.$$startSymbol = value;
    return this;
  }

  /**
   * Get or set the interpolation end symbol. Symmetric to {@link startSymbol}:
   * no-arg call returns the current end symbol; string arg validates and
   * stores it, returning `this` for chaining.
   */
  endSymbol(): string;
  endSymbol(value: string): this;
  endSymbol(value?: string): string | this {
    if (value === undefined) {
      return this.$$endSymbol;
    }
    validateDelimiters(this.$$startSymbol, value);
    this.$$endSymbol = value;
    return this;
  }

  /**
   * Injector-facing factory. Array-style invokable with no dependencies —
   * the closure captures `this` via the bound method call so the symbols
   * configured on the provider instance at `$get` time are the ones baked
   * into the produced service.
   */
  $get = [
    (): InterpolateService => createInterpolate({ startSymbol: this.$$startSymbol, endSymbol: this.$$endSymbol }),
  ] as const;
}
