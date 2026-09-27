// Core tests: parsing, column profiling, configuration and config-driven analysis.
// All data is synthetic (seeded generator in core.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const core=require('../src/core.js');
const sampleCfg=JSON.parse(readFileSync(new URL('../samples/synthetic_discharges.setup.json',import.meta.url),'utf8'));
const sampleTable=()=>{ const {header,rows}=core.synthRows(42,1200); return core.toTable([header,...rows]); };
function analyseWith(cfg,table,opt={}){
  const B=core.buildRecords(table,cfg); const o={weekend:[6,0],basis:'start',vmode:'seq',post:false,...opt};
  core.prepare(B.recs,o); const S=core.SCH; const ref=S.happy.slice();
  return {B,S,A:core.analyse(B.recs,{ref,refKey:core.keyOf(ref,o.vmode)})};
}

test('synthetic generator is deterministic for a seed', ()=>{
  const a=core.synthRows(7,50), b=core.synthRows(7,50), c=core.synthRows(8,50);
  assert.deepEqual(a,b); assert.notDeepEqual(a.rows,c.rows);
  assert.ok(a.rows.every(r=>r[0].startsWith('SYN-')),'every case ID is marked synthetic');
});

test('dates: formats, day/month order, spreadsheet serials, wall-clock time', ()=>{
  const iso=core.toDate('2026-03-02 09:10'); assert.equal(iso.toISOString(),'2026-03-02T09:10:00.000Z');
  assert.equal(core.toDate('2026-03-02T09:10:00Z').toISOString(),'2026-03-02T09:10:00.000Z');
  assert.equal(core.toDate('02/03/2026 9:10').toISOString(),'2026-03-02T09:10:00.000Z','day first by default');
  assert.equal(core.toDate('02/03/2026 9:10',false).toISOString(),'2026-02-03T09:10:00.000Z','month first when detected');
  assert.equal(core.toDate('13/03/2026 12:05 AM').toISOString(),'2026-03-13T00:05:00.000Z');
  assert.equal(core.toDate('2 Mar 2026 21:40').toISOString(),'2026-03-02T21:40:00.000Z');
  assert.equal(core.toDate('Mar 2, 2026 9:40PM').toISOString(),'2026-03-02T21:40:00.000Z');
  assert.equal(core.toDate(46083.5).toISOString(),'2026-03-02T12:00:00.000Z');
  assert.equal(core.toDate('not a date'),null); assert.equal(core.toDate(''),null); assert.equal(core.toDate('2026-13-01 10:00'),null);
});

test('csv parsing handles quotes, embedded commas, semicolons and a BOM', ()=>{
  const rows=core.parseCsv('﻿a;b;c\r\n1;"x;y";"he said ""hi"""\r\n');
  assert.deepEqual(rows[0],['a','b','c']); assert.deepEqual(rows[1],['1','x;y','he said "hi"']);
});

test('header row is found below report titles', ()=>{
  const t=core.toTable([['Monthly report'],[''],['case_id','start_at','end_at'],['C1','2026-01-01 10:00','2026-01-01 11:00']]);
  assert.equal(t.headerRow,3); assert.deepEqual(t.header,['case_id','start_at','end_at']); assert.equal(t.data.length,1);
});

test('the sample CSV on disk matches the generator', ()=>{
  const csv=core.parseCsv(readFileSync(new URL('../samples/synthetic_discharges.csv',import.meta.url),'utf8')).filter(r=>r.some(v=>v!==''));
  const {header,rows}=core.synthRows(42,1200);
  assert.deepEqual(csv[0],header); assert.equal(csv.length-1,rows.length); assert.deepEqual(csv[5],rows[4]);
});

test('the sample XLSX reads back (title rows, real dates, deflate)', async ()=>{
  const x=await core.readXlsxRows(readFileSync(new URL('../samples/synthetic_discharges.xlsx',import.meta.url)));
  const t=core.toTable(x.rows,x.sheet); assert.equal(t.headerRow,3); assert.equal(t.data.length,1200);
  const B=core.buildRecords(t,sampleCfg); assert.equal(B.recs.length,1197);
});

