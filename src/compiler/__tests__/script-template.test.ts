/**
 * `script` — inline `text/ng-template` registration directive (spec 030
 * Slice 1 / FS §2.1).
 *
 * Locks the slice-1 surface for the built-in `script` directive
 * registered on the production `ngModule`:
 *
 * - Registration sanity: `injector.has('scriptDirective') === true` when
 *   an app's module declares `'ng'` in its deps chain.
 * - Cache population: a `<script type="text/ng-template" id="…">` block
 *   registers its VERBATIM `textContent` under `id` into `$templateCache`
 *   at compile time (NOT interpolated in place).
 * - End-to-end FS §2.1 canonical case: an inline template + a
 *   `<div ng-include="'name'">` elsewhere renders the interpolated
 *   content — with ZERO network calls (cache-first resolution proven by
 *   a fetcher spy that is never invoked).
 * - The `<script>` element renders nothing where it stands — it is left
 *   inert in the DOM, its body never displayed as live output.
 * - A `templateUrl` directive whose URL matches an inline-registered
 *   name resolves the inline content with no fetch.
 * - No-`id` silence: a `<script type="text/ng-template">` with no `id`
 *   registers nothing and produces no `$exceptionHandler` call.
 * - Non-`text/ng-template` scripts (e.g. `text/javascript`, no `type`)
 *   are left untouched — nothing registered.
 * - Last-wins replacement: two `id="dup"` blocks resolve to the LATER
 *   block's content (`$templateCache.put` overwrites).
 *
 * Async test discipline — `ngInclude` / `templateUrl` resolution chains
 * onto `$templateRequest(...).then(...)`. After triggering a load we
 * `await` three `Promise.resolve()` cycles to flush the microtask queue
 * (matches the `ng-include.test.ts` / `template-url.test.ts` precedent).
 *
 * Tests use the canonical production `ngModule` so the `script`
 * directive registered by `src/core/ng-module.ts` is reachable
 * end-to-end — the `ng-include.test.ts` bootstrap pattern (fetcher-spy
 * override + injector handle), so the fetcher can be asserted untouched.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService, DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
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
  get: (name: string) => unknown;
}

interface Bootstrap {
  $compile: CompileService;
  injector: InjectorLike;
}

interface BootstrapOptions {
  /** Custom fetcher injected into `$templateRequest` — spied to prove ZERO network calls. */
  fetcher?: TemplateFetcher;
  /** Spy `$exceptionHandler` registered on the `app` module. */
  exceptionHandler?: ExceptionHandler;
  /** Additional registration against the `app` module. */
  register?: (appModule: AnyModule) => void;
}

/**
 * Flush microtasks until the `ngInclude` / `templateUrl` resolution
 * chain (drain schedule → `$templateRequest` resolution → post-template
 * linker / clone install) has fully settled. Three cycles are defensive
 * against minor variations across the cache-hit vs cache-miss paths.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Bootstrap an injector wired with the production `ngModule` (so the
 * spec-030 Slice 1 `script` directive registered there is reachable
 * end-to-end). When a custom `fetcher` is supplied, the `app` module
 * overrides `$templateRequest` via `module.factory(...)` — services are
 * last-wins, so the override takes effect everywhere `$templateRequest`
 * is injected. Crucially, the override reuses the SAME injected
 * `$templateCache`, so an inline `<script>`-registered entry written by
 * the `script` directive is visible to the overridden request (the
 * cache-first short-circuit fires and the fetcher is never called).
 *
 * Mirrors the `ng-include.test.ts` bootstrap shape.
 */
function bootstrap(options?: BootstrapOptions): Bootstrap {
  const fetcher = options?.fetcher;
  resetRegistry();

  // Local `'ng'` re-registration so `appModule.requires = ['ng']`
  // resolves via the module registry. The PRODUCTION `ngModule`
  // (passed directly to `createInjector` below) is what actually
  // contributes the spec-030 `script` directive + canonical providers.
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

  const appModule = createModule('app-script-template', ['ng']);
  if (options?.exceptionHandler !== undefined) {
    const handler = options.exceptionHandler;
    appModule.factory('$exceptionHandler', [() => handler]);
  }
  if (fetcher !== undefined) {
    // Last-wins override of `$templateRequest`, reusing the injected
    // `$templateCache` so inline registrations are cache-visible.
    appModule.factory('$templateRequest', [
      '$templateCache',
      (cache: TemplateCacheService): TemplateRequestFn => createTemplateRequest({ cache, fetcher }),
    ]);
  }
  if (options?.register !== undefined) {
    options.register(appModule);
  }
  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get<CompileService>('$compile'),
    injector: built,
  };
}

