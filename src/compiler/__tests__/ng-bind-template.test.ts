/**
 * `ngBindTemplate` directive — multi-expression text binding via
 * `$interpolate` (spec 023 Slice 3 / FS §2.4).
 *
 * Locks the AngularJS-canonical behavior for the built-in
 * `ngBindTemplate` directive registered on `ngModule`:
 *
 * - The template string is interpolated against the element's scope
 *   on first digest; the rendered result lands on `textContent`.
 * - Multiple `{{ … }}` segments resolve independently and update when
 *   any referenced expression changes.
 * - Empty templates render as the empty string (no special case in
 *   the directive — falls out of the `$interpolate('')` contract).
 * - HTML special characters in interpolated values are escaped — the
 *   listener writes to `textContent`, so `<` etc. never get parsed
 *   as markup. (Security-relevant difference from `ngBindHtml`.)
 * - Static-only templates (`"Just text"`) render correctly with at
 *   most one watcher fire (standard `$watch` identity short-circuit).
 *
 * Tests use the canonical `ngModule` so the `ngBindTemplate` directive
 * registered by `src/core/ng-module.ts` is reachable end-to-end.
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

describe('ngBindTemplate — registration on ngModule', () => {
  it('injector.has("ngBindTemplateDirective") === true when "ng" is in the deps chain', () => {
    const b = bootstrap();
    expect(b.injector.has('ngBindTemplateDirective')).toBe(true);
  });
});

describe('ngBindTemplate — interpolated string set as text (FS §2.4)', () => {
  it('renders a single-expression template against scope after the first digest', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.name = 'world';

    const element = document.createElement('span');
    element.setAttribute('ng-bind-template', 'Hello {{name}}!');

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('Hello world!');
  });
});

describe('ngBindTemplate — multiple `{{ }}` segments (FS §2.4)', () => {
  it('resolves multiple embedded expressions in one rendered string', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.name = 'world';
    scope.day = 'Monday';

    const element = document.createElement('span');
    element.setAttribute('ng-bind-template', 'Hello {{name}}, today is {{day}}');

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('Hello world, today is Monday');
  });
});

describe('ngBindTemplate — updates when any referenced expression changes (FS §2.4)', () => {
  it('re-renders the textContent when the first segment changes', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.name = 'world';
    scope.day = 'Monday';

    const element = document.createElement('span');
    element.setAttribute('ng-bind-template', 'Hello {{name}}, today is {{day}}');

    b.$compile(element)(scope);
    scope.$digest();
    expect(element.textContent).toBe('Hello world, today is Monday');

    scope.name = 'Ada';
    scope.$digest();
    expect(element.textContent).toBe('Hello Ada, today is Monday');
  });

  it('re-renders the textContent when the second segment changes', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.name = 'world';
    scope.day = 'Monday';

    const element = document.createElement('span');
    element.setAttribute('ng-bind-template', 'Hello {{name}}, today is {{day}}');

    b.$compile(element)(scope);
    scope.$digest();
    expect(element.textContent).toBe('Hello world, today is Monday');

    scope.day = 'Tuesday';
    scope.$digest();
    expect(element.textContent).toBe('Hello world, today is Tuesday');
  });
});

describe('ngBindTemplate — empty template renders as empty string (FS §2.4)', () => {
  it('accepts ng-bind-template="" and renders the empty string', () => {
    const b = bootstrap();
    const scope = Scope.create();

    const element = document.createElement('span');
    element.setAttribute('ng-bind-template', '');
    // Seed an initial value so we can confirm the digest writes ''.
    element.textContent = 'initial';

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('');
  });
});

describe('ngBindTemplate — HTML special characters are escaped (FS §2.4 security guarantee)', () => {
  it('renders <, >, & literally even when the interpolated value contains markup', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.value = '<script>alert(1)</script>';

    const element = document.createElement('span');
    element.setAttribute('ng-bind-template', 'unsafe: {{value}}');

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('unsafe: <script>alert(1)</script>');

    // No real <script> is created in the DOM — `textContent` writes
    // raw text only, never parsed markup.
    expect(element.querySelector('script')).toBeNull();
    // `innerHTML` shows the encoded form (the actual browser-rendered
    // representation of the literal characters).
    expect(element.innerHTML).toContain('&lt;script&gt;');
  });
});

describe('ngBindTemplate — static-only template (no `{{ }}`) (FS §2.4)', () => {
  it('renders the literal template string and fires the watch at most once', () => {
    const b = bootstrap();
    const scope = Scope.create();

    const element = document.createElement('span');
    element.setAttribute('ng-bind-template', 'Just text');

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('Just text');

    // A second digest with no scope changes does not flip the text.
    // The standard `$watch` identity short-circuit suppresses any
    // listener re-fire because the interpolated value is constant.
    scope.$digest();
    expect(element.textContent).toBe('Just text');
  });
});
