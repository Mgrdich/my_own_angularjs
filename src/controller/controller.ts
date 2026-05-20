/**
 * `createController` — ESM-first factory for the run-phase `$controller`
 * service (spec 020 Slice 2).
 *
 * Owns four responsibilities that all live in this file (per
 * technical-considerations §2.4 / §2.5):
 *
 * 1. **Name + alias parser** — splits `"Name as alias"` into a pair via the
 *    single `CONTROLLER_NAME_ALIAS_RE` regex. The same `IDENT_RE` is used to
 *    validate explicit `ident` arguments AND (in Slice 4) directive
 *    `controllerAs` values, so both surfaces share one source of truth.
 * 2. **Registry lookup** — string-name controllers go through the readonly
 *    registry handed in by `$ControllerProvider`. A defensive
 *    `'hasOwnProperty'` rejection fires BEFORE the lookup so prototype-
 *    pollution attempts surface as `InvalidControllerNameError` even if the
 *    registry has been mutated through a back door.
 * 3. **Instantiation** — implements the AngularJS-canonical pattern
 *    (`Object.create(constructor.prototype)` + `injector.invoke(fn, instance, locals)`
 *    + return-value-replacement) inside this factory rather than as a method
 *    on `Injector`. Keeps the injector surface narrow.
 * 4. **Alias binding** — when an alias resolved (from the `"Name as alias"`
 *    suffix or the explicit `ident` argument) AND `locals.$scope` is present,
 *    the instance is assigned to `scope[alias]`. When `$scope` is absent the
 *    alias is silently ignored (FS §2.3 acceptance #2).
 *
 * **No default `controller` binding in this slice.** The `interpolate`-style
 * default-binding pattern (`export const interpolate = createInterpolate()`)
 * needs a sensible default for every dependency. `createController` requires
 * an `Injector`, and `@di` does NOT export a default `injector` symbol —
 * `createInjector` is a factory, not a singleton. Rather than fabricate an
 * empty `createInjector([])` just to have something to default to (hidden
 * coupling), Slice 2 deliberately ships the factory alone. The decision is
 * revisited in Slice 5 once the broader public-surface picture is in view.
 */

import type { Scope } from '@core/index';
import type { Injector, Invokable } from '@di/di-types';

import {
  InvalidControllerFactoryError,
  InvalidControllerNameError,
  MalformedControllerAliasError,
  UnknownControllerError,
} from './controller-errors';
import type {
  ControllerInvokable,
  ControllerLocals,
  ControllerService,
  CreateControllerArgs,
} from './controller-types';

/**
 * Splits `"Name as alias"` into a `{ name, ident? }` pair. Anchored on the
 * whole string so leading whitespace before the bare name (or before `as`)
 * is significant and rejected — see test cases.
 *
 * Group 1 = bare controller name (non-greedy so the `\s+as\s+` clause
 * detaches correctly). Group 3 = alias (optional). Trailing whitespace is
 * tolerated via `\s*$`.
 */
const CONTROLLER_NAME_ALIAS_RE = /^(\S+?)(\s+as\s+([\w$]+))?\s*$/;

/**
 * Valid-identifier shape — same allowance as JavaScript identifiers but
 * intentionally narrower than the full ES spec (no Unicode letters, no
 * surrogate pairs). Mirrors the conservative rule AngularJS used:
 * the first character must be a letter, underscore, or `$`; subsequent
 * characters may also include digits. `\w` is `[A-Za-z0-9_]`, so the
 * first-character class is spelled out explicitly to exclude digits at
 * position 0.
 *
 * **Exported for `$compileProvider.directive`'s `controllerAs` shape
 * validation** (spec 020 Slice 4). Match-or-fail consumers should use
 * the existing helpers in this module (`parseControllerName`, the
 * factory itself); the export exists only for the cross-module
 * validation seam in `normalizeDirective`, so the two surfaces share
 * a single source of truth and a relaxation in one place can't drift
 * from the other.
 */
export const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

/**
 * Run {@link CONTROLLER_NAME_ALIAS_RE} against `input` and return the
 * `{ name, ident? }` pair. Throws {@link MalformedControllerAliasError}
 * when the regex doesn't match OR when an alias was present but failed
 * {@link IDENT_RE} (the regex already enforces this via `[\w$]+`, but a
 * defense-in-depth check keeps the error consistent if the regex is ever
 * relaxed).
 */
