import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { classifyBuild, nextState } from './state.mjs';
const read = (file, fallback) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } };
const previous = read('watchdog-previous.json', null);
const plan = read('watchdog-plan.json', null);
if (!plan) throw new Error('Missing watchdog plan');
const stage = process.env.BUILD_STAGE || read('dist/reports/build-report.json', {}).stage;
const result = classifyBuild(Number(process.env.BUILD_STATUS), read('dist/reports/patch-report.json', {}), stage);
writeFileSync('watchdog-result.json', JSON.stringify(nextState(previous, { ...plan, result, runUrl: process.env.RUN_URL })));
console.log(JSON.stringify(result, null, 2));

appendFileSync(process.env.GITHUB_OUTPUT, `compatible=${result.status === "compatible"}\n`);
