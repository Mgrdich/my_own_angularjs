/**
 * Typed `input` type matrix (spec 039 Slice 3 / FS §2.4).
 *
 * Drives each input type end-to-end through the real `ngModule` (via
 * `bootstrapInjector`) so the forms directives registered by
 * `src/core/ng-module.ts` are reachable. User input is simulated by
 * setting `element.value` (+ `.checked` for checkbox / radio) and
 * dispatching native `input` / `change` events, matching how a browser
 * drives the control. Vectors ported from AngularJS `inputSpec.js`.
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
function compile(html: string, $compile: CompileService, scope: Scope): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  const child = el.firstElementChild as HTMLElement;
  $compile(child)(scope);
  scope.$digest();
  return child;
}

/** Compile a whole fragment (multiple siblings) — used for radio groups. */
function compileAll(html: string, $compile: CompileService, scope: Scope): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  $compile(wrapper)(scope);
  scope.$digest();
  return wrapper;
}

function fireInput(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input'));
}

function fireChange(el: HTMLInputElement): void {
  el.dispatchEvent(new Event('change'));
}

function model(scope: Scope, key: string): unknown {
  return (scope as unknown as Record<string, unknown>)[key];
}

function modelDate(scope: Scope, key: string): Date {
  const value = model(scope, key);
  if (!(value instanceof Date)) {
    throw new Error(`expected model '${key}' to be a Date`);
  }
  return value;
}

function setModel(scope: Scope, key: string, value: unknown): void {
  (scope as unknown as Record<string, unknown>)[key] = value;
}

function asInput(el: HTMLElement): HTMLInputElement {
  return el as HTMLInputElement;
}

/**
 * jsdom sanitizes an invalid `type=number` / `type=date` value to `''` and
 * does NOT set `validity.badInput` (a documented jsdom limitation). To
 * exercise the real `badInputChecker` code path — the handler reads
 * `control.validity.badInput` — we override the element's `validity` to
 * report `badInput: true`, matching what a real browser surfaces when the
 * user types garbage into a typed control.
 */
function setBadInput(el: HTMLInputElement, bad: boolean): void {
  const fake = { badInput: bad, valid: !bad } as unknown as ValidityState;
  Object.defineProperty(el, 'validity', { configurable: true, get: () => fake });
}

/** Simulate typing bad input the browser can't sanitize (value → ''). */
function fireBadInput(el: HTMLInputElement): void {
  setBadInput(el, true);
  el.value = '';
  el.dispatchEvent(new Event('input'));
}

// ────────────────────────────────────────────────────────────────────────────
// number
// ────────────────────────────────────────────────────────────────────────────

