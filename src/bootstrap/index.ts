/**
 * Public barrel for the `bootstrap` module — the application entry points
 * (spec 036).
 *
 * Slice 1 exposes the headless {@link bootstrapInjector} façade plus its
 * config / result types. Slice 4 adds the DOM-oriented {@link bootstrap} entry
 * point, its `{ injector, rootScope, rootElement }` result type, and the two
 * synchronous error classes. Slice 5 adds the opt-in {@link autoBootstrap}
 * (`ng-app` scan) entry point.
 */

export { autoBootstrap, bootstrap, bootstrapInjector } from '@bootstrap/bootstrap';
export type {
  BootstrapConfig,
  BootstrapInjectorConfig,
  BootstrapRegistry,
  BootstrapResult,
} from '@bootstrap/bootstrap';
export { AlreadyBootstrappedError, BootstrapTargetMissingError } from '@bootstrap/bootstrap-error';
