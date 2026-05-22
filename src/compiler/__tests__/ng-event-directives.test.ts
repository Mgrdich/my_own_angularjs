/**
 * Native event-binding directives — `ngClick` / `ngDblclick` /
 * `ngMousedown` / `ngMouseup` / `ngMouseover` / `ngMouseout` /
 * `ngMousemove` / `ngMouseenter` / `ngMouseleave` / `ngKeydown` /
 * `ngKeyup` / `ngKeypress` / `ngCopy` / `ngCut` / `ngPaste` /
 * `ngFocus` / `ngBlur` / `ngSubmit` (spec 026 Slice 1).
 *
 * The eighteen directives share an identical mechanical contract —
 * only the target DOM event name (and the canonical host element)
 * differs — so the test plan is parametrized via `describe.each` over
 * `[ngName, eventName, hostElement]` triples.
 *
 * Locked behavior per directive:
 *
 *  - `injector.has('<name>Directive') === true` — registration sanity.
 *  - Event fire evaluates the bound expression and exposes `$event` as
 *    the native event object.
 *  - Scope mutations made inside the handler propagate (the next
 *    digest sees them) — multiple flips of a counter scope property
 *    increment correctly across multiple event dispatches.
 *  - Listener cleanup on `scope.$destroy()`: a subsequent event of the
 *    same type does NOT trigger the handler.
 *  - Nested events use `$evalAsync` — dispatching an event from inside
 *    a `scope.$apply` callback does NOT throw
 *    `'$digest already in progress'`, and the inner expression's
 *    effect is observable after the outer digest completes.
 *
 * Cross-cutting non-parametrized tests:
 *
 *  - Multiple event directives on the same element work independently.
 *  - An expression-throw is caught by `$exceptionHandler` with cause
 *    `'eventListener'`; subsequent events still fire.
 *  - `ng-submit` does NOT auto-`preventDefault()`.
 *
 * Bootstrap mirrors the spec 025 Slice 2 boolean-aliases test file —
 * re-builds the canonical `'ng'` module's registry entry, then
 * composes with a fresh `'app'` module rooted at the canonical
 * `ngModule` instance so the directives registered by
 * `src/core/ng-module.ts` are reachable. The spy `$exceptionHandler`
 * is registered on the `'app'` module so the dependency walk's
 * last-wins rule applies — `'ng'` resolves first (with the canonical
 * `consoleErrorExceptionHandler`), then `'app'` overrides with the
 * spy. The spy is what the directive's per-event `try/catch` reaches
 * via `invokeExceptionHandler($exceptionHandler, err, 'eventListener')`.
 */

import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

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

interface InjectorLike {
  has: (name: string) => boolean;
}

type ExceptionSpy = Mock<ExceptionHandler>;

interface Bootstrap {
  $compile: CompileService;
  /**
   * Spy registered through the `'app'` module's DI `$exceptionHandler`
   * factory — consumed by the directive's `try/catch` around the parsed
   * expression's invocation. Tests below ALSO pass the same spy through
   * `Scope.create({ exceptionHandler: b.exceptionSpy })` so the digest's
   * internal catch sites (the `'$evalAsync'` path used by the nested-event
   * scenarios in particular) route to the same observable. Both surfaces
   * therefore land on the one spy.
   */
  exceptionSpy: ExceptionSpy;
  injector: InjectorLike;
}

function bootstrap(): Bootstrap {
  resetRegistry();
  const exceptionSpy: ExceptionSpy = vi.fn<ExceptionHandler>();
  // Re-build the canonical `ng` registry entry under the same name —
  // mirrors the spec 025 boolean-aliases bootstrap. We deliberately
  // do NOT register `$exceptionHandler` here: the canonical `ngModule`
  // (loaded first by `createInjector` below) claims the `ng` name
  // before our local module can re-register, so a re-registration
  // here would be silently shadowed by the canonical factory.
  createModule('ng', [])
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

  // The spy goes on the `app` module — since `app` loads AFTER `ng`
  // in the dependency walk, its `$exceptionHandler` factory wins per
  // the last-wins rule documented in CLAUDE.md (Within the unified
  // registration timeline, a new producer recipe wipes prior producer
  // entries for the same name).
  const appModule = createModule('app', ['ng']).factory('$exceptionHandler', [(): ExceptionHandler => exceptionSpy]);
  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get('$compile'),
    exceptionSpy,
    injector: built,
  };
}

afterEach(() => {
  resetRegistry();
});

/**
 * Build a synthetic event of the appropriate native constructor for a
 * given event name. jsdom supports `MouseEvent` / `KeyboardEvent` /
 * `ClipboardEvent` / `FocusEvent`; everything else falls through to
 * the generic `Event` constructor.
 *
 * `bubbles: true` matches AngularJS-canonical expectations — most
 * tests don't observe bubbling, but for `ng-mouseover` / `ng-mouseout`
 * the directive's listener is attached at the element AT WHICH the
 * event is fired, so bubbling is irrelevant for these tests. The
 * `cancelable: true` flag matters only for `ng-submit` (the
 * preventDefault check at the bottom of the file).
 */
