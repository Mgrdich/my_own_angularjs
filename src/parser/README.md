# `@parser` — Expression Parser

Parses AngularJS-style scope expressions into a reusable evaluator function. Uses a **tree-walking interpreter** — never `new Function()` or `eval()` — so it's safe under strict CSP.

## Entry points

```ts
import { parse } from 'my-own-angularjs/parser';

const fn = parse('user.name + "!"');
fn({ user: { name: 'ada' } }); // "ada!"
```

| Export | Where | Purpose |
| --- | --- | --- |
| `parse(expr)` | `parse.ts` | Returns an `ExpressionFn` with flags (`literal`, `constant`, `oneTime`) attached. |
| Types: `ExpressionFn`, `Token`, `ASTNode` | `parse-types.ts` | Public types for consumers. |

## Pipeline

```
string → lexer.ts → Token[] → ast.ts → ASTNode → ast-flags.ts → interpreter.ts → ExpressionFn
```

- `lexer.ts` — tokenizes numbers, strings, identifiers, operators, punctuation.
- `ast.ts` — recursive-descent AST builder; covers literals, identifiers, member access, function calls, unary `+ - !`, binary `* / % + - < <= > >= == != === !==`, logical `&& ||`, conditional `? :`, and one-time-binding prefix `::`.
- `ast-flags.ts` — post-walk that propagates `literal` / `constant` / `oneTime` flags from leaves up through the tree so the scope layer can pick the right watch delegate.
- `interpreter.ts` — evaluates the AST against a scope + optional locals; no code generation.

## Key invariants

- **No code generation.** Any proposed optimization that reintroduces `new Function()` should be rejected — the CSP-safety of expressions is a design constraint.
- **Flags on returned function.** `parse(expr).literal`, `.constant`, `.oneTime` are part of the public contract — consumers (scope watch delegates) rely on them.

## Dependencies

Only depends on `@core/utils` for a handful of helpers (`isFunction`, `isObjectLike`, `isKeyOf`). Does not depend on scope.
