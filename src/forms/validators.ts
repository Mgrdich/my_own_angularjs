/**
 * Built-in validator directives (spec 039 Slice 5 / FS §2.6,
 * technical-considerations §2.3).
 *
 * Each directive `require: '?ngModel'` and, on link, pushes a rule onto the
 * control's `$validators` map (or, where AngularJS does, `$parsers`) under
 * a fixed key so a failure surfaces `ng-invalid-<key>` + `$error[key]` and
 * bubbles to the enclosing form. All of them re-validate when their bound
 * attribute / expression changes: `ngMinlength` / `ngMaxlength` / `pattern`
 * `$observe` their attribute and call `$validate()`; `ngRequired` /
 * `ngPattern` re-parse their expression on `$observe`.
 *
 * **Empty-value convention (parity).** Every length / pattern validator
 * PASSES on an empty value (`ctrl.$isEmpty(viewValue)`) — emptiness is
 * `required`'s concern alone. This lets `required` + `ng-minlength` compose:
 * an empty field is `required`-invalid but not `minlength`-invalid.
 *
 * The `email` / `number` / `url` TYPE validators are NOT here — they are
 * wired by their `inputType` handler (`input-types.ts`), matching AngularJS
 * (a type validator belongs to the type, not a standalone attribute). The
 * `min` / `max` validators are likewise wired by the `number` / `range` /
 * date handlers.
 *
 * Like every forms directive these are DI-only core `ng` directives (their
 * factories stay file-local; only registered through `forms-register.ts`).
 */

import type { Scope } from '@core/index';

import type { Attributes, DirectiveFactory, DirectiveFactoryReturn, LinkFn } from '@compiler/directive-types';
import { parse } from '@parser/index';

import { NgModelControllerImpl } from './ng-model-controller';

export const REQUIRED_NAME = 'required';
export const NG_REQUIRED_NAME = 'ngRequired';
export const NG_MINLENGTH_NAME = 'ngMinlength';
export const MINLENGTH_NAME = 'minlength';
export const NG_MAXLENGTH_NAME = 'ngMaxlength';
export const MAXLENGTH_NAME = 'maxlength';
export const PATTERN_NAME = 'pattern';
export const NG_PATTERN_NAME = 'ngPattern';

/** Narrow the `require: '?ngModel'` result to the controller (or `null`). */
function asNgModelController(controllers: unknown): NgModelControllerImpl | null {
  return controllers instanceof NgModelControllerImpl ? controllers : null;
}

/** Read a normalized string attribute, or `undefined` when absent / non-string. */
function readAttr(attrs: Attributes, name: string): string | undefined {
  const raw = attrs[name];
  return typeof raw === 'string' ? raw : undefined;
}

/** Evaluate an expression attribute against the scope (AngularJS `$parse(expr)(scope)`). */
function evalExpr(expr: string, scope: Scope): unknown {
  return parse(expr)(scope as unknown as Record<string, unknown>);
}

/**
 * Parse a length attribute (`ng-minlength` / `ng-maxlength`) to a
 * non-negative integer, or `-1` when absent / non-numeric — `-1` makes the
 * corresponding validator a no-op (AngularJS's `parseLength`).
 */
function parseLength(val: unknown): number {
  const num = Number.parseInt(String(val), 10);
  return Number.isNaN(num) ? -1 : num;
}

/**
 * Read the initial parsed length bound: the native `minlength` /
 * `maxlength` attribute string if present, else the evaluated
 * `ng-minlength` / `ng-maxlength` expression, else `-1` (no bound).
 */
function readInitialLength(scope: Scope, attrs: Attributes, nativeName: string, ngName: string): number {
  const native = readAttr(attrs, nativeName);
  if (native !== undefined) {
    return parseLength(native);
  }
  const ngExpr = readAttr(attrs, ngName);
  return ngExpr !== undefined ? parseLength(evalExpr(ngExpr, scope)) : -1;
}

/**
 * Wire the re-validation source for a length bound. The native attribute
 * (`minlength` / `maxlength`) is `$observe`d ONLY when actually present —
 * observing a missing attribute would fire a one-shot `undefined`
 * notification and wrongly reset the bound; when the bound comes purely
 * from the `ng-minlength` / `ng-maxlength` EXPRESSION, that expression is
 * `$watch`ed instead. `onChange` receives the freshly parsed length.
 */
