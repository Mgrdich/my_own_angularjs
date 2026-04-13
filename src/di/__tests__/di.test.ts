import { describe, it, expect, expectTypeOf, beforeEach, vi } from 'vitest';
import { Module, createModule, getModule, resetRegistry } from '@di/module';
import { createInjector } from '@di/injector';

describe('createModule / getModule', () => {
  beforeEach(() => {
    resetRegistry();
  });

  describe('creation', () => {
    it('creates a module with no dependencies', () => {
      const mod = createModule('app', []);
      expect(mod).toBeInstanceOf(Module);
      expect(mod.name).toBe('app');
      expect(mod.requires.length).toBe(0);
    });

    it('creates a module with dependencies', () => {
      const mod = createModule('app', ['common', 'utils']);
      expect(mod.requires).toEqual(['common', 'utils']);
    });

    it('defaults requires to an empty array when not provided', () => {
      const mod = createModule('app');
      expect(mod.requires.length).toBe(0);
    });

    it('the returned module has an empty invokeQueue', () => {
      const mod = createModule('app', []);
      expect(mod.invokeQueue.length).toBe(0);
    });
  });

  describe('retrieval', () => {
    it('retrieves a previously-created module', () => {
      const created = createModule('app', []);

      expect(getModule('app')).toBe(created);
    });

    it('returns the same reference on multiple retrievals', () => {
      createModule('app', []);
      expect(getModule('app')).toBe(getModule('app'));
    });

    it('throws on retrieving a non-existent module', () => {
      expect(() => getModule('nonexistent')).toThrow('Module not found: nonexistent');
    });

    it('throws with the correct module name in the error message', () => {
      expect(() => getModule('foo')).toThrow('Module not found: foo');
    });
  });

  describe('replacement and isolation', () => {
    it('creating a module with the same name replaces the previous one', () => {
      createModule('app', ['a']);
      createModule('app', ['b']);
      expect(getModule('app').requires).toEqual(['b']);
    });

    it('resetRegistry() clears all modules', () => {
      createModule('app', []);
      createModule('common', []);
      createModule('utils', []);
      resetRegistry();
      expect(() => getModule('app')).toThrow('Module not found: app');
    });
  });
});

describe('Module.value', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('pushes [value, name, value] to the invokeQueue', () => {
    const mod = createModule('app', []);
    mod.value('apiUrl', 'https://example.com');
    expect(mod.invokeQueue[0]).toEqual(['value', 'apiUrl', 'https://example.com']);
  });

  it('returns the same module instance (for chaining)', () => {
    const mod = createModule('app', []);
    const result = mod.value('x', 1);
    expect(result).toBe(mod);
  });

  it('supports chaining multiple value calls', () => {
    const mod = createModule('app', []).value('a', 1).value('b', 2).value('c', 3);
    expect(mod.invokeQueue.length).toBe(3);
    expect(mod.invokeQueue[0]).toEqual(['value', 'a', 1]);
    expect(mod.invokeQueue[1]).toEqual(['value', 'b', 2]);
    expect(mod.invokeQueue[2]).toEqual(['value', 'c', 3]);
  });

  it('accepts a string value', () => {
    const mod = createModule('app', []).value('s', 'hello');
    expect(mod.invokeQueue[0]).toEqual(['value', 's', 'hello']);
  });

  it('accepts a number value', () => {
    const mod = createModule('app', []).value('n', 42);
    expect(mod.invokeQueue[0]).toEqual(['value', 'n', 42]);
  });

  it('accepts a boolean value', () => {
    const mod = createModule('app', []).value('b', true);
    expect(mod.invokeQueue[0]).toEqual(['value', 'b', true]);
  });

  it('accepts an object value (preserving reference identity)', () => {
    const obj = { key: 'value' };
    const mod = createModule('app', []).value('o', obj);
    const entry = mod.invokeQueue[0];
    expect(entry).toEqual(['value', 'o', obj]);
    expect(entry).toBeDefined();
    if (entry !== undefined) {
      expect(entry[2]).toBe(obj);
    }
  });

  it('accepts an array value (preserving reference identity)', () => {
    const arr = [1, 2, 3];
    const mod = createModule('app', []).value('a', arr);
    const entry = mod.invokeQueue[0];
    expect(entry).toEqual(['value', 'a', arr]);
    expect(entry).toBeDefined();
    if (entry !== undefined) {
      expect(entry[2]).toBe(arr);
    }
  });

  it('accepts a null value', () => {
    const mod = createModule('app', []).value('nully', null);
    expect(mod.invokeQueue[0]).toEqual(['value', 'nully', null]);
  });

  it('accepts an undefined value', () => {
    const mod = createModule('app', []).value('undef', undefined);
    expect(mod.invokeQueue[0]).toEqual(['value', 'undef', undefined]);
  });

  it('replaces an existing value when the same name is registered twice (later wins at injector drain)', () => {
    const mod = createModule('app', []).value('x', 1).value('x', 2);
    expect(mod.invokeQueue.length).toBe(2);
    expect(mod.invokeQueue[0]).toEqual(['value', 'x', 1]);
    expect(mod.invokeQueue[1]).toEqual(['value', 'x', 2]);

    const injector = createInjector([mod]);
    expect(injector.get('x')).toBe(2);
  });
});

