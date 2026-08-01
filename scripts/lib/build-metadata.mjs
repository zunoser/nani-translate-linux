#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import * as asar from "@electron/asar";

function fail(message) {
  console.error(`[nani] error: ${message}`);
  process.exit(1);
}

function walk(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(entryPath));
    else found.push(entryPath);
  }
  return found;
}

async function sha512(filePath) {
  const hash = createHash("sha512");
  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath).on("data", (chunk) => hash.update(chunk)).on("end", resolve).on("error", reject);
  });
  process.stdout.write(hash.digest("base64") + "\n");
}

function electronVersion(appPath) {
  const candidates = walk(path.join(appPath, "Contents", "Frameworks")).filter(
    (file) => path.basename(file) === "Info.plist" && file.includes("Electron Framework.framework"),
  );
  for (const candidate of candidates) {
    const plist = fs.readFileSync(candidate, "utf8");
    const match = plist.match(
      /<key>CFBundle(?:ShortVersionString|Version)<\/key>\s*<string>([^<]+)<\/string>/,
    );
    if (match) return match[1];
  }
  fail("could not detect Electron version from Electron Framework Info.plist");
}

function sqliteVersion(asarPath) {
  try {
    const packageJson = JSON.parse(
      asar.extractFile(asarPath, "node_modules/better-sqlite3/package.json").toString("utf8"),
    );
    if (typeof packageJson.version === "string" && packageJson.version) return packageJson.version;
  } catch (error) {
    fail(`could not inspect better-sqlite3 in ASAR: ${error.message}`);
  }
  fail("better-sqlite3 package has no version");
}

function sqliteAsset(releasePath, version, abi) {
  const release = JSON.parse(fs.readFileSync(releasePath, "utf8"));
  const expectedName = `better-sqlite3-v${version}-electron-v${abi}-linux-x64.tar.gz`;
  const matches = (release.assets ?? []).filter((asset) => asset.name === expectedName);
  if (matches.length !== 1) fail(`expected one ${expectedName} release asset, found ${matches.length}`);
  const asset = matches[0];
  const digest = typeof asset.digest === "string" ? asset.digest : "";
  if (!digest.startsWith("sha256:")) fail(`GitHub did not provide a SHA-256 digest for ${expectedName}`);
  if (typeof asset.browser_download_url !== "string" || !asset.browser_download_url.startsWith("https://")) {
    fail(`release asset has no HTTPS download URL: ${expectedName}`);
  }
  process.stdout.write([asset.browser_download_url, digest.slice(7), expectedName].join("\t") + "\n");
}

function writeUpstreamReport(output, version, url, sha512Value, dmgPath) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(
    output,
    JSON.stringify({ version, url, sha512: sha512Value, dmgPath }, null, 2) + "\n",
  );
}

function checkNativePayload(root) {
  const violations = [];
  const machoMagics = new Set(["cafebabe", "bebafeca", "feedface", "cefaedfe", "feedfacf", "cffaedfe"]);
  for (const file of walk(root)) {
    const descriptor = fs.openSync(file, "r");
    const header = Buffer.alloc(20);
    const length = fs.readSync(descriptor, header, 0, header.length, 0);
    fs.closeSync(descriptor);
    if (length < 4) continue;
    const magic = header.subarray(0, 4).toString("hex");
    if (machoMagics.has(magic) || magic.startsWith("4d5a")) {
      violations.push(`${file}: non-Linux executable`);
      continue;
    }
    if (file.endsWith(".node") || file.endsWith(".so")) {
      const isElfX64 =
        magic === "7f454c46" && header[4] === 2 && header[5] === 1 && header[18] === 0x3e && header[19] === 0;
      if (!isElfX64) violations.push(`${file}: native module is not x86_64 ELF`);
    }
  }
  if (violations.length) fail(`native payload validation failed:\n${violations.join("\n")}`);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case "sha512":
    if (args.length !== 1) fail("usage: build-metadata.mjs sha512 FILE");
    await sha512(args[0]);
    break;
  case "electron-version":
    if (args.length !== 1) fail("usage: build-metadata.mjs electron-version APP");
    process.stdout.write(electronVersion(args[0]) + "\n");
    break;
  case "sqlite-version":
    if (args.length !== 1) fail("usage: build-metadata.mjs sqlite-version ASAR");
    process.stdout.write(sqliteVersion(args[0]) + "\n");
    break;
  case "sqlite-asset":
    if (args.length !== 3) fail("usage: build-metadata.mjs sqlite-asset RELEASE_JSON VERSION ABI");
    sqliteAsset(...args);
    break;
  case "write-upstream-report":
    if (args.length !== 5) fail("usage: build-metadata.mjs write-upstream-report OUTPUT VERSION URL SHA512 DMG");
    writeUpstreamReport(...args);
    break;
  case "check-native":
    if (args.length !== 1) fail("usage: build-metadata.mjs check-native ROOT");
    checkNativePayload(args[0]);
    break;
  default:
    fail(`unknown command: ${command ?? ""}`);
}
