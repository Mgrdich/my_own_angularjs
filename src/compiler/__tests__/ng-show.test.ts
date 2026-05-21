/**
 * `ngShow` directive — visibility toggle keyed on expression truthiness
 * (spec 023 Slice 4 / FS §2.1).
 *
 * Locks the AngularJS-canonical behavior for the built-in `ngShow`
 * directive registered on `ngModule`:
 *
 * - `ng-hide` CSS class ADDED when the expression is falsy.
 * - `ng-hide` CSS class REMOVED when the expression is truthy.
 * - Other classes on the element are preserved unchanged across toggles.
 * - Standard JavaScript truthiness — the literal string `'false'` is
 *   non-empty and therefore TRUTHY (no `ng-hide`).
 * - Toggles synchronously on every digest cycle when the underlying
 *   truthiness changes; animations are deferred to Phase 4.
 *
 * Tests use the canonical `ngModule` so the `ngShow` directive
 * registered by `src/core/ng-module.ts` is reachable end-to-end —
 * mirroring the `ng-bind.test.ts` and `ng-cloak.test.ts` bootstrap
 * patterns.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import { createTemplateCache } from '@template/template-cache';
import { createTemplateRequest } from '@template/template-request';
import type { TemplateCacheService, TemplateRequestFn } from '@template/template-types';

interface InjectorLike {
  has: (name: string) => boolean;
}

interface Bootstrap {
  $compile: CompileService;
  injector: InjectorLike;
}

function bootstrap(): Bootstrap {
  resetRegistry();
  createModule('ng', [])
    .factory('$exceptionHandler', [() => (): void => undefined])
    .provider('$sceDelegate', $SceDelegateProvider)
    .provider('$sce', $SceProvider)
    .provider('$interpolate', $InterpolateProvider)
    .provider('$filter', ['$provide', $FilterProvider])
    .factory('$templateCache', [() => createTemplateCache()])
    .factory('$templateRequest', [
      '$templateCache',
      (cache: TemplateCacheService): TemplateRequestFn => createTemplateRequest({ cache }),
    ])
    .provider('$compile', ['$provide', $CompileProvider]);

  const appModule = createModule('app', ['ng']);
  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get('$compile'),
    injector: built,
  };
}

afterEach(() => {
  resetRegistry();
});

describe('ngShow — registration on ngModule', () => {
  it('injector.has("ngShowDirective") === true when "ng" is in the deps chain', () => {
    const b = bootstrap();
    expect(b.injector.has('ngShowDirective')).toBe(true);
  });
});

describe('ngShow — ng-hide added when expression is falsy (FS §2.1)', () => {
  it('adds the ng-hide class on first digest when value is false', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.visible = false;

    const element = document.createElement('div');
    element.setAttribute('ng-show', 'visible');

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('ng-hide')).toBe(true);
  });
});

describe('ngShow — ng-hide removed when expression is truthy (FS §2.1)', () => {
  it('does not add the ng-hide class on first digest when value is true', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.visible = true;

    const element = document.createElement('div');
    element.setAttribute('ng-show', 'visible');

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('ng-hide')).toBe(false);
  });
});

describe('ngShow — toggles across digests when value flips', () => {
  it('flips the ng-hide class each time the expression truthiness changes', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.visible = true;

    const element = document.createElement('div');
    element.setAttribute('ng-show', 'visible');

    b.$compile(element)(scope);
    scope.$digest();
    expect(element.classList.contains('ng-hide')).toBe(false);

    scope.visible = false;
    scope.$digest();
    expect(element.classList.contains('ng-hide')).toBe(true);

    scope.visible = true;
    scope.$digest();
    expect(element.classList.contains('ng-hide')).toBe(false);

    scope.visible = false;
    scope.$digest();
    expect(element.classList.contains('ng-hide')).toBe(true);
  });
});

describe('ngShow — preserves other classes on the element', () => {
  it('keeps unrelated classes intact across multiple toggles', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.visible = true;

    const element = document.createElement('div');
    element.setAttribute('class', 'foo ng-show-target bar');
    element.setAttribute('ng-show', 'visible');

    b.$compile(element)(scope);
    scope.$digest();
    expect(element.classList.contains('foo')).toBe(true);
    expect(element.classList.contains('bar')).toBe(true);
    expect(element.classList.contains('ng-show-target')).toBe(true);
    expect(element.classList.contains('ng-hide')).toBe(false);

    scope.visible = false;
    scope.$digest();
    expect(element.classList.contains('foo')).toBe(true);
    expect(element.classList.contains('bar')).toBe(true);
    expect(element.classList.contains('ng-show-target')).toBe(true);
    expect(element.classList.contains('ng-hide')).toBe(true);

    scope.visible = true;
    scope.$digest();
    expect(element.classList.contains('foo')).toBe(true);
    expect(element.classList.contains('bar')).toBe(true);
    expect(element.classList.contains('ng-show-target')).toBe(true);
    expect(element.classList.contains('ng-hide')).toBe(false);
  });
});

describe('ngShow — falsy values add the ng-hide class', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['the number 0', 0],
    ['the empty string', ''],
    ['boolean false', false],
    ['NaN', Number.NaN],
  ])('adds ng-hide when the expression value is %s', (_label, value) => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.v = value;

    const element = document.createElement('div');
    element.setAttribute('ng-show', 'v');

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('ng-hide')).toBe(true);
  });
});

describe('ngShow — truthy values remove the ng-hide class', () => {
  it.each([
    ["the string 'false' (non-empty string is truthy in JS)", 'false'],
    ['a non-empty array', [1, 2, 3]],
    ['a non-empty object', { a: 1 }],
    ['the number 1', 1],
    ['boolean true', true],
    ['a non-empty string', 'hello'],
  ])('does not add ng-hide when the expression value is %s', (_label, value) => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.v = value;

    // Seed the element WITH the ng-hide class so we can prove it gets
    // removed (rather than relying on its absence at the start).
    const element = document.createElement('div');
    element.setAttribute('class', 'ng-hide');
    element.setAttribute('ng-show', 'v');

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('ng-hide')).toBe(false);
  });
});
