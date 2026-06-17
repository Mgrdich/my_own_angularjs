/**
 * Per-node directive matching engine.
 *
 * Slice 2 of spec 017 handles the E (Element) and A (Attribute)
 * restrict modes; Slice 4 adds the `terminal: true` cutoff applied
 * after the priority sort. Slice 6 adds C (Class) matching with both
 * AngularJS-canonical class syntaxes (bare `class="my-dir"` and
 * class-with-value `class="my-dir: value;"`). Slice 7 widens the
 * collector to accept `Comment` nodes too — the M (Comment) restrict
 * mode parses `<!-- directive: name value -->` syntax and produces
 * the same priority-sorted, terminal-aware matched list as the
 * Element path.
 *
 * The collector returns the priority-sorted list of matched
 * directives (with the terminal cutoff applied) plus a populated
 * {@link AttributesImpl} that is shared across every directive on
 * the element (compile, pre-link, post-link) — matching AngularJS
 * 1.x semantics.
 *
 * Class-matching parse (FS §2.15):
 *   - Read `element.className`. Empty → skip the class pass.
 *   - Split on `;` to handle multiple class-value segments in a
 *     single `class` attribute (`my-dir: a; other: b;`).
 *   - Within each segment, look for the first `:` to split name
 *     from value. No `:` → tokenize the segment on whitespace and
 *     treat each token as a bare boolean class. With `:` → name is
 *     left of the colon, value is right (both trimmed).
 *   - For each parsed (name, value) pair: normalize the name via
 *     `directiveNormalize`, look up directives, and append any whose
 *     `restrict` includes `'C'`. When at least one directive matches,
 *     populate `attrs[normalized] = value` (empty string for the bare
 *     form) and `attrs.$attr[normalized] = originalClassName` (the
 *     un-normalized class spelling, including `data-` / `x-` prefix).
 *
 * The class pass is purely ADDITIVE — `attrs.class` was already set
 * by the attribute pass to the full original `class` attribute
 * string. The new entries (`attrs.myDir`, etc.) are independent
 * "as-if-attribute" views of each matched class.
 *
 * Terminal short-circuit (FS §2.7):
 *   - Walk the priority-DESCENDING sorted list left-to-right.
 *   - The FIRST directive with `terminal === true` records
 *     `terminalPriority = directive.priority`.
 *   - Any subsequent directive with `priority < terminalPriority`
 *     is dropped from the matched list. Same-priority directives
 *     are KEPT.
 *   - The terminal directive itself is INCLUDED.
 *   - Multiple terminal directives at different priorities: only
 *     the FIRST (highest-priority) cutoff applies — subsequent
 *     terminal directives at lower priorities are already excluded
 *     by the higher cutoff and have no additional effect.
 *   - Terminal short-circuit affects only the same node — child
 *     nodes still compile their own directives normally (enforced
 *     by the tree walker, not here).
 */

import { AttributesImpl } from './attributes';
import { directiveNormalize } from './directive-normalize';
import type { Directive } from './directive-types';
import { isNgManagedElement, NG_ELEMENT_TRANSCLUDED } from './element-slots';
import { isElement } from './node-guards';

/**
 * Narrow writable view onto an {@link AttributesImpl} — used by the
 * class-matching pass to add per-class entries without widening the
 * public read-only surface in `directive-types.ts`. The constructor
 * already uses indexed assignment internally; this cast just exposes
 * the same shape to the collector.
 */
type WritableAttrs = Record<string, string | undefined>;

/**
 * Comment-directive parser regex per FS §2.14:
 *
 *   - `^\s*` / `\s*$` — leading/trailing whitespace inside the
 *     comment text is tolerated.
 *   - `directive:` — case-SENSITIVE prefix (no `i` flag) so
 *     `<!-- DIRECTIVE: my-dir -->` does NOT match.
 *   - `\s*` after the colon — whitespace around the colon is
 *     optional, so `<!-- directive:my-dir -->` matches too.
 *   - `(\S+)` — the kebab-case directive name (any non-whitespace).
 *   - `\s*(.*?)\s*$` — optional trailing value with surrounding
 *     whitespace trimmed.
 */
const COMMENT_DIRECTIVE_REGEX = /^\s*directive:\s*(\S+)\s*(.*?)\s*$/;

