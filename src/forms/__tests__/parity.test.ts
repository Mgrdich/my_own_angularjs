/**
 * Parity hardening — remaining upstream `ngModelSpec.js` / `formSpec.js`
 * edge-case vectors not already covered by Slices 1–6 (spec 039 Slice 7).
 *
 * These port behaviors from AngularJS's own directive specs that the
 * per-slice suites did not exercise directly:
 *
 *  - `$setDirty` / `$setPristine` propagation through nested forms;
 *  - `$rollbackViewValue` restoring a buffered value;
 *  - `$parsers` / `$formatters` ORDERING (parsers forward, formatters
 *    reverse);
 *  - a `$isEmpty` override changing `required` / `ng-empty`;
 *  - form / control re-name via `$$renameControl`;
 *  - `$commitViewValue` no-op on an unchanged value;
 *  - a failing parser short-circuiting the chain (`parse` key);
 *  - the model→view feedback guard not double-firing view-change listeners.
 *
 * End-to-end through the canonical `ngModule` (via `bootstrapInjector`) so the
 * real `$compile` / `$rootScope` / `$q` back the assertions.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CompileService } from '@compiler/directive-types';
import type { Scope } from '@core/index';
import { bootstrapInjector } from '@bootstrap/index';
import { resetRegistry } from '@di/module';
import { FormControllerImpl } from '@forms/form-controller';
import { NgModelControllerImpl } from '@forms/ng-model-controller';

interface Harness {
  $compile: CompileService;
  $rootScope: Scope;
}

function boot(): Harness {
  const injector = bootstrapInjector([]);
  return {
    $compile: injector.get('$compile'),
    $rootScope: injector.get('$rootScope'),
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

/** Pull the published `FormController` off a form element's controller stash. */
function formOf(el: HTMLElement): FormControllerImpl {
  const stash = (el as unknown as { $$ngControllers?: Map<string, unknown> }).$$ngControllers;
  const ctrl = stash?.get('form');
  if (!(ctrl instanceof FormControllerImpl)) {
    throw new Error('no FormController on element');
  }
  return ctrl;
}

function scopeVal(scope: Scope, key: string): unknown {
  return (scope as unknown as Record<string, unknown>)[key];
}

// ────────────────────────────────────────────────────────────────────────────
// $setDirty / $setPristine propagation (ngModelSpec.js / formSpec.js)
// ────────────────────────────────────────────────────────────────────────────

