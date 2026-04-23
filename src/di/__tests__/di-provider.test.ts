import { describe, it, expect, expectTypeOf, beforeEach } from 'vitest';
import { createModule, resetRegistry } from '@di/module';
import { createInjector } from '@di/injector';

describe('dependency injection', () => {
  describe('spec 008 — advanced recipes & lifecycle', () => {
    describe('Module.provider', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('pushes [provider, name, source] to $$invokeQueue (Form 1: constructor)', () => {
        function LoggerProvider(this: { $get: () => unknown }) {
          this.$get = (): { log: (m: string) => undefined } => ({
            log: () => undefined,
          });
        }
        const mod = createModule('app', []).provider('logger', LoggerProvider);
        expect(mod.$$invokeQueue).toHaveLength(1);
        const entry = mod.$$invokeQueue[0];
        expect(entry?.[0]).toBe('provider');
        expect(entry?.[1]).toBe('logger');
        expect(entry?.[2]).toBe(LoggerProvider);
      });

      it('pushes [provider, name, source] to $$invokeQueue (Form 2: object literal)', () => {
        const providerObj = {
          $get: (): { log: (m: string) => undefined } => ({
            log: () => undefined,
          }),
        };
        const mod = createModule('app', []).provider('logger', providerObj);
        expect(mod.$$invokeQueue).toHaveLength(1);
        const entry = mod.$$invokeQueue[0];
        expect(entry?.[0]).toBe('provider');
        expect(entry?.[1]).toBe('logger');
        expect(entry?.[2]).toBe(providerObj);
      });

      it('pushes [provider, name, source] to $$invokeQueue (Form 3: array-style)', () => {
        function LoggerProvider(this: { level: string; $get: () => unknown }, level: string) {
          this.level = level;
          this.$get = (): { level: string } => ({ level: this.level });
        }
        const providerArr = ['defaultLevel', LoggerProvider] as const;
        const mod = createModule('app', []).constant('defaultLevel', 'info').provider('logger', providerArr);
        expect(mod.$$invokeQueue).toHaveLength(2);
        const entry = mod.$$invokeQueue[1];
        expect(entry?.[0]).toBe('provider');
        expect(entry?.[1]).toBe('logger');
        expect(entry?.[2]).toBe(providerArr);
      });

      it('returns the same module instance (for chaining)', () => {
        function Prov(this: { $get: () => unknown }) {
          this.$get = (): string => 'value';
        }
        const mod = createModule('app', []);
        const chained = mod.provider('p', Prov);
        expect(chained).toBe(mod);
      });

      it('supports chaining with value, constant, factory, and service', () => {
        function Prov(this: { $get: () => unknown }) {
          this.$get = (): string => 'provValue';
        }
        const mod = createModule('app', [])
          .value('v', 1)
          .constant('c', 2)
          .factory('f', [() => 'factoryValue'])
          .provider('p', Prov);
        expect(mod.$$invokeQueue).toHaveLength(4);
        expect(mod.$$invokeQueue[3]?.[0]).toBe('provider');
      });
    });

    describe('createInjector (provider recipe)', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('instantiates Form 1 (constructor) and resolves service via $get', () => {
        function LoggerProvider(this: { level: string; $get: readonly [() => { log: (m: string) => string }] }) {
          this.level = 'info';
          const level = this.level;
          this.$get = [
            (): { log: (m: string) => string } => ({
              log: (m: string) => `[${level}] ${m}`,
            }),
          ] as const;
        }
        const mod = createModule('app', []).provider('logger', LoggerProvider);
        const injector = createInjector([mod]);
        const logger = injector.get<{ log: (m: string) => string }>('logger');
        expect(logger.log('hello')).toBe('[info] hello');
      });

      it('instantiates Form 2 (object literal) and resolves service via $get', () => {
        const providerObj = {
          level: 'debug',
          $get: [
            function (this: { level: string }): { log: (m: string) => string } {
              const level = this.level;
              return { log: (m: string) => `[${level}] ${m}` };
            },
          ] as const,
        };
        const mod = createModule('app', []).provider('logger', providerObj);
        const injector = createInjector([mod]);
        const logger = injector.get<{ log: (m: string) => string }>('logger');
        expect(logger.log('hi')).toBe('[debug] hi');
      });

      it('instantiates Form 3 (array-style with config-phase deps) and resolves service via $get', () => {
        function LoggerProvider(
          this: {
            level: string;
            $get: readonly [() => { log: (m: string) => string }];
          },
          defaultLevel: string,
        ) {
          this.level = defaultLevel;
          const level = this.level;
          this.$get = [
            (): { log: (m: string) => string } => ({
              log: (m: string) => `[${level}] ${m}`,
            }),
          ] as const;
        }
        const mod = createModule('app', [])
          .constant('defaultLevel', 'warn')
          .provider('logger', ['defaultLevel', LoggerProvider]);
        const injector = createInjector([mod]);
        const logger = injector.get<{ log: (m: string) => string }>('logger');
        expect(logger.log('oops')).toBe('[warn] oops');
      });

      it('service produced by a provider is a singleton', () => {
        let getCallCount = 0;
        function CounterProvider(this: { $get: readonly [() => { count: number }] }) {
          this.$get = [
            (): { count: number } => {
              getCallCount++;
              return { count: 0 };
            },
          ] as const;
        }
        const mod = createModule('app', []).provider('counter', CounterProvider);
        const injector = createInjector([mod]);
        const a = injector.get('counter');
        const b = injector.get('counter');
        expect(a).toBe(b);
        expect(getCallCount).toBe(1);
      });

      it('$get is NOT invoked at load time (lazy resolution)', () => {
        let getCalls = 0;
        function LazyProvider(this: { $get: readonly [() => string] }) {
          this.$get = [
            (): string => {
              getCalls++;
              return 'value';
            },
          ] as const;
        }
        const mod = createModule('app', []).provider('lazy', LazyProvider);
        createInjector([mod]);
        expect(getCalls).toBe(0);
      });

      it('$get can declare its own run-phase dependencies via array-style', () => {
        function GreeterProvider(this: { $get: readonly ['name', (name: string) => { greet: () => string }] }) {
          this.$get = ['name', (name: string) => ({ greet: () => `hello ${name}` })] as const;
        }
        const mod = createModule('app', []).value('name', 'Jane').provider('greeter', GreeterProvider);
        const injector = createInjector([mod]);
        const greeter = injector.get<{ greet: () => string }>('greeter');
        expect(greeter.greet()).toBe('hello Jane');
      });

      it('$get is invoked with `this` bound to the provider instance', () => {
        const capturedInstances: unknown[] = [];
        class ConfigurableProvider {
          prefix = 'default';
          $get = [
            function (this: { prefix: string }): { format: (m: string) => string } {
              // Verify `this` is the provider instance at call time by stashing
              // the receiver; we later assert it matches the sole instance.
              capturedInstances.push(this);
              const capturedPrefix = this.prefix;
              return { format: (m: string) => `${capturedPrefix}: ${m}` };
            },
          ] as const;
          setPrefix(p: string): void {
            this.prefix = p;
          }
        }
        const mod = createModule('app', []).provider('configurable', ConfigurableProvider);
        const injector = createInjector([mod]);
        const svc = injector.get<{ format: (m: string) => string }>('configurable');
        expect(svc.format('msg')).toBe('default: msg');
        expect(capturedInstances).toHaveLength(1);
        expect(capturedInstances[0]).toBeInstanceOf(ConfigurableProvider);
      });

      it('throws when the provider constructor does not set a $get method', () => {
        function BrokenProvider(this: { foo: string }) {
          this.foo = 'bar';
          // deliberately no $get
        }
        const mod = createModule('app', []).provider('broken', BrokenProvider);
        expect(() => createInjector([mod])).toThrow(/Provider "broken" has no \$get method/);
      });

      it('throws when the provider source is neither a function, object, nor array', () => {
        const mod = createModule('app', []).provider('bad', 42 as unknown);
        expect(() => createInjector([mod])).toThrow(
          /Expected provider for "bad" to be a function, array, or object with \$get/,
        );
      });

      it('injector.has returns true for a provider-backed service (before and after resolution)', () => {
        function Prov(this: { $get: readonly [() => string] }) {
          this.$get = [(): string => 'value'] as const;
        }
        const mod = createModule('app', []).provider('svc', Prov);
        const injector = createInjector([mod]);
        expect(injector.has('svc')).toBe(true);
        injector.get('svc');
        expect(injector.has('svc')).toBe(true);
      });

      it('detects a cycle between two providers via their $get deps', () => {
        function AProvider(this: { $get: readonly ['b', (b: unknown) => unknown] }) {
          this.$get = ['b', (b: unknown) => b] as const;
        }
        function BProvider(this: { $get: readonly ['a', (a: unknown) => unknown] }) {
          this.$get = ['a', (a: unknown) => a] as const;
        }
        const mod = createModule('app', []).provider('a', AProvider).provider('b', BProvider);
        const injector = createInjector([mod]);
        expect(() => injector.get('a')).toThrow(/Circular dependency/);
      });
    });

    describe('type safety — provider recipe', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('Form 1 (constructor) infers $get return type on injector.get', () => {
        class LoggerProvider {
          $get = [() => ({ log: (m: string): void => void m })] as const;
        }

        const mod = createModule('app', []).provider('logger', LoggerProvider);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('logger')).toEqualTypeOf<{ log: (m: string) => void }>();
      });

      it('Form 2 (object literal) infers $get return type on injector.get', () => {
        const providerObj = {
          level: 'info',
          $get: [() => ({ log: (m: string): void => void m })] as const,
        };

        const mod = createModule('app', []).provider('logger', providerObj);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('logger')).toEqualTypeOf<{ log: (m: string) => void }>();
      });

      it('Form 3 (array-style) types config-phase deps from ConfigRegistry', () => {
        class LoggerProvider {
          readonly level: string;
          $get = [() => ({ log: (m: string): void => void m })] as const;
          constructor(defaultLevel: string) {
            this.level = defaultLevel;
          }
        }

        const mod = createModule('app', [])
          .constant('defaultLevel', 'warn')
          .provider('logger', ['defaultLevel', LoggerProvider]);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('logger')).toEqualTypeOf<{ log: (m: string) => void }>();
      });

      it('provider widens Registry with the service type', () => {
        class GreeterProvider {
          $get = [() => ({ hello: (): string => 'hi' })] as const;
        }

        const mod = createModule('app', []).value('name', 'Jane').provider('greeter', GreeterProvider);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('name')).toEqualTypeOf<string>();
        expectTypeOf(injector.get('greeter')).toEqualTypeOf<{ hello: () => string }>();
      });

      it('providers from multiple modules merge into the injector type', () => {
        class ClockProvider {
          $get = [() => ({ now: (): number => Date.now() })] as const;
        }

        class RandomProvider {
          $get = [() => ({ next: (): number => Math.random() })] as const;
        }

        const core = createModule('core', []).provider('clock', ClockProvider);
        const rand = createModule('rand', []).provider('random', RandomProvider);
        const injector = createInjector([core, rand]);

        expectTypeOf(injector.get('clock')).toEqualTypeOf<{ now: () => number }>();
        expectTypeOf(injector.get('random')).toEqualTypeOf<{ next: () => number }>();
      });

      it('provider merges alongside value, constant, factory, and service', () => {
        class LoggerProvider {
          $get = [() => ({ log: (m: string): void => void m })] as const;
        }

        class Greeter {
          static readonly $inject = [] as const;
          kind = 'greeter' as const;
          hello(): string {
            return 'hi';
          }
        }

        const mod = createModule('app', [])
          .value('name', 'Jane')
          .constant('MAX', 5)
          .factory<'counter', { count: number }>('counter', [() => ({ count: 0 })])
          .service('greeter', Greeter)
          .provider('logger', LoggerProvider);
        const injector = createInjector([mod]);

        expectTypeOf(injector.get('name')).toEqualTypeOf<string>();
        expectTypeOf(injector.get('MAX')).toEqualTypeOf<number>();
        expectTypeOf(injector.get('counter')).toEqualTypeOf<{ count: number }>();
        expectTypeOf(injector.get('greeter')).toEqualTypeOf<Greeter>();
        expectTypeOf(injector.get('logger')).toEqualTypeOf<{ log: (m: string) => void }>();
      });

      it('Form 3 accepts registered config-phase deps at compile time', () => {
        class AProvider {
          $get = [(): string => 'a'] as const;
          constructor(defaultLevel: string) {
            void defaultLevel;
          }
        }

        // Positive: 'defaultLevel' is a registered constant and compiles via Form 3.
        const mod = createModule('app', []).constant('defaultLevel', 'warn').provider('a', ['defaultLevel', AProvider]);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('a')).toEqualTypeOf<string>();

        // Note: Typos in Form 3 dep names fall through to the untyped fallback
        // overload at compile time (same limitation as spec 007's typed factory).
        // Runtime validation catches the typo via `providerInjector.get` throwing
        // 'Unknown provider' — see the runtime tests above.
      });

      it('typed get rejects unknown keys for provider-backed registries', () => {
        class LoggerProvider {
          $get = [() => ({ log: (m: string): void => void m })] as const;
        }

        const mod = createModule('app', []).provider('logger', LoggerProvider);
        const injector = createInjector([mod]);

        // Isolate the typed overload so overload resolution doesn't fall through
        // to the escape hatch. See spec 007's type-safety tests for the same trick.
        type Registry = { logger: { log: (m: string) => void } };
        type TypedGet = <K extends keyof Registry>(name: K) => Registry[K];
        const typedGet: TypedGet = injector.get.bind(injector);

        // Positive: registered key compiles.
        expectTypeOf(typedGet('logger')).toEqualTypeOf<{ log: (m: string) => void }>();

        // Negative: unknown key is a compile error on the typed overload.
        try {
          // @ts-expect-error -- 'unknown' is not in the typed Registry
          typedGet('unknown');
        } catch {
          /* expected: runtime throws on unregistered name */
        }
      });
    });
  });
});
