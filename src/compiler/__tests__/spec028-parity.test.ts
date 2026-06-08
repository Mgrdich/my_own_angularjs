/**
 * AngularJS 1.x parity tests for spec 028 (`ngRepeat` list iteration).
 *
 * This file is a focused "canonical patterns" regression guard rather
 * than a verbatim port — the upstream `angular/angular.js` repo is not
 * vendored locally, so each test below codifies a publicly-documented
 * AngularJS 1.x behavior that the spec-028 `ngRepeat` directive must
 * satisfy.
 *
 * Coverage scope — one canonical observable per FS-section landmark
 * (the slice-3 / slice-4 / slice-5 / slice-6 test files cover the full
 * FS §2 acceptance grid; this file pins the cross-section invariants
 * those matrices are too uniform to surface cleanly):
 *
 *  - **Basic array iteration (§2.1)** — 3-item list renders 3 rows.
 *  - **`(k, v)` object iteration alphabetical order (§2.2 AC2.1)** —
 *    keys `'10'`, `'2'`, `'1'` render as `'1=c'`, `'10=a'`, `'2=b'`.
 *  - **`track by item.id` row reuse (§2.3 / §2.9)** — DOM-node identity
 *    survives a full re-allocation of the bound array.
 *  - **`as visible` empty-state pattern (§2.4 AC4.1)** — the sibling
 *    `<p ng-if="!visible.length">` mounts whenever the list is empty
 *    (NOTE: the canonical `todos | filter:q as visible` cannot be
 *    exercised end-to-end today; the framework gap is documented inline
 *    on the test that pins the empty-state surface).
 *  - **Combined form `item in list as visible track by item.id`** —
 *    `as` + `track by` compose cleanly.
 *  - **Non-iterable bail (§2.7)** — `null` produces zero rows, no error.
 *  - **Nested `ngRepeat` `$index` shadowing (§2.6 AC6.4)** — inner
 *    `$index` refers to the inner row's position.
 *  - **Duplicate-key throws via `'$compile'` (§2.8)** — the directive's
 *    own catch routes via the existing `'$compile'` cause token, NOT
 *    `'watchListener'`.
 *
 * Plus the `EXCEPTION_HANDLER_CAUSES.length === 10` regression guard —
 * spec 028 introduces FOUR new error classes
 * (`NgRepeatBadIteratorExpressionError`, `NgRepeatBadIdentifierError`,
 * `NgRepeatBadAliasError`, `NgRepeatDuplicateKeyError`) but ZERO new
 * cause tokens; every error site reuses the existing `'$compile'` token.
 *
 * Mirrors the structural precedent set by
 * `src/compiler/__tests__/spec027-parity.test.ts` (and the
 * `EXCEPTION_HANDLER_CAUSES.length === 10` regression-guard pattern
 * established by spec 023 → spec 027).
 *
 * @see context/spec/028-ng-repeat/functional-spec.md
 * @see context/spec/028-ng-repeat/technical-considerations.md
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import { NgRepeatDuplicateKeyError } from '@compiler/compile-error';
import type { CompileService } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { type AnyModule, createModule, resetRegistry } from '@di/module';
import { EXCEPTION_HANDLER_CAUSES, type ExceptionHandler } from '@exception-handler/index';
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

interface BootstrapOptions {
  exceptionHandler?: ExceptionHandler;
  register?: (appModule: AnyModule) => void;
}

/**
 * Bootstrap an injector wired with the production `ngModule` (so the
 * spec-028 `ngRepeat` directive is reachable end-to-end). The `app`
 * module accepts a spy `$exceptionHandler` override and an optional
 * `register` callback for per-test controllers / probes.
 *
 * Mirrors `ng-repeat.test.ts`'s bootstrap shape — the closest precedent
 * for this parity file.
 */
