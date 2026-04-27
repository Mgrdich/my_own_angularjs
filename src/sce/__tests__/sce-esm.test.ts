import { describe, expect, it } from 'vitest';

import { SCE_CONTEXT_ANY } from '@sce/sce-contexts';
import { createSce, sce } from '@sce/sce';
import { createSceDelegate } from '@sce/sce-delegate';
import type { SceContext } from '@sce/sce-types';
import { TrustedCss, TrustedHtml, TrustedJs, TrustedResourceUrl, TrustedUrl } from '@sce/trusted-values';

describe('createSce (ES factory) — defaults', () => {
  it('isEnabled() returns true by default', () => {
    expect(createSce().isEnabled()).toBe(true);
  });

  it('exposes all SceService methods', () => {
    const s = createSce();
    const methodNames = [
      'isEnabled',
      'trustAs',
      'trustAsHtml',
      'trustAsUrl',
      'trustAsResourceUrl',
      'trustAsJs',
      'trustAsCss',
      'getTrusted',
      'getTrustedHtml',
      'getTrustedUrl',
      'getTrustedResourceUrl',
      'getTrustedJs',
      'getTrustedCss',
      'parseAs',
      'parseAsHtml',
      'parseAsUrl',
      'parseAsResourceUrl',
      'parseAsJs',
      'parseAsCss',
      'valueOf',
    ] as const;
    for (const name of methodNames) {
      expect(typeof s[name]).toBe('function');
    }
  });

  it('the default `sce` export is functionally identical to `createSce()` for a representative sample', () => {
    const fresh = createSce();
    expect(fresh.isEnabled()).toBe(sce.isEnabled());
    expect(sce.trustAsHtml('x')).toBeInstanceOf(TrustedHtml);
    expect(sce.getTrustedHtml(sce.trustAsHtml('x'))).toBe('x');
  });
});

describe('createSce — shortcut / generic parity (trustAs)', () => {
  it.each([
    ['html', 'trustAsHtml', TrustedHtml],
    ['url', 'trustAsUrl', TrustedUrl],
    ['resourceUrl', 'trustAsResourceUrl', TrustedResourceUrl],
    ['js', 'trustAsJs', TrustedJs],
    ['css', 'trustAsCss', TrustedCss],
  ] as const)('trustAs(%s, …) and %s(…) produce the same class instance', (ctx, shortcut, klass) => {
    const s = createSce();
    const viaShortcut = (s[shortcut] as (v: unknown) => unknown)('x');
    const viaGeneric = s.trustAs(ctx, 'x');
    expect(viaShortcut).toBeInstanceOf(klass);
    expect(viaGeneric).toBeInstanceOf(klass);
    expect((viaShortcut as TrustedHtml).$$unwrapTrustedValue).toBe('x');
    expect((viaGeneric as TrustedHtml).$$unwrapTrustedValue).toBe('x');
  });
});

describe('createSce — shortcut / generic parity (getTrusted)', () => {
  it.each(['html', 'url', 'resourceUrl', 'js', 'css'] as const)(
    'getTrusted(%s, trustAs(%s, "x")) and getTrusted<%s>(trustAs<%s>("x")) both return "x"',
    (ctx) => {
      const s = createSce();
      const wrapper = s.trustAs(ctx, 'x');
      const viaGeneric = s.getTrusted(ctx, wrapper);

      const getShortcut = s[`getTrusted${capitalize(ctx)}` as keyof typeof s] as (v: unknown) => unknown;
      const trustShortcut = s[`trustAs${capitalize(ctx)}` as keyof typeof s] as (v: unknown) => unknown;
      const viaShortcut = getShortcut(trustShortcut('x'));

      expect(viaGeneric).toBe('x');
      expect(viaShortcut).toBe('x');
    },
  );
});

describe('createSce — shortcut / generic parity (parseAs)', () => {
  it.each(['html', 'url', 'resourceUrl', 'js', 'css'] as const)(
    'parseAs(%s, expr)(scope) equals parseAs<%s>(expr)(scope)',
    (ctx) => {
      const s = createSce();
      const trustShortcut = s[`trustAs${capitalize(ctx)}` as keyof typeof s] as (v: unknown) => unknown;
      const parseShortcut = s[`parseAs${capitalize(ctx)}` as keyof typeof s] as (
        e: string,
      ) => (scope: Record<string, unknown>) => unknown;
      const scope = { v: trustShortcut('x') };
      const viaGeneric = s.parseAs(ctx, 'v')(scope);
      const viaShortcut = parseShortcut('v')(scope);
      expect(viaGeneric).toBe('x');
      expect(viaShortcut).toBe('x');
    },
  );
});

