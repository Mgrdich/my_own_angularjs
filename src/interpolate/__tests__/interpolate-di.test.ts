import { beforeEach, describe, expect, it } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { createInterpolate } from '@interpolate/interpolate';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import type { InterpolateFn, InterpolateService } from '@interpolate/interpolate-types';

describe('$interpolate DI integration — Slice 5', () => {
  // The `ng` module is registered at import time; a `resetRegistry()` in a
  // neighbouring test would evict it. Re-registering here keeps each test in
  // this file self-contained while still exercising `ngModule` by identity.
  beforeEach(() => {
    resetRegistry();
    createModule('ng', []).provider('$interpolate', $InterpolateProvider);
  });

  describe('basic resolution', () => {
    it('exposes $interpolate as a callable service via createInjector([ngModule])', () => {
      const injector = createInjector([ngModule]);
      const service = injector.get<InterpolateService>('$interpolate');
      expect(service).toBeTypeOf('function');
    });

    it('renders a template with the default {{ }} delimiters', () => {
      const injector = createInjector([ngModule]);
      const service = injector.get<InterpolateService>('$interpolate');
      expect(service('Hello {{name}}')({ name: 'Alice' })).toBe('Hello Alice');
    });

    it('exposes startSymbol() / endSymbol() getters on the DI-resolved service', () => {
      const injector = createInjector([ngModule]);
      const service = injector.get<InterpolateService>('$interpolate');
      expect(service.startSymbol()).toBe('{{');
      expect(service.endSymbol()).toBe('}}');
    });

    it('$interpolate service is a singleton across injector.get calls', () => {
      const injector = createInjector([ngModule]);
      const a = injector.get<InterpolateService>('$interpolate');
      const b = injector.get<InterpolateService>('$interpolate');
      expect(a).toBe(b);
    });
  });

  describe('provider access lifecycle', () => {
    it('resolving $interpolateProvider at run time throws (config-phase only)', () => {
      const injector = createInjector([ngModule]);
      // Providers are only injectable by `<name>Provider` during the config
      // phase (spec 008). The run-phase injector does not expose them, so a
      // direct `get('$interpolateProvider')` lookup throws "Unknown provider".
      expect(() => injector.get('$interpolateProvider')).toThrow(/Unknown provider: \$interpolateProvider/);
    });

    it('config block receives the provider instance and its mutations affect the produced service', () => {
      const appModule = createModule('app', ['ng']).config([
        '$interpolateProvider',
        (p: $InterpolateProvider) => {
          p.startSymbol('[[').endSymbol(']]');
        },
      ]);

      const injector = createInjector([appModule]);
      const service = injector.get<InterpolateService>('$interpolate');
      expect(service.startSymbol()).toBe('[[');
      expect(service.endSymbol()).toBe(']]');
      expect(service('Hi [[name]]')({ name: 'Bob' })).toBe('Hi Bob');
    });

    it('config block can configure start and end symbols independently', () => {
      const appModule = createModule('app', ['ng']).config([
        '$interpolateProvider',
        (p: $InterpolateProvider) => {
          p.startSymbol('<%').endSymbol('%>');
        },
      ]);

      const injector = createInjector([appModule]);
      const service = injector.get<InterpolateService>('$interpolate');
      expect(service('Value: <%x%>')({ x: 42 })).toBe('Value: 42');
    });
  });

  describe('metadata propagation through DI', () => {
    it('preserves the .oneTime flag on the compiled InterpolateFn', () => {
      const injector = createInjector([ngModule]);
      const service = injector.get<InterpolateService>('$interpolate');
      const fn: InterpolateFn = service('Hello {{::name}}');
      expect(fn.oneTime).toBe(true);
    });

    it('.oneTime is false for a non-one-time template resolved via DI', () => {
      const injector = createInjector([ngModule]);
      const service = injector.get<InterpolateService>('$interpolate');
      const fn: InterpolateFn = service('Hello {{name}}');
      expect(fn.oneTime).toBe(false);
    });

    it('exposes .exp and .expressions on the compiled fn', () => {
      const injector = createInjector([ngModule]);
      const service = injector.get<InterpolateService>('$interpolate');
      const fn: InterpolateFn = service('{{a}} and {{b}}');
      expect(fn.exp).toBe('{{a}} and {{b}}');
      expect(fn.expressions).toEqual(['a', 'b']);
    });
  });

  describe('parity: DI path vs ES-module path', () => {
    it('produces identical output for a representative template + context pair', () => {
      const injector = createInjector([ngModule]);
      const diService = injector.get<InterpolateService>('$interpolate');
      const esmService = createInterpolate();

      const template = 'Hello {{name}} — you are {{age}}';
      const context = { name: 'Eve', age: 30 };
      expect(diService(template)(context)).toBe(esmService(template)(context));
    });

    it('produces identical output for a one-time template', () => {
      const injector = createInjector([ngModule]);
      const diService = injector.get<InterpolateService>('$interpolate');
      const esmService = createInterpolate();

      const template = 'Hello {{::name}}';
      const context = { name: 'Eve' };
      expect(diService(template)(context)).toBe(esmService(template)(context));
    });

    it('produces identical output under custom delimiters configured two ways', () => {
      const appModule = createModule('app', ['ng']).config([
        '$interpolateProvider',
        (p: $InterpolateProvider) => {
          p.startSymbol('[[').endSymbol(']]');
        },
      ]);
      const injector = createInjector([appModule]);
      const diService = injector.get<InterpolateService>('$interpolate');
      const esmService = createInterpolate({ startSymbol: '[[', endSymbol: ']]' });

      const template = 'Hello [[name]] — age [[age]]';
      const context = { name: 'Eve', age: 30 };
      expect(diService(template)(context)).toBe(esmService(template)(context));
    });
  });
});
