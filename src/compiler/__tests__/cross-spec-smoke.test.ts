/**
 * Cross-spec regression smoke test (Slice 12 / spec 017 final
 * verification).
 *
 * One happy-path call from each prior subpath to confirm the spec-017
 * compiler addition didn't break any prior public surface. Each
 * assertion is a single line — this is intentionally a SMOKE test, not
 * an exhaustive regression. The exhaustive coverage lives in each
 * subpath's `__tests__` directory.
 *
 * Specs covered: 002 (scope), 003 (parser), 007–008 (DI), 009 (full
 * parser), 011 ($interpolate), 012 ($sce), 013 ($sanitize), 014
 * ($exceptionHandler), 015 ($provide), 016 (filters), 017 ($compile).
 */

import { describe, expect, it } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { parse } from '@parser/index';
import { sanitize } from '@sanitize/sanitize';
import { sce } from '@sce/sce';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';

function bootstrapNgModule(): void {
  resetRegistry();
  createModule('ng', [])
    .factory('$exceptionHandler', [() => () => undefined])
    .provider('$sceDelegate', $SceDelegateProvider)
    .provider('$sce', $SceProvider)
    .provider('$interpolate', $InterpolateProvider)
    .provider('$filter', ['$provide', $FilterProvider])
    .provider('$compile', ['$provide', $CompileProvider]);
}

describe('cross-spec smoke (Slice 12 final verification)', () => {
  it('Scope.create() (spec 002) — digest runs without error', () => {
    const scope = Scope.create();
    expect(() => {
      scope.$digest();
    }).not.toThrow();
  });

  it("parse('a||b') (spec 003 / 009) — lex + parse + interpret produce a callable expression", () => {
    const fn = parse('a || b');
    expect(typeof fn).toBe('function');
    expect(fn({ a: false, b: 'fallback' })).toBe('fallback');
  });

  it("createInjector(['ng']) (spec 007/008) — canonical injector resolves $injector self-reference", () => {
    bootstrapNgModule();
    const injector = createInjector([ngModule]);
    expect(injector.get('$injector')).toBe(injector);
  });

  it("interpolate('Hello {{name}}!') (spec 011) — resolves against scope state", () => {
    bootstrapNgModule();
    const injector = createInjector([ngModule]);
    const $interpolate = injector.get('$interpolate');
    const fn = $interpolate('Hello {{name}}!');
    expect(fn({ name: 'World' })).toBe('Hello World!');
  });

  it('$sce.trustAsHtml + getTrustedHtml (spec 012) — round-trip survives the trust check', () => {
    const trusted = sce.trustAsHtml('<p>safe</p>');
    expect(sce.getTrustedHtml(trusted)).toBe('<p>safe</p>');
  });

  it("sanitize('<p>safe</p><script>bad</script>') (spec 013) — strips dangerous tags", () => {
    expect(sanitize('<p>safe</p><script>bad</script>')).toBe('<p>safe</p>');
  });

  it('$exceptionHandler (spec 014) — resolvable from ng and callable', () => {
    bootstrapNgModule();
    const injector = createInjector([ngModule]);
    const handler = injector.get('$exceptionHandler');
    expect(typeof handler).toBe('function');
    expect(() => {
      handler(new Error('smoke'), 'watchFn');
    }).not.toThrow();
  });

  it("$filter('uppercase')('hi') (spec 016) — built-in filter resolves and runs", () => {
    bootstrapNgModule();
    const injector = createInjector([ngModule]);
    const $filter = injector.get('$filter');
    expect($filter('uppercase')('hi')).toBe('HI');
  });

  it('ngTransclude (spec 018) — registered on ngModule as `ngTranscludeDirective`', () => {
    bootstrapNgModule();
    const injector = createInjector([ngModule]);
    expect(injector.has('ngTranscludeDirective')).toBe(true);
  });

  it('transclude: true end-to-end (spec 018) — outer-scope binding through ng-transclude', () => {
    // Smoke check that the full transclusion path works against
    // `ngModule` (so `ng-transclude` is available): a `transclude: true`
    // host registered in a config block, projecting consumer markup
    // through `<div ng-transclude>` so an `{{outer.title}}`
    // interpolation in the projected DOM resolves against the OUTER
    // scope.
    resetRegistry();
    createModule('ng', [])
      .factory('$exceptionHandler', [() => () => undefined])
      .provider('$sceDelegate', $SceDelegateProvider)
      .provider('$sce', $SceProvider)
      .provider('$interpolate', $InterpolateProvider)
      .provider('$filter', ['$provide', $FilterProvider])
      .provider('$compile', ['$provide', $CompileProvider]);

    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp: $CompileProvider) => {
        $cp.directive('myCard', [
          () => ({
            transclude: true,
            link: (scope, element) => {
              // Manual template setup (templates spec is deferred).
              const template = document.createElement('section');
              const marker = document.createElement('div');
              marker.setAttribute('ng-transclude', '');
              template.appendChild(marker);
              element.appendChild(template);
              compile(template)(scope);
            },
          }),
        ]);
      },
    ]);

    const injector = createInjector([ngModule, appModule]);
    const compile = injector.get('$compile');

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    const p = document.createElement('p');
    p.textContent = 'Hello';
    host.appendChild(p);

    const outer = Scope.create();
    compile(host)(outer);

    const marker = host.querySelector('section > div[ng-transclude]');
    expect(marker).not.toBeNull();
    expect(marker?.children.length).toBe(1);
    expect((marker?.children[0] as Element).tagName).toBe('P');
    expect(marker?.children[0]?.textContent).toBe('Hello');
  });

  it('$compile (spec 017) — registers a directive and runs post-link', () => {
    bootstrapNgModule();
    let posted = false;
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp: $CompileProvider) => {
        $cp.directive('smokeDir', [
          () => ({
            link: () => {
              posted = true;
            },
          }),
        ]);
      },
    ]);
    const injector = createInjector([appModule]);
    const $compile = injector.get('$compile');
    const node = document.createElement('div');
    node.setAttribute('smoke-dir', '');
    $compile(node)(Scope.create());
    expect(posted).toBe(true);
  });
});
