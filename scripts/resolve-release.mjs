#!/usr/bin/env node
import { latestRelease, readRelease } from './lib/releases.mjs';
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--latest')) throw new Error('usage: resolve-release.mjs [--latest]');
const release = process.env.NANI_RELEASE_FILE
  ? readRelease(process.env.NANI_RELEASE_FILE)
  : args.includes('--latest') ? await latestRelease() : readRelease(new URL('../nix/upstream-nani.json', import.meta.url));
console.log(JSON.stringify(release));
