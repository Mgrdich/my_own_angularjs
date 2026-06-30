/**
 * AngularJS 1.x `controllerSpec.js` parity port (spec 020 Slice 5).
 *
 * Ports representative cases from
 * `angular/angular.js/test/ng/controllerSpec.js` onto this project's
 * `createInjector(['ng', customModule])` + `Scope.create()` infrastructure.
 * The DI bootstrap pattern mirrors `controller-di.test.ts` (Slice 3) —
 * register through `$controllerProvider` in a `config()` block, resolve
 * `$controller` from the injector, exercise against a real `Scope`.
 *
 * Cases ported (one `it(...)` each):
 *
 * 1. `'as'` syntax — registered name → scope alias bind + `this` capture
 * 2. `'as'` syntax — inline (array-style) function with explicit `ident`
 * 3. `'as'` syntax — explicit `ident` precedence (wins over alias suffix)
 * 4. `register(map)` object form
 * 5. Locals override — controller asks for a service; locals supply a
 *    substitute
 * 6. Controller returns object → return-value replacement
 * 7. `$controllerProvider.has(name)` introspection (from inside a
 *    `config()` block — the provider is not reachable post-config)
 *
 * Cases deliberately SKIPPED (each `it.skip(...)` with a roadmap citation):
 *
 * 8. `allowGlobals` (window scanning) — PERMANENTLY OUT on security
 *    grounds.
 * 9. `require: '^myDir'` — deferred to "Controllers — `require:` field".
 * 10. `bindToController` — depends on isolate scope; deferred to
 *     "Isolate scope".
 * 11. `$onInit` lifecycle hook — deferred to "Component lifecycle hooks".
 *
 * The `it.skip(...)` form is intentional so a future audit can
 * `grep '.skip('` and immediately see which AngularJS 1.x features
 * are deferred and which roadmap item revisits each.
 */

import { describe, expect, it } from 'vitest';

import { $ControllerProvider } from '@controller/controller-provider';
import type { ControllerInvokable, ControllerService } from '@controller/controller-types';

import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';

import { createInjector } from '@di/injector';
import { createModule } from '@di/module';

import { EXCEPTION_HANDLER_CAUSES } from '@exception-handler/index';

/**
 * Build a fresh `(app module, $controller)` pair per test. `configure`
 * runs inside a `config()` block with `$controllerProvider` injected so
 * registrations land before the injector finishes booting.
 */
function buildHarness(configure: (cp: $ControllerProvider) => void): { $controller: ControllerService } {
  const appModule = createModule('app', ['ng']).config([
    '$controllerProvider',
    (cp: $ControllerProvider) => {
      configure(cp);
    },
  ]);
  const injector = createInjector([ngModule, appModule]);
  return {
    $controller: injector.get<ControllerService>('$controller'),
  };
}

describe('"as" syntax — registered name', () => {
  it('binds the constructed instance to scope[alias] via "Name as alias"', () => {
    // Upstream parity: `'should publish controller instance into scope'`.
    // The bare `this.value = 'hi'` assignment relies on the array-style
    // annotation calling the trailing function with `self = instance` —
    // `Object.create(constructor.prototype)` + invoke + return-value
    // replacement gives us the AngularJS-canonical `this` semantics.
    const ctor: ControllerInvokable = [
      function (this: { value?: string }) {
        this.value = 'hi';
      },
    ];

    const { $controller } = buildHarness((cp) => {
      cp.register('GreeterCtrl', ctor);
    });
    const $scope = Scope.create();

    const instance = $controller('GreeterCtrl as vm', { $scope });

    expect(($scope as unknown as Record<string, unknown>).vm).toBe(instance);
    expect((instance as { value: string }).value).toBe('hi');
  });
});

