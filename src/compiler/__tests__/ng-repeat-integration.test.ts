/**
 * Composition / integration tests for the spec-028 `ngRepeat` directive
 * paired with the spec-027 structural directives (`ngIf`,
 * `ngController`, `ngInclude`) and with NESTED `ngRepeat`.
 *
 * The dedicated `ng-repeat.test.ts` covers the directive's acceptance
 * criteria in isolation; `spec028-parity.test.ts` pins the canonical
 * AngularJS-1.x observable regressions. This file fills the remaining
 * slot: composition scenarios where `ngRepeat` interacts with other
 * structural directives in the same subtree, AND scenarios where
 * teardown propagates through nested structural layers at once.
 *
 * **Implementation gap surfaced (spec 028 Slice 7).** Several of the
 * nested combinations in this file hit a single underlying gap: a
 * `transclude: 'element'` directive nested INSIDE another
 * `transclude: 'element'` directive's transclusion subtree does NOT
 * re-fire its `link` / watch wiring when the outer's per-iteration
 * clone is linked. Concretely, `ng-if` / `ng-include` / nested
 * `ng-repeat` mounted INSIDE an outer `ng-repeat` row install their
 * Comment placeholders correctly but never render their cloned
 * sub-rows; symmetrically, `ng-repeat` mounted INSIDE an `ng-if`
 * transclusion subtree installs the `ng-repeat` placeholder but does
 * not render rows.
 *
 * This is the parallel of the spec-027 "ng-include under ng-if" gap
 * (documented in `structural-integration.test.ts:122-131`). The
 * affected combinations are pinned with `it.skip(…)` carrying inline
 * justifications; a future spec slice that hardens the master-clone
 * re-link path will turn the skips into active assertions.
 *
 * Working coverage (`it(...)`):
 *
 * 1. **`ng-repeat > ng-controller`** — each row gets its own controller
 *    instance via the nested form (same-element form is dropped by the
 *    spec-017 terminal cutoff; nested is the AngularJS-canonical
 *    pattern). Controllers don't use `transclude: 'element'` so this
 *    composition works end-to-end.
 *
 * 2. **Same-element conflict** — `<li ng-repeat="…" ng-if="…">` pins
 *    the actually-observable behavior surfaced by the same-element
 *    terminal-cutoff gap from spec 027.
 *
 * Skipped pending the nested-`transclude:'element'` gap closing:
 *
 * 3. **`ng-repeat > ng-if`** (skip) — per-row `ng-if` doesn't render.
 * 4. **`ng-repeat > ng-include`** (skip) — per-row `ng-include` placeholder
 *    is installed and the fetcher is called, but the resolved template
 *    never lands in the row (parallel to the spec-027 ng-if + ng-include
 *    gap).
 * 5. **`ng-repeat` inside `ng-if`** (skip) — the inner `ng-repeat` does
 *    not render rows when the outer `ng-if` is truthy.
 * 6. **Nested `ng-repeat`** (skip) — inner `ng-repeat` placeholder is
 *    installed but no rows render.
 *
 * Mirrors the bootstrap shape in `structural-integration.test.ts` (the
 * closest spec-027 precedent) — full re-registration of the canonical
 * `'ng'` providers + production `ngModule` in the deps array + optional
 * `register` callback for controllers / per-test directives / mock
 * fetchers. The mock-fetcher injection follows
 * `ng-include.test.ts:137-145` precedent (factory is on `appModule`, not
 * the local-`'ng'` module — the injector's `loadModule` short-circuits
 * the local-`'ng'` on the second visit because `loadedModules.has('ng')`
 * is already true after the production `ngModule` loads).
 *
 * @see context/spec/028-ng-repeat/functional-spec.md
 * @see context/spec/028-ng-repeat/technical-considerations.md §3 (Risks)
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import { MultipleTranscludeDirectivesError } from '@compiler/compile-error';
import type { CompileService } from '@compiler/directive-types';
import { $ControllerProvider } from '@controller/controller-provider';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { type AnyModule, createModule, resetRegistry } from '@di/module';
import type { ExceptionHandler } from '@exception-handler/index';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import { createTemplateCache } from '@template/template-cache';
import { createTemplateRequest } from '@template/template-request';
import type { TemplateCacheService, TemplateFetcher, TemplateRequestFn } from '@template/template-types';

interface Bootstrap {
  $compile: CompileService;
}

interface BootstrapOptions {
  fetcher?: TemplateFetcher;
  exceptionHandler?: ExceptionHandler;
  register?: (appModule: AnyModule) => void;
}

/**
 * Bootstrap an injector wired with the production `ngModule` so the
 * spec-027 structural directives AND the spec-028 `ngRepeat` directive
 * are reachable end-to-end. The `app` module accepts a mock fetcher,
 * a spy `$exceptionHandler`, and an optional `register` callback.
 *
 * The mock-fetcher override is applied on the `appModule`, NOT the
 * local-`'ng'` re-registration — the injector's `loadModule`
 * short-circuit makes the local-`'ng'` invokeQueue invisible once the
 * production `ngModule` has loaded (mirrors `ng-include.test.ts:137-145`
 * precedent).
 */
