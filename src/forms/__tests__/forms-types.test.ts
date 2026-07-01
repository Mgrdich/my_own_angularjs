/**
 * `@forms` type-level tests (spec 039 Slice 7).
 *
 * Compile-time assertions via `expectTypeOf` — these prove the PUBLIC contract
 * types exported from `@forms/index` compile against representative consumer
 * usage: the shapes a developer reads in an expression (`myForm.email.$invalid`)
 * or types a custom validator / `ngModelOptions` record against.
 *
 * Unlike the async services, the forms DIRECTIVES are registered on `ngModule`
 * via a config block (the `ngTransclude` / event-directive precedent), so they
 * are NOT statically widened into the injector's `ModuleRegistry` — there is no
 * `injector.get('ngModel')` service surface to assert. What IS public is the
 * CONTRACT: `NgModelController`, `FormController`, `NgModelOptions` /
 * `ModelOptions`, `SelectController`, and the `SyncValidator` / `AsyncValidator`
 * / `ModelParser` / `ModelFormatter` transform types. Consumers type against
 * these; this file pins that they mean what the implementation exposes.
 *
 * Every assertion mirrors what the barrel ACTUALLY exports today — where a
 * signature is looser than ideal (e.g. `$viewValue: unknown`) it is asserted
 * as-real with an inline note, never as an aspirational type.
 */

import { describe, expectTypeOf, it } from 'vitest';

import type { QPromise } from '@async/q-types';
import {
  createModelOptions,
  defaultModelOptions,
  FormControllerImpl,
  NgModelControllerImpl,
  nullFormCtrl,
  resolveDebounceDelay,
  SelectControllerImpl,
  type AsyncValidator,
  type FormControlLike,
  type FormController,
  type ModelFormatter,
  type ModelOptions,
  type ModelParser,
  type NgModelController,
  type NgModelOptions,
  type SelectController,
  type SyncValidator,
} from '@forms/index';

