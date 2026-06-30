/**
 * Tests for the JSONP transport + `$sce` trusted-destination hard gate
 * (spec 038 Slice 6 / FS §2.2, §2.12, §3; tech §2.3 JSONP path, §2.7).
 *
 * Two surfaces are exercised:
 *
 * - **The pure `createHttpBackend({ … })` JSONP transport** — a generated
 *   global callback is registered, the `JSON_CALLBACK` placeholder in the URL
 *   is substituted with that name (or a `callback=` param is appended when no
 *   placeholder is present), a `<script>` is appended, the callback firing
 *   resolves the deferred with a `RawResponse`, and EVERYTHING (the script
 *   node + the global callback) is cleaned up on settle. A missing `document`
 *   rejects with a clear error.
 *
 * - **The `$http.jsonp` / `method: 'JSONP'` `$sce` gate (the §3 hard gate)** —
 *   wired through a real `createInjector(['ng', appModule])`. A TRUSTED URL
 *   (allow-listed via a `$sceDelegateProvider` config block) proceeds and a
 *   `<script>` is appended; an UNTRUSTED URL is refused BEFORE any `<script>`
 *   is appended (the promise rejects with NO DOM/network activity).
 *
 * The injector tests override `$httpBackend` with a `createHttpBackend`
 * instance bound to a STUB `documentRef` / `globalRef` so script appends are
 * observable and the JSONP callback can be invoked deterministically — no real
 * cross-origin `<script>` is ever loaded.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createQ } from '@async/q';
import type { QService } from '@async/q-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule } from '@di/module';
import { noopExceptionHandler } from '@exception-handler/index';
import {
  createHttpBackend,
  HttpTransportError,
  JSONP_CALLBACK_PLACEHOLDER,
  type JsonpDocument,
  type JsonpGlobal,
} from '@http/http-backend';
import type { HttpBackend, HttpResponse, RawResponse } from '@http/http-types';

/** A `$q` wired to a real root scope so resolving a deferred drains via digest. */
function makeQ(): { q: QService; scope: Scope } {
  const scope = Scope.create();
  const q = createQ({
    exceptionHandler: noopExceptionHandler,
    scheduleDigest: (fn) => {
      scope.$evalAsync(fn);
    },
  });
  return { q, scope };
}

/** Drain the interleaved microtask + digest cycles JSONP settlement chains through. */
async function flush(scope: Scope): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    scope.$digest();
  }
}

/**
 * A minimal stub `document` exposing exactly the surface the JSONP transport
 * touches: `createElement('script')` and a `head` to append to. Returns real
 * jsdom `<script>` elements (so `addEventListener('load'|'error')` works) but
 * never inserts them into the live document — we hold them so a test can
 * dispatch a `load` event to simulate the script tag executing.
 */
function makeFakeDocument(): { documentRef: JsonpDocument; appended: HTMLScriptElement[]; head: HTMLElement } {
  const head = document.createElement('div');
  const appended: HTMLScriptElement[] = [];
  const documentRef: JsonpDocument = {
    createElement: () => {
      const script = document.createElement('script');
      const realAppend = head.appendChild.bind(head);
      // Record the node when it is appended so the test can find + fire it.
      head.appendChild = ((node: Node) => {
        if (node === script) {
          appended.push(script);
        }
        return realAppend(node as HTMLScriptElement);
      }) as typeof head.appendChild;
      return script;
    },
    head,
    body: null,
  };
  return { documentRef, appended, head };
}

