#!/bin/bash
# Pre-commit hook: runs tests and lint before every commit.
# If either fails, the commit is blocked — no exceptions.

set -e

echo "Running pre-commit checks..."

# 1. Run tests
echo "→ Running test suite..."
npm run test
if [ $? -ne 0 ]; then
  echo "BLOCKED: Tests failed. Fix all test failures before committing."
  exit 1
fi

# 2. Run lint
echo "→ Running lint..."
npm run lint
if [ $? -ne 0 ]; then
  echo "BLOCKED: Lint errors found. Fix all lint errors before committing."
  exit 1
fi

echo "Pre-commit checks passed. Proceeding with commit."
exit 0
