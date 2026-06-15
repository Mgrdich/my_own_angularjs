/**
 * AngularJS 1.x parity tests for spec 030 (the five compatibility /
 * template / anchor / ref built-in directives — `script`, `ngRef`
 * (+`ngRefRead`), `a`, and the two no-ops `ngCsp` / `ngJq`).
 *
 * This file is a focused "canonical patterns" regression guard rather
 * than a verbatim upstream port — `angular/angular.js` is not vendored
 * locally, so each block below codifies a publicly-documented AngularJS
 * 1.x behavior that the spec-030 directives must satisfy. The per-slice
 * files (`script-template.test.ts`, `ng-ref.test.ts`,
 * `html-anchor.test.ts`, `ng-compat-switches.test.ts`) cover the full
 * FS §2 acceptance grid; this file pins the cross-cutting surfaces:
 *
 *  - **Compat no-op identical-render** — all FIVE classic `ng-csp` /
 *    `ng-jq` value forms render IDENTICALLY to the same page without the
 *    attribute, with ZERO `$exceptionHandler` calls (FS §2.x — the
 *    no-ops are inert by construction; presence === absence).
 *  - **FS success-criteria composite** — one page wiring several
 *    spec-030 features together: an inline `<script type="text/ng-template">`
 *    consumed via `ng-include`, an `ng-ref` published in a
 *    scope-faithful way, a placeholder `<a href="">` whose click is
 *    guarded, and `ng-csp` on the root — all in one compiled tree.
 *  - **`ng-ref` inside an `ng-repeat` row** — a composition smoke test:
 *    several rows, each carrying an `ng-ref`, compile / digest / render
 *    the expected row count without errors.
 *
 * Plus the `EXCEPTION_HANDLER_CAUSES.length === 10` regression guard —
 * spec 030 introduces new error classes (`NgRefBadExpressionError`,
 * `NgRefNoControllerError`) but ZERO new cause tokens; both route via
 * the existing `'$compile'` token.
 *
 * Mirrors the structural precedent set by
 * `src/compiler/__tests__/spec029-parity.test.ts` (and the
 * `EXCEPTION_HANDLER_CAUSES.length === 10` regression-guard pattern
 * established by spec 023 → spec 029).
 *
 * @see context/spec/030-csp-template-cache-element-overrides/functional-spec.md
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService } from '@compiler/directive-types';
import { $ControllerProvider } from '@controller/controller-provider';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { EXCEPTION_HANDLER_CAUSES, type ExceptionHandler } from '@exception-handler/index';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import { createTemplateCache } from '@template/template-cache';
import { createTemplateRequest } from '@template/template-request';
import type { TemplateCacheService, TemplateRequestFn } from '@template/template-types';

type ExceptionSpy = ReturnType<typeof vi.fn<ExceptionHandler>>;

interface Bootstrap {
  $compile: CompileService;
  exceptionSpy: ExceptionSpy;
}

/**
 * Bootstrap an injector wired with the production `ngModule` (so the
 * five spec-030 directives registered there are reachable end-to-end).
 * The `app` module installs a spy `$exceptionHandler` (app loads after
 * `ng`, so its factory wins per last-wins) so the no-op / composite
 * tests can assert ZERO routing. `$controller` is registered alongside
 * `$compile` so the `ng-ref` component-publish path resolves a
 * controller seam.
 *
 * Mirrors the `ng-ref.test.ts` / `html-anchor.test.ts` bootstrap shape.
 */
function bootstrap(): Bootstrap {
  resetRegistry();
  const exceptionSpy: ExceptionSpy = vi.fn<ExceptionHandler>();

  createModule('ng', [])
    .factory('$exceptionHandler', [() => (): void => undefined])
    .provider('$sceDelegate', $SceDelegateProvider)
    .provider('$sce', $SceProvider)
    .provider('$interpolate', $InterpolateProvider)
    .provider('$filter', ['$provide', $FilterProvider])
    .provider('$controller', ['$provide', $ControllerProvider])
    .factory('$templateCache', [() => createTemplateCache()])
    .factory('$templateRequest', [
      '$templateCache',
      (cache: TemplateCacheService): TemplateRequestFn => createTemplateRequest({ cache }),
    ])
    .provider('$compile', ['$provide', $CompileProvider]);

  const appModule = createModule('app-spec030-parity', ['ng']).factory('$exceptionHandler', [
    (): ExceptionHandler => exceptionSpy,
  ]);
  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get('$compile'),
    exceptionSpy,
  };
}

