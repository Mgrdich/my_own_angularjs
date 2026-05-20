/**
 * Integration tests for `$compileProvider.component` (spec 022
 * Slice 5 — FS §2.5 + technical-considerations §2.5).
 *
 * A component is, internally, a directive registration. The provider
 * translates the {@link ComponentDefinition} into a directive factory
 * returning a DDO with the AngularJS 1.5+ canonical defaults:
 *
 *  - `restrict: 'E'`
 *  - `scope: definition.bindings ?? {}` — always object-form (isolate
 *    scope), empty when no bindings declared
 *  - `bindToController: true`
 *  - `controller: definition.controller ?? function NoopController() {}`
 *  - `controllerAs: definition.controllerAs ?? '$ctrl'`
 *  - Pass-through: `template`, `templateUrl`, `transclude`, `require`
 *
 * Validation lives in two layers: `.component` itself rejects
 * malformed `name` / `definition` synchronously via
 * {@link InvalidComponentDefinitionError}; downstream directive
 * normalization runs lazily at `<name>Directive` provider `$get` time
 * and routes via `$exceptionHandler('$compile')` through the existing
 * factory `try/catch`. `EXCEPTION_HANDLER_CAUSES` stays at 10.
 *
 * **Controller spelling.** Tests use the canonical array-style
 * annotation with a trailing function expression that stashes the
 * controller-instance pointer onto `$scope.$$instance` (a private
 * slot) so test bodies can read it back without aliasing `this` at
 * the test layer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InvalidComponentDefinitionError } from '@compiler/compile-error';
import type { ComponentDefinition } from '@compiler/directive-types';
import { ngTranscludeDirective } from '@compiler/ng-transclude';
import type { ControllerInvokable } from '@controller/controller-types';
import { Scope } from '@core/index';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { EXCEPTION_HANDLER_CAUSES } from '@exception-handler/index';
import type { TemplateCacheService, TemplateFetcher } from '@template/template-types';

import { bootstrapNgModule, compileWith } from './test-helpers';

interface ParentScope {
  user?: { id?: string; name?: string };
  outerName?: string;
  pickValue?: unknown;
  onSelectSpy?: (...args: unknown[]) => unknown;
  [k: string]: unknown;
}

/**
 * Build an array-style controller annotation that stashes the
 * controller-instance pointer (`this`) onto `scope.$$instance`. Avoids
 * the `no-this-alias` lint at the test layer; the trailing function's
 * `this` IS the prototype-instance the compiler constructed via
 * `Object.create(prototype) + invoke`.
 */
function captureCtrl(setup?: (instance: Record<string, unknown>) => void): ControllerInvokable {
  return [
    '$scope',
    function (this: Record<string, unknown>, $scope: unknown): void {
      ($scope as { $$instance: unknown }).$$instance = this;
      if (setup !== undefined) {
        setup(this);
      }
    },
  ] as ControllerInvokable;
}

afterEach(() => {
  resetRegistry();
});

