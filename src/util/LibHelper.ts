import { Dictionary } from 'types';

export default class LibHelper {
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

  static arrayEach<T = unknown>(arr: T[], callback: (item: T, index: number, arr: T[]) => unknown): T[] {
    let index = -1;
    const length: number = arr.length;

    while (++index < length) {
      if (callback(arr[index], index, arr) === false) {
        break;
      }
    }
    return arr;
  }

  static baseEach<T = unknown>(
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
}