describe('NgModelController — the value pipeline + state contract', () => {
  it('exposes the two ordered transform lists as arrays of the transform types', () => {
    expectTypeOf<NgModelController['$parsers']>().toEqualTypeOf<ModelParser[]>();
    expectTypeOf<NgModelController['$formatters']>().toEqualTypeOf<ModelFormatter[]>();
  });

  it('the transform types are single-arg unknown → unknown functions', () => {
    expectTypeOf<ModelParser>().toEqualTypeOf<(value: unknown) => unknown>();
    expectTypeOf<ModelFormatter>().toEqualTypeOf<(value: unknown) => unknown>();
  });

  it('the validator maps are keyed records of the sync / async validator types', () => {
    expectTypeOf<NgModelController['$validators']>().toEqualTypeOf<Record<string, SyncValidator>>();
    expectTypeOf<NgModelController['$asyncValidators']>().toEqualTypeOf<Record<string, AsyncValidator>>();
  });

  it('a sync validator is (modelValue, viewValue) => boolean; async returns a QPromise', () => {
    const sync: SyncValidator = (modelValue, viewValue) => {
      expectTypeOf(modelValue).toEqualTypeOf<unknown>();
      expectTypeOf(viewValue).toEqualTypeOf<unknown>();
      return typeof modelValue === 'string';
    };
    expectTypeOf(sync).returns.toEqualTypeOf<boolean>();

    // A consumer's async rule resolves for valid, rejects for invalid.
    const asyncRule: AsyncValidator = () => null as unknown as QPromise<unknown>;
    expectTypeOf(asyncRule).returns.toEqualTypeOf<QPromise<unknown>>();
  });

  it('$viewValue / $modelValue are unknown (untyped model — as-real)', () => {
    expectTypeOf<NgModelController['$viewValue']>().toEqualTypeOf<unknown>();
    expectTypeOf<NgModelController['$modelValue']>().toEqualTypeOf<unknown>();
  });

  it('the state booleans and the $name / $error / $pending shapes', () => {
    expectTypeOf<NgModelController['$dirty']>().toEqualTypeOf<boolean>();
    expectTypeOf<NgModelController['$pristine']>().toEqualTypeOf<boolean>();
    expectTypeOf<NgModelController['$touched']>().toEqualTypeOf<boolean>();
    expectTypeOf<NgModelController['$untouched']>().toEqualTypeOf<boolean>();
    expectTypeOf<NgModelController['$valid']>().toEqualTypeOf<boolean>();
    expectTypeOf<NgModelController['$invalid']>().toEqualTypeOf<boolean>();
    expectTypeOf<NgModelController['$name']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<NgModelController['$error']>().toEqualTypeOf<Record<string, boolean>>();
    expectTypeOf<NgModelController['$pending']>().toEqualTypeOf<Record<string, boolean> | undefined>();
  });

  it('the pipeline method signatures a consumer / input-type handler calls', () => {
    expectTypeOf<NgModelController['$setViewValue']>().toEqualTypeOf<(value: unknown, trigger?: string) => void>();
    expectTypeOf<NgModelController['$render']>().toEqualTypeOf<() => void>();
    expectTypeOf<NgModelController['$isEmpty']>().toEqualTypeOf<(value: unknown) => boolean>();
    expectTypeOf<NgModelController['$commitViewValue']>().toEqualTypeOf<() => void>();
    expectTypeOf<NgModelController['$rollbackViewValue']>().toEqualTypeOf<() => void>();
    expectTypeOf<NgModelController['$validate']>().toEqualTypeOf<() => void>();
  });

  it('$setValidity is tri-state (boolean | undefined for pending)', () => {
    expectTypeOf<NgModelController['$setValidity']>().toEqualTypeOf<
      (key: string, isValid: boolean | undefined) => void
    >();
  });

  it('the state-transition methods are all () => void', () => {
    expectTypeOf<NgModelController['$setPristine']>().toEqualTypeOf<() => void>();
    expectTypeOf<NgModelController['$setDirty']>().toEqualTypeOf<() => void>();
    expectTypeOf<NgModelController['$setTouched']>().toEqualTypeOf<() => void>();
    expectTypeOf<NgModelController['$setUntouched']>().toEqualTypeOf<() => void>();
  });

  it('$options is a ModelOptions and $viewChangeListeners is a () => void[]', () => {
    expectTypeOf<NgModelController['$options']>().toEqualTypeOf<ModelOptions>();
    expectTypeOf<NgModelController['$viewChangeListeners']>().toEqualTypeOf<(() => void)[]>();
  });

  it('the concrete NgModelControllerImpl satisfies the NgModelController contract', () => {
    expectTypeOf<NgModelControllerImpl>().toExtend<NgModelController>();
  });
});

describe('FormController — the aggregation contract', () => {
  it('exposes the aggregate state booleans + $submitted', () => {
    expectTypeOf<FormController['$dirty']>().toEqualTypeOf<boolean>();
    expectTypeOf<FormController['$pristine']>().toEqualTypeOf<boolean>();
    expectTypeOf<FormController['$valid']>().toEqualTypeOf<boolean>();
    expectTypeOf<FormController['$invalid']>().toEqualTypeOf<boolean>();
    expectTypeOf<FormController['$submitted']>().toEqualTypeOf<boolean>();
    expectTypeOf<FormController['$name']>().toEqualTypeOf<string | undefined>();
  });

  it('$error / $pending map keys to arrays of controls (not booleans — the form aggregates)', () => {
    expectTypeOf<FormController['$error']>().toEqualTypeOf<Record<string, FormControlLike[]>>();
    expectTypeOf<FormController['$pending']>().toEqualTypeOf<Record<string, FormControlLike[]> | undefined>();
  });

  it('$addControl / $removeControl / $setValidity accept a FormControlLike', () => {
    expectTypeOf<FormController['$addControl']>().toEqualTypeOf<(control: FormControlLike) => void>();
    expectTypeOf<FormController['$removeControl']>().toEqualTypeOf<(control: FormControlLike) => void>();
    // The form's $setValidity is the THREE-arg control-aggregating shape (NOT
    // the control's two-arg tri-state), and its isValid is plain boolean.
    expectTypeOf<FormController['$setValidity']>().toEqualTypeOf<
      (key: string, isValid: boolean, control: FormControlLike) => void
    >();
  });

  it('the state-transition methods are () => void', () => {
    expectTypeOf<FormController['$setDirty']>().toEqualTypeOf<() => void>();
    expectTypeOf<FormController['$setPristine']>().toEqualTypeOf<() => void>();
    expectTypeOf<FormController['$setSubmitted']>().toEqualTypeOf<() => void>();
  });

  it('an NgModelController is assignable where a FormControlLike is expected (only $name is read)', () => {
    // A form tracks controls through the narrow FormControlLike surface, so
    // registering an NgModelController with a form type-checks.
    expectTypeOf<NgModelController>().toExtend<FormControlLike>();
  });

  it('the concrete FormControllerImpl + nullFormCtrl satisfy the FormController contract', () => {
    expectTypeOf<FormControllerImpl>().toExtend<FormController>();
    expectTypeOf(nullFormCtrl).toExtend<FormController>();
  });

  it('a nested FormController is itself a FormControlLike (nested forms bubble up)', () => {
    expectTypeOf<FormController>().toExtend<FormControlLike>();
  });
});

