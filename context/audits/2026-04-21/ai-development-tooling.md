# AI Development Tooling — Audit Results

**Date:** 2026-04-21
**Score:** 100% — Grade **A**

## Results

| # | Check | Severity | Status | Evidence |
|--|--|--|--|--|
| AI-01 | CLAUDE.md ecosystem provides adequate AI context | critical | PASS | Root `CLAUDE.md` (66 lines) covers purpose, commands (`pnpm test/typecheck/lint/format/build`), module map with key exports per subpath, non-obvious invariants (tree-walking interpreter / no `new Function`, digest TTL, one-time/constant watch delegate selection, module boundary rule, digest error-handling contract), coding conventions (strict TS, no `any`, kebab-case files, 500-line target with named refactor candidates), Git + AWOS spec workflow, published-library notes, and a "Where to look when…" index. No per-module `src/*/CLAUDE.md` files, but the single root file adequately covers a small 35-file library. |
| AI-02 | Custom slash commands exist | medium | PASS | 9 AWOS commands in `.claude/commands/awos/`: `product.md`, `roadmap.md`, `architecture.md`, `spec.md`, `tech.md`, `tasks.md`, `implement.md`, `verify.md`, `hire.md`. Each has frontmatter `description` and delegates to `.awos/commands/*.md`. Well above the 3+ PASS threshold. |
| AI-03 | Skills are configured | low | PASS | 3 project skills: `.claude/skills/docs-that-work/SKILL.md`, `.claude/skills/gha-diagnosis/SKILL.md`, `.claude/skills/typescript-development/SKILL.md`. All have YAML frontmatter `name` + `description` with trigger phrases. `typescript-development` includes 4 reference files (`patterns.md`, `project-structure.md`, `type-inference.md`, `type-system.md`). |
| AI-04 | MCP servers configured | low | PASS | `.mcp.json` declares the `awos-recruitment` HTTP MCP server. `.claude/settings.local.json` sets `enableAllProjectMcpServers: true` and `enabledMcpjsonServers: ["awos-recruitment"]`. `.claude/settings.json` also registers the `awos-marketplace` extra known marketplace (GitHub `provectus/awos`). |
| AI-05 | Hooks are configured | low | PASS | `.claude/settings.json` defines both `PreToolUse` (matcher `Read\|Glob\|Grep\|Bash` → `.claude/hooks/block-sensitive.sh` guardrail that blocks access to `.env`, `*.pem`, `*.key`, `credentials*`, `secret*`, `*.p12`, `*.pfx`, SSH private keys, `.kubeconfig`, `service-account*.json`, returning exit 2) and `PostToolUse` (matcher `Write\|Edit` → `pnpm run format && pnpm run lint:fix`). The sensitive-file hook is a security positive beyond the bare minimum. |
| AI-06 | CLAUDE.md files are meaningful and well-structured | high | PASS | Root `CLAUDE.md` is 66 lines (well under the 200-line guideline) and passes the "would removing this cause mistakes?" test on every line. Contains no directory tree listings, no copy-pasted `ls` output, no copy-pasted type/export definitions (module table references the file, doesn't reproduce signatures), no duplication of linter rules (references `strictTypeChecked` preset without listing rules), no vague guidance. Concrete call-outs: exact file path `src/core/utils.ts:827` for the 500-line refactor candidates; named delegate function names (`oneTimeWatchDelegate`, `oneTimeLiteralWatchDelegate`, `constantWatchDelegate`); explicit "don't optimize by generating code strings" invariant tied to CSP/security posture. Markdown structure is consistently headers + tables + bullets. |
| AI-07 | Agent can run and observe the application | critical | PASS | Pure library project — no server/UI/simulator needed. Documented commands `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm build` are all invokable via Bash and produce observable stdout/stderr. The PostToolUse hook (`pnpm run format && pnpm run lint:fix`) provides automatic feedback after every edit. `.claude/settings.local.json` pre-allowlists the common test/lint/typecheck Bash commands to reduce permission friction. |

## Scoring

- Max points: 3 (AI-01 critical) + 1 (AI-02 medium) + 0.5 (AI-03 low) + 0.5 (AI-04 low) + 0.5 (AI-05 low) + 2 (AI-06 high) + 3 (AI-07 critical) = **10.5**
- Deductions: **0** (all 7 checks PASS)
- Percentage: (10.5 − 0) / 10.5 × 100 = **100%**
- Grade: **A** (90–100)

## Notes

- Strengths: AWOS integration is first-class — 9 slash commands, recruitment MCP, and sub-agent definitions in `.claude/agents/` (`typescript-framework`, `vitest-testing`, `rollup-build`, `ci-tooling`, `typedoc-docs`) that mirror the `**[Agent: name]**` annotations in `context/spec/*/tasks.md`.
- Security posture: the PreToolUse `block-sensitive.sh` hook is a non-trivial guardrail blocking credential exfiltration attempts across Read/Glob/Grep/Bash — stronger than most projects in this dimension.
- Minor observations (non-deduction): (a) no per-module `src/*/CLAUDE.md` exists, but the root file's module table + "Where to look" index covers the same ground for a 35-file codebase; (b) agent files under `.claude/agents/` are small (23–33 lines) and lean on the `typescript-development` skill for language conventions — appropriate layering, no redundancy.
