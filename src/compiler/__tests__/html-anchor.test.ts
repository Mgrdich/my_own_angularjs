/**
 * `a` — native-anchor override directive (spec 030 Slice 5 / FS §2.3,
 * §2.4).
 *
 * Locks the two browser-safety behaviors the directive layers onto every
 * `<a>` element WITHOUT taking ownership of it (`restrict: 'E'`, priority
 * 0, non-terminal, link-only):
 *
 *  - **Empty-link click guard** — a `click` listener reads
 *    `element.getAttribute('href')` AT CLICK TIME and calls
 *    `event.preventDefault()` when the live value is `null` (attribute
 *    absent) or `''` (present but empty). jsdom does NOT navigate, so the
 *    guard is asserted via the dispatched event's `.defaultPrevented`
 *    flag — which requires `cancelable: true` on the `MouseEvent`.
 *    Reading at click time makes the guard LIVE: an `ng-href`-written URL
 *    is seen and navigation proceeds. The listener is removed on the
 *    linked scope's `$destroy`.
 *  - **New-tab `rel` hardening** — when `target === '_blank'` the
 *    directive token-merges `noopener` + `noreferrer` into the current
 *    `rel`, preserving author tokens, idempotently, one-way. The merge
 *    runs at link time (static `target`) AND via `attrs.$observe('target',
 *    …)` (interpolated / late-set `target`).
 *
 * Bootstrap mirrors the spec-025 `ng-url-aliases.test.ts` pattern —
 * re-builds the canonical `'ng'` module's registry entry, then composes a
 * fresh `'app'` module rooted at the canonical `ngModule` instance so the
 * `a` directive AND the `ngHref` / `ngClick` directives registered by
 * `src/core/ng-module.ts` are reachable end-to-end (the live-transition
 * case drives `ng-href`, and the composition case drives `ng-click`).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $ControllerProvider } from '@controller/controller-provider';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import { createTemplateCache } from '@template/template-cache';
import { createTemplateRequest } from '@template/template-request';
import type { TemplateCacheService, TemplateRequestFn } from '@template/template-types';

interface InjectorLike {
  has: (name: string) => boolean;
}

interface Bootstrap {
  $compile: CompileService;
  injector: InjectorLike;
}

function bootstrap(): Bootstrap {
  resetRegistry();
  createModule('ng', [])
    .factory('$exceptionHandler', [() => (): void => undefined])
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

  const appModule = createModule('htmlAnchorTestApp', ['ng']);
  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get('$compile'),
    injector: built,
  };
}

/** Dispatch a cancelable click and return the dispatched event. */
function clickOn(el: Element): MouseEvent {
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
}

/** Recover the `rel` tokens as a Set for order-independent assertions. */
function relTokens(el: Element): Set<string> {
  return new Set((el.getAttribute('rel') ?? '').split(/\s+/).filter(Boolean));
}

afterEach(() => {
  resetRegistry();
});

describe('a — registration on ngModule (spec 030 Slice 5)', () => {
  it('injector.has("aDirective") === true when "ng" is in the deps chain', () => {
    const b = bootstrap();
    expect(b.injector.has('aDirective')).toBe(true);
  });
});

