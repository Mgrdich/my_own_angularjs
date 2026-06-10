/**
 * `createIdentityTracker` — default identity tracker for `ng-repeat`
 * (spec 028 Slice 2 / technical-considerations §2.2).
 *
 * The tracker is the fallback used by `ng-repeat` when the author has
 * NOT supplied a `track by` clause. It synthesizes stable identity
 * strings for any value:
 *
 *  - Object-like values (plain objects, arrays, class instances,
 *    functions, dates, maps, sets, …) get a monotonically-increasing
 *    `'object:N'` identity backed by a closure-local `WeakMap`. The
 *    same reference always yields the same string; distinct
 *    references always yield distinct strings; mutating the object's
 *    properties does NOT change its identity (reference-based, not
 *    value-based).
 *  - Primitives map to type-prefix sentinels: `'string:<value>'`,
 *    `'number:<value>'`, `'boolean:<value>'`, `'bigint:<value>'`,
 *    `'symbol:Symbol(...)'`. `NaN` normalizes to `'number:NaN'` and
 *    `+0` / `-0` both collapse to `'number:0'`.
 *  - `null` returns `'null:'`; `undefined` returns `'undefined:'`;
 *    the two are deliberately distinct sentinels.
 *
 * Two trackers built from independent `createIdentityTracker()` calls
 * share no closure state — the same object passed to two different
 * trackers receives two independent identities.
 */

import { describe, expect, it } from 'vitest';

import { createIdentityTracker } from '@compiler/ng-repeat-identity';