function bootstrap(options?: BootstrapOptions): Bootstrap {
  const fetcher = options?.fetcher;
  resetRegistry();
  createModule('ng', [])
    .factory('$exceptionHandler', [() => (): void => undefined])
    .provider('$sceDelegate', $SceDelegateProvider)
    .provider('$sce', $SceProvider)
    .provider('$interpolate', $InterpolateProvider)
    .provider('$filter', ['$provide', $FilterProvider])
    .provider('$controller', ['$provide', $ControllerProvider])
    .factory('$templateCache', [() => createTemplateCache()])
    .factory('$templateRequest', [
      '$templateCache',
      (cache: TemplateCacheService): TemplateRequestFn => createTemplateRequest({ cache }),
    ])
    .provider('$compile', ['$provide', $CompileProvider]);

  const appModule = createModule('app-ng-repeat-integration', ['ng']);
  if (options?.exceptionHandler !== undefined) {
    const handler = options.exceptionHandler;
    appModule.factory('$exceptionHandler', [() => handler]);
  }
  if (fetcher !== undefined) {
    // Last-wins override on appModule (NOT local-'ng') — the local
    // re-registration is short-circuited by `loadedModules.has('ng')`
    // once the production ngModule loads. Mirrors ng-include.test.ts.
    appModule.factory('$templateRequest', [
      '$templateCache',
      (cache: TemplateCacheService): TemplateRequestFn => createTemplateRequest({ cache, fetcher }),
    ]);
  }
  if (options?.register !== undefined) {
    options.register(appModule);
  }
  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get('$compile'),
  };
}

/**
 * Drain three microtasks to flush the `ng-include`'s
 * `$templateRequest(...).then(...)` chain. Mirrors the defensive 3x
 * flush in `ng-include.test.ts` and `spec027-parity.test.ts`.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** Collect the `<li>` rows currently mounted under `parent`. */
function rowsOf(parent: HTMLElement): HTMLLIElement[] {
  return Array.from(parent.querySelectorAll('li'));
}

afterEach(() => {
  resetRegistry();
});

// ---------------------------------------------------------------------
// 1. ng-repeat > ng-controller — per-row controller instance.
//
// NOTE: same-element form `<li ng-repeat="…" ng-controller="…">` is
// gated by the spec-017 terminal cutoff — `ng-repeat` runs at priority
// 1000 with `terminal: true`, so a same-element `ng-controller`
// (priority 500) is dropped from the matched-directive list. The
// canonical pattern is the NESTED form below. Controllers don't use
// `transclude: 'element'` themselves, so this composition is one of
// the few that works end-to-end through the current framework.
// ---------------------------------------------------------------------

