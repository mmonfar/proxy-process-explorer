'use strict';
/* Hero demo: page controller. One master clock drives everything through DemoTimeline.stateAt(), so
   pause, replay, jumping to a step and the reduced-motion still all show exactly the same states. */
(function(){
const TL=globalThis.DemoTimeline, F=JSON.parse(document.getElementById('facts').textContent);
const $=id=>document.getElementById(id), el=(tag,cls,txt)=>{ const e=document.createElement(tag); if(cls) e.className=cls; if(txt!=null) e.textContent=txt; return e; };
const fmt=n=>Number(n).toLocaleString('en-GB');
const HOLD=1500, ROW=50;
const PANEL=['file','flow','rules','map','find','find'];
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
/* #captions: video mode. A caption band under the demo and a slower clock. The normal page is untouched. */
const CAP=location.hash==='#captions', TOT=CAP?TL.CAP_TOTAL:TL.TOTAL;
const S=(f,x)=>CAP?TL.captionAt(f,x):TL.stateAt(f,x), jStart=i=>CAP?TL.capStart(i):TL.stepStart(i), jEnd=i=>CAP?TL.capEnd(i):TL.stepEnd(i);
if(CAP){ document.documentElement.classList.add('capmode'); $('capband').hidden=false; }

/* ---- build the static DOM once ---- */
const stepsNav=$('steps'), stepBtns=TL.STEPS.map((s,i)=>{ const b=el('button','stp'); b.type='button'; b.append(el('i',null,String(i+1)),el('span',null,s.title)); b.setAttribute('aria-label',`Step ${i+1}: ${s.title}`);
  b.onclick=()=>jump(i); stepsNav.append(b); return b; });
$('fname').textContent=F.file; $('fmeta').textContent=`${fmt(F.fileRows)} rows · ${F.cols.length} columns`;
const ROLE_CLASS={'Step time':'r-step','Due date':'r-due'};
const chipEls=F.cols.map(c=>{ const li=el('li',ROLE_CLASS[c.role]||''); li.append(el('span',null,c.label),el('small',null,c.role)); $('chips').append(li); return li; });
const flowEls=F.happy.map(l=>{ const d=el('div','fch'); d.append(el('b',null,'·'),el('span',null,l)); $('flow').append(d); return d; });
$('skipNote').textContent=F.skipped.length?`Left out of the happy flow: ${F.skipped.join(', ')}.`:'';
const ruleEls=F.rules.map(r=>{ const li=el('li'); const bar=el('div','rbar'), m=el('i','m'), b=el('i','b'); bar.append(m,b);
  const num=el('div','rnum'), a=el('span'), c=el('span'); num.append(a,c); li.append(el('strong',null,r.label),bar,num); $('rules').append(li); return {m,b,a,c}; });
const findEls=F.findings.map(f=>{ const li=el('li'); li.append(el('b',null,f.head),el('span',null,f.text)); $('finds').append(li); return li; });
$('map').innerHTML=F.map.svg; $('map').firstElementChild.setAttribute('role','img'); $('map').firstElementChild.setAttribute('aria-label','Process map of the sample: boxes are steps, arrows are hand-overs');
$('moreRoutes').textContent=`+${F.map.hidden} other routes not drawn`;
$('fnote').textContent=`Worked out by the same engine as the explorer, from ${fmt(F.totals.checked)} made-up ${F.terms.cases}.`;
const panels=Object.fromEntries(['file','flow','rules','map','find'].map(k=>[k,$('p-'+k)]));

/* ---- draw one state ---- */
let lastStep=-1;
function draw(s){
  const stp=s.step;
  if(stp!==lastStep){ lastStep=stp;
    $('stepno').textContent=`Step ${stp+1} of ${s.stepCount} · ${s.stepTitle}`; $('caption').textContent=s.caption; if(CAP){ const cp=$('capband').firstElementChild; cp.textContent=s.caption; cp.style.animation='none'; void cp.offsetWidth; cp.style.animation=''; }
    for(const k in panels) panels[k].classList.toggle('on',k===PANEL[stp]);
    stepBtns.forEach((b,i)=>{ if(i===stp) b.setAttribute('aria-current','step'); else b.removeAttribute('aria-current'); b.classList.toggle('past',i<stp); }); }
  s.cols.forEach((c,i)=>chipEls[i].classList.toggle('lit',c.lit));
  s.flow.forEach((f,i)=>{ const e=flowEls[i]; e.style.transform=`translateY(${(f.pos*ROW).toFixed(1)}px)`; e.classList.toggle('snap',f.snapped); e.classList.toggle('mv',f.moving); e.firstChild.textContent=f.snapped?String(i+1):'·'; });
  const n=F.totals.checked;
  $('cChecked').textContent=fmt(s.counters.checked); $('cBreaks').textContent=fmt(s.counters.breaks); $('cOnTime').textContent=s.counters.onTimeText;
  s.rules.forEach((r,i)=>{ const e=ruleEls[i]; e.m.style.width=(100*r.met/n).toFixed(2)+'%'; e.b.style.width=(100*r.breach/n).toFixed(2)+'%';
    e.a.textContent=`Met ${fmt(r.met)}`; const c=e.c; c.textContent=''; c.append(document.createTextNode('Broken '),el('em',null,fmt(r.breach))); });
  $('map').style.clipPath=`inset(0 0 ${((1-s.mapP)*100).toFixed(1)}% 0)`;
  $('legend').style.opacity=s.mapP>0.85?1:0;
  findEls.forEach((e,i)=>e.classList.toggle('in',i<s.cards)); $('fnote').classList.toggle('in',s.cards>=findEls.length);
  $('cta').classList.toggle('on',s.stepId==='cta');
  $('barfill').style.width=(100*(CAP?s.tc:s.t)/TOT).toFixed(1)+'%';
}

/* ---- the clock ---- */
let t=0, playing=false, last=0, raf=0;
const label=()=>{ $('play').textContent=playing?'Pause':'Play'; $('play').setAttribute('aria-pressed',String(playing)); };
function frame(now){ if(!playing) return; const dt=Math.min(100,now-last); last=now; t+=dt;
  if(t>=TOT+HOLD){ t=0; }
  draw(S(F,t)); raf=requestAnimationFrame(frame); }
function play(){ if(playing) return; playing=true; if(t>=TOT) t=0; last=performance.now(); label(); raf=requestAnimationFrame(frame); }
function pause(){ playing=false; cancelAnimationFrame(raf); label(); }
function jump(i){ const s=TL.STEPS[i]; t=playing?jStart(i):jEnd(i); last=performance.now(); draw(S(F,t)); if(reduced.matches&&playing) pause(); }
$('play').onclick=()=>playing?pause():play();
$('replay').onclick=()=>{ t=0; draw(S(F,0)); lastStep=-1; draw(S(F,0)); play(); };
document.addEventListener('keydown',e=>{ if(e.key===' '&&e.target===document.body){ e.preventDefault(); playing?pause():play(); } });
document.addEventListener('visibilitychange',()=>{ if(document.hidden&&playing) last=performance.now(); });

/* ---- start: reduced motion shows the finished picture and waits for Play ---- */
function start(){ if(reduced.matches){ t=TOT; draw(S(F,t)); label(); } else { draw(S(F,0)); play(); } }
reduced.addEventListener&&reduced.addEventListener('change',()=>{ if(reduced.matches&&playing){ pause(); t=TOT; draw(S(F,t)); } });
start();
window.__demo={setT:x=>{ pause(); t=x; draw(S(F,t)); },total:TOT,captions:CAP};
})();
