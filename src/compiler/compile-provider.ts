/**
 * `$CompileProvider` — DI-facing configurator for the `$compile`
 * service.
 *
 * Mirrors `$FilterProvider` (`src/filter/filter-provider.ts:33`):
 * a `$provide`-injected constructor; private state for the
 * registered names and per-name factory list; a string-form +
 * object-form `directive(...)` registration surface; and an
 * `as const` `$get` array that delegates to `createCompile` at
 * run-phase.
 *
 * Multiple-factories-per-name semantics (FS §2.3): every call to
 * `directive(name, factory)` appends to `$$factoryMap.get(name)`.
 * The FIRST registration for a given name installs a single
 * `<name>Directive` provider whose `$get` reads the up-to-date
 * factory list lazily — subsequent registrations only mutate the
 * map and become visible on the next lookup.
 *
 * Spec 022 Slice 1 LIFTED the `IsolateScopeNotSupportedError` rejection
 * at `<name>Directive` provider `$get` time. Object-form `scope: { … }`
 * declarations are now normalized via `parseIsolateBindings(...)` into a
 * `NormalizedBindingMap` stashed on `Directive.isolateBindings`. Malformed
 * binding specs throw `InvalidIsolateBindingError`, caught lazily by the
 * same `try/catch` and routed via `$exceptionHandler('$compile')`.
 */

import { IDENT_RE } from '@controller/controller';
import {
  ControllerAsWithoutControllerError,
  InvalidControllerFactoryError,
  MalformedControllerAliasError,
} from '@controller/controller-errors';
import type { ControllerInvokable, ControllerService } from '@controller/controller-types';
import type { Injector } from '@di/di-types';
import type { ProvideService } from '@di/provide-types';
import { invokeExceptionHandler, type ExceptionHandler } from '@exception-handler/index';
import type { InterpolateService } from '@interpolate/interpolate-types';
import type { TemplateRequestFn } from '@template/template-types';

import { createCompile } from './compile';
import {
  DuplicateTranscludeSelectorError,
  EmptyTemplateError,
  EmptyTemplateUrlError,
  InvalidComponentDefinitionError,
  InvalidDirectiveFactoryError,
  InvalidDirectiveNameError,
  InvalidTemplateUrlValueError,
  InvalidTemplateValueError,
  InvalidTranscludeSelectorError,
  InvalidTranscludeSlotNameError,
  InvalidTranscludeValueError,
  ReplaceTrueNotSupportedError,
  TemplateAndTemplateUrlCombinedError,
} from './compile-error';
import { parseIsolateBindings, type NormalizedBindingMap } from './isolate-bindings';
import { sanitizeUri } from './sanitize-uri';
import type { SanitizeUriService } from './sanitize-uri-types';
import { describeValue } from './describe-value';
import { directiveNormalize } from './directive-normalize';
import type {
  CompileFn,
  CompileService,
  ComponentDefinition,
  Directive,
  DirectiveDefinition,
  DirectiveFactory,
  DirectiveFactoryReturn,
  LinkFn,
  NormalizedTemplate,
  TemplateFn,
  TemplateUrlFn,
} from './directive-types';
import type { NormalizedTransclude, TranscludeSlot, TranscludeSlotMap } from './transclude-types';

const VALID_DIRECTIVE_NAME = /^[a-zA-Z][a-zA-Z0-9]*$/;

/**
 * Default safe-list pattern for link (`a`/`area[href]`) URLs (spec 034
 * Slice 2). Matches the AngularJS 1.7+ canonical
 * `aHrefSanitizationTrustedUrlList` default: a small allow-list of
 * known-safe schemes (`http(s)` / `ftp` / `mailto` / `tel` / `sms` /
 * `file`) PLUS any relative URL (the trailing alternation matches a URL
 * with no scheme — anything whose first `:`, if present, is preceded by
 * a `/`, `?`, or `#`, i.e. NOT a scheme separator). A `javascript:`,
 * `vbscript:`, or dangerous `data:` URL fails both alternatives and is
 * neutralized with an `unsafe:` prefix by {@link sanitizeUri}.
 *
 * This mirrors AngularJS's `aHrefSanitizationTrustedUrlList` source
 * default (`compile.js`):
 * `/^\s*(https?|s?ftp|mailto|tel|file|sms):/` extended with the
 * relative-URL alternative that AngularJS applies through `urlIsSafe`.
 */
