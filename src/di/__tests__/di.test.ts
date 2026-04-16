import { describe, it, expect, expectTypeOf, beforeEach, vi } from 'vitest';
import { Module, createModule, getModule, resetRegistry } from '@di/module';
import { createInjector } from '@di/injector';

describe('dependency injection', () => {
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

      it('the returned module has an empty $$invokeQueue', () => {
        const mod = createModule('app', []);
        expect(mod.$$invokeQueue.length).toBe(0);
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

    it('pushes [value, name, value] to the $$invokeQueue', () => {
      const mod = createModule('app', []);
      mod.value('apiUrl', 'https://example.com');
      expect(mod.$$invokeQueue[0]).toEqual(['value', 'apiUrl', 'https://example.com']);
    });

    it('returns the same module instance (for chaining)', () => {
      const mod = createModule('app', []);
      const result = mod.value('x', 1);
      expect(result).toBe(mod);
    });

    it('supports chaining multiple value calls', () => {
      const mod = createModule('app', []).value('a', 1).value('b', 2).value('c', 3);
      expect(mod.$$invokeQueue.length).toBe(3);
      expect(mod.$$invokeQueue[0]).toEqual(['value', 'a', 1]);
      expect(mod.$$invokeQueue[1]).toEqual(['value', 'b', 2]);
      expect(mod.$$invokeQueue[2]).toEqual(['value', 'c', 3]);
    });

    it('accepts a string value', () => {
      const mod = createModule('app', []).value('s', 'hello');
      expect(mod.$$invokeQueue[0]).toEqual(['value', 's', 'hello']);
    });

    it('accepts a number value', () => {
      const mod = createModule('app', []).value('n', 42);
      expect(mod.$$invokeQueue[0]).toEqual(['value', 'n', 42]);
    });

    it('accepts a boolean value', () => {
      const mod = createModule('app', []).value('b', true);
      expect(mod.$$invokeQueue[0]).toEqual(['value', 'b', true]);
    });

    it('accepts an object value (preserving reference identity)', () => {
      const obj = { key: 'value' };
      const mod = createModule('app', []).value('o', obj);
      const entry = mod.$$invokeQueue[0];
      expect(entry).toEqual(['value', 'o', obj]);
      expect(entry).toBeDefined();
      if (entry !== undefined) {
        expect(entry[2]).toBe(obj);
      }
    });

    it('accepts an array value (preserving reference identity)', () => {
      const arr = [1, 2, 3];
      const mod = createModule('app', []).value('a', arr);
      const entry = mod.$$invokeQueue[0];
      expect(entry).toEqual(['value', 'a', arr]);
      expect(entry).toBeDefined();
      if (entry !== undefined) {
        expect(entry[2]).toBe(arr);
      }
    });

    it('accepts a null value', () => {
      const mod = createModule('app', []).value('nully', null);
      expect(mod.$$invokeQueue[0]).toEqual(['value', 'nully', null]);
    });

    it('accepts an undefined value', () => {
      const mod = createModule('app', []).value('undef', undefined);
      expect(mod.$$invokeQueue[0]).toEqual(['value', 'undef', undefined]);
    });

    it('replaces an existing value when the same name is registered twice (later wins at injector drain)', () => {
      const mod = createModule('app', []).value('x', 1).value('x', 2);
      expect(mod.$$invokeQueue.length).toBe(2);
      expect(mod.$$invokeQueue[0]).toEqual(['value', 'x', 1]);
      expect(mod.$$invokeQueue[1]).toEqual(['value', 'x', 2]);

      const injector = createInjector([mod]);
      expect(injector.get('x')).toBe(2);
    });
  });

  describe('Module.constant', () => {
    beforeEach(() => {
      resetRegistry();
    });

    it('pushes [constant, name, value] to the $$invokeQueue', () => {
      const mod = createModule('app', []);
      mod.constant('MAX', 100);
      expect(mod.$$invokeQueue[0]).toEqual(['constant', 'MAX', 100]);
    });

    it('returns the same module instance (for chaining)', () => {
      const mod = createModule('app', []);
      const result = mod.constant('MAX', 100);
      expect(result).toBe(mod);
    });

    it('supports chaining with value', () => {
      const mod = createModule('app', []).value('a', 1).constant('MAX', 5).value('b', 2);
      expect(mod.$$invokeQueue.length).toBe(3);
      expect(mod.$$invokeQueue[0]).toEqual(['value', 'a', 1]);
      expect(mod.$$invokeQueue[1]).toEqual(['constant', 'MAX', 5]);
      expect(mod.$$invokeQueue[2]).toEqual(['value', 'b', 2]);
    });
  });

  describe('Module.factory', () => {
    beforeEach(() => {
      resetRegistry();
    });

    it('pushes [factory, name, invokable] to $$invokeQueue (array-style)', () => {
      const invokable = ['dep', (dep: unknown) => ({ dep })] as const;
      const mod = createModule('app', []).factory('myService', invokable);
      expect(mod.$$invokeQueue).toHaveLength(1);
      const entry = mod.$$invokeQueue[0];
      expect(entry?.[0]).toBe('factory');
      expect(entry?.[1]).toBe('myService');
      expect(entry?.[2]).toBe(invokable);
    });

    it('pushes [factory, name, invokable] to $$invokeQueue ($inject-annotated)', () => {
      function makeService(dep: unknown) {
        return { dep };
      }
      makeService.$inject = ['dep'];
      const mod = createModule('app', []).factory('myService', makeService);
      expect(mod.$$invokeQueue).toHaveLength(1);
      const entry = mod.$$invokeQueue[0];
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
      expect(mod.$$invokeQueue).toHaveLength(3);
      expect(mod.$$invokeQueue[0]?.[0]).toBe('value');
      expect(mod.$$invokeQueue[1]?.[0]).toBe('constant');
      expect(mod.$$invokeQueue[2]?.[0]).toBe('factory');
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

  describe('createInjector (circular dependency detection)', () => {
    beforeEach(() => {
      resetRegistry();
    });

    it('throws when a factory depends on itself directly (A -> A)', () => {
      const mod = createModule('app', []).factory('A', ['A', (a: unknown) => a]);
      const injector = createInjector([mod]);
      expect(() => injector.get('A')).toThrow('Circular dependency: A <- A');
    });

    it('throws on a 2-level cycle (A -> B -> A)', () => {
      const mod = createModule('app', [])
        .factory('A', ['B', (b: unknown) => b])
        .factory('B', ['A', (a: unknown) => a]);
      const injector = createInjector([mod]);
      expect(() => injector.get('A')).toThrow('Circular dependency: A <- B <- A');
    });

    it('throws on a 3-level cycle (A -> B -> C -> A)', () => {
      const mod = createModule('app', [])
        .factory('A', ['B', (b: unknown) => b])
        .factory('B', ['C', (c: unknown) => c])
        .factory('C', ['A', (a: unknown) => a]);
      const injector = createInjector([mod]);
      expect(() => injector.get('A')).toThrow('Circular dependency: A <- B <- C <- A');
    });

    it('throws on a cycle detected from a non-root entry point', () => {
      const mod = createModule('app', [])
        .factory('A', ['B', (b: unknown) => b])
        .factory('B', ['C', (c: unknown) => c])
        .factory('C', ['B', (b: unknown) => b]); // B and C form a cycle
      const injector = createInjector([mod]);
      // Starting from A pulls in B which tries to pull in C which tries to pull in B.
      // The full resolution path is retained; the cycle is at the tail.
      expect(() => injector.get('A')).toThrow('Circular dependency: A <- B <- C <- B');
    });

    it('still resolves non-cyclic services when an unrelated cycle exists in the module', () => {
      const mod = createModule('app', [])
        .value('safe', 'ok')
        .factory('A', ['B', (b: unknown) => b])
        .factory('B', ['A', (a: unknown) => a]);
      const injector = createInjector([mod]);
      // The safe value is accessible
      expect(injector.get('safe')).toBe('ok');
      // Touching the cycle still throws
      expect(() => injector.get('A')).toThrow(/Circular dependency/);
    });

    it('error message includes the full dependency chain', () => {
      const mod = createModule('app', [])
        .factory('A', ['B', (b: unknown) => b])
        .factory('B', ['C', (c: unknown) => c])
        .factory('C', ['A', (a: unknown) => a]);
      const injector = createInjector([mod]);
      try {
        injector.get('A');
        expect.fail('expected injector.get to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('Circular dependency:');
        expect((err as Error).message).toContain('A');
        expect((err as Error).message).toContain('B');
        expect((err as Error).message).toContain('C');
      }
    });

    it('detects a cycle when invoke triggers the resolution', () => {
      const mod = createModule('app', [])
        .factory('A', ['B', (b: unknown) => b])
        .factory('B', ['A', (a: unknown) => a]);
      const injector = createInjector([mod]);
      expect(() => injector.invoke(['A', (a: unknown) => a])).toThrow(/Circular dependency/);
    });

    it('does not leak the resolution path after a cycle error', () => {
      const mod = createModule('app', [])
        .value('safe', 'ok')
        .factory('A', ['B', (b: unknown) => b])
        .factory('B', ['A', (a: unknown) => a]);
      const injector = createInjector([mod]);
      // First call throws
      expect(() => injector.get('A')).toThrow(/Circular dependency/);
      // Subsequent call for an unrelated service still works
      expect(injector.get('safe')).toBe('ok');
    });
  });

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

  describe('typed factory DI', () => {
    beforeEach(() => {
      resetRegistry();
    });

    it('array-style typed factory infers callback param types from the registry', () => {
      const mod = createModule('app', [])
        .value('name', 'Jane')
        .value('age', 30)
        .factory('greet', [
          'name',
          'age',
          (name, age) => {
            expectTypeOf(name).toEqualTypeOf<string>();
            expectTypeOf(age).toEqualTypeOf<number>();
            return `${name} is ${String(age)}`;
          },
        ]);
      const injector = createInjector([mod]);
      expect(injector.get('greet')).toBe('Jane is 30');
      expectTypeOf(injector.get('greet')).toEqualTypeOf<string>();
    });

    it('empty-deps array-style factory still compiles and types the return', () => {
      const mod = createModule('app', []).factory('constant', [() => 42]);
      const injector = createInjector([mod]);
      expectTypeOf(injector.get('constant')).toEqualTypeOf<number>();
      expect(injector.get('constant')).toBe(42);
    });

    it('$inject-annotated factory with readonly literal tuple types callback params', () => {
      function makeGreeting(name: string): string {
        return `hi ${name}`;
      }
      makeGreeting.$inject = ['name'] as const;
      const mod = createModule('app', []).value('name', 'World').factory('greeting', makeGreeting);
      const injector = createInjector([mod]);
      expect(injector.get('greeting')).toBe('hi World');
      expectTypeOf(injector.get('greeting')).toEqualTypeOf<string>();
    });
  });

  describe('spec 008 — advanced recipes & lifecycle', () => {
    describe('Module.service', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('pushes [service, name, invokable] to $$invokeQueue (constructor form)', () => {
        class UserService {
          kind = 'user';
        }
        const mod = createModule('app', []).service('userService', UserService);
        expect(mod.$$invokeQueue).toHaveLength(1);
        const entry = mod.$$invokeQueue[0];
        expect(entry?.[0]).toBe('service');
        expect(entry?.[1]).toBe('userService');
        expect(entry?.[2]).toBe(UserService);
      });

      it('pushes [service, name, invokable] to $$invokeQueue (array-style form)', () => {
        class UserService {
          constructor(public name: string) {}
        }
        const invokable = ['name', UserService] as const;
        const mod = createModule('app', []).value('name', 'Jane').service('userService', invokable);
        // The first entry is the value, the second is the service
        expect(mod.$$invokeQueue).toHaveLength(2);
        const entry = mod.$$invokeQueue[1];
        expect(entry?.[0]).toBe('service');
        expect(entry?.[1]).toBe('userService');
        expect(entry?.[2]).toBe(invokable);
      });

      it('returns the same module instance (for chaining)', () => {
        class SvcA {
          tag = 'a';
        }
        const mod = createModule('app', []);
        const chained = mod.service('a', SvcA);
        expect(chained).toBe(mod);
      });

      it('supports chaining with value, constant, and factory', () => {
        class SvcA {
          tag = 'a';
        }
        const mod = createModule('app', [])
          .value('v', 1)
          .constant('c', 2)
          .factory('f', [() => 'result'])
          .service('a', SvcA);
        expect(mod.$$invokeQueue).toHaveLength(4);
        expect(mod.$$invokeQueue[3]?.[0]).toBe('service');
      });
    });

    describe('createInjector (service recipe)', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('instantiates a service with no dependencies via `new`', () => {
        class Counter {
          static readonly $inject = [] as const;
          value = 0;
          increment() {
            this.value++;
          }
        }
        const mod = createModule('app', []).service('counter', Counter);
        const injector = createInjector([mod]);
        const counter = injector.get('counter');
        expect(counter).toBeInstanceOf(Counter);
      });

      it('resolves the instance as a singleton (same reference)', () => {
        class Counter {
          static readonly $inject = [] as const;
          value = 0;
        }
        const mod = createModule('app', []).service('counter', Counter);
        const injector = createInjector([mod]);
        const a = injector.get('counter');
        const b = injector.get('counter');
        expect(a).toBe(b);
      });

      it('resolves $inject-annotated constructor dependencies', () => {
        class Logger {
          static readonly $inject = [] as const;
          log(msg: string) {
            return `LOG: ${msg}`;
          }
        }
        class Service {
          static readonly $inject = ['logger'] as const;
          constructor(public logger: Logger) {}
          greet() {
            return this.logger.log('hello');
          }
        }

        const mod = createModule('app', []).service('logger', Logger).service('service', Service);
        const injector = createInjector([mod]);
        const svc = injector.get('service');
        expect(svc.greet()).toBe('LOG: hello');
      });

      it('resolves array-style annotated constructor dependencies', () => {
        class Config {
          constructor(public defaults: Record<string, unknown>) {}
        }
        const defaultsValue = { retries: 3 };
        const mod = createModule('app', []).value('defaults', defaultsValue).service('config', ['defaults', Config]);
        const injector = createInjector([mod]);
        const config = injector.get('config');
        expect(config).toBeInstanceOf(Config);
        expect(config.defaults).toBe(defaultsValue);
      });

      it('passes resolved dependencies as positional constructor args in order', () => {
        class Service {
          static readonly $inject = ['a', 'b', 'c'] as const;
          constructor(
            public a: string,
            public b: number,
            public c: boolean,
          ) {}
        }

        const mod = createModule('app', [])
          .value('a', 'hello')
          .value('b', 42)
          .value('c', true)
          .service('service', Service);
        const injector = createInjector([mod]);
        const svc = injector.get('service');
        expect(svc.a).toBe('hello');
        expect(svc.b).toBe(42);
        expect(svc.c).toBe(true);
      });

      it('the returned instance satisfies `instanceof` the original constructor', () => {
        class UserService {
          static readonly $inject = [] as const;
          kind = 'user';
        }
        const mod = createModule('app', []).service('userService', UserService);
        const injector = createInjector([mod]);
        const svc = injector.get('userService');
        expect(svc).toBeInstanceOf(UserService);
      });

      it('services can depend on factories, values, and constants', () => {
        class Service {
          static readonly $inject = ['url', 'max'] as const;
          constructor(
            public url: string,
            public max: number,
          ) {}
        }

        const mod = createModule('app', []).value('url', 'https://...').constant('max', 5).service('service', Service);
        const injector = createInjector([mod]);
        const svc = injector.get<Service>('service');
        expect(svc.url).toBe('https://...');
        expect(svc.max).toBe(5);
      });

      it('injector.has returns true for a registered service (before and after instantiation)', () => {
        class Svc {
          static readonly $inject = [] as const;
          tag = 'svc';
        }
        const mod = createModule('app', []).service('svc', Svc);
        const injector = createInjector([mod]);
        expect(injector.has('svc')).toBe(true);
        injector.get('svc');
        expect(injector.has('svc')).toBe(true);
      });

      it('does not instantiate the service at load time (lazy)', () => {
        let constructed = 0;
        // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- constructor side-effect is load-bearing to the test
        class Svc {
          constructor() {
            constructed++;
          }
        }
        const mod = createModule('app', []).service('svc', Svc);
        createInjector([mod]);
        expect(constructed).toBe(0);
      });

      it('detects a cycle involving services (service -> service -> service)', () => {
        class A {
          static readonly $inject = ['b'] as const;
          constructor(public b: unknown) {}
        }

        class B {
          static readonly $inject = ['a'] as const;
          constructor(public a: unknown) {}
        }

        const mod = createModule('app', []).service('a', A).service('b', B);
        const injector = createInjector([mod]);
        expect(() => injector.get('a')).toThrow(/Circular dependency/);
      });
    });

    describe('type safety — service recipe', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('constructor-only form infers InstanceType<Ctor> on injector.get', () => {
        class UserService {
          static readonly $inject = [] as const;
          kind = 'user' as const;
          greet(): string {
            return 'hello';
          }
        }

        const mod = createModule('app', []).service('userService', UserService);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('userService')).toEqualTypeOf<UserService>();
      });

      it('array-style form infers InstanceType<Ctor> on injector.get', () => {
        class Config {
          readonly defaults: Record<string, unknown>;
          constructor(defaults: Record<string, unknown>) {
            this.defaults = defaults;
          }
        }

        const mod = createModule('app', []).value('defaults', { retries: 3 }).service('config', ['defaults', Config]);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('config')).toEqualTypeOf<Config>();
      });

      it('array-style deps are typed from the module Registry', () => {
        class Service {
          readonly name: string;
          readonly age: number;
          constructor(name: string, age: number) {
            this.name = name;
            this.age = age;
          }
        }

        const mod = createModule('app', [])
          .value('name', 'Jane')
          .value('age', 30)
          .service('service', ['name', 'age', Service]);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('service')).toEqualTypeOf<Service>();
      });

      it('chained service calls widen the Registry correctly', () => {
        class Logger {
          static readonly $inject = [] as const;
          kind = 'logger' as const;
          log(msg: string): void {
            void msg;
          }
        }

        class Cache {
          static readonly $inject = [] as const;
          kind = 'cache' as const;
          get(key: string): string | undefined {
            void key;
            return undefined;
          }
        }

        const mod = createModule('app', []).service('logger', Logger).service('cache', Cache);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('logger')).toEqualTypeOf<Logger>();
        expectTypeOf(injector.get('cache')).toEqualTypeOf<Cache>();
      });

      it('service merges alongside value, constant, and factory in the same Registry', () => {
        class Greeter {
          static readonly $inject = [] as const;
          kind = 'greeter' as const;
          hello(): string {
            return 'hi';
          }
        }

        const mod = createModule('app', [])
          .value('name', 'Jane')
          .constant('MAX', 5)
          .factory<'logger', { log: (m: string) => void }>('logger', [
            () => ({
              log: (m: string): undefined => {
                void m;
                return undefined;
              },
            }),
          ])
          .service('greeter', Greeter);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('name')).toEqualTypeOf<string>();
        expectTypeOf(injector.get('MAX')).toEqualTypeOf<number>();
        expectTypeOf(injector.get('logger')).toEqualTypeOf<{ log: (m: string) => void }>();
        expectTypeOf(injector.get('greeter')).toEqualTypeOf<Greeter>();
      });

      it('services from multiple modules merge into the injector type', () => {
        class ServiceA {
          static readonly $inject = [] as const;
          kind = 'a' as const;
        }

        class ServiceB {
          static readonly $inject = [] as const;
          kind = 'b' as const;
        }

        const modA = createModule('a', []).service('serviceA', ServiceA);
        const modB = createModule('b', []).service('serviceB', ServiceB);
        const injector = createInjector([modA, modB]);
        expectTypeOf(injector.get('serviceA')).toEqualTypeOf<ServiceA>();
        expectTypeOf(injector.get('serviceB')).toEqualTypeOf<ServiceB>();
      });

      it('typed get rejects unknown keys for service-only registries', () => {
        class UserService {
          static readonly $inject = [] as const;
          kind = 'user' as const;
        }

        const mod = createModule('app', []).service('userService', UserService);
        const injector = createInjector([mod]);

        // Isolate the typed overload so overload resolution doesn't fall through
        // to the escape hatch. See spec 007's type-safety tests for the same trick.
        type Registry = { userService: UserService };
        type TypedGet = <K extends keyof Registry>(name: K) => Registry[K];
        const typedGet: TypedGet = injector.get.bind(injector);

        // Positive: registered key compiles.
        expectTypeOf(typedGet('userService')).toEqualTypeOf<UserService>();

        // Negative: unknown key is a compile error on the typed overload.
        try {
          // @ts-expect-error -- 'unknown' is not in the typed Registry
          typedGet('unknown');
        } catch {
          /* expected: runtime throws on unregistered name */
        }
      });
    });

    describe('Module.provider', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('pushes [provider, name, source] to $$invokeQueue (Form 1: constructor)', () => {
        function LoggerProvider(this: { $get: () => unknown }) {
          this.$get = (): { log: (m: string) => undefined } => ({
            log: () => undefined,
          });
        }
        const mod = createModule('app', []).provider('logger', LoggerProvider);
        expect(mod.$$invokeQueue).toHaveLength(1);
        const entry = mod.$$invokeQueue[0];
        expect(entry?.[0]).toBe('provider');
        expect(entry?.[1]).toBe('logger');
        expect(entry?.[2]).toBe(LoggerProvider);
      });

      it('pushes [provider, name, source] to $$invokeQueue (Form 2: object literal)', () => {
        const providerObj = {
          $get: (): { log: (m: string) => undefined } => ({
            log: () => undefined,
          }),
        };
        const mod = createModule('app', []).provider('logger', providerObj);
        expect(mod.$$invokeQueue).toHaveLength(1);
        const entry = mod.$$invokeQueue[0];
        expect(entry?.[0]).toBe('provider');
        expect(entry?.[1]).toBe('logger');
        expect(entry?.[2]).toBe(providerObj);
      });

      it('pushes [provider, name, source] to $$invokeQueue (Form 3: array-style)', () => {
        function LoggerProvider(this: { level: string; $get: () => unknown }, level: string) {
          this.level = level;
          this.$get = (): { level: string } => ({ level: this.level });
        }
        const providerArr = ['defaultLevel', LoggerProvider] as const;
        const mod = createModule('app', []).constant('defaultLevel', 'info').provider('logger', providerArr);
        expect(mod.$$invokeQueue).toHaveLength(2);
        const entry = mod.$$invokeQueue[1];
        expect(entry?.[0]).toBe('provider');
        expect(entry?.[1]).toBe('logger');
        expect(entry?.[2]).toBe(providerArr);
      });

      it('returns the same module instance (for chaining)', () => {
        function Prov(this: { $get: () => unknown }) {
          this.$get = (): string => 'value';
        }
        const mod = createModule('app', []);
        const chained = mod.provider('p', Prov);
        expect(chained).toBe(mod);
      });

      it('supports chaining with value, constant, factory, and service', () => {
        function Prov(this: { $get: () => unknown }) {
          this.$get = (): string => 'provValue';
        }
        const mod = createModule('app', [])
          .value('v', 1)
          .constant('c', 2)
          .factory('f', [() => 'factoryValue'])
          .provider('p', Prov);
        expect(mod.$$invokeQueue).toHaveLength(4);
        expect(mod.$$invokeQueue[3]?.[0]).toBe('provider');
      });
    });

    describe('createInjector (provider recipe)', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('instantiates Form 1 (constructor) and resolves service via $get', () => {
        function LoggerProvider(this: { level: string; $get: readonly [() => { log: (m: string) => string }] }) {
          this.level = 'info';
          const level = this.level;
          this.$get = [
            (): { log: (m: string) => string } => ({
              log: (m: string) => `[${level}] ${m}`,
            }),
          ] as const;
        }
        const mod = createModule('app', []).provider('logger', LoggerProvider);
        const injector = createInjector([mod]);
        const logger = injector.get<{ log: (m: string) => string }>('logger');
        expect(logger.log('hello')).toBe('[info] hello');
      });

      it('instantiates Form 2 (object literal) and resolves service via $get', () => {
        const providerObj = {
          level: 'debug',
          $get: [
            function (this: { level: string }): { log: (m: string) => string } {
              const level = this.level;
              return { log: (m: string) => `[${level}] ${m}` };
            },
          ] as const,
        };
        const mod = createModule('app', []).provider('logger', providerObj);
        const injector = createInjector([mod]);
        const logger = injector.get<{ log: (m: string) => string }>('logger');
        expect(logger.log('hi')).toBe('[debug] hi');
      });

      it('instantiates Form 3 (array-style with config-phase deps) and resolves service via $get', () => {
        function LoggerProvider(
          this: {
            level: string;
            $get: readonly [() => { log: (m: string) => string }];
          },
          defaultLevel: string,
        ) {
          this.level = defaultLevel;
          const level = this.level;
          this.$get = [
            (): { log: (m: string) => string } => ({
              log: (m: string) => `[${level}] ${m}`,
            }),
          ] as const;
        }
        const mod = createModule('app', [])
          .constant('defaultLevel', 'warn')
          .provider('logger', ['defaultLevel', LoggerProvider]);
        const injector = createInjector([mod]);
        const logger = injector.get<{ log: (m: string) => string }>('logger');
        expect(logger.log('oops')).toBe('[warn] oops');
      });

      it('service produced by a provider is a singleton', () => {
        let getCallCount = 0;
        function CounterProvider(this: { $get: readonly [() => { count: number }] }) {
          this.$get = [
            (): { count: number } => {
              getCallCount++;
              return { count: 0 };
            },
          ] as const;
        }
        const mod = createModule('app', []).provider('counter', CounterProvider);
        const injector = createInjector([mod]);
        const a = injector.get('counter');
        const b = injector.get('counter');
        expect(a).toBe(b);
        expect(getCallCount).toBe(1);
      });

      it('$get is NOT invoked at load time (lazy resolution)', () => {
        let getCalls = 0;
        function LazyProvider(this: { $get: readonly [() => string] }) {
          this.$get = [
            (): string => {
              getCalls++;
              return 'value';
            },
          ] as const;
        }
        const mod = createModule('app', []).provider('lazy', LazyProvider);
        createInjector([mod]);
        expect(getCalls).toBe(0);
      });

      it('$get can declare its own run-phase dependencies via array-style', () => {
        function GreeterProvider(this: { $get: readonly ['name', (name: string) => { greet: () => string }] }) {
          this.$get = ['name', (name: string) => ({ greet: () => `hello ${name}` })] as const;
        }
        const mod = createModule('app', []).value('name', 'Jane').provider('greeter', GreeterProvider);
        const injector = createInjector([mod]);
        const greeter = injector.get<{ greet: () => string }>('greeter');
        expect(greeter.greet()).toBe('hello Jane');
      });

      it('$get is invoked with `this` bound to the provider instance', () => {
        const capturedInstances: unknown[] = [];
        class ConfigurableProvider {
          prefix = 'default';
          $get = [
            function (this: { prefix: string }): { format: (m: string) => string } {
              // Verify `this` is the provider instance at call time by stashing
              // the receiver; we later assert it matches the sole instance.
              capturedInstances.push(this);
              const capturedPrefix = this.prefix;
              return { format: (m: string) => `${capturedPrefix}: ${m}` };
            },
          ] as const;
          setPrefix(p: string): void {
            this.prefix = p;
          }
        }
        const mod = createModule('app', []).provider('configurable', ConfigurableProvider);
        const injector = createInjector([mod]);
        const svc = injector.get<{ format: (m: string) => string }>('configurable');
        expect(svc.format('msg')).toBe('default: msg');
        expect(capturedInstances).toHaveLength(1);
        expect(capturedInstances[0]).toBeInstanceOf(ConfigurableProvider);
      });

      it('throws when the provider constructor does not set a $get method', () => {
        function BrokenProvider(this: { foo: string }) {
          this.foo = 'bar';
          // deliberately no $get
        }
        const mod = createModule('app', []).provider('broken', BrokenProvider);
        expect(() => createInjector([mod])).toThrow(/Provider "broken" has no \$get method/);
      });

      it('throws when the provider source is neither a function, object, nor array', () => {
        const mod = createModule('app', []).provider('bad', 42 as unknown);
        expect(() => createInjector([mod])).toThrow(
          /Expected provider for "bad" to be a function, array, or object with \$get/,
        );
      });

      it('injector.has returns true for a provider-backed service (before and after resolution)', () => {
        function Prov(this: { $get: readonly [() => string] }) {
          this.$get = [(): string => 'value'] as const;
        }
        const mod = createModule('app', []).provider('svc', Prov);
        const injector = createInjector([mod]);
        expect(injector.has('svc')).toBe(true);
        injector.get('svc');
        expect(injector.has('svc')).toBe(true);
      });

      it('detects a cycle between two providers via their $get deps', () => {
        function AProvider(this: { $get: readonly ['b', (b: unknown) => unknown] }) {
          this.$get = ['b', (b: unknown) => b] as const;
        }
        function BProvider(this: { $get: readonly ['a', (a: unknown) => unknown] }) {
          this.$get = ['a', (a: unknown) => a] as const;
        }
        const mod = createModule('app', []).provider('a', AProvider).provider('b', BProvider);
        const injector = createInjector([mod]);
        expect(() => injector.get('a')).toThrow(/Circular dependency/);
      });
    });

    describe('type safety — provider recipe', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('Form 1 (constructor) infers $get return type on injector.get', () => {
        class LoggerProvider {
          $get = [() => ({ log: (m: string): void => void m })] as const;
        }

        const mod = createModule('app', []).provider('logger', LoggerProvider);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('logger')).toEqualTypeOf<{ log: (m: string) => void }>();
      });

      it('Form 2 (object literal) infers $get return type on injector.get', () => {
        const providerObj = {
          level: 'info',
          $get: [() => ({ log: (m: string): void => void m })] as const,
        };

        const mod = createModule('app', []).provider('logger', providerObj);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('logger')).toEqualTypeOf<{ log: (m: string) => void }>();
      });

      it('Form 3 (array-style) types config-phase deps from ConfigRegistry', () => {
        class LoggerProvider {
          readonly level: string;
          $get = [() => ({ log: (m: string): void => void m })] as const;
          constructor(defaultLevel: string) {
            this.level = defaultLevel;
          }
        }

        const mod = createModule('app', [])
          .constant('defaultLevel', 'warn')
          .provider('logger', ['defaultLevel', LoggerProvider]);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('logger')).toEqualTypeOf<{ log: (m: string) => void }>();
      });

      it('provider widens Registry with the service type', () => {
        class GreeterProvider {
          $get = [() => ({ hello: (): string => 'hi' })] as const;
        }

        const mod = createModule('app', []).value('name', 'Jane').provider('greeter', GreeterProvider);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('name')).toEqualTypeOf<string>();
        expectTypeOf(injector.get('greeter')).toEqualTypeOf<{ hello: () => string }>();
      });

      it('providers from multiple modules merge into the injector type', () => {
        class ClockProvider {
          $get = [() => ({ now: (): number => Date.now() })] as const;
        }

        class RandomProvider {
          $get = [() => ({ next: (): number => Math.random() })] as const;
        }

        const core = createModule('core', []).provider('clock', ClockProvider);
        const rand = createModule('rand', []).provider('random', RandomProvider);
        const injector = createInjector([core, rand]);

        expectTypeOf(injector.get('clock')).toEqualTypeOf<{ now: () => number }>();
        expectTypeOf(injector.get('random')).toEqualTypeOf<{ next: () => number }>();
      });

      it('provider merges alongside value, constant, factory, and service', () => {
        class LoggerProvider {
          $get = [() => ({ log: (m: string): void => void m })] as const;
        }

        class Greeter {
          static readonly $inject = [] as const;
          kind = 'greeter' as const;
          hello(): string {
            return 'hi';
          }
        }

        const mod = createModule('app', [])
          .value('name', 'Jane')
          .constant('MAX', 5)
          .factory<'counter', { count: number }>('counter', [() => ({ count: 0 })])
          .service('greeter', Greeter)
          .provider('logger', LoggerProvider);
        const injector = createInjector([mod]);

        expectTypeOf(injector.get('name')).toEqualTypeOf<string>();
        expectTypeOf(injector.get('MAX')).toEqualTypeOf<number>();
        expectTypeOf(injector.get('counter')).toEqualTypeOf<{ count: number }>();
        expectTypeOf(injector.get('greeter')).toEqualTypeOf<Greeter>();
        expectTypeOf(injector.get('logger')).toEqualTypeOf<{ log: (m: string) => void }>();
      });

      it('Form 3 accepts registered config-phase deps at compile time', () => {
        class AProvider {
          $get = [(): string => 'a'] as const;
          constructor(defaultLevel: string) {
            void defaultLevel;
          }
        }

        // Positive: 'defaultLevel' is a registered constant and compiles via Form 3.
        const mod = createModule('app', []).constant('defaultLevel', 'warn').provider('a', ['defaultLevel', AProvider]);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('a')).toEqualTypeOf<string>();

        // Note: Typos in Form 3 dep names fall through to the untyped fallback
        // overload at compile time (same limitation as spec 007's typed factory).
        // Runtime validation catches the typo via `providerInjector.get` throwing
        // 'Unknown provider' — see the runtime tests above.
      });

      it('typed get rejects unknown keys for provider-backed registries', () => {
        class LoggerProvider {
          $get = [() => ({ log: (m: string): void => void m })] as const;
        }

        const mod = createModule('app', []).provider('logger', LoggerProvider);
        const injector = createInjector([mod]);

        // Isolate the typed overload so overload resolution doesn't fall through
        // to the escape hatch. See spec 007's type-safety tests for the same trick.
        type Registry = { logger: { log: (m: string) => void } };
        type TypedGet = <K extends keyof Registry>(name: K) => Registry[K];
        const typedGet: TypedGet = injector.get.bind(injector);

        // Positive: registered key compiles.
        expectTypeOf(typedGet('logger')).toEqualTypeOf<{ log: (m: string) => void }>();

        // Negative: unknown key is a compile error on the typed overload.
        try {
          // @ts-expect-error -- 'unknown' is not in the typed Registry
          typedGet('unknown');
        } catch {
          /* expected: runtime throws on unregistered name */
        }
      });
    });

    describe('Module.decorator', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('pushes [decorator, name, invokable] to $$invokeQueue', () => {
        const invokable = ['$delegate', ($delegate: unknown) => $delegate] as const;
        const mod = createModule('app', [])
          .value('logger', { log: (m: string) => void m })
          .decorator('logger', invokable);
        // Two entries: the value and the decorator
        expect(mod.$$invokeQueue).toHaveLength(2);
        const entry = mod.$$invokeQueue[1];
        expect(entry?.[0]).toBe('decorator');
        expect(entry?.[1]).toBe('logger');
        expect(entry?.[2]).toBe(invokable);
      });

      it('returns the same module instance (for chaining)', () => {
        const mod = createModule('app', []).value('logger', { log: (m: string) => void m });
        const chained = mod.decorator('logger', ['$delegate', ($delegate: unknown) => $delegate]);
        expect(chained).toBe(mod);
      });

      it('supports registering multiple decorators for the same service', () => {
        const mod = createModule('app', [])
          .value('logger', { log: (m: string) => void m })
          .decorator('logger', ['$delegate', ($delegate: unknown) => $delegate])
          .decorator('logger', ['$delegate', ($delegate: unknown) => $delegate]);
        expect(mod.$$invokeQueue).toHaveLength(3);
        expect(mod.$$invokeQueue[1]?.[0]).toBe('decorator');
        expect(mod.$$invokeQueue[2]?.[0]).toBe('decorator');
      });

      it('supports chaining with value, constant, factory, service, and provider', () => {
        const mod = createModule('app', [])
          .value('v', 1)
          .constant('c', 2)
          .factory('f', [() => 'factoryValue'])
          .decorator('v', ['$delegate', ($delegate: unknown) => $delegate]);
        expect(mod.$$invokeQueue).toHaveLength(4);
        expect(mod.$$invokeQueue[3]?.[0]).toBe('decorator');
      });
    });

    describe('createInjector (decorator recipe)', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('wraps a value service — decorator modifies the returned value', () => {
        type Logger = { log: (msg: string) => string; verbose?: (msg: string) => string };
        const mod = createModule('app', [])
          .value<'logger', Logger>('logger', {
            log: (msg: string) => `LOG: ${msg}`,
          })
          .decorator('logger', [
            '$delegate',
            ($delegate: Logger): Logger => ({
              ...$delegate,
              verbose: (msg: string) => `VERBOSE: ${msg}`,
            }),
          ]);
        const injector = createInjector([mod]);
        const logger = injector.get<Logger>('logger');
        expect(logger.log('hello')).toBe('LOG: hello');
        expect(logger.verbose?.('hi')).toBe('VERBOSE: hi');
      });

      it('wraps a factory service — decorator sees the factory output as $delegate', () => {
        type Greeter = { greet: () => string };
        const mod = createModule('app', [])
          .factory<'greeter', Greeter>('greeter', [() => ({ greet: () => 'hello' })])
          .decorator('greeter', [
            '$delegate',
            ($delegate: Greeter): Greeter => ({
              greet: () => `${$delegate.greet()}!`,
            }),
          ]);
        const injector = createInjector([mod]);
        expect(injector.get<Greeter>('greeter').greet()).toBe('hello!');
      });

      it('wraps a service recipe — decorator sees the class instance as $delegate', () => {
        class Counter {
          static readonly $inject = [] as const;
          value = 0;
          increment() {
            this.value++;
            return this.value;
          }
        }
        type CounterLike = { increment: () => number; reset?: () => void };
        const mod = createModule('app', [])
          .service('counter', Counter)
          .decorator('counter', [
            '$delegate',
            ($delegate: Counter): CounterLike => ({
              increment: () => $delegate.increment(),
              reset: () => {
                $delegate.value = 0;
              },
            }),
          ]);
        const injector = createInjector([mod]);
        const counter = injector.get<CounterLike>('counter');
        expect(counter.increment()).toBe(1);
        expect(counter.increment()).toBe(2);
        counter.reset?.();
        expect(counter.increment()).toBe(1);
      });

      it('wraps a provider-produced service — decorator sees the $get return as $delegate', () => {
        type Logger = { log: (msg: string) => string };
        class LoggerProvider {
          $get = [() => ({ log: (msg: string) => `provider: ${msg}` })] as const;
        }
        const mod = createModule('app', [])
          .provider('logger', LoggerProvider)
          .decorator('logger', [
            '$delegate',
            ($delegate: Logger): Logger => ({
              log: (msg: string) => `[DECORATED] ${$delegate.log(msg)}`,
            }),
          ]);
        const injector = createInjector([mod]);
        const logger = injector.get<Logger>('logger');
        expect(logger.log('hi')).toBe('[DECORATED] provider: hi');
      });

      it('chains multiple decorators in registration order', () => {
        type Greeter = { greet: () => string };
        const mod = createModule('app', [])
          .value<'greeter', Greeter>('greeter', {
            greet: () => 'hello',
          })
          .decorator('greeter', [
            '$delegate',
            ($delegate: Greeter): Greeter => ({
              greet: () => `${$delegate.greet()}-d1`,
            }),
          ])
          .decorator('greeter', [
            '$delegate',
            ($delegate: Greeter): Greeter => ({
              greet: () => `${$delegate.greet()}-d2`,
            }),
          ]);
        const injector = createInjector([mod]);
        // Applied in registration order: d1 wraps original, then d2 wraps d1
        expect(injector.get<Greeter>('greeter').greet()).toBe('hello-d1-d2');
      });

      it('decorator can inject additional deps alongside $delegate', () => {
        type Greeter = { greet: () => string };
        const mod = createModule('app', [])
          .value('name', 'Jane')
          .value<'greeter', Greeter>('greeter', {
            greet: () => 'hello',
          })
          .decorator('greeter', [
            '$delegate',
            'name',
            ($delegate: Greeter, name: string): Greeter => ({
              greet: () => `${$delegate.greet()} ${name}`,
            }),
          ]);
        const injector = createInjector([mod]);
        expect(injector.get<Greeter>('greeter').greet()).toBe('hello Jane');
      });

      it('decorated service is still a singleton — decoration runs once', () => {
        let decoratorCalls = 0;
        type Greeter = { greet: () => string };
        const mod = createModule('app', [])
          .value<'greeter', Greeter>('greeter', { greet: () => 'hello' })
          .decorator('greeter', [
            '$delegate',
            ($delegate: Greeter): Greeter => {
              decoratorCalls++;
              return { greet: () => `decorated: ${$delegate.greet()}` };
            },
          ]);
        const injector = createInjector([mod]);
        const a = injector.get<Greeter>('greeter');
        const b = injector.get<Greeter>('greeter');
        expect(a).toBe(b);
        expect(decoratorCalls).toBe(1);
      });

      it('throws Cannot decorate unknown service when the target is not registered', () => {
        const mod = createModule('app', []).decorator('missing', ['$delegate', ($delegate: unknown) => $delegate]);
        expect(() => createInjector([mod])).toThrow(/Cannot decorate unknown service: "missing"/);
      });

      it('throws Cannot decorate unknown service for a cross-module unknown target', () => {
        createModule('core', []).value('existing', 'yes');
        const app = createModule('app', ['core']).decorator('nonexistent', [
          '$delegate',
          ($delegate: unknown) => $delegate,
        ]);
        expect(() => createInjector([app])).toThrow(/Cannot decorate unknown service: "nonexistent"/);
      });

      it('decorator on a cross-module service works (module A has the value, module B decorates it)', () => {
        type Logger = { log: (msg: string) => string };
        createModule('core', []).value<'logger', Logger>('logger', {
          log: (msg: string) => `core: ${msg}`,
        });
        const app = createModule('app', ['core']).decorator('logger', [
          '$delegate',
          ($delegate: Logger): Logger => ({
            log: (msg: string) => `[APP] ${$delegate.log(msg)}`,
          }),
        ]);
        const injector = createInjector([getModule('core'), app]);
        expect(injector.get<Logger>('logger').log('hi')).toBe('[APP] core: hi');
      });

      it('detects a self-referential decorator cycle', () => {
        type Greeter = { greet: () => string };
        const mod = createModule('app', [])
          .value<'greeter', Greeter>('greeter', { greet: () => 'hello' })
          .decorator('greeter', [
            // Decorator depends on 'greeter' itself (beyond $delegate) — cycle
            '$delegate',
            'greeter',
            ($delegate: Greeter, self: Greeter): Greeter => ({
              greet: () => `${$delegate.greet()}-${self.greet()}`,
            }),
          ]);
        const injector = createInjector([mod]);
        expect(() => injector.get('greeter')).toThrow(/Circular dependency/);
      });
    });

    describe('type safety — decorator recipe', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('$delegate parameter is typed as Registry[K] (value service)', () => {
        type Logger = { log: (msg: string) => string };
        const mod = createModule('app', [])
          .value<'logger', Logger>('logger', { log: (msg: string) => msg })
          .decorator('logger', [
            '$delegate',
            ($delegate): Logger => {
              // $delegate must be inferred as Logger from Registry['logger'].
              expectTypeOf($delegate).toEqualTypeOf<Logger>();
              return { log: (msg: string) => `[wrapped] ${$delegate.log(msg)}` };
            },
          ]);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('logger')).toEqualTypeOf<Logger>();
      });

      it('$delegate parameter is typed as Registry[K] (service-recipe service)', () => {
        class Greeter {
          static readonly $inject = [] as const;
          hello(): string {
            return 'hi';
          }
        }

        const mod = createModule('app', [])
          .service('greeter', Greeter)
          .decorator('greeter', [
            '$delegate',
            ($delegate): Greeter => {
              expectTypeOf($delegate).toEqualTypeOf<Greeter>();
              return $delegate;
            },
          ]);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('greeter')).toEqualTypeOf<Greeter>();
      });

      it('decorator return type replaces the service type in the Registry', () => {
        type Logger = { log: (msg: string) => string };
        type RichLogger = Logger & { level: string };

        const mod = createModule('app', [])
          .value<'logger', Logger>('logger', { log: (msg: string) => msg })
          .decorator('logger', [
            '$delegate',
            ($delegate): RichLogger => ({
              log: (msg: string) => $delegate.log(msg),
              level: 'info',
            }),
          ]);
        const injector = createInjector([mod]);
        // The decorator widens `logger` from `Logger` to `RichLogger`.
        expectTypeOf(injector.get('logger')).toEqualTypeOf<RichLogger>();
      });

      it('chained decorators see the previous return type as $delegate', () => {
        type Logger = { log: (msg: string) => string };
        type Timestamped = Logger & { at: number };
        type Leveled = Timestamped & { level: string };

        const mod = createModule('app', [])
          .value<'logger', Logger>('logger', { log: (msg: string) => msg })
          .decorator('logger', [
            '$delegate',
            ($delegate): Timestamped => {
              expectTypeOf($delegate).toEqualTypeOf<Logger>();
              return { log: $delegate.log, at: 0 };
            },
          ])
          .decorator('logger', [
            '$delegate',
            ($delegate): Leveled => {
              // Second decorator sees the first decorator's return type.
              expectTypeOf($delegate).toEqualTypeOf<Timestamped>();
              return { ...$delegate, level: 'info' };
            },
          ]);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('logger')).toEqualTypeOf<Leveled>();
      });

      it('decorator accepts additional Registry-typed deps alongside $delegate', () => {
        type Logger = { log: (msg: string) => string };
        const mod = createModule('app', [])
          .value('prefix', '[APP]')
          .value<'logger', Logger>('logger', { log: (msg: string) => msg })
          .decorator('logger', [
            '$delegate',
            'prefix',
            ($delegate, prefix): Logger => {
              expectTypeOf($delegate).toEqualTypeOf<Logger>();
              expectTypeOf(prefix).toEqualTypeOf<string>();
              return { log: (msg: string) => `${prefix} ${$delegate.log(msg)}` };
            },
          ]);
        const injector = createInjector([mod]);
        expect(injector.get<Logger>('logger').log('hi')).toBe('[APP] hi');
      });

      it('decorating an unknown service name is a compile error', () => {
        type Logger = { log: (msg: string) => string };

        const base = createModule('app', []).value<'logger', Logger>('logger', {
          log: (msg: string) => msg,
        });

        // Isolate the typed overload so overload resolution doesn't fall
        // through to the untyped fallback. Same trick as spec 007/008 above.
        type Registry = { logger: Logger };
        type TypedDecorator = <K extends keyof Registry>(
          name: K,
          invokable: readonly ['$delegate', (delegate: Registry[K]) => Registry[K]],
        ) => unknown;
        const typedDecorator: TypedDecorator = base.decorator.bind(base) as TypedDecorator;

        // Positive: known key compiles.
        typedDecorator('logger', ['$delegate', ($delegate): Logger => $delegate]);

        // Negative: unknown key is a compile error on the typed overload.
        // @ts-expect-error -- 'unknown' is not a registered service name
        typedDecorator('unknown', ['$delegate', ($delegate: Logger): Logger => $delegate]);
      });
    });

    describe('config-phase enforcement', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('throws when a config block injects a factory-backed service', () => {
        const mod = createModule('app', [])
          .factory('api', [() => ({ call: () => 'ok' })])
          .config([
            'api',
            (api: unknown) => {
              // should never run — services are not injectable during config phase
              void api;
            },
          ]);
        expect(() => createInjector([mod])).toThrow(
          'Cannot inject "api" during config phase; use "apiProvider" instead',
        );
      });

      it('throws when a config block injects a service-recipe service', () => {
        class Greeter {
          static readonly $inject = [] as const;
          hello(): string {
            return 'hi';
          }
        }
        const mod = createModule('app', [])
          .service('greeter', Greeter)
          .config([
            'greeter',
            (greeter: unknown) => {
              // should never run — services are not injectable during config phase
              void greeter;
            },
          ]);
        expect(() => createInjector([mod])).toThrow(
          'Cannot inject "greeter" during config phase; use "greeterProvider" instead',
        );
      });

      it('throws when a config block injects a provider-backed service (by service name, not <name>Provider)', () => {
        class LoggerProvider {
          $get = [() => ({ log: (m: string): string => m })] as const;
        }
        const mod = createModule('app', [])
          .provider('logger', LoggerProvider)
          .config([
            'logger',
            (logger: unknown) => {
              // should never run — 'logger' is the run-phase name; must use 'loggerProvider' instead
              void logger;
            },
          ]);
        expect(() => createInjector([mod])).toThrow(
          'Cannot inject "logger" during config phase; use "loggerProvider" instead',
        );
      });
    });

    describe('Module.config', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('registers a config block via array-style invokable', () => {
        const fn = (x: unknown) => {
          void x;
        };
        const mod = createModule('app', []).config(['MAX', fn]);
        expect(mod.$$configBlocks).toHaveLength(1);
        expect(mod.$$configBlocks[0]).toEqual(['MAX', fn]);
      });

      it('registers a config block via $inject-annotated function', () => {
        const fn = Object.assign(
          (x: unknown) => {
            void x;
          },
          { $inject: ['MAX'] as const },
        );
        const mod = createModule('app', []).config(fn);
        expect(mod.$$configBlocks).toHaveLength(1);
        expect(mod.$$configBlocks[0]).toBe(fn);
      });

      it('multiple config calls preserve registration order', () => {
        const first = (x: unknown) => void x;
        const second = (x: unknown) => void x;
        const third = (x: unknown) => void x;
        const mod = createModule('app', []).config(['MAX', first]).config(['MAX', second]).config(['MAX', third]);
        expect(mod.$$configBlocks).toHaveLength(3);
        expect(mod.$$configBlocks[0]).toEqual(['MAX', first]);
        expect(mod.$$configBlocks[1]).toEqual(['MAX', second]);
        expect(mod.$$configBlocks[2]).toEqual(['MAX', third]);
      });

      it('config is chainable alongside recipes', () => {
        const configFn = (x: unknown) => void x;
        const mod = createModule('app', [])
          .value('apiUrl', 'https://example.com')
          .constant('MAX', 10)
          .config(['MAX', configFn])
          .factory('svc', [() => ({ ok: true })]);
        expect(mod.$$configBlocks).toHaveLength(1);
        expect(mod.$$configBlocks[0]).toEqual(['MAX', configFn]);
        // value + constant + factory all pushed to invoke queue
        expect(mod.$$invokeQueue.length).toBe(3);
      });
    });

    describe('createInjector (config blocks)', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('runs the config block during createInjector and before any service factory is called', () => {
        const callOrder: string[] = [];
        const mod = createModule('app', [])
          .constant('MARKER', 'hello')
          .factory('svc', [
            () => {
              callOrder.push('factory');
              return { ok: true };
            },
          ])
          .config([
            'MARKER',
            (marker: unknown) => {
              callOrder.push(`config:${String(marker)}`);
            },
          ]);
        const injector = createInjector([mod]);
        // Config must have run during createInjector.
        expect(callOrder).toEqual(['config:hello']);
        // Factory runs lazily on first get.
        injector.get('svc');
        expect(callOrder).toEqual(['config:hello', 'factory']);
      });

      it('can inject a provider via its <name>Provider key', () => {
        const calls: unknown[] = [];
        class LoggerProvider {
          readonly level: string = 'info';
          $get = [() => ({ log: (m: string) => m })] as const;
        }
        const mod = createModule('app', [])
          .provider('logger', LoggerProvider)
          .config([
            'loggerProvider',
            (p: unknown) => {
              calls.push(p);
            },
          ]);
        createInjector([mod]);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toBeInstanceOf(LoggerProvider);
        expect((calls[0] as LoggerProvider).level).toBe('info');
      });

      it('can inject a constant', () => {
        const seen: unknown[] = [];
        const mod = createModule('app', [])
          .constant('MAX', 5)
          .config([
            'MAX',
            (max: unknown) => {
              seen.push(max);
            },
          ]);
        createInjector([mod]);
        expect(seen).toEqual([5]);
      });

      it('values are visible in config blocks via the shared provider cache (implementation note)', () => {
        const seen: unknown[] = [];
        const mod = createModule('app', [])
          .value('greeting', 'hello')
          .config([
            'greeting',
            (g: unknown) => {
              seen.push(g);
            },
          ]);
        // This does NOT throw because values land in `providerCache` at load
        // time and `providerGet` returns from the cache before reaching the
        // service-only enforcement branch. Documents current behavior — if we
        // ever tighten the two-phase boundary to forbid value injection in
        // config, update this test accordingly.
        createInjector([mod]);
        expect(seen).toEqual(['hello']);
        // Factory/service/provider rejection cases are covered in the
        // `config-phase enforcement` describe block above — not duplicated here.
      });

      it('multiple config blocks run in registration order within a module', () => {
        const order: string[] = [];
        const mod = createModule('app', [])
          .constant('MARKER', 'x')
          .config(['MARKER', () => order.push('first')])
          .config(['MARKER', () => order.push('second')])
          .config(['MARKER', () => order.push('third')]);
        createInjector([mod]);
        expect(order).toEqual(['first', 'second', 'third']);
      });

      it('config blocks across required modules run in dependency order', () => {
        const order: string[] = [];
        createModule('core', [])
          .constant('CORE', 'c')
          .config(['CORE', () => order.push('core')]);
        createModule('middle', ['core'])
          .constant('MID', 'm')
          .config(['MID', () => order.push('middle')]);
        const app = createModule('app', ['middle'])
          .constant('APP', 'a')
          .config(['APP', () => order.push('app')]);
        createInjector([app]);
        // core runs first (deepest dep), then middle, then app.
        expect(order).toEqual(['core', 'middle', 'app']);
      });

      it('config block can mutate a provider and the mutation is visible in the produced service', () => {
        class LoggerProvider {
          level = 'info';
          setLevel(level: string): void {
            this.level = level;
          }
          // `$get` must be an array-style invokable so `providerInvoke` passes
          // `this` = the provider instance when calling the trailing function.
          // Use a non-arrow function so `this` is bound correctly.
          $get = [
            function logger(this: LoggerProvider) {
              return { level: this.level };
            },
          ] as const;
        }
        const mod = createModule('app', [])
          .provider('logger', LoggerProvider)
          .config([
            'loggerProvider',
            (p: unknown) => {
              (p as LoggerProvider).setLevel('debug');
            },
          ]);
        const injector = createInjector([mod]);
        const logger = injector.get<{ level: string }>('logger');
        expect(logger.level).toBe('debug');
      });
    });

    describe('type safety — config blocks', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('config callback params are typed from ConfigRegistry (provider instance)', () => {
        class LoggerProvider {
          level: string = 'info';
          setLevel(level: string): void {
            this.level = level;
          }
          $get = [() => ({ log: (m: string): string => m })] as const;
        }

        // The callback's `loggerProvider` parameter should be inferred as
        // `LoggerProvider` via `ResolveDeps<ConfigRegistry, ['loggerProvider']>`.
        // If that inference works, calling `.setLevel('debug')` on it type-checks
        // without any explicit generic or annotation.
        const mod = createModule('app', [])
          .provider('logger', LoggerProvider)
          .config([
            'loggerProvider',
            (loggerProvider) => {
              // This line must compile — if `loggerProvider` is inferred as
              // `unknown` or `never`, `.setLevel` won't exist on it.
              expectTypeOf(loggerProvider).toEqualTypeOf<LoggerProvider>();
              loggerProvider.setLevel('debug');
            },
          ]);

        // Assert the runtime outcome so the test is also a smoke test.
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('logger')).toEqualTypeOf<{ log: (m: string) => string }>();
      });

      it('config callback params are typed from ConfigRegistry (constant value)', () => {
        const mod = createModule('app', [])
          .constant('MAX', 42)
          .config([
            'MAX',
            (max) => {
              expectTypeOf(max).toEqualTypeOf<number>();
            },
          ]);

        createInjector([mod]);
      });

      it('config callback params are typed from ConfigRegistry (multiple deps)', () => {
        class LoggerProvider {
          level: string = 'info';
          $get = [() => ({ log: (m: string): string => m })] as const;
        }

        const mod = createModule('app', [])
          .constant('MAX', 5)
          .provider('logger', LoggerProvider)
          .config([
            'MAX',
            'loggerProvider',
            (max, loggerProvider) => {
              expectTypeOf(max).toEqualTypeOf<number>();
              expectTypeOf(loggerProvider).toEqualTypeOf<LoggerProvider>();
            },
          ]);

        createInjector([mod]);
      });

      it('config cannot inject a service name at compile time (only <name>Provider)', () => {
        class LoggerProvider {
          $get = [() => ({ log: (m: string): string => m })] as const;
        }

        // After `.provider('logger', LoggerProvider)`, ConfigRegistry has
        // `loggerProvider: LoggerProvider` but NOT `logger`. Only Registry has
        // `logger: { log: ... }` — config is compile-time restricted to
        // ConfigRegistry keys.
        //
        // Isolate the typed overload with a helper type so overload resolution
        // doesn't fall through to the untyped fallback. Same trick used in
        // `type safety — service recipe` with `TypedGet`.
        type ConfigRegistry = { loggerProvider: LoggerProvider };
        type TypedConfig = <const Deps extends readonly (keyof ConfigRegistry)[]>(
          invokable: readonly [
            ...Deps,
            (
              ...args: { [I in keyof Deps]: Deps[I] extends keyof ConfigRegistry ? ConfigRegistry[Deps[I]] : never }
            ) => void,
          ],
        ) => unknown;

        const mod = createModule('app', []).provider('logger', LoggerProvider);
        const typedConfig: TypedConfig = mod.config.bind(mod) as TypedConfig;

        // Positive: 'loggerProvider' is in ConfigRegistry — compiles.
        typedConfig([
          'loggerProvider',
          (p) => {
            void p;
          },
        ]);

        // Negative: 'logger' is a service (run-phase only), not in ConfigRegistry.
        // @ts-expect-error -- 'logger' is not a config-phase key; only 'loggerProvider' is.
        typedConfig([
          'logger',
          (l) => {
            void l;
          },
        ]);
      });

      it('config rejects typo in dep names at compile time', () => {
        type ConfigRegistry = { MAX: number };
        type TypedConfig = <const Deps extends readonly (keyof ConfigRegistry)[]>(
          invokable: readonly [
            ...Deps,
            (
              ...args: { [I in keyof Deps]: Deps[I] extends keyof ConfigRegistry ? ConfigRegistry[Deps[I]] : never }
            ) => void,
          ],
        ) => unknown;

        const mod = createModule('app', []).constant('MAX', 5);
        const typedConfig: TypedConfig = mod.config.bind(mod) as TypedConfig;

        // Positive: known key compiles.
        typedConfig([
          'MAX',
          (max) => {
            void max;
          },
        ]);

        // Negative: typo'd key is a compile error.
        // @ts-expect-error -- 'MAXX' is a typo; only 'MAX' exists in ConfigRegistry.
        typedConfig([
          'MAXX',
          (max) => {
            void max;
          },
        ]);
      });
    });

    describe('Module.run', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('registers a run block via array-style invokable', () => {
        const mod = createModule('app', [])
          .constant('X', 1)
          .run([
            'X',
            (x: unknown) => {
              void x;
            },
          ]);
        expect(mod.$$runBlocks).toHaveLength(1);
      });

      it('registers a run block via $inject-annotated function', () => {
        const fn = (x: unknown) => {
          void x;
        };
        fn.$inject = ['X'] as const;
        const mod = createModule('app', []).constant('X', 1).run(fn);
        expect(mod.$$runBlocks).toHaveLength(1);
      });

      it('multiple run calls preserve registration order', () => {
        const first = ['X', () => {}] as const;
        const second = ['X', () => {}] as const;
        const third = ['X', () => {}] as const;
        const mod = createModule('app', []).constant('X', 1).run(first).run(second).run(third);
        expect(mod.$$runBlocks).toHaveLength(3);
        expect(mod.$$runBlocks[0]).toBe(first);
        expect(mod.$$runBlocks[1]).toBe(second);
        expect(mod.$$runBlocks[2]).toBe(third);
      });

      it('run is chainable alongside recipes and config', () => {
        const mod = createModule('app', [])
          .value('name', 'Jane')
          .constant('MAX', 5)
          .config([
            'MAX',
            (m: unknown) => {
              void m;
            },
          ])
          .run([
            'name',
            (n: unknown) => {
              void n;
            },
          ]);
        expect(mod.$$configBlocks).toHaveLength(1);
        expect(mod.$$runBlocks).toHaveLength(1);
      });
    });

    describe('createInjector (run blocks)', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('run block executes after all config blocks', () => {
        const order: string[] = [];
        class LoggerProvider {
          level = 'info';
          setLevel(l: string): void {
            this.level = l;
          }
          $get = [
            function (this: LoggerProvider) {
              return { level: this.level };
            },
          ] as const;
        }
        const mod = createModule('app', [])
          .provider('logger', LoggerProvider)
          .config([
            'loggerProvider',
            (p: unknown) => {
              (p as LoggerProvider).setLevel('debug');
              order.push('config');
            },
          ])
          .run([
            'logger',
            (logger: unknown) => {
              order.push(`run:${(logger as { level: string }).level}`);
            },
          ]);
        createInjector([mod]);
        expect(order).toEqual(['config', 'run:debug']);
      });

      it('run block can inject services, values, constants, and factories', () => {
        const seen: unknown[] = [];
        class Greeter {
          static readonly $inject = [] as const;
          hello() {
            return 'hi';
          }
        }
        const mod = createModule('app', [])
          .value('name', 'Jane')
          .constant('MAX', 5)
          .factory('counter', [() => ({ count: 0 })])
          .service('greeter', Greeter)
          .run([
            'name',
            'MAX',
            'counter',
            'greeter',
            (name: unknown, max: unknown, counter: unknown, greeter: unknown) => {
              seen.push(name, max, counter, greeter);
            },
          ]);
        createInjector([mod]);
        expect(seen).toHaveLength(4);
        expect(seen[0]).toBe('Jane');
        expect(seen[1]).toBe(5);
        expect(seen[2]).toEqual({ count: 0 });
        expect(seen[3]).toBeInstanceOf(Greeter);
      });

      it('run block cannot inject <name>Provider (config phase is over)', () => {
        class LoggerProvider {
          $get = [() => ({ log: (m: string): string => m })] as const;
        }
        const mod = createModule('app', [])
          .provider('logger', LoggerProvider)
          .run([
            'loggerProvider',
            (p: unknown) => {
              void p;
            },
          ]);
        expect(() => createInjector([mod])).toThrow(/Unknown provider: loggerProvider/);
      });

      it('multiple run blocks run in registration order within a module', () => {
        const order: string[] = [];
        const mod = createModule('app', [])
          .constant('X', 'x')
          .run(['X', () => order.push('first')])
          .run(['X', () => order.push('second')])
          .run(['X', () => order.push('third')]);
        createInjector([mod]);
        expect(order).toEqual(['first', 'second', 'third']);
      });

      it('run blocks across required modules run in dependency order', () => {
        const order: string[] = [];
        createModule('core', [])
          .constant('C', 'c')
          .run(['C', () => order.push('core')]);
        createModule('middle', ['core'])
          .constant('M', 'm')
          .run(['M', () => order.push('middle')]);
        const app = createModule('app', ['middle'])
          .constant('A', 'a')
          .run(['A', () => order.push('app')]);
        createInjector([app]);
        expect(order).toEqual(['core', 'middle', 'app']);
      });

      it('run blocks run exactly once per createInjector call', () => {
        let count = 0;
        const mod = createModule('app', [])
          .constant('X', 'x')
          .run([
            'X',
            () => {
              count++;
            },
          ]);
        createInjector([mod]);
        expect(count).toBe(1);
        // Creating a second injector with the same module runs the block again.
        resetRegistry();
        const mod2 = createModule('app', [])
          .constant('X', 'x')
          .run([
            'X',
            () => {
              count++;
            },
          ]);
        createInjector([mod2]);
        expect(count).toBe(2);
      });
    });

    describe('type safety — run blocks', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('run callback params are typed from Registry (service)', () => {
        class Greeter {
          static readonly $inject = [] as const;
          hello(): string {
            return 'hi';
          }
        }

        const mod = createModule('app', [])
          .service('greeter', Greeter)
          .run([
            'greeter',
            (greeter) => {
              expectTypeOf(greeter).toEqualTypeOf<Greeter>();
              greeter.hello();
            },
          ]);

        createInjector([mod]);
      });

      it('run callback params are typed from Registry (value)', () => {
        const mod = createModule('app', [])
          .value('name', 'Jane')
          .run([
            'name',
            (name) => {
              expectTypeOf(name).toEqualTypeOf<string>();
            },
          ]);

        createInjector([mod]);
      });

      it('run callback params are typed from Registry (multiple deps)', () => {
        class Greeter {
          static readonly $inject = [] as const;
          hello(): string {
            return 'hi';
          }
        }

        const mod = createModule('app', [])
          .value('name', 'Jane')
          .constant('MAX', 5)
          .service('greeter', Greeter)
          .run([
            'name',
            'MAX',
            'greeter',
            (name, max, greeter) => {
              expectTypeOf(name).toEqualTypeOf<string>();
              expectTypeOf(max).toEqualTypeOf<number>();
              expectTypeOf(greeter).toEqualTypeOf<Greeter>();
            },
          ]);

        createInjector([mod]);
      });

      it('run cannot inject a <name>Provider key at compile time', () => {
        class LoggerProvider {
          $get = [() => ({ log: (m: string): string => m })] as const;
        }

        // After `.provider('logger', LoggerProvider)`:
        // - Registry has `logger: { log: ... }`
        // - ConfigRegistry has `loggerProvider: LoggerProvider`
        // The `run` typed overload only sees Registry keys.
        type Registry = { logger: { log: (m: string) => string } };
        type TypedRun = <const Deps extends readonly (keyof Registry)[]>(
          invokable: readonly [
            ...Deps,
            (...args: { [I in keyof Deps]: Deps[I] extends keyof Registry ? Registry[Deps[I]] : never }) => void,
          ],
        ) => unknown;

        const mod = createModule('app', []).provider('logger', LoggerProvider);
        const typedRun: TypedRun = mod.run.bind(mod) as TypedRun;

        // Positive: 'logger' is in Registry — compiles.
        typedRun([
          'logger',
          (l) => {
            void l;
          },
        ]);

        // Negative: 'loggerProvider' is NOT in Registry (it's config-phase only).
        // @ts-expect-error -- 'loggerProvider' is not a run-phase key
        typedRun([
          'loggerProvider',
          (p) => {
            void p;
          },
        ]);
      });

      it('run rejects typo in dep names at compile time', () => {
        type Registry = { name: string };
        type TypedRun = <const Deps extends readonly (keyof Registry)[]>(
          invokable: readonly [
            ...Deps,
            (...args: { [I in keyof Deps]: Deps[I] extends keyof Registry ? Registry[Deps[I]] : never }) => void,
          ],
        ) => unknown;

        const mod = createModule('app', []).value('name', 'Jane');
        const typedRun: TypedRun = mod.run.bind(mod) as TypedRun;

        // Positive: known key compiles.
        typedRun([
          'name',
          (n) => {
            void n;
          },
        ]);

        // Negative: typo'd key is a compile error.
        // @ts-expect-error -- 'namee' is a typo; only 'name' exists in Registry
        typedRun([
          'namee',
          (n) => {
            void n;
          },
        ]);
      });
    });
  });
});
