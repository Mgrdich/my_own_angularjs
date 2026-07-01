/**
 * `select` directive + `SelectController` (spec 039 Slice 4 / FS §2.4,
 * technical-considerations §2.5).
 *
 * A `<select ng-model>` binds the chosen `<option>`'s value; a
 * `<select multiple ng-model>` binds an **array** of the selected option
 * values. The directive publishes a {@link SelectController} (under the
 * `'select'` `$$ngControllers` key) that:
 *
 *  - registers / de-registers every `<option>` beneath it — plain markup
 *    options via the `option` directive AND the options `ngOptions`
 *    generates — mapping an OPAQUE string key (the DOM `value` attribute)
 *    to the real model value the option contributes;
 *  - `writeValue(value)` (single) / `writeMultiValue(values)` (multiple)
 *    reflects the model onto the DOM `<select>` selection, adding a
 *    synthetic "unknown option" (an empty `<option value="?">`) when the
 *    model matches no registered option — AngularJS parity so a model set
 *    to a value not yet in the option list does not silently select the
 *    first option;
 *  - `readValue()` reads the current selection back out (the mapped model
 *    value for a single select, the array of mapped values for a multiple
 *    select).
 *
 * `select` requires `['select', '?ngModel']`: the `SelectController` is
 * always constructed (so child `option` / `ngOptions` directives resolve
 * it via `require: '^select'`), but the `ngModel` wiring — `$render`
 * (model → selection) + the native `change` listener (selection → model)
 * — is installed only when the element carries an `ng-model`.
 *
 * **The option-value keying seam.** AngularJS's `SelectController` keys
 * options by their DOM string value. Plain `<option value="x">` self-keys
 * on `x` and contributes the STRING `x` as its model value. `ngOptions`
 * instead assigns each generated option a synthetic key (`'0'`, `'1'`, …
 * or a `track by` key) and registers the REAL (possibly non-string) model
 * value under that key, so a `<select ng-options>` can bind objects /
 * numbers, not just strings. Both routes funnel through the same
 * `registerOption` / `readValue` / `writeValue` surface here.
 *
 * Registered on `ngModule` only (DI-only, the built-in-directive
 * precedent) — reachable via `injector.get('selectDirective')`, NOT
 * exported from the root barrel.
 */

import { stashController } from '@compiler/element-slots';
import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from '@compiler/directive-types';
import type { ControllerInvokable } from '@controller/controller-types';

import { NgModelControllerImpl } from './ng-model-controller';

export const SELECT_NAME = 'select';
export const OPTION_NAME = 'option';

/** The synthetic key + text of the "unknown option" AngularJS inserts. */
const UNKNOWN_OPTION_KEY = '?';

/**
 * The public contract of the `select` controller (AngularJS parity). The
 * method / field names ARE the API; `option` and `ngOptions` type against
 * this interface to register / render options.
 */
export interface SelectController {
  /** `true` when the underlying `<select>` carries the `multiple` attribute. */
  readonly multiple: boolean;
  /**
   * Register an option under an opaque string `key`, contributing `value`
   * as its model value when selected, using the supplied DOM `<option>`
   * element. Called by the `option` directive (plain markup) and by
   * `ngOptions` (generated options).
   */
  registerOption: (key: string, value: unknown, element: HTMLOptionElement) => void;
  /** De-register the option under `key` (option teardown). */
  removeOption: (key: string) => void;
  /** Read the current DOM selection back as a model value (single) / array (multiple). */
  readValue: () => unknown;
  /**
   * Reflect a single-select model `value` onto the DOM selection, inserting
   * the synthetic unknown option when `value` matches no registered option.
   */
  writeValue: (value: unknown) => void;
  /** Reflect a multiple-select model array `values` onto the DOM selection. */
  writeMultiValue: (values: readonly unknown[]) => void;
  /**
   * Whether `ngOptions` has taken over option management for this select
   * (suppresses the plain `option` directive's self-registration).
   */
  optionsInterface: boolean;
  /**
   * Hook `ngOptions` installs so the `select` render / change path defers
   * to it. When present, `readValue` / `writeValue` route through here.
   */
  ngOptionsHooks:
    | {
        readValue: () => unknown;
        writeValue: (value: unknown) => void;
      }
    | undefined;
  /** The bound `NgModelController`, once `ng-model` wiring has run (else `null`). */
  ngModelCtrl: NgModelControllerImpl | null;
  /** Re-read the DOM selection and push it into the model (used by `ngOptions`). */
  selectValueChanged: () => void;
}

/**
 * Concrete `SelectController`. Constructed by the `select` directive's
 * controller seam with the `<select>` element + linked scope; option
 * children register through it during their own link phase.
 */
export class SelectControllerImpl implements SelectController {
  readonly multiple: boolean;
  optionsInterface = false;
  ngOptionsHooks: SelectController['ngOptionsHooks'] = undefined;
  ngModelCtrl: NgModelControllerImpl | null = null;

  /** key → contributed model value. */
  private readonly optionValues = new Map<string, unknown>();
  /** key → DOM option element. */
  private readonly optionElements = new Map<string, HTMLOptionElement>();

