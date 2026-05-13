/**
 * `$compile` post-link contract tests (Slice 3 / FS §2.10).
 *
 * Locks the post-link invariants:
 *
 * - Post-link runs bottom-up across the tree — a node's children
 *   complete linking before the node's own post-link fires.
 * - Multiple post-links on the same node are ordered priority-
 *   ASCENDING — lowest priority first, highest last.
 * - The sugar form (factory returning a function) registers as a
 *   post-link; the function fires AFTER child linking and BEFORE
 *   any ancestor post-link.
 * - The DDO `{ link: { pre, post } }` form wires both phases
 *   correctly — pre runs in the pre-link slot (top-down), post runs
 *   in the post-link slot (bottom-up).
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from '@compiler/directive-types';
import { Scope } from '@core/index';

import { bootstrapNgModule, compileWith } from './test-helpers';

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

describe('$compile — post-link contract (FS §2.10)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('post-link runs AFTER child link (bottom-up across the tree)', () => {
    const order: string[] = [];
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'parentDir',
        ddoFactory({
          link: () => {
            order.push('parent-post');
          },
        }),
      );
      $cp.directive(
        'childDir',
        ddoFactory({
          link: () => {
            order.push('child-post');
          },
        }),
      );
    });

    const parent = document.createElement('div');
    parent.setAttribute('parent-dir', '');
    const child = document.createElement('span');
    child.setAttribute('child-dir', '');
    parent.appendChild(child);

    $compile(parent)(Scope.create());

    expect(order).toEqual(['child-post', 'parent-post']);
  });

  it('multiple post-links on the same node are priority-ASCENDING', () => {
    const order: string[] = [];
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'highPri',
        ddoFactory({
          priority: 100,
          link: () => {
            order.push('high-100');
          },
        }),
      );
      $cp.directive(
        'lowPri',
        ddoFactory({
          priority: 50,
          link: () => {
            order.push('low-50');
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('high-pri', '');
    node.setAttribute('low-pri', '');

    $compile(node)(Scope.create());

    // Priority-ASCENDING: 50 fires first, 100 fires last.
    expect(order).toEqual(['low-50', 'high-100']);
  });

  it('sugar form (factory returns fn) registers as a post-link — fires after child link, before parent post-link', () => {
    const order: string[] = [];
    const $compile = compileWith(($cp) => {
      $cp.directive('parentSugar', [
        () =>
          (() => {
            order.push('parent-sugar-post');
          }) satisfies LinkFn,
      ] as DirectiveFactory);
      $cp.directive(
        'childDir',
        ddoFactory({
          link: () => {
            order.push('child-post');
          },
        }),
      );
    });

    const parent = document.createElement('div');
    parent.setAttribute('parent-sugar', '');
    const child = document.createElement('span');
    child.setAttribute('child-dir', '');
    parent.appendChild(child);

    $compile(parent)(Scope.create());

    // Child's post-link runs first (bottom-up); the parent's sugar
    // function ran as a post-link.
    expect(order).toEqual(['child-post', 'parent-sugar-post']);
  });

  it('post-link receives the raw Element and the shared Attributes instance', () => {
    let postElement: Element | undefined;
    let postAttrs: { myDir?: unknown } | undefined;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          link: (_scope, element, attrs) => {
            postElement = element;
            postAttrs = attrs as unknown as { myDir?: unknown };
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('my-dir', 'world');
    $compile(node)(Scope.create());

    expect(postElement).toBeInstanceOf(Element);
    expect(postElement?.tagName).toBe('DIV');
    expect(postAttrs?.myDir).toBe('world');
  });

  it('{ link: { pre, post } } wires both phases independently', () => {
    const order: string[] = [];
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'parentDir',
        ddoFactory({
          link: {
            pre: () => {
              order.push('parent-pre');
            },
            post: () => {
              order.push('parent-post');
            },
          },
        }),
      );
      $cp.directive(
        'childDir',
        ddoFactory({
          link: {
            pre: () => {
              order.push('child-pre');
            },
            post: () => {
              order.push('child-post');
            },
          },
        }),
      );
    });

    const parent = document.createElement('div');
    parent.setAttribute('parent-dir', '');
    const child = document.createElement('span');
    child.setAttribute('child-dir', '');
    parent.appendChild(child);

    $compile(parent)(Scope.create());

    // Pre runs top-down; post runs bottom-up. The interleaving locks
    // the contract that both slots fire in the correct phase.
    expect(order).toEqual(['parent-pre', 'child-pre', 'child-post', 'parent-post']);
  });
});
