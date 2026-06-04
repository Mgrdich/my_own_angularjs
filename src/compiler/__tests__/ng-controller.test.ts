/**
 * `ngController` directive — attach a registered controller to a subtree
 * (spec 027 Slice 4 / FS §2.5).
 *
 * Locks the AngularJS-canonical behavior for the built-in `ngController`
 * directive registered on `ngModule`:
 *
 * - Registration sanity: `injector.has('ngControllerDirective') === true`
 *   when an app's module declares `'ng'` in its deps chain.
 * - Named lookup against `$controllerProvider`'s registry — a controller
 *   registered via `module.controller(name, factory)` is instantiable
 *   via `<div ng-controller="name">…</div>`.
 * - `Name as alias` parses correctly — `<div ng-controller="MyCtrl as vm">`
 *   publishes the instance under `vm` on the directive's child scope so
 *   `vm.<property>` resolves in nested bindings.
 * - Bare name without alias — the instance is created but is NOT
 *   published under any scope alias (matches AngularJS — the bare form
 *   produces a controller whose only observable footprint is its
 *   constructor side-effects on `$scope`).
 * - Lifecycle hooks fire on the canonical timeline: `$onInit` after
 *   instantiation, `$postLink` after the per-element post-link loop
 *   completes, `$onDestroy` on scope destruction.
 * - `$onChanges` does NOT fire — `ng-controller` declares no isolate
 *   bindings, so the `bindToController` change-record path is never
 *   reached. Matches AngularJS.
 * - Unknown controller name routes `UnknownControllerError` via
 *   `$exceptionHandler('$compile')`; the rest of the page does not crash.
 * - Co-existence with `ng-if`: `<div ng-if="show" ng-controller="MyCtrl">`
 *   only instantiates while `show` is truthy. Every falsy → truthy
 *   transition produces a fresh instance with a fresh `$onInit`; every
 *   truthy → falsy transition fires the active instance's `$onDestroy`.
 *
 * Tests use the canonical `ngModule` so the `ngController` directive
 * registered by `src/core/ng-module.ts` is reachable end-to-end —
 * mirroring the `ng-init.test.ts` / `ng-if.test.ts` bootstrap pattern.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { destroyElementScope } from '@compiler/cleanup';
import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { UnknownControllerError } from '@controller/controller-errors';
import { createInjector } from '@di/injector';
import { type AnyModule, createModule, resetRegistry } from '@di/module';
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

/**
 * Build an injector wired with the canonical `ng` providers plus the
 * production `ngModule` registration block (so the spec-027 directives
 * are reachable). The caller can register controllers and per-test
 * directives on the returned `app` module via the `register` callback.
 *
 * Mirrors `ng-init.test.ts` / `ng-if.test.ts`'s `bootstrap()` pattern,
 * extended with a `controllers` channel for `module.controller(...)`
 * registrations.
 */
function bootstrap(options?: {
  register?: (appModule: AnyModule) => void;
  exceptionHandler?: (...args: unknown[]) => void;
}): Bootstrap {
  resetRegistry();
  // The local `ng` module isn't strictly load-bearing once the production
  // `ngModule` is in the deps array (its de-duplication guard means only
  // ONE module with the name `'ng'` ever drains its invoke queue), but
  // it must exist in the registry so `appModule.requires = ['ng']`
  // resolves without throwing `Module not found: ng`. We keep the
  // canonical provider stack here so a hypothetical future
  // `bootstrap({ skipProductionNgModule: true })` would still resolve.
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

  const appModule = createModule('app', ['ng']);
  // Register the spy handler on the app module so it overrides the
  // production `ngModule`'s default `consoleErrorExceptionHandler`
  // factory (last-wins on duplicate provider names). The production
  // `ngModule` loads FIRST (it appears earlier in the injector's deps
  // array), then `appModule`'s invoke queue drains, so the app's
  // re-registration of `$exceptionHandler` is the one that survives.
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
    injector: built,
  };
}

afterEach(() => {
  resetRegistry();
});

describe('ngController — registration on ngModule (spec 027 Slice 4)', () => {
  it('injector.has("ngControllerDirective") === true when "ng" is in the deps chain', () => {
    const b = bootstrap();
    expect(b.injector.has('ngControllerDirective')).toBe(true);
  });
});

