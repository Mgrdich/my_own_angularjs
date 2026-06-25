import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { bootstrapInjector } from '@bootstrap/bootstrap';
import { createModule, resetRegistry } from '@di/module';
import type { SceService } from '@sce/sce-types';

describe('bootstrapInjector (headless)', () => {
  beforeEach(() => {
    // `bootstrapInjector` references `ngModule` by value (not via the registry),
    // so a cleared registry does not remove the framework built-ins. Resetting
    // here only guarantees isolation between tests that register named modules.
    resetRegistry();
  });

  it('resolves a framework built-in service (`$sce`) without the caller listing `ng`', () => {
    const injector = bootstrapInjector([]);
    const sce = injector.get('$sce');
    expect(typeof sce.trustAsHtml).toBe('function');
    expect(sce.isEnabled()).toBe(true);
  });

  it("resolves a user module's registered service (object form)", () => {
    const appModule = createModule('app', []).value('apiUrl', '/api');
    const injector = bootstrapInjector([appModule]);
    expect(injector.get('apiUrl')).toBe('/api');
    // Framework built-ins are still reachable alongside the user module.
    expect(typeof injector.get('$sce').trustAsHtml).toBe('function');
  });

  it('resolves a module passed by its registered string name', () => {
    createModule('strApp', []).value('greeting', 'hello');
    const injector = bootstrapInjector(['strApp']);
    expect(injector.get<string>('greeting')).toBe('hello');
  });

  it('accepts a mix of object and string module entries', () => {
    const objModule = createModule('objApp', []).value('fromObject', 1);
    createModule('strApp2', []).value('fromString', 2);
    const injector = bootstrapInjector([objModule, 'strApp2']);
    expect(injector.get('fromObject')).toBe(1);
    expect(injector.get<number>('fromString')).toBe(2);
  });

  it('throws `Module not found` for an unregistered module name', () => {
    expect(() => bootstrapInjector(['doesNotExist'])).toThrow('Module not found: doesNotExist');
  });

  it('defaults `strictDi` to true with no behavioral change', () => {
    const injector = bootstrapInjector([], {});
    expect(typeof injector.get('$sce').trustAsHtml).toBe('function');
  });

  it('still rejects an un-annotated factory when `strictDi: false` (parity-only, no relax)', () => {
    // A bare factory function with no `$inject` and no array annotation is
    // rejected by the injector's `annotate` — `strictDi: false` does NOT
    // enable a source-parsing fallback.
    const badModule = createModule('badApp', [])
      .value('dep', 1)
      .factory('broken', function broken(dep: number) {
        return dep;
      });
    const injector = bootstrapInjector([badModule], { strictDi: false });
    expect(() => injector.get<number>('broken')).toThrow();
  });

  it('does not access the DOM', () => {
    const docSpy = vi.spyOn(globalThis, 'document', 'get');
    const appModule = createModule('noDomApp', []).value('x', 42);
    const injector = bootstrapInjector([appModule]);
    expect(injector.get('x')).toBe(42);
    expect(docSpy).not.toHaveBeenCalled();
    docSpy.mockRestore();
  });

  it('narrows `.get("$sce")` to the framework service type', () => {
    const injector = bootstrapInjector([]);
    expectTypeOf(injector.get('$sce')).toEqualTypeOf<SceService>();
  });

  it("narrows a user module's value type from the object entry", () => {
    const appModule = createModule('typedApp', []).value('count', 7);
    const injector = bootstrapInjector([appModule]);
    expectTypeOf(injector.get('count')).toEqualTypeOf<number>();
  });

  it('returns a handle exposing the `Injector` surface (`get` / `has` / `invoke`)', () => {
    const injector = bootstrapInjector([]);
    expectTypeOf(injector).toHaveProperty('get');
    expectTypeOf(injector).toHaveProperty('has');
    expectTypeOf(injector).toHaveProperty('invoke');
    expect(typeof injector.has).toBe('function');
    expect(injector.has('$sce')).toBe(true);
    expect(injector.has('nope')).toBe(false);
  });
});
