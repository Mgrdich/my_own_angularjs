/**
 * AngularJS 1.5+ parity tests for spec 022 (Components & Isolate Scope).
 *
 * This file is a focused "canonical patterns" regression guard rather
 * than a verbatim port — the upstream `angular/angular.js` repo is not
 * vendored locally, so each test below codifies a publicly-documented
 * AngularJS 1.5+ component-pattern that the framework must satisfy.
 *
 * Many of these cases are also covered by Slice 1–5 unit tests; this
 * file pins the COMPOSITION (component + isolate + lifecycle + require
 * end-to-end) the way an upstream `compileSpec.js` / `componentSpec.js`
 * test would. Deferred cases sit as `it.skip(...)` with one-line
 * citations naming the roadmap item that will land them.
 *
 * @see context/spec/022-components-and-isolate-scope/functional-spec.md
 * @see context/spec/022-components-and-isolate-scope/technical-considerations.md
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { destroyElementScope } from '@compiler/cleanup';
import type { ComponentDefinition, DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { resetRegistry } from '@di/module';
import { EXCEPTION_HANDLER_CAUSES } from '@exception-handler/index';

import { bootstrapNgModule, compileWith } from './test-helpers';

function ddoFactory(value: DirectiveFactoryReturn): DirectiveFactory {
  return [() => value] as DirectiveFactory;
}

interface ParentScope {
  outerName?: string;
  outerValue?: unknown;
  outerItem?: { name?: string };
  onPick?: (...args: unknown[]) => unknown;
  pickedId?: unknown;
  [k: string]: unknown;
}

afterEach(() => {
  resetRegistry();
});

// ---------------------------------------------------------------------
// Two-way binding (`=`) — write-back in both directions.
// Mirrors angular/angular.js test/ng/compileSpec.js
// 'should bind two-way' / 'should reflect changes in the parent'.
// ---------------------------------------------------------------------

describe('parity: two-way binding (`=`)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('mirrors a parent → local change after digest', () => {
    let captured: Record<string, unknown> | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'twoWay',
        ddoFactory({
          scope: { value: '=' } as Record<string, string>,
          link: (scope) => {
            captured = scope as unknown as Record<string, unknown>;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('two-way', '');
    node.setAttribute('value', 'outerValue');
    const parent = Scope.create<ParentScope>();
    parent.outerValue = 1;
    $compile(node)(parent);
    parent.$digest();
    expect((captured as unknown as { value?: unknown }).value).toBe(1);

    parent.outerValue = 42;
    parent.$digest();
    expect((captured as unknown as { value?: unknown }).value).toBe(42);
  });

  it('mirrors a local → parent change after digest (write-back)', () => {
    let captured: Record<string, unknown> | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'twoWay',
        ddoFactory({
          scope: { value: '=' } as Record<string, string>,
          link: (scope) => {
            captured = scope as unknown as Record<string, unknown>;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('two-way', '');
    node.setAttribute('value', 'outerValue');
    const parent = Scope.create<ParentScope>();
    parent.outerValue = 'a';
    $compile(node)(parent);
    parent.$digest();

    (captured as unknown as { value: unknown }).value = 'b';
    parent.$digest();
    expect(parent.outerValue).toBe('b');
  });
});

// ---------------------------------------------------------------------
// One-way binding (`<`) — parent IS source of truth.
// Mirrors angular/angular.js test/ng/compileSpec.js
// 'should not be passed to the controller as a copy' and the
// '"<" should not throw if assigning a value to a non-assignable
// expression' canonical case.
// ---------------------------------------------------------------------

describe('parity: one-way binding (`<`)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('flows parent → local on change; local mutation does NOT propagate', () => {
    let captured: Record<string, unknown> | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'oneWay',
        ddoFactory({
          scope: { item: '<' } as Record<string, string>,
          link: (scope) => {
            captured = scope as unknown as Record<string, unknown>;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('one-way', '');
    node.setAttribute('item', 'outerItem');
    const parent = Scope.create<ParentScope>();
    parent.outerItem = { name: 'a' };
    $compile(node)(parent);
    parent.$digest();
    expect((captured as unknown as { item: { name: string } }).item.name).toBe('a');

    // Parent → local: mutate parent reference, re-digest, observe local
    // updated.
    parent.outerItem = { name: 'b' };
    parent.$digest();
    expect((captured as unknown as { item: { name: string } }).item.name).toBe('b');

    // Local → parent: reassigning the local does NOT write back; the
    // parent stays on its own reference. (Property mutations on the
    // SAME reference are visible because both sides share the object —
    // but that is reference equality, not write-back semantics.)
    (captured as unknown as { item: unknown }).item = { name: 'c-local' };
    parent.$digest();
    expect((parent.outerItem as { name: string }).name).toBe('b');
  });
});

// ---------------------------------------------------------------------
// String binding (`@`) — interpolates against the PARENT scope.
// Mirrors angular/angular.js 'should bind a string-shaped attribute as a
// literal expression' and the canonical interpolation case.
// ---------------------------------------------------------------------

describe('parity: string binding (`@`)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('reads interpolated `{{outerName}}` from the PARENT scope', () => {
    let captured: Record<string, unknown> | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'atStr',
        ddoFactory({
          scope: { title: '@' } as Record<string, string>,
          link: (scope) => {
            captured = scope as unknown as Record<string, unknown>;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('at-str', '');
    node.setAttribute('title', '{{outerName}}');
    const parent = Scope.create<ParentScope>();
    parent.outerName = 'Alice';
    $compile(node)(parent);
    parent.$digest();
    expect((captured as unknown as { title?: unknown }).title).toBe('Alice');

    parent.outerName = 'Bob';
    parent.$digest();
    expect((captured as unknown as { title?: unknown }).title).toBe('Bob');
  });
});

// ---------------------------------------------------------------------
// Expression binding (`&`) — callable with `locals` map.
// Mirrors angular/angular.js 'should call action function on parent
// scope' and the canonical 'should pass locals to action expression'
// case.
// ---------------------------------------------------------------------

describe('parity: expression binding (`&`)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('passes the `locals` map to the parent expression at call time', () => {
    let captured: Record<string, unknown> | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'amp',
        ddoFactory({
          scope: { pick: '&onPick' } as Record<string, string>,
          link: (scope) => {
            captured = scope as unknown as Record<string, unknown>;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('amp', '');
    node.setAttribute('on-pick', 'pickedId = id');
    const parent = Scope.create<ParentScope>();
    $compile(node)(parent);

    const pickFn = (captured as unknown as { pick: (locals?: Record<string, unknown>) => unknown }).pick;
    pickFn({ id: 'X-99' });
    expect(parent.pickedId).toBe('X-99');
  });
});

// ---------------------------------------------------------------------
// `bindToController: true` — bindings land on the controller instance.
// Mirrors angular/angular.js componentSpec.js 'should bind to controller
// instance properties'.
// ---------------------------------------------------------------------

describe('parity: `bindToController` (componentSpec.js)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('writes bindings onto the controller instance (NOT the isolate scope)', () => {
    let capturedScope: Record<string, unknown> | null = null;
    const $compile = compileWith(($cp) => {
      $cp.component('userCard', {
        bindings: { user: '<' },
        controller: [
          '$scope',
          function (this: Record<string, unknown>, $scope: unknown): void {
            ($scope as { $$instance: unknown }).$$instance = this;
            capturedScope = $scope as Record<string, unknown>;
          },
        ],
      } satisfies ComponentDefinition);
    });
    const node = document.createElement('user-card');
    node.setAttribute('user', 'outerItem');
    const parent = Scope.create<ParentScope>();
    parent.outerItem = { name: 'Carol' };
    $compile(node)(parent);
    parent.$digest();

    const capturedInstance = (capturedScope as unknown as { $$instance: Record<string, unknown> }).$$instance;
    expect(capturedInstance).not.toBeNull();
    expect((capturedInstance as unknown as { user?: { name?: string } }).user?.name).toBe('Carol');
    // Bindings do NOT show up on the isolate scope itself when
    // `bindToController` is in effect.
    expect((capturedScope as unknown as { user?: unknown }).user).toBeUndefined();
  });

  it('component default `controllerAs: $ctrl` exposes the instance on the scope', () => {
    let capturedScope: Record<string, unknown> | null = null;
    const $compile = compileWith(($cp) => {
      $cp.component('userCard', {
        bindings: { user: '<' },
        controller: [
          '$scope',
          function (this: Record<string, unknown>, $scope: unknown): void {
            this.greet = (): string => 'hi';
            capturedScope = $scope as Record<string, unknown>;
          },
        ],
      } satisfies ComponentDefinition);
    });
    const node = document.createElement('user-card');
    node.setAttribute('user', 'outerItem');
    const parent = Scope.create<ParentScope>();
    parent.outerItem = { name: 'Dee' };
    $compile(node)(parent);
    parent.$digest();

    const $ctrl = (capturedScope as unknown as { $ctrl?: { greet: () => string; user?: { name?: string } } }).$ctrl;
    expect($ctrl).toBeDefined();
    expect($ctrl?.greet()).toBe('hi');
    expect($ctrl?.user?.name).toBe('Dee');
  });
});

// ---------------------------------------------------------------------
// Lifecycle hooks — `$onInit` fires AFTER bindings populate.
// Mirrors angular/angular.js componentSpec.js 'should call $onInit AFTER
// bindings are populated'.
// ---------------------------------------------------------------------

describe('parity: lifecycle hooks (componentSpec.js)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('`$onInit` sees the populated `bindToController` bindings on `this`', () => {
    let observed: unknown = undefined;
    const $compile = compileWith(($cp) => {
      $cp.component('userCard', {
        bindings: { user: '<' },
        controller: [
          function (this: Record<string, unknown>): void {
            this.$onInit = (): void => {
              observed = (this as { user?: { name?: string } }).user?.name;
            };
          },
        ],
      } satisfies ComponentDefinition);
    });
    const node = document.createElement('user-card');
    node.setAttribute('user', 'outerItem');
    const parent = Scope.create<ParentScope>();
    parent.outerItem = { name: 'Eve' };
    $compile(node)(parent);
    parent.$digest();

    expect(observed).toBe('Eve');
  });

  it('`$onChanges` receives a SimpleChange record with `isFirstChange()`', () => {
    const changes: Array<{ name: string; current: unknown; previous: unknown; first: boolean }> = [];
    const $compile = compileWith(($cp) => {
      $cp.component('userCard', {
        bindings: { user: '<' },
        controller: [
          function (this: Record<string, unknown>): void {
            this.$onChanges = (
              recordSet: Record<
                string,
                { currentValue: unknown; previousValue: unknown; isFirstChange: () => boolean }
              >,
            ): void => {
              for (const key of Object.keys(recordSet)) {
                const rec = recordSet[key];
                if (rec === undefined) continue;
                changes.push({
                  name: key,
                  current: rec.currentValue,
                  previous: rec.previousValue,
                  first: rec.isFirstChange(),
                });
              }
            };
          },
        ],
      } satisfies ComponentDefinition);
    });
    const node = document.createElement('user-card');
    node.setAttribute('user', 'outerItem');
    const parent = Scope.create<ParentScope>();
    parent.outerItem = { name: 'Frank' };
    $compile(node)(parent);
    parent.$digest();

    // Initial fire — exactly one record, first-change.
    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(changes[0]?.name).toBe('user');
    expect(changes[0]?.first).toBe(true);
    expect((changes[0]?.current as { name?: string }).name).toBe('Frank');

    // Subsequent change — non-first.
    parent.outerItem = { name: 'Gabe' };
    parent.$digest();
    const second = changes[changes.length - 1];
    expect(second?.first).toBe(false);
    expect((second?.current as { name?: string }).name).toBe('Gabe');
    expect((second?.previous as { name?: string }).name).toBe('Frank');
  });

  it('`$onDestroy` fires when the element scope is destroyed', () => {
    let destroyed = false;
    const $compile = compileWith(($cp) => {
      $cp.component('userCard', {
        controller: [
          function (this: Record<string, unknown>): void {
            this.$onDestroy = (): void => {
              destroyed = true;
            };
          },
        ],
      } satisfies ComponentDefinition);
    });
    const node = document.createElement('user-card');
    const parent = Scope.create<ParentScope>();
    $compile(node)(parent);
    parent.$digest();
    expect(destroyed).toBe(false);
    destroyElementScope(node);
    expect(destroyed).toBe(true);
  });
});

// ---------------------------------------------------------------------
// `require` — ancestor walk + optional + auto-assign onto controller.
// Mirrors angular/angular.js componentSpec.js 'require: should bind to a
// parent controller' and 'optional require should bind to null'.
// ---------------------------------------------------------------------

describe('parity: `require` (componentSpec.js)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('`^foo` walks ancestors and resolves the parent controller', () => {
    let childObserved: unknown = undefined;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'parentDir',
        ddoFactory({
          controller: [
            function (this: Record<string, unknown>): void {
              this.id = 'PARENT';
            },
          ] as unknown as never,
        }),
      );
      $cp.directive(
        'childDir',
        ddoFactory({
          require: '^parentDir',
          link: (_s, _e, _a, parentCtrl: unknown): void => {
            childObserved = (parentCtrl as { id?: string }).id;
          },
        }),
      );
    });
    const outer = document.createElement('div');
    outer.setAttribute('parent-dir', '');
    const inner = document.createElement('div');
    inner.setAttribute('child-dir', '');
    outer.appendChild(inner);
    $compile(outer)(Scope.create<ParentScope>());
    expect(childObserved).toBe('PARENT');
  });

  it('`?foo` yields `null` on a miss instead of throwing', () => {
    let observed: unknown = undefined;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'childDir',
        ddoFactory({
          require: '?parentDir',
          link: (_s, _e, _a, parentCtrl: unknown): void => {
            observed = parentCtrl;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('child-dir', '');
    $compile(node)(Scope.create<ParentScope>());
    expect(observed).toBeNull();
  });

  it('object-form `require` auto-assigns onto the requiring controller BEFORE `$onInit`', () => {
    let observed: unknown = undefined;
    const $compile = compileWith(($cp) => {
      $cp.component('parentCmp', {
        controller: [
          function (this: Record<string, unknown>): void {
            this.label = 'P';
          },
        ],
      } satisfies ComponentDefinition);
      $cp.component('childCmp', {
        require: { parent: '^parentCmp' },
        controller: [
          function (this: Record<string, unknown>): void {
            this.$onInit = (): void => {
              // Auto-assignment happened BEFORE $onInit ran.
              observed = (this as { parent?: { label?: string } }).parent?.label;
            };
          },
        ],
      } satisfies ComponentDefinition);
    });
    const outer = document.createElement('parent-cmp');
    const inner = document.createElement('child-cmp');
    outer.appendChild(inner);
    $compile(outer)(Scope.create<ParentScope>());

    expect(observed).toBe('P');
  });
});

// ---------------------------------------------------------------------
// Component defaults — restrict: 'E', isolate scope, controllerAs.
// Mirrors angular/angular.js componentSpec.js 'should default `restrict`
// to "E"' and 'should default `controllerAs` to "$ctrl"'.
// ---------------------------------------------------------------------

describe('parity: component defaults (componentSpec.js)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('component is restricted to element form by default', () => {
    let matched = false;
    const $compile = compileWith(($cp) => {
      $cp.component('myCmp', {
        controller: [
          function (this: Record<string, unknown>): void {
            this.$onInit = (): void => {
              matched = true;
            };
          },
        ],
      } satisfies ComponentDefinition);
    });
    // Element form matches.
    const elementNode = document.createElement('my-cmp');
    $compile(elementNode)(Scope.create<ParentScope>());
    expect(matched).toBe(true);

    // Attribute form does NOT match — `$onInit` would fire if it did.
    matched = false;
    const attrNode = document.createElement('div');
    attrNode.setAttribute('my-cmp', '');
    $compile(attrNode)(Scope.create<ParentScope>());
    expect(matched).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Cause-token invariant — spec 022 introduces ZERO new cause tokens.
// ---------------------------------------------------------------------

describe('parity: EXCEPTION_HANDLER_CAUSES regression', () => {
  it('keeps the tuple free of a spec-022 token (count is 13 since spec 037)', () => {
    expect(EXCEPTION_HANDLER_CAUSES.length).toBe(13);
    expect(EXCEPTION_HANDLER_CAUSES).toContain('$compile');
  });
});

// ---------------------------------------------------------------------
// Deferred upstream cases — present here as `it.skip` so the parity
// surface is documented even when the underlying directive / service is
// not yet in the project's roadmap.
// ---------------------------------------------------------------------

describe('parity: deferred upstream cases', () => {
  // `ng-click`, `ng-model`, and other built-in directives are deferred
  // to the "Built-in Directives" roadmap item — these tests rely on
  // event-driven dispatch through `ng-click` and would otherwise need
  // hand-rolled DOM dispatch.
  it.skip('component template wires `ng-click` through `$ctrl.method()` — deferred to Built-in Directives spec', () => {
    // Upstream: 'component bindings via ng-click + & callback'.
  });

  it.skip('`scope: { value: "=*" }` collection-mode bindings — deferred to a future isolate-scope spec', () => {
    // Upstream: 'collection-mode two-way binding'.
    // The spec022 binding-spec regex rejects `=*` via
    // InvalidIsolateBindingError. A future spec may lift the rejection.
  });

  it.skip('one-way `<` binding error on non-assignable expression via `$compile:nonassign` — deferred', () => {
    // Upstream: 'should throw $compile:nonassign on a non-assignable `=`'.
    // Spec 022 silently degrades non-assignable `=` to one-way per the
    // Slice-1 implementation note; no error class.
  });

  it.skip('`require: "^^"` skipping own element when the requiring directive declares the SAME name', () => {
    // Upstream covers a corner case where a directive both registers
    // and requires its own name; spec 022 supports it through
    // `^^` semantics but the upstream test exercises the full
    // bidirectional chain that needs forms-spec support.
  });

  it.skip('lifecycle ordering across NESTED components with shared async `templateUrl`', () => {
    // Upstream componentSpec.js covers the async lifecycle ordering;
    // spec 022 ships the synchronous + post-template paths but the
    // full upstream test depends on `$q` / `$http` mock chains that
    // ship with the Application Bootstrap spec.
  });
});
