/**
 * `AttributesImpl.$observe` — lazy interpolation watch wiring +
 * deregistration semantics + `$set` notification path. Slice 9 of
 * spec 017, FS §2.11 acceptance criteria.
 *
 * The link path is exercised end-to-end: a directive registered via
 * `$compileProvider.directive` calls `attrs.$observe(name, fn)` from
 * its post-link, the per-element `nodeLinker` has already routed
 * `bindAttrsToScope(attrs, scope, $interpolate)` through
 * `compile.ts`, and the digest fires the observer either initially
 * (static attribute, ONE `$evalAsync`) or via the lazy `$watch`
 * (interpolated attribute).
 *
 * One test exercises `$observe` outside any link/scope context to
 * lock the FS §2.11 acceptance criterion that registration is a no-op
 * for the watch wiring when there's no scope to install on; the
 * observer still fires synchronously when `$set` is later called
 * explicitly (the existing Slice-8 notification path).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AttributesImpl } from '@compiler/attributes';
import { $CompileProvider } from '@compiler/compile-provider';
import type { Attributes, CompileService, DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';

function bootstrapNgModule(): void {
  resetRegistry();
  createModule('ng', [])
    .factory('$exceptionHandler', [() => () => undefined])
    .provider('$sceDelegate', $SceDelegateProvider)
    .provider('$sce', $SceProvider)
    .provider('$interpolate', $InterpolateProvider)
    .provider('$filter', ['$provide', $FilterProvider])
    .provider('$compile', ['$provide', $CompileProvider]);
}

function compileWith(
  register: ($cp: $CompileProvider) => void,
  exceptionHandler?: (...args: unknown[]) => void,
): { $compile: CompileService; scope: Scope } {
  const baseModule = createModule('app', ['ng']);
  // Branching avoids re-assigning `appModule` across two different
  // typed-registry generic shapes (TypedModule's registry is invariant).
  const appModule =
    exceptionHandler !== undefined
      ? baseModule.factory('$exceptionHandler', [() => exceptionHandler]).config([
          '$compileProvider',
          ($cp: $CompileProvider) => {
            register($cp);
          },
        ])
      : baseModule.config([
          '$compileProvider',
          ($cp: $CompileProvider) => {
            register($cp);
          },
        ]);
  const injector = createInjector([appModule]);
  return { $compile: injector.get('$compile'), scope: Scope.create() };
}

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

describe('AttributesImpl.$observe — Slice 9 (FS §2.11)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('observer on a STATIC attribute fires ONCE in the next digest with the current value', () => {
    const observer = vi.fn<(value: string | undefined) => void>();
    let capturedAttrs: Attributes | undefined;
    const { $compile, scope } = compileWith(($cp) => {
      $cp.directive(
        'myAttr',
        ddoFactory({
          link: (_scope, _el, attrs) => {
            capturedAttrs = attrs;
            attrs.$observe('myAttr', observer);
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('my-attr', 'static-value');
    $compile(node)(scope);

    // Before the digest the $evalAsync hasn't flushed yet.
    expect(observer).not.toHaveBeenCalled();

    scope.$digest();

    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledWith('static-value');
    // Attribute remained static — a second digest should NOT re-fire.
    scope.$digest();
    expect(observer).toHaveBeenCalledTimes(1);
    expect(capturedAttrs).toBeDefined();
  });

  it('observer on an INTERPOLATED attribute fires initially with the resolved value after the first digest', () => {
    const observer = vi.fn<(value: string | undefined) => void>();
    const { $compile, scope } = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          link: (_scope, _el, attrs) => {
            attrs.$observe('href', observer);
          },
        }),
      );
    });

    (scope as unknown as { userId: number }).userId = 42;

    const node = document.createElement('a');
    node.setAttribute('my-dir', '');
    node.setAttribute('href', '/users/{{userId}}');
    $compile(node)(scope);

    scope.$digest();

    expect(observer).toHaveBeenCalledWith('/users/42');
  });

  it('observer on an INTERPOLATED attribute fires AGAIN when the underlying expression changes', () => {
    const observer = vi.fn<(value: string | undefined) => void>();
    const { $compile, scope } = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          link: (_scope, _el, attrs) => {
            attrs.$observe('href', observer);
          },
        }),
      );
    });

    (scope as unknown as { userId: number }).userId = 42;

    const node = document.createElement('a');
    node.setAttribute('my-dir', '');
    node.setAttribute('href', '/users/{{userId}}');
    $compile(node)(scope);

    scope.$digest();
    expect(observer).toHaveBeenLastCalledWith('/users/42');

    (scope as unknown as { userId: number }).userId = 99;
    scope.$digest();
    expect(observer).toHaveBeenLastCalledWith('/users/99');
  });

  it('the deregistration closure removes the observer (no further notifications)', () => {
    const observer = vi.fn<(value: string | undefined) => void>();
    let dereg: (() => void) | undefined;
    const { $compile, scope } = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          link: (_scope, _el, attrs) => {
            dereg = attrs.$observe('href', observer);
          },
        }),
      );
    });

    (scope as unknown as { userId: number }).userId = 1;

    const node = document.createElement('a');
    node.setAttribute('my-dir', '');
    node.setAttribute('href', '/u/{{userId}}');
    $compile(node)(scope);

    scope.$digest();
    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenLastCalledWith('/u/1');

    dereg?.();
    (scope as unknown as { userId: number }).userId = 2;
    scope.$digest();

    // Still 1 — the deregistered observer didn't fire for /u/2.
    expect(observer).toHaveBeenCalledTimes(1);
  });

  it('multiple observers on the same INTERPOLATED attribute all fire on the same watch', () => {
    const fnA = vi.fn<(value: string | undefined) => void>();
    const fnB = vi.fn<(value: string | undefined) => void>();
    const fnC = vi.fn<(value: string | undefined) => void>();
    const { $compile, scope } = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          link: (_scope, _el, attrs) => {
            attrs.$observe('href', fnA);
            attrs.$observe('href', fnB);
            attrs.$observe('href', fnC);
          },
        }),
      );
    });

    (scope as unknown as { userId: number }).userId = 7;

    const node = document.createElement('a');
    node.setAttribute('my-dir', '');
    node.setAttribute('href', '/u/{{userId}}');
    $compile(node)(scope);

    scope.$digest();

    expect(fnA).toHaveBeenCalledWith('/u/7');
    expect(fnB).toHaveBeenCalledWith('/u/7');
    expect(fnC).toHaveBeenCalledWith('/u/7');
  });

  it('observer added AFTER the watch is installed reuses the same watch (no duplicate watch)', () => {
    const fnA = vi.fn<(value: string | undefined) => void>();
    const fnB = vi.fn<(value: string | undefined) => void>();
    let capturedAttrs: Attributes | undefined;
    const { $compile, scope } = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          link: (_scope, _el, attrs) => {
            capturedAttrs = attrs;
            attrs.$observe('href', fnA);
          },
        }),
      );
    });

    (scope as unknown as { userId: number }).userId = 1;

    const node = document.createElement('a');
    node.setAttribute('my-dir', '');
    node.setAttribute('href', '/u/{{userId}}');
    $compile(node)(scope);

    scope.$digest();
    const watchersAfterFirst = scope.$$watchers?.length ?? 0;
    expect(fnA).toHaveBeenCalledWith('/u/1');

    // Register a second observer AFTER the watch is already in place.
    expect(capturedAttrs).toBeDefined();
    capturedAttrs?.$observe('href', fnB);

    const watchersAfterSecond = scope.$$watchers?.length ?? 0;
    // Locking the contract: registering fnB does NOT add a second
    // $watch — the lazy-watch path runs exactly once per attribute.
    expect(watchersAfterSecond).toBe(watchersAfterFirst);

    // Mutate and digest — fnB should fire via the existing watch
    // (whose listener calls $set, which iterates $$observers).
    (scope as unknown as { userId: number }).userId = 2;
    scope.$digest();
    expect(fnA).toHaveBeenLastCalledWith('/u/2');
    expect(fnB).toHaveBeenLastCalledWith('/u/2');
  });

  it('explicit $set notifies all current observers (sync outside digest, deferred inside)', () => {
    const fnA = vi.fn<(value: string | undefined) => void>();
    const fnB = vi.fn<(value: string | undefined) => void>();
    let capturedAttrs: Attributes | undefined;
    const { $compile, scope } = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          link: (_scope, _el, attrs) => {
            capturedAttrs = attrs;
            attrs.$observe('myDir', fnA);
            attrs.$observe('myDir', fnB);
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('my-dir', 'initial');
    $compile(node)(scope);

    scope.$digest();
    // Both observers have fired ONCE with the initial static value.
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnA).toHaveBeenLastCalledWith('initial');
    expect(fnB).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenLastCalledWith('initial');

    // Outside-digest $set fires synchronously.
    expect(capturedAttrs).toBeDefined();
    capturedAttrs?.$set('myDir', 'sync-value');
    expect(fnA).toHaveBeenLastCalledWith('sync-value');
    expect(fnB).toHaveBeenLastCalledWith('sync-value');
    expect(fnA).toHaveBeenCalledTimes(2);
    expect(fnB).toHaveBeenCalledTimes(2);

    // Inside-digest $set defers via $evalAsync.
    let callsDuringApply = -1;
    scope.$apply(() => {
      capturedAttrs?.$set('myDir', 'async-value');
      callsDuringApply = fnA.mock.calls.length;
    });
    expect(callsDuringApply).toBe(2); // hadn't fired yet during the synchronous portion
    expect(fnA).toHaveBeenLastCalledWith('async-value');
    expect(fnB).toHaveBeenLastCalledWith('async-value');
  });

  it('observer exceptions are routed through $exceptionHandler with cause $compile; subsequent observers still run', () => {
    // Slice 11 wraps each observer's `fn(value)` call in try/catch
    // routing through `invokeExceptionHandler(handler, err, '$compile')`.
    // FS §2.11 contract: "Observer exceptions are routed through
    // $exceptionHandler('$compile'); other observers for the same
    // attribute still run." The Slice 9 deviation note documented the
    // bubble-up workaround; this slice replaces it with the canonical
    // contract.
    const handlerSpy = vi.fn<(...args: unknown[]) => void>();
    const fnA = vi.fn<(value: string | undefined) => void>(() => {
      throw new Error('boom');
    });
    const fnB = vi.fn<(value: string | undefined) => void>();
    let capturedAttrs: Attributes | undefined;
    const { $compile, scope } = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          link: (_scope, _el, attrs) => {
            capturedAttrs = attrs;
          },
        }),
      );
    }, handlerSpy);

    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    $compile(node)(scope);

    expect(capturedAttrs).toBeDefined();
    const deregA = capturedAttrs?.$observe('myDir', fnA);
    capturedAttrs?.$observe('myDir', fnB);

    // $set called outside a digest fires observers synchronously.
    // fnA throws — the throw is caught by Slice 11's wrapping and
    // routed via $exceptionHandler; fnB STILL fires with the value.
    expect(() => capturedAttrs?.$set('myDir', 'x')).not.toThrow();
    expect(fnA).toHaveBeenCalledWith('x');
    expect(fnB).toHaveBeenCalledWith('x');
    expect(handlerSpy).toHaveBeenCalled();
    const lastCall = handlerSpy.mock.calls[handlerSpy.mock.calls.length - 1] ?? [];
    expect((lastCall[0] as Error).message).toBe('boom');
    expect(lastCall[1]).toBe('$compile');

    // Deregister fnA — the observer list now contains only fnB.
    deregA?.();
    capturedAttrs?.$set('myDir', 'y');
    expect(fnB).toHaveBeenCalledWith('y');
  });

  it('$observe outside any link/scope context is a no-op for the watch wiring (no scope to install on)', () => {
    const el = document.createElement('div');
    el.setAttribute('my-attr', 'standalone');
    const attrs = new AttributesImpl(el);

    const observer = vi.fn<(value: string | undefined) => void>();
    // No `bindAttrsToScope` call has happened — `$$scope` and
    // `$$interpolate` are both `undefined`. The observer is appended
    // to `$$observers` but no $watch is installed and no $evalAsync
    // is scheduled (there's no scope to schedule on).
    const dereg = attrs.$observe('myAttr', observer);
    expect(observer).not.toHaveBeenCalled();

    // A subsequent explicit $set still notifies synchronously via the
    // Slice-8 notification path — observers stored in $$observers are
    // independent of the lazy-watch wiring.
    attrs.$set('myAttr', 'new');
    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledWith('new');

    // The deregistration closure still works.
    dereg();
    attrs.$set('myAttr', 'after-dereg');
    expect(observer).toHaveBeenCalledTimes(1);
  });
});
