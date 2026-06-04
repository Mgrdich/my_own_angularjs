/**
 * `ngInclude` directive — async template inclusion
 * (spec 027 Slice 6 / FS §2.3).
 *
 * Locks the AngularJS-canonical behavior for the built-in `ngInclude`
 * directive registered on `ngModule`:
 *
 * - Registration sanity: `injector.has('ngIncludeDirective') === true`
 *   when an app's module declares `'ng'` in its deps chain.
 * - Attribute form `<div ng-include="'partials/x.html'">` and element
 *   form `<ng-include src="'partials/x.html'">` both fetch + render
 *   via the same factory; only the watched attribute differs.
 * - URL changes swap content: the old transclusion scope is destroyed
 *   and the old clone removed BEFORE the new template is fetched.
 * - Empty / null / undefined / non-string URLs clear the slot.
 * - Three scope-event emissions wrap the load cycle:
 *   `$includeContentRequested` (before fetch), `$includeContentLoaded`
 *   (after DOM install), `$includeContentError` (on any failure path).
 * - Fetch failures route via `$exceptionHandler('$compile')` AND the
 *   `$includeContentError` event AND clear the slot.
 * - Cache hits serve synchronously — a second load of the same URL
 *   does NOT call the fetcher again.
 * - Lazy `$sce` probe: cross-origin URLs that fail the trusted-
 *   resource-URL safelist throw from `getTrustedResourceUrl`; the
 *   throw is caught and routed via `$exceptionHandler('$compile')`,
 *   the `$includeContentError` event fires, and the slot clears.
 * - The optional `onload="expr"` modifier evaluates against the
 *   PARENT scope after each successful load.
 * - Stale-fetch sentinel: a fetch that resolves AFTER the surrounding
 *   scope was destroyed does NOT install a clone into the DOM.
 * - `terminal: true` blocks lower-priority same-element directives
 *   via the spec-017 same-element terminal cutoff.
 *
 * **Async test discipline.** The directive's resolve callback chains
 * onto `$templateRequest(...).then(...)`. After triggering a load (set
 * `scope.url = ...; scope.$digest()`), tests `await` two or three
 * `Promise.resolve()` cycles to flush the microtask queue. We use a
 * `flushMicrotasks` helper that drains three microtasks defensively
 * (matches `template-url.test.ts`'s precedent).
 *
 * **Mock fetcher pattern.** To override the default fetcher, the test
 * file re-registers `$templateRequest` on the `app` module via
 * `module.factory(...)` with a closure over a `vi.fn()` mock. For
 * deferred resolution (the stale-fetch test), the mock returns a
 * Promise the test resolves manually.
 *
 * Tests use the canonical `ngModule` so the `ngInclude` directive
 * registered by `src/core/ng-module.ts` is reachable end-to-end —
 * mirroring the `ng-if.test.ts` / `ng-switch.test.ts` bootstrap
 * patterns.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService, DirectiveFactory, DirectiveFactoryReturn, LinkFn } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { type AnyModule, createModule, resetRegistry } from '@di/module';
import type { ExceptionHandler } from '@exception-handler/index';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import { createTemplateCache } from '@template/template-cache';
import { createTemplateRequest } from '@template/template-request';
import type { TemplateCacheService, TemplateFetcher, TemplateRequestFn } from '@template/template-types';

interface InjectorLike {
  has: (name: string) => boolean;
}

interface Bootstrap {
  $compile: CompileService;
  injector: InjectorLike;
}

interface BootstrapOptions {
  /** Custom fetcher injected into `$templateRequest`. */
  fetcher?: TemplateFetcher;
  /** Spy `$exceptionHandler` registered on the `app` module. */
  exceptionHandler?: ExceptionHandler;
  /** Additional registration against the `app` module. */
  register?: (appModule: AnyModule) => void;
  /** Configure `$sceDelegateProvider` (e.g. trustedResourceUrlList). */
  configureSce?: (provider: $SceDelegateProvider) => void;
}