function wireLengthSource(
  scope: Scope,
  attrs: Attributes,
  nativeName: string,
  ngName: string,
  onChange: (parsed: number) => void,
): void {
  if (readAttr(attrs, nativeName) !== undefined) {
    const stopObserve = attrs.$observe(nativeName, (val) => {
      onChange(parseLength(val));
    });
    scope.$on('$destroy', stopObserve);
    return;
  }
  const ngExpr = readAttr(attrs, ngName);
  if (ngExpr !== undefined) {
    scope.$watch(ngExpr, (val: unknown) => {
      onChange(parseLength(val));
    });
  }
}

/**
 * `required` / `ngRequired` — the value must be non-empty (FS §2.6). The
 * conditional `ng-required="expr"` form gates the rule on a boolean
 * expression: `required` is enforced only while `expr` is truthy. Both
 * publish the same `required` validator key (→ `ng-invalid-required`).
 *
 * The rule passes when the requirement is off (`!value`) OR the view value
 * is not empty. Observing the `required` attribute (which `ngRequired`
 * writes through interpolation) re-validates when the gate flips.
 */
function requiredFactory(): DirectiveFactoryReturn {
  const link: LinkFn = (scope, _element, attrs, controllers) => {
    const ctrl = asNgModelController(controllers);
    if (ctrl === null) {
      return;
    }

    const ngRequired = readAttr(attrs, NG_REQUIRED_NAME);
    // `value` is the current requiredness: the bare `required` attribute is
    // always-on; `ng-required` evaluates its expression.
    let value: unknown = ngRequired !== undefined ? evalExpr(ngRequired, scope) : REQUIRED_NAME in attrs;

    ctrl.$validators[REQUIRED_NAME] = (_modelValue: unknown, viewValue: unknown): boolean =>
      !value || !ctrl.$isEmpty(viewValue);

    // Re-evaluate the gate when `ng-required`'s expression changes. `parse`
    // has no watch of its own, so watch the expression on the scope.
    if (ngRequired !== undefined) {
      scope.$watch(ngRequired, (newVal: unknown) => {
        if (value !== newVal) {
          value = newVal;
          ctrl.$validate();
        }
      });
    }
  };

  return { restrict: 'A', require: '?ngModel', link };
}

/**
 * `ng-minlength` — the text must be at least N characters (FS §2.6).
 * Publishes the `minlength` validator key. `$observe`s the `minlength`
 * attribute so a data-driven bound re-validates. Passes on an empty value.
 */
function minlengthFactory(): DirectiveFactoryReturn {
  const link: LinkFn = (scope, _element, attrs, controllers) => {
    const ctrl = asNgModelController(controllers);
    if (ctrl === null) {
      return;
    }

    let parsedLength = -1;
    ctrl.$validators[MINLENGTH_NAME] = (_modelValue: unknown, viewValue: unknown): boolean =>
      ctrl.$isEmpty(viewValue) || String(viewValue).length >= parsedLength;

    wireLengthSource(scope, attrs, MINLENGTH_NAME, NG_MINLENGTH_NAME, (parsed) => {
      parsedLength = parsed;
      ctrl.$validate();
    });
    // Seed the initial parsed bound synchronously so the first commit sees it.
    parsedLength = readInitialLength(scope, attrs, MINLENGTH_NAME, NG_MINLENGTH_NAME);
  };

  return { restrict: 'A', require: '?ngModel', link };
}

/**
 * `ng-maxlength` — the text must be at most N characters (FS §2.6).
 * Publishes the `maxlength` validator key. A negative bound (`-1`, absent /
 * non-numeric) is a no-op. `$observe`s the attribute; passes on empty.
 */
function maxlengthFactory(): DirectiveFactoryReturn {
  const link: LinkFn = (scope, _element, attrs, controllers) => {
    const ctrl = asNgModelController(controllers);
    if (ctrl === null) {
      return;
    }

    let parsedLength = -1;
    ctrl.$validators[MAXLENGTH_NAME] = (_modelValue: unknown, viewValue: unknown): boolean =>
      parsedLength < 0 || ctrl.$isEmpty(viewValue) || String(viewValue).length <= parsedLength;

    wireLengthSource(scope, attrs, MAXLENGTH_NAME, NG_MAXLENGTH_NAME, (parsed) => {
      parsedLength = parsed;
      ctrl.$validate();
    });
    parsedLength = readInitialLength(scope, attrs, MAXLENGTH_NAME, NG_MAXLENGTH_NAME);
  };

  return { restrict: 'A', require: '?ngModel', link };
}

