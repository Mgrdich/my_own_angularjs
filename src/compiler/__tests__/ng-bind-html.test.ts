/**
 * `ngBindHtml` directive — trusted HTML binding (spec 023 Slice 5 /
 * FS §2.5).
 *
 * Locks the AngularJS-canonical behavior for the built-in
 * `ngBindHtml` directive registered on `ngModule`:
 *
 * - A value already wrapped via `$sce.trustAsHtml(...)` unwraps
 *   directly to its underlying string and `innerHTML` carries the
 *   markup verbatim — including tags that sanitization would strip.
 * - With `ngSanitize` loaded (spec 013), a plain string is routed
 *   through `$sce.getTrustedHtml` → `$sanitize` and the cleaned
 *   result lands on `innerHTML` with disallowed tags stripped.
 * - Without `ngSanitize`, a plain string makes `$sce.getTrustedHtml`
 *   throw inside the watch listener. The digest's existing
 *   `'watchListener'` exception path catches the throw, the element's
 *   `innerHTML` degrades to the empty string (matches AngularJS
 *   safe-state behavior), and the digest continues.
 * - `null` / `undefined` render as the empty `innerHTML` — no
 *   `$sce.getTrustedHtml` consulted.
 *
 * Tests use the canonical `ngModule` so the `ngBindHtml` directive
 * registered by `src/core/ng-module.ts` is reachable end-to-end —
 * mirroring the `ng-bind.test.ts` / `ng-bind-template.test.ts`
 * bootstrap patterns. The "with `ngSanitize`" group additionally
 * declares `ngSanitize` in the app module's deps chain — pattern
 * borrowed from `src/sanitize/__tests__/sanitize-sce.test.ts`.
 */

import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import type { ExceptionHandler } from '@exception-handler/index';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { ngSanitize } from '@sanitize/ng-sanitize-module';
import { $SanitizeProvider } from '@sanitize/sanitize-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import type { SceService } from '@sce/sce-types';
import { createTemplateCache } from '@template/template-cache';
import { createTemplateRequest } from '@template/template-request';
import type { TemplateCacheService, TemplateRequestFn } from '@template/template-types';

interface InjectorLike {
  has: (name: string) => boolean;
}

type ExceptionSpy = Mock<ExceptionHandler>;

interface Bootstrap {
  $compile: CompileService;
  $sce: SceService;
  /**
   * Spy passed via `Scope.create({ exceptionHandler })` for the
   * Group-B listener-throw assertions. Wiring through `Scope.create`
   * rather than the DI factory is intentional — the scope captures
   * its handler at construction time (`$$exceptionHandler` field),
   * not lazily through the injector, so DI-only spy registration
   * wouldn't reach the digest's `invokeExceptionHandler(...)` call
   * sites in `src/core/scope.ts`.
   */
  exceptionSpy: ExceptionSpy;
  injector: InjectorLike;
}

/**
 * Bootstrap WITHOUT `ngSanitize` — the default `ngModule` is the only
 * core module loaded. `$sce.getTrustedHtml(plainString)` will throw
 * the spec-012 "not trusted for context 'html'" error.
 */
function bootstrapWithoutSanitize(): Bootstrap {
  resetRegistry();
  const exceptionSpy: ExceptionSpy = vi.fn<ExceptionHandler>();
  // NOTE: a DI-registered `$exceptionHandler` factory does NOT reach
  // the digest's `invokeExceptionHandler(...)` call sites — the scope
  // captures its handler at `Scope.create()` time (the
  // `$$exceptionHandler` field). Tests below wire the spy into the
  // scope explicitly via `Scope.create({ exceptionHandler: spy })`.
  createModule('ng', [])
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

  const appModule = createModule('app', ['ng']);
  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get('$compile'),
    $sce: built.get('$sce'),
    exceptionSpy,
    injector: built,
  };
}

/**
 * Bootstrap WITH `ngSanitize` — the opt-in module is also registered,
 * which automatically wires the `$sce` → `$sanitize` fallback (spec
 * 013). `$sce.getTrustedHtml(plainString)` routes through `$sanitize`
 * and returns the cleaned HTML instead of throwing.
 */
function bootstrapWithSanitize(): Bootstrap {
  resetRegistry();
  const exceptionSpy: ExceptionSpy = vi.fn<ExceptionHandler>();
  createModule('ng', [])
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
  createModule('ngSanitize', []).provider('$sanitize', $SanitizeProvider);

  const appModule = createModule('app', ['ng', 'ngSanitize']);
  const built = createInjector([ngModule, ngSanitize, appModule]);
  return {
    $compile: built.get('$compile'),
    $sce: built.get('$sce'),
    exceptionSpy,
    injector: built,
  };
}

