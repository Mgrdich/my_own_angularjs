/**
 * Isolate-scope binding-spec parser + runtime wiring strategies.
 *
 * Spec 022 Slice 1 — the four binding kinds (`=`, `@`, `<`, `&`) plus
 * the optional (`?`) modifier and attribute aliasing. The parser
 * normalizes a `scope: { … }` declaration into a
 * {@link NormalizedBindingMap}; the wiring entry installs the runtime
 * watchers / observers / callback assignments per binding.
 *
 * The four runtime strategies (technical-considerations §2.1):
 *
 * - `=` — bidirectional: a parent → local `$watch` writes the
 *   evaluated expression onto the target; a reverse local → parent
 *   `$watch` writes the local back to the parent using
 *   {@link buildParentWriter} (a synthetic assignment helper closed over
 *   the parent's AST). Last-digest-value reconciliation: the reverse
 *   watcher only writes back when the local actually changed since the
 *   last digest, preventing a write-back loop.
 *
 * - `@` — one-way text. Reuses spec-017's `attrs.$observe` machinery so
 *   `{{...}}`-interpolated attribute values flow naturally into the
 *   target. An initial synchronous assignment seeds the local from the
 *   raw attribute string; subsequent `$observe` callbacks deliver the
 *   interpolated value on each digest.
 *
 * - `<` — one-directional parent → local. A single `parentScope.$watch`
 *   writes the evaluated expression onto the target. Writing to the
 *   local does NOT propagate back.
 *
 * - `&` — expression / callback. The target receives a function that,
 *   when called with an optional `locals` map, calls
 *   `parentScope.$eval(expr, locals)` and returns the result.
 *
 * `?`-optional: when the corresponding attribute is absent, all four
 *   strategies leave the target slot UNDEFINED (AngularJS-canonical) —
 *   no error is thrown for `?` OR for non-`?` either (matches AngularJS
 *   for `<` / `=` / `&`; for `@` a missing attribute simply leaves the
 *   local undefined too).
 *
 * Attribute aliasing: a binding spec's optional trailing identifier
 *   (`'<sourceAttr'`) names the source attribute. When omitted, the
 *   source attribute defaults to a kebab-cased view of the local name.
 *   `attrs[]` is keyed by the camelCase normalized form, so the
 *   normalized binding-spec field stores the CAMEL-CASE source name and
 *   the runtime indexes `attrs[attrName]` directly.
 */

import type { Scope } from '@core/index';
import { buildParentWriter } from '@compiler/expression-assign';
import type { InterpolateService } from '@interpolate/interpolate-types';
import { parse } from '@parser/index';

import { InvalidIsolateBindingError } from './compile-error';
import type { Attributes } from './directive-types';

/**
 * The four binding-kind discriminants. The order matches the
 * `[=@<&]` character class in the binding-spec regex.
 *
 * - `=` two-way   — parent ↔ local
 * - `@` text      — interpolated string from PARENT scope
 * - `<` one-way   — parent → local
 * - `&` callback  — local is `(locals?) => parentScope.$eval(...)`
 *
 * @example
 * ```ts
 * const spec = parseBindingSpec('myDir', 'value', '=');
 * const mode: BindingMode = spec.mode; // '='
 * ```
 */
export type BindingMode = '=' | '@' | '<' | '&';

/**
 * Post-parse representation of a single binding entry inside an
 * isolate-scope `scope: { … }` declaration. `attrName` is the
 * CAMEL-CASE normalized attribute name to index against the shared
 * {@link Attributes} instance (`attrs[attrName]`); it defaults to a
 * kebab→camel transform of the local name and is overridden by the
 * binding spec's alias suffix.
 *
 * @example
 * ```ts
 * parseBindingSpec('myDir', 'label', '@?title');
 * // → { mode: '@', optional: true, attrName: 'title' } satisfies NormalizedBindingSpec
 * ```
 */
export interface NormalizedBindingSpec {
  readonly mode: BindingMode;
  readonly optional: boolean;
  readonly attrName: string;
}

/**
 * Post-parse representation of an isolate-scope `scope: { … }` map —
 * each declared local name maps to its parsed binding spec.
 *
 * @example
 * ```ts
 * const bindings: NormalizedBindingMap = parseIsolateBindings('myDir', {
 *   value: '=',
 *   title: '@',
 * });
 * // bindings.value.mode === '='; bindings.title.mode === '@'
 * ```
 */
export type NormalizedBindingMap = Readonly<Record<string, NormalizedBindingSpec>>;

/**
 * The canonical binding-spec shape. AngularJS also accepts `=*` for
 * collection-mode bindings; spec 022 Slice 1 deliberately defers that
 * form to a future spec — it is rare in practice and our test surface
 * does not exercise it. If we encounter `=*` (or `<*`), the regex below
 * will reject the spec with {@link InvalidIsolateBindingError}.
 */
