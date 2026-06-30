/**
 * Consolidated transclusion error-surface tests (spec 018 Slice 6 /
 * FS §2.9).
 *
 * Per-feature error cases are already covered exhaustively by Slices
 * 2–5 (`transclude-registration.test.ts`, `transclude-multi-slot.test.ts`,
 * `ng-transclude.test.ts`, `transclude-cleanup.test.ts`). This file
 * covers the CROSS-CUTTING scenarios that don't fit cleanly into any
 * single feature suite:
 *
 * 1. Two `transclude`-declaring directives on the same element —
 *    `MultipleTranscludeDirectivesError` routed; second's other behavior
 *    still runs; first's transclusion works normally.
 * 2. `cloneAttachFn` throw routed via `$exceptionHandler('$compile')`;
 *    scope STILL created + queued; clone STILL returned.
 * 3. A directive INSIDE transcluded content throws — routed; siblings in
 *    the same clone still link; other clones produce normally.
 * 4. Custom `$exceptionHandler` that itself throws → spec-014 recursion
 *    guard catches; transclusion does not crash.
 * 5. `EXCEPTION_HANDLER_CAUSES` length unchanged at 10; `'$compile'`
 *    still included.
 * 6. `'$compile' satisfies ExceptionHandlerCause` at compile time.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import { MultipleTranscludeDirectivesError } from '@compiler/compile-error';
import { $ControllerProvider } from '@controller/controller-provider';
import type {
  CompileService,
  DirectiveFactory,
  DirectiveFactoryReturn,
  LinkFn,
  TranscludeFn,
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
import type { TemplateCacheService, TemplateRequestFn } from '@template/template-types';

type SpyHandler = ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;

interface SpyHarness {
  handler: SpyHandler;
  build: (register: ($cp: $CompileProvider) => void) => CompileService;
}

function bootstrapSpy(): SpyHarness {
  const handler = vi.fn<(...args: unknown[]) => void>();
  resetRegistry();
  createModule('ng', [])
    .factory('$exceptionHandler', [() => handler])
    .provider('$sceDelegate', $SceDelegateProvider)
    .provider('$sce', $SceProvider)
    .provider('$interpolate', $InterpolateProvider)
    .provider('$filter', ['$provide', $FilterProvider])
    .provider('$controller', ['$provide', $ControllerProvider])
    .factory('$templateCache', [() => createTemplateCache()])
    .factory('$templateRequest', [
      '$templateCache',
      (cache: TemplateCacheService): TemplateRequestFn => createTemplateRequest({ cache }),
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
      return createInjector([appModule]).get('$compile');
    },
  };
}

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

describe('transclusion error surface — multiple transcluding directives on same element (FS §2.9)', () => {
  it('routes MultipleTranscludeDirectivesError for the SECOND directive; first wins; second other behavior runs', () => {
    const { handler, build } = bootstrapSpy();
    const firstXcludeCalls: Node[][] = [];
    const secondLink = vi.fn<LinkFn>();
    const $compile = build(($cp) => {
      // FIRST transcluding directive registered — its transclusion wins.
      // Higher priority so it sorts first in the matched-directive list.
      $cp.directive(
        'firstDir',
        ddoFactory({
          priority: 100,
          transclude: true,
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            const projection = $transclude?.(() => undefined) ?? [];
            firstXcludeCalls.push(projection);
          },
        }),
      );
      // SECOND transcluding directive on the same element — its
      // `transclude` declaration is reported and stripped, but its link
      // function still runs (the OTHER-behavior contract).
      $cp.directive(
        'secondDir',
        ddoFactory({
          priority: 50,
          transclude: true,
          link: secondLink,
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('first-dir', '');
    host.setAttribute('second-dir', '');
    const p = document.createElement('p');
    p.textContent = 'inner';
    host.appendChild(p);

    $compile(host)(Scope.create());

    // (a) The handler saw exactly one MultipleTranscludeDirectivesError
    // routed with cause '$compile'.
    const multi = handler.mock.calls.filter(([err]) => err instanceof MultipleTranscludeDirectivesError);
    expect(multi.length).toBe(1);
    const [errOnly, cause] = multi[0] ?? [];
    expect(errOnly).toBeInstanceOf(MultipleTranscludeDirectivesError);
    expect((errOnly as Error).message).toContain('firstDir');
    expect((errOnly as Error).message).toContain('secondDir');
    expect(cause).toBe('$compile');

    // (b) The FIRST directive's transclusion ran normally — its
    // captured content yielded one clone.
    expect(firstXcludeCalls.length).toBe(1);
    expect(firstXcludeCalls[0]?.length).toBe(1);
    expect((firstXcludeCalls[0]?.[0] as Element).tagName).toBe('P');

    // (c) The SECOND directive's link fn was still invoked.
    expect(secondLink).toHaveBeenCalledTimes(1);
  });

  it("the second directive's link receives the SAME `$transclude` reference as the first directive's link", () => {
    // Behavior lock: every directive on a transcluding element shares
    // the host's bound `$transclude` reference — `undefined` only when
    // no transcluding directive matches on that element. The second
    // directive sees the first's $transclude as a consequence.
    const { build } = bootstrapSpy();
    let firstXclude: TranscludeFn | undefined;
    let secondXclude: TranscludeFn | undefined;
    const $compile = build(($cp) => {
      $cp.directive(
        'firstDir',
        ddoFactory({
          priority: 100,
          transclude: true,
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            firstXclude = $transclude;
          },
        }),
      );
      $cp.directive(
        'secondDir',
        ddoFactory({
          priority: 50,
          transclude: true,
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            secondXclude = $transclude;
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('first-dir', '');
    host.setAttribute('second-dir', '');

    $compile(host)(Scope.create());

    expect(firstXclude).toBeTypeOf('function');
    expect(secondXclude).toBeTypeOf('function');
    expect(firstXclude).toBe(secondXclude);
  });
});

describe('transclusion error surface — cloneAttachFn throw (FS §2.4 #11)', () => {
  it('routes the error via $exceptionHandler("$compile"); scope is created + queued; clone still returned', () => {
    const { handler, build } = bootstrapSpy();
    let xclude: TranscludeFn | undefined;
    const $compile = build(($cp) => {
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
    const p = document.createElement('p');
    p.textContent = 'projected';
    host.appendChild(p);

    $compile(host)(Scope.create());
    expect(xclude).toBeTypeOf('function');

    // Snapshot the cleanup-queue length BEFORE the call so we can
    // observe the per-call clone-scope registration even when the
    // attach fn throws.
    interface CleanupHost extends Element {
      $$ngCleanupQueue?: (() => void)[];
    }
    const queueBefore = (host as CleanupHost).$$ngCleanupQueue?.length ?? 0;

    handler.mockClear();
    const boom = new Error('attach boom');
    const clones = xclude?.(() => {
      throw boom;
    });

    // (a) Error routed exactly once with cause '$compile'.
    expect(handler).toHaveBeenCalledTimes(1);
    const [errOnly, cause] = handler.mock.calls[0] ?? [];
    expect(errOnly).toBe(boom);
    expect(cause).toBe('$compile');

    // (b) The clone IS still returned from $transclude — caller may recover.
    expect(clones?.length).toBe(1);
    expect((clones?.[0] as Element).tagName).toBe('P');

    // (c) The scope was still created and registered on the host's
    // cleanup queue (FS §2.8 acceptance #3).
    const queueAfter = (host as CleanupHost).$$ngCleanupQueue?.length ?? 0;
    expect(queueAfter).toBe(queueBefore + 1);
  });
});

describe('transclusion error surface — inner-directive throw inside transcluded content (FS §2.9 #6)', () => {
  it('siblings in the same clone still link; the error routes via $exceptionHandler("$compile")', () => {
    const { handler, build } = bootstrapSpy();
    const sibling = vi.fn<LinkFn>();
    const $compile = build(($cp) => {
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
        'boomChild',
        ddoFactory({
          link: () => {
            throw new Error('inner boom');
          },
        }),
      );
      $cp.directive('siblingChild', ddoFactory({ link: sibling }));
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    const bad = document.createElement('span');
    bad.setAttribute('boom-child', '');
    const good = document.createElement('span');
    good.setAttribute('sibling-child', '');
    host.appendChild(bad);
    host.appendChild(good);

    $compile(host)(Scope.create());

    // Error routed at least once via $exceptionHandler('$compile').
    const inner = handler.mock.calls.filter(([err]) => (err as Error).message === 'inner boom');
    expect(inner.length).toBeGreaterThanOrEqual(1);
    expect(inner[0]?.[1]).toBe('$compile');
    // Sibling directive's link still ran.
    expect(sibling).toHaveBeenCalledTimes(1);
  });

  it('a throw inside ONE clone does not prevent OTHER clones from linking', () => {
    const { handler, build } = bootstrapSpy();
    const linkCalls: { hostId: string }[] = [];
    let attempt = 0;
    const $compile = build(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            // Two sequential clones.
            $transclude?.(() => undefined);
            $transclude?.(() => undefined);
          },
        }),
      );
      // The inner directive throws on the FIRST link invocation but
      // succeeds on subsequent ones — so clone #1 throws, clone #2
      // links cleanly.
      $cp.directive(
        'flakyChild',
        ddoFactory({
          link: (_scope, element) => {
            attempt++;
            const id = `attempt-${String(attempt)}`;
            element.setAttribute('data-id', id);
            linkCalls.push({ hostId: id });
            if (attempt === 1) {
              throw new Error('flaky boom');
            }
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    const child = document.createElement('span');
    child.setAttribute('flaky-child', '');
    host.appendChild(child);

    $compile(host)(Scope.create());

    // The flaky child linked TWICE (once per clone).
    expect(linkCalls.length).toBe(2);
    // The first clone's link routed an error.
    const flaky = handler.mock.calls.filter(([err]) => (err as Error).message === 'flaky boom');
    expect(flaky.length).toBe(1);
    expect(flaky[0]?.[1]).toBe('$compile');
  });
});

describe('transclusion error surface — handler degradation (FS §2.9 #8 / spec-014 contract)', () => {
  it('a custom $exceptionHandler that itself throws degrades to console.error; transclusion does not crash', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      resetRegistry();
      createModule('ng', [])
        .factory('$exceptionHandler', [
          () => () => {
            throw new Error('handler boom');
          },
        ])
        .provider('$sceDelegate', $SceDelegateProvider)
        .provider('$sce', $SceProvider)
        .provider('$interpolate', $InterpolateProvider)
        .provider('$filter', ['$provide', $FilterProvider])
        .provider('$controller', ['$provide', $ControllerProvider])
        .factory('$templateCache', [() => createTemplateCache()])
        .factory('$templateRequest', [
          '$templateCache',
          (cache: TemplateCacheService): TemplateRequestFn => createTemplateRequest({ cache }),
        ])
        .provider('$compile', ['$provide', $CompileProvider]);

      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive(
            'myDir',
            ddoFactory({
              transclude: true,
              link: (_scope, _element, _attrs, _ctrls, $transclude) => {
                // Force a routed error via a throwing cloneAttachFn.
                $transclude?.(() => {
                  throw new Error('attach boom');
                });
              },
            }),
          );
        },
      ]);
      const $compile = createInjector([appModule]).get('$compile');

      const host = document.createElement('div');
      host.setAttribute('my-dir', '');
      const p = document.createElement('p');
      host.appendChild(p);

      // Neither compile nor link must crash — invokeExceptionHandler's
      // recursion guard catches the handler's own throw and falls
      // back to `console.error`.
      expect(() => $compile(host)(Scope.create())).not.toThrow();
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe('transclusion error surface — public-API token list contract (FS §2.9 mandate)', () => {
  it('EXCEPTION_HANDLER_CAUSES has no transclude token (count is 13 since spec 037)', () => {
    expect(EXCEPTION_HANDLER_CAUSES.length).toBe(13);
  });

  it("EXCEPTION_HANDLER_CAUSES includes '$compile'", () => {
    expect(EXCEPTION_HANDLER_CAUSES).toContain('$compile');
  });

  it("'$compile' satisfies ExceptionHandlerCause at compile time", () => {
    // The `satisfies` operator is a compile-time guard; the runtime
    // assertion is incidental. If the derived ExceptionHandlerCause
    // union ever drifted from the const tuple, this expression would
    // fail `pnpm typecheck`.
    const cause = '$compile' satisfies ExceptionHandlerCause;
    expect(cause).toBe('$compile');
  });
});

describe('transclusion error surface — required-slot vs. handler degradation cross-check', () => {
  beforeEach(() => {
    // Each test in this file calls resetRegistry via its own bootstrap.
  });

  it('the eager required-slot report fires even when the handler-degradation path swallowed an earlier error', () => {
    // Slice 4's eager required-slot report runs AFTER the host's link
    // phases. If a prior compile/link error already routed through a
    // throwing handler (degraded to console.error), the eager report
    // must still fire. Cross-check that the two surfaces are
    // independent.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      resetRegistry();
      const handler = vi.fn<(...args: unknown[]) => void>().mockImplementation(() => {
        // Throws on the FIRST call only — the eager required-slot
        // report on the SECOND call lands cleanly.
        if (handler.mock.calls.length === 1) {
          throw new Error('handler boom');
        }
      });
      createModule('ng', [])
        .factory('$exceptionHandler', [() => handler])
        .provider('$sceDelegate', $SceDelegateProvider)
        .provider('$sce', $SceProvider)
        .provider('$interpolate', $InterpolateProvider)
        .provider('$filter', ['$provide', $FilterProvider])
        .provider('$controller', ['$provide', $ControllerProvider])
        .factory('$templateCache', [() => createTemplateCache()])
        .factory('$templateRequest', [
          '$templateCache',
          (cache: TemplateCacheService): TemplateRequestFn => createTemplateRequest({ cache }),
        ])
        .provider('$compile', ['$provide', $CompileProvider]);

      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive(
            'myCard',
            ddoFactory({
              transclude: { titleSlot: 'card-title' },
              link: () => {
                throw new Error('link boom');
              },
            }),
          );
        },
      ]);
      const $compile = createInjector([appModule]).get('$compile');

      const host = document.createElement('div');
      host.setAttribute('my-card', '');

      expect(() => $compile(host)(Scope.create())).not.toThrow();
      // Handler was called at least twice: once for the link throw,
      // once for the eager required-slot report.
      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
