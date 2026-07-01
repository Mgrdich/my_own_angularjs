/**
 * Forms directive registration (spec 039 Slice 1 /
 * technical-considerations §2.8).
 *
 * Like every other built-in directive batch, the forms directives are
 * core `ng` directives — registered on `ngModule` via a
 * `.config(['$compileProvider', …])` block (DI-only). An app reaching
 * `'ng'` in its deps chain gets `ngModel` / `input` / `textarea` /
 * `ngChange` for free; the directive factories themselves stay file-local
 * (not exported from `@compiler/index` or the root barrel), matching the
 * `ngTransclude` / event-directive precedent.
 *
 * This module exposes a single {@link registerForms} helper that takes the
 * `$compileProvider` and registers the four directives. `ngModule`
 * (`src/core/ng-module.ts`) imports + invokes it from its config block.
 */

import type { $CompileProvider } from '@compiler/compile-provider';

import { formDirective, ngFormDirective, FORM_NAME, NG_FORM_NAME } from './form';
import { inputDirective, textareaDirective } from './input';
import { ngChangeDirective, ngModelDirective, NG_CHANGE_NAME, NG_MODEL_NAME } from './ng-model';
import { ngModelOptionsDirective, NG_MODEL_OPTIONS_NAME } from './ng-model-options';
import { ngListDirective, NG_LIST_NAME } from './ng-list';
import { ngOptionsDirective, NG_OPTIONS_NAME } from './ng-options';
import { optionDirective, selectDirective, OPTION_NAME, SELECT_NAME } from './select';
import {
  maxlengthDirective,
  minlengthDirective,
  ngPatternDirective,
  ngRequiredDirective,
  patternDirective,
  requiredDirective,
  NG_MAXLENGTH_NAME,
  NG_MINLENGTH_NAME,
  NG_PATTERN_NAME,
  NG_REQUIRED_NAME,
  PATTERN_NAME,
  REQUIRED_NAME,
} from './validators';

/**
 * Register the Slice-1 forms directives on a `$compileProvider`.
 *
 * - `ngModel` — two-way binding + the published {@link NgModelController}.
 * - `input` — single directive dispatching on `type` (default → text).
 * - `textarea` — delegates to the `text` handler.
 * - `ngChange` — fires on committed view change.
 */
export function registerForms($compileProvider: $CompileProvider): void {
  $compileProvider.directive(NG_MODEL_NAME, ngModelDirective);
  $compileProvider.directive('input', inputDirective);
  $compileProvider.directive('textarea', textareaDirective);
  $compileProvider.directive(NG_CHANGE_NAME, ngChangeDirective);
  // Slice 2 — form aggregation. Both `form` and `ngForm` publish a
  // `FormController`; `ngModel` / nested forms resolve the enclosing form
  // via `require: '?^^form'`.
  $compileProvider.directive(FORM_NAME, formDirective);
  $compileProvider.directive(NG_FORM_NAME, ngFormDirective);
  // Slice 4 — select / ngOptions / ngList. `select` publishes a
  // `SelectController` (under `'select'`); `option` self-registers plain
  // markup options; `ngOptions` generates options from a collection;
  // `ngList` adds a delimited-string ↔ array transform to `ngModel`.
  $compileProvider.directive(SELECT_NAME, selectDirective);
  $compileProvider.directive(OPTION_NAME, optionDirective);
  $compileProvider.directive(NG_OPTIONS_NAME, ngOptionsDirective);
  $compileProvider.directive(NG_LIST_NAME, ngListDirective);
  // Slice 5 — built-in validator directives. Each `require: '?ngModel'`
  // and pushes a rule onto the control's `$validators` map under a fixed
  // key (`required` / `minlength` / `maxlength` / `pattern`), so a failure
  // surfaces `ng-invalid-<key>` and bubbles to the enclosing form. The
  // `email` / `number` / `url` and `min` / `max` type validators are wired
  // by the corresponding `inputType` handler, NOT here (AngularJS parity).
  $compileProvider.directive(REQUIRED_NAME, requiredDirective);
  $compileProvider.directive(NG_REQUIRED_NAME, ngRequiredDirective);
  $compileProvider.directive(NG_MINLENGTH_NAME, minlengthDirective);
  $compileProvider.directive(NG_MAXLENGTH_NAME, maxlengthDirective);
  $compileProvider.directive(PATTERN_NAME, patternDirective);
  $compileProvider.directive(NG_PATTERN_NAME, ngPatternDirective);
  // Slice 6 — `ngModelOptions`. Publishes a resolved `ModelOptions`
  // (inheriting from an ancestor `ngModelOptions`) that a descendant
  // `ngModel` reads via `require: '?^^ngModelOptions'` to drive `updateOn` /
  // `debounce` / `allowInvalid` / `getterSetter` / `timezone`.
  $compileProvider.directive(NG_MODEL_OPTIONS_NAME, ngModelOptionsDirective);
}
