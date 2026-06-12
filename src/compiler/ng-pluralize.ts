/**
 * `ngPluralize` — locale-aware pluralization directive (spec 029
 * Slices 2–4 / FS §2.1–§2.9,
 * technical-considerations §2.2–§2.5).
 *
 * `<ng-pluralize count="msgCount" when="{'0': 'No messages.', 'one':
 * 'One message.', 'other': '{} messages.'}"></ng-pluralize>` displays
 * the message variant that grammatically fits the current count,
 * keeping the text up to date as the count (and any embedded
 * `{{expr}}` bindings) change. All three FS §2.7 authoring forms are
 * supported: the element form, the attribute form
 * (`<span ng-pluralize count="…" when="…">` — `restrict: 'EA'`), and
 * per-key `when-…` attributes (`when-0="…"`, `when-one="…"`,
 * `when-minus-1="…"`) usable instead of — or combined with — the
 * `when` map.
 *
 * **Algorithm (link time).**
 *
 * 1. Read the RAW `attrs.count` (the count expression source string —
 *    the `Attributes` constructor stores `attr.value` verbatim), the
 *    raw `attrs.when`, and the raw `attrs.offset`; scan the enumerable
 *    keys of `attrs` for per-key `when-…` entries (see the scan rule
 *    below). LIVENESS RULE: the directive is live iff `count` is
 *    present and non-empty AND at least one message SOURCE exists —
 *    a non-empty `when` attribute OR at least one `when-…` attribute.
 *    Otherwise it is inert — blank output, NO watches installed, no
 *    error (upstream-lenient behavior). Note that a present-but-empty
 *    TABLE (`when="{}"`, or a non-object `when`) keeps the directive
 *    LIVE: presence of a source, not table contents, decides
 *    liveness — every valid count then takes the missing-rule report
 *    path (FS §2.9).
 * 2. `offset = parseFloat(attrs.offset)` when the attribute is present
 *    with non-empty text, else `0` (an empty `offset=""` counts as
 *    absent — mirrors upstream's `attr.offset || 0` and the step-1
 *    emptiness rule). A present-but-non-numeric offset routes
 *    {@link NgPluralizeBadOffsetError} via
 *    `invokeExceptionHandler($exceptionHandler, err, '$compile')` at
 *    link time and the directive goes inert — same early return as
 *    step 1 (blank, no watches, no DOM mutation) but LOUD: unlike the
 *    silent missing-`count`/`when` path, a present-but-broken offset
 *    is always an authoring mistake.
 * 3. Evaluate `scope.$eval(attrs.when)` EXACTLY ONCE to obtain the
 *    message map; a non-object result degrades to `{}`. Skipped when
 *    no `when` attribute is present (pure-attribute form). Then fold
 *    the scanned `when-…` attribute entries in ON TOP — a per-key
 *    attribute OVERRIDES a same-key `when`-map entry (FS §2.7: "the
 *    individual attribute wins").
 * 4. For each message string, rewrite every `{}` placeholder to an
 *    interpolation of the parenthesized count expression minus the
 *    parenthesized offset —
 *    `startSym + '(' + countExpr + ')-(' + offset + ')' + endSym` —
 *    using the service's `startSymbol()` / `endSymbol()` accessors (so
 *    custom interpolation delimiters work for free), then compile the
 *    rewritten message with `$interpolate(...)` EXACTLY ONCE. The
 *    parenthesization of BOTH operands is a documented micro-deviation
 *    from upstream's bare concatenation: the count side guards
 *    expressions like `a ? b : c` (which upstream mis-parses), and the
 *    offset side guards negative offsets — a bare emit of offset `-1`
 *    would produce the unparseable `(count)--1`, while
 *    `(count)-(-1)` evaluates correctly. Semantics for all
 *    upstream-legal inputs are identical: the placeholder shows
 *    count − offset.
 * 5. Install the PRIMARY `scope.$watch` on the count expression. On
 *    each fire, `count = parseFloat(String(newValue))`:
 *    - `NaN` → clear the text, deregister any active message watch,
 *      and report NOTHING (FS §2.8). A NaN that follows another NaN
 *      is a no-op (the `lastKey === null` guard — upstream's
 *      `lastCount` equivalent).
 *    - Otherwise resolve the message key: an exact `String(count)`
 *      match in the message table WINS; else
 *      `$locale.pluralCat(count - offset)` supplies the category (the
 *      spec-029 Slice 1 seam — swapped locales bring their own rules).
 *    - Key unchanged since the last fire → no-op (the SWITCHING
 *      guard — no watch churn, no double-writes).
 *    - Key changed → deregister the previous message watch; if the
 *      key has a message, install `scope.$watch(messageFn, write)`
 *      where `write` sets `element.textContent = value ?? ''` (the
 *      `ng-bind-template` shape) — embedded `{{expr}}` bindings
 *      inside the active message update through this watch for free;
 *      if the key has NO message, clear the text and route
 *      {@link NgPluralizeNoRuleDefinedError} via
 *      `invokeExceptionHandler($exceptionHandler, err, '$compile')`
 *      (the ng-repeat in-listener routing precedent) — ONE report per
 *      key transition, never per digest.
 *
 * **Exact-raw vs. category-offset asymmetry (FS §2.4).** Exact-number
 * keys are matched against the RAW count exactly as the author wrote
 * it — `String(count)` with NO offset applied — while category
 * selection (`$locale.pluralCat(...)`) and the `{}` placeholder both
 * use count − offset. With offset 2 and the canonical "people viewing"
 * table, a count of 4 matches no exact key, categorizes as
 * `pluralCat(4 - 2) = 'other'`, and renders `{}` as `2` — "John, Mary
 * and 2 other people are viewing." A count of 1 hits the exact `'1'`
 * key directly (1, not 1 − 2 = −1). The offset itself is link-time
 * static (a literal attribute, parsed once) — only the count is live.
 *
 * **Static `when` map contract.** The map is evaluated ONCE at link
 * time (upstream parity). Runtime mutations of the map object are
 * invisible to the directive — the count and the embedded `{{expr}}`
 * bindings are the live surfaces, the message TABLE is not. This is
 * documented behavior, not an error.
 *
 * **No `$log` divergence.** Upstream AngularJS reports a missing rule
 * via `$log.debug`; this project ships no `$log` service, so the
 * report routes through the standard `$exceptionHandler` channel with
 * the existing `'$compile'` cause token (`EXCEPTION_HANDLER_CAUSES`
 * stays at 10).
 *
 * **`when-…` attribute scan rule (FS §2.7 / Slice 4).** The
 * enumerable keys of `attrs` are matched against upstream's
 * `/^when(Minus)?(.+)$/` — enumeration yields ONLY normalized
 * attribute names because `$attr` / `$set` / the `$$…` internals are
 * all installed non-enumerably (`attributes.ts:127-190`). The message
 * key is `(minus ? '-' : '') + lowercase(rest)`: `when-one` normalizes
 * to `whenOne` → key `one`; `when-1` → `when1` → key `1` (digits
 * survive `directiveNormalize`'s `toUpperCase` untouched — pinned in
 * `__tests__/directive-normalize.test.ts`); `when-minus-1` →
 * `whenMinus1` → key `-1`. The bare `when` attribute itself never
 * matches (`.+` demands at least one trailing character). The raw
 * attribute TEXT is the message — never evaluated as an expression —
 * which is exactly what makes the form convenient for messages
 * containing quote characters. PRECEDENCE: a per-key attribute
 * overrides the same key from the `when` map.
 *
 * **Cleanup.** No explicit `$destroy` handling — watch lifetime is
 * scope lifetime, matching `ngBind` / `ngBindTemplate`; the switching
 * deregistration prevents stale-watch accumulation within a live
 * scope.
 *
 * Registered on `ngModule` only (DI-only, the spec 018/023–028
 * precedent) — reachable via `injector.get('ngPluralizeDirective')`,
 * NOT exported from `@compiler/index`.
 *
 * @example Canonical message-count walk
 * ```html
 * <ng-pluralize count="msgCount"
 *   when="{'0': 'You have no new messages.',
 *          'one': 'You have one new message.',
 *          'other': 'You have {} new messages.'}">
 * </ng-pluralize>
 * <!-- msgCount = 0 → "You have no new messages."
 *      msgCount = 1 → "You have one new message."
 *      msgCount = 3 → "You have 3 new messages." -->
 * ```
 *
 * @example Embedded expressions stay live without a count change
 * ```html
 * <span ng-pluralize count="1" when="{'one': '{{person1}} is viewing.'}"></span>
 * <!-- person1 = 'Igor'  → "Igor is viewing."
 *      person1 = 'Misko' → "Misko is viewing." (same count) -->
 * ```
 *
 * @example Per-key `when-…` attributes — pure form and map-override
 * ```html
 * <!-- Pure attribute form (FS §2.7 form 3): no `when` map at all.
 *      Behaves identically to the equivalent map. -->
 * <ng-pluralize count="msgCount"
 *   when-0="You have no new messages."
 *   when-one="You have one new message."
 *   when-other="You have {} new messages."
 *   when-minus-1="You owe one message.">
 * </ng-pluralize>
 * <!-- msgCount = -1 → "You owe one message." (key '-1')
 *      msgCount = 3  → "You have 3 new messages." -->
 *
 * <!-- Combined form: the per-key attribute OVERRIDES the map. -->
 * <ng-pluralize count="msgCount"
 *   when="{'one': 'A'}" when-one="B"></ng-pluralize>
 * <!-- msgCount = 1 → "B" -->
 * ```
 *
 * @example Offset: exact keys match the raw count, `{}` and the
 * category use count − offset
 * ```html
 * <ng-pluralize count="viewCount" offset="2"
 *   when="{'0': 'Nobody is viewing.',
 *          '1': '{{person1}} is viewing.',
 *          '2': '{{person1}} and {{person2}} are viewing.',
 *          'one': '{{person1}}, {{person2}} and one other person are viewing.',
 *          'other': '{{person1}}, {{person2}} and {} other people are viewing.'}">
 * </ng-pluralize>
 * <!-- viewCount = 1 → exact '1' (raw count, no offset) → "John is viewing."
 *      viewCount = 3 → pluralCat(3-2) = 'one'
 *                    → "John, Mary and one other person are viewing."
 *      viewCount = 4 → pluralCat(4-2) = 'other', {} = 4-2 = 2
 *                    → "John, Mary and 2 other people are viewing." -->
 * ```
 */