describe('createHttpBackend() — JSONP transport (tech §2.3 / §2.7)', () => {
  it('substitutes the generated callback name for the JSON_CALLBACK placeholder', () => {
    const { q } = makeQ();
    const { documentRef, appended } = makeFakeDocument();
    const globalRef: JsonpGlobal = {};
    const backend = createHttpBackend({ q, documentRef, globalRef });

    backend({ method: 'JSONP', url: `https://api.example.com/x?cb=${JSONP_CALLBACK_PLACEHOLDER}` }, {});

    expect(appended).toHaveLength(1);
    const callbackName = Object.keys(globalRef)[0];
    expect(callbackName).toBeDefined();
    expect(appended[0]?.src).toContain(`cb=${callbackName ?? ''}`);
    expect(appended[0]?.src).not.toContain(JSONP_CALLBACK_PLACEHOLDER);
  });

  it('substitutes EVERY JSON_CALLBACK occurrence when the placeholder appears more than once', () => {
    const { q } = makeQ();
    const { documentRef, appended } = makeFakeDocument();
    const globalRef: JsonpGlobal = {};
    const backend = createHttpBackend({ q, documentRef, globalRef });

    backend(
      { method: 'JSONP', url: `https://api.example.com/x?cb=${JSONP_CALLBACK_PLACEHOLDER}&jsonp=${JSONP_CALLBACK_PLACEHOLDER}` },
      {},
    );

    const callbackName = Object.keys(globalRef)[0];
    expect(callbackName).toBeDefined();
    // Both params must carry the generated name — no literal placeholder left behind.
    expect(appended[0]?.src).toContain(`cb=${callbackName ?? ''}`);
    expect(appended[0]?.src).toContain(`jsonp=${callbackName ?? ''}`);
    expect(appended[0]?.src).not.toContain(JSONP_CALLBACK_PLACEHOLDER);
  });

  it('appends a callback= param when no placeholder is present', () => {
    const { q } = makeQ();
    const { documentRef, appended } = makeFakeDocument();
    const globalRef: JsonpGlobal = {};
    const backend = createHttpBackend({ q, documentRef, globalRef });

    backend({ method: 'JSONP', url: 'https://api.example.com/x' }, {});

    const callbackName = Object.keys(globalRef)[0];
    expect(appended[0]?.src).toContain(`?callback=${callbackName ?? ''}`);
  });

  it('uses & to append the callback param when the URL already has a query', () => {
    const { q } = makeQ();
    const { documentRef, appended } = makeFakeDocument();
    const globalRef: JsonpGlobal = {};
    const backend = createHttpBackend({ q, documentRef, globalRef });

    backend({ method: 'JSONP', url: 'https://api.example.com/x?a=1' }, {});

    const callbackName = Object.keys(globalRef)[0];
    expect(appended[0]?.src).toContain(`&callback=${callbackName ?? ''}`);
  });

  it('resolves a RawResponse(200) when the global callback fires, then cleans up', async () => {
    const { q, scope } = makeQ();
    const { documentRef, appended } = makeFakeDocument();
    const globalRef: JsonpGlobal = {};
    const backend = createHttpBackend({ q, documentRef, globalRef });

    const settled = vi.fn();
    backend({ method: 'JSONP', url: `https://api.example.com/x?cb=${JSONP_CALLBACK_PLACEHOLDER}` }, {}).then(settled);

    const callbackName = Object.keys(globalRef)[0] as string;
    // Simulate the JSONP response executing the script body: invoke the
    // registered global callback, then dispatch the script's `load` event.
    (globalRef[callbackName] as (data: unknown) => void)({ ok: true });
    appended[0]?.dispatchEvent(new Event('load'));

    await flush(scope);

    expect(settled).toHaveBeenCalledTimes(1);
    const raw = settled.mock.calls[0]?.[0] as RawResponse;
    expect(raw.status).toBe(200);
    expect(raw.data).toEqual({ ok: true });

    // Cleanup: the global callback is deleted and the script node detached.
    expect(callbackName in globalRef).toBe(false);
    expect(appended[0]?.parentNode).toBeNull();
  });

  it('rejects (and cleans up) when the script errors', async () => {
    const { q, scope } = makeQ();
    const { documentRef, appended } = makeFakeDocument();
    const globalRef: JsonpGlobal = {};
    const backend = createHttpBackend({ q, documentRef, globalRef });

    const onFailure = vi.fn();
    backend({ method: 'JSONP', url: 'https://api.example.com/x' }, {}).then(undefined, onFailure);

    const callbackName = Object.keys(globalRef)[0] as string;
    appended[0]?.dispatchEvent(new Event('error'));

    await flush(scope);

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0]?.[0]).toBeInstanceOf(HttpTransportError);
    expect(callbackName in globalRef).toBe(false);
    expect(appended[0]?.parentNode).toBeNull();
  });

  it('rejects with a clear error when no document is available', async () => {
    const { q, scope } = makeQ();
    const backend = createHttpBackend({ q, documentRef: null });

    const onFailure = vi.fn();
    backend({ method: 'JSONP', url: 'https://api.example.com/x' }, {}).then(undefined, onFailure);

    await flush(scope);

    expect(onFailure).toHaveBeenCalledTimes(1);
    const reason = onFailure.mock.calls[0]?.[0] as HttpTransportError;
    expect(reason).toBeInstanceOf(HttpTransportError);
    expect(reason.message).toContain('JSONP requires a DOM');
  });

  it('honors an already-aborted signal — no script appended, rejects', async () => {
    const { q, scope } = makeQ();
    const { documentRef, appended } = makeFakeDocument();
    const controller = new AbortController();
    controller.abort();
    const backend = createHttpBackend({ q, documentRef });

    const onFailure = vi.fn();
    backend({ method: 'JSONP', url: 'https://api.example.com/x' }, { signal: controller.signal }).then(
      undefined,
      onFailure,
    );

    await flush(scope);

    expect(appended).toHaveLength(0);
    expect((onFailure.mock.calls[0]?.[0] as HttpTransportError).kind).toBe('abort');
  });
});

