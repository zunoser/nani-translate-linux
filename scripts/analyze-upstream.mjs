#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { extractAll } from "@electron/asar";

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error("usage: node scripts/analyze-upstream.mjs --app <Nani.app> [--dmg <file>] [--output <file>]");
  process.exit(2);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!["--app", "--dmg", "--output"].includes(arg)) usage(`unknown argument: ${arg}`);
    const value = argv[++index];
    if (!value) usage(`${arg} requires a value`);
    result[arg.slice(2)] = path.resolve(value);
  }
  if (!result.app) usage("--app is required");
  return result;
}

async function sha512(file) {
  const data = await readFile(file);
  return createHash("sha512").update(data).digest("base64");
}

function plistValue(source, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`<key>${escaped}</key>\\s*<string>([^<]+)</string>`))?.[1] ?? null;
}

function countMatches(source, pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...source.matchAll(new RegExp(pattern.source, flags))].length;
}

function binaryKind(buffer) {
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return "elf";
  const magic = buffer.subarray(0, 4).toString("hex");
  if (["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca"].includes(magic)) return "mach-o";
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString("ascii") === "MZ") return "pe";
  return null;
}

function readElf(file) {
  const header = spawnSync("readelf", ["-h", file], { encoding: "utf8" });
  const dynamic = spawnSync("readelf", ["-d", file], { encoding: "utf8" });
  return {
    machine: header.status === 0 ? header.stdout.match(/^\s*Machine:\s*(.+)$/m)?.[1]?.trim() ?? null : null,
    needed: dynamic.status === 0
      ? [...dynamic.stdout.matchAll(/\(NEEDED\).*\[([^\]]+)\]/g)].map((match) => match[1]).sort()
      : [],
  };
}

async function walkBinaries(root) {
  const result = [];
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(file);
      } else if (entry.isFile()) {
        const handle = await readFile(file);
        const kind = binaryKind(handle);
        if (!kind) continue;
        const metadata = await stat(file);
        result.push({
          path: path.relative(root, file),
          kind,
          mode: metadata.mode & 0o777,
          executable: (metadata.mode & 0o111) !== 0,
          ...(kind === "elf" ? readElf(file) : {}),
        });
      }
    }
  }
  if (await stat(root).catch(() => null)) await walk(root);
  return result;
}

const args = parseArgs(process.argv.slice(2));
const resources = path.join(args.app, "Contents", "Resources");
const asarPath = path.join(resources, "app.asar");
const unpackedPath = path.join(resources, "app.asar.unpacked");
const frameworkPlist = path.join(
  args.app,
  "Contents",
  "Frameworks",
  "Electron Framework.framework",
  "Versions",
  "A",
  "Resources",
  "Info.plist",
);
const appPlist = path.join(args.app, "Contents", "Info.plist");
const work = await mkdtemp(path.join(tmpdir(), "nani-upstream-analysis-"));

try {
  extractAll(asarPath, work);
  const packageJson = JSON.parse(await readFile(path.join(work, "package.json"), "utf8"));
  const mainPath = path.join(work, packageJson.main);
  const mainSource = await readFile(mainPath, "utf8");
  const rendererAssets = path.join(work, "out", "renderer", "assets");
  const rendererSource = (await readdir(rendererAssets))
    .filter((file) => file.endsWith(".js"))
    .map((file) => readFile(path.join(rendererAssets, file), "utf8"));
  const rendererBundle = (await Promise.all(rendererSource)).join("\n");
  const electronPlistSource = await readFile(frameworkPlist, "utf8");
  const appPlistSource = await readFile(appPlist, "utf8");
  const packages = {};
  for (const name of ["better-sqlite3", "@napi-rs/system-ocr", "@nut-tree-fork/libnut-linux"]) {
    const metadata = path.join(work, "node_modules", ...name.split("/"), "package.json");
    const parsed = JSON.parse(await readFile(metadata, "utf8").catch(() => "null"));
    packages[name] = parsed?.version ?? null;
  }

  const report = {
    schemaVersion: 1,
    app: {
      productName: packageJson.productName ?? null,
      version: packageJson.version ?? plistValue(appPlistSource, "CFBundleShortVersionString"),
      bundleIdentifier: plistValue(appPlistSource, "CFBundleIdentifier"),
      main: packageJson.main,
    },
    electron: {
      version: plistValue(electronPlistSource, "CFBundleVersion"),
    },
    packages,
    contracts: {
      ocrTopLevelRequire: countMatches(mainSource, /require\(["']@napi-rs\/system-ocr["']\)/),
      updaterEnablePredicate: countMatches(mainSource, /process\.platform!==["']win32["']/),
      trayWin32Gate: countMatches(mainSource, /if\(![A-Za-z_$][\w$]*\(\)&&process\.platform===["']win32["']\)/),
      loginItemGetter: countMatches(mainSource, /getLoginItemSettings\(\)\.openAtLogin/),
      loginItemSetter: countMatches(mainSource, /setLoginItemSettings\(\{openAtLogin:/),
      linuxOnboardingFallback: countMatches(
        rendererBundle,
        /window\.constants\.os===["']win32["']\?[^:]+welcomeToWinApp[^:]+:[^;]+welcomeToMacApp/,
      ),
      protocolRegistration: countMatches(mainSource, /setAsDefaultProtocolClient/),
      updateIpcKeys: Object.fromEntries(
        ["checkForUpdates", "checkForUpdatesSilent", "ensureUpdateDownloaded", "quitAndInstall"]
          .map((key) => [key, countMatches(mainSource, new RegExp(`${key}:`))]),
      ),
    },
    binaries: await walkBinaries(unpackedPath),
    ...(args.dmg ? { dmg: { path: args.dmg, sha512: await sha512(args.dmg) } } : {}),
  };

  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output) await writeFile(args.output, serialized);
  else process.stdout.write(serialized);
} finally {
  await rm(work, { recursive: true, force: true });
}
