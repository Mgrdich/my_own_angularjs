<!--
This document describes HOW to build the feature at an architectural level.
It is NOT a copy-paste implementation guide.
-->

# Technical Specification: `$sanitize` — HTML Sanitization Service

- **Functional Specification:** [`context/spec/013-sanitize-service/functional-spec.md`](./functional-spec.md)
- **Status:** Draft
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Introduce a new `src/sanitize/` module that ships HTML sanitization as a **separate `ngSanitize` module** — opt-in, never registered on the core `ng` module. Per architecture.md § 1's "Opt-in Separate Modules" invariant, apps that don't import `./sanitize` pay no runtime cost. Apps that do, list `'ngSanitize'` in their dependency chain and gain a `$sanitize` service plus an automatic `$sce.getTrustedHtml` fallback — exactly mirroring AngularJS 1.x's `angular-sanitize.js` packaging.

The implementation is two layered surfaces, matching the spec-011/spec-012 ESM-first convention:

1. **ESM primary layer (stateless, pure):**
   - `createSanitize(options?)` → `SanitizeService` — pure factory. Closes over compiled allow-lists and the URL regex. No DI, no scope, no `$injector` reference. Directly usable as `import { sanitize } from 'my-own-angularjs/sanitize'`.
   - `sanitize` — pre-configured default-instance export.
2. **DI compat layer (thin shim):**
   - `$SanitizeProvider` — owns config-time mutable state (`addValidElements`, `addValidAttrs`, `enableSvg`, `uriPattern`). `$get` calls `createSanitize` with the captured config.
   - Registered on `ngSanitize` via the spec-008 `.provider()` recipe.

The HTML parser is a **faithful port of AngularJS 1.x's `htmlParser`** in `src/ngSanitize/sanitize.js` — regex-based tokenizer, retyped into TypeScript with strict type-narrowing where it doesn't change runtime behavior. Variable names track upstream so future maintainers can map our code back to the reference implementation and to the historical CVE write-ups.

Allow-lists follow AngularJS 1.8.x exactly: one `Set<string>` for valid tags, one for valid attributes (applied globally regardless of tag), separate sets for void elements, URI-bearing attributes, and the SVG safe set. Smaller and faster than per-tag lookups, and parity with `angular/angular.js/src/ngSanitize/sanitize.js` keeps the upstream test vectors a drop-in fixture for our parity suite.

The `$sce` fallback wiring lives **on the `$sce` side**, not on `ngSanitize`. `$SceProvider.$get` adds `$injector` as a dependency, performs `injector.has('$sanitize')` at run-phase (already supported per `src/di/injector.ts:564`), and forwards the resolved sanitizer into `createSce` via a new optional `sanitize` callback in the options bag. This is additive — `createSce()` with no callback continues to behave exactly as in spec 012. `ngSanitize` does not decorate `$sce`; the coordination is one-way and lazy. Matches the AngularJS upstream pattern in `src/ng/sce.js`.

No new dependencies, no new build targets, no new test frameworks.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1. New Module Layout — `src/sanitize/`

