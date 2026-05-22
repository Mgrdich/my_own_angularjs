/**
 * `ngClassOdd` directive — integration tests (spec 024 Slice 2 /
 * FS §2.2).
 *
 * Mirror-inverse of `ng-class-even.test.ts`: same coverage, gated on
 * `scope.$odd` instead of `scope.$even`. Exercises:
 *
 * - Classes apply only when `scope.$odd` is truthy.
 * - Re-fire when `$odd` flips with the expression unchanged.
 * - Re-fire when the expression changes with `$odd` unchanged.
 * - Combined with `ng-class` on the same element.
 * - Tolerant outside `ng-repeat` (no `$odd` on the scope) — no error,
 *   no classes contributed.
 * - Classes-preserved guarantee under gating.
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

describe('ngClassOdd — registration on ngModule', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('injector.has("ngClassOddDirective") === true when "ng" is in the deps chain', () => {
    const injector = buildInjector();
    expect(injector.has('ngClassOddDirective')).toBe(true);
  });
});

describe('ngClassOdd — gated application (FS §2.2)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('applies the resolved class set when $odd is truthy', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.$odd = true;
    scope.activeFlag = true;

    const element = document.createElement('div');
    element.setAttribute('ng-class-odd', '{ active: activeFlag }');

    $compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('active')).toBe(true);
  });

  it('does NOT apply the class set when $odd is falsy', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.$odd = false;
    scope.activeFlag = true;

    const element = document.createElement('div');
    element.setAttribute('ng-class-odd', '{ active: activeFlag }');

    $compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('active')).toBe(false);
  });
});

describe('ngClassOdd — re-fire on gate flip (FS §2.2)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('applies classes after $odd flips from false to true (expression unchanged)', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.$odd = false;
    scope.activeFlag = true;

    const element = document.createElement('div');
    element.setAttribute('ng-class-odd', '{ active: activeFlag }');

    $compile(element)(scope);
    scope.$digest();
    expect(element.classList.contains('active')).toBe(false);

    scope.$odd = true;
    scope.$digest();
    expect(element.classList.contains('active')).toBe(true);
  });

  it('removes classes after $odd flips from true to false (expression unchanged)', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.$odd = true;
    scope.activeFlag = true;

    const element = document.createElement('div');
    element.setAttribute('ng-class-odd', '{ active: activeFlag }');

    $compile(element)(scope);
    scope.$digest();
    expect(element.classList.contains('active')).toBe(true);

    scope.$odd = false;
    scope.$digest();
    expect(element.classList.contains('active')).toBe(false);
  });
});

describe('ngClassOdd — re-fire on expression change (FS §2.2)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('updates the class set when the expression changes with $odd unchanged', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.$odd = true;
    scope.cls = 'a';

    const element = document.createElement('div');
    element.setAttribute('ng-class-odd', 'cls');

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

describe('ngClassOdd — combined with ngClass on the same element (FS §2.2)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('renders the union of both class sets when $odd is truthy, and only ng-class when falsy', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.$odd = true;

    const element = document.createElement('div');
    element.setAttribute('ng-class', "'always'");
    element.setAttribute('ng-class-odd', "'sometimes'");

    $compile(element)(scope);
    scope.$digest();
    expect(element.classList.contains('always')).toBe(true);
    expect(element.classList.contains('sometimes')).toBe(true);

    scope.$odd = false;
    scope.$digest();
    expect(element.classList.contains('always')).toBe(true);
    expect(element.classList.contains('sometimes')).toBe(false);
  });
});

describe('ngClassOdd — tolerant of missing $odd (FS §2.2)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('compiles and digests without error when $odd is undefined; contributes no classes', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();

    const element = document.createElement('div');
    element.setAttribute('ng-class-odd', "'gated'");

    expect(() => {
      $compile(element)(scope);
      scope.$digest();
    }).not.toThrow();

    expect(element.classList.contains('gated')).toBe(false);
  });
});

describe('ngClassOdd — classes-preserved guarantee under gating (FS §2.2)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('keeps consumer-shipped classes across gate flips and expression changes', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.$odd = true;
    scope.cls = 'highlighted';

    const element = document.createElement('div');
    element.setAttribute('class', 'card');
    element.setAttribute('ng-class-odd', 'cls');

    $compile(element)(scope);
    scope.$digest();
    expect(element.classList.contains('card')).toBe(true);
    expect(element.classList.contains('highlighted')).toBe(true);

    scope.$odd = false;
    scope.$digest();
    expect(element.classList.contains('card')).toBe(true);
    expect(element.classList.contains('highlighted')).toBe(false);

    scope.$odd = true;
    scope.$digest();
    expect(element.classList.contains('card')).toBe(true);
    expect(element.classList.contains('highlighted')).toBe(true);

    scope.cls = 'other';
    scope.$digest();
    expect(element.classList.contains('card')).toBe(true);
    expect(element.classList.contains('highlighted')).toBe(false);
    expect(element.classList.contains('other')).toBe(true);
  });
});
