/** Type guard that narrows a string key to a key of the given object. */
export function isKeyOf<T extends Record<string, unknown>>(obj: T, key: string): key is Extract<keyof T, string> {
  return Object.prototype.hasOwnProperty.call(obj, key);
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

  // Date comparison via epoch millis (NaN-safe: two invalid dates are equal)
  if (a instanceof Date || b instanceof Date) {
    if (!(a instanceof Date) || !(b instanceof Date)) return false;
    const timeA = a.getTime();
    const timeB = b.getTime();
    if (Number.isNaN(timeA) && Number.isNaN(timeB)) return true;
    return timeA === timeB;
  }

  // RegExp comparison via source pattern and flags
  if (a instanceof RegExp || b instanceof RegExp) {
    if (!(a instanceof RegExp) || !(b instanceof RegExp)) return false;
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
  // Skip $-prefixed keys and function-valued properties (AngularJS angular.equals behavior)
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;

  const filterKeys = (obj: Record<string, unknown>) =>
    Object.keys(obj).filter((key) => !key.startsWith('$') && typeof obj[key] !== 'function' && obj[key] !== undefined);

  const keysA = filterKeys(objA);
  const keysB = filterKeys(objB);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
    if (!isEqual(objA[key], objB[key])) {
      return false;
    }
  }

  return true;
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function isFunction(value: unknown): value is Function {
  return typeof value === 'function';
}

export function isNull(value: unknown): value is null {
  return value === null;
}

export function isUndefined(value: unknown): value is undefined {
  return typeof value === 'undefined';
}

export function isDefined<T>(value: T | undefined): value is T {
  return typeof value !== 'undefined';
}

export function isArray<T>(value: T | readonly unknown[]): value is Extract<T, readonly unknown[]> {
  return Array.isArray(value);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export function isDate(value: unknown): value is Date {
  return value instanceof Date;
}

export function isRegExp(value: unknown): value is RegExp {
  return value instanceof RegExp;
}

export function isNaN(value: unknown) {
  return typeof value === 'number' && value !== value;
}

export function isWindow(value: unknown) {
  return isObject(value) && 'window' in value && value['window'] === value;
}

export function isBlankObject(value: unknown) {
  return isObject(value) && Object.getPrototypeOf(value) === null;
}

type TypedArray =
  | Uint8Array
  | Uint8ClampedArray
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

const TYPED_ARRAY_REGEXP =
  /^\[object (?:Uint8|Uint8Clamped|Uint16|Uint32|Int8|Int16|Int32|Float32|Float64|BigInt64|BigUint64)Array]$/;

export function isTypedArray(value: unknown): value is TypedArray {
  return TYPED_ARRAY_REGEXP.test(Object.prototype.toString.call(value));
}

export function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer;
}

export function isArrayLike(value: unknown) {
  if (isArray(value) || isString(value)) return true;

  if (!isObject(value)) return false;

  if (!('length' in value)) return false;
  const { length } = value;
  return (
    typeof length === 'number' && length >= 0 && length <= Number.MAX_SAFE_INTEGER && Math.floor(length) === length
  );
}

/**
 * Deep clone a value. Supports primitives, Date, RegExp, ArrayBuffer,
 * TypedArrays, arrays, and plain objects. Detects circular references.
 *
 * When `destination` is provided, properties are copied into it (after
 * clearing existing contents) rather than creating a new container.
 */
export function copy<T>(source: T, destination?: T) {
  if (destination !== undefined && source === destination) {
    throw new Error('Cannot copy! Source and destination are identical.');
  }
  const visited = new Set<T>();
  return copyRecursive(source, destination, visited);
}

function copyRecursive<T>(source: T, destination: T | undefined, visited: Set<T>) {
  // Primitives: return as-is
  if (source === null || typeof source !== 'object') {
    if (destination !== undefined) {
      throw new Error('Cannot copy! Source is a primitive and destination was provided.');
    }
    return source;
  }

  // Date
  if (isDate(source)) {
    return new Date(source.getTime()) as T;
  }

  // RegExp
  if (isRegExp(source)) {
    return new RegExp(source.source, source.flags) as T;
  }

  // ArrayBuffer
  if (isArrayBuffer(source)) {
    if (destination !== undefined) {
      throw new Error('Cannot copy! ArrayBuffer destination is not supported.');
    }
    return source.slice(0) as T;
  }

  // TypedArray
  if (isTypedArray(source)) {
    if (destination !== undefined) {
      throw new Error('Cannot copy! TypedArray destination is not supported.');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
    return new (source.constructor as any)(source.buffer.slice(0)) as T;
  }

  // Circular reference detection
  if (visited.has(source)) {
    throw new Error('Cannot copy! Circular reference detected.');
  }
  visited.add(source);

  // Arrays
  if (isArray(source)) {
    const result = (destination !== undefined ? destination : []) as unknown[];
    if (isArray(result)) {
      result.length = 0;
      for (let i = 0; i < source.length; i++) {
        result.push(copyRecursive(source[i], undefined, visited));
      }
    }
    return result as T;
  }

  // Plain objects
  if (isObject(source)) {
    const result = (destination !== undefined ? destination : {}) as Record<string, unknown>;
    // Clear existing own properties on destination
    if (destination !== undefined) {
      for (const key of Object.keys(result)) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete result[key];
      }
    }
    for (const key of Object.keys(source)) {
      result[key] = copyRecursive(source[key], undefined, visited);
    }
    return result as T;
  }

  return source;
}

export function forEach<T>(collection: T[], iteratee: (value: T, index: number, array: T[]) => undefined | false): void;
export function forEach<T>(
  collection: Record<string, T>,
  iteratee: (value: T, key: string, object: Record<string, T>) => undefined | false,
): void;
export function forEach(
  collection: null | undefined,
  iteratee: (value: unknown, key: unknown, collection: unknown) => undefined | false,
): void;
export function forEach(
  collection: unknown[] | Record<string, unknown> | null | undefined,
  iteratee:
    | ((value: unknown, index: number, array: unknown[]) => undefined | false)
    | ((value: unknown, key: string, object: Record<string, unknown>) => undefined | false),
): void {
  if (collection == null) return;

  if (isArray(collection)) {
    const fn = iteratee as (value: unknown, index: number, array: unknown[]) => undefined | false;
    for (let i = 0; i < collection.length; i++) {
      if (fn(collection[i], i, collection) === false) break;
    }
  } else {
    const obj = collection;
    const fn = iteratee as (value: unknown, key: string, object: Record<string, unknown>) => undefined | false;
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key === undefined) continue;
      if (fn(obj[key], key, obj) === false) break;
    }
  }
}

