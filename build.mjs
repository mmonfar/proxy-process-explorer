// Build: inline styles and scripts into one self-contained, offline HTML file.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const rd=f=>readFileSync(new URL(f,import.meta.url),'utf8');
const parts={STYLES:rd('./src/styles.css'),CORE:rd('./src/core.js'),UI:rd('./src/ui.js')};
for(const [k,v] of Object.entries(parts)) if(/<\/script/i.test(v)) throw new Error(`${k} contains a closing script tag`);
let html=rd('./src/index.html');
html=html.replace('/*@STYLES@*/',()=>parts.STYLES).replace('/*@CORE@*/',()=>parts.CORE).replace('/*@UI@*/',()=>parts.UI);
html=html.replace(/<!--@[A-Z_]+@-->\n?/g,'');
mkdirSync(new URL('./dist/',import.meta.url),{recursive:true});
writeFileSync(new URL('./dist/process_explorer.html',import.meta.url),html);
console.log(`dist/process_explorer.html  ${(html.length/1024).toFixed(0)} KB`);
