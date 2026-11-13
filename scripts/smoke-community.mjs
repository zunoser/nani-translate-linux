#!/usr/bin/env node
// Real PLaMo + isolated Electron renderer; requires a running loopback llama-server.
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {renderAnswer} from '../runtime/community/chatgpt.cjs';
import {streamResponse} from '../runtime/community/backend.cjs';
const app=path.resolve(process.argv[2]||'nani-community-app');
const reports=path.resolve(process.argv[3]||'dist/community');mkdirSync(reports,{recursive:true});
const root=mkdtempSync(path.join(tmpdir(),'nani-community-e2e-'));
const portServer=createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));
const child=spawn(process.env.NANI_SMOKE_XVFB_RUN||'xvfb-run',['-a',path.join(app,'start.sh'),`--user-data-dir=${root}/profile`,'--ozone-platform=x11','--disable-gpu'],{detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NANI_APP_DIR:app,NANI_CDP_PORT:String(port),XDG_CONFIG_HOME:root+'/config',XDG_CACHE_HOME:root+'/cache',XDG_STATE_HOME:root+'/state'}});
let logs='',socket,launchError;child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);child.on('error',e=>launchError=e);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=30000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(launchError)throw launchError;try{const value=await fn();if(value)return value;}catch{}await delay(200);}throw new Error('Community smoke check timed out');}
let seq=0;const pending=new Map();
function command(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},10000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);return result.result?.value;}
try{
  const page=await until(async()=>{const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();return pages.find(p=>p.url?.endsWith('/out/renderer/index.html'));});
  socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>socket.onopen=r);
  socket.onmessage=({data})=>{const m=JSON.parse(data),handler=pending.get(m.id);if(handler){pending.delete(m.id);m.error?handler.reject(new Error(m.error.message)):handler.resolve(m.result);}};
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await until(()=>evaluate("!![...document.querySelectorAll('button')].find(b=>b.innerText==='Get Started')"));
  await evaluate("document.querySelector('[aria-label=\"Remove shortcut\"]')?.click();const a=document.querySelector('[aria-label=\"Start at login\"]');if(a?.getAttribute('aria-checked')==='true')a.click();true");
  await delay(500);
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.innerText==='Get Started').click();true");
  await until(()=>evaluate("!!document.querySelector('[data-main-input]')"));
  await evaluate("document.querySelector('[data-main-input]').focus();true");
  await command('Input.insertText',{text:'The meeting has been moved to Friday.'});
  await evaluate("document.querySelector('[aria-label=Send]').click();true");
  const visible=await until(async()=>{const text=await evaluate('document.body.innerText');return text.includes('会議は金曜日に変更されました。')&&text;});
  assert.ok(!visible.includes('Sign in'));assert.ok(visible.includes('Community 設定'));
  const screenshot=await command('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(reports,'plamo-translation.png'),Buffer.from(screenshot.data,'base64'));
  const noChatGPT=await evaluate("fetch('https://nani.now/api/ai/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({translateData:{sourceText:'hello'},messages:[{role:'user',content:JSON.stringify({messageType:'follow-up-free',displayText:'Explain this'})}]})}).then(r=>r.text())");
  assert.match(noChatGPT,/ChatGPT接続/);assert.match(noChatGPT,/event: error/);
  await until(()=>{const result=spawnSync('python3',['-c',"import sqlite3,sys,json;c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True);print(json.dumps(c.execute('select source_text,translation_excerpt from basic_translate').fetchall(),ensure_ascii=False))",root+'/profile/app.db/db'],{encoding:'utf8'});return result.status===0&&result.stdout.includes('会議は金曜日に変更されました。');});
  const prepare=await evaluate("fetch('https://nani.now/api/ai/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prepare:true})}).then(r=>r.json())");assert.equal(prepare.ok,true);
  // Replay a language-bearing provider response through the actual upstream UI.
  // This tests persistence independently of live OAuth credentials.
  const proofreadFixture=await streamResponse(async emit=>renderAnswer('/api/ai/proofread',{detectedLang:'en',targetLang:'en',suggestion:'He went to school yesterday.',analysis:'Use the past tense.',note:'Changed go to went.'},emit)).text();
  await evaluate(`globalThis.$communityOriginalFetch=window.fetch;window.fetch=(url,...args)=>String(url).endsWith('/api/ai/proofread')?Promise.resolve(new Response(${JSON.stringify(proofreadFixture)},{headers:{'Content-Type':'text/event-stream'}})):globalThis.$communityOriginalFetch(url,...args);true`);
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.innerText==='New translation').click();true");
  await until(()=>evaluate("!![...document.querySelectorAll('button')].find(b=>b.innerText==='Proofread')"));
  await evaluate("document.querySelector('[data-main-input]').focus();true");
  await command('Input.insertText',{text:'He go to school yesterday.'});
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.innerText==='Proofread').click();true");
  await until(async()=>String(await evaluate('document.body.innerText')).includes('went to school yesterday.'));
  await until(()=>{const result=spawnSync('python3',['-c',"import sqlite3,sys,json;c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True);print(json.dumps(c.execute('select source_text,detected_lang,target_lang from proofread_session').fetchall()))",root+'/profile/app.db/db'],{encoding:'utf8'});return result.status===0&&result.stdout.includes('He go to school yesterday.')&&result.stdout.includes('en');});
  await evaluate('window.fetch=globalThis.$communityOriginalFetch;delete globalThis.$communityOriginalFetch;true');
  const proofreadScreenshot=await command('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(reports,'proofread-persistence.png'),Buffer.from(proofreadScreenshot.data,'base64'));
  const check={passed:true,upstream:'1.1.15',source:'The meeting has been moved to Friday.',translation:'会議は金曜日に変更されました。',checks:['fresh isolated profile','Nani account not required','real PLaMo translation rendered','translation persisted in SQLite','ChatGPT-only follow-up reports disconnected','prepare request returns JSON','proofread fixture rendered with diff','proofread fixture persisted with language metadata']};
  writeFileSync(path.join(reports,'e2e.json'),JSON.stringify(check,null,2)+'\n');console.log(JSON.stringify(check));
}catch(error){
  if(socket?.readyState===WebSocket.OPEN)try{writeFileSync(path.join(reports,'failure-state.txt'),await evaluate('document.body.innerText'));}catch{}
  throw error;
}finally{
  socket?.close();if(child.pid){try{process.kill(-child.pid,'SIGTERM');}catch{}await delay(500);try{process.kill(-child.pid,'SIGKILL');}catch{}}
  if(existsSync(root+'/profile/logs/main.log'))copyFileSync(root+'/profile/logs/main.log',path.join(reports,'e2e-main.log'));
  writeFileSync(path.join(reports,'e2e-launch.log'),logs);rmSync(root,{recursive:true,force:true});
}
