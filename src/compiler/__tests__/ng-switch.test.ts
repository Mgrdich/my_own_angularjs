/**
 * `ngSwitch` + `ngSwitchWhen` + `ngSwitchDefault` directives — value-driven
 * subtree selection (spec 027 Slice 5 / FS §2.2).
 *
 * Locks the AngularJS-canonical behavior for the three switch directives
 * registered on `ngModule`:
 *
 * - Registration sanity: `injector.has('ngSwitchDirective')` /
 *   `'ngSwitchWhenDirective'` / `'ngSwitchDefaultDirective'` all `=== true`
 *   when an app's module declares `'ng'` in its deps chain.
 * - At most ONE case (or one set of equal-value cases) is mounted at a
 *   time. Every transition tears the previous mount(s) down and mounts a
 *   fresh deep clone with a fresh transclusion scope.
 * - `String(value)` is the match key — numeric scope values match
 *   `ng-switch-when="<digits>"` because `String(1) === '1'`.
 * - Multiple `ng-switch-when` blocks sharing the same value all render
 *   together when that value matches (AngularJS-canonical multi-match).
 * - `ng-switch-default` fires on a miss; with no default, the container
 *   stays empty.
 * - `ng-switch-when` / `ng-switch-default` outside an enclosing `ng-switch`
 *   trigger `MissingRequiredControllerError` (from the spec-022 Slice-4
 *   `require: '^ngSwitch'` resolver), routed via
 *   `$exceptionHandler('$compile')`.
 *
 * **Implementation gap surfaced (Slice 5):** the compile-time controller
 * seam at `src/compiler/compile.ts:1480` and the on-the-fly
 * `resolveRequiredControllersForLinkEntries` pass at line 1501 are both
 * gated on `isElement(target)`. For directives with
 * `transclude: 'element'` + `require: '^...'`, the link fn runs against
 * the Comment placeholder (target is a Comment node, not an Element), so
 * the gate skips BOTH paths and the per-directive `entry.requiredControllers`
 * 4th argument stays `undefined`. `ngSwitchWhen` / `ngSwitchDefault` cast
 * the 4th arg to `NgSwitchControllerShape | null` and bail on `=== null`,
 * but `undefined !== null` so the children's link fn then dereferences
 * `ctrl.cases` and throws `TypeError: Cannot read properties of undefined`.
 * Net effect: child cases NEVER register with the parent's controller, so
 * the parent's `scope.$watch(expr, …)` listener fires against an empty
 * `cases` map and mounts nothing.
 *
 * This gap blocks ALL orchestration assertions on this file (single
 * match, three-way branch, multi-match, string equality, transition
 * teardown, integration with `ng-controller`, element form). Those tests
 * are written verbatim against the FS §2.2 acceptance criteria and
 * marked `it.skip` with this same diagnosis so they light up
 * automatically once the gate is widened to `isElement(target) || isComment(target)`
 * (mirroring the spec 027 Slice 2 widening already applied to the
 * `$$ngBoundTransclude` site at line 1313).
 *
 * Acceptance criteria that DO pass with the gap in place:
 *
 *  - Registration sanity (gap-independent — provider lookup only).
 *  - "No match + no default" (the parent's controller IS created, the
 *    `cases` map is empty BECAUSE no child ever registered, the watch
 *    listener correctly bails on the empty-map miss).
 *  - Helpers without an enclosing parent — the SEAM-gated path is bypassed
 *    by the placeholder target, but `resolveRequireForm` would still throw
 *    `MissingRequiredControllerError` for a real Element target. We
 *    exercise that path indirectly via the same fall-through (the
 *    children's link fn bails on `controllers === null`, the surrounding
 *    page does not crash). The `MissingRequiredControllerError` assertion
 *    is the part most directly affected by the gap and is marked
 *    `it.skip`.
 *
 * Tests use the canonical `ngModule` so the spec-027-Slice-5 directives
 * registered by `src/core/ng-module.ts` are reachable end-to-end —
 * mirroring the `ng-if.test.ts` / `ng-controller.test.ts` bootstrap
 * patterns.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MissingRequiredControllerError } from '@compiler/compile-error';
import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { type AnyModule, createModule, resetRegistry } from '@di/module';
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

/**
 * Bootstrap an injector wired with the production `ngModule` (so the
 * spec-027 built-in directives are reachable end-to-end) plus a local
 * `ng` re-registration of the canonical providers so `appModule.requires =
 * ['ng']` resolves. Apps register controllers / directives / a spy
 * `$exceptionHandler` on the `app` module via the `register` callback.
 *
 * Mirrors `ng-controller.test.ts`'s bootstrap shape.
 */
