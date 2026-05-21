/**
 * `ngCloak` directive — compile-time attribute / class cleanup
 * (spec 023 Slice 2 / FS §2.2).
 *
 * Locks the AngularJS-canonical behavior for the built-in `ngCloak`
 * directive registered on `ngModule`:
 *
 * - Attribute form: `<div ng-cloak>` — `ng-cloak` attribute removed
 *   once `$compile` reaches the element.
 * - Class form: `<div class="ng-cloak">` — `ng-cloak` class removed
 *   once `$compile` reaches the element.
 * - Idempotent — compiling a clean element (no attribute, no class)
 *   does NOT throw.
 * - Other classes on the element are preserved when `ng-cloak` is
 *   removed.
 * - No watcher is installed — the directive is purely a compile-time
 *   DOM cleanup. Per-digest cost is zero.
 *
 * Tests use the canonical `ngModule` so the `ngCloak` directive
 * registered by `src/core/ng-module.ts` is reachable end-to-end —
 * mirroring the `ng-transclude.test.ts` and `cross-spec-smoke` patterns.
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

/**
 * Narrow view of the injector surface the tests touch — keeps the
 * type-as-much-as-needed convention consistent with `ng-transclude.test.ts`.
 */
interface InjectorLike {
  has: (name: string) => boolean;
}

interface Bootstrap {
  $compile: CompileService;
  injector: InjectorLike;
}

/**
 * Build an injector rooted at the canonical `ngModule` so the
 * `ngCloak` directive registered by `src/core/ng-module.ts` is
 * reachable. Mirrors the `ng-transclude.test.ts` bootstrap pattern.
 */
function bootstrap(): Bootstrap {
  resetRegistry();
  // Rebuild the canonical `'ng'` module's registry entry so dependent
  // `getModule('ng')` lookups during injector construction see a
  // populated module. The canonical `ngModule` instance (imported
  // above) is what `createInjector` actually consumes.
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

  const appModule = createModule('app', ['ng']);
  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get('$compile'),
    injector: built,
  };
}

afterEach(() => {
  resetRegistry();
});

describe('ngCloak — registration on ngModule', () => {
  it('injector.has("ngCloakDirective") === true when "ng" is in the deps chain', () => {
    const b = bootstrap();
    expect(b.injector.has('ngCloakDirective')).toBe(true);
  });
});

describe('ngCloak — attribute form removed after compile (FS §2.2)', () => {
  it('removes the `ng-cloak` attribute once $compile reaches the element', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const element = document.createElement('div');
    element.setAttribute('ng-cloak', '');
    element.textContent = 'some content';

    expect(element.hasAttribute('ng-cloak')).toBe(true);

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.hasAttribute('ng-cloak')).toBe(false);
    // Content is untouched — the directive only cleans up the
    // attribute / class.
    expect(element.textContent).toBe('some content');
  });
});

describe('ngCloak — class form removed after compile (FS §2.2)', () => {
  it('removes the `ng-cloak` class once $compile reaches the element', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const element = document.createElement('div');
    element.className = 'ng-cloak';
    element.textContent = 'content';

    expect(element.classList.contains('ng-cloak')).toBe(true);

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('ng-cloak')).toBe(false);
    expect(element.textContent).toBe('content');
  });
});

describe('ngCloak — both forms simultaneously', () => {
  it('removes both the attribute AND the class when an element carries both', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const element = document.createElement('div');
    element.setAttribute('ng-cloak', '');
    element.className = 'ng-cloak';

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.hasAttribute('ng-cloak')).toBe(false);
    expect(element.classList.contains('ng-cloak')).toBe(false);
  });
});

describe('ngCloak — idempotent on a clean element', () => {
  it('does NOT throw when compiling a `<div>` with no `ng-cloak` attribute or class', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const element = document.createElement('div');
    // No ng-cloak attribute, no ng-cloak class — the directive does
    // not match this element at all, so this test mostly exists to
    // assert the surrounding plumbing is sane. The real idempotency
    // guarantee is that `removeAttribute` / `classList.remove` are
    // DOM no-ops on missing inputs.
    expect(() => {
      b.$compile(element)(scope);
      scope.$digest();
    }).not.toThrow();

    expect(element.hasAttribute('ng-cloak')).toBe(false);
    expect(element.classList.contains('ng-cloak')).toBe(false);
  });
});

describe('ngCloak — other classes preserved', () => {
  it('keeps sibling classes intact when removing `ng-cloak`', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const element = document.createElement('div');
    element.className = 'foo ng-cloak bar';

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.classList.contains('ng-cloak')).toBe(false);
    expect(element.classList.contains('foo')).toBe(true);
    expect(element.classList.contains('bar')).toBe(true);
  });
});

describe('ngCloak — no watch installed (zero per-digest cost)', () => {
  it('does not register any watcher on the scope', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const element = document.createElement('div');
    element.setAttribute('ng-cloak', '');

    // Capture the watcher count BEFORE compile so we can assert
    // nothing was added.
    const before = scope.$$watchers?.length ?? 0;

    b.$compile(element)(scope);

    const after = scope.$$watchers?.length ?? 0;

    expect(after).toBe(before);
    // Same assertion via the runtime — a digest with no watchers does
    // not throw and does not exercise any expression evaluation paths.
    expect(() => {
      scope.$digest();
    }).not.toThrow();
  });
});

describe('ngCloak — both restrict modes route to the same compile fn', () => {
  it('attribute form and class form produce the same cleanup behavior', () => {
    const b = bootstrap();

    // Attribute form
    const attrEl = document.createElement('div');
    attrEl.setAttribute('ng-cloak', '');
    const attrScope = Scope.create();
    b.$compile(attrEl)(attrScope);
    attrScope.$digest();

    // Class form
    const classEl = document.createElement('div');
    classEl.className = 'ng-cloak';
    const classScope = Scope.create();
    b.$compile(classEl)(classScope);
    classScope.$digest();

    // Sanity — both forms produce a clean element with neither the
    // attribute nor the class present.
    expect(attrEl.hasAttribute('ng-cloak')).toBe(false);
    expect(attrEl.classList.contains('ng-cloak')).toBe(false);
    expect(classEl.hasAttribute('ng-cloak')).toBe(false);
    expect(classEl.classList.contains('ng-cloak')).toBe(false);
  });
});