afterEach(() => {
  resetRegistry();
});

describe('ngBindHtml — registration on ngModule', () => {
  it('injector.has("ngBindHtmlDirective") === true when "ng" is in the deps chain', () => {
    const b = bootstrapWithoutSanitize();
    expect(b.injector.has('ngBindHtmlDirective')).toBe(true);
  });
});

describe('ngBindHtml — Group A: WITH ngSanitize loaded', () => {
  it('untrusted plain string is sanitized and rendered (script stripped, allowed tag survives)', () => {
    const b = bootstrapWithSanitize();
    const scope = Scope.create({ exceptionHandler: b.exceptionSpy });
    scope.html = '<b>safe</b><script>alert(1)</script>';

    const element = document.createElement('div');
    element.setAttribute('ng-bind-html', 'html');

    b.$compile(element)(scope);
    scope.$digest();

    // The `<b>` tag is allow-listed by `$sanitize` (spec 014); the
    // `<script>` tag is stripped. `innerHTML` round-trips the allowed
    // tag verbatim. The sanitized output mirrors the canonical pin in
    // `sanitize-sce.test.ts` — script content is dropped, then any
    // surviving text appears outside the stripped tags.
    expect(element.innerHTML).toContain('<b>safe</b>');
    // No real <script> element was created; querySelector confirms the
    // browser sees no executable script in the DOM tree.
    expect(element.querySelector('script')).toBeNull();
    // The textual `alert(1)` content from inside the stripped script is
    // also dropped by $sanitize per spec 014 — the surviving text is
    // just the `<b>safe</b>` markup contents.
    expect(element.textContent).toBe('safe');
  });

  it('a trusted value (from $sce.trustAsHtml) renders verbatim including disallowed tags', () => {
    const b = bootstrapWithSanitize();
    const scope = Scope.create({ exceptionHandler: b.exceptionSpy });
    // The trust wrapper bypasses $sanitize entirely (per spec-013
    // `sanitize-sce.test.ts` group C). The literal `<script>` survives
    // the round-trip into `innerHTML` even though sanitization would
    // otherwise strip it.
    scope.html = b.$sce.trustAsHtml('<script>safe()</script>');

    const element = document.createElement('div');
    element.setAttribute('ng-bind-html', 'html');

    b.$compile(element)(scope);
    scope.$digest();

    // jsdom parses the assigned innerHTML and re-serializes — but the
    // <script> tag is preserved as a child element node. We assert via
    // querySelector to avoid coupling to the exact serialized form.
    const script = element.querySelector('script');
    expect(script).not.toBeNull();
    expect(script?.textContent).toBe('safe()');
  });

  it('updates innerHTML when the bound value changes on a subsequent digest', () => {
    const b = bootstrapWithSanitize();
    const scope = Scope.create({ exceptionHandler: b.exceptionSpy });
    scope.html = '<i>one</i>';

    const element = document.createElement('div');
    element.setAttribute('ng-bind-html', 'html');

    b.$compile(element)(scope);
    scope.$digest();
    expect(element.innerHTML).toContain('<i>one</i>');

    scope.html = '<b>two</b>';
    scope.$digest();
    expect(element.innerHTML).toContain('<b>two</b>');
    // The previous `<i>` tag is gone — innerHTML is a full replacement,
    // not an append.
    expect(element.querySelector('i')).toBeNull();
  });

  it('no listener throws routed via $exceptionHandler for the in-allow-list happy path', () => {
    const b = bootstrapWithSanitize();
    const scope = Scope.create({ exceptionHandler: b.exceptionSpy });
    scope.html = '<b>x</b>';

    const element = document.createElement('div');
    element.setAttribute('ng-bind-html', 'html');

    b.$compile(element)(scope);
    scope.$digest();

    // With `ngSanitize` loaded, `<b>x</b>` is allow-listed and survives
    // sanitization without a throw — the spy stays clean.
    expect(b.exceptionSpy).not.toHaveBeenCalled();
  });
});

