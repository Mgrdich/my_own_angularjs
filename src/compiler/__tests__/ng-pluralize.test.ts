/**
 * `ngPluralize` directive — locale-aware pluralization (spec 029
 * Slices 2–4 / FS §2.1–§2.9).
 *
 * Locks the slice-2 surface:
 *
 * - Registration on `ngModule` (`injector.has('ngPluralizeDirective')`).
 * - The canonical 0/1/3 message-map walk (`'0'` / `'one'` / `'other'`)
 *   and the exact-key-beats-category precedence rule (FS §2.1).
 * - `{}` placeholder replacement with the count, including repeated
 *   occurrences (FS §2.2).
 * - Embedded `{{expr}}` bindings render and live-update WITHOUT a
 *   count change (FS §2.3).
 * - Element form `<ng-pluralize>` and attribute form
 *   `<span ng-pluralize>` produce identical text (FS §2.7).
 * - Live variant switching and placeholder refresh, with the old
 *   message watch deregistered — no double-writes (FS §2.6).
 * - Unusable counts go blank with NO handler report; a count that
 *   BECOMES unusable clears existing text; numeric text behaves as
 *   its number (FS §2.8).
 * - A valid count with no matching rule blanks the element and routes
 *   `NgPluralizeNoRuleDefinedError` via `$exceptionHandler` with
 *   cause `'$compile'`, once per key transition; the page keeps
 *   digesting (FS §2.9).
 * - en-US category dispatch: 1 → `one`; 0 / 2 / 1.5 / −1 → `other`
 *   (FS §2.5).
 *
 * Slice 3 adds the offset surface (FS §2.4): the canonical
 * offset-2 "people viewing" quintet (exact keys match the RAW count,
 * category selection and `{}` use count − offset), the
 * parenthesized-rewrite guarantees (ternary count expressions and
 * negative offsets), `parseFloat` leniency (`"2px"` → 2), the
 * empty-`offset=""`-counts-as-absent rule, and the LOUD
 * `NgPluralizeBadOffsetError` link-time path (cause `'$compile'`,
 * one report, no watches, blank forever) — including its ordering
 * AFTER the silent missing-`count`/`when` inert bail.
 *
 * Slice 4 adds the per-key `when-…` attribute surface (FS §2.7 form
 * 3): the pure-attribute form behaves identically to the equivalent
 * `when` map; a same-key `when-…` attribute OVERRIDES its map
 * counterpart; `when-minus-1` matches count −1; `{}` (offset-adjusted)
 * and `{{expr}}` interpolate inside attribute messages; combined
 * map + attributes + offset; the liveness rule (`when-…` attributes
 * are a message source, `when="{}"` keeps the directive LIVE,
 * `when-one=""` is a valid blank message); the pure-attribute
 * missing-rule report quotes the literal `'when-… attributes'`
 * source descriptor; `data-` / `x-` prefixed forms normalize into
 * the scan; the raw attribute text is never `$eval`'d; and the
 * upstream-identical bare-`when-minus` (key `minus`) quirk.
 *
 * Tests use the canonical `ngModule` so the `ngPluralize` directive
 * registered by `src/core/ng-module.ts` is reachable end-to-end —
 * the `ng-bind-template.test.ts` bootstrap pattern, widened with the
 * ng-repeat-style spy `$exceptionHandler` option.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import { NgPluralizeBadOffsetError, NgPluralizeNoRuleDefinedError } from '@compiler/compile-error';
import type { CompileService } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import type { ExceptionHandler } from '@exception-handler/index';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import { createTemplateCache } from '@template/template-cache';
import { createTemplateRequest } from '@template/template-request';
import type { TemplateCacheService, TemplateRequestFn } from '@template/template-types';

interface InjectorLike {
  has: (name: string) => boolean;
}

interface Bootstrap {
  $compile: CompileService;
  injector: InjectorLike;
}

interface BootstrapOptions {
  /** Spy `$exceptionHandler` registered on the `app` module. */
  exceptionHandler?: ExceptionHandler;
}

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

  const appModule = createModule('app-ng-pluralize', ['ng']);
  if (options?.exceptionHandler !== undefined) {
    const handler = options.exceptionHandler;
    appModule.factory('$exceptionHandler', [() => handler]);
  }
  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get('$compile'),
    injector: built,
  };
}

