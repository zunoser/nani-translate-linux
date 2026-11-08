#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { releaseFromManifest } from './releases.mjs';
try {
  const [manifestPath, manifestUrl] = process.argv.slice(2);
  if (!manifestPath || !manifestUrl) throw new Error('usage: resolve-upstream.mjs MANIFEST_PATH MANIFEST_URL');
  const release = releaseFromManifest(fs.readFileSync(manifestPath, 'utf8'), manifestUrl);
  console.log([release.version, release.dmg.url, release.dmg.sha512, path.basename(new URL(release.dmg.url).pathname)].join('\t'));
} catch (error) {
  console.error(`[nani] error: ${error.message}`);
  process.exitCode = 1;
}
