/**
 * Require resolver — spec 022 Slice 4 (FS §2.4 / technical-considerations §2.4).
 *
 * Parses the `^` / `^^` / `?` flags on a `require` string and walks the
 * per-element `$$ngControllers: Map<string, unknown>` registry (planted
 * by Slice 3's controller seam) to resolve the requested controller.
 *
 * Three search scopes are supported:
 *
 *  - no prefix (`'name'`)  — own element only.
 *  - `^` (`'^name'`)       — own element, then `parentElement` chain.
 *  - `^^` (`'^^name'`)     — `parentElement` chain only (skip own element).
 *
 * A leading `?` (in either ordering — `?^name` or `^?name`) marks the
 * requirement as OPTIONAL: a miss returns `null` instead of throwing.
 * A non-optional miss throws {@link MissingRequiredControllerError},
 * which the per-element link site routes via
 * `$exceptionHandler('$compile')` — no new `EXCEPTION_HANDLER_CAUSES`
 * token; the tuple stays at 10.
 *
 * Pure helpers — no DI access, no exception-handler routing, no element
 * cleanup. The compiler imports {@link resolveRequireForm} and drives it
 * from the per-element controller seam.
 */

import { MissingRequiredControllerError } from './compile-error';
import { NG_CONTROLLERS, type NgManagedElement } from './element-slots';

/**
 * Parsed shape of a single `require` string entry.
 *
 * `prefix` is the parsed search-scope flag (`^^`, `^`, or `''`).
 * `optional` is `true` when the entry had a leading `?` (in either
 * ordering — `?^name`, `^?name`, `?^^name`, `^^?name`).
 * `name` is the remaining identifier — the directive name to look up
 * in `$$ngControllers`.
 */
export interface ParsedRequireFlags {
  readonly prefix: '' | '^' | '^^';
  readonly optional: boolean;
  readonly name: string;
}

/**
 * Parse the leading `^` / `^^` / `?` flags off a `require` string. The
 * flags are order-tolerant: `'?^name'` and `'^?name'` both yield
 * `{ prefix: '^', optional: true, name: 'name' }`. `^^` is consumed
 * before `^` so `'^^name'` resolves to `{ prefix: '^^', … }`, not
 * `{ prefix: '^', name: '^name' }`.
 *
 * Returns `{ prefix: '', optional: false, name: rawTrimmed }` for an
 * unflagged string; the consumer ({@link resolveRequire}) validates
 * the resulting `name` is non-empty before walking, and surfaces a
 * miss as {@link MissingRequiredControllerError} when non-optional.
 *
 * @example
 * ```ts
 * parseRequireFlags('parent');          // { prefix: '',   optional: false, name: 'parent' }
 * parseRequireFlags('^parent');         // { prefix: '^',  optional: false, name: 'parent' }
 * parseRequireFlags('^^parent');        // { prefix: '^^', optional: false, name: 'parent' }
 * parseRequireFlags('?parent');         // { prefix: '',   optional: true,  name: 'parent' }
 * parseRequireFlags('?^parent');        // { prefix: '^',  optional: true,  name: 'parent' }
 * parseRequireFlags('^?parent');        // { prefix: '^',  optional: true,  name: 'parent' }
 * parseRequireFlags('?^^parent');       // { prefix: '^^', optional: true,  name: 'parent' }
 * parseRequireFlags('^^?parent');       // { prefix: '^^', optional: true,  name: 'parent' }
 * ```
 */
export function parseRequireFlags(raw: string): ParsedRequireFlags {
  let remaining = raw;
  let optional = false;
  let prefix: '' | '^' | '^^' = '';

  // The `?` and `^` flags are order-tolerant. We consume up to one
  // of each in a loop so both `'?^name'` and `'^?name'` resolve
  // identically. `^^` MUST be consumed before `^` so the longer
  // prefix wins (otherwise `^^name` would split into `^` + `^name`).
  // We allow at most one `?` and one ancestor-walk prefix; further
  // leading flags are NOT supported (anything else falls through as
  // part of `name` and is rejected as a non-identifier).
  let consumed = true;
  while (consumed) {
    consumed = false;
    if (!optional && remaining.startsWith('?')) {
      optional = true;
      remaining = remaining.slice(1);
      consumed = true;
      continue;
    }
    if (prefix === '') {
      if (remaining.startsWith('^^')) {
        prefix = '^^';
        remaining = remaining.slice(2);
        consumed = true;
        continue;
      }
      if (remaining.startsWith('^')) {
        prefix = '^';
        remaining = remaining.slice(1);
        consumed = true;
        continue;
      }
    }
  }

  return { prefix, optional, name: remaining };
}

