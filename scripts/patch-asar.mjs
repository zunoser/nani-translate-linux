#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  cpSync,
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import * as asar from "@electron/asar";

import { addIntegrityFailure, runPatchDescriptors } from "./patches/engine.mjs";
import { corePatchDescriptors } from "./patches/index.mjs";
import { copyTreeContents, relativeFileHashes, sha256File, walkFiles } from "./patches/lib.mjs";
import { verifyLinuxOnboarding } from "./patches/linux-onboarding.mjs";
import { verifyOcrStub } from "./patches/ocr-stub.mjs";
import {
  verifyNonLinuxHeaderEntries,
  verifyNonLinuxPayloadsAbsent,
} from "./patches/prune-non-linux.mjs";
import { AUTOSTART_MARKER } from "./patches/xdg-autostart.mjs";
import { UPDATER_MARKER } from "./patches/disable-updater.mjs";
import { TRAY_MARKER } from "./patches/linux-tray.mjs";

const USAGE = `Usage:
  node scripts/patch-asar.mjs \\
    --asar PATH \\
    --unpacked PATH \\
    --report PATH \\
    [--native-replacements DIRECTORY]

The ASAR and its unpacked directory are replaced in place only after every
required patch and post-repack integrity check succeeds. A native replacement
directory, when supplied, must mirror paths below the extracted application
(for example node_modules/better-sqlite3/build/Release/better_sqlite3.node).`;

export const XSEL_RELATIVE_PATH = "node_modules/clipboardy/fallbacks/linux/xsel";

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    const key = {
      "--asar": "asarPath",
      "--unpacked": "unpackedPath",
      "--report": "reportPath",
      "--native-replacements": "nativeReplacements",
    }[argument];
    if (!key) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a path`);
    options[key] = path.resolve(value);
    index += 1;
  }
  for (const key of ["asarPath", "unpackedPath", "reportPath"]) {
    if (!options[key]) throw new Error(`Missing required option for ${key}`);
  }
  return options;
}

function atomicJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, filePath);
}

function safeMainPath(extractedDir) {
  const packagePath = path.join(extractedDir, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  if (typeof packageJson.main !== "string" || packageJson.main.length === 0) {
    throw new Error("Extracted package.json has no main entrypoint");
  }
  const resolved = path.resolve(extractedDir, packageJson.main);
  const relative = path.relative(extractedDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe main entrypoint in package.json: ${packageJson.main}`);
  }
  if (!existsSync(resolved)) throw new Error(`Main bundle does not exist: ${packageJson.main}`);
  return { mainBundlePath: resolved, packageJson };
}

function writeOrderingFile(extractedDir, orderingPath) {
  const ordering = walkFiles(extractedDir)
    .map((filePath) => path.relative(extractedDir, filePath).split(path.sep).join("/"))
    .join("\n");
  writeFileSync(orderingPath, `${ordering}\n`);
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function prepareExecutablePayloads(extractedDir) {
  const relativePath = XSEL_RELATIVE_PATH;
  const filePath = path.join(extractedDir, relativePath);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new Error(`Required Linux executable payload is missing: ${relativePath}`);
  }
  const beforeHash = sha256File(filePath);
  const mode = statSync(filePath).mode & 0o777;
  chmodSync(filePath, mode | 0o111);
  if (sha256File(filePath) !== beforeHash) {
    throw new Error(`Setting executable bits changed payload bytes: ${relativePath}`);
  }
  return {
    [relativePath]: {
      sha256: beforeHash,
      mode: statSync(filePath).mode & 0o777,
    },
  };
}

function verifyExecutablePayloads(stagedUnpacked, verifyDir, executablePayloads) {
  for (const [relativePath, expected] of Object.entries(executablePayloads)) {
    const unpackedPath = path.join(stagedUnpacked, relativePath);
    const extractedPath = path.join(verifyDir, relativePath);
    for (const [location, filePath] of [
      ["app.asar.unpacked", unpackedPath],
      ["post-repack extraction", extractedPath],
    ]) {
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        throw new Error(`Executable payload is missing from ${location}: ${relativePath}`);
      }
      if (sha256File(filePath) !== expected.sha256) {
        throw new Error(`Executable payload bytes changed in ${location}: ${relativePath}`);
      }
      if ((statSync(filePath).mode & 0o111) === 0) {
        throw new Error(`Executable payload lost its executable bit in ${location}: ${relativePath}`);
      }
    }
  }
}

function promoteOutputs({ stagedAsar, stagedUnpacked, asarPath, unpackedPath, workspace }) {
  const previousAsar = path.join(workspace, "previous.asar");
  const previousUnpacked = path.join(workspace, "previous.asar.unpacked");
  let asarBackedUp = false;
  let unpackedBackedUp = false;
  let asarPromoted = false;
  let unpackedPromoted = false;

  try {
    renameSync(asarPath, previousAsar);
    asarBackedUp = true;
    if (existsSync(unpackedPath)) {
      renameSync(unpackedPath, previousUnpacked);
      unpackedBackedUp = true;
    }
    renameSync(stagedAsar, asarPath);
    asarPromoted = true;
    if (existsSync(stagedUnpacked)) {
      renameSync(stagedUnpacked, unpackedPath);
      unpackedPromoted = true;
    }
  } catch (error) {
    if (unpackedPromoted) rmSync(unpackedPath, { recursive: true, force: true });
    if (asarPromoted) rmSync(asarPath, { force: true });
    if (unpackedBackedUp) renameSync(previousUnpacked, unpackedPath);
    if (asarBackedUp) renameSync(previousAsar, asarPath);
    throw error;
  }
}

