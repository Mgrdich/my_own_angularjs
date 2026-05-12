/**
 * Multi-template-on-element guard — `MultipleTemplateDirectivesError`
 * (spec 019 Slice 6 / FS §2.10).
 *
 * AngularJS allows AT MOST ONE directive on a given element to declare
 * `template` or `templateUrl`. Two declarations is a programming error
 * — caught at link time and reported via `$exceptionHandler('$compile')`.
 * The FIRST template-declaring directive wins; the SECOND's template
 * declaration is silently ignored. The second directive's OTHER behavior
 * (link, compile, transclude, scope) still runs unchanged.
 *
 * Determinism: the first-wins ordering follows the priority-DESCENDING
 * sort (highest priority wins) with registration-order tie-break,
 * mirroring spec 018's `MultipleTranscludeDirectivesError` semantics.
 *
 * Interaction with `MultipleTranscludeDirectivesError`: the two error
 * classes route independently — when both conditions trigger on the
 * same element, both errors fire (transclude pre-pass first, then
 * template pre-pass).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import { MultipleTemplateDirectivesError, MultipleTranscludeDirectivesError } from '@compiler/compile-error';
import type { CompileService, DirectiveFactory, DirectiveFactoryReturn, LinkFn } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import { createTemplateCache } from '@template/template-cache';
import { createTemplateRequest } from '@template/template-request';
import type { TemplateCacheService, TemplateRequestFn } from '@template/template-types';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

interface Harness {
  handler: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
  $compile: CompileService;
  cache: TemplateCacheService;
}

function bootstrap(register: ($cp: $CompileProvider) => void): Harness {
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

  const appModule = createModule('app', ['ng']).config([
    '$compileProvider',
    ($cp: $CompileProvider) => {
      register($cp);
    },
  ]);
  const injector = createInjector([appModule]);
  return {
    handler,
    $compile: injector.get<CompileService>('$compile'),
    cache: injector.get<TemplateCacheService>('$templateCache'),
  };
}

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

afterEach(() => {
  resetRegistry();
});

describe('MultipleTemplateDirectivesError — template + template (FS §2.10)', () => {
  it('routes the error at link time; first wins; second template ignored', () => {
    const linkB = vi.fn<LinkFn>();
    const { handler, $compile } = bootstrap(($cp) => {
      $cp.directive('dirA', ddoFactory({ template: '<p>A</p>' }));
      $cp.directive('dirB', ddoFactory({ template: '<p>B</p>', link: linkB }));
    });
    const host = document.createElement('div');
    host.setAttribute('dir-a', '');
    host.setAttribute('dir-b', '');
    $compile(host)(Scope.create());

    expect(handler).toHaveBeenCalled();
    const call = handler.mock.calls.find(([err]) => err instanceof MultipleTemplateDirectivesError);
    expect(call).toBeDefined();
    expect(call?.[1]).toBe('$compile');

    // dirA's template wins.
    expect(host.firstElementChild?.tagName).toBe('P');
    expect(host.firstElementChild?.textContent).toBe('A');

    // dirB's link STILL ran.
    expect(linkB).toHaveBeenCalledTimes(1);
  });
});

describe('MultipleTemplateDirectivesError — templateUrl + templateUrl', () => {
  beforeEach(() => {
    // Each test below uses a fresh bootstrap.
  });

  it('routes at link time; first URL is the one fetched and installed', async () => {
    const linkB = vi.fn<LinkFn>();
    const { handler, $compile, cache } = bootstrap(($cp) => {
      $cp.directive('dirA', ddoFactory({ templateUrl: '/a.html' }));
      $cp.directive('dirB', ddoFactory({ templateUrl: '/b.html', link: linkB }));
    });
    cache.put('/a.html', '<p>fromA</p>');
    cache.put('/b.html', '<p>fromB</p>');

    const host = document.createElement('div');
    host.setAttribute('dir-a', '');
    host.setAttribute('dir-b', '');
    $compile(host)(Scope.create());

    // Sync linker contract — host is empty immediately.
    expect(host.firstChild).toBeNull();

    expect(handler).toHaveBeenCalled();
    const call = handler.mock.calls.find(([err]) => err instanceof MultipleTemplateDirectivesError);
    expect(call).toBeDefined();
    expect(call?.[1]).toBe('$compile');

    await flushMicrotasks();

    expect(host.firstElementChild?.textContent).toBe('fromA');
    // dirB's link STILL ran (against the post-template DOM).
    expect(linkB).toHaveBeenCalledTimes(1);
  });
});

describe('MultipleTemplateDirectivesError — template + templateUrl mixed', () => {
  it('mixed template + templateUrl declarations on the same element', () => {
    const linkB = vi.fn<LinkFn>();
    const { handler, $compile, cache } = bootstrap(($cp) => {
      $cp.directive('dirA', ddoFactory({ template: '<p>inline-A</p>' }));
      $cp.directive('dirB', ddoFactory({ templateUrl: '/b.html', link: linkB }));
    });
    cache.put('/b.html', '<p>fromB</p>');

    const host = document.createElement('div');
    host.setAttribute('dir-a', '');
    host.setAttribute('dir-b', '');
    $compile(host)(Scope.create());

    expect(handler).toHaveBeenCalled();
    const call = handler.mock.calls.find(([err]) => err instanceof MultipleTemplateDirectivesError);
    expect(call).toBeDefined();

    // dirA wins (it appeared first in registration order; same priority).
    expect(host.firstElementChild?.textContent).toBe('inline-A');
    expect(linkB).toHaveBeenCalled();
  });
});

describe('first-wins ordering is deterministic (priority desc, registration tie-break)', () => {
  it('higher-priority directive wins regardless of registration order', () => {
    const { handler, $compile } = bootstrap(($cp) => {
      // Register dirA first with LOWER priority; dirB second with HIGHER priority.
      $cp.directive('dirA', ddoFactory({ priority: 1, template: '<p>A</p>' }));
      $cp.directive('dirB', ddoFactory({ priority: 5, template: '<p>B</p>' }));
    });

    const host = document.createElement('div');
    host.setAttribute('dir-a', '');
    host.setAttribute('dir-b', '');
    $compile(host)(Scope.create());

    expect(handler).toHaveBeenCalled();
    const call = handler.mock.calls.find(([err]) => err instanceof MultipleTemplateDirectivesError);
    expect(call).toBeDefined();

    // dirB has higher priority → its template wins.
    expect(host.firstElementChild?.textContent).toBe('B');
  });
});

describe('interaction with MultipleTranscludeDirectivesError', () => {
  it('both errors fire independently when both conditions trigger on the same element', () => {
    const { handler, $compile } = bootstrap(($cp) => {
      $cp.directive('dirA', ddoFactory({ transclude: true, template: '<p>A</p>' }));
      $cp.directive('dirB', ddoFactory({ transclude: true, template: '<p>B</p>' }));
    });

    const host = document.createElement('div');
    host.setAttribute('dir-a', '');
    host.setAttribute('dir-b', '');
    $compile(host)(Scope.create());

    // Both errors routed.
    const transcludeCall = handler.mock.calls.find(([err]) => err instanceof MultipleTranscludeDirectivesError);
    const templateCall = handler.mock.calls.find(([err]) => err instanceof MultipleTemplateDirectivesError);
    expect(transcludeCall).toBeDefined();
    expect(templateCall).toBeDefined();
    expect(transcludeCall?.[1]).toBe('$compile');
    expect(templateCall?.[1]).toBe('$compile');
  });
});
