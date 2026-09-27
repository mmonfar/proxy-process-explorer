(function(){
'use strict';
/* =====================================================================
   Proxy Process Explorer: page. Setup wizard, filters, tabs and export.
   All analysis lives in core.js; this file only reads state and draws.
   ===================================================================== */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const S={table:null,profile:null,cfg:null,draft:null,pendingCfg:null,wizStep:0,fileLabel:'',
  all:[],meta:null,view:[],A:null,modelAll:null,ref:[],refKey:'',refMode:'happy',refCustom:null,
  opt:{post:false,weekend:[6,0],basis:'start',vmode:'seq'},f:{},combine:'and',
  metric:'freq',minPct:5,fit:'fit',sel:null,dim:null,minN:10,edgeMin:5,sort:{c:'n',d:-1},hm:{basis:'start',metric:'n'},lastQ:''};
const PRIMARY=5;
let FD=[], FDM={};
const T=()=>SCH.terms, Tc=()=>T().cases.charAt(0).toUpperCase()+T().cases.slice(1);

let toastT;
function toast(msg,err){ const t=$('#toast'); clearTimeout(toastT); if(!msg){ t.style.display='none'; return; }
  t.textContent=msg; t.className=err?'err':''; t.style.display='block'; if(!err) toastT=setTimeout(()=>t.style.display='none',2600); }
function download(blob,name){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },2000); }
const stamp=()=>{ const d=new Date(); return d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0'); };
const slug=s=>String(s||'process').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')||'process';
const csvQ=v=>{ const s=String(v==null?'':v); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
function csv(H,rows,name){ download(new Blob(['﻿'+[H.map(csvQ).join(',')].concat(rows.map(r=>r.map(csvQ).join(','))).join('\r\n')],{type:'text/csv'}),name); }
const basisLabel=()=>S.opt.basis==='end'?shortL(SCH.end).toLowerCase():shortL(SCH.start).toLowerCase();
const wkLabel=()=>S.opt.weekend.slice().sort((a,b)=>DAY_ORDER.indexOf(a)-DAY_ORDER.indexOf(b)).map(d=>DAYS[d]).join(', ')||'none';
const store={ key:h=>'ppe:setup:'+h.join('|').length+':'+h.slice(0,40).join('|'),
  get(h){ try{ const v=localStorage.getItem(this.key(h)); return v?JSON.parse(v):null; }catch(e){ return null; } },
  set(h,c){ try{ localStorage.setItem(this.key(h),JSON.stringify(c)); }catch(e){} } };

/* =====================================================================
   Loading
   ===================================================================== */
async function load(file){
  if(!file) return; $('#loadErr').innerHTML=''; toast('Reading '+file.name+'…');
  try{
    const buf=await file.arrayBuffer(); let rows, sheet='';
    if(/\.csv$/i.test(file.name)) rows=parseCsv(new TextDecoder().decode(buf)); else { const x=await readXlsxRows(buf); rows=x.rows; sheet=x.sheet; }
    openTable(toTable(rows,sheet),file.name+(sheet?' · '+sheet:''));
    toast('');
  }catch(e){ console.error(e); toast(''); showEmpty(); $('#loadErr').innerHTML=`<div class="err">${esc(e.message||e)}</div>`; }
  $('#file').value='';
}
function openTable(table,label,presetCfg){
  S.table=table; S.fileLabel=label; S.profile=profileColumns(table);
  let note='';
  if(presetCfg) S.draft=normaliseConfig(presetCfg);
  else if(S.pendingCfg){ const m=mergeConfig(S.pendingCfg,table,S.profile); S.draft=m.cfg;
    note=m.dropped.length?`The imported setup names columns this file does not have: ${m.dropped.join(', ')}.`:'Imported setup applied.';
    if(m.rulesDropped) note+=` ${m.rulesDropped} rule(s) referred to missing steps and were left out.`; }
  else { const saved=store.get(table.header); S.draft=saved?mergeConfig(saved,table,S.profile).cfg:suggestConfig(table,S.profile); if(saved) note='Setup restored from the last time this file layout was used in this browser.'; }
  $('#fileName').textContent=label; openWizard(0,note);
}
$('#sampleBtn').onclick=()=>{ const {header,rows}=synthRows(42,1200); openTable(toTable([header,...rows],'synthetic'),'Synthetic sample (1,200 made-up cases)',SAMPLE_CONFIG_UI()); };
function SAMPLE_CONFIG_UI(){ return typeof SAMPLE_CONFIG_FULL!=='undefined'?SAMPLE_CONFIG_FULL:SAMPLE_CONFIG; }
async function readCfgFile(file){
  try{ const c=JSON.parse(await file.text()); if(!c||typeof c!=='object'||!c.columns) throw new Error('This file is not a setup exported by this page.');
    if(S.table&&!$('#wiz').hidden){ const m=mergeConfig(c,S.table,S.profile); S.draft=m.cfg; openWizard(S.wizStep,m.dropped.length?`Imported. Columns not in this file were left out: ${m.dropped.join(', ')}.`:'Setup imported.'); }
    else if(S.table){ const m=mergeConfig(c,S.table,S.profile); S.draft=m.cfg; openWizard(0,'Setup imported. Check it and apply.'); }
    else { S.pendingCfg=c; $('#cfgNote').innerHTML=`<div class="okmsg">Setup "${esc(c.name||'Process')}" loaded. It will be applied to the next file you open.</div>`; }
  }catch(e){ toast('Could not read the setup: '+(e.message||e),true); }
  $('#cfgFile').value=''; }
$('#cfgFile').onchange=e=>readCfgFile(e.target.files[0]);
function exportCfg(c){ download(new Blob([JSON.stringify(c,null,2)],{type:'application/json'}),`${slug(c.name)}_setup.json`); }
$('#cfgExport').onclick=()=>exportCfg(normaliseConfig(S.draft));
function showEmpty(){ $('#empty').hidden=false; $('#wiz').hidden=true; $('#app').hidden=true; $('#exportBtn').disabled=true; $('#setupBtn').hidden=true; }

/* =====================================================================
   Setup wizard
   ===================================================================== */
const ROLE_L={ignore:'Ignore',id:'Case ID',step:'Step timestamp',attribute:'Variable',reason:'Delay reason',due:'Due date'};
const WSTEPS=[
  {id:'columns',t:'Columns',render:wColumns},
  {id:'flow',t:'Happy flow',render:wFlow},
  {id:'vars',t:'Variables',render:wVars}
];
const WS=id=>WSTEPS.find(w=>w.id===id);
if(typeof window.PPE_WIZARD_EXTRA==='function') window.PPE_WIZARD_EXTRA(WSTEPS);
function openWizard(step,note){
  S.wizStep=step||0; $('#empty').hidden=true; $('#app').hidden=true; $('#wiz').hidden=false;
  $('#wizCancel').hidden=!S.cfg; $('#wizFile').textContent=S.fileLabel+' · '+S.table.data.length.toLocaleString()+' rows · header on row '+S.table.headerRow;
  S.wizNote=note||''; renderWizard(); window.scrollTo({top:0});
}
function renderWizard(){
  const st=WSTEPS[S.wizStep];
  $('#wizTitle').textContent=st.t;
  $('#wizSteps').innerHTML=WSTEPS.map((w,i)=>`<button data-ws="${i}" class="${i===S.wizStep?'on':''}"><i>${i+1}</i>${esc(w.t)}</button>`).join('');
  $('#wizBody').innerHTML=(S.wizNote?`<div class="okmsg" style="margin:0 0 12px">${esc(S.wizNote)}</div>`:'')+st.render()+`<div class="issues" id="wizIssues"></div>`;
  $('#wizBack').disabled=S.wizStep===0; $('#wizNext').textContent=S.wizStep===WSTEPS.length-1?'Apply and explore':'Next';
  if(st.bind) st.bind(); bindWizard(); showIssues();
}
function showIssues(){ const v=validateConfig(S.draft,S.table.header), box=$('#wizIssues'); if(!box) return;
  box.innerHTML=v.errors.map(e=>`<div class="err">${esc(e)}</div>`).join('')+v.warnings.map(w=>`<div class="warn">${esc(w)}</div>`).join('');
  $('#wizNext').disabled=S.wizStep===WSTEPS.length-1&&!v.ok; return v; }
function setDraft(fn){ fn(S.draft); S.draft=normaliseConfig(S.draft); }
$('#wizSteps').onclick=e=>{ const b=e.target.closest('[data-ws]'); if(!b) return; S.wizNote=''; S.wizStep=+b.dataset.ws; renderWizard(); };
$('#wizBack').onclick=()=>{ if(S.wizStep>0){ S.wizNote=''; S.wizStep--; renderWizard(); } };
$('#wizNext').onclick=()=>{ if(S.wizStep<WSTEPS.length-1){ S.wizNote=''; S.wizStep++; renderWizard(); window.scrollTo({top:0}); return; } applySetup(); };
$('#wizCancel').onclick=()=>{ S.draft=null; $('#wiz').hidden=true; $('#app').hidden=false; };

function wColumns(){
  const c=S.draft;
  const rows=S.profile.map(p=>{ const cc=c.columns[p.col]||{role:'ignore',label:p.col};
    const read=p.dateShare>0.05?`${pctS(p.dateShare)} dates`:p.numShare>0.9?`numbers · ${p.distinct.toLocaleString()} distinct`:`${p.distinct.toLocaleString()} distinct values`;
    return `<tr data-col="${esc(p.col)}"><td class="l"><b>${esc(p.col)}</b>${p.pii?'<span class="badge pii" title="The column name suggests a direct identifier">Personal data?</span>':''}${p.fill<0.5&&p.n?`<span class="badge" title="Filled in ${pctS(p.fill)} of rows">${pctS(p.fill)} filled</span>`:''}</td>
      <td class="l samp">${esc(p.sample.join(' · '))}</td><td class="l">${esc(read)}</td>
      <td style="min-width:150px"><select data-k="role">${ROLES.map(r=>`<option value="${r}"${cc.role===r?' selected':''}>${ROLE_L[r]}</option>`).join('')}</select></td>
      <td style="min-width:190px">${cc.role==='ignore'?'':`<input type="text" data-k="label" value="${esc(cc.label)}" aria-label="Label for ${esc(p.col)}">`}</td>
      <td style="min-width:110px">${cc.role==='attribute'?`<select data-k="type"><option value="cat"${cc.type!=='num'?' selected':''}>Category</option><option value="num"${cc.type==='num'?' selected':''}>Number (bands)</option></select>`:''}</td></tr>`; }).join('');
  return `<p class="lead">Each column gets one role. <b>Step timestamps</b> become the steps of the process. <b>Variables</b> become filters, breakdowns and candidate risk factors. <b>Delay reasons</b> are counted as recorded. Roles are suggested from the values; change any of them.</p>
  <div class="terms"><label>Process name <input type="text" id="tName" value="${esc(c.name)}"></label><label>One case is a <input type="text" id="tCase" value="${esc(c.terms.case)}"></label><label>Many cases are <input type="text" id="tCases" value="${esc(c.terms.cases)}"></label></div>
  <div class="tbl-scroll" style="max-height:none"><table class="t coltbl"><thead><tr><th class="l">Column in file</th><th class="l">Sample values</th><th class="l">Read as</th><th class="l">Role</th><th class="l">Label shown</th><th class="l">Type</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
WS('columns').bind=()=>{
  $('#tName').oninput=e=>{ S.draft.name=e.target.value.trim()||'Process'; };
  $('#tCase').oninput=e=>{ S.draft.terms.case=e.target.value.trim()||'case'; };
  $('#tCases').oninput=e=>{ S.draft.terms.cases=e.target.value.trim()||'cases'; };
  $('#wizBody').onchange=e=>{ const tr=e.target.closest('tr[data-col]'), k=e.target.dataset.k; if(!tr||!k) return; const col=tr.dataset.col;
    setDraft(c=>{ const cc=c.columns[col]||(c.columns[col]={role:'ignore',label:humaniseUI(col)});
      if(k==='role'){ const p=S.profile.find(x=>x.col===col); cc.role=e.target.value; if(cc.role==='attribute'){ cc.type=cc.type||p.type; cc.risk=!!cc.risk; }
        if(cc.role==='step'&&!c.happyFlow.includes(col)) c.happyFlow.push(col);
        if(cc.role==='id') for(const [kk,vv] of Object.entries(c.columns)) if(kk!==col&&vv.role==='id') vv.role='attribute';
        if(cc.role==='due') for(const [kk,vv] of Object.entries(c.columns)) if(kk!==col&&vv.role==='due') vv.role='ignore'; }
      else cc[k]=k==='label'?(e.target.value.trim()||col):e.target.value; });
    if(k!=='label') renderWizard(); else showIssues(); };
  $('#wizBody').oninput=e=>{ if(e.target.dataset.k==='label'){ const col=e.target.closest('tr').dataset.col; S.draft.columns[col].label=e.target.value.trim()||col; } };
};
const humaniseUI=c=>String(c).replace(/[_\-.]+/g,' ').trim();

function wFlow(){
  const c=S.draft, cols=c.stepOrder, st=stepStats(S.table,cols), H=new Set(c.happyFlow);
  if(!cols.length) return '<div class="err">No column has the role "Step timestamp". Go back to Columns and mark at least two.</div>';
  const hf=cols.filter(k=>H.has(k));
  const items=cols.map((k,i)=>{ const on=H.has(k), first=hf[0]===k, last=hf[hf.length-1]===k, s=st[k];
    return `<div class="flow-item${on?'':' off'}" data-col="${esc(k)}"><label class="chk" title="Part of the happy flow"><input type="checkbox" data-a="toggle"${on?' checked':''}></label>
      <div class="nm"><b>${esc(c.columns[k].label)}</b>${first?'<span class="badge start">Start: clock starts</span>':''}${last?'<span class="badge end">End: case ends</span>':''}<small>${esc(k)} · recorded in ${pctS(s.fill)} of rows · typically ${s.med==null?'–':'+'+fmtMin(s.med)} after the earliest step</small></div>
      <div class="mv"><button data-a="up" aria-label="Move up"${i===0?' disabled':''}>▲</button><button data-a="down" aria-label="Move down"${i===cols.length-1?' disabled':''}>▼</button></div></div>`; }).join('');
  return `<p class="lead">Put the steps in the order they <i>should</i> happen and tick the ones that belong to the happy flow. The first ticked step starts the clock; the last ticked step ends the case (rows without it are left out). Unticked steps are still tracked as optional steps and show up as additions to the flow.</p>
  <div class="flow"><div><div class="ctrl" style="margin-bottom:8px"><button class="btn ghost" id="sortTypical">Order by typical time</button><span class="note" style="margin:0">Sorts steps by their median time in the file</span></div><div class="flow-list">${items}</div></div>
  <div class="flow-prev"><div class="lbl">Happy flow</div><ol>${hf.map(k=>`<li>${esc(c.columns[k].label)}</li>`).join('')}</ol>
  <p class="note">A ${esc(c.terms.case)} follows the happy flow when exactly these steps are recorded, in this order, and nothing else. Everything else is measured against it on the process map.</p></div></div>`;
}
WS('flow').bind=()=>{
  $('#wizBody').onclick=e=>{ const b=e.target.closest('[data-a]'); if(b&&b.dataset.a!=='toggle'){ const col=b.closest('[data-col]').dataset.col;
      setDraft(c=>{ const o=c.stepOrder, i=o.indexOf(col), j=b.dataset.a==='up'?i-1:i+1; if(j<0||j>=o.length) return; [o[i],o[j]]=[o[j],o[i]]; const H=new Set(c.happyFlow); c.happyFlow=o.filter(k=>H.has(k)); });
      renderWizard(); return; }
    if(e.target.id==='sortTypical'){ setDraft(c=>{ c.stepOrder=typicalOrder(S.table,c.stepOrder); const H=new Set(c.happyFlow); c.happyFlow=c.stepOrder.filter(k=>H.has(k)); }); renderWizard(); } };
  $('#wizBody').onchange=e=>{ if(e.target.dataset.a!=='toggle') return; const col=e.target.closest('[data-col]').dataset.col;
    setDraft(c=>{ const H=new Set(c.happyFlow); e.target.checked?H.add(col):H.delete(col); c.happyFlow=c.stepOrder.filter(k=>H.has(k)); }); renderWizard(); };
};

function wVars(){
  const c=S.draft, A=Object.keys(c.columns).filter(k=>c.columns[k].role==='attribute');
  if(!A.length) return '<p class="lead">No column has the role "Variable". Filters and breakdowns will only offer day of week, weekday or weekend, month and delay reasons. Go back to Columns to add variables.</p>';
  const rows=A.map(k=>{ const p=S.profile.find(x=>x.col===k)||{distinct:0,sample:[]}, cc=c.columns[k];
    return `<tr data-col="${esc(k)}"><td class="l"><b>${esc(cc.label)}</b> <span class="note">${esc(k)}</span></td><td class="l">${cc.type==='num'?'Number, compared in quarter bands':'Category'}</td><td>${p.distinct.toLocaleString()}</td><td class="l samp">${esc(p.sample.join(' · '))}</td>
      <td style="text-align:center"><input type="checkbox" data-k="risk"${cc.risk?' checked':''} aria-label="Use ${esc(cc.label)} in the risk analysis"></td></tr>`; }).join('');
  return `<p class="lead">Every variable is available as a filter and as a breakdown. Tick the ones that are <b>relevant for risk</b>: the Rules and risk tab compares ${esc(c.terms.cases)} with and without each of their values when it looks at which ${esc(c.terms.cases)} miss a rule or a target time, and holds the others constant in the adjusted comparison.</p>
  <div class="tbl-scroll" style="max-height:none"><table class="t"><thead><tr><th class="l">Variable</th><th class="l">Type</th><th>Distinct values</th><th class="l">Sample values</th><th>Relevant for risk</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="note">Tick few: each ticked category adds a comparison per frequent value, and many overlapping factors make the adjusted comparison unstable.</p>`;
}
WS('vars').bind=()=>{ $('#wizBody').onchange=e=>{ if(e.target.dataset.k!=='risk') return; const col=e.target.closest('tr').dataset.col; S.draft.columns[col].risk=e.target.checked; }; };

function bindWizard(){ /* per-step handlers are attached in each step's bind() */ }
function applySetup(){
  const v=validateConfig(S.draft,S.table.header); if(!v.ok){ showIssues(); toast('Fix the setup first',true); return; }
  try{ const B=buildRecords(S.table,S.draft);
    S.cfg=normaliseConfig(S.draft); S.draft=null; store.set(S.table.header,S.cfg);
    S.all=B.recs; S.meta=B.meta; S.f={}; S.sel=null; S.refMode='happy'; S.refCustom=null; S.lastQ='';
    S.opt.weekend=S.cfg.settings.weekend||[6,0]; S.opt.basis=S.cfg.settings.basis==='end'?'end':'start';
    $('#refSel').value='happy'; $('#refSel option[value=custom]').disabled=true;
    $('#wiz').hidden=true; $('#app').hidden=false; $('#exportBtn').disabled=false; $('#setupBtn').hidden=false;
    $('#subTitle').textContent=`${S.cfg.name} · ${S.cfg.happyFlow.length} happy-flow steps · ${S.all.length.toLocaleString()} ${S.cfg.terms.cases}`;
    syncSettingsUI(); buildFilters(); recompute(); showTab('process'); toast(`Loaded ${S.all.length.toLocaleString()} ${S.cfg.terms.cases}`);
  }catch(e){ console.error(e); toast(e.message||String(e),true); }
}
$('#setupBtn').onclick=()=>{ S.draft=normaliseConfig(S.cfg); openWizard(0); };

/* =====================================================================
   Filters
   ===================================================================== */
function buildFilters(){
  FD=SCH.attrs.map((a,i)=>['a'+i,a.l,r=>r.attr[a.col]])
    .concat([['dayType','Weekday / weekend',r=>r.dayType],['dowL','Day of week',r=>r.dowL],['month','Month (end step)',r=>r.month,monthLabel]])
    .concat(SCH.reasons.map((q,i)=>['r'+i,q.l,r=>r.reason[q.k]||'None recorded']))
    .concat(SCH.dueCol?[['due','Ended by due date',r=>r.byDue==null?'No due date':(r.byDue?'Yes':'No')]]:[])
    .concat(typeof window.PPE_FILTER_EXTRA==='function'?window.PPE_FILTER_EXTRA():[]);
  FDM=Object.fromEntries(FD.map(d=>[d[0],d]));
  $('#fPrimary').innerHTML=FD.slice(0,PRIMARY).map(msHtml).join('');
  $('#more').innerHTML=FD.slice(PRIMARY).map(msHtml).join('');
  $('#moreBtn').hidden=FD.length<=PRIMARY;
  $('#dim').innerHTML=FD.map(d=>`<option value="${d[0]}">${esc(d[1])}</option>`).join(''); S.dim=FD[0][0]; $('#dim').value=S.dim;
  syncFilterButtons();
}
const fmtV=(k,v)=>FDM[k]&&FDM[k][3]?FDM[k][3](v):v;
function counts(k){ const fn=FDM[k][2], m=new Map(); for(const r of S.all){ const v=String(fn(r)); m.set(v,(m.get(v)||0)+1); }
  return [...m.entries()].sort((a,b)=>k==='dowL'?DAY_ORDER.indexOf(DAYS.indexOf(a[0]))-DAY_ORDER.indexOf(DAYS.indexOf(b[0])):(k==='month'||/^Band|^[A-D]: /.test(a[0]))?a[0].localeCompare(b[0]):b[1]-a[1]||a[0].localeCompare(b[0])); }
function msHtml(d){ const [k,l]=d; return `<div class="fl" data-fk="${k}">${esc(l)}<button class="ms-btn" data-ms="${k}">All</button><div class="pop" hidden></div></div>`; }
function syncFilterButtons(){ for(const b of $$('.ms-btn')){ const k=b.dataset.ms, s=S.f[k];
  b.textContent=!s||!s.size?'All':(s.size===1?fmtV(k,[...s][0]):`${s.size} selected`); b.classList.toggle('on',!!(s&&s.size)); b.title=s&&s.size?[...s].map(v=>fmtV(k,v)).join(', '):''; } }
function openPop(k){ closePops(); const wrap=$(`.fl[data-fk="${k}"]`), pop=wrap.querySelector('.pop');
  const vals=counts(k), sel=S.f[k]||new Set();
  pop.innerHTML=`<input type="text" placeholder="Search" aria-label="Search values"><div class="ms-list">${vals.map(([v,n])=>`<label><input type="checkbox" value="${esc(v)}"${sel.has(v)?' checked':''}><span>${esc(fmtV(k,v))}</span><em>${n}</em></label>`).join('')}</div><div class="pop-f"><button class="btn ghost" data-a="all">Select shown</button><button class="btn ghost" data-a="none">Clear</button><button class="btn ghost" data-a="done">Done</button></div>`;
  pop.hidden=false; const inp=pop.querySelector('input[type=text]'); inp.focus();
  inp.oninput=()=>{ const q=inp.value.toLowerCase(); pop.querySelectorAll('.ms-list label').forEach(l=>l.hidden=!l.textContent.toLowerCase().includes(q)); };
  pop.onchange=e=>{ if(e.target.type!=='checkbox') return; const s=S.f[k]||(S.f[k]=new Set()); e.target.checked?s.add(e.target.value):s.delete(e.target.value); S.sel=null; update(); };
  pop.onclick=e=>{ const a=e.target.dataset&&e.target.dataset.a; if(!a) return; const s=S.f[k]||(S.f[k]=new Set());
    if(a==='done'){ closePops(); return; }
    pop.querySelectorAll('.ms-list label').forEach(l=>{ if(l.hidden) return; const c=l.querySelector('input'); if(a==='all'){ c.checked=true; s.add(c.value); } else { c.checked=false; s.delete(c.value); } });
    S.sel=null; update(); };
}
function closePops(){ $$('.fl .pop').forEach(p=>{ if(p.id!=='setPop') p.hidden=true; }); }
document.addEventListener('click',e=>{ const b=e.target.closest('.ms-btn'); if(b){ const pop=b.parentElement.querySelector('.pop'); if(pop.hidden) openPop(b.dataset.ms); else closePops(); return; }
  if(!e.target.closest('.pop')) closePops(); if(!e.target.closest('#setPop')&&e.target.id!=='setBtn') $('#setPop').hidden=true; });
document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ closePops(); $('#setPop').hidden=true; if($('#mapCard').classList.contains('full')) $('#fullBtn').click(); } });
function activeF(){ return FD.filter(d=>S.f[d[0]]&&S.f[d[0]].size); }
function extraFilterFns(){ return typeof window.PPE_SEGMENT_FNS==='function'?window.PPE_SEGMENT_FNS():[]; }
function applyFilters(noSeg){ const act=activeF(), SF=noSeg?[]:extraFilterFns();
  return S.all.filter(r=>{ if(SF.length&&!SF.every(f=>f.fn(r)===true)) return false;
    if(!act.length) return true; const m=act.map(([k,,fn])=>S.f[k].has(String(fn(r)))); return S.combine==='and'?m.every(Boolean):m.some(Boolean); }); }
function scopeText(){ const act=activeF().map(([k,l])=>`${l}: ${[...S.f[k]].map(v=>fmtV(k,v)).join(' or ')}`);
  const sf=extraFilterFns(); if(sf.length) act.push('Segment: '+sf.map(f=>f.l).join(' and '));
  return act.length?act.join(S.combine==='and'?'; and ':'; or '):`All ${T().cases} in the file`; }
function renderChips(){ const act=activeF(), sf=extraFilterFns(); let h='';
  act.forEach(([k,l],i)=>{ if(i) h+=`<span class="join">${S.combine==='and'?'and':'or'}</span>`; h+=`<span class="fchip">${esc(l)}: ${esc([...S.f[k]].map(v=>fmtV(k,v)).join(' or '))}<button data-rm="${k}" aria-label="Remove filter">×</button></span>`; });
  if(sf.length) h+=`${act.length?'<span class="join">and</span>':''}<span class="fchip">Segment: ${esc(sf.map(f=>f.l).join(' and '))}<button data-rmseg="1" aria-label="Remove segment">×</button></span>`;
  if(act.length||sf.length) h+=`<span class="note" style="margin:0 0 0 6px">${S.view.length.toLocaleString()} of ${S.all.length.toLocaleString()} ${esc(T().cases)}</span>`;
  $('#fchips').innerHTML=h; }
$('#fchips').onclick=e=>{ if(e.target.closest('[data-rmseg]')){ if(window.PPE_CLEAR_SEGMENT) window.PPE_CLEAR_SEGMENT(); S.sel=null; update(); return; } const b=e.target.closest('[data-rm]'); if(!b) return; delete S.f[b.dataset.rm]; S.sel=null; update(); };
function addFilter(k,v){ const s=S.f[k]||(S.f[k]=new Set()); s.has(v)?s.delete(v):s.add(v); S.sel=null; update(); window.scrollTo({top:0,behavior:'smooth'}); }

/* =====================================================================
   Compute
   ===================================================================== */
function recompute(){ prepare(S.all,S.opt); S.modelAll=buildModel(S.all); update(); }
function computeRef(){ const M=S.modelAll; let tr;
  if(S.refMode==='custom'&&S.refCustom&&M.variants.find(v=>v.key===S.refCustom)) tr=M.variants.find(v=>v.key===S.refCustom).trace;
  else if(S.refMode==='top') tr=M.variants.length?M.variants[0].trace:[];
  else tr=SCH.happy.slice();
  S.ref=tr; S.refKey=keyOf(tr,S.opt.vmode); }
function refLabel(){ const src=S.refMode==='top'?'most common sequence in the file':S.refMode==='custom'?'sequence selected by the analyst':'happy flow from the setup';
  return `${S.ref.map(k=>EVL(k)).join(' → ')} (${src}${S.opt.vmode==='set'?', compared by steps only':''})`; }
function update(){
  S.view=applyFilters(); computeRef();
  S.A=analyse(S.view,{ref:S.ref,refKey:S.refKey,minN:S.minN,basisLabel:basisLabel()});
  syncFilterButtons(); renderChips(); renderWarn(); renderKpis(); renderMap(); renderVariants(); renderSel(); renderTiming(); renderCompare(); renderTime(); renderFindings();
  if(window.PPE_RENDER_EXTRA) window.PPE_RENDER_EXTRA(S);
  if(S.lastQ) renderLookup(S.lastQ);
}
function renderWarn(){ const M=S.meta, w=[], cases=T().cases;
  if(M.noEnd) w.push(`${M.noEnd.toLocaleString()} rows without a readable time in the end step (${EVL(SCH.end)}) were left out.`);
  for(const e of SCH.steps){ const D=M.diag[e.k]; if(D.ok) continue;
    w.push(D.non?`${e.l}: column "${D.col}" holds ${D.non.toLocaleString()} values but none reads as a date and time (example "${D.badEx}").`:`${e.l}: column "${D.col}" is empty in every row, so this step is empty.`); }
  for(const e of SCH.steps){ const b=M.bad[e.k], D=M.diag[e.k]; if(b&&D.ok) w.push(`${e.l}: ${b.n.toLocaleString()} values could not be read as a date and time (example: "${b.sample}"); they are treated as not recorded.`); }
  if(M.noStart) w.push(M.noStart===S.all.length?`No ${T().case} has a time in the start step, so everything measured from it is empty.`:`${M.noStart.toLocaleString()} ${cases} have no time in the start step: they appear on the map but not in any time measured from it.`);
  if(M.negDur) w.push(`${M.negDur.toLocaleString()} ${cases} have the end step before the start step.`);
  if(M.dfi.ambiguousOnly) w.push('Some dates are text where day and month cannot be told apart; they were read as day/month/year.');
  if(M.dfi.conflict) w.push('Text dates appear in both day/month and month/day order. Check the date columns in the source.');
  $('#warn').hidden=!w.length; $('#warn').innerHTML=w.length?`<b>Before reading the results</b><ul>${w.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''; }
function dqList(){ const M=S.meta, L=[], cases=T().cases;
  L.push(`${M.rows.toLocaleString()} data rows read${M.sheet&&M.sheet!=='synthetic'?' from sheet "'+M.sheet+'"':''} (header on row ${M.headerRow}); ${S.all.length.toLocaleString()} ${cases} with an end-step time were analysed.`);
  if(M.noEnd) L.push(`${M.noEnd} rows had no end-step time and were excluded.`);
  if(M.noStart) L.push(`${M.noStart} ${cases} have no start-step time.`);
  if(M.negDur) L.push(`${M.negDur} ${cases} have the end step earlier than the start step.`);
  for(const e of SCH.steps){ const b=M.bad[e.k]; if(b) L.push(`${e.l}: ${b.n} values not readable as date and time, e.g. "${b.sample}".`); }
  if(M.dupId) L.push(`${M.dupId} repeated case IDs were found; each row is analysed as its own ${T().case}.`);
  if(M.dfi.ambiguousOnly) L.push('Text dates were read as day/month/year.');
  for(const w of M.warnings) L.push(w);
  return L; }

/* ---------- KPIs ---------- */
function renderKpis(){ const st=S.A.st, set=S.opt.vmode==='set', A=S.A;
  const K=[[st.n.toLocaleString(),Tc(),S.view.length===S.all.length?'whole file':`of ${S.all.length.toLocaleString()} in the file`],
    [fmtMin(st.dur.med),`Median ${SCH.durLabel}`,`P75 ${fmtMin(st.dur.p75)} · P90 ${fmtMin(st.dur.p90)}`],
    [pctS(st.conf),set?'Same steps as reference':'Followed the reference flow',`${A.model.variants.length.toLocaleString()} distinct ${set?'step sets':'sequences'}`]];
  if(st.dueN) K.push([pctS(st.due),'Ended by due date',`${st.dueN.toLocaleString()} with a due date`]);
  if(SCH.reasons.length) K.push([pctS(st.reason),'Any delay reason',SCH.reasons.map(r=>r.l).join(', ')]);
  if(window.PPE_KPI_EXTRA) window.PPE_KPI_EXTRA(K,S);
  const L0=A.L.find(x=>x.k!=='none'); if(K.length<6&&L0) K.push([pctS(L0.p),'Last step: '+shortL(L0.k),`then median ${fmtMin(L0.st.med)} to the end`]);
  $('#kpis').style.gridTemplateColumns=`repeat(${Math.min(6,K.length)},minmax(0,1fr))`;
  $('#kpis').innerHTML=K.slice(0,6).map(k=>`<div class="kpi"><b>${esc(k[0])}</b><span>${esc(k[1])}</span><small>${esc(k[2])}</small></div>`).join(''); }

/* ---------- process map ---------- */
function hlFor(){ const sel=S.sel, M=S.A.model; if(!sel) return null; const nodes=new Set(['S','E']), edges=new Set();
  if(sel.type==='node'){ nodes.clear(); nodes.add(sel.key); for(const e of M.edges.values()) if(e.a===sel.key||e.b===sel.key) edges.add(e.key); }
  else if(sel.type==='edge'){ nodes.clear(); const e=M.edges.get(sel.key); if(e){ nodes.add(e.a); nodes.add(e.b); edges.add(e.key); } }
  else { const v=M.variants.find(x=>x.key===sel.key); if(v) for(const r of v.recs){ const seq=['S'].concat(r.trace,['E']); seq.forEach(k=>nodes.add(k)); for(let i=0;i<seq.length-1;i++) edges.add(seq[i]+'>'+seq[i+1]); } }
  return {nodes,edges}; }
function renderMap(){ const A=S.A;
  $('#refTxt').innerHTML=`<b style="color:var(--ink)">Reference flow:</b> ${esc(refLabel())}`;
  $('#mapWrap').innerHTML=renderMapSvg(A.model,{ref:S.ref,order:A.order,metric:S.metric,minPct:S.minPct,hl:hlFor(),interactive:true,slow:A.slow,timing:A.timing}).svg;
  $('#slowLeg').hidden=S.metric==='freq'; fitMap(); }
function fitMap(){ const wrap=$('#mapWrap'), svg=wrap.querySelector('svg'); if(!svg||$('#tab-process').hidden) return;
  const W=+svg.getAttribute('width'), H=+svg.getAttribute('height');
  if(S.fit!=='fit'){ svg.style.width=W+'px'; svg.style.height=H+'px'; wrap.style.height=''; return; }
  const full=$('#mapCard').classList.contains('full'), top=wrap.getBoundingClientRect().top;
  let avail=window.innerHeight-(full?top:Math.max(top,0))-(full?20:12);
  if(!full&&avail<320) avail=window.innerHeight-24;
  const availW=wrap.clientWidth-4, k=Math.min(1,avail/H,availW/W);
  svg.style.width=Math.floor(W*k)+'px'; svg.style.height=Math.floor(H*k)+'px'; wrap.style.height=Math.floor(H*k+4)+'px'; }
let fitT; window.addEventListener('resize',()=>{ clearTimeout(fitT); fitT=setTimeout(fitMap,80); });
$$('#fitSeg button').forEach(b=>b.onclick=()=>{ S.fit=b.dataset.f; $$('#fitSeg button').forEach(x=>x.classList.toggle('on',x===b)); fitMap(); });
$('#fullBtn').onclick=()=>{ const c=$('#mapCard'), on=!c.classList.contains('full'); c.classList.toggle('full',on); document.body.classList.toggle('noscroll',on); $('#fullBtn').textContent=on?'Close':'Expand'; fitMap(); };
function chipsFor(trace){ const d=deviations(trace,S.ref,S.opt.vmode); if(!d.length) return `<span class="chip ref">${S.opt.vmode==='set'?'Same steps as reference':'Reference flow'}</span>`; return d.map(x=>`<span class="chip ${x.t}">${esc(x.l)}</span>`).join(''); }
function renderVariants(){ const V=S.A.model.variants, tot=S.A.st.n||1;
  $('#varCount').textContent=`${V.length.toLocaleString()} ${S.opt.vmode==='set'?'sets':'sequences'}`;
  $('#variants').innerHTML=V.slice(0,60).map((v,i)=>`<button class="var${v.key===S.refKey?' ref':''}${S.sel&&S.sel.type==='variant'&&S.sel.key===v.key?' on':''}" data-v="${esc(v.key)}">
    <div class="var-top"><span>${i+1}</span><span class="var-pct">${pctS(v.n/tot)}</span><span>${v.n.toLocaleString()}</span><span class="var-t" title="Median ${esc(SCH.durLabel)}">${fmtMin(v.st.med)}</span></div>
    <div class="bar"><i style="width:${(v.n/V[0].n*100).toFixed(1)}%"></i></div><div class="chips">${chipsFor(v.trace)}</div>
    <div class="seqline">${esc(v.trace.map(k=>shortL(k)).join(S.opt.vmode==='set'?' + ':' → '))}</div></button>`).join('')+(V.length>60?`<p class="note">Showing the 60 most common of ${V.length.toLocaleString()}. The rest together cover ${pctS(V.slice(60).reduce((a,v)=>a+v.n,0)/tot)}.</p>`:''); }
$('#variants').onclick=e=>{ const b=e.target.closest('[data-v]'); if(!b) return; const k=b.dataset.v; S.sel=S.sel&&S.sel.type==='variant'&&S.sel.key===k?null:{type:'variant',key:k}; renderMap(); renderVariants(); renderSel(); };
$('#mapWrap').onclick=e=>{ const n=e.target.closest('[data-node]'), ed=e.target.closest('[data-edge]');
  const s=n?{type:'node',key:n.dataset.node}:ed?{type:'edge',key:ed.dataset.edge}:null;
  S.sel=s&&S.sel&&S.sel.type===s.type&&S.sel.key===s.key?null:s; renderMap(); renderVariants(); renderSel(); };
function selRecs(){ const s=S.sel, M=S.A.model; if(!s) return [];
  if(s.type==='variant'){ const v=M.variants.find(x=>x.key===s.key); return v?v.recs:[]; }
  if(s.type==='node') return S.view.filter(r=>r.trace.includes(s.key));
  const e=M.edges.get(s.key); return e?e.recs:[]; }
function selTitle(){ const s=S.sel; if(s.type==='node') return `${Tc()} with ${EVL(s.key)}`;
  if(s.type==='edge'){ const [a,b]=s.key.split('>'); return `${EVL(a)} directly followed by ${EVL(b)}`; }
  const i=S.A.model.variants.findIndex(v=>v.key===s.key); return `${S.opt.vmode==='set'?'Step set':'Sequence'} ${i+1}`+(s.key===S.refKey?' (reference flow)':''); }
function renderSel(){ const s=S.sel; $('#selHint').hidden=!!s; $('#selCard').hidden=!s; if(!s) return;
  const R=selRecs(); if(!R.length){ S.sel=null; $('#selHint').hidden=false; $('#selCard').hidden=true; return; }
  const st=stats(R,S.refKey); $('#selTitle').textContent=selTitle();
  $('#selRef').hidden=!(s.type==='variant'&&s.key!==S.refKey);
  let extra=''; if(s.type==='edge'){ const e=S.A.model.edges.get(s.key); if(e&&e.st.n) extra=`<span>Time between <b>${fmtMin(e.st.med)}</b> median · ${fmtMin(e.st.mean)} mean · P90 ${fmtMin(e.st.p90)}</span>`; }
  const at=SCH.attrs.slice(0,2), rows=R.slice().sort((a,b)=>(b.dur??-1)-(a.dur??-1)).slice(0,300);
  $('#selBody').innerHTML=`<div class="sel-stats"><span><b>${R.length.toLocaleString()}</b> ${esc(T().cases)} (${pctS(R.length/(S.A.st.n||1))})</span><span>Median ${esc(SCH.durLabel)} <b>${fmtMin(st.dur.med)}</b></span>${st.dueN?`<span>By due date <b>${pctS(st.due)}</b></span>`:''}${extra}</div>
   <div class="tbl-scroll" style="max-height:380px"><table class="t"><thead><tr><th>Case</th>${at.map(a=>`<th class="l">${esc(a.l)}</th>`).join('')}<th>${esc(shortL(SCH.start))}</th><th>${esc(shortL(SCH.end))}</th><th>Duration</th><th class="l">Sequence</th></tr></thead><tbody>${rows.map(r=>`<tr><td><button class="link" data-q="${esc(r.id)}">${esc(r.id||'–')}</button></td>${at.map(a=>`<td class="l">${esc(r.attr[a.col])}</td>`).join('')}<td>${fmtDT(r.t0)}</td><td>${fmtDT(r.t1)}</td><td>${fmtMin(r.dur)}</td><td class="l">${esc(r.trace.map(k=>shortL(k)).join(' → '))}</td></tr>`).join('')}</tbody></table></div>
   ${R.length>300?`<p class="note">Longest 300 shown; the download has all ${R.length.toLocaleString()}.</p>`:''}`; }
$('#selBody').onclick=e=>{ const b=e.target.closest('[data-q]'); if(b){ $('#q').value=b.dataset.q; showTab('lookup'); renderLookup(b.dataset.q); } };
$('#selClear').onclick=()=>{ S.sel=null; renderMap(); renderVariants(); renderSel(); };
$('#selRef').onclick=()=>{ S.refMode='custom'; S.refCustom=S.sel.key; $('#refSel option[value=custom]').disabled=false; $('#refSel').value='custom'; update(); toast('Reference flow updated'); };
$('#selCsv').onclick=()=>{ const R=selRecs();
  csv(['Case ID'].concat(SCH.attrs.map(a=>a.l),[EVL(SCH.start),EVL(SCH.end),`${SCH.durLabel} (min)`,'Sequence']),
    R.map(r=>[r.id].concat(SCH.attrs.map(a=>r.attr[a.col]),[fmtDT(r.t0),fmtDT(r.t1),r.dur==null?'':Math.round(r.dur),r.trace.map(k=>EVL(k)).join(' > ')])),`${slug(SCH.name)}_selection_${stamp()}.csv`); };

/* ---------- timing ---------- */
function renderTiming(){ const A=S.A;
  $('#timingTitle').textContent=`Each step measured from ${EVL(SCH.start).toLowerCase()}`;
  $('#timing').innerHTML=renderTimingSvg(A.T).svg;
  $('#timingTbl').innerHTML=`<table class="t"><thead><tr><th>Step</th><th>Recorded</th><th>Median from start</th><th>Middle half</th><th>P90</th><th>Mean</th><th>Before start</th><th>After end</th><th>Then median to end</th></tr></thead><tbody>${A.T.map(t=>`<tr><td>${esc(t.l)}</td><td>${pctS(t.recP)} <span class="note">(${t.rec})</span></td><td><b>${fmtMin(t.d.med)}</b></td><td>${fmtMin(t.d.p25)} to ${fmtMin(t.d.p75)}</td><td>${fmtMin(t.d.p90)}</td><td>${fmtMin(t.d.mean)}</td><td>${pctS(t.before)}</td><td>${t.after==null?'–':pctS(t.after)}</td><td>${t.toEnd?fmtMin(t.toEnd.med):'–'}</td></tr>`).join('')}</tbody></table>`;
  $('#last').innerHTML=renderLastSvg(A.L).svg;
  const minN=Math.max(1,S.edgeMin), E=[...A.model.edges.values()].filter(e=>e.a!=='S'&&e.b!=='E'&&e.st.n>=minN).sort((a,b)=>b.st.med-a.st.med);
  $('#edges').innerHTML=`<table class="t"><thead><tr><th>Transition</th><th>n</th><th>Median</th><th>Mean</th><th>P75</th><th>P90</th></tr></thead><tbody>${E.map(e=>`<tr class="click" data-e="${e.key}"><td>${esc(EVL(e.a))} → ${esc(EVL(e.b))}${e.a===SCH.end?' <span class="note">(after the end)</span>':''}</td><td>${e.n}</td><td><b>${fmtMin(e.st.med)}</b></td><td>${fmtMin(e.st.mean)}</td><td>${fmtMin(e.st.p75)}</td><td>${fmtMin(e.st.p90)}</td></tr>`).join('')}</tbody></table>`;
  $('#reasonsCard').hidden=!A.RS.length;
  $('#reasons').innerHTML=A.RS.map((R,i)=>`<div><h3 style="margin-top:0">${esc(R.l)} <span class="note">${R.any.toLocaleString()} ${esc(T().cases)} (${pctS(R.anyP)}) · none recorded: median ${fmtMin(R.none.med)}</span></h3>${R.rows.length?`<div class="tbl-scroll" style="max-height:260px"><table class="t"><thead><tr><th>Reason as recorded</th><th>n</th><th>%</th><th>Median duration</th></tr></thead><tbody>${R.rows.map(x=>`<tr class="click" data-rk="r${i}" data-rv="${esc(x.v)}"><td class="wrap">${esc(x.v)}</td><td>${x.n}</td><td>${pctS(x.p)}</td><td>${fmtMin(x.st.med)}</td></tr>`).join('')}</tbody></table></div>`:`<p class="empty-msg">None recorded in the filtered ${esc(T().cases)}.</p>`}</div>`).join(''); }
$('#reasons').onclick=e=>{ const t=e.target.closest('[data-rk]'); if(t) addFilter(t.dataset.rk,t.dataset.rv); };
$('#edges').onclick=e=>{ const t=e.target.closest('[data-e]'); if(!t) return; S.sel={type:'edge',key:t.dataset.e}; showTab('process'); renderMap(); renderVariants(); renderSel(); };
$('#edgeMin').onchange=e=>{ S.edgeMin=Math.max(1,+e.target.value||1); renderTiming(); };

/* ---------- groups and days ---------- */
function bcols(){ const base=[['key','Group',x=>x.key,'l'],['n',Tc(),x=>x.n],['med','Median',x=>x.st.dur.med,'t'],['p75','P75',x=>x.st.dur.p75,'t'],['p90','P90',x=>x.st.dur.p90,'t'],['conf','Reference flow',x=>x.st.conf,'p']];
  if(SCH.dueCol) base.push(['due','By due date',x=>x.st.due,'p']);
  if(SCH.reasons.length){ base.push(['rsn','Delay reason recorded',x=>x.st.reason,'p']); base.push(['top','Most recorded delay reason',x=>x.top?`${x.top.v} (${x.top.n})`:'','l']); }
  if(window.PPE_BCOLS_EXTRA) window.PPE_BCOLS_EXTRA(base,S);
  return base; }
const cellV=(c,x)=>{ const v=c[2](x); return c[3]==='t'?fmtMin(v):c[3]==='p'?pctS(v):(typeof v==='number'?v.toLocaleString():esc(v)); };
function bTable(list,opts){ const med=S.A.st.dur.med, C=bcols();
  return `<table class="t"><thead><tr>${C.map(c=>`<th class="${opts.sort?'s ':''}${c[3]==='l'?'l':''}" data-s="${c[0]}">${esc(c[0]==='key'?opts.label:c[1])}${opts.sort&&S.sort.c===c[0]?(S.sort.d>0?' ▲':' ▼'):''}</th>`).join('')}</tr></thead><tbody>${list.map(x=>{ const small=x.n<S.minN, hi=!small&&med!=null&&x.st.dur.med!=null&&x.st.dur.med>med*1.25;
    return `<tr class="${opts.click?'click':''}" ${opts.click?`data-bk="${esc(x.key)}"`:''} style="${small?'opacity:.55':''}">${C.map(c=>`<td class="${c[3]==='l'?'l':''}${c[0]==='med'&&hi?' hi':''}${c[0]==='top'?' wrap':''}">${c[0]==='key'&&opts.fmt?esc(opts.fmt(x.key)):cellV(c,x)}${c[0]==='med'&&hi?' ▲':''}</td>`).join('')}</tr>`; }).join('')}</tbody>${opts.foot?`<tfoot><tr>${C.map(c=>`<td class="${c[3]==='l'?'l':''}">${c[0]==='key'?'All filtered':cellV(c,opts.foot)}</td>`).join('')}</tr></tfoot>`:''}</table>`; }
function allRow(){ return {key:'All',n:S.A.st.n,st:S.A.st,top:topReason(S.view),recs:S.view}; }
function renderCompare(){ const A=S.A;
  $('#wkNote').textContent=`Day from the ${basisLabel()} time; weekend = ${wkLabel()} (change in Settings)`;
  const wk=['Weekday','Weekend'].map(k=>A.wk[k]).filter(Boolean);
  $('#wk').innerHTML=bTable(wk.concat(A.dows),{label:'Day',click:false});
  const d=FDM[S.dim]; if(!d) return; const list=breakdown(S.view,d[2],S.refKey);
  const C=bcols(), col=C.find(c=>c[0]===S.sort.c)||C[1];
  list.sort((a,b)=>{ const va=col[2](a), vb=col[2](b); if(va==null&&vb==null) return 0; if(va==null) return 1; if(vb==null) return -1; return (typeof va==='string'?va.localeCompare(vb):va-vb)*S.sort.d; });
  $('#breakdown').innerHTML=bTable(list,{label:d[1],sort:true,click:true,foot:allRow(),fmt:d[3]}); }
$('#dim').onchange=e=>{ S.dim=e.target.value; renderCompare(); };
$('#minN').onchange=e=>{ S.minN=Math.max(1,+e.target.value||1); update(); };
$('#breakdown').onclick=e=>{ const th=e.target.closest('th[data-s]'); if(th){ const c=th.dataset.s; S.sort=S.sort.c===c?{c,d:-S.sort.d}:{c,d:c==='key'?1:-1}; renderCompare(); return; }
  const tr=e.target.closest('[data-bk]'); if(tr) addFilter(S.dim,tr.dataset.bk); };
$('#bdCsv').onclick=()=>{ const d=FDM[S.dim], C=bcols(), list=breakdown(S.view,d[2],S.refKey).sort((a,b)=>b.n-a.n);
  csv([d[1]].concat(C.slice(1).map(c=>c[1]+(c[3]==='t'?' (min)':c[3]==='p'?' (%)':''))),list.map(x=>[d[3]?d[3](x.key):x.key].concat(C.slice(1).map(c=>{ const v=c[2](x); return v==null?'':c[3]==='t'?Math.round(v):c[3]==='p'?(v*100).toFixed(1):v; }))),`${slug(SCH.name)}_breakdown_${stamp()}.csv`); };

/* ---------- time of day ---------- */
const hmBasisLabel=()=>S.hm.basis==='end'?shortL(SCH.end).toLowerCase():shortL(SCH.start).toLowerCase();
function heatLabel(){ return `${S.hm.metric==='n'?Tc():S.hm.metric==='dur'?`Median ${SCH.durLabel} (hours)`:'% following the reference flow'} by ${hmBasisLabel()} day and hour`; }
function renderTime(){ const Hd=heatData(S.view,S.hm.metric,S.hm.basis,S.refKey), none=!Object.keys(Hd.cells).length;
  $$('#hmBasis button').forEach(b=>b.textContent='By '+(b.dataset.b==='end'?shortL(SCH.end):shortL(SCH.start)).toLowerCase());
  $('#heat').innerHTML=none?`<p class="err" style="margin:0">No filtered ${esc(T().case)} has a readable ${esc(hmBasisLabel())} time, so this grid cannot be filled. See Findings → Data checks.</p>`:renderHeatSvg(Hd,hmBasisLabel()).svg;
  $('#hour').innerHTML=renderHourSvg(S.view).svg; }
$$('#hmBasis button').forEach(b=>b.onclick=()=>{ S.hm.basis=b.dataset.b; $$('#hmBasis button').forEach(x=>x.classList.toggle('on',x===b)); renderTime(); });
$$('#hmMetric button').forEach(b=>b.onclick=()=>{ S.hm.metric=b.dataset.m; $$('#hmMetric button').forEach(x=>x.classList.toggle('on',x===b)); renderTime(); });

/* ---------- findings ---------- */
function renderFindings(){ $('#findings').innerHTML=S.A.findings.map(t=>`<li>${esc(t)}</li>`).join('')||`<li>No ${esc(T().cases)} in the current filters.</li>`; $('#dq').innerHTML=dqList().map(t=>`<li>${esc(t)}</li>`).join('');
  const M=S.meta; $('#colDiag').innerHTML=`<table class="t"><thead><tr><th>Step</th><th class="l">Column</th><th>Values</th><th>Read as date</th><th class="l">Unreadable example</th><th class="l">Role in flow</th></tr></thead><tbody>${SCH.steps.map(e=>{ const D=M.diag[e.k];
    return `<tr><td>${esc(e.l)}</td><td class="l">${esc(D.col)}</td><td>${D.non.toLocaleString()}</td><td class="${D.non&&!D.ok?'hi':''}">${D.ok.toLocaleString()}</td><td class="l">${esc(D.badEx||'')}</td><td class="l">${e.k===SCH.start?'Start':e.k===SCH.end?'End':e.happy?'Happy flow':'Optional'}</td></tr>`; }).join('')}</tbody></table>`; }
$('#draftBtn').onclick=()=>{ const t=$('#recs'); const d=draftRecs(S.A,S.minN,basisLabel()); if(!d){ toast('Nothing to draft from the current filters',true); return; }
  if(t.value.trim()&&!confirm('Replace the current text with a new draft?')) return; t.value=d; };

/* ---------- lookup ---------- */
function renderLookup(q){ S.lastQ=q; q=String(q||'').trim(); if(!q){ $('#lookupRes').innerHTML='<p class="empty-msg">Enter a case ID.</p>'; return; }
  const ql=q.toLowerCase(); let R=S.all.filter(r=>r.id.toLowerCase()===ql);
  if(!R.length) R=S.all.filter(r=>r.id.toLowerCase().includes(ql));
  if(!R.length){ $('#lookupRes').innerHTML=`<p class="empty-msg">No ${esc(T().case)} with an ID matching "${esc(q)}" in the loaded file.</p>`; return; }
  const more=R.length>15; R=R.slice(0,15);
  $('#lookupRes').innerHTML=(more?'<p class="note">More than 15 matches: showing the first 15. Type the full ID to narrow.</p>':'')+R.map(encCard).join(''); }
function encCard(r){ const TT=S.A.T, med=Object.fromEntries(TT.map(t=>[t.k,t.d.med])), inView=S.view.includes(r);
  const v=S.A.model.variants.find(x=>x.key===r.vkey), seq=r.trace.map(k=>shortL(k)).join(' → ');
  const fact=(l,x)=>`<div><span>${esc(l)}:</span> ${esc(x||'–')}</div>`;
  const rows=SCH.steps.map(e=>{ const t=r.t[e.k], off=r.off[e.k], isS=e.k===SCH.start, m=isS?null:med[e.k], diff=off!=null&&m!=null?off-m:null;
    return `<tr><td>${esc(e.l)}</td><td>${fmtDT(t)}</td><td>${isS?'–':fmtMin(off)}</td><td>${isS?'–':fmtMin(m)}</td><td class="${diff!=null&&diff>0?'hi':''}">${diff==null?'–':(diff>0?'+':'')+fmtMin(diff)}</td></tr>`; }).join('');
  const reasons=SCH.reasons.filter(q=>r.reason[q.k]).map(q=>`<div><span>${esc(q.l)}:</span> ${esc(r.reason[q.k])}</div>`).join('')||(SCH.reasons.length?'<div><span>Delay reasons:</span> none recorded</div>':'');
  const extra=window.PPE_CASE_EXTRA?window.PPE_CASE_EXTRA(r):'';
  return `<div class="enc"><div class="enc-h"><b>${esc(T().case.charAt(0).toUpperCase()+T().case.slice(1))} ${esc(r.id)}</b><span>Row ${r.row}</span><span>${esc(SCH.durLabel)} <b>${fmtMin(r.dur)}</b>${S.A.st.dur.med!=null?` (filtered median ${fmtMin(S.A.st.dur.med)})`:''}</span></div>
   <div class="facts">${SCH.attrs.map(a=>fact(a.l,a.type==='num'&&r.num[a.col]!=null?String(r.num[a.col]):r.attr[a.col])).join('')}${SCH.dueCol?fact('Due date',fmtD(r.due))+fact('Ended by due date',r.byDue==null?'–':r.byDue?'Yes':`No (${r.dueDelta} day${Math.abs(r.dueDelta)===1?'':'s'} after)`):''}${fact('Weekday / weekend',`${r.dayType} (${r.dowL}, by ${basisLabel()})`)}</div>
   <div class="chips" style="margin-bottom:6px">${chipsFor(r.vtrace)}</div><div class="seqline" style="margin-bottom:8px">Recorded sequence: ${esc(seq)}</div>
   <div class="chart-scroll">${renderEncSvg(r,TT).svg}</div>
   <div class="tbl-scroll" style="margin-top:8px"><table class="t"><thead><tr><th>Step</th><th>Recorded at</th><th>From start</th><th>Filtered median</th><th>Difference</th></tr></thead><tbody>${rows}</tbody></table></div>
   <div class="facts" style="margin-top:10px">${reasons}</div>${extra}
   <div class="ctrl" style="margin-top:8px">${inView&&v?`<button class="btn ghost" data-show="${esc(r.vkey)}">Show its sequence on the map</button><span class="note" style="margin:0">${v.n.toLocaleString()} filtered ${esc(T().cases)} share it (${pctS(v.n/S.A.st.n)})</span>`:'<span class="note" style="margin:0">Outside the current filters, so it is not on the map.</span>'}</div></div>`; }
$('#qBtn').onclick=()=>renderLookup($('#q').value);
$('#q').onkeydown=e=>{ if(e.key==='Enter') renderLookup($('#q').value); };
$('#lookupRes').onclick=e=>{ const b=e.target.closest('[data-show]'); if(!b) return; S.sel={type:'variant',key:b.dataset.show}; showTab('process'); renderMap(); renderVariants(); renderSel(); };

/* ---------- export ---------- */
function raster(r,scale){ scale=scale||2; return new Promise((res,rej)=>{ const img=new Image();
  img.onload=()=>{ const c=document.createElement('canvas'); c.width=Math.round(r.w*scale); c.height=Math.round(r.h*scale); const x=c.getContext('2d');
    x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height); x.drawImage(img,0,0,c.width,c.height);
    c.toBlob(b=>{ if(!b) return rej(new Error('image render failed')); b.arrayBuffer().then(ab=>res({png:new Uint8Array(ab),w:r.w,h:r.h})); },'image/png'); };
  img.onerror=()=>rej(new Error('chart render failed')); img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(r.svg); }); }
function periodText(){ const d=S.view.map(r=>r.t1).sort((a,b)=>a-b); return d.length?`${fmtD(d[0])} to ${fmtD(d[d.length-1])}`:'none'; }
async function exportDeck(){ const b=$('#exportBtn'); if(!S.view.length){ toast(`No ${T().cases} in the current filters`,true); return; } b.disabled=true; toast('Building slides…');
  try{ const A=S.A;
    const img={ map:await raster(renderMapSvgH(A.model,{ref:S.ref,order:A.order,metric:'freq',minPct:S.minPct,slow:A.slow,timing:A.timing})), timing:await raster(renderTimingSvg(A.T)),
      last:await raster(renderLastSvg(A.L)), hour:await raster(renderHourSvg(S.view)), heat:await raster(renderHeatSvg(heatData(S.view,S.hm.metric,S.hm.basis,S.refKey),hmBasisLabel())) };
    const d=new Date(), gen=`${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${d.getFullYear()}`;
    const ctx={scope:scopeText(),period:periodText(),generated:gen,refLabel:refLabel(),post:S.opt.post,vmode:S.opt.vmode,basisLabel:basisLabel(),weekendLabel:wkLabel(),minN:S.minN,heatLabel:heatLabel(),recText:$('#recs').value,dq:dqList().slice(1)};
    if(window.PPE_DECK_EXTRA) await window.PPE_DECK_EXTRA(ctx,S,raster);
    const bytes=buildDeck(A,ctx,img);
    download(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'}),`${slug(SCH.name)}_review_${stamp()}.pptx`);
    toast('Slides exported');
  }catch(e){ console.error(e); toast('Export failed: '+(e.message||e),true); }
  b.disabled=false; }

/* ---------- events ---------- */
$('#file').onchange=e=>load(e.target.files[0]);
['#loadLbl','#cfgLbl'].forEach(id=>{ const el=$(id); if(el) el.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); $(el.getAttribute('for')==='cfgFile'?'#cfgFile':'#file').click(); } }; });
['dragenter','dragover'].forEach(ev=>window.addEventListener(ev,e=>{ e.preventDefault(); $('#empty').classList.add('drag'); }));
['dragleave','drop'].forEach(ev=>window.addEventListener(ev,e=>{ e.preventDefault(); $('#empty').classList.remove('drag'); }));
window.addEventListener('drop',e=>{ const dt=e.dataTransfer; if(!dt) return; let f=dt.files&&dt.files[0];
  if(!f&&dt.items) for(const it of dt.items){ if(it.kind==='file'){ f=it.getAsFile(); break; } }
  if(!f){ toast('Nothing to load: drop the file itself (save an e-mail attachment to disk first).',true); return; }
  if(/\.json$/i.test(f.name)) readCfgFile(f); else load(f); });
