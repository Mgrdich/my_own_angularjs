/**
 * `$compile` per-element controller-seam tests (spec 020 Slice 4 / FS §2.4).
 *
 * Drives the full compile pipeline via real `createInjector(['ng', app])`
 * + real `$compile` + jsdom `Element`. The compiler's `$get` now depends
 * on `$controller`, so every assertion here also implicitly verifies that
 * the DI wiring (`$controllerProvider` registered BEFORE `$compile` on
 * `ngModule`) didn't introduce a circular dep.
 *
 * Reference patterns:
 * - `src/compiler/__tests__/scope-true.test.ts` for `bootstrapNgModule`
 *   + `compileWith` with a `scope: true` directive (the canonical
 *   pattern this slice extends with `controller` + `controllerAs`).
 * - `src/controller/__tests__/controller-di.test.ts` for the
 *   `$exceptionHandler` spy pattern + the direct-call asymmetry control
 *   (this file covers the *compile-time* path).
 *
 * Sections (mirrors FS §2.4 acceptance criteria):
 * 1. Registered controller fires once per matched element.
 * 2. Inline `controller: function` receives `$scope` / `$element` / `$attrs`.
 * 3. Controller runs BEFORE pre-link AND post-link (single + multi-directive).
 * 4. `controllerAs: 'vm'` exposes the instance on scope (with `scope: true`).
 * 5. Two directives on the same element — independent instances.
 * 6. `controllerAs` without `controller` rejected at registration.
 * 7. Throwing controller routes via `$exceptionHandler('$compile')`.
 * 8. `controller: '<UnregisteredName>'` routes `UnknownControllerError`
 *    via `$exceptionHandler('$compile')` (NOT the direct-call asymmetry).
 * 9. Transclude-host directive's controller receives a callable
 *    `$transclude` in its locals.
 * 10. Inline `controller: function` with `controllerAs: 'vm'` works.
 * 11. Constructor returning an object replaces the prototype-instance.
 * 12. Multi-element directive instantiates one controller per match.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { $CompileProvider } from '@compiler/compile-provider';
import { bootstrapNgModule } from '@compiler/__tests__/test-helpers';
import type {
  Attributes,
  CompileService,
  DirectiveFactory,
  DirectiveFactoryReturn,
  LinkFn,
  TranscludeFn,
} from '@compiler/directive-types';
import {
  ControllerAsWithoutControllerError,
  UnknownControllerError,
} from '@controller/controller-errors';
import type { $ControllerProvider } from '@controller/controller-provider';
import type { ControllerInvokable } from '@controller/controller-types';
import { Scope } from '@core/index';
import { createInjector } from '@di/injector';
import { createModule } from '@di/module';
import type { ExceptionHandler } from '@exception-handler/index';

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

/**
 * Bootstrap helper that exposes BOTH `$compileProvider` AND
 * `$controllerProvider` in a single config block. Returns the resolved
 * `$compile` service + a `$exceptionHandler` spy.
 */
interface Harness {
  $compile: CompileService;
  handler: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
}

function buildHarness(
  configure: (cp: $CompileProvider, ctrl: $ControllerProvider) => void,
  opts?: { exceptionHandler?: ExceptionHandler },
): Harness {
  const handler =
    opts?.exceptionHandler !== undefined
      ? (vi.fn(opts.exceptionHandler) as ReturnType<typeof vi.fn<(...args: unknown[]) => void>>)
      : vi.fn<(...args: unknown[]) => void>();
  bootstrapNgModule({ exceptionHandler: handler });
  const appModule = createModule('app', ['ng']).config([
    '$compileProvider',
    '$controllerProvider',
    (cp: $CompileProvider, ctrl: $ControllerProvider) => {
      configure(cp, ctrl);
    },
  ]);
  const injector = createInjector([appModule]);
  return {
    $compile: injector.get<CompileService>('$compile'),
    handler,
  };
}

describe('controller seam — registered controller fires once per matched element (FS §2.4 #1)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('invokes $controller("MyCtrl", locals) exactly once per match', () => {
    const ctorFn = vi.fn(function (this: object) {
      // Bare constructor — no DI, just track invocations + this-binding.
    });
    // Wrap in array-style annotation. A bare function with no $inject
    // would fail at `injector.invoke` because the project does not parse
    // function source. The DDO field type allows both — array-style is
    // the minification-safe spelling and the canonical form across the
    // existing test suite.
    const ctor = [ctorFn] as const;
    const { $compile } = buildHarness((cp, ctrl) => {
      ctrl.register('MyCtrl', ctor as unknown as ControllerInvokable);
      cp.directive('myDir', ddoFactory({ restrict: 'A', controller: 'MyCtrl' }));
    });

    const node = document.createElement('div');
    node.setAttribute('my-dir', '');

    $compile(node)(Scope.create());

    expect(ctorFn).toHaveBeenCalledTimes(1);
    // Each call should run against an `Object.create(ctor.prototype)`
    // instance, so the `this` value's prototype is the ctor's prototype.
    const thisArg = ctorFn.mock.contexts[0];
    expect(Object.getPrototypeOf(thisArg as object)).toBe(
      (ctorFn as unknown as { prototype: object }).prototype,
    );
  });
});

