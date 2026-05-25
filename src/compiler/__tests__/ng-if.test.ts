/**
 * `ngIf` directive — conditional rendering
 * (spec 027 Slice 3 / FS §2.1).
 *
 * Locks the AngularJS-canonical behavior for the built-in `ngIf`
 * directive registered on `ngModule`:
 *
 * - Registration sanity: `injector.has('ngIfDirective') === true`
 *   when an app's module declares `'ng'` in its deps chain.
 * - Truthy mounts a fresh deep clone of the host into the live DOM as
 *   the next sibling of the Comment placeholder.
 * - Falsy keeps the placeholder but detaches any active clone.
 * - Each falsy → truthy transition produces a brand-new clone with a
 *   brand-new transclusion scope (no state carry-over).
 * - Each truthy → falsy transition destroys the active clone's scope
 *   (watchers stop firing, `$on('$destroy', …)` listeners run).
 * - The placeholder permanently occupies the slot the original host
 *   used to occupy in the parent's `childNodes`, so positional drift
 *   across retoggles is impossible.
 * - `restrict: 'A'` — element form `<ng-if expr="…">` does NOT match.
 * - `terminal: true` blocks lower-priority same-element directives via
 *   the spec-017 same-element terminal cutoff (the matched-directive
 *   list is truncated at the terminal priority threshold).
 * - A parent `destroyElementScope(…)` walks through the placeholder's
 *   registered cleanup callback and tears the active clone's scope
 *   down — Comment nodes have no `children` HTMLCollection for the
 *   walker to descend into, so this is the cleanup-callback path
 *   doing the work (per the Slice 2 cleanup-wiring contract).
 *
 * Tests use the canonical `ngModule` so the `ngIf` directive
 * registered by `src/core/ng-module.ts` is reachable end-to-end —
 * mirroring the `ng-bind.test.ts` / `ng-init.test.ts` bootstrap
 * patterns.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import { destroyElementScope } from '@compiler/cleanup';
import type { CompileService, DirectiveFactory, DirectiveFactoryReturn, LinkFn } from '@compiler/directive-types';
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

interface InjectorLike {
  has: (name: string) => boolean;
}

interface ProbeCounters {
  /** Number of times the probe's link fn fired. */
  links: number;
  /** Number of times the probe's `$on('$destroy', …)` listener fired. */
  destroys: number;
}

interface Bootstrap {
  $compile: CompileService;
  injector: InjectorLike;
}

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

/**
 * Builds a `'ng'`-aware `app` module so the `ngIf` directive registered
 * by `ngModule` is reachable, while letting per-test code register
 * additional probe directives via the `register` callback.
 *
 * Mirrors `ng-init.test.ts`'s `bootstrap()` pattern (rather than the
 * compiler-test-helpers `compileWith`) because we need to swap in a
 * spy-friendly `$exceptionHandler` and stage extra directives in the
 * same module graph; the compiler-test-helpers pair targets a single
 * code path per test, while this file exercises multiple shapes per
 * setup.
 */
function bootstrap(register?: ($cp: $CompileProvider) => void): Bootstrap {
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

  const appModule = createModule('ngIfTestApp', ['ng']);
  if (register !== undefined) {
    appModule.config([
      '$compileProvider',
      ($cp: $CompileProvider) => {
        register($cp);
      },
    ]);
  }
  const built = createInjector([ngModule, appModule]);
  return {
    $compile: built.get('$compile'),
    injector: built,
  };
}

afterEach(() => {
  resetRegistry();
});

describe('ngIf — registration on ngModule (spec 027 Slice 3)', () => {
  it('injector.has("ngIfDirective") === true when "ng" is in the deps chain', () => {
    const b = bootstrap();
    expect(b.injector.has('ngIfDirective')).toBe(true);
  });
});

describe('ngIf — truthy / falsy mount semantics (FS §2.1)', () => {
  it('truthy renders the cloned subtree as the next sibling of the placeholder', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = true;

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-if', 'show');
    const inner = document.createElement('span');
    inner.className = 'inner';
    inner.textContent = 'Hi';
    host.appendChild(inner);
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    // Placeholder Comment is installed in the host's original slot;
    // the cloned subtree carries the `.inner` child.
    expect(parent.childNodes.length).toBe(2);
    expect(parent.childNodes[0]?.nodeType).toBe(Node.COMMENT_NODE);
    expect(parent.querySelector('.inner')).not.toBeNull();
    expect(parent.querySelector('.inner')?.textContent).toBe('Hi');
  });

  it('falsy keeps the placeholder but mounts no clone', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = false;

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-if', 'show');
    const inner = document.createElement('span');
    inner.className = 'inner';
    host.appendChild(inner);
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    // Placeholder is present but no clone was mounted.
    expect(parent.childNodes.length).toBe(1);
    expect(parent.childNodes[0]?.nodeType).toBe(Node.COMMENT_NODE);
    expect(parent.querySelector('.inner')).toBeNull();
  });
});

