import { writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { latestRelease } from '../lib/releases.mjs';
import { buildKey, codeId, shouldBuild, nextState } from './state.mjs';

const previous = JSON.parse(readFileSync('watchdog-previous.json', 'utf8'));
const implementation = codeId();
let release;
try {
  release = await latestRelease();
} catch (error) {
  const key = `manifest:${implementation}`;
  const state = nextState(previous, { key, release: null, result: { status: 'infrastructure', failures: [{ id: 'manifest', detail: error.message }] }, runUrl: process.env.RUN_URL });
  // Probing stays daily; repeat identical metadata failures do not write issues.
  const changed = previous?.key !== key || previous?.failures?.[0]?.detail !== error.message;
  writeFileSync('watchdog-result.json', JSON.stringify(changed ? state : previous));
  appendFileSync(process.env.GITHUB_OUTPUT, 'build=false\n');
  process.exit(0);
}
const key = buildKey(release, implementation);
writeFileSync('watchdog-release.json', JSON.stringify(release));
writeFileSync('watchdog-plan.json', JSON.stringify({ key, release }));
const build = shouldBuild(previous, key, process.env.FORCE === 'true');
appendFileSync(process.env.GITHUB_OUTPUT, `build=${build}\n`);
if (!build) {
  writeFileSync('watchdog-result.json', JSON.stringify(previous));
  if (previous.status === 'compatible' && previous.verifiedPins) writeFileSync('verified-pins.json', JSON.stringify(previous.verifiedPins, null, 2) + '\n');
}