describe('controller seam — inline controller receives $scope / $element / $attrs (FS §2.4 #2)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('array-style inline controller receives the canonical locals', () => {
    let capturedScope: unknown;
    let capturedElement: unknown;
    let capturedAttrs: unknown;
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');

    const { $compile } = buildHarness((cp) => {
      cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'A',
          controller: [
            '$scope',
            '$element',
            '$attrs',
            function ($scope: unknown, $element: unknown, $attrs: unknown) {
              capturedScope = $scope;
              capturedElement = $element;
              capturedAttrs = $attrs;
            },
          ],
        }),
      );
    });

    const parentScope = Scope.create();
    $compile(node)(parentScope);

    expect(capturedScope).toBe(parentScope);
    expect(capturedElement).toBe(node);
    // `$attrs` is the Attributes instance — it carries `$set` and
    // `$observe` as own properties from the runtime class.
    const attrs = capturedAttrs as Attributes;
    expect(typeof attrs.$set).toBe('function');
    expect(typeof attrs.$observe).toBe('function');
  });

  it('with `scope: true`, $scope is the child scope (not the parent)', () => {
    let capturedScope: Scope | null = null;
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');

    const { $compile } = buildHarness((cp) => {
      cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'A',
          scope: true,
          controller: [
            '$scope',
            function ($scope: unknown) {
              capturedScope = $scope as Scope;
            },
          ],
        }),
      );
    });

    const parentScope = Scope.create();
    $compile(node)(parentScope);

    expect(capturedScope).not.toBeNull();
    expect(capturedScope).not.toBe(parentScope);
    expect(Object.getPrototypeOf(capturedScope)).toBe(parentScope);
  });
});

describe('controller seam — ordering: controller → pre-link → post-link (FS §2.4 #3)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('single directive: controller fires before its own pre AND post link', () => {
    const order: string[] = [];
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');

    const { $compile } = buildHarness((cp) => {
      cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'A',
          controller: [
            function () {
              order.push('controller');
            },
          ] as unknown as ControllerInvokable,
          compile: () => ({
            pre: () => order.push('pre'),
            post: () => order.push('post'),
          }),
        }),
      );
    });

    $compile(node)(Scope.create());

    expect(order).toEqual(['controller', 'pre', 'post']);
  });

  it('two directives: all controllers fire BEFORE any pre-link on the element', () => {
    const order: string[] = [];
    const node = document.createElement('div');
    node.setAttribute('dir-a', '');
    node.setAttribute('dir-b', '');

    const { $compile } = buildHarness((cp) => {
      cp.directive(
        'dirA',
        ddoFactory({
          restrict: 'A',
          priority: 100,
          controller: [
            function () {
              order.push('controller-A');
            },
          ] as unknown as ControllerInvokable,
          compile: () => ({
            pre: () => order.push('pre-A'),
            post: () => order.push('post-A'),
          }),
        }),
      );
      cp.directive(
        'dirB',
        ddoFactory({
          restrict: 'A',
          priority: 50,
          controller: [
            function () {
              order.push('controller-B');
            },
          ] as unknown as ControllerInvokable,
          compile: () => ({
            pre: () => order.push('pre-B'),
            post: () => order.push('post-B'),
          }),
        }),
      );
    });

    $compile(node)(Scope.create());

    // Pre-link runs priority-DESC; post-link runs priority-ASC. Both
    // controllers fire before either pre-link.
    expect(order).toEqual(['controller-A', 'controller-B', 'pre-A', 'pre-B', 'post-B', 'post-A']);
  });
});

