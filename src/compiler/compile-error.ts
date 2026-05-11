/**
 * Typed error classes used by the compiler module.
 *
 * Mirrors `src/filter/filter-error.ts`: each class carries a literal
 * `name` brand so callers can narrow with `err instanceof <Class>`
 * instead of relying on string-matching the message. Messages are
 * deliberately stable — the strings are part of the public contract
 * and locked by tests.
 */

/**
 * Thrown by `$compileProvider.directive(name, factory)` when `name` is
 * not a valid camelCase JavaScript identifier (empty, contains
 * whitespace, starts with a digit, etc.).
 *
 * @example
 * ```ts
 * try {
 *   $compileProvider.directive('1bad', () => ({}));
 * } catch (err) {
 *   if (err instanceof InvalidDirectiveNameError) {
 *     console.warn('Fix the directive name:', err.message);
 *   } else {
 *     throw err;
 *   }
 * }
 * ```
 */
export class InvalidDirectiveNameError extends Error {
  readonly name = 'InvalidDirectiveNameError' as const;

  constructor(directiveName: string) {
    super(`Invalid directive name: ${directiveName}`);
  }
}

/**
 * Thrown by `$compileProvider.directive(name, factory)` when `factory`
 * is falsy (`null`, `undefined`, empty string, `0`, etc.) or otherwise
 * cannot be invoked as a directive factory.
 *
 * @example
 * ```ts
 * try {
 *   $compileProvider.directive('myDir', null);
 * } catch (err) {
 *   if (err instanceof InvalidDirectiveFactoryError) {
 *     console.warn(err.message);
 *   }
 * }
 * ```
 */
export class InvalidDirectiveFactoryError extends Error {
  readonly name = 'InvalidDirectiveFactoryError' as const;

  constructor(directiveName: string) {
    super(`Invalid directive factory for ${directiveName}`);
  }
}

/**
 * Thrown when a directive factory returns a Directive Definition
 * Object whose `scope` property is the isolate-scope object form
 * (`scope: { foo: '=' }`). Spec 017 deliberately rejects isolate
 * scope at registration time so a future spec can add it without a
 * silent semantic change.
 *
 * @example
 * ```ts
 * $compileProvider.directive('myDir', () => ({ scope: { foo: '=' } }));
 * // throws IsolateScopeNotSupportedError
 * ```
 */
export class IsolateScopeNotSupportedError extends Error {
  readonly name = 'IsolateScopeNotSupportedError' as const;

  constructor(directiveName: string) {
    super(`Isolate scope is not yet supported (spec 017 ships only scope: false | true). Directive: ${directiveName}`);
  }
}

/**
 * Thrown by `normalizeDirective` (spec 018 Slice 2) when a directive
 * factory returns a Directive Definition Object whose `transclude`
 * property is none of `true`, `false`, `undefined`, `'element'`, or a
 * plain object — i.e. it is an unsupported runtime value such as a
 * number, a string other than `'element'`, an array, etc.
 *
 * @example
 * ```ts
 * $compileProvider.directive('myDir', () => ({ transclude: 42 }));
 * // routes InvalidTranscludeValueError via $exceptionHandler('$compile')
 * ```
 */
export class InvalidTranscludeValueError extends Error {
  readonly name = 'InvalidTranscludeValueError' as const;

  constructor(directiveName: string, description: string) {
    super(`Invalid transclude value for directive ${directiveName}: ${description}`);
  }
}

/**
 * Thrown by `normalizeDirective` when a directive declares
 * `transclude: 'element'`. This element-transclusion form is the
 * foundation for future structural directives (`ng-if`, `ng-repeat`)
 * and is deliberately deferred in spec 018 so the future addition can
 * land without a silent semantic change.
 *
 * @example
 * ```ts
 * $compileProvider.directive('myDir', () => ({ transclude: 'element' }));
 * // routes ElementTranscludeNotSupportedError via $exceptionHandler('$compile')
 * ```
 */
export class ElementTranscludeNotSupportedError extends Error {
  readonly name = 'ElementTranscludeNotSupportedError' as const;

  constructor(directiveName: string) {
    super(
      `Element transclusion (transclude: 'element') is not yet supported; this spec ships only transclude: true and the multi-slot object form. Directive: ${directiveName}`,
    );
  }
}