/**
 * Read the controller for `name` off the element's `$$ngControllers`
 * map (planted by spec 022 Slice 3's controller seam). Returns
 * `undefined` when the element has no controllers, or has controllers
 * but none under that name.
 */
function readController(element: Element | null, name: string): unknown {
  if (element === null) {
    return undefined;
  }
  const map = (element as NgManagedElement)[NG_CONTROLLERS];
  if (map === undefined) {
    return undefined;
  }
  return map.get(name);
}

/**
 * Resolve a single `require` string against the element's controller
 * registry and (when `^` / `^^` is set) its ancestor chain.
 *
 * Throws {@link MissingRequiredControllerError} when the requirement
 * is non-optional and no matching controller is found anywhere in the
 * configured search scope. The compiler's per-element link site
 * catches the throw and routes it via `$exceptionHandler('$compile')`;
 * `resolveRequire` itself does NO error routing.
 *
 * @example
 * ```ts
 * resolveRequire(childElement, 'child', 'parent');     // own element
 * resolveRequire(childElement, 'child', '^parent');    // own + ancestors
 * resolveRequire(childElement, 'child', '^^parent');   // ancestors only
 * resolveRequire(childElement, 'child', '?parent');    // optional: null on miss
 * ```
 */
export function resolveRequire(element: Element, requiringName: string, raw: string): unknown {
  const { prefix, optional, name } = parseRequireFlags(raw);

  // A malformed `require` string (empty after flag-strip, contains
  // whitespace, etc.) cannot resolve any controller. We surface this
  // as the canonical "missing controller" diagnostic — no separate
  // error class for it (per the spec brief).
  if (name.length === 0) {
    if (optional) {
      return null;
    }
    throw new MissingRequiredControllerError(requiringName, name, prefix);
  }

  if (prefix === '') {
    // Own element only.
    const found = readController(element, name);
    if (found !== undefined) {
      return found;
    }
    if (optional) {
      return null;
    }
    throw new MissingRequiredControllerError(requiringName, name, prefix);
  }

  if (prefix === '^') {
    // Own element, then walk up via `parentElement`.
    const ownFound = readController(element, name);
    if (ownFound !== undefined) {
      return ownFound;
    }
    let current: Element | null = element.parentElement;
    while (current !== null) {
      const found = readController(current, name);
      if (found !== undefined) {
        return found;
      }
      current = current.parentElement;
    }
    if (optional) {
      return null;
    }
    throw new MissingRequiredControllerError(requiringName, name, prefix);
  }

  // prefix === '^^' — skip own element; walk ancestors only.
  let current: Element | null = element.parentElement;
  while (current !== null) {
    const found = readController(current, name);
    if (found !== undefined) {
      return found;
    }
    current = current.parentElement;
  }
  if (optional) {
    return null;
  }
  throw new MissingRequiredControllerError(requiringName, name, prefix);
}

/**
 * The form-aware entry point used by the compiler's per-element
 * controller seam. Dispatches on the runtime shape of `requireSpec`:
 *
 *  - String form → returns a single resolved controller (or `null`
 *    when the entry is optional and missing).
 *  - Array form  → returns an array of resolved controllers in the
 *    SAME order as the input; optional misses appear as `null`.
 *  - Object form → returns a `Record<string, unknown>` keyed by the
 *    declared aliases; optional misses appear as `null` under their
 *    alias.
 *
 * A non-optional miss in ANY form throws
 * {@link MissingRequiredControllerError} from the underlying
 * {@link resolveRequire} call — array / object resolution surfaces
 * the FIRST miss (entries before the throwing one have already
 * resolved; entries after it are skipped). The compiler's link site
 * catches the throw and routes it via `$exceptionHandler('$compile')`.
 *
 * @example
 * ```ts
 * resolveRequireForm(el, 'child', 'parent');
 * resolveRequireForm(el, 'child', ['^parent', '^^outer']);
 * resolveRequireForm(el, 'child', { p: '^parent', o: '^^outer' });
 * ```
 */
export function resolveRequireForm(
  element: Element,
  requiringName: string,
  requireSpec: string | string[] | Record<string, string>,
): unknown {
  if (typeof requireSpec === 'string') {
    return resolveRequire(element, requiringName, requireSpec);
  }
  if (Array.isArray(requireSpec)) {
    const resolved: unknown[] = [];
    for (const entry of requireSpec) {
      resolved.push(resolveRequire(element, requiringName, entry));
    }
    return resolved;
  }
  // Object form.
  const out: Record<string, unknown> = {};
  for (const alias of Object.keys(requireSpec)) {
    const entry = requireSpec[alias];
    if (entry === undefined) {
      continue;
    }
    out[alias] = resolveRequire(element, requiringName, entry);
  }
  return out;
}
