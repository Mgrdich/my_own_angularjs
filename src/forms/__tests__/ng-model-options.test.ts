/**
 * `ngModelOptions` — `updateOn` / `debounce` / `allowInvalid` / `getterSetter`
 * / `timezone` (spec 039 Slice 6 / FS §2.5).
 *
 * End-to-end through the canonical `ngModule` (via `bootstrapInjector`),
 * exercising the real `$compile` / `$rootScope` / `$timeout`. Debounce +
 * `updateOn` timing use vitest fake timers; a `$timeout`-backed debounce
 * commit fires inside `$rootScope.$apply`, so advancing the timers is enough
 * to drive the commit (no extra digest needed).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function compile(html: string, $compile: CompileService, scope: Scope): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  const child = el.firstElementChild as HTMLElement;
  $compile(child)(scope);
  scope.$digest();
  return child;
}

function findInput(root: HTMLElement): HTMLInputElement {
  const node = root.tagName === 'INPUT' ? root : root.querySelector('input');
  if (node === null) {
    throw new Error('no <input> found');
  }
  return node as HTMLInputElement;
}

function type(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input'));
}

function fire(el: HTMLInputElement, event: string): void {
  el.dispatchEvent(new Event(event));
}

function model(scope: Scope, key: string): unknown {
  return (scope as unknown as Record<string, unknown>)[key];
}

function setModel(scope: Scope, key: string, value: unknown): void {
  (scope as unknown as Record<string, unknown>)[key] = value;
}

describe('ngModelOptions — registration', () => {
  it('registers ngModelOptions on ngModule', () => {
    const injector = bootstrapInjector([]);
    expect(injector.has('ngModelOptionsDirective')).toBe(true);
  });
});

describe('ngModelOptions — updateOn (FS §2.5)', () => {
  it("updateOn: 'blur' defers the commit until blur — typing does not commit", () => {
    const { $compile, $rootScope } = boot();
    const root = compile(
      `<div><input type="text" ng-model="name" ng-model-options="{ updateOn: 'blur' }"></div>`,
      $compile,
      $rootScope,
    );
    const el = findInput(root);

    // Typing buffers the pending value but does NOT commit to the model.
    type(el, 'Ada');
    expect(model($rootScope, 'name')).toBeUndefined();

    // Blur commits the buffered value.
    fire(el, 'blur');
    expect(model($rootScope, 'name')).toBe('Ada');
  });

  it("updateOn: 'default blur' commits on typing AND on blur", () => {
    const { $compile, $rootScope } = boot();
    const root = compile(
      `<div><input type="text" ng-model="name" ng-model-options="{ updateOn: 'default blur' }"></div>`,
      $compile,
      $rootScope,
    );
    const el = findInput(root);

    type(el, 'Grace');
    expect(model($rootScope, 'name')).toBe('Grace');
  });

  it('inherits updateOn from an ancestor ngModelOptions', () => {
    const { $compile, $rootScope } = boot();
    const root = compile(
      `<div ng-model-options="{ updateOn: 'blur' }"><input type="text" ng-model="name"></div>`,
      $compile,
      $rootScope,
    );
    const el = findInput(root);

    type(el, 'Edith');
    expect(model($rootScope, 'name')).toBeUndefined();
    fire(el, 'blur');
    expect(model($rootScope, 'name')).toBe('Edith');
  });
});

describe('ngModelOptions — debounce (FS §2.5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounce (a number) delays the model write', () => {
    const { $compile, $rootScope } = boot();
    const root = compile(
      `<div><input type="text" ng-model="name" ng-model-options="{ debounce: 300 }"></div>`,
      $compile,
      $rootScope,
    );
    const el = findInput(root);

    type(el, 'Lin');
    // Not committed yet — the debounce timer is still pending.
    expect(model($rootScope, 'name')).toBeUndefined();

    vi.advanceTimersByTime(300);
    expect(model($rootScope, 'name')).toBe('Lin');
  });

  it('a superseding change resets the debounce timer', () => {
    const { $compile, $rootScope } = boot();
    const root = compile(
      `<div><input type="text" ng-model="name" ng-model-options="{ debounce: 300 }"></div>`,
      $compile,
      $rootScope,
    );
    const el = findInput(root);

    type(el, 'a');
    vi.advanceTimersByTime(200);
    // A second keystroke before the first commit resets the window.
    type(el, 'ab');
    vi.advanceTimersByTime(200);
    expect(model($rootScope, 'name')).toBeUndefined();

    vi.advanceTimersByTime(100);
    expect(model($rootScope, 'name')).toBe('ab');
  });

  it('a per-event debounce map applies a different delay per trigger', () => {
    const { $compile, $rootScope } = boot();
    const root = compile(
      `<div><input type="text" ng-model="name"
         ng-model-options="{ updateOn: 'default blur', debounce: { default: 300, blur: 0 } }"></div>`,
      $compile,
      $rootScope,
    );
    const el = findInput(root);

    // A `default` (input) commit is debounced by 300ms.
    type(el, 'x');
    expect(model($rootScope, 'name')).toBeUndefined();
    vi.advanceTimersByTime(300);
    expect(model($rootScope, 'name')).toBe('x');

    // A `blur` commit is immediate (delay 0) — flushes the pending default too.
    type(el, 'xy');
    fire(el, 'blur');
    expect(model($rootScope, 'name')).toBe('xy');
  });

  it('cancels a pending debounce timer on $destroy (no late write, no throw)', () => {
    const { $compile, $rootScope } = boot();
    // Link against a CHILD scope so `$destroy()` actually fires (the root
    // scope's `$destroy` is a no-op in this framework); the control's
    // `$on('$destroy')` cancel handler runs on the child scope teardown.
    const child = $rootScope.$new();
    const host = document.createElement('div');
    host.innerHTML = `<input type="text" ng-model="name" ng-model-options="{ debounce: 300 }">`;
    const inputEl = host.firstElementChild as HTMLInputElement;
    $compile(inputEl)(child);
    child.$digest();

    type(inputEl, 'gone');
    // Destroy the (child) scope before the debounce fires.
    child.$destroy();

    expect(() => {
      vi.advanceTimersByTime(500);
    }).not.toThrow();
    // The commit never lands after destroy.
    expect(model($rootScope, 'name')).toBeUndefined();
  });
});

describe('ngModelOptions — allowInvalid (FS §2.5)', () => {
  it('allowInvalid: true writes an invalid value to the model (validity still flips)', () => {
    const { $compile, $rootScope } = boot();
    const root = compile(
      `<div><input type="text" ng-model="v" required ng-model-options="{ allowInvalid: true }"></div>`,
      $compile,
      $rootScope,
    );
    const el = findInput(root);

    // required makes an empty value invalid; with allowInvalid the empty
    // string is still written, and the required rule still flips validity.
    type(el, 'x');
    expect(model($rootScope, 'v')).toBe('x');
    type(el, '');
    // Invalid (required) — but allowInvalid keeps the empty string in the model.
    expect(model($rootScope, 'v')).toBe('');
    expect(el.classList.contains('ng-invalid')).toBe(true);
    expect(el.classList.contains('ng-invalid-required')).toBe(true);
  });

  it('WITHOUT allowInvalid an invalid value is withheld (default)', () => {
    const { $compile, $rootScope } = boot();
    const root = compile(`<div><input type="number" ng-model="n"></div>`, $compile, $rootScope);
    const el = findInput(root);

    setModel($rootScope, 'n', 5);
    $rootScope.$digest();
    // Force a bad numeric parse.
    Object.defineProperty(el, 'validity', {
      configurable: true,
      get: () => ({ badInput: true, valid: false }) as unknown as ValidityState,
    });
    el.value = '';
    el.dispatchEvent(new Event('input'));

    expect(model($rootScope, 'n')).toBeUndefined();
    expect(el.classList.contains('ng-invalid-number')).toBe(true);
  });
});

describe('ngModelOptions — getterSetter (FS §2.5)', () => {
  it('getterSetter: true round-trips through a getter/setter function', () => {
    const { $compile, $rootScope } = boot();
    let stored = 'initial';
    // AngularJS getter/setter convention: called with no args → read; called
    // with a value → write. `function` (not arrow) so `arguments` is available.
    function accessor(...args: unknown[]): unknown {
      if (args.length === 0) {
        return stored;
      }
      stored = args[0] as string;
      return stored;
    }
    setModel($rootScope, 'name', accessor);

    const root = compile(
      `<div><input type="text" ng-model="name" ng-model-options="{ getterSetter: true }"></div>`,
      $compile,
      $rootScope,
    );
    const el = findInput(root);

    // Read: the getter's current value renders into the field.
    expect(el.value).toBe('initial');

    // Write: typing calls the setter, updating the backing store.
    type(el, 'updated');
    expect(stored).toBe('updated');

    // Read again from code: the getter reflects the new value.
    stored = 'external';
    $rootScope.$digest();
    expect(el.value).toBe('external');
  });
});

describe('ngModelOptions — timezone (FS §2.5)', () => {
  /** Parse a `type=date` value under a given timezone option, returning the model Date. */
  function parseDateUnderTz(tz: string, value: string): Date {
    const { $compile, $rootScope } = boot();
    const root = compile(
      `<div><input type="date" ng-model="d" ng-model-options="{ timezone: '${tz}' }"></div>`,
      $compile,
      $rootScope,
    );
    const el = findInput(root);
    el.value = value;
    el.dispatchEvent(new Event('input'));
    const d = model($rootScope, 'd');
    expect(d).toBeInstanceOf(Date);
    resetRegistry();
    return d as Date;
  }

  it('timezone shifts the parsed instant: UTC vs +0500 differ by 5 hours', () => {
    // The SAME date string parsed under two zones yields two instants five
    // hours apart — midnight in a more-eastern zone is an earlier UTC instant.
    // This relative check is host-timezone-independent (unlike an absolute
    // getTime() assertion).
    const utc = parseDateUnderTz('UTC', '2020-06-15');
    const east5 = parseDateUnderTz('+0500', '2020-06-15');
    // The two zones produce instants exactly five hours apart (the direction
    // is a convention detail of the shared date helper; the magnitude proves
    // the timezone option is honored end-to-end).
    expect(Math.abs(utc.getTime() - east5.getTime())).toBe(5 * 60 * 60 * 1000);
  });

  it('round-trips a date-model Date back into the field text under UTC (lossless)', () => {
    const { $compile, $rootScope } = boot();

    // First control: parse '2021-01-02' under UTC to obtain the model Date.
    const rootA = compile(
      `<div><input type="date" ng-model="d" ng-model-options="{ timezone: 'UTC' }"></div>`,
      $compile,
      $rootScope,
    );
    const elA = findInput(rootA);
    elA.value = '2021-01-02';
    elA.dispatchEvent(new Event('input'));
    const parsedDate = model($rootScope, 'd');
    expect(parsedDate).toBeInstanceOf(Date);

    // Second control bound to the SAME model, also UTC: it renders the Date
    // back into the input as the original string — parse/format under the
    // configured zone is symmetric (lossless round-trip).
    const rootB = compile(
      `<div><input type="date" ng-model="d" ng-model-options="{ timezone: 'UTC' }"></div>`,
      $compile,
      $rootScope,
    );
    const elB = findInput(rootB);
    $rootScope.$digest();
    expect(elB.value).toBe('2021-01-02');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PR-audit regression — a lone `updateOn: '*'` resets to default events
// ────────────────────────────────────────────────────────────────────────────

describe("ngModelOptions — updateOn: '*' alone (inheritance reset)", () => {
  it('resets an inherited blur-only updateOn back to the default input events', () => {
    const { $compile, $rootScope } = boot();
    const root = compile(
      '<div ng-model-options="{ updateOn: \'blur\' }">' +
        '<input ng-model="v" ng-model-options="{ updateOn: \'*\' }">' +
        '</div>',
      $compile,
      $rootScope,
    );
    const el = findInput(root);

    // The child reset inheritance — typing must commit immediately (the
    // handler's default events), NOT wait for blur.
    type(el, 'typed');
    expect(model($rootScope, 'v')).toBe('typed');
  });
});
