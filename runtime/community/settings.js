'use strict';
const form=document.querySelector('#plamo'),message=document.querySelector('#message');
async function action(fn){message.textContent='処理中…';document.querySelectorAll('button').forEach(b=>b.disabled=true);try{message.textContent=await fn();}catch(error){message.textContent=error.message;}finally{document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
function config(){return {url:form.elements.url.value,model:form.elements.model.value,form:form.elements.form.value,glossary:form.elements.glossary.value.split('\n').filter(s=>s.trim()).map(line=>{const i=line.indexOf('=');if(i<1)throw new Error('用語集は「原語 = 訳語」の形式で入力してください。');return {source:line.slice(0,i).trim(),target:line.slice(i+1).trim()};})};}
form.addEventListener('submit',e=>{e.preventDefault();action(async()=>{await window.community.savePlamo(config());return '保存しました。';});});
document.querySelector('#test').addEventListener('click',()=>action(async()=>{await window.community.savePlamo(config());return '接続できました：'+await window.community.testPlamo();}));
window.community.status().then(status=>{for(const key of ['url','model','form'])form.elements[key].value=status.plamo[key];form.elements.glossary.value=status.plamo.glossary.map(x=>`${x.source} = ${x.target}`).join('\n');document.querySelector('#profile').textContent=status.profile;}).catch(error=>{message.textContent=error.message;});
const controls=document.querySelector('#chatgpt-controls');
let signingIn=false;
async function renderChatGPT(){
  const {chatgpt}=await window.community.status();controls.replaceChildren();
  document.querySelector('#chatgpt-status').textContent=(chatgpt.connected?'接続済み。解説・要約・会話の内容はOpenAIへ送信します。':'未接続。PLaMoの翻訳はログインなしで利用できます。')+' ChatGPTの契約・利用枠を使用します。'+(!chatgpt.persistent?' この環境では認証情報を保存せず、終了時に破棄します。':'');
  const row=document.createElement('div');row.className='actions';controls.append(row);
  function button(label,fn){const b=document.createElement('button');b.textContent=label;b.addEventListener('click',()=>action(fn));row.append(b);return b;}
  const signin=button(signingIn?'ログインをキャンセル':'Continue with ChatGPT',async()=>{
    if(signingIn){await window.community.cancelSignIn();return 'キャンセルしました。';}
    signingIn=true;renderChatGPT();message.textContent='ブラウザでChatGPTへの接続を完了してください。';
    try{await window.community.signIn(chatgpt.active);return 'ChatGPTに接続しました。';}finally{signingIn=false;await renderChatGPT();}
  });signin.setAttribute('data-oai-siwc-button','');
  if(chatgpt.connected){
    button('切断',async()=>{const r=await window.community.disconnect();await renderChatGPT();return r.revoked?'ChatGPT接続を解除しました。':'このPCの接続を解除しました。サーバーでの失効を確認できなかったため、ChatGPTの設定でも接続を解除してください。';});
    button('接続をテスト',async()=>{await window.community.testChatGPT();return 'ChatGPTで翻訳・説明を生成できました。';});
    const label=document.createElement('label');label.textContent='追加機能に使うモデル';const select=document.createElement('select');label.append(select);controls.append(label);
    try{const models=await window.community.models();for(const model of models){const option=document.createElement('option');option.value=model.slug;option.textContent=model.display_name;select.append(option);}if(models.some(m=>m.slug===chatgpt.model))select.value=chatgpt.model;select.addEventListener('change',()=>action(async()=>{await window.community.selectModel(select.value);return 'モデルを変更しました。';}));}catch(error){message.textContent=error.message;}
  }
  if(chatgpt.accounts.length){
    const label=document.createElement('label');label.textContent='ChatGPTアカウント';const select=document.createElement('select');label.append(select);controls.append(label);
    for(const account of chatgpt.accounts){const option=document.createElement('option');option.value=account.id;option.textContent=account.label;select.append(option);}select.value=chatgpt.active;
    select.addEventListener('change',()=>action(async()=>{await window.community.selectAccount(select.value);await renderChatGPT();return 'アカウントを切り替えました。';}));
    button('別のアカウントを追加',async()=>{signingIn=true;renderChatGPT();try{await window.community.signIn();return '接続しました。';}finally{signingIn=false;await renderChatGPT();}});
  }
  button('利用枠を確認',async()=>{await window.community.usage();return 'ChatGPTの利用状況を開きました。';}).className='secondary';
}
renderChatGPT().catch(error=>{message.textContent=error.message;});
