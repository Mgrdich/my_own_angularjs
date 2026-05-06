/**
 * E2E tests for the `$provide` config-phase injectable (spec 015).
 *
 * Slice 4 landed the smoke `factory` test below. Slice 5 extends this file
 * with one sub-suite per remaining recipe (`service`, `value`, `constant`,
 * `provider`, `decorator`) covering the FS §§2.3–2.7 acceptance criteria
 * end-to-end: register through `$provide` inside a config block, build the
 * injector, then assert via `injector.get(...)` (and, where the criterion
 * is about config-phase mutation visibility, via a follow-up config block).
 *
 * Slice 6 adds the FS §2.8 phase-guard / captured-reference / out-of-phase
 * rejection coverage and a regression test for FS §2.1 cross-module
 * `$provide` injectability (`$provide` is registered by `createInjector`,
 * not by `ngModule`, so it is resolvable from any module).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createModule, resetRegistry } from '@di/module';
import { createInjector } from '@di/injector';
import type { ProvideService } from '@di/index';

describe('$provide injectable (smoke E2E)', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('config(["$provide", $p => $p.factory(...)]) registers a service that resolves at run-phase', () => {
    const appModule = createModule('app', []).config([
      '$provide',
      ($provide: ProvideService) => {
        $provide.factory('greeting', [() => 'hello']);
      },
    ]);

    const injector = createInjector([appModule]);

    expect(injector.get('greeting')).toBe('hello');
  });

  describe('$provide.service (FS §2.3)', () => {
    beforeEach(() => {
      resetRegistry();
    });

    it('registers a bare-constructor service resolvable at run-phase', () => {
      class Greeter {
        static readonly $inject = [] as const;
        greet(): string {
          return 'hi';
        }
      }
      const appModule = createModule('app', []).config([
        '$provide',
        ($provide: ProvideService) => {
          $provide.service('greeter', Greeter);
        },
      ]);

      const injector = createInjector([appModule]);
      const g = injector.get<Greeter>('greeter');
      expect(g).toBeInstanceOf(Greeter);
      expect(g.greet()).toBe('hi');
    });

    it('resolves $inject-annotated constructor deps from the registry', () => {
      class Counter {
        constructor(public start: number) {}
      }
      (Counter as { $inject?: readonly string[] }).$inject = ['start'];

      const appModule = createModule('app', [])
        .value('start', 7)
        .config([
          '$provide',
          ($p: ProvideService) => {
            $p.service('counter', Counter);
          },
        ]);

      const injector = createInjector([appModule]);
      const c = injector.get<Counter>('counter');
      expect(c.start).toBe(7);
    });

    it('resolves array-style annotation deps from the registry', () => {
      class Counter {
        constructor(public start: number) {}
      }

      const appModule = createModule('app', [])
        .value('start', 11)
        .config([
          '$provide',
          ($p: ProvideService) => {
            // Cast through `unknown` because the typed array-style overload
            // expects the constructor's arg types to widen to `unknown`,
            // while `Counter` declares `start: number`. The runtime contract
            // (resolved deps are passed positionally) is satisfied.
            $p.service('counter', ['start', Counter] as unknown as readonly ['start', new (start: unknown) => unknown]);
          },
        ]);

      const injector = createInjector([appModule]);
      const c = injector.get<Counter>('counter');
      expect(c.start).toBe(11);
    });

    it('caches the service as a singleton across get() calls', () => {
      class Greeter {
        static readonly $inject = [] as const;
        greet(): string {
          return 'hi';
        }
      }
      const appModule = createModule('app', []).config([
        '$provide',
        ($p: ProvideService) => {
          $p.service('greeter', Greeter);
        },
      ]);

      const injector = createInjector([appModule]);
      expect(injector.get('greeter')).toBe(injector.get('greeter'));
    });

    it('a config-phase $provide.service registration replaces a prior chain-time .service registration', () => {
      class OldGreeter {
        static readonly $inject = [] as const;
        which(): string {
          return 'old';
        }
      }
      class NewGreeter {
        static readonly $inject = [] as const;
        which(): string {
          return 'new';
        }
      }
      const appModule = createModule('app', [])
        .service('greeter', OldGreeter)
        .config([
          '$provide',
          ($p: ProvideService) => {
            $p.service('greeter', NewGreeter);
          },
        ]);

      const injector = createInjector([appModule]);
      const g = injector.get('greeter') as NewGreeter;
      expect(g).toBeInstanceOf(NewGreeter);
      expect(g.which()).toBe('new');
    });
  });

  describe('$provide.value (FS §2.4)', () => {
    beforeEach(() => {
      resetRegistry();
    });

    it('registers a primitive value resolvable at run-phase', () => {
      const appModule = createModule('app', []).config([
        '$provide',
        ($p: ProvideService) => {
          $p.value('apiUrl', '/api/v2');
        },
      ]);

      const injector = createInjector([appModule]);
      expect(injector.get('apiUrl')).toBe('/api/v2');
    });

    it('preserves reference identity for object values (no clone)', () => {
      const cfg = { timeout: 5000 };
      const appModule = createModule('app', []).config([
        '$provide',
        ($p: ProvideService) => {
          $p.value('config', cfg);
        },
      ]);

      const injector = createInjector([appModule]);
      expect(injector.get('config')).toBe(cfg);
    });

    it('exposes post-registration mutations to consumers (values are not deep-copied)', () => {
      const cfg = { timeout: 5000 };
      const appModule = createModule('app', []).config([
        '$provide',
        ($p: ProvideService) => {
          $p.value('config', cfg);
        },
      ]);

      const injector = createInjector([appModule]);
      cfg.timeout = 9999;
      expect(injector.get<typeof cfg>('config').timeout).toBe(9999);
    });

    it('a later $provide.value overrides a prior $provide.value (last-wins)', () => {
      const appModule = createModule('app', [])
        .config([
          '$provide',
          ($p: ProvideService) => {
            $p.value('apiUrl', '/api/v2');
          },
        ])
        .config([
          '$provide',
          ($p: ProvideService) => {
            $p.value('apiUrl', '/api/v3');
          },
        ]);

      const injector = createInjector([appModule]);
      expect(injector.get('apiUrl')).toBe('/api/v3');
    });
  });

  describe('$provide.constant (FS §2.5)', () => {
    beforeEach(() => {
      resetRegistry();
    });

    it('registers a primitive constant resolvable at run-phase', () => {
      const appModule = createModule('app', []).config([
        '$provide',
        ($p: ProvideService) => {
          $p.constant('SECRET', 'abc');
        },
      ]);

      const injector = createInjector([appModule]);
      expect(injector.get('SECRET')).toBe('abc');
    });

    it('is resolvable across config blocks of downstream modules', () => {
      const seenInB: string[] = [];
      createModule('A', []).config([
        '$provide',
        ($p: ProvideService) => {
          $p.constant('SECRET', 'abc');
        },
      ]);
      const moduleB = createModule('B', ['A']).config([
        'SECRET',
        (s: unknown) => {
          seenInB.push(s as string);
        },
      ]);

      createInjector([moduleB]);
      expect(seenInB).toEqual(['abc']);
    });

    it('throws when a later $provide.value tries to override a constant', () => {
      const appModule = createModule('app', []).config([
        '$provide',
        ($p: ProvideService) => {
          $p.constant('X', 'a');
          $p.value('X', 'b');
        },
      ]);
      expect(() => createInjector([appModule])).toThrow(/Cannot override constant "X"/);
    });

    it('throws when a later $provide.factory tries to override a constant', () => {
      const appModule = createModule('app', []).config([
        '$provide',
        ($p: ProvideService) => {
          $p.constant('X', 'a');
          $p.factory('X', [() => 'b']);
        },
      ]);
      expect(() => createInjector([appModule])).toThrow(/Cannot override constant "X"/);
    });

    it('throws when a later $provide.service tries to override a constant', () => {
      class Svc {
        static readonly $inject = [] as const;
        readonly kind = 'svc' as const;
      }
      const appModule = createModule('app', []).config([
        '$provide',
        ($p: ProvideService) => {
          $p.constant('X', 'a');
          $p.service('X', Svc);
        },
      ]);
      expect(() => createInjector([appModule])).toThrow(/Cannot override constant "X"/);
    });

    it('throws when a later $provide.provider tries to override a constant', () => {
      class XProvider {
        $get = [(): string => 'b'] as const;
      }
      const appModule = createModule('app', []).config([
        '$provide',
        ($p: ProvideService) => {
          $p.constant('X', 'a');
          $p.provider('X', XProvider);
        },
      ]);
      expect(() => createInjector([appModule])).toThrow(/Cannot override constant "X"/);
    });

    it('a later $provide.constant replaces an earlier one (last-wins, no throw)', () => {
      const appModule = createModule('app', []).config([
        '$provide',
        ($p: ProvideService) => {
          $p.constant('X', 'a');
          $p.constant('X', 'b');
        },
      ]);

      const injector = createInjector([appModule]);
      expect(injector.get('X')).toBe('b');
    });
  });

  describe('$provide.provider (FS §2.6)', () => {
    beforeEach(() => {
      resetRegistry();
    });

    it('registers a constructor-form provider whose $get drives the run-phase service', () => {
      class MyProvider {
        value = 'x';
        // Array-style `$get` so `annotate` can read the (empty) dep list.
        // `this` inside the trailing function is bound to the provider
        // instance by `getFn.apply(providerInstance, ...)` in the injector.
        $get = [
          function (this: { value: string }): string {
            return this.value;
          },
        ] as const;
      }
      const appModule = createModule('app', []).config([
        '$provide',
        ($p: ProvideService) => {
          $p.provider('my', MyProvider);
        },
      ]);

      const injector = createInjector([appModule]);
      expect(injector.get('my')).toBe('x');
    });

    it('registers an object-literal provider', () => {
      const appModule = createModule('app', []).config([
        '$provide',
        ($p: ProvideService) => {
          $p.provider('my', { $get: [() => 'value'] as const });
        },
      ]);

      const injector = createInjector([appModule]);
      expect(injector.get('my')).toBe('value');
    });

    it('registers an array-annotation provider with config-phase deps', () => {
      class MyProvider {
        constructor(public defaultGreeting: string) {}
        $get = [
          function (this: { defaultGreeting: string }): string {
            return `${this.defaultGreeting}, world`;
          },
        ] as const;
      }
      const appModule = createModule('app', [])
        .constant('defaultGreeting', 'Hello')
        .config([
          '$provide',
          ($p: ProvideService) => {
            $p.provider('my', ['defaultGreeting', MyProvider]);
          },
        ]);

      const injector = createInjector([appModule]);
      expect(injector.get('my')).toBe('Hello, world');
    });

    it('a subsequent config block can mutate the provider; the run-phase service reflects the mutation', () => {
      class MyProvider {
        value = 'default';
        $get = [
          function (this: { value: string }): string {
            return this.value;
          },
        ] as const;
      }
      const appModule = createModule('app', [])
        .config([
          '$provide',
          ($p: ProvideService) => {
            $p.provider('my', MyProvider);
          },
        ])
        .config([
          'myProvider',
          (p: { value: string }) => {
            p.value = 'configured';
          },
        ]);

      const injector = createInjector([appModule]);
      expect(injector.get('my')).toBe('configured');
    });

    it('a later $provide.provider replaces the prior provider wholesale (discards prior mutations)', () => {
      class OldProvider {
        value = 'a';
        $get = [
          function (this: { value: string }): string {
            return this.value;
          },
        ] as const;
      }
      class NewProvider {
        value = 'z';
        $get = [
          function (this: { value: string }): string {
            return this.value;
          },
        ] as const;
      }
      const appModule = createModule('app', [])
        .config([
          '$provide',
          ($p: ProvideService) => {
            $p.provider('my', OldProvider);
          },
        ])
        .config([
          'myProvider',
          (p: { value: string }) => {
            p.value = 'configured-old';
          },
        ])
        .config([
          '$provide',
          ($p: ProvideService) => {
            $p.provider('my', NewProvider);
          },
        ]);

      const injector = createInjector([appModule]);
      // NewProvider's default wins; the earlier mutation of the OldProvider
      // instance is gone because the underlying provider was replaced.
      expect(injector.get('my')).toBe('z');
    });
  });

  describe('$provide.decorator (FS §2.7)', () => {
    beforeEach(() => {
      resetRegistry();
    });

    it('wraps an existing service via the $delegate dep', () => {
      const appModule = createModule('app', [])
        .factory('greeting', [() => 'hello'])
        .config([
          '$provide',
          ($p: ProvideService) => {
            $p.decorator('greeting', ['$delegate', ($d: unknown) => `${$d as string}!`]);
          },
        ]);

      const injector = createInjector([appModule]);
      expect(injector.get('greeting')).toBe('hello!');
    });

    it('resolves additional deps beyond $delegate from the run-phase registry', () => {
      const appModule = createModule('app', [])
        .factory('greeting', [() => 'hello'])
        .value('punctuation', '!?')
        .config([
          '$provide',
          ($p: ProvideService) => {
            $p.decorator('greeting', [
              '$delegate',
              'punctuation',
              ($d: unknown, p: unknown) => `${$d as string}${p as string}`,
            ]);
          },
        ]);

      const injector = createInjector([appModule]);
      expect(injector.get('greeting')).toBe('hello!?');
    });

    it('stacks multiple decorators in registration order — d2(d1(original))', () => {
      const appModule = createModule('app', [])
        .factory('greeting', [() => 'hi'])
        .config([
          '$provide',
          ($p: ProvideService) => {
            $p.decorator('greeting', ['$delegate', ($d: unknown) => `${$d as string}-A`]);
            $p.decorator('greeting', ['$delegate', ($d: unknown) => `${$d as string}-B`]);
          },
        ]);

      const injector = createInjector([appModule]);
      expect(injector.get('greeting')).toBe('hi-A-B');
    });

    it('a downstream module decorates a service registered via $provide.factory in an upstream module', () => {
      createModule('A', []).config([
        '$provide',
        ($p: ProvideService) => {
          $p.factory('foo', [() => 'foo-base']);
        },
      ]);
      const moduleB = createModule('B', ['A']).config([
        '$provide',
        ($p: ProvideService) => {
          $p.decorator('foo', ['$delegate', ($d: unknown) => `${$d as string}+B`]);
        },
      ]);

      const injector = createInjector([moduleB]);
      expect(injector.get('foo')).toBe('foo-base+B');
    });

    it('decorating an unknown service does NOT register a placeholder; injector.get throws Unknown provider', () => {
      // FS §2.7: a decorator on a non-existent service must not silently create
      // a stub. Decorator validation in `loadModule` runs BEFORE config blocks,
      // so a `$provide.decorator` registered inside a config block escapes the
      // build-time guard — but `injector.get('nonexistent')` then surfaces the
      // canonical "Unknown provider" error at resolution time. Either failure
      // mode satisfies the spec; we assert the actual behavior here.
      const appModule = createModule('app', []).config([
        '$provide',
        ($p: ProvideService) => {
          $p.decorator('nonexistent', ['$delegate', ($d: unknown) => $d]);
        },
      ]);
      const injector = createInjector([appModule]);
      expect(() => injector.get('nonexistent')).toThrow(/Unknown provider: nonexistent/);
    });
  });

  describe('phase guard / out-of-phase rejection (FS §2.8)', () => {
    beforeEach(() => {
      resetRegistry();
    });

    it('run blocks cannot inject $provide — bootstrap surfaces Unknown provider', () => {
      // Run blocks fire after `phase` flips to `'run'` and after `$provide`
      // is removed from `providerCache`. A run block declaring `'$provide'`
      // as a dep must therefore fail with the canonical injector error
      // rather than silently receiving a now-disabled service object.
      const appModule = createModule('app', []).run([
        '$provide',
        () => {
          // unreachable — `runInjector.invoke` throws while resolving '$provide'
        },
      ]);
      expect(() => createInjector([appModule])).toThrow(/Unknown provider: \$provide/);
    });

    it('post-bootstrap injector.get("$provide") throws Unknown provider', () => {
      const injector = createInjector([createModule('app', [])]);
      expect(() => injector.get('$provide')).toThrow(/Unknown provider: \$provide/);
    });

    it('post-bootstrap injector.has("$provide") is false', () => {
      const injector = createInjector([createModule('app', [])]);
      expect(injector.has('$provide')).toBe(false);
    });

    it('factory deps on $provide fail at run-phase resolution', () => {
      // Factory deps resolve at run-phase via `injector.get` -> dep walk.
      // By the time the factory is first requested, `$provide` is gone from
      // `providerCache`, so the dep lookup hits the "Unknown provider" branch.
      const appModule = createModule('app', []).factory('foo', ['$provide', ($p: ProvideService) => $p]);
      const injector = createInjector([appModule]);
      expect(() => injector.get('foo')).toThrow(/Unknown provider: \$provide/);
    });

    it.each(['provider', 'factory', 'service', 'value', 'constant', 'decorator'] as const)(
      'captured $provide.%s reference throws after the run phase begins',
      (method) => {
        // FS §2.8 captured-reference rule: a `$provide` reference saved
        // inside a config block and called AFTER `createInjector` returns
        // must still trip the config-phase guard, because `createProvideService`
        // reads `getPhase()` on every method call rather than snapshotting
        // it. The exact-string assert pins the message wording as part of
        // the public contract.
        let saved: ProvideService | undefined;
        const appModule = createModule('app', []).config([
          '$provide',
          ($p: ProvideService) => {
            saved = $p;
          },
        ]);
        createInjector([appModule]);
        expect(saved).toBeDefined();

        const proxy = saved as ProvideService;
        const expectedMessage = `$provide.${method} is only callable during the config phase; calling it after the run phase begins is not supported`;

        expect(() => {
          // Pick the simplest call shape per method to avoid exercising the
          // recipe machinery — the guard fires synchronously at the top of
          // each method, before any registration validation runs.
          switch (method) {
            case 'provider':
              proxy.provider('x', { $get: [() => 'v'] as const });
              break;
            case 'factory':
              proxy.factory('x', [() => 'v']);
              break;
            case 'service':
              proxy.service(
                'x',
                class {
                  readonly tag = 'unreachable' as const;
                },
              );
              break;
            case 'value':
              proxy.value('x', 0);
              break;
            case 'constant':
              proxy.constant('x', 0);
              break;
            case 'decorator':
              proxy.decorator('x', ['$delegate', ($d: unknown) => $d]);
              break;
          }
        }).toThrow(expectedMessage);
      },
    );

    it('out-of-phase $provide use is NOT routed through $exceptionHandler — it surfaces synchronously', () => {
      // FS §2.8 final bullet: out-of-phase use is treated as a programming
      // error, not a runtime exception. Even with a custom `$exceptionHandler`
      // wired up, a captured-`$provide` call after bootstrap must throw
      // synchronously to the call site AND the handler must NOT be invoked.
      const spyHandler = vi.fn<(exception: unknown, cause?: string) => void>();
      let saved: ProvideService | undefined;
      const appModule = createModule('app', [])
        .factory('$exceptionHandler', [() => spyHandler])
        .config([
          '$provide',
          ($p: ProvideService) => {
            saved = $p;
          },
        ]);

      const injector = createInjector([appModule]);
      // Force `$exceptionHandler` to instantiate so the spy is wired up;
      // a never-resolved factory would never be visible to a runtime error
      // path either, so this mirrors how a real app would consume it.
      expect(injector.get('$exceptionHandler')).toBe(spyHandler);
      expect(saved).toBeDefined();

      const proxy = saved as ProvideService;
      expect(() => {
        proxy.factory('late', [() => 'v']);
      }).toThrow(
        '$provide.factory is only callable during the config phase; calling it after the run phase begins is not supported',
      );
      expect(spyHandler).not.toHaveBeenCalled();
    });
  });

  describe('$provide is resolvable across modules (FS §2.1)', () => {
    beforeEach(() => {
      resetRegistry();
    });

    it("'$provide' is resolvable in config blocks of a module that does NOT depend on 'ng'", () => {
      // Regression guard for FS §2.1: `$provide` is self-registered by
      // `createInjector` into `providerCache` BEFORE Phase 2, so it is
      // available to every module in the graph regardless of whether the
      // module declares `'ng'` (or anything else) in its `requires` list.
      const seen: ProvideService[] = [];
      const appModule = createModule('app', []).config([
        '$provide',
        ($p: ProvideService) => {
          seen.push($p);
        },
      ]);
      createInjector([appModule]);
      expect(seen).toHaveLength(1);
      expect(typeof seen[0]?.factory).toBe('function');
    });

    it("'$provide' is the same instance across config blocks of transitively-related modules", () => {
      // Transitive-dep variant: module A and module B both inject `$provide`
      // in their config blocks; module B requires module A. Both blocks see
      // a working `$provide`, and (because the injector keeps a single
      // `$provide` instance for its lifetime) they see THE SAME object —
      // proving `$provide` is per-injector, not per-module.
      const seen: ProvideService[] = [];
      createModule('A', []).config([
        '$provide',
        ($p: ProvideService) => {
          seen.push($p);
        },
      ]);
      const moduleB = createModule('B', ['A']).config([
        '$provide',
        ($p: ProvideService) => {
          seen.push($p);
        },
      ]);
      createInjector([moduleB]);

      expect(seen).toHaveLength(2);
      expect(typeof seen[0]?.factory).toBe('function');
      expect(typeof seen[1]?.factory).toBe('function');
      expect(seen[0]).toBe(seen[1]);
    });
  });
});
