/**
 * `$compile` compile-phase contract tests (Slice 3 / FS §2.8).
 *
 * Locks the compile-phase invariants:
 *
 * - Compile-phase mutations to the element are visible to child
 *   compilation (parent's compile runs BEFORE the walker descends
 *   into children).
 * - Compile runs ONCE per template, regardless of how many times the
 *   produced linker is invoked.
 * - Compile runs in priority-DESCENDING order across all matched
 *   directives on a single node.
 * - Compile receives the raw DOM `Element` and the SAME `Attributes`
 *   instance later passed to every link function on the node.
 *
 * Test scaffolding mirrors `compile.test.ts`: re-bootstrap the `ng`
 * module per test, register directives via a `compileWith` helper,
 * and use array-style annotations for factories.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { Attributes, DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import { Scope } from '@core/index';

import { bootstrapNgModule, compileWith } from './test-helpers';

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

describe('$compile — compile phase contract (FS §2.8)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it("compile-phase mutation on the parent is visible to the child's link function", () => {
    const observed: { fromParent: string | undefined } = { fromParent: undefined };
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'parentDir',
        ddoFactory({
          priority: 100,
          compile: (element) => {
            // Parent's compile mutates the parent element. The
            // contract under test: the child's compile/link runs
            // AFTER this mutation, so it sees the new attribute.
            element.setAttribute('data-from-parent', 'yes');
            // No link contribution — the mutation alone is the test.
            return;
          },
        }),
      );
      $cp.directive(
        'childDir',
        ddoFactory({
          link: (_scope, element) => {
            // Child's post-link reads the parent's compile-time
            // mutation through DOM walk-up. The mutation must be
            // visible to confirm the parent's compile ran BEFORE
            // child compilation/linking.
            observed.fromParent = element.parentElement?.getAttribute('data-from-parent') ?? undefined;
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

    expect(observed.fromParent).toBe('yes');
  });

  it('compile fn runs exactly ONCE across two linker invocations', () => {
    let compileCount = 0;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          compile: () => {
            compileCount += 1;
            return () => {
              /* post-link no-op */
            };
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('my-dir', '');

    const linker = $compile(node);
    linker(Scope.create());
    linker(Scope.create());

    expect(compileCount).toBe(1);
  });

  it('compile runs in priority-DESCENDING order on a single node', () => {
    const order: string[] = [];
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'lowPri',
        ddoFactory({
          priority: 50,
          compile: () => {
            order.push('low-50');
          },
        }),
      );
      $cp.directive(
        'highPri',
        ddoFactory({
          priority: 100,
          compile: () => {
            order.push('high-100');
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

  it('compile runs BEFORE the walker descends into children — child compile sees parent mutations', () => {
    const childCompileSawAttribute: { value: string | undefined } = { value: undefined };
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'parentDir',
        ddoFactory({
          compile: (element) => {
            // Parent's compile mutates BEFORE child compilation starts.
            element.setAttribute('data-stamp', 'compile-time');
          },
        }),
      );
      $cp.directive(
        'childDir',
        ddoFactory({
          compile: (element) => {
            childCompileSawAttribute.value = element.parentElement?.getAttribute('data-stamp') ?? undefined;
          },
        }),
      );
    });

    const parent = document.createElement('div');
    parent.setAttribute('parent-dir', '');
    const child = document.createElement('span');
    child.setAttribute('child-dir', '');
    parent.appendChild(child);

    $compile(parent);
    expect(childCompileSawAttribute.value).toBe('compile-time');
  });

  it('compile returning undefined contributes no link entry (other directives still link)', () => {
    const order: string[] = [];
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'noLinkDir',
        ddoFactory({
          priority: 100,
          compile: () => {
            order.push('no-link-compile');
            // Returning void (undefined). Per FS §2.8 this directive
            // contributes no link function — but its compile still
            // counts as part of the priority-sorted compile sweep.
            return undefined;
          },
        }),
      );
      $cp.directive(
        'sibling',
        ddoFactory({
          priority: 50,
          link: () => {
            order.push('sibling-link');
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('no-link-dir', '');
    node.setAttribute('sibling', '');

    $compile(node)(Scope.create());

    expect(order).toEqual(['no-link-compile', 'sibling-link']);
  });

  it('compile receives the raw Element and the same Attributes instance shared with link', () => {
    let compileElement: Element | undefined;
    let attrsRef: Attributes | undefined;
    let linkAttrs: Attributes | undefined;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          compile: (element, attrs) => {
            compileElement = element;
            attrsRef = attrs;
            return (_scope, _el, linkedAttrs) => {
              linkAttrs = linkedAttrs;
            };
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('my-dir', 'hello');
    $compile(node)(Scope.create());

    expect(compileElement).toBeInstanceOf(Element);
    expect(compileElement?.tagName).toBe('DIV');
    expect(compileElement).toBe(node);
    // Reference equality — same Attributes instance shared across
    // compile and post-link on the same element.
    expect(linkAttrs).toBe(attrsRef);
    expect(linkAttrs?.['myDir']).toBe('hello');
  });
});
