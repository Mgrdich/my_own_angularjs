/**
 * Faithful regex-based HTML tokenizer.
 *
 * Hand-port of the `htmlParser` state machine in
 * `angular/angular.js/src/ngSanitize/sanitize.js` at v1.8.3, retyped for
 * strict TypeScript. The job here is purely structural: scan the input
 * string, recognize the four token kinds AngularJS recognizes (start
 * tags, end tags, comments, character data), and feed them to a
 * caller-supplied {@link TokenHandler}. Allow-list filtering is the
 * caller's concern — Slice 3 (`createSanitize`) layers element/attribute
 * gating on top of these structural events.
 *
 * Variable names mirror upstream where they exist — including the
 * upstream typo `BEGING_END_TAGE_REGEXP` — so future maintainers can
 * map this file line-by-line back to the reference and to the historical
 * CVE write-ups that reference those identifiers.
 *
 * Intentional simplifications versus upstream:
 *
 * - The optional-end-tag implicit-closure rule is collapsed: when a new
 *   start tag is opened while the stack top is in
 *   `OPTIONAL_END_TAG_BLOCK_ELEMENTS` or `OPTIONAL_END_TAG_INLINE_ELEMENTS`,
 *   the open tag is auto-closed first. Upstream additionally gates the
 *   block branch on the new tag being itself a block element; we do not
 *   maintain the BLOCK_ELEMENTS allow-list at the tokenizer layer
 *   because the tokenizer is allow-list-agnostic. The consumer can
 *   re-derive any finer-grained closure decisions it cares about.
 * - Upstream also has a "special content" branch (e.g. `<script>` /
 *   `<style>` swallow until the matching close tag); the simplified
 *   ngSanitize port we mirror does not — those tags tokenize as normal
 *   tags and the consumer drops them via a `dropDepth` counter.
 *
 * The tokenizer never throws on malformed input. Best-effort recovery
 * (treat a stray `<` as literal text, drain the open-tag stack at
 * end-of-input) keeps the loop terminating in linear time on every
 * input shape.
 *
 * @see https://github.com/angular/angular.js/blob/v1.8.3/src/ngSanitize/sanitize.js
 */

import { OPTIONAL_END_TAG_BLOCK_ELEMENTS, OPTIONAL_END_TAG_INLINE_ELEMENTS } from '@sanitize/sanitize-allow-lists';

/**
 * Callback surface the tokenizer drives as it scans the input.
 *
 * - `start` fires once per opening tag. `unary` is the syntactic
 *   trailing-slash marker (`<br/>`); the consumer is responsible for
 *   merging this with its own void-element table to decide whether the
 *   element actually needs a closing emission.
 * - `end` fires once per closing tag the tokenizer matches against the
 *   open-tag stack, plus one trailing emission per element still open
 *   at end-of-input.
 * - `chars` fires for runs of plain text and for CDATA payloads
 *   (CDATA is decoded as text, matching upstream). Entity references
 *   pass through verbatim — decoding is the consumer's responsibility.
 * - `comment` fires once per `<!-- ... -->` block, with the inner
 *   content (the delimiters stripped). `<!DOCTYPE …>` declarations
 *   are silently skipped and never reach the handler.
 */
export interface TokenHandler {
  start(tagName: string, attrs: Map<string, string>, unary: boolean): void;
  end(tagName: string): void;
  chars(text: string): void;
  comment(text: string): void;
}

// Regex sources copied verbatim from `src/ngSanitize/sanitize.js` v1.8.3.
// Variable names mirror upstream — including the misspelled
// BEGING_END_TAGE_REGEXP — for traceability.

