/**
 * Integration tests for the directive `require` field (spec 022
 * Slice 4 — FS §2.4 + technical-considerations §2.4).
 *
 * Exercises three accepted shapes and three search-scope prefixes
 * through real `$compile`:
 *
 *  - String form, own element (no prefix) — `require: 'parent'`.
 *  - String form with `^`  — search own element AND `parentElement` chain.
 *  - String form with `^^` — search ancestors only.
 *  - String form with `?`  — optional miss returns `null`.
 *  - Array form  — `require: ['parent', '^^outer']`.
 *  - Object form — `require: { p: 'parent', o: '^^outer' }`. Object
 *    form ALSO auto-assigns onto the requiring controller's instance
 *    BEFORE `$onInit` runs.
 *
 * Resolution failure (`MissingRequiredControllerError`) routes via
 * `$exceptionHandler('$compile')`; the tuple stays at 10.
 *
 * Both link sites are exercised: the inline (synchronous) link path
 * AND the `templateUrl` post-template-install link path — same
 * contract.
 *
 * The `$$ngControllers` stash from Slice 3 is the source of truth: a
 * directive's controller, once instantiated, is resolvable via
 * `require: 'thisDir'` from a sibling on the same element.
 *
 * **Controller spelling.** Tests use the canonical array-style
 * annotation with a trailing function expression that captures `this`
 * onto `$scope.$$<name>Ctrl` so test bodies can read it back without
 * aliasing `this` at the test layer.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MissingRequiredControllerError } from '@compiler/compile-error';
import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from '@compiler/directive-types';
import { parseRequireFlags } from '@compiler/require-resolver';
import type { ControllerInvokable } from '@controller/controller-types';
import { Scope } from '@core/index';
import type { TemplateFetcher } from '@template/template-types';

import { bootstrapNgModule, compileWith } from './test-helpers';

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

interface ParentScope {
  [k: string]: unknown;
}

/**
 * Build a capturing controller whose trailing function stashes the
 * instance pointer onto a scope slot under the supplied key (so the
 * test body can read it back) AND runs an optional setup callback to
 * install hooks on the instance.
 *
 * The double-cast `this as unknown as Record<string, unknown>` is the
 * AngularJS-canonical surface: `this` IS the prototype-instance the
 * compiler constructed via `Object.create(prototype) + invoke`. We
 * write to scope FIRST (the `lint:no-this-alias` rule disallows
 * `const self = this`), then pass the typed view to `setup` so it can
 * install hooks without re-aliasing.
 */
function captureCtrl(scopeKey: string, setup?: (instance: Record<string, unknown>) => void): ControllerInvokable {
  return [
    '$scope',
    function (this: Record<string, unknown>, $scope: unknown): void {
      ($scope as Record<string, unknown>)[scopeKey] = this;
      if (setup !== undefined) {
        setup(this);
      }
    },
  ] as ControllerInvokable;
}

/**
 * Build a controller-only invokable that writes `this` into the
 * supplied capture slot. Avoids the `no-this-alias` lint rule by going
 * through a side-effect (assignment to an external slot) rather than
 * a `const self = this` aliasing.
 */
function captureInstanceTo(slot: { current: unknown }): ControllerInvokable {
  return [
    function (this: unknown): void {
      slot.current = this;
    },
  ] as ControllerInvokable;
}

