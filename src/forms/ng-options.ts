/**
 * `ngOptions` directive (spec 039 Slice 4 / FS §2.5,
 * technical-considerations §2.5).
 *
 * `<select ng-model ng-options="…">` generates `<option>` elements from an
 * array or object collection, wiring per-option label / value / optgroup /
 * `disabled` / `track by` per the AngularJS grammar (parsed by
 * `ng-options-parse.ts`). On a `$watchCollection` over the collection, the
 * whole option list is regenerated and re-selected against the current
 * model.
 *
 * **Integration with `SelectController`.** `ngOptions` takes OVER option
 * management from the plain `option` directive by setting
 * `optionsInterface = true` (so plain-markup `<option>` self-registration
 * is suppressed) and installing `ngOptionsHooks` so the select's
 * `readValue` / `writeValue` route through this directive's option list:
 *
 *  - `readValue()` maps the DOM `<select>`'s selected option key(s) back to
 *    the real (possibly non-primitive) model value(s) — a single select
 *    returns one value, a `multiple` select returns an array;
 *  - `writeValue(value)` finds the option whose value matches and sets the
 *    DOM selection (array of values for `multiple`).
 *
 * Each generated option carries a synthetic string key (`track by` result
 * when present, else the collection index for arrays / the property key for
 * objects). The real model value the option contributes is stored against
 * that key, so an object / number model round-trips through the string DOM
 * value.
 *
 * Registered on `ngModule` only (DI-only) — reachable via
 * `injector.get('ngOptionsDirective')`, NOT exported from the root barrel.
 */

import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from '@compiler/directive-types';
import { invokeExceptionHandler, type ExceptionHandler } from '@exception-handler/index';

import { NgModelControllerImpl } from './ng-model-controller';
import { parseNgOptions, type NgOptionsDescriptor } from './ng-options-parse';
import { SelectControllerImpl } from './select';

export const NG_OPTIONS_NAME = 'ngOptions';

/** One generated option: its synthetic key, real value, label + flags. */
interface GeneratedOption {
  key: string;
  value: unknown;
  label: string;
  group: string | undefined;
  disabled: boolean;
}

function asSelectAndModel(controllers: unknown): {
  select: SelectControllerImpl | null;
  model: NgModelControllerImpl | null;
} {
  if (!Array.isArray(controllers)) {
    return { select: null, model: null };
  }
  const select = controllers[0] instanceof SelectControllerImpl ? controllers[0] : null;
  const model = controllers[1] instanceof NgModelControllerImpl ? controllers[1] : null;
  return { select, model };
}

/**
 * Build the per-item locals object the descriptor's sub-expressions
 * evaluate against: the value under `valueName` (and, for object
 * collections, the key under `keyName`).
 */
function itemLocals(descriptor: NgOptionsDescriptor, value: unknown, key: unknown): Record<string, unknown> {
  const locals: Record<string, unknown> = { [descriptor.valueName]: value };
  if (descriptor.keyName !== undefined) {
    locals[descriptor.keyName] = key;
  }
  return locals;
}

/**
 * Enumerate the collection into `[key, value]` pairs — arrays yield
 * `[index, element]`, objects yield `[propKey, propValue]` in `Object.keys`
 * order. Anything else yields no options.
 */
function enumerate(collection: unknown): [unknown, unknown][] {
  if (Array.isArray(collection)) {
    return collection.map((value, index) => [index, value]);
  }
  if (collection !== null && typeof collection === 'object') {
    const record = collection as Record<string, unknown>;
    return Object.keys(record).map((propKey) => [propKey, record[propKey]]);
  }
  return [];
}

/**
 * Coerce a value into a synthetic DOM option key / label string. `null` /
 * `undefined` map to the empty string (a bare `<option value="">`); every
 * other value goes through `String(...)` so numbers, booleans, and object
 * `toString()` results become stable string keys.
 */
