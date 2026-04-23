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

describe('spec 010 — one-time bindings (literal)', () => {
  it('stays live while any array-literal element is undefined and re-fires on genuine changes', () => {
    const scope = Scope.create<{ a?: number; b?: number }>();
    scope.a = 1;
    scope.b = undefined;
    const listener = vi.fn();

    // Use valueEq: true because `[a, b]` produces a fresh array each eval;
    // reference-inequality would otherwise fire the listener on every digest.
    scope.$watch('::[a, b]', listener, true);

    // First digest: sentinel -> [1, undefined] is a change, listener fires.
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual([1, undefined]);

    // No change → no fire.
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);

    // Watcher still registered because `b` is undefined.
    const registered = (scope.$$watchers ?? []).filter((w) => w !== null).length;
    expect(registered).toBe(1);

    // Genuine dirty-check change: `a` flips from 1 to 2 while `b` stays undefined.
    scope.a = 2;
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1]?.[0]).toEqual([2, undefined]);

    // Watcher is still live because the literal has not stabilized.
    const stillRegistered = (scope.$$watchers ?? []).filter((w) => w !== null).length;
    expect(stillRegistered).toBe(1);
  });

  it('deregisters an array literal once every top-level element is defined', () => {
    const scope = Scope.create<{ a?: number; b?: number }>();
    scope.a = 2;
    scope.b = undefined;
    const listener = vi.fn();

    scope.$watch('::[a, b]', listener, true);

    // First digest with `b` still undefined — watcher stays live.
    scope.$digest();
    listener.mockClear();

    // Stabilize: both elements now defined.
    scope.b = 99;
    scope.$digest();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual([2, 99]);

    // Post-digest deregistration.
    const registered = (scope.$$watchers ?? []).filter((w) => w !== null).length;
    expect(registered).toBe(0);

    // Subsequent changes do NOT fire the listener again.
    scope.a = 3;
    scope.b = 100;
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stays live while any object-literal property is undefined and deregisters once all are defined', () => {
    const scope = Scope.create<{ a?: number; b?: number }>();
    scope.a = 1;
    scope.b = undefined;
    const listener = vi.fn();

    scope.$watch('::{x: a, y: b}', listener, true);

    // First digest: sentinel -> {x: 1, y: undefined} fires the listener.
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual({ x: 1, y: undefined });

    // Still live while `b` is undefined.
    const registeredBefore = (scope.$$watchers ?? []).filter((w) => w !== null).length;
    expect(registeredBefore).toBe(1);

    // Genuine change keeps firing the listener until stabilization.
    scope.a = 2;
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1]?.[0]).toEqual({ x: 2, y: undefined });

    // Stabilize by defining `b`.
    listener.mockClear();
    scope.b = 5;
    scope.$digest();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual({ x: 2, y: 5 });

    // Post-digest deregistration.
    const registeredAfter = (scope.$$watchers ?? []).filter((w) => w !== null).length;
    expect(registeredAfter).toBe(0);

    // Subsequent changes do not fire.
    scope.a = 10;
    scope.b = 20;
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('deregisters a nested array literal once the top-level element is defined (inner array always fresh)', () => {
    const scope = Scope.create<{ a?: number; b?: number; c?: number }>();
    scope.a = undefined;
    scope.b = undefined;
    scope.c = undefined;
    const listener = vi.fn();

    scope.$watch('::[a, [b, c]]', listener, true);

    // First digest: sentinel -> [undefined, [undefined, undefined]].
    // Top-level element 0 is undefined, so the watcher stays live.
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual([undefined, [undefined, undefined]]);

    const registeredBefore = (scope.$$watchers ?? []).filter((w) => w !== null).length;
    expect(registeredBefore).toBe(1);

    // Defining `a` alone stabilizes the outer literal — `isAllDefined` only
    // inspects top-level members, and the inner array is a fresh non-undefined
    // object constructed on every eval.
    listener.mockClear();
    scope.a = 1;
    scope.$digest();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual([1, [undefined, undefined]]);

    const registeredAfter = (scope.$$watchers ?? []).filter((w) => w !== null).length;
    expect(registeredAfter).toBe(0);

    // Subsequent mutations — including to `b` and `c` — do not fire.
    scope.a = 2;
    scope.b = 5;
    scope.c = 10;
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('deregisters a nested object literal immediately — inner object always fresh and non-undefined', () => {
    const scope = Scope.create<{ a?: number }>();
    scope.a = undefined;
    const listener = vi.fn();

    scope.$watch('::{outer: {inner: a}}', listener, true);

    // Top-level has one property `outer` whose value is the fresh inner object
    // `{inner: undefined}`. The inner object itself is non-undefined, so the
    // outer literal stabilizes on the first digest regardless of `a`.
    scope.$digest();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual({ outer: { inner: undefined } });

    const registered = (scope.$$watchers ?? []).filter((w) => w !== null).length;
    expect(registered).toBe(0);

    // Subsequent changes to `a` do not fire.
    scope.a = 42;
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('deregisters immediately on the first digest for an empty array literal', () => {
    const scope = Scope.create();
    const listener = vi.fn();

    scope.$watch('::[]', listener, true);
    scope.$digest();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual([]);

    const registered = (scope.$$watchers ?? []).filter((w) => w !== null).length;
    expect(registered).toBe(0);

    // Subsequent digests: no further listener calls.
    scope.$digest();
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('deregisters immediately on the first digest for an empty object literal', () => {
    const scope = Scope.create();
    const listener = vi.fn();

    scope.$watch('::{}', listener, true);
    scope.$digest();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual({});

    const registered = (scope.$$watchers ?? []).filter((w) => w !== null).length;
    expect(registered).toBe(0);

    // Subsequent digests: no further listener calls.
    scope.$digest();
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not deregister a literal one-time watcher when an element flickers back to undefined within the same digest', () => {
    // Parity with AngularJS parseSpec "should only become stable when all the
    // elements of an array have defined values at the end of a $digest". A
    // sibling watcher forces `foo` back to undefined as soon as it becomes
    // defined. The literal `::[foo]` watcher must NOT deregister in that
    // cycle because `foo` is undefined at the end of the digest.
    const scope = Scope.create<{ foo?: string }>();
    const listener = vi.fn();

    scope.$watch('::[foo]', listener, true);

    let reverted = false;
    scope.$watch(
      (s) => s.foo,
      (newValue, _oldValue, s) => {
        if (newValue === 'bar' && !reverted) {
          reverted = true;
          s.foo = undefined;
        }
      },
    );

    // First cycle: foo flickers 'bar' → undefined. The literal one-time
    // watcher should have fired during the dirty pass (sentinel → ['bar'])
    // and at least once more when foo became undefined (['undefined']),
    // but must not deregister because the final stable value has an
    // undefined element.
    scope.foo = 'bar';
    scope.$digest();

    // Both watchers still registered: the literal one-time plus the sibling
    // flicker watcher.
    expect((scope.$$watchers ?? []).filter((w) => w !== null).length).toBe(2);

    // Stabilize with a value that the flicker watcher does not intercept.
    listener.mockClear();
    scope.foo = 'baz';
    scope.$digest();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual(['baz']);

    // The literal one-time watcher has now deregistered; only the flicker
    // watcher remains live.
    expect((scope.$$watchers ?? []).filter((w) => w !== null).length).toBe(1);

    // Further mutations do not fire the literal listener.
    listener.mockClear();
    scope.foo = 'qux';
    scope.$digest();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('spec 010 — $watchGroup with ::', () => {
  it('deregisters the :: entry after it stabilizes while the normal entry keeps firing', () => {
    const scope = Scope.create<{ a?: string; b: number }>();
    scope.a = undefined;
    scope.b = 1;
    const listener = vi.fn();

    scope.$watchGroup(['::a', 'b'], listener);

    // Warm-up digest: the group listener fires with the initial snapshot
    // (sentinel transitions for both entries). Clear to isolate the
    // post-setup behavior.
    scope.$digest();
    listener.mockClear();

    // Stabilize `a`: the one-time entry fires once and deregisters post-digest.
    scope.a = 'alpha';
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual(['alpha', 1]);

    // Mutating `a` further must NOT re-fire the listener — `::a` is
    // deregistered and `newValues[0]` keeps its last stable value.
    listener.mockClear();
    scope.a = 'beta';
    scope.$digest();
    expect(listener).not.toHaveBeenCalled();

    // Mutating `b` DOES fire the listener; `newValues[0]` still shows 'alpha'.
    scope.b = 2;
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual(['alpha', 2]);
  });

  it('routes each entry through its own delegate for mixed ["::a", "42", "b"]', () => {
    const scope = Scope.create<{ a?: string; b: number }>();
    scope.a = undefined;
    scope.b = 1;
    const listener = vi.fn();

    scope.$watchGroup(['::a', '42', 'b'], listener);

    // Warm-up digest: the constant '42' fires once via constantWatchDelegate
    // and self-deregisters; `::a` fires its sentinel → undefined transition;
    // `b` fires its sentinel → 1 transition. The grouped listener is invoked
    // at least once with the combined snapshot.
    scope.$digest();
    expect(listener).toHaveBeenCalled();
    const warmup = listener.mock.calls[listener.mock.calls.length - 1];
    expect(warmup?.[0]).toEqual([undefined, 42, 1]);
    listener.mockClear();

    // Stabilize `a`: only the `::a` entry fires. The group listener receives
    // the combined snapshot with 42 preserved in the middle slot.
    scope.a = 'alpha';
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual(['alpha', 42, 1]);

    // Mutate `a` again — its one-time watch is gone, listener must not fire.
    listener.mockClear();
    scope.a = 'beta';
    scope.$digest();
    expect(listener).not.toHaveBeenCalled();

    // Mutate `b` — only the live `b` watch fires the listener.
    scope.b = 2;
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual(['alpha', 42, 2]);
  });

  it('stops firing once every entry in an all-:: group has stabilized', () => {
    const scope = Scope.create<{ a?: string; b?: string }>();
    scope.a = undefined;
    scope.b = undefined;
    const listener = vi.fn();

    scope.$watchGroup(['::a', '::b'], listener);

    // Warm-up digest: sentinel → undefined transitions may fire the listener.
    // Clear to focus on stabilization-triggered fires.
    scope.$digest();
    listener.mockClear();

    // Stabilize `a` — the `::a` entry fires and deregisters; `::b` stays live.
    scope.a = 'x';
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual(['x', undefined]);

    // Stabilize `b` — the `::b` entry fires and deregisters.
    listener.mockClear();
    scope.b = 'y';
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual(['x', 'y']);

    // Both entries are deregistered — further mutations must not fire.
    listener.mockClear();
    scope.a = 'x2';
    scope.b = 'y2';
    scope.$digest();
    scope.$digest();
    expect(listener).not.toHaveBeenCalled();
  });

  it('regression: empty $watchGroup fires the listener once with empty arrays', () => {
    const scope = Scope.create();
    const listener = vi.fn();

    scope.$watchGroup([], listener);
    scope.$digest();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith([], [], scope);
  });

  it('deregisters every watcher once a mixed one-time + constant group stabilizes', () => {
    // Parity with AngularJS rootScopeSpec "should remove all watchers once
    // one-time/constant bindings are stable". Covers the combination of a
    // one-time entry plus a constant entry — both should self-deregister.
    const scope = Scope.create<{ a?: number }>();
    scope.$watchGroup(['::a', '1'], () => {});

    // Two watchers initially: `::a` (live until stable) and `1` (constant,
    // deregisters after first digest).
    expect((scope.$$watchers ?? []).filter((w) => w !== null).length).toBe(2);

    // First digest: `1` fires once and self-deregisters via the constant
    // delegate. `::a` fires its sentinel → undefined transition but remains
    // live because the value has not stabilized.
    scope.$digest();
    expect((scope.$$watchers ?? []).filter((w) => w !== null).length).toBe(1);

    // Stabilize `a` — the `::a` watcher deregisters post-digest.
    scope.a = 1;
    scope.$digest();
    expect((scope.$$watchers ?? []).filter((w) => w !== null).length).toBe(0);
  });

  it('deregisters every watcher for an all-constant group after the first digest', () => {
    // Parity with AngularJS rootScopeSpec "multi constant" case: a group
    // containing only constant expressions drops every watcher after the
    // first digest.
    const scope = Scope.create();
    scope.$watchGroup(['1', '2'], () => {});

    expect((scope.$$watchers ?? []).filter((w) => w !== null).length).toBe(2);

    scope.$digest();

    expect((scope.$$watchers ?? []).filter((w) => w !== null).length).toBe(0);
  });

  it('freezes the :: slot while adjacent live slots keep tracking in a mixed group', () => {
    // Parity with AngularJS rootScopeSpec "should maintain correct new/old
    // values with one time bindings" — scoped down to the one-time-specific
    // invariant. Verifies that once a `::b` entry stabilizes, its newValues
    // slot freezes while the adjacent live `b` slot keeps tracking. The
    // oldValues-snapshot semantics of $watchGroup are orthogonal to spec 010
    // and are not re-asserted here.
    const scope = Scope.create<{ a?: number; b?: number }>();
    let newValues: unknown[] | undefined;

    scope.$watchGroup(['a', '::b', 'b', '4'], (n) => {
      newValues = n.slice();
    });

    // First fire: all undefined except the constant `4`.
    scope.$digest();
    expect(newValues).toEqual([undefined, undefined, undefined, 4]);

    // Stabilize `a`: newValues tracks a=1, `::b` and `b` still undefined.
    scope.a = 1;
    scope.$digest();
    expect(newValues).toEqual([1, undefined, undefined, 4]);

    // Set `b = 2`: `::b` stabilizes to 2 (and deregisters post-digest); the
    // live `b` slot also tracks 2.
    scope.b = 2;
    scope.$digest();
    expect(newValues).toEqual([1, 2, 2, 4]);

    // Mutate `b` further: the `::b` slot must stay frozen at 2; only the
    // live `b` slot updates.
    scope.b = 3;
    scope.$digest();
    expect(newValues).toEqual([1, 2, 3, 4]);

    scope.b = 4;
    scope.$digest();
    expect(newValues).toEqual([1, 2, 4, 4]);
  });
});

describe('spec 010 — $watchCollection with ::', () => {
  it('defers the single fire until scope.items stabilizes, then deregisters', () => {
    const scope = Scope.create<{ items?: unknown[] }>();
    const listener = vi.fn();

    scope.$watchCollection('::items', listener);

    // Warm-up digest: `items` is undefined. $watchCollection's internalWatchFn
    // returns 0 on its first pass, which still differs from $watch's sentinel,
    // so the inner listener fires once with `newValue = undefined`. Clear the
    // spy to isolate the stabilization-triggered behavior. The watcher itself
    // is still live because newValue is undefined (not yet stabilized).
    scope.$digest();
    expect((scope.$$watchers ?? []).filter((w) => w !== null).length).toBe(1);
    listener.mockClear();

    // Stabilize `items` to an array — the collection watcher fires once with
    // the new snapshot and schedules post-digest deregistration.
    scope.items = [1, 2, 3];
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual([1, 2, 3]);
    // Deregistration ran in the post-digest queue of the same cycle.
    expect((scope.$$watchers ?? []).filter((w) => w !== null).length).toBe(0);

    // Run another digest to confirm deregistration is stable.
    listener.mockClear();
    scope.$digest();
    expect(listener).not.toHaveBeenCalled();

    // Mutating the array in place must not fire the listener — the watcher
    // is gone.
    scope.items.push(4);
    scope.$digest();
    expect(listener).not.toHaveBeenCalled();

    // Reassigning the reference must not fire either.
    scope.items = [5];
    scope.$digest();
    expect(listener).not.toHaveBeenCalled();
  });

  it('regression: $watchCollection("items", fn) retains live mutation tracking indefinitely', () => {
    const scope = Scope.create<{ items: unknown[] }>();
    scope.items = [1, 2];
    const listener = vi.fn();

    scope.$watchCollection('items', listener);

    // Initial fire with the current snapshot.
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual([1, 2]);

    // In-place push → fires.
    listener.mockClear();
    scope.items.push(3);
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual([1, 2, 3]);

    // In-place pop → fires.
    listener.mockClear();
    scope.items.pop();
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual([1, 2]);

    // Reassign reference → fires.
    listener.mockClear();
    scope.items = ['x'];
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual(['x']);

    // Watcher stays live across many digests.
    expect((scope.$$watchers ?? []).filter((w) => w !== null).length).toBe(1);
    for (let i = 0; i < 5; i++) scope.$digest();
    expect((scope.$$watchers ?? []).filter((w) => w !== null).length).toBe(1);
  });

  it('fires once for a constant collection expression and self-deregisters', () => {
    const scope = Scope.create();
    const listener = vi.fn();

    scope.$watchCollection('[1, 2, 3]', listener);

    // First digest: constant expression yields a fresh [1,2,3] and fires once.
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual([1, 2, 3]);
    // Post-digest deregistration ran in the same cycle.
    expect((scope.$$watchers ?? []).filter((w) => w !== null).length).toBe(0);

    // Further digests must not re-invoke the listener.
    scope.$digest();
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps :: watchers live forever when the target expression never stabilizes', () => {
    const scope = Scope.create<{ items?: unknown[] }>();
    const listener = vi.fn();

    scope.$watchCollection('::items', listener);

    // `items` stays undefined forever. The first digest fires the inner
    // listener once (sentinel → undefined transition), but the stabilization
    // predicate `newValue !== undefined` never holds, so the watcher stays
    // registered across subsequent digests.
    scope.$digest();
    listener.mockClear();

    for (let i = 0; i < 10; i++) scope.$digest();
    expect(listener).not.toHaveBeenCalled();
    expect((scope.$$watchers ?? []).filter((w) => w !== null).length).toBe(1);
  });

  it('stabilizes on a non-collection primitive value and deregisters', () => {
    const scope = Scope.create<{ value?: number }>();
    const listener = vi.fn();

    scope.$watchCollection('::value', listener);

    scope.$digest();
    listener.mockClear();

    // Stabilize to a primitive — the stability predicate (newValue !==
    // undefined) fires once and deregisters.
    scope.value = 42;
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toBe(42);
    expect((scope.$$watchers ?? []).filter((w) => w !== null).length).toBe(0);

    // Further reassignments must not fire the listener.
    listener.mockClear();
    scope.value = 99;
    scope.$digest();
    scope.$digest();
    expect(listener).not.toHaveBeenCalled();
  });

  it('stabilizes on a plain object value and deregisters', () => {
    const scope = Scope.create<{ obj?: Record<string, number> }>();
    const listener = vi.fn();

    scope.$watchCollection('::obj', listener);

    scope.$digest();
    listener.mockClear();

    // Stabilize to an object — fires once with the snapshot and deregisters.
    scope.obj = { x: 1 };
    scope.$digest();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual({ x: 1 });
    expect((scope.$$watchers ?? []).filter((w) => w !== null).length).toBe(0);

    // Mutating the object after deregistration must not fire the listener.
    listener.mockClear();
    scope.obj.y = 2;
    scope.$digest();
    scope.$digest();
    expect(listener).not.toHaveBeenCalled();
  });
});
