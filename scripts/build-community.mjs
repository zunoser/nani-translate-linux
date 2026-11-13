#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {extractAll,createPackageWithOptions} from '@electron/asar';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.resolve(process.argv[2]||'nani-app');
const output=path.resolve(process.argv[3]||'nani-community-app');
if(output===source||output.startsWith(source+path.sep)||source.startsWith(output+path.sep))throw new Error('Source and output must be separate directories');
try{await fs.access(output);throw new Error('Output already exists; choose a fresh output directory');}catch(error){if(error.code!=='ENOENT')throw error;}
const staging=output+'.building-'+process.pid;
const extracted=staging+'-asar';
function replaceOnce(text,from,to){if(text.split(from).length!==2)throw new Error('Unsupported upstream anchor: '+from);return text.replace(from,to);}
try{
  await fs.cp(source,staging,{recursive:true,mode:fs.constants.COPYFILE_FICLONE});
  const archive=path.join(staging,'resources/app.asar');extractAll(archive,extracted);
  const packageFile=path.join(extracted,'package.json');const pkg=JSON.parse(await fs.readFile(packageFile,'utf8'));
  if(pkg.version!=='1.1.15')throw new Error('Community patches support only upstream 1.1.15');
  pkg.name='nani-community';pkg.productName='Nani Community';pkg.main='community/bootstrap.cjs';
  await fs.writeFile(packageFile,JSON.stringify(pkg,null,2));
  const mainFile=path.join(extracted,'out/main/index.js');let main=await fs.readFile(mainFile,'utf8');
  for(const [from,to] of [
    ['function Et(){return c.app.isPackaged||c.app.setName("nani-local"),c.app.getPath("userData")}','function Et(){return c.app.getPath("userData")}'],
    ['async function zt(){','async function zt(){return globalThis.$naniCommunity.settings();'],
    ['async function Gt(e){','async function Gt(e){return Z({globalSettingsCache:globalThis.$naniCommunity.settings()});'],
    ['async function As(e){','async function As(e){return Z({globalSettingsCache:globalThis.$naniCommunity.updateSettings(e)}),{ok:true};'],
    ['async function Ee(){','async function Ee(){return "community-local";'],
    ['C||setInterval(()=>{process.ppid===1&&(o.info("Parent process is gone in dev. Exiting."),c.app.exit(0))},1e3).unref()','void 0'],
    ['openLink:Nc,','openLink:(e,t)=>globalThis.$naniCommunity.redirectAccountLink(t)?true:Nc(e,t),'],
    ['logout:ki,','logout:()=>globalThis.$naniCommunity.openSettings(),'],
    ['navigateToWebLogin:vi,','navigateToWebLogin:()=>globalThis.$naniCommunity.openSettings(),'],
  ])main=replaceOnce(main,from,to);
  main=main.replaceAll('"nani.desktop"','"nani-community.desktop"').replaceAll('Name=Nani Translate','Name=Nani Community');
  await fs.writeFile(mainFile,main);
  const syntax=spawnSync(process.execPath,['--check',mainFile],{encoding:'utf8'});
  if(syntax.status!==0)throw new Error('Patched main syntax check failed: '+syntax.stderr);
  const utilsFile=path.join(extracted,'node_modules/repo-lib/dist/utils/utils.mjs');
  await fs.writeFile(utilsFile,replaceOnce(await fs.readFile(utilsFile,'utf8'),'const n=`naniapp`','const n=`nani-community`'));
  await fs.cp(path.join(root,'runtime/community'),path.join(extracted,'community'),{recursive:true});
  await fs.cp(path.join(root,'node_modules/jose'),path.join(extracted,'node_modules/jose'),{recursive:true});
  const renderer=path.join(extracted,'out/renderer');
  const rendererFile=path.join(renderer,'assets/index-CsMGm5RJ.js');
  let rendererSource=await fs.readFile(rendererFile,'utf8');
  rendererSource=replaceOnce(rendererSource,'const Bo={anon:"",team:"Team",free:"Free",pro:"Pro"}','const Bo={anon:"",team:"Team",free:"Free",pro:"Local"}');
  rendererSource=replaceOnce(rendererSource,'function nr({size:e,label:t="Pro",','function nr({size:e,label:t="Local",');
  await fs.writeFile(rendererFile,rendererSource);
  await fs.copyFile(path.join(root,'runtime/community/renderer.js'),path.join(renderer,'community.js'));
  const htmlFile=path.join(renderer,'index.html');
  await fs.writeFile(htmlFile,replaceOnce(await fs.readFile(htmlFile,'utf8'),'</body>','<script src="./community.js"></script></body>'));
  await fs.rm(archive);await fs.rm(archive+'.unpacked',{recursive:true,force:true});
  await createPackageWithOptions(extracted,archive,{unpack:'{*.node,*.so,xsel}'});
  const launcher=path.join(staging,'start.sh');
  await fs.copyFile(path.join(root,'runtime/community-start.sh.template'),launcher);
  await fs.chmod(launcher,0o755);
  await fs.writeFile(path.join(staging,'community-build.json'),JSON.stringify({variant:'community',upstreamVersion:pkg.version,profile:'nani-community',sourceAsarSha256:createHash('sha256').update(await fs.readFile(path.join(source,'resources/app.asar'))).digest('hex'),asarSha256:createHash('sha256').update(await fs.readFile(archive)).digest('hex')},null,2)+'\n');
  await fs.rename(staging,output);console.log(`Community build: ${output}`);
}finally{await fs.rm(extracted,{recursive:true,force:true});await fs.rm(staging,{recursive:true,force:true});}
