/**
 * `$SceDelegateProvider` — DI-facing configurator for the `$sceDelegate`
 * service.
 *
 * Exposes fluent `trustedResourceUrlList` / `bannedResourceUrlList` getter /
 * setter methods intended for use from `config(['$sceDelegateProvider', p =>
 * ...])` blocks, and a `$get` invokable that the run-phase injector drains to
 * produce the actual delegate via `createSceDelegate`.
 *
 * Mirrors AngularJS 1.x `$sceDelegateProvider`. The `$` prefix on the class
 * name is the AngularJS convention for built-in service providers; the `$$`
 * prefix on the instance fields signals "private / not part of the public
 * API" and mirrors existing conventions (`Scope.$$watchers`,
 * `Module.$$invokeQueue`, `$InterpolateProvider.$$startSymbol`).
 *
 * Setter validation fires immediately — misconfiguration (e.g. an invalid
 * pattern entry) surfaces during the `config()` phase, not at first render.
 * The actual matcher compilation used at runtime is deferred to `$get`-time
 * so late setter changes still take effect if somehow invoked.
 */

import { compileMatchers } from '@sce/resource-url-matcher';
import { createSceDelegate } from '@sce/sce-delegate';
import type { ResourceUrlListEntry, SceDelegateService } from '@sce/sce-types';

export class $SceDelegateProvider {
  // `$$` prefix mirrors the AngularJS "internal / not part of the public
  // API" convention. Kept private so callers are routed through the
  // validated setters and defensive-copy getters.
  private $$allowList: readonly ResourceUrlListEntry[] = ['self'];
  private $$blockList: readonly ResourceUrlListEntry[] = [];

  /**
   * Get or set the trusted resource-URL allow-list. With no argument,
   * returns a defensive copy of the current list so callers cannot mutate
   * the provider's internal state through the returned array. With an
   * array argument, validates the entries by running them through
   * `compileMatchers` (which throws synchronously on any invalid entry
   * type), stores a defensive copy, and returns `this` so the call is
   * chainable.
   *
   * The default list is `['self']` — AngularJS 1.x parity: same-origin
   * resource URLs pass the allow-list out of the box.
   *
   * @example
   * ```ts
   * // Typical cross-origin API host allow-list — permit our API and CDN,
   * // keep the same-origin default for everything else.
   * createModule('app', ['ng']).config([
   *   '$sceDelegateProvider',
   *   (p: $SceDelegateProvider) => {
   *     p.trustedResourceUrlList([
   *       'self',
   *       'https://api.myapp.com/**',
   *       'https://cdn.myapp.com/**',
   *     ]);
   *   },
   * ]);
   * ```
   */
  trustedResourceUrlList(): readonly ResourceUrlListEntry[];
  trustedResourceUrlList(list: readonly ResourceUrlListEntry[]): this;
  trustedResourceUrlList(list?: readonly ResourceUrlListEntry[]): readonly ResourceUrlListEntry[] | this {
    if (list === undefined) {
      return [...this.$$allowList];
    }
    // Validate by side-effect — `compileMatchers` throws synchronously on
    // any invalid entry type. The compiled output is discarded here; the
    // real compilation runs at `$get` time so late setter changes (should
    // any slip through the provider lifecycle) still take effect.
    compileMatchers(list);
    this.$$allowList = [...list];
    return this;
  }

  /**
   * Get or set the banned resource-URL block-list. Symmetric to
   * {@link trustedResourceUrlList}: no-arg call returns a defensive copy;
   * array arg validates entries via `compileMatchers`, stores a defensive
   * copy, and returns `this` for chaining.
   *
   * The default list is `[]` — nothing is blocked out of the box. Block
   * matches take precedence over allow matches at runtime (see
   * `createSceDelegate`), so adding a block-list entry does not interact
   * with the allow-list for non-matching URLs.
   */
  bannedResourceUrlList(): readonly ResourceUrlListEntry[];
  bannedResourceUrlList(list: readonly ResourceUrlListEntry[]): this;
  bannedResourceUrlList(list?: readonly ResourceUrlListEntry[]): readonly ResourceUrlListEntry[] | this {
    if (list === undefined) {
      return [...this.$$blockList];
    }
    compileMatchers(list);
    this.$$blockList = [...list];
    return this;
  }

  /**
   * Injector-facing factory. Array-style invokable with no dependencies —
   * the closure captures `this` so the lists in force at `$get` time (i.e.
   * after all `config()` blocks have run) are the ones baked into the
   * produced delegate.
   */
  $get = [
    (): SceDelegateService =>
      createSceDelegate({
        trustedResourceUrlList: this.$$allowList,
        bannedResourceUrlList: this.$$blockList,
      }),
  ] as const;
}
