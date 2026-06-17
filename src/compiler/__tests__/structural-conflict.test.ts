/**
 * Same-element structural-directive conflict (spec 032 Slice 2 / FS §2.1).
 *
 * Two structural directives on ONE element cannot both own it. Before
 * spec 032 the spec-017 terminal cutoff in `directive-collector.ts`
 * silently dropped the lower-priority structural directive at collection
 * time (`ng-repeat` at 1000 with `terminal: true` cut off `ng-if` at
 * 600), so the documented `MultipleTranscludeDirectivesError` in
 * `compile.ts` never fired — the page rendered with only one directive
 * applied. The known spec-027 gap.
 *
 * Slice 2 adds a NARROW exception to the cutoff: a second directive
 * declaring `transclude` survives collection so the conflict reaches
 * `compile.ts`'s multi-transclude guard, which routes
 * `MultipleTranscludeDirectivesError(first, second)` via
 * `$exceptionHandler('$compile')` and strips the second's transclude.
 *
 * This file locks (FS §2.1):
 *   - `<div ng-if ng-repeat>` routes the error naming BOTH directives
 *     with cause `'$compile'` (and does NOT silently render one).
 *   - The same error for `ng-if` + `ng-include` and
 *     `ng-repeat` + `ng-switch-when`.
 *   - The canonical nested workaround renders correctly with no error.
 *   - `EXCEPTION_HANDLER_CAUSES.length === 10` (no new token).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService } from '@compiler/directive-types';
import { $ControllerProvider } from '@controller/controller-provider';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { EXCEPTION_HANDLER_CAUSES } from '@exception-handler/index';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import { createTemplateCache } from '@template/template-cache';
import { createTemplateRequest } from '@template/template-request';
import type { TemplateCacheService, TemplateRequestFn } from '@template/template-types';

/** A captured `(error, cause)` pair routed through `$exceptionHandler`. */
interface RoutedError {
  error: unknown;
  cause: unknown;
}

interface Bootstrap {
  $compile: CompileService;
  routed: RoutedError[];
}

/**
 * Bootstraps the canonical compiler injector (mirroring `ng-if.test.ts`):
 * re-registers `'ng'` in the registry with the provider set so
 * `createModule('app', ['ng'])`'s dependency resolves, then loads the
 * real `ngModule` (which registers the structural directives `ng-if` /
 * `ng-repeat` / `ng-switch` / `ng-include`) plus the app module.
 *
 * The recording `$exceptionHandler` is registered on the APP module,
 * which is loaded AFTER `ngModule` in `createInjector([ngModule, app])`.
 * The last-wins service rule routes every error through the recording
 * handler so a test can assert the exact `(error, cause)` pairs.
 */
function bootstrap(): Bootstrap {
  resetRegistry();
  const routed: RoutedError[] = [];
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

  const appModule = createModule('structuralConflictApp', ['ng']).factory('$exceptionHandler', [
    () =>
      (error: unknown, cause?: unknown): void => {
        routed.push({ error, cause });
      },
  ]);
  const built = createInjector([ngModule, appModule]);
  return { $compile: built.get('$compile'), routed };
}

/**
 * Returns the routed `MultipleTranscludeDirectivesError` entries (with
 * their cause) recorded during the conflict path, ignoring any unrelated
 * routed errors.
 */
function multiTranscludeErrors(routed: readonly RoutedError[]): RoutedError[] {
  return routed.filter((r) => r.error instanceof Error && r.error.name === 'MultipleTranscludeDirectivesError');
}

afterEach(() => {
  resetRegistry();
});

describe('same-element structural conflict (spec 032 Slice 2 / FS §2.1)', () => {
  it('<div ng-if ng-repeat> routes MultipleTranscludeDirectivesError via $exceptionHandler("$compile") naming both directives', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = true;
    scope.xs = [1, 2, 3];

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-if', 'show');
    host.setAttribute('ng-repeat', 'x in xs');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    const conflicts = multiTranscludeErrors(b.routed);
    expect(conflicts.length).toBeGreaterThanOrEqual(1);

    const first = conflicts[0];
    expect(first).toBeDefined();
    expect(first?.cause).toBe('$compile');
    const message = (first?.error as Error).message;
    // The error names BOTH conflicting directives. `ng-repeat` (1000)
    // sorts above `ng-if` (600), so it is the first ("winner").
    expect(message).toContain('ngRepeat');
    expect(message).toContain('ngIf');
  });

  it('the conflict is NOT silently swallowed — at least one error reaches the handler', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = true;
    scope.xs = [1];

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-if', 'show');
    host.setAttribute('ng-repeat', 'x in xs');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    // The contract: a conflict is reported, not silently rendered with
    // only one directive applied.
    expect(multiTranscludeErrors(b.routed).length).toBeGreaterThanOrEqual(1);
  });

  it('the same conflict error appears for ng-if + ng-include', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = true;
    scope.tpl = 'some-template.html';

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-if', 'show');
    host.setAttribute('ng-include', 'tpl');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    const conflicts = multiTranscludeErrors(b.routed);
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    const first = conflicts[0];
    expect(first?.cause).toBe('$compile');
    const message = (first?.error as Error).message;
    // `ng-if` (600) sorts above `ng-include` (400).
    expect(message).toContain('ngIf');
    expect(message).toContain('ngInclude');
  });

  it('the same conflict error appears for ng-repeat + ng-switch-when', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.xs = [1, 2];
    scope.selection = 'a';

    const parent = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('ng-repeat', 'x in xs');
    host.setAttribute('ng-switch-when', 'a');
    parent.appendChild(host);

    b.$compile(host)(scope);
    scope.$digest();

    const conflicts = multiTranscludeErrors(b.routed);
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    const first = conflicts[0];
    expect(first?.cause).toBe('$compile');
    const message = (first?.error as Error).message;
    // `ng-switch-when` (1200) sorts above `ng-repeat` (1000).
    expect(message).toContain('ngSwitchWhen');
    expect(message).toContain('ngRepeat');
  });
});

describe('canonical nested workaround (spec 032 Slice 2 / FS §2.1)', () => {
  it('<div ng-if="show"><div ng-repeat="x in xs">{{x}}</div></div> renders rows with no conflict error', () => {
    const b = bootstrap();
    const scope = Scope.create();
    scope.show = true;
    scope.xs = ['a', 'b', 'c'];

    const parent = document.createElement('div');
    const outer = document.createElement('div');
    outer.setAttribute('ng-if', 'show');
    const inner = document.createElement('div');
    inner.setAttribute('ng-repeat', 'x in xs');
    inner.textContent = '{{x}}';
    outer.appendChild(inner);
    parent.appendChild(outer);

    b.$compile(outer)(scope);
    scope.$digest();

    // No structural-conflict error on the nested (correct) usage.
    expect(multiTranscludeErrors(b.routed)).toHaveLength(0);

    // Three rows render — the `ng-repeat` rows are direct text-bearing
    // clones mounted next to their placeholder inside the mounted
    // `ng-if` clone.
    const rendered = parent.textContent;
    expect(rendered).toContain('a');
    expect(rendered).toContain('b');
    expect(rendered).toContain('c');
  });
});

describe('no new exception-handler cause token (spec 032 Slice 2)', () => {
  it('EXCEPTION_HANDLER_CAUSES stays at 10', () => {
    expect(EXCEPTION_HANDLER_CAUSES.length).toBe(10);
  });
});
