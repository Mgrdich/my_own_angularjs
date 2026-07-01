/**
 * Input-type handler registry (spec 039 Slice 1 + Slice 3 / FS §2.4,
 * technical-considerations §2.4).
 *
 * One `input` directive dispatches on `attrs.type` into the handlers
 * registered here (AngularJS parity — NOT one directive per type).
 * Slice 1 shipped the baseline `text` handler; Slice 3 fills in
 * `number` / `range` / `checkbox` / `radio` / the date-time family
 * (`date` / `datetime-local` / `time` / `month` / `week`) and the
 * no-model controls (`hidden` / `button` / `submit` / `reset`). Slice 5
 * wires the `email` / `number` / `url` type validators through these
 * handlers.
 *
 * A handler receives the linked `scope`, the control `element`, the
 * shared `attrs`, and the published {@link NgModelController}. It is
 * responsible for:
 *
 *  - installing `$render` (writes `$viewValue` to the DOM control), and
 *  - registering the native DOM event listeners that call
 *    `$setViewValue` on user input.
 *
 * **`$$phase`-guarded dispatch.** A native event firing while a digest is
 * already in flight (e.g. inside another `$apply`) must NOT call
 * `scope.$apply` (which throws `'$digest already in progress'`). The
 * shared {@link applyDuringEvent} helper dispatches through
 * `scope.$evalAsync` in that case and `scope.$apply` otherwise — the
 * established event-directive pattern. The runner is wrapped in a
 * `try/catch` that routes through `$exceptionHandler` with cause
 * `'$compile'` because the project's `$apply` is `try/finally`-only.
 */

import type { Scope } from '@core/index';

import type { Attributes } from '@compiler/directive-types';
import { invokeExceptionHandler, type ExceptionHandler } from '@exception-handler/index';
import { parse } from '@parser/index';

import { formatDateInput, LOCAL_TIMEZONE, parseDateInput, type DateInputKind } from './input-date';
import type { NgModelControllerImpl } from './ng-model-controller';

/**
 * Context handed to every input-type handler.
 */
export interface InputTypeContext {
  scope: Scope;
  element: HTMLInputElement | HTMLTextAreaElement;
  attrs: Attributes;
  ctrl: NgModelControllerImpl;
  exceptionHandler: ExceptionHandler;
}

/**
 * An input-type handler installs `$render` + the native event listeners
 * for one (group of) `type` value(s).
 */
export type InputTypeHandler = (ctx: InputTypeContext) => void;

/**
 * Dispatch a runner through the `$$phase`-guarded `$apply` / `$evalAsync`
 * seam, routing any throw via `$exceptionHandler('$compile')`. Mirrors the
 * spec-026 event-directive workaround (the project's `$apply` is
 * `try/finally`, not `try/catch`).
 */
export function applyDuringEvent(scope: Scope, exceptionHandler: ExceptionHandler, run: () => void): void {
  try {
    if (scope.$$phase !== null) {
      scope.$evalAsync(run);
    } else {
      scope.$apply(run);
    }
  } catch (err) {
    invokeExceptionHandler(exceptionHandler, err, '$compile');
  }
}

/**
 * Coerce a view value to the string a text control should display.
 * `undefined` / `null` render as `''` (never the literal words); a value
 * that is already a string passes through; numbers / booleans use their
 * primitive string form. Any other shape (an object, etc.) is treated as
 * empty rather than producing `'[object Object]'` — a text control should
 * not be fed a non-primitive model, and showing the brace-noise would be
 * worse than blank.
 */
