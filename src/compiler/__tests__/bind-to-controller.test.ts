/**
 * Integration tests for `bindToController` (spec 022 Slice 2 —
 * FS §2.2 + technical-considerations §2.2 / §2.4).
 *
 * `bindToController` redirects isolate-scope binding wiring from the
 * scope to the controller instance. Two accepted shapes:
 *
 *  - `bindToController: true` re-uses the binding map declared via
 *    `scope: { … }`. The isolate scope is still created from the
 *    `scope` declaration; bindings target the controller instance.
 *  - `bindToController: { … }` declares its own binding map. The
 *    directive does NOT create an isolate scope on its own — a
 *    `bindToController`-only directive consumes whatever scope is
 *    already on the element. This asymmetry (form 1 creates the
 *    isolate scope; form 2 does not) is the deliberate AngularJS-
 *    canonical behavior so that two directives sharing an element —
 *    one with `scope: { … }`, the other with `bindToController: { … }`
 *    — do NOT trigger `MultipleIsolateScopeError`.
 *
 * Test surface:
 *
 *  - Form 1 (`bindToController: true` + `scope: { … }`): bindings on
 *    the instance, `controllerAs` alias on the isolate scope.
 *  - Form 2 (`bindToController: { … }`, no `scope`): bindings on the
 *    instance, `controllerAs` alias on the existing scope.
 *  - Bindings present at post-link time (verified via the post-link
 *    reading the published alias on scope).
 *  - `bindToController: false` (or omitted) preserves the spec-022
 *    Slice-1 scope-target path — regression guard.
 *  - `bindToController: { … }` with NO controller silently degrades to
 *    the scope-target.
 *  - Malformed `bindToController: { … }` routes
 *    `InvalidIsolateBindingError` via `$exceptionHandler('$compile')`
 *    (reused with the spec-022 Slice 1 error class — no new error).
 *  - Both link paths exercised: inline `template` + async `templateUrl`.
 *  - `MultipleIsolateScopeError` does NOT fire when one directive
 *    declares `scope: { … }` and another (on the same element)
 *    declares `bindToController: { … }`.
 *
 * **Controller spelling.** Test controllers use the canonical
 * array-style annotation with a trailing function expression that
 * receives `$scope` and writes the controller-instance pointer onto
 * `$scope.$$instance` (a private slot). This avoids the
 * `no-this-alias` lint while still exercising the
 * `Object.create(prototype) + injector.invoke + return-value
 * replacement` instantiation path — the trailing function's `this` IS
 * the prototype-instance the compiler will treat as the controller.
 * Tests then read the instance back via `scope.$$instance` (or the
 * published `controllerAs` alias).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InvalidIsolateBindingError, MultipleIsolateScopeError } from '@compiler/compile-error';
import type { DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import type { ControllerInvokable } from '@controller/controller-types';
import { createInjector } from '@di/injector';
import { createModule } from '@di/module';
import { Scope } from '@core/index';

import { bootstrapNgModule, compileWith } from './test-helpers';

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

interface ParentScope {
  outerName?: string;
  pickValue?: unknown;
  user?: { id?: string; name?: string };
  [k: string]: unknown;
}

/**
 * Build an array-style controller annotation that stashes the
 * controller-instance pointer (`this`) onto `scope.$$instance`. The
 * trailing function is what the compiler's
 * `Object.create(prototype) + invoke` pipeline will treat as the
 * controller; its `this` IS the prototype-instance returned (per
 * spec 020). We do the stash inline to avoid aliasing `this` in
 * test-level code (the lint rule `no-this-alias` would flag a
 * `const self = this;` pattern in tests; the controller body itself
 * is genuine controller code where `this` is the canonical AngularJS
 * surface).
 */
function makeCapturingController(): ControllerInvokable {
  return [
    '$scope',
    function (this: unknown, $scope: unknown): void {
      ($scope as { $$instance: unknown }).$$instance = this;
    },
  ] as ControllerInvokable;
}