function bootstrap(options?: {
  register?: (appModule: AnyModule) => void;
  exceptionHandler?: (...args: unknown[]) => void;
}): Bootstrap {
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

  const appModule = createModule('app', ['ng']);
  if (options?.exceptionHandler !== undefined) {
    const handler = options.exceptionHandler;
    appModule.factory('$exceptionHandler', [() => handler]);
  }
  if (options?.register !== undefined) {
    options.register(appModule);
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

describe('ngSwitch — registration on ngModule (spec 027 Slice 5)', () => {
  it('injector.has("ngSwitchDirective") === true when "ng" is in the deps chain', () => {
    const b = bootstrap();
    expect(b.injector.has('ngSwitchDirective')).toBe(true);
  });

  it('injector.has("ngSwitchWhenDirective") === true', () => {
    const b = bootstrap();
    expect(b.injector.has('ngSwitchWhenDirective')).toBe(true);
  });

  it('injector.has("ngSwitchDefaultDirective") === true', () => {
    const b = bootstrap();
    expect(b.injector.has('ngSwitchDefaultDirective')).toBe(true);
  });
});

describe('ngSwitch — single match against ng-switch-when (FS §2.2)', () => {
  it('renders the matching ng-switch-when block when the expression matches its attribute value', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.x = 'A';

    // <div ng-switch="x"><div ng-switch-when="A"><span class="hit">A!</span></div></div>
    const host = document.createElement('div');
    host.setAttribute('ng-switch', 'x');
    const whenA = document.createElement('div');
    whenA.setAttribute('ng-switch-when', 'A');
    const innerA = document.createElement('span');
    innerA.className = 'hit';
    innerA.textContent = 'A!';
    whenA.appendChild(innerA);
    host.appendChild(whenA);

    b.$compile(host)(scope);
    scope.$digest();

    const rendered = host.querySelector('.hit');
    expect(rendered).not.toBeNull();
    expect(rendered?.textContent).toBe('A!');
  });
});

describe('ngSwitch — three-way branch (FS §2.2)', () => {
  it('only the matching block renders; transitions tear down the prior mount', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.x = 'A';

    const host = document.createElement('div');
    host.setAttribute('ng-switch', 'x');
    const whenA = document.createElement('div');
    whenA.setAttribute('ng-switch-when', 'A');
    const aMark = document.createElement('span');
    aMark.className = 'case-a';
    aMark.textContent = 'a';
    whenA.appendChild(aMark);
    const whenB = document.createElement('div');
    whenB.setAttribute('ng-switch-when', 'B');
    const bMark = document.createElement('span');
    bMark.className = 'case-b';
    bMark.textContent = 'b';
    whenB.appendChild(bMark);
    const whenDefault = document.createElement('div');
    whenDefault.setAttribute('ng-switch-default', '');
    const dMark = document.createElement('span');
    dMark.className = 'case-d';
    dMark.textContent = 'd';
    whenDefault.appendChild(dMark);
    host.appendChild(whenA);
    host.appendChild(whenB);
    host.appendChild(whenDefault);

    b.$compile(host)(scope);
    scope.$digest();

    // x = 'A' — only the A block renders.
    expect(host.querySelector('.case-a')).not.toBeNull();
    expect(host.querySelector('.case-b')).toBeNull();
    expect(host.querySelector('.case-d')).toBeNull();

    // x = 'B' — A is torn down, B renders.
    scope.x = 'B';
    scope.$digest();
    expect(host.querySelector('.case-a')).toBeNull();
    expect(host.querySelector('.case-b')).not.toBeNull();
    expect(host.querySelector('.case-d')).toBeNull();

    // x = 'C' (no matching when) — only the default renders.
    scope.x = 'C';
    scope.$digest();
    expect(host.querySelector('.case-a')).toBeNull();
    expect(host.querySelector('.case-b')).toBeNull();
    expect(host.querySelector('.case-d')).not.toBeNull();
  });
});

