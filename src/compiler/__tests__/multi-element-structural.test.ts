/**
 * Multi-element / ranged directives — Slice 2 (Mode A for the remaining
 * transclude built-ins: `ng-if`, `ng-switch-when`, `ng-switch-default`).
 *
 * Locks the spec-033 Slice 2 surface: the three `transclude: 'element'`
 * structural built-ins, once flagged `multiElement: true`, range over the
 * whole `<name>-start` … `<name>-end` sibling group through the Slice-1
 * Mode A machinery (capture the WHOLE range → one Comment placeholder →
 * clone the whole range per branch).
 *
 * Coverage mapped to the Slice 2 task list (FS §2.1):
 *   - `ng-if-start` / `-end`: a multi-node range mounts together when
 *     truthy and unmounts together when falsy (ALL range nodes appear /
 *     disappear, in order); toggling repeatedly works; teardown destroys
 *     the range's clone scope.
 *   - `ng-switch-when-start` / `-end` and `ng-switch-default-start` /
 *     `-end`: switching the value selects / deselects the WHOLE range for
 *     each case; the default case's range shows when no `when` matches.
 *   - A ranged directive nested INSIDE another range renders correctly.
 *   - Zero spurious `$compile` notices on all happy paths (spec-032
 *     interaction) — the recording handler is asserted empty.
 *   - The single-element `ng-if` / `ng-switch-when` / `ng-switch-default`
 *     forms are unchanged.
 *
 * Bootstrap mirrors `multi-element-range.test.ts` (production `ngModule`
 * for the built-ins + an `app` module carrying a recording
 * `$exceptionHandler`).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import type { ExceptionHandler } from '@exception-handler/index';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import { createTemplateCache } from '@template/template-cache';
import { createTemplateRequest } from '@template/template-request';
import type { TemplateCacheService, TemplateRequestFn } from '@template/template-types';

interface HandlerCall {
  error: unknown;
  cause: unknown;
}

interface Bootstrap {
  $compile: CompileService;
  handlerCalls: HandlerCall[];
}

function bootstrap(): Bootstrap {
  const handlerCalls: HandlerCall[] = [];
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

  const appModule = createModule('app-multi-element-structural', ['ng']);
  const handler: ExceptionHandler = (error: unknown, cause?: string) => {
    handlerCalls.push({ error, cause });
  };
  appModule.factory('$exceptionHandler', [() => handler]);
  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get('$compile'),
    handlerCalls,
  };
}

/**
 * Create a `<tr>` element with `attrs` set and one `<td>` whose text
 * content carries `cellText` (interpolated via spec-031 text nodes).
 */
function tr(attrs: Record<string, string>, cellText: string): HTMLTableRowElement {
  const row = document.createElement('tr');
  for (const [k, v] of Object.entries(attrs)) {
    row.setAttribute(k, v);
  }
  const cell = document.createElement('td');
  cell.textContent = cellText;
  row.appendChild(cell);
  return row;
}

/** Collect the `<tr>` rows currently mounted under `tbody`, in DOM order. */
function rowsOf(tbody: HTMLElement): HTMLTableRowElement[] {
  return Array.from(tbody.querySelectorAll('tr'));
}

/** Filter handler calls down to only `$compile`-cause notices. */
function compileNotices(calls: readonly HandlerCall[]): readonly HandlerCall[] {
  return calls.filter((c) => c.cause === '$compile');
}

afterEach(() => {
  resetRegistry();
});

// ---------------------------------------------------------------------------
// 1. ng-if-start/-end — whole range mounts/unmounts together
// ---------------------------------------------------------------------------

