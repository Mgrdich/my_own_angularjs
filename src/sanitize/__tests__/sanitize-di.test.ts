import { beforeEach, describe, expect, it } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { ngSanitize } from '@sanitize/ng-sanitize-module';
import { sanitize as esmSanitize } from '@sanitize/sanitize';
import { $SanitizeProvider } from '@sanitize/sanitize-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';

describe('$sanitize DI integration — Slice 4', () => {
  // The `ng` and `ngSanitize` value-exports are constructed at module-load
  // time and wired into the DI registry then. A neighbouring test that calls
  // `resetRegistry()` evicts them, so we re-register both modules here per
  // test to keep this file self-contained — mirroring the precedent in
  // `interpolate-di.test.ts`. The `ng` module's full `$sce` chain is
  // required because `$InterpolateProvider.$get` depends on `$sce`
  // (spec 012 slice 6).
  beforeEach(() => {
    resetRegistry();
    createModule('ng', [])
      .provider('$sceDelegate', $SceDelegateProvider)
      .provider('$sce', $SceProvider)
      .provider('$interpolate', $InterpolateProvider);
    createModule('ngSanitize', []).provider('$sanitize', $SanitizeProvider);
  });

  describe('basic resolution with ngSanitize loaded', () => {
    it('exposes $sanitize as a callable service via createInjector([ngModule, ngSanitize])', () => {
      const injector = createInjector([ngModule, ngSanitize]);
      const service = injector.get('$sanitize');
      expect(service).toBeTypeOf('function');
    });

    it('$sanitize service is a singleton across injector.get calls', () => {
      const injector = createInjector([ngModule, ngSanitize]);
      const a = injector.get('$sanitize');
      const b = injector.get('$sanitize');
      expect(a).toBe(b);
    });

    it('injector.has("$sanitize") returns true when ngSanitize is loaded', () => {
      const injector = createInjector([ngModule, ngSanitize]);
      expect(injector.has('$sanitize')).toBe(true);
    });

    it('the resolved service sanitizes a basic input', () => {
      const injector = createInjector([ngModule, ngSanitize]);
      const service = injector.get('$sanitize');
      expect(service('<p>hi</p>')).toBe('<p>hi</p>');
    });
  });

  describe('ngSanitize NOT loaded', () => {
    it('injector.has("$sanitize") returns false', () => {
      const injector = createInjector([ngModule]);
      expect(injector.has('$sanitize')).toBe(false);
    });

    it('injector.get("$sanitize") throws "Unknown provider"', () => {
      const injector = createInjector([ngModule]);
      // The probe-then-fallback pattern in `$sce` (Slice 5) relies on this
      // being the failure mode rather than a silent `undefined`.
      expect(() => injector.get('$sanitize')).toThrow(/Unknown provider: \$sanitize/);
    });
  });

  describe('provider lifecycle', () => {
    it('resolving $sanitizeProvider at run time throws (config-phase only)', () => {
      const injector = createInjector([ngModule, ngSanitize]);
      // Per spec 008, providers are only injectable by `<name>Provider` during
      // the config phase. The run-phase injector does not expose them, so a
      // direct lookup throws "Unknown provider".
      expect(() => injector.get('$sanitizeProvider')).toThrow(/Unknown provider: \$sanitizeProvider/);
    });
  });

  describe('config-phase observation', () => {
    it('config block receives the provider and its mutations affect the produced service', () => {
      const myAppModule = createModule('myApp', ['ngSanitize']).config([
        '$sanitizeProvider',
        (p: $SanitizeProvider) => {
          p.enableSvg(true);
        },
      ]);

      const injector = createInjector([ngModule, ngSanitize, myAppModule]);
      const service = injector.get('$sanitize');
      // With SVG enabled the `<svg>` tag survives the allow-list gate.
      expect(service('<svg></svg>')).toContain('svg');
    });

    it('config-block addValidElements registrations propagate to the resolved service', () => {
      const myAppModule = createModule('myApp', ['ngSanitize']).config([
        '$sanitizeProvider',
        (p: $SanitizeProvider) => {
          p.addValidElements(['custom-tag']);
        },
      ]);

      const injector = createInjector([ngModule, ngSanitize, myAppModule]);
      const service = injector.get('$sanitize');
      expect(service('<custom-tag>hi</custom-tag>')).toBe('<custom-tag>hi</custom-tag>');
    });
  });

  describe('ESM/DI parity', () => {
    // Pinning representative inputs against the ESM default export catches
    // any drift between the two construction paths — e.g. a missed default
    // in `$SanitizeProvider.$get` would surface as a divergent output here.
    it.each([
      ['plain text', 'plain'],
      ['allowed tag', '<p>hi</p>'],
      ['disallowed script tag', '<script>x</script>y'],
      ['javascript: URI in href', '<a href="javascript:1">x</a>'],
      ['onerror event handler attribute', '<img src="x.png" onerror="alert(1)">'],
    ])('produces identical output to the ESM default for %s', (_label, input) => {
      const injector = createInjector([ngModule, ngSanitize]);
      const diService = injector.get('$sanitize');
      expect(diService(input)).toBe(esmSanitize(input));
    });
  });

  describe('module identity', () => {
    it('ngSanitize value-export carries the expected module name', () => {
      // Sanity check against accidental rename of the registered module —
      // `createInjector([ngModule, ngSanitize])` wouldn't resolve the right
      // registry slot if these names drifted.
      expect(ngSanitize.name).toBe('ngSanitize');
    });
  });
});
