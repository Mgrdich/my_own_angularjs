/**
 * Parity tests: replays the upstream AngularJS 1.8.3 ngSanitize spec
 * `it(...)` cases against our ESM `sanitize` factory.
 *
 * Source of truth (test vectors):
 *   https://raw.githubusercontent.com/angular/angular.js/v1.8.3/test/ngSanitize/sanitizeSpec.js
 *   https://github.com/angular/angular.js/blob/v1.8.3/test/ngSanitize/sanitizeSpec.js
 *
 * Source of truth (impl reference, when an upstream `it(...)` is ambiguous):
 *   https://raw.githubusercontent.com/angular/angular.js/v1.8.3/src/ngSanitize/sanitize.js
 *
 * Contract:
 *   Every Vitest `it(...)` in this file is a port of an upstream `it(...)`,
 *   with the same input strings hand-copied verbatim. The expected output
 *   is recomputed against OUR implementation and pinned — NOT copy-pasted
 *   from the upstream test. Where our actual output diverges from the
 *   upstream `expected` value, the divergence is annotated inline with
 *   `// DEVIATION: <one-line rationale>`. AngularJS upstream uses
 *   Karma/Jasmine + `expect($sanitize(input)).toEqual(expected)` style; we
 *   mirror that with Vitest's `expect(sanitize(input)).toBe(expected)`.
 *
 * The `describe(...)` blocks below mirror the upstream block structure
 * (`htmlParser`, root `'$sanitize'`, `clobbered elements`,
 * `Custom white-list support`, `SVG support`, `htmlSanitizerWriter`,
 * `uri checking`, `sanitizeText`, `decodeEntities`) so each upstream
 * `it(...)` is locatable by group + description.
 */

import { describe, expect, it } from 'vitest';

import { createSanitize, sanitize } from '@sanitize/sanitize';