const DEFAULT_A_HREF_SANITIZATION_TRUSTED_URL_LIST = /^\s*(https?|s?ftp|mailto|tel|sms|file):|^\s*[^:/?#]*(?:[/?#]|$)/i;

/**
 * Default safe-list pattern for media-source (`img[src]`, `[srcset]`)
 * URLs (spec 034 Slice 2). Matches the AngularJS 1.7+ canonical
 * `imgSrcSanitizationTrustedUrlList` default: known-safe fetch schemes
 * (`http(s)` / `ftp` / `file` / `blob`) PLUS `data:image/` (inline
 * images are safe) PLUS any relative URL. A `data:text/html` or
 * `javascript:` source fails all alternatives and is neutralized with an
 * `unsafe:` prefix by {@link sanitizeUri}.
 */
const DEFAULT_IMG_SRC_SANITIZATION_TRUSTED_URL_LIST =
  /^\s*((https?|ftp|file|blob):|data:image\/)|^\s*[^:/?#]*(?:[/?#]|$)/i;

/**
 * Suffix appended to every directive name when it is registered as a
 * DI provider. `$compileProvider.directive('myDir', …)` installs a
 * `myDirDirective` provider whose `$get` returns the array of
 * normalized directives. The compiler reads back via the same suffix
 * (`$injector.get('myDirDirective')`), so both call sites MUST stay in
 * lockstep — the const exists to enforce that.
 */
const DIRECTIVE_PROVIDER_SUFFIX = 'Directive';

/**
 * Module-level monotonically-increasing counter assigned to each
 * directive object produced from a factory invocation. Two factories
 * registered under the same name receive distinct `index` values, so
 * they tie-break deterministically inside the priority-sort even when
 * their priorities are equal.
 */
let $$globalDirectiveIndex = 0;

export class $CompileProvider {
  // The config-phase `$provide` reference is injected via the
  // provider constructor (`['$provide', $CompileProvider]` form on
  // `ngModule`). Used to register each `<name>Directive` provider
  // exactly once on the FIRST registration of that name.
  private readonly $$provide: ProvideService;

  /**
   * Names that have a `<name>Directive` provider already registered
   * with `$provide.provider`. Read at `$get` time to short-circuit
   * `getDirectivesByName(unknown)` without going through `$injector.get`
   * (which would throw "Unknown provider").
   */
  private readonly $$registeredNames = new Set<string>();

  /**
   * Per-name accumulator of unresolved factories. Mutated in place by
   * subsequent `directive(name, factory)` calls; the `<name>Directive`
   * provider's `$get` reads this map lazily at lookup time so later
   * registrations are visible.
   */
  private readonly $$factoryMap = new Map<string, DirectiveFactory[]>();

  /**
   * Comment-directive scanning toggle (spec 034 Slice 1 / FS §2 —
   * `commentDirectivesEnabled`). When `false`, the directive collector
   * skips the comment (M-restrict) pass entirely, so `<!-- directive:
   * foo -->` markers are no longer recognized during compilation — a
   * performance lever and attack-surface reduction matching AngularJS.
   * Defaults to `true` (today's behavior). Read once at `$get` time and
   * threaded into `createCompile`, so the setting is frozen at run-phase
   * start (AngularJS parity).
   */
  private $$commentDirectivesEnabled = true;

  /**
   * Class-directive scanning toggle (spec 034 Slice 1 / FS §2 —
   * `cssClassDirectivesEnabled`). When `false`, the directive collector
   * skips the class (C-restrict) pass entirely, so class-name directives
   * are no longer recognized during compilation. Defaults to `true`
   * (today's behavior). Read once at `$get` time and threaded into
   * `createCompile`, so the setting is frozen at run-phase start.
   */
  private $$cssClassDirectivesEnabled = true;

  /**
   * Link-URL safe-list pattern (spec 034 Slice 2 / FS §2 —
   * `aHrefSanitizationTrustedUrlList`). Used by the compiler-level
   * {@link sanitizeUri} pass at the `a`/`area[href]` write path: a
   * resolved `href` that does NOT match this RegExp is neutralized with
   * an `unsafe:` prefix. Defaults to the AngularJS-standard safe-URL
   * pattern — a DELIBERATE behavior change from spec 031's pass-through
   * (see technical-considerations §3). Read once at `$get` time and
   * threaded into `createCompile`, so the setting is frozen at run-phase
   * start (AngularJS parity).
   */
  private $$aHrefSanitizationTrustedUrlList: RegExp = DEFAULT_A_HREF_SANITIZATION_TRUSTED_URL_LIST;

  /**
   * Media-source URL safe-list pattern (spec 034 Slice 2 / FS §2 —
   * `imgSrcSanitizationTrustedUrlList`). Used by the compiler-level
   * {@link sanitizeUri} pass at the `img[src]` / `[srcset]` write path:
   * a resolved `src` that does NOT match this RegExp is neutralized with
   * an `unsafe:` prefix. Defaults to the AngularJS-standard media
   * safe-URL pattern. Read once at `$get` time and threaded into
   * `createCompile`, so the setting is frozen at run-phase start.
   */
  private $$imgSrcSanitizationTrustedUrlList: RegExp = DEFAULT_IMG_SRC_SANITIZATION_TRUSTED_URL_LIST;

  /**
   * Strict-component-bindings toggle (spec 034 Slice 3 / FS §2 —
   * `strictComponentBindingsEnabled`). When `true`, the isolate-binding
   * wiring reports {@link MissingComponentBindingError} via
   * `$exceptionHandler('$compile')` for any REQUIRED binding (`<` / `=` /
   * `@` / `&` WITHOUT the `?` modifier) whose source attribute is absent
   * on the linked element. Defaults to `false` — today's lenient behavior
   * (a missing attribute leaves the local undefined / one-way degrades).
   * Read once at `$get` time and threaded into `createCompile`, so the
   * setting is frozen at run-phase start (AngularJS parity).
   */
  private $$strictComponentBindingsEnabled = false;

  /**
   * Debug-info toggle (spec 034 Slice 4 / FS §2 — `debugInfoEnabled`).
   * When `true` (the default), the per-element linker attaches AngularJS
   * marker classes — `ng-scope` on a new (non-isolate) child scope,
   * `ng-isolate-scope` on an isolate-scope element, and `ng-binding` on
   * an element carrying an interpolation / `ng-bind`-family binding — by
   * APPENDING to the element's class list (consumer classes are never
   * replaced). Scope retrieval for dev-tools inspection stays available
   * via the existing non-enumerable `$$ngScope` slot
   * ({@link import('./cleanup').getElementScope}). When `false`, none of
   * the marker classes are added — production output stays clean. Read
   * once at `$get` time and threaded into `createCompile`, so the setting
   * is frozen at run-phase start (AngularJS parity).
   */
  private $$debugInfoEnabled = true;

  constructor($provide: ProvideService) {
    this.$$provide = $provide;

    // Spec 034 Slice 2 — register the internal `$$sanitizeUri` service.
    // Its `$get` closes over the provider's `$$` pattern fields, read
    // LAZILY at run-phase resolution so a config-block setter call lands
    // before the patterns are captured (same frozen-at-`$get` contract as
    // every other config method). The built-in `ng-href` / `ng-src` /
    // `ng-srcset` alias directives inject this service, so they apply the
    // SAME configured safe-list as the eager attribute-interpolation
    // write path in `attributes.ts`. A free factory (not a method on
    // `this`) avoids a circular `$compile` ← directive ← `$compile` dep
    // — `$$sanitizeUri` depends on nothing.
    $provide.factory('$$sanitizeUri', [
      (): SanitizeUriService =>
        (uri: string, isMediaUrl: boolean): string =>
          sanitizeUri(
            uri,
            isMediaUrl,
            isMediaUrl ? this.$$imgSrcSanitizationTrustedUrlList : this.$$aHrefSanitizationTrustedUrlList,
          ),
    ]);
  }

  /**
   * Config-phase getter/setter for comment-directive scanning
   * (spec 034 Slice 1).
   *
   * - Called WITH a boolean → validates the argument, stores it, and
   *   returns `this` for chaining.
   * - Called with NO argument → returns the current value.
   *
   * Config-phase only — the provider is only reachable from a `config`
   * block. The stored value is read once at `$get` time, so a mutation
   * after `$get` has no effect (AngularJS parity).
   *
   * @example
   * ```ts
   * appModule.config([
   *   '$compileProvider',
   *   ($cp: $CompileProvider) => {
   *     $cp.commentDirectivesEnabled(false); // disable `<!-- directive: … -->`
   *   },
   * ]);
   * ```
   */
  commentDirectivesEnabled(): boolean;
  commentDirectivesEnabled(value: boolean): this;
  commentDirectivesEnabled(value?: boolean): boolean | this {
    if (value === undefined) {
      return this.$$commentDirectivesEnabled;
    }
    if (typeof value !== 'boolean') {
      throw new TypeError('commentDirectivesEnabled expects a boolean argument');
    }
    this.$$commentDirectivesEnabled = value;
    return this;
  }

  /**
   * Config-phase getter/setter for class-directive scanning
   * (spec 034 Slice 1).
   *
   * - Called WITH a boolean → validates the argument, stores it, and
   *   returns `this` for chaining.
   * - Called with NO argument → returns the current value.
   *
   * Config-phase only — the provider is only reachable from a `config`
   * block. The stored value is read once at `$get` time, so a mutation
   * after `$get` has no effect (AngularJS parity).
   *
   * @example
   * ```ts
   * appModule.config([
   *   '$compileProvider',
   *   ($cp: $CompileProvider) => {
   *     $cp.cssClassDirectivesEnabled(false); // disable class-form directives
   *   },
   * ]);
   * ```
   */
  cssClassDirectivesEnabled(): boolean;
  cssClassDirectivesEnabled(value: boolean): this;
  cssClassDirectivesEnabled(value?: boolean): boolean | this {
    if (value === undefined) {
      return this.$$cssClassDirectivesEnabled;
    }
    if (typeof value !== 'boolean') {
      throw new TypeError('cssClassDirectivesEnabled expects a boolean argument');
    }
    this.$$cssClassDirectivesEnabled = value;
    return this;
  }

  /**
   * Config-phase getter/setter for the link (`a`/`area[href]`) URL
   * safe-list (spec 034 Slice 2).
   *
   * - Called WITH a RegExp → validates the argument, stores it, and
   *   returns `this` for chaining.
   * - Called with NO argument → returns the current pattern.
   *
   * The compiler routes an interpolated / `ng-href` `href` value through
   * {@link sanitizeUri} against this pattern before writing the DOM
   * attribute: a non-matching URL is neutralized with an `unsafe:`
   * prefix. Config-phase only — the stored value is read once at `$get`
   * time, so a mutation after `$get` has no effect (AngularJS parity).
   *
   * @example
   * ```ts
   * appModule.config([
   *   '$compileProvider',
   *   ($cp: $CompileProvider) => {
   *     // Only allow links under a custom `myapp:` scheme.
   *     $cp.aHrefSanitizationTrustedUrlList(/^myapp:/);
   *   },
   * ]);
   * ```
   */
  aHrefSanitizationTrustedUrlList(): RegExp;
  aHrefSanitizationTrustedUrlList(value: RegExp): this;
  aHrefSanitizationTrustedUrlList(value?: RegExp): RegExp | this {
    if (value === undefined) {
      return this.$$aHrefSanitizationTrustedUrlList;
    }
    if (!(value instanceof RegExp)) {
      throw new TypeError('aHrefSanitizationTrustedUrlList expects a RegExp argument');
    }
    this.$$aHrefSanitizationTrustedUrlList = value;
    return this;
  }

  /**
   * Config-phase getter/setter for the media-source (`img[src]`,
   * `[srcset]`) URL safe-list (spec 034 Slice 2).
   *
   * - Called WITH a RegExp → validates the argument, stores it, and
   *   returns `this` for chaining.
   * - Called with NO argument → returns the current pattern.
   *
   * The compiler routes an interpolated / `ng-src` / `ng-srcset` value
   * through {@link sanitizeUri} against this pattern before writing the
   * DOM attribute: a non-matching URL is neutralized with an `unsafe:`
   * prefix. Config-phase only — the stored value is read once at `$get`
   * time, so a mutation after `$get` has no effect (AngularJS parity).
   *
   * @example
   * ```ts
   * appModule.config([
   *   '$compileProvider',
   *   ($cp: $CompileProvider) => {
   *     $cp.imgSrcSanitizationTrustedUrlList(/^\s*(https?|data:image\/):/);
   *   },
   * ]);
   * ```
   */
  imgSrcSanitizationTrustedUrlList(): RegExp;
  imgSrcSanitizationTrustedUrlList(value: RegExp): this;
  imgSrcSanitizationTrustedUrlList(value?: RegExp): RegExp | this {
    if (value === undefined) {
      return this.$$imgSrcSanitizationTrustedUrlList;
    }
    if (!(value instanceof RegExp)) {
      throw new TypeError('imgSrcSanitizationTrustedUrlList expects a RegExp argument');
    }
    this.$$imgSrcSanitizationTrustedUrlList = value;
    return this;
  }

  /**
   * Config-phase getter/setter for strict component bindings
   * (spec 034 Slice 3).
   *
   * - Called WITH a boolean → validates the argument, stores it, and
   *   returns `this` for chaining.
   * - Called with NO argument → returns the current value.
   *
   * When `true`, using a component / directive without supplying one of
   * its REQUIRED (non-`?`) inputs routes
   * {@link MissingComponentBindingError} via
   * `$exceptionHandler('$compile')`, naming the missing input. When
   * `false` (the default), a missing required binding is tolerated —
   * today's lenient behavior (the local stays undefined / one-way
   * degrades). Config-phase only — the provider is only reachable from a
   * `config` block; the stored value is read once at `$get` time, so a
   * mutation after `$get` has no effect (AngularJS parity).
   *
   * @example
   * ```ts
   * appModule.config([
   *   '$compileProvider',
   *   ($cp: $CompileProvider) => {
   *     $cp.strictComponentBindingsEnabled(true); // require every non-`?` binding
   *   },
   * ]);
   * ```
   */
  strictComponentBindingsEnabled(): boolean;
  strictComponentBindingsEnabled(value: boolean): this;
  strictComponentBindingsEnabled(value?: boolean): boolean | this {
    if (value === undefined) {
      return this.$$strictComponentBindingsEnabled;
    }
    if (typeof value !== 'boolean') {
      throw new TypeError('strictComponentBindingsEnabled expects a boolean argument');
    }
    this.$$strictComponentBindingsEnabled = value;
    return this;
  }

  /**
   * Config-phase getter/setter for debug information (spec 034 Slice 4).
   *
   * - Called WITH a boolean → validates the argument, stores it, and
   *   returns `this` for chaining.
   * - Called with NO argument → returns the current value.
   *
   * When `true` (the default), compiled elements carry AngularJS
   * debugging metadata — the marker classes `ng-scope` (new child
   * scope), `ng-isolate-scope` (isolate-scope element), and `ng-binding`
   * (interpolation / `ng-bind`-family binding) — appended (never
   * replacing) the consumer's classes, plus the ability to retrieve an
   * element's scope for inspection via the existing
   * {@link import('./cleanup').getElementScope} hook. When `false`, none
   * of the marker classes are attached, so production output stays clean
   * and slightly lighter. Config-phase only — the provider is only
   * reachable from a `config` block; the stored value is read once at
   * `$get` time, so a mutation after `$get` has no effect (AngularJS
   * parity).
   *
   * @example
   * ```ts
   * appModule.config([
   *   '$compileProvider',
   *   ($cp: $CompileProvider) => {
   *     $cp.debugInfoEnabled(false); // strip ng-scope / ng-binding markers
   *   },
   * ]);
   * ```
   */
  debugInfoEnabled(): boolean;
  debugInfoEnabled(value: boolean): this;
  debugInfoEnabled(value?: boolean): boolean | this {
    if (value === undefined) {
      return this.$$debugInfoEnabled;
    }
    if (typeof value !== 'boolean') {
      throw new TypeError('debugInfoEnabled expects a boolean argument');
    }
    this.$$debugInfoEnabled = value;
    return this;
  }

  /**
   * Register a directive factory under `name`.
   *
   * Two forms:
   * - **String form**: `directive(name, factory)` registers a single
   *   factory. Repeated calls with the same name accumulate (FS §2.3)
   *   — both factories run on a matched node, both participate in
   *   priority sorting independently.
   * - **Object form**: `directive({ a: factoryA, b: factoryB })`
   *   iterates the entries and recurses into the string form. An
   *   empty object is a no-op.
   *
   * Returns `this` for chaining.
   *
   * @example
   * ```ts
   * appModule.config([
   *   '$compileProvider',
   *   ($cp: $CompileProvider) => {
   *     $cp.directive('greet', () => ({
   *       link: (_scope, el, attrs) => {
   *         el.textContent = `Hello, ${attrs['name']}`;
   *       },
   *     }));
   *   },
   * ]);
   * ```
   */
  directive(name: string, factory: DirectiveFactory): this;
  directive(map: Record<string, DirectiveFactory>): this;
  directive(nameOrMap: string | Record<string, DirectiveFactory>, factory?: DirectiveFactory): this {
    if (typeof nameOrMap === 'string') {
      this.$$registerSingle(nameOrMap, factory);
      return this;
    }
    for (const [key, value] of Object.entries(nameOrMap)) {
      this.$$registerSingle(key, value);
    }
    return this;
  }

  /**
   * Register a component under `name` (spec 022 Slice 5 / FS §2.5 /
   * technical-considerations §2.5).
   *
   * A component is, internally, a directive registration. This method
   * translates the {@link ComponentDefinition} into a directive factory
   * returning a DDO with the AngularJS 1.5+ canonical defaults:
   *
   *  - `restrict: 'E'`
   *  - `scope: definition.bindings ?? {}` — always object-form
   *    (isolate scope), empty when no bindings declared
   *  - `bindToController: true`
   *  - `controller: definition.controller ?? function NoopController() {}`
   *  - `controllerAs: definition.controllerAs ?? '$ctrl'`
   *  - Pass-through: `template`, `templateUrl`, `transclude`, `require`
   *
   * Then delegates to `this.directive(name, factory)`. The existing
   * directive registration rules apply — accumulation (two components
   * registered under the same name BOTH match), priority/terminal
   * sorting, name validation, and registration timing are all inherited
   * from `.directive`.
   *
   * Registration-time validation routes
   * {@link InvalidComponentDefinitionError} directly to the caller
   * (synchronous), matching how `.directive`'s name / factory validation
   * surfaces today. The downstream directive-normalize errors
   * (`InvalidIsolateBindingError`, `InvalidControllerFactoryError`, …)
   * still route lazily via `$exceptionHandler('$compile')` at provider
   * `$get` time through the existing factory `try/catch` —
   * `EXCEPTION_HANDLER_CAUSES` stays at 10.
   *
   * Returns `this` for chaining.
   *
   * @example
   * ```ts
   * $compileProvider.component('userCard', {
   *   bindings: { user: '<', onSelect: '&' },
   *   controller: ['$element', function () {
   *     this.$onInit = () => { void this.user; };
   *     this.pick = () => this.onSelect({ id: this.user.id });
   *   }],
   *   template: '<div class="card">{{ $ctrl.user.name }}</div>',
   * });
   * // Consumer markup:
   * //   <user-card user="someExpr" on-select="handler(id)"></user-card>
   * // After link, the element gets:
   * //   - an isolate scope ({ user: '<', onSelect: '&' })
   * //   - the controller instance exposed as `$ctrl` on that scope
   * //   - bindings landed on `$ctrl.user` / `$ctrl.onSelect` BEFORE
   * //     `$onInit` runs
   * ```
   *
   * @see InvalidComponentDefinitionError — Registration-time errors.
   */
  component(name: string, definition: ComponentDefinition): this {
    // Validate `name` defensively — even though the typed signature
    // declares `name: string`, calls from JS / untyped TS may pass
    // non-string values, so the runtime check stays. The `as unknown`
    // view sidesteps the `no-unnecessary-condition` lint rule that
    // would otherwise complain about checking a typed `string` value.
    const rawName = name as unknown;
    if (typeof rawName !== 'string' || !VALID_DIRECTIVE_NAME.test(rawName)) {
      throw new InvalidComponentDefinitionError(
        typeof rawName === 'string' ? rawName : describeValue(rawName),
        'name must be a non-empty camelCase identifier',
      );
    }
    // Same defensive read pattern for `definition` — must be a plain
    // object at the runtime boundary, but the typed signature
    // `ComponentDefinition` would mark the null / array / primitive
    // checks as unreachable. The `as unknown` view restores the
    // narrowing.
    const rawDefinition = definition as unknown;
    if (
      rawDefinition === null ||
      rawDefinition === undefined ||
      typeof rawDefinition !== 'object' ||
      Array.isArray(rawDefinition)
    ) {
      throw new InvalidComponentDefinitionError(name, 'definition must be a plain object');
    }

    // The default controller is a named function (not an arrow) so it
    // shows up in stack traces with a useful label. Matches the
    // AngularJS 1.x `function noop() {}` precedent. Wrapped in the
    // array-style annotation so it satisfies the project's strict
    // `annotate` rule (bare functions without `$inject` are rejected).
    // Every component without an explicit controller gets a fresh
    // `NoopController` invokable.
    const userController = definition.controller;
    const controller: ControllerInvokable | string =
      userController === undefined ? [function NoopController() {}] : userController;
    const controllerAs = definition.controllerAs ?? '$ctrl';
    const bindings = definition.bindings ?? {};

    // Translate the CDO into a directive factory returning the DDO.
    // The factory is wrapped in the array-style annotation `[fn]` (no
    // deps + trailing function) — the project's `$injector.invoke`
    // rejects bare functions without `$inject`, so the array form is
    // the canonical zero-dep spelling used everywhere else. The
    // directive normalizer will validate
    // `controller`/`controllerAs`/`scope`/`transclude`/`template`
    // lazily at provider `$get` time, with throws routed via
    // `$exceptionHandler('$compile')` through the existing factory
    // try/catch in `$$buildDirectiveArrayProvider`.
    const factory: DirectiveFactory = [
      () => {
        const ddo: DirectiveDefinition = {
          restrict: 'E',
          scope: bindings,
          bindToController: true,
          controller,
          controllerAs,
        };
        if (definition.template !== undefined) {
          ddo.template = definition.template;
        }
        if (definition.templateUrl !== undefined) {
          ddo.templateUrl = definition.templateUrl;
        }
        if (definition.transclude !== undefined) {
          ddo.transclude = definition.transclude;
        }
        if (definition.require !== undefined) {
          ddo.require = definition.require;
        }
        return ddo;
      },
    ] as DirectiveFactory;

    this.directive(name, factory);
    return this;
  }

  private $$registerSingle(name: string, factory: unknown) {
    if (!VALID_DIRECTIVE_NAME.test(name)) {
      throw new InvalidDirectiveNameError(name);
    }
    if (!isValidFactoryShape(factory)) {
      throw new InvalidDirectiveFactoryError(name);
    }

    let factories = this.$$factoryMap.get(name);
    if (factories === undefined) {
      factories = [];
      this.$$factoryMap.set(name, factories);
      // First registration for `name` — install the `<name>Directive`
      // provider exactly once. Subsequent registrations only mutate the
      // captured factory list; the provider's `$get` reads it lazily so
      // late additions are visible.
      //
      // Slice 11: the `<name>Directive` provider's `$get` ALSO depends
      // on `$exceptionHandler` so each per-factory invocation can be
      // wrapped in `try/catch` and routed through the configured
      // handler with cause `'$compile'`. A throwing factory is treated
      // as if it returned `undefined` — the directive is omitted from
      // the returned array, but other factories under the same name
      // (and at other names) continue to resolve normally.
      this.$$provide.provider(`${name}${DIRECTIVE_PROVIDER_SUFFIX}`, {
        $get: ['$injector', '$exceptionHandler', this.$$buildDirectiveArrayProvider(name)] as const,
      });
      this.$$registeredNames.add(name);
    }
    factories.push(factory);
  }

  /**
   * Returns the factory function used by the `<name>Directive`
   * provider's `$get` invokable. It reads `$$factoryMap.get(name)!`
   * lazily at lookup time, invokes each factory via `$injector.invoke`,
   * normalizes the result into a {@link Directive} object, and assigns
   * a globally-unique `index` for tie-breaking.
   *
   * Slice 11: each per-factory `$injector.invoke(factory)` AND each
   * subsequent `normalizeDirective` call is wrapped in a single
   * `try/catch`. On throw the error is routed via
   * `invokeExceptionHandler(handler, err, '$compile')` and the
   * directive is silently omitted from the returned array — other
   * factories under the same name continue to resolve. This matches
   * FS §2.16: "A throwing factory […] error is reported via
   * `$exceptionHandler(err, '$compile')`; the directive is treated as
   * if it returned `undefined` (no compile, no link); other directives
   * on the same node continue."
   *
   * `InvalidIsolateBindingError` (spec 022 Slice 1) thrown by
   * `parseIsolateBindings` inside `normalizeDirective` is caught here
   * via the same path. Registration-time errors
   * (`InvalidDirectiveNameError`, `InvalidDirectiveFactoryError`)
   * still throw synchronously to the caller from `$$registerSingle`
   * — those are programmer errors and are not routed through
   * `$exceptionHandler`.
   */
  private $$buildDirectiveArrayProvider(name: string) {
    return ($injector: Injector, $exceptionHandler: ExceptionHandler): Directive[] => {
      const factories = this.$$factoryMap.get(name) ?? [];
      const directives: Directive[] = [];
      for (const factory of factories) {
        try {
          const factoryReturn = $injector.invoke(factory);
          directives.push(normalizeDirective(name, factoryReturn));
        } catch (err) {
          invokeExceptionHandler($exceptionHandler, err, '$compile');
          // Skip this directive — fall through to the next factory in
          // the list. The walker will see whatever directives DID
          // resolve successfully and link them as usual.
        }
      }
      return directives;
    };
  }

  /**
   * Run-phase `$get` invokable. Resolves `$injector`, `$controller`,
   * `$interpolate`, `$exceptionHandler`, and `$templateRequest`, then
   * constructs the `CompileService` via `createCompile`. The closure
   * over `this.$$registeredNames` keeps the lookup short-circuit
   * synchronous — unknown names skip the `$injector.get` round-trip
   * entirely.
   *
   * **Spec 019 / Slice 5** adds `$templateRequest` to the deps list.
   * Inline templates (this slice) do not consume it; the option threads
   * through ahead of the async `templateUrl` deferred-drain (Slice 6)
   * so the DI wiring is stable across the two slices.
   *
   * **Spec 020 / Slice 4** adds `$controller`. The compiler's
   * per-element controller seam needs a resolved reference in its
   * closure rather than reaching for it through `injector.get(...)` on
   * every element. `$ControllerProvider.$get` only depends on
   * `'$injector'`, so adding `'$controller'` here doesn't open a
   * circular-dep path back to `$compile`.
   */
  $get = [
    '$injector',
    '$controller',
    '$interpolate',
    '$exceptionHandler',
    '$templateRequest',
    (
      $injector: Injector,
      $controller: ControllerService,
      $interpolate: InterpolateService,
      $exceptionHandler: ExceptionHandler,
      $templateRequest: TemplateRequestFn,
    ): CompileService =>
      createCompile({
        getDirectivesByName: (name: string): Directive[] =>
          this.$$registeredNames.has(name) ? $injector.get<Directive[]>(`${name}${DIRECTIVE_PROVIDER_SUFFIX}`) : [],
        injector: $injector,
        controller: $controller,
        interpolate: $interpolate,
        exceptionHandler: $exceptionHandler,
        templateRequest: $templateRequest,
        // Spec 034 Slice 1 — config-phase directive-scan toggles read
        // once here so the settings are frozen at run-phase start
        // (AngularJS parity). Defaults `true` preserve today's behavior.
        commentDirectivesEnabled: this.$$commentDirectivesEnabled,
        cssClassDirectivesEnabled: this.$$cssClassDirectivesEnabled,
        // Spec 034 Slice 2 — config-phase URL safe-list patterns read
        // once here so they are frozen at run-phase start (AngularJS
        // parity). The compiler routes interpolated `href` / `src`
        // values through `sanitizeUri` against these patterns at the
        // attribute write path; the `$$sanitizeUri` service (registered
        // in the constructor) closes over the SAME fields for the
        // `ng-href` / `ng-src` / `ng-srcset` alias directives.
        aHrefSanitizationTrustedUrlList: this.$$aHrefSanitizationTrustedUrlList,
        imgSrcSanitizationTrustedUrlList: this.$$imgSrcSanitizationTrustedUrlList,
        // Spec 034 Slice 3 — config-phase strict-binding toggle read once
        // here so the setting is frozen at run-phase start (AngularJS
        // parity). Default `false` preserves today's lenient behavior.
        strictComponentBindingsEnabled: this.$$strictComponentBindingsEnabled,
        // Spec 034 Slice 4 — config-phase debug-info toggle read once
        // here so the setting is frozen at run-phase start (AngularJS
        // parity). Default `true` attaches the `ng-scope` /
        // `ng-isolate-scope` / `ng-binding` marker classes at link time.
        debugInfoEnabled: this.$$debugInfoEnabled,
      }),
  ] as const;
}

function isValidFactoryShape(factory: unknown): factory is DirectiveFactory {
  if (factory === null || factory === undefined) {
    return false;
  }
  if (typeof factory === 'function') {
    return true;
  }
  if (Array.isArray(factory) && factory.length > 0) {
    return true;
  }
  return false;
}

/**
 * Slot-name validator (camelCase JS identifier). Used by
 * `normalizeDirective` to reject keys like `'1bad'`, `''`, `'has space'`.
 */
const VALID_SLOT_NAME = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * Selector validator (kebab-case tag name). Used by `normalizeDirective`
 * to reject values like `''`, `'NotKebab'`, `'42abc'`. Applied AFTER the
 * optional leading `?` has been stripped.
 */
const VALID_SLOT_SELECTOR = /^[a-z][a-z0-9-]*$/;

/**
 * Validates and normalizes the `transclude` DDO field per spec-018
 * Slice 2 / technical-considerations §2.3.
 *
 * Returns the post-normalize {@link NormalizedTransclude} discriminated
 * union for `true` and the multi-slot object form, or `undefined` when
 * the directive opts out (`undefined`, `false`, or the field omitted).
 *
 * Throws on any other input — all throws are routed through
 * `$exceptionHandler('$compile')` by the factory-invocation try/catch
 * in {@link $$buildDirectiveArrayProvider} above.
 */
function normalizeTransclude(directiveName: string, transclude: unknown): NormalizedTransclude | undefined {
  if (transclude === undefined || transclude === false) {
    return undefined;
  }
  if (transclude === true) {
    return { kind: 'content' };
  }
  if (transclude === 'element') {
    // Spec 027 Slice 2: element-form transclusion is the AngularJS-canonical
    // "host-detach + comment-placeholder" mode — the host element itself is
    // captured into the default bucket and replaced in-place by a Comment
    // node at compile time. The empty `slots` / `required` / `optional`
    // arrays satisfy the {@link NormalizedTransclude} discriminated union
    // (they are never read for `kind: 'element'`) and mirror the shape of
    // the `'slots'` / `'content'` branches. The capture pipeline routes the
    // host into `defaultBucket: [host]` (single-element bucket) so the
    // existing default-bucket linker handles it unchanged. The throw site
    // that previously rejected this value via `ElementTranscludeNotSupportedError`
    // (the spec 018 forward-compat seam) is retired; the error class
    // remains exported as `@deprecated` for a one-release grace period.
    return { kind: 'element', slots: [], required: [], optional: [] };
  }
  if (typeof transclude === 'object' && transclude !== null && !Array.isArray(transclude)) {
    const slots: TranscludeSlot[] = [];
    const seenNormalizedSelectors = new Map<string, string>();
    for (const [key, rawValue] of Object.entries(transclude as Record<string, unknown>)) {
      if (!VALID_SLOT_NAME.test(key)) {
        throw new InvalidTranscludeSlotNameError(directiveName, key);
      }
      if (typeof rawValue !== 'string' || rawValue.length === 0) {
        throw new InvalidTranscludeSelectorError(directiveName, key);
      }
      const optional = rawValue.charAt(0) === '?';
      const selector = optional ? rawValue.slice(1) : rawValue;
      if (!VALID_SLOT_SELECTOR.test(selector)) {
        throw new InvalidTranscludeSelectorError(directiveName, key);
      }
      const normalizedSelector = directiveNormalize(selector);
      if (seenNormalizedSelectors.has(normalizedSelector)) {
        throw new DuplicateTranscludeSelectorError(directiveName, selector);
      }
      seenNormalizedSelectors.set(normalizedSelector, key);
      slots.push({ name: key, selector, normalizedSelector, required: !optional });
    }
    const frozenSlots: TranscludeSlotMap = Object.freeze([...slots]);
    return { kind: 'slots', slots: frozenSlots };
  }
  throw new InvalidTranscludeValueError(directiveName, describeValue(transclude));
}

/**
 * Validates and normalizes the `template`, `templateUrl`, and `replace`
 * DDO fields per spec-019 Slice 4 / technical-considerations §2.6.
 *
 * Returns the post-normalize {@link NormalizedTemplate} discriminated
 * union when the directive declared either `template` or `templateUrl`,
 * or `undefined` when both are omitted. `replace` is validated as a
 * side effect — only `false` / `undefined` are accepted; anything else
 * (including `replace: true`) throws `ReplaceTrueNotSupportedError`.
 *
 * Throws on any invalid input — all throws are routed through
 * `$exceptionHandler('$compile')` by the factory-invocation try/catch
 * in {@link $$buildDirectiveArrayProvider} above.
 */
function normalizeTemplate(
  directiveName: string,
  rawTemplate: unknown,
  rawTemplateUrl: unknown,
  rawReplace: unknown,
): NormalizedTemplate | undefined {
  // Step 1: `replace` validation. Only `undefined` / `false` accepted;
  // every other runtime value (including `true`, `1`, `'yes'`, `{}`) is
  // rejected with the same error class.
  if (rawReplace !== undefined && rawReplace !== false) {
    throw new ReplaceTrueNotSupportedError(directiveName);
  }

  // Step 2: mutual exclusion. Declaring both `template` AND
  // `templateUrl` is rejected at registration; the runtime cannot pick
  // a winner safely.
  if (rawTemplate !== undefined && rawTemplateUrl !== undefined) {
    throw new TemplateAndTemplateUrlCombinedError(directiveName);
  }

  // Step 3: `template` validation.
  if (rawTemplate !== undefined) {
    if (typeof rawTemplate === 'string') {
      if (rawTemplate.length === 0) {
        throw new EmptyTemplateError(directiveName);
      }
      return { kind: 'inline-string', value: rawTemplate };
    }
    if (typeof rawTemplate === 'function') {
      return { kind: 'inline-fn', value: rawTemplate as TemplateFn };
    }
    throw new InvalidTemplateValueError(directiveName, describeValue(rawTemplate));
  }

  // Step 4: `templateUrl` validation.
  if (rawTemplateUrl !== undefined) {
    if (typeof rawTemplateUrl === 'string') {
      if (rawTemplateUrl.length === 0) {
        throw new EmptyTemplateUrlError(directiveName);
      }
      return { kind: 'url-string', value: rawTemplateUrl };
    }
    if (typeof rawTemplateUrl === 'function') {
      return { kind: 'url-fn', value: rawTemplateUrl as TemplateUrlFn };
    }
    throw new InvalidTemplateUrlValueError(directiveName, describeValue(rawTemplateUrl));
  }

  return undefined;
}

/**
 * Validates and normalizes the `controller` / `controllerAs` DDO fields
 * per spec 020 Slice 4 / technical-considerations §2.7.
 *
 * Validation rules:
 *
 * 1. `controllerAs` without `controller` is rejected with
 *    {@link ControllerAsWithoutControllerError}. Alias-without-target is
 *    a programming error — there is nothing to alias.
 * 2. `controllerAs`, when present, must be a non-empty string matching
 *    the shared {@link IDENT_RE} from `@controller/controller.ts`. The
 *    regex is imported (not duplicated) so a future relaxation in one
 *    surface can't drift from the other. Failures throw
 *    {@link MalformedControllerAliasError}.
 * 3. `controller`, when present, must be a string, a function, or a
 *    non-empty array whose trailing element is a function. Failures
 *    throw {@link InvalidControllerFactoryError}. String-shaped values
 *    additionally must be non-empty — whitespace-only names are caught
 *    later by `parseControllerName` at link time, so we only guard the
 *    empty-string case here.
 *
 * Returns the `(controller?, controllerAs?)` pair to attach to the
 * normalized directive when both validations pass. Every throw is
 * caught by the existing factory-invocation `try/catch` in
 * {@link $CompileProvider.$$buildDirectiveArrayProvider} and routed
 * through `$exceptionHandler('$compile')`.
 */
function normalizeController(directiveName: string, rawController: unknown, rawControllerAs: unknown) {
  // 1. `controllerAs` without `controller` — registration-time error.
  if (rawControllerAs !== undefined && rawController === undefined) {
    throw new ControllerAsWithoutControllerError(directiveName);
  }

  // 2. `controllerAs` shape (when present). Reject anything that isn't
  // a non-empty identifier-shaped string. The error message receives a
  // human-readable shape descriptor rather than `String(value)` so an
  // object-typed misuse doesn't surface as `'[object Object]'`.
  let controllerAs: string | undefined;
  if (rawControllerAs !== undefined) {
    if (typeof rawControllerAs !== 'string' || rawControllerAs.length === 0 || !IDENT_RE.test(rawControllerAs)) {
      throw new MalformedControllerAliasError(
        typeof rawControllerAs === 'string' ? rawControllerAs : describeValue(rawControllerAs),
      );
    }
    controllerAs = rawControllerAs;
  }

  // 3. `controller` shape (when present).
  let controller: string | ControllerInvokable | { __attributeSource: string } | undefined;
  if (rawController !== undefined) {
    if (typeof rawController === 'string') {
      if (rawController.length === 0) {
        throw new InvalidControllerFactoryError(directiveName, 'empty string');
      }
      controller = rawController;
    } else if (typeof rawController === 'function') {
      controller = rawController as ControllerInvokable;
    } else if (Array.isArray(rawController)) {
      if (rawController.length === 0) {
        throw new InvalidControllerFactoryError(directiveName, describeValue(rawController));
      }
      const tail: unknown = rawController[rawController.length - 1];
      if (typeof tail !== 'function') {
        throw new InvalidControllerFactoryError(directiveName, describeValue(rawController));
      }
      controller = rawController as ControllerInvokable;
    } else if (
      // Spec 027 Slice 4 — attribute-source sentinel. Reserved for the
      // built-in `ng-controller` directive (and any future structural
      // directive that wants the seam to read its controller name from
      // an attribute at link time). The sentinel is a plain object with
      // a single non-empty `__attributeSource` string field; any other
      // object shape falls through to the `InvalidControllerFactoryError`
      // branch below. The runtime cost of this branch is one `typeof`
      // and one property read; consumer-facing controller declarations
      // (the only kind exposed in the public API) never reach it because
      // a consumer can't easily construct an object whose only key is
      // `__attributeSource`.
      typeof rawController === 'object' &&
      rawController !== null &&
      !Array.isArray(rawController) &&
      typeof (rawController as { __attributeSource?: unknown }).__attributeSource === 'string' &&
      (rawController as { __attributeSource: string }).__attributeSource.length > 0
    ) {
      controller = { __attributeSource: (rawController as { __attributeSource: string }).__attributeSource };
    } else {
      throw new InvalidControllerFactoryError(directiveName, describeValue(rawController));
    }
  }

  const result: {
    controller?: string | ControllerInvokable | { __attributeSource: string };
    controllerAs?: string;
  } = {};
  if (controller !== undefined) {
    result.controller = controller;
  }
  if (controllerAs !== undefined) {
    result.controllerAs = controllerAs;
  }
  return result;
}

function normalizeDirective(name: string, factoryReturn: DirectiveFactoryReturn) {
  if (typeof factoryReturn === 'function') {
    // Sugar form: `() => function postLink(scope, el, attrs) {…}`.
    const linkFn: LinkFn = factoryReturn;
    return {
      name,
      restrict: 'EA',
      priority: 0,
      terminal: false,
      index: $$globalDirectiveIndex++,
      compile: () => linkFn,
      link: linkFn,
      scope: false,
      bindToController: false,
      multiElement: false,
    };
  }

  const ddo: DirectiveDefinition = factoryReturn;

  // Scope normalization (spec 022 Slice 1 — was: reject isolate per
  // FS §2.4). Three accepted shapes:
  //
  //  - `false` / undefined → no new scope; the `scope` flag is `false`.
  //  - `true` → child scope via `parent.$new()`; the `scope` flag is `true`.
  //  - `Record<string, string>` (object form) → ISOLATE scope. The
  //    `scope` flag becomes `true` (so existing "needs a non-default
  //    scope" decision points keep working) AND `isolateBindings` is
  //    populated. The compiler distinguishes child-vs-isolate at link
  //    time by checking `isolateBindings != null`.
  let scope: false | true;
  let isolateBindings: NormalizedBindingMap | undefined;
  if (ddo.scope === undefined || ddo.scope === false) {
    scope = false;
  } else if (ddo.scope === true) {
    scope = true;
  } else {
    // Object-form isolate-scope declaration — parse and normalize.
    // Malformed entries throw `InvalidIsolateBindingError`, which is
    // caught by the factory-invocation try/catch in
    // `$$buildDirectiveArrayProvider` and routed via
    // `$exceptionHandler('$compile')`.
    isolateBindings = parseIsolateBindings(name, ddo.scope);
    scope = true;
  }

  // Validate + normalize the `transclude` field per spec-018 Slice 2.
  // The DDO field is user-supplied and may carry any runtime value, so
  // it is read via an `unknown`-typed view rather than the typed
  // `DirectiveDefinition` interface. The returned shape becomes the
  // `Directive.transclude` field; `undefined` means the directive
  // opted out and the property is omitted from the normalized object.
  const rawTransclude = (ddo as { transclude?: unknown }).transclude;
  const transclude = normalizeTransclude(name, rawTransclude);

  // Validate + normalize `template` / `templateUrl` / `replace` per
  // spec-019 Slice 4. Same `unknown`-view pattern as transclude — the
  // runtime values are user-supplied and may not match the declared
  // `DirectiveDefinition` types. The returned shape becomes the
  // `Directive.template` field; `undefined` means the directive
  // declared neither `template` nor `templateUrl`, and the property is
  // omitted from the normalized object.
  const rawTemplate = (ddo as { template?: unknown }).template;
  const rawTemplateUrl = (ddo as { templateUrl?: unknown }).templateUrl;
  const rawReplace = (ddo as { replace?: unknown }).replace;
  const template = normalizeTemplate(name, rawTemplate, rawTemplateUrl, rawReplace);

  // Validate + normalize `controller` / `controllerAs` per spec-020
  // Slice 4. Same `unknown`-view pattern as transclude / template — the
  // runtime values are user-supplied. The validator throws on
  // `controllerAs` without `controller`, on malformed `controllerAs`
  // strings, and on shape-invalid `controller` values; all three routes
  // bubble up through the factory-invocation try/catch in
  // `$$buildDirectiveArrayProvider` and surface via
  // `$exceptionHandler('$compile')`.
  const rawController = (ddo as { controller?: unknown }).controller;
  const rawControllerAs = (ddo as { controllerAs?: unknown }).controllerAs;
  const { controller, controllerAs } = normalizeController(name, rawController, rawControllerAs);

  // Spec 022 Slice 2 — `bindToController` normalization. Three accepted
  // shapes:
  //
  //  - `true` → boolean flag set; the binding map is reused from
  //    `isolateBindings` at link time.
  //  - A plain object → parsed via `parseIsolateBindings(name, …)` into
  //    a `NormalizedBindingMap` stashed on
  //    `Directive.bindToControllerBindings`; the boolean flag is also
  //    set to `true` so the link-time decision point (`bindToController
  //    === true` AND a controller is present) lights up.
  //  - `undefined` / `false` → flag stays `false`; the directive's
  //    isolate bindings (if any) target the isolate scope as before.
  //
  // Malformed object-form entries throw `InvalidIsolateBindingError` —
  // caught by the factory `try/catch` in `$$buildDirectiveArrayProvider`
  // and routed via `$exceptionHandler('$compile')` (no new error class).
  // The `bindToController === true` form does NOT require a controller
  // to be declared — the per-element linker silently degrades to the
  // isolate-scope target when no controller is present (AngularJS-
  // canonical no-op).
  const rawBindToController = (ddo as { bindToController?: unknown }).bindToController;
  let bindToController: boolean = false;
  let bindToControllerBindings: NormalizedBindingMap | undefined;
  if (rawBindToController === true) {
    bindToController = true;
  } else if (
    rawBindToController !== undefined &&
    rawBindToController !== false &&
    typeof rawBindToController === 'object' &&
    !Array.isArray(rawBindToController)
  ) {
    bindToControllerBindings = parseIsolateBindings(name, rawBindToController as Record<string, string>);
    bindToController = true;
  }
  // Any other runtime shape (string / number / array / etc.) falls
  // through to `bindToController = false` — AngularJS silently ignores
  // garbage here, and rejecting it would require yet another error
  // class. The boolean flag stays the source of truth at link time.

  // Spec 022 Slice 4 — `require` normalization. Three accepted shapes:
  //
  //  - `string`                       — single requirement.
  //  - `string[]`                     — multiple, positional.
  //  - `Record<string, string>` (plain object, not array, not null) —
  //                                     multiple, keyed by alias.
  //
  // Flag parsing (`^` / `^^` / `?`) is DEFERRED to the per-element link
  // site (see `require-resolver.ts:parseRequireFlags`). Registration
  // does a shape-only sanity check; entry-string validation is the
  // link-time resolver's job, surfaced as `MissingRequiredControllerError`
  // (no separate "malformed entry" class — the spec brief reuses the
  // missing-controller error as the canonical surface for both
  // misses and unparseable names).
  //
  // A shape that is none of the above (e.g. `require: 42`, `null`, or
  // a `Map`) is REJECTED at registration via the existing
  // `InvalidDirectiveFactoryError` pattern — the message names the
  // `require` field specifically so authors can locate the bad DDO.
  // The throw bubbles up through the factory-invocation try/catch in
  // `$$buildDirectiveArrayProvider` and routes via
  // `$exceptionHandler('$compile')`. No new error class.
  const rawRequire = (ddo as { require?: unknown }).require;
  let require: string | string[] | Record<string, string> | undefined;
  if (rawRequire !== undefined) {
    if (typeof rawRequire === 'string') {
      require = rawRequire;
    } else if (Array.isArray(rawRequire)) {
      // Each entry must be a string; reject mixed arrays at registration.
      for (const entry of rawRequire) {
        if (typeof entry !== 'string') {
          throw new InvalidDirectiveFactoryError(`${name} (invalid require array entry: ${describeValue(entry)})`);
        }
      }
      require = rawRequire as string[];
    } else if (typeof rawRequire === 'object' && rawRequire !== null) {
      // Each value must be a string.
      const obj = rawRequire as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (typeof value !== 'string') {
          throw new InvalidDirectiveFactoryError(
            `${name} (invalid require object entry "${key}": ${describeValue(value)})`,
          );
        }
        out[key] = value;
      }
      require = out;
    } else {
      throw new InvalidDirectiveFactoryError(`${name} (invalid require value: ${describeValue(rawRequire)})`);
    }
  }

  const priority = ddo.priority ?? 0;
  if (Number.isNaN(priority)) {
    throw new Error(`Invalid priority for directive ${name}: NaN`);
  }

  // Derive `compile` per FS §2.8: `compile` wins over `link`; sugar
  // `link: fn` becomes `compile: () => fn`; `link: { pre, post }`
  // becomes `compile: () => ({ pre, post })`.
  let compile: CompileFn | undefined;
  if (ddo.compile !== undefined) {
    compile = ddo.compile;
  } else if (typeof ddo.link === 'function') {
    const linkFn = ddo.link;
    compile = () => linkFn;
  } else if (ddo.link !== undefined && typeof ddo.link === 'object') {
    const linkPair = ddo.link;
    compile = () => linkPair;
  } else {
    compile = undefined;
  }

  const directive: Directive = {
    name: ddo.name ?? name,
    restrict: ddo.restrict ?? 'EA',
    priority,
    terminal: ddo.terminal ?? false,
    index: $$globalDirectiveIndex++,
    compile,
    link: ddo.link,
    scope,
    bindToController,
    multiElement: (ddo as { multiElement?: unknown }).multiElement === true,
  };
  if (transclude !== undefined) {
    directive.transclude = transclude;
  }
  if (template !== undefined) {
    directive.template = template;
  }
  if (controller !== undefined) {
    directive.controller = controller;
  }
  if (controllerAs !== undefined) {
    directive.controllerAs = controllerAs;
  }
  if (isolateBindings !== undefined) {
    directive.isolateBindings = isolateBindings;
  }
  if (bindToControllerBindings !== undefined) {
    directive.bindToControllerBindings = bindToControllerBindings;
  }
  if (require !== undefined) {
    directive.require = require;
  }
  return directive;
}