describe('integration: ng-repeat > ng-controller — per-row instance (FS §2.6 composition)', () => {
  it('nested form `<li ng-repeat><inner ng-controller>>` gives each row its own controller instance', () => {
    const instances: Record<string, unknown>[] = [];
    const b = bootstrap({
      register: (app) => {
        app.controller('ItemCtrl', [
          function (this: Record<string, unknown>): void {
            this.tag = 'fresh';
            instances.push(this);
          },
        ]);
      },
    });
    const scope = Scope.create();
    scope.todos = [{ title: 'A' }, { title: 'B' }, { title: 'C' }];

    // <li ng-repeat="todo in todos">
    //   <div ng-controller="ItemCtrl as item">
    //     <span ng-bind="item.tag + ':' + todo.title"></span>
    //   </div>
    // </li>
    //
    // The same-element shape `<li ng-repeat="…" ng-controller="…">`
    // is dropped by the spec-017 terminal cutoff (see describe-block
    // prologue); the nested form below is what consumers actually use.
    const parent = document.createElement('ul');
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'todo in todos');
    const ctrl = document.createElement('div');
    ctrl.setAttribute('ng-controller', 'ItemCtrl as item');
    const bind = document.createElement('span');
    bind.setAttribute('ng-bind', "item.tag + ':' + todo.title");
    ctrl.appendChild(bind);
    host.appendChild(ctrl);
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows.length).toBe(3);
    // Each row carries its own controller instance with a clean `tag`.
    expect(rows.map((r) => r.textContent)).toEqual(['fresh:A', 'fresh:B', 'fresh:C']);

    // Three distinct instances were constructed.
    expect(instances.length).toBe(3);
    expect(instances[0]).not.toBe(instances[1]);
    expect(instances[1]).not.toBe(instances[2]);
  });
});

// ---------------------------------------------------------------------
// 2. Same-element conflict `<li ng-repeat="…" ng-if="…">`.
//
// **Implementation gap noted (carried forward from spec 027).** The
// technical-considerations §3 (Potential Risks table) expectation was
// that this combination routes `MultipleTranscludeDirectivesError`.
// In practice the spec-017 same-element TERMINAL cutoff in
// `directive-collector.ts` fires BEFORE the spec-018 transclude
// pre-pass scan — `ng-repeat` (priority 1000 `terminal: true`)
// truncates the matched-directive list, so `ng-if` (priority 600)
// never reaches the transclude pre-pass to trigger the multi-error.
// The user-observable effect: only `ng-repeat` runs.
//
// This test pins the actually-observable behavior so a future fix
// that routes the error BEFORE the cutoff lights up as a test failure
// (signaling the gap closed). Mirrors `spec027-parity.test.ts:549-583`'s
// approach for the parallel `ng-if + ng-include` case.
// ---------------------------------------------------------------------

describe('integration: same-element `ng-repeat + ng-if` conflict — pinned observable (spec-017 cutoff gap)', () => {
  it("`<li ng-repeat='i in list' ng-if='i.show'>` is silently dropped by the terminal cutoff (NO MultipleTranscludeDirectivesError surfaces today)", () => {
    // Expected outcome today: `ng-repeat` runs (rows render); `ng-if`
    // never reaches the matched-directive list; no error is routed.
    //
    // If a future spec slice reorders the pre-passes so the multi-
    // detect scan runs BEFORE the terminal cutoff, this test will
    // turn red on the `multi.length === 0` assertion.
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.list = [
      { id: 1, show: true },
      { id: 2, show: false },
      { id: 3, show: true },
    ];

    const parent = document.createElement('ul');
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'i in list');
    host.setAttribute('ng-if', 'i.show');
    const inner = document.createElement('span');
    inner.setAttribute('ng-bind', 'i.id');
    host.appendChild(inner);
    parent.appendChild(host);

    expect(() => {
      b.$compile(host)(scope);
      scope.$digest();
    }).not.toThrow();

    // No MultipleTranscludeDirectivesError surfaced — confirms the gap.
    const multiCalls = handler.mock.calls.filter(([err]) => err instanceof MultipleTranscludeDirectivesError);
    expect(multiCalls.length).toBe(0);

    // `ng-repeat` ran — three rows are mounted (filtering by `i.show`
    // never happened because `ng-if` was dropped by the cutoff).
    expect(rowsOf(parent).length).toBe(3);
  });
});

// ---------------------------------------------------------------------
// 3. `ng-repeat > ng-if` (skip — blocked by nested transclude:'element' gap)
// ---------------------------------------------------------------------