describe('$setDirty / $setPristine propagation (parity)', () => {
  it('a control going dirty propagates up through a nested form to the outer form', () => {
    const { $compile, $rootScope } = boot();
    const outer = compile(
      '<form name="outer"><ng-form name="inner"><input name="i" ng-model="v"></ng-form></form>',
      $compile,
      $rootScope,
    );
    const outerCtrl = formOf(outer);
    const el = input(outer.querySelector('input') as HTMLElement);

    // Fresh: both forms pristine.
    expect(outerCtrl.$pristine).toBe(true);

    fireInput(el, 'x');

    // The control's $setDirty bubbles: inner form + outer form both dirty.
    const innerCtrl = scopeVal($rootScope, 'inner') as FormControllerImpl;
    expect(innerCtrl.$dirty).toBe(true);
    expect(outerCtrl.$dirty).toBe(true);
    expect(outerCtrl.$pristine).toBe(false);
    expect(outer.classList.contains('ng-dirty')).toBe(true);
  });

  it('form.$setPristine fans out to every registered control and nested form', () => {
    const { $compile, $rootScope } = boot();
    const outer = compile(
      '<form name="outer"><input name="a" ng-model="a"><ng-form name="inner"><input name="b" ng-model="b"></ng-form></form>',
      $compile,
      $rootScope,
    );
    const outerCtrl = formOf(outer);
    const [elA, elB] = Array.from(outer.querySelectorAll('input')).map((n) => input(n as HTMLElement));

    fireInput(elA as HTMLInputElement, 'x');
    fireInput(elB as HTMLInputElement, 'y');
    expect(outerCtrl.$dirty).toBe(true);
    expect(ctrlOf(elA as HTMLElement).$dirty).toBe(true);
    expect(ctrlOf(elB as HTMLElement).$dirty).toBe(true);

    // Reset the outer form → every control + the nested form returns pristine.
    outerCtrl.$setPristine();
    expect(outerCtrl.$pristine).toBe(true);
    expect(ctrlOf(elA as HTMLElement).$pristine).toBe(true);
    expect(ctrlOf(elB as HTMLElement).$pristine).toBe(true);
    const innerCtrl = scopeVal($rootScope, 'inner') as FormControllerImpl;
    expect(innerCtrl.$pristine).toBe(true);
  });

  it('$setPristine on a form also clears $submitted (parity)', () => {
    const { $compile, $rootScope } = boot();
    const form = compile('<form name="f"><input name="i" ng-model="v"></form>', $compile, $rootScope);
    const ctrl = formOf(form);
    ctrl.$setSubmitted();
    expect(ctrl.$submitted).toBe(true);
    expect(form.classList.contains('ng-submitted')).toBe(true);

    ctrl.$setPristine();
    expect(ctrl.$submitted).toBe(false);
    expect(form.classList.contains('ng-submitted')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// $rollbackViewValue (ngModelSpec.js)
// ────────────────────────────────────────────────────────────────────────────

describe('$rollbackViewValue (parity)', () => {
  it('reverts an uncommitted view value to the last committed one and re-renders', () => {
    const { $compile, $rootScope } = boot();
    const el = input(compile('<input ng-model="v" ng-model-options="{ updateOn: \'blur\' }">', $compile, $rootScope));
    const ctrl = ctrlOf(el);

    // Commit an initial value on blur.
    el.value = 'first';
    el.dispatchEvent(new Event('blur'));
    expect(scopeVal($rootScope, 'v')).toBe('first');

    // Type more without committing (updateOn:blur buffers on input).
    fireInput(el, 'second-uncommitted');
    // The model is still the committed value.
    expect(scopeVal($rootScope, 'v')).toBe('first');

    // Rollback discards the buffer and re-renders the committed value.
    ctrl.$rollbackViewValue();
    expect(el.value).toBe('first');
    expect(ctrl.$viewValue).toBe('first');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// $parsers / $formatters ordering (ngModelSpec.js)
// ────────────────────────────────────────────────────────────────────────────

describe('$parsers / $formatters ordering (parity)', () => {
  it('$parsers run in REGISTRATION order (view → model)', () => {
    const { $compile, $rootScope } = boot();
    const el = input(compile('<input ng-model="v">', $compile, $rootScope));
    const ctrl = ctrlOf(el);
    const order: string[] = [];

    ctrl.$parsers.push((value) => {
      order.push('first');
      return `${String(value)}|1`;
    });
    ctrl.$parsers.push((value) => {
      order.push('second');
      return `${String(value)}|2`;
    });

    fireInput(el, 'x');
    expect(order).toEqual(['first', 'second']);
    // Both parsers ran in order, appending in sequence.
    expect(scopeVal($rootScope, 'v')).toBe('x|1|2');
  });

  it('$formatters run in REVERSE registration order (model → view)', () => {
    const { $compile, $rootScope } = boot();
    const el = input(compile('<input ng-model="v">', $compile, $rootScope));
    const ctrl = ctrlOf(el);
    const order: string[] = [];

    ctrl.$formatters.push((value) => {
      order.push('first');
      return `${String(value)}|a`;
    });
    ctrl.$formatters.push((value) => {
      order.push('second');
      return `${String(value)}|b`;
    });

    ($rootScope as unknown as Record<string, unknown>).v = 'model';
    $rootScope.$digest();

    // Reverse order: the LAST-registered formatter runs FIRST.
    expect(order).toEqual(['second', 'first']);
    expect(el.value).toBe('model|b|a');
  });

  it('a $parser returning undefined short-circuits the chain and fails the parse key', () => {
    const { $compile, $rootScope } = boot();
    const el = input(compile('<input ng-model="v">', $compile, $rootScope));
    const ctrl = ctrlOf(el);
    let secondRan = false;

    ctrl.$parsers.push(() => undefined);
    ctrl.$parsers.push((value) => {
      secondRan = true;
      return value;
    });

    fireInput(el, 'x');
    // The second parser never ran (short-circuit), and the bad parse keeps
    // the value out of the model + fails the `parse` validity key.
    expect(secondRan).toBe(false);
    expect(scopeVal($rootScope, 'v')).toBeUndefined();
    expect(ctrl.$error['parse']).toBe(true);
    expect(ctrl.$invalid).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// $isEmpty overrides (ngModelSpec.js)
// ────────────────────────────────────────────────────────────────────────────

describe('$isEmpty override (parity)', () => {
  it('a custom $isEmpty drives ng-empty and required', () => {
    const { $compile, $rootScope } = boot();
    const el = input(compile('<input ng-model="v" required>', $compile, $rootScope));
    const ctrl = ctrlOf(el);

    // Override: only the literal string "empty" counts as empty.
    ctrl.$isEmpty = (value: unknown): boolean => value === 'empty';

    // Typing "empty" → required fails, ng-empty on.
    fireInput(el, 'empty');
    expect(ctrl.$error['required']).toBe(true);
    expect(el.classList.contains('ng-empty')).toBe(true);

    // Typing a normal value → not empty, required passes.
    fireInput(el, 'real');
    expect(ctrl.$error['required']).toBeUndefined();
    expect(el.classList.contains('ng-not-empty')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Control / form re-name via $$renameControl (formSpec.js)
// ────────────────────────────────────────────────────────────────────────────

describe('$$renameControl (parity)', () => {
  it('renaming a control updates its $name', () => {
    const { $compile, $rootScope } = boot();
    const form = compile('<form name="f"><input name="a" ng-model="v"></form>', $compile, $rootScope);
    const formCtrl = formOf(form);
    const ctrl = ctrlOf(input(form.querySelector('input') as HTMLElement));

    expect(ctrl.$name).toBe('a');
    formCtrl.$$renameControl(ctrl, 'renamed');
    expect(ctrl.$name).toBe('renamed');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// $commitViewValue no-op on unchanged value (ngModelSpec.js)
// ────────────────────────────────────────────────────────────────────────────

describe('$commitViewValue / view-change listeners (parity)', () => {
  it('re-committing the same view value does not re-fire $viewChangeListeners', () => {
    const { $compile, $rootScope } = boot();
    const el = input(compile('<input ng-model="v">', $compile, $rootScope));
    const ctrl = ctrlOf(el);
    const spy = vi.fn();
    ctrl.$viewChangeListeners.push(spy);

    fireInput(el, 'x');
    expect(spy).toHaveBeenCalledTimes(1);

    // Committing the identical value again is a no-op — no listener re-fire.
    ctrl.$setViewValue('x');
    ctrl.$commitViewValue();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a programmatic model change re-renders WITHOUT firing view-change listeners', () => {
    const { $compile, $rootScope } = boot();
    const el = input(compile('<input ng-model="v">', $compile, $rootScope));
    const ctrl = ctrlOf(el);
    const spy = vi.fn();
    ctrl.$viewChangeListeners.push(spy);

    // Change the model in code — the view re-renders but ngChange-style
    // listeners fire ONLY on committed USER input (FS §2.5).
    ($rootScope as unknown as Record<string, unknown>).v = 'fromCode';
    $rootScope.$digest();
    expect(el.value).toBe('fromCode');
    expect(spy).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Programmatic state transitions (ngModelSpec.js)
// ────────────────────────────────────────────────────────────────────────────

describe('programmatic control state (parity)', () => {
  it('$setTouched / $setUntouched toggle the touched classes', () => {
    const { $compile, $rootScope } = boot();
    const el = input(compile('<input ng-model="v">', $compile, $rootScope));
    const ctrl = ctrlOf(el);

    expect(ctrl.$untouched).toBe(true);
    expect(el.classList.contains('ng-untouched')).toBe(true);

    ctrl.$setTouched();
    expect(ctrl.$touched).toBe(true);
    expect(el.classList.contains('ng-touched')).toBe(true);
    expect(el.classList.contains('ng-untouched')).toBe(false);

    ctrl.$setUntouched();
    expect(ctrl.$untouched).toBe(true);
    expect(el.classList.contains('ng-untouched')).toBe(true);
  });

  it('$setDirty / $setPristine toggle the dirty classes on the control', () => {
    const { $compile, $rootScope } = boot();
    const el = input(compile('<input ng-model="v">', $compile, $rootScope));
    const ctrl = ctrlOf(el);

    expect(ctrl.$pristine).toBe(true);
    ctrl.$setDirty();
    expect(ctrl.$dirty).toBe(true);
    expect(el.classList.contains('ng-dirty')).toBe(true);

    ctrl.$setPristine();
    expect(ctrl.$pristine).toBe(true);
    expect(el.classList.contains('ng-pristine')).toBe(true);
    expect(el.classList.contains('ng-dirty')).toBe(false);
  });
});
