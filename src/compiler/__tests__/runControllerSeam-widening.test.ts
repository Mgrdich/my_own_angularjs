/**
 * Regression coverage for the `runControllerSeam` widening (spec 027 Slice 4).
 *
 * Slice 4 widens the per-element controller seam at
 * `src/compiler/compile.ts:runControllerSeam` with a THIRD dispatch
 * branch — when `directive.controller` is the sentinel shape
 * `{ __attributeSource: 'ngController' }`, the seam reads the controller
 * name from `attrs[__attributeSource]` at link time and routes it
 * through the eager `$controller(name, locals)` invocation.
 *
 * The two pre-existing branches MUST continue to behave identically:
 *
 *  1. **Eager path** — `controller: 'MyCtrl'` (string), `controller: Fn`
 *     (function), `controller: [...deps, Fn]` (array). Lifecycle hooks
 *     fire in canonical order; `controllerAs` alias publishes on scope.
 *
 *  2. **`bindToController` deferred-alias path** — `bindToController: true`
 *     (or `{...}`) + isolate bindings. The alias publishes AFTER the
 *     bindings are wired AND AFTER `$onInit` fires (spec 022 contract).
 *
 * This regression suite locks the unchanged contracts:
 *
 *  - Eager path: spec-020 happy path, hook ordering, `controllerAs`.
 *  - `bindToController` path: spec-022 deferred-alias ordering, the
 *    canonical `construct → $onInit → preLink → postLink → $postLink`
 *    chain, alias-visible-after-bindings-populated check.
 *  - Sentinel branch detection: a custom directive registration that
 *    sets `directive.controller = { __attributeSource: 'foo' }` (against
 *    a non-`ngController` directive name) triggers the new branch and
 *    reads the controller name from the matching `attrs.foo` slot.
 *
 * The four-hook firing-order test in spec 022's lifecycle-hooks suite
 * is the load-bearing precedent; this file mirrors its shape for the
 * three branches above.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { destroyElementScope } from '@compiler/cleanup';
import type { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService, DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import { Scope } from '@core/index';
import type { $ControllerProvider } from '@controller/controller-provider';
import type { ControllerInvokable } from '@controller/controller-types';
import { createInjector } from '@di/injector';
import { createModule } from '@di/module';

import { bootstrapNgModule, compileWith } from './test-helpers';

/**
 * Build a `$compile` service from an `app` module whose `config` block
 * receives BOTH `$compileProvider` and `$controllerProvider`. Mirrors
 * `compileWith` (from `test-helpers`) but extended to the two-provider
 * shape needed by sentinel-branch tests that register named controllers
 * via `$controllerProvider.register(...)`. Bootstraps the canonical `ng`
 * module via `bootstrapNgModule()` first; subsequent tests can use this
 * helper to reach the sentinel-branch dispatch without touching the
 * production `ngModule`.
 */
function compileWithControllers(
  register: ($cp: $CompileProvider, $ctrlp: $ControllerProvider) => void,
): CompileService {
  const appModule = createModule('app', ['ng']).config([
    '$compileProvider',
    '$controllerProvider',
    ($cp: $CompileProvider, $ctrlp: $ControllerProvider) => {
      register($cp, $ctrlp);
    },
  ]);
  return createInjector([appModule]).get('$compile');
}

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

interface ParentScope {
  outerName?: string;
  pickValue?: unknown;
  [k: string]: unknown;
}

/**
 * Build a controller factory whose trailing function stashes `this`
 * onto `$scope.$$instance` (when `$scope` is provided in the locals)
 * and applies any extra `setup` (e.g. assigning hook methods on `this`).
 */
function makeCtrl(setup?: (instance: Record<string, unknown>) => void): ControllerInvokable {
  return [
    '$scope',
    function (this: unknown, $scope: unknown): void {
      const inst = this as Record<string, unknown>;
      ($scope as { $$instance: unknown }).$$instance = inst;
      if (setup !== undefined) {
        setup(inst);
      }
    },
  ] as ControllerInvokable;
}

afterEach(() => {
  // bootstrapNgModule resets the module registry on every call, so
  // afterEach is defensive only — no module state leaks across tests.
});

