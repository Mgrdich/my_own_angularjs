import { describe, expect, it } from 'vitest';

import { htmlParser, type TokenHandler } from '@sanitize/sanitize-tokenizer';

type Event =
  | { kind: 'start'; tag: string; attrs: Record<string, string>; unary: boolean }
  | { kind: 'end'; tag: string }
  | { kind: 'chars'; text: string }
  | { kind: 'comment'; text: string };

const record = (): { events: Event[]; handler: TokenHandler } => {
  const events: Event[] = [];
  const handler: TokenHandler = {
    start: (tag, attrs, unary) => events.push({ kind: 'start', tag, attrs: Object.fromEntries(attrs), unary }),
    end: (tag) => events.push({ kind: 'end', tag }),
    chars: (text) => events.push({ kind: 'chars', text }),
    comment: (text) => events.push({ kind: 'comment', text }),
  };
  return { events, handler };
};

describe('htmlParser — plain text', () => {
  it('emits a single chars event for plain text', () => {
    const { events, handler } = record();
    htmlParser('hello world', handler);
    expect(events).toEqual([{ kind: 'chars', text: 'hello world' }]);
  });

  it('emits no events for the empty string', () => {
    const { events, handler } = record();
    htmlParser('', handler);
    expect(events).toEqual([]);
  });
});

describe('htmlParser — single matched tag pair', () => {
  it('emits start, chars, end for a balanced tag', () => {
    const { events, handler } = record();
    htmlParser('<p>hi</p>', handler);
    expect(events).toEqual([
      { kind: 'start', tag: 'p', attrs: {}, unary: false },
      { kind: 'chars', text: 'hi' },
      { kind: 'end', tag: 'p' },
    ]);
  });

  it('lower-cases tag names in both start and end events', () => {
    const { events, handler } = record();
    htmlParser('<P>x</P>', handler);
    expect(events).toEqual([
      { kind: 'start', tag: 'p', attrs: {}, unary: false },
      { kind: 'chars', text: 'x' },
      { kind: 'end', tag: 'p' },
    ]);
  });
});

describe('htmlParser — void / unary elements', () => {
  it('flags self-closing <br/> as unary and emits no end', () => {
    const { events, handler } = record();
    htmlParser('<br/>', handler);
    expect(events).toEqual([{ kind: 'start', tag: 'br', attrs: {}, unary: true }]);
  });

  it('flags self-closing <img src="x.png" /> as unary with attrs', () => {
    const { events, handler } = record();
    htmlParser('<img src="x.png" />', handler);
    expect(events).toEqual([{ kind: 'start', tag: 'img', attrs: { src: 'x.png' }, unary: true }]);
  });

  it('treats <br> without trailing slash as non-unary (consumer merges with VOID_ELEMENTS)', () => {
    const { events, handler } = record();
    htmlParser('<br>', handler);
    expect(events).toEqual([
      { kind: 'start', tag: 'br', attrs: {}, unary: false },
      { kind: 'end', tag: 'br' },
    ]);
  });
});

describe('htmlParser — nested tags', () => {
  it('emits nested events in stack order', () => {
    const { events, handler } = record();
    htmlParser('<div><p>x</p></div>', handler);
    expect(events).toEqual([
      { kind: 'start', tag: 'div', attrs: {}, unary: false },
      { kind: 'start', tag: 'p', attrs: {}, unary: false },
      { kind: 'chars', text: 'x' },
      { kind: 'end', tag: 'p' },
      { kind: 'end', tag: 'div' },
    ]);
  });
});

describe('htmlParser — mismatched closing tags', () => {
  it('auto-closes intervening tags when a parent close is seen', () => {
    const { events, handler } = record();
    htmlParser('<a><b>x</a>', handler);
    expect(events).toEqual([
      { kind: 'start', tag: 'a', attrs: {}, unary: false },
      { kind: 'start', tag: 'b', attrs: {}, unary: false },
      { kind: 'chars', text: 'x' },
      { kind: 'end', tag: 'b' },
      { kind: 'end', tag: 'a' },
    ]);
  });

  it('silently drops a spurious end tag with no opener and drains the stack at end-of-input', () => {
    const { events, handler } = record();
    htmlParser('<a></c>', handler);
    expect(events).toEqual([
      { kind: 'start', tag: 'a', attrs: {}, unary: false },
      { kind: 'end', tag: 'a' },
    ]);
  });
});