describe('Module.constant', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('pushes [constant, name, value] to the invokeQueue', () => {
    const mod = createModule('app', []);
    mod.constant('MAX', 100);
    expect(mod.invokeQueue[0]).toEqual(['constant', 'MAX', 100]);
  });

  it('returns the same module instance (for chaining)', () => {
    const mod = createModule('app', []);
    const result = mod.constant('MAX', 100);
    expect(result).toBe(mod);
  });

  it('supports chaining with value', () => {
    const mod = createModule('app', []).value('a', 1).constant('MAX', 5).value('b', 2);
    expect(mod.invokeQueue.length).toBe(3);
    expect(mod.invokeQueue[0]).toEqual(['value', 'a', 1]);
    expect(mod.invokeQueue[1]).toEqual(['constant', 'MAX', 5]);
    expect(mod.invokeQueue[2]).toEqual(['value', 'b', 2]);
  });
});

describe('Module.factory', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('pushes [factory, name, invokable] to invokeQueue (array-style)', () => {
    const invokable = ['dep', (dep: unknown) => ({ dep })] as const;
    const mod = createModule('app', []).factory('myService', invokable);
    expect(mod.invokeQueue).toHaveLength(1);
    const entry = mod.invokeQueue[0];
    expect(entry?.[0]).toBe('factory');
    expect(entry?.[1]).toBe('myService');
    expect(entry?.[2]).toBe(invokable);
  });

  it('pushes [factory, name, invokable] to invokeQueue ($inject-annotated)', () => {
    function makeService(dep: unknown) {
      return { dep };
    }
    makeService.$inject = ['dep'];
    const mod = createModule('app', []).factory('myService', makeService);
    expect(mod.invokeQueue).toHaveLength(1);
    const entry = mod.invokeQueue[0];
    expect(entry?.[0]).toBe('factory');
    expect(entry?.[1]).toBe('myService');
    expect(entry?.[2]).toBe(makeService);
  });

  it('returns the same module instance (for chaining)', () => {
    const mod = createModule('app', []);
    const chained = mod.factory('myService', [() => ({})]);
    expect(chained).toBe(mod);
  });

  it('supports chaining with value and constant', () => {
    const mod = createModule('app', [])
      .value('v', 1)
      .constant('c', 2)
      .factory('f', [() => 'result']);
    expect(mod.invokeQueue).toHaveLength(3);
    expect(mod.invokeQueue[0]?.[0]).toBe('value');
    expect(mod.invokeQueue[1]?.[0]).toBe('constant');
    expect(mod.invokeQueue[2]?.[0]).toBe('factory');
  });
});

describe('createInjector (values and constants)', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('creates an injector from a single module', () => {
    const mod = createModule('app', []).value('url', 'https://example.com');
    const injector = createInjector([mod]);
    expect(injector).toBeDefined();
    expect(typeof injector.get).toBe('function');
    expect(typeof injector.has).toBe('function');
  });

  it('injector.get(name) returns a registered value', () => {
    const mod = createModule('app', []).value('url', 'https://example.com');
    const injector = createInjector([mod]);
    expect(injector.get('url')).toBe('https://example.com');
  });

  it('injector.get(name) returns a registered constant', () => {
    const mod = createModule('app', []).constant('MAX', 100);
    const injector = createInjector([mod]);
    expect(injector.get('MAX')).toBe(100);
  });

  it('injector.get(name) returns the same reference on multiple calls (singleton caching)', () => {
    const obj = { foo: 'bar' };
    const mod = createModule('app', []).value('obj', obj);
    const injector = createInjector([mod]);
    const first = injector.get('obj');
    const second = injector.get('obj');
    expect(first).toBe(second);
    expect(first).toBe(obj);
  });

  it('injector.get(unknown) throws "Unknown provider: <name>"', () => {
    const injector = createInjector([createModule('app', [])]);
    expect(() => injector.get<unknown>('foo')).toThrow('Unknown provider: foo');
  });

  it('injector.has(name) returns true for registered values', () => {
    const mod = createModule('app', []).value('url', 'https://example.com');
    const injector = createInjector([mod]);
    expect(injector.has('url')).toBe(true);
  });

  it('injector.has(name) returns false for unregistered services', () => {
    const injector = createInjector([createModule('app', [])]);
    expect(injector.has('nonexistent')).toBe(false);
  });

  it('injector.has(name) returns true for both values and constants', () => {
    const mod = createModule('app', []).value('url', 'https://example.com').constant('MAX', 100);
    const injector = createInjector([mod]);
    expect(injector.has('url')).toBe(true);
    expect(injector.has('MAX')).toBe(true);
  });
});