describe('NgModelOptions / ModelOptions — the ngModelOptions contract', () => {
  it('every option key is optional and correctly typed', () => {
    expectTypeOf<NgModelOptions['updateOn']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<NgModelOptions['debounce']>().toEqualTypeOf<number | Record<string, number> | undefined>();
    expectTypeOf<NgModelOptions['allowInvalid']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<NgModelOptions['getterSetter']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<NgModelOptions['timezone']>().toEqualTypeOf<string | undefined>();
  });

  it('a consumer can author a full NgModelOptions record', () => {
    const opts: NgModelOptions = {
      updateOn: 'blur',
      debounce: { default: 300, blur: 0 },
      allowInvalid: true,
      getterSetter: false,
      timezone: 'UTC',
    };
    expectTypeOf(opts).toExtend<NgModelOptions>();
  });

  it('getOption is generic — it returns the exact per-key value type', () => {
    const options: ModelOptions = defaultModelOptions;
    expectTypeOf(options.getOption('updateOn')).toEqualTypeOf<string | undefined>();
    expectTypeOf(options.getOption('debounce')).toEqualTypeOf<number | Record<string, number> | undefined>();
    expectTypeOf(options.getOption('allowInvalid')).toEqualTypeOf<boolean | undefined>();
    expectTypeOf(options.getOption('timezone')).toEqualTypeOf<string | undefined>();
  });

  it('$$updateEvents is a readonly string list and $$hasDefaultUpdateEvent a boolean', () => {
    expectTypeOf<ModelOptions['$$updateEvents']>().toEqualTypeOf<readonly string[]>();
    expectTypeOf<ModelOptions['$$hasDefaultUpdateEvent']>().toEqualTypeOf<boolean>();
  });

  it('createModelOptions produces a ModelOptions; resolveDebounceDelay returns a number', () => {
    expectTypeOf(createModelOptions({ debounce: 200 })).toEqualTypeOf<ModelOptions>();
    expectTypeOf(resolveDebounceDelay(defaultModelOptions, 'blur')).toEqualTypeOf<number>();
  });
});

describe('SelectController — the option-management contract', () => {
  it('multiple is a readonly boolean and the register / read / write surface is typed', () => {
    expectTypeOf<SelectController['multiple']>().toEqualTypeOf<boolean>();
    expectTypeOf<SelectController['registerOption']>().toEqualTypeOf<
      (key: string, value: unknown, element: HTMLOptionElement) => void
    >();
    expectTypeOf<SelectController['removeOption']>().toEqualTypeOf<(key: string) => void>();
    expectTypeOf<SelectController['readValue']>().toEqualTypeOf<() => unknown>();
    expectTypeOf<SelectController['writeValue']>().toEqualTypeOf<(value: unknown) => void>();
    expectTypeOf<SelectController['writeMultiValue']>().toEqualTypeOf<(values: readonly unknown[]) => void>();
  });

  it('the concrete SelectControllerImpl satisfies the SelectController contract', () => {
    expectTypeOf<SelectControllerImpl>().toExtend<SelectController>();
  });
});
