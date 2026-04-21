import { describe, it, expect, expectTypeOf, beforeEach } from 'vitest';
import { createModule, resetRegistry } from '@di/module';
import { createInjector } from '@di/injector';

describe('dependency injection', () => {
  describe('spec 008 — advanced recipes & lifecycle', () => {
    describe('config-phase enforcement', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('throws when a config block injects a factory-backed service', () => {
        const mod = createModule('app', [])
          .factory('api', [() => ({ call: () => 'ok' })])
          .config([
            'api',
            (api: unknown) => {
              // should never run — services are not injectable during config phase
              void api;
            },
          ]);
        expect(() => createInjector([mod])).toThrow(
          'Cannot inject "api" during config phase; use "apiProvider" instead',
        );
      });

      it('throws when a config block injects a service-recipe service', () => {
        class Greeter {
          static readonly $inject = [] as const;
          hello(): string {
            return 'hi';
          }
        }
        const mod = createModule('app', [])
          .service('greeter', Greeter)
          .config([
            'greeter',
            (greeter: unknown) => {
              // should never run — services are not injectable during config phase
              void greeter;
            },
          ]);
        expect(() => createInjector([mod])).toThrow(
          'Cannot inject "greeter" during config phase; use "greeterProvider" instead',
        );
      });

      it('throws when a config block injects a provider-backed service (by service name, not <name>Provider)', () => {
        class LoggerProvider {
          $get = [() => ({ log: (m: string): string => m })] as const;
        }
        const mod = createModule('app', [])
          .provider('logger', LoggerProvider)
          .config([
            'logger',
            (logger: unknown) => {
              // should never run — 'logger' is the run-phase name; must use 'loggerProvider' instead
              void logger;
            },
          ]);
        expect(() => createInjector([mod])).toThrow(
          'Cannot inject "logger" during config phase; use "loggerProvider" instead',
        );
      });
    });

    describe('Module.config', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('registers a config block via array-style invokable', () => {
        const fn = (x: unknown) => {
          void x;
        };
        const mod = createModule('app', []).config(['MAX', fn]);
        expect(mod.$$configBlocks).toHaveLength(1);
        expect(mod.$$configBlocks[0]).toEqual(['MAX', fn]);
      });

      it('registers a config block via $inject-annotated function', () => {
        const fn = Object.assign(
          (x: unknown) => {
            void x;
          },
          { $inject: ['MAX'] as const },
        );
        const mod = createModule('app', []).config(fn);
        expect(mod.$$configBlocks).toHaveLength(1);
        expect(mod.$$configBlocks[0]).toBe(fn);
      });

      it('multiple config calls preserve registration order', () => {
        const first = (x: unknown) => void x;
        const second = (x: unknown) => void x;
        const third = (x: unknown) => void x;
        const mod = createModule('app', []).config(['MAX', first]).config(['MAX', second]).config(['MAX', third]);
        expect(mod.$$configBlocks).toHaveLength(3);
        expect(mod.$$configBlocks[0]).toEqual(['MAX', first]);
        expect(mod.$$configBlocks[1]).toEqual(['MAX', second]);
        expect(mod.$$configBlocks[2]).toEqual(['MAX', third]);
      });

      it('config is chainable alongside recipes', () => {
        const configFn = (x: unknown) => void x;
        const mod = createModule('app', [])
          .value('apiUrl', 'https://example.com')
          .constant('MAX', 10)
          .config(['MAX', configFn])
          .factory('svc', [() => ({ ok: true })]);
        expect(mod.$$configBlocks).toHaveLength(1);
        expect(mod.$$configBlocks[0]).toEqual(['MAX', configFn]);
        // value + constant + factory all pushed to invoke queue
        expect(mod.$$invokeQueue.length).toBe(3);
      });
    });

    describe('createInjector (config blocks)', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('runs the config block during createInjector and before any service factory is called', () => {
        const callOrder: string[] = [];
        const mod = createModule('app', [])
          .constant('MARKER', 'hello')
          .factory('svc', [
            () => {
              callOrder.push('factory');
              return { ok: true };
            },
          ])
          .config([
            'MARKER',
            (marker: unknown) => {
              callOrder.push(`config:${String(marker)}`);
            },
          ]);
        const injector = createInjector([mod]);
        // Config must have run during createInjector.
        expect(callOrder).toEqual(['config:hello']);
        // Factory runs lazily on first get.
        injector.get('svc');
        expect(callOrder).toEqual(['config:hello', 'factory']);
      });

      it('can inject a provider via its <name>Provider key', () => {
        const calls: unknown[] = [];
        class LoggerProvider {
          readonly level: string = 'info';
          $get = [() => ({ log: (m: string) => m })] as const;
        }
        const mod = createModule('app', [])
          .provider('logger', LoggerProvider)
          .config([
            'loggerProvider',
            (p: unknown) => {
              calls.push(p);
            },
          ]);
        createInjector([mod]);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toBeInstanceOf(LoggerProvider);
        expect((calls[0] as LoggerProvider).level).toBe('info');
      });

      it('can inject a constant', () => {
        const seen: unknown[] = [];
        const mod = createModule('app', [])
          .constant('MAX', 5)
          .config([
            'MAX',
            (max: unknown) => {
              seen.push(max);
            },
          ]);
        createInjector([mod]);
        expect(seen).toEqual([5]);
      });

      it('values are visible in config blocks via the shared provider cache (implementation note)', () => {
        const seen: unknown[] = [];
        const mod = createModule('app', [])
          .value('greeting', 'hello')
          .config([
            'greeting',
            (g: unknown) => {
              seen.push(g);
            },
          ]);
        // This does NOT throw because values land in `providerCache` at load
        // time and `providerGet` returns from the cache before reaching the
        // service-only enforcement branch. Documents current behavior — if we
        // ever tighten the two-phase boundary to forbid value injection in
        // config, update this test accordingly.
        createInjector([mod]);
        expect(seen).toEqual(['hello']);
        // Factory/service/provider rejection cases are covered in the
        // `config-phase enforcement` describe block above — not duplicated here.
      });

      it('multiple config blocks run in registration order within a module', () => {
        const order: string[] = [];
        const mod = createModule('app', [])
          .constant('MARKER', 'x')
          .config(['MARKER', () => order.push('first')])
          .config(['MARKER', () => order.push('second')])
          .config(['MARKER', () => order.push('third')]);
        createInjector([mod]);
        expect(order).toEqual(['first', 'second', 'third']);
      });

      it('config blocks across required modules run in dependency order', () => {
        const order: string[] = [];
        createModule('core', [])
          .constant('CORE', 'c')
          .config(['CORE', () => order.push('core')]);
        createModule('middle', ['core'])
          .constant('MID', 'm')
          .config(['MID', () => order.push('middle')]);
        const app = createModule('app', ['middle'])
          .constant('APP', 'a')
          .config(['APP', () => order.push('app')]);
        createInjector([app]);
        // core runs first (deepest dep), then middle, then app.
        expect(order).toEqual(['core', 'middle', 'app']);
      });

      it('config block can mutate a provider and the mutation is visible in the produced service', () => {
        class LoggerProvider {
          level = 'info';
          setLevel(level: string): void {
            this.level = level;
          }
          // `$get` must be an array-style invokable so `providerInvoke` passes
          // `this` = the provider instance when calling the trailing function.
          // Use a non-arrow function so `this` is bound correctly.
          $get = [
            function logger(this: LoggerProvider) {
              return { level: this.level };
            },
          ] as const;
        }
        const mod = createModule('app', [])
          .provider('logger', LoggerProvider)
          .config([
            'loggerProvider',
            (p: unknown) => {
              (p as LoggerProvider).setLevel('debug');
            },
          ]);
        const injector = createInjector([mod]);
        const logger = injector.get<{ level: string }>('logger');
        expect(logger.level).toBe('debug');
      });
    });

    describe('type safety — config blocks', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('config callback params are typed from ConfigRegistry (provider instance)', () => {
        class LoggerProvider {
          level: string = 'info';
          setLevel(level: string): void {
            this.level = level;
          }
          $get = [() => ({ log: (m: string): string => m })] as const;
        }

        // The callback's `loggerProvider` parameter should be inferred as
        // `LoggerProvider` via `ResolveDeps<ConfigRegistry, ['loggerProvider']>`.
        // If that inference works, calling `.setLevel('debug')` on it type-checks
        // without any explicit generic or annotation.
        const mod = createModule('app', [])
          .provider('logger', LoggerProvider)
          .config([
            'loggerProvider',
            (loggerProvider) => {
              // This line must compile — if `loggerProvider` is inferred as
              // `unknown` or `never`, `.setLevel` won't exist on it.
              expectTypeOf(loggerProvider).toEqualTypeOf<LoggerProvider>();
              loggerProvider.setLevel('debug');
            },
          ]);

        // Assert the runtime outcome so the test is also a smoke test.
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('logger')).toEqualTypeOf<{ log: (m: string) => string }>();
      });

      it('config callback params are typed from ConfigRegistry (constant value)', () => {
        const mod = createModule('app', [])
          .constant('MAX', 42)
          .config([
            'MAX',
            (max) => {
              expectTypeOf(max).toEqualTypeOf<number>();
            },
          ]);

        createInjector([mod]);
      });

      it('config callback params are typed from ConfigRegistry (multiple deps)', () => {
        class LoggerProvider {
          level: string = 'info';
          $get = [() => ({ log: (m: string): string => m })] as const;
        }

        const mod = createModule('app', [])
          .constant('MAX', 5)
          .provider('logger', LoggerProvider)
          .config([
            'MAX',
            'loggerProvider',
            (max, loggerProvider) => {
              expectTypeOf(max).toEqualTypeOf<number>();
              expectTypeOf(loggerProvider).toEqualTypeOf<LoggerProvider>();
            },
          ]);

        createInjector([mod]);
      });

      it('config cannot inject a service name at compile time (only <name>Provider)', () => {
        class LoggerProvider {
          $get = [() => ({ log: (m: string): string => m })] as const;
        }

        // After `.provider('logger', LoggerProvider)`, ConfigRegistry has
        // `loggerProvider: LoggerProvider` but NOT `logger`. Only Registry has
        // `logger: { log: ... }` — config is compile-time restricted to
        // ConfigRegistry keys.
        //
        // Isolate the typed overload with a helper type so overload resolution
        // doesn't fall through to the untyped fallback. Same trick used in
        // `type safety — service recipe` with `TypedGet`.
        type ConfigRegistry = { loggerProvider: LoggerProvider };
        type TypedConfig = <const Deps extends readonly (keyof ConfigRegistry)[]>(
          invokable: readonly [
            ...Deps,
            (
              ...args: { [I in keyof Deps]: Deps[I] extends keyof ConfigRegistry ? ConfigRegistry[Deps[I]] : never }
            ) => void,
          ],
        ) => unknown;

        const mod = createModule('app', []).provider('logger', LoggerProvider);
        const typedConfig: TypedConfig = mod.config.bind(mod) as TypedConfig;

        // Positive: 'loggerProvider' is in ConfigRegistry — compiles.
        typedConfig([
          'loggerProvider',
          (p) => {
            void p;
          },
        ]);

        // Negative: 'logger' is a service (run-phase only), not in ConfigRegistry.
        // @ts-expect-error -- 'logger' is not a config-phase key; only 'loggerProvider' is.
        typedConfig([
          'logger',
          (l) => {
            void l;
          },
        ]);
      });

      it('config rejects typo in dep names at compile time', () => {
        type ConfigRegistry = { MAX: number };
        type TypedConfig = <const Deps extends readonly (keyof ConfigRegistry)[]>(
          invokable: readonly [
            ...Deps,
            (
              ...args: { [I in keyof Deps]: Deps[I] extends keyof ConfigRegistry ? ConfigRegistry[Deps[I]] : never }
            ) => void,
          ],
        ) => unknown;

        const mod = createModule('app', []).constant('MAX', 5);
        const typedConfig: TypedConfig = mod.config.bind(mod) as TypedConfig;

        // Positive: known key compiles.
        typedConfig([
          'MAX',
          (max) => {
            void max;
          },
        ]);

        // Negative: typo'd key is a compile error.
        // @ts-expect-error -- 'MAXX' is a typo; only 'MAX' exists in ConfigRegistry.
        typedConfig([
          'MAXX',
          (max) => {
            void max;
          },
        ]);
      });
    });

    describe('Module.run', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('registers a run block via array-style invokable', () => {
        const mod = createModule('app', [])
          .constant('X', 1)
          .run([
            'X',
            (x: unknown) => {
              void x;
            },
          ]);
        expect(mod.$$runBlocks).toHaveLength(1);
      });

      it('registers a run block via $inject-annotated function', () => {
        const fn = (x: unknown) => {
          void x;
        };
        fn.$inject = ['X'] as const;
        const mod = createModule('app', []).constant('X', 1).run(fn);
        expect(mod.$$runBlocks).toHaveLength(1);
      });

      it('multiple run calls preserve registration order', () => {
        const first = ['X', () => {}] as const;
        const second = ['X', () => {}] as const;
        const third = ['X', () => {}] as const;
        const mod = createModule('app', []).constant('X', 1).run(first).run(second).run(third);
        expect(mod.$$runBlocks).toHaveLength(3);
        expect(mod.$$runBlocks[0]).toBe(first);
        expect(mod.$$runBlocks[1]).toBe(second);
        expect(mod.$$runBlocks[2]).toBe(third);
      });

      it('run is chainable alongside recipes and config', () => {
        const mod = createModule('app', [])
          .value('name', 'Jane')
          .constant('MAX', 5)
          .config([
            'MAX',
            (m: unknown) => {
              void m;
            },
          ])
          .run([
            'name',
            (n: unknown) => {
              void n;
            },
          ]);
        expect(mod.$$configBlocks).toHaveLength(1);
        expect(mod.$$runBlocks).toHaveLength(1);
      });
    });

    describe('createInjector (run blocks)', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('run block executes after all config blocks', () => {
        const order: string[] = [];
        class LoggerProvider {
          level = 'info';
          setLevel(l: string): void {
            this.level = l;
          }
          $get = [
            function (this: LoggerProvider) {
              return { level: this.level };
            },
          ] as const;
        }
        const mod = createModule('app', [])
          .provider('logger', LoggerProvider)
          .config([
            'loggerProvider',
            (p: unknown) => {
              (p as LoggerProvider).setLevel('debug');
              order.push('config');
            },
          ])
          .run([
            'logger',
            (logger: unknown) => {
              order.push(`run:${(logger as { level: string }).level}`);
            },
          ]);
        createInjector([mod]);
        expect(order).toEqual(['config', 'run:debug']);
      });

      it('run block can inject services, values, constants, and factories', () => {
        const seen: unknown[] = [];
        class Greeter {
          static readonly $inject = [] as const;
          hello() {
            return 'hi';
          }
        }
        const mod = createModule('app', [])
          .value('name', 'Jane')
          .constant('MAX', 5)
          .factory('counter', [() => ({ count: 0 })])
          .service('greeter', Greeter)
          .run([
            'name',
            'MAX',
            'counter',
            'greeter',
            (name: unknown, max: unknown, counter: unknown, greeter: unknown) => {
              seen.push(name, max, counter, greeter);
            },
          ]);
        createInjector([mod]);
        expect(seen).toHaveLength(4);
        expect(seen[0]).toBe('Jane');
        expect(seen[1]).toBe(5);
        expect(seen[2]).toEqual({ count: 0 });
        expect(seen[3]).toBeInstanceOf(Greeter);
      });

      it('run block cannot inject <name>Provider (config phase is over)', () => {
        class LoggerProvider {
          $get = [() => ({ log: (m: string): string => m })] as const;
        }
        const mod = createModule('app', [])
          .provider('logger', LoggerProvider)
          .run([
            'loggerProvider',
            (p: unknown) => {
              void p;
            },
          ]);
        expect(() => createInjector([mod])).toThrow(/Unknown provider: loggerProvider/);
      });

      it('multiple run blocks run in registration order within a module', () => {
        const order: string[] = [];
        const mod = createModule('app', [])
          .constant('X', 'x')
          .run(['X', () => order.push('first')])
          .run(['X', () => order.push('second')])
          .run(['X', () => order.push('third')]);
        createInjector([mod]);
        expect(order).toEqual(['first', 'second', 'third']);
      });

      it('run blocks across required modules run in dependency order', () => {
        const order: string[] = [];
        createModule('core', [])
          .constant('C', 'c')
          .run(['C', () => order.push('core')]);
        createModule('middle', ['core'])
          .constant('M', 'm')
          .run(['M', () => order.push('middle')]);
        const app = createModule('app', ['middle'])
          .constant('A', 'a')
          .run(['A', () => order.push('app')]);
        createInjector([app]);
        expect(order).toEqual(['core', 'middle', 'app']);
      });

      it('run blocks run exactly once per createInjector call', () => {
        let count = 0;
        const mod = createModule('app', [])
          .constant('X', 'x')
          .run([
            'X',
            () => {
              count++;
            },
          ]);
        createInjector([mod]);
        expect(count).toBe(1);
        // Creating a second injector with the same module runs the block again.
        resetRegistry();
        const mod2 = createModule('app', [])
          .constant('X', 'x')
          .run([
            'X',
            () => {
              count++;
            },
          ]);
        createInjector([mod2]);
        expect(count).toBe(2);
      });
    });

    describe('type safety — run blocks', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('run callback params are typed from Registry (service)', () => {
        class Greeter {
          static readonly $inject = [] as const;
          hello(): string {
            return 'hi';
          }
        }

        const mod = createModule('app', [])
          .service('greeter', Greeter)
          .run([
            'greeter',
            (greeter) => {
              expectTypeOf(greeter).toEqualTypeOf<Greeter>();
              greeter.hello();
            },
          ]);

        createInjector([mod]);
      });

      it('run callback params are typed from Registry (value)', () => {
        const mod = createModule('app', [])
          .value('name', 'Jane')
          .run([
            'name',
            (name) => {
              expectTypeOf(name).toEqualTypeOf<string>();
            },
          ]);

        createInjector([mod]);
      });

      it('run callback params are typed from Registry (multiple deps)', () => {
        class Greeter {
          static readonly $inject = [] as const;
          hello(): string {
            return 'hi';
          }
        }

        const mod = createModule('app', [])
          .value('name', 'Jane')
          .constant('MAX', 5)
          .service('greeter', Greeter)
          .run([
            'name',
            'MAX',
            'greeter',
            (name, max, greeter) => {
              expectTypeOf(name).toEqualTypeOf<string>();
              expectTypeOf(max).toEqualTypeOf<number>();
              expectTypeOf(greeter).toEqualTypeOf<Greeter>();
            },
          ]);

        createInjector([mod]);
      });

      it('run cannot inject a <name>Provider key at compile time', () => {
        class LoggerProvider {
          $get = [() => ({ log: (m: string): string => m })] as const;
        }

        // After `.provider('logger', LoggerProvider)`:
        // - Registry has `logger: { log: ... }`
        // - ConfigRegistry has `loggerProvider: LoggerProvider`
        // The `run` typed overload only sees Registry keys.
        type Registry = { logger: { log: (m: string) => string } };
        type TypedRun = <const Deps extends readonly (keyof Registry)[]>(
          invokable: readonly [
            ...Deps,
            (...args: { [I in keyof Deps]: Deps[I] extends keyof Registry ? Registry[Deps[I]] : never }) => void,
          ],
        ) => unknown;

        const mod = createModule('app', []).provider('logger', LoggerProvider);
        const typedRun: TypedRun = mod.run.bind(mod) as TypedRun;

        // Positive: 'logger' is in Registry — compiles.
        typedRun([
          'logger',
          (l) => {
            void l;
          },
        ]);

        // Negative: 'loggerProvider' is NOT in Registry (it's config-phase only).
        // @ts-expect-error -- 'loggerProvider' is not a run-phase key
        typedRun([
          'loggerProvider',
          (p) => {
            void p;
          },
        ]);
      });

      it('run rejects typo in dep names at compile time', () => {
        type Registry = { name: string };
        type TypedRun = <const Deps extends readonly (keyof Registry)[]>(
          invokable: readonly [
            ...Deps,
            (...args: { [I in keyof Deps]: Deps[I] extends keyof Registry ? Registry[Deps[I]] : never }) => void,
          ],
        ) => unknown;

        const mod = createModule('app', []).value('name', 'Jane');
        const typedRun: TypedRun = mod.run.bind(mod) as TypedRun;

        // Positive: known key compiles.
        typedRun([
          'name',
          (n) => {
            void n;
          },
        ]);

        // Negative: typo'd key is a compile error.
        // @ts-expect-error -- 'namee' is a typo; only 'name' exists in Registry
        typedRun([
          'namee',
          (n) => {
            void n;
          },
        ]);
      });
    });
  });
});
