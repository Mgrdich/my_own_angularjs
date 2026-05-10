/**
 * `$compile` end-to-end integration tests (Slice 2 / FS §2.1, §2.5, §2.10).
 *
 * Registers an attribute-restricted directive, builds a fixture DOM
 * node, compiles + links it, and asserts the post-link function ran
 * and mutated the DOM. Covers the Slice-2 acceptance criteria from
 * FS §2.1 ($compile service surface), §2.5 (E + A restrict matching),
 * and §2.10 (post-link).
 *
 * The `ng` module is registered at import time; a `resetRegistry()`
 * in a neighbouring test would evict it. Re-register a fresh `'ng'`
 * here so any `requires: ['ng']` lookup downstream still resolves.
 *
 * Factories are written in array-style annotation form (`[() => ({…})]`)
 * because `$injector.invoke` requires either a `$inject` property or
 * the array form. Bare arrow factories have no parameters to
 * scrape, so the array wrapper is the canonical no-dep registration.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService, DirectiveFactory, DirectiveFactoryReturn, LinkFn } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';

function bootstrapNgModule(): void {
  resetRegistry();
  createModule('ng', [])
    .factory('$exceptionHandler', [() => () => undefined])
    .provider('$sceDelegate', $SceDelegateProvider)
    .provider('$sce', $SceProvider)
    .provider('$interpolate', $InterpolateProvider)
    .provider('$filter', ['$provide', $FilterProvider])
    .provider('$compile', ['$provide', $CompileProvider]);
}

function compileWith(register: ($cp: $CompileProvider) => void): CompileService {
  const appModule = createModule('app', ['ng']).config([
    '$compileProvider',
    ($cp: $CompileProvider) => {
      register($cp);
    },
  ]);
  return createInjector([appModule]).get('$compile');
}

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

describe('$compile — attribute-restricted post-link directive (FS §2.1, §2.10)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('mutates the DOM via the post-link function on a matched <div my-dir> node', () => {
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          link: (_scope, element) => {
            element.textContent = 'hi';
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('my-dir', '');

    $compile(node)(Scope.create());

    expect(node.textContent).toBe('hi');
  });

  it('returns the same node reference from the linker (no clone)', () => {
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          link: () => {
            /* noop */
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('my-dir', '');

    const result = $compile(node)(Scope.create());
    expect(result).toBe(node);
  });

  describe('sugar form: factory returns a function', () => {
    it('treats the function as post-link with default restrict EA', () => {
      const observed: string[] = [];
      const link: LinkFn = (_scope, element) => {
        observed.push('post');
        element.setAttribute('data-linked', 'true');
      };
      const $compile = compileWith(($cp) => {
        $cp.directive('myDir', [() => link] as DirectiveFactory);
      });

      const node = document.createElement('div');
      node.setAttribute('my-dir', '');

      $compile(node)(Scope.create());

      expect(observed).toEqual(['post']);
      expect(node.getAttribute('data-linked')).toBe('true');
    });
  });

  describe('restrict modes (FS §2.5 — E + A only in Slice 2)', () => {
    it('default restrict EA matches a <my-dir> element', () => {
      const observed: string[] = [];
      const $compile = compileWith(($cp) => {
        $cp.directive(
          'myDir',
          ddoFactory({
            link: () => {
              observed.push('linked');
            },
          }),
        );
      });

      const node = document.createElement('my-dir');
      $compile(node)(Scope.create());

      expect(observed).toEqual(['linked']);
    });

    it('default restrict EA matches a <div my-dir> attribute', () => {
      const observed: string[] = [];
      const $compile = compileWith(($cp) => {
        $cp.directive(
          'myDir',
          ddoFactory({
            link: () => {
              observed.push('linked');
            },
          }),
        );
      });

      const node = document.createElement('div');
      node.setAttribute('my-dir', '');

      $compile(node)(Scope.create());

      expect(observed).toEqual(['linked']);
    });

    it('explicit restrict E does NOT match <div my-dir>', () => {
      const observed: string[] = [];
      const $compile = compileWith(($cp) => {
        $cp.directive(
          'myDir',
          ddoFactory({
            restrict: 'E',
            link: () => {
              observed.push('linked');
            },
          }),
        );
      });

      const node = document.createElement('div');
      node.setAttribute('my-dir', '');

      $compile(node)(Scope.create());

      expect(observed).toEqual([]);
    });

    it('explicit restrict E matches <my-dir>', () => {
      const observed: string[] = [];
      const $compile = compileWith(($cp) => {
        $cp.directive(
          'myDir',
          ddoFactory({
            restrict: 'E',
            link: () => {
              observed.push('linked');
            },
          }),
        );
      });

      const node = document.createElement('my-dir');
      $compile(node)(Scope.create());

      expect(observed).toEqual(['linked']);
    });
  });

  describe('recursive walk (FS §2.10 — post-link bottom-up)', () => {
    it('child post-link runs before parent post-link', () => {
      const order: string[] = [];
      const $compile = compileWith(($cp) => {
        $cp.directive(
          'parentDir',
          ddoFactory({
            link: () => {
              order.push('parent');
            },
          }),
        );
        $cp.directive(
          'childDir',
          ddoFactory({
            link: () => {
              order.push('child');
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

      expect(order).toEqual(['child', 'parent']);
    });
  });

  describe('priority sort on a single node (FS §2.10)', () => {
    it('post-link runs in priority-ASCENDING order — lowest priority first, highest last', () => {
      const order: string[] = [];
      const $compile = compileWith(($cp) => {
        $cp.directive(
          'hiPriority',
          ddoFactory({
            priority: 100,
            link: () => {
              order.push('hi');
            },
          }),
        );
        $cp.directive(
          'loPriority',
          ddoFactory({
            priority: 50,
            link: () => {
              order.push('lo');
            },
          }),
        );
      });

      const node = document.createElement('div');
      node.setAttribute('hi-priority', '');
      node.setAttribute('lo-priority', '');

      $compile(node)(Scope.create());

      expect(order).toEqual(['lo', 'hi']);
    });
  });
});