describe('bindToController — form 1 (true + scope: { … })', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('places bindings on the controller instance, NOT on the isolate scope', () => {
    let capturedScope: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: { user: '<' } as Record<string, string>,
          bindToController: true,
          controller: makeCapturingController(),
          controllerAs: '$ctrl',
          link: (scope) => {
            capturedScope = scope;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    node.setAttribute('user', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = { id: 'u1', name: 'Alice' };
    $compile(node)(parent);
    parent.$digest();

    const capturedInstance = (capturedScope as unknown as { $$instance?: unknown }).$$instance;
    expect(capturedInstance).toBeDefined();
    expect((capturedInstance as { user?: unknown }).user).toEqual({ id: 'u1', name: 'Alice' });
    // Binding did NOT land on the scope itself.
    expect((capturedScope as unknown as { user?: unknown }).user).toBeUndefined();
    // controllerAs alias IS on the scope, pointing at the populated instance.
    expect((capturedScope as unknown as { $ctrl?: unknown }).$ctrl).toBe(capturedInstance);
  });

  it('@ binding seeds synchronously onto the instance (visible at post-link time)', () => {
    // The `@` binding seeds synchronously from the raw attribute value
    // before any watcher fires (see `wireAtBinding` in isolate-bindings.ts).
    // This is the most directly observable proof that bindings flow
    // onto the instance BEFORE post-link runs — `<` and `=` bindings
    // are populated on the first digest tick (matches AngularJS), so
    // observing them at post-link before $digest requires the `@` form.
    let postLinkTitle: unknown = '<not-set>';
    let postLinkCtrlVisibleOnScope = false;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: { title: '@' } as Record<string, string>,
          bindToController: true,
          controller: makeCapturingController(),
          controllerAs: '$ctrl',
          link: (scope) => {
            const ctrl = (scope as unknown as { $ctrl?: { title?: unknown } }).$ctrl;
            postLinkTitle = ctrl?.title;
            postLinkCtrlVisibleOnScope = ctrl !== undefined;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    node.setAttribute('title', 'Hello');
    const parent = Scope.create<ParentScope>();
    $compile(node)(parent);

    // The instance is published on scope as `$ctrl` AFTER bindings have
    // populated AND before post-link — both visible here.
    expect(postLinkCtrlVisibleOnScope).toBe(true);
    expect(postLinkTitle).toBe('Hello');
  });

  it('< binding populates on the controller instance after the first digest', () => {
    let capturedScope: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: { user: '<' } as Record<string, string>,
          bindToController: true,
          controller: makeCapturingController(),
          controllerAs: '$ctrl',
          link: (scope) => {
            capturedScope = scope;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    node.setAttribute('user', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = { id: 'u1' };
    $compile(node)(parent);
    parent.$digest();

    const ctrl = (capturedScope as unknown as { $ctrl?: { user?: unknown } }).$ctrl;
    expect(ctrl?.user).toEqual({ id: 'u1' });
  });
});

describe('bindToController — form 2 ({ … } object form, no scope)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('places bindings on the controller instance with NO scope: declaration', () => {
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          bindToController: { user: '<' } as Record<string, string>,
          controller: makeCapturingController(),
          controllerAs: '$ctrl',
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    node.setAttribute('user', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = { id: 'u2' };
    $compile(node)(parent);
    parent.$digest();

    const capturedInstance = (parent as unknown as { $$instance?: unknown }).$$instance;
    expect(capturedInstance).toBeDefined();
    expect((capturedInstance as { user?: unknown }).user).toEqual({ id: 'u2' });
    // controllerAs alias landed on the parent scope (form 2 doesn't create an isolate).
    expect(parent.$ctrl).toBe(capturedInstance);
  });
});

describe('bindToController — { … } with no controller silently degrades', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('lands the bindings on the existing scope (the parent in this single-directive case)', () => {
    let capturedScope: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          bindToController: { user: '<' } as Record<string, string>,
          link: (scope) => {
            capturedScope = scope;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    node.setAttribute('user', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = { id: 'u3' };
    $compile(node)(parent);
    parent.$digest();

    expect(capturedScope).not.toBeNull();
    expect((capturedScope as unknown as { user?: unknown }).user).toEqual({ id: 'u3' });
    // No instance was constructed (no controller), so no $ctrl alias.
    expect((capturedScope as unknown as { $ctrl?: unknown }).$ctrl).toBeUndefined();
  });
});

describe('bindToController — false (regression: spec 022 Slice 1 path)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('bindings on the isolate scope; controller exists; controllerAs on scope', () => {
    let capturedScope: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: { user: '<' } as Record<string, string>,
          // bindToController: false — explicit
          bindToController: false,
          controller: makeCapturingController(),
          controllerAs: '$ctrl',
          link: (scope) => {
            capturedScope = scope;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    node.setAttribute('user', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = { id: 'reg' };
    $compile(node)(parent);
    parent.$digest();

    const capturedInstance = (capturedScope as unknown as { $$instance?: unknown }).$$instance;
    expect(capturedScope).not.toBeNull();
    // With bindToController: false, the binding lands on the SCOPE.
    expect((capturedScope as unknown as { user?: unknown }).user).toEqual({ id: 'reg' });
    // The controller instance has NO `user` property — bindings did not flow onto it.
    expect((capturedInstance as { user?: unknown }).user).toBeUndefined();
    // controllerAs alias on scope.
    expect((capturedScope as unknown as { $ctrl?: unknown }).$ctrl).toBe(capturedInstance);
  });
});

describe('bindToController — malformed object form rejects at registration', () => {
  it('routes InvalidIsolateBindingError via $exceptionHandler("$compile") at provider $get time', () => {
    const handlerSpy = vi.fn<(...args: unknown[]) => void>();
    bootstrapNgModule({ exceptionHandler: handlerSpy });
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp) => {
        $cp.directive(
          'badDir',
          ddoFactory({
            bindToController: { user: 'nope' } as Record<string, string>,
            controller: makeCapturingController(),
          }),
        );
      },
    ]);
    const injector = createInjector([appModule]);
    const result = injector.get<unknown[]>('badDirDirective');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
    expect(handlerSpy).toHaveBeenCalled();
    const [err, cause] = handlerSpy.mock.calls[0] ?? [];
    expect(err).toBeInstanceOf(InvalidIsolateBindingError);
    expect(cause).toBe('$compile');
  });
});

