#!/usr/bin/env bash

set -euo pipefail

NANI_ROOT="${NANI_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
NANI_CACHE_DIR="${NANI_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/nani-translate-linux}"
NANI_BUILD_DIR="${NANI_BUILD_DIR:-$NANI_ROOT/build}"
NANI_OUTPUT_DIR="${NANI_OUTPUT_DIR:-$NANI_ROOT/nani-app}"
NANI_MANIFEST_URL="${NANI_MANIFEST_URL:-https://nani-desktop.kiok.jp/artifacts/latest-mac.yml}"

log() {
  printf '[nani] %s\n' "$*" >&2
}

die() {
  printf '[nani] error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

require_linux_x64() {
  [ "$(uname -s)" = Linux ] || die "only Linux is supported"
  case "$(uname -m)" in
    x86_64|amd64) ;;
    *) die "only x86_64 is supported" ;;
  esac
}

seven_zip_command() {
  if command -v 7zz >/dev/null 2>&1; then
    printf '%s\n' 7zz
  elif command -v 7z >/dev/null 2>&1; then
    printf '%s\n' 7z
  else
    die "required command not found: 7zz or 7z"
  fi
}

sha512_base64() {
  require_command node
  node "$NANI_ROOT/scripts/lib/build-metadata.mjs" sha512 "$1"
}

sha256_hex() {
  require_command sha256sum
  sha256sum "$1" | awk '{print $1}'
}

download_file() {
  local url="$1"
  local destination="$2"
  local expected_sha256="${3:-}"
  local part="${destination}.part"

  case "$url" in
    https://*) ;;
    *) die "refusing non-HTTPS download: $url" ;;
  esac

  require_command curl
  mkdir -p "$(dirname "$destination")"

  if [ -f "$destination" ]; then
    if [ -z "$expected_sha256" ] || [ "$(sha256_hex "$destination")" = "$expected_sha256" ]; then
      log "using cached $(basename "$destination")"
      return 0
    fi
    log "cached checksum mismatch; downloading again"
    rm -f -- "$destination"
  fi

  rm -f -- "$part"
  if ! curl --fail --location --retry 3 --retry-delay 1 --output "$part" "$url"; then
    rm -f -- "$part"
    die "download failed: $url"
  fi

  if [ -n "$expected_sha256" ] && [ "$(sha256_hex "$part")" != "$expected_sha256" ]; then
    rm -f -- "$part"
    die "SHA-256 mismatch for $(basename "$destination")"
  fi

  mv -f -- "$part" "$destination"
}

write_build_info() {
  local destination="$1"
  local version="$2"
  local electron_version="$3"
  local source_url="$4"
  local source_sha512="$5"

  {
    printf 'version=%s\n' "$version"
    printf 'electron_version=%s\n' "$electron_version"
    printf 'source_url=%s\n' "$source_url"
    printf 'source_sha512=%s\n' "$source_sha512"
  } >"$destination"
}
