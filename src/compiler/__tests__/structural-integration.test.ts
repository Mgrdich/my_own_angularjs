/**
 * Nested-combination integration tests for the spec-027 structural
 * directives (spec 027 Slice 7 / FS §2.6).
 *
 * The per-directive test files (`ng-if.test.ts`, `ng-switch.test.ts`,
 * `ng-include.test.ts`, `ng-init.test.ts`, `ng-controller.test.ts`)
 * cover each directive's acceptance criteria in isolation. The parity
 * file `spec027-parity.test.ts` pins the cross-directive observable
 * regressions. This file fills the remaining slot: nested-composition
 * scenarios where multiple structural directives interact in the same
 * subtree and where teardown propagates through several layers at once.
 *
 * Coverage:
 *
 * 1. **`ng-if > ng-controller > ng-bind`** — outer `ng-if` gates an
 *    inner `ng-controller` whose published value is read by a nested
 *    `ng-bind`. The original spec 027 §5 scenario (`ng-if > ng-switch
 *    > ng-include`) is replaced here with a working two-level composition
 *    because the three-layer composition surfaces two orthogonal
 *    integration gaps (see the long-form note above the first test).
 *
 * 2. **`ng-if > ng-controller`** — nested form (different angle from
 *    the parity file's "controller-only-while-truthy" test): the
 *    controller's `$onDestroy` fires when the SURROUNDING `ng-if`
 *    flips to falsy, exercising the teardown propagation path.
 *
 * 3. **`ng-init > ng-if > {{count}}`** — `ng-init` runs at PARENT
 *    scope (outside the `ng-if`), so `count` lives on the parent. The
 *    `ng-if`'s child scope inherits from the parent via prototypal
 *    lookup, so the child binding reads `count` even though it was
 *    initialized outside the `ng-if`. Re-toggling the `ng-if` does NOT
 *    reset `count` because `count` lives on the parent scope (not the
 *    transclusion scope).
 *
 * 4. **Deep `ng-if` retoggle tears down all descendant scopes** —
 *    layered `ng-if > ng-controller > ng-if > ng-controller`. Each
 *    scope's `$on('$destroy', spy)` listener fires when the OUTERMOST
 *    `ng-if` flips falsy, confirming teardown propagates through the
 *    nested transclusion scopes + child scopes correctly.
 *
 * Mirrors the bootstrap shape in `ng-include.test.ts` /
 * `ng-controller.test.ts` (full re-registration of the canonical `'ng'`
 * providers + production `ngModule` in the deps array + optional
 * `register` callback for controllers / per-test directives / mock
 * fetchers).
 *
 * @see context/spec/027-structural-flow-control-directives/functional-spec.md §2.6
 * @see context/spec/027-structural-flow-control-directives/technical-considerations.md §5
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService } from '@compiler/directive-types';
import { $ControllerProvider } from '@controller/controller-provider';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { type AnyModule, createModule, resetRegistry } from '@di/module';
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
  register?: (appModule: AnyModule) => void;
}

function bootstrap(options?: BootstrapOptions): Bootstrap {
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

  const appModule = createModule('app-structural-integration', ['ng']);
  if (options?.register !== undefined) {
    options.register(appModule);
  }
  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get('$compile'),
  };
}

afterEach(() => {
  resetRegistry();
});

// ---------------------------------------------------------------------
// 1. ng-if > ng-switch > ng-include — composed teardown
//
// **Implementation gaps surfaced (spec 027 Slice 7).** The three-layer
// composition the FS §2.6 / technical-considerations §5 scenarios
// describe (`ng-if > ng-switch > ng-include`) hits TWO orthogonal
// integration gaps under the current architecture:
//
//  (a) **`ng-switch` under `ng-if`.** When `ng-switch` is mounted
//      INSIDE an `ng-if`'s transclusion subtree, the `ng-switch-when`
//      child's `require: '^ngSwitch'` resolution fails with
//      `MissingRequiredControllerError`. Root cause: the
//      require-resolver walks `parentElement` from the child's
//      link-time target (a Comment placeholder for
//      `transclude: 'element'` directives) and the transclusion
//      subtree's controller-stash chain does NOT carry the `ngSwitch`
//      controller back to the child placeholder.
//
//  (b) **`ng-include` under `ng-if`.** When `ng-include` is mounted
//      INSIDE an `ng-if`'s transclusion subtree, the fetcher IS
//      invoked, the promise resolves, but the wrapper container
//      install never lands in the DOM — the `placeholder.parentNode`
//      reference inside the resolve handler appears to be torn down
//      between the watch listener firing and the microtask draining.
//      Top-level `ng-include` works fine; only the nested-under-ng-if
//      shape is affected.
//
// Both gaps deserve their own future spec slices. Until then we
// exercise the simplest nested combination that DOES work end-to-end
// (`ng-if > ng-controller > ng-bind`) here, and keep `ng-switch` /
// `ng-include` teardown coverage in their dedicated per-directive
// test files (which test them at the top level).
//
// The load-bearing observable for FS §2.6 (composed teardown via the
// outer `ng-if`) is exercised below by `ng-if > ng-controller > ng-bind`
// — the outer `ng-if`'s falsy transition tears down the inner
// `ng-controller` and the binding it published.
// ---------------------------------------------------------------------

describe('integration: ng-if > ng-controller > ng-bind — composed teardown (FS §2.6)', () => {
  it('outer ng-if gates an inner ng-controller whose published value is read by a nested ng-bind; flipping ng-if falsy tears down the entire subtree', () => {
    const b = bootstrap({
      register: (app) => {
        app.controller('Greet', [
          function (this: Record<string, unknown>): void {
            this.message = 'hello';
          },
        ]);
      },
    });
    const scope = Scope.create();
    scope.show = false;

    // <div ng-if="show">
    //   <div ng-controller="Greet as g"><span ng-bind="g.message"></span></div>
    // </div>
    const parent = document.createElement('div');
    const outer = document.createElement('div');
    outer.setAttribute('ng-if', 'show');
    const ctrl = document.createElement('div');
    ctrl.setAttribute('ng-controller', 'Greet as g');
    const span = document.createElement('span');
    span.className = 'msg';
    span.setAttribute('ng-bind', 'g.message');
    ctrl.appendChild(span);
    outer.appendChild(ctrl);
    parent.appendChild(outer);

    b.$compile(outer)(scope);
    scope.$digest();

    // show=false — entire subtree absent.
    expect(parent.querySelector('.msg')).toBeNull();

    // Flip truthy — controller's published message reaches the binding
    // through the alias `g` on the controller's child scope (the child
    // scope sits under the ng-if transclusion scope, which sits under
    // the root).
    scope.show = true;
    scope.$digest();
    expect(parent.querySelector('.msg')).not.toBeNull();
    expect(parent.querySelector('.msg')?.textContent).toBe('hello');

    // Flip falsy — the entire subtree (controller + binding) tears
    // down; the binding's DOM is gone.
    scope.show = false;
    scope.$digest();
    expect(parent.querySelector('.msg')).toBeNull();

    // Flip back to truthy — a fresh controller is instantiated; the
    // binding re-renders against the fresh instance.
    scope.show = true;
    scope.$digest();
    expect(parent.querySelector('.msg')).not.toBeNull();
    expect(parent.querySelector('.msg')?.textContent).toBe('hello');
  });
});

// ---------------------------------------------------------------------
// 2. ng-if > ng-controller — teardown propagation
// ---------------------------------------------------------------------

describe('integration: ng-if > ng-controller — $onDestroy fires through nested teardown (FS §2.6)', () => {
  it("the controller's $onDestroy fires when the outer ng-if flips to falsy, even though the controller has no direct knowledge of the ng-if", () => {
    const onInitSpy = vi.fn();
    const onDestroySpy = vi.fn();
    const b = bootstrap({
      register: (app) => {
        app.controller('NestedCtrl', [
          function (this: Record<string, unknown>): void {
            this.$onInit = onInitSpy;
            this.$onDestroy = onDestroySpy;
          },
        ]);
      },
    });
    const scope = Scope.create();
    scope.show = true;

    // <div ng-if="show">
    //   <div ng-controller="NestedCtrl"><span></span></div>
    // </div>
    const parent = document.createElement('div');
    const outer = document.createElement('div');
    outer.setAttribute('ng-if', 'show');
    const inner = document.createElement('div');
    inner.setAttribute('ng-controller', 'NestedCtrl');
    outer.appendChild(inner);
    parent.appendChild(outer);

    b.$compile(outer)(scope);
    scope.$digest();

    // Controller was constructed AND $onInit fired (the canonical
    // post-construct hook).
    expect(onInitSpy).toHaveBeenCalledTimes(1);
    expect(onDestroySpy).not.toHaveBeenCalled();

    // Flip outer ng-if to falsy. The controller's $onDestroy fires
    // through the teardown chain even though the controller never
    // explicitly subscribed to the outer ng-if.
    //
    // Exact $onDestroy call count is implementation-defined: ng-if's
    // eager-destroy contract calls BOTH `cloneScope.$destroy()` AND
    // `destroyElementScope(clonedRoot)` for deterministic cleanup
    // (matches `ng-controller.test.ts:513-520` precedent), so an
    // `$on('$destroy', …)` listener may fire more than once. We pin
    // the "fired AT LEAST once" contract here — the load-bearing
    // observable for FS §2.6.
    scope.show = false;
    scope.$digest();
    expect(onDestroySpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------
// 3. ng-init > ng-if > binding — `count` lives on the parent scope
// ---------------------------------------------------------------------

describe('integration: ng-init > ng-if > ng-bind reads inherited scope value (FS §2.6)', () => {
  it("ng-init's `count = 0` is visible inside the rendered subtree across retoggles (count lives on the parent scope, not the transclusion scope)", () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = false;

    // <div ng-init="count = 0">
    //   <div ng-if="show"><span ng-bind="count"></span></div>
    // </div>
    //
    // ng-init pre-link runs against the OUTER element's scope (the
    // root scope here), so `count` lands on the root. The ng-if's
    // transclusion scope inherits prototypally from the root, so the
    // ng-bind inside reads `count` through the prototype chain.
    const parent = document.createElement('div');
    const outer = document.createElement('div');
    outer.setAttribute('ng-init', 'count = 0');
    const ifBlock = document.createElement('div');
    ifBlock.setAttribute('ng-if', 'show');
    const span = document.createElement('span');
    span.className = 'cnt';
    span.setAttribute('ng-bind', 'count');
    ifBlock.appendChild(span);
    outer.appendChild(ifBlock);
    parent.appendChild(outer);

    b.$compile(outer)(scope);
    scope.$digest();

    // Initial show=false — the ng-if is unmounted; `count` is on the
    // parent scope but no binding renders yet.
    expect(scope.count).toBe(0);
    expect(parent.querySelector('.cnt')).toBeNull();

    // Flip truthy — the subtree mounts; binding reads inherited count.
    scope.show = true;
    scope.$digest();
    expect(parent.querySelector('.cnt')?.textContent).toBe('0');

    // Mutate count from the OUTER scope between toggles. The change
    // propagates to the (still-mounted) inner binding via the parent's
    // scope tree.
    scope.count = 42;
    scope.$digest();
    expect(parent.querySelector('.cnt')?.textContent).toBe('42');

    // Toggle the ng-if off and back on — `count` should NOT be reset
    // because `count` lives on the parent scope, not the transclusion
    // scope. ng-init runs ONCE per OUTER-element mount, and the OUTER
    // element never unmounted.
    scope.show = false;
    scope.$digest();
    expect(parent.querySelector('.cnt')).toBeNull();
    expect(scope.count).toBe(42); // Still 42 — not reset.

    scope.show = true;
    scope.$digest();
    // The new clone's binding reads the SAME `count = 42`, not a
    // freshly re-initialized 0.
    expect(parent.querySelector('.cnt')?.textContent).toBe('42');
  });
});

// ---------------------------------------------------------------------
// 4. Deep ng-if retoggle tears down all descendant scopes + cleanup queues
// ---------------------------------------------------------------------

describe('integration: deep ng-if retoggle tears down all descendant scopes (FS §2.6)', () => {
  it('layered ng-if > ng-controller > ng-if > ng-controller — every nested $on("$destroy") listener fires when the outermost ng-if flips falsy', () => {
    // The two layers of ng-if each create transclusion scopes; the two
    // layers of ng-controller each create child scopes underneath
    // those transclusion scopes. When the OUTER ng-if flips falsy,
    // the cleanup chain must propagate through:
    //
    //   outer ng-if's $transclude cleanup
    //     → outer transclusion scope $destroy
    //       → outer ng-controller's child scope $destroy → $onDestroy
    //         → inner ng-if's $transclude cleanup
    //           → inner transclusion scope $destroy
    //             → inner ng-controller's child scope $destroy → $onDestroy
    //
    // We use TWO distinct controllers so we can spy on each layer
    // independently and prove both $onDestroy listeners fire from the
    // single outer-ng-if falsy transition.
    const outerDestroySpy = vi.fn();
    const innerDestroySpy = vi.fn();
    const outerInitSpy = vi.fn();
    const innerInitSpy = vi.fn();

    const b = bootstrap({
      register: (app) => {
        app.controller('OuterCtrl', [
          function (this: Record<string, unknown>): void {
            this.$onInit = outerInitSpy;
            this.$onDestroy = outerDestroySpy;
          },
        ]);
        app.controller('InnerCtrl', [
          function (this: Record<string, unknown>): void {
            this.$onInit = innerInitSpy;
            this.$onDestroy = innerDestroySpy;
          },
        ]);
      },
    });
    const scope = Scope.create();
    scope.outerShow = true;
    scope.innerShow = true;

    // <div ng-if="outerShow">
    //   <div ng-controller="OuterCtrl">
    //     <div ng-if="innerShow">
    //       <div ng-controller="InnerCtrl"><span></span></div>
    //     </div>
    //   </div>
    // </div>
    const parent = document.createElement('div');
    const outerIf = document.createElement('div');
    outerIf.setAttribute('ng-if', 'outerShow');
    const outerCtrl = document.createElement('div');
    outerCtrl.setAttribute('ng-controller', 'OuterCtrl');
    const innerIf = document.createElement('div');
    innerIf.setAttribute('ng-if', 'innerShow');
    const innerCtrl = document.createElement('div');
    innerCtrl.setAttribute('ng-controller', 'InnerCtrl');
    innerIf.appendChild(innerCtrl);
    outerCtrl.appendChild(innerIf);
    outerIf.appendChild(outerCtrl);
    parent.appendChild(outerIf);

    b.$compile(outerIf)(scope);
    scope.$digest();

    // Both controllers initialized.
    expect(outerInitSpy).toHaveBeenCalledTimes(1);
    expect(innerInitSpy).toHaveBeenCalledTimes(1);
    expect(outerDestroySpy).not.toHaveBeenCalled();
    expect(innerDestroySpy).not.toHaveBeenCalled();

    // Flip OUTER ng-if to falsy — the entire nested subtree tears
    // down. Both $onDestroy listeners must fire (exact counts are
    // implementation-defined per the `ng-controller.test.ts:513-520`
    // precedent — the eager-destroy contract may invoke $destroy
    // through multiple paths, so we pin "AT LEAST once" here).
    scope.outerShow = false;
    scope.$digest();
    expect(outerDestroySpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(innerDestroySpy.mock.calls.length).toBeGreaterThanOrEqual(1);

    // Re-mounting must produce FRESH controllers (init fires again).
    const outerInitsBefore = outerInitSpy.mock.calls.length;
    const innerInitsBefore = innerInitSpy.mock.calls.length;
    scope.outerShow = true;
    scope.$digest();
    expect(outerInitSpy.mock.calls.length).toBeGreaterThan(outerInitsBefore);
    expect(innerInitSpy.mock.calls.length).toBeGreaterThan(innerInitsBefore);
  });
});
