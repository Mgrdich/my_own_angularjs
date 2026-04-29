/**
 * Public barrel for the `@exception-handler` module.
 *
 * Slice 1 lays down the type surface and the frozen cause-descriptor
 * vocabulary. Slice 2 adds the concrete value exports
 * (`consoleErrorExceptionHandler`, `noopExceptionHandler`, the default
 * `exceptionHandler` instance, and the `invokeExceptionHandler` helper).
 */

export { EXCEPTION_HANDLER_CAUSES } from './exception-handler-types';
export type { ExceptionHandler, ExceptionHandlerCause } from './exception-handler-types';

export {
  invokeExceptionHandler,
  consoleErrorExceptionHandler,
  noopExceptionHandler,
  exceptionHandler,
} from './exception-handler';