test('personal-data columns are recognised and ignored by default', ()=>{
  for(const h of ['patient_name','PatientName','DOB','date_of_birth','MRN','Nationality','insurance_provider','phone','email','Name','first name'])
    assert.ok(core.isPiiHeader(h),h+' should be flagged');
  for(const h of ['ward_name','unit','specialty','discharged_at','case_id','step name','age'])
    assert.ok(!core.isPiiHeader(h),h+' should not be flagged');
  const t=core.toTable([['case_id','patient_name','start_at','end_at'],['C1','Alex Doe','2026-01-01 10:00','2026-01-01 11:00'],['C2','Sam Roe','2026-01-02 10:00','2026-01-02 12:00']]);
  const cfg=core.suggestConfig(t); assert.equal(cfg.columns.patient_name.role,'ignore');
});

test('role suggestions on the sample', ()=>{
  const p=core.profileColumns(sampleTable()), role=Object.fromEntries(p.map(x=>[x.col,x.role]));
  assert.equal(role.case_id,'id'); assert.equal(role.unit,'attribute'); assert.equal(role.expected_discharge_date,'due');
  assert.equal(role.discharge_order_at,'step'); assert.equal(role.discharged_at,'step'); assert.equal(role.pharmacy_delay_reason,'reason');
  const cfg=core.suggestConfig(sampleTable());
  assert.ok(!cfg.happyFlow.includes('transport_arranged_at'),'a step filled in under half the rows is left out of the suggested happy flow');
});

test('validation: happy flow, missing columns, duplicates', ()=>{
  const t=sampleTable();
  assert.ok(core.validateConfig(core.normaliseConfig(sampleCfg),t.header).ok);
  const one=core.normaliseConfig({...sampleCfg,happyFlow:['discharged_at']});
  assert.match(core.validateConfig(one,t.header).errors.join(' '),/at least two steps/);
  const miss=core.normaliseConfig({...sampleCfg,columns:{...sampleCfg.columns,ghost_at:{role:'step',label:'Ghost'}}});
  assert.match(core.validateConfig(miss,t.header).errors.join(' '),/ghost_at/);
  const twoIds=core.normaliseConfig({...sampleCfg,columns:{...sampleCfg.columns,unit:{role:'id'}}});
  assert.match(core.validateConfig(twoIds,t.header).errors.join(' '),/one column can be the case ID/);
  assert.throws(()=>core.buildRecords(t,one),/at least two steps/);
});

test('an imported setup is merged onto a file with different columns', ()=>{
  const t=core.toTable([['case_id','discharge_order_at','discharged_at','extra'],['C1','2026-01-01 10:00','2026-01-01 12:00','x'],['C2','2026-01-02 10:00','2026-01-02 11:00','y']]);
  const m=core.mergeConfig(sampleCfg,t);
  assert.ok(m.dropped.includes('unit')); assert.deepEqual(m.cfg.happyFlow,['discharge_order_at','discharged_at']);
  assert.equal(m.cfg.name,'Discharge process'); assert.ok(core.validateConfig(m.cfg,t.header).ok);
});

test('records: end step required, durations, due date, numeric bands', ()=>{
  const {B,S}=analyseWith(sampleCfg,sampleTable());
  assert.equal(B.meta.rows,1200); assert.equal(B.meta.noEnd,3); assert.equal(B.recs.length,1197);
  const r=B.recs[0]; assert.equal(r.id,'SYN-100000'); assert.equal(r.dur,(r.t1-r.t0)/6e4);
  assert.equal(S.start,S.byCol.discharge_order_at); assert.equal(S.end,S.byCol.discharged_at);
  assert.ok(B.recs.every(x=>/^[A-D]: /.test(x.attr.age)),'age is compared in quarter bands');
  assert.ok(B.recs.every(x=>x.byDue===true||x.byDue===false));
});

