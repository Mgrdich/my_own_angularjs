/**
 * DOM `bootstrap` entry point (spec 036 Slice 4 / FS + technical-considerations §2.6–2.9).
 *
 * Locks the page-start contract:
 *
 *  - The first compile + digest happens INSIDE `bootstrap`, so `{{ }}`
 *    interpolation has already rendered into the DOM by the time the call
 *    returns (no extra digest needed by the caller).
 *  - The return value is the bundled `{ injector, rootScope, rootElement }`
 *    handle; `rootScope` is the SAME reference as `injector.get('$rootScope')`.
 *  - `$rootElement` is seeded and injectable — `injector.get('$rootElement')`
 *    is the host element.
 *  - By default the host element does NOT carry an attached `$injector`;
 *    `attachToElement: true` opts into the attachment.
 *  - A second `bootstrap` against the same element throws
 *    `AlreadyBootstrappedError` synchronously.
 *  - A null/undefined target throws `BootstrapTargetMissingError` synchronously.
 *
 * The bootstrap path builds the full `ng` registry by referencing `ngModule`
 * by value, so no manual provider wiring is needed here — `resetRegistry`
 * only isolates the named user modules between tests.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { bootstrap } from '@bootstrap/bootstrap';
import { AlreadyBootstrappedError, BootstrapTargetMissingError } from '@bootstrap/bootstrap-error';
import { getAttachedInjector } from '@bootstrap/element-marker';
import type { Scope } from '@core/index';
import { createModule, resetRegistry } from '@di/module';

describe('bootstrap (DOM page start)', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('compiles and runs the first digest so interpolation renders before returning', () => {
    const appModule = createModule('app', []).run([
      '$rootScope',
      ($rootScope: Scope) => {
        ($rootScope as unknown as { name: string }).name = 'World';
      },
    ]);
    const element = document.createElement('div');
    element.innerHTML = '<p>Hello {{name}}</p>';

    bootstrap(element, [appModule]);

    expect(element.textContent).toBe('Hello World');
  });

  it('returns the bundled { injector, rootScope, rootElement } handle', () => {
    const element = document.createElement('div');
    const result = bootstrap(element, []);

    expect(typeof result.injector.get).toBe('function');
    expect(result.rootElement).toBe(element);
    expect(typeof (result.rootScope as unknown as { $apply: unknown }).$apply).toBe('function');
  });

  it('handle.rootScope === injector.get("$rootScope")', () => {
    const element = document.createElement('div');
    const { injector, rootScope } = bootstrap(element, []);

    expect(rootScope).toBe(injector.get<Scope>('$rootScope'));
  });

  it('seeds $rootElement so it is injectable and equals the host element', () => {
    const element = document.createElement('div');
    const { injector } = bootstrap(element, []);

    expect(injector.get<Element>('$rootElement')).toBe(element);
  });

  it('does NOT attach $injector to the element by default', () => {
    const element = document.createElement('div');
    bootstrap(element, []);

    expect(getAttachedInjector(element)).toBeUndefined();
  });

  it('attaches $injector to the element when attachToElement: true', () => {
    const element = document.createElement('div');
    const { injector } = bootstrap(element, [], { attachToElement: true });

    expect(getAttachedInjector(element)).toBe(injector);
  });

  it('throws AlreadyBootstrappedError on a second bootstrap of the same element', () => {
    const element = document.createElement('div');
    bootstrap(element, []);

    expect(() => bootstrap(element, [])).toThrow(AlreadyBootstrappedError);
    expect(() => bootstrap(element, [])).toThrow("App already bootstrapped with this element 'div'");
  });

  it('throws BootstrapTargetMissingError when the target is null', () => {
    expect(() => bootstrap(null, [])).toThrow(BootstrapTargetMissingError);
  });

  it('throws BootstrapTargetMissingError when the target is undefined', () => {
    expect(() => bootstrap(undefined, [])).toThrow(BootstrapTargetMissingError);
  });

  it('throws Module not found for an unregistered string-name module', () => {
    const element = document.createElement('div');
    expect(() => bootstrap(element, ['doesNotExist'])).toThrow('Module not found: doesNotExist');
  });
});