function stringifyView(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

/**
 * Coerce an unknown view value to a string for a `$parser` that consumes
 * the raw on-screen text. The listener always feeds `element.value` (a
 * string), so this is normally an identity; a non-string / non-primitive
 * (defensive — a caller invoking `$setViewValue` with an object) maps to
 * `''` rather than producing `'[object Object]'`.
 */
function toStringView(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

/**
 * Read the narrowed `HTMLInputElement` view of the control. The date /
 * number / checkbox / radio handlers only ever run for an `<input>` (a
 * `<textarea>` always routes to the `text` handler in `input.ts`), so the
 * cast is sound.
 */
function asInput(element: HTMLInputElement | HTMLTextAreaElement): HTMLInputElement {
  return element as HTMLInputElement;
}

/**
 * Whether the control's native `validity.badInput` flag is set — the
 * browser could not sanitize the raw user input into a value for a typed
 * control (`number` / `date` / …). In that state the browser reports
 * `element.value === ''`, so `badInput` is the only observable signal that
 * the raw input was garbage. Mirrors AngularJS's `badInputChecker`. Guards
 * against environments where `validity` is absent.
 */
function hasBadInput(control: HTMLInputElement): boolean {
  // `HTMLInputElement.validity` is typed non-nullable, but a bare Element
  // cast (the M-restricted / non-input edge) may lack it at runtime, so a
  // defensive optional-chain read keeps the check safe without a redundant
  // typed-`undefined` comparison the linter rejects.
  return control.validity.badInput;
}

/**
 * Baseline string handler used by `text` / `search` / `tel` / `password`
 * / `email` / `url` inputs and by `textarea`. Renders the model's
 * formatted string into `element.value` and commits user input on the
 * native `input` and `change` events.
 *
 * The `$render` writer coerces `undefined` / `null` to `''` so the control
 * never shows the literal words; the listener reads `element.value`
 * verbatim (parsers — e.g. trim, type validators — run inside
 * `$setViewValue`).
 */
export const textInputType: InputTypeHandler = ({ scope, element, ctrl, exceptionHandler }) => {
  ctrl.$render = () => {
    element.value = stringifyView(ctrl.$viewValue);
  };

  const listener = () => {
    applyDuringEvent(scope, exceptionHandler, () => {
      ctrl.$setViewValue(element.value);
    });
  };

  element.addEventListener('input', listener);
  element.addEventListener('change', listener);

  scope.$on('$destroy', () => {
    element.removeEventListener('input', listener);
    element.removeEventListener('change', listener);
  });
};

/**
 * Matches a numeric string AngularJS accepts for `type=number` (integers,
 * decimals, scientific notation, leading sign). Empty / non-numeric input
 * fails the `number` validator instead of writing a bad model.
 */
const NUMBER_RE = /^\s*(-|\+)?(\d+|(\d*(\.\d*)))([eE][+-]?\d+)?\s*$/;

/**
 * `number` / `range` handler — the model holds a **Number** (FS §2.4).
 *
 * Parsing: an empty view value maps to `null` (an empty control is not a
 * bad number — it is simply blank, so the `number` validity key stays
 * true); a non-numeric string sets `$setValidity('number', false)` and
 * returns `undefined` so the bad value is kept OUT of the model; a numeric
 * string parses to a `Number` (and clears the `number` validity key).
 *
 * `range` additionally clamps the parsed number to `min` / `max` / `step`
 * — the browser's native range clamping, reproduced so the model matches
 * what the slider actually shows. Slice 5 adds the standalone `min` / `max`
 * validator directives; the `number` validity key set here is where those
 * build on.
 */
function makeNumericHandler(isRange: boolean): InputTypeHandler {
  return ({ scope, element, attrs, ctrl, exceptionHandler }) => {
    const control = asInput(element);

    // View → model parser: string → Number, guarding the `number` key.
    // A `type=number` control whose native `validity.badInput` is set (the
    // user typed a non-numeric string that the browser could not sanitize
    // into a value) fails the `number` rule directly — the browser reports
    // `element.value === ''` in that state, so `badInput` is the only
    // observable signal that the raw input was garbage (AngularJS parity —
    // `badInputChecker`). We also keep the regex guard for the non-empty
    // string path (environments / values that surface the raw string).
    ctrl.$parsers.push((viewValue: unknown): unknown => {
      if (hasBadInput(control)) {
        ctrl.$setValidity('number', false);
        return undefined;
      }
      if (viewValue === undefined || viewValue === null || viewValue === '') {
        ctrl.$setValidity('number', true);
        return null;
      }
      const str = toStringView(viewValue);
      if (!NUMBER_RE.test(str)) {
        ctrl.$setValidity('number', false);
        return undefined;
      }
      ctrl.$setValidity('number', true);
      let num = Number.parseFloat(str);
      if (isRange) {
        num = clampToRange(num, attrs);
      }
      return num;
    });

    // Model → view formatter: Number → string (blank for null/undefined).
    ctrl.$formatters.push((modelValue: unknown): unknown => {
      if (modelValue === undefined || modelValue === null) {
        return '';
      }
      if (typeof modelValue === 'number') {
        return String(modelValue);
      }
      return modelValue;
    });

    ctrl.$render = () => {
      control.value = stringifyView(ctrl.$viewValue);
    };

    const listener = () => {
      applyDuringEvent(scope, exceptionHandler, () => {
        ctrl.$setViewValue(control.value);
      });
    };
    control.addEventListener('input', listener);
    control.addEventListener('change', listener);
    scope.$on('$destroy', () => {
      control.removeEventListener('input', listener);
      control.removeEventListener('change', listener);
    });
  };
}

/**
 * Clamp a number to the control's `min` / `max` / `step` attributes,
 * reproducing the browser's native `type=range` clamping. `min` defaults
 * to 0 and `max` to 100 (the HTML defaults); `step` (default 1) snaps to
 * the nearest step above `min`.
 */
function clampToRange(value: number, attrs: Attributes): number {
  const minAttr = attrs['min'];
  const maxAttr = attrs['max'];
  const stepAttr = attrs['step'];
  const min = typeof minAttr === 'string' && minAttr !== '' ? Number.parseFloat(minAttr) : 0;
  const max = typeof maxAttr === 'string' && maxAttr !== '' ? Number.parseFloat(maxAttr) : 100;
  const step = typeof stepAttr === 'string' && stepAttr !== '' ? Number.parseFloat(stepAttr) : 1;

  let result = value;
  if (Number.isFinite(min) && result < min) {
    result = min;
  }
  if (Number.isFinite(max) && result > max) {
    result = max;
  }
  // Snap to the nearest step boundary relative to min.
  if (Number.isFinite(step) && step > 0) {
    const steps = Math.round((result - min) / step);
    result = min + steps * step;
    if (Number.isFinite(max) && result > max) {
      result -= step;
    }
    // Guard against floating-point drift (e.g. 0.1 + 0.2).
    result = Number.parseFloat(result.toPrecision(12));
  }
  return result;
}

export const numberInputType: InputTypeHandler = makeNumericHandler(false);
export const rangeInputType: InputTypeHandler = makeNumericHandler(true);

/**
 * Evaluate a constant-attribute expression (`ng-true-value` /
 * `ng-false-value` / `ng-value`) once against the scope, matching
 * AngularJS (`$parse(attr)(scope)`). A missing attribute yields the
 * supplied `fallback`.
 */
function evalConstantAttr(attrs: Attributes, name: string, scope: Scope, fallback: unknown): unknown {
  const raw = attrs[name];
  if (typeof raw !== 'string') {
    return fallback;
  }
  return parse(raw)(scope as unknown as Record<string, unknown>);
}

/**
 * `checkbox` handler — the model holds a **boolean** (FS §2.4).
 *
 * `ng-true-value` / `ng-false-value` override the checked / unchecked
 * model values (parsed as constant expressions per AngularJS, so
 * `ng-true-value="'YES'"` stores the string `'YES'`). `$isEmpty` is
 * overridden so an unchecked checkbox counts as empty (drives `ng-empty`
 * and `required`).
 */
export const checkboxInputType: InputTypeHandler = ({ scope, element, attrs, ctrl, exceptionHandler }) => {
  const control = asInput(element);
  const trueValue = evalConstantAttr(attrs, 'ngTrueValue', scope, true);
  const falseValue = evalConstantAttr(attrs, 'ngFalseValue', scope, false);

  // A checkbox is "empty" when it is NOT checked (i.e. the model value
  // equals the false value). Compared by strict equality with the resolved
  // true value.
  ctrl.$isEmpty = (value: unknown): boolean => value !== trueValue;

  ctrl.$render = () => {
    control.checked = ctrl.$viewValue === trueValue;
  };

  const listener = () => {
    applyDuringEvent(scope, exceptionHandler, () => {
      ctrl.$setViewValue(control.checked ? trueValue : falseValue);
    });
  };
  control.addEventListener('change', listener);
  scope.$on('$destroy', () => {
    control.removeEventListener('change', listener);
  });
};

/**
 * `radio` handler — the model holds the **value of the selected radio**
 * among a group sharing the same `ng-model` (FS §2.4).
 *
 * The checked radio's `value` (or `ng-value`, parsed as a constant
 * expression) becomes the model; `$render` sets `.checked` by comparing
 * the model against this radio's value. Every radio in the group binds the
 * same model expression, so a `change` on one commits its value and the
 * model→view watch un-checks the others on the next digest.
 */
export const radioInputType: InputTypeHandler = ({ scope, element, attrs, ctrl, exceptionHandler }) => {
  const control = asInput(element);

  // The value this radio contributes when checked: `ng-value` (constant
  // expression) if present, else the raw `value` attribute string.
  function currentValue(): unknown {
    const ngValue = attrs['ngValue'];
    if (typeof ngValue === 'string') {
      return parse(ngValue)(scope as unknown as Record<string, unknown>);
    }
    const valueAttr = attrs['value'];
    return typeof valueAttr === 'string' ? valueAttr : undefined;
  }

  ctrl.$render = () => {
    control.checked = ctrl.$viewValue === currentValue();
  };

  const listener = () => {
    if (!control.checked) {
      return;
    }
    applyDuringEvent(scope, exceptionHandler, () => {
      ctrl.$setViewValue(currentValue());
    });
  };
  control.addEventListener('change', listener);

  // Re-render when `ng-value` changes so a data-driven value stays in sync.
  const stopObserve = attrs.$observe('value', () => {
    ctrl.$render();
  });

  scope.$on('$destroy', () => {
    control.removeEventListener('change', listener);
    stopObserve();
  });
};

/**
 * Build a date/time-family handler for one {@link DateInputKind}. The
 * model holds a **`Date`** (FS §2.4); parse/format is delegated to
 * `input-date.ts`, isolated so Slice 6's `ngModelOptions.timezone` wiring
 * threads a resolved timezone in cleanly. Slice 3 always uses
 * {@link LOCAL_TIMEZONE} (the host's local zone).
 *
 * The per-type validity key (`date` / `datetime-local` / `time` /
 * `month` / `week`) is set false when the string is present but malformed,
 * keeping the bad value out of the model; an empty control clears the key.
 * Slice 5's `min` / `max` validators compare against the parsed `Date`.
 */
function makeDateHandler(kind: DateInputKind): InputTypeHandler {
  return ({ scope, element, ctrl, exceptionHandler }) => {
    const control = asInput(element);

    ctrl.$parsers.push((viewValue: unknown): unknown => {
      if (hasBadInput(control)) {
        ctrl.$setValidity(kind, false);
        return undefined;
      }
      if (viewValue === undefined || viewValue === null || viewValue === '') {
        ctrl.$setValidity(kind, true);
        return null;
      }
      const parsed = parseDateInput(kind, toStringView(viewValue), LOCAL_TIMEZONE);
      if (parsed === null) {
        ctrl.$setValidity(kind, false);
        return undefined;
      }
      ctrl.$setValidity(kind, true);
      return parsed;
    });

    ctrl.$formatters.push((modelValue: unknown): unknown => formatDateInput(kind, modelValue, LOCAL_TIMEZONE));

    ctrl.$render = () => {
      control.value = typeof ctrl.$viewValue === 'string' ? ctrl.$viewValue : '';
    };

    const listener = () => {
      applyDuringEvent(scope, exceptionHandler, () => {
        ctrl.$setViewValue(control.value);
      });
    };
    control.addEventListener('input', listener);
    control.addEventListener('change', listener);
    scope.$on('$destroy', () => {
      control.removeEventListener('input', listener);
      control.removeEventListener('change', listener);
    });
  };
}

export const dateInputType: InputTypeHandler = makeDateHandler('date');
export const dateTimeLocalInputType: InputTypeHandler = makeDateHandler('datetime-local');
export const timeInputType: InputTypeHandler = makeDateHandler('time');
export const monthInputType: InputTypeHandler = makeDateHandler('month');
export const weekInputType: InputTypeHandler = makeDateHandler('week');

/**
 * No-model handler for `hidden` / `button` / `submit` / `reset`. These
 * controls do not participate in `ng-model` parsing — the handler is a
 * deliberate no-op (it installs no `$render`, no listeners), matching
 * AngularJS's empty `inputType` entries. A leftover `ng-model` on such a
 * control simply never round-trips.
 */
export const noopInputType: InputTypeHandler = () => {
  /* no model parsing for hidden / button / submit / reset */
};

/**
 * The type registry. Every recognized `type` maps to its handler; string
 * types (`text` / `search` / `tel` / `password` / `email` / `url`) share
 * the baseline handler today (Slice 5 layers the `email` / `url`
 * validators on top). Unknown / absent types fall back to `text`
 * (AngularJS parity) at the dispatch site in `input.ts`.
 */
export const inputTypeHandlers: Record<string, InputTypeHandler> = {
  text: textInputType,
  search: textInputType,
  tel: textInputType,
  url: textInputType,
  email: textInputType,
  password: textInputType,
  number: numberInputType,
  range: rangeInputType,
  checkbox: checkboxInputType,
  radio: radioInputType,
  date: dateInputType,
  'datetime-local': dateTimeLocalInputType,
  time: timeInputType,
  month: monthInputType,
  week: weekInputType,
  hidden: noopInputType,
  button: noopInputType,
  submit: noopInputType,
  reset: noopInputType,
};
