/**
 * `ngRef` directive — publish a reference to a directive's controller
 * (or its DOM element) onto the surrounding scope (spec 030 Slice 3 /
 * FS §2.2).
 *
 * Locks the AngularJS 1.7+ template-side `@ViewChild` analogue
 * registered on `ngModule`:
 *
 * - Component-controller publish: `<my-player ng-ref="player">` writes
 *   the component's controller instance into `scope.player`, so sibling
 *   markup (`<button ng-click="player.play()">`) can invoke methods on
 *   it.
 * - Plain-element publish: `<span ng-ref="el">` (no own controller)
 *   writes the native `<span>` Element into `scope.el`.
 * - Dotted-path publish: `ng-ref="refs.player"` auto-creates the
 *   `refs` intermediate object through the assignable writer.
 * - Clear-on-removal: an `ng-ref` element inside an `ng-if` subtree is
 *   nulled when the `ng-if` clone scope is destroyed, and re-published
 *   when the subtree re-mounts.
 * - Clear-on-destroy identity guard: teardown only nulls the slot when
 *   it still holds the published reference — a newer publish survives.
 * - Bad-expression inert behavior: a non-assignable `ng-ref="123bad"`
 *   routes `NgRefBadExpressionError` via `$exceptionHandler` with cause
 *   `'$compile'`, publishes nothing, and the page keeps digesting.
 *
 * Tests use the canonical `ngModule` so the `ngRef` directive
 * registered by `src/core/ng-module.ts` is reachable end-to-end —
 * mirroring the `ng-if.test.ts` bootstrap pattern, widened with the
 * `$controller` provider (so `.component(...)` registrations resolve a
 * controller seam) and an app-layer spy `$exceptionHandler`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import { NgRefBadExpressionError, NgRefNoControllerError } from '@compiler/compile-error';
import type { CompileService, DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import { $ControllerProvider } from '@controller/controller-provider';
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

type ExceptionSpy = ReturnType<typeof vi.fn<ExceptionHandler>>;

interface InjectorLike {
  has: (name: string) => boolean;
}

interface Bootstrap {
  $compile: CompileService;
  injector: InjectorLike;
  exceptionSpy: ExceptionSpy;
}

/**
 * Builds a `'ng'`-aware `app` module so the `ngRef` directive
 * registered by `ngModule` is reachable, while letting per-test code
 * register additional directives / components via the `register`
 * callback. The app-layer `$exceptionHandler` is a spy (app loads after
 * `ng`, so its factory wins per the last-wins rule) so tests can assert
 * the bad-expression routing without touching the `ng`-module factory.
 *
 * `$controller` is registered alongside `$compile` so `.component(...)`
 * registrations resolve their controller seam — the canonical `ngModule`
 * registers the same pair, mirrored here on the local `ng` entry.
 */
function bootstrap(register?: ($cp: $CompileProvider) => void): Bootstrap {
  resetRegistry();
  const exceptionSpy: ExceptionSpy = vi.fn<ExceptionHandler>();

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

  const appModule = createModule('ngRefTestApp', ['ng']).factory('$exceptionHandler', [
    (): ExceptionHandler => exceptionSpy,
  ]);
  if (register !== undefined) {
    appModule.config([
      '$compileProvider',
      ($cp: $CompileProvider) => {
        register($cp);
      },
    ]);
  }
  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get('$compile'),
    injector: built,
    exceptionSpy,
  };
}

afterEach(() => {
  resetRegistry();
});

describe('ngRef — registration on ngModule (spec 030 Slice 3)', () => {
  it('injector.has("ngRefDirective") === true when "ng" is in the deps chain', () => {
    const b = bootstrap();
    expect(b.injector.has('ngRefDirective')).toBe(true);
  });
});

describe('ngRef — component controller publish (FS §2.2)', () => {
  it('publishes the component controller so markup can invoke its methods', () => {
    const play = vi.fn();
    // ngRef publishes to the element's SURROUNDING scope (upstream
    // parity), so a TRUE OUTER SIBLING reaches the controller. The
    // component (`<my-player>`) and the invoking `<button>` are real
    // siblings in the SAME outer scope; clicking the outer button
    // invokes the component controller's spied `play()`.
    const b = bootstrap(($cp) => {
      $cp.component('myPlayer', {
        template: '<span>player</span>',
        controller: [
          function (this: Record<string, unknown>): void {
            this.play = play;
            this.$$isController = true;
          },
        ],
      });
    });

    const scope = Scope.create<{ player?: Record<string, unknown> }>();
    const root = document.createElement('div');
    const player = document.createElement('my-player');
    player.setAttribute('ng-ref', 'player');
    const button = document.createElement('button');
    button.setAttribute('ng-click', 'player.play()');
    button.textContent = 'Play';
    root.appendChild(player);
    root.appendChild(button);

    b.$compile(root)(scope);
    scope.$digest();

    // The published reference is on the OUTER scope (the surrounding
    // scope the true-sibling button binds against) and carries the
    // controller's marker — i.e. it is the component controller, not the
    // element.
    expect(scope.player).toBeDefined();
    expect(scope.player?.$$isController).toBe(true);

    // FS §2.2 headline criterion: a click on the genuine outer-sibling
    // <button ng-click="player.play()"> invokes the component's play().
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(play).toHaveBeenCalledTimes(1);
  });
});

