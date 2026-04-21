# Security Guardrails — Audit Results

**Date:** 2026-04-21
**Score:** 64% — Grade **C**

## Results

| # | Check | Severity | Status | Evidence |
|---|-------|----------|--------|----------|
| SEC-01 | .env files are gitignored | critical | PASS | `.gitignore` lines 65-67 include `.env` and `.env.test`; `git ls-files '*.env*'` returns empty. No `.env.local`/`.env.*.local` but no templates tracked either. |
| SEC-02 | AI agent hooks restrict access to sensitive files | critical | FAIL | `.claude/settings.json` only defines a `PostToolUse` hook for `Write\|Edit` running `pnpm format && lint:fix`. No `PreToolUse` hooks blocking Read/Glob/Bash access to `.env`, `*.pem`, `*.key`, `credentials*`, `secrets*`, `*.p12`, `*.pfx`. |
| SEC-03 | .env.example or template exists | high | SKIP | No `process.env`, `dotenv`, or env-var usage found in `src/` or repo (grep returned no matches). Library project with no runtime env configuration. |
| SEC-04 | No secrets in committed files | critical | PASS | No hardcoded credentials found: no matches for `AKIA[0-9A-Z]{16}`, `BEGIN PRIVATE KEY`, `BEGIN RSA/OPENSSH PRIVATE KEY`, or `(password\|secret\|apikey\|api_key)="[A-Za-z0-9]`. `token`/`secret` occurrences in `src/parser/ast.ts` are parser lexer identifiers, not credentials. |
| SEC-05 | Sensitive files in .gitignore relevant to stack | high | WARN | `.gitignore` covers TS-library-relevant patterns: `node_modules/`, `dist`, `coverage/`, `*.log`, `.env`, `.idea/`, `*.tsbuildinfo`, `.npm`, `.eslintcache`. Missing OS-file patterns: no `.DS_Store` and no `Thumbs.db`. |

## Scoring

- Weights: critical=3, high=2
- SEC-01 PASS (crit) → 0
- SEC-02 FAIL (crit) → -3
- SEC-03 SKIP → excluded from max
- SEC-04 PASS (crit) → 0
- SEC-05 WARN (high) → -1 (half of 2)
- Max = 3+3+3+2 = 11; Deductions = 4
- Score = (11 - 4) / 11 × 100 = **63.6% → 64%**
- Grade: **C** (60-74)

## Key Remediations

1. **SEC-02 (critical):** Add `PreToolUse` hooks in `.claude/settings.json` that deny Read/Glob/Bash access to sensitive patterns (`.env`, `*.pem`, `*.key`, `credentials*`, `secrets*`, `*secret*`, `*.p12`, `*.pfx`). Currently the Claude agent can freely read any credential file that might be dropped into the repo.
2. **SEC-05 (high):** Append OS-specific patterns to `.gitignore` (`.DS_Store`, `Thumbs.db`). macOS/Windows developer environments can otherwise leak these files into commits.
3. **SEC-01 (nit):** Consider broadening env coverage to `.env.local`, `.env.*.local` for future-proofing, even though no env usage exists today.
