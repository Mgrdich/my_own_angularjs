/**
 * AngularJS 1.x parity tests for spec 023 (Visibility & Binding
 * Directives).
 *
 * This file is a focused "canonical patterns" regression guard rather
 * than a verbatim port — the upstream `angular/angular.js` repo is not
 * vendored locally, so each test below codifies a publicly-documented
 * AngularJS 1.x behavior that the spec-023 built-ins must satisfy.
 *
 * Coverage scope (1–3 tests per directive — these are GUARDS, not
 * duplicates of the per-directive test files):
 *
 * - `ng-bind` escapes HTML.
 * - `ng-bind-html` requires SCE trust (untrusted plain string throws
 *   without `ngSanitize`, sanitizes WITH).
 * - `ng-bind-template` interpolates multiple expressions.
 * - `ng-show` toggles the canonical `.ng-hide` class.
 * - `ng-hide` mirrors `ng-show` with inverted truthiness.
 * - `ng-cloak` strips its own attribute + class at compile time.
 * - `ng-non-bindable` halts child compilation (the spec 023 hallmark).
 *
 * Animation-related upstream cases (`$animate.enter / .leave` hooks on
 * `ng-show`/`ng-hide`/`ng-cloak`) sit as `it.skip(...)` citing the
 * Phase 4 Animations roadmap item — the parity surface is documented
 * even when the underlying service is not yet in the project.
 *
 * Mirrors the structural precedent set by
 * `src/compiler/__tests__/spec022-parity.test.ts` (and the
 * `EXCEPTION_HANDLER_CAUSES.length === 10` regression guard pattern
 * from there).
 *
 * @see context/spec/023-visibility-and-binding-directives/functional-spec.md
 * @see context/spec/023-visibility-and-binding-directives/technical-considerations.md
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService, DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { EXCEPTION_HANDLER_CAUSES } from '@exception-handler/index';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { ngSanitize } from '@sanitize/ng-sanitize-module';
import { $SanitizeProvider } from '@sanitize/sanitize-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import type { SceService } from '@sce/sce-types';
import { createTemplateCache } from '@template/template-cache';
import { createTemplateRequest } from '@template/template-request';
import type { TemplateCacheService, TemplateRequestFn } from '@template/template-types';

interface Bootstrap {
  $compile: CompileService;
  $sce: SceService;
}

/**
 * Build an injector rooted at the canonical `ngModule` so EVERY spec
 * 023 built-in directive registered by `src/core/ng-module.ts` is
 * reachable end-to-end. The leading `createModule('ng', […])` stanza
 * mirrors the per-directive test-file pattern — it seeds the provider
 * graph the canonical `ngModule` then overrides on import.
 *
 * Pass `withSanitize: true` to additionally register `ngSanitize` for
 * the `ng-bind-html` group that exercises the `$sce → $sanitize`
 * integration.
 */
function bootstrap(options?: { withSanitize?: boolean }): Bootstrap {
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

  if (options?.withSanitize) {
    createModule('ngSanitize', []).provider('$sanitize', $SanitizeProvider);
  }

  const deps = options?.withSanitize ? ['ng', 'ngSanitize'] : ['ng'];
  const appModule = createModule('app', deps);
  const modulesToLoad = options?.withSanitize ? [ngModule, ngSanitize, appModule] : [ngModule, appModule];
  const built = createInjector(modulesToLoad);
  return {
    $compile: built.get('$compile'),
    $sce: built.get('$sce'),
  };
}

/**
 * Build an injector with the canonical `ngModule` PLUS an extra
 * `config` block that lets a parity test register a custom child
 * directive (e.g. to prove that `ng-non-bindable` halts child
 * compilation). Mirrors the `compileWith` helper from the test-helpers
 * file, but layered over the FULL `ngModule` instead of the
 * minimal-bootstrap version that lacks the spec 023 directives.
 */
function bootstrapWithExtras(register: ($cp: $CompileProvider) => void): Bootstrap {
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

  const appModule = createModule('app', ['ng']).config([
    '$compileProvider',
    ($cp: $CompileProvider) => {
      register($cp);
    },
  ]);
  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get('$compile'),
    $sce: built.get('$sce'),
  };
}

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

afterEach(() => {
  resetRegistry();
});

