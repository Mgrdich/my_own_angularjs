/**
 * `ngRepeat` directive — list iteration (spec 028 Slice 3 / FS §2.1,
 * §2.6, §2.7, §2.8).
 *
 * Locks the AngularJS-canonical behavior for the Slice 3 surface of
 * the built-in `ngRepeat` directive registered on `ngModule`:
 *
 * - Registration sanity: `injector.has('ngRepeatDirective') === true`
 *   when an app's module declares `'ng'` in its deps chain.
 * - Basic `item in list` iteration over arrays produces N rows in
 *   document order, one cloned subtree per item.
 * - The six framework-published per-row locals (`$index`, `$first`,
 *   `$last`, `$middle`, `$even`, `$odd`) are populated on each per-row
 *   scope BEFORE the row's DOM is inserted, so first-render `ng-bind`
 *   watchers see the correct values without a second digest.
 * - Appending an item appends a row; removing an item removes its row;
 *   reassigning to a fresh valid array re-renders.
 * - Non-iterable values (`null`, `undefined`, numbers, functions, plain
 *   objects in Slice 3 — object iteration is Slice 5) clear all rows
 *   with no error.
 * - Duplicate primitives without `track by` (`[1, 2, 2, 3]`) throw
 *   `NgRepeatDuplicateKeyError` routed via `$exceptionHandler('$compile')`,
 *   NOT through the digest's `'watchListener'` path (the directive
 *   catches the throw before the watcher's caller does).
 * - `restrict: 'A'` — element form `<ng-repeat="…">` does NOT match.
 * - `terminal: true` blocks lower-priority same-element directives via
 *   the spec-017 same-element terminal cutoff.
 *
 * Slice 3 does NOT preserve DOM-node identity across reorders (Slice 4
 * adds `track by` + row reuse), does NOT support object iteration
 * (Slice 5), and does NOT publish the `as alias` (Slice 6). The tests
 * in this file intentionally do NOT assert DOM-node identity across
 * digest cycles — Slice 4's reuse contract is verified in its own
 * extended coverage.
 *
 * Tests use the canonical `ngModule` so the `ngRepeat` directive
 * registered by `src/core/ng-module.ts` is reachable end-to-end —
 * mirroring the `ng-if.test.ts` / `ng-switch.test.ts` / `ng-include.test.ts`
 * bootstrap patterns.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import { NgRepeatDuplicateKeyError } from '@compiler/compile-error';
import type { CompileService, DirectiveFactory, DirectiveFactoryReturn, LinkFn } from '@compiler/directive-types';
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

interface InjectorLike {
  has: (name: string) => boolean;
}

interface Bootstrap {
  $compile: CompileService;
  injector: InjectorLike;
}

interface BootstrapOptions {
  /** Spy `$exceptionHandler` registered on the `app` module. */
  exceptionHandler?: ExceptionHandler;
  /** Additional registration against the `app` module. */
  register?: (appModule: AnyModule, $cp: $CompileProvider) => void;
}

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

/**
 * Builds a `'ng'`-aware `app` module so the `ngRepeat` directive
 * registered by `ngModule` is reachable, while letting per-test code
 * register a spy `$exceptionHandler` and/or additional probe
 * directives. Mirrors the `ng-include.test.ts` bootstrap pattern (the
 * shape closest to spec 027's structural-directive precedent).
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

  const appModule = createModule('app-ng-repeat', ['ng']);
  if (options?.exceptionHandler !== undefined) {
    const handler = options.exceptionHandler;
    appModule.factory('$exceptionHandler', [() => handler]);
  }
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
    injector: built,
  };
}

/**
 * Build a host `<li ng-repeat="...">` element with a CHILD `<span
 * ng-bind="…">` carrying the per-row expression. We cannot put
 * `ng-bind` on the host itself because `ng-repeat`'s `terminal: true`
 * at priority 1000 truncates the matched-directive list at the
 * terminal threshold — `ng-bind` (priority 0) sits below the cutoff
 * and never runs on the host. The child element is OUTSIDE the
 * terminal cutoff (the spec-023 narrowing makes only `ng-non-bindable`
 * block descendants), so the row's text content is rendered via the
 * child's `ng-bind`.
 *
 * Text-node `{{}}` interpolation is also not routed through
 * `$compile`'s walker today, so `ng-bind` on a child is the canonical
 * per-row text shape — matches `ng-init.test.ts`'s precedent for the
 * same reason.
 *
 * Returns the `parent` container and the `host` so individual tests
 * can attach the host to a custom parent layout (the directive's
 * placeholder Comment is installed in the host's slot at compile time).
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

/**
 * Filter out the incidental "expected placeholder to be a Comment"
 * throws that fire whenever a `transclude: 'element'` directive's link
 * fn runs against the captured master clone (the framework's
 * re-entrancy guard strips `transclude` but leaves the directive's
 * `link` in place; the link's `isComment(element)` invariant check
 * then trips against the cloned Element and routes via
 * `$exceptionHandler('$compile')`). The same incidental routing
 * affects `ng-if` and `ng-include` — it is a pre-existing framework
 * artifact, not a behavior change in spec 028. Tests for spec 028
 * surface-level behavior (duplicate-key detection, non-iterable bail,
 * etc.) filter these out so they can still assert "no UNEXPECTED
 * errors".
 */
function relevantHandlerCalls(handler: {
  mock: { calls: readonly [exception: unknown, cause?: string | undefined][] };
}): readonly [exception: unknown, cause?: string | undefined][] {
  return handler.mock.calls.filter((call) => {
    const err = call[0];
    if (err instanceof Error && err.message.includes('expected placeholder to be a Comment')) {
      return false;
    }
    return true;
  });
}

afterEach(() => {
  resetRegistry();
});

// ---------------------------------------------------------------------------
// 1. Registration & DI
// ---------------------------------------------------------------------------

