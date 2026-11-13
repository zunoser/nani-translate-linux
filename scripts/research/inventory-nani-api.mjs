#!/usr/bin/env node
import * as asar from '@electron/asar';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const [archive,output]=process.argv.slice(2);
if(!archive||!output) throw new Error('Usage: node inventory-nani-api.mjs APP.ASAR OUTPUT.json');
const pkg=JSON.parse(asar.extractFile(archive,'package.json'));
const files=asar.listPackage(archive).filter(f=>/^\/out\/.*\.js$/.test(f));
const entries=[];const bundles=[];
for(const file of files){
 const source=asar.extractFile(archive,file.slice(1)).toString();
 const matches=[...source.matchAll(/\/api\/[a-zA-Z0-9_\/-]+/g)];
 if(matches.length) bundles.push({file,sha256:createHash('sha256').update(source).digest('hex')});
 for(const m of matches) entries.push({file,offset:m.index,endpoint:m[0]});
}
writeFileSync(output,JSON.stringify({version:pkg.version,scope:'Literal API paths in bundled client JS. Includes references in logging; not server implementation or request counts.',bundles,endpoints:[...new Set(entries.map(e=>e.endpoint))].sort(),references:entries},null,2)+'\n');
console.log(`${new Set(entries.map(e=>e.endpoint)).size} distinct literal paths in ${files.length} JS bundles`);
