import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Scope } from '@core/scope';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { createInterpolate } from '@interpolate/interpolate';
import type { InterpolateService } from '@interpolate/interpolate-types';

/**
 * Slice 6 — `$watch` routing for function-form oneTime watchers.
 *
 * These tests exercise the round-trip: `$interpolate(template)` produces an
 * `InterpolateFn` that, when passed to `scope.$watch`, must flow through the
 * spec-010 `oneTimeWatchDelegate` (scalar case) for all-`::` templates and
 * through the generic watcher path for mixed / non-`::` templates.
 */
describe('$interpolate + $watch integration — Slice 6', () => {
  const interpolate = createInterpolate();

  describe('(a) non-oneTime interpolation fires on rendered-string changes', () => {
    it('re-fires the listener each time the rendered string changes', () => {
      const scope = Scope.create<{ name: string }>();
      const fn = interpolate('Hello {{name}}');
      const listener = vi.fn();

      scope.$watch(fn, listener);

      scope.name = 'Alice';
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toBe('Hello Alice');

      scope.name = 'Bob';
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener.mock.calls[1]?.[0]).toBe('Hello Bob');

      // Watcher stays live across additional digests without mutations.
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(2);

      const registered = (scope.$$watchers ?? []).filter((w) => w !== null).length;
      expect(registered).toBe(1);
    });
  });

  describe('(b) all-`::` one-time interpolation deregisters after stabilization', () => {
    it('suppresses the listener while undefined, fires once when defined, then deregisters', () => {
      const scope = Scope.create<{ name?: string }>();
      const fn = interpolate('Hello {{::name}}');
      const listener = vi.fn();

      expect(fn.oneTime).toBe(true);

      scope.$watch(fn, listener);

      // First digest: name is undefined, template returns undefined.
      // oneTimeWatchDelegate fires the sentinel -> undefined transition once.
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toBeUndefined();

      // Still undefined -> no further fires, watcher stays live.
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(1);
      const stillRegistered = (scope.$$watchers ?? []).filter((w) => w !== null).length;
      expect(stillRegistered).toBe(1);

      // Define the value: listener fires with the rendered string,
      // watcher deregisters post-digest.
      scope.name = 'Alice';
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener.mock.calls[1]?.[0]).toBe('Hello Alice');

      const afterStabilization = (scope.$$watchers ?? []).filter((w) => w !== null).length;
      expect(afterStabilization).toBe(0);

      // Further changes are ignored by the now-deregistered watcher.
      scope.name = 'Bob';
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe('(c) multi-expression all-`::` stabilizes only when every expression is defined', () => {
    it('holds the watcher live until every embedded :: expression resolves', () => {
      const scope = Scope.create<{ a?: number; b?: number }>();
      const fn = interpolate('{{::a}} and {{::b}}');
      const listener = vi.fn();

      expect(fn.oneTime).toBe(true);

      scope.$watch(fn, listener);

      // First digest: both a,b undefined -> render returns undefined.
      // oneTimeWatchDelegate fires sentinel -> undefined transition once.
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toBeUndefined();

      // Only a defined: template still returns undefined (Slice 4 hold-back),
      // which is identical to the previous value -> no fire, watcher stays live.
      scope.a = 1;
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(1);
      const registeredMid = (scope.$$watchers ?? []).filter((w) => w !== null).length;
      expect(registeredMid).toBe(1);

      // Both defined: render returns '1 and 2', listener fires, watcher deregisters.
      scope.b = 2;
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener.mock.calls[1]?.[0]).toBe('1 and 2');

      const afterStabilization = (scope.$$watchers ?? []).filter((w) => w !== null).length;
      expect(afterStabilization).toBe(0);

      // Further changes to a are ignored.
      scope.a = 99;
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe('(d) mixed :: and non-:: expressions behave as non-oneTime', () => {
    it('keeps the watcher live indefinitely across repeated mutations', () => {
      const scope = Scope.create<{ a?: number; b?: number }>();
      const fn = interpolate('{{::a}} and {{b}}');
      const listener = vi.fn();

      expect(fn.oneTime).toBe(false);

      scope.$watch(fn, listener);

      scope.a = 1;
      scope.b = 2;
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toBe('1 and 2');

      scope.b = 3;
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener.mock.calls[1]?.[0]).toBe('1 and 3');

      scope.b = 4;
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(3);
      expect(listener.mock.calls[2]?.[0]).toBe('1 and 4');

      // Watcher remains registered — no one-time deregistration applies.
      const registered = (scope.$$watchers ?? []).filter((w) => w !== null).length;
      expect(registered).toBe(1);
    });
  });

  describe('(e) manual deregister before stabilization', () => {
    it('a deregister call before the first $digest prevents the listener from ever firing', () => {
      const scope = Scope.create<{ name?: string }>();
      const fn = interpolate('Hello {{::name}}');
      const listener = vi.fn();

      const deregister = scope.$watch(fn, listener);
      deregister();

      scope.name = 'Alice';
      scope.$digest();
      scope.name = 'Bob';
      scope.$digest();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('(f) DI-resolved $interpolate routes identically through oneTimeWatchDelegate', () => {
    beforeEach(() => {
      // Re-register ngModule's $interpolate provider on a fresh registry so
      // tests in this block are hermetic, matching the pattern in
      // interpolate-di.test.ts.
      resetRegistry();
      createModule('ng', []).provider('$interpolate', $InterpolateProvider);
    });

    it('(b) via DI — all-:: deregisters after stabilization', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get<InterpolateService>('$interpolate');
      const scope = Scope.create<{ name?: string }>();
      const fn = $interpolate('Hello {{::name}}');
      const listener = vi.fn();

      scope.$watch(fn, listener);

      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toBeUndefined();

      scope.name = 'Alice';
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener.mock.calls[1]?.[0]).toBe('Hello Alice');

      const after = (scope.$$watchers ?? []).filter((w) => w !== null).length;
      expect(after).toBe(0);

      scope.name = 'Bob';
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('(c) via DI — multi-expression all-:: stabilizes only when every expression resolves', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get<InterpolateService>('$interpolate');
      const scope = Scope.create<{ a?: number; b?: number }>();
      const fn = $interpolate('{{::a}} and {{::b}}');
      const listener = vi.fn();

      scope.$watch(fn, listener);

      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toBeUndefined();

      scope.a = 1;
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(1);

      scope.b = 2;
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener.mock.calls[1]?.[0]).toBe('1 and 2');

      const after = (scope.$$watchers ?? []).filter((w) => w !== null).length;
      expect(after).toBe(0);

      scope.a = 99;
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe('(g) all-literal interpolation watcher (no expressions, no ::) — parity with rootScopeSpec.js', () => {
    it('fires the listener once with the stable literal text and never again', () => {
      const scope = Scope.create();
      const fn = interpolate('Hello World');
      const listener = vi.fn();

      // A template with no embedded expressions is a constant string —
      // the listener should fire once on the sentinel -> stable transition
      // and then remain quiet across subsequent digests.
      scope.$watch(fn, listener);

      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toBe('Hello World');

      scope.$digest();
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('(h) two independent watchers on the same interpolation fn', () => {
    it('invokes each listener independently — $watch creates a fresh watcher per call', () => {
      const scope = Scope.create<{ name?: string }>();
      const fn = interpolate('Hello {{name}}');
      const listenerA = vi.fn();
      const listenerB = vi.fn();

      scope.$watch(fn, listenerA);
      scope.$watch(fn, listenerB);

      scope.name = 'Alice';
      scope.$digest();
      expect(listenerA).toHaveBeenCalledTimes(1);
      expect(listenerB).toHaveBeenCalledTimes(1);
      expect(listenerA.mock.calls[0]?.[0]).toBe('Hello Alice');
      expect(listenerB.mock.calls[0]?.[0]).toBe('Hello Alice');

      scope.name = 'Bob';
      scope.$digest();
      expect(listenerA).toHaveBeenCalledTimes(2);
      expect(listenerB).toHaveBeenCalledTimes(2);
    });
  });

  describe('(i) $watch with valueEq=true on an interpolation fn', () => {
    it('behaves identically to reference equality — interpolation output is always a primitive string', () => {
      // Interpolation output is a string (or undefined); for primitives,
      // value-equality and reference-equality are the same, so valueEq=true
      // passes through unchanged.
      const scope = Scope.create<{ name?: string }>();
      const fn = interpolate('Hello {{name}}');
      const listener = vi.fn();

      scope.$watch(fn, listener, true);

      scope.name = 'Alice';
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toBe('Hello Alice');

      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(1);

      scope.name = 'Bob';
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe('(j) deregister oneTime watcher DURING its listener callback', () => {
    it('tolerates a listener that invokes its own deregister without error and fires no further', () => {
      const scope = Scope.create<{ name?: string }>();
      const fn = interpolate('Hello {{::name}}');

      // Capture the deregister handle through a closure so the listener can
      // call it on the stabilization fire — this mirrors the rootScopeSpec.js
      // pattern of deregistering from inside a listener. The handle is
      // assigned before any digest runs, so reading it inside the listener
      // always sees the bound deregister fn.
      const handle: { deregister?: () => void } = {};
      const listener = vi.fn(() => {
        handle.deregister?.();
      });

      handle.deregister = scope.$watch(fn, listener);

      // First digest: name is undefined, sentinel -> undefined transition
      // fires once; listener deregisters its own watcher without error.
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(1);

      // Subsequent digests must not fire the listener even when the value
      // would otherwise change to a defined string.
      scope.name = 'Alice';
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(1);

      scope.name = 'Bob';
      scope.$digest();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('(k) rapid $evalAsync mutations within a single digest', () => {
    it('oneTime watcher stabilizes on the final post-settled value, not an intermediate one', () => {
      const scope = Scope.create<{ name?: string }>();
      const fn = interpolate('Hello {{::name}}');
      const listener = vi.fn();

      scope.$watch(fn, listener);

      // Queue several $evalAsync mutations that fire inside one digest —
      // the oneTime delegate must observe the settled value after the digest
      // loop drains, not any transient mid-loop value.
      scope.$evalAsync(() => {
        scope.name = 'First';
      });
      scope.$evalAsync(() => {
        scope.name = 'Second';
      });
      scope.$evalAsync(() => {
        scope.name = 'Final';
      });

      scope.$digest();

      // Listener fires once with the settled value; the watcher then
      // deregisters because the stable string is defined.
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toBe('Hello Final');

      const after = (scope.$$watchers ?? []).filter((w) => w !== null).length;
      expect(after).toBe(0);
    });
  });
});