| Path | Responsibility |
| --- | --- |
| `src/sanitize/index.ts` | Public barrel: `createSanitize`, `sanitize`, `$SanitizeProvider`, `ngSanitize`, public types. |
| `src/sanitize/sanitize-allow-lists.ts` | Frozen default allow-list constants — `VALID_ELEMENTS`, `VOID_ELEMENTS`, `OPTIONAL_END_TAG_ELEMENTS`, `BLOCK_ELEMENTS`, `INLINE_ELEMENTS`, `VALID_ATTRS`, `URI_ATTRS`, `SVG_ELEMENTS`, `SVG_ATTRS`, `DEFAULT_URI_PATTERN`. Pure data, no logic. |
| `src/sanitize/sanitize-tokenizer.ts` | The faithful port of AngularJS `htmlParser`. Pure function: `htmlParser(html, handler)` where `handler` exposes callbacks for `start`, `end`, `chars`, `comment`. No allow-list awareness — purely structural tokenization. |
| `src/sanitize/sanitize.ts` | `createSanitize(options?)` factory and the default `sanitize` instance. Composes the tokenizer with the active allow-lists into a `(input: string) => string` service. |
| `src/sanitize/sanitize-provider.ts` | `$SanitizeProvider` class with the four setters (`addValidElements`, `addValidAttrs`, `enableSvg`, `uriPattern`) plus `$get`. |
| `src/sanitize/ng-sanitize-module.ts` | `createModule('ngSanitize', []).provider('$sanitize', $SanitizeProvider)` — the opt-in module. |
| `src/sanitize/sanitize-types.ts` | `SanitizeService`, `SanitizeOptions`, `AddValidElementsArg` (the union shape AngularJS accepts), `UriPattern` types. |
| `src/sanitize/__tests__/sanitize-allow-lists.test.ts` | Asserts the default allow-list contents against the AngularJS 1.8.x reference, locking the surface. |
| `src/sanitize/__tests__/sanitize-tokenizer.test.ts` | Pure tokenizer tests — emission order, attribute parsing, malformed-input recovery. No allow-list semantics. |
| `src/sanitize/__tests__/sanitize-esm.test.ts` | `createSanitize` factory + `sanitize` default-instance behavior end-to-end. |
| `src/sanitize/__tests__/sanitize-provider.test.ts` | Setter validation, fluent chaining, defaults, `$get` output equivalence. |
| `src/sanitize/__tests__/sanitize-di.test.ts` | DI integration: `createInjector([ngModule, ngSanitize])` exposes `$sanitize`; `injector.get('$sanitizeProvider')` is config-only; ESM/DI parity guard. |
| `src/sanitize/__tests__/sanitize-sce.test.ts` | `$sce.getTrustedHtml` ↔ `$sanitize` cross-module integration: fallback behavior, strict-mode interaction, missing-`$sanitize` regression. |
| `src/sanitize/__tests__/parity-spec.test.ts` | Test vectors ported from `angular/angular.js/test/ngSanitize/sanitizeSpec.js`. |
| `src/sanitize/__tests__/cve-regressions.test.ts` | One test per documented historical `ngSanitize` CVE — payload + expected sanitized output. |

A new path alias `@sanitize/*` is added to `tsconfig.json`, `vitest.config.ts`, `rollup.config.mjs` (`tsPathAliases` and a new `sanitize/index` build entry), and `package.json` exports gains a `./sanitize` entry — mirrors the `./sce` pattern shipped in spec 012.

### 2.2. Dual API Surface

**ES module layer (primary):**

| Export | Signature | Purpose |
| --- | --- | --- |
| `createSanitize(options?)` | `(options?: SanitizeOptions) => SanitizeService` | Pure factory; compiles allow-lists once at construction. |
| `sanitize` | `SanitizeService` | `createSanitize()` with defaults. |
| `SanitizeService` | `(input: unknown) => string` | Callable; coerces non-strings via `String()`, returns `''` for nullish. |
| `SanitizeOptions` | `{ extraValidElements?; extraValidAttrs?; svgEnabled?; uriPattern? }` | All fields optional and additive over the defaults. |
| `ngSanitize` | `Module` | The opt-in DI module — `createModule('ngSanitize', []).provider('$sanitize', $SanitizeProvider)`. Exported so consumers can compose injectors via `createInjector([ngModule, ngSanitize])`. |

**DI layer (AngularJS compat):**

`$SanitizeProvider` holds the four pieces of mutable config-phase state. Its `$get` calls `createSanitize` with that state captured into a frozen options object — single implementation.

### 2.3. Allow-List Constants — `src/sanitize/sanitize-allow-lists.ts`

All exported as `readonly` `Set<string>` (or `RegExp` for the URI pattern). Frozen at module load.

| Constant | Source | Notes |
| --- | --- | --- |
| `VOID_ELEMENTS` | `area, br, col, hr, img, wbr` | Self-closing void elements; never have closing tags. |
| `OPTIONAL_END_TAG_BLOCK_ELEMENTS` | `colgroup, dd, dt, li, p, tbody, td, tfoot, th, thead, tr` | Block elements where the closing tag may be omitted. |
| `OPTIONAL_END_TAG_INLINE_ELEMENTS` | `rp, rt` | Inline elements where the closing tag may be omitted. |
| `BLOCK_ELEMENTS` | `address, article, aside, blockquote, …` | Full block-element set per AngularJS 1.8.x. |
| `INLINE_ELEMENTS` | `a, abbr, acronym, b, bdi, bdo, big, cite, …` | Full inline-element set per AngularJS 1.8.x. |
| `VALID_ELEMENTS` | union of all of the above + optional-end-tag sets | The runtime check uses this. |
| `VALID_ATTRS` | `abbr, align, alt, axis, bgcolor, border, …` | Global attribute allow-list. |
| `URI_ATTRS` | `background, cite, href, longdesc, src, xlink:href` | Subset of `VALID_ATTRS` whose values must pass the URI regex. |
| `SVG_ELEMENTS` | `a, circle, defs, desc, ellipse, …` | Opted in via `enableSvg(true)`. |
| `SVG_ATTRS` | `accent-height, accumulate, additive, …` | SVG attribute allow-list. |
| `DEFAULT_URI_PATTERN` | `/^\s*(https?\|s?ftp\|mailto\|tel\|file):/` | Plus a special-case branch for relative URLs (no protocol, leading `/`, `.`, `#`, or alphanumeric path). |

