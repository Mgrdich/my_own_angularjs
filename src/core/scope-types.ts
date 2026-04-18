import type { Scope } from './scope';

/**
 * Unique sentinel value used as the initial "last" value for watchers.
 * Guarantees that the first digest cycle always triggers the listener,
 * since no real watch value can ever equal this symbol.
 */
export const initWatchVal: unique symbol = Symbol('initWatchVal');

/** The type of the {@link initWatchVal} sentinel. */
export type InitWatchVal = typeof initWatchVal;

/** A Scope instance with typed user properties via intersection. */
export type TypedScope<T extends Record<string, unknown> = Record<string, unknown>> = Scope & T;

/** Watch function passed to `$watch` -- evaluated on every digest cycle. */
export type WatchFn<T> = (scope: Scope) => T;

/**
 * An expression that can be evaluated against a scope.
 *
 * Either a function (takes a `Scope`, returns a value) or a string
 * expression that will be compiled via the parser.
 */
export type Parsable<T> = WatchFn<T> | string;

/** Listener called when a watch value changes. */
export type ListenerFn<T> = (newValue: T, oldValue: T, scope: Scope) => void;

/** Cleanup function returned by `$watch`, `$watchGroup`, and `$on`. */
export type DeregisterFn = () => void;

/** Internal watcher record stored in the scope's watcher list. */
export interface Watcher<T> {
  readonly watchFn: WatchFn<T>;
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
  readonly expression: WatchFn<unknown>;
}

/** Phase tracking literal union for the digest cycle. */
export type ScopePhase = '$digest' | '$apply' | null;

/** Options for configuring a Scope created via `Scope.create()`. */
export interface ScopeOptions {
  /** Maximum number of digest iterations before throwing. Must be >= 2. Defaults to 10. */
  ttl?: number;
}