function parseControllerName(input: string) {
  const match = CONTROLLER_NAME_ALIAS_RE.exec(input);
  if (match === null) {
    throw new MalformedControllerAliasError(input);
  }
  const [, name, , alias] = match;
  if (name === undefined) {
    // Defensive: the regex's group 1 is non-optional so this branch is
    // unreachable in practice. Keep the runtime guard so a future regex
    // tweak can't silently let `undefined` through.
    throw new MalformedControllerAliasError(input);
  }
  if (alias !== undefined) {
    if (!IDENT_RE.test(alias)) {
      throw new MalformedControllerAliasError(input);
    }
    return { name, ident: alias };
  }
  return { name };
}

/**
 * Describe `value` as a short shape descriptor for error messages. Mirrors
 * the `describeValue` helper from spec 018's `normalizeDirective`. Keeps
 * error messages human-readable without leaking the full content of the
 * offending value.
 */
function describe(value: unknown) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return value.length === 0 ? 'empty array' : `array(length ${String(value.length)})`;
  }
  if (typeof value === 'string') return `string "${value}"`;
  if (typeof value === 'number') return `number ${String(value)}`;
  if (typeof value === 'boolean') return `boolean ${String(value)}`;
  if (typeof value === 'bigint') return `bigint ${String(value)}`;
  if (typeof value === 'undefined') return 'undefined';
  // object (non-null, non-array), function, symbol — bare type name is
  // enough for the surfaced message; avoids accidental `[object Object]`
  // stringification of the offending value.
  return typeof value;
}

/**
 * Validate that `fn` is shaped like an invokable: either a bare function
 * or a non-empty array whose trailing element is a function. Returns the
 * trailing function on success so the caller can use it as the "constructor"
 * for `Object.create(constructor.prototype)`. Throws
 * {@link InvalidControllerFactoryError} on failure.
 */
function resolveConstructor(name: string, fn: unknown) {
  if (typeof fn === 'function') {
    return fn as (...args: unknown[]) => unknown;
  }
  if (Array.isArray(fn)) {
    const arr = fn as unknown[];
    if (arr.length === 0) {
      throw new InvalidControllerFactoryError(name, describe(arr));
    }
    const tail = arr[arr.length - 1];
    if (typeof tail !== 'function') {
      throw new InvalidControllerFactoryError(name, describe(arr));
    }
    return tail as (...args: unknown[]) => unknown;
  }
  throw new InvalidControllerFactoryError(name, describe(fn));
}

/**
 * Construct an instance via the AngularJS-canonical pattern:
 *
 * 1. Pick the "constructor" — the trailing function of an array-style
 *    annotation or the bare function itself.
 * 2. Create a prototype-instance via `Object.create(constructor.prototype)`.
 *    This gives `instanceof` checks the right answer AND lets controllers
 *    declared as classical constructor functions stash methods on
 *    `prototype` and have them visible on `this` from inside the body.
 * 3. Invoke the function with `self = instance` and the resolved DI locals.
 * 4. Apply return-value-replacement: if the invoke returned a non-null
 *    object, that return value REPLACES the prototype-instance — matching
 *    the `$injector.instantiate` semantics of classic AngularJS and the
 *    well-known `new` operator behavior in plain JavaScript.
 */
function instantiate(injector: Injector, fn: ControllerInvokable, locals: ControllerLocals | undefined) {
  const ctor = Array.isArray(fn)
    ? (fn[fn.length - 1] as (...args: unknown[]) => unknown)
    : (fn as (...args: unknown[]) => unknown);
  // `Object.create` against `ctor.prototype` is safe for plain functions
  // (each has its own `.prototype` object) and arrow functions (whose
  // `.prototype` is `undefined`, in which case `Object.create(undefined)`
  // throws — but that throw is exactly the desired behavior for arrow
  // functions, which can't be used as constructors anyway).
  const proto = (ctor as unknown as { prototype: object | null }).prototype ?? null;
  const instance = Object.create(proto) as object;
  // The `ControllerInvokable` shape (`ControllerFn | (string | ControllerFn)[]`)
  // is a deliberately-loose mutable-array spelling — narrower than the DI
  // module's `Invokable` (which uses a readonly tuple with a precisely-typed
  // trailing function). The cast through `Invokable` here is the explicit
  // bridge between the two shapes; the runtime arrays produced by callers
  // satisfy both surfaces.
  const returned = injector.invoke(fn as unknown as Invokable, instance, locals);
  if (returned !== null && typeof returned === 'object') {
    return returned;
  }
  return instance;
}

