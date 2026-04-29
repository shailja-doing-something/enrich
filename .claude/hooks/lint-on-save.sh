#!/bin/bash
# Lint-on-save hook: runs ESLint on the file being saved.
# Pass the file path as $1 from your editor integration.
# Non-zero exit means lint errors — editor should surface them inline.

set -e

FILE="$1"

if [ -z "$FILE" ]; then
  echo "Usage: lint-on-save.sh <file-path>"
  exit 1
fi

# Only lint TypeScript/TSX files
if [[ "$FILE" != *.ts && "$FILE" != *.tsx ]]; then
  exit 0
fi

echo "Linting $FILE..."
npx eslint "$FILE" --max-warnings=0

if [ $? -ne 0 ]; then
  echo "Lint errors in $FILE — fix before saving or committing."
  exit 1
fi

exit 0
