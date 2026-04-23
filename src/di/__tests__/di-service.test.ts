import { describe, it, expect, expectTypeOf, beforeEach } from 'vitest';
import { createModule, resetRegistry } from '@di/module';
import { createInjector } from '@di/injector';

describe('dependency injection', () => {
  describe('spec 008 — advanced recipes & lifecycle', () => {
    describe('Module.service', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('pushes [service, name, invokable] to $$invokeQueue (constructor form)', () => {
        class UserService {
          kind = 'user';
        }
        const mod = createModule('app', []).service('userService', UserService);
        expect(mod.$$invokeQueue).toHaveLength(1);
        const entry = mod.$$invokeQueue[0];
        expect(entry?.[0]).toBe('service');
        expect(entry?.[1]).toBe('userService');
        expect(entry?.[2]).toBe(UserService);
      });

      it('pushes [service, name, invokable] to $$invokeQueue (array-style form)', () => {
        class UserService {
          constructor(public name: string) {}
        }
        const invokable = ['name', UserService] as const;
        const mod = createModule('app', []).value('name', 'Jane').service('userService', invokable);
        // The first entry is the value, the second is the service
        expect(mod.$$invokeQueue).toHaveLength(2);
        const entry = mod.$$invokeQueue[1];
        expect(entry?.[0]).toBe('service');
        expect(entry?.[1]).toBe('userService');
        expect(entry?.[2]).toBe(invokable);
      });

      it('returns the same module instance (for chaining)', () => {
        class SvcA {
          tag = 'a';
        }
        const mod = createModule('app', []);
        const chained = mod.service('a', SvcA);
        expect(chained).toBe(mod);
      });

      it('supports chaining with value, constant, and factory', () => {
        class SvcA {
          tag = 'a';
        }
        const mod = createModule('app', [])
          .value('v', 1)
          .constant('c', 2)
          .factory('f', [() => 'result'])
          .service('a', SvcA);
        expect(mod.$$invokeQueue).toHaveLength(4);
        expect(mod.$$invokeQueue[3]?.[0]).toBe('service');
      });
    });

    describe('createInjector (service recipe)', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('instantiates a service with no dependencies via `new`', () => {
        class Counter {
          static readonly $inject = [] as const;
          value = 0;
          increment() {
            this.value++;
          }
        }
        const mod = createModule('app', []).service('counter', Counter);
        const injector = createInjector([mod]);
        const counter = injector.get('counter');
        expect(counter).toBeInstanceOf(Counter);
      });

      it('resolves the instance as a singleton (same reference)', () => {
        class Counter {
          static readonly $inject = [] as const;
          value = 0;
        }
        const mod = createModule('app', []).service('counter', Counter);
        const injector = createInjector([mod]);
        const a = injector.get('counter');
        const b = injector.get('counter');
        expect(a).toBe(b);
      });

      it('resolves $inject-annotated constructor dependencies', () => {
        class Logger {
          static readonly $inject = [] as const;
          log(msg: string) {
            return `LOG: ${msg}`;
          }
        }
        class Service {
          static readonly $inject = ['logger'] as const;
          constructor(public logger: Logger) {}
          greet() {
            return this.logger.log('hello');
          }
        }

        const mod = createModule('app', []).service('logger', Logger).service('service', Service);
        const injector = createInjector([mod]);
        const svc = injector.get('service');
        expect(svc.greet()).toBe('LOG: hello');
      });

      it('resolves array-style annotated constructor dependencies', () => {
        class Config {
          constructor(public defaults: Record<string, unknown>) {}
        }
        const defaultsValue = { retries: 3 };
        const mod = createModule('app', []).value('defaults', defaultsValue).service('config', ['defaults', Config]);
        const injector = createInjector([mod]);
        const config = injector.get('config');
        expect(config).toBeInstanceOf(Config);
        expect(config.defaults).toBe(defaultsValue);
      });

      it('passes resolved dependencies as positional constructor args in order', () => {
        class Service {
          static readonly $inject = ['a', 'b', 'c'] as const;
          constructor(
            public a: string,
            public b: number,
            public c: boolean,
          ) {}
        }

        const mod = createModule('app', [])
          .value('a', 'hello')
          .value('b', 42)
          .value('c', true)
          .service('service', Service);
        const injector = createInjector([mod]);
        const svc = injector.get('service');
        expect(svc.a).toBe('hello');
        expect(svc.b).toBe(42);
        expect(svc.c).toBe(true);
      });

      it('the returned instance satisfies `instanceof` the original constructor', () => {
        class UserService {
          static readonly $inject = [] as const;
          kind = 'user';
        }
        const mod = createModule('app', []).service('userService', UserService);
        const injector = createInjector([mod]);
        const svc = injector.get('userService');
        expect(svc).toBeInstanceOf(UserService);
      });

      it('services can depend on factories, values, and constants', () => {
        class Service {
          static readonly $inject = ['url', 'max'] as const;
          constructor(
            public url: string,
            public max: number,
          ) {}
        }

        const mod = createModule('app', []).value('url', 'https://...').constant('max', 5).service('service', Service);
        const injector = createInjector([mod]);
        const svc = injector.get<Service>('service');
        expect(svc.url).toBe('https://...');
        expect(svc.max).toBe(5);
      });

      it('injector.has returns true for a registered service (before and after instantiation)', () => {
        class Svc {
          static readonly $inject = [] as const;
          tag = 'svc';
        }
        const mod = createModule('app', []).service('svc', Svc);
        const injector = createInjector([mod]);
        expect(injector.has('svc')).toBe(true);
        injector.get('svc');
        expect(injector.has('svc')).toBe(true);
      });

      it('does not instantiate the service at load time (lazy)', () => {
        let constructed = 0;
        // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- constructor side-effect is load-bearing to the test
        class Svc {
          constructor() {
            constructed++;
          }
        }
        const mod = createModule('app', []).service('svc', Svc);
        createInjector([mod]);
        expect(constructed).toBe(0);
      });

      it('detects a cycle involving services (service -> service -> service)', () => {
        class A {
          static readonly $inject = ['b'] as const;
          constructor(public b: unknown) {}
        }

        class B {
          static readonly $inject = ['a'] as const;
          constructor(public a: unknown) {}
        }

        const mod = createModule('app', []).service('a', A).service('b', B);
        const injector = createInjector([mod]);
        expect(() => injector.get('a')).toThrow(/Circular dependency/);
      });
    });

    describe('type safety — service recipe', () => {
      beforeEach(() => {
        resetRegistry();
      });

      it('constructor-only form infers InstanceType<Ctor> on injector.get', () => {
        class UserService {
          static readonly $inject = [] as const;
          kind = 'user' as const;
          greet(): string {
            return 'hello';
          }
        }

        const mod = createModule('app', []).service('userService', UserService);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('userService')).toEqualTypeOf<UserService>();
      });

      it('array-style form infers InstanceType<Ctor> on injector.get', () => {
        class Config {
          readonly defaults: Record<string, unknown>;
          constructor(defaults: Record<string, unknown>) {
            this.defaults = defaults;
          }
        }

        const mod = createModule('app', []).value('defaults', { retries: 3 }).service('config', ['defaults', Config]);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('config')).toEqualTypeOf<Config>();
      });

      it('array-style deps are typed from the module Registry', () => {
        class Service {
          readonly name: string;
          readonly age: number;
          constructor(name: string, age: number) {
            this.name = name;
            this.age = age;
          }
        }

        const mod = createModule('app', [])
          .value('name', 'Jane')
          .value('age', 30)
          .service('service', ['name', 'age', Service]);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('service')).toEqualTypeOf<Service>();
      });

      it('chained service calls widen the Registry correctly', () => {
        class Logger {
          static readonly $inject = [] as const;
          kind = 'logger' as const;
          log(msg: string): void {
            void msg;
          }
        }

        class Cache {
          static readonly $inject = [] as const;
          kind = 'cache' as const;
          get(key: string): string | undefined {
            void key;
            return undefined;
          }
        }

        const mod = createModule('app', []).service('logger', Logger).service('cache', Cache);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('logger')).toEqualTypeOf<Logger>();
        expectTypeOf(injector.get('cache')).toEqualTypeOf<Cache>();
      });

      it('service merges alongside value, constant, and factory in the same Registry', () => {
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
          .factory<'logger', { log: (m: string) => void }>('logger', [
            () => ({
              log: (m: string): undefined => {
                void m;
                return undefined;
              },
            }),
          ])
          .service('greeter', Greeter);
        const injector = createInjector([mod]);
        expectTypeOf(injector.get('name')).toEqualTypeOf<string>();
        expectTypeOf(injector.get('MAX')).toEqualTypeOf<number>();
        expectTypeOf(injector.get('logger')).toEqualTypeOf<{ log: (m: string) => void }>();
        expectTypeOf(injector.get('greeter')).toEqualTypeOf<Greeter>();
      });

      it('services from multiple modules merge into the injector type', () => {
        class ServiceA {
          static readonly $inject = [] as const;
          kind = 'a' as const;
        }

        class ServiceB {
          static readonly $inject = [] as const;
          kind = 'b' as const;
        }

        const modA = createModule('a', []).service('serviceA', ServiceA);
        const modB = createModule('b', []).service('serviceB', ServiceB);
        const injector = createInjector([modA, modB]);
        expectTypeOf(injector.get('serviceA')).toEqualTypeOf<ServiceA>();
        expectTypeOf(injector.get('serviceB')).toEqualTypeOf<ServiceB>();
      });

      it('typed get rejects unknown keys for service-only registries', () => {
        class UserService {
          static readonly $inject = [] as const;
          kind = 'user' as const;
        }

        const mod = createModule('app', []).service('userService', UserService);
        const injector = createInjector([mod]);

        // Isolate the typed overload so overload resolution doesn't fall through
        // to the escape hatch. See spec 007's type-safety tests for the same trick.
        type Registry = { userService: UserService };
        type TypedGet = <K extends keyof Registry>(name: K) => Registry[K];
        const typedGet: TypedGet = injector.get.bind(injector);

        // Positive: registered key compiles.
        expectTypeOf(typedGet('userService')).toEqualTypeOf<UserService>();

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
