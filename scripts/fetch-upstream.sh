#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_linux_x64
require_command node

if [ -n "${NANI_DMG_PATH:-}" ]; then
  [ -f "$NANI_DMG_PATH" ] || die "NANI_DMG_PATH does not exist: $NANI_DMG_PATH"
  dmg_path="$(cd "$(dirname "$NANI_DMG_PATH")" && pwd)/$(basename "$NANI_DMG_PATH")"
  actual_sha512="$(sha512_base64 "$dmg_path")"
  if [ -n "${NANI_DMG_SHA512:-}" ] && [ "$actual_sha512" != "$NANI_DMG_SHA512" ]; then
    die "SHA-512 mismatch for local DMG"
  fi
  printf '%s\t%s\t%s\t%s\n' "${NANI_VERSION:-local}" "file://$dmg_path" "$actual_sha512" "$dmg_path"
  exit 0
fi

mkdir -p "$NANI_CACHE_DIR/manifests" "$NANI_CACHE_DIR/dmg"
manifest_path="$NANI_CACHE_DIR/manifests/latest-mac.yml"
manifest_part="${manifest_path}.part"

require_command curl
rm -f -- "$manifest_part"
if ! curl --fail --location --retry 3 --retry-delay 1 --output "$manifest_part" "$NANI_MANIFEST_URL"; then
  rm -f -- "$manifest_part"
  die "failed to download upstream manifest"
fi
mv -f -- "$manifest_part" "$manifest_path"

IFS=$'\t' read -r version dmg_url expected_sha512 filename < <(
  node "$SCRIPT_DIR/lib/resolve-upstream.mjs" "$manifest_path" "$NANI_MANIFEST_URL"
)
[ -n "$version" ] && [ -n "$dmg_url" ] && [ -n "$expected_sha512" ] && [ -n "$filename" ] || \
  die "upstream manifest resolver returned incomplete data"

cache_key="$(printf '%s' "${expected_sha512:0:16}" | tr '/+' '_-')"
dmg_path="$NANI_CACHE_DIR/dmg/${version}-${cache_key}-$filename"
if [ -f "$dmg_path" ] && [ "$(sha512_base64 "$dmg_path")" = "$expected_sha512" ]; then
  log "using cached $filename"
else
  rm -f -- "$dmg_path" "${dmg_path}.part"
  log "downloading Nani $version"
  if ! curl --fail --location --retry 3 --retry-delay 1 --output "${dmg_path}.part" "$dmg_url"; then
    rm -f -- "${dmg_path}.part"
    die "failed to download upstream DMG"
  fi
  if [ "$(sha512_base64 "${dmg_path}.part")" != "$expected_sha512" ]; then
    rm -f -- "${dmg_path}.part"
    die "SHA-512 mismatch for upstream DMG"
  fi
  mv -f -- "${dmg_path}.part" "$dmg_path"
fi

printf '%s\t%s\t%s\t%s\n' "$version" "$dmg_url" "$expected_sha512" "$dmg_path"
