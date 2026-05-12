/**
 * Wrapper-pattern integration — `transclude: true` + inline `template`
 * / async `templateUrl` + `<ng-transclude>` (spec 019 Slice 6 / FS §2.9).
 *
 * The wrapper pattern is the canonical AngularJS shape: a directive
 * captures consumer children, installs a template that provides the
 * chrome (`<div class="card">…`), and the template contains
 * `<ng-transclude>` markers that project the captured content into
 * named slots. The transcluded scope binds against the OUTER scope per
 * spec 018 §2.5 — preserved by this slice.
 *
 * Async coverage: the same wrapper pattern works when `template` is
 * replaced by `templateUrl`. Capture runs SYNCHRONOUSLY at the
 * compile-time pre-pass (spec 018), the template installs in a
 * microtask (this slice), and `<ng-transclude>` inside the fetched
 * template projects the captured content once the install completes.
 *
 * Async test discipline mirrors `template-url.test.ts` — `await
 * Promise.resolve()` two or three times to flush the drain chain.
 *
 * Each test resets the registry and re-registers an empty `'ng'` so
 * the `appModule.requires` lookup succeeds; `loadModule(ngModule)`
 * drains the original `ngModule` const's invoke-queue (with the
 * registered `ngTransclude` directive). The freshly-created empty
 * `'ng'` is short-circuited by `loadedModules.has('ng')` once the
 * original const has loaded.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import type { TemplateCacheService } from '@template/template-types';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function rebuildEmptyNg(): void {
  resetRegistry();
  // Re-register an EMPTY `ng` module so `appModule.requires: ['ng']`
  // resolves. The original `ngModule` const (loaded in the
  // `createInjector` call below) carries the actual provider + directive
  // registrations; the empty one is short-circuited by
  // `loadModule`'s idempotence check.
  createModule('ng', []);
}

afterEach(() => {
  resetRegistry();
});

describe('transclude: true + inline template (FS §2.9 — wrapper pattern)', () => {
  it('captured consumer content projects through `<div ng-transclude>` inside the template', () => {
    rebuildEmptyNg();
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp: $CompileProvider) => {
        $cp.directive('myCard', [
          () => ({
            transclude: true,
            scope: true,
            template: '<div class="card"><h2>title</h2><div ng-transclude></div></div>',
          }),
        ]);
      },
    ]);
    const injector = createInjector([ngModule, appModule]);
    const $compile = injector.get<CompileService>('$compile');

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    const projected = document.createElement('p');
    projected.textContent = 'consumer';
    host.appendChild(projected);

    const outer = Scope.create();
    $compile(host)(outer);
    outer.$digest();

    const wrapper = host.querySelector('div.card');
    expect(wrapper).not.toBeNull();
    const marker = host.querySelector('div[ng-transclude]');
    expect(marker).not.toBeNull();
    expect(marker?.children.length).toBe(1);
    expect((marker?.children[0] as Element).tagName).toBe('P');
    expect(marker?.children[0]?.textContent).toBe('consumer');
  });

  it('projected attribute binding resolves against OUTER scope (spec 018 §2.5 preserved)', () => {
    rebuildEmptyNg();
    let observed: string | undefined;
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp: $CompileProvider) => {
        $cp.directive('myCard', [
          () => ({
            transclude: true,
            scope: true,
            template: '<div class="card"><div ng-transclude></div></div>',
          }),
        ]);
        $cp.directive('consumerDir', [
          () => ({
            link: (_scope, _el, attrs) => {
              attrs.$observe('attr', (value) => {
                observed = value;
              });
            },
          }),
        ]);
      },
    ]);
    const injector = createInjector([ngModule, appModule]);
    const $compile = injector.get<CompileService>('$compile');

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    const projected = document.createElement('consumer-dir');
    projected.setAttribute('attr', '{{outerVal}}');
    host.appendChild(projected);

    const outer = Scope.create();
    $compile(host)(outer);
    outer.outerVal = 'fromOuter';
    outer.$digest();

    expect(observed).toBe('fromOuter');
  });

  it('template WITHOUT `<ng-transclude>` — captured content is never projected', () => {
    rebuildEmptyNg();
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp: $CompileProvider) => {
        $cp.directive('myCard', [
          () => ({
            transclude: true,
            template: '<div class="card"><h2>no-projection</h2></div>',
          }),
        ]);
      },
    ]);
    const injector = createInjector([ngModule, appModule]);
    const $compile = injector.get<CompileService>('$compile');

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    const projected = document.createElement('p');
    projected.textContent = 'consumer';
    host.appendChild(projected);

    const outer = Scope.create();
    $compile(host)(outer);
    outer.$digest();

    const card = host.querySelector('div.card');
    expect(card).not.toBeNull();
    expect(host.querySelector('p')).toBeNull();
  });
});

describe('transclude: true + async templateUrl (FS §2.9 — wrapper pattern async)', () => {
  it('captured content projects after the templateUrl fetch resolves', async () => {
    rebuildEmptyNg();
    const appModule = createModule('app', ['ng'])
      .config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive('myCard', [
            () => ({
              transclude: true,
              scope: true,
              templateUrl: '/card.html',
            }),
          ]);
        },
      ])
      .run([
        '$templateCache',
        ($templateCache: TemplateCacheService) => {
          $templateCache.put('/card.html', '<div class="card"><div ng-transclude></div></div>');
        },
      ]);
    const injector = createInjector([ngModule, appModule]);
    const $compile = injector.get<CompileService>('$compile');

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    const projected = document.createElement('p');
    projected.textContent = 'async-consumer';
    host.appendChild(projected);

    const outer = Scope.create();
    $compile(host)(outer);

    // Sync linker contract: host's children are empty IMMEDIATELY after
    // linker returns. (The captured <p> is held in the transclusion
    // master fragment, not in host.childNodes.)
    expect(host.firstChild).toBeNull();

    await flushMicrotasks();

    const card = host.querySelector('div.card');
    expect(card).not.toBeNull();
    const marker = host.querySelector('div[ng-transclude]');
    expect(marker).not.toBeNull();
    expect(marker?.children.length).toBe(1);
    expect((marker?.children[0] as Element).tagName).toBe('P');
    expect(marker?.children[0]?.textContent).toBe('async-consumer');
  });

  it('async wrapper projects attribute binding against OUTER scope after install', async () => {
    rebuildEmptyNg();
    let observed: string | undefined;
    const appModule = createModule('app', ['ng'])
      .config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive('myCard', [
            () => ({
              transclude: true,
              scope: true,
              templateUrl: '/card.html',
            }),
          ]);
          $cp.directive('consumerDir', [
            () => ({
              link: (_scope, _el, attrs) => {
                attrs.$observe('attr', (value) => {
                  observed = value;
                });
              },
            }),
          ]);
        },
      ])
      .run([
        '$templateCache',
        ($templateCache: TemplateCacheService) => {
          $templateCache.put('/card.html', '<div class="card"><div ng-transclude></div></div>');
        },
      ]);
    const injector = createInjector([ngModule, appModule]);
    const $compile = injector.get<CompileService>('$compile');

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    const projected = document.createElement('consumer-dir');
    projected.setAttribute('attr', '{{outerVal}}');
    host.appendChild(projected);

    const outer = Scope.create();
    $compile(host)(outer);
    outer.outerVal = 'fromOuterAsync';

    await flushMicrotasks();
    outer.$digest();

    expect(observed).toBe('fromOuterAsync');
  });
});

describe('multi-slot transclusion + template (FS §2.9 acceptance #4)', () => {
  it('named slot is projected by `<div ng-transclude="titleSlot">` inside the template', () => {
    rebuildEmptyNg();
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp: $CompileProvider) => {
        $cp.directive('myCard', [
          () => ({
            transclude: { titleSlot: 'card-title' },
            scope: true,
            template: '<div class="card"><div class="header" ng-transclude="titleSlot"></div></div>',
          }),
        ]);
      },
    ]);
    const injector = createInjector([ngModule, appModule]);
    const $compile = injector.get<CompileService>('$compile');

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    const slotContent = document.createElement('card-title');
    slotContent.textContent = 'My Card Title';
    host.appendChild(slotContent);

    const outer = Scope.create();
    $compile(host)(outer);
    outer.$digest();

    const titleMarker = host.querySelector('div[ng-transclude="titleSlot"]');
    expect(titleMarker).not.toBeNull();
    expect(titleMarker?.children.length).toBe(1);
    expect((titleMarker?.children[0] as Element).tagName).toBe('CARD-TITLE');
    expect(titleMarker?.children[0]?.textContent).toBe('My Card Title');
  });
});