describe('ngIf — toggle lifecycle (FS §2.1)', () => {
  it('truthy → falsy → truthy mounts a brand-new clone (not the previous DOM node)', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = true;

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-if', 'show');
    const inner = document.createElement('span');
    inner.className = 'inner';
    host.appendChild(inner);
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    // First clone — capture the rendered `.inner` and mutate a marker
    // class. If the toggle-back re-uses the SAME clone DOM, the marker
    // will still be present; if it mounts a FRESH clone, the marker
    // will be absent because the clone is a fresh deep-clone of the
    // master host (which never carried the marker).
    const firstInner = parent.querySelector('.inner');
    expect(firstInner).not.toBeNull();
    firstInner?.classList.add('first-mount-marker');

    // Truthy → falsy: clone is detached.
    scope.show = false;
    scope.$digest();
    expect(parent.querySelector('.inner')).toBeNull();

    // Falsy → truthy: a NEW clone is mounted.
    scope.show = true;
    scope.$digest();
    const secondInner = parent.querySelector('.inner');
    expect(secondInner).not.toBeNull();
    // Fresh DOM identity — the second clone is NOT the first clone.
    expect(secondInner?.isSameNode(firstInner)).toBe(false);
    // And the mutation we made on the first clone does not carry over
    // to the second clone (proves the deep-clone-per-mount contract).
    expect(secondInner?.classList.contains('first-mount-marker')).toBe(false);
  });

  it('truthy → falsy destroys the transclusion scope eagerly, firing $on("$destroy") listeners once', () => {
    // FS §2.1: the transclusion scope is destroyed on the truthy →
    // falsy transition. `ng-if` calls `cloneScope.$destroy()` BEFORE
    // detaching the clone's DOM, so any directive in the cloned
    // subtree that registered `$on('$destroy', …)` sees its listener
    // fire eagerly — without having to wait for an ancestor teardown.
    const counters: ProbeCounters = { links: 0, destroys: 0 };
    const b = bootstrap(($cp) => {
      $cp.directive(
        'myProbe',
        ddoFactory({
          restrict: 'A',
          link: ((s) => {
            counters.links += 1;
            s.$on('$destroy', () => {
              counters.destroys += 1;
            });
          }) as LinkFn,
        }),
      );
    });
    const scope = Scope.create();
    scope.show = true;

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-if', 'show');
    const probe = document.createElement('span');
    probe.className = 'inner';
    probe.setAttribute('my-probe', '');
    host.appendChild(probe);
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();
    expect(counters.links).toBe(1);
    expect(counters.destroys).toBe(0);
    expect(parent.querySelector('.inner')).not.toBeNull();

    // Truthy → falsy: clone is detached from the DOM AND its
    // transclusion scope is destroyed eagerly, firing the probe's
    // `$on('$destroy', …)` listener exactly once.
    scope.show = false;
    scope.$digest();
    expect(parent.querySelector('.inner')).toBeNull();
    expect(counters.destroys).toBe(1);
  });

  it('a fresh truthy transition re-links the probe directive against a brand-new scope', () => {
    // Same probe shape; here we toggle truthy → falsy → truthy and
    // assert the link counter went from 1 → 2 across the second
    // truthy transition (a new scope means a new link cycle for the
    // cloned subtree).
    const counters: ProbeCounters = { links: 0, destroys: 0 };
    const b = bootstrap(($cp) => {
      $cp.directive(
        'myProbe',
        ddoFactory({
          restrict: 'A',
          link: ((s) => {
            counters.links += 1;
            s.$on('$destroy', () => {
              counters.destroys += 1;
            });
          }) as LinkFn,
        }),
      );
    });
    const scope = Scope.create();
    scope.show = true;

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-if', 'show');
    const probe = document.createElement('span');
    probe.setAttribute('my-probe', '');
    host.appendChild(probe);
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();
    expect(counters.links).toBe(1);

    // Truthy → falsy.
    scope.show = false;
    scope.$digest();

    // Falsy → truthy: a brand-new clone is mounted; the probe's link
    // fn fires AGAIN on the new clone.
    scope.show = true;
    scope.$digest();
    expect(counters.links).toBe(2);
  });
});

