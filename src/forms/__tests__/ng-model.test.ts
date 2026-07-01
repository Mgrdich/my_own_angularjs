/**
 * `ngModel` two-way binding + state + `ngChange` + `textarea` (spec 039
 * Slice 1).
 *
 * End-to-end through the canonical `ngModule` (via `bootstrapInjector`),
 * exercising the real `$compile` / `$rootScope` so the forms directives
 * registered by `src/core/ng-module.ts` are reachable. User input is
 * simulated by setting `element.value` and dispatching native `input` /
 * `change` / `blur` events, matching how a browser drives the control.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CompileService } from '@compiler/directive-types';
import type { Scope } from '@core/index';
import { bootstrapInjector } from '@bootstrap/index';
import { resetRegistry } from '@di/module';
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

describe('ngModel — registration', () => {
  it('registers ngModel / input / textarea / ngChange on ngModule', () => {
    const injector = bootstrapInjector([]);
    expect(injector.has('ngModelDirective')).toBe(true);
    expect(injector.has('inputDirective')).toBe(true);
    expect(injector.has('textareaDirective')).toBe(true);
    expect(injector.has('ngChangeDirective')).toBe(true);
  });
});

describe('ngModel — two-way binding (FS §2.1)', () => {
  it('typing into a text input updates a nested model path (intermediates created)', () => {
    const { $compile, $rootScope } = boot();
    const el = compile('<input type="text" ng-model="user.name">', $compile, $rootScope);
    const node = input(el);

    // Initially undefined model → empty value.
    expect(node.value).toBe('');

    fireInput(node, 'Ada');

    expect(($rootScope as unknown as { user: { name: string } }).user.name).toBe('Ada');
  });

  it('a model change in code re-renders the field', () => {
    const { $compile, $rootScope } = boot();
    const el = compile('<input type="text" ng-model="greeting">', $compile, $rootScope);
    const node = input(el);

    ($rootScope as unknown as { greeting: string }).greeting = 'hello';
    $rootScope.$digest();

    expect(node.value).toBe('hello');
  });

  it('deeply nested path round-trips both directions', () => {
    const { $compile, $rootScope } = boot();
    const el = compile('<input type="text" ng-model="a.b.c">', $compile, $rootScope);
    const node = input(el);

    fireInput(node, 'deep');
    expect(($rootScope as unknown as { a: { b: { c: string } } }).a.b.c).toBe('deep');

    ($rootScope as unknown as { a: { b: { c: string } } }).a.b.c = 'changed';
    $rootScope.$digest();
    expect(node.value).toBe('changed');
  });
});

describe('ngModel — non-assignable model routes "$compile"', () => {
  it('routes a non-assignable expression through $exceptionHandler (default → console.error)', () => {
    // The default `$exceptionHandler` is `consoleErrorExceptionHandler`,
    // so the non-assignable-model error surfaces via `console.error` with
    // cause `'$compile'`. Spying it is the observable proxy for the
    // routing contract; the directive goes inert (no model write, no
    // throw out of compile/link).
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { $compile, $rootScope } = boot();

    const el = document.createElement('div');
    el.innerHTML = '<input type="text" ng-model="a + b">';
    const node = el.firstElementChild as HTMLInputElement;
    expect(() => {
      $compile(node)($rootScope);
      $rootScope.$digest();
    }).not.toThrow();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('ngModel — dirty / pristine / touched transitions + classes (FS §2.2)', () => {
  it('fresh control is pristine + untouched + valid with matching classes', () => {
    const { $compile, $rootScope } = boot();
    const el = compile('<input type="text" ng-model="x">', $compile, $rootScope);

    expect(el.classList.contains('ng-pristine')).toBe(true);
    expect(el.classList.contains('ng-untouched')).toBe(true);
    expect(el.classList.contains('ng-valid')).toBe(true);
    expect(el.classList.contains('ng-dirty')).toBe(false);
  });

  it('typing marks the control dirty + toggles classes', () => {
    const { $compile, $rootScope } = boot();
    const el = compile('<input type="text" ng-model="x">', $compile, $rootScope);
    fireInput(input(el), 'typed');

    expect(el.classList.contains('ng-dirty')).toBe(true);
    expect(el.classList.contains('ng-pristine')).toBe(false);
  });

  it('$setPristine resets the control', () => {
    const { $compile, $rootScope } = boot();
    const el = compile('<input type="text" ng-model="x">', $compile, $rootScope);
    fireInput(input(el), 'typed');
    expect(el.classList.contains('ng-dirty')).toBe(true);

    const ctrl = readController(el);
    ctrl.$setPristine();
    expect(el.classList.contains('ng-pristine')).toBe(true);
    expect(el.classList.contains('ng-dirty')).toBe(false);
  });

  it('$setTouched / $setUntouched toggle the touched classes', () => {
    const { $compile, $rootScope } = boot();
    const el = compile('<input type="text" ng-model="x">', $compile, $rootScope);
    const ctrl = readController(el);

    ctrl.$setTouched();
    expect(el.classList.contains('ng-touched')).toBe(true);
    expect(el.classList.contains('ng-untouched')).toBe(false);

    ctrl.$setUntouched();
    expect(el.classList.contains('ng-untouched')).toBe(true);
    expect(el.classList.contains('ng-touched')).toBe(false);
  });
});

describe('ngModel — ng-empty / ng-not-empty (FS §2.2)', () => {
  it('reflects emptiness as the model changes', () => {
    const { $compile, $rootScope } = boot();
    const el = compile('<input type="text" ng-model="x">', $compile, $rootScope);

    // Empty model → ng-empty.
    expect(el.classList.contains('ng-empty')).toBe(true);
    expect(el.classList.contains('ng-not-empty')).toBe(false);

    fireInput(input(el), 'something');
    expect(el.classList.contains('ng-not-empty')).toBe(true);
    expect(el.classList.contains('ng-empty')).toBe(false);

    fireInput(input(el), '');
    expect(el.classList.contains('ng-empty')).toBe(true);
    expect(el.classList.contains('ng-not-empty')).toBe(false);
  });
});

describe('ngModel — $setValidity + per-rule classes (FS §2.2)', () => {
  it('toggles ng-valid-<key> / ng-invalid-<key> and aggregate validity', () => {
    const { $compile, $rootScope } = boot();
    const el = compile('<input type="text" ng-model="x">', $compile, $rootScope);
    const ctrl = readController(el);

    ctrl.$setValidity('required', false);
    expect(el.classList.contains('ng-invalid')).toBe(true);
    expect(el.classList.contains('ng-invalid-required')).toBe(true);
    expect(ctrl.$invalid).toBe(true);
    expect(ctrl.$error['required']).toBe(true);

    ctrl.$setValidity('required', true);
    expect(el.classList.contains('ng-valid')).toBe(true);
    expect(el.classList.contains('ng-valid-required')).toBe(true);
    expect(ctrl.$valid).toBe(true);
    expect('required' in ctrl.$error).toBe(false);
  });

  it('dasherizes a camelCase rule key', () => {
    const { $compile, $rootScope } = boot();
    const el = compile('<input type="text" ng-model="x">', $compile, $rootScope);
    const ctrl = readController(el);

    ctrl.$setValidity('myCustomRule', false);
    expect(el.classList.contains('ng-invalid-my-custom-rule')).toBe(true);
  });
});

describe('ngChange — fires on committed view change only (FS §2.5)', () => {
  it('fires on user input but NOT on a programmatic model change', () => {
    const { $compile, $rootScope } = boot();
    ($rootScope as unknown as { count: number }).count = 0;
    const el = compile('<input type="text" ng-model="x" ng-change="count = count + 1">', $compile, $rootScope);

    // Programmatic model change should NOT fire ngChange.
    ($rootScope as unknown as { x: string }).x = 'fromCode';
    $rootScope.$digest();
    expect(($rootScope as unknown as { count: number }).count).toBe(0);

    // User input SHOULD fire ngChange.
    fireInput(input(el), 'typed');
    expect(($rootScope as unknown as { count: number }).count).toBe(1);
  });
});

describe('textarea — binds a string', () => {
  it('two-way binds like a text input', () => {
    const { $compile, $rootScope } = boot();
    const el = compile('<textarea ng-model="notes"></textarea>', $compile, $rootScope);
    const node = el as unknown as HTMLTextAreaElement;

    ($rootScope as unknown as { notes: string }).notes = 'hi';
    $rootScope.$digest();
    expect(node.value).toBe('hi');

    node.value = 'edited';
    node.dispatchEvent(new Event('input'));
    expect(($rootScope as unknown as { notes: string }).notes).toBe('edited');
  });
});

function readController(el: HTMLElement): NgModelControllerImpl {
  // The controller is stashed on $$ngControllers under 'ngModel'.
  const map = (el as unknown as { $$ngControllers?: Map<string, unknown> }).$$ngControllers;
  const ctrl = map?.get('ngModel');
  if (!(ctrl instanceof NgModelControllerImpl)) {
    throw new Error('ngModel controller not found on element');
  }
  return ctrl;
}

// ────────────────────────────────────────────────────────────────────────────
// PR-audit regression — the model watch preserves a live parse error
// ────────────────────────────────────────────────────────────────────────────

describe('model watch — parse-error preservation (PR-audit regression)', () => {
  it('does not clear $error.parse when the model is set to the same rejected text', () => {
    const { $compile, $rootScope } = boot();
    const el = input(compile('<input ng-model="x">', $compile, $rootScope));
    const ctrl = readController(el);

    // A parser that rejects any value containing digits.
    ctrl.$parsers.push((v: unknown) => (typeof v === 'string' && /\d/.test(v) ? undefined : v));

    fireInput(el, 'abc123');
    expect(ctrl.$error['parse']).toBe(true);
    expect(($rootScope as unknown as Record<string, unknown>)['x']).toBeUndefined();

    // Programmatically writing the SAME rejected text onto the scope: the
    // formatted value equals what the view already shows, so `$render` is
    // skipped — and the live parse error must STAND (AngularJS
    // `ngModelWatch` parity: validators re-run only inside the render
    // branch).
    ($rootScope as unknown as Record<string, unknown>)['x'] = 'abc123';
    $rootScope.$digest();
    expect(ctrl.$error['parse']).toBe(true);
    expect(el.value).toBe('abc123');
  });
});