describe('createSce — strict OFF pass-through', () => {
  it('isEnabled() === false', () => {
    expect(createSce({ enabled: false }).isEnabled()).toBe(false);
  });

  it('trustAs("html", "x") returns "x" unchanged (no wrapper constructed)', () => {
    const s = createSce({ enabled: false });
    expect(s.trustAs('html', 'x')).toBe('x');
  });

  it('trustAsHtml("x") returns "x" unchanged', () => {
    const s = createSce({ enabled: false });
    expect(s.trustAsHtml('x')).toBe('x');
  });

  it('trustAs does not create wrappers under strict OFF', () => {
    const s = createSce({ enabled: false });
    expect(s.trustAsHtml('x')).not.toBeInstanceOf(TrustedHtml);
    expect(s.trustAsUrl('x')).not.toBeInstanceOf(TrustedUrl);
    expect(s.trustAsJs('x')).not.toBeInstanceOf(TrustedJs);
    expect(s.trustAsCss('x')).not.toBeInstanceOf(TrustedCss);
    expect(s.trustAsResourceUrl('x')).not.toBeInstanceOf(TrustedResourceUrl);
  });

  it('getTrusted("html", "plain") returns "plain" without throwing', () => {
    const s = createSce({ enabled: false });
    expect(s.getTrusted('html', 'plain')).toBe('plain');
  });

  it('getTrustedHtml("plain") returns "plain" without throwing', () => {
    const s = createSce({ enabled: false });
    expect(s.getTrustedHtml('plain')).toBe('plain');
  });

  it('getTrusted still unwraps a TrustedHtml via delegate.valueOf', () => {
    const s = createSce({ enabled: false });
    const wrapper = new TrustedHtml('x');
    expect(s.getTrusted('html', wrapper)).toBe('x');
  });

  it('getTrusted("url", 42) returns 42 (non-string non-wrapper pass-through)', () => {
    const s = createSce({ enabled: false });
    expect(s.getTrusted('url', 42)).toBe(42);
  });

  it('parseAs("html", "\'plain\'")(scope) returns "plain" without throwing', () => {
    const s = createSce({ enabled: false });
    expect(s.parseAs('html', "'plain'")({})).toBe('plain');
  });

  it('valueOf(new TrustedHtml("x")) still unwraps under strict OFF (valueOf is not strict-gated)', () => {
    const s = createSce({ enabled: false });
    expect(s.valueOf(new TrustedHtml('x'))).toBe('x');
  });
});

describe('createSce — strict ON', () => {
  it('trustAsHtml("x") returns a TrustedHtml instance', () => {
    const s = createSce();
    expect(s.trustAsHtml('x')).toBeInstanceOf(TrustedHtml);
  });

  it('getTrustedHtml(trustAsHtml("x")) === "x"', () => {
    const s = createSce();
    expect(s.getTrustedHtml(s.trustAsHtml('x'))).toBe('x');
  });

  it('getTrustedHtml("plain") throws with a message referencing "html"', () => {
    const s = createSce();
    expect(() => s.getTrustedHtml('plain')).toThrow(/html/);
  });

  it('getTrustedHtml(trustAsUrl("x")) throws (context mismatch)', () => {
    const s = createSce();
    expect(() => s.getTrustedHtml(s.trustAsUrl('x'))).toThrow();
  });

  it('trustAsHtml(42) throws (non-string)', () => {
    const s = createSce();
    expect(() => s.trustAsHtml(42)).toThrow();
  });
});

