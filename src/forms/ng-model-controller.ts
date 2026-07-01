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
 * **Validation (Slice 5).** `$setViewValue` and the model→view watch both
 * route through `$$parseAndValidate` → `$$runValidators` (the engine lives
 * in `validation.ts`): sync `$validators` first, then — only if all pass —
 * async `$asyncValidators`, marking `$pending` + `ng-pending` until
 * `$q.all(...)` settles. `$setValidity` is tri-state
 * (`true` / `false` / `undefined` = pending); a monotonic
 * `$$currentValidationRunId` cancels stale async passes. By default an
 * invalid parse / failing validators keep the value OUT of the scope model
 * (`$modelValue` → `undefined`); the `$$allowInvalid` seam (Slice 6's
 * `ngModelOptions.allowInvalid`) flips that.
 */

import type { QService } from '@async/q-types';
import type { Scope } from '@core/index';

import type { Attributes } from '@compiler/directive-types';

import { type FormController, nullFormCtrl } from './form-controller';
import { defaultModelOptions, resolveDebounceDelay, type ModelOptions } from './ng-model-options';
import {
  clearValidationClass,
  setEmptyClass,
  setPendingClass,
  setPristineClass,
  setTouchedClass,
  setValidationClass,
  setValidClass,
} from './state-classes';
import { runValidators, type AsyncValidator, type SyncValidator } from './validation';

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
  /**
   * Synchronous validation rules keyed by rule name — each returns truthy
   * for valid. Run on every committed view change and every model change
   * (Slice 5). A failing rule surfaces `ng-invalid-<name>` + `$error[name]`.
   */
  $validators: Record<string, SyncValidator>;
  /**
   * Asynchronous validation rules keyed by rule name — each returns a
   * promise that resolves for valid / rejects for invalid (Slice 5). Run
   * ONLY after every sync validator passes; while outstanding the control
   * reports `$pending[name]` + `ng-pending` and the model is not written.
   */
  $asyncValidators: Record<string, AsyncValidator>;
  /** Callbacks fired after a committed view change (backs `ng-change`). */
  $viewChangeListeners: (() => void)[];
  /** Failing-rule map — `$error[key] === true` while rule `key` fails. */
  $error: Record<string, boolean>;
  /** Outstanding-async-rule map — `$pending[key] === true` while async rule `key` is in flight (Slice 5). */
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
  /**
   * The resolved {@link ModelOptions} for this control (spec 039 Slice 6) —
   * the effective `ngModelOptions` after inheritance. Defaults to
   * {@link defaultModelOptions} (every option unset) until `ngModel`'s link
   * re-points it from the enclosing `ngModelOptions` (resolved by walking the
   * element's `$$ngControllers` stash).
   */
  $options: ModelOptions;
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
  /**
   * Flush the buffered (debounce / `updateOn`) view value — commits the
   * current `$viewValue` through the pipeline immediately, cancelling any
   * pending debounce timer (spec 039 Slice 6). A no-op when the buffered
   * value already matches the last commit.
   */
  $commitViewValue: () => void;
  /** Revert a buffered (uncommitted) view value back to the last committed one. */
  $rollbackViewValue: () => void;
  /**
   * Re-run every validator against the current model / view value (Slice 5)
   * — the programmatic re-validation entry point. Built-in validator
   * directives call it from their `$observe` when a bound parameter changes.
   */
  $validate: () => void;
  /**
   * Set a single rule's validity — `true` (valid), `false` (invalid), or
   * `undefined` (async pending). Updates `$error` / `$pending` + the
   * per-rule class + aggregate validity, and bubbles to the enclosing form.
   */
  $setValidity: (key: string, isValid: boolean | undefined) => void;
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
 * Remove `key` from a string-keyed boolean map if present. Used by
 * `$setValidity` to keep the `$error` / `$$success` / `$pending` maps
 * mutually exclusive per key.
 */
