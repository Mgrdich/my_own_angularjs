/**
 * Unit tests for `createController` (spec 020 Slice 2).
 *
 * Exercises the ESM-first factory in isolation — no `createInjector`, no
 * `$ControllerProvider`. The tests pass a **fake injector** (a small
 * handcrafted `{ invoke, get, has, annotate }` object) and a **fake
 * registry** (a real `Map<string, ControllerInvokable>`) so every Slice 2
 * behavior can be asserted without dragging the DI machinery in.
 *
 * Mirrors the precedent set by `controller-errors-foundation.test.ts` —
 * imports come from the leaf modules (`@controller/controller`,
 * `@controller/controller-errors`, `@controller/controller-types`), not
 * from the root barrel.
 */

import { describe, expect, it } from 'vitest';

import { Scope } from '@core/index';

import { createController } from '@controller/controller';
import {
  InvalidControllerFactoryError,
  InvalidControllerNameError,
  MalformedControllerAliasError,
  UnknownControllerError,
} from '@controller/controller-errors';
import type { ControllerInvokable, ControllerLocals, CreateControllerArgs } from '@controller/controller-types';

import type { Injector, Invokable } from '@di/di-types';

/**
 * Build a deliberately-minimal injector facade for tests. Supports just
 * the slice of `Injector` that `createController` exercises:
 *
 * - `annotate(fn)` — array-style (last element is the fn), `$inject`-property,
 *   or bare function (no `$inject` → `[]`).
 * - `invoke(fn, self, locals)` — extract deps via `annotate`; resolve each
 *   from `locals` (when the local is set, **including `undefined`**) else
 *   from the `services` map; call the trailing function with
 *   `apply(self, deps)`. Matches AngularJS's "locals win on key collision"
 *   contract — the same precedent used in `src/di/injector.ts:507-524`.
 * - `get(name)` — registry lookup; throws when missing.
 * - `has(name)` — registry existence check.
 */