function makeEvent(eventName: string): Event {
  switch (eventName) {
    case 'click':
    case 'dblclick':
    case 'mousedown':
    case 'mouseup':
    case 'mouseover':
    case 'mouseout':
    case 'mousemove':
    case 'mouseenter':
    case 'mouseleave':
      return new MouseEvent(eventName, { bubbles: true, cancelable: true });
    case 'keydown':
    case 'keyup':
    case 'keypress':
      return new KeyboardEvent(eventName, { bubbles: true, cancelable: true, key: 'a' });
    case 'focus':
    case 'blur':
      // FocusEvent does not bubble by default; jsdom respects that.
      return new FocusEvent(eventName, { bubbles: false, cancelable: false });
    case 'submit':
      return new Event(eventName, { bubbles: true, cancelable: true });
    default:
      return new Event(eventName, { bubbles: true, cancelable: true });
  }
}

// Parametrize over the eighteen [normalized name, DOM event, host tag]
// triples. The directive names use camelCase to line up with the
// `<name>Directive` provider key the injector exposes; the kebab-case
// form (`ng-click` etc.) is the source-DOM spelling consumed below.
// Host tags are chosen per AngularJS-canonical usage: button for
// mouse events, input for keyboard / clipboard / focus events, form
// for submit.
const cases: ReadonlyArray<readonly [ngName: string, eventName: string, hostElement: string]> = [
  ['ngClick', 'click', 'button'],
  ['ngDblclick', 'dblclick', 'button'],
  ['ngMousedown', 'mousedown', 'button'],
  ['ngMouseup', 'mouseup', 'button'],
  ['ngMouseover', 'mouseover', 'button'],
  ['ngMouseout', 'mouseout', 'button'],
  ['ngMousemove', 'mousemove', 'button'],
  ['ngMouseenter', 'mouseenter', 'button'],
  ['ngMouseleave', 'mouseleave', 'button'],
  ['ngKeydown', 'keydown', 'input'],
  ['ngKeyup', 'keyup', 'input'],
  ['ngKeypress', 'keypress', 'input'],
  ['ngCopy', 'copy', 'input'],
  ['ngCut', 'cut', 'input'],
  ['ngPaste', 'paste', 'input'],
  ['ngFocus', 'focus', 'input'],
  ['ngBlur', 'blur', 'input'],
  ['ngSubmit', 'submit', 'form'],
];

describe.each(cases)('ng-%s — native event directive (spec 026 Slice 1)', (ngName, eventName, hostElement) => {
  const ngAttr = `ng-${eventName}`;

  it(`injector.has('${ngName}Directive') === true`, () => {
    const b = bootstrap();
    expect(b.injector.has(`${ngName}Directive`)).toBe(true);
  });

  it(`evaluates the bound expression on ${eventName} and exposes $event`, () => {
    const b = bootstrap();
    const scope = Scope.create({ exceptionHandler: b.exceptionSpy });
    scope.captured = null;

    const element = document.createElement(hostElement);
    element.setAttribute(ngAttr, 'captured = $event');

    b.$compile(element)(scope);

    const ev = makeEvent(eventName);
    element.dispatchEvent(ev);

    // The directive does the $apply itself; after dispatch returns,
    // the scope should reflect the assignment. `captured` should be
    // the exact native event we dispatched.
    expect(scope.captured).toBe(ev);
  });

  it(`scope mutations from the handler propagate across multiple ${eventName} dispatches`, () => {
    const b = bootstrap();
    const scope = Scope.create({ exceptionHandler: b.exceptionSpy });
    scope.count = 0;

    const element = document.createElement(hostElement);
    element.setAttribute(ngAttr, 'count = count + 1');

    b.$compile(element)(scope);

    element.dispatchEvent(makeEvent(eventName));
    expect(scope.count).toBe(1);

    element.dispatchEvent(makeEvent(eventName));
    expect(scope.count).toBe(2);

    element.dispatchEvent(makeEvent(eventName));
    expect(scope.count).toBe(3);
  });

  it(`removes the ${eventName} listener when the scope is destroyed`, () => {
    const b = bootstrap();
    const scope = Scope.create({ exceptionHandler: b.exceptionSpy });
    // Use a child scope so `$destroy()` actually tears down (the
    // root scope's $destroy is a no-op per `src/core/scope.ts`).
    const childScope = scope.$new();
    childScope.count = 0;

    const element = document.createElement(hostElement);
    element.setAttribute(ngAttr, 'count = count + 1');

    b.$compile(element)(childScope);

    element.dispatchEvent(makeEvent(eventName));
    expect(childScope.count).toBe(1);

    // Tear down the child scope; the $on('$destroy', …) cleanup
    // hook should remove the native event listener. A subsequent
    // dispatch must NOT increment the counter.
    childScope.$destroy();

    element.dispatchEvent(makeEvent(eventName));
    expect(childScope.count).toBe(1);
  });

  it(`nested ${eventName} from inside $apply does NOT throw "$digest already in progress"`, () => {
    const b = bootstrap();
    const scope = Scope.create({ exceptionHandler: b.exceptionSpy });
    scope.inner = 0;

    const element = document.createElement(hostElement);
    element.setAttribute(ngAttr, 'inner = inner + 1');

    b.$compile(element)(scope);

    // Wrap the dispatch in $apply so $$phase === '$apply' WHEN the
    // event fires and the directive's handler runs. The handler must
    // detect the active phase and route through $evalAsync instead
    // of throwing "$digest already in progress".
    expect(() => {
      scope.$apply(() => {
        element.dispatchEvent(makeEvent(eventName));
      });
    }).not.toThrow();

    // The $evalAsync drain runs inside the SAME $apply's trailing
    // $digest(), so by the time `$apply` returns the inner
    // expression's effect is observable on the scope.
    expect(scope.inner).toBe(1);
  });
});

