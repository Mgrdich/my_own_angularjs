/**
 * `$compileProvider.debugInfoEnabled` + debug-metadata attachment
 * (spec 034 Slice 4 / FS §2 — `debugInfoEnabled`).
 *
 * Locks the AngularJS-canonical getter/setter surface plus the marker
 * classes the compiler attaches when debug info is on (the default):
 *
 * - `ng-scope` on an element that gets a NEW (non-isolate) child scope
 *   (`scope: true`).
 * - `ng-isolate-scope` on an isolate-scope element (object-form
 *   `scope: { … }` / a `.component`).
 * - `ng-binding` on an element carrying an interpolation binding
 *   (`{{ … }}` in an attribute or a child text node) OR an `ng-bind`
 *   directive.
 *
 * Scope retrieval for dev-tools inspection stays the existing
 * non-enumerable `$$ngScope` slot, read via `getElementScope`.
 *
 * All marker classes APPEND — consumer classes are preserved, never
 * replaced. With `debugInfoEnabled(false)` in a `config` block, NONE of
 * the marker classes appear, while consumer classes and rendering are
 * otherwise identical.
 *
 * The production `ngModule` is used so the built-in `ng-bind` directive
 * (registered via a `config` block on `ngModule`) is reachable
 * end-to-end; the `app` module's own `config` block flips the toggle and
 * registers the custom scope / isolate / interpolation directives —
 * mirroring the `ng-bind.test.ts` bootstrap.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { $CompileProvider } from '@compiler/compile-provider';
import { getElementScope } from '@compiler/cleanup';
import type { CompileService, DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';

import { bootstrapNgModule } from './test-helpers';

beforeEach(() => {
  // Register a fresh `'ng'` entry in the module registry so the `app`
  // module's `requires: ['ng']` lookup resolves. The production
  // `ngModule` object is ALSO passed to `createInjector` by reference so
  // its config blocks (which register `ng-bind`, components, …) load.
  bootstrapNgModule();
});

afterEach(() => {
  resetRegistry();
});

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

/**
 * Bootstrap the production `ngModule` plus an `app` module whose `config`
 * block registers the caller's directives and (optionally) flips the
 * `debugInfoEnabled` toggle. Returns the resolved `$compile` service.
 */
function bootstrap(register: ($cp: $CompileProvider) => void): CompileService {
  const appModule = createModule('app', ['ng']).config([
    '$compileProvider',
    ($cp: $CompileProvider) => {
      register($cp);
    },
  ]);
  return createInjector([ngModule, appModule]).get('$compile');
}

describe('debugInfoEnabled — getter/setter semantics (spec 034 Slice 4)', () => {
  it('defaults to true when no config flips it', () => {
    let value: boolean | undefined;
    bootstrap(($cp) => {
      value = $cp.debugInfoEnabled();
    });
    expect(value).toBe(true);
  });

  it('debugInfoEnabled(false) returns the provider (chainable); the no-arg getter then returns false', () => {
    let getterValue: boolean | undefined;
    let chainedReturn: unknown;
    bootstrap(($cp) => {
      chainedReturn = $cp.debugInfoEnabled(false);
      getterValue = $cp.debugInfoEnabled();
      expect(chainedReturn).toBe($cp);
    });
    expect(getterValue).toBe(false);
  });

  it('rejects a non-boolean argument', () => {
    expect(() =>
      bootstrap(($cp) => {
        // @ts-expect-error — intentionally wrong type to exercise the runtime guard.
        $cp.debugInfoEnabled('yes');
      }),
    ).toThrow(TypeError);
  });
});

describe('debugInfoEnabled — enabled (default): marker classes attached', () => {
  it('adds ng-scope to an element that gets a new (non-isolate) child scope', () => {
    const $compile = bootstrap(($cp) => {
      $cp.directive('childScope', ddoFactory({ scope: true, link: () => undefined }));
    });
    const element = document.createElement('div');
    element.setAttribute('child-scope', '');

    $compile(element)(Scope.create());

    expect(element.classList.contains('ng-scope')).toBe(true);
    expect(element.classList.contains('ng-isolate-scope')).toBe(false);
  });

  it('adds ng-isolate-scope (not ng-scope) to an isolate-scope element', () => {
    const $compile = bootstrap(($cp) => {
      $cp.directive('isoDir', ddoFactory({ scope: { value: '=' }, link: () => undefined }));
    });
    const element = document.createElement('div');
    element.setAttribute('iso-dir', '');

    $compile(element)(Scope.create());

    expect(element.classList.contains('ng-isolate-scope')).toBe(true);
    expect(element.classList.contains('ng-scope')).toBe(false);
  });

  it('adds ng-isolate-scope to a component element', () => {
    const $compile = bootstrap(($cp) => {
      $cp.component('myWidget', {
        bindings: { value: '<' },
        template: '<span>x</span>',
      });
    });
    const element = document.createElement('my-widget');
    element.setAttribute('value', '1');

    $compile(element)(Scope.create());

    expect(element.classList.contains('ng-isolate-scope')).toBe(true);
  });

  it('adds ng-binding to an element with an interpolated attribute', () => {
    const $compile = bootstrap(() => undefined);
    const element = document.createElement('div');
    element.setAttribute('title', '{{name}}');

    const scope = Scope.create();
    scope.name = 'Ada';
    $compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('ng-binding')).toBe(true);
    expect(element.getAttribute('title')).toBe('Ada');
  });

  it('adds ng-binding to an element whose child text node is interpolated', () => {
    const $compile = bootstrap(() => undefined);
    const element = document.createElement('p');
    element.appendChild(document.createTextNode('Hello {{name}}'));

    const scope = Scope.create();
    scope.name = 'World';
    $compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('ng-binding')).toBe(true);
    expect(element.textContent).toBe('Hello World');
  });

  it('adds ng-binding to an ng-bind element', () => {
    const $compile = bootstrap(() => undefined);
    const element = document.createElement('span');
    element.setAttribute('ng-bind', 'greeting');

    const scope = Scope.create();
    scope.greeting = 'hi';
    $compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('ng-binding')).toBe(true);
    expect(element.textContent).toBe('hi');
  });

  it('does NOT add ng-binding to a plain element with no binding', () => {
    const $compile = bootstrap(() => undefined);
    const element = document.createElement('div');
    element.setAttribute('id', 'static');

    $compile(element)(Scope.create());

    expect(element.classList.contains('ng-binding')).toBe(false);
  });

  it('getElementScope returns the element scope for a scope: true element', () => {
    const $compile = bootstrap(($cp) => {
      $cp.directive('childScope', ddoFactory({ scope: true, link: () => undefined }));
    });
    const element = document.createElement('div');
    element.setAttribute('child-scope', '');

    const parent = Scope.create();
    $compile(element)(parent);

    const elementScope = getElementScope(element);
    expect(elementScope).toBeDefined();
    expect(elementScope).not.toBe(parent);
  });
});

