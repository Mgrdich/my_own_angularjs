/**
 * `ngModelOptions` directive + the resolved-options helper (spec 039
 * Slice 6 / FS §2.5, technical-considerations §2.2, §2.4).
 *
 * `ng-model-options="{ … }"` tunes HOW and WHEN an enclosing / descendant
 * `ng-model` commits its view value and reads/writes its bound model. The
 * five parity options threaded through {@link NgModelControllerImpl}:
 *
 *  - **`updateOn`** — a space-separated list of DOM events that COMMIT the
 *    view value (replacing the hard-coded `input change`). The pseudo-event
 *    `default` stands for the input-type handler's OWN default events. Other
 *    events still BUFFER the pending view value (AngularJS `$$updateEvents`)
 *    so a later `default`-triggered commit picks up the latest text.
 *  - **`debounce`** — a number (ms) or per-event map (`{ default: 300,
 *    blur: 0 }`) delaying the commit; a superseding change resets the timer,
 *    and pending timers are cleared on `$destroy`.
 *  - **`allowInvalid`** — flips the controller's `$$allowInvalid` seam so an
 *    invalid parse / failing validators still write the value to the model.
 *  - **`getterSetter`** — treats the `ng-model` expression as a FUNCTION used
 *    both to read (`fn()`) and write (`fn(value)`) the model.
 *  - **`timezone`** — a resolved offset threaded into the date/time input
 *    parse + format so date controls interpret / display in that zone.
 *
 * **Inheritance (AngularJS parity).** A nested `ngModelOptions` inherits its
 * ancestor's options unless the special key `'*'` appears in `updateOn`,
 * which resets inheritance (the child starts from bare defaults). The
 * resolved {@link ModelOptions} object exposes `getOption(name)` — the single
 * read surface `ngModel` / the input handlers consult.
 *
 * **Wiring.** The directive publishes a resolved {@link ModelOptions} as a
 * controller under the `ngModelOptions` key (via {@link stashController}) in
 * its PRE-link, so a descendant `ngModel`'s `require: '?^^ngModelOptions'`
 * ancestor walk resolves it before the control links. A control WITHOUT an
 * enclosing `ngModelOptions` uses {@link defaultModelOptions}.
 *
 * Registered on `ngModule` only (DI-only, the built-in-directive precedent)
 * — reachable via `injector.get('ngModelOptionsDirective')`, NOT exported
 * from the root barrel.
 */

import type { Scope } from '@core/index';

import { stashController } from '@compiler/element-slots';
import type { Attributes, DirectiveFactory, DirectiveFactoryReturn, LinkFn } from '@compiler/directive-types';
import type { ControllerInvokable } from '@controller/controller-types';
import { parse } from '@parser/index';

export const NG_MODEL_OPTIONS_NAME = 'ngModelOptions';
/** The `$$ngControllers` key `ngModelOptions` publishes its resolved options under. */
export const NG_MODEL_OPTIONS_KEY = 'ngModelOptions';

/**
 * The recognized `ngModelOptions` keys (AngularJS parity — the full spec-039
 * set). `updateOn` / `debounce` are consumed by the input-type event wiring;
 * `allowInvalid` / `getterSetter` / `timezone` by the controller / date
 * handlers.
 */
export interface NgModelOptions {
  /**
   * Space-separated DOM events that commit the view value. `default` is a
   * pseudo-event meaning the input handler's own default events; `'*'` (as a
   * lone token) resets inheritance from an ancestor `ngModelOptions`.
   */
  updateOn?: string;
  /** A number (ms) or a per-event map (`{ default: 300, blur: 0 }`) delaying the commit. */
  debounce?: number | Record<string, number>;
  /** When `true`, invalid values are still written to the model. */
  allowInvalid?: boolean;
  /** When `true`, the `ng-model` expression is a read/write function. */
  getterSetter?: boolean;
  /** A timezone string (`'UTC'`, `'+0500'`, …) for date/time controls. */
  timezone?: string;
}

/**
 * The resolved options object a control reads through. `getOption(name)`
 * returns the effective value for a key (after inheritance). `$$updateEvents`
 * is the parsed `updateOn` event list with the `default` pseudo-event
 * expanded away (`default` is dropped — the input handler supplies its own
 * default events); an empty list means "commit on the handler's default
 * events only".
 */
export interface ModelOptions {
  /** Read the effective value of an option key (post-inheritance). */
  getOption<K extends keyof NgModelOptions>(name: K): NgModelOptions[K];
  /**
   * The concrete, non-`default` events from `updateOn`. When `default` was
   * present (or `updateOn` was absent) the input handler's OWN default events
   * ALSO commit; when `default` was absent only these events commit.
   */
  readonly $$updateEvents: readonly string[];
  /** Whether `updateOn` contained the `default` pseudo-event (or was absent). */
  readonly $$hasDefaultUpdateEvent: boolean;
}