The exact list contents are locked against `angular/angular.js/src/ngSanitize/sanitize.js` at the version pinned in our test fixtures. A dedicated test file (`sanitize-allow-lists.test.ts`) asserts each constant's `Set` membership against the reference; the file pins AngularJS 1.8.3 specifically.

### 2.4. Tokenizer — `src/sanitize/sanitize-tokenizer.ts`

A faithful port of AngularJS's `htmlParser`. Pure function shape:

```
htmlParser(html: string, handler: TokenHandler): void

interface TokenHandler {
  start(tagName: string, attrs: Map<string, string>, unary: boolean): void;
  end(tagName: string): void;
  chars(text: string): void;
  comment(text: string): void;
}
```

Implementation notes:

- **Regex sources** are copied verbatim from upstream where possible (`START_TAG_REGEXP`, `END_TAG_REGEXP`, `ATTR_REGEXP`, `BEGIN_TAG_REGEXP`, etc.) so the tokenizer recognizes exactly the inputs AngularJS recognizes.
- **State machine** is a `while` loop scanning the input; each iteration matches one of the four token kinds and advances `i`. Variable names mirror upstream to keep the line-by-line port traceable.
- **Stack-based auto-close** — when a start tag is emitted, push it onto a stack; when an end tag is seen, pop the stack until matched (auto-emitting `end` for any unclosed elements in between). At end-of-input, drain the stack with `end` calls.
- **Optional end-tag elements** consult `OPTIONAL_END_TAG_BLOCK_ELEMENTS` / `OPTIONAL_END_TAG_INLINE_ELEMENTS` to decide whether implicit closure is allowed.
- **Comments and CDATA** — tokenizer emits `comment` events; the handler in `createSanitize` is responsible for dropping them (the tokenizer is allow-list-agnostic).
- **Entity handling** — passes raw entities through unchanged in the `chars` event; the consuming handler decides whether to escape them on output.
- **NO `DOMParser` use.** The tokenizer never touches the DOM. Works identically on Node, jsdom, and browser. This is the priority over alternative parsing strategies.
- **NO error throwing.** Malformed input recovers via auto-close + best-effort regex match; the parser always completes the loop.

The tokenizer is exported and unit-tested in isolation (`sanitize-tokenizer.test.ts`) so we can assert AngularJS-parity tokenization without coupling to allow-list decisions.

### 2.5. `createSanitize(options)` — `src/sanitize/sanitize.ts`

Top-level factory composition:

1. Resolve effective allow-lists:
   - Tags: `defaults.VALID_ELEMENTS ∪ options.extraValidElements ∪ (options.svgEnabled ? SVG_ELEMENTS : ∅)`
   - Attrs: `defaults.VALID_ATTRS ∪ options.extraValidAttrs ∪ (options.svgEnabled ? SVG_ATTRS : ∅)`
   - URI attrs: `defaults.URI_ATTRS` (extending this is out of scope per FS § 3 Out-of-Scope)
   - URI pattern: `options.uriPattern ?? DEFAULT_URI_PATTERN`
   - Each effective set is computed once at factory call time and frozen.
2. Return a callable: `(input: unknown) => string`.

Service body (per call):

