/**
 * Unit tests for the compiler's typed error classes.
 *
 * Mirrors `src/filter/__tests__/...` shape: instantiate each class,
 * assert exact message format, the `name` discriminator, and that
 * each class is `instanceof Error` for catch-site narrowing.
 */

import { describe, expect, it } from 'vitest';

import {
  InvalidDirectiveFactoryError,
  InvalidDirectiveNameError,
  IsolateScopeNotSupportedError,
} from '@compiler/compile-error';

describe('InvalidDirectiveNameError', () => {
  it('formats the message with the offending directive name', () => {
    const err = new InvalidDirectiveNameError('foo bar');
    expect(err.message).toBe('Invalid directive name: foo bar');
  });

  it('carries the literal `name` discriminator', () => {
    const err = new InvalidDirectiveNameError('1bad');
    expect(err.name).toBe('InvalidDirectiveNameError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new InvalidDirectiveNameError('foo bar')).toBeInstanceOf(Error);
  });
});

describe('InvalidDirectiveFactoryError', () => {
  it('formats the message with the directive name whose factory was invalid', () => {
    const err = new InvalidDirectiveFactoryError('myDir');
    expect(err.message).toBe('Invalid directive factory for myDir');
  });

  it('carries the literal `name` discriminator', () => {
    const err = new InvalidDirectiveFactoryError('myDir');
    expect(err.name).toBe('InvalidDirectiveFactoryError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new InvalidDirectiveFactoryError('myDir')).toBeInstanceOf(Error);
  });
});

describe('IsolateScopeNotSupportedError', () => {
  it('formats the message naming the offending directive', () => {
    const err = new IsolateScopeNotSupportedError('myDir');
    expect(err.message).toBe(
      'Isolate scope is not yet supported (spec 017 ships only scope: false | true). Directive: myDir',
    );
  });

  it('carries the literal `name` discriminator', () => {
    const err = new IsolateScopeNotSupportedError('myDir');
    expect(err.name).toBe('IsolateScopeNotSupportedError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new IsolateScopeNotSupportedError('myDir')).toBeInstanceOf(Error);
  });
});
