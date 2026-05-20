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
 * @deprecated Spec 022 Slice 1 lifted the registration-time rejection of
 * the isolate-scope object form (`scope: { foo: '=' }`). This class is no
 * longer thrown anywhere in the codebase; it is kept exported for one
 * release as a deprecated no-op so a consumer catching it via
 * `err instanceof IsolateScopeNotSupportedError` does not see a sudden
 * `ReferenceError`. A future spec may remove it outright. Use
 * {@link InvalidIsolateBindingError} for malformed binding specs and
 * {@link MultipleIsolateScopeError} for the two-isolate-directives
 * conflict.
 *
 * Historic behavior (spec 017 — now removed): thrown lazily at
 * `<name>Directive` provider `$get` time when `ddo.scope` was the
 * object-form isolate-scope declaration.
 */
export class IsolateScopeNotSupportedError extends Error {
  readonly name = 'IsolateScopeNotSupportedError' as const;

  constructor(directiveName: string) {
    super(`Isolate scope is not yet supported (spec 017 ships only scope: false | true). Directive: ${directiveName}`);
  }
}

/**
 * Thrown by `parseBindingSpec` (spec 022 Slice 1) when a binding-spec
 * string inside an isolate-scope `scope: { … }` declaration cannot be
 * parsed against the canonical
 * `^\s*([=@<&])(\?)?\s*([A-Za-z_$][\w$]*)?\s*$` shape.
 *
 * Routed via the existing factory `try/catch` in
 * `$$buildDirectiveArrayProvider` → `$exceptionHandler('$compile')`.
 *
 * @example
 * ```ts
 * $compileProvider.directive('myDir', () => ({
 *   scope: { value: '==' }, // double-equals — not a valid binding spec
 * }));
 * // routes InvalidIsolateBindingError via $exceptionHandler('$compile')
 * ```
 */
export class InvalidIsolateBindingError extends Error {
  readonly name = 'InvalidIsolateBindingError' as const;

  constructor(directiveName: string, bindingKey: string, rawSpec: string) {
    super(
      `Invalid isolate binding "${rawSpec}" for "${bindingKey}" on directive ${directiveName}. ` +
        `Expected one of =, @, <, & (each optionally followed by ? and an attribute alias identifier).`,
    );
  }
}

/**
 * Thrown at LINK time (not registration) when two directives on the SAME
 * element both declare an isolate-scope object-form `scope: { … }`. An
 * element can host at most one isolate scope; the conflict is routed via
 * `$exceptionHandler('$compile')` and the per-element linker returns
 * early so downstream wiring does not run against a partially-initialized
 * state.
 *
 * @example
 * ```ts
 * $compileProvider
 *   .directive('dirA', () => ({ scope: { a: '@' } }))
 *   .directive('dirB', () => ({ scope: { b: '@' } }));
 * // <div dir-a dir-b></div> — at link time, MultipleIsolateScopeError
 * // routes via $exceptionHandler('$compile').
 * ```
 */
export class MultipleIsolateScopeError extends Error {
  readonly name = 'MultipleIsolateScopeError' as const;