/**
 * Bootstrap an injector wired with the production `ngModule` (so the
 * spec-027 Slice 6 `ngInclude` directive registered there is reachable
 * end-to-end). When a custom `fetcher` is supplied, the `app` module
 * overrides `$templateRequest` via `module.factory(...)` — services
 * are last-wins, so the override takes effect everywhere
 * `$templateRequest` is injected (including inside `ngInclude`'s
 * factory). The `'ng'` module load itself is the production one; the
 * `app` module's `.factory('$templateRequest', …)` re-registration is
 * how a mock fetcher reaches the directive.
 *
 * Spy `$exceptionHandler` and `$sceDelegateProvider` configuration
 * also flow through the `app` module (last-wins for the former,
 * config-block for the latter).
 *
 * Mirrors the `ng-switch.test.ts` bootstrap shape but adds the
 * fetcher-override seam.
 */
function bootstrap(options?: BootstrapOptions): Bootstrap {
  const fetcher = options?.fetcher;
  resetRegistry();

  // Local `'ng'` re-registration so `appModule.requires = ['ng']`
  // resolves via the module registry. The PRODUCTION `ngModule`
  // (passed directly to `createInjector` below) is what actually
  // contributes the spec-027 directives + canonical providers —
  // this local re-registration is only the registry entry that
  // satisfies the `requires` lookup, mirroring the established
  // `ng-switch.test.ts` / `ng-if.test.ts` bootstrap pattern.
  createModule('ng', [])
    .factory('$exceptionHandler', [() => (): void => undefined])
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

  const appModule = createModule('app-ng-include', ['ng']);
  if (options?.exceptionHandler !== undefined) {
    const handler = options.exceptionHandler;
    appModule.factory('$exceptionHandler', [() => handler]);
  }
  if (fetcher !== undefined) {
    // Last-wins override of `$templateRequest`. The closure over the
    // mock fetcher reaches `ngInclude` because the injector hands the
    // override out to every `$templateRequest`-injecting consumer.
    appModule.factory('$templateRequest', [
      '$templateCache',
      (cache: TemplateCacheService): TemplateRequestFn => createTemplateRequest({ cache, fetcher }),
    ]);
  }
  if (options?.configureSce !== undefined) {
    const configureSce = options.configureSce;
    appModule.config([
      '$sceDelegateProvider',
      (provider: $SceDelegateProvider) => {
        configureSce(provider);
      },
    ]);
  }
  if (options?.register !== undefined) {
    options.register(appModule);
  }
  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get('$compile'),
    injector: built,
  };
}

