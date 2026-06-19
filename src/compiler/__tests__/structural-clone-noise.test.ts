/**
 * Zero-noise clone re-linking — structural directives no longer re-run
 * on their own clones (spec 032 Slice 1 / FS §2.2).
 *
 * Before spec 032 the element-transclude re-entrancy guard in
 * `compile.ts` STRIPPED only `transclude` on the re-entrant master pass,
 * leaving the structural directive's `link` in the clone's linker. As a
 * result `ng-repeat` / `ng-if` / `ng-switch` children / `ng-include`
 * re-ran their link against a cloned `Element` and threw
 * "expected placeholder to be a Comment" on EVERY row / mount. The throw
 * was caught and routed via `$exceptionHandler('$compile')`, so the
 * visible DOM was correct — but a correct, ordinary structural-directive
 * page polluted the app's error handler with framework-internal noise on
 * completely normal usage.
 *
 * Spec 032 Slice 1 EXCLUDES the structural directive entirely from the
 * re-entrant master's directive list (it contributes no compile / link /
 * controller to the clone). This file is the exact measurement that
 * surfaced the bug during spec 031 verification: it spies BOTH the
 * injected `$exceptionHandler` (the handler the compiler resolves from
 * the injector — last-wins, so the `app`-module override catches the
 * compile-path throws) AND `console.error` as a backstop, then asserts
 * ZERO "expected placeholder" errors and ZERO total handler calls for
 * correct `ng-repeat` / `ng-if` / `ng-switch` / `ng-include` usage —
 * while ALSO asserting the DOM output, live updates, and teardown stay
 * correct (proving the fix removed only the noise, not behavior).
 *
 * Bootstrap mirrors the `ng-if.test.ts` / `ng-include.test.ts` pattern
 * (production `ngModule` for the built-in directives + an `app` module
 * carrying the spy `$exceptionHandler` and an optional mock fetcher).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import { createTemplateCache } from '@template/template-cache';
import { createTemplateRequest } from '@template/template-request';
import type { TemplateCacheService, TemplateFetcher, TemplateRequestFn } from '@template/template-types';

interface HandlerCall {
  error: unknown;
  cause: unknown;
}

interface Bootstrap {
  $compile: CompileService;
  /** Every call routed through the injected `$exceptionHandler`. */
  handlerCalls: HandlerCall[];
}

interface BootstrapOptions {
  /** Custom fetcher injected into `$templateRequest` (ng-include). */
  fetcher?: TemplateFetcher;
}

/**
 * Builds an injector wired with the production `ngModule` (so the built-in
 * structural directives are reachable) plus an `app` module whose
 * last-wins `$exceptionHandler` is a recording spy. The compiler resolves
 * `$exceptionHandler` from the injector inside `$CompileProvider.$get`, so
 * the clone re-link throw — were it still emitted — would land in
 * `handlerCalls`.
 */
function bootstrap(options?: BootstrapOptions): Bootstrap {
  const fetcher = options?.fetcher;
  const handlerCalls: HandlerCall[] = [];

  resetRegistry();

  // Local `'ng'` registry entry so `app.requires = ['ng']` resolves; the
  // PRODUCTION `ngModule` passed to `createInjector` contributes the
  // spec-027 directives. Mirrors `ng-include.test.ts`.
  createModule('ng', [])
    .factory('$exceptionHandler', [() => (): void => undefined])
    .provider('$sceDelegate', $SceDelegateProvider)
    .provider('$sce', $SceProvider)
    .provider('$interpolate', $InterpolateProvider)
    .provider('$filter', ['$provide', $FilterProvider])
    .factory('$templateCache', [() => createTemplateCache()])
    .factory('$templateRequest', [
      '$templateCache',
      (cache: TemplateCacheService): TemplateRequestFn => createTemplateRequest({ cache, fetcher }),
    ])
    .provider('$compile', ['$provide', $CompileProvider]);

  const appModule = createModule('structuralCloneNoiseApp', ['ng']);
  appModule.factory('$exceptionHandler', [
    () =>
      (error: unknown, cause: unknown): void => {
        handlerCalls.push({ error, cause });
      },
  ]);
  if (fetcher !== undefined) {
    appModule.factory('$templateRequest', [
      '$templateCache',
      (cache: TemplateCacheService): TemplateRequestFn => createTemplateRequest({ cache, fetcher }),
    ]);
  }

  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get('$compile'),
    handlerCalls,
  };
}

