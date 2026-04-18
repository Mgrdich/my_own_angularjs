import { parse } from '@parser/index';
import {
  initWatchVal,
  type AsyncTask,
  type EventListener,
  type ListenerFn,
  type Parsable,
  type ScopeEvent,
  type ScopeOptions,
  type ScopePhase,
  type TypedScope,
  type Watcher,
  type WatchFn,
} from './scope-types';
import { isEqual } from './utils';

/** Maximum number of digest iterations before throwing. */
const TTL = 10;

/** No-op listener used when $watch is called without a listenerFn. */
const noop: ListenerFn<unknown> = () => {
  /* intentionally empty */
};

/**
 * Compile a Parsable expression into a WatchFn. Accepts either a function
 * (returned as-is) or a string (parsed once via the expression parser).
 *
 * Parsing errors surface immediately at the call site, not during digest.
 */
function compileToWatchFn<T>(expr: Parsable<T>): WatchFn<T> {
  if (typeof expr === 'function') {
    return expr;
  }
  const exprFn = parse(expr);
  return (scope: Scope) => exprFn(scope as unknown as Record<string, unknown>) as T;
}

/** Auto-incrementing counter for unique scope IDs. */
let nextId = 0;

/**
 * Core Scope class implementing dirty-checking and digest cycle.
 *
 * Use {@link Scope.create} for typed property access:
 *
 * ```ts
 * const scope = Scope.create<{ count: number }>();
 * scope.count = 0;   // typed as number
 * ```
 */
export class Scope {
  [key: string]: unknown;

  readonly $id: number;
  $root: Scope;
  $parent: Scope | null;
  $$watchers: (Watcher<unknown> | null)[] | null;
  $$children: Scope[];
  $$listeners: Record<string, (EventListener | null)[]>;
  $$asyncQueue: AsyncTask[];
  $$applyAsyncQueue: AsyncTask[];
  $$postDigestQueue: (() => void)[];
  $$lastDirtyWatch: Watcher<unknown> | null;
  $$applyAsyncId: ReturnType<typeof setTimeout> | null;
  $$phase: ScopePhase;
  $$ttl: number;

  constructor() {
    this.$id = nextId++;
    this.$root = this;
    this.$parent = null;
    this.$$watchers = [];
    this.$$children = [];
    this.$$listeners = {};
    this.$$asyncQueue = [];
    this.$$applyAsyncQueue = [];
    this.$$postDigestQueue = [];
    this.$$lastDirtyWatch = null;
    this.$$applyAsyncId = null;
    this.$$phase = null;
    this.$$ttl = TTL;
  }

  /** Create a typed Scope instance with compile-time property access. */
  static create<T extends Record<string, unknown> = Record<string, unknown>>(options?: ScopeOptions) {
    if (options?.ttl !== undefined && options.ttl < 2) {
      throw new Error('TTL must be at least 2');
    }
    const scope = new Scope();
    scope.$$ttl = options?.ttl ?? TTL;
    return scope as TypedScope<T>;
  }

  /**
   * Register a watcher on this scope.
   *
   * @param watchFn - Expression evaluated on every digest cycle
   * @param listenerFn - Called when the watched value changes
   * @param valueEq - Whether to use deep equality (not implemented in Slice 1)
   * @returns A function that deregisters the watcher when called
   */
  $watch<W>(watchFn: Parsable<W>, listenerFn?: ListenerFn<W>, valueEq?: boolean) {
    const watchFnCompiled = compileToWatchFn(watchFn);
    const watcher: Watcher<W> = {
      watchFn: watchFnCompiled,
      listenerFn: listenerFn ?? noop,
      last: initWatchVal,
      valueEq: valueEq ?? false,
    };

    if (this.$$watchers === null) {
      // Scope has been destroyed; silently ignore
      return () => {
        /* noop for destroyed scope */
      };
    }

    this.$$watchers.push(watcher as Watcher<unknown>);

    // Reset short-circuit optimization on root to prevent stale references
    this.$root.$$lastDirtyWatch = null;

    return () => {
      const index = this.$$watchers?.indexOf(watcher as Watcher<unknown>);
      if (index !== undefined && index >= 0 && this.$$watchers !== null) {
        this.$$watchers[index] = null;
        this.$root.$$lastDirtyWatch = null;
      }
    };
  }

