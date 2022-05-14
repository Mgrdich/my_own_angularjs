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

  static isDate(element: unknown): boolean {
    return toString.call(element) === '[object Date]';
  }

  static isScope(element?: { $evalAsync?: () => void; $watch?: () => void }): boolean {
    return element && '$evalAsync' in element && '$watch' in element;
  }

  static isWindow(element: { window?: Window }): boolean {
    return element && element.window === element;
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

  private static createMap(): Dictionary {
    return Object.create(null);
  }

  private static simpleCompare(o1: unknown, o2: unknown): boolean {
    return o1 === o1 || (o1 !== o1 && o2 !== o2);
  }

  static isEqual(o1: unknown, o2: unknown): boolean {
    if (o1 === o2) return true;
    if (o1 === null || o2 === null) return false;

    // eslint-disable-next-line no-self-compare
    if (o1 !== o1 && o2 !== o2) return true; // NaN === NaN

    const t1 = typeof o1;
    const t2 = typeof o2;
    let length: number;

    if (t1 === t2 && t1 === 'object') {
      if (LibHelper.isArray(o1)) {
        if (!LibHelper.isArray(o2)) return false;

        if ((length = (o1 as []).length) === (o2 as []).length) {
          for (let key = 0; key < length; key++) {
            if (!LibHelper.isEqual((o1 as [])[key], (o2 as [])[key])) return false;
          }
          return true;
        }
      } else if (LibHelper.isDate(o1)) {
        if (!LibHelper.isDate(o2)) return false;

        return LibHelper.simpleCompare((o1 as Date).getTime(), (o2 as Date).getTime());
      } else if (LibHelper.isRegExp(o1)) {
        if (!LibHelper.isRegExp(o2)) return false;
        return o1.toString() === o2.toString();
      } else {
        if (
          LibHelper.isScope(o1) ||
          LibHelper.isScope(o2) ||
          LibHelper.isWindow(o1) ||
          LibHelper.isWindow(o2) ||
          LibHelper.isArray(o2) ||
          LibHelper.isDate(o2) ||
          LibHelper.isRegExp(o2)
        )
          return false;

        const keySet: Dictionary = LibHelper.createMap();

        for (const key in o1 as Dictionary) {
          if (key.charAt(0) === '$' || LibHelper.isFunction((o1 as Dictionary)[key])) continue;

          if (!LibHelper.isEqual((o1 as Dictionary)[key], (o2 as Dictionary)[key])) return false;
          keySet[key] = true;
        }

        for (const key in o2 as Dictionary) {
          if (
            !(key in keySet) &&
            key.charAt(0) !== '$' &&
            LibHelper.isDefined((o2 as Dictionary)[key]) &&
            !LibHelper.isFunction((o2 as Dictionary)[key])
          )
            return false;
        }

        return true;
      }
    }

    return false;
  }
}