describe('ngSwitch — no match + no default → empty (FS §2.2)', () => {
  // This test passes even with the gap because the parent's controller IS
  // created (its host is an Element so the seam runs), the `cases` map is
  // empty BECAUSE no child ever registered (the gap), and the parent's
  // watch listener correctly bails on the empty-map miss (`get(key) ?? get('?')`
  // both return undefined → early return). The observable behavior matches
  // the FS §2.2 acceptance criterion, even though the underlying reason is
  // a bug rather than the intended "no when matched + no default declared"
  // pathway. When the gap is fixed and child registration starts working,
  // the test must be re-examined — it'll still pass if `x = 'C'` and
  // neither `whenA` nor `whenB` matches, but the trailing comment about
  // "no clone mounted anywhere" will then be due to legitimate match
  // failure rather than registration failure.
  it('leaves the container empty (only the child placeholders remain) when no when matches and no default is declared', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.x = 'C';

    const host = document.createElement('div');
    host.setAttribute('ng-switch', 'x');
    const whenA = document.createElement('div');
    whenA.setAttribute('ng-switch-when', 'A');
    const aMark = document.createElement('span');
    aMark.className = 'case-a';
    whenA.appendChild(aMark);
    const whenB = document.createElement('div');
    whenB.setAttribute('ng-switch-when', 'B');
    const bMark = document.createElement('span');
    bMark.className = 'case-b';
    whenB.appendChild(bMark);
    host.appendChild(whenA);
    host.appendChild(whenB);

    b.$compile(host)(scope);
    scope.$digest();

    // No clone mounted anywhere — neither marker is in the tree.
    expect(host.querySelector('.case-a')).toBeNull();
    expect(host.querySelector('.case-b')).toBeNull();

    // The remaining children of `host` are the two Comment placeholders
    // installed by Slice 2's `transclude: 'element'` capture (one for
    // each `ng-switch-when` child). No Element children remain.
    expect(host.children.length).toBe(0);
    expect(host.childNodes.length).toBe(2);
    expect(host.childNodes[0]?.nodeType).toBe(Node.COMMENT_NODE);
    expect(host.childNodes[1]?.nodeType).toBe(Node.COMMENT_NODE);
  });
});

describe('ngSwitch — multiple ng-switch-when with the same value all render (FS §2.2)', () => {
  it('AngularJS-canonical multi-match — both blocks render when the value matches their shared key', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.x = 'A';

    const host = document.createElement('div');
    host.setAttribute('ng-switch', 'x');
    const first = document.createElement('div');
    first.setAttribute('ng-switch-when', 'A');
    const firstMark = document.createElement('span');
    firstMark.className = 'first';
    firstMark.textContent = 'first';
    first.appendChild(firstMark);
    const second = document.createElement('div');
    second.setAttribute('ng-switch-when', 'A');
    const secondMark = document.createElement('span');
    secondMark.className = 'second';
    secondMark.textContent = 'second';
    second.appendChild(secondMark);
    host.appendChild(first);
    host.appendChild(second);

    b.$compile(host)(scope);
    scope.$digest();

    expect(host.querySelector('.first')).not.toBeNull();
    expect(host.querySelector('.second')).not.toBeNull();
  });
});

describe('ngSwitch — string-equality match key (FS §2.2)', () => {
  it('numeric expression value matches ng-switch-when="1" because String(1) === "1"', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.x = 1;

    const host = document.createElement('div');
    host.setAttribute('ng-switch', 'x');
    const whenOne = document.createElement('div');
    whenOne.setAttribute('ng-switch-when', '1');
    const inner = document.createElement('span');
    inner.className = 'num';
    inner.textContent = 'one';
    whenOne.appendChild(inner);
    host.appendChild(whenOne);

    b.$compile(host)(scope);
    scope.$digest();

    // `String(1) === '1'` so the numeric `1` matches the string attr value.
    expect(host.querySelector('.num')).not.toBeNull();
    expect(host.querySelector('.num')?.textContent).toBe('one');
  });
});