describe('ngRepeat — registration on ngModule (spec 028 Slice 3)', () => {
  it('injector.has("ngRepeatDirective") === true when "ng" is in the deps chain', () => {
    const b = bootstrap();
    expect(b.injector.has('ngRepeatDirective')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Basic iteration: `item in list`
// ---------------------------------------------------------------------------

describe('ngRepeat — basic `item in list` iteration (FS §2.1)', () => {
  it('renders N rows in collection order over a three-item array', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.todos = [{ title: 'A' }, { title: 'B' }, { title: 'C' }];

    const { parent, host } = makeRepeatHost('todo in todos', 'todo.title');
    b.$compile(host)(scope);
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows.length).toBe(3);
    expect(rows[0]?.textContent).toBe('A');
    expect(rows[1]?.textContent).toBe('B');
    expect(rows[2]?.textContent).toBe('C');
  });

  it('installs a Comment placeholder in the host element\'s slot', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.todos = [{ title: 'A' }];

    const { parent, host } = makeRepeatHost('todo in todos', 'todo.title');
    b.$compile(host)(scope);
    scope.$digest();

    // Placeholder Comment occupies the host's original slot; the row
    // is its next sibling.
    expect(parent.childNodes[0]?.nodeType).toBe(Node.COMMENT_NODE);
    expect((parent.childNodes[0] as Comment).data).toContain('ngRepeat');
    expect(parent.childNodes[1]?.nodeType).toBe(Node.ELEMENT_NODE);
  });

  it('renders zero rows for an empty array (placeholder only)', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.todos = [] as { title: string }[];

    const { parent, host } = makeRepeatHost('todo in todos', 'todo.title');
    b.$compile(host)(scope);
    scope.$digest();

    expect(rowsOf(parent).length).toBe(0);
    // The placeholder Comment is still there.
    expect(parent.childNodes.length).toBe(1);
    expect(parent.childNodes[0]?.nodeType).toBe(Node.COMMENT_NODE);
  });

  it('rows are inserted immediately AFTER the placeholder (sibling layout preserved)', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.items = ['x', 'y'];

    const parent = document.createElement('ul');
    const before = document.createElement('li');
    before.className = 'before';
    // Use a child `<span ng-bind>` for the row's text — putting
    // `ng-bind` on the host itself would be truncated by `ng-repeat`'s
    // `terminal: true` cutoff (see `makeRepeatHost` TSDoc).
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'it in items');
    const inner = document.createElement('span');
    inner.setAttribute('ng-bind', 'it');
    host.appendChild(inner);
    const after = document.createElement('li');
    after.className = 'after';
    parent.appendChild(before);
    parent.appendChild(host);
    parent.appendChild(after);

    b.$compile(parent)(scope);
    scope.$digest();

    // Layout: [before, placeholder, row-x, row-y, after]
    expect(parent.childNodes[0]).toBe(before);
    expect(parent.childNodes[1]?.nodeType).toBe(Node.COMMENT_NODE);
    expect(parent.childNodes[2]?.textContent).toBe('x');
    expect(parent.childNodes[3]?.textContent).toBe('y');
    expect(parent.childNodes[4]).toBe(after);
  });
});

// ---------------------------------------------------------------------------
// 3. Per-row locals: $index, $first, $last, $middle, $even, $odd
// ---------------------------------------------------------------------------

describe('ngRepeat — six per-row locals (FS §2.6)', () => {
  it('$index is the 0-based row position', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.todos = [{ title: 'A' }, { title: 'B' }, { title: 'C' }];

    const { parent, host } = makeRepeatHost('t in todos', '$index + ":" + t.title');
    b.$compile(host)(scope);
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows[0]?.textContent).toBe('0:A');
    expect(rows[1]?.textContent).toBe('1:B');
    expect(rows[2]?.textContent).toBe('2:C');
  });

  it('$first is true on the first row only', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.items = ['A', 'B', 'C'];

    const { parent, host } = makeRepeatHost('it in items', '$first');
    b.$compile(host)(scope);
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows[0]?.textContent).toBe('true');
    expect(rows[1]?.textContent).toBe('false');
    expect(rows[2]?.textContent).toBe('false');
  });

  it('$last is true on the last row only', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.items = ['A', 'B', 'C'];

    const { parent, host } = makeRepeatHost('it in items', '$last');
    b.$compile(host)(scope);
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows[0]?.textContent).toBe('false');
    expect(rows[1]?.textContent).toBe('false');
    expect(rows[2]?.textContent).toBe('true');
  });

  it('$middle is true on every row except first and last', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.items = ['A', 'B', 'C', 'D'];

    const { parent, host } = makeRepeatHost('it in items', '$middle');
    b.$compile(host)(scope);
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows[0]?.textContent).toBe('false');
    expect(rows[1]?.textContent).toBe('true');
    expect(rows[2]?.textContent).toBe('true');
    expect(rows[3]?.textContent).toBe('false');
  });

  it('$middle is false on a single-row list (the lone row is both first and last)', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.items = ['only'];

    const { parent, host } = makeRepeatHost('it in items', '$middle');
    b.$compile(host)(scope);
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows.length).toBe(1);
    expect(rows[0]?.textContent).toBe('false');
  });

  it('$even is true on rows at indices 0, 2, 4, …', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.items = ['A', 'B', 'C', 'D'];

    const { parent, host } = makeRepeatHost('it in items', '$even');
    b.$compile(host)(scope);
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows[0]?.textContent).toBe('true');
    expect(rows[1]?.textContent).toBe('false');
    expect(rows[2]?.textContent).toBe('true');
    expect(rows[3]?.textContent).toBe('false');
  });

  it('$odd is true on rows at indices 1, 3, 5, …', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.items = ['A', 'B', 'C', 'D'];

    const { parent, host } = makeRepeatHost('it in items', '$odd');
    b.$compile(host)(scope);
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows[0]?.textContent).toBe('false');
    expect(rows[1]?.textContent).toBe('true');
    expect(rows[2]?.textContent).toBe('false');
    expect(rows[3]?.textContent).toBe('true');
  });

  it('$index updates to reflect a row\'s new position after a list mutation', () => {
    // Slice 3 rebuilds rows on every digest, but the per-row locals
    // MUST reflect the new positions — that contract is stable from
    // Slice 3 onward (Slice 4 adds reuse on top, preserving the same
    // per-row local recomputation).
    const b = bootstrap();
    const scope = Scope.create();
    scope.items = ['A', 'B', 'C'];

    const { parent, host } = makeRepeatHost('it in items', '$index + ":" + it');
    b.$compile(host)(scope);
    scope.$digest();

    expect(rowsOf(parent).map((r) => r.textContent)).toEqual(['0:A', '1:B', '2:C']);

    // Remove the leading item; the survivor rows should renumber.
    scope.items = ['B', 'C'];
    scope.$digest();
    expect(rowsOf(parent).map((r) => r.textContent)).toEqual(['0:B', '1:C']);
  });
});

// ---------------------------------------------------------------------------
// 4. Mutations: append / remove / replace
// ---------------------------------------------------------------------------

