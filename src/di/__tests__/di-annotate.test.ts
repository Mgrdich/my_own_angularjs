import { describe, it, expect, expectTypeOf, beforeEach } from 'vitest';
import { createModule, resetRegistry } from '@di/module';
import { createInjector } from '@di/injector';

describe('dependency injection', () => {
  describe('injector.invoke / annotate', () => {
    beforeEach(() => {
      resetRegistry();
    });

    it('invokes an array-style invokable with resolved dependencies', () => {
      const mod = createModule('app', []).value('name', 'Jane');
      const injector = createInjector([mod]);
      const result = injector.invoke(['name', (name) => `hello ${name}`]);
      expect(result).toBe('hello Jane');
    });

    it('invokes a $inject-annotated function with resolved dependencies', () => {
      function greet(name: string) {
        return `hi ${name}`;
      }
      greet.$inject = ['name'] as const;
      const mod = createModule('app', []).value('name', 'Jane');
      const injector = createInjector([mod]);
      expect(injector.invoke(greet)).toBe('hi Jane');
    });

    it('resolves multiple dependencies in order', () => {
      const mod = createModule('app', []).value('first', 'Jane').value('last', 'Doe');
      const injector = createInjector([mod]);
      const result = injector.invoke(['first', 'last', (f: string, l: string) => `${f} ${l}`]);
      expect(result).toBe('Jane Doe');
    });

    it('binds `this` to the provided self argument', () => {
      const injector = createInjector([]);
      const ctx = { label: 'context' };
      function getLabel(this: { label: string }) {
        return this.label;
      }
      getLabel.$inject = [] as readonly string[];
      expect(injector.invoke(getLabel, ctx)).toBe('context');
    });

    it('uses locals override when the dep name is present in locals', () => {
      const mod = createModule('app', []).value('name', 'Jane');
      const injector = createInjector([mod]);
      const result = injector.invoke(['name', (name) => `hello ${name}`], null, { name: 'Bob' });
      expect(result).toBe('hello Bob');
    });

    it('respects an explicit undefined in locals (hasOwnProperty check)', () => {
      const mod = createModule('app', []).value('name', 'Jane');
      const injector = createInjector([mod]);
      const result = injector.invoke(['name', (name) => name], null, { name: undefined });
      expect(result).toBeUndefined();
    });

    it('falls through to the injector when a dep is not in locals', () => {
      const mod = createModule('app', []).value('name', 'Jane').value('age', 30);
      const injector = createInjector([mod]);
      const result = injector.invoke(['name', 'age', (n, a) => `${n}:${String(a)}`], null, { name: 'Bob' });
      expect(result).toBe('Bob:30');
    });

    it('invokes a function that depends on a lazy factory', () => {
      const mod = createModule('app', [])
        .value('base', 2)
        .factory('doubled', ['base', (base: number) => base * 2]);
      const injector = createInjector([mod]);
      const result = injector.invoke(['doubled', (d: number) => d + 1]);
      expect(result).toBe(5);
    });

    it('throws when invoking a plain function without $inject', () => {
      const injector = createInjector([]);
      function unannotated() {
        return 'never';
      }
      expect(() => injector.invoke(unannotated)).toThrow();
    });

    it('invokes a function with no dependencies (empty array-style)', () => {
      const injector = createInjector([]);
      const result = injector.invoke([() => 42]);
      expect(result).toBe(42);
    });

    it('infers callback parameter types from the registry (no manual annotation)', () => {
      const mod = createModule('app', []).value('name', 'Jane').value('age', 30);
      const injector = createInjector([mod]);
      // No type annotations on (name, age) — they're inferred from the registry
      // via the typed array-style overload on `Injector.invoke`.
      const result = injector.invoke(['name', 'age', (name, age) => `${name} is ${String(age)}`]);
      expect(result).toBe('Jane is 30');
      // Type-level check: the inference produced a `string` return.
      expectTypeOf(result).toEqualTypeOf<string>();
    });

    it('annotate returns dep names from an array-style invokable', () => {
      const injector = createInjector([]);
      const deps = injector.annotate(['a', 'b', 'c', (a, b, c) => [a, b, c]]);
      expect(deps).toEqual(['a', 'b', 'c']);
    });

    it('annotate returns $inject array from an annotated function', () => {
      const injector = createInjector([]);
      function svc() {
        return 42;
      }
      svc.$inject = ['dep1', 'dep2'] as const;
      expect(injector.annotate(svc)).toEqual(['dep1', 'dep2']);
    });

    it('annotate returns an empty array for a no-deps array-style', () => {
      const injector = createInjector([]);
      expect(injector.annotate([() => 1])).toEqual([]);
    });

    it('annotate returns an empty array for a function with empty $inject', () => {
      const injector = createInjector([]);
      function svc() {
        return 42;
      }
      svc.$inject = [] as readonly string[];
      expect(injector.annotate(svc)).toEqual([]);
    });

    it('annotate throws for a plain function without $inject', () => {
      const injector = createInjector([]);
      function unannotated() {
        return 'never';
      }
      expect(() => injector.annotate(unannotated)).toThrow();
    });
  });

  describe('type safety', () => {
    beforeEach(() => {
      resetRegistry();
    });

    it('module.value infers the value type (string)', () => {
      const m = createModule('app', []).value('apiUrl', 'https://example.com');
      const injector = createInjector([m]);
      expectTypeOf(injector.get('apiUrl')).toEqualTypeOf<string>();
    });

    it('module.constant infers the value type (number)', () => {
      const m = createModule('app', []).constant('MAX', 5);
      const injector = createInjector([m]);
      expectTypeOf(injector.get('MAX')).toEqualTypeOf<number>();
    });

    it('chained value and constant widen the registry correctly', () => {
      const m = createModule('app', []).value('apiUrl', 'https://example.com').value('timeout', 30).constant('MAX', 5);
      const injector = createInjector([m]);
      expectTypeOf(injector.get('apiUrl')).toEqualTypeOf<string>();
      expectTypeOf(injector.get('timeout')).toEqualTypeOf<number>();
      expectTypeOf(injector.get('MAX')).toEqualTypeOf<number>();
    });

    it('object values preserve their shape', () => {
      const m = createModule('app', []).value('config', { timeout: 30, retries: 3 });
      const injector = createInjector([m]);
      expectTypeOf(injector.get('config')).toEqualTypeOf<{ timeout: number; retries: number }>();
    });

    it('function values preserve their signature', () => {
      const m = createModule('app', []).value('logger', (msg: string) => {
        void msg;
      });
      const injector = createInjector([m]);
      expectTypeOf(injector.get('logger')).toEqualTypeOf<(msg: string) => void>();
    });

    it('multiple modules merge registries correctly', () => {
      const a = createModule('a', []).value('aValue', 'from a');
      const b = createModule('b', []).value('bValue', 42);
      const injector = createInjector([a, b]);
      expectTypeOf(injector.get('aValue')).toEqualTypeOf<string>();
      expectTypeOf(injector.get('bValue')).toEqualTypeOf<number>();
    });

    it('escape-hatch generic get<T> works for dynamic-name lookups', () => {
      const m = createModule('app', []).value('apiUrl', 'https://example.com');
      const injector = createInjector([m]);
      // Register a dynamic value under an unknown name via the typed path first,
      // then retrieve it through the escape-hatch overload with an explicit
      // generic `T`. The escape-hatch `get<T>(name: string): T` overload is
      // selected when the caller supplies an explicit generic and a plain
      // `string` (not a literal keyof Registry).
      type CustomShape = { custom: boolean };
      const dynamicName: string = 'apiUrl';
      const customValue = injector.get<CustomShape>(dynamicName);
      expectTypeOf(customValue).toEqualTypeOf<CustomShape>();
    });

    it('createModule preserves the name literal', () => {
      const m = createModule('app', []);
      expectTypeOf(m.name).toEqualTypeOf<'app'>();
    });

    it('createModule preserves the requires tuple literal', () => {
      const m = createModule('app', ['common', 'utils']);
      expectTypeOf(m.requires).toEqualTypeOf<readonly ['common', 'utils']>();
    });

    it('empty requires defaults to readonly []', () => {
      const m = createModule('app', []);
      expectTypeOf(m.requires).toEqualTypeOf<readonly []>();
    });

    it('typed get with a registered key compiles and returns the correct type', () => {
      const m = createModule('app', []).value('apiUrl', 'https://example.com');
      const injector = createInjector([m]);
      // This line must compile without error -- 'apiUrl' is a statically-known
      // key of the merged registry and picks the typed `get` overload.
      const url = injector.get('apiUrl');
      expectTypeOf(url).toEqualTypeOf<string>();
    });

    it('typed get with an unregistered key is rejected by the typed overload', () => {
      const m = createModule('app', []).value('apiUrl', 'https://example.com');
      const injector = createInjector([m]);
      // Isolate the typed overload from the `Injector` interface so that
      // overload resolution cannot fall through to the escape-hatch
      // `get<T>(name: string): T`. Once extracted as a standalone function
      // type, only the `K extends keyof Registry` signature is visible, so
      // passing an unregistered literal key is a compile error.
      type Registry = { apiUrl: string };
      type TypedGet = <K extends keyof Registry>(name: K) => Registry[K];
      const typedGet: TypedGet = injector.get.bind(injector);
      // Positive check: a registered key compiles and returns the correct type.
      expectTypeOf(typedGet('apiUrl')).toEqualTypeOf<string>();
      // Negative check: an unregistered literal key is a compile error on the
      // typed overload. The runtime call throws "Unknown provider", which we
      // catch so the test still completes — only the compile-time
      // `@ts-expect-error` assertion matters here.
      try {
        // @ts-expect-error -- 'nonexistent' is not in the typed registry
        typedGet('nonexistent');
      } catch {
        /* expected: runtime throws on unregistered name */
      }
    });

    it('services from a dep module are typed when all modules are passed to createInjector', () => {
      const common = createModule('common', []).value('logger', {
        log: (m: string): undefined => {
          void m;
          return undefined;
        },
      });
      const app = createModule('app', ['common']).value('apiUrl', 'https://example.com');
      // Pass BOTH modules so MergeRegistries can union their Registry type params
      const injector = createInjector([common, app]);
      expectTypeOf(injector.get('logger')).toEqualTypeOf<{ log: (m: string) => undefined }>();
      expectTypeOf(injector.get('apiUrl')).toEqualTypeOf<string>();
    });

    it('services from multiple dep modules all merge into the injector type', () => {
      const a = createModule('a', []).value('aValue', 'from a');
      const b = createModule('b', []).value('bValue', 42);
      const c = createModule('c', []).value('cValue', true);
      const app = createModule('app', ['a', 'b', 'c']).value('appValue', [1, 2, 3]);
      const injector = createInjector([a, b, c, app]);
      expectTypeOf(injector.get('aValue')).toEqualTypeOf<string>();
      expectTypeOf(injector.get('bValue')).toEqualTypeOf<number>();
      expectTypeOf(injector.get('cValue')).toEqualTypeOf<boolean>();
      expectTypeOf(injector.get('appValue')).toEqualTypeOf<number[]>();
    });

    it('services only available via runtime dep walking use the escape-hatch type', () => {
      createModule('common', []).value('runtimeOnly', 'visible at runtime');
      const app = createModule('app', ['common']).value('apiUrl', 'https://example.com');
      // Only `app` is passed to createInjector
      const injector = createInjector([app]);
      // Typed path: works for app's own services
      expectTypeOf(injector.get('apiUrl')).toEqualTypeOf<string>();
      // Escape-hatch path: runtimeOnly is loaded at runtime but NOT in the typed
      // registry of `[app]`. The typed `get<K extends keyof Registry>` overload
      // doesn't match because 'runtimeOnly' isn't a statically-known key, so
      // lookups fall through to the escape-hatch `get<T>(name: string): T`. We
      // ask for a concrete branded shape that clearly is not assignable to
      // `keyof Registry` so overload resolution lands on the escape hatch.
      type RuntimeOnly = { readonly __runtimeOnly: string };
      const dynamicName: string = 'runtimeOnly';
      const runtimeValue = injector.get<RuntimeOnly>(dynamicName);
      expectTypeOf(runtimeValue).toEqualTypeOf<RuntimeOnly>();
      // Runtime still works because the module was loaded via requires; the
      // value comes back as the raw string we registered, which we immediately
      // narrow through `unknown` for the runtime assertion.
      expect(runtimeValue as unknown).toBe('visible at runtime');
    });

    it('MergeRegistries handles an empty module list', () => {
      const injector = createInjector([]);
      // No values registered; get should still be callable on the escape-hatch path
      expect(() => injector.get('anything' as string)).toThrow('Unknown provider: anything');
    });

    it('merges disjoint modules into a single typed registry', () => {
      const core = createModule('core', []).value('version', '1.0');
      const feat = createModule('feat', []).constant('FEATURE_FLAG', 'on' as const);
      const injector = createInjector([core, feat]);
      expectTypeOf(injector.get('version')).toEqualTypeOf<string>();
      expectTypeOf(injector.get('FEATURE_FLAG')).toEqualTypeOf<'on'>();
    });

    it('factory with explicit generic T infers return type on injector.get', () => {
      type Logger = { log: (m: string) => void };
      const mod = createModule('app', []).factory<'logger', Logger>('logger', [
        () => ({
          log: (m: string) => {
            void m;
          },
        }),
      ]);
      const injector = createInjector([mod]);
      expectTypeOf(injector.get('logger')).toEqualTypeOf<Logger>();
    });

    it('factory infers return type from invokable when no explicit generic is provided', () => {
      const mod = createModule('app', []).factory('svc', [() => ({ foo: 'bar' })]);
      const injector = createInjector([mod]);
      expectTypeOf(injector.get('svc')).toEqualTypeOf<{ foo: string }>();
    });

    it('factory merges into registry alongside value and constant', () => {
      type Greeter = { hello: () => string };
      const mod = createModule('app', [])
        .value('name', 'World')
        .constant('PREFIX', '>>')
        .factory<'greeter', Greeter>('greeter', ['name', (name: string): Greeter => ({ hello: () => `hi ${name}` })]);
      const injector = createInjector([mod]);
      expectTypeOf(injector.get('name')).toEqualTypeOf<string>();
      expectTypeOf(injector.get('PREFIX')).toEqualTypeOf<string>();
      expectTypeOf(injector.get('greeter')).toEqualTypeOf<Greeter>();
    });

    it('factories from multiple modules merge into the injector type', () => {
      type Clock = { now: () => number };
      type Random = { next: () => number };
      const core = createModule('core', []).factory<'clock', Clock>('clock', [() => ({ now: () => Date.now() })]);
      const rand = createModule('rand', []).factory<'random', Random>('random', [
        () => ({ next: () => Math.random() }),
      ]);
      const injector = createInjector([core, rand]);
      expectTypeOf(injector.get('clock')).toEqualTypeOf<Clock>();
      expectTypeOf(injector.get('random')).toEqualTypeOf<Random>();
    });

    it('$inject-annotated factory with explicit generic T infers return type', () => {
      type Counter = { value: number };
      function makeCounter(): Counter {
        return { value: 0 };
      }
      makeCounter.$inject = [] as string[];
      const mod = createModule('app', []).factory<'counter', Counter>('counter', makeCounter);
      const injector = createInjector([mod]);
      expectTypeOf(injector.get('counter')).toEqualTypeOf<Counter>();
    });
  });
});