describe('ngSwitch — transition teardown destroys old scope, mounts fresh scope (FS §2.2)', () => {
  it("the previous case's transclusion scope is destroyed before the new case mounts", () => {
    const destroySpy = vi.fn();
    const b = bootstrap({
      register: (app) => {
        app.directive('myProbe', [
          () => ({
            restrict: 'A',
            link: (s: Scope) => {
              s.$on('$destroy', () => {
                destroySpy();
              });
            },
          }),
        ]);
      },
    });
    const scope = Scope.create();
    scope.x = 'A';

    const host = document.createElement('div');
    host.setAttribute('ng-switch', 'x');
    const whenA = document.createElement('div');
    whenA.setAttribute('ng-switch-when', 'A');
    const probe = document.createElement('span');
    probe.setAttribute('my-probe', '');
    probe.className = 'a-probe';
    whenA.appendChild(probe);
    const whenB = document.createElement('div');
    whenB.setAttribute('ng-switch-when', 'B');
    const bMark = document.createElement('span');
    bMark.className = 'b-mark';
    whenB.appendChild(bMark);
    host.appendChild(whenA);
    host.appendChild(whenB);

    b.$compile(host)(scope);
    scope.$digest();

    expect(host.querySelector('.a-probe')).not.toBeNull();
    expect(destroySpy).not.toHaveBeenCalled();

    scope.x = 'B';
    scope.$digest();
    expect(host.querySelector('.a-probe')).toBeNull();
    expect(host.querySelector('.b-mark')).not.toBeNull();
    expect(destroySpy).toHaveBeenCalled();
  });
});

describe("ngSwitch — helpers outside an enclosing `ng-switch` route MissingRequiredControllerError via $exceptionHandler('$compile')", () => {
  // Per the file-header diagnosis: when the child's host is replaced by a
  // Comment placeholder, the compile-time controller seam (line 1480) and
  // the on-the-fly require-resolution pass (line 1501) are both gated on
  // `isElement(target)`, so `MissingRequiredControllerError` is never
  // thrown for a Comment-target child even when no enclosing `ng-switch`
  // exists. The child's link fn instead bails defensively on
  // `controllers === null`, but `undefined !== null` so the cast lands on
  // `ctrl.cases` and throws `TypeError` — which DOES route via
  // `$exceptionHandler('$compile')` from the per-element linker's
  // try/catch around `entry.post(...)`. Net observable: an error IS
  // routed (so the rest of the page doesn't crash), just not the one the
  // spec expected. We pin both halves: "rest of page doesn't crash" runs
  // green; the specific `MissingRequiredControllerError` class assertion
  // is `it.skip`'d until the gap is patched.
  it('ng-switch-when without a parent ng-switch — the rest of the page does NOT crash', () => {
    const handlerSpy = vi.fn<(...args: unknown[]) => void>();
    const b = bootstrap({ exceptionHandler: handlerSpy });
    const scope = Scope.create();

    const parent = document.createElement('div');
    const whenA = document.createElement('div');
    whenA.setAttribute('ng-switch-when', 'A');
    const innerA = document.createElement('span');
    innerA.className = 'a';
    whenA.appendChild(innerA);
    parent.appendChild(whenA);

    expect(() => {
      b.$compile(parent)(scope);
      scope.$digest();
    }).not.toThrow();
  });

  it('ng-switch-when without a parent ng-switch routes MissingRequiredControllerError', () => {
    const handlerSpy = vi.fn<(...args: unknown[]) => void>();
    const b = bootstrap({ exceptionHandler: handlerSpy });
    const scope = Scope.create();

    const parent = document.createElement('div');
    const whenA = document.createElement('div');
    whenA.setAttribute('ng-switch-when', 'A');
    parent.appendChild(whenA);

    b.$compile(parent)(scope);
    scope.$digest();

    const matchingCall = handlerSpy.mock.calls.find((args) => args[0] instanceof MissingRequiredControllerError);
    expect(matchingCall).toBeDefined();
    const [err, cause] = matchingCall ?? [];
    expect(err).toBeInstanceOf(MissingRequiredControllerError);
    expect(cause).toBe('$compile');
  });

  it('ng-switch-default without a parent ng-switch — the rest of the page does NOT crash', () => {
    const handlerSpy = vi.fn<(...args: unknown[]) => void>();
    const b = bootstrap({ exceptionHandler: handlerSpy });
    const scope = Scope.create();

    const parent = document.createElement('div');
    const whenDefault = document.createElement('div');
    whenDefault.setAttribute('ng-switch-default', '');
    parent.appendChild(whenDefault);

    expect(() => {
      b.$compile(parent)(scope);
      scope.$digest();
    }).not.toThrow();
  });

  it('ng-switch-default without a parent ng-switch routes MissingRequiredControllerError', () => {
    const handlerSpy = vi.fn<(...args: unknown[]) => void>();
    const b = bootstrap({ exceptionHandler: handlerSpy });
    const scope = Scope.create();

    const parent = document.createElement('div');
    const whenDefault = document.createElement('div');
    whenDefault.setAttribute('ng-switch-default', '');
    parent.appendChild(whenDefault);

    b.$compile(parent)(scope);
    scope.$digest();

    const matchingCall = handlerSpy.mock.calls.find((args) => args[0] instanceof MissingRequiredControllerError);
    expect(matchingCall).toBeDefined();
    const [err, cause] = matchingCall ?? [];
    expect(err).toBeInstanceOf(MissingRequiredControllerError);
    expect(cause).toBe('$compile');
  });
});