async function postRepackVerification({
  stagedAsar,
  stagedUnpacked,
  verifyDir,
  expectedMainSource,
  mainRelativePath,
  nativeHashes,
  executablePayloads,
}) {
  verifyNonLinuxHeaderEntries(asar.listPackage(stagedAsar));
  await asar.extractAll(stagedAsar, verifyDir);
  if (existsSync(stagedUnpacked)) copyTreeContents(stagedUnpacked, verifyDir);

  const verifiedMain = readFileSync(path.join(verifyDir, mainRelativePath), "utf8");
  if (verifiedMain !== expectedMainSource) {
    throw new Error("Main bundle bytes changed during ASAR repack");
  }
  for (const marker of [TRAY_MARKER, UPDATER_MARKER]) {
    if (verifiedMain.split(marker).length !== 2) {
      throw new Error(`Required patch marker is missing or duplicated: ${marker}`);
    }
  }
  const optionalMarkerCount = verifiedMain.split(AUTOSTART_MARKER).length - 1;
  if (optionalMarkerCount > 1) {
    throw new Error(`Optional patch marker is duplicated: ${AUTOSTART_MARKER}`);
  }
  verifyOcrStub(verifyDir);
  verifyLinuxOnboarding(verifyDir);
  verifyNonLinuxPayloadsAbsent(verifyDir);
  verifyExecutablePayloads(stagedUnpacked, verifyDir, executablePayloads);

  for (const [relativePath, expectedHash] of Object.entries(nativeHashes)) {
    const actualPath = path.join(verifyDir, relativePath);
    if (!existsSync(actualPath) || sha256File(actualPath) !== expectedHash) {
      throw new Error(`Native replacement failed integrity check: ${relativePath}`);
    }
  }
}

async function patchAsar(options) {
  if (!existsSync(options.asarPath)) throw new Error(`ASAR does not exist: ${options.asarPath}`);
  if (options.nativeReplacements && !existsSync(options.nativeReplacements)) {
    throw new Error(`Native replacements do not exist: ${options.nativeReplacements}`);
  }

  // Keep staging beside the target so final rename operations stay on one filesystem.
  const workspace = mkdtempSync(path.join(path.dirname(options.asarPath), ".nani-patch-asar-"));
  const extractedDir = path.join(workspace, "extracted");
  const verifyDir = path.join(workspace, "verify");
  const orderingPath = path.join(workspace, "app.asar.ordering");
  const stagedAsar = path.join(workspace, "app.asar");
  const stagedUnpacked = `${stagedAsar}.unpacked`;
  const report = {
    schemaVersion: 1,
    input: {
      asar: options.asarPath,
      unpacked: options.unpackedPath,
      sha256: sha256File(options.asarPath),
    },
    patches: [],
    success: false,
  };

  try {
    await asar.extractAll(options.asarPath, extractedDir);
    if (existsSync(options.unpackedPath)) copyTreeContents(options.unpackedPath, extractedDir);
    if (options.nativeReplacements) copyTreeContents(options.nativeReplacements, extractedDir);
    const nativeHashes = options.nativeReplacements
      ? relativeFileHashes(options.nativeReplacements)
      : {};
    const executablePayloads = prepareExecutablePayloads(extractedDir);

    const { mainBundlePath, packageJson } = safeMainPath(extractedDir);
    report.upstream = {
      name: packageJson.name ?? null,
      version: packageJson.version ?? null,
      main: path.relative(extractedDir, mainBundlePath).split(path.sep).join("/"),
    };

    const result = runPatchDescriptors({
      extractedDir,
      mainBundlePath,
      descriptors: corePatchDescriptors,
    });
    report.patches.push(...result.entries);
    if (result.hasRequiredFailure || result.hasIntegrityFailure) {
      throw new Error("One or more required ASAR patches failed");
    }

    writeOrderingFile(extractedDir, orderingPath);
    await asar.createPackageWithOptions(extractedDir, stagedAsar, {
      ordering: orderingPath,
      unpack: "{*.node,*.so,xsel}",
    });
    await postRepackVerification({
      stagedAsar,
      stagedUnpacked,
      verifyDir,
      expectedMainSource: result.mainSource,
      mainRelativePath: report.upstream.main,
      nativeHashes,
      executablePayloads,
    });

    promoteOutputs({
      stagedAsar,
      stagedUnpacked,
      asarPath: options.asarPath,
      unpackedPath: options.unpackedPath,
      workspace,
    });

    report.output = {
      sha256: sha256File(options.asarPath),
      mainSha256: sha256Text(result.mainSource),
      nativeReplacements: Object.keys(nativeHashes).length,
      executablePayloads,
    };
    report.success = true;
    atomicJson(options.reportPath, report);
    return report;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (!report.patches.some((entry) => entry.status === "failed-integrity") &&
        !report.patches.some((entry) => entry.status === "failed-required")) {
      addIntegrityFailure(report.patches, "patch-asar", detail);
    }
    report.error = detail;
    atomicJson(options.reportPath, report);
    throw error;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }
  try {
    const report = await patchAsar(options);
    const summary = report.patches.map(({ id, status }) => `${id}=${status}`).join(", ");
    console.log(`ASAR patched: ${summary}`);
  } catch (error) {
    console.error(`ASAR patch failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

export {
  parseArgs,
  patchAsar,
  postRepackVerification,
  prepareExecutablePayloads,
  promoteOutputs,
  safeMainPath,
  writeOrderingFile,
  verifyExecutablePayloads,
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
