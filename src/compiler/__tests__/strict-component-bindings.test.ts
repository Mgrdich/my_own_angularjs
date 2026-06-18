/**
 * `$compileProvider.strictComponentBindingsEnabled` + required-binding
 * check (spec 034 Slice 3 / FS §2).
 *
 * Locks the AngularJS-canonical getter/setter surface for the
 * strict-component-bindings toggle plus its observable effect on
 * isolate-scope / `bindToController` binding wiring:
 *
 * - `strictComponentBindingsEnabled(value?)` is a config-phase
 *   getter/setter: called WITH a boolean it stores it and returns `this`
 *   (chainable); called with NO argument it returns the current value.
 *   Defaults to `false`.
 * - With strict ON, a component / directive used WITHOUT a required
 *   (non-`?`) binding routes `MissingComponentBindingError` via
 *   `$exceptionHandler('$compile')`, naming the missing input. All four
 *   binding kinds (`<` / `=` / `@` / `&`) trigger it when absent.
 * - An OPTIONAL (`?`) binding absent → NO error.
 * - A required binding that IS supplied → no error.
 * - Strict OFF (default) → a missing required binding does NOT error
 *   (today's lenient degrade is preserved).
 *
 * "Absent attribute" means the binding's resolved source attribute name
 * (`spec.attrName`) is not present as a string on the element's attrs —
 * the same bail condition each wiring strategy already uses to leave the
 * local undefined. Strict mode adds the report on top; the local still
 * stays undefined.
 *
 * Uses the shared compiler harness: `bootstrapNgModule({ exceptionHandler })`
 * installs a recording handler at the `ng`-module layer, and the config
 * callback flips the toggle inside the `config(['$compileProvider', …])`
 * block — exactly where a real app sets it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MissingComponentBindingError } from '@compiler/compile-error';
import type { $CompileProvider } from '@compiler/compile-provider';
import type {
  CompileService,
  ComponentDefinition,
  DirectiveFactory,
  DirectiveFactoryReturn,
} from '@compiler/directive-types';
import { createInjector } from '@di/injector';
import { createModule } from '@di/module';
import { Scope } from '@core/index';

import { bootstrapNgModule, compileWith } from './test-helpers';

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

/**
 * Register a component on the `app` module and flip the strict toggle in a
 * config block, then return the resolved `$compile`. `.component` is a
 * module-DSL method that forwards to `$compileProvider.component` via a
 * config block, so it cannot be reached from inside the `compileWith`
 * `$compileProvider` callback — it must be declared on the module.
 */
function compileWithComponent(name: string, definition: ComponentDefinition, strict: boolean): CompileService {
  const appModule = createModule('app', ['ng'])
    .config([
      '$compileProvider',
      ($cp: $CompileProvider) => {
        $cp.strictComponentBindingsEnabled(strict);
      },
    ])
    .component(name, definition);
  return createInjector([appModule]).get('$compile');
}

function firstError(handler: ReturnType<typeof vi.fn>): unknown {
  const callArgs = handler.mock.calls[0];
  expect(callArgs).toBeDefined();
  return (callArgs as unknown[])[0];
}

describe('$compileProvider.strictComponentBindingsEnabled — getter/setter (spec 034 Slice 3)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('defaults to false when no config flips it', () => {
    let current: boolean | undefined;
    compileWith(($cp) => {
      current = $cp.strictComponentBindingsEnabled();
    });
    expect(current).toBe(false);
  });

  it('the setter stores the value and returns the provider (chainable); the getter then returns it', () => {
    let getterValue: boolean | undefined;
    let chainedReturn: unknown;
    compileWith(($cp) => {
      chainedReturn = $cp.strictComponentBindingsEnabled(true);
      getterValue = $cp.strictComponentBindingsEnabled();
      expect(chainedReturn).toBe($cp);
    });
    expect(getterValue).toBe(true);
  });
});

