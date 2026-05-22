# Technical Specification: Event Directives

- **Functional Specification:** [`./functional-spec.md`](./functional-spec.md)
- **Status:** Draft
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Eighteen directives, one mechanical pattern, **one new source file** + **one new test file**. No new framework primitives — every consumer dependency already exists (`parse()` from `@parser`, `scope.$apply`, `scope.$evalAsync`, `scope.$on('$destroy', …)`, native `element.addEventListener`/`removeEventListener`).

The work splits into three pieces:

1. **One new file `src/compiler/ng-event-directives.ts`** — module-private `createEventDirective(eventName)` factory helper + 18 generated factory exports. The `eventName` parameter is typed as a string-literal union derived from a single `EVENT_NAMES` `as const` tuple — typos become compile errors, and the union is enforced to be a subset of `keyof HTMLElementEventMap`.
2. **One block update in `src/core/ng-module.ts`** — 18 new `$compileProvider.directive(...)` lines, generated explicitly (no runtime loop).
3. **One new test file** — `src/compiler/__tests__/ng-event-directives.test.ts` parametrized via `describe.each` over the 18 `[ngName, eventName]` pairs.

The single mechanical pattern: parse the expression at link time; register a native event listener that evaluates the parsed expression inside `scope.$apply()` (or `scope.$evalAsync()` when a digest is already in flight); pass the native event as the `$event` local; clean up via `scope.$on('$destroy', …)`.

No new error classes. No new `EXCEPTION_HANDLER_CAUSES` token — the existing `'eventListener'` cause covers any listener throw. The tuple stays at 10.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 `src/compiler/ng-event-directives.ts` — one factory helper + 18 directives

**Type-safe event-name source:**

```ts
const EVENT_NAMES = [
  'click', 'dblclick', 'mousedown', 'mouseup', 'mouseover', 'mouseout',
  'mousemove', 'mouseenter', 'mouseleave',
  'keydown', 'keyup', 'keypress',
  'copy', 'cut', 'paste',
  'focus', 'blur',
  'submit',
] as const satisfies readonly (keyof HTMLElementEventMap)[];

type EventName = (typeof EVENT_NAMES)[number];
```

- The `as const` makes the array a tuple of string literals; `EventName` is the 18-member union (`'click' | 'dblclick' | … | 'submit'`).
- The `satisfies readonly (keyof HTMLElementEventMap)[]` constraint ensures every entry is a real DOM event name — a typo (`'clikc'`) becomes a compile error before the test suite runs.
- The `EVENT_NAMES` tuple is module-private and is NOT used at runtime — registration in `ng-module.ts` lists the directive names explicitly to keep the IDE's go-to-definition useful.

**Factory helper:**

```ts
function createEventDirective(eventName: EventName): DirectiveFactoryReturn
```

Returns the directive factory `[() => ({ restrict: 'A', compile })]`. Verify whether `$parse` exists as a DI service first; per the spec 023 Slice 5 finding, it does NOT — so the factory imports `parse` from `@parser/index` directly at module scope. The factory is zero-dep:

```ts
function createEventDirective(eventName: EventName): DirectiveFactoryReturn {
  return [() => ({
    restrict: 'A',
    compile: ($element, attrs) => {
      const ngAttrName = `ng${capitalize(eventName)}`;  // e.g. 'ngClick'
      const exprString = attrs[ngAttrName];
      if (typeof exprString !== 'string') return;
      const parsed = parse(exprString);
      return (scope, element) => {
        const handler = (event: Event) => {
          const run = () => parsed(scope, { $event: event });
          if (scope.$$phase) {
            scope.$evalAsync(run);
          } else {
            scope.$apply(run);
          }
        };
        element.addEventListener(eventName, handler);
        scope.$on('$destroy', () => element.removeEventListener(eventName, handler));
      };
    },
  })];
}
```

Key points:

- **`eventName: EventName`** — compile-time-enforced subset of DOM event names. The 18 generated factories at the bottom of the file (`ngClickDirective = createEventDirective('click')` etc.) all pass type-checked literals.
- **Parse-once at compile time.** Each (element × directive) pair parses its expression exactly once. The parsed function is closed over by the link fn — even with multiple `$compile(template)(scope)` invocations the parse cost is paid once.
- **`$$phase` check** before `$apply`. If a digest is already running (e.g. a nested event fired during another `$apply`), use `$evalAsync` to enqueue rather than throwing "$digest already in progress." AngularJS-canonical pattern.
- **`$event` local.** Passed as the second argument to the parsed expression. The parser's runtime already resolves identifiers from locals first, falling back to scope (per spec 009).
- **Cleanup via `$on('$destroy', …)`.** The scope's destruction event removes the native listener.
- **Defensive guard.** `typeof attrs[ngAttrName] !== 'string'` early-return matches the spec 023/024/025 pattern.

The `capitalize(eventName)` helper is trivial (`name[0].toUpperCase() + name.slice(1)`); inline or extract.

**Eighteen generated factories:**

