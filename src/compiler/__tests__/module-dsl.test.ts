/**
 * `module.directive()` DSL integration tests (spec 021 Slice 1).
 *
 * The `.directive` module-DSL method is pure sugar over a config block
 * that forwards to `$compileProvider.directive(...)` — it owns no state
 * and adds no validation. These tests exercise the inheritance through
 * a real `createInjector(['ng', appModule])` + `$compile` chain on
 * jsdom elements:
 *
 * - a `.directive(...)`-registered directive matches and links exactly
 *   as a `config(['$compileProvider', …])`-registered one does;
 * - the bulk-map form registers every entry;
 * - accumulation parity — two registrations of the same name BOTH run,
 *   across the DSL path and a mixed DSL + config-block path;
 * - a module that calls `.directive(...)` without requiring `'ng'`
 *   fails at `createInjector` with `Unknown provider: $compileProvider`.
 *
 * The bootstrap mirrors `src/filter/__tests__/module-dsl.test.ts` — the
 * shared `bootstrapNgModule()` helper re-registers a fresh `'ng'`.
 */

import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { Directive, DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { createInjector } from '@di/injector';
import { createModule } from '@di/module';

import { bootstrapNgModule } from './test-helpers';

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

describe('module.directive — DSL shorthand (spec 021 Slice 1)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  describe('basic registration', () => {
    it('a directive registered through .directive is matched and linked by $compile', () => {
      let linked = false;
      const appModule = createModule('app', ['ng']).directive(
        'myWidget',
        ddoFactory({
          restrict: 'E',
          link: () => {
            linked = true;
          },
        }),
      );

      const $compile = createInjector([appModule]).get('$compile');
      const node = document.createElement('my-widget');
      $compile(node)(Scope.create());

      expect(linked).toBe(true);
    });

    it("produces the identical observable outcome to a config(['$compileProvider', …]) block", () => {
      const order: string[] = [];

      // DSL path.
      const dslModule = createModule('app', ['ng']).directive(
        'myWidget',
        ddoFactory({
          restrict: 'E',
          link: () => {
            order.push('dsl');
          },
        }),
      );
      const dslCompile = createInjector([dslModule]).get('$compile');
      dslCompile(document.createElement('my-widget'))(Scope.create());

      // config-block path — fresh registry.
      bootstrapNgModule();
      const cfgModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive(
            'myWidget',
            ddoFactory({
              restrict: 'E',
              link: () => {
                order.push('config');
              },
            }),
          );
        },
      ]);
      const cfgCompile = createInjector([cfgModule]).get('$compile');
      cfgCompile(document.createElement('my-widget'))(Scope.create());

      expect(order).toEqual(['dsl', 'config']);
    });
  });

  describe('bulk-map form', () => {
    it('registers every entry in the object', () => {
      const linked: string[] = [];
      const appModule = createModule('app', ['ng']).directive({
        widgetA: ddoFactory({
          restrict: 'E',
          link: () => {
            linked.push('a');
          },
        }),
        widgetB: ddoFactory({
          restrict: 'A',
          link: () => {
            linked.push('b');
          },
        }),
      });

      const $compile = createInjector([appModule]).get('$compile');

      $compile(document.createElement('widget-a'))(Scope.create());
      const bNode = document.createElement('div');
      bNode.setAttribute('widget-b', '');
      $compile(bNode)(Scope.create());

      expect(linked).toEqual(['a', 'b']);
    });
  });

  describe('accumulation parity (FS §2.1)', () => {
    it("two .directive('foo', …) registrations BOTH run on a matching element", () => {
      const order: string[] = [];
      const appModule = createModule('app', ['ng'])
        .directive(
          'foo',
          ddoFactory({
            link: () => {
              order.push('first');
            },
          }),
        )
        .directive(
          'foo',
          ddoFactory({
            link: () => {
              order.push('second');
            },
          }),
        );

      const $compile = createInjector([appModule]).get('$compile');
      const node = document.createElement('div');
      node.setAttribute('foo', '');
      $compile(node)(Scope.create());

      // Both factories run — directives accumulate per name (an
      // existing `$compileProvider.directive` invariant the DSL
      // inherits). The relative post-link order between two
      // equal-priority directives is decided by the global directive
      // index, not the DSL — accumulation parity only requires that
      // BOTH ran.
      expect(order.slice().sort()).toEqual(['first', 'second']);
      expect(order).toHaveLength(2);
    });

    it('a mixed DSL + config-block path accumulates identically', () => {
      const order: string[] = [];
      const appModule = createModule('app', ['ng'])
        .directive(
          'foo',
          ddoFactory({
            link: () => {
              order.push('dsl');
            },
          }),
        )
        .config([
          '$compileProvider',
          ($cp: $CompileProvider) => {
            $cp.directive(
              'foo',
              ddoFactory({
                link: () => {
                  order.push('config');
                },
              }),
            );
          },
        ]);

      const $compile = createInjector([appModule]).get('$compile');
      const node = document.createElement('div');
      node.setAttribute('foo', '');
      $compile(node)(Scope.create());

      // Both factories run — directives accumulate per name regardless
      // of which path registered them (the DSL forwards into the same
      // `$$factoryMap` the config-block path mutates). The DSL config
      // block was pushed first, so its directive resolves first.
      expect(order.sort()).toEqual(['config', 'dsl']);
      expect(order).toHaveLength(2);
    });
  });

  describe("missing 'ng' dependency", () => {
    it('fails at createInjector with Unknown provider: $compileProvider', () => {
      // No `requires: ['ng']` — `$compileProvider` is unreachable, so
      // the `.directive` config block cannot resolve it. Mirrors the
      // analogous `.filter` / `$filterProvider` failure mode.
      const appModule = createModule('app', []).directive('myWidget', ddoFactory({ restrict: 'E' }));

      expect(() => createInjector([appModule])).toThrow('Unknown provider: $compileProvider');
    });
  });

  describe('TypeScript compile-time signature (type-level assertions)', () => {
    it('.directive(name, factory) widens the registry with a ${K}Directive key', () => {
      const appModule = createModule('app', ['ng']).directive('myWidget', ddoFactory({ restrict: 'E' }));

      // Type-level assertion: the single-name form widens the typed
      // registry so a `myWidgetDirective` key exists with value
      // `Directive[]`. `injector.get` resolves through the typed
      // `get<K extends keyof Registry>` overload here — if the widening
      // regressed, `injector.get('myWidgetDirective')` would fall
      // through to the wide `get<T>(name: string): T` fallback and
      // resolve to `unknown`, failing this `toEqualTypeOf` assertion.
      const injector = createInjector([appModule]);
      expectTypeOf(injector.get('myWidgetDirective')).toEqualTypeOf<Directive[]>();
      expect(Array.isArray(injector.get('myWidgetDirective'))).toBe(true);
    });

    it('.directive({ … }) (bulk-map) returns the module type unchanged — no ${K}Directive key', () => {
      const appModule = createModule('app', ['ng']).directive({
        widgetA: ddoFactory({ restrict: 'E' }),
      });

      // Type-level assertion: the bulk-map form does NOT widen the
      // registry. With no `widgetADirective` key on `Registry`,
      // `injector.get('widgetADirective')` resolves through the wide
      // `get<T>(name: string): T` fallback to `unknown` — proving the
      // key was deliberately not added. A successful compile of a
      // `toEqualTypeOf<Directive[]>()` assertion here would mean the
      // non-widening contract regressed.
      const injector = createInjector([appModule]);
      expectTypeOf(injector.get('widgetADirective')).toEqualTypeOf<unknown>();
      expect(Array.isArray(injector.get('widgetADirective'))).toBe(true);
    });
  });
});
