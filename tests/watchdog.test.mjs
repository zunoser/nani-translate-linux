import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKey, shouldBuild, classifyBuild, nextState, issueBody, decodeState, reportState, ISSUE_TITLE } from '../scripts/watchdog/state.mjs';
import { releaseFromManifest, validateRelease } from '../scripts/lib/releases.mjs';
const release = { version: '1.1.15', dmg: { url: 'https://example.com/nani.dmg', sha512: Buffer.alloc(64).toString('base64') } };
const key = buildKey(release, 'implementation');
const base = { key, release, result: { status: 'incompatible', failures: [{ id: 'tray', detail: 'missing' }] }, runUrl: 'https://example.com/run', now: '2026-11-09T00:00:00Z' };

test('unchanged success and drift do not rebuild; new bytes, code and force do', () => {
  const previous = nextState(null, base);
  assert.equal(shouldBuild(previous, key), false);
  assert.equal(shouldBuild({ ...previous, status: 'compatible' }, key), false);
  assert.equal(shouldBuild(previous, key, true), true);
  assert.equal(shouldBuild(previous, buildKey(release, 'new-code')), true);
  assert.equal(shouldBuild(previous, buildKey({ ...release, dmg: { ...release.dmg, sha512: Buffer.alloc(64, 1).toString('base64') } }, 'implementation')), true);
});
test('infrastructure retries are bounded and resume weekly', () => {
  const state = { ...nextState(null, base), status: 'infrastructure', attempts: 3 };
  const now = Date.parse(state.checkedAt);
  assert.equal(shouldBuild(state, key, false, now + 86400000), false);
  assert.equal(shouldBuild(state, key, false, now + 7 * 86400000), true);
  assert.equal(shouldBuild({ ...state, attempts: 2 }, key, false, now), true);
});
test('patch drift and network outages have distinct results', () => {
  assert.equal(classifyBuild(1, {}, 'electron-download').status, 'infrastructure');
  assert.equal(classifyBuild(1, {}, 'native-build').status, 'build-failed');
  assert.equal(classifyBuild(1, { patches: [{ id: 'tray', status: 'failed-required' }] }, 'patch').status, 'incompatible');
  assert.equal(classifyBuild(0).status, 'compatible');
});
test('state round trips and malformed state cannot suppress a build', () => {
  const state = nextState(null, base);
  assert.deepEqual(decodeState(issueBody(state)), state);
  assert.equal(decodeState('<!-- nani-watchdog-state:bad -->'), null);
  assert.equal(shouldBuild(null, key), true);
});
test('same state makes no API writes; recovery closes and recurrence reopens the same issue', async () => {
  const state = nextState(null, base);
  let issue = { number: 1, title: ISSUE_TITLE, state: 'open', body: issueBody(state), user: { login: 'github-actions[bot]' } };
  const writes = [];
  const github = { paginate: async () => [issue], rest: { issues: { listForRepo() {}, update: async args => { writes.push(args); issue = { ...issue, ...args }; }, createComment() { throw new Error('must not comment'); } } } };
  await reportState(github, {}, state);
  assert.equal(writes.length, 0);
  const recovered = nextState(state, { ...base, result: { status: 'compatible', failures: [] } });
  await reportState(github, {}, recovered);
  assert.equal(writes[0].state, 'closed');
  await reportState(github, {}, state);
  assert.equal(writes[1].state, 'open');
  assert.equal(writes[1].issue_number, 1);
});
test('metadata selects a single DMG and rejects invalid identities', () => {
  const manifest = `version: 1.1.15\nfiles:\n - url: nani.dmg\n   sha512: ${release.dmg.sha512}\n`;
  assert.deepEqual(releaseFromManifest(manifest, 'https://example.com/latest.yml'), release);
  assert.throws(() => validateRelease({ ...release, version: '1\nunsafe' }), /version/);
  assert.throws(() => validateRelease({ ...release, dmg: { ...release.dmg, sha512: 'bad' } }), /SHA-512/);
  assert.throws(() => releaseFromManifest(manifest + ' - url: other.dmg\n'), /exactly one/);
});

test('manually closing an unchanged incident does not reopen or notify it', async () => {
  const state = nextState(null, base);
  const issue = { number: 1, title: ISSUE_TITLE, state: 'closed', body: issueBody(state), user: { login: 'github-actions[bot]' } };
  const github = { paginate: async () => [issue], rest: { issues: { listForRepo() {}, update() { throw new Error('unchanged incident must remain quiet'); } } } };
  await reportState(github, {}, state);
});
