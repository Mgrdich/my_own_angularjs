/**
 * Integration tests for controller lifecycle hooks
 * (spec 022 Slice 3 — FS §2.3 + technical-considerations §2.3).
 *
 * Exercises the four opt-in hooks through `$compile`:
 *
 *   - `$onInit()` — fires once after construction + binding population,
 *     BEFORE the directive's pre-link.
 *   - `$onChanges(changes)` — fires synchronously once at link time
 *     with `isFirstChange() === true`; subsequent `<` / `@` changes
 *     batch into a single per-digest post-digest delivery.
 *   - `$onDestroy()` — fires when the scope receives `$destroy`. A
 *     pending `$onChanges` flush queued before destruction does NOT
 *     fire afterward.
 *   - `$postLink()` — fires after the post-link loop completes for
 *     this element (which is AFTER child linking; the canonical
 *     "inside-out" order — children's `$postLink` first, parent
 *     `$postLink` after).
 *
 * Also covered:
 *
 *   - `=` and `&` bindings DO NOT feed `$onChanges` (one-way only).
 *   - A hookless controller behaves exactly as in Slice 2 (regression).
 *   - Both link paths: inline `template` + async `templateUrl`.
 *   - Hook exceptions route via `$exceptionHandler('$compile')` and
 *     do not crash the linker or stop the `$onChanges` queue from
 *     draining other controllers' batches.
 *
 * **Controller spelling.** Tests use the canonical array-style
 * annotation with a trailing function expression that receives
 * `$scope` and stashes the controller-instance pointer onto
 * `$scope.$$instance` so test bodies can read it back without
 * aliasing `this` at the test layer.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { destroyElementScope } from '@compiler/cleanup';
import type { DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import { UNINITIALIZED_VALUE } from '@compiler/lifecycle';
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
  cb?: (...args: unknown[]) => unknown;
  [k: string]: unknown;
}

/** SimpleChange shape used by the tests. */
interface ChangeShape {
  currentValue: unknown;
  previousValue: unknown;
  isFirstChange(): boolean;
}