describe('a — empty-link click guard (FS §2.3)', () => {
  it('prevents the default for <a href="">', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const a = document.createElement('a');
    a.setAttribute('href', '');

    b.$compile(a)(scope);
    scope.$digest();

    const ev = clickOn(a);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('prevents the default for an href-less <a>', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const a = document.createElement('a');
    a.textContent = 'Click';

    b.$compile(a)(scope);
    scope.$digest();

    const ev = clickOn(a);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('does NOT prevent the default for <a href="https://example.com">', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const a = document.createElement('a');
    a.setAttribute('href', 'https://example.com');

    b.$compile(a)(scope);
    scope.$digest();

    const ev = clickOn(a);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('live transition: ng-href empty → prevented, then real URL → not prevented', () => {
    const b = bootstrap();
    const scope = Scope.create<{ url?: string }>();
    const a = document.createElement('a');
    // ng-href writes the real `href` only once `url` resolves non-empty.
    a.setAttribute('ng-href', '{{url}}');

    b.$compile(a)(scope);
    scope.$digest();

    // url is undefined → ng-href has not written a real href → guard fires.
    const before = clickOn(a);
    expect(before.defaultPrevented).toBe(true);

    // Resolve the URL; the digest lets ng-href write `href` into the DOM.
    scope.url = 'https://example.com';
    scope.$digest();
    expect(a.getAttribute('href')).toBe('https://example.com');

    // The click-time read now sees the ng-href-written value → no prevent.
    const after = clickOn(a);
    expect(after.defaultPrevented).toBe(false);
  });

  it('removes the click listener on scope $destroy (subsequent click NOT prevented)', () => {
    const b = bootstrap();
    const scope = Scope.create();
    // The directive binds $on('$destroy') to the scope it links against;
    // a child scope lets us destroy exactly that linked scope.
    const child = scope.$new();
    const a = document.createElement('a');
    a.setAttribute('href', '');

    b.$compile(a)(child);
    child.$digest();

    // Sanity: guard is active before destroy.
    expect(clickOn(a).defaultPrevented).toBe(true);

    child.$destroy();

    // Listener gone → empty href no longer prevented.
    expect(clickOn(a).defaultPrevented).toBe(false);
  });
});

describe('a — new-tab rel hardening (FS §2.4)', () => {
  it('static target="_blank" gains noopener AND noreferrer at link time (pre-digest)', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const a = document.createElement('a');
    a.setAttribute('href', 'https://example.com');
    a.setAttribute('target', '_blank');

    // Link, but do NOT digest — the link-time check covers static target.
    b.$compile(a)(scope);

    const tokens = relTokens(a);
    expect(tokens.has('noopener')).toBe(true);
    expect(tokens.has('noreferrer')).toBe(true);
  });

  it('preserves the author rel token: rel="license" → license + noopener + noreferrer', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const a = document.createElement('a');
    a.setAttribute('href', 'https://example.com');
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'license');

    b.$compile(a)(scope);

    const tokens = relTokens(a);
    expect(tokens.has('license')).toBe(true);
    expect(tokens.has('noopener')).toBe(true);
    expect(tokens.has('noreferrer')).toBe(true);
  });

  it('anchor without target="_blank" gets ZERO rel changes', () => {
    const b = bootstrap();
    const scope = Scope.create();

    // No target attribute at all.
    const noTarget = document.createElement('a');
    noTarget.setAttribute('href', 'https://example.com');
    b.$compile(noTarget)(scope);
    scope.$digest();
    expect(noTarget.hasAttribute('rel')).toBe(false);

    // target="_self" is not "_blank" → no hardening.
    const selfTarget = document.createElement('a');
    selfTarget.setAttribute('href', 'https://example.com');
    selfTarget.setAttribute('target', '_self');
    b.$compile(selfTarget)(scope);
    scope.$digest();
    expect(selfTarget.getAttribute('rel')).toBeNull();
  });

  it('interpolated target: hardening fires only once it resolves to "_blank"', () => {
    const b = bootstrap();
    const scope = Scope.create<{ t?: string }>();
    const a = document.createElement('a');
    a.setAttribute('href', 'https://example.com');
    a.setAttribute('target', '{{t}}');

    b.$compile(a)(scope);

    // t initially not "_blank" → no hardening.
    scope.t = '_self';
    scope.$digest();
    expect(a.hasAttribute('rel')).toBe(false);

    // Resolve to "_blank" → observer fires → tokens merged.
    scope.t = '_blank';
    scope.$digest();
    const tokens = relTokens(a);
    expect(tokens.has('noopener')).toBe(true);
    expect(tokens.has('noreferrer')).toBe(true);
  });

  it('is idempotent across repeated observer fires (no duplicate tokens)', () => {
    const b = bootstrap();
    const scope = Scope.create<{ t?: string; other?: string }>();
    const a = document.createElement('a');
    a.setAttribute('href', 'https://example.com');
    a.setAttribute('target', '{{t}}');

    b.$compile(a)(scope);

    scope.t = '_blank';
    scope.$digest();

    // Re-fire the digest a few more times (target observer may re-notify);
    // tokens must each appear exactly once.
    scope.other = 'x';
    scope.$digest();
    scope.other = 'y';
    scope.$digest();

    const rel = a.getAttribute('rel') ?? '';
    const all = rel.split(/\s+/).filter(Boolean);
    expect(all.filter((tok) => tok === 'noopener')).toHaveLength(1);
    expect(all.filter((tok) => tok === 'noreferrer')).toHaveLength(1);
  });
});

describe('a — composition with ng-click on the same element (FS §2.3)', () => {
  it('a click fires the ng-click handler AND the empty-href guard', () => {
    const b = bootstrap();
    const onClick = vi.fn();
    const scope = Scope.create<{ onClick: () => void }>();
    scope.onClick = onClick;

    const a = document.createElement('a');
    a.setAttribute('href', '');
    a.setAttribute('ng-click', 'onClick()');

    b.$compile(a)(scope);
    scope.$digest();

    const ev = clickOn(a);

    // ng-click invoked the scope method...
    expect(onClick).toHaveBeenCalledTimes(1);
    // ...AND the empty-href guard prevented navigation.
    expect(ev.defaultPrevented).toBe(true);
  });
});
