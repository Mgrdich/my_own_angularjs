/**
 * Inline `template` install — string + function form end-to-end
 * (spec 019 Slice 5 / FS §2.1 + §2.2 + §2.7 + §2.8 + §2.9).
 *
 * Exercises the synchronous template-install pre-pass inside
 * `compileElementOrComment`. Each test bootstraps a fresh `ng` module
 * (with the template-cache + template-request factories needed by
 * `$compile`'s widened deps list), registers a directive declaring
 * `template` (string or function), compiles a host element, and asserts
 * the post-link DOM matches the spec.
 *
 * Function-form acceptance criteria:
 *   - Memoized per compile invocation — function called EXACTLY ONCE
 *     even when the same compiled tree is linked multiple times
 *     (FS §2.2 #3).
 *   - Non-string return routes `TemplateFunctionReturnedNonStringError`
 *     via `$exceptionHandler('$compile')`; host stays empty; other
 *     behavior runs (FS §2.2 #4).
 *   - Throw routes the thrown error via `$exceptionHandler('$compile')`;
 *     host stays empty; siblings continue (FS §2.2 #5).
 *
 * Wrapper-pattern acceptance:
 *   - `transclude: true` + inline `template` + `<div ng-transclude>`
 *     projects consumer children into the slot inside the template,
 *     bound to the OUTER scope per spec 018 §2.5 (FS §2.9).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import { TemplateFunctionReturnedNonStringError } from '@compiler/compile-error';
import type {
  CompileFn,
  CompileService,
  DirectiveFactory,
  DirectiveFactoryReturn,
  LinkFn,
  Linker,
  TemplateFn,
} from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';

import { bootstrapNgModule, compileWith } from './test-helpers';

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

type SpyHandler = ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;

interface SpyHarness {
  handler: SpyHandler;
  register: (configure: ($cp: $CompileProvider) => void) => void;
  inject: () => { $compile: CompileService };
}

function buildSpyHarness(): SpyHarness {
  const handler = vi.fn<(...args: unknown[]) => void>();
  bootstrapNgModule({ exceptionHandler: handler });

  let registered: (($cp: $CompileProvider) => void) | null = null;
  return {
    handler,
    register(configure) {
      registered = configure;
    },
    inject() {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          registered?.($cp);
        },
      ]);
      const injector = createInjector([appModule]);
      return { $compile: injector.get('$compile') };
    },
  };
}

afterEach(() => {
  resetRegistry();
});

describe('inline template install — string form (FS §2.1)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it("installs the template as the host element's only child", () => {
    const $compile = compileWith(($cp) => {
      $cp.directive('myDir', ddoFactory({ template: '<p>hi</p>' }));
    });
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());

    expect(host.childNodes.length).toBe(1);
    expect(host.firstElementChild?.tagName).toBe('P');
    expect(host.firstElementChild?.textContent).toBe('hi');
  });

  it("REPLACES the host element's existing consumer children (no transclude)", () => {
    const $compile = compileWith(($cp) => {
      $cp.directive('myDir', ddoFactory({ template: '<p>kept</p>' }));
    });
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    const lost = document.createElement('span');
    lost.textContent = 'lost';
    host.appendChild(lost);

    $compile(host)(Scope.create());

    expect(host.childNodes.length).toBe(1);
    expect(host.firstElementChild?.tagName).toBe('P');
    expect(host.firstElementChild?.textContent).toBe('kept');
    expect(host.querySelector('span')).toBeNull();
  });

  it('installs all roots of a multi-root template as host siblings', () => {
    const $compile = compileWith(($cp) => {
      $cp.directive('myDir', ddoFactory({ template: '<h2>a</h2><p>b</p>' }));
    });
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());

    expect(host.childNodes.length).toBe(2);
    const [first, second] = Array.from(host.children);
    expect(first?.tagName).toBe('H2');
    expect(first?.textContent).toBe('a');
    expect(second?.tagName).toBe('P');
    expect(second?.textContent).toBe('b');
  });

  it('interpolated attribute `{{x}}` on a child directive in the template resolves against the host scope after digest', () => {
    // Text-node interpolation is not wired in spec 017 — interpolation
    // surfaces through `attrs.$observe` on a child directive. The
    // template installs a `<child-dir attr="{{x}}">` element; a
    // `childDir` directive registers and observes the `attr` value;
    // after `scope.x = 'hi'` + `$digest`, the observer reports `'hi'`.
    let observed: string | undefined;
    const $compile = compileWith(($cp) => {
      $cp.directive('myDir', ddoFactory({ template: '<child-dir attr="{{x}}"></child-dir>', scope: true }));
      $cp.directive(
        'childDir',
        ddoFactory({
          link: (_scope, _el, attrs) => {
            attrs.$observe('attr', (value) => {
              observed = value;
            });
          },
        }),
      );
    });
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    const scope = Scope.create();
    $compile(host)(scope);
    scope.x = 'hi';
    scope.$digest();

    expect(observed).toBe('hi');
  });

  it('preserves host element attributes (id, class, data-*) — only children are replaced', () => {
    const $compile = compileWith(($cp) => {
      $cp.directive('myDir', ddoFactory({ template: '<p>hi</p>' }));
    });
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    host.setAttribute('id', 'x');
    host.setAttribute('class', 'y');
    host.setAttribute('data-foo', 'z');
    $compile(host)(Scope.create());

    expect(host.getAttribute('id')).toBe('x');
    expect(host.getAttribute('class')).toBe('y');
    expect(host.getAttribute('data-foo')).toBe('z');
    expect(host.childNodes.length).toBe(1);
    expect(host.firstElementChild?.tagName).toBe('P');
  });

  it('a text-only template installs a single text-node child', () => {
    const $compile = compileWith(($cp) => {
      $cp.directive('myDir', ddoFactory({ template: 'just text' }));
    });
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());

    expect(host.childNodes.length).toBe(1);
    const firstChild = host.firstChild;
    expect(firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(firstChild?.nodeValue).toBe('just text');
  });
});

describe('inline template install — function form (FS §2.2)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('invokes the function with (element, attrs) and installs the returned string', () => {
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          template: (_el, attrs) => {
            const label = attrs['label'];
            return `<p>${typeof label === 'string' ? label : ''}</p>`;
          },
        }),
      );
    });
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    host.setAttribute('label', 'hello');
    $compile(host)(Scope.create());

    expect(host.childNodes.length).toBe(1);
    expect(host.firstElementChild?.tagName).toBe('P');
    expect(host.firstElementChild?.textContent).toBe('hello');
  });

  it('is called EXACTLY ONCE per compile invocation across multiple linker calls (memoization)', () => {
    // `$compile(node)` returns a `Linker` that may be re-invoked
    // against different scopes; the function-form template MUST resolve
    // once and be reused. Memoization happens on the compiled directive
    // entry, not per link invocation.
    const spy = vi.fn<TemplateFn>(() => '<p>memo</p>');
    const $compile = compileWith(($cp) => {
      $cp.directive('myDir', ddoFactory({ template: spy }));
    });
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    const linker: Linker = $compile(host);
    linker(Scope.create());
    linker(Scope.create());

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('routes `TemplateFunctionReturnedNonStringError` for a non-string return (42); host empty; siblings continue', () => {
    const siblingLink = vi.fn<LinkFn>();
    const { handler, register, inject } = buildSpyHarness();
    register(($cp) => {
      $cp.directive('myDir', ddoFactory({ template: (() => 42 as unknown as string) as TemplateFn }));
      $cp.directive('sibling', ddoFactory({ link: siblingLink }));
    });
    const { $compile } = inject();
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    host.setAttribute('sibling', '');
    $compile(host)(Scope.create());

    expect(host.childNodes.length).toBe(0);
    expect(handler).toHaveBeenCalled();
    const [err, cause] = handler.mock.calls[0] ?? [];
    expect(err).toBeInstanceOf(TemplateFunctionReturnedNonStringError);
    expect(cause).toBe('$compile');
    expect(siblingLink).toHaveBeenCalled();
  });

  it('routes `TemplateFunctionReturnedNonStringError` for `undefined` return', () => {
    const { handler, register, inject } = buildSpyHarness();
    register(($cp) => {
      $cp.directive('myDir', ddoFactory({ template: (() => undefined as unknown as string) as TemplateFn }));
    });
    const { $compile } = inject();
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());

    expect(host.childNodes.length).toBe(0);
    expect(handler).toHaveBeenCalled();
    const [err] = handler.mock.calls[0] ?? [];
    expect(err).toBeInstanceOf(TemplateFunctionReturnedNonStringError);
  });

  it('routes `TemplateFunctionReturnedNonStringError` for a `null` return', () => {
    const { handler, register, inject } = buildSpyHarness();
    register(($cp) => {
      $cp.directive('myDir', ddoFactory({ template: (() => null as unknown as string) as TemplateFn }));
    });
    const { $compile } = inject();
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());

    expect(host.childNodes.length).toBe(0);
    expect(handler).toHaveBeenCalled();
    const [err] = handler.mock.calls[0] ?? [];
    expect(err).toBeInstanceOf(TemplateFunctionReturnedNonStringError);
  });

  it('routes `TemplateFunctionReturnedNonStringError` for an object return', () => {
    const { handler, register, inject } = buildSpyHarness();
    register(($cp) => {
      $cp.directive('myDir', ddoFactory({ template: (() => ({}) as unknown as string) as TemplateFn }));
    });
    const { $compile } = inject();
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());

    expect(host.childNodes.length).toBe(0);
    expect(handler).toHaveBeenCalled();
    const [err] = handler.mock.calls[0] ?? [];
    expect(err).toBeInstanceOf(TemplateFunctionReturnedNonStringError);
  });

  it('routes the thrown error for a function that throws; host stays empty; siblings continue', () => {
    const siblingLink = vi.fn<LinkFn>();
    const boom = new Error('boom');
    const { handler, register, inject } = buildSpyHarness();
    register(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          template: (() => {
            throw boom;
          }) as TemplateFn,
        }),
      );
      $cp.directive('sibling', ddoFactory({ link: siblingLink }));
    });
    const { $compile } = inject();
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    host.setAttribute('sibling', '');
    $compile(host)(Scope.create());

    expect(host.childNodes.length).toBe(0);
    expect(handler).toHaveBeenCalled();
    const [err, cause] = handler.mock.calls[0] ?? [];
    expect(err).toBe(boom);
    expect(cause).toBe('$compile');
    expect(siblingLink).toHaveBeenCalled();
  });
});

describe('inline template install — phase ordering (FS §2.8)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it("installs the template BEFORE the host directive's `compile` runs", () => {
    let observed: Node | null = 'sentinel' as unknown as Node | null;
    const compileFn: CompileFn = (element) => {
      observed = element.firstChild;
      return undefined;
    };
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          template: '<p>installed</p>',
          compile: compileFn,
        }),
      );
    });
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());

    expect(observed).not.toBeNull();
    expect((observed as Element).tagName).toBe('P');
    expect((observed as Element).textContent).toBe('installed');
  });

  it('installs the template BEFORE the walker descends into children (child directive INSIDE template runs)', () => {
    const childLink = vi.fn<LinkFn>();
    const $compile = compileWith(($cp) => {
      $cp.directive('myCard', ddoFactory({ template: '<my-child></my-child>' }));
      $cp.directive('myChild', ddoFactory({ link: childLink }));
    });
    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    $compile(host)(Scope.create());

    expect(childLink).toHaveBeenCalledTimes(1);
    // The child link fired on the template's `<my-child>` — proving the
    // walker descended into the post-template DOM rather than the
    // (empty) consumer content.
    const [, element] = childLink.mock.calls[0] ?? [];
    expect((element as Element).tagName).toBe('MY-CHILD');
  });
});

describe('inline template install — transclude wrapper pattern (FS §2.9)', () => {
  it('`transclude: true` + `template` + `<div ng-transclude>` projects consumer content (structural integration)', () => {
    // Bootstrap with the real `ngModule` so the registered
    // `ngTransclude` directive resolves. Mirrors the
    // `cross-spec-smoke.test.ts` pattern.
    //
    // Text-node interpolation is not wired in spec 017 — so we assert
    // the structural integration only: the template installs, the
    // wrapper structure is present, and the consumer's `<p>` is
    // projected into the `<div ng-transclude>` marker.
    bootstrapNgModule();

    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp: $CompileProvider) => {
        $cp.directive('myCard', [
          () => ({
            transclude: true,
            scope: true,
            template: '<div class="card"><h2>title</h2><div ng-transclude></div></div>',
          }),
        ]);
      },
    ]);

    const injector = createInjector([ngModule, appModule]);
    const $compile = injector.get<CompileService>('$compile');

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    const projected = document.createElement('p');
    projected.textContent = 'consumer';
    host.appendChild(projected);

    const outer = Scope.create();
    $compile(host)(outer);
    outer.$digest();

    // The template installed; the wrapper card structure is present.
    const wrapper = host.querySelector('div.card');
    expect(wrapper).not.toBeNull();
    const h2 = host.querySelector('h2');
    expect(h2?.textContent).toBe('title');
    // The `<div ng-transclude>` marker projected the consumer `<p>`.
    const marker = host.querySelector('div[ng-transclude]');
    expect(marker).not.toBeNull();
    expect(marker?.children.length).toBe(1);
    expect((marker?.children[0] as Element).tagName).toBe('P');
    expect(marker?.children[0]?.textContent).toBe('consumer');
  });

  it('`transclude: true` + `template` — projected attribute binding resolves against the OUTER scope', () => {
    // Stronger acceptance: the projected `<consumer-dir>` carries an
    // interpolated attribute. Per spec 018 §2.5, the projection binds
    // against the OUTER scope — so a value set on the outer scope (NOT
    // on the directive's `scope: true` child) is what surfaces in the
    // attribute observer.
    bootstrapNgModule();

    let observed: string | undefined;
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp: $CompileProvider) => {
        $cp.directive('myCard', [
          () => ({
            transclude: true,
            scope: true,
            template: '<div class="card"><div ng-transclude></div></div>',
          }),
        ]);
        $cp.directive('consumerDir', [
          () => ({
            link: (_scope, _el, attrs) => {
              attrs.$observe('attr', (value) => {
                observed = value;
              });
            },
          }),
        ]);
      },
    ]);

    const injector = createInjector([ngModule, appModule]);
    const $compile = injector.get<CompileService>('$compile');

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    const projected = document.createElement('consumer-dir');
    projected.setAttribute('attr', '{{outerVal}}');
    host.appendChild(projected);

    const outer = Scope.create();
    $compile(host)(outer);
    outer.outerVal = 'fromOuter';
    outer.$digest();

    expect(observed).toBe('fromOuter');
  });
});