describe('createIdentityTracker — object identity (WeakMap branch)', () => {
  it('returns the same identity for the same object across multiple calls', () => {
    const tracker = createIdentityTracker();
    const item = { id: 1 };

    const first = tracker.getIdentity(item);
    const second = tracker.getIdentity(item);
    const third = tracker.getIdentity(item);

    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('assigns distinct identities to distinct object references with identical structure', () => {
    const tracker = createIdentityTracker();
    const a = { id: 1, name: 'apple' };
    const b = { id: 1, name: 'apple' };

    expect(tracker.getIdentity(a)).not.toBe(tracker.getIdentity(b));
  });

  it('mutating an object does NOT change its identity (reference-based)', () => {
    const tracker = createIdentityTracker();
    const item: { id: number; title?: string } = { id: 1 };

    const before = tracker.getIdentity(item);
    item.id = 99;
    item.title = 'mutated';
    const after = tracker.getIdentity(item);

    expect(after).toBe(before);
  });

  it('produces monotonically-increasing identities in encounter order', () => {
    const tracker = createIdentityTracker();
    const a = { tag: 'a' };
    const b = { tag: 'b' };
    const c = { tag: 'c' };

    expect(tracker.getIdentity(a)).toBe('object:1');
    expect(tracker.getIdentity(b)).toBe('object:2');
    expect(tracker.getIdentity(c)).toBe('object:3');
  });

  it('does NOT advance the counter when re-encountering a known object', () => {
    const tracker = createIdentityTracker();
    const a = { tag: 'a' };
    const b = { tag: 'b' };

    expect(tracker.getIdentity(a)).toBe('object:1');
    // Three re-encounters of `a` must not consume identities 2..4.
    expect(tracker.getIdentity(a)).toBe('object:1');
    expect(tracker.getIdentity(a)).toBe('object:1');
    expect(tracker.getIdentity(a)).toBe('object:1');
    expect(tracker.getIdentity(b)).toBe('object:2');
  });

  it('treats arrays as objects (WeakMap branch — `object:N` form)', () => {
    const tracker = createIdentityTracker();
    const arr1: number[] = [1, 2, 3];
    const arr2: number[] = [1, 2, 3];

    const id1 = tracker.getIdentity(arr1);
    const id2 = tracker.getIdentity(arr2);

    expect(id1).toMatch(/^object:\d+$/);
    expect(id2).toMatch(/^object:\d+$/);
    expect(id1).not.toBe(id2);
    expect(tracker.getIdentity(arr1)).toBe(id1);
  });

  it('treats class instances as objects (WeakMap branch — `object:N` form)', () => {
    class Todo {
      constructor(readonly title: string) {}
    }
    const tracker = createIdentityTracker();
    const a = new Todo('one');
    const b = new Todo('one');

    const idA = tracker.getIdentity(a);
    const idB = tracker.getIdentity(b);

    expect(idA).toMatch(/^object:\d+$/);
    expect(idB).toMatch(/^object:\d+$/);
    expect(idA).not.toBe(idB);
    expect(tracker.getIdentity(a)).toBe(idA);
  });

  it('treats functions as objects (WeakMap branch — `object:N` form)', () => {
    const tracker = createIdentityTracker();
    const fn1 = () => 1;
    const fn2 = () => 1;

    const id1 = tracker.getIdentity(fn1);
    const id2 = tracker.getIdentity(fn2);

    expect(id1).toMatch(/^object:\d+$/);
    expect(id2).toMatch(/^object:\d+$/);
    expect(id1).not.toBe(id2);
    expect(tracker.getIdentity(fn1)).toBe(id1);
  });

  it('treats Date / Map / Set instances as objects', () => {
    const tracker = createIdentityTracker();
    const date = new Date(0);
    const map = new Map<string, number>();
    const set = new Set<number>();

    expect(tracker.getIdentity(date)).toMatch(/^object:\d+$/);
    expect(tracker.getIdentity(map)).toMatch(/^object:\d+$/);
    expect(tracker.getIdentity(set)).toMatch(/^object:\d+$/);
    // Each is a distinct reference — distinct identities.
    expect(tracker.getIdentity(date)).not.toBe(tracker.getIdentity(map));
    expect(tracker.getIdentity(map)).not.toBe(tracker.getIdentity(set));
  });

  it('treats `Object.freeze`d items transparently (no `$$hashKey` injection)', () => {
    const tracker = createIdentityTracker();
    const frozen = Object.freeze({ id: 1 });

    const first = tracker.getIdentity(frozen);
    const second = tracker.getIdentity(frozen);

    expect(first).toMatch(/^object:\d+$/);
    expect(second).toBe(first);
    // The object must remain byte-identical — no `$$hashKey` leaks.
    expect(Object.keys(frozen)).toEqual(['id']);
  });
});

describe('createIdentityTracker — primitives (type-prefix sentinels)', () => {
  it('maps strings to `string:<value>` sentinels', () => {
    const tracker = createIdentityTracker();

    expect(tracker.getIdentity('hello')).toBe('string:hello');
    expect(tracker.getIdentity('')).toBe('string:');
    expect(tracker.getIdentity('   ')).toBe('string:   ');
  });

  it('maps numbers to `number:<value>` sentinels', () => {
    const tracker = createIdentityTracker();

    expect(tracker.getIdentity(0)).toBe('number:0');
    expect(tracker.getIdentity(42)).toBe('number:42');
    expect(tracker.getIdentity(-17)).toBe('number:-17');
    expect(tracker.getIdentity(3.14)).toBe('number:3.14');
  });

  it('maps booleans to `boolean:true` / `boolean:false`', () => {
    const tracker = createIdentityTracker();

    expect(tracker.getIdentity(true)).toBe('boolean:true');
    expect(tracker.getIdentity(false)).toBe('boolean:false');
  });

  it('maps bigints to `bigint:<value>` sentinels', () => {
    const tracker = createIdentityTracker();

    expect(tracker.getIdentity(0n)).toBe('bigint:0');
    expect(tracker.getIdentity(10n)).toBe('bigint:10');
    expect(tracker.getIdentity(-5n)).toBe('bigint:-5');
  });

  it('maps symbols to `symbol:Symbol(<description>)` via safe `String()` conversion', () => {
    const tracker = createIdentityTracker();
    const sym = Symbol('x');

    expect(tracker.getIdentity(sym)).toBe('symbol:Symbol(x)');
    expect(tracker.getIdentity(Symbol('foo'))).toBe('symbol:Symbol(foo)');
    expect(tracker.getIdentity(Symbol(''))).toBe('symbol:Symbol()');
  });

  it('returns the same sentinel for repeated primitive values', () => {
    const tracker = createIdentityTracker();

    expect(tracker.getIdentity('a')).toBe('string:a');
    expect(tracker.getIdentity('a')).toBe('string:a');
    expect(tracker.getIdentity(7)).toBe('number:7');
    expect(tracker.getIdentity(7)).toBe('number:7');
  });

  it('does NOT consume `object:N` identities when given primitives', () => {
    const tracker = createIdentityTracker();

    tracker.getIdentity('hello');
    tracker.getIdentity(42);
    tracker.getIdentity(true);
    // The first object encountered after primitives must still receive
    // `'object:1'` — the counter is reserved for the WeakMap branch.
    expect(tracker.getIdentity({})).toBe('object:1');
  });
});

describe('createIdentityTracker — primitive edge cases (NaN, ±0, null, undefined)', () => {
  it('normalizes `NaN` to `number:NaN`', () => {
    const tracker = createIdentityTracker();

    expect(tracker.getIdentity(NaN)).toBe('number:NaN');
  });

  it('collapses `+0` and `-0` to the same `number:0` sentinel', () => {
    const tracker = createIdentityTracker();

    expect(tracker.getIdentity(0)).toBe('number:0');
    expect(tracker.getIdentity(-0)).toBe('number:0');
    expect(tracker.getIdentity(0)).toBe(tracker.getIdentity(-0));
  });

  it('returns `null:` for `null`', () => {
    const tracker = createIdentityTracker();

    expect(tracker.getIdentity(null)).toBe('null:');
  });

  it('returns `undefined:` for `undefined`', () => {
    const tracker = createIdentityTracker();

    expect(tracker.getIdentity(undefined)).toBe('undefined:');
  });

  it('produces distinct identities for `null` and `undefined`', () => {
    const tracker = createIdentityTracker();

    expect(tracker.getIdentity(null)).not.toBe(tracker.getIdentity(undefined));
  });

  it('returns stable identities for `null` / `undefined` across repeated calls', () => {
    const tracker = createIdentityTracker();

    expect(tracker.getIdentity(null)).toBe('null:');
    expect(tracker.getIdentity(null)).toBe('null:');
    expect(tracker.getIdentity(undefined)).toBe('undefined:');
    expect(tracker.getIdentity(undefined)).toBe('undefined:');
  });

  it('maps `Infinity` and `-Infinity` to readable sentinels', () => {
    const tracker = createIdentityTracker();

    expect(tracker.getIdentity(Infinity)).toBe('number:Infinity');
    expect(tracker.getIdentity(-Infinity)).toBe('number:-Infinity');
  });

  it('keeps `null` distinct from the string `"null"`', () => {
    // Critical contract: the type-prefix is what makes the sentinel
    // collision-free across primitive types.
    const tracker = createIdentityTracker();

    expect(tracker.getIdentity(null)).toBe('null:');
    expect(tracker.getIdentity('null')).toBe('string:null');
    expect(tracker.getIdentity(null)).not.toBe(tracker.getIdentity('null'));
  });

  it('keeps `undefined` distinct from the string `"undefined"`', () => {
    const tracker = createIdentityTracker();

    expect(tracker.getIdentity(undefined)).toBe('undefined:');
    expect(tracker.getIdentity('undefined')).toBe('string:undefined');
    expect(tracker.getIdentity(undefined)).not.toBe(tracker.getIdentity('undefined'));
  });

  it('keeps the number `0` distinct from the string `"0"`', () => {
    const tracker = createIdentityTracker();

    expect(tracker.getIdentity(0)).toBe('number:0');
    expect(tracker.getIdentity('0')).toBe('string:0');
    expect(tracker.getIdentity(0)).not.toBe(tracker.getIdentity('0'));
  });

  it('keeps the boolean `true` distinct from the string `"true"` and the number `1`', () => {
    const tracker = createIdentityTracker();

    expect(tracker.getIdentity(true)).toBe('boolean:true');
    expect(tracker.getIdentity('true')).toBe('string:true');
    expect(tracker.getIdentity(1)).toBe('number:1');
    expect(tracker.getIdentity(true)).not.toBe(tracker.getIdentity('true'));
    expect(tracker.getIdentity(true)).not.toBe(tracker.getIdentity(1));
  });
});

describe('createIdentityTracker — independent trackers share NO state', () => {
  it('two trackers assign independent identities to the same object', () => {
    const trackerA = createIdentityTracker();
    const trackerB = createIdentityTracker();
    // Seed tracker A so its counter has advanced before tracker B sees
    // the shared object — the two assignments must still be independent.
    trackerA.getIdentity({ seed: 1 });
    trackerA.getIdentity({ seed: 2 });

    const shared = { id: 'shared' };
    const idA = trackerA.getIdentity(shared);
    const idB = trackerB.getIdentity(shared);

    // Tracker A's counter is at 3 when it sees `shared`; tracker B is fresh.
    expect(idA).toBe('object:3');
    expect(idB).toBe('object:1');
    expect(idA).not.toBe(idB);
  });

  it('each tracker resolves the same object to the SAME identity within its own scope', () => {
    const trackerA = createIdentityTracker();
    const trackerB = createIdentityTracker();
    const shared = { id: 'shared' };

    expect(trackerA.getIdentity(shared)).toBe(trackerA.getIdentity(shared));
    expect(trackerB.getIdentity(shared)).toBe(trackerB.getIdentity(shared));
  });

  it('two trackers built from independent calls have independent counters', () => {
    const trackerA = createIdentityTracker();
    const trackerB = createIdentityTracker();

    expect(trackerA.getIdentity({})).toBe('object:1');
    expect(trackerA.getIdentity({})).toBe('object:2');
    // Tracker B's counter starts fresh at 1 — independent of A.
    expect(trackerB.getIdentity({})).toBe('object:1');
    expect(trackerB.getIdentity({})).toBe('object:2');
  });

  it('primitive sentinels are byte-identical across independent trackers', () => {
    // The type-prefix sentinels are pure functions of the input value,
    // so two trackers produce the same string for the same primitive.
    const trackerA = createIdentityTracker();
    const trackerB = createIdentityTracker();

    expect(trackerA.getIdentity('hello')).toBe(trackerB.getIdentity('hello'));
    expect(trackerA.getIdentity(42)).toBe(trackerB.getIdentity(42));
    expect(trackerA.getIdentity(null)).toBe(trackerB.getIdentity(null));
    expect(trackerA.getIdentity(undefined)).toBe(trackerB.getIdentity(undefined));
  });
});

describe('createIdentityTracker — collision-free identity guarantee', () => {
  it('assigns distinct identities to many distinct objects (counter never repeats)', () => {
    const tracker = createIdentityTracker();
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      const id = tracker.getIdentity({ index: i });
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(100);
  });

  it('the object branch and the primitive branch produce non-overlapping sentinels', () => {
    // No primitive sentinel can ever collide with an `object:N` identity
    // because the object branch's `object:` prefix is reserved.
    const tracker = createIdentityTracker();
    tracker.getIdentity({});

    expect(tracker.getIdentity('object:1')).toBe('string:object:1');
    expect(tracker.getIdentity('object:1')).not.toBe('object:1');
  });
});
