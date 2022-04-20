import Lib from 'util/LibHelper';
import { watcherObjType } from 'modules/Scope/types';

export interface IRootScope {
  $watch(watchFn: watcherObjType['watchFn'], listenerFn: watcherObjType['listenerFn']): void;
  $digest(): void;
  $$watchers: watcherObjType[];
}

export type IScope = IRootScope;

export default class Scope implements IScope {
  $$watchers: watcherObjType[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [x: string]: any; // to let add any property on the object'

  constructor() {
    this.$$watchers = [];
  }

  private static initWatchValue() {}

  $watch(watchFn: watcherObjType['watchFn'], listenerFn?: watcherObjType['listenerFn']) {
    this.$$watchers.push({
      watchFn,
      listenerFn: listenerFn || Lib.getNoopFunction(),
      last: Scope.initWatchValue,
    });
  }

  $digest() {
    let dirty: boolean;
    let ttl = 10;
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
        watcher.last = newValue;
        const oldShownValue: unknown = oldValue === Scope.initWatchValue ? newValue : oldValue;
        watcher.listenerFn(newValue, oldShownValue, this);
        dirty = true;
      }
    });
    return dirty;
  }
}