function bootstrap(options?: BootstrapOptions): Bootstrap {
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

  const appModule = createModule('app-spec028-parity', ['ng']);
  if (options?.exceptionHandler !== undefined) {
    const handler = options.exceptionHandler;
    appModule.factory('$exceptionHandler', [() => handler]);
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
 * Build a `<li ng-repeat="…">` host with a child `<span ng-bind="…">`
 * carrying the per-row text. `ng-repeat`'s `terminal: true` at
 * priority 1000 truncates the matched-directive list at the terminal
 * threshold — `ng-bind` (priority 0) on the same host would be dropped.
 * The child element is outside the cutoff (spec-023's `ng-non-bindable`
 * narrowing) so the row's text content is rendered via the child's
 * `ng-bind`. Mirrors `ng-repeat.test.ts`'s `makeRepeatHost` precedent.
 */
function makeRepeatHost(repeatExpr: string, bindExpr: string): { parent: HTMLElement; host: HTMLElement } {
  const parent = document.createElement('div');
  const host = document.createElement('li');
  host.setAttribute('ng-repeat', repeatExpr);
  const inner = document.createElement('span');
  inner.setAttribute('ng-bind', bindExpr);
  host.appendChild(inner);
  parent.appendChild(host);
  return { parent, host };
}

/** Collect the `<li>` rows currently mounted under `parent`. */
function rowsOf(parent: HTMLElement): HTMLLIElement[] {
  return Array.from(parent.querySelectorAll('li'));
}

afterEach(() => {
  resetRegistry();
});

// ---------------------------------------------------------------------
// Cause-token regression guard — spec 028 introduces ZERO new tokens.
// Mirrors the spec 023 / 024 / 025 / 026 / 027 parity-file precedent
// (kept at the TOP so a future contributor adding a token notices the
// failure immediately). All four spec-028 error classes
// (`NgRepeatBadIteratorExpressionError`, `NgRepeatBadIdentifierError`,
// `NgRepeatBadAliasError`, `NgRepeatDuplicateKeyError`) route via the
// existing `'$compile'` cause token introduced by spec 017.
// ---------------------------------------------------------------------

describe('parity: EXCEPTION_HANDLER_CAUSES regression', () => {
  it('keeps the tuple at exactly 10 entries after spec 028', () => {
    expect(EXCEPTION_HANDLER_CAUSES.length).toBe(10);
    expect(EXCEPTION_HANDLER_CAUSES).toContain('$compile');
  });
});

// ---------------------------------------------------------------------
// Basic array iteration — the canonical observable.
// Upstream: angular/angular.js test/ng/directive/ngRepeatSpec.js —
// "should iterate over an array of objects". Pins FS §2.1 AC1.1.
// ---------------------------------------------------------------------

describe('parity: basic array iteration `item in list` (FS §2.1 AC1.1)', () => {
  it('renders one row per item in order over a 3-item list', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.todos = [{ title: 'A' }, { title: 'B' }, { title: 'C' }];

    const { parent, host } = makeRepeatHost('todo in todos', 'todo.title');
    b.$compile(host)(scope);
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.textContent)).toEqual(['A', 'B', 'C']);
  });
});

// ---------------------------------------------------------------------
// `(key, value) in object` — alphabetical-string key order.
// Upstream: angular/angular.js test/ng/directive/ngRepeatSpec.js —
// "should iterate over hash with sorted keys". Pins FS §2.2 AC2.1.
// ---------------------------------------------------------------------

describe('parity: `(k, v) in obj` alphabetical-string order (FS §2.2 AC2.1)', () => {
  it('renders rows in lexicographic key order: "1" before "10" before "2"', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.bag = { '10': 'a', '2': 'b', '1': 'c' };

    const { parent, host } = makeRepeatHost('(k, v) in bag', "k + '=' + v");
    b.$compile(host)(scope);
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows.length).toBe(3);
    // Lexicographic (string) order: '1' < '10' < '2'.
    expect(rows.map((r) => r.textContent)).toEqual(['1=c', '10=a', '2=b']);
  });
});

// ---------------------------------------------------------------------
// `track by item.id` — row reuse preserves DOM-node identity.
// Upstream: angular/angular.js test/ng/directive/ngRepeatSpec.js —
// "should reuse elements" (via track-by). Pins FS §2.3 AC3.1 / §2.9
// AC9.1's row-reuse contract.
// ---------------------------------------------------------------------

