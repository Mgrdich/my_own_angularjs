import { describe, expect, it } from 'vitest';

import {
  BLOCK_ELEMENTS,
  DEFAULT_URI_PATTERN,
  INLINE_ELEMENTS,
  OPTIONAL_END_TAG_BLOCK_ELEMENTS,
  OPTIONAL_END_TAG_INLINE_ELEMENTS,
  SVG_ATTRS,
  SVG_ELEMENTS,
  URI_ATTRS,
  VALID_ATTRS,
  VALID_ELEMENTS,
  VOID_ELEMENTS,
} from '@sanitize/sanitize-allow-lists';

const REFERENCE_VOID_ELEMENTS = ['area', 'br', 'col', 'hr', 'img', 'wbr'];

const REFERENCE_OPTIONAL_END_TAG_BLOCK_ELEMENTS = [
  'colgroup',
  'dd',
  'dt',
  'li',
  'p',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
];

const REFERENCE_OPTIONAL_END_TAG_INLINE_ELEMENTS = ['rp', 'rt'];

const REFERENCE_BLOCK_ELEMENTS = [
  'address',
  'article',
  'aside',
  'blockquote',
  'caption',
  'center',
  'del',
  'dir',
  'div',
  'dl',
  'figure',
  'figcaption',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'ins',
  'map',
  'menu',
  'nav',
  'ol',
  'pre',
  'section',
  'table',
  'ul',
];

const REFERENCE_INLINE_ELEMENTS = [
  'a',
  'abbr',
  'acronym',
  'b',
  'bdi',
  'bdo',
  'big',
  'br',
  'cite',
  'code',
  'del',
  'dfn',
  'em',
  'font',
  'i',
  'img',
  'ins',
  'kbd',
  'label',
  'map',
  'mark',
  'q',
  'ruby',
  'rp',
  'rt',
  's',
  'samp',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'time',
  'tt',
  'u',
  'var',
];

const REFERENCE_VALID_ATTRS = [
  'abbr',
  'align',
  'alt',
  'axis',
  'bgcolor',
  'border',
  'cellpadding',
  'cellspacing',
  'cite',
  'class',
  'clear',
  'color',
  'cols',
  'colspan',
  'compact',
  'coords',
  'dir',
  'face',
  'headers',
  'height',
  'href',
  'hreflang',
  'hspace',
  'ismap',
  'lang',
  'language',
  'longdesc',
  'name',
  'nohref',
  'nowrap',
  'rel',
  'rev',
  'rows',
  'rowspan',
  'rules',
  'scope',
  'scrolling',
  'shape',
  'size',
  'span',
  'start',
  'summary',
  'tabindex',
  'target',
  'title',
  'type',
  'usemap',
  'valign',
  'value',
  'vspace',
  'width',
];

const REFERENCE_URI_ATTRS = ['background', 'cite', 'href', 'longdesc', 'src', 'xlink:href'];

const REFERENCE_SVG_ELEMENTS = [
  'a',
  'altGlyph',
  'altGlyphDef',
  'altGlyphItem',
  'animateColor',
  'animateMotion',
  'animateTransform',
  'circle',
  'clipPath',
  'color-profile',
  'cursor',
  'defs',
  'desc',
  'ellipse',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feConvolveMatrix',
  'feDiffuseLighting',
  'feDisplacementMap',
  'feDistantLight',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feImage',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'fePointLight',
  'feSpecularLighting',
  'feSpotLight',
  'feTile',
  'feTurbulence',
  'font',
  'font-face',
  'font-face-format',
  'font-face-name',
  'font-face-src',
  'font-face-uri',
  'foreignObject',
  'g',
  'glyph',
  'glyphRef',
  'hkern',
  'image',
  'line',
  'linearGradient',
  'marker',
  'mask',
  'metadata',
  'missing-glyph',
  'mpath',
  'pattern',
  'polygon',
  'polyline',
  'radialGradient',
  'rect',
  'stop',
  'svg',
  'switch',
  'symbol',
  'text',
  'textPath',
  'title',
  'tref',
  'tspan',
  'use',
  'view',
  'vkern',
];