const ATTR_REGEXP = /([\w:-]+)(?:\s*=\s*(?:(?:"((?:[^"])*)")|(?:'((?:[^'])*)')|([^>\s]+)))?/g;
const START_TAG_REGEXP =
  /^<((?:[a-zA-Z])[\w:-]*)((?:\s+[\w:-]+(?:\s*=\s*(?:(?:"(?:[^"])*")|(?:'(?:[^'])*')|[^>\s]+))?)*)\s*(\/?)\s*(>)/;
const END_TAG_REGEXP = /^<\/\s*([\w:-]+)[^>]*>/;
const BEGIN_TAG_REGEXP = /^</;
const BEGING_END_TAGE_REGEXP = /^<\//;
const COMMENT_REGEXP = /^<!--/;
const CDATA_REGEXP = /^<!\[CDATA\[/;
const DOCTYPE_REGEXP = /^<!DOCTYPE/i;

/**
 * Drive the tokenizer across `html`, invoking `handler` for each
 * structural token. Returns nothing; output is delivered exclusively
 * through the handler callbacks.
 *
 * Never throws — malformed input recovers via best-effort character-
 * level advancement and end-of-input stack drain.
 */
export function htmlParser(html: string, handler: TokenHandler): void {
  const stack: string[] = [];
  let last = html;

  while (html) {
    let text = '';

    if (BEGIN_TAG_REGEXP.test(html)) {
      if (COMMENT_REGEXP.test(html)) {
        // <!-- ... -->. If the close marker is missing, treat the rest of
        // the input as the comment payload and bail to end-of-input.
        const closeIdx = html.indexOf('-->', 4);
        if (closeIdx >= 0) {
          handler.comment(html.substring(4, closeIdx));
          html = html.substring(closeIdx + 3);
        } else {
          handler.comment(html.substring(4));
          html = '';
        }
      } else if (CDATA_REGEXP.test(html)) {
        // <![CDATA[ ... ]]>. Upstream surfaces the inner payload as
        // character data — same here. Unclosed CDATA falls through as
        // chars to end-of-input.
        const closeIdx = html.indexOf(']]>', 9);
        if (closeIdx >= 0) {
          handler.chars(html.substring(9, closeIdx));
          html = html.substring(closeIdx + 3);
        } else {
          handler.chars(html.substring(9));
          html = '';
        }
      } else if (DOCTYPE_REGEXP.test(html)) {
        // <!DOCTYPE …>. Skipped entirely — no event emitted.
        const closeIdx = html.indexOf('>');
        if (closeIdx >= 0) {
          html = html.substring(closeIdx + 1);
        } else {
          html = '';
        }
      } else if (BEGING_END_TAGE_REGEXP.test(html)) {
        const match = END_TAG_REGEXP.exec(html);
        if (match) {
          html = html.substring(match[0].length);
          parseEndTag(match[1] ?? '', stack, handler);
        } else {
          // Malformed end tag — fall through and treat '<' as literal.
          text = html.charAt(0);
          html = html.substring(1);
        }
      } else {
        const match = START_TAG_REGEXP.exec(html);
        if (match) {
          html = html.substring(match[0].length);
          parseStartTag(match[1] ?? '', match[2] ?? '', match[3] ?? '', stack, handler);
        } else {
          // Bare '<' that does not begin any recognized construct.
          // Surface it as text and advance — keeps the loop progressing.
          text = html.charAt(0);
          html = html.substring(1);
        }
      }
    } else {
      // Plain text up to the next '<'.
      const idx = html.indexOf('<');
      text = idx < 0 ? html : html.substring(0, idx);
      html = idx < 0 ? '' : html.substring(idx);
    }

    if (text) {
      handler.chars(text);
    }

    if (html === last) {
      // Belt-and-braces: every branch above advances or drains `html`,
      // so this should be unreachable. If a future regex tweak ever
      // stalls progress, force-advance one character rather than
      // throwing — the tokenizer's contract is that it always returns.
      handler.chars(html);
      html = '';
    }
    last = html;
  }

  // Drain any tags still open at end-of-input.
  while (stack.length > 0) {
    const open = stack.pop();
    if (open !== undefined) {
      handler.end(open);
    }
  }
}

/**
 * Handle one matched start tag. Performs implicit closure of an
 * optional-end-tag predecessor, parses attributes, pushes the tag onto
 * the open-element stack (unless syntactically void), and emits
 * `start`.
 */
function parseStartTag(tag: string, rest: string, unaryFlag: string, stack: string[], handler: TokenHandler): void {
  const lowered = tag.toLowerCase();
  // The `unary` event flag is purely the trailing-slash syntactic marker.
  // The void-element semantic decision is made by the consumer with its
  // own `VOID_ELEMENTS` allow-list.
  const isUnary = unaryFlag === '/';

  // Optional-end-tag implicit closure: if the stack top is a tag whose
  // close is optional, auto-close it before the new opener. See the
  // file-level TSDoc for the simplification versus upstream.
  const top = stack.length > 0 ? stack[stack.length - 1] : undefined;
  if (top !== undefined && (OPTIONAL_END_TAG_INLINE_ELEMENTS.has(top) || OPTIONAL_END_TAG_BLOCK_ELEMENTS.has(top))) {
    parseEndTag(top, stack, handler);
  }

  const attrs = new Map<string, string>();
  rest.replace(ATTR_REGEXP, (_match, name: string, doubleQuoted?: string, singleQuoted?: string, unquoted?: string) => {
    // Boolean attributes (no `=value`) collapse to '' — upstream keeps
    // the empty string so the consumer can detect presence without
    // having to peek at the source string.
    const value = doubleQuoted ?? singleQuoted ?? unquoted ?? '';
    attrs.set(name.toLowerCase(), value);
    return '';
  });

  if (!isUnary) {
    stack.push(lowered);
  }
  handler.start(lowered, attrs, isUnary);
}

/**
 * Handle one matched end tag. Walks back through the open-element
 * stack to find the closest matching opener; emits `end` for every
 * tag from the stack top down to (and including) the match. Spurious
 * end tags with no opener are silently dropped.
 */
function parseEndTag(tag: string, stack: string[], handler: TokenHandler): void {
  const lowered = tag.toLowerCase();
  let pos = -1;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i] === lowered) {
      pos = i;
      break;
    }
  }

  if (pos >= 0) {
    // Auto-close everything above the match, then the match itself.
    for (let i = stack.length - 1; i >= pos; i--) {
      const open = stack[i];
      if (open !== undefined) {
        handler.end(open);
      }
    }
    stack.length = pos;
  }
  // If pos < 0: spurious end tag with no opener — silently dropped,
  // matching upstream behavior.
}