describe('htmlParser — unclosed tags', () => {
  it('drains the open-tag stack at end-of-input', () => {
    const { events, handler } = record();
    htmlParser('<a><b>x', handler);
    expect(events).toEqual([
      { kind: 'start', tag: 'a', attrs: {}, unary: false },
      { kind: 'start', tag: 'b', attrs: {}, unary: false },
      { kind: 'chars', text: 'x' },
      { kind: 'end', tag: 'b' },
      { kind: 'end', tag: 'a' },
    ]);
  });
});

describe('htmlParser — comments', () => {
  it('preserves inner whitespace in comment payload', () => {
    const { events, handler } = record();
    htmlParser('<!-- hi -->', handler);
    expect(events).toEqual([{ kind: 'comment', text: ' hi ' }]);
  });

  it('interleaves chars and comment events', () => {
    const { events, handler } = record();
    htmlParser('a<!--b-->c', handler);
    expect(events).toEqual([
      { kind: 'chars', text: 'a' },
      { kind: 'comment', text: 'b' },
      { kind: 'chars', text: 'c' },
    ]);
  });

  it('treats an unclosed comment as a comment running to end-of-input', () => {
    const { events, handler } = record();
    htmlParser('<!-- foo', handler);
    expect(events).toEqual([{ kind: 'comment', text: ' foo' }]);
  });
});

describe('htmlParser — CDATA', () => {
  it('surfaces CDATA payload as a single chars event without tokenizing it', () => {
    const { events, handler } = record();
    htmlParser('<![CDATA[<b>raw</b>]]>', handler);
    expect(events).toEqual([{ kind: 'chars', text: '<b>raw</b>' }]);
  });

  it('treats unclosed CDATA as chars running to end-of-input', () => {
    const { events, handler } = record();
    htmlParser('<![CDATA[unterminated', handler);
    expect(events).toEqual([{ kind: 'chars', text: 'unterminated' }]);
  });
});

describe('htmlParser — DOCTYPE', () => {
  it('silently drops a standalone DOCTYPE', () => {
    const { events, handler } = record();
    htmlParser('<!DOCTYPE html>', handler);
    expect(events).toEqual([]);
  });

  it('drops DOCTYPE but parses subsequent content normally', () => {
    const { events, handler } = record();
    htmlParser('<!DOCTYPE html><p>x</p>', handler);
    expect(events).toEqual([
      { kind: 'start', tag: 'p', attrs: {}, unary: false },
      { kind: 'chars', text: 'x' },
      { kind: 'end', tag: 'p' },
    ]);
  });

  it('drops an unclosed DOCTYPE consuming the rest of the input', () => {
    const { events, handler } = record();
    htmlParser('<!DOCTYPE html', handler);
    expect(events).toEqual([]);
  });
});

describe('htmlParser — entities pass through verbatim', () => {
  it('does not decode &amp;', () => {
    const { events, handler } = record();
    htmlParser('&amp;', handler);
    expect(events).toEqual([{ kind: 'chars', text: '&amp;' }]);
  });

  it('does not decode &lt;', () => {
    const { events, handler } = record();
    htmlParser('&lt;', handler);
    expect(events).toEqual([{ kind: 'chars', text: '&lt;' }]);
  });

  it('does not decode numeric character references', () => {
    const { events, handler } = record();
    htmlParser('&#x3c;', handler);
    expect(events).toEqual([{ kind: 'chars', text: '&#x3c;' }]);
  });
});

