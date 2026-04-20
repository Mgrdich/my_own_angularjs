import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Scope } from '@core/index';

describe('scope — string expressions', () => {
  describe('$watch', () => {
    it('watches a string expression and fires on first digest with the resolved value', () => {
      const scope = Scope.create<{ user: { name: string } }>();
      scope.user = { name: 'alice' };
      const listener = vi.fn();

      scope.$watch('user.name', listener);
      scope.$digest();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toBe('alice');
    });

    it('fires the listener when the string-watched property changes', () => {
      const scope = Scope.create<{ user: { name: string } }>();
      scope.user = { name: 'alice' };
      const listener = vi.fn();

      scope.$watch('user.name', listener);
      scope.$digest();
      listener.mockClear();

      scope.user.name = 'bob';
      scope.$digest();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toBe('bob');
    });

    it('regression: function form still works', () => {
      const scope = Scope.create<{ count: number }>();
      scope.count = 0;
      const listener = vi.fn();

      scope.$watch((s) => s.count, listener);
      scope.$digest();
      listener.mockClear();

      scope.count = 1;
      scope.$digest();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toBe(1);
    });
  });

  describe('$watchGroup', () => {
    it('watches an array of string expressions and fires once on first digest with resolved values', () => {
      const scope = Scope.create<{ a: number; b: { c: number } }>();
      scope.a = 1;
      scope.b = { c: 2 };
      const listener = vi.fn();

      scope.$watchGroup(['a', 'b.c'], listener);
      scope.$digest();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toEqual([1, 2]);
    });

    it('re-fires the listener with updated values when any watched string expression changes', () => {
      const scope = Scope.create<{ a: number; b: { c: number } }>();
      scope.a = 1;
      scope.b = { c: 2 };
      const listener = vi.fn();

      scope.$watchGroup(['a', 'b.c'], listener);
      scope.$digest();
      listener.mockClear();

      scope.a = 10;
      scope.$digest();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toEqual([10, 2]);
    });
  });

  describe('$watchCollection', () => {
    it('fires on first digest when watching a collection via a string expression', () => {
      const scope = Scope.create<{ items: number[] }>();
      scope.items = [1, 2, 3];
      const listener = vi.fn();

      scope.$watchCollection('items', listener);
      scope.$digest();

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('detects a push into the collection referenced by a string expression', () => {
      const scope = Scope.create<{ items: number[] }>();
      scope.items = [1, 2, 3];
      const listener = vi.fn();

      scope.$watchCollection('items', listener);
      scope.$digest();
      listener.mockClear();

      scope.items.push(4);
      scope.$digest();

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('$eval', () => {
    it('evaluates a string expression against the scope', () => {
      const scope = Scope.create<{ a: number; b: number }>();
      scope.a = 2;
      scope.b = 3;

      expect(scope.$eval('a + b')).toBe(5);
    });

    it('uses locals to override scope properties when evaluating a string', () => {
      const scope = Scope.create<{ a: number; b: number }>();
      scope.a = 2;
      scope.b = 3;

      expect(scope.$eval('a + b', { a: 10 })).toBe(13);
    });

    it('regression: function form still works', () => {
      const scope = Scope.create<{ a: number }>();
      scope.a = 2;

      expect(scope.$eval(() => scope.a * 2)).toBe(4);
    });
  });

  describe('$evalAsync', () => {
    it('queues a string expression that runs during the next digest', () => {
      const scope = Scope.create<{ counter: number }>();
      scope.counter = 0;

      scope.$evalAsync('counter = counter + 1');
      scope.$digest();

      expect(scope.counter).toBe(1);
    });
  });

  describe('$apply', () => {
    it('evaluates a string expression and returns its value', () => {
      const scope = Scope.create<{ x: number }>();
      scope.x = 5;

      expect(scope.$apply('x + 1')).toBe(6);
    });

    it('runs a digest after evaluating the string expression', () => {
      const scope = Scope.create<{ x: number }>();
      scope.x = 5;
      const listener = vi.fn();

      scope.$watch(
        (s) => s.x,
        (newValue) => {
          listener(newValue);
        },
      );

      // Prime the watcher so firstRun is already consumed
      scope.$digest();
      listener.mockClear();

      // Mutate x inside $apply via assignment expression; the subsequent
      // digest triggered by $apply should fire the listener.
      scope.$apply('x = x + 1');

      expect(scope.x).toBe(6);
      expect(listener).toHaveBeenCalledWith(6);
    });
  });

  describe('$applyAsync', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('evaluates a string expression after the scheduled timeout fires', () => {
      const scope = Scope.create<{ x: number }>();
      scope.x = 0;

      scope.$applyAsync('x = 1');

      expect(scope.x).toBe(0);

      vi.advanceTimersByTime(0);

      expect(scope.x).toBe(1);
    });
  });

  describe('invalid syntax', () => {
    it('throws at $watch registration when the expression has a syntax error', () => {
      const scope = Scope.create();
      expect(() => scope.$watch('@invalid', () => {})).toThrow();
    });

    it('throws at $eval when the expression has a syntax error', () => {
      const scope = Scope.create();
      expect(() => scope.$eval('1 +')).toThrow();
    });
  });
});
