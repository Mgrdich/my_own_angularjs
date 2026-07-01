/**
 * The validation engine for {@link NgModelControllerImpl} (spec 039
 * Slice 5 / FS §2.6, §2.7, technical-considerations §2.3).
 *
 * Extracted from `ng-model-controller.ts` to keep that file focused on the
 * value pipeline + state surface; this module owns the sync-before-async
 * ordering, the `$pending` / `ng-pending` bookkeeping, and the
 * generation-counter that cancels stale async passes. It operates on the
 * controller through the narrow {@link ValidationHost} interface so it can
 * be reasoned about (and unit-tested) without dragging in the whole
 * controller surface.
 *
 * **Ordering (AngularJS parity).** `$$runValidators` runs in three stages:
 *
 *  1. **Parse.** If the `$parsers` chain failed (`$$parserValid === false`),
 *     every `$validators` / `$asyncValidators` key is skipped (cleared to a
 *     neutral valid state) and only the `parse` key fails — a bad parse
 *     short-circuits the rest.
 *  2. **Sync `$validators`.** Each runs against `(modelValue, viewValue)`
 *     and its result is written via `$setValidity(key, boolean)`. If ANY
 *     sync validator fails, every async key is skipped and the pass is done
 *     (invalid).
 *  3. **Async `$asyncValidators`.** Only reached when every sync validator
 *     passed. Each key is marked pending (`$setValidity(key, undefined)`),
 *     `ng-pending` goes on, and `$q.all(...)` awaits the promises. On settle
 *     each key resolves valid / invalid by whether its promise resolved /
 *     rejected.
 *
 * **Stale-pass cancellation.** Every `$$runValidators` invocation bumps a
 * monotonic `$$currentValidationRunId`; the async settle handlers capture
 * the id at start and no-op if a newer pass has since started — so a slow
 * server check that resolves after the user has typed again never writes a
 * stale validity.
 */

import type { QPromise, QService } from '@async/q-types';

import { setPendingClass } from './state-classes';

/**
 * A synchronous validation rule — returns truthy for valid. Pushed onto
 * {@link ValidationHost.$validators} under a rule name; the failing name
 * becomes the `ng-invalid-<name>` class + `$error[name]` entry.
 */
export type SyncValidator = (modelValue: unknown, viewValue: unknown) => boolean;

/**
 * An asynchronous validation rule — returns a {@link QPromise} that
 * resolves for valid, rejects for invalid. While outstanding the control
 * reports pending (`$pending[name]`, `ng-pending`); the model is not
 * written until every async rule settles.
 */
export type AsyncValidator = (modelValue: unknown, viewValue: unknown) => QPromise<unknown>;

/**
 * The narrow controller surface the engine drives. {@link NgModelControllerImpl}
 * satisfies it; the engine reads the validator maps + the parser-valid
 * flag, and writes validity through `$setValidity` (which owns the
 * `$error` / `$pending` / class bookkeeping).
 */
export interface ValidationHost {
  $validators: Record<string, SyncValidator>;
  $asyncValidators: Record<string, AsyncValidator>;
  /** The DOM element — the engine toggles `ng-pending` on it directly. */
  readonly $$element: Element;
  /** The `$q` service (async validators). */
  readonly $$q: QService;
  /** Monotonic run id — bumped per invocation to cancel stale async passes. */
  $$currentValidationRunId: number;
  /**
   * The controller's outstanding-async-rule map — `undefined` when no async
   * rule is pending, else a `{ [key]: true }` record. Owned by the
   * controller; the engine reads it to decide the `ng-pending` toggle.
   */
  $pending: Record<string, boolean> | undefined;
  /** Set a single rule's validity — `undefined` = pending. */
  $setValidity(key: string, isValid: boolean | undefined): void;
}

/**
 * Run the full validation pass for a committed model/view value. Bumps the
 * run id, runs sync-then-async, and calls `doneCallback(allValid)` exactly
 * once when the pass settles (synchronously for the sync-only / sync-fail
 * paths, asynchronously once `$q.all` resolves for the async path).
 *
 * `parserValid` is the controller's `$$parserValid`: `true` when the
 * `$parsers` chain produced a value, `false` when a parser returned
 * `undefined` (failed parse), `undefined` when there was nothing to parse.
 *
 * @param host - The controller under validation.
 * @param modelValue - The parsed model value.
 * @param viewValue - The last committed view value.
 * @param parserValid - The `$parsers` chain outcome (see above).
 * @param doneCallback - Called once with the overall validity.
 */
export function runValidators(
  host: ValidationHost,
  modelValue: unknown,
  viewValue: unknown,
  parserValid: boolean | undefined,
  doneCallback: (allValid: boolean) => void,
): void {
  host.$$currentValidationRunId += 1;
  const localRunId = host.$$currentValidationRunId;

  // A `$setValidity` that no-ops once a newer pass has started (so a stale
  // async settle can't clobber the live validity).
  const setValidity = (name: string, isValid: boolean | undefined): void => {
    if (localRunId === host.$$currentValidationRunId) {
      host.$setValidity(name, isValid);
    }
  };

  const validationDone = (allValid: boolean): void => {
    if (localRunId === host.$$currentValidationRunId) {
      doneCallback(allValid);
    }
  };

  // Stage 1 — parse errors. A failed parse skips every validator.
  if (parserValid === false) {
    for (const name of Object.keys(host.$validators)) {
      setValidity(name, true);
    }
    for (const name of Object.keys(host.$asyncValidators)) {
      setValidity(name, true);
    }
    setValidity('parse', false);
    validationDone(false);
    return;
  }
  setValidity('parse', true);

  // Stage 2 — synchronous validators.
  let syncValid = true;
  for (const [name, validator] of Object.entries(host.$validators)) {
    const result = validator(modelValue, viewValue);
    syncValid = syncValid && result;
    setValidity(name, result);
  }
  if (!syncValid) {
    // Skip async validators when any sync rule fails (parity ordering).
    for (const name of Object.keys(host.$asyncValidators)) {
      setValidity(name, true);
    }
    updatePendingClass(host);
    validationDone(false);
    return;
  }

  // Stage 3 — asynchronous validators (only reached when all sync pass).
  const promises: QPromise<unknown>[] = [];
  let allValid = true;
  for (const [name, validator] of Object.entries(host.$asyncValidators)) {
    const promise = validator(modelValue, viewValue);
    setValidity(name, undefined);
    promises.push(
      promise.then(
        () => {
          setValidity(name, true);
        },
        () => {
          allValid = false;
          setValidity(name, false);
        },
      ),
    );
  }

  updatePendingClass(host);

  if (promises.length === 0) {
    validationDone(true);
    return;
  }

  host.$$q.all(promises).then(
    () => {
      updatePendingClass(host);
      validationDone(allValid);
    },
    () => {
      /* $q.all here never rejects — each promise's rejection is caught above. */
    },
  );
}

/**
 * Sync the `ng-pending` class to whether any async rule is currently
 * outstanding (`$pending` non-empty). Called after each stage that can
 * change the pending set.
 */
function updatePendingClass(host: ValidationHost): void {
  const isPending = host.$pending !== undefined && Object.keys(host.$pending).length > 0;
  setPendingClass(host.$$element, isPending);
}