/**
 * Drain three microtasks to ensure the directive's `then`-chain (lazy
 * `$sce` resolve → `$templateRequest` → resolve → `parseTemplate` →
 * `$compile` → install) has fully settled. Mirrors the
 * `template-url.test.ts` defensive 3x flush.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

afterEach(() => {
  resetRegistry();
});

// ---------------------------------------------------------------------------
// 1. Registration sanity
// ---------------------------------------------------------------------------

describe('ngInclude — registration on ngModule (spec 027 Slice 6)', () => {
  it('injector.has("ngIncludeDirective") === true when "ng" is in the deps chain', () => {
    const b = bootstrap();
    expect(b.injector.has('ngIncludeDirective')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2 + 3. Attribute form / element form — both load + render
// ---------------------------------------------------------------------------

describe('ngInclude — attribute form `<div ng-include="…">` (FS §2.3)', () => {
  it('fetches and renders the template inside the parent slot', async () => {
    const fetcher = vi.fn<TemplateFetcher>(() => Promise.resolve('<span class="loaded">OK</span>'));
    const b = bootstrap({ fetcher });
    const scope = Scope.create();
    scope.url = '/partials/x.html';

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-include', 'url');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    await flushMicrotasks();

    // Slice 2's `transclude: 'element'` foundation installed a Comment
    // placeholder where the host used to be; the directive then
    // appended the rendered template as the placeholder's next sibling.
    expect(parent.querySelector('.loaded')).not.toBeNull();
    expect(parent.querySelector('.loaded')?.textContent).toBe('OK');
    expect(fetcher).toHaveBeenCalledWith('/partials/x.html');
  });
});

describe('ngInclude — element form `<ng-include src="…">` (FS §2.3)', () => {
  it('fetches and renders the template via the `src` attribute', async () => {
    const fetcher = vi.fn<TemplateFetcher>(() => Promise.resolve('<span class="loaded">EL</span>'));
    const b = bootstrap({ fetcher });
    const scope = Scope.create();
    scope.url = '/partials/y.html';

    const parent = document.createElement('div');
    const host = document.createElement('ng-include');
    host.setAttribute('src', 'url');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    await flushMicrotasks();

    expect(parent.querySelector('.loaded')).not.toBeNull();
    expect(parent.querySelector('.loaded')?.textContent).toBe('EL');
    expect(fetcher).toHaveBeenCalledWith('/partials/y.html');
  });
});

// ---------------------------------------------------------------------------
// 4. URL change swaps content
// ---------------------------------------------------------------------------

describe('ngInclude — URL change swaps content (FS §2.3)', () => {
  it('tears down the previous clone and renders the new template on URL change', async () => {
    const fetcher = vi.fn<TemplateFetcher>((url: string) =>
      Promise.resolve(url === '/a.html' ? '<span class="a">A</span>' : '<span class="b">B</span>'),
    );
    const b = bootstrap({ fetcher });
    const scope = Scope.create();
    scope.url = '/a.html';

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-include', 'url');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();
    await flushMicrotasks();

    expect(parent.querySelector('.a')).not.toBeNull();
    expect(parent.querySelector('.b')).toBeNull();

    scope.url = '/b.html';
    scope.$digest();
    await flushMicrotasks();

    // Old clone gone, new clone present.
    expect(parent.querySelector('.a')).toBeNull();
    expect(parent.querySelector('.b')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. null / empty / undefined / non-string URL clears the slot
// ---------------------------------------------------------------------------

describe('ngInclude — empty/nullish URL clears the slot (FS §2.3)', () => {
  it('setting URL to null after a successful load removes the clone', async () => {
    const fetcher = vi.fn<TemplateFetcher>(() => Promise.resolve('<span class="loaded">OK</span>'));
    const b = bootstrap({ fetcher });
    const scope = Scope.create();
    scope.url = '/x.html';

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-include', 'url');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();
    await flushMicrotasks();
    expect(parent.querySelector('.loaded')).not.toBeNull();

    scope.url = null;
    scope.$digest();
    // Tear-down is synchronous on the watch-listener path; no
    // microtask flush is needed for the clear path.
    expect(parent.querySelector('.loaded')).toBeNull();
  });

  it('setting URL to an empty string removes the clone', async () => {
    const fetcher = vi.fn<TemplateFetcher>(() => Promise.resolve('<span class="loaded">OK</span>'));
    const b = bootstrap({ fetcher });
    const scope = Scope.create();
    scope.url = '/x.html';

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-include', 'url');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();
    await flushMicrotasks();
    expect(parent.querySelector('.loaded')).not.toBeNull();

    scope.url = '';
    scope.$digest();
    expect(parent.querySelector('.loaded')).toBeNull();
  });

  it('setting URL to undefined removes the clone', async () => {
    const fetcher = vi.fn<TemplateFetcher>(() => Promise.resolve('<span class="loaded">OK</span>'));
    const b = bootstrap({ fetcher });
    const scope = Scope.create();
    scope.url = '/x.html';

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-include', 'url');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();
    await flushMicrotasks();
    expect(parent.querySelector('.loaded')).not.toBeNull();

    scope.url = undefined;
    scope.$digest();
    expect(parent.querySelector('.loaded')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. $includeContentRequested fires before fetch
// ---------------------------------------------------------------------------

describe('ngInclude — $includeContentRequested event (FS §2.3)', () => {
  it('fires with the requested URL BEFORE the fetch resolves', async () => {
    // Use a deferred fetcher so we can observe the ordering — request
    // event must fire BEFORE the fetch promise settles.
    let resolveFetch!: (text: string) => void;
    const fetcher = vi.fn<TemplateFetcher>(
      () =>
        new Promise<string>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const b = bootstrap({ fetcher });
    const scope = Scope.create();
    const requested = vi.fn();
    scope.$on('$includeContentRequested', requested);
    scope.url = '/x.html';

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-include', 'url');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    // The request event must have fired by now — before any
    // microtask flush, BEFORE the fetcher resolves.
    expect(requested).toHaveBeenCalledTimes(1);
    const call = requested.mock.calls[0];
    expect(call).toBeDefined();
    // ScopeEvent at index 0, URL at index 1.
    expect(call?.[1]).toBe('/x.html');

    // Cleanup — resolve the pending fetch so it doesn't leak.
    resolveFetch('<span></span>');
    await flushMicrotasks();
  });
});

// ---------------------------------------------------------------------------
// 7. $includeContentLoaded fires after install
// ---------------------------------------------------------------------------

describe('ngInclude — $includeContentLoaded event (FS §2.3)', () => {
  it('fires with the loaded URL AFTER the DOM install', async () => {
    const fetcher = vi.fn<TemplateFetcher>(() => Promise.resolve('<span class="loaded">OK</span>'));
    const b = bootstrap({ fetcher });
    const scope = Scope.create();
    const loaded = vi.fn();
    scope.$on('$includeContentLoaded', loaded);
    scope.url = '/x.html';

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-include', 'url');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    // Not loaded yet — promise chain hasn't drained.
    expect(loaded).not.toHaveBeenCalled();

    await flushMicrotasks();

    expect(loaded).toHaveBeenCalledTimes(1);
    expect(loaded.mock.calls[0]?.[1]).toBe('/x.html');
    // DOM was installed BEFORE the event fired.
    expect(parent.querySelector('.loaded')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8 + 9. Fetch failure: $includeContentError + $exceptionHandler('$compile')
// ---------------------------------------------------------------------------

describe('ngInclude — fetch failure paths (FS §2.3)', () => {
  it('emits $includeContentError on fetch rejection and clears the slot', async () => {
    const fetcher: TemplateFetcher = () => Promise.reject(new Error('network down'));
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ fetcher, exceptionHandler: handler });
    const scope = Scope.create();
    const errorSpy = vi.fn();
    scope.$on('$includeContentError', errorSpy);
    scope.url = '/missing.html';

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-include', 'url');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();
    await flushMicrotasks();

    // $includeContentError was emitted with the failing URL.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[1]).toBe('/missing.html');

    // Slot is clear — no clone installed.
    expect(parent.querySelector('span')).toBeNull();
  });

  it('routes the fetch rejection via $exceptionHandler with cause "$compile"', async () => {
    const failure = new Error('boom');
    const fetcher: TemplateFetcher = () => Promise.reject(failure);
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ fetcher, exceptionHandler: handler });
    const scope = Scope.create();
    scope.url = '/missing.html';

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-include', 'url');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();
    await flushMicrotasks();

    // Find the call routed through the '$compile' cause.
    const compileCalls = handler.mock.calls.filter((call) => call[1] === '$compile');
    expect(compileCalls.length).toBe(1);
    expect(compileCalls[0]?.[0]).toBe(failure);
  });
});

// ---------------------------------------------------------------------------
// 10. Cache hit serves synchronously (fetcher called once)
// ---------------------------------------------------------------------------

describe('ngInclude — cache reuse across loads (FS §2.3)', () => {
  it('a second load of the same URL serves from $templateCache without re-calling the fetcher', async () => {
    const fetcher = vi.fn<TemplateFetcher>(() => Promise.resolve('<span class="loaded">OK</span>'));
    const b = bootstrap({ fetcher });
    const scope = Scope.create();
    scope.url = '/cached.html';

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-include', 'url');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();
    await flushMicrotasks();
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Swap to a different URL (so the watch fires when we go back) —
    // we don't care that this one would also fetch, only that the
    // counter is at 1 BEFORE we re-set to `/cached.html`.
    scope.url = null;
    scope.$digest();

    // Re-set to the same URL — $templateCache should serve.
    scope.url = '/cached.html';
    scope.$digest();
    await flushMicrotasks();

    // Fetcher count is still 1 — the second resolution came from cache.
    expect(fetcher).toHaveBeenCalledTimes(1);
    // And the template rendered again.
    expect(parent.querySelector('.loaded')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11. Lazy $sce probe — cross-origin URL rejected
// ---------------------------------------------------------------------------

describe('ngInclude — lazy $sce probe (FS §2.3)', () => {
  it('cross-origin URL rejected by $sce routes via $exceptionHandler("$compile") and emits $includeContentError', async () => {
    // Default `trustedResourceUrlList` is `['self']`; a cross-origin
    // URL (different scheme + host than jsdom's `http://localhost/`)
    // throws from `getTrustedResourceUrl`. We configure the SCE
    // delegate provider with the default explicitly to make the test
    // intent obvious. The fetcher is NOT called because the trust
    // check fires synchronously inside the watch listener.
    const fetcher = vi.fn<TemplateFetcher>(() => Promise.resolve('<span></span>'));
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({
      fetcher,
      exceptionHandler: handler,
      configureSce: (provider) => {
        provider.trustedResourceUrlList(['self']);
      },
    });
    const scope = Scope.create();
    const errorSpy = vi.fn();
    scope.$on('$includeContentError', errorSpy);
    scope.url = 'https://evil.example.com/x.html';

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-include', 'url');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();
    // Trust rejection is synchronous — no microtask flush needed for
    // the error path, but we drain defensively.
    await flushMicrotasks();

    // $exceptionHandler was called with cause '$compile'.
    const compileCalls = handler.mock.calls.filter((call) => call[1] === '$compile');
    expect(compileCalls.length).toBe(1);

    // $includeContentError fired with the rejected URL.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[1]).toBe('https://evil.example.com/x.html');

    // Fetcher was NOT invoked — the trust check fires before fetch.
    expect(fetcher).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 12. Lazy $sce probe — when $sce is absent
// ---------------------------------------------------------------------------

describe('ngInclude — lazy $sce probe (absence is not testable from the ng module)', () => {
  // `$sce` is registered on `ngModule` so it is always reachable when
  // `ngInclude` is. The lazy `$injector.has('$sce')` guard exists for
  // future stripped-down injectors (hypothetical SSR / Node) and is
  // exercised end-to-end via test #11's cross-origin trust rejection
  // (which proves the probe routes through `$sce.getTrustedResourceUrl`
  // when `$sce` IS present). Skipping per the task brief.
  it.skip("$sce-absent path is not testable from a configured 'ng' module — see test #11", () => undefined);
});

// ---------------------------------------------------------------------------
// 13. onload="counter = counter + 1" evaluates against PARENT scope
// ---------------------------------------------------------------------------

describe('ngInclude — onload modifier (FS §2.3)', () => {
  it('evaluates the onload expression against the PARENT scope after each successful load', async () => {
    const fetcher = vi.fn<TemplateFetcher>(() => Promise.resolve('<span class="loaded">OK</span>'));
    const b = bootstrap({ fetcher });
    const scope = Scope.create();
    scope.counter = 0;
    scope.url = '/x.html';

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-include', 'url');
    host.setAttribute('onload', 'counter = counter + 1');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();
    await flushMicrotasks();

    // PARENT scope's counter was incremented exactly once.
    expect(scope.counter).toBe(1);

    // Swap URL — second load triggers the onload expression again.
    scope.url = '/y.html';
    scope.$digest();
    await flushMicrotasks();
    expect(scope.counter).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 14. Stale-fetch sentinel
// ---------------------------------------------------------------------------

describe('ngInclude — stale-fetch sentinel (technical-considerations §2.4)', () => {
  it('does NOT install the clone when the surrounding scope is destroyed before the fetch resolves (FS §2.3)', async () => {
    // FS §2.3 acceptance criterion: a fetch that resolves AFTER the
    // surrounding scope was destroyed must NOT install a clone into
    // the DOM. The framework's `scope.$on('$destroy', clearCurrentClone)`
    // hook nulls the closure-local `currentLoadToken`, so when the
    // in-flight promise eventually resolves its `thisToken !==
    // currentLoadToken` check drops the install silently.
    let resolveFetch!: (text: string) => void;
    const fetcher = vi.fn<TemplateFetcher>(
      () =>
        new Promise<string>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const b = bootstrap({ fetcher });

    // A child scope hosts the directive so we can destroy the
    // SURROUNDING scope (the parent of the directive's link scope)
    // without tearing down `Scope.create()` itself — mirrors the
    // FS §2.3 phrasing "destroy the surrounding scope".
    const rootScope = Scope.create();
    const hostScope = rootScope.$new();
    hostScope.url = '/x.html';

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-include', 'url');
    parent.appendChild(host);

    b.$compile(host)(hostScope);
    hostScope.$digest();

    // The fetch is in flight — no install yet.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(parent.querySelector('.loaded')).toBeNull();

    // Destroy the surrounding scope BEFORE the fetch resolves. The
    // `$destroy` listener installed by the directive nulls
    // `currentLoadToken` so the stale resolve below is filtered.
    hostScope.$destroy();

    // Now resolve the in-flight (now-stale) fetch and let the
    // microtask chain drain.
    resolveFetch('<span class="loaded">STALE-AFTER-DESTROY</span>');
    await flushMicrotasks();

    // FS §2.3 acceptance: no clone installed, slot is empty. Without
    // the `$destroy` hook, the resolved fetch's `then` callback would
    // have inserted a `<div>` wrapper carrying `.loaded` next to the
    // placeholder comment.
    expect(parent.querySelector('.loaded')).toBeNull();
  });

  it('does NOT install the stale clone when the URL changes before the first fetch resolves', async () => {
    // The URL-transition path — when `scope.url` is reassigned before
    // the first fetch resolves, a second fetch starts and bumps the
    // closure-local `currentLoadToken`. The first fetch's resolve
    // callback sees `thisToken !== currentLoadToken` and drops the
    // install. Pinned alongside the scope-destroy path (the FS §2.3
    // acceptance criterion above) so both stale-fetch routes are
    // covered.
    let resolveFirst!: (text: string) => void;
    let resolveSecond!: (text: string) => void;
    let callIndex = 0;
    const fetcher = vi.fn<TemplateFetcher>(
      () =>
        new Promise<string>((resolve) => {
          callIndex += 1;
          if (callIndex === 1) {
            resolveFirst = resolve;
          } else {
            resolveSecond = resolve;
          }
        }),
    );
    const b = bootstrap({ fetcher });
    const scope = Scope.create();
    scope.url = '/a.html';

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-include', 'url');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    // First fetch is in flight — no install yet.
    expect(parent.querySelector('.loaded')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Bump URL BEFORE the first fetch resolves. The closure-local
    // `currentLoadToken` is replaced; the first fetch's resolve
    // callback will see `thisToken !== currentLoadToken` and drop
    // the install.
    scope.url = '/b.html';
    scope.$digest();
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Resolve the FIRST (now-stale) fetch — its resolve callback
    // must drop the install silently due to the token mismatch.
    resolveFirst('<span class="loaded">STALE-A</span>');
    await flushMicrotasks();

    // The stale resolve did NOT install anything.
    expect(parent.querySelector('.loaded')).toBeNull();

    // Resolve the SECOND fetch — its clone DOES install.
    resolveSecond('<span class="loaded">FRESH-B</span>');
    await flushMicrotasks();

    expect(parent.querySelector('.loaded')).not.toBeNull();
    expect(parent.querySelector('.loaded')?.textContent).toBe('FRESH-B');
  });
});

// ---------------------------------------------------------------------------
// 15. terminal: true blocks lower-priority same-element directives
// ---------------------------------------------------------------------------

describe('ngInclude — terminal: true (technical-considerations §2.4)', () => {
  it('lower-priority same-element directives are blocked by the spec-017 terminal cutoff', async () => {
    // `ngInclude` runs at priority 400 with `terminal: true`. A
    // sibling directive at priority 100 sits BELOW the terminal
    // threshold and is dropped from the matched-directive list before
    // any of its hooks (compile / link) run.
    const probeFired = vi.fn();
    const fetcher = vi.fn<TemplateFetcher>(() => Promise.resolve('<span></span>'));
    const b = bootstrap({
      fetcher,
      register: (appModule) => {
        appModule.config([
          '$compileProvider',
          ($cp: $CompileProvider) => {
            $cp.directive(
              'myOther',
              ddoFactory({
                restrict: 'A',
                priority: 100,
                link: (() => {
                  probeFired();
                }) as LinkFn,
              }),
            );
          },
        ]);
      },
    });
    const scope = Scope.create();
    scope.url = '/x.html';

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-include', 'url');
    host.setAttribute('my-other', '');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();
    await flushMicrotasks();

    // `myOther` was below the terminal threshold and never fired.
    expect(probeFired).not.toHaveBeenCalled();
  });
});