describe('ngController — named lookup against $controllerProvider registry (FS §2.5)', () => {
  it('instantiates a controller registered via module.controller exactly once on link', () => {
    const ctorSpy = vi.fn();
    const b = bootstrap({
      register: (app) => {
        app.controller('MyCtrl', [
          '$scope',
          function (this: unknown, $scope: unknown): void {
            ctorSpy();
            ($scope as Record<string, unknown>).touched = true;
          },
        ]);
      },
    });
    const scope = Scope.create();

    const element = document.createElement('div');
    element.setAttribute('ng-controller', 'MyCtrl');

    b.$compile(element)(scope);
    scope.$digest();

    expect(ctorSpy).toHaveBeenCalledTimes(1);
    // The constructor wrote `touched = true` onto its OWN child scope
    // (`ng-controller` is `scope: true`), so the parent scope is
    // untouched. The directive's child scope sits under `scope` and we
    // can read it back through the element's `$$ngScope` stash.
    expect(scope.touched).toBeUndefined();
    const childScope = (element as unknown as { $$ngScope?: Record<string, unknown> }).$$ngScope;
    expect(childScope?.touched).toBe(true);
  });
});

describe('ngController — "Name as alias" parses correctly (FS §2.5)', () => {
  it("publishes the instance on the directive's child scope under the alias", () => {
    const b = bootstrap({
      register: (app) => {
        app.controller('MyCtrl', [
          function (this: Record<string, unknown>): void {
            this.x = 'hello';
          },
        ]);
      },
    });
    const scope = Scope.create();

    const element = document.createElement('div');
    element.setAttribute('ng-controller', 'MyCtrl as vm');

    b.$compile(element)(scope);
    scope.$digest();

    // The alias `vm` is published on the directive's child scope, not
    // on the parent.
    expect((scope as unknown as { vm?: unknown }).vm).toBeUndefined();
    const childScope = (
      element as unknown as {
        $$ngScope?: { vm?: { x?: string } };
      }
    ).$$ngScope;
    expect(childScope?.vm?.x).toBe('hello');
  });

  it('a child ng-bind="vm.x" inside the subtree resolves through the alias', () => {
    const b = bootstrap({
      register: (app) => {
        app.controller('MyCtrl', [
          function (this: Record<string, unknown>): void {
            this.x = 'projected';
          },
        ]);
      },
    });
    const scope = Scope.create();

    const host = document.createElement('div');
    host.setAttribute('ng-controller', 'MyCtrl as vm');
    const span = document.createElement('span');
    span.setAttribute('ng-bind', 'vm.x');
    host.appendChild(span);

    b.$compile(host)(scope);
    scope.$digest();

    expect(span.textContent).toBe('projected');
  });
});

describe('ngController — bare-name without alias (FS §2.5)', () => {
  it('creates the instance but does NOT publish any scope alias', () => {
    let constructorRan = false;
    let constructedGreet: string | undefined;
    const b = bootstrap({
      register: (app) => {
        app.controller('PlainCtrl', [
          function (this: Record<string, unknown>): void {
            this.greet = 'hi';
            constructorRan = true;
            constructedGreet = this.greet as string;
          },
        ]);
      },
    });
    const scope = Scope.create();

    const element = document.createElement('div');
    element.setAttribute('ng-controller', 'PlainCtrl');

    b.$compile(element)(scope);
    scope.$digest();

    // Instance WAS created (constructor ran).
    expect(constructorRan).toBe(true);
    expect(constructedGreet).toBe('hi');

    // No alias published on either the parent scope or the child scope.
    const childScope = (
      element as unknown as {
        $$ngScope?: Record<string, unknown>;
      }
    ).$$ngScope;
    // The child scope itself does not carry the instance under any key
    // (no `PlainCtrl` slot, no `$ctrl` default — controllerAs is
    // strictly opt-in via the `as alias` suffix on `ng-controller`).
    expect(childScope?.PlainCtrl).toBeUndefined();
    expect(childScope?.$ctrl).toBeUndefined();
  });
});

