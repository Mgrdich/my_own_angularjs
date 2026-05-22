/**
 * `ngBind` directive — single-expression text binding
 * (spec 023 Slice 3 / FS §2.3).
 *
 * Locks the AngularJS-canonical behavior for the built-in `ngBind`
 * directive registered on `ngModule`:
 *
 * - `textContent` set from the expression on first digest, updated on
 *   subsequent digests when the value changes.
 * - `null` / `undefined` render as the empty string.
 * - Non-string values are coerced via `String(value)`.
 * - HTML special characters appear LITERALLY — `textContent` does not
 *   parse markup. (Security-relevant difference from `ngBindHtml`.)
 *
 * Tests use the canonical `ngModule` so the `ngBind` directive
 * registered by `src/core/ng-module.ts` is reachable end-to-end —
 * mirroring the `ng-cloak.test.ts` and `ng-transclude.test.ts` bootstrap
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

describe('ngBind — registration on ngModule', () => {
  it('injector.has("ngBindDirective") === true when "ng" is in the deps chain', () => {
    const b = bootstrap();
    expect(b.injector.has('ngBindDirective')).toBe(true);
  });
});

describe('ngBind — textContent set from the expression (FS §2.3)', () => {
  it('sets textContent to the current value of the expression after the first digest', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.greeting = 'hi';

    const element = document.createElement('span');
    element.setAttribute('ng-bind', 'greeting');

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('hi');
  });
});

describe('ngBind — updates on digest when the value changes', () => {
  it('writes the new value to textContent on the next digest', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.greeting = 'hi';

    const element = document.createElement('span');
    element.setAttribute('ng-bind', 'greeting');

    b.$compile(element)(scope);
    scope.$digest();
    expect(element.textContent).toBe('hi');

    scope.greeting = 'bye';
    scope.$digest();
    expect(element.textContent).toBe('bye');
  });
});

describe('ngBind — null / undefined render as empty string (FS §2.3)', () => {
  it('renders null as the empty string (no literal "null")', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.value = null;

    const element = document.createElement('span');
    element.setAttribute('ng-bind', 'value');

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('');
  });

  it('renders undefined as the empty string (no literal "undefined")', () => {
    const b = bootstrap();
    const scope = Scope.create();
    // Intentionally don't assign — `scope.value` is `undefined`.

    const element = document.createElement('span');
    element.setAttribute('ng-bind', 'value');

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('');
  });
});

describe('ngBind — number coercion (FS §2.3)', () => {
  it('stringifies numbers via String(value)', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.n = 42;

    const element = document.createElement('span');
    element.setAttribute('ng-bind', 'n');

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('42');
  });
});

describe('ngBind — boolean coercion (FS §2.3)', () => {
  it('stringifies true / false via String(value)', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.b = true;

    const element = document.createElement('span');
    element.setAttribute('ng-bind', 'b');

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('true');

    scope.b = false;
    scope.$digest();
    expect(element.textContent).toBe('false');
  });
});

describe('ngBind — HTML special characters are escaped (FS §2.3 security guarantee)', () => {
  it('renders < > & literally and does NOT create a real <script> element', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.html = '<script>alert(1)</script>';

    const element = document.createElement('span');
    element.setAttribute('ng-bind', 'html');

    b.$compile(element)(scope);
    scope.$digest();

    // `textContent` returns the raw text — the < and > round-trip
    // exactly. No script element is interpreted from the string.
    expect(element.textContent).toBe('<script>alert(1)</script>');

    // `innerHTML` shows the escaped form, confirming the browser sees
    // literal text (the `<` is encoded as `&lt;`, the `>` as `&gt;`).
    expect(element.innerHTML).toContain('&lt;script&gt;');
    expect(element.innerHTML).toContain('&lt;/script&gt;');

    // Definitive check — no real <script> element was created in
    // the DOM tree by the directive.
    expect(element.querySelector('script')).toBeNull();
  });
});

describe('ngBind — multiple sibling bindings work independently', () => {
  it('updates each ng-bind sibling on its own watch', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.a = 'alpha';
    scope.b = 'beta';
    scope.c = 'gamma';

    const root = document.createElement('div');
    root.innerHTML = '<span ng-bind="a"></span>' + '<span ng-bind="b"></span>' + '<span ng-bind="c"></span>';

    b.$compile(root)(scope);
    scope.$digest();

    const spans = root.querySelectorAll('span');
    expect(spans).toHaveLength(3);
    expect(spans[0]?.textContent).toBe('alpha');
    expect(spans[1]?.textContent).toBe('beta');
    expect(spans[2]?.textContent).toBe('gamma');

    // Change only the middle binding — the other two stay stable.
    scope.b = 'BETA';
    scope.$digest();

    expect(spans[0]?.textContent).toBe('alpha');
    expect(spans[1]?.textContent).toBe('BETA');
    expect(spans[2]?.textContent).toBe('gamma');
  });
});
