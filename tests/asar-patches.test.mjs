import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  prepareExecutablePayloads,
  verifyExecutablePayloads,
  XSEL_RELATIVE_PATH,
} from "../scripts/patch-asar.mjs";

import { normalizeDescriptors, PHASE_MAIN_BUNDLE } from "../scripts/patches/descriptor.mjs";
import disableUpdater, {
  UPDATER_ENABLE_ANCHOR,
  UPDATER_HANDLERS_ANCHOR,
  UPDATER_MARKER,
} from "../scripts/patches/disable-updater.mjs";
import { runPatchDescriptors } from "../scripts/patches/engine.mjs";
import linuxOnboarding, {
  ONBOARDING_ANCHOR,
  verifyLinuxOnboarding,
} from "../scripts/patches/linux-onboarding.mjs";
import linuxTray, { TRAY_ANCHOR, TRAY_MARKER } from "../scripts/patches/linux-tray.mjs";
import ocrStub, { verifyOcrStub } from "../scripts/patches/ocr-stub.mjs";
import pruneNonLinux, {
  NON_LINUX_PAYLOADS,
  verifyNonLinuxHeaderEntries,
  verifyNonLinuxPayloadsAbsent,
} from "../scripts/patches/prune-non-linux.mjs";
import xdgAutostart, {
  AUTOSTART_GET_ANCHOR,
  AUTOSTART_MARKER,
  AUTOSTART_SET_ANCHOR,
} from "../scripts/patches/xdg-autostart.mjs";

function temporaryDirectory(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "nani-asar-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("descriptors have deterministic phase/order and reject duplicate ids", () => {
  const ordered = normalizeDescriptors([
    xdgAutostart,
    disableUpdater,
    linuxTray,
    ocrStub,
    pruneNonLinux,
    linuxOnboarding,
  ]);
  assert.deepEqual(ordered.map(({ id }) => id), [
    "prune-non-linux",
    "ocr-stub",
    "linux-onboarding",
    "linux-tray",
    "disable-updater",
    "xdg-autostart",
  ]);
  assert.throws(() => normalizeDescriptors([linuxTray, linuxTray]), /Duplicate patch descriptor/);
});

test("Nani 1.1.0 semantic anchors apply once and are idempotent", () => {
  let source = [
    UPDATER_ENABLE_ANCHOR,
    TRAY_ANCHOR,
    AUTOSTART_GET_ANCHOR,
    AUTOSTART_SET_ANCHOR,
    UPDATER_HANDLERS_ANCHOR,
  ].join(";");

  for (const descriptor of [linuxTray, disableUpdater, xdgAutostart]) {
    const result = descriptor.apply({ source });
    assert.equal(result.status, "applied");
    source = result.source;
    const again = descriptor.apply({ source });
    assert.equal(again.status, "already-applied");
    assert.equal(again.source, source);
  }
  assert.match(source, new RegExp(TRAY_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, new RegExp(UPDATER_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, new RegExp(AUTOSTART_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, /process\.platform==="linux"\?async\(\)=>!1:xa/);
  assert.match(source, /nativeImage\.createFromPath/);
  assert.match(source, /NANI_LAUNCHER_PATH/);
});

test("required anchor drift is reported and main bundle remains unchanged", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "nani-asar-test-"));
  try {
    const mainBundlePath = path.join(root, "main.js");
    writeFileSync(mainBundlePath, "upstream drift");
    const result = runPatchDescriptors({
      extractedDir: root,
      mainBundlePath,
      descriptors: [linuxTray],
    });
    assert.equal(result.hasRequiredFailure, true);
    assert.equal(result.entries[0].status, "failed-required");
    assert.equal(readFileSync(mainBundlePath, "utf8"), "upstream drift");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("optional anchor drift is fail-soft", (t) => {
  const root = temporaryDirectory(t);
  const mainBundlePath = path.join(root, "main.js");
  writeFileSync(mainBundlePath, "upstream drift");
  const result = runPatchDescriptors({
    extractedDir: root,
    mainBundlePath,
    descriptors: [xdgAutostart],
  });
  assert.equal(result.hasRequiredFailure, false);
  assert.equal(result.entries[0].status, "skipped-optional");
});

test("OCR descriptor installs the loadable Linux package stub", async (t) => {
  const root = temporaryDirectory(t);
  mkdirSync(path.join(root, "node_modules"), { recursive: true });
  assert.equal(ocrStub.apply({ extractedDir: root }).status, "applied");
  assert.equal(ocrStub.apply({ extractedDir: root }).status, "already-applied");
  verifyOcrStub(root);
  const stub = await import(path.join(root, "node_modules/@napi-rs/system-ocr-linux-x64-gnu/index.js"));
  assert.equal(stub.default.OcrAccuracy.Accurate, 1);
  await assert.rejects(stub.default.recognize(), /not supported/);
});

test("Linux onboarding patch updates renderer and all dictionaries", (t) => {
  const root = temporaryDirectory(t);
  const renderer = path.join(root, "out/renderer/assets/index-test.js");
  mkdirSync(path.dirname(renderer), { recursive: true });
  writeFileSync(renderer, ONBOARDING_ANCHOR);
  const translations = {
    en: "Welcome to Nani for Mac!",
    ja: "NaniのMacアプリへようこそ！",
    ko: "Nani Mac 앱에 오신 걸 환영해요!",
    zh: "欢迎来到 Nani 的 Mac 应用！",
  };
  for (const [language, translation] of Object.entries(translations)) {
    const file = path.join(
      root,
      "node_modules/repo-lib/dist/dictionaries/default",
      `${language}.mjs`,
    );
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `welcomeToMacApp:\`${translation}\`,welcomeToWinApp:\`Windows\``);
  }

  assert.equal(linuxOnboarding.apply({ extractedDir: root }).status, "applied");
  assert.doesNotThrow(() => verifyLinuxOnboarding(root));
  assert.equal(linuxOnboarding.apply({ extractedDir: root }).status, "already-applied");
});

test("non-Linux payload pruning is required and idempotent", (t) => {
  const root = temporaryDirectory(t);
  for (const relativePath of NON_LINUX_PAYLOADS) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    if (path.extname(target)) writeFileSync(target, "non-linux");
    else {
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, "payload"), "non-linux");
    }
  }

  const first = pruneNonLinux.apply({ extractedDir: root });
  assert.equal(first.status, "applied");
  assert.match(first.detail, /removed 7/);
  assert.doesNotThrow(() => verifyNonLinuxPayloadsAbsent(root));
  assert.equal(pruneNonLinux.apply({ extractedDir: root }).status, "already-applied");
  assert.doesNotThrow(() => verifyNonLinuxHeaderEntries(["/package.json", "/out/main/index.js"]));
  assert.throws(
    () => verifyNonLinuxHeaderEntries([
      "/node_modules/@nut-tree-fork/libnut-darwin/build/Release/libnut.node",
    ]),
    /remain in ASAR header/,
  );
});

