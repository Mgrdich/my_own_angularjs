/**
 * Opt-in automatic page start (`autoBootstrap`) — spec 036 Slice 5 /
 * technical-considerations §2.7.
 *
 * `autoBootstrap(root?)` scans a region of the page for the FIRST element (in
 * document order) bearing one of the four `ng-app` attribute spellings —
 * `ng-app`, `data-ng-app`, `ng:app`, `x-ng-app` — and, if found, performs a
 * DOM page start on it via `bootstrap`, using the attribute value as the module
 * name. It is opt-in (only runs when called), first-in-document-order wins, and
 * is a silent no-op when nothing matches or there is no page.
 *
 * The observable signal in these tests is rendered interpolation: each user
 * module sets `$rootScope.name` in a run block and the markup is `{{name}}`, so
 * a successful start renders the value into the DOM by the time `autoBootstrap`
 * returns (the first compile + digest happens synchronously inside `bootstrap`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { autoBootstrap } from '@bootstrap/bootstrap';
import { AlreadyBootstrappedError } from '@bootstrap/bootstrap-error';
import type { Scope } from '@core/index';
import { createModule, resetRegistry } from '@di/module';

/**
 * Register a user module under `name` whose run block sets `$rootScope.name` to
 * `greeting`, so any element compiled against it renders `{{name}}` →
 * `greeting`.
 */
function registerGreetingModule(name: string, greeting: string): void {
  createModule(name, []).run([
    '$rootScope',
    ($rootScope: Scope) => {
      ($rootScope as unknown as { name: string }).name = greeting;
    },
  ]);
}

describe('autoBootstrap (ng-app scan)', () => {
  beforeEach(() => {
    resetRegistry();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  for (const attr of ['ng-app', 'data-ng-app', 'ng:app', 'x-ng-app'] as const) {
    it(`starts the app for the '${attr}' spelling`, () => {
      registerGreetingModule('app', 'World');
      const host = document.createElement('div');
      host.setAttribute(attr, 'app');
      host.innerHTML = '<p>Hello {{name}}</p>';
      document.body.appendChild(host);

      autoBootstrap();

      expect(host.textContent).toBe('Hello World');
    });
  }

  it('starts with just the framework modules when ng-app is empty', () => {
    const host = document.createElement('div');
    host.setAttribute('ng-app', '');
    host.innerHTML = '<p>{{1 + 1}}</p>';
    document.body.appendChild(host);

    autoBootstrap();

    expect(host.textContent).toBe('2');
  });

  it('first marker in document order wins; the rest are ignored', () => {
    registerGreetingModule('first', 'First');
    registerGreetingModule('second', 'Second');

    const a = document.createElement('div');
    a.setAttribute('ng-app', 'first');
    a.innerHTML = '<p>{{name}}</p>';

    const b = document.createElement('div');
    b.setAttribute('ng-app', 'second');
    b.innerHTML = '<p>{{name}}</p>';

    document.body.appendChild(a);
    document.body.appendChild(b);

    autoBootstrap();

    // Only the first marker started → only it rendered. The second stays inert
    // (its '{{name}}' is never compiled).
    expect(a.textContent).toBe('First');
    expect(b.textContent).toBe('{{name}}');
  });

  it('first-in-document-order wins across different spellings', () => {
    registerGreetingModule('early', 'Early');
    registerGreetingModule('late', 'Late');

    // Document order: x-ng-app element appears before the ng-app element.
    const first = document.createElement('div');
    first.setAttribute('x-ng-app', 'early');
    first.innerHTML = '<p>{{name}}</p>';

    const second = document.createElement('div');
    second.setAttribute('ng-app', 'late');
    second.innerHTML = '<p>{{name}}</p>';

    document.body.appendChild(first);
    document.body.appendChild(second);

    autoBootstrap();

    expect(first.textContent).toBe('Early');
    expect(second.textContent).toBe('{{name}}');
  });

  it('limits the scan to the passed root element', () => {
    registerGreetingModule('scoped', 'Scoped');

    const outside = document.createElement('div');
    outside.setAttribute('ng-app', 'scoped');
    outside.innerHTML = '<p>{{name}}</p>';
    document.body.appendChild(outside);

    const region = document.createElement('section');
    document.body.appendChild(region);

    // Scanning the empty region finds no marker → no-op; the outside marker is
    // untouched.
    autoBootstrap(region);

    expect(outside.textContent).toBe('{{name}}');
  });

  it('is a silent no-op when no marker matches', () => {
    const host = document.createElement('div');
    host.innerHTML = '<p>Hello {{name}}</p>';
    document.body.appendChild(host);

    expect(() => {
      autoBootstrap();
    }).not.toThrow();
    // Nothing compiled — the literal interpolation text is untouched.
    expect(host.textContent).toBe('Hello {{name}}');
  });

  it('is a silent no-op when document is undefined (non-browser)', () => {
    vi.stubGlobal('document', undefined);

    expect(() => {
      autoBootstrap();
    }).not.toThrow();
  });

  it('throws AlreadyBootstrappedError when scanning a region whose root is already bootstrapped', () => {
    registerGreetingModule('app', 'World');
    const host = document.createElement('div');
    host.setAttribute('ng-app', 'app');
    host.innerHTML = '<p>{{name}}</p>';
    document.body.appendChild(host);

    // First scan starts the app on `host`.
    autoBootstrap();
    expect(host.textContent).toBe('World');

    // A second scan re-finds the same marked element and re-bootstraps it →
    // the shared $$ngBootstrapped guard throws. The throw is intentionally NOT
    // suppressed.
    expect(() => {
      autoBootstrap();
    }).toThrow(AlreadyBootstrappedError);
  });

  it('forwards config to bootstrap (strictDi accepted, parity-only)', () => {
    registerGreetingModule('app', 'World');
    const host = document.createElement('div');
    host.setAttribute('ng-app', 'app');
    host.innerHTML = '<p>{{name}}</p>';
    document.body.appendChild(host);

    expect(() => {
      autoBootstrap(document, { strictDi: true });
    }).not.toThrow();
    expect(host.textContent).toBe('World');
  });
});
