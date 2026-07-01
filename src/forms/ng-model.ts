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

import type { Scope } from '@core/index';

import { buildParentWriter } from '@compiler/expression-assign';
import type { Attributes, DirectiveFactory, DirectiveFactoryReturn, LinkFn } from '@compiler/directive-types';
import type { ControllerInvokable } from '@controller/controller-types';
import { invokeExceptionHandler, type ExceptionHandler } from '@exception-handler/index';
import { parse } from '@parser/index';

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
 * Type-narrowing view of the controller seam's 4th link argument. For
 * `require: 'ngModel'` (string form) the resolved value is the single
 * controller instance (or `null` for an optional miss). We only treat it
 * as our controller when it is a live {@link NgModelControllerImpl}.
 */
function asNgModelController(controllers: unknown): NgModelControllerImpl | null {
  return controllers instanceof NgModelControllerImpl ? controllers : null;
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
    (...args: unknown[]): NgModelControllerImpl =>
      new NgModelControllerImpl(args[0] as Scope, args[1] as Element, args[2] as Attributes),
  ];

  const link: LinkFn = (scope, _element, attrs, controllers) => {
    const ctrl = asNgModelController(controllers);
    if (ctrl === null) {
      return;
    }

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
    scope.$watch(
      () => parsed(scope as unknown as Record<string, unknown>),
      (modelValue: unknown) => {
        let formatted: unknown = modelValue;
        for (let i = ctrl.$formatters.length - 1; i >= 0; i--) {
          const formatter = ctrl.$formatters[i];
          if (formatter !== undefined) {
            formatted = formatter(formatted);
          }
        }
        ctrl.$modelValue = modelValue;
        if (ctrl.$$lastCommittedViewValue !== formatted) {
          ctrl.$viewValue = formatted;
          ctrl.$$lastCommittedViewValue = formatted;
          ctrl.$render();
          ctrl.$isEmptyClassUpdate(formatted);
        }
      },
    );
  };

  return {
    restrict: 'A',
    require: NG_MODEL_NAME,
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
