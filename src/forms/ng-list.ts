/**
 * `ngList` directive (spec 039 Slice 4 / FS §2.5,
 * technical-considerations §2.5).
 *
 * `<input ng-model="tags" ng-list>` transforms a delimited string in the
 * field into an **array** in the model (and back). It adds:
 *
 *  - a `$parser` (view → model) that splits the on-screen string on the
 *    delimiter, trims each part, and drops empty trailing parts — so
 *    `"a, b, c"` becomes `['a', 'b', 'c']`;
 *  - a `$formatter` (model → view) that joins an array back into a
 *    delimited string using a canonical `<delimiter> ` separator (the
 *    delimiter followed by a space, AngularJS parity).
 *
 * **Delimiter forms (AngularJS parity).** The `ng-list` attribute value is
 * the delimiter; an absent / empty value defaults to `,`. A value wrapped
 * in slashes (`/regex/`) is treated as a REGEXP delimiter for SPLITTING
 * (e.g. a `\s`-tolerant comma) — the join then uses the raw source between
 * the slashes as a literal separator plus a trailing space, matching upstream
 * (`ngList` joins with the trimmed original delimiter). A plain string
 * delimiter is trimmed for splitting so `ng-list=", "` and `ng-list=","`
 * behave alike.
 *
 * `require: 'ngModel'` — `ngList` only makes sense on an `ng-model`
 * control. Registered on `ngModule` only (DI-only) — reachable via
 * `injector.get('ngListDirective')`, NOT exported from the root barrel.
 */

import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from '@compiler/directive-types';

import { NgModelControllerImpl } from './ng-model-controller';

export const NG_LIST_NAME = 'ngList';

/**
 * The resolved split/join delimiter behavior for an `ng-list` value.
 * `split` is either a `RegExp` (from a `/…/` value) or a literal string;
 * `join` is the separator inserted between array elements when formatting.
 */
interface ListDelimiter {
  split: RegExp | string;
  join: string;
}

/**
 * Resolve the `ng-list` attribute value into split + join delimiters.
 * A `/…/` value is a regexp split (the source between the slashes); the
 * join uses the trimmed literal source plus a trailing space. A plain
 * value is trimmed for both; an absent / empty value defaults to `,`.
 */
function resolveDelimiter(raw: unknown): ListDelimiter {
  const value = typeof raw === 'string' ? raw : '';
  const regexMatch = /^\s*\/(.*)\/\s*$/.exec(value);
  if (regexMatch !== null && regexMatch[1] !== undefined) {
    const source = regexMatch[1];
    return { split: new RegExp(source), join: `${trimSeparatorForJoin(source)} ` };
  }
  const trimmed = value.trim() === '' ? ',' : value.trim();
  return { split: trimmed, join: `${trimmed} ` };
}

/**
 * Derive a human-friendly join separator from a regexp source. AngularJS
 * joins on the literal delimiter, not the regexp; for the common
 * `,\s*` / `\s*,\s*` sources we surface a bare `,`. Fallback: strip
 * regexp whitespace tokens, else use `,`.
 */
function trimSeparatorForJoin(source: string): string {
  const literal = source.replace(/\\s\*|\\s\+|\s/g, '');
  return literal === '' ? ',' : literal;
}

function asNgModel(controllers: unknown): NgModelControllerImpl | null {
  return controllers instanceof NgModelControllerImpl ? controllers : null;
}

function ngListFactory(): DirectiveFactoryReturn {
  const link: LinkFn = (_scope, _element, attrs, controllers) => {
    const ctrl = asNgModel(controllers);
    if (ctrl === null) {
      return;
    }

    const delimiter = resolveDelimiter(attrs[NG_LIST_NAME]);

    // View → model: split, trim, drop empties → array. An empty view value
    // yields `undefined` (an empty control has no list), matching upstream.
    ctrl.$parsers.push((viewValue: unknown): unknown => {
      // The listener feeds `element.value` (a string). A non-string /
      // empty view value has no list to split — yields `undefined`.
      if (typeof viewValue !== 'string' || viewValue === '') {
        return undefined;
      }
      const parts = viewValue.split(delimiter.split);
      const list: string[] = [];
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed !== '') {
          list.push(trimmed);
        }
      }
      return list;
    });

    // Model → view: join an array back into a delimited string. A
    // non-array model renders as-is (a defensive pass-through).
    ctrl.$formatters.push((modelValue: unknown): unknown => {
      if (Array.isArray(modelValue)) {
        return modelValue.join(delimiter.join);
      }
      return modelValue;
    });

    // An `ng-list` control is empty when its model is `undefined` / `null`
    // or an empty array (drives `ng-empty` / `required`).
    ctrl.$isEmpty = (value: unknown): boolean =>
      value === undefined || value === null || (Array.isArray(value) && value.length === 0);
  };

  return {
    restrict: 'A',
    require: 'ngModel',
    link,
  };
}

/**
 * DI-annotated `ngList` directive. Zero deps. Registered on `ngModule`.
 */
export const ngListDirective: DirectiveFactory = [ngListFactory];
