/**
 * Text-node interpolation — `{{ … }}` in element text content
 * (spec 031 Slice 1 / FS §2.1).
 *
 * Exercises the `compileTextNode` walker branch end-to-end through the
 * real `$compile` pipeline. Tests use the canonical `ngModule` so the
 * built-in structural directives (`ngIf`, `ngRepeat`) are reachable for
 * the transclusion-clone cases — mirroring the `ng-if.test.ts` /
 * `ng-repeat.test.ts` bootstrap pattern.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

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
  /**
   * Every call routed through the injected `$exceptionHandler` (spec 032
   * Slice 1 — the transclusion-clone cases assert this stays empty, so
   * the spec-031 `{{ }}`-in-clones path is pinned noise-free).
   */
  handlerCalls: { error: unknown; cause: unknown }[];
}

/**
 * Builds a `'ng'`-aware app graph so the built-in structural directives
 * are reachable. The optional `configure` callback runs in a config
 * block on the app module — used by the custom-delimiter case to swap
 * the `$interpolateProvider` start/end symbols. The app module's
 * last-wins `$exceptionHandler` is a recording spy so the
 * transclusion-clone cases can assert zero framework-internal noise on
 * the spec-031 interpolation-in-clones path (spec 032 Slice 1).
 */
function bootstrap(configure?: (interpolateProvider: $InterpolateProvider) => void): Bootstrap {
  resetRegistry();
  const handlerCalls: { error: unknown; cause: unknown }[] = [];
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

  const appModule = createModule('textInterpolateApp', ['ng']);
  appModule.factory('$exceptionHandler', [
    () =>
      (error: unknown, cause: unknown): void => {
        handlerCalls.push({ error, cause });
      },
  ]);
  if (configure !== undefined) {
    appModule.config([
      '$interpolateProvider',
      (interpolateProvider: $InterpolateProvider) => {
        configure(interpolateProvider);
      },
    ]);
  }
  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get('$compile'),
    injector: built,
    handlerCalls,
  };
}

afterEach(() => {
  resetRegistry();
});

describe('text interpolation — single expression (FS §2.1)', () => {
  it('renders "Hello World" from <h1>Hello {{name}}</h1>', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.name = 'World';

    const el = document.createElement('h1');
    el.textContent = 'Hello {{name}}';

    b.$compile(el)(scope);
    scope.$digest();

    expect(el.textContent).toBe('Hello World');
  });

  it('updates to "Hello Angular" when name changes and a digest runs', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.name = 'World';

    const el = document.createElement('h1');
    el.textContent = 'Hello {{name}}';

    b.$compile(el)(scope);
    scope.$digest();
    expect(el.textContent).toBe('Hello World');

    scope.name = 'Angular';
    scope.$digest();
    expect(el.textContent).toBe('Hello Angular');
  });
});

describe('text interpolation — multiple expressions + literal preservation (FS §2.1)', () => {
  it('evaluates every expression and preserves the comma / space / bang', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.greeting = 'Hi';
    scope.name = 'Ada';

    const el = document.createElement('p');
    el.textContent = '{{greeting}}, {{name}}!';

    b.$compile(el)(scope);
    scope.$digest();

    expect(el.textContent).toBe('Hi, Ada!');
  });
});

describe('text interpolation — pure-literal text (FS §2.1)', () => {
  it('leaves <p>Just text</p> untouched and installs NO watch for the text node', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const watchSpy = vi.spyOn(scope, '$watch');

    const el = document.createElement('p');
    el.textContent = 'Just text';

    b.$compile(el)(scope);

    // No `{{ }}` → no watch installed for the text node.
    expect(watchSpy).not.toHaveBeenCalled();

    scope.$digest();
    expect(el.textContent).toBe('Just text');
  });
});

describe('text interpolation — non-string coercion (FS §2.1)', () => {
  it('renders {{1 + 2}} as "3"', () => {
    const b = bootstrap();
    const scope = Scope.create();

    const el = document.createElement('span');
    el.textContent = '{{1 + 2}}';

    b.$compile(el)(scope);
    scope.$digest();

    expect(el.textContent).toBe('3');
  });

  it('renders a boolean expression as its text form', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.flag = true;

    const el = document.createElement('span');
    el.textContent = 'value: {{flag}}';

    b.$compile(el)(scope);
    scope.$digest();

    expect(el.textContent).toBe('value: true');
  });
});