describe('runControllerSeam: eager path (regression — unchanged from spec 020)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('string `controller: "RegisteredCtrl"` still resolves through $controllerProvider registry', () => {
    let observedAt: 'never' | 'construct' = 'never';
    const $compile = compileWithControllers(($cp, $ctrlp) => {
      $ctrlp.register('RegisteredCtrl', [
        function (): void {
          observedAt = 'construct';
        },
      ]);
      $cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'A',
          controller: 'RegisteredCtrl',
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    const parent = Scope.create<ParentScope>();
    $compile(node)(parent);

    expect(observedAt).toBe('construct');
  });

  it('inline function controller fires the constructor with the standard locals', () => {
    let capturedScope: unknown = null;
    let capturedElement: unknown = null;
    let capturedAttrs: unknown = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'A',
          controller: [
            '$scope',
            '$element',
            '$attrs',
            function ($scope: unknown, $element: unknown, $attrs: unknown): void {
              capturedScope = $scope;
              capturedElement = $element;
              capturedAttrs = $attrs;
            },
          ] as ControllerInvokable,
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    const parent = Scope.create<ParentScope>();
    $compile(node)(parent);

    expect(capturedScope).toBe(parent);
    expect(capturedElement).toBe(node);
    expect(typeof (capturedAttrs as { $set?: unknown }).$set).toBe('function');
  });

  it('eager path: lifecycle hooks fire in canonical order ($onInit, preLink, postLink, $postLink, $onDestroy)', () => {
    const order: string[] = [];
    const ctrl: ControllerInvokable = [
      function (this: Record<string, unknown>): void {
        order.push('construct');
        this.$onInit = (): void => {
          order.push('$onInit');
        };
        this.$onDestroy = (): void => {
          order.push('$onDestroy');
        };
        this.$postLink = (): void => {
          order.push('$postLink');
        };
      },
    ] as ControllerInvokable;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'A',
          // `scope: true` so the directive's own child scope carries
          // the `$on('$destroy', …)` listener — without it the
          // listener is registered on the PARENT scope, and tearing
          // down a root scope is a documented no-op.
          scope: true,
          controller: ctrl,
          controllerAs: '$ctrl',
          compile: () => ({
            pre: () => {
              order.push('preLink');
            },
            post: () => {
              order.push('postLink');
            },
          }),
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    const parent = Scope.create<ParentScope>();
    $compile(node)(parent);
    destroyElementScope(node);

    expect(order).toEqual(['construct', '$onInit', 'preLink', 'postLink', '$postLink', '$onDestroy']);
  });

  it('eager path: `controllerAs` publishes the instance on the scope (visible before children link)', () => {
    let scopeAtChildLink: Record<string, unknown> | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'parentDir',
        ddoFactory({
          restrict: 'A',
          controller: [
            function (this: Record<string, unknown>): void {
              this.greeting = 'hello';
            },
          ] as ControllerInvokable,
          controllerAs: 'vm',
        }),
      );
      $cp.directive(
        'childProbe',
        ddoFactory({
          restrict: 'A',
          link: (scope) => {
            scopeAtChildLink = scope as unknown as Record<string, unknown>;
          },
        }),
      );
    });
    const host = document.createElement('div');
    host.setAttribute('parent-dir', '');
    const child = document.createElement('span');
    child.setAttribute('child-probe', '');
    host.appendChild(child);
    const parent = Scope.create<ParentScope>();
    $compile(host)(parent);

    expect(scopeAtChildLink).not.toBeNull();
    const vm = (scopeAtChildLink as Record<string, unknown> | null)?.vm as { greeting?: string };
    expect(vm.greeting).toBe('hello');
  });
});

describe('runControllerSeam: bindToController deferred-alias path (regression — unchanged from spec 022)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('alias publishes AFTER bindings are wired AND AFTER $onInit fires', () => {
    const order: string[] = [];
    let observedUserInOnInit: unknown = '<not-set>';
    const ctrl = makeCtrl((inst) => {
      inst.$onInit = function (this: Record<string, unknown>): void {
        order.push('$onInit');
        observedUserInOnInit = this.user;
      };
    });
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: { user: '<' } as Record<string, string>,
          bindToController: true,
          controller: ctrl,
          controllerAs: '$ctrl',
          compile: () => ({
            pre: () => {
              order.push('preLink');
            },
            post: () => {
              order.push('postLink');
            },
          }),
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    node.setAttribute('user', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = { id: 'u1', name: 'Alice' };
    $compile(node)(parent);

    // `$onInit` saw the populated `<` binding on the instance —
    // bindings were wired BEFORE the hook fired.
    expect(observedUserInOnInit).toEqual({ id: 'u1', name: 'Alice' });
    expect(order).toEqual(['$onInit', 'preLink', 'postLink']);
  });

  it('the four-hook firing order is unchanged on the bindToController path', () => {
    const order: string[] = [];
    const ctrl: ControllerInvokable = [
      '$scope',
      function (this: unknown, $scope: unknown): void {
        order.push('construct');
        const inst = this as Record<string, unknown>;
        ($scope as { $$instance: unknown }).$$instance = inst;
        inst.$onInit = function (): void {
          order.push('$onInit');
        };
        inst.$onDestroy = function (): void {
          order.push('$onDestroy');
        };
        inst.$postLink = function (): void {
          order.push('$postLink');
        };
      },
    ] as ControllerInvokable;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: { x: '<' } as Record<string, string>,
          bindToController: true,
          controller: ctrl,
          controllerAs: '$ctrl',
          compile: () => ({
            pre: () => {
              order.push('preLink');
            },
            post: () => {
              order.push('postLink');
            },
          }),
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    node.setAttribute('x', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = 'val';
    $compile(node)(parent);
    destroyElementScope(node);

    // Canonical pinning — identical to spec-022's shared-spy ordering
    // test. `$onChanges` is omitted here (no `@` binding) so the
    // sequence is the four-hook chain.
    expect(order).toEqual(['construct', '$onInit', 'preLink', 'postLink', '$postLink', '$onDestroy']);
  });
});