/**
 * A mutable {@link ModelOptions} whose resolution can be re-applied in place.
 * The `ngModelOptions` directive returns ONE of these from its controller
 * factory and mutates it in pre-link once the inherited parent is known — so
 * a descendant `ngModel` that captured the controller reference at require
 * resolution always reads the fully-inherited options (the reference is
 * stable; only the internal resolution changes).
 *
 * @internal
 */
export interface MutableModelOptions extends ModelOptions {
  /** Re-apply resolution from a raw options record + optional parent (mutates in place). */
  $$reresolve(raw: NgModelOptions, parent?: ModelOptions): void;
}

/**
 * Split a raw `updateOn` string into a distinct event list, dropping the
 * `default` and `'*'` sentinels (they are handled separately by the resolver
 * / the inheritance reset).
 */
function parseUpdateEvents(raw: string | undefined): { events: string[]; hasDefault: boolean } {
  if (raw === undefined || raw.trim() === '') {
    return { events: [], hasDefault: true };
  }
  const tokens = raw.split(/\s+/).filter((t) => t !== '');
  const events: string[] = [];
  let hasDefault = false;
  for (const token of tokens) {
    if (token === 'default') {
      hasDefault = true;
    } else if (token === '*') {
      // '*' is the inheritance-reset marker, not a real event — ignore here.
    } else if (!events.includes(token)) {
      events.push(token);
    }
  }
  // A lone `'*'` (no real events, no `default`) resets inheritance and
  // falls back to the handler's default events — otherwise NOTHING would
  // ever commit the view value and the control would be read-only.
  if (!hasDefault && events.length === 0) {
    hasDefault = true;
  }
  return { events, hasDefault };
}

/**
 * Build a {@link ModelOptions} from a raw {@link NgModelOptions} record and an
 * optional parent to inherit from. A raw `updateOn` containing the lone `'*'`
 * token resets inheritance (the child ignores the parent's options entirely).
 */
export function createModelOptions(raw: NgModelOptions, parent?: ModelOptions): ModelOptions {
  const rawUpdateOn = raw.updateOn;
  const resetsInheritance = typeof rawUpdateOn === 'string' && /(^|\s)\*(\s|$)/.test(rawUpdateOn);
  const effectiveParent = resetsInheritance ? undefined : parent;

  // Merge: own keys win; absent own keys fall back to the parent's effective
  // value (AngularJS `defaults(options, parentOptions.$$options)`).
  const merged: NgModelOptions = { ...raw };
  if (effectiveParent !== undefined) {
    if (merged.updateOn === undefined) {
      merged.updateOn = effectiveParent.getOption('updateOn');
    }
    if (merged.debounce === undefined) {
      merged.debounce = effectiveParent.getOption('debounce');
    }
    if (merged.allowInvalid === undefined) {
      merged.allowInvalid = effectiveParent.getOption('allowInvalid');
    }
    if (merged.getterSetter === undefined) {
      merged.getterSetter = effectiveParent.getOption('getterSetter');
    }
    if (merged.timezone === undefined) {
      merged.timezone = effectiveParent.getOption('timezone');
    }
  }

  const { events, hasDefault } = parseUpdateEvents(merged.updateOn);

  return {
    getOption<K extends keyof NgModelOptions>(name: K): NgModelOptions[K] {
      return merged[name];
    },
    $$updateEvents: events,
    $$hasDefaultUpdateEvent: hasDefault,
  };
}

/**
 * Build a {@link MutableModelOptions} that can be re-resolved in place (see
 * the interface doc for why the stable reference matters). Starts from a
 * bare (uninherited) resolution; `$$reresolve` re-computes the merge.
 */
export function createMutableModelOptions(raw: NgModelOptions): MutableModelOptions {
  let resolved = createModelOptions(raw);
  const holder: MutableModelOptions = {
    getOption<K extends keyof NgModelOptions>(name: K): NgModelOptions[K] {
      return resolved.getOption(name);
    },
    get $$updateEvents(): readonly string[] {
      return resolved.$$updateEvents;
    },
    get $$hasDefaultUpdateEvent(): boolean {
      return resolved.$$hasDefaultUpdateEvent;
    },
    $$reresolve(nextRaw: NgModelOptions, parent?: ModelOptions): void {
      resolved = createModelOptions(nextRaw, parent);
    },
  };
  return holder;
}

