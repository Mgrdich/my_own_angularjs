import { describe, expect, it } from 'vitest';

import { createSanitize, sanitize } from '@sanitize/sanitize';

describe('sanitize — coercion and nullish handling', () => {
  it('returns plain text unchanged', () => {
    expect(sanitize('plain text')).toBe('plain text');
  });

  it('returns the empty string for an empty string input', () => {
    expect(sanitize('')).toBe('');
  });

  it('returns the empty string for null', () => {
    expect(sanitize(null)).toBe('');
  });

  it('returns the empty string for undefined', () => {
    expect(sanitize(undefined)).toBe('');
  });

  it('coerces numeric input via String() and sanitizes the result', () => {
    expect(sanitize(42)).toBe('42');
  });
});

describe('sanitize — plain markup pass-through', () => {
  it('preserves a balanced allowed tag with text content', () => {
    expect(sanitize('<p>hi</p>')).toBe('<p>hi</p>');
  });

  it('preserves a whitespace-only string (ASCII space is not entity-encoded)', () => {
    // The encodeEntities regex `[^#-~ |!]` explicitly carves out ASCII space (0x20),
    // so three spaces round-trip without modification.
    expect(sanitize('   ')).toBe('   ');
  });
});

describe('sanitize — dangerous tags dropped with their contents', () => {
  it('drops <script> and its inner text, keeping the trailing chars', () => {
    expect(sanitize('<script>alert(1)</script>x')).toBe('x');
  });

  it('drops <style> and its inner text, keeping the trailing chars', () => {
    expect(sanitize('<style>body{x:y}</style>x')).toBe('x');
  });

  it('drops <iframe> and its inner text, keeping the trailing chars', () => {
    expect(sanitize('<iframe>nope</iframe>after')).toBe('after');
  });

  it('drops only the inline <script> from inside an allowed parent that is not auto-closed', () => {
    // `<div>` is not in OPTIONAL_END_TAG_BLOCK_ELEMENTS, so an inner `<script>`
    // does NOT implicitly close the parent. The `dropDepth` counter swallows
    // the script tag and its inner text; surrounding chars survive.
    expect(sanitize('<div>before<script>bad</script>after</div>')).toBe('<div>beforeafter</div>');
  });
});

describe('sanitize — disallowed attributes are stripped', () => {
  it('drops onerror from <img> but keeps the safe src attribute', () => {
    expect(sanitize('<img src="x.png" onerror="alert(1)">')).toBe('<img src="x.png">');
  });

  it('keeps a relative src on <img>', () => {
    expect(sanitize('<img src="/cdn/x.png">')).toBe('<img src="/cdn/x.png">');
  });

  it('drops onclick but keeps the surrounding <div> and its text', () => {
    expect(sanitize('<div onclick="x">y</div>')).toBe('<div>y</div>');
  });

  it('drops style (not on the global VALID_ATTRS allow-list)', () => {
    expect(sanitize('<a style="color:red">x</a>')).toBe('<a>x</a>');
  });
});

describe('sanitize — URI-protocol scrubbing', () => {
  it('strips an href whose value uses the javascript: scheme', () => {
    expect(sanitize('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
  });

  it('keeps an https:// href on <a>', () => {
    expect(sanitize('<a href="https://example.com/">x</a>')).toBe('<a href="https://example.com/">x</a>');
  });
});

describe('sanitize — SVG opt-in', () => {
  it('default sanitize strips <svg> and its inner content entirely', () => {
    expect(sanitize('<svg><circle></circle></svg>')).toBe('');
  });

  it('createSanitize({ svgEnabled: true }) keeps both <svg> and <circle>', () => {
    const sanitizeSvg = createSanitize({ svgEnabled: true });
    const result = sanitizeSvg('<svg><circle></circle></svg>');
    expect(result).toContain('svg');
    expect(result).toContain('circle');
  });
});

describe('sanitize — custom valid elements', () => {
  it('createSanitize({ extraValidElements: [my-tag] }) keeps the custom tag', () => {
    const sanitizeCustom = createSanitize({ extraValidElements: ['my-tag'] });
    expect(sanitizeCustom('<my-tag>x</my-tag>')).toBe('<my-tag>x</my-tag>');
  });
});

describe('sanitize — custom URI pattern', () => {
  it('keeps an href whose value matches the caller-supplied pattern', () => {
    const sanitizeCustom = createSanitize({ uriPattern: /^myapp:/ });
    expect(sanitizeCustom('<a href="myapp:profile/1">x</a>')).toBe('<a href="myapp:profile/1">x</a>');
  });

  it('drops an href that no longer matches the replaced pattern', () => {
    const sanitizeCustom = createSanitize({ uriPattern: /^myapp:/ });
    expect(sanitizeCustom('<a href="https://example.com">x</a>')).toBe('<a>x</a>');
  });
});

describe('sanitize — idempotence', () => {
  it.each([
    ['plain text', 'hi'],
    ['allowed markup', '<p>hi</p>'],
    ['dangerous tag', '<script>x</script>y'],
    ['stripped URI', '<a href="javascript:1">x</a>'],
  ])('sanitize(sanitize(%s)) === sanitize(%s)', (_label, input) => {
    const once = sanitize(input);
    expect(sanitize(once)).toBe(once);
  });
});
