/**
 * `ngStyle` directive — integration tests (spec 024 Slice 3 / FS §2.3).
 *
 * Exercises the built-in `ngStyle` directive end-to-end through real
 * `$compile`, against the canonical `ngModule`. Locks the
 * AngularJS-canonical behavior:
 *
 * - Object-form expression sets each `{ cssProperty: value }` pair as
 *   an inline CSS property on the element.
 * - Diff cycle on change: properties that leave the new object are
 *   cleared via `removeProperty`; properties that stay are
 *   (re-)written via `setProperty`.
 * - Consumer-shipped inline styles (e.g. `<div style="margin: 5px">`)
 *   are preserved unless the directive's expression later names the
 *   same property — at which point the directive overwrites it and
 *   the property becomes directive-owned.
 * - `null` and `undefined` clear all directive-applied styles.
 * - Both kebab-case (`'background-color'`) and camelCase
 *   (`'backgroundColor'`) property names work — browsers normalize
 *   internally inside `setProperty`.
 * - Non-object expression values (number, string, array, function)
 *   resolve to the empty property set: any directive-applied styles
 *   are cleared and nothing new is written.
 *
 * Bootstrap reuses the shared `bootstrapNgModule` helper — same
 * pattern as `ng-class.test.ts`.
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

describe('ngStyle — registration on ngModule', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('injector.has("ngStyleDirective") === true when "ng" is in the deps chain', () => {
    const injector = buildInjector();
    expect(injector.has('ngStyleDirective')).toBe(true);
  });
});

describe('ngStyle — object form (FS §2.3)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('sets a single property from the expression object', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.styles = { color: 'red' };

    const element = document.createElement('div');
    element.setAttribute('ng-style', 'styles');

    $compile(element)(scope);
    scope.$digest();

    expect(element.style.color).toBe('red');
  });

  it('sets multiple properties from a multi-key object', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.styles = { color: 'red', fontSize: '14px' };

    const element = document.createElement('div');
    element.setAttribute('ng-style', 'styles');

    $compile(element)(scope);
    scope.$digest();

    expect(element.style.color).toBe('red');
    expect(element.style.fontSize).toBe('14px');
  });

  it('accepts an inline object literal expression', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();

    const element = document.createElement('div');
    element.setAttribute('ng-style', "{ color: 'red' }");

    $compile(element)(scope);
    scope.$digest();

    expect(element.style.color).toBe('red');
  });

  it('renders an empty object as no styles applied — and does not throw', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.styles = {};

    const element = document.createElement('div');
    element.setAttribute('ng-style', 'styles');

    $compile(element)(scope);
    expect(() => {
      scope.$digest();
    }).not.toThrow();
    expect(element.getAttribute('style')).toBeNull();
  });
});

describe('ngStyle — diff cycle on change (FS §2.3)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('clears a property when its key leaves the expression object', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.styles = { color: 'red', fontSize: '14px' };

    const element = document.createElement('div');
    element.setAttribute('ng-style', 'styles');

    $compile(element)(scope);
    scope.$digest();
    expect(element.style.color).toBe('red');
    expect(element.style.fontSize).toBe('14px');

    scope.styles = { color: 'red' };
    scope.$digest();
    expect(element.style.color).toBe('red');
    expect(element.style.fontSize).toBe('');
  });

  it('updates an existing property when its value changes', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.styles = { color: 'red' };

    const element = document.createElement('div');
    element.setAttribute('ng-style', 'styles');

    $compile(element)(scope);
    scope.$digest();
    expect(element.style.color).toBe('red');

    scope.styles = { color: 'blue' };
    scope.$digest();
    expect(element.style.color).toBe('blue');
  });
});

describe('ngStyle — consumer-shipped inline styles preserved (FS §2.3)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('keeps a static `style="margin: 5px"` unless the directive names `margin`', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.styles = { color: 'red' };

    const element = document.createElement('div');
    element.setAttribute('style', 'margin: 5px;');
    element.setAttribute('ng-style', 'styles');

    $compile(element)(scope);
    scope.$digest();
    expect(element.style.margin).toBe('5px');
    expect(element.style.color).toBe('red');

    // Now have the directive name `margin` — the directive wins and
    // overwrites the consumer-shipped value.
    scope.styles = { margin: '10px' };
    scope.$digest();
    expect(element.style.margin).toBe('10px');
    // `color` left our set, so it's been cleared.
    expect(element.style.color).toBe('');

    // Empty object — `margin` was directive-applied last digest, so
    // it's now cleared. (AngularJS-canonical: once the directive
    // names a property, ownership transfers.)
    scope.styles = {};
    scope.$digest();
    expect(element.style.margin).toBe('');
  });
});

describe('ngStyle — null / undefined clears all directive-applied styles (FS §2.3)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('clears every directive-applied property when the expression becomes null', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.styles = { color: 'red', fontSize: '14px' };

    const element = document.createElement('div');
    element.setAttribute('ng-style', 'styles');

    $compile(element)(scope);
    scope.$digest();
    expect(element.style.color).toBe('red');
    expect(element.style.fontSize).toBe('14px');

    scope.styles = null;
    scope.$digest();
    expect(element.style.color).toBe('');
    expect(element.style.fontSize).toBe('');
  });

  it('clears every directive-applied property when the expression becomes undefined', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.styles = { color: 'red', fontSize: '14px' };

    const element = document.createElement('div');
    element.setAttribute('ng-style', 'styles');

    $compile(element)(scope);
    scope.$digest();
    expect(element.style.color).toBe('red');
    expect(element.style.fontSize).toBe('14px');

    scope.styles = undefined;
    scope.$digest();
    expect(element.style.color).toBe('');
    expect(element.style.fontSize).toBe('');
  });

  it('leaves consumer-shipped inline styles ALONE when the expression becomes null', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.styles = { color: 'red' };

    const element = document.createElement('div');
    element.setAttribute('style', 'margin: 5px;');
    element.setAttribute('ng-style', 'styles');

    $compile(element)(scope);
    scope.$digest();
    expect(element.style.margin).toBe('5px');
    expect(element.style.color).toBe('red');

    scope.styles = null;
    scope.$digest();
    // Directive-applied color cleared; consumer-shipped margin
    // preserved.
    expect(element.style.color).toBe('');
    expect(element.style.margin).toBe('5px');
  });
});

describe('ngStyle — property-name formats (FS §2.3)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('accepts kebab-case property names', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.styles = { 'background-color': 'red' };

    const element = document.createElement('div');
    element.setAttribute('ng-style', 'styles');

    $compile(element)(scope);
    scope.$digest();

    expect(element.style.backgroundColor).toBe('red');
  });

  it('accepts camelCase property names', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.styles = { backgroundColor: 'red' };

    const element = document.createElement('div');
    element.setAttribute('ng-style', 'styles');

    $compile(element)(scope);
    scope.$digest();

    expect(element.style.backgroundColor).toBe('red');
  });

  it('clears a kebab-case property when its key leaves the expression', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.styles = { 'background-color': 'red', color: 'blue' };

    const element = document.createElement('div');
    element.setAttribute('ng-style', 'styles');

    $compile(element)(scope);
    scope.$digest();
    expect(element.style.backgroundColor).toBe('red');
    expect(element.style.color).toBe('blue');

    scope.styles = { color: 'blue' };
    scope.$digest();
    expect(element.style.backgroundColor).toBe('');
    expect(element.style.color).toBe('blue');
  });
});

describe('ngStyle — non-object expression values (FS §2.3)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('treats a number as the empty property set — clears any directive-applied styles', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.styles = { color: 'red' };

    const element = document.createElement('div');
    element.setAttribute('ng-style', 'styles');

    $compile(element)(scope);
    scope.$digest();
    expect(element.style.color).toBe('red');

    scope.styles = 42;
    scope.$digest();
    expect(element.style.color).toBe('');
  });

  it('treats a string as the empty property set', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.styles = { color: 'red' };

    const element = document.createElement('div');
    element.setAttribute('ng-style', 'styles');

    $compile(element)(scope);
    scope.$digest();
    expect(element.style.color).toBe('red');

    scope.styles = 'color: blue';
    scope.$digest();
    expect(element.style.color).toBe('');
  });

  it('treats an array as the empty property set (objects only — arrays rejected)', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.styles = { color: 'red' };

    const element = document.createElement('div');
    element.setAttribute('ng-style', 'styles');

    $compile(element)(scope);
    scope.$digest();
    expect(element.style.color).toBe('red');

    scope.styles = ['color', 'blue'];
    scope.$digest();
    expect(element.style.color).toBe('');
    // Sanity — the array's numeric keys did NOT spray onto element.style.
    expect(element.getAttribute('style')).toBe('');
  });

  it('treats a function as the empty property set', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.styles = { color: 'red' };

    const element = document.createElement('div');
    element.setAttribute('ng-style', 'styles');

    $compile(element)(scope);
    scope.$digest();
    expect(element.style.color).toBe('red');

    scope.styles = (): void => undefined;
    scope.$digest();
    expect(element.style.color).toBe('');
  });
});

describe('ngStyle — installs a watcher on the scope', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('grows the scope $$watchers list after compile (a $watchCollection is installed)', () => {
    const { $compile } = compileFromNg();
    const scope = Scope.create();
    scope.styles = { color: 'red' };

    const before = (scope as unknown as { $$watchers: unknown[] | null }).$$watchers?.length ?? 0;

    const element = document.createElement('div');
    element.setAttribute('ng-style', 'styles');
    $compile(element)(scope);

    const after = (scope as unknown as { $$watchers: unknown[] | null }).$$watchers?.length ?? 0;
    expect(after).toBeGreaterThan(before);
  });
});
