/**
 * Registration-phase validation of the `transclude` DDO field
 * (spec 018 Slice 2 / FS §2.1 + §2.3 + technical-considerations §2.3).
 *
 * Exercises `normalizeDirective`'s `transclude` block end-to-end through
 * the lazy `<name>Directive` provider lookup. Throws raised during
 * factory normalization are caught by the existing factory-invocation
 * try/catch in `$$buildDirectiveArrayProvider` and routed via
 * `$exceptionHandler('$compile')` — the same path the spec-017
 * `IsolateScopeNotSupportedError` follows. Tests use a `vi.fn` handler
 * spy as the `$exceptionHandler` override (mirrors
 * `compile-provider.test.ts > IsolateScopeNotSupportedError`).
 *
 * No runtime transclusion behavior runs here — Slice 2 only populates
 * the `Directive.transclude` field on the normalized directive object.
 * The compiler still walks the DOM identically to spec 017; runtime
 * transclusion arrives in Slice 3.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import {
  DuplicateTranscludeSelectorError,
  ElementTranscludeNotSupportedError,
  InvalidTranscludeSelectorError,
  InvalidTranscludeSlotNameError,
  InvalidTranscludeValueError,
} from '@compiler/compile-error';
import type { Directive, DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import type { Injector } from '@di/di-types';
import { createInjector } from '@di/injector';
import { createModule } from '@di/module';

import { bootstrapNgModule } from './test-helpers';

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

/**
 * Sibling of `ddoFactory` for tests that deliberately pass a DDO
 * shape carrying fields not yet on the public `DirectiveDefinition`
 * interface — chiefly `transclude`. The runtime read is via
 * `(ddo as { transclude?: unknown }).transclude`, so an `unknown`
 * input is the right surface for these tests.
 */
function ddoFactoryUnsafe(returnValue: unknown): DirectiveFactory {
  return [() => returnValue as DirectiveFactoryReturn] as DirectiveFactory;
}

type SpyHandler = ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;

interface SpyHarness {
  handler: SpyHandler;
  register: (configure: ($cp: $CompileProvider) => void) => Injector;
}

/**
 * Builds an injector pre-wired with a `$exceptionHandler` spy. The spy
 * is the FIRST positional argument of every captured call (cause is
 * the SECOND). Mirrors the pattern in `compile-provider.test.ts >
 * IsolateScopeNotSupportedError`.
 */
function buildSpyHarness(): SpyHarness {
  const handler = vi.fn<(...args: unknown[]) => void>();
  bootstrapNgModule({ exceptionHandler: handler });
  return {
    handler,
    register(configure) {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          configure($cp);
        },
      ]);
      return createInjector([appModule]) as unknown as Injector;
    },
  };
}

