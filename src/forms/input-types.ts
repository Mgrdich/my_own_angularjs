/**
 * Input-type handler registry (spec 039 Slice 1 / FS §2.4,
 * technical-considerations §2.4).
 *
 * One `input` directive dispatches on `attrs.type` into the handlers
 * registered here (AngularJS parity — NOT one directive per type).
 * Slice 1 ships the baseline `text` handler; Slice 3 fills in
 * number/range/checkbox/radio/date/etc., and Slice 5 wires the
 * `email`/`number`/`url` type validators through these handlers.
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
 * The Slice-1 type registry. Every recognized `type` maps to the
 * baseline string handler today; later slices register the typed
 * handlers. Unknown / absent types fall back to `text` (AngularJS
 * parity) at the dispatch site in `input.ts`.
 */
export const inputTypeHandlers: Record<string, InputTypeHandler> = {
  text: textInputType,
  search: textInputType,
  tel: textInputType,
  url: textInputType,
  email: textInputType,
  password: textInputType,
};