/**
 * Thrown by `normalizeDirective` when two entries in a
 * `transclude: { … }` object resolve to the same normalized selector
 * after `directiveNormalize`. The multi-slot map MUST produce a
 * deterministic 1:1 selector→slot mapping.
 *
 * @example
 * ```ts
 * $compileProvider.directive('myDir', () => ({
 *   transclude: { a: 'card-title', b: 'card-title' },
 * }));
 * // routes DuplicateTranscludeSelectorError via $exceptionHandler('$compile')
 * ```
 */
export class DuplicateTranscludeSelectorError extends Error {
  readonly name = 'DuplicateTranscludeSelectorError' as const;

  constructor(directiveName: string, selector: string) {
    super(`Duplicate transclude selector "${selector}" in directive ${directiveName}`);
  }
}

/**
 * Thrown by `normalizeDirective` when a key in a `transclude: { … }`
 * object is not a valid camelCase JavaScript identifier (e.g. starts
 * with a digit, contains whitespace, or is empty).
 *
 * @example
 * ```ts
 * $compileProvider.directive('myDir', () => ({
 *   transclude: { '1bad': 'card-title' },
 * }));
 * // routes InvalidTranscludeSlotNameError via $exceptionHandler('$compile')
 * ```
 */
export class InvalidTranscludeSlotNameError extends Error {
  readonly name = 'InvalidTranscludeSlotNameError' as const;

  constructor(directiveName: string, key: string) {
    super(`Invalid transclusion slot name "${key}" in directive ${directiveName}`);
  }
}

/**
 * Thrown by `normalizeDirective` when a value in a `transclude: { … }`
 * object is not a non-empty kebab-case tag-name string (optionally
 * prefixed with `?` for optional slots). Examples that trigger this
 * error: empty string, non-string value, mixed case, leading digit.
 *
 * @example
 * ```ts
 * $compileProvider.directive('myDir', () => ({
 *   transclude: { titleSlot: '' },
 * }));
 * // routes InvalidTranscludeSelectorError via $exceptionHandler('$compile')
 * ```
 */
export class InvalidTranscludeSelectorError extends Error {
  readonly name = 'InvalidTranscludeSelectorError' as const;

  constructor(directiveName: string, key: string) {
    super(`Invalid transclusion selector for slot "${key}" in directive ${directiveName}`);
  }
}

/**
 * Thrown at LINK time (not registration) when two directives on the
 * SAME element both declare `transclude`. AngularJS's "first declaration
 * wins" rule applies: the first directive's transclusion runs normally;
 * the second directive's `transclude` is ignored (its OTHER behavior —
 * link / compile — still runs).
 *
 * Routed through `$exceptionHandler('$compile')` from the compile
 * pre-pass; never thrown synchronously to the caller.
 *
 * @example
 * ```ts
 * $compileProvider.directive('dirA', () => ({ transclude: true, link: () => {} }));
 * $compileProvider.directive('dirB', () => ({ transclude: true, link: () => {} }));
 * // <div dir-a dir-b>…</div> — at link time, dirB triggers
 * // MultipleTranscludeDirectivesError via $exceptionHandler('$compile').
 * ```
 */
export class MultipleTranscludeDirectivesError extends Error {
  readonly name = 'MultipleTranscludeDirectivesError' as const;

  constructor(firstDirectiveName: string, secondDirectiveName: string) {
    super(
      `Multiple directives requesting transclusion on the same element: "${firstDirectiveName}" and "${secondDirectiveName}". Only the first wins; "${secondDirectiveName}"'s transclude is ignored.`,
    );
  }
}

/**
 * Thrown at LINK time when a directive's multi-slot transclusion
 * declared a REQUIRED slot (selector without leading `?`) but the
 * consumer markup contained no child matching that slot's selector.
 *
 * Routed through `$exceptionHandler('$compile')` at TWO surfaces:
 * (a) once eagerly after the host's link phases complete (so the error
 * surfaces even if `$transclude` is never called for the slot), and
 * (b) synchronously at any later `$transclude(fn, null, '<slot>')` call
 * site for the unfilled slot.
 *
 * @example
 * ```ts
 * $compileProvider.directive('myCard', () => ({
 *   transclude: { titleSlot: 'card-title' }, // required (no `?` prefix)
 *   link: () => {},
 * }));
 * // <my-card></my-card> — no <card-title> child → at link time,
 * // RequiredTranscludeSlotUnfilledError routes via $exceptionHandler('$compile').
 * ```
 */