describe('"as" syntax — inline (array-style) function', () => {
  it('binds the instance to scope[ident] when ident is explicit', () => {
    // Upstream parity: `'should inject given scope'` + the `as` variants.
    // Bare functions are not annotated automatically — the project's
    // `injector.invoke` rejects them — so this test uses the
    // minification-safe array-style spelling for the inline path. This is
    // the AngularJS-vs-this-project deviation: AngularJS would parse the
    // function source to discover deps; we require explicit annotation.
    const inline: ControllerInvokable = [
      function (this: { value?: number }) {
        this.value = 42;
      },
    ];

    const { $controller } = buildHarness(() => {
      /* no registrations needed — inline factory path */
    });
    const $scope = Scope.create();

    const instance = $controller(inline, { $scope }, 'vm');

    expect(($scope as unknown as Record<string, unknown>).vm).toBe(instance);
    expect((instance as { value: number }).value).toBe(42);
  });
});

describe('"as" syntax — explicit `ident` precedence over suffix', () => {
  it('explicit ident argument wins; the suffix alias is ignored', () => {
    // FS §2.3 + technical-considerations §2.5: when both the
    // 'Name as alias' suffix AND the third positional `ident` argument
    // resolve, the explicit `ident` argument wins. Mirrors AngularJS 1.x
    // exactly. The suffix alias must NOT also be bound.
    const ctor: ControllerInvokable = [
      function (this: { tag?: string }) {
        this.tag = 'instance';
      },
    ];

    const { $controller } = buildHarness((cp) => {
      cp.register('GreeterCtrl', ctor);
    });
    const $scope = Scope.create();

    const instance = $controller('GreeterCtrl as suffix', { $scope }, 'explicit');

    const bag = $scope as unknown as Record<string, unknown>;
    expect(bag.explicit).toBe(instance);
    expect(bag.suffix).toBeUndefined();
  });
});

describe('register(map) — object form', () => {
  it('registers every entry under its key; both are instantiable', () => {
    // Upstream parity: `'should allow registration of map of controllers'`.
    // The object form takes a `Record<string, ControllerInvokable>` and
    // registers each entry through the same validation path as the
    // string-form. Both entries should resolve and instantiate cleanly.
    const fooCtor: ControllerInvokable = [
      function (this: { tag?: string }) {
        this.tag = 'foo';
      },
    ];
    const barCtor: ControllerInvokable = [
      function (this: { tag?: string }) {
        this.tag = 'bar';
      },
    ];

    const { $controller } = buildHarness((cp) => {
      cp.register({ FooCtrl: fooCtor, BarCtrl: barCtor });
    });
    const $scope = Scope.create();

    const foo = $controller('FooCtrl', { $scope });
    const bar = $controller('BarCtrl', { $scope });

    expect((foo as { tag: string }).tag).toBe('foo');
    expect((bar as { tag: string }).tag).toBe('bar');
    expect(foo).not.toBe(bar);
  });
});

describe('locals-override — locals win on key collision with services', () => {
  it('passes the local value (not the registered service) to the controller', () => {
    // Upstream parity: the `inject(function($http) { ... })` test that
    // overrides a service via locals. We override `$exceptionHandler`
    // because it is already registered on `ngModule`; the controller asks
    // for it by name, the locals supply a substitute, and `injector.invoke`
    // honors the override (locals win on key collision with the framework
    // registry — matches AngularJS 1.x semantics).
    const customHandler = (): void => {
      /* substitute — captured by reference below */
    };
    let received: unknown;
    const ctor: ControllerInvokable = [
      '$exceptionHandler',
      function ($exceptionHandler: unknown) {
        received = $exceptionHandler;
      },
    ];

    const { $controller } = buildHarness((cp) => {
      cp.register('LocalsCtrl', ctor);
    });

    $controller('LocalsCtrl', { $exceptionHandler: customHandler });

    expect(received).toBe(customHandler);
  });
});

