'use strict';
const communityButton=document.createElement('button');
communityButton.textContent='Community 設定';communityButton.title='PLaMo・ChatGPTの接続設定';
communityButton.style.cssText='position:fixed;bottom:8px;right:12px;z-index:2147483647;border:1px solid #8296bf;border-radius:6px;background:#f0f4ff;color:#23427e;padding:5px 10px;font:12px system-ui;cursor:pointer';
communityButton.addEventListener('click',()=>window.api.invoke('community:open-settings'));
document.body.append(communityButton);
document.title='Nani Community';

// The upstream entitlement is local in this variant; its badge opens provider settings.
document.addEventListener('click',event=>{
  const button=event.target.closest?.('button');
  if(button?.innerText.trim()==='Local'){event.preventDefault();event.stopImmediatePropagation();window.api.invoke('community:open-settings');}
},true);
