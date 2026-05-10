/**
 * `AttributesImpl` — read access (Slice 2 contract — locked here as a
 * regression guard) and `$set` with DOM sync + observer notification
 * (Slice 8). FS §2.11 acceptance criteria.
 *
 * Slice 8 introduces the observer-notification path but does NOT
 * register `$observe` (Slice 9). Tests that exercise notification
 * pre-populate the private `$$observers` map via a narrow cast to
 * simulate what `$observe` will eventually do.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AttributesImpl, bindAttrsToScope } from '@compiler/attributes';
import { Scope } from '@core/index';

type ObserverFn = (value: string | undefined) => void;

function withObservers(attrs: AttributesImpl): { $$observers: Map<string, ObserverFn[]> } {
  return attrs as unknown as { $$observers: Map<string, ObserverFn[]> };
}

describe('AttributesImpl — read access (Slice 2 — regression guard)', () => {
  it('exposes a present attribute under its normalized camelCase name', () => {
    const el = document.createElement('div');
    el.setAttribute('my-attr', 'value');
    const attrs = new AttributesImpl(el);
    expect(attrs.myAttr).toBe('value');
  });

  it('returns `undefined` for a missing attribute', () => {
    const el = document.createElement('div');
    const attrs = new AttributesImpl(el);
    expect(attrs.notThere).toBeUndefined();
  });

  it('returns the empty string for a boolean-presence attribute', () => {
    const el = document.createElement('div');
    el.setAttribute('my-attr', '');
    const attrs = new AttributesImpl(el);
    expect(attrs.myAttr).toBe('');
  });

  it('records the original DOM-form name in `$attr` (data- prefix preserved)', () => {
    const el = document.createElement('div');
    el.setAttribute('data-my-attr', 'x');
    const attrs = new AttributesImpl(el);
    expect(attrs.myAttr).toBe('x');
    expect(attrs.$attr.myAttr).toBe('data-my-attr');
  });

  it('omits attributes from `$attr` that do not appear on the element', () => {
    const el = document.createElement('div');
    el.setAttribute('present', 'yes');
    const attrs = new AttributesImpl(el);
    expect(attrs.$attr.present).toBe('present');
    expect(attrs.$attr.absent).toBeUndefined();
  });
});

describe('AttributesImpl.$set — DOM sync (Slice 8, FS §2.11)', () => {
  it('updates `attrs[name]` and writes the DOM via the original name', () => {
    const el = document.createElement('div');
    const attrs = new AttributesImpl(el);

    attrs.$set('class', 'foo');

    expect(attrs.class).toBe('foo');
    expect(el.getAttribute('class')).toBe('foo');
  });

  it('uses the original DOM-form name from `$attr` when one was recorded (data-href, not href)', () => {
    const el = document.createElement('a');
    el.setAttribute('data-href', '/old');
    const attrs = new AttributesImpl(el);

    attrs.$set('href', '/new');

    expect(attrs.href).toBe('/new');
    expect(el.getAttribute('data-href')).toBe('/new');
    expect(el.getAttribute('href')).toBeNull();
  });

  it('derives a kebab-case DOM name when the attribute is being created from scratch and records it in `$attr`', () => {
    const el = document.createElement('div');
    const attrs = new AttributesImpl(el);

    attrs.$set('newAttr', 'val');

    expect(attrs.newAttr).toBe('val');
    expect(el.getAttribute('new-attr')).toBe('val');
    expect(attrs.$attr.newAttr).toBe('new-attr');

    // Subsequent $set reuses the recorded kebab form.
    attrs.$set('newAttr', 'val2');
    expect(el.getAttribute('new-attr')).toBe('val2');
  });

  it('removes `attrs[name]`, removes the DOM attribute, and removes `$attr[name]` on null', () => {
    const el = document.createElement('div');
    el.setAttribute('my-attr', 'v');
    const attrs = new AttributesImpl(el);

    attrs.$set('myAttr', null);

    expect(attrs.myAttr).toBeUndefined();
    expect(el.getAttribute('my-attr')).toBeNull();
    expect(attrs.$attr.myAttr).toBeUndefined();
  });

  it('with `writeAttr: false` updates `attrs[name]` but does NOT touch the DOM', () => {
    const el = document.createElement('div');
    el.setAttribute('my-attr', 'old');
    const attrs = new AttributesImpl(el);

    attrs.$set('myAttr', 'new', false);

    expect(attrs.myAttr).toBe('new');
    expect(el.getAttribute('my-attr')).toBe('old');
  });

  it('skips the DOM-write step on a Comment node (no setAttribute available)', () => {
    const comment = document.createComment(' directive: my-dir ');
    const attrs = new AttributesImpl(comment);

    // `$set` on a Comment must update `attrs[name]` and not throw.
    expect(() => { attrs.$set('foo', 'bar'); }).not.toThrow();
    expect(attrs.foo).toBe('bar');
  });
});

describe('AttributesImpl.$set — observer notification (Slice 8, FS §2.11)', () => {
  let scope: Scope;

  beforeEach(() => {
    scope = Scope.create();
  });

  it('fires observers SYNCHRONOUSLY when called outside any digest', () => {
    const el = document.createElement('div');
    el.setAttribute('my-attr', 'old');
    const attrs = new AttributesImpl(el);

    const observer = vi.fn<(value: string | undefined) => void>();
    withObservers(attrs).$$observers.set('myAttr', [observer]);

    attrs.$set('myAttr', 'new');

    // Sync notification — observer was called BEFORE $set returned.
    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledWith('new');
  });

  it('defers observers via `$evalAsync` when called INSIDE a digest', () => {
    const el = document.createElement('div');
    el.setAttribute('my-attr', 'old');
    const attrs = new AttributesImpl(el);
    bindAttrsToScope(attrs, scope);

    const observer = vi.fn<(value: string | undefined) => void>();
    withObservers(attrs).$$observers.set('myAttr', [observer]);

    let observerCallsDuringApply = -1;
    scope.$apply(() => {
      attrs.$set('myAttr', 'new');
      // Inside the apply (and its $digest), the observer must NOT
      // have fired yet — $evalAsync flushes within the SAME digest
      // loop iteration, so the call lands before $apply returns but
      // AFTER the synchronous portion of this callback completes.
      observerCallsDuringApply = observer.mock.calls.length;
    });

    expect(observerCallsDuringApply).toBe(0);
    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledWith('new');
  });

  it('is a no-op for the notification step when no observers are registered for the name', () => {
    const el = document.createElement('div');
    const attrs = new AttributesImpl(el);

    // No pre-population — the observers map is empty for `myAttr`.
    expect(() => { attrs.$set('myAttr', 'val'); }).not.toThrow();
    expect(attrs.myAttr).toBe('val');
  });

  it('fires every observer in registration order on a single $set', () => {
    const el = document.createElement('div');
    const attrs = new AttributesImpl(el);

    const calls: string[] = [];
    const fnA = vi.fn<(value: string | undefined) => void>((v) => {
      calls.push(`A:${v ?? '<undef>'}`);
    });
    const fnB = vi.fn<(value: string | undefined) => void>((v) => {
      calls.push(`B:${v ?? '<undef>'}`);
    });
    const fnC = vi.fn<(value: string | undefined) => void>((v) => {
      calls.push(`C:${v ?? '<undef>'}`);
    });
    withObservers(attrs).$$observers.set('myAttr', [fnA, fnB, fnC]);

    attrs.$set('myAttr', 'new');

    expect(fnA).toHaveBeenCalledWith('new');
    expect(fnB).toHaveBeenCalledWith('new');
    expect(fnC).toHaveBeenCalledWith('new');
    expect(calls).toEqual(['A:new', 'B:new', 'C:new']);
  });

  it('passes `undefined` to observers on `$set(name, null)` (uses the post-update value)', () => {
    const el = document.createElement('div');
    el.setAttribute('my-attr', 'old');
    const attrs = new AttributesImpl(el);

    const observer = vi.fn<(value: string | undefined) => void>();
    withObservers(attrs).$$observers.set('myAttr', [observer]);

    attrs.$set('myAttr', null);

    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledWith(undefined);
  });
});
