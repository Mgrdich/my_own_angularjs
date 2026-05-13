/**
 * Consolidated template-loading error-surface tests (spec 019 Slice 7 /
 * FS §2.12).
 *
 * Per-feature error cases are already covered exhaustively by Slices 4,
 * 5, and 6 (`template-registration.test.ts`, `template-inline.test.ts`,
 * `template-url.test.ts`, `template-multi-directive.test.ts`). This file
 * covers the CROSS-CUTTING scenarios that don't fit cleanly into any
 * single feature suite:
 *
 * 1. Custom `$exceptionHandler` that itself throws — the spec-014
 *    `invokeExceptionHandler` recursion guard catches the handler's
 *    throw; template loading does NOT crash; falls back to
 *    `console.error`.
 * 2. `EXCEPTION_HANDLER_CAUSES.length === 10` regression — no new cause
 *    token introduced by spec 019; `'$compile'` covers every template
 *    error site.
 * 3. `'$compile' satisfies ExceptionHandlerCause` compile-time check.
 * 4. Each of the 10 new error classes routes via `'$compile'` cause —
 *    one minimal regression per class confirming the cause token. The
 *    error-detail tests live in Slices 4 / 5 / 6 test files; this is
 *    the cause-routing roll-up.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import {
  EmptyTemplateError,
  EmptyTemplateUrlError,
  InvalidTemplateUrlValueError,
  InvalidTemplateValueError,
  MultipleTemplateDirectivesError,
  ReplaceTrueNotSupportedError,
  TemplateAndTemplateUrlCombinedError,
  TemplateFetchFailedError,
  TemplateFunctionReturnedNonStringError,
  TemplateUrlFunctionReturnedNonStringError,
} from '@compiler/compile-error';
import type {
  CompileService,
  DirectiveFactory,
  DirectiveFactoryReturn,
  TemplateFn,
  TemplateUrlFn,
} from '@compiler/directive-types';
import { Scope } from '@core/index';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { EXCEPTION_HANDLER_CAUSES, type ExceptionHandlerCause } from '@exception-handler/index';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import { createTemplateCache } from '@template/template-cache';
import { createTemplateRequest } from '@template/template-request';
import type { TemplateCacheService, TemplateFetcher, TemplateRequestFn } from '@template/template-types';

type SpyHandler = ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

interface SpyHarnessOpts {
  fetcher?: TemplateFetcher;
  handler?: (...args: unknown[]) => void;
}

interface SpyHarness {
  handler: SpyHandler;
  build: (register: ($cp: $CompileProvider) => void) => { $compile: CompileService; cache: TemplateCacheService };
}

function bootstrapSpy(opts?: SpyHarnessOpts): SpyHarness {
  const handler = vi.fn<(...args: unknown[]) => void>();
  if (opts?.handler !== undefined) {
    handler.mockImplementation(opts.handler);
  }
  resetRegistry();
  createModule('ng', [])
    .factory('$exceptionHandler', [() => handler])
    .provider('$sceDelegate', $SceDelegateProvider)
    .provider('$sce', $SceProvider)
    .provider('$interpolate', $InterpolateProvider)
    .provider('$filter', ['$provide', $FilterProvider])
    .factory('$templateCache', [() => createTemplateCache()])
    .factory('$templateRequest', [
      '$templateCache',
      (cache: TemplateCacheService): TemplateRequestFn => createTemplateRequest({ cache, fetcher: opts?.fetcher }),
    ])
    .provider('$compile', ['$provide', $CompileProvider]);
  return {
    handler,
    build(register) {
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
    },
  };
}

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

function ddoFactoryUnsafe(returnValue: unknown): DirectiveFactory {
  return [() => returnValue as DirectiveFactoryReturn] as DirectiveFactory;
}

afterEach(() => {
  resetRegistry();
});

describe('template-loading error surface — handler degradation (FS §2.12 #8)', () => {
  it('custom $exceptionHandler that itself throws falls back to console.error; template loading does NOT crash', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      resetRegistry();
      createModule('ng', [])
        .factory('$exceptionHandler', [
          () => () => {
            throw new Error('handler exploded');
          },
        ])
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

      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          // Force a routed template error via a non-string template
          // value — the registration-phase rejection fires through the
          // factory try/catch and ends up at `$exceptionHandler`, which
          // itself throws.
          $cp.directive('myDir', ddoFactoryUnsafe({ template: 42, link: () => undefined }));
        },
      ]);
      const injector = createInjector([appModule]);

      // The recursion guard inside `invokeExceptionHandler` catches the
      // handler's own throw and falls back to `console.error`. The
      // injector lookup that fires the routing must NOT crash.
      expect(() => injector.get('myDirDirective')).not.toThrow();
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('handler-throw at template install time (function-form non-string) also degrades to console.error', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { build } = bootstrapSpy({
        handler: () => {
          throw new Error('handler exploded');
        },
      });
      const { $compile } = build(($cp) => {
        $cp.directive('myDir', ddoFactory({ template: (() => 42 as unknown as string) as TemplateFn }));
      });

      const host = document.createElement('div');
      host.setAttribute('my-dir', '');
      // The non-string return routes via `$exceptionHandler('$compile')`;
      // the handler throws, but `invokeExceptionHandler`'s recursion
      // guard catches it and falls back to `console.error`.
      expect(() => $compile(host)(Scope.create())).not.toThrow();
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('handler-throw at fetch-failure time (async templateUrl) also degrades to console.error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const fetcher = vi.fn<TemplateFetcher>((url) =>
        Promise.reject(new TemplateFetchFailedError(url, '404 Not Found')),
      );
      const { build } = bootstrapSpy({
        fetcher,
        handler: () => {
          throw new Error('handler exploded');
        },
      });
      const { $compile } = build(($cp) => {
        $cp.directive('myDir', ddoFactory({ templateUrl: '/missing.html' }));
      });

      const host = document.createElement('div');
      host.setAttribute('my-dir', '');
      expect(() => $compile(host)(Scope.create())).not.toThrow();
      await flushMicrotasks();
      expect(consoleSpy).toHaveBeenCalled();
      // Host stays empty — the fetch failure is routed, the deferred
      // entry is dropped silently.
      expect(host.firstChild).toBeNull();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe('template-loading error surface — public-API token list contract (FS §2.12)', () => {
  it('EXCEPTION_HANDLER_CAUSES.length is unchanged at 10 (spec 019 adds no new cause)', () => {
    expect(EXCEPTION_HANDLER_CAUSES.length).toBe(10);
  });

  it("EXCEPTION_HANDLER_CAUSES includes '$compile'", () => {
    expect(EXCEPTION_HANDLER_CAUSES).toContain('$compile');
  });

  it("'$compile' satisfies ExceptionHandlerCause at compile time", () => {
    // The `satisfies` operator is the compile-time guard; the runtime
    // assertion is incidental. If the derived `ExceptionHandlerCause`
    // union ever drifted from the const tuple, `pnpm typecheck` would
    // fail on this line.
    const cause = '$compile' satisfies ExceptionHandlerCause;
    expect(cause).toBe('$compile');
  });
});

describe('template-loading error surface — every new error class routes via "$compile" cause', () => {
  it('InvalidTemplateValueError routes via "$compile"', () => {
    const { handler, build } = bootstrapSpy();
    const { $compile } = build(($cp) => {
      $cp.directive('myDir', ddoFactoryUnsafe({ template: 42, link: () => undefined }));
    });
    // Trigger the lazy <name>Directive lookup via a $compile invocation.
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());
    const call = handler.mock.calls.find(([err]) => err instanceof InvalidTemplateValueError);
    expect(call).toBeDefined();
    expect(call?.[1]).toBe('$compile');
  });

  it('InvalidTemplateUrlValueError routes via "$compile"', () => {
    const { handler, build } = bootstrapSpy();
    const { $compile } = build(($cp) => {
      $cp.directive('myDir', ddoFactoryUnsafe({ templateUrl: 42, link: () => undefined }));
    });
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());
    const call = handler.mock.calls.find(([err]) => err instanceof InvalidTemplateUrlValueError);
    expect(call).toBeDefined();
    expect(call?.[1]).toBe('$compile');
  });

  it('EmptyTemplateError routes via "$compile"', () => {
    const { handler, build } = bootstrapSpy();
    const { $compile } = build(($cp) => {
      $cp.directive('myDir', ddoFactoryUnsafe({ template: '', link: () => undefined }));
    });
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());
    const call = handler.mock.calls.find(([err]) => err instanceof EmptyTemplateError);
    expect(call).toBeDefined();
    expect(call?.[1]).toBe('$compile');
  });

  it('EmptyTemplateUrlError routes via "$compile"', () => {
    const { handler, build } = bootstrapSpy();
    const { $compile } = build(($cp) => {
      $cp.directive('myDir', ddoFactoryUnsafe({ templateUrl: '', link: () => undefined }));
    });
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());
    const call = handler.mock.calls.find(([err]) => err instanceof EmptyTemplateUrlError);
    expect(call).toBeDefined();
    expect(call?.[1]).toBe('$compile');
  });

  it('TemplateAndTemplateUrlCombinedError routes via "$compile"', () => {
    const { handler, build } = bootstrapSpy();
    const { $compile } = build(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactoryUnsafe({ template: '<p>a</p>', templateUrl: '/tpl.html', link: () => undefined }),
      );
    });
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());
    const call = handler.mock.calls.find(([err]) => err instanceof TemplateAndTemplateUrlCombinedError);
    expect(call).toBeDefined();
    expect(call?.[1]).toBe('$compile');
  });

  it('ReplaceTrueNotSupportedError routes via "$compile"', () => {
    const { handler, build } = bootstrapSpy();
    const { $compile } = build(($cp) => {
      $cp.directive('myDir', ddoFactoryUnsafe({ replace: true, template: '<p>a</p>', link: () => undefined }));
    });
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());
    const call = handler.mock.calls.find(([err]) => err instanceof ReplaceTrueNotSupportedError);
    expect(call).toBeDefined();
    expect(call?.[1]).toBe('$compile');
  });

  it('TemplateFunctionReturnedNonStringError routes via "$compile"', () => {
    const { handler, build } = bootstrapSpy();
    const { $compile } = build(($cp) => {
      $cp.directive('myDir', ddoFactory({ template: (() => 42 as unknown as string) as TemplateFn }));
    });
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());
    const call = handler.mock.calls.find(([err]) => err instanceof TemplateFunctionReturnedNonStringError);
    expect(call).toBeDefined();
    expect(call?.[1]).toBe('$compile');
  });

  it('TemplateUrlFunctionReturnedNonStringError routes via "$compile"', () => {
    const { handler, build } = bootstrapSpy();
    const { $compile } = build(($cp) => {
      $cp.directive('myDir', ddoFactory({ templateUrl: (() => 42 as unknown as string) as TemplateUrlFn }));
    });
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());
    const call = handler.mock.calls.find(([err]) => err instanceof TemplateUrlFunctionReturnedNonStringError);
    expect(call).toBeDefined();
    expect(call?.[1]).toBe('$compile');
  });

  it('MultipleTemplateDirectivesError routes via "$compile"', () => {
    const { handler, build } = bootstrapSpy();
    const { $compile } = build(($cp) => {
      $cp.directive('dirA', ddoFactory({ template: '<p>A</p>' }));
      $cp.directive('dirB', ddoFactory({ template: '<p>B</p>' }));
    });
    const host = document.createElement('div');
    host.setAttribute('dir-a', '');
    host.setAttribute('dir-b', '');
    $compile(host)(Scope.create());
    const call = handler.mock.calls.find(([err]) => err instanceof MultipleTemplateDirectivesError);
    expect(call).toBeDefined();
    expect(call?.[1]).toBe('$compile');
  });

  it('TemplateFetchFailedError routes via "$compile"', async () => {
    const fetcher = vi.fn<TemplateFetcher>((url) => Promise.reject(new TemplateFetchFailedError(url, '404 Not Found')));
    const { handler, build } = bootstrapSpy({ fetcher });
    const { $compile } = build(($cp) => {
      $cp.directive('myDir', ddoFactory({ templateUrl: '/missing.html' }));
    });
    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    $compile(host)(Scope.create());
    await flushMicrotasks();
    const call = handler.mock.calls.find(([err]) => err instanceof TemplateFetchFailedError);
    expect(call).toBeDefined();
    expect(call?.[1]).toBe('$compile');
  });
});
