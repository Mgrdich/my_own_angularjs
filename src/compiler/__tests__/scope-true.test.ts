/**
 * `scope: true` child-scope wiring + element cleanup registry
 * (Slice 10 of spec 017 / FS §2.12 + technical-considerations §2.8).
 *
 * Two coordinated mechanisms under test:
 *   1. The compiler creates ONE child scope per element when any
 *      matched directive declares `scope: true`. The same child scope
 *      is shared across ALL directives on the element and the
 *      element's child linker. Descendants inherit the child scope
 *      unless they themselves request `scope: true` (in which case
 *      another nested child is created).
 *   2. The cleanup registry — `setElementScope`, `getElementScope`,
 *      `addElementCleanup`, `destroyElementScope` — releases the
 *      child scope and runs registered cleanup callbacks when the
 *      element is torn down. `destroyElementScope` recurses
 *      depth-first, runs cleanup queues in insertion order even on
 *      throw, and is idempotent on a second call.
 *
 * Test setup mirrors `compile.test.ts` — an `ng` module is registered
 * fresh per test via `bootstrapNgModule()`, then a one-off `app`
 * module configures `$compileProvider` with the directives the test
 * exercises.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addElementCleanup, destroyElementScope, getElementScope, setElementScope } from '@compiler/cleanup';
import type { DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import { Scope } from '@core/index';

import { bootstrapNgModule, compileWith } from './test-helpers';

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

describe('scope: true — child-scope creation (FS §2.12)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('creates ONE child scope per element when any directive declares scope: true', () => {
    let captured: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: true,
          link: (scope) => {
            captured = scope;
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    const parentScope = Scope.create();

    $compile(node)(parentScope);

    expect(captured).not.toBeNull();
    expect(captured).not.toBe(parentScope);
    // `parent.$new()` uses `Object.create(parent)` (FS §2.12 — child
    // scope inherits prototypically). Asserting the prototype chain
    // is the structural proof that we used `$new()` rather than
    // constructing a sibling.
    expect(Object.getPrototypeOf(captured)).toBe(parentScope);
  });

  it('shares ONE child scope across multiple directives requesting scope: true on the same element', () => {
    let aScope: Scope | null = null;
    let bScope: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'dirA',
        ddoFactory({
          scope: true,
          link: (scope) => {
            aScope = scope;
          },
        }),
      );
      $cp.directive(
        'dirB',
        ddoFactory({
          scope: true,
          link: (scope) => {
            bScope = scope;
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('dir-a', '');
    node.setAttribute('dir-b', '');
    const parentScope = Scope.create();

    $compile(node)(parentScope);

    expect(aScope).not.toBeNull();
    expect(bScope).not.toBeNull();
    // Same reference, single `$new()` call (FS §2.12 — "Compiler
    // creates ONE child scope per element (not per directive)").
    expect(aScope).toBe(bScope);
    expect(aScope).not.toBe(parentScope);
  });

  it('mixed siblings — scope: true wins over scope: false on the same element', () => {
    let aScope: Scope | null = null;
    let bScope: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'dirA',
        ddoFactory({
          scope: true,
          link: (scope) => {
            aScope = scope;
          },
        }),
      );
      $cp.directive(
        'dirB',
        ddoFactory({
          scope: false,
          link: (scope) => {
            bScope = scope;
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('dir-a', '');
    node.setAttribute('dir-b', '');
    const parentScope = Scope.create();

    $compile(node)(parentScope);

    // Both directives receive the SAME child scope — the `scope: true`
    // request wins per FS §2.12 "exactly one child scope is created;
    // both directives receive it".
    expect(aScope).toBe(bScope);
    expect(aScope).not.toBe(parentScope);
  });

  it("descendants with scope: false share the parent element's child scope", () => {
    let parentLinkScope: Scope | null = null;
    let childLinkScope: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'parentDir',
        ddoFactory({
          scope: true,
          link: (scope) => {
            parentLinkScope = scope;
          },
        }),
      );
      $cp.directive(
        'childDir',
        ddoFactory({
          // scope: false (default) — no new child scope created here
          link: (scope) => {
            childLinkScope = scope;
          },
        }),
      );
    });

    const parent = document.createElement('div');
    parent.setAttribute('parent-dir', '');
    const child = document.createElement('span');
    child.setAttribute('child-dir', '');
    parent.appendChild(child);
    const rootScope = Scope.create();

    $compile(parent)(rootScope);

    expect(parentLinkScope).not.toBeNull();
    expect(childLinkScope).not.toBeNull();
    // Descendant inherits the child scope (no second `$new()`).
    expect(childLinkScope).toBe(parentLinkScope);
  });

  it("descendants with scope: true create a nested child scope off the parent's child scope", () => {
    let parentLinkScope: Scope | null = null;
    let childLinkScope: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'parentDir',
        ddoFactory({
          scope: true,
          link: (scope) => {
            parentLinkScope = scope;
          },
        }),
      );
      $cp.directive(
        'childDir',
        ddoFactory({
          scope: true,
          link: (scope) => {
            childLinkScope = scope;
          },
        }),
      );
    });

    const parent = document.createElement('div');
    parent.setAttribute('parent-dir', '');
    const child = document.createElement('span');
    child.setAttribute('child-dir', '');
    parent.appendChild(child);
    const rootScope = Scope.create();

    $compile(parent)(rootScope);

    expect(parentLinkScope).not.toBeNull();
    expect(childLinkScope).not.toBeNull();
    // Distinct scopes — child got its own `$new()`.
    expect(childLinkScope).not.toBe(parentLinkScope);
    // Nested correctly — child inherits prototypically from parent.
    expect(Object.getPrototypeOf(childLinkScope)).toBe(parentLinkScope);
  });

  it('child scope inherits prototypically — parent properties are visible', () => {
    let captured: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: true,
          link: (scope) => {
            captured = scope;
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    const parentScope = Scope.create<{ foo?: string }>();
    parentScope.foo = 'bar';

    $compile(node)(parentScope);

    expect(captured).not.toBeNull();
    // Prototypal inheritance — `foo` is read off `parentScope`
    // through the prototype chain (no own-property on child).
    expect((captured as unknown as { foo?: string }).foo).toBe('bar');
  });

  it('mutations on the child scope do NOT leak to the parent', () => {
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: true,
          link: (scope) => {
            (scope as unknown as { foo?: string }).foo = 'baz';
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    const parentScope = Scope.create<{ foo?: string }>();

    $compile(node)(parentScope);

    // The child's assignment created an OWN property on the child
    // scope; the parent never saw it.
    expect(parentScope.foo).toBeUndefined();
  });

  it('rejects isolate scope { ... } lazily and routes through $exceptionHandler with cause $compile', () => {
    // Slice 11 wraps the factory invocation in try/catch routing
    // through $exceptionHandler('$compile'). $compile(node)(scope) no
    // longer throws — the bad directive is silently dropped from the
    // matched-directive array and the error surfaces via the handler.
    // The Slice 12 README documents this as the AngularJS-canonical
    // "log and continue" contract for compile-time errors.
    const handlerSpy = vi.fn<(...args: unknown[]) => void>();
    bootstrapNgModule({ exceptionHandler: handlerSpy });
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'isolateDir',
        ddoFactory({
          scope: { foo: '=' } as unknown as Record<string, string>,
          link: () => {
            /* noop */
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('isolate-dir', '');

    // No throw — the lookup returns an empty directive array (the bad
    // factory was skipped) and the linker runs against zero directives
    // for this node.
    expect(() => $compile(node)(Scope.create())).not.toThrow();

    // The handler saw the IsolateScopeNotSupportedError with the
    // spec-canonical cause and the directive name in the message.
    expect(handlerSpy).toHaveBeenCalled();
    const [err, cause] = handlerSpy.mock.calls[0] ?? [];
    expect(cause).toBe('$compile');
    expect((err as Error).message).toMatch(/Isolate scope is not yet supported/);
    expect((err as Error).message).toContain('isolateDir');
  });
});

