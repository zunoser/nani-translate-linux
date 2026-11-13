'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes,randomUUID,createHash}=require('node:crypto');
const {createServer}=require('node:http');
const issuer='https://auth.openai.com',resource='https://api.openai.com/v1';
const tokenURL=issuer+'/api/accounts/oauth/token';
const scopes='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
let jwks;
async function verifyIdentity(token,{clientId,nonce,subject}){
  const {jwtVerify,createRemoteJWKSet}=await import('jose');
  jwks??=createRemoteJWKSet(new URL(issuer+'/.well-known/jwks.json'));
  const {payload}=await jwtVerify(token,jwks,{issuer,audience:clientId,requiredClaims:['sub','exp','iat'],clockTolerance:5,algorithms:['RS256','ES256']});
  if(typeof payload.sub!=='string'||!payload.sub||nonce!==undefined&&payload.nonce!==nonce||subject&&payload.sub!==subject)throw new Error('ChatGPTの認証情報を確認できませんでした。');
  return payload;
}
class Auth {
  constructor({directory,store,safeStorage,openExternal,fetchFn=fetch,verify=verifyIdentity}){
    Object.assign(this,{store,safeStorage,openExternal,fetchFn,verify});
    this.file=path.join(directory,'chatgpt-credentials.enc');this.records=[];this.active=null;this.pending=null;this.refreshing=new Map();this.revision=0;
    if(!store.data.hostId){store.data.hostId='urn:uuid:'+randomUUID();store.save();}
    if(this.canPersist()&&fs.existsSync(this.file)){
      const saved=JSON.parse(safeStorage.decryptString(fs.readFileSync(this.file)));this.records=saved.records;this.active=saved.active;
    }
  }
  canPersist(){return this.safeStorage.isEncryptionAvailable()&&this.safeStorage.getSelectedStorageBackend?.()!=='basic_text';}
  save(){if(this.canPersist()){const tmp=this.file+'.tmp';fs.writeFileSync(tmp,this.safeStorage.encryptString(JSON.stringify({records:this.records,active:this.active})),{mode:0o600});fs.renameSync(tmp,this.file);}}
  current(){return this.records.find(r=>r.client_id===this.active);}
  available(){return !!this.current()?.access_token;}
  status(){return {connected:this.available(),active:this.active,persistent:this.canPersist(),pending:!!this.pending,accounts:this.records.map(r=>({id:r.client_id,label:(r.email||'ChatGPT')+' · '+r.client_id.slice(-6),connected:!!r.access_token}))};}
  async tokenRequest(body){
    const response=await this.fetchFn(tokenURL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body),signal:AbortSignal.timeout(30000),redirect:'error'});
    if(!response.ok)throw new Error(`ChatGPT認証に失敗しました（${response.status}）。再度接続してください。`);
    return response.json();
  }
  tokenFields(tokens,old={}){
    const granted=typeof tokens.scope==='string'?tokens.scope.split(/\s+/):old.scopes;
    if(!granted?.includes('chatgpt.tokens.use.direct')||!granted.includes('resource.invoke'))throw new Error('ChatGPTプランの利用が許可されていません。接続時に許可してください。');
    if(typeof tokens.access_token!=='string'||!tokens.access_token||tokens.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(tokens.expires_in)||tokens.expires_in<=0)throw new Error('ChatGPTから不正な認証応答を受け取りました。');
    return {access_token:tokens.access_token,refresh_token:tokens.refresh_token||old.refresh_token,id_token:tokens.id_token||old.id_token,scopes:granted,expires_at:Date.now()+tokens.expires_in*1000};
  }
  async signIn(clientId=null){
    if(this.pending)throw new Error('ログインはすでに進行中です。ブラウザで完了するかキャンセルしてください。');
    const old=clientId?this.records.find(r=>r.client_id===clientId):null;
    if(clientId&&!old)throw new Error('保存済みアカウントが見つかりません。');
    const state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),verifier=randomBytes(64).toString('base64url');
    const generation=this.revision;let consumed=false,timer,redirect,finish,attempt;
    const complete=new Promise((resolve,reject)=>{finish=error=>{clearTimeout(timer);server.close();if(this.pending===attempt)this.pending=null;error?reject(error):resolve(this.status());};});
    // Observe rejection immediately: browser-launch failures can race the callback.
    complete.catch(()=>{});
    const server=createServer(async(req,res)=>{
      const url=new URL(req.url,'http://127.0.0.1');
      if(req.method!=='GET'||url.pathname!=='/auth/callback'){res.writeHead(404).end();return;}
      if(consumed||url.searchParams.get('state')!==state){res.writeHead(400).end('Invalid sign-in state.');return;}
      consumed=true;
      try{
        if(url.searchParams.has('error'))throw new Error('ChatGPT接続がキャンセルされました。');
        const issued=url.searchParams.get('client_id')||old?.client_id,code=url.searchParams.get('code');
        if(!issued||issued==='dynamic_agent_client'||!code||old&&issued!==old.client_id)throw new Error('ChatGPTの登録応答が不正です。');
        const tokens=await this.tokenRequest({grant_type:'authorization_code',client_id:issued,code,code_verifier:verifier,redirect_uri:redirect,resource});
        const identity=await this.verify(tokens.id_token,{clientId:issued,nonce,subject:old?.subject});
        const fields=this.tokenFields(tokens);
        if(generation!==this.revision||!this.pending)throw new Error('ログインはキャンセル済みです。');
        const record={client_id:issued,subject:identity.sub,email:identity.email||'',...fields};
        const existing=this.records.find(r=>r.client_id===issued);
        if(existing&&existing.subject!==record.subject)throw new Error('保存済みアカウントの識別情報が一致しません。');
        this.records=this.records.filter(r=>r.client_id!==issued).concat(record);this.active=issued;this.save();
        res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}).end('Nani Community に接続しました。このタブを閉じてアプリに戻ってください。');finish();
      }catch(error){res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}).end('接続できませんでした。アプリで詳細を確認してください。');finish(error);}
    });
    this.pending=attempt={cancel:()=>{this.revision++;finish(new Error('ログインをキャンセルしました。'));}};
    try{
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
      redirect=`http://127.0.0.1:${server.address().port}/auth/callback`;
      const url=new URL(issuer+'/api/accounts/authorize');
      url.search=new URLSearchParams({client_id:old?.client_id||'dynamic_agent_client',ext_agent_host_id:this.store.data.hostId,response_type:'code',redirect_uri:redirect,scope:scopes,resource,state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),...old?{...(old.id_token?{id_token_hint:old.id_token}:{}),...(old.email?{login_hint:old.email}:{})}:{agent_name_hint:'Nani Community'}}).toString();
      timer=setTimeout(()=>this.pending?.cancel(),10*60*1000);timer.unref();
      await this.openExternal(url.href);
    }catch(error){finish(error);}
    return complete;
  }
  cancel(){this.pending?.cancel();}
  select(id){if(!this.records.some(r=>r.client_id===id))throw new Error('アカウントが見つかりません。');this.active=id;this.revision++;this.save();return this.status();}
  async token(){
    const record=this.current();if(!record?.access_token)throw new Error('Community設定からChatGPTに接続してください。');
    if(record.expires_at>Date.now()+60000)return record.access_token;
    if(!record.refresh_token)throw new Error('ChatGPTに再接続してください。');
    if(!this.refreshing.has(record.client_id)){
      const generation=this.revision;
      const promise=(async()=>{
        const tokens=await this.tokenRequest({grant_type:'refresh_token',client_id:record.client_id,refresh_token:record.refresh_token,resource});
        if(tokens.id_token)await this.verify(tokens.id_token,{clientId:record.client_id,subject:record.subject});
        if(generation!==this.revision)throw new Error('ChatGPT接続が変更されました。');
        Object.assign(record,this.tokenFields(tokens,record));this.save();return record.access_token;
      })().finally(()=>this.refreshing.delete(record.client_id));this.refreshing.set(record.client_id,promise);
    }
    return this.refreshing.get(record.client_id);
  }
  async disconnect(){
    this.cancel();this.revision++;const record=this.current();let revoked=false;
    if(record?.refresh_token)try{
      const discovery=await this.fetchFn(issuer+'/.well-known/openid-configuration',{signal:AbortSignal.timeout(10000)}).then(r=>r.json());
      const endpoint=new URL(discovery.revocation_endpoint);if(endpoint.origin!==issuer)throw new Error('Unexpected revocation endpoint');
      const response=await this.fetchFn(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:record.refresh_token,token_type_hint:'refresh_token',client_id:record.client_id}),signal:AbortSignal.timeout(10000),redirect:'error'});revoked=response.status===200;
    }catch{}else revoked=true;
    if(record)for(const key of ['access_token','refresh_token','id_token','expires_at','scopes'])delete record[key];
    this.save();return {revoked,...this.status()};
  }
}
module.exports={Auth,verifyIdentity};
