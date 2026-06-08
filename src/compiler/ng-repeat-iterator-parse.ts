/**
 * `parseIteratorExpression` — module-private parser for the right-hand
 * side of `ng-repeat` (spec 028 Slice 1 / technical-considerations §2.1).
 *
 * The directive's `attrs.ngRepeat` value follows the AngularJS-canonical
 * grammar:
 *
 * ```
 * <iterator> in <collection> [as <alias>] [track by <expr>]
 * ```
 *
 * where `<iterator>` is either a single identifier (`item`) or a
 * parenthesized tuple (`(key, value)`). Both `as <alias>` and
 * `track by <expr>` are independently optional, but when both appear the
 * order is fixed (`as` precedes `track by`) — a misordered expression is
 * malformed and surfaces {@link NgRepeatBadIteratorExpressionError}.
 *
 * **Two-stage parse.** The top-level regex
 *
 * ```
 * ^\s*([\s\S]+?)\s+in\s+([\s\S]+?)(?:\s+as\s+([\s\S]+?))?(?:\s+track\s+by\s+([\s\S]+?))?\s*$
 * ```
 *
 * splits the raw input into four capture groups:
 *
 *  1. The iterator LHS (`item` or `(key, value)`).
 *  2. The collection sub-expression (string passed verbatim to
 *     `parse()` from `@parser/index`).
 *  3. The optional alias identifier.
 *  4. The optional `track by` sub-expression (string passed verbatim
 *     to `parse()`).
 *
 * Failure to match → {@link NgRepeatBadIteratorExpressionError}. The
 * iterator LHS is then re-parsed against a narrower regex to
 * discriminate the single-identifier and `(key, value)` forms.
 *
 * **Identifier validity.** All identifier-shaped tokens (the item name,
 * the key + value names in the tuple form, the alias name) are
 * validated against the shared `IDENT_RE` from `@controller/controller.ts`
 * — the single source of truth for the conservative
 * `^[A-Za-z_$][\w$]*$` JavaScript-identifier rule used across the
 * compiler / controller surfaces. A miss surfaces
 * {@link NgRepeatBadIdentifierError}.
 *
 * **Alias validity.** The alias must (a) match `IDENT_RE` AND (b) NOT
 * collide with the iterator's `keyIdent` / `valueIdent` declared in the
 * same expression NOR with any of the six framework-published per-row
 * locals (`$index`, `$first`, `$last`, `$middle`, `$even`, `$odd`). A
 * collision surfaces {@link NgRepeatBadAliasError}. The framework
 * deliberately validates collisions up front rather than letting the
 * scope's read path silently pick one binding over the other.
 *
 * **Sub-expression parsing.** The `<collection>` string and the
 * optional `<track by>` string are passed through the project's own
 * expression `parse()` — they support the full expression grammar
 * including filter chains (`todos | filter:q`), method calls
 * (`todo.identityKey()`), and property paths (`todo.metadata.id`). A
 * `parse()` failure bubbles up unchanged from this slice — the
 * parser's own error classes carry the diagnostic; wrapping is
 * deliberately deferred.
 *
 * **Module-private, not registered.** This file ships the parser as a
 * `function export` only; there is no module registration, no
 * directive factory, no DI wiring in this slice. The `ng-repeat`
 * directive (Slice 3) is the sole consumer.
 *
 * @example Basic array iteration
 * ```ts
 * parseIteratorExpression('todo in todos');
 * // → {
 * //     keyIdent: null,
 * //     valueIdent: 'todo',
 * //     collectionExpr: <ExpressionFn for 'todos'>,
 * //     aliasIdent: null,
 * //     trackByExpr: null,
 * //   }
 * ```
 *
 * @example Object iteration with track-by
 * ```ts
 * parseIteratorExpression('(name, age) in people track by name');
 * // → {
 * //     keyIdent: 'name',
 * //     valueIdent: 'age',
 * //     collectionExpr: <ExpressionFn for 'people'>,
 * //     aliasIdent: null,
 * //     trackByExpr: <ExpressionFn for 'name'>,
 * //   }
 * ```
 *
 * @example Filtered list with alias publication
 * ```ts
 * parseIteratorExpression('todo in todos | filter:q as visible track by todo.id');
 * // → {
 * //     keyIdent: null,
 * //     valueIdent: 'todo',
 * //     collectionExpr: <ExpressionFn for 'todos | filter:q'>,
 * //     aliasIdent: 'visible',
 * //     trackByExpr: <ExpressionFn for 'todo.id'>,
 * //   }
 * ```
 */

