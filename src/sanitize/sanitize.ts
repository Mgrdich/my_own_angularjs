/**
 * `createSanitize` factory and the default `sanitize` instance.
 *
 * Hand-port of the runtime sanitization pipeline in
 * `angular/angular.js/src/ngSanitize/sanitize.js` at v1.8.3 — the
 * tokenizer drives a `TokenHandler` closure that gates each token
 * against frozen element/attribute allow-lists, runs URI-bearing
 * attribute values through a protocol regex, and entity-encodes every
 * surviving text/attribute value via `encodeEntities`.
 *
 * The returned service is a plain callable closure (not a class) so it
 * is safely destructurable from the injector and from `import`-style
 * pure-ESM consumers. Effective allow-lists are resolved once at factory
 * call time and frozen for the lifetime of the returned service —
 * post-construction mutation of the caller's option arrays cannot
 * affect sanitization.
 *
 * @see https://github.com/angular/angular.js/blob/v1.8.3/src/ngSanitize/sanitize.js
 */

import { isString } from '@core/utils';
import {
  DEFAULT_URI_PATTERN,
  SVG_ATTRS,
  SVG_ELEMENTS,
  URI_ATTRS,
  VALID_ATTRS,
  VALID_ELEMENTS,
  VOID_ELEMENTS,
} from '@sanitize/sanitize-allow-lists';
import { htmlParser, type TokenHandler } from '@sanitize/sanitize-tokenizer';
import type { SanitizeOptions, SanitizeService } from '@sanitize/sanitize-types';

const SURROGATE_PAIR_REGEXP = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
const NON_ALPHANUMERIC_REGEXP = /([^#-~ |!])/g;

function encodeEntities(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(SURROGATE_PAIR_REGEXP, (match) => {
      const hi = match.charCodeAt(0);
      const lo = match.charCodeAt(1);
      return '&#' + String((hi - 0xd800) * 0x400 + (lo - 0xdc00) + 0x10000) + ';';
    })
    .replace(NON_ALPHANUMERIC_REGEXP, (match) => '&#' + String(match.charCodeAt(0)) + ';')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function mergeSet(base: ReadonlySet<string>, extras: readonly string[] | undefined, svgExtras?: ReadonlySet<string>) {
  if ((extras === undefined || extras.length === 0) && svgExtras === undefined) {
    return base;
  }
  const merged = new Set<string>(base);
  if (svgExtras !== undefined) {
    for (const value of svgExtras) {
      merged.add(value);
    }
  }
  if (extras !== undefined) {
    for (const value of extras) {
      merged.add(value);
    }
  }
  return merged;
}

/**
 * Build a configured `$sanitize` service.
 *
 * The returned function takes any value and returns a safe HTML string —
 * `null`/`undefined` collapse to `''`, non-strings are coerced via
 * `String()`, and disallowed tags / attributes / URI schemes are stripped.
 *
 * @example
 * const sanitize = createSanitize();
 * sanitize('<a href="javascript:alert(1)">x</a><script>bad()</script>');
 * // => '<a>x</a>'
 *
 * @example
 * const sanitize = createSanitize({ extraValidElements: ['custom-tag'] });
 * sanitize('<custom-tag>hi</custom-tag>');
 * // => '<custom-tag>hi</custom-tag>'
 */
export function createSanitize(options: SanitizeOptions = {}): SanitizeService {
  const svgEnabled = options.svgEnabled === true;
  const validElements = mergeSet(VALID_ELEMENTS, options.extraValidElements, svgEnabled ? SVG_ELEMENTS : undefined);
  // Upstream AngularJS computes `validAttrs = uriAttrs ∪ htmlAttrs` (see
  // `angular/angular.js/src/ngSanitize/sanitize.js` v1.8.3). Our base
  // `VALID_ATTRS` constant pins the `htmlAttrs`-only port, so we union in
  // `URI_ATTRS` here to recover the upstream effective set — without this,
  // URI-only attribute names like `src`, `xlink:href`, and `background`
  // are dropped before the URI regex gate ever runs.
  const validAttrs: ReadonlySet<string> = new Set<string>([
    ...VALID_ATTRS,
    ...URI_ATTRS,
    ...(svgEnabled ? SVG_ATTRS : []),
    ...(options.extraValidAttrs ?? []),
  ]);
  const uriAttrs = URI_ATTRS;
  const uriPattern = options.uriPattern ?? DEFAULT_URI_PATTERN;
  const voidElements = VOID_ELEMENTS;

  return (input: unknown): string => {
    if (input === null || input === undefined) {
      return '';
    }
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- spec contract: non-string inputs are coerced via `String()`; an object collapsing to `[object Object]` is the documented behavior, mirroring AngularJS's lack of explicit coercion.
    const html = isString(input) ? input : String(input);
    if (html === '') {
      return '';
    }

    let out = '';
    let dropDepth = 0;

    const handler: TokenHandler = {
      start(tag, attrs, unary) {
        if (!validElements.has(tag)) {
          // Disallowed start: enter a drop subtree only when the tag has
          // a matching end coming. Unary tags emit no end, so bumping
          // dropDepth here would unbalance the stack on the next allowed
          // sibling.
          if (!unary) {
            dropDepth++;
          }
          return;
        }
        if (dropDepth > 0) {
          if (!unary) {
            dropDepth++;
          }
          return;
        }
        out += '<' + tag;
        for (const [name, value] of attrs) {
          if (!validAttrs.has(name)) {
            continue;
          }
          if (uriAttrs.has(name)) {
            // Spec: trim before regex test; keep the original value for
            // the emitted attribute (so the round-trip preserves caller
            // whitespace) and re-encode via `encodeEntities`.
            if (!uriPattern.test(value.trim())) {
              continue;
            }
          }
          out += ' ' + name + '="' + encodeEntities(value) + '"';
        }
        out += '>';
      },
      end(tag) {
        if (dropDepth > 0) {
          dropDepth--;
          return;
        }
        if (validElements.has(tag) && !voidElements.has(tag)) {
          out += '</' + tag + '>';
        }
      },
      chars(text) {
        if (dropDepth > 0) {
          return;
        }
        out += encodeEntities(text);
      },
      comment() {
        // Comments are dropped unconditionally — they can carry IE
        // conditional-comment payloads that smuggle script content.
      },
    };

    htmlParser(html, handler);
    return out;
  };
}

/**
 * Pre-configured default `$sanitize` service — equivalent to
 * `createSanitize()` with no overrides.
 *
 * @example
 * import { sanitize } from 'my-own-angularjs/sanitize';
 * sanitize('<b onclick="x()">hi</b>'); // => '<b>hi</b>'
 */
export const sanitize: SanitizeService = createSanitize();