/**
 * Assign `instance` to `scope[alias]` when both are present. Silently
 * skips when `scope` is `undefined` (FS §2.3 acceptance #2 — no error)
 * or when `alias` is `undefined` (no-op for the no-alias path). The
 * write goes through a narrow `Record<string, unknown>` cast — narrower
 * than `any`, justifying the absence of an eslint-disable.
 */
function bindAlias(scope: ControllerLocals['$scope'], alias: string | undefined, instance: unknown) {
  if (scope === undefined) return;
  if (alias === undefined) return;
  (scope as unknown as Record<string, unknown>)[alias] = instance;
}

/**
 * Build the run-phase `$controller` service against an injector and a
 * (readonly) name registry.
 *
 * The returned function honors the three-branch resolution order from
 * the spec (technical-considerations §2.4):
 *
 * 1. **String** — parses `"Name"` / `"Name as alias"` via
 *    {@link CONTROLLER_NAME_ALIAS_RE}; defensively rejects
 *    `"hasOwnProperty"`; looks the bare name up in the registry; throws
 *    {@link UnknownControllerError} if missing; instantiates;
 *    binds the alias when `locals.$scope` is present. An explicit
 *    `ident` argument supersedes the alias-suffix when present (and
 *    must itself match {@link IDENT_RE}).
 * 2. **Function or array** — instantiated directly. The alias comes
 *    from the explicit `ident` argument only.
 * 3. **Anything else** — throws {@link InvalidControllerFactoryError}
 *    with the sentinel name `"<inline>"`.
 *
 * @example
 * ```ts
 * // Registered name, no alias:
 * const $controller = createController({ injector, registry });
 * const instance = $controller('Greeter', { $scope: scope });
 *
 * // Registered name with alias suffix:
 * $controller('Greeter as vm', { $scope: scope });
 * // scope.vm === instance
 *
 * // Inline function with explicit ident:
 * $controller(function ($scope) {}, { $scope: scope }, 'vm');
 * // scope.vm === instance
 *
 * // Inline array-style annotation:
 * $controller(['$scope', '$svc', function ($scope, $svc) {}], { $scope: scope });
 * ```
 */
export function createController(args: CreateControllerArgs): ControllerService {
  const { injector, registry } = args;
  return function $controller<TScope extends Scope = Scope>(
    nameOrFn: string | ControllerInvokable,
    locals?: ControllerLocals<TScope>,
    ident?: string,
  ): unknown {
    if (typeof nameOrFn === 'string') {
      const parsed = parseControllerName(nameOrFn);
      // Defensive: even if a back door has stashed `'hasOwnProperty'` into
      // the registry (registration-time rejection lives in Slice 3), the
      // lookup path refuses to resolve it. Keeps the prototype-pollution
      // guard local to this factory.
      if (parsed.name === 'hasOwnProperty') {
        throw new InvalidControllerNameError(parsed.name);
      }
      const entry = registry.get(parsed.name);
      if (entry === undefined) {
        throw new UnknownControllerError(parsed.name);
      }
      // Re-validate the registry entry. Slice 3 will reject malformed
      // factories at registration time, but we keep the lookup-time check
      // so a malformed entry written through a `ReadonlyMap`-defeating cast
      // surfaces a clean error.
      resolveConstructor(parsed.name, entry);
      const instance = instantiate(injector, entry, locals);
      let alias: string | undefined;
      if (ident !== undefined) {
        if (!IDENT_RE.test(ident)) {
          throw new MalformedControllerAliasError(ident);
        }
        alias = ident;
      } else {
        alias = parsed.ident;
      }
      bindAlias(locals?.$scope, alias, instance);
      return instance;
    }
    if (typeof nameOrFn === 'function' || Array.isArray(nameOrFn)) {
      resolveConstructor('<inline>', nameOrFn);
      const instance = instantiate(injector, nameOrFn, locals);
      if (ident !== undefined) {
        if (!IDENT_RE.test(ident)) {
          throw new MalformedControllerAliasError(ident);
        }
        bindAlias(locals?.$scope, ident, instance);
      }
      return instance;
    }
    throw new InvalidControllerFactoryError('<inline>', describe(nameOrFn));
  };
}