describe('$http.jsonp $sce trusted-destination hard gate (FS §2.12 / §3)', () => {
  const TRUSTED = 'https://trusted.example.com/data?cb=JSON_CALLBACK';
  const UNTRUSTED = 'https://evil.example.com/steal?cb=JSON_CALLBACK';

  let fake: ReturnType<typeof makeFakeDocument>;
  let fakeGlobal: JsonpGlobal;

  let appCounter = 0;

  /**
   * Build an injector from the live `ngModule` (registered at import time —
   * NOT reset here, mirroring `http-core.test.ts`) plus a per-test app module
   * that (a) allow-lists the trusted origin via a `$sceDelegateProvider`
   * config block and (b) overrides `$httpBackend` with a JSONP backend bound
   * to our stub document/global so script appends are observable. Each test
   * uses a unique module name to avoid a `createModule` name collision.
   */
  function buildInjector() {
    appCounter += 1;
    const appModule = createModule(`jsonp-app-${String(appCounter)}`, ['ng'])
      .config([
        '$sceDelegateProvider',
        (p: { trustedResourceUrlList(list: readonly (string | RegExp)[]): unknown }) => {
          p.trustedResourceUrlList(['self', 'https://trusted.example.com/**']);
        },
      ])
      .factory('$httpBackend', [
        '$q',
        (q: QService): HttpBackend => createHttpBackend({ q, documentRef: fake.documentRef, globalRef: fakeGlobal }),
      ]);
    return createInjector([ngModule, appModule]);
  }

  beforeEach(() => {
    fake = makeFakeDocument();
    fakeGlobal = {};
  });

  it('a TRUSTED JSONP URL proceeds — a <script> is appended and the callback resolves the promise', async () => {
    const injector = buildInjector();
    const $http = injector.get('$http');
    const $rootScope = injector.get('$rootScope');

    const onSuccess = vi.fn();
    $http.jsonp<{ value: number }>(TRUSTED).then(onSuccess);

    $rootScope.$digest();

    // The trust check passed and the backend injected a <script>.
    expect(fake.appended).toHaveLength(1);

    const callbackName = Object.keys(fakeGlobal)[0] as string;
    (fakeGlobal[callbackName] as (data: unknown) => void)({ value: 42 });
    fake.appended[0]?.dispatchEvent(new Event('load'));

    await flush($rootScope as unknown as Scope);

    expect(onSuccess).toHaveBeenCalledTimes(1);
    const res = onSuccess.mock.calls[0]?.[0] as HttpResponse<{ value: number }>;
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ value: 42 });
  });

  it('an UNTRUSTED JSONP URL is refused BEFORE any <script> is appended', async () => {
    const injector = buildInjector();
    const $http = injector.get('$http');
    const $rootScope = injector.get('$rootScope');

    const onFailure = vi.fn();
    $http.jsonp(UNTRUSTED).then(undefined, onFailure);

    $rootScope.$digest();
    await flush($rootScope as unknown as Scope);

    // The §3 hard gate: NO script, NO global callback — zero DOM activity.
    expect(fake.appended).toHaveLength(0);
    expect(Object.keys(fakeGlobal)).toHaveLength(0);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('the general method:"JSONP" form is gated identically to the shortcut', async () => {
    const injector = buildInjector();
    const $http = injector.get('$http');
    const $rootScope = injector.get('$rootScope');

    const onFailure = vi.fn();
    $http({ method: 'JSONP', url: UNTRUSTED }).then(undefined, onFailure);

    $rootScope.$digest();
    await flush($rootScope as unknown as Scope);

    expect(fake.appended).toHaveLength(0);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });
});
