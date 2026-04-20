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

describe('spec 010 — :: prefix in eval/apply methods', () => {
  describe('$eval', () => {
    it('strips the :: prefix and returns the same value as the non-prefixed form', () => {
      const scope = Scope.create<{ a: number; b: number }>();
      scope.a = 2;
      scope.b = 3;

      expect(scope.$eval('::a + b')).toBe(scope.$eval('a + b'));
      expect(scope.$eval('::a + b')).toBe(5);
    });

    it('honors locals when evaluating a :: prefixed expression', () => {
      const scope = Scope.create<{ a: number }>();
      scope.a = 2;

      expect(scope.$eval('::a', { a: 10 })).toBe(10);
    });

    it('evaluates a :: prefixed literal expression', () => {
      const scope = Scope.create();

      expect(scope.$eval('::42')).toBe(42);
    });

    it('regression: does not register a watcher when evaluating a :: prefixed expression', () => {
      const scope = Scope.create<{ a: number }>();
      scope.a = 1;

      const before = scope.$$watchers?.length ?? 0;
      scope.$eval('::a + 1');
      const after = scope.$$watchers?.length ?? 0;

      expect(after).toBe(before);
    });
  });

  describe('$apply', () => {
    it('strips the :: prefix, mutates the scope, and triggers a digest', () => {
      const scope = Scope.create<{ counter: number }>();
      scope.counter = 0;

      scope.$apply('::counter = counter + 1');

      expect(scope.counter).toBe(1);
    });

    it('fires a previously registered watcher after $apply with a :: prefixed expression', () => {
      const scope = Scope.create<{ counter: number }>();
      scope.counter = 0;
      const listener = vi.fn();

      scope.$watch(
        (s) => s.counter,
        (newValue) => {
          listener(newValue);
        },
      );

      // Prime the watcher so firstRun is already consumed
      scope.$digest();
      listener.mockClear();

      scope.$apply('::counter = counter + 1');

      expect(scope.counter).toBe(1);
      expect(listener).toHaveBeenCalledWith(1);
    });

    it('returns the evaluated value when the :: prefixed expression has no assignment', () => {
      const scope = Scope.create<{ x: number }>();
      scope.x = 5;

      expect(scope.$apply('::x + 1')).toBe(6);
    });
  });

  describe('$evalAsync', () => {
    it('queues a :: prefixed assignment expression that runs during the next digest', () => {
      const scope = Scope.create<{ x: number }>();
      scope.x = 0;

      scope.$evalAsync('::x = 5');
      scope.$digest();

      expect(scope.x).toBe(5);
    });

    it('runs a :: prefixed read-only expression without error during the next digest', () => {
      const scope = Scope.create<{ x: number }>();
      scope.x = 1;

      expect(() => {
        scope.$evalAsync('::x');
        scope.$digest();
      }).not.toThrow();
    });
  });

  describe('$applyAsync', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('evaluates a :: prefixed expression after the scheduled timeout fires', () => {
      const scope = Scope.create<{ y: number }>();
      scope.y = 0;

      scope.$applyAsync('::y = 1');

      expect(scope.y).toBe(0);

      vi.advanceTimersByTime(0);

      expect(scope.y).toBe(1);
    });

    it('coalesces multiple :: prefixed $applyAsync calls into a single flush', () => {
      const scope = Scope.create<{ y: number }>();
      scope.y = 0;

      scope.$applyAsync('::y = y + 1');
      scope.$applyAsync('::y = y + 1');
      scope.$applyAsync('::y = y + 1');

      expect(scope.y).toBe(0);

      vi.advanceTimersByTime(0);

      expect(scope.y).toBe(3);
    });
  });
});

