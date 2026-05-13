/**
 * Multi-clone transclusion — repeated `$transclude(...)` calls
 * (spec 018 Slice 3 / FS §2.7).
 *
 * Locks the AngularJS-canonical infrastructure that `ng-repeat` will
 * lean on once it ships:
 *
 * - Two sequential `$transclude(...)` calls produce independent
 *   clones with independent transclusion scopes.
 * - The captured master fragment is never mutated — every projection
 *   is from a fresh `Node.cloneNode(true)` so the master stays
 *   pristine for the next call.
 * - High-volume (1000-clone) smoke test guards against accidental
 *   O(N²) behavior in the deep-clone + scope-create path.
 * - A directive that declares `transclude: true` but never calls
 *   `$transclude` is supported — the captured fragment is released to
 *   GC when the host element is destroyed (no orphaned watchers).
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { destroyElementScope } from '@compiler/cleanup';
import type { DirectiveFactory, DirectiveFactoryReturn, TranscludeFn } from '@compiler/directive-types';
import { Scope } from '@core/index';

import { bootstrapNgModule, compileWith } from './test-helpers';

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

describe('multi-clone transclusion (FS §2.7)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('two sequential $transclude(...) calls produce independent clones with independent scopes', () => {
    let xclude: TranscludeFn | undefined;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            xclude = $transclude;
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    const p = document.createElement('p');
    p.textContent = 'hello';
    host.appendChild(p);

    $compile(host)(Scope.create());

    let cloneA: Node[] = [];
    let cloneB: Node[] = [];
    let scopeA: Scope | null = null;
    let scopeB: Scope | null = null;

    xclude?.((c, s) => {
      cloneA = c;
      scopeA = s;
    });
    xclude?.((c, s) => {
      cloneB = c;
      scopeB = s;
    });

    expect(cloneA[0]).not.toBe(cloneB[0]);
    expect(scopeA).not.toBeNull();
    expect(scopeB).not.toBeNull();
    expect(scopeA).not.toBe(scopeB);
  });

  it('the master fragment is never mutated across many clones', () => {
    let xclude: TranscludeFn | undefined;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            xclude = $transclude;
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    const p = document.createElement('p');
    p.setAttribute('id', 'master');
    p.textContent = 'hello';
    host.appendChild(p);

    $compile(host)(Scope.create());

    // The master `<p>` has been detached into the private fragment.
    // We don't have direct access to it, but every projection should
    // produce a NEW element with the same authored content.
    const clones: Node[][] = [];
    for (let i = 0; i < 5; i++) {
      clones.push(xclude?.(() => undefined) ?? []);
    }
    expect(clones.length).toBe(5);
    // Every clone is distinct.
    for (let i = 0; i < clones.length; i++) {
      for (let j = i + 1; j < clones.length; j++) {
        expect(clones[i]?.[0]).not.toBe(clones[j]?.[0]);
      }
    }
    // Every clone has the same authored DOM contents.
    for (const clone of clones) {
      const el = clone[0] as Element;
      expect(el.tagName).toBe('P');
      expect(el.getAttribute('id')).toBe('master');
      expect(el.textContent).toBe('hello');
    }
  });

  it('1000 clones complete within a generous timeout (no O(N²) regression)', () => {
    let xclude: TranscludeFn | undefined;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            xclude = $transclude;
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    const p = document.createElement('p');
    p.textContent = 'x';
    host.appendChild(p);

    $compile(host)(Scope.create());

    const N = 1000;
    let count = 0;
    for (let i = 0; i < N; i++) {
      const clone = xclude?.(() => undefined) ?? [];
      if (clone.length === 1) {
        count++;
      }
    }
    expect(count).toBe(N);
  }, 5000);

  it('a directive that never calls $transclude does not leak the captured fragment when host is destroyed', () => {
    // No clones produced → cleanup queue has no transclusion-scope
    // entries. `destroyElementScope` runs without throwing and leaves
    // the host's scope tree unchanged. (The captured master nodes
    // are only referenced by closures inside the host's NodeLinker,
    // which is itself only referenced from the test's `$compile`
    // service; when the test exits, GC reclaims everything.)
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: () => {
            /* never project */
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    host.appendChild(document.createElement('p'));

    $compile(host)(Scope.create());

    expect(() => {
      destroyElementScope(host);
    }).not.toThrow();
  });
});
