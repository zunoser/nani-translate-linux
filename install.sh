#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

for command in npm just; do
  command -v "$command" >/dev/null 2>&1 || {
    printf '[nani] error: required command not found: %s\n' "$command" >&2
    exit 1
  }
done

exec just bootstrap
