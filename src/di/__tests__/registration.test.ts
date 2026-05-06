/**
 * Unit tests for `applyRegistrationRecord` (spec 015 / Slices 2 + 3).
 *
 * Exercises the recipe dispatch, the lifted `registerProvider` helper, and
 * the constant-override guard in isolation — no `createInjector` involvement.
 * Each test freshly constructs a `RegistrationDeps` bag via `makeFreshDeps`
 * so cross-test mutation is impossible.
 */

import { describe, it, expect } from 'vitest';
import type { Injector, Invokable } from '@di/di-types';
import type { RecipeType } from '@di/module';
import { applyRegistrationRecord, type RegistrationDeps } from '@di/registration';

const makeFreshDeps = (overrides: Partial<RegistrationDeps> = {}): RegistrationDeps => ({
  factoryInvokables: new Map(),
  serviceCtors: new Map(),
  providerInstances: new Map(),
  providerGetInvokables: new Map(),
  providerCache: new Map(),
  decorators: new Map(),
  constantNames: new Set(),
  getProviderInjector: () => {
    throw new Error('getProviderInjector not stubbed');
  },
  ...overrides,
});

describe('applyRegistrationRecord (spec 015 / Slices 2 + 3)', () => {
  describe('per-recipe dispatch', () => {
    it('value recipe writes only to providerCache', () => {
      const deps = makeFreshDeps();
      applyRegistrationRecord('value', 'name', 'theValue', deps);

      expect(deps.providerCache.get('name')).toBe('theValue');
      expect(deps.providerCache.size).toBe(1);
      expect(deps.factoryInvokables.size).toBe(0);
      expect(deps.serviceCtors.size).toBe(0);
      expect(deps.providerInstances.size).toBe(0);
      expect(deps.providerGetInvokables.size).toBe(0);
      expect(deps.decorators.size).toBe(0);
      expect(deps.constantNames.size).toBe(0);
    });

    it('constant recipe writes name to constantNames AND providerCache', () => {
      const deps = makeFreshDeps();
      applyRegistrationRecord('constant', 'MAX', 100, deps);

      expect(deps.providerCache.get('MAX')).toBe(100);
      expect(deps.providerCache.size).toBe(1);
      // The constant arm is the only recipe that writes to `constantNames`;
      // this is the source of truth the override guard reads.
      expect(deps.constantNames.has('MAX')).toBe(true);
      expect(deps.constantNames.size).toBe(1);
      expect(deps.factoryInvokables.size).toBe(0);
      expect(deps.serviceCtors.size).toBe(0);
      expect(deps.providerInstances.size).toBe(0);
      expect(deps.providerGetInvokables.size).toBe(0);
      expect(deps.decorators.size).toBe(0);
    });

    it('factory recipe writes only to factoryInvokables', () => {
      const deps = makeFreshDeps();
      const invokable: Invokable = [() => 'result'] as const;
      applyRegistrationRecord('factory', 'svc', invokable, deps);

      expect(deps.factoryInvokables.get('svc')).toBe(invokable);
      expect(deps.factoryInvokables.size).toBe(1);
      expect(deps.providerCache.size).toBe(0);
      expect(deps.serviceCtors.size).toBe(0);
      expect(deps.providerInstances.size).toBe(0);
      expect(deps.providerGetInvokables.size).toBe(0);
      expect(deps.decorators.size).toBe(0);
      expect(deps.constantNames.size).toBe(0);
    });

    it('service recipe writes only to serviceCtors', () => {
      const deps = makeFreshDeps();
      class Greeter {
        greet() {
          return 'hi';
        }
      }
      const ctor = Greeter as unknown as Invokable;
      applyRegistrationRecord('service', 'greeter', ctor, deps);

      expect(deps.serviceCtors.get('greeter')).toBe(ctor);
      expect(deps.serviceCtors.size).toBe(1);
      expect(deps.providerCache.size).toBe(0);
      expect(deps.factoryInvokables.size).toBe(0);
      expect(deps.providerInstances.size).toBe(0);
      expect(deps.providerGetInvokables.size).toBe(0);
      expect(deps.decorators.size).toBe(0);
      expect(deps.constantNames.size).toBe(0);
    });

    it('provider recipe writes to providerInstances and providerGetInvokables (NOT providerCache)', () => {
      const deps = makeFreshDeps();
      const $get: Invokable = () => 'service-value';
      const source = { $get };
      applyRegistrationRecord('provider', 'foo', source, deps);

      expect(deps.providerInstances.get('fooProvider')).toBe(source);
      const entry = deps.providerGetInvokables.get('foo');
      expect(entry).toBeDefined();
      expect(entry?.invokable).toBe($get);
      expect(entry?.providerInstance).toBe(source);
      // Per the Slice 2 deviation note: `<name>Provider` is NOT written to
      // providerCache — that would break run-phase isolation.
      expect(deps.providerCache.has('fooProvider')).toBe(false);
      expect(deps.providerCache.size).toBe(0);
      expect(deps.factoryInvokables.size).toBe(0);
      expect(deps.serviceCtors.size).toBe(0);
      expect(deps.decorators.size).toBe(0);
      expect(deps.constantNames.size).toBe(0);
    });

    it('decorator recipe writes only to decorators (single-element array)', () => {
      const deps = makeFreshDeps();
      const dec: Invokable = ['$delegate', (delegate: unknown) => delegate] as const;
      applyRegistrationRecord('decorator', 'svc', dec, deps);

      const list = deps.decorators.get('svc');
      expect(list).toEqual([dec]);
      expect(list).toHaveLength(1);
      expect(deps.decorators.size).toBe(1);
      expect(deps.providerCache.size).toBe(0);
      expect(deps.factoryInvokables.size).toBe(0);
      expect(deps.serviceCtors.size).toBe(0);
      expect(deps.providerInstances.size).toBe(0);
      expect(deps.providerGetInvokables.size).toBe(0);
      expect(deps.constantNames.size).toBe(0);
    });
  });

  describe('decorator stacking', () => {
    it('appends decorators on the same name in registration order', () => {
      const deps = makeFreshDeps();
      const dec1: Invokable = ['$delegate', (d: unknown) => d] as const;
      const dec2: Invokable = ['$delegate', (d: unknown) => d] as const;

      applyRegistrationRecord('decorator', 'svc', dec1, deps);
      applyRegistrationRecord('decorator', 'svc', dec2, deps);

      expect(deps.decorators.get('svc')).toEqual([dec1, dec2]);
    });
  });

  describe('provider eager-instantiation across all three forms', () => {
    it('Form 1 (bare constructor): instantiates via `new Ctor()`', () => {
      const deps = makeFreshDeps();
      const $get: Invokable = () => 'form1-value';
      class FooProvider {
        readonly $get = $get;
      }
      applyRegistrationRecord('provider', 'foo', FooProvider, deps);

      const instance = deps.providerInstances.get('fooProvider');
      expect(instance).toBeInstanceOf(FooProvider);

      const entry = deps.providerGetInvokables.get('foo');
      expect(entry).toBeDefined();
      expect(entry?.providerInstance).toBe(instance);
      expect(entry?.invokable).toBe($get);
    });

    it('Form 2 (object literal): uses the source as-is', () => {
      const deps = makeFreshDeps();
      const $get: Invokable = () => 'form2-value';
      const source = { $get };
      applyRegistrationRecord('provider', 'foo', source, deps);

      expect(deps.providerInstances.get('fooProvider')).toBe(source);
      const entry = deps.providerGetInvokables.get('foo');
      expect(entry?.providerInstance).toBe(source);
      expect(entry?.invokable).toBe($get);
    });

    it('Form 3 (array-style): instantiates via `new Ctor(...resolvedDeps)` from the provider injector', () => {
      const fakeProviderInjector: Injector = {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- mirrors the dynamic-name escape-hatch overload on the real `Injector.get`; required to satisfy the interface signature.
        get: <T>(name: string): T => {
          if (name === 'dep1') {
            return 'resolved-dep1' as T;
          }
          throw new Error(`Unknown: ${name}`);
        },
        has: (name: string) => name === 'dep1',
        invoke: () => {
          throw new Error('not used');
        },
        annotate: () => [],
      };
      const deps = makeFreshDeps({ getProviderInjector: () => fakeProviderInjector });

      const $get: Invokable = () => 'form3-value';
      class FooProvider {
        readonly seenDep: string;
        readonly $get = $get;
        constructor(dep1: string) {
          this.seenDep = dep1;
        }
      }
      const source = ['dep1', FooProvider] as const;
      applyRegistrationRecord('provider', 'foo', source, deps);

      const instance = deps.providerInstances.get('fooProvider');
      expect(instance).toBeInstanceOf(FooProvider);
      expect((instance as FooProvider).seenDep).toBe('resolved-dep1');

      const entry = deps.providerGetInvokables.get('foo');
      expect(entry?.providerInstance).toBe(instance);
      expect(entry?.invokable).toBe($get);
    });
  });

  describe('provider source validation', () => {
    it('throws when an object source is missing $get', () => {
      const deps = makeFreshDeps();
      expect(() => {
        applyRegistrationRecord('provider', 'foo', { notGet: 1 }, deps);
      }).toThrow('Expected provider for "foo" to be a function, array, or object with $get');
    });

    it('throws when a constructor produces an instance without $get', () => {
      const deps = makeFreshDeps();
      class FooProvider {
        readonly notGet = 1;
      }
      expect(() => {
        applyRegistrationRecord('provider', 'foo', FooProvider, deps);
      }).toThrow('Provider "foo" has no $get method');
    });

    it('throws when the source is null', () => {
      const deps = makeFreshDeps();
      expect(() => {
        applyRegistrationRecord('provider', 'foo', null, deps);
      }).toThrow('Expected provider for "foo" to be a function, array, or object with $get');
    });
  });

  describe('constant-override guard', () => {
    it.each(['value', 'factory', 'service', 'provider'] as const)(
      'throws when registering "%s" for a name already registered as a constant',
      (recipe) => {
        const deps = makeFreshDeps();
        applyRegistrationRecord('constant', 'X', 'a', deps);
        const value = recipe === 'provider' ? { $get: () => 'v' } : () => 'v';
        expect(() => {
          applyRegistrationRecord(recipe satisfies RecipeType, 'X', value, deps);
        }).toThrow('Cannot override constant "X" — already registered via .constant(...)');
      },
    );

    it('allows constant-over-constant (last-wins) without growing constantNames', () => {
      const deps = makeFreshDeps();
      applyRegistrationRecord('constant', 'X', 'a', deps);
      applyRegistrationRecord('constant', 'X', 'b', deps);

      expect(deps.providerCache.get('X')).toBe('b');
      expect(deps.constantNames.has('X')).toBe(true);
      // Re-registering the same name doesn't grow the set — `Set.add` is
      // idempotent, which keeps `constantNames` an accurate count of unique
      // constant names.
      expect(deps.constantNames.size).toBe(1);
    });

    it('throws when decorating a name already registered as a constant', () => {
      // The guard condition `recipe !== 'constant'` catches `decorator` too,
      // matching the technical-considerations §2.6 spec ("any non-`constant`
      // recipe targeting a name in `constantNames` throws"). Constants are
      // immutable values with no `$delegate` to wrap, so decoration would be
      // meaningless anyway.
      const deps = makeFreshDeps();
      applyRegistrationRecord('constant', 'X', 'a', deps);
      const dec = ['$delegate', ($d: unknown) => `${String($d)}!`] as Invokable;
      expect(() => {
        applyRegistrationRecord('decorator', 'X', dec, deps);
      }).toThrow('Cannot override constant "X" — already registered via .constant(...)');
    });

    it('does not fire the guard for unrelated names', () => {
      const deps = makeFreshDeps();
      applyRegistrationRecord('constant', 'X', 'a', deps);
      applyRegistrationRecord('value', 'Y', 'b', deps);

      expect(deps.providerCache.get('X')).toBe('a');
      expect(deps.providerCache.get('Y')).toBe('b');
    });

    it('reads `constantNames` (not `providerCache`) as its source of truth', () => {
      const deps = makeFreshDeps();
      // Manually pollute providerCache without going through the constant
      // arm — `providerCache` also holds values, `$injector`, and (eventually)
      // `$provide`, so the guard must NOT key off `providerCache.has(name)`.
      deps.providerCache.set('X', 'a');
      // Since 'X' isn't in constantNames, a value override is allowed:
      applyRegistrationRecord('value', 'X', 'b', deps);

      expect(deps.providerCache.get('X')).toBe('b');
    });
  });
});
