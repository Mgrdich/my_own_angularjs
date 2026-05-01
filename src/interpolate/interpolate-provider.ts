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
 *
 * Since spec 012 slice 6, `$get` declares `$sce` as a dependency and wires
 * the `sceGetTrusted` / `sceIsEnabled` callbacks into `createInterpolate` —
 * the injector-produced service is fully trust-aware (single-binding rule
 * and render-time `$sce.getTrusted` unwrapping). The pure-ESM factory
 * (`createInterpolate()` with no options) remains trust-agnostic and
 * performs no enforcement; that path is for consumers who opt out of SCE.
 */

import type { ExceptionHandler } from '@exception-handler/index';
import { createInterpolate } from './interpolate';
import { DEFAULT_END_SYMBOL, DEFAULT_START_SYMBOL, validateDelimiters } from './interpolate-delimiters';
import type { InterpolateService } from './interpolate-types';
import type { SceService } from '@sce/sce-types';

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
   * Injector-facing factory. Array-style invokable declaring `$sce` and
   * `$exceptionHandler` as its dependencies. The injector resolves both first
   * (`$exceptionHandler` has zero deps; `$sce` depends on `$sceDelegate`),
   * then this factory builds an `InterpolateService` that routes both trust
   * enforcement (via `$sce`) and runtime expression-error reporting (via
   * `$exceptionHandler`).
   */
  $get = [
    '$sce',
    '$exceptionHandler',
    ($sce: SceService, $exceptionHandler: ExceptionHandler): InterpolateService =>
      createInterpolate({
        startSymbol: this.$$startSymbol,
        endSymbol: this.$$endSymbol,
        sceGetTrusted: (ctx, v) => $sce.getTrusted(ctx, v),
        sceIsEnabled: () => $sce.isEnabled(),
        exceptionHandler: $exceptionHandler,
      }),
  ] as const;
}