import { isObject, type DeregisterFn } from '@core/index';
import { invokeExceptionHandler, type ExceptionHandler } from '@exception-handler/index';
import type { LocaleService } from '@filter/locale-types';
import type { InterpolateFn, InterpolateService } from '@interpolate/interpolate-types';

import { NgPluralizeBadOffsetError, NgPluralizeNoRuleDefinedError } from './compile-error';
import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from './directive-types';

/**
 * Normalized directive name — registration in `src/core/ng-module.ts`
 * and this file are tied together via this constant so a rename
 * touches both at once.
 */
export const NG_PLURALIZE_NAME = 'ngPluralize';

/**
 * Upstream AngularJS's `IS_WHEN` rule, applied to the NORMALIZED
 * attribute names that enumeration of `attrs` yields. `.+` requires at
 * least one character after `when`, so the bare `when` attribute (the
 * map form) never matches and is never mistaken for a per-key entry.
 * The optional `Minus` group backtracks on a bare `whenMinus` (no
 * trailing segment), which therefore resolves to the key `minus` —
 * an upstream-identical edge case.
 */
const WHEN_ATTRIBUTE_REGEX = /^when(Minus)?(.+)$/;

/**
 * Stand-in `when`-source descriptor for the
 * {@link NgPluralizeNoRuleDefinedError} message when the directive is
 * authored purely with per-key `when-…` attributes and carries no
 * `when` map attribute at all (FS §2.7 form 3).
 */
