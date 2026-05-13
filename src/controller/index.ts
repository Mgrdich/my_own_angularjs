/**
 * Public barrel for the `@controller` module — controllers and the
 * `$controller` / `$controllerProvider` services (spec 020).
 *
 * Slice 1 of spec 020 ships only the foundational surface: the public
 * types and the six error classes. The `createController` ESM factory
 * lands in Slice 2; the `$ControllerProvider` DI shim lands in Slice 3;
 * `$compile` per-element integration lands in Slice 4.
 *
 * `CreateControllerArgs` is exported here (so Slice 2's unit tests can
 * import it via `@controller/controller-types` or via this barrel) but
 * is deliberately NOT re-exported from the root `src/index.ts` barrel —
 * it is an internal factory seam, not part of the published public
 * surface.
 */

export type {
  ControllerFn,
  ControllerInvokable,
  ControllerLocals,
  ControllerService,
  IControllerProvider,
  CreateControllerArgs,
} from './controller-types';

export {
  ControllerRegistrationOutOfPhaseError,
  InvalidControllerNameError,
  InvalidControllerFactoryError,
  UnknownControllerError,
  MalformedControllerAliasError,
  ControllerAsWithoutControllerError,
} from './controller-errors';

export { createController } from './controller';