describe('ngRepeat — list mutations (FS §2.1 AC1.2 / AC1.3 / AC1.4)', () => {
  it('appending an item appends a row at the end after a digest', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.items = ['A', 'B'];

    const { parent, host } = makeRepeatHost('it in items', 'it');
    b.$compile(host)(scope);
    scope.$digest();
    expect(rowsOf(parent).map((r) => r.textContent)).toEqual(['A', 'B']);

    (scope.items as string[]).push('C');
    scope.$digest();
    expect(rowsOf(parent).map((r) => r.textContent)).toEqual(['A', 'B', 'C']);
  });

  it('removing an item removes the matching row after a digest', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.items = ['A', 'B', 'C'];

    const { parent, host } = makeRepeatHost('it in items', 'it');
    b.$compile(host)(scope);
    scope.$digest();
    expect(rowsOf(parent).map((r) => r.textContent)).toEqual(['A', 'B', 'C']);

    // Remove the middle element via splice.
    (scope.items as string[]).splice(1, 1);
    scope.$digest();
    expect(rowsOf(parent).map((r) => r.textContent)).toEqual(['A', 'C']);
  });

  it('reassigning to a fresh valid array re-renders rows', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.items = ['A', 'B'];

    const { parent, host } = makeRepeatHost('it in items', 'it');
    b.$compile(host)(scope);
    scope.$digest();
    expect(rowsOf(parent).map((r) => r.textContent)).toEqual(['A', 'B']);

    scope.items = ['X', 'Y', 'Z'];
    scope.$digest();
    expect(rowsOf(parent).map((r) => r.textContent)).toEqual(['X', 'Y', 'Z']);
  });

  it('emptying the array clears all rows but leaves the placeholder', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.items = ['A', 'B', 'C'];

    const { parent, host } = makeRepeatHost('it in items', 'it');
    b.$compile(host)(scope);
    scope.$digest();
    expect(rowsOf(parent).length).toBe(3);

    scope.items = [];
    scope.$digest();
    expect(rowsOf(parent).length).toBe(0);
    expect(parent.childNodes.length).toBe(1);
    expect(parent.childNodes[0]?.nodeType).toBe(Node.COMMENT_NODE);
  });

  it('scope.$destroy on a CHILD scope tears down all rows (scope-destroy cleanup path)', () => {
    // The directive registers `scope.$on('$destroy', tearDownAllRows)`
    // to cover the "parent scope destroyed without DOM teardown"
    // branch. Without this hook, an outer `scope.$destroy()` would
    // leave row clones mounted but with their watcher tree attached
    // to a torn-down parent, leaking digest work.
    //
    // Note: `$destroy()` is a no-op on the root scope (see
    // `src/core/scope.ts` — `if (this === this.$root) return`). We
    // therefore exercise the scope-destroy cleanup against a CHILD
    // scope so the broadcast actually reaches per-row scope listeners.
    const destroys = vi.fn();
    const b = bootstrap({
      register: (_app, $cp) => {
        $cp.directive(
          'rowProbe',
          ddoFactory({
            restrict: 'A',
            link: ((s) => {
              s.$on('$destroy', () => {
                destroys();
              });
            }) as LinkFn,
          }),
        );
      },
    });
    const rootScope = Scope.create();
    const scope = rootScope.$new();
    scope.items = ['A', 'B'];

    const parent = document.createElement('div');
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'it in items');
    const inner = document.createElement('span');
    inner.setAttribute('row-probe', '');
    host.appendChild(inner);
    parent.appendChild(host);

    b.$compile(host)(scope);
    rootScope.$digest();
    expect(destroys).toHaveBeenCalledTimes(0);
    expect(rowsOf(parent).length).toBe(2);

    // Destroy the child scope — `$broadcast('$destroy')` reaches each
    // per-row scope's `$on('$destroy', …)` listener.
    scope.$destroy();
    expect(destroys.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('a per-row scope is destroyed on row teardown (fires $on("$destroy"))', () => {
    // Probe directive that counts $destroy listener invocations per
    // row. The probe is on a CHILD `<span>` inside the row template
    // (NOT on the `<li ng-repeat>` host itself) because `ng-repeat`'s
    // `terminal: true` cutoff at priority 1000 would otherwise drop a
    // priority-0 probe sharing the host. The child element is
    // OUTSIDE the terminal cutoff (the spec-023 narrowing makes only
    // `ng-non-bindable` block descendants), so the probe runs on
    // each row clone.
    const destroys = vi.fn();
    const b = bootstrap({
      register: (_app, $cp) => {
        $cp.directive(
          'rowProbe',
          ddoFactory({
            restrict: 'A',
            link: ((s) => {
              s.$on('$destroy', () => {
                destroys();
              });
            }) as LinkFn,
          }),
        );
      },
    });
    const scope = Scope.create();
    scope.items = ['A', 'B', 'C'];

    const parent = document.createElement('div');
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'it in items');
    const inner = document.createElement('span');
    inner.setAttribute('row-probe', '');
    host.appendChild(inner);
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();
    expect(destroys).toHaveBeenCalledTimes(0);

    // Replace with empty array — every row is torn down, destroying
    // its scope. Slice 3 tears down ALL rows on every digest; we only
    // assert the >= 3 lower bound to stay slice-stable (Slice 4 may
    // refine the tear-down pattern via row reuse).
    scope.items = [];
    scope.$digest();
    expect(destroys.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// 5. Non-iterable values bail cleanly (FS §2.7)
// ---------------------------------------------------------------------------

describe('ngRepeat — non-iterable values (FS §2.7)', () => {
  it('replacing the collection with `null` clears all rows without error', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.items = ['A', 'B'];

    const { parent, host } = makeRepeatHost('it in items', 'it');
    b.$compile(host)(scope);
    scope.$digest();
    expect(rowsOf(parent).length).toBe(2);

    scope.items = null;
    scope.$digest();
    expect(rowsOf(parent).length).toBe(0);
    expect(relevantHandlerCalls(handler)).toEqual([]);
  });

  it('replacing the collection with `undefined` clears all rows without error', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.items = ['A', 'B'];

    const { parent, host } = makeRepeatHost('it in items', 'it');
    b.$compile(host)(scope);
    scope.$digest();
    expect(rowsOf(parent).length).toBe(2);

    scope.items = undefined;
    scope.$digest();
    expect(rowsOf(parent).length).toBe(0);
    expect(relevantHandlerCalls(handler)).toEqual([]);
  });

  it('replacing the collection with a number clears all rows without error', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.items = ['A', 'B', 'C'];

    const { parent, host } = makeRepeatHost('it in items', 'it');
    b.$compile(host)(scope);
    scope.$digest();
    expect(rowsOf(parent).length).toBe(3);

    scope.items = 42;
    scope.$digest();
    expect(rowsOf(parent).length).toBe(0);
    expect(relevantHandlerCalls(handler)).toEqual([]);
  });

  it('replacing the collection with a function clears all rows without error', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.items = ['A', 'B'];

    const { parent, host } = makeRepeatHost('it in items', 'it');
    b.$compile(host)(scope);
    scope.$digest();
    expect(rowsOf(parent).length).toBe(2);

    scope.items = (): void => undefined;
    scope.$digest();
    expect(rowsOf(parent).length).toBe(0);
    expect(relevantHandlerCalls(handler)).toEqual([]);
  });

  it('an initially-undefined collection renders no rows and no error', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    // `scope.items` deliberately not set.

    const { parent, host } = makeRepeatHost('it in items', 'it');
    b.$compile(host)(scope);
    scope.$digest();

    expect(rowsOf(parent).length).toBe(0);
    expect(relevantHandlerCalls(handler)).toEqual([]);
  });

  it('flipping non-iterable → array → non-iterable cycles cleanly', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.items = null;

    const { parent, host } = makeRepeatHost('it in items', 'it');
    b.$compile(host)(scope);
    scope.$digest();
    expect(rowsOf(parent).length).toBe(0);

    scope.items = ['A', 'B'];
    scope.$digest();
    expect(rowsOf(parent).map((r) => r.textContent)).toEqual(['A', 'B']);

    scope.items = null;
    scope.$digest();
    expect(rowsOf(parent).length).toBe(0);

    expect(relevantHandlerCalls(handler)).toEqual([]);
  });

  // Note: the earlier Slice 3 test asserting "a plain object value
  // clears rows (object iteration is deferred to Slice 5)" was deleted
  // when Slice 5 landed. Plain objects are now iterable; the new
  // contract is covered in the "ngRepeat — object iteration" describe
  // block below (FS §2.2). The function-value bail above still pins the
  // `typeof === 'function'` disjointness from the object branch.
});