describe('createInjector (multiple modules)', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('merges values and constants from multiple modules', () => {
    const a = createModule('a', []).value('aValue', 1);
    const b = createModule('b', []).value('bValue', 2);
    const injector = createInjector([a, b]);
    expect(injector.get('aValue')).toBe(1);
    expect(injector.get('bValue')).toBe(2);
  });

  it('later modules override earlier modules when the same name is registered', () => {
    const a = createModule('a', []).value('shared', 'from a');
    const b = createModule('b', []).value('shared', 'from b');
    const injector = createInjector([a, b]);
    expect(injector.get('shared')).toBe('from b');
  });
});

describe('createInjector (module dependency graph)', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('loads a required module declared in `requires`', () => {
    createModule('common', []).value('logger', 'the-logger');
    const app = createModule('app', ['common']).value('apiUrl', 'https://...');
    const injector = createInjector([app]);
    // `injector.get('logger')` uses the escape-hatch runtime path because
    // `MergeRegistries<[typeof app]>` only sees `app`'s own Registry, not
    // `common`'s. This test verifies runtime behavior only.
    expect(injector.get('logger')).toBe('the-logger');
    expect(injector.get('apiUrl')).toBe('https://...');
  });

  it('loads a chain of transitive dependencies (app -> b -> c)', () => {
    createModule('c', []).value('cValue', 'from c');
    createModule('b', ['c']).value('bValue', 'from b');
    const app = createModule('app', ['b']).value('appValue', 'from app');
    const injector = createInjector([app]);
    expect(injector.get('cValue')).toBe('from c');
    expect(injector.get('bValue')).toBe('from b');
    expect(injector.get('appValue')).toBe('from app');
  });

  it('loads a shared dependency only once (diamond)', () => {
    // Reference-identity check on the shared value proves it wasn't
    // re-drained as a second entry under a different binding.
    const sharedMarker = { marker: 'shared' };
    createModule('common', []).value('shared', sharedMarker);
    createModule('a', ['common']).value('aValue', 1);
    createModule('b', ['common']).value('bValue', 2);
    const app = createModule('app', ['a', 'b']).value('appValue', 3);
    const injector = createInjector([app]);
    expect(injector.get('shared')).toBe(sharedMarker);
    expect(injector.get('aValue')).toBe(1);
    expect(injector.get('bValue')).toBe(2);
    expect(injector.get('appValue')).toBe(3);
  });

  it('drains dependencies before their dependents (post-order)', () => {
    createModule('common', []).value('config', 'common-config');
    const app = createModule('app', ['common']).value('config', 'app-config');
    const injector = createInjector([app]);
    // app.value runs AFTER common.value, so app wins.
    expect(injector.get('config')).toBe('app-config');
  });

  it('throws when a required module is not registered', () => {
    const app = createModule('app', ['nonexistent']).value('apiUrl', 'https://...');
    expect(() => createInjector([app])).toThrow('Module not found: nonexistent');
  });

  it('throws when a transitive required module is not registered', () => {
    createModule('b', ['nonexistent']).value('bValue', 'from b');
    const app = createModule('app', ['b']);
    expect(() => createInjector([app])).toThrow('Module not found: nonexistent');
  });

  it('handles circular module dependencies without infinite loop', () => {
    // Two-phase setup: `createModule` only records the `requires` list; the
    // other module only needs to exist in the registry at injector-load time.
    createModule('a', ['b']).value('aValue', 'from a');
    createModule('b', ['a']).value('bValue', 'from b');
    const a = getModule('a');
    const injector = createInjector([a]);
    expect(injector.get('aValue')).toBe('from a');
    expect(injector.get('bValue')).toBe('from b');
  });

  it('loads multiple root modules with overlapping dep graphs', () => {
    createModule('common', []).value('common', 'shared');
    const featA = createModule('featA', ['common']).value('a', 1);
    const featB = createModule('featB', ['common']).value('b', 2);
    const injector = createInjector([featA, featB]);
    expect(injector.get('common')).toBe('shared');
    expect(injector.get('a')).toBe(1);
    expect(injector.get('b')).toBe(2);
  });
});

