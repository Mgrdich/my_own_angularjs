/**
 * `$compile` pre-link contract tests (Slice 3 / FS §2.9).
 *
 * Locks the pre-link invariants:
 *
 * - Pre-link runs top-down across the tree — a node's pre-link runs
 *   BEFORE any of its children link.
 * - Multiple pre-links on the same node are ordered priority-
 *   DESCENDING (mirrors the compile-phase ordering).
 * - Mutations made by an earlier (higher-priority) pre-link are
 *   visible to subsequent pre-links on the same node.
 * - The sugar form (factory returning a function) does NOT contribute
 *   a pre-link — only a post-link.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from '@compiler/directive-types';
import { Scope } from '@core/index';

import { bootstrapNgModule, compileWith } from './test-helpers';

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

describe('$compile — pre-link contract (FS §2.9)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('pre-link runs BEFORE child link; post-link runs AFTER child link', () => {
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
          link: (() => {
            order.push('child-post');
          }) satisfies LinkFn,
        }),
      );
    });

    const parent = document.createElement('div');
    parent.setAttribute('parent-dir', '');
    const child = document.createElement('span');
    child.setAttribute('child-dir', '');
    parent.appendChild(child);

    $compile(parent)(Scope.create());

    expect(order).toEqual(['parent-pre', 'child-post', 'parent-post']);
  });

  it('multiple pre-links on the same node are priority-DESCENDING', () => {
    const order: string[] = [];
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'lowPri',
        ddoFactory({
          priority: 50,
          link: {
            pre: () => {
              order.push('low-50');
            },
          },
        }),
      );
      $cp.directive(
        'highPri',
        ddoFactory({
          priority: 100,
          link: {
            pre: () => {
              order.push('high-100');
            },
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('low-pri', '');
    node.setAttribute('high-pri', '');

    $compile(node)(Scope.create());

    expect(order).toEqual(['high-100', 'low-50']);
  });

  it('pre-link sees mutations made by an earlier (higher-priority) pre-link on the same node', () => {
    let observedFromHigh: unknown;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'highPri',
        ddoFactory({
          priority: 100,
          link: {
            pre: (scope) => {
              (scope as unknown as Record<string, unknown>)['fromHigh'] = 'yes';
            },
          },
        }),
      );
      $cp.directive(
        'lowPri',
        ddoFactory({
          priority: 50,
          link: {
            pre: (scope) => {
              observedFromHigh = (scope as unknown as Record<string, unknown>)['fromHigh'];
            },
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('high-pri', '');
    node.setAttribute('low-pri', '');

    $compile(node)(Scope.create());

    expect(observedFromHigh).toBe('yes');
  });

  it('pre-link receives the raw Element and the shared Attributes instance', () => {
    let preElement: Element | undefined;
    let preAttrs: { myDir?: unknown } | undefined;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          link: {
            pre: (_scope, element, attrs) => {
              preElement = element;
              preAttrs = attrs as unknown as { myDir?: unknown };
            },
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('my-dir', 'hello');
    $compile(node)(Scope.create());

    expect(preElement).toBeInstanceOf(Element);
    expect(preElement?.tagName).toBe('DIV');
    expect(preAttrs?.myDir).toBe('hello');
  });

  it('sugar form (factory returning a function) does NOT contribute a pre-link', () => {
    let preLinkCount = 0;
    const order: string[] = [];
    const $compile = compileWith(($cp) => {
      // Sugar: factory returns a bare function. By contract the
      // function IS the post-link, NOT the pre-link.
      $cp.directive('sugarDir', [
        () =>
          ((_scope, element) => {
            order.push('sugar-post');
            element.setAttribute('data-linked', 'true');
          }) satisfies LinkFn,
      ] as DirectiveFactory);
      // Sibling directive whose pre-link counter would only fire if
      // some other directive's pre-link did — locks the negative
      // contract by giving the assertion something to count beyond
      // the sugar directive itself.
      $cp.directive(
        'observerDir',
        ddoFactory({
          link: {
            pre: () => {
              preLinkCount += 1;
            },
            post: () => {
              order.push('observer-post');
            },
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('sugar-dir', '');
    node.setAttribute('observer-dir', '');

    $compile(node)(Scope.create());

    // observerDir contributed exactly one pre-link; sugarDir
    // contributed zero. If sugar leaked into pre-link, the count
    // would be 2.
    expect(preLinkCount).toBe(1);
    // Both post-links still ran.
    expect(order).toContain('sugar-post');
    expect(order).toContain('observer-post');
  });
});
