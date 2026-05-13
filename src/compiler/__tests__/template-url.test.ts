/**
 * Async `templateUrl` install — string + function form + deferred drain
 * (spec 019 Slice 6 / FS §2.3 + §2.4 + §2.8 + §2.11).
 *
 * Exercises the deferred-template-queue path inside `compileElementOrComment`.
 * Each test bootstraps a fresh `ng` module (with the template-cache +
 * template-request factories, the latter often decorated with a mock
 * fetcher), registers a `templateUrl` directive, compiles a host element,
 * and asserts the post-link DOM after the microtask drain.
 *
 * Async test discipline — `templateUrl` resolution happens in a chain
 * of microtasks:
 *
 *   1. The synchronous walker pushes the host onto the deferred queue.
 *   2. After the public `Linker` returns, `Promise.resolve().then(drain)`
 *      schedules the drain.
 *   3. The drain calls `$templateRequest(url)`, which (on a cache hit)
 *      resolves on the next microtask.
 *   4. The post-template linker runs synchronously inside the drain's
 *      `await`-continuation; the DOM is observable immediately after.
 *
 * In practice that means a test must `await Promise.resolve()` AT LEAST
 * TWICE — once to flush the drain schedule, once to flush the await
 * inside `processDeferredEntry`. We use a small helper that flushes
 * three microtasks to be defensive against minor variations in chain
 * length across cache-hit vs cache-miss paths.
 *
 * Sync linker contract (FS §2.11): the public `Linker` returns
 * synchronously; the host's children are EMPTY immediately after
 * `linker(scope)`. We assert this at every test that exercises a
 * `templateUrl` directive.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import { TemplateFetchFailedError, TemplateUrlFunctionReturnedNonStringError } from '@compiler/compile-error';
import type {
  CompileService,
  DirectiveFactory,
  DirectiveFactoryReturn,
  LinkFn,
  TemplateUrlFn,
} from '@compiler/directive-types';
import { destroyElementScope } from '@compiler/cleanup';
import { Scope } from '@core/index';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import type { TemplateCacheService, TemplateFetcher } from '@template/template-types';

import { bootstrapNgModule } from './test-helpers';

/**
 * Flush microtasks until the deferred-template-queue chain (drain
 * schedule → `$templateRequest` resolution → post-template linker)
 * has fully settled. Two `await Promise.resolve()` cycles suffice for
 * a cache-hit path; we wrap an extra one for defensiveness.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function compileWith(register: ($cp: $CompileProvider) => void): {
  $compile: CompileService;
  cache: TemplateCacheService;
} {
  const appModule = createModule('app', ['ng']).config([
    '$compileProvider',
    ($cp: $CompileProvider) => {
      register($cp);
    },
  ]);
  const injector = createInjector([appModule]);
  return {
    $compile: injector.get<CompileService>('$compile'),
    cache: injector.get<TemplateCacheService>('$templateCache'),
  };
}

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

afterEach(() => {
  resetRegistry();
});

describe('async templateUrl install — string form (FS §2.3 + §2.11)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('installs the fetched template once the cache-seeded request resolves', async () => {
    const { $compile, cache } = compileWith(($cp) => {
      $cp.directive('myDir', ddoFactory({ templateUrl: '/tpl.html' }));
    });
    cache.put('/tpl.html', '<p>hi</p>');

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());

    // Sync linker contract: host is EMPTY immediately after linker
    // returns.
    expect(host.firstChild).toBeNull();

    await flushMicrotasks();

    expect(host.childNodes.length).toBe(1);
    expect(host.firstElementChild?.tagName).toBe('P');
    expect(host.firstElementChild?.textContent).toBe('hi');
  });

  it('returns a synchronous linker — calling linker(scope) returns the node immediately', () => {
    const { $compile, cache } = compileWith(($cp) => {
      $cp.directive('myDir', ddoFactory({ templateUrl: '/tpl.html' }));
    });
    cache.put('/tpl.html', '<p>sync</p>');

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    const linker = $compile(host);
    expect(typeof linker).toBe('function');
    const result = linker(Scope.create());
    // Public Linker returns the host node reference synchronously
    // regardless of pending async work.
    expect(result).toBe(host);
    // Host children are empty until the drain resolves.
    expect(host.firstChild).toBeNull();
  });

  it('subsequent compiles of the SAME templateUrl reuse the cache (no extra fetch)', async () => {
    resetRegistry();
    const fetcher = vi.fn<TemplateFetcher>(() => Promise.resolve('<p>fromFetcher</p>'));
    bootstrapNgModule({ fetcher });
    const { $compile } = compileWith(($cp) => {
      $cp.directive('myDir', ddoFactory({ templateUrl: '/tpl.html' }));
    });

    const host1 = document.createElement('div');
    host1.setAttribute('my-dir', '');
    $compile(host1)(Scope.create());
    await flushMicrotasks();
    expect(host1.firstElementChild?.textContent).toBe('fromFetcher');
    expect(fetcher).toHaveBeenCalledTimes(1);

    const host2 = document.createElement('div');
    host2.setAttribute('my-dir', '');
    $compile(host2)(Scope.create());
    await flushMicrotasks();
    expect(host2.firstElementChild?.textContent).toBe('fromFetcher');
    expect(fetcher).toHaveBeenCalledTimes(1); // still 1 — cache hit
  });

  it('concurrent compiles before the first fetch resolves SHARE the in-flight request', async () => {
    resetRegistry();
    let resolveFetcher!: (text: string) => void;
    const fetcher = vi.fn<TemplateFetcher>(
      () =>
        new Promise<string>((resolve) => {
          resolveFetcher = resolve;
        }),
    );
    bootstrapNgModule({ fetcher });
    const { $compile } = compileWith(($cp) => {
      $cp.directive('myDir', ddoFactory({ templateUrl: '/tpl.html' }));
    });

    const host1 = document.createElement('div');
    host1.setAttribute('my-dir', '');
    const host2 = document.createElement('div');
    host2.setAttribute('my-dir', '');

    $compile(host1)(Scope.create());
    $compile(host2)(Scope.create());

    // Both drains schedule and call $templateRequest; the second sees
    // the in-flight promise and reuses it.
    await Promise.resolve(); // flush drain schedule
    await Promise.resolve(); // flush per-entry await templateRequest()
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolveFetcher('<p>shared</p>');
    await flushMicrotasks();

    expect(host1.firstElementChild?.textContent).toBe('shared');
    expect(host2.firstElementChild?.textContent).toBe('shared');
  });

  it('post-link runs against the fetched template — child directives inside the template register', async () => {
    const childLink = vi.fn<LinkFn>();
    const { $compile, cache } = compileWith(($cp) => {
      $cp.directive('myDir', ddoFactory({ templateUrl: '/tpl.html' }));
      $cp.directive('childDir', ddoFactory({ link: childLink }));
    });
    cache.put('/tpl.html', '<child-dir></child-dir>');

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());
    await flushMicrotasks();

    expect(childLink).toHaveBeenCalledTimes(1);
  });

  it("the host directive's own `link` runs against the post-template DOM", async () => {
    const observed: { firstChildTag: string | undefined } = { firstChildTag: undefined };
    const { $compile, cache } = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          templateUrl: '/tpl.html',
          link: (_scope, el) => {
            observed.firstChildTag = el.firstElementChild?.tagName;
          },
        }),
      );
    });
    cache.put('/tpl.html', '<p>installed</p>');

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());
    await flushMicrotasks();

    expect(observed.firstChildTag).toBe('P');
  });
});

describe('async templateUrl install — function form (FS §2.4)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('resolves the URL from attributes via the function form', async () => {
    const { $compile, cache } = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          templateUrl: (_el, attrs) => {
            const kind = attrs['kind'];
            return `/tpl/${typeof kind === 'string' ? kind : 'default'}.html`;
          },
        }),
      );
    });
    cache.put('/tpl/card.html', '<p>card-tpl</p>');

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    host.setAttribute('kind', 'card');
    $compile(host)(Scope.create());
    await flushMicrotasks();

    expect(host.firstElementChild?.textContent).toBe('card-tpl');
  });

  it('is called EXACTLY ONCE per compile invocation', async () => {
    const spy = vi.fn<TemplateUrlFn>(() => '/tpl.html');
    const { $compile, cache } = compileWith(($cp) => {
      $cp.directive('myDir', ddoFactory({ templateUrl: spy }));
    });
    cache.put('/tpl.html', '<p>once</p>');

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());
    await flushMicrotasks();

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('async templateUrl install — error handling (FS §2.4 + §2.12)', () => {
  it('routes TemplateUrlFunctionReturnedNonStringError for a non-string return; host stays empty', async () => {
    const handler = vi.fn<(...args: unknown[]) => void>();
    resetRegistry();
    bootstrapNgModule({ exceptionHandler: handler });
    const { $compile } = compileWith(($cp) => {
      $cp.directive('myDir', ddoFactory({ templateUrl: (() => 42 as unknown as string) as TemplateUrlFn }));
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());
    await flushMicrotasks();

    expect(host.firstChild).toBeNull();
    expect(handler).toHaveBeenCalled();
    const call = handler.mock.calls.find(([err]) => err instanceof TemplateUrlFunctionReturnedNonStringError);
    expect(call).toBeDefined();
    expect(call?.[1]).toBe('$compile');
  });

  it('routes the thrown error for a function that throws; host stays empty; siblings continue', async () => {
    const handler = vi.fn<(...args: unknown[]) => void>();
    resetRegistry();
    bootstrapNgModule({ exceptionHandler: handler });
    const siblingLink = vi.fn<LinkFn>();
    const boom = new Error('templateUrl boom');
    const { $compile } = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          templateUrl: (() => {
            throw boom;
          }) as TemplateUrlFn,
        }),
      );
      $cp.directive('sibling', ddoFactory({ link: siblingLink }));
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    host.setAttribute('sibling', '');
    $compile(host)(Scope.create());
    await flushMicrotasks();

    expect(host.firstChild).toBeNull();
    expect(handler).toHaveBeenCalled();
    const call = handler.mock.calls.find(([err]) => err === boom);
    expect(call).toBeDefined();
    expect(siblingLink).toHaveBeenCalled();
  });

  it('routes TemplateFetchFailedError on non-2xx HTTP / fetcher rejection; host stays empty', async () => {
    const handler = vi.fn<(...args: unknown[]) => void>();
    resetRegistry();
    const fetcher = vi.fn<TemplateFetcher>((url) => Promise.reject(new TemplateFetchFailedError(url, '404 Not Found')));
    bootstrapNgModule({ fetcher, exceptionHandler: handler });
    const { $compile } = compileWith(($cp) => {
      $cp.directive('myDir', ddoFactory({ templateUrl: '/missing.html' }));
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());
    await flushMicrotasks();

    expect(host.firstChild).toBeNull();
    expect(handler).toHaveBeenCalled();
    const call = handler.mock.calls.find(([err]) => err instanceof TemplateFetchFailedError);
    expect(call).toBeDefined();
    expect(call?.[1]).toBe('$compile');
  });

  it('a fetch failure on one subtree does not block sibling subtrees', async () => {
    const handler = vi.fn<(...args: unknown[]) => void>();
    resetRegistry();
    const fetcher = vi.fn<TemplateFetcher>((url) => {
      if (url === '/bad.html') {
        return Promise.reject(new TemplateFetchFailedError(url, '500 Internal Server Error'));
      }
      return Promise.resolve('<p>good-content</p>');
    });
    bootstrapNgModule({ fetcher, exceptionHandler: handler });
    const { $compile } = compileWith(($cp) => {
      $cp.directive('badDir', ddoFactory({ templateUrl: '/bad.html' }));
      $cp.directive('goodDir', ddoFactory({ templateUrl: '/good.html' }));
    });

    const bad = document.createElement('div');
    bad.setAttribute('bad-dir', '');
    const good = document.createElement('div');
    good.setAttribute('good-dir', '');

    $compile(bad)(Scope.create());
    $compile(good)(Scope.create());
    await flushMicrotasks();

    expect(bad.firstChild).toBeNull();
    expect(good.firstElementChild?.textContent).toBe('good-content');
  });
});

describe('async templateUrl — disjoint subtree independence + host destroy (FS §2.11)', () => {
  it('two templateUrl directives in disjoint subtrees resolve independently', async () => {
    resetRegistry();
    let resolveFast!: (text: string) => void;
    let resolveSlow!: (text: string) => void;
    const fetcher = vi.fn<TemplateFetcher>(
      (url) =>
        new Promise<string>((resolve) => {
          if (url === '/fast.html') {
            resolveFast = resolve;
          } else {
            resolveSlow = resolve;
          }
        }),
    );
    bootstrapNgModule({ fetcher });
    const { $compile } = compileWith(($cp) => {
      $cp.directive('fastDir', ddoFactory({ templateUrl: '/fast.html' }));
      $cp.directive('slowDir', ddoFactory({ templateUrl: '/slow.html' }));
    });

    const fast = document.createElement('div');
    fast.setAttribute('fast-dir', '');
    const slow = document.createElement('div');
    slow.setAttribute('slow-dir', '');
    $compile(fast)(Scope.create());
    $compile(slow)(Scope.create());

    await Promise.resolve();
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(2);

    resolveFast('<p>fast</p>');
    await flushMicrotasks();
    expect(fast.firstElementChild?.textContent).toBe('fast');
    expect(slow.firstChild).toBeNull(); // slow still pending

    resolveSlow('<p>slow</p>');
    await flushMicrotasks();
    expect(slow.firstElementChild?.textContent).toBe('slow');
  });

  it('host destroyed before resolve — template install is silently dropped', async () => {
    resetRegistry();
    bootstrapNgModule();
    const { $compile, cache } = compileWith(($cp) => {
      $cp.directive('myDir', ddoFactory({ templateUrl: '/tpl.html', scope: true }));
    });
    cache.put('/tpl.html', '<p>should-not-appear</p>');

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());

    // Destroy the element's scope BEFORE the drain resolves.
    destroyElementScope(host);

    await flushMicrotasks();

    expect(host.firstChild).toBeNull();
  });

  it('OUTER scope destroyed before resolve — template install is silently dropped', async () => {
    resetRegistry();
    bootstrapNgModule();
    const { $compile, cache } = compileWith(($cp) => {
      $cp.directive('myDir', ddoFactory({ templateUrl: '/tpl.html' }));
    });
    cache.put('/tpl.html', '<p>should-not-appear</p>');

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    // Build a child scope of root so we can destroy it without
    // touching the root's children list directly.
    const rootScope = Scope.create();
    const outer = rootScope.$new();
    $compile(host)(outer);

    outer.$destroy();
    await flushMicrotasks();

    expect(host.firstChild).toBeNull();
  });
});