describe('input[type=number] — model holds a Number (FS §2.4)', () => {
  it('parses numeric input into a Number', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile('<input type="number" ng-model="age">', $compile, $rootScope));

    fireInput(el, '42');
    expect(model($rootScope, 'age')).toBe(42);
    expect(typeof model($rootScope, 'age')).toBe('number');

    fireInput(el, '3.14');
    expect(model($rootScope, 'age')).toBeCloseTo(3.14);
  });

  it('formats a numeric model back into the field', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile('<input type="number" ng-model="age">', $compile, $rootScope));

    setModel($rootScope, 'age', 99);
    $rootScope.$digest();
    expect(el.value).toBe('99');
  });

  it('bad (non-numeric) input makes the control invalid and does NOT write a bad model', () => {
    const { $compile, $rootScope } = boot();
    setModel($rootScope, 'age', 5);
    const el = asInput(compile('<input type="number" ng-model="age">', $compile, $rootScope));

    fireBadInput(el);
    expect(el.classList.contains('ng-invalid')).toBe(true);
    expect(el.classList.contains('ng-invalid-number')).toBe(true);
    // Model is left as undefined (bad parse), never the string 'abc'.
    expect(model($rootScope, 'age')).toBeUndefined();
  });

  it('recovering with a good value clears the number invalidity', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile('<input type="number" ng-model="age">', $compile, $rootScope));

    fireBadInput(el);
    expect(el.classList.contains('ng-invalid-number')).toBe(true);

    setBadInput(el, false);
    fireInput(el, '7');
    expect(el.classList.contains('ng-valid-number')).toBe(true);
    expect(model($rootScope, 'age')).toBe(7);
  });

  it('empty input maps to a null model without failing the number rule', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile('<input type="number" ng-model="age">', $compile, $rootScope));

    fireInput(el, '5');
    expect(model($rootScope, 'age')).toBe(5);

    fireInput(el, '');
    expect(model($rootScope, 'age')).toBeNull();
    expect(el.classList.contains('ng-valid-number')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// range
// ────────────────────────────────────────────────────────────────────────────

describe('input[type=range] — Number with clamping (FS §2.4)', () => {
  it('parses to a Number', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile('<input type="range" ng-model="vol" min="0" max="10">', $compile, $rootScope));

    fireInput(el, '5');
    expect(model($rootScope, 'vol')).toBe(5);
    expect(typeof model($rootScope, 'vol')).toBe('number');
  });

  it('clamps above max down to max', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile('<input type="range" ng-model="vol" min="0" max="10">', $compile, $rootScope));

    fireInput(el, '50');
    expect(model($rootScope, 'vol')).toBe(10);
  });

  it('clamps below min up to min', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile('<input type="range" ng-model="vol" min="5" max="10">', $compile, $rootScope));

    fireInput(el, '1');
    expect(model($rootScope, 'vol')).toBe(5);
  });

  it('snaps to the nearest step', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile('<input type="range" ng-model="vol" min="0" max="10" step="2">', $compile, $rootScope));

    fireInput(el, '5');
    // 5 is between step boundaries 4 and 6; rounds to nearest → 6.
    expect(model($rootScope, 'vol')).toBe(6);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// checkbox
// ────────────────────────────────────────────────────────────────────────────

