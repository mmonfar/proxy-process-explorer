// Zero-trace check: no file in the repository, and nothing the tool exports, may contain the names,
// headers or labels of the environment this scaffold was first built in. The terms are stored only as
// truncated SHA-256 hashes of lowercase word n-grams, so this test does not itself carry them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const core=require('../src/core.js');
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const FORBIDDEN=new Set(["c2bf722bd4e70bb8","1ddaba63c655c4f3","22ff277b10da3a6f","67d76aa5deab509f","39f7f0bb2f321db9","3b33c768dbad3147","05ce55130e6c061e","f8193ba34cc0c3e5","9267fffa694a8e25","4e99d57552d0a194","c54d08fbda5f026a","7e50f3dc7b11a7cb","82f97cdc2904c79e","d43f894326543961","993407b801c4f3ee","c7875c86ccc045d7","af27ba64cc408667","e6217c89791d2add","655af1cadbda1f1f","b520c6096b48db01","c22725e7695bfb35","2b26ad4159487a06","d979ba57ad699450","5487e0e6eb4bc269","9ac1a08950a5dd10","4f53c6c301f98610","1322eb574d7c3fda","59be57e6b1a6e925","2ff71e3110deb206","a0ecedb2a90551bd","761414180d804176","930d8f1185a617e9","5d55da39858da0af","c7affcaf1505a0d6"]);
const h=s=>createHash('sha256').update(s).digest('hex').slice(0,16);
function hits(text){ const tok=text.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[], out=new Set();
  for(let i=0;i<tok.length;i++) for(let n=1;n<=5&&i+n<=tok.length;n++){ const g=tok.slice(i,i+n).join(' '); if(FORBIDDEN.has(h(g))) out.add(`${n}-gram at token ${i}`); }
  return [...out]; }
const SKIP=new Set(['.git','node_modules']);
function files(dir){ return readdirSync(dir).flatMap(f=>{ if(SKIP.has(f)) return []; const p=join(dir,f); return statSync(p).isDirectory()?files(p):[p]; }); }

test('the checker itself detects a planted term', ()=>{
  // one of the hashed terms, spelled backwards here so the source stays clean
  const planted=[...'kooltuo'].reverse().join('');
  assert.ok(hits(`save the ${planted} attachment`).length>0);
  assert.equal(hits('save the e-mail attachment').length,0);
});

test('no repository file carries a trace', ()=>{
  const bad=[];
  for(const f of files(ROOT)){ if(/\.(xlsx|pptx|png|jpg|ico)$/i.test(f)) continue;
    const found=hits(readFileSync(f,'utf8')); if(found.length) bad.push(relative(ROOT,f)+': '+found.join(', ')); }
  assert.deepEqual(bad,[]);
});

test('the sample workbook carries no trace', async ()=>{
  const x=await core.readXlsxRows(readFileSync(join(ROOT,'samples','synthetic_discharges.xlsx')));
  assert.deepEqual(hits(x.sheet+' '+x.rows.map(r=>r.join(' ')).join(' ')),[]);
});

test('an exported slide deck carries no trace', ()=>{
  const {header,rows}=core.synthRows(42,400), t=core.toTable([header,...rows]);
  const B=core.buildRecords(t,core.SAMPLE_CONFIG); core.prepare(B.recs,{weekend:[6,0],basis:'start',vmode:'seq'});
  const ref=core.SCH.happy, A=core.analyse(B.recs,{ref,refKey:core.keyOf(ref,'seq')});
  const bytes=core.buildDeck(A,{scope:'All',period:'p',generated:'g',refLabel:'r',post:false,vmode:'seq',basisLabel:'b',weekendLabel:'w',minN:10,heatLabel:'h',recText:'',dq:[]},{});
  assert.deepEqual(hits(new TextDecoder('utf-8').decode(bytes)),[]);
});
