import { describe, it, expect, vi } from 'vitest';
import { Scope } from '@core/index';

describe('Scope', () => {
  describe('inheritance', () => {
    it('inherits parent properties via prototype chain', () => {
      const parent = Scope.create<{ aValue: number[] }>();
      parent.aValue = [1, 2, 3];

      const child = parent.$new();

      expect(child.aValue).toBe(parent.aValue);
    });

    it('does not affect parent when assigning on child (property shadowing)', () => {
      const parent = Scope.create<{ name: string }>();
      parent.name = 'Joe';

      const child = parent.$new() as Scope & { name: string };
      child.name = 'Jill';

      expect(child.name).toBe('Jill');
      expect(parent.name).toBe('Joe');
    });

    it('sees parent property changes through prototype chain', () => {
      const parent = Scope.create<{ aValue: number[] }>();
      parent.aValue = [1, 2, 3];

      const child = parent.$new();

      parent.aValue.push(4);

      expect(child.aValue).toEqual([1, 2, 3, 4]);
    });

    it('digests child watchers when parent digest is called', () => {
      const parent = Scope.create<{ aValue: string }>();
      parent.aValue = 'abc';

      const child = parent.$new();
      const listenerFn = vi.fn();

      child.$watch(() => child.aValue, listenerFn);

      parent.$digest();

      expect(listenerFn).toHaveBeenCalled();
    });

    it('does NOT inherit parent properties when isolated', () => {
      const parent = Scope.create<{ aValue: string }>();
      parent.aValue = 'abc';

      const child = parent.$new(true);

      expect(child.aValue).toBeUndefined();
    });

    it('shares $$asyncQueue with root when isolated', () => {
      const parent = new Scope();
      const child = parent.$new(true);

      expect(child.$$asyncQueue).toBe(parent.$$asyncQueue);
    });

    it('digests isolated child watchers when parent digest is called', () => {
      const parent = new Scope();
      const child = parent.$new(true);
      const listenerFn = vi.fn();

      child.$watch(() => 'value', listenerFn);

      parent.$digest();

      expect(listenerFn).toHaveBeenCalled();
    });

    it('sets $parent to custom parent when provided', () => {
      const parentScope = new Scope();
      const customParent = parentScope.$new();
      const child = parentScope.$new(false, customParent);

      expect(child.$parent).toBe(customParent);
      expect(customParent.$$children).toContain(child);
    });

    it('digests arbitrarily nested scope watchers', () => {
      const parent = new Scope();
      const child = parent.$new();
      const grandchild = child.$new();
      const listenerFn = vi.fn();

      grandchild.$watch(() => 'value', listenerFn);

      parent.$digest();

      expect(listenerFn).toHaveBeenCalled();
    });

    it('child $digest does NOT trigger parent watchers', () => {
      const parent = Scope.create<{ aValue: string }>();
      parent.aValue = 'abc';
      const child = parent.$new();
      const parentListener = vi.fn();

      parent.$watch(() => parent.aValue, parentListener);

      child.$digest();

      expect(parentListener).not.toHaveBeenCalled();
    });

    it('$apply digests from root, triggering parent watchers', () => {
      const parent = Scope.create<{ aValue: string }>();
      parent.aValue = 'abc';
      const child = parent.$new();
      const parentListener = vi.fn();

      parent.$watch(() => parent.aValue, parentListener);

      child.$apply(() => {
        /* noop */
      });

      expect(parentListener).toHaveBeenCalled();
    });

    it('$evalAsync digests from root, triggering parent watchers', () => {
      vi.useFakeTimers();
      const parent = Scope.create<{ aValue: string }>();
      parent.aValue = 'abc';
      const child = parent.$new();
      const parentListener = vi.fn();

      parent.$watch(() => parent.aValue, parentListener);

      child.$evalAsync(() => {
        /* noop */
      });

      vi.advanceTimersByTime(0);

      expect(parentListener).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('isolated scope $apply digests from root', () => {
      const parent = Scope.create<{ aValue: string }>();
      parent.aValue = 'abc';
      const isolatedChild = parent.$new(true);
      const parentListener = vi.fn();

      parent.$watch(() => parent.aValue, parentListener);

      isolatedChild.$apply(() => {
        /* noop */
      });

      expect(parentListener).toHaveBeenCalled();
    });

    it('isolated scope $evalAsync digests from root', () => {
      vi.useFakeTimers();
      const parent = Scope.create<{ aValue: string }>();
      parent.aValue = 'abc';
      const isolatedChild = parent.$new(true);
      const parentListener = vi.fn();

      parent.$watch(() => parent.aValue, parentListener);

      isolatedChild.$evalAsync(() => {
        /* noop */
      });

      vi.advanceTimersByTime(0);

      expect(parentListener).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('$evalAsync executes on isolated scope context', () => {
      const parent = new Scope();
      const isolatedChild = parent.$new(true) as Scope & { value: number };

      isolatedChild.$evalAsync((s) => {
        (s as Scope & { value: number }).value = 1;
      });

      parent.$digest();

      expect(isolatedChild.value).toBe(1);
    });

    it('$$postDigest runs on isolated scope', () => {
      const parent = new Scope();
      const isolatedChild = parent.$new(true);
      let postDigestRan = false;

      isolatedChild.$$postDigest(() => {
        postDigestRan = true;
      });

      parent.$digest();

      expect(postDigestRan).toBe(true);
    });

    it('cannot watch parent attributes when isolated', () => {
      const parent = Scope.create<{ parentProp: string }>();
      parent.parentProp = 'hello';
      const isolatedChild = parent.$new(true);
      let watchedValue: unknown = 'not-set';

      isolatedChild.$watch(
        (scope) => (scope as Scope & { parentProp: string }).parentProp,
        (newValue: unknown) => {
          watchedValue = newValue;
        },
      );

      parent.$digest();

      expect(watchedValue).toBeUndefined();
    });

    it('inherits parent properties defined after $new', () => {
      const parent = new Scope();
      const child = parent.$new();

      parent['newProp'] = 1;

      expect(child['newProp']).toBe(1);
    });

    it('child does not cause parent to inherit its properties', () => {
      const parent = new Scope();
      const child = parent.$new();

      (child as Scope & { childProp: number }).childProp = 1;

      expect(parent['childProp']).toBeUndefined();
    });

    it('does not shadow parent reference-type members', () => {
      const parent = Scope.create<{ user: { name: string } }>();
      parent.user = { name: 'Joe' };

      const child = parent.$new() as Scope & { user: { name: string } };
      child.user.name = 'Jill';

      expect(parent.user.name).toBe('Jill');
    });

    it('$root points to root scope', () => {
      const root = new Scope();
      const child = root.$new();
      const grandchild = child.$new();

      expect(root.$root).toBe(root);
      expect(child.$root).toBe(root);
      expect(grandchild.$root).toBe(root);
    });

    it('$parent chain is correct', () => {
      const root = new Scope();
      const child = root.$new();
      const grandchild = child.$new();

      expect(root.$parent).toBeNull();
      expect(child.$parent).toBe(root);
      expect(grandchild.$parent).toBe(child);
    });
  });

  describe('$destroy', () => {
    it('removes scope from parent $$children', () => {
      const parent = new Scope();
      const child = parent.$new();

      expect(parent.$$children).toContain(child);

      child.$destroy();

      expect(parent.$$children).not.toContain(child);
    });

    it('nullifies $$watchers so digest skips it', () => {
      const parent = Scope.create<{ aValue: string }>();
      parent.aValue = 'abc';

      const child = parent.$new();
      const listenerFn = vi.fn();

      child.$watch(() => parent.aValue, listenerFn);

      parent.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      child.$destroy();
      parent.aValue = 'def';
      parent.$digest();

      expect(listenerFn).toHaveBeenCalledTimes(1);
    });

    it('clears $$listeners', () => {
      const parent = new Scope();
      const child = parent.$new();

      child.$$listeners = { someEvent: [vi.fn()] };

      child.$destroy();

      expect(child.$$listeners).toEqual({});
    });

    it('does not throw on root scope destroy', () => {
      const scope = new Scope();

      expect(() => {
        scope.$destroy();
      }).not.toThrow();
    });

    it('$destroy is idempotent: calling twice does not throw', () => {
      const parent = new Scope();
      const child = parent.$new();

      child.$destroy();

      expect(() => {
        child.$destroy();
      }).not.toThrow();
    });

    it('after $destroy, $apply is a no-op (watch silently ignored)', () => {
      const parent = new Scope();
      const child = parent.$new();
      const listenerFn = vi.fn();

      child.$watch(() => 'value', listenerFn);

      child.$destroy();
      listenerFn.mockClear();

      // $watch on a destroyed scope returns a noop deregister
      const deregister = child.$watch(() => 'anotherValue', vi.fn());
      expect(typeof deregister).toBe('function');

      parent.$digest();

      expect(listenerFn).not.toHaveBeenCalled();
    });

    it('$destroy preserves model properties', () => {
      const parent = Scope.create<{ parentProp: string }>();
      parent.parentProp = 'parent';
      const child = parent.$new() as Scope & { childProp: string; parentProp: string };
      child.childProp = 'child';

      child.$destroy();

      // Own properties remain accessible
      expect(child.childProp).toBe('child');
      // Inherited properties remain accessible via prototype
      expect(child.parentProp).toBe('parent');
    });
  });
});