/** Empty function that does nothing. */
export function noop() {}

/** Creates a bare object with no prototype. */
export function createMap<T = unknown>() {
  return Object.create(null) as Record<string, T>;
}

/**
 * Generates an array of numbers, following lodash's `range` convention.
 *
 * - `range(end)` produces `[0, 1, ..., end-1]`
 * - `range(start, end)` produces values from start (inclusive) to end (exclusive)
 * - `range(start, end, step)` produces values with the given step
 */
export function range(startOrEnd: number, end?: number, step?: number) {
  let actualStart: number;
  let actualEnd: number;
  let actualStep: number;

  if (end === undefined) {
    actualStart = 0;
    actualEnd = startOrEnd;
    actualStep = 1;
  } else if (step === undefined) {
    actualStart = startOrEnd;
    actualEnd = end;
    actualStep = actualStart < actualEnd ? 1 : -1;
  } else {
    actualStart = startOrEnd;
    actualEnd = end;
    actualStep = step;
  }

  if (actualStep === 0) {
    return [];
  }

  // Step goes in wrong direction — return empty array
  if (actualStep > 0 && actualStart >= actualEnd) {
    return [];
  }
  if (actualStep < 0 && actualStart <= actualEnd) {
    return [];
  }

  const result: number[] = [];
  if (actualStep > 0) {
    for (let i = actualStart; i < actualEnd; i += actualStep) {
      result.push(i);
    }
  } else {
    for (let i = actualStart; i > actualEnd; i += actualStep) {
      result.push(i);
    }
  }

  return result;
}
