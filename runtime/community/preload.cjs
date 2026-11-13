'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('community',Object.freeze({
  signIn:id=>ipcRenderer.invoke('community:sign-in',id),
  cancelSignIn:()=>ipcRenderer.invoke('community:cancel-sign-in'),
  disconnect:()=>ipcRenderer.invoke('community:disconnect'),
  selectAccount:id=>ipcRenderer.invoke('community:select-account',id),
  models:()=>ipcRenderer.invoke('community:models'),
  selectModel:slug=>ipcRenderer.invoke('community:select-model',slug),
  usage:()=>ipcRenderer.invoke('community:usage'),
  testChatGPT:()=>ipcRenderer.invoke('community:test-chatgpt'),
  status:()=>ipcRenderer.invoke('community:status'),
  savePlamo:config=>ipcRenderer.invoke('community:save-plamo',config),
  testPlamo:()=>ipcRenderer.invoke('community:test-plamo'),
}));