// ---------------------------------------------------------------------
// Cause-token regression guard — spec 023 introduces ZERO new tokens.
// Mirrors the spec 022 parity-file precedent (kept at the TOP so a
// future contributor adding a token notices the failure immediately).
// ---------------------------------------------------------------------

describe('parity: EXCEPTION_HANDLER_CAUSES regression', () => {
  it('keeps the tuple at exactly 10 entries after spec 023', () => {
    expect(EXCEPTION_HANDLER_CAUSES.length).toBe(10);
    expect(EXCEPTION_HANDLER_CAUSES).toContain('$compile');
    expect(EXCEPTION_HANDLER_CAUSES).toContain('watchListener');
  });
});

// ---------------------------------------------------------------------
// ng-bind — escapes HTML.
// Upstream: angular/angular.js test/ng/directive/ngBindSpec.js
// 'should set text content from the expression' and the
// HTML-special-character variant. The canonical security guarantee.
// ---------------------------------------------------------------------

describe('parity: ng-bind (ngBindSpec.js)', () => {
  let b: Bootstrap;
  beforeEach(() => {
    b = bootstrap();
  });

  it('writes the stringified value to textContent, not innerHTML', () => {
    const scope = Scope.create();
    scope.greeting = 'hello';

    const element = document.createElement('span');
    element.setAttribute('ng-bind', 'greeting');
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('hello');
  });

  it('escapes HTML so a `<script>` value renders as literal text', () => {
    const scope = Scope.create();
    scope.html = '<script>alert(1)</script>';

    const element = document.createElement('span');
    element.setAttribute('ng-bind', 'html');
    b.$compile(element)(scope);
    scope.$digest();

    // textContent round-trip preserves the source string verbatim.
    expect(element.textContent).toBe('<script>alert(1)</script>');
    // No real <script> element was created — this is the
    // security-relevant difference from ng-bind-html.
    expect(element.querySelector('script')).toBeNull();
  });
});

// ---------------------------------------------------------------------
// ng-bind-template — multi-expression interpolation.
// Upstream: angular/angular.js test/ng/directive/ngBindSpec.js
// 'should support ngBindTemplate (interpolation in attribute)'.
// ---------------------------------------------------------------------

describe('parity: ng-bind-template (ngBindSpec.js)', () => {
  let b: Bootstrap;
  beforeEach(() => {
    b = bootstrap();
  });

  it('interpolates multiple `{{ }}` segments against the scope', () => {
    const scope = Scope.create();
    scope.first = 'Ada';
    scope.last = 'Lovelace';

    const element = document.createElement('span');
    element.setAttribute('ng-bind-template', 'Hello {{first}} {{last}}!');
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('Hello Ada Lovelace!');
  });

  it('updates textContent when any referenced expression changes', () => {
    const scope = Scope.create();
    scope.first = 'Ada';
    scope.last = 'Lovelace';

    const element = document.createElement('span');
    element.setAttribute('ng-bind-template', 'Hello {{first}} {{last}}!');
    b.$compile(element)(scope);
    scope.$digest();
    expect(element.textContent).toBe('Hello Ada Lovelace!');

    scope.last = 'Byron';
    scope.$digest();
    expect(element.textContent).toBe('Hello Ada Byron!');
  });
});

// ---------------------------------------------------------------------
// ng-bind-html — requires SCE trust + sanitizes when ngSanitize loaded.
// Upstream: angular/angular.js test/ng/directive/ngBindHtmlSpec.js
// 'should set unsafe HTML if it is a trusted value' and 'should
// sanitize unsafe HTML when ngSanitize is loaded'.
// ---------------------------------------------------------------------

describe('parity: ng-bind-html (ngBindHtmlSpec.js)', () => {
  it('a $sce.trustAsHtml(…) value renders as actual HTML', () => {
    const b = bootstrap({ withSanitize: true });
    const scope = Scope.create();
    scope.html = b.$sce.trustAsHtml('<b>bold</b>');

    const element = document.createElement('div');
    element.setAttribute('ng-bind-html', 'html');
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.querySelector('b')?.textContent).toBe('bold');
  });

  it('plain untrusted string is sanitized WITH ngSanitize loaded (script stripped)', () => {
    const b = bootstrap({ withSanitize: true });
    const scope = Scope.create();
    scope.html = '<b>safe</b><script>alert(1)</script>';

    const element = document.createElement('div');
    element.setAttribute('ng-bind-html', 'html');
    b.$compile(element)(scope);
    scope.$digest();

    // <b> survives the allow-list; <script> is dropped.
    expect(element.innerHTML).toContain('<b>safe</b>');
    expect(element.querySelector('script')).toBeNull();
  });

  it('plain untrusted string throws WITHOUT ngSanitize and innerHTML degrades to empty', () => {
    const b = bootstrap({ withSanitize: false });
    const scope = Scope.create();
    scope.html = '<b>x</b>';

    const element = document.createElement('div');
    element.setAttribute('ng-bind-html', 'html');
    b.$compile(element)(scope);
    scope.$digest();

    // The `$sce.getTrustedHtml('<b>x</b>')` call inside the listener
    // throws (no $sanitize); the digest's 'watchListener' path
    // catches the throw, and innerHTML stays empty per the
    // safe-state default in `ng-bind-html.ts`.
    expect(element.innerHTML).toBe('');
  });
});