describe('ngIf — position preservation across toggles (FS §2.1)', () => {
  it('the placeholder Comment occupies the host\'s original index in parent.childNodes', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = true;

    const parent = document.createElement('div');
    const before = document.createElement('span');
    before.className = 'before';
    const host = document.createElement('div');
    host.setAttribute('ng-if', 'show');
    const after = document.createElement('span');
    after.className = 'after';
    parent.appendChild(before);
    parent.appendChild(host);
    parent.appendChild(after);

    b.$compile(host)(scope);
    scope.$digest();

    // childNodes layout after truthy mount: [before, placeholder, clone, after].
    expect(parent.childNodes[0]).toBe(before);
    expect(parent.childNodes[1]?.nodeType).toBe(Node.COMMENT_NODE);
    const placeholder = parent.childNodes[1] as Comment;
    // The clone is the placeholder's `nextSibling` — that's the
    // position-preservation contract (insert via insertBefore against
    // `placeholder.nextSibling`).
    expect(placeholder.nextSibling).not.toBe(after);
    expect(parent.childNodes[3]).toBe(after);
  });

  it('after truthy → falsy → truthy, the new clone is again inserted immediately after the placeholder', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = true;

    const parent = document.createElement('div');
    const before = document.createElement('span');
    before.className = 'before';
    const host = document.createElement('div');
    host.setAttribute('ng-if', 'show');
    const after = document.createElement('span');
    after.className = 'after';
    parent.appendChild(before);
    parent.appendChild(host);
    parent.appendChild(after);

    b.$compile(host)(scope);
    scope.$digest();

    const placeholder = parent.childNodes[1] as Comment;

    // Toggle off, then on.
    scope.show = false;
    scope.$digest();
    // While falsy, the placeholder's next sibling is the `.after` span
    // (no clone in between).
    expect(placeholder.nextSibling).toBe(after);

    scope.show = true;
    scope.$digest();
    // The new clone is inserted IMMEDIATELY after the placeholder,
    // preserving the original position.
    const nextAfterToggle = placeholder.nextSibling;
    expect(nextAfterToggle).not.toBeNull();
    expect(nextAfterToggle?.nodeType).toBe(Node.ELEMENT_NODE);
    expect(nextAfterToggle).not.toBe(after);
    // And `.after` is still at the end.
    expect(parent.childNodes[parent.childNodes.length - 1]).toBe(after);
  });
});

describe('ngIf — restrict: "A" (FS §2.1)', () => {
  it('element form `<ng-if show="true">` does NOT match — no placeholder is installed', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = true;

    const parent = document.createElement('div');
    const host = document.createElement('ng-if');
    host.setAttribute('show', 'true');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    // The `<ng-if>` Element is still where we put it — no Comment
    // placeholder was installed (the directive did not match on tag).
    expect(parent.childNodes.length).toBe(1);
    expect(parent.childNodes[0]).toBe(host);
    expect(host.parentNode).toBe(parent);
  });
});

describe('ngIf — terminal: true (technical-considerations §2.2)', () => {
  it('lower-priority same-element directives are blocked by the spec-017 terminal cutoff', () => {
    // `ngIf` runs at priority 600 with `terminal: true`. A sibling
    // directive at priority 0 sits BELOW the terminal threshold and
    // is dropped from the matched-directive list before any of its
    // hooks (compile / link) run.
    const probeFired = vi.fn();
    const b = bootstrap(($cp) => {
      $cp.directive(
        'myProbe2',
        ddoFactory({
          restrict: 'A',
          priority: 0,
          link: (() => {
            probeFired();
          }) as LinkFn,
        }),
      );
    });
    const scope = Scope.create();
    scope.show = true;

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-if', 'show');
    host.setAttribute('my-probe2', '');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    // `myProbe2` was below the terminal threshold and never fired.
    expect(probeFired).not.toHaveBeenCalled();
  });
});

describe('ngIf — cleanup on parent teardown (FS §2.1 + Slice 2 cleanup-wiring)', () => {
  it("destroyElementScope on an ancestor tears down the active clone's scope via the placeholder's cleanup callback", () => {
    const counters: ProbeCounters = { links: 0, destroys: 0 };
    const b = bootstrap(($cp) => {
      // Wrapper directive that creates a `scope: true` child scope on
      // its host. This gives `destroyElementScope(wrapperEl)` something
      // to walk — the wrapper's child scope plus the placeholder's
      // cleanup callback registered by `ngIf`.
      $cp.directive(
        'myWrapper',
        ddoFactory({
          restrict: 'A',
          scope: true,
          link: ((): void => undefined) as LinkFn,
        }),
      );
      $cp.directive(
        'myProbe',
        ddoFactory({
          restrict: 'A',
          link: ((s) => {
            counters.links += 1;
            s.$on('$destroy', () => {
              counters.destroys += 1;
            });
          }) as LinkFn,
        }),
      );
    });
    const scope = Scope.create();
    scope.show = true;

    // <div my-wrapper><div ng-if="show"><span my-probe></span></div></div>
    const wrapper = document.createElement('div');
    wrapper.setAttribute('my-wrapper', '');
    const host = document.createElement('div');
    host.setAttribute('ng-if', 'show');
    const probe = document.createElement('span');
    probe.setAttribute('my-probe', '');
    host.appendChild(probe);
    wrapper.appendChild(host);
    const root = document.createElement('div');
    root.appendChild(wrapper);

    b.$compile(wrapper)(scope);
    scope.$digest();

    expect(counters.links).toBe(1);
    expect(counters.destroys).toBe(0);

    // Tear down the wrapper subtree. The placeholder's
    // `addElementCleanup` callback closes over the active clone and
    // calls `destroyElementScope(clonedRoot)`, which destroys the
    // transclusion scope so the probe's $destroy listener fires.
    destroyElementScope(wrapper);

    expect(counters.destroys).toBe(1);
  });
});