describe('runControllerSeam: sentinel branch — `{ __attributeSource: ... }` (spec 027 Slice 4)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('a custom directive declaring `controller: { __attributeSource: "myAttr" }` reads the controller name from `attrs.myAttr`', () => {
    // This is the load-bearing test for the sentinel branch detection.
    // We register a CUSTOM directive (NOT the built-in `ng-controller`)
    // whose `controller` field is the sentinel shape. The seam must
    // recognize the shape, read `attrs.myAttr` at link time, and route
    // the resolved name through `$controller(name, locals)`.
    const ctorSpy = vi.fn();
    const $compile = compileWithControllers(($cp, $ctrlp) => {
      $ctrlp.register('AttachedCtrl', [
        '$scope',
        function (this: Record<string, unknown>, $scope: unknown): void {
          ctorSpy();
          ($scope as Record<string, unknown>).touched = true;
          this.greeting = 'sentinel';
        },
      ]);
      $cp.directive(
        'attachCtrl',
        ddoFactory({
          restrict: 'A',
          // Cast to unknown to bypass the public `ControllerInvokable`
          // type — the sentinel shape is a documented union arm that
          // `normalizeController` accepts at runtime.
          controller: { __attributeSource: 'myAttr' } as unknown as ControllerInvokable,
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('attach-ctrl', '');
    node.setAttribute('my-attr', 'AttachedCtrl');
    const parent = Scope.create<ParentScope>();
    $compile(node)(parent);
    parent.$digest();

    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(parent.touched).toBe(true);
  });

  it("sentinel branch + `Name as alias` — the alias is parsed by `$controller`'s `parseControllerName`", () => {
    // The sentinel branch passes no `ident` argument to `$controller`,
    // so the alias is parsed from the attribute string itself.
    const $compile = compileWithControllers(($cp, $ctrlp) => {
      $ctrlp.register('AliasedCtrl', [
        function (this: Record<string, unknown>): void {
          this.greeting = 'aliased';
        },
      ]);
      $cp.directive(
        'attachCtrl',
        ddoFactory({
          restrict: 'A',
          controller: { __attributeSource: 'myAttr' } as unknown as ControllerInvokable,
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('attach-ctrl', '');
    node.setAttribute('my-attr', 'AliasedCtrl as vm');
    const parent = Scope.create<ParentScope>();
    $compile(node)(parent);

    // Alias `vm` is published on the parent scope (the directive declared
    // no `scope: true`, so it uses the parent scope directly).
    const vm = (parent as unknown as { vm?: { greeting?: string } }).vm;
    expect(vm?.greeting).toBe('aliased');
  });

  it('sentinel branch: empty / missing attribute value causes a clean bail (no throw, no instantiation)', () => {
    const ctorSpy = vi.fn();
    const $compile = compileWithControllers(($cp, $ctrlp) => {
      $ctrlp.register('NeverCalledCtrl', [
        function (): void {
          ctorSpy();
        },
      ]);
      $cp.directive(
        'attachCtrl',
        ddoFactory({
          restrict: 'A',
          controller: { __attributeSource: 'myAttr' } as unknown as ControllerInvokable,
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('attach-ctrl', '');
    // Intentionally NO `my-attr` attribute — the sentinel branch's
    // `attrs.myAttr` lookup returns `undefined` and clean-bails.
    const parent = Scope.create<ParentScope>();

    expect(() => {
      $compile(node)(parent);
    }).not.toThrow();
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it('sentinel branch: lifecycle hooks ($onInit, $postLink, $onDestroy) fire on the eager-path timeline', () => {
    const order: string[] = [];
    const $compile = compileWithControllers(($cp, $ctrlp) => {
      $ctrlp.register('LifecycleCtrl', [
        function (this: Record<string, unknown>): void {
          order.push('construct');
          this.$onInit = function (): void {
            order.push('$onInit');
          };
          this.$postLink = function (): void {
            order.push('$postLink');
          };
          this.$onDestroy = function (): void {
            order.push('$onDestroy');
          };
        },
      ]);
      $cp.directive(
        'attachCtrl',
        ddoFactory({
          restrict: 'A',
          // `scope: true` so the per-element listener is registered on
          // the directive's child scope (matches `ng-controller`'s
          // canonical DDO shape), allowing `destroyElementScope` to
          // tear it down. Without this, the `$destroy` listener would
          // sit on a root parent scope where `$destroy()` is a no-op.
          scope: true,
          controller: { __attributeSource: 'myAttr' } as unknown as ControllerInvokable,
          compile: () => ({
            post: () => {
              order.push('postLink');
            },
          }),
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('attach-ctrl', '');
    node.setAttribute('my-attr', 'LifecycleCtrl');
    const parent = Scope.create<ParentScope>();
    $compile(node)(parent);

    // Canonical eager-path firing order — `$onInit` after construct,
    // post-link before `$postLink`. `$onChanges` is intentionally
    // absent (no isolate bindings).
    expect(order).toEqual(['construct', '$onInit', 'postLink', '$postLink']);

    destroyElementScope(node);
    expect(order).toEqual(['construct', '$onInit', 'postLink', '$postLink', '$onDestroy']);
  });
});
