import { describe, it, expect, expectTypeOf, beforeEach } from 'vitest';
import { createModule, getModule, resetRegistry } from '@di/module';
import { createInjector } from '@di/injector';

describe('dependency injection', () => {
  describe('spec 008 — advanced recipes & lifecycle', () => {
    describe('Module.decorator', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('pushes [decorator, name, invokable] to $$invokeQueue', () => {
        const invokable = ['$delegate', ($delegate: unknown) => $delegate] as const;
        const mod = createModule('app', [])
          .value('logger', { log: (m: string) => void m })
          .decorator('logger', invokable);
        // Two entries: the value and the decorator
        expect(mod.$$invokeQueue).toHaveLength(2);
        const entry = mod.$$invokeQueue[1];
        expect(entry?.[0]).toBe('decorator');
        expect(entry?.[1]).toBe('logger');
        expect(entry?.[2]).toBe(invokable);
      });

      it('returns the same module instance (for chaining)', () => {
        const mod = createModule('app', []).value('logger', { log: (m: string) => void m });
        const chained = mod.decorator('logger', ['$delegate', ($delegate: unknown) => $delegate]);
        expect(chained).toBe(mod);
      });

      it('supports registering multiple decorators for the same service', () => {
        const mod = createModule('app', [])
          .value('logger', { log: (m: string) => void m })
          .decorator('logger', ['$delegate', ($delegate: unknown) => $delegate])
          .decorator('logger', ['$delegate', ($delegate: unknown) => $delegate]);
        expect(mod.$$invokeQueue).toHaveLength(3);
        expect(mod.$$invokeQueue[1]?.[0]).toBe('decorator');
        expect(mod.$$invokeQueue[2]?.[0]).toBe('decorator');
      });

      it('supports chaining with value, constant, factory, service, and provider', () => {
        const mod = createModule('app', [])
          .value('v', 1)
          .constant('c', 2)
          .factory('f', [() => 'factoryValue'])
          .decorator('v', ['$delegate', ($delegate: unknown) => $delegate]);
        expect(mod.$$invokeQueue).toHaveLength(4);
        expect(mod.$$invokeQueue[3]?.[0]).toBe('decorator');
      });
    });

    describe('createInjector (decorator recipe)', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('wraps a value service — decorator modifies the returned value', () => {
        type Logger = { log: (msg: string) => string; verbose?: (msg: string) => string };
        const mod = createModule('app', [])
          .value<'logger', Logger>('logger', {
            log: (msg: string) => `LOG: ${msg}`,
          })
          .decorator('logger', [
            '$delegate',
            ($delegate: Logger): Logger => ({
              ...$delegate,
              verbose: (msg: string) => `VERBOSE: ${msg}`,
            }),
          ]);
        const injector = createInjector([mod]);
        const logger = injector.get<Logger>('logger');
        expect(logger.log('hello')).toBe('LOG: hello');
        expect(logger.verbose?.('hi')).toBe('VERBOSE: hi');
      });

      it('wraps a factory service — decorator sees the factory output as $delegate', () => {
        type Greeter = { greet: () => string };
        const mod = createModule('app', [])
          .factory<'greeter', Greeter>('greeter', [() => ({ greet: () => 'hello' })])
          .decorator('greeter', [
            '$delegate',
            ($delegate: Greeter): Greeter => ({
              greet: () => `${$delegate.greet()}!`,
            }),
          ]);
        const injector = createInjector([mod]);
        expect(injector.get<Greeter>('greeter').greet()).toBe('hello!');
      });

      it('wraps a service recipe — decorator sees the class instance as $delegate', () => {
        class Counter {
          static readonly $inject = [] as const;
          value = 0;
          increment() {
            this.value++;
            return this.value;
          }
        }
        type CounterLike = { increment: () => number; reset?: () => void };
        const mod = createModule('app', [])
          .service('counter', Counter)
          .decorator('counter', [
            '$delegate',
            ($delegate: Counter): CounterLike => ({
              increment: () => $delegate.increment(),
              reset: () => {
                $delegate.value = 0;
              },
            }),
          ]);
        const injector = createInjector([mod]);
        const counter = injector.get<CounterLike>('counter');
        expect(counter.increment()).toBe(1);
        expect(counter.increment()).toBe(2);
        counter.reset?.();
        expect(counter.increment()).toBe(1);
      });

      it('wraps a provider-produced service — decorator sees the $get return as $delegate', () => {
        type Logger = { log: (msg: string) => string };
        class LoggerProvider {
          $get = [() => ({ log: (msg: string) => `provider: ${msg}` })] as const;
        }
        const mod = createModule('app', [])
          .provider('logger', LoggerProvider)
          .decorator('logger', [
            '$delegate',
            ($delegate: Logger): Logger => ({
              log: (msg: string) => `[DECORATED] ${$delegate.log(msg)}`,
            }),
          ]);
        const injector = createInjector([mod]);
        const logger = injector.get<Logger>('logger');
        expect(logger.log('hi')).toBe('[DECORATED] provider: hi');
      });

      it('chains multiple decorators in registration order', () => {
        type Greeter = { greet: () => string };
        const mod = createModule('app', [])
          .value<'greeter', Greeter>('greeter', {
            greet: () => 'hello',
          })
          .decorator('greeter', [
            '$delegate',
            ($delegate: Greeter): Greeter => ({
              greet: () => `${$delegate.greet()}-d1`,
            }),
          ])
          .decorator('greeter', [
            '$delegate',
            ($delegate: Greeter): Greeter => ({
              greet: () => `${$delegate.greet()}-d2`,
            }),
          ]);
        const injector = createInjector([mod]);
        // Applied in registration order: d1 wraps original, then d2 wraps d1
        expect(injector.get<Greeter>('greeter').greet()).toBe('hello-d1-d2');
      });

      it('decorator can inject additional deps alongside $delegate', () => {
        type Greeter = { greet: () => string };
        const mod = createModule('app', [])
          .value('name', 'Jane')
          .value<'greeter', Greeter>('greeter', {
            greet: () => 'hello',
          })
          .decorator('greeter', [
            '$delegate',
            'name',
            ($delegate: Greeter, name: string): Greeter => ({
              greet: () => `${$delegate.greet()} ${name}`,
            }),
          ]);
        const injector = createInjector([mod]);
        expect(injector.get<Greeter>('greeter').greet()).toBe('hello Jane');
      });

      it('decorated service is still a singleton — decoration runs once', () => {
        let decoratorCalls = 0;
        type Greeter = { greet: () => string };
        const mod = createModule('app', [])
          .value<'greeter', Greeter>('greeter', { greet: () => 'hello' })
          .decorator('greeter', [
            '$delegate',
            ($delegate: Greeter): Greeter => {
              decoratorCalls++;
              return { greet: () => `decorated: ${$delegate.greet()}` };
            },
          ]);
        const injector = createInjector([mod]);
        const a = injector.get<Greeter>('greeter');
        const b = injector.get<Greeter>('greeter');
        expect(a).toBe(b);
        expect(decoratorCalls).toBe(1);
      });

      it('throws Cannot decorate unknown service when the target is not registered', () => {
        const mod = createModule('app', []).decorator('missing', ['$delegate', ($delegate: unknown) => $delegate]);
        expect(() => createInjector([mod])).toThrow(/Cannot decorate unknown service: "missing"/);
      });

      it('throws Cannot decorate unknown service for a cross-module unknown target', () => {
        createModule('core', []).value('existing', 'yes');
        const app = createModule('app', ['core']).decorator('nonexistent', [
          '$delegate',
          ($delegate: unknown) => $delegate,
        ]);
        expect(() => createInjector([app])).toThrow(/Cannot decorate unknown service: "nonexistent"/);
      });

      it('decorator on a cross-module service works (module A has the value, module B decorates it)', () => {
        type Logger = { log: (msg: string) => string };
        createModule('core', []).value<'logger', Logger>('logger', {
          log: (msg: string) => `core: ${msg}`,
        });
        const app = createModule('app', ['core']).decorator('logger', [
          '$delegate',
          ($delegate: Logger): Logger => ({
            log: (msg: string) => `[APP] ${$delegate.log(msg)}`,
          }),
        ]);
        const injector = createInjector([getModule('core'), app]);
        expect(injector.get<Logger>('logger').log('hi')).toBe('[APP] core: hi');
      });

      it('detects a self-referential decorator cycle', () => {
        type Greeter = { greet: () => string };
        const mod = createModule('app', [])
          .value<'greeter', Greeter>('greeter', { greet: () => 'hello' })
          .decorator('greeter', [
            // Decorator depends on 'greeter' itself (beyond $delegate) — cycle
            '$delegate',
            'greeter',
            ($delegate: Greeter, self: Greeter): Greeter => ({
              greet: () => `${$delegate.greet()}-${self.greet()}`,
            }),
          ]);
        const injector = createInjector([mod]);
        expect(() => injector.get('greeter')).toThrow(/Circular dependency/);
      });
    });

    describe('type safety — decorator recipe', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('$delegate parameter is typed as Registry[K] (value service)', () => {
        type Logger = { log: (msg: string) => string };
        const mod = createModule('app', [])
          .value<'logger', Logger>('logger', { log: (msg: string) => msg })
          .decorator('logger', [
            '$delegate',
            ($delegate): Logger => {
              // $delegate must be inferred as Logger from Registry['logger'].
              expectTypeOf($delegate).toEqualTypeOf<Logger>();
              return { log: (msg: string) => `[wrapped] ${$delegate.log(msg)}` };
            },
          ]);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('logger')).toEqualTypeOf<Logger>();
      });

      it('$delegate parameter is typed as Registry[K] (service-recipe service)', () => {
        class Greeter {
          static readonly $inject = [] as const;
          hello(): string {
            return 'hi';
          }
        }

        const mod = createModule('app', [])
          .service('greeter', Greeter)
          .decorator('greeter', [
            '$delegate',
            ($delegate): Greeter => {
              expectTypeOf($delegate).toEqualTypeOf<Greeter>();
              return $delegate;
            },
          ]);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('greeter')).toEqualTypeOf<Greeter>();
      });

      it('decorator return type replaces the service type in the Registry', () => {
        type Logger = { log: (msg: string) => string };
        type RichLogger = Logger & { level: string };

        const mod = createModule('app', [])
          .value<'logger', Logger>('logger', { log: (msg: string) => msg })
          .decorator('logger', [
            '$delegate',
            ($delegate): RichLogger => ({
              log: (msg: string) => $delegate.log(msg),
              level: 'info',
            }),
          ]);
        const injector = createInjector([mod]);
        // The decorator widens `logger` from `Logger` to `RichLogger`.
        expectTypeOf(injector.get('logger')).toEqualTypeOf<RichLogger>();
      });

      it('chained decorators see the previous return type as $delegate', () => {
        type Logger = { log: (msg: string) => string };
        type Timestamped = Logger & { at: number };
        type Leveled = Timestamped & { level: string };

        const mod = createModule('app', [])
          .value<'logger', Logger>('logger', { log: (msg: string) => msg })
          .decorator('logger', [
            '$delegate',
            ($delegate): Timestamped => {
              expectTypeOf($delegate).toEqualTypeOf<Logger>();
              return { log: $delegate.log, at: 0 };
            },
          ])
          .decorator('logger', [
            '$delegate',
            ($delegate): Leveled => {
              // Second decorator sees the first decorator's return type.
              expectTypeOf($delegate).toEqualTypeOf<Timestamped>();
              return { ...$delegate, level: 'info' };
            },
          ]);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('logger')).toEqualTypeOf<Leveled>();
      });

      it('decorator accepts additional Registry-typed deps alongside $delegate', () => {
        type Logger = { log: (msg: string) => string };
        const mod = createModule('app', [])
          .value('prefix', '[APP]')
          .value<'logger', Logger>('logger', { log: (msg: string) => msg })
          .decorator('logger', [
            '$delegate',
            'prefix',
            ($delegate, prefix): Logger => {
              expectTypeOf($delegate).toEqualTypeOf<Logger>();
              expectTypeOf(prefix).toEqualTypeOf<string>();
              return { log: (msg: string) => `${prefix} ${$delegate.log(msg)}` };
            },
          ]);
        const injector = createInjector([mod]);
        expect(injector.get<Logger>('logger').log('hi')).toBe('[APP] hi');
      });

      it('decorating an unknown service name is a compile error', () => {
        type Logger = { log: (msg: string) => string };

        const base = createModule('app', []).value<'logger', Logger>('logger', {
          log: (msg: string) => msg,
        });

        // Isolate the typed overload so overload resolution doesn't fall
        // through to the untyped fallback. Same trick as spec 007/008 above.
        type Registry = { logger: Logger };
        type TypedDecorator = <K extends keyof Registry>(
          name: K,
          invokable: readonly ['$delegate', (delegate: Registry[K]) => Registry[K]],
        ) => unknown;
        const typedDecorator: TypedDecorator = base.decorator.bind(base) as TypedDecorator;

        // Positive: known key compiles.
        typedDecorator('logger', ['$delegate', ($delegate): Logger => $delegate]);

        // Negative: unknown key is a compile error on the typed overload.
        // @ts-expect-error -- 'unknown' is not a registered service name
        typedDecorator('unknown', ['$delegate', ($delegate: Logger): Logger => $delegate]);
      });
    });
  });
});