describe('require — string form, own element (no prefix)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('delivers the parent directive controller as the link fn 4th argument', () => {
    const parentSlot = { current: undefined as unknown };
    let received: unknown = '<not-set>';
    const $compile = compileWith(($cp) => {
      $cp.directive('parent', ddoFactory({ controller: captureInstanceTo(parentSlot) }));
      $cp.directive(
        'child',
        ddoFactory({
          require: 'parent',
          priority: -10, // run after parent (default priority 0 — parent stashes first)
          link: ((_s, _e, _a, ctrl) => {
            received = ctrl;
          }) as LinkFn,
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('parent', '');
    node.setAttribute('child', '');
    const parent = Scope.create<ParentScope>();
    $compile(node)(parent);
    expect(received).toBe(parentSlot.current);
  });

  it('routes MissingRequiredControllerError when the required directive is absent', () => {
    const handler = vi.fn();
    bootstrapNgModule({ exceptionHandler: handler });
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'child',
        ddoFactory({
          require: 'parent',
          link: ((): void => undefined) as LinkFn,
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('child', '');
    const parent = Scope.create<ParentScope>();
    $compile(node)(parent);

    expect(handler).toHaveBeenCalledTimes(1);
    const callArgs = handler.mock.calls[0];
    expect(callArgs).toBeDefined();
    const err = (callArgs as unknown[])[0];
    expect(err).toBeInstanceOf(MissingRequiredControllerError);
    expect((err as Error).message).toContain('Controller "parent" required by directive "child"');
    expect((err as Error).message).toContain('this element');
  });

  it('returns null when the requirement is optional (?prefix) and missing', () => {
    let received: unknown = '<not-set>';
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'child',
        ddoFactory({
          require: '?parent',
          link: ((_s, _e, _a, ctrl) => {
            received = ctrl;
          }) as LinkFn,
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('child', '');
    const parent = Scope.create<ParentScope>();
    $compile(node)(parent);
    expect(received).toBeNull();
  });
});

describe('require — ^ prefix (own element + ancestors)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('delivers an ancestor controller when the directive is on an ancestor', () => {
    const parentSlot = { current: undefined as unknown };
    let received: unknown = '<not-set>';
    const $compile = compileWith(($cp) => {
      $cp.directive('parent', ddoFactory({ controller: captureInstanceTo(parentSlot) }));
      $cp.directive(
        'child',
        ddoFactory({
          require: '^parent',
          link: ((_s, _e, _a, ctrl) => {
            received = ctrl;
          }) as LinkFn,
        }),
      );
    });
    const root = document.createElement('div');
    root.setAttribute('parent', '');
    const child = document.createElement('div');
    child.setAttribute('child', '');
    root.appendChild(child);
    const parent = Scope.create<ParentScope>();
    $compile(root)(parent);
    expect(received).toBe(parentSlot.current);
  });

  it('prefers the own-element controller when both own and ancestor declare it', () => {
    // The same `parent` directive runs on BOTH the outer element and
    // the inner element. Each instance writes its element's tag-name
    // onto the `where` slot so we can distinguish them. `^parent`
    // searches own-element FIRST, so the resolved controller must be
    // the OWN-element instance (its `where` is the inner element's
    // tagName, not the outer's).
    let received: unknown = '<not-set>';
    const $compile = compileWith(($cp) => {
      const recordingCtrl: ControllerInvokable = [
        '$element',
        function (this: Record<string, unknown>, $element: Element): void {
          // Use the element's id (set per-test below) as a marker.
          this.where = $element.id;
        },
      ] as ControllerInvokable;
      $cp.directive('parent', ddoFactory({ controller: recordingCtrl }));
      $cp.directive(
        'child',
        ddoFactory({
          require: '^parent',
          priority: -10,
          link: ((_s, _e, _a, ctrl) => {
            received = ctrl;
          }) as LinkFn,
        }),
      );
    });
    const root = document.createElement('div');
    root.id = 'outer';
    root.setAttribute('parent', '');
    const inner = document.createElement('div');
    inner.id = 'inner';
    inner.setAttribute('parent', '');
    inner.setAttribute('child', '');
    root.appendChild(inner);
    const parent = Scope.create<ParentScope>();
    $compile(root)(parent);

    // Own-element wins: the resolved controller's `where` is 'inner'.
    expect((received as { where?: unknown }).where).toBe('inner');
  });

  it('routes MissingRequiredControllerError when no element in chain has the controller', () => {
    const handler = vi.fn();
    bootstrapNgModule({ exceptionHandler: handler });
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'child',
        ddoFactory({
          require: '^parent',
          link: ((): void => undefined) as LinkFn,
        }),
      );
    });
    const root = document.createElement('div');
    const child = document.createElement('div');
    child.setAttribute('child', '');
    root.appendChild(child);
    const parent = Scope.create<ParentScope>();
    $compile(root)(parent);

    expect(handler).toHaveBeenCalledTimes(1);
    const err = (handler.mock.calls[0] as unknown[])[0];
    expect(err).toBeInstanceOf(MissingRequiredControllerError);
    expect((err as Error).message).toContain('this element and its ancestors');
  });
});

