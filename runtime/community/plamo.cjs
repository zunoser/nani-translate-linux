'use strict';
const {validatePlamo}=require('./store.cjs');

async function* parseSSE(body) {
  const reader=body.getReader(),decoder=new TextDecoder();let pending='',data=[];
  const parse=()=>{const raw=data.join('\n');data=[];return raw==='[DONE]'?{done:true}:raw?JSON.parse(raw):null;};
  try {
    while(true){const {done,value}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let end;
      while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end).replace(/\r$/,'');pending=pending.slice(end+1);
        if(!line){const item=parse();if(item)yield item;}else if(line.startsWith('data:'))data.push(line.slice(5).trimStart());
      }
    }
    pending+=decoder.decode();if(pending.startsWith('data:'))data.push(pending.slice(5).trim());const item=parse();if(item)yield item;
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function* translate({config,text,target,source,context,signal,fetchFn=fetch}) {
  config=validatePlamo(config);
  if(!text.trim())throw new Error('翻訳する文章を入力してください。');
  const kwargs={target_lang:target};
  if(source&&source!=='unknown')kwargs.source_lang=source;
  if(target==='ja')kwargs.form=config.form;
  if(context)kwargs.context=context;
  if(config.glossary.length)kwargs.glossary=config.glossary;
  let response;
  try {
    response=await fetchFn(config.url+'/v1/chat/completions',{
      method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},signal:AbortSignal.any([signal,AbortSignal.timeout(120000)].filter(Boolean)),
      body:JSON.stringify({model:config.model,messages:[{role:'user',content:text}],temperature:0,max_tokens:4096,stream:true,
        stop:['<|plamo:tag|>','<|plamo:bos|>'],chat_template_kwargs:kwargs}),
    });
  }catch(error){if(signal?.aborted)throw error;throw new Error('PLaMoに接続できません。Community設定で接続先とサーバーの起動を確認してください。',{cause:error});}
  if(!response.ok){let message;try{message=(await response.json()).error?.message;}catch{}throw new Error(`PLaMo: ${message||response.status}`);}
  if(!response.body)throw new Error('PLaMoから本文が返りませんでした。');
  let finish=null,hasText=false;
  for await(const item of parseSSE(response.body)){
    if(item.error)throw new Error(item.error.message||'PLaMoの推論に失敗しました。');
    const choice=item.choices?.[0];
    const text=choice?.delta?.content;if(text){hasText=true;yield text;}
    if(choice?.finish_reason)finish=choice.finish_reason;
  }
  if(finish==='length')throw new Error('翻訳が出力上限に達しました。原文を短くして再実行してください。');
  if(finish!=='stop'||!hasText)throw new Error('PLaMoの応答が完了しませんでした。もう一度実行してください。');
}
module.exports={parseSSE,translate};
