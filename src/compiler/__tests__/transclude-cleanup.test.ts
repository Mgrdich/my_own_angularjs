/**
 * Transclusion cleanup — `destroyElementScope` integration
 * (spec 018 Slice 3 / FS §2.8).
 *
 * Locks the cleanup contract for clones produced by `$transclude(...)`:
 *
 * - Each clone's transclusion scope is pushed onto the host element's
 *   `$$ngCleanupQueue` so `destroyElementScope(host)` `$destroy()`s
 *   every clone scope.
 * - A `cloneAttachFn` that throws STILL leaves a destroy-able scope
 *   on the queue — no orphaned scopes in the watcher tree.
 * - `destroyElementScope` is idempotent; a second call is a no-op.
 * - The OUTER scope's `$destroy()` also tears down clone scopes via
 *   normal scope-tree propagation — both paths converge.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { destroyElementScope } from '@compiler/cleanup';
import { $CompileProvider } from '@compiler/compile-provider';
import type {
  CompileService,
  DirectiveFactory,
  DirectiveFactoryReturn,
  TranscludeFn,
} from '@compiler/directive-types';
import { Scope } from '@core/index';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';

function bootstrapNgModule(): void {
  resetRegistry();
  createModule('ng', [])
    .factory('$exceptionHandler', [() => () => undefined])
    .provider('$sceDelegate', $SceDelegateProvider)
    .provider('$sce', $SceProvider)
    .provider('$interpolate', $InterpolateProvider)
    .provider('$filter', ['$provide', $FilterProvider])
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

/**
 * `Scope` exposes no public `$$destroyed` flag — `$$watchers === null`
 * is the observable signal that `$destroy()` has run.
 */
function isDestroyed(scope: Scope): boolean {
  return (scope as unknown as { $$watchers: unknown }).$$watchers === null;
}

describe('transclusion cleanup — destroyElementScope (FS §2.8)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('each clone scope is queued on the host element’s $$ngCleanupQueue', () => {
    const scopes: Scope[] = [];
    let xclude: TranscludeFn | undefined;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            xclude = $transclude;
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    host.appendChild(document.createElement('p'));

    $compile(host)(Scope.create());

    xclude?.((_clone, scope) => {
      scopes.push(scope);
    });
    xclude?.((_clone, scope) => {
      scopes.push(scope);
    });

    expect(scopes.length).toBe(2);
    const queue = (host as unknown as { $$ngCleanupQueue?: (() => void)[] }).$$ngCleanupQueue;
    expect(queue).toBeDefined();
    // Two clones → at least two cleanup callbacks.
    expect((queue ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('destroyElementScope(host) $destroy()s every clone scope', () => {
    const scopes: Scope[] = [];
    let xclude: TranscludeFn | undefined;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            xclude = $transclude;
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    host.appendChild(document.createElement('p'));

    $compile(host)(Scope.create());

    for (let i = 0; i < 3; i++) {
      xclude?.((_clone, scope) => {
        scopes.push(scope);
      });
    }
    expect(scopes.every((s) => !isDestroyed(s))).toBe(true);

    destroyElementScope(host);
    expect(scopes.every((s) => isDestroyed(s))).toBe(true);
  });

  it('a throwing cloneAttachFn still leaves a destroy-able scope on the queue', () => {
    let scope: Scope | null = null;
    let xclude: TranscludeFn | undefined;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            xclude = $transclude;
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    host.appendChild(document.createElement('p'));

    $compile(host)(Scope.create());

    xclude?.((_clone, transcludedScope) => {
      scope = transcludedScope;
      throw new Error('attach boom');
    });

    expect(scope).not.toBeNull();
    // The scope was registered for cleanup even though attach threw.
    expect(isDestroyed(scope as unknown as Scope)).toBe(false);

    destroyElementScope(host);
    expect(isDestroyed(scope as unknown as Scope)).toBe(true);
  });

  it('a second destroyElementScope is idempotent', () => {
    const scopes: Scope[] = [];
    let xclude: TranscludeFn | undefined;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            xclude = $transclude;
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    host.appendChild(document.createElement('p'));

    $compile(host)(Scope.create());

    xclude?.((_clone, scope) => {
      scopes.push(scope);
    });

    destroyElementScope(host);
    expect(() => {
      destroyElementScope(host);
    }).not.toThrow();
    expect(isDestroyed(scopes[0] as unknown as Scope)).toBe(true);
  });

  it('outer.$destroy() broadcasts $destroy to clone scopes via scope-tree propagation', () => {
    const scopes: Scope[] = [];
    const destroyEvents: number[] = [];
    let xclude: TranscludeFn | undefined;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            xclude = $transclude;
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    host.appendChild(document.createElement('p'));

    const rootScope = Scope.create();
    const outer = rootScope.$new();
    $compile(host)(outer);

    xclude?.((_clone, scope) => {
      scopes.push(scope);
      scope.$on('$destroy', () => {
        destroyEvents.push(1);
      });
    });
    xclude?.((_clone, scope) => {
      scopes.push(scope);
      scope.$on('$destroy', () => {
        destroyEvents.push(1);
      });
    });

    outer.$destroy();
    // Each clone scope received the $destroy broadcast from outer.
    expect(destroyEvents.length).toBe(2);
    // The transcluded scopes ARE children of `outer` in the scope tree
    // (verified by §2.5), so they participate in the broadcast.
    expect(scopes.length).toBe(2);
  });

  it('host-element teardown nulls clone $$watchers; outer.$destroy() broadcasts $destroy', () => {
    // The two teardown paths produce different observable surfaces in
    // the current Scope implementation: `destroyElementScope` invokes
    // each cleanup callback (`() => scope.$destroy()`) which nulls
    // `$$watchers`; `outer.$destroy()` broadcasts a `$destroy` event
    // down the scope tree which the clone's `$on('$destroy')`
    // listener observes. Both are valid AngularJS-canonical
    // observations; the test locks both.
    function setup(): {
      host: Element;
      outer: Scope;
      capture: (sink: { scope?: Scope; gotDestroy: boolean }) => void;
    } {
      bootstrapNgModule();
      let xc: TranscludeFn | undefined;
      const $compile = compileWith(($cp) => {
        $cp.directive(
          'myDir',
          ddoFactory({
            transclude: true,
            link: (_scope, _element, _attrs, _ctrls, $transclude) => {
              xc = $transclude;
            },
          }),
        );
      });
      const host = document.createElement('div');
      host.setAttribute('my-dir', '');
      host.appendChild(document.createElement('p'));
      const rootScope = Scope.create();
      const outer = rootScope.$new();
      $compile(host)(outer);
      return {
        host,
        outer,
        capture: (sink) => {
          xc?.((_clone, scope) => {
            sink.scope = scope;
            scope.$on('$destroy', () => {
              sink.gotDestroy = true;
            });
          });
        },
      };
    }

    const hostSink: { scope?: Scope; gotDestroy: boolean } = { gotDestroy: false };
    const outerSink: { scope?: Scope; gotDestroy: boolean } = { gotDestroy: false };

    const a = setup();
    a.capture(hostSink);
    destroyElementScope(a.host);

    const b = setup();
    b.capture(outerSink);
    b.outer.$destroy();

    // Host teardown nulls $$watchers; the $destroy broadcast happens
    // inside `scope.$destroy()` and the listener fires.
    expect(isDestroyed(hostSink.scope as unknown as Scope)).toBe(true);
    expect(hostSink.gotDestroy).toBe(true);
    // Outer-scope teardown broadcasts $destroy through the scope
    // tree; the clone's listener fires.
    expect(outerSink.gotDestroy).toBe(true);
  });
});
