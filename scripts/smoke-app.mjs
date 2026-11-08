#!/usr/bin/env node
// Isolated renderer smoke test. Never uses the installed app's profile or account.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const app = path.resolve(process.argv[2] || 'nani-app');
const reports = path.resolve(process.argv[3] || 'dist/reports');
const root = mkdtempSync(path.join(tmpdir(), 'nani-smoke-'));
mkdirSync(reports, { recursive: true });
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const child = spawn(process.env.NANI_SMOKE_XVFB_RUN || 'xvfb-run', [
  '-a', path.join(app, 'start.sh'), `--user-data-dir=${root}/profile`, '--ozone-platform=x11', '--disable-gpu',
], {
  detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NANI_APP_DIR: app, NANI_CDP_PORT: String(port), XDG_CONFIG_HOME: `${root}/config`, XDG_CACHE_HOME: `${root}/cache`, XDG_STATE_HOME: `${root}/state` },
});
let logs = '', exited = false, launchError;
child.stdout.on('data', data => { logs += data; });
child.stderr.on('data', data => { logs += data; });
child.on('error', error => { launchError = error; exited = true; });
child.on('exit', () => { exited = true; });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function rendererState(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => { socket.close(); reject(new Error('Renderer response timed out')); }, 3000);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
      expression: '({ready:document.readyState,textLength:document.body?.innerText.trim().length??0})', returnByValue: true,
    } }));
    socket.onerror = () => { clearTimeout(timer); reject(new Error('Renderer connection failed')); };
    socket.onmessage = ({ data }) => {
      const result = JSON.parse(data);
      if (result.id !== 1) return;
      clearTimeout(timer); socket.close(); resolve(result.result?.result?.value);
    };
  });
}
try {
  const deadline = Date.now() + 45000;
  let ready = false;
  while (Date.now() < deadline) {
    if (exited) throw launchError || new Error('Application exited before the renderer was ready');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
      const pages = await response.json();
      const page = pages.find(p => p.type === 'page' && p.url.startsWith('file:') && p.webSocketDebuggerUrl);
      if (page) {
        const state = await rendererState(page.webSocketDebuggerUrl);
        if (state?.ready === 'complete' && state.textLength > 20) { ready = true; break; }
      }
    } catch { /* CDP and the renderer start asynchronously. */ }
    await delay(500);
  }
  if (!ready) throw new Error('Application renderer did not become ready within 45 seconds');
  console.log('Isolated application renderer is ready with visible content.');
} finally {
  // Only terminate the process group this test created, including Xvfb/Electron.
  if (child.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ }
    await delay(500);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
  }
  writeFileSync(path.join(reports, 'smoke.log'), logs);
  rmSync(root, { recursive: true, force: true });
}
