import { Dictionary } from 'Types';

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

  static arrayEach<T>(element: T[], callback: (item: T) => unknown): void {}

  static baseEach<T = unknown>(element: Dictionary<T>, callback: (item: T) => unknown): void {}

  static forEach<T = unknown>(collection: unknown[] | Dictionary<T>, callback: (item: T) => unknown): void {
    if (Array.isArray(collection)) {
      return LibHelper.arrayEach(collection, callback);
    }
    return LibHelper.baseEach(collection, callback);
  }
}
