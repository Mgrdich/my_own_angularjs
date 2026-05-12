/**
 * `parseTemplate` — HTML5-spec-compliant fragment parser used by the
 * `$compile` walker's inline-template install pre-pass (spec 019
 * Slice 5 / technical-considerations §2.9) and by the deferred drain
 * for `templateUrl` resolution (Slice 6).
 *
 * The implementation uses an HTML `<template>` element whose `content`
 * fragment is the parser-canonical container for parsed-but-not-rendered
 * markup. Multi-root templates are supported naturally — the returned
 * array is the full `childNodes` list of the fragment, preserving order
 * and node types (Element, Text, Comment).
 *
 * Special-case wrapping for table cells / rows / cols inside a bare
 * template is DEFERRED to a future spec — `<template>` handles the
 * common cases correctly per the HTML5 spec, and the AngularJS-canonical
 * `wrapMap` workaround can be re-introduced if test coverage demands it.
 *
 * The function is intentionally pure (no closures, no captured state)
 * so it can be re-invoked safely across compile invocations.
 *
 * @example
 * ```ts
 * // Single-root template
 * const nodes = parseTemplate('<p>hi</p>');
 * // → [<p>hi</p>]
 *
 * // Multi-root template — both roots become top-level siblings
 * const nodes = parseTemplate('<h2>a</h2><p>b</p>');
 * // → [<h2>a</h2>, <p>b</p>]
 *
 * // Text-only template
 * const nodes = parseTemplate('just text');
 * // → [#text "just text"]
 * ```
 */
export function parseTemplate(html: string): Node[] {
  const templateEl = document.createElement('template');
  templateEl.innerHTML = html;
  return Array.from(templateEl.content.childNodes);
}
