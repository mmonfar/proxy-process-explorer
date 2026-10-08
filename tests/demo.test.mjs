// Hero demo: step timeline and state machine. Synthetic data only.
// The facts are produced by the real engine; the page plays back exactly what stateAt() returns.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {buildFacts} from '../src/demo/facts.mjs';
const require=createRequire(import.meta.url);
const TL=require('../src/demo/timeline.js');
const core=require('../src/core.js');
const F=buildFacts();

// every number and string in a state must be finite and printable: no NaN, undefined, null or Infinity
function scan(v,path,bad){
  if(typeof v==='number'){ if(!Number.isFinite(v)) bad.push(path+'='+v); }
  else if(typeof v==='string'){ if(/NaN|undefined|null|Infinity|\[object/.test(v)||v==='') bad.push(path+'="'+v+'"'); }
  else if(v==null) bad.push(path+' is '+v);
  else if(typeof v==='object') for(const k of Object.keys(v)) scan(v[k],path+'.'+k,bad);
}

test('the whole loop is 25 to 40 seconds and the steps are contiguous', ()=>{
  assert.ok(TL.TOTAL>=25000&&TL.TOTAL<=40000, 'total '+TL.TOTAL);
  assert.equal(TL.STEPS[0].from,0);
  TL.STEPS.forEach((s,i)=>{ assert.ok(s.to>s.from); if(i) assert.equal(s.from,TL.STEPS[i-1].to); assert.ok(s.caption.length>20,'each step has a plain-words caption'); });
});

test('no NaN, empty or undefined state at any moment (every 50 ms, plus out-of-range times)', ()=>{
  const bad=[];
  for(let t=-500;t<=TL.TOTAL+2000;t+=50){ const s=TL.stateAt(F,t); scan({...s,cols:s.cols.map(c=>c.label+c.role),flow:s.flow,rules:s.rules,counters:s.counters},'t'+t,bad); if(bad.length>5) break; }
  assert.deepEqual(bad,[]);
});

test('counters only ever count up, and never exceed the engine totals', ()=>{
  let prev={checked:0,breaks:0}, prevPct=null;
  for(let t=0;t<=TL.TOTAL;t+=20){ const c=TL.stateAt(F,t).counters;
    assert.ok(c.checked>=prev.checked&&c.breaks>=prev.breaks,'monotonic at '+t);
    assert.ok(c.checked<=F.totals.checked&&c.breaks<=F.totals.breaks);
    assert.ok(c.onTimePct>=0&&c.onTimePct<=100); assert.equal(c.onTimeText,c.onTimeKnown?c.onTimePct+'%':'–');
    prev=c; }
});

test('final counters equal the engine results on the sample', ()=>{
  const {header,rows}=core.synthRows(42,1200), cfg=core.normaliseConfig(core.SAMPLE_CONFIG);
  const B=core.buildRecords(core.toTable([header,...rows],'synthetic'),cfg);
  core.prepare(B.recs,{post:false,weekend:[6,0],basis:'start',vmode:'seq'});
  const S=core.SCH, ref=S.happy.slice(), rules=core.applyRules(B.recs,cfg);
  const A=core.analyse(B.recs,{ref,refKey:core.keyOf(ref,'seq'),minN:10,rules});
  const RS=core.ruleSummary(B.recs,rules,cfg);
  const fin=TL.finalState(F);
  assert.equal(fin.counters.checked,A.view.length);
  assert.equal(fin.counters.breaks,RS.reduce((a,x)=>a+x.breach,0));
  assert.equal(fin.counters.onTimePct,Math.round(A.st.due*100));
  fin.rules.forEach((r,i)=>{ assert.equal(r.met,RS[i].met); assert.equal(r.breach,RS[i].breach); assert.equal(r.label,RS[i].label); });
  assert.equal(F.happy.length,ref.length);
  assert.equal(fin.counters.checked,1197,'sample size is stable (seed 42)');
});

test('the happy flow snaps into the real order and all columns are detected', ()=>{
  const s0=TL.stateAt(F,TL.T.snap[0]-1), s1=TL.stateAt(F,TL.T.snap[1]+1);
  assert.ok(s0.flow.some((f,i)=>f.pos!==i),'starts jumbled');
  s1.flow.forEach((f,i)=>{ assert.equal(f.pos,i); assert.ok(f.snapped); });
  const last=TL.stateAt(F,TL.T.chips[1]+1); assert.ok(last.cols.every(c=>c.lit));
  assert.ok(TL.stateAt(F,0).cols.every(c=>!c.lit));
});

test('findings are real-engine numbers in plain words, 3 of them, all shown at the end', ()=>{
  assert.equal(F.findings.length,3);
  assert.equal(TL.finalState(F).cards,3); assert.equal(TL.stateAt(F,0).cards,0);
  assert.match(F.findings[0].head,/^\d+%$/); assert.equal(F.findings[0].head,Math.round(F.totals.onTime*100)+'%');
});

test('map draws progressively and is complete at the end; the map comes from the real renderer', ()=>{
  assert.equal(TL.stateAt(F,TL.T.map[0]).mapP,0); assert.equal(TL.stateAt(F,TL.T.map[1]).mapP,1);
  assert.match(F.map.svg,/^<svg /); assert.ok(!/ width="\d+" height="\d+"/.test(F.map.svg.match(/^<svg[^>]*>/)[0]),'scales with its container');
});

test('built page is standalone: no network, no upload, no external script or style', ()=>{
  const html=readFileSync(new URL('../dist/demo.html',import.meta.url),'utf8');
  assert.ok(/connect-src 'none'/.test(html));
  assert.ok(!/<script[^>]+src=/i.test(html)&&!/<link[^>]+href=/i.test(html)&&!/type="file"|fetch\(|XMLHttpRequest/.test(html));
  assert.ok(/prefers-reduced-motion/.test(html)&&/id="play"/.test(html)&&/id="replay"/.test(html));
  assert.ok(html.includes('Try it with the sample')&&html.includes('github.com/mmonfar/proxy-process-explorer'));
  assert.ok(!/\/\*@[A-Z]+@\*\//.test(html),'all placeholders replaced');
});
