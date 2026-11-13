'use strict';
const {randomUUID}=require('node:crypto');
const {translate}=require('./plamo.cjs');
const escapeXML=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const unsupported=()=>{throw new Error('この機能にはChatGPT接続が必要です。Community設定から接続してください。');};
function detect(text,hint='en') {
  if(/[\u3040-\u30ff]/u.test(text))return 'ja';
  if(/[\uac00-\ud7af]/u.test(text))return 'ko';
  if(/[\u4e00-\u9fff]/u.test(text))return hint==='ja'?'ja':'zh';
  if(/[\u0400-\u04ff]/u.test(text))return 'ru';
  if(/[\u0600-\u06ff]/u.test(text))return 'ar';
  // This fallback supports the default Japanese/English workflow. Explicit target
  // selection remains available for ambiguous or other Latin-script languages.
  return 'en';
}
function streamResponse(run,signal) {
  const abort=new AbortController();const combined=AbortSignal.any([abort.signal,signal].filter(Boolean));
  return new Response(new ReadableStream({
    async start(controller){
      const emit=(event,data)=>{if(!combined.aborted)controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));};
      try{await run((text,meta)=>emit('chunk',{text,...meta?{meta}: {}}),combined);if(!combined.aborted)emit('done',{finished_reason:'stop'});}
      catch(error){if(!combined.aborted)emit('error',{message:error.message||String(error)});}
      finally{if(!abort.signal.aborted)try{controller.close();}catch{}}
    },cancel(){abort.abort();},
  }),{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store'}});
}
function createBackend({store,decode=text=>text,translateFn=translate,general=null}) {
  async function handle(request){
    try{
      const url=new URL(request.url),route=url.pathname;
      if(route==='/api/extract-text')return json({ok:false,message:'画像・ファイルからの文字抽出はCommunity版では未対応です。テキストを貼り付けてください。',showUpgrade:false},501);
      if(route==='/api/ai/ai-speech')return json({message:'読み上げはCommunity版では未対応です。'},501);
      const body=['GET','HEAD','DELETE'].includes(request.method)?{}:await request.json();
      const settings=store.settings();
      if(route==='/api/ai/translate'&&body.prepare===true)return json({ok:true,minVersion:'1.1.15',message:null});
      if(route==='/api/test/ping')return json({ok:true});
      if(route==='/api/desktop/v1/global-app-settings')return json({globalAppSettings:settings});
      if(route==='/api/common/app-settings')return json({appSettings:store.updateSettings(body)});
      if(route==='/api/common/team-summary')return json({teamSummary:null});
      if(route==='/api/common/style-tags'&&request.method==='GET')return json({styleTags:store.data.styleTags});
      if(route.startsWith('/api/common/style-tags')){
        const id=route.split('/')[4];
        if(request.method==='DELETE')store.data.styleTags=store.data.styleTags.filter(t=>t.id!==id);
        else {
          if(typeof body.name!=='string'||!body.name.trim()||body.name.length>20||typeof body.promptSnippet!=='string'||!body.promptSnippet.trim()||body.promptSnippet.length>420||typeof body.defaultSelected!=='boolean'||body.langs!==null&&(!Array.isArray(body.langs)||body.langs.some(lang=>typeof lang!=='string')))throw new Error('スタイル名・指示・対象言語を確認してください。');
          if(!id&&store.data.styleTags.length>=20)throw new Error('スタイルは20件まで保存できます。');
          const tag={id:id||randomUUID(),name:body.name,promptSnippet:body.promptSnippet,defaultSelected:body.defaultSelected,langs:body.langs};
          store.data.styleTags=store.data.styleTags.filter(t=>t.id!==tag.id).concat(tag);store.save();return json({styleTag:tag});
        }
        store.save();return json({ok:true});
      }
      if(route==='/api/ai/detect-text-language')return json({ok:true,data:{lang:detect(String(body.text||''),body.hintLang)}});
      if(['/api/common/checkout-link','/api/common/portal-link','/api/desktop/exchange-token'].includes(route))return json({message:'Community版にはNaniの契約・ログインは不要です。'},400);
      if(!route.startsWith('/api/ai/')&&route!=='/api/ai-quick-review')return json({message:'Community版で未対応の機能です。'},404);
      if(route==='/api/ai/ruby')return json({message:'ルビの生成はCommunity版では未対応です。'},501);
      if(route==='/api/ai/vocabulary'){
        if(!general?.available())return json({message:'単語の解説にはChatGPT接続が必要です。Community設定から接続してください。'},503);
        const data=await general.answer({route,body,signal:request.signal});
        if(!Array.isArray(data.entries)||data.entries.some(e=>!e||typeof e.term!=='string'||typeof e.lemma!=='string'||typeof e.phonetic!=='string'||!Array.isArray(e.meanings)||!Array.isArray(e.synonyms)||!['common','moderate','rare'].includes(e.frequency)))throw new Error('ChatGPTの単語解説の形式が不正です。再実行してください。');
        return json({data});
      }
      return streamResponse(async(emit,signal)=>{
        const messages=(body.messages||[]).map(m=>({...m,content:decode(m.content)}));
        let last={messageType:'initial'};const user=messages.findLast(m=>m.role==='user');
        if(user&&user.content!=='-')try{last=JSON.parse(user.content);}catch{last={messageType:'follow-up-free',displayText:user.content};}
        const data=body.translateData||{};
        if(route==='/api/ai/translate'&&body.preferredModelType==='advanced'){
          if(general?.available())return general.run({route,body,messages,last,emit,signal});
          throw new Error('高度なモデルを使うにはCommunity設定からChatGPTに接続してください。基本の翻訳には高速モデル（PLaMo）を選んでください。');
        }
        let text,target,source,context='',wrapper='plain';
        if(route==='/api/ai/translate'&&['initial','outgoing-reply'].includes(last.messageType)&&!data.inlineContextOnly&&!last.inlineContextOnly){
          text=last.messageType==='outgoing-reply'?last.source:data.sourceText;
          source=data.sourceLang||detect(text,data.userNativeLangWhenCreated);
          const native=data.userNativeLangWhenCreated||'ja',other=data.translateLangWhenCreated||settings.translateLang||'en';
          target=data.toLang||(body.targetLangBehavior==='fixed'?other:source===native?other:native);
          context=(last.inlineContexts||data.inlineContexts||[]).join('\n');wrapper='translation';
          if(data.customStyleInstruction||data.tagsDump?.length){
            // Free-form style instructions require an instruction-following model.
            if(general?.available())return general.run({route,body,messages,last,emit,signal});
            throw new Error('自由なスタイル指定にはChatGPT接続が必要です。PLaMoの文体・用語はCommunity設定で指定できます。');
          }
        }else if(route==='/api/ai/back-translate'){text=body.text;target=body.userNativeLang;wrapper='result';}
        else if(route==='/api/ai/incoming-reply-translate'){text=body.source;target=body.userNativeLang;context=(body.context||[]).map(x=>`${x.speaker}: ${x.text}`).join('\n');}
        else {if(general?.available())return general.run({route,body,messages,last,emit,signal});return unsupported();}
        if(typeof text!=='string'||typeof target!=='string'||! /^[a-z]{2,3}(?:-[a-z]{4})?$/.test(target))throw new Error('原文または翻訳先言語が不正です。');
        if(wrapper==='translation')emit(`<t><result lang="${target}">`,[{type:'lang',sourceLang:source||'unknown',toLang:target,usedModelRank:'low'}]);
        else if(wrapper==='result')emit('<result>');
        for await(const chunk of translateFn({config:store.data.plamo,text,target,source,context,signal}))emit(wrapper==='plain'?chunk:escapeXML(chunk));
        if(wrapper==='translation')emit('</result></t>');else if(wrapper==='result')emit('</result>');
      },request.signal);
    }catch(error){return json({message:error.message||String(error)},400);}
  }
  return {handle};
}
module.exports={createBackend,streamResponse,escapeXML,detect};
