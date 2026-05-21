/**
 * AngularJS 1.x parity tests for spec 025 (Attribute Helper Directives).
 *
 * This file is a focused "canonical patterns" regression guard rather
 * than a verbatim port — the upstream `angular/angular.js` repo is not
 * vendored locally, so each test below codifies a publicly-documented
 * AngularJS 1.x behavior that the spec-025 built-ins must satisfy.
 *
 * Coverage scope (1 test per directive — these are GUARDS, not
 * duplicates of the per-pattern test files):
 *
 *  - URL aliases (`ng-href`, `ng-src`, `ng-srcset`) — the interpolated
 *    value lands on the real DOM attribute after the first digest, and
 *    a mutation of the scope expression propagates on the next digest.
 *  - Boolean aliases (`ng-disabled`, `ng-checked`, `ng-readonly`,
 *    `ng-selected`, `ng-open`) — the real attribute's presence tracks
 *    the truthiness of the bound scope expression across digests.
 *
 * No deferred `it.skip(...)` cases — these directives have no animation
 * surface or other deferred upstream behavior.
 *
 * Mirrors the structural precedent set by
 * `src/compiler/__tests__/spec024-parity.test.ts` (and the
 * `EXCEPTION_HANDLER_CAUSES.length === 10` regression guard pattern
 * from there).
 *
 * @see context/spec/025-attribute-helper-directives/functional-spec.md
 * @see context/spec/025-attribute-helper-directives/technical-considerations.md
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
// Cause-token regression guard — spec 025 introduces ZERO new tokens.
// Mirrors the spec 023 / 024 parity-file precedent (kept at the TOP so
// a future contributor adding a token notices the failure immediately).
// ---------------------------------------------------------------------

describe('parity: EXCEPTION_HANDLER_CAUSES regression', () => {
  it('keeps the tuple at exactly 10 entries after spec 025', () => {
    expect(EXCEPTION_HANDLER_CAUSES.length).toBe(10);
    expect(EXCEPTION_HANDLER_CAUSES).toContain('$compile');
    expect(EXCEPTION_HANDLER_CAUSES).toContain('watchListener');
  });
});

// ---------------------------------------------------------------------
// ng-href — interpolation-safe alias for the `href` attribute on `<a>`.
// Upstream: angular/angular.js test/ng/directive/ngHrefSpec.js — the
// canonical "should bind href" + "should remove the attribute when
// empty" pair. Mirrors AngularJS-1.x exactly.
// ---------------------------------------------------------------------

describe('parity: ng-href (ngHrefSpec.js)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('writes the interpolated URL to the real `href` after the first digest, and propagates updates', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.userProfileUrl = '/users/42';

    const element = document.createElement('a');
    element.setAttribute('ng-href', '{{userProfileUrl}}');

    // BEFORE compile + digest the real `href` is absent — the browser
    // never sees the literal `"{{userProfileUrl}}"` string.
    expect(element.hasAttribute('href')).toBe(false);

    $compile(element)(scope);
    scope.$digest();

    expect(element.getAttribute('href')).toBe('/users/42');

    // Mutation of the bound expression propagates on the next digest.
    scope.userProfileUrl = '/users/7';
    scope.$digest();
    expect(element.getAttribute('href')).toBe('/users/7');
  });
});

// ---------------------------------------------------------------------
// ng-src — interpolation-safe alias for the `src` attribute on `<img>`.
// Upstream: angular/angular.js test/ng/directive/ngSrcSpec.js — same
// shape as ngHref: bind, update, remove-when-empty.
// ---------------------------------------------------------------------

describe('parity: ng-src (ngSrcSpec.js)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('writes the interpolated URL to the real `src` after the first digest, and propagates updates', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.photoUrl = '/img/me.jpg';

    const element = document.createElement('img');
    element.setAttribute('ng-src', '{{photoUrl}}');

    // Pre-compile / pre-digest: no real `src`, so the browser fires no
    // network request for the literal `"{{photoUrl}}"` string.
    expect(element.hasAttribute('src')).toBe(false);

    $compile(element)(scope);
    scope.$digest();

    expect(element.getAttribute('src')).toBe('/img/me.jpg');

    scope.photoUrl = '/img/avatar.png';
    scope.$digest();
    expect(element.getAttribute('src')).toBe('/img/avatar.png');
  });
});

// ---------------------------------------------------------------------
// ng-srcset — interpolation-safe alias for the `srcset` attribute on
// `<img>` / `<source>`. Same machinery as ng-src; only the target
// attribute differs.
// Upstream: angular/angular.js test/ng/directive/ngSrcsetSpec.js.
// ---------------------------------------------------------------------

describe('parity: ng-srcset (ngSrcsetSpec.js)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('writes the interpolated set to the real `srcset` after the first digest, and propagates updates', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.photoSet = '/img/me.jpg 1x, /img/me@2x.jpg 2x';

    const element = document.createElement('img');
    element.setAttribute('ng-srcset', '{{photoSet}}');

    expect(element.hasAttribute('srcset')).toBe(false);

    $compile(element)(scope);
    scope.$digest();

    expect(element.getAttribute('srcset')).toBe('/img/me.jpg 1x, /img/me@2x.jpg 2x');

    scope.photoSet = '/img/v2.jpg 1x';
    scope.$digest();
    expect(element.getAttribute('srcset')).toBe('/img/v2.jpg 1x');
  });
});

// ---------------------------------------------------------------------
// ng-disabled — boolean alias for the `disabled` attribute.
// Upstream: angular/angular.js test/ng/directive/booleanAttrsSpec.js —
// "should bind disabled" / the canonical truthiness toggle. Tests
// presence via `hasAttribute` rather than the raw attribute string, per
// the spec 025 technical-considerations risk matrix (cosmetic noise of
// `disabled=""` vs bare-presence is irrelevant to behavior).
// ---------------------------------------------------------------------

describe('parity: ng-disabled (booleanAttrsSpec.js)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('adds the `disabled` attribute when the expression is truthy, removes when falsy', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create<{ loading?: boolean }>();
    scope.loading = true;

    const element = document.createElement('button');
    element.setAttribute('ng-disabled', 'loading');
    $compile(element)(scope);
    scope.$digest();

    expect(element.hasAttribute('disabled')).toBe(true);
    expect(element.disabled).toBe(true);

    scope.loading = false;
    scope.$digest();
    expect(element.hasAttribute('disabled')).toBe(false);
    expect(element.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------
// ng-checked — boolean alias for the `checked` attribute on checkboxes
// / radios.
// Upstream: angular/angular.js test/ng/directive/booleanAttrsSpec.js —
// "should bind checked".
// ---------------------------------------------------------------------

describe('parity: ng-checked (booleanAttrsSpec.js)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('adds the `checked` attribute when the expression is truthy, removes when falsy', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create<{ selected?: boolean }>();
    scope.selected = true;

    const element = document.createElement('input');
    element.setAttribute('type', 'checkbox');
    element.setAttribute('ng-checked', 'selected');
    $compile(element)(scope);
    scope.$digest();

    expect(element.hasAttribute('checked')).toBe(true);

    scope.selected = false;
    scope.$digest();
    expect(element.hasAttribute('checked')).toBe(false);
  });
});

// ---------------------------------------------------------------------
// ng-readonly — boolean alias for the `readonly` attribute on inputs /
// textareas.
// Upstream: angular/angular.js test/ng/directive/booleanAttrsSpec.js —
// "should bind readonly".
// ---------------------------------------------------------------------

describe('parity: ng-readonly (booleanAttrsSpec.js)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('adds the `readonly` attribute when the expression is truthy, removes when falsy', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create<{ locked?: boolean }>();
    scope.locked = true;

    const element = document.createElement('input');
    element.setAttribute('ng-readonly', 'locked');
    $compile(element)(scope);
    scope.$digest();

    expect(element.hasAttribute('readonly')).toBe(true);
    expect(element.readOnly).toBe(true);

    scope.locked = false;
    scope.$digest();
    expect(element.hasAttribute('readonly')).toBe(false);
    expect(element.readOnly).toBe(false);
  });
});

// ---------------------------------------------------------------------
// ng-selected — boolean alias for the `selected` attribute on
// `<option>` elements inside `<select>`.
// Upstream: angular/angular.js test/ng/directive/booleanAttrsSpec.js —
// "should bind selected".
// ---------------------------------------------------------------------

describe('parity: ng-selected (booleanAttrsSpec.js)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('adds the `selected` attribute when the expression is truthy, removes when falsy', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create<{ choice?: string }>();
    scope.choice = 'b';

    const element = document.createElement('option');
    element.setAttribute('value', 'b');
    element.setAttribute('ng-selected', "choice === 'b'");
    $compile(element)(scope);
    scope.$digest();

    expect(element.hasAttribute('selected')).toBe(true);

    scope.choice = 'a';
    scope.$digest();
    expect(element.hasAttribute('selected')).toBe(false);
  });
});

// ---------------------------------------------------------------------
// ng-open — boolean alias for the `open` attribute on `<details>`.
// Upstream: angular/angular.js test/ng/directive/booleanAttrsSpec.js —
// "should bind open".
// ---------------------------------------------------------------------

describe('parity: ng-open (booleanAttrsSpec.js)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('adds the `open` attribute when the expression is truthy, removes when falsy', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create<{ expanded?: boolean }>();
    scope.expanded = true;

    const element = document.createElement('details');
    element.setAttribute('ng-open', 'expanded');
    $compile(element)(scope);
    scope.$digest();

    expect(element.hasAttribute('open')).toBe(true);

    scope.expanded = false;
    scope.$digest();
    expect(element.hasAttribute('open')).toBe(false);
  });
});