describe('controller returns object — return-value replacement', () => {
  it('the returned object replaces the prototype-instance', () => {
    // Upstream parity: the `'should return instance of given controller class'`
    // test plus the implicit return-value semantics from `$injector.instantiate`.
    // Constructors that explicitly return a non-null object REPLACE the
    // prototype-instance — matches the standard JS `new` operator. The
    // returned object is the controller; `instanceof <original ctor>` is
    // FALSE (the original prototype is detached).
    const sentinel = { explicit: true };
    function OriginalCtor(this: object): object {
      return sentinel;
    }
    const ctor: ControllerInvokable = [OriginalCtor];

    const { $controller } = buildHarness((cp) => {
      cp.register('ReturningCtrl', ctor);
    });

    const result = $controller('ReturningCtrl', {});

    expect(result).toBe(sentinel);
    expect(result instanceof OriginalCtor).toBe(false);
  });
});

describe('$controllerProvider.has — introspection', () => {
  it('returns true for registered names and false for unregistered names', () => {
    // Upstream parity: `'should allow checking the availability of a controller'`.
    // `has(name)` is reachable in both the config and run phases — but the
    // provider itself is only reachable INSIDE `config()` blocks (the
    // run-phase facade does not expose `$controllerProvider`; see the
    // `injector.has('$controllerProvider') === false` regression in
    // `controller-di.test.ts`). So we run the assertion from inside the
    // config block.
    let capturedHasA: boolean | undefined;
    let capturedHasMissing: boolean | undefined;

    const appModule = createModule('app', ['ng']).config([
      '$controllerProvider',
      (cp: $ControllerProvider) => {
        cp.register('A', [function () {}]);
        capturedHasA = cp.has('A');
        capturedHasMissing = cp.has('NotRegistered');
      },
    ]);
    createInjector([ngModule, appModule]);

    expect(capturedHasA).toBe(true);
    expect(capturedHasMissing).toBe(false);
  });
});

describe('EXCEPTION_HANDLER_CAUSES regression (no new cause token in Slice 5)', () => {
  it('EXCEPTION_HANDLER_CAUSES.length === 13 (no controller-spec token; grew to 13 in spec 037)', () => {
    // Spec 020 reuses the existing `'$compile'` cause token (added in
    // spec 017) for every controller-related error site at link time.
    // The tuple stays at 10 entries; lock that in here so a future
    // drive-by addition surfaces an obvious failure.
    expect(EXCEPTION_HANDLER_CAUSES.length).toBe(13);
  });
});

// ---------------------------------------------------------------------------
// Skipped — each it.skip carries a comment naming the deferring roadmap item
// so a future audit can grep `.skip(` to enumerate exactly what's deferred.
// ---------------------------------------------------------------------------

describe('deferred AngularJS 1.x features', () => {
  it.skip('allowGlobals — window.MyCtrl lookup', () => {
    /* PERMANENTLY OUT on security grounds (prototype-pollution vector +
     * code-splitting hazard). AngularJS 1.x optionally allowed
     * `$controller('Path.To.Ctor', ...)` to walk `window.Path.To.Ctor`
     * as a fallback when no registered name matched; this project will
     * NOT ship the opt-in. See `src/controller/README.md` —
     * "Intentionally-deferred items". */
  });

  it.skip("require: '^myDir' — inter-directive controller injection", () => {
    /* Deferred to the "Controllers — `require:` field" roadmap item.
     * The `$controller` signature today returns the bare instance; when
     * `require:` lands, the signature gets a 4th `later: boolean`
     * argument returning `{ instance, identifier }` — additive, no
     * breaking change. */
  });

  it.skip("bindToController: { foo: '=' } — isolate-scope-bound locals", () => {
    /* Depends on isolate scope, which is rejected at directive
     * registration today via `IsolateScopeNotSupportedError`. Deferred
     * to the future "Isolate scope" roadmap item. `bindToController`
     * lands as a co-shipped feature of that spec. */
  });

  it.skip('$onInit lifecycle hook fires after construction', () => {
    /* Deferred to the future "Component lifecycle hooks" roadmap item.
     * The per-element seam runs the constructor and discards the
     * return; `$onInit` / `$onChanges` / `$onDestroy` / `$postLink`
     * dispatch is layered on later — additive, no breaking change to
     * today's controller surface. */
  });
});
