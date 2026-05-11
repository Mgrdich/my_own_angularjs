/**
 * Public TypeScript types for the transclusion surface (spec 018).
 *
 * Slice 1 ships the foundational types used by all later slices —
 * registration-phase validation (Slice 2), the capture pipeline and
 * `$transclude` runtime (Slices 3–4), and the `ng-transclude` marker
 * directive (Slice 5). No behavior is shipped here; this file is the
 * shared vocabulary every subsequent slice consumes.
 *
 * Two of the seven exports below are deliberately INTERNAL —
 * {@link BoundTranscludeFn} and {@link NormalizedTransclude} are
 * implementation details stashed on `$$ngBoundTransclude` and on the
 * normalized {@link import('./directive-types').Directive} respectively,
 * and the public barrel (`src/compiler/index.ts`) does NOT re-export
 * them. The remaining five — {@link CloneAttachFn}, {@link TranscludeFn},
 * {@link TranscludeSlotName}, {@link TranscludeSlot},
 * {@link TranscludeSlotMap} — are the surface directive authors consume.
 *
 * The file is intentionally type-only — no runtime imports — so it can
 * be re-exported as `export type` from the public barrel.
 */

import type { Scope } from '@core/index';

/**
 * The callback passed as the first argument to a {@link TranscludeFn}
 * invocation. Receives the cloned top-level nodes AND the freshly
 * created transclusion scope. The directive author typically inserts
 * `clone` into the DOM inside this function:
 *
 * @example
 * ```ts
 * const link: LinkFn = (_scope, element, _attrs, _controllers, $transclude) => {
 *   $transclude?.((clone, _transcludedScope) => {
 *     for (const node of clone) {
 *       element.appendChild(node);
 *     }
 *   });
 * };
 * ```
 *
 * Errors thrown from `cloneAttachFn` are routed through
 * `$exceptionHandler` with cause `'$compile'` (spec 014); the
 * transclusion scope is STILL registered for cleanup and the clone is
 * STILL returned from `$transclude`, so the directive may recover.
 */
export type CloneAttachFn = (clone: Node[], scope: Scope) => void;

/**
 * The `$transclude` function exposed as the 5th argument to compile /
 * pre-link / post-link of any directive declaring
 * `transclude: true | { … }`.
 *
 * Each invocation clones the captured master content for the requested
 * slot (or the default slot if `slotName` is omitted), creates a fresh
 * transclusion scope as a child of the OUTER scope (the scope under
 * which the directive itself was linked), links the clone, and returns
 * the linked top-level nodes.
 *
 * Multi-clone is supported — calling `$transclude(...)` more than once
 * produces independent clones with independent transclusion scopes.
 * Each clone's scope is registered against the host element's cleanup
 * queue so `destroyElementScope(host)` tears them all down.
 *
 * @example
 * ```ts
 * // Consumer markup:
 * //   <my-card><p>{{outer.title}}</p></my-card>
 * //
 * // Directive declaration:
 * //   $compileProvider.directive('myCard', () => ({
 * //     transclude: true,
 * //     link: (_scope, element, _attrs, _controllers, $transclude) => {
 * //       $transclude((clone) => {
 * //         for (const node of clone) {
 * //           element.appendChild(node);
 * //         }
 * //       });
 * //     },
 * //   }));
 * //
 * // After compile+link, the <p> is reinserted under <my-card> and
 * // its `{{outer.title}}` interpolation resolves against the OUTER
 * // scope — exactly the AngularJS-canonical rule.
 * ```
 *
 * @param cloneAttachFn - Optional sync callback invoked with `(clone, transcludedScope)` before the clone is returned.
 * @param futureParent - Optional DOM parent for AngularJS parity (accepted but currently unused by spec 018).
 * @param slotName - Optional slot name to project; omitted / `null` means the default slot.
 * @returns The array of cloned top-level nodes, linked against the freshly created transclusion scope.
 */
export type TranscludeFn = (
  cloneAttachFn?: CloneAttachFn,
  futureParent?: Element | null,
  slotName?: string | null,
) => Node[];

/**
 * Named type alias for slot identifiers — clarifies intent at call sites
 * (`$transclude(fn, null, slotName)`) without introducing a separate
 * nominal type. A `TranscludeSlotName` is always a valid camelCase JS
 * identifier (enforced at registration in Slice 2 via
 * `InvalidTranscludeSlotNameError`).
 */
export type TranscludeSlotName = string;

/**
 * The normalized internal form of one transclusion slot declaration,
 * produced by `normalizeDirective` (Slice 2) from each entry in the
 * `transclude: { … }` object form.
 *
 * - `name` — the camelCase slot key (e.g. `'titleSlot'`).
 * - `selector` — the kebab-case tag selector as authored, with the
 *   optional leading `?` already stripped (e.g. `'card-title'`).
 * - `normalizedSelector` — the same selector after
 *   {@link import('./directive-normalize').directiveNormalize} so the
 *   runtime tag-name match is a plain string-equality check.
 * - `required` — `true` iff the original selector did NOT start with
 *   `?`. Required slots that have no matching child raise
 *   `RequiredTranscludeSlotUnfilledError` at link time.
 *
 * INTERNAL — exposed via {@link TranscludeSlotMap} for tooling but not
 * intended as a public construction surface for directive authors.
 */
export interface TranscludeSlot {
  name: string;
  selector: string;
  normalizedSelector: string;
  required: boolean;
}

/**
 * The full normalized slot list produced from the `transclude: { … }`
 * object form. Order matches insertion order of the source object's
 * entries (i.e. JS object-literal property order). The array is frozen
 * at registration time so downstream consumers may rely on
 * immutability.
 */
export type TranscludeSlotMap = readonly TranscludeSlot[];

/**
 * The shape stashed on the host element's `$$ngBoundTransclude`
 * non-enumerable property by the compiler (Slice 3). Resolved by
 * `ng-transclude`'s post-link function (Slice 5) via a
 * `parentElement` walk.
 *
 * INTERNAL — not re-exported from the public barrel.
 *
 * - `fn` — the bound `$transclude` callable.
 * - `declaredSlots` — the slot map declared on the host directive
 *   (`[]` for `kind: 'content'`).
 * - `kind` — discriminator: `'content'` for `transclude: true`,
 *   `'slots'` for the multi-slot object form.
 */
export interface BoundTranscludeFn {
  fn: TranscludeFn;
  declaredSlots: TranscludeSlotMap;
  kind: 'content' | 'slots';
}

/**
 * The post-normalize internal shape stored on each
 * {@link import('./directive-types').Directive} when the directive
 * declares `transclude: true | { … }`. Populated by `normalizeDirective`
 * in Slice 2.
 *
 * INTERNAL — not re-exported from the public barrel. Directive authors
 * write `transclude: true` or `transclude: { titleSlot: 'card-title' }`
 * on the Directive Definition Object; the validator transforms those
 * into this discriminated-union form.
 */
export type NormalizedTransclude = { kind: 'content' } | { kind: 'slots'; slots: TranscludeSlotMap };
