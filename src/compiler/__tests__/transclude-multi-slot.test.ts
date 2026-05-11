/**
 * Multi-slot transclusion — `transclude: { slotName: 'tag-selector' }`
 * end-to-end (spec 018 Slice 4 / FS §2.3 + §2.4 + §2.9 acceptance).
 *
 * Locks the AngularJS-canonical behavior for a directive declaring
 * the multi-slot object form:
 *
 * - Compile-phase capture routes direct-element children into named
 *   slot buckets by `directiveNormalize(tagName)` match. Kebab and
 *   camelCase tag forms both match a kebab selector.
 * - Unmatched element children, loose text, comments, and whitespace
 *   text between named slot siblings all go into the default bucket.
 * - The `?` optional prefix means an unfilled slot is NOT a link-time
 *   error and `$transclude(fn, null, slotName)` returns `[]` while
 *   still invoking `cloneAttachFn([], scope)` so consumers can render
 *   fallback (the Slice-5 `ng-transclude` use case).
 * - A REQUIRED slot (no `?` prefix) that the consumer left unfilled
 *   is reported via `$exceptionHandler('$compile')` once eagerly at
 *   link time AND at every `$transclude(...)` call site that
 *   requests the unfilled slot. The directive's link STILL runs.
 * - An undeclared `slotName` routes `UndeclaredTranscludeSlotError`.
 * - Each `$transclude(...)` call against a named slot produces an
 *   independent clone with its own scope.
 * - The host element's non-enumerable `$$ngBoundTransclude` stash
 *   carries `{ kind: 'slots', declaredSlots }` for the future
 *   `ng-transclude` marker.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import { RequiredTranscludeSlotUnfilledError, UndeclaredTranscludeSlotError } from '@compiler/compile-error';
import type {
  CompileService,
  DirectiveFactory,
  DirectiveFactoryReturn,
  TranscludeFn,
} from '@compiler/directive-types';
import type { BoundTranscludeFn } from '@compiler/transclude-types';
import { Scope } from '@core/index';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';

type SpyHandler = ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;

interface SpyHarness {
  handler: SpyHandler;
  build: (register: ($cp: $CompileProvider) => void) => CompileService;
}

function bootstrapSpy(): SpyHarness {
  const handler = vi.fn<(...args: unknown[]) => void>();
  resetRegistry();
  createModule('ng', [])
    .factory('$exceptionHandler', [() => handler])
    .provider('$sceDelegate', $SceDelegateProvider)
    .provider('$sce', $SceProvider)
    .provider('$interpolate', $InterpolateProvider)
    .provider('$filter', ['$provide', $FilterProvider])
    .provider('$compile', ['$provide', $CompileProvider]);
  return {
    handler,
    build(register) {
      const appModule = createModule('app', ['ng']).config([
        '$compileProvider',
        ($cp: $CompileProvider) => {
          register($cp);
        },
      ]);
      return createInjector([appModule]).get('$compile');
    },
  };
}

function bootstrapNoopNgModule(): void {
  resetRegistry();
  createModule('ng', [])
    .factory('$exceptionHandler', [() => () => undefined])
    .provider('$sceDelegate', $SceDelegateProvider)
    .provider('$sce', $SceProvider)
    .provider('$interpolate', $InterpolateProvider)
    .provider('$filter', ['$provide', $FilterProvider])
    .provider('$compile', ['$provide', $CompileProvider]);
}

function compileWith(register: ($cp: $CompileProvider) => void): CompileService {
  const appModule = createModule('app', ['ng']).config([
    '$compileProvider',
    ($cp: $CompileProvider) => {
      register($cp);
    },
  ]);
  return createInjector([appModule]).get('$compile');
}

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

describe('multi-slot routing — tag-name selector match (FS §2.3)', () => {
  beforeEach(() => {
    bootstrapNoopNgModule();
  });

  it('captures each declared slot into its own bucket', () => {
    let xclude: TranscludeFn | undefined;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: { titleSlot: 'card-title', bodySlot: 'card-body' },
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            xclude = $transclude;
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    const title = document.createElement('card-title');
    title.textContent = 'Hi';
    const body = document.createElement('card-body');
    body.textContent = 'Body';
    host.appendChild(title);
    host.appendChild(body);

    $compile(host)(Scope.create());

    expect(xclude).toBeTypeOf('function');
    const titleProjection = xclude?.(() => undefined, null, 'titleSlot') ?? [];
    expect(titleProjection.length).toBe(1);
    expect((titleProjection[0] as Element).tagName).toBe('CARD-TITLE');
    expect(titleProjection[0]?.textContent).toBe('Hi');
    expect(titleProjection[0]).not.toBe(title);

    const bodyProjection = xclude?.(() => undefined, null, 'bodySlot') ?? [];
    expect(bodyProjection.length).toBe(1);
    expect((bodyProjection[0] as Element).tagName).toBe('CARD-BODY');
    expect(bodyProjection[0]?.textContent).toBe('Body');
    expect(bodyProjection[0]).not.toBe(body);
  });

  it('matches uppercase and mixed-case child tags case-insensitively against a kebab selector', () => {
    // HTML parsing in jsdom lowercases tag names — `<CARD-TITLE>` and
    // `<Card-Title>` are both reported as the same tagName. The
    // captureChildren routine lowercases the tag before normalization,
    // so any case variation a consumer authors still routes to the
    // same slot.
    const projections: Node[][] = [];
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: { titleSlot: 'card-title' },
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            projections.push($transclude?.(() => undefined, null, 'titleSlot') ?? []);
          },
        }),
      );
    });

    // Mix uppercase + lowercase via innerHTML (jsdom lowercases tagName).
    const hostA = document.createElement('div');
    hostA.setAttribute('my-card', '');
    hostA.innerHTML = '<CARD-TITLE>A</CARD-TITLE>';
    $compile(hostA)(Scope.create());

    const hostB = document.createElement('div');
    hostB.setAttribute('my-card', '');
    hostB.innerHTML = '<Card-Title>B</Card-Title>';
    $compile(hostB)(Scope.create());

    expect(projections.length).toBe(2);
    expect(projections[0]?.[0]?.textContent).toBe('A');
    expect(projections[1]?.[0]?.textContent).toBe('B');
  });
});

describe('multi-slot routing — optional `?` prefix (FS §2.3 + §2.4)', () => {
  it('unfilled optional slot returns [] and invokes cloneAttachFn with ([], scope)', () => {
    const { handler, build } = bootstrapSpy();
    let xclude: TranscludeFn | undefined;
    const $compile = build(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: { subtitleSlot: '?card-subtitle' },
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            xclude = $transclude;
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    // No <card-subtitle> child.
    $compile(host)(Scope.create());

    let cloneArg: Node[] | null = null;
    let scopeArg: Scope | null = null;
    const projection = xclude?.((clone, scope) => {
      cloneArg = clone;
      scopeArg = scope;
    }, null, 'subtitleSlot');

    expect(projection).toEqual([]);
    expect(cloneArg).toEqual([]);
    expect(scopeArg).not.toBeNull();
    // No RequiredTranscludeSlotUnfilledError fired anywhere — the
    // unfilled slot was optional. The eager link-time pass and the
    // call-site path should both be silent.
    const required = handler.mock.calls.filter(
      ([err]) => err instanceof RequiredTranscludeSlotUnfilledError,
    );
    expect(required.length).toBe(0);
  });
});

describe('multi-slot routing — required-slot unfilled (FS §2.9)', () => {
  it('reports RequiredTranscludeSlotUnfilledError once eagerly at link time; directive link still runs', () => {
    const { handler, build } = bootstrapSpy();
    const linkSpy = vi.fn();
    const $compile = build(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: { titleSlot: 'card-title' },
          link: () => {
            linkSpy();
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    // No <card-title> child.
    $compile(host)(Scope.create());

    // Directive's link DID run.
    expect(linkSpy).toHaveBeenCalledTimes(1);
    // Eager link-time error report fired exactly once.
    const required = handler.mock.calls.filter(
      ([err]) => err instanceof RequiredTranscludeSlotUnfilledError,
    );
    expect(required.length).toBe(1);
    const [errOnly, cause] = required[0] ?? [];
    expect(errOnly).toBeInstanceOf(RequiredTranscludeSlotUnfilledError);
    expect((errOnly as Error).message).toContain('titleSlot');
    expect((errOnly as Error).message).toContain('card-title');
    expect((errOnly as Error).message).toContain('myCard');
    expect(cause).toBe('$compile');
  });

  it('asking $transclude(...) for an unfilled required slot ALSO routes the error and returns []', () => {
    const { handler, build } = bootstrapSpy();
    let xclude: TranscludeFn | undefined;
    const $compile = build(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: { titleSlot: 'card-title' },
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            xclude = $transclude;
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    $compile(host)(Scope.create());

    // Reset the spy to isolate the call-site report from the eager one.
    handler.mockClear();
    let attachCalled = false;
    const projection = xclude?.(() => {
      attachCalled = true;
    }, null, 'titleSlot');

    expect(projection).toEqual([]);
    // The required-unfilled path does NOT invoke cloneAttachFn (no
    // scope, nothing to render).
    expect(attachCalled).toBe(false);
    const required = handler.mock.calls.filter(
      ([err]) => err instanceof RequiredTranscludeSlotUnfilledError,
    );
    expect(required.length).toBe(1);
    expect((required[0]?.[0] as Error).message).toContain('titleSlot');
  });
});

describe('multi-slot routing — undeclared slot name (FS §2.9)', () => {
  it('$transclude(fn, null, "noSuchSlot") routes UndeclaredTranscludeSlotError', () => {
    const { handler, build } = bootstrapSpy();
    let xclude: TranscludeFn | undefined;
    const $compile = build(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: { titleSlot: 'card-title' },
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            xclude = $transclude;
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    const title = document.createElement('card-title');
    title.textContent = 'Hi';
    host.appendChild(title);
    $compile(host)(Scope.create());

    handler.mockClear();
    const projection = xclude?.(() => undefined, null, 'noSuchSlot');

    expect(projection).toEqual([]);
    const undeclared = handler.mock.calls.filter(
      ([err]) => err instanceof UndeclaredTranscludeSlotError,
    );
    expect(undeclared.length).toBe(1);
    const [err, cause] = undeclared[0] ?? [];
    expect((err as Error).message).toContain('myCard');
    expect((err as Error).message).toContain('noSuchSlot');
    expect(cause).toBe('$compile');
  });
});

describe('multi-slot routing — default slot for unmatched children (FS §2.3)', () => {
  beforeEach(() => {
    bootstrapNoopNgModule();
  });

  it('loose text, unmatched element tags, and comments all go to the default slot in document order', () => {
    let xclude: TranscludeFn | undefined;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: { titleSlot: 'card-title' },
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            xclude = $transclude;
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    host.appendChild(document.createTextNode('loose text'));
    const title = document.createElement('card-title');
    title.textContent = 'Title';
    host.appendChild(title);
    const other = document.createElement('other-tag');
    other.textContent = 'x';
    host.appendChild(other);
    host.appendChild(document.createComment(' note '));

    $compile(host)(Scope.create());

    const defaultProjection = xclude?.(() => undefined) ?? [];
    // Default bucket has: text "loose text", <other-tag>, comment.
    expect(defaultProjection.length).toBe(3);
    expect(defaultProjection[0]?.nodeType).toBe(Node.TEXT_NODE);
    expect(defaultProjection[0]?.textContent).toBe('loose text');
    expect((defaultProjection[1] as Element).tagName).toBe('OTHER-TAG');
    expect(defaultProjection[2]?.nodeType).toBe(Node.COMMENT_NODE);
    expect(defaultProjection[2]?.textContent).toBe(' note ');

    // Title slot independently captured.
    const titleProjection = xclude?.(() => undefined, null, 'titleSlot') ?? [];
    expect(titleProjection.length).toBe(1);
    expect((titleProjection[0] as Element).tagName).toBe('CARD-TITLE');
  });

  it('whitespace-only text nodes between slot siblings go to the default bucket (no error, no projection unless requested)', () => {
    let xclude: TranscludeFn | undefined;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: { titleSlot: 'card-title', bodySlot: 'card-body' },
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            xclude = $transclude;
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    host.appendChild(document.createElement('card-title'));
    host.appendChild(document.createTextNode('   '));
    host.appendChild(document.createElement('card-body'));
    host.appendChild(document.createTextNode('\n  '));

    $compile(host)(Scope.create());

    const defaultProjection = xclude?.(() => undefined) ?? [];
    expect(defaultProjection.length).toBe(2);
    for (const node of defaultProjection) {
      expect(node.nodeType).toBe(Node.TEXT_NODE);
    }
  });

  it('comments inside the host go to the default slot', () => {
    let xclude: TranscludeFn | undefined;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: { titleSlot: 'card-title' },
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            xclude = $transclude;
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    host.appendChild(document.createComment(' a comment '));
    host.appendChild(document.createElement('card-title'));

    $compile(host)(Scope.create());

    const defaultProjection = xclude?.(() => undefined) ?? [];
    expect(defaultProjection.length).toBe(1);
    expect(defaultProjection[0]?.nodeType).toBe(Node.COMMENT_NODE);
    expect(defaultProjection[0]?.textContent).toBe(' a comment ');
  });
});

describe('multi-slot routing — multi-clone of named slots (FS §2.7)', () => {
  beforeEach(() => {
    bootstrapNoopNgModule();
  });

  it('two sequential $transclude(...) calls on the same named slot produce independent clones + scopes', () => {
    const projected: { clone: Node[]; scope: Scope }[] = [];
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: { titleSlot: 'card-title' },
          link: (_scope, _element, _attrs, _ctrls, $transclude) => {
            $transclude?.(
              (clone, transcludedScope) => {
                projected.push({ clone, scope: transcludedScope });
              },
              null,
              'titleSlot',
            );
            $transclude?.(
              (clone, transcludedScope) => {
                projected.push({ clone, scope: transcludedScope });
              },
              null,
              'titleSlot',
            );
          },
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    const title = document.createElement('card-title');
    title.textContent = 'shared-master';
    host.appendChild(title);

    $compile(host)(Scope.create());

    expect(projected.length).toBe(2);
    expect(projected[0]?.clone[0]).not.toBe(projected[1]?.clone[0]);
    expect(projected[0]?.scope).not.toBe(projected[1]?.scope);
    expect(projected[0]?.clone[0]?.textContent).toBe('shared-master');
    expect(projected[1]?.clone[0]?.textContent).toBe('shared-master');
  });
});

describe('multi-slot routing — $$ngBoundTransclude stash (FS §2.6 prep)', () => {
  beforeEach(() => {
    bootstrapNoopNgModule();
  });

  it('multi-slot host stashes { kind: "slots", declaredSlots: <slot-map> }', () => {
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myCard',
        ddoFactory({
          transclude: { titleSlot: 'card-title', subtitleSlot: '?card-subtitle' },
          link: () => undefined,
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-card', '');
    host.appendChild(document.createElement('card-title'));

    $compile(host)(Scope.create());

    const bound = (host as unknown as { $$ngBoundTransclude?: BoundTranscludeFn }).$$ngBoundTransclude;
    expect(bound).toBeDefined();
    expect(bound?.kind).toBe('slots');
    expect(bound?.declaredSlots.length).toBe(2);
    const slotByName = new Map(bound?.declaredSlots.map((s) => [s.name, s]) ?? []);
    expect(slotByName.get('titleSlot')?.required).toBe(true);
    expect(slotByName.get('titleSlot')?.selector).toBe('card-title');
    expect(slotByName.get('subtitleSlot')?.required).toBe(false);
    expect(slotByName.get('subtitleSlot')?.selector).toBe('card-subtitle');
  });

  it('transclude: true host stashes { kind: "content", declaredSlots: [] } (regression)', () => {
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          transclude: true,
          link: () => undefined,
        }),
      );
    });

    const host = document.createElement('div');
    host.setAttribute('my-dir', '');
    host.appendChild(document.createElement('p'));

    $compile(host)(Scope.create());

    const bound = (host as unknown as { $$ngBoundTransclude?: BoundTranscludeFn }).$$ngBoundTransclude;
    expect(bound).toBeDefined();
    expect(bound?.kind).toBe('content');
    expect(bound?.declaredSlots.length).toBe(0);
  });
});
