// Runs the real engine (src/core.js) on the SYNTHETIC sample and returns the facts the hero demo plays.
// Used at build time (build.mjs embeds the result) and by the tests (which re-run it and compare).
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const core=require('../core.js');

const ROLE_TAG={id:'Case ID',step:'Step time',due:'Due date',attribute:'Group',reason:'Delay reason'};

export function buildFacts(){
  const {header,rows}=core.synthRows(42,1200);
  const table=core.toTable([header,...rows],'synthetic');
  const cfg=core.normaliseConfig(core.SAMPLE_CONFIG);
  const B=core.buildRecords(table,cfg);
  const opt={post:false,weekend:[6,0],basis:'start',vmode:'seq'};
  core.prepare(B.recs,opt);
  const S=core.SCH, ref=S.happy.slice(), refKey=core.keyOf(ref,'seq');
  const rules=core.applyRules(B.recs,cfg);
  const A=core.analyse(B.recs,{ref,refKey,minN:10,basisLabel:'discharge order',rules});
  const RS=core.ruleSummary(B.recs,rules,cfg);
  const R=A.view, T=S.terms, lab=k=>S.lab[k]||k;
  const cases=R.map(r=>({due:r.byDue==null?'-':(r.byDue?'1':'0'),rules:rules.map(x=>({met:'m',breach:'b',na:'n'}[r.rules[x.id]]||'n')).join('')}));
  const cols=header.map(h=>{ const c=cfg.columns[h]; return c?{header:h,label:c.label||h,role:ROLE_TAG[c.role]||'Ignored'}:{header:h,label:h,role:'Ignored'}; });
  const st=A.st, pct=p=>Math.round(p*100);
  const slow=[...A.model.edges.values()].filter(e=>A.slow.has(e.key)).sort((a,b)=>b.st.med-a.st.med)[0];
  const worst=RS.filter(x=>x.n).sort((a,b)=>a.rate-b.rate)[0];
  const hrs=m=>(m/60).toFixed(1).replace(/\.0$/,'')+' h';
  const findings=[
    {head:`${pct(st.due)}%`,text:`of ${T.cases} ended on or before the date they were expected to.`},
    {head:`${pct(st.conf)}%`,text:`followed the happy flow exactly. The rest took ${A.model.variants.length-1} other routes.`},
    worst?{head:`${pct(worst.rate)}%`,text:`met the rule "${worst.label}". It is the rule that breaks most often (${worst.breach.toLocaleString()} breaks).`}
          :{head:hrs(slow.st.med),text:`median wait from ${lab(slow.a)} to ${lab(slow.b)}.`}
  ];
  // Map: the happy flow plus the three most common deviations only; everything else is summarised as a count.
  const hset=new Set(ref), onHappy=k=>k==='S'||k==='E'||hset.has(k), total=A.model.total;
  const refE=new Set(['S',...ref,'E'].slice(0,-1).map((k,i,a)=>k+'>'+['S',...ref,'E'][i+1]));
  const all=[...A.model.edges.values()], dev=all.filter(e=>!refE.has(e.key)).sort((x,y)=>y.n-x.n);
  const cand=dev.filter(e=>onHappy(e.a)&&onHappy(e.b));
  let minPct=cand.length>3?cand[2].n/total*100-1e-9:0;
  while(cand.filter(e=>e.n/total*100>=minPct).length>3) minPct+=1e-6;
  const shown=cand.filter(e=>e.n/total*100>=minPct);
  const map=core.renderMapSvg(A.model,{ref,order:ref,metric:'freq',minPct,interactive:false});
  const hidden=dev.length-shown.length;
  return {
    name:cfg.name, terms:{cases:T.cases}, file:'synthetic_discharges.csv', fileRows:rows.length,
    cols, happy:ref.map(lab), skipped:S.steps.filter(s=>!ref.includes(s.k)).map(s=>s.l),
    rules:RS.map(x=>({label:x.label})), cases,
    totals:{checked:R.length,breaks:RS.reduce((a,x)=>a+x.breach,0),dueYes:R.filter(r=>r.byDue===true).length,dueN:R.filter(r=>r.byDue!=null).length,onTime:st.due},
    ruleTotals:RS.map(x=>({met:x.met,breach:x.breach})),
    findings, map:{svg:map.svg.replace(/ width="\d+" height="\d+"/,''),w:map.w,h:map.h,shown:shown.length,hidden}
  };
}