function safeString(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  // Option keys / labels flow from user expressions (`item.name`,
  // `item.id`, a `track by` result). They are expected to be primitives —
  // the cast to the primitive union makes the `String(...)` conversion
  // visible as safe to `@typescript-eslint/no-base-to-string` (the
  // `ng-repeat-identity.ts` precedent) and produces the meaningful
  // stringification for a `Symbol` key without throwing. An accidental
  // object still stringifies via its own `toString`, matching AngularJS.
  const primitive = value as string | number | boolean | bigint | symbol;
  return String(primitive);
}

function ngOptionsFactory($exceptionHandler: ExceptionHandler): DirectiveFactoryReturn {
  const link: LinkFn = (scope, element, attrs, controllers) => {
    const { select: selectCtrl, model: modelCtrl } = asSelectAndModel(controllers);
    if (selectCtrl === null || modelCtrl === null) {
      return;
    }

    const optionsExp = attrs[NG_OPTIONS_NAME];
    if (typeof optionsExp !== 'string') {
      return;
    }

    let descriptor: NgOptionsDescriptor;
    try {
      descriptor = parseNgOptions(optionsExp);
    } catch (err: unknown) {
      invokeExceptionHandler($exceptionHandler, err, '$compile');
      return;
    }

    const selectElement = element as HTMLSelectElement;

    // Take over option management from the plain `option` directive.
    selectCtrl.optionsInterface = true;

    // key → contributed model value, rebuilt on every collection change.
    let options: GeneratedOption[] = [];
    let byKey = new Map<string, GeneratedOption>();

    // An author-supplied placeholder `<option value="">` in the template
    // survives option regeneration (AngularJS's "empty option") — it is
    // selected for a `null` / `undefined` model and reads back as `null`.
    const emptyOption = ((): HTMLOptionElement | null => {
      for (const option of Array.from(selectElement.options)) {
        if (option.value === '') {
          return option;
        }
      }
      return null;
    })();

    // The synthetic "unknown option" shown when the model matches no
    // generated option and no empty option exists (AngularJS parity — a
    // mismatched model must not silently leave a stale selection).
    const unknownOption = document.createElement('option');
    unknownOption.value = '?';
    unknownOption.textContent = '';

    function removeUnknownOption(): void {
      if (unknownOption.parentNode !== null) {
        unknownOption.parentNode.removeChild(unknownOption);
      }
    }

    /**
     * Render the current model value onto the DOM selection. A single
     * select matches ONE option key; a `multiple` select matches many.
     */
    function writeValue(value: unknown): void {
      if (selectCtrl === null || modelCtrl === null) {
        return;
      }
      if (selectCtrl.multiple) {
        const wanted = Array.isArray(value) ? value : [];
        const wantedKeys = new Set<string>();
        for (const item of wanted) {
          const key = keyForValue(item);
          if (key !== null) {
            wantedKeys.add(key);
          }
        }
        for (const option of Array.from(selectElement.options)) {
          option.selected = wantedKeys.has(option.value);
        }
        return;
      }
      const matchKey = keyForValue(value);
      if (matchKey !== null) {
        removeUnknownOption();
        selectElement.value = matchKey;
        return;
      }
      if ((value === null || value === undefined) && emptyOption !== null) {
        removeUnknownOption();
        selectElement.value = '';
        return;
      }
      // No generated option matches — show the synthetic unknown option.
      if (unknownOption.parentNode === null) {
        selectElement.insertBefore(unknownOption, selectElement.firstChild);
      }
      selectElement.value = '?';
    }

    /** Read the DOM selection back to the real model value(s). */
    function readValue(): unknown {
      if (selectCtrl === null) {
        return undefined;
      }
      if (selectCtrl.multiple) {
        const selected: unknown[] = [];
        for (const option of Array.from(selectElement.options)) {
          if (option.selected) {
            const generated = byKey.get(option.value);
            if (generated !== undefined) {
              selected.push(generated.value);
            }
          }
        }
        return selected;
      }
      const generated = byKey.get(selectElement.value);
      if (generated !== undefined) {
        return generated.value;
      }
      if (selectElement.value === '' && emptyOption !== null) {
        // The author-supplied placeholder is selected — model is `null`.
        return null;
      }
      return undefined;
    }

    /**
     * The generated option key matching `value`. With `track by`, matching
     * is by the track-by key evaluated on the candidate value (a fresh
     * object with the same identity still matches — AngularJS parity);
     * otherwise by strict value equality.
     */
    function keyForValue(value: unknown): string | null {
      if (descriptor.trackBy !== undefined) {
        const scopeRecord = scope as unknown as Record<string, unknown>;
        const trackKey = safeString(descriptor.trackBy(scopeRecord, { [descriptor.valueName]: value }));
        return byKey.has(trackKey) ? trackKey : null;
      }
      for (const option of options) {
        if (option.value === value) {
          return option.key;
        }
      }
      return null;
    }

    // Route the select's read / write through this directive's option list.
    selectCtrl.ngOptionsHooks = { readValue, writeValue };

    /** Rebuild the option descriptor list from the current collection. */
    function buildOptions(collection: unknown): GeneratedOption[] {
      const built: GeneratedOption[] = [];
      const seenKeys = new Set<string>();
      for (const [key, value] of enumerate(collection)) {
        const locals = itemLocals(descriptor, value, key);
        const scopeRecord = scope as unknown as Record<string, unknown>;
        const optionValue = descriptor.select(scopeRecord, locals);
        const label = descriptor.label(scopeRecord, locals);
        const group = descriptor.group !== undefined ? descriptor.group(scopeRecord, locals) : undefined;
        const disabled = descriptor.disable !== undefined ? Boolean(descriptor.disable(scopeRecord, locals)) : false;

        // The synthetic DOM key: track-by result (stable identity) when
        // present, else the array index / object property key.
        const optionKey =
          descriptor.trackBy !== undefined ? safeString(descriptor.trackBy(scopeRecord, locals)) : safeString(key);
        // Guard against a track-by collision by disambiguating.
        let uniqueKey = optionKey;
        let suffix = 0;
        while (seenKeys.has(uniqueKey)) {
          suffix++;
          uniqueKey = `${optionKey}:${String(suffix)}`;
        }
        seenKeys.add(uniqueKey);

        built.push({
          key: uniqueKey,
          value: optionValue,
          label: label === undefined || label === null ? '' : safeString(label),
          group: group === undefined || group === null ? undefined : safeString(group),
          disabled,
        });
      }
      return built;
    }

    /** Replace the `<select>`'s DOM options with the generated list. */
    function renderOptions(): void {
      // Clear existing children (options + optgroups).
      while (selectElement.firstChild !== null) {
        selectElement.removeChild(selectElement.firstChild);
      }

      // The author-supplied placeholder survives regeneration, first.
      if (emptyOption !== null) {
        selectElement.appendChild(emptyOption);
      }

      const groupContainers = new Map<string, HTMLOptGroupElement>();
      for (const generated of options) {
        const optionEl = document.createElement('option');
        optionEl.value = generated.key;
        optionEl.textContent = generated.label;
        optionEl.disabled = generated.disabled;

        if (generated.group !== undefined) {
          let container = groupContainers.get(generated.group);
          if (container === undefined) {
            container = document.createElement('optgroup');
            container.label = generated.group;
            groupContainers.set(generated.group, container);
            selectElement.appendChild(container);
          }
          container.appendChild(optionEl);
        } else {
          selectElement.appendChild(optionEl);
        }
      }
    }

    // Regenerate options whenever the collection changes, then re-render
    // the current model onto the fresh selection.
    scope.$watchCollection(descriptor.collection, (collection) => {
      options = buildOptions(collection);
      byKey = new Map(options.map((option) => [option.key, option]));
      renderOptions();
      modelCtrl.$render();
    });

    // Native change → model, routed through the select controller's seam.
    const listener = () => {
      selectCtrl.selectValueChanged();
    };
    selectElement.addEventListener('change', listener);
    scope.$on('$destroy', () => {
      selectElement.removeEventListener('change', listener);
    });
  };

  return {
    restrict: 'A',
    require: ['^select', '?ngModel'],
    link,
  };
}

/**
 * DI-annotated `ngOptions` directive. Injects `$exceptionHandler` so a
 * malformed grammar routes through it. Registered on `ngModule`.
 */
export const ngOptionsDirective: DirectiveFactory = ['$exceptionHandler', ngOptionsFactory];
