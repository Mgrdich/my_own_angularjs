/**
 * `ngNonBindable` directive — opt a subtree out of compilation
 * (spec 023 Slice 6 / FS §2.6).
 *
 * Locks the AngularJS-canonical behavior for the built-in
 * `ngNonBindable` directive registered on `ngModule`:
 *
 * - Children carrying `{{ … }}` mustaches are NOT interpolated; the
 *   literal characters appear in the rendered text verbatim.
 * - Child elements declaring directives do NOT have their `link`
 *   functions invoked — the walker never descends into them.
 * - The host element's OWN raw attributes (e.g. `class="foo"`) survive
 *   intact; only its children are pruned from compilation.
 * - Siblings and ancestors of the host element compile normally — the
 *   opt-out is scoped to the subtree.
 * - A lower-priority directive on the SAME element does NOT run —
 *   pre-existing spec 017 same-element `terminal` cutoff applies.
 * - `injector.has('ngNonBindableDirective') === true` — registration
 *   sanity check.
 *
 * Tests use the canonical `ngModule` so the `ngNonBindable` directive
 * registered by `src/core/ng-module.ts` is reachable end-to-end —
 * mirroring the `ng-cloak.test.ts` / `ng-bind.test.ts` bootstrap
 * pattern. For tests that need to register a custom directive
 * alongside the built-ins, an `app` module appends a `config` block
 * that calls `$compileProvider.directive(...)` directly.
 *
 * The "no-descent into children" semantic is exercised end-to-end here
 * via the real `ngNonBindable` directive; the foundational walker hook
 * (narrowed to `directive.name === 'ngNonBindable'`) has its own pin
 * in `terminal-no-descent.test.ts`. Together they form the regression
 * pair: this file proves the directive ships under the right name and
 * the hook picks it up; `terminal-no-descent.test.ts` proves the hook
 * itself is correctly narrowed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
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

interface Bootstrap {
  $compile: CompileService;
  injector: InjectorLike;
}

/**
 * Build an injector rooted at the canonical `ngModule` so the
 * `ngNonBindable` directive registered by `src/core/ng-module.ts` is
 * reachable. `register` is an optional config callback that lets a
 * test add custom directives to an `app` module that depends on `'ng'`
 * — the same shape `compileWith` uses, but inlined here so the test
 * suite stays self-contained alongside the `ng-cloak.test.ts` /
 * `ng-bind.test.ts` precedent.
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

  const appModule = createModule('app', ['ng']);
  if (register) {
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

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

afterEach(() => {
  resetRegistry();
});

describe('ngNonBindable — registration on ngModule', () => {
  it('injector.has("ngNonBindableDirective") === true when "ng" is in the deps chain', () => {
    const b = bootstrap();
    expect(b.injector.has('ngNonBindableDirective')).toBe(true);
  });
});

describe('ngNonBindable — children with {{ }} are NOT interpolated (FS §2.6)', () => {
  it('preserves literal mustaches in the subtree (attribute form)', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.x = 'should-not-appear';

    const element = document.createElement('pre');
    element.setAttribute('ng-non-bindable', '');
    element.textContent = '{{ 1 + 1 }}';

    b.$compile(element)(scope);
    scope.$digest();

    // The walker did NOT descend into children, so the text node
    // containing the mustache was never seen by `$interpolate`.
    expect(element.textContent).toBe('{{ 1 + 1 }}');
  });

  it('preserves literal mustaches even when the referenced scope key has a value', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.x = 'value-on-scope';

    const element = document.createElement('pre');
    element.setAttribute('ng-non-bindable', '');
    element.textContent = '{{ x }}';

    b.$compile(element)(scope);
    scope.$digest();

    // Sanity — even with `scope.x` defined, the mustache is preserved
    // verbatim because the subtree was never compiled.
    expect(element.textContent).toBe('{{ x }}');
  });
});

describe('ngNonBindable — child directives do not run (FS §2.6)', () => {
  it('a directive on a CHILD element of an ng-non-bindable host has its link function pruned', () => {
    const childLink = vi.fn<LinkFn>();

    const b = bootstrap(($cp) => {
      $cp.directive(
        'childMarker',
        ddoFactory({
          restrict: 'A',
          link: childLink,
        }),
      );
    });

    const scope = Scope.create();
    const host = document.createElement('pre');
    host.setAttribute('ng-non-bindable', '');
    const child = document.createElement('span');
    child.setAttribute('child-marker', '');
    host.appendChild(child);

    b.$compile(host)(scope);
    scope.$digest();

    // The walker did NOT descend into `host.childNodes`, so the child
    // directive was never matched or linked.
    expect(childLink).not.toHaveBeenCalled();
  });
});

describe('ngNonBindable — class form (FS §2.6)', () => {
  it('class form works identically — literal {{ }} preserved', () => {
    const b = bootstrap();
    const scope = Scope.create();

    const element = document.createElement('pre');
    element.className = 'ng-non-bindable';
    element.textContent = '{{ noInterp }}';

    b.$compile(element)(scope);
    scope.$digest();

    expect(element.textContent).toBe('{{ noInterp }}');
  });

  it('class form prunes child directives identically to the attribute form', () => {
    const childLink = vi.fn<LinkFn>();

    const b = bootstrap(($cp) => {
      $cp.directive(
        'childMarker',
        ddoFactory({
          restrict: 'A',
          link: childLink,
        }),
      );
    });

    const scope = Scope.create();
    const host = document.createElement('pre');
    host.className = 'ng-non-bindable';
    const child = document.createElement('span');
    child.setAttribute('child-marker', '');
    host.appendChild(child);

    b.$compile(host)(scope);
    scope.$digest();

    expect(childLink).not.toHaveBeenCalled();
  });
});

describe("ngNonBindable — the element's OWN attributes still resolve (FS §2.6)", () => {
  it('preserves a `class` attribute on the host while keeping literal {{ }} in the children', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.x = 'irrelevant';

    const element = document.createElement('pre');
    element.setAttribute('ng-non-bindable', '');
    element.setAttribute('class', 'foo');
    element.textContent = '{{ x }}';

    b.$compile(element)(scope);
    scope.$digest();

    // The host's raw `class` attribute is unaffected — `ngNonBindable`
    // does not touch the element itself, only stops the walker from
    // descending into its children.
    expect(element.classList.contains('foo')).toBe(true);
    // And the subtree mustache stays literal.
    expect(element.textContent).toBe('{{ x }}');
  });
});

describe('ngNonBindable — siblings compile normally (FS §2.6)', () => {
  it('an adjacent sibling element with its own directive still binds', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.b = 'works';

    const root = document.createElement('div');
    const nonBindable = document.createElement('pre');
    nonBindable.setAttribute('ng-non-bindable', '');
    nonBindable.textContent = '{{ a }}';
    const sibling = document.createElement('span');
    sibling.setAttribute('ng-bind', 'b');
    root.appendChild(nonBindable);
    root.appendChild(sibling);

    b.$compile(root)(scope);
    scope.$digest();

    // Sibling compiles + binds normally.
    expect(sibling.textContent).toBe('works');
    // Non-bindable subtree's mustache stayed literal.
    expect(nonBindable.textContent).toBe('{{ a }}');
  });
});

describe('ngNonBindable — ancestors compile normally (FS §2.6)', () => {
  it('a parent with its own directive (ng-show) still toggles visibility', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.visible = true;
    scope.a = 'irrelevant';

    const parent = document.createElement('div');
    parent.setAttribute('ng-show', 'visible');
    const nonBindable = document.createElement('pre');
    nonBindable.setAttribute('ng-non-bindable', '');
    nonBindable.textContent = '{{ a }}';
    parent.appendChild(nonBindable);

    b.$compile(parent)(scope);
    scope.$digest();

    // Parent's `ng-show` ran — `visible` is true so the `ng-hide`
    // class is absent.
    expect(parent.classList.contains('ng-hide')).toBe(false);
    // Child non-bindable subtree's mustache stayed literal.
    expect(nonBindable.textContent).toBe('{{ a }}');

    // Flip visibility — parent's `ng-show` continues to react across
    // digests despite the non-bindable child.
    scope.visible = false;
    scope.$digest();
    expect(parent.classList.contains('ng-hide')).toBe(true);
    expect(nonBindable.textContent).toBe('{{ a }}');
  });
});

describe('ngNonBindable — same-element regression: lower-priority directive on the SAME element does NOT run', () => {
  it('a directive at priority: 0 on the same element as ng-non-bindable is pruned (spec 017 cutoff)', () => {
    const sameElementLink = vi.fn<LinkFn>();

    const b = bootstrap(($cp) => {
      $cp.directive(
        'sameElementMarker',
        ddoFactory({
          restrict: 'A',
          // Default priority (0) — well below `ngNonBindable`'s
          // `priority: 1000`. The spec-017 directive-collector cutoff
          // prunes this directive because `ngNonBindable` is
          // `terminal: true` at a higher priority.
          link: sameElementLink,
        }),
      );
    });

    const scope = Scope.create();
    const element = document.createElement('pre');
    element.setAttribute('ng-non-bindable', '');
    element.setAttribute('same-element-marker', '');

    b.$compile(element)(scope);
    scope.$digest();

    // Lower-priority same-element directive was pruned by the
    // pre-existing spec 017 terminal cutoff in
    // `directive-collector.ts:applyTerminalCutoff`.
    expect(sameElementLink).not.toHaveBeenCalled();
  });
});

describe('ngNonBindable — empty children (FS §2.6)', () => {
  it('compiling an empty <pre ng-non-bindable></pre> does NOT throw', () => {
    const b = bootstrap();
    const scope = Scope.create();
    const element = document.createElement('pre');
    element.setAttribute('ng-non-bindable', '');

    expect(() => {
      b.$compile(element)(scope);
      scope.$digest();
    }).not.toThrow();

    expect(element.childNodes.length).toBe(0);
  });
});
