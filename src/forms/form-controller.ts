/**
 * `FormController` — the per-form aggregation engine (spec 039 Slice 2 /
 * FS §2.3, technical-considerations §2.6).
 *
 * Every `<form>` / `<ng-form>` publishes one of these. It aggregates the
 * validity + dirty + pending state of every control (and every nested
 * sub-form) registered under it, and mirrors the aggregate onto the form
 * element via the shared state classes (`ng-valid` / `ng-invalid`,
 * `ng-dirty` / `ng-pristine`, `ng-submitted`, per-key
 * `ng-valid-<key>` / `ng-invalid-<key>`).
 *
 * **The validity aggregation model (AngularJS parity).** A form does NOT
 * store a boolean per control — it counts, per validation KEY, how many
 * controls currently fail that key. `$setValidity(key, false, control)`
 * pushes `control` into the key's failure set; `$setValidity(key, true,
 * control)` removes it. The form is invalid under `key` iff its failure
 * set is non-empty, and invalid overall iff ANY key has a non-empty
 * failure set. This makes control removal correct for free — dropping a
 * control removes it from every key's set (`$removeControl`), so a form
 * that was invalid only because of a since-removed control flips back to
 * valid without the control having to "un-fail" first.
 *
 * **Nested forms bubble up.** A `FormController` is itself a "control"
 * from its PARENT form's perspective: `form.$addControl(childForm)` and
 * `childForm.$setValidity(key, isValid, childForm)` propagate the child
 * form's aggregate validity to the parent. `$setDirty` / `$setSubmitted`
 * also walk up the `$$parentForm` chain.
 *
 * **`nullFormCtrl`** is a shared no-op form controller so a form-less
 * `ngModel` (an `<input ng-model>` with no enclosing form) has a valid
 * `$addControl` / `$setValidity` target without a null-check on every
 * call site — the AngularJS `nullFormCtrl` precedent.
 */

import { setPristineClass, setSubmittedClass, setValidationClass, setValidClass } from './state-classes';

/**
 * The minimal shape a `FormController` needs from each control it tracks
 * — either an `NgModelController` or a nested `FormController`. Only the
 * `$name` is read here (to publish named controls onto the form
 * instance); validity flows through `$setValidity`, not by reading the
 * control.
 */
export interface FormControlLike {
  /** The control's `name` (from `name` / `ng-form` attribute), if any. */
  $name: string | undefined;
}

/**
 * The public contract of the `form` / `ngForm` controller (AngularJS
 * parity). The method / field names ARE the API; consumers type against
 * this interface and read aggregate state in expressions
 * (`myForm.$invalid`, `myForm.email.$invalid`).
 */
export interface FormController {
  /** The form's name (from `name` / `ng-form` attribute), if any. */
  $name: string | undefined;
  /** Failing-rule map — `$error[key]` is the array of controls failing `key`. */
  $error: Record<string, FormControlLike[]>;
  /** Outstanding-async-rule map — `$pending[key]` is the array of pending controls. */
  $pending: Record<string, FormControlLike[]> | undefined;
  /** At least one control (or sub-form) is dirty. */
  $dirty: boolean;
  /** No control has been changed by the user. */
  $pristine: boolean;
  /** A submit has been attempted on this form. */
  $submitted: boolean;
  /** No failing rules across any control. */
  $valid: boolean;
  /** At least one failing rule across some control. */
  $invalid: boolean;
  /** Register a child control / sub-form with this form. */
  $addControl: (control: FormControlLike) => void;
  /** Deregister a child control / sub-form, dropping its state contribution. */
  $removeControl: (control: FormControlLike) => void;
  /** Bubble a control's per-key validity into this form's aggregate. */
  $setValidity: (key: string, isValid: boolean, control: FormControlLike) => void;
  /** Mark the form dirty (propagates to the parent form). */
  $setDirty: () => void;
  /** Reset the form (and its controls) to pristine. */
  $setPristine: () => void;
  /** Mark the form submitted (propagates to the parent form). */
  $setSubmitted: () => void;
  /** Support renaming a control (removes the old name slot, adds the new). */
  $$renameControl: (control: FormControlLike, newName: string) => void;
}

/**
 * A shared no-op `FormController` — the target `ngModel` (and a
 * top-level `form`) uses when there is no enclosing form. Every method
 * is a no-op so a form-less control (and the root form's parent
 * propagation) needs no null-check. AngularJS's `nullFormCtrl`.
 *
 * Declared BEFORE {@link FormControllerImpl} because the class defaults
 * its `$$parentForm` field to this value.
 */
export const nullFormCtrl: FormController = {
  $name: undefined,
  $error: {},
  $pending: undefined,
  $dirty: false,
  $pristine: true,
  $submitted: false,
  $valid: true,
  $invalid: false,
  $addControl: () => {
    /* no-op */
  },
  $removeControl: () => {
    /* no-op */
  },
  $setValidity: () => {
    /* no-op */
  },
  $setDirty: () => {
    /* no-op */
  },
  $setPristine: () => {
    /* no-op */
  },
  $setSubmitted: () => {
    /* no-op */
  },
  $$renameControl: () => {
    /* no-op */
  },
};