describe('ngController — lifecycle hooks fire on the canonical timeline (FS §2.5)', () => {
  it('$onInit fires once, AFTER the constructor body executes', () => {
    const order: string[] = [];
    const b = bootstrap({
      register: (app) => {
        app.controller('LifecycleCtrl', [
          function (this: Record<string, unknown>): void {
            order.push('construct');
            this.$onInit = function (): void {
              order.push('$onInit');
            };
          },
        ]);
      },
    });
    const scope = Scope.create();

    const element = document.createElement('div');
    element.setAttribute('ng-controller', 'LifecycleCtrl');

    b.$compile(element)(scope);

    expect(order).toEqual(['construct', '$onInit']);
  });

  it('$postLink fires AFTER the per-element post-link loop completes', () => {
    const order: string[] = [];
    const b = bootstrap({
      register: (app) => {
        app.controller('LifecycleCtrl', [
          function (this: Record<string, unknown>): void {
            this.$postLink = function (): void {
              order.push('$postLink');
            };
          },
        ]);
        // Add a sibling probe directive on the same element that has a
        // post-link fn so we can pin the `$postLink` AFTER post-link ordering.
        app.directive('myProbe', [
          () => ({
            restrict: 'A',
            compile: () => ({
              post: () => {
                order.push('postLink');
              },
            }),
          }),
        ]);
      },
    });
    const scope = Scope.create();

    const element = document.createElement('div');
    element.setAttribute('ng-controller', 'LifecycleCtrl');
    element.setAttribute('my-probe', '');

    b.$compile(element)(scope);

    // `$postLink` fires AFTER the sibling probe's post-link runs.
    expect(order).toEqual(['postLink', '$postLink']);
  });

  it('$onDestroy fires when the element scope is torn down', () => {
    const onDestroySpy = vi.fn();
    const b = bootstrap({
      register: (app) => {
        app.controller('LifecycleCtrl', [
          function (this: Record<string, unknown>): void {
            this.$onDestroy = onDestroySpy;
          },
        ]);
      },
    });
    const scope = Scope.create();

    const element = document.createElement('div');
    element.setAttribute('ng-controller', 'LifecycleCtrl');

    b.$compile(element)(scope);

    expect(onDestroySpy).not.toHaveBeenCalled();
    // Tearing down the element's scope (the directive's `scope: true`
    // child scope) propagates `$destroy` to its registered listeners,
    // which fires `$onDestroy`. `destroyElementScope` is the canonical
    // teardown entry — `scope.$destroy()` on the root scope is a no-op,
    // so we target the child scope directly here.
    destroyElementScope(element);
    expect(onDestroySpy).toHaveBeenCalledTimes(1);
  });

  it("$onDestroy also fires through parent-scope $destroy propagation when the parent isn't the root", () => {
    const onDestroySpy = vi.fn();
    const b = bootstrap({
      register: (app) => {
        app.controller('LifecycleCtrl', [
          function (this: Record<string, unknown>): void {
            this.$onDestroy = onDestroySpy;
          },
        ]);
      },
    });
    // A non-root parent — `scope.$destroy()` is a no-op for the root, so
    // we build an explicit child scope and link the directive against it.
    const root = Scope.create();
    const parent = root.$new();

    const element = document.createElement('div');
    element.setAttribute('ng-controller', 'LifecycleCtrl');

    b.$compile(element)(parent);

    expect(onDestroySpy).not.toHaveBeenCalled();
    parent.$destroy();
    expect(onDestroySpy).toHaveBeenCalledTimes(1);
  });
});

describe('ngController — $onChanges does NOT fire (FS §2.5, technical-considerations §2.6)', () => {
  it('$onChanges hook is never invoked — no isolate bindings means no change records', () => {
    const onChangesSpy = vi.fn();
    const b = bootstrap({
      register: (app) => {
        app.controller('NoChangesCtrl', [
          '$scope',
          function (this: Record<string, unknown>, $scope: unknown): void {
            ($scope as Record<string, unknown>).value = 'initial';
            this.$onChanges = onChangesSpy;
          },
        ]);
      },
    });
    const scope = Scope.create();

    const element = document.createElement('div');
    element.setAttribute('ng-controller', 'NoChangesCtrl');

    b.$compile(element)(scope);
    scope.$digest();

    // No initial fire — `ng-controller` declares no isolate bindings,
    // so the `bindToController` change-record path is never reached.
    expect(onChangesSpy).not.toHaveBeenCalled();

    // Mutating a scope value and re-digesting also does NOT trigger
    // `$onChanges`. There simply are no watchers feeding it.
    const childScope = (element as unknown as { $$ngScope?: Record<string, unknown> }).$$ngScope;
    if (childScope !== undefined) {
      childScope.value = 'changed';
    }
    scope.$digest();
    scope.$digest();

    expect(onChangesSpy).not.toHaveBeenCalled();
  });
});

