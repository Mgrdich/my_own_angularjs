/**
 * Shared CSS state-class toggling for form controls and forms (spec 039
 * Slice 1 / FS §2.2, technical-considerations §2.7).
 *
 * AngularJS reflects every control / form state onto the element via a
 * fixed set of CSS classes so an app can style validation feedback with
 * plain CSS (`.ng-invalid.ng-touched { border-color: red; }`). This
 * module owns the toggling for the Slice-1 state surface:
 *
 *  - `ng-valid` / `ng-invalid`
 *  - `ng-dirty` / `ng-pristine`
 *  - `ng-touched` / `ng-untouched`
 *  - `ng-empty` / `ng-not-empty`
 *  - per-rule `ng-valid-<key>` / `ng-invalid-<key>` (key dasherized)
 *
 * **Append-only / consumer-class-safe.** Like `ng-class` (spec 024), the
 * framework only ever toggles classes IT manages — author classes
 * (`<input class="form-control">`) are never stripped. The two helpers
 * here (`toggleClass`, `toggleValidationClass`) add exactly one class and
 * remove its mutually-exclusive partner; they never touch any other
 * class. There is no `$animate` integration — toggles are synchronous via
 * `classList`, consistent with `ng-show` / `ng-hide` and deferred to
 * Phase 4.
 *
 * **Per-rule class dasherizing.** AngularJS lowercases + dasherizes a
 * validation key when building the per-rule class so a camelCase rule
 * name (`maxlength`, `myCustomRule`) produces a kebab class
 * (`ng-invalid-maxlength`, `ng-invalid-my-custom-rule`). The
 * {@link snakeCase} helper matches upstream's `snake_case(name, '-')` —
 * an uppercase letter is lowercased and prefixed with the separator.
 */

const VALID_CLASS = 'ng-valid';
const INVALID_CLASS = 'ng-invalid';
const PRISTINE_CLASS = 'ng-pristine';
const DIRTY_CLASS = 'ng-dirty';
const UNTOUCHED_CLASS = 'ng-untouched';
const TOUCHED_CLASS = 'ng-touched';
const EMPTY_CLASS = 'ng-empty';
const NOT_EMPTY_CLASS = 'ng-not-empty';

/**
 * Add `addClass` and remove `removeClass` on the element. Both arguments
 * are framework-managed class names — no author class is ever passed
 * here, so the append-only guarantee holds by construction. A `null`
 * `addClass` (or `removeClass`) skips that side of the toggle.
 */
function applyClasses(element: Element, addClass: string | null, removeClass: string | null): void {
  if (removeClass !== null) {
    element.classList.remove(removeClass);
  }
  if (addClass !== null) {
    element.classList.add(addClass);
  }
}

/**
 * Reflect the boolean validity onto an element: `ng-valid` when `isValid`,
 * `ng-invalid` otherwise (mutually exclusive).
 */
export function setValidClass(element: Element, isValid: boolean): void {
  applyClasses(element, isValid ? VALID_CLASS : INVALID_CLASS, isValid ? INVALID_CLASS : VALID_CLASS);
}

/**
 * Reflect the pristine/dirty state: `ng-pristine` when `isPristine`,
 * `ng-dirty` otherwise.
 */
export function setPristineClass(element: Element, isPristine: boolean): void {
  applyClasses(element, isPristine ? PRISTINE_CLASS : DIRTY_CLASS, isPristine ? DIRTY_CLASS : PRISTINE_CLASS);
}

/**
 * Reflect the touched/untouched state: `ng-untouched` when `isUntouched`,
 * `ng-touched` otherwise.
 */
export function setTouchedClass(element: Element, isUntouched: boolean): void {
  applyClasses(element, isUntouched ? UNTOUCHED_CLASS : TOUCHED_CLASS, isUntouched ? TOUCHED_CLASS : UNTOUCHED_CLASS);
}

/**
 * Reflect the empty/not-empty state: `ng-empty` when `isEmpty`,
 * `ng-not-empty` otherwise.
 */
export function setEmptyClass(element: Element, isEmpty: boolean): void {
  applyClasses(element, isEmpty ? EMPTY_CLASS : NOT_EMPTY_CLASS, isEmpty ? NOT_EMPTY_CLASS : EMPTY_CLASS);
}

/**
 * Dasherize a validation key for the per-rule class — the AngularJS
 * `snake_case(name, '-')` behavior. Every uppercase letter is lowercased
 * and prefixed with `-` (so `maxLength` → `max-length`). Already-kebab
 * keys (`maxlength`) pass through unchanged.
 *
 * @example
 * ```ts
 * snakeCase('required');     // 'required'
 * snakeCase('maxlength');    // 'maxlength'
 * snakeCase('myCustomRule'); // 'my-custom-rule'
 * ```
 */
export function snakeCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * Toggle the per-rule validity class for a single rule `key`. Adds
 * `ng-valid-<key>` and removes `ng-invalid-<key>` when `isValid`, the
 * mirror otherwise. The key is dasherized via {@link snakeCase} so the
 * resulting class is always kebab-case.
 */
export function setValidationClass(element: Element, key: string, isValid: boolean): void {
  const dashed = snakeCase(key);
  const validKey = `${VALID_CLASS}-${dashed}`;
  const invalidKey = `${INVALID_CLASS}-${dashed}`;
  applyClasses(element, isValid ? validKey : invalidKey, isValid ? invalidKey : validKey);
}