  private readonly element: HTMLSelectElement;
  private unknownOption: HTMLOptionElement | null = null;

  /**
   * Dispatch a selection → model commit through the `$$phase`-guarded
   * `$apply` / `$evalAsync` seam. Installed by the directive link when
   * `ng-model` is present; a no-op before then (so an option registering
   * during compile does not fire a commit).
   */
  applyChange: (run: () => void) => void = () => {
    /* installed by the select link when ng-model is present */
  };

  constructor(element: HTMLSelectElement) {
    this.element = element;
    this.multiple = element.hasAttribute('multiple');
  }

  registerOption(key: string, value: unknown, optionElement: HTMLOptionElement): void {
    this.optionValues.set(key, value);
    this.optionElements.set(key, optionElement);
    optionElement.value = key;
  }

  removeOption(key: string): void {
    this.optionValues.delete(key);
    this.optionElements.delete(key);
  }

  readValue(): unknown {
    if (this.ngOptionsHooks !== undefined) {
      return this.ngOptionsHooks.readValue();
    }
    if (this.multiple) {
      const selected: unknown[] = [];
      for (const option of Array.from(this.element.options)) {
        if (option.selected && option.value !== UNKNOWN_OPTION_KEY) {
          selected.push(this.mappedValue(option.value));
        }
      }
      return selected;
    }
    const key = this.element.value;
    if (key === UNKNOWN_OPTION_KEY) {
      return undefined;
    }
    return this.mappedValue(key);
  }

  writeValue(value: unknown): void {
    if (this.ngOptionsHooks !== undefined) {
      this.ngOptionsHooks.writeValue(value);
      return;
    }
    const key = this.keyForValue(value);
    if (key === null) {
      // The model matches no registered option — show the unknown option.
      this.renderUnknownOption(value);
      return;
    }
    this.removeUnknownOption();
    this.element.value = key;
  }

  writeMultiValue(values: readonly unknown[]): void {
    if (this.ngOptionsHooks !== undefined) {
      // `ngOptions` owns the option list — its writeValue handles the
      // multiple case (array of model values) too.
      this.ngOptionsHooks.writeValue(values);
      return;
    }
    this.removeUnknownOption();
    const wanted = new Set(values);
    for (const option of Array.from(this.element.options)) {
      if (option.value === UNKNOWN_OPTION_KEY) {
        continue;
      }
      option.selected = wanted.has(this.mappedValue(option.value));
    }
  }

  selectValueChanged(): void {
    if (this.ngModelCtrl === null) {
      return;
    }
    const ctrl = this.ngModelCtrl;
    this.applyChange(() => {
      ctrl.$setViewValue(this.readValue());
    });
  }

  /** The model value a registered option key contributes (identity for plain markup). */
  private mappedValue(key: string): unknown {
    if (this.optionValues.has(key)) {
      return this.optionValues.get(key);
    }
    return key;
  }

  /** The registered key whose contributed value strictly equals `value`, else `null`. */
  private keyForValue(value: unknown): string | null {
    for (const [key, mapped] of this.optionValues) {
      if (mapped === value) {
        return key;
      }
    }
    return null;
  }

  private renderUnknownOption(value: unknown): void {
    if (this.unknownOption === null) {
      const option = document.createElement('option');
      option.value = UNKNOWN_OPTION_KEY;
      option.textContent = '';
      this.unknownOption = option;
    }
    // Empty text — AngularJS shows the unknown option as the current
    // selection with a blank label so the mismatched value is visible as
    // "nothing selected" rather than silently binding the first option.
    // The mismatched model value is typically a primitive; the cast to the
    // primitive union makes the `String(...)` conversion visible as safe to
    // `@typescript-eslint/no-base-to-string` (the `ng-repeat-identity.ts`
    // precedent) — a `Symbol` stringifies without throwing, an accidental
    // object falls back to its own `toString`.
    const primitive = value as string | number | boolean | bigint | symbol;
    this.unknownOption.textContent = value === undefined || value === null ? '' : String(primitive);
    if (this.unknownOption.parentNode === null) {
      this.element.insertBefore(this.unknownOption, this.element.firstChild);
    }
    this.element.value = UNKNOWN_OPTION_KEY;
  }

  private removeUnknownOption(): void {
    if (this.unknownOption !== null && this.unknownOption.parentNode !== null) {
      this.unknownOption.parentNode.removeChild(this.unknownOption);
    }
  }
}

function asSelectController(controllers: unknown): SelectControllerImpl | null {
  if (controllers instanceof SelectControllerImpl) {
    return controllers;
  }
  if (Array.isArray(controllers) && controllers[0] instanceof SelectControllerImpl) {
    return controllers[0];
  }
  return null;
}

function asNgModelFromTuple(controllers: unknown): NgModelControllerImpl | null {
  if (Array.isArray(controllers) && controllers[1] instanceof NgModelControllerImpl) {
    return controllers[1];
  }
  return null;
}

