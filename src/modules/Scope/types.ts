import Scope from 'modules/Scope/index';

export type watcherObjType = {
  watchFn: (scope: Scope) => void;
  listenerFn: () => void;
};