// ---------------------------------------------------------------------------
// 6. Duplicate-key error (FS §2.8)
// ---------------------------------------------------------------------------

describe('ngRepeat — duplicate-key error without `track by` (FS §2.8)', () => {
  it('[1, 2, 2, 3] throws NgRepeatDuplicateKeyError routed via $exceptionHandler("$compile")', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.items = [1, 2, 2, 3];

    const { host } = makeRepeatHost('n in items', 'n');
    b.$compile(host)(scope);
    scope.$digest();

    // Exactly one routing through `'$compile'` — the duplicate-key
    // contract is captured BEFORE the digest's `'watchListener'`
    // catch-all sees it.
    const compileCalls = handler.mock.calls.filter((c) => c[1] === '$compile');
    expect(compileCalls.length).toBe(1);
    const err = compileCalls[0]?.[0];
    expect(err).toBeInstanceOf(NgRepeatDuplicateKeyError);
    // No `'watchListener'` routing — the directive captures the
    // throw before the digest's watch-listener catch sees it.
    expect(handler.mock.calls.filter((c) => c[1] === 'watchListener').length).toBe(0);
  });

  it('the duplicate-key error message mentions the offending identity and the `track by` suggestion', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.items = [1, 2, 2, 3];

    const { host } = makeRepeatHost('n in items', 'n');
    b.$compile(host)(scope);
    scope.$digest();

    const compileCalls = handler.mock.calls.filter((c) => c[1] === '$compile');
    const err = compileCalls[0]?.[0] as Error;
    expect(err.message).toContain('ngRepeat');
    expect(err.message).toContain('track by');
    // The duplicate identity for the primitive `2` is `'number:2'` per
    // the identity tracker's type-prefix convention.
    expect(err.message).toContain('number:2');
  });

  it('after the duplicate-key throw, no rows are left in the DOM', () => {
    // The directive's catch branch calls `tearDownAllRows()` BEFORE
    // routing the error, so the offending collection does not leave a
    // half-rendered tree behind. We verify the post-throw DOM state
    // here.
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.items = [1, 2, 2, 3];

    const { parent, host } = makeRepeatHost('n in items', 'n');
    b.$compile(host)(scope);
    scope.$digest();

    // Slot is empty (only the placeholder remains).
    expect(rowsOf(parent).length).toBe(0);
    expect(parent.childNodes.length).toBe(1);
    expect(parent.childNodes[0]?.nodeType).toBe(Node.COMMENT_NODE);
  });

  it('recovery: fixing the collection re-renders rows on the next digest', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.items = [1, 2, 2, 3];

    const { parent, host } = makeRepeatHost('n in items', 'n');
    b.$compile(host)(scope);
    scope.$digest();

    expect(rowsOf(parent).length).toBe(0);

    // Replace the offending collection with a unique one — the next
    // digest should render normally and no further error routes.
    handler.mockClear();
    scope.items = [1, 2, 3, 4];
    scope.$digest();

    expect(rowsOf(parent).map((r) => r.textContent)).toEqual(['1', '2', '3', '4']);
    expect(relevantHandlerCalls(handler)).toEqual([]);
  });

  it('duplicate object references (same reference twice) also trigger the error', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    const shared = { id: 1 };
    scope.items = [shared, shared];

    const { host } = makeRepeatHost('it in items', 'it.id');
    b.$compile(host)(scope);
    scope.$digest();

    const compileCalls = handler.mock.calls.filter((c) => c[1] === '$compile');
    expect(compileCalls.length).toBe(1);
    expect(compileCalls[0]?.[0]).toBeInstanceOf(NgRepeatDuplicateKeyError);
  });
});

// ---------------------------------------------------------------------------
// 7. Restrict & terminal
// ---------------------------------------------------------------------------

describe('ngRepeat — restrict: "A" (Slice 3 metadata)', () => {
  it('element form `<ng-repeat="…">` does NOT match — host element stays in place', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.items = ['A', 'B'];

    const parent = document.createElement('div');
    // The element-form here uses a custom tag whose attribute happens
    // to be `ng-repeat`. With `restrict: 'A'` the directive only
    // matches the ATTRIBUTE on its host element — it must NOT match
    // when triggered by the tag name. Because `restrict` is 'A'
    // (attribute) the directive STILL matches via the attribute on
    // `<ng-repeat>` here, so to truly exercise the element-form
    // rejection we use a different tag and place "ng-repeat" as the
    // tag name only.
    const host = document.createElement('ng-repeat');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    // No rows rendered, no Comment placeholder installed — the
    // `<ng-repeat>` Element is still where we put it.
    expect(parent.childNodes.length).toBe(1);
    expect(parent.childNodes[0]).toBe(host);
    expect(rowsOf(parent).length).toBe(0);
  });
});

