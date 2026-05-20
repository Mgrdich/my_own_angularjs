/**
 * `$compileProvider` DI integration tests (Slice 2 / FS §2.2).
 *
 * Exercises the full chain: `module.config(['$compileProvider', …])` →
 * provider's private `$$factoryMap` → `$provide.provider('<name>Directive', …)` →
 * run-phase `<name>Directive` lookup → `createCompile` chain. Covers the
 * Slice-2 acceptance criteria from FS §2.2 and §2.4.
 *
 * Factories are written in array-style annotation form (`[() => ({…})]`)
 * because `$injector.invoke` requires either a `$inject` property or
 * the array form. Bare arrow factories have no parameters to scrape,
 * so the array wrapper is the canonical no-dep registration.
 *
 * The `ng` module is registered at import time; a `resetRegistry()` in a
 * neighbouring test would evict it. Re-register a fresh `'ng'` here so any
 * `requires: ['ng']` lookup downstream still resolves. Matches the pattern
 * used in other DI integration test files.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import {
  InvalidDirectiveFactoryError,
  InvalidDirectiveNameError,
  IsolateScopeNotSupportedError,
} from '@compiler/compile-error';
import type { Directive, DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import { createInjector } from '@di/injector';
import { createModule } from '@di/module';

import { bootstrapNgModule } from './test-helpers';

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

describe('$compileProvider — config-phase registration (FS §2.2)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  describe('directive: string form happy path', () => {
    it('registers a directive resolvable as <name>Directive', () => {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive(
            'myDir',
            ddoFactory({
              link: () => {
                /* noop */
              },
            }),
          );
        },
      ]);

      const injector = createInjector([appModule]);
      const directives = injector.get<Directive[]>('myDirDirective');

      expect(Array.isArray(directives)).toBe(true);
      expect(directives).toHaveLength(1);
      expect(directives[0]?.name).toBe('myDir');
      expect(directives[0]?.restrict).toBe('EA');
      expect(directives[0]?.priority).toBe(0);
      expect(directives[0]?.terminal).toBe(false);
      expect(typeof directives[0]?.index).toBe('number');
    });

    it('honors explicit restrict / priority / terminal on the DDO', () => {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive(
            'myDir',
            ddoFactory({
              restrict: 'A',
              priority: 50,
              terminal: true,
              link: () => {
                /* noop */
              },
            }),
          );
        },
      ]);

      const injector = createInjector([appModule]);
      const [directive] = injector.get<Directive[]>('myDirDirective');

      expect(directive?.restrict).toBe('A');
      expect(directive?.priority).toBe(50);
      expect(directive?.terminal).toBe(true);
    });
  });

  describe('chaining', () => {
    it('directive(string, factory) returns the provider', () => {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          const a = $cp.directive('a', ddoFactory({}));
          const b = a.directive('b', ddoFactory({}));
          expect(a).toBe($cp);
          expect(b).toBe($cp);
        },
      ]);

      createInjector([appModule]);
    });

    it('directive(map) returns the provider', () => {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          const ret = $cp.directive({
            a: ddoFactory({}),
            b: ddoFactory({}),
          });
          expect(ret).toBe($cp);
        },
      ]);

      createInjector([appModule]);
    });
  });

  describe('directive: object form', () => {
    it('registers each entry as a separate directive', () => {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive({
            foo: ddoFactory({ priority: 1 }),
            bar: ddoFactory({ priority: 2 }),
          });
        },
      ]);

      const injector = createInjector([appModule]);
      const fooDirectives = injector.get<Directive[]>('fooDirective');
      const barDirectives = injector.get<Directive[]>('barDirective');

      expect(fooDirectives).toHaveLength(1);
      expect(fooDirectives[0]?.priority).toBe(1);
      expect(barDirectives).toHaveLength(1);
      expect(barDirectives[0]?.priority).toBe(2);
    });

    it('empty object map is a silent no-op', () => {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          expect(() => $cp.directive({})).not.toThrow();
        },
      ]);

      createInjector([appModule]);
    });
  });

  describe('InvalidDirectiveNameError', () => {
    function expectInvalidName(name: string): void {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          expect(() => $cp.directive(name, ddoFactory({}))).toThrow(InvalidDirectiveNameError);
        },
      ]);
      createInjector([appModule]);
    }

    it('rejects an empty string name', () => {
      expectInvalidName('');
    });

    it('rejects a name with whitespace', () => {
      expectInvalidName('my dir');
    });

    it('rejects a name starting with a digit', () => {
      expectInvalidName('1myDir');
    });

    it('rejects a name with hyphens', () => {
      expectInvalidName('my-dir');
    });
  });

  describe('InvalidDirectiveFactoryError', () => {
    function expectInvalidFactory(factory: unknown): void {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          expect(() => $cp.directive('myDir', factory as DirectiveFactory)).toThrow(InvalidDirectiveFactoryError);
        },
      ]);
      createInjector([appModule]);
    }

    it('rejects null factory', () => {
      expectInvalidFactory(null);
    });

    it('rejects undefined factory', () => {
      expectInvalidFactory(undefined);
    });

    it('rejects empty array', () => {
      expectInvalidFactory([]);
    });

    it('rejects non-function / non-array factory', () => {
      expectInvalidFactory(42);
    });
  });

  describe('isolate scope acceptance (spec 022 Slice 1)', () => {
    it('accepts scope: { … } at $get / lookup time — the directive resolves with isolateBindings populated', () => {
      // Spec 022 Slice 1 LIFTED the spec-017 `IsolateScopeNotSupportedError`
      // throw site. `scope: { foo: '=' }` is now a valid declaration; the
      // factory resolves cleanly, no exception-handler routing fires, and
      // the normalized directive carries the parsed `isolateBindings`.
      const handlerSpy = vi.fn<(...args: unknown[]) => void>();
      const appModule = createModule('app', ['ng'])
        .factory('$exceptionHandler', [() => handlerSpy])
        .config([
          '$compileProvider',
          ($cp: $CompileProvider) => {
            $cp.directive('myDir', ddoFactory({ scope: { foo: '=' } }));
          },
        ]);

      const injector = createInjector([appModule]);
      const result = injector.get<Directive[]>('myDirDirective');
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0]?.isolateBindings).toEqual({
        foo: { mode: '=', optional: false, attrName: 'foo' },
      });
      // No exception-handler routing — the directive is valid.
      expect(handlerSpy).not.toHaveBeenCalled();
    });

    it('keeps the deprecated IsolateScopeNotSupportedError class exported and constructable', () => {
      // Backwards-compatibility: existing consumers catching the class
      // via `instanceof` must keep compiling. Spec 022 Slice 1 retires
      // the throw site but keeps the class exported for one release.
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- Deliberate use of the deprecated class to pin its public-API surface for the grace-period release.
      const err = new IsolateScopeNotSupportedError('myDir');
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('IsolateScopeNotSupportedError');
    });
  });

  describe('phase guard', () => {
    it('captured $compileProvider reference cannot register a NEW directive after run phase begins', () => {
      let captured: $CompileProvider | undefined;
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          captured = $cp;
        },
      ]);

      createInjector([appModule]);

      // After run phase, the captured reference is unusable for NEW names —
      // the underlying `$provide.provider` call surfaces the spec-015 phase
      // guard.
      expect(() => captured?.directive('lateDir', ddoFactory({}))).toThrow(
        /\$provide\.provider is only callable during the config phase/,
      );
    });

    it('appending another factory under an EXISTING name only mutates $$factoryMap (no $provide call) — silent post-run-phase mutation', () => {
      // Documented Slice-2 deviation from FS §2.2: subsequent factory
      // registrations for the SAME name don't go through `$provide`, so the
      // phase guard never fires. The mutation is silently allowed; the
      // injector caches the `<name>Directive` lookup so the late append
      // doesn't surface to consumers either. Test that the call doesn't
      // throw — locking the current behavior.
      let captured: $CompileProvider | undefined;
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive('existingDir', ddoFactory({}));
          captured = $cp;
        },
      ]);

      createInjector([appModule]);

      expect(() => captured?.directive('existingDir', ddoFactory({}))).not.toThrow();
    });
  });

  describe('multiple-factories-per-name accumulation (FS §2.3)', () => {
    it('two factories under the same name produce two directive objects', () => {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive('myDir', ddoFactory({ priority: 10 }));
          $cp.directive('myDir', ddoFactory({ priority: 20 }));
        },
      ]);

      const injector = createInjector([appModule]);
      const directives = injector.get<Directive[]>('myDirDirective');

      expect(directives).toHaveLength(2);
      const priorities = directives.map((d) => d.priority).sort((a, b) => a - b);
      expect(priorities).toEqual([10, 20]);
    });
  });
});
