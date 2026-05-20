/**
 * AngularJS 1.x `loaderSpec.js` parity port (spec 021 Slice 3).
 *
 * Ports the `.directive` / `.controller` module-DSL registration angle of
 * `angular/angular.js/test/loaderSpec.js` onto this project's
 * `createModule(...)` + `createInjector(['ng', appModule])` infrastructure.
 * The DI bootstrap mirrors `src/compiler/__tests__/module-dsl.test.ts` and
 * `src/controller/__tests__/module-dsl.test.ts` — `bootstrapNgModule()`
 * re-registers a fresh `'ng'` with the canonical provider set (including
 * `$compileProvider` and `$controllerProvider`).
 *
 * This file is specifically the *upstream `loaderSpec.js` parity* angle —
 * the canonical "should register" cases, chaining, bulk-map forms, and the
 * invoke-queue/config-block deferral. The accumulation / last-wins / missing-
 * `'ng'` / parity-with-config-block angles are already covered by Slices 1 &
 * 2's `module-dsl.test.ts` files and are NOT duplicated here.
 *
 * Cases ported (one `it(...)` each), mapped to upstream `loaderSpec.js`:
 *
 * 1. `.directive(name, fn)` registers a directive the compiler picks up —
 *    upstream `'should record calls'` (the `$compileProvider` / `directive`
 *    invoke-queue row), exercised end-to-end through `$compile`.
 * 2. `.controller(name, fn)` registers a controller resolvable via
 *    `$controller` — upstream `'should record calls'` (the
 *    `$controllerProvider` / `register` invoke-queue row), exercised
 *    end-to-end through `$controller`.
 * 3. Chaining — `createModule(...).directive(...).controller(...).value(...)`
 *    returns the same builder; the chain produces a working injector with
 *    every registration live. Upstream `'should record calls'` asserts
 *    `myModule.<chain...>).toBe(myModule)`.
 * 4. Bulk-map forms for both `.directive({...})` and `.controller({...})` —
 *    upstream supports the object form on both.
 * 5. Registration is deferred to injector creation — `.directive(...)` /
 *    `.controller(...)` only queue a config block; nothing resolves until
 *    `createInjector`. Upstream `'should record calls'` asserts the
 *    `_invokeQueue` / `_configBlocks` arrays directly (deferral).
 *
 * Cases deliberately SKIPPED (each `it.skip(...)` with a roadmap citation)
 * so a future audit can `grep '.skip('` and enumerate exactly what is
 * deferred and which roadmap item revisits each:
 *
 * 6. `.component(name, def)` — deferred to the "Components & isolate scope"
 *    roadmap item.
 * 7. `.animation(name, fn)` — deferred to the Phase 4 "Animations" roadmap
 *    item.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { bootstrapNgModule } from '@compiler/__tests__/test-helpers';
import type { DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import { Scope } from '@core/index';
import type { ControllerInvokable } from '@controller/controller-types';
import { createInjector } from '@di/injector';
import { createModule } from '@di/module';

/** Wrap a DDO in the array-style invokable shape `$compileProvider.directive` accepts. */
function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

