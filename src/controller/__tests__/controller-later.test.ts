/**
 * Tests for the deferred-alias call shape `$controller(name, locals, ident, true)`
 * (spec 022 Slice 2 — technical-considerations §2.4).
 *
 * The `later: true` argument extends the spec 020 `$controller` signature
 * with an opt-in "build the instance but don't publish the alias yet"
 * call shape. The deferred-alias return value is `{ instance, identifier }`;
 * the caller is responsible for assigning `scope[identifier] = instance`
 * after it has populated the controller's `bindToController` bindings
 * (and, in Slice 4, resolved its `require` dependencies).
 *
 * These tests register controllers via the spec-020 module-DSL
 * (`createModule('app', ['ng']).controller(name, fn)`) and resolve the
 * real run-phase `$controller` service through `createInjector(['ng',
 * appModule])`. The canonical minification-safe shape — array-style
 * annotation with a trailing function — is used throughout per the
 * spec-020 invariant; bare-function controllers without `$inject` throw
 * at `injector.invoke` time and are not part of the documented surface.
 */

import { describe, expect, it } from 'vitest';

import { ngModule } from '@core/ng-module';
import { Scope } from '@core/index';
import { InvalidControllerNameError, MalformedControllerAliasError } from '@controller/controller-errors';
import type { ControllerInvokable, ControllerService, DeferredControllerResult } from '@controller/controller-types';
import { createInjector } from '@di/injector';
import { createModule } from '@di/module';

/**
 * Build an `app` module on top of the canonical `ng` module, register
 * the supplied controllers via the module DSL, and return the run-phase
 * `$controller` service. Mirrors the bootstrap pattern in
 * `src/controller/__tests__/controller-di.test.ts`.
 */
function bootstrap(register: (m: ReturnType<typeof createModule>) => void): {
  $controller: ControllerService;
  scope: Scope & Record<string, unknown>;
} {
  const appModule = createModule('app', ['ng']);
  register(appModule);
  const injector = createInjector([ngModule, appModule]);
  return {
    $controller: injector.get<ControllerService>('$controller'),
    scope: Scope.create() as Scope & Record<string, unknown>,
  };
}

describe('$controller — later: true call shape (spec 022 Slice 2)', () => {
  it('returns { instance, identifier } and does NOT publish the alias when invoked with name-as-alias suffix', () => {
    function Foo(this: { tag: string }): void {
      this.tag = 'foo';
    }
    const { $controller, scope } = bootstrap((m) => {
      m.controller('Foo', [Foo] as ControllerInvokable);
    });

    const deferred: DeferredControllerResult = $controller('Foo as vm', { $scope: scope }, undefined, true);

    expect(deferred.identifier).toBe('vm');
    expect(deferred.instance).toBeInstanceOf(Foo);
    expect((deferred.instance as { tag: string }).tag).toBe('foo');
    // Alias NOT yet published on the scope — the caller binds it later.
    expect(scope.vm).toBeUndefined();
  });

  it('returns { instance, identifier } with explicit ident when input is a function', () => {
    function MyCtrl(this: { ok: boolean }): void {
      this.ok = true;
    }
    const { $controller, scope } = bootstrap((m) => {
      void m;
    });

    const deferred: DeferredControllerResult = $controller(
      [MyCtrl] as ControllerInvokable,
      { $scope: scope },
      'vm',
      true,
    );
    expect(deferred.identifier).toBe('vm');
    expect(deferred.instance).toBeInstanceOf(MyCtrl);
    expect(scope.vm).toBeUndefined();
  });

  it('returns identifier: undefined when ident is omitted on the function path', () => {
    function MyCtrl(this: { ok: boolean }): void {
      this.ok = true;
    }
    const { $controller, scope } = bootstrap((m) => {
      void m;
    });

    const deferred: DeferredControllerResult = $controller(
      [MyCtrl] as ControllerInvokable,
      { $scope: scope },
      undefined,
      true,
    );
    expect(deferred.identifier).toBeUndefined();
    expect(deferred.instance).toBeInstanceOf(MyCtrl);
    expect(scope.vm).toBeUndefined();
  });

  it('returns identifier: undefined when name has no alias suffix and no ident is provided', () => {
    function Foo(this: { ok: boolean }): void {
      this.ok = true;
    }
    const { $controller, scope } = bootstrap((m) => {
      m.controller('Foo', [Foo] as ControllerInvokable);
    });

    const deferred: DeferredControllerResult = $controller('Foo', { $scope: scope }, undefined, true);
    expect(deferred.identifier).toBeUndefined();
    expect(deferred.instance).toBeInstanceOf(Foo);
  });

  it('explicit ident supersedes the parsed name-as-alias suffix', () => {
    function Foo(): void {}
    const { $controller, scope } = bootstrap((m) => {
      m.controller('Foo', [Foo] as ControllerInvokable);
    });

    const deferred: DeferredControllerResult = $controller('Foo as vm', { $scope: scope }, 'override', true);
    expect(deferred.identifier).toBe('override');
    // Neither alias is published.
    expect(scope.vm).toBeUndefined();
    expect(scope.override).toBeUndefined();
  });
});

describe('$controller — 1–3 arg call sites unchanged (regression guard)', () => {
  it('still publishes the alias on scope and returns the instance directly', () => {
    function Foo(this: { tag: string }): void {
      this.tag = 'foo';
    }
    const { $controller, scope } = bootstrap((m) => {
      m.controller('Foo', [Foo] as ControllerInvokable);
    });

    const instance = $controller('Foo as vm', { $scope: scope });
    expect(instance).toBeInstanceOf(Foo);
    expect(scope.vm).toBe(instance);
  });

  it('omitting `later` is equivalent to the spec-020 path on the function input', () => {
    function MyCtrl(this: { ok: boolean }): void {
      this.ok = true;
    }
    const { $controller, scope } = bootstrap((m) => {
      void m;
    });

    const instance = $controller([MyCtrl] as ControllerInvokable, { $scope: scope }, 'vm');
    expect(scope.vm).toBe(instance);
  });
});

describe('$controller — validation invariants under later: true', () => {
  it('rejects a malformed explicit `ident` argument even under later: true', () => {
    function Foo(): void {}
    const { $controller, scope } = bootstrap((m) => {
      m.controller('Foo', [Foo] as ControllerInvokable);
    });

    expect(() => $controller('Foo', { $scope: scope }, '1bad', true)).toThrow(MalformedControllerAliasError);
  });

  it('rejects a malformed explicit `ident` argument under the 1–3 arg call shape too', () => {
    function Foo(): void {}
    const { $controller, scope } = bootstrap((m) => {
      m.controller('Foo', [Foo] as ControllerInvokable);
    });

    expect(() => $controller('Foo', { $scope: scope }, 'has space')).toThrow(MalformedControllerAliasError);
  });

  it('rejects the reserved "hasOwnProperty" name under later: true', () => {
    const { $controller, scope } = bootstrap((m) => {
      void m;
    });

    expect(() => $controller('hasOwnProperty', { $scope: scope }, undefined, true)).toThrow(InvalidControllerNameError);
  });

  it('rejects the reserved "hasOwnProperty" name under the 1–3 arg call shape too', () => {
    const { $controller, scope } = bootstrap((m) => {
      void m;
    });

    expect(() => $controller('hasOwnProperty', { $scope: scope })).toThrow(InvalidControllerNameError);
  });
});
