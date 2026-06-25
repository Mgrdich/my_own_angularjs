/**
 * Headless application bootstrap (spec 036 Slice 1).
 *
 * `bootstrapInjector` starts the framework runtime from a list of modules
 * WITHOUT a host DOM element and returns a typed {@link Injector} handle. It is
 * the DOM-free counterpart to the page-oriented `bootstrap` / `autoBootstrap`
 * entry points (later slices). Because there is no page involved, this module
 * is deliberately FREE of any `@compiler` import — DOM-less consumers (SSR /
 * Node tooling / unit harnesses) must not pull in `$compile`.
 *
 * The framework built-ins (`ngModule`) are always available: they are
 * prepended to the normalized module list so `$sce`, `$interpolate`, the
 * built-in filters, etc. resolve out of the box without the caller listing
 * `'ng'` explicitly.
 *
 * String-name entries are resolved against the global module registry via
 * {@link getModule} (which throws `Module not found: <name>` for an
 * unregistered name); object entries are used as-is. Normalization (string →
 * object resolution + `ngModule` prepend) happens here so that
 * {@link createInjector} stays object-only.
 */

import { AlreadyBootstrappedError, BootstrapTargetMissingError } from '@bootstrap/bootstrap-error';
import { attachInjector, isBootstrapped, markBootstrapped } from '@bootstrap/element-marker';
import type { CompileService } from '@compiler/directive-types';
import type { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import type { Injector } from '@di/di-types';
import { createInjector, type MergeRegistries } from '@di/injector';
import { getModule, type AnyModule } from '@di/module';

/**
 * The type of the framework-core `ng` module instance. Prepending it to the
 * normalized module list contributes its registered services (`$sce`,
 * `$interpolate`, the built-in filters, …) to the resulting injector's static
 * registry, so `injector.get('$sce')` narrows even when the caller passes only
 * string-name modules.
 */
type NgModule = typeof ngModule;

/**
 * Extract only the statically-known **object** module entries of an input
 * tuple, dropping any `string`-name entries. String names resolve at runtime
 * (via {@link getModule}) but contribute only the framework base registry to
 * the static type — there is no value to read their `Registry` from at compile
 * time. The result is a tuple of {@link AnyModule}s suitable for
 * {@link MergeRegistries}.
 */
type ObjectModules<Modules extends readonly (AnyModule | string)[]> = Modules extends readonly [
  infer Head,
  ...infer Tail extends readonly (AnyModule | string)[],
]
  ? Head extends AnyModule
    ? readonly [Head, ...ObjectModules<Tail>]
    : ObjectModules<Tail>
  : readonly [];

/**
 * The merged registry of a bootstrap call: the framework `ng` registry plus
 * the registries of every statically-known object module entry. String-name
 * entries contribute nothing to this type but still register at runtime.
 */
export type BootstrapRegistry<Modules extends readonly (AnyModule | string)[]> = MergeRegistries<
  readonly [NgModule, ...ObjectModules<Modules>]
>;

/**
 * Optional configuration for {@link bootstrapInjector}.
 */
export interface BootstrapInjectorConfig {
  /**
   * Parity-only flag (default `true`). This project's injector is strict by
   * construction — {@link createInjector} rejects un-annotated factories via
   * `annotate`, and there is no source-parsing fallback. Passing `false` does
   * NOT enable a lenient mode; the value is threaded purely for API / roadmap
   * parity with AngularJS's `angular.bootstrap(..., { strictDi })`.
   */
  strictDi?: boolean;
}

/**
 * Start the framework runtime headlessly and return a typed injector handle.
 *
 * @param modules - Module instances and/or registered module names. The
 *   framework `ng` module is always prepended, so callers never list `'ng'`
 *   themselves. String names are resolved via {@link getModule}.
 * @param config - Optional bootstrap configuration. `strictDi` defaults to
 *   `true` and is parity-only (see {@link BootstrapInjectorConfig}).
 * @returns A typed {@link Injector}; object module entries (plus the framework
 *   built-ins) narrow `injector.get(name)`, string-name entries fall through to
 *   the dynamic escape hatch.
 * @throws {Error} with message `Module not found: <name>` when a string entry
 *   names a module that is not registered.
 *
 * @example
 * ```ts
 * const appModule = createModule('app', []).value('apiUrl', '/api');
 * const injector = bootstrapInjector([appModule]);
 * injector.get('$sce'); // framework built-in, narrowed
 * injector.get('apiUrl'); // '/api', narrowed
 * ```
 */
export function bootstrapInjector<const Modules extends readonly (AnyModule | string)[]>(
  modules: Modules,
  config: BootstrapInjectorConfig = {},
): Injector<BootstrapRegistry<Modules>> {
  // `strictDi` is parity-only: the injector is already strict by construction
  // (un-annotated factories are rejected by `annotate`), so there is no lenient
  // mode to toggle. Destructure it to document the contract and default, then
  // discard — reading it keeps the param meaningful to callers.
  const { strictDi = true } = config;
  void strictDi;

  const normalized = normalizeModules(modules);

  // `createInjector` is typed object-only and `normalized` is a width-only
  // `readonly AnyModule[]`, so it resolves to `Injector<Record<string,
  // unknown>>`. The precise merged registry — framework `ng` built-ins plus
  // the statically-known object module entries — is re-applied here via the
  // `BootstrapRegistry<Modules>` return annotation. The double cast is required
  // because the wide and narrow registries do not structurally overlap.
  return createInjector(normalized) as unknown as Injector<BootstrapRegistry<Modules>>;
}

/**
 * Resolve a `(AnyModule | string)[]` input to the object-only, `ngModule`-led
 * list `createInjector` expects. String names resolve via {@link getModule}
 * (which throws `Module not found: <name>`); the framework `ng` module is
 * always prepended so callers never list `'ng'`. Shared by both the headless
 * {@link bootstrapInjector} and the DOM {@link bootstrap} entry points.
 */
function normalizeModules(modules: readonly (AnyModule | string)[]): readonly AnyModule[] {
  const resolved: AnyModule[] = modules.map((entry) => (typeof entry === 'string' ? getModule(entry) : entry));
  return [ngModule, ...resolved];
}

/**
 * Optional configuration for the DOM {@link bootstrap} entry point. Extends
 * {@link BootstrapInjectorConfig} so the parity-only `strictDi` flag is accepted
 * here too.
 */
export interface BootstrapConfig extends BootstrapInjectorConfig {
  /**
   * When `true`, attach the application's `$injector` to the host element as a
   * non-enumerable `$$ngInjector` slot (AngularJS-style element-data discovery).
   * Default `false` — the double-bootstrap guard relies on the separate
   * `$$ngBootstrapped` marker, NOT on injector attachment, so leaving this off
   * keeps the element clean of the injector reference.
   */
  attachToElement?: boolean;
}

/**
 * The bundled handle returned by {@link bootstrap}: the application's injector,
 * its root scope, and the host element the app was started on. This richer
 * result (vs. classic AngularJS's injector-only return) is a deliberate
 * deviation that avoids hidden global state — hold the handle, no global lookup
 * required.
 *
 * @example
 * ```ts
 * const el = document.createElement('div');
 * el.innerHTML = '<p>{{greeting}}</p>';
 * const result: BootstrapResult<readonly [typeof appModule]> = bootstrap(el, [appModule]);
 * result.rootScope === result.injector.get('$rootScope'); // true
 * result.rootElement === el; // true
 * ```
 */
export interface BootstrapResult<Modules extends readonly (AnyModule | string)[]> {
  /** The application injector — typed via {@link BootstrapRegistry}. */
  readonly injector: Injector<BootstrapRegistry<Modules>>;
  /** The application root scope (`injector.get('$rootScope')`, same reference). */
  readonly rootScope: Scope;
  /** The host element the application was bootstrapped on. */
  readonly rootElement: Element;
}

/**
 * Start an application on a host DOM element: prepare the element and its
 * contents, connect them to a fresh root context, perform the first compile +
 * digest so the markup is live immediately, and return a bundled handle.
 *
 * The startup order is fixed (AngularJS parity):
 *   1. Guard against double-bootstrap (throws {@link AlreadyBootstrappedError}).
 *   2. Normalize modules (resolve string names, prepend `ngModule`).
 *   3. `createInjector(..., { seed: { $rootElement: element } })` — runs config
 *      blocks, then run blocks.
 *   4. Resolve `$rootScope`.
 *   5. Stamp the `$$ngBootstrapped` marker (+ optional `$injector` attachment).
 *   6. `$rootScope.$apply(() => $compile(element)($rootScope))` — first compile
 *      + digest.
 *   7. Return `{ injector, rootScope, rootElement }`.
 *
 * @param element - The host element. A `null` / `undefined` value throws
 *   {@link BootstrapTargetMissingError} synchronously.
 * @param modules - Module instances and/or registered module names. The
 *   framework `ng` module is always prepended.
 * @param config - Optional configuration (`strictDi` parity-only;
 *   `attachToElement` opt-in injector attachment).
 * @returns A {@link BootstrapResult} handle.
 * @throws {BootstrapTargetMissingError} when `element` is null/undefined.
 * @throws {AlreadyBootstrappedError} when `element` is already bootstrapped.
 * @throws {Error} `Module not found: <name>` for an unregistered string module.
 *
 * @example
 * ```ts
 * const appModule = createModule('app', []).run([
 *   '$rootScope',
 *   ($rootScope: Scope) => {
 *     $rootScope.name = 'World';
 *   },
 * ]);
 * const el = document.createElement('div');
 * el.innerHTML = '<p>Hello {{name}}</p>';
 * const { injector, rootScope, rootElement } = bootstrap(el, [appModule]);
 * el.textContent; // 'Hello World' — already rendered
 * ```
 */
export function bootstrap<const Modules extends readonly (AnyModule | string)[]>(
  element: Element | null | undefined,
  modules: Modules,
  config: BootstrapConfig = {},
): BootstrapResult<Modules> {
  // Step 1 — missing-target + double-bootstrap guards, thrown synchronously.
  if (element === null || element === undefined) {
    throw new BootstrapTargetMissingError();
  }
  if (isBootstrapped(element)) {
    throw new AlreadyBootstrappedError(element.tagName.toLowerCase());
  }

  // `strictDi` is parity-only (see BootstrapInjectorConfig); read to document
  // the contract, then discard.
  const { strictDi = true, attachToElement = false } = config;
  void strictDi;

  // Step 2 — normalize modules (resolve strings, prepend `ngModule`).
  const normalized = normalizeModules(modules);

  // Step 3 — build the injector, seeding `$rootElement` so it is injectable.
  // The wide → narrow registry re-cast mirrors `bootstrapInjector`.
  const injector = createInjector(normalized, {
    seed: { $rootElement: element },
  }) as unknown as Injector<BootstrapRegistry<Modules>>;

  // Step 4 — resolve `$rootScope` (lazy singleton registered on `ngModule`).
  const rootScope = injector.get<Scope>('$rootScope');

  // Step 5 — stamp the bootstrap marker (+ opt-in injector attachment). The
  // marker is what the double-bootstrap guard reads; attachment is convenience.
  markBootstrapped(element);
  if (attachToElement) {
    attachInjector(element, injector);
  }

  // Step 6 — first compile + digest inside a single `$apply`, so the markup is
  // live the moment `bootstrap` returns. `$compile` lives on `ngModule` and is
  // obtained through the injector (never via a static `@compiler` import).
  const $compile = injector.get<CompileService>('$compile');
  rootScope.$apply(() => {
    $compile(element)(rootScope);
  });

  // Step 7 — return the bundled handle.
  return { injector, rootScope, rootElement: element };
}

/**
 * The four recognized `ng-app` attribute spellings, probed in order. The legacy
 * class-based form (`class="ng-app"`) is intentionally NOT supported — only the
 * attribute forms (technical-considerations §2.7).
 *
 * The scan deliberately does NOT use a comma-joined `querySelectorAll`: the
 * `ng:app` spelling needs its `:` escaped to be a valid attribute selector
 * (`[ng\\:app]`), and jsdom's selector engine does not match that escape
 * against a `setAttribute('ng:app', …)`-stamped node — it silently returns no
 * match. So the scan falls back to a manual document-order walk that probes
 * `hasAttribute` for each spelling (which handles the colon name correctly);
 * the technical considerations explicitly sanction this fallback.
 */
const NG_APP_ATTRIBUTES = ['ng-app', 'data-ng-app', 'ng:app', 'x-ng-app'] as const;

/**
 * Read the `ng-app` module-name value off a matched element by probing the four
 * attribute spellings in order. Returns the first present attribute's value
 * (which may be the empty string for `ng-app=""`), or `''` if — defensively —
 * none is present.
 */
function readNgAppModuleName(element: Element): string {
  for (const attr of NG_APP_ATTRIBUTES) {
    const value = element.getAttribute(attr);
    if (value !== null) {
      return value;
    }
  }
  return '';
}

/** `true` when the element bears any of the four `ng-app` attribute spellings. */
function hasNgAppAttribute(element: Element): boolean {
  return NG_APP_ATTRIBUTES.some((attr) => element.hasAttribute(attr));
}

/**
 * Find the FIRST element (in document order) under `scanRoot` bearing one of the
 * four `ng-app` attribute spellings. `querySelectorAll('*')` yields every
 * descendant element in document order; an `Element` scan root is also probed
 * itself first (it is not included in its own `querySelectorAll` results,
 * whereas a `Document` root's descendants already cover everything reachable).
 * Returns `null` when nothing matches.
 */
function findNgAppElement(scanRoot: Document | Element): Element | null {
  if (scanRoot instanceof Element && hasNgAppAttribute(scanRoot)) {
    return scanRoot;
  }
  for (const candidate of scanRoot.querySelectorAll('*')) {
    if (hasNgAppAttribute(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Opt-in automatic page start (spec 036 Slice 5 / technical-considerations §2.7).
 *
 * Scans a region of the page for the FIRST element (in document order) bearing
 * one of the four `ng-app` attribute spellings — `ng-app`, `data-ng-app`,
 * `ng:app`, `x-ng-app` — and, if found, performs a DOM page start on that
 * element via {@link bootstrap}, using the attribute's value as the module name
 * (an empty value, e.g. `ng-app=""`, starts with just the framework modules).
 *
 * This is OPT-IN: nothing happens until the host calls `autoBootstrap()`. It is
 * a SILENT no-op when no marker matches, and when there is no page at all
 * (`document` is undefined in a non-browser environment). The legacy
 * class-based form is intentionally NOT supported — only the four attribute
 * spellings.
 *
 * An `ng-app` nested inside an already-started region hits the shared
 * `$$ngBootstrapped` guard inside {@link bootstrap} and throws
 * {@link AlreadyBootstrappedError} — this is intended and deliberately NOT
 * suppressed.
 *
 * @param root - The region to scan. Defaults to the global `document`. Both
 *   `Document` and `Element` expose `querySelectorAll`, so either may be passed
 *   to limit the scan to a subtree.
 * @param config - Optional bootstrap configuration, forwarded verbatim to
 *   {@link bootstrap}.
 *
 * @example
 * ```ts
 * // index.html: <div ng-app="myApp"><p>Hello {{name}}</p></div>
 * createModule('myApp', []).run([
 *   '$rootScope',
 *   ($rootScope: Scope) => {
 *     ($rootScope as unknown as { name: string }).name = 'World';
 *   },
 * ]);
 * autoBootstrap(); // finds the marker, starts 'myApp', renders "Hello World"
 * ```
 */
export function autoBootstrap(root?: Element | Document, config: BootstrapConfig = {}): void {
  // Non-browser guard: read the global `document` lazily so a host that runs in
  // a DOM-less environment (or stubs `document` to undefined) is a clean no-op.
  if (root === undefined && typeof document === 'undefined') {
    return;
  }

  const scanRoot = root ?? document;

  // Find the first document-order element bearing any of the four spellings via
  // a manual `hasAttribute` walk — robust against the `ng:app` colon-escaping
  // gap in jsdom's selector engine (see NG_APP_ATTRIBUTES).
  const target = findNgAppElement(scanRoot);
  if (target === null) {
    // No marker → silent no-op.
    return;
  }

  const moduleName = readNgAppModuleName(target);
  bootstrap(target, moduleName ? [moduleName] : [], config);
}
