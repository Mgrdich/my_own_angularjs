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
import type { TimeoutService } from '@async/async-types';
import type { Scope } from '@core/index';

import { buildParentWriter } from '@compiler/expression-assign';
import type { Attributes, DirectiveFactory, DirectiveFactoryReturn, LinkFn } from '@compiler/directive-types';
import type { ControllerInvokable } from '@controller/controller-types';
import { invokeExceptionHandler, type ExceptionHandler } from '@exception-handler/index';
import type { ExpressionFn } from '@parser/parse-types';
import { parse } from '@parser/index';

import { FormControllerImpl, nullFormCtrl, type FormController } from './form-controller';
import { publishNamedControlOnForm, unpublishNamedControlOnForm } from './form';
import { resolveTimezone } from './input-date';
import { NgModelControllerImpl } from './ng-model-controller';
import { defaultModelOptions, NG_MODEL_OPTIONS_KEY, type ModelOptions } from './ng-model-options';

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

/**
 * Read the enclosing `ngModelOptions` by walking the element's own
 * `$$ngControllers` stash, then its `parentElement` chain, for a controller
 * published under the `ngModelOptions` key (spec 039 Slice 6).
 *
 * We do NOT resolve this through the `require` tuple: `require` resolution for
 * `ngModel` (a controller-bearing directive) runs during `runControllerSeam`,
 * which — for a SAME-element `ng-model-options` — can execute before the
 * `ngModelOptions` controller is stashed AND before its pre-link re-resolves
 * inheritance. `ngModel`'s LINK runs after every pre-link and after every
 * controller is stashed, so a direct stash walk at link time reliably sees
 * the fully-inherited options for both the same-element and ancestor cases.
 * A miss falls back to {@link defaultModelOptions}.
 */
function readEnclosingOptions(element: Element): ModelOptions {
  let cursor: Element | null = element;
  while (cursor !== null) {
    const map = (cursor as { $$ngControllers?: Map<string, unknown> }).$$ngControllers;
    const candidate = map?.get(NG_MODEL_OPTIONS_KEY);
    if (
      candidate !== undefined &&
      candidate !== null &&
      typeof candidate === 'object' &&
      '$$updateEvents' in candidate
    ) {
      return candidate as ModelOptions;
    }
    cursor = cursor.parentElement;
  }
  return defaultModelOptions;
}

