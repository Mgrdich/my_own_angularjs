/**
 * AngularJS 1.x parity tests for spec 029 (`ngPluralize` pluralization).
 *
 * This file is a focused "canonical patterns" regression guard rather
 * than a verbatim port — the upstream `angular/angular.js` repo is not
 * vendored locally, so each test below codifies a publicly-documented
 * AngularJS 1.x behavior that the spec-029 `ngPluralize` directive must
 * satisfy. The slice-2/3/4 file (`ng-pluralize.test.ts`, 53 tests)
 * covers the full FS §2 acceptance grid; this file pins the
 * cross-cutting upstream-documented surfaces end-to-end:
 *
 *  - **The two canonical upstream docs examples** — the message-count
 *    walk (`'0'` / `'one'` / `'other'` across counts 0 → 1 → 3) and the
 *    people-viewing-with-offset-2 table walked across counts 0–4
 *    (Igor / Misko), both run as LIVE template walks on a single
 *    element so the switching watch is exercised between every pinned
 *    output string.
 *  - **Locale swap (FS §2.5)** — the SAME template picks messages per
 *    the new rules after the app replaces `$locale` with a fake
 *    multi-category locale mapping BOTH 1 and 2 to a custom `few`
 *    category (`createModule('app', ['ng']).factory('$locale', […])` —
 *    the `src/filter/__tests__/locale.test.ts` swap precedent).
 *  - **Custom interpolation symbols** — with `$interpolateProvider`
 *    reconfigured to `[[ ]]`, the directive's `{}` rewrite emits the
 *    CUSTOM symbols (via the service's `startSymbol()` / `endSymbol()`
 *    accessors) so the placeholder still resolves; embedded `[[expr]]`
 *    bindings interpolate while literal `{{expr}}` text stays inert.
 *  - **Composition smoke** — `ng-pluralize` is a LEAF text-writer (not
 *    `transclude: 'element'`, not terminal), so it mounts and tears
 *    down cleanly inside an `ng-repeat` row and on an `ng-if` subtree
 *    without tripping the spec-027 same-element structural gap.
 *
 * Plus the `EXCEPTION_HANDLER_CAUSES.length === 10` regression guard —
 * spec 029 introduces TWO new error classes
 * (`NgPluralizeNoRuleDefinedError`, `NgPluralizeBadOffsetError`) but
 * ZERO new cause tokens; both route via the existing `'$compile'`
 * token.
 *
 * Mirrors the structural precedent set by
 * `src/compiler/__tests__/spec028-parity.test.ts` (and the
 * `EXCEPTION_HANDLER_CAUSES.length === 10` regression-guard pattern
 * established by spec 023 → spec 028).
 *
 * @see context/spec/029-ng-pluralize/functional-spec.md
 * @see context/spec/029-ng-pluralize/technical-considerations.md
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { EXCEPTION_HANDLER_CAUSES, type ExceptionHandler } from '@exception-handler/index';
import { $FilterProvider } from '@filter/filter-provider';
import { defaultLocale } from '@filter/locale';
import type { LocaleService } from '@filter/locale-types';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import { createTemplateCache } from '@template/template-cache';
import { createTemplateRequest } from '@template/template-request';
import type { TemplateCacheService, TemplateRequestFn } from '@template/template-types';

interface Bootstrap {
  $compile: CompileService;
}

interface BootstrapOptions {
  /** Spy `$exceptionHandler` registered on the `app` module (last-wins override). */
  exceptionHandler?: ExceptionHandler;
  /** Swapped-in `$locale` registered on the `app` module (FS §2.5 — last-wins over `ngModule`'s en-US default). */
  locale?: LocaleService;
  /** Custom interpolation delimiters applied via a `config(['$interpolateProvider', …])` block. */
  interpolateSymbols?: { start: string; end: string };
}

/**
 * Bootstrap an injector wired with the production `ngModule` (so the
 * spec-029 `ngPluralize` directive is reachable end-to-end). The `app`
 * module accepts a spy `$exceptionHandler`, a swapped `$locale`, and a
 * custom-interpolation-symbols config block.
 *
 * Mirrors `spec028-parity.test.ts`'s bootstrap shape — the closest
 * precedent for this parity file.
 */