const WHEN_ATTRIBUTES_SOURCE = 'when-… attributes';

function ngPluralizeFactory(
  $interpolate: InterpolateService,
  $locale: LocaleService,
  $exceptionHandler: ExceptionHandler,
): DirectiveFactoryReturn {
  const link: LinkFn = (scope, element, attrs) => {
    const countExpr = attrs.count;
    if (typeof countExpr !== 'string' || countExpr === '') {
      // Inert on a missing/empty `count` — no watches, no error
      // (upstream-lenient).
      return;
    }

    // An empty `when=""` counts as absent — the same emptiness rule
    // the `count` check above applies (and the `offset` parse below).
    const whenSource = attrs.when;
    const hasWhenMap = typeof whenSource === 'string' && whenSource !== '';

    // Per-key `when-…` attribute scan (FS §2.7 forms 2–3). Enumeration
    // of `attrs` yields ONLY normalized attribute names — `$attr`,
    // `$set`, and every `$$…` internal are installed non-enumerably by
    // the `Attributes` constructor (`attributes.ts:127-190`) — so a
    // plain `Object.keys` walk is the complete and exact input set.
    // Key derivation is upstream's: `whenOne` → `one`, `when1` → `1`,
    // `whenMinus1` → `-1` (the camelized remainder lowercased, with a
    // leading `-` when the `Minus` segment is present; CLDR categories
    // are single lowercase words, so `toLowerCase()` is exact). The
    // raw attribute TEXT is the message — never `$eval`ed.
    const attributeMessages = new Map<string, string>();
    for (const attributeName of Object.keys(attrs)) {
      const match = WHEN_ATTRIBUTE_REGEX.exec(attributeName);
      const rawMessage = attrs[attributeName];
      if (match === null || typeof rawMessage !== 'string') {
        continue;
      }
      const key = (match[1] !== undefined ? '-' : '') + (match[2] ?? '').toLowerCase();
      attributeMessages.set(key, rawMessage);
    }

    if (!hasWhenMap && attributeMessages.size === 0) {
      // LIVENESS RULE: the directive is live iff `count` is present
      // AND at least one message SOURCE exists — a non-empty `when`
      // attribute or at least one `when-…` attribute. With neither
      // source the author declared no messages at all, so the
      // directive bails inert (blank output, NO watches, no error —
      // upstream-lenient). Note the asymmetry with a PRESENT-but-empty
      // table: `when="{}"` (or `when="5"`, a non-object) keeps the
      // directive LIVE and every valid count takes the missing-rule
      // report path (FS §2.9) — presence of a source, not table
      // contents, decides liveness.
      return;
    }

    // Offset parse (link-time static — the attribute is literal text,
    // never an expression). Empty `offset=""` counts as absent →
    // offset 0 (mirrors upstream's `attr.offset || 0` and the
    // emptiness rule applied to `count` / `when` above).
    const offsetSource = attrs.offset;
    let offset = 0;
    if (typeof offsetSource === 'string' && offsetSource !== '') {
      offset = parseFloat(offsetSource);
      if (Number.isNaN(offset)) {
        // Present-but-non-numeric offset: LOUD inert path. Route the
        // error first (unlike the silent missing-`count`/`when` bail),
        // then take the same early return — blank, no watches, no DOM
        // mutation.
        invokeExceptionHandler($exceptionHandler, new NgPluralizeBadOffsetError(offsetSource), '$compile');
        return;
      }
    }

    // ONE `$eval` per link — the static-map contract. Non-object
    // results (numbers, strings, undefined, parse-evaluating-to-null)
    // degrade to an empty table; every valid count then takes the
    // missing-rule path. Skipped entirely for the pure-attribute form
    // (no `when` attribute — FS §2.7 form 3).
    const whenMap = hasWhenMap ? scope.$eval(whenSource) : undefined;
    const startSymbol = $interpolate.startSymbol();
    const endSymbol = $interpolate.endSymbol();
    // Both operands are parenthesized — the documented micro-deviation
    // from upstream's bare concatenation. The count side guards
    // expressions like `a ? b : c`; the offset side guards negative
    // offsets (a bare `-1` emit would produce the unparseable
    // `(count)--1`, while `(count)-(-1)` evaluates correctly).
    const countReplacement = `${startSymbol}(${countExpr})-(${String(offset)})${endSymbol}`;

    // ONE `$interpolate` compilation per message. A `Map` (not a
    // plain record) sidesteps prototype-key collisions — a count
    // resolving to e.g. the key "constructor" must MISS, not find
    // `Object.prototype.constructor`.
    const messageFns = new Map<string, InterpolateFn>();
    if (isObject(whenMap)) {
      for (const [key, message] of Object.entries(whenMap)) {
        if (typeof message === 'string') {
          messageFns.set(key, $interpolate(message.replace(/{}/g, countReplacement)));
        }
      }
    }
    // Per-attribute entries land AFTER the `when`-map entries, so a
    // same-key `when-…` attribute OVERRIDES its map counterpart
    // (FS §2.7: "the individual attribute wins").
    for (const [key, message] of attributeMessages) {
      messageFns.set(key, $interpolate(message.replace(/{}/g, countReplacement)));
    }

    // The `when`-source descriptor the missing-rule error carries. The
    // pure-attribute form has no `when` attribute to quote, so the
    // constant stand-in names the source family instead.
    const ruleSource = hasWhenMap ? whenSource : WHEN_ATTRIBUTES_SOURCE;

    // `null` doubles as the "nothing active" sentinel: initial state
    // AND the unusable-count (NaN) state. A NaN fire that follows
    // another NaN sees `lastKey === null` and no-ops — upstream's
    // `lastCount` guard.
    let lastKey: string | null = null;
    let deregisterMessageWatch: DeregisterFn | null = null;

    const stopMessageWatch = () => {
      if (deregisterMessageWatch !== null) {
        deregisterMessageWatch();
        deregisterMessageWatch = null;
      }
    };

    scope.$watch(countExpr, (newValue) => {
      // `parseFloat(String(...))` makes numeric text behave as its
      // number (FS §2.8: the text "3" === the number 3) while "abc",
      // undefined, null, and '' all yield NaN.
      const count = parseFloat(String(newValue));

      if (Number.isNaN(count)) {
        // Unusable count → blank, deregister, NO report (FS §2.8).
        if (lastKey !== null) {
          stopMessageWatch();
          element.textContent = '';
          lastKey = null;
        }
        return;
      }

      // Exact `String(count)` match wins over the locale category
      // (FS §2.1) — and matches the RAW count, no offset applied
      // (FS §2.4). Only category selection (and the `{}` placeholder,
      // via the rewrite above) sees count − offset. Category names are
      // opaque — whatever the active locale's `pluralCat` returns is
      // looked up verbatim.
      const exactKey = String(count);
      const key = messageFns.has(exactKey) ? exactKey : $locale.pluralCat(count - offset);

      if (key === lastKey) {
        // Same message variant as the previous fire — the active
        // message watch (if any) keeps the text current; nothing to
        // switch, nothing to re-report.
        return;
      }

      stopMessageWatch();
      lastKey = key;

      const messageFn = messageFns.get(key);
      if (messageFn === undefined) {
        // Valid number, no rule (FS §2.9): blank the element and
        // report ONCE for this key transition via the standard
        // channel — the in-listener ng-repeat routing precedent. The
        // digest continues; the page around the element keeps working.
        element.textContent = '';
        invokeExceptionHandler($exceptionHandler, new NgPluralizeNoRuleDefinedError(key, ruleSource), '$compile');
        return;
      }

      // Switching watch: ONE active message watch at a time. The
      // listener is the `ng-bind-template` write shape — embedded
      // `{{expr}}` bindings inside the message refresh through it
      // without any count change.
      deregisterMessageWatch = scope.$watch(messageFn, (value) => {
        element.textContent = value ?? '';
      });
    });
  };

  return {
    restrict: 'EA',
    link,
  };
}

/**
 * DI-annotated factory ready for
 * `$compileProvider.directive('ngPluralize', ngPluralizeDirective)`.
 * Three dependencies, all resolvable on `ngModule`: `$interpolate`
 * (spec 011), `$locale` (spec 016 / widened with `pluralCat` in spec
 * 029 Slice 1), and `$exceptionHandler` (spec 014).
 */
export const ngPluralizeDirective: DirectiveFactory = [
  '$interpolate',
  '$locale',
  '$exceptionHandler',
  ngPluralizeFactory,
];
