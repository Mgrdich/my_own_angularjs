/**
 * Content transclusion — `transclude: true` end-to-end
 * (spec 018 Slice 3 / FS §2.2 + §2.4 + §2.7 acceptance).
 *
 * Locks the AngularJS-canonical behavior for a directive declaring
 * `transclude: true`:
 *
 * - Compile-phase capture: children are moved off the live DOM into a
 *   private master fragment BEFORE the OUTER walker recurses into them.
 * - Captured order, attributes, inline event handlers, text-node
 *   whitespace, and comment children are all preserved.
 * - The captured master compiles EXACTLY ONCE regardless of clone count.
 * - `$transclude(cloneAttachFn)` produces a deep-cloned, linked subtree
 *   bound to the OUTER scope. Multi-clone supported (each call yields
 *   an independent clone with an independent transclusion scope).
 * - The 5th link arg and the 3rd compile arg are the SAME `TranscludeFn`
 *   reference; both are `undefined` on directives that did NOT declare
 *   transclusion themselves.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type {
  CompileFn,
  CompileService,
  DirectiveFactory,
  DirectiveFactoryReturn,
  LinkFn,
  TranscludeFn,
} from '@compiler/directive-types';
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

describe('transclude: true — capture pipeline (FS §2.2)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('drains all element children off the live DOM at compile time', () => {
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: () => {
            /* no-op — never projects */
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    const p = document.createElement('p');
    const span = document.createElement('span');
    host.appendChild(p);
    host.appendChild(span);

    $compile(host)(Scope.create());

    expect(host.childNodes.length).toBe(0);
  });

  it('preserves order of captured children when projected', () => {
    let projected: Node[] = [];
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            projected = $transclude?.(() => undefined) ?? [];
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    const p = document.createElement('p');
    p.textContent = 'first';
    const span = document.createElement('span');
    span.textContent = 'second';
    host.appendChild(p);
    host.appendChild(span);

    $compile(host)(Scope.create());

    expect(projected.length).toBe(2);
    expect((projected[0] as Element).tagName).toBe('P');
    expect((projected[1] as Element).tagName).toBe('SPAN');
  });

  it('preserves attributes and inline event handlers on captured children', () => {
    let projected: Node[] = [];
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            projected = $transclude?.(() => undefined) ?? [];
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    const btn = document.createElement('button');
    btn.setAttribute('id', 'reset');
    btn.setAttribute('onclick', 'doReset()');
    btn.setAttribute('data-x', 'y');
    host.appendChild(btn);

    $compile(host)(Scope.create());

    expect(projected.length).toBe(1);
    const cloneBtn = projected[0] as Element;
    expect(cloneBtn.getAttribute('id')).toBe('reset');
    expect(cloneBtn.getAttribute('onclick')).toBe('doReset()');
    expect(cloneBtn.getAttribute('data-x')).toBe('y');
  });

  it('preserves whitespace text nodes and comment children in document order', () => {
    let projected: Node[] = [];
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            projected = $transclude?.(() => undefined) ?? [];
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    host.appendChild(document.createTextNode('  '));
    host.appendChild(document.createComment(' a note '));
    host.appendChild(document.createTextNode('hello'));

    $compile(host)(Scope.create());

    expect(projected.length).toBe(3);
    expect(projected[0]?.nodeType).toBe(Node.TEXT_NODE);
    expect(projected[0]?.textContent).toBe('  ');
    expect(projected[1]?.nodeType).toBe(Node.COMMENT_NODE);
    expect(projected[1]?.textContent).toBe(' a note ');
    expect(projected[2]?.nodeType).toBe(Node.TEXT_NODE);
    expect(projected[2]?.textContent).toBe('hello');
  });

  it('empty captured fragment is valid — $transclude returns []', () => {
    let projected: Node[] | null = null;
    let cloneArg: Node[] | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            projected =
              $transclude?.((clone) => {
                cloneArg = clone;
              }) ?? null;
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');

    $compile(host)(Scope.create());

    expect(projected).toEqual([]);
    expect(cloneArg).toEqual([]);
  });

  it('void-style host element produces an empty captured fragment', () => {
    let projected: Node[] = [];
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            projected = $transclude?.(() => undefined) ?? [];
          },
        }),
      );
    });

    // <img> is a void element — jsdom enforces no children. Use the
    // attribute directive form so an <img my-dir /> match registers.
    const host = document.createElement('img');
    host.setAttribute('my-dir', '');

    $compile(host)(Scope.create());

    expect(projected).toEqual([]);
  });
});