describe('ngBindHtml — Group B: WITHOUT ngSanitize loaded', () => {
  it('untrusted plain string throws inside the listener and innerHTML degrades to empty', () => {
    const b = bootstrapWithoutSanitize();
    const scope = Scope.create({ exceptionHandler: b.exceptionSpy });
    scope.html = '<b>x</b>';

    const element = document.createElement('div');
    element.setAttribute('ng-bind-html', 'html');

    b.$compile(element)(scope);
    scope.$digest();

    // The listener's `$sce.getTrustedHtml('<b>x</b>')` throws because
    // no `$sanitize` fallback is registered. The digest's
    // 'watchListener' path catches the throw — the element's
    // `innerHTML` stays empty (the assignment never reached, and the
    // explicit empty default before the throw covers the safe state).
    expect(element.innerHTML).toBe('');
  });

  it("the error is reported via $exceptionHandler with cause 'watchListener'", () => {
    const b = bootstrapWithoutSanitize();
    const scope = Scope.create({ exceptionHandler: b.exceptionSpy });
    scope.html = '<b>x</b>';

    const element = document.createElement('div');
    element.setAttribute('ng-bind-html', 'html');

    b.$compile(element)(scope);
    scope.$digest();

    expect(b.exceptionSpy).toHaveBeenCalled();
    // The cause argument is the second positional — assert via the
    // first call's argument tuple.
    const firstCall = b.exceptionSpy.mock.calls[0];
    expect(firstCall?.[1]).toBe('watchListener');
    // Sanity-check the error message format — the spec-012 delegate
    // surfaces the "not trusted for context 'html'" form. The thrown
    // value is an `Error` per the delegate's contract; narrow via
    // `instanceof` before reading `.message`.
    const error = firstCall?.[0];
    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error) {
      expect(error.message).toMatch(/not trusted for context 'html'/);
    }
  });

  it('a trusted value (from $sce.trustAsHtml) renders verbatim even without ngSanitize', () => {
    const b = bootstrapWithoutSanitize();
    const scope = Scope.create({ exceptionHandler: b.exceptionSpy });
    scope.html = b.$sce.trustAsHtml('<b>safe</b>');

    const element = document.createElement('div');
    element.setAttribute('ng-bind-html', 'html');

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.innerHTML).toContain('<b>safe</b>');
    // The trust wrapper bypasses the delegate entirely — no exception
    // is reported.
    expect(b.exceptionSpy).not.toHaveBeenCalled();
  });

  it('digest continues after the listener throw (subsequent digests can recover with a trusted value)', () => {
    const b = bootstrapWithoutSanitize();
    const scope = Scope.create({ exceptionHandler: b.exceptionSpy });
    scope.html = '<b>x</b>';

    const element = document.createElement('div');
    element.setAttribute('ng-bind-html', 'html');

    b.$compile(element)(scope);
    scope.$digest();
    expect(element.innerHTML).toBe('');

    // Swap to a trusted value and re-digest — the directive recovers
    // and `innerHTML` carries the markup. Proves the listener-throw
    // didn't tear down the watch.
    scope.html = b.$sce.trustAsHtml('<b>safe</b>');
    scope.$digest();
    expect(element.innerHTML).toContain('<b>safe</b>');
  });
});

describe('ngBindHtml — shared: null / undefined render as empty innerHTML', () => {
  it('null renders as the empty innerHTML (no listener throw, no $sce call)', () => {
    const b = bootstrapWithoutSanitize();
    const scope = Scope.create({ exceptionHandler: b.exceptionSpy });
    scope.html = null;

    const element = document.createElement('div');
    element.setAttribute('ng-bind-html', 'html');

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.innerHTML).toBe('');
    // The null branch short-circuits before `$sce.getTrustedHtml` is
    // reached, so no exception is ever raised even without
    // `ngSanitize`.
    expect(b.exceptionSpy).not.toHaveBeenCalled();
  });

  it('undefined renders as the empty innerHTML (no listener throw, no $sce call)', () => {
    const b = bootstrapWithoutSanitize();
    const scope = Scope.create({ exceptionHandler: b.exceptionSpy });
    // Intentionally don't assign — scope.html is `undefined`.

    const element = document.createElement('div');
    element.setAttribute('ng-bind-html', 'html');

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.innerHTML).toBe('');
    expect(b.exceptionSpy).not.toHaveBeenCalled();
  });

  it('null also works under the ngSanitize-loaded path (sanitize is not consulted)', () => {
    const b = bootstrapWithSanitize();
    const scope = Scope.create({ exceptionHandler: b.exceptionSpy });
    scope.html = null;

    const element = document.createElement('div');
    element.setAttribute('ng-bind-html', 'html');

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.innerHTML).toBe('');
    expect(b.exceptionSpy).not.toHaveBeenCalled();
  });
});