  constructor(firstDirectiveName: string, secondDirectiveName: string, tagName: string) {
    super(
      `Multiple directives requesting an isolate scope on the same element <${tagName}>: ` +
        `"${firstDirectiveName}" and "${secondDirectiveName}". Only one isolate-scope directive is allowed per element.`,
    );
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

/**
 * Thrown by `normalizeDirective` (spec 019 Slice 4) when a directive
 * factory returns a Directive Definition Object whose `template`
 * property is neither `undefined`, a string, nor a function — i.e. it
 * is an unsupported runtime value such as a number, `null`, an object,
 * or an array.
 *
 * Routed via `$exceptionHandler('$compile')`. The directive is dropped
 * from the matched-directive array; sibling directives continue.
 *
 * @example
 * ```ts
 * $compileProvider.directive('myDir', () => ({ template: 42 }));
 * // routes InvalidTemplateValueError via $exceptionHandler('$compile')
 * ```
 */
export class InvalidTemplateValueError extends Error {
  readonly name = 'InvalidTemplateValueError' as const;

  constructor(directiveName: string, description: string) {
    super(`Invalid template value for directive ${directiveName}: ${description}`);
  }
}

/**
 * Thrown by `normalizeDirective` (spec 019 Slice 4) when a directive
 * factory returns a Directive Definition Object whose `templateUrl`
 * property is neither `undefined`, a string, nor a function.
 *
 * Routed via `$exceptionHandler('$compile')`. The directive is dropped
 * from the matched-directive array; sibling directives continue.
 *
 * @example
 * ```ts
 * $compileProvider.directive('myDir', () => ({ templateUrl: 42 }));
 * // routes InvalidTemplateUrlValueError via $exceptionHandler('$compile')
 * ```
 */
export class InvalidTemplateUrlValueError extends Error {
  readonly name = 'InvalidTemplateUrlValueError' as const;

  constructor(directiveName: string, description: string) {
    super(`Invalid templateUrl value for directive ${directiveName}: ${description}`);
  }
}

/**
 * Thrown by `normalizeDirective` when a directive declares
 * `template: ''` (empty string). An empty template is rejected at
 * registration to surface authoring mistakes early — otherwise the
 * runtime would silently strip the host's existing children and leave
 * an empty element with no diagnostic.
 *
 * Routed via `$exceptionHandler('$compile')`.
 *
 * @example
 * ```ts
 * $compileProvider.directive('myDir', () => ({ template: '' }));
 * // routes EmptyTemplateError via $exceptionHandler('$compile')
 * ```
 */
export class EmptyTemplateError extends Error {
  readonly name = 'EmptyTemplateError' as const;

  constructor(directiveName: string) {
    super(`Invalid template for directive ${directiveName}: empty string`);
  }
}

/**
 * Thrown by `normalizeDirective` when a directive declares
 * `templateUrl: ''` (empty string). The empty URL is rejected at
 * registration for the same authoring-clarity reason as
 * {@link EmptyTemplateError}.
 *
 * Routed via `$exceptionHandler('$compile')`.
 *
 * @example
 * ```ts
 * $compileProvider.directive('myDir', () => ({ templateUrl: '' }));
 * // routes EmptyTemplateUrlError via $exceptionHandler('$compile')
 * ```
 */
export class EmptyTemplateUrlError extends Error {
  readonly name = 'EmptyTemplateUrlError' as const;

  constructor(directiveName: string) {
    super(`Invalid templateUrl for directive ${directiveName}: empty string`);
  }
}

/**
 * Thrown by `normalizeDirective` when a directive declares BOTH
 * `template` AND `templateUrl` on the same Directive Definition
 * Object. The two are mutually exclusive — AngularJS-canonical
 * behavior is to reject the combination at registration time rather
 * than silently picking one.
 *
 * Routed via `$exceptionHandler('$compile')`.
 *
 * @example
 * ```ts
 * $compileProvider.directive('myDir', () => ({
 *   template: '<p>a</p>',
 *   templateUrl: '/tpl.html',
 * }));
 * // routes TemplateAndTemplateUrlCombinedError via $exceptionHandler('$compile')
 * ```
 */
export class TemplateAndTemplateUrlCombinedError extends Error {
  readonly name = 'TemplateAndTemplateUrlCombinedError' as const;

  constructor(directiveName: string) {
    super(`Cannot combine template and templateUrl on directive ${directiveName}; choose one`);
  }
}

/**
 * Thrown by `normalizeDirective` when a directive declares
 * `replace: true` (or any other truthy / non-`false` runtime value).
 * AngularJS 1.x deprecated `replace: true` and this project does not
 * ship it — templates always become the host element's children; the
 * host element itself is preserved with all its attributes and
 * listeners intact.
 *
 * Routed via `$exceptionHandler('$compile')`. The directive's other
 * behavior (link, compile, transclude) still runs; only the `replace`
 * declaration is rejected.
 *
 * @example
 * ```ts
 * $compileProvider.directive('myDir', () => ({
 *   template: '<p>hi</p>',
 *   replace: true,
 * }));
 * // routes ReplaceTrueNotSupportedError via $exceptionHandler('$compile')
 * ```
 */
export class ReplaceTrueNotSupportedError extends Error {
  readonly name = 'ReplaceTrueNotSupportedError' as const;

  constructor(directiveName: string) {
    super(
      `replace: true is deprecated in AngularJS 1.x and is not supported. Use template/templateUrl without replace; the template becomes the host element's children. Directive: ${directiveName}`,
    );
  }
}

/**
 * Thrown at COMPILE time (not registration) when a function-form
 * `template` returns a non-string value (`undefined`, `null`, a
 * number, an object, …). Validation of the return value is per-host
 * element so it can only run when the function is invoked — i.e. at
 * compile time, not at registration.
 *
 * Routed via `$exceptionHandler('$compile')`. The host element stays
 * empty; the directive's other behavior (link, compile) runs;
 * siblings continue.
 *
 * @example
 * ```ts
 * $compileProvider.directive('myDir', () => ({
 *   template: () => undefined as unknown as string,
 * }));
 * $compile(document.createElement('my-dir'))(scope);
 * // routes TemplateFunctionReturnedNonStringError via $exceptionHandler('$compile')
 * ```
 */
export class TemplateFunctionReturnedNonStringError extends Error {
  readonly name = 'TemplateFunctionReturnedNonStringError' as const;

  constructor(directiveName: string, description: string) {
    super(`Template function for directive ${directiveName} returned a non-string value: ${description}`);
  }
}

/**
 * Thrown at COMPILE time when a function-form `templateUrl` returns a
 * non-string value. Mirrors {@link TemplateFunctionReturnedNonStringError}
 * for the async path.
 *
 * Routed via `$exceptionHandler('$compile')`. The host element stays
 * empty; siblings continue.
 *
 * @example
 * ```ts
 * $compileProvider.directive('myDir', () => ({
 *   templateUrl: () => 42 as unknown as string,
 * }));
 * // routes TemplateUrlFunctionReturnedNonStringError via $exceptionHandler('$compile')
 * ```
 */
export class TemplateUrlFunctionReturnedNonStringError extends Error {
  readonly name = 'TemplateUrlFunctionReturnedNonStringError' as const;

  constructor(directiveName: string, description: string) {
    super(`templateUrl function for directive ${directiveName} returned a non-string value: ${description}`);
  }
}

/**
 * Thrown at LINK time (not registration) when two directives on the
 * SAME element BOTH declare `template` (or `templateUrl`, or one of
 * each). AngularJS's "first wins" rule applies: the first
 * template-declaring directive's template installs; the second's
 * template declaration is silently ignored. The second directive's
 * OTHER behavior — link, compile, transclude, scope — still runs.
 *
 * Routed through `$exceptionHandler('$compile')` from the compile
 * pre-pass; never thrown synchronously to the caller. Deterministic
 * for a given matched-directive set (priority desc, registration-
 * order tie-break).
 *
 * @example
 * ```ts
 * $compileProvider.directive('dirA', () => ({ template: '<p>A</p>' }));
 * $compileProvider.directive('dirB', () => ({ template: '<p>B</p>' }));
 * // <div dir-a dir-b></div> — at link time, dirB triggers
 * // MultipleTemplateDirectivesError via $exceptionHandler('$compile').
 * // dirA's template wins; dirB's link / compile still run.
 * ```
 */
export class MultipleTemplateDirectivesError extends Error {
  readonly name = 'MultipleTemplateDirectivesError' as const;

  constructor(firstDirectiveName: string, secondDirectiveName: string) {
    super(
      `Multiple directives requesting a template on the same element: "${firstDirectiveName}" and "${secondDirectiveName}". Only the first wins; "${secondDirectiveName}"'s template is ignored.`,
    );
  }
}

/**
 * Thrown when `$templateRequest` cannot retrieve a template — typical
 * causes are a non-2xx HTTP status, a network failure, or a CORS
 * rejection. The error message includes both the URL and the
 * underlying reason so the routed `$exceptionHandler('$compile')`
 * surface carries actionable diagnostics.
 *
 * `$templateRequest` rejects its returned promise with this error
 * class; the compiler's deferred-install queue catches the rejection
 * and routes it via `$exceptionHandler('$compile')`. The host element
 * stays empty; siblings continue.
 *
 * @example
 * ```ts
 * try {
 *   await $templateRequest('/missing.html');
 * } catch (err) {
 *   if (err instanceof TemplateFetchFailedError) {
 *     console.warn(err.message); // 'Failed to load template "/missing.html": …'
 *   }
 * }
 * ```
 */
export class TemplateFetchFailedError extends Error {
  readonly name = 'TemplateFetchFailedError' as const;

  constructor(url: string, reason: string) {
    super(`Failed to load template "${url}": ${reason}`);
  }
}

/**
 * Thrown at LINK time (not registration) when a directive declaring
 * `require: '<name>'` (or a `^`/`^^`-prefixed variant, or an entry of
 * the array / object forms) cannot resolve the named controller and the
 * requirement is NOT marked optional (no leading `?`).
 *
 * Routed via `$exceptionHandler('$compile')` from the per-element
 * `require` resolver. The directive's other behavior (link, compile,
 * transclude) on the same element still runs; siblings are unaffected.
 *
 * The error message names the requiring directive, the missing
 * controller's directive name, and describes the search scope as
 * own-element, element-and-ancestors (`^`), or ancestors-only (`^^`).
 *
 * @example
 * ```ts
 * $compileProvider.directive('child', () => ({
 *   require: '^parent',          // search element + ancestors
 *   link: (_s, _e, _a, parentCtrl) => {
 *     // parentCtrl is the resolved controller instance
 *   },
 * }));
 * // <div child></div> — no `parent` directive anywhere → at link time,
 * // MissingRequiredControllerError routes via $exceptionHandler('$compile').
 * ```
 */
export class MissingRequiredControllerError extends Error {
  readonly name = 'MissingRequiredControllerError' as const;

  constructor(requiringDirective: string, requiredName: string, prefix: '' | '^' | '^^') {
    const scope =
      prefix === '^^' ? 'ancestors only' : prefix === '^' ? 'this element and its ancestors' : 'this element';
    super(`Controller "${requiredName}" required by directive "${requiringDirective}" was not found in ${scope}`);
  }
}
