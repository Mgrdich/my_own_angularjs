/**
 * `$compile` terminal short-circuit tests (Slice 4 / FS §2.7).
 *
 * Locks the `terminal: true` cutoff contract on a single node:
 *
 * - Terminal at priority N drops every directive with priority < N
 *   on the SAME node.
 * - Same-priority-as-terminal directives are NOT dropped — they
 *   still compile and link normally.
 * - Terminal at the default priority 0 only blocks priority < 0
 *   directives (rare in practice but the canonical boundary case).
 * - Terminal short-circuit affects only the same node — descendants
 *   compile and link unaffected.
 * - Multiple terminal directives at different priorities: only the
 *   FIRST (highest-priority) cutoff applies; subsequent terminal
 *   directives at lower priorities are already excluded by the
 *   higher cutoff and have no additional effect.
 * - When a directive registered LATER but at a HIGHER priority
 *   sorts before a terminal directive registered EARLIER at a
 *   lower priority, both still run (the cutoff captures the
 *   terminal's own priority, not its registration order).
 *
 * Subtle scaffolding note (mirrors `priority-and-tie-break.test.ts`):
 * `index` is assigned at first-lookup time inside `collectDirectives`.
 * Lookup order matches DOM-attribute iteration order. To make the
 * registration-order tie-break observable, every test below sets the
 * attribute order to match the registration order.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import { Scope } from '@core/index';

import { bootstrapNgModule, compileWith } from './test-helpers';

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

describe('$compile — terminal short-circuit (FS §2.7)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('terminal at priority 100 stops priority 50 directives on the same node', () => {
    const fired: string[] = [];

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'terA',
        ddoFactory({
          restrict: 'A',
          priority: 100,
          terminal: true,
          link: () => {
            fired.push('terA');
          },
        }),
      );
      $cp.directive(
        'nonTerB',
        ddoFactory({
          restrict: 'A',
          priority: 50,
          link: () => {
            fired.push('nonTerB');
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('ter-a', '');
    node.setAttribute('non-ter-b', '');

    $compile(node)(Scope.create());

    expect(fired).toEqual(['terA']);
    expect(fired).not.toContain('nonTerB');
  });

  it('same-priority-as-terminal directives still run', () => {
    const fired: string[] = [];

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'terA',
        ddoFactory({
          restrict: 'A',
          priority: 100,
          terminal: true,
          link: () => {
            fired.push('terA');
          },
        }),
      );
      $cp.directive(
        'nonTerB',
        ddoFactory({
          restrict: 'A',
          priority: 100,
          link: () => {
            fired.push('nonTerB');
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('ter-a', '');
    node.setAttribute('non-ter-b', '');

    $compile(node)(Scope.create());

    // Both run — the terminal's cutoff is `priority < 100`, and
    // nonTerB sits AT 100, so it is kept. Post-link runs in
    // priority-ASCENDING order and the registration-order tie-break
    // means terA was registered first → lower index → runs LAST in
    // post-link reversal.
    expect(fired).toHaveLength(2);
    expect(fired).toContain('terA');
    expect(fired).toContain('nonTerB');
  });

  it('terminal at priority 0 (default) only blocks priority < 0 directives', () => {
    const fired: string[] = [];

    const $compile = compileWith(($cp) => {
      // Terminal at the default priority of 0.
      $cp.directive(
        'terA',
        ddoFactory({
          restrict: 'A',
          terminal: true,
          link: () => {
            fired.push('terA');
          },
        }),
      );
      // Negative priority — BELOW the terminal cutoff → dropped.
      $cp.directive(
        'nonTerB',
        ddoFactory({
          restrict: 'A',
          priority: -10,
          link: () => {
            fired.push('nonTerB');
          },
        }),
      );
      // Same priority as terminal (0) → kept.
      $cp.directive(
        'nonTerC',
        ddoFactory({
          restrict: 'A',
          priority: 0,
          link: () => {
            fired.push('nonTerC');
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('ter-a', '');
    node.setAttribute('non-ter-b', '');
    node.setAttribute('non-ter-c', '');

    $compile(node)(Scope.create());

    expect(fired).toContain('terA');
    expect(fired).toContain('nonTerC');
    expect(fired).not.toContain('nonTerB');
    expect(fired).toHaveLength(2);
  });

  it('terminal does NOT affect descendants — child directives still compile and link', () => {
    const fired: string[] = [];

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'terA',
        ddoFactory({
          restrict: 'A',
          priority: 100,
          terminal: true,
          link: () => {
            fired.push('terA');
          },
        }),
      );
      $cp.directive(
        'nonTerB',
        ddoFactory({
          restrict: 'A',
          priority: 50,
          link: () => {
            fired.push('nonTerB');
          },
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
    parent.setAttribute('ter-a', '');
    parent.setAttribute('non-ter-b', '');
    const child = document.createElement('span');
    child.setAttribute('child-dir', '');
    parent.appendChild(child);

    $compile(parent)(Scope.create());

    // Parent: terA fires; nonTerB is dropped by the cutoff.
    expect(fired).toContain('terA');
    expect(fired).not.toContain('nonTerB');
    // Descendant: childDir fires — terminal short-circuit is per-node.
    expect(fired).toContain('childDir');
  });

  it('multiple terminal directives at different priorities — only the highest-priority terminal cutoff applies', () => {
    const fired: string[] = [];

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'terA',
        ddoFactory({
          restrict: 'A',
          priority: 100,
          terminal: true,
          link: () => {
            fired.push('terA');
          },
        }),
      );
      // Lower-priority terminal — its `terminal: true` flag is
      // irrelevant because the priority-100 cutoff already excludes
      // it (50 < 100).
      $cp.directive(
        'terB',
        ddoFactory({
          restrict: 'A',
          priority: 50,
          terminal: true,
          link: () => {
            fired.push('terB');
          },
        }),
      );
      $cp.directive(
        'nonTerC',
        ddoFactory({
          restrict: 'A',
          priority: 25,
          link: () => {
            fired.push('nonTerC');
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('ter-a', '');
    node.setAttribute('ter-b', '');
    node.setAttribute('non-ter-c', '');

    $compile(node)(Scope.create());

    // Only the highest-priority terminal (terA at 100) runs; both
    // lower-priority directives — terminal or not — are dropped by
    // the priority-100 cutoff.
    expect(fired).toEqual(['terA']);
  });

  it('terminal at lower priority does NOT block higher-priority directives sorted ABOVE it', () => {
    const fired: string[] = [];

    const $compile = compileWith(($cp) => {
      // Terminal at priority 50, registered FIRST.
      $cp.directive(
        'terA',
        ddoFactory({
          restrict: 'A',
          priority: 50,
          terminal: true,
          link: () => {
            fired.push('terA');
          },
        }),
      );
      // Non-terminal at priority 100, registered SECOND.
      // Sorted DESC → nonTerB (100) precedes terA (50).
      // After cutoff: terA's `terminal: true` records cutoff 50;
      // nonTerB at 100 was already kept BEFORE the cutoff was
      // captured (it sits ABOVE terA in the sorted order); both
      // remain in the matched list.
      $cp.directive(
        'nonTerB',
        ddoFactory({
          restrict: 'A',
          priority: 100,
          link: () => {
            fired.push('nonTerB');
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('ter-a', '');
    node.setAttribute('non-ter-b', '');

    $compile(node)(Scope.create());

    expect(fired).toHaveLength(2);
    expect(fired).toContain('terA');
    expect(fired).toContain('nonTerB');
  });
});
