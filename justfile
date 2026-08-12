set shell := ["bash", "-euo", "pipefail", "-c"]

# Show available recipes.
default:
    @just --list

# Install Node dependencies.
deps:
    @if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Install dependencies and build nani-app.
bootstrap: deps build-app

# Resolve and fetch the current upstream DMG.
fetch: deps
    @./scripts/fetch-upstream.sh

# Analyze the current upstream DMG.
analyze: deps
    #!/usr/bin/env bash
    set -euo pipefail
    test -f scripts/analyze-upstream.mjs || { echo 'missing scripts/analyze-upstream.mjs' >&2; exit 1; }
    mkdir -p build dist/reports
    work="$(mktemp -d build/nani-analysis.XXXXXX)"
    trap 'rm -rf -- "$work"' EXIT
    IFS=$'\t' read -r version url sha dmg < <(./scripts/fetch-upstream.sh)
    app="$(./scripts/extract-dmg.sh "$dmg" "$work/dmg")"
    node scripts/analyze-upstream.mjs --app "$app" --dmg "$dmg" --output dist/reports/upstream-analysis.json
    printf 'analyzed Nani %s: %s\n' "$version" dist/reports/upstream-analysis.json

# Build nani-app from the latest official DMG.
build-app:
    @./scripts/build-app.sh

# Run an existing nani-app build.
run:
    @test -x nani-app/start.sh || { echo 'run just bootstrap first' >&2; exit 1; }
    @./nani-app/start.sh

# Rebuild from the current upstream release.
update: deps build-app

# Build an AppImage from nani-app.
appimage:
    @test -x scripts/build-appimage.sh || { echo 'missing scripts/build-appimage.sh' >&2; exit 1; }
    @./scripts/build-appimage.sh

# Install the desktop entry for this user.
install-desktop:
    @test -x scripts/install-desktop.sh || { echo 'missing scripts/install-desktop.sh' >&2; exit 1; }
    @./scripts/install-desktop.sh

# Check Bash syntax.
check-shell:
    @bash -n install.sh scripts/*.sh scripts/lib/*.sh runtime/start.sh.template

# Run syntax and project tests.
test: check-shell
    @npm test

# Remove generated build outputs.
clean:
    @rm -rf -- build nani-app