```ts
export const ngClickDirective = createEventDirective('click');
export const ngDblclickDirective = createEventDirective('dblclick');
export const ngMousedownDirective = createEventDirective('mousedown');
export const ngMouseupDirective = createEventDirective('mouseup');
export const ngMouseoverDirective = createEventDirective('mouseover');
export const ngMouseoutDirective = createEventDirective('mouseout');
export const ngMousemoveDirective = createEventDirective('mousemove');
export const ngMouseenterDirective = createEventDirective('mouseenter');
export const ngMouseleaveDirective = createEventDirective('mouseleave');
export const ngKeydownDirective = createEventDirective('keydown');
export const ngKeyupDirective = createEventDirective('keyup');
export const ngKeypressDirective = createEventDirective('keypress');
export const ngCopyDirective = createEventDirective('copy');
export const ngCutDirective = createEventDirective('cut');
export const ngPasteDirective = createEventDirective('paste');
export const ngFocusDirective = createEventDirective('focus');
export const ngBlurDirective = createEventDirective('blur');
export const ngSubmitDirective = createEventDirective('submit');
```

Full TSDoc:

- File-level docblock explaining the pattern, the `$event` local, the cleanup contract, and the `EventName` type-safety mechanism.
- TSDoc on `EVENT_NAMES` + `EventName` explaining the role of the `as const`/`satisfies` pair.
- TSDoc on `createEventDirective` explaining the role + the `$$phase`/`$apply`/`$evalAsync` dispatch.
- TSDoc on each of the 18 generated factories with an `@example` showing the consumer template (e.g. `<button ng-click="save($event)">`).

File size target under 350 LOC including the 18 TSDoc blocks. Per-factory TSDoc accounts for most of the LOC; the executable surface is ~30 LOC.

### 2.2 `src/core/ng-module.ts` — 18 new registration lines

Extend the existing `$compileProvider` config block. One new import statement (pulling all 18 factories from `@compiler/ng-event-directives`) and 18 new lines:

```ts
$compileProvider.directive('ngClick', ngClickDirective);
$compileProvider.directive('ngDblclick', ngDblclickDirective);
// … 16 more
```

Alphabetized within the existing block (e.g. `ngBlur` slots near the top of the block, `ngSubmit` near the bottom). Matches the spec 023/024/025 ordering convention.

### 2.3 Module-boundary considerations

`ng-event-directives.ts` lives in `@compiler`. The factory helper, the `EVENT_NAMES` tuple, and the `EventName` type are all module-private — not exported from `@compiler/index` or the root barrel. The 18 directive factories are exported from `ng-event-directives.ts` but NOT re-exported from `@compiler/index` (same DI-registration-only precedent as specs 018, 023, 024, 025).

The file imports `parse` from `@parser/index` directly — this is consistent with the existing `@compiler` → `@parser` dependency edge.

### 2.4 Error handling

- The `parse(exprString)` call at compile time can throw on syntax errors. The existing factory `try/catch` in `$$buildDirectiveArrayProvider` routes via `$exceptionHandler('$compile')`. No new error classes.
- The event-listener handler's expression evaluation runs inside `scope.$apply()` (or `$evalAsync()`). The digest's existing exception-routing path handles throws.
- Specifically: when the native event listener invokes `scope.$apply(run)` and `run` throws, the throw bubbles into `$apply`'s internal try/catch, which routes via `$exceptionHandler`. The implementation agent will verify which exact cause token applies; `'eventListener'` is the natural fit but the existing `$apply` plumbing may route via something else (one of the existing 10 tokens — confirm during implementation).
- **`EXCEPTION_HANDLER_CAUSES.length === 10`** holds — every error site reuses existing tokens. No new entry needed.

### 2.5 Documentation

`src/compiler/README.md` gains a new section **"Event built-ins (spec 026)"** covering:

- The single shared pattern: register native listener → `$apply` → `$event` local → cleanup via `$destroy`.
- The 18 directives organized by family (Mouse / Keyboard / Clipboard / Focus / Form-lifecycle).
- The `$$phase`-aware `$apply`/`$evalAsync` dispatch — why nested events use `$evalAsync` to avoid the "$digest already in progress" error.
- The `$event` local — available inside the bound expression, scoped to the single invocation.
- The "no auto-preventDefault" note: `ng-submit` does NOT automatically call `event.preventDefault()`; consumers either omit the form's `action` attribute or call it explicitly.
- The type-safe `EventName` pattern — `EVENT_NAMES` as a const tuple `satisfies readonly (keyof HTMLElementEventMap)[]` produces compile-time typo prevention for future maintainers.
- Cross-reference to spec 017's compile-then-link timing (the event listener attaches at link time, not compile time, so multiple `$compile(template)(scope)` invocations each get their own listener).

`CLAUDE.md` "Modules" table — `./compiler` row extended to mention the 18 new directives. One new "Non-obvious invariants" bullet covering the `$$phase`-aware dispatch and the parse-once-at-compile-time contract. 1–3 "Where to look when…" rows (probably combined: one for mouse events, one for keyboard events, one for clipboard/focus/form-lifecycle events).

`context/product/roadmap.md` — the three event sub-bullets (lines 98, 99, 100) flip from `[ ]` to `[x]` at `/awos:verify`. Already annotated with `_(spec 026 — drafted; bundled.)_`.