describe('input[type=checkbox] — model holds a boolean (FS §2.4)', () => {
  it('checking / unchecking writes true / false', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile('<input type="checkbox" ng-model="agree">', $compile, $rootScope));

    el.checked = true;
    fireChange(el);
    expect(model($rootScope, 'agree')).toBe(true);

    el.checked = false;
    fireChange(el);
    expect(model($rootScope, 'agree')).toBe(false);
  });

  it('a boolean model checks / unchecks the box', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile('<input type="checkbox" ng-model="agree">', $compile, $rootScope));

    setModel($rootScope, 'agree', true);
    $rootScope.$digest();
    expect(el.checked).toBe(true);

    setModel($rootScope, 'agree', false);
    $rootScope.$digest();
    expect(el.checked).toBe(false);
  });

  it('ng-true-value / ng-false-value override the stored values', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(
      compile(
        '<input type="checkbox" ng-model="answer" ng-true-value="\'YES\'" ng-false-value="\'NO\'">',
        $compile,
        $rootScope,
      ),
    );

    el.checked = true;
    fireChange(el);
    expect(model($rootScope, 'answer')).toBe('YES');

    el.checked = false;
    fireChange(el);
    expect(model($rootScope, 'answer')).toBe('NO');
  });

  it('$isEmpty is unchecked (drives ng-empty)', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile('<input type="checkbox" ng-model="agree">', $compile, $rootScope));

    // Fresh, unchecked → empty.
    expect(el.classList.contains('ng-empty')).toBe(true);

    el.checked = true;
    fireChange(el);
    expect(el.classList.contains('ng-not-empty')).toBe(true);
    expect(el.classList.contains('ng-empty')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// radio
// ────────────────────────────────────────────────────────────────────────────

describe('input[type=radio] — selected value across a group (FS §2.4)', () => {
  const groupHtml =
    '<div>' +
    '<input type="radio" ng-model="color" value="red">' +
    '<input type="radio" ng-model="color" value="green">' +
    '<input type="radio" ng-model="color" value="blue">' +
    '</div>';

  it('checking a radio writes its value to the shared model', () => {
    const { $compile, $rootScope } = boot();
    const wrapper = compileAll(groupHtml, $compile, $rootScope);
    const radios = wrapper.querySelectorAll('input');
    const green = radios[1] as HTMLInputElement;

    green.checked = true;
    fireChange(green);
    expect(model($rootScope, 'color')).toBe('green');
  });

  it('a model value checks the matching radio and unchecks the others', () => {
    const { $compile, $rootScope } = boot();
    const wrapper = compileAll(groupHtml, $compile, $rootScope);
    const radios = wrapper.querySelectorAll('input');

    setModel($rootScope, 'color', 'blue');
    $rootScope.$digest();

    expect((radios[0] as HTMLInputElement).checked).toBe(false);
    expect((radios[1] as HTMLInputElement).checked).toBe(false);
    expect((radios[2] as HTMLInputElement).checked).toBe(true);
  });

  it('switching selection updates the model and the checked states', () => {
    const { $compile, $rootScope } = boot();
    const wrapper = compileAll(groupHtml, $compile, $rootScope);
    const radios = wrapper.querySelectorAll('input');
    const red = radios[0] as HTMLInputElement;
    const blue = radios[2] as HTMLInputElement;

    red.checked = true;
    fireChange(red);
    expect(model($rootScope, 'color')).toBe('red');

    blue.checked = true;
    fireChange(blue);
    expect(model($rootScope, 'color')).toBe('blue');

    $rootScope.$digest();
    expect(red.checked).toBe(false);
    expect(blue.checked).toBe(true);
  });

  it('ng-value binds a data-driven value', () => {
    const { $compile, $rootScope } = boot();
    setModel($rootScope, 'opt', 'beta');
    const el = asInput(compile('<input type="radio" ng-model="choice" ng-value="opt">', $compile, $rootScope));

    el.checked = true;
    fireChange(el);
    expect(model($rootScope, 'choice')).toBe('beta');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// date / time family
// ────────────────────────────────────────────────────────────────────────────

describe('input[type=date] — model holds a Date (FS §2.4)', () => {
  it('parses YYYY-MM-DD into a local Date', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile('<input type="date" ng-model="d">', $compile, $rootScope));

    fireInput(el, '2020-03-15');
    const d = modelDate($rootScope, 'd');
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2020);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(15);
  });

  it('formats a Date model into the field', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile('<input type="date" ng-model="d">', $compile, $rootScope));

    setModel($rootScope, 'd', new Date(2019, 11, 25));
    $rootScope.$digest();
    expect(el.value).toBe('2019-12-25');
  });

  it('round-trips a Date through the field', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile('<input type="date" ng-model="d">', $compile, $rootScope));

    fireInput(el, '2021-07-04');
    $rootScope.$digest();
    expect(el.value).toBe('2021-07-04');
    expect(modelDate($rootScope, 'd').getDate()).toBe(4);
  });

  it('malformed input invalidates and empty clears the date key', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile('<input type="date" ng-model="d">', $compile, $rootScope));

    fireBadInput(el);
    expect(el.classList.contains('ng-invalid-date')).toBe(true);
    expect(model($rootScope, 'd')).toBeUndefined();

    setBadInput(el, false);
    fireInput(el, '');
    expect(el.classList.contains('ng-valid-date')).toBe(true);
    expect(model($rootScope, 'd')).toBeNull();
  });
});

describe('input[type=datetime-local] — model holds a Date', () => {
  it('round-trips date + time components', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile('<input type="datetime-local" ng-model="dt">', $compile, $rootScope));

    fireInput(el, '2020-01-02T13:45');
    const d = modelDate($rootScope, 'dt');
    expect(d).toBeInstanceOf(Date);
    expect(d.getHours()).toBe(13);
    expect(d.getMinutes()).toBe(45);

    setModel($rootScope, 'dt', new Date(2020, 0, 2, 13, 45, 0, 0));
    $rootScope.$digest();
    // The formatter emits the full `…:00.000` form (AngularJS parity); jsdom
    // then normalizes a whole-minute datetime-local `.value` by dropping the
    // trailing `:00.000` (matching the HTML sanitization algorithm), so the
    // stored value is the minute-precision form.
    expect(el.value).toBe('2020-01-02T13:45');
  });
});

