/**
 * `ngTransclude` directive — the slot marker (spec 018 Slice 5 / FS §2.6).
 *
 * Locks the AngularJS-canonical behavior for the slot-marker directive
 * registered on `ngModule`:
 *
 * - Default slot: `<div ng-transclude>` projects captured content from
 *   a `transclude: true` host. Pre-existing children are REPLACED.
 * - Element form: `<ng-transclude>` renders identically; the element
 *   itself remains in the DOM.
 * - Named slot: `<div ng-transclude="titleSlot">` projects the named
 *   slot of a multi-slot host.
 * - Fallback: unfilled optional slots keep the marker's pre-existing
 *   children. The fallback was compiled + linked against the OUTER
 *   scope by the OUTER walker before `ng-transclude` runs, so its
 *   `{{outer.x}}` interpolations resolve correctly.
 * - Error surface: named slot under `transclude: true`, undeclared
 *   slot under multi-slot host, and unenclosed marker all route via
 *   `$exceptionHandler('$compile')` and leave the marker as a no-op
 *   (pre-existing children preserved).
 *
 * Tests use the canonical `ngModule` so the `ngTransclude` directive
 * registered by `src/core/ng-module.ts` is reachable end-to-end —
 * mirroring the cross-spec-smoke pattern.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import { NgTranscludeMisuseError, UndeclaredTranscludeSlotError } from '@compiler/compile-error';
import type { CompileService, DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';

type SpyHandler = ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;

/**
 * A narrow shape covering the only injector method the tests touch —
 * `has` — without committing to the deeply-generic `Injector<...>`
 * return type of `createInjector(...)`. Mirrors the project's
 * "type-as-much-as-needed, no more" convention for test helpers.
 */
interface InjectorLike {
  has: (name: string) => boolean;
}

interface Bootstrap {
  handler: SpyHandler;
  $compile: CompileService;
  configure: (register: ($cp: $CompileProvider) => void) => void;
  injector: InjectorLike;
}

/**
 * Build an injector rooted at the canonical `ngModule` (so the
 * `ngTransclude` directive registered by `src/core/ng-module.ts` is
 * available) with a spy `$exceptionHandler` decoration. The injector
 * isn't created until `configure(register)` is called so each test
 * can register its own directives in a config block.
 */
function bootstrap(): Bootstrap {
  resetRegistry();
  const handler: SpyHandler = vi.fn<(...args: unknown[]) => void>();
  // Rebuild the canonical `'ng'` module's registry entry so dependent
  // `getModule('ng')` lookups during injector construction see a
  // populated module. The canonical `ngModule` instance (imported
  // above) is what `createInjector` actually consumes, so this
  // `createModule('ng', [])...` call is purely to satisfy any
  // registry-side bookkeeping that the canonical instance does NOT
  // own (matches the cross-spec-smoke pattern).
  createModule('ng', [])
    .factory('$exceptionHandler', [() => () => undefined])
    .provider('$sceDelegate', $SceDelegateProvider)
    .provider('$sce', $SceProvider)
    .provider('$interpolate', $InterpolateProvider)
    .provider('$filter', ['$provide', $FilterProvider])
    .provider('$compile', ['$provide', $CompileProvider]);

  let $compile: CompileService | undefined;
  let injector: InjectorLike | undefined;

  const configure = (register: ($cp: $CompileProvider) => void): void => {
    const appModule = createModule('app', ['ng'])
      .decorator('$exceptionHandler', [() => handler])
      .config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          register($cp);
        },
      ]);
    const built = createInjector([ngModule, appModule]);
    injector = built;
    $compile = built.get('$compile');
  };

  // Lazy proxy via getter — tests call `compile(...)` after `configure(...)`.
  return {
    handler,
    configure,
    get $compile() {
      if ($compile === undefined) {
        throw new Error('configure() must be called before $compile is accessed');
      }
      return $compile;
    },
    get injector() {
      if (injector === undefined) {
        throw new Error('configure() must be called before injector is accessed');
      }
      return injector;
    },
  };
}

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

afterEach(() => {
  resetRegistry();
});

describe('ngTransclude — registration on ngModule', () => {
  it('injector.has("ngTranscludeDirective") === true when "ng" is in the deps chain', () => {
    const b = bootstrap();
    b.configure(() => undefined);
    expect(b.injector.has('ngTranscludeDirective')).toBe(true);
  });
});

