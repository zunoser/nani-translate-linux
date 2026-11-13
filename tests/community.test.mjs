import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store,validatePlamo} from '../runtime/community/store.cjs';
import {createBackend} from '../runtime/community/backend.cjs';
import {translate} from '../runtime/community/plamo.cjs';
import {ChatGPT} from '../runtime/community/chatgpt.cjs';
import {Auth,verifyIdentity} from '../runtime/community/auth.cjs';
const temp=t=>{const dir=mkdtempSync(path.join(tmpdir(),'nani-community-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;};
const events=items=>new Response(items.map(i=>'data: '+JSON.stringify(i)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
const request=(route,body)=>new Request('https://nani.now'+route,{method:'POST',body:JSON.stringify(body)});
test('settings and glossary persist without upstream identity',t=>{
  const dir=temp(t),store=new Store(dir);store.updateSettings({translateLang:'de',accessToken:'do-not-save',plan:'free'});
  store.updatePlamo({glossary:[{source:'OpenAI',target:'OpenAI'}]});const restored=new Store(dir);
  assert.equal(restored.settings().translateLang,'de');assert.equal(restored.settings().plan,'pro');assert.equal(restored.data.settings.accessToken,undefined);assert.equal(restored.data.plamo.glossary.length,1);
});
test('PLaMo is restricted to a local endpoint',()=>{for(const url of ['https://example.com','file:///tmp/model','http://user:pass@127.0.0.1'])assert.throws(()=>validatePlamo({url,model:'x',form:'plain',glossary:[]}));});
test('PLaMo sends real template language controls and checks completion',async t=>{
  const store=new Store(temp(t));let sent;
  const fetchFn=async(url,options)=>{sent=JSON.parse(options.body);return events([{choices:[{delta:{content:'訳'},finish_reason:null}]},{choices:[{delta:{},finish_reason:'stop'}]}]);};
  let text='';for await(const chunk of translate({config:store.data.plamo,text:'source',target:'ja',source:'en',fetchFn}))text+=chunk;
  assert.equal(text,'訳');assert.equal(sent.chat_template_kwargs.target_lang,'ja');assert.equal(sent.chat_template_kwargs.source_lang,'en');assert.equal(sent.chat_template_kwargs.form,'polite');
  await assert.rejects(async()=>{for await(const chunk of translate({config:store.data.plamo,text:'source',target:'ja',fetchFn:async()=>events([{choices:[{delta:{content:'partial'},finish_reason:'length'}]}])}))void chunk;},/出力上限/);
});
test('translation is locally adapted to Nani events and XML safely',async t=>{
  const store=new Store(temp(t));let call;
  const backend=createBackend({store,translateFn:async function*(args){call=args;yield '<script>&';}});
  const response=await backend.handle(request('/api/ai/translate',{translateData:{sourceText:'Hello',userNativeLangWhenCreated:'ja',translateLangWhenCreated:'en'},messages:[]}));
  const text=await response.text();assert.equal(call.target,'ja');assert.match(text,/&lt;script&gt;&amp;/);assert.match(text,/event: done/);assert.match(text,/sourceLang/);
});
test('follow-up and style requests require explicit ChatGPT connection',async t=>{
  let calls=0;const backend=createBackend({store:new Store(temp(t)),translateFn:async function*(){calls++;yield 'wrong';}});
  const response=await backend.handle(request('/api/ai/translate',{translateData:{sourceText:'Hello'},messages:[{role:'user',content:JSON.stringify({messageType:'follow-up-template',templateType:'summarize-in-bullets'})}]}));
  assert.match(await response.text(),/ChatGPT接続/);assert.equal(calls,0);
});
test('only advanced requests go to the connected general provider',async t=>{
  let generalCalls=0,localCalls=0;
  const backend=createBackend({store:new Store(temp(t)),translateFn:async function*(){localCalls++;yield '訳';},general:{available:()=>true,run:async({emit})=>{generalCalls++;emit('説明');}}});
  await(await backend.handle(request('/api/ai/translate',{translateData:{sourceText:'hello',toLang:'ja'},messages:[]}))).text();
  await(await backend.handle(request('/api/ai/proofread',{proofreadData:{sourceText:'He go.'}}))).text();
  assert.equal(localCalls,1);assert.equal(generalCalls,1);
});
test('unsupported audio and file extraction return actionable JSON errors',async t=>{
  const backend=createBackend({store:new Store(temp(t))});
  const response=await backend.handle(new Request('https://nani.now/api/extract-text',{method:'POST',body:new FormData()}));assert.equal(response.status,501);assert.equal((await response.json()).showUpgrade,false);
  assert.equal((await backend.handle(request('/api/ai/ai-speech',{}))).status,501);
});
test('ChatGPT Responses request uses granted model and waits for terminal completion',async t=>{
  const store=new Store(temp(t));let sent;
  const provider=new ChatGPT({auth:{available:()=>true,token:async()=>'test-only'},store,fetchFn:async(url,options)=>{
    if(url.endsWith('/models'))return Response.json({models:[{slug:'test-model',display_name:'Test',visibility:'list'}]});
    sent=JSON.parse(options.body);return events([{type:'response.output_text.delta',delta:JSON.stringify({suggestion:'He went.',analysis:'過去形に修正',detectedLang:'en',targetLang:'en'})},{type:'response.completed'}]);
  }});
  let metadata=[];let output='';await provider.run({route:'/api/ai/proofread',body:{proofreadData:{sourceText:'He go.'}},emit:(chunk,meta)=>{output+=chunk;if(meta)metadata.push(...meta);}});
  assert.equal(sent.model,'test-model');assert.equal(sent.store,false);assert.equal(sent.stream,true);assert.equal(sent.temperature,undefined);assert.match(output,/<suggest scope="full" intent="fix">He went\./);assert.deepEqual(metadata,[{type:'proofread',detectedLang:'en',targetLang:'en',targetBcp47:null}]);
});
test('ChatGPT does not report success after incomplete or interrupted output',async t=>{
  for(const terminal of [[],[{type:'response.incomplete'}]]){
    const provider=new ChatGPT({auth:{token:async()=>'test'},store:new Store(temp(t)),fetchFn:async()=>events([{type:'response.output_text.delta',delta:'{"text":"partial"}'},...terminal])});provider.catalog=[{slug:'test'}];
    await assert.rejects(provider.answer({route:'/api/ai/summarize',body:{text:'text'}}),/途中|完了/);
  }
});
const mockStorage={isEncryptionAvailable:()=>false};
const tokenResponse={access_token:'test-access',refresh_token:'test-refresh',id_token:'test-id',token_type:'Bearer',scope:'openid resource.invoke chatgpt.tokens.use.direct',expires_in:3600};
test('OAuth verifies state, PKCE, returned client and identity before becoming active',async t=>{
  const directory=temp(t),store=new Store(directory);let authorize,resolveURL;const urlReady=new Promise(r=>resolveURL=r);let tokenBody;
  const auth=new Auth({directory,store,safeStorage:mockStorage,openExternal:async url=>{authorize=new URL(url);resolveURL();},fetchFn:async(url,options)=>{tokenBody=options.body;return Response.json(tokenResponse);},verify:async(token,expected)=>{assert.equal(expected.nonce,authorize.searchParams.get('nonce'));assert.equal(expected.clientId,'oaiapp_test');return {sub:'subject',email:'test@example.invalid'};}});
  const promise=auth.signIn();await urlReady;
  assert.equal(authorize.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(authorize.searchParams.get('agent_name_hint'),'Nani Community');
  const callback=new URL(authorize.searchParams.get('redirect_uri'));callback.search=new URLSearchParams({state:'invalid',code:'code',client_id:'oaiapp_test'});
  assert.equal((await fetch(callback)).status,400);assert.equal(auth.available(),false);
  callback.searchParams.set('state',authorize.searchParams.get('state'));assert.equal((await fetch(callback)).status,200);await promise;
  assert.equal(auth.available(),true);assert.equal(tokenBody.get('client_id'),'oaiapp_test');assert.equal(tokenBody.get('redirect_uri'),authorize.searchParams.get('redirect_uri'));assert.equal(tokenBody.get('code_verifier').length>40,true);
  const hostId=store.data.hostId;new Auth({directory,store,safeStorage:mockStorage});assert.equal(store.data.hostId,hostId);
});
test('OAuth cancellation leaves existing registration intact',async t=>{
  const directory=temp(t),store=new Store(directory);let ready;const opened=new Promise(r=>ready=r);
  const auth=new Auth({directory,store,safeStorage:mockStorage,openExternal:async()=>ready()});
  const promise=auth.signIn();await opened;auth.cancel();await assert.rejects(promise,/キャンセル/);assert.equal(auth.available(),false);
});
test('refresh is serialized and replaces rotating credentials together',async t=>{
  const directory=temp(t);let count=0;
  const auth=new Auth({directory,store:new Store(directory),safeStorage:mockStorage,fetchFn:async()=>{count++;return Response.json({...tokenResponse,id_token:undefined,access_token:'new',refresh_token:'rotated'});}});
  auth.records=[{client_id:'issued',subject:'subject',access_token:'old',refresh_token:'old-refresh',expires_at:0}];auth.active='issued';
  assert.deepEqual(await Promise.all([auth.token(),auth.token()]),['new','new']);assert.equal(count,1);assert.equal(auth.current().refresh_token,'rotated');
});
test('identity verification rejects unsigned JWTs',async()=>{await assert.rejects(verifyIdentity('eyJhbGciOiJub25lIn0.eyJzdWIiOiJmYWtlIn0.',{clientId:'issued',nonce:'nonce'}));});

test('prepare response contains the version required by upstream startup UI',async t=>{
  const backend=createBackend({store:new Store(temp(t))});const response=await backend.handle(request('/api/ai/translate',{prepare:true}));const data=await response.json();assert.equal(data.minVersion,'1.1.15');assert.equal(data.message,null);
});

test('style tags preserve the upstream promptSnippet and defaultSelected contract',async t=>{
  const store=new Store(temp(t)),backend=createBackend({store});
  const body={name:'簡潔',promptSnippet:'Keep the translation concise.',defaultSelected:true,langs:null};
  const created=await(await backend.handle(request('/api/common/style-tags',body))).json();assert.deepEqual(created.styleTag,{id:created.styleTag.id,...body});
  const list=await(await backend.handle(new Request('https://nani.now/api/common/style-tags'))).json();assert.equal(list.styleTags[0].promptSnippet,body.promptSnippet);
  await backend.handle(new Request('https://nani.now/api/common/style-tags/'+created.styleTag.id,{method:'DELETE'}));assert.equal(store.data.styleTags.length,0);
});
