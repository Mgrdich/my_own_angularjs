/**
 * Foundation tests for the spec-018 transclusion surface (Slice 1).
 *
 * Two concerns covered:
 *
 * 1. **Error-class instantiation** — every one of the nine new error
 *    classes added to `compile-error.ts` is exercised: message
 *    formatting, the literal `name` discriminator, and the
 *    `instanceof Error` narrowing contract that callers rely on at
 *    catch sites. Mirrors `compile-error.test.ts`'s shape exactly.
 *
 * 2. **`LinkFn` / `CompileFn` type widening** — TypeScript
 *    function-parameter subtyping must keep the spec-017-canonical
 *    3-arg `LinkFn` and 2-arg `CompileFn` assignable to the widened
 *    types. The block instantiates 3 / 4 / 5-arg link variants and 2 /
 *    3-arg compile variants against the widened type aliases. The
 *    runtime assertions just observe that each function is called once
 *    — the real verification is that `pnpm typecheck` passes.
 */

import { describe, expect, it, vi } from 'vitest';

import { Scope } from '@core/index';
import {
  DuplicateTranscludeSelectorError,
  ElementTranscludeNotSupportedError,
  InvalidTranscludeSelectorError,
  InvalidTranscludeSlotNameError,
  InvalidTranscludeValueError,
  MultipleTranscludeDirectivesError,
  NgTranscludeMisuseError,
  RequiredTranscludeSlotUnfilledError,
  UndeclaredTranscludeSlotError,
} from '@compiler/compile-error';
import type { Attributes, CompileFn, LinkFn, TranscludeFn } from '@compiler/index';

describe('InvalidTranscludeValueError', () => {
  it('formats the message with the directive name and a description', () => {
    const err = new InvalidTranscludeValueError('myDir', 'number is not assignable');
    expect(err.message).toBe('Invalid transclude value for directive myDir: number is not assignable');
  });

  it('carries the literal `name` discriminator', () => {
    const err = new InvalidTranscludeValueError('myDir', 'x');
    expect(err.name).toBe('InvalidTranscludeValueError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new InvalidTranscludeValueError('myDir', 'x')).toBeInstanceOf(Error);
  });
});

describe('ElementTranscludeNotSupportedError', () => {
  it('formats the message naming the offending directive', () => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- shape test for the spec-018-retired class; the class is exported with @deprecated for a one-release grace period (spec 027 Slice 2)
    const err = new ElementTranscludeNotSupportedError('myDir');
    expect(err.message).toBe(
      `Element transclusion (transclude: 'element') is not yet supported; this spec ships only transclude: true and the multi-slot object form. Directive: myDir`,
    );
  });

  it('carries the literal `name` discriminator', () => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- shape test for the spec-018-retired class; the class is exported with @deprecated for a one-release grace period (spec 027 Slice 2)
    const err = new ElementTranscludeNotSupportedError('myDir');
    expect(err.name).toBe('ElementTranscludeNotSupportedError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- shape test for the spec-018-retired class; the class is exported with @deprecated for a one-release grace period (spec 027 Slice 2)
    expect(new ElementTranscludeNotSupportedError('myDir')).toBeInstanceOf(Error);
  });
});