  /**
   * Create a child scope.
   *
   * @param isolated - If true, create an isolated scope (no prototypal inheritance)
   * @param parent - Optional parent scope for hierarchy (defaults to `this`)
   * @returns The new child scope
   */
  $new(isolated?: boolean, parent?: Scope) {
    const effectiveParent = parent ?? this;
    let child: Scope;

    if (isolated) {
      child = new Scope();
      child.$root = this.$root;
      child.$$ttl = this.$root.$$ttl;
      child.$$asyncQueue = this.$$asyncQueue;
      child.$$applyAsyncQueue = this.$$applyAsyncQueue;
      child.$$postDigestQueue = this.$$postDigestQueue;
    } else {
      child = Object.create(this) as Scope;
      child.$$watchers = [];
      child.$$children = [];
      child.$$listeners = {};
    }

    Object.defineProperty(child, '$id', { value: nextId++, writable: false });
    child.$parent = effectiveParent;
    effectiveParent.$$children.push(child);

    return child;
  }

  /**
   * Traverse the scope tree, calling `fn` on each scope.
   * Stops early and returns `false` if `fn` returns `false` for any scope.
   *
   * @param fn - Predicate to call on each scope
   * @returns `true` if all scopes returned `true`, `false` otherwise
   */
  $$everyScope(fn: (scope: Scope) => boolean): boolean {
    if (fn(this)) {
      return this.$$children.every((child) => child.$$everyScope(fn));
    }
    return false;
  }

  /**
   * Execute a single digest pass over all watchers across the scope hierarchy.
   * Iterates in reverse order for safe deregistration during iteration.
   *
   * @returns true if any watcher was dirty during this pass
   */
  $$digestOnce() {
    let dirty = false;

    this.$$everyScope((scope) => {
      const watchers = scope.$$watchers;

      if (watchers === null) {
        return true;
      }

      const length = watchers.length;
      for (let i = length - 1; i >= 0; i--) {
        const watcher = watchers[i];

        if (watcher === null || watcher === undefined) {
          continue;
        }

        try {
          const newValue = watcher.watchFn(scope);
          const oldValue = watcher.last;

          if (!this.$$areEqual(newValue, oldValue, watcher.valueEq)) {
            this.$root.$$lastDirtyWatch = watcher;
            watcher.last = watcher.valueEq ? structuredClone(newValue) : newValue;

            const listenerOldValue = oldValue === initWatchVal ? newValue : oldValue;

            try {
              watcher.listenerFn(newValue, listenerOldValue, scope);
            } catch (e) {
              // Log listener errors but do not abort the digest
              console.error('Error in watch listener:', e);
            }

            dirty = true;
          } else if (this.$root.$$lastDirtyWatch === watcher) {
            // Short-circuit: no more dirty watchers after this point
            return false;
          }
        } catch (e) {
          // Log watch function errors but do not abort the digest
          console.error('Error in watch function:', e);
        }
      }

      return true;
    });

    return dirty;
  }

  /**
   * Run the full digest cycle, looping until all watchers are clean
   * or the TTL is exceeded.
   *
   * @throws When the digest does not stabilize within TTL iterations
   */
  $digest() {
    let ttl = this.$root.$$ttl;
    let dirty: boolean;

    this.$root.$$lastDirtyWatch = null;
    this.$beginPhase('$digest');

    try {
      do {
        // Drain the async queue
        while (this.$$asyncQueue.length > 0) {
          const asyncTask = this.$$asyncQueue.shift();
          if (asyncTask) {
            try {
              asyncTask.scope.$eval(asyncTask.expression);
            } catch (e) {
              console.error('Error in $evalAsync expression:', e);
            }
          }
        }

        dirty = this.$$digestOnce();

        if ((dirty || this.$$asyncQueue.length > 0) && --ttl <= 0) {
          this.$clearPhase();
          const lastDirtyWatch = this.$root.$$lastDirtyWatch as Watcher<unknown> | null;
          const lastDirtyInfo =
            lastDirtyWatch !== null ? `\nLast dirty watcher: ${lastDirtyWatch.watchFn.toString()}` : '';
          const ttlValue = String(this.$root.$$ttl);
          throw new Error(`${ttlValue} digest iterations reached. Aborting!${lastDirtyInfo}`);
        }
      } while (dirty || this.$$asyncQueue.length > 0);
      // Flush any pending $applyAsync during the active digest
      if (this.$root.$$applyAsyncId !== null) {
        clearTimeout(this.$root.$$applyAsyncId);
        this.$$flushApplyAsync();
      }
    } finally {
      this.$clearPhase();
    }

    // Drain the post-digest queue
    while (this.$$postDigestQueue.length > 0) {
      const fn = this.$$postDigestQueue.shift();
      if (fn) {
        try {
          fn();
        } catch (e) {
          console.error('Error in $$postDigest function:', e);
        }
      }
    }
  }