/**
 * Concrete `FormController`. Constructed by the `form` / `ngForm`
 * directive's controller seam with the form `element` + resolved
 * `name`; the directive's link then re-points `$$parentForm` to the
 * enclosing form (resolved via `require: '?^^form'`) and registers this
 * controller with it. The `element` is the form element whose state
 * classes it toggles.
 */
export class FormControllerImpl implements FormController {
  $name: string | undefined;
  $error: Record<string, FormControlLike[]> = {};
  $pending: Record<string, FormControlLike[]> | undefined = undefined;
  $dirty = false;
  $pristine = true;
  $submitted = false;
  $valid = true;
  $invalid = false;

  /** Every registered control / sub-form (used by `$setPristine` fan-out). */
  private readonly controls: FormControlLike[] = [];

  /**
   * @internal The enclosing form — {@link nullFormCtrl} until the form
   * directive's link resolves the real parent (via `require: '?^^form'`)
   * and re-points it. Defaulting to `nullFormCtrl` keeps every
   * propagation call (`$setDirty` / `$setSubmitted` / `$setValidity`)
   * safe even before link runs.
   */
  $$parentForm: FormController = nullFormCtrl;

  private readonly element: Element | null;

  constructor(element: Element | null, name: string | undefined) {
    this.element = element;
    this.$name = name;

    // Initialize the aggregate classes to the fresh-form defaults.
    if (this.element !== null) {
      setValidClass(this.element, true);
      setPristineClass(this.element, true);
      setSubmittedClass(this.element, false);
    }
  }

  $addControl(control: FormControlLike): void {
    if (!this.controls.includes(control)) {
      this.controls.push(control);
    }
  }

  $removeControl(control: FormControlLike): void {
    const index = this.controls.indexOf(control);
    if (index !== -1) {
      this.controls.splice(index, 1);
    }
    // Drop the control's contribution to every failing / pending key.
    for (const key of Object.keys(this.$error)) {
      this.$setValidity(key, true, control);
    }
    if (this.$pending !== undefined) {
      for (const key of Object.keys(this.$pending)) {
        this.$setValidity(key, true, control);
      }
    }
  }

  $setValidity(key: string, isValid: boolean, control: FormControlLike): void {
    const controls = this.$error[key] ?? [];
    if (isValid) {
      // Clear this control from the key's failure set.
      const index = controls.indexOf(control);
      if (index !== -1) {
        controls.splice(index, 1);
      }
      if (controls.length === 0) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- $error is a string-keyed map of failing-rule → control arrays; an empty set means the key no longer fails, so its entry is removed entirely (AngularJS parity — `Object.keys($error)` reflects only live failures, and per-key classes toggle to `ng-valid-<key>`).
        delete this.$error[key];
      } else {
        this.$error[key] = controls;
      }
    } else {
      // Record this control as failing the key.
      if (!controls.includes(control)) {
        controls.push(control);
      }
      this.$error[key] = controls;
    }

    const keyStillFails = (this.$error[key]?.length ?? 0) > 0;
    if (this.element !== null) {
      setValidationClass(this.element, key, !keyStillFails);
    }

    // Aggregate: valid iff no failing key remains.
    const anyInvalid = Object.keys(this.$error).length > 0;
    this.$valid = !anyInvalid;
    this.$invalid = anyInvalid;
    if (this.element !== null) {
      setValidClass(this.element, this.$valid);
    }

    // Bubble this form's aggregate for `key` up to the parent form so a
    // nested `ng-form`'s validity reaches the enclosing `<form>`.
    this.$$parentForm.$setValidity(key, !keyStillFails, this);
  }

  $setDirty(): void {
    this.$dirty = true;
    this.$pristine = false;
    if (this.element !== null) {
      setPristineClass(this.element, false);
    }
    // Propagate up — a dirty control in a nested form makes the parent
    // form dirty too.
    this.$$parentForm.$setDirty();
  }

  $setPristine(): void {
    this.$dirty = false;
    this.$pristine = true;
    this.$submitted = false;
    if (this.element !== null) {
      setPristineClass(this.element, true);
      setSubmittedClass(this.element, false);
    }
    // Reset every registered control / sub-form back to pristine too
    // (AngularJS parity — `$setPristine` fans out to children).
    for (const control of this.controls) {
      const child = control as Partial<{ $setPristine: () => void }>;
      if (typeof child.$setPristine === 'function') {
        child.$setPristine();
      }
    }
  }

  $setSubmitted(): void {
    this.$submitted = true;
    if (this.element !== null) {
      setSubmittedClass(this.element, true);
    }
    // Propagate up so submitting a nested form marks the parent too.
    this.$$parentForm.$setSubmitted();
  }

  $$renameControl(control: FormControlLike, newName: string): void {
    control.$name = newName;
  }
}
