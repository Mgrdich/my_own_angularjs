/**
 * `ngOptions` directive (spec 039 Slice 4 / FS §2.5).
 *
 * Drives a `<select ng-model ng-options="…">` end-to-end through the
 * canonical `ngModule` (via `bootstrapInjector`), exercising label / value /
 * `group by` / `disable when` / `track by` against ARRAY and OBJECT
 * collections. Options are generated from the collection; selection is
 * simulated by setting `.value` / an option's `.selected` and dispatching a
 * native `change`. Vectors ported from AngularJS `ngOptionsSpec.js`.
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

/** Compile a `<select>` fragment against `scope` + digest. */
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

/** The rendered `<option>` labels (in DOM order, skipping optgroups). */
function optionLabels(select: HTMLSelectElement): string[] {
  return Array.from(select.querySelectorAll('option')).map((o) => o.text);
}

// ────────────────────────────────────────────────────────────────────────────
// array collections — label / value
// ────────────────────────────────────────────────────────────────────────────

describe('ngOptions over an array — label + value (FS §2.5)', () => {
  it('generates one option per array item with the label expression', () => {
    const { $compile, $rootScope } = boot();
    setModel($rootScope, 'items', [
      { id: 1, name: 'Ada' },
      { id: 2, name: 'Alan' },
    ]);
    const select = compile(
      '<select ng-model="chosen" ng-options="item.name for item in items"></select>',
      $compile,
      $rootScope,
    );

    expect(optionLabels(select)).toEqual(['Ada', 'Alan']);
  });

  it('binds the whole item as the model value (bare form)', () => {
    const { $compile, $rootScope } = boot();
    const ada = { id: 1, name: 'Ada' };
    const alan = { id: 2, name: 'Alan' };
    setModel($rootScope, 'items', [ada, alan]);
    const select = compile(
      '<select ng-model="chosen" ng-options="item.name for item in items"></select>',
      $compile,
      $rootScope,
    );

    (select.options[1] as HTMLOptionElement).selected = true;
    fireChange(select);
    expect(model($rootScope, 'chosen')).toBe(alan);
  });

  it('the `select as label` form binds the select expression, labels with the label expression', () => {
    const { $compile, $rootScope } = boot();
    setModel($rootScope, 'items', [
      { id: 1, name: 'Ada' },
      { id: 2, name: 'Alan' },
    ]);
    const select = compile(
      '<select ng-model="chosen" ng-options="item.id as item.name for item in items"></select>',
      $compile,
      $rootScope,
    );

    expect(optionLabels(select)).toEqual(['Ada', 'Alan']);
    (select.options[0] as HTMLOptionElement).selected = true;
    fireChange(select);
    expect(model($rootScope, 'chosen')).toBe(1);
  });

  it('renders the current model onto the selection', () => {
    const { $compile, $rootScope } = boot();
    const ada = { id: 1, name: 'Ada' };
    const alan = { id: 2, name: 'Alan' };
    setModel($rootScope, 'items', [ada, alan]);
    setModel($rootScope, 'chosen', alan);
    const select = compile(
      '<select ng-model="chosen" ng-options="item.name for item in items"></select>',
      $compile,
      $rootScope,
    );

    expect(select.options[select.selectedIndex]?.textContent).toBe('Alan');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// group by
// ────────────────────────────────────────────────────────────────────────────

describe('ngOptions group by — optgroups (FS §2.5)', () => {
  it('wraps options in <optgroup> by the group-by value', () => {
    const { $compile, $rootScope } = boot();
    setModel($rootScope, 'people', [
      { name: 'Ada', team: 'Analysis' },
      { name: 'Alan', team: 'Computing' },
      { name: 'Grace', team: 'Computing' },
    ]);
    const select = compile(
      '<select ng-model="chosen" ng-options="p.name group by p.team for p in people"></select>',
      $compile,
      $rootScope,
    );

    const groups = Array.from(select.querySelectorAll('optgroup'));
    expect(groups.map((g) => g.label)).toEqual(['Analysis', 'Computing']);
    const computing = groups[1] as HTMLOptGroupElement;
    expect(Array.from(computing.querySelectorAll('option')).map((o) => o.textContent)).toEqual(['Alan', 'Grace']);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// disable when
// ────────────────────────────────────────────────────────────────────────────

describe('ngOptions disable when — per-option disabled (FS §2.5)', () => {
  it('disables options whose disable-when expression is truthy', () => {
    const { $compile, $rootScope } = boot();
    setModel($rootScope, 'items', [
      { name: 'A', locked: false },
      { name: 'B', locked: true },
      { name: 'C', locked: false },
    ]);
    const select = compile(
      '<select ng-model="chosen" ng-options="i.name disable when i.locked for i in items"></select>',
      $compile,
      $rootScope,
    );

    const options = Array.from(select.querySelectorAll('option'));
    expect(options.map((o) => o.disabled)).toEqual([false, true, false]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// track by
// ────────────────────────────────────────────────────────────────────────────

describe('ngOptions track by — stable identity (FS §2.5)', () => {
  it('selects by track-by identity even with a fresh (non-identical) model object', () => {
    const { $compile, $rootScope } = boot();
    setModel($rootScope, 'items', [
      { id: 1, name: 'Ada' },
      { id: 2, name: 'Alan' },
    ]);
    const select = compile(
      '<select ng-model="chosen" ng-options="item.name for item in items track by item.id"></select>',
      $compile,
      $rootScope,
    );

    (select.options[0] as HTMLOptionElement).selected = true;
    fireChange(select);
    const chosen = model($rootScope, 'chosen') as { id: number };
    expect(chosen.id).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// object collections
// ────────────────────────────────────────────────────────────────────────────

describe('ngOptions over an object — (key, value) iteration (FS §2.5)', () => {
  it('generates options from object properties', () => {
    const { $compile, $rootScope } = boot();
    setModel($rootScope, 'colors', { r: 'Red', g: 'Green', b: 'Blue' });
    const select = compile(
      '<select ng-model="chosen" ng-options="value for (key, value) in colors"></select>',
      $compile,
      $rootScope,
    );

    expect(optionLabels(select)).toEqual(['Red', 'Green', 'Blue']);
  });

  it('binds the property value as the model value', () => {
    const { $compile, $rootScope } = boot();
    setModel($rootScope, 'colors', { r: 'Red', g: 'Green' });
    const select = compile(
      '<select ng-model="chosen" ng-options="value for (key, value) in colors"></select>',
      $compile,
      $rootScope,
    );

    (select.options[1] as HTMLOptionElement).selected = true;
    fireChange(select);
    expect(model($rootScope, 'chosen')).toBe('Green');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// collection change regenerates options
// ────────────────────────────────────────────────────────────────────────────

describe('ngOptions — collection change regenerates options (FS §2.5)', () => {
  it('regenerates the option list when the collection changes', () => {
    const { $compile, $rootScope } = boot();
    setModel($rootScope, 'items', [{ name: 'A' }]);
    const select = compile(
      '<select ng-model="chosen" ng-options="i.name for i in items"></select>',
      $compile,
      $rootScope,
    );
    expect(optionLabels(select)).toEqual(['A']);

    setModel($rootScope, 'items', [{ name: 'X' }, { name: 'Y' }, { name: 'Z' }]);
    $rootScope.$digest();
    expect(optionLabels(select)).toEqual(['X', 'Y', 'Z']);
  });

  it('appending to the collection adds options in place', () => {
    const { $compile, $rootScope } = boot();
    const items: { name: string }[] = [{ name: 'one' }];
    setModel($rootScope, 'items', items);
    const select = compile(
      '<select ng-model="chosen" ng-options="i.name for i in items"></select>',
      $compile,
      $rootScope,
    );
    expect(optionLabels(select)).toEqual(['one']);

    items.push({ name: 'two' });
    $rootScope.$digest();
    expect(optionLabels(select)).toEqual(['one', 'two']);
  });
});