describe('ngRef — plain element publish (FS §2.2)', () => {
  it('publishes the native Element itself when the element has no own controller', () => {
    const b = bootstrap();
    const scope = Scope.create<{ el?: Element }>();
    const span = document.createElement('span');
    span.setAttribute('ng-ref', 'el');

    b.$compile(span)(scope);
    scope.$digest();

    // Identity: the slot holds the actual DOM node, not a clone / wrapper.
    expect(scope.el).toBe(span);
  });
});

describe('ngRef — dotted-path publish (FS §2.2)', () => {
  it('auto-creates the intermediate object for a dotted ng-ref path', () => {
    const b = bootstrap();
    const scope = Scope.create<{ refs?: { player?: Element } }>();
    const span = document.createElement('span');
    span.setAttribute('ng-ref', 'refs.player');

    // `scope.refs` does not exist before linking — the assignable writer
    // must create it.
    expect(scope.refs).toBeUndefined();

    b.$compile(span)(scope);
    scope.$digest();

    expect(scope.refs).toBeDefined();
    expect(scope.refs?.player).toBe(span);
  });
});

describe('ngRef — clear on removal via ng-if (FS §2.2)', () => {
  it('sets, clears, and re-publishes across ng-if toggles', () => {
    const b = bootstrap();
    // The `ng-ref` element lives inside an `ng-if` subtree, so ngRef
    // links against the transclusion CLONE scope and writes there. To
    // observe the publish from the OUTER scope across toggles we use a
    // dotted path against a pre-seeded outer object: the assignable
    // writer's `ensurePath` resolves `refs` through the prototype chain
    // to the outer object, so `refs.el` is written onto (and cleared
    // from) the shared outer object — visible from `scope` regardless of
    // which clone scope ngRef linked against.
    const scope = Scope.create<{ show?: boolean; refs: { el?: Element | null } }>();
    scope.show = true;
    scope.refs = {};

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-if', 'show');
    const span = document.createElement('span');
    span.setAttribute('ng-ref', 'refs.el');
    host.appendChild(span);
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    // Mounted → published. The published value is the CLONED span (a
    // fresh deep-clone of the host subtree), so assert non-null rather
    // than node identity against the master `span`.
    const firstRef = scope.refs.el;
    expect(firstRef).not.toBeNull();
    expect(firstRef).toBeDefined();

    // Truthy → falsy: ng-if destroys the clone scope, ngRef's
    // destroy listener nulls the slot.
    scope.show = false;
    scope.$digest();
    expect(scope.refs.el).toBeNull();

    // Falsy → truthy: re-mounted, re-published (a brand-new clone).
    scope.show = true;
    scope.$digest();
    expect(scope.refs.el).not.toBeNull();
    expect(scope.refs.el).toBeDefined();
  });
});

describe('ngRef — clear-on-destroy identity guard (FS §2.2)', () => {
  it('does NOT clobber a newer publish when the old element scope is destroyed', () => {
    const b = bootstrap();
    const scope = Scope.create<{ el?: Element | string | null }>();
    // The directive links against a CHILD scope; its `$on('$destroy', …)`
    // listener fires when that child is torn down, but it writes onto the
    // (prototypally-inherited) `el` slot resolved through the shared
    // expression. We exercise the guard by overwriting the slot with a
    // NEWER value before destroying the child.
    const child = scope.$new();

    const span = document.createElement('span');
    span.setAttribute('ng-ref', 'el');

    b.$compile(span)(child);
    child.$digest();

    // ngRef published the span into the slot.
    expect(child.el).toBe(span);

    // A newer publish under the same name arrives (rare but legal). The
    // identity guard must see the slot no longer holds the span and skip
    // the null-out on teardown.
    const newer = 'newer-reference';
    child.el = newer;

    child.$destroy();

    // The newer value survives — NOT clobbered to null.
    expect(child.el).toBe(newer);
  });

  it('DOES clear the slot on destroy when it still holds the published reference', () => {
    const b = bootstrap();
    const scope = Scope.create<{ el?: Element | null }>();
    const child = scope.$new();

    const span = document.createElement('span');
    span.setAttribute('ng-ref', 'el');

    b.$compile(span)(child);
    child.$digest();
    expect(child.el).toBe(span);

    // Slot still holds the span → teardown nulls it.
    child.$destroy();
    expect(child.el).toBeNull();
  });
});

describe('ngRef — bad expression (FS §2.2)', () => {
  it('routes NgRefBadExpressionError via $exceptionHandler, publishes nothing, keeps digesting', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const span = document.createElement('span');
    span.setAttribute('ng-ref', '123bad');

    b.$compile(span)(scope);
    scope.$digest();

    // The handler saw a NgRefBadExpressionError with cause '$compile'.
    expect(b.exceptionSpy).toHaveBeenCalledTimes(1);
    const [err, cause] = b.exceptionSpy.mock.calls[0] ?? [];
    expect(err).toBeInstanceOf(NgRefBadExpressionError);
    expect(cause).toBe('$compile');

    // Nothing was published — the (non-assignable) target name stays
    // undefined.
    expect(scope['123bad']).toBeUndefined();
    expect(scope.bad).toBeUndefined();

    // The page keeps digesting after the inert bail.
    expect(() => {
      scope.$digest();
    }).not.toThrow();
  });
});

