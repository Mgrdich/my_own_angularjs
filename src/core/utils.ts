/** Type guard that narrows a string key to a key of the given object. */
export function isKeyOf<T extends Record<string, unknown>>(obj: T, key: string): key is Extract<keyof T, string> {
  return key in obj;
}

/**
 * Minimal recursive deep equality used by the scope dirty-checking system.
 *
 * Supports primitives, NaN, arrays, plain objects, Date, and RegExp.
 * Does not handle Map, Set, WeakMap, WeakRef, ArrayBuffer, circular
 * references, or arbitrary class instances.
 */
export function isEqual(a: unknown, b: unknown) {
  // Strict equality covers primitives, null, undefined, and same-reference objects
  if (a === b) return true;

  // NaN is the only value that is not equal to itself
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) {
    return true;
  }

  // From here both values must be non-null objects
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }

  // Date comparison via epoch millis
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  // RegExp comparison via source pattern and flags
  if (a instanceof RegExp && b instanceof RegExp) {
    return a.source === b.source && a.flags === b.flags;
  }

  // Arrays — length check then element-by-element
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isEqual(a[i], b[i])) return false;
    }
    return true;
  }

  // Reject mismatched structural types (e.g. array vs plain object)
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }

  // Plain objects — key count then key-by-key
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!isEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }

  return true;
}