describe('normalizeDirective — transclude validation (spec 018 Slice 2)', () => {
  describe('accepted shapes (FS §2.1)', () => {
    beforeEach(() => {
      bootstrapNgModule();
    });

    it('transclude: true normalizes to { kind: "content" }', () => {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive('myDir', ddoFactoryUnsafe({ transclude: true, link: () => undefined }));
        },
      ]);
      const directives = createInjector([appModule]).get<Directive[]>('myDirDirective');
      expect(directives).toHaveLength(1);
      const [directive] = directives;
      expect(directive?.transclude).toEqual({ kind: 'content' });
    });

    it('transclude: { titleSlot: "card-title" } normalizes to a one-slot kind: "slots" form (selector pre-normalized)', () => {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive(
            'myCard',
            ddoFactoryUnsafe({
              transclude: { titleSlot: 'card-title' },
              link: () => undefined,
            }),
          );
        },
      ]);
      const directives = createInjector([appModule]).get<Directive[]>('myCardDirective');
      expect(directives).toHaveLength(1);
      expect(directives[0]?.transclude).toEqual({
        kind: 'slots',
        slots: [
          {
            name: 'titleSlot',
            selector: 'card-title',
            normalizedSelector: 'cardTitle',
            required: true,
          },
        ],
      });
    });

    it('the `?` prefix marks the slot optional and is stripped from `selector`', () => {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive(
            'myCard',
            ddoFactoryUnsafe({
              transclude: { subtitleSlot: '?card-subtitle' },
              link: () => undefined,
            }),
          );
        },
      ]);
      const directives = createInjector([appModule]).get<Directive[]>('myCardDirective');
      expect(directives[0]?.transclude).toEqual({
        kind: 'slots',
        slots: [
          {
            name: 'subtitleSlot',
            selector: 'card-subtitle',
            normalizedSelector: 'cardSubtitle',
            required: false,
          },
        ],
      });
    });

    it('the normalized slots array is frozen (downstream cannot mutate it)', () => {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive(
            'myCard',
            ddoFactoryUnsafe({
              transclude: { titleSlot: 'card-title' },
            }),
          );
        },
      ]);
      const directives = createInjector([appModule]).get<Directive[]>('myCardDirective');
      const transclude = directives[0]?.transclude;
      expect(transclude).toBeDefined();
      if (transclude?.kind !== 'slots') {
        throw new Error('expected kind=slots');
      }
      expect(Object.isFrozen(transclude.slots)).toBe(true);
    });

    it('omitting `transclude` leaves the normalized field unset', () => {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive('plainDir', ddoFactory({ link: () => undefined }));
        },
      ]);
      const directives = createInjector([appModule]).get<Directive[]>('plainDirDirective');
      expect(directives).toHaveLength(1);
      // The property must be ABSENT on the normalized object (not just
      // set to `undefined`) — per Slice 2 sub-task: "leave normalized
      // `transclude` field UNSET (don't write `undefined` explicitly)".
      expect('transclude' in (directives[0] as object)).toBe(false);
      expect(directives[0]?.transclude).toBeUndefined();
    });

    it('transclude: false is accepted and behaves identically to omitting it', () => {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive(
            'falseDir',
            ddoFactoryUnsafe({
              transclude: false,
              link: () => undefined,
            }),
          );
        },
      ]);
      const directives = createInjector([appModule]).get<Directive[]>('falseDirDirective');
      expect(directives).toHaveLength(1);
      expect('transclude' in (directives[0] as object)).toBe(false);
      expect(directives[0]?.transclude).toBeUndefined();
    });

    it('two slots with the SAME name collapse per JS literal duplicate-key semantics (last entry wins)', () => {
      // Build the duplicate-key object via a runtime path (assignment)
      // rather than an object literal — TypeScript's TS1117 rejects
      // duplicate keys in `{}` literals, but the JS-semantics rule we
      // are locking in (last assignment wins) is identical either way.
      const slotsWithDuplicate: Record<string, string> = {};
      slotsWithDuplicate['a'] = 'first-tag';
      slotsWithDuplicate['a'] = 'last-tag';
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          $cp.directive(
            'myCard',
            ddoFactoryUnsafe({
              transclude: slotsWithDuplicate,
            }),
          );
        },
      ]);
      const directives = createInjector([appModule]).get<Directive[]>('myCardDirective');
      expect(directives[0]?.transclude).toEqual({
        kind: 'slots',
        slots: [
          {
            name: 'a',
            selector: 'last-tag',
            normalizedSelector: 'lastTag',
            required: true,
          },
        ],
      });
    });
  });

  describe('transclude: "element" — explicit forward-compat rejection (FS §2.1)', () => {
    it("routes ElementTranscludeNotSupportedError via $exceptionHandler('$compile'); sibling directives keep registering normally", () => {
      const { handler, register } = buildSpyHarness();
      const injector = register(($cp) => {
        $cp.directive(
          'elementDir',
          ddoFactoryUnsafe({
            transclude: 'element',
            link: () => undefined,
          }),
        );
        // A second directive under a DIFFERENT name still resolves
        // normally — the registration time error is per-directive.
        $cp.directive(
          'siblingDir',
          ddoFactory({
            link: () => undefined,
          }),
        );
      });
      const elementDirectives = injector.get<Directive[]>('elementDirDirective');
      const siblingDirectives = injector.get<Directive[]>('siblingDirDirective');

      // The bad directive is dropped from its array.
      expect(elementDirectives).toHaveLength(0);
      // The sibling registers and resolves unaffected.
      expect(siblingDirectives).toHaveLength(1);

      expect(handler).toHaveBeenCalledTimes(1);
      const [err, cause] = handler.mock.calls[0] ?? [];
      expect(err).toBeInstanceOf(ElementTranscludeNotSupportedError);
      expect(cause).toBe('$compile');
      expect((err as Error).message).toContain('elementDir');
      expect((err as Error).message).toMatch(/Element transclusion/);
    });
  });

  describe("InvalidTranscludeValueError (FS §2.1 'any other value')", () => {
    function expectInvalidValueRoutes(value: unknown, description: RegExp): void {
      const { handler, register } = buildSpyHarness();
      const injector = register(($cp) => {
        $cp.directive(
          'myDir',
          ddoFactoryUnsafe({
            transclude: value,
            link: () => undefined,
          }),
        );
      });
      const directives = injector.get<Directive[]>('myDirDirective');
      expect(directives).toHaveLength(0);
      expect(handler).toHaveBeenCalledTimes(1);
      const [err, cause] = handler.mock.calls[0] ?? [];
      expect(err).toBeInstanceOf(InvalidTranscludeValueError);
      expect(cause).toBe('$compile');
      expect((err as Error).message).toContain('myDir');
      expect((err as Error).message).toMatch(description);
    }

    it('rejects a numeric value (42)', () => {
      expectInvalidValueRoutes(42, /42 \(number\)/);
    });

    it("rejects a non-'element' string ('true')", () => {
      expectInvalidValueRoutes('true', /'true' \(string\)/);
    });

    it('rejects an array', () => {
      expectInvalidValueRoutes([], /\[\] \(array\)/);
    });

    it('rejects null', () => {
      expectInvalidValueRoutes(null, /null \(null\)/);
    });
  });

  describe('InvalidTranscludeSlotNameError (FS §2.3 — slot key validation)', () => {
    function expectInvalidSlotNameRoutes(slotMap: Record<string, string>, expectedKey: string): void {
      const { handler, register } = buildSpyHarness();
      const injector = register(($cp) => {
        $cp.directive(
          'myDir',
          ddoFactoryUnsafe({
            transclude: slotMap,
            link: () => undefined,
          }),
        );
      });
      const directives = injector.get<Directive[]>('myDirDirective');
      expect(directives).toHaveLength(0);
      expect(handler).toHaveBeenCalledTimes(1);
      const [err, cause] = handler.mock.calls[0] ?? [];
      expect(err).toBeInstanceOf(InvalidTranscludeSlotNameError);
      expect(cause).toBe('$compile');
      expect((err as Error).message).toContain('myDir');
      expect((err as Error).message).toContain(`"${expectedKey}"`);
    }

    it('rejects a key starting with a digit', () => {
      expectInvalidSlotNameRoutes({ '1bad': 'tag' }, '1bad');
    });

    it('rejects an empty-string key', () => {
      expectInvalidSlotNameRoutes({ '': 'tag' }, '');
    });

    it('rejects a key containing whitespace', () => {
      expectInvalidSlotNameRoutes({ 'has space': 'tag' }, 'has space');
    });
  });

  describe('InvalidTranscludeSelectorError (FS §2.3 — selector value validation)', () => {
    function expectInvalidSelectorRoutes(slotMap: Record<string, unknown>, expectedKey: string): void {
      const { handler, register } = buildSpyHarness();
      const injector = register(($cp) => {
        $cp.directive(
          'myDir',
          ddoFactoryUnsafe({
            transclude: slotMap,
            link: () => undefined,
          }),
        );
      });
      const directives = injector.get<Directive[]>('myDirDirective');
      expect(directives).toHaveLength(0);
      expect(handler).toHaveBeenCalledTimes(1);
      const [err, cause] = handler.mock.calls[0] ?? [];
      expect(err).toBeInstanceOf(InvalidTranscludeSelectorError);
      expect(cause).toBe('$compile');
      expect((err as Error).message).toContain('myDir');
      expect((err as Error).message).toContain(`"${expectedKey}"`);
    }

    it('rejects an empty selector string', () => {
      expectInvalidSelectorRoutes({ a: '' }, 'a');
    });

    it('rejects a numeric selector', () => {
      expectInvalidSelectorRoutes({ a: 42 }, 'a');
    });

    it('rejects a non-kebab (mixed-case) selector', () => {
      expectInvalidSelectorRoutes({ a: 'NotKebab' }, 'a');
    });

    it('rejects a null selector', () => {
      expectInvalidSelectorRoutes({ a: null }, 'a');
    });
  });

  describe('DuplicateTranscludeSelectorError (FS §2.3 — selector uniqueness)', () => {
    it('rejects two slots resolving to the same normalized selector', () => {
      const { handler, register } = buildSpyHarness();
      const injector = register(($cp) => {
        $cp.directive(
          'myDir',
          ddoFactoryUnsafe({
            transclude: { a: 'card-title', b: 'card-title' },
            link: () => undefined,
          }),
        );
      });
      const directives = injector.get<Directive[]>('myDirDirective');
      expect(directives).toHaveLength(0);
      expect(handler).toHaveBeenCalledTimes(1);
      const [err, cause] = handler.mock.calls[0] ?? [];
      expect(err).toBeInstanceOf(DuplicateTranscludeSelectorError);
      expect(cause).toBe('$compile');
      expect((err as Error).message).toContain('myDir');
      expect((err as Error).message).toContain('"card-title"');
    });
  });
});