describe('text interpolation — undefined / null render as empty (FS §2.1)', () => {
  it('renders undefined as empty text, not the literal "undefined"', () => {
    const b = bootstrap();
    const scope = Scope.create();
    // `scope.missing` intentionally unassigned → undefined.

    const el = document.createElement('span');
    el.textContent = 'x{{missing}}y';

    b.$compile(el)(scope);
    scope.$digest();

    expect(el.textContent).toBe('xy');
  });

  it('renders null as empty text, not the literal "null"', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.value = null;

    const el = document.createElement('span');
    el.textContent = '{{value}}';

    b.$compile(el)(scope);
    scope.$digest();

    expect(el.textContent).toBe('');
  });
});

describe('text interpolation — whitespace / newline preservation (FS §2.1)', () => {
  it('preserves surrounding whitespace and line breaks', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.name = 'World';

    const el = document.createElement('pre');
    el.textContent = '  Hello\n  {{name}}\n';

    b.$compile(el)(scope);
    scope.$digest();

    expect(el.textContent).toBe('  Hello\n  World\n');
  });
});

describe('text interpolation — transclusion via ng-if (FS §2.1)', () => {
  it('binds {{ }} inside an ng-if clone and tears it down with the clone', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = true;
    scope.name = 'World';

    const parent = document.createElement('div');
    const host = document.createElement('span');
    host.setAttribute('ng-if', 'show');
    host.textContent = 'Hello {{name}}';
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    // The mounted clone (a span) carries the resolved text.
    const mounted = parent.querySelector('span');
    expect(mounted).not.toBeNull();
    expect(mounted?.textContent).toBe('Hello World');

    // Live update inside the clone.
    scope.name = 'Angular';
    scope.$digest();
    expect(parent.querySelector('span')?.textContent).toBe('Hello Angular');

    // Teardown: falsy removes the clone entirely.
    scope.show = false;
    scope.$digest();
    expect(parent.querySelector('span')).toBeNull();

    // After teardown, mutating the bound value does not throw / leak a
    // write into a detached node — the clone's watch is gone.
    scope.name = 'Gone';
    expect(() => {
      scope.$digest();
    }).not.toThrow();
    expect(parent.querySelector('span')).toBeNull();

    // Spec 032 Slice 1 — the ng-if clone re-link emits ZERO
    // framework-internal noise: no "expected placeholder" throws routed
    // via `$exceptionHandler`, and no handler calls at all across the
    // mount → update → teardown cycle.
    expect(
      b.handlerCalls.filter((c) => c.error instanceof Error && /expected placeholder/i.test(c.error.message)),
    ).toHaveLength(0);
    expect(b.handlerCalls).toHaveLength(0);
  });
});

describe('text interpolation — transclusion via ng-repeat (FS §2.1)', () => {
  it('gives each repeated row its own independent text binding', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const items = ['a', 'b', 'c'];
    scope.items = items;

    const parent = document.createElement('ul');
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'item in items');
    host.textContent = 'Item: {{item}}';
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    const rows = parent.querySelectorAll('li');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toBe('Item: a');
    expect(rows[1]?.textContent).toBe('Item: b');
    expect(rows[2]?.textContent).toBe('Item: c');

    // Mutate one item — only that row's binding updates.
    items[1] = 'B';
    scope.$digest();

    const updated = parent.querySelectorAll('li');
    expect(updated[0]?.textContent).toBe('Item: a');
    expect(updated[1]?.textContent).toBe('Item: B');
    expect(updated[2]?.textContent).toBe('Item: c');

    // Spec 032 Slice 1 — each ng-repeat row's clone re-link emits ZERO
    // framework-internal noise: no "expected placeholder" throws routed
    // via `$exceptionHandler`, and no handler calls at all across the
    // initial render + per-row update.
    expect(
      b.handlerCalls.filter((c) => c.error instanceof Error && /expected placeholder/i.test(c.error.message)),
    ).toHaveLength(0);
    expect(b.handlerCalls).toHaveLength(0);
  });
});

describe('text interpolation — custom delimiters (FS §2.4)', () => {
  it('recognizes [[ expr ]] in text and treats {{ }} as literal', () => {
    const b = bootstrap((interpolateProvider) => {
      interpolateProvider.startSymbol('[[');
      interpolateProvider.endSymbol(']]');
    });
    const scope = Scope.create();
    scope.name = 'World';

    const el = document.createElement('h1');
    el.textContent = 'Hello [[name]] {{name}}';

    b.$compile(el)(scope);
    scope.$digest();

    // `[[name]]` resolves; the `{{name}}` segment is now literal text.
    expect(el.textContent).toBe('Hello World {{name}}');
  });
});