describe('$compileProvider.component — defaults (FS §2.5)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('applies `restrict: "E"` (element form) by default', () => {
    let linked = false;
    const $compile = compileWith(($cp) => {
      $cp.component('myComp', {
        template: '<span>hi</span>',
        controller: captureCtrl((inst) => {
          inst.$onInit = (): void => {
            linked = true;
          };
        }),
      });
    });
    const node = document.createElement('my-comp');
    $compile(node)(Scope.create<ParentScope>());

    expect(linked).toBe(true);
    expect(node.firstElementChild?.tagName).toBe('SPAN');
    expect(node.firstElementChild?.textContent).toBe('hi');
  });

  it('creates an isolate scope (does NOT inherit from parent)', () => {
    let capturedScope: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.component('myComp', {
        template: '<span>x</span>',
        controller: [
          '$scope',
          function (this: unknown, $scope: unknown): void {
            capturedScope = $scope as Scope;
          },
        ] as ControllerInvokable,
      });
    });
    const node = document.createElement('my-comp');
    const parent = Scope.create<ParentScope>();
    parent.outerName = 'visible-on-parent';
    $compile(node)(parent);

    expect(capturedScope).not.toBeNull();
    // Isolate scope — parent's name is NOT visible.
    expect((capturedScope as unknown as { outerName?: unknown }).outerName).toBeUndefined();
  });

  it('uses `controllerAs: "$ctrl"` by default', () => {
    let capturedScope: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.component('myComp', {
        controller: captureCtrl((inst) => {
          inst.flag = 'present';
        }),
        template: '<span>x</span>',
      });
    });
    const node = document.createElement('my-comp');
    $compile(node)(Scope.create<ParentScope>());

    // The post-link captured scope is the isolate scope itself; the
    // `$ctrl` alias is published on it (bindToController: true sets
    // the alias AFTER bindings populate).
    capturedScope = (node as unknown as { $$ngScope?: Scope }).$$ngScope ?? null;
    expect(capturedScope).not.toBeNull();
    const ctrl = (capturedScope as unknown as { $ctrl?: { flag?: unknown } }).$ctrl;
    expect(ctrl?.flag).toBe('present');
  });

  it('uses a noop controller by default when none is declared', () => {
    const $compile = compileWith(($cp) => {
      $cp.component('myComp', { template: '<span>x</span>' });
    });
    const node = document.createElement('my-comp');
    // Should not throw — the default controller is a real callable
    // function (`function NoopController() {}`).
    expect(() => $compile(node)(Scope.create<ParentScope>())).not.toThrow();

    const scope = (node as unknown as { $$ngScope?: Scope }).$$ngScope;
    expect(scope).toBeDefined();
    const ctrl = (scope as unknown as { $ctrl?: unknown }).$ctrl;
    // The noop controller is published on the isolate scope as `$ctrl`.
    expect(ctrl).toBeDefined();
    expect(typeof ctrl).toBe('object');
  });

  it('uses `bindings ?? {}` — empty bindings still creates an isolate scope', () => {
    let capturedScope: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.component('myComp', {
        controller: [
          '$scope',
          function (this: unknown, $scope: unknown): void {
            capturedScope = $scope as Scope;
          },
        ] as ControllerInvokable,
        template: '<span>x</span>',
      });
    });
    const node = document.createElement('my-comp');
    const parent = Scope.create<ParentScope>();
    parent.outerName = 'parent-name';
    $compile(node)(parent);

    expect(capturedScope).not.toBeNull();
    // No bindings declared → no inheritance from parent.
    expect((capturedScope as unknown as { outerName?: unknown }).outerName).toBeUndefined();
  });
});