  /**
   * Execute an expression in the context of this scope.
   *
   * @param expr - Function to evaluate with this scope as first argument
   * @param locals - Optional locals object passed as second argument
   * @returns The result of the expression, or undefined if no expr provided
   */
  $eval<R>(expr?: Parsable<R> | ((scope: Scope, locals?: unknown) => R), locals?: unknown) {
    if (typeof expr === 'string') {
      const exprFn = parse(expr);
      return exprFn(this as unknown as Record<string, unknown>, locals as Record<string, unknown> | undefined) as R;
    }
    if (typeof expr === 'function') {
      return expr(this, locals);
    }
    return undefined;
  }

  /**
   * Execute an expression and then trigger a digest cycle from the root.
   *
   * @param expr - Optional expression to evaluate before digesting
   * @returns The result of the expression
   */
  $apply<R>(expr?: Parsable<R>) {
    this.$beginPhase('$apply');
    try {
      return this.$eval(expr);
    } finally {
      this.$clearPhase();
      this.$root.$digest();
    }
  }

  /**
   * Destroy this scope, removing it from the scope hierarchy.
   * Broadcasts a `$destroy` event to this scope and all descendants before cleanup.
   * Clears watchers and listeners to prevent further digest participation.
   */
  $destroy() {
    if (this === this.$root) {
      return;
    }

    this.$broadcast('$destroy');

    const parent = this.$parent;
    if (parent) {
      const index = parent.$$children.indexOf(this);
      if (index >= 0) {
        parent.$$children.splice(index, 1);
      }
    }

    this.$$watchers = null;
    this.$$listeners = {};
  }

  /**
   * Queue an expression for deferred execution within the current or next digest.
   * If no digest is already in progress, schedules one via setTimeout.
   */
  $evalAsync(expr: Parsable<unknown>) {
    const exprFn = compileToWatchFn(expr);
    if (!this.$root.$$phase && this.$root.$$asyncQueue.length === 0) {
      setTimeout(() => {
        if (this.$root.$$asyncQueue.length > 0) {
          this.$root.$digest();
        }
      });
    }
    this.$$asyncQueue.push({ scope: this, expression: exprFn });
  }

  /**
   * Coalesce multiple apply calls into a single setTimeout + $apply.
   * All queued expressions are flushed together in one digest cycle.
   */
  $applyAsync(expr: Parsable<unknown>) {
    const exprFn = compileToWatchFn(expr);
    this.$$applyAsyncQueue.push({ scope: this, expression: exprFn });

    if (this.$root.$$applyAsyncId === null) {
      this.$root.$$applyAsyncId = setTimeout(() => {
        this.$apply(() => {
          this.$$flushApplyAsync();
        });
      });
    }
  }

  /**
   * Register a function to run once after the next digest cycle completes.
   * The function is not run inside the digest and will not trigger further digestion.
   */
  $$postDigest(fn: () => void) {
    this.$$postDigestQueue.push(fn);
  }

  /**
   * Watch a group of expressions and call the listener once per digest
   * with arrays of new and old values when any watched value changes.
   *
   * @param watchFns - Array of watch functions to observe
   * @param listenerFn - Called with [newValues[], oldValues[], scope]
   * @returns A function that deregisters all grouped watchers
   */
  $watchGroup(watchFns: Parsable<unknown>[], listenerFn: ListenerFn<unknown[]>) {
    const compiled = watchFns.map(compileToWatchFn);
    const newValues: unknown[] = new Array(compiled.length);
    const oldValues: unknown[] = new Array(compiled.length);
    let changeReactionScheduled = false;
    let firstRun = true;

    if (compiled.length === 0) {
      let shouldCall = true;
      this.$evalAsync(() => {
        if (shouldCall) {
          listenerFn(newValues, newValues, this);
        }
      });
      return () => {
        shouldCall = false;
      };
    }

    const watchGroupListener = () => {
      if (firstRun) {
        firstRun = false;
        listenerFn(newValues, newValues, this);
      } else {
        listenerFn(newValues, oldValues, this);
      }
      changeReactionScheduled = false;
    };

    const deregisterFns = compiled.map((watchFn, i) => {
      return this.$watch(watchFn, (newValue, oldValue) => {
        newValues[i] = newValue;
        oldValues[i] = oldValue;
        if (!changeReactionScheduled) {
          changeReactionScheduled = true;
          this.$evalAsync(watchGroupListener);
        }
      });
    });

    return () => {
      deregisterFns.forEach((deregisterFn) => {
        deregisterFn();
      });
    };
  }

