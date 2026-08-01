import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const launcher = path.join(root, "runtime/start.sh.template");

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "nani-runtime-test-"));
  const app = path.join(directory, "app");
  const cache = path.join(directory, "cache");
  const argumentsFile = path.join(directory, "arguments");
  const launcherPathFile = path.join(directory, "launcher-path");
  mkdirSync(path.join(app, "resources"), { recursive: true });
  writeFileSync(path.join(app, "electron"), "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\" >\"$ARGUMENTS_FILE\"\nprintf '%s\\n' \"$NANI_LAUNCHER_PATH\" >\"$LAUNCHER_PATH_FILE\"\n");
  chmodSync(path.join(app, "electron"), 0o755);
  return { directory, app, cache, argumentsFile, launcherPathFile };
}

function runLauncher(setup, args = [], environment = {}) {
  execFileSync("bash", [launcher, ...args], {
    env: {
      ...process.env,
      DISPLAY: "",
      WAYLAND_DISPLAY: "",
      NANI_APP_DIR: setup.app,
      XDG_CACHE_HOME: setup.cache,
      ARGUMENTS_FILE: setup.argumentsFile,
      LAUNCHER_PATH_FILE: setup.launcherPathFile,
      ...environment,
    },
  });
  return readFileSync(setup.argumentsFile, "utf8").trim().split("\n").filter(Boolean);
}

test("launcher selects X11 when both display servers are available", () => {
  const setup = fixture();
  assert.deepEqual(runLauncher(setup, [], { DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0" }), [
    "--ozone-platform=x11",
  ]);
});

test("explicit ozone CLI argument wins and URL arguments pass through", () => {
  const setup = fixture();
  const url = "https://example.com/translate?q=hello";
  assert.deepEqual(runLauncher(setup, ["--ozone-platform=wayland", url]), [
    "--ozone-platform=wayland",
    url,
  ]);
});

test("launcher limits optional CDP to localhost", () => {
  const setup = fixture();
  assert.deepEqual(runLauncher(setup, [], { NANI_CDP_PORT: "9222" }), [
    "--ozone-platform=x11",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=9222",
  ]);
});

test("launcher exports a canonical local path and prefers the host AppImage path", () => {
  const setup = fixture();
  runLauncher(setup);
  assert.equal(readFileSync(setup.launcherPathFile, "utf8").trim(), launcher);

  const appImage = path.join(setup.directory, "Nani.AppImage");
  writeFileSync(appImage, "image");
  runLauncher(setup, [], { APPIMAGE: appImage });
  assert.equal(readFileSync(setup.launcherPathFile, "utf8").trim(), appImage);
});

test("launcher rejects invalid platform and CDP settings", () => {
  const setup = fixture();
  assert.throws(() => runLauncher(setup, [], { NANI_OZONE_PLATFORM: "invalid" }));
  assert.throws(() => runLauncher(setup, [], { NANI_CDP_PORT: "70000" }));
});

test("AppImage payload is staged under usr/lib/nani", () => {
  const setup = fixture();
  writeFileSync(path.join(setup.app, "resources/app.asar"), "asar");
  writeFileSync(path.join(setup.app, "resources/icon.png"), "png");
  writeFileSync(path.join(setup.app, "patch-report.json"), "{}\n");
  writeFileSync(path.join(setup.app, "build-info.env"), "version=1.2.3\n");

  const tool = path.join(setup.directory, "appimagetool");
  const captured = path.join(setup.directory, "AppDir");
  writeFileSync(tool, `#!/usr/bin/env bash\ncp -a \"$1\" ${JSON.stringify(captured)}\nprintf image >\"$2\"\n`);
  chmodSync(tool, 0o755);
  const output = path.join(setup.directory, "Nani.AppImage");
  execFileSync("bash", [path.join(root, "scripts/build-appimage.sh"), setup.app, output], {
    env: { ...process.env, APPIMAGETOOL: tool, NANI_BUILD_DIR: path.join(setup.directory, "build") },
  });

  assert.equal(existsSync(output), true);
  assert.equal(existsSync(path.join(captured, "usr/lib/nani/electron")), true);
  assert.equal(existsSync(path.join(captured, "usr/lib/nani/resources/app.asar")), true);
  assert.equal(existsSync(path.join(captured, "usr/lib/nani/patch-report.json")), true);
  assert.equal(readFileSync(path.join(captured, "usr/bin/nani"), "utf8"), readFileSync(path.join(captured, "usr/lib/nani/nani"), "utf8"));
});
