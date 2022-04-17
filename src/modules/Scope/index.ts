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

  $watch(watchFn: watcherObjType['watchFn'], listenerFn: watcherObjType['listenerFn']) {
    this.$$watchers.push({
      watchFn,
      listenerFn,
    });
  }

  $digest() {
    let newValue;
    let oldValue;
    Lib.forEach(this.$$watchers, (watcher) => {
      newValue = watcher.watchFn(this);
      oldValue = watcher.last;
      if (newValue !== oldValue) {
        watcher.last = newValue;
        watcher.listenerFn(newValue, oldValue, this);
      }
    });
  }
}