test("engine rolls back an extracted-app descriptor that throws", (t) => {
  const root = temporaryDirectory(t);
  const mainBundlePath = path.join(root, "main.js");
  writeFileSync(mainBundlePath, "main");
  const descriptor = {
    id: "rollback-test",
    phase: "extracted-app",
    order: 1,
    required: true,
    apply({ extractedDir }) {
      writeFileSync(path.join(extractedDir, "partial"), "bad");
      throw new Error("boom");
    },
  };
  const result = runPatchDescriptors({ extractedDir: root, mainBundlePath, descriptors: [descriptor] });
  assert.equal(result.entries[0].status, "failed-required");
  assert.throws(() => readFileSync(path.join(root, "partial")), /ENOENT/);
});

test("descriptor contract rejects missing required and invalid phase", () => {
  const base = { id: "bad", order: 1, apply() {} };
  assert.throws(
    () => normalizeDescriptors([{ ...base, phase: PHASE_MAIN_BUNDLE }]),
    /required must be a boolean/,
  );
  assert.throws(
    () => normalizeDescriptors([{ ...base, required: true, phase: "third-phase" }]),
    /unsupported phase/,
  );
});

test("xsel stays unpacked, byte-identical, and executable", (t) => {
  const root = temporaryDirectory(t);
  const extracted = path.join(root, "extracted");
  const unpacked = path.join(root, "app.asar.unpacked");
  const verified = path.join(root, "verified");
  const source = path.join(extracted, XSEL_RELATIVE_PATH);
  const unpackedXsel = path.join(unpacked, XSEL_RELATIVE_PATH);
  const verifiedXsel = path.join(verified, XSEL_RELATIVE_PATH);
  mkdirSync(path.dirname(source), { recursive: true });
  mkdirSync(path.dirname(unpackedXsel), { recursive: true });
  mkdirSync(path.dirname(verifiedXsel), { recursive: true });
  writeFileSync(source, "synthetic-xsel", { mode: 0o644 });

  const payloads = prepareExecutablePayloads(extracted);
  assert.notEqual(payloads[XSEL_RELATIVE_PATH].mode & 0o111, 0);
  writeFileSync(unpackedXsel, readFileSync(source), { mode: payloads[XSEL_RELATIVE_PATH].mode });
  writeFileSync(verifiedXsel, readFileSync(source), { mode: payloads[XSEL_RELATIVE_PATH].mode });
  assert.doesNotThrow(() => verifyExecutablePayloads(unpacked, verified, payloads));

  writeFileSync(verifiedXsel, "changed", { mode: 0o755 });
  assert.throws(
    () => verifyExecutablePayloads(unpacked, verified, payloads),
    /payload bytes changed/,
  );
});
