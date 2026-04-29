/**
 * `ng` — AngularJS-core DI module.
 *
 * Registers the core run-phase services (`$exceptionHandler`, `$sceDelegate`,
 * `$sce`, `$interpolate`) and their config-phase providers
 * (`$sceDelegateProvider`, `$sceProvider`, `$interpolateProvider`) via the
 * spec 008 `.provider()` recipe. Registration order is informational — the
 * actual instantiation order is driven by the DI dependency graph (`$sce`
 * depends on `$sceDelegate`, `$interpolate` depends on `$sce`). Future specs
 * add their `.provider(...)` call here.
 *
 * Consumers compose their own injector with `createInjector([ngModule, ...])`
 * and use `config(['$interpolateProvider', p => p.startSymbol('[[')])` or
 * `config(['$sceProvider', p => p.enabled(false)])` to customize behavior
 * before the run phase begins.
 */

import { createModule } from '@di/module';
import { consoleErrorExceptionHandler, type ExceptionHandler } from '@exception-handler/index';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import type { InterpolateService } from '@interpolate/interpolate-types';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import type { SceDelegateService, SceService } from '@sce/sce-types';

declare module '@di/di-types' {
  interface ModuleRegistry {
    ng: {
      registry: {
        $exceptionHandler: ExceptionHandler;
        $interpolate: InterpolateService;
        $sceDelegate: SceDelegateService;
        $sce: SceService;
      };
      config: {
        $interpolateProvider: $InterpolateProvider;
        $sceDelegateProvider: $SceDelegateProvider;
        $sceProvider: $SceProvider;
      };
    };
  }
}

export const ngModule = createModule('ng', [])
  .factory('$exceptionHandler', [() => consoleErrorExceptionHandler])
  .provider('$sceDelegate', $SceDelegateProvider)
  .provider('$sce', $SceProvider)
  .provider('$interpolate', $InterpolateProvider);