function unsetMapKey(map: Record<string, boolean>, key: string): void {
  if (key in map) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- these validity maps expose only live entries (AngularJS parity); clearing a key removes it entirely so `Object.keys(...)` reflects the current failing / pending / passing set.
    delete map[key];
  }
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
  $validators: Record<string, SyncValidator> = {};
  $asyncValidators: Record<string, AsyncValidator> = {};
  $viewChangeListeners: (() => void)[] = [];
  $error: Record<string, boolean> = {};
  $$success: Record<string, boolean> = {};
  $pending: Record<string, boolean> | undefined = undefined;
  $dirty = false;
  $pristine = true;
  $touched = false;
  $untouched = true;
  $valid = true;
  $invalid = false;
  $name: string | undefined;
  $options: ModelOptions = defaultModelOptions;
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

  /**
   * The enclosing form (spec 039 Slice 2). Defaults to {@link nullFormCtrl}
   * so a form-less `ngModel` needs no null-check; `ngModel`'s link
   * re-points it to the resolved `require: '?^^form'` form and registers
   * this control with it. Every per-rule `$setValidity` bubbles up to the
   * form so the form's aggregate reflects this control's validity; the
   * first user change bubbles `$setDirty`.
   *
   * @internal
   */
  $$parentForm: FormController = nullFormCtrl;

  /**
   * The last raw parsed model value BEFORE the invalid → `undefined`
   * substitution — `$validate()` re-runs validators against this so a
   * programmatic re-validation sees the real value, not the `undefined`
   * that a prior invalid pass wrote to the scope model.
   *
   * @internal
   */
  $$rawModelValue: unknown = Number.NaN;

  /**
   * The `$parsers` chain outcome for the last commit: `true` (produced a
   * value), `false` (a parser returned `undefined` — bad parse), or
   * `undefined` (nothing to parse). Drives the `parse` validity key.
   *
   * @internal
   */
  $$parserValid: boolean | undefined = undefined;

  /**
   * Monotonic validation-pass id — bumped by `$$runValidators` so a stale
   * async settle can be detected and dropped (spec 039 Slice 5).
   *
   * @internal
   */
  $$currentValidationRunId = 0;

  /**
   * When `true`, an invalid parse / failing validators STILL write the
   * value to the scope model (the `ngModelOptions.allowInvalid` behavior).
   * Defaults to `false` — invalid values are kept out of the model
   * (`undefined`). Slice 6's `ngModelOptions` directive flips this seam; it
   * lives here now so the validation engine has a single branch to gate on.
   *
   * @internal
   */
  $$allowInvalid = false;

  /**
   * The `$q` service, used by the async-validator engine. Element-locals
   * on the controller seam do not include `$q`, so `ngModel`'s controller
   * annotation injects it and hands it in.
   *
   * @internal
   */
  readonly $$q: QService;

  /**
   * Resolved timezone offset for the date/time input handlers (spec 039
   * Slice 6). `undefined` = the host's local timezone (Slice 3 behavior);
   * `ngModel`'s link sets it from `$options.getOption('timezone')`. The date
   * handlers read it lazily at parse/format time so a config-time swap takes
   * effect. Minutes east of UTC, or `undefined` for local.
   *
   * @internal
   */
  $$timezone: number | undefined = undefined;

  /**
   * Deferred-timer seam backing `ngModelOptions.debounce` (spec 039 Slice 6).
   * `ngModel`'s link binds it to `$timeout` so a debounced commit runs
   * `$$phase`-guarded inside a digest and cancels cleanly on `$destroy` /
   * supersession. Until then it fires the callback synchronously (no
   * debounce), so a controller constructed in isolation still commits.
   *
   * @internal
   */
  $$scheduleCommit: (fn: () => void, delay: number) => unknown = (fn) => {
    fn();
    return undefined;
  };

  /** Cancel a pending debounce timer. Paired with {@link $$scheduleCommit}. @internal */
  $$cancelScheduledCommit: (handle: unknown) => void = () => {
    /* no-op until ngModel binds $timeout.cancel */
  };

  /** The handle of the currently-pending debounce timer, if any. @internal */
  $$pendingCommitTimer: unknown = undefined;

  private readonly scope: Scope;
  private readonly element: Element;

  /** The DOM element — exposed to the validation engine for `ng-pending`. */
  get $$element(): Element {
    return this.element;
  }

  constructor(scope: Scope, element: Element, attrs: Attributes, $q: QService) {
    this.scope = scope;
    this.element = element;
    this.$$q = $q;
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

  $setViewValue(value: unknown, trigger = 'default'): void {
    this.$viewValue = value;
    this.$$debounceViewValueCommit(trigger);
  }

  /**
   * @internal Decide whether the current `$viewValue` commits immediately or
   * after a debounce delay (spec 039 Slice 6). A superseding change cancels
   * the previous pending timer (the timer seam is `$timeout`, so cancelling
   * is a clean no-op on an already-fired handle). A zero / absent delay
   * commits synchronously via {@link $commitViewValue}.
   */
  $$debounceViewValueCommit(trigger: string): void {
    const delay = resolveDebounceDelay(this.$options, trigger);

    // Cancel any pending commit — a new keystroke resets the debounce window.
    if (this.$$pendingCommitTimer !== undefined) {
      this.$$cancelScheduledCommit(this.$$pendingCommitTimer);
      this.$$pendingCommitTimer = undefined;
    }

    if (delay > 0) {
      this.$$pendingCommitTimer = this.$$scheduleCommit(() => {
        this.$$pendingCommitTimer = undefined;
        this.$commitViewValue();
      }, delay);
      return;
    }

    this.$commitViewValue();
  }

  /**
   * @internal Run the `$parsers` chain then validate, honoring `allowInvalid`.
   *
   * The parse chain sets `$$parserValid` (`false` when a parser returned
   * `undefined`); the raw parsed value is stashed on `$$rawModelValue` so
   * `$validate()` can re-run against it. On a valid pass (or with
   * `allowInvalid`) the value is written to the scope model and the
   * view-change listeners fire — but only when the model actually changed
   * (the feedback guard on the model watch then keeps `$render` from
   * clobbering a live keystroke).
   */
  $$parseAndValidate(): void {
    const viewValue = this.$$lastCommittedViewValue;
    let modelValue: unknown = viewValue;

    // Run the parsers view → model in registration order. A parser
    // returning `undefined` halts the chain (failed parse), matching
    // AngularJS — the `parse` validity key then fails and every other
    // validator is skipped.
    this.$$parserValid = modelValue === undefined ? undefined : true;
    if (this.$$parserValid === true) {
      for (const parser of this.$parsers) {
        modelValue = parser(modelValue);
        if (modelValue === undefined) {
          this.$$parserValid = false;
          break;
        }
      }
    }

    const prevModelValue = this.$modelValue;
    this.$$rawModelValue = modelValue;

    const writeIfChanged = (): void => {
      if (this.$modelValue !== prevModelValue) {
        this.$$writeModelToScope(this.$modelValue);
        this.$$fireViewChangeListeners();
      }
    };

    if (this.$$allowInvalid) {
      // Write the (possibly invalid) value up front; validators still run
      // and toggle validity, but the model is not withheld.
      this.$modelValue = modelValue;
      writeIfChanged();
    }

    this.$$runValidators(modelValue, viewValue, this.$$parserValid, (allValid) => {
      if (!this.$$allowInvalid) {
        this.$modelValue = allValid ? modelValue : undefined;
        writeIfChanged();
      }
    });
  }

  /**
   * @internal Delegate to the validation engine (`validation.ts`). Split
   * out so the engine's sync-before-async ordering + stale-pass
   * cancellation can be reasoned about independently of the pipeline.
   */
  $$runValidators(
    modelValue: unknown,
    viewValue: unknown,
    parserValid: boolean | undefined,
    doneCallback: (allValid: boolean) => void,
  ): void {
    runValidators(this, modelValue, viewValue, parserValid, doneCallback);
  }

  $validate(): void {
    // NaN model means "never set" (the fresh-control sentinel) — nothing to
    // validate yet (AngularJS parity).
    if (typeof this.$modelValue === 'number' && Number.isNaN(this.$modelValue)) {
      return;
    }
    const viewValue = this.$$lastCommittedViewValue;
    const modelValue = this.$$rawModelValue;
    const prevValid = this.$valid;
    const prevModelValue = this.$modelValue;

    this.$$runValidators(modelValue, viewValue, this.$$parserValid, (allValid) => {
      if (!this.$$allowInvalid && prevValid !== allValid) {
        this.$modelValue = allValid ? modelValue : undefined;
        if (this.$modelValue !== prevModelValue) {
          this.$$writeModelToScope(this.$modelValue);
        }
      }
    });
  }

  /** @internal Fire every registered view-change listener (backs `ng-change`). */
  $$fireViewChangeListeners(): void {
    for (const listener of this.$viewChangeListeners) {
      listener();
    }
  }

  $commitViewValue(): void {
    // Flush any pending debounce timer — an explicit commit (e.g. `blur` with
    // `{ blur: 0 }`, or a programmatic `$commitViewValue()`) supersedes it.
    if (this.$$pendingCommitTimer !== undefined) {
      this.$$cancelScheduledCommit(this.$$pendingCommitTimer);
      this.$$pendingCommitTimer = undefined;
    }

    const viewValue = this.$viewValue;
    // No-op when the buffered view value already matches the last commit
    // (AngularJS parity — a re-commit of the same value does nothing). The
    // `viewValue === ''` exception mirrors AngularJS's `$$hasNativeValidators`
    // clause: an empty commit still runs so a typed control (`number` /
    // `date`) re-reads its native `validity.badInput` — the browser reports
    // `value === ''` when it could not sanitize the raw input, so a re-commit
    // of `''` is the only signal that the garbage input is still present.
    if (this.$$lastCommittedViewValue === viewValue && viewValue !== '') {
      return;
    }

    this.$$lastCommittedViewValue = viewValue;

    if (this.$pristine) {
      this.$setDirty();
    }

    this.$isEmptyClassUpdate(viewValue);

    this.$$parseAndValidate();
  }

  $rollbackViewValue(): void {
    // Discard the buffered (uncommitted) view value and re-render the last
    // committed one. Cancels any pending debounce timer.
    if (this.$$pendingCommitTimer !== undefined) {
      this.$$cancelScheduledCommit(this.$$pendingCommitTimer);
      this.$$pendingCommitTimer = undefined;
    }
    this.$viewValue = this.$$lastCommittedViewValue;
    this.$render();
  }

  $setValidity(key: string, isValid: boolean | undefined): void {
    // Tri-state (AngularJS `addSetValidityMethod` parity):
    //   true      → success  (clear $error + $pending for the key)
    //   false     → failure  (record in $error; clear $$success + $pending)
    //   undefined → pending  (record in $pending; clear $error + $$success)
    // The three maps are always mutually exclusive per key.
    unsetMapKey(this.$error, key);
    unsetMapKey(this.$$success, key);
    if (this.$pending !== undefined) {
      unsetMapKey(this.$pending, key);
    }

    if (isValid === undefined) {
      // Pending — lazily create the $pending map on first async rule.
      this.$pending ??= {};
      this.$pending[key] = true;
    } else if (isValid) {
      this.$$success[key] = true;
    } else {
      this.$error[key] = true;
    }

    // Drop an emptied $pending map back to `undefined` (AngularJS parity —
    // `$pending` is `undefined`, not `{}`, when no async rule is in flight).
    if (this.$pending !== undefined && Object.keys(this.$pending).length === 0) {
      this.$pending = undefined;
    }

    // Per-rule class: `ng-valid-<key>` when success, `ng-invalid-<key>` when
    // failure. A pending key is neutral — remove BOTH per-rule classes so it
    // reads as neither valid nor invalid while the async rule settles.
    if (isValid === undefined) {
      clearValidationClass(this.element, key);
    } else {
      setValidationClass(this.element, key, isValid);
    }

    // Aggregate: invalid iff any $error key; valid iff no $error AND no
    // $pending key (a pending control is neither valid nor invalid).
    const anyInvalid = Object.keys(this.$error).length > 0;
    const anyPending = this.$pending !== undefined;
    this.$valid = !anyInvalid && !anyPending;
    this.$invalid = anyInvalid;
    setValidClass(this.element, !anyInvalid);
    setPendingClass(this.element, anyPending);

    // Bubble this control's per-key tri-state into the enclosing form so
    // the form's aggregate `$error` / `$pending` / `$valid` reflects it
    // (`undefined` marks the key pending on the form too — AngularJS
    // parity). A form-less control's `$$parentForm` is `nullFormCtrl`
    // (no-op).
    this.$$parentForm.$setValidity(key, isValid, this);
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
    // The first user change bubbles up so the enclosing form (and its
    // ancestors) become dirty too.
    this.$$parentForm.$setDirty();
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