/**
 * The default options a control uses when there is no enclosing
 * `ngModelOptions` — every option unset, so `updateOn` falls back to the
 * input handler's default events, no debounce, invalid values withheld,
 * plain assignable model, local timezone.
 */
export const defaultModelOptions: ModelOptions = createModelOptions({});

/**
 * Resolve the debounce delay (ms) for a committing `trigger` event from a
 * {@link ModelOptions}. A numeric `debounce` applies to every trigger; a map
 * looks up the trigger, falling back to the `default` key, else `0`. An
 * absent / non-finite value is `0` (commit immediately).
 */
export function resolveDebounceDelay(options: ModelOptions, trigger: string): number {
  const debounce = options.getOption('debounce');
  if (typeof debounce === 'number') {
    return Number.isFinite(debounce) ? debounce : 0;
  }
  if (debounce !== undefined && typeof debounce === 'object') {
    const forTrigger = debounce[trigger];
    if (typeof forTrigger === 'number' && Number.isFinite(forTrigger)) {
      return forTrigger;
    }
    const forDefault = debounce['default'];
    if (typeof forDefault === 'number' && Number.isFinite(forDefault)) {
      return forDefault;
    }
  }
  return 0;
}

/**
 * Narrow the resolved parent-options require slot to a {@link ModelOptions}.
 * `require: '?^^ngModelOptions'` yields `null` on a miss (top-level options);
 * anything that is not a live options object falls back to `undefined` (no
 * parent).
 */
function asParentOptions(candidate: unknown): ModelOptions | undefined {
  if (candidate !== null && typeof candidate === 'object' && '$$updateEvents' in candidate) {
    return candidate as ModelOptions;
  }
  return undefined;
}

/**
 * Read the resolved options from the `ngModelOptions` require tuple's 2nd
 * slot (`require: ['ngModelOptions', '?^^ngModelOptions']`).
 */
function readParentOptions(controllers: unknown): ModelOptions | undefined {
  if (Array.isArray(controllers)) {
    return asParentOptions(controllers[1]);
  }
  return undefined;
}

/** Evaluate the raw `ng-model-options` attribute expression to a record. */
function evalOptionsAttr(scope: Scope, attrs: Attributes): NgModelOptions {
  const raw = attrs[NG_MODEL_OPTIONS_NAME];
  if (typeof raw === 'string' && raw.trim() !== '') {
    const value = parse(raw)(scope as unknown as Record<string, unknown>);
    if (value !== null && typeof value === 'object') {
      return value as NgModelOptions;
    }
  }
  return {};
}

function ngModelOptionsFactory(): DirectiveFactoryReturn {
  // The controller IS a MUTABLE resolved ModelOptions (see
  // `createMutableModelOptions`). It starts as a bare (uninherited) resolution
  // and is RE-RESOLVED in place in pre-link once the parent require resolves —
  // so a descendant `ngModel` that captured this controller reference at
  // require-resolution time always reads the fully-inherited options.
  const controller: ControllerInvokable = [
    '$scope',
    '$attrs',
    (...args: unknown[]): MutableModelOptions =>
      createMutableModelOptions(evalOptionsAttr(args[0] as Scope, args[1] as Attributes)),
  ];

  const preLink: LinkFn = (scope, element, attrs, controllers) => {
    const ownCandidate: unknown = Array.isArray(controllers) ? controllers[0] : controllers;
    if (ownCandidate === null || typeof ownCandidate !== 'object' || !('$$reresolve' in ownCandidate)) {
      return;
    }
    const own = ownCandidate as MutableModelOptions;
    // Re-resolve WITH the inherited parent options (mutating the stable
    // controller reference in place). Publish the resolved options under the
    // shared `ngModelOptions` key via `stashController` so a descendant
    // `ngModel` — which walks the `$$ngControllers` stash directly at link
    // time (see `readEnclosingOptions` in `ng-model.ts`) — reads the
    // fully-inherited options for both same-element and ancestor cases.
    const parent = readParentOptions(controllers);
    own.$$reresolve(evalOptionsAttr(scope, attrs), parent);
    stashController(element, NG_MODEL_OPTIONS_KEY, own);
  };

  return {
    restrict: 'A',
    // `['ngModelOptions', '?^^ngModelOptions']` — own controller + optional
    // ANCESTOR options to inherit from (`^^` skips own element so a directive
    // does not inherit from itself).
    require: [NG_MODEL_OPTIONS_NAME, '?^^ngModelOptions'],
    controller,
    link: { pre: preLink },
  };
}

/**
 * DI-annotated `ngModelOptions` factory. No injected deps — the options are
 * evaluated from the element's own attribute against the linked scope.
 */
export const ngModelOptionsDirective: DirectiveFactory = [ngModelOptionsFactory];
