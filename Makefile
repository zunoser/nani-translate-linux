SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

.PHONY: help deps bootstrap fetch analyze build-app run update appimage install-desktop check-shell test clean

help:
	@printf '%s\n' \
	  'make bootstrap       Install Node dependencies and build nani-app' \
	  'make analyze         Analyze the current upstream DMG' \
	  'make build-app       Build nani-app from the latest official DMG' \
	  'make run             Run an existing nani-app build' \
	  'make update          Rebuild from the current upstream release' \
	  'make appimage        Build an AppImage from nani-app' \
	  'make install-desktop Install the desktop entry for this user' \
	  'make test            Run syntax and project tests'

deps:
	@if [ -f package-lock.json ]; then npm ci; else npm install; fi

bootstrap: deps build-app

fetch: deps
	@./scripts/fetch-upstream.sh

analyze: deps
	@test -f scripts/analyze-upstream.mjs || { echo 'missing scripts/analyze-upstream.mjs' >&2; exit 1; }
	@set -euo pipefail; \
	  mkdir -p build dist/reports; \
	  work="$$(mktemp -d build/nani-analysis.XXXXXX)"; \
	  trap 'rm -rf -- "$$work"' EXIT; \
	  IFS=$$'\t' read -r version url sha dmg < <(./scripts/fetch-upstream.sh); \
	  app="$$(./scripts/extract-dmg.sh "$$dmg" "$$work/dmg")"; \
	  node scripts/analyze-upstream.mjs --app "$$app" --dmg "$$dmg" --output dist/reports/upstream-analysis.json; \
	  printf 'analyzed Nani %s: %s\n' "$$version" dist/reports/upstream-analysis.json

build-app:
	@./scripts/build-app.sh

run:
	@test -x nani-app/start.sh || { echo 'run make bootstrap first' >&2; exit 1; }
	@./nani-app/start.sh

update: deps build-app

appimage:
	@test -x scripts/build-appimage.sh || { echo 'missing scripts/build-appimage.sh' >&2; exit 1; }
	@./scripts/build-appimage.sh

install-desktop:
	@test -x scripts/install-desktop.sh || { echo 'missing scripts/install-desktop.sh' >&2; exit 1; }
	@./scripts/install-desktop.sh

check-shell:
	@bash -n install.sh scripts/*.sh scripts/lib/*.sh

test: check-shell
	@npm test

clean:
	@rm -rf -- build nani-app