describe('spec 010 — constant watch optimization', () => {
  it('fires once for a constant numeric literal then deregisters', () => {
    const scope = Scope.create();
    const listener = vi.fn();

    scope.$watch('42', listener);
    scope.$digest();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toBe(42);

    // The watcher slot should have been nulled out by the self-deregistration.
    const watchers = scope.$$watchers ?? [];
    expect(watchers.every((w) => w === null)).toBe(true);

    // Subsequent digests do not fire the listener again.
    scope.$digest();
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('fires once for a constant string literal then deregisters', () => {
    const scope = Scope.create();
    const listener = vi.fn();

    scope.$watch('"hello"', listener);
    scope.$digest();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toBe('hello');

    scope.$digest();
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('fires once for a constant array literal then deregisters', () => {
    const scope = Scope.create();
    const listener = vi.fn();

    scope.$watch('[1, 2, 3]', listener);
    scope.$digest();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual([1, 2, 3]);

    scope.$digest();
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('treats a :: prefixed constant identically to the non-prefixed form', () => {
    const scope = Scope.create();
    const listener = vi.fn();

    scope.$watch('::42', listener);
    scope.$digest();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toBe(42);

    const watchers = scope.$$watchers ?? [];
    expect(watchers.every((w) => w === null)).toBe(true);

    scope.$digest();
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('returns a deregister fn that is safe to call after self-deregistration', () => {
    const scope = Scope.create();
    const listener = vi.fn();

    const dereg = scope.$watch('42', listener);
    scope.$digest();

    expect(listener).toHaveBeenCalledTimes(1);

    // Watcher already self-deregistered; calling dereg again must be a no-op.
    expect(() => {
      dereg();
    }).not.toThrow();

    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('supports manual deregistration before the first digest (listener never fires)', () => {
    const scope = Scope.create();
    const listener = vi.fn();

    const dereg = scope.$watch('42', listener);
    dereg();
    scope.$digest();

    expect(listener).not.toHaveBeenCalled();
  });

  it('regression: function-form watchers stay registered and re-fire on change', () => {
    const scope = Scope.create<{ x: number }>();
    scope.x = 42;
    const listener = vi.fn();

    scope.$watch((s) => s.x, listener);
    scope.$digest();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toBe(42);

    // Still registered: mutating the watched value re-fires the listener.
    scope.x = 43;
    scope.$digest();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1]?.[0]).toBe(43);
  });

  it('regression: function-form watcher with a constant body is not treated as constant', () => {
    const scope = Scope.create();
    const listener = vi.fn();

    scope.$watch(() => 42, listener);

    const watchersBefore = (scope.$$watchers ?? []).filter((w) => w !== null).length;
    expect(watchersBefore).toBe(1);

    scope.$digest();
    // First digest: sentinel -> 42 triggers the listener exactly once.
    expect(listener).toHaveBeenCalledTimes(1);

    // Subsequent digests do not fire the listener (no change)...
    scope.$digest();
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);

    // ...but the watcher remains registered (no constant-flag deregistration).
    const watchersAfter = (scope.$$watchers ?? []).filter((w) => w !== null).length;
    expect(watchersAfter).toBe(1);
  });
});

describe('spec 010 — one-time bindings (non-literal)', () => {
  it('stays live while the value is undefined and is not deregistered across digests', () => {
    const scope = Scope.create<{ user?: { name: string } }>();
    const listener = vi.fn();

    scope.$watch('::user.name', listener);

    // First digest: sentinel -> undefined is a change, so the listener fires
    // once with (undefined, undefined). Matches AngularJS oneTimeWatchDelegate.
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toBeUndefined();

    // Subsequent digests do NOT fire the listener — value stays undefined.
    scope.$digest();
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);

    // Watcher is still registered because the value has never stabilized.
    const registered = (scope.$$watchers ?? []).filter((w) => w !== null).length;
    expect(registered).toBe(1);
  });

  it('fires when the value becomes defined and deregisters post-digest', () => {
    const scope = Scope.create<{ user?: { name: string } }>();
    const listener = vi.fn();

    scope.$watch('::user.name', listener);

    // First digest fires the sentinel -> undefined transition.
    scope.$digest();
    listener.mockClear();

    scope.user = { name: 'alice' };
    scope.$digest();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toBe('alice');

    // After the stabilizing digest, the watcher slot should be nulled out.
    const registered = (scope.$$watchers ?? []).filter((w) => w !== null).length;
    expect(registered).toBe(0);
  });

  it('does not fire the listener for further changes after deregistration', () => {
    const scope = Scope.create<{ user?: { name: string } }>();
    const listener = vi.fn();

    scope.$watch('::user.name', listener);

    scope.user = { name: 'alice' };
    scope.$digest();
    // One fire for the sentinel -> 'alice' transition, then deregisters.
    listener.mockClear();

    // Subsequent mutations should not re-fire the deregistered listener.
    scope.user.name = 'bob';
    scope.$digest();
    scope.user.name = 'carol';
    scope.$digest();

    expect(listener).not.toHaveBeenCalled();
  });

  it('treats null as a stable value and deregisters', () => {
    const scope = Scope.create<{ value?: unknown }>();
    const listener = vi.fn();

    scope.$watch('::value', listener);
    scope.value = null;
    scope.$digest();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toBeNull();

    scope.value = 'changed';
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('treats 0 as a stable value and deregisters', () => {
    const scope = Scope.create<{ value?: number }>();
    const listener = vi.fn();

    scope.$watch('::value', listener);
    scope.value = 0;
    scope.$digest();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toBe(0);

    scope.value = 1;
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('treats the empty string as a stable value and deregisters', () => {
    const scope = Scope.create<{ value?: string }>();
    const listener = vi.fn();

    scope.$watch('::value', listener);
    scope.value = '';
    scope.$digest();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toBe('');

    scope.value = 'hello';
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('treats false as a stable value and deregisters', () => {
    const scope = Scope.create<{ value?: boolean }>();
    const listener = vi.fn();

    scope.$watch('::value', listener);
    scope.value = false;
    scope.$digest();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toBe(false);

    scope.value = true;
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('treats NaN as a stable value and deregisters', () => {
    const scope = Scope.create<{ value?: number }>();
    const listener = vi.fn();

    // Enable value-equality so the dirty-check does not treat NaN !== NaN
    // as a persistent change on every pass.
    scope.$watch('::value', listener, true);
    scope.value = NaN;
    scope.$digest();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(Number.isNaN(listener.mock.calls[0]?.[0])).toBe(true);

    scope.value = 42;
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('never fires the listener when the deregister fn is called before stabilization', () => {
    const scope = Scope.create<{ user?: { name: string } }>();
    const listener = vi.fn();

    const dereg = scope.$watch('::user.name', listener);
    dereg();

    scope.user = { name: 'alice' };
    scope.$digest();
    scope.user.name = 'bob';
    scope.$digest();
    scope.$digest();

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps a never-stabilizing :: watcher alive across many digests', () => {
    const scope = Scope.create<{ nothing?: unknown }>();
    const listener = vi.fn();

    scope.$watch('::nothing', listener);

    for (let i = 0; i < 10; i += 1) {
      scope.$digest();
    }

    // Listener fires exactly once — on the sentinel -> undefined transition
    // during the first digest. After that the value is unchanged (stays
    // undefined) so no further fires occur, yet the watcher remains live
    // because `lastValue` never becomes defined.
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toBeUndefined();

    // The watcher should still be registered since the value never stabilized.
    const registered = (scope.$$watchers ?? []).filter((w) => w !== null).length;
    expect(registered).toBe(1);
  });

  it('supports multiple :: watchers coexisting and deregistering independently', () => {
    const scope = Scope.create<{ a?: number; b?: number; c?: number }>();
    const spyA = vi.fn();
    const spyB = vi.fn();
    const spyC = vi.fn();

    scope.$watch('::a', spyA);
    scope.$watch('::b', spyB);
    scope.$watch('::c', spyC);

    // Warm-up digest: each spy fires once on the sentinel -> undefined
    // transition. Clear all spies so the subsequent assertions focus on
    // independent stabilization.
    scope.$digest();
    spyA.mockClear();
    spyB.mockClear();
    spyC.mockClear();

    // Stabilize `a` first.
    scope.a = 1;
    scope.$digest();
    expect(spyA).toHaveBeenCalledTimes(1);
    expect(spyA.mock.calls[0]?.[0]).toBe(1);
    expect(spyB).not.toHaveBeenCalled();
    expect(spyC).not.toHaveBeenCalled();

    // Stabilize `b` next; `a` should not re-fire.
    scope.b = 2;
    scope.$digest();
    expect(spyA).toHaveBeenCalledTimes(1);
    expect(spyB).toHaveBeenCalledTimes(1);
    expect(spyB.mock.calls[0]?.[0]).toBe(2);
    expect(spyC).not.toHaveBeenCalled();

    // Stabilize `c` last; neither `a` nor `b` should re-fire.
    scope.c = 3;
    scope.$digest();
    expect(spyA).toHaveBeenCalledTimes(1);
    expect(spyB).toHaveBeenCalledTimes(1);
    expect(spyC).toHaveBeenCalledTimes(1);
    expect(spyC.mock.calls[0]?.[0]).toBe(3);

    // All three watchers should be deregistered.
    const registered = (scope.$$watchers ?? []).filter((w) => w !== null).length;
    expect(registered).toBe(0);
  });

  it('does not deregister when the value flickers back to undefined within the same digest', () => {
    const scope = Scope.create<{ value?: string | undefined }>();
    const listener = vi.fn();

    scope.$watch('::value', listener);

    // A sibling watcher reverts `value` back to undefined as soon as it
    // becomes defined, so the one-time watcher's lastValue settles at
    // undefined on the final pass of the digest and postDigest must NOT
    // deregister the watcher.
    let reverted = false;
    scope.$watch(
      (s) => s.value,
      (newValue, _oldValue, s) => {
        if (newValue !== undefined && !reverted) {
          reverted = true;
          s.value = undefined;
        }
      },
    );

    scope.value = 'x';
    scope.$digest();

    // The one-time watcher must still be live because `lastValue` finished
    // the digest as `undefined`. Two watchers registered: the one-time
    // watcher and the flicker watcher.
    const registered = (scope.$$watchers ?? []).filter((w) => w !== null).length;
    expect(registered).toBe(2);

    // Further digests without re-defining the value should not deregister.
    scope.$digest();
    scope.$digest();
    const registeredAfter = (scope.$$watchers ?? []).filter((w) => w !== null).length;
    expect(registeredAfter).toBe(2);
  });
});
