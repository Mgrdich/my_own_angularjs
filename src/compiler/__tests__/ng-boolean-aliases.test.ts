/**
 * Boolean attribute alias directives — `ngDisabled`, `ngChecked`,
 * `ngReadonly`, `ngSelected`, `ngOpen` (spec 025 Slice 2 / FS §2.2).
 *
 * The five directives share an identical mechanical contract — only
 * the target DOM attribute name (and the canonical host element)
 * differs — so the test plan is parametrized via `describe.each` for
 * `[ngName, propName, hostElement]` triples.
 *
 * Locked behavior per directive:
 *
 *  - `injector.has('<name>Directive') === true` — registration sanity.
 *  - Real DOM attribute (`disabled` / `checked` / `readonly` /
 *    `selected` / `open`) is ADDED when the bound expression evaluates
 *    truthy.
 *  - The same attribute is REMOVED (not set to `"false"`) when the
 *    bound expression evaluates falsy.
 *  - Subsequent flips of the scope value propagate to the real
 *    attribute on each digest — `true` → `false` → `true` round-trips.
 *  - The browser-reflected DOM property (`element.disabled`,
 *    `element.checked`, `element.readOnly`, `option.selected`,
 *    `details.open`) is kept in sync automatically.
 *  - A range of truthy values (non-empty string, non-zero number,
 *    non-empty array, non-empty object) all ADD the attribute.
 *  - A range of falsy values (`null`, `undefined`, `0`, `''`, `false`,
 *    `NaN`) all REMOVE the attribute.
 *
 * Bootstrap mirrors the spec 025 Slice 1 URL-aliases test file —
 * re-builds the canonical `'ng'` module's registry entry, then
 * composes with a fresh `'app'` module rooted at the canonical
 * `ngModule` instance so the directives registered by
 * `src/core/ng-module.ts` are reachable.
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

/**
 * Returns the boolean DOM property that corresponds to a given
 * boolean attribute on a given host element. Used by the "DOM property
 * stays in sync" tests — jsdom mirrors the browser behavior, so a
 * presence-true attribute renders a `true` property value, and a
 * removed attribute renders `false`.
 *
 * Casts are local to the helper to keep the parametrized test bodies
 * tidy. The runtime contract is `boolean | undefined` — `undefined`
 * for unknown combinations (none today, but a safeguard against a
 * future test extension).
 */
function readDomProperty(element: Element, propName: string): boolean {
  switch (propName) {
    case 'disabled':
      return (element as HTMLButtonElement).disabled;
    case 'checked':
      return (element as HTMLInputElement).checked;
    case 'readonly':
      return (element as HTMLInputElement).readOnly;
    case 'selected':
      return (element as HTMLOptionElement).selected;
    case 'open':
      return (element as HTMLDetailsElement).open;
    default:
      throw new Error(`unsupported propName in test helper: ${propName}`);
  }
}

// Parametrize over the five [normalized name, DOM attribute, host tag]
// triples. The directive names use camelCase here to line up with the
// `<name>Directive` provider key the injector exposes; the kebab-case
// form (`ng-disabled` etc.) is the source-DOM spelling consumed below.
// Host tags are chosen per AngularJS-canonical usage: button / input /
// input / option / details respectively.
const cases: ReadonlyArray<readonly [ngName: string, propName: string, hostElement: string]> = [
  ['ngDisabled', 'disabled', 'button'],
  ['ngChecked', 'checked', 'input'],
  ['ngReadonly', 'readonly', 'input'],
  ['ngSelected', 'selected', 'option'],
  ['ngOpen', 'open', 'details'],
];

describe.each(cases)('ng-%s — boolean alias directive (spec 025 Slice 2)', (ngName, propName, hostElement) => {
  const ngAttr = `ng-${propName}`;

  it(`injector.has('${ngName}Directive') === true`, () => {
    const b = bootstrap();
    expect(b.injector.has(`${ngName}Directive`)).toBe(true);
  });

  it(`adds the real \`${propName}\` attribute when the expression is truthy`, () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.flag = true;
    const element = document.createElement(hostElement);
    element.setAttribute(ngAttr, 'flag');

    // BEFORE compile + digest the consumer never wrote the real
    // boolean attribute on the host — the directive owns it.
    expect(element.hasAttribute(propName)).toBe(false);

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.hasAttribute(propName)).toBe(true);
  });

  it(`removes the real \`${propName}\` attribute when the expression is falsy`, () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.flag = false;
    const element = document.createElement(hostElement);
    element.setAttribute(ngAttr, 'flag');

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.hasAttribute(propName)).toBe(false);
  });

  it(`transitions the real \`${propName}\` attribute on every truthiness flip across digests`, () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.flag = true;
    const element = document.createElement(hostElement);
    element.setAttribute(ngAttr, 'flag');

    b.$compile(element)(scope);
    scope.$digest();
    expect(element.hasAttribute(propName)).toBe(true);

    scope.flag = false;
    scope.$digest();
    expect(element.hasAttribute(propName)).toBe(false);

    scope.flag = true;
    scope.$digest();
    expect(element.hasAttribute(propName)).toBe(true);
  });

  it(`keeps the DOM property \`${propName}\` in sync via the browser-reflected attribute`, () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.flag = true;
    const element = document.createElement(hostElement);
    element.setAttribute(ngAttr, 'flag');

    b.$compile(element)(scope);
    scope.$digest();
    // Truthy expression → real attribute present → DOM property `true`.
    // This is automatic browser behavior — the directive only writes
    // the attribute; the property reflects.
    expect(readDomProperty(element, propName)).toBe(true);

    scope.flag = false;
    scope.$digest();
    expect(readDomProperty(element, propName)).toBe(false);
  });

  it(`treats various truthy values as "add the \`${propName}\` attribute"`, () => {
    const truthyValues: ReadonlyArray<readonly [string, unknown]> = [
      ['non-empty string', 'yes'],
      ['non-zero number', 1],
      ['non-empty array', [0]],
      ['non-empty object', { a: 1 }],
    ];
    for (const [label, value] of truthyValues) {
      const b = bootstrap();
      const scope = Scope.create();
      scope.flag = value;
      const element = document.createElement(hostElement);
      element.setAttribute(ngAttr, 'flag');

      b.$compile(element)(scope);
      scope.$digest();
      expect(element.hasAttribute(propName), `truthy value: ${label}`).toBe(true);
    }
  });

  it(`treats various falsy values as "remove the \`${propName}\` attribute"`, () => {
    const falsyValues: ReadonlyArray<readonly [string, unknown]> = [
      ['null', null],
      ['undefined', undefined],
      ['zero', 0],
      ['empty string', ''],
      ['false', false],
      ['NaN', Number.NaN],
    ];
    for (const [label, value] of falsyValues) {
      const b = bootstrap();
      const scope = Scope.create();
      // Pre-set to a truthy value, digest to install the attribute,
      // then flip to the falsy candidate. This shape is the most
      // direct test of the truthy→falsy transition path, which is
      // the load-bearing branch in `attrs.$set(propName, null)`.
      scope.flag = true;
      const element = document.createElement(hostElement);
      element.setAttribute(ngAttr, 'flag');

      b.$compile(element)(scope);
      scope.$digest();
      expect(element.hasAttribute(propName), `pre-flip (${label})`).toBe(true);

      scope.flag = value;
      scope.$digest();
      expect(element.hasAttribute(propName), `falsy value: ${label}`).toBe(false);
    }
  });
});
