/**
 * `NgModelController` — the per-control value pipeline + state engine
 * (spec 039 Slice 1 / FS §2.1, §2.2, technical-considerations §2.2).
 *
 * Every `ng-model` control publishes one of these so collaborating
 * directives (the `input` / `textarea` type handlers, built-in and custom
 * validators, `ng-change`) can wire into the bidirectional value flow.
 * The controller is instantiated by the compiler's per-element controller
 * seam (the `ngModel` directive declares `controller: ...`), stashed on
 * `$$ngControllers` under the name `ngModel`, and reachable from any
 * directive that declares `require: 'ngModel'` / `require: '?ngModel'`.
 *
 * **The two transformation lists.**
 *
 *  - `$parsers` run view → model on every committed view change, in
 *    REGISTRATION order. Each takes the prior stage's output and returns
 *    the next; a parser returning `undefined` short-circuits the rest
 *    (AngularJS parity — a failed parse yields `undefined` model).
 *  - `$formatters` run model → view whenever the bound model changes, in
 *    REVERSE registration order. The final string is what `$render` writes
 *    to the DOM.
 *
 * **`$render` is directive-supplied.** The base controller installs a
 * no-op; each input-type handler overrides it to write `$viewValue` to the
 * actual DOM control. The model→view feedback guard (`$$lastCommittedViewValue`
 * compare in the model `$watch`, owned by the `ngModel` directive) keeps
 * `$render` from firing when the view already shows the value.
 *
 * **Slice-1 scope.** This slice ships the synchronous pipeline + state +
 * the per-rule `$setValidity` surface. The async-validator engine
 * (`$validators` / `$asyncValidators` / `$pending` / `$$runValidators`)
 * lands in Slice 5; the field declarations are present now (empty maps,
 * `$pending` undefined) so the published `.d.ts` contract stays stable,
 * but `$setViewValue` does not yet run them.
 */

import type { Scope } from '@core/index';

import type { Attributes } from '@compiler/directive-types';

import { setEmptyClass, setPristineClass, setTouchedClass, setValidationClass, setValidClass } from './state-classes';

/**
 * A view → model transform. Receives the prior stage's output and returns
 * the next-stage value. Returning `undefined` halts the chain (the parse
 * is treated as failed and the model becomes `undefined`).
 */
export type ModelParser = (value: unknown) => unknown;

/**
 * A model → view transform. Receives the prior stage's output and returns
 * the next. The final stage's output feeds `$render`.
 */
export type ModelFormatter = (value: unknown) => unknown;

/**
 * The public contract of the `ngModel` controller (AngularJS parity). The
 * method/field names ARE the API; consumers type against this interface.
 */
export interface NgModelController {
  /** Current on-screen value (after `$parsers` would run, the raw view input). */
  $viewValue: unknown;
  /** Current stored value (the value written back to the bound model). */
  $modelValue: unknown;
  /** View → model transforms, run in order on a committed view change. */
  $parsers: ModelParser[];
  /** Model → view transforms, run in reverse on a model change. */
  $formatters: ModelFormatter[];
  /** Callbacks fired after a committed view change (backs `ng-change`). */
  $viewChangeListeners: (() => void)[];
  /** Failing-rule map — `$error[key] === true` while rule `key` fails. */
  $error: Record<string, boolean>;
  /** Outstanding-async-rule map (Slice 5). */
  $pending: Record<string, boolean> | undefined;
  /** The element has been changed by the user. */
  $dirty: boolean;
  /** The element has not been changed by the user. */
  $pristine: boolean;
  /** The element has been visited (focus then blur). */
  $touched: boolean;
  /** The element has not been visited. */
  $untouched: boolean;
  /** No failing rules. */
  $valid: boolean;
  /** At least one failing rule. */
  $invalid: boolean;
  /** The control's name (from the `name` attribute), if any. */
  $name: string | undefined;
  /** Directive-supplied DOM writer — pushes `$viewValue` to the control. */
  $render: () => void;
  /** Overridable emptiness test — drives `ng-empty` / `required`. */
  $isEmpty: (value: unknown) => boolean;
  /**
   * Entry point from the control: a new on-screen value runs the
   * `$parsers`, writes the model (via the directive-installed callback),
   * marks the control dirty, and fires `$viewChangeListeners`.
   */
  $setViewValue: (value: unknown, trigger?: string) => void;
  /** Flush a buffered (debounce/updateOn) view value — Slice 1: no-op buffer, commits the current view value. */
  $commitViewValue: () => void;
  /** Revert a buffered view value back to the last committed one. */
  $rollbackViewValue: () => void;
  /** Set a single rule's pass/fail; updates `$error` + per-rule class + aggregate validity. */
  $setValidity: (key: string, isValid: boolean) => void;
  /** Mark the control pristine (and untouched? no — pristine only). */
  $setPristine: () => void;
  /** Mark the control dirty. */
  $setDirty: () => void;
  /** Mark the control touched. */
  $setTouched: () => void;
  /** Mark the control untouched. */
  $setUntouched: () => void;
}

/**
 * Default emptiness test — AngularJS parity. A value is empty when it is
 * `undefined`, `null`, `''`, `NaN`, or `false`. Input-type handlers
 * override this (e.g. checkbox: empty when not checked).
 */
function defaultIsEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (typeof value === 'number' && Number.isNaN(value));
}

