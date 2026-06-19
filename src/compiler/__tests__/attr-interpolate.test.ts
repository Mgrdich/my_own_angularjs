/**
 * Attribute interpolation — `{{ }}` in plain attribute values
 * (spec 031 Slice 2 / FS §2.2).
 *
 * Locks the eager-classification-in-`bindAttrsToScope` behavior:
 *
 *  - A dynamic attribute (`title="{{tooltip}}"`) writes the resolved
 *    value to the LIVE DOM attribute after the first digest and updates
 *    on every subsequent change (`writeAttr: true` — auto-interpolation
 *    OWNS the real DOM write).
 *  - Interpolation works on arbitrary attribute names (`alt`, `data-*`,
 *    `aria-*`), mixed literal+expression values, and multiple
 *    expressions in one value.
 *  - A static attribute (no `{{...}}`) is left as written and installs
 *    NO watch.
 *  - A directive that `$observe`s an interpolated attribute is notified
 *    with the computed value and again on change, with EXACTLY ONE
 *    watch installed for that attribute (the shared `$$interpolators`
 *    cache guarantees the single-watch invariant).
 *  - undefined / null expressions render as an empty attribute value,
 *    not the literal `"undefined"` / `"null"`.
 *  - App-configured custom delimiters are honored in attributes.
 *
 * Bootstrap mirrors the spec-025 `ng-url-aliases.test.ts` pattern —
 * re-builds the canonical `'ng'` module registry, then composes a
 * fresh `'app'` module rooted at the canonical `ngModule` instance.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService, DirectiveDefinition, DirectiveFactory } from '@compiler/directive-types';
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

interface Bootstrap {
  $compile: CompileService;
}

interface InterpolateProviderLike {
  startSymbol: (value: string) => unknown;
  endSymbol: (value: string) => unknown;
}

type ConfigBlock = readonly [unknown, (...args: never[]) => void];

function buildNg(): void {
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
}

function bootstrap(
  directives: Record<string, DirectiveFactory> = {},
  configBlocks: readonly ConfigBlock[] = [],
): Bootstrap {
  buildNg();
  const appModule = createModule('app', ['ng']);
  for (const [name, factory] of Object.entries(directives)) {
    appModule.directive(name, factory);
  }
  for (const block of configBlocks) {
    appModule.config(block as never);
  }
  const built = createInjector([ngModule, appModule]);
  return { $compile: built.get('$compile') };
}

afterEach(() => {
  resetRegistry();
});

describe('attribute interpolation — live DOM write (FS §2.2)', () => {
  it('<div title="{{tooltip}}"> sets the live title attribute and updates on change', () => {
    const { $compile } = bootstrap();
    const scope = Scope.create();
    scope.tooltip = 'Save your work';

    const element = document.createElement('div');
    element.setAttribute('title', '{{tooltip}}');

    $compile(element)(scope);
    scope.$digest();
    expect(element.getAttribute('title')).toBe('Save your work');

    scope.tooltip = 'Discard';
    scope.$digest();
    expect(element.getAttribute('title')).toBe('Discard');
  });

  it('interpolates an arbitrary `alt` attribute', () => {
    const { $compile } = bootstrap();
    const scope = Scope.create();
    scope.caption = 'A cat';

    const element = document.createElement('img');
    element.setAttribute('alt', '{{caption}}');

    $compile(element)(scope);
    scope.$digest();
    expect(element.getAttribute('alt')).toBe('A cat');
  });

  it('interpolates a data-* attribute', () => {
    const { $compile } = bootstrap();
    const scope = Scope.create();
    scope.id = 42;

    const element = document.createElement('div');
    element.setAttribute('data-row-id', '{{id}}');

    $compile(element)(scope);
    scope.$digest();
    expect(element.getAttribute('data-row-id')).toBe('42');
  });

  it('interpolates an aria-* attribute', () => {
    const { $compile } = bootstrap();
    const scope = Scope.create();
    scope.label = 'Close dialog';

    const element = document.createElement('button');
    element.setAttribute('aria-label', '{{label}}');

    $compile(element)(scope);
    scope.$digest();
    expect(element.getAttribute('aria-label')).toBe('Close dialog');
  });

  it('mixed literal + expression: class="box {{state}}" → "box active"', () => {
    const { $compile } = bootstrap();
    const scope = Scope.create();
    scope.state = 'active';

    const element = document.createElement('div');
    element.setAttribute('class', 'box {{state}}');

    $compile(element)(scope);
    scope.$digest();
    expect(element.getAttribute('class')).toBe('box active');
  });

  it('multiple expressions in one attribute value are all evaluated', () => {
    const { $compile } = bootstrap();
    const scope = Scope.create();
    scope.first = 'Ada';
    scope.last = 'Lovelace';

    const element = document.createElement('div');
    element.setAttribute('title', '{{first}} {{last}}!');

    $compile(element)(scope);
    scope.$digest();
    expect(element.getAttribute('title')).toBe('Ada Lovelace!');

    scope.last = 'Byron';
    scope.$digest();
    expect(element.getAttribute('title')).toBe('Ada Byron!');
  });
});

describe('attribute interpolation — static attributes (FS §2.2)', () => {
  it('a static attribute is left as written with NO watch installed', () => {
    const { $compile } = bootstrap();
    const scope = Scope.create();
    const watchSpy = vi.spyOn(scope, '$watch');

    const element = document.createElement('div');
    element.setAttribute('title', 'plain tooltip');
    element.setAttribute('id', 'static-id');

    $compile(element)(scope);

    expect(watchSpy).not.toHaveBeenCalled();

    scope.$digest();
    expect(element.getAttribute('title')).toBe('plain tooltip');
    expect(element.getAttribute('id')).toBe('static-id');
  });
});

describe('attribute interpolation — undefined / null → empty (FS §2.2)', () => {
  it('an undefined expression produces an empty attribute value', () => {
    const { $compile } = bootstrap();
    const scope = Scope.create();
    // `missing` is never defined on the scope.

    const element = document.createElement('div');
    element.setAttribute('title', '{{missing}}');

    $compile(element)(scope);
    scope.$digest();

    const title = element.getAttribute('title');
    expect(title).not.toBe('undefined');
    expect(title ?? '').toBe('');
  });

  it('a null expression produces an empty attribute value, not "null"', () => {
    const { $compile } = bootstrap();
    const scope = Scope.create();
    scope.value = null;

    const element = document.createElement('div');
    element.setAttribute('title', '{{value}}');

    $compile(element)(scope);
    scope.$digest();

    const title = element.getAttribute('title');
    expect(title).not.toBe('null');
    expect(title ?? '').toBe('');
  });
});

describe('attribute interpolation — $observe integration, single-watch invariant (FS §2.2)', () => {
  it('a directive $observe-ing an interpolated attribute is notified with the computed value and on change, with EXACTLY ONE watch', () => {
    const observed: Array<string | undefined> = [];

    const probeDdo: DirectiveDefinition = {
      restrict: 'A',
      link: (_scope, _element, attrs) => {
        attrs.$observe('title', (value) => {
          observed.push(value);
        });
      },
    };
    const probe = [() => probeDdo] as unknown as DirectiveFactory;

    const { $compile } = bootstrap({ probe });
    const scope = Scope.create();
    scope.tooltip = 'first';
    const watchSpy = vi.spyOn(scope, '$watch');

    const element = document.createElement('div');
    element.setAttribute('probe', '');
    element.setAttribute('title', '{{tooltip}}');

    $compile(element)(scope);

    // The eager pass installs its single watch BEFORE link runs, so the
    // probe's `$observe` finds the cached InterpolateFn and installs no
    // extra watch — exactly one watch total for the interpolated `title`.
    expect(watchSpy).toHaveBeenCalledTimes(1);

    scope.$digest();

    expect(watchSpy).toHaveBeenCalledTimes(1);
    expect(observed).toContain('first');
    expect(element.getAttribute('title')).toBe('first');

    scope.tooltip = 'second';
    scope.$digest();

    expect(observed).toContain('second');
    expect(element.getAttribute('title')).toBe('second');
  });

  it('the eager pass installs exactly one watch for a dynamic attribute', () => {
    const { $compile } = bootstrap();
    const scope = Scope.create();
    scope.tooltip = 'x';
    const watchSpy = vi.spyOn(scope, '$watch');

    const element = document.createElement('div');
    element.setAttribute('title', '{{tooltip}}');

    $compile(element)(scope);

    // Exactly one watch for the single dynamic attribute.
    expect(watchSpy).toHaveBeenCalledTimes(1);

    // Even after a directive observes it, still one watch total.
    scope.$digest();
    expect(watchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('attribute interpolation — custom delimiters (FS §2.2 / §2.4)', () => {
  it('honors configured custom start/end symbols in attributes', () => {
    const configBlock: ConfigBlock = [
      '$interpolateProvider',
      ($interpolateProvider: InterpolateProviderLike): void => {
        $interpolateProvider.startSymbol('[[');
        $interpolateProvider.endSymbol(']]');
      },
    ];

    const { $compile } = bootstrap({}, [configBlock]);
    const scope = Scope.create();
    scope.tooltip = 'custom';

    const element = document.createElement('div');
    element.setAttribute('title', '[[tooltip]]');
    // The default `{{ }}` delimiters must be ignored.
    element.setAttribute('alt', '{{tooltip}}');

    $compile(element)(scope);
    scope.$digest();

    expect(element.getAttribute('title')).toBe('custom');
    expect(element.getAttribute('alt')).toBe('{{tooltip}}');
  });
});
