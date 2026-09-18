#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_linux_x64
for command in curl node npm unzip tar; do
  require_command "$command"
done
seven_zip_command >/dev/null

report_dir="${NANI_REPORT_DIR:-$NANI_ROOT/dist/reports}"
mkdir -p "$NANI_BUILD_DIR" "$report_dir" "$(dirname "$NANI_OUTPUT_DIR")"
lock_dir="${NANI_OUTPUT_DIR}.lock"
mkdir "$lock_dir" 2>/dev/null || die "another build appears to be running: $lock_dir"

work_dir="$(mktemp -d "$NANI_BUILD_DIR/nani-build.XXXXXX")"
candidate="${NANI_OUTPUT_DIR}.candidate.$$"
backup="${NANI_OUTPUT_DIR}.previous.$$"

cleanup() {
  status=$?
  rm -rf -- "$candidate" "$backup" "$lock_dir"
  if [ "${NANI_KEEP_WORKDIR:-0}" = 1 ]; then
    log "keeping work directory: $work_dir"
  else
    rm -rf -- "$work_dir"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

auto_patch_candidate() {
  [ "${NANI_AUTOPATCHELF:-0}" = 1 ] || return 0
  require_command auto-patchelf
  local search_path="${NANI_AUTOPATCHELF_LIBRARY_PATH:-${LD_LIBRARY_PATH:-}}"
  [ -n "$search_path" ] || die "NANI_AUTOPATCHELF requires a library search path"
  local library_paths=()
  IFS=: read -r -a library_paths <<<"$search_path"
  local arguments=(--preserve-origin --paths "$candidate" --libs "${library_paths[@]}")
  if [ -n "${NANI_AUTOPATCHELF_APPEND_RPATHS:-}" ]; then
    local append_paths=()
    IFS=: read -r -a append_paths <<<"$NANI_AUTOPATCHELF_APPEND_RPATHS"
    arguments+=(--append-rpaths "${append_paths[@]}")
  fi
  auto-patchelf "${arguments[@]}"
}

printf '{"status":"not-run"}\n' >"$report_dir/patch-report.json"

log "resolving upstream release"
IFS=$'\t' read -r version source_url source_sha512 dmg_path < <("$SCRIPT_DIR/fetch-upstream.sh")
if [ -z "$version" ] || [ ! -f "$dmg_path" ]; then
  die "fetch-upstream returned incomplete data"
fi
node "$SCRIPT_DIR/lib/build-metadata.mjs" write-upstream-report \
  "$report_dir/upstream.json" "$version" "$source_url" "$source_sha512" "$dmg_path"

log "extracting Nani.app"
app_path="$("$SCRIPT_DIR/extract-dmg.sh" "$dmg_path" "$work_dir/dmg")"
upstream_resources="$app_path/Contents/Resources"
upstream_asar="$upstream_resources/app.asar"
[ -f "$upstream_asar" ] || die "upstream app.asar was not found"

electron_version="$(node "$SCRIPT_DIR/lib/build-metadata.mjs" electron-version "$app_path")"
electron_filename="electron-v${electron_version}-linux-x64.zip"
electron_base="https://github.com/electron/electron/releases/download/v${electron_version}"
electron_cache="$NANI_CACHE_DIR/electron/$electron_version"
mkdir -p "$electron_cache"

if [ -n "${NANI_ELECTRON_ZIP_PATH:-}" ]; then
  [ -f "$NANI_ELECTRON_ZIP_PATH" ] || \
    die "NANI_ELECTRON_ZIP_PATH does not exist: $NANI_ELECTRON_ZIP_PATH"
  electron_zip="$NANI_ELECTRON_ZIP_PATH"
else
  download_file "$electron_base/SHASUMS256.txt" "$electron_cache/SHASUMS256.txt"
  electron_sha256="$(awk -v wanted="$electron_filename" '{ name=$2; sub(/^\*/, "", name); if (name == wanted) print $1 }' "$electron_cache/SHASUMS256.txt")"
  [ "$(printf '%s\n' "$electron_sha256" | grep -Ec '^[0-9a-f]{64}$')" -eq 1 ] || \
    die "could not find a unique SHA-256 for $electron_filename"
  electron_zip="$electron_cache/$electron_filename"
  download_file "$electron_base/$electron_filename" "$electron_zip" "$electron_sha256"
fi

mkdir -p "$candidate"
unzip -q "$electron_zip" -d "$candidate"
[ -x "$candidate/electron" ] || die "Electron archive did not contain the electron executable"

rm -f -- "$candidate/resources/default_app.asar"
cp -a -- "$upstream_asar" "$candidate/resources/app.asar"
if [ -d "$upstream_resources/app.asar.unpacked" ]; then
  cp -a -- "$upstream_resources/app.asar.unpacked" "$candidate/resources/app.asar.unpacked"
else
  mkdir -p "$candidate/resources/app.asar.unpacked"
fi

icon_source="$upstream_resources/app.asar.unpacked/resources/icon.png"
[ -f "$icon_source" ] || die "upstream app has no resources/icon.png"
cp -a -- "$icon_source" "$candidate/resources/icon.png"

[ -f "$SCRIPT_DIR/patch-asar.mjs" ] || die "missing scripts/patch-asar.mjs"
sqlite_version="$(node "$SCRIPT_DIR/lib/build-metadata.mjs" sqlite-version "$candidate/resources/app.asar")"
auto_patch_candidate
electron_abi="$(ELECTRON_RUN_AS_NODE=1 "$candidate/electron" -p 'process.versions.modules')"
case "$electron_abi" in
  ''|*[!0-9]*) die "could not determine Electron Node ABI" ;;
