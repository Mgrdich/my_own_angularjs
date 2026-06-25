import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';

import { bootstrapInjector } from '@bootstrap/bootstrap';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';

import { ngModule, Scope } from '@core/index';

describe('$rootScope on ngModule (spec 036 Slice 2)', () => {
  beforeEach(() => {
    // Isolate named-module registrations between tests. `ngModule` is referenced
    // by value, so resetting the registry does not strip the framework built-ins.
    resetRegistry();
  });

  it('resolves `$rootScope` to a Scope instance', () => {
    const injector = createInjector([ngModule]);
    const rootScope = injector.get('$rootScope');
    expect(rootScope).toBeInstanceOf(Scope);
    expect(typeof rootScope.$watch).toBe('function');
    expect(typeof rootScope.$digest).toBe('function');
    expect(typeof rootScope.$new).toBe('function');
  });

  it('is a singleton — the same reference across repeated `get`', () => {
    const injector = createInjector([ngModule]);
    const first = injector.get('$rootScope');
    const second = injector.get('$rootScope');
    expect(first).toBe(second);
  });

  it('is a LAZY factory — the scope behaves as a usable digest root', () => {
    const injector = createInjector([ngModule]);
    const rootScope = injector.get('$rootScope');
    let observed: number | undefined;
    rootScope.$watch(
      (scope) => scope['value'] as number | undefined,
      (newValue) => {
        observed = newValue;
      },
    );
    (rootScope as unknown as { value: number }).value = 42;
    rootScope.$digest();
    expect(observed).toBe(42);
  });

  it('resolves through `bootstrapInjector([...])`', () => {
    const appModule = createModule('rootScopeApp', []).value('apiUrl', '/api');
    const injector = bootstrapInjector([appModule]);
    const rootScope = injector.get('$rootScope');
    expect(rootScope).toBeInstanceOf(Scope);
    // Singleton through the bootstrap path too.
    expect(injector.get('$rootScope')).toBe(rootScope);
    // The user module is reachable alongside the framework root scope.
    expect(injector.get('apiUrl')).toBe('/api');
  });

  it('exposes `$rootScope` on the `ng` typed registry', () => {
    const injector = createInjector([ngModule]);
    const rootScope: Scope = injector.get('$rootScope');
    expectTypeOf(rootScope).toEqualTypeOf<Scope>();
  });

  it('is reachable via `injector.has("$rootScope")`', () => {
    const injector = createInjector([ngModule]);
    expect(injector.has('$rootScope')).toBe(true);
  });
});