describe('bindToController — no conflict with sibling scope: directive', () => {
  it('does NOT route MultipleIsolateScopeError when A: scope { x } and B: bindToController { y } share an element', () => {
    const handlerSpy = vi.fn<(...args: unknown[]) => void>();
    bootstrapNgModule({ exceptionHandler: handlerSpy });
    let capturedScope: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'dirA',
        ddoFactory({
          scope: { x: '<' } as Record<string, string>,
          link: (scope) => {
            capturedScope = scope;
          },
        }),
      );
      $cp.directive(
        'dirB',
        ddoFactory({
          bindToController: { y: '<' } as Record<string, string>,
          controller: [
            '$scope',
            function (this: unknown, $scope: unknown): void {
              ($scope as { $$instanceB: unknown }).$$instanceB = this;
            },
          ] as ControllerInvokable,
          controllerAs: '$ctrlB',
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('dir-a', '');
    node.setAttribute('dir-b', '');
    node.setAttribute('x', 'pickValue');
    node.setAttribute('y', 'outerName');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = 'X-val';
    parent.outerName = 'Y-val';
    expect(() => $compile(node)(parent)).not.toThrow();
    parent.$digest();

    // No MultipleIsolateScopeError routed.
    const isolateConflictCalls = handlerSpy.mock.calls.filter(([err]) => err instanceof MultipleIsolateScopeError);
    expect(isolateConflictCalls).toHaveLength(0);

    // Directive A's binding lands on the isolate scope it created.
    expect(capturedScope).not.toBeNull();
    expect((capturedScope as unknown as { x?: unknown }).x).toBe('X-val');

    // Directive B's binding lands on its controller instance, alias on
    // the same isolate scope (since dirA created it).
    const capturedInstanceB = (capturedScope as unknown as { $$instanceB?: unknown }).$$instanceB;
    expect((capturedInstanceB as { y?: unknown }).y).toBe('Y-val');
    expect((capturedScope as unknown as { $ctrlB?: unknown }).$ctrlB).toBe(capturedInstanceB);
  });
});

describe('bindToController — async templateUrl post-install link path', () => {
  it('bindToController: true bindings land on the instance after the async template installs', async () => {
    bootstrapNgModule();
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp) => {
        $cp.directive(
          'asyncIso',
          ddoFactory({
            scope: { item: '<' } as Record<string, string>,
            bindToController: true,
            controller: makeCapturingController(),
            controllerAs: '$ctrl',
            templateUrl: '/tpl/iso.html',
          }),
        );
      },
    ]);
    const injector = createInjector([appModule]);
    const $compile = injector.get<ReturnType<typeof compileWith>>('$compile');
    const cache = injector.get<{ put: (k: string, v: string) => void }>('$templateCache');
    cache.put('/tpl/iso.html', '<span>inside</span>');

    const node = document.createElement('div');
    node.setAttribute('async-iso', '');
    node.setAttribute('item', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = 'tplie';

    $compile(node)(parent);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    parent.$digest();

    // The host element's isolate scope carries `$ctrl` + `$$instance`.
    // Walk down through the host element's $$ngScope stash.
    const elementScope = (node as unknown as { $$ngScope?: Scope }).$$ngScope;
    expect(elementScope).toBeDefined();
    const capturedInstance = (elementScope as unknown as { $$instance?: unknown }).$$instance;
    expect(capturedInstance).toBeDefined();
    expect((capturedInstance as { item?: unknown }).item).toBe('tplie');
    expect(node.innerHTML).toContain('inside');
  });

  it('bindToController: { item: "<" } (form 2) over async templateUrl', async () => {
    bootstrapNgModule();
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp) => {
        $cp.directive(
          'asyncIso',
          ddoFactory({
            bindToController: { item: '<' } as Record<string, string>,
            controller: makeCapturingController(),
            controllerAs: '$ctrl',
            templateUrl: '/tpl/iso2.html',
          }),
        );
      },
    ]);
    const injector = createInjector([appModule]);
    const $compile = injector.get<ReturnType<typeof compileWith>>('$compile');
    const cache = injector.get<{ put: (k: string, v: string) => void }>('$templateCache');
    cache.put('/tpl/iso2.html', '<span>inside-form2</span>');

    const node = document.createElement('div');
    node.setAttribute('async-iso', '');
    node.setAttribute('item', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = 'form2-val';

    $compile(node)(parent);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    parent.$digest();

    // Form 2 doesn't create an isolate scope; the controller instance
    // is stashed on whatever scope the element uses — here the parent.
    const capturedInstance = (parent as unknown as { $$instance?: unknown }).$$instance;
    expect(capturedInstance).toBeDefined();
    expect((capturedInstance as { item?: unknown }).item).toBe('form2-val');
    expect(node.innerHTML).toContain('inside-form2');
  });
});