// AngularJS '=*' collection-mode treated as plain '=' is deferred. The
// regex matches the four canonical kinds plus the optional `?` modifier
// plus an optional aliased attribute identifier (camelCase, must start
// with letter / `_` / `$`).
const BINDING_SPEC_RE = /^\s*([=@<&])(\?)?\s*([A-Za-z_$][\w$]*)?\s*$/;

/**
 * Convert a camelCase local name to its kebab-case source attribute
 * default. `someAttr` → `some-attr`. AFTER kebabization the result is
 * passed back through the camelCase normalizer downstream — the
 * compiler reads `attrs[attrName]` using the CAMEL-CASE key, so we
 * normalize back here. Effectively this is the identity transform for
 * a camelCase input, but doing the round-trip makes the contract
 * explicit and matches how a directive author would spell the source
 * attribute (`some-attr`) in markup.
 */
function defaultAttrNameFor(localName: string): string {
  // The compiler reads `attrs[normalizedKey]` which is keyed by the
  // camelCase normalization of the DOM attribute name. The DOM
  // attribute name for a local `someAttr` is `some-attr`; its camelCase
  // normalization is `someAttr` — the same as the local name. So when
  // no alias is supplied the source attribute name IS the local name.
  return localName;
}

/**
 * Parse a single binding-spec string into a {@link NormalizedBindingSpec}.
 *
 * @param directiveName The owning directive's name (for error messages).
 * @param localName The local key on the isolate-scope `{ … }` map.
 * @param raw The raw binding-spec string (e.g. `'='`, `'<?'`, `'@title'`).
 * @throws {@link InvalidIsolateBindingError} on any unparseable input.
 *
 * @example
 * ```ts
 * parseBindingSpec('myDir', 'value', '=');
 * // { mode: '=', optional: false, attrName: 'value' }
 *
 * parseBindingSpec('myDir', 'label', '@?title');
 * // { mode: '@', optional: true, attrName: 'title' }
 * ```
 */
export function parseBindingSpec(directiveName: string, localName: string, raw: string): NormalizedBindingSpec {
  if (typeof raw !== 'string') {
    throw new InvalidIsolateBindingError(directiveName, localName, String(raw));
  }
  const match = BINDING_SPEC_RE.exec(raw);
  if (match === null) {
    throw new InvalidIsolateBindingError(directiveName, localName, raw);
  }
  const mode = match[1] as BindingMode;
  const optional = match[2] === '?';
  const alias = match[3];
  const attrName = alias !== undefined && alias.length > 0 ? alias : defaultAttrNameFor(localName);
  return { mode, optional, attrName };
}

/**
 * Parse an isolate-scope `scope: { … }` map into a
 * {@link NormalizedBindingMap}. Throws on the first malformed entry —
 * matches AngularJS, where the first bad binding aborts directive
 * registration.
 *
 * @example
 * ```ts
 * parseIsolateBindings('myDir', { value: '=', label: '@?title', onDone: '&' });
 * // {
 * //   value:  { mode: '=', optional: false, attrName: 'value' },
 * //   label:  { mode: '@', optional: true,  attrName: 'title' },
 * //   onDone: { mode: '&', optional: false, attrName: 'onDone' },
 * // }
 * ```
 */
export function parseIsolateBindings(directiveName: string, scopeObj: Record<string, string>): NormalizedBindingMap {
  const result: Record<string, NormalizedBindingSpec> = {};
  for (const [localName, raw] of Object.entries(scopeObj)) {
    result[localName] = parseBindingSpec(directiveName, localName, raw);
  }
  return result;
}

/**
 * The change-notification callback signature used by Slice 3 lifecycle
 * wiring. Invoked once per `<` / `@` binding value transition:
 *
 *  - At link-time seeding (initial fire) — with `isFirst: true`.
 *  - On every subsequent `<` watch fire or `@` interpolation re-evaluation
 *    — with `isFirst: false` and the prior value as `previousValue`.
 *
 * `=` and `&` bindings DO NOT call `onChange` — `$onChanges` is
 * intentionally limited to one-way data flow inputs per AngularJS 1.5+
 * canonical semantics.
 *
 * @example
 * ```ts
 * const onChange: IsolateBindingChangeCallback = (name, curr, prev, isFirst) => {
 *   if (isFirst) {
 *     // initial fire — prev is UNINITIALIZED_VALUE
 *   } else {
 *     queue.record(ctrl, name, curr, prev, false);
 *   }
 * };
 * ```
 */
