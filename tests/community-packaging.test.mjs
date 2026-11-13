import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
test('Community AppImage staging uses separate desktop, protocol and launcher names',t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'nani-community-packaging-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const app=path.join(dir,'app');mkdirSync(path.join(app,'resources'),{recursive:true});
  writeFileSync(path.join(app,'community-build.json'),'{}');writeFileSync(path.join(app,'resources/icon.png'),'fixture');writeFileSync(path.join(app,'start.sh'),'#!/usr/bin/env bash\nexit 0\n',{mode:0o755});
  const tool=path.join(dir,'appimagetool');
  writeFileSync(tool,`#!/usr/bin/env bash
set -euo pipefail
[[ "$(readlink "$1/AppRun")" = usr/lib/nani-community/nani-community ]]
[[ "$(readlink "$1/usr/bin/nani-community")" = ../lib/nani-community/nani-community ]]
[[ -x "$1/usr/lib/nani-community/nani-community" ]]
[[ ! -e "$1/nani.desktop" ]]
[[ ! -e "$1/usr/bin/nani" ]]
cp "$1/usr/share/applications/nani-community.desktop" "$2"
`,{mode:0o755});
  const output=path.join(dir,'Community.AppImage');
  const result=spawnSync('bash',['scripts/build-community-appimage.sh',app,output],{encoding:'utf8',env:{...process.env,APPIMAGETOOL:tool}});
  assert.equal(result.status,0,result.stderr);const desktop=readFileSync(output,'utf8');assert.match(desktop,/Exec=nani-community %U/);assert.match(desktop,/x-scheme-handler\/nani-community;/);assert.match(desktop,/Name=Nani Community/);
});

test('Community launcher defaults to software X11 on a mixed Wayland/X11 desktop',t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'nani-community-launch-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const launcher=path.join(dir,'start.sh');writeFileSync(launcher,readFileSync('runtime/community-start.sh.template'),{mode:0o755});
  writeFileSync(path.join(dir,'electron'),'#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$TEST_ARGUMENTS"\n',{mode:0o755});
  const args=path.join(dir,'arguments');
  const env={...process.env,DISPLAY:':0',WAYLAND_DISPLAY:'wayland-1',XDG_CACHE_HOME:path.join(dir,'cache'),TEST_ARGUMENTS:args};
  for(const key of ['NANI_APP_DIR','NANI_OZONE_PLATFORM','NANI_COMMUNITY_GPU','NANI_CDP_PORT'])delete env[key];
  const result=spawnSync('bash',[launcher],{encoding:'utf8',env});
  assert.equal(result.status,0,result.stderr);assert.match(result.stderr,/ログ:/);
  assert.deepEqual(readFileSync(args,'utf8').trim().split('\n'),['--disable-gpu','--ozone-platform=x11']);
  const override=spawnSync('bash',[launcher,'--ozone-platform=wayland'],{encoding:'utf8',env:{...env,NANI_COMMUNITY_GPU:'1'}});
  assert.equal(override.status,0,override.stderr);assert.equal(readFileSync(args,'utf8').trim(),'--ozone-platform=wayland');
});