function makeFakeInjector(services: Map<string, unknown>): Injector {
  function annotate(fn: Invokable): readonly string[] {
    if (Array.isArray(fn)) {
      return fn.slice(0, -1) as readonly string[];
    }
    const annotated = fn as { $inject?: readonly string[] };
    return annotated.$inject ?? [];
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- mirrors the real `Injector.get<T>` escape-hatch overload so the fake can be assigned to the `Injector` type without widening its signature
  function get<T>(name: string): T {
    if (!services.has(name)) {
      throw new Error(`Unknown service: ${name}`);
    }
    return services.get(name) as T;
  }

  function has(name: string): boolean {
    return services.has(name);
  }

  function invoke<Return>(fn: Invokable<Return>, self?: unknown, locals?: Record<string, unknown>): Return {
    const deps = annotate(fn);
    const resolved = deps.map((depName) => {
      if (locals !== undefined && Object.prototype.hasOwnProperty.call(locals, depName)) {
        return locals[depName];
      }
      return get(depName);
    });
    const actualFn = Array.isArray(fn)
      ? (fn[fn.length - 1] as (...args: unknown[]) => unknown)
      : (fn as unknown as (...args: unknown[]) => unknown);
    return actualFn.apply(self, resolved) as Return;
  }

  return {
    get,
    has,
    invoke,
    annotate,
  } as unknown as Injector;
}

/**
 * Build a fresh `{ $controller, registry, services }` triple for each
 * test. The fake injector is wired against `services`; the registry is a
 * real `Map<string, ControllerInvokable>` consistent with `CreateControllerArgs`.
 */
function makeHarness(initial?: {
  registry?: Iterable<readonly [string, ControllerInvokable]>;
  services?: Iterable<readonly [string, unknown]>;
}): {
  $controller: ReturnType<typeof createController>;
  registry: Map<string, ControllerInvokable>;
  services: Map<string, unknown>;
} {
  const registry = new Map<string, ControllerInvokable>(initial?.registry);
  const services = new Map<string, unknown>(initial?.services);
  const args: CreateControllerArgs = {
    injector: makeFakeInjector(services),
    registry,
  };
  return { $controller: createController(args), registry, services };
}

describe('createController — string name lookup', () => {
  it('looks up a registered controller and returns the instance', () => {
    function Greeter(this: { hello: string }): void {
      this.hello = 'hi';
    }
    const { $controller } = makeHarness({ registry: [['Greeter', Greeter as ControllerInvokable]] });

    const instance = $controller('Greeter') as { hello: string };
    expect(instance).not.toBeNull();
    expect(typeof instance).toBe('object');
    expect(instance.hello).toBe('hi');
    expect(instance).toBeInstanceOf(Greeter);
  });

  it('returns a distinct instance on each call', () => {
    function Counter(): void {}
    const { $controller } = makeHarness({ registry: [['Counter', Counter as ControllerInvokable]] });

    const a = $controller('Counter');
    const b = $controller('Counter');
    expect(a).not.toBe(b);
    expect(a).toBeInstanceOf(Counter);
    expect(b).toBeInstanceOf(Counter);
  });

  it('throws UnknownControllerError when the name is not registered', () => {
    const { $controller } = makeHarness();

    let caught: unknown;
    try {
      $controller('Missing', {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnknownControllerError);
    expect((caught as Error).name).toBe('UnknownControllerError');
    expect((caught as Error).message).toBe('Unknown controller: Missing');
  });
});

describe('createController — inline-function path', () => {
  it('instantiates a bare function passed directly', () => {
    function MyCtrl(this: { ok: boolean }): void {
      this.ok = true;
    }
    const { $controller } = makeHarness();

    const instance = $controller(MyCtrl as ControllerInvokable, {}) as { ok: boolean };
    expect(instance.ok).toBe(true);
    expect(instance).toBeInstanceOf(MyCtrl);
  });

  it('handles array-style annotations — last element is the fn, leading entries are deps', () => {
    const svc = { id: 'real' };
    const localScope = { tag: 'scope' };
    function MyCtrl(this: { s: unknown; svc: unknown }, $scope: unknown, $svc: unknown): void {
      this.s = $scope;
      this.svc = $svc;
    }
    const { $controller } = makeHarness({ services: [['$svc', svc]] });

    const instance = $controller(['$scope', '$svc', MyCtrl] as ControllerInvokable, {
      $scope: localScope as unknown as ControllerLocals['$scope'],
    }) as { s: unknown; svc: unknown };

    expect(instance.s).toBe(localScope);
    expect(instance.svc).toBe(svc);
  });
});

describe('createController — locals override', () => {
  it('locals win over services on a name collision', () => {
    const realSvc = { id: 'real' };
    const fakeSvc = { id: 'fake' };
    function MyCtrl(this: { svc: unknown }, $svc: unknown): void {
      this.svc = $svc;
    }
    const { $controller } = makeHarness({ services: [['$svc', realSvc]] });

    const instance = $controller(['$svc', MyCtrl] as ControllerInvokable, { $svc: fakeSvc } as ControllerLocals) as {
      svc: unknown;
    };

    expect(instance.svc).toBe(fakeSvc);
    expect(instance.svc).not.toBe(realSvc);
  });
});

describe('createController — InvalidControllerFactoryError on non-function/non-array inputs', () => {
  const cases: { label: string; value: unknown; description: string }[] = [
    { label: 'null', value: null, description: 'null' },
    { label: 'undefined', value: undefined, description: 'undefined' },
    { label: 'number 42', value: 42, description: 'number 42' },
    { label: 'plain object {}', value: {}, description: 'object' },
    { label: 'empty array []', value: [], description: 'empty array' },
  ];

  for (const { label, value, description } of cases) {
    it(`throws InvalidControllerFactoryError for ${label}`, () => {
      const { $controller } = makeHarness();

      let caught: unknown;
      try {
        $controller(value as never, {});
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(InvalidControllerFactoryError);
      expect((caught as Error).name).toBe('InvalidControllerFactoryError');
      expect((caught as Error).message).toBe(`Invalid controller factory for "<inline>": ${description}`);
    });
  }
});

describe('createController — "Name as alias" parser', () => {
  it('parses "Greeter as vm" and binds the instance to $scope.vm', () => {
    function Greeter(): void {}
    const scope = Scope.create();
    const { $controller } = makeHarness({ registry: [['Greeter', Greeter as ControllerInvokable]] });

    const instance = $controller('Greeter as vm', { $scope: scope });
    expect((scope as unknown as { vm: unknown }).vm).toBe(instance);
  });

  it('silently skips alias binding when $scope is absent (still returns the instance)', () => {
    function Greeter(this: { tag: string }): void {
      this.tag = 'g';
    }
    const { $controller } = makeHarness({ registry: [['Greeter', Greeter as ControllerInvokable]] });

    const instance = $controller('Greeter as vm', {}) as { tag: string };
    expect(instance.tag).toBe('g');
    // No throw, no scope to assert against — the silent-skip contract is
    // that the instance is still produced and returned.
  });

  it.each([['Name as '], [' as vm'], ['Name as 123'], [' Name as vm']])(
    'throws MalformedControllerAliasError for %j',
    (input) => {
      const { $controller, registry } = makeHarness();
      // Stuff a sentinel into the registry under several candidate bare
      // names so that a future regex-relaxation can't accidentally make
      // one of these inputs resolve. The parse must reject BEFORE the
      // registry lookup so this check holds for every input.
      function Sentinel(): void {}
      registry.set('Name', Sentinel as ControllerInvokable);

      let caught: unknown;
      try {
        $controller(input, {});
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(MalformedControllerAliasError);
      expect((caught as Error).name).toBe('MalformedControllerAliasError');
    },
  );
});

describe('createController — explicit `ident` argument', () => {
  it('binds an inline function under the explicit ident when $scope is present', () => {
    function Vm(this: { val: number }): void {
      this.val = 7;
    }
    const scope = Scope.create();
    const { $controller } = makeHarness();

    const instance = $controller(Vm as ControllerInvokable, { $scope: scope }, 'vm');
    expect((scope as unknown as { vm: { val: number } }).vm).toBe(instance);
  });

  it('explicit ident on the string path supersedes the alias suffix', () => {
    function Greeter(): void {}
    const scope = Scope.create();
    const { $controller } = makeHarness({ registry: [['Greeter', Greeter as ControllerInvokable]] });

    const instance = $controller('Greeter as fromSuffix', { $scope: scope }, 'fromArg');
    expect((scope as unknown as Record<string, unknown>).fromArg).toBe(instance);
    expect((scope as unknown as Record<string, unknown>).fromSuffix).toBeUndefined();
  });

  it.each([['1bad'], [' bad'], ['a b']])('throws MalformedControllerAliasError when ident is %j', (ident) => {
    function Vm(): void {}
    const { $controller } = makeHarness();

    let caught: unknown;
    try {
      $controller(Vm as ControllerInvokable, {}, ident);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MalformedControllerAliasError);
    expect((caught as Error).name).toBe('MalformedControllerAliasError');
  });
});

describe('createController — return-value replacement (Object.create + invoke + replace semantics)', () => {
  it('a non-null object return REPLACES the prototype instance', () => {
    function Orig(this: { fromProto: boolean }): { explicit: true } {
      this.fromProto = true;
      return { explicit: true };
    }
    const { $controller } = makeHarness();

    const instance = $controller(Orig as ControllerInvokable, {}) as { explicit: true; fromProto?: boolean };
    expect(instance.explicit).toBe(true);
    expect(instance).not.toBeInstanceOf(Orig);
    expect((instance as { fromProto?: boolean }).fromProto).toBeUndefined();
  });

  it('an undefined return keeps the prototype instance', () => {
    function Plain(this: { ok: boolean }): void {
      this.ok = true;
    }
    const { $controller } = makeHarness();

    const instance = $controller(Plain as ControllerInvokable, {}) as { ok: boolean };
    expect(instance.ok).toBe(true);
    expect(instance).toBeInstanceOf(Plain);
  });

  it.each([
    ['number 7', 7 as unknown],
    ['string "x"', 'x' as unknown],
    ['null', null as unknown],
  ])('a primitive return (%s) keeps the prototype instance', (_label, returned) => {
    function Plain(this: { tag: string }): unknown {
      this.tag = 'kept';
      return returned;
    }
    const { $controller } = makeHarness();

    const instance = $controller(Plain as ControllerInvokable, {}) as { tag: string };
    expect(instance.tag).toBe('kept');
    expect(instance).toBeInstanceOf(Plain);
  });
});

describe('createController — defensive `hasOwnProperty` rejection at lookup', () => {
  it('rejects `$controller("hasOwnProperty", ...)` even if registered under that name', () => {
    function Sneaky(): void {}
    const { $controller } = makeHarness({
      // Pre-populate the registry through the back door — proves the
      // lookup-time guard fires regardless of registration state.
      registry: [['hasOwnProperty', Sneaky as ControllerInvokable]],
    });

    let caught: unknown;
    try {
      $controller('hasOwnProperty', {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidControllerNameError);
    expect((caught as Error).name).toBe('InvalidControllerNameError');
    expect((caught as Error).message).toContain('hasOwnProperty');
  });
});