---

## 3. Impact and Risk Analysis

### System Dependencies

- **`@parser`** — consumes `parse(exprString)` (spec 009). No changes needed.
- **`@core/scope`** — consumes `$apply`, `$evalAsync`, `$$phase`, `$on('$destroy', …)` (specs 002, 006). No changes needed.
- **`@compiler`** — additive: 1 new file, 1 modified registration block. The compiler walker, terminal hook, isolate-binding wiring, attribute machinery, and all other established infrastructure are unchanged.
- **No other `@`-modules touched.**

### Potential Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Native event fires during a digest (e.g. one event triggers DOM that fires another event synchronously); naive `$apply` would throw "`$digest already in progress`". | The `$$phase` check dispatches to `$evalAsync` when a digest is in flight. Test pinned (manually trigger a synthetic event from inside a `$apply` callback and verify the inner expression runs). |
| Listener fires after the scope is destroyed (e.g. the element is still in the DOM but scope was torn down). | `$on('$destroy', …)` removes the listener synchronously when the scope destroys. A subsequent event has no listener to fire. Test pinned (destroy scope, trigger event, assert handler does NOT run). |
| The `$event` identifier is also a scope property — does the local shadow it? | Yes. The parser's locals-first lookup resolves `$event` from the locals object before scope. AngularJS-canonical. Test pinned. |
| `ng-submit` on a `<form>` with an `action` attribute navigates the page on submit (because the directive does not auto-`preventDefault`). | Documented behavior — consumer must either omit `action` or call `$event.preventDefault()` in the handler. The functional spec explicitly carves auto-preventDefault out-of-scope. README documents this. |
| Multiple `ng-*` event directives on the same element interact unexpectedly (e.g. event-bubbling causing both to fire). | Each directive registers exactly one listener for its own event name. `ng-click` fires only on click; `ng-mouseover` fires only on mouseover. No cross-event interaction. Test pinned. |
| Parsing the same expression 18 times (e.g. someone writes `<button ng-click="…" ng-dblclick="…" …18-deep>`) is wasteful. | Each `ng-*` directive parses its own attribute exactly once at compile time. The parse cost is paid once per (element × directive) pair, not per event fire. Acceptable. |
| A future spec wants to add a new event directive (e.g. `ng-touchstart` from `ngTouch`) — does the `EventName` union need to be extended? | Yes — extend the `EVENT_NAMES` tuple and the type narrows accordingly. Compile-time safety is preserved without manual type juggling. A future `ngTouch` spec would extend or shadow this file's tuple. |

---

## 4. Testing Strategy

**Framework:** Vitest + jsdom (existing setup). Tests under `src/compiler/__tests__/`.

**One parametrized test file** (instead of 18 per-directive files — the directives are literal clones, so parametrization is more idiomatic for this batch; matches the spec 025 precedent):

- **`src/compiler/__tests__/ng-event-directives.test.ts`** — parametrized via `describe.each` over all 18 `[ngName, eventName, hostElement]` triples. The `hostElement` chooses an appropriate target per directive (`button` for click/mouse, `input` for keyboard/focus/clipboard, `form` for submit).

  Tests per directive (parametrized):

  - **`injector.has('<name>Directive') === true`** — registration sanity check.
  - **Event fires → expression evaluates.** Compile `<host ng-click="handler($event)">`, dispatch a synthetic event, assert the handler was called with the native event as its argument.
  - **`$event` local resolves to the native event object.** Use `<host ng-click="captured = $event">`, dispatch event, assert `scope.captured` is the dispatched event (or has the expected `.type` property).
  - **Scope changes propagate.** Set up a `$watch` on a scope property; the handler mutates that property; assert the watch fires after the event.
  - **Listener cleanup on scope destroy.** Destroy the scope via `scope.$destroy()`; dispatch another event of the same type; assert the handler was NOT called.
  - **Nested events use `$evalAsync`.** Trigger an event from inside an `$apply` callback (synthetic scenario via `scope.$apply(() => element.dispatchEvent(…))`) — assert the inner expression's effect is observable after the outer digest completes, with no "`$digest already in progress`" thrown.

- **Non-parametrized block** — a few cross-cutting tests:
  - **Multiple events on same element.** `<button ng-click="a()" ng-mouseover="b()" ng-focus="c()">` — each event triggers only its own handler.
  - **Expression error routing.** A handler that throws is caught by the digest's exception-handler path; subsequent events still fire correctly.
  - **`ng-submit` does NOT preventDefault.** A `<form ng-submit="…" action="…">` with a handler that doesn't call `preventDefault` — the form's default submit behavior is not blocked by the directive itself.

- **`src/compiler/__tests__/spec026-parity.test.ts`** — focused AngularJS-canonical regression file matching the spec 022/023/024/025 precedent. 4–6 tests covering the canonical observable across event families (one click, one keyboard, one focus, one submit) plus a literal `expect(EXCEPTION_HANDLER_CAUSES.length).toBe(10)` regression guard. No deferred `it.skip` cases.

- **Regression** — full specs 002–025 suite passes unchanged.
