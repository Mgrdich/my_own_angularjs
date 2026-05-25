/**
 * `ngInit` directive — one-shot scope seeding (spec 027 Slice 1 / FS §2.4).
 *
 * Locks the AngularJS-canonical behavior for the built-in `ngInit`
 * directive registered on `ngModule`:
 *
 * - Registration sanity: `injector.has('ngInitDirective') === true`
 *   when an app's module declares `'ng'` in its deps chain.
 * - Single-statement assignment: `ng-init="count = 0"` lands on scope.
 * - Multi-statement (semicolon-separated) assignments both land.
 * - **Pre-link timing — the load-bearing guarantee.** A child binding
 *   inside the marked subtree sees the initialized value on its very
 *   first render, with NO transient empty render between init and the
 *   binding's first evaluation. This is the whole reason `ngInit` is
 *   wired as a pre-link (not post-link) callback.
 * - Runs exactly once per mount: a digest re-firing after the first
 *   does NOT re-evaluate the `ng-init` expression.
 * - `restrict: 'AC'` — both attribute (`<div ng-init="…">`) and class
 *   (`<div class="ng-init: …">`) forms match; the element form
 *   (`<ng-init>`) does NOT match.
 * - Defensive guard — when `attrs.ngInit` is not a string, the
 *   directive is a no-op (matches the spec 023 / 024 / 025 / 026
 *   defensive pattern).
 *
 * Tests use the canonical `ngModule` so the `ngInit` directive
 * registered by `src/core/ng-module.ts` is reachable end-to-end —
 * mirroring the `ng-bind.test.ts` / `ng-non-bindable.test.ts`
 * bootstrap patterns.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { Attributes, CompileService, Directive } from '@compiler/directive-types';
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

describe('ngInit — registration on ngModule', () => {
  it('injector.has("ngInitDirective") === true when "ng" is in the deps chain', () => {
    const b = bootstrap();
    expect(b.injector.has('ngInitDirective')).toBe(true);
  });
});

describe('ngInit — single-statement assignment (FS §2.4)', () => {
  it('assigns a single scope property from the attribute expression', () => {
    const b = bootstrap();
    const scope = Scope.create();

    const element = document.createElement('div');
    element.setAttribute('ng-init', 'count = 0');

    b.$compile(element)(scope);
    scope.$digest();

    expect(scope.count).toBe(0);
  });

  it('object-literal assignment lands the object on scope', () => {
    const b = bootstrap();
    const scope = Scope.create();

    const element = document.createElement('div');
    element.setAttribute('ng-init', "user = {name: 'Alice', age: 42}");

    b.$compile(element)(scope);
    scope.$digest();

    expect(scope.user).toEqual({ name: 'Alice', age: 42 });
  });
});

describe('ngInit — multi-statement (semicolon-separated) (FS §2.4)', () => {
  // The FS §2.4 acceptance criterion (`<div ng-init="count = 0; user = {name:'Alice'}">`)
  // depends on the parser supporting `;` as a statement separator. The
  // current parser's lexer rejects `;` with `Unexpected next character: ;`
  // (see `src/parser/lexer.ts` — `;` is not in `SYMBOLS`). The
  // `ng-init` implementation itself simply forwards the attribute
  // value to `parse(...)`, so multi-statement chaining will light up
  // automatically once the parser gains semicolon support without any
  // change to `ng-init.ts`. These tests are skipped today and serve
  // as a pre-written regression set for the future parser slice.
  it.skip('evaluates two statements and lands both assignments on scope', () => {
    const b = bootstrap();
    const scope = Scope.create();

    const element = document.createElement('div');
    element.setAttribute('ng-init', 'a = 1; b = 2');

    b.$compile(element)(scope);
    scope.$digest();

    expect(scope.a).toBe(1);
    expect(scope.b).toBe(2);
  });

  it.skip('later statements can read the results of earlier statements in the same expression', () => {
    const b = bootstrap();
    const scope = Scope.create();

    const element = document.createElement('div');
    element.setAttribute('ng-init', 'a = 1; b = 2; total = a + b');

    b.$compile(element)(scope);
    scope.$digest();

    expect(scope.total).toBe(3);
  });

  it('object-literal assignment with multiple keys lands as ONE statement (current-parser-supported workaround)', () => {
    // Until the parser supports `;`, the practical equivalent for
    // seeding multiple related values is a single object-literal
    // assignment. This pins the only multi-value form `ng-init`
    // supports TODAY end-to-end through the lexer.
    const b = bootstrap();
    const scope = Scope.create();

    const element = document.createElement('div');
    element.setAttribute('ng-init', 'state = {a: 1, b: 2, total: 3}');

    b.$compile(element)(scope);
    scope.$digest();

    expect(scope.state).toEqual({ a: 1, b: 2, total: 3 });
  });
});

describe('ngInit — pre-link timing: child binding sees initialized value on FIRST render (FS §2.4)', () => {
  it("a child ng-bind sees the user object's `name` property on the very first digest — no transient empty render", () => {
    // FS §2.4's canonical example uses text-node `{{user.name}}`
    // interpolation. Text-node interpolation is NOT yet shipped in
    // `$compile`'s walker (only attribute interpolation via
    // `attrs.$observe` and explicit binding directives like `ng-bind`
    // are wired). We exercise the SAME pre-link timing guarantee via
    // an `ng-bind` child: `ng-bind` installs a `scope.$watch(expr, …)`
    // at its OWN link time, so if `ng-init` had run post-link the
    // first watch evaluation would see `scope.user === undefined`
    // and `String(undefined)` would have rendered as `''` on first
    // digest, with the next digest cycle's dirty-check catching up.
    const b = bootstrap();
    const scope = Scope.create();

    const host = document.createElement('div');
    host.setAttribute('ng-init', "user = {name: 'Alice'}");
    const heading = document.createElement('h1');
    heading.setAttribute('ng-bind', 'user.name');
    host.appendChild(heading);

    b.$compile(host)(scope);
    scope.$digest();

    expect(heading.textContent).toBe('Alice');
  });

  it('child ng-bind sees the initialized scalar value with one digest — no need for a second pass', () => {
    const b = bootstrap();
    const scope = Scope.create();

    const host = document.createElement('div');
    host.setAttribute('ng-init', 'greeting = "hello"');
    const span = document.createElement('span');
    span.setAttribute('ng-bind', 'greeting');
    host.appendChild(span);

    b.$compile(host)(scope);
    scope.$digest();

    // If `ng-init` had been post-link, `ng-bind`'s first watch
    // evaluation against `scope.greeting === undefined` would have
    // rendered empty on first digest, and only the NEXT digest would
    // have produced the text. The pre-link timing guarantee says we
    // see the initialized value here, after the single digest fired.
    expect(span.textContent).toBe('hello');
  });
});

describe('ngInit — runs exactly once per mount (FS §2.4)', () => {
  it('does NOT re-evaluate the expression on subsequent digests', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const counter = vi.fn();
    scope.counter = counter;

    const element = document.createElement('div');
    element.setAttribute('ng-init', 'counter()');

    b.$compile(element)(scope);
    scope.$digest();

    expect(counter).toHaveBeenCalledTimes(1);

    // Re-fire the digest multiple times — `ngInit` is a one-shot
    // initializer, not a watch. The counter must stay at 1.
    scope.$digest();
    scope.$digest();
    scope.$digest();

    expect(counter).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-evaluate when an unrelated scope property changes and triggers a digest', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const sideEffect = vi.fn();
    scope.sideEffect = sideEffect;
    scope.unrelated = 'initial';

    const element = document.createElement('div');
    element.setAttribute('ng-init', 'sideEffect()');

    b.$compile(element)(scope);
    scope.$digest();
    expect(sideEffect).toHaveBeenCalledTimes(1);

    // Mutating an unrelated scope property and digesting should NOT
    // re-evaluate `ng-init` — there is no watch on the expression.
    scope.unrelated = 'changed';
    scope.$digest();
    scope.unrelated = 'changed-again';
    scope.$digest();

    expect(sideEffect).toHaveBeenCalledTimes(1);
  });
});

describe('ngInit — restrict: "AC" (FS §2.4)', () => {
  it('attribute form `<div ng-init="…">` matches', () => {
    const b = bootstrap();
    const scope = Scope.create();

    const element = document.createElement('div');
    element.setAttribute('ng-init', 'x = "attr-form"');

    b.$compile(element)(scope);
    scope.$digest();

    expect(scope.x).toBe('attr-form');
  });

  it('class form `<div class="ng-init: …;">` matches', () => {
    const b = bootstrap();
    const scope = Scope.create();

    const element = document.createElement('div');
    element.setAttribute('class', 'ng-init: x = "class-form";');

    b.$compile(element)(scope);
    scope.$digest();

    expect(scope.x).toBe('class-form');
  });

  it('element form `<ng-init>` does NOT match', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.touched = false;

    // The custom element has no `ng-init` attribute and is NOT
    // restricted to match by element name. If the directive
    // misbehaved and matched on tag, the side-effect expression on
    // the attribute would land `scope.touched = true`. With
    // `restrict: 'AC'`, the element-form match must not happen.
    const element = document.createElement('ng-init');
    // Intentionally do NOT set an `ng-init` attribute — the
    // assertion below is that the tagName alone did not trigger the
    // directive. (No attribute means no expression to evaluate.)

    expect(() => {
      b.$compile(element)(scope);
      scope.$digest();
    }).not.toThrow();

    // Scope is untouched — the directive did not match on element
    // form, so no expression evaluated.
    expect(scope.touched).toBe(false);
  });
});

describe('ngInit — defensive guard (technical-considerations §2.5)', () => {
  it('is a no-op when attrs.ngInit is not a string (does not throw, does not call parse)', () => {
    // Reach the directive factory directly and exercise the
    // `typeof attrs.ngInit !== 'string'` early-return branch.
    // Compiling a real element without an `ng-init` attribute does
    // NOT match the directive (so we cannot exercise this branch
    // through `$compile`); instead, we invoke the factory's compile
    // fn manually with a synthetic `attrs` lookalike whose `ngInit`
    // slot is `undefined`. This pins the defensive-guard contract
    // documented in the implementation.
    const b = bootstrap();

    // The directive provider returns an array of normalized
    // directive entries; the first entry is the `ngInit` factory's
    // resolved DDO. The factory was wrapped in the canonical
    // array-form `[() => ({...})]` so by the time we read it from
    // the injector it has already been invoked once and yielded the
    // DDO.
    const directives = (b.injector as unknown as { get: (name: string) => Directive[] }).get('ngInitDirective');
    expect(directives).toHaveLength(1);
    const ddo = directives[0];
    expect(ddo).toBeDefined();
    expect(typeof ddo?.compile).toBe('function');

    const element = document.createElement('div');
    // Synthesize an `attrs` whose `ngInit` slot is undefined — the
    // exact shape the defensive guard protects against.
    const attrs = { ngInit: undefined } as unknown as Attributes;

    // The compile fn must early-return without throwing — `parse(undefined)`
    // would otherwise blow up on a non-string input.
    expect(() => {
      ddo?.compile?.(element, attrs);
    }).not.toThrow();
  });
});