  /**
   * Shallow collection watcher that detects element-level changes in arrays
   * and property-level changes in objects without deep comparison.
   *
   * Uses a change-counter pattern internally: the internal watch function
   * returns an incrementing integer whenever a shallow change is detected,
   * which triggers the standard $watch dirty-check mechanism.
   *
   * @param watchFn - Expression returning the collection (array/object) to watch
   * @param listenerFn - Called with (newValue, oldValue, scope) when changes are detected
   * @returns A function that deregisters the watcher when called
   */
  $watchCollection(watchFn: Parsable<unknown>, listenerFn: ListenerFn<unknown>) {
    const watchFnCompiled = compileToWatchFn(watchFn);
    let changeCount = 0;
    let oldValue: unknown;
    let newValue: unknown;
    let oldLength: number;
    let veryOldValue: unknown;
    const trackVeryOldValue = listenerFn.length > 1;
    let firstRun = true;

    const internalWatchFn = (scope: Scope) => {
      newValue = watchFnCompiled(scope);

      if (Array.isArray(newValue)) {
        if (!Array.isArray(oldValue)) {
          changeCount++;
          oldValue = [];
        }

        const oldArr = oldValue as unknown[];
        const newArr = newValue as unknown[];

        if (oldArr.length !== newArr.length) {
          changeCount++;
          oldArr.length = newArr.length;
        }

        for (let i = 0; i < newArr.length; i++) {
          const bothNaN =
            typeof newArr[i] === 'number' &&
            isNaN(newArr[i] as number) &&
            typeof oldArr[i] === 'number' &&
            isNaN(oldArr[i] as number);

          if (!bothNaN && newArr[i] !== oldArr[i]) {
            changeCount++;
            oldArr[i] = newArr[i];
          }
        }
      } else if (typeof newValue === 'object' && newValue !== null) {
        if (typeof oldValue !== 'object' || oldValue === null || Array.isArray(oldValue)) {
          changeCount++;
          oldValue = {};
          oldLength = 0;
        }

        const oldObj = oldValue as Record<string, unknown>;
        const newObj = newValue as Record<string, unknown>;
        let newLength = 0;

        for (const key of Object.keys(newObj)) {
          newLength++;
          if (Object.prototype.hasOwnProperty.call(oldObj, key)) {
            const bothNaN =
              typeof newObj[key] === 'number' &&
              isNaN(newObj[key]) &&
              typeof oldObj[key] === 'number' &&
              isNaN(oldObj[key]);

            if (!bothNaN && oldObj[key] !== newObj[key]) {
              changeCount++;
              oldObj[key] = newObj[key];
            }
          } else {
            changeCount++;
            oldLength++;
            oldObj[key] = newObj[key];
          }
        }

        if (oldLength > newLength) {
          changeCount++;
          for (const key of Object.keys(oldObj)) {
            if (!Object.prototype.hasOwnProperty.call(newObj, key)) {
              oldLength--;
              Reflect.deleteProperty(oldObj, key);
            }
          }
        }

        oldLength = newLength;
      } else {
        // Primitive value
        const bothNaN =
          typeof newValue === 'number' && isNaN(newValue) && typeof oldValue === 'number' && isNaN(oldValue);

        if (!bothNaN && oldValue !== newValue) {
          changeCount++;
          oldValue = newValue;
        }
      }

      return changeCount;
    };

    const internalListenerFn = () => {
      if (firstRun) {
        firstRun = false;
        listenerFn(newValue, newValue, this);
      } else {
        listenerFn(newValue, veryOldValue, this);
      }

      if (trackVeryOldValue) {
        if (Array.isArray(newValue)) {
          veryOldValue = [...(newValue as unknown[])];
        } else if (typeof newValue === 'object' && newValue !== null) {
          veryOldValue = { ...(newValue as Record<string, unknown>) };
        } else {
          veryOldValue = newValue;
        }
      }
    };

    return this.$watch(internalWatchFn, internalListenerFn);
  }

  /**
   * Register a listener for a named scope event.
   *
   * @param eventName - The event name to listen for
   * @param listener - Callback invoked when the event fires
   * @returns A function that deregisters the listener when called
   */
  $on(eventName: string, listener: EventListener) {
    let listeners = this.$$listeners[eventName];
    if (!listeners) {
      listeners = [];
      this.$$listeners[eventName] = listeners;
    }
    listeners.push(listener);

    return () => {
      const idx = listeners.indexOf(listener);
      if (idx >= 0) {
        listeners[idx] = null;
      }
    };
  }

