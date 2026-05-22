/**
 * AngularJS 1.x parity tests for spec 026 (Event Directives).
 *
 * This file is a focused "canonical patterns" regression guard rather
 * than a verbatim port — the upstream `angular/angular.js` repo is not
 * vendored locally, so each test below codifies a publicly-documented
 * AngularJS 1.x behavior that the spec-026 built-ins must satisfy.
 *
 * Coverage scope — one canonical observable per event family (the
 * eighteen-directive parametrized matrix lives in
 * `src/compiler/__tests__/ng-event-directives.test.ts`; this file pins
 * the cross-family invariants that the matrix is too uniform to surface
 * cleanly):
 *
 *  - **Click** (Mouse family) — `<button ng-click="…">`, dispatch
 *    click, assert the handler ran AND the scope mutation made inside
 *    the handler is observable on the scope after dispatch returns.
 *  - **Keyboard** — `<input ng-keydown="lastKey = $event.key">`,
 *    dispatch a `KeyboardEvent` with a known `.key`, assert the
 *    `$event` local exposed the native event to the bound expression.
 *  - **Focus** — `<input ng-focus="focused = true">`, dispatch focus,
 *    assert the boolean flip propagated.
 *  - **Submit** (Form-lifecycle) — `<form ng-submit="submitted = true"
 *    action="…">`, dispatch a CANCELABLE submit event, assert the
 *    handler ran AND `event.defaultPrevented === false` (the directive
 *    does NOT auto-`preventDefault`).
 *  - **Cleanup** — destroying the scope removes the native listener;
 *    a subsequent event of the same type does NOT trigger the handler.
 *
 * No deferred `it.skip(...)` cases — these directives have no
 * animation surface or other deferred upstream behavior.
 *
 * Mirrors the structural precedent set by
 * `src/compiler/__tests__/spec025-parity.test.ts` (and the
 * `EXCEPTION_HANDLER_CAUSES.length === 10` regression guard pattern
 * from there).
 *
 * @see context/spec/026-event-directives/functional-spec.md
 * @see context/spec/026-event-directives/technical-considerations.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompileService } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { EXCEPTION_HANDLER_CAUSES, type ExceptionHandler } from '@exception-handler/index';

import { bootstrapNgModule } from './test-helpers';

interface InjectorLike {
  has: (name: string) => boolean;
  get: (name: string) => unknown;
}

function buildInjector(): InjectorLike {
  const appModule = createModule('app', ['ng']);
  return createInjector([ngModule, appModule]);
}

function compileFromNg(): { $compile: CompileService } {
  return { $compile: buildInjector().get('$compile') as CompileService };
}

afterEach(() => {
  resetRegistry();
});

// ---------------------------------------------------------------------
// Cause-token regression guard — spec 026 introduces ZERO new tokens.
// Mirrors the spec 023 / 024 / 025 parity-file precedent (kept at the
// TOP so a future contributor adding a token notices the failure
// immediately). The event directives reuse the existing `'eventListener'`
// token for native-listener throws and `'$compile'` for compile-time
// failures.
// ---------------------------------------------------------------------

describe('parity: EXCEPTION_HANDLER_CAUSES regression', () => {
  it('keeps the tuple at exactly 10 entries after spec 026', () => {
    expect(EXCEPTION_HANDLER_CAUSES.length).toBe(10);
    expect(EXCEPTION_HANDLER_CAUSES).toContain('eventListener');
    expect(EXCEPTION_HANDLER_CAUSES).toContain('$compile');
  });
});

// ---------------------------------------------------------------------
// ng-click — the canonical "user pressed the button" event.
// Upstream: angular/angular.js test/ng/directive/ngEventDirsSpec.js —
// the canonical "should fire" + "should evaluate expression" pair. A
// single test here pins both: handler ran AND the scope mutation made
// inside the handler is observable after dispatch returns (the
// `$apply` that wraps the handler triggered a digest, so the new
// scope state is committed).
// ---------------------------------------------------------------------

describe('parity: ng-click (ngEventDirsSpec.js)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('fires the bound expression on click and the scope mutation propagates', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create<{ clicked: boolean }>();
    scope.clicked = false;

    const element = document.createElement('button');
    element.setAttribute('ng-click', 'clicked = true');

    $compile(element)(scope);

    expect(scope.clicked).toBe(false);

    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(scope.clicked).toBe(true);
  });
});

// ---------------------------------------------------------------------
// ng-keydown — the canonical "user pressed a key" event.
// Upstream: angular/angular.js test/ng/directive/ngEventDirsSpec.js —
// "should bind keydown" plus the `$event` local exposure. This test
// pins the `$event` local: the bound expression reads `$event.key`
// and writes it onto the scope. The parser's locals-first lookup
// (spec 009) resolves `$event` from the locals object passed by the
// directive's runner, NOT from the scope.
// ---------------------------------------------------------------------

describe('parity: ng-keydown (ngEventDirsSpec.js)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('exposes the native KeyboardEvent as the `$event` local inside the bound expression', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create<{ lastKey: string | null }>();
    scope.lastKey = null;

    const element = document.createElement('input');
    element.setAttribute('ng-keydown', 'lastKey = $event.key');

    $compile(element)(scope);

    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));

    expect(scope.lastKey).toBe('Enter');
  });
});

// ---------------------------------------------------------------------
// ng-focus — the canonical "element gained focus" event.
// Upstream: angular/angular.js test/ng/directive/ngEventDirsSpec.js —
// "should bind focus". jsdom's `FocusEvent` is non-bubbling by default
// (matches browser spec); the directive attaches its listener on the
// element itself, so non-bubbling is irrelevant for this assertion.
// ---------------------------------------------------------------------

describe('parity: ng-focus (ngEventDirsSpec.js)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('fires the bound expression on focus and the boolean flip propagates', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create<{ focused: boolean }>();
    scope.focused = false;

    const element = document.createElement('input');
    element.setAttribute('ng-focus', 'focused = true');

    $compile(element)(scope);

    expect(scope.focused).toBe(false);

    element.dispatchEvent(new FocusEvent('focus', { bubbles: false, cancelable: false }));

    expect(scope.focused).toBe(true);
  });
});

// ---------------------------------------------------------------------
// ng-submit — the canonical "form was submitted" event with the
// distinctive AngularJS-1.x "no auto-preventDefault" carve-out.
// Upstream: angular/angular.js test/ng/directive/ngEventDirsSpec.js —
// "should bind submit" plus the documented note that the directive
// does NOT call `event.preventDefault()` (FS §3 carves it out of
// scope). The test dispatches a CANCELABLE submit event and asserts
// (a) the handler ran AND (b) `event.defaultPrevented === false` so
// a real browser would still navigate to the `action` URL — the
// consumer is responsible for calling `$event.preventDefault()`
// explicitly or omitting `action` entirely.
// ---------------------------------------------------------------------

describe('parity: ng-submit (ngEventDirsSpec.js)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('fires the bound expression on submit WITHOUT calling preventDefault()', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create<{ submitted: boolean }>();
    scope.submitted = false;

    const element = document.createElement('form');
    element.setAttribute('action', '/intentional-no-op');
    element.setAttribute('ng-submit', 'submitted = true');

    $compile(element)(scope);

    const event = new Event('submit', { bubbles: true, cancelable: true });
    element.dispatchEvent(event);

    // Handler observable on the scope (the $apply ran and committed
    // the assignment).
    expect(scope.submitted).toBe(true);

    // The directive did NOT call `event.preventDefault()` — a real
    // browser would proceed with the navigation. Consumers who don't
    // want navigation either omit `action` or call
    // `$event.preventDefault()` from inside the bound expression.
    expect(event.defaultPrevented).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Cleanup — scope destroy removes the native listener.
// Upstream: implicit in every event directive's `link` — every
// AngularJS event directive registers a `scope.$on('$destroy', …)`
// hook that removes the native listener. This test pins the
// observable: dispatch an event AFTER `scope.$destroy()` and assert
// the handler did NOT run.
//
// The root scope's `$destroy()` is a no-op in this codebase (matches
// AngularJS), so the test uses a child scope created via `$new()`.
// ---------------------------------------------------------------------

describe('parity: scope destroy removes the event listener', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('a click dispatched after $destroy does NOT trigger the handler', () => {
    const { $compile } = compileFromNg();
    // The root scope's `$destroy()` is a no-op in this codebase
    // (matches AngularJS), so we need a child scope to exercise the
    // listener-removal hook. The bound expression writes to a
    // counter that lives directly on the child scope.
    const root = Scope.create();
    const scope = root.$new();
    scope.count = 0;

    const element = document.createElement('button');
    element.setAttribute('ng-click', 'count = count + 1');

    $compile(element)(scope);

    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(scope.count).toBe(1);

    scope.$destroy();

    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(scope.count).toBe(1);
  });
});

// ---------------------------------------------------------------------
// Nested-throw cause-token asymmetry — the handler dispatches via
// `scope.$evalAsync(run)` when a digest is already in flight, so a
// throw from the runner is drained by the digest's '$evalAsync' catch
// path, NOT routed through the directive's outer try/catch as
// 'eventListener'. Spec 026 tech-considerations §V predicted this:
// "'eventListener' is the natural fit but the existing $apply plumbing
// may route via something else (one of the existing 10 tokens —
// confirm during implementation)." This test pins the answer so
// downstream apps that branch their $exceptionHandler on cause know
// both tokens are reachable from a single ng-event directive.
// ---------------------------------------------------------------------

describe('parity: nested handler throw routes via `$evalAsync`', () => {
  it("a throw from inside a nested ng-click handler lands at $exceptionHandler with cause '$evalAsync', not 'eventListener'", () => {
    const exceptionSpy = vi.fn<ExceptionHandler>();
    // `bootstrapNgModule`'s `exceptionHandler` option is typed loosely
    // as `(...args: unknown[]) => void` — a strict `ExceptionHandler`
    // mock is structurally compatible (the helper only ever forwards
    // `(err, cause)`) but TS function-parameter contravariance refuses
    // the direct assignment. Cast at the boundary so both DI-side
    // (directive's outer try/catch) and scope-side (digest's
    // $evalAsync catch) install the SAME spy — otherwise the
    // `eventListenerCalls.length === 0` assertion below would be
    // trivially true.
    bootstrapNgModule({ exceptionHandler: exceptionSpy as unknown as (...args: unknown[]) => void });
    const { $compile } = compileFromNg();

    const scope = Scope.create({ exceptionHandler: exceptionSpy });
    scope.boom = () => {
      throw new Error('intentional');
    };

    const element = document.createElement('button');
    element.setAttribute('ng-click', 'boom()');

    $compile(element)(scope);

    // Wrap the dispatch in $apply so $$phase === '$apply' WHEN the
    // event fires. The directive's handler will see the active phase
    // and route through $evalAsync, NOT $apply. The throw is drained
    // by the trailing $digest()'s $evalAsync catch — cause
    // '$evalAsync', not 'eventListener'.
    expect(() => {
      scope.$apply(() => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
    }).not.toThrow();

    const evalAsyncCalls = exceptionSpy.mock.calls.filter((c) => c[1] === '$evalAsync');
    const eventListenerCalls = exceptionSpy.mock.calls.filter((c) => c[1] === 'eventListener');

    expect(evalAsyncCalls.length).toBeGreaterThanOrEqual(1);
    expect(eventListenerCalls.length).toBe(0);
    expect((evalAsyncCalls[0]?.[0] as Error | undefined)?.message).toBe('intentional');
  });
});