describe('multi-element ng-if — start/end range (FS §2.1)', () => {
  it('mounts the WHOLE range together when truthy, in document order', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = true;

    const tbody = document.createElement('tbody');
    tbody.appendChild(tr({ 'ng-if-start': 'show' }, 'first'));
    tbody.appendChild(tr({}, 'middle')); // node between endpoints — part of the group
    tbody.appendChild(tr({ 'ng-if-end': '' }, 'last'));

    b.$compile(tbody)(scope);
    scope.$digest();

    expect(rowsOf(tbody).map((r) => r.textContent)).toEqual(['first', 'middle', 'last']);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('unmounts the WHOLE range together when falsy', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = true;

    const tbody = document.createElement('tbody');
    tbody.appendChild(tr({ 'ng-if-start': 'show' }, 'first'));
    tbody.appendChild(tr({}, 'middle'));
    tbody.appendChild(tr({ 'ng-if-end': '' }, 'last'));

    b.$compile(tbody)(scope);
    scope.$digest();
    expect(rowsOf(tbody).length).toBe(3);

    scope.show = false;
    scope.$digest();
    expect(rowsOf(tbody).length).toBe(0);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('toggles repeatedly — every range node appears/disappears each cycle', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = false;

    const tbody = document.createElement('tbody');
    tbody.appendChild(tr({ 'ng-if-start': 'show' }, 'first'));
    tbody.appendChild(tr({ 'ng-if-end': '' }, 'last'));

    b.$compile(tbody)(scope);
    scope.$digest();
    expect(rowsOf(tbody).length).toBe(0);

    scope.show = true;
    scope.$digest();
    expect(rowsOf(tbody).map((r) => r.textContent)).toEqual(['first', 'last']);

    scope.show = false;
    scope.$digest();
    expect(rowsOf(tbody).length).toBe(0);

    scope.show = true;
    scope.$digest();
    expect(rowsOf(tbody).map((r) => r.textContent)).toEqual(['first', 'last']);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('installs ONE Comment placeholder for the whole range', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = true;

    const tbody = document.createElement('tbody');
    tbody.appendChild(tr({ 'ng-if-start': 'show' }, 'first'));
    tbody.appendChild(tr({ 'ng-if-end': '' }, 'last'));

    b.$compile(tbody)(scope);
    scope.$digest();

    const comments = Array.from(tbody.childNodes).filter((n) => n.nodeType === Node.COMMENT_NODE) as Comment[];
    expect(comments.length).toBe(1);
    expect(comments[0]?.data).toContain('ngIf');
  });

  it('preserves position relative to siblings outside the range', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = false;

    const tbody = document.createElement('tbody');
    tbody.appendChild(tr({}, 'header'));
    tbody.appendChild(tr({ 'ng-if-start': 'show' }, 'r1'));
    tbody.appendChild(tr({ 'ng-if-end': '' }, 'r2'));
    tbody.appendChild(tr({}, 'footer'));

    b.$compile(tbody)(scope);
    scope.$digest();
    expect(rowsOf(tbody).map((r) => r.textContent)).toEqual(['header', 'footer']);

    scope.show = true;
    scope.$digest();
    expect(rowsOf(tbody).map((r) => r.textContent)).toEqual(['header', 'r1', 'r2', 'footer']);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('teardown destroys the range clone scope (watchers stop firing)', () => {
    const b = bootstrap();
    const root = Scope.create();
    const scope = root.$new();
    scope.show = true;
    let fireCount = 0;

    const tbody = document.createElement('tbody');
    const start = tr({ 'ng-if-start': 'show' }, '{{ probe() }}');
    tbody.appendChild(start);
    tbody.appendChild(tr({ 'ng-if-end': '' }, 'last'));
    scope.probe = () => {
      fireCount += 1;
      return 'p';
    };

    b.$compile(tbody)(scope);
    root.$digest();
    expect(rowsOf(tbody).length).toBe(2);
    const afterMount = fireCount;
    expect(afterMount).toBeGreaterThan(0);

    // Flip falsy → clone scope $destroy()'d → its watcher stops.
    scope.show = false;
    root.$digest();
    const afterUnmount = fireCount;
    root.$digest();
    // No additional probe() calls after the range was torn down.
    expect(fireCount).toBe(afterUnmount);
    expect(rowsOf(tbody).length).toBe(0);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('the single-element ng-if form is unchanged', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = true;

    const parent = document.createElement('div');
    const host = document.createElement('p');
    host.setAttribute('ng-if', 'show');
    host.textContent = 'solo';
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();
    expect(Array.from(parent.querySelectorAll('p')).map((p) => p.textContent)).toEqual(['solo']);

    scope.show = false;
    scope.$digest();
    expect(parent.querySelectorAll('p').length).toBe(0);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. ng-switch-when-start/-end & ng-switch-default-start/-end
// ---------------------------------------------------------------------------

describe('multi-element ng-switch — when/default start/end range (FS §2.1)', () => {
  it('selects the WHOLE range for the matching when-case', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.role = 'admin';

    const switchEl = document.createElement('tbody');
    switchEl.setAttribute('ng-switch', 'role');
    switchEl.appendChild(tr({ 'ng-switch-when-start': 'admin' }, 'admin-1'));
    switchEl.appendChild(tr({ 'ng-switch-when-end': '' }, 'admin-2'));
    switchEl.appendChild(tr({ 'ng-switch-when-start': 'member' }, 'member-1'));
    switchEl.appendChild(tr({ 'ng-switch-when-end': '' }, 'member-2'));

    b.$compile(switchEl)(scope);
    scope.$digest();

    expect(rowsOf(switchEl).map((r) => r.textContent)).toEqual(['admin-1', 'admin-2']);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('switching the value deselects one whole range and selects another', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.role = 'admin';

    const switchEl = document.createElement('tbody');
    switchEl.setAttribute('ng-switch', 'role');
    switchEl.appendChild(tr({ 'ng-switch-when-start': 'admin' }, 'admin-1'));
    switchEl.appendChild(tr({ 'ng-switch-when-end': '' }, 'admin-2'));
    switchEl.appendChild(tr({ 'ng-switch-when-start': 'member' }, 'member-1'));
    switchEl.appendChild(tr({ 'ng-switch-when-end': '' }, 'member-2'));

    b.$compile(switchEl)(scope);
    scope.$digest();
    expect(rowsOf(switchEl).map((r) => r.textContent)).toEqual(['admin-1', 'admin-2']);

    scope.role = 'member';
    scope.$digest();
    expect(rowsOf(switchEl).map((r) => r.textContent)).toEqual(['member-1', 'member-2']);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('shows the default-case range when no when matches', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.role = 'guest';

    const switchEl = document.createElement('tbody');
    switchEl.setAttribute('ng-switch', 'role');
    switchEl.appendChild(tr({ 'ng-switch-when-start': 'admin' }, 'admin-1'));
    switchEl.appendChild(tr({ 'ng-switch-when-end': '' }, 'admin-2'));
    switchEl.appendChild(tr({ 'ng-switch-default-start': '' }, 'def-1'));
    switchEl.appendChild(tr({ 'ng-switch-default-end': '' }, 'def-2'));

    b.$compile(switchEl)(scope);
    scope.$digest();

    expect(rowsOf(switchEl).map((r) => r.textContent)).toEqual(['def-1', 'def-2']);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('deselects the default range when a when-case starts matching', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.role = 'guest';

    const switchEl = document.createElement('tbody');
    switchEl.setAttribute('ng-switch', 'role');
    switchEl.appendChild(tr({ 'ng-switch-when-start': 'admin' }, 'admin-1'));
    switchEl.appendChild(tr({ 'ng-switch-when-end': '' }, 'admin-2'));
    switchEl.appendChild(tr({ 'ng-switch-default-start': '' }, 'def-1'));
    switchEl.appendChild(tr({ 'ng-switch-default-end': '' }, 'def-2'));

    b.$compile(switchEl)(scope);
    scope.$digest();
    expect(rowsOf(switchEl).map((r) => r.textContent)).toEqual(['def-1', 'def-2']);

    scope.role = 'admin';
    scope.$digest();
    expect(rowsOf(switchEl).map((r) => r.textContent)).toEqual(['admin-1', 'admin-2']);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('includes a node between the when-start/end endpoints in the selected group', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.role = 'admin';

    const switchEl = document.createElement('tbody');
    switchEl.setAttribute('ng-switch', 'role');
    switchEl.appendChild(tr({ 'ng-switch-when-start': 'admin' }, 'a-1'));
    switchEl.appendChild(tr({}, 'a-mid')); // between endpoints — part of the case
    switchEl.appendChild(tr({ 'ng-switch-when-end': '' }, 'a-3'));

    b.$compile(switchEl)(scope);
    scope.$digest();

    expect(rowsOf(switchEl).map((r) => r.textContent)).toEqual(['a-1', 'a-mid', 'a-3']);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('the single-element ng-switch-when / ng-switch-default form is unchanged', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.role = 'member';

    const switchEl = document.createElement('div');
    switchEl.setAttribute('ng-switch', 'role');
    const admin = document.createElement('span');
    admin.setAttribute('ng-switch-when', 'admin');
    admin.textContent = 'admin';
    const member = document.createElement('span');
    member.setAttribute('ng-switch-when', 'member');
    member.textContent = 'member';
    const def = document.createElement('span');
    def.setAttribute('ng-switch-default', '');
    def.textContent = 'default';
    switchEl.appendChild(admin);
    switchEl.appendChild(member);
    switchEl.appendChild(def);

    b.$compile(switchEl)(scope);
    scope.$digest();
    expect(Array.from(switchEl.querySelectorAll('span')).map((s) => s.textContent)).toEqual(['member']);

    scope.role = 'nope';
    scope.$digest();
    expect(Array.from(switchEl.querySelectorAll('span')).map((s) => s.textContent)).toEqual(['default']);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Nested ranged directives
// ---------------------------------------------------------------------------

describe('multi-element — nested ranged directives (FS §2.1)', () => {
  it('an INNER ng-if range inside an OUTER ng-repeat range renders correctly', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.items = [
      { label: 'O1', show: true },
      { label: 'O2', show: false },
    ];

    // <tr ng-repeat-start="o in items">{{o.label}}</tr>
    //   <tr ng-if-start="o.show">inner-a</tr>
    //   <tr ng-if-end>inner-b</tr>
    // <tr ng-repeat-end>repeat-end</tr>
    const tbody = document.createElement('tbody');
    tbody.appendChild(tr({ 'ng-repeat-start': 'o in items' }, '{{ o.label }}'));
    tbody.appendChild(tr({ 'ng-if-start': 'o.show' }, 'inner-a'));
    tbody.appendChild(tr({ 'ng-if-end': '' }, 'inner-b'));
    tbody.appendChild(tr({ 'ng-repeat-end': '' }, 'repeat-end'));

    b.$compile(tbody)(scope);
    scope.$digest();

    // O1 (show=true): O1, inner-a, inner-b, repeat-end
    // O2 (show=false): O2, repeat-end
    expect(rowsOf(tbody).map((r) => r.textContent)).toEqual([
      'O1',
      'inner-a',
      'inner-b',
      'repeat-end',
      'O2',
      'repeat-end',
    ]);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('toggling the inner ng-if range adds/removes its nodes within the outer group', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.items = [{ label: 'O1', show: false }];

    const tbody = document.createElement('tbody');
    tbody.appendChild(tr({ 'ng-repeat-start': 'o in items' }, '{{ o.label }}'));
    tbody.appendChild(tr({ 'ng-if-start': 'o.show' }, 'inner-a'));
    tbody.appendChild(tr({ 'ng-if-end': '' }, 'inner-b'));
    tbody.appendChild(tr({ 'ng-repeat-end': '' }, 'repeat-end'));

    b.$compile(tbody)(scope);
    scope.$digest();
    expect(rowsOf(tbody).map((r) => r.textContent)).toEqual(['O1', 'repeat-end']);

    scope.items = [{ label: 'O1', show: true }];
    scope.$digest();
    expect(rowsOf(tbody).map((r) => r.textContent)).toEqual(['O1', 'inner-a', 'inner-b', 'repeat-end']);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('an INNER ng-if range nested inside an OUTER ng-if range mounts/unmounts together', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.outer = true;
    scope.inner = true;

    const tbody = document.createElement('tbody');
    tbody.appendChild(tr({ 'ng-if-start': 'outer' }, 'o-head'));
    tbody.appendChild(tr({ 'ng-if-start': 'inner' }, 'i-a'));
    tbody.appendChild(tr({ 'ng-if-end': '' }, 'i-b'));
    tbody.appendChild(tr({ 'ng-if-end': '' }, 'o-tail'));

    b.$compile(tbody)(scope);
    scope.$digest();
    expect(rowsOf(tbody).map((r) => r.textContent)).toEqual(['o-head', 'i-a', 'i-b', 'o-tail']);

    // Drop the inner range only.
    scope.inner = false;
    scope.$digest();
    expect(rowsOf(tbody).map((r) => r.textContent)).toEqual(['o-head', 'o-tail']);

    // Drop the outer range — everything goes.
    scope.outer = false;
    scope.$digest();
    expect(rowsOf(tbody).length).toBe(0);

    // Bring the outer back; inner is still false.
    scope.outer = true;
    scope.$digest();
    expect(rowsOf(tbody).map((r) => r.textContent)).toEqual(['o-head', 'o-tail']);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });
});