  /**
   * Emit an event upward through the scope hierarchy from this scope to the root.
   * Propagation stops if `stopPropagation()` is called on the event object.
   *
   * @param eventName - The event name to emit
   * @param args - Additional arguments passed to each listener after the event object
   * @returns The event object
   */
  $emit(eventName: string, ...args: unknown[]) {
    const state = { propagationStopped: false };

    const event: ScopeEvent = {
      name: eventName,
      targetScope: this,
      currentScope: this,
      defaultPrevented: false,
      stopPropagation(): void {
        state.propagationStopped = true;
      },
      preventDefault(): void {
        this.defaultPrevented = true;
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-this-alias -- walking the scope chain requires a mutable reference
    let scope: Scope | null = this;
    while (scope) {
      scope.$$fireEventOnScope(event, args);
      if (state.propagationStopped) {
        break;
      }
      scope = scope.$parent;
    }

    event.currentScope = null;
    return event;
  }

  /**
   * Broadcast an event downward through the scope hierarchy to this scope and all descendants.
   * `stopPropagation` has no effect on broadcast traversal.
   *
   * @param eventName - The event name to broadcast
   * @param args - Additional arguments passed to each listener after the event object
   * @returns The event object
   */
  $broadcast(eventName: string, ...args: unknown[]) {
    const event: ScopeEvent = {
      name: eventName,
      targetScope: this,
      currentScope: this,
      defaultPrevented: false,
      stopPropagation(): void {
        // No-op for broadcast — traversal cannot be stopped
      },
      preventDefault(): void {
        this.defaultPrevented = true;
      },
    };

    this.$$everyScope((scope) => {
      scope.$$fireEventOnScope(event, args);
      return true;
    });

    event.currentScope = null;
    return event;
  }

  /**
   * Fire an event on this scope by invoking all registered listeners for the event name.
   * Errors thrown by listeners are caught and logged without interrupting other listeners.
   * After iteration, null-sentinel entries are compacted from the listener array.
   *
   * @param event - The event object being propagated
   * @param additionalArgs - Extra arguments passed to each listener
   */
  $$fireEventOnScope(event: ScopeEvent, additionalArgs: unknown[]) {
    event.currentScope = this;
    const listeners = this.$$listeners[event.name];
    if (listeners) {
      for (let i = 0; i < listeners.length; i++) {
        const listener = listeners[i];
        if (listener === null || listener === undefined) {
          continue;
        }
        try {
          listener(event, ...additionalArgs);
        } catch (e) {
          console.error('Error in event listener:', e);
        }
      }
      // Compact: remove null sentinels to prevent unbounded growth
      this.$$listeners[event.name] = listeners.filter((l): l is EventListener => l !== null);
    }
  }

  /**
   * Drain the $$applyAsyncQueue, evaluating each expression and clearing the timer ID.
   */
  private $$flushApplyAsync() {
    while (this.$$applyAsyncQueue.length > 0) {
      const asyncTask = this.$$applyAsyncQueue.shift();
      if (asyncTask) {
        try {
          asyncTask.scope.$eval(asyncTask.expression);
        } catch (e) {
          console.error('Error in $applyAsync expression:', e);
        }
      }
    }
    this.$root.$$applyAsyncId = null;
  }

  /**
   * Compare two values for equality.
   * Uses deep comparison via `isEqual` when `valueEq` is true,
   * otherwise reference equality with NaN self-equality.
   */
  private $$areEqual(newValue: unknown, oldValue: unknown, valueEq: boolean) {
    if (valueEq) {
      return isEqual(newValue, oldValue);
    }

    // NaN check: NaN !== NaN in JS, but we want to treat NaN as equal to NaN
    if (typeof newValue === 'number' && isNaN(newValue) && typeof oldValue === 'number' && isNaN(oldValue)) {
      return true;
    }

    return newValue === oldValue;
  }

  /**
   * Set the current phase, throwing if a phase is already active.
   */
  private $beginPhase(phase: '$digest' | '$apply') {
    if (this.$$phase !== null) {
      throw new Error(`${this.$$phase} already in progress`);
    }
    this.$$phase = phase;
  }

  /**
   * Clear the current phase.
   */
  private $clearPhase() {
    this.$$phase = null;
  }
}