function bootstrap(options?: BootstrapOptions): Bootstrap {
  resetRegistry();
  createModule('ng', [])
    .factory('$exceptionHandler', [() => (): void => undefined])
    .provider('$sceDelegate', $SceDelegateProvider)
    .provider('$sce', $SceProvider)
    .provider('$interpolate', $InterpolateProvider)
    .provider('$filter', ['$provide', $FilterProvider])
    .factory('$templateCache', [() => createTemplateCache()])
    .factory('$templateRequest', [
      '$templateCache',
      (cache: TemplateCacheService): TemplateRequestFn => createTemplateRequest({ cache }),
    ])
    .provider('$compile', ['$provide', $CompileProvider]);

  const appModule = createModule('app-spec029-parity', ['ng']);
  if (options?.exceptionHandler !== undefined) {
    const handler = options.exceptionHandler;
    appModule.factory('$exceptionHandler', [() => handler]);
  }
  if (options?.locale !== undefined) {
    const locale = options.locale;
    appModule.factory('$locale', [() => locale]);
  }
  if (options?.interpolateSymbols !== undefined) {
    const { start, end } = options.interpolateSymbols;
    appModule.config([
      '$interpolateProvider',
      (p: $InterpolateProvider) => {
        p.startSymbol(start).endSymbol(end);
      },
    ]);
  }
  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get('$compile'),
  };
}

/**
 * The first canonical upstream docs example — the message-count `when`
 * map from the official `ngPluralize` documentation.
 */
const MESSAGE_COUNT_WHEN =
  "{'0': 'You have no new messages.', 'one': 'You have one new message.', 'other': 'You have {} new messages.'}";

/**
 * The second canonical upstream docs example — the people-viewing table
 * used with `offset="2"` (exact keys `'0'` / `'1'` / `'2'` match the
 * RAW count; category selection and `{}` use count − offset).
 */
const PEOPLE_VIEWING_WHEN =
  "{'0': 'Nobody is viewing.', '1': '{{person1}} is viewing.', '2': '{{person1}} and {{person2}} are viewing.', 'one': '{{person1}}, {{person2}} and one other person are viewing.', 'other': '{{person1}}, {{person2}} and {} other people are viewing.'}";

/** Build a `<ng-pluralize count="…" when="…">` element, optionally with an `offset`. */
function makePluralize(count: string, when: string, offset?: string): HTMLElement {
  const element = document.createElement('ng-pluralize');
  element.setAttribute('count', count);
  element.setAttribute('when', when);
  if (offset !== undefined) {
    element.setAttribute('offset', offset);
  }
  return element;
}

/**
 * Filter out the incidental "expected placeholder to be a Comment"
 * throws that fire whenever a `transclude: 'element'` directive's link
 * fn runs against the captured master clone (the framework's
 * re-entrancy guard strips `transclude` but leaves the directive's
 * `link` in place; the link's `isComment(element)` invariant check then
 * trips against the cloned Element and routes via
 * `$exceptionHandler('$compile')`). This is a PRE-EXISTING framework
 * artifact of the structural hosts (`ng-if`, `ng-repeat`,
 * `ng-include`), NOT a spec-029 behavior — `ng-pluralize` itself never
 * routes it. The composition tests below filter it out so they can
 * still assert "the pluralize directive reported nothing"; the same
 * helper precedent lives in `ng-repeat.test.ts:162-186`.
 */
function relevantHandlerCalls(handler: {
  mock: { calls: readonly [exception: unknown, cause?: string | undefined][] };
}): readonly [exception: unknown, cause?: string | undefined][] {
  return handler.mock.calls.filter((call) => {
    const err = call[0];
    if (err instanceof Error && err.message.includes('expected placeholder to be a Comment')) {
      return false;
    }
    return true;
  });
}

afterEach(() => {
  resetRegistry();
});

// ---------------------------------------------------------------------
// Cause-token regression guard — spec 029 introduces ZERO new tokens.
// Mirrors the spec 023 / 024 / 025 / 026 / 027 / 028 parity-file
// precedent (kept at the TOP so a future contributor adding a token
// notices the failure immediately). Both spec-029 error classes
// (`NgPluralizeNoRuleDefinedError`, `NgPluralizeBadOffsetError`) route
// via the existing `'$compile'` cause token introduced by spec 017.
// ---------------------------------------------------------------------

describe('parity: EXCEPTION_HANDLER_CAUSES regression', () => {
  it('keeps the tuple at exactly 10 entries after spec 029', () => {
    expect(EXCEPTION_HANDLER_CAUSES.length).toBe(10);
    expect(EXCEPTION_HANDLER_CAUSES).toContain('$compile');
  });
});

// ---------------------------------------------------------------------
// Canonical upstream docs example 1 — the message-count walk.
// Upstream: the `ngPluralize` directive docs' first live example
// ("You have no new messages." / "You have one new message." /
// "You have {} new messages."). Walked LIVE on a single element across
// counts 0 → 1 → 3 so the switching watch fires between every pinned
// string (FS §2.1 / §2.2 / §2.6).
// ---------------------------------------------------------------------

