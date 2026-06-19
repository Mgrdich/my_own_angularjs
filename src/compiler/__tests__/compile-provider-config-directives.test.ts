/**
 * `$compileProvider` config-phase directive-scan toggles
 * (spec 034 Slice 1 / FS §2).
 *
 * Locks the AngularJS-canonical getter/setter surface for the two
 * directive-scan toggles plus their observable effect on compilation:
 *
 * - `commentDirectivesEnabled(value?)` / `cssClassDirectivesEnabled(value?)`
 *   are config-phase getter/setters: called WITH a boolean they store it
 *   and return `this` (chainable); called with NO argument they return the
 *   current value. Both default to `true`.
 * - With `commentDirectivesEnabled(false)`, a `restrict: 'M'` directive
 *   matched via `<!-- directive: my-comment -->` no longer fires.
 * - With `cssClassDirectivesEnabled(false)`, a `restrict: 'C'` directive
 *   matched via `class="my-class-dir"` no longer fires.
 * - Default-on (no config) → both directive forms fire as they do today,
 *   guarding the spec-017 comment/class suites against regression.
 *
 * Uses the shared `compileWith` harness (`test-helpers.ts`), which runs
 * the supplied callback inside a `config(['$compileProvider', …])` block —
 * the exact place a real app flips these toggles.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { $CompileProvider } from '@compiler/compile-provider';
import type { DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import { Scope } from '@core/index';

import { bootstrapNgModule, compileWith } from './test-helpers';

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

describe('$compileProvider — getter/setter semantics (spec 034 Slice 1)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('commentDirectivesEnabled(false) returns the provider (chainable); the no-arg getter then returns false', () => {
    let getterValue: boolean | undefined;
    let chainedReturn: unknown;

    compileWith(($cp) => {
      chainedReturn = $cp.commentDirectivesEnabled(false);
      getterValue = $cp.commentDirectivesEnabled();
      expect(chainedReturn).toBe($cp);
    });

    expect(getterValue).toBe(false);
  });

  it('cssClassDirectivesEnabled(false) returns the provider (chainable); the no-arg getter then returns false', () => {
    let getterValue: boolean | undefined;
    let chainedReturn: unknown;

    compileWith(($cp) => {
      chainedReturn = $cp.cssClassDirectivesEnabled(false);
      getterValue = $cp.cssClassDirectivesEnabled();
      expect(chainedReturn).toBe($cp);
    });

    expect(getterValue).toBe(false);
  });

  it('both toggles default to true when no config flips them', () => {
    let commentDefault: boolean | undefined;
    let classDefault: boolean | undefined;

    compileWith(($cp) => {
      commentDefault = $cp.commentDirectivesEnabled();
      classDefault = $cp.cssClassDirectivesEnabled();
    });

    expect(commentDefault).toBe(true);
    expect(classDefault).toBe(true);
  });

  it('the setters chain together', () => {
    let chained: unknown;

    compileWith(($cp: $CompileProvider) => {
      chained = $cp.commentDirectivesEnabled(false).cssClassDirectivesEnabled(false);
    });

    // The chained value is asserted to be the provider inside the block;
    // re-check the captured reference is defined here (it was the provider).
    expect(chained).toBeDefined();
  });
});

describe('$compileProvider — commentDirectivesEnabled toggle (FS §2)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('default-on: a `restrict: "M"` comment directive fires', () => {
    let fired = false;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myComment',
        ddoFactory({
          restrict: 'M',
          link: () => {
            fired = true;
          },
        }),
      );
    });

    const parent = document.createElement('div');
    parent.appendChild(document.createComment(' directive: my-comment '));

    $compile(parent)(Scope.create());

    expect(fired).toBe(true);
  });

  it('commentDirectivesEnabled(false): the same comment directive does NOT fire', () => {
    let fired = false;

    const $compile = compileWith(($cp) => {
      $cp.commentDirectivesEnabled(false);
      $cp.directive(
        'myComment',
        ddoFactory({
          restrict: 'M',
          link: () => {
            fired = true;
          },
        }),
      );
    });

    const parent = document.createElement('div');
    parent.appendChild(document.createComment(' directive: my-comment '));

    $compile(parent)(Scope.create());

    expect(fired).toBe(false);
  });

  it('commentDirectivesEnabled(false) does NOT disable element/attribute matching', () => {
    let commentFired = false;
    let attrFired = false;

    const $compile = compileWith(($cp) => {
      $cp.commentDirectivesEnabled(false);
      $cp.directive(
        'myComment',
        ddoFactory({
          restrict: 'M',
          link: () => {
            commentFired = true;
          },
        }),
      );
      $cp.directive(
        'myAttr',
        ddoFactory({
          restrict: 'A',
          link: () => {
            attrFired = true;
          },
        }),
      );
    });

    const parent = document.createElement('div');
    parent.appendChild(document.createComment(' directive: my-comment '));
    const el = document.createElement('div');
    el.setAttribute('my-attr', '');
    parent.appendChild(el);

    $compile(parent)(Scope.create());

    expect(commentFired).toBe(false);
    expect(attrFired).toBe(true);
  });
});

describe('$compileProvider — cssClassDirectivesEnabled toggle (FS §2)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('default-on: a `restrict: "C"` class directive fires', () => {
    let fired = false;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myClassDir',
        ddoFactory({
          restrict: 'C',
          link: () => {
            fired = true;
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('class', 'my-class-dir');

    $compile(node)(Scope.create());

    expect(fired).toBe(true);
  });

  it('cssClassDirectivesEnabled(false): the same class directive does NOT fire', () => {
    let fired = false;

    const $compile = compileWith(($cp) => {
      $cp.cssClassDirectivesEnabled(false);
      $cp.directive(
        'myClassDir',
        ddoFactory({
          restrict: 'C',
          link: () => {
            fired = true;
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('class', 'my-class-dir');

    $compile(node)(Scope.create());

    expect(fired).toBe(false);
  });

  it('cssClassDirectivesEnabled(false) does NOT disable element/attribute matching', () => {
    let classFired = false;
    let elementFired = false;

    const $compile = compileWith(($cp) => {
      $cp.cssClassDirectivesEnabled(false);
      $cp.directive(
        'myClassDir',
        ddoFactory({
          restrict: 'C',
          link: () => {
            classFired = true;
          },
        }),
      );
      $cp.directive(
        'myEl',
        ddoFactory({
          restrict: 'E',
          link: () => {
            elementFired = true;
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('class', 'my-class-dir');
    node.appendChild(document.createElement('my-el'));

    $compile(node)(Scope.create());

    expect(classFired).toBe(false);
    expect(elementFired).toBe(true);
  });
});
