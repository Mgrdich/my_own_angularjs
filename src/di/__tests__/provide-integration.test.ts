/**
 * Slice 7 (spec 015) — `$provide` / module-DSL last-wins integration.
 *
 * Slices 4-6 proved each `$provide.*` recipe and the phase guard in
 * isolation. This file exercises FS §2.9: the unified registration timeline
 * shared between the chain-time module DSL and the config-phase `$provide`
 * injectable. Both APIs end up at the same `applyRegistrationRecord` choke
 * point in `./registration.ts`, so registrations made via either API
 * compose into a single ordered timeline where later writes win.
 *
 * Cases below mirror FS §2.9 acceptance criteria: cross-API last-wins for
 * factory and value (a, c, e), intra-config-block last-wins (b), decorator
 * stacking across both APIs in registration order (d), and provider
 * configurability across config blocks of separate modules in the
 * dependency graph (f). No source files are modified.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createModule, resetRegistry } from '@di/module';
import { createInjector } from '@di/injector';
import type { ProvideService } from '@di/index';

describe('$provide / module DSL last-wins integration', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('(a) module-DSL .factory is overridden by a downstream $provide.factory in a config block', () => {
    const baseModule = createModule('base', []).factory('foo', [() => 'OLD']);
    void baseModule;
    const appModule = createModule('app', ['base']).config([
      '$provide',
      ($provide: ProvideService) => {
        $provide.factory('foo', [() => 'NEW']);
      },
    ]);

    const injector = createInjector([appModule]);
    expect(injector.get('foo')).toBe('NEW');
  });

  it('(b) two config blocks both calling $provide.factory("foo", ...) — the LATER block wins', () => {
    const appModule = createModule('app', [])
      .config([
        '$provide',
        ($provide: ProvideService) => {
          $provide.factory('foo', [() => 'first']);
        },
      ])
      .config([
        '$provide',
        ($provide: ProvideService) => {
          $provide.factory('foo', [() => 'second']);
        },
      ]);

    const injector = createInjector([appModule]);
    expect(injector.get('foo')).toBe('second');
  });

  it('(c) module.value("foo", "x") followed by downstream $provide.factory("foo", () => "y") — factory wins', () => {
    const baseModule = createModule('base', []).value('foo', 'x');
    void baseModule;
    const appModule = createModule('app', ['base']).config([
      '$provide',
      ($p: ProvideService) => {
        $p.factory('foo', [() => 'y']);
      },
    ]);

    const injector = createInjector([appModule]);
    expect(injector.get('foo')).toBe('y');
  });

  it('(d) decorator stacking across both APIs: module.decorator + $provide.decorator yields d2(d1(original))', () => {
    const appModule = createModule('app', [])
      .factory('foo', [() => 'X'])
      .decorator('foo', ['$delegate', ($d: unknown) => `${$d as string}-1`])
      .config([
        '$provide',
        ($p: ProvideService) => {
          $p.decorator('foo', ['$delegate', ($d: unknown) => `${$d as string}-2`]);
        },
      ]);

    const injector = createInjector([appModule]);
    expect(injector.get('foo')).toBe('X-1-2');
  });

  it('(e) downstream $provide.factory overrides upstream module.factory for "$exceptionHandler" — second wins', () => {
    // FS §2.9 spec-014 parity check: any service, including framework
    // hooks like `$exceptionHandler`, follows the same last-wins rule when
    // re-registered through `$provide` in a downstream config block.
    const firstSpy = vi.fn();
    const secondSpy = vi.fn();
    const baseModule = createModule('base', []).factory('$exceptionHandler', [() => firstSpy]);
    void baseModule;
    const appModule = createModule('app', ['base']).config([
      '$provide',
      ($p: ProvideService) => {
        $p.factory('$exceptionHandler', [() => secondSpy]);
      },
    ]);

    const injector = createInjector([appModule]);
    expect(injector.get('$exceptionHandler')).toBe(secondSpy);
  });

  it('(f) $provide.provider in module-A is mutable from a downstream module-B config block (FS §2.6 integration)', () => {
    class MyProvider {
      value = 'default';
      $get = [
        function (this: { value: string }): string {
          return this.value;
        },
      ] as const;
    }

    const moduleA = createModule('A', []).config([
      '$provide',
      ($p: ProvideService) => {
        $p.provider('my', MyProvider);
      },
    ]);
    void moduleA;
    const moduleB = createModule('B', ['A']).config([
      'myProvider',
      (p: { value: string }) => {
        p.value = 'mutated';
      },
    ]);

    const injector = createInjector([moduleB]);
    expect(injector.get('my')).toBe('mutated');
  });
});