describe('input[type=time] — model holds a Date anchored to 1970-01-01', () => {
  it('round-trips a time value', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile('<input type="time" ng-model="t">', $compile, $rootScope));

    fireInput(el, '09:30');
    const d = modelDate($rootScope, 't');
    expect(d).toBeInstanceOf(Date);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(30);

    setModel($rootScope, 't', new Date(1970, 0, 1, 9, 30, 0, 0));
    $rootScope.$digest();
    expect(el.value).toBe('09:30:00.000');
  });
});

describe('input[type=month] — model holds a Date on the 1st', () => {
  it('round-trips a month value', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile('<input type="month" ng-model="m">', $compile, $rootScope));

    fireInput(el, '2022-06');
    const d = modelDate($rootScope, 'm');
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2022);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(1);

    setModel($rootScope, 'm', new Date(2022, 5, 1));
    $rootScope.$digest();
    expect(el.value).toBe('2022-06');
  });
});

describe('input[type=week] — model holds a Date on the ISO week Monday', () => {
  it('round-trips a week value', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile('<input type="week" ng-model="w">', $compile, $rootScope));

    fireInput(el, '2020-W03');
    const d = modelDate($rootScope, 'w');
    expect(d).toBeInstanceOf(Date);

    // Format it back and it must round-trip to the same week string.
    setModel($rootScope, 'w', d);
    $rootScope.$digest();
    expect(el.value).toBe('2020-W03');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// no-model types
// ────────────────────────────────────────────────────────────────────────────

describe('input[type=hidden|button|submit|reset] — no model parsing', () => {
  it('a hidden control does not round-trip through ng-model', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile('<input type="hidden" ng-model="h">', $compile, $rootScope));

    // The no-op handler installs no listeners; a native input event does
    // not commit anything to the model.
    fireInput(el, 'anything');
    expect(model($rootScope, 'h')).toBeUndefined();
  });

  it('a button control is a no-op', () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile('<input type="button" ng-model="b">', $compile, $rootScope));
    fireInput(el, 'x');
    expect(model($rootScope, 'b')).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// baseline string types
// ────────────────────────────────────────────────────────────────────────────

describe('input[type=email|url|search|tel|password] — baseline string handlers', () => {
  // Use a type-appropriate VALID value so the value binds — `email` / `url`
  // now carry their Slice-5 shape validators, so an invalid value would be
  // kept out of the model (AngularJS parity). `search` / `tel` / `password`
  // have no shape validator, so any string binds.
  it.each([
    ['email', 'ada@example.com'],
    ['url', 'http://example.com'],
    ['search', 'hello'],
    ['tel', 'hello'],
    ['password', 'hello'],
  ])('type=%s binds a string', (type, value) => {
    const { $compile, $rootScope } = boot();
    const el = asInput(compile(`<input type="${type}" ng-model="v">`, $compile, $rootScope));

    fireInput(el, value);
    expect(model($rootScope, 'v')).toBe(value);
    expect(typeof model($rootScope, 'v')).toBe('string');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PR-audit regressions — radio ng-value liveness + change trigger
// ────────────────────────────────────────────────────────────────────────────

describe('radio — data-driven ng-value (PR-audit regressions)', () => {
  it('re-checks the radio when its ng-value expression changes to match the model', () => {
    const { $compile, $rootScope } = boot();
    setModel($rootScope, 'color', 'alpha');
    setModel($rootScope, 'opt', 'gamma');
    const el = asInput(compile('<input type="radio" ng-model="color" ng-value="opt">', $compile, $rootScope));

    expect(el.checked).toBe(false);

    // The contributed value now matches the model — the radio must check
    // itself on the next digest (the ng-value EXPRESSION is watched; the
    // `value` attribute is absent, so `$observe` alone would never fire).
    setModel($rootScope, 'opt', 'alpha');
    $rootScope.$digest();
    expect(el.checked).toBe(true);
  });

  it("commits under the 'change' debounce trigger", () => {
    const { $compile, $rootScope } = boot();
    const el = asInput(
      compile(
        '<input type="radio" ng-model="pick" value="a" ng-model-options="{ debounce: { change: 1000000 } }">',
        $compile,
        $rootScope,
      ),
    );

    el.checked = true;
    fireChange(el);
    // The change-triggered commit is debounced — the model must NOT hold
    // the value synchronously.
    expect(model($rootScope, 'pick')).toBeUndefined();
  });
});
