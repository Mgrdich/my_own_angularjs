/**
 * Integration tests for `module.component(...)` (spec 022 Slice 5 —
 * FS §2.6).
 *
 * The `.component` module-DSL method is pure config-block sugar that
 * forwards verbatim to `$compileProvider.component(name, definition)`
 * — the DSL owns no state and adds no validation. These tests
 * exercise the forwarding contract through a real
 * `createInjector(['ng', appModule])` + `$compile` chain on jsdom
 * elements:
 *
 *  - A `.component(...)`-registered component matches and links
 *    exactly as a `config(['$compileProvider', $cp => $cp.component(...)])`
 *    registration does.
 *  - `.component(...)` pushes exactly ONE config block onto
 *    `$$configBlocks` per call.
 *  - `.component(...)` returns the module instance for chaining.
 *  - A module calling `.component(...)` without requiring `'ng'`
 *    fails at `createInjector` with `Unknown provider: $compileProvider`.
 *  - No bulk-map form is supported — both the type system rejects
 *    object-as-name and the runtime falls through to the provider's
 *    name validation, which throws `InvalidComponentDefinitionError`.
 *
 * The bootstrap mirrors `src/compiler/__tests__/module-dsl.test.ts` —
 * the shared `bootstrapNgModule()` helper re-registers a fresh `'ng'`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bootstrapNgModule } from '@compiler/__tests__/test-helpers';
import { InvalidComponentDefinitionError } from '@compiler/compile-error';
import type { $CompileProvider } from '@compiler/compile-provider';
import type { ComponentDefinition, DirectiveFactory } from '@compiler/directive-types';
import type { ControllerInvokable } from '@controller/controller-types';
import { Scope } from '@core/index';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';

afterEach(() => {
  resetRegistry();
});

describe('module.component — DSL shorthand (spec 022 Slice 5)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  describe('basic registration', () => {
    it('a component registered through .component is matched and linked by $compile', () => {
      let linked = false;
      const appModule = createModule('app', ['ng']).component('myWidget', {
        template: '<span>hi</span>',
        controller: [
          function (this: Record<string, unknown>): void {
            this.flag = 'present';
            linked = true;
          },
        ] as unknown as ComponentDefinition['controller'],
      });

      const $compile = createInjector([appModule]).get('$compile');
      const node = document.createElement('my-widget');
      $compile(node)(Scope.create());

      expect(linked).toBe(true);
      expect(node.firstElementChild?.tagName).toBe('SPAN');
      expect(node.firstElementChild?.textContent).toBe('hi');
    });

    it("produces the identical observable outcome to a config(['$compileProvider', …]) block", () => {
      const order: string[] = [];

      // DSL path.
      const dslModule = createModule('app', ['ng']).component('myWidget', {
        template: '<span>x</span>',
        controller: [
          function (this: Record<string, unknown>): void {
            this.$onInit = (): void => {
              order.push('dsl');
            };
          },
        ] as unknown as ComponentDefinition['controller'],
      });
      const dslCompile = createInjector([dslModule]).get('$compile');
      dslCompile(document.createElement('my-widget'))(Scope.create());

      // config-block path — fresh registry.
      bootstrapNgModule();
      const cfgModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.component('myWidget', {
            template: '<span>x</span>',
            controller: [
              function (this: Record<string, unknown>): void {
                this.$onInit = (): void => {
                  order.push('config');
                };
              },
            ] as unknown as ComponentDefinition['controller'],
          });
        },
      ]);
      const cfgCompile = createInjector([cfgModule]).get('$compile');
      cfgCompile(document.createElement('my-widget'))(Scope.create());

      expect(order).toEqual(['dsl', 'config']);
    });
  });

  describe('config-block accounting', () => {
    it('pushes exactly ONE config block onto $$configBlocks per .component(...) call', () => {
      const appModule = createModule('app', ['ng']).component('a', {});
      expect(appModule.$$configBlocks.length).toBe(1);
    });

    it('a chain of two .component() calls pushes TWO config blocks', () => {
      const appModule = createModule('app', ['ng']).component('a', {}).component('b', {});
      expect(appModule.$$configBlocks.length).toBe(2);
    });

    it('the pushed block is an array-style invokable depending on $compileProvider', () => {
      const appModule = createModule('app', ['ng']).component('myWidget', {});
      const block = appModule.$$configBlocks[0];
      // The block is the canonical array-style annotation
      // `['$compileProvider', fn]` — head string + trailing function.
      expect(Array.isArray(block)).toBe(true);
      const arr = block as readonly unknown[];
      expect(arr[0]).toBe('$compileProvider');
      expect(typeof arr[arr.length - 1]).toBe('function');
    });
  });

  describe('chainability', () => {
    it('.component(...) returns the same module for further chaining', () => {
      const appModule = createModule('app', ['ng']);
      const returned = appModule.component('a', {});
      expect(returned).toBe(appModule);
    });

    it('.component(...) chains with .config(...) and .run(...)', () => {
      let configRan = false;
      let runRan = false;
      const appModule = createModule('app', ['ng'])
        .component('myWidget', {})
        .config([
          () => {
            configRan = true;
          },
        ])
        .run([
          () => {
            runRan = true;
          },
        ]);

      createInjector([appModule]);
      expect(configRan).toBe(true);
      expect(runRan).toBe(true);
    });

    it('.component(...) chains freely with .directive(...) and .controller(...)', () => {
      const ctrlFn: ControllerInvokable = [
        function (this: Record<string, unknown>): void {
          void this;
        },
      ] as ControllerInvokable;
      const dirFactory: DirectiveFactory = [() => ({ restrict: 'E' })] as DirectiveFactory;
      const appModule = createModule('app', ['ng'])
        .component('compA', {})
        .directive('dirB', dirFactory)
        .controller('CtrlC', ctrlFn);

      // All three calls should be in the queues; the module is still
      // a `Module` instance with the same `name` it was created with.
      expect(appModule.name).toBe('app');
      expect(appModule.$$configBlocks.length).toBe(3);
    });
  });

  describe('parity with $compileProvider.component', () => {
    it('a component registered via the DSL applies the same defaults (restrict:E, isolate, $ctrl)', () => {
      const appModule = createModule('app', ['ng']).component('myWidget', {
        bindings: { value: '@' },
        controller: [
          '$scope',
          function (this: Record<string, unknown>, $scope: unknown): void {
            ($scope as { $$instance: unknown }).$$instance = this;
          },
        ] as unknown as ComponentDefinition['controller'],
        template: '<span></span>',
      });
      const $compile = createInjector([appModule]).get('$compile');
      const node = document.createElement('my-widget');
      node.setAttribute('value', 'hello');
      const parent = Scope.create();
      $compile(node)(parent);
      parent.$digest();

      // controllerAs defaults to $ctrl; isolate scope created; binding
      // populated on the instance (bindToController true). Text-node
      // `{{ }}` interpolation is not yet shipped — verify the binding
      // landed on `$ctrl.value`, and that the template `<span>` was
      // installed as the host's child.
      const scope = (node as unknown as { $$ngScope?: Scope }).$$ngScope;
      const ctrl = (scope as unknown as { $ctrl?: Record<string, unknown> }).$ctrl;
      expect(ctrl?.value).toBe('hello');
      expect(node.firstElementChild?.tagName).toBe('SPAN');
    });
  });

  describe("missing 'ng' dependency", () => {
    it('fails at createInjector with Unknown provider: $compileProvider', () => {
      // No `requires: ['ng']` — `$compileProvider` is unreachable, so
      // the `.component` config block cannot resolve it. Mirrors the
      // analogous `.directive` / `.filter` failure mode.
      const appModule = createModule('app', []).component('myWidget', {});
      expect(() => createInjector([appModule])).toThrow('Unknown provider: $compileProvider');
    });
  });

  describe('no bulk-map form', () => {
    it('passing an object as the name is not supported — runtime rejects via the provider', () => {
      // The typed signature constrains `name` to `string`; this is the
      // runtime defense for callers reaching through `unknown`. The
      // `.component` DSL forwards to `$cp.component(name, definition)`,
      // which runs the camelCase-name validation — an object name
      // fails the `typeof name !== 'string'` guard.
      const appModule = createModule('app', ['ng']).component(
        { foo: {}, bar: {} } as unknown as string,
        // The DSL is registry-pushing only; the failure is deferred
        // until config-block execution at `createInjector`.
        {} as ComponentDefinition,
      );
      expect(() => createInjector([appModule])).toThrow(InvalidComponentDefinitionError);
    });

    it('TypeScript type rejection — `.component({ … })` (bulk-map) is a compile error', () => {
      // @ts-expect-error — `.component` accepts (name: string, definition: ComponentDefinition); a bulk map is NOT supported, matching AngularJS 1.x where `.component` only ever had the single-name form.
      void createModule('app2', ['ng']).component({ a: {}, b: {} });
      // No runtime assertion — the value of this test is the
      // `@ts-expect-error` line above. If `.component`'s typed
      // signature regressed to accept the bulk-map form, the
      // compile-time check would fail and `pnpm typecheck` would
      // report this line.
      expect(true).toBe(true);
    });
  });

  describe('TypeScript compile-time signature (non-widening)', () => {
    it('.component(name, definition) does NOT widen the registry', () => {
      const appModule = createModule('app', ['ng']).component('myWidget', {});

      // Type-level expectation: no `myWidgetDirective` key on the
      // typed `Registry` — `.component` is non-widening (matches
      // `.controller`; contrast with single-name `.directive`).
      // `injector.get('myWidgetDirective')` resolves through the
      // wide `get<T>(name: string): T` fallback to `unknown`.
      const injector = createInjector([appModule]);
      // The provider DOES exist at runtime (component routes through
      // `directive`, which registers a `<name>Directive` provider);
      // the typed `Registry` is just deliberately not widened.
      expect(Array.isArray(injector.get('myWidgetDirective'))).toBe(true);
    });
  });
});
