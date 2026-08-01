#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

command -v npm >/dev/null 2>&1 || {
  printf '[nani] error: required command not found: npm\n' >&2
  exit 1
}

exec make bootstrap