describe('debugInfoEnabled — consumer classes preserved (append, never replace)', () => {
  it('a card element with a new scope ends up with BOTH card and ng-scope', () => {
    const $compile = bootstrap(($cp) => {
      $cp.directive('childScope', ddoFactory({ scope: true, link: () => undefined }));
    });
    const element = document.createElement('div');
    element.setAttribute('class', 'card');
    element.setAttribute('child-scope', '');

    $compile(element)(Scope.create());

    expect(element.classList.contains('card')).toBe(true);
    expect(element.classList.contains('ng-scope')).toBe(true);
  });

  it('a consumer-classed element keeps its class alongside ng-binding', () => {
    const $compile = bootstrap(() => undefined);
    const element = document.createElement('div');
    element.setAttribute('class', 'card');
    element.setAttribute('title', '{{name}}');

    const scope = Scope.create();
    scope.name = 'Ada';
    $compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('card')).toBe(true);
    expect(element.classList.contains('ng-binding')).toBe(true);
  });
});

describe('debugInfoEnabled(false) — no marker classes attached', () => {
  it('a scope: true element gets neither ng-scope nor ng-isolate-scope', () => {
    const $compile = bootstrap(($cp) => {
      $cp.debugInfoEnabled(false);
      $cp.directive('childScope', ddoFactory({ scope: true, link: () => undefined }));
    });
    const element = document.createElement('div');
    element.setAttribute('child-scope', '');

    $compile(element)(Scope.create());

    expect(element.classList.contains('ng-scope')).toBe(false);
    expect(element.classList.contains('ng-isolate-scope')).toBe(false);
  });

  it('an isolate-scope element gets no ng-isolate-scope marker', () => {
    const $compile = bootstrap(($cp) => {
      $cp.debugInfoEnabled(false);
      $cp.directive('isoDir', ddoFactory({ scope: { value: '=' }, link: () => undefined }));
    });
    const element = document.createElement('div');
    element.setAttribute('iso-dir', '');

    $compile(element)(Scope.create());

    expect(element.classList.contains('ng-isolate-scope')).toBe(false);
    expect(element.classList.contains('ng-scope')).toBe(false);
  });

  it('an ng-bind element gets no ng-binding marker but still renders', () => {
    const $compile = bootstrap(($cp) => {
      $cp.debugInfoEnabled(false);
    });
    const element = document.createElement('span');
    element.setAttribute('ng-bind', 'greeting');

    const scope = Scope.create();
    scope.greeting = 'hi';
    $compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('ng-binding')).toBe(false);
    // Rendering is otherwise identical.
    expect(element.textContent).toBe('hi');
  });

  it('an interpolated-attribute element gets no ng-binding marker but still renders', () => {
    const $compile = bootstrap(($cp) => {
      $cp.debugInfoEnabled(false);
    });
    const element = document.createElement('div');
    element.setAttribute('title', '{{name}}');

    const scope = Scope.create();
    scope.name = 'Ada';
    $compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('ng-binding')).toBe(false);
    expect(element.getAttribute('title')).toBe('Ada');
  });

  it('consumer classes are still present with markers off', () => {
    const $compile = bootstrap(($cp) => {
      $cp.debugInfoEnabled(false);
      $cp.directive('childScope', ddoFactory({ scope: true, link: () => undefined }));
    });
    const element = document.createElement('div');
    element.setAttribute('class', 'card');
    element.setAttribute('child-scope', '');

    $compile(element)(Scope.create());

    expect(element.classList.contains('card')).toBe(true);
    expect(element.classList.contains('ng-scope')).toBe(false);
    // The child scope still exists — only the marker class is suppressed.
    expect(getElementScope(element)).toBeDefined();
  });
});
