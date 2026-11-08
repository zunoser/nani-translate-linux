import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { releaseId } from '../lib/releases.mjs';

export const ISSUE_TITLE = '[watchdog] Upstream compatibility';
const MARKER = 'nani-watchdog-state';
export function codeId() {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', 'scripts', 'runtime', 'tests', 'flake.nix', 'package.json', 'package-lock.json', '.github/workflows/upstream-watchdog.yml'], { encoding: 'utf8' }).split('\0').filter(Boolean).sort();
  const hash = createHash('sha256');
  for (const file of new Set(files)) hash.update(file).update('\0').update(readFileSync(file)).update('\0');
  return hash.digest('hex');
}
export function buildKey(release, implementation) {
  return `${releaseId(release)}:${implementation}`;
}
export function decodeState(body = '') {
  const encoded = body.match(/<!-- nani-watchdog-state:([A-Za-z0-9+/=]+) -->/)?.[1];
  if (!encoded) return null;
  try {
    const state = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    return state.schemaVersion === 1 && typeof state.key === 'string' && ['compatible', 'incompatible', 'infrastructure', 'build-failed'].includes(state.status) && Array.isArray(state.failures) && Number.isInteger(state.attempts) && state.attempts > 0 && Number.isFinite(Date.parse(state.checkedAt)) ? state : null;
  } catch { return null; }
}
export function shouldBuild(previous, key, force = false, now = Date.now()) {
  if (force || previous?.key !== key) return true;
  if (previous.status !== 'infrastructure') return false;
  return previous.attempts < 3 || now - Date.parse(previous.checkedAt) >= 7 * 86400000;
}
export function classifyBuild(exitCode, report = {}, stage = '') {
  if (exitCode === 0) return { status: 'compatible', failures: [] };
  const failures = (report.patches ?? []).filter(p => ['failed-required', 'failed-integrity'].includes(p.status)).map(({ id, status, detail }) => ({ id, status, detail }));
  if (failures.length) return { status: 'incompatible', failures };
  // Errors outside patching must not be misreported as patch drift.
  return { status: ['resolve', 'electron-download'].includes(stage) ? 'infrastructure' : 'build-failed', failures: [{ id: stage || 'build', detail: report.error || 'See build log' }] };
}
export function nextState(previous, { key, release, result, runUrl, now = new Date().toISOString() }) {
  return {
    schemaVersion: 1, key, release, ...result,
    attempts: previous?.key === key ? (previous.attempts ?? 0) + 1 : 1,
    checkedAt: now, runUrl,
  };
}
export function issueBody(state) {
  const details = state.failures.map(f => `- ${f.id}: ${f.detail ?? f.status}`).join('\n');
  const encoded = Buffer.from(JSON.stringify(state)).toString('base64');
  return [
    `Upstream: **${state.release?.version ?? 'metadata unavailable'}**`,
    `Compatibility: **${state.status}**`, '', details, '',
    `Last verification: ${state.runUrl}`, '',
    'Unchanged artifacts and patch implementations are not rebuilt. Network failures retry up to three daily attempts, then weekly. Use workflow_dispatch with force to retry immediately.', '',
    `<!-- ${MARKER}:${encoded} -->`,
  ].join('\n');
}
export async function findStateIssue(github, repo) {
  const issues = await github.paginate(github.rest.issues.listForRepo, { ...repo, state: 'all', per_page: 100 });
  const matches = issues.filter(i => !i.pull_request && i.title === ISSUE_TITLE && i.user?.login === 'github-actions[bot]');
  if (matches.length > 1) throw new Error('Multiple watchdog state issues; refusing ambiguous state');
  return matches[0] ?? null;
}
export async function reportState(github, repo, state) {
  const existing = await findStateIssue(github, repo);
  const body = issueBody(state);
  const desired = state.status === 'compatible' ? 'closed' : 'open';
  if (existing) {
    if (existing.body === body) return;
    await github.rest.issues.update({ ...repo, issue_number: existing.number, body, state: desired });
  } else {
    const { data } = await github.rest.issues.create({ ...repo, title: ISSUE_TITLE, body });
    if (desired === 'closed') await github.rest.issues.update({ ...repo, issue_number: data.number, state: desired });
  }
}
