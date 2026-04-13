import { describe, it, expect, beforeEach } from 'vitest';
import { Module, createModule, getModule, resetRegistry } from '@di/module';

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
