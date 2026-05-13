/**
 * Foundation tests for the spec-020 controller error surface (Slice 1).
 *
 * Every one of the six error classes added to
 * `src/controller/controller-errors.ts` is exercised here: message
 * formatting (exact string match — the messages are part of the public
 * contract), the literal `name` discriminator that callers narrow on,
 * and the `instanceof Error` contract that catch sites rely on.
 *
 * Mirrors `src/compiler/__tests__/transclude-errors-foundation.test.ts`
 * one-to-one — same `describe(...)` / three-`it(...)` block per class.
 */

import { describe, expect, it } from 'vitest';

import {
  ControllerAsWithoutControllerError,
  ControllerRegistrationOutOfPhaseError,
  InvalidControllerFactoryError,
  InvalidControllerNameError,
  MalformedControllerAliasError,
  UnknownControllerError,
} from '@controller/controller-errors';

describe('ControllerRegistrationOutOfPhaseError', () => {
  it('formats the message with the offending provider method name', () => {
    const err = new ControllerRegistrationOutOfPhaseError('register');
    expect(err.message).toBe(
      '$controllerProvider.register is only callable during the config phase; calling it after the run phase begins is not supported',
    );
  });

  it('carries the literal `name` discriminator', () => {
    const err = new ControllerRegistrationOutOfPhaseError('register');
    expect(err.name).toBe('ControllerRegistrationOutOfPhaseError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new ControllerRegistrationOutOfPhaseError('register')).toBeInstanceOf(Error);
  });
});

describe('InvalidControllerNameError', () => {
  it('formats the message with the offending input and the rule recap', () => {
    const err = new InvalidControllerNameError('has space');
    expect(err.message).toBe(
      'Invalid controller name: has space (must be a non-empty string with no whitespace; "hasOwnProperty" is reserved)',
    );
  });

  it('carries the literal `name` discriminator', () => {
    const err = new InvalidControllerNameError('hasOwnProperty');
    expect(err.name).toBe('InvalidControllerNameError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new InvalidControllerNameError('')).toBeInstanceOf(Error);
  });
});

describe('InvalidControllerFactoryError', () => {
  it('formats the message with the controller name and the shape description', () => {
    const err = new InvalidControllerFactoryError('MyCtrl', 'null');
    expect(err.message).toBe('Invalid controller factory for "MyCtrl": null');
  });

  it('carries the literal `name` discriminator', () => {
    const err = new InvalidControllerFactoryError('<inline>', 'number');
    expect(err.name).toBe('InvalidControllerFactoryError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new InvalidControllerFactoryError('<inline>', 'empty array')).toBeInstanceOf(Error);
  });
});

describe('UnknownControllerError', () => {
  it('formats the message naming the missing controller', () => {
    const err = new UnknownControllerError('Greeter');
    expect(err.message).toBe('Unknown controller: Greeter');
  });

  it('carries the literal `name` discriminator', () => {
    const err = new UnknownControllerError('Greeter');
    expect(err.name).toBe('UnknownControllerError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new UnknownControllerError('Greeter')).toBeInstanceOf(Error);
  });
});

describe('MalformedControllerAliasError', () => {
  it('formats the message with the offending input quoted and the expected format recap', () => {
    const err = new MalformedControllerAliasError('Greeter as 123');
    expect(err.message).toBe(
      'Malformed controller alias: "Greeter as 123" — expected "Name as alias" where alias is a valid identifier',
    );
  });

  it('carries the literal `name` discriminator', () => {
    const err = new MalformedControllerAliasError('Greeter as ');
    expect(err.name).toBe('MalformedControllerAliasError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new MalformedControllerAliasError(' as vm')).toBeInstanceOf(Error);
  });
});

describe('ControllerAsWithoutControllerError', () => {
  it('formats the message naming the offending directive', () => {
    const err = new ControllerAsWithoutControllerError('myDir');
    expect(err.message).toBe(
      'Directive "myDir" declares controllerAs without a controller; both must be present together',
    );
  });

  it('carries the literal `name` discriminator', () => {
    const err = new ControllerAsWithoutControllerError('myDir');
    expect(err.name).toBe('ControllerAsWithoutControllerError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new ControllerAsWithoutControllerError('myDir')).toBeInstanceOf(Error);
  });
});
