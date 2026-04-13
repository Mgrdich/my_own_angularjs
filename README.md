# My Own AngularJS

A complete, fully typed TypeScript reimplementation of AngularJS, built from scratch as a deep learning exercise in framework internals.

## Vision

To create a clean, well-documented reference implementation of AngularJS that serves as both a learning resource and a usable library. The goal is **clarity over performance** -- every module is written in strict TypeScript with comprehensive tests, making it easy to understand how AngularJS works under the hood.

This project is being fully rewritten using [Claude Code](https://claude.ai/code) as the AI coding assistant, orchestrated through the [AWOS](https://github.com/provectus/awos)  methodology -- from product definition and spec writing, through task breakdown and implementation, to verification and PR creation.

### Who is this for?

- **Curious developers** who want to understand how dirty checking, digest cycles, and dependency injection actually work at a low level
- **TypeScript learners** looking for a non-trivial project that applies advanced typing patterns (generics, type guards, mapped types) in a real framework context
- **Open-source community** looking for a modern, typed alternative/reference of AngularJS

## What's Implemented

### Phase 0 -- Complete

- **Scopes & Digest Cycle** -- Full scope hierarchy with `$watch`, `$watchGroup`, `$watchCollection`, `$digest`, `$apply`, `$eval`, `$evalAsync`, `$applyAsync`, events (`$on`, `$emit`, `$broadcast`), and lifecycle (`$new`, `$destroy`)
- **Expression Parser** -- Lexer, AST builder, and tree-walking interpreter supporting literals, identifiers, member access, function calls, and scope/locals resolution
- **Utility Functions** -- Type guards (`isString`, `isNumber`, `isObject`, etc.), deep equality (`isEqual`), deep clone (`copy`), iteration (`forEach`), and helpers (`noop`, `createMap`, `range`)

### Improvements Over Original AngularJS

While maintaining behavioral parity, this implementation introduces several enhancements:

- **Configurable digest TTL** -- Set the maximum digest iterations per scope hierarchy via `Scope.create({ ttl: 20 })` instead of a hardcoded limit
- **Improved error diagnostics** -- TTL breach errors include the watch function source to help identify unstable watchers
- **Full TypeScript type guards** -- All type-checking functions (`isString`, `isObject`, etc.) are proper type guards that narrow types in conditionals
- **Generic type safety** -- `Scope.create<T>()` provides typed scope properties, `isArray<T>()` preserves element types from union inputs
- **Tree-walking interpreter** -- Expression parser uses a safe AST interpreter instead of `new Function()` code generation, eliminating CSP violations

### Upcoming

- **Phase 1** -- Configurable digest TTL, Dependency Injection (modules, injector, providers)
- **Phase 2** -- Expressions & Filters, Directives & DOM Compilation
- **Phase 3** -- HTTP, Forms & Validation, Promises
- **Phase 4** -- Routing, Animations, npm Package

## Tech Stack

| Tool           | Purpose                                    |
|----------------|--------------------------------------------|
| TypeScript 6.x | Strict mode, full type safety              |
| Vitest         | Testing with jsdom environment             |
| Rollup         | Dual ESM + CJS output                      |
| ESLint         | Strict type-checked linting                |
| Prettier       | Code formatting                            |
| GitHub Actions | CI pipeline (lint, typecheck, test, build) |
| pnpm           | Package manager                            |

## Getting Started

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Type check
pnpm typecheck

# Build (ESM + CJS + type declarations)
pnpm build

# Lint
pnpm lint

# Format
pnpm format
```

## Project Structure

```
src/
  core/
    scope.ts          # Scopes & Digest Cycle
    utils.ts          # Utility functions & type guards
    index.ts          # Core barrel export
  parser/
    lexer.ts          # Expression tokenizer
    ast.ts            # AST builder (recursive descent)
    interpreter.ts    # Tree-walking interpreter
    parse.ts          # Public parse() API
    index.ts          # Parser barrel export
  index.ts            # Root barrel export
```

## Test Coverage

380 tests across all modules, validated against both the original AngularJS test suite and legacy implementations.

```bash
pnpm test
# 3 test files, 380 tests passed
```

## License

MIT
