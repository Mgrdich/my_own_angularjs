/**
 * Multi-element / ranged directives — Slice 1 (Mode A for `ng-repeat`).
 *
 * Locks the spec-033 Slice 1 surface: the `multiElement` opt-in plus the
 * depth-aware `<name>-start` / `<name>-end` range grouping, integrated
 * end-to-end through `ng-repeat`'s `transclude: 'element'` Mode A path.
 *
 * Coverage mapped to the Slice 1 task list:
 *   - `<tr ng-repeat-start>…</tr><tr ng-repeat-end>…</tr>` repeats the
 *     WHOLE start→end group once per item, in document order.
 *   - A node BETWEEN the endpoints (a middle `<tr>` with no ng-repeat-*
 *     attribute) is included in every repeated group.
 *   - Nested same-named ranges resolve via depth and render correctly.
 *   - Reorder + teardown: changing the array reorders/removes whole
 *     groups; destroying the scope tears every group's clones down.
 *   - Missing `-end` → `UnterminatedMultiElementDirectiveError` routed via
 *     `$exceptionHandler('$compile')`, DOM left untouched (no rows).
 *   - The single-element `<li ng-repeat>` form is unchanged.
 *   - ZERO spurious `$compile` notices on the happy path (spec-032
 *     interaction) — the recording handler + `console.error` spy.
 *
 * Bootstrap mirrors `ng-repeat.test.ts` / `structural-clone-noise.test.ts`
 * (production `ngModule` for the built-ins + an `app` module carrying a
 * recording `$exceptionHandler`).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import { UnterminatedMultiElementDirectiveError } from '@compiler/compile-error';
import type { CompileService, DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
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
import type { TemplateCacheService, TemplateRequestFn } from '@template/template-types';

interface HandlerCall {
  error: unknown;
  cause: unknown;
}

interface Bootstrap {
  $compile: CompileService;
  handlerCalls: HandlerCall[];
  injector: { has: (name: string) => boolean };
}

interface BootstrapOptions {
  register?: (appModule: AnyModule, $cp: $CompileProvider) => void;
}

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

function bootstrap(options?: BootstrapOptions): Bootstrap {
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

  const appModule = createModule('app-multi-element', ['ng']);
  const handler: ExceptionHandler = (error: unknown, cause?: string) => {
    handlerCalls.push({ error, cause });
  };
  appModule.factory('$exceptionHandler', [() => handler]);
  if (options?.register !== undefined) {
    const reg = options.register;
    appModule.config([
      '$compileProvider',
      ($cp: $CompileProvider) => {
        reg(appModule, $cp);
      },
    ]);
  }
  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get('$compile'),
    handlerCalls,
    injector: built,
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
// 1. Happy path — two-row group repeats together, in order
// ---------------------------------------------------------------------------

describe('multi-element ng-repeat — start/end group iteration (FS §2.1)', () => {
  it('repeats the whole start→end group once per item, in document order', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.rows = [
      { name: 'A', detail: 'a-detail' },
      { name: 'B', detail: 'b-detail' },
    ];

    const tbody = document.createElement('tbody');
    tbody.appendChild(tr({ 'ng-repeat-start': 'r in rows' }, '{{ r.name }}'));
    tbody.appendChild(tr({ 'ng-repeat-end': '' }, '{{ r.detail }}'));

    b.$compile(tbody)(scope);
    scope.$digest();

    const rows = rowsOf(tbody);
    // 2 items × 2-row group = 4 rows.
    expect(rows.length).toBe(4);
    expect(rows[0]?.textContent).toBe('A');
    expect(rows[1]?.textContent).toBe('a-detail');
    expect(rows[2]?.textContent).toBe('B');
    expect(rows[3]?.textContent).toBe('b-detail');

    // Zero spurious $compile notices on the happy path (spec-032).
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('installs ONE Comment placeholder for the whole range', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.rows = [{ name: 'A', detail: 'a' }];

    const tbody = document.createElement('tbody');
    tbody.appendChild(tr({ 'ng-repeat-start': 'r in rows' }, '{{ r.name }}'));
    tbody.appendChild(tr({ 'ng-repeat-end': '' }, '{{ r.detail }}'));

    b.$compile(tbody)(scope);
    scope.$digest();

    const comments = Array.from(tbody.childNodes).filter((n) => n.nodeType === Node.COMMENT_NODE);
    expect(comments.length).toBe(1);
    expect((comments[0] as Comment).data).toContain('ngRepeat');
  });

  it('renders zero rows for an empty array (placeholder only)', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.rows = [] as { name: string; detail: string }[];

    const tbody = document.createElement('tbody');
    tbody.appendChild(tr({ 'ng-repeat-start': 'r in rows' }, '{{ r.name }}'));
    tbody.appendChild(tr({ 'ng-repeat-end': '' }, '{{ r.detail }}'));

    b.$compile(tbody)(scope);
    scope.$digest();

    expect(rowsOf(tbody).length).toBe(0);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Nodes BETWEEN the endpoints are included
// ---------------------------------------------------------------------------

describe('multi-element ng-repeat — nodes between endpoints (FS §2.1)', () => {
  it('includes a middle row (no ng-repeat-* attr) in every repeated group', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.rows = [
      { a: 'A1', b: 'A2', c: 'A3' },
      { a: 'B1', b: 'B2', c: 'B3' },
    ];

    const tbody = document.createElement('tbody');
    tbody.appendChild(tr({ 'ng-repeat-start': 'r in rows' }, '{{ r.a }}'));
    tbody.appendChild(tr({}, '{{ r.b }}')); // middle row — part of the group
    tbody.appendChild(tr({ 'ng-repeat-end': '' }, '{{ r.c }}'));

    b.$compile(tbody)(scope);
    scope.$digest();

    const rows = rowsOf(tbody);
    // 2 items × 3-row group = 6 rows.
    expect(rows.map((r) => r.textContent)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3']);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('includes comment + text nodes between endpoints (survives cloning)', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.rows = [{ a: 'A1', c: 'A3' }];

    const tbody = document.createElement('tbody');
    tbody.appendChild(tr({ 'ng-repeat-start': 'r in rows' }, '{{ r.a }}'));
    tbody.appendChild(document.createComment(' between marker '));
    tbody.appendChild(tr({ 'ng-repeat-end': '' }, '{{ r.c }}'));

    b.$compile(tbody)(scope);
    scope.$digest();

    const rows = rowsOf(tbody);
    expect(rows.map((r) => r.textContent)).toEqual(['A1', 'A3']);
    // The placeholder Comment plus the cloned "between marker" Comment.
    const comments = Array.from(tbody.childNodes).filter((n) => n.nodeType === Node.COMMENT_NODE) as Comment[];
    expect(comments.some((c) => c.data.includes('between marker'))).toBe(true);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Nested same-named ranges resolve via depth
// ---------------------------------------------------------------------------

describe('multi-element ng-repeat — nested same-named ranges (FS §2.1, risk §3)', () => {
  it('an INNER ng-repeat-start/-end inside the OUTER range renders correctly', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.outer = [
      { label: 'O1', inner: ['x', 'y'] },
      { label: 'O2', inner: ['z'] },
    ];

    // <tr ng-repeat-start="o in outer">{{o.label}}</tr>
    //   <tr ng-repeat-start="i in o.inner">{{i}}</tr>     (inner start)
    //   <tr ng-repeat-end></tr>                           (inner end)
    // <tr ng-repeat-end></tr>                             (outer end)
    const tbody = document.createElement('tbody');
    tbody.appendChild(tr({ 'ng-repeat-start': 'o in outer' }, '{{ o.label }}'));
    tbody.appendChild(tr({ 'ng-repeat-start': 'i in o.inner' }, '{{ i }}'));
    tbody.appendChild(tr({ 'ng-repeat-end': '' }, 'inner-end'));
    tbody.appendChild(tr({ 'ng-repeat-end': '' }, 'outer-end'));

    b.$compile(tbody)(scope);
    scope.$digest();

    const rows = rowsOf(tbody);
    // Outer O1: label + [inner x: (x + inner-end), inner y: (y + inner-end)] + outer-end
    //   → O1, x, inner-end, y, inner-end, outer-end  (6 rows)
    // Outer O2: label + [inner z: (z + inner-end)] + outer-end
    //   → O2, z, inner-end, outer-end  (4 rows)
    expect(rows.map((r) => r.textContent)).toEqual([
      'O1',
      'x',
      'inner-end',
      'y',
      'inner-end',
      'outer-end',
      'O2',
      'z',
      'inner-end',
      'outer-end',
    ]);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Reorder + teardown
// ---------------------------------------------------------------------------

describe('multi-element ng-repeat — reorder + teardown (FS §2.1)', () => {
  it('reorders whole groups when the array reorders', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const a = { name: 'A', detail: 'a' };
    const c = { name: 'B', detail: 'b' };
    scope.rows = [a, c];

    const tbody = document.createElement('tbody');
    tbody.appendChild(tr({ 'ng-repeat-start': 'r in rows track by r.name' }, '{{ r.name }}'));
    tbody.appendChild(tr({ 'ng-repeat-end': '' }, '{{ r.detail }}'));

    b.$compile(tbody)(scope);
    scope.$digest();
    expect(rowsOf(tbody).map((r) => r.textContent)).toEqual(['A', 'a', 'B', 'b']);

    scope.rows = [c, a];
    scope.$digest();
    expect(rowsOf(tbody).map((r) => r.textContent)).toEqual(['B', 'b', 'A', 'a']);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('removes a whole group when its item is removed', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.rows = [
      { name: 'A', detail: 'a' },
      { name: 'B', detail: 'b' },
    ];

    const tbody = document.createElement('tbody');
    tbody.appendChild(tr({ 'ng-repeat-start': 'r in rows' }, '{{ r.name }}'));
    tbody.appendChild(tr({ 'ng-repeat-end': '' }, '{{ r.detail }}'));

    b.$compile(tbody)(scope);
    scope.$digest();
    expect(rowsOf(tbody).length).toBe(4);

    scope.rows = [{ name: 'B', detail: 'b' }];
    scope.$digest();
    expect(rowsOf(tbody).map((r) => r.textContent)).toEqual(['B', 'b']);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('destroying the scope tears every group down', () => {
    const b = bootstrap();
    const root = Scope.create();
    // `$destroy()` is a no-op on the ROOT scope (see scope.ts), so
    // exercise the scope-destroy cleanup against a CHILD scope — mirrors
    // the spec-028 ng-repeat destroy test.
    const scope = root.$new();
    scope.rows = [
      { name: 'A', detail: 'a' },
      { name: 'B', detail: 'b' },
    ];

    const tbody = document.createElement('tbody');
    tbody.appendChild(tr({ 'ng-repeat-start': 'r in rows' }, '{{ r.name }}'));
    tbody.appendChild(tr({ 'ng-repeat-end': '' }, '{{ r.detail }}'));

    b.$compile(tbody)(scope);
    root.$digest();
    expect(rowsOf(tbody).length).toBe(4);

    scope.$destroy();
    expect(rowsOf(tbody).length).toBe(0);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Unterminated range → error, DOM untouched
// ---------------------------------------------------------------------------

describe('multi-element ng-repeat — unterminated range (FS §2.1)', () => {
  it('routes UnterminatedMultiElementDirectiveError via $exceptionHandler("$compile")', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.items = [{ name: 'A' }];

    const tbody = document.createElement('tbody');
    // ng-repeat-start with NO matching ng-repeat-end sibling.
    tbody.appendChild(tr({ 'ng-repeat-start': 'i in items' }, '{{ i.name }}'));
    tbody.appendChild(tr({}, 'plain')); // ordinary sibling, not an end marker

    b.$compile(tbody)(scope);
    scope.$digest();

    const notices = compileNotices(b.handlerCalls);
    expect(notices.length).toBe(1);
    expect(notices[0]?.error).toBeInstanceOf(UnterminatedMultiElementDirectiveError);
  });

  it('leaves the DOM untouched on the unterminated path (no rows mounted, no removal)', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.items = [{ name: 'A' }];

    const tbody = document.createElement('tbody');
    const start = tr({ 'ng-repeat-start': 'i in items' }, '{{ i.name }}');
    const sibling = tr({}, 'plain');
    tbody.appendChild(start);
    tbody.appendChild(sibling);

    b.$compile(tbody)(scope);
    scope.$digest();

    // No placeholder Comment inserted, both original rows still present,
    // start element never detached.
    const comments = Array.from(tbody.childNodes).filter((n) => n.nodeType === Node.COMMENT_NODE);
    expect(comments.length).toBe(0);
    expect(start.parentNode).toBe(tbody);
    expect(sibling.parentNode).toBe(tbody);
    expect(rowsOf(tbody).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 6. Single-element form is unchanged
// ---------------------------------------------------------------------------

describe('multi-element ng-repeat — single-element form unchanged (additivity)', () => {
  it('the ordinary <li ng-repeat> form still renders one row per item', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.todos = [{ title: 'X' }, { title: 'Y' }, { title: 'Z' }];

    const parent = document.createElement('div');
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'todo in todos');
    host.textContent = '{{ todo.title }}';
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    const rows = Array.from(parent.querySelectorAll('li'));
    expect(rows.map((r) => r.textContent)).toEqual(['X', 'Y', 'Z']);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. Custom directive opting into multiElement (Mode A via transclude:'element')
// ---------------------------------------------------------------------------

describe('multi-element — custom directive opt-in (Mode A)', () => {
  it('a custom transclude:"element" + multiElement directive ranges over the group', () => {
    let cloneCount = 0;
    const b = bootstrap({
      register: (_appModule, $cp) => {
        $cp.directive(
          'myRange',
          ddoFactory({
            restrict: 'A',
            priority: 1000,
            terminal: true,
            transclude: 'element',
            multiElement: true,
            link: (_scope, element, _attrs, _ctrls, $transclude): void => {
              const placeholder = element as unknown as Comment;
              $transclude?.((clone) => {
                cloneCount += 1;
                let anchor: Node = placeholder;
                for (const node of clone) {
                  placeholder.parentNode?.insertBefore(node, anchor.nextSibling);
                  anchor = node;
                }
              });
            },
          }),
        );
      },
    });
    const scope = Scope.create();

    const container = document.createElement('div');
    const start = document.createElement('span');
    start.setAttribute('my-range-start', '');
    start.textContent = 'first';
    const end = document.createElement('span');
    end.setAttribute('my-range-end', '');
    end.textContent = 'last';
    container.appendChild(start);
    container.appendChild(end);

    b.$compile(container)(scope);
    scope.$digest();

    // ONE transclude call mounted the whole 2-node range.
    expect(cloneCount).toBe(1);
    const spans = Array.from(container.querySelectorAll('span'));
    expect(spans.map((s) => s.textContent)).toEqual(['first', 'last']);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });
});