import { IDENT_RE } from '@controller/controller';
import { parse } from '@parser/index';
import type { ExpressionFn } from '@parser/parse-types';

import { NgRepeatBadAliasError, NgRepeatBadIdentifierError, NgRepeatBadIteratorExpressionError } from './compile-error';

/**
 * Top-level grammar for `attrs.ngRepeat`. The four capture groups, in
 * order, are `iteratorLhs`, `collectionExpr`, `aliasIdent` (optional),
 * `trackByExpr` (optional). `[\s\S]` (rather than `.`) is used so the
 * non-greedy bodies tolerate newlines in pre-formatted templates — a
 * tiny robustness win.
 */
const ITERATOR_EXPRESSION_RE =
  /^\s*([\s\S]+?)\s+in\s+([\s\S]+?)(?:\s+as\s+([\s\S]+?))?(?:\s+track\s+by\s+([\s\S]+?))?\s*$/;

/**
 * LHS sub-regex for the `(key, value)` tuple form. The
 * `[$\w]+` character class is wider than `IDENT_RE` on purpose: this
 * regex performs the SHAPE detection (parenthesized tuple vs. bare
 * identifier); the captured `keyIdent` / `valueIdent` are then
 * re-validated through `IDENT_RE` so the same identifier rule applies
 * regardless of the LHS form. Keeping shape detection and
 * identifier validation in separate stages produces a clean error
 * message per failure mode.
 */
const TUPLE_LHS_RE = /^\(\s*([$\w]+)\s*,\s*([$\w]+)\s*\)$/;

/**
 * The six framework-published per-row variables forbidden as alias
 * names. Locked in `as const` so the array element type narrows to the
 * literal union — the `aliasIdent` validation below benefits from the
 * narrowing at type-check time.
 */
const RESERVED_ALIAS_NAMES = ['$index', '$first', '$last', '$middle', '$even', '$odd'] as const;

/**
 * Discriminated record returned by {@link parseIteratorExpression}.
 *
 * `keyIdent` is non-null exclusively for the `(key, value) in object`
 * LHS form — the array-iteration form returns `keyIdent: null` with
 * `valueIdent` carrying the single item identifier. `collectionExpr`
 * is the parsed expression returned by `parse()` ready for
 * `scope.$watchCollection` consumption. `aliasIdent` and
 * `trackByExpr` are `null` when their respective optional clauses
 * were omitted from the raw input.
 */
export interface ParsedIteratorExpression {
  /** Key identifier from the `(key, value)` tuple form; `null` for the single-identifier form. */
  readonly keyIdent: string | null;
  /** Per-row item identifier — always present. The single-identifier form's item name; the tuple form's value name. */
  readonly valueIdent: string;
  /** Compiled collection expression — produced by `parse()` from `@parser/index`. */
  readonly collectionExpr: ExpressionFn;
  /** Optional alias identifier from the `as ALIAS` clause; `null` when absent. */
  readonly aliasIdent: string | null;
  /** Optional compiled `track by` expression; `null` when the clause is absent. */
  readonly trackByExpr: ExpressionFn | null;
}

/**
 * Validate an identifier-shaped token against `IDENT_RE`. Throws
 * {@link NgRepeatBadIdentifierError} on miss, carrying both the
 * offending token and the raw `ng-repeat` expression for context.
 */
function assertIdentifier(name: string, rawExpression: string): void {
  if (!IDENT_RE.test(name)) {
    throw new NgRepeatBadIdentifierError(name, rawExpression);
  }
}

/**
 * Split the matched LHS string into a `{ keyIdent, valueIdent }` pair.
 * Dispatches on shape: a `(key, value)` parenthesized tuple takes the
 * two-identifier branch; anything else is validated as a single bare
 * identifier. Identifier validity is enforced in both branches via
 * `assertIdentifier`.
 */