// ---------------------------------------------------------------------
// ng-show — toggles the canonical `.ng-hide` class on truthiness.
// Upstream: angular/angular.js test/ng/directive/ngShowHideSpec.js
// 'should show / hide based on truthiness of expression'.
// ---------------------------------------------------------------------

describe('parity: ng-show (ngShowHideSpec.js)', () => {
  let b: Bootstrap;
  beforeEach(() => {
    b = bootstrap();
  });

  it('adds the .ng-hide class when the expression is falsy', () => {
    const scope = Scope.create();
    scope.visible = false;

    const element = document.createElement('div');
    element.setAttribute('ng-show', 'visible');
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('ng-hide')).toBe(true);
  });

  it('removes the .ng-hide class when the expression is truthy', () => {
    const scope = Scope.create();
    scope.visible = true;

    const element = document.createElement('div');
    element.setAttribute('ng-show', 'visible');
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('ng-hide')).toBe(false);
  });

  it('toggles correctly across digest cycles as the value flips', () => {
    const scope = Scope.create();
    scope.visible = true;

    const element = document.createElement('div');
    element.setAttribute('ng-show', 'visible');
    b.$compile(element)(scope);
    scope.$digest();
    expect(element.classList.contains('ng-hide')).toBe(false);

    scope.visible = false;
    scope.$digest();
    expect(element.classList.contains('ng-hide')).toBe(true);

    scope.visible = true;
    scope.$digest();
    expect(element.classList.contains('ng-hide')).toBe(false);
  });
});

// ---------------------------------------------------------------------
// ng-hide — mirror-inverse of ng-show with inverted truthiness.
// Upstream: angular/angular.js test/ng/directive/ngShowHideSpec.js
// 'ng-hide should hide on truthy / show on falsy'.
// ---------------------------------------------------------------------

describe('parity: ng-hide (ngShowHideSpec.js)', () => {
  let b: Bootstrap;
  beforeEach(() => {
    b = bootstrap();
  });

  it('adds the .ng-hide class when the expression is TRUTHY (inverse of ng-show)', () => {
    const scope = Scope.create();
    scope.hidden = true;

    const element = document.createElement('div');
    element.setAttribute('ng-hide', 'hidden');
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('ng-hide')).toBe(true);
  });

  it('removes the .ng-hide class when the expression is FALSY (inverse of ng-show)', () => {
    const scope = Scope.create();
    scope.hidden = false;

    const element = document.createElement('div');
    element.setAttribute('ng-hide', 'hidden');
    b.$compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('ng-hide')).toBe(false);
  });
});

// ---------------------------------------------------------------------
// ng-cloak — strips both the attribute AND the class at compile time.
// Upstream: angular/angular.js test/ng/directive/ngCloakSpec.js
// 'should remove ngCloak attribute / class once compiled'.
// ---------------------------------------------------------------------

describe('parity: ng-cloak (ngCloakSpec.js)', () => {
  let b: Bootstrap;
  beforeEach(() => {
    b = bootstrap();
  });

  it('removes the `ng-cloak` attribute at compile time (attribute form)', () => {
    const scope = Scope.create();

    const element = document.createElement('div');
    element.setAttribute('ng-cloak', '');
    expect(element.hasAttribute('ng-cloak')).toBe(true);

    b.$compile(element)(scope);
    expect(element.hasAttribute('ng-cloak')).toBe(false);
  });

  it('removes the `ng-cloak` class at compile time (class form)', () => {
    const scope = Scope.create();

    const element = document.createElement('div');
    element.classList.add('ng-cloak', 'other-class');
    expect(element.classList.contains('ng-cloak')).toBe(true);

    b.$compile(element)(scope);
    expect(element.classList.contains('ng-cloak')).toBe(false);
    // Other classes on the element are preserved unchanged.
    expect(element.classList.contains('other-class')).toBe(true);
  });
});