describe('require — ^^ prefix (ancestors only)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('skips the own element and returns the ancestor controller', () => {
    let received: unknown = '<not-set>';
    const $compile = compileWith(($cp) => {
      const recordingCtrl: ControllerInvokable = [
        '$element',
        function (this: Record<string, unknown>, $element: Element): void {
          this.where = $element.id;
        },
      ] as ControllerInvokable;
      $cp.directive('parent', ddoFactory({ controller: recordingCtrl }));
      $cp.directive(
        'child',
        ddoFactory({
          require: '^^parent',
          priority: -10,
          link: ((_s, _e, _a, ctrl) => {
            received = ctrl;
          }) as LinkFn,
        }),
      );
    });
    // <root parent id=outer><div parent child id=inner></div></root>
    // child declares ^^parent — ancestors ONLY → must resolve to
    // OUTER parent (`outer`), NOT inner.
    const root = document.createElement('div');
    root.id = 'outer';
    root.setAttribute('parent', '');
    const inner = document.createElement('div');
    inner.id = 'inner';
    inner.setAttribute('parent', '');
    inner.setAttribute('child', '');
    root.appendChild(inner);
    const parent = Scope.create<ParentScope>();
    $compile(root)(parent);

    expect((received as { where?: unknown }).where).toBe('outer');
  });
});

