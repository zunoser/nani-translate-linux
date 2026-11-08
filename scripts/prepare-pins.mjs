#!/usr/bin/env node
// Generate pins only from a successfully verified candidate, never from moving metadata.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validateRelease } from './lib/releases.mjs';
const [reports, output] = process.argv.slice(2);
if (!reports || !output) throw new Error('usage: prepare-pins.mjs REPORT_DIRECTORY OUTPUT_JSON');
const json = name => JSON.parse(readFileSync(path.join(reports, name), 'utf8'));
const upstream = json('upstream.json');
const patches = json('patch-report.json');
const build = json('build-report.json');
if (!patches.success || build.exitCode !== 0 || patches.upstream.version !== upstream.version) throw new Error('Candidate was not successfully verified');
const release = validateRelease({ version: upstream.version, dmg: { url: upstream.url, sha512: upstream.sha512 } });
const dmg = readFileSync(upstream.dmgPath);
if (createHash('sha512').update(dmg).digest('base64') !== release.dmg.sha512) throw new Error('Verified DMG bytes changed');
const info = Object.fromEntries(readFileSync(path.join(reports, 'build-info.env'), 'utf8').trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
const version = info.electron_version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid Electron version');
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Download failed: ${url} HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const sri = data => `sha256-${createHash('sha256').update(data).digest('base64')}`;
const zipName = `electron-v${version}-linux-x64.zip`;
const base = `https://github.com/electron/electron/releases/download/v${version}`;
const checksums = (await download(`${base}/SHASUMS256.txt`)).toString('utf8');
const zipHash = checksums.split('\n').map(line => line.trim().split(/\s+/)).find(([, name]) => name?.replace(/^\*/, '') === zipName)?.[0];
if (!/^[a-f0-9]{64}$/.test(zipHash ?? '')) throw new Error('Missing Electron checksum');
if (zipHash !== info.electron_zip_sha256) throw new Error('Electron checksum differs from the verified runtime');
const headersUrl = `https://electronjs.org/headers/v${version}/node-v${version}-headers.tar.gz`;
const headers = await download(headersUrl);
const pins = { ...release, dmg: { ...release.dmg, sri: sri(dmg) }, electron: {
  version, zip: { url: `${base}/${zipName}`, sri: `sha256-${Buffer.from(zipHash, 'hex').toString('base64')}` },
  headers: { url: headersUrl, sri: sri(headers) },
} };
writeFileSync(output, JSON.stringify(pins, null, 2) + '\n');
console.log(`Prepared verified Nani ${release.version} / Electron ${version} pins: ${output}`);
