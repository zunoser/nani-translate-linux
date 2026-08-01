#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parse } from "yaml";

function fail(message) {
  console.error(`[nani] error: ${message}`);
  process.exit(1);
}

const [manifestPath, manifestUrl] = process.argv.slice(2);
if (!manifestPath || !manifestUrl) {
  fail("usage: resolve-upstream.mjs MANIFEST_PATH MANIFEST_URL");
}

let manifest;
try {
  manifest = parse(fs.readFileSync(manifestPath, "utf8"));
} catch (error) {
  fail(`could not parse upstream manifest: ${error.message}`);
}

const files = Array.isArray(manifest?.files) ? manifest.files : [];
const dmgs = files.filter(
  (file) => typeof file?.url === "string" && file.url.toLowerCase().endsWith(".dmg"),
);
if (dmgs.length !== 1) {
  fail(`expected exactly one DMG in manifest, found ${dmgs.length}`);
}

const selected = dmgs[0];
if (typeof manifest.version !== "string" || manifest.version.length === 0) {
  fail("manifest has no version");
}
if (typeof selected.sha512 !== "string" || selected.sha512.length === 0) {
  fail("DMG entry has no SHA-512");
}

let resolvedUrl;
try {
  resolvedUrl = new URL(selected.url, manifestUrl).href;
} catch (error) {
  fail(`invalid DMG URL: ${error.message}`);
}
if (!resolvedUrl.startsWith("https://")) {
  fail("DMG URL must use HTTPS");
}

const filename = path.basename(new URL(resolvedUrl).pathname);
if (!filename) fail("DMG URL has no filename");

process.stdout.write(
  [manifest.version, resolvedUrl, selected.sha512, filename].join("\t") + "\n",
);
