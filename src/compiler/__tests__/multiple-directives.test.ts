/**
 * `$compile` multiple-factories-per-name accumulation tests
 * (Slice 5 / FS §2.3).
 *
 * Locks the AngularJS-canonical contract that `$compileProvider.directive`
 * does NOT replace prior registrations — each call APPENDS to the
 * per-name factory list, both factories run on a matched node, and
 * both participate in priority sorting independently.
 *
 * Implementation reference: `src/compiler/compile-provider.ts:125-166`.
 *
 * - First registration for a name installs a single `<name>Directive`
 *   provider via `$provide.provider(...)`. Subsequent registrations
 *   only mutate `$$factoryMap.get(name)`. The provider's `$get` reads
 *   the up-to-date factory list LAZILY at lookup time, so all factories
 *   are visible the first time `$injector.get('myDirDirective')` is
 *   called.
 * - `$$globalDirectiveIndex` is incremented per FACTORY inside
 *   `normalizeDirective`, so two factories under the same name receive
 *   distinct `index` values — registration-order tie-break works for
 *   factories sharing a name exactly the same as it does for factories
 *   under different names.
 * - Object-form `$compileProvider.directive({ myDir: A, myDir: B })`
 *   does NOT accumulate, because JS literal duplicate-key semantics
 *   collapse to the LAST entry before the method ever sees the keys.
 *   For accumulation, callers MUST use repeated single-form calls.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService, Directive, DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { createInjector } from '@di/injector';
import { createModule } from '@di/module';

import { bootstrapNgModule, compileWith } from './test-helpers';

function buildInjector(register: ($cp: $CompileProvider) => void) {
  const appModule = createModule('app', ['ng']).config([
    '$compileProvider',
    ($cp: $CompileProvider) => {
      register($cp);
    },
  ]);
  return createInjector([appModule]);
}

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

/**
 * Tiny invocation-counter spy that satisfies the array-style
 * `Invokable<DirectiveFactoryReturn>` shape used by `$injector.invoke`.
 * Used by the object-form duplicate-key test to assert that ONLY the
 * second (surviving) factory is ever invoked.
 */
type CountingFactory = DirectiveFactory & { invocations: number };

function countingFactory(impl: () => DirectiveFactoryReturn): CountingFactory {
  const fn = (): DirectiveFactoryReturn => {
    factory.invocations += 1;
    return impl();
  };
  const factory = [fn] as unknown as CountingFactory;
  factory.invocations = 0;
  return factory;
}