/** Build a `<script type="text/ng-template" id="…">…body…</script>` element. */
function makeScript(type: string | null, id: string | null, body: string): HTMLScriptElement {
  const element = document.createElement('script');
  if (type !== null) {
    element.setAttribute('type', type);
  }
  if (id !== null) {
    element.setAttribute('id', id);
  }
  element.textContent = body;
  return element;
}

afterEach(() => {
  resetRegistry();
});

// ---------------------------------------------------------------------------
// 1. Registration & DI
// ---------------------------------------------------------------------------

describe('script — registration on ngModule (spec 030 Slice 1)', () => {
  it('injector.has("scriptDirective") === true when "ng" is in the deps chain', () => {
    const b = bootstrap();
    expect(b.injector.has('scriptDirective')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Cache population (FS §2.1)
// ---------------------------------------------------------------------------

describe('script — inline text/ng-template cache population (FS §2.1)', () => {
  it('registers the VERBATIM textContent under the id at compile time', () => {
    const b = bootstrap();
    const cache = b.injector.get('$templateCache') as TemplateCacheService;

    const element = makeScript('text/ng-template', 'hello.html', 'Hello {{name}}!');
    b.$compile(element)(Scope.create());

    // The body is stored verbatim — NOT interpolated in place.
    expect(cache.get('hello.html')).toBe('Hello {{name}}!');
  });
});

// ---------------------------------------------------------------------------
// 3. End-to-end via ng-include with ZERO network calls (FS §2.1)
// ---------------------------------------------------------------------------

describe('script — end-to-end inline template resolved by ng-include (FS §2.1)', () => {
  it('renders the inline template with name bound and NEVER calls the fetcher', async () => {
    const fetcher = vi.fn<TemplateFetcher>(() => Promise.resolve('<p class="from-net">FROM NETWORK</p>'));
    const b = bootstrap({ fetcher });
    const scope = Scope.create();
    scope.name = 'Igor';

    // Inline registration: the <script> writes its body into
    // $templateCache under 'hello.html' at compile time. The body uses
    // `ng-bind` because this compiler has no text-node interpolation —
    // `{{name}}` in a plain text node never renders, so the FS §2.1
    // "renders the inline content" claim is exercised through the
    // directive surface (the registered string is the load-bearing part).
    const container = document.createElement('div');
    container.appendChild(
      makeScript('text/ng-template', 'hello.html', '<span class="greeting">Hello <b ng-bind="name"></b>!</span>'),
    );
    const include = document.createElement('div');
    include.setAttribute('ng-include', "'hello.html'");
    container.appendChild(include);

    b.$compile(container)(scope);
    scope.$digest();
    await flushMicrotasks();
    scope.$digest();

    // Assert against the ng-include-rendered subtree specifically — the
    // inert `<script>` body is also in `container.textContent`, so scope
    // the assertion to the live output.
    expect(container.querySelector('.greeting')?.textContent).toBe('Hello Igor!');
    // Cache-first resolution: the inline registration short-circuits the
    // fetch entirely — the network fetcher is never reached.
    expect(fetcher).not.toHaveBeenCalled();
    expect(container.querySelector('.from-net')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. The <script> element renders nothing where it stands (FS §2.1)
// ---------------------------------------------------------------------------

describe('script — the element is inert where it stands (FS §2.1)', () => {
  it('leaves the script element in the DOM and shows no live output for its body', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.name = 'Igor';

    const container = document.createElement('div');
    const script = makeScript('text/ng-template', 'inert.html', 'Hello {{name}}!');
    container.appendChild(script);

    b.$compile(container)(scope);
    scope.$digest();

    // The element stays in the DOM untouched.
    expect(script.parentElement).toBe(container);
    expect(container.querySelector('script')).toBe(script);
    // Its body is structurally inert — the `{{name}}` is NOT interpolated
    // (terminal: true halts the compiler's descent into the body), so no
    // live "Hello Igor!" appears from the script itself.
    expect(script.textContent).toBe('Hello {{name}}!');
    expect(container.textContent).not.toContain('Hello Igor!');
  });
});

// ---------------------------------------------------------------------------
// 5. Resolution through a templateUrl directive (FS §2.1)
// ---------------------------------------------------------------------------

describe('script — inline template resolved by a templateUrl directive (FS §2.1)', () => {
  it('a templateUrl matching an inline-registered name renders the inline content', async () => {
    const fetcher = vi.fn<TemplateFetcher>(() => Promise.resolve('<p class="from-net">FROM NETWORK</p>'));
    const b = bootstrap({
      fetcher,
      register(appModule) {
        appModule.config([
          '$compileProvider',
          ($cp: $CompileProvider) => {
            const factory: DirectiveFactory = [
              (): DirectiveFactoryReturn => ({ templateUrl: 'widget.html' }),
            ] as DirectiveFactory;
            $cp.directive('myWidget', factory);
          },
        ]);
      },
    });
    const scope = Scope.create();
    scope.title = 'Inline';

    const container = document.createElement('div');
    // `ng-bind` body again — see the ng-include case for why text-node
    // `{{…}}` is not exercised here.
    container.appendChild(
      makeScript('text/ng-template', 'widget.html', '<span class="widget" ng-bind="title"></span>'),
    );
    const host = document.createElement('div');
    host.setAttribute('my-widget', '');
    container.appendChild(host);

    b.$compile(container)(scope);
    scope.$digest();
    await flushMicrotasks();
    scope.$digest();

    expect(host.querySelector('.widget')?.textContent).toBe('Inline');
    expect(fetcher).not.toHaveBeenCalled();
    expect(host.querySelector('.from-net')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. No-`id` silence (FS §2.1)
// ---------------------------------------------------------------------------

describe('script — missing id is a silent no-op (FS §2.1)', () => {
  it('registers nothing and produces no $exceptionHandler call', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const cache = b.injector.get('$templateCache') as TemplateCacheService;

    const element = makeScript('text/ng-template', null, 'x');
    b.$compile(element)(Scope.create());

    expect(cache.info().size).toBe(0);
    expect(cache.get('')).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it('an empty id="" is also a silent no-op', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const cache = b.injector.get('$templateCache') as TemplateCacheService;

    const element = makeScript('text/ng-template', '', 'x');
    b.$compile(element)(Scope.create());

    expect(cache.info().size).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. Non-`text/ng-template` scripts are untouched (FS §2.1)
// ---------------------------------------------------------------------------

describe('script — non-ng-template scripts are untouched (FS §2.1)', () => {
  it('type="text/javascript" registers nothing', () => {
    const handler = vi.fn<ExceptionHandler>();
    const b = bootstrap({ exceptionHandler: handler });
    const cache = b.injector.get('$templateCache') as TemplateCacheService;

    const element = makeScript('text/javascript', 'js.html', 'console.log(1)');
    b.$compile(element)(Scope.create());

    expect(cache.info().size).toBe(0);
    expect(cache.get('js.html')).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it('a script with no type attribute registers nothing', () => {
    const b = bootstrap();
    const cache = b.injector.get('$templateCache') as TemplateCacheService;

    const element = makeScript(null, 'notype.html', 'whatever');
    b.$compile(element)(Scope.create());

    expect(cache.info().size).toBe(0);
    expect(cache.get('notype.html')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8. Last-wins replacement (FS §2.1)
// ---------------------------------------------------------------------------

describe('script — last-wins replacement on duplicate id (FS §2.1)', () => {
  it('the later block content wins in the cache', () => {
    const b = bootstrap();
    const cache = b.injector.get('$templateCache') as TemplateCacheService;

    const container = document.createElement('div');
    container.appendChild(makeScript('text/ng-template', 'dup', 'FIRST'));
    container.appendChild(makeScript('text/ng-template', 'dup', 'SECOND'));

    b.$compile(container)(Scope.create());

    expect(cache.get('dup')).toBe('SECOND');
  });
});
