/**
 * `$compile` priority + tie-break ordering tests (Slice 3 / FS §2.7).
 *
 * Locks the directive ordering contract on a single node:
 *
 * - Compile and pre-link run priority-DESCENDING; post-link runs
 *   priority-ASCENDING (the canonical reversal AngularJS has shipped
 *   for over a decade).
 * - Same priority → registration order determines compile / pre-link
 *   order; post-link sees the reversed order.
 * - Element-restrict and attribute-restrict directives on the same
 *   node sort into a single list — `restrict` letters do NOT
 *   bucket directives separately.
 * - `Infinity` priority sorts above any finite priority (including
 *   1_000_000) — direct port of AngularJS's `Number` comparison.
 * - Negative priorities are valid and sort lower than priority 0.
 *
 * Subtle scaffolding note: `index` is assigned at first-lookup time
 * via the module-level `$$globalDirectiveIndex++` in
 * `compile-provider.ts`. Inside `collectDirectives`, lookup order
 * matches DOM-attribute iteration order. To make the
 * registration-order tie-break observable, every test below sets the
 * attribute order to match the registration order — the canonical
 * usage pattern.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService, DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import { createTemplateCache } from '@template/template-cache';
import { createTemplateRequest } from '@template/template-request';
import type { TemplateCacheService, TemplateRequestFn } from '@template/template-types';

function bootstrapNgModule(): void {
  resetRegistry();
  createModule('ng', [])
    .factory('$exceptionHandler', [() => () => undefined])
    .provider('$sceDelegate', $SceDelegateProvider)
    .provider('$sce', $SceProvider)
    .provider('$interpolate', $InterpolateProvider)
    .provider('$filter', ['$provide', $FilterProvider])
    .factory('$templateCache', [() => createTemplateCache()])
    .factory('$templateRequest', [
      '$templateCache',
      (cache: TemplateCacheService): TemplateRequestFn => createTemplateRequest({ cache }),
    ])
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

describe('$compile — priority sort + registration-order tie-break (FS §2.7)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('priorities 100 vs 50 — compile DESC, pre DESC, post ASC', () => {
    const compileOrder: string[] = [];
    const preOrder: string[] = [];
    const postOrder: string[] = [];

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'highPri',
        ddoFactory({
          priority: 100,
          compile: () => {
            compileOrder.push('high-100');
            return {
              pre: () => {
                preOrder.push('high-100');
              },
              post: () => {
                postOrder.push('high-100');
              },
            };
          },
        }),
      );
      $cp.directive(
        'lowPri',
        ddoFactory({
          priority: 50,
          compile: () => {
            compileOrder.push('low-50');
            return {
              pre: () => {
                preOrder.push('low-50');
              },
              post: () => {
                postOrder.push('low-50');
              },
            };
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('high-pri', '');
    node.setAttribute('low-pri', '');

    $compile(node)(Scope.create());

    expect(compileOrder).toEqual(['high-100', 'low-50']);
    expect(preOrder).toEqual(['high-100', 'low-50']);
    // Post-link is the reversal — lowest priority first.
    expect(postOrder).toEqual(['low-50', 'high-100']);
  });

  it('same priority — registration order determines compile / pre order; post sees reversed order', () => {
    const compileOrder: string[] = [];
    const preOrder: string[] = [];
    const postOrder: string[] = [];

    const $compile = compileWith(($cp) => {
      // Registered FIRST → lower index → compile/pre runs FIRST.
      $cp.directive(
        'dirA',
        ddoFactory({
          priority: 0,
          compile: () => {
            compileOrder.push('dirA');
            return {
              pre: () => {
                preOrder.push('dirA');
              },
              post: () => {
                postOrder.push('dirA');
              },
            };
          },
        }),
      );
      // Registered SECOND → higher index → compile/pre runs SECOND.
      $cp.directive(
        'dirB',
        ddoFactory({
          priority: 0,
          compile: () => {
            compileOrder.push('dirB');
            return {
              pre: () => {
                preOrder.push('dirB');
              },
              post: () => {
                postOrder.push('dirB');
              },
            };
          },
        }),
      );
    });

    const node = document.createElement('div');
    // DOM attribute order matches registration order so the
    // first-lookup `index` assignment matches registration order.
    node.setAttribute('dir-a', '');
    node.setAttribute('dir-b', '');

    $compile(node)(Scope.create());

    expect(compileOrder).toEqual(['dirA', 'dirB']);
    expect(preOrder).toEqual(['dirA', 'dirB']);
    // Post-link reverses the list — dirB (last registered) runs first.
    expect(postOrder).toEqual(['dirB', 'dirA']);
  });

  it('element-restrict + attribute-restrict on same node sort into a single list', () => {
    const compileOrder: string[] = [];

    const $compile = compileWith(($cp) => {
      // Element-restricted directive at priority 100.
      $cp.directive(
        'myE',
        ddoFactory({
          restrict: 'E',
          priority: 100,
          compile: () => {
            compileOrder.push('myE-100');
          },
        }),
      );
      // Attribute-restricted directive at priority 50.
      $cp.directive(
        'myA',
        ddoFactory({
          restrict: 'A',
          priority: 50,
          compile: () => {
            compileOrder.push('myA-50');
          },
        }),
      );
    });

    // Element name `<my-e>` matches `myE`; attribute `my-a` matches
    // `myA`. Both directives are collected into the same list and
    // sorted together by priority.
    const node = document.createElement('my-e');
    node.setAttribute('my-a', '');

    $compile(node)(Scope.create());

    expect(compileOrder).toEqual(['myE-100', 'myA-50']);
  });

  it('Infinity priority sorts ABOVE 1_000_000', () => {
    const compileOrder: string[] = [];

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'finitePri',
        ddoFactory({
          priority: 1_000_000,
          compile: () => {
            compileOrder.push('finite-1M');
          },
        }),
      );
      $cp.directive(
        'infPri',
        ddoFactory({
          priority: Infinity,
          compile: () => {
            compileOrder.push('infinity');
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('finite-pri', '');
    node.setAttribute('inf-pri', '');

    $compile(node)(Scope.create());

    expect(compileOrder).toEqual(['infinity', 'finite-1M']);
  });

  it('negative priorities sort LOWER than 0 in compile, HIGHER than 0 in post-link', () => {
    const compileOrder: string[] = [];
    const postOrder: string[] = [];

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'zeroPri',
        ddoFactory({
          priority: 0,
          compile: () => {
            compileOrder.push('zero');
            return () => {
              postOrder.push('zero');
            };
          },
        }),
      );
      $cp.directive(
        'negPri',
        ddoFactory({
          priority: -10,
          compile: () => {
            compileOrder.push('neg-10');
            return () => {
              postOrder.push('neg-10');
            };
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('zero-pri', '');
    node.setAttribute('neg-pri', '');

    $compile(node)(Scope.create());

    // Compile: priority DESC → 0 before -10.
    expect(compileOrder).toEqual(['zero', 'neg-10']);
    // Post-link: priority ASC → -10 before 0.
    expect(postOrder).toEqual(['neg-10', 'zero']);
  });
});
