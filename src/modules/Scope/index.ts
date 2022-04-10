import Lib from 'util/LibHelper';
import { watcherObjType } from 'modules/Scope/types';

export interface IRootScope extends Record<string, unknown> {
  $watch(watchFn: watcherObjType['watchFn'], listenerFn: watcherObjType['listenerFn']): void;
  $digest(): void;
  $$watchers: watcherObjType[];
}

export default class Index implements IRootScope {
  $$watchers: watcherObjType[];
  [x: string]: unknown;

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
    Lib.forEach(this.$$watchers, function (watcher) {
      watcher.listenerFn();
    });
  }
}