/**
 * Collect directives that match `node` under the E, A, C, and M
 * restrict modes, sort them by descending priority (registration
 * order tie-breaks ascending), and return the sorted list together
 * with a freshly-built {@link AttributesImpl} for the node.
 *
 * For an `Element`, all four passes (E, A, C, then sort + terminal
 * cutoff) run. For a `Comment`, only the M (Comment) pass runs —
 * comments have no attributes or classes to walk, so the entire
 * Element path short-circuits.
 *
 * The same {@link AttributesImpl} is reused across every directive
 * on the node — compile, pre-link, and post-link all see the
 * same instance.
 */
export function collectDirectives(
  node: Element | Comment,
  getDirectivesByName: (name: string) => Directive[],
): { directives: Directive[]; attrs: AttributesImpl; multiElementStarts: Set<string> } {
  const attrs = new AttributesImpl(node);
  const matched: Directive[] = [];
  // Base directive names matched via the ranged `<base>-start` form
  // (spec 033). The compiler reads this set to decide whether to build a
  // node range before the transclude pre-pass.
  const multiElementStarts = new Set<string>();
  const writableAttrs = attrs as unknown as WritableAttrs;

  if (isElement(node)) {
    const element = node;

    // E (Element) — match by tag name.
    const elementName = directiveNormalize(element.tagName.toLowerCase());
    for (const directive of getDirectivesByName(elementName)) {
      if (directive.restrict.includes('E')) {
        matched.push(directive);
      }
    }

    // A (Attribute) — match by each attribute name.
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes.item(i);
      if (attr === null) {
        continue;
      }
      const normalized = directiveNormalize(attr.name);
      let matchedThisAttr = false;
      for (const directive of getDirectivesByName(normalized)) {
        if (directive.restrict.includes('A')) {
          matched.push(directive);
          matchedThisAttr = true;
        }
      }
      // Spec 033 — ranged `<base>-start` recognition. The bare
      // `<base>` (handled above) is the single-element form and is
      // unchanged. Only when the normalized attribute name ends in
      // `Start` AND no plain directive matched it do we probe for a
      // `multiElement` base directive: `ngRepeatStart` → base `ngRepeat`.
      // The matched base directive(s) are added to the matched list with
      // the directive's expression taken from the `-start` attribute's
      // VALUE, exposed as `attrs[base]` (so `ng-repeat-start="i in items"`
      // makes `attrs.ngRepeat === 'i in items'`). The `<base>End` name is
      // recognized as part of the family but matches no directive on its
      // own — it is purely the range terminator scanned in
      // `multi-element-range.ts`.
      if (!matchedThisAttr && normalized.length > 5 && normalized.endsWith('Start')) {
        const base = normalized.slice(0, -'Start'.length);
        let anyRanged = false;
        for (const directive of getDirectivesByName(base)) {
          if (directive.multiElement && directive.restrict.includes('A')) {
            matched.push(directive);
            anyRanged = true;
          }
        }
        if (anyRanged) {
          multiElementStarts.add(base);
          writableAttrs[base] = attr.value;
          attrs.$attr[base] = attr.name;
        }
      }
    }

    // C (Class) — parse `element.className` and match each token.
    // Runs BEFORE the terminal cutoff (which is applied below after
    // the priority sort) and AFTER the attribute pass (so `attrs.class`
    // already holds the full original `class` string).
    collectClassDirectives(element, attrs, matched, getDirectivesByName);
  } else {
    // M (Comment) — parse the comment text against the canonical
    // `<!-- directive: name value -->` syntax. Falls back to an empty
    // matched list when the comment is non-directive (the most common
    // case in practice). Comments contribute neither E/A/C matches
    // nor any DOM attributes — the entire Element path is skipped.
    collectCommentDirectives(node, attrs, matched, getDirectivesByName);
  }

  // On the re-entrant master pass of an element-form transclude (spec
  // 027 Slice 2 / spec 032 Slice 1), the host carries the
  // `NG_ELEMENT_TRANSCLUDED` stamp naming the winning structural
  // directive. The same-element structural conflict (if any) was already
  // reported on the OUTER pass; this pass only compiles the host as the
  // CONTENT master. The winning directive is excluded downstream by
  // `compile.ts`'s re-entrancy guard, but a SECOND transclude-declaring
  // directive on the same host (e.g. `ng-repeat` alongside `ng-if`)
  // would otherwise survive here, re-fire transclude capture, and recurse
  // infinitely. Drop every NON-winner transclude directive on re-entry
  // so the content master compiles with no competing structural directive.
  const reentryStamp = isElement(node) && isNgManagedElement(node) ? node[NG_ELEMENT_TRANSCLUDED] : undefined;
  const sanitized =
    reentryStamp === undefined ? matched : matched.filter((d) => d.transclude === undefined || d.name === reentryStamp);

  return {
    directives: applySortAndTerminalCutoff(sanitized, reentryStamp !== undefined),
    attrs,
    multiElementStarts,
  };
}