describe('module loader parity — .directive / .controller (spec 021 Slice 3)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  describe('canonical register cases', () => {
    it('.directive(name, fn) registers a directive the compiler picks up', () => {
      // Upstream `loaderSpec.js` `'should record calls'` queues
      // `['$compileProvider', 'directive', ['d', 'dd']]`. We exercise the
      // same registration end-to-end: the DSL forwards to
      // `$compileProvider.directive`, and `$compile` matches + links it.
      let linked = false;
      const appModule = createModule('app', ['ng']).directive(
        'loaderWidget',
        ddoFactory({
          restrict: 'E',
          link: () => {
            linked = true;
          },
        }),
      );

      const $compile = createInjector([appModule]).get('$compile');
      $compile(document.createElement('loader-widget'))(Scope.create());

      expect(linked).toBe(true);
    });

    it('.controller(name, fn) registers a controller resolvable via $controller', () => {
      // Upstream `loaderSpec.js` `'should record calls'` queues
      // `['$controllerProvider', 'register', ['ctrl', 'ccc']]`. We exercise
      // the same registration end-to-end: the DSL forwards to
      // `$controllerProvider.register`, and `$controller(name, locals)`
      // instantiates it.
      const appModule = createModule('app', ['ng']).controller('LoaderCtrl', [
        '$scope',
        ($scope: unknown) => {
          ($scope as Record<string, unknown>).registered = true;
        },
      ]);

      const $controller = createInjector([appModule]).get('$controller');
      const $scope = Scope.create();
      $controller('LoaderCtrl', { $scope });

      expect(($scope as unknown as Record<string, unknown>).registered).toBe(true);
    });
  });

  describe('chaining — the builder returns itself (upstream "should record calls")', () => {
    it('.directive / .controller / .value / .config / .run chain in any order on one builder', () => {
      // Upstream asserts `myModule.decorator(...).provider(...)...` etc.
      // `.toBe(myModule)` — every DSL method returns the builder so calls
      // chain. Here we additionally assert the chained registrations are
      // all live in the resulting injector.
      let directiveLinked = false;
      let runRan = false;

      const appModule = createModule('app', ['ng'])
        .value('appName', 'loader-parity')
        .directive(
          'chainWidget',
          ddoFactory({
            restrict: 'E',
            link: () => {
              directiveLinked = true;
            },
          }),
        )
        .controller('ChainCtrl', [
          '$scope',
          'appName',
          ($scope: unknown, appName: unknown) => {
            ($scope as Record<string, unknown>).appName = appName;
          },
        ])
        .config([
          () => {
            /* a no-op config block interleaved in the chain */
          },
        ])
        .run([
          'appName',
          (appName: unknown) => {
            runRan = appName === 'loader-parity';
          },
        ]);

      const injector = createInjector([appModule]);

      // `.value` is live.
      expect(injector.get('appName')).toBe('loader-parity');
      // `.run` block executed during `createInjector` and saw the value.
      expect(runRan).toBe(true);
      // `.directive` is live — matched + linked by `$compile`.
      injector.get('$compile')(document.createElement('chain-widget'))(Scope.create());
      expect(directiveLinked).toBe(true);
      // `.controller` is live — instantiable, and its `appName` dep resolved.
      const $scope = Scope.create();
      injector.get('$controller')('ChainCtrl', { $scope });
      expect(($scope as unknown as Record<string, unknown>).appName).toBe('loader-parity');
    });
  });

  describe('bulk-map forms — upstream supports the object form on both', () => {
    it('.directive({ ... }) registers every entry', () => {
      const linked: string[] = [];
      const appModule = createModule('app', ['ng']).directive({
        bulkA: ddoFactory({
          restrict: 'E',
          link: () => {
            linked.push('a');
          },
        }),
        bulkB: ddoFactory({
          restrict: 'E',
          link: () => {
            linked.push('b');
          },
        }),
      });

      const $compile = createInjector([appModule]).get('$compile');
      $compile(document.createElement('bulk-a'))(Scope.create());
      $compile(document.createElement('bulk-b'))(Scope.create());

      expect(linked.sort()).toEqual(['a', 'b']);
    });

    it('.controller({ ... }) registers every entry', () => {
      const appModule = createModule('app', ['ng']).controller({
        BulkHomeCtrl: [
          '$scope',
          ($scope: unknown) => {
            ($scope as Record<string, unknown>).page = 'home';
          },
        ],
        BulkAboutCtrl: [
          '$scope',
          ($scope: unknown) => {
            ($scope as Record<string, unknown>).page = 'about';
          },
        ],
      });

      const $controller = createInjector([appModule]).get('$controller');
      const homeScope = Scope.create();
      const aboutScope = Scope.create();
      $controller('BulkHomeCtrl', { $scope: homeScope });
      $controller('BulkAboutCtrl', { $scope: aboutScope });

      expect((homeScope as unknown as Record<string, unknown>).page).toBe('home');
      expect((aboutScope as unknown as Record<string, unknown>).page).toBe('about');
    });
  });

  describe('registration is deferred to injector creation (upstream invoke-queue deferral)', () => {
    it('.directive / .controller only QUEUE a config block — nothing resolves before createInjector', () => {
      // Upstream `loaderSpec.js` `'should record calls'` asserts the
      // `_invokeQueue` / `_configBlocks` arrays directly: the DSL calls
      // RECORD the registration, they do not EXECUTE it. Here the
      // observable proxy for "recorded but not executed" is that the
      // directive/controller factories have not run, the config block has
      // not run, and `$$configBlocks` carries exactly the two queued blocks
      // — until `createInjector` drains the module graph.
      let directiveFactoryRan = false;
      let controllerFactoryRan = false;

      const appModule = createModule('app', ['ng'])
        .directive('deferredWidget', [
          () => {
            directiveFactoryRan = true;
            return { restrict: 'E' };
          },
        ] as DirectiveFactory)
        .controller('DeferredCtrl', [
          () => {
            controllerFactoryRan = true;
          },
        ] as ControllerInvokable);

      // Pre-injector: each DSL call pushed exactly ONE config block (the
      // map/string branch always pushes one). Neither factory has run.
      expect(appModule.$$configBlocks).toHaveLength(2);
      expect(directiveFactoryRan).toBe(false);
      expect(controllerFactoryRan).toBe(false);

      // Draining the module graph runs the config blocks (which call
      // `$compileProvider.directive` / `$controllerProvider.register`) —
      // but the directive/controller FACTORIES are still lazy: registration
      // happened, instantiation has not.
      const injector = createInjector([appModule]);
      expect(directiveFactoryRan).toBe(false);
      expect(controllerFactoryRan).toBe(false);

      // Only on first use do the factories run — proving the registration
      // was queued, then drained, then resolved lazily.
      injector.get('$compile')(document.createElement('deferred-widget'))(Scope.create());
      injector.get('$controller')('DeferredCtrl', { $scope: Scope.create() });
      expect(directiveFactoryRan).toBe(true);
      expect(controllerFactoryRan).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Skipped — each it.skip carries a comment naming the deferring roadmap
  // item so a future audit can grep `.skip(` to enumerate what's deferred.
  // -------------------------------------------------------------------------

  describe('deferred AngularJS 1.x module-DSL methods', () => {
    it.skip('.component(name, def) — bulk component registration', () => {
      /* Deferred to the "Components & isolate scope" roadmap item. Upstream
       * `loaderSpec.js` `'should record calls'` queues
       * `['$compileProvider', 'component', ['c', 'cc']]`, but `.component`
       * depends on isolate scope, `bindToController`, and component
       * lifecycle hooks — none of which exist yet (isolate scope is still
       * rejected at directive registration via
       * `IsolateScopeNotSupportedError`). It lands in its own spec once
       * those foundations are in place; see spec 021's functional-spec §3
       * Out-of-Scope. */
    });

    it.skip('.animation(name, fn) — animation registration', () => {
      /* Deferred to the Phase 4 "Animations" roadmap item. Upstream
       * `angular.module(...).animation(name, fn)` queues
       * `['$animateProvider', 'register', ...]`, but `$animateProvider` /
       * `$animate` do not exist in this project yet — they ship in Phase 4
       * alongside `$animate`. See `context/product/architecture.md`, the
       * "Module DSL Growth & Shared Registries" table (`.animation` row). */
    });
  });
});
