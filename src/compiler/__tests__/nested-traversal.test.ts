/**
 * `$compile` nested-tree traversal tests.
 *
 * Closes three coverage gaps left by the per-node and single-level
 * (parent/child) tests already in this directory:
 *
 * 1. **3-level deep trees** — pins the full pre/post interleaving
 *    `gPre → pPre → cPre → cPost → pPost → gPost`. The existing tests
 *    only walk a single `parent.appendChild(child)` pair, so a
 *    regression that flattened the recursion to one level would not
 *    fail any other test.
 * 2. **Multiple element siblings + comment siblings under one parent**
 *    — pins DOM-order traversal of mixed sibling node types: element,
 *    comment (M-restricted), element. Children link in document order;
 *    text nodes are skipped silently and don't disturb ordering.
 * 3. **Cross-level priority isolation** — pins that priority sorts
 *    ONLY within a single element's directive list, never across the
 *    tree. A child directive at `Infinity` priority still links INSIDE
 *    its parent's pre/post bracket; tree topology wins over priority.
 *
 * All three contracts are AngularJS-canonical — the recursion in
 * `src/compiler/compile.ts` walks `childNodes` in document order,
 * sorts directives only at the per-element `collectDirectives` step,
 * and recurses depth-first.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import { Scope } from '@core/index';

import { bootstrapNgModule, compileWith } from './test-helpers';

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

describe('$compile — nested-tree traversal', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('3-level deep tree — full pre/post interleaving across grandparent → parent → child', () => {
    const order: string[] = [];
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'grandDir',
        ddoFactory({
          link: {
            pre: () => {
              order.push('grand-pre');
            },
            post: () => {
              order.push('grand-post');
            },
          },
        }),
      );
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

    const grand = document.createElement('div');
    grand.setAttribute('grand-dir', '');
    const parent = document.createElement('section');
    parent.setAttribute('parent-dir', '');
    const child = document.createElement('span');
    child.setAttribute('child-dir', '');
    parent.appendChild(child);
    grand.appendChild(parent);

    $compile(grand)(Scope.create());

    // Pre-link is top-down, post-link is bottom-up, and the recursion
    // is genuinely depth-first — a flattened walker would emit pre
    // before recursing or post after recursing in a different order.
    expect(order).toEqual(['grand-pre', 'parent-pre', 'child-pre', 'child-post', 'parent-post', 'grand-post']);
  });

  it('siblings link in DOM order — element, comment (M), element under one parent; text is skipped', () => {
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
        'firstDir',
        ddoFactory({
          link: () => {
            order.push('first-post');
          },
        }),
      );
      $cp.directive(
        'commentDir',
        ddoFactory({
          restrict: 'M',
          link: () => {
            order.push('comment-post');
          },
        }),
      );
      $cp.directive(
        'lastDir',
        ddoFactory({
          link: () => {
            order.push('last-post');
          },
        }),
      );
    });

    const parent = document.createElement('div');
    parent.setAttribute('parent-dir', '');
    const first = document.createElement('span');
    first.setAttribute('first-dir', '');
    const text = document.createTextNode('ignored — text nodes match no directives');
    const comment = document.createComment(' directive: comment-dir ');
    const last = document.createElement('em');
    last.setAttribute('last-dir', '');
    // DOM order: first, text, comment, last. The walker iterates
    // `childNodes` so text + comment + element are all visited; text
    // returns the no-op linker (matches no directives), so it
    // contributes nothing to `order`. Comments + elements DO match.
    parent.appendChild(first);
    parent.appendChild(text);
    parent.appendChild(comment);
    parent.appendChild(last);

    $compile(parent)(Scope.create());

    expect(order).toEqual(['parent-pre', 'first-post', 'comment-post', 'last-post', 'parent-post']);
  });

  it('child priority does NOT cross element boundaries — Infinity-priority child still links INSIDE parent pre/post', () => {
    const order: string[] = [];
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'parentDir',
        ddoFactory({
          priority: 0,
          link: {
            pre: () => {
              order.push('parent-pre-0');
            },
            post: () => {
              order.push('parent-post-0');
            },
          },
        }),
      );
      $cp.directive(
        'childDir',
        ddoFactory({
          priority: Infinity,
          link: {
            pre: () => {
              order.push('child-pre-INF');
            },
            post: () => {
              order.push('child-post-INF');
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

    // Priority sorts directives only within a single element's
    // directive list. The child's Infinity priority places it FIRST
    // among the child element's (singleton) directives — but the
    // child element is STILL visited only after the parent's pre-link
    // and before the parent's post-link. The tree topology wins.
    expect(order).toEqual(['parent-pre-0', 'child-pre-INF', 'child-post-INF', 'parent-post-0']);
  });
});
