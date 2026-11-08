# Nani Translate for Linux

Build the official Nani macOS application for Linux x86_64 with a matching
Electron runtime and native SQLite module. This is an unofficial port.

## Build and run

```sh
nix develop
just bootstrap
just run
```

Normal builds and `just update` use the verified version in
`nix/upstream-nani.json`. Nix also pins the matching Electron archive and
headers in that file:

```sh
nix run .
```

To test a newer release without replacing `nani-app`:

```sh
nix develop
just verify-latest
```

The candidate is built at `build/latest-candidate` and smoke-tested using a temporary profile. Required patch failures
reject the candidate before replacing an existing output. Logs and patch
results are in `dist/reports`. To build an exact previously resolved release,
set `NANI_RELEASE_FILE` to a JSON file containing `version` and
`dmg: {url, sha512}`. Local DMG overrides through `NANI_DMG_PATH` remain
available for offline/Nix builds.

## Updates and watchdog

The daily watchdog resolves metadata first. It builds only when the DMG
identity (version, URL, SHA-512) or relevant build/patch code changes. It passes
that exact release to the build; it does not resolve `latest` again midway.

One bot-owned issue, `[watchdog] Upstream compatibility`, stores the result.
Unchanged results produce no issue writes or comments. An incompatible release
keeps the issue open; successful verification closes it. Network failures are
separate from patch failures: artifact-download failures retry on the next two
daily runs, then once a week. The small manifest probe continues daily. Use the
Actions **Run workflow → force** option to retry a known result immediately.
Unexpected workflow/setup failures still fail the Action. A known incompatible
upstream release is a recorded watchdog result, not a fresh failed Action each
day. Diagnostic artifacts are retained for 14 days.

After build verification and an isolated Xvfb/renderer smoke test, the watchdog prepares an update PR with the DMG,
Electron runtime and header pins together. Pin publication runs in a separate
job from the upstream build. CI is explicitly dispatched for bot-created PRs,
and includes the pinned Nix package build. There is no automatic merge or
installation. The repository must permit GitHub Actions to create pull requests
(Settings → Actions → General → Allow GitHub Actions to create and approve
pull requests). If disabled, the workflow saves verified pins in its diagnostic
artifact and records the setup requirement in the job summary without failing
or changing the repository setting.
Previously created watchdog issues are historical; this workflow no longer
adds comments to them.

For a local verified candidate, prepare the same pin update with:

```sh
node scripts/prepare-pins.mjs dist/reports nix/upstream-nani.json
nix flake check
```

## Patch maintenance

Main-process patches bind minified identifiers from API names and surrounding
control flow instead of hard-coding generated variable names. Repeated bindings
must agree, and zero or multiple matches reject the patch. This tolerates
identifier renaming, not arbitrary upstream control-flow changes. Main-bundle
syntax and ASAR/native payload integrity are verified before promotion.

Linux tray, close-to-tray, initial deep-link readiness and disabling the macOS
updater are required. Linux welcome text and XDG autostart are optional: a
failed optional patch is rolled back and recorded, without blocking core use.
The updater's original download/install return contracts are preserved; its
platform predicate excludes Linux.

```sh
just test
# Also test all main patches on an extracted, unmodified upstream bundle:
NANI_TEST_MAIN_BUNDLE=/path/to/out/main/index.js npm test
```

Tests cover renamed identifiers, ambiguous/missing anchors, functional tray,
quit/deep-link/updater/autostart behavior and watchdog state transitions.
Translation/login still require a user account; an isolated startup smoke test
does not verify account-dependent operations.
