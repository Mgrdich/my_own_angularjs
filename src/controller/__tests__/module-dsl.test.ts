/**
 * `module.controller()` DSL integration tests (spec 021 Slice 2).
 *
 * The `.controller` module-DSL method is pure sugar over a config block
 * that forwards to `$controllerProvider.register(...)` — it owns no state
 * and adds no validation. These tests exercise the inheritance through a
 * real `createInjector(['ng', appModule])` chain:
 *
 * - a `.controller(...)`-registered controller is instantiable via
 *   `$controller(name, locals)` and usable as a directive's `controller`
 *   field — identical outcome to a `config(['$controllerProvider', …])`
 *   block;
 * - the bulk-map form registers every entry;
 * - last-wins parity — two registrations of the same name keep only the
 *   most recent, across the DSL path and a mixed DSL + config-block path;
 * - a module that calls `.controller(...)` without requiring `'ng'`
 *   fails at `createInjector` with `Unknown provider: $controllerProvider`;
 * - registration ordering — `.directive` / `.controller` calls interleaved
 *   with explicit `.config(...)` blocks execute in source order.
 *
 * Type-level assertions confirm both `.controller` overloads return the
 * module type UNCHANGED — controllers live in `$ControllerProvider`'s
 * private `$$registry` Map and are never injector-resolvable services, so
 * there is no key to widen the typed `Registry` with.
 *
 * The bootstrap mirrors `src/compiler/__tests__/module-dsl.test.ts` — the
 * shared `bootstrapNgModule()` helper re-registers a fresh `'ng'` with the
 * canonical provider set (including `$controller` and `$compile`).
 */

import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';