export type IsolateBindingChangeCallback = (
  localName: string,
  currentValue: unknown,
  previousValue: unknown,
  isFirst: boolean,
) => void;

/**
 * Inputs to {@link wireIsolateBindings}.
 *
 * The compiler passes the parent scope, the freshly-created isolate
 * scope, the shared {@link Attributes}, the parsed binding map, and a
 * `target` object — for Slice 1 the target IS the isolate scope; Slice
 * 2 (`bindToController`) will swap in the controller instance.
 */
export interface WireIsolateBindingsArgs {
  /** Used for `=` / `<` / `&` parent-expression evaluation. */
  readonly parentScope: Scope;
  /**
   * The directive's isolate scope (created by the caller via
   * `parentScope.$new(true)`). Watchers for `=` / `<` install here so
   * the reverse-binding tear-down rides on the isolate scope's
   * `$destroy()` path.
   */
  readonly isolateScope: Scope;
  /** Shared per-element attributes — read for `attrs[attrName]`. */
  readonly attrs: Attributes;
  /** The parsed binding map (normalized form from {@link parseIsolateBindings}). */
  readonly bindings: NormalizedBindingMap;
  /**
   * The object that receives each binding under its `localName`. For
   * Slice 1 this IS `isolateScope`; Slice 2 swaps in the controller
   * instance when `bindToController` is in effect.
   */
  readonly target: Record<string, unknown>;
  /**
   * Run-phase `$interpolate` service. The `@` binding wires its update
   * watcher against the PARENT scope (not the isolate) so consumer
   * markup like `<my-dir title="{{outerName}}">` resolves `outerName`
   * in the outer namespace. Without `interpolate` (e.g. a standalone
   * unit-test caller) the `@` binding degrades to a one-time read of
   * the raw attribute value.
   */
  readonly interpolate?: InterpolateService;
  /**
   * Optional Slice-3 change-notification callback — fired once per
   * `<` / `@` binding transition (including the initial synchronous
   * seed, with `isFirst: true`). `=` and `&` bindings DO NOT fire
   * `onChange` — `$onChanges` is one-way only by design.
   *
   * Slice-1 / Slice-2 callers omit `onChange` and get the existing
   * "bindings wired silently" behavior unchanged.
   */
  readonly onChange?: IsolateBindingChangeCallback;
}

/**
 * Wire every binding in `bindings` onto `target`, returning a cleanup
 * function. The cleanup is a no-op in Slice 1 — the isolate scope's
 * `$destroy()` already tears down the installed watchers via the
 * standard `Scope.$$watchers = null` path. Future slices may push
 * additional teardown into the cleanup closure.
 */
export function wireIsolateBindings(args: WireIsolateBindingsArgs): () => void {
  const { parentScope, isolateScope, attrs, bindings, target, interpolate, onChange } = args;
  for (const [localName, spec] of Object.entries(bindings)) {
    switch (spec.mode) {
      case '@':
        wireAtBinding(localName, spec, attrs, parentScope, isolateScope, target, interpolate, onChange);
        break;
      case '<':
        wireOneWayBinding(localName, spec, attrs, parentScope, isolateScope, target, onChange);
        break;
      case '=':
        wireTwoWayBinding(localName, spec, attrs, parentScope, isolateScope, target);
        break;
      case '&':
        wireExpressionBinding(localName, spec, attrs, parentScope, target);
        break;
    }
  }
  return () => {
    // No-op for Slice 1 — see file-level TSDoc.
  };
}

function wireAtBinding(
  localName: string,
  spec: NormalizedBindingSpec,
  attrs: Attributes,
  parentScope: Scope,
  isolateScope: Scope,
  target: Record<string, unknown>,
  interpolate: InterpolateService | undefined,
  onChange: IsolateBindingChangeCallback | undefined,
): void {
  const attrValue = attrs[spec.attrName];
  if (typeof attrValue !== 'string') {
    // Missing attribute: leave the target undefined (AngularJS-canonical
    // for `@`). The `?`-optional vs. non-`?` distinction does not affect
    // `@` — it never throws on missing attribute.
    return;
  }
  // Seed the initial value from the raw attribute string. Without this
  // synchronous seed, the local is undefined until the first watcher
  // fires on the next digest.
  target[localName] = attrValue;
  // Slice-3: notify the initial seed as a first-change.
  if (onChange !== undefined) {
    onChange(localName, attrValue, undefined, true);
  }

  if (interpolate === undefined) {
    // Standalone unit-test path: degrade to a one-time seed. Without
    // the `$interpolate` service we cannot wire the change watcher.
    return;
  }
  const interpolateFn = interpolate(attrValue, true);
  if (interpolateFn === undefined) {
    // Static attribute — no `{{…}}` markers. Initial seed is already
    // the final value; no watcher needed.
    return;
  }
  // The `@` binding's interpolation runs in the PARENT scope's
  // namespace so consumer markup like `<my-dir title="{{outerName}}">`
  // resolves `outerName` outside the isolate. We install the watcher
  // on the isolateScope so it tears down with the directive's scope,
  // but evaluate against `parentScope`.
  isolateScope.$watch(
    () => interpolateFn(parentScope),
    (newValue, oldValue) => {
      target[localName] = newValue;
      // Slice-3: skip the first watcher fire (the initial seed has
      // already been notified above). AngularJS canonical: first
      // change at watcher fire-time is when `newValue === oldValue`.
      if (onChange !== undefined && newValue !== oldValue) {
        onChange(localName, newValue, oldValue, false);
      }
    },
  );
}

