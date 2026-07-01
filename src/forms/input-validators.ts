/**
 * Type-validator wiring for the `input` type handlers (spec 039 Slice 5 /
 * FS §2.6).
 *
 * Split out of `input-types.ts` so that file stays focused on the
 * parse/format/render pipeline for each type. This module owns the
 * validators that belong to a TYPE rather than a standalone attribute:
 *
 *  - `email` / `url` shape checks (ported AngularJS regexps), and
 *  - the numeric / date `min` / `max` bounds (`number` / `range` / the
 *    date-time family) — each re-validates when its bound changes: the
 *    native `min` / `max` attribute is `$observe`d when present, else the
 *    `ng-min` / `ng-max` EXPRESSION is `$watch`ed (observing a missing
 *    attribute would fire a spurious one-shot `undefined`).
 *
 * The standalone attribute validators (`required` / `ngMinlength` /
 * `ngMaxlength` / `pattern`) live in `validators.ts` as directives.
 */

import type { Scope } from '@core/index';

import type { Attributes } from '@compiler/directive-types';
import { parse } from '@parser/index';

import { parseDateInput, type DateInputKind, type Timezone } from './input-date';
import type { NgModelControllerImpl } from './ng-model-controller';

/**
 * AngularJS's `EMAIL_REGEXP` — the standard email shape check applied by
 * `<input type="email">`. Ported verbatim.
 */
