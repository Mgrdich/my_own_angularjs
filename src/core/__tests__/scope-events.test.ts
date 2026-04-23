import { describe, it, expect, vi } from 'vitest';
import { Scope, type ScopeEvent } from '@core/index';

describe('Scope', () => {
  describe('events', () => {
    it('registers a listener via $on that gets called when event fires', () => {
      const scope = new Scope();
      const listener = vi.fn();

      scope.$on('someEvent', listener);
      scope.$emit('someEvent');

      expect(listener).toHaveBeenCalled();
    });

    it('calls multiple listeners for the same event', () => {
      const scope = new Scope();
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      scope.$on('someEvent', listener1);
      scope.$on('someEvent', listener2);
      scope.$emit('someEvent');

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it('deregisters a listener when the returned function is called', () => {
      const scope = new Scope();
      const listener = vi.fn();

      const deregister = scope.$on('someEvent', listener);
      deregister();
      scope.$emit('someEvent');

      expect(listener).not.toHaveBeenCalled();
    });

    it('does not skip listeners when a listener is deregistered during event fire', () => {
      const scope = new Scope();
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const listener3 = vi.fn();

      const deregister1 = scope.$on('someEvent', () => {
        deregister1();
        listener1();
      });
      scope.$on('someEvent', listener2);
      scope.$on('someEvent', listener3);

      scope.$emit('someEvent');

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
      expect(listener3).toHaveBeenCalled();
    });

    it('propagates $emit up the scope hierarchy', () => {
      const parent = new Scope();
      const scope = parent.$new();
      const child = scope.$new();

      const parentListener = vi.fn();
      const scopeListener = vi.fn();
      const childListener = vi.fn();

      parent.$on('someEvent', parentListener);
      scope.$on('someEvent', scopeListener);
      child.$on('someEvent', childListener);

      scope.$emit('someEvent');

      expect(scopeListener).toHaveBeenCalled();
      expect(parentListener).toHaveBeenCalled();
      expect(childListener).not.toHaveBeenCalled();
    });

    it('propagates $broadcast down the scope hierarchy', () => {
      const parent = new Scope();
      const scope = parent.$new();
      const child = scope.$new();
      const sibling = parent.$new();

      const parentListener = vi.fn();
      const scopeListener = vi.fn();
      const childListener = vi.fn();
      const siblingListener = vi.fn();

      parent.$on('someEvent', parentListener);
      scope.$on('someEvent', scopeListener);
      child.$on('someEvent', childListener);
      sibling.$on('someEvent', siblingListener);

      scope.$broadcast('someEvent');

      expect(scopeListener).toHaveBeenCalled();
      expect(childListener).toHaveBeenCalled();
      expect(parentListener).not.toHaveBeenCalled();
      expect(siblingListener).not.toHaveBeenCalled();
    });

    it('has the correct event object shape with name, targetScope, currentScope, and defaultPrevented', () => {
      const parent = new Scope();
      const scope = parent.$new();

      parent.$on('someEvent', () => {
        // listener present to verify propagation
      });

      const event = scope.$emit('someEvent');

      expect(event.name).toBe('someEvent');
      expect(event.targetScope).toBe(scope);
      expect(event.defaultPrevented).toBe(false);
    });

    it('sets currentScope on the event object during propagation', () => {
      const parent = new Scope();
      const scope = parent.$new();
      let currentScopeOnParent: Scope | null = null;
      let currentScopeOnScope: Scope | null = null;

      scope.$on('someEvent', (event) => {
        currentScopeOnScope = event.currentScope;
      });
      parent.$on('someEvent', (event) => {
        currentScopeOnParent = event.currentScope;
      });

      scope.$emit('someEvent');

      expect(currentScopeOnScope).toBe(scope);
      expect(currentScopeOnParent).toBe(parent);
    });

    it('sets currentScope to null after $emit propagation completes', () => {
      const scope = new Scope();

      const event = scope.$emit('someEvent');

      expect(event.currentScope).toBeNull();
    });

    it('sets currentScope to null after $broadcast propagation completes', () => {
      const scope = new Scope();

      const event = scope.$broadcast('someEvent');

      expect(event.currentScope).toBeNull();
    });

    it('stops upward propagation when stopPropagation is called on $emit', () => {
      const parent = new Scope();
      const scope = parent.$new();

      const scopeListener = vi.fn((event: ScopeEvent) => {
        event.stopPropagation();
      });
      const parentListener = vi.fn();

      scope.$on('someEvent', scopeListener);
      parent.$on('someEvent', parentListener);

      scope.$emit('someEvent');

      expect(scopeListener).toHaveBeenCalled();
      expect(parentListener).not.toHaveBeenCalled();
    });

    it('does not stop $broadcast propagation when stopPropagation is called', () => {
      const parent = new Scope();
      const scope = parent.$new();
      const child = scope.$new();

      const scopeListener = vi.fn((event: ScopeEvent) => {
        event.stopPropagation();
      });
      const childListener = vi.fn();

      scope.$on('someEvent', scopeListener);
      child.$on('someEvent', childListener);

      scope.$broadcast('someEvent');

      expect(scopeListener).toHaveBeenCalled();
      expect(childListener).toHaveBeenCalled();
    });

    it('sets defaultPrevented to true when preventDefault is called', () => {
      const scope = new Scope();

      scope.$on('someEvent', (event) => {
        event.preventDefault();
      });

      const event = scope.$emit('someEvent');

      expect(event.defaultPrevented).toBe(true);
    });

    it('passes additional arguments to listeners', () => {
      const scope = new Scope();
      let receivedArgs: unknown[] = [];

      scope.$on('someEvent', (_event, ...args) => {
        receivedArgs = args;
      });

      scope.$emit('someEvent', 'arg1', 'arg2', 'arg3');

      expect(receivedArgs).toEqual(['arg1', 'arg2', 'arg3']);
    });

    it('passes additional arguments to listeners on $broadcast', () => {
      const scope = new Scope();
      let receivedArgs: unknown[] = [];

      scope.$on('someEvent', (_event, ...args) => {
        receivedArgs = args;
      });

      scope.$broadcast('someEvent', 'arg1', 'arg2');

      expect(receivedArgs).toEqual(['arg1', 'arg2']);
    });

    it('does not let an error in one listener prevent other listeners from firing', () => {
      const scope = new Scope();
      const listener1 = vi.fn(() => {
        throw new Error('listener1 error');
      });
      const listener2 = vi.fn();

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      scope.$on('someEvent', listener1);
      scope.$on('someEvent', listener2);

      scope.$emit('someEvent');

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('broadcasts a $destroy event when $destroy is called', () => {
      const parent = new Scope();
      const scope = parent.$new();
      const listener = vi.fn();

      scope.$on('$destroy', listener);

      scope.$destroy();

      expect(listener).toHaveBeenCalled();
    });

    it('broadcasts $destroy to child scopes before cleanup', () => {
      const parent = new Scope();
      const scope = parent.$new();
      const child = scope.$new();
      const childListener = vi.fn();

      child.$on('$destroy', childListener);

      scope.$destroy();

      expect(childListener).toHaveBeenCalled();
    });

    it('$emit still calls remaining listeners on same scope after stopPropagation', () => {
      const parent = new Scope();
      const scope = parent.$new();
      const listener1 = vi.fn((event: ScopeEvent) => {
        event.stopPropagation();
      });
      const listener2 = vi.fn();
      const parentListener = vi.fn();

      scope.$on('someEvent', listener1);
      scope.$on('someEvent', listener2);
      parent.$on('someEvent', parentListener);

      scope.$emit('someEvent');

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
      expect(parentListener).not.toHaveBeenCalled();
    });

    it('no listeners fire after $destroy', () => {
      const parent = new Scope();
      const scope = parent.$new();
      const listener = vi.fn();

      scope.$on('someEvent', listener);
      scope.$destroy();
      listener.mockClear();

      scope.$emit('someEvent');

      expect(listener).not.toHaveBeenCalled();
    });

    it('separate $$listeners per scope', () => {
      const parent = new Scope();
      const child = parent.$new();
      const isolatedChild = parent.$new(true);

      expect(parent.$$listeners).not.toBe(child.$$listeners);
      expect(parent.$$listeners).not.toBe(isolatedChild.$$listeners);
      expect(child.$$listeners).not.toBe(isolatedChild.$$listeners);
    });

    it('currentScope during $broadcast equals each scope as it traverses', () => {
      const parent = new Scope();
      const child = parent.$new();
      const grandchild = child.$new();
      const currentScopes: (Scope | null)[] = [];

      parent.$on('someEvent', (event) => {
        currentScopes.push(event.currentScope);
      });
      child.$on('someEvent', (event) => {
        currentScopes.push(event.currentScope);
      });
      grandchild.$on('someEvent', (event) => {
        currentScopes.push(event.currentScope);
      });

      parent.$broadcast('someEvent');

      expect(currentScopes).toEqual([parent, child, grandchild]);
    });

    it('targetScope on $broadcast equals the originating scope', () => {
      const parent = new Scope();
      const child = parent.$new();
      const targetScopes: (Scope | null)[] = [];

      parent.$on('someEvent', (event) => {
        targetScopes.push(event.targetScope);
      });
      child.$on('someEvent', (event) => {
        targetScopes.push(event.targetScope);
      });

      parent.$broadcast('someEvent');

      expect(targetScopes[0]).toBe(parent);
      expect(targetScopes[1]).toBe(parent);
    });

    it('event listener removal by a previous listener prevents removed listener from firing', () => {
      const scope = new Scope();
      const listenerB = vi.fn();
      const deregisterB = scope.$on('someEvent', listenerB);

      scope.$on('someEvent', () => {
        deregisterB();
      });

      // listenerB is registered first but deregisterA sets it to null mid-iteration
      // Due to iteration order, listenerB is at index 0 and has already fired,
      // but let's test when A removes B where B is registered after A
      const scope2 = new Scope();
      const listenerB2 = vi.fn();

      const holder: { deregB2: () => void } = { deregB2: () => {} };
      scope2.$on('someEvent', () => {
        holder.deregB2();
      });
      holder.deregB2 = scope2.$on('someEvent', listenerB2);

      scope2.$emit('someEvent');

      // listenerB2 should NOT fire because listener A (index 0) deregistered it (set to null)
      expect(listenerB2).not.toHaveBeenCalled();
    });

    it('recursive $emit does not cause infinite loops', () => {
      const scope = new Scope();
      let emitCount = 0;

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      scope.$on('someEvent', () => {
        emitCount++;
        if (emitCount < 3) {
          scope.$emit('someEvent');
        }
      });

      scope.$emit('someEvent');

      expect(emitCount).toBe(3);

      consoleSpy.mockRestore();
    });
  });
});