export class RequiredTranscludeSlotUnfilledError extends Error {
  readonly name = 'RequiredTranscludeSlotUnfilledError' as const;

  constructor(directiveName: string, slotName: string, selector: string) {
    super(
      `Required transclusion slot "${slotName}" expected one or more elements matching "${selector}", got none (directive ${directiveName})`,
    );
  }
}

/**
 * Thrown at LINK time when `$transclude(fn, null, '<slot>')` is called
 * with a slot name not declared on the host directive — OR when an
 * `<ng-transclude="<slot>">` marker references a slot the host did not
 * declare.
 *
 * Routed through `$exceptionHandler('$compile')` at the call site; the
 * call returns `[]` (or the marker becomes a no-op) so the surrounding
 * directive link does not crash.
 *
 * @example
 * ```ts
 * $compileProvider.directive('myCard', () => ({
 *   transclude: { titleSlot: 'card-title' },
 *   link: (_s, _e, _a, _c, $transclude) => {
 *     $transclude?.(() => {}, null, 'noSuchSlot');
 *     // routes UndeclaredTranscludeSlotError via $exceptionHandler('$compile')
 *   },
 * }));
 * ```
 */
export class UndeclaredTranscludeSlotError extends Error {
  readonly name = 'UndeclaredTranscludeSlotError' as const;

  constructor(directiveName: string, slotName: string) {
    super(`No transclusion slot "${slotName}" declared on directive ${directiveName}`);
  }
}

/**
 * Thrown by `ng-transclude` (Slice 5) when the marker is used in a
 * context the directive cannot handle:
 *
 * 1. **No enclosing transcluding directive** — the marker has no
 *    ancestor element carrying the framework-private `$$ngBoundTransclude`
 *    slot. The reason message is
 *    `ngTransclude must be used inside a directive declaring transclude: true | { … }`.
 * 2. **Named slot under a `transclude: true` host** — `transclude: true`
 *    exposes only the default slot; asking for a named slot is an
 *    authoring error. The reason message is
 *    `Slot "<name>" is not declared; transclude: true exposes only the default slot`.
 *
 * Routed through `$exceptionHandler('$compile')`; the marker becomes a
 * no-op (its pre-existing children remain unchanged) so the surrounding
 * directive link does not crash.
 *
 * @example
 * ```ts
 * // (1) Unenclosed marker — no transcluding ancestor:
 * const stray = document.createElement('div');
 * stray.setAttribute('ng-transclude', '');
 * $compile(stray)(scope);
 * // → NgTranscludeMisuseError('ngTransclude must be used inside a directive declaring transclude: true | { … }')
 *
 * // (2) Named slot under a `transclude: true` host:
 * $compileProvider.directive('myCard', () => ({
 *   transclude: true,
 *   link: (s, el) => {
 *     const t = document.createElement('div');
 *     const marker = document.createElement('div');
 *     marker.setAttribute('ng-transclude', 'titleSlot');
 *     t.appendChild(marker);
 *     el.appendChild(t);
 *     $compile(t)(s);
 *   },
 * }));
 * // → NgTranscludeMisuseError('Slot "titleSlot" is not declared; transclude: true exposes only the default slot')
 * ```
 */
export class NgTranscludeMisuseError extends Error {
  readonly name = 'NgTranscludeMisuseError' as const;

  // eslint-disable-next-line @typescript-eslint/no-useless-constructor -- The explicit constructor narrows the public surface: `NgTranscludeMisuseError` accepts a single `reason: string` argument (the misuse-class message) rather than the looser `ErrorOptions`-accepting overload `Error` itself supports. Removing it would let callers pass `new NgTranscludeMisuseError('msg', { cause: x })`, which is outside this class's public contract.
  constructor(reason: string) {
    super(reason);
  }
}