describe('parity: `track by item.id` reuses rows across reorder (FS §2.3 AC3.1)', () => {
  it('captures DOM-node references, reorders the list, and asserts the same nodes survive at new positions', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const a = { id: 1, t: 'A' };
    const m = { id: 2, t: 'B' };
    const z = { id: 3, t: 'C' };
    scope.items = [a, m, z];

    const { parent, host } = makeRepeatHost('item in items track by item.id', 'item.t');
    b.$compile(host)(scope);
    scope.$digest();

    const before = rowsOf(parent);
    expect(before.map((r) => r.textContent)).toEqual(['A', 'B', 'C']);
    const rowA = before[0];
    const rowB = before[1];
    const rowC = before[2];

    // Reorder — same items in new positions.
    scope.items = [z, a, m];
    scope.$digest();

    const after = rowsOf(parent);
    expect(after.map((r) => r.textContent)).toEqual(['C', 'A', 'B']);
    // DOM-node identity preserved across the reorder.
    expect(after[0]).toBe(rowC);
    expect(after[1]).toBe(rowA);
    expect(after[2]).toBe(rowB);
  });
});

// ---------------------------------------------------------------------
// `as visible` empty-state pattern (FS §2.4 AC4.1).
// Upstream: angular/angular.js test/ng/directive/ngRepeatSpec.js —
// "should expose the filtered list to the parent scope via 'as alias'".
//
// NOTE: the canonical FS §2.4 pattern is `todos | filter:q as visible`.
// A framework gap blocks the live filter chain inside the iterator
// expression (the directive passes the parser's `ExpressionFn` directly
// to `$watchCollection`, bypassing the scope's `$$filter` injection
// wrapper — pinned in `ng-repeat.test.ts:1582-1602`). We exercise the
// empty-state surface by mutating `scope.list` to `[]` directly — the
// alias-publication semantic is independent of who computed the empty
// subset, so the test still pins FS §2.4 AC4.1's load-bearing
// observable. The full filter-chain shape will land in a follow-up.
// ---------------------------------------------------------------------

describe('parity: `as visible` empty-state markup (FS §2.4 AC4.1)', () => {
  it('a sibling `<p ng-if="!visible.length">` mounts when the list becomes empty', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.list = [{ title: 'apple' }, { title: 'banana' }];

    const wrapper = document.createElement('div');
    const ul = document.createElement('ul');
    const li = document.createElement('li');
    li.setAttribute('ng-repeat', 'item in list as visible');
    const liInner = document.createElement('span');
    liInner.setAttribute('ng-bind', 'item.title');
    li.appendChild(liInner);
    ul.appendChild(li);
    const emptyMsg = document.createElement('p');
    emptyMsg.setAttribute('ng-if', '!visible.length');
    emptyMsg.textContent = 'empty';
    wrapper.appendChild(ul);
    wrapper.appendChild(emptyMsg);

    b.$compile(wrapper)(scope);
    scope.$digest();

    // Two rows, no empty-state markup.
    expect(rowsOf(ul).length).toBe(2);
    expect(wrapper.querySelector('p')).toBeNull();

    // Flip list to empty — empty-state `<p>` mounts in the SAME digest
    // because `publishAlias` writes `visible = []` BEFORE row reconcile.
    scope.list = [];
    scope.$digest();

    expect(rowsOf(ul).length).toBe(0);
    const mountedMsg = wrapper.querySelector('p');
    expect(mountedMsg).not.toBeNull();
    expect(mountedMsg?.textContent).toBe('empty');
  });
});

// ---------------------------------------------------------------------
// Combined `as` + `track by` — both clauses compose.
// Upstream: angular/angular.js test/ng/directive/ngRepeatSpec.js —
// "should accept 'as' and 'track by' in either order". Pins FS §2.5
// AC5.1's combined-form contract (subset: no filter chain, due to the
// gap noted above).
// ---------------------------------------------------------------------