export const EMAIL_REGEXP =
  /^(?=.{1,254}$)(?=.{1,64}@)[-!#$%&'*+/0-9=?A-Z^_`a-z{|}~]+(\.[-!#$%&'*+/0-9=?A-Z^_`a-z{|}~]+)*@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

/**
 * AngularJS's `URL_REGEXP` — the standard URL shape check applied by
 * `<input type="url">`. Ported verbatim.
 */
export const URL_REGEXP =
  /^[a-z][a-z\d.+-]*:\/*(?:[^:@]+(?::[^@]+)?@)?(?:[^\s:/?#]+|\[[a-f\d:]+])(?::\d+)?(?:\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/i;

/**
 * Register the `email` validator on the control — valid when empty
 * (emptiness is `required`'s concern) or the value matches {@link EMAIL_REGEXP}.
 */
export function wireEmailValidator(ctrl: NgModelControllerImpl): void {
  ctrl.$validators['email'] = (modelValue: unknown, viewValue: unknown): boolean => {
    const value = modelValue ?? viewValue;
    return ctrl.$isEmpty(value) || EMAIL_REGEXP.test(String(value));
  };
}

/** Register the `url` validator — valid when empty or matching {@link URL_REGEXP}. */
export function wireUrlValidator(ctrl: NgModelControllerImpl): void {
  ctrl.$validators['url'] = (modelValue: unknown, viewValue: unknown): boolean => {
    const value = modelValue ?? viewValue;
    return ctrl.$isEmpty(value) || URL_REGEXP.test(String(value));
  };
}

/** Evaluate an `ng-min` / `ng-max` expression against the scope. */
function evalAttrExpr(attrs: Attributes, name: string, scope: Scope): unknown {
  const raw = attrs[name];
  if (typeof raw !== 'string') {
    return undefined;
  }
  return parse(raw)(scope as unknown as Record<string, unknown>);
}

/**
 * Parse a `min` / `max` attribute value to a number, or `undefined` when
 * absent / non-numeric (AngularJS's `parseNumberAttrVal`). An `undefined`
 * bound makes the corresponding validator a no-op.
 */
function parseNumberAttrVal(val: unknown): number | undefined {
  if (typeof val === 'number') {
    return Number.isNaN(val) ? undefined : val;
  }
  if (typeof val !== 'string' || val === '') {
    return undefined;
  }
  const num = Number.parseFloat(val);
  return Number.isNaN(num) ? undefined : num;
}

/**
 * Wire the numeric `min` / `max` validators onto a `number` control. Each
 * is present only when its attribute (`min` / `ng-min`, `max` / `ng-max`)
 * exists; both `$observe` their attribute so a data-driven bound
 * re-validates. Empty values and undefined bounds pass.
 */
export function wireNumericMinMax(scope: Scope, attrs: Attributes, ctrl: NgModelControllerImpl): void {
  if (typeof attrs['min'] === 'string' || typeof attrs['ngMin'] === 'string') {
    let parsedMin = parseNumberAttrVal(attrs['min'] ?? evalAttrExpr(attrs, 'ngMin', scope));
    ctrl.$validators['min'] = (_modelValue: unknown, viewValue: unknown): boolean =>
      ctrl.$isEmpty(viewValue) || parsedMin === undefined || Number(viewValue) >= parsedMin;
    wireBoundSource(scope, attrs, 'min', 'ngMin', (val) => {
      parsedMin = parseNumberAttrVal(val);
      ctrl.$validate();
    });
  }

  if (typeof attrs['max'] === 'string' || typeof attrs['ngMax'] === 'string') {
    let parsedMax = parseNumberAttrVal(attrs['max'] ?? evalAttrExpr(attrs, 'ngMax', scope));
    ctrl.$validators['max'] = (_modelValue: unknown, viewValue: unknown): boolean =>
      ctrl.$isEmpty(viewValue) || parsedMax === undefined || Number(viewValue) <= parsedMax;
    wireBoundSource(scope, attrs, 'max', 'ngMax', (val) => {
      parsedMax = parseNumberAttrVal(val);
      ctrl.$validate();
    });
  }
}

/**
 * Wire the re-validation source for a `min` / `max` bound. Observe the
 * native attribute ONLY when present (observing a missing attribute would
 * fire a one-shot `undefined` that wrongly clears the bound); otherwise
 * `$watch` the `ng-min` / `ng-max` expression. `onChange` receives the raw
 * new value (native string or evaluated expression value).
 */
function wireBoundSource(
  scope: Scope,
  attrs: Attributes,
  nativeName: string,
  ngName: string,
  onChange: (val: unknown) => void,
): void {
  if (typeof attrs[nativeName] === 'string') {
    const stopObserve = attrs.$observe(nativeName, (val) => {
      onChange(val);
    });
    scope.$on('$destroy', stopObserve);
    return;
  }
  const ngExpr = attrs[ngName];
  if (typeof ngExpr === 'string') {
    scope.$watch(ngExpr, (val: unknown) => {
      onChange(val);
    });
  }
}

/**
 * Parse an observed `min` / `max` date-attribute value to a `Date` (or
 * `undefined` when absent / unparseable) for the given date-input `kind`.
 */
function parseDateAttrVal(kind: DateInputKind, val: unknown, timezone: Timezone): Date | undefined {
  if (typeof val !== 'string' || val === '') {
    return undefined;
  }
  const parsed = parseDateInput(kind, val, timezone);
  return parsed instanceof Date ? parsed : undefined;
}

/**
 * Wire the `min` / `max` DATE validators onto a date-family control. Each
 * compares the model `Date` against the parsed bound; an empty / non-Date
 * model, or an undefined bound, passes. Both `$observe` their attribute.
 */
export function wireDateMinMax(
  kind: DateInputKind,
  scope: Scope,
  attrs: Attributes,
  ctrl: NgModelControllerImpl,
): void {
  if (typeof attrs['min'] === 'string' || typeof attrs['ngMin'] === 'string') {
    let parsedMin = parseDateAttrVal(kind, attrs['min'] ?? evalAttrExpr(attrs, 'ngMin', scope), ctrl.$$timezone);
    ctrl.$validators['min'] = (modelValue: unknown): boolean =>
      !(modelValue instanceof Date) || parsedMin === undefined || modelValue.getTime() >= parsedMin.getTime();
    wireBoundSource(scope, attrs, 'min', 'ngMin', (val) => {
      parsedMin = parseDateAttrVal(kind, val, ctrl.$$timezone);
      ctrl.$validate();
    });
  }

  if (typeof attrs['max'] === 'string' || typeof attrs['ngMax'] === 'string') {
    let parsedMax = parseDateAttrVal(kind, attrs['max'] ?? evalAttrExpr(attrs, 'ngMax', scope), ctrl.$$timezone);
    ctrl.$validators['max'] = (modelValue: unknown): boolean =>
      !(modelValue instanceof Date) || parsedMax === undefined || modelValue.getTime() <= parsedMax.getTime();
    wireBoundSource(scope, attrs, 'max', 'ngMax', (val) => {
      parsedMax = parseDateAttrVal(kind, val, ctrl.$$timezone);
      ctrl.$validate();
    });
  }
}
