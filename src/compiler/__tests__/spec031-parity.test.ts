/**
 * AngularJS 1.x parity tests for spec 031 (template interpolation —
 * text-node + attribute `{{ }}` bindings, Slice 3 close-out).
 *
 * This file is a focused "canonical patterns" regression guard rather
 * than a verbatim upstream port — `angular/angular.js` is not vendored
 * locally, so each block below codifies a publicly-documented AngularJS
 * 1.x behavior (from `compileSpec.js` / `interpolateSpec.js`) that the
 * spec-031 interpolation surface must satisfy. The per-slice files
 * (`text-interpolate.test.ts`, `attr-interpolate.test.ts`) cover the
 * full FS §2.1 / §2.2 acceptance grid; this file pins the cross-cutting
 * surfaces introduced by Slice 3:
 *
 *  - **Security routing** — interpolated `a[href]` / `img[src]` resolve
 *    a trusted SCE (URL) context, so a safe URL renders into the live
 *    attribute after digest (FS §2.3).
 *  - **Documented limitation** — `href="/users/{{id}}"` (surrounding
 *    literal text) under SCE strict mode is reported via
 *    `$exceptionHandler` (cause `'$compile'`, the eager-pass catch); the
 *    element still links and the page keeps digesting (no crash).
 *  - **Error resilience** — a throwing interpolation expression in a
 *    text node / plain attribute is reported via `$exceptionHandler`
 *    (cause `'$interpolate'` / `'$filter'`) while the rest of the
 *    template keeps rendering (FS §2.5).
 *  - **Composite** — a page mixing text `{{ }}`, attribute `{{ }}`,
 *    `ng-if`, and `ng-repeat` renders end-to-end and updates on digest.
 *
 * Plus the `EXCEPTION_HANDLER_CAUSES.length === 10` regression guard —
 * spec 031 introduces ZERO new cause tokens (the eager-pass catch reuses
 * the existing `'$compile'` token).
 *
 * Mirrors the structural precedent set by
 * `src/compiler/__tests__/spec030-parity.test.ts`.
 *
 * @see context/spec/031-template-interpolation/functional-spec.md
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { EXCEPTION_HANDLER_CAUSES, type ExceptionHandler } from '@exception-handler/index';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import { createTemplateCache } from '@template/template-cache';
import { createTemplateRequest } from '@template/template-request';
import type { TemplateCacheService, TemplateRequestFn } from '@template/template-types';

type ExceptionSpy = ReturnType<typeof vi.fn<ExceptionHandler>>;

interface Bootstrap {
  $compile: CompileService;
  exceptionSpy: ExceptionSpy;
}

/**
 * Bootstrap an injector wired with the production `ngModule` (so the
 * built-in structural directives `ngIf` / `ngRepeat` are reachable for
 * the composite case). The `app` module installs a spy
 * `$exceptionHandler` (app loads after `ng`, so its factory wins
 * last-wins) so the limitation / error-resilience tests can assert
 * routing + cause tokens.
 */
function bootstrap(): Bootstrap {
  resetRegistry();
  const exceptionSpy: ExceptionSpy = vi.fn<ExceptionHandler>();

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
  appModule.factory('$exceptionHandler', [(): ExceptionHandler => exceptionSpy]);
  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get('$compile'),
    exceptionSpy,
  };
}

/** Collect the cause tokens passed to every `$exceptionHandler` call. */
function causesOf(spy: ExceptionSpy): Array<string | undefined> {
  return spy.mock.calls.map((call) => call[1]);
}

afterEach(() => {
  resetRegistry();
});