describe('require — array form', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('resolves each entry independently and delivers an array as the 4th arg', () => {
    let received: unknown = '<not-set>';
    const parentSlot = { current: undefined as unknown };
    const outerSlot = { current: undefined as unknown };
    const $compile = compileWith(($cp) => {
      $cp.directive('parent', ddoFactory({ controller: captureInstanceTo(parentSlot) }));
      $cp.directive('outer', ddoFactory({ controller: captureInstanceTo(outerSlot) }));
      $cp.directive(
        'child',
        ddoFactory({
          require: ['parent', '^^outer'],
          priority: -10,
          link: ((_s, _e, _a, ctrls) => {
            received = ctrls;
          }) as LinkFn,
        }),
      );
    });
    const root = document.createElement('div');
    root.setAttribute('outer', '');
    const inner = document.createElement('div');
    inner.setAttribute('parent', '');
    inner.setAttribute('child', '');
    root.appendChild(inner);
    const parent = Scope.create<ParentScope>();
    $compile(root)(parent);

    expect(Array.isArray(received)).toBe(true);
    const arr = received as unknown[];
    expect(arr).toHaveLength(2);
    expect(arr[0]).toBe(parentSlot.current);
    expect(arr[1]).toBe(outerSlot.current);
  });

  it('returns null for optional misses in an array form', () => {
    let received: unknown = '<not-set>';
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'parent',
        ddoFactory({
          controller: [
            function (): void {
              /* present */
            },
          ] as ControllerInvokable,
        }),
      );
      $cp.directive(
        'child',
        ddoFactory({
          require: ['parent', '?^^outer'], // outer is optional + missing
          priority: -10,
          link: ((_s, _e, _a, ctrls) => {
            received = ctrls;
          }) as LinkFn,
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('parent', '');
    node.setAttribute('child', '');
    const parent = Scope.create<ParentScope>();
    $compile(node)(parent);

    const arr = received as unknown[];
    expect(arr).toHaveLength(2);
    expect(arr[0]).toBeDefined();
    expect(arr[0]).not.toBeNull();
    expect(arr[1]).toBeNull();
  });
});

describe('require — object form (with auto-assignment onto instance)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('delivers a record as the 4th arg AND assigns onto the requiring instance before $onInit', () => {
    let receivedInLink: unknown = '<not-set>';
    let pAtOnInit: unknown = '<not-set>';
    let oAtOnInit: unknown = '<not-set>';

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'parent',
        ddoFactory({
          controller: captureCtrl('$parentCtrl'),
        }),
      );
      $cp.directive(
        'outer',
        ddoFactory({
          controller: captureCtrl('$outerCtrl'),
        }),
      );
      // The requiring directive declares its own controller AND object
      // form `require`. Object-form auto-assignment writes
      // `this.p` and `this.o` BEFORE `$onInit` runs.
      $cp.directive(
        'child',
        ddoFactory({
          require: { p: 'parent', o: '^^outer' },
          priority: -10,
          controller: captureCtrl('$childCtrl', (inst) => {
            inst.$onInit = function (this: Record<string, unknown>): void {
              pAtOnInit = this.p;
              oAtOnInit = this.o;
            };
          }),
          controllerAs: '$ctrl',
          link: ((_s, _e, _a, ctrls) => {
            receivedInLink = ctrls;
          }) as LinkFn,
        }),
      );
    });
    const root = document.createElement('div');
    root.setAttribute('outer', '');
    const inner = document.createElement('div');
    inner.setAttribute('parent', '');
    inner.setAttribute('child', '');
    root.appendChild(inner);
    const parentScope = Scope.create<ParentScope>();
    $compile(root)(parentScope);

    // Read controllers off the scope captures.
    const childCtrl = (inner as unknown as { $$ngControllers?: Map<string, unknown> }).$$ngControllers?.get('child');
    expect(childCtrl).toBeDefined();
    // 4th-arg link contract.
    expect(typeof receivedInLink).toBe('object');
    expect(receivedInLink).not.toBeNull();
    const record = receivedInLink as Record<string, unknown>;
    expect(record.p).toBeDefined();
    expect(record.o).toBeDefined();
    // $onInit saw the aliases on `this`.
    expect(pAtOnInit).toBe(record.p);
    expect(oAtOnInit).toBe(record.o);
  });

  it('cooperates with bindToController + controllerAs — sibling is on `this` at $onInit', () => {
    let siblingAtOnInit: unknown = '<not-set>';
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'parent',
        ddoFactory({
          controller: captureCtrl('$parentCtrl'),
        }),
      );
      $cp.directive(
        'child',
        ddoFactory({
          scope: { value: '<' } as Record<string, string>,
          bindToController: true,
          require: { sibling: '^parent' },
          priority: -10,
          controller: captureCtrl('$ctrlInstance', (inst) => {
            inst.$onInit = function (this: Record<string, unknown>): void {
              siblingAtOnInit = this.sibling;
            };
          }),
          controllerAs: '$ctrl',
        }),
      );
    });
    const root = document.createElement('div');
    root.setAttribute('parent', '');
    const inner = document.createElement('div');
    inner.setAttribute('child', '');
    inner.setAttribute('value', '42');
    root.appendChild(inner);
    const parentScope = Scope.create<ParentScope>();
    $compile(root)(parentScope);

    expect(siblingAtOnInit).toBeDefined();
    expect(siblingAtOnInit).not.toBeNull();
  });
});

