# Expression parser

## Purpose

The parser turns an AngularJS expression string (e.g. `'a + b'`, `'user.name'`,
`'items | filter:q'`) into a reusable evaluation function: `parse(expr)` compiles
the string once through a lexer → AST builder → tree-walking interpreter, and the
returned function evaluates the expression against a scope (and optional locals)
every time it is called. Scopes lean on it for dirty-checking and interpolation
leans on it for `{{ }}` resolution.

## Collaborators & call order

```text
  parse('a + b')
       │
       ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ parse(expr)  — runs ONCE per expression string                │
  │                                                               │
  │   1. strip leading '::' one-time prefix (sets oneTime flag)   │
  │           │                                                   │
  │           ▼                                                   │
  │   2. lex(source) ───────▶ ┌────────────────────────────────┐ │
  │                           │ Lexer: string → Token[]        │ │
  │                           └────────────────────────────────┘ │
  │           │                                                   │
  │           ▼                                                   │
  │   3. buildAST(tokens) ──▶ ┌────────────────────────────────┐ │
  │                           │ AST Builder: Token[] → ASTNode │ │
  │                           │  (tags constant/literal flags) │ │
  │                           └────────────────────────────────┘ │
  │           │                                                   │
  │           ▼                                                   │
  │   4. wrap ast.body in (scope, locals) => evaluate(...)        │
  │      attach readonly flags: oneTime / constant / literal      │
  └───────────────────────────────────────┬──────────────────────┘
                                           │ returns ExpressionFn
                                           ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ fn(scope, locals?)  — runs EVERY evaluation                   │
  │   evaluate(ast.body, scope, locals) ─▶ ┌────────────────────┐ │
  │                                        │ Interpreter:       │ │
  │                                        │ tree-walks the AST │ │
  │                                        │ NO new Function()  │ │
  │                                        │ NO eval()          │ │
  │                                        └────────────────────┘ │
  └──────────────────────────────────────────────────────────────┘

  Consumers of ExpressionFn:
    @core scope.$watch('expr', …)  ──evaluate──▶ fn(scope)
    @interpolate  {{ expr }}        ──evaluate──▶ fn(scope)
```

Collaborators are all **internal to `@parser`**: the lexer, the AST builder, and the
interpreter. The parser depends only on `@core` utilities. The deliberate project
invariant is that evaluation is a **tree-walking interpreter** — there is **no
`new Function()` and no `eval()`** — which keeps expression evaluation CSP-safe by
construction. Downstream, `@core` (the digest) and `@interpolate` (`{{ }}`) are the
two consumers of the compiled `ExpressionFn`.

## Using it the primary way

The ESM-first API: import `parse` and compile an expression once, then evaluate it
against any scope-like object.

```typescript
import { parse } from 'my-own-angularjs/parser';

const fn = parse('a + b');

fn({ a: 1, b: 2 }); // 3
fn({ a: 10, b: 5 }); // 15 — same compiled fn, different scope

// Flags carried on the returned function:
fn.constant; // false (depends on scope)
fn.literal; // false
parse('::name').oneTime; // true — leading '::' marks a one-time binding
```

`parse` also accepts locals as a second evaluation argument
(`fn(scope, locals)`), which is how directives expose `$event` and how filter
arguments are threaded through.

## Using it the dependency-injection way

**There is no `$parse` DI service shipped today.** Unlike AngularJS — which exposes
the parser as the injectable `$parse` — this project ships `parse` as a plain ESM
named export only. Scopes consume it **internally**: `scope.$watch('a + b', …)`
calls `parse` under the hood to compile the watched string into a watch delegate
(see [Scopes & digest cycle](./scope-and-digest.md)). So the parser is reachable
through the injector only transitively, by going through a scope — never as a
standalone `injector.get('$parse')` handle. If you need the compiled function
directly, import `parse` from `my-own-angularjs/parser` as shown above.

## Related diagrams

- [Scopes & digest cycle](./scope-and-digest.md) — the digest evaluates compiled expressions on every watcher
- [String & template interpolation](./interpolate.md) — compiles each `{{ expr }}` segment through this parser
- [Filters & the filter pipeline](./filters.md) — the `|` token and `Filter` production this parser emits drive `$filter` lookup at evaluation time
- [Injector & module system](./injector-and-modules.md) — how DI services (the other reach-style) are wired
- [Diagram index](./README.md)
