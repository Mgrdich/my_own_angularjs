# Service diagrams

Plain-text, at-a-glance diagrams for the services shipped through Phase 2 of this
project. Each diagram answers three questions a developer has when they first open a
service: how it works inside (which other services it leans on and in what order),
how you are supposed to call it (the primary import-and-call style and the
dependency-injection style), and what that actually looks like as a minimal snippet.
They are written for developers learning the framework internals — read the diagram
for a service before reading its source.

## Notation legend

All diagram files use the same Unicode box-drawing convention:

- Boxes are drawn with `┌─┐`, `│`, and `└─┘`.
- A solid arrow `──▶` (also written `→`) is a **direct call**; the label on the
  arrow is the method being called, e.g. `──$digest()──▶`.
- A vertical arrow `│` / `▼` shows downward flow inside a single service's loop.
- A dashed connector marked with `⌁` is a **lazy `$injector.has(...)` optional-
  dependency probe** — the caller checks whether a collaborator is registered
  before reaching for it, and degrades gracefully when it is absent.

Diagrams always live inside fenced code blocks so they render unchanged in editors,
terminals, and on GitHub, and so the formatter leaves the box-drawing art alone.

## How the services fit together

The expression **parser** compiles strings into evaluables that both **scope**
(dirty-checking in the digest) and **interpolate** (`{{ }}` resolution) consume. The
**compiler** is the orchestrator: it walks the DOM and pulls in **controller**,
**interpolate**, **sce**, and the registered **directives** as it links each
element. **sanitize** is an opt-in companion to **sce** — when it is loaded, `$sce`
routes untrusted HTML through it via a lazy probe. The **exception-handler** is the
common sink that routes digest-time and interpolate-time errors so a single failing
watcher or expression never crashes the loop.

## Diagrams

| Diagram | What it covers |
| --- | --- |
| [Scopes & digest cycle](./scope-and-digest.md) | `$watch` / `$digest` / `$apply`, dirty-checking, scope hierarchy & events |
| [Expression parser](./expression-parser.md) | `parse(expr)` lexer → AST → tree-walking interpreter; the compiled `ExpressionFn` and its flags |
| [Injector & module system](./injector-and-modules.md) | `createModule` recipes, `createInjector` graph load, config vs run phase, `$provide`, lazy `get` / `has` |
| [Centralized exception handling](./exception-handler.md) | `$exceptionHandler`, `invokeExceptionHandler` recursion guard, the 10 cause tokens, log-and-continue |
| [String & template interpolation](./interpolate.md) | `$interpolate(text, mustHaveExpression, trustedContext)`, per-expression `parse`, the trusted-context `$sce.getTrusted` seam, render-time error routing |
| [Strict Contextual Escaping ($sce)](./sce.md) | `trustAs` / `getTrusted` dispatch, `$sceDelegate` resource-URL allow/block matcher, the lazy `$sanitize` probe on the HTML path, frozen strict mode |
| [Opt-in HTML sanitization (ngSanitize)](./sanitize.md) | `$sanitize` tokenizer + tag/attribute/URI allow-list filter, the opt-in `ngSanitize` module, DOMPurify swap via decorator |
| [Filters & the filter pipeline](./filters.md) | `value \| filter:args` parsing, `$filter` lookup via `<name>Filter` providers, the nine built-ins, `$locale` swap, `$stateful`, unknown-filter routing |
| [Template loading ($templateCache / $templateRequest)](./template-loading.md) | `$templateCache` Map store + `$templateRequest` fetch-and-cache with in-flight dedup, backing `$compile`'s `template` / `templateUrl` |
| [Controllers ($controller / $controllerProvider)](./controller.md) | `register` (config) → `$controller(name, locals, ident, later?)`, `'Name as alias'` parse, `Object.create` + `injector.invoke` + return-value replacement, `controllerAs` publish, the compiler's `later:true` seam |
| [DOM compiler ($compile)](./compile.md) | `$compile(element)` walk → directive collect/sort → compile → three-phase link (pre/child/post); the controller seam, transclusion, isolate bindings, text/attr interpolation, `templateUrl`, errors via `$exceptionHandler('$compile')` |
| [Built-in directives](./built-in-directives.md) | The shared directive mechanism (restrict / priority / compile / link / scope kinds) plus per-category sub-sections: structural, visibility & binding, class & style, attribute helpers, events, pluralization, CSP/template-cache/element overrides |

## Maintenance

These diagrams describe a moving codebase. When a spec changes a service, the
matching diagram in this folder must be co-updated in the same change. The structural
test (`src/__tests__/diagrams-structure.test.ts`) guards file presence, the fixed
five-heading layout, and that every relative link resolves to an existing file — but
it checks structure, not prose, so diagram and snippet accuracy stay a manual review
responsibility.
