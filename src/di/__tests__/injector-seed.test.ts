/**
 * Internal-seed seam tests (spec 036 Slice 3).
 *
 * `createInjector(modules, { seed })` pre-seeds entries into the same
 * `providerCache` slot the injector uses for its `$injector` self-seed. The
 * DOM bootstrap layer leans on this to make the started element injectable as
 * `$rootElement` WITHOUT registering it on a shared module (so re-bootstrap
 * never collides in the global registry). Headless callers pass nothing → the
 * seed is absent and `$rootElement` is an unknown provider.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createModule, resetRegistry } from '@di/module';
import { createInjector } from '@di/injector';

describe('createInjector internal seed seam', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('seeds $rootElement so injector.get returns the seeded element', () => {
    const element = document.createElement('div');
    const injector = createInjector([createModule('app', [])], { seed: { $rootElement: element } });
    expect(injector.get<HTMLElement>('$rootElement')).toBe(element);
    expect(injector.has('$rootElement')).toBe(true);
  });

  it('without a seed, $rootElement is an unknown provider', () => {
    const injector = createInjector([createModule('app', [])]);
    expect(injector.has('$rootElement')).toBe(false);
    expect(() => injector.get<unknown>('$rootElement')).toThrow('Unknown provider: $rootElement');
  });

  it('passing an empty options object leaves $rootElement absent', () => {
    const injector = createInjector([createModule('app', [])], {});
    expect(injector.has('$rootElement')).toBe(false);
    expect(() => injector.get<unknown>('$rootElement')).toThrow('Unknown provider: $rootElement');
  });

  it('a seeded element is injectable into a run block as a dependency', () => {
    const element = document.createElement('section');
    let seen: unknown;
    const mod = createModule('app', []).value('marker', 'm');
    mod.run(['$rootElement', (el: unknown) => void (seen = el)]);
    createInjector([mod], { seed: { $rootElement: element } });
    expect(seen).toBe(element);
  });

  it('a seeded element is injectable into a factory as a dependency', () => {
    const element = document.createElement('main');
    const mod = createModule('app', []).factory('rootTag', [
      '$rootElement',
      (el: HTMLElement) => el.tagName.toLowerCase(),
    ]);
    const injector = createInjector([mod], { seed: { $rootElement: element } });
    expect(injector.get('rootTag')).toBe('main');
  });

  it('still self-seeds $injector regardless of the seed map', () => {
    const element = document.createElement('div');
    const withSeed = createInjector([createModule('seeded', [])], { seed: { $rootElement: element } });
    expect(withSeed.get('$injector')).toBe(withSeed);

    const withoutSeed = createInjector([createModule('plain', [])]);
    expect(withoutSeed.get('$injector')).toBe(withoutSeed);
  });

  it('does not disturb module-load order (deps load before dependents)', () => {
    const order: string[] = [];
    const base = createModule('base', []);
    base.run([() => void order.push('base')]);
    const app = createModule('app', ['base']);
    app.run([() => void order.push('app')]);
    const element = document.createElement('div');
    createInjector([app], { seed: { $rootElement: element } });
    expect(order).toEqual(['base', 'app']);
  });

  it('supports multiple seed entries', () => {
    const element = document.createElement('div');
    const token = { id: 1 };
    const injector = createInjector([createModule('app', [])], {
      seed: { $rootElement: element, $$customToken: token },
    });
    expect(injector.get<HTMLElement>('$rootElement')).toBe(element);
    expect(injector.get<typeof token>('$$customToken')).toBe(token);
  });
});
