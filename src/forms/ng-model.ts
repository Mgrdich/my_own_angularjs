/**
 * `ngModel` + `ngChange` directives (spec 039 Slice 1 / FS §2.1, §2.5,
 * technical-considerations §2.2).
 *
 * **`ngModel`** is the two-way binding directive. It:
 *
 *  1. Declares a `controller` ({@link NgModelControllerImpl}) so the
 *     compiler's per-element seam instantiates it with element-locals
 *     `{ $scope, $element, $attrs }` and stashes it on `$$ngControllers`
 *     under the name `ngModel` — which is exactly what
 *     `require: 'ngModel'` / `require: '?ngModel'` reads.
 *  2. Declares `require: 'ngModel'` so its OWN link fn receives the
 *     controller as the 4th argument.
 *  3. Parses the model expression and builds a parent-side write-back via
 *     {@link buildParentWriter} (`@compiler/expression-assign` — the same
 *     machinery the `=` isolate binding uses, so dotted paths
 *     auto-create their intermediates). A non-assignable model
 *     (`ng-model="a + b"`, `ng-model="fn()"`) routes
 *     {@link NgModelNonAssignableError} via `$exceptionHandler('$compile')`.
 *  4. Installs `scope.$watch(modelExpr, …)` — on a model change it runs
 *     the `$formatters` (reverse), sets `$viewValue`, and calls
 *     `$render()`. The **model→view feedback guard** compares the new
 *     formatted value against `$$lastCommittedViewValue` so `$render`
 *     fires only when the model genuinely diverges from what the view
 *     already shows (AngularJS parity — prevents the watch from clobbering
 *     a live keystroke).
 *
 * The actual `$render` writer + native DOM event listeners are installed
 * by the input-type handler (`input.ts` → `input-types.ts`), NOT by
 * `ngModel` itself — `ngModel` only owns the model side of the pipeline.
 *
 * **`ngChange`** registers its expression into the controller's
 * `$viewChangeListeners`, so it fires ONLY on a committed view change
 * (user input), never on a programmatic model change — the FS §2.5
 * distinction.
 */

import type { QService } from '@async/q-types';
import type { Scope } from '@core/index';

import { buildParentWriter } from '@compiler/expression-assign';
import type { Attributes, DirectiveFactory, DirectiveFactoryReturn, LinkFn } from '@compiler/directive-types';
import type { ControllerInvokable } from '@controller/controller-types';
import { invokeExceptionHandler, type ExceptionHandler } from '@exception-handler/index';
import { parse } from '@parser/index';

import { FormControllerImpl, nullFormCtrl, type FormController } from './form-controller';
import { publishNamedControlOnForm, unpublishNamedControlOnForm } from './form';
import { NgModelControllerImpl } from './ng-model-controller';

export const NG_MODEL_NAME = 'ngModel';
export const NG_CHANGE_NAME = 'ngChange';

/**
 * Thrown when an `ng-model` expression is not assignable (e.g. a literal,
 * a binary expression, or a function call). Routed via
 * `$exceptionHandler('$compile')` — the directive then goes inert rather
 * than silently writing nowhere. Mirrors AngularJS's `ngModel:nonassign`.
 */
export class NgModelNonAssignableError extends Error {
  constructor(expression: string) {
    super(`Expression '${expression}' is non-assignable. Element used with ng-model.`);
    this.name = 'NgModelNonAssignableError';
  }
}

/**
 * Type-narrowing view of the controller seam's 4th link argument. The
 * `ngModel` directive declares `require: ['ngModel', '?^^form']`, so the
 * resolved value is a 2-tuple `[ngModelController, formControllerOrNull]`.
 * `ngChange` still declares the string form (`require: 'ngModel'`), so it
 * receives the single controller — both shapes are handled here.
 */
/** Whether a value is the numeric `NaN` (the fresh-control model sentinel). */
function isNanValue(value: unknown): boolean {
  return typeof value === 'number' && Number.isNaN(value);
}

function asNgModelController(controllers: unknown): NgModelControllerImpl | null {
  if (controllers instanceof NgModelControllerImpl) {
    return controllers;
  }
  if (Array.isArray(controllers) && controllers[0] instanceof NgModelControllerImpl) {
    return controllers[0];
  }
  return null;
}

/**
 * Read the enclosing form from the `ngModel` require tuple's 2nd slot.
 * `require: '?^^form'` yields `null` when there is no ancestor form; a
 * non-form value falls back to {@link nullFormCtrl} so registration is a
 * safe no-op for a form-less control.
 */
function readEnclosingForm(controllers: unknown): FormController {
  if (Array.isArray(controllers) && controllers[1] instanceof FormControllerImpl) {
    return controllers[1];
  }
  return nullFormCtrl;
}

