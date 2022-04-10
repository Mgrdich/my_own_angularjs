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

  static arrayEach(element: unknown[]): void {}

  static baseEach(element: unknown[]): void {}

  static forEach<T = unknown>(element: T[], callback: (item: T) => void): void {}
}