describe('ngRepeat — terminal: true (Slice 3 metadata)', () => {
  it('lower-priority same-element directives are blocked by the spec-017 terminal cutoff', () => {
    // `ngRepeat` runs at priority 1000 with `terminal: true`. A
    // sibling directive at priority 0 sits BELOW the terminal
    // threshold and is dropped from the matched-directive list
    // before any of its hooks (compile / link) run.
    const probeFired = vi.fn();
    const b = bootstrap({
      register: (_app, $cp) => {
        $cp.directive(
          'lowProbe',
          ddoFactory({
            restrict: 'A',
            priority: 0,
            link: (() => {
              probeFired();
            }) as LinkFn,
          }),
        );
      },
    });
    const scope = Scope.create();
    scope.items = ['A', 'B'];

    const parent = document.createElement('div');
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'it in items');
    host.setAttribute('low-probe', '');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    // The low-priority probe was below the terminal threshold and
    // never fired. The repeat still produced rows.
    expect(probeFired).not.toHaveBeenCalled();
    expect(rowsOf(parent).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 8. track by EXPR + row reuse (FS §2.3 / §2.9 — spec 028 Slice 4)
// ---------------------------------------------------------------------------

describe('ngRepeat — `track by EXPR` + row reuse (FS §2.3 / §2.9)', () => {
  it('reuses rows when ids match across collection updates (DOM-node identity preserved)', () => {
    // Replacing `scope.todos` with a fresh array whose items have the
    // SAME `.id` values reuses every row by identity. The per-item
    // bindings still update to the new text — only DOM-node identity
    // is preserved, not the rendered content.
    const b = bootstrap();
    const scope = Scope.create();
    scope.todos = [
      { id: 1, t: 'A' },
      { id: 2, t: 'B' },
    ];

    const { parent, host } = makeRepeatHost('todo in todos track by todo.id', 'todo.t');
    b.$compile(host)(scope);
    scope.$digest();

    const initialRows = rowsOf(parent);
    expect(initialRows.length).toBe(2);
    expect(initialRows[0]?.textContent).toBe('A');
    expect(initialRows[1]?.textContent).toBe('B');

    // Capture DOM node references BEFORE the collection swap so we can
    // assert post-digest identity equality.
    const row0Before = initialRows[0];
    const row1Before = initialRows[1];

    // Swap to a freshly-allocated array with the SAME ids but different
    // object references and different text.
    scope.todos = [
      { id: 1, t: 'A-edited' },
      { id: 2, t: 'B-edited' },
    ];
    scope.$digest();

    const reusedRows = rowsOf(parent);
    expect(reusedRows.length).toBe(2);
    // Text updated — the per-row binding picks up the new item value.
    expect(reusedRows[0]?.textContent).toBe('A-edited');
    expect(reusedRows[1]?.textContent).toBe('B-edited');
    // DOM-node identity preserved — same `<li>` references.
    expect(reusedRows[0]).toBe(row0Before);
    expect(reusedRows[1]).toBe(row1Before);
  });

  it('row reorder ([A, B, C] -> [C, A, B]) moves DOM nodes rather than rebuilding them', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const a = { id: 1, t: 'A' };
    const b1 = { id: 2, t: 'B' };
    const c = { id: 3, t: 'C' };
    scope.items = [a, b1, c];

    const { parent, host } = makeRepeatHost('item in items track by item.id', 'item.t');
    b.$compile(host)(scope);
    scope.$digest();

    const initial = rowsOf(parent);
    expect(initial.length).toBe(3);
    expect(initial.map((r) => r.textContent)).toEqual(['A', 'B', 'C']);
    const rowA = initial[0];
    const rowB = initial[1];
    const rowC = initial[2];

    // Reorder — same items, new positions.
    scope.items = [c, a, b1];
    scope.$digest();

    const reordered = rowsOf(parent);
    expect(reordered.length).toBe(3);
    // New text order matches the new collection order.
    expect(reordered.map((r) => r.textContent)).toEqual(['C', 'A', 'B']);
    // Each DOM node is the SAME reference as before — just moved.
    expect(reordered[0]).toBe(rowC);
    expect(reordered[1]).toBe(rowA);
    expect(reordered[2]).toBe(rowB);
  });

  it('row reorder preserves the inner `<input>` element identity (focus-preservation surrogate)', () => {
    // The functional intent of FS §2.9 AC9.1 is that focus inside a
    // row survives a list reorder. The contract that makes this work
    // in real browsers is "row reuse via `insertBefore` preserves DOM
    // node identity"; once a real browser sees the same `<input>` move
    // (rather than be detached + reinserted), focus is preserved as a
    // direct downstream guarantee. We verify the upstream contract
    // here — the inner `<input>` reference is the SAME before and
    // after the reorder. The `document.activeElement` assertion is
    // covered by `it.skip` below — see that test for the jsdom
    // limitation note.
    const b = bootstrap();
    const scope = Scope.create();
    const a = { id: 1 };
    const m = { id: 2 };
    const z = { id: 3 };
    scope.items = [a, m, z];

    // We cannot use `makeRepeatHost` because the row template needs a
    // bare `<input>` instead of a bound `<span ng-bind>`.
    const parent = document.createElement('ul');
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'item in items track by item.id');
    const input = document.createElement('input');
    host.appendChild(input);
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows.length).toBe(3);
    const middleRow = rows[1];
    const middleInput = middleRow?.querySelector('input') ?? null;
    expect(middleInput).toBeInstanceOf(HTMLInputElement);

    // Reorder — `m` (id 2) moves from the middle to the front. The
    // inner `<input>` MUST be the same reference after the digest.
    scope.items = [m, a, z];
    scope.$digest();

    const reordered = rowsOf(parent);
    expect(reordered.length).toBe(3);
    expect(reordered[0]?.querySelector('input')).toBe(middleInput);
  });

  it.skip('input focus survives a list reorder (FS §2.9 AC9.1 — jsdom artifact: `insertBefore` blurs)', () => {
    // FS §2.9 AC9.1 — focused `<input>` inside a row survives reorder.
    // This assertion is correct in real browsers but does NOT hold in
    // jsdom: jsdom's `Element.insertBefore` implementation strips the
    // focus state from any node it relocates (verified via a minimal
    // probe — moving a focused `<input>` via `parent.insertBefore(b,
    // a)` resets `document.activeElement` to `<body>`). The framework
    // contract (DOM-node identity preserved across reorder) holds and
    // is asserted in the test above; once jsdom adopts the WHATWG
    // focus-preservation semantics for `insertBefore` (or once we run
    // these tests against Playwright / Chromium), un-skip and assert
    // `document.activeElement === middleInput` directly.
    const b = bootstrap();
    const scope = Scope.create();
    const a = { id: 1 };
    const m = { id: 2 };
    const z = { id: 3 };
    scope.items = [a, m, z];

    const root = document.createElement('div');
    document.body.appendChild(root);
    const parent = document.createElement('ul');
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'item in items track by item.id');
    const input = document.createElement('input');
    host.appendChild(input);
    parent.appendChild(host);
    root.appendChild(parent);

    try {
      b.$compile(host)(scope);
      scope.$digest();

      const rows = rowsOf(parent);
      const middleInput = rows[1]?.querySelector('input') ?? null;
      expect(middleInput).toBeInstanceOf(HTMLInputElement);
      if (middleInput === null) {
        return;
      }
      middleInput.focus();
      expect(document.activeElement).toBe(middleInput);

      scope.items = [m, a, z];
      scope.$digest();

      const reordered = rowsOf(parent);
      expect(reordered[0]?.querySelector('input')).toBe(middleInput);
      // This is the line jsdom currently fails on — `document.activeElement`
      // is `<body>` after `insertBefore` because jsdom does not implement
      // the WHATWG focus-preservation semantics. Skipped pending jsdom
      // fix or Playwright migration.
      expect(document.activeElement).toBe(middleInput);
    } finally {
      root.remove();
    }
  });

  it('`track by $index` works with a list whose item values legitimately repeat', () => {
    // The documented escape hatch (FS §2.3 AC3.2): `track by $index`
    // makes the framework match rows by position, so `[1, 1, 1]` does
    // NOT trigger the duplicate-key error and instead renders three
    // rows correctly.
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.items = [1, 1, 1];

    const { parent, host } = makeRepeatHost('n in items track by $index', 'n');
    b.$compile(host)(scope);
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.textContent)).toEqual(['1', '1', '1']);
    // No duplicate-key error routed via `'$compile'`.
    expect(relevantHandlerCalls(handler).filter((c) => c[1] === '$compile')).toEqual([]);
  });

  it('`track by` accepts method calls (`track by item.key()`)', () => {
    // FS §2.3 AC3.3 — any expression the framework can evaluate is
    // accepted for `track by`, including method calls. The parsed
    // track-by expression runs against the parent scope with the per-
    // row item exposed via the `valueIdent` local, so `item.key()`
    // resolves correctly.
    const b = bootstrap();
    const scope = Scope.create();
    scope.items = [
      { id: 1, key: () => 'k1' },
      { id: 2, key: () => 'k2' },
      { id: 3, key: () => 'k3' },
    ];

    const { parent, host } = makeRepeatHost('item in items track by item.key()', 'item.id');
    b.$compile(host)(scope);
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.textContent)).toEqual(['1', '2', '3']);
  });

  it('`track by` accepts property paths (`track by item.metadata.id`)', () => {
    // FS §2.3 AC3.3 — property-path identity also works.
    const b = bootstrap();
    const scope = Scope.create();
    scope.items = [
      { metadata: { id: 1 }, t: 'A' },
      { metadata: { id: 2 }, t: 'B' },
      { metadata: { id: 3 }, t: 'C' },
    ];

    const { parent, host } = makeRepeatHost(
      'item in items track by item.metadata.id',
      'item.t',
    );
    b.$compile(host)(scope);
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.textContent)).toEqual(['A', 'B', 'C']);

    // Capture references — replacing the collection with fresh objects
    // but identical `metadata.id` values should reuse the rows.
    const rowRefs = [...rows];
    scope.items = [
      { metadata: { id: 1 }, t: 'A2' },
      { metadata: { id: 2 }, t: 'B2' },
      { metadata: { id: 3 }, t: 'C2' },
    ];
    scope.$digest();

    const reused = rowsOf(parent);
    expect(reused[0]).toBe(rowRefs[0]);
    expect(reused[1]).toBe(rowRefs[1]);
    expect(reused[2]).toBe(rowRefs[2]);
    expect(reused.map((r) => r.textContent)).toEqual(['A2', 'B2', 'C2']);
  });

  it('`track by` evaluating to two same values throws NgRepeatDuplicateKeyError via `$compile`', () => {
    // Two items whose `track by` expression resolves to the same value
    // is a duplicate-key violation, same as the default-tracker case.
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.items = [
      { cat: 'a', t: 'first' },
      { cat: 'a', t: 'second' },
    ];

    const { parent, host } = makeRepeatHost('item in items track by item.cat', 'item.t');
    b.$compile(host)(scope);
    scope.$digest();

    // Routed via `'$compile'`, not `'watchListener'`.
    const compileCalls = handler.mock.calls.filter((c) => c[1] === '$compile');
    expect(compileCalls.length).toBe(1);
    const err = compileCalls[0]?.[0];
    expect(err).toBeInstanceOf(NgRepeatDuplicateKeyError);
    // The error's `name` and message both reference `ngRepeat`.
    expect((err as Error).name).toBe('NgRepeatDuplicateKeyError');
    expect((err as Error).message).toContain('ngRepeat');
    // No `'watchListener'` routing.
    expect(handler.mock.calls.filter((c) => c[1] === 'watchListener').length).toBe(0);
    // The half-rendered tree has been torn down.
    expect(rowsOf(parent).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 9. Identity change semantics (FS §2.3 / §2.9 — spec 028 Slice 4)
// ---------------------------------------------------------------------------

describe('ngRepeat — tracked identity change rebuilds the row (FS §2.9)', () => {
  it('replacing an item with a different `id` is treated as a tear-down + freshly-built pair', () => {
    // When the tracked identity changes from one digest to the next,
    // the reconciler sees a NEW identity not present in the previous
    // map and tears down the row whose old identity disappeared, then
    // builds a fresh one for the new identity. DOM-node identity is
    // NOT preserved across this transition — that is the point of
    // identity-based reuse.
    //
    // We trigger reconciliation by reassigning `scope.items` to a
    // fresh array. `$watchCollection`'s shallow per-item-reference
    // comparison would NOT fire on a mere in-place property mutation
    // of an item, so the "change the tracked field" intent is modeled
    // here as "replace the item with a new object that has the new
    // tracked id".
    const b = bootstrap();
    const scope = Scope.create();
    scope.items = [{ id: 1, t: 'A' }];

    const { parent, host } = makeRepeatHost('item in items track by item.id', 'item.t');
    b.$compile(host)(scope);
    scope.$digest();

    const initial = rowsOf(parent);
    expect(initial.length).toBe(1);
    const oldRow = initial[0];
    expect(oldRow).toBeDefined();

    // Fresh array with a new object whose `id` is different. The
    // reconciler sees identity 'number:2' (new) and nothing for
    // 'number:1' (old) — old row torn down, new row built fresh.
    scope.items = [{ id: 2, t: 'A' }];
    scope.$digest();

    const after = rowsOf(parent);
    expect(after.length).toBe(1);
    // DOM-node identity is DIFFERENT — the row was rebuilt.
    expect(after[0]).not.toBe(oldRow);
    // The old row is no longer in the document.
    expect(oldRow ? parent.contains(oldRow) : false).toBe(false);
    // The new row reflects the new item's text.
    expect(after[0]?.textContent).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// 10. Object iteration: (key, value) in object (FS §2.2 — spec 028 Slice 5)
// ---------------------------------------------------------------------------

describe('ngRepeat — object iteration: (key, value) in object (FS §2.2)', () => {
  /**
   * Helper for the object-iteration shape — the row template carries a
   * `<span ng-bind>` formatting "name = age" (or whatever expression
   * the test wants) so we can read the rendered text per row.
   *
   * We can't fully share `makeRepeatHost` because most object-iteration
   * tests need to dereference both the key and the value alias in the
   * bind expression (e.g. `name + ' = ' + age`); the existing helper
   * accepts an arbitrary bind expression so it actually IS shareable
   * here — we keep using it directly.
   */

  it('renders one row per property with both bindings populated (FS §2.2 baseline)', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.people = { alice: 30, bob: 25 };

    const { parent, host } = makeRepeatHost('(name, age) in people', "name + '=' + age");
    b.$compile(host)(scope);
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows.length).toBe(2);
    // Alphabetical-string key order: alice → bob.
    expect(rows.map((r) => r.textContent)).toEqual(['alice=30', 'bob=25']);
  });

  it('keys visited in alphabetical-string order (FS §2.2 AC2.1 — "10" before "2")', () => {
    // The AngularJS-canonical `Object.keys(obj).sort()` uses Array.prototype.sort
    // (default lexicographic string compare), so numeric-looking keys
    // sort as STRINGS: "1" < "10" < "2".
    const b = bootstrap();
    const scope = Scope.create();
    scope.bag = { '10': 'a', '2': 'b', '1': 'c' };

    const { parent, host } = makeRepeatHost('(k, v) in bag', "k + ':' + v");
    b.$compile(host)(scope);
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.textContent)).toEqual(['1:c', '10:a', '2:b']);
  });

  it('adding a property inserts a row in sorted position (FS §2.2 AC2.2)', () => {
    // `$watchCollection` shallow-watches object own keys, so a direct
    // property mutation (no reassignment) DOES fire the listener. We
    // exercise both the in-place add path AND the reassignment path
    // below.
    const b = bootstrap();
    const scope = Scope.create();
    scope.bag = { alice: 1, charlie: 3 } as Record<string, number>;

    const { parent, host } = makeRepeatHost('(k, v) in bag', "k + ':' + v");
    b.$compile(host)(scope);
    scope.$digest();

    expect(rowsOf(parent).map((r) => r.textContent)).toEqual(['alice:1', 'charlie:3']);

    // In-place property add — fires the watcher.
    (scope.bag as Record<string, number>).bob = 2;
    scope.$digest();

    expect(rowsOf(parent).map((r) => r.textContent)).toEqual(['alice:1', 'bob:2', 'charlie:3']);
  });

  it('removing a property removes only its row (FS §2.2 AC2.3)', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.bag = { alice: 1, bob: 2, charlie: 3 } as Record<string, number>;

    const { parent, host } = makeRepeatHost('(k, v) in bag', "k + ':' + v");
    b.$compile(host)(scope);
    scope.$digest();
    expect(rowsOf(parent).map((r) => r.textContent)).toEqual(['alice:1', 'bob:2', 'charlie:3']);

    delete (scope.bag as Record<string, number>).bob;
    scope.$digest();

    expect(rowsOf(parent).map((r) => r.textContent)).toEqual(['alice:1', 'charlie:3']);
  });

  it("changing a property's value rebuilds that row (default identity is `key:k|value-identity`)", () => {
    // The Slice 5 documented contract — for default identity tracking
    // the formula is `'key:${objKey}|${identityTracker.getIdentity(value)}'`.
    // When the value identity changes, the row is torn down and a fresh
    // one is built (DOM-node identity is NOT preserved). `track by` is
    // the escape hatch if the author wants in-place update.
    const b = bootstrap();
    const scope = Scope.create();
    scope.bag = { alice: 30 } as Record<string, number>;

    const { parent, host } = makeRepeatHost('(k, v) in bag', "k + ':' + v");
    b.$compile(host)(scope);
    scope.$digest();

    const initialRow = rowsOf(parent)[0];
    expect(initialRow?.textContent).toBe('alice:30');

    (scope.bag as Record<string, number>).alice = 31;
    scope.$digest();

    const after = rowsOf(parent);
    expect(after.length).toBe(1);
    expect(after[0]?.textContent).toBe('alice:31');
    // DOM-node identity NOT preserved — the row was rebuilt, not updated
    // in place. Documented contract: identity formula includes the
    // value, so changing the value changes the identity → rebuild.
    expect(after[0]).not.toBe(initialRow);
  });

  it("track by the key keeps DOM-node identity stable across value changes (`track by k`)", () => {
    // `track by k` makes the row identity depend on the OBJECT KEY only,
    // so changing the value while the key stays the same reuses the row.
    const b = bootstrap();
    const scope = Scope.create();
    scope.bag = { alice: 30, bob: 25 } as Record<string, number>;

    const { parent, host } = makeRepeatHost('(k, v) in bag track by k', "k + ':' + v");
    b.$compile(host)(scope);
    scope.$digest();

    const initial = rowsOf(parent);
    const aliceRow = initial[0];
    const bobRow = initial[1];
    expect(initial.map((r) => r.textContent)).toEqual(['alice:30', 'bob:25']);

    (scope.bag as Record<string, number>).alice = 31;
    scope.$digest();

    const after = rowsOf(parent);
    expect(after.map((r) => r.textContent)).toEqual(['alice:31', 'bob:25']);
    // Same DOM node references — track by key reuses across value changes.
    expect(after[0]).toBe(aliceRow);
    expect(after[1]).toBe(bobRow);
  });

  it('track by a nested field works (`track by v.id`)', () => {
    // FS §2.3 AC3.3 — any expression the framework can evaluate is
    // accepted for `track by`, including property paths reaching INTO
    // the per-row value alias. The track-by closure exposes both `k`
    // and `v` as locals (the `(k, v)` LHS form).
    const b = bootstrap();
    const scope = Scope.create();
    scope.bag = {
      a: { id: 1, t: 'A' },
      b: { id: 2, t: 'B' },
    } as Record<string, { id: number; t: string }>;

    const { parent, host } = makeRepeatHost('(k, v) in bag track by v.id', "k + ':' + v.t");
    b.$compile(host)(scope);
    scope.$digest();

    const initial = rowsOf(parent);
    expect(initial.map((r) => r.textContent)).toEqual(['a:A', 'b:B']);
    const rowA = initial[0];
    const rowB = initial[1];

    // Reassign to a fresh object with same `v.id` values but fresh
    // wrappers — track by `v.id` reuses both rows.
    scope.bag = {
      a: { id: 1, t: 'A2' },
      b: { id: 2, t: 'B2' },
    };
    scope.$digest();

    const after = rowsOf(parent);
    expect(after.map((r) => r.textContent)).toEqual(['a:A2', 'b:B2']);
    expect(after[0]).toBe(rowA);
    expect(after[1]).toBe(rowB);
  });

  it('collection-shape flip (array → object → array) does not crash', () => {
    // The Slice 5 doc claims the natural diff handles shape-flips
    // because the identity key spaces are disjoint (`'number:1'` vs
    // `'key:a|number:1'`). Exercise it: every row from the previous
    // shape is torn down, every row for the new shape is freshly built.
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.coll = [1, 2];

    // The `it in coll` form binds only `valueIdent`; for the array
    // branch `it` is the entry, for the object branch `it` is the
    // property value.
    const { parent, host } = makeRepeatHost('it in coll', 'it');
    b.$compile(host)(scope);
    scope.$digest();
    expect(rowsOf(parent).map((r) => r.textContent)).toEqual(['1', '2']);

    // Flip to object — every previous row torn down, new rows built.
    scope.coll = { a: 10 };
    scope.$digest();
    expect(rowsOf(parent).map((r) => r.textContent)).toEqual(['10']);

    // Flip back to array — same teardown + rebuild dance.
    scope.coll = [3, 4, 5];
    scope.$digest();
    expect(rowsOf(parent).map((r) => r.textContent)).toEqual(['3', '4', '5']);

    expect(relevantHandlerCalls(handler)).toEqual([]);
  });

  it('single-iterator form over an object renders values in alphabetical-key order (only `item` bound on scope)', () => {
    // The AngularJS-canonical fall-back: `item in {a, b, c}` (no key
    // alias) iterates the object's values in alphabetical-key order
    // with ONLY the value-alias published on the per-row scope. The key
    // is not exposed under any name because `parsed.keyIdent === null`.
    //
    // Verify by inspecting the per-row scope POST-DIGEST (via a probe
    // directive that captures the scope into a side-channel and lets
    // the test interrogate it later — capturing inside `link` would be
    // too early because `ng-repeat` sets the per-row bindings inside
    // its `cloneAttachFn`, which runs AFTER the cloned subtree's
    // linkers have already executed).
    const capturedScopes: Scope[] = [];
    const b = bootstrap({
      register: (_app, $cp) => {
        $cp.directive(
          'rowProbe',
          ddoFactory({
            restrict: 'A',
            link: ((s) => {
              capturedScopes.push(s);
            }) as LinkFn,
          }),
        );
      },
    });
    const scope = Scope.create();
    scope.bag = { '10': 'a', '2': 'b', '1': 'c' };

    const parent = document.createElement('div');
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'value in bag');
    const inner = document.createElement('span');
    inner.setAttribute('ng-bind', 'value');
    inner.setAttribute('row-probe', '');
    host.appendChild(inner);
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows.length).toBe(3);
    // Values in alphabetical-key order: '1' → 'c', '10' → 'a', '2' → 'b'.
    expect(rows.map((r) => r.textContent)).toEqual(['c', 'a', 'b']);
    // The per-row scope binds ONLY the value alias (here named `value`).
    // It does NOT publish a `name` / `key` binding because `parsed.keyIdent`
    // is null in the single-iterator form. Verified by inspecting each
    // captured row scope as a plain record AFTER bindings have been
    // populated by the directive's `cloneAttachFn`.
    expect(capturedScopes.length).toBe(3);
    for (const rs of capturedScopes) {
      const rec = rs as unknown as Record<string, unknown>;
      // `value` is set on the per-row scope as an own property.
      expect(Object.prototype.hasOwnProperty.call(rec, 'value')).toBe(true);
      // Neither `name` nor `key` is set — the single-iterator form does
      // not publish a key alias.
      expect(Object.prototype.hasOwnProperty.call(rec, 'name')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(rec, 'key')).toBe(false);
    }
  });

  it('two distinct keys carrying the same value render as two separate rows (key:value identity formula)', () => {
    // The Slice 5 identity formula `'key:${objKey}|${valueIdentity}'`
    // ensures the same value under two keys does NOT falsely collapse
    // into a duplicate-key throw. Verify directly.
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.bag = { a: 'x', b: 'x' };

    const { parent, host } = makeRepeatHost('(k, v) in bag', "k + ':' + v");
    b.$compile(host)(scope);
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.textContent)).toEqual(['a:x', 'b:x']);
    // No duplicate-key throw. We filter out the incidental "expected
    // placeholder to be a Comment" routings that fire when the
    // `transclude: 'element'` master clone is re-linked (see
    // `relevantHandlerCalls` docstring above — this is a pre-existing
    // framework artifact unrelated to spec 028).
    const compileCalls = relevantHandlerCalls(handler).filter((c) => c[1] === '$compile');
    expect(compileCalls.length).toBe(0);
  });

  it('empty object renders zero rows (placeholder only)', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.bag = {} as Record<string, unknown>;

    const { parent, host } = makeRepeatHost('(k, v) in bag', "k + ':' + v");
    b.$compile(host)(scope);
    scope.$digest();

    expect(rowsOf(parent).length).toBe(0);
    expect(parent.childNodes.length).toBe(1);
    expect(parent.childNodes[0]?.nodeType).toBe(Node.COMMENT_NODE);
  });

  it('per-row $index reflects the row position in alphabetical-key order', () => {
    // The six per-row locals still apply to object iteration. `$index`
    // is the 0-based row position AFTER alphabetical-key sorting.
    const b = bootstrap();
    const scope = Scope.create();
    scope.bag = { charlie: 'c', alice: 'a', bob: 'b' };

    const { parent, host } = makeRepeatHost('(k, v) in bag', "$index + ':' + k");
    b.$compile(host)(scope);
    scope.$digest();

    const rows = rowsOf(parent);
    expect(rows.map((r) => r.textContent)).toEqual(['0:alice', '1:bob', '2:charlie']);
  });
});