describe('parity: canonical message-count example (FS §2.1 / §2.6)', () => {
  it('walks counts 0 → 1 → 3 on one element, pinning the upstream-documented strings', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.msgCount = 0;

    const element = makePluralize('msgCount', MESSAGE_COUNT_WHEN);
    b.$compile(element)(scope);
    scope.$digest();
    expect(element.textContent).toBe('You have no new messages.');

    scope.msgCount = 1;
    scope.$digest();
    expect(element.textContent).toBe('You have one new message.');

    scope.msgCount = 3;
    scope.$digest();
    expect(element.textContent).toBe('You have 3 new messages.');
  });
});

// ---------------------------------------------------------------------
// Canonical upstream docs example 2 — people viewing with offset 2.
// Upstream: the `ngPluralize` directive docs' offset example. Exact
// keys '0' / '1' / '2' match the RAW count; counts 3 and 4 fall through
// to pluralCat(count − 2) with `{}` showing count − 2 (FS §2.4).
// Walked LIVE across 0 → 1 → 2 → 3 → 4 on a single element.
// ---------------------------------------------------------------------

describe('parity: canonical people-viewing offset example (FS §2.4)', () => {
  it('walks counts 0 → 4 with offset 2 and Igor/Misko, pinning all five upstream strings', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.personCount = 0;
    scope.person1 = 'Igor';
    scope.person2 = 'Misko';

    const element = makePluralize('personCount', PEOPLE_VIEWING_WHEN, '2');
    b.$compile(element)(scope);
    scope.$digest();
    expect(element.textContent).toBe('Nobody is viewing.');

    scope.personCount = 1;
    scope.$digest();
    expect(element.textContent).toBe('Igor is viewing.'); // exact '1' — raw count, NOT 1 − 2

    scope.personCount = 2;
    scope.$digest();
    expect(element.textContent).toBe('Igor and Misko are viewing.'); // exact '2' — raw count

    scope.personCount = 3;
    scope.$digest();
    expect(element.textContent).toBe('Igor, Misko and one other person are viewing.'); // pluralCat(3 − 2) = 'one'

    scope.personCount = 4;
    scope.$digest();
    expect(element.textContent).toBe('Igor, Misko and 2 other people are viewing.'); // pluralCat(4 − 2) = 'other'; {} = 2
  });
});

// ---------------------------------------------------------------------
// Locale swap — the SAME template picks per the NEW rules (FS §2.5).
// Upstream: ngPluralize delegates category selection to
// `$locale.pluralCat`, so an app shipping a non-English locale gets
// that language's plural rules with no template change. The fake
// multi-category locale below maps BOTH 1 and 2 to a custom `few`
// category — built by spreading `defaultLocale` (the
// `src/filter/__tests__/locale.test.ts` precedent).
// ---------------------------------------------------------------------

describe('parity: locale swap drives category selection (FS §2.5)', () => {
  /** Same template under both locales — note it carries a `one` AND a `few` message. */
  const LOCALE_WHEN = "{'one': 'ONE message.', 'few': 'A FEW ({}) messages.', 'other': 'MANY ({}) messages.'}";

  const fewLocale: LocaleService = {
    ...defaultLocale,
    id: 'x-spec029-parity',
    pluralCat: (num: number) => (num === 1 || num === 2 ? 'few' : 'other'),
  };

  it('baseline: under the default en-US locale, count 1 → "one" and count 2 → "other"', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.n = 1;

    const element = makePluralize('n', LOCALE_WHEN);
    b.$compile(element)(scope);
    scope.$digest();
    expect(element.textContent).toBe('ONE message.');

    scope.n = 2;
    scope.$digest();
    expect(element.textContent).toBe('MANY (2) messages.');
  });

  it('swapped: the SAME template maps counts 1 AND 2 to "few" under the custom locale', () => {
    const b = bootstrap({ locale: fewLocale });
    const scope = Scope.create();
    scope.n = 1;

    const element = makePluralize('n', LOCALE_WHEN);
    b.$compile(element)(scope);
    scope.$digest();
    // The custom pluralCat decides — 'few' wins even though a 'one'
    // message exists (no exact '1' key; category selection is the
    // locale's call).
    expect(element.textContent).toBe('A FEW (1) messages.');

    scope.n = 2;
    scope.$digest();
    expect(element.textContent).toBe('A FEW (2) messages.');

    scope.n = 3;
    scope.$digest();
    expect(element.textContent).toBe('MANY (3) messages.');
  });
});

// ---------------------------------------------------------------------
// Custom interpolation symbols — the `{}` rewrite emits the CONFIGURED
// delimiters. Upstream: ngPluralize builds the placeholder substitution
// from `$interpolate.startSymbol()` / `endSymbol()`, so an app that
// reconfigures `$interpolateProvider` (e.g. to avoid server-side
// template clashes) keeps working without touching its messages.
// ---------------------------------------------------------------------

