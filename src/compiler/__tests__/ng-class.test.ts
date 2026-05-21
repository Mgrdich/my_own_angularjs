/**
 * `ngClass` directive — integration tests (spec 024 Slice 1 / FS §2.1).
 *
 * Exercises the built-in `ngClass` directive end-to-end through real
 * `$compile`, against the canonical `ngModule`. Locks the
 * AngularJS-canonical behavior:
 *
 * - All three expression forms (string / array / object) resolve to
 *   the expected class set.
 * - Diff cycle on change: classes that leave the set are removed,
 *   classes that enter are added, classes in both are untouched.
 * - Consumer-shipped classes (e.g. `<div class="card" ng-class="…">`)
 *   are NEVER removed by `ng-class` — the classes-preserved guarantee.
 * - `null` and `undefined` clear all directive-applied classes.
 * - Object-form keys toggle independently from one digest to the next.
 *
 * Bootstrap reuses the shared `bootstrapNgModule` / `compileWith`
 * helpers — same pattern as `ng-show.test.ts` / `ng-hide.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CompileService } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';

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

describe('ngClass — registration on ngModule', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('injector.has("ngClassDirective") === true when "ng" is in the deps chain', () => {
    const injector = buildInjector();
    expect(injector.has('ngClassDirective')).toBe(true);
  });
});

describe('ngClass — string form (FS §2.1)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('applies a single class from a single-token string expression', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.cls = 'active';

    const element = document.createElement('div');
    element.setAttribute('ng-class', 'cls');

    $compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('active')).toBe(true);
  });

  it('applies multiple classes from a whitespace-separated string', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.cls = 'foo bar';

    const element = document.createElement('div');
    element.setAttribute('ng-class', 'cls');

    $compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('foo')).toBe(true);
    expect(element.classList.contains('bar')).toBe(true);
  });
});

describe('ngClass — array form (FS §2.1)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('applies each string element from an array expression', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.arr = ['a', 'b'];

    const element = document.createElement('div');
    element.setAttribute('ng-class', 'arr');

    $compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('a')).toBe(true);
    expect(element.classList.contains('b')).toBe(true);
  });

  it('applies an object element inside the array via the object-form rule', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.arr = [{ active: true, error: false }, 'extra'];

    const element = document.createElement('div');
    element.setAttribute('ng-class', 'arr');

    $compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('active')).toBe(true);
    expect(element.classList.contains('error')).toBe(false);
    expect(element.classList.contains('extra')).toBe(true);
  });
});

describe('ngClass — object form (FS §2.1)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('applies keys whose values are truthy', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.cond = true;
    scope.obj = { active: scope.cond };

    const element = document.createElement('div');
    element.setAttribute('ng-class', '{ active: cond }');

    $compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('active')).toBe(true);
  });

  it('removes the class when the keyed value flips from truthy to falsy', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.cond = true;

    const element = document.createElement('div');
    element.setAttribute('ng-class', '{ active: cond }');

    $compile(element)(scope);
    scope.$digest();
    expect(element.classList.contains('active')).toBe(true);

    scope.cond = false;
    scope.$digest();
    expect(element.classList.contains('active')).toBe(false);
  });

  it('toggles multiple object keys independently across digests', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.x = true;
    scope.y = true;

    const element = document.createElement('div');
    element.setAttribute('ng-class', '{ a: x, b: y }');

    $compile(element)(scope);
    scope.$digest();
    expect(element.classList.contains('a')).toBe(true);
    expect(element.classList.contains('b')).toBe(true);

    // Flip x off; b should stay on.
    scope.x = false;
    scope.$digest();
    expect(element.classList.contains('a')).toBe(false);
    expect(element.classList.contains('b')).toBe(true);

    // Flip y off too; both removed.
    scope.y = false;
    scope.$digest();
    expect(element.classList.contains('a')).toBe(false);
    expect(element.classList.contains('b')).toBe(false);
  });
});

describe('ngClass — diff cycle on change (FS §2.1)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('removes classes that leave the set, adds new entrants, leaves common classes untouched', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.arr = ['a', 'b'];

    const element = document.createElement('div');
    element.setAttribute('ng-class', 'arr');

    $compile(element)(scope);
    scope.$digest();
    expect(element.classList.contains('a')).toBe(true);
    expect(element.classList.contains('b')).toBe(true);
    expect(element.classList.contains('c')).toBe(false);

    // Replace ['a','b'] with ['b','c'] — 'a' should leave, 'c' should
    // enter, 'b' should stay.
    scope.arr = ['b', 'c'];
    scope.$digest();
    expect(element.classList.contains('a')).toBe(false);
    expect(element.classList.contains('b')).toBe(true);
    expect(element.classList.contains('c')).toBe(true);
  });
});

describe('ngClass — consumer-shipped classes preserved (FS §2.1)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('keeps a static `class="card"` across multiple ng-class expression changes', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.cls = 'highlighted';

    const element = document.createElement('div');
    element.setAttribute('class', 'card');
    element.setAttribute('ng-class', 'cls');

    $compile(element)(scope);
    scope.$digest();
    expect(element.classList.contains('card')).toBe(true);
    expect(element.classList.contains('highlighted')).toBe(true);

    // Change the directive-applied class set; `card` must survive.
    scope.cls = 'a';
    scope.$digest();
    expect(element.classList.contains('card')).toBe(true);
    expect(element.classList.contains('a')).toBe(true);
    expect(element.classList.contains('highlighted')).toBe(false);

    scope.cls = 'b';
    scope.$digest();
    expect(element.classList.contains('card')).toBe(true);
    expect(element.classList.contains('a')).toBe(false);
    expect(element.classList.contains('b')).toBe(true);

    // Even with an empty string (no directive-applied classes), `card`
    // is still on the element.
    scope.cls = '';
    scope.$digest();
    expect(element.classList.contains('card')).toBe(true);
    expect(element.classList.contains('b')).toBe(false);
  });
});

describe('ngClass — null / undefined clears all directive-applied classes (FS §2.1)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('removes all directive-applied classes when the expression becomes null', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.cls = 'a b';

    const element = document.createElement('div');
    element.setAttribute('ng-class', 'cls');

    $compile(element)(scope);
    scope.$digest();
    expect(element.classList.contains('a')).toBe(true);
    expect(element.classList.contains('b')).toBe(true);

    scope.cls = null;
    scope.$digest();
    expect(element.classList.contains('a')).toBe(false);
    expect(element.classList.contains('b')).toBe(false);
  });

  it('removes all directive-applied classes when the expression becomes undefined', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.cls = 'a b';

    const element = document.createElement('div');
    element.setAttribute('ng-class', 'cls');

    $compile(element)(scope);
    scope.$digest();
    expect(element.classList.contains('a')).toBe(true);
    expect(element.classList.contains('b')).toBe(true);

    scope.cls = undefined;
    scope.$digest();
    expect(element.classList.contains('a')).toBe(false);
    expect(element.classList.contains('b')).toBe(false);
  });
});

describe('ngClass — installs a watcher on the scope', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('grows the scope $$watchers list after compile (a $watchCollection is installed)', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.cls = 'active';

    const before = (scope as unknown as { $$watchers: unknown[] | null }).$$watchers?.length ?? 0;

    const element = document.createElement('div');
    element.setAttribute('ng-class', 'cls');
    $compile(element)(scope);

    const after = (scope as unknown as { $$watchers: unknown[] | null }).$$watchers?.length ?? 0;
    expect(after).toBeGreaterThan(before);
  });
});