/** Drain three microtasks (matches `ng-include.test.ts`'s defensive flush). */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** Count handler calls whose error message mentions "expected placeholder". */
function placeholderNoise(calls: readonly HandlerCall[]): number {
  return calls.filter((c) => c.error instanceof Error && /expected placeholder/i.test(c.error.message)).length;
}

/**
 * Backstop capture for `console.error` — the default `$exceptionHandler`
 * logs through `console.error`, so spying it covers the case where a
 * structural directive resolves a DIFFERENT handler instance than the
 * `app`-module spy. Each call's arguments are captured into this array
 * by the `mockImplementation` callback (avoids reading the loosely-typed
 * `.mock.calls` surface).
 */
const consoleErrorArgs: unknown[][] = [];
const originalConsoleError = console.error.bind(console);

/** Count captured `console.error` calls mentioning "expected placeholder". */
function consoleErrorPlaceholderNoise(): number {
  return consoleErrorArgs.filter((args) =>
    args.some((a) => a instanceof Error && /expected placeholder/i.test(a.message)),
  ).length;
}

beforeEach(() => {
  consoleErrorArgs.length = 0;
  console.error = (...args: unknown[]): void => {
    consoleErrorArgs.push(args);
  };
});

afterEach(() => {
  console.error = originalConsoleError;
  resetRegistry();
});

// ---------------------------------------------------------------------------
// ng-repeat
// ---------------------------------------------------------------------------

describe('zero-noise — ng-repeat rendering rows (FS §2.2)', () => {
  it('renders N rows with correct text and invokes the error handler zero times', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.xs = ['a', 'b', 'c'];

    const parent = document.createElement('ul');
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'x in xs');
    host.textContent = '{{x}}';
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    const rows = parent.querySelectorAll('li');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toBe('a');
    expect(rows[1]?.textContent).toBe('b');
    expect(rows[2]?.textContent).toBe('c');

    // The fix: zero "expected placeholder" noise + zero total handler calls.
    expect(placeholderNoise(b.handlerCalls)).toBe(0);
    expect(b.handlerCalls).toHaveLength(0);
    expect(consoleErrorPlaceholderNoise()).toBe(0);
  });

  it('stays noise-free across add / remove / reorder updates', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const xs: string[] = ['a', 'b', 'c'];
    scope.xs = xs;

    const parent = document.createElement('ul');
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'x in xs');
    host.textContent = '{{x}}';
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    // Add.
    xs.push('d');
    scope.$digest();
    expect(parent.querySelectorAll('li')).toHaveLength(4);

    // Reorder.
    scope.xs = ['d', 'c', 'b', 'a'];
    scope.$digest();
    const reordered = parent.querySelectorAll('li');
    expect(Array.from(reordered).map((li) => li.textContent)).toEqual(['d', 'c', 'b', 'a']);

    // Remove.
    scope.xs = ['d'];
    scope.$digest();
    expect(parent.querySelectorAll('li')).toHaveLength(1);

    expect(placeholderNoise(b.handlerCalls)).toBe(0);
    expect(b.handlerCalls).toHaveLength(0);
    expect(consoleErrorPlaceholderNoise()).toBe(0);
  });

  it('preserves reused-row input node identity + form value across a reorder (behavior unchanged)', () => {
    // FS §2.9 AC9.1 surrogate: jsdom's `insertBefore` blurs the moved
    // node, so `document.activeElement` cannot be asserted directly
    // (the established `ng-repeat.test.ts` precedent `it.skip`s that
    // exact assertion). Node-identity preservation + the typed form
    // value surviving the reorder is the reliable proxy — and it is the
    // exact behavior the spec-032 fix must NOT regress.
    const b = bootstrap();
    const scope = Scope.create();
    scope.xs = ['a', 'b'];

    const parent = document.createElement('ul');
    document.body.appendChild(parent);
    const host = document.createElement('li');
    host.setAttribute('ng-repeat', 'x in xs');
    const staticInput = document.createElement('input');
    staticInput.className = 'row-input';
    host.appendChild(staticInput);
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    const firstInput = parent.querySelectorAll<HTMLInputElement>('input.row-input')[0];
    if (firstInput === undefined) {
      throw new Error('expected the first row to render an <input>');
    }
    firstInput.value = 'typed';

    // Reorder — the 'a' row (with the user-typed input) moves to the end.
    scope.xs = ['b', 'a'];
    scope.$digest();

    const afterInputs = parent.querySelectorAll<HTMLInputElement>('input.row-input');
    expect(afterInputs).toHaveLength(2);
    // The reused 'a' row is now last; its input node identity AND the
    // user-entered value are preserved (the row was MOVED, not rebuilt).
    expect(afterInputs[1]).toBe(firstInput);
    expect(afterInputs[1]?.value).toBe('typed');

    expect(placeholderNoise(b.handlerCalls)).toBe(0);
    expect(b.handlerCalls).toHaveLength(0);
    expect(consoleErrorPlaceholderNoise()).toBe(0);

    parent.remove();
  });
});