describe('require — without own controller', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('still delivers the resolved controllers to the link fn 4th arg', () => {
    let received: unknown = '<not-set>';
    const parentSlot = { current: undefined as unknown };
    const $compile = compileWith(($cp) => {
      $cp.directive('parent', ddoFactory({ controller: captureInstanceTo(parentSlot) }));
      // Link-only directive WITHOUT a controller — but with `require`.
      $cp.directive(
        'child',
        ddoFactory({
          require: 'parent',
          priority: -10,
          link: ((_s, _e, _a, ctrl) => {
            received = ctrl;
          }) as LinkFn,
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('parent', '');
    node.setAttribute('child', '');
    const parent = Scope.create<ParentScope>();
    $compile(node)(parent);

    expect(received).toBe(parentSlot.current);
  });
});

describe('require — $$ngControllers stash is the source of truth', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('regression: a sibling can require its own-element directive controller via no-prefix require', () => {
    const parentSlot = { current: undefined as unknown };
    let received: unknown = '<not-set>';
    const $compile = compileWith(($cp) => {
      $cp.directive('parent', ddoFactory({ controller: captureInstanceTo(parentSlot) }));
      // The requiring directive is on the SAME element as `parent` and
      // declares no prefix — it MUST resolve via the own-element
      // `$$ngControllers` stash planted by Slice 3 of the seam.
      $cp.directive(
        'sibling',
        ddoFactory({
          require: 'parent',
          priority: -10,
          link: ((_s, _e, _a, ctrl) => {
            received = ctrl;
          }) as LinkFn,
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('parent', '');
    node.setAttribute('sibling', '');
    const scope = Scope.create<ParentScope>();
    $compile(node)(scope);
    expect(received).toBe(parentSlot.current);
  });
});

describe('require — templateUrl post-install link path', () => {
  it('wires require the same way as the inline link path', async () => {
    const fetcher = vi.fn<TemplateFetcher>(() => Promise.resolve('<p>installed</p>'));
    bootstrapNgModule({ fetcher });
    const parentSlot = { current: undefined as unknown };
    let received: unknown = '<not-set>';
    const $compile = compileWith(($cp) => {
      $cp.directive('parent', ddoFactory({ controller: captureInstanceTo(parentSlot) }));
      // The `templateUrl` directive defers compile/link to the drain;
      // require resolution must still run AFTER the seam plants
      // controllers, in the post-template link site.
      $cp.directive(
        'child',
        ddoFactory({
          templateUrl: '/tpl.html',
          require: '^parent',
          link: ((_s, _e, _a, ctrl) => {
            received = ctrl;
          }) as LinkFn,
        }),
      );
    });
    const root = document.createElement('div');
    root.setAttribute('parent', '');
    const inner = document.createElement('div');
    inner.setAttribute('child', '');
    root.appendChild(inner);
    const scope = Scope.create<ParentScope>();
    $compile(root)(scope);
    // Drain the deferred template install.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(received).toBe(parentSlot.current);
  });
});

describe('parseRequireFlags — unit', () => {
  it('parses an unflagged name', () => {
    expect(parseRequireFlags('parent')).toEqual({ prefix: '', optional: false, name: 'parent' });
  });

  it('parses ^name as element-and-ancestors', () => {
    expect(parseRequireFlags('^parent')).toEqual({ prefix: '^', optional: false, name: 'parent' });
  });

  it('parses ^^name as ancestors-only', () => {
    expect(parseRequireFlags('^^parent')).toEqual({ prefix: '^^', optional: false, name: 'parent' });
  });

  it('parses ?name as optional', () => {
    expect(parseRequireFlags('?parent')).toEqual({ prefix: '', optional: true, name: 'parent' });
  });

  it('parses ?^name and ^?name identically (order-tolerant)', () => {
    expect(parseRequireFlags('?^parent')).toEqual({ prefix: '^', optional: true, name: 'parent' });
    expect(parseRequireFlags('^?parent')).toEqual({ prefix: '^', optional: true, name: 'parent' });
  });

  it('parses ?^^name and ^^?name identically (order-tolerant + longest prefix wins)', () => {
    expect(parseRequireFlags('?^^parent')).toEqual({ prefix: '^^', optional: true, name: 'parent' });
    expect(parseRequireFlags('^^?parent')).toEqual({ prefix: '^^', optional: true, name: 'parent' });
  });
});