describe('controller seam — `controllerAs: "vm"` exposes instance on scope (FS §2.4 #4)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('with scope: true, the child scope gets `vm` (not the parent)', () => {
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');

    const { $compile } = buildHarness((cp) => {
      cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'A',
          scope: true,
          controller: [
            function (this: { value: number }) {
              this.value = 42;
            },
          ] as unknown as ControllerInvokable,
          controllerAs: 'vm',
        }),
      );
    });

    const parentScope = Scope.create();
    $compile(node)(parentScope);

    // Parent scope does NOT have `vm` — alias lives on the child scope.
    expect((parentScope as unknown as Record<string, unknown>).vm).toBeUndefined();

    // The child scope (one prototype-step down from parent) carries `vm`.
    // Walk via the cleanup-registry's stashed scope on the element.
    interface NgManagedElement extends Element {
      $$ngScope?: Scope;
    }
    const childScope = (node as NgManagedElement).$$ngScope;
    expect(childScope).toBeDefined();
    const vm = (childScope as unknown as Record<string, { value: number } | undefined>).vm;
    expect(vm).toBeDefined();
    expect(vm?.value).toBe(42);
  });
});

describe('controller seam — two directives on same element (FS §2.4 #5)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('each controller runs independently; neither sees the other', () => {
    const ctorA = vi.fn();
    const ctorB = vi.fn();
    const node = document.createElement('div');
    node.setAttribute('dir-a', '');
    node.setAttribute('dir-b', '');

    const { $compile } = buildHarness((cp) => {
      cp.directive(
        'dirA',
        ddoFactory({ restrict: 'A', controller: [ctorA] as unknown as ControllerInvokable }),
      );
      cp.directive(
        'dirB',
        ddoFactory({ restrict: 'A', controller: [ctorB] as unknown as ControllerInvokable }),
      );
    });

    $compile(node)(Scope.create());

    expect(ctorA).toHaveBeenCalledTimes(1);
    expect(ctorB).toHaveBeenCalledTimes(1);
    // Independent `this` instances — the two controllers' constructed
    // prototype-instances are not the same object.
    expect(ctorA.mock.contexts[0]).not.toBe(ctorB.mock.contexts[0]);
  });
});

describe('controller seam — `controllerAs` without `controller` rejected at registration (FS §2.4 #6)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('routes ControllerAsWithoutControllerError via $exceptionHandler("$compile")', () => {
    // Registration validation happens lazily inside the
    // `<name>Directive` provider's `$get` — first triggered by compile
    // touching a matching element. We register the bad directive then
    // compile a matching node to drive the resolution.
    const { $compile, handler } = buildHarness((cp) => {
      cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'A',
          controllerAs: 'vm',
        } as unknown as DirectiveFactoryReturn),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    $compile(node)(Scope.create());

    // The factory threw inside `$$buildDirectiveArrayProvider`, which
    // routes the error via `$exceptionHandler('$compile')` and treats
    // the directive as if it returned `undefined`.
    expect(handler).toHaveBeenCalled();
    const call = handler.mock.calls.find(([err]) => err instanceof ControllerAsWithoutControllerError);
    expect(call).toBeDefined();
    expect(call?.[1]).toBe('$compile');
    expect((call?.[0] as Error).name).toBe('ControllerAsWithoutControllerError');
  });
});

describe('controller seam — throwing controller routes via $exceptionHandler("$compile") (FS §2.4 / §2.5 acceptance #4)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('controller throw is caught; pre-link and post-link still run; siblings unaffected', () => {
    const preLink = vi.fn();
    const postLink = vi.fn();
    const siblingCtor = vi.fn();

    const node = document.createElement('div');
    const target = document.createElement('span');
    target.setAttribute('my-dir', '');
    const sibling = document.createElement('span');
    sibling.setAttribute('sibling-dir', '');
    node.appendChild(target);
    node.appendChild(sibling);

    const { $compile, handler } = buildHarness((cp) => {
      cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'A',
          controller: [
            function () {
              throw new Error('controller boom');
            },
          ] as unknown as ControllerInvokable,
          compile: () => ({ pre: preLink, post: postLink }),
        }),
      );
      cp.directive(
        'siblingDir',
        ddoFactory({
          restrict: 'A',
          controller: [siblingCtor] as unknown as ControllerInvokable,
        }),
      );
    });

    $compile(node)(Scope.create());

    expect(handler).toHaveBeenCalled();
    const call = handler.mock.calls.find(([err]) => err instanceof Error && err.message === 'controller boom');
    expect(call).toBeDefined();
    expect(call?.[1]).toBe('$compile');

    expect(preLink).toHaveBeenCalledTimes(1);
    expect(postLink).toHaveBeenCalledTimes(1);
    expect(siblingCtor).toHaveBeenCalledTimes(1);
  });
});