describe('htmlParser — attribute parsing', () => {
  it('parses double-quoted attribute values', () => {
    const { events, handler } = record();
    htmlParser('<a href="x">y</a>', handler);
    expect(events).toEqual([
      { kind: 'start', tag: 'a', attrs: { href: 'x' }, unary: false },
      { kind: 'chars', text: 'y' },
      { kind: 'end', tag: 'a' },
    ]);
  });

  it('parses single-quoted attribute values', () => {
    const { events, handler } = record();
    htmlParser("<a href='x'>y</a>", handler);
    expect(events).toEqual([
      { kind: 'start', tag: 'a', attrs: { href: 'x' }, unary: false },
      { kind: 'chars', text: 'y' },
      { kind: 'end', tag: 'a' },
    ]);
  });

  it('parses unquoted attribute values', () => {
    const { events, handler } = record();
    htmlParser('<a href=x>y</a>', handler);
    expect(events).toEqual([
      { kind: 'start', tag: 'a', attrs: { href: 'x' }, unary: false },
      { kind: 'chars', text: 'y' },
      { kind: 'end', tag: 'a' },
    ]);
  });

  it('collapses boolean attributes (no =value) to empty string', () => {
    const { events, handler } = record();
    htmlParser('<input disabled>', handler);
    expect(events).toEqual([
      { kind: 'start', tag: 'input', attrs: { disabled: '' }, unary: false },
      { kind: 'end', tag: 'input' },
    ]);
  });

  it('captures multiple attributes regardless of declaration order', () => {
    const { events, handler } = record();
    htmlParser('<a href="x" id="y">z</a>', handler);
    expect(events).toEqual([
      { kind: 'start', tag: 'a', attrs: { href: 'x', id: 'y' }, unary: false },
      { kind: 'chars', text: 'z' },
      { kind: 'end', tag: 'a' },
    ]);
  });
});

describe('htmlParser — case handling', () => {
  it('lowercases attribute names but preserves value casing', () => {
    const { events, handler } = record();
    htmlParser('<A HREF="MixedCase">y</A>', handler);
    expect(events).toEqual([
      { kind: 'start', tag: 'a', attrs: { href: 'MixedCase' }, unary: false },
      { kind: 'chars', text: 'y' },
      { kind: 'end', tag: 'a' },
    ]);
  });
});

describe('htmlParser — bare < as text', () => {
  it('treats a lone < as a chars event', () => {
    const { events, handler } = record();
    htmlParser('<', handler);
    expect(events).toEqual([{ kind: 'chars', text: '<' }]);
  });

  it('treats < surrounded by whitespace as text and emits no tag events', () => {
    const { events, handler } = record();
    htmlParser('a < b', handler);
    expect(events.some((e) => e.kind === 'start' || e.kind === 'end' || e.kind === 'comment')).toBe(false);
    const concatenated = events
      .filter((e): e is Extract<Event, { kind: 'chars' }> => e.kind === 'chars')
      .map((e) => e.text)
      .join('');
    expect(concatenated).toBe('a < b');
  });

  it('treats a malformed end tag like </> as literal characters', () => {
    const { events, handler } = record();
    htmlParser('</>', handler);
    expect(events.some((e) => e.kind === 'start' || e.kind === 'end' || e.kind === 'comment')).toBe(false);
    const concatenated = events
      .filter((e): e is Extract<Event, { kind: 'chars' }> => e.kind === 'chars')
      .map((e) => e.text)
      .join('');
    expect(concatenated).toBe('</>');
  });
});

describe('htmlParser — optional-end-tag implicit closure', () => {
  it('auto-closes <p> when a sibling <p> opens', () => {
    const { events, handler } = record();
    htmlParser('<p>a<p>b</p>', handler);
    expect(events).toEqual([
      { kind: 'start', tag: 'p', attrs: {}, unary: false },
      { kind: 'chars', text: 'a' },
      { kind: 'end', tag: 'p' },
      { kind: 'start', tag: 'p', attrs: {}, unary: false },
      { kind: 'chars', text: 'b' },
      { kind: 'end', tag: 'p' },
    ]);
  });

  it('auto-closes <li> when a sibling <li> opens', () => {
    const { events, handler } = record();
    htmlParser('<li>a<li>b</li>', handler);
    expect(events).toEqual([
      { kind: 'start', tag: 'li', attrs: {}, unary: false },
      { kind: 'chars', text: 'a' },
      { kind: 'end', tag: 'li' },
      { kind: 'start', tag: 'li', attrs: {}, unary: false },
      { kind: 'chars', text: 'b' },
      { kind: 'end', tag: 'li' },
    ]);
  });
});
