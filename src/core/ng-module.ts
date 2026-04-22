/**
 * `ng` — AngularJS-core DI module.
 *
 * Registers `$interpolate` (run-phase service) and `$interpolateProvider`
 * (config-phase provider) via the spec 008 `.provider()` recipe. This is the
 * first canonical registration point for future core services (`$sce`,
 * `$exceptionHandler`, `$filter`, `$http`, etc.) — each new spec will add
 * its `.provider(...)` call here.
 *
 * Consumers compose their own injector with `createInjector([ngModule, ...])`
 * and use `config(['$interpolateProvider', p => p.startSymbol('[[')])` to
 * customize delimiters before the run phase begins.
 */

import { createModule } from '@di/module';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';

export const ngModule = createModule('ng', []).provider('$interpolate', $InterpolateProvider);