describe('createSce — invalid context (generic methods)', () => {
  it('trustAs("bogus", "x") throws with a message naming "bogus"', () => {
    const s = createSce();
    expect(() => s.trustAs('bogus' as unknown as SceContext, 'x')).toThrow(/bogus/);
  });

  it('getTrusted("bogus", "x") throws', () => {
    const s = createSce();
    expect(() => s.getTrusted('bogus' as unknown as SceContext, 'x')).toThrow(/bogus/);
  });

  it('parseAs("bogus", "\'x\'") throws (validated before parsing)', () => {
    const s = createSce();
    expect(() => s.parseAs('bogus' as unknown as SceContext, "'x'")).toThrow(/bogus/);
  });

  it('trustAs("$$ANY$$", "x") throws — the façade does not accept the internal sentinel', () => {
    const s = createSce();
    expect(() => s.trustAs(SCE_CONTEXT_ANY as unknown as SceContext, 'x')).toThrow();
  });

  it('getTrusted("$$ANY$$", "x") throws', () => {
    const s = createSce();
    expect(() => s.getTrusted(SCE_CONTEXT_ANY as unknown as SceContext, 'x')).toThrow();
  });
});

describe('createSce — parseAs semantics', () => {
  it('parseAs("html", "user.bio")(scope) unwraps a TrustedHtml at scope.user.bio', () => {
    const s = createSce();
    const scope = { user: { bio: s.trustAsHtml('<p>hi</p>') } };
    expect(s.parseAs('html', 'user.bio')(scope)).toBe('<p>hi</p>');
  });

  it('parseAs("html", "user.bio")(scope) throws when scope.user.bio is a plain string (strict ON)', () => {
    const s = createSce();
    const scope = { user: { bio: '<p>hi</p>' } };
    expect(() => s.parseAs('html', 'user.bio')(scope)).toThrow();
  });

  it('preserves `.constant` and `.literal` on a numeric literal expression', () => {
    const s = createSce();
    const parsed = s.parseAs('html', '1');
    // `parse('1')` produces an ExpressionFn with literal=true, constant=true.
    expect(parsed.literal).toBe(true);
    expect(parsed.constant).toBe(true);
    expect(parsed.oneTime).toBe(false);
  });

  it('preserves `.oneTime` flag on a `::`-prefixed expression', () => {
    const s = createSce();
    const parsed = s.parseAs('html', '::user.bio');
    expect(parsed.oneTime).toBe(true);
  });

  it('parseAs throws synchronously when the parser rejects the expression', () => {
    const s = createSce();
    // A trailing `+` with no operand triggers the parser's "unexpected end
    // of expression" error at parseAs call time — i.e. the error surfaces
    // synchronously, before any scope is supplied.
    expect(() => s.parseAs('html', '1 + + +')).toThrow();
  });
});

describe('createSce — destructurability', () => {
  it('trustAsHtml, getTrustedHtml, parseAsHtml work when destructured from the service', () => {
    // The whole point of this test is that detached method references keep
    // working — the façade's methods are standalone closures, not bound
    // member functions. The unbound-method lint rule assumes a `this`
    // dependency that does not exist here, so disable it for the
    // destructuring line.
    /* eslint-disable @typescript-eslint/unbound-method -- the façade's methods are closures; this test asserts they survive detachment */
    const { trustAsHtml, getTrustedHtml, parseAsHtml } = sce;
    /* eslint-enable @typescript-eslint/unbound-method */
    const wrapper = trustAsHtml('x');
    expect(wrapper).toBeInstanceOf(TrustedHtml);
    expect(getTrustedHtml(wrapper)).toBe('x');
    const parsed = parseAsHtml('v');
    expect(parsed({ v: trustAsHtml('y') })).toBe('y');
  });
});

describe('createSce — explicit delegate injection', () => {
  it('routes getTrustedResourceUrl through the injected delegate allow-list', () => {
    const customDelegate = createSceDelegate({ trustedResourceUrlList: ['https://custom.com/**'] });
    const s = createSce({ delegate: customDelegate });
    expect(s.getTrustedResourceUrl('https://custom.com/x')).toBe('https://custom.com/x');
  });

  it('rejects a URL outside the injected delegate allow-list', () => {
    const customDelegate = createSceDelegate({ trustedResourceUrlList: ['https://custom.com/**'] });
    const s = createSce({ delegate: customDelegate });
    expect(() => s.getTrustedResourceUrl('https://other.com/x')).toThrow(/did not match/);
  });

  it('strict OFF with an explicit delegate is still pass-through (the allow-list is not consulted)', () => {
    const customDelegate = createSceDelegate({ trustedResourceUrlList: ['https://custom.com/**'] });
    const s = createSce({ delegate: customDelegate, enabled: false });
    // Under strict OFF, getTrusted returns delegate.valueOf — not
    // delegate.getTrusted — so the allow-list is bypassed entirely.
    expect(s.getTrustedResourceUrl('https://other.com/x')).toBe('https://other.com/x');
    expect(s.trustAsResourceUrl('https://other.com/x')).toBe('https://other.com/x');
  });
});