1. **Coerce input.** `null`/`undefined` → return `''`. Otherwise `String(input)` if not already a string. Empty string → return `''`.
2. **Set up the writer.** A simple string accumulator (`let out = ''`) with helpers `pushTag`, `pushText`, `escapeText`. The writer state lives in a closure, not a class.
3. **Drive the tokenizer.** Pass an inline `TokenHandler` whose four methods consult the effective allow-lists:
   - `start(tag, attrs, unary)` — if `tag` is not in the allow-list, set a `dropDepth` counter to skip until the matching `end`. If allowed, write `<tag` and walk attrs: each attr name must be in the allow-list; URI attrs additionally must match the URI pattern (whitespace-trimmed).
   - `end(tag)` — decrement `dropDepth` if applicable, otherwise write `</tag>` if the tag is on the allow-list and not a void element.
   - `chars(text)` — entity-escape the text (using a small hand-rolled escape that matches AngularJS's `encodeEntities`) and append, unless `dropDepth > 0`.
   - `comment(text)` — drop unconditionally.
4. Return the accumulated string.

The factory does NOT use a class — keeps the service safely destructurable (`const cleaner = sanitize` works). Methods that need to share state across the parse run close over local `let` bindings inside the returned callable.

### 2.6. `$SanitizeProvider` — `src/sanitize/sanitize-provider.ts`

Instance state (private, `$$` prefix per project convention):

- `$$extraValidElements: Set<string>` — initially empty.
- `$$extraValidAttrs: Set<string>` — initially empty.
- `$$svgEnabled: boolean` — initially `false`.
- `$$uriPattern: RegExp` — initially `DEFAULT_URI_PATTERN`.

Public methods (overloaded getter/setter pattern, matching `$InterpolateProvider` and `$SceDelegateProvider` precedent):

| Method | Contract |
| --- | --- |
| `addValidElements(arg: string \| string[] \| AddValidElementsArg): this` | Validates the argument shape, copies entries into `$$extraValidElements`, returns `this`. The `AddValidElementsArg` object form (`{ htmlVoidElements, htmlElements, svgElements }`) is decomposed into the right buckets. |
| `addValidAttrs(attrs: string[]): this` | Validates that every entry is a non-empty string, copies into `$$extraValidAttrs`, returns `this`. |
| `enableSvg(value: boolean): this` | Validates `typeof value === 'boolean'`, stores, returns `this`. |
| `uriPattern(pattern: RegExp): this` | Validates `pattern instanceof RegExp`, stores, returns `this`. |
| `$get = [(): SanitizeService => createSanitize({ extraValidElements: [...this.$$extraValidElements], extraValidAttrs: [...this.$$extraValidAttrs], svgEnabled: this.$$svgEnabled, uriPattern: this.$$uriPattern })] as const;` | Array-style invokable, no DI deps. |

Each setter throws `Error` synchronously on invalid input — message prefixed `$sanitizeProvider.<method>: …` so the call site is traceable. Validation runs at the setter call (config phase), not at `$get`, so misconfiguration surfaces immediately during `config()`.

### 2.7. `ngSanitize` Module Registration — `src/sanitize/ng-sanitize-module.ts`

```
import { createModule } from '@di/module';
import { $SanitizeProvider } from '@sanitize/sanitize-provider';
import type { SanitizeService } from '@sanitize/sanitize-types';

declare module '@di/di-types' {
  interface ModuleRegistry {
    ngSanitize: {
      registry: { $sanitize: SanitizeService };
      config: { $sanitizeProvider: $SanitizeProvider };
    };
  }
}

export const ngSanitize = createModule('ngSanitize', []).provider('$sanitize', $SanitizeProvider);
```

`ngSanitize` is NOT a dependency of `ngModule`. Apps register it independently:

```
createInjector([ngModule, ngSanitize, myAppModule]);
```

Registration order does not matter — DI resolves the dependency graph, and `$sanitize` has no dependencies.

### 2.8. `$sce.getTrustedHtml` Fallback Wiring

Two coordinated changes, both small and additive:

**`src/sce/sce-types.ts`:** extend `SceOptions` with an optional callback:

```
interface SceOptions {
  readonly delegate?: SceDelegateService;
  readonly enabled?: boolean;
  readonly sanitize?: (html: string) => string;  // new
}
```

**`src/sce/sce.ts`:** modify the `getTrusted` closure inside `createSce` so that:

```
function getTrusted(ctx, value) {
  if (!enabled) return delegate.valueOf(value);
  if (value === null || value === undefined) return value;

  // NEW branch — runs only for the html context, only when sanitize was supplied,
  // only on plain strings, and only after the existing wrapper-context checks fail.
  if (
    ctx === SCE_CONTEXTS.HTML &&
    options?.sanitize !== undefined &&
    typeof value === 'string'
  ) {
    return options.sanitize(value);  // scrub and return safe HTML
  }

  return delegate.getTrusted(ctx, value);  // unchanged spec-012 path
}
```

Notes on the conditional ordering:
- A `TrustedHtml` wrapper still goes through `delegate.getTrusted` and unwraps directly — sanitize is only consulted for plain strings.
- A wrapper for a different context (e.g. `TrustedUrl`) into `getTrustedHtml` still throws via the delegate's mismatched-context error — sanitize is not a workaround.
- Strict mode off bypasses the entire branch via the early-return on `!enabled`.

**`src/sce/sce-provider.ts`:** modify `$get` to add `'$injector'` as a dep and probe for `$sanitize`:

```
$get = [
  '$sceDelegate',
  '$injector',
  (delegate: SceDelegateService, $injector: Injector): SceService =>
    createSce({
      delegate,
      enabled: this.$$enabled,
      sanitize: $injector.has('$sanitize')
        ? ($injector.get('$sanitize') as (html: string) => string)
        : undefined,
    }),
] as const;
```

This is the one place the integration lives. `ngSanitize` does NOT decorate `$sce`. The lazy lookup means `$sce` works identically when `ngSanitize` is absent (the spec-012 baseline is preserved).

### 2.9. Public Exports

**`src/sanitize/index.ts`:**

```
export { createSanitize, sanitize } from './sanitize';
export { $SanitizeProvider } from './sanitize-provider';
export { ngSanitize } from './ng-sanitize-module';
export type { SanitizeService, SanitizeOptions, AddValidElementsArg } from './sanitize-types';
```

**`src/index.ts`:** add to the existing exports:

```
export { createSanitize, sanitize, ngSanitize } from './sanitize/index';
export type { SanitizeService, SanitizeOptions } from './sanitize/index';
```

`$SanitizeProvider` is NOT re-exported from the root barrel — it's reachable via `injector.get('$sanitizeProvider')` during `config()`, the AngularJS-idiomatic surface.

### 2.10. `CLAUDE.md` Update

- Add `./sanitize` to the Modules table with a one-liner: opt-in HTML scrubber; `createSanitize` / `sanitize` ESM entry points; companion to `$sce`.
- Add a "Non-obvious invariants" bullet: **`ngSanitize` is opt-in, never registered on the core `ng` module.** Once added to the injector's module list, `$sce.getTrustedHtml` automatically delegates plain-string HTML through `$sanitize` via a lazy `$injector.has` lookup in `$SceProvider.$get` — no hard dependency, no decoration.
- Add a "Where to look when..." row: "How is untrusted HTML scrubbed?" → `src/sanitize/sanitize.ts` (factory) and `src/sanitize/sanitize-tokenizer.ts` (parser).

---

## 3. Impact and Risk Analysis

### System Dependencies

- **`src/sce/sce-types.ts`, `src/sce/sce.ts`, `src/sce/sce-provider.ts`** — additive: new `sanitize` option on `SceOptions`, conditional branch in `createSce` `getTrusted`, `$injector` dep in `$SceProvider.$get`. No spec-012 behavior changes when the option is absent.
- **`src/di/injector.ts`** — consumed read-only via `injector.has(name)` (line 564). No changes.
- **`src/core/ng-module.ts`** — UNCHANGED. `$sanitize` is registered on `ngSanitize`, not `ngModule`.
- **`src/parser/`, `src/interpolate/`, `src/core/scope.ts`** — no changes.
- **Existing tests** (specs 003, 007, 008, 009, 010, 011, 012) — must pass unchanged. The `$sce` integration is opt-in; without `ngSanitize` loaded, all spec-012 tests behave identically.

### Potential Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Faithful regex-tokenizer port reintroduces a historical `ngSanitize` CVE bypass. | The dedicated `cve-regressions.test.ts` runs every documented historical-CVE payload as a permanent fixture. The first sub-task of the implementation slice is to populate this file before the parser is wired so we know the day-one baseline. Failing tests are a hard build break. |
| Allow-list drift over time: someone adds a tag/attr in `addValidElements` for a feature without considering the security implication. | The default allow-list is a frozen `Set<string>`; only the *extension* sets are mutable, and they live on the provider with public `add*` setters. Provider tests assert that the defaults are unmodifiable. Code review on changes to `sanitize-allow-lists.ts` is the human-factor backstop. |
| The `$sce` ↔ `$sanitize` integration silently regresses if a future `$SceProvider.$get` change drops the `$injector` dep. | A dedicated test in `sanitize-sce.test.ts` constructs an injector with `ngSanitize` loaded and asserts `$sce.getTrustedHtml('plain string')` returns sanitized output (NOT throws). Removing the dep would break this test. |
| Circular import between `src/sce/` and `src/sanitize/`. | `src/sanitize/` does NOT import from `src/sce/`. `src/sce/` does NOT import from `src/sanitize/`. The integration lives entirely in `$SceProvider.$get`'s lazy `$injector.has` lookup — runtime indirection, not import-time. Cycle-free by construction. |
| The `$sce` `sanitize` callback is typed as `(html: string) => string`, but the actual `$sanitize` accepts `unknown`. | Acceptable narrowing: `getTrusted` already type-narrowed `value` to `string` before invoking `sanitize`. The narrower callback type matches what `$sce` actually calls. The `$sanitize` service itself remains `(input: unknown) => string` for direct callers. |
| Running `pnpm test` outside jsdom breaks the parity tests. | The AngularJS sanitize tests don't depend on a real DOM (the tokenizer is regex-based); jsdom is the project default but not a hard requirement for `src/sanitize/`. Tests run identically under Node. |
| URI pattern bypass via Unicode whitespace tricks (e.g. `\u00a0javascript:`). | The default regex includes `\s` which JavaScript matches against the full Unicode whitespace class. We add an explicit test for non-breaking-space prefixes in `parity-spec.test.ts` and `cve-regressions.test.ts` to lock this down. |
| `$sanitizeProvider.addValidAttrs(['onclick'])` would catastrophically allow event-handler injection. | Document loudly in TSDoc on `addValidAttrs` that adding `on*` attribute names is never safe. Optional: add a runtime check that rejects names matching `/^on/i`. Tracked as a follow-up; not in the initial spec. |
| Coverage threshold (90% lines on `src/sanitize/`) hard to hit due to allow-list constant tables. | Allow-list files are pure data — the test that asserts membership covers them. Combined with the parity + CVE-regression suites, total coverage of `src/sanitize/` is expected to comfortably clear 90%. |

---

## 4. Testing Strategy

All tests use Vitest (project standard). Target 90%+ line coverage on `src/sanitize/` (architecture § 2).

### 4.1. Allow-List Snapshot Tests — `src/sanitize/__tests__/sanitize-allow-lists.test.ts`

- Each exported constant matches the AngularJS 1.8.3 reference set, verified by exact-equality `Set` comparison against a manually-locked fixture array.
- Each constant is frozen — `Object.isFrozen` checks fail-loud if a future edit accidentally mutates a default.

### 4.2. Tokenizer Unit Tests — `src/sanitize/__tests__/sanitize-tokenizer.test.ts`

- Plain text → single `chars` event with the input.
- Single tag → one `start` + matched `end`.
- Void elements → `start` with `unary: true`, no `end` event from the tokenizer (handler closes implicitly).
- Nested tags emit `start`/`end` in stack order.
- Mismatched closing tag → tokenizer auto-closes intervening tags then emits the requested `end`.
- Unclosed tags at end-of-input → tokenizer drains the stack with `end` events.
- Comments emit `comment`; CDATA falls through as `chars`.
- Entity sequences (`&amp;`, `&lt;`, `&#x3c;`) survive verbatim in `chars`.
- Attribute parsing: single-quoted, double-quoted, unquoted, no-value (boolean) attributes all decoded correctly into the attrs `Map`.

### 4.3. ESM Factory Tests — `src/sanitize/__tests__/sanitize-esm.test.ts`

- `sanitize('plain text')` returns `'plain text'`.
- `sanitize('')` returns `''`; `sanitize(null)` returns `''`; `sanitize(undefined)` returns `''`.
- `sanitize(42)` returns `'42'` (coerced via `String`, then sanitized — no markup, so identity output).
- `sanitize('<p>hi</p>')` returns `'<p>hi</p>'`.
- `sanitize('<script>alert(1)</script>x')` returns `'x'` (script + contents dropped; surviving text preserved).
- `sanitize('<a href="javascript:alert(1)">x</a>')` returns `'<a>x</a>'`.
- `sanitize('<a href="https://example.com/x">x</a>')` returns the input unchanged.
- `sanitize('<img src="x.png" onerror="alert(1)">')` returns `'<img src="x.png">'` (`onerror` is dropped).
- `sanitize('<style>body{x:y}</style>x')` returns `'x'` (style + contents dropped).
- `createSanitize({ svgEnabled: true })` accepts SVG tags; default `createSanitize()` strips them.
- `createSanitize({ extraValidElements: ['my-tag'] })` allows the custom tag to pass through.
- `createSanitize({ uriPattern: /^myapp:/ })` accepts only `myapp:` URLs in `href`.
- Idempotence: `sanitize(sanitize(x)) === sanitize(x)` for representative inputs.

### 4.4. Provider Tests — `src/sanitize/__tests__/sanitize-provider.test.ts`

- Defaults: `addValidElements()` getter not part of API; new providers ship with empty extra-sets; `enableSvg() === false` by default; `uriPattern()` returns `DEFAULT_URI_PATTERN`.
- Fluent chaining: `provider.addValidElements(['x']).addValidAttrs(['y']).enableSvg(true)`.
- Setter validation: `addValidElements([42 as any])` throws; `addValidAttrs(null as any)` throws; `enableSvg('true' as any)` throws; `uriPattern('not regex' as any)` throws.
- `$get` invocation produces a `SanitizeService` that respects the configured extras.
- Idempotent calls: setting the same value twice does not duplicate entries (Set semantics).

### 4.5. DI Integration — `src/sanitize/__tests__/sanitize-di.test.ts`

- `createInjector([ngModule, ngSanitize])` exposes `$sanitize`; `injector.has('$sanitize') === true`.
- `createInjector([ngModule])` (no `ngSanitize`) — `injector.has('$sanitize') === false`; `injector.get('$sanitize')` throws "Unknown provider".
- `$sanitize` is a singleton across `injector.get` calls.
- `injector.get('$sanitizeProvider')` throws at run-phase ("Unknown provider").
- `config(['$sanitizeProvider', p => p.enableSvg(true)])` is observed at runtime by `$sanitize`.
- ESM/DI parity guard: for representative inputs, the DI-resolved `$sanitize` and the ESM `sanitize` default export produce identical outputs.

### 4.6. `$sce` Integration — `src/sanitize/__tests__/sanitize-sce.test.ts`

- `createInjector([ngModule, ngSanitize])`: `$sce.getTrustedHtml('plain <p>x</p>')` returns the sanitized string (NOT a throw).
- `createInjector([ngModule])` (no `ngSanitize`): `$sce.getTrustedHtml('plain <p>x</p>')` throws — preserves spec-012 behavior.
- `$sce.getTrustedHtml(trustedWrapper)` continues to unwrap directly even when `ngSanitize` is loaded; sanitize is not invoked on wrapped values.
- `$sce.getTrustedHtml(null)` and `…(undefined)` continue to pass through; sanitize not invoked.
- Strict mode OFF (`config(['$sceProvider', p => p.enabled(false)])`) — `$sce.getTrustedHtml('<script>x</script>x')` returns the input unchanged; sanitize NOT invoked (strict-off pass-through).
- `$sce.getTrustedUrl(plainString)` and other contexts are unaffected by the integration.
- ESM-first equivalent: `createSce({ sanitize: sanitize })` produces the same fallback behavior without DI involvement.

### 4.7. AngularJS Parity — `src/sanitize/__tests__/parity-spec.test.ts`

- Test vectors ported from `angular/angular.js/test/ngSanitize/sanitizeSpec.js` at v1.8.3 — every `it(...)` becomes a Vitest `it(...)` with the same input and expected output. Input hand-copied; output recomputed and pinned. Future divergence is investigated and either closed or annotated as an intentional deviation in the test comment.

### 4.8. CVE Regressions — `src/sanitize/__tests__/cve-regressions.test.ts`

- One test per documented historical `ngSanitize` advisory:
  - **CVE-2020-7676** — mXSS via `<noscript>`/SVG namespace confusion.
  - **CVE-2018-12116** — protocol-relative URL bypass.
  - **CVE-2014-3506** — sandbox escape via `<form>` action.
  - Plus any other published advisories enumerated in the AngularJS GitHub security tab and in `angular/angular.js/CHANGELOG.md` matching `sanitize`/`xss`.
- Each test embeds the original PoC payload and asserts the cleaned output is safe. The test file's top-of-file comment lists the URLs of the original advisories so future maintainers can re-investigate if a test needs updating.

### 4.9. Regression Tests

Entire existing suites (specs 002, 003, 006, 007, 008, 009, 010, 011, 012) continue to pass unchanged. CI runs them on every push.
