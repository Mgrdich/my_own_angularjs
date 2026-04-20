import type { Scope } from './scope';

/**
 * Unique sentinel value used as the initial "last" value for watchers.
 * Guarantees that the first digest cycle always triggers the listener,
 * since no real watch value can ever equal this symbol.
 */
export const initWatchVal: unique symbol = Symbol('initWatchVal');

/** The type of the {@link initWatchVal} sentinel. */
export type InitWatchVal = typeof initWatchVal;

/**
 * Watch function passed to `$watch` -- evaluated on every digest cycle.
 *
 * The `R` parameter is the registry of typed user properties on the scope;
 * the callback receives `Scope & R` so typed property access (e.g., `s.count`)
 * resolves to the registered type rather than `unknown` from the class's
 * index signature.
 */
export type WatchFn<R extends Record<string, unknown>, T> = (scope: Scope & R) => T;

/**
 * An expression that can be evaluated against a scope with typed registry `R`.
 *
 * Either a function (typed against `Scope & R`) or a string expression that
 * will be compiled via the parser.
 */
export type Parsable<R extends Record<string, unknown>, T> = WatchFn<R, T> | string;

/** Listener called when a watch value changes. */
export type ListenerFn<T> = (newValue: T, oldValue: T, scope: Scope) => void;

/** Cleanup function returned by `$watch`, `$watchGroup`, and `$on`. */
export type DeregisterFn = () => void;

/** Internal watcher record stored in the scope's watcher list. */
export interface Watcher<T> {
  readonly watchFn: WatchFn<Record<string, unknown>, T>;
  readonly listenerFn: ListenerFn<T>;
  last: T | InitWatchVal;
  readonly valueEq: boolean;
}

/** Event object passed to listeners registered via `$on`. */
export interface ScopeEvent {
  readonly name: string;
  readonly targetScope: Scope;
  currentScope: Scope | null;
  defaultPrevented: boolean;
  stopPropagation(): void;
  preventDefault(): void;
}

/** Listener registered via `$on` for scope events. */
export type EventListener = (event: ScopeEvent, ...args: unknown[]) => void;

/** Queued async expression scheduled via `$evalAsync`. */
export interface AsyncTask {
  readonly scope: Scope;
  readonly expression: WatchFn<Record<string, unknown>, unknown>;
}

/** Phase tracking literal union for the digest cycle. */
export type ScopePhase = '$digest' | '$apply' | null;

/** Options for configuring a Scope created via `Scope.create()`. */
export interface ScopeOptions {
  /** Maximum number of digest iterations before throwing. Must be >= 2. Defaults to 10. */
  ttl?: number;
}

/** Internal: integer predecessor up to 10, used to limit {@link PathOf} recursion. */
type Prev<N extends number> = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9][N];

/**
 * All dot-paths through a record type as a string-literal union.
 *
 * Depth-limited to prevent infinite recursion on cyclic types -- 5 levels
 * is plenty for normal scope shapes.
 */
export type PathOf<T, Depth extends number = 5> = Depth extends 0
  ? never
  : T extends Record<string, unknown>
    ? {
        [K in keyof T & string]:
          | K
          | (T[K] extends Record<string, unknown> ? `${K}.${PathOf<T[K], Prev<Depth>>}` : never);
      }[keyof T & string]
    : never;

/** Resolve the type at a given dot-path through `T`. */
export type ValueAt<T, P extends string> = P extends `${infer Head}.${infer Tail}`
  ? Head extends keyof T
    ? T[Head] extends Record<string, unknown>
      ? ValueAt<T[Head], Tail>
      : never
    : never
  : P extends keyof T
    ? T[P]
    : never;

/**
 * A Scope typed against a registry `R`.
 *
 * Extends `Scope` with registry-aware method overloads so watchers and
 * evaluators see typed scope properties and (for dot-path strings) typed
 * listener values.
 *
 * Returned by {@link Scope.create} (intersected with `R` so property access
 * like `scope.count` resolves to the registered type). The bare `Scope`
 * class keeps wide signatures -- the narrowing lives here on the interface,
 * mirroring the `TypedModule extends Module` pattern in `src/di/module.ts`.
 * Keeping the typed overloads off the class sidesteps the same variance
 * conflict: Registry-dependent parameters on a class method would force
 * `Registry` into a contravariant position and break the covariant subtype
 * relation the rest of the codebase relies on.
 */
export interface TypedScope<R extends Record<string, unknown> = Record<string, unknown>> extends Scope {
  // ───── $watch ─────
  /**
   * Typed string dot-path form -- listener sees the value at that path.
   */
  $watch<P extends PathOf<R> & string>(
    watchFn: P,
    listenerFn?: ListenerFn<ValueAt<R, P>>,
    valueEq?: boolean,
  ): DeregisterFn;
  /**
   * Typed function form -- the watch callback's scope is `Scope & R`, so
   * property access is typed against the registry, and the listener's value
   * type is inferred from the callback's return type.
   */
  $watch<T>(watchFn: WatchFn<R, T>, listenerFn?: ListenerFn<T>, valueEq?: boolean): DeregisterFn;
  /**
   * Fallback for non-path string expressions (e.g., `'a + b'`) -- the
   * listener sees `unknown` because no static path typing applies.
   */
  $watch(watchFn: string, listenerFn?: ListenerFn<unknown>, valueEq?: boolean): DeregisterFn;

  // ───── $watchGroup ─────
  $watchGroup(watchFns: Parsable<R, unknown>[], listenerFn: ListenerFn<unknown[]>): DeregisterFn;

  // ───── $watchCollection ─────
  $watchCollection(watchFn: Parsable<R, unknown>, listenerFn: ListenerFn<unknown>): DeregisterFn;

  // ───── $eval ─────
  /** Function form; scope is `Scope & R`, return type flows to caller. */
  $eval<T>(expr?: (scope: Scope & R, locals?: unknown) => T, locals?: unknown): T | undefined;
  /** Typed string dot-path -- return type is the value at that path. */
  $eval<P extends PathOf<R> & string>(expr: P, locals?: unknown): ValueAt<R, P> | undefined;
  /** Fallback for non-path string expressions. */
  $eval(expr: string, locals?: unknown): unknown;

  // ───── $apply ─────
  $apply<T>(expr?: WatchFn<R, T>): T | undefined;
  $apply<P extends PathOf<R> & string>(expr: P): ValueAt<R, P> | undefined;
  $apply(expr?: string): unknown;

  // ───── $evalAsync ─────
  $evalAsync(expr: Parsable<R, unknown>): void;

  // ───── $applyAsync ─────
  $applyAsync(expr: Parsable<R, unknown>): void;

  // ───── $new ─────
  /**
   * Child scopes inherit the parent's registry type by default; callers can
   * override `U` to widen or narrow the typed registry on the child.
   */
  $new<U extends Record<string, unknown> = R>(isolated?: boolean, parent?: Scope): TypedScope<U> & U;
}