test('analysis is driven by the config: happy flow, variants, graph', ()=>{
  const {A,S,B}=analyseWith(sampleCfg,sampleTable());
  const n=B.recs.length;
  assert.equal(A.model.variants.reduce((a,v)=>a+v.n,0),n,'variants partition the cases');
  const fromStart=[...A.model.edges.values()].filter(e=>e.a==='S').reduce((a,e)=>a+e.n,0);
  const toEnd=[...A.model.edges.values()].filter(e=>e.b==='E').reduce((a,e)=>a+e.n,0);
  assert.equal(fromStart,n); assert.equal(toEnd,n);
  const happyKey=core.keyOf(S.happy,'seq'), exact=B.recs.filter(r=>r.vkey===happyKey).length;
  assert.equal(A.st.conf,exact/n);
  assert.ok(A.st.conf>0&&A.st.conf<1);
  assert.ok(A.findings.length>=5); assert.ok(A.findings[0].startsWith('Median time Discharge order → Discharged'));
  // a different happy flow changes conformance but not the graph
  const alt={...sampleCfg,happyFlow:['discharge_order_at','discharge_summary_at','med_reconciliation_at','pharmacy_ready_at','nursing_ready_at','discharged_at']};
  const B2=analyseWith(alt,sampleTable()); assert.notEqual(B2.A.st.conf,A.st.conf); assert.equal(B2.A.model.variants.length,A.model.variants.length);
});

test('steps-only mode groups sequences that differ only in order', ()=>{
  const seq=analyseWith(sampleCfg,sampleTable()).A.model.variants.length;
  const set=analyseWith(sampleCfg,sampleTable(),{vmode:'set'}).A.model.variants.length;
  assert.ok(set<seq);
});

test('deviations name missing, added and reordered steps', ()=>{
  core.setSchema(sampleCfg); const k=c=>core.SCH.byCol[c];
  const ref=[k('discharge_order_at'),k('med_reconciliation_at'),k('discharge_summary_at'),k('discharged_at')];
  const tr=[k('discharge_order_at'),k('discharge_summary_at'),k('med_reconciliation_at'),k('transport_arranged_at'),k('discharged_at')];
  const d=core.deviations(tr,ref,'seq').map(x=>x.t+':'+x.l);
  assert.ok(d.includes('extra:Transport arranged added'));
  assert.ok(d.some(x=>x.startsWith('order:')));
  assert.deepEqual(core.deviations([k('discharge_order_at'),k('discharged_at')],ref,'seq').map(x=>x.t),['miss','miss']);
});

test('steps recorded after the end are excluded from sequences unless asked', ()=>{
  const t=core.toTable([['id','a_at','b_at','c_at'],['1','2026-01-01 10:00','2026-01-01 13:00','2026-01-01 12:00'],['2','2026-01-01 10:00','2026-01-01 11:00','2026-01-01 12:00']]);
  const cfg={columns:{id:{role:'id'},a_at:{role:'step',label:'A'},b_at:{role:'step',label:'B'},c_at:{role:'step',label:'C'}},stepOrder:['a_at','b_at','c_at'],happyFlow:['a_at','b_at','c_at']};
  const B=core.buildRecords(t,cfg); core.prepare(B.recs,{weekend:[6,0],basis:'start',vmode:'seq',post:false});
  assert.deepEqual(B.recs[0].trace.map(k=>core.SCH.lab[k]),['A','C']);
  core.prepare(B.recs,{weekend:[6,0],basis:'start',vmode:'seq',post:true});
  assert.deepEqual(B.recs[0].trace.map(k=>core.SCH.lab[k]),['A','C','B']);
});

test('slide deck: valid zip, neutral document properties', ()=>{
  const {A}=analyseWith(sampleCfg,sampleTable());
  const bytes=core.buildDeck(A,{scope:'All discharges',period:'Jan to Jun 2026',generated:'1 Jan 2026',refLabel:'happy flow',post:false,vmode:'seq',basisLabel:'discharge order',weekendLabel:'Sat, Sun',minN:10,heatLabel:'x',recText:'',dq:[]},{});
  assert.equal(bytes[0],0x50); assert.equal(bytes[1],0x4B);
  const txt=new TextDecoder('latin1').decode(bytes);
  const core_xml=txt.slice(txt.indexOf('<cp:coreProperties'),txt.indexOf('</cp:coreProperties>'));
  assert.match(core_xml,/<dc:title>Discharge process review<\/dc:title>/);
  assert.match(core_xml,/<dc:creator>Proxy Process Explorer<\/dc:creator>/);
  assert.doesNotMatch(txt,/<cp:lastModifiedBy|<Company>|<Manager>|<dc:subject/);
  assert.match(txt,/<a:theme [^>]*name="mmonfar"/);
});
