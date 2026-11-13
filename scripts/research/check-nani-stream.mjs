#!/usr/bin/env node
// Runs the actual stream manager extracted from a local Nani 1.1.15 bundle.
// No production server, account, profile or installed app is used.
import * as asar from '@electron/asar';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const [archive, output, translationFile] = process.argv.slice(2);
if (!archive || !output) throw new Error('Usage: node check-nani-stream.mjs APP.ASAR OUTPUT.json [translation-results.json]');
const pkg = JSON.parse(asar.extractFile(archive, 'package.json'));
assert.equal(pkg.version, '1.1.15', 'Review extraction anchors for other releases');
const filename = asar.listPackage(archive).find(f => /\/out\/renderer\/assets\/index.*\.js$/.test(f) && asar.extractFile(archive, f.slice(1)).toString().includes('class Tf{'));
assert.ok(filename);
const source = asar.extractFile(archive, filename.slice(1)).toString();
const start = source.indexOf('function v1({prefix:');
const end = source.indexOf(',Lf=c.createContext(null)', start);
assert.ok(start > 0 && end > start);
const context = vm.createContext({console, setTimeout, clearTimeout, setInterval, clearInterval, TextDecoder, AbortController, Response});
vm.runInContext(source.slice(start, end) + ';globalThis.AuditManager=Tf;', context);
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const encode = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const fixtures = [{id:'synthetic-escaping', text:'日本語 & <tag> "quoted"', lang:'ja'}];
if (translationFile) {
  for (const r of JSON.parse(readFileSync(translationFile, 'utf8')).results) {
    if (r.kind === 'translation' && r.output) fixtures.push({id:r.id,text:r.output,lang:r.target});
  }
}
const results = [];
for (const fixture of fixtures) {
  const wrapped = `<t><result lang="${fixture.lang}">${escape(fixture.text)}</result></t>`;
  const metadata = {type:'lang',sourceLang:'en',toLang:fixture.lang};
  const wire = encode('chunk',{text:wrapped.slice(0,13),meta:[metadata]}) + encode('chunk',{text:wrapped.slice(13)}) + encode('done',{finished_reason:'stop'});
  // Split every byte, including multibyte Japanese UTF-8 sequences.
  const bytes = new TextEncoder().encode(wire);
  const manager = new context.AuditManager({fetchFn:async()=>new Response(new ReadableStream({start(controller){for(const b of bytes) controller.enqueue(new Uint8Array([b]));controller.close();}}))});
  try {
    manager.initSession('audit',[]);
    await manager.streamChat('audit',[],{api:'http://unused.invalid',body:{}});
    const snapshot = JSON.parse(JSON.stringify(manager.getSnapshot('audit')));
    assert.equal(snapshot.status,'ready');
    assert.equal(snapshot.finishedReason,'stop');
    assert.equal(snapshot.messages.at(-1).content,wrapped);
    assert.deepEqual(snapshot.metadata,[metadata]);
    results.push({id:fixture.id,pass:true,status:snapshot.status,content:snapshot.messages.at(-1).content});
  } finally {manager.dispose();}
}
for (const [id,wire,expected] of [
  ['missing-done',encode('chunk',{text:'partial'}),'error'],
  ['explicit-error',encode('error',{message:'local inference failed'}),'error'],
]) {
  const manager = new context.AuditManager({fetchFn:async()=>new Response(wire)});
  try {
    manager.initSession(id,[]);
    await manager.streamChat(id,[],{api:'http://unused.invalid',body:{}});
    const actual=manager.getSnapshot(id);
    assert.equal(actual.status,expected);
    results.push({id,pass:true,status:actual.status,error:actual.error?.message});
  } finally {manager.dispose();}
}
// Optional live model -> adapter -> original Nani consumer integration probe.
if (process.env.PLAMO_AUDIT_URL) {
  const base = new URL(process.env.PLAMO_AUDIT_URL);
  assert.equal(base.hostname, '127.0.0.1');
  let generated = '';
  const manager = new context.AuditManager({fetchFn:async (_url, options)=>{
    const request=JSON.parse(options.body);
    const modelResponse=await fetch(new URL('/v1/chat/completions',base),{
      method:'POST',headers:{'Content-Type':'application/json'},signal:options.signal,
      body:JSON.stringify({model:'plamo-3-translate',messages:[{role:'user',content:request.translateData.sourceText}],
        temperature:0,max_tokens:256,stream:true,stop:['<|plamo:tag|>','<|plamo:bos|>'],chat_template_kwargs:{target_lang:'ja'}}),
    });
    assert.ok(modelResponse.ok);
    return new Response(new ReadableStream({async start(controller){
      const emit=(name,data)=>controller.enqueue(new TextEncoder().encode(encode(name,data)));
      try {
        emit('chunk',{text:'<t><result lang="ja">',meta:[{type:'lang',sourceLang:'en',toLang:'ja'}]});
        const decoder=new TextDecoder();let pending='',finished=false;
        for await(const bytes of modelResponse.body){
          pending+=decoder.decode(bytes,{stream:true});
          const lines=pending.split('\n');pending=lines.pop();
          for(const line of lines){
            if(!line.startsWith('data:'))continue;
            const raw=line.slice(5).trim();if(raw==='[DONE]'||!raw)continue;
            const item=JSON.parse(raw),choice=item.choices?.[0];
            const delta=choice?.delta?.content;
            if(delta){generated+=delta;emit('chunk',{text:escape(delta)});}
            if(choice?.finish_reason==='stop')finished=true;
          }
        }
        assert.ok(finished,'Model stream must finish normally');
        emit('chunk',{text:'</result></t>'});emit('done',{finished_reason:'stop'});controller.close();
      }catch(error){controller.error(error);}
    }}));
  }});
  try {
    manager.initSession('live',[]);
    await manager.streamChat('live',[],{api:'http://unused.invalid/api/ai/translate',body:{translateData:{sourceText:'Please save your changes before closing the window.',toLang:'ja'}}});
    const snapshot=manager.getSnapshot('live');
    assert.equal(snapshot.status,'ready',snapshot.error?.message);
    assert.ok(generated.trim());
    assert.equal(snapshot.messages.at(-1).content,`<t><result lang="ja">${escape(generated)}</result></t>`);
    results.push({id:'live-plamo-stream-adapter',pass:true,status:snapshot.status,output:generated});
  } finally {manager.dispose();}
}
const report={version:pkg.version,bundle:filename,bundleSha256:createHash('sha256').update(source).digest('hex'),scope:'Actual upstream stream manager in Node VM; not renderer UI or production API',results};
writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