describe('$compileProvider.component — bindings flow onto the controller instance', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('@ binding seeds the raw attribute string onto the instance synchronously', () => {
    const $compile = compileWith(($cp) => {
      $cp.component('myComp', {
        bindings: { title: '@' },
        controller: captureCtrl(),
        template: '<span>{{ $ctrl.title }}</span>',
      });
    });
    const node = document.createElement('my-comp');
    node.setAttribute('title', 'Hello');
    const parent = Scope.create<ParentScope>();
    $compile(node)(parent);

    const scope = (node as unknown as { $$ngScope?: Scope }).$$ngScope;
    const ctrl = (scope as unknown as { $ctrl?: { title?: unknown } }).$ctrl;
    expect(ctrl?.title).toBe('Hello');
  });

  it('< binding (one-way) populates after the first digest', () => {
    const $compile = compileWith(($cp) => {
      $cp.component('myComp', {
        bindings: { user: '<' },
        controller: captureCtrl(),
        template: '<span>{{ $ctrl.user.name }}</span>',
      });
    });
    const node = document.createElement('my-comp');
    node.setAttribute('user', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = { id: 'u1', name: 'Alice' };
    $compile(node)(parent);
    parent.$digest();

    const scope = (node as unknown as { $$ngScope?: Scope }).$$ngScope;
    const ctrl = (scope as unknown as { $ctrl?: { user?: { name?: unknown } } }).$ctrl;
    expect(ctrl?.user?.name).toBe('Alice');

    // < is one-way — writing to local does NOT propagate back.
    (ctrl as Record<string, unknown>).user = { id: 'mutated' };
    parent.$digest();
    expect(parent.pickValue).toEqual({ id: 'u1', name: 'Alice' });
  });

  it('= binding (two-way) keeps parent and instance in sync', () => {
    const $compile = compileWith(($cp) => {
      $cp.component('myComp', {
        bindings: { value: '=' },
        controller: captureCtrl(),
        template: '<span>{{ $ctrl.value }}</span>',
      });
    });
    const node = document.createElement('my-comp');
    node.setAttribute('value', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = 'initial';
    $compile(node)(parent);
    parent.$digest();

    const scope = (node as unknown as { $$ngScope?: Scope }).$$ngScope;
    const ctrl = (scope as unknown as { $ctrl?: Record<string, unknown> }).$ctrl;
    expect(ctrl?.value).toBe('initial');

    // Parent → local.
    parent.pickValue = 'updated';
    parent.$digest();
    expect(ctrl?.value).toBe('updated');

    // Local → parent.
    (ctrl as Record<string, unknown>).value = 'reverse';
    parent.$digest();
    expect(parent.pickValue).toBe('reverse');
  });

  it('& binding (callback) is callable from the instance and evaluates against the parent', () => {
    const spy = vi.fn();
    const $compile = compileWith(($cp) => {
      $cp.component('myComp', {
        bindings: { onSelect: '&' },
        controller: captureCtrl(),
        template: '<span>x</span>',
      });
    });
    const node = document.createElement('my-comp');
    node.setAttribute('on-select', 'onSelectSpy(id)');
    const parent = Scope.create<ParentScope>();
    parent.onSelectSpy = spy;
    $compile(node)(parent);

    const scope = (node as unknown as { $$ngScope?: Scope }).$$ngScope;
    const ctrl = (scope as unknown as { $ctrl?: { onSelect?: (locals?: Record<string, unknown>) => unknown } }).$ctrl;
    expect(typeof ctrl?.onSelect).toBe('function');

    ctrl?.onSelect?.({ id: 'u42' });
    expect(spy).toHaveBeenCalledWith('u42');
  });
});

describe('$compileProvider.component — `controllerAs` (FS §2.5)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('honors an explicit `controllerAs`', () => {
    const $compile = compileWith(($cp) => {
      $cp.component('myComp', {
        controllerAs: 'vm',
        controller: captureCtrl((inst) => {
          inst.x = 'on-vm';
        }),
        template: '<span>{{ vm.x }}</span>',
      });
    });
    const node = document.createElement('my-comp');
    $compile(node)(Scope.create<ParentScope>());

    const scope = (node as unknown as { $$ngScope?: Scope }).$$ngScope;
    const vm = (scope as unknown as { vm?: { x?: unknown }; $ctrl?: unknown }).vm;
    expect(vm?.x).toBe('on-vm');
    // The default `$ctrl` alias is NOT published when `controllerAs`
    // is explicitly overridden.
    expect((scope as unknown as { $ctrl?: unknown }).$ctrl).toBeUndefined();
  });
});

describe('$compileProvider.component — `require` (FS §2.5)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('honors string-form `require` (own element)', () => {
    let received: unknown = '<not-set>';
    const $compile = compileWith(($cp) => {
      $cp.directive('parent', [
        () => ({
          controller: [
            function (this: Record<string, unknown>): void {
              this.tag = 'parent-ctrl';
            },
          ] as ControllerInvokable,
        }),
      ]);
      $cp.component('myComp', {
        require: 'parent',
        controller: [
          '$scope',
          function (this: Record<string, unknown>, $scope: unknown): void {
            ($scope as { $$instance: unknown }).$$instance = this;
          },
        ] as ControllerInvokable,
        template: '<span>x</span>',
      });
    });

    const node = document.createElement('my-comp');
    node.setAttribute('parent', '');
    const parent = Scope.create<ParentScope>();
    $compile(node)(parent);

    const scope = (node as unknown as { $$ngScope?: Scope }).$$ngScope;
    // The `require` resolver passes the resolved controller as the
    // 4th link arg AND assigns it onto the requiring component's
    // controller instance. Because `require: 'parent'` is the string
    // form (no auto-assignment, AngularJS-canonical), we just verify
    // the parent controller resolved without an error.
    received = (scope as unknown as { $$instance?: unknown }).$$instance;
    expect(received).toBeDefined();
  });

  it('honors object-form `require` with auto-assignment onto the controller', () => {
    // Parent on the ANCESTOR element so its controller is stashed
    // BEFORE the component's controller seam resolves require. This
    // is the canonical AngularJS pattern — components typically
    // require ancestor controllers via `^parent`, not sibling-on-
    // same-element controllers (which would compete for instantiation
    // ordering with the component's own controller).
    const $compile = compileWith(($cp) => {
      $cp.directive('parent', [
        () => ({
          controller: [
            function (this: Record<string, unknown>): void {
              this.tag = 'parent-ctrl';
            },
          ] as ControllerInvokable,
        }),
      ]);
      $cp.component('myComp', {
        require: { parent: '^parent' },
        controller: captureCtrl((inst) => {
          inst.$onInit = function (this: Record<string, unknown>): void {
            // Object-form auto-assignment populates `this.parent`
            // BEFORE `$onInit` runs (Slice 4 contract).
            inst.observedTag = (this.parent as { tag?: unknown }).tag;
          };
        }),
        template: '<span>x</span>',
      });
    });

    const root = document.createElement('div');
    root.setAttribute('parent', '');
    const node = document.createElement('my-comp');
    root.appendChild(node);
    $compile(root)(Scope.create<ParentScope>());

    const scope = (node as unknown as { $$ngScope?: Scope }).$$ngScope;
    const inst = (scope as unknown as { $$instance?: Record<string, unknown> }).$$instance;
    expect(inst?.observedTag).toBe('parent-ctrl');
  });
});

