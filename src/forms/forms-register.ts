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
import { ngListDirective, NG_LIST_NAME } from './ng-list';
import { ngOptionsDirective, NG_OPTIONS_NAME } from './ng-options';
import { optionDirective, selectDirective, OPTION_NAME, SELECT_NAME } from './select';

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
}
