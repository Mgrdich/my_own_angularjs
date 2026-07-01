/**
 * `FormController` + `form` / `ngForm` aggregation (spec 039 Slice 2).
 *
 * End-to-end through the canonical `ngModule` (via `bootstrapInjector`),
 * exercising the real `$compile` / `$rootScope` so the forms directives
 * registered by `src/core/ng-module.ts` are reachable. Control input is
 * simulated by setting `element.value` and dispatching native `input`
 * events; a submit is simulated by dispatching a native `submit` event on
 * the form element (matching how a browser drives the control).
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

function fireInput(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input'));
}

function formCtrl(el: HTMLElement): FormControllerImpl {
  const map = (el as unknown as { $$ngControllers?: Map<string, unknown> }).$$ngControllers;
  const ctrl = map?.get('form');
  if (!(ctrl instanceof FormControllerImpl)) {
    throw new Error('FormController not found on element');
  }
  return ctrl;
}

function modelCtrl(el: HTMLElement): NgModelControllerImpl {
  const map = (el as unknown as { $$ngControllers?: Map<string, unknown> }).$$ngControllers;
  const ctrl = map?.get('ngModel');
  if (!(ctrl instanceof NgModelControllerImpl)) {
    throw new Error('ngModel controller not found on element');
  }
  return ctrl;
}

describe('form — registration', () => {
  it('registers form / ngForm on ngModule', () => {
    const injector = bootstrapInjector([]);
    expect(injector.has('formDirective')).toBe(true);
    expect(injector.has('ngFormDirective')).toBe(true);
  });
});

describe('form — auto-creates a group (FS §2.3)', () => {
  it('a <form> becomes a form group with no extra attributes', () => {
    const { $compile, $rootScope } = boot();
    const form = compile('<form><input ng-model="a"></form>', $compile, $rootScope);
    expect(formCtrl(form)).toBeInstanceOf(FormControllerImpl);
    expect(form.classList.contains('ng-pristine')).toBe(true);
    expect(form.classList.contains('ng-valid')).toBe(true);
  });
});

describe('form — validity aggregation (FS §2.3)', () => {
  it('form is invalid iff any control is invalid', () => {
    const { $compile, $rootScope } = boot();
    const form = compile(
      '<form><input name="a" ng-model="a"><input name="b" ng-model="b"></form>',
      $compile,
      $rootScope,
    );
    const fc = formCtrl(form);
    const inputA = form.querySelectorAll('input')[0] as HTMLInputElement;

    expect(fc.$valid).toBe(true);

    // A control failing a rule makes the form invalid.
    modelCtrl(inputA).$setValidity('required', false);
    expect(fc.$invalid).toBe(true);
    expect(form.classList.contains('ng-invalid')).toBe(true);

    // Clearing the failure returns the form to valid.
    modelCtrl(inputA).$setValidity('required', true);
    expect(fc.$valid).toBe(true);
    expect(form.classList.contains('ng-valid')).toBe(true);
  });

  it('stays invalid while ANY control fails; valid only when all pass', () => {
    const { $compile, $rootScope } = boot();
    const form = compile(
      '<form><input name="a" ng-model="a"><input name="b" ng-model="b"></form>',
      $compile,
      $rootScope,
    );
    const fc = formCtrl(form);
    const inputs = form.querySelectorAll('input');
    const a = modelCtrl(inputs[0] as HTMLInputElement);
    const b = modelCtrl(inputs[1] as HTMLInputElement);

    a.$setValidity('required', false);
    b.$setValidity('required', false);
    expect(fc.$invalid).toBe(true);

    a.$setValidity('required', true);
    // b still fails → form still invalid.
    expect(fc.$invalid).toBe(true);

    b.$setValidity('required', true);
    expect(fc.$valid).toBe(true);
  });
});

describe('form — dirty aggregation (FS §2.3)', () => {
  it('form is dirty iff any control is dirty', () => {
    const { $compile, $rootScope } = boot();
    const form = compile('<form><input ng-model="a"></form>', $compile, $rootScope);
    const fc = formCtrl(form);
    const input = form.querySelector('input') as HTMLInputElement;

    expect(fc.$pristine).toBe(true);

    fireInput(input, 'typed');

    expect(fc.$dirty).toBe(true);
    expect(fc.$pristine).toBe(false);
    expect(form.classList.contains('ng-dirty')).toBe(true);
  });
});

describe('form — named form + named control in expressions (FS §2.3)', () => {
  it('a named form is reachable on scope; named controls read through it', () => {
    const { $compile, $rootScope } = boot();
    const form = compile('<form name="myForm"><input name="email" ng-model="email"></form>', $compile, $rootScope);
    const scope = $rootScope as unknown as { myForm: FormControllerImpl & { email: NgModelControllerImpl } };

    expect(scope.myForm).toBeInstanceOf(FormControllerImpl);
    expect(scope.myForm.email).toBeInstanceOf(NgModelControllerImpl);

    // `myForm.email.$invalid` reads correctly through the published form.
    const input = form.querySelector('input') as HTMLInputElement;
    modelCtrl(input).$setValidity('required', false);
    expect(scope.myForm.email.$invalid).toBe(true);
    expect(scope.myForm.$invalid).toBe(true);
  });
});

describe('form — nested ng-form bubbles validity to parent (FS §2.3)', () => {
  it('a nested ng-form contributes its validity up to the parent <form>', () => {
    const { $compile, $rootScope } = boot();
    const form = compile(
      '<form name="outer"><ng-form name="inner"><input name="x" ng-model="x"></ng-form></form>',
      $compile,
      $rootScope,
    );
    const outer = formCtrl(form);
    const innerEl = form.querySelector('ng-form') as HTMLElement;
    const innerMap = (innerEl as unknown as { $$ngControllers?: Map<string, unknown> }).$$ngControllers;
    const inner = innerMap?.get('ngForm') as FormControllerImpl;
    const input = form.querySelector('input') as HTMLInputElement;

    expect(outer.$valid).toBe(true);
    expect(inner).toBeInstanceOf(FormControllerImpl);

    modelCtrl(input).$setValidity('required', false);

    expect(inner.$invalid).toBe(true);
    expect(outer.$invalid).toBe(true);

    modelCtrl(input).$setValidity('required', true);
    expect(inner.$valid).toBe(true);
    expect(outer.$valid).toBe(true);
  });
});

describe('form — control removal drops its contribution (FS §2.3)', () => {
  it('destroying a control scope removes its contribution and the form returns to valid', () => {
    // A structural directive (`ng-if` / `ng-repeat`) removing a control
    // tears down the control's scope, firing the `ngModel` `$destroy`
    // listener that calls `form.$removeControl(...)`. We drive the SAME
    // teardown path here by compiling the form against a child scope and
    // destroying it — the exact hook `ng-if` triggers — which keeps the
    // test independent of the compiler's structural-directive internals.
    const { $compile, $rootScope } = boot();
    const child = $rootScope.$new();
    const host = document.createElement('div');
    host.innerHTML = '<form name="myForm"><input name="a" ng-model="a"></form>';
    const form = host.firstElementChild as HTMLElement;
    $compile(form)(child);
    child.$digest();

    const fc = formCtrl(form);
    const input = form.querySelector('input') as HTMLInputElement;

    // Make the control invalid → the form is invalid, and the named
    // control is reachable through the published form.
    modelCtrl(input).$setValidity('required', false);
    expect(fc.$invalid).toBe(true);
    expect('a' in (fc as unknown as Record<string, unknown>)).toBe(true);

    // Tear down the control's scope (what `ng-if` does on removal).
    child.$destroy();

    // The control (and its failure) is gone → the form is valid again,
    // and the named-control slot is cleared from the form instance.
    expect(fc.$valid).toBe(true);
    expect('a' in (fc as unknown as Record<string, unknown>)).toBe(false);
  });
});

describe('form — submit (FS §2.3)', () => {
  it('submit marks $submitted + ng-submitted + runs ng-submit with native submit suppressed', () => {
    const { $compile, $rootScope } = boot();
    ($rootScope as unknown as { submitted: number }).submitted = 0;
    const form = compile(
      '<form name="myForm" ng-submit="submitted = submitted + 1"><input ng-model="a"></form>',
      $compile,
      $rootScope,
    ) as HTMLFormElement;
    const fc = formCtrl(form);

    const event = new Event('submit', { cancelable: true });
    form.dispatchEvent(event);

    expect(fc.$submitted).toBe(true);
    expect(form.classList.contains('ng-submitted')).toBe(true);
    expect(($rootScope as unknown as { submitted: number }).submitted).toBe(1);
    // No `action` attribute → native submit suppressed.
    expect(event.defaultPrevented).toBe(true);
  });

  it('does NOT preventDefault when the form has an action', () => {
    const { $compile, $rootScope } = boot();
    const form = compile('<form action="/save"><input ng-model="a"></form>', $compile, $rootScope) as HTMLFormElement;

    const event = new Event('submit', { cancelable: true });
    form.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(formCtrl(form).$submitted).toBe(true);
  });
});

describe('form — programmatic state transitions (FS §2.3)', () => {
  it('$setPristine resets the form (and clears submitted)', () => {
    const { $compile, $rootScope } = boot();
    const form = compile('<form><input ng-model="a"></form>', $compile, $rootScope) as HTMLFormElement;
    const fc = formCtrl(form);
    const input = form.querySelector('input') as HTMLInputElement;

    fireInput(input, 'typed');
    fc.$setSubmitted();
    expect(fc.$dirty).toBe(true);
    expect(fc.$submitted).toBe(true);

    fc.$setPristine();
    expect(fc.$pristine).toBe(true);
    expect(fc.$dirty).toBe(false);
    expect(fc.$submitted).toBe(false);
    expect(form.classList.contains('ng-pristine')).toBe(true);
    expect(form.classList.contains('ng-submitted')).toBe(false);
  });

  it('$setSubmitted sets the submitted state + class', () => {
    const { $compile, $rootScope } = boot();
    const form = compile('<form><input ng-model="a"></form>', $compile, $rootScope) as HTMLFormElement;
    const fc = formCtrl(form);

    fc.$setSubmitted();
    expect(fc.$submitted).toBe(true);
    expect(form.classList.contains('ng-submitted')).toBe(true);
  });
});

describe('form — form-less ngModel still works via nullFormCtrl', () => {
  it('an ngModel with no enclosing form binds without throwing', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { $compile, $rootScope } = boot();
    const el = compile('<input type="text" ng-model="loose">', $compile, $rootScope) as HTMLInputElement;

    fireInput(el, 'value');
    expect(($rootScope as unknown as { loose: string }).loose).toBe('value');
    // No form-registration errors routed anywhere.
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PR-audit regression — a control inside a REAL ng-if registers with the form
// ────────────────────────────────────────────────────────────────────────────

describe('form — controls inside structural directives (PR-audit regression)', () => {
  it('an ng-model inside ng-if resolves the enclosing form (clone attaches BEFORE linking)', () => {
    const { $compile, $rootScope } = boot();
    const form = compile(
      '<form name="f"><div ng-if="show"><input name="i" ng-model="v" required></div></form>',
      $compile,
      $rootScope,
    );

    ($rootScope as unknown as Record<string, unknown>)['show'] = true;
    $rootScope.$digest();

    const fc = formCtrl(form);
    const el = form.querySelector('input') as HTMLInputElement;
    const ctrl = modelCtrl(el);

    // The clone was attached to the live DOM before linking, so the
    // `?^^form` require resolved the real form — the empty required
    // control makes the FORM invalid, and the named slot is published.
    expect(fc.$error['required']).toContain(ctrl);
    expect(fc.$invalid).toBe(true);
    expect((fc as unknown as Record<string, unknown>)['i']).toBe(ctrl);

    // Toggling the branch away removes the contribution again.
    ($rootScope as unknown as Record<string, unknown>)['show'] = false;
    $rootScope.$digest();
    expect(fc.$valid).toBe(true);
    expect((fc as unknown as Record<string, unknown>)['i']).toBeUndefined();
  });
});