describe('$compile — multiple factories per directive name (FS §2.3)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('two factories registered under the same name both run on a matched node', () => {
    const factoryA: DirectiveFactory = ddoFactory({
      link: (_scope, element) => {
        element.classList.add('a-ran');
      },
    });
    const factoryB: DirectiveFactory = ddoFactory({
      link: (_scope, element) => {
        element.classList.add('b-ran');
      },
    });

    const $compile = compileWith(($cp) => {
      $cp.directive('myDir', factoryA);
      $cp.directive('myDir', factoryB);
    });

    const node = document.createElement('div');
    node.setAttribute('my-dir', '');

    $compile(node)(Scope.create());

    expect(node.classList.contains('a-ran')).toBe(true);
    expect(node.classList.contains('b-ran')).toBe(true);
  });

  it("injector.get('myDirDirective') returns an array of two distinct directive objects", () => {
    const factoryA: DirectiveFactory = ddoFactory({
      link: () => {
        /* noop */
      },
    });
    const factoryB: DirectiveFactory = ddoFactory({
      link: () => {
        /* noop */
      },
    });

    const injector = buildInjector(($cp) => {
      $cp.directive('myDir', factoryA);
      $cp.directive('myDir', factoryB);
    });

    const directives = injector.get<Directive[]>('myDirDirective');
    expect(Array.isArray(directives)).toBe(true);
    expect(directives).toHaveLength(2);
    // Every factory produces its own Directive object with a distinct,
    // monotonically-increasing `index` — the tie-break key used by the
    // priority sort.
    expect(directives[0]?.index).not.toBe(directives[1]?.index);
    expect(directives[0]?.index).toBeLessThan(directives[1]?.index ?? 0);
  });

  it('same priority — registration order determines link order (factoryA first → post-link last; factoryB last → post-link first)', () => {
    const compileOrder: string[] = [];
    const preOrder: string[] = [];
    const postOrder: string[] = [];

    const factoryA: DirectiveFactory = ddoFactory({
      compile: () => {
        compileOrder.push('A');
        return {
          pre: () => {
            preOrder.push('A');
          },
          post: () => {
            postOrder.push('A');
          },
        };
      },
    });
    const factoryB: DirectiveFactory = ddoFactory({
      compile: () => {
        compileOrder.push('B');
        return {
          pre: () => {
            preOrder.push('B');
          },
          post: () => {
            postOrder.push('B');
          },
        };
      },
    });

    const $compile = compileWith(($cp) => {
      $cp.directive('myDir', factoryA);
      $cp.directive('myDir', factoryB);
    });

    const node = document.createElement('div');
    node.setAttribute('my-dir', '');

    $compile(node)(Scope.create());

    // Compile + pre-link: priority-DESCENDING, then `index` ASCENDING
    // tie-break. Both at priority 0 → registration order (A then B).
    expect(compileOrder).toEqual(['A', 'B']);
    expect(preOrder).toEqual(['A', 'B']);
    // Post-link: the linker reverses the compile-order list, so the
    // LATER-registered factory (B) runs FIRST and the FIRST-registered
    // factory (A) runs LAST. Matches the AngularJS contract: "lower
    // priority first, higher priority last; within a priority bucket
    // the reversal exposes registration-DESC order".
    expect(postOrder).toEqual(['B', 'A']);
  });

  it('mixed priorities sort by priority regardless of registration order', () => {
    const compileOrder: string[] = [];
    const preOrder: string[] = [];
    const postOrder: string[] = [];

    // factoryA registered FIRST at priority 50 — but priority 100
    // (factoryB) wins regardless.
    const factoryA: DirectiveFactory = ddoFactory({
      priority: 50,
      compile: () => {
        compileOrder.push('A-50');
        return {
          pre: () => {
            preOrder.push('A-50');
          },
          post: () => {
            postOrder.push('A-50');
          },
        };
      },
    });
    const factoryB: DirectiveFactory = ddoFactory({
      priority: 100,
      compile: () => {
        compileOrder.push('B-100');
        return {
          pre: () => {
            preOrder.push('B-100');
          },
          post: () => {
            postOrder.push('B-100');
          },
        };
      },
    });

    const $compile = compileWith(($cp) => {
      $cp.directive('myDir', factoryA);
      $cp.directive('myDir', factoryB);
    });

    const node = document.createElement('div');
    node.setAttribute('my-dir', '');

    $compile(node)(Scope.create());

    expect(compileOrder).toEqual(['B-100', 'A-50']);
    expect(preOrder).toEqual(['B-100', 'A-50']);
    // Post-link reverses by priority — lower priority runs FIRST.
    expect(postOrder).toEqual(['A-50', 'B-100']);
  });

  it('object-form `directive({ myDir: A, myDir: B })` collapses to factoryB only (JS duplicate-key semantics)', () => {
    // The object literal collapses duplicate keys BEFORE the method
    // sees them — only `factoryB` is enumerated by `Object.entries`.
    // Repeated single-form calls are required for true accumulation.
    const factoryA = countingFactory(() => ({
      link: (_scope, element) => {
        element.classList.add('a-ran');
      },
    }));
    const factoryB = countingFactory(() => ({
      link: (_scope, element) => {
        element.classList.add('b-ran');
      },
    }));

    // The duplicate-key form: TypeScript flags a literal
    // `{ myDir: factoryA, myDir: factoryB }` as
    // "An object literal cannot have multiple properties with the same name",
    // so we build the map with two assignments — the runtime semantics
    // are identical to a literal with duplicate keys: the second
    // assignment wins.
    const map: Record<string, DirectiveFactory> = {};
    map['myDir'] = factoryA;
    map['myDir'] = factoryB;

    const injector = buildInjector(($cp) => {
      $cp.directive(map);
    });
    const $compile = injector.get<CompileService>('$compile');

    const node = document.createElement('div');
    node.setAttribute('my-dir', '');

    $compile(node)(Scope.create());

    const directives = injector.get<Directive[]>('myDirDirective');
    expect(directives).toHaveLength(1);
    expect(node.classList.contains('a-ran')).toBe(false);
    expect(node.classList.contains('b-ran')).toBe(true);
    expect(factoryA.invocations).toBe(0);
    expect(factoryB.invocations).toBe(1);
  });

  it('three or more factories accumulate cleanly under the same name', () => {
    const order: string[] = [];

    const makeFactory = (label: string): DirectiveFactory =>
      ddoFactory({
        link: (_scope, element) => {
          order.push(label);
          element.classList.add(`${label}-ran`);
        },
      });

    const injector = buildInjector(($cp) => {
      $cp.directive('myDir', makeFactory('A'));
      $cp.directive('myDir', makeFactory('B'));
      $cp.directive('myDir', makeFactory('C'));
    });
    const $compile = injector.get<CompileService>('$compile');

    const directives = injector.get<Directive[]>('myDirDirective');
    expect(directives).toHaveLength(3);
    // Indexes are strictly increasing — global registration order.
    expect(directives[0]?.index).toBeLessThan(directives[1]?.index ?? 0);
    expect(directives[1]?.index).toBeLessThan(directives[2]?.index ?? 0);

    const node = document.createElement('div');
    node.setAttribute('my-dir', '');

    $compile(node)(Scope.create());

    // All three post-link functions fire. Priority defaults to 0 for
    // every factory, so post-link order is registration-DESC: C, B, A
    // (the linker reverses the compile-order list).
    expect(order).toEqual(['C', 'B', 'A']);
    expect(node.classList.contains('A-ran')).toBe(true);
    expect(node.classList.contains('B-ran')).toBe(true);
    expect(node.classList.contains('C-ran')).toBe(true);
  });
});