esac

if [ -n "${NANI_SQLITE_BINARY_PATH:-}" ]; then
  [ -f "$NANI_SQLITE_BINARY_PATH" ] || \
    die "NANI_SQLITE_BINARY_PATH does not exist: $NANI_SQLITE_BINARY_PATH"
  sqlite_source="$NANI_SQLITE_BINARY_PATH"
else
  for command in python3 make c++; do
    require_command "$command"
  done
  sqlite_package="$NANI_ROOT/node_modules/better-sqlite3"
  [ -f "$sqlite_package/package.json" ] || die "run npm ci to install better-sqlite3 sources"
  installed_sqlite_version="$(node -p "require(process.argv[1]).version" "$sqlite_package/package.json")"
  [ "$installed_sqlite_version" = "$sqlite_version" ] || \
    die "better-sqlite3 source version mismatch: expected $sqlite_version, got $installed_sqlite_version"

  sqlite_dependencies="$work_dir/node_modules"
  sqlite_build="$sqlite_dependencies/better-sqlite3"
  node_addon_api="$NANI_ROOT/node_modules/node-addon-api"
  [[ -f "$node_addon_api/package.json" ]] || die "node-addon-api package not found: $node_addon_api"

  mkdir -p -- "$sqlite_dependencies"
  cp -a -- "$sqlite_package" "$sqlite_build"
  cp -a -- "$node_addon_api" "$sqlite_dependencies/node-addon-api"
  npm_config_target="$electron_version"
  npm_config_disturl="https://electronjs.org/headers"
  if [ -n "${NANI_ELECTRON_HEADERS_PATH:-}" ]; then
    [ -f "$NANI_ELECTRON_HEADERS_PATH" ] || \
      die "NANI_ELECTRON_HEADERS_PATH does not exist: $NANI_ELECTRON_HEADERS_PATH"
    headers_dir="$work_dir/electron-headers"
    mkdir -p "$headers_dir"
    tar -xzf "$NANI_ELECTRON_HEADERS_PATH" -C "$headers_dir"
    npm_config_nodedir="$headers_dir/node_headers"
  fi
  log "building better-sqlite3 $sqlite_version for Electron $electron_version (ABI $electron_abi)"
  (
    export npm_config_target npm_config_disturl
    [ -z "${npm_config_nodedir:-}" ] || export npm_config_nodedir
    cd "$sqlite_build"
    npm run build-release
  )
  sqlite_source="$sqlite_build/build/Release/better_sqlite3.node"
fi
[ -f "$sqlite_source" ] || die "better-sqlite3 build did not produce better_sqlite3.node"
native_replacements="$work_dir/native-replacements"
sqlite_replacement="$native_replacements/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
mkdir -p "$(dirname "$sqlite_replacement")"
cp -a -- "$sqlite_source" "$sqlite_replacement"
sqlite_prebuild="$native_replacements/node_modules/better-sqlite3/prebuilds/linux-x64.node"
mkdir -p "$(dirname "$sqlite_prebuild")"
cp -a -- "$sqlite_source" "$sqlite_prebuild"

log "patching upstream ASAR"
node "$SCRIPT_DIR/patch-asar.mjs" \
  --asar "$candidate/resources/app.asar" \
  --unpacked "$candidate/resources/app.asar.unpacked" \
  --report "$report_dir/patch-report.json" \
  --native-replacements "$native_replacements"
cp -a -- "$report_dir/patch-report.json" "$candidate/patch-report.json"

auto_patch_candidate
node "$SCRIPT_DIR/lib/build-metadata.mjs" check-native "$candidate/resources/app.asar.unpacked"

if [ -f "$NANI_ROOT/runtime/start.sh.template" ]; then
  cp -a -- "$NANI_ROOT/runtime/start.sh.template" "$candidate/start.sh"
  chmod +x "$candidate/start.sh"
fi

write_build_info "$candidate/build-info.env" "$version" "$electron_version" "$source_url" "$source_sha512"
cp -a -- "$candidate/build-info.env" "$report_dir/build-info.env"

if [ -e "$NANI_OUTPUT_DIR" ]; then
  mv -- "$NANI_OUTPUT_DIR" "$backup"
fi
if ! mv -- "$candidate" "$NANI_OUTPUT_DIR"; then
  [ ! -e "$backup" ] || mv -- "$backup" "$NANI_OUTPUT_DIR"
  die "failed to promote build candidate"
fi
rm -rf -- "$backup"
log "built Nani $version with Electron $electron_version at $NANI_OUTPUT_DIR"
