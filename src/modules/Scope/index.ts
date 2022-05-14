import Lib from 'util/LibHelper';
import { watcherObjType } from 'modules/Scope/types';

export interface IRootScope {
  $watch(watchFn: watcherObjType['watchFn'], listenerFn: watcherObjType['listenerFn']): void;
  $digest(): void;
}

export type IScope = IRootScope;

export default class Scope implements IScope {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [x: string]: any; // to let add any property on the object'

  private readonly $$watchers: watcherObjType[];
  private $$lastDirtyWatch: null | watcherObjType;

  constructor() {
    this.$$watchers = [];
  }

  private static initWatchValue() {}

  private static $$areEqual(value: unknown, anotherValue: unknown, valueEq: boolean): boolean {
    if (valueEq) {
      return Lib.isEqual(value, anotherValue);
    }

    return value === anotherValue;
  }

  $watch(
    watchFn: watcherObjType['watchFn'],
    listenerFn?: watcherObjType['listenerFn'],
    valueEq?: watcherObjType['valueEq'],
  ): void {
    this.$$watchers.push({
      watchFn,
      listenerFn: listenerFn || Lib.getNoopFunction(),
      last: Scope.initWatchValue,
      valueEq: !!valueEq,
    });
    this.$$lastDirtyWatch = null; // resetting for embedded case
  }

  $digest(): void {
    let dirty: boolean;
    let ttl = 10;
    this.$$lastDirtyWatch = null;
    do {
      dirty = this.$$digestOnce();
      if (dirty && !ttl--) {
        throw '10 digest iterations reached';
      }
    } while (dirty);
  }

  private $$digestOnce(): boolean {
    let dirty = false;
    Lib.forEach(this.$$watchers, (watcher) => {
      const newValue = watcher.watchFn(this);
      const oldValue = watcher.last;
      if (newValue !== oldValue) {
        this.$$lastDirtyWatch = watcher;
        watcher.last = newValue;
        const oldShownValue: unknown = oldValue === Scope.initWatchValue ? newValue : oldValue;
        watcher.listenerFn(newValue, oldShownValue, this);
        dirty = true;
      } else if (this.$$lastDirtyWatch === watcher) {
        // same so return not dirty and forEach will short circuit
        return false;
      }
    });
    return dirty;
  }
}
