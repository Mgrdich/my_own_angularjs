/**
 * Built-in + custom (sync / async) validators + `$pending` (spec 039
 * Slice 5).
 *
 * End-to-end through the canonical `ngModule` (via `bootstrapInjector`),
 * exercising the real `$compile` / `$rootScope` / `$q` so the forms
 * directives registered by `src/core/ng-module.ts` are reachable. User
 * input is simulated by dispatching native `input` / `change` events;
 * async validators use the real digest-scheduled `$q`, driven by resolving
 * a deferred and running a digest.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { QDeferred, QService } from '@async/q-types';
import type { CompileService } from '@compiler/directive-types';
import type { Scope } from '@core/index';
import { bootstrapInjector } from '@bootstrap/index';
import { resetRegistry } from '@di/module';
import { NgModelControllerImpl } from '@forms/ng-model-controller';

interface Harness {
  $compile: CompileService;
  $rootScope: Scope;
  $q: QService;
}

function boot(): Harness {
  const injector = bootstrapInjector([]);
  return {
    $compile: injector.get('$compile'),
    $rootScope: injector.get('$rootScope'),
    $q: injector.get('$q'),
  };
}

afterEach(() => {
  resetRegistry();
});

function compile(html: string, $compile: CompileService, scope: Scope): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  const child = el.firstElementChild as HTMLElement;
  $compile(child)(scope);
  scope.$digest();
  return child;
}

function input(el: HTMLElement): HTMLInputElement {
  return el as HTMLInputElement;
}

function fireInput(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input'));
}

/** Pull the published `NgModelController` off an element's controller stash. */
function ctrlOf(el: HTMLElement): NgModelControllerImpl {
  const stash = (el as unknown as { $$ngControllers?: Map<string, unknown> }).$$ngControllers;
  const ctrl = stash?.get('ngModel');
  if (!(ctrl instanceof NgModelControllerImpl)) {
    throw new Error('no NgModelController on element');
  }
  return ctrl;
}

function model(scope: Scope, key: string): unknown {
  return (scope as unknown as Record<string, unknown>)[key];
}

// ────────────────────────────────────────────────────────────────────────────
// required / ng-required
// ────────────────────────────────────────────────────────────────────────────