/** The canonical FS §2.1 message map (single-quoted object-literal expression, `$eval`'d against the scope). */
const CANONICAL_WHEN =
  "{'0': 'You have no new messages.', 'one': 'You have one new message.', 'other': 'You have {} new messages.'}";

/**
 * Build a `<ng-pluralize count="…" when="…">` element (element form)
 * or a `<span ng-pluralize count="…" when="…">` (attribute form),
 * optionally carrying an `offset="…"` attribute (FS §2.4 / Slice 3).
 * Elements carry NO initial text so blank assertions hold trivially
 * on the inert / unusable-count paths (FS §2.8).
 */
function makePluralize(form: 'element' | 'attribute', count: string, when: string, offset?: string): HTMLElement {
  const element = form === 'element' ? document.createElement('ng-pluralize') : document.createElement('span');
  if (form === 'attribute') {
    element.setAttribute('ng-pluralize', '');
  }
  element.setAttribute('count', count);
  element.setAttribute('when', when);
  if (offset !== undefined) {
    element.setAttribute('offset', offset);
  }
  return element;
}

/**
 * Build a `<ng-pluralize count="…">` element authored with per-key
 * `when-…` attributes (FS §2.7 form 3 / Slice 4), optionally combined
 * with a `when` map and/or an `offset`. `whenAttributes` keys are the
 * literal DOM attribute names (`'when-0'`, `'when-one'`,
 * `'data-when-one'`, …); values are the raw message text — never an
 * expression.
 */
function makeAttributePluralize(
  count: string,
  whenAttributes: Record<string, string>,
  options?: { when?: string; offset?: string },
): HTMLElement {
  const element = document.createElement('ng-pluralize');
  element.setAttribute('count', count);
  if (options?.when !== undefined) {
    element.setAttribute('when', options.when);
  }
  for (const [name, value] of Object.entries(whenAttributes)) {
    element.setAttribute(name, value);
  }
  if (options?.offset !== undefined) {
    element.setAttribute('offset', options.offset);
  }
  return element;
}

/**
 * Intercept `textContent` writes on a single element by shadowing the
 * `Node.prototype` accessor with an instance-level recording wrapper.
 * Lets FS §2.6 pin "no double-writes" directly: every framework write
 * to the element's text lands in the returned array, in order.
 */
function spyTextWrites(element: HTMLElement): string[] {
  const writes: string[] = [];
  const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  if (descriptor === undefined || descriptor.get === undefined || descriptor.set === undefined) {
    throw new Error('expected jsdom to define a textContent accessor on Node.prototype');
  }
  // eslint-disable-next-line @typescript-eslint/unbound-method -- the borrowed accessors are deliberately re-invoked with an explicit `.call(this)` below, so the unbound extraction is safe.
  const originalGet = descriptor.get;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- same explicit `.call(this)` re-binding as the getter above.
  const originalSet = descriptor.set;
  Object.defineProperty(element, 'textContent', {
    configurable: true,
    get(): string | null {
      return originalGet.call(this) as string | null;
    },
    set(value: unknown): void {
      writes.push(String(value));
      originalSet.call(this, value);
    },
  });
  return writes;
}

afterEach(() => {
  resetRegistry();
});

// ---------------------------------------------------------------------------
// 1. Registration & DI
// ---------------------------------------------------------------------------

describe('ngPluralize — registration on ngModule (spec 029 Slice 2)', () => {
  it('injector.has("ngPluralizeDirective") === true when "ng" is in the deps chain', () => {
    const b = bootstrap();
    expect(b.injector.has('ngPluralizeDirective')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Choosing a message by count (FS §2.1)
// ---------------------------------------------------------------------------

describe('ngPluralize — canonical message-map walk (FS §2.1)', () => {
  it('count 0 selects the exact "0" message', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.msgCount = 0;

    const element = makePluralize('element', 'msgCount', CANONICAL_WHEN);
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('You have no new messages.');
  });

  it('count 1 selects the "one" category message', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.msgCount = 1;

    const element = makePluralize('element', 'msgCount', CANONICAL_WHEN);
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('You have one new message.');
  });

  it('count 3 selects the "other" category message with {} replaced by 3', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.msgCount = 3;

    const element = makePluralize('element', 'msgCount', CANONICAL_WHEN);
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('You have 3 new messages.');
  });

  it('an exact "1" key beats the "one" category key when the count is 1', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.msgCount = 1;

    const element = makePluralize('element', 'msgCount', "{'1': 'exact one', 'one': 'category one'}");
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('exact one');
  });
});

// ---------------------------------------------------------------------------
// 3. The number placeholder (FS §2.2)
// ---------------------------------------------------------------------------

describe('ngPluralize — {} placeholder (FS §2.2)', () => {
  it('replaces {} with the current count', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.msgCount = 42;

    const element = makePluralize('element', 'msgCount', "{'other': 'You have {} new messages.'}");
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('You have 42 new messages.');
  });

  it('replaces EVERY occurrence when {} appears more than once', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.msgCount = 2;

    const element = makePluralize('element', 'msgCount', "{'other': '{} plus {} equals {} doubled... no, {}.'}");
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('2 plus 2 equals 2 doubled... no, 2.');
  });
});

