#!/usr/bin/env bash
# PreToolUse guardrail — denies Read/Glob/Grep/Bash access to sensitive files.
# Reads tool_input JSON on stdin and greps for patterns; exits 2 to block.

set -u

input=$(cat)

if printf '%s' "$input" | grep -qiE '(\.env(\.[a-z0-9_-]+)?([^a-z0-9_-]|$)|\.pem([^a-z0-9]|$)|\.key([^a-z0-9]|$)|credentials[^a-z0-9_-]|secret[^a-z0-9_-]?|\.p12([^a-z0-9]|$)|\.pfx([^a-z0-9]|$)|id_rsa|id_ed25519|id_ecdsa|\.kubeconfig|service-account[^a-z0-9_-]*\.json)'; then
  echo "Security guardrail: access to sensitive files (.env, *.pem, *.key, credentials*, secrets*, *.p12, *.pfx, SSH keys, kubeconfig, service-account*.json) is blocked by .claude/hooks/block-sensitive.sh" >&2
  exit 2
fi

exit 0