describe('$compileProvider.component — `transclude`', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('projects content via `<ng-transclude>` inside the component template', () => {
    // `ngTransclude` is registered by the canonical `ngModule` in
    // `src/core/ng-module.ts`. The test-helper `bootstrapNgModule()`
    // does NOT register it (it's a deliberately minimal `ng` for the
    // compiler test suite), so we register it manually in the app
    // module's config block.
    const $compile = compileWith(($cp) => {
      $cp.directive('ngTransclude', ngTranscludeDirective);
      $cp.component('myComp', {
        transclude: true,
        template: '<div class="wrap"><ng-transclude></ng-transclude></div>',
      });
    });

    const node = document.createElement('my-comp');
    const span = document.createElement('span');
    span.textContent = 'projected';
    node.appendChild(span);
    $compile(node)(Scope.create<ParentScope>());

    // The wrapper div was installed; inside it, `<ng-transclude>` was
    // replaced by the original captured child.
    const wrap = node.querySelector('.wrap');
    expect(wrap).not.toBeNull();
    expect(wrap?.querySelector('span')?.textContent).toBe('projected');
  });
});

describe('$compileProvider.component — `templateUrl` (async)', () => {
  /** Flushes microtasks to allow the deferred template chain to settle. */
  async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  beforeEach(() => {
    const fetcher: TemplateFetcher = (url: string): Promise<string> => {
      if (url === '/tpl/card.html') {
        return Promise.resolve('<div class="card">tpl-content</div>');
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    };
    bootstrapNgModule({ fetcher });
  });

  it('installs the fetched template once the request resolves', async () => {
    const $compile = compileWith(($cp) => {
      $cp.component('myComp', {
        templateUrl: '/tpl/card.html',
        controller: captureCtrl(),
      });
    });
    const node = document.createElement('my-comp');
    $compile(node)(Scope.create<ParentScope>());

    // Sync linker — host is empty immediately.
    expect(node.firstChild).toBeNull();

    await flush();

    expect(node.firstElementChild?.classList.contains('card')).toBe(true);
    expect(node.firstElementChild?.textContent).toBe('tpl-content');
  });

  it('honors templateUrl with a pre-seeded cache entry', async () => {
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp) => {
        $cp.component('myComp', { templateUrl: '/cached.html' });
      },
    ]);
    const injector = createInjector([appModule]);
    const cache = injector.get<TemplateCacheService>('$templateCache');
    cache.put('/cached.html', '<p>cached-tpl</p>');
    const $compile = injector.get('$compile');

    const node = document.createElement('my-comp');
    $compile(node)(Scope.create<ParentScope>());
    await flush();
    expect(node.firstElementChild?.tagName).toBe('P');
    expect(node.firstElementChild?.textContent).toBe('cached-tpl');
  });
});

describe('$compileProvider.component — lifecycle hooks (FS §2.3 regression)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('fires `$onInit` AFTER bindings populate on the controller instance', () => {
    let onInitUser: unknown = '<not-fired>';
    const $compile = compileWith(($cp) => {
      $cp.component('myComp', {
        bindings: { user: '<' },
        controller: captureCtrl((inst) => {
          inst.$onInit = function (this: Record<string, unknown>): void {
            onInitUser = this.user;
          };
        }),
        template: '<span>x</span>',
      });
    });
    const node = document.createElement('my-comp');
    node.setAttribute('user', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = { id: 'u1', name: 'Alice' };
    $compile(node)(parent);
    parent.$digest();

    // `<` bindings populate on the first digest tick; `$onInit` runs
    // BEFORE the pre-link, but the binding-watcher initial fire is
    // synchronous via the binding seam — so `$onInit` sees the user.
    // (See Slice 3 contract.)
    expect(onInitUser).toEqual({ id: 'u1', name: 'Alice' });
  });
});

