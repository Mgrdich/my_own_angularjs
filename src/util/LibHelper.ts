import { Dictionary } from 'types';

export default class LibHelper {
  static MAX_INTEGER = 1.7976931348623157e308;
  static INFINITY = 1 / 0;

  static isNumber(element: unknown): boolean {
    return typeof element === 'number';
  }

  static isString(element: unknown): boolean {
    return typeof element === 'string';
  }

  static isFunction(element: unknown): boolean {
    return typeof element === 'function';
  }

  static isNull(element: unknown): boolean {
    return element === null;
  }

  static isArray(element: unknown): boolean {
    return Array.isArray(element);
  }

  static isObject(element: unknown): boolean {
    return element !== null && typeof element === 'object';
  }

  static isDefined(element: unknown): boolean {
    return typeof element !== 'undefined';
  }

  static isUndefined(element: unknown): boolean {
    return typeof element === 'undefined';
  }

  static isRegExp(element: unknown): boolean {
    return toString.call(element) === '[object RegExp]';
  }

  static isDate(element: unknown) {
    return toString.call(element) === '[object Date]';
  }

  static nativeMax(...values: number[]): number {
    return Math.max(...values);
  }

  static nativeCeil(value: number): number {
    return Math.ceil(value);
  }

  private static arrayEach<T = unknown>(arr: T[], callback: (item: T, index: number, arr: T[]) => unknown): T[] {
    let index = -1;
    const length: number = arr.length;

    while (++index < length) {
      if (callback(arr[index], index, arr) === false) {
        break;
      }
    }
    return arr;
  }

  private static baseEach<T = unknown>(
    obj: Dictionary<T>,
    callback: (value: T, key: string, obj: Dictionary<T>) => unknown,
  ): Dictionary<T> {
    for (const key in obj) {
      if (callback(obj[key], key, obj) === false) {
        break;
      }
    }
    return obj;
  }

  static forEach<T = unknown>(
    collection: T[] | Dictionary<T>,
    callback: (item: T, curr: string | number, collectionSelf: typeof collection) => unknown,
  ): unknown[] | Dictionary<T> {
    if (Array.isArray(collection)) {
      return LibHelper.arrayEach(collection, callback);
    }
    return LibHelper.baseEach(collection, callback);
  }

  static getNoopFunction(): () => void {
    return function () {};
  }

  private static toFinite(value: number): number {
    if (!value) {
      return value === 0 ? value : 0;
    }

    if (value === this.INFINITY || value === -this.INFINITY) {
      const sign: number = value < 0 ? -1 : 1;
      return sign * this.MAX_INTEGER;
    }
    return value === value ? value : 0;
  }

  private static baseRange(start: number, end: number, step?: number, fromRight?: boolean): number[] {
    let index = -1;
    let length = this.nativeMax(this.nativeCeil((end - start) / (step || 1)), 0);
    const result = Array(length);

    while (length--) {
      result[fromRight ? length : ++index] = start;
      start += step;
    }
    return result;
  }

  static range(start: number, end?: number, step?: number): number[] {
    // Ensure the sign of `-0` is preserved.
    start = this.toFinite(start);
    if (end === undefined) {
      end = start;
      start = 0;
    } else {
      end = this.toFinite(end);
    }
    step = step === undefined ? (start < end ? 1 : -1) : this.toFinite(step);

    return this.baseRange(start, end, step);
  }
}