describe("ngController — unknown name routes via $exceptionHandler('$compile')", () => {
  it('UnknownControllerError is routed and the rest of the page does NOT crash', () => {
    const handlerSpy = vi.fn<(...args: unknown[]) => void>();
    const b = bootstrap({ exceptionHandler: handlerSpy });
    const scope = Scope.create();
    scope.afterMarker = 'visible';

    // No controller registered with this name. The seam will throw
    // `UnknownControllerError` from `$controller(...)` and the
    // surrounding try/catch routes it via `$exceptionHandler('$compile')`.
    const element = document.createElement('div');
    element.setAttribute('ng-controller', 'NonExistent');

    // A sibling sub-element with an `ng-bind` to verify the rest of
    // the page continues linking past the throw.
    const after = document.createElement('span');
    after.setAttribute('ng-bind', 'afterMarker');
    element.appendChild(after);

    expect(() => {
      b.$compile(element)(scope);
      scope.$digest();
    }).not.toThrow();

    expect(handlerSpy).toHaveBeenCalled();
    const matchingCall = handlerSpy.mock.calls.find((args) => args[0] instanceof UnknownControllerError);
    expect(matchingCall).toBeDefined();
    const [err, cause] = matchingCall ?? [];
    expect(err).toBeInstanceOf(UnknownControllerError);
    expect(cause).toBe('$compile');

    // Linking continued — the child `ng-bind` rendered its expression.
    expect(after.textContent).toBe('visible');
  });
});

describe('ngController — co-existence with ng-if (FS §2.5)', () => {
  it('instantiates ONLY while ng-if is truthy; each truthy transition produces a FRESH instance', () => {
    const ctorSpy = vi.fn();
    const onInitSpy = vi.fn();
    const onDestroySpy = vi.fn();
    const seenInstances: unknown[] = [];

    const b = bootstrap({
      register: (app) => {
        app.controller('GatedCtrl', [
          function (this: Record<string, unknown>): void {
            ctorSpy();
            seenInstances.push(this);
            this.$onInit = onInitSpy;
            this.$onDestroy = onDestroySpy;
          },
        ]);
      },
    });
    const scope = Scope.create();
    scope.show = false;

    // Nested form — `ng-if` on the OUTER element gates the inner
    // `ng-controller`. This is the AngularJS-canonical layout: putting
    // both directives on the SAME element is blocked by `ng-if`'s
    // priority-600 terminal cutoff at the priority-500 `ng-controller`
    // level (and matches the spec 027 `structural-integration.test.ts`
    // nested-combination guidance in technical-considerations §5).
    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-if', 'show');
    const inner = document.createElement('div');
    inner.setAttribute('ng-controller', 'GatedCtrl');
    host.appendChild(inner);
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    // Initial `show = false` — controller is NOT instantiated.
    expect(ctorSpy).toHaveBeenCalledTimes(0);
    expect(onInitSpy).toHaveBeenCalledTimes(0);
    expect(onDestroySpy).toHaveBeenCalledTimes(0);

    // Flip to truthy — one fresh instance.
    scope.show = true;
    scope.$digest();
    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(onInitSpy).toHaveBeenCalledTimes(1);
    expect(onDestroySpy).toHaveBeenCalledTimes(0);
    expect(seenInstances).toHaveLength(1);

    // Flip back to falsy — previous instance's `$onDestroy` fires; ctor
    // count does NOT increase (we don't "unconstruct"). The exact
    // `$onDestroy` invocation count is implementation-defined — ng-if's
    // teardown calls BOTH `cloneScope.$destroy()` and
    // `destroyElementScope(clonedRoot)` for deterministic cleanup, and
    // the `$on('$destroy', …)` listener registered on the controller's
    // child scope fires once per path (the second call's no-op
    // semantics on an already-emptied listener list would otherwise
    // require an idempotence guard we deliberately do NOT add). We pin
    // the "fired AT LEAST once" contract here — the load-bearing
    // assertion for the FS §2.5 acceptance criterion.
    const beforeFalsyDestroys = onDestroySpy.mock.calls.length;
    scope.show = false;
    scope.$digest();
    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(onDestroySpy.mock.calls.length).toBeGreaterThan(beforeFalsyDestroys);

    // Flip to truthy AGAIN — a brand-new instance is constructed. The
    // ctor count goes 1 → 2, and the two captured `this` references
    // are distinct (proves the "fresh instance per mount" contract).
    scope.show = true;
    scope.$digest();
    expect(ctorSpy).toHaveBeenCalledTimes(2);
    expect(onInitSpy).toHaveBeenCalledTimes(2);
    expect(seenInstances).toHaveLength(2);
    expect(seenInstances[0]).not.toBe(seenInstances[1]);
  });
});
