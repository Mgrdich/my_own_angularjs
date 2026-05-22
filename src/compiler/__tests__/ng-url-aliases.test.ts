/**
 * URL/value attribute alias directives — `ngHref`, `ngSrc`, `ngSrcset`
 * (spec 025 Slice 1 / FS §2.1).
 *
 * The three directives share an identical mechanical contract — only
 * the target DOM attribute name differs — so the test plan is
 * parametrized via `describe.each` for `[ngName, domAttr]` pairs.
 *
 * Locked behavior per directive:
 *
 *  - `injector.has('<name>Directive') === true` — registration sanity.
 *  - Real DOM attribute (`href` / `src` / `srcset`) is ABSENT before
 *    the first digest. The browser never sees the literal `{{ … }}`
 *    string.
 *  - After the first digest, the real attribute carries the
 *    interpolated value.
 *  - Subsequent value changes on the underlying scope expression
 *    propagate to the real attribute on the next digest.
 *  - An empty / `null` / `undefined` interpolated value REMOVES the
 *    real attribute entirely (`hasAttribute(...)` returns `false`),
 *    not just sets it to `""`.
 *
 * Bootstrap mirrors the spec-023 / spec-024 test pattern — re-builds
 * the canonical `'ng'` module's registry entry, then composes with a
 * fresh `'app'` module rooted at the canonical `ngModule` instance so
 * the directives registered by `src/core/ng-module.ts` are reachable.
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

// Parametrize over the three [normalized name, DOM attribute] pairs.
// The directive names use camelCase here because they line up with the
// `<name>Directive` provider key the injector exposes; the kebab-case
// form (`ng-href` etc.) is the source-DOM spelling consumed below.
const cases: ReadonlyArray<readonly [ngName: string, domAttr: string]> = [
  ['ngHref', 'href'],
  ['ngSrc', 'src'],
  ['ngSrcset', 'srcset'],
];

describe.each(cases)('ng-%s — URL/value alias directive (spec 025 Slice 1)', (ngName, domAttr) => {
  const ngAttr = `ng-${domAttr}`;

  it(`injector.has('${ngName}Directive') === true`, () => {
    const b = bootstrap();
    expect(b.injector.has(`${ngName}Directive`)).toBe(true);
  });

  it(`real \`${domAttr}\` attribute is absent before the first digest`, () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.url = '/profile';

    // Use `<img>` for `src` / `srcset` (the canonical hosts) and
    // `<a>` for `href` (also canonical). The framework treats the
    // host element uniformly — these are documentation-helpful
    // choices, not a behavioral discriminator.
    const tag = domAttr === 'href' ? 'a' : 'img';
    const element = document.createElement(tag);
    element.setAttribute(ngAttr, '{{url}}');

    // BEFORE compile + digest: the real attribute is whatever the
    // raw markup carries — which is NOTHING. The consumer never
    // wrote a literal `href="…"` (or `src="…"`).
    expect(element.hasAttribute(domAttr)).toBe(false);

    b.$compile(element)(scope);

    // The compile+link cycle does NOT itself trigger the digest —
    // the framework's `$observe` callback fires only when the
    // digest runs. So the real attribute is STILL absent here.
    expect(element.hasAttribute(domAttr)).toBe(false);

    scope.$digest();

    // After the first digest the real attribute is set to the
    // resolved interpolation value.
    expect(element.getAttribute(domAttr)).toBe('/profile');
  });

  it('updates the real attribute when the interpolated value changes', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.url = '/a';

    const tag = domAttr === 'href' ? 'a' : 'img';
    const element = document.createElement(tag);
    element.setAttribute(ngAttr, '{{url}}');

    b.$compile(element)(scope);
    scope.$digest();
    expect(element.getAttribute(domAttr)).toBe('/a');

    scope.url = '/b';
    scope.$digest();
    expect(element.getAttribute(domAttr)).toBe('/b');
  });

  it(`empty-string interpolated value removes the real \`${domAttr}\` attribute entirely`, () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.url = '/something';

    const tag = domAttr === 'href' ? 'a' : 'img';
    const element = document.createElement(tag);
    element.setAttribute(ngAttr, '{{url}}');

    b.$compile(element)(scope);
    scope.$digest();
    expect(element.getAttribute(domAttr)).toBe('/something');

    scope.url = '';
    scope.$digest();
    // `hasAttribute` returns FALSE — the directive must REMOVE the
    // attribute, not set it to `""`. The spec 017 `$set` falsy-handling
    // logic at `attributes.ts:285-307` provides this for free.
    expect(element.hasAttribute(domAttr)).toBe(false);
  });

  it(`null interpolated value removes the real \`${domAttr}\` attribute entirely`, () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.url = '/something';

    const tag = domAttr === 'href' ? 'a' : 'img';
    const element = document.createElement(tag);
    element.setAttribute(ngAttr, '{{url}}');

    b.$compile(element)(scope);
    scope.$digest();
    expect(element.getAttribute(domAttr)).toBe('/something');

    scope.url = null;
    scope.$digest();
    expect(element.hasAttribute(domAttr)).toBe(false);
  });

  it(`undefined interpolated value removes the real \`${domAttr}\` attribute entirely`, () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.url = '/something';

    const tag = domAttr === 'href' ? 'a' : 'img';
    const element = document.createElement(tag);
    element.setAttribute(ngAttr, '{{url}}');

    b.$compile(element)(scope);
    scope.$digest();
    expect(element.getAttribute(domAttr)).toBe('/something');

    scope.url = undefined;
    scope.$digest();
    expect(element.hasAttribute(domAttr)).toBe(false);
  });
});

describe('ng-href / ng-src / ng-srcset — canonical element-type sanity', () => {
  it('ng-href works on <a> elements', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.url = '/profile';
    const element = document.createElement('a');
    element.setAttribute('ng-href', '{{url}}');

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.getAttribute('href')).toBe('/profile');
  });

  it('ng-src works on <img> elements', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.url = '/img/me.jpg';
    const element = document.createElement('img');
    element.setAttribute('ng-src', '{{url}}');

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.getAttribute('src')).toBe('/img/me.jpg');
  });

  it('ng-srcset works on <img> elements', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.set = '/img/me.jpg 1x, /img/me@2x.jpg 2x';
    const element = document.createElement('img');
    element.setAttribute('ng-srcset', '{{set}}');

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.getAttribute('srcset')).toBe('/img/me.jpg 1x, /img/me@2x.jpg 2x');
  });
});
