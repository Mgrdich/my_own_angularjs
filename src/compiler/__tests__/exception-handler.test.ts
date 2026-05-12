/**
 * `$compile` ↔ `$exceptionHandler` integration tests
 * (Slice 11 of spec 017 / FS §2.16).
 *
 * Locks the AngularJS-canonical "log and continue" contract for the
 * compiler's five execution sites:
 *   1. Directive factory invocation (lazy, inside the `<name>Directive`
 *      provider's `$get`).
 *   2. `compile` function call.
 *   3. `pre-link` function call.
 *   4. `post-link` function call.
 *   5. `$observe` callback invocation.
 *
 * In every case the thrown error is reported via the configured
 * `$exceptionHandler` with cause `'$compile'`, and sibling /
 * ancestor work continues. The walker still produces a linker even
 * when compile errors occurred — partial trees link successfully.
 *
 * The `'$compile'` token is the 10th entry in `EXCEPTION_HANDLER_CAUSES`
 * (added in this slice; mirrors spec-016's `'$filter'` addition).
 */

import { describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type {
  CompileFn,
  CompileService,
  DirectiveFactory,
  DirectiveFactoryReturn,
  LinkFn,
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

function bootstrapNgModule(handler?: (...args: unknown[]) => void): void {
  resetRegistry();
  createModule('ng', [])
    .factory('$exceptionHandler', [() => handler ?? (() => undefined)])
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

describe("$compile error routing — '$compile' cause token (FS §2.16)", () => {
  describe('factory invocation', () => {
    it('a throwing directive factory routes via $exceptionHandler with cause $compile and is silently dropped', () => {
      const handler = vi.fn<(...args: unknown[]) => void>();
      bootstrapNgModule(handler);
      const $compile = compileWith(($cp) => {
        // Bare-array factory: the inner function throws on invoke.
        $cp.directive('boomDir', [
          () => {
            throw new Error('factory boom');
          },
        ] as DirectiveFactory);
        // A sibling that should still run successfully.
        const otherLink = vi.fn<LinkFn>();
        $cp.directive('siblingDir', ddoFactory({ link: otherLink }));
        (handler as unknown as { siblingLink: LinkFn }).siblingLink = otherLink;
      });

      const node = document.createElement('div');
      node.setAttribute('boom-dir', '');
      node.setAttribute('sibling-dir', '');

      // No throw — the broken factory is skipped, the sibling links
      // normally.
      expect(() => $compile(node)(Scope.create())).not.toThrow();
      expect(handler).toHaveBeenCalled();
      const [err, cause] = handler.mock.calls[0] ?? [];
      expect((err as Error).message).toBe('factory boom');
      expect(cause).toBe('$compile');

      // Sibling's post-link did fire on the same node.
      const siblingLink = (handler as unknown as { siblingLink: LinkFn }).siblingLink;
      expect(siblingLink).toHaveBeenCalledTimes(1);
    });
  });

  describe('compile function', () => {
    it('a throwing compile fn routes via $exceptionHandler with cause $compile and skips the directive', () => {
      const handler = vi.fn<(...args: unknown[]) => void>();
      bootstrapNgModule(handler);
      const goodLink = vi.fn<LinkFn>();
      const $compile = compileWith(($cp) => {
        const badCompile: CompileFn = () => {
          throw new Error('compile boom');
        };
        $cp.directive('badCompileDir', ddoFactory({ compile: badCompile }));
        $cp.directive('goodDir', ddoFactory({ link: goodLink }));
      });

      const node = document.createElement('div');
      node.setAttribute('bad-compile-dir', '');
      node.setAttribute('good-dir', '');

      expect(() => $compile(node)(Scope.create())).not.toThrow();
      expect(handler).toHaveBeenCalled();
      const [err, cause] = handler.mock.calls[0] ?? [];
      expect((err as Error).message).toBe('compile boom');
      expect(cause).toBe('$compile');
      // The good directive's post-link still ran.
      expect(goodLink).toHaveBeenCalledTimes(1);
    });

    it('the walker still produces a linker after compile errors so other directives link normally', () => {
      const handler = vi.fn<(...args: unknown[]) => void>();
      bootstrapNgModule(handler);
      const goodLink = vi.fn<LinkFn>();
      const $compile = compileWith(($cp) => {
        $cp.directive(
          'badCompileDir',
          ddoFactory({
            compile: () => {
              throw new Error('compile boom');
            },
          }),
        );
        $cp.directive('goodDir', ddoFactory({ link: goodLink }));
      });

      const node = document.createElement('div');
      node.setAttribute('bad-compile-dir', '');
      node.setAttribute('good-dir', '');

      const linker = $compile(node);
      // Linker is callable — partial-tree linking succeeded.
      expect(typeof linker).toBe('function');
      linker(Scope.create());
      expect(goodLink).toHaveBeenCalledTimes(1);
    });
  });

  describe('pre-link function', () => {
    it('a throwing pre-link fn routes via $exceptionHandler; subsequent pre-links and child traversal still run', () => {
      const handler = vi.fn<(...args: unknown[]) => void>();
      bootstrapNgModule(handler);
      const goodPre = vi.fn<LinkFn>();
      const childPost = vi.fn<LinkFn>();
      const $compile = compileWith(($cp) => {
        // Higher-priority directive throws in pre-link.
        $cp.directive(
          'badPreDir',
          ddoFactory({
            priority: 100,
            link: {
              pre: () => {
                throw new Error('pre boom');
              },
            },
          }),
        );
        // Lower-priority sibling whose pre-link should still run.
        $cp.directive('goodPreDir', ddoFactory({ priority: 50, link: { pre: goodPre } }));
        // Child directive whose post-link confirms recursion happened.
        $cp.directive('childDir', ddoFactory({ link: childPost }));
      });

      const node = document.createElement('div');
      node.setAttribute('bad-pre-dir', '');
      node.setAttribute('good-pre-dir', '');
      const child = document.createElement('span');
      child.setAttribute('child-dir', '');
      node.appendChild(child);

      expect(() => $compile(node)(Scope.create())).not.toThrow();
      expect(handler).toHaveBeenCalled();
      const [err, cause] = handler.mock.calls[0] ?? [];
      expect((err as Error).message).toBe('pre boom');
      expect(cause).toBe('$compile');
      // Subsequent pre-link on the same node ran.
      expect(goodPre).toHaveBeenCalledTimes(1);
      // Child traversal still happened.
      expect(childPost).toHaveBeenCalledTimes(1);
    });
  });

  describe('post-link function', () => {
    it('a throwing post-link fn routes via $exceptionHandler; subsequent post-links still run', () => {
      const handler = vi.fn<(...args: unknown[]) => void>();
      bootstrapNgModule(handler);
      const goodPost = vi.fn<LinkFn>();
      const $compile = compileWith(($cp) => {
        $cp.directive(
          'badPostDir',
          ddoFactory({
            priority: 50,
            link: () => {
              throw new Error('post boom');
            },
          }),
        );
        // Same node — higher priority means post-link runs LATER (post is
        // priority-ASCENDING) so this one runs after the throwing one.
        $cp.directive('goodPostDir', ddoFactory({ priority: 100, link: goodPost }));
      });

      const node = document.createElement('div');
      node.setAttribute('bad-post-dir', '');
      node.setAttribute('good-post-dir', '');

      expect(() => $compile(node)(Scope.create())).not.toThrow();
      expect(handler).toHaveBeenCalled();
      const [err, cause] = handler.mock.calls[0] ?? [];
      expect((err as Error).message).toBe('post boom');
      expect(cause).toBe('$compile');
      // The higher-priority post-link still ran AFTER the throwing one.
      expect(goodPost).toHaveBeenCalledTimes(1);
    });

    it('a throwing CHILD post-link does not abort the parent post-link', () => {
      const handler = vi.fn<(...args: unknown[]) => void>();
      bootstrapNgModule(handler);
      const parentPost = vi.fn<LinkFn>();
      const $compile = compileWith(($cp) => {
        $cp.directive('parentDir', ddoFactory({ link: parentPost }));
        $cp.directive(
          'childDir',
          ddoFactory({
            link: () => {
              throw new Error('child post boom');
            },
          }),
        );
      });

      const node = document.createElement('div');
      node.setAttribute('parent-dir', '');
      const child = document.createElement('span');
      child.setAttribute('child-dir', '');
      node.appendChild(child);

      expect(() => $compile(node)(Scope.create())).not.toThrow();
      expect(handler).toHaveBeenCalled();
      // Parent's post-link still ran (post-link bubbles bottom-up; the
      // child's throw didn't abort the ancestor traversal).
      expect(parentPost).toHaveBeenCalledTimes(1);
    });

    it('a throwing post-link on one node does not prevent sibling-node post-links', () => {
      const handler = vi.fn<(...args: unknown[]) => void>();
      bootstrapNgModule(handler);
      const siblingPost = vi.fn<LinkFn>();
      const $compile = compileWith(($cp) => {
        $cp.directive(
          'badPostDir',
          ddoFactory({
            link: () => {
              throw new Error('sibling post boom');
            },
          }),
        );
        $cp.directive('siblingDir', ddoFactory({ link: siblingPost }));
      });

      const root = document.createElement('div');
      const a = document.createElement('span');
      a.setAttribute('bad-post-dir', '');
      const b = document.createElement('span');
      b.setAttribute('sibling-dir', '');
      root.appendChild(a);
      root.appendChild(b);

      expect(() => $compile(root)(Scope.create())).not.toThrow();
      expect(handler).toHaveBeenCalled();
      // Sibling node's post-link still ran.
      expect(siblingPost).toHaveBeenCalledTimes(1);
    });
  });

  describe('$observe callback', () => {
    it('a throwing $observe callback routes via $exceptionHandler with cause $compile; other observers still fire', () => {
      // Tests the $set-driven notification path (the canonical one
      // wrapped in Slice 11). When the watch listener for an
      // interpolated attribute calls $set(name, newValue, false), the
      // observer iteration runs synchronously and is wrapped in
      // try/catch routing through invokeExceptionHandler('$compile').
      const handler = vi.fn<(...args: unknown[]) => void>();
      bootstrapNgModule(handler);
      const goodObserver = vi.fn<(value: string | undefined) => void>();
      const $compile = compileWith(($cp) => {
        $cp.directive(
          'myDir',
          ddoFactory({
            link: (_scope, _el, attrs) => {
              attrs.$observe('myDir', () => {
                throw new Error('observer boom');
              });
              attrs.$observe('myDir', goodObserver);
            },
          }),
        );
      });

      const node = document.createElement('div');
      node.setAttribute('my-dir', 'hello-{{name}}');
      const scope = Scope.create();
      $compile(node)(scope);
      // First digest resolves the interpolation; the watch listener
      // calls $set('myDir', 'hello-Alice', false) which iterates
      // observers — the throwing one routes via $exceptionHandler,
      // the good one still receives the value.
      (scope as unknown as Record<string, unknown>).name = 'Alice';
      scope.$digest();

      expect(handler).toHaveBeenCalled();
      const lastCall = handler.mock.calls[handler.mock.calls.length - 1] ?? [];
      expect((lastCall[0] as Error).message).toBe('observer boom');
      expect(lastCall[1]).toBe('$compile');
      // Good observer still received the resolved interpolated value.
      expect(goodObserver).toHaveBeenCalledWith('hello-Alice');
    });
  });

  describe('handler degradation', () => {
    it('a custom $exceptionHandler that itself throws degrades to console.error and the walker does not crash', () => {
      // Spec-014 contract preserved: invokeExceptionHandler wraps the
      // handler call so a throwing handler is itself caught and the
      // error is logged via console.error rather than propagating.
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        bootstrapNgModule(() => {
          throw new Error('handler boom');
        });
        const $compile = compileWith(($cp) => {
          $cp.directive(
            'badDir',
            ddoFactory({
              link: () => {
                throw new Error('post boom');
              },
            }),
          );
        });

        const node = document.createElement('div');
        node.setAttribute('bad-dir', '');
        // Compile + link must NOT crash even when both the link and the
        // exception handler throw.
        expect(() => $compile(node)(Scope.create())).not.toThrow();
        // console.error fired at least once with the handler's own throw.
        expect(consoleSpy).toHaveBeenCalled();
      } finally {
        consoleSpy.mockRestore();
      }
    });
  });

  describe('public-API token list', () => {
    it("EXCEPTION_HANDLER_CAUSES.includes('$compile') at runtime", () => {
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

  describe('registration-time errors stay synchronous (not routed)', () => {
    it('InvalidDirectiveNameError still throws synchronously to the caller', () => {
      bootstrapNgModule();
      // The error path here is the synchronous validation inside
      // `$compileProvider.directive(name, factory)` — programmer errors
      // are NOT routed through $exceptionHandler. That boundary is
      // intentional per FS §2.16: compile/link/observe runtime errors
      // route via the handler; registration-time validation errors
      // surface to the caller of `.directive(...)`.
      expect(() => {
        const appModule = createModule('app', ['ng']).config([
          '$compileProvider',
          ($cp: $CompileProvider) => {
            $cp.directive('123-bad-name', ddoFactory({ link: () => undefined }));
          },
        ]);
        createInjector([appModule]);
      }).toThrow(/Invalid directive name/);
    });

    it('InvalidDirectiveFactoryError still throws synchronously to the caller', () => {
      bootstrapNgModule();
      expect(() => {
        const appModule = createModule('app', ['ng']).config([
          '$compileProvider',
          ($cp: $CompileProvider) => {
            // Null factory rejected at registration time.
            $cp.directive('myDir', null as unknown as DirectiveFactory);
          },
        ]);
        createInjector([appModule]);
      }).toThrow(/Invalid directive factory/);
    });
  });
});