describe('transclude: true — outer-walker bypass (FS §2.2 #5)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('captured children are NOT linked against the directive element by the outer walker', () => {
    const innerLink = vi.fn<LinkFn>();
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: () => {
            /* never projects — captured children must not have linked */
          },
        }),
      );
      $cp.directive(
        'inner',
        ddoFactory({
          link: innerLink,
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    const child = document.createElement('div');
    child.setAttribute('inner', '');
    host.appendChild(child);

    $compile(host)(Scope.create());

    expect(innerLink).not.toHaveBeenCalled();
  });

  it('inner directives compile EXACTLY ONCE regardless of how many times $transclude is called', () => {
    const innerCompile = vi.fn<CompileFn>(() => () => undefined);
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
      $cp.directive(
        'inner',
        ddoFactory({
          compile: innerCompile,
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    const child = document.createElement('div');
    child.setAttribute('inner', '');
    host.appendChild(child);

    $compile(host)(Scope.create());

    expect(xclude).toBeTypeOf('function');
    // Trigger five clones — inner compile must STILL have only fired once.
    for (let i = 0; i < 5; i++) {
      xclude?.(() => undefined);
    }
    expect(innerCompile).toHaveBeenCalledTimes(1);
  });
});

describe('transclude: true — projection + outer scope (FS §2.4 + §2.7)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('$transclude(fn) projects a deep-cloned subtree linked against the outer scope', () => {
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: (_scope, element, _attrs, _ctrls, $transclude) => {
            $transclude?.((clone) => {
              for (const n of clone) {
                element.appendChild(n);
              }
            });
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    const p = document.createElement('p');
    p.textContent = 'projected';
    host.appendChild(p);

    const scope = Scope.create();
    $compile(host)(scope);

    expect(host.children.length).toBe(1);
    const cloned = host.children[0] as Element;
    expect(cloned.tagName).toBe('P');
    expect(cloned.textContent).toBe('projected');
    // Clone is a separate node from the original master.
    expect(cloned).not.toBe(p);
  });

  it('directives inside transcluded content link against the outer scope', () => {
    // Use a marker directive in the captured content that reads a
    // property off its `scope` argument and writes it back to the
    // element. With outer-scope binding, the property is visible.
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: (_scope, element, _attrs, _ctrls, $transclude) => {
            $transclude?.((clone) => {
              for (const n of clone) {
                element.appendChild(n);
              }
            });
          },
        }),
      );
      $cp.directive(
        'reader',
        ddoFactory({
          link: (scope, element) => {
            // The transcluded scope inherits from the OUTER scope, so
            // a read of `scope.x` walks the prototype chain to the outer.
            const value = (scope as unknown as { x: string }).x;
            element.textContent = `value=${value}`;
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    const child = document.createElement('span');
    child.setAttribute('reader', '');
    host.appendChild(child);

    const outer = Scope.create();
    (outer as unknown as { x: string }).x = 'OUTER';
    $compile(host)(outer);

    expect(host.children[0]?.textContent).toBe('value=OUTER');
  });

  it('two sequential $transclude calls produce independent clones with independent scopes', () => {
    const projected: { clone: Node[]; scope: Scope }[] = [];
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            $transclude?.((clone, transcludedScope) => {
              projected.push({ clone, scope: transcludedScope });
            });
            $transclude?.((clone, transcludedScope) => {
              projected.push({ clone, scope: transcludedScope });
            });
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    const p = document.createElement('p');
    p.textContent = 'x';
    host.appendChild(p);

    $compile(host)(Scope.create());

    expect(projected.length).toBe(2);
    expect(projected[0]?.clone[0]).not.toBe(projected[1]?.clone[0]);
    expect(projected[0]?.scope).not.toBe(projected[1]?.scope);
  });
});

describe('transclude: true — $transclude argument shape (FS §2.4 #1, #11)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('the 5th link arg is undefined for a directive that did NOT declare transclude', () => {
    const seen: { had$transclude: boolean }[] = [];
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'plainDir',
        ddoFactory({
          link: (..._args: unknown[]) => {
            const fifth = _args[4];
            seen.push({ had$transclude: fifth !== undefined });
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('plain-dir', '');

    $compile(host)(Scope.create());

    expect(seen).toEqual([{ had$transclude: false }]);
  });

  it('the 3rd compile arg === the 5th link arg (same TranscludeFn reference)', () => {
    let compileXclude: TranscludeFn | undefined;
    let linkXclude: TranscludeFn | undefined;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          compile: (_el, _attrs, $transclude) => {
            compileXclude = $transclude;
            return (_scope, _element, _attrs2, _ctrls, $transcludeLink) => {
              linkXclude = $transcludeLink;
            };
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');

    $compile(host)(Scope.create());

    expect(compileXclude).toBeTypeOf('function');
    expect(linkXclude).toBeTypeOf('function');
    expect(compileXclude).toBe(linkXclude);
  });
});
