/**
 * Public barrel for the `@forms` module — forms & validation (spec 039).
 *
 * The directives themselves are DI-only core `ng` directives registered
 * on `ngModule` via `forms-register.ts` (the `ngTransclude` / event-
 * directive precedent), so the public surface here is the CONTRACT TYPES
 * consumers type against — `NgModelController` and its transform-list
 * types — plus the `registerForms` wiring helper that `ngModule` invokes.
 *
 * Slice 1 exposes the `NgModelController` contract; later slices add
 * `FormController`, `NgModelOptions`, validator maps, etc.
 */

export type { NgModelController, ModelParser, ModelFormatter } from './ng-model-controller';
export { NgModelControllerImpl } from './ng-model-controller';
export { NgModelNonAssignableError } from './ng-model';
export type { FormController, FormControlLike } from './form-controller';
export { FormControllerImpl, nullFormCtrl } from './form-controller';
export type { SelectController } from './select';
export { SelectControllerImpl } from './select';
export { NgOptionsBadExpressionError } from './ng-options-parse';
export type { NgOptionsDescriptor } from './ng-options-parse';
export { registerForms } from './forms-register';
