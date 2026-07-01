/**
 * `select` directive + `SelectController` (spec 039 Slice 4 / FS §2.4).
 *
 * Drives a `<select ng-model>` end-to-end through the canonical `ngModule`
 * (via `bootstrapInjector`), so the `select` / `option` directives
 * registered by `src/core/ng-module.ts` are reachable. Selection is
 * simulated the way a browser drives the control — setting `.value` /
 * `.selectedIndex` / an option's `.selected`, then dispatching a native
 * `change` event. Vectors ported from AngularJS `selectSpec.js`.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { CompileService } from '@compiler/directive-types';
import type { Scope } from '@core/index';
import { bootstrapInjector } from '@bootstrap/index';
import { resetRegistry } from '@di/module';

interface Harness {
  $compile: CompileService;
  $rootScope: Scope;
}

function boot(): Harness {
  const injector = bootstrapInjector([]);
  return {
    $compile: injector.get('$compile'),
    $rootScope: injector.get('$rootScope'),
  };
}

afterEach(() => {
  resetRegistry();
});

/** Compile an HTML fragment's first element against `scope` + digest. */
function compile(html: string, $compile: CompileService, scope: Scope): HTMLSelectElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  const child = el.firstElementChild as HTMLSelectElement;
  $compile(child)(scope);
  scope.$digest();
  return child;
}

function fireChange(el: HTMLSelectElement): void {
  el.dispatchEvent(new Event('change'));
}

function model(scope: Scope, key: string): unknown {
  return (scope as unknown as Record<string, unknown>)[key];
}

function setModel(scope: Scope, key: string, value: unknown): void {
  (scope as unknown as Record<string, unknown>)[key] = value;
}

/** The `<option>` children of a `<select>`, skipping the synthetic unknown option. */
function optionValues(select: HTMLSelectElement): string[] {
  return Array.from(select.options).map((o) => o.value);
}

// ────────────────────────────────────────────────────────────────────────────
// single select
// ────────────────────────────────────────────────────────────────────────────

describe('select (single) — binds the chosen option value (FS §2.4)', () => {
  const html =
    '<select ng-model="color">' +
    '<option value="red">Red</option>' +
    '<option value="green">Green</option>' +
    '<option value="blue">Blue</option>' +
    '</select>';

  it('selecting an option writes its value to the model', () => {
    const { $compile, $rootScope } = boot();
    const select = compile(html, $compile, $rootScope);

    select.value = 'green';
    fireChange(select);
    expect(model($rootScope, 'color')).toBe('green');
  });

  it('a model change re-renders the selection', () => {
    const { $compile, $rootScope } = boot();
    const select = compile(html, $compile, $rootScope);

    setModel($rootScope, 'color', 'blue');
    $rootScope.$digest();
    expect(select.value).toBe('blue');
    expect(select.options[select.selectedIndex]?.value).toBe('blue');
  });

  it('round-trips a selection back through a model change', () => {
    const { $compile, $rootScope } = boot();
    const select = compile(html, $compile, $rootScope);

    select.value = 'red';
    fireChange(select);
    expect(model($rootScope, 'color')).toBe('red');

    setModel($rootScope, 'color', 'green');
    $rootScope.$digest();
    expect(select.value).toBe('green');
  });

  it('an unknown model value (matching no option) renders the unknown option', () => {
    const { $compile, $rootScope } = boot();
    setModel($rootScope, 'color', 'purple');
    const select = compile(html, $compile, $rootScope);

    // No registered option matches 'purple' — the synthetic unknown option
    // becomes the selection rather than silently binding 'red'.
    expect(select.value).toBe('?');
    // The unknown option is inserted as the first child.
    expect(select.options[0]?.value).toBe('?');
  });

  it('setting the model to a real value after an unknown value clears the unknown option', () => {
    const { $compile, $rootScope } = boot();
    setModel($rootScope, 'color', 'purple');
    const select = compile(html, $compile, $rootScope);
    expect(select.value).toBe('?');

    setModel($rootScope, 'color', 'blue');
    $rootScope.$digest();
    expect(select.value).toBe('blue');
    // The unknown option is gone.
    expect(optionValues(select)).not.toContain('?');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// multiple select
// ────────────────────────────────────────────────────────────────────────────

describe('select[multiple] — binds an array of chosen values (FS §2.4)', () => {
  const html =
    '<select ng-model="colors" multiple>' +
    '<option value="red">Red</option>' +
    '<option value="green">Green</option>' +
    '<option value="blue">Blue</option>' +
    '</select>';

  it('selecting several options writes an array of their values', () => {
    const { $compile, $rootScope } = boot();
    const select = compile(html, $compile, $rootScope);

    (select.options[0] as HTMLOptionElement).selected = true;
    (select.options[2] as HTMLOptionElement).selected = true;
    fireChange(select);

    expect(model($rootScope, 'colors')).toEqual(['red', 'blue']);
  });

  it('an array model checks the matching options', () => {
    const { $compile, $rootScope } = boot();
    const select = compile(html, $compile, $rootScope);

    setModel($rootScope, 'colors', ['green', 'blue']);
    $rootScope.$digest();

    expect((select.options[0] as HTMLOptionElement).selected).toBe(false);
    expect((select.options[1] as HTMLOptionElement).selected).toBe(true);
    expect((select.options[2] as HTMLOptionElement).selected).toBe(true);
  });

  it('deselecting all options writes an empty array', () => {
    const { $compile, $rootScope } = boot();
    const select = compile(html, $compile, $rootScope);

    (select.options[0] as HTMLOptionElement).selected = true;
    fireChange(select);
    expect(model($rootScope, 'colors')).toEqual(['red']);

    (select.options[0] as HTMLOptionElement).selected = false;
    fireChange(select);
    expect(model($rootScope, 'colors')).toEqual([]);
  });

  it('reports empty via $isEmpty when nothing is selected', () => {
    const { $compile, $rootScope } = boot();
    const select = compile(html, $compile, $rootScope);

    // Fresh multiple select with no selection → ng-empty.
    (select.options[0] as HTMLOptionElement).selected = true;
    fireChange(select);
    expect(select.classList.contains('ng-not-empty')).toBe(true);

    (select.options[0] as HTMLOptionElement).selected = false;
    fireChange(select);
    expect(select.classList.contains('ng-empty')).toBe(true);
  });
});
