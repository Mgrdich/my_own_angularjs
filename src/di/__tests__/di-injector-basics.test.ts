import { describe, it, expect, expectTypeOf, beforeEach, vi } from 'vitest';
import { createModule, getModule, resetRegistry } from '@di/module';
import { createInjector } from '@di/injector';

describe('dependency injection', () => {
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

  describe('createInjector (constant-override guard via module DSL)', () => {
    beforeEach(() => {
      resetRegistry();
    });

    it('throws when `.value(name)` follows `.constant(name)` on the same module', () => {
      // Same-module chain: the queue is drained in registration order, so the
      // guard must fire when the second entry (value) lands on the same name.
      // The em dash in the message is U+2014 — exact-string assert protects
      // the public-contract wording.
      const appModule = createModule('app', []).constant('X', 'a').value('X', 'b');
      expect(() => createInjector([appModule])).toThrow(
        'Cannot override constant "X" — already registered via .constant(...)',
      );
    });

    it('throws when `.factory(name)` follows `.constant(name)` on the same module', () => {
      const appModule = createModule('app', [])
        .constant('X', 'a')
        .factory('X', [() => 'b']);
      expect(() => createInjector([appModule])).toThrow(/Cannot override constant "X"/);
    });

    it('throws when a downstream module overrides a constant from a required module', () => {
      // Cross-module override: module `b` requires `a`; `a` registers the
      // constant first (post-order drain), then `b`'s value runs against the
      // already-tracked constant name. Proves the guard fires across module
      // boundaries in a dependency graph, not just within a single module.
      createModule('a', []).constant('X', 'a');
      const b = createModule('b', ['a']).value('X', 'b');
      expect(() => createInjector([b])).toThrow('Cannot override constant "X" — already registered via .constant(...)');
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
});
