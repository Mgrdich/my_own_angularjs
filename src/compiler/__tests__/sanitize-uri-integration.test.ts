/**
 * Integration tests for the compiler-level URL sanitizer (spec 034
 * Slice 2 / FS §2 — `aHrefSanitizationTrustedUrlList` /
 * `imgSrcSanitizationTrustedUrlList`).
 *
 * Locks the END-TO-END behavior through real `$compile` + digest:
 *
 *  - The default `aHrefSanitizationTrustedUrlList` neutralizes a
 *    `javascript:` URL written through an interpolated `href` (→
 *    `unsafe:javascript:…`) AND a safe URL passes through unchanged.
 *  - The default `imgSrcSanitizationTrustedUrlList` neutralizes a
 *    dangerous URL written through `ng-src` (→ `unsafe:…`) AND a safe
 *    `data:image/` source passes through unchanged.
 *  - A CUSTOM pattern set in a `config` block changes which URLs survive.
 *  - Both getters return the current pattern.
 *
 * THIS IS A DELIBERATE BEHAVIOR CHANGE from spec 031, which routed
 * interpolated `href`/`src` through SCE but with a pass-through URL
 * context (no `unsafe:` neutralization). See
 * `context/spec/034-compile-provider-config/technical-considerations.md`
 * §3 — the AngularJS-standard safe-URL default is shipped on purpose.
 *
 * Bootstrap mirrors the spec-031 `attr-interpolate.test.ts` pattern.
 */

import { afterEach, describe, expect, it } from 'vitest';

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
import type { TemplateCacheService, TemplateRequestFn } from '@template/template-types';

type ConfigBlock = readonly [unknown, (...args: never[]) => void];

interface Bootstrap {
  $compile: CompileService;
  injector: { get: (name: string) => unknown };
}

function buildNg(): void {
  resetRegistry();
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
}

function bootstrap(configBlocks: readonly ConfigBlock[] = []): Bootstrap {
  buildNg();
  const appModule = createModule('app', ['ng']);
  for (const block of configBlocks) {
    appModule.config(block as never);
  }
  const built = createInjector([ngModule, appModule]);
  return { $compile: built.get('$compile'), injector: built };
}

afterEach(() => {
  resetRegistry();
});

describe('aHrefSanitizationTrustedUrlList — default neutralizes dangerous href (FS §2)', () => {
  it('<a href="{{u}}"> with javascript: → unsafe:javascript:…', () => {
    const { $compile } = bootstrap();
    const scope = Scope.create();
    scope.u = 'javascript:alert(1)';

    const element = document.createElement('a');
    element.setAttribute('href', '{{u}}');

    $compile(element)(scope);
    scope.$digest();

    // DELIBERATE behavior change vs. spec 031 (was: passthrough).
    expect(element.getAttribute('href')).toBe('unsafe:javascript:alert(1)');
  });

  it('<a href="{{u}}"> with a safe https URL passes through unchanged', () => {
    const { $compile } = bootstrap();
    const scope = Scope.create();
    scope.u = 'https://example.com/profile';

    const element = document.createElement('a');
    element.setAttribute('href', '{{u}}');

    $compile(element)(scope);
    scope.$digest();

    expect(element.getAttribute('href')).toBe('https://example.com/profile');
  });

  it('<a href="{{u}}"> with a relative URL passes through unchanged', () => {
    const { $compile } = bootstrap();
    const scope = Scope.create();
    scope.u = '/users/42';

    const element = document.createElement('a');
    element.setAttribute('href', '{{u}}');

    $compile(element)(scope);
    scope.$digest();

    expect(element.getAttribute('href')).toBe('/users/42');
  });
});

