/**
 * `ngList` directive (spec 039 Slice 4 / FS §2.5).
 *
 * Drives an `<input ng-model ng-list>` end-to-end through the canonical
 * `ngModule` (via `bootstrapInjector`). The delimited on-screen string
 * round-trips to an **array** in the model (view → model) and back
 * (model → view). Exercises the default `,` delimiter, a custom string
 * delimiter, and the `/regex/` split form. Vectors ported from AngularJS
 * `inputSpec.js` (ngList).
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { CompileService } from '@compiler/directive-types';
import type { Scope } from '@core/index';
import { bootstrapInjector } from '@bootstrap/index';
import { resetRegistry } from '@di/module';

interface Harness {
  $compile: CompileService;
  $rootScope: Scope;
}

function boot(): Harness {
  const injector = bootstrapInjector([]);
  return {
    $compile: injector.get('$compile'),
    $rootScope: injector.get('$rootScope'),
  };
}

afterEach(() => {
  resetRegistry();
});

function compile(html: string, $compile: CompileService, scope: Scope): HTMLInputElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  const child = el.firstElementChild as HTMLInputElement;
  $compile(child)(scope);
  scope.$digest();
  return child;
}

function fireInput(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input'));
}

function model(scope: Scope, key: string): unknown {
  return (scope as unknown as Record<string, unknown>)[key];
}

function setModel(scope: Scope, key: string, value: unknown): void {
  (scope as unknown as Record<string, unknown>)[key] = value;
}

// ────────────────────────────────────────────────────────────────────────────
// default `,` delimiter
// ────────────────────────────────────────────────────────────────────────────

describe('ngList — default comma delimiter (FS §2.5)', () => {
  it('splits a delimited string into a trimmed array (view → model)', () => {
    const { $compile, $rootScope } = boot();
    const el = compile('<input ng-model="tags" ng-list>', $compile, $rootScope);

    fireInput(el, 'a, b, c');
    expect(model($rootScope, 'tags')).toEqual(['a', 'b', 'c']);
  });

  it('trims surrounding whitespace around each element', () => {
    const { $compile, $rootScope } = boot();
    const el = compile('<input ng-model="tags" ng-list>', $compile, $rootScope);

    fireInput(el, '  x ,y ,  z  ');
    expect(model($rootScope, 'tags')).toEqual(['x', 'y', 'z']);
  });

  it('drops empty parts', () => {
    const { $compile, $rootScope } = boot();
    const el = compile('<input ng-model="tags" ng-list>', $compile, $rootScope);

    fireInput(el, 'a, , b, ');
    expect(model($rootScope, 'tags')).toEqual(['a', 'b']);
  });

  it('joins an array back into a delimited string (model → view)', () => {
    const { $compile, $rootScope } = boot();
    const el = compile('<input ng-model="tags" ng-list>', $compile, $rootScope);

    setModel($rootScope, 'tags', ['one', 'two', 'three']);
    $rootScope.$digest();
    expect(el.value).toBe('one, two, three');
  });

  it('round-trips a value through the field', () => {
    const { $compile, $rootScope } = boot();
    const el = compile('<input ng-model="tags" ng-list>', $compile, $rootScope);

    fireInput(el, 'red, green, blue');
    expect(model($rootScope, 'tags')).toEqual(['red', 'green', 'blue']);

    setModel($rootScope, 'tags', ['x', 'y']);
    $rootScope.$digest();
    expect(el.value).toBe('x, y');
  });

  it('an empty field yields an undefined model', () => {
    const { $compile, $rootScope } = boot();
    const el = compile('<input ng-model="tags" ng-list>', $compile, $rootScope);

    fireInput(el, '');
    expect(model($rootScope, 'tags')).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// custom string delimiter
// ────────────────────────────────────────────────────────────────────────────

describe('ngList — custom delimiter (FS §2.5)', () => {
  it('splits on a custom delimiter', () => {
    const { $compile, $rootScope } = boot();
    const el = compile('<input ng-model="tags" ng-list="; ">', $compile, $rootScope);

    fireInput(el, 'a; b; c');
    expect(model($rootScope, 'tags')).toEqual(['a', 'b', 'c']);
  });

  it('joins with the custom delimiter (trimmed + a trailing space)', () => {
    const { $compile, $rootScope } = boot();
    const el = compile('<input ng-model="tags" ng-list="; ">', $compile, $rootScope);

    setModel($rootScope, 'tags', ['a', 'b']);
    $rootScope.$digest();
    expect(el.value).toBe('a; b');
  });

  it('a single-character custom delimiter round-trips', () => {
    const { $compile, $rootScope } = boot();
    const el = compile('<input ng-model="tags" ng-list="|">', $compile, $rootScope);

    fireInput(el, 'a|b|c');
    expect(model($rootScope, 'tags')).toEqual(['a', 'b', 'c']);

    setModel($rootScope, 'tags', ['p', 'q']);
    $rootScope.$digest();
    expect(el.value).toBe('p| q');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// regexp delimiter
// ────────────────────────────────────────────────────────────────────────────

describe('ngList — /regex/ split form (FS §2.5)', () => {
  it('splits on a whitespace-tolerant regexp delimiter', () => {
    const { $compile, $rootScope } = boot();
    const el = compile('<input ng-model="tags" ng-list="/,\\s*/">', $compile, $rootScope);

    fireInput(el, 'a,b,  c,   d');
    expect(model($rootScope, 'tags')).toEqual(['a', 'b', 'c', 'd']);
  });
});