/**
 * Matches an `ng-pattern` value written as a regex LITERAL (`/.../flags`) —
 * as opposed to a scope expression yielding a RegExp / string. Mirrors
 * AngularJS's `REGEX_STRING_REGEXP`.
 */
const REGEX_STRING_REGEXP = /^\/(.+)\/([a-z]*)$/;

/**
 * Resolve a pattern attribute value to a `RegExp`, or `undefined` when
 * absent. Accepts a `RegExp` instance (from a scope expression), a
 * `/.../flags` literal string, or a plain string (compiled anchored). A
 * malformed literal throws `SyntaxError` from `RegExp` — matching
 * AngularJS's behavior of surfacing the error.
 */
function parsePattern(value: unknown): RegExp | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (value instanceof RegExp) {
    return value;
  }
  // A non-RegExp, non-string source (e.g. an expression yielding a number)
  // has no meaningful pattern — treat it as "no pattern" rather than
  // stringify-then-compile garbage.
  if (typeof value !== 'string') {
    return undefined;
  }
  const str = value;
  const literal = REGEX_STRING_REGEXP.exec(str);
  if (literal !== null) {
    return new RegExp(literal[1] ?? '', literal[2] ?? '');
  }
  // A plain string pattern is anchored (AngularJS compiles `new RegExp('^' + str + '$')`).
  return new RegExp(`^${str}$`);
}

/**
 * `pattern` / `ng-pattern` — the text must match a regular expression
 * (FS §2.6). Publishes the `pattern` validator key. The pattern source may
 * be a regex literal (`/^\d+$/`), a scope expression yielding a `RegExp`,
 * or a plain string; `ng-pattern` re-parses on `$observe('pattern')` (the
 * interpolated value) and on the expression's own change. Passes on empty.
 */
function patternFactory(): DirectiveFactoryReturn {
  const link: LinkFn = (scope, _element, attrs, controllers) => {
    const ctrl = asNgModelController(controllers);
    if (ctrl === null) {
      return;
    }

    const ngPattern = readAttr(attrs, NG_PATTERN_NAME);
    // Resolve the initial source: `ng-pattern` — a literal string passes
    // through verbatim (so `/.../` is honored), otherwise it is an
    // expression evaluated against the scope; bare `pattern` reads the
    // attribute string.
    function resolveSource(): unknown {
      if (ngPattern !== undefined) {
        return REGEX_STRING_REGEXP.test(ngPattern) ? ngPattern : evalExpr(ngPattern, scope);
      }
      return readAttr(attrs, PATTERN_NAME);
    }

    let regexp = parsePattern(resolveSource());

    ctrl.$validators[PATTERN_NAME] = (_modelValue: unknown, viewValue: unknown): boolean =>
      ctrl.$isEmpty(viewValue) || regexp === undefined || regexp.test(String(viewValue));

    // Re-resolve the pattern when its source changes, re-validating only on
    // an actual change (`toString()` compare — parity). The native
    // `pattern` attribute is `$observe`d ONLY when present; a `ng-pattern`
    // EXPRESSION (non-literal) is `$watch`ed so a data-driven RegExp change
    // re-validates. A `/.../` literal never changes, so it needs neither.
    const revalidate = (): void => {
      const next = parsePattern(resolveSource());
      const changed = (regexp?.toString() ?? '') !== (next?.toString() ?? '');
      regexp = next;
      if (changed) {
        ctrl.$validate();
      }
    };

    if (readAttr(attrs, PATTERN_NAME) !== undefined) {
      const stopObserve = attrs.$observe(PATTERN_NAME, revalidate);
      scope.$on('$destroy', stopObserve);
    } else if (ngPattern !== undefined && !REGEX_STRING_REGEXP.test(ngPattern)) {
      scope.$watch(ngPattern, revalidate);
    }
  };

  return { restrict: 'A', require: '?ngModel', link };
}

/** DI-annotated built-in validator factories (all zero-dep, array-wrapped). */
export const requiredDirective: DirectiveFactory = [requiredFactory];
export const ngRequiredDirective: DirectiveFactory = [requiredFactory];
export const minlengthDirective: DirectiveFactory = [minlengthFactory];
export const maxlengthDirective: DirectiveFactory = [maxlengthFactory];
export const patternDirective: DirectiveFactory = [patternFactory];
export const ngPatternDirective: DirectiveFactory = [patternFactory];