// ---------------------------------------------------------------------
// ng-non-bindable — halts child compilation (THE spec 023 hallmark).
// Upstream: angular/angular.js test/ng/directive/ngNonBindableSpec.js
// 'should prevent interpolation on children' + 'should NOT invoke
// child directive link functions'.
// ---------------------------------------------------------------------

describe('parity: ng-non-bindable (ngNonBindableSpec.js)', () => {
  it('preserves literal `{{ }}` mustaches in child text nodes', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.value = 'should-not-appear';

    const element = document.createElement('pre');
    element.setAttribute('ng-non-bindable', '');
    element.textContent = '{{ value }}';

    b.$compile(element)(scope);
    scope.$digest();

    // The walker never descended into the text child, so
    // `$interpolate` never saw the mustache.
    expect(element.textContent).toBe('{{ value }}');
  });

  it("does NOT invoke a child directive's link function", () => {
    let childLinkInvoked = false;

    const b = bootstrapWithExtras(($cp) => {
      $cp.directive(
        'childMark',
        ddoFactory({
          restrict: 'A',
          link: (): void => {
            childLinkInvoked = true;
          },
        }),
      );
    });
    const scope = Scope.create();

    const root = document.createElement('div');
    root.setAttribute('ng-non-bindable', '');
    const child = document.createElement('span');
    child.setAttribute('child-mark', '');
    root.appendChild(child);

    b.$compile(root)(scope);
    scope.$digest();

    expect(childLinkInvoked).toBe(false);
  });

  it('siblings of the ng-non-bindable element compile normally', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.value = 'rendered';

    // Wrapper div hosts two children — one with ng-non-bindable and
    // one without. Only the second should interpolate.
    const wrapper = document.createElement('div');

    const cloaked = document.createElement('span');
    cloaked.setAttribute('ng-non-bindable', '');
    cloaked.textContent = '{{ value }}';
    wrapper.appendChild(cloaked);

    const live = document.createElement('span');
    live.setAttribute('ng-bind', 'value');
    wrapper.appendChild(live);

    b.$compile(wrapper)(scope);
    scope.$digest();

    // Sibling under ng-non-bindable kept its literal mustache.
    expect(cloaked.textContent).toBe('{{ value }}');
    // Sibling without ng-non-bindable interpolated normally.
    expect(live.textContent).toBe('rendered');
  });
});

// ---------------------------------------------------------------------
// Deferred upstream cases — present here as `it.skip` so the parity
// surface is documented even when the underlying service is not yet in
// the project's roadmap.
// ---------------------------------------------------------------------

describe('parity: deferred upstream cases', () => {
  it.skip('$animate.enter / $animate.leave hooks on ng-show / ng-hide — Phase 4 Animations roadmap item', () => {
    // Upstream `ngShowHideSpec.js` asserts that toggling ng-show /
    // ng-hide invokes `$animate.addClass(element, 'ng-hide')` and
    // `$animate.removeClass(...)`. Spec 023 toggles are synchronous —
    // no `$animate` integration. The animation hooks ship under the
    // Phase 4 Animations roadmap item.
  });

  it.skip('ng-cloak with animation transitions — Phase 4 Animations roadmap item', () => {
    // Upstream `ngCloakSpec.js` includes a CSS-transition variant
    // where the un-cloaking is animated through `$animate`. Spec 023
    // ships the synchronous one-shot cleanup only.
  });

  it.skip('ng-bind-html-unsafe — deprecated in AngularJS 1.x, never shipping', () => {
    // Upstream covers the legacy `ng-bind-html-unsafe` directive that
    // bypassed SCE entirely. AngularJS 1.x officially deprecated it
    // years ago; this project will NOT ship it (FS §3 Out-of-Scope).
  });

  it.skip('ng-bind on an interpolating attribute (mixed attribute + directive form) — deferred', () => {
    // Upstream covers a corner case where the ng-bind directive
    // co-exists with an `{{ }}` interpolation on the same element.
    // Spec 023 ships the canonical `ng-bind="expr"` form only.
  });
});