describe('imgSrcSanitizationTrustedUrlList — default neutralizes dangerous src (FS §2)', () => {
  it('<img ng-src="{{u}}"> with a dangerous data:text/html URL → unsafe:…', () => {
    const { $compile } = bootstrap();
    const scope = Scope.create();
    scope.u = 'data:text/html,<script>alert(1)</script>';

    const element = document.createElement('img');
    element.setAttribute('ng-src', '{{u}}');

    $compile(element)(scope);
    scope.$digest();

    expect(element.getAttribute('src')).toBe('unsafe:data:text/html,<script>alert(1)</script>');
  });

  it('<img ng-src="{{u}}"> with a safe data:image/png URL passes through unchanged', () => {
    const { $compile } = bootstrap();
    const scope = Scope.create();
    scope.u = 'data:image/png;base64,AAAA';

    const element = document.createElement('img');
    element.setAttribute('ng-src', '{{u}}');

    $compile(element)(scope);
    scope.$digest();

    expect(element.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });

  it('<img src="{{u}}"> (interpolated, not ng-src) with javascript: → unsafe:…', () => {
    const { $compile } = bootstrap();
    const scope = Scope.create();
    scope.u = 'javascript:alert(1)';

    const element = document.createElement('img');
    element.setAttribute('src', '{{u}}');

    $compile(element)(scope);
    scope.$digest();

    expect(element.getAttribute('src')).toBe('unsafe:javascript:alert(1)');
  });
});

describe('custom pattern set in a config block changes which URLs survive', () => {
  it('aHrefSanitizationTrustedUrlList(/^myapp:/) lets myapp: through and blocks https:', () => {
    const { $compile } = bootstrap([
      [
        '$compileProvider',
        ($cp: $CompileProvider): void => {
          $cp.aHrefSanitizationTrustedUrlList(/^myapp:/);
        },
      ],
    ]);

    const scope = Scope.create();
    const okEl = document.createElement('a');
    okEl.setAttribute('href', '{{u}}');
    scope.u = 'myapp:open/thing';
    $compile(okEl)(scope);
    scope.$digest();
    expect(okEl.getAttribute('href')).toBe('myapp:open/thing');

    const blockedEl = document.createElement('a');
    blockedEl.setAttribute('href', '{{u2}}');
    const scope2 = Scope.create();
    scope2.u2 = 'https://example.com';
    $compile(blockedEl)(scope2);
    scope2.$digest();
    // https: no longer matches the custom /^myapp:/ pattern.
    expect(blockedEl.getAttribute('href')).toBe('unsafe:https://example.com');
  });

  it('custom imgSrcSanitizationTrustedUrlList drives ng-src sanitization', () => {
    const { $compile } = bootstrap([
      [
        '$compileProvider',
        ($cp: $CompileProvider): void => {
          $cp.imgSrcSanitizationTrustedUrlList(/^https:/);
        },
      ],
    ]);

    const scope = Scope.create();
    const el = document.createElement('img');
    el.setAttribute('ng-src', '{{u}}');
    scope.u = 'data:image/png;base64,AAAA';
    $compile(el)(scope);
    scope.$digest();
    // data:image/ no longer matches the custom /^https:/ pattern.
    expect(el.getAttribute('src')).toBe('unsafe:data:image/png;base64,AAAA');
  });
});

describe('getters return the current pattern', () => {
  it('default getters return RegExp values', () => {
    let aHref: unknown;
    let imgSrc: unknown;
    bootstrap([
      [
        '$compileProvider',
        ($cp: $CompileProvider): void => {
          aHref = $cp.aHrefSanitizationTrustedUrlList();
          imgSrc = $cp.imgSrcSanitizationTrustedUrlList();
        },
      ],
    ]);
    expect(aHref).toBeInstanceOf(RegExp);
    expect(imgSrc).toBeInstanceOf(RegExp);
  });

  it('getter returns the custom pattern after a setter call (chainable)', () => {
    const custom = /^myapp:/;
    let readBack: unknown;
    let chained: unknown;
    bootstrap([
      [
        '$compileProvider',
        ($cp: $CompileProvider): void => {
          chained = $cp.aHrefSanitizationTrustedUrlList(custom);
          readBack = $cp.aHrefSanitizationTrustedUrlList();
        },
      ],
    ]);
    expect(readBack).toBe(custom);
    // Setter returns `this` for chaining.
    expect(typeof (chained as { directive?: unknown }).directive).toBe('function');
  });

  it('setter rejects a non-RegExp argument', () => {
    expect(() =>
      bootstrap([
        [
          '$compileProvider',
          ($cp: $CompileProvider): void => {
            // @ts-expect-error — runtime validation guard.
            $cp.aHrefSanitizationTrustedUrlList('not a regexp');
          },
        ],
      ]),
    ).toThrow(TypeError);
  });
});