describe('default `sce` export', () => {
  it('sce.isEnabled() === true', () => {
    expect(sce.isEnabled()).toBe(true);
  });

  it('sce.trustAsHtml("x") returns a TrustedHtml', () => {
    expect(sce.trustAsHtml('x')).toBeInstanceOf(TrustedHtml);
  });

  it('sce.getTrustedHtml(sce.trustAsHtml("x")) === "x"', () => {
    expect(sce.getTrustedHtml(sce.trustAsHtml('x'))).toBe('x');
  });
});

describe('AngularJS parity — upstream sceSpecs.js scenarios', () => {
  // AngularJS parity: sceSpecs.js — "should not wrap/unwrap any value or
  // throw exception on non-string values" (SCE disabled branch).
  // Under strict OFF, a plain object survives both trustAs and getTrusted
  // by reference identity — no wrapper is constructed, nothing throws.
  it('strict OFF: plain-object value passes through trustAs and getTrusted by reference', () => {
    const s = createSce({ enabled: false });
    const originalValue = { foo: 'bar' };
    expect(s.trustAs('js', originalValue)).toBe(originalValue);
    expect(s.getTrusted('js', originalValue)).toBe(originalValue);
  });

  // AngularJS parity: sceSpecs.js — "should wrap undefined into undefined" /
  // "should unwrap undefined into undefined".
  it('trustAsHtml(undefined) returns undefined; getTrusted html undefined returns undefined', () => {
    const s = createSce();
    expect(s.trustAsHtml(undefined)).toBeUndefined();
    expect(s.getTrusted('html', undefined)).toBeUndefined();
  });

  // AngularJS parity: sceSpecs.js — "should wrap null into null" / "should
  // unwrap null into null".
  it('trustAsHtml(null) returns null; getTrusted html null returns null', () => {
    const s = createSce();
    expect(s.trustAsHtml(null)).toBeNull();
    expect(s.getTrusted('html', null)).toBeNull();
  });

  // AngularJS parity: sceSpecs.js — 'should wrap "" into ""' / 'should
  // unwrap "" into ""'. Empty strings are valid wrapper payloads.
  it('trustAsHtml("") wraps the empty string; getTrustedHtml unwraps it', () => {
    const s = createSce();
    const wrapped = s.trustAsHtml('');
    expect(wrapped).toBeInstanceOf(TrustedHtml);
    expect(s.getTrustedHtml(wrapped)).toBe('');
  });

  // AngularJS parity: sceSpecs.js — "should NOT return untrusted values from
  // expression function". When the expression evaluates to a plain boolean
  // (via locals), parseAs('html', …) throws under strict ON.
  it('parseAs with untrusted boolean from locals throws in html context', () => {
    const s = createSce();
    const exprFn = s.parseAs('html', 'foo');
    expect(() => exprFn({}, { foo: true })).toThrow();
  });

  // AngularJS parity: sceSpecs.js — "should NOT return trusted values of
  // the wrong type from expression function". Cross-context locals throw.
  it('parseAs html with a JS-trusted value from locals throws (cross-context)', () => {
    const s = createSce();
    const exprFn = s.parseAs('html', 'foo');
    expect(() => exprFn({}, { foo: s.trustAsJs('123') })).toThrow();
  });

  // AngularJS parity: sceSpecs.js — "should return trusted values from
  // expression function". Matching locals round-trip through parseAs.
  it('parseAs html returns the unwrapped string when locals hold a TrustedHtml', () => {
    const s = createSce();
    const exprFn = s.parseAs('html', 'foo');
    expect(exprFn({}, { foo: s.trustAsHtml('trustedValue') })).toBe('trustedValue');
  });
});

function capitalize<S extends string>(s: S): Capitalize<S> {
  return (s.charAt(0).toUpperCase() + s.slice(1)) as Capitalize<S>;
}
