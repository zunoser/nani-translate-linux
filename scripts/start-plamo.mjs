#!/usr/bin/env node
import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {spawn} from 'node:child_process';
const directory=path.resolve(process.env.NANI_PLAMO_DIR||'build/plamo');
const revision='1cf96ae02133958a20074bfdfab76517bb737d00';
const base=`https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF/resolve/${revision}`;
const files=[
  ['plamo-3-translate-0.8b-Q4_K_M.gguf','70891ec70dc7ab4205745a38307867c2881b99239f20327927633abfe4bc9ec6'],
  ['chat_template.jinja','ad7eb87b161c6792be070d777a9f9da50c9e57a77e1fa5cca3a24b91b6bdb9e9'],
];
const binary=process.env.LLAMA_SERVER||'llama-server';
const probe=spawn(binary,['--version'],{stdio:'ignore'});
await new Promise((resolve,reject)=>{probe.on('error',()=>reject(new Error('llama-serverが必要です。LLAMA_SERVERで実行ファイルを指定するか、llama.cppを導入してください。')));probe.on('exit',code=>code===0?resolve():reject(new Error('llama-serverを起動できません。')));});
await fs.mkdir(directory,{recursive:true});
async function sha256(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
for(const [name,hash] of files){
  const file=path.join(directory,name);
  try{if(await sha256(file)===hash)continue;}catch(error){if(error.code!=='ENOENT')throw error;}
  console.log(`Downloading ${name} (PLaMo 3 Translate 0.8B, Q4_K_M: 約547 MiB)`);
  const response=await fetch(`${base}/${name}`,{signal:AbortSignal.timeout(20*60*1000)});
  if(!response.ok)throw new Error(`Download failed: ${response.status}`);
  const partial=file+'.part-'+process.pid;
  try{await pipeline(response.body,createWriteStream(partial));if(await sha256(partial)!==hash)throw new Error('モデルのSHA-256が一致しません。');await fs.rename(partial,file);}finally{await fs.rm(partial,{force:true});}
}
const threads=process.env.NANI_PLAMO_THREADS||'6';
if(!/^\d+$/.test(threads)||Number(threads)<1)throw new Error('NANI_PLAMO_THREADS must be a positive integer');
console.log('PLaMo: http://127.0.0.1:18765 · 終了はCtrl+C');
const child=spawn(binary,['-m',path.join(directory,files[0][0]),'--chat-template-file',path.join(directory,files[1][0]),'--host','127.0.0.1','--port','18765','-c','4096','-t',threads,'-ngl',process.env.NANI_PLAMO_GPU_LAYERS||'0'],{stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code||0;});