describe('multiple event directives on the same element work independently', () => {
  it('ng-click, ng-mouseover, ng-focus each fire only their own handler', () => {
    const b = bootstrap();
    const scope = Scope.create({ exceptionHandler: b.exceptionSpy });
    scope.clicked = 0;
    scope.hovered = 0;
    scope.focused = 0;

    const element = document.createElement('button');
    element.setAttribute('ng-click', 'clicked = clicked + 1');
    element.setAttribute('ng-mouseover', 'hovered = hovered + 1');
    element.setAttribute('ng-focus', 'focused = focused + 1');

    b.$compile(element)(scope);

    element.dispatchEvent(makeEvent('click'));
    expect(scope.clicked).toBe(1);
    expect(scope.hovered).toBe(0);
    expect(scope.focused).toBe(0);

    element.dispatchEvent(makeEvent('mouseover'));
    expect(scope.clicked).toBe(1);
    expect(scope.hovered).toBe(1);
    expect(scope.focused).toBe(0);

    element.dispatchEvent(makeEvent('focus'));
    expect(scope.clicked).toBe(1);
    expect(scope.hovered).toBe(1);
    expect(scope.focused).toBe(1);
  });
});

describe('expression-throw routing through $exceptionHandler', () => {
  it("routes a handler throw via cause 'eventListener' and keeps subsequent events firing", () => {
    const b = bootstrap();
    const scope = Scope.create({ exceptionHandler: b.exceptionSpy });
    scope.boom = (): void => {
      throw new Error('intentional');
    };
    scope.ok = (): void => {
      scope.okFired = true;
    };
    scope.okFired = false;

    const element = document.createElement('button');
    element.setAttribute('ng-click', 'boom()');

    b.$compile(element)(scope);

    // First dispatch — the handler throws. The directive's try/catch
    // routes via $exceptionHandler with cause 'eventListener'; the
    // dispatch returns normally (no escape).
    expect(() => {
      element.dispatchEvent(makeEvent('click'));
    }).not.toThrow();

    // The spy was called at least once with cause 'eventListener'.
    const eventListenerCalls = b.exceptionSpy.mock.calls.filter((c) => c[1] === 'eventListener');
    expect(eventListenerCalls.length).toBeGreaterThanOrEqual(1);
    const firstCall = eventListenerCalls[0];
    expect(firstCall).toBeDefined();
    expect((firstCall?.[0] as Error).message).toBe('intentional');

    // Second dispatch on a different, healthy element — still fires.
    const element2 = document.createElement('button');
    element2.setAttribute('ng-click', 'ok()');
    b.$compile(element2)(scope);
    element2.dispatchEvent(makeEvent('click'));
    expect(scope.okFired).toBe(true);
  });
});

describe('ng-submit does NOT auto-preventDefault', () => {
  it('a submit handler that does not call $event.preventDefault leaves event.defaultPrevented === false', () => {
    const b = bootstrap();
    const scope = Scope.create({ exceptionHandler: b.exceptionSpy });
    scope.submitted = false;

    const form = document.createElement('form');
    form.setAttribute('ng-submit', 'submitted = true');

    b.$compile(form)(scope);

    const ev = new Event('submit', { bubbles: false, cancelable: true });
    form.dispatchEvent(ev);

    // The handler ran (the directive evaluated the expression) but the
    // directive itself does NOT call preventDefault. The native event's
    // `defaultPrevented` flag stays false unless the consumer's
    // expression calls $event.preventDefault() explicitly.
    expect(scope.submitted).toBe(true);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('a submit handler that DOES call $event.preventDefault flips the flag', () => {
    const b = bootstrap();
    const scope = Scope.create({ exceptionHandler: b.exceptionSpy });
    scope.submitted = false;
    scope.onSubmit = (event: Event): void => {
      scope.submitted = true;
      event.preventDefault();
    };

    const form = document.createElement('form');
    form.setAttribute('ng-submit', 'onSubmit($event)');

    b.$compile(form)(scope);

    const ev = new Event('submit', { bubbles: false, cancelable: true });
    form.dispatchEvent(ev);

    expect(scope.submitted).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
  });
});
