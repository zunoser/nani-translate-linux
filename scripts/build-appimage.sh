#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_linux_x64

app_source="${1:-$NANI_OUTPUT_DIR}"
[ -d "$app_source" ] || die "application directory does not exist: $app_source"

for required in \
  electron \
  resources/app.asar \
  resources/icon.png \
  patch-report.json \
  build-info.env; do
  [ -e "$app_source/$required" ] || die "application artifact is missing: $required"
done
[ -x "$app_source/electron" ] || die "Electron executable is not executable"

appimagetool="${APPIMAGETOOL:-appimagetool}"
require_command "$appimagetool"

version="$(sed -n 's/^version=//p' "$app_source/build-info.env" | head -n 1)"
[ -n "$version" ] || die "build-info.env does not contain a version"

output="${2:-$NANI_ROOT/dist/Nani-${version}-x86_64.AppImage}"
mkdir -p "$(dirname "$output")" "$NANI_BUILD_DIR"
output="$(cd "$(dirname "$output")" && pwd)/$(basename "$output")"

work_dir="$(mktemp -d "$NANI_BUILD_DIR/appimage.XXXXXX")"
trap 'rm -rf -- "$work_dir"' EXIT
app_dir="$work_dir/Nani.AppDir"
runtime_dir="$app_dir/usr/lib/nani"

mkdir -p \
  "$runtime_dir" \
  "$app_dir/usr/bin" \
  "$app_dir/usr/share/applications" \
  "$app_dir/usr/share/icons/hicolor/512x512/apps"
cp -a "$app_source/." "$runtime_dir/"
install -m 0755 "$NANI_ROOT/runtime/start.sh.template" "$runtime_dir/nani"
install -m 0644 "$NANI_ROOT/runtime/nani.desktop.template" \
  "$app_dir/usr/share/applications/nani.desktop"
install -m 0644 "$app_source/resources/icon.png" \
  "$app_dir/usr/share/icons/hicolor/512x512/apps/nani.png"
ln -s usr/lib/nani/nani "$app_dir/AppRun"
ln -s ../lib/nani/nani "$app_dir/usr/bin/nani"
ln -s usr/share/applications/nani.desktop "$app_dir/nani.desktop"
ln -s usr/share/icons/hicolor/512x512/apps/nani.png "$app_dir/nani.png"

log "building Nani $version AppImage"
ARCH=x86_64 VERSION="$version" "$appimagetool" "$app_dir" "$output"
log "created $output"