/**
 * Flush microtasks until the `ngInclude` resolution chain (drain
 * schedule → `$templateRequest` resolution → clone install) has fully
 * settled. Three cycles are defensive across the cache-hit path.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** Dispatch a cancelable click and return the dispatched event. */
function clickOn(el: Element): MouseEvent {
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
}

/**
 * Filter out the incidental "expected placeholder to be a Comment"
 * throws that fire whenever a `transclude: 'element'` directive's link
 * fn runs against the captured master clone (a pre-existing framework
 * artifact of the structural hosts `ng-if` / `ng-repeat` / `ng-include`,
 * NOT a spec-030 behavior). The same helper precedent lives in
 * `ng-repeat.test.ts` and `spec029-parity.test.ts`.
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
// Cause-token regression guard — spec 030 introduces ZERO new tokens.
// Kept at the TOP so a future contributor adding a token notices the
// failure immediately. The spec-030 error classes
// (`NgRefBadExpressionError`, `NgRefNoControllerError`) route via the
// existing `'$compile'` cause token introduced by spec 017.
// ---------------------------------------------------------------------

describe('parity: EXCEPTION_HANDLER_CAUSES regression', () => {
  it('keeps the tuple at exactly 10 entries after spec 030', () => {
    expect(EXCEPTION_HANDLER_CAUSES.length).toBe(10);
    expect(EXCEPTION_HANDLER_CAUSES).toContain('$compile');
  });
});

// ---------------------------------------------------------------------
// Compat no-op identical-render — all FIVE classic value forms.
// Upstream: `ng-csp` / `ng-jq` are migration-compatibility switches;
// in THIS framework they have nothing to reconfigure (tree-walking
// interpreter, no inline-style injection, no jqLite layer), so every
// classic form is inert — presence renders identically to absence and
// reports nothing (FS §2.x, ng-compat-switches.ts).
// ---------------------------------------------------------------------

describe('parity: ng-csp / ng-jq are inert no-ops (FS §2.x)', () => {
  /** The five classic forms, as `[attrName, attrValue]` pairs (`null` = bare presence). */
  const CLASSIC_FORMS: readonly (readonly [name: string, value: string | null])[] = [
    ['ng-csp', null], // bare
    ['ng-csp', 'no-unsafe-eval'],
    ['ng-csp', 'no-inline-style'],
    ['ng-jq', null], // bare
    ['ng-jq', 'jQuery'],
  ];

  /**
   * Compile a small `<div [attr]><span ng-bind="msg"></span></div>` and
   * return the rendered text. Passing `null` attr name builds the
   * no-attribute baseline.
   */
  function render(b: Bootstrap, attr: readonly [name: string, value: string | null] | null): string | null {
    const scope = Scope.create<{ msg: string }>();
    scope.msg = 'hello world';

    const host = document.createElement('div');
    if (attr !== null) {
      const [name, value] = attr;
      host.setAttribute(name, value ?? '');
    }
    const inner = document.createElement('span');
    inner.setAttribute('ng-bind', 'msg');
    host.appendChild(inner);

    b.$compile(host)(scope);
    scope.$digest();
    return host.textContent;
  }

  it.each(CLASSIC_FORMS)(
    'with %s="%s": renders identically to the no-attribute baseline, ZERO handler calls',
    (name, value) => {
      // Baseline (no attribute) and the attributed page are compiled in
      // independent injectors so neither leaks state into the other.
      const baselineBoot = bootstrap();
      const baseline = render(baselineBoot, null);
      expect(baselineBoot.exceptionSpy).not.toHaveBeenCalled();

      const attributedBoot = bootstrap();
      const attributed = render(attributedBoot, [name, value]);

      // The attribute changes nothing about the rendered output.
      expect(attributed).toBe(baseline);
      expect(attributed).toBe('hello world');
      // And no error is routed — the no-op never reads its value.
      expect(attributedBoot.exceptionSpy).not.toHaveBeenCalled();
    },
  );
});

// ---------------------------------------------------------------------
// FS success-criteria composite — several spec-030 features in ONE page.
// An inline <script type="text/ng-template"> consumed via ng-include,
// an ng-ref published scope-faithfully (the ref element shares the same
// scope as the markup that reads it back — per the documented
// publish-onto-linked-scope divergence), a placeholder <a href=""> whose
// click is guarded, and ng-csp on the root, all compiled together.
// ---------------------------------------------------------------------

