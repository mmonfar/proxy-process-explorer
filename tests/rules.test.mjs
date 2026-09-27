// Rules engine and risk analysis: pure functions of (setup, cases). Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const core=require('../src/core.js');
const sampleCfg=JSON.parse(readFileSync(new URL('../samples/synthetic_discharges.setup.json',import.meta.url),'utf8'));

// A tiny process: start -> mid -> end, one row per scenario.
const CFG={name:'Tiny',columns:{id:{role:'id'},start_at:{role:'step',label:'Start'},mid_at:{role:'step',label:'Mid'},end_at:{role:'step',label:'End'}},
  stepOrder:['start_at','mid_at','end_at'],happyFlow:['start_at','mid_at','end_at'],rules:[]};
function cases(rows){ const t=core.toTable([['id','start_at','mid_at','end_at'],...rows]); const B=core.buildRecords(t,CFG); return Object.fromEntries(B.recs.map(r=>[r.id,r])); }
const ev=(rule,r)=>core.evalRule(rule,r,core.SCH);

test('within: limit, boundary, missing steps, countMissing', ()=>{
  const C=cases([['ok','2026-01-05 09:00','2026-01-05 09:45','2026-01-05 12:00'],['edge','2026-01-05 09:00','2026-01-05 10:00','2026-01-05 12:00'],
    ['late','2026-01-05 09:00','2026-01-05 10:01','2026-01-05 12:00'],['noMid','2026-01-05 09:00','','2026-01-05 12:00'],['noStart','','2026-01-05 10:00','2026-01-05 12:00']]);
  const r={id:'w',type:'within',a:'start_at',b:'mid_at',max:60};
  assert.deepEqual(ev(r,C.ok),{s:'met',v:45});
  assert.equal(ev(r,C.edge).s,'met','exactly at the limit is met');
  assert.deepEqual(ev(r,C.late),{s:'breach',v:61,why:'over the limit'});
  assert.equal(ev(r,C.noMid).s,'na'); assert.equal(ev(r,C.noStart).s,'na');
  assert.equal(ev({...r,countMissing:true},C.noMid).s,'breach','a missing second step counts when asked');
  assert.equal(ev({...r,countMissing:true},C.noStart).s,'na','a missing first step is never a breach');
});

test('order: out-of-order steps breach, equal times meet, missing is not evaluable', ()=>{
  const C=cases([['fine','2026-01-05 09:00','2026-01-05 09:30','2026-01-05 12:00'],['same','2026-01-05 09:00','2026-01-05 09:00','2026-01-05 12:00'],
    ['swap','2026-01-05 09:00','2026-01-05 08:40','2026-01-05 12:00'],['gap','2026-01-05 09:00','','2026-01-05 12:00']]);
  const r={id:'o',type:'order',a:'start_at',b:'mid_at'};
  assert.equal(ev(r,C.fine).s,'met'); assert.equal(ev(r,C.same).s,'met');
  assert.deepEqual(ev(r,C.swap),{s:'breach',v:-20,why:'recorded earlier'});
  assert.equal(ev(r,C.gap).s,'na');
});

test('present', ()=>{
  const C=cases([['has','2026-01-05 09:00','2026-01-05 09:30','2026-01-05 12:00'],['lacks','2026-01-05 09:00','','2026-01-05 12:00']]);
  const r={id:'p',type:'present',a:'mid_at'};
  assert.equal(ev(r,C.has).s,'met'); assert.equal(ev(r,C.lacks).s,'breach');
});

test('clock on the step\'s own day, including just before and after midnight', ()=>{
  const C=cases([['early','2026-01-05 08:00','2026-01-05 09:00','2026-01-05 11:59'],['noon','2026-01-05 08:00','2026-01-05 09:00','2026-01-05 12:00'],
    ['late','2026-01-05 08:00','2026-01-05 09:00','2026-01-05 23:55'],['after0','2026-01-05 22:00','2026-01-05 23:00','2026-01-06 00:10']]);
  const r={id:'c',type:'clock',a:'end_at',time:'12:00',anchor:'own'};
  assert.deepEqual(ev(r,C.early),{s:'met',v:-1}); assert.equal(ev(r,C.noon).s,'breach','the deadline itself is not "before"');
  assert.equal(ev(r,C.late).s,'breach');
  assert.equal(ev(r,C.after0).s,'met','00:10 is before 12:00 on its own (new) day');
  // a deadline just after midnight: 23:55 misses 00:30 on its own day
  assert.equal(ev({...r,time:'00:30'},C.late).s,'breach'); assert.equal(ev({...r,time:'00:30'},C.after0).s,'met');
});

test('clock anchored to the start day crosses midnight correctly', ()=>{
  const C=cases([['overnight','2026-01-05 22:00','2026-01-06 01:00','2026-01-06 09:30'],['sameDay','2026-01-05 07:00','2026-01-05 08:00','2026-01-05 09:30'],
    ['nextLate','2026-01-05 22:00','2026-01-06 01:00','2026-01-06 10:30'],['twoDays','2026-01-05 22:00','2026-01-06 01:00','2026-01-07 08:00'],['noStart','','2026-01-06 01:00','2026-01-06 09:00']]);
  const nextDay={id:'n',type:'clock',a:'end_at',time:'10:00',anchor:'start',dayOffset:1};
  assert.equal(ev(nextDay,C.overnight).s,'met','started 22:00, ended 09:30 next morning: before 10:00 the day after the start');
  assert.equal(ev(nextDay,C.sameDay).s,'met');
  assert.deepEqual(ev(nextDay,C.nextLate),{s:'breach',v:30,why:'after the deadline'});
  assert.equal(ev(nextDay,C.twoDays).s,'breach');
  assert.equal(ev(nextDay,C.noStart).s,'na','no start time means no deadline');
  const sameDay={id:'s',type:'clock',a:'end_at',time:'23:59',anchor:'start',dayOffset:0};
  assert.equal(ev(sameDay,C.overnight).s,'breach','ending after midnight misses a same-day deadline');
  assert.equal(core.ruleDeadline(nextDay,C.overnight,core.SCH).toISOString(),'2026-01-06T10:00:00.000Z');
});

