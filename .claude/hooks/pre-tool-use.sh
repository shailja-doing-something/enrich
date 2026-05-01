#!/bin/bash
# PreToolUse hook: intercepts git commit Bash calls and runs pre-commit checks.
# Receives tool call JSON on stdin; blocks the commit if checks fail.

input=$(cat)
command=$(python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('tool_input', {}).get('command', ''))
" <<< "$input" 2>/dev/null || echo "")

if [[ "$command" == git\ commit* ]]; then
  bash "$(dirname "$0")/pre-commit.sh"
fi