describe('$compileProvider.component — chaining + multiple components', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('returns the provider for chaining', () => {
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp) => {
        const a = $cp.component('a', {});
        const b = a.component('b', {});
        expect(a).toBe($cp);
        expect(b).toBe($cp);
      },
    ]);
    expect(() => createInjector([appModule])).not.toThrow();
  });

  it('two components on the same parent template link with independent isolate scopes', () => {
    const $compile = compileWith(($cp) => {
      $cp.component('compA', {
        bindings: { x: '@' },
        controller: captureCtrl(),
        template: '<span>A:{{ $ctrl.x }}</span>',
      });
      $cp.component('compB', {
        bindings: { y: '@' },
        controller: captureCtrl(),
        template: '<span>B:{{ $ctrl.y }}</span>',
      });
    });

    const wrap = document.createElement('div');
    const a = document.createElement('comp-a');
    a.setAttribute('x', 'one');
    const b = document.createElement('comp-b');
    b.setAttribute('y', 'two');
    wrap.appendChild(a);
    wrap.appendChild(b);
    $compile(wrap)(Scope.create<ParentScope>());

    const aScope = (a as unknown as { $$ngScope?: Scope }).$$ngScope;
    const bScope = (b as unknown as { $$ngScope?: Scope }).$$ngScope;
    expect(aScope).toBeDefined();
    expect(bScope).toBeDefined();
    expect(aScope).not.toBe(bScope);
    expect((aScope as unknown as { $ctrl?: Record<string, unknown> }).$ctrl?.x).toBe('one');
    expect((bScope as unknown as { $ctrl?: Record<string, unknown> }).$ctrl?.y).toBe('two');
    // Cross-contamination check.
    expect((aScope as unknown as { $ctrl?: Record<string, unknown> }).$ctrl?.y).toBeUndefined();
    expect((bScope as unknown as { $ctrl?: Record<string, unknown> }).$ctrl?.x).toBeUndefined();
  });
});

describe('$compileProvider.component — InvalidComponentDefinitionError', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('throws synchronously for a hyphenated (non-camelCase) name', () => {
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp) => {
        expect(() => $cp.component('my-comp', {})).toThrow(InvalidComponentDefinitionError);
        expect(() => $cp.component('my-comp', {})).toThrow('name must be a non-empty camelCase identifier');
      },
    ]);
    expect(() => createInjector([appModule])).not.toThrow();
  });

  it('throws synchronously for an empty name', () => {
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp) => {
        expect(() => $cp.component('', {})).toThrow(InvalidComponentDefinitionError);
      },
    ]);
    expect(() => createInjector([appModule])).not.toThrow();
  });

  it('throws synchronously for a non-string name (runtime defensive check)', () => {
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp) => {
        // Cast through `unknown` to simulate a JS caller passing a
        // non-string. The runtime guard catches it; the typed signature
        // would reject this at compile time.
        expect(() => $cp.component(42 as unknown as string, {})).toThrow(InvalidComponentDefinitionError);
      },
    ]);
    expect(() => createInjector([appModule])).not.toThrow();
  });

  it('throws synchronously when `definition` is null', () => {
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp) => {
        expect(() => $cp.component('myComp', null as unknown as ComponentDefinition)).toThrow(
          InvalidComponentDefinitionError,
        );
        expect(() => $cp.component('myComp', null as unknown as ComponentDefinition)).toThrow(
          'definition must be a plain object',
        );
      },
    ]);
    expect(() => createInjector([appModule])).not.toThrow();
  });

  it('throws synchronously when `definition` is undefined', () => {
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp) => {
        expect(() => $cp.component('myComp', undefined as unknown as ComponentDefinition)).toThrow(
          InvalidComponentDefinitionError,
        );
      },
    ]);
    expect(() => createInjector([appModule])).not.toThrow();
  });

  it('throws synchronously when `definition` is an array', () => {
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp) => {
        expect(() => $cp.component('myComp', [] as unknown as ComponentDefinition)).toThrow(
          InvalidComponentDefinitionError,
        );
      },
    ]);
    expect(() => createInjector([appModule])).not.toThrow();
  });

  it('throws synchronously when `definition` is a primitive (string)', () => {
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp) => {
        expect(() => $cp.component('myComp', 'oops' as unknown as ComponentDefinition)).toThrow(
          InvalidComponentDefinitionError,
        );
      },
    ]);
    expect(() => createInjector([appModule])).not.toThrow();
  });

  it('error message names the offending component', () => {
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp) => {
        try {
          $cp.component('1bad', {});
          throw new Error('expected throw');
        } catch (err) {
          if (err instanceof InvalidComponentDefinitionError) {
            expect(err.message).toBe(
              'Invalid component definition for "1bad": name must be a non-empty camelCase identifier',
            );
          } else {
            throw err;
          }
        }
      },
    ]);
    expect(() => createInjector([appModule])).not.toThrow();
  });
});