test('rule problems and labels', ()=>{
  const c=core.normaliseConfig(CFG);
  assert.deepEqual(core.ruleProblems({type:'within',a:'start_at',b:'mid_at',max:30},c),[]);
  assert.ok(core.ruleProblems({type:'within',a:'start_at',b:'start_at',max:30},c).length);
  assert.ok(core.ruleProblems({type:'within',a:'start_at',b:'mid_at',max:0},c).length);
  assert.ok(core.ruleProblems({type:'clock',a:'end_at',time:'25:00'},c).length);
  assert.ok(core.ruleProblems({type:'order',a:'start_at',b:'id'},c).length,'a non-step column is rejected');
  assert.equal(core.ruleLabel({type:'within',a:'start_at',b:'mid_at',max:90},c),'Mid within 1.5 h of Start');
  assert.equal(core.ruleLabel({type:'clock',a:'end_at',time:'10:00',anchor:'start',dayOffset:1},c),'End before 10:00 the day after Start');
  assert.equal(core.ruleLabel({type:'present',a:'mid_at',label:'Custom'},c),'Custom');
});

test('applyRules and ruleSummary on the sample setup', ()=>{
  const {header,rows}=core.synthRows(42,1200), t=core.toTable([header,...rows]), cfg=core.normaliseConfig(sampleCfg);
  const B=core.buildRecords(t,cfg), rules=core.applyRules(B.recs,cfg), RS=core.ruleSummary(B.recs,rules,cfg);
  assert.equal(rules.length,cfg.rules.length);
  for(const x of RS){ assert.equal(x.met+x.breach+x.na,B.recs.length); assert.ok(x.rate>0&&x.rate<1,x.label); }
  const any=B.recs.filter(r=>r.allOk===false).length, all=B.recs.filter(r=>r.allOk===true).length;
  assert.equal(any+all,B.recs.length);
  assert.ok(B.recs.every(r=>r.allOk===Object.values(r.rules).every(s=>s!=='breach')));
  // an invalid rule is ignored, with a warning, not a crash
  const bad=core.normaliseConfig({...cfg,rules:[...cfg.rules,{id:'zz',type:'within',a:'discharged_at',b:'discharged_at',max:5}]});
  assert.equal(core.applyRules(B.recs,bad).length,cfg.rules.length);
  assert.match(core.validateConfig(bad,t.header).warnings.join(' '),/is ignored/);
});

test('risk analysis recovers the effects planted in the synthetic data', ()=>{
  const {header,rows}=core.synthRows(42,1200), t=core.toTable([header,...rows]), cfg=core.normaliseConfig(sampleCfg);
  const B=core.buildRecords(t,cfg); core.prepare(B.recs,{weekend:[6,0],basis:'start',vmode:'seq'});
  const rules=core.applyRules(B.recs,cfg), within6h=rules.find(r=>r.id==='r1');
  const RA=core.riskAnalyse(B.recs,within6h,{minN:10,lateH:10,wkLabel:'Sat, Sun',basisLabel:'order',clinFn:r=>r.attr.consultant,clinMin:10});
  assert.ok(!RA.model.err,RA.model.err);
  const term=id=>RA.model.terms.find(t=>t.id===id);
  assert.ok(term('wk').lo>1,'weekends are slower in the generator');
  assert.ok(term('attr:unit=Unit E').lo>1,'Unit E is slower in the generator');
  const flagged=RA.clin.pts.filter(p=>p.flag==='bad').map(p=>p.key).sort();
  assert.deepEqual(flagged,['Consultant 07','Consultant 19'],'the two slow consultants fall below the 99.8% funnel limit');
  assert.equal(RA.table.length,RA.F.length);
  assert.ok(RA.open&&RA.open.n===RA.n-RA.metN);
});

test('logistic model refuses when the data cannot support it', ()=>{
  const t=core.toTable([['id','start_at','mid_at','end_at'],...Array.from({length:20},(_,i)=>[String(i),'2026-01-05 09:00','2026-01-05 09:30','2026-01-05 12:00'])]);
  const B=core.buildRecords(t,CFG); core.prepare(B.recs,{weekend:[6,0],basis:'start',vmode:'seq'});
  const F=[{id:'x',l:'x',fn:r=>+r.id%2===0}], ok=r=>+r.id%3!==0;
  assert.match(core.logitModel(B.recs,F,ok).err,/at least 50/);
});

test('rules survive a round trip through the setup file and a merge', ()=>{
  const c=core.normaliseConfig(JSON.parse(JSON.stringify(sampleCfg)));
  assert.deepEqual(c.rules.map(r=>r.id),['r1','r2','r3','r4','r5']);
  const t=core.toTable([['case_id','discharge_order_at','discharged_at'],['C1','2026-01-01 10:00','2026-01-01 12:00']]);
  const m=core.mergeConfig(sampleCfg,t);
  assert.deepEqual(m.cfg.rules.map(r=>r.id),['r1','r2'],'rules on missing steps are dropped');
  assert.equal(m.rulesDropped,3);
});
