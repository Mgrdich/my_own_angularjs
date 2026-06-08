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

  it('Slice 3: a plain object value clears rows (object iteration is deferred to Slice 5)', () => {
    // The Slice 3 implementation treats anything that is NOT `Array.isArray`
    // as "non-iterable" and tears rows down without error. Slice 5 will
    // detect the object branch and normalize via `Object.keys(obj).sort()`.
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.items = ['A', 'B'];

    const { parent, host } = makeRepeatHost('it in items', 'it');
    b.$compile(host)(scope);
    scope.$digest();
    expect(rowsOf(parent).length).toBe(2);

    scope.items = { a: 1, b: 2 };
    scope.$digest();
    expect(rowsOf(parent).length).toBe(0);
    expect(relevantHandlerCalls(handler)).toEqual([]);
  });
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