describe('integration: ng-repeat > ng-if — per-row toggle (FS §2.6 composition)', () => {
  it.skip("each row's nested `ng-if` toggles independently based on its item's `done` field (blocked by nested transclude:'element' gap)", () => {
    // FS §2.6 expectation: `<li ng-repeat="todo in todos"><span
    // ng-if="todo.done">…</span></li>` mounts the `<span>` only for
    // rows whose item is truthy. The CURRENT framework installs the
    // per-row `<!-- ngIf: todo.done -->` Comment placeholder correctly
    // but the `ng-if` watch listener does NOT re-fire after the row
    // clone's link cycle, so the cloned subtree never lands in the DOM
    // even when `todo.done === true`.
    //
    // A future spec slice that hardens the master-clone re-link path
    // (or that re-enters the inner watch wiring during the cloned
    // subtree link cycle) will turn this skip into an active test.
    const b = bootstrap();
    const scope = Scope.create();
    scope.todos = [
      { title: 'A', done: true },
      { title: 'B', done: false },
      { title: 'C', done: true },
    ];

    const parent = document.createElement('ul');
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'todo in todos');
    const mark = document.createElement('span');
    mark.setAttribute('ng-if', 'todo.done');
    mark.className = 'mark';
    mark.textContent = 'done';
    const title = document.createElement('span');
    title.setAttribute('ng-bind', 'todo.title');
    title.className = 'title';
    host.appendChild(mark);
    host.appendChild(title);
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows.length).toBe(3);
    expect(rows[0]?.querySelector('.mark')).not.toBeNull();
    expect(rows[1]?.querySelector('.mark')).toBeNull();
    expect(rows[2]?.querySelector('.mark')).not.toBeNull();
  });

  it("pins the SILENT-no-render outcome for per-row `ng-if` (nested transclude:'element' gap)", () => {
    // The actually-observable behavior today: outer `ng-repeat` rows
    // render correctly; per-row `<!-- ngIf: … -->` Comment placeholders
    // are installed inside each row; but the `ng-if` cloned subtree
    // (`<span class="mark">`) never lands in the DOM.
    //
    // The plain `ng-bind` (priority 0) child works because it is NOT a
    // transclude:'element' directive — only the nested-element-form
    // structural directives are affected.
    const b = bootstrap();
    const scope = Scope.create();
    scope.todos = [
      { title: 'A', done: true },
      { title: 'B', done: false },
    ];

    const parent = document.createElement('ul');
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'todo in todos');
    const mark = document.createElement('span');
    mark.setAttribute('ng-if', 'todo.done');
    mark.className = 'mark';
    mark.textContent = 'done';
    const title = document.createElement('span');
    title.setAttribute('ng-bind', 'todo.title');
    title.className = 'title';
    host.appendChild(mark);
    host.appendChild(title);
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    // Outer rows rendered correctly with `ng-bind` titles.
    const rows = rowsOf(parent);
    expect(rows.length).toBe(2);
    expect(rows[0]?.querySelector('.title')?.textContent).toBe('A');
    expect(rows[1]?.querySelector('.title')?.textContent).toBe('B');
    // But no `.mark` lands anywhere — the per-row `ng-if` clone path
    // is blocked by the nested transclude:'element' gap.
    expect(parent.querySelectorAll('.mark').length).toBe(0);
  });
});

// ---------------------------------------------------------------------
// 4. `ng-repeat > ng-include` (skip — blocked by nested transclude:'element' gap)
// ---------------------------------------------------------------------