/**
 * Sort a freshly-collected `matched` list by descending priority
 * (registration-order tie-break ascending) and apply the
 * `terminal: true` short-circuit per FS §2.7.
 *
 * Shared helper used by both the Element and Comment branches of
 * `collectDirectives`. Keeps the priority + terminal contract
 * uniform regardless of how the directives were matched.
 *
 * **Spec 032 Slice 2 — same-element structural conflict exception.**
 * The terminal cutoff would normally drop EVERY directive below the
 * terminal's priority. That silently hid a structural-directive
 * conflict: `<div ng-if="a" ng-repeat="x in xs">` sorts `ng-repeat`
 * (1000, terminal) above `ng-if` (600), so the cutoff dropped `ng-if`
 * at collection time and the documented `MultipleTranscludeDirectivesError`
 * in `compile.ts` never fired (the spec-027 known gap). To close it,
 * a SECOND directive declaring `transclude` (`!== undefined`) survives
 * the cutoff when a higher-priority transclude-declaring directive is
 * ALREADY in the kept list — so both reach `compile.ts`'s multi-
 * transclude guard, which raises the error and strips the second's
 * transclude.
 *
 * The exception is gated STRICTLY on `transclude !== undefined` — NOT
 * on `terminal` — so an ordinary lower-priority directive below the
 * cutoff is still dropped exactly as before (the spec-017
 * `terminal.test.ts` contract is unaffected). Priority-DESCENDING
 * ordering is preserved.
 *
 * `suppressConflictKeep` disables the exception on the re-entrant
 * element-transclude master pass: the conflict was already reported on
 * the outer pass, and keeping a second transclude directive there would
 * recurse infinitely. See {@link collectDirectives} for the stamp check.
 */
function applySortAndTerminalCutoff(matched: readonly Directive[], suppressConflictKeep: boolean) {
  const sorted = matched.slice().sort((a, b) => {
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }
    return a.index - b.index;
  });

  // Apply terminal cutoff. The list is priority-DESCENDING, so once
  // we encounter anything below the cutoff, every subsequent ordinary
  // entry is also below it. We can no longer `break` outright because a
  // below-cutoff `transclude`-declaring directive must survive to
  // surface the same-element structural conflict (see the JSDoc above);
  // ordinary below-cutoff directives are skipped via `continue`.
  let terminalPriority = -Infinity;
  let transcludeKept = false;
  const directives: Directive[] = [];
  for (const directive of sorted) {
    if (directive.priority < terminalPriority) {
      // Narrow exception (spec 032 Slice 2): keep a second transclude
      // directive so the conflict reaches `compile.ts`'s guard. Every
      // other below-cutoff directive is dropped as before. Suppressed on
      // the re-entrant element-transclude master pass to avoid recursion.
      if (directive.transclude !== undefined && transcludeKept && !suppressConflictKeep) {
        directives.push(directive);
      }
      continue;
    }
    directives.push(directive);
    if (directive.transclude !== undefined) {
      transcludeKept = true;
    }
    if (directive.terminal && directive.priority > terminalPriority) {
      terminalPriority = directive.priority;
    }
  }
  return directives;
}

/**
 * Parse `comment.textContent` against the AngularJS-canonical
 * `<!-- directive: name value -->` syntax. On a successful match,
 * normalize the captured name, look up directives, and append every
 * match whose `restrict` includes `'M'`. When at least one directive
 * matched, populate `attrs[normalized]` with the trimmed trailing
 * value (or `''` when absent).
 *
 * Acceptance criteria locked here (FS §2.14):
 *   - `<!-- directive: my-dir -->` matches; `attrs.myDir === ''`.
 *   - Trailing value `<!-- directive: my-dir hello world -->` →
 *     `attrs.myDir === 'hello world'`.
 *   - No-space-after-colon `<!-- directive:my-dir hello -->` matches.
 *   - Leading/trailing whitespace inside the comment text is
 *     tolerated (`<!--   directive: my-dir   -->`).
 *   - Non-directive comment `<!-- not a directive -->` does NOT
 *     match — the regex has no `i` flag and requires the literal
 *     `directive:` prefix.
 *   - `<!-- DIRECTIVE: my-dir -->` does NOT match (case-sensitive on
 *     the prefix, matches AngularJS).
 *   - Without `'M'` in the directive's `restrict`, the comment match
 *     is filtered out at the `restrict.includes('M')` check.
 */