// ---------------------------------------------------------------------------
// 4. Embedded live expressions (FS §2.3)
// ---------------------------------------------------------------------------

describe('ngPluralize — embedded {{expression}} bindings (FS §2.3)', () => {
  it('renders an embedded {{person1}} against the surrounding scope', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.viewCount = 1;
    scope.person1 = 'Igor';

    const element = makePluralize('element', 'viewCount', "{'one': '{{person1}} is viewing.'}");
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('Igor is viewing.');
  });

  it('live-updates the embedded binding WITHOUT a count change', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.viewCount = 1;
    scope.person1 = 'Igor';

    const element = makePluralize('element', 'viewCount', "{'one': '{{person1}} is viewing.'}");
    b.$compile(element)(scope);
    scope.$digest();
    expect(element.textContent).toBe('Igor is viewing.');

    scope.person1 = 'Misko';
    scope.$digest();
    expect(element.textContent).toBe('Misko is viewing.');
  });
});

// ---------------------------------------------------------------------------
// 5. Authoring forms — element vs attribute (FS §2.7, slice-2 subset)
// ---------------------------------------------------------------------------

describe('ngPluralize — element form vs attribute form (FS §2.7)', () => {
  it('the same count and messages produce identical text in both forms', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.msgCount = 3;

    const elementForm = makePluralize('element', 'msgCount', CANONICAL_WHEN);
    const attributeForm = makePluralize('attribute', 'msgCount', CANONICAL_WHEN);
    b.$compile(elementForm)(scope);
    b.$compile(attributeForm)(scope);
    scope.$digest();

    expect(elementForm.textContent).toBe('You have 3 new messages.');
    expect(attributeForm.textContent).toBe(elementForm.textContent);
  });

  it('both forms agree on the exact-key path too (count 1)', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.msgCount = 1;

    const elementForm = makePluralize('element', 'msgCount', CANONICAL_WHEN);
    const attributeForm = makePluralize('attribute', 'msgCount', CANONICAL_WHEN);
    b.$compile(elementForm)(scope);
    b.$compile(attributeForm)(scope);
    scope.$digest();

    expect(elementForm.textContent).toBe('You have one new message.');
    expect(attributeForm.textContent).toBe(elementForm.textContent);
  });
});

// ---------------------------------------------------------------------------
// 6. Live updates & the switching watch (FS §2.6)
// ---------------------------------------------------------------------------

