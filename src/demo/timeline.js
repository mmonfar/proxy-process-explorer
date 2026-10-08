'use strict';
/* Hero demo: step timeline and state machine. Pure functions, no DOM, no network.
   stateAt(facts,t) returns everything the page draws at time t (ms). The page and the tests both use it,
   so what the tests check is exactly what is shown. All numbers come from `facts`, which the build makes
   by running the real engine on the synthetic sample (src/demo/facts.mjs). */
const STEPS=[
  {id:'file',  from:0,     to:7000,  title:'Read the file',
   caption:'A spreadsheet arrives: one row per case, one time column per step. The tool reads the column names and works out what each one is.'},
  {id:'flow',  from:7000,  to:13000, title:'Set the happy flow',
   caption:'It lines the steps up in the order the process should run. This ideal order is called the happy flow.'},
  {id:'rules', from:13000, to:22000, title:'Check the rules',
   caption:'Every case is checked against five simple rules. The counters show how many cases were checked, how many rules were broken and how many finished on time.'},
  {id:'map',   from:22000, to:28000, title:'Draw the map',
   caption:'The process map draws itself. Each box is a step, each arrow a hand-over. The dark line is the happy flow; lighter arrows are shortcuts and re-dos.'},
  {id:'find',  from:28000, to:34000, title:'Read the findings',
   caption:'The findings land in plain words, worked out from the same numbers. Nothing here is typed in by hand.'},
  {id:'cta',   from:34000, to:38000, title:'Try it yourself',
   caption:'That was a made-up sample. Open the explorer with it and click around, or read the code.'}
];
const TOTAL=STEPS[STEPS.length-1].to;
const T={fileIn:[200,1500],chips:[1500,6200],snap:[7600,11200],count:[13600,21000],map:[22300,26600],cards:[28400,31600],cta:[34000,35000]};

const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const prog=(t,[a,b])=>clamp((t-a)/(b-a),0,1);
const ease=p=>p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2;      // cubic in-out
const out3=p=>1-Math.pow(1-p,3);                        // fast start, soft landing

/* Running totals so the counters show true values for "the first k cases checked". */
function makePrefix(facts){
  const n=facts.cases.length, nr=facts.rules.length;
  const P={n,breaks:new Int32Array(n+1),dueYes:new Int32Array(n+1),dueN:new Int32Array(n+1),
           met:facts.rules.map(()=>new Int32Array(n+1)),br:facts.rules.map(()=>new Int32Array(n+1))};
  for(let i=0;i<n;i++){ const c=facts.cases[i]; let b=0;
    P.dueYes[i+1]=P.dueYes[i]+(c.due==='1'?1:0); P.dueN[i+1]=P.dueN[i]+(c.due==='-'?0:1);
    for(let r=0;r<nr;r++){ const ch=c.rules[r]; P.met[r][i+1]=P.met[r][i]+(ch==='m'?1:0); P.br[r][i+1]=P.br[r][i]+(ch==='b'?1:0); if(ch==='b') b++; }
    P.breaks[i+1]=P.breaks[i]+b; }
  return P;
}
const cache=new WeakMap();
const prefixOf=f=>{ let p=cache.get(f); if(!p){ p=makePrefix(f); cache.set(f,p); } return p; };

/* The jumbled starting order of the happy-flow chips: a fixed permutation, so every run looks the same. */
function jumbled(n){ const a=[...Array(n).keys()], out=[]; let i=0; while(a.length){ i=(i+3)%a.length; out.push(a.splice(i,1)[0]); } return out; }

function stateAt(facts,t0){
  const t=clamp(t0,0,TOTAL), P=prefixOf(facts), n=P.n;
  const si=STEPS.findIndex(s=>t<s.to), idx=si<0?STEPS.length-1:si, step=STEPS[idx];
  // 1. file and columns
  const chipP=prog(t,T.chips), nLit=Math.floor(chipP*facts.cols.length+1e-9);
  const cols=facts.cols.map((c,i)=>({label:c.label,role:c.role,lit:i<nLit}));
  // 2. happy flow: like an insertion sort you can watch. Step j: chip j slides up to slot j, the chips it
  //    passes shift down one place. One chip moves at a time, so nothing is ever hidden behind another.
  const m=facts.happy.length, J=jumbled(m), sp=prog(t,T.snap), sg=sp*m, j=Math.min(m,Math.floor(sg+1e-9)), fr=j>=m?0:ease(sg-j);
  const orderAt=s=>{ const rest=J.filter(c=>c>=s); return [...Array(s).keys()].concat(rest); };
  const o0=orderAt(j), o1=orderAt(Math.min(m,j+1));
  const flow=facts.happy.map((label,i)=>{ const p0=o0.indexOf(i), p1=o1.indexOf(i);
    return {label,pos:p0+(p1-p0)*fr,snapped:sp>=1||(i<j),moving:j<m&&i===j&&fr>0&&fr<1}; });
  // 3. rules and counters
  const cp=prog(t,T.count), k=Math.round(n*ease(cp));
  const dueN=P.dueN[k], onTime=dueN>0?Math.round(100*P.dueYes[k]/dueN):null;
  const rules=facts.rules.map((r,i)=>({label:r.label,met:P.met[i][k],breach:P.br[i][k],n:P.met[i][k]+P.br[i][k]}));
  const counters={checked:k,breaks:P.breaks[k],onTimeKnown:onTime!=null,onTimePct:onTime==null?0:onTime,onTimeText:onTime==null?'–':onTime+'%'};
  // 4. map
  const mapP=ease(prog(t,T.map));
  // 5. findings, cards land one by one
  const cardP=prog(t,T.cards), nCards=Math.min(facts.findings.length,Math.floor(cardP*facts.findings.length+1e-9)+(cardP>0?1:0)), landed=cardP>=1?facts.findings.length:nCards;
  return {t,step:idx,stepId:step.id,stepTitle:step.title,caption:step.caption,stepCount:STEPS.length,
    file:out3(prog(t,T.fileIn)),cols,flowP:sp,flow,rulesP:cp,rules,counters,mapP,cards:landed,cta:prog(t,T.cta),done:t>=TOTAL};
}
const finalState=f=>stateAt(f,TOTAL);

const api={STEPS,TOTAL,T,stateAt,finalState,makePrefix,jumbled};
if(typeof module!=='undefined') module.exports=api; else globalThis.DemoTimeline=api;