describe('createInjector (factories)', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('invokes a factory with no dependencies and returns its result', () => {
    const mod = createModule('app', []).factory('greeting', [() => 'hello']);
    const injector = createInjector([mod]);
    expect(injector.get('greeting')).toBe('hello');
  });

  it('invokes a $inject-annotated factory function', () => {
    function makeGreeting() {
      return 'hello';
    }
    makeGreeting.$inject = [] as string[];
    const mod = createModule('app', []).factory('greeting', makeGreeting);
    const injector = createInjector([mod]);
    expect(injector.get('greeting')).toBe('hello');
  });

  it('invokes a factory with a value dependency (array-style)', () => {
    const mod = createModule('app', [])
      .value('name', 'World')
      .factory('greeting', ['name', (name: string) => `hello ${name}`]);
    const injector = createInjector([mod]);
    expect(injector.get('greeting')).toBe('hello World');
  });

  it('invokes a factory with a value dependency ($inject-annotated)', () => {
    function makeGreeting(name: string) {
      return `hello ${name}`;
    }
    makeGreeting.$inject = ['name'];
    const mod = createModule('app', []).value('name', 'World').factory('greeting', makeGreeting);
    const injector = createInjector([mod]);
    expect(injector.get('greeting')).toBe('hello World');
  });

  it('invokes a factory with multiple dependencies', () => {
    const mod = createModule('app', [])
      .value('first', 'Jane')
      .value('last', 'Doe')
      .factory('fullName', ['first', 'last', (f: string, l: string) => `${f} ${l}`]);
    const injector = createInjector([mod]);
    expect(injector.get('fullName')).toBe('Jane Doe');
  });

  it('invokes a factory that depends on another factory', () => {
    const mod = createModule('app', [])
      .factory('dep', [() => 'dep-value'])
      .factory('consumer', ['dep', (d: string) => `consumer(${d})`]);
    const injector = createInjector([mod]);
    expect(injector.get('consumer')).toBe('consumer(dep-value)');
  });

  it('caches factory result (singleton) — invokes only once', () => {
    const factoryFn = vi.fn(() => ({ id: Math.random() }));
    const mod = createModule('app', []).factory('svc', [factoryFn]);
    const injector = createInjector([mod]);
    const first = injector.get('svc');
    const second = injector.get('svc');
    expect(first).toBe(second);
    expect(factoryFn).toHaveBeenCalledTimes(1);
  });

  it('does not invoke factory at load time (lazy)', () => {
    const factoryFn = vi.fn(() => 'value');
    const mod = createModule('app', []).factory('svc', [factoryFn]);
    createInjector([mod]);
    expect(factoryFn).not.toHaveBeenCalled();
  });

  it('invokes factory only on first `get` call', () => {
    const factoryFn = vi.fn(() => 'value');
    const mod = createModule('app', []).factory('svc', [factoryFn]);
    const injector = createInjector([mod]);
    expect(factoryFn).not.toHaveBeenCalled();
    injector.get('svc');
    expect(factoryFn).toHaveBeenCalledTimes(1);
  });

  it('`injector.has` returns true for a registered factory (before and after invocation)', () => {
    const mod = createModule('app', []).factory('svc', [() => 'value']);
    const injector = createInjector([mod]);
    expect(injector.has('svc')).toBe(true);
    injector.get('svc');
    expect(injector.has('svc')).toBe(true);
  });

  it('throws "Unknown provider" when get is called for an unregistered factory', () => {
    const injector = createInjector([]);
    expect(() => injector.get('nonexistent' as string)).toThrow('Unknown provider: nonexistent');
  });

  it('factory from a dep module is resolved when the dep module is loaded via requires', () => {
    createModule('common', []).factory('logger', [() => ({ log: () => undefined })]);
    const app = createModule('app', ['common']).value('apiUrl', 'https://example.com');
    const injector = createInjector([app]);
    const logger = injector.get<{ log: () => void }>('logger');
    expect(logger).toBeDefined();
    expect(logger.log).toBeInstanceOf(Function);
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
    const m = createModule('app', [])
      .value('apiUrl', 'https://example.com')
      .value('timeout', 30)
      .constant('MAX', 5);
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
      .factory<'greeter', Greeter>('greeter', [
        'name',
        (name: string): Greeter => ({ hello: () => `hi ${name}` }),
      ]);
    const injector = createInjector([mod]);
    expectTypeOf(injector.get('name')).toEqualTypeOf<string>();
    expectTypeOf(injector.get('PREFIX')).toEqualTypeOf<string>();
    expectTypeOf(injector.get('greeter')).toEqualTypeOf<Greeter>();
  });

  it('factories from multiple modules merge into the injector type', () => {
    type Clock = { now: () => number };
    type Random = { next: () => number };
    const core = createModule('core', []).factory<'clock', Clock>('clock', [
      () => ({ now: () => Date.now() }),
    ]);
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