describe('required (FS §2.6)', () => {
  it('flips control + form validity and toggles ng-invalid-required', () => {
    const { $compile, $rootScope } = boot();
    const form = compile('<form name="f"><input name="i" ng-model="v" required></form>', $compile, $rootScope);
    const el = input(form.querySelector('input') as HTMLElement);

    // Fresh empty control fails `required`.
    const ctrl = ctrlOf(el);
    expect(ctrl.$error['required']).toBe(true);
    expect(ctrl.$invalid).toBe(true);
    expect(el.classList.contains('ng-invalid-required')).toBe(true);
    expect(el.classList.contains('ng-valid-required')).toBe(false);

    const formCtrl = model($rootScope, 'f') as { $invalid: boolean; $valid: boolean };
    expect(formCtrl.$invalid).toBe(true);

    // Typing a value clears it.
    fireInput(el, 'x');
    expect(ctrl.$error['required']).toBeUndefined();
    expect(ctrl.$valid).toBe(true);
    expect(el.classList.contains('ng-valid-required')).toBe(true);
    expect(el.classList.contains('ng-invalid-required')).toBe(false);
    expect(formCtrl.$valid).toBe(true);
  });

  it('conditional ng-required toggles as its expression changes', () => {
    const { $compile, $rootScope } = boot();
    ($rootScope as unknown as Record<string, unknown>).need = false;
    const el = input(compile('<input ng-model="v" ng-required="need">', $compile, $rootScope));
    const ctrl = ctrlOf(el);

    // need=false → not required → empty is valid.
    expect(ctrl.$error['required']).toBeUndefined();
    expect(ctrl.$valid).toBe(true);

    // Flip need=true → now required → empty is invalid.
    ($rootScope as unknown as Record<string, unknown>).need = true;
    $rootScope.$digest();
    expect(ctrl.$error['required']).toBe(true);
    expect(ctrl.$invalid).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// length / pattern / email / url / min / max
// ────────────────────────────────────────────────────────────────────────────

describe('ng-minlength / ng-maxlength (FS §2.6)', () => {
  it('minlength fails when too short, passes when long enough', () => {
    const { $compile, $rootScope } = boot();
    const el = input(compile('<input ng-model="v" ng-minlength="3">', $compile, $rootScope));
    const ctrl = ctrlOf(el);

    fireInput(el, 'ab');
    expect(ctrl.$error['minlength']).toBe(true);
    expect(el.classList.contains('ng-invalid-minlength')).toBe(true);
    expect(model($rootScope, 'v')).toBeUndefined(); // invalid kept out of model

    fireInput(el, 'abc');
    expect(ctrl.$error['minlength']).toBeUndefined();
    expect(model($rootScope, 'v')).toBe('abc');
  });

  it('maxlength fails when too long', () => {
    const { $compile, $rootScope } = boot();
    const el = input(compile('<input ng-model="v" ng-maxlength="2">', $compile, $rootScope));
    const ctrl = ctrlOf(el);

    fireInput(el, 'abc');
    expect(ctrl.$error['maxlength']).toBe(true);
    fireInput(el, 'ab');
    expect(ctrl.$error['maxlength']).toBeUndefined();
    expect(model($rootScope, 'v')).toBe('ab');
  });

  it('re-validates when the ng-minlength expression changes', () => {
    const { $compile, $rootScope } = boot();
    ($rootScope as unknown as Record<string, unknown>).n = 2;
    const el = input(compile('<input ng-model="v" ng-minlength="n">', $compile, $rootScope));
    const ctrl = ctrlOf(el);

    fireInput(el, 'ab'); // length 2 passes with min 2
    expect(ctrl.$error['minlength']).toBeUndefined();

    // Raise the min to 3 → the current value (2) now fails.
    ($rootScope as unknown as Record<string, unknown>).n = 3;
    $rootScope.$digest();
    expect(ctrl.$error['minlength']).toBe(true);
  });
});

describe('pattern / ng-pattern (FS §2.6)', () => {
  it('ng-pattern with a regex literal fails on mismatch', () => {
    const { $compile, $rootScope } = boot();
    const el = input(compile('<input ng-model="v" ng-pattern="/^\\d+$/">', $compile, $rootScope));
    const ctrl = ctrlOf(el);

    fireInput(el, 'abc');
    expect(ctrl.$error['pattern']).toBe(true);
    expect(el.classList.contains('ng-invalid-pattern')).toBe(true);

    fireInput(el, '123');
    expect(ctrl.$error['pattern']).toBeUndefined();
    expect(model($rootScope, 'v')).toBe('123');
  });

  it('ng-pattern from a scope RegExp re-validates when it changes', () => {
    const { $compile, $rootScope } = boot();
    ($rootScope as unknown as Record<string, unknown>).re = /^a+$/;
    const el = input(compile('<input ng-model="v" ng-pattern="re">', $compile, $rootScope));
    const ctrl = ctrlOf(el);

    fireInput(el, 'aaa');
    expect(ctrl.$error['pattern']).toBeUndefined();
    fireInput(el, 'bbb');
    expect(ctrl.$error['pattern']).toBe(true);
  });
});

describe('email / url type validators (FS §2.6)', () => {
  it('email fails on a malformed address, passes on a valid one', () => {
    const { $compile, $rootScope } = boot();
    const el = input(compile('<input type="email" ng-model="v">', $compile, $rootScope));
    const ctrl = ctrlOf(el);

    fireInput(el, 'not-an-email');
    expect(ctrl.$error['email']).toBe(true);
    expect(el.classList.contains('ng-invalid-email')).toBe(true);
    expect(model($rootScope, 'v')).toBeUndefined();

    fireInput(el, 'ada@example.com');
    expect(ctrl.$error['email']).toBeUndefined();
    expect(model($rootScope, 'v')).toBe('ada@example.com');
  });

  it('url fails on a malformed URL', () => {
    const { $compile, $rootScope } = boot();
    const el = input(compile('<input type="url" ng-model="v">', $compile, $rootScope));
    const ctrl = ctrlOf(el);

    fireInput(el, 'nope');
    expect(ctrl.$error['url']).toBe(true);
    fireInput(el, 'https://example.com');
    expect(ctrl.$error['url']).toBeUndefined();
  });
});

describe('number min / max validators (FS §2.6)', () => {
  it('min fails below the bound, max fails above', () => {
    const { $compile, $rootScope } = boot();
    const el = input(compile('<input type="number" ng-model="v" min="5" max="10">', $compile, $rootScope));
    const ctrl = ctrlOf(el);

    fireInput(el, '3');
    expect(ctrl.$error['min']).toBe(true);
    expect(el.classList.contains('ng-invalid-min')).toBe(true);

    fireInput(el, '12');
    expect(ctrl.$error['min']).toBeUndefined();
    expect(ctrl.$error['max']).toBe(true);

    fireInput(el, '7');
    expect(ctrl.$error['min']).toBeUndefined();
    expect(ctrl.$error['max']).toBeUndefined();
    expect(model($rootScope, 'v')).toBe(7);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// custom sync validators
// ────────────────────────────────────────────────────────────────────────────

describe('custom $validators (FS §2.7)', () => {
  it('a custom sync rule flips validity under its key on every change', () => {
    const { $compile, $rootScope } = boot();
    const el = input(compile('<input ng-model="v">', $compile, $rootScope));
    const ctrl = ctrlOf(el);

    // "no digits allowed"
    ctrl.$validators['noDigits'] = (_m, viewValue) => !/\d/.test(typeof viewValue === 'string' ? viewValue : '');

    fireInput(el, 'abc1');
    expect(ctrl.$error['noDigits']).toBe(true);
    expect(el.classList.contains('ng-invalid-no-digits')).toBe(true); // dasherized key
    expect(model($rootScope, 'v')).toBeUndefined();

    fireInput(el, 'abc');
    expect(ctrl.$error['noDigits']).toBeUndefined();
    expect(model($rootScope, 'v')).toBe('abc');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// custom async validators + $pending + ng-pending
// ────────────────────────────────────────────────────────────────────────────

describe('custom $asyncValidators + $pending (FS §2.7)', () => {
  it('reports pending + ng-pending until settle; model written only on resolve', () => {
    const { $compile, $rootScope, $q } = boot();
    const el = input(compile('<input ng-model="v">', $compile, $rootScope));
    const ctrl = ctrlOf(el);

    let deferred: QDeferred<unknown> | undefined;
    ctrl.$asyncValidators['server'] = () => {
      deferred = $q.defer();
      return deferred.promise;
    };

    fireInput(el, 'abc');

    // Outstanding async → pending, ng-pending on, model NOT yet written.
    expect(ctrl.$pending?.['server']).toBe(true);
    expect(el.classList.contains('ng-pending')).toBe(true);
    expect(ctrl.$valid).toBe(false); // pending is neither valid nor invalid
    expect(ctrl.$invalid).toBe(false);
    expect(model($rootScope, 'v')).toBeUndefined();

    // Resolve → valid, pending cleared, model written.
    deferred?.resolve('ok');
    $rootScope.$digest();

    expect(ctrl.$pending).toBeUndefined();
    expect(el.classList.contains('ng-pending')).toBe(false);
    expect(ctrl.$valid).toBe(true);
    expect(model($rootScope, 'v')).toBe('abc');
  });

  it('a rejecting async rule marks the control invalid under its key', () => {
    const { $compile, $rootScope, $q } = boot();
    const el = input(compile('<input ng-model="v">', $compile, $rootScope));
    const ctrl = ctrlOf(el);

    let deferred: QDeferred<unknown> | undefined;
    ctrl.$asyncValidators['server'] = () => {
      deferred = $q.defer();
      return deferred.promise;
    };

    fireInput(el, 'abc');
    deferred?.reject('taken');
    $rootScope.$digest();

    expect(ctrl.$pending).toBeUndefined();
    expect(ctrl.$error['server']).toBe(true);
    expect(ctrl.$invalid).toBe(true);
    expect(model($rootScope, 'v')).toBeUndefined();
  });

  it('async runs ONLY after all sync validators pass', () => {
    const { $compile, $rootScope, $q } = boot();
    const el = input(compile('<input ng-model="v" ng-minlength="3">', $compile, $rootScope));
    const ctrl = ctrlOf(el);

    let asyncCalls = 0;
    ctrl.$asyncValidators['server'] = () => {
      asyncCalls += 1;
      return $q.resolve('ok');
    };

    // Too short → sync minlength fails → async must NOT run.
    fireInput(el, 'ab');
    expect(asyncCalls).toBe(0);
    expect(ctrl.$pending).toBeUndefined();

    // Long enough → sync passes → async runs.
    fireInput(el, 'abcd');
    expect(asyncCalls).toBe(1);
  });

  it('a stale async pass is cancelled by newer input (no stale validity write)', () => {
    const { $compile, $rootScope, $q } = boot();
    const el = input(compile('<input ng-model="v">', $compile, $rootScope));
    const ctrl = ctrlOf(el);

    const deferreds: QDeferred<unknown>[] = [];
    ctrl.$asyncValidators['server'] = () => {
      const d = $q.defer();
      deferreds.push(d);
      return d.promise;
    };

    fireInput(el, 'first'); // starts pass #1
    fireInput(el, 'second'); // starts pass #2 (bumps run id, cancels #1)

    // Resolve the STALE first pass — its validity write must be dropped.
    deferreds[0]?.resolve('ok');
    $rootScope.$digest();

    // Still pending on pass #2 (its deferred is unresolved), NOT valid.
    expect(ctrl.$pending?.['server']).toBe(true);
    expect(model($rootScope, 'v')).toBeUndefined();

    // Now settle pass #2.
    deferreds[1]?.resolve('ok');
    $rootScope.$digest();
    expect(ctrl.$pending).toBeUndefined();
    expect(ctrl.$valid).toBe(true);
    expect(model($rootScope, 'v')).toBe('second');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// programmatic $validate
// ────────────────────────────────────────────────────────────────────────────

describe('$validate (FS §2.7)', () => {
  it('re-runs validators against the current value on demand', () => {
    const { $compile, $rootScope } = boot();
    const el = input(compile('<input ng-model="v">', $compile, $rootScope));
    const ctrl = ctrlOf(el);

    fireInput(el, 'abc');
    expect(ctrl.$valid).toBe(true);

    // Add a rule AFTER the value was committed, then re-validate.
    ctrl.$validators['always'] = () => false;
    ctrl.$validate();

    expect(ctrl.$error['always']).toBe(true);
    expect(ctrl.$invalid).toBe(true);
    // A now-invalid value is withheld from the model on re-validation.
    expect(model($rootScope, 'v')).toBeUndefined();
  });
});
