/**
 * AngularJS 1.x parity tests for spec 027 (Structural / Flow-Control Directives).
 *
 * This file is a focused "canonical patterns" regression guard rather
 * than a verbatim port — the upstream `angular/angular.js` repo is not
 * vendored locally, so each test below codifies a publicly-documented
 * AngularJS 1.x behavior that the spec-027 built-ins must satisfy.
 *
 * Coverage scope — one canonical observable per directive plus the
 * cross-directive interaction rules (the per-directive test files
 * `ng-if.test.ts` / `ng-switch.test.ts` / `ng-include.test.ts` /
 * `ng-init.test.ts` / `ng-controller.test.ts` cover the full FS §2
 * acceptance grid; this file pins the cross-directive invariants those
 * matrices are too uniform to surface cleanly):
 *
 *  - **`ng-if`** — truthy mounts the cloned subtree, falsy unmounts.
 *  - **`ng-switch`** — three-way branch dispatches the right block
 *    against `String(value)` equality.
 *  - **`ng-include`** — happy-path async fetch + render plus the
 *    `$includeContentLoaded` event.
 *  - **`ng-init`** — pre-link timing: children see initialized values on
 *    first render with no transient empty rendering.
 *  - **`ng-controller as vm`** — alias publication; `vm.x` resolves
 *    through the controllerAs alias on the child scope.
 *  - **Combined `ng-if + ng-controller`** — "controller only while
 *    truthy"; instantiation gated by the surrounding `ng-if`.
 *  - **`MultipleTranscludeDirectivesError`** — two structural
 *    directives on the SAME element route through
 *    `$exceptionHandler('$compile')` (the spec-018 detection reused at
 *    spec-027 Slice 2's foundation).
 *
 * No deferred `it.skip(...)` cases — every spec-027 directive ships in
 * Slices 1–6 and there are no animation-surface or other deferred
 * upstream behaviors for the structural set.
 *
 * Mirrors the structural precedent set by
 * `src/compiler/__tests__/spec026-parity.test.ts` (and the
 * `EXCEPTION_HANDLER_CAUSES.length === 10` regression guard pattern
 * from there).
 *
 * @see context/spec/027-structural-flow-control-directives/functional-spec.md
 * @see context/spec/027-structural-flow-control-directives/technical-considerations.md
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MultipleTranscludeDirectivesError } from '@compiler/compile-error';
import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService } from '@compiler/directive-types';
import { $ControllerProvider } from '@controller/controller-provider';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { type AnyModule, createModule, resetRegistry } from '@di/module';
import { EXCEPTION_HANDLER_CAUSES, type ExceptionHandler } from '@exception-handler/index';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import { createTemplateCache } from '@template/template-cache';
import { createTemplateRequest } from '@template/template-request';
import type { TemplateCacheService, TemplateFetcher, TemplateRequestFn } from '@template/template-types';

interface InjectorLike {
  has: (name: string) => boolean;
}

interface Bootstrap {
  $compile: CompileService;
  injector: InjectorLike;
}

interface BootstrapOptions {
  fetcher?: TemplateFetcher;
  exceptionHandler?: ExceptionHandler;
  register?: (appModule: AnyModule) => void;
}

/**
 * Bootstrap an injector wired with the production `ngModule` (so the
 * spec-027 directives are reachable end-to-end). The `app` module
 * accepts last-wins overrides for `$exceptionHandler` and
 * `$templateRequest` plus an optional `register` callback for
 * controllers / directives.
 *
 * Mirrors `ng-include.test.ts` / `ng-controller.test.ts`'s bootstrap
 * shape; the parity file needs all three knobs (fetcher mock for
 * `ng-include`, exception spy for the `MultipleTranscludeDirectivesError`
 * surface, controller registration for `ng-controller as vm`).
 */
function bootstrap(options?: BootstrapOptions): Bootstrap {
  const fetcher = options?.fetcher;
  resetRegistry();
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

  const appModule = createModule('app-spec027-parity', ['ng']);
  if (options?.exceptionHandler !== undefined) {
    const handler = options.exceptionHandler;
    appModule.factory('$exceptionHandler', [() => handler]);
  }
  if (fetcher !== undefined) {
    appModule.factory('$templateRequest', [
      '$templateCache',
      (cache: TemplateCacheService): TemplateRequestFn => createTemplateRequest({ cache, fetcher }),
    ]);
  }
  if (options?.register !== undefined) {
    options.register(appModule);
  }
  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get('$compile'),
    injector: built,
  };
}

