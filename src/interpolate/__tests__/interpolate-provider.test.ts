import { describe, expect, it } from 'vitest';

import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import type { InterpolateService } from '@interpolate/interpolate-types';

describe('$InterpolateProvider — Slice 5 (config-phase configurator)', () => {
  describe('default delimiters', () => {
    it('returns {{ as the default startSymbol', () => {
      const provider = new $InterpolateProvider();
      expect(provider.startSymbol()).toBe('{{');
    });

    it('returns }} as the default endSymbol', () => {
      const provider = new $InterpolateProvider();
      expect(provider.endSymbol()).toBe('}}');
    });
  });

  describe('fluent setters', () => {
    it('startSymbol(value) returns the provider instance for chaining', () => {
      const provider = new $InterpolateProvider();
      expect(provider.startSymbol('[[')).toBe(provider);
    });

    it('endSymbol(value) returns the provider instance for chaining', () => {
      const provider = new $InterpolateProvider();
      expect(provider.endSymbol(']]')).toBe(provider);
    });

    it('subsequent getter calls reflect the configured startSymbol', () => {
      const provider = new $InterpolateProvider();
      provider.startSymbol('[[');
      expect(provider.startSymbol()).toBe('[[');
    });

    it('subsequent getter calls reflect the configured endSymbol', () => {
      const provider = new $InterpolateProvider();
      provider.endSymbol(']]');
      expect(provider.endSymbol()).toBe(']]');
    });

    it('chained startSymbol + endSymbol call configures both', () => {
      const provider = new $InterpolateProvider().startSymbol('[[').endSymbol(']]');
      expect(provider.startSymbol()).toBe('[[');
      expect(provider.endSymbol()).toBe(']]');
    });
  });

  describe('validation (parity with createInterpolate rules)', () => {
    it('throws synchronously on empty startSymbol', () => {
      const provider = new $InterpolateProvider();
      expect(() => provider.startSymbol('')).toThrow(/startSymbol cannot be an empty string/);
    });

    it('throws synchronously on empty endSymbol', () => {
      const provider = new $InterpolateProvider();
      expect(() => provider.endSymbol('')).toThrow(/endSymbol cannot be an empty string/);
    });

    it('throws when startSymbol would equal the current endSymbol', () => {
      const provider = new $InterpolateProvider();
      // default endSymbol is '}}'; setting startSymbol to '}}' must fail.
      expect(() => provider.startSymbol('}}')).toThrow(/startSymbol and endSymbol must differ.*\}\}/);
    });

    it('throws when endSymbol would equal the current startSymbol', () => {
      const provider = new $InterpolateProvider();
      expect(() => provider.endSymbol('{{')).toThrow(/startSymbol and endSymbol must differ.*\{\{/);
    });

    it('throws when both setters are driven to identical symbols in sequence', () => {
      const provider = new $InterpolateProvider();
      provider.startSymbol('##').endSymbol(']]');
      // First reconfigure startSymbol away from default so the next call can attempt '##' for endSymbol.
      expect(() => provider.endSymbol('##')).toThrow(/startSymbol and endSymbol must differ.*##/);
    });

    it('leaves state unchanged when a setter throws', () => {
      const provider = new $InterpolateProvider();
      expect(() => provider.startSymbol('')).toThrow();
      expect(provider.startSymbol()).toBe('{{');
      expect(provider.endSymbol()).toBe('}}');
    });
  });

  describe('$get factory', () => {
    it('returns a configured $interpolate service when invoked', () => {
      const provider = new $InterpolateProvider();
      // Simulate what the injector does: unwrap the array-style invokable and call the trailing fn.
      const factory = provider.$get[0];
      const service: InterpolateService = factory();
      expect(service).toBeTypeOf('function');
      expect(service.startSymbol()).toBe('{{');
      expect(service.endSymbol()).toBe('}}');
    });

    it('produces a service whose delimiters match the configured symbols', () => {
      const provider = new $InterpolateProvider().startSymbol('[[').endSymbol(']]');
      const service: InterpolateService = provider.$get[0]();
      expect(service.startSymbol()).toBe('[[');
      expect(service.endSymbol()).toBe(']]');
    });

    it('produces a service that renders templates using the configured symbols', () => {
      const provider = new $InterpolateProvider().startSymbol('[[').endSymbol(']]');
      const service: InterpolateService = provider.$get[0]();
      expect(service('Hi [[name]]')({ name: 'Bob' })).toBe('Hi Bob');
    });

    it('$get is a readonly array-style invokable with zero deps', () => {
      const provider = new $InterpolateProvider();
      // Array-style invokable with no deps — trailing element is the factory.
      expect(provider.$get).toHaveLength(1);
      expect(provider.$get[0]).toBeTypeOf('function');
    });
  });
});
