/**
 * Registration-phase validation of the `template`, `templateUrl`, and
 * `replace` DDO fields (spec 019 Slice 4 / FS §2.1 + §2.2 + §2.3 + §2.4
 * + §2.7 + §2.12 + technical-considerations §2.6).
 *
 * Exercises `normalizeDirective`'s `normalizeTemplate` block end-to-end
 * through the lazy `<name>Directive` provider lookup. Throws raised
 * during factory normalization are caught by the existing
 * factory-invocation try/catch in `$$buildDirectiveArrayProvider` and
 * routed via `$exceptionHandler('$compile')` — the same path the
 * spec-018 transclude errors follow. Tests use a `vi.fn` handler spy
 * as the `$exceptionHandler` override.
 *
 * No runtime template behavior runs here — Slice 4 only populates the
 * `Directive.template` field on the normalized directive object. The
 * compiler still walks the DOM identically to spec 017/018; inline
 * `template` install lights up in Slice 5 and async `templateUrl`
 * lights up in Slice 6.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import {
  EmptyTemplateError,
  EmptyTemplateUrlError,
  InvalidTemplateUrlValueError,
  InvalidTemplateValueError,
  ReplaceTrueNotSupportedError,
  TemplateAndTemplateUrlCombinedError,
} from '@compiler/compile-error';
import type {
  Directive,
  DirectiveFactory,
  DirectiveFactoryReturn,
  TemplateFn,
  TemplateUrlFn,
} from '@compiler/directive-types';
import type { Injector } from '@di/di-types';
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

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

/**
 * Sibling of `ddoFactory` for tests that deliberately pass a DDO shape
 * carrying fields whose runtime types are wider than the declared
 * `DirectiveDefinition` interface — chiefly `template`, `templateUrl`,
 * and `replace`. The runtime read is via
 * `(ddo as { template?: unknown }).template` etc., so an `unknown`
 * input is the right surface for these tests.
 */
function ddoFactoryUnsafe(returnValue: unknown): DirectiveFactory {
  return [() => returnValue as DirectiveFactoryReturn] as DirectiveFactory;
}

type SpyHandler = ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;

interface SpyHarness {
  handler: SpyHandler;
  register: (configure: ($cp: $CompileProvider) => void) => Injector;
}

/**
 * Builds an injector pre-wired with a `$exceptionHandler` spy. The
 * spy receives the error as its FIRST positional argument and the
 * cause token as its SECOND. Mirrors `transclude-registration.test.ts`.
 */
function buildSpyHarness(): SpyHarness {
  const handler = vi.fn<(...args: unknown[]) => void>();
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
      (cache: TemplateCacheService): TemplateRequestFn => createTemplateRequest({ cache }),
    ])
    .provider('$compile', ['$provide', $CompileProvider]);
  return {
    handler,
    register(configure) {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          configure($cp);
        },
      ]);
      return createInjector([appModule]) as unknown as Injector;
    },
  };
}

