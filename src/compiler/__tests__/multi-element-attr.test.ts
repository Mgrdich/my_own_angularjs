/**
 * Multi-element / ranged directives — Slice 3 (Mode B for non-transclude
 * directives: `ng-show`, `ng-hide`, `ng-class`, plus custom opt-in).
 *
 * Locks the spec-033 Slice 3 surface: a `multiElement` directive that does
 * NOT declare `transclude` applies to EVERY node in the `<name>-start` /
 * `<name>-end` range, not just the two endpoints. The compiler's Mode B
 * path propagates the start element's expression onto each grouped element
 * so the normal per-element link installs the directive there (one watch
 * per node, all bound to the same expression — a deliberate
 * clarity-over-performance choice with identical observable behavior).
 *
 * Coverage mapped to the Slice 3 task list (FS §2.1):
 *   - `ng-show-start` / `-end`: every range node (INCLUDING the middle
 *     node) shows when truthy and hides when falsy; toggling works.
 *   - `ng-hide-start` / `-end`: same, inverted.
 *   - `ng-class-start` / `-end`: computed classes applied to EVERY range
 *     node and updated on change.
 *   - A custom developer directive with `multiElement: true`
 *     (non-transclude) works in the ranged form — applied to every node.
 *   - The single-element forms of `ng-show` / `ng-hide` / `ng-class` are
 *     unchanged.
 *   - Missing `-end` → `UnterminatedMultiElementDirectiveError` routed via
 *     `$exceptionHandler('$compile')`, DOM left untouched.
 *   - ZERO spurious `$compile` notices on the happy paths.
 *
 * Bootstrap mirrors `multi-element-range.test.ts` (production `ngModule`
 * for the built-ins + an `app` module carrying a recording
 * `$exceptionHandler`, with an optional config-block registration hook
 * for the custom directive).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import { UnterminatedMultiElementDirectiveError } from '@compiler/compile-error';
import type { CompileService, DirectiveFactory, DirectiveFactoryReturn, LinkFn } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { type AnyModule, createModule, resetRegistry } from '@di/module';
import type { ExceptionHandler } from '@exception-handler/index';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import { createTemplateCache } from '@template/template-cache';
import { createTemplateRequest } from '@template/template-request';
import type { TemplateCacheService, TemplateRequestFn } from '@template/template-types';

interface HandlerCall {
  error: unknown;
  cause: unknown;
}

interface Bootstrap {
  $compile: CompileService;
  handlerCalls: HandlerCall[];
}

interface BootstrapOptions {
  register?: (appModule: AnyModule, $cp: $CompileProvider) => void;
}

function bootstrap(options?: BootstrapOptions): Bootstrap {
  const handlerCalls: HandlerCall[] = [];
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

  const appModule = createModule('app-multi-element-attr', ['ng']);
  const handler: ExceptionHandler = (error: unknown, cause?: string) => {
    handlerCalls.push({ error, cause });
  };
  appModule.factory('$exceptionHandler', [() => handler]);
  if (options?.register !== undefined) {
    const reg = options.register;
    appModule.config([
      '$compileProvider',
      ($cp: $CompileProvider) => {
        reg(appModule, $cp);
      },
    ]);
  }
  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get('$compile'),
    handlerCalls,
  };
}

/** Create a `<div>` with the given attributes set. */
function div(attrs: Record<string, string>, text = ''): HTMLDivElement {
  const el = document.createElement('div');
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  if (text.length > 0) {
    el.textContent = text;
  }
  return el;
}

/** The element children of `parent`, in DOM order. */
function elementsOf(parent: HTMLElement): HTMLElement[] {
  return Array.from(parent.children) as HTMLElement[];
}

/** Filter handler calls down to only `$compile`-cause notices. */
function compileNotices(calls: readonly HandlerCall[]): readonly HandlerCall[] {
  return calls.filter((c) => c.cause === '$compile');
}

afterEach(() => {
  resetRegistry();
});

// ---------------------------------------------------------------------------
// 1. ng-show-start / -end — show/hide every range node together
// ---------------------------------------------------------------------------

