/**
 * `ngClassEven` directive — integration tests (spec 024 Slice 2 /
 * FS §2.2).
 *
 * Exercises the built-in `ngClassEven` directive end-to-end through
 * real `$compile`, against the canonical `ngModule`. Locks the
 * AngularJS-canonical behavior:
 *
 * - Classes apply only when `scope.$even` is truthy.
 * - Re-fire when `$even` flips with the expression unchanged — the
 *   secondary `scope.$watch('$even', …)` that `installClassWatcher`
 *   installs when a `gateProperty` is supplied.
 * - Re-fire when the expression changes with `$even` unchanged — the
 *   standard `$watchCollection` path is unaffected by the gate
 *   plumbing.
 * - Combined with `ng-class` on the same element — each instance
 *   contributes its own class set; the rendered set is the union.
 * - Outside `ng-repeat` (no `$even` on the scope) — no error, no
 *   classes contributed.
 * - Classes-preserved guarantee is intact when the directive is
 *   gated (consumer-shipped classes never enter the tracking set).
 *
 * Bootstrap reuses the shared `bootstrapNgModule` helper — same
 * pattern as `ng-class.test.ts` from Slice 1.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CompileService } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';

import { bootstrapNgModule } from './test-helpers';

interface InjectorLike {
  has: (name: string) => boolean;
  get: (name: string) => unknown;
}

function buildInjector(): InjectorLike {
  const appModule = createModule('app', ['ng']);
  return createInjector([ngModule, appModule]);
}

function compileFromNg(): { $compile: CompileService } {
  return { $compile: buildInjector().get('$compile') as CompileService };
}

afterEach(() => {
  resetRegistry();
});

describe('ngClassEven — registration on ngModule', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('injector.has("ngClassEvenDirective") === true when "ng" is in the deps chain', () => {
    const injector = buildInjector();
    expect(injector.has('ngClassEvenDirective')).toBe(true);
  });
});

describe('ngClassEven — gated application (FS §2.2)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('applies the resolved class set when $even is truthy', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.$even = true;
    scope.activeFlag = true;

    const element = document.createElement('div');
    element.setAttribute('ng-class-even', '{ active: activeFlag }');

    $compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('active')).toBe(true);
  });

  it('does NOT apply the class set when $even is falsy', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.$even = false;
    scope.activeFlag = true;

    const element = document.createElement('div');
    element.setAttribute('ng-class-even', '{ active: activeFlag }');

    $compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('active')).toBe(false);
  });
});

describe('ngClassEven — re-fire on gate flip (FS §2.2)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('applies classes after $even flips from false to true (expression unchanged)', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.$even = false;
    scope.activeFlag = true;

    const element = document.createElement('div');
    element.setAttribute('ng-class-even', '{ active: activeFlag }');

    $compile(element)(scope);
    scope.$digest();
    expect(element.classList.contains('active')).toBe(false);

    scope.$even = true;
    scope.$digest();
    expect(element.classList.contains('active')).toBe(true);
  });

  it('removes classes after $even flips from true to false (expression unchanged)', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.$even = true;
    scope.activeFlag = true;

    const element = document.createElement('div');
    element.setAttribute('ng-class-even', '{ active: activeFlag }');

    $compile(element)(scope);
    scope.$digest();
    expect(element.classList.contains('active')).toBe(true);

    scope.$even = false;
    scope.$digest();
    expect(element.classList.contains('active')).toBe(false);
  });
});

describe('ngClassEven — re-fire on expression change (FS §2.2)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('updates the class set when the expression changes with $even unchanged', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.$even = true;
    scope.cls = 'a';

    const element = document.createElement('div');
    element.setAttribute('ng-class-even', 'cls');

    $compile(element)(scope);
    scope.$digest();
    expect(element.classList.contains('a')).toBe(true);
    expect(element.classList.contains('b')).toBe(false);

    scope.cls = 'b';
    scope.$digest();
    expect(element.classList.contains('a')).toBe(false);
    expect(element.classList.contains('b')).toBe(true);
  });
});

describe('ngClassEven — combined with ngClass on the same element (FS §2.2)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('renders the union of both class sets when $even is truthy, and only ng-class when falsy', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.$even = true;

    const element = document.createElement('div');
    element.setAttribute('ng-class', "'always'");
    element.setAttribute('ng-class-even', "'sometimes'");

    $compile(element)(scope);
    scope.$digest();
    expect(element.classList.contains('always')).toBe(true);
    expect(element.classList.contains('sometimes')).toBe(true);

    // Flip $even off — `sometimes` should leave, `always` should stay.
    scope.$even = false;
    scope.$digest();
    expect(element.classList.contains('always')).toBe(true);
    expect(element.classList.contains('sometimes')).toBe(false);
  });
});

describe('ngClassEven — tolerant of missing $even (FS §2.2)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('compiles and digests without error when $even is undefined; contributes no classes', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    // No `$even` on the scope at all — outside the `ng-repeat`
    // context. The gate predicate evaluates `!!undefined === false`
    // and the directive contributes no classes.

    const element = document.createElement('div');
    element.setAttribute('ng-class-even', "'gated'");

    expect(() => {
      $compile(element)(scope);
      scope.$digest();
    }).not.toThrow();

    expect(element.classList.contains('gated')).toBe(false);
  });
});

describe('ngClassEven — classes-preserved guarantee under gating (FS §2.2)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('keeps consumer-shipped classes across gate flips and expression changes', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.$even = true;
    scope.cls = 'highlighted';

    const element = document.createElement('div');
    element.setAttribute('class', 'card');
    element.setAttribute('ng-class-even', 'cls');

    $compile(element)(scope);
    scope.$digest();
    expect(element.classList.contains('card')).toBe(true);
    expect(element.classList.contains('highlighted')).toBe(true);

    // Flip gate off — `highlighted` leaves, `card` stays.
    scope.$even = false;
    scope.$digest();
    expect(element.classList.contains('card')).toBe(true);
    expect(element.classList.contains('highlighted')).toBe(false);

    // Flip gate back on — `highlighted` returns, `card` still present.
    scope.$even = true;
    scope.$digest();
    expect(element.classList.contains('card')).toBe(true);
    expect(element.classList.contains('highlighted')).toBe(true);

    // Change the expression with the gate on — `card` survives.
    scope.cls = 'other';
    scope.$digest();
    expect(element.classList.contains('card')).toBe(true);
    expect(element.classList.contains('highlighted')).toBe(false);
    expect(element.classList.contains('other')).toBe(true);
  });
});
