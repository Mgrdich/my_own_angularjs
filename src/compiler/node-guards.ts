/**
 * DOM node-type guards used by `$compile` and its collaborators.
 *
 * The walker takes plain `Node` values out of `childNodes` and needs
 * to narrow them before reading `Element`-only properties (`tagName`,
 * `attributes`, `childNodes` traversal for compile) or `Comment`-only
 * properties (`nodeValue` for M-restricted directive parsing). Rather
 * than scattering `node.nodeType === 1` + `as Element` pairs across
 * the compiler, these two guards centralize the narrowing so call
 * sites read as `if (isElement(node)) { … }`.
 *
 * The numeric `nodeType` constants are spelled out (1 = `ELEMENT_NODE`,
 * 8 = `COMMENT_NODE`) so the guards work against both real DOM nodes
 * and jsdom's implementation without depending on `Node` being
 * defined as a value (it's an interface in some TS lib configs).
 */

export function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

export function isComment(node: Node): node is Comment {
  return node.nodeType === 8;
}

export function isText(node: Node): node is Text {
  return node.nodeType === 3;
}

/**
 * `Element` → style-bearing element guard.
 *
 * Returns `true` for both `HTMLElement` and `SVGElement` (both
 * implement the `ElementCSSInlineStyle` mixin that exposes `.style`).
 * Narrows the input to `HTMLElement` because that's the typed shape
 * call sites need; the SVG path is structurally compatible at runtime
 * since `SVGElement.style` is also a `CSSStyleDeclaration`.
 *
 * A stricter `element instanceof HTMLElement` form would exclude
 * SVGElement and break `ng-style` on `<rect>` / `<circle>` / etc.
 */
export function isStyleableElement(element: Element): element is HTMLElement {
  return 'style' in element;
}
