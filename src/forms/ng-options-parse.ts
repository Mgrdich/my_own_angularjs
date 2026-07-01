/**
 * `ngOptions` grammar parser (spec 039 Slice 4 / FS §2.5,
 * technical-considerations §2.5).
 *
 * Parses the AngularJS `ngOptions` expression grammar into a small
 * descriptor of compiled sub-expressions. The full grammar (AngularJS
 * `NG_OPTIONS_REGEXP` in `ngOptions.js`):
 *
 * ```
 * select [as label] [group by g] [disable when d]
 *   for (key,value) in collection [track by t]
 * ```
 *
 * Supported forms (all reduce to the same descriptor):
 *
 *  - `value for value in coll`                — value is both select + label
 *  - `item.name for item in coll`             — label expression
 *  - `item.id as item.name for item in coll`  — select (value) + label
 *  - `… group by item.group for …`            — optgroup grouping
 *  - `… disable when item.locked for …`       — per-option `disabled`
 *  - `… for (k, v) in objColl`                — object collection, key + value
 *  - `… track by item.id`                     — stable option keys
 *
 * The regex is ported verbatim from AngularJS so the exact same expressions
 * parse (and the same malformed expressions fail) — a malformed expression
 * routes {@link NgOptionsBadExpressionError} at link time.
 */

import { parse, type ExpressionFn } from '@parser/index';

/**
 * Thrown when an `ng-options` attribute value does not match the grammar.
 * Routed via `$exceptionHandler('$compile')` at link time; the directive
 * goes inert. Mirrors AngularJS's `ngOptions:iexp`.
 */
export class NgOptionsBadExpressionError extends Error {
  constructor(expression: string) {
    super(
      `Expected expression in the form of ` +
        `'_select_ (as _label_)? for (_key_,)?_value_ in _collection_' but got '${expression}'.`,
    );
    this.name = 'NgOptionsBadExpressionError';
  }
}

/**
 * The parsed `ngOptions` descriptor — compiled sub-expressions plus the
 * iterator variable names. Every expression is evaluated against a
 * per-item locals object exposing the item value under `valueName` (and
 * the key under `keyName` for object collections).
 */
export interface NgOptionsDescriptor {
  /** The `value` local name (the RHS of `for (k,v) in` or the bare `for value in`). */
  valueName: string;
  /** The `key` local name for object collections (`for (k, v) in obj`), else undefined. */
  keyName: string | undefined;
  /** Evaluates the collection against the scope. */
  collection: ExpressionFn;
  /** Per-item display label. */
  label: ExpressionFn;
  /** Per-item selected value (`_select_ as _label_`); defaults to the item value. */
  select: ExpressionFn;
  /** Per-item optgroup name, or undefined when there is no `group by`. */
  group: ExpressionFn | undefined;
  /** Per-item disabled flag, or undefined when there is no `disable when`. */
  disable: ExpressionFn | undefined;
  /** Per-item track-by key expression, or undefined (index / value keyed). */
  trackBy: ExpressionFn | undefined;
}

/**
 * Verbatim port of AngularJS's `NG_OPTIONS_REGEXP`. Capture groups:
 *
 *  1. select-as value expression (the `_select_` before `as`)
 *  2. label expression (after `as`, or the whole `for` LHS)
 *  3. group-by expression
 *  4. disable-when expression
 *  5. value name (bare `for value in` form)
 *  6. key name (parenthesized `for (key, value) in` form)
 *  7. value name (parenthesized `for (key, value) in` form)
 *  8. collection expression
 *  9. track-by expression
 */
const NG_OPTIONS_REGEXP =
  /^\s*([\s\S]+?)(?:\s+as\s+([\s\S]+?))?(?:\s+group\s+by\s+([\s\S]+?))?(?:\s+disable\s+when\s+([\s\S]+?))?\s+for\s+(?:([$\w][$\w]*)|(?:\(\s*([$\w][$\w]*)\s*,\s*([$\w][$\w]*)\s*\)))\s+in\s+([\s\S]+?)(?:\s+track\s+by\s+([\s\S]+?))?\s*$/;

/**
 * Parse an `ng-options` expression string into a {@link NgOptionsDescriptor}.
 * Throws {@link NgOptionsBadExpressionError} on a grammar mismatch.
 */
export function parseNgOptions(optionsExp: string): NgOptionsDescriptor {
  const match = NG_OPTIONS_REGEXP.exec(optionsExp);
  if (match === null) {
    throw new NgOptionsBadExpressionError(optionsExp);
  }

  // Group indices (per the regex above):
  //  [1] select-value, [2] label, [3] group by, [4] disable when,
  //  [5] bare value name, [6] key name, [7] value name (paren form),
  //  [8] collection, [9] track by.
  const selectAs = match[1];
  const labelExp = match[2];
  const groupExp = match[3];
  const disableExp = match[4];
  const bareValueName = match[5];
  const keyNameParen = match[6];
  const valueNameParen = match[7];
  const collectionExp = match[8];
  const trackByExp = match[9];

  if (collectionExp === undefined) {
    throw new NgOptionsBadExpressionError(optionsExp);
  }

  // The value/label duality (AngularJS parity):
  //  - `_select_ as _label_ for _value_ in …` — the SELECT value is
  //    `_select_` (match[1]); the LABEL is `_label_` (match[2]).
  //  - bare `_display_ for _value_ in …` — the LABEL is `_display_`
  //    (match[1]); the SELECT value is the ITERATED ITEM ITSELF
  //    (`valueName`), NOT the display expression. So
  //    `item.name for item in items` labels each option `item.name` but
  //    binds the whole `item` object as the model value.
  const valueName = valueNameParen ?? bareValueName;
  if (valueName === undefined) {
    throw new NgOptionsBadExpressionError(optionsExp);
  }
  const keyName = keyNameParen;

  const displayExp = selectAs;
  if (displayExp === undefined) {
    throw new NgOptionsBadExpressionError(optionsExp);
  }

  // With `as`: match[1] is the SELECT value, match[2] the LABEL.
  // Without `as`: match[1] is the LABEL and the SELECT value is the item
  // (`valueName`).
  const label = labelExp !== undefined ? parse(labelExp) : parse(displayExp);
  const select = labelExp !== undefined ? parse(displayExp) : parse(valueName);

  return {
    valueName,
    keyName,
    collection: parse(collectionExp),
    label,
    select,
    group: groupExp !== undefined ? parse(groupExp) : undefined,
    disable: disableExp !== undefined ? parse(disableExp) : undefined,
    trackBy: trackByExp !== undefined ? parse(trackByExp) : undefined,
  };
}