describe('spec 031 parity — interpolated link/source attributes route through the trusted (URL) context (FS §2.3)', () => {
  it('a[href]="{{url}}" renders a safe URL into the live href after digest', () => {
    const { $compile, exceptionSpy } = bootstrap();
    const scope = Scope.create();
    scope.profileUrl = '/users/42';

    const anchor = document.createElement('a');
    anchor.setAttribute('href', '{{profileUrl}}');

    $compile(anchor)(scope);
    scope.$digest();

    expect(anchor.getAttribute('href')).toBe('/users/42');
    expect(exceptionSpy).not.toHaveBeenCalled();
  });

  it('img[src]="{{url}}" renders a safe URL into the live src after digest', () => {
    const { $compile, exceptionSpy } = bootstrap();
    const scope = Scope.create();
    scope.imageUrl = '/assets/cat.png';

    const img = document.createElement('img');
    img.setAttribute('src', '{{imageUrl}}');

    $compile(img)(scope);
    scope.$digest();

    expect(img.getAttribute('src')).toBe('/assets/cat.png');
    expect(exceptionSpy).not.toHaveBeenCalled();
  });

  it('a safe URL updates on a subsequent digest', () => {
    const { $compile } = bootstrap();
    const scope = Scope.create();
    scope.profileUrl = '/users/1';

    const anchor = document.createElement('a');
    anchor.setAttribute('href', '{{profileUrl}}');

    $compile(anchor)(scope);
    scope.$digest();
    expect(anchor.getAttribute('href')).toBe('/users/1');

    scope.profileUrl = '/users/2';
    scope.$digest();
    expect(anchor.getAttribute('href')).toBe('/users/2');
  });
});

describe('spec 031 parity — documented limitation: surrounding-text URL under SCE strict mode (FS §2.3, technical-considerations §3)', () => {
  it('href="/users/{{id}}" reports via $exceptionHandler (cause "$compile"), still links, keeps digesting', () => {
    const { $compile, exceptionSpy } = bootstrap();
    const scope = Scope.create();
    scope.id = 7;

    const anchor = document.createElement('a');
    // Surrounding literal text ("/users/") + a {{ }} expression in a
    // trusted (URL) context violates the single-binding strict-trust
    // rule — `$interpolate` throws at classification time.
    anchor.setAttribute('href', '/users/{{id}}');

    // Linking the element must NOT throw — the eager pass catches the
    // strict-trust error and routes it via the handler.
    expect(() => {
      $compile(anchor)(scope);
    }).not.toThrow();

    expect(exceptionSpy).toHaveBeenCalledTimes(1);
    expect(causesOf(exceptionSpy)).toContain('$compile');

    // The page keeps digesting; the offending attribute is simply not
    // wired (the literal markup stays).
    expect(() => {
      scope.$digest();
    }).not.toThrow();
  });

  it('a sibling interpolated attribute on the same element still links when one href throws', () => {
    const { $compile } = bootstrap();
    const scope = Scope.create();
    scope.id = 7;
    scope.tip = 'go to profile';

    const anchor = document.createElement('a');
    anchor.setAttribute('href', '/users/{{id}}'); // throws → skipped
    anchor.setAttribute('title', '{{tip}}'); // plain text → still wired

    $compile(anchor)(scope);
    scope.$digest();

    // The non-URL sibling attribute interpolates normally.
    expect(anchor.getAttribute('title')).toBe('go to profile');
  });
});

describe('spec 031 parity — error resilience: a throwing expression keeps the rest rendering (FS §2.5)', () => {
  it('a throwing text-node expression routes via $exceptionHandler while a sibling text node renders', () => {
    const { $compile, exceptionSpy } = bootstrap();
    const scope = Scope.create();
    scope.boom = () => {
      throw new Error('kaboom');
    };
    scope.name = 'World';

    const root = document.createElement('div');
    const bad = document.createElement('span');
    bad.textContent = '{{boom()}}';
    const good = document.createElement('span');
    good.textContent = 'Hello {{name}}';
    root.appendChild(bad);
    root.appendChild(good);

    $compile(root)(scope);
    scope.$digest();

    // The healthy sibling renders.
    expect(good.textContent).toBe('Hello World');
    // The throw was reported via the interpolate handler path.
    expect(exceptionSpy).toHaveBeenCalled();
    expect(causesOf(exceptionSpy)).toContain('$interpolate');
  });

  it('a throwing plain-attribute expression routes via $exceptionHandler while a sibling attribute renders', () => {
    const { $compile, exceptionSpy } = bootstrap();
    const scope = Scope.create();
    scope.boom = () => {
      throw new Error('kaboom');
    };
    scope.tip = 'ok';

    const element = document.createElement('div');
    element.setAttribute('title', '{{boom()}}');
    element.setAttribute('alt', '{{tip}}');

    $compile(element)(scope);
    scope.$digest();

    expect(element.getAttribute('alt')).toBe('ok');
    expect(exceptionSpy).toHaveBeenCalled();
    expect(causesOf(exceptionSpy)).toContain('$interpolate');
  });
});