const sb=document.getElementById('scriptBlocked'); if(sb) sb.remove();
$('#exportBtn').onclick=exportDeck;
$('#tabs').onclick=e=>{ const b=e.target.closest('button[data-tab]'); if(b) showTab(b.dataset.tab); };
function showTab(t){ $$('#tabs button').forEach(x=>x.classList.toggle('on',x.dataset.tab===t)); $$('.tab').forEach(el=>el.hidden=el.id!=='tab-'+t); if(t==='process') fitMap(); }
$$('#metricSeg button').forEach(b=>b.onclick=()=>{ S.metric=b.dataset.m; $$('#metricSeg button').forEach(x=>x.classList.toggle('on',x===b)); renderMap(); });
$('#minPct').oninput=e=>{ S.minPct=+e.target.value; $('#minPctV').textContent=S.minPct+'%'; renderMap(); };
$('#postChk').onchange=e=>{ S.opt.post=e.target.checked; S.sel=null; recompute(); };
$('#refSel').onchange=e=>{ S.refMode=e.target.value; update(); };
$$('#vmodeSeg button').forEach(b=>b.onclick=()=>{ S.opt.vmode=b.dataset.v; $$('#vmodeSeg button').forEach(x=>x.classList.toggle('on',x===b)); S.sel=null; S.refCustom=null; if(S.refMode==='custom'){ S.refMode='happy'; $('#refSel').value='happy'; } $('#refSel option[value=custom]').disabled=true; recompute(); });
$$('#combSeg button').forEach(b=>b.onclick=()=>{ S.combine=b.dataset.c; $$('#combSeg button').forEach(x=>x.classList.toggle('on',x===b)); S.sel=null; update(); });
$('#clearF').onclick=()=>{ S.f={}; if(window.PPE_CLEAR_SEGMENT) window.PPE_CLEAR_SEGMENT(); S.sel=null; update(); };
$('#moreBtn').onclick=()=>{ const m=$('#more'); m.hidden=!m.hidden; $('#moreBtn').textContent=m.hidden?'More filters':'Fewer filters'; };
$('#setBtn').onclick=()=>{ $('#setPop').hidden=!$('#setPop').hidden; };
function syncSettingsUI(){ $('#wkDays').innerHTML=DAY_ORDER.map(d=>`<label><input type="checkbox" value="${d}"${S.opt.weekend.includes(d)?' checked':''}>${DAYS[d]}</label>`).join('');
  $$('#basisSeg button').forEach(x=>{ x.classList.toggle('on',x.dataset.b===S.opt.basis); x.textContent=(x.dataset.b==='end'?shortL(SCH.end):shortL(SCH.start)); }); }
$('#wkDays').onchange=()=>{ S.opt.weekend=$$('#wkDays input:checked').map(i=>+i.value); if(S.cfg) S.cfg.settings.weekend=S.opt.weekend.slice(); if(S.all.length) recompute(); };
$$('#basisSeg button').forEach(b=>b.onclick=()=>{ S.opt.basis=b.dataset.b; if(S.cfg) S.cfg.settings.basis=S.opt.basis; $$('#basisSeg button').forEach(x=>x.classList.toggle('on',x===b)); if(S.all.length) recompute(); });

// #sample opens the synthetic sample with its saved setup already applied (for demos)
if(location.hash==='#sample'){ $('#sampleBtn').click(); applySetup(); }

// hooks for optional modules (rules and risk) loaded after this file
window.PPE={S,update,toast,esc,addFilter,showTab,applyFilters,basisLabel,wkLabel,csv,stamp,slug,exportCfg};
})();