function parseIteratorLhs(rawLhs: string, rawExpression: string): { keyIdent: string | null; valueIdent: string } {
  const tupleMatch = TUPLE_LHS_RE.exec(rawLhs);
  if (tupleMatch !== null) {
    const keyIdent = tupleMatch[1];
    const valueIdent = tupleMatch[2];
    // Defensive: TUPLE_LHS_RE's groups 1 and 2 are non-optional but the
    // regex's exec typing still admits `undefined` in the tuple. The
    // runtime guard keeps the narrowing honest if the regex is ever
    // relaxed.
    if (keyIdent === undefined || valueIdent === undefined) {
      throw new NgRepeatBadIteratorExpressionError(rawExpression);
    }
    assertIdentifier(keyIdent, rawExpression);
    assertIdentifier(valueIdent, rawExpression);
    return { keyIdent, valueIdent };
  }
  // Bare single-identifier form. Trim any incidental surrounding
  // whitespace the outer regex's non-greedy capture preserved.
  const single = rawLhs.trim();
  assertIdentifier(single, rawExpression);
  return { keyIdent: null, valueIdent: single };
}

/**
 * Validate the alias identifier against `IDENT_RE` AND the collision
 * rules. Throws {@link NgRepeatBadAliasError} on any failure. Pure
 * function — does not mutate the parsed record.
 */
function assertAlias(aliasIdent: string, keyIdent: string | null, valueIdent: string, rawExpression: string): void {
  if (!IDENT_RE.test(aliasIdent)) {
    throw new NgRepeatBadAliasError(aliasIdent, rawExpression);
  }
  if (aliasIdent === valueIdent) {
    throw new NgRepeatBadAliasError(aliasIdent, rawExpression);
  }
  if (keyIdent !== null && aliasIdent === keyIdent) {
    throw new NgRepeatBadAliasError(aliasIdent, rawExpression);
  }
  for (const reserved of RESERVED_ALIAS_NAMES) {
    if (aliasIdent === reserved) {
      throw new NgRepeatBadAliasError(aliasIdent, rawExpression);
    }
  }
}

/**
 * Parse the raw `ng-repeat` expression into the four sub-components
 * described in the module's file-level TSDoc. See the per-class TSDoc
 * on {@link NgRepeatBadIteratorExpressionError},
 * {@link NgRepeatBadIdentifierError}, and {@link NgRepeatBadAliasError}
 * for the exact failure modes.
 */
export function parseIteratorExpression(raw: string): ParsedIteratorExpression {
  const match = ITERATOR_EXPRESSION_RE.exec(raw);
  if (match === null) {
    throw new NgRepeatBadIteratorExpressionError(raw);
  }
  const [, lhsRaw, collectionRaw, aliasRaw, trackByRaw] = match;
  // Defensive: groups 1 and 2 are non-optional in the regex but the
  // exec result's tuple admits `undefined` slots. Bail to the
  // top-level error class if the regex is ever relaxed.
  if (lhsRaw === undefined || collectionRaw === undefined) {
    throw new NgRepeatBadIteratorExpressionError(raw);
  }

  const { keyIdent, valueIdent } = parseIteratorLhs(lhsRaw, raw);

  // Both sub-expressions are parsed via the project's own `parse()`.
  // A parse failure throws from `parse()` itself — its own error
  // classes carry the diagnostic; this slice does NOT wrap them.
  const collectionExpr = parse(collectionRaw);

  let aliasIdent: string | null = null;
  if (aliasRaw !== undefined) {
    const aliasTrimmed = aliasRaw.trim();
    assertAlias(aliasTrimmed, keyIdent, valueIdent, raw);
    aliasIdent = aliasTrimmed;
  }

  let trackByExpr: ExpressionFn | null = null;
  if (trackByRaw !== undefined) {
    trackByExpr = parse(trackByRaw);
  }

  return {
    keyIdent,
    valueIdent,
    collectionExpr,
    aliasIdent,
    trackByExpr,
  };
}