function ngModelFactory($exceptionHandler: ExceptionHandler, $timeout: TimeoutService): DirectiveFactoryReturn {
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

  const link: LinkFn = (scope, element, attrs, controllers) => {
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
      // Clear the named slot only while it still holds THIS control — a
      // newer same-named control (e.g. an `ng-if` remount whose link ran
      // before this teardown) must not be clobbered.
      if (ctrl.$name !== undefined && (form as unknown as Record<string, unknown>)[ctrl.$name] === ctrl) {
        unpublishNamedControlOnForm(form, ctrl.$name);
      }
    });

    // Resolve `ngModelOptions` (spec 039 Slice 6) and thread the seams into
    // the controller BEFORE the model watch / write-back are wired: the
    // `allowInvalid` / `getterSetter` / `timezone` decisions all depend on
    // it, and the debounce timer needs `$timeout`.
    const options = readEnclosingOptions(element);
    ctrl.$options = options;
    ctrl.$$allowInvalid = options.getOption('allowInvalid') === true;
    ctrl.$$timezone = resolveTimezone(options.getOption('timezone'));
    const isGetterSetter = options.getOption('getterSetter') === true;

    // Debounce timer seam (spec 039 Slice 6): route through `$timeout` so a
    // deferred commit runs `$$phase`-guarded inside a digest and refreshes
    // bound content. `invokeApply` defaults to `true`; `$timeout.cancel`
    // clears a pending timer on supersession / `$destroy`.
    ctrl.$$scheduleCommit = (fn, delay) => $timeout(fn, delay);
    ctrl.$$cancelScheduledCommit = (handle) => {
      $timeout.cancel(handle as ReturnType<TimeoutService>);
    };
    scope.$on('$destroy', () => {
      if (ctrl.$$pendingCommitTimer !== undefined) {
        $timeout.cancel(ctrl.$$pendingCommitTimer as ReturnType<TimeoutService>);
        ctrl.$$pendingCommitTimer = undefined;
      }
    });

    const expr = attrs[NG_MODEL_NAME];
    if (typeof expr !== 'string') {
      return;
    }

    const parsed = parse(expr);

    // Model read/write dispatch (spec 039 Slice 6). In `getterSetter` mode the
    // `ng-model` expression is a FUNCTION used both ways — read via `fn()`,
    // write via `fn(value)` — so the expression need NOT be assignable. In
    // the normal mode a `buildParentWriter` assignable writer is required; a
    // non-assignable model routes `NgModelNonAssignableError`.
    let readModel: (s: Scope) => unknown;
    let writeModel: (s: Scope, value: unknown) => void;
    if (isGetterSetter) {
      readModel = (s: Scope) => invokeGetterSetter(parsed, s);
      writeModel = (s: Scope, value: unknown) => {
        invokeGetterSetter(parsed, s, value);
      };
    } else {
      const writer = buildParentWriter(parsed);
      if (writer === undefined) {
        invokeExceptionHandler($exceptionHandler, new NgModelNonAssignableError(expr), '$compile');
        return;
      }
      readModel = (s: Scope) => parsed(s as unknown as Record<string, unknown>);
      writeModel = writer;
    }

    // Install the model write-back hook the controller calls from
    // `$setViewValue`. `scope` is the linked scope the model expression
    // resolves against.
    ctrl.$$writeModelToScope = (value: unknown) => {
      writeModel(scope, value);
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
      () => readModel(scope),
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
          // Re-run validation against the externally-changed model value so
          // a programmatic model change (not just user input) re-evaluates
          // the validators (spec 039 Slice 5). `$$runValidators` bumps the
          // generation id, cancelling any in-flight async pass. INSIDE the
          // render guard (AngularJS `ngModelWatch` parity) — when the
          // formatted value matches what the view already shows, the view's
          // prior parse/validation state stands (re-validating here with
          // `parserValid: undefined` would wrongly clear a live `parse`
          // error while the rejected text is still on screen).
          ctrl.$$runValidators(modelValue, formatted, undefined, () => {
            /* model-side revalidation: validity classes are the only output;
               the scope model is authoritative here, so no write-back. */
          });
        }
      },
    );
  };

  return {
    restrict: 'A',
    // `['ngModel', '?^^form']` — own controller + optional enclosing form
    // (spec 039 Slice 2). `?^^form` walks ancestors only; a form-less control
    // resolves `null` and falls back to `nullFormCtrl`. `ngModelOptions`
    // (spec 039 Slice 6) is NOT resolved via `require` — the link walks the
    // element's `$$ngControllers` stash directly (see `readEnclosingOptions`),
    // because same-element `require` resolution runs too early to see the
    // fully-inherited options.
    require: [NG_MODEL_NAME, '?^^form'],
    controller,
    link,
  };
}

/**
 * Invoke a `getterSetter`-mode `ng-model` function. AngularJS calls the
 * parsed expression as `fn()` to read and `fn(value)` to write — the same
 * function serves both directions. We evaluate the expression to obtain the
 * function reference, then call it with zero args (read) or one arg (write).
 * A non-function result (a misconfigured `getterSetter`) degrades to reading
 * the raw evaluated value / no-op write rather than throwing.
 */
function invokeGetterSetter(parsed: ExpressionFn, scope: Scope, ...writeArgs: unknown[]): unknown {
  const fn = parsed(scope as unknown as Record<string, unknown>);
  if (typeof fn === 'function') {
    return (fn as (...a: unknown[]) => unknown)(...writeArgs);
  }
  // Not a function — read returns the value; a write is a no-op.
  return writeArgs.length === 0 ? fn : undefined;
}

/**
 * DI-annotated `ngModel` factory. Injects `$exceptionHandler` (routing the
 * non-assignable-model error) and `$timeout` (backing the
 * `ngModelOptions.debounce` timer seam — spec 039 Slice 6).
 */
export const ngModelDirective: DirectiveFactory = ['$exceptionHandler', '$timeout', ngModelFactory];

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