/**
 * Concrete implementation. Constructed by the compiler's controller seam
 * with element-locals `{ $scope, $element, $attrs }`; the `ngModel`
 * directive's link fn (via `require: 'ngModel'`) installs the model
 * write-back + watch and overrides `$render` through the input-type
 * handler.
 *
 * `$$setModelValue` is the directive-installed write-back hook — the
 * controller calls it from `$setViewValue` to push the parsed value onto
 * the bound scope expression. Until `ngModel`'s link runs it is a no-op
 * (so a controller constructed in isolation does not throw).
 */
export class NgModelControllerImpl implements NgModelController {
  $viewValue: unknown = Number.NaN;
  $modelValue: unknown = Number.NaN;
  $parsers: ModelParser[] = [];
  $formatters: ModelFormatter[] = [];
  $viewChangeListeners: (() => void)[] = [];
  $error: Record<string, boolean> = {};
  $pending: Record<string, boolean> | undefined = undefined;
  $dirty = false;
  $pristine = true;
  $touched = false;
  $untouched = true;
  $valid = true;
  $invalid = false;
  $name: string | undefined;
  $render: () => void = () => {
    /* directive-supplied; no-op until an input-type handler overrides it */
  };
  $isEmpty: (value: unknown) => boolean = defaultIsEmpty;

  /**
   * Directive-installed model write-back hook. Set by `ngModel`'s link fn
   * to push a parsed value onto the bound scope expression via
   * `buildParentWriter`. No-op until then.
   *
   * @internal Consumed only by this controller + the `ngModel` directive.
   */
  $$writeModelToScope: (value: unknown) => void = () => {
    /* installed by ngModel link */
  };

  /**
   * The last view value committed to the model. Owned by this controller
   * but consulted by `ngModel`'s model `$watch` to implement the
   * model→view feedback guard ($render only on divergence).
   *
   * @internal
   */
  $$lastCommittedViewValue: unknown = Number.NaN;

  private readonly scope: Scope;
  private readonly element: Element;

  constructor(scope: Scope, element: Element, attrs: Attributes) {
    this.scope = scope;
    this.element = element;
    const name = attrs['name'];
    this.$name = typeof name === 'string' ? name : undefined;

    // Initialize the state classes to the fresh-control defaults:
    // valid + pristine + untouched. Empty/not-empty is set by the first
    // formatter run (ngModel link).
    setValidClass(this.element, true);
    setPristineClass(this.element, true);
    setTouchedClass(this.element, true);
  }

  $isEmptyClassUpdate(value: unknown): void {
    setEmptyClass(this.element, this.$isEmpty(value));
  }

  $setViewValue(value: unknown): void {
    this.$viewValue = value;
    this.$$lastCommittedViewValue = value;

    if (this.$pristine) {
      this.$setDirty();
    }

    // Run the parsers view → model in registration order. A parser
    // returning `undefined` halts the chain (failed parse → undefined
    // model), matching AngularJS.
    let modelValue: unknown = value;
    for (const parser of this.$parsers) {
      modelValue = parser(modelValue);
      if (modelValue === undefined) {
        break;
      }
    }

    this.$isEmptyClassUpdate(this.$viewValue);

    // Write the parsed value to the model only when it actually changed,
    // then fire the view-change listeners. The feedback guard
    // ($$lastCommittedViewValue) on the model watch prevents the
    // subsequent model→view re-render from clobbering the live DOM.
    if (this.$modelValue !== modelValue) {
      this.$modelValue = modelValue;
      this.$$writeModelToScope(modelValue);
      this.$$fireViewChangeListeners();
    }
  }

  /** @internal Fire every registered view-change listener (backs `ng-change`). */
  $$fireViewChangeListeners(): void {
    for (const listener of this.$viewChangeListeners) {
      listener();
    }
  }

  $commitViewValue(): void {
    // Slice 1 has no debounce/updateOn buffer — committing re-applies the
    // current view value through the pipeline. The full buffered commit
    // lands in Slice 6 (`ngModelOptions`).
    this.$setViewValue(this.$viewValue);
  }

  $rollbackViewValue(): void {
    // Slice 1: no buffer to roll back; re-render the last committed value.
    this.$viewValue = this.$$lastCommittedViewValue;
    this.$render();
  }

  $setValidity(key: string, isValid: boolean): void {
    if (isValid) {
      // Clear a previously-recorded failure for this key.
      if (key in this.$error) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- $error is a string-keyed map of failing rules; clearing a passing rule removes its key entirely (AngularJS parity, so `Object.keys($error)` reflects only live failures).
        delete this.$error[key];
      }
    } else {
      this.$error[key] = true;
    }

    setValidationClass(this.element, key, isValid);

    // Aggregate: valid iff no failing rules remain.
    const anyInvalid = Object.keys(this.$error).length > 0;
    this.$valid = !anyInvalid;
    this.$invalid = anyInvalid;
    setValidClass(this.element, this.$valid);
  }

  $setPristine(): void {
    this.$dirty = false;
    this.$pristine = true;
    setPristineClass(this.element, true);
  }

  $setDirty(): void {
    this.$dirty = true;
    this.$pristine = false;
    setPristineClass(this.element, false);
  }

  $setTouched(): void {
    this.$touched = true;
    this.$untouched = false;
    setTouchedClass(this.element, false);
  }

  $setUntouched(): void {
    this.$touched = false;
    this.$untouched = true;
    setTouchedClass(this.element, true);
  }
}
