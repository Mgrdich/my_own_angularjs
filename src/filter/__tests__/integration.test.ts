/**
 * Cross-module composition smoke tests (Slice 12).
 *
 * Confirms the full multi-module wiring works end-to-end by composing:
 *   - `ngModule`     — `$filter`, `$interpolate`, `$locale`, the nine
 *                      built-in filters
 *   - `ngSanitize`   — opt-in `$sanitize` (used by the html-context test
 *                      in `sce-interaction.test.ts`; loaded here for
 *                      symmetry with the canonical app-bootstrap shape)
 *   - `appModule`    — a custom `reverse` filter registered via
 *                      `module.filter`
 *
 * These tests don't add new behavior coverage on individual filters
 * (each built-in already has its own dedicated test file). They guard
 * the COMPOSITION boundary: a custom filter registered on a third
 * module must be reachable from `$interpolate` resolved out of `ng`,
 * and built-in filters must compose with each other via the pipe
 * operator inside an interpolation template.
 */

import { describe, expect, it } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule } from '@di/module';
import { ngSanitize } from '@sanitize/ng-sanitize-module';

describe('Cross-module filter composition (Slice 12)', () => {
  it('chains a custom (reverse) filter with a built-in (uppercase) filter inside an interpolation', () => {
    const appModule = createModule('app', ['ng', 'ngSanitize']).filter('reverse', [
      () =>
        (s: unknown): string =>
          String(s).split('').reverse().join(''),
    ]);

    const injector = createInjector([ngModule, ngSanitize, appModule]);
    const $interpolate = injector.get('$interpolate');

    // 'hi' → 'ih' (reverse) → 'IH' (uppercase)
    expect($interpolate('{{ message | reverse | uppercase }}')({ message: 'hi' })).toBe('IH');
  });

  it('chains a built-in limitTo with a built-in json filter using its default 2-space indent', () => {
    const appModule = createModule('app', ['ng', 'ngSanitize']);
    const injector = createInjector([ngModule, ngSanitize, appModule]);
    const $interpolate = injector.get('$interpolate');

    // The grouping parens are required: filter args parse via `assignment`,
    // which itself includes the filter-chain rule, so `limitTo:2 | json`
    // (without parens) would treat `(2 | json)` as the limit argument.
    // Wrapping the first filter chain in parens forces `json` to be the
    // second filter in the outer chain — its output uses the default
    // 2-space indent.
    expect($interpolate('{{ (items | limitTo:2) | json }}')({ items: [1, 2, 3, 4] })).toBe('[\n  1,\n  2\n]');
  });

  it('renders a currency-formatted value from a numeric scope binding through a single filter', () => {
    const appModule = createModule('app', ['ng', 'ngSanitize']);
    const injector = createInjector([ngModule, ngSanitize, appModule]);
    const $interpolate = injector.get('$interpolate');

    // 12.5 | currency:'€':2 → '€12.50' (en-US default pattern, custom symbol)
    expect($interpolate('{{ price | currency:"€":2 }}')({ price: 12.5 })).toBe('€12.50');
  });
});
