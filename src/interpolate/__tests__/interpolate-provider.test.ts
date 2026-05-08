import { describe, expect, it } from 'vitest';

import { consoleErrorExceptionHandler, type ExceptionHandler } from '@exception-handler/index';
import { FilterLookupError } from '@filter/filter-error';
import type { FilterFn, FilterService } from '@filter/filter-types';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import type { InterpolateService } from '@interpolate/interpolate-types';
import { sce } from '@sce/sce';
import type { SceService } from '@sce/sce-types';

// Stub `$filter` for unit tests: the bare `$InterpolateProvider` has no
// injector context, so we simulate the run-phase service with a closure that
// throws `FilterLookupError` for any name (no filters registered in unit
// tests). Tests that exercise actual filter resolution live in integration
// tests under `src/filter/__tests__/`.
const stubFilter: FilterService = (name: string): FilterFn => {
  throw new FilterLookupError(name);
};

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
    // Spec 012 slice 6 added `$sce`, spec 014 slice 7 added `$exceptionHandler`,
    // and spec 016 slice 4 added `$filter` as deps on `$get`, so the factory is
    // the FOURTH element of the array. Unit tests here simulate the injector by
    // passing in the ESM `sce` default instance, the default console-error
    // exception handler, and a stub `$filter` directly.
    const invokeFactory = (
      provider: $InterpolateProvider,
      $sce: SceService = sce,
      $exceptionHandler: ExceptionHandler = consoleErrorExceptionHandler,
      $filter: FilterService = stubFilter,
    ): InterpolateService => {
      const factory = provider.$get[3];
      return factory($sce, $exceptionHandler, $filter);
    };

    it('returns a configured $interpolate service when invoked', () => {
      const provider = new $InterpolateProvider();
      const service = invokeFactory(provider);
      expect(service).toBeTypeOf('function');
      expect(service.startSymbol()).toBe('{{');
      expect(service.endSymbol()).toBe('}}');
    });

    it('produces a service whose delimiters match the configured symbols', () => {
      const provider = new $InterpolateProvider().startSymbol('[[').endSymbol(']]');
      const service = invokeFactory(provider);
      expect(service.startSymbol()).toBe('[[');
      expect(service.endSymbol()).toBe(']]');
    });

    it('produces a service that renders templates using the configured symbols', () => {
      const provider = new $InterpolateProvider().startSymbol('[[').endSymbol(']]');
      const service = invokeFactory(provider);
      expect(service('Hi [[name]]')({ name: 'Bob' })).toBe('Hi Bob');
    });

    it('$get is a readonly array-style invokable declaring $sce, $exceptionHandler, and $filter as deps', () => {
      const provider = new $InterpolateProvider();
      // Array-style invokable with three deps — leading elements are dep names,
      // trailing element is the factory.
      expect(provider.$get).toHaveLength(4);
      expect(provider.$get[0]).toBe('$sce');
      expect(provider.$get[1]).toBe('$exceptionHandler');
      expect(provider.$get[2]).toBe('$filter');
      expect(provider.$get[3]).toBeTypeOf('function');
    });
  });
});