describe('controller seam — compile-time UnknownControllerError routes via $exceptionHandler (asymmetry with direct-call path)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('unregistered controller name routes UnknownControllerError via "$compile" cause', () => {
    // FS §2.5: direct $controller(name, …) propagates the error; the
    // compile-time path routes via $exceptionHandler('$compile'). This
    // asserts the compile-time half of the asymmetry; the direct-call
    // half is covered in controller-di.test.ts.
    const { $compile, handler } = buildHarness((cp) => {
      cp.directive('myDir', ddoFactory({ restrict: 'A', controller: 'NotRegistered' }));
    });
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');

    $compile(node)(Scope.create());

    expect(handler).toHaveBeenCalled();
    const call = handler.mock.calls.find(([err]) => err instanceof UnknownControllerError);
    expect(call).toBeDefined();
    expect(call?.[1]).toBe('$compile');
    expect((call?.[0] as Error).message).toBe('Unknown controller: NotRegistered');
  });
});

describe('controller seam — transclude-host directive: $transclude in locals (FS §2.4 / spec 018 integration)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('the controller receives a callable $transclude function', () => {
    let captured: TranscludeFn | undefined;
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    const child = document.createElement('p');
    node.appendChild(child);

    const { $compile } = buildHarness((cp) => {
      cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'A',
          transclude: true,
          controller: [
            '$scope',
            '$transclude',
            function ($scope: unknown, $transclude: unknown) {
              captured = $transclude as TranscludeFn;
              void $scope;
            },
          ],
        }),
      );
    });

    $compile(node)(Scope.create());

    expect(typeof captured).toBe('function');
  });
});

describe('controller seam — inline controller with `controllerAs: "vm"` (FS §2.4 #2 + #4)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('alias from DDO field exposes inline instance on scope', () => {
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');

    const { $compile } = buildHarness((cp) => {
      cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'A',
          controller: [
            function (this: { msg: string }) {
              this.msg = 'hi';
            },
          ] as unknown as ControllerInvokable,
          controllerAs: 'vm',
        }),
      );
    });

    const scope = Scope.create();
    $compile(node)(scope);

    const vm = (scope as unknown as Record<string, { msg: string } | undefined>).vm;
    expect(vm).toBeDefined();
    expect(vm?.msg).toBe('hi');
  });
});

describe('controller seam — constructor returning an object replaces the prototype-instance (FS §2.4 / AngularJS-canonical)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('scope[alias] is the returned object, not an instanceof of the constructor', () => {
    const replacement = { explicit: true } as const;
    function Ctor(this: object): { explicit: true } {
      return replacement;
    }
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');

    const { $compile } = buildHarness((cp) => {
      cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'A',
          controller: [Ctor] as unknown as ControllerInvokable,
          controllerAs: 'vm',
        }),
      );
    });

    const scope = Scope.create();
    $compile(node)(scope);

    const vm = (scope as unknown as Record<string, unknown>).vm;
    expect(vm).toBe(replacement);
    // The returned object's prototype is NOT the constructor's prototype.
    expect(Object.getPrototypeOf(vm as object)).not.toBe(
      (Ctor as unknown as { prototype: object }).prototype,
    );
  });
});

describe('controller seam — multi-element directive yields distinct instances per match', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('three sibling matches → three distinct constructor invocations', () => {
    const ctor = vi.fn();
    const root = document.createElement('div');
    for (let i = 0; i < 3; i++) {
      const span = document.createElement('span');
      span.className = 'my-dir';
      root.appendChild(span);
    }

    const { $compile } = buildHarness((cp) => {
      cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'C',
          controller: [ctor] as unknown as ControllerInvokable,
        }),
      );
    });

    $compile(root)(Scope.create());

    expect(ctor).toHaveBeenCalledTimes(3);
    // Three distinct `this` bindings — the constructor ran against a
    // fresh prototype-instance for each match.
    const thisArgs = ctor.mock.contexts;
    expect(thisArgs[0]).not.toBe(thisArgs[1]);
    expect(thisArgs[1]).not.toBe(thisArgs[2]);
    expect(thisArgs[0]).not.toBe(thisArgs[2]);
  });
});

describe('controller seam — LinkFn signature receives the bound scope (regression for older spec-017 directives)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('a directive without `controller` still links normally — no controller seam invocation', () => {
    // Regression — pre-Slice-4 directives MUST keep working. The seam
    // is conditional on `directive.controller !== undefined`, so a
    // directive that doesn't declare one walks the link path unchanged.
    const link = vi.fn<LinkFn>();
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');

    const { $compile } = buildHarness((cp) => {
      cp.directive('myDir', ddoFactory({ restrict: 'A', link }));
    });

    $compile(node)(Scope.create());

    expect(link).toHaveBeenCalledTimes(1);
  });
});