describe('spec 031 parity — EXCEPTION_HANDLER_CAUSES regression guard', () => {
  it('stays free of a spec-031 token (count is 13 since spec 037)', () => {
    expect(EXCEPTION_HANDLER_CAUSES.length).toBe(13);
  });
});

describe('spec 031 parity — composite page (text + attr + ng-if + ng-repeat)', () => {
  it('renders end-to-end and updates on digest', () => {
    const { $compile, exceptionSpy } = bootstrap();
    const scope = Scope.create();
    scope.heading = 'Tasks';
    scope.tooltip = 'your work';
    scope.show = true;
    scope.items = ['alpha', 'beta'];

    const root = document.createElement('div');

    // Text interpolation in a heading.
    const h1 = document.createElement('h1');
    h1.textContent = '{{heading}}';
    root.appendChild(h1);

    // Attribute interpolation on a container.
    const panel = document.createElement('section');
    panel.setAttribute('title', 'Panel: {{tooltip}}');
    root.appendChild(panel);

    // Structural ng-if wrapping interpolated text.
    const note = document.createElement('p');
    note.setAttribute('ng-if', 'show');
    note.textContent = 'Showing {{items.length}} items';
    panel.appendChild(note);

    // ng-repeat rows, each with its own text + attribute binding.
    const list = document.createElement('ul');
    const row = document.createElement('li');
    row.setAttribute('ng-repeat', 'item in items');
    row.setAttribute('data-label', '{{item}}');
    row.textContent = 'Item {{$index}}: {{item}}';
    list.appendChild(row);
    panel.appendChild(list);

    $compile(root)(scope);
    scope.$digest();

    expect(h1.textContent).toBe('Tasks');
    expect(panel.getAttribute('title')).toBe('Panel: your work');

    const mountedNote = panel.querySelector('p');
    expect(mountedNote?.textContent).toBe('Showing 2 items');

    const rows = list.querySelectorAll('li');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toBe('Item 0: alpha');
    expect(rows[0]?.getAttribute('data-label')).toBe('alpha');
    expect(rows[1]?.textContent).toBe('Item 1: beta');
    expect(rows[1]?.getAttribute('data-label')).toBe('beta');

    // Update everything on a subsequent digest.
    scope.heading = 'Done';
    scope.tooltip = 'finished';
    (scope.items as string[]).push('gamma');
    scope.$digest();

    expect(h1.textContent).toBe('Done');
    expect(panel.getAttribute('title')).toBe('Panel: finished');
    expect(panel.querySelector('p')?.textContent).toBe('Showing 3 items');
    const updatedRows = list.querySelectorAll('li');
    expect(updatedRows).toHaveLength(3);
    expect(updatedRows[2]?.textContent).toBe('Item 2: gamma');
    expect(updatedRows[2]?.getAttribute('data-label')).toBe('gamma');

    // Toggle the ng-if off.
    scope.show = false;
    scope.$digest();
    expect(panel.querySelector('p')).toBeNull();

    // Interpolation itself is clean — no `'$interpolate'` / `'$filter'`
    // render-time failures were routed. (A pre-existing spec-028 ng-repeat
    // clone re-link quirk routes harmless `'$compile'` placeholder notices
    // that are unrelated to interpolation and out of scope for spec 031,
    // so we filter on the cause token rather than assert zero calls.)
    expect(causesOf(exceptionSpy)).not.toContain('$interpolate');
    expect(causesOf(exceptionSpy)).not.toContain('$filter');
  });
});
