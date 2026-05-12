/**
 * Transclusion scope semantics — outer-scope binding
 * (spec 018 Slice 3 / FS §2.5).
 *
 * Locks the AngularJS-canonical rule that the scope passed into a
 * transcluded clone is a child of the OUTER scope (the scope under
 * which the transcluding directive itself was linked) — NEVER of the
 * directive's own `scope: true` child. This is what every existing
 * AngularJS tutorial relies on: `<my-card>` may keep its internal
 * variables in a `scope: true` child while consumer markup inside
 * the card still binds to the consumer's own variables.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService, DirectiveFactory, DirectiveFactoryReturn, TranscludeFn } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import { createTemplateCache } from '@template/template-cache';
import { createTemplateRequest } from '@template/template-request';
import type { TemplateCacheService, TemplateRequestFn } from '@template/template-types';

function bootstrapNgModule(): void {
  resetRegistry();
  createModule('ng', [])
    .factory('$exceptionHandler', [() => () => undefined])
    .provider('$sceDelegate', $SceDelegateProvider)
    .provider('$sce', $SceProvider)
    .provider('$interpolate', $InterpolateProvider)
    .provider('$filter', ['$provide', $FilterProvider])
    .factory('$templateCache', [() => createTemplateCache()])
    .factory('$templateRequest', [
      '$templateCache',
      (cache: TemplateCacheService): TemplateRequestFn => createTemplateRequest({ cache }),
    ])
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

describe('transclusion scope — outer-scope binding (FS §2.5)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('transcludedScope.$parent === outerScope strictly', () => {
    let transcludedScope: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            $transclude?.((_clone, scope) => {
              transcludedScope = scope;
            });
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    host.appendChild(document.createElement('p'));

    const outer = Scope.create();
    $compile(host)(outer);

    expect(transcludedScope).not.toBeNull();
    expect((transcludedScope as unknown as { $parent: Scope }).$parent).toBe(outer);
  });

  it('the directive’s own scope: true child is NEVER in the prototype chain of the transcluded scope', () => {
    let directiveScope: Scope | null = null;
    let transcludedScope: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: true,
          transclude: true,
          link: (scope, _element, _attrs, _ctrls, $transclude) => {
            directiveScope = scope;
            $transclude?.((_clone, ts) => {
              transcludedScope = ts;
            });
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    host.appendChild(document.createElement('p'));

    const outer = Scope.create();
    $compile(host)(outer);

    expect(directiveScope).not.toBeNull();
    expect(transcludedScope).not.toBeNull();
    // The directive's own scope is a DIFFERENT object from the
    // transcluded scope.
    expect(directiveScope).not.toBe(transcludedScope);
    // Walk the transcluded scope's prototype chain — the directive's
    // own `scope: true` child must NOT appear.
    let proto: object | null = Object.getPrototypeOf(transcludedScope) as object | null;
    while (proto !== null) {
      expect(proto).not.toBe(directiveScope);
      proto = Object.getPrototypeOf(proto) as object | null;
    }
    // And the transcluded scope's $parent is the OUTER scope, not
    // the directive scope.
    expect((transcludedScope as unknown as { $parent: Scope }).$parent).toBe(outer);
  });

  it('property reads on the transcluded scope walk to outer via prototypal inheritance', () => {
    let transcludedScope: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            $transclude?.((_clone, ts) => {
              transcludedScope = ts;
            });
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    host.appendChild(document.createElement('p'));

    const outer = Scope.create();
    (outer as unknown as { foo: string }).foo = 'hi';
    $compile(host)(outer);

    expect(transcludedScope).not.toBeNull();
    expect((transcludedScope as unknown as { foo: string }).foo).toBe('hi');
  });

  it('writes to the transcluded scope shadow rather than leak into outer', () => {
    let transcludedScope: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            $transclude?.((_clone, ts) => {
              transcludedScope = ts;
            });
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    host.appendChild(document.createElement('p'));

    const outer = Scope.create();
    (outer as unknown as { foo: string }).foo = 'outer';
    $compile(host)(outer);

    expect(transcludedScope).not.toBeNull();
    (transcludedScope as unknown as { foo: string }).foo = 'inner';
    expect((transcludedScope as unknown as { foo: string }).foo).toBe('inner');
    expect((outer as unknown as { foo: string }).foo).toBe('outer');
  });

  it('two clones get two distinct scopes; mutation on one does not affect the other', () => {
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

    const outer = Scope.create();
    (outer as unknown as { value: string }).value = 'outer';
    $compile(host)(outer);

    xclude?.((_clone, ts) => {
      scopes.push(ts);
    });
    xclude?.((_clone, ts) => {
      scopes.push(ts);
    });

    expect(scopes.length).toBe(2);
    expect(scopes[0]).not.toBe(scopes[1]);
    (scopes[0] as unknown as { value: string }).value = 'a';
    expect((scopes[0] as unknown as { value: string }).value).toBe('a');
    expect((scopes[1] as unknown as { value: string }).value).toBe('outer');
  });

  it('scope: true + transclude: true coexist — directive sees its child, transcluded sees outer', () => {
    let directiveScope: Scope | null = null;
    let transcludedScope: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          scope: true,
          transclude: true,
          link: (scope, _element, _attrs, _ctrls, $transclude) => {
            directiveScope = scope;
            $transclude?.((_clone, ts) => {
              transcludedScope = ts;
            });
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    host.appendChild(document.createElement('p'));

    const outer = Scope.create();
    $compile(host)(outer);

    expect(directiveScope).not.toBeNull();
    expect(transcludedScope).not.toBeNull();
    // The directive's own scope is a child of `outer`.
    expect((directiveScope as unknown as { $parent: Scope }).$parent).toBe(outer);
    // The transcluded scope is ALSO a child of `outer` — NOT of
    // `directiveScope`.
    expect((transcludedScope as unknown as { $parent: Scope }).$parent).toBe(outer);
    expect((transcludedScope as unknown as { $parent: Scope }).$parent).not.toBe(directiveScope);
  });
});
