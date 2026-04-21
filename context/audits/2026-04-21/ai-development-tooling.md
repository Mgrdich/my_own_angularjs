# AI Development Tooling — Audit Results

**Date:** 2026-04-21
**Score:** 65% — Grade **C**

## Results

| #     | Check                                              | Severity | Status | Evidence                                                                                                                                                                                                                          |
| ----- | -------------------------------------------------- | -------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI-01 | CLAUDE.md ecosystem provides adequate AI context   | critical | FAIL   | No CLAUDE.md files anywhere (searched root, `src/**`, `.claude/rules/**`). Purpose/commands exist only in `README.md` (105 lines) and `package.json` scripts. Per spec: "no CLAUDE.md at all" triggers FAIL.                       |
| AI-02 | Custom slash commands exist                         | medium   | PASS   | 9 custom commands in `.claude/commands/awos/`: `architecture.md`, `hire.md`, `implement.md`, `product.md`, `roadmap.md`, `spec.md`, `tasks.md`, `tech.md`, `verify.md`. Threshold of 3+ met.                                       |
| AI-03 | Skills are configured                              | low      | PASS   | 3 skills with valid `SKILL.md` (YAML frontmatter present): `.claude/skills/docs-that-work/SKILL.md`, `.claude/skills/gha-diagnosis/SKILL.md`, `.claude/skills/typescript-development/SKILL.md`.                                    |
| AI-04 | MCP servers configured                             | low      | PASS   | `.mcp.json` declares `awos-recruitment` (HTTP) MCP server. `.claude/settings.local.json` sets `enableAllProjectMcpServers: true` and lists it under `enabledMcpjsonServers`.                                                       |
| AI-05 | Hooks are configured                               | low      | PASS   | `.claude/settings.json` defines `hooks.PostToolUse` matching `Write\|Edit` that runs `pnpm run format && pnpm run lint:fix`.                                                                                                       |
| AI-06 | CLAUDE.md files are meaningful and well-structured | high     | SKIP   | Skip-When condition met: no CLAUDE.md exists in project.                                                                                                                                                                          |
| AI-07 | Agent can run and observe the application         | critical | PASS   | Library/CLI project (per topology). Agent can run built-in commands: `pnpm test` (vitest, 380 tests), `pnpm typecheck`, `pnpm build` (rollup), `pnpm lint`. Scripts defined in `package.json`; README documents each. Allow-list in `.claude/settings.local.json` permits `pnpm test/lint/typecheck`, `npx vitest`, `npx tsc`. |

## Summary

**Strengths**

- Strong slash-command suite (AWOS workflow commands) and three well-described skills.
- MCP server, hook-based auto-format/lint, and fine-grained Bash permission allow-list are all configured.
- Library surface is fully agent-runnable via `pnpm` scripts; README and `package.json` expose commands clearly.

**Gaps**

- No `CLAUDE.md` at root or in any `src/<module>/` directory, nor any `.claude/rules/*.md`. This forces Claude to rediscover project purpose, module boundaries (`core`/`parser`/`di`/`compiler`), AngularJS behavioral-parity constraints, and the AWOS spec-driven workflow from `README.md` and source each session.
- Several project specifics would materially change agent behavior and are not captured in durable AI context: the clarity-over-performance goal, the "no `new Function()` — tree-walking interpreter" security constraint called out in the README, digest-cycle TTL contract, `$watchGroup`/`$watchCollection` semantics, expression-parser AST shape, and the rule captured in user memory (no explicit return types when TS can infer).
- AI-06 could not be evaluated — remedy by adding a concise root `CLAUDE.md` (and optionally per-module notes under `src/core`, `src/parser`) focused on non-discoverable invariants; the project already has a `docs-that-work` skill that spells out the relevant guidelines.

## Scoring

Weights: critical=3, high=2, medium=1, low=0.5. FAIL = full weight deducted; WARN = half; SKIP excluded from max.

| Check | Severity | Weight | Status | Deduction |
| ----- | -------- | ------ | ------ | --------- |
| AI-01 | critical | 3.0    | FAIL   | 3.0       |
| AI-02 | medium   | 1.0    | PASS   | 0         |
| AI-03 | low      | 0.5    | PASS   | 0         |
| AI-04 | low      | 0.5    | PASS   | 0         |
| AI-05 | low      | 0.5    | PASS   | 0         |
| AI-06 | high     | 2.0    | SKIP   | excluded  |
| AI-07 | critical | 3.0    | PASS   | 0         |

- Max (excluding SKIP): 3 + 1 + 0.5 + 0.5 + 0.5 + 3 = **8.5**
- Total deductions: **3.0**
- Score: (8.5 − 3.0) / 8.5 × 100 ≈ **64.7% → 65%**
- Grade: **C** (60+)