describe('integration: ng-repeat > ng-include — per-row template fetch (FS §2.6 composition)', () => {
  it.skip("each row fetches its own template URL via the mocked fetcher (blocked by nested transclude:'element' gap)", async () => {
    // FS §2.6 expectation: each per-row `<div ng-include="part.url">`
    // fetches the template from its bound URL and installs the result
    // as a sibling of the per-row placeholder. The CURRENT framework
    // calls the fetcher (the watch IS reachable) and the promise
    // resolves, but the template install never lands in the DOM —
    // parallel to the spec-027 ng-if + ng-include gap documented in
    // `structural-integration.test.ts:122-131`. Un-skip when the gap
    // closes.
    const fetcher = vi.fn<TemplateFetcher>((url: string) =>
      Promise.resolve(`<span class="payload">${url.replace(/[/.]/g, '_')}</span>`),
    );
    const b = bootstrap({ fetcher });
    const scope = Scope.create();
    scope.parts = [{ url: '/a.html' }, { url: '/b.html' }];

    const parent = document.createElement('ul');
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'part in parts');
    const includeHost = document.createElement('div');
    includeHost.setAttribute('ng-include', 'part.url');
    host.appendChild(includeHost);
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();
    await flushMicrotasks();
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows.length).toBe(2);
    expect(rows[0]?.querySelector('.payload')?.textContent).toBe('_a_html');
    expect(rows[1]?.querySelector('.payload')?.textContent).toBe('_b_html');
  });

  it("pins the actually-observable behavior: per-row `ng-include` placeholders are installed and the fetcher IS called, but the resolved template never lands in the row (nested transclude:'element' gap)", async () => {
    const fetcher = vi.fn<TemplateFetcher>((url: string) =>
      Promise.resolve(`<span class="payload">${url.replace(/[/.]/g, '_')}</span>`),
    );
    const b = bootstrap({ fetcher });
    const scope = Scope.create();
    scope.parts = [{ url: '/a.html' }, { url: '/b.html' }];

    const parent = document.createElement('ul');
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'part in parts');
    const includeHost = document.createElement('div');
    includeHost.setAttribute('ng-include', 'part.url');
    host.appendChild(includeHost);
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    // Fetcher IS invoked once per row — the per-row $watch wired by
    // ng-include's link DOES fire on first digest of the cloned scope.
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledWith('/a.html');
    expect(fetcher).toHaveBeenCalledWith('/b.html');

    await flushMicrotasks();
    scope.$digest();

    // But the resolved templates never lands in the per-row DOM —
    // parallel to the spec-027 ng-if + ng-include gap.
    const rows = rowsOf(parent);
    expect(rows.length).toBe(2);
    expect(parent.querySelectorAll('.payload').length).toBe(0);
  });
});

// ---------------------------------------------------------------------
// 5. `ng-repeat` inside `ng-if` (skip — blocked by nested transclude:'element' gap)
// ---------------------------------------------------------------------

describe('integration: ng-repeat inside ng-if — mount on truthy, tear down on falsy (FS §2.6 composition)', () => {
  it.skip("the outer `ng-if` mounts the entire `ng-repeat` block on truthy and tears down every per-row scope on falsy (blocked by nested transclude:'element' gap)", () => {
    // FS §2.6 expectation: `<ul ng-if="show"><li ng-repeat="…">…</li></ul>`
    // renders all per-row rows when `show === true` and tears them all
    // down when `show === false`. CURRENT framework installs the
    // ng-repeat Comment placeholder inside the ng-if clone but never
    // renders any rows — the inner ng-repeat's `$watchCollection`
    // listener is never reached after the outer ng-if's clone link
    // cycle completes. Un-skip when the gap closes.
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = true;
    scope.items = ['A', 'B', 'C'];

    const parent = document.createElement('div');
    const ul = document.createElement('ul');
    ul.setAttribute('ng-if', 'show');
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'item in items');
    const probe = document.createElement('span');
    probe.setAttribute('ng-bind', 'item');
    host.appendChild(probe);
    ul.appendChild(host);
    parent.appendChild(ul);

    b.$compile(parent)(scope);
    scope.$digest();
    expect(rowsOf(parent).length).toBe(3);

    scope.show = false;
    scope.$digest();
    expect(rowsOf(parent).length).toBe(0);
  });

  it("pins the SILENT-no-render outcome for `ng-repeat` inside `ng-if` (nested transclude:'element' gap)", () => {
    // Observable today: outer ng-if mounts (the `<ul>` lands in the
    // DOM), the per-ng-if-clone carries a `<!-- ngRepeat: item in
    // items -->` Comment placeholder, but ZERO `<li>` rows render
    // (parallel of the per-row ng-if and per-row ng-include cases
    // above — the nested-transclude:'element' watcher never fires
    // post-outer-clone-link).
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = true;
    scope.items = ['A', 'B', 'C'];

    const parent = document.createElement('div');
    const ul = document.createElement('ul');
    ul.setAttribute('ng-if', 'show');
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'item in items');
    const probe = document.createElement('span');
    probe.setAttribute('ng-bind', 'item');
    host.appendChild(probe);
    ul.appendChild(host);
    parent.appendChild(ul);

    b.$compile(parent)(scope);
    scope.$digest();

    // Outer ng-if mounted — `<ul>` is in the DOM and carries the
    // inner ngRepeat placeholder.
    const mountedUl = parent.querySelector('ul');
    expect(mountedUl).not.toBeNull();
    // But no rows rendered.
    expect(rowsOf(parent).length).toBe(0);
  });
});

