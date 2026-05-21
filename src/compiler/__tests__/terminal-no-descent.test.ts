/**
 * Spec 023 / Slice 1 — terminal halts child descent (broadened
 * semantic, narrowed to `ngNonBindable`).
 *
 * Spec 017 implemented the same-element half of `terminal: true`
 * (the directive-collector cutoff applied to other directives on the
 * SAME node). Spec 023 §2.6 broadens this to the AngularJS-canonical
 * behavior: a `terminal: true` directive ALSO stops the walker from
 * recursing into the element's child nodes.
 *
 * The spec 002–022 audit found one existing test
 * (`terminal.test.ts` — "terminal does NOT affect descendants") that
 * pinned the OLD narrower semantic against a CUSTOM `terminal: true`
 * directive plus a child directive. Per the spec 023 risk-mitigation
 * note (tech-considerations §3 + spec brief), the broadened semantic
 * is therefore narrowed to apply ONLY when the matched directive is
 * `ngNonBindable`. This file pins the broadened invariant against
 * that name; the existing terminal.test.ts case continues to pin the
 * spec-017 behavior for every other `terminal: true` consumer.
 *
 * Slice 6 ships `ng-non-bindable` itself; this slice is the
 * foundational walker hook it relies on.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import { Scope } from '@core/index';

import { bootstrapNgModule, compileWith } from './test-helpers';

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

describe('$compile — terminal halts child descent (spec 023 §2.6)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('ngNonBindable (terminal: true) on the parent prevents a child directive from running', () => {
    const fired: string[] = [];

    const $compile = compileWith(($cp) => {
      // Surrogate `ngNonBindable` — Slice 1 only ships the walker
      // hook; Slice 6 ships the real directive. The name is the
      // discriminant the walker uses to opt into the broadened
      // semantic, so registering under the same name here exercises
      // the same code path.
      $cp.directive(
        'ngNonBindable',
        ddoFactory({
          restrict: 'AC',
          priority: 1000,
          terminal: true,
        }),
      );
      $cp.directive(
        'childDir',
        ddoFactory({
          restrict: 'A',
          link: () => {
            fired.push('childDir');
          },
        }),
      );
    });

    const parent = document.createElement('div');
    parent.setAttribute('ng-non-bindable', '');
    const child = document.createElement('span');
    child.setAttribute('child-dir', '');
    parent.appendChild(child);

    $compile(parent)(Scope.create());

    // Broadened semantic — the walker did NOT descend into children,
    // so `childDir`'s link did not fire.
    expect(fired).not.toContain('childDir');
    expect(fired).toEqual([]);
  });

  it('control — WITHOUT ngNonBindable on the parent, the child directive runs', () => {
    const fired: string[] = [];

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'childDir',
        ddoFactory({
          restrict: 'A',
          link: () => {
            fired.push('childDir');
          },
        }),
      );
    });

    const parent = document.createElement('div');
    const child = document.createElement('span');
    child.setAttribute('child-dir', '');
    parent.appendChild(child);

    $compile(parent)(Scope.create());

    // No `ngNonBindable` on the parent → walker descends normally
    // → child directive runs.
    expect(fired).toEqual(['childDir']);
  });
});
