import Scope from 'modules/Scope/index';

export type watcherObjType = {
  watchFn: (scope: Scope) => unknown;
  listenerFn: (newValue: unknown, oldValue: unknown, scope: Scope) => void;
  last?: unknown;
};
