'use strict';
const {app,BrowserWindow,ipcMain,session,net,safeStorage,shell}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {Store}=require('./store.cjs');
const {createBackend}=require('./backend.cjs');
function initialize(){
  const store=new Store(app.getPath('userData'));
  let window=null,backend,auth,general;
  const ready=app.whenReady().then(()=>{
    auth=new (require('./auth.cjs').Auth)({directory:app.getPath('userData'),store,safeStorage,openExternal:url=>shell.openExternal(url)});
    general=new (require('./chatgpt.cjs').ChatGPT)({auth,store});
  });
  app.on('before-quit',()=>{auth?.cancel();general?.cancelAll();});
  const settingsURL=pathToFileURL(path.join(__dirname,'settings.html')).href;
  const appURL=pathToFileURL(path.join(__dirname,'../out/renderer/index.html')).href;
  function openSettings(){
    if(window&&!window.isDestroyed()){window.show();window.focus();return;}
    window=new BrowserWindow({title:'Nani Community — 接続設定',width:680,height:720,minWidth:540,minHeight:550,autoHideMenuBar:true,
      webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',e=>e.preventDefault());
    window.loadURL(settingsURL);window.on('closed',()=>{window=null;});
  }
  const trusted=(event,settingsOnly=false)=>{
    const url=event.senderFrame?.url?.split('#')[0];
    if(url!==settingsURL&&(settingsOnly||url!==appURL))throw new Error('Untrusted community IPC sender');
  };
  const handle=(name,fn,only=true)=>ipcMain.handle('community:'+name,(event,...args)=>{trusted(event,only);return fn(...args);});
  handle('open-settings',openSettings,false);
  handle('status',async()=>{await ready;return {plamo:store.data.plamo,chatgpt:{...auth.status(),model:store.data.chatgptModel},profile:app.getPath('userData')};});
  handle('sign-in',async id=>{await ready;general.cancelAll();return auth.signIn(id);});
  handle('cancel-sign-in',()=>auth.cancel());
  handle('disconnect',()=>{general.cancelAll();general.catalog=[];return auth.disconnect();});
  handle('select-account',id=>{general.cancelAll();general.catalog=[];return auth.select(id);});
  handle('models',()=>general.models());
  handle('select-model',slug=>general.selectModel(slug));
  handle('usage',()=>shell.openExternal('https://chatgpt.com/settings/usage'));
  handle('test-chatgpt',async()=>{let output='';await general.run({route:'/api/ai/translate',body:{translateData:{sourceText:'Hello.',toLang:'ja'}},messages:[],emit:t=>{output+=t;}});return output;});
  handle('save-plamo',config=>store.updatePlamo(config));
  handle('test-plamo',async()=>{
    const {translate}=require('./plamo.cjs');let text='';
    for await(const chunk of translate({config:store.data.plamo,text:'Hello, world.',target:'ja'}))text+=chunk;
    return text;
  });
  app.whenReady().then(()=>{
    const backendReady=ready.then(async()=>{
      const {lzDecompress}=await import('../node_modules/repo-core/dist/lz.mjs');
      backend=createBackend({store,decode:lzDecompress,general});return backend;
    });
    session.defaultSession.protocol.handle('https',request=>{
      const url=new URL(request.url);
      if(url.hostname==='nani.now'&&url.pathname.startsWith('/api/'))return backendReady.then(local=>local.handle(request));
      return net.fetch(request,{bypassCustomProtocolHandlers:true});
    });
  }).catch(error=>{console.error('Community startup failed',error);app.exit(1);});
  function redirectAccountLink(value){
    try{const url=new URL(value,'https://nani.now');if(url.hostname==='nani.now'&&/\/(billing-portal|checkout|login|team)(\/|$)/.test(url.pathname)){openSettings();return true;}}catch{}return false;
  }
  return {redirectAccountLink,settings:()=>store.settings(),updateSettings:patch=>store.updateSettings(patch),openSettings};
}
module.exports={initialize};