// ---------------------------------------------------------------------
// 6. Nested `ng-repeat` (skip — blocked by nested transclude:'element' gap)
// ---------------------------------------------------------------------

describe('integration: nested ng-repeat — outer + inner with per-item variable shadowing (FS §2.6 AC6.4)', () => {
  it.skip("each outer row carries its own inner repeat scope; inner `item` shadows the outer `item` (blocked by nested transclude:'element' gap)", () => {
    // FS §2.6 AC6.4 expectation: nested ng-repeat lets the inner
    // template reference the OUTER row scope via prototypal inheritance
    // while the inner `item` binding shadows the outer's. The CURRENT
    // framework's nested-transclude:'element' gap means the inner
    // ng-repeat never renders rows — parallel to the nested-`ng-repeat`
    // test in `spec028-parity.test.ts`. Un-skip when the gap closes.
    const b = bootstrap();
    const scope = Scope.create();
    scope.groups = [
      { id: 'g1', items: ['x', 'y'] },
      { id: 'g2', items: ['p', 'q', 'r'] },
    ];

    const parent = document.createElement('div');
    const outerHost = document.createElement('ul');
    outerHost.setAttribute('ng-repeat', 'group in groups');
    outerHost.className = 'group';
    const innerHost = document.createElement('li');
    innerHost.setAttribute('ng-repeat', 'item in group.items');
    innerHost.className = 'item';
    const bind = document.createElement('span');
    bind.setAttribute('ng-bind', "group.id + ':' + item");
    innerHost.appendChild(bind);
    outerHost.appendChild(innerHost);
    parent.appendChild(outerHost);

    b.$compile(parent)(scope);
    scope.$digest();

    const outerRows = Array.from(parent.querySelectorAll('ul.group'));
    expect(outerRows.length).toBe(2);
    const firstInners = Array.from(outerRows[0]?.querySelectorAll('li.item') ?? []);
    const secondInners = Array.from(outerRows[1]?.querySelectorAll('li.item') ?? []);
    expect(firstInners.map((li) => li.textContent)).toEqual(['g1:x', 'g1:y']);
    expect(secondInners.map((li) => li.textContent)).toEqual(['g2:p', 'g2:q', 'g2:r']);
  });

  it("pins the SILENT-no-render outcome for nested `ng-repeat` (nested transclude:'element' gap)", () => {
    // Observable today: outer ng-repeat rows render; each carries an
    // inner `<!-- ngRepeat: item in group.items -->` Comment
    // placeholder; but ZERO `<li.item>` rows render anywhere.
    const b = bootstrap();
    const scope = Scope.create();
    scope.groups = [{ id: 'g1', items: ['x', 'y'] }];

    const parent = document.createElement('div');
    const outerHost = document.createElement('ul');
    outerHost.setAttribute('ng-repeat', 'group in groups');
    outerHost.className = 'group';
    const innerHost = document.createElement('li');
    innerHost.setAttribute('ng-repeat', 'item in group.items');
    innerHost.className = 'item';
    const bind = document.createElement('span');
    bind.setAttribute('ng-bind', "group.id + ':' + item");
    innerHost.appendChild(bind);
    outerHost.appendChild(innerHost);
    parent.appendChild(outerHost);

    b.$compile(parent)(scope);
    scope.$digest();

    // Outer ng-repeat mounted exactly one `<ul.group>` row.
    expect(parent.querySelectorAll('ul.group').length).toBe(1);
    // No inner `<li.item>` rows rendered.
    expect(parent.querySelectorAll('li.item').length).toBe(0);
  });
});