const REFERENCE_SVG_ATTRS = [
  'accent-height',
  'accumulate',
  'additive',
  'alphabetic',
  'arabic-form',
  'ascent',
  'attributeName',
  'attributeType',
  'baseProfile',
  'bbox',
  'begin',
  'by',
  'calcMode',
  'cap-height',
  'class',
  'color',
  'color-rendering',
  'content',
  'cx',
  'cy',
  'd',
  'dx',
  'dy',
  'descent',
  'display',
  'dur',
  'end',
  'fill',
  'fill-rule',
  'font-family',
  'font-size',
  'font-stretch',
  'font-style',
  'font-variant',
  'font-weight',
  'from',
  'fx',
  'fy',
  'g1',
  'g2',
  'glyph-name',
  'gradientUnits',
  'hanging',
  'height',
  'horiz-adv-x',
  'horiz-origin-x',
  'ideographic',
  'k',
  'keyPoints',
  'keySplines',
  'keyTimes',
  'lang',
  'marker-end',
  'marker-mid',
  'marker-start',
  'markerHeight',
  'markerUnits',
  'markerWidth',
  'mathematical',
  'max',
  'min',
  'offset',
  'opacity',
  'orient',
  'origin',
  'overline-position',
  'overline-thickness',
  'panose-1',
  'path',
  'pathLength',
  'points',
  'preserveAspectRatio',
  'r',
  'refX',
  'refY',
  'repeatCount',
  'repeatDur',
  'requiredExtensions',
  'requiredFeatures',
  'restart',
  'rotate',
  'rx',
  'ry',
  'slope',
  'stemh',
  'stemv',
  'stop-color',
  'stop-opacity',
  'strikethrough-position',
  'strikethrough-thickness',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'systemLanguage',
  'target',
  'text-anchor',
  'to',
  'transform',
  'type',
  'u1',
  'u2',
  'underline-position',
  'underline-thickness',
  'unicode',
  'unicode-range',
  'units-per-em',
  'values',
  'version',
  'viewBox',
  'visibility',
  'width',
  'widths',
  'x',
  'x-height',
  'x1',
  'x2',
  'xlink:actuate',
  'xlink:arcrole',
  'xlink:role',
  'xlink:show',
  'xlink:title',
  'xlink:type',
  'xml:base',
  'xml:lang',
  'xml:space',
  'xmlns',
  'xmlns:xlink',
  'y',
  'y1',
  'y2',
  'zoomAndPan',
];

const REFERENCE_VALID_ELEMENTS = [
  ...new Set([
    ...REFERENCE_VOID_ELEMENTS,
    ...REFERENCE_BLOCK_ELEMENTS,
    ...REFERENCE_INLINE_ELEMENTS,
    ...REFERENCE_OPTIONAL_END_TAG_BLOCK_ELEMENTS,
    ...REFERENCE_OPTIONAL_END_TAG_INLINE_ELEMENTS,
  ]),
];

const allConstants: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
  ['VOID_ELEMENTS', VOID_ELEMENTS],
  ['OPTIONAL_END_TAG_BLOCK_ELEMENTS', OPTIONAL_END_TAG_BLOCK_ELEMENTS],
  ['OPTIONAL_END_TAG_INLINE_ELEMENTS', OPTIONAL_END_TAG_INLINE_ELEMENTS],
  ['BLOCK_ELEMENTS', BLOCK_ELEMENTS],
  ['INLINE_ELEMENTS', INLINE_ELEMENTS],
  ['VALID_ELEMENTS', VALID_ELEMENTS],
  ['VALID_ATTRS', VALID_ATTRS],
  ['URI_ATTRS', URI_ATTRS],
  ['SVG_ELEMENTS', SVG_ELEMENTS],
  ['SVG_ATTRS', SVG_ATTRS],
];

describe('structural shape', () => {
  it.each(allConstants)('%s is a non-empty Set of strings', (_name, set) => {
    expect(set).toBeInstanceOf(Set);
    expect(set.size).toBeGreaterThan(0);
    for (const value of set) {
      expect(typeof value).toBe('string');
    }
  });
});

