import { describe, it, expect, beforeEach } from 'vitest';
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
});