describe('parity: spec-030 composite page (FS success criteria)', () => {
  it('inline template + ng-include + ng-ref + anchor guard + ng-csp all work together', async () => {
    const b = bootstrap();
    // The `ng-ref` element and the markup reading it back BOTH link
    // against this same outer `scope` (the ref element is a plain
    // <input>, not a component, so it has no isolate scope — ngRef writes
    // onto the scope it is linked against, which is the shared outer one).
    const scope = Scope.create<{ title: string; box?: Element }>();
    scope.title = 'Composite';

    const root = document.createElement('div');
    // ng-csp on the root — inert, must change nothing below it.
    root.setAttribute('ng-csp', '');

    // (1) Inline named template registered into $templateCache at compile.
    const script = document.createElement('script');
    script.setAttribute('type', 'text/ng-template');
    script.setAttribute('id', 'panel.html');
    // `ng-bind` body — this compiler has no text-node interpolation, so
    // the load-bearing render goes through the directive surface.
    script.textContent = '<span class="panel" ng-bind="title"></span>';
    root.appendChild(script);

    // (2) ng-include consuming the inline template by name.
    const include = document.createElement('div');
    include.setAttribute('ng-include', "'panel.html'");
    root.appendChild(include);

    // (3) ng-ref on a plain element sharing the outer scope.
    const box = document.createElement('input');
    box.setAttribute('ng-ref', 'box');
    root.appendChild(box);

    // (4) placeholder <a href=""> whose click must be guarded.
    const anchor = document.createElement('a');
    anchor.setAttribute('href', '');
    anchor.textContent = 'Placeholder';
    root.appendChild(anchor);

    b.$compile(root)(scope);
    scope.$digest();
    await flushMicrotasks();
    scope.$digest();

    // ng-include rendered the inline template with the binding resolved.
    expect(root.querySelector('.panel')?.textContent).toBe('Composite');
    expect(root.querySelector('.from-net')).toBeNull();

    // ng-ref published the native <input> onto the shared scope; it is
    // usable (identity holds).
    expect(scope.box).toBe(box);
    expect(scope.box).toBeInstanceOf(HTMLInputElement);

    // The anchor guard prevents navigation on the empty placeholder link.
    const ev = clickOn(anchor);
    expect(ev.defaultPrevented).toBe(true);

    // The whole composite reported nothing (incidental structural-host
    // master-clone routing filtered — see `relevantHandlerCalls`).
    expect(relevantHandlerCalls(b.exceptionSpy)).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// ng-ref inside an ng-repeat row — composition smoke test.
// Each row carries an `ng-ref="rowRef"` plus an `ng-bind` on the row
// item. ngRef writes `rowRef` onto each row's CLONE scope (the
// scope-faithful publish target — `ng-repeat` rows each get their own
// child scope), so the publish is observed FROM the row, mirroring how
// markup INSIDE the row would consume it. The assertion is a smoke
// check: the expected number of rows compile, digest, and render the
// per-row ref-bearing element without unexpected reports.
// ---------------------------------------------------------------------

describe('parity: ng-ref inside an ng-repeat row (composition smoke)', () => {
  it('renders one ng-ref-bearing element per row, digests cleanly, no errors', () => {
    const b = bootstrap();
    const scope = Scope.create<{ items: readonly string[] }>();
    scope.items = ['a', 'b', 'c'];

    const parent = document.createElement('div');
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'item in items');
    // Each row's <span> publishes itself under `rowRef` on the row's
    // own clone scope, and binds the row item alongside.
    const inner = document.createElement('span');
    inner.setAttribute('ng-ref', 'rowRef');
    inner.setAttribute('ng-bind', 'item');
    host.appendChild(inner);
    parent.appendChild(host);

    b.$compile(parent)(scope);
    scope.$digest();

    // Three rows rendered, each binding its row item.
    const rows = Array.from(parent.querySelectorAll('li'));
    expect(rows).toHaveLength(3);
    expect(rows.map((li) => li.textContent)).toEqual(['a', 'b', 'c']);

    // Each row carries exactly one ng-ref-bearing <span>.
    const refSpans = Array.from(parent.querySelectorAll('span[ng-ref]'));
    expect(refSpans).toHaveLength(3);
    for (const span of refSpans) {
      expect(span).toBeInstanceOf(HTMLSpanElement);
    }

    // Reconcile on a list update — the surviving / new rows still render.
    scope.items = ['a', 'c'];
    scope.$digest();
    expect(Array.from(parent.querySelectorAll('li')).map((li) => li.textContent)).toEqual(['a', 'c']);

    // No unexpected reports across the mount / reconcile (the incidental
    // structural master-clone routing is filtered — see
    // `relevantHandlerCalls`).
    expect(relevantHandlerCalls(b.exceptionSpy)).toEqual([]);
  });
});
