import { spawnSync } from 'node:child_process';
import { walkFiles } from './patches/lib.mjs';
for (const file of [...walkFiles('scripts'),...walkFiles('runtime/community')].filter(file => /\.(mjs|cjs|js)$/.test(file))) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
