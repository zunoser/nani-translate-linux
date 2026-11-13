'use strict';
const fs = require('node:fs');
const path = require('node:path');

const defaults = () => ({
  schemaVersion: 1,
  plamo: {url: 'http://127.0.0.1:18765', model: 'plamo-3-translate', form: 'polite', glossary: []},
  settings: {
    globalUserId: 'community-local', isLoggedIn: true, displayName: 'Local', email: '',
    plan: 'pro', isPaid: true, paidPlanExpiresTime: null, paymentStatus: null, isPaymentPastDue: false,
    translateLang: 'en', translateBcp47: null, targetLangBehavior: 'auto', submitKey: 'mod-enter',
    allowParaphrase: true, rubyByLang: {}, preferredModelType: 'fast', avatarUrl: '',
    hiddenStyleTagIds: [], enabledBuiltInTagIds: [], favoriteLangs: [], inAppHotkeys: {},
    interleavedTranslation: false,
  },
  styleTags: [],
});
function validatePlamo(value) {
  const url = new URL(value.url);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('PLaMoの接続先URLが不正です。');
  if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw new Error('PLaMoにはこのPCのローカルサーバーを指定してください。');
  if (typeof value.model !== 'string' || !value.model.trim()) throw new Error('モデル名を入力してください。');
  if (!['plain','polite'].includes(value.form)) throw new Error('文体が不正です。');
  if (!Array.isArray(value.glossary) || value.glossary.length > 200 || value.glossary.some(x=>typeof x.source!=='string'||typeof x.target!=='string'||!x.source.trim()||!x.target.trim())) throw new Error('用語集には原語と訳語を指定してください。');
  return {url:url.href.replace(/\/$/,''),model:value.model.trim(),form:value.form,glossary:value.glossary.map(x=>({source:x.source,target:x.target}))};
}
class Store {
  constructor(directory) {
    this.file=path.join(directory,'community.json');
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
    this.data=defaults();
    if(fs.existsSync(this.file)) {
      const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));
      if(saved.schemaVersion!==1) throw new Error('Unsupported community settings version');
      this.data={...this.data,...saved,settings:{...this.data.settings,...saved.settings},plamo:validatePlamo(saved.plamo)};
    }
  }
  save(){const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.data,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,this.file);}
  settings(){return {...this.data.settings,plan:'pro',isPaid:true,isLoggedIn:true};}
  updateSettings(patch){
    const allowed=['translateLang','translateBcp47','targetLangBehavior','submitKey','allowParaphrase','rubyByLang','preferredModelType','hiddenStyleTagIds','enabledBuiltInTagIds','favoriteLangs','inAppHotkeys','interleavedTranslation','displayName'];
    for(const key of Object.keys(patch)) if(allowed.includes(key)) this.data.settings[key]=patch[key];
    this.save();return this.settings();
  }
  updatePlamo(patch){this.data.plamo=validatePlamo({...this.data.plamo,...patch});this.save();return this.data.plamo;}
}
module.exports={Store,defaults,validatePlamo};