describe('ngPluralize — live variant switch and placeholder refresh (FS §2.6)', () => {
  it('switches from the "one" variant to the "other" variant when the count goes 1 → 2', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.msgCount = 1;

    const element = makePluralize('element', 'msgCount', CANONICAL_WHEN);
    b.$compile(element)(scope);
    scope.$digest();
    expect(element.textContent).toBe('You have one new message.');

    scope.msgCount = 2;
    scope.$digest();
    expect(element.textContent).toBe('You have 2 new messages.');
  });

  it('refreshes the {} placeholder within the same category (2 → 5) with exactly one extra write', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.msgCount = 2;

    const element = makePluralize('element', 'msgCount', CANONICAL_WHEN);
    const writes = spyTextWrites(element);
    b.$compile(element)(scope);
    scope.$digest();
    expect(element.textContent).toBe('You have 2 new messages.');
    expect(writes).toEqual(['You have 2 new messages.']);

    scope.msgCount = 5;
    scope.$digest();
    expect(element.textContent).toBe('You have 5 new messages.');
    // Same key ('other') — the count watch no-ops on the key, only the
    // active message watch re-fires. ONE write, no variant churn.
    expect(writes).toEqual(['You have 2 new messages.', 'You have 5 new messages.']);
  });

  it('deregisters the old message watch on a variant switch — no double-writes', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.msgCount = 1;
    scope.a = 'Alpha';
    scope.b = 'Beta';

    const element = makePluralize('element', 'msgCount', "{'one': 'one: {{a}}', 'other': 'other: {{b}}'}");
    const writes = spyTextWrites(element);
    b.$compile(element)(scope);
    scope.$digest();
    expect(writes).toEqual(['one: Alpha']);

    scope.msgCount = 2;
    scope.$digest();
    expect(writes).toEqual(['one: Alpha', 'other: Beta']);

    // Mutate an expression only the OLD (deregistered) message
    // referenced — a stale watch would re-fire and write 'one: Changed'.
    scope.a = 'Changed';
    scope.$digest();
    expect(writes).toEqual(['one: Alpha', 'other: Beta']);
    expect(element.textContent).toBe('other: Beta');
  });
});

// ---------------------------------------------------------------------------
// 7. Unusable count (FS §2.8)
// ---------------------------------------------------------------------------