function wireOneWayBinding(
  localName: string,
  spec: NormalizedBindingSpec,
  attrs: Attributes,
  parentScope: Scope,
  isolateScope: Scope,
  target: Record<string, unknown>,
  onChange: IsolateBindingChangeCallback | undefined,
): void {
  const attrExpr = attrs[spec.attrName];
  if (typeof attrExpr !== 'string') {
    // Missing attribute: leave the target undefined regardless of `?`.
    return;
  }
  const parentExpr = parse(attrExpr);
  // Slice-3: synchronously seed the initial value so `$onInit` (which
  // runs immediately after binding wiring) and the synchronous initial
  // `$onChanges` fire (which runs right after `$onInit`) see a populated
  // local. AngularJS-canonical: the first parent-expression value is
  // captured eagerly at link time; subsequent changes flow through
  // the watcher below.
  const initialValue = parentExpr(parentScope);
  target[localName] = initialValue;
  if (onChange !== undefined) {
    onChange(localName, initialValue, undefined, true);
  }
  // Install the watcher on the ISOLATE scope so the parent-expression
  // watch tears down with the isolate scope's `$destroy()`. The
  // watchFn evaluates against `parentScope` (where the expression
  // lexically belongs); the listener writes onto `target` (which lives
  // under the isolate scope or, in Slice 2, on the controller).
  //
  // The first watcher delivery (in the same digest cycle as initial
  // seeding) sees `newValue === oldValue`; we skip the `onChange`
  // notification in that case because the initial value was already
  // surfaced synchronously above.
  isolateScope.$watch(
    () => parentExpr(parentScope),
    (newValue, oldValue) => {
      target[localName] = newValue;
      if (onChange === undefined) {
        return;
      }
      if (newValue === oldValue) {
        // AngularJS-canonical first-fire sentinel — already surfaced
        // synchronously above; suppress to avoid a duplicate fire.
        return;
      }
      onChange(localName, newValue, oldValue, false);
    },
  );
}

function wireTwoWayBinding(
  localName: string,
  spec: NormalizedBindingSpec,
  attrs: Attributes,
  parentScope: Scope,
  isolateScope: Scope,
  target: Record<string, unknown>,
): void {
  const attrExpr = attrs[spec.attrName];
  if (typeof attrExpr !== 'string') {
    return;
  }
  const parentExpr = parse(attrExpr);
  const parentWriter = buildParentWriter(parentExpr);

  // Last-digest-value reconciliation. Each direction reads `lastValue`
  // before deciding whether to mirror; this prevents a parent→local→
  // parent→… ping-pong from breaching the digest TTL.
  let lastValue: unknown = parentExpr(parentScope);
  target[localName] = lastValue;

  // Parent → local watcher.
  isolateScope.$watch(
    () => parentExpr(parentScope),
    (newValue) => {
      if (newValue !== target[localName]) {
        target[localName] = newValue;
      }
      lastValue = newValue;
    },
  );

  // Local → parent watcher (suppressed if the parent expression is
  // non-assignable — see {@link buildParentWriter}).
  if (parentWriter !== undefined) {
    isolateScope.$watch(
      () => target[localName],
      (newValue) => {
        if (newValue !== lastValue) {
          parentWriter(parentScope, newValue);
          lastValue = newValue;
        }
      },
    );
  }
}

function wireExpressionBinding(
  localName: string,
  spec: NormalizedBindingSpec,
  attrs: Attributes,
  parentScope: Scope,
  target: Record<string, unknown>,
): void {
  const attrExpr = attrs[spec.attrName];
  if (typeof attrExpr !== 'string') {
    // Missing attribute: leave the target slot undefined regardless of
    // `?`. Non-`?` `&` is permissive in AngularJS — no throw.
    target[localName] = undefined;
    return;
  }
  const parentExpr = parse(attrExpr);
  target[localName] = (locals?: Record<string, unknown>) => parentExpr(parentScope, locals);
}
