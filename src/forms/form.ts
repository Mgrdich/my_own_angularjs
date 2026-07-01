/**
 * `form` + `ngForm` directives (spec 039 Slice 2 / FS §2.3,
 * technical-considerations §2.6).
 *
 * ONE shared factory registers under BOTH the `form` (element) and
 * `ngForm` (element + attribute) names — a `<form>` and an `<ng-form>` /
 * `<div ng-form>` behave identically. Each match publishes a
 * {@link FormControllerImpl} that aggregates the validity + dirty +
 * submitted state of every `ngModel` control and nested sub-form beneath
 * it.
 *
 * **Controller publish under the `'form'` key.** The compiler's
 * per-element controller seam stashes a directive's controller under its
 * OWN directive name (`form` for `<form>`, `ngForm` for `<ng-form>`).
 * `ngModel` and nested forms resolve the enclosing form via the single
 * `require: '?^^form'` key, so this directive additionally stashes its
 * controller under `'form'` (via {@link stashController}) in its PRE-link
 * — before any descendant control links and runs its own `require`
 * resolution. Publishing in pre-link (not post-link) is load-bearing:
 * the parent's pre-link runs before its children are linked, so a child
 * `ngModel`'s `require: '?^^form'` ancestor walk finds the form.
 *
 * **Parent-form wiring.** The directive declares
 * `require: ['<ownName>', '?^^form']`, so its link receives
 * `[ownController, parentFormOrNull]`. It re-points the controller's
 * `$$parentForm` to the resolved parent (or {@link nullFormCtrl}) and
 * registers itself with the parent via `$addControl` — so a nested
 * `ng-form`'s validity / dirty / submitted state bubbles up. On
 * `$destroy` it deregisters (`parent.$removeControl(this)`), dropping the
 * sub-form's contribution when it is removed from the page (e.g. by
 * `ng-if`).
 *
 * **Named form + named controls.** A named form (`<form name="myForm">`
 * / `<ng-form ng-form="myForm">`) publishes its controller onto the
 * surrounding scope via {@link buildParentWriter} — the same assignable
 * writer `ngModel` / `ngRef` use — so `myForm.$invalid` reads in
 * expressions. Named CONTROLS publish onto the FORM INSTANCE (not the
 * scope) so `myForm.email.$invalid` resolves through the published form:
 * a control registering with the form makes the form assign the control
 * under its `$name`. This directive owns the form-side publish;
 * `ngModel`'s form registration (in `ng-model.ts`) triggers it.
 *
 * **Submit handling.** A native `submit` listener calls `$setSubmitted()`
 * inside a `$$phase`-guarded `$apply` / `$evalAsync` (the event-directive
 * pattern). The `ngSubmit` EXPRESSION is NOT evaluated here — the
 * standalone `ngSubmit` event directive (spec 026) already binds a
 * `submit` listener and runs it; this directive owns only the
 * `$setSubmitted` state transition and the native-submit suppression, so
 * a `<form ng-submit="…">` runs its handler exactly once. When the form
 * has no `action` attribute the listener `preventDefault()`s the native
 * submit (AngularJS parity — a form without an action should not
 * navigate). A form WITH an `action` still navigates unless a handler
 * prevents it.
 *
 * Registered on `ngModule` only (DI-only, the built-in-directive
 * precedent) — reachable via `injector.get('formDirective')` /
 * `injector.get('ngFormDirective')`, NOT exported from the root barrel.
 */

import { buildParentWriter } from '@compiler/expression-assign';
import { stashController } from '@compiler/element-slots';
import type { Attributes, DirectiveFactory, DirectiveFactoryReturn, LinkFn } from '@compiler/directive-types';
import type { ControllerInvokable } from '@controller/controller-types';
import { invokeExceptionHandler, type ExceptionHandler } from '@exception-handler/index';
import { parse } from '@parser/index';

import { FormControllerImpl, nullFormCtrl, type FormController } from './form-controller';

export const FORM_NAME = 'form';
export const NG_FORM_NAME = 'ngForm';
/** The single `$$ngControllers` key both directives publish under. */
export const FORM_CONTROLLER_KEY = 'form';

/**
 * Read the form's `name` — the `name` attribute for `<form>` /
 * `<ng-form>`, or the `ng-form` attribute value for `<div ng-form="…">`
 * (AngularJS parity — `ng-form` doubles as the name for the attribute
 * form). Empty / whitespace strings count as unnamed.
 */
function resolveFormName(attrs: Attributes): string | undefined {
  const nameAttr = attrs['name'];
  if (typeof nameAttr === 'string' && nameAttr !== '') {
    return nameAttr;
  }
  const ngFormAttr = attrs[NG_FORM_NAME];
  if (typeof ngFormAttr === 'string' && ngFormAttr !== '') {
    return ngFormAttr;
  }
  return undefined;
}

/**
 * Narrow the resolved parent-form require slot to a `FormController`.
 * `require: '?^^form'` yields `null` on a miss (top-level form); anything
 * that is not a live controller falls back to {@link nullFormCtrl}.
 */
function asParentForm(candidate: unknown): FormController {
  if (candidate instanceof FormControllerImpl) {
    return candidate;
  }
  return nullFormCtrl;
}

