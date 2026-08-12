#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

desktop_template="$NANI_ROOT/runtime/nani.desktop.template"
launcher="$NANI_OUTPUT_DIR/start.sh"
icon="$NANI_OUTPUT_DIR/resources/icon.png"
data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
bin_home="${NANI_BIN_DIR:-$HOME/.local/bin}"
desktop_dir="$data_home/applications"
icon_dir="$data_home/icons/hicolor/512x512/apps"
desktop_file="$desktop_dir/nani.desktop"
bin_link="$bin_home/nani"

[ -f "$desktop_template" ] || die "desktop template not found: $desktop_template"
[ -x "$launcher" ] || die "launcher not found; run just bootstrap first"
[ -f "$icon" ] || die "application icon not found; run just bootstrap first"
require_command update-desktop-database
case "$bin_link" in
  *[[:space:]]*) die "launcher path contains whitespace: $bin_link" ;;
esac

mkdir -p "$bin_home" "$desktop_dir" "$icon_dir"
ln -sfn -- "$launcher" "$bin_link"
install -m 0644 "$icon" "$icon_dir/nani.png"

desktop_part="${desktop_file}.part"
awk -v launcher="$bin_link" '
  /^Exec=/ { print "Exec=" launcher " %U"; next }
  { print }
' "$desktop_template" >"$desktop_part"
chmod 0644 "$desktop_part"
mv -f -- "$desktop_part" "$desktop_file"

update-desktop-database "$desktop_dir"
if command -v xdg-mime >/dev/null 2>&1; then
  mimeapps_file="${XDG_CONFIG_HOME:-$HOME/.config}/mimeapps.list"
  if [ ! -e "$mimeapps_file" ] || [ -w "$(readlink -f -- "$mimeapps_file")" ]; then
    xdg-mime default nani.desktop x-scheme-handler/naniapp
  else
    log "mimeapps.list is managed read-only; using the desktop MIME cache association"
  fi
fi

log "installed desktop entry: $desktop_file"