describe('normalizeDirective — template validation (spec 019 Slice 4)', () => {
  describe('accepted shapes (FS §2.1 + §2.2 + §2.3 + §2.4)', () => {
    beforeEach(() => {
      bootstrapNgModule();
    });

    it('template: "<p>hi</p>" normalizes to { kind: "inline-string", value: "<p>hi</p>" }', () => {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive('myDir', ddoFactoryUnsafe({ template: '<p>hi</p>', link: () => undefined }));
        },
      ]);
      const directives = createInjector([appModule]).get<Directive[]>('myDirDirective');
      expect(directives).toHaveLength(1);
      expect(directives[0]?.template).toEqual({ kind: 'inline-string', value: '<p>hi</p>' });
    });

    it('template: () => "<p>hi</p>" normalizes to { kind: "inline-fn", value: fn }', () => {
      const fn: TemplateFn = () => '<p>hi</p>';
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive('myDir', ddoFactoryUnsafe({ template: fn, link: () => undefined }));
        },
      ]);
      const directives = createInjector([appModule]).get<Directive[]>('myDirDirective');
      expect(directives).toHaveLength(1);
      const normalized = directives[0]?.template;
      expect(normalized?.kind).toBe('inline-fn');
      if (normalized?.kind !== 'inline-fn') {
        throw new Error('expected kind=inline-fn');
      }
      expect(normalized.value).toBe(fn);
    });

    it('templateUrl: "/tpl.html" normalizes to { kind: "url-string", value: "/tpl.html" }', () => {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive('myDir', ddoFactoryUnsafe({ templateUrl: '/tpl.html', link: () => undefined }));
        },
      ]);
      const directives = createInjector([appModule]).get<Directive[]>('myDirDirective');
      expect(directives).toHaveLength(1);
      expect(directives[0]?.template).toEqual({ kind: 'url-string', value: '/tpl.html' });
    });

    it('templateUrl: () => "/tpl.html" normalizes to { kind: "url-fn", value: fn }', () => {
      const fn: TemplateUrlFn = () => '/tpl.html';
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive('myDir', ddoFactoryUnsafe({ templateUrl: fn, link: () => undefined }));
        },
      ]);
      const directives = createInjector([appModule]).get<Directive[]>('myDirDirective');
      expect(directives).toHaveLength(1);
      const normalized = directives[0]?.template;
      expect(normalized?.kind).toBe('url-fn');
      if (normalized?.kind !== 'url-fn') {
        throw new Error('expected kind=url-fn');
      }
      expect(normalized.value).toBe(fn);
    });

    it('omitting both template and templateUrl leaves the normalized field unset', () => {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive('plainDir', ddoFactory({ link: () => undefined }));
        },
      ]);
      const directives = createInjector([appModule]).get<Directive[]>('plainDirDirective');
      expect(directives).toHaveLength(1);
      // The property must be ABSENT on the normalized object (not just
      // set to `undefined`). Mirrors the spec-018 transclude omission
      // contract.
      expect('template' in (directives[0] as object)).toBe(false);
      expect(directives[0]?.template).toBeUndefined();
    });

    it('replace: false is accepted and leaves the normalized field unset', () => {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive(
            'falseRepl',
            ddoFactoryUnsafe({ replace: false, template: '<p>ok</p>', link: () => undefined }),
          );
        },
      ]);
      const directives = createInjector([appModule]).get<Directive[]>('falseReplDirective');
      expect(directives).toHaveLength(1);
      // `template` still normalizes alongside the accepted `replace: false`.
      expect(directives[0]?.template).toEqual({ kind: 'inline-string', value: '<p>ok</p>' });
    });

    it('replace: undefined is accepted (default behavior — no replace key on DDO)', () => {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive('undefRepl', ddoFactoryUnsafe({ template: '<p>ok</p>', link: () => undefined }));
        },
      ]);
      const directives = createInjector([appModule]).get<Directive[]>('undefReplDirective');
      expect(directives).toHaveLength(1);
      expect(directives[0]?.template).toEqual({ kind: 'inline-string', value: '<p>ok</p>' });
    });
  });

  describe('EmptyTemplateError (FS §2.1)', () => {
    it('rejects template: "" and routes via $exceptionHandler("$compile")', () => {
      const { handler, register } = buildSpyHarness();
      const injector = register(($cp) => {
        $cp.directive(
          'emptyDir',
          ddoFactoryUnsafe({
            template: '',
            link: () => undefined,
          }),
        );
      });
      const directives = injector.get<Directive[]>('emptyDirDirective');
      expect(directives).toHaveLength(0);
      expect(handler).toHaveBeenCalledTimes(1);
      const [err, cause] = handler.mock.calls[0] ?? [];
      expect(err).toBeInstanceOf(EmptyTemplateError);
      expect(cause).toBe('$compile');
      expect((err as Error).message).toContain('emptyDir');
      expect((err as Error).message).toContain('empty string');
    });
  });

  describe('EmptyTemplateUrlError (FS §2.3)', () => {
    it('rejects templateUrl: "" and routes via $exceptionHandler("$compile")', () => {
      const { handler, register } = buildSpyHarness();
      const injector = register(($cp) => {
        $cp.directive(
          'emptyUrlDir',
          ddoFactoryUnsafe({
            templateUrl: '',
            link: () => undefined,
          }),
        );
      });
      const directives = injector.get<Directive[]>('emptyUrlDirDirective');
      expect(directives).toHaveLength(0);
      expect(handler).toHaveBeenCalledTimes(1);
      const [err, cause] = handler.mock.calls[0] ?? [];
      expect(err).toBeInstanceOf(EmptyTemplateUrlError);
      expect(cause).toBe('$compile');
      expect((err as Error).message).toContain('emptyUrlDir');
      expect((err as Error).message).toContain('empty string');
    });
  });

  describe('InvalidTemplateValueError (FS §2.1 — non-string non-function)', () => {
    function expectInvalidTemplateRoutes(value: unknown, description: RegExp): void {
      const { handler, register } = buildSpyHarness();
      const injector = register(($cp) => {
        $cp.directive(
          'myDir',
          ddoFactoryUnsafe({
            template: value,
            link: () => undefined,
          }),
        );
      });
      const directives = injector.get<Directive[]>('myDirDirective');
      expect(directives).toHaveLength(0);
      expect(handler).toHaveBeenCalledTimes(1);
      const [err, cause] = handler.mock.calls[0] ?? [];
      expect(err).toBeInstanceOf(InvalidTemplateValueError);
      expect(cause).toBe('$compile');
      expect((err as Error).message).toContain('myDir');
      expect((err as Error).message).toMatch(description);
    }

    it('rejects a numeric value (42)', () => {
      expectInvalidTemplateRoutes(42, /42 \(number\)/);
    });

    it('rejects null', () => {
      expectInvalidTemplateRoutes(null, /null \(null\)/);
    });

    it('rejects a plain object', () => {
      expectInvalidTemplateRoutes({}, /\[object\] \(object\)/);
    });

    it('rejects an array', () => {
      expectInvalidTemplateRoutes([], /\[\] \(array\)/);
    });

    it('rejects a boolean', () => {
      expectInvalidTemplateRoutes(true, /true \(boolean\)/);
    });
  });

  describe('InvalidTemplateUrlValueError (FS §2.3 — non-string non-function)', () => {
    function expectInvalidTemplateUrlRoutes(value: unknown, description: RegExp): void {
      const { handler, register } = buildSpyHarness();
      const injector = register(($cp) => {
        $cp.directive(
          'myDir',
          ddoFactoryUnsafe({
            templateUrl: value,
            link: () => undefined,
          }),
        );
      });
      const directives = injector.get<Directive[]>('myDirDirective');
      expect(directives).toHaveLength(0);
      expect(handler).toHaveBeenCalledTimes(1);
      const [err, cause] = handler.mock.calls[0] ?? [];
      expect(err).toBeInstanceOf(InvalidTemplateUrlValueError);
      expect(cause).toBe('$compile');
      expect((err as Error).message).toContain('myDir');
      expect((err as Error).message).toMatch(description);
    }

    it('rejects a numeric value (42)', () => {
      expectInvalidTemplateUrlRoutes(42, /42 \(number\)/);
    });

    it('rejects null', () => {
      expectInvalidTemplateUrlRoutes(null, /null \(null\)/);
    });

    it('rejects a plain object', () => {
      expectInvalidTemplateUrlRoutes({}, /\[object\] \(object\)/);
    });

    it('rejects an array', () => {
      expectInvalidTemplateUrlRoutes([], /\[\] \(array\)/);
    });

    it('rejects a boolean', () => {
      expectInvalidTemplateUrlRoutes(true, /true \(boolean\)/);
    });
  });

  describe('TemplateAndTemplateUrlCombinedError (FS §2.3 — mutual exclusion)', () => {
    it("rejects template + templateUrl on the same DDO and routes via $exceptionHandler('$compile')", () => {
      const { handler, register } = buildSpyHarness();
      const injector = register(($cp) => {
        $cp.directive(
          'bothDir',
          ddoFactoryUnsafe({
            template: '<p>a</p>',
            templateUrl: '/tpl.html',
            link: () => undefined,
          }),
        );
      });
      const directives = injector.get<Directive[]>('bothDirDirective');
      expect(directives).toHaveLength(0);
      expect(handler).toHaveBeenCalledTimes(1);
      const [err, cause] = handler.mock.calls[0] ?? [];
      expect(err).toBeInstanceOf(TemplateAndTemplateUrlCombinedError);
      expect(cause).toBe('$compile');
      expect((err as Error).message).toContain('bothDir');
      expect((err as Error).message).toMatch(/Cannot combine template and templateUrl/);
    });
  });

  describe('ReplaceTrueNotSupportedError (FS §2.7)', () => {
    function expectReplaceRejected(replaceValue: unknown): void {
      const { handler, register } = buildSpyHarness();
      const injector = register(($cp) => {
        $cp.directive(
          'replDir',
          ddoFactoryUnsafe({
            template: '<p>a</p>',
            replace: replaceValue,
            link: () => undefined,
          }),
        );
      });
      const directives = injector.get<Directive[]>('replDirDirective');
      expect(directives).toHaveLength(0);
      expect(handler).toHaveBeenCalledTimes(1);
      const [err, cause] = handler.mock.calls[0] ?? [];
      expect(err).toBeInstanceOf(ReplaceTrueNotSupportedError);
      expect(cause).toBe('$compile');
      expect((err as Error).message).toContain('replDir');
      expect((err as Error).message).toMatch(/replace: true is deprecated/);
    }

    it('rejects replace: true', () => {
      expectReplaceRejected(true);
    });

    it('rejects replace: 1 (truthy non-true)', () => {
      expectReplaceRejected(1);
    });

    it("rejects replace: 'yes' (string)", () => {
      expectReplaceRejected('yes');
    });

    it('rejects replace: {} (object)', () => {
      expectReplaceRejected({});
    });

    it('rejects replace: null (falsy non-false)', () => {
      // Per the technical-considerations §2.6: anything that is not
      // exactly `false` or `undefined` is rejected. `null` (which is
      // distinct from `undefined`) falls in the rejection bucket.
      expectReplaceRejected(null);
    });
  });

  describe('sibling-directive resilience (FS §2.12)', () => {
    it('a failing template directive is dropped; sibling directives on the same element continue to register', () => {
      const { handler, register } = buildSpyHarness();
      const injector = register(($cp) => {
        $cp.directive(
          'badDir',
          ddoFactoryUnsafe({
            template: '',
            link: () => undefined,
          }),
        );
        $cp.directive(
          'goodDir',
          ddoFactoryUnsafe({
            template: '<p>ok</p>',
            link: () => undefined,
          }),
        );
      });
      const badDirectives = injector.get<Directive[]>('badDirDirective');
      const goodDirectives = injector.get<Directive[]>('goodDirDirective');

      expect(badDirectives).toHaveLength(0);
      expect(goodDirectives).toHaveLength(1);
      expect(goodDirectives[0]?.template).toEqual({ kind: 'inline-string', value: '<p>ok</p>' });

      expect(handler).toHaveBeenCalledTimes(1);
      const [err, cause] = handler.mock.calls[0] ?? [];
      expect(err).toBeInstanceOf(EmptyTemplateError);
      expect(cause).toBe('$compile');
    });

    it('within the same name, a failing factory is dropped; a sibling valid factory under the same name continues to resolve', () => {
      const { handler, register } = buildSpyHarness();
      const injector = register(($cp) => {
        $cp.directive('multiDir', ddoFactoryUnsafe({ template: 42, link: () => undefined }));
        $cp.directive('multiDir', ddoFactoryUnsafe({ template: '<p>good</p>', link: () => undefined }));
      });
      const directives = injector.get<Directive[]>('multiDirDirective');
      // The bad factory drops out; the good one normalizes.
      expect(directives).toHaveLength(1);
      expect(directives[0]?.template).toEqual({ kind: 'inline-string', value: '<p>good</p>' });

      expect(handler).toHaveBeenCalledTimes(1);
      const [err, cause] = handler.mock.calls[0] ?? [];
      expect(err).toBeInstanceOf(InvalidTemplateValueError);
      expect(cause).toBe('$compile');
    });
  });
});
