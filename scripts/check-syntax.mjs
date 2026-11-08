import { spawnSync } from 'node:child_process';
import { walkFiles } from './patches/lib.mjs';
for (const file of walkFiles('scripts').filter(file => file.endsWith('.mjs'))) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