/**
 * Drain three microtasks to flush the `ng-include`'s
 * `$templateRequest(...).then(...)` chain. Mirrors the
 * `ng-include.test.ts` defensive 3x flush.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  resetRegistry();
});

// ---------------------------------------------------------------------
// Cause-token regression guard — spec 027 introduces ZERO new tokens.
// Mirrors the spec 023 / 024 / 025 / 026 parity-file precedent (kept at
// the TOP so a future contributor adding a token notices the failure
// immediately). Every error site in spec 027 (ng-include fetch failures,
// ng-switch missing-parent throws, ng-controller unknown-name throws,
// the reused `MultipleTranscludeDirectivesError`) routes via the
// existing `'$compile'` cause already in the 10-tuple from spec 018.
// ---------------------------------------------------------------------

describe('parity: EXCEPTION_HANDLER_CAUSES regression', () => {
  it('keeps the tuple at exactly 10 entries after spec 027', () => {
    expect(EXCEPTION_HANDLER_CAUSES.length).toBe(10);
    expect(EXCEPTION_HANDLER_CAUSES).toContain('$compile');
  });
});

// ---------------------------------------------------------------------
// ng-if — the canonical conditional-render toggle.
// Upstream: angular/angular.js test/ng/directive/ngIfSpec.js —
// "should add and remove the element". Pins the truthy mount + falsy
// unmount observable that every other ng-if-dependent test in this
// file leans on transitively.
// ---------------------------------------------------------------------

describe('parity: ng-if truthy/falsy toggle (ngIfSpec.js)', () => {
  it('mounts the cloned subtree on truthy and detaches it on falsy', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = false;
    scope.label = 'hi';

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-if', 'show');
    const inner = document.createElement('span');
    inner.setAttribute('ng-bind', 'label');
    inner.className = 'inner';
    host.appendChild(inner);
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    // Initial show = false — placeholder is present, no clone in the DOM.
    expect(parent.querySelector('.inner')).toBeNull();

    // Flip to truthy — clone mounts and the inner ng-bind sees `label`.
    scope.show = true;
    scope.$digest();
    expect(parent.querySelector('.inner')).not.toBeNull();
    expect(parent.querySelector('.inner')?.textContent).toBe('hi');

    // Flip back to falsy — clone detaches.
    scope.show = false;
    scope.$digest();
    expect(parent.querySelector('.inner')).toBeNull();
  });
});

// ---------------------------------------------------------------------
// ng-switch — the canonical three-way branch.
// Upstream: angular/angular.js test/ng/directive/ngSwitchSpec.js —
// "should switch on value change" / "should switch on a default value".
// Pins the dispatch contract: only the matching block renders at any
// time; the `?` default fires on a miss.
// ---------------------------------------------------------------------

describe('parity: ng-switch 3-way branch (ngSwitchSpec.js)', () => {
  it('dispatches to the right block on each value transition', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.kind = 'A';

    const host = document.createElement('div');
    host.setAttribute('ng-switch', 'kind');
    const whenA = document.createElement('div');
    whenA.setAttribute('ng-switch-when', 'A');
    const aMark = document.createElement('span');
    aMark.className = 'case-a';
    aMark.textContent = 'A';
    whenA.appendChild(aMark);
    const whenB = document.createElement('div');
    whenB.setAttribute('ng-switch-when', 'B');
    const bMark = document.createElement('span');
    bMark.className = 'case-b';
    bMark.textContent = 'B';
    whenB.appendChild(bMark);
    const whenDefault = document.createElement('div');
    whenDefault.setAttribute('ng-switch-default', '');
    const dMark = document.createElement('span');
    dMark.className = 'case-d';
    dMark.textContent = 'D';
    whenDefault.appendChild(dMark);
    host.appendChild(whenA);
    host.appendChild(whenB);
    host.appendChild(whenDefault);

    b.$compile(host)(scope);
    scope.$digest();

    // kind = 'A' — only the A block renders.
    expect(host.querySelector('.case-a')).not.toBeNull();
    expect(host.querySelector('.case-b')).toBeNull();
    expect(host.querySelector('.case-d')).toBeNull();

    // kind = 'B' — only the B block renders.
    scope.kind = 'B';
    scope.$digest();
    expect(host.querySelector('.case-a')).toBeNull();
    expect(host.querySelector('.case-b')).not.toBeNull();
    expect(host.querySelector('.case-d')).toBeNull();

    // kind = 'X' (no matching when) — only the default renders.
    scope.kind = 'X';
    scope.$digest();
    expect(host.querySelector('.case-a')).toBeNull();
    expect(host.querySelector('.case-b')).toBeNull();
    expect(host.querySelector('.case-d')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------
// ng-include — the canonical async template inclusion.
// Upstream: angular/angular.js test/ng/directive/ngIncludeSpec.js —
// "should load content" + "should fire $includeContentLoaded after
// content has been loaded". Pins the happy-path: fetch returns a
// template, the template is in the DOM after the microtask flush, AND
// `$includeContentLoaded` fired with the URL.
// ---------------------------------------------------------------------

describe('parity: ng-include happy-path load (ngIncludeSpec.js)', () => {
  it('fetches the template, installs it after the microtask flush, and fires $includeContentLoaded', async () => {
    const fetcher = vi.fn<TemplateFetcher>(() => Promise.resolve('<span class="loaded">OK</span>'));
    const b = bootstrap({ fetcher });
    const scope = Scope.create();
    const loaded = vi.fn();
    scope.$on('$includeContentLoaded', loaded);
    scope.url = '/partials/x.html';

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-include', 'url');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    // Not yet loaded — the resolve chain hasn't drained.
    expect(parent.querySelector('.loaded')).toBeNull();
    expect(loaded).not.toHaveBeenCalled();

    await flushMicrotasks();

    // Template is in the DOM AND the loaded event fired with the URL.
    expect(parent.querySelector('.loaded')).not.toBeNull();
    expect(parent.querySelector('.loaded')?.textContent).toBe('OK');
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(loaded.mock.calls[0]?.[1]).toBe('/partials/x.html');
    expect(fetcher).toHaveBeenCalledWith('/partials/x.html');
  });
});

// ---------------------------------------------------------------------
// ng-init — the canonical pre-link seeding.
// Upstream: angular/angular.js test/ng/directive/ngInitSpec.js — "should
// init the variable on the scope". Pins the load-bearing pre-link timing
// guarantee: a child binding inside the subtree sees the initialized
// value on the very first render. A post-link ng-init would leave the
// child binding rendering against `undefined` on first digest.
//
// Note: FS §2.4's canonical example uses text-node `{{user.name}}`
// interpolation. Text-node interpolation is NOT yet shipped in
// `$compile`'s walker (only attribute interpolation via `attrs.$observe`
// and explicit binding directives like `ng-bind` are wired). We
// exercise the SAME pre-link timing guarantee via an `ng-bind` child —
// the same workaround used in `ng-init.test.ts:174`.
// ---------------------------------------------------------------------

describe('parity: ng-init pre-link timing (ngInitSpec.js)', () => {
  it('a child ng-bind sees the initialized value on the first digest', () => {
    const b = bootstrap();
    const scope = Scope.create();

    const host = document.createElement('div');
    host.setAttribute('ng-init', "user = {name: 'Alice'}");
    const span = document.createElement('span');
    span.setAttribute('ng-bind', 'user.name');
    host.appendChild(span);

    b.$compile(host)(scope);
    scope.$digest();

    expect(span.textContent).toBe('Alice');
  });
});

// ---------------------------------------------------------------------
// ng-controller as vm — the canonical controllerAs alias publication.
// Upstream: angular/angular.js test/ng/directive/ngControllerSpec.js —
// "should publish controller instance into scope" with the
// "Controller as alias" form. Pins the alias-on-child-scope contract:
// `vm.x` resolves through the controller's `this.x` via the alias.
// ---------------------------------------------------------------------

describe('parity: ng-controller "Name as alias" publishes the instance (ngControllerSpec.js)', () => {
  it('publishes the controller instance on the child scope under the alias, reachable from ng-bind', () => {
    const b = bootstrap({
      register: (app) => {
        app.controller('MyCtrl', [
          function (this: Record<string, unknown>): void {
            this.x = 'hello';
          },
        ]);
      },
    });
    const scope = Scope.create();

    const host = document.createElement('div');
    host.setAttribute('ng-controller', 'MyCtrl as vm');
    const span = document.createElement('span');
    span.setAttribute('ng-bind', 'vm.x');
    host.appendChild(span);

    b.$compile(host)(scope);
    scope.$digest();

    expect(span.textContent).toBe('hello');
    // Alias is on the directive's child scope, not the parent.
    expect((scope as unknown as { vm?: unknown }).vm).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// Combined ng-if + ng-controller — "controller only while truthy".
// Upstream: angular/angular.js test/ng/directive/ngControllerSpec.js
// composed with the canonical ngIf gating pattern. Pins the
// instantiation timing contract: the controller's constructor is
// invoked exactly when (and only when) the surrounding ng-if is truthy.
// Each truthy → falsy → truthy cycle produces a brand-new instance.
//
// NOTE: the canonical layout is NESTED form (ng-if on the outer element,
// ng-controller on an inner child element). Putting both directives on
// the SAME element triggers ng-if's priority-600 terminal cutoff over
// ng-controller's priority-500 declaration — the per-element terminal
// rule drops the lower-priority directive from the matched list (per
// `ng-controller.test.ts:478-481`). The nested form is the AngularJS-
// canonical layout this composition exercises.
// ---------------------------------------------------------------------

describe('parity: ng-if + ng-controller "controller only while truthy"', () => {
  it('does NOT instantiate the controller while ng-if is falsy; instantiates a fresh instance on each truthy mount; destroys on falsy', () => {
    const ctorSpy = vi.fn();
    const onDestroySpy = vi.fn();
    const seenInstances: unknown[] = [];
    const b = bootstrap({
      register: (app) => {
        app.controller('MyCtrl', [
          function (this: Record<string, unknown>): void {
            ctorSpy();
            seenInstances.push(this);
            this.$onDestroy = onDestroySpy;
          },
        ]);
      },
    });
    const scope = Scope.create();
    scope.show = false;

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-if', 'show');
    const inner = document.createElement('div');
    inner.setAttribute('ng-controller', 'MyCtrl');
    host.appendChild(inner);
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    // show = false — controller never instantiated.
    expect(ctorSpy).toHaveBeenCalledTimes(0);

    // show = true — single instance constructed.
    scope.show = true;
    scope.$digest();
    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(seenInstances).toHaveLength(1);

    // show = false — instance's $onDestroy fires AT LEAST once. Exact
    // count is implementation-defined: ng-if's eager-destroy contract
    // calls BOTH `cloneScope.$destroy()` AND `destroyElementScope(...)`
    // (matches the `ng-controller.test.ts:513-520` precedent).
    const beforeFalsyDestroys = onDestroySpy.mock.calls.length;
    scope.show = false;
    scope.$digest();
    expect(onDestroySpy.mock.calls.length).toBeGreaterThan(beforeFalsyDestroys);
    expect(ctorSpy).toHaveBeenCalledTimes(1); // No "unconstruct".

    // show = true again — brand-new instance.
    scope.show = true;
    scope.$digest();
    expect(ctorSpy).toHaveBeenCalledTimes(2);
    expect(seenInstances).toHaveLength(2);
    expect(seenInstances[0]).not.toBe(seenInstances[1]);
  });
});

// ---------------------------------------------------------------------
// MultipleTranscludeDirectivesError — two structural directives on the
// SAME element.
// Upstream: angular/angular.js test/ng/compileSpec.js — the
// `'$compile:multidir'` error for two transcluding directives on the
// same node. Spec 027 leans on this existing detection (added by spec
// 018 at `compile.ts:944-948`) for the same-element rejection rule
// (technical-considerations §2.9).
//
// **Implementation gap surfaced during the Slice 7 parity write-up.**
// The technical-considerations §2.9 expectation was that
// `<div ng-if="a" ng-include="…">` would route
// `MultipleTranscludeDirectivesError`. In practice this combination
// hits the spec-017 same-element TERMINAL cutoff in
// `directive-collector.ts:167-181` BEFORE the spec-018 transclude
// pre-pass scan runs: `ng-if` (priority 600, `terminal: true`)
// truncates the matched-directive list, so `ng-include` (priority 400)
// never reaches the transclude pre-pass to trigger the multi-error.
// The user-observable effect is silent: `ng-include` does NOT load,
// `ng-if` works alone. No error is surfaced.
//
// We pin BOTH observables here:
//
//   (a) The spec-018 detection itself still works correctly for a
//       mixed `transclude: 'element'` + `transclude: true` pair on the
//       same element — this is the load-bearing guard. Mirrors the
//       `transclude-element-foundation.test.ts:385` precedent.
//
//   (b) The actually-observable behavior for the FS §2.6 canonical
//       case (`<div ng-if="a" ng-include="…">`): `ng-include` is
//       silently dropped by the terminal cutoff. A future spec slice
//       could harden the cutoff to also route
//       `MultipleTranscludeDirectivesError` BEFORE the cutoff applies
//       (or move the multi-detect scan ahead of the cutoff in
//       `compileElementOrComment`). Until then the test pins the
//       observable behavior so a future fix is detectable.
// ---------------------------------------------------------------------

describe('parity: two structural directives on the same element route MultipleTranscludeDirectivesError', () => {
  it('the spec-018 multi-error detection still fires for a `transclude: "element"` + `transclude: true` pair on the SAME element', () => {
    // Load-bearing assertion: the detection at `compile.ts:944-948`
    // remains functional after the spec-027 Slice 2 widening. This is
    // the mechanism the FS §2.6 canonical case INTENDS to invoke; the
    // ng-if + ng-include case hits the terminal-cutoff gap noted in
    // the describe-block prologue, so we exercise the underlying
    // detection here with two non-terminal directives.
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({
      exceptionHandler: handler,
      register: (app) => {
        app.config([
          '$compileProvider',
          ($cp: $CompileProvider) => {
            $cp.directive('firstElement', [
              () => ({
                restrict: 'A',
                priority: 100,
                transclude: 'element',
                link: () => undefined,
              }),
            ]);
            $cp.directive('secondDir', [
              () => ({
                restrict: 'A',
                priority: 50,
                transclude: true,
                link: () => undefined,
              }),
            ]);
          },
        ]);
      },
    });
    const scope = Scope.create();

    const parent = document.createElement('section');
    const host = document.createElement('div');
    host.setAttribute('first-element', '');
    host.setAttribute('second-dir', '');
    parent.appendChild(host);

    expect(() => {
      b.$compile(host)(scope);
      scope.$digest();
    }).not.toThrow();

    const multi = handler.mock.calls.filter(([err]) => err instanceof MultipleTranscludeDirectivesError);
    expect(multi.length).toBe(1);
    const [errOnly, cause] = multi[0] ?? [];
    expect(errOnly).toBeInstanceOf(MultipleTranscludeDirectivesError);
    expect(cause).toBe('$compile');
    // Both directive normalized names mentioned in the error message.
    const message = (errOnly as Error).message;
    expect(message).toContain('firstElement');
    expect(message).toContain('secondDir');
  });

  it("the FS §2.6 canonical `<div ng-if='a' ng-include='…'>` case now routes MultipleTranscludeDirectivesError (spec-032 closes the spec-017 cutoff gap)", () => {
    // Spec 032 Slice 2 closed the gap: the terminal cutoff in
    // `directive-collector.ts` no longer drops a second
    // `transclude`-declaring directive (ng-include, priority 400) when a
    // higher-priority transclude directive (ng-if, priority 600
    // `terminal: true`) is already kept — both reach `compile.ts`'s
    // multi-transclude guard, which routes
    // `MultipleTranscludeDirectivesError` via `$exceptionHandler('$compile')`.
    const handler = vi.fn<ExceptionHandler>();
    const fetcher = vi.fn<TemplateFetcher>(() => Promise.resolve('<span class="inc"></span>'));
    const b = bootstrap({ exceptionHandler: handler, fetcher });
    const scope = Scope.create();
    scope.a = true;
    scope.url = '/x.html';

    const parent = document.createElement('section');
    const host = document.createElement('div');
    host.setAttribute('ng-if', 'a');
    host.setAttribute('ng-include', 'url');
    parent.appendChild(host);

    expect(() => {
      b.$compile(host)(scope);
      scope.$digest();
    }).not.toThrow();

    // The conflict now surfaces — spec 032 fix. This is the observable
    // contract: the developer is told to fix the same-element conflict.
    // (Once the conflict guard strips ng-include's transclude, its link
    // still runs on the recovery path; the exact post-conflict side
    // effects are undefined-misuse behavior and are not pinned here.)
    const multi = handler.mock.calls.filter(([err]) => err instanceof MultipleTranscludeDirectivesError);
    expect(multi.length).toBeGreaterThanOrEqual(1);
    expect(multi[0]?.[1]).toBe('$compile');
  });
});
