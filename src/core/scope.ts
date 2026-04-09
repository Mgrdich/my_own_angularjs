import {
  initWatchVal,
  type AsyncTask,
  type DeregisterFn,
  type EventListener,
  type ListenerFn,
  type ScopePhase,
  type TypedScope,
  type Watcher,
  type WatchFn,
} from './scope-types';
import { isEqual } from './is-equal';

/** Maximum number of digest iterations before throwing. */
const TTL = 10;

/** No-op listener used when $watch is called without a listenerFn. */
const noop: ListenerFn<unknown> = () => {
  /* intentionally empty */
};

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
  }

  /** Create a typed Scope instance with compile-time property access. */
  static create<T extends Record<string, unknown> = Record<string, unknown>>(): TypedScope<T> {
    return new Scope() as TypedScope<T>;
  }

  /**
   * Register a watcher on this scope.
   *
   * @param watchFn - Expression evaluated on every digest cycle
   * @param listenerFn - Called when the watched value changes
   * @param valueEq - Whether to use deep equality (not implemented in Slice 1)
   * @returns A function that deregisters the watcher when called
   */
  $watch<W>(watchFn: WatchFn<W>, listenerFn?: ListenerFn<W>, valueEq?: boolean): DeregisterFn {
    const watcher: Watcher<W> = {
      watchFn,
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

    return (): void => {
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
  $new(isolated?: boolean, parent?: Scope): Scope {
    const effectiveParent = parent ?? this;
    let child: Scope;

    if (isolated) {
      child = new Scope();
      child.$root = this.$root;
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
            } catch (e: unknown) {
              // Log listener errors but do not abort the digest
              console.error('Error in watch listener:', e);
            }

            dirty = true;
          } else if (this.$root.$$lastDirtyWatch === watcher) {
            // Short-circuit: no more dirty watchers after this point
            return false;
          }
        } catch (e: unknown) {
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
  $digest(): void {
    let ttl = TTL;
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
            } catch (e: unknown) {
              console.error('Error in $evalAsync expression:', e);
            }
          }
        }

        dirty = this.$$digestOnce();

        if ((dirty || this.$$asyncQueue.length > 0) && --ttl <= 0) {
          this.$clearPhase();
          throw new Error('10 digest iterations reached');
        }
      } while (dirty || this.$$asyncQueue.length > 0);
    } finally {
      this.$clearPhase();
    }

    // Drain the post-digest queue
    while (this.$$postDigestQueue.length > 0) {
      const fn = this.$$postDigestQueue.shift();
      if (fn) {
        try {
          fn();
        } catch (e: unknown) {
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
  $eval<R>(expr?: (scope: Scope, locals?: unknown) => R, locals?: unknown): R | undefined {
    if (expr) {
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
  $apply<R>(expr?: WatchFn<R>): R | undefined {
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
   * Clears watchers and listeners to prevent further digest participation.
   */
  $destroy(): void {
    if (this === this.$root) {
      return;
    }

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