describe('membership parity with AngularJS 1.8.3', () => {
  it('VOID_ELEMENTS matches the upstream reference', () => {
    expect([...VOID_ELEMENTS].sort()).toEqual([...REFERENCE_VOID_ELEMENTS].sort());
  });

  it('OPTIONAL_END_TAG_BLOCK_ELEMENTS matches the upstream reference', () => {
    expect([...OPTIONAL_END_TAG_BLOCK_ELEMENTS].sort()).toEqual([...REFERENCE_OPTIONAL_END_TAG_BLOCK_ELEMENTS].sort());
  });

  it('OPTIONAL_END_TAG_INLINE_ELEMENTS matches the upstream reference', () => {
    expect([...OPTIONAL_END_TAG_INLINE_ELEMENTS].sort()).toEqual(
      [...REFERENCE_OPTIONAL_END_TAG_INLINE_ELEMENTS].sort(),
    );
  });

  it('BLOCK_ELEMENTS matches the upstream reference', () => {
    expect([...BLOCK_ELEMENTS].sort()).toEqual([...REFERENCE_BLOCK_ELEMENTS].sort());
  });

  it('INLINE_ELEMENTS matches the upstream reference', () => {
    expect([...INLINE_ELEMENTS].sort()).toEqual([...REFERENCE_INLINE_ELEMENTS].sort());
  });

  it('VALID_ELEMENTS is the union of void, block, inline, and optional-end-tag sets', () => {
    expect([...VALID_ELEMENTS].sort()).toEqual([...REFERENCE_VALID_ELEMENTS].sort());
  });

  it('VALID_ATTRS matches the upstream reference', () => {
    expect([...VALID_ATTRS].sort()).toEqual([...REFERENCE_VALID_ATTRS].sort());
  });

  it('URI_ATTRS matches the upstream reference', () => {
    expect([...URI_ATTRS].sort()).toEqual([...REFERENCE_URI_ATTRS].sort());
  });

  it('SVG_ELEMENTS matches the upstream reference', () => {
    expect([...SVG_ELEMENTS].sort()).toEqual([...REFERENCE_SVG_ELEMENTS].sort());
  });

  it('SVG_ATTRS matches the upstream reference', () => {
    expect([...SVG_ATTRS].sort()).toEqual([...REFERENCE_SVG_ATTRS].sort());
  });
});

describe('frozen backing storage', () => {
  it.each(allConstants)('%s does not share backing storage with naive consumers', (_name, set) => {
    const snapshot = [...set];
    const copy = [...set];
    copy.push('hijack');
    copy.length = 0;
    expect(set.has('hijack')).toBe(false);
    expect([...set]).toEqual(snapshot);
  });
});

describe('DEFAULT_URI_PATTERN — allowed', () => {
  it.each([
    ['http://x.com'],
    ['https://x.com/path'],
    ['mailto:x@y.com'],
    ['tel:+1'],
    ['/relative'],
    ['./relative'],
    ['#anchor'],
    ['ftp://example.com'],
    ['sftp://example.com'],
    ['file:///etc/hosts'],
  ])('matches %s', (input) => {
    expect(DEFAULT_URI_PATTERN.test(input)).toBe(true);
  });
});

describe('DEFAULT_URI_PATTERN — rejected', () => {
  it.each([['javascript:alert(1)'], ['data:text/html,<script>'], ['vbscript:msgbox(1)']])(
    'does not match %s',
    (input) => {
      expect(DEFAULT_URI_PATTERN.test(input)).toBe(false);
    },
  );
});

describe('DEFAULT_URI_PATTERN — case-insensitive', () => {
  it.each([['HTTPS://x.com'], ['MAILTO:foo'], ['TEL:+1'], ['Https://x.com']])(
    'matches %s regardless of protocol case',
    (input) => {
      expect(DEFAULT_URI_PATTERN.test(input)).toBe(true);
    },
  );
});