/**
 * Slice 4 — `ng-ref-read` three-way read dispatch.
 *
 * Helper: array-wrap a precomputed DDO into a zero-dependency directive
 * factory (the canonical `[() => ddo]` shape used across the suite —
 * bare functions without `$inject` are rejected by `annotate`).
 */
function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

describe('ngRef — ng-ref-read="$element" (spec 030 Slice 4)', () => {
  it('publishes the native Element, NOT the component controller', () => {
    // Component element carries a controller, but `ng-ref-read="$element"`
    // asks explicitly for the DOM node — no controller lookup must run.
    //
    // ngRef publishes to the element's SURROUNDING scope (upstream
    // parity), so the published value is read off the OUTER scope the
    // component element sits in — a true-sibling / outer-scope read, not
    // the component's injected isolate `$scope`.
    const b = bootstrap(($cp) => {
      $cp.component('myCmp', {
        template: '<span>cmp</span>',
        controller: [
          function (this: Record<string, unknown>): void {
            // A marker that, if published, would distinguish the controller
            // instance from the raw element.
            this.$$isController = true;
          },
        ],
      });
    });

    const scope = Scope.create<{ ref?: unknown }>();
    const cmp = document.createElement('my-cmp');
    cmp.setAttribute('ng-ref', 'ref');
    cmp.setAttribute('ng-ref-read', '$element');

    b.$compile(cmp)(scope);
    scope.$digest();

    const published = scope.ref;

    // The published value is the actual DOM element — identity, type, tag.
    expect(published).toBe(cmp);
    expect(published).toBeInstanceOf(HTMLElement);
    expect((published as Element).tagName.toLowerCase()).toBe('my-cmp');

    // Decisively NOT the controller instance (the controller would carry
    // the `$$isController` marker; the element does not).
    expect((published as Record<string, unknown>).$$isController).toBeUndefined();
  });
});

describe('ngRef — ng-ref-read="<directiveName>" with two controllers on one element (spec 030 Slice 4)', () => {
  it('publishes the SPECIFIC named directive controller, not the sibling controller', () => {
    // Two attribute directives, each declaring its own controller, both
    // match on the SAME <div>. The per-element controller seam stashes
    // each under its normalized name in `$$ngControllers`. `ng-ref-read`
    // names one of them and must publish exactly that one.
    const b = bootstrap(($cp) => {
      $cp.directive(
        'dirAlpha',
        ddoFactory({
          restrict: 'A',
          controller: [
            function (this: Record<string, unknown>): void {
              this.marker = 'alpha';
            },
          ],
        }),
      );
      $cp.directive(
        'dirBeta',
        ddoFactory({
          restrict: 'A',
          controller: [
            function (this: Record<string, unknown>): void {
              this.marker = 'beta';
            },
          ],
        }),
      );
    });

    const scope = Scope.create<{ ref?: unknown }>();
    const el = document.createElement('div');
    el.setAttribute('dir-alpha', '');
    el.setAttribute('dir-beta', '');
    el.setAttribute('ng-ref', 'ref');
    el.setAttribute('ng-ref-read', 'dirAlpha');

    b.$compile(el)(scope);
    scope.$digest();

    // The published value is dirAlpha's controller (alpha marker), NOT
    // dirBeta's.
    expect(scope.ref).toBeDefined();
    expect((scope.ref as Record<string, unknown>).marker).toBe('alpha');
    expect((scope.ref as Record<string, unknown>).marker).not.toBe('beta');
  });
});

describe('ngRef — ng-ref-read="<missing>" miss (spec 030 Slice 4)', () => {
  it('routes NgRefNoControllerError via $exceptionHandler, publishes nothing, keeps digesting', () => {
    // No directive named `missing` is present on the element, so the
    // named-controller read is an authoring mistake.
    const b = bootstrap();
    const scope = Scope.create<{ ref?: unknown }>();
    const el = document.createElement('div');
    el.setAttribute('ng-ref', 'ref');
    el.setAttribute('ng-ref-read', 'missing');

    b.$compile(el)(scope);
    scope.$digest();

    // The handler saw a NgRefNoControllerError with cause '$compile'.
    expect(b.exceptionSpy).toHaveBeenCalledTimes(1);
    const [err, cause] = b.exceptionSpy.mock.calls[0] ?? [];
    expect(err).toBeInstanceOf(NgRefNoControllerError);
    expect(cause).toBe('$compile');

    // Nothing published — the target scope slot stays undefined (no
    // element fallback on the named-read miss path).
    expect(scope.ref).toBeUndefined();

    // The page keeps digesting after the inert bail.
    expect(() => {
      scope.$digest();
    }).not.toThrow();
  });
});