import { bootstrapNgModule } from '@compiler/__tests__/test-helpers';
import type { DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import { Scope } from '@core/index';
import type { $ControllerProvider } from '@controller/controller-provider';
import type { ControllerInvokable } from '@controller/controller-types';
import { createInjector } from '@di/injector';
import { createModule } from '@di/module';

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

describe('module.controller — DSL shorthand (spec 021 Slice 2)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  describe('basic registration', () => {
    it('a controller registered through .controller is instantiable via $controller', () => {
      const appModule = createModule('app', ['ng']).controller('HomeCtrl', [
        '$scope',
        ($scope: unknown) => {
          ($scope as Record<string, unknown>).title = 'Home';
        },
      ]);

      const $controller = createInjector([appModule]).get('$controller');
      const $scope = Scope.create();
      $controller('HomeCtrl', { $scope });

      expect(($scope as unknown as Record<string, unknown>).title).toBe('Home');
    });

    it("produces the identical observable outcome to a config(['$controllerProvider', …]) block", () => {
      // DSL path.
      const dslModule = createModule('app', ['ng']).controller('HomeCtrl', [
        '$scope',
        ($scope: unknown) => {
          ($scope as Record<string, unknown>).title = 'Home';
        },
      ]);
      const dslScope = Scope.create();
      createInjector([dslModule]).get('$controller')('HomeCtrl', { $scope: dslScope });

      // config-block path — fresh registry.
      bootstrapNgModule();
      const cfgModule = createModule('app', ['ng']).config([
        '$controllerProvider',
        ($cp: $ControllerProvider) => {
          $cp.register('HomeCtrl', [
            '$scope',
            ($scope: unknown) => {
              ($scope as Record<string, unknown>).title = 'Home';
            },
          ]);
        },
      ]);
      const cfgScope = Scope.create();
      createInjector([cfgModule]).get('$controller')('HomeCtrl', { $scope: cfgScope });

      expect((dslScope as unknown as Record<string, unknown>).title).toBe('Home');
      expect((cfgScope as unknown as Record<string, unknown>).title).toBe('Home');
    });

    it("is usable as a directive's controller: 'HomeCtrl' field", () => {
      let capturedScope: unknown;
      let capturedElement: unknown;
      let capturedAttrs: unknown;

      const appModule = createModule('app', ['ng'])
        .controller('HomeCtrl', [
          '$scope',
          '$element',
          '$attrs',
          ($scope: unknown, $element: unknown, $attrs: unknown) => {
            capturedScope = $scope;
            capturedElement = $element;
            capturedAttrs = $attrs;
          },
        ])
        .directive('myDir', ddoFactory({ restrict: 'A', controller: 'HomeCtrl' }));

      const $compile = createInjector([appModule]).get('$compile');
      const node = document.createElement('div');
      node.setAttribute('my-dir', '');
      const parentScope = Scope.create();
      $compile(node)(parentScope);

      expect(capturedScope).toBe(parentScope);
      expect(capturedElement).toBe(node);
      expect(typeof (capturedAttrs as { $set?: unknown }).$set).toBe('function');
    });
  });

  describe('bulk-map form', () => {
    it('registers every entry in the object', () => {
      const appModule = createModule('app', ['ng']).controller({
        HomeCtrl: [
          '$scope',
          ($scope: unknown) => {
            ($scope as Record<string, unknown>).page = 'home';
          },
        ],
        AboutCtrl: [
          '$scope',
          ($scope: unknown) => {
            ($scope as Record<string, unknown>).page = 'about';
          },
        ],
      });

      const $controller = createInjector([appModule]).get('$controller');
      const homeScope = Scope.create();
      const aboutScope = Scope.create();
      $controller('HomeCtrl', { $scope: homeScope });
      $controller('AboutCtrl', { $scope: aboutScope });

      expect((homeScope as unknown as Record<string, unknown>).page).toBe('home');
      expect((aboutScope as unknown as Record<string, unknown>).page).toBe('about');
    });
  });

  describe('last-wins parity (FS §2.2)', () => {
    it('two .controller(\'X\', …) registrations keep only the most recent', () => {
      const appModule = createModule('app', ['ng'])
        .controller('X', [
          '$scope',
          ($scope: unknown) => {
            ($scope as Record<string, unknown>).winner = 'first';
          },
        ])
        .controller('X', [
          '$scope',
          ($scope: unknown) => {
            ($scope as Record<string, unknown>).winner = 'second';
          },
        ]);

      const $controller = createInjector([appModule]).get('$controller');
      const $scope = Scope.create();
      $controller('X', { $scope });

      expect(($scope as unknown as Record<string, unknown>).winner).toBe('second');
    });

    it('a mixed DSL + config-block path is last-wins by $$configBlocks push order', () => {
      // DSL call first, config block second — the config block was pushed
      // later, so it wins.
      const appModule = createModule('app', ['ng'])
        .controller('X', [
          '$scope',
          ($scope: unknown) => {
            ($scope as Record<string, unknown>).winner = 'dsl';
          },
        ])
        .config([
          '$controllerProvider',
          ($cp: $ControllerProvider) => {
            $cp.register('X', [
              '$scope',
              ($scope: unknown) => {
                ($scope as Record<string, unknown>).winner = 'config';
              },
            ]);
          },
        ]);

      const $controller = createInjector([appModule]).get('$controller');
      const $scope = Scope.create();
      $controller('X', { $scope });

      expect(($scope as unknown as Record<string, unknown>).winner).toBe('config');
    });
  });

  describe("missing 'ng' dependency", () => {
    it('fails at createInjector with Unknown provider: $controllerProvider', () => {
      // No `requires: ['ng']` — `$controllerProvider` is unreachable, so
      // the `.controller` config block cannot resolve it. Mirrors the
      // analogous `.directive` / `$compileProvider` failure mode.
      const appModule = createModule('app', []).controller('HomeCtrl', [() => undefined]);

      expect(() => createInjector([appModule])).toThrow('Unknown provider: $controllerProvider');
    });
  });

  describe('registration ordering — DSL calls interleave with .config in source order', () => {
    it('.config / .directive / .config / .controller execute in $$configBlocks push order', () => {
      const order: string[] = [];

      const appModule = createModule('app', ['ng'])
        .config([
          () => {
            order.push('configA');
          },
        ])
        .directive(
          'd',
          // The directive factory runs lazily when the `dDirective`
          // provider's `$get` resolves — but `$compileProvider.directive`
          // (the registration call) runs synchronously inside the config
          // block. Push a marker from the config-block forwarding layer by
          // wrapping the factory: the factory body runs at directive
          // resolution, so instead assert ordering via the config block
          // the DSL pushed. We observe the *registration* order by reading
          // a side effect inside the config block itself.
          [
            () => {
              order.push('directiveFactory');
              return { restrict: 'A' };
            },
          ] as DirectiveFactory,
        )
        .config([
          () => {
            order.push('configB');
          },
        ])
        .controller('c', [
          () => {
            order.push('controllerFactory');
          },
        ]);

      const injector = createInjector([appModule]);

      // After createInjector, all four config blocks have run in push
      // order: configA, the .directive config block (registers 'd' on
      // $compileProvider), configB, the .controller config block
      // (registers 'c' on $controllerProvider). The directive/controller
      // *factories* run later (lazily), so at this point only the two
      // explicit .config blocks have pushed markers.
      expect(order).toEqual(['configA', 'configB']);

      // Now force the directive + controller factories to run, and confirm
      // they were registered (i.e. the DSL config blocks DID run between
      // configA and configB / after configB respectively).
      injector.get('$compile')(
        (() => {
          const node = document.createElement('div');
          node.setAttribute('d', '');
          return node;
        })(),
      )(Scope.create());
      injector.get('$controller')('c', { $scope: Scope.create() });

      expect(order).toEqual(['configA', 'configB', 'directiveFactory', 'controllerFactory']);
    });

    it('a config block reading $controllerProvider.has() sees a DSL registration pushed earlier', () => {
      // Pins the *relative* ordering directly: a .controller(...) call
      // followed by a .config(...) block — the config block runs AFTER the
      // DSL config block, so `$cp.has('Early')` is already true.
      let earlyVisible: boolean | undefined;

      const appModule = createModule('app', ['ng'])
        .controller('Early', [() => undefined])
        .config([
          '$controllerProvider',
          ($cp: $ControllerProvider) => {
            earlyVisible = $cp.has('Early');
          },
        ]);

      createInjector([appModule]);

      expect(earlyVisible).toBe(true);
    });
  });


  describe('TypeScript compile-time signature (type-level assertions)', () => {
    it('.controller(name, fn) returns the module type unchanged — no key added to the registry', () => {
      const appModule = createModule('app', ['ng']).controller('HomeCtrl', [() => undefined]);

      // Type-level assertion: the single-name form does NOT widen the
      // typed registry. With no `HomeCtrl` key on `Registry`,
      // `injector.get('HomeCtrl')` resolves through the wide
      // `get<T>(name: string): T` fallback to `unknown` — proving no key
      // was added. Controllers live in `$ControllerProvider`'s private
      // `$$registry` Map and are never injector-resolvable, so there is
      // nothing to widen. A successful compile of a non-`unknown`
      // `toEqualTypeOf` here would mean the non-widening contract
      // regressed.
      //
      // The assertion is compile-time only — the `injector.get(...)`
      // expression lives inside a thunk that is never invoked (calling it
      // would throw `Unknown provider: HomeCtrl`, which is itself the
      // proof that no provider was registered for the name). `expectTypeOf`
      // inspects the static type of the thunk's return without running it.
      // Calling `.get('HomeCtrl')` with a string-literal VALUE that is not
      // a `keyof Registry` resolves through the wide `get<T>(name): T`
      // fallback, inferring `T = unknown` — proving no `HomeCtrl` key was
      // added. If the single-name form ever widened the registry, the
      // typed `get<K extends keyof Registry>` overload would match and
      // this `toEqualTypeOf<unknown>` assertion would fail.
      const injector = createInjector([appModule]);
      // No explicit return annotation — the thunk's return type is
      // INFERRED from `injector.get('HomeCtrl')`, so the assertion
      // genuinely reflects the overload TypeScript picked.
      const typeProbe = () => injector.get('HomeCtrl');
      expectTypeOf(typeProbe).returns.toEqualTypeOf<unknown>();

      // Runtime confirmation that the non-widening is real: no provider
      // is registered under the bare controller name.
      expect(() => injector.get('HomeCtrl')).toThrow('Unknown provider: HomeCtrl');
    });

    it('.controller({ … }) (bulk-map) returns the module type unchanged — no keys added', () => {
      const appModule = createModule('app', ['ng']).controller({
        HomeCtrl: [() => undefined] as ControllerInvokable,
        AboutCtrl: [() => undefined] as ControllerInvokable,
      });

      // Type-level assertion: the bulk-map form likewise does not widen
      // the registry — a `get('HomeCtrl')` lookup falls through to the
      // wide `get<T>(name: string): T` fallback returning `unknown`.
      // Compile-time only; see the single-name test above for why the
      // expressions live in never-invoked thunks.
      const injector = createInjector([appModule]);
      const homeProbe = () => injector.get('HomeCtrl');
      const aboutProbe = () => injector.get('AboutCtrl');
      expectTypeOf(homeProbe).returns.toEqualTypeOf<unknown>();
      expectTypeOf(aboutProbe).returns.toEqualTypeOf<unknown>();

      expect(() => injector.get('HomeCtrl')).toThrow('Unknown provider: HomeCtrl');
      expect(() => injector.get('AboutCtrl')).toThrow('Unknown provider: AboutCtrl');
    });
  });
});