describe('ngPluralize — unusable count (FS §2.8)', () => {
  it('a missing count value leaves the element blank with NO handler report', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    // `scope.missing` is never assigned.

    const element = makePluralize('element', 'missing', CANONICAL_WHEN);
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('');
    expect(handler).not.toHaveBeenCalled();
  });

  it('the non-numeric text "abc" leaves the element blank with NO handler report', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.msgCount = 'abc';

    const element = makePluralize('element', 'msgCount', CANONICAL_WHEN);
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('');
    expect(handler).not.toHaveBeenCalled();
  });

  it('a previously valid count BECOMING unusable clears the displayed text', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.msgCount = 2;

    const element = makePluralize('element', 'msgCount', CANONICAL_WHEN);
    b.$compile(element)(scope);
    scope.$digest();
    expect(element.textContent).toBe('You have 2 new messages.');

    scope.msgCount = 'abc';
    scope.$digest();
    expect(element.textContent).toBe('');
    expect(handler).not.toHaveBeenCalled();
  });

  it('numeric text "3" behaves exactly like the number 3', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.msgCount = '3';

    const element = makePluralize('element', 'msgCount', CANONICAL_WHEN);
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('You have 3 new messages.');
  });

  it('a missing count ATTRIBUTE is inert — pre-existing text is left untouched', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();

    // Inert path (no `count` attribute at all): the directive bails
    // before touching the DOM — distinct from the active-watch
    // clear-to-blank path above.
    const element = document.createElement('ng-pluralize');
    element.setAttribute('when', CANONICAL_WHEN);
    element.textContent = 'untouched';
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('untouched');
    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8. Missing message for a matched category (FS §2.9)
// ---------------------------------------------------------------------------

describe('ngPluralize — missing rule for a matched category (FS §2.9)', () => {
  const ONE_ONLY_WHEN = "{'one': 'You have one new message.'}";

  it('count 5 with only a "one" message blanks the element and reports NgPluralizeNoRuleDefinedError via "$compile"', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.msgCount = 5;

    const element = makePluralize('element', 'msgCount', ONE_ONLY_WHEN);
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('');
    expect(handler).toHaveBeenCalledTimes(1);
    const err = handler.mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(NgPluralizeNoRuleDefinedError);
    expect((err as Error).name).toBe('NgPluralizeNoRuleDefinedError');
    expect((err as Error).message).toBe(
      `ngPluralize: no rule defined for "other" in "${ONE_ONLY_WHEN}". Add a message for that exact value or plural category.`,
    );
    expect(handler.mock.calls[0]?.[1]).toBe('$compile');
  });

  it('the page around the element keeps digesting after the report', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.msgCount = 5;
    scope.label = 'before';

    const container = document.createElement('div');
    container.appendChild(makePluralize('element', 'msgCount', ONE_ONLY_WHEN));
    const sibling = document.createElement('span');
    sibling.setAttribute('ng-bind', 'label');
    container.appendChild(sibling);

    b.$compile(container)(scope);
    scope.$digest();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(sibling.textContent).toBe('before');

    scope.label = 'after';
    scope.$digest();
    expect(sibling.textContent).toBe('after');

    // A recovery transition still works: count 1 has a rule.
    scope.msgCount = 1;
    scope.$digest();
    expect(container.querySelector('ng-pluralize')?.textContent).toBe('You have one new message.');
  });

  it('reports ONCE per key transition — repeat digests and same-key count changes do not re-report', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.msgCount = 5;

    const element = makePluralize('element', 'msgCount', ONE_ONLY_WHEN);
    b.$compile(element)(scope);
    scope.$digest();
    expect(handler).toHaveBeenCalledTimes(1);

    // Re-digesting with the same count does not re-report.
    scope.$digest();
    expect(handler).toHaveBeenCalledTimes(1);

    // A different count resolving to the SAME uncovered key ('other')
    // does not re-report either.
    scope.msgCount = 6;
    scope.$digest();
    expect(handler).toHaveBeenCalledTimes(1);

    // Transition to a covered key and BACK is a fresh key transition —
    // a second report fires.
    scope.msgCount = 1;
    scope.$digest();
    expect(element.textContent).toBe('You have one new message.');
    expect(handler).toHaveBeenCalledTimes(1);

    scope.msgCount = 5;
    scope.$digest();
    expect(element.textContent).toBe('');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('a non-object `when` expression degrades to an empty table — every valid count takes the missing-rule path', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.msgCount = 1;

    const element = makePluralize('element', 'msgCount', '42');
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toBeInstanceOf(NgPluralizeNoRuleDefinedError);
  });

  it('non-string values inside the `when` map are skipped at table-build time', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.msgCount = 1;

    // The 'one' entry is a number, not a message string — it never
    // enters the compiled table, so count 1 misses and reports.
    const element = makePluralize('element', 'msgCount', "{'one': 5, 'other': 'OTHER'}");
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('');
    expect(handler).toHaveBeenCalledTimes(1);
    const err = handler.mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(NgPluralizeNoRuleDefinedError);
    expect((err as Error).message).toContain('no rule defined for "one"');

    // The string-valued 'other' entry still works.
    scope.msgCount = 2;
    scope.$digest();
    expect(element.textContent).toBe('OTHER');
  });

  it('a NaN interlude resets the transition tracker — the same uncovered key re-reports afterwards', () => {
    // Pins the implemented behavior: `lastKey` doubles as the NaN
    // sentinel (null), so uncovered → NaN → same-uncovered counts as
    // TWO key transitions and reports twice. The NaN fire itself
    // never reports (FS §2.8). Documented development-time signal,
    // not a bug.
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.msgCount = 5;

    const element = makePluralize('element', 'msgCount', ONE_ONLY_WHEN);
    b.$compile(element)(scope);
    scope.$digest();
    expect(handler).toHaveBeenCalledTimes(1);

    scope.msgCount = 'abc';
    scope.$digest();
    expect(handler).toHaveBeenCalledTimes(1);

    scope.msgCount = 5;
    scope.$digest();
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 9. en-US plural-category dispatch (FS §2.5)
// ---------------------------------------------------------------------------

describe('ngPluralize — en-US locale category dispatch (FS §2.5)', () => {
  const CATEGORY_WHEN = "{'one': 'ONE', 'other': 'OTHER ({})'}";

  it('count 1 selects the "one" category', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.n = 1;

    const element = makePluralize('element', 'n', CATEGORY_WHEN);
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('ONE');
  });

  it.each([
    [0, 'OTHER (0)'],
    [2, 'OTHER (2)'],
    [1.5, 'OTHER (1.5)'],
    [-1, 'OTHER (-1)'],
  ])('count %s selects the "other" category', (count, expected) => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.n = count;

    const element = makePluralize('element', 'n', CATEGORY_WHEN);
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 10. Offset (FS §2.4, spec 029 Slice 3)
// ---------------------------------------------------------------------------

describe('ngPluralize — offset (FS §2.4)', () => {
  /**
   * The canonical FS §2.4 "people viewing" table. Exact-number keys
   * (`'0'` / `'1'` / `'2'`) match the RAW count exactly as written;
   * category selection and the `{}` placeholder use count − offset.
   */
  const PEOPLE_WHEN =
    "{'0': 'Nobody is viewing.', '1': '{{person1}} is viewing.', '2': '{{person1}} and {{person2}} are viewing.', 'one': '{{person1}}, {{person2}} and one other person are viewing.', 'other': '{{person1}}, {{person2}} and {} other people are viewing.'}";

  it.each([
    [0, 'Nobody is viewing.'], // exact key '0' — raw count, no offset applied
    [1, 'Igor is viewing.'], // exact key '1' — raw count (NOT 1 − 2 = −1)
    [2, 'Igor and Misko are viewing.'], // exact key '2' — raw count
    [3, 'Igor, Misko and one other person are viewing.'], // pluralCat(3 − 2) = 'one'
    [4, 'Igor, Misko and 2 other people are viewing.'], // pluralCat(4 − 2) = 'other'; {} shows 2
  ])('offset 2: count %s renders "%s"', (count, expected) => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.viewCount = count;
    scope.person1 = 'Igor';
    scope.person2 = 'Misko';

    const element = makePluralize('element', 'viewCount', PEOPLE_WHEN, '2');
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe(expected);
  });

  it('a ternary count expression survives the parenthesized {} rewrite — both arms see the offset', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.flag = true;

    // Upstream's bare concatenation would rewrite {} to
    // `{{flag ? 5 : 9-2}}` — the offset binds to the ELSE branch only,
    // so the true arm would render 5. The parenthesized rewrite
    // `{{(flag ? 5 : 9)-(2)}}` adjusts BOTH arms.
    const element = makePluralize('element', 'flag ? 5 : 9', "{'other': '{} extra'}", '2');
    b.$compile(element)(scope);
    scope.$digest();
    expect(element.textContent).toBe('3 extra');

    scope.flag = false;
    scope.$digest();
    expect(element.textContent).toBe('7 extra');
  });

  it('a negative offset adds to the displayed number — offset "-1", count 2 → {} shows 3', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.n = 2;

    // The offset operand is parenthesized too: a bare emit would
    // produce the unparseable `(n)--1`; `(n)-(-1)` evaluates to n + 1.
    // pluralCat(2 − (−1)) = pluralCat(3) = 'other'.
    const element = makePluralize('element', 'n', "{'other': '{} items'}", '-1');
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('3 items');
  });

  it('offset="" (empty) is treated as ABSENT — offset 0, NO handler report', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.msgCount = 3;

    const element = makePluralize('element', 'msgCount', CANONICAL_WHEN, '');
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('You have 3 new messages.');
    expect(handler).not.toHaveBeenCalled();
  });

  it('offset="2px" parses as 2 via parseFloat leniency (upstream-identical)', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.n = 5;

    const element = makePluralize('element', 'n', "{'other': '{} more'}", '2px');
    b.$compile(element)(scope);
    scope.$digest();

    // pluralCat(5 − 2) = 'other'; {} shows 3. No bad-offset report.
    expect(element.textContent).toBe('3 more');
    expect(handler).not.toHaveBeenCalled();
  });

  it('offset="abc" routes NgPluralizeBadOffsetError via "$compile" and stays blank through subsequent digests', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.msgCount = 3;

    const element = makePluralize('element', 'msgCount', CANONICAL_WHEN, 'abc');
    b.$compile(element)(scope);

    // Routed ONCE at link time — before any digest runs.
    expect(handler).toHaveBeenCalledTimes(1);
    const err = handler.mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(NgPluralizeBadOffsetError);
    expect((err as Error).name).toBe('NgPluralizeBadOffsetError');
    expect((err as Error).message).toBe(
      'ngPluralize: offset attribute value "abc" is not a number. Provide a numeric offset or remove the attribute.',
    );
    expect(handler.mock.calls[0]?.[1]).toBe('$compile');

    scope.$digest();
    expect(element.textContent).toBe('');

    // No watches were installed: later count changes never re-report
    // and the element stays blank/silent.
    scope.msgCount = 1;
    scope.$digest();
    expect(element.textContent).toBe('');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a bad offset on an element with no "when" takes the SILENT inert bail first — no report', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.msgCount = 3;

    // The missing-`when` inert bail runs BEFORE the offset parse, so
    // the LOUD path fires only when the directive would otherwise be
    // live.
    const element = document.createElement('ng-pluralize');
    element.setAttribute('count', 'msgCount');
    element.setAttribute('offset', 'abc');
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('');
    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 11. Per-key `when-…` attributes (FS §2.7, spec 029 Slice 4)
// ---------------------------------------------------------------------------

describe('ngPluralize — per-key when-… attributes (FS §2.7)', () => {
  it('a pure-attribute directive (no `when` map) behaves identically to the equivalent map across 0 → 1 → 3', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.msgCount = 0;

    const attributeAuthored = makeAttributePluralize('msgCount', {
      'when-0': 'You have no new messages.',
      'when-one': 'You have one new message.',
      'when-other': 'You have {} new messages.',
    });
    const mapAuthored = makePluralize('element', 'msgCount', CANONICAL_WHEN);
    b.$compile(attributeAuthored)(scope);
    b.$compile(mapAuthored)(scope);

    scope.$digest();
    expect(attributeAuthored.textContent).toBe('You have no new messages.');
    expect(attributeAuthored.textContent).toBe(mapAuthored.textContent);

    scope.msgCount = 1;
    scope.$digest();
    expect(attributeAuthored.textContent).toBe('You have one new message.');
    expect(attributeAuthored.textContent).toBe(mapAuthored.textContent);

    scope.msgCount = 3;
    scope.$digest();
    expect(attributeAuthored.textContent).toBe('You have 3 new messages.');
    expect(attributeAuthored.textContent).toBe(mapAuthored.textContent);
  });

  it('when-one="B" OVERRIDES the map\'s \'one\': "A" — count 1 displays "B"', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.msgCount = 1;

    const element = makeAttributePluralize('msgCount', { 'when-one': 'B' }, { when: "{'one': 'A'}" });
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('B');
  });

  it('when-minus-1 registers the exact key "-1" — count −1 matches it (beating the "other" category)', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.msgCount = -1;

    const element = makeAttributePluralize('msgCount', {
      'when-minus-1': 'You owe one message.',
      'when-other': 'OTHER ({})',
    });
    b.$compile(element)(scope);
    scope.$digest();

    // pluralCat(−1) is 'other' under en-US — the exact '-1' key wins.
    expect(element.textContent).toBe('You owe one message.');

    // And the category fallback still works around it.
    scope.msgCount = -2;
    scope.$digest();
    expect(element.textContent).toBe('OTHER (-2)');
  });

  it('{} inside a when-… attribute is replaced — every occurrence', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.msgCount = 4;

    const element = makeAttributePluralize('msgCount', { 'when-other': '{} messages — yes, {}.' });
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('4 messages — yes, 4.');
  });

  it('{{expr}} inside a when-… attribute renders and live-updates WITHOUT a count change', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.viewCount = 1;
    scope.person1 = 'Igor';

    const element = makeAttributePluralize('viewCount', { 'when-one': '{{person1}} is viewing.' });
    b.$compile(element)(scope);
    scope.$digest();
    expect(element.textContent).toBe('Igor is viewing.');

    scope.person1 = 'Misko';
    scope.$digest();
    expect(element.textContent).toBe('Misko is viewing.');
  });

  it("the raw attribute text is the message — never $eval'd as an expression", () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.msgCount = 1;
    scope.someExpr = 'evaluated!';

    const element = makeAttributePluralize('msgCount', { 'when-one': 'someExpr + 1' });
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('someExpr + 1');
  });

  it('combined map + attributes + offset: exact keys raw, attribute overrides map, {} offset-adjusted', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.viewCount = 0;
    scope.person1 = 'Igor';
    scope.person2 = 'Misko';

    // Map supplies '0' and a decoy 'one'; attributes supply the exact
    // '2', the OVERRIDING 'one', and 'other' with an offset-adjusted {}.
    const element = makeAttributePluralize(
      'viewCount',
      {
        'when-2': '{{person1}} and {{person2}} are viewing.',
        'when-one': '{{person1}}, {{person2}} and one other person are viewing.',
        'when-other': '{{person1}}, {{person2}} and {} other people are viewing.',
      },
      { when: "{'0': 'Nobody is viewing.', 'one': 'MAP DECOY — must never render'}", offset: '2' },
    );
    b.$compile(element)(scope);

    scope.$digest();
    expect(element.textContent).toBe('Nobody is viewing.'); // map exact '0', raw count

    scope.viewCount = 2;
    scope.$digest();
    expect(element.textContent).toBe('Igor and Misko are viewing.'); // attribute exact '2', raw count

    scope.viewCount = 3;
    scope.$digest();
    // pluralCat(3 − 2) = 'one' — the ATTRIBUTE message wins over the map decoy.
    expect(element.textContent).toBe('Igor, Misko and one other person are viewing.');

    scope.viewCount = 4;
    scope.$digest();
    expect(element.textContent).toBe('Igor, Misko and 2 other people are viewing.'); // {} = 4 − 2
  });

  it('when-one="" is a valid BLANK message — live, written as empty text, NOT the missing-rule path', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.msgCount = 1;

    const element = makeAttributePluralize('msgCount', { 'when-one': '', 'when-other': 'OTHER' });
    element.textContent = 'initial';
    b.$compile(element)(scope);
    scope.$digest();

    // The blank message is WRITTEN (clearing the initial text proves a
    // live message watch fired) and nothing is reported.
    expect(element.textContent).toBe('');
    expect(handler).not.toHaveBeenCalled();

    scope.msgCount = 2;
    scope.$digest();
    expect(element.textContent).toBe('OTHER');
    expect(handler).not.toHaveBeenCalled();
  });

  it('a single when-… attribute alone is a message SOURCE — the directive is live, and an uncovered key reports', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.msgCount = 5;

    const element = makeAttributePluralize('msgCount', { 'when-one': 'You have one new message.' });
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('');
    expect(handler).toHaveBeenCalledTimes(1);
    const err = handler.mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(NgPluralizeNoRuleDefinedError);
    // Pure-attribute form: no `when` attribute to quote, so the report
    // names the source family with the literal stand-in descriptor.
    expect((err as Error).message).toBe(
      'ngPluralize: no rule defined for "other" in "when-… attributes". Add a message for that exact value or plural category.',
    );
    expect(handler.mock.calls[0]?.[1]).toBe('$compile');
  });

  it('when="{}" (present but empty table) keeps the directive LIVE — missing-rule path quotes the literal source', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.msgCount = 3;

    // Presence of a source, not table contents, decides liveness: this
    // is NOT the silent inert bail — a valid count reports.
    const element = makePluralize('element', 'msgCount', '{}');
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('');
    expect(handler).toHaveBeenCalledTimes(1);
    const err = handler.mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(NgPluralizeNoRuleDefinedError);
    // The `when` map attribute exists, so ITS text (not the attribute
    // stand-in) is the quoted source.
    expect((err as Error).message).toBe(
      'ngPluralize: no rule defined for "other" in "{}". Add a message for that exact value or plural category.',
    );
    expect(handler.mock.calls[0]?.[1]).toBe('$compile');
  });

  it('data-when-one and x-when-3 prefixed forms normalize into the scan', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.msgCount = 1;

    // `directiveNormalize` strips the (x|data) prefix before the
    // `/^when(Minus)?(.+)$/` scan sees the name: `data-when-one` →
    // `whenOne` → key 'one'; `x-when-3` → `when3` → key '3'.
    const element = makeAttributePluralize('msgCount', {
      'data-when-one': 'DATA ONE',
      'x-when-3': 'X THREE',
    });
    b.$compile(element)(scope);
    scope.$digest();
    expect(element.textContent).toBe('DATA ONE');

    scope.msgCount = 3;
    scope.$digest();
    expect(element.textContent).toBe('X THREE');
  });

  it('a bare when-minus attribute backtracks to the key "minus" — a message source that no numeric count reaches', () => {
    // Upstream-identical quirk: `/^when(Minus)?(.+)$/` on `whenMinus`
    // backtracks the optional group, yielding the key 'minus' — never
    // '-…'. No numeric count produces the exact key 'minus' and the
    // en-US pluralCat only emits 'one'/'other', so the entry is
    // unreachable; but it IS a message source (liveness) and never
    // shadows real keys.
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const scope = Scope.create();
    scope.msgCount = 1;

    const element = makeAttributePluralize('msgCount', { 'when-minus': 'UNREACHABLE' });
    b.$compile(element)(scope);
    scope.$digest();

    // Live (not the silent inert bail) — count 1 resolves to the
    // uncovered 'one' key and takes the missing-rule report path.
    expect(element.textContent).toBe('');
    expect(handler).toHaveBeenCalledTimes(1);
    const err = handler.mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(NgPluralizeNoRuleDefinedError);
    expect((err as Error).message).toContain('no rule defined for "one" in "when-… attributes"');
  });
});