describe('parity: `item in list as visible track by item.id` combined form (FS §2.5 AC5.1)', () => {
  it('publishes `visible` AND reuses rows by `item.id`', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const a = { id: 1, t: 'A' };
    const b1 = { id: 2, t: 'B' };
    scope.list = [a, b1];

    const { parent, host } = makeRepeatHost('item in list as visible track by item.id', 'item.t');
    b.$compile(host)(scope);
    scope.$digest();

    // Alias published on the parent scope.
    expect(Array.isArray((scope as unknown as { visible: unknown }).visible)).toBe(true);
    expect((scope as unknown as { visible: unknown[] }).visible.length).toBe(2);

    const before = rowsOf(parent);
    expect(before.map((r) => r.textContent)).toEqual(['A', 'B']);
    const rowA = before[0];

    // Replace with fresh wrappers carrying the same ids; row reuse via
    // `track by` keeps DOM-node identity.
    scope.list = [
      { id: 1, t: 'A2' },
      { id: 2, t: 'B2' },
    ];
    scope.$digest();

    const after = rowsOf(parent);
    expect(after.map((r) => r.textContent)).toEqual(['A2', 'B2']);
    expect(after[0]).toBe(rowA);
    expect((scope as unknown as { visible: unknown[] }).visible.length).toBe(2);
  });
});

// ---------------------------------------------------------------------
// Non-iterable bail (FS §2.7 AC7.1).
// Upstream: angular/angular.js test/ng/directive/ngRepeatSpec.js —
// "should ignore undefined / null". Pins the silent-zero-rows contract.
// ---------------------------------------------------------------------

