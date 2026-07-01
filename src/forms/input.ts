/**
 * `input` + `textarea` directives (spec 039 Slice 1 / FS §2.4,
 * technical-considerations §2.4).
 *
 * A SINGLE `input` directive (`restrict: 'E'`, `require: '?ngModel'`)
 * matches every `<input>` and dispatches on `attrs.type` into the
 * internal {@link inputTypeHandlers} registry (AngularJS parity — not one
 * directive per type). When the element carries no `ng-model` the link is
 * a no-op (the optional `?ngModel` require yields `null`), so a plain
 * `<input>` without a model is untouched.
 *
 * `textarea` is a thin directive delegating to the `text` handler — a
 * `<textarea ng-model>` binds a string exactly like a text input.
 *
 * Unknown / absent `type` values fall back to the `text` handler
 * (AngularJS parity — `<input type="quux">` and `<input>` both behave as
 * text). Types with no model parsing (`hidden` / `button` / `submit` /
 * `reset`) are deferred to Slice 3; in Slice 1 they fall back to text,
 * which is harmless for a model-less control.
 */

import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from '@compiler/directive-types';
import type { ExceptionHandler } from '@exception-handler/index';

import { inputTypeHandlers, textInputType, type InputTypeContext } from './input-types';
import { NgModelControllerImpl } from './ng-model-controller';

function asNgModelController(controllers: unknown): NgModelControllerImpl | null {
  return controllers instanceof NgModelControllerImpl ? controllers : null;
}

/**
 * Build the link fn shared by `input` and `textarea`. `forceTextHandler`
 * forces the `text` handler regardless of `attrs.type` (used by
 * `textarea`).
 */
function buildInputLink($exceptionHandler: ExceptionHandler, forceTextHandler: boolean): LinkFn {
  return (scope, element, attrs, controllers) => {
    const ctrl = asNgModelController(controllers);
    if (ctrl === null) {
      // No ng-model on this control — nothing to wire.
      return;
    }

    // `element` is an Element on the public LinkFn surface; an `input` /
    // `textarea` directive only matches those tags, so the runtime value
    // is always an HTMLInputElement / HTMLTextAreaElement. The cast
    // narrows to the `.value` surface the handlers consume.
    const control = element as HTMLInputElement | HTMLTextAreaElement;

    const typeAttr = attrs['type'];
    const type = !forceTextHandler && typeof typeAttr === 'string' ? typeAttr.toLowerCase() : 'text';
    const handler = forceTextHandler ? textInputType : (inputTypeHandlers[type] ?? textInputType);

    const ctx: InputTypeContext = {
      scope,
      element: control,
      attrs,
      ctrl,
      exceptionHandler: $exceptionHandler,
    };
    handler(ctx);
  };
}

function inputFactory($exceptionHandler: ExceptionHandler): DirectiveFactoryReturn {
  return {
    restrict: 'E',
    require: '?ngModel',
    link: buildInputLink($exceptionHandler, false),
  };
}

/**
 * DI-annotated `input` directive. Injects `$exceptionHandler` so the
 * input-type handlers can route native-listener throws through it.
 */
export const inputDirective: DirectiveFactory = ['$exceptionHandler', inputFactory];

function textareaFactory($exceptionHandler: ExceptionHandler): DirectiveFactoryReturn {
  return {
    restrict: 'E',
    require: '?ngModel',
    link: buildInputLink($exceptionHandler, true),
  };
}

/**
 * DI-annotated `textarea` directive — delegates to the `text` handler.
 */
export const textareaDirective: DirectiveFactory = ['$exceptionHandler', textareaFactory];
