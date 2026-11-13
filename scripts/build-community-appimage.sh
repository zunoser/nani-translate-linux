#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="${1:-$root/nani-community-app}"
[[ -f "$source_dir/community-build.json" ]] || { echo 'Community build required' >&2; exit 1; }
source_dir="$(cd "$source_dir" && pwd)"
output="${2:-$root/dist/Nani-Community-1.1.15-x86_64.AppImage}"
mkdir -p "$(dirname "$output")" "$root/build"
output="$(cd "$(dirname "$output")" && pwd)/$(basename "$output")"
work="$(mktemp -d "$root/build/community-appimage.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
appdir="$work/Nani-Community.AppDir"
runtime="$appdir/usr/lib/nani-community"
mkdir -p "$runtime" "$appdir/usr/bin" "$appdir/usr/share/applications" "$appdir/usr/share/icons/hicolor/512x512/apps"
cp -a "$source_dir/." "$runtime/"
cp "$runtime/start.sh" "$runtime/nani-community"
install -m 0644 "$root/runtime/nani-community.desktop.template" "$appdir/usr/share/applications/nani-community.desktop"
install -m 0644 "$source_dir/resources/icon.png" "$appdir/usr/share/icons/hicolor/512x512/apps/nani-community.png"
ln -s usr/lib/nani-community/nani-community "$appdir/AppRun"
ln -s ../lib/nani-community/nani-community "$appdir/usr/bin/nani-community"
ln -s usr/share/applications/nani-community.desktop "$appdir/nani-community.desktop"
ln -s usr/share/icons/hicolor/512x512/apps/nani-community.png "$appdir/nani-community.png"
ARCH=x86_64 VERSION=1.1.15 "${APPIMAGETOOL:-appimagetool}" "$appdir" "$output"
printf 'created %s\n' "$output"
