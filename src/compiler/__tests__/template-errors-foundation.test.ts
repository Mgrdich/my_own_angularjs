/**
 * Foundation tests for the spec-019 template-loading surface (Slice 1).
 *
 * Two concerns covered:
 *
 * 1. **Error-class instantiation** — every one of the ten new error
 *    classes added to `compile-error.ts` is exercised: message
 *    formatting, the literal `name` discriminator, and the
 *    `instanceof Error` narrowing contract that callers rely on at
 *    catch sites. Mirrors `transclude-errors-foundation.test.ts`'s
 *    shape exactly.
 *
 * 2. **`TemplateFn` / `TemplateUrlFn` type widening** — TypeScript
 *    function-parameter subtyping must accept 0-arg / 1-arg / 2-arg
 *    callables assigned to the `TemplateFn` / `TemplateUrlFn` aliases.
 *    The runtime assertions just observe that each function is called
 *    once — the real verification is that `pnpm typecheck` passes.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  EmptyTemplateError,
  EmptyTemplateUrlError,
  InvalidTemplateUrlValueError,
  InvalidTemplateValueError,
  MultipleTemplateDirectivesError,
  ReplaceTrueNotSupportedError,
  TemplateAndTemplateUrlCombinedError,
  TemplateFetchFailedError,
  TemplateFunctionReturnedNonStringError,
  TemplateUrlFunctionReturnedNonStringError,
} from '@compiler/compile-error';
import type { Attributes, TemplateFn, TemplateUrlFn } from '@compiler/index';

describe('InvalidTemplateValueError', () => {
  it('formats the message with the directive name and a description', () => {
    const err = new InvalidTemplateValueError('myDir', 'number is not assignable');
    expect(err.message).toBe('Invalid template value for directive myDir: number is not assignable');
  });

  it('carries the literal `name` discriminator', () => {
    const err = new InvalidTemplateValueError('myDir', 'x');
    expect(err.name).toBe('InvalidTemplateValueError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new InvalidTemplateValueError('myDir', 'x')).toBeInstanceOf(Error);
  });
});

describe('InvalidTemplateUrlValueError', () => {
  it('formats the message with the directive name and a description', () => {
    const err = new InvalidTemplateUrlValueError('myDir', 'object is not assignable');
    expect(err.message).toBe('Invalid templateUrl value for directive myDir: object is not assignable');
  });

  it('carries the literal `name` discriminator', () => {
    const err = new InvalidTemplateUrlValueError('myDir', 'x');
    expect(err.name).toBe('InvalidTemplateUrlValueError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new InvalidTemplateUrlValueError('myDir', 'x')).toBeInstanceOf(Error);
  });
});

describe('EmptyTemplateError', () => {
  it('formats the message naming the directive', () => {
    const err = new EmptyTemplateError('myDir');
    expect(err.message).toBe('Invalid template for directive myDir: empty string');
  });

  it('carries the literal `name` discriminator', () => {
    const err = new EmptyTemplateError('myDir');
    expect(err.name).toBe('EmptyTemplateError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new EmptyTemplateError('myDir')).toBeInstanceOf(Error);
  });
});

describe('EmptyTemplateUrlError', () => {
  it('formats the message naming the directive', () => {
    const err = new EmptyTemplateUrlError('myDir');
    expect(err.message).toBe('Invalid templateUrl for directive myDir: empty string');
  });

  it('carries the literal `name` discriminator', () => {
    const err = new EmptyTemplateUrlError('myDir');
    expect(err.name).toBe('EmptyTemplateUrlError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new EmptyTemplateUrlError('myDir')).toBeInstanceOf(Error);
  });
});

describe('TemplateAndTemplateUrlCombinedError', () => {
  it('formats the message naming the directive and the rejection reason', () => {
    const err = new TemplateAndTemplateUrlCombinedError('myDir');
    expect(err.message).toBe('Cannot combine template and templateUrl on directive myDir; choose one');
  });

  it('carries the literal `name` discriminator', () => {
    const err = new TemplateAndTemplateUrlCombinedError('myDir');
    expect(err.name).toBe('TemplateAndTemplateUrlCombinedError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new TemplateAndTemplateUrlCombinedError('myDir')).toBeInstanceOf(Error);
  });
});

describe('ReplaceTrueNotSupportedError', () => {
  it('formats the message naming the directive and explaining the rejection', () => {
    const err = new ReplaceTrueNotSupportedError('myDir');
    expect(err.message).toBe(
      `replace: true is deprecated in AngularJS 1.x and is not supported. Use template/templateUrl without replace; the template becomes the host element's children. Directive: myDir`,
    );
  });

  it('carries the literal `name` discriminator', () => {
    const err = new ReplaceTrueNotSupportedError('myDir');
    expect(err.name).toBe('ReplaceTrueNotSupportedError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new ReplaceTrueNotSupportedError('myDir')).toBeInstanceOf(Error);
  });
});

describe('TemplateFunctionReturnedNonStringError', () => {
  it('formats the message with the directive name and a description', () => {
    const err = new TemplateFunctionReturnedNonStringError('myDir', 'undefined');
    expect(err.message).toBe('Template function for directive myDir returned a non-string value: undefined');
  });

  it('carries the literal `name` discriminator', () => {
    const err = new TemplateFunctionReturnedNonStringError('myDir', 'x');
    expect(err.name).toBe('TemplateFunctionReturnedNonStringError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new TemplateFunctionReturnedNonStringError('myDir', 'x')).toBeInstanceOf(Error);
  });
});

describe('TemplateUrlFunctionReturnedNonStringError', () => {
  it('formats the message with the directive name and a description', () => {
    const err = new TemplateUrlFunctionReturnedNonStringError('myDir', 'number');
    expect(err.message).toBe('templateUrl function for directive myDir returned a non-string value: number');
  });

  it('carries the literal `name` discriminator', () => {
    const err = new TemplateUrlFunctionReturnedNonStringError('myDir', 'x');
    expect(err.name).toBe('TemplateUrlFunctionReturnedNonStringError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new TemplateUrlFunctionReturnedNonStringError('myDir', 'x')).toBeInstanceOf(Error);
  });
});

describe('MultipleTemplateDirectivesError', () => {
  it('formats the message with both directive names and the "first wins" wording', () => {
    const err = new MultipleTemplateDirectivesError('dirA', 'dirB');
    expect(err.message).toBe(
      'Multiple directives requesting a template on the same element: "dirA" and "dirB". Only the first wins; "dirB"\'s template is ignored.',
    );
  });

  it('carries the literal `name` discriminator', () => {
    const err = new MultipleTemplateDirectivesError('dirA', 'dirB');
    expect(err.name).toBe('MultipleTemplateDirectivesError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new MultipleTemplateDirectivesError('dirA', 'dirB')).toBeInstanceOf(Error);
  });
});

describe('TemplateFetchFailedError', () => {
  it('formats the message with the URL and the underlying reason', () => {
    const err = new TemplateFetchFailedError('/tpl/card.html', '404 Not Found');
    expect(err.message).toBe('Failed to load template "/tpl/card.html": 404 Not Found');
  });

  it('carries the literal `name` discriminator', () => {
    const err = new TemplateFetchFailedError('/x.html', 'network error');
    expect(err.name).toBe('TemplateFetchFailedError');
  });

  it('is an instance of Error (catch-site narrowing works)', () => {
    expect(new TemplateFetchFailedError('/x.html', 'reason')).toBeInstanceOf(Error);
  });
});

describe('TemplateFn / TemplateUrlFn type widening', () => {
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

  it('accepts a 0-arg function assigned to TemplateFn (parameter subtyping)', () => {
    const spy = vi.fn(() => '<p>hi</p>');
    const tpl: TemplateFn = (() => spy()) as TemplateFn;
    const element = makeElement();
    const attrs = makeAttrs();
    expect(tpl(element, attrs)).toBe('<p>hi</p>');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('accepts a 1-arg function (element only) assigned to TemplateFn', () => {
    const spy = vi.fn((el: Element) => {
      void el;
      return '<p>hi</p>';
    });
    const tpl: TemplateFn = ((el: Element) => spy(el)) as TemplateFn;
    const element = makeElement();
    const attrs = makeAttrs();
    expect(tpl(element, attrs)).toBe('<p>hi</p>');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe(element);
  });

  it('accepts a 2-arg function (element + attrs) assigned to TemplateFn', () => {
    const spy = vi.fn().mockReturnValue('<p>hi</p>');
    const tpl: TemplateFn = (el, attrs) => {
      spy(el, attrs);
      return '<p>hi</p>';
    };
    const element = makeElement();
    const attrs = makeAttrs();
    expect(tpl(element, attrs)).toBe('<p>hi</p>');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe(element);
    expect(spy.mock.calls[0]?.[1]).toBe(attrs);
  });

  it('accepts a 0-arg function assigned to TemplateUrlFn (parameter subtyping)', () => {
    const spy = vi.fn(() => '/tpl.html');
    const tpl: TemplateUrlFn = (() => spy()) as TemplateUrlFn;
    const element = makeElement();
    const attrs = makeAttrs();
    expect(tpl(element, attrs)).toBe('/tpl.html');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('accepts a 1-arg function (element only) assigned to TemplateUrlFn', () => {
    const spy = vi.fn((el: Element) => {
      void el;
      return '/tpl.html';
    });
    const tpl: TemplateUrlFn = ((el: Element) => spy(el)) as TemplateUrlFn;
    const element = makeElement();
    const attrs = makeAttrs();
    expect(tpl(element, attrs)).toBe('/tpl.html');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe(element);
  });

  it('accepts a 2-arg function (element + attrs) assigned to TemplateUrlFn', () => {
    const spy = vi.fn().mockReturnValue('/tpl.html');
    const tpl: TemplateUrlFn = (el, attrs) => {
      spy(el, attrs);
      return '/tpl.html';
    };
    const element = makeElement();
    const attrs = makeAttrs();
    expect(tpl(element, attrs)).toBe('/tpl.html');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe(element);
    expect(spy.mock.calls[0]?.[1]).toBe(attrs);
  });
});
