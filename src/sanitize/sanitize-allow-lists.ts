/**
 * Default allow-list constants for the `$sanitize` HTML scrubber.
 *
 * Faithful port of the upstream tables in
 * `angular/angular.js/src/ngSanitize/sanitize.js` at v1.8.3 — every set
 * member is hand-copied from that reference and frozen at module load so
 * the defaults cannot be mutated at runtime. Subsequent slices add
 * compile-time merging with caller-supplied extras (`extraValidElements`,
 * `extraValidAttrs`, `svgEnabled`); the constants here are the lower bound
 * of what the sanitizer recognizes.
 *
 * The pattern is: declare a frozen `*_ARRAY` (the canonical, ordered source
 * of truth that snapshot tests assert against), then construct a
 * `ReadonlySet<string>` from it for O(1) membership checks at parse time.
 */

/** Self-closing void elements per HTML5; never carry a closing tag. */
const VOID_ELEMENTS_ARRAY = Object.freeze(['area', 'br', 'col', 'hr', 'img', 'wbr'] as const);

/** Block-level elements where the closing tag may legitimately be omitted. */
const OPTIONAL_END_TAG_BLOCK_ELEMENTS_ARRAY = Object.freeze([
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
] as const);

/** Inline elements where the closing tag may legitimately be omitted (Ruby annotation pair). */
const OPTIONAL_END_TAG_INLINE_ELEMENTS_ARRAY = Object.freeze(['rp', 'rt'] as const);

/**
 * Block-level elements per the upstream `blockElements` map.
 *
 * Excludes the optional-end-tag block set — those are merged into
 * `VALID_ELEMENTS` separately to mirror the upstream `validElements`
 * composition.
 */
const BLOCK_ELEMENTS_ARRAY = Object.freeze([
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
] as const);

/** Inline-level elements per the upstream `inlineElements` map. */
const INLINE_ELEMENTS_ARRAY = Object.freeze([
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
] as const);

/** Globally-allowed HTML attribute names (applied regardless of the host tag). */
const VALID_ATTRS_ARRAY = Object.freeze([
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
] as const);

/**
 * Subset of `VALID_ATTRS` whose values are interpreted as URIs.
 *
 * Values for these attributes must additionally pass `DEFAULT_URI_PATTERN`
 * (or a caller-supplied `uriPattern`) before they survive sanitization —
 * this is the choke-point that blocks `javascript:`, `data:`, and similar
 * dangerous schemes.
 */
const URI_ATTRS_ARRAY = Object.freeze(['background', 'cite', 'href', 'longdesc', 'src', 'xlink:href'] as const);

/**
 * SVG element safe set, opted in via `enableSvg(true)`.
 *
 * Off by default — AngularJS 1.x ships SVG support behind a provider flag
 * because malformed SVG was the vector behind multiple historical mXSS
 * advisories. Membership matches `angular/angular.js/src/ngSanitize/sanitize.js`
 * at v1.8.3.
 */
const SVG_ELEMENTS_ARRAY = Object.freeze([
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
] as const);

/** SVG attribute allow-list — used only when `svgEnabled` is on. */
const SVG_ATTRS_ARRAY = Object.freeze([
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
] as const);

/** Self-closing void HTML elements (e.g. `<br>`, `<img>`). */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set(VOID_ELEMENTS_ARRAY);

/** Block-level HTML elements whose closing tag may be omitted. */
export const OPTIONAL_END_TAG_BLOCK_ELEMENTS: ReadonlySet<string> = new Set(OPTIONAL_END_TAG_BLOCK_ELEMENTS_ARRAY);

/** Inline HTML elements whose closing tag may be omitted. */
export const OPTIONAL_END_TAG_INLINE_ELEMENTS: ReadonlySet<string> = new Set(OPTIONAL_END_TAG_INLINE_ELEMENTS_ARRAY);

/** Block-level HTML elements (excluding the optional-end-tag block subset). */
export const BLOCK_ELEMENTS: ReadonlySet<string> = new Set(BLOCK_ELEMENTS_ARRAY);

/** Inline HTML elements per the upstream `inlineElements` map. */
export const INLINE_ELEMENTS: ReadonlySet<string> = new Set(INLINE_ELEMENTS_ARRAY);

/**
 * The full HTML element allow-list — union of void, block, inline, and
 * optional-end-tag (block + inline) sets. This is the set the sanitizer
 * consults at the `start`/`end` token boundaries to decide whether a tag
 * survives.
 */
export const VALID_ELEMENTS: ReadonlySet<string> = new Set<string>([
  ...VOID_ELEMENTS_ARRAY,
  ...BLOCK_ELEMENTS_ARRAY,
  ...INLINE_ELEMENTS_ARRAY,
  ...OPTIONAL_END_TAG_BLOCK_ELEMENTS_ARRAY,
  ...OPTIONAL_END_TAG_INLINE_ELEMENTS_ARRAY,
]);

/** Globally-allowed HTML attribute names. */
export const VALID_ATTRS: ReadonlySet<string> = new Set(VALID_ATTRS_ARRAY);

/** Subset of `VALID_ATTRS` whose values are checked against `DEFAULT_URI_PATTERN`. */
export const URI_ATTRS: ReadonlySet<string> = new Set(URI_ATTRS_ARRAY);

/** SVG element safe set, opted in via `$sanitizeProvider.enableSvg(true)`. */
export const SVG_ELEMENTS: ReadonlySet<string> = new Set(SVG_ELEMENTS_ARRAY);

/** SVG attribute allow-list — applied only when SVG support is enabled. */
export const SVG_ATTRS: ReadonlySet<string> = new Set(SVG_ATTRS_ARRAY);

/**
 * Default permitted-protocol regex applied to URI-bearing attributes.
 *
 * Accepts (case-insensitive): `http`, `https`, `ftp`, `sftp`, `mailto`,
 * `tel`, `file`. Also accepts relative URLs via the second alternation
 * `[^&:/?#]*(?:[/?#]|$)` which matches a path segment containing no
 * protocol delimiter. Rejects `javascript:`, `data:`, `vbscript:`, and any
 * other unlisted scheme.
 *
 * Hand-copied from `angular/angular.js/src/ngSanitize/sanitize.js` v1.8.3.
 */
export const DEFAULT_URI_PATTERN: RegExp = /^\s*((https?|s?ftp|mailto|tel|file):|[^&:/?#]*(?:[/?#]|$))/i;