describe('$compileProvider.component — accumulation with .directive(name, ...)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('a `.directive(name, …)` registration on the same name ADDS a second directive that ALSO runs', () => {
    const order: string[] = [];
    const $compile = compileWith(($cp) => {
      $cp.component('myComp', {
        template: '<span>x</span>',
        controller: captureCtrl((inst) => {
          inst.$onInit = (): void => {
            order.push('component');
          };
        }),
      });
      $cp.directive('myComp', [
        () => ({
          restrict: 'E',
          link: () => {
            order.push('directive');
          },
        }),
      ]);
    });
    const node = document.createElement('my-comp');
    $compile(node)(Scope.create<ParentScope>());

    // Both ran on the same element — directives accumulate per name,
    // even when the first registration came in via `.component`.
    expect(order.slice().sort()).toEqual(['component', 'directive']);
    expect(order).toHaveLength(2);
  });
});

describe('$compileProvider.component — worked end-to-end example (userCard, FS §1)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('canonical userCard component — bindings + controller installed + onSelect fires with locals', () => {
    // Text-node `{{ }}` interpolation is not yet shipped (a future
    // built-in directives spec). The functional-spec §1 example uses
    // it, but for this end-to-end test we substitute an
    // interpolation-free template and verify the canonical pieces:
    // bindings flow onto `$ctrl`, the `<div class="card">` is
    // installed, and `pick()` (manually invoked) evaluates the `&`
    // parent expression with the supplied locals.
    const onSelectSpy = vi.fn();

    const $compile = compileWith(($cp) => {
      $cp.component('userCard', {
        bindings: { user: '<', onSelect: '&' },
        controller: captureCtrl((inst) => {
          inst.$onInit = function (this: Record<string, unknown>): void {
            // `this.user` is populated before $onInit (bindToController
            // path); we just verify the binding made it through.
            inst.observedAtInit = this.user;
          };
          inst.pick = function (this: Record<string, unknown>): unknown {
            const onSelect = this.onSelect as ((locals?: Record<string, unknown>) => unknown) | undefined;
            return onSelect?.({ id: (this.user as { id?: unknown } | undefined)?.id });
          };
        }),
        template: '<div class="card"></div>',
      });
    });

    const node = document.createElement('user-card');
    node.setAttribute('user', 'user');
    node.setAttribute('on-select', 'onSelectSpy(id)');
    const parent = Scope.create<ParentScope>();
    parent.user = { id: 'u42', name: 'Alice' };
    parent.onSelectSpy = onSelectSpy;
    $compile(node)(parent);
    parent.$digest();

    // The template DOM was installed.
    const card = node.querySelector('.card');
    expect(card).not.toBeNull();

    // Read the controller instance and invoke pick() manually
    // (ng-click is not yet shipped — pick() is a plain method we
    // wired on `this`).
    const scope = (node as unknown as { $$ngScope?: Scope }).$$ngScope;
    const ctrl = (scope as unknown as { $ctrl?: Record<string, unknown> }).$ctrl;
    expect((ctrl as Record<string, unknown>).observedAtInit).toEqual({ id: 'u42', name: 'Alice' });

    (ctrl?.pick as () => unknown)();
    expect(onSelectSpy).toHaveBeenCalledWith('u42');
  });
});

describe('EXCEPTION_HANDLER_CAUSES regression', () => {
  it('tuple stays at 10 entries (no new cause for spec 022 Slice 5)', () => {
    expect(EXCEPTION_HANDLER_CAUSES.length).toBe(10);
  });
});