describe('ngSwitch — integration with ng-controller (FS §2.5 + §2.2)', () => {
  it('a controller nested inside an ng-switch-when block is instantiated only while that case matches', () => {
    const ctorSpy = vi.fn();
    const onDestroySpy = vi.fn();
    const b = bootstrap({
      register: (app) => {
        app.controller('ACtrl', [
          function (this: Record<string, unknown>): void {
            ctorSpy();
            this.a = 'visible';
            this.$onDestroy = onDestroySpy;
          },
        ]);
      },
    });
    const scope = Scope.create();
    scope.x = 'A';

    const host = document.createElement('div');
    host.setAttribute('ng-switch', 'x');
    const whenA = document.createElement('div');
    whenA.setAttribute('ng-switch-when', 'A');
    const controlled = document.createElement('div');
    controlled.setAttribute('ng-controller', 'ACtrl as ctrl');
    const bind = document.createElement('span');
    bind.setAttribute('ng-bind', 'ctrl.a');
    bind.className = 'ctrl-out';
    controlled.appendChild(bind);
    whenA.appendChild(controlled);
    host.appendChild(whenA);

    b.$compile(host)(scope);
    scope.$digest();

    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.ctrl-out')?.textContent).toBe('visible');
    expect(onDestroySpy).not.toHaveBeenCalled();

    scope.x = 'B';
    scope.$digest();
    expect(host.querySelector('.ctrl-out')).toBeNull();
    expect(onDestroySpy).toHaveBeenCalled();
  });
});

describe('ngSwitch — restrict: "EA" — element form matches (FS §2.2)', () => {
  // The `<ng-switch>` host element is itself an Element, so its
  // controller seam runs and stashes the controller on `$$ngControllers`
  // (the parent path is gap-free — only the child path is blocked). The
  // children's placeholder-target gap still blocks the case-mounting
  // assertion, so the orchestration check is `it.skip`'d. The
  // "directive matches as element" check is verifiable WITHOUT
  // orchestration: after compile, the `<ng-switch>` element's
  // `$$ngControllers` Map contains the `'ngSwitch'` key.
  it('the directive matches `<ng-switch ng-switch="x">` (element form) — controller is stashed on the host', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.x = 'A';

    const host = document.createElement('ng-switch');
    host.setAttribute('ng-switch', 'x');
    const whenA = document.createElement('div');
    whenA.setAttribute('ng-switch-when', 'A');
    whenA.innerHTML = '<span class="elem-form">a</span>';
    host.appendChild(whenA);

    b.$compile(host)(scope);
    scope.$digest();

    // The host bears a `$$ngControllers` Map containing the `ngSwitch`
    // controller after compile — the unequivocal "directive matched as
    // an element" signal that does NOT depend on case orchestration.
    const ctrlMap = (host as unknown as { $$ngControllers?: Map<string, unknown> }).$$ngControllers;
    expect(ctrlMap).toBeDefined();
    expect(ctrlMap?.has('ngSwitch')).toBe(true);
  });
});