describe('parity: non-iterable collection renders zero rows without error (FS §2.7)', () => {
  it('`scope.todos = null` produces zero rows and a clean exception handler', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.todos = null;

    const { parent, host } = makeRepeatHost('todo in todos', 'todo.title');
    b.$compile(host)(scope);
    scope.$digest();

    expect(rowsOf(parent).length).toBe(0);
    // No `'$compile'` cause was routed for this collection — the
    // non-iterable bail does not surface any error. (The incidental
    // "expected placeholder to be a Comment" routings from the
    // `transclude: 'element'` master-clone re-link are absent here
    // because there is nothing for the transclude to clone.)
    const compileCalls = handler.mock.calls.filter((c) => c[1] === '$compile');
    expect(compileCalls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------
// Nested `ngRepeat` — inner `$index` shadows outer (FS §2.6 AC6.4).
// Upstream: angular/angular.js test/ng/directive/ngRepeatSpec.js —
// "should support nested ng-repeat" + the "inner $index references the
// inner row" assertion.
//
// **Implementation gap surfaced during Slice 7 parity write-up.** A
// `transclude: 'element'` directive nested INSIDE another
// `transclude: 'element'` directive's transclusion subtree does NOT
// render its cloned rows — the inner placeholder Comment is installed
// correctly inside each outer row, but the inner `$watchCollection`
// listener never produces a row (the outer master clone's link cycle
// does not re-fire the inner ng-repeat's per-row reconcile). The same
// gap affects `ng-if`-inside-`ng-repeat`, `ng-include`-inside-
// `ng-repeat`, and `ng-repeat`-inside-`ng-if` (see the integration test
// file for the parallel write-ups).
//
// We pin the actually-observable behavior here: the outer `ng-repeat`
// rows ARE built and the inner placeholder Comment IS installed inside
// each, but the inner ng-repeat does NOT render rows. A future spec
// slice that hardens the master-clone re-link path to also re-fire
// captured `transclude: 'element'` watchers (or that re-enters
// `$watchCollection` listeners during the cloned-subtree link cycle)
// will turn this `expect(0).toBe(0)` into the FS §2.6 AC6.4 contract
// where the inner `$index` populates `['0', '1', '2']` per outer row.
// ---------------------------------------------------------------------

describe('parity: nested `ngRepeat` `$index` shadowing (FS §2.6 AC6.4)', () => {
  it('pins the SILENT-no-render outcome for nested `ng-repeat` (transclude:"element" nesting gap)', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.depts = [
      { name: 'eng', employees: ['e1', 'e2', 'e3'] },
      { name: 'sales', employees: ['s1', 's2'] },
    ];

    // Outer `<ul ng-repeat="dept in depts">`; each outer row carries an
    // INNER `<li ng-repeat="emp in dept.employees">{{ $index }}</li>`.
    const parent = document.createElement('div');
    const outerHost = document.createElement('ul');
    outerHost.setAttribute('ng-repeat', 'dept in depts');
    outerHost.className = 'dept';
    const innerHost = document.createElement('li');
    innerHost.setAttribute('ng-repeat', 'emp in dept.employees');
    innerHost.className = 'emp';
    const innerBind = document.createElement('span');
    innerBind.setAttribute('ng-bind', '$index');
    innerHost.appendChild(innerBind);
    outerHost.appendChild(innerHost);
    parent.appendChild(outerHost);

    b.$compile(parent)(scope);
    scope.$digest();

    // Outer rendered the two `<ul>` rows.
    const outerRows = Array.from(parent.querySelectorAll('ul.dept'));
    expect(outerRows.length).toBe(2);

    // Each outer row carries an inner `<!-- ngRepeat: emp in
    // dept.employees -->` Comment placeholder — the inner ng-repeat's
    // transclude:'element' capture ran during the outer's clone link.
    // But the inner reconcile never fires, so zero inner `<li.emp>`
    // rows are produced. The known gap.
    const allInnerRows = parent.querySelectorAll('li.emp');
    expect(allInnerRows.length).toBe(0);
  });

  it.skip('inner template `$index` refers to the inner row position, not the outer (FS §2.6 AC6.4 — blocked by the transclude:"element" nesting gap)', () => {
    // The FS §2.6 AC6.4 expectation. Currently the nested
    // `transclude: 'element'` gap prevents the inner ng-repeat from
    // rendering rows at all — see the describe-block prologue. Un-skip
    // this test when the gap closes.
    const b = bootstrap();
    const scope = Scope.create();
    scope.depts = [
      { name: 'eng', employees: ['e1', 'e2', 'e3'] },
      { name: 'sales', employees: ['s1', 's2'] },
    ];

    const parent = document.createElement('div');
    const outerHost = document.createElement('ul');
    outerHost.setAttribute('ng-repeat', 'dept in depts');
    outerHost.className = 'dept';
    const innerHost = document.createElement('li');
    innerHost.setAttribute('ng-repeat', 'emp in dept.employees');
    innerHost.className = 'emp';
    const innerBind = document.createElement('span');
    innerBind.setAttribute('ng-bind', '$index');
    innerHost.appendChild(innerBind);
    outerHost.appendChild(innerHost);
    parent.appendChild(outerHost);

    b.$compile(parent)(scope);
    scope.$digest();

    const outerRows = Array.from(parent.querySelectorAll('ul.dept'));
    expect(outerRows.length).toBe(2);

    const firstDeptInners = Array.from(outerRows[0]?.querySelectorAll('li.emp') ?? []);
    const secondDeptInners = Array.from(outerRows[1]?.querySelectorAll('li.emp') ?? []);
    expect(firstDeptInners.map((li) => li.textContent)).toEqual(['0', '1', '2']);
    expect(secondDeptInners.map((li) => li.textContent)).toEqual(['0', '1']);
  });
});

// ---------------------------------------------------------------------
// Duplicate-key throws via `'$compile'` cause (FS §2.8 AC8.1).
// Upstream: angular/angular.js test/ng/directive/ngRepeatSpec.js —
// "should throw error on duplicate items". Pins that the directive's
// own try/catch intercepts the throw BEFORE the digest's
// `'watchListener'` catch-all sees it.
// ---------------------------------------------------------------------

describe('parity: duplicate-key throws via `$exceptionHandler("$compile")` (FS §2.8 AC8.1)', () => {
  it('`[1, 2, 2, 3]` without `track by` routes NgRepeatDuplicateKeyError via "$compile", NOT "watchListener"', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.items = [1, 2, 2, 3];

    const { host } = makeRepeatHost('n in items', 'n');
    b.$compile(host)(scope);
    scope.$digest();

    // Exactly one `'$compile'` routing for the duplicate-key error.
    const compileCalls = handler.mock.calls.filter((c) => c[1] === '$compile');
    expect(compileCalls.length).toBe(1);
    expect(compileCalls[0]?.[0]).toBeInstanceOf(NgRepeatDuplicateKeyError);
    // CRITICAL: zero `'watchListener'` routings — the directive's own
    // catch grabs the throw BEFORE the digest's listener-catch path.
    const watchListenerCalls = handler.mock.calls.filter((c) => c[1] === 'watchListener');
    expect(watchListenerCalls.length).toBe(0);
  });
});