function ngModelFactory($exceptionHandler: ExceptionHandler): DirectiveFactoryReturn {
  // The controller is array-annotated so `injector.invoke` / `$controller`
  // can resolve the element-locals by name (`$scope` / `$element` /
  // `$attrs`); a bare class would be rejected by the strict `annotate`
  // helper. The trailing factory returns a fresh controller per element.
  const controller: ControllerInvokable = [
    '$scope',
    '$element',
    '$attrs',
    '$q',
    (...args: unknown[]): NgModelControllerImpl =>
      new NgModelControllerImpl(args[0] as Scope, args[1] as Element, args[2] as Attributes, args[3] as QService),
  ];

  const link: LinkFn = (scope, _element, attrs, controllers) => {
    const ctrl = asNgModelController(controllers);
    if (ctrl === null) {
      return;
    }

    // Register with the enclosing form (spec 039 Slice 2). Re-point the
    // control's `$$parentForm` so its `$setValidity` / `$setDirty` bubble
    // up, and seed the form's aggregate with this control's current
    // validity (it starts valid, so this is a no-op failure-wise but
    // records the control in the form's control list). A named control
    // additionally publishes onto the FORM INSTANCE so
    // `myForm.email.$invalid` reads in expressions.
    const form = readEnclosingForm(controllers);
    ctrl.$$parentForm = form;
    form.$addControl(ctrl);
    if (ctrl.$name !== undefined) {
      publishNamedControlOnForm(form, ctrl.$name, ctrl);
    }
    scope.$on('$destroy', () => {
      form.$removeControl(ctrl);
      if (ctrl.$name !== undefined) {
        unpublishNamedControlOnForm(form, ctrl.$name);
      }
    });

    const expr = attrs[NG_MODEL_NAME];
    if (typeof expr !== 'string') {
      return;
    }

    const parsed = parse(expr);
    const writer = buildParentWriter(parsed);
    if (writer === undefined) {
      invokeExceptionHandler($exceptionHandler, new NgModelNonAssignableError(expr), '$compile');
      return;
    }

    // Install the model write-back hook the controller calls from
    // `$setViewValue`. `scope` is the linked scope the model expression
    // resolves against.
    ctrl.$$writeModelToScope = (value: unknown) => {
      writer(scope, value);
    };

    // Model → view watch. On a model change, run the formatters in
    // REVERSE, then — only when the formatted value diverges from what the
    // view already shows ($$lastCommittedViewValue) — set $viewValue and
    // re-render. The divergence guard is the AngularJS feedback-loop fix.
    // The model watch runs the model → view pipeline (formatters → render)
    // + validation ONLY when the scope model diverges from the controller's
    // cached `$modelValue` (AngularJS's `ngModelWatch` guard). When a change
    // originated from `$setViewValue`, `$modelValue` was already updated to
    // match, so the guard fails and validation is NOT re-run — that is what
    // keeps async validators from firing twice per user keystroke. The
    // guard's NaN clause (`a === a || b === b`) lets the fresh-control NaN
    // sentinel transition to a real value on the first digest.
    scope.$watch(
      () => parsed(scope as unknown as Record<string, unknown>),
      (modelValue: unknown) => {
        const cached = ctrl.$modelValue;
        // AngularJS's `ngModelWatch` guard: run the pipeline only when the
        // scope model diverges from the cached `$modelValue`. The NaN clause
        // (`!(both are NaN)`) lets the fresh-control NaN sentinel transition
        // to a real value on the first digest, while treating NaN === NaN as
        // "no change" so two NaN sentinels don't re-run.
        const bothNaN = isNanValue(modelValue) && isNanValue(cached);
        if (modelValue === cached || bothNaN) {
          return;
        }

        let formatted: unknown = modelValue;
        for (let i = ctrl.$formatters.length - 1; i >= 0; i--) {
          const formatter = ctrl.$formatters[i];
          if (formatter !== undefined) {
            formatted = formatter(formatted);
          }
        }
        ctrl.$modelValue = modelValue;
        ctrl.$$rawModelValue = modelValue;
        ctrl.$$parserValid = undefined;
        if (ctrl.$$lastCommittedViewValue !== formatted) {
          ctrl.$viewValue = formatted;
          ctrl.$$lastCommittedViewValue = formatted;
          ctrl.$render();
          ctrl.$isEmptyClassUpdate(formatted);
        }
        // Re-run validation against the externally-changed model value so a
        // programmatic model change (not just user input) re-evaluates the
        // validators (spec 039 Slice 5). `$$runValidators` bumps the
        // generation id, cancelling any in-flight async pass.
        ctrl.$$runValidators(modelValue, ctrl.$$lastCommittedViewValue, undefined, () => {
          /* model-side revalidation: validity classes are the only output;
             the scope model is authoritative here, so no write-back. */
        });
      },
    );
  };

  return {
    restrict: 'A',
    // `['ngModel', '?^^form']` — own controller + optional enclosing form
    // (spec 039 Slice 2). `?^^form` walks ancestors only for the shared
    // `'form'` controller key both `form` / `ngForm` publish under; a
    // form-less control resolves `null` and falls back to `nullFormCtrl`.
    require: [NG_MODEL_NAME, '?^^form'],
    controller,
    link,
  };
}

/**
 * DI-annotated `ngModel` factory. Injects `$exceptionHandler` so the
 * non-assignable-model error can route through it.
 */
export const ngModelDirective: DirectiveFactory = ['$exceptionHandler', ngModelFactory];

function ngChangeFactory(): DirectiveFactoryReturn {
  const link: LinkFn = (scope, _element, attrs, controllers) => {
    const ctrl = asNgModelController(controllers);
    if (ctrl === null) {
      return;
    }
    const expr = attrs[NG_CHANGE_NAME];
    if (typeof expr !== 'string') {
      return;
    }
    const parsed = parse(expr);
    ctrl.$viewChangeListeners.push(() => {
      parsed(scope as unknown as Record<string, unknown>);
    });
  };

  return {
    restrict: 'A',
    require: NG_MODEL_NAME,
    link,
  };
}

/**
 * DI-annotated `ngChange` factory. Requires `ngModel` so it can register
 * its expression into the controller's `$viewChangeListeners`.
 */
export const ngChangeDirective: DirectiveFactory = [ngChangeFactory];
