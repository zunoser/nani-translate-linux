import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import tray from '../scripts/patches/linux-tray.mjs';
import close from '../scripts/patches/linux-close-to-tray.mjs';
import deeplink from '../scripts/patches/deeplink-readiness.mjs';
import updater from '../scripts/patches/disable-updater.mjs';
import autostart from '../scripts/patches/xdg-autostart.mjs';
import * as fixtures from './fixtures/upstream-anchors.mjs';

const snippets = [
  [tray, fixtures.TRAY_ANCHOR],
  [close, fixtures.CLOSE_TO_TRAY_ANCHOR],
  [deeplink, fixtures.DEEPLINK_ANCHOR],
  [updater, fixtures.UPDATER_ENABLE_ANCHOR + fixtures.UPDATER_HANDLERS_ANCHOR],
  [autostart, [fixtures.AUTOSTART_GET_ANCHOR, fixtures.AUTOSTART_SET_ANCHOR, fixtures.AUTOSTART_SYNC_ANCHOR].join(';')],
];

// Rename local bindings without rewriting method names or text literals.
function renamed(source) {
  return source.replace(/\b(?:Xs|ft|rr|Fe|c|k|e|t|n|o|Ke|Ys|d|quitting|fe|session|factory|updater|We|Qa|Kn|Xa|uc|dc|fc|pc|al|Sc|ko)\b/g, (word, offset) => {
    if (source[offset - 1] === '.') return word;
    return `_${word}$renamed`;
  });
}
for (const [descriptor, snippet] of snippets) {
  test(`${descriptor.id} tolerates identifier changes and remains idempotent`, () => {
    const input = renamed(snippet);
    const result = descriptor.apply({ source: input });
    assert.notEqual(result.source, input);
    assert.equal(descriptor.apply({ source: result.source }).source, result.source);
  });
  test(`${descriptor.id} rejects missing or ambiguous targets`, () => {
    assert.throws(() => descriptor.apply({ source: 'const unrelated = true;' }), /expected exactly one/);
    assert.throws(() => descriptor.apply({ source: snippet + ';' + snippet }), /expected exactly one/);
  });
}

test('tray uses Linux icon and leaves disabled mode without a tray', () => {
  const source = tray.apply({ source: renamed(fixtures.TRAY_ANCHOR) }).source;
  for (const disabled of [false, true]) {
    const seen = [];
    const context = {
      process: { platform: 'linux' }, __dirname: '/app/out/main',
      _ft$renamed: () => disabled,
      _rr$renamed: () => {}, _Fe$renamed: (tray) => seen.push(tray),
      _k$renamed: { join: (...parts) => parts.join('/') },
      _c$renamed: {
        Tray: class { constructor(icon) { this.icon = icon; } },
        nativeImage: { createFromPath: (file) => ({ resize: (size) => ({ file, size }) }) },
      },
    };
    vm.runInNewContext(source + ';_Xs$renamed("ja")', context);
    if (disabled) assert.equal(seen[0], null);
    else { assert.match(seen[0].icon.file, /resources\/icon.png$/); assert.equal(seen[0].icon.size.width, 24); }
  }
});

test('close-to-tray hides on Linux but permits an explicit quit', () => {
  const source = close.apply({ source: renamed(fixtures.CLOSE_TO_TRAY_ANCHOR) }).source;
  for (const quitting of [false, true]) {
    let callback, hidden = 0, prevented = 0;
    vm.runInNewContext(source, {
      process: { platform: 'linux' }, _quitting$renamed: () => quitting,
      _d$renamed: { on: (_, cb) => { callback = cb; }, hide: () => hidden++ },
    });
    callback({ preventDefault: () => prevented++ });
    assert.equal(hidden, quitting ? 0 : 1);
    assert.equal(prevented, quitting ? 0 : 1);
  }
});

test('deeplink handles both loaded and still-loading windows exactly once', () => {
  const source = deeplink.apply({ source: renamed(fixtures.DEEPLINK_ANCHOR) }).source;
  for (const loading of [false, true]) {
    const handled = [];
    let listener;
    vm.runInNewContext(source, {
      _t$renamed: 'nani://login', _o$renamed: { info() {} }, _Ke$renamed: x => handled.push(x),
      _e$renamed: { webContents: { isLoading: () => loading, once: (_, cb) => { listener = cb; } } },
    });
    assert.equal(handled.length, loading ? 0 : 1);
    if (loading) listener();
    assert.deepEqual(handled, ['nani://login']);
  }
});

test('updater disables Linux background gate and manual update IPC', async () => {
  const source = 'const fe=process.platform!=="win32",session=factory({checkForUpdates:async()=>{const e=await updater.autoUpdater.checkForUpdates();return e;}});' +
    'const handlers={checkForUpdates:We,checkForUpdatesSilent:Qa,quitAndInstall:Kn,ensureUpdateDownloaded:Xa,};globalThis.enabled=fe;globalThis.handlers=handlers;';
  const patched = updater.apply({ source }).source;
  for (const platform of ['linux', 'darwin', 'win32']) {
    let calls = 0;
    const context = { process: { platform }, factory: x => x, updater: {}, We: () => calls++, Qa() {}, Kn() {}, Xa() {} };
    vm.runInNewContext(patched, context);
    assert.equal(context.enabled, platform === 'darwin');
    await context.handlers.checkForUpdates();
    assert.equal(calls, platform === 'linux' ? 0 : 1);
  }
});

test('optional real bundle applies every main patch and parses after rewriting', { skip: !process.env.NANI_TEST_MAIN_BUNDLE }, () => {
  let source = readFileSync(process.env.NANI_TEST_MAIN_BUNDLE, 'utf8');
  for (const [descriptor] of snippets) source = descriptor.apply({ source }).source;
  new vm.Script(source);
});

test('autostart creates, reads, refreshes and removes a desktop entry on Linux', async (t) => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { createRequire } = await import('node:module');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nani-autostart-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = 'const unused=0' + fixtures.AUTOSTART_GET_ANCHOR + fixtures.AUTOSTART_SET_ANCHOR + ';async function sync(){' + fixtures.AUTOSTART_SYNC_ANCHOR + ',()=>{})};globalThis.api={get:uc,set:fc,sync};';
  const context = {
    process: { platform: 'linux', pid: process.pid, env: { XDG_CONFIG_HOME: root, NANI_LAUNCHER_PATH: '/opt/nani/start.sh' } },
    require: createRequire(import.meta.url), al() {}, Sc() {}, ko() {},
    c: { app: { on() {}, getLoginItemSettings() { throw new Error('macOS getter called'); }, setLoginItemSettings() { throw new Error('macOS setter called'); } } },
  };
  vm.runInNewContext(autostart.apply({ source }).source, context);
  assert.equal((await context.api.get()).autoLaunchEnabled, false);
  assert.equal((await context.api.set(null, true)).ok, true);
  const desktop = path.join(root, 'autostart/nani.desktop');
  assert.match(fs.readFileSync(desktop, 'utf8'), /Exec="\/opt\/nani\/start.sh" --autostart\n/);
  assert.equal((await context.api.get()).autoLaunchEnabled, true);
  context.process.env.NANI_LAUNCHER_PATH = '/opt/new nani/start.sh';
  await context.api.sync();
  assert.match(fs.readFileSync(desktop, 'utf8'), /Exec="\/opt\/new nani\/start.sh"/);
  context.process.env.NANI_LAUNCHER_PATH = '/opt/nani\nmalformed';
  assert.equal((await context.api.set(null, true)).ok, false);
  assert.equal((await context.api.set(null, false)).ok, true);
  assert.equal(fs.existsSync(desktop), false);
});