// ---------------------------------------------------------------------------
// describe('htmlParser', ...) — upstream test/ngSanitize/sanitizeSpec.js:20
// ---------------------------------------------------------------------------
//
// Upstream tests hit the `htmlParser` global directly with a custom handler.
// We treat the parser as an internal implementation detail and assert its
// effects through `sanitize(...)` instead. Tests that observe events the
// final string can't surface (e.g. comment payloads being silently dropped,
// raw attribute values seen by the handler) are ported as
// observable-from-output equivalents.
describe('htmlParser (observed via sanitize)', () => {
  it('does not emit comments (upstream: "should not parse comments")', () => {
    // Upstream verifies `comment` callback is never invoked. Observable proxy:
    // a bare comment sanitizes to the empty string.
    expect(sanitize('<!--FOOBAR-->')).toBe('');
  });

  it('parses basic format (upstream: "should parse basic format")', () => {
    // Upstream asserts handler events: tag='tag', attrs={attr:'value'}, text='text'.
    // DEVIATION: upstream's htmlParser test inspects raw tokenizer events;
    // our parity surface is the sanitizer OUTPUT. `<tag>` is unknown so it
    // enters drop mode via `dropDepth`, which swallows the entire subtree
    // — including the inner text 'text'. Reason: spec 013 § 2.4 — unknown
    // tags drop their full subtree, vs upstream's `blockedElements`-only
    // strict drop.
    expect(sanitize('<tag attr="value">text</tag>')).toBe('');
  });

  it('does not treat "<" followed by a non-/ or non-letter as a tag', () => {
    expect(sanitize('<- text1 text2 <1 text1 text2 <{')).toBe('&lt;- text1 text2 &lt;1 text1 text2 &lt;{');
  });

  it('accepts "<" inside real tags (upstream: "...such as < inside real tags")', () => {
    // Upstream observes that '<' inside `<p>...<` gets surfaced as text.
    // Our equivalent renders the `<` as `&lt;` per encodeEntities.
    expect(sanitize('<p> 10 < 100 </p>')).toBe('<p> 10 &lt; 100 </p>');
  });

  it('parses newlines in tags', () => {
    // DEVIATION: same drop-subtree behaviour as the basic-format case —
    // `<tag>` is unknown, so its subtree (including 'text') is swallowed.
    expect(sanitize('<tag\n attr="value"\n>text</\ntag\n>')).toBe('');
  });

  it('parses newlines in attributes', () => {
    // DEVIATION: same drop-subtree behaviour — see parses-basic-format.
    expect(sanitize('<tag attr="\nvalue\n">text</tag>')).toBe('');
  });

  it('parses namespace', () => {
    // DEVIATION: same drop-subtree behaviour — see parses-basic-format.
    expect(sanitize('<ns:t-a-g ns:a-t-t-r="\nvalue\n">text</ns:t-a-g>')).toBe('');
  });

  it('parses empty value attribute of node', () => {
    // DEVIATION: same drop-subtree behaviour — `<test-foo>` is unknown.
    expect(sanitize('<test-foo selected value="">abc</test-foo>')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// describe('HTML') root-level it(...)s — upstream sanitizeSpec.js:103-247
// ---------------------------------------------------------------------------
describe('core behaviour', () => {
  it('should echo html', () => {
    // Upstream `toBeOneOf` accepts attribute reordering; our regex tokenizer
    // preserves source order. Note: `'` (0x27) is INSIDE the
    // `[#-~ |!]` allow-class in `encodeEntities` (range starts at 0x23 `#`
    // and runs up to 0x7E `~`), so the apostrophe inside `class="1'23"`
    // round-trips literally. Double quotes (0x22) ARE outside the class →
    // emitted as `&#34;`.
    expect(sanitize(`hello<b class="1'23" align='""'>world</b>.`)).toBe(
      `hello<b class="1'23" align="&#34;&#34;">world</b>.`,
    );
  });

  it('should remove script', () => {
    // Upstream:
    //   'a<SCRIPT>evil< / scrIpt >c.' → 'a'
    //   'a<SCRIPT>evil</scrIpt>c.'    → 'ac.'
    //
    // The first input has no real `</script>` close (the whitespace inside
    // `< / scrIpt >` defeats the END_TAG_REGEXP), so dropDepth never decrements
    // and the trailing 'c.' is swallowed. The second input closes cleanly.
    expect(sanitize('a<SCRIPT>evil< / scrIpt >c.')).toBe('a');
    expect(sanitize('a<SCRIPT>evil</scrIpt>c.')).toBe('ac.');
  });

  it('should remove script that has newline characters', () => {
    expect(sanitize('a<SCRIPT\n>\n\revil\n\r</scrIpt\n >c.')).toBe('ac.');
  });

  it('should remove DOCTYPE header', () => {
    expect(sanitize('<!DOCTYPE html>')).toBe('');
    expect(
      sanitize('<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN"\n"http://www.w3.org/TR/html4/strict.dtd">'),
    ).toBe('');
    expect(sanitize('a<!DOCTYPE html>c.')).toBe('ac.');
    expect(sanitize('a<!DocTyPe html>c.')).toBe('ac.');
  });

  it('should escape non-start tags', () => {
    expect(sanitize('a< SCRIPT >A< SCRIPT >evil< / scrIpt >B< / scrIpt >c.')).toBe(
      'a&lt; SCRIPT &gt;A&lt; SCRIPT &gt;evil&lt; / scrIpt &gt;B&lt; / scrIpt &gt;c.',
    );
  });

  it('should remove attrs', () => {
    expect(sanitize('a<div style="abc">b</div>c')).toBe('a<div>b</div>c');
  });

  it('should handle large datasets', () => {
    // Upstream uses 2^17 = 131,072. We mirror that exactly to keep the
    // observable I/O identical.
    const largeNumber = 17;
    let result = '<div>b</div>';
    for (let i = 0; i < largeNumber; i++) {
      result += result;
    }
    expect(sanitize('a' + result + 'c')).toBe('a' + result + 'c');
  });

  it('should remove style', () => {
    expect(sanitize('a<STyle>evil</stYle>c.')).toBe('ac.');
  });

  it('should remove style that has newline characters', () => {
    expect(sanitize('a<STyle \n>\n\revil\n\r</stYle\n>c.')).toBe('ac.');
  });

  it('should remove script and style', () => {
    expect(sanitize('a<STyle>evil<script></script></stYle>c.')).toBe('ac.');
  });

  it('should remove double nested script', () => {
    // DEVIATION: upstream returned 'ailc.' — its tokenizer/sanitizer pair
    // surfaces the text BETWEEN inner `<script>...</script>` blocks while
    // staying inside the outer `<SCRIPT>` block (their writer drops only
    // the literal scripted regions). Ours bumps `dropDepth` for every
    // unknown tag, so the entire `ev<script>evil</sCript>il` payload is
    // swallowed before `</scrIpt>` decrements depth back to 0. Reason:
    // spec 013 § 2.4 — `dropDepth` strictly nests; cf. should-remove-unknown-names.
    expect(sanitize('a<SCRIPT>ev<script>evil</sCript>il</scrIpt>c.')).toBe('ac.');
  });

  it('should remove unknown names', () => {
    // Upstream expected: 'a<b>b</b>c' — the `<xxx>` wrapper is a blockedElement
    // upstream so its CONTENTS survive. Our `dropDepth` swallows the entire
    // unknown-tag subtree.
    // DEVIATION: upstream returned 'a<b>b</b>c'; ours drops the whole
    // `<xxx>...</xxx>` subtree (including the inner allowed `<B>`).
    // Reason: spec 013 § 2.4 — our `dropDepth` strategy treats any
    // non-allow-list element as a fully-removed subtree, while upstream
    // only fully removes `blockedElements` (`script`/`style`/`frame`/...) and
    // surfaces the children of every other unknown tag.
    expect(sanitize('a<xxx><B>b</B></xxx>c')).toBe('ac');
  });

  it('should remove unsafe value', () => {
    expect(sanitize('<a href="javascript:alert()">')).toBe('<a></a>');
    expect(sanitize('<img src="foo.gif" usemap="#foomap">')).toBe('<img src="foo.gif" usemap="#foomap">');
    // DEVIATION: upstream returned `<img src="foo.gif">` because its
    // attribute allow-list excludes `usemap` for `<img>` to defuse
    // form-clobbering. Our `VALID_ATTRS` includes `usemap` globally,
    // so the attribute survives. Reason: we mirror the upstream `htmlAttrs`
    // table without the per-tag exclusion logic — see spec 013 § 2.2.
  });

  it('should handle self closed elements', () => {
    expect(sanitize('a<hr/>c')).toBe('a<hr>c');
  });

  it('should handle namespace', () => {
    // DEVIATION: upstream returned 'abc' (drops only the unknown wrapper,
    // surfaces children). Our `dropDepth` swallows the inner 'b' along
    // with the unknown `<my:div>` subtree. The unary `<my:hr/>` does NOT
    // bump depth (per spec 013 § 2.4 — unary unknown tags never enter the
    // drop stack). Reason: same dropDepth nesting rule as
    // should-remove-unknown-names.
    expect(sanitize('a<my:hr/><my:div>b</my:div>c')).toBe('ac');
  });

  it('should handle entities', () => {
    const everything =
      '<div rel="!@#$%^&amp;*()_+-={}[]:&#34;;\'&lt;&gt;?,./`~ &#295;">' +
      "!@#$%^&amp;*()_+-={}[]:&#34;;'&lt;&gt;?,./`~ &#295;</div>";
    // DEVIATION: upstream round-trips `everything` because its writer treats
    // attribute values as already-encoded source HTML. Ours has no
    // entity-decode pass — the `&` in every existing entity reference gets
    // re-encoded to `&amp;`, so `&amp;` becomes `&amp;amp;`, `&#34;`
    // becomes `&amp;#34;`, etc. Reason: spec 013 § 2.6 — no decodeEntities.
    // Apostrophe `'` (0x27) is INSIDE `[#-~]` so it round-trips literally.
    expect(sanitize(everything)).toBe(
      `<div rel="!@#$%^&amp;amp;*()_+-={}[]:&amp;#34;;'&amp;lt;&amp;gt;?,./\`~ &amp;#295;">!@#$%^&amp;amp;*()_+-={}[]:&amp;#34;;'&amp;lt;&amp;gt;?,./\`~ &amp;#295;</div>`,
    );
  });

  it('should mangle improper html', () => {
    // DEVIATION: upstream's mangling preserves the inner `</div>` text
    // because its tokenizer treats it as part of the malformed attribute.
    // Ours: the leading `< div...` has whitespace after `<`, so it falls
    // to the literal-`<` branch. The `</div>` inside the source then
    // matches END_TAG_REGEXP at the next loop iteration and is consumed
    // as a real (spurious, no-stack) end tag — leaving an empty quoted
    // value `""` between the two `"` chars in the output. Reason: regex
    // tokenizer ambiguity, surfaced not worked around — spec 013 § 2.4.
    // Apostrophes inside `dir='"'` survive literally (0x27 in `[#-~]`).
    expect(sanitize(`< div rel="</div>" alt=abc dir='"' >text< /div>`)).toBe(
      `&lt; div rel=&#34;&#34; alt=abc dir='&#34;' &gt;text&lt; /div&gt;`,
    );
  });

  it('should mangle improper html2', () => {
    // DEVIATION: same `</div>` consumption as the previous case — the
    // `</div>` inside the malformed `rel="..."` is eaten as a spurious
    // end tag, leaving `""`. Reason: spec 013 § 2.4 regex tokenizer.
    expect(sanitize(`< div rel="</div>" / >`)).toBe(`&lt; div rel=&#34;&#34; / &gt;`);
  });

  it('should ignore back slash as escape', () => {
    // Upstream returns one of two attribute orderings; ours preserves source order.
    expect(sanitize('<img alt="xxx\\" title="><script>....">')).toBe(
      '<img alt="xxx\\" title="&gt;&lt;script&gt;....">',
    );
  });

  it('should ignore object attributes', () => {
    expect(sanitize('<a constructor="hola">:)</a>')).toBe('<a>:)</a>');
    expect(sanitize('<constructor constructor="hola">:)</constructor>')).toBe('');
  });

  it('should keep spaces as prefix/postfix', () => {
    expect(sanitize(' a ')).toBe(' a ');
  });

  it('should allow multiline strings', () => {
    expect(sanitize('\na\n')).toBe('&#10;a&#10;');
  });

  it('accepts tag delimiters such as "<" inside real tags (with nesting)', () => {
    // DEVIATION: upstream returned `<p> 10 &lt; <span>100</span> </p>` because
    // its DOM-based parser preserves the `<p>` open across the bare `<`. Our
    // regex tokenizer sees `<` followed by space — which fails START_TAG_REGEXP
    // — so the `<` falls through as a literal character. But `<p>` is in
    // OPTIONAL_END_TAG_BLOCK_ELEMENTS, so when the next start tag (`<span>`)
    // opens, the auto-close rule fires and closes `<p>` BEFORE `<span>` opens.
    // Result: `<p>` closes early with the literal-encoded `&lt; ` as its body,
    // then `<span>...</span>` follows as a sibling. Reason: tokenizer
    // optional-end-tag heuristic fires before the user's literal-`<` was meant
    // to be inside `<p>`. Surfaced not worked around.
    expect(sanitize('<p> 10 < <span>100</span> </p>')).toBe('<p> 10 &lt; </p><span>100</span> ');
  });

  it('should accept non-string arguments', () => {
    expect(sanitize(null)).toBe('');
    expect(sanitize(undefined)).toBe('');
    expect(sanitize(42)).toBe('42');
    expect(sanitize({})).toBe('[object Object]');
    expect(sanitize([1, 2, 3])).toBe('1,2,3');
    expect(sanitize(true)).toBe('true');
    expect(sanitize(false)).toBe('false');
  });

  it('should strip svg elements if not enabled via provider', () => {
    expect(
      sanitize(
        '<svg width="400px" height="150px" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" stroke="black" stroke-width="3" fill="red"></svg>',
      ),
    ).toBe('');
  });

  it('should prevent mXSS attacks', () => {
    // Our DEFAULT_URI_PATTERN explicitly fails the raw `&#x3000;javascript:`
    // string — the `&` falls outside the safe scheme branches, and the
    // overall pattern's `:` placement check disqualifies the value. So
    // `<a href="&#x3000;javascript:alert(1)">` strips the href, matching
    // upstream's observable behaviour even though the mechanism differs
    // (upstream decodes entities first; we reject pre-decode on the raw form).
    expect(sanitize('<a href="&#x3000;javascript:alert(1)">CLICKME</a>')).toBe('<a>CLICKME</a>');
  });

  it('should strip html comments', () => {
    expect(sanitize('<!-- comment 1 --><p>text1<!-- comment 2 -->text2</p><!-- comment 3 -->')).toBe(
      '<p>text1text2</p>',
    );
  });
});

// ---------------------------------------------------------------------------
// describe('clobbered elements') — upstream sanitizeSpec.js:249
// ---------------------------------------------------------------------------
describe('clobbered elements', () => {
  // DEVIATION: covered by sanitize-esm.test.ts and not applicable as-is.
  // Upstream's `elclob` minErr is thrown by the DOM-based sanitizer when it
  // detects DOM-property clobbering on the inert document host. Our
  // regex-based tokenizer never constructs a DOM and therefore cannot
  // observe parentNode/nextSibling clobbering. The corresponding inputs
  // sanitize to a benign string with the dangerous attribute simply dropped.
  it.skip('should throw on a form with an input named "parentNode" — N/A regex tokenizer', () => {
    // not applicable
  });

  it.skip('should throw on a form with an input named "nextSibling" — N/A regex tokenizer', () => {
    // not applicable
  });

  // DEVIATION: upstream test verifies `window.xxx` is not set after
  // sanitizing inert DOM. We never construct a DOM so JS execution is
  // structurally impossible. The corresponding inputs sanitize to safe
  // strings — assert that, since execution-side-effects are not observable.
  it('should not allow JavaScript execution when creating inert document (text-output check)', () => {
    // Upstream verifies side-effect absence; we verify the equivalent: the
    // dangerous SVG content never reaches output.
    expect(sanitize('<svg><g onload="window.xxx = 100"></g></svg>')).toBe('');
  });

  it('should not allow JavaScript hidden in badly formed HTML to get through sanitization (Firefox bug)', () => {
    // Upstream expected `<p><img src="x"></p>` — DOM-based parser quirks.
    // DEVIATION: ours feeds the raw input through the regex tokenizer.
    // `<svg>` is not in the default allow-list so its subtree is dropped via
    // `dropDepth`; the malformed `<style>` tail with `</style><img …` reads
    // differently to a regex than to a DOM parser. Pinning our actual.
    expect(sanitize('<svg><p><style><img src="</style><img src=x onerror=alert(1)//">')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// describe('Custom white-list support') — upstream sanitizeSpec.js:296
// ---------------------------------------------------------------------------
//
// Upstream uses provider-mode `addValidElements`/`addValidAttrs`. Our
// `createSanitize({ extraValidElements, extraValidAttrs })` is the ESM
// equivalent. `sanitize-provider.test.ts` already covers the provider
// branch; here we replay the upstream `it(...)` cases through the ESM API
// for breadth.
describe('custom white-list support', () => {
  it('should allow custom white-listed element', () => {
    const s = createSanitize({ extraValidElements: ['foo', 'foo-button', 'foo-video'] });
    expect(s('<foo></foo>')).toBe('<foo></foo>');
    expect(s('<foo-button></foo-button>')).toBe('<foo-button></foo-button>');
    expect(s('<foo-video></foo-video>')).toBe('<foo-video></foo-video>');
  });

  it('should allow custom white-listed void element', () => {
    // DEVIATION: covered by sanitize-provider.test.ts for the
    // `htmlVoidElements` bucket-form path. ESM `extraValidElements` does NOT
    // mark the element as void, so our output emits a closing tag.
    const s = createSanitize({ extraValidElements: ['foo-input'] });
    // Our ESM API has no void-flag bucket; `<foo-input/>` is parsed as a
    // syntactic unary — no closing tag emitted because the element never
    // entered the open-tag stack.
    expect(s('<foo-input/>')).toBe('<foo-input>');
  });

  it('should allow custom white-listed void element to be used with closing tag', () => {
    // DEVIATION: upstream returned `<foo-input>` because the provider's
    // void-flag prevents the close from emitting. Our ESM API has no
    // void bucket — element opens, then closes normally.
    const s = createSanitize({ extraValidElements: ['foo-input'] });
    expect(s('<foo-input></foo-input>')).toBe('<foo-input></foo-input>');
  });

  it('should allow custom white-listed attribute', () => {
    const s = createSanitize({ extraValidElements: ['foo-input'], extraValidAttrs: ['foo'] });
    // DEVIATION: upstream returned `<foo-input foo="foo">` (void). Our ESM
    // API lacks the void bucket, so the syntactic-unary input emits no
    // closing tag (parser saw `/`), giving the same shape.
    expect(s('<foo-input foo="foo"/>')).toBe('<foo-input foo="foo">');
  });

  it('should ignore custom white-listed SVG element if SVG disabled', () => {
    // Upstream provider's `addValidElements({ svgElements: ['foo-svg'] })`
    // is a no-op when `enableSvg(false)`. ESM equivalent: pass via
    // `extraValidElements` only when `svgEnabled: true`.
    const s = createSanitize({ extraValidElements: [] /* svgEnabled defaults to false */ });
    expect(s('<foo-svg></foo-svg>')).toBe('');
  });

  it('should not allow add custom element after service has been instantiated', () => {
    // Upstream verifies that mutating `$sanitizeProvider.addValidElements`
    // after `$sanitize` is constructed has no effect. ESM equivalent: the
    // options object passed to `createSanitize` is read once and frozen.
    const extras = ['bar'];
    const s = createSanitize({ extraValidElements: extras });
    // Mutating the array post-construction has no effect on the closed-over
    // allow-list.
    extras.push('baz');
    expect(s('<bar></bar>')).toBe('<bar></bar>');
    expect(s('<baz></baz>')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// describe('SVG support') — upstream sanitizeSpec.js:339
// ---------------------------------------------------------------------------
describe('SVG support', () => {
  it('should accept SVG tags', () => {
    const s = createSanitize({ svgEnabled: true });
    // DEVIATION: upstream `toBeOneOf` accepts attribute reordering from
    // browser DOM normalization. Ours preserves source order.
    expect(
      s(
        '<svg width="400px" height="150px" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" stroke="black" stroke-width="3" fill="red"></svg>',
      ),
    ).toBe(
      '<svg width="400px" height="150px" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" stroke="black" stroke-width="3" fill="red"></circle></svg>',
    );
  });

  it('should not ignore white-listed svg camelCased attributes', () => {
    const s = createSanitize({ svgEnabled: true });
    // DEVIATION: upstream `toBeOneOf` accepts a default-namespace addition
    // (`xmlns="http://www.w3.org/2000/svg"`) injected by the browser DOM.
    // Our regex tokenizer never injects namespaces; the source is echoed.
    // Also: our tokenizer lowercases attribute names. `preserveAspectRatio`
    // becomes `preserveaspectratio`, which is not in our SVG_ATTRS set
    // (which contains the camelCased name). DEVIATION: pinning our actual.
    expect(s('<svg preserveAspectRatio="true"></svg>')).toBe('<svg></svg>');
  });

  it('should allow custom white-listed SVG element', () => {
    const s = createSanitize({ svgEnabled: true, extraValidElements: ['font-face-uri'] });
    expect(s('<font-face-uri></font-face-uri>')).toBe('<font-face-uri></font-face-uri>');
  });

  it('should sanitize SVG xlink:href attribute values (javascript)', () => {
    const s = createSanitize({ svgEnabled: true });
    // DEVIATION: upstream `toBeOneOf` accepts xmlns reordering. Ours preserves.
    expect(
      s(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="javascript:alert()"></a></svg>',
      ),
    ).toBe('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a></a></svg>');
  });

  it('should sanitize SVG xlink:href attribute values (https)', () => {
    const s = createSanitize({ svgEnabled: true });
    expect(
      s(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="https://example.com"></a></svg>',
      ),
    ).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="https://example.com"></a></svg>',
    );
  });

  it('should sanitize SVG xml:base attribute values (javascript)', () => {
    const s = createSanitize({ svgEnabled: true });
    // DEVIATION: `xml:base` is in our SVG_ATTRS set but NOT in URI_ATTRS, so
    // the URI regex never runs against it. Upstream gates `xml:base` through
    // `$$sanitizeUri`. Pinning our actual: the `javascript:` value survives.
    // Reason: spec 013 didn't extend URI_ATTRS to cover `xml:base`. This is
    // a production-code concern surfaced (not worked around) per the brief.
    expect(s('<svg xmlns="http://www.w3.org/2000/svg"><a xml:base="javascript:alert(1)//" href="#"></a></svg>')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"><a xml:base="javascript:alert(1)//" href="#"></a></svg>',
    );
  });

  it('should sanitize SVG xml:base attribute values (https)', () => {
    const s = createSanitize({ svgEnabled: true });
    expect(s('<svg xmlns="http://www.w3.org/2000/svg"><a xml:base="https://example.com" href="#"></a></svg>')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"><a xml:base="https://example.com" href="#"></a></svg>',
    );
  });

  it('should sanitize unknown namespaced SVG attributes (javascript)', () => {
    const s = createSanitize({ svgEnabled: true });
    expect(
      s(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:foo="javascript:alert()"></a></svg>',
      ),
    ).toBe('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a></a></svg>');
  });

  it('should sanitize unknown namespaced SVG attributes (https)', () => {
    const s = createSanitize({ svgEnabled: true });
    expect(
      s(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:bar="https://example.com"></a></svg>',
      ),
    ).toBe('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a></a></svg>');
  });

  it('should not accept SVG animation tags (animate via xlink:href)', () => {
    const s = createSanitize({ svgEnabled: true });
    // DEVIATION: upstream's expected drops the `<animate>` tag because it's
    // not in the SVG element allow-list. Ours: `<animate>` is also not in
    // SVG_ELEMENTS, so it's dropped via `dropDepth` along with its (empty)
    // body. Pinning observed output.
    expect(
      s(
        '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><a><text y="1em">Click me</text><animate attributeName="xlink:href" values="javascript:alert(1)"/></a></svg>',
      ),
    ).toBe('<svg xmlns:xlink="http://www.w3.org/1999/xlink"><a><text y="1em">Click me</text></a></svg>');
  });

  it('should not accept SVG animation tags (animate via from/to)', () => {
    const s = createSanitize({ svgEnabled: true });
    // DEVIATION: ours drops the disallowed `<animate>` start as syntactic-
    // unary (`/>`); upstream filters via DOM. Output shape matches upstream
    // first `toBeOneOf` candidate.
    expect(
      s(
        '<svg><a xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="?"><circle r="400"></circle>' +
          '<animate attributeName="xlink:href" begin="0" from="javascript:alert(1)" to="&" /></a></svg>',
      ),
    ).toBe('<svg><a xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="?"><circle r="400"></circle></a></svg>');
  });

  it('should not accept SVG `use` tags', () => {
    const s = createSanitize({ svgEnabled: true });
    // DEVIATION: `<use>` IS in our SVG_ELEMENTS set (it appears in the
    // upstream `svgElements` table), so the tag survives. Upstream
    // explicitly DROPS `<use>` via a separate hardening (it's a known mXSS
    // vector). Pinning our actual; this is a production-code concern
    // surfaced — see spec 013 § 2.3 (SVG_ELEMENTS faithful-port note).
    // The trailing `/>` syntactically marks the `<use>` as unary, so no end
    // tag is emitted — the element is allowed in SVG_ELEMENTS but is treated
    // as void in this exact source shape.
    expect(s('<svg><use xlink:href="test.svg#xss" /></svg>')).toBe('<svg><use xlink:href="test.svg#xss"></svg>');
  });
});

// ---------------------------------------------------------------------------
// describe('htmlSanitizerWriter') — upstream sanitizeSpec.js:424
// ---------------------------------------------------------------------------
//
// Upstream tests drive `htmlSanitizeWriter` directly. We don't expose a
// writer — equivalent behaviour is observable through `sanitize(...)`.
describe('htmlSanitizerWriter (observed via sanitize)', () => {
  it('should write basic HTML', () => {
    expect(sanitize('before<div rel="123">in</div>after')).toBe('before<div rel="123">in</div>after');
  });

  it('should escape text nodes', () => {
    expect(sanitize('a<div>&</div>c')).toBe('a<div>&amp;</div>c');
    // DEVIATION: upstream's writer test feeds raw chars to `chars()` which
    // produces `a&lt;div&gt;&amp;&lt;/div&gt;c`. Our equivalent invocation
    // is `sanitize(...)`, which tokenizes the input first — `<div>` parses
    // as a real start tag, so the output preserves the tag and escapes only
    // the `&`. Reason: there is no public char-only API; test the invariant
    // through the production-shaped pipeline.
  });

  it('should escape "IE script" runs', () => {
    // Upstream feeds `&<>{}` to `chars` directly → `&amp;&lt;&gt;{}`.
    // Our `sanitize` sees `&<>{}`: `&` chars first, then `<>` is parsed as
    // BEGIN_TAG_REGEXP but neither end nor start matches, so `<` and `>` and
    // `{}` go through char paths.
    expect(sanitize('&<>{}')).toBe('&amp;&lt;&gt;{}');
  });

  it('should escape attributes', () => {
    // Source attribute value contains a literal NUL and CR. Upstream
    // round-trips them as `&#0;` and `&#13;`.
    // DEVIATION: upstream's `encodeEntities` writes `'` (0x27) as `&#39;`.
    // Ours uses NON_ALPHANUMERIC_REGEXP `[^#-~ |!]` whose printable range
    // `#`(0x23)-`~`(0x7E) INCLUDES the apostrophe (0x27) — so `'` round-trips
    // literally. Reason: spec 013 § 2.6 — we mirror upstream's exact regex,
    // which means apostrophe escaping diverges by one character class member.
    // DEVIATION: upstream test only opens `<div>` (no close) and asserts
    // exactly `<div rel="...">`. Our `sanitize` always closes block-level
    // elements at end-of-input; we get a trailing `</div>`. Also, our
    // tokenizer doesn't entity-decode, so `&quot;` pre-decoded source survives
    // as `&amp;quot;`. Reason: spec 013 does not implement entity decoding
    // at tokenize time.
    expect(sanitize('<div rel="!@#$%^&*()_+-={}[]:&quot;;\'<>?,./`~ \n\0\rħ">')).toBe(
      '<div rel="!@#$%^&amp;*()_+-={}[]:&amp;quot;;\'&lt;&gt;?,./`~ &#10;&#0;&#13;&#295;"></div>',
    );
  });

  it('should ignore misformed elements', () => {
    // Upstream's `writer.start('d>i&v', {})` is impossible at the public
    // surface because the tokenizer would never emit such a tag name. We
    // approximate by feeding the closest equivalent malformed source.
    // DEVIATION: not directly portable — upstream writer is internal-only.
    // `<d>` is not in VALID_ELEMENTS (only `<dd>`, `<div>`, `<dl>`, etc.),
    // so it enters drop-subtree mode and the `i&v` text is swallowed too.
    // Reason: same dropDepth subtree drop as `should-remove-unknown-names`.
    expect(sanitize('<d>i&v')).toBe('');
  });

  it('should ignore unknown attributes', () => {
    expect(sanitize('<div unknown=""></div>')).toBe('<div></div>');
  });

  it('should handle surrogate pair', () => {
    // String.fromCharCode(55357, 56374) = 🐶 (U+1F436). Upstream encodes
    // as `&#128054;`.
    expect(sanitize(String.fromCharCode(55357, 56374))).toBe('&#128054;');
  });

  describe('explicitly disallow', () => {
    it('should not allow attributes (id, name, style)', () => {
      // Upstream's `writer.start('div', {id:'a', name:'a', style:'a'})` →
      // `<div>` — none of those attributes survive its writer-level allow-list.
      // DEVIATION: our `VALID_ATTRS` INCLUDES `name`. So `name` survives. The
      // upstream writer-level test asserted on the writer's stricter
      // attribute set (it filters id/name/style at write time). Our
      // `<a name="...">` is allowed because `name` is in the global
      // VALID_ATTRS table. Pinning our actual.
      expect(sanitize('<div id="a" name="a" style="a"></div>')).toBe('<div name="a"></div>');
    });

    it('should not allow tags (frameset, frame, form, ...)', () => {
      // Upstream iterates a list of tag names through the writer and asserts
      // total empty output. Ours: each tag is unknown → dropped via dropDepth.
      const tags = [
        'frameset',
        'frame',
        'form',
        'param',
        'object',
        'embed',
        'textarea',
        'input',
        'button',
        'option',
        'select',
        'script',
        'style',
        'link',
        'base',
        'basefont',
      ];
      let html = '';
      for (const t of tags) {
        html += '<' + t + '></' + t + '>';
      }
      expect(sanitize(html)).toBe('');
    });
  });

  describe('uri validation', () => {
    // DEVIATION: upstream uses spies on the internal `uriValidator`. We have
    // no separate validator surface — URI gating is inlined in the
    // sanitizer. The OBSERVABLE behaviour is captured by the regex
    // pass/fail outcome, exercised in the next two cases.
    it('should drop non valid uri attributes (javascript:)', () => {
      expect(sanitize('<a href="javascript:alert()"></a>')).toBe('<a></a>');
    });

    it('should keep valid uri attributes (relative)', () => {
      expect(sanitize('<a href="someUrl"></a>')).toBe('<a href="someUrl"></a>');
    });
  });
});

// ---------------------------------------------------------------------------
// describe('uri checking') — upstream sanitizeSpec.js:530
// ---------------------------------------------------------------------------
//
// Upstream uses a custom Jasmine matcher `toBeValidUrl` that wraps the URL
// in `<a href="...">` and asserts round-trip. We mirror that here as a
// helper local to this block.
describe('uri checking', () => {
  function isValidUrl(url: string): boolean {
    const input = '<a href="' + url + '"></a>';
    return sanitize(input) === input;
  }

  // DEVIATION: upstream tests `$$sanitizeUri` injection via DI. Our ESM
  // `createSanitize({ uriPattern })` is the closest equivalent and is
  // covered comprehensively in `sanitize-esm.test.ts`. Skipping the
  // injection mechanics here.
  it.skip('should use $$sanitizeUri for a[href] links — covered by sanitize-esm.test.ts', () => {});
  it.skip('should use $$sanitizeUri for img[src] links — covered by sanitize-esm.test.ts', () => {});

  it('should be URI', () => {
    expect(isValidUrl('')).toBe(true);
    expect(isValidUrl('http://abc')).toBe(true);
    expect(isValidUrl('HTTP://abc')).toBe(true);
    expect(isValidUrl('https://abc')).toBe(true);
    expect(isValidUrl('HTTPS://abc')).toBe(true);
    expect(isValidUrl('ftp://abc')).toBe(true);
    expect(isValidUrl('FTP://abc')).toBe(true);
    expect(isValidUrl('mailto:me@example.com')).toBe(true);
    expect(isValidUrl('MAILTO:me@example.com')).toBe(true);
    expect(isValidUrl('tel:123-123-1234')).toBe(true);
    expect(isValidUrl('TEL:123-123-1234')).toBe(true);
    expect(isValidUrl('#anchor')).toBe(true);
    expect(isValidUrl('/page1.md')).toBe(true);
  });

  it('should not be URI (literal javascript:)', () => {
    expect(isValidUrl('javascript:alert')).toBe(false);
  });

  describe('javascript URLs', () => {
    it('should ignore javascript:', () => {
      expect(isValidUrl('JavaScript:abc')).toBe(false);
      expect(isValidUrl(' \n Java\n Script:abc')).toBe(false);
      expect(isValidUrl('http://JavaScript/my.js')).toBe(true);
    });

    it('should ignore dec encoded javascript:', () => {
      // DEVIATION: upstream's `$$sanitizeUri` decodes HTML entities before
      // protocol matching, catching `&#106;…&#58;` as `javascript:`. Our
      // regex tests the raw string, where `&#106;…` looks like a relative
      // path and matches the safe-fallback branch. Pinning our actual:
      // these encoded forms SURVIVE our default URI regex.
      expect(isValidUrl('&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;')).toBe(false);
      // DEVIATION: ours returns `true` for raw entity-only strings because
      // the trimmed value has no `:` until decoded. Output's encoded form
      // (`&amp;#106;…`) doesn't equal the input so round-trip fails; thus
      // `isValidUrl` returns false here too — matching upstream.
      expect(isValidUrl('&#106&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;')).toBe(false);
      expect(isValidUrl('&#106 &#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;')).toBe(false);
    });

    it('should ignore decimal with leading 0 encoded javascript:', () => {
      // DEVIATION: same as above — round-trip fails because `&` is
      // re-encoded as `&amp;`, so `isValidUrl` reports false matching
      // upstream's intent (block) but for a different reason.
      expect(
        isValidUrl(
          '&#0000106&#0000097&#0000118&#0000097&#0000115&#0000099&#0000114&#0000105&#0000112&#0000116&#0000058',
        ),
      ).toBe(false);
      expect(
        isValidUrl(
          '&#0000106 &#0000097&#0000118&#0000097&#0000115&#0000099&#0000114&#0000105&#0000112&#0000116&#0000058',
        ),
      ).toBe(false);
      expect(
        isValidUrl(
          '&#0000106; &#0000097&#0000118&#0000097&#0000115&#0000099&#0000114&#0000105&#0000112&#0000116&#0000058',
        ),
      ).toBe(false);
    });

    it('should ignore hex encoded javascript:', () => {
      // DEVIATION: same round-trip mechanism as above.
      expect(isValidUrl('&#x6A&#x61&#x76&#x61&#x73&#x63&#x72&#x69&#x70&#x74&#x3A;')).toBe(false);
      expect(isValidUrl('&#x6A;&#x61&#x76&#x61&#x73&#x63&#x72&#x69&#x70&#x74&#x3A;')).toBe(false);
      expect(isValidUrl('&#x6A &#x61&#x76&#x61&#x73&#x63&#x72&#x69&#x70&#x74&#x3A;')).toBe(false);
    });

    it('should ignore hex encoded whitespace javascript:', () => {
      // DEVIATION: upstream decodes `&#x09;` → tab and detects
      // `javascript:`; ours sees raw `&#x09;` literal. Round-trip via
      // sanitize fails (entity gets re-encoded), so `isValidUrl` reports
      // false — same OBSERVABLE outcome, different mechanism.
      expect(isValidUrl('jav&#x09;ascript:alert();')).toBe(false);
      expect(isValidUrl('jav&#x0A;ascript:alert();')).toBe(false);
      expect(isValidUrl('jav&#x0A ascript:alert();')).toBe(false);
      expect(isValidUrl('jav ascript:alert();')).toBe(false);
      expect(isValidUrl('java  script:alert();')).toBe(false);
      expect(isValidUrl(' &#14; java  script:alert();')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// describe('sanitizeText') — upstream sanitizeSpec.js:638
// ---------------------------------------------------------------------------
//
// `sanitizeText` (upstream) is `encodeEntities` wrapped in a no-element
// shortcut. We don't export `encodeEntities` directly — the observable
// equivalent is `sanitize('plain text with < & >')`.
describe('sanitizeText (observed via sanitize)', () => {
  it('should escape text', () => {
    // Upstream: `sanitizeText('a<div>&</div>c')` → `a&lt;div&gt;&amp;&lt;/div&gt;c`.
    // Through our `sanitize`, `<div>` parses as a real tag — so we get
    // `<div>` preserved and only `&` re-escaped.
    // DEVIATION: production-code concern — we lack a public char-only
    // entity-encoding API. This test simulates the closest observable
    // equivalent.
    expect(sanitize('a<div>&</div>c')).toBe('a<div>&amp;</div>c');
  });
});

// ---------------------------------------------------------------------------
// describe('decodeEntities') — upstream sanitizeSpec.js:646
// ---------------------------------------------------------------------------
//
// Upstream's `htmlParser` decodes character entity references in text via
// the `decodeEntities` helper. Ours does NOT — the regex tokenizer surfaces
// raw text and `encodeEntities` re-escapes `&` on output. This is a known
// divergence (spec 013 § 2.6).
describe('decodeEntities (observed via sanitize)', () => {
  it('should unescape text (DEVIATION: ours does not decode entities)', () => {
    // Upstream: `&lt;div&gt;` decodes to `<div>` text node, which then
    // re-encodes as `&lt;div&gt;` — net round-trip identity.
    // Ours: `&lt;div&gt;` is treated as a literal `&lt;div&gt;` and the `&`
    // is re-encoded → `&amp;lt;div&amp;gt;`.
    expect(sanitize('a&lt;div&gt;&amp;&lt;/div&gt;c')).toBe('a&amp;lt;div&amp;gt;&amp;amp;&amp;lt;/div&amp;gt;c');
  });

  it('should preserve whitespace (DEVIATION: same encoding mechanic as above)', () => {
    expect(sanitize('  a&amp;b ')).toBe('  a&amp;amp;b ');
  });
});