describe('strict ON — required binding absent routes MissingComponentBindingError (spec 034 Slice 3)', () => {
  it('a `.component` with a required `<` binding used without the attribute routes via "$compile"', () => {
    const handler = vi.fn();
    bootstrapNgModule({ exceptionHandler: handler });
    const $compile = compileWithComponent('userCard', { bindings: { user: '<' } }, true);

    const el = document.createElement('user-card');
    $compile(el)(Scope.create());

    expect(handler).toHaveBeenCalledTimes(1);
    const err = firstError(handler);
    expect(err).toBeInstanceOf(MissingComponentBindingError);
    expect((err as Error).message).toContain('"user"');
    expect((err as Error).message).toContain('userCard');
    // Routed with the '$compile' cause — no new cause token.
    const callArgs = handler.mock.calls[0] as unknown[];
    expect(callArgs[1]).toBe('$compile');
  });

  it('all four binding kinds (<, =, @, &) trigger the error when absent', () => {
    const handler = vi.fn();
    bootstrapNgModule({ exceptionHandler: handler });
    const $compile = compileWithComponent(
      'quadCard',
      { bindings: { one: '<', two: '=', three: '@', four: '&' } },
      true,
    );

    const el = document.createElement('quad-card');
    $compile(el)(Scope.create());

    expect(handler).toHaveBeenCalledTimes(4);
    const missing = handler.mock.calls.map((call) => {
      const err = (call as unknown[])[0];
      expect(err).toBeInstanceOf(MissingComponentBindingError);
      return (err as Error).message;
    });
    expect(missing.some((m) => m.includes('"one"'))).toBe(true);
    expect(missing.some((m) => m.includes('"two"'))).toBe(true);
    expect(missing.some((m) => m.includes('"three"'))).toBe(true);
    expect(missing.some((m) => m.includes('"four"'))).toBe(true);
  });

  it('an isolate-scope directive (no controller) with a required `@` binding also reports when absent', () => {
    const handler = vi.fn();
    bootstrapNgModule({ exceptionHandler: handler });
    const $compile = compileWith(($cp) => {
      $cp.strictComponentBindingsEnabled(true);
      $cp.directive(
        'myWidget',
        ddoFactory({
          restrict: 'E',
          scope: { title: '@' },
        }),
      );
    });

    const el = document.createElement('my-widget');
    $compile(el)(Scope.create());

    expect(handler).toHaveBeenCalledTimes(1);
    const err = firstError(handler);
    expect(err).toBeInstanceOf(MissingComponentBindingError);
    expect((err as Error).message).toContain('"title"');
    expect((err as Error).message).toContain('myWidget');
  });
});

describe('strict ON — optional / supplied bindings do NOT error (spec 034 Slice 3)', () => {
  it('an OPTIONAL (?) binding absent does not report', () => {
    const handler = vi.fn();
    bootstrapNgModule({ exceptionHandler: handler });
    const $compile = compileWithComponent(
      'optCard',
      { bindings: { one: '<?', two: '=?', three: '@?', four: '&?' } },
      true,
    );

    const el = document.createElement('opt-card');
    $compile(el)(Scope.create());

    expect(handler).not.toHaveBeenCalled();
  });

  it('a required binding that IS supplied does not report', () => {
    const handler = vi.fn();
    bootstrapNgModule({ exceptionHandler: handler });
    const $compile = compileWithComponent('userCard', { bindings: { user: '<' } }, true);

    const el = document.createElement('user-card');
    el.setAttribute('user', 'someExpr');
    const scope = Scope.create<{ someExpr?: unknown }>();
    scope.someExpr = { id: 'u1' };
    $compile(el)(scope);

    expect(handler).not.toHaveBeenCalled();
  });

  it('all four supplied required bindings do not report', () => {
    const handler = vi.fn();
    bootstrapNgModule({ exceptionHandler: handler });
    const $compile = compileWithComponent(
      'quadCard',
      { bindings: { one: '<', two: '=', three: '@', four: '&' } },
      true,
    );

    const el = document.createElement('quad-card');
    el.setAttribute('one', 'a');
    el.setAttribute('two', 'b');
    el.setAttribute('three', 'literal');
    el.setAttribute('four', 'doThing()');
    const scope = Scope.create<{ a?: unknown; b?: unknown }>();
    scope.a = 1;
    scope.b = 2;
    $compile(el)(scope);

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('strict OFF (default) — a missing required binding is tolerated (spec 034 Slice 3)', () => {
  it('a required binding absent does NOT error when strict is off', () => {
    const handler = vi.fn();
    bootstrapNgModule({ exceptionHandler: handler });
    // Strict OFF explicitly (the default), via `.component` path.
    const $compile = compileWithComponent('userCard', { bindings: { user: '<' } }, false);

    const el = document.createElement('user-card');
    $compile(el)(Scope.create());

    expect(handler).not.toHaveBeenCalled();
  });

  it('the default (no toggle call at all) tolerates a missing required binding', () => {
    const handler = vi.fn();
    bootstrapNgModule({ exceptionHandler: handler });
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myWidget',
        ddoFactory({
          restrict: 'E',
          scope: { title: '@' },
        }),
      );
    });

    const el = document.createElement('my-widget');
    $compile(el)(Scope.create());

    expect(handler).not.toHaveBeenCalled();
  });
});