// ---------------------------------------------------------------------------
// ng-if
// ---------------------------------------------------------------------------

describe('zero-noise — ng-if mount → update → teardown (FS §2.2)', () => {
  it('mounts, live-updates, tears down, and invokes the error handler zero times', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = true;
    scope.name = 'World';

    const parent = document.createElement('div');
    const host = document.createElement('span');
    host.setAttribute('ng-if', 'show');
    host.textContent = 'Hello {{name}}';
    parent.appendChild(host);

    b.$compile(host)(scope);

    // Mount.
    scope.$digest();
    expect(parent.querySelector('span')?.textContent).toBe('Hello World');

    // Update inner value.
    scope.name = 'Angular';
    scope.$digest();
    expect(parent.querySelector('span')?.textContent).toBe('Hello Angular');

    // Teardown.
    scope.show = false;
    scope.$digest();
    expect(parent.querySelector('span')).toBeNull();

    expect(placeholderNoise(b.handlerCalls)).toBe(0);
    expect(b.handlerCalls).toHaveLength(0);
    expect(consoleErrorPlaceholderNoise()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ng-switch
// ---------------------------------------------------------------------------

describe('zero-noise — ng-switch case switching (FS §2.2)', () => {
  it('switches cases correctly and invokes the error handler zero times', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.x = 'A';

    const host = document.createElement('div');
    host.setAttribute('ng-switch', 'x');
    const whenA = document.createElement('div');
    whenA.setAttribute('ng-switch-when', 'A');
    const aMark = document.createElement('span');
    aMark.className = 'case-a';
    aMark.textContent = 'a';
    whenA.appendChild(aMark);
    const whenB = document.createElement('div');
    whenB.setAttribute('ng-switch-when', 'B');
    const bMark = document.createElement('span');
    bMark.className = 'case-b';
    bMark.textContent = 'b';
    whenB.appendChild(bMark);
    host.appendChild(whenA);
    host.appendChild(whenB);

    b.$compile(host)(scope);
    scope.$digest();
    expect(host.querySelector('.case-a')).not.toBeNull();
    expect(host.querySelector('.case-b')).toBeNull();

    // Switch.
    scope.x = 'B';
    scope.$digest();
    expect(host.querySelector('.case-a')).toBeNull();
    expect(host.querySelector('.case-b')).not.toBeNull();

    // Switch back.
    scope.x = 'A';
    scope.$digest();
    expect(host.querySelector('.case-a')).not.toBeNull();
    expect(host.querySelector('.case-b')).toBeNull();

    expect(placeholderNoise(b.handlerCalls)).toBe(0);
    expect(b.handlerCalls).toHaveLength(0);
    expect(consoleErrorPlaceholderNoise()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ng-include
// ---------------------------------------------------------------------------

describe('zero-noise — ng-include loading a template (FS §2.2)', () => {
  it('loads and renders a cached template and invokes the error handler zero times', async () => {
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

    expect(parent.querySelector('.loaded')?.textContent).toBe('OK');

    expect(placeholderNoise(b.handlerCalls)).toBe(0);
    expect(b.handlerCalls).toHaveLength(0);
    expect(consoleErrorPlaceholderNoise()).toBe(0);
  });
});