function selectFactory(): DirectiveFactoryReturn {
  // Array-annotated so `injector.invoke` resolves `$element` by name.
  const controller: ControllerInvokable = [
    '$element',
    (...args: unknown[]): SelectControllerImpl => new SelectControllerImpl(args[0] as HTMLSelectElement),
  ];

  // PRE-link stashes the controller under the `'select'` key BEFORE child
  // `option` / `ngOptions` directives link, so their `require: '^select'`
  // resolves — mirroring the `form` pre-link publish precedent.
  const preLink: LinkFn = (_scope, element, _attrs, controllers) => {
    const selectCtrl = asSelectController(controllers);
    if (selectCtrl === null) {
      return;
    }
    stashController(element, SELECT_NAME, selectCtrl);
  };

  const postLink: LinkFn = (scope, element, _attrs, controllers) => {
    const selectCtrl = asSelectController(controllers);
    if (selectCtrl === null) {
      return;
    }
    const modelCtrl = asNgModelFromTuple(controllers);
    if (modelCtrl === null) {
      // No ng-model — the select still tracks options (so `ngOptions`
      // renders) but nothing binds a model.
      return;
    }

    selectCtrl.ngModelCtrl = modelCtrl;
    selectCtrl.applyChange = (run: () => void) => {
      if (scope.$$phase !== null) {
        scope.$evalAsync(run);
      } else {
        scope.$apply(run);
      }
    };

    // Model → view: render the selection from the model value.
    modelCtrl.$render = () => {
      const viewValue = modelCtrl.$viewValue;
      if (selectCtrl.multiple) {
        selectCtrl.writeMultiValue(Array.isArray(viewValue) ? viewValue : []);
      } else {
        selectCtrl.writeValue(viewValue);
      }
    };

    // A multiple select's empty state is "no selection" — an empty array.
    if (selectCtrl.multiple) {
      modelCtrl.$isEmpty = (value: unknown): boolean => !Array.isArray(value) || value.length === 0;
    }

    // View → model: the native `change` event commits the current
    // selection through the `$$phase`-guarded seam.
    const selectElement = element as HTMLSelectElement;
    const listener = () => {
      selectCtrl.applyChange(() => {
        modelCtrl.$setViewValue(selectCtrl.readValue());
      });
    };
    selectElement.addEventListener('change', listener);
    scope.$on('$destroy', () => {
      selectElement.removeEventListener('change', listener);
    });
  };

  return {
    restrict: 'E',
    require: [SELECT_NAME, '?ngModel'],
    controller,
    link: { pre: preLink, post: postLink },
  };
}

/**
 * DI-annotated `select` directive. Zero deps — the controller reads only
 * `$element`. Registered on `ngModule` via `forms-register.ts`.
 */
export const selectDirective: DirectiveFactory = [selectFactory];

/**
 * The `option` directive — plain markup `<option>` self-registration into
 * the enclosing `SelectController`. Skipped entirely when `ngOptions` has
 * taken over the select (`optionsInterface`), because `ngOptions` manages
 * its own generated options. An option's DOM `value` attribute (or its
 * text content when `value` is absent, AngularJS parity) is BOTH the
 * option key and its contributed model value (a string).
 *
 * `require: '?^^select'` — optional + ancestor-only, so a stray
 * `<option>` outside a `<select>` links harmlessly.
 */
function optionFactory(): DirectiveFactoryReturn {
  const link: LinkFn = (scope, element, attrs, controllers) => {
    const selectCtrl = controllers instanceof SelectControllerImpl ? controllers : null;
    if (selectCtrl === null || selectCtrl.optionsInterface) {
      // No enclosing select, or ngOptions owns the option list — nothing
      // to self-register.
      return;
    }
    const optionEl = element as HTMLOptionElement;
    // Key + contributed value: the explicit `value` attribute, else the
    // option's text content (AngularJS parity — `<option>Blue</option>`
    // contributes `'Blue'`).
    const valueAttr = attrs['value'];
    let key = typeof valueAttr === 'string' ? valueAttr : optionEl.text;

    selectCtrl.registerOption(key, key, optionEl);
    // A newly-arrived option may complete the model's pending selection
    // (an out-of-order model set that previously showed the unknown
    // option). Re-render on the next digest turn.
    if (selectCtrl.ngModelCtrl !== null) {
      selectCtrl.ngModelCtrl.$render();
    }

    // An interpolated `value="{{…}}"` re-keys the option when it changes
    // (AngularJS parity — the old key would otherwise contribute a stale
    // string to the model).
    if (typeof valueAttr === 'string') {
      const stopObserve = attrs.$observe('value', (newValue) => {
        if (typeof newValue !== 'string' || newValue === key) {
          return;
        }
        selectCtrl.removeOption(key);
        key = newValue;
        selectCtrl.registerOption(key, key, optionEl);
        if (selectCtrl.ngModelCtrl !== null) {
          selectCtrl.ngModelCtrl.$render();
        }
      });
      scope.$on('$destroy', stopObserve);
    }

    scope.$on('$destroy', () => {
      selectCtrl.removeOption(key);
    });
  };

  return {
    restrict: 'E',
    require: '?^^select',
    link,
  };
}

/**
 * DI-annotated `option` directive. Registered on `ngModule`.
 */
export const optionDirective: DirectiveFactory = [optionFactory];
