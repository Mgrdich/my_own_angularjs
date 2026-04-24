/**
 * Slice 6 (spec 012) — `$interpolate` × `$sce` integration.
 *
 * These tests exercise the activation path for the `trustedContext`
 * argument: when both SCE callbacks are wired AND strict mode is ON, the
 * interpolation compile step enforces the single-binding rule and the
 * render step routes the evaluated value through `$sce.getTrusted` before
 * stringification. The graceful-degradation path (no callbacks supplied or
 * strict mode disabled) is verified here too so the spec-011 contract for
 * the pure-ESM factory remains a no-op.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { createInterpolate } from '@interpolate/interpolate';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import type { InterpolateService } from '@interpolate/interpolate-types';
import { sce } from '@sce/sce';
import type { SceContext, SceService } from '@sce/sce-types';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';

describe('$interpolate ↔ $sce integration — Slice 6', () => {
  describe('DI path — strict mode ON (default)', () => {
    beforeEach(() => {
      resetRegistry();
      createModule('ng', [])
        .provider('$sceDelegate', $SceDelegateProvider)
        .provider('$sce', $SceProvider)
        .provider('$interpolate', $InterpolateProvider);
    });

    it('renders a single {{expr}} template in html context when the scope value is TrustedHtml', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get<InterpolateService>('$interpolate');
      const $sce = injector.get<SceService>('$sce');

      const fn = $interpolate('{{trustedValue}}', false, 'html');
      const scope = { trustedValue: $sce.trustAsHtml('<p>x</p>') };
      expect(fn(scope)).toBe('<p>x</p>');
    });

    it('throws at compile time when a trusted context has a literal prefix', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get<InterpolateService>('$interpolate');

      expect(() => $interpolate('Hello {{trustedValue}}', false, 'html')).toThrow(
        /interpolations in trusted contexts must have exactly one \{\{expression\}\}/,
      );
      expect(() => $interpolate('Hello {{trustedValue}}', false, 'html')).toThrow(/html/);
      expect(() => $interpolate('Hello {{trustedValue}}', false, 'html')).toThrow(/Hello \{\{trustedValue\}\}/);
    });

    it('throws at compile time when a trusted context has a literal suffix', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get<InterpolateService>('$interpolate');

      expect(() => $interpolate('{{trustedValue}} suffix', false, 'html')).toThrow(
        /interpolations in trusted contexts must have exactly one \{\{expression\}\}/,
      );
    });

    it('throws at compile time when a trusted context contains two adjacent expressions', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get<InterpolateService>('$interpolate');

      expect(() => $interpolate('{{a}}{{b}}', false, 'html')).toThrow(
        /interpolations in trusted contexts must have exactly one \{\{expression\}\}/,
      );
    });

    it('throws at compile time when a trusted context has multiple expressions separated by a literal', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get<InterpolateService>('$interpolate');

      expect(() => $interpolate('{{a}} {{b}}', false, 'html')).toThrow(
        /interpolations in trusted contexts must have exactly one \{\{expression\}\}/,
      );
    });

    it('throws at render time when a plain (untrusted) string is used in an html context', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get<InterpolateService>('$interpolate');

      const fn = $interpolate('{{x}}', false, 'html');
      expect(() => fn({ x: 'untrusted' })).toThrow(/html/);
    });

    it('throws at render time when a mismatched trust wrapper is used in an html context', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get<InterpolateService>('$interpolate');
      const $sce = injector.get<SceService>('$sce');

      const fn = $interpolate('{{x}}', false, 'html');
      expect(() => fn({ x: $sce.trustAsUrl('y') })).toThrow(/html/);
    });
  });

  describe('DI path — literal-only templates in a trusted context', () => {
    beforeEach(() => {
      resetRegistry();
      createModule('ng', [])
        .provider('$sceDelegate', $SceDelegateProvider)
        .provider('$sce', $SceProvider)
        .provider('$interpolate', $InterpolateProvider);
    });

    it('allows a template with no expressions — literal text passes through untouched', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get<InterpolateService>('$interpolate');

      expect($interpolate('Hello world', false, 'html')({})).toBe('Hello world');
    });

    it('allows an empty template (spec-011 behavior — empty string rendered)', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get<InterpolateService>('$interpolate');

      // No expressions → compile-time single-binding check does not trigger;
      // renders to the literal empty string per spec-011.
      expect($interpolate('', false, 'html')({})).toBe('');
    });
  });

  describe('DI path — strict mode OFF via $sceProvider.enabled(false)', () => {
    beforeEach(() => {
      resetRegistry();
      createModule('ng', [])
        .provider('$sceDelegate', $SceDelegateProvider)
        .provider('$sce', $SceProvider)
        .provider('$interpolate', $InterpolateProvider);
    });

    it('bypasses the compile-time single-binding check', () => {
      const appModule = createModule('app', ['ng']).config([
        '$sceProvider',
        (p) => {
          p.enabled(false);
        },
      ]);
      const injector = createInjector([appModule]);
      const $interpolate = injector.get<InterpolateService>('$interpolate');

      expect($interpolate('Hello {{name}}', false, 'html')({ name: 'Bob' })).toBe('Hello Bob');
    });

    it('allows multiple expressions in a would-be-trusted template when strict is off', () => {
      const appModule = createModule('app', ['ng']).config([
        '$sceProvider',
        (p) => {
          p.enabled(false);
        },
      ]);
      const injector = createInjector([appModule]);
      const $interpolate = injector.get<InterpolateService>('$interpolate');

      expect($interpolate('{{a}} {{b}}', false, 'html')({ a: 1, b: 2 })).toBe('1 2');
    });

    it('skips the render-time trust lookup — plain strings render unchanged', () => {
      const appModule = createModule('app', ['ng']).config([
        '$sceProvider',
        (p) => {
          p.enabled(false);
        },
      ]);
      const injector = createInjector([appModule]);
      const $interpolate = injector.get<InterpolateService>('$interpolate');

      expect($interpolate('{{x}}', false, 'html')({ x: 'plain' })).toBe('plain');
    });
  });

  describe('DI path — invalid trustedContext argument', () => {
    beforeEach(() => {
      resetRegistry();
      createModule('ng', [])
        .provider('$sceDelegate', $SceDelegateProvider)
        .provider('$sce', $SceProvider)
        .provider('$interpolate', $InterpolateProvider);
    });

    it('throws synchronously for an unrecognized context string', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get<InterpolateService>('$interpolate');

      expect(() => $interpolate('{{x}}', false, 'bogus' as unknown as SceContext)).toThrow(/bogus/);
    });

    it('rejects the internal $$ANY$$ sentinel — not reachable via the façade', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get<InterpolateService>('$interpolate');

      expect(() => $interpolate('{{x}}', false, '$$ANY$$' as unknown as SceContext)).toThrow(/\$\$ANY\$\$/);
    });
  });

  describe('DI path — interactions with mustHaveExpression / allOrNothing / oneTime', () => {
    beforeEach(() => {
      resetRegistry();
      createModule('ng', [])
        .provider('$sceDelegate', $SceDelegateProvider)
        .provider('$sce', $SceProvider)
        .provider('$interpolate', $InterpolateProvider);
    });

    it('mustHaveExpression wins on a literal-only trusted-context template (returns undefined, no throw)', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get<InterpolateService>('$interpolate');

      // No expressions → the single-binding check does NOT fire (nothing to
      // sanitize), and mustHaveExpression=true short-circuits to `undefined`.
      expect($interpolate('literal text', true, 'html')).toBeUndefined();
    });

    it('allOrNothing=true with a defined trusted value renders the unwrapped value', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get<InterpolateService>('$interpolate');
      const $sce = injector.get<SceService>('$sce');

      const fn = $interpolate('{{x}}', false, 'html', true);
      expect(fn({ x: $sce.trustAsHtml('v') })).toBe('v');
    });

    it('allOrNothing=true with an undefined scope value returns undefined (no render-time trust throw)', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get<InterpolateService>('$interpolate');

      const fn = $interpolate('{{x}}', false, 'html', true);
      // `$sce.getTrusted` on `undefined` returns `undefined` (pass-through per
      // spec-012 slice 3); allOrNothing then triggers the undefined hold-back.
      expect(fn({ x: undefined })).toBeUndefined();
    });

    it('one-time :: binding renders after the scope value is defined', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get<InterpolateService>('$interpolate');
      const $sce = injector.get<SceService>('$sce');

      const fn = $interpolate('{{::x}}', false, 'html');

      // Before the scope settles: undefined passes through getTrusted
      // (per slice-3 null/undefined rule) and oneTime hold-back returns
      // undefined.
      expect(fn({ x: undefined })).toBeUndefined();

      // After the value is defined with a trusted wrapper, renders the
      // unwrapped string.
      expect(fn({ x: $sce.trustAsHtml('late') })).toBe('late');
    });
  });

  describe('pure-ESM wiring path — createInterpolate + sce defaults', () => {
    it('matches the DI path for a valid trusted value', () => {
      const interp = createInterpolate({
        sceGetTrusted: (ctx, v) => sce.getTrusted(ctx, v),
        sceIsEnabled: () => sce.isEnabled(),
      });
      const fn = interp('{{x}}', false, 'html');
      expect(fn({ x: sce.trustAsHtml('ok') })).toBe('ok');
    });

    it('throws at compile time for a multi-binding template — same shape as the DI path', () => {
      const interp = createInterpolate({
        sceGetTrusted: (ctx, v) => sce.getTrusted(ctx, v),
        sceIsEnabled: () => sce.isEnabled(),
      });
      expect(() => interp('Hello {{x}}', false, 'html')).toThrow(
        /interpolations in trusted contexts must have exactly one \{\{expression\}\}/,
      );
    });

    it('throws at render time for a plain-string value — same shape as the DI path', () => {
      const interp = createInterpolate({
        sceGetTrusted: (ctx, v) => sce.getTrusted(ctx, v),
        sceIsEnabled: () => sce.isEnabled(),
      });
      const fn = interp('{{x}}', false, 'html');
      expect(() => fn({ x: 'plain' })).toThrow(/html/);
    });
  });

  describe('pure-ESM wiring path — createInterpolate() with no SCE callbacks (graceful no-op)', () => {
    it('accepts trustedContext as a no-op when neither callback is supplied — preserves spec-011 regression path', () => {
      const interpNoSce = createInterpolate();
      // Literal text + plain string value — strict mode would reject this,
      // but with no callbacks wired, enforcement is skipped entirely.
      expect(interpNoSce('Hello {{x}}', false, 'html')({ x: 'plain' })).toBe('Hello plain');
    });

    it('does not throw even when the template has multiple expressions and a trusted context is named', () => {
      const interpNoSce = createInterpolate();
      expect(interpNoSce('{{a}} {{b}}', false, 'html')({ a: 1, b: 2 })).toBe('1 2');
    });
  });

  describe('$sce singleton integration — enabled flag shared with $interpolate', () => {
    beforeEach(() => {
      resetRegistry();
      createModule('ng', [])
        .provider('$sceDelegate', $SceDelegateProvider)
        .provider('$sce', $SceProvider)
        .provider('$interpolate', $InterpolateProvider);
    });

    it('a config-time $sceProvider.enabled(false) is observed by the DI-resolved $interpolate', () => {
      const appModule = createModule('app', ['ng']).config([
        '$sceProvider',
        (p) => {
          p.enabled(false);
        },
      ]);
      const injector = createInjector([appModule]);
      const $sce = injector.get<SceService>('$sce');
      const $interpolate = injector.get<InterpolateService>('$interpolate');

      expect($sce.isEnabled()).toBe(false);
      // Since strict is OFF, the single-binding check is bypassed and the
      // render-time trust lookup becomes a pass-through — proving $interpolate
      // observes the same $sce instance that was configured.
      expect($interpolate('Hello {{name}}', false, 'html')({ name: 'Bob' })).toBe('Hello Bob');
    });
  });
});
