#!/usr/bin/env bash
set -euo pipefail
# This job runs separately from building upstream code and only commits pin data.
node --input-type=module - <<'NODE'
import fs from 'node:fs';
import { validateRelease } from './scripts/lib/releases.mjs';
const pins = JSON.parse(fs.readFileSync('watchdog-diagnostics/verified-pins.json', 'utf8'));
validateRelease(pins);
const v = pins.electron?.version;
if (!/^\d+\.\d+\.\d+$/.test(v ?? '')) throw new Error('Invalid Electron version');
for (const [kind, url] of Object.entries({
  zip: `https://github.com/electron/electron/releases/download/v${v}/electron-v${v}-linux-x64.zip`,
  headers: `https://electronjs.org/headers/v${v}/node-v${v}-headers.tar.gz`,
})) {
  if (pins.electron[kind]?.url !== url || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(pins.electron[kind]?.sri ?? '')) throw new Error('Invalid Electron pin');
}
if (!/^sha256-[A-Za-z0-9+/]{43}=$/.test(pins.dmg.sri ?? '')) throw new Error('Invalid DMG pin');
fs.writeFileSync('nix/upstream-nani.json', JSON.stringify(pins, null, 2) + '\n');
NODE
if git diff --quiet -- nix/upstream-nani.json; then exit 0; fi
current_main="$(gh api "repos/$GITHUB_REPOSITORY/commits/main" --jq .sha)"
[ "$current_main" = "$GITHUB_SHA" ] || { echo 'Main changed; next watchdog run will recheck the candidate.'; exit 0; }
version="$(node -p 'JSON.parse(require("node:fs").readFileSync("nix/upstream-nani.json")).version')"
# GitHub couples token-created PRs to this repository setting. Do not turn a
# disabled optional publishing capability into a failed watchdog every day.
if ! allow_pr="$(gh api "repos/$GITHUB_REPOSITORY/actions/permissions/workflow" --jq .can_approve_pull_request_reviews)"; then
  echo 'Could not inspect PR creation permissions; verified pins remain in the diagnostic artifact.' >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi
if [ "$allow_pr" != true ]; then
  echo 'Verified update ready. To enable automatic update PRs, enable "Allow GitHub Actions to create and approve pull requests" in Settings → Actions → General. Pins are available in the watchdog-diagnostics artifact.' >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi
branch="automation/nani-upstream"
remote_head="$(git ls-remote --heads origin "refs/heads/$branch" | cut -f1)"
reuse=false
if [ -n "$remote_head" ]; then
  git fetch origin "$branch"
  [ "$(git log -1 --format=%ae FETCH_HEAD)" = '41898282+github-actions[bot]@users.noreply.github.com' ]
  [ "$(git diff-tree --no-commit-id --name-only -r FETCH_HEAD)" = 'nix/upstream-nani.json' ]
  if [ "$(git rev-parse FETCH_HEAD^)" = "$GITHUB_SHA" ] && git show FETCH_HEAD:nix/upstream-nani.json | cmp -s - nix/upstream-nani.json; then
    reuse=true
  fi
fi
if [ "$reuse" = false ]; then
  git switch -c "$branch"
  git config user.name 'github-actions[bot]'
  git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
  git add nix/upstream-nani.json
  git commit -m "Update verified Nani to $version"
  gh auth setup-git
  git push "--force-with-lease=refs/heads/$branch:$remote_head" origin "HEAD:$branch"
fi
body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT
cat > "$body_file" <<'BODY'
Update the Nani DMG and its matching Electron runtime and headers together.

The watchdog built this exact DMG and verified the required patches and repacked payload. CI checks the pinned Nix build before this update is accepted. The running installation is unchanged until the update is merged and installed.
BODY
existing="$(gh pr list --head "$GITHUB_REPOSITORY_OWNER:$branch" --base main --state open --json url --jq '.[0].url // empty')"
if [ -n "$existing" ]; then
  if [ "$reuse" = false ]; then gh pr edit "$existing" --title "Update verified Nani to $version" --body-file "$body_file"; fi
else
  gh pr create --base main --head "$branch" --title "Update verified Nani to $version" --body-file "$body_file"
fi
# GITHUB_TOKEN-created PRs do not automatically trigger pull_request workflows.
head_sha="$(git ls-remote --heads origin "refs/heads/$branch" | cut -f1)"
ci_runs="$(gh run list --workflow ci.yml --branch "$branch" --event workflow_dispatch --limit 20 --json headSha --jq "[.[] | select(.headSha == \"$head_sha\")] | length")"
if [ "$ci_runs" -eq 0 ]; then gh workflow run ci.yml --ref "$branch"; fi