describe('cleanup registry — setElementScope / getElementScope / addElementCleanup / destroyElementScope', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('setElementScope + getElementScope round-trip stores and retrieves the scope reference', () => {
    const node = document.createElement('div');
    const scope = Scope.create();

    expect(getElementScope(node)).toBeUndefined();
    setElementScope(node, scope);
    expect(getElementScope(node)).toBe(scope);
  });

  it('the $$ngScope property is non-enumerable (does not appear in for..in)', () => {
    const node = document.createElement('div');
    const scope = Scope.create();
    setElementScope(node, scope);

    const keys: string[] = [];
    for (const k in node) {
      keys.push(k);
    }
    // The `$$ngScope` key must NOT appear in own-property enumeration
    // (it's defined with `enumerable: false` so dev-tools and
    // `for..in` traversal stay clean).
    expect(keys).not.toContain('$$ngScope');
  });

  it('destroyElementScope calls $destroy on the stored child scope', () => {
    let captured: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: true,
          link: (scope) => {
            captured = scope;
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    $compile(node)(Scope.create());

    expect(captured).not.toBeNull();
    // Spy via `$on('$destroy', …)` — `$destroy()` broadcasts a
    // `'$destroy'` event before clearing watchers/listeners (see
    // `src/core/scope.ts` `$destroy`). If the event fires, the
    // teardown ran.
    const destroyListener = vi.fn();
    (captured as unknown as Scope).$on('$destroy', destroyListener);

    destroyElementScope(node);
    expect(destroyListener).toHaveBeenCalledTimes(1);
  });

  it('destroyElementScope recurses into descendants depth-first (children destroyed before parents)', () => {
    const order: string[] = [];
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'parentDir',
        ddoFactory({
          scope: true,
          link: (scope) => {
            scope.$on('$destroy', () => order.push('parent'));
          },
        }),
      );
      $cp.directive(
        'childDir',
        ddoFactory({
          scope: true,
          link: (scope) => {
            scope.$on('$destroy', () => order.push('child'));
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

    destroyElementScope(parent);
    // Depth-first — child fires before parent.
    expect(order).toEqual(['child', 'parent']);
  });

  it('addElementCleanup callbacks run in INSERTION order BEFORE the child scope $destroy', () => {
    const order: string[] = [];
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: true,
          link: (scope) => {
            scope.$on('$destroy', () => order.push('scope-destroy'));
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    $compile(node)(Scope.create());

    addElementCleanup(node, () => order.push('cleanup-1'));
    addElementCleanup(node, () => order.push('cleanup-2'));

    destroyElementScope(node);
    // Cleanup queue runs in insertion order, then $destroy fires.
    expect(order).toEqual(['cleanup-1', 'cleanup-2', 'scope-destroy']);
  });

  it('cleanup-queue errors do NOT abort other entries — all three callbacks run, first error rethrows', () => {
    const node = document.createElement('div');
    const ran: string[] = [];
    const boom = new Error('cleanup boom');

    addElementCleanup(node, () => ran.push('a'));
    addElementCleanup(node, () => {
      ran.push('b');
      throw boom;
    });
    addElementCleanup(node, () => ran.push('c'));

    expect(() => {
      destroyElementScope(node);
    }).toThrow(boom);
    // All three ran — the throw did NOT short-circuit subsequent
    // entries (FS / tech §2.8 — "errors are caught per entry; the
    // first one is re-thrown after the queue completes").
    expect(ran).toEqual(['a', 'b', 'c']);
  });

  it('destroyElementScope is idempotent — a second call is a no-op', () => {
    let captured: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: true,
          link: (scope) => {
            captured = scope;
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    $compile(node)(Scope.create());

    expect(captured).not.toBeNull();
    const destroySpy = vi.spyOn(captured as unknown as Scope, '$destroy');

    destroyElementScope(node);
    expect(destroySpy).toHaveBeenCalledTimes(1);

    // Second call — registries were cleared during the first call so
    // `$destroy` should NOT fire again, and no error is thrown.
    expect(() => {
      destroyElementScope(node);
    }).not.toThrow();
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('destroyElementScope on an element with no $$ngScope and no cleanup queue is a silent no-op', () => {
    const node = document.createElement('div');
    // No `setElementScope`, no `addElementCleanup` — both registries
    // are empty. Must not throw.
    expect(() => {
      destroyElementScope(node);
    }).not.toThrow();
  });
});