describe('ngTransclude — default slot projection (FS §2.6)', () => {
  it('attribute form `<div ng-transclude>` projects default-slot content', () => {
    const b = bootstrap();
    const outer = Scope.create();
    b.configure(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: true,
          link: (scope, element) => {
            const template = document.createElement('section');
            const marker = document.createElement('div');
            marker.setAttribute('ng-transclude', '');
            template.appendChild(marker);
            element.appendChild(template);
            b.$compile(template)(scope);
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    const projected = document.createElement('p');
    projected.textContent = 'inner';
    host.appendChild(projected);

    b.$compile(host)(outer);

    const marker = host.querySelector('section > div[ng-transclude]');
    expect(marker).not.toBeNull();
    expect(marker?.children.length).toBe(1);
    expect((marker?.children[0] as Element).tagName).toBe('P');
    expect(marker?.children[0]?.textContent).toBe('inner');
    // The projected child is a CLONE — not the same node the consumer authored.
    expect(marker?.children[0]).not.toBe(projected);
  });

  it('element form `<ng-transclude>` projects default-slot content; element itself stays in the DOM', () => {
    const b = bootstrap();
    b.configure(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: true,
          link: (scope, element) => {
            const template = document.createElement('section');
            const marker = document.createElement('ng-transclude');
            template.appendChild(marker);
            element.appendChild(template);
            b.$compile(template)(scope);
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    const projected = document.createElement('span');
    projected.textContent = 'hi';
    host.appendChild(projected);

    b.$compile(host)(Scope.create());

    const marker = host.querySelector('section > ng-transclude');
    expect(marker).not.toBeNull();
    expect(marker?.children.length).toBe(1);
    expect((marker?.children[0] as Element).tagName).toBe('SPAN');
    expect(marker?.children[0]?.textContent).toBe('hi');
  });

  it('default-slot projection binds against the OUTER scope', () => {
    const b = bootstrap();
    let directiveScope: Scope | null = null;
    const outer = Scope.create();
    // Marker directive inside the captured content writes its scope's `x`
    // back into its element so we can read it through the projected DOM.
    b.configure(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: true,
          link: (scope, element) => {
            directiveScope = scope;
            const template = document.createElement('section');
            const marker = document.createElement('div');
            marker.setAttribute('ng-transclude', '');
            template.appendChild(marker);
            element.appendChild(template);
            b.$compile(template)(scope);
          },
        }),
      );
      $cp.directive(
        'reader',
        ddoFactory({
          link: (scope, element) => {
            const value = (scope as unknown as { x?: string }).x;
            element.textContent = `read=${value ?? '<undefined>'}`;
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    const child = document.createElement('span');
    child.setAttribute('reader', '');
    host.appendChild(child);

    (outer as unknown as { x: string }).x = 'OUTER';
    b.$compile(host)(outer);

    expect(directiveScope).not.toBeNull();
    const marker = host.querySelector('section > div[ng-transclude]');
    expect(marker?.children[0]?.textContent).toBe('read=OUTER');
  });
});

describe('ngTransclude — named slot projection (FS §2.6)', () => {
  it('projects the named slot via `ng-transclude="titleSlot"`', () => {
    const b = bootstrap();
    b.configure(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: { titleSlot: 'card-title', bodySlot: 'card-body' },
          link: (scope, element) => {
            const template = document.createElement('section');
            const titleMarker = document.createElement('div');
            titleMarker.setAttribute('ng-transclude', 'titleSlot');
            titleMarker.className = 'title';
            const bodyMarker = document.createElement('div');
            bodyMarker.setAttribute('ng-transclude', 'bodySlot');
            bodyMarker.className = 'body';
            template.appendChild(titleMarker);
            template.appendChild(bodyMarker);
            element.appendChild(template);
            b.$compile(template)(scope);
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    host.innerHTML = '<card-title>Header</card-title><card-body>Body</card-body>';

    b.$compile(host)(Scope.create());

    const titleProjected = host.querySelector('.title')?.querySelector('card-title');
    const bodyProjected = host.querySelector('.body')?.querySelector('card-body');
    expect(titleProjected?.textContent).toBe('Header');
    expect(bodyProjected?.textContent).toBe('Body');
  });

  it("filled slot REPLACES the marker's pre-existing children", () => {
    const b = bootstrap();
    b.configure(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: { titleSlot: 'card-title' },
          link: (scope, element) => {
            const template = document.createElement('section');
            const marker = document.createElement('div');
            marker.setAttribute('ng-transclude', 'titleSlot');
            // Pre-existing fallback children — should be replaced.
            marker.appendChild(document.createTextNode('fallback'));
            template.appendChild(marker);
            element.appendChild(template);
            b.$compile(template)(scope);
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    host.innerHTML = '<card-title>filled</card-title>';

    b.$compile(host)(Scope.create());

    const marker = host.querySelector('section > div[ng-transclude="titleSlot"]');
    expect(marker?.childNodes.length).toBe(1);
    expect((marker?.childNodes[0] as Element).tagName).toBe('CARD-TITLE');
    expect(marker?.textContent).toBe('filled');
    expect(marker?.textContent).not.toContain('fallback');
  });
});

describe('ngTransclude — fallback content for unfilled optional slots (FS §2.6)', () => {
  it('keeps pre-existing children when an optional slot is unfilled', () => {
    const b = bootstrap();
    b.configure(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: { subtitleSlot: '?card-subtitle' },
          link: (scope, element) => {
            const template = document.createElement('section');
            const marker = document.createElement('div');
            marker.setAttribute('ng-transclude', 'subtitleSlot');
            marker.appendChild(document.createTextNode('No subtitle'));
            template.appendChild(marker);
            element.appendChild(template);
            b.$compile(template)(scope);
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    // No <card-subtitle> child — slot is unfilled-optional.

    b.$compile(host)(Scope.create());

    const marker = host.querySelector('section > div[ng-transclude="subtitleSlot"]');
    expect(marker?.textContent).toBe('No subtitle');
  });

  it('replaces fallback with the projected clone once the slot is filled', () => {
    const b = bootstrap();
    b.configure(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: { subtitleSlot: '?card-subtitle' },
          link: (scope, element) => {
            const template = document.createElement('section');
            const marker = document.createElement('div');
            marker.setAttribute('ng-transclude', 'subtitleSlot');
            marker.appendChild(document.createTextNode('No subtitle'));
            template.appendChild(marker);
            element.appendChild(template);
            b.$compile(template)(scope);
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    host.innerHTML = '<card-subtitle>real subtitle</card-subtitle>';

    b.$compile(host)(Scope.create());

    const marker = host.querySelector('section > div[ng-transclude="subtitleSlot"]');
    expect(marker?.textContent).toBe('real subtitle');
    expect(marker?.textContent).not.toContain('No subtitle');
  });

  it('fallback content is compiled + linked against the OUTER scope', () => {
    // A reader directive inside the fallback observes the OUTER scope's
    // property, proving the fallback was linked against the outer.
    const b = bootstrap();
    const outer = Scope.create();
    (outer as unknown as { fallback: string }).fallback = 'OUTER-VALUE';
    b.configure(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: { subtitleSlot: '?card-subtitle' },
          link: (scope, element) => {
            const template = document.createElement('section');
            const marker = document.createElement('div');
            marker.setAttribute('ng-transclude', 'subtitleSlot');
            const fbReader = document.createElement('span');
            fbReader.setAttribute('fallback-reader', '');
            marker.appendChild(fbReader);
            template.appendChild(marker);
            element.appendChild(template);
            b.$compile(template)(scope);
          },
        }),
      );
      $cp.directive(
        'fallbackReader',
        ddoFactory({
          link: (scope, element) => {
            const value = (scope as unknown as { fallback?: string }).fallback;
            element.textContent = `fb=${value ?? ''}`;
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-card', '');

    b.$compile(host)(outer);

    const marker = host.querySelector('section > div[ng-transclude="subtitleSlot"]');
    expect(marker?.textContent).toBe('fb=OUTER-VALUE');
  });
});

describe('ngTransclude — error surface (FS §2.6)', () => {
  it('named slot under a `transclude: true` host routes NgTranscludeMisuseError; marker stays a no-op', () => {
    const b = bootstrap();
    b.configure(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: (scope, element) => {
            const template = document.createElement('section');
            const marker = document.createElement('div');
            marker.setAttribute('ng-transclude', 'someName');
            marker.appendChild(document.createTextNode('untouched'));
            template.appendChild(marker);
            element.appendChild(template);
            b.$compile(template)(scope);
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    host.appendChild(document.createElement('p'));

    b.$compile(host)(Scope.create());

    const misuse = b.handler.mock.calls.filter(([err]) => err instanceof NgTranscludeMisuseError);
    expect(misuse.length).toBeGreaterThanOrEqual(1);
    const [errOnly, cause] = misuse[0] ?? [];
    expect((errOnly as Error).message).toContain('someName');
    expect((errOnly as Error).message).toContain('transclude: true exposes only the default slot');
    expect(cause).toBe('$compile');

    const marker = host.querySelector('section > div[ng-transclude="someName"]');
    expect(marker?.textContent).toBe('untouched');
  });

  it('undeclared slot under multi-slot host routes UndeclaredTranscludeSlotError with the HOST directive name', () => {
    const b = bootstrap();
    b.configure(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: { titleSlot: 'card-title' },
          link: (scope, element) => {
            const template = document.createElement('section');
            const marker = document.createElement('div');
            marker.setAttribute('ng-transclude', 'noSuchSlot');
            marker.appendChild(document.createTextNode('untouched'));
            template.appendChild(marker);
            element.appendChild(template);
            b.$compile(template)(scope);
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    host.innerHTML = '<card-title>x</card-title>';

    b.$compile(host)(Scope.create());

    const undeclared = b.handler.mock.calls.filter(([err]) => err instanceof UndeclaredTranscludeSlotError);
    expect(undeclared.length).toBeGreaterThanOrEqual(1);
    const [errOnly] = undeclared[0] ?? [];
    expect((errOnly as Error).message).toContain('myCard');
    expect((errOnly as Error).message).toContain('noSuchSlot');

    const marker = host.querySelector('section > div[ng-transclude="noSuchSlot"]');
    expect(marker?.textContent).toBe('untouched');
  });

  it('unenclosed marker (no transcluding ancestor) routes NgTranscludeMisuseError; pre-existing children preserved', () => {
    const b = bootstrap();
    b.configure(() => undefined);

    const marker = document.createElement('div');
    marker.setAttribute('ng-transclude', '');
    marker.appendChild(document.createTextNode('keep me'));

    b.$compile(marker)(Scope.create());

    const misuse = b.handler.mock.calls.filter(([err]) => err instanceof NgTranscludeMisuseError);
    expect(misuse.length).toBe(1);
    expect((misuse[0]?.[0] as Error).message).toBe(
      'ngTransclude must be used inside a directive declaring transclude: true | { … }',
    );
    expect(marker.textContent).toBe('keep me');
  });
});

describe('ngTransclude — lifecycle ordering (FS §2.6)', () => {
  it('ng-transclude post-link runs AFTER the host directive pre-link', () => {
    const b = bootstrap();
    const order: string[] = [];
    b.configure(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: true,
          compile: () => ({
            pre: () => {
              order.push('host-pre');
            },
            post: (scope, element) => {
              order.push('host-post');
              const template = document.createElement('section');
              const marker = document.createElement('div');
              marker.setAttribute('ng-transclude', '');
              template.appendChild(marker);
              element.appendChild(template);
              b.$compile(template)(scope);
              order.push('host-post-compiled');
            },
          }),
        }),
      );
      $cp.directive(
        'tail',
        ddoFactory({
          link: () => {
            order.push('tail-post');
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    const projected = document.createElement('span');
    projected.setAttribute('tail', '');
    host.appendChild(projected);

    b.$compile(host)(Scope.create());

    // The host directive's pre-link fires first, then its post-link
    // (which builds + compiles the template), and the marker's
    // post-link runs as part of the inner $compile call — so all
    // marker work is bracketed inside `host-post` … `host-post-compiled`.
    expect(order[0]).toBe('host-pre');
    expect(order[1]).toBe('host-post');
    expect(order[order.length - 1]).toBe('host-post-compiled');
  });
});

describe('ngTransclude — multiple markers in one template', () => {
  it('two `ng-transclude` markers in the same template each get an independent clone', () => {
    const b = bootstrap();
    b.configure(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: true,
          link: (scope, element) => {
            const template = document.createElement('section');
            const m1 = document.createElement('div');
            m1.setAttribute('ng-transclude', '');
            m1.className = 'first';
            const m2 = document.createElement('div');
            m2.setAttribute('ng-transclude', '');
            m2.className = 'second';
            template.appendChild(m1);
            template.appendChild(m2);
            element.appendChild(template);
            b.$compile(template)(scope);
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    const projected = document.createElement('p');
    projected.textContent = 'shared';
    host.appendChild(projected);

    b.$compile(host)(Scope.create());

    const first = host.querySelector('section > div.first > p');
    const second = host.querySelector('section > div.second > p');
    expect(first?.textContent).toBe('shared');
    expect(second?.textContent).toBe('shared');
    // Independent clones — they are NOT the same node.
    expect(first).not.toBe(second);
    expect(first).not.toBe(projected);
    expect(second).not.toBe(projected);
  });
});