function collectCommentDirectives(
  comment: Comment,
  attrs: AttributesImpl,
  matched: Directive[],
  getDirectivesByName: (name: string) => Directive[],
): void {
  // `Comment.textContent` is typed as `string` (never null) in the
  // standard DOM lib, so no fallback needed.
  const text = comment.textContent;
  const match = COMMENT_DIRECTIVE_REGEX.exec(text);
  if (match === null) {
    return;
  }
  const rawName = match[1];
  if (rawName === undefined) {
    return;
  }
  const trailingValue = (match[2] ?? '').trim();
  const normalized = directiveNormalize(rawName);

  let anyMatched = false;
  for (const directive of getDirectivesByName(normalized)) {
    if (directive.restrict.includes('M')) {
      matched.push(directive);
      anyMatched = true;
    }
  }
  if (anyMatched) {
    const writableAttrs = attrs as unknown as WritableAttrs;
    writableAttrs[normalized] = trailingValue;
    attrs.$attr[normalized] = rawName;
  }
}

/**
 * Parse `element.className` and append every C-restricted directive
 * to `matched`. For each matched class name, populate
 * `attrs[normalized]` with the parsed value (empty string for the
 * bare form, trimmed value for the `name: value;` form) and record
 * the original class spelling in `attrs.$attr[normalized]`.
 *
 * AngularJS supports two class syntaxes side-by-side:
 *   - **Bare:** `class="my-dir"` → name `my-dir`, value `''`.
 *   - **Class-with-value:** `class="my-dir: hello;"` → name `my-dir`,
 *     value `hello` (whitespace tolerated; the value runs from `:`
 *     to the next `;` or end-of-string).
 *
 * Multiple class-value pairs in a single attribute are split on
 * `;`, e.g. `class="my-dir: a; other: b;"` parses two pairs.
 *
 * The two-pass `split(';')` then `indexOf(':')` algorithm is NOT
 * AngularJS's exact char-by-char regex scanner, but produces the
 * same observable behavior for every FS §2.15 acceptance criterion.
 * If a future test surfaces a divergence, document it as a deviation.
 */
function collectClassDirectives(
  element: Element,
  attrs: AttributesImpl,
  matched: Directive[],
  getDirectivesByName: (name: string) => Directive[],
): void {
  const className = element.className;
  if (className.length === 0) {
    return;
  }

  const writableAttrs = attrs as unknown as WritableAttrs;

  for (const segment of className.split(';')) {
    const colonIdx = segment.indexOf(':');
    if (colonIdx === -1) {
      // No `:` in the segment — treat each whitespace-separated token
      // as a bare boolean class.
      for (const token of segment.split(/\s+/)) {
        if (token.length === 0) {
          continue;
        }
        recordClassMatch(token, '', attrs, writableAttrs, matched, getDirectivesByName);
      }
    } else {
      // `name: value` form. The name itself is a single token (no
      // embedded whitespace), so trimming both sides is sufficient.
      const name = segment.slice(0, colonIdx).trim();
      const value = segment.slice(colonIdx + 1).trim();
      if (name.length === 0) {
        continue;
      }
      recordClassMatch(name, value, attrs, writableAttrs, matched, getDirectivesByName);
    }
  }
}

/**
 * Look up directives for `originalName`, append every match whose
 * `restrict` includes `'C'`, and — when at least one matched —
 * populate the per-class `attrs` entries (`attrs[normalized]` and
 * `attrs.$attr[normalized]`).
 */
function recordClassMatch(
  originalName: string,
  value: string,
  attrs: AttributesImpl,
  writableAttrs: WritableAttrs,
  matched: Directive[],
  getDirectivesByName: (name: string) => Directive[],
): void {
  const normalized = directiveNormalize(originalName);
  let anyMatched = false;
  for (const directive of getDirectivesByName(normalized)) {
    if (directive.restrict.includes('C')) {
      matched.push(directive);
      anyMatched = true;
    }
  }
  if (anyMatched) {
    writableAttrs[normalized] = value;
    attrs.$attr[normalized] = originalName;
  }
}