/**
 * Build a controller factory whose trailing function stashes `this`
 * onto `$scope.$$instance` for later read-back and applies any extra
 * `setup` (e.g. assigning hook methods on `this`).
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

describe('lifecycle: $onInit', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('fires once, AFTER bindings are populated on the instance, BEFORE pre-link', () => {
    const order: string[] = [];
    let onInitUser: unknown = '<not-set>';
    const ctrl = makeCtrl((inst) => {
      inst.$onInit = function (this: Record<string, unknown>): void {
        order.push('$onInit');
        onInitUser = this.user;
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

    expect(order).toEqual(['$onInit', 'preLink', 'postLink']);
    // `$onInit` saw the populated `<` binding on the instance
    // (synchronous initial seed — see isolate-bindings.ts wireOneWayBinding).
    expect(onInitUser).toEqual({ id: 'u1', name: 'Alice' });
  });

  it('fires for a non-bindToController controller (scope-target / no bindings)', () => {
    const spy = vi.fn();
    const ctrl = makeCtrl((inst) => {
      inst.$onInit = spy;
    });
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          controller: ctrl,
          controllerAs: '$ctrl',
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    const parent = Scope.create<ParentScope>();
    $compile(node)(parent);

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('lifecycle: $onChanges initial synchronous fire', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('fires synchronously at link time with every < and @ binding marked first-change', () => {
    const calls: ChangeShape[][] = [];
    const ctrl = makeCtrl((inst) => {
      inst.$onChanges = function (changes: Record<string, ChangeShape>): void {
        // Snapshot per-call; multiple calls accumulate to verify
        // initial vs. subsequent fires.
        const snap: ChangeShape[] = [];
        for (const key of Object.keys(changes)) {
          const c = changes[key];
          if (c !== undefined) {
            snap.push({
              currentValue: c.currentValue,
              previousValue: c.previousValue,
              isFirstChange: () => c.isFirstChange(),
            });
          }
        }
        calls.push(snap);
      };
    });
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: { user: '<', label: '@' } as Record<string, string>,
          bindToController: true,
          controller: ctrl,
          controllerAs: '$ctrl',
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    node.setAttribute('user', 'pickValue');
    node.setAttribute('label', 'hello');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = { id: 'u1' };
    $compile(node)(parent);

    // ONE synchronous initial fire — both bindings present, both marked first-change.
    expect(calls).toHaveLength(1);
    const initial = calls[0] ?? [];
    expect(initial).toHaveLength(2);
    for (const c of initial) {
      expect(c.isFirstChange()).toBe(true);
      // `previousValue` is the canonical sentinel — consumers
      // shouldn't read it, but it IS the UNINITIALIZED_VALUE singleton.
      expect(c.previousValue).toBe(UNINITIALIZED_VALUE);
    }
  });

  it('initial fire happens AFTER $onInit', () => {
    const order: string[] = [];
    const ctrl = makeCtrl((inst) => {
      inst.$onInit = function (): void {
        order.push('$onInit');
      };
      inst.$onChanges = function (): void {
        order.push('$onChanges');
      };
    });
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: { x: '<' } as Record<string, string>,
          bindToController: true,
          controller: ctrl,
          controllerAs: '$ctrl',
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    node.setAttribute('x', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = 1;
    $compile(node)(parent);

    expect(order).toEqual(['$onInit', '$onChanges']);
  });
});

describe('lifecycle: $onChanges subsequent batched delivery', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('coalesces multiple < / @ binding changes in the same digest into ONE post-digest delivery', () => {
    const calls: Record<string, ChangeShape>[] = [];
    const ctrl = makeCtrl((inst) => {
      inst.$onChanges = function (changes: Record<string, ChangeShape>): void {
        // Capture a shallow copy of each change record.
        const snap: Record<string, ChangeShape> = {};
        for (const key of Object.keys(changes)) {
          const c = changes[key];
          if (c !== undefined) {
            snap[key] = {
              currentValue: c.currentValue,
              previousValue: c.previousValue,
              isFirstChange: () => c.isFirstChange(),
            };
          }
        }
        calls.push(snap);
      };
    });
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: { user: '<', label: '@' } as Record<string, string>,
          bindToController: true,
          controller: ctrl,
          controllerAs: '$ctrl',
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    node.setAttribute('user', 'pickValue');
    node.setAttribute('label', '{{outerName}}');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = { id: 'u1' };
    parent.outerName = 'first';
    $compile(node)(parent);
    // Settle the initial $watch fires (canonical AngularJS first-fire
    // pattern where `newValue === oldValue`). This drains the post-
    // digest queue and seeds the watcher's `last` to the current value
    // so the NEXT mutation triggers a real change record.
    parent.$digest();
    // Reset captured calls — drop the initial synchronous fire.
    calls.length = 0;

    // Mutate BOTH bindings in the same digest cycle.
    parent.pickValue = { id: 'u2' };
    parent.outerName = 'second';
    parent.$digest();

    // ONE delivery — but two binding-name keys inside it.
    expect(calls).toHaveLength(1);
    const batch = calls[0] ?? {};
    expect(Object.keys(batch).sort()).toEqual(['label', 'user']);
    expect(batch.user?.isFirstChange()).toBe(false);
    expect(batch.label?.isFirstChange()).toBe(false);
    expect(batch.user?.currentValue).toEqual({ id: 'u2' });
    expect(batch.user?.previousValue).toEqual({ id: 'u1' });
    expect(batch.label?.currentValue).toBe('second');
    expect(batch.label?.previousValue).toBe('first');
  });
});

describe('lifecycle: $onChanges ignores = and & bindings', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('= binding changes do NOT trigger $onChanges after the initial fire', () => {
    const calls: Record<string, ChangeShape>[] = [];
    const ctrl = makeCtrl((inst) => {
      inst.$onChanges = function (changes: Record<string, ChangeShape>): void {
        const snap: Record<string, ChangeShape> = {};
        for (const key of Object.keys(changes)) {
          const c = changes[key];
          if (c !== undefined) {
            snap[key] = {
              currentValue: c.currentValue,
              previousValue: c.previousValue,
              isFirstChange: () => c.isFirstChange(),
            };
          }
        }
        calls.push(snap);
      };
    });
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: { value: '=', onDone: '&' } as Record<string, string>,
          bindToController: true,
          controller: ctrl,
          controllerAs: '$ctrl',
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    node.setAttribute('value', 'pickValue');
    node.setAttribute('on-done', 'cb()');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = 'one';
    parent.cb = () => undefined;
    $compile(node)(parent);
    parent.$digest();

    // No initial fire — `=` and `&` don't feed $onChanges. No call at all.
    expect(calls).toHaveLength(0);

    // Mutate `=` binding source and re-digest — STILL no $onChanges call.
    parent.pickValue = 'two';
    parent.$digest();
    expect(calls).toHaveLength(0);
  });
});

describe('lifecycle: $onDestroy', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('fires when the controller scope is destroyed (via destroyElementScope)', () => {
    let onDestroyCalled = false;
    let onDestroyThisIsInstance = false;
    let capturedInstance: unknown;
    const ctrl = makeCtrl((inst) => {
      inst.$onDestroy = function (this: unknown): void {
        onDestroyCalled = true;
        onDestroyThisIsInstance = this === capturedInstance;
      };
    });
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: { x: '<' } as Record<string, string>,
          bindToController: true,
          controller: ctrl,
          controllerAs: '$ctrl',
          link: (scope) => {
            capturedInstance = (scope as unknown as { $$instance: unknown }).$$instance;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    node.setAttribute('x', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = 'val';
    $compile(node)(parent);

    expect(onDestroyCalled).toBe(false);
    destroyElementScope(node);
    expect(onDestroyCalled).toBe(true);
    expect(onDestroyThisIsInstance).toBe(true);
  });

  it('cancels a pending $onChanges flush (post-destroy digest does NOT re-fire $onChanges)', () => {
    const onChangesSpy = vi.fn();
    const ctrl = makeCtrl((inst) => {
      inst.$onChanges = onChangesSpy;
    });
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: { x: '<' } as Record<string, string>,
          bindToController: true,
          controller: ctrl,
          controllerAs: '$ctrl',
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    node.setAttribute('x', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = 'initial';
    $compile(node)(parent);
    // Initial fire — one call.
    expect(onChangesSpy).toHaveBeenCalledTimes(1);

    // Mutate WITHOUT calling $digest — the queue records the change.
    parent.pickValue = 'changed';
    // Destroy BEFORE the queue drains.
    destroyElementScope(node);
    // Now run a digest — the post-digest flush would normally fire,
    // but $onDestroy already wiped the per-controller entry.
    parent.$digest();
    // Still only the initial call — no second batched fire.
    expect(onChangesSpy).toHaveBeenCalledTimes(1);
  });
});

describe('lifecycle: $postLink', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('fires AFTER child elements link (inside-out order: child first, parent after)', () => {
    const order: string[] = [];
    const parentCtrl = makeCtrl((inst) => {
      inst.$postLink = function (): void {
        order.push('parent.$postLink');
      };
    });
    const childCtrl = makeCtrl((inst) => {
      inst.$postLink = function (): void {
        order.push('child.$postLink');
      };
    });
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'parentDir',
        ddoFactory({
          controller: parentCtrl,
          controllerAs: '$ctrlP',
          compile: () => ({
            post: () => {
              order.push('parent.postLink');
            },
          }),
        }),
      );
      $cp.directive(
        'childDir',
        ddoFactory({
          controller: childCtrl,
          controllerAs: '$ctrlC',
          compile: () => ({
            post: () => {
              order.push('child.postLink');
            },
          }),
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('parent-dir', '');
    const child = document.createElement('div');
    child.setAttribute('child-dir', '');
    node.appendChild(child);
    const parent = Scope.create<ParentScope>();
    $compile(node)(parent);

    // Each element's $postLink fires AFTER its own post-link AND
    // after all descendants' post-link + $postLink chain.
    expect(order).toEqual(['child.postLink', 'child.$postLink', 'parent.postLink', 'parent.$postLink']);
  });
});

describe('lifecycle: hookless controller (regression — Slice 2 unchanged)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('a controller defining none of the lifecycle hooks behaves like Slice 2', () => {
    let capturedScope: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: { user: '<' } as Record<string, string>,
          bindToController: true,
          controller: makeCtrl(),
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
    // No crashes, no errors, instance populated as in Slice 2.
  });
});

describe('lifecycle: shared-spy ordering across hooks + link phases', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('canonical order: construct, $onInit, $onChanges-initial, preLink, postLink, $postLink, $onDestroy', () => {
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
        inst.$onChanges = function (): void {
          order.push('$onChanges');
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

    expect(order).toEqual(['construct', '$onInit', '$onChanges', 'preLink', 'postLink', '$postLink', '$onDestroy']);
  });
});

describe("lifecycle: hook exceptions route via $exceptionHandler('$compile')", () => {
  it('$onInit throw is routed and does not stop subsequent linking', () => {
    const handlerSpy = vi.fn<(...args: unknown[]) => void>();
    bootstrapNgModule({ exceptionHandler: handlerSpy });
    let postLinkRan = false;
    const ctrl = makeCtrl((inst) => {
      inst.$onInit = function (): void {
        throw new Error('boom in $onInit');
      };
    });
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          controller: ctrl,
          controllerAs: '$ctrl',
          compile: () => ({
            post: () => {
              postLinkRan = true;
            },
          }),
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    const parent = Scope.create<ParentScope>();
    $compile(node)(parent);

    expect(handlerSpy).toHaveBeenCalled();
    const [err, cause] = handlerSpy.mock.calls[0] ?? [];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('boom in $onInit');
    expect(cause).toBe('$compile');
    // Linking continued past the throw.
    expect(postLinkRan).toBe(true);
  });

  it('$onChanges throw does not halt the queue (subsequent fires still deliver)', () => {
    const handlerSpy = vi.fn<(...args: unknown[]) => void>();
    bootstrapNgModule({ exceptionHandler: handlerSpy });
    let secondCallSeen = false;
    let firstCallSeen = false;
    const ctrl = makeCtrl((inst) => {
      inst.$onChanges = function (): void {
        if (!firstCallSeen) {
          firstCallSeen = true;
          throw new Error('boom in $onChanges first');
        }
        secondCallSeen = true;
      };
    });
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: { x: '<' } as Record<string, string>,
          bindToController: true,
          controller: ctrl,
          controllerAs: '$ctrl',
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    node.setAttribute('x', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = 'one';
    $compile(node)(parent);
    // Settle the watcher's first-fire (canonical AngularJS pattern
    // where the first listener delivery sees `newValue === oldValue`).
    parent.$digest();

    // Initial fire threw — handler invoked.
    expect(firstCallSeen).toBe(true);
    expect(handlerSpy).toHaveBeenCalled();
    const causeArgs = handlerSpy.mock.calls.map((c) => c[1]);
    expect(causeArgs).toContain('$compile');

    // Mutate + digest — the batched fire still delivers despite the prior throw.
    parent.pickValue = 'two';
    parent.$digest();
    expect(secondCallSeen).toBe(true);
  });
});

describe('lifecycle: async templateUrl post-install path fires hooks identically', () => {
  it('$onInit, $onChanges-initial, $postLink, $onDestroy all fire through the deferred drain', async () => {
    bootstrapNgModule();
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
        inst.$onChanges = function (): void {
          order.push('$onChanges');
        };
        inst.$onDestroy = function (): void {
          order.push('$onDestroy');
        };
        inst.$postLink = function (): void {
          order.push('$postLink');
        };
      },
    ] as ControllerInvokable;
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp) => {
        $cp.directive(
          'asyncDir',
          ddoFactory({
            scope: { x: '<' } as Record<string, string>,
            bindToController: true,
            controller: ctrl,
            controllerAs: '$ctrl',
            templateUrl: '/tpl/async-lc.html',
          }),
        );
      },
    ]);
    const injector = createInjector([appModule]);
    const $compile = injector.get<ReturnType<typeof compileWith>>('$compile');
    const cache = injector.get<{ put: (k: string, v: string) => void }>('$templateCache');
    cache.put('/tpl/async-lc.html', '<span>inside</span>');

    const node = document.createElement('div');
    node.setAttribute('async-dir', '');
    node.setAttribute('x', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = 'val';

    $compile(node)(parent);
    // Synchronous return — nothing yet beyond enqueue.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toContain('construct');
    expect(order).toContain('$onInit');
    expect(order).toContain('$onChanges');
    expect(order).toContain('$postLink');
    // Order preserved through the async install path.
    expect(order.indexOf('$onInit')).toBeGreaterThan(order.indexOf('construct'));
    expect(order.indexOf('$onChanges')).toBeGreaterThan(order.indexOf('$onInit'));
    expect(order.indexOf('$postLink')).toBeGreaterThan(order.indexOf('$onChanges'));

    destroyElementScope(node);
    expect(order).toContain('$onDestroy');
  });
});
