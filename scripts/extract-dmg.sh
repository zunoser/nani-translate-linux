#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

[ "$#" -eq 2 ] || die "usage: extract-dmg.sh DMG DESTINATION"
dmg_path="$1"
destination="$2"
[ -f "$dmg_path" ] || die "DMG does not exist: $dmg_path"

seven_zip="$(seven_zip_command)"
mkdir -p "$destination"
if ! "$seven_zip" x -y "-o$destination" "$dmg_path" >/dev/null; then
  log "7-Zip reported a DMG/HFS warning; validating extracted contents"
fi

app_path="$(find "$destination" -type d -name Nani.app -print -quit)"
[ -n "$app_path" ] || die "Nani.app was not found in the DMG"
[ -f "$app_path/Contents/Info.plist" ] || die "extracted Nani.app is incomplete"
[ -f "$app_path/Contents/Resources/app.asar" ] || die "extracted Nani.app has no app.asar"
printf '%s\n' "$app_path"
