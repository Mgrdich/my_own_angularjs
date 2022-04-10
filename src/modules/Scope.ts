export interface IRootScope extends Record<string, unknown> {
  $watch(): void;
  $digest(): void;
  $$watchers: unknown[];
}

export default class Scope implements IRootScope {
  $$watchers: unknown[];
  [x: string]: unknown;

  constructor() {
    this.$$watchers = [];
  }

  $watch() {}

  $digest() {}
}