describe('DuplicateTranscludeSelectorError', () => {
  it('formats the message with the directive name and selector', () => {
    const err = new DuplicateTranscludeSelectorError('myDir', 'card-title');
    expect(err.message).toBe('Duplicate transclude selector "card-title" in directive myDir');
  });

  it('carries the literal `name` discriminator', () => {
    const err = new DuplicateTranscludeSelectorError('myDir', 'card-title');
    expect(err.name).toBe('DuplicateTranscludeSelectorError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new DuplicateTranscludeSelectorError('myDir', 'card-title')).toBeInstanceOf(Error);
  });
});

describe('InvalidTranscludeSlotNameError', () => {
  it('formats the message with the directive name and offending key', () => {
    const err = new InvalidTranscludeSlotNameError('myDir', '1bad');
    expect(err.message).toBe('Invalid transclusion slot name "1bad" in directive myDir');
  });

  it('carries the literal `name` discriminator', () => {
    const err = new InvalidTranscludeSlotNameError('myDir', '1bad');
    expect(err.name).toBe('InvalidTranscludeSlotNameError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new InvalidTranscludeSlotNameError('myDir', '1bad')).toBeInstanceOf(Error);
  });
});

describe('InvalidTranscludeSelectorError', () => {
  it('formats the message with the directive name and slot key', () => {
    const err = new InvalidTranscludeSelectorError('myDir', 'titleSlot');
    expect(err.message).toBe('Invalid transclusion selector for slot "titleSlot" in directive myDir');
  });

  it('carries the literal `name` discriminator', () => {
    const err = new InvalidTranscludeSelectorError('myDir', 'titleSlot');
    expect(err.name).toBe('InvalidTranscludeSelectorError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new InvalidTranscludeSelectorError('myDir', 'titleSlot')).toBeInstanceOf(Error);
  });
});

describe('MultipleTranscludeDirectivesError', () => {
  it('formats the message with both directive names and the "first wins" wording', () => {
    const err = new MultipleTranscludeDirectivesError('dirA', 'dirB');
    expect(err.message).toBe(
      'Multiple directives requesting transclusion on the same element: "dirA" and "dirB". Only the first wins; "dirB"\'s transclude is ignored.',
    );
  });

  it('carries the literal `name` discriminator', () => {
    const err = new MultipleTranscludeDirectivesError('dirA', 'dirB');
    expect(err.name).toBe('MultipleTranscludeDirectivesError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new MultipleTranscludeDirectivesError('dirA', 'dirB')).toBeInstanceOf(Error);
  });
});

describe('RequiredTranscludeSlotUnfilledError', () => {
  it('formats the message with the directive name, slot name, and selector', () => {
    const err = new RequiredTranscludeSlotUnfilledError('myCard', 'titleSlot', 'card-title');
    expect(err.message).toBe(
      'Required transclusion slot "titleSlot" expected one or more elements matching "card-title", got none (directive myCard)',
    );
  });

  it('carries the literal `name` discriminator', () => {
    const err = new RequiredTranscludeSlotUnfilledError('myCard', 'titleSlot', 'card-title');
    expect(err.name).toBe('RequiredTranscludeSlotUnfilledError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new RequiredTranscludeSlotUnfilledError('myCard', 'titleSlot', 'card-title')).toBeInstanceOf(Error);
  });
});

describe('UndeclaredTranscludeSlotError', () => {
  it('formats the message with the directive name and unknown slot name', () => {
    const err = new UndeclaredTranscludeSlotError('myCard', 'noSuchSlot');
    expect(err.message).toBe('No transclusion slot "noSuchSlot" declared on directive myCard');
  });

  it('carries the literal `name` discriminator', () => {
    const err = new UndeclaredTranscludeSlotError('myCard', 'noSuchSlot');
    expect(err.name).toBe('UndeclaredTranscludeSlotError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new UndeclaredTranscludeSlotError('myCard', 'noSuchSlot')).toBeInstanceOf(Error);
  });
});

describe('NgTranscludeMisuseError', () => {
  it('passes the misuse reason verbatim as the message (no-enclosing-host variant)', () => {
    const err = new NgTranscludeMisuseError(
      'ngTransclude must be used inside a directive declaring transclude: true | { … }',
    );
    expect(err.message).toBe('ngTransclude must be used inside a directive declaring transclude: true | { … }');
  });

  it('passes the misuse reason verbatim (named-slot-under-content variant)', () => {
    const err = new NgTranscludeMisuseError(
      'Slot "titleSlot" is not declared; transclude: true exposes only the default slot',
    );
    expect(err.message).toBe('Slot "titleSlot" is not declared; transclude: true exposes only the default slot');
  });

  it('carries the literal `name` discriminator', () => {
    const err = new NgTranscludeMisuseError('any reason');
    expect(err.name).toBe('NgTranscludeMisuseError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new NgTranscludeMisuseError('any reason')).toBeInstanceOf(Error);
  });
});

describe('LinkFn/CompileFn type widening', () => {
  /**
   * Build a minimal `Attributes` stand-in for the type-widening
   * assertions below. We never read any properties from it; the
   * spies just need to be invoked with the correct shape so the
   * widened signatures are exercised at runtime in addition to type
   * level.
   */
  function makeAttrs(): Attributes {
    return {
      $attr: {},
      $set: () => undefined,
      $observe: () => () => undefined,
    } as Attributes;
  }

  function makeElement(): Element {
    // The vitest environment is jsdom, so `document` is globally
    // available without needing to construct a JSDOM instance.
    return document.createElement('div');
  }

  const noopTransclude: TranscludeFn = () => [];

  it('accepts a spec-017-canonical 3-arg LinkFn against the widened type', () => {
    const spy = vi.fn();
    const link3: LinkFn = (scope, element, attrs) => {
      spy(scope, element, attrs);
    };
    const scope = Scope.create();
    const element = makeElement();
    const attrs = makeAttrs();
    link3(scope, element, attrs);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('accepts a 4-arg LinkFn with `controllers: undefined` against the widened type', () => {
    const spy = vi.fn();
    const link4: LinkFn = (scope, element, attrs, controllers) => {
      spy(scope, element, attrs, controllers);
    };
    const scope = Scope.create();
    const element = makeElement();
    const attrs = makeAttrs();
    link4(scope, element, attrs, undefined);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[3]).toBeUndefined();
  });

  it('accepts a 5-arg LinkFn with `$transclude: TranscludeFn` against the widened type', () => {
    const spy = vi.fn();
    const link5: LinkFn = (scope, element, attrs, controllers, $transclude) => {
      spy(scope, element, attrs, controllers, $transclude);
    };
    const scope = Scope.create();
    const element = makeElement();
    const attrs = makeAttrs();
    link5(scope, element, attrs, undefined, noopTransclude);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[4]).toBe(noopTransclude);
  });

  it('accepts a spec-017-canonical 2-arg CompileFn against the widened type', () => {
    const spy = vi.fn();
    const compile2: CompileFn = (element, attrs) => {
      spy(element, attrs);
    };
    const element = makeElement();
    const attrs = makeAttrs();
    compile2(element, attrs);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('accepts a 3-arg CompileFn with `$transclude: TranscludeFn` against the widened type', () => {
    const spy = vi.fn();
    const compile3: CompileFn = (element, attrs, $transclude) => {
      spy(element, attrs, $transclude);
    };
    const element = makeElement();
    const attrs = makeAttrs();
    compile3(element, attrs, noopTransclude);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[2]).toBe(noopTransclude);
  });
});