/**
 * Read the two resolved `require` controllers from the link fn's 4th
 * argument. The declared `require` is `['<ownName>', '?^^form']`, so the
 * resolved value is a 2-tuple `[ownController, parentOrNull]`.
 */
function readRequired(controllers: unknown): { own: FormControllerImpl | null; parent: FormController } {
  if (!Array.isArray(controllers)) {
    return { own: null, parent: nullFormCtrl };
  }
  const own = controllers[0] instanceof FormControllerImpl ? controllers[0] : null;
  const parent = asParentForm(controllers[1]);
  return { own, parent };
}

/**
 * Build the shared `form` / `ngForm` factory. `ownName` is the directive
 * name under which the controller seam stashes the controller (`form` or
 * `ngForm`) — it drives the `require` self-lookup.
 */
function buildFormFactory(ownName: string): DirectiveFactory {
  function formFactory($exceptionHandler: ExceptionHandler): DirectiveFactoryReturn {
    // Array-annotated so `injector.invoke` resolves the element-locals by
    // name. Returns a fresh FormController per matched element.
    const controller: ControllerInvokable = [
      '$element',
      '$attrs',
      (...args: unknown[]): FormControllerImpl =>
        new FormControllerImpl(args[0] as Element, resolveFormName(args[1] as Attributes)),
    ];

    const preLink: LinkFn = (_scope, element, _attrs, controllers) => {
      const { own } = readRequired(controllers);
      if (own === null) {
        return;
      }
      // Publish under the shared `'form'` key so descendant controls and
      // nested forms resolve `require: '?^^form'` regardless of whether
      // this element is a `<form>` or an `<ng-form>`. Runs in PRE-link so
      // it lands before any child links.
      stashController(element, FORM_CONTROLLER_KEY, own);
    };

    const postLink: LinkFn = (scope, element, _attrs, controllers) => {
      const { own, parent } = readRequired(controllers);
      if (own === null) {
        return;
      }

      // Re-point the controller's parent to the resolved enclosing form
      // and register with it so this (sub-)form's state bubbles up.
      own.$$parentForm = parent;
      parent.$addControl(own);

      // Publish a NAMED form onto the surrounding scope so `myForm.$…`
      // reads in expressions. The name expression is treated as an
      // assignable l-value (`myForm`, `forms.signup`); a non-assignable
      // name is silently skipped (an unnamed form is a valid, common
      // case — no error).
      if (own.$name !== undefined) {
        const writer = buildParentWriter(parse(own.$name));
        if (writer !== undefined) {
          writer(scope, own);
        }
      }

      // Native submit handling. Only the `$setSubmitted` state transition
      // + native-submit suppression live here; the `ngSubmit` expression
      // is run by the standalone `ngSubmit` event directive (spec 026).
      const hasAction = element.hasAttribute('action');

      const onSubmit = (event: Event) => {
        // A form with no `action` should not navigate — prevent the
        // native submit (AngularJS parity). A form WITH an action is left
        // to the handler / browser.
        if (!hasAction) {
          event.preventDefault();
        }
        const run = () => {
          own.$setSubmitted();
        };
        try {
          if (scope.$$phase !== null) {
            scope.$evalAsync(run);
          } else {
            scope.$apply(run);
          }
        } catch (err) {
          invokeExceptionHandler($exceptionHandler, err, '$compile');
        }
      };

      element.addEventListener('submit', onSubmit);

      // Teardown: deregister from the parent (drop this sub-form's
      // contribution) + remove the submit listener when the scope is
      // destroyed (e.g. an `ng-if` removes the form).
      scope.$on('$destroy', () => {
        element.removeEventListener('submit', onSubmit);
        parent.$removeControl(own);
      });
    };

    return {
      restrict: ownName === FORM_NAME ? 'E' : 'EA',
      require: [ownName, '?^^form'],
      controller,
      link: { pre: preLink, post: postLink },
    };
  }

  return ['$exceptionHandler', formFactory];
}

/**
 * DI-annotated `form` directive (`restrict: 'E'`). Auto-creates a form
 * group on every `<form>` — no attribute required.
 */
export const formDirective: DirectiveFactory = buildFormFactory(FORM_NAME);

/**
 * DI-annotated `ngForm` directive (`restrict: 'EA'`). Provides a nested
 * form group inside another form via `<ng-form>` or `<div ng-form>`.
 */
export const ngFormDirective: DirectiveFactory = buildFormFactory(NG_FORM_NAME);

/**
 * The scope publish a control performs onto the FORM INSTANCE. When a
 * named `ngModel` registers with a `FormController`, the control is
 * assigned onto the form under its `$name` so `myForm.email.$invalid`
 * resolves through the published form object. Exposed as a small helper
 * so `ng-model.ts` can call it without reaching into the controller's
 * internals.
 */
export function publishNamedControlOnForm(form: FormController, name: string, control: object): void {
  (form as unknown as Record<string, unknown>)[name] = control;
}

/**
 * Remove a named control's slot from the form instance (control
 * teardown). Mirror of {@link publishNamedControlOnForm}.
 */
export function unpublishNamedControlOnForm(form: FormController, name: string): void {
  const record = form as unknown as Record<string, unknown>;
  if (name in record) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the form instance carries named-control slots keyed by each control's `$name`; on control teardown its slot is removed entirely so `myForm.email` becomes undefined again (AngularJS parity — the control is no longer reachable through the form).
    delete record[name];
  }
}