describe('parity: custom interpolation symbols via $interpolateProvider', () => {
  it('with [[ ]] configured, {} still resolves and embedded [[expr]] bindings stay live', () => {
    const b = bootstrap({ interpolateSymbols: { start: '[[', end: ']]' } });
    const scope = Scope.create();
    scope.n = 3;
    scope.who = 'Igor';

    // The {} rewrite becomes `[[(n)-(0)]]` — the custom symbols, not {{ }}.
    const element = makePluralize('n', "{'other': '[[who]] sees {} items.'}");
    b.$compile(element)(scope);
    scope.$digest();
    expect(element.textContent).toBe('Igor sees 3 items.');

    // Placeholder refreshes within the same category…
    scope.n = 5;
    scope.$digest();
    expect(element.textContent).toBe('Igor sees 5 items.');

    // …and the embedded [[who]] binding live-updates WITHOUT a count change.
    scope.who = 'Misko';
    scope.$digest();
    expect(element.textContent).toBe('Misko sees 5 items.');
  });

  it('with [[ ]] configured, literal {{expr}} text in a message is inert (not interpolated)', () => {
    const b = bootstrap({ interpolateSymbols: { start: '[[', end: ']]' } });
    const scope = Scope.create();
    scope.n = 3;
    scope.who = 'Igor';

    const element = makePluralize('n', "{'other': '{{who}} sees {} items.'}");
    b.$compile(element)(scope);
    scope.$digest();

    // The default delimiters are plain text under the custom config;
    // only the {} placeholder (rewritten with [[ ]]) resolves.
    expect(element.textContent).toBe('{{who}} sees 3 items.');
  });
});

// ---------------------------------------------------------------------
// Composition smoke — `ng-pluralize` is a LEAF text-writer (no
// transclusion, not terminal), so it composes with structural hosts
// the way `ng-bind` does: per-row inside `ng-repeat`, mount/teardown
// inside `ng-if`. Neither case trips the spec-027 same-element
// structural gap because the pluralize element is NESTED inside the
// structural host's subtree (the canonical pattern).
// ---------------------------------------------------------------------

describe('parity: composition — ng-pluralize inside an ng-repeat row', () => {
  it('renders the per-row variant from the row local, reconciles on list updates, and stays silent', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.nums = [0, 1, 3];

    const parent = document.createElement('div');
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'n in nums');
    const inner = makePluralize('n', MESSAGE_COUNT_WHEN);
    host.appendChild(inner);
    parent.appendChild(host);

    b.$compile(parent)(scope);
    scope.$digest();

    const texts = () => Array.from(parent.querySelectorAll('li')).map((li) => li.textContent);
    expect(texts()).toEqual(['You have no new messages.', 'You have one new message.', 'You have 3 new messages.']);

    // Shrink to one item — surviving row reused (identity 'number:3'),
    // the other rows' clones torn down cleanly.
    scope.nums = [3];
    scope.$digest();
    expect(texts()).toEqual(['You have 3 new messages.']);

    // Empty out — zero rows, nothing left behind.
    scope.nums = [];
    scope.$digest();
    expect(texts()).toEqual([]);

    // No pluralize-originated reports across the whole mount /
    // reconcile / teardown cycle (the incidental master-clone re-link
    // routing from the structural host is filtered — see
    // `relevantHandlerCalls`).
    expect(relevantHandlerCalls(handler)).toEqual([]);
  });
});

describe('parity: composition — ng-pluralize on an ng-if subtree', () => {
  it('mounts on truthy, live-updates while mounted, tears down on falsy, and remounts cleanly', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.show = true;
    scope.msgCount = 1;

    const wrapper = document.createElement('div');
    const ifHost = document.createElement('div');
    ifHost.setAttribute('ng-if', 'show');
    ifHost.appendChild(makePluralize('msgCount', MESSAGE_COUNT_WHEN));
    wrapper.appendChild(ifHost);

    b.$compile(wrapper)(scope);
    scope.$digest();

    const mounted = () => wrapper.querySelector('ng-pluralize');
    expect(mounted()?.textContent).toBe('You have one new message.');

    // Live update while mounted.
    scope.msgCount = 3;
    scope.$digest();
    expect(mounted()?.textContent).toBe('You have 3 new messages.');

    // Teardown — the subtree (and the clone scope's watches) go away.
    scope.show = false;
    scope.$digest();
    expect(mounted()).toBeNull();

    // Count changes while unmounted digest cleanly (no stale watches).
    scope.msgCount = 0;
    scope.$digest();
    expect(mounted()).toBeNull();

    // Remount — a fresh clone links and renders the current count.
    scope.show = true;
    scope.$digest();
    expect(mounted()?.textContent).toBe('You have no new messages.');

    // No pluralize-originated reports across mount / update / teardown
    // / remount (the incidental master-clone re-link routing from
    // `ng-if` is filtered — see `relevantHandlerCalls`).
    expect(relevantHandlerCalls(handler)).toEqual([]);
  });
});