describe('multi-element ng-show — start/end range (FS §2.1)', () => {
  it('hides EVERY range node (incl. the middle node) when the expression is falsy', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.visible = false;

    const host = document.createElement('div');
    host.appendChild(div({ 'ng-show-start': 'visible' }, 'first'));
    host.appendChild(div({}, 'middle')); // middle node — part of the group
    host.appendChild(div({ 'ng-show-end': '' }, 'last'));

    b.$compile(host)(scope);
    scope.$digest();

    const els = elementsOf(host);
    expect(els.length).toBe(3);
    for (const el of els) {
      expect(el.classList.contains('ng-hide')).toBe(true);
    }
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('shows EVERY range node when the expression is truthy', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.visible = true;

    const host = document.createElement('div');
    host.appendChild(div({ 'ng-show-start': 'visible' }, 'first'));
    host.appendChild(div({}, 'middle'));
    host.appendChild(div({ 'ng-show-end': '' }, 'last'));

    b.$compile(host)(scope);
    scope.$digest();

    for (const el of elementsOf(host)) {
      expect(el.classList.contains('ng-hide')).toBe(false);
    }
  });

  it('toggles every range node together on a value change', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.visible = true;

    const host = document.createElement('div');
    host.appendChild(div({ 'ng-show-start': 'visible' }, 'first'));
    host.appendChild(div({}, 'middle'));
    host.appendChild(div({ 'ng-show-end': '' }, 'last'));

    b.$compile(host)(scope);
    scope.$digest();
    for (const el of elementsOf(host)) {
      expect(el.classList.contains('ng-hide')).toBe(false);
    }

    scope.visible = false;
    scope.$digest();
    for (const el of elementsOf(host)) {
      expect(el.classList.contains('ng-hide')).toBe(true);
    }

    scope.visible = true;
    scope.$digest();
    for (const el of elementsOf(host)) {
      expect(el.classList.contains('ng-hide')).toBe(false);
    }
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. ng-hide-start / -end — inverse of ng-show
// ---------------------------------------------------------------------------

describe('multi-element ng-hide — start/end range (FS §2.1)', () => {
  it('hides EVERY range node when the expression is truthy', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.hidden = true;

    const host = document.createElement('div');
    host.appendChild(div({ 'ng-hide-start': 'hidden' }, 'first'));
    host.appendChild(div({}, 'middle'));
    host.appendChild(div({ 'ng-hide-end': '' }, 'last'));

    b.$compile(host)(scope);
    scope.$digest();

    const els = elementsOf(host);
    expect(els.length).toBe(3);
    for (const el of els) {
      expect(el.classList.contains('ng-hide')).toBe(true);
    }
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('shows EVERY range node when the expression is falsy and toggles', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.hidden = false;

    const host = document.createElement('div');
    host.appendChild(div({ 'ng-hide-start': 'hidden' }, 'first'));
    host.appendChild(div({}, 'middle'));
    host.appendChild(div({ 'ng-hide-end': '' }, 'last'));

    b.$compile(host)(scope);
    scope.$digest();
    for (const el of elementsOf(host)) {
      expect(el.classList.contains('ng-hide')).toBe(false);
    }

    scope.hidden = true;
    scope.$digest();
    for (const el of elementsOf(host)) {
      expect(el.classList.contains('ng-hide')).toBe(true);
    }
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. ng-class-start / -end — apply computed classes to every range node
// ---------------------------------------------------------------------------

describe('multi-element ng-class — start/end range (FS §2.1)', () => {
  it('applies the computed classes to EVERY range node (incl. the middle)', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.cls = 'active';

    const host = document.createElement('div');
    host.appendChild(div({ 'ng-class-start': 'cls' }, 'first'));
    host.appendChild(div({}, 'middle'));
    host.appendChild(div({ 'ng-class-end': '' }, 'last'));

    b.$compile(host)(scope);
    scope.$digest();

    const els = elementsOf(host);
    expect(els.length).toBe(3);
    for (const el of els) {
      expect(el.classList.contains('active')).toBe(true);
    }
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('updates the applied classes on every range node when the value changes', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.cls = 'active';

    const host = document.createElement('div');
    host.appendChild(div({ 'ng-class-start': 'cls' }, 'first'));
    host.appendChild(div({}, 'middle'));
    host.appendChild(div({ 'ng-class-end': '' }, 'last'));

    b.$compile(host)(scope);
    scope.$digest();
    for (const el of elementsOf(host)) {
      expect(el.classList.contains('active')).toBe(true);
    }

    scope.cls = 'inactive';
    scope.$digest();
    for (const el of elementsOf(host)) {
      expect(el.classList.contains('active')).toBe(false);
      expect(el.classList.contains('inactive')).toBe(true);
    }
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('preserves consumer-shipped classes on every range node (object form)', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.state = { active: true, disabled: false };

    const host = document.createElement('div');
    host.appendChild(div({ class: 'card', 'ng-class-start': 'state' }, 'first'));
    host.appendChild(div({ class: 'card' }, 'middle'));
    host.appendChild(div({ class: 'card', 'ng-class-end': '' }, 'last'));

    b.$compile(host)(scope);
    scope.$digest();

    for (const el of elementsOf(host)) {
      expect(el.classList.contains('card')).toBe(true);
      expect(el.classList.contains('active')).toBe(true);
      expect(el.classList.contains('disabled')).toBe(false);
    }
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Custom developer directive opting into multiElement (non-transclude)
// ---------------------------------------------------------------------------

describe('multi-element custom directive — non-transclude opt-in (FS §2.1)', () => {
  it('applies a custom multiElement directive to every node in the range', () => {
    const b = bootstrap({
      register: (_appModule, $cp) => {
        const link: LinkFn = (scope, element, attrs) => {
          const expr = attrs['markRange'];
          if (typeof expr !== 'string') {
            return;
          }
          scope.$watch(expr, (value: unknown) => {
            element.setAttribute('data-mark', String(value));
          });
        };
        const factory: DirectiveFactory = [
          (): DirectiveFactoryReturn => ({
            restrict: 'A',
            multiElement: true,
            link,
          }),
        ];
        $cp.directive('markRange', factory);
      },
    });

    const scope = Scope.create();
    scope.label = 'hello';

    const host = document.createElement('div');
    host.appendChild(div({ 'mark-range-start': 'label' }, 'first'));
    host.appendChild(div({}, 'middle'));
    host.appendChild(div({ 'mark-range-end': '' }, 'last'));

    b.$compile(host)(scope);
    scope.$digest();

    const els = elementsOf(host);
    expect(els.length).toBe(3);
    for (const el of els) {
      expect(el.getAttribute('data-mark')).toBe('hello');
    }

    scope.label = 'world';
    scope.$digest();
    for (const el of elementsOf(host)) {
      expect(el.getAttribute('data-mark')).toBe('world');
    }
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Single-element forms unchanged (additivity)
// ---------------------------------------------------------------------------

describe('multi-element Mode B — single-element forms unchanged (FS §2.1)', () => {
  it('plain ng-show on a single element still toggles', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.visible = false;

    const host = document.createElement('div');
    host.appendChild(div({ 'ng-show': 'visible' }, 'solo'));

    b.$compile(host)(scope);
    scope.$digest();

    const el = elementsOf(host)[0];
    expect(el?.classList.contains('ng-hide')).toBe(true);

    scope.visible = true;
    scope.$digest();
    expect(el?.classList.contains('ng-hide')).toBe(false);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('plain ng-hide on a single element still toggles', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.hidden = true;

    const host = document.createElement('div');
    host.appendChild(div({ 'ng-hide': 'hidden' }, 'solo'));

    b.$compile(host)(scope);
    scope.$digest();

    const el = elementsOf(host)[0];
    expect(el?.classList.contains('ng-hide')).toBe(true);

    scope.hidden = false;
    scope.$digest();
    expect(el?.classList.contains('ng-hide')).toBe(false);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });

  it('plain ng-class on a single element still applies classes', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.cls = 'active';

    const host = document.createElement('div');
    host.appendChild(div({ 'ng-class': 'cls' }, 'solo'));

    b.$compile(host)(scope);
    scope.$digest();

    const el = elementsOf(host)[0];
    expect(el?.classList.contains('active')).toBe(true);
    expect(compileNotices(b.handlerCalls)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. Unterminated range → UnterminatedMultiElementDirectiveError, DOM intact
// ---------------------------------------------------------------------------

describe('multi-element Mode B — unterminated range (FS §2.1)', () => {
  it('routes UnterminatedMultiElementDirectiveError via "$compile" for a missing ng-show-end', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.visible = false;

    const host = document.createElement('div');
    // ng-show-start with NO matching ng-show-end sibling.
    host.appendChild(div({ 'ng-show-start': 'visible' }, 'first'));
    host.appendChild(div({}, 'middle'));

    b.$compile(host)(scope);
    scope.$digest();

    const notices = compileNotices(b.handlerCalls);
    expect(notices.length).toBeGreaterThanOrEqual(1);
    expect(notices[0]?.error).toBeInstanceOf(UnterminatedMultiElementDirectiveError);

    // DOM untouched — both elements still present, no ng-hide class applied
    // (the directive went inert before any watch was installed).
    const els = elementsOf(host);
    expect(els.length).toBe(2);
    for (const el of els) {
      expect(el.classList.contains('ng-hide')).toBe(false);
    }
  });

  it('routes the error for a missing custom-directive -end', () => {
    const b = bootstrap({
      register: (_appModule, $cp) => {
        const factory: DirectiveFactory = [
          (): DirectiveFactoryReturn => ({
            restrict: 'A',
            multiElement: true,
            link: () => undefined,
          }),
        ];
        $cp.directive('markRange', factory);
      },
    });

    const scope = Scope.create();
    scope.label = 'x';

    const host = document.createElement('div');
    host.appendChild(div({ 'mark-range-start': 'label' }, 'first'));
    host.appendChild(div({}, 'middle'));

    b.$compile(host)(scope);
    scope.$digest();

    const notices = compileNotices(b.handlerCalls);
    expect(notices.length).toBeGreaterThanOrEqual(1);
    expect(notices[0]?.error).toBeInstanceOf(UnterminatedMultiElementDirectiveError);
  });
});
