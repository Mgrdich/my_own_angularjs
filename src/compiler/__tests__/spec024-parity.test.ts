/**
 * AngularJS 1.x parity tests for spec 024 (Class & Style Directives).
 *
 * This file is a focused "canonical patterns" regression guard rather
 * than a verbatim port — the upstream `angular/angular.js` repo is not
 * vendored locally, so each test below codifies a publicly-documented
 * AngularJS 1.x behavior that the spec-024 built-ins must satisfy.
 *
 * Coverage scope (1–3 tests per directive — these are GUARDS, not
 * duplicates of the per-directive test files):
 *
 * - `ng-class` three forms (string / array / object) all functional +
 *   classes-preserved guarantee + diff cycle on change.
 * - `ng-class-even` gated on `$even` truthy, no-op when falsy.
 * - `ng-class-odd` mirror.
 * - `ng-style` object-form set/clear + kebab AND camelCase property
 *   names + consumer-shipped style preservation.
 *
 * Animation-related upstream cases (`$animate.addClass / .removeClass`
 * hooks on `ng-class`, `$animate.setClass` transitions) sit as
 * `it.skip(...)` citing the Phase 4 Animations roadmap item — the
 * parity surface is documented even when the underlying service is not
 * yet in the project.
 *
 * Mirrors the structural precedent set by
 * `src/compiler/__tests__/spec023-parity.test.ts` (and the
 * `EXCEPTION_HANDLER_CAUSES.length === 10` regression guard pattern
 * from there).
 *
 * @see context/spec/024-class-and-style-directives/functional-spec.md
 * @see context/spec/024-class-and-style-directives/technical-considerations.md
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CompileService } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { EXCEPTION_HANDLER_CAUSES } from '@exception-handler/index';

import { bootstrapNgModule } from './test-helpers';

interface InjectorLike {
  has: (name: string) => boolean;
  get: (name: string) => unknown;
}

function buildInjector(): InjectorLike {
  const appModule = createModule('app', ['ng']);
  return createInjector([ngModule, appModule]);
}

function compileFromNg(): { $compile: CompileService } {
  return { $compile: buildInjector().get('$compile') as CompileService };
}

afterEach(() => {
  resetRegistry();
});

// ---------------------------------------------------------------------
// Cause-token regression guard — spec 024 introduces ZERO new tokens.
// Mirrors the spec 023 parity-file precedent (kept at the TOP so a
// future contributor adding a token notices the failure immediately).
// ---------------------------------------------------------------------

describe('parity: EXCEPTION_HANDLER_CAUSES regression', () => {
  it('keeps the tuple at exactly 10 entries after spec 024', () => {
    expect(EXCEPTION_HANDLER_CAUSES.length).toBe(10);
    expect(EXCEPTION_HANDLER_CAUSES).toContain('$compile');
    expect(EXCEPTION_HANDLER_CAUSES).toContain('watchListener');
  });
});

// ---------------------------------------------------------------------
// ng-class — three forms (string / array / object) + diff cycle +
// classes-preserved guarantee. Upstream:
// angular/angular.js test/ng/directive/ngClassSpec.js — the canonical
// "should add classes from a string / array / object" set plus the
// "should NOT remove classes that ng-class did not add" guarantee.
// ---------------------------------------------------------------------

describe('parity: ng-class (ngClassSpec.js)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('applies classes from all three forms (string / array / object)', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();

    // String form.
    scope.s = 'foo bar';
    const elS = document.createElement('div');
    elS.setAttribute('ng-class', 's');
    $compile(elS)(scope);

    // Array form (string + nested object).
    scope.a = ['baz', { qux: true, zap: false }];
    const elA = document.createElement('div');
    elA.setAttribute('ng-class', 'a');
    $compile(elA)(scope);

    // Object form.
    scope.o = { alpha: true, beta: false, gamma: 1 };
    const elO = document.createElement('div');
    elO.setAttribute('ng-class', 'o');
    $compile(elO)(scope);

    scope.$digest();

    expect(elS.classList.contains('foo')).toBe(true);
    expect(elS.classList.contains('bar')).toBe(true);

    expect(elA.classList.contains('baz')).toBe(true);
    expect(elA.classList.contains('qux')).toBe(true);
    expect(elA.classList.contains('zap')).toBe(false);

    expect(elO.classList.contains('alpha')).toBe(true);
    expect(elO.classList.contains('beta')).toBe(false);
    expect(elO.classList.contains('gamma')).toBe(true);
  });

  it('runs a diff cycle on change — removes leaving classes, adds entering classes, keeps common', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.cls = { a: true, b: true, c: false };

    const element = document.createElement('div');
    element.setAttribute('ng-class', 'cls');
    $compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('a')).toBe(true);
    expect(element.classList.contains('b')).toBe(true);
    expect(element.classList.contains('c')).toBe(false);

    // Flip the object: drop `a`, keep `b`, add `c`.
    scope.cls = { a: false, b: true, c: true };
    scope.$digest();

    expect(element.classList.contains('a')).toBe(false); // removed
    expect(element.classList.contains('b')).toBe(true); // untouched (in both)
    expect(element.classList.contains('c')).toBe(true); // added
  });

  it('preserves consumer-shipped classes — never removes a class ng-class did not add', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.cls = 'highlighted';

    // `card` is on the element BEFORE ng-class runs. The directive
    // must never strip it across digests, even when its own expression
    // changes or clears entirely.
    const element = document.createElement('div');
    element.className = 'card';
    element.setAttribute('ng-class', 'cls');
    $compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('card')).toBe(true);
    expect(element.classList.contains('highlighted')).toBe(true);

    scope.cls = 'active';
    scope.$digest();
    expect(element.classList.contains('card')).toBe(true);
    expect(element.classList.contains('highlighted')).toBe(false);
    expect(element.classList.contains('active')).toBe(true);

    // Clear the expression. Only `highlighted` / `active` were ever
    // directive-applied — `card` stays.
    scope.cls = null;
    scope.$digest();
    expect(element.classList.contains('card')).toBe(true);
    expect(element.classList.contains('active')).toBe(false);
    expect(element.classList.contains('highlighted')).toBe(false);
  });
});

// ---------------------------------------------------------------------
// ng-class-even — gated on $even truthy, no-op when falsy.
// Upstream: angular/angular.js test/ng/directive/ngClassSpec.js —
// 'should support adding classes when $even / $odd is true' against
// the canonical ng-repeat-shaped scope.
// ---------------------------------------------------------------------

describe('parity: ng-class-even (ngClassSpec.js)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('applies classes when $even is truthy, withholds when falsy', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create<{ $even?: boolean; cls?: string }>();
    scope.$even = true;
    scope.cls = 'highlight';

    const element = document.createElement('li');
    element.setAttribute('ng-class-even', 'cls');
    $compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('highlight')).toBe(true);

    // Flip $even false (without changing the expression) — the
    // secondary $watch fires and removes the class.
    scope.$even = false;
    scope.$digest();
    expect(element.classList.contains('highlight')).toBe(false);
  });

  it('contributes no classes outside ng-repeat — no $even on scope, no error', () => {
    const { $compile } = compileFromNg();
    // Scope with no $even / $odd at all — directive must be tolerant.
    const scope = Scope.create<{ cls?: string }>();
    scope.cls = 'highlight';

    const element = document.createElement('li');
    element.setAttribute('ng-class-even', 'cls');
    expect(() => {
      $compile(element)(scope);
      scope.$digest();
    }).not.toThrow();
    expect(element.classList.contains('highlight')).toBe(false);
  });
});

// ---------------------------------------------------------------------
// ng-class-odd — mirror-inverse of ng-class-even.
// ---------------------------------------------------------------------

describe('parity: ng-class-odd (ngClassSpec.js)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('applies classes when $odd is truthy, withholds when falsy', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create<{ $odd?: boolean; cls?: string }>();
    scope.$odd = true;
    scope.cls = 'striped';

    const element = document.createElement('li');
    element.setAttribute('ng-class-odd', 'cls');
    $compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('striped')).toBe(true);

    scope.$odd = false;
    scope.$digest();
    expect(element.classList.contains('striped')).toBe(false);
  });

  it('combines with ng-class-even on the same element for zebra striping', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create<{ $even?: boolean; $odd?: boolean }>();
    scope.$even = true;
    scope.$odd = false;

    const element = document.createElement('li');
    element.setAttribute('ng-class-even', "'row-even'");
    element.setAttribute('ng-class-odd', "'row-odd'");
    $compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('row-even')).toBe(true);
    expect(element.classList.contains('row-odd')).toBe(false);

    // Flip the index — the AngularJS-canonical "alternating rows"
    // scenario where ng-repeat updates $even / $odd as it iterates.
    scope.$even = false;
    scope.$odd = true;
    scope.$digest();

    expect(element.classList.contains('row-even')).toBe(false);
    expect(element.classList.contains('row-odd')).toBe(true);
  });
});

// ---------------------------------------------------------------------
// ng-style — object-form set/clear + kebab AND camelCase property
// names + consumer-shipped style preservation.
// Upstream: angular/angular.js test/ng/directive/ngStyleSpec.js —
// 'should set / clear inline styles' + the consumer-style-preservation
// regression covered upstream by the 'should preserve styles
// previously applied to the element' family.
// ---------------------------------------------------------------------

describe('parity: ng-style (ngStyleSpec.js)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('sets styles from the object expression and clears them on key removal', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create<{ styles?: Record<string, string> | null }>();
    scope.styles = { color: 'red', 'font-size': '14px' };

    const element = document.createElement('div');
    element.setAttribute('ng-style', 'styles');
    $compile(element)(scope);
    scope.$digest();

    expect(element.style.color).toBe('red');
    expect(element.style.fontSize).toBe('14px');

    // Drop font-size — the diff cycle clears the property the
    // directive applied last digest.
    scope.styles = { color: 'red' };
    scope.$digest();

    expect(element.style.color).toBe('red');
    expect(element.style.fontSize).toBe('');

    // Clear entirely. The directive applied `color` last digest, so
    // the diff clears it now.
    scope.styles = null;
    scope.$digest();

    expect(element.style.color).toBe('');
  });

  it('accepts both kebab-case and camelCase property names', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();

    // Kebab-case → routed through setProperty('background-color', …).
    scope.kebabStyles = { 'background-color': 'red' };
    const elKebab = document.createElement('div');
    elKebab.setAttribute('ng-style', 'kebabStyles');
    $compile(elKebab)(scope);

    // CamelCase → routed through direct IDL assignment
    // (element.style.backgroundColor = …).
    scope.camelStyles = { backgroundColor: 'blue' };
    const elCamel = document.createElement('div');
    elCamel.setAttribute('ng-style', 'camelStyles');
    $compile(elCamel)(scope);

    scope.$digest();

    // Both surfaces converge on the same `backgroundColor` IDL property.
    expect(elKebab.style.backgroundColor).toBe('red');
    expect(elCamel.style.backgroundColor).toBe('blue');
  });

  it('preserves consumer-shipped inline styles unless the directive names the same property', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create<{ styles?: Record<string, string> }>();
    scope.styles = { color: 'red' };

    // `margin: 5px` is consumer-shipped via the `style` attribute.
    const element = document.createElement('div');
    element.setAttribute('style', 'margin: 5px');
    element.setAttribute('ng-style', 'styles');
    $compile(element)(scope);
    scope.$digest();

    // Directive added `color`; consumer's `margin` survives.
    expect(element.style.color).toBe('red');
    expect(element.style.margin).toBe('5px');

    // Drop `color`. The directive applied `color` last digest, so the
    // diff clears it — but `margin` is NEVER in `appliedProps`, so it
    // survives.
    scope.styles = {};
    scope.$digest();

    expect(element.style.color).toBe('');
    expect(element.style.margin).toBe('5px');
  });
});

// ---------------------------------------------------------------------
// Deferred upstream cases — present here as `it.skip` so the parity
// surface is documented even when the underlying service is not yet in
// the project's roadmap.
// ---------------------------------------------------------------------

describe('parity: deferred upstream cases', () => {
  it.skip('$animate.addClass / removeClass hooks on ng-class — Phase 4 Animations roadmap item', () => {
    // Upstream `ngClassSpec.js` asserts that toggling ng-class invokes
    // `$animate.addClass(element, …)` / `$animate.removeClass(...)` for
    // each class transition, so apps can drive CSS-transition-based
    // class swaps through the animation service. Spec 024 toggles are
    // synchronous — no `$animate` integration. The animation hooks
    // ship under the Phase 4 Animations roadmap item.
  });

  it.skip('ng-class with $animate.setClass transitions — Phase 4 Animations roadmap item', () => {
    // Upstream `ngClassSpec.js` covers the batched `$animate.setClass`
    // path that fires a single animation event when a class set is
    // swapped in one digest (rather than N add/remove pairs). Spec 024
    // performs the swap synchronously via N classList mutations — the
    // batching is a Phase 4 concern.
  });
});
