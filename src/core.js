'use strict';
/* =====================================================================
   Proxy Process Explorer: core
   Pure functions: no DOM, no network. Loaded by the page and by the Node tests.
   ===================================================================== */

/* ---------- palette ----------
   Brand tokens (mmonfar): deep slate, warm cream, teal and opacities of teal. */
const PAL = { ink:'#17242B', ink2:'#6E7B80', ink3:'#B3BABD', rule:'#E3E5E4', cream:'#FDFBF7', white:'#FFFFFF',
  teal:'#008080', tealB:'#00A3A3', t2:'#60AFAD', t3:'#89C2C0', t4:'#ACD4D1', t5:'#BBDBD8', t6:'#E4EFEB' };
/* Non-brand semantic constants. They mark a state (a breach, a step recorded out of order) and are
   always paired with a text label, so colour is never the only signal. */
const SEM = { alert:'#B74040', alertWash:'#F5E3E3', skip:'#C08A55' };
const FONT = "'Space Grotesk','Segoe UI',system-ui,sans-serif";

/* ---------- small helpers ---------- */
const XML_ENT = { '&amp;':'&', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&apos;':"'" };
function xmlDecode(s){ return s.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#\d+);/g,(m,g)=>{
  if(g[0]==='#') return String.fromCodePoint(g[1]==='x'||g[1]==='X'?parseInt(g.slice(2),16):parseInt(g.slice(1),10));
  return XML_ENT[m]; }); }
function unesc(s){ return xmlDecode(s).replace(/_x([0-9A-Fa-f]{4})_/g,(m,h)=>String.fromCharCode(parseInt(h,16))); }
function xmlEsc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,''); }
function attrs(tag){ const o={}; tag.replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,(m,k,v1,v2)=>{ o[k]=xmlDecode(v1!=null?v1:v2); return m; }); return o; }
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function monthLabel(k){ if(!k||k==='Unknown') return 'Unknown'; const [y,m]=k.split('-'); return MON[+m-1]+' '+y; }
const p2=n=>String(n).padStart(2,'0');
function fmtDT(d){ if(!d) return '–'; return `${p2(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; }
function fmtD(d){ if(!d) return '–'; return `${p2(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
function fmtMin(m){ if(m==null||isNaN(m)) return '–'; const neg=m<0, a=Math.abs(m); let t;
  if(a<60) t=Math.round(a)+' min'; else if(a<48*60) t=(a/60).toFixed(1)+' h'; else t=(a/1440).toFixed(1)+' d';
  return (neg?'−':'')+t; }
function pctS(p){ return p==null||isNaN(p)?'–':(p*100).toFixed(p<0.1&&p>0?1:0)+'%'; }
function hhmm(h,m){ return p2(h)+':'+p2(m||0); }
const mins=(a,b)=>(a&&b)?(a-b)/6e4:null;
const dayKey=d=>d?Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()):null;
function quant(s,p){ if(!s.length) return null; const i=(s.length-1)*p, lo=Math.floor(i), hi=Math.ceil(i); return s[lo]+(s[hi]-s[lo])*(i-lo); }
function dist(a){ const s=a.filter(x=>x!=null&&isFinite(x)).sort((x,y)=>x-y);
  return {n:s.length,med:quant(s,.5),p25:quant(s,.25),p75:quant(s,.75),p90:quant(s,.9),mean:s.length?s.reduce((x,y)=>x+y,0)/s.length:null,min:s[0],max:s[s.length-1]}; }
const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_ORDER=[1,2,3,4,5,6,0];

/* =====================================================================
   ZIP reading (native DecompressionStream)
   ===================================================================== */
async function inflateRaw(u8){
  if(typeof DecompressionStream==='undefined') throw new Error('This browser cannot decompress .xlsx files. Use a current version of Edge, Chrome or Firefox, or save the file as .csv.');
  const stream=new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function openZip(buf){
  const u8=new Uint8Array(buf), dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  let e=-1;
  for(let i=u8.length-22;i>=Math.max(0,u8.length-65557);i--){ if(dv.getUint32(i,true)===0x06054b50){ e=i; break; } }
  if(e<0) throw new Error('The file is not a valid .xlsx workbook.');
  const n=dv.getUint16(e+10,true); let p=dv.getUint32(e+16,true);
  const td=new TextDecoder(), files={};
  for(let k=0;k<n;k++){
    if(dv.getUint32(p,true)!==0x02014b50) throw new Error('The workbook structure is damaged (zip directory).');
    const method=dv.getUint16(p+10,true), csize=dv.getUint32(p+20,true), nl=dv.getUint16(p+28,true),
          xl=dv.getUint16(p+30,true), cl=dv.getUint16(p+32,true), lo=dv.getUint32(p+42,true);
    files[td.decode(u8.subarray(p+46,p+46+nl))]={method,csize,lo};
    p+=46+nl+xl+cl;
  }
  return {
    names:Object.keys(files),
    async text(nm){
      const f=files[nm]||files[Object.keys(files).find(k=>k.toLowerCase()===nm.toLowerCase())];
      if(!f) return null;
      const start=f.lo+30+dv.getUint16(f.lo+26,true)+dv.getUint16(f.lo+28,true);
      const raw=u8.subarray(start,start+f.csize);
      let out;
      if(f.method===0) out=raw; else if(f.method===8) out=await inflateRaw(raw);
      else throw new Error('Unsupported compression in workbook ('+f.method+').');
      return td.decode(out);
    }
  };
}

/* =====================================================================
   XLSX / CSV parsing
   ===================================================================== */
function siText(x){ x=x.replace(/<rPh\b[\s\S]*?<\/rPh>/g,''); let out='',m; const re=/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g; while((m=re.exec(x))) out+=m[1]; return unesc(out); }
function colIdx(ref){ const L=(ref.match(/^[A-Z]+/i)||['A'])[0].toUpperCase(); let n=0; for(const ch of L) n=n*26+(ch.charCodeAt(0)-64); return n-1; }
function parseSheet(xml,sst,maxRows){
  const rows=[]; const rre=/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g; let rm;
  while((rm=rre.exec(xml))){
    const inner=rm[1], row=[];
    if(inner){
      const cre=/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let cm, auto=0;
      while((cm=cre.exec(inner))){
        const a=attrs(cm[1]); const ci=a.r?colIdx(a.r):auto; auto=ci+1;
        const body=cm[2]||'', t=a.t||'n'; let v=null;
        if(t==='inlineStr') v=siText(body);
        else { const vm=body.match(/<v>([\s\S]*?)<\/v>/);
          if(vm){ const raw=vm[1];
            if(t==='s') v=sst[+raw]!=null?sst[+raw]:'';
            else if(t==='b') v=raw==='1';
            else if(t==='str'||t==='e'||t==='d') v=unesc(raw);
            else { const num=Number(raw); v=isNaN(num)?unesc(raw):num; } } }
        row[ci]=v;
      }
    }
    rows.push(row); if(maxRows&&rows.length>=maxRows) break;
  }
  return rows;
}
async function readXlsxRows(buf){
  const z=openZip(buf);
  const wb=await z.text('xl/workbook.xml'); if(!wb) throw new Error('No workbook found inside the file. Is it an .xlsx file?');
  const rels=(await z.text('xl/_rels/workbook.xml.rels'))||'';
  const relMap={}; (rels.match(/<Relationship\b[^>]*>/g)||[]).forEach(t=>{ const a=attrs(t); relMap[a.Id]=a.Target; });
  const sheets=(wb.match(/<sheet\b[^>]*>/g)||[]).map(t=>{ const a=attrs(t); const rk=Object.keys(a).find(k=>/(^|:)id$/.test(k));
    let tg=relMap[a[rk]]||''; tg=tg.startsWith('/')?tg.slice(1):'xl/'+tg.replace(/^\.\//,''); return {name:a.name,path:tg}; });
  const sstXml=await z.text('xl/sharedStrings.xml'); const sst=[];
  if(sstXml){ const re=/<si>([\s\S]*?)<\/si>|<si\/>/g; let m; while((m=re.exec(sstXml))) sst.push(m[1]?siText(m[1]):''); }
  let best=null;
  for(const sh of sheets){ const xml=await z.text(sh.path); if(!xml) continue;
    const h=findHeader(parseSheet(xml,sst,40)); if(!best||h.score>best.h.score) best={sh,xml,h}; }
  if(!best) throw new Error('No worksheets could be read from the workbook.');
  return { rows:parseSheet(best.xml,sst), sheet:best.sh.name };
}
function parseCsv(text){
  text=text.replace(/^﻿/,''); const first=text.split(/\r?\n/,1)[0];
  const d=[',',';','\t'].sort((a,b)=>first.split(b).length-first.split(a).length)[0];
  const rows=[]; let row=[],f='',q=false;
  for(let i=0;i<text.length;i++){ const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){f+='"';i++;} else q=false; } else f+=c; }
    else if(c==='"') q=true; else if(c===d){ row.push(f); f=''; }
    else if(c==='\n'){ row.push(f); rows.push(row); row=[]; f=''; } else if(c!=='\r') f+=c; }
  if(f!==''||row.length){ row.push(f); rows.push(row); }
  return rows;
}

/* =====================================================================
   Dates and values
   ===================================================================== */
function mkD(y,mo,d,h,mi,ap){ y=+y; if(y<100) y+=2000; h=+(h||0); mi=+(mi||0);
  if(ap){ const pm=ap.toUpperCase().startsWith('P'); if(pm&&h<12) h+=12; if(!pm&&h===12) h=0; }
  if(!(mo>=0&&mo<12)||!(d>=1&&d<=31)||h>23||mi>59) return null;
  const x=new Date(Date.UTC(y,mo,+d,h,mi)); return isNaN(x)?null:x; }
const MONFULL=['january','february','march','april','may','june','july','august','september','october','november','december'];
const monIdx=t=>{ t=t.toLowerCase(); return MONFULL.findIndex(m=>m.startsWith(t.slice(0,3))); };
// All times are kept to the minute (seconds dropped, as spreadsheets show hh:mm).
// Times are read as written (wall-clock), stored in UTC fields so no time zone shifts them.
function toDate(v,dayFirst){
  if(v==null||v==='') return null;
  if(v instanceof Date) return isNaN(v)?null:new Date(Math.floor(v.getTime()/6e4)*6e4);
  if(typeof v==='number'){ return (v>20000&&v<80000)? new Date(Math.floor(Math.round((v-25569)*864e5)/6e4)*6e4) : null; }
  const s=String(v).trim().replace(/ /g,' ').replace(/\s+/g,' '); let m;
  const T='(?:[T ,]+(\\d{1,2})[:.](\\d{2})(?:[:.]\\d{2}(?:[.,]\\d+)?)?\\s*([AaPp]\\.?[Mm]\\.?)?)?(?:Z|[+-]\\d{2}:?\\d{2})?';
  if(/^\d{5}([.,]\d+)?$/.test(s)) return toDate(parseFloat(s.replace(',','.')));                           // spreadsheet serial saved as text
  if((m=s.match(new RegExp('^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})'+T+'$'))))                             // 2026-06-01 08:15
    return mkD(m[1],m[2]-1,m[3],m[4],m[5],m[6]);
  if((m=s.match(new RegExp('^(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{2,4})'+T+'$')))){                          // 01/06/2026 8:15 AM
    let a=+m[1],b=+m[2],d,mo; if(a>12){d=a;mo=b;} else if(b>12){mo=a;d=b;} else if(dayFirst!==false){d=a;mo=b;} else {mo=a;d=b;}
    return mkD(m[3],mo-1,d,m[4],m[5],m[6]); }
  if((m=s.match(new RegExp('^(\\d{1,2})[- ]([A-Za-z]{3,9})\\.?[- ,]+(\\d{2,4})'+T+'$'))))                    // 01-Jun-2026 08:15
    return mkD(m[3],monIdx(m[2]),m[1],m[4],m[5],m[6]);
  if((m=s.match(new RegExp('^(?:[A-Za-z]{3,9},? )?([A-Za-z]{3,9})\\.? (\\d{1,2}),? (\\d{4})'+T+'$'))))         // Jun 1 2026 8:15AM
    return mkD(m[3],monIdx(m[1]),m[2],m[4],m[5],m[6]);
  return null;
}
function str(v){ if(v==null) return ''; if(v instanceof Date) return fmtDT(v); return String(v).trim(); }
const nonEmpty=v=>v!=null&&String(v).trim()!=='';
function detectDayFirst(values){
  let df=0,mf=0,amb=0;
  for(const v of values){ if(typeof v!=='string') continue;
    const m=v.trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-]\d{2,4}/); if(!m) continue;
    if(+m[1]>12) df++; else if(+m[2]>12) mf++; else amb++; }
  return { dayFirst: mf>df?false:true, ambiguousOnly: amb>0&&!df&&!mf, conflict: df>0&&mf>0 };
}

/* =====================================================================
   Table: header detection and column profiling (feeds the setup wizard)
   ===================================================================== */
const looksNum=v=>typeof v==='number'||(typeof v==='string'&&/^-?\d+([.,]\d+)?$/.test(v.trim()));
// The header row is the row (in the first 40) with the most text cells that are neither numbers nor dates.
function findHeader(rows){
  let best={idx:-1,score:0};
  for(let i=0;i<Math.min(40,rows.length);i++){ const r=rows[i]||[]; let sc=0;
    for(const v of r){ if(typeof v==='string'&&v.trim()&&!looksNum(v)&&!toDate(v)) sc++; }
    if(sc>best.score&&(rows[i+1]||[]).some(nonEmpty)) best={idx:i,score:sc}; }
  return best;
}
function toTable(rows,sheet){
  const h=findHeader(rows);
  if(h.idx<0||h.score<2) throw new Error('No header row was found. The first rows of the file should hold one column name per column.');
  const seen={}, header=(rows[h.idx]||[]).map((v,i)=>{ let n=str(v)||`Column ${i+1}`; if(seen[n]) n+=` (${++seen[n]})`; else seen[n]=1; return n; });
  const data=rows.slice(h.idx+1).filter(r=>r&&r.some(nonEmpty));
  return {header,data,headerRow:h.idx+1,sheet:sheet||''};
}
/* Personal data: columns whose names suggest a direct identifier are ignored by default, so a
   file with names or record numbers can still be explored without them entering the analysis. */
const PII_TOKENS=new Set(['surname','firstname','lastname','fullname','patientname','forename','dob','birthdate','dateofbirth','birth','mrn','nhs','ssn','passport','nationality','national','insurance','insurer','policy','phone','mobile','telephone','tel','email','mail','address','postcode','zipcode','zip','street','ip']);
const NAME_CTX=new Set(['patient','person','first','last','full','given','family','client','customer','member','user','staff','employee']);
function headerTokens(h){ return String(h).replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }
function isPiiHeader(h){ const t=headerTokens(h), j=t.join('');
  if(t.some(x=>PII_TOKENS.has(x))||PII_TOKENS.has(j)) return true;
  if(t.includes('name')&&(t.length===1||t.some(x=>NAME_CTX.has(x)))) return true;
  return false; }
const DATE_HINT=/(date|time|_at$|^at_|dttm|datetime|timestamp|\bdt\b|\bts\b)/i;
const DUE_HINT=/(due|expected|target|planned|estimated|edd|deadline)/i;
const ID_HINT=/(^|[^a-z])(id|key|case|encounter|ticket|reference|ref|number|no)([^a-z]|$)/i;
const REASON_HINT=/(reason|cause|barrier|delay_?code)/i;
function profileColumns(table,maxRows){
  const R=table.data.slice(0,maxRows||3000);
  return table.header.map((col,i)=>{
    const vals=R.map(r=>r[i]).filter(nonEmpty), n=vals.length;
    const hint=DATE_HINT.test(col);
    const isDate=v=>typeof v==='number'?((hint||v%1!==0)&&!!toDate(v)):!!toDate(v);
    const dateN=vals.filter(isDate).length, numN=vals.filter(looksNum).length;
    const distinctSet=new Set(vals.map(v=>String(v))), distinct=distinctSet.size;
    const sample=[...distinctSet].slice(0,3).map(v=>v.length>28?v.slice(0,26)+'…':v);
    const p={col,idx:i,n,fill:R.length?n/R.length:0,dateShare:n?dateN/n:0,numShare:n?numN/n:0,distinct,sample,pii:isPiiHeader(col)};
    p.role=suggestRole(p); p.type=p.numShare>=0.95&&distinct>12?'num':'cat';
    return p; });
}
function suggestRole(p){
  if(!p.n) return 'ignore';
  if(p.pii) return 'ignore';
  if(p.dateShare>=0.6) return DUE_HINT.test(p.col)?'due':'step';
  if(ID_HINT.test(p.col)&&p.distinct>=0.9*p.n) return 'id';
  if(REASON_HINT.test(p.col)) return 'reason';
  if(p.numShare>=0.95) return p.distinct>=0.9*p.n&&p.n>50?'ignore':'attribute';
  if(p.distinct<=Math.max(40,0.2*p.n)) return 'attribute';
  return 'ignore';   // free text or near-unique values
}

/* =====================================================================
   Configuration: the wizard's output, one plain JSON document
   ===================================================================== */
const CONFIG_SCHEMA='proxy-process-explorer/config@1';
const ROLES=['ignore','id','step','attribute','reason','due'];
function humanise(col){ let s=String(col).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_\-.]+/g,' ').replace(/\s+/g,' ').trim();
  s=s.replace(/\b(date ?time|datetime|timestamp|dttm|date|time|at|ts|dt)$/i,'').trim()||s;
  return s.charAt(0).toUpperCase()+s.slice(1).toLowerCase(); }
function suggestConfig(table,profile){
  profile=profile||profileColumns(table);
  const columns={}; let idTaken=false;
  for(const p of profile){ let role=p.role; if(role==='id'){ if(idTaken) role='attribute'; idTaken=true; }
    if(role==='attribute'&&p.distinct>=0.9*p.n&&p.n>50) role='ignore';
    columns[p.col]={role,label:humanise(p.col)};
    if(role==='attribute'){ columns[p.col].type=p.type; columns[p.col].risk=false; } }
  const steps=profile.filter(p=>columns[p.col].role==='step');
  // happy flow guess: column order, dropping steps recorded in fewer than half the rows (likely optional)
  const happy=steps.filter(p=>p.fill>=0.5).map(p=>p.col);
  return normaliseConfig({schema:CONFIG_SCHEMA,name:'Process',terms:{case:'case',cases:'cases'},columns,
    stepOrder:steps.map(p=>p.col),happyFlow:happy.length>=2?happy:steps.map(p=>p.col),rules:[],settings:{weekend:[6,0],basis:'start'}});
}
function normaliseConfig(c){
  c=JSON.parse(JSON.stringify(c||{}));
  c.schema=CONFIG_SCHEMA; c.name=c.name||'Process';
  c.terms=Object.assign({case:'case',cases:'cases'},c.terms||{});
  c.columns=c.columns||{};
  for(const [k,v] of Object.entries(c.columns)){ if(!ROLES.includes(v.role)) v.role='ignore'; v.label=v.label||humanise(k);
    if(v.role==='attribute'){ v.type=v.type==='num'?'num':'cat'; v.risk=!!v.risk; } }
  const stepCols=Object.keys(c.columns).filter(k=>c.columns[k].role==='step');
  c.stepOrder=(c.stepOrder||[]).filter(k=>stepCols.includes(k)); for(const k of stepCols) if(!c.stepOrder.includes(k)) c.stepOrder.push(k);
  c.happyFlow=(c.happyFlow||[]).filter(k=>stepCols.includes(k));
  c.rules=(Array.isArray(c.rules)?c.rules:[]).filter(r=>r&&typeof r==='object').map((r,i)=>{ const x={id:String(r.id||'r'+(i+1)),type:r.type,a:r.a};
    if(r.label) x.label=String(r.label);
    if(r.type==='within'||r.type==='order') x.b=r.b;
    if(r.type==='within'){ x.max=+r.max; if(r.countMissing) x.countMissing=true; }
    if(r.type==='clock'){ x.time=String(r.time||''); x.anchor=r.anchor==='start'?'start':'own'; x.dayOffset=Math.max(0,Math.round(+r.dayOffset||0)); }
    return x; });
  { const seen=new Set(); c.rules.forEach((r,i)=>{ while(seen.has(r.id)) r.id=r.id+'_'+i; seen.add(r.id); }); }
  c.settings=Object.assign({weekend:[6,0],basis:'start'},c.settings||{});
  return c;
}
// Problems that stop the analysis (errors) or that the user should know about (warnings).
function validateConfig(c,header){
  const errors=[], warnings=[], H=new Set(header||[]);
  const missing=Object.keys(c.columns).filter(k=>c.columns[k].role!=='ignore'&&header&&!H.has(k));
  if(missing.length) errors.push(`These columns are in the configuration but not in the file: ${missing.join(', ')}.`);
  if(c.happyFlow.length<2) errors.push('The happy flow needs at least two steps: the first starts the clock and the last ends the case.');
  if(new Set(c.happyFlow).size!==c.happyFlow.length) errors.push('A step appears twice in the happy flow.');
  const ids=Object.keys(c.columns).filter(k=>c.columns[k].role==='id'); if(ids.length>1) errors.push('Only one column can be the case ID.');
  const dues=Object.keys(c.columns).filter(k=>c.columns[k].role==='due'); if(dues.length>1) errors.push('Only one column can be the due date.');
  (c.rules||[]).forEach((r,i)=>{ const P=ruleProblems(r,c); if(P.length) warnings.push(`Rule ${i+1} (${ruleLabel(r,c)}) is ignored: ${P.join(' ')}`); });
  if(!ids.length) warnings.push('No case ID column: cases will be numbered by row, and the lookup searches row numbers.');
  const pii=Object.keys(c.columns).filter(k=>c.columns[k].role!=='ignore'&&isPiiHeader(k));
  if(pii.length) warnings.push(`These columns look like personal data and are in use: ${pii.join(', ')}. Everything stays in this browser, but slides and downloads will carry them if shown.`);
  return {errors,warnings,ok:!errors.length};
}

// Share of rows with a readable time, and the median position of each step column relative to the
// earliest step time in the same row. Used by the wizard to suggest a step order.
function stepStats(table,cols){
  const H=table.header, idx=cols.map(c=>H.indexOf(c)), dfi=detectDayFirst(table.data.flatMap(r=>idx.map(i=>r[i])));
  const off=cols.map(()=>[]), fill=cols.map(()=>0);
  for(const r of table.data){ const t=idx.map(i=>toDate(r[i],dfi.dayFirst)); const ok=t.filter(Boolean); if(!ok.length) continue;
    const m0=Math.min(...ok.map(d=>+d)); t.forEach((d,j)=>{ if(d){ fill[j]++; off[j].push((d-m0)/6e4); } }); }
  const n=table.data.length||1;
  return Object.fromEntries(cols.map((c,j)=>[c,{fill:fill[j]/n,med:dist(off[j]).med}]));
}
function typicalOrder(table,cols){ const st=stepStats(table,cols); return cols.slice().sort((a,b)=>(st[a].med??Infinity)-(st[b].med??Infinity)); }
// Carry an imported configuration over to a file: columns the file does not have are dropped and reported.
function mergeConfig(imported,table,profile){
  const base=suggestConfig(table,profile), imp=normaliseConfig(imported), H=new Set(table.header);
  const dropped=Object.keys(imp.columns).filter(k=>!H.has(k)&&imp.columns[k].role!=='ignore');
  for(const k of table.header) if(imp.columns[k]) base.columns[k]=imp.columns[k];
  base.name=imp.name; base.terms=imp.terms; base.settings=imp.settings;
  const ok=k=>H.has(k)&&base.columns[k]&&base.columns[k].role==='step';
  base.stepOrder=imp.stepOrder.filter(ok).concat(base.stepOrder.filter(k=>!imp.stepOrder.includes(k)));
  base.happyFlow=imp.happyFlow.filter(ok);
  base.rules=imp.rules.filter(r=>[r.a,r.b].filter(Boolean).every(ok));
  return {cfg:normaliseConfig(base),dropped,rulesDropped:imp.rules.length-base.rules.length};
}

/* =====================================================================
   Schema: the internal view of a configuration
   ===================================================================== */
let SCH=null;
function shortLabel(l){ if(l.length<=18) return l; const w=l.split(' '); let s=w[0]; for(const x of w.slice(1)){ if((s+' '+x).length>18) break; s+=' '+x; } return s; }
function setSchema(cfg){
  cfg=normaliseConfig(cfg); const C=cfg.columns;
  const order=cfg.happyFlow.concat(cfg.stepOrder.filter(k=>!cfg.happyFlow.includes(k)));
  const steps=order.map((col,i)=>({k:'s'+i,col,l:C[col].label,s:shortLabel(C[col].label),happy:cfg.happyFlow.includes(col)}));
  const byCol=Object.fromEntries(steps.map(s=>[s.col,s.k]));
  const S={cfg,steps,byCol,happy:cfg.happyFlow.map(c=>byCol[c]),
    start:byCol[cfg.happyFlow[0]],end:byCol[cfg.happyFlow[cfg.happyFlow.length-1]],
    idCol:Object.keys(C).find(k=>C[k].role==='id')||null,dueCol:Object.keys(C).find(k=>C[k].role==='due')||null,
    attrs:Object.keys(C).filter(k=>C[k].role==='attribute').map(k=>({col:k,l:C[k].label,type:C[k].type,risk:!!C[k].risk})),
    reasons:Object.keys(C).filter(k=>C[k].role==='reason').map((k,i)=>({k:'r'+i,col:k,l:C[k].label})),
    terms:cfg.terms,name:cfg.name};
  S.idx=Object.fromEntries(steps.map((s,i)=>[s.k,i]));
  S.lab=Object.fromEntries(steps.map(s=>[s.k,s.l])); S.lab.S='Start'; S.lab.E='End';
  S.short=Object.fromEntries(steps.map(s=>[s.k,s.s]));
  S.durLabel=`${S.short[S.start]} → ${S.short[S.end]}`;
  SCH=S; return S;
}
const EVL=k=>SCH.lab[k]||k;
const shortL=k=>SCH.short[k]||k;

/* =====================================================================
   Records: one per row (case)
   ===================================================================== */
function numBands(vals){ const s=vals.filter(v=>v!=null).sort((a,b)=>a-b); if(s.length<8) return null;
  const q=[quant(s,.25),quant(s,.5),quant(s,.75)], fmt=v=>Math.abs(v)>=100||Number.isInteger(v)?String(Math.round(v)):v.toFixed(1);
  const cuts=[...new Set(q)]; const edges=[s[0],...cuts,s[s.length-1]];
  return {cuts,label:v=>{ if(v==null) return 'Not recorded'; let i=cuts.findIndex(c=>v<=c); if(i<0) i=cuts.length; return `${String.fromCharCode(65+i)}: ${fmt(i?edges[i]:edges[0])}${i?'+':''} to ${fmt(edges[i+1])}`; }}; }
function buildRecords(table,cfg){
  const S=setSchema(cfg), H=table.header, ci=c=>H.indexOf(c);
  const v=validateConfig(S.cfg,H); if(!v.ok) throw new Error(v.errors.join(' '));
  const stepIdx=S.steps.map(s=>ci(s.col)), dueI=S.dueCol?ci(S.dueCol):-1, idI=S.idCol?ci(S.idCol):-1;
  const dateVals=[]; for(const r of table.data){ for(const i of stepIdx) dateVals.push(r[i]); if(dueI>=0) dateVals.push(r[dueI]); }
  const dfi=detectDayFirst(dateVals);
  const meta={sheet:table.sheet,headerRow:table.headerRow,rows:0,noEnd:0,noStart:0,negDur:0,dupId:0,bad:{},diag:{},dfi,warnings:v.warnings,bands:{}};
  for(const s of S.steps) meta.diag[s.k]={col:s.col,non:0,ok:0,badEx:null};
  const seen=new Set(), recs=[];
  table.data.forEach((row,ri)=>{
    meta.rows++;
    const r={row:ri+table.headerRow+1,id:idI>=0?str(row[idI]):String(ri+1),t:{},attr:{},num:{},reason:{}};
    S.steps.forEach((s,j)=>{ const raw=row[stepIdx[j]], D=meta.diag[s.k];
      if(nonEmpty(raw)){ D.non++; const d=toDate(raw,dfi.dayFirst); if(d){ D.ok++; r.t[s.k]=d; } else { if(!D.badEx) D.badEx=String(raw).slice(0,40); (meta.bad[s.k]=meta.bad[s.k]||{n:0,sample:String(raw).slice(0,40)}).n++; } } });
    if(!r.t[S.end]){ meta.noEnd++; return; }
    for(const a of S.attrs){ const x=row[ci(a.col)];
      if(a.type==='num'){ const n=looksNum(x)?parseFloat(String(x).replace(',','.')):null; r.num[a.col]=n; } else r.attr[a.col]=str(x)||'Not recorded'; }
    for(const q of S.reasons){ r.reason[q.k]=str(row[ci(q.col)])||null; }
    if(dueI>=0){ r.due=toDate(row[dueI],dfi.dayFirst); }
    if(r.id&&idI>=0){ if(seen.has(r.id)) meta.dupId++; seen.add(r.id); }
    r.t0=r.t[S.start]||null; r.t1=r.t[S.end];
    if(!r.t0) meta.noStart++;
    r.dur=mins(r.t1,r.t0); if(r.dur!=null&&r.dur<0) meta.negDur++;
    r.off={}; r.toEnd={}; for(const s of S.steps){ r.off[s.k]=mins(r.t[s.k],r.t0); r.toEnd[s.k]=mins(r.t1,r.t[s.k]); }
    r.byDue=r.due?(dayKey(r.t1)<=dayKey(r.due)):null;
    r.dueDelta=r.due?Math.round((dayKey(r.t1)-dayKey(r.due))/864e5):null;
    r.month=`${r.t1.getUTCFullYear()}-${p2(r.t1.getUTCMonth()+1)}`;
    r.anyReason=S.reasons.some(q=>r.reason[q.k]);
    recs.push(r);
  });
  if(!recs.length) throw new Error(`No rows have a readable time in the end step ("${S.lab[S.end]}"), so no case can be built.`);
  // numeric attributes are compared in quartile bands
  for(const a of S.attrs.filter(a=>a.type==='num')){ const b=numBands(recs.map(r=>r.num[a.col])); meta.bands[a.col]=b;
    for(const r of recs) r.attr[a.col]=b?b.label(r.num[a.col]):(r.num[a.col]==null?'Not recorded':String(r.num[a.col])); }
  return {recs,meta,schema:S};
}

/* settings-dependent fields */
function prepare(R,opt){
  const S=SCH, wk=opt.weekend||[6,0];
  for(const r of R){
    const end=r.t1;
    r.ev=S.steps.map((s,i)=>({k:s.k,t:r.t[s.k],i})).filter(x=>x.t&&(opt.post||x.k===S.end||x.t<=end)).sort((a,b)=>a.t-b.t||a.i-b.i);
    r.trace=r.ev.map(x=>x.k); r.vtrace=opt.vmode==='set'?r.trace.slice().sort((a,b)=>S.idx[a]-S.idx[b]):r.trace; r.vkey=(opt.vmode==='set'?'set:':'')+r.vtrace.join('>');
    const bd=opt.basis==='end'?end:r.t0;
    r.dow=bd?bd.getUTCDay():null; r.hour=bd?bd.getUTCHours():null;
    r.dayType=r.dow==null?'Unknown':(wk.includes(r.dow)?'Weekend':'Weekday');
    r.dowL=r.dow==null?'Unknown':DAYS[r.dow];
    const pre=r.ev.filter(x=>x.k!==S.end&&x.t<=end); r.last=pre.length?pre[pre.length-1].k:null;
    r.lastWait=r.last?mins(end,r.t[r.last]):null;
  }
}
function keyOf(trace,vmode){ const S=SCH; return (vmode==='set'?'set:':'')+(vmode==='set'?trace.slice().sort((a,b)=>S.idx[a]-S.idx[b]):trace).join('>'); }

/* =====================================================================
   Process model: directly-follows graph and sequences (variants)
   ===================================================================== */
function buildModel(R){
  const nodes={S:{n:R.length},E:{n:R.length}}, edges=new Map(), vars=new Map();
  for(const r of R){
    for(const e of r.ev){ (nodes[e.k]=nodes[e.k]||{n:0}).n++; }
    const seq=[{k:'S'}].concat(r.ev,[{k:'E'}]);
    for(let i=0;i<seq.length-1;i++){ const a=seq[i],b=seq[i+1],key=a.k+'>'+b.k;
      let E=edges.get(key); if(!E){ E={key,a:a.k,b:b.k,n:0,d:[],recs:[]}; edges.set(key,E); }
      E.n++; E.recs.push(r); if(a.t&&b.t) E.d.push((b.t-a.t)/6e4); }
    let v=vars.get(r.vkey); if(!v){ v={key:r.vkey,trace:r.vtrace,n:0,recs:[],dur:[]}; vars.set(r.vkey,v); }
    v.n++; v.recs.push(r); if(r.dur!=null) v.dur.push(r.dur);
  }
  for(const E of edges.values()) E.st=dist(E.d);
  const variants=[...vars.values()].sort((a,b)=>b.n-a.n||a.key.localeCompare(b.key)); variants.forEach(v=>v.st=dist(v.dur));
  const pos={}; for(const r of R){ const L=r.ev.length; r.ev.forEach((e,i)=>{ (pos[e.k]=pos[e.k]||[]).push(L>1?i/(L-1):0); }); }
  const rank={}; for(const k in pos) rank[k]=dist(pos[k]).med;
  return {total:R.length,nodes,edges,variants,rank};
}
function layoutOrder(model,ref){
  const present=SCH.steps.map(e=>e.k).filter(k=>model.nodes[k]&&model.nodes[k].n>0);
  const order=ref.filter(k=>present.includes(k));
  const rest=present.filter(k=>!order.includes(k)).sort((a,b)=>(model.rank[a]||0)-(model.rank[b]||0));
  for(const k of rest){ const rk=model.rank[k]||0; let j=order.findIndex(x=>(model.rank[x]||0)>rk); if(j<0) j=order.length; order.splice(j,0,k); }
  return order;
}
function refEdges(ref){ const s=new Set(); const seq=['S'].concat(ref,['E']); for(let i=0;i<seq.length-1;i++) s.add(seq[i]+'>'+seq[i+1]); return s; }
function lcs(a,b){ const m=a.length,n=b.length,T=Array.from({length:m+1},()=>new Array(n+1).fill(0));
  for(let i=m-1;i>=0;i--) for(let j=n-1;j>=0;j--) T[i][j]=a[i]===b[j]?T[i+1][j+1]+1:Math.max(T[i+1][j],T[i][j+1]);
  const out=new Set(); let i=0,j=0; while(i<m&&j<n){ if(a[i]===b[j]){ out.add(a[i]); i++; j++; } else if(T[i+1][j]>=T[i][j+1]) i++; else j++; } return out; }
// How a recorded sequence differs from the reference: missing steps, extra steps, steps out of order.
function deviations(trace,ref,mode){
  const out=[]; const tset=new Set(trace), rset=new Set(ref);
  for(const k of ref) if(!tset.has(k)) out.push({t:'miss',k,l:shortL(k)+' missing'});
  for(const k of trace) if(!rset.has(k)) out.push({t:'extra',k,l:shortL(k)+' added'});
  if(mode==='set') return out;
  const ct=trace.filter(k=>rset.has(k)), cr=ref.filter(k=>tset.has(k)), keep=lcs(ct,cr);
  for(const k of ct){ if(keep.has(k)) continue; const it=ct.indexOf(k), ir=cr.indexOf(k);
    out.push({t:'order',k,l:shortL(k)+(it<ir?' earlier':' later')}); }
  return out;
}

/* =====================================================================
   Statistics
   ===================================================================== */
function stats(R,refKey){
  const dur=dist(R.map(r=>r.dur)); const n=R.length;
  const due=R.filter(r=>r.byDue!=null);
  const ms={}; for(const e of SCH.steps){ if(e.k===SCH.start) continue; ms[e.k]=dist(R.map(r=>r.off[e.k])); }
  return { n, dur,
    due:due.length?due.filter(r=>r.byDue).length/due.length:null, dueN:due.length,
    conf:n&&refKey!=null?R.filter(r=>r.vkey===refKey).length/n:null,
    reason:n?R.filter(r=>r.anyReason).length/n:null, ms };
}
function milestoneTiming(R){
  const S=SCH;
  return S.steps.filter(e=>e.k!==S.start).map(e=>{
    const withT=R.filter(r=>r.t[e.k]), both=withT.filter(r=>r.t0);
    const d=dist(both.map(r=>r.off[e.k]));
    return { k:e.k, l:e.l, rec:withT.length, recP:R.length?withT.length/R.length:null, d,
      before:both.length?both.filter(r=>r.off[e.k]<0).length/both.length:null,
      after:e.k===S.end?null:(withT.length?withT.filter(r=>r.t[e.k]>r.t1).length/withT.length:null),
      toEnd:e.k===S.end?null:dist(withT.map(r=>r.toEnd[e.k]).filter(x=>x>=0)) };
  });
}
function lastMilestone(R){
  const m=new Map(); for(const r of R){ const k=r.last||'none'; let x=m.get(k); if(!x){ x={k,n:0,w:[]}; m.set(k,x); } x.n++; if(r.lastWait!=null) x.w.push(r.lastWait); }
  return [...m.values()].map(x=>({...x,p:R.length?x.n/R.length:0,st:dist(x.w)})).sort((a,b)=>b.n-a.n);
}
function reasonTables(R){
  return SCH.reasons.map(({k,l})=>{ const m=new Map(); let any=0;
    for(const r of R){ const v=r.reason[k]; if(!v) continue; any++; let x=m.get(v); if(!x){ x={v,n:0,dur:[],recs:[]}; m.set(v,x); } x.n++; x.recs.push(r); if(r.dur!=null) x.dur.push(r.dur); }
    const rows=[...m.values()].map(x=>({...x,p:R.length?x.n/R.length:0,st:dist(x.dur)})).sort((a,b)=>b.n-a.n);
    const none=dist(R.filter(r=>!r.reason[k]).map(r=>r.dur));
    return {k,l,any,anyP:R.length?any/R.length:0,rows,none}; });
}
function groupBy(R,fn){ const m=new Map(); for(const r of R){ const v=fn(r); const key=v==null||v===''?'Not recorded':String(v); let g=m.get(key); if(!g){ g=[]; m.set(key,g); } g.push(r); } return m; }
function topReason(R){ const m=new Map(); for(const r of R) for(const {k,l} of SCH.reasons){ const v=r.reason[k]; if(!v) continue; const key=l+'|'+v; m.set(key,(m.get(key)||0)+1); }
  let best=null; for(const [k,n] of m) if(!best||n>best.n) best={cat:k.split('|')[0],v:k.split('|').slice(1).join('|'),n}; return best; }
function breakdown(R,fn,refKey,extra){
  return [...groupBy(R,fn).entries()].map(([key,g])=>{ const x={key,n:g.length,recs:g,st:stats(g,refKey),top:topReason(g)}; if(extra) extra(x,g); return x; });
}
function heatData(R,metric,basis,refKey){
  const cells={}; for(const r of R){ const d=basis==='end'?r.t1:r.t0; if(!d) continue; const k=d.getUTCDay()+'_'+d.getUTCHours(); (cells[k]=cells[k]||[]).push(r); }
  const out={}; let max=0,min=Infinity;
  for(const k in cells){ const g=cells[k]; let v, nv=g.length;
    if(metric==='n') v=g.length; else if(metric==='dur'){ const d=dist(g.map(r=>r.dur)); v=d.med; nv=d.n; } else v=g.filter(r=>r.vkey===refKey).length/g.length;
    out[k]={n:g.length,nv,v}; if(v!=null&&(metric==='n'||nv>=3)){ max=Math.max(max,v); min=Math.min(min,v); } }
  return {cells:out,max,min:min===Infinity?0:min,metric};
}

/* =====================================================================
   SVG renderers (inline attributes only, so the same markup rasterises for slides)
   ===================================================================== */
function wrap(t,max){ const w=t.split(' '), out=[]; let cur=''; for(const x of w){ if((cur+' '+x).trim().length>max&&cur){ out.push(cur); cur=x; } else cur=(cur+' '+x).trim(); } if(cur) out.push(cur); return out.slice(0,2); }
function svgOpen(W,H){ return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}"><rect width="${W}" height="${H}" fill="#FFFFFF"/>`; }
function emptySvg(msg,w){ w=w||600; return {svg:svgOpen(w,70)+`<text x="16" y="40" font-size="13" fill="${PAL.ink}">${xmlEsc(msg)}</text></svg>`,w,h:70}; }
function edgeLabel(e,metric,total){
  if(metric==='freq') return `${pctS(e.n/total)} (${e.n.toLocaleString()})`;
  if(!e.st||!e.st.n) return '';
  return fmtMin(metric==='mean'?e.st.mean:e.st.med);
}
function slowEdges(model){
  const minN=Math.max(5,Math.ceil(model.total*0.02));
  return new Set([...model.edges.values()].filter(e=>e.a!=='S'&&e.b!=='E'&&e.a!==SCH.end&&e.st.n>=minN&&e.st.med!=null).sort((a,b)=>b.st.med-a.st.med).slice(0,3).map(e=>e.key));
}
const EDGE_COL={happy:PAL.ink,neutral:PAL.ink2,fwdskip:SEM.skip,back:SEM.alert};
function markerDefs(){ return '<defs>'+Object.values(EDGE_COL).map(c=>`<marker id="m${c.slice(1)}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`).join('')+'</defs>'; }
function edgeTip(e,total,slow){ const st=e.st, T=SCH.terms;
  return `${EVL(e.a)} → ${EVL(e.b)}\n${e.n.toLocaleString()} ${T.cases} (${pctS(e.n/total)} of the ${total.toLocaleString()} shown)`+
    (st&&st.n?`\nTime between: median ${fmtMin(st.med)}, mean ${fmtMin(st.mean)}, P75 ${fmtMin(st.p75)}, P90 ${fmtMin(st.p90)}`:'')+(slow.has(e.key)?'\nOne of the three slowest transitions (median)':''); }
function nodeTip(k,n,total,tim,inRef){ const T=SCH.terms;
  return `${EVL(k)}\n${n.toLocaleString()} ${T.cases} (${pctS(n/total)})`+(tim&&k!==SCH.start?`\nFrom ${EVL(SCH.start)}: median ${fmtMin(tim.d.med)} (n=${tim.d.n})`+(tim.after!=null?`\nRecorded after the end step: ${pctS(tim.after)}`:''):'')+(inRef?'\nPart of the reference flow':'\nNot in the reference flow'); }
function labelPills(labels){ let s='';
  for(const l of labels){ const tw=l.txt.length*5.6+10;
    s+=`<g opacity="${l.op}" pointer-events="none"><rect x="${(l.x-tw/2).toFixed(1)}" y="${(l.y-8.5).toFixed(1)}" width="${tw.toFixed(1)}" height="17" fill="${l.fill}" stroke="${l.col}" stroke-width="0.8"/>`+
      `<text x="${l.x.toFixed(1)}" y="${(l.y+3.5).toFixed(1)}" text-anchor="middle" font-size="9.8" fill="${l.col}" font-weight="${l.bold?700:500}">${xmlEsc(l.txt)}</text></g>`; }
  return s; }
function edgePath(g,d,col,w,op,interactive,tip){
  return `<g${interactive?` data-edge="${g.e.key}" style="cursor:pointer"`:''} opacity="${op}"><title>${xmlEsc(tip)}</title>`+
    `<path d="${d}" fill="none" stroke="#FFFFFF" stroke-opacity="0" stroke-width="${Math.max(14,+w+8)}"/>`+
    `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="square" marker-end="url(#m${col.slice(1)})"/></g>`; }

/* horizontal process map (slides) */
const NW=100,NH=58,GAP=64,PW=46,PH=26;
function renderMapSvgH(model,o){
  const total=model.total; if(!total) return emptySvg(`No ${SCH.terms.cases} match the current filters.`);
  const order=o.order, seq=['S'].concat(order,['E']), idx={}; seq.forEach((k,i)=>idx[k]=i);
  const RE=refEdges(o.ref), metric=o.metric||'freq', slow=metric==='freq'?new Set():(o.slow||new Set());
  const edges=[...model.edges.values()].filter(e=>idx[e.a]!=null&&idx[e.b]!=null&&(e.n/total*100>=(o.minPct||0)||RE.has(e.key)));
  let x=16; const P={}; for(const k of seq){ const w=(k==='S'||k==='E')?PW:NW; P[k]={x,w,h:(k==='S'||k==='E')?PH:NH}; x+=w+GAP; }
  const W=x-GAP+16;
  const geo=edges.map(e=>{ const ia=idx[e.a],ib=idx[e.b], span=Math.abs(ib-ia);
    const t=ib===ia+1?'fwd':(ib>ia?'up':'down'); return {e,t,span,h:t==='fwd'?0:(t==='up'?30+(span-2)*20:30+(span-1)*20)}; });
  const maxUp=Math.max(0,...geo.filter(g=>g.t==='up').map(g=>g.h)), maxDn=Math.max(0,...geo.filter(g=>g.t==='down').map(g=>g.h));
  const TOP=16+(maxUp?maxUp+16:10), YC=TOP+NH/2, H=Math.round(YC+NH/2+(maxDn?maxDn+18:10)+12);
  const maxN=Math.max(1,...edges.map(e=>e.n));
  let s=svgOpen(W,H)+markerDefs();
  s+=`<rect x="6" y="${YC-NH/2-10}" width="${W-12}" height="${NH+20}" fill="${PAL.t6}"/>`;
  const labels=[];
  geo.sort((a,b)=>a.e.n-b.e.n);
  for(const g of geo){ const e=g.e, A=P[e.a], B=P[e.b], happy=RE.has(e.key);
    const col=happy?EDGE_COL.happy:g.t==='fwd'?EDGE_COL.neutral:g.t==='up'?EDGE_COL.fwdskip:EDGE_COL.back;
    const w=(1.2+7*Math.sqrt(e.n/maxN)).toFixed(1), op=happy?0.92:0.8;
    const sp=Math.min(g.span,6)*0.04; let d,lx,ly;
    if(g.t==='fwd'){ const sx=A.x+A.w, ex=B.x-2; d=`M${sx},${YC} L${ex},${YC}`; lx=(sx+ex)/2; ly=YC; }
    else if(g.t==='up'){ const sx=A.x+A.w*(0.55+sp), ex=B.x+B.w*(0.45-sp), ya=YC-A.h/2, yb=YC-B.h/2-2, c=g.h*1.33;
      d=`M${sx},${ya} C${sx},${ya-c} ${ex},${yb-c} ${ex},${yb}`; lx=(sx+ex)/2; ly=Math.min(ya,yb)-g.h; }
    else { const sx=A.x+A.w*(0.45-sp), ex=B.x+B.w*(0.55+sp), ya=YC+A.h/2, yb=YC+B.h/2+2, c=g.h*1.33;
      d=`M${sx},${ya} C${sx},${ya+c} ${ex},${yb+c} ${ex},${yb}`; lx=(sx+ex)/2; ly=Math.max(ya,yb)+g.h; }
    s+=edgePath(g,d,col,w,op,false,edgeTip(e,total,slow));
    const txt=edgeLabel(e,metric,total); if(txt) labels.push({x:lx,y:ly,txt,col:slow.has(e.key)?SEM.alert:col,op:1,bold:happy||slow.has(e.key),fill:slow.has(e.key)?SEM.alertWash:'#FFFFFF'});
  }
  s+=labelPills(labels);
  const refSet=new Set(o.ref);
  for(const k of seq){ const p=P[k], y=YC-p.h/2, n=model.nodes[k]?model.nodes[k].n:0;
    if(k==='S'||k==='E'){ s+=`<rect x="${p.x}" y="${y}" width="${p.w}" height="${p.h}" fill="#FFFFFF" stroke="${PAL.ink2}" stroke-width="1.2"/><text x="${p.x+p.w/2}" y="${y+17}" text-anchor="middle" font-size="10" font-weight="500" letter-spacing="1" fill="${PAL.ink2}">${k==='S'?'START':'END'}</text>`; continue; }
    const inRef=refSet.has(k), fill=inRef?PAL.ink:'#FFFFFF', tc=inRef?PAL.cream:PAL.ink, lines=wrap(EVL(k),14);
    s+=`<g><title>${xmlEsc(nodeTip(k,n,total,o.timing&&o.timing[k],inRef))}</title><rect x="${p.x}" y="${y}" width="${p.w}" height="${p.h}" fill="${fill}" stroke="${inRef?PAL.ink:PAL.ink2}" stroke-width="${inRef?0:1.3}"/>`+
      lines.map((t,i)=>`<text x="${p.x+p.w/2}" y="${y+(lines.length===1?24:17)+i*14}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${tc}">${xmlEsc(t)}</text>`).join('')+
      `<text x="${p.x+p.w/2}" y="${y+48}" text-anchor="middle" font-size="10.5" fill="${tc}" opacity="0.85">${n.toLocaleString()} · ${pctS(n/total)}</text></g>`; }
  return {svg:s+'</svg>',w:W,h:H};
}

/* vertical process map: reference flow top to bottom, skips on the right, earlier-than-reference on the left */
const VNW=178,VNH=36,VGAP=27,VPW=74,VPH=20;
function renderMapSvg(model,o){
  const total=model.total; if(!total) return emptySvg(`No ${SCH.terms.cases} match the current filters.`);
  const order=o.order, seq=['S'].concat(order,['E']), idx={}; seq.forEach((k,i)=>idx[k]=i);
  const RE=refEdges(o.ref), metric=o.metric||'freq', slow=metric==='freq'?new Set():(o.slow||new Set());
  const edges=[...model.edges.values()].filter(e=>idx[e.a]!=null&&idx[e.b]!=null&&(e.n/total*100>=(o.minPct||0)||RE.has(e.key)||(o.hl&&o.hl.edges.has(e.key))));
  const geo=edges.map(e=>{ const ia=idx[e.a],ib=idx[e.b], span=Math.abs(ib-ia);
    const t=ib===ia+1?'fwd':(ib>ia?'right':'left'); return {e,t,span,d:t==='fwd'?0:(t==='right'?36+(span-2)*30:36+(span-1)*30),txt:edgeLabel(e,metric,total)}; });
  const lw=g=>g.txt?g.txt.length*5.6+10:0;
  const maxR=Math.max(0,...geo.filter(g=>g.t==='right').map(g=>g.d+lw(g)/2)), maxL=Math.max(0,...geo.filter(g=>g.t==='left').map(g=>g.d+lw(g)/2));
  const CX=16+maxL+VNW/2+8, W=Math.round(CX+VNW/2+maxR+24);
  let y=16; const P={}; for(const k of seq){ const se=k==='S'||k==='E', w=se?VPW:VNW, h=se?VPH:VNH; P[k]={x:CX-w/2,y,w,h}; y+=h+VGAP; }
  const H=Math.round(y-VGAP+16);
  const hl=o.hl, dimN=k=>hl&&!hl.nodes.has(k), dimE=k=>hl&&!hl.edges.has(k);
  const maxN=Math.max(1,...edges.map(e=>e.n));
  let s=svgOpen(W,H)+markerDefs();
  s+=`<rect x="${CX-VNW/2-10}" y="6" width="${VNW+20}" height="${H-12}" fill="${PAL.t6}"/>`;
  const labels=[];
  geo.sort((a,b)=>(dimE(a.e.key)?0:1)-(dimE(b.e.key)?0:1)||a.e.n-b.e.n);
  for(const g of geo){ const e=g.e, A=P[e.a], B=P[e.b], happy=RE.has(e.key);
    const col=happy?EDGE_COL.happy:g.t==='fwd'?EDGE_COL.neutral:g.t==='right'?EDGE_COL.fwdskip:EDGE_COL.back;
    const w=(1.2+7*Math.sqrt(e.n/maxN)).toFixed(1), op=dimE(e.key)?0.08:(happy?0.92:0.8);
    const sp=Math.min(g.span,6)*0.05; let d,lx,ly;
    if(g.t==='fwd'){ const sy=A.y+A.h, ey=B.y-2; d=`M${CX},${sy} L${CX},${ey}`; lx=CX; ly=(sy+ey)/2; }
    else if(g.t==='right'){ const xa=A.x+A.w, xb=B.x+B.w+2, ya=A.y+A.h*(0.6+sp), yb=B.y+B.h*(0.4-sp), c=g.d*1.33;
      d=`M${xa},${ya} C${xa+c},${ya} ${xb+c},${yb} ${xb},${yb}`; lx=Math.max(xa,xb)+g.d; ly=(ya+yb)/2; }
    else { const xa=A.x, xb=B.x-2, ya=A.y+A.h*(0.4-sp), yb=B.y+B.h*(0.6+sp), c=g.d*1.33;
      d=`M${xa},${ya} C${xa-c},${ya} ${xb-c},${yb} ${xb},${yb}`; lx=Math.min(xa,xb)-g.d; ly=(ya+yb)/2; }
    s+=edgePath(g,d,col,w,op,o.interactive,edgeTip(e,total,slow));
    if(g.txt) labels.push({x:lx,y:ly,txt:g.txt,col:slow.has(e.key)?SEM.alert:col,op:dimE(e.key)?0.15:1,bold:happy||slow.has(e.key),fill:slow.has(e.key)?SEM.alertWash:'#FFFFFF'});
  }
  s+=labelPills(labels);
  const refSet=new Set(o.ref);
  for(const k of seq){ const p=P[k], n=model.nodes[k]?model.nodes[k].n:0;
    if(k==='S'||k==='E'){ s+=`<g opacity="${dimN(k)?0.3:1}"><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="#FFFFFF" stroke="${PAL.ink2}" stroke-width="1.2"/><text x="${CX}" y="${p.y+14}" text-anchor="middle" font-size="9.5" font-weight="500" letter-spacing="1.2" fill="${PAL.ink2}">${k==='S'?'START':'END'}</text></g>`; continue; }
    const inRef=refSet.has(k), fill=inRef?PAL.ink:'#FFFFFF', tc=inRef?PAL.cream:PAL.ink, lab=EVL(k);
    s+=`<g${o.interactive?` data-node="${k}" style="cursor:pointer"`:''} opacity="${dimN(k)?0.25:1}"><title>${xmlEsc(nodeTip(k,n,total,o.timing&&o.timing[k],inRef))}</title>`+
      `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${fill}" stroke="${inRef?PAL.ink:PAL.ink2}" stroke-width="${inRef?0:1.3}"/>`+
      `<text x="${CX}" y="${p.y+15}" text-anchor="middle" font-size="12" font-weight="600" fill="${tc}">${xmlEsc(lab.length>26?lab.slice(0,25)+'…':lab)}</text>`+
      `<text x="${CX}" y="${p.y+30}" text-anchor="middle" font-size="10.5" fill="${tc}" opacity="0.85">${n.toLocaleString()} · ${pctS(n/total)}</text></g>`; }
  return {svg:s+'</svg>',w:W,h:H};
}

function niceStep(range,maxT){ for(const c of [5,10,15,30,60,120,180,240,360,720,1440,2880,4320,10080,20160]) if(range/c<=maxT) return c; return 43200; }
function tickLab(m){ if(m===0) return '0'; const a=Math.abs(m); const t=a<60?a+' min':(a<2880?(a/60)+' h':(a/1440)+' d'); return (m<0?'−':'+')+t; }
function renderTimingSvg(T,sel){
  const rows=T.filter(t=>t.d.n>0); if(!rows.length) return emptySvg(`No step has both its own time and a ${shortL(SCH.start)} time.`);
  const W=860,LW=210,RW=110,rowH=30,top=34,H=top+rows.length*rowH+14;
  const endRow=rows.find(r=>r.k===SCH.end), endMed=endRow?endRow.d.med:Infinity;
  let lo=Math.min(0,...rows.map(r=>r.d.p25)), hi=Math.max(30,...rows.filter(r=>r.d.med<=endMed).map(r=>r.d.p90));
  const pad=(hi-lo)*0.03; lo=lo<0?lo-pad:0; hi+=pad; const st=niceStep(hi-lo,8);
  const X=v=>LW+(Math.max(lo,Math.min(hi,v))-lo)/(hi-lo)*(W-LW-RW);
  let s=svgOpen(W,H);
  for(let v=Math.ceil(lo/st)*st;v<=hi+1e-9;v+=st){ s+=`<line x1="${X(v)}" x2="${X(v)}" y1="${top-8}" y2="${H-10}" stroke="${v===0?PAL.teal:PAL.rule}" stroke-width="${v===0?1.5:1}"${v===0?' stroke-dasharray="5 5"':''}/><text x="${X(v)}" y="${top-14}" text-anchor="middle" font-size="10" fill="${v===0?PAL.teal:PAL.ink2}"${v===0?' font-weight="600"':''}>${v===0?xmlEsc(shortL(SCH.start)):tickLab(v)}</text>`; }
  rows.forEach((r,i)=>{ const y=top+i*rowH+rowH/2, d=r.d, end=r.k===SCH.end, col=end?PAL.ink:PAL.ink2, on=sel===r.k;
    if(on) s+=`<rect x="2" y="${y-rowH/2+1}" width="${W-4}" height="${rowH-2}" fill="${PAL.t6}"/>`;
    s+=`<text x="${LW-10}" y="${y+4}" text-anchor="end" font-size="11.5" font-weight="${end?700:600}" fill="${PAL.ink}">${xmlEsc(r.l)}</text>`;
    s+=`<line x1="${X(d.p75)}" x2="${X(d.p90)}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="1.4"/><line x1="${X(d.p90)}" x2="${X(d.p90)}" y1="${y-5}" y2="${y+5}" stroke="${col}" stroke-width="1.4"/>`;
    s+=`<rect x="${X(d.p25)}" y="${y-7}" width="${Math.max(2,X(d.p75)-X(d.p25))}" height="14" fill="${end?PAL.t4:PAL.t6}" stroke="${col}" stroke-width="0.8"/>`;
    s+=`<line x1="${X(d.med)}" x2="${X(d.med)}" y1="${y-9}" y2="${y+9}" stroke="${PAL.teal}" stroke-width="2.4"/>`;
    if(d.p90>hi||d.med>hi) s+=`<path d="M${W-RW-8},${y-6} L${W-RW},${y} L${W-RW-8},${y+6}" fill="none" stroke="${PAL.ink2}" stroke-width="1.6"/><text x="${W-RW-12}" y="${y-9}" text-anchor="end" font-size="9" fill="${PAL.ink2}">beyond scale</text>`;
    s+=`<text x="${W-RW+8}" y="${y+4}" font-size="11" fill="${PAL.ink}" font-weight="600">${fmtMin(d.med)}</text><text x="${W-8}" y="${y+4}" text-anchor="end" font-size="10" fill="${PAL.ink2}">n ${d.n}</text>`;
    s+=`<title>${xmlEsc(`${r.l}: median ${fmtMin(d.med)} from ${shortL(SCH.start)}; middle half ${fmtMin(d.p25)} to ${fmtMin(d.p75)}; P90 ${fmtMin(d.p90)}; n=${d.n}`)}</title>`; });
  return {svg:s+'</svg>',w:W,h:H};
}
function renderLastSvg(L){
  if(!L.length) return emptySvg(`No ${SCH.terms.cases}.`);
  const W=860,LW=210,rowH=28,H=18+L.length*rowH+8, bw=W-LW-330, mx=Math.max(...L.map(x=>x.p));
  let s=svgOpen(W,H);
  L.forEach((x,i)=>{ const y=12+i*rowH+rowH/2, w=Math.max(2,x.p/mx*bw), lab=x.k==='none'?'No step before the end':EVL(x.k);
    s+=`<text x="${LW-10}" y="${y+4}" text-anchor="end" font-size="11.5" font-weight="600" fill="${PAL.ink}">${xmlEsc(lab)}</text><rect x="${LW}" y="${y-8}" width="${w}" height="16" fill="${i===0?PAL.teal:PAL.t4}"/>`+
      `<text x="${LW+w+8}" y="${y+4}" font-size="11" fill="${PAL.ink}"><tspan font-weight="700">${pctS(x.p)}</tspan><tspan fill="${PAL.ink2}"> (${x.n})  ·  then median ${fmtMin(x.st.med)} to the end</tspan></text>`; });
  return {svg:s+'</svg>',w:W,h:H};
}
function renderHourSvg(R){
  const a=new Array(24).fill(0), b=new Array(24).fill(0);
  for(const r of R){ if(r.t0) a[r.t0.getUTCHours()]++; b[r.t1.getUTCHours()]++; }
  const W=860,H=230,L=40,T=30,B=34,cw=(W-L-10)/24, mx=Math.max(1,...a,...b), Y=v=>T+(H-T-B)*(1-v/mx);
  let s=svgOpen(W,H);
  const st=Math.max(1,Math.ceil(mx/5/5)*5); for(let v=0;v<=mx;v+=st) s+=`<line x1="${L}" x2="${W-10}" y1="${Y(v)}" y2="${Y(v)}" stroke="${PAL.rule}"/><text x="${L-6}" y="${Y(v)+3}" text-anchor="end" font-size="9.5" fill="${PAL.ink2}">${v}</text>`;
  for(let h=0;h<24;h++){ const x=L+h*cw;
    s+=`<rect x="${x+cw*0.12}" y="${Y(a[h])}" width="${cw*0.36}" height="${H-B-Y(a[h])}" fill="${PAL.t4}"><title>${p2(h)}:00 ${xmlEsc(EVL(SCH.start))}: ${a[h]}</title></rect>`;
    s+=`<rect x="${x+cw*0.5}" y="${Y(b[h])}" width="${cw*0.36}" height="${H-B-Y(b[h])}" fill="${PAL.teal}"><title>${p2(h)}:00 ${xmlEsc(EVL(SCH.end))}: ${b[h]}</title></rect>`;
    if(h%2===0) s+=`<text x="${x+cw/2}" y="${H-B+14}" text-anchor="middle" font-size="9.5" fill="${PAL.ink2}">${p2(h)}</text>`; }
  s+=`<rect x="${L}" y="8" width="10" height="10" fill="${PAL.t4}"/><text x="${L+14}" y="17" font-size="10.5" fill="${PAL.ink}">${xmlEsc(EVL(SCH.start))}</text><rect x="${L+260}" y="8" width="10" height="10" fill="${PAL.teal}"/><text x="${L+274}" y="17" font-size="10.5" fill="${PAL.ink}">${xmlEsc(EVL(SCH.end))}</text>`;
  s+=`<text x="${W/2}" y="${H-4}" text-anchor="middle" font-size="10" letter-spacing="1" fill="${PAL.ink2}">HOUR OF DAY</text></svg>`; return {svg:s,w:W,h:H};
}
// Counts and happy-flow share use the teal cascade; durations use a slate ramp.
function heatColor(t,metric){ const base=metric==='dur'?[23,36,43]:[0,128,128]; const k=0.1+0.9*t;
  return '#'+base.map(c=>Math.round(255-(255-c)*k).toString(16).padStart(2,'0')).join(''); }
function renderHeatSvg(Hd,basisLabel){
  const cw=31,ch=24,L=46,T=26,W=L+24*cw+10,H=T+7*ch+30, m=Hd.metric, cases=SCH.terms.cases;
  let s=svgOpen(W,H);
  for(let h=0;h<24;h++) s+=`<text x="${L+h*cw+cw/2}" y="${T-8}" text-anchor="middle" font-size="9.5" fill="${PAL.ink2}">${p2(h)}</text>`;
  DAY_ORDER.forEach((d,ri)=>{ const y=T+ri*ch; s+=`<text x="${L-8}" y="${y+ch/2+4}" text-anchor="end" font-size="10.5" fill="${PAL.ink}" font-weight="600">${DAYS[d]}</text>`;
    for(let h=0;h<24;h++){ const c=Hd.cells[d+'_'+h], x=L+h*cw; let fill='#FFFFFF',txt='',tc=PAL.ink,tip=`${DAYS[d]} ${p2(h)}:00: no ${cases}`;
      if(c){ const small=m!=='n'&&(c.nv<3||c.v==null); if(small){ fill=PAL.rule; } else { const t=Hd.max>Hd.min?(c.v-Hd.min)/(Hd.max-Hd.min):1; fill=heatColor(t,m); tc=t>0.55?'#FFFFFF':PAL.ink; }
        txt=m==='n'?String(c.n):small?'':(m==='dur'?(c.v/60).toFixed(1):String(Math.round(c.v*100)));
        tip=`${DAYS[d]} ${p2(h)}:00: ${c.n} ${cases}`+(m==='dur'?`, median ${SCH.durLabel} ${fmtMin(c.v)}`:m==='happy'?`, ${pctS(c.v)} followed the reference flow`:'')+(small?' (fewer than 3 with a value, not coloured)':''); }
      s+=`<g><title>${xmlEsc(tip)}</title><rect x="${x+1}" y="${y+1}" width="${cw-2}" height="${ch-2}" fill="${fill}" stroke="${PAL.rule}" stroke-width="0.6"/>${txt!==''?`<text x="${x+cw/2}" y="${y+ch/2+3.5}" text-anchor="middle" font-size="9" fill="${tc}">${txt}</text>`:''}</g>`; } });
  const unit=m==='n'?cases.charAt(0).toUpperCase()+cases.slice(1):m==='dur'?`Median ${SCH.durLabel}, hours`:'% following the reference flow';
  s+=`<text x="${L}" y="${H-8}" font-size="10" fill="${PAL.ink2}">${xmlEsc(unit+' · by '+basisLabel+' day and hour · grey = fewer than 3 with a value')}</text></svg>`; return {svg:s,w:W,h:H};
}
function renderEncSvg(r,T){
  const S=SCH, med={}; for(const t of T) med[t.k]=t.d.med;
  const base=r.t0||(r.ev[0]&&r.ev[0].t); if(!base) return emptySvg('No step times recorded.');
  const pts=S.steps.map(e=>({e,a:r.t[e.k]?mins(r.t[e.k],base):null,m:(r.t0&&e.k!==S.start&&med[e.k]!=null)?med[e.k]:(e.k===S.start&&r.t0?0:null)}));
  const vals=pts.flatMap(p=>[p.a,p.m]).filter(v=>v!=null); let lo=Math.min(0,...vals), hi=Math.max(30,...vals);
  const pad=(hi-lo)*0.03; lo=lo<0?lo-pad:0; hi+=pad; const st=niceStep(hi-lo,8);
  const W=860,LW=210,RW=150,rowH=26,top=30,H=top+pts.length*rowH+30, X=v=>LW+(v-lo)/(hi-lo)*(W-LW-RW);
  let s=svgOpen(W,H);
  for(let v=Math.ceil(lo/st)*st;v<=hi+1e-9;v+=st) s+=`<line x1="${X(v)}" x2="${X(v)}" y1="${top-8}" y2="${H-26}" stroke="${v===0?PAL.teal:PAL.rule}"${v===0?' stroke-dasharray="5 5"':''}/><text x="${X(v)}" y="${top-14}" text-anchor="middle" font-size="10" fill="${v===0?PAL.teal:PAL.ink2}">${v===0?xmlEsc(r.t0?shortL(S.start):'First step'):tickLab(v)}</text>`;
  const eA=mins(r.t1,base); s+=`<line x1="${X(eA)}" x2="${X(eA)}" y1="${top-4}" y2="${H-26}" stroke="${PAL.ink}" stroke-width="1" stroke-dasharray="2 3"/>`;
  pts.forEach((p,i)=>{ const y=top+i*rowH+rowH/2, isS=p.e.k===S.start;
    s+=`<text x="${LW-10}" y="${y+4}" text-anchor="end" font-size="11.5" font-weight="600" fill="${p.a==null?PAL.ink3:PAL.ink}">${xmlEsc(p.e.l)}</text>`;
    if(p.a!=null&&p.m!=null&&!isS){ const late=p.a>p.m; s+=`<line x1="${X(p.m)}" x2="${X(p.a)}" y1="${y}" y2="${y}" stroke="${late?SEM.alert:PAL.teal}" stroke-width="3" opacity="0.55"/>`; }
    if(p.m!=null&&!isS) s+=`<path d="M${X(p.m)},${y-6} L${X(p.m)+6},${y} L${X(p.m)},${y+6} L${X(p.m)-6},${y} z" fill="#FFFFFF" stroke="${PAL.ink2}" stroke-width="1.4"/>`;
    if(p.a!=null) s+=`<rect x="${X(p.a)-5}" y="${y-5}" width="10" height="10" fill="${p.e.k===S.end?PAL.teal:PAL.ink}"/>`;
    const txt=p.a==null?'not recorded':(isS?fmtDT(r.t0).slice(-5):`${p.a>=0?'+':''}${fmtMin(p.a)}`+(p.m!=null?`  (${p.a-p.m>=0?'+':'−'}${fmtMin(Math.abs(p.a-p.m))} vs median)`:''));
    s+=`<text x="${W-RW+8}" y="${y+4}" font-size="10.5" fill="${p.a==null?PAL.ink3:(p.m!=null&&p.a>p.m&&!isS?SEM.alert:PAL.ink)}">${xmlEsc(txt)}</text>`; });
  const ly=H-10; s+=`<rect x="${LW-5}" y="${ly-9}" width="10" height="10" fill="${PAL.ink}"/><text x="${LW+10}" y="${ly}" font-size="10.5" fill="${PAL.ink}">This ${xmlEsc(S.terms.case)}</text><path d="M${LW+132},${ly-10} L${LW+138},${ly-4} L${LW+132},${ly+2} L${LW+126},${ly-4} z" fill="#FFFFFF" stroke="${PAL.ink2}" stroke-width="1.4"/><text x="${LW+144}" y="${ly}" font-size="10.5" fill="${PAL.ink}">Median of the filtered ${xmlEsc(S.terms.cases)}</text><line x1="${LW+400}" x2="${LW+420}" y1="${ly-4}" y2="${ly-4}" stroke="${SEM.alert}" stroke-width="3" opacity="0.55"/><text x="${LW+426}" y="${ly}" font-size="10.5" fill="${PAL.ink}">later than median</text></svg>`;
  return {svg:s,w:W,h:H};
}

/* =====================================================================
   Analysis bundle, findings, draft recommendations
   ===================================================================== */
function analyse(view,o){
  const model=buildModel(view), ref=o.ref, refKey=o.refKey;
  const A={view,model,ref,refKey,order:layoutOrder(model,ref),st:stats(view,refKey),T:milestoneTiming(view),L:lastMilestone(view),RS:reasonTables(view),slow:slowEdges(model)};
  A.timing=Object.fromEntries(A.T.map(t=>[t.k,t]));
  const dt=breakdown(view,r=>r.dayType,refKey); A.wk={Weekday:dt.find(x=>x.key==='Weekday'),Weekend:dt.find(x=>x.key==='Weekend')};
  A.dows=breakdown(view,r=>r.dowL,refKey).sort((a,b)=>DAY_ORDER.indexOf(DAYS.indexOf(a.key))-DAY_ORDER.indexOf(DAYS.indexOf(b.key)));
  A.groups=SCH.attrs.map(a=>({a,list:breakdown(view,r=>r.attr[a.col],refKey).sort((x,y)=>y.n-x.n)}));
  A.findings=findings(A,o.minN||10,o.basisLabel||shortL(SCH.start));
  if(o.rules&&o.rules.length){ const T=SCH.terms;
    for(const x of ruleSummary(view,o.rules,SCH.cfg)) if(x.n) A.findings.push(`Rule "${x.label}": met by ${pctS(x.rate)} of the ${x.n.toLocaleString()} ${T.cases} it could be judged on (${x.breach.toLocaleString()} breaches${x.na?`, ${x.na.toLocaleString()} not evaluable`:''}).`); }
  return A;
}
function findings(A,minN,basisLabel){
  const F=[], st=A.st, V=A.model.variants, T=SCH.terms;
  if(!st.n) return F;
  if(st.dur.n) F.push(`Median time ${SCH.durLabel}: ${fmtMin(st.dur.med)} (middle half ${fmtMin(st.dur.p25)} to ${fmtMin(st.dur.p75)}; 90th percentile ${fmtMin(st.dur.p90)}; ${st.dur.n.toLocaleString()} ${T.cases} with both times).`);
  if(st.dueN) F.push(`${pctS(st.due)} ended on or before the due date (${st.dueN.toLocaleString()} ${T.cases} with a due date recorded).`);
  const top5=V.slice(0,5).reduce((a,v)=>a+v.n,0);
  F.push(`${V.length.toLocaleString()} distinct step sequences were recorded. The reference flow was followed exactly by ${pctS(st.conf)}; the five most common sequences cover ${pctS(top5/st.n)}.`);
  const slow=[...A.model.edges.values()].filter(e=>A.slow.has(e.key)).sort((a,b)=>b.st.med-a.st.med);
  if(slow.length) F.push(`Longest median wait between consecutive steps: ${EVL(slow[0].a)} → ${EVL(slow[0].b)}, ${fmtMin(slow[0].st.med)} (${slow[0].st.n.toLocaleString()} ${T.cases}).`);
  const L0=A.L.find(x=>x.k!=='none'); if(L0) F.push(`The step most often completed last before the end was ${EVL(L0.k)} (${pctS(L0.p)} of ${T.cases}), followed by a median ${fmtMin(L0.st.med)} until ${EVL(SCH.end).toLowerCase()}.`);
  const low=A.T.filter(t=>t.k!==SCH.end&&t.recP!=null&&t.recP<0.9).sort((a,b)=>a.recP-b.recP);
  if(low.length) F.push(`Steps recorded for fewer than 90% of ${T.cases}: ${low.map(t=>`${t.l} (${pctS(t.recP)})`).join(', ')}.`);
  const post=A.T.filter(t=>t.after!=null&&t.after>=0.2).sort((a,b)=>b.after-a.after);
  if(post.length) F.push(`Recorded after the end step, where recorded: ${post.map(t=>`${t.l} ${pctS(t.after)}`).join(', ')}.`);
  const tr=topReason(A.view); if(tr) F.push(`${pctS(st.reason)} of ${T.cases} have at least one delay reason recorded. The most frequent is "${tr.v}" (${tr.cat}, ${tr.n.toLocaleString()} ${T.cases}).`);
  const wd=A.wk.Weekday, we=A.wk.Weekend;
  if(wd&&we&&wd.n>=minN&&we.n>=minN) F.push(`By ${basisLabel} day: weekend median ${fmtMin(we.st.dur.med)} (n ${we.n}) against weekday ${fmtMin(wd.st.dur.med)} (n ${wd.n}).`);
  for(const g of A.groups){ const W=g.list.filter(w=>w.n>=minN&&w.st.dur.med!=null&&w.key!=='Not recorded').sort((a,b)=>b.st.dur.med-a.st.dur.med);
    if(W.length>=2&&W[0].st.dur.med-W[W.length-1].st.dur.med>=30) F.push(`By ${g.a.l.toLowerCase()} (groups with at least ${minN} ${T.cases}): the longest median is ${W[0].key} (${fmtMin(W[0].st.dur.med)}, n ${W[0].n}), the shortest ${W[W.length-1].key} (${fmtMin(W[W.length-1].st.dur.med)}, n ${W[W.length-1].n}).`); }
  return F;
}
function draftRecs(A,minN,basisLabel){
  const R=[], st=A.st, T=SCH.terms; if(!st.n) return '';
  const slow=[...A.model.edges.values()].filter(e=>A.slow.has(e.key)).sort((a,b)=>b.st.med-a.st.med);
  if(slow.length) R.push(`Review the ${EVL(slow[0].a)} → ${EVL(slow[0].b)} handoff with the teams involved; it has the longest median wait between consecutive steps (${fmtMin(slow[0].st.med)}).`);
  const L0=A.L.find(x=>x.k!=='none'); if(L0) R.push(`Agree with the owners of ${EVL(L0.k)} how it can be completed earlier or in parallel; it is most often the last step before the end (${pctS(L0.p)} of ${T.cases}).`);
  const tr=topReason(A.view); if(tr) R.push(`Work with the relevant team on the most recorded delay reason, "${tr.v}" (${tr.cat}, ${tr.n} ${T.cases}).`);
  const wd=A.wk.Weekday, we=A.wk.Weekend;
  if(wd&&we&&wd.n>=minN&&we.n>=minN&&we.st.dur.med-wd.st.dur.med>=30) R.push(`Look at weekend cover for these steps: the median ${SCH.durLabel} is ${fmtMin(we.st.dur.med-wd.st.dur.med)} longer at weekends (by ${basisLabel} day).`);
  const low=A.T.filter(t=>t.k!==SCH.end&&t.recP!=null&&t.recP<0.8);
  if(low.length) R.push(`Improve recording of ${low.map(t=>t.l).join(', ')} so these steps can be measured reliably.`);
  return R.map(x=>'• '+x).join('\n');
}

/* =====================================================================
   Rules: pure functions of (rule, case) -> met | breach | na
   Rule types (step fields hold column names, as in the setup file):
     within  {a, b, max}                 b recorded no later than max minutes after a
     order   {a, b}                      b not recorded before a
     present {a}                         a is recorded
     clock   {a, time:'HH:MM', anchor, dayOffset}
             anchor 'own'   : a happens before time on a's own calendar day
             anchor 'start' : a happens before time on (start step's day + dayOffset)
   within.countMissing: true counts a recorded a with no b as a breach (default: not evaluable).
   ===================================================================== */
const RULE_TYPES=['within','order','present','clock'];
function parseHM(s){ const m=String(s||'').match(/^(\d{1,2}):(\d{2})$/); if(!m) return null; const h=+m[1], mi=+m[2]; return h<24&&mi<60?h*60+mi:null; }
function ruleProblems(rule,cfg){
  const C=cfg.columns, isStep=c=>C[c]&&C[c].role==='step', P=[];
  if(!RULE_TYPES.includes(rule.type)) return ['Unknown rule type.'];
  if(!isStep(rule.a)) P.push('The first step is not a step column.');
  if((rule.type==='within'||rule.type==='order')&&!isStep(rule.b)) P.push('The second step is not a step column.');
  if((rule.type==='within'||rule.type==='order')&&rule.a===rule.b) P.push('The two steps must differ.');
  if(rule.type==='within'&&!(rule.max>0)) P.push('The time limit must be a positive number of minutes.');
  if(rule.type==='clock'&&parseHM(rule.time)==null) P.push('The time must be written HH:MM.');
  return P;
}
function ruleLabel(rule,cfg){
  const L=c=>(cfg.columns[c]&&cfg.columns[c].label)||c;
  if(rule.label) return rule.label;
  if(rule.type==='within') return `${L(rule.b)} within ${fmtMin(rule.max)} of ${L(rule.a)}`;
  if(rule.type==='order') return `${L(rule.b)} not before ${L(rule.a)}`;
  if(rule.type==='present') return `${L(rule.a)} recorded`;
  if(rule.type==='clock'){ const st=L(cfg.happyFlow[0]), o=rule.dayOffset||0;
    const d=rule.anchor==='start'?(o===0?` on the day of ${st}`:o===1?` the day after ${st}`:` ${o} days after ${st}`):'';
    return `${L(rule.a)} before ${rule.time}${d}`; }
  return rule.type;
}
// Deadline for a case, where the rule has one (within, clock). Times are wall-clock minutes.
function ruleDeadline(rule,r,S){
  const ka=S.byCol[rule.a], ta=r.t[ka];
  if(rule.type==='within') return ta?new Date(+ta+rule.max*6e4):null;
  if(rule.type==='clock'){ const hm=parseHM(rule.time);
    if(rule.anchor==='start'){ const t0=r.t0; return t0?new Date(dayKey(t0)+(rule.dayOffset||0)*864e5+hm*6e4):null; }
    return ta?new Date(dayKey(ta)+hm*6e4):null; }
  return null;
}
function evalRule(rule,r,S){
  S=S||SCH; const ka=S.byCol[rule.a], kb=rule.b!=null?S.byCol[rule.b]:null, ta=r.t[ka], tb=kb?r.t[kb]:null;
  if(rule.type==='present') return ta?{s:'met',v:null}:{s:'breach',v:null,why:'not recorded'};
  if(rule.type==='order'){ if(!ta||!tb) return {s:'na',why:!ta?'first step missing':'second step missing'};
    const v=(tb-ta)/6e4; return v>=0?{s:'met',v}:{s:'breach',v,why:'recorded earlier'}; }
  if(rule.type==='within'){ if(!ta) return {s:'na',why:'first step missing'};
    if(!tb) return rule.countMissing?{s:'breach',v:null,why:'second step missing'}:{s:'na',why:'second step missing'};
    const v=(tb-ta)/6e4; return v<=rule.max?{s:'met',v}:{s:'breach',v,why:'over the limit'}; }
  if(rule.type==='clock'){ if(!ta) return {s:'na',why:'step missing'};
    const dl=ruleDeadline(rule,r,S); if(!dl) return {s:'na',why:'start step missing'};
    const v=(ta-dl)/6e4; return v<0?{s:'met',v}:{s:'breach',v,why:'after the deadline'}; }
  return {s:'na',why:'unknown rule'};
}
// Attach each rule's result to the cases and summarise. r.rules[id] = 'met'|'breach'|'na';
// r.allOk = false when any rule is breached, true when at least one rule was evaluable and none breached.
function applyRules(R,cfg){
  const S=SCH, rules=(cfg.rules||[]).filter(x=>!ruleProblems(x,cfg).length);
  for(const r of R){ r.rules={}; r.ruleV={}; let any=false, bad=false;
    for(const x of rules){ const e=evalRule(x,r,S); r.rules[x.id]=e.s; r.ruleV[x.id]=e.v; if(e.s!=='na') any=true; if(e.s==='breach') bad=true; }
    r.allOk=rules.length&&any?!bad:null; }
  return rules;
}
function ruleSummary(R,rules,cfg){
  return rules.map(x=>{ const met=R.filter(r=>r.rules[x.id]==='met').length, br=R.filter(r=>r.rules[x.id]==='breach').length, na=R.length-met-br;
    const vals=dist(R.filter(r=>r.rules[x.id]!=='na').map(r=>r.ruleV[x.id]));
    return {id:x.id,rule:x,label:ruleLabel(x,cfg),met,breach:br,na,n:met+br,rate:met+br?met/(met+br):null,v:vals}; });
}

/* =====================================================================
   Risk: which cases miss an outcome (a rule), factor by factor and adjusted
   ===================================================================== */
function fOR(v){ return v==null?'–':v<0.01?'<0.01':v>=100?'>100':v.toFixed(2); }
function dayStart(d){ return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()); }
// Candidate factors: timing of the start step, weekend, missing steps, recorded delay reasons,
// and the values of the variables marked relevant for risk (the most common value is the reference).
function riskFactors(R,o){
  const S=SCH, F=[], minN=o.minN||10, has=fn=>{ let y=0,n=0; for(const r of R){ const v=fn(r); if(v===true) y++; else if(v===false) n++; } return y>=minN&&n>=minN; };
  const add=f=>{ if(has(f.fn)) F.push(f); };
  add({id:'lateStart',l:`${shortL(S.start)} on the end day at or after ${hhmm(o.lateH)}`,fn:r=>{ if(!r.t0) return null; if(dayStart(r.t0)<dayStart(r.t1)) return false; return (r.t0-dayStart(r.t0))>=o.lateH*3600e3; }});
  add({id:'prevDay',l:`${shortL(S.start)} the day before the end or earlier`,fn:r=>r.t0?dayStart(r.t0)<dayStart(r.t1):null});
  add({id:'wk',l:`Weekend (${o.wkLabel}; by ${o.basisLabel} day)`,fn:r=>r.dow==null?null:r.dayType==='Weekend'});
  for(const s of S.steps){ if(s.k===S.start||s.k===S.end) continue; add({id:'miss:'+s.k,l:`${s.l} not recorded`,fn:r=>!r.t[s.k]}); }
  for(const q of S.reasons) add({id:'rsn:'+q.k,l:`${q.l} recorded`,fn:r=>!!r.reason[q.k]});
  for(const a of S.attrs.filter(a=>a.risk)){
    const cnt=new Map(); for(const r of R){ const v=r.attr[a.col]; if(v&&v!=='Not recorded') cnt.set(v,(cnt.get(v)||0)+1); }
    const lv=[...cnt.entries()].filter(([,n])=>n>=minN).sort((x,y)=>y[1]-x[1]); if(lv.length<2) continue;
    // dummy coding: each frequent value against all other values; the reference value (most common,
    // or the lowest band for numbers) gets no factor of its own
    const ref=a.type==='num'?lv.map(x=>x[0]).sort()[0]:lv[0][0];
    for(const [v] of lv.filter(x=>x[0]!==ref).slice(0,5)) add({id:`attr:${a.col}=${v}`,l:`${a.l}: ${v}`,fn:r=>{ const x=r.attr[a.col]; return !x||x==='Not recorded'?null:x===v; }});
  }
  return F;
}
function factorTable(R,F,ok){
  return F.map(f=>{ const E=R.filter(r=>ok(r)!=null), y=E.filter(r=>f.fn(r)===true), n=E.filter(r=>f.fn(r)===false);
    const cy=y.length?y.filter(ok).length/y.length:null, cn=n.length?n.filter(ok).length/n.length:null;
    let diff=null,lo=null,hi=null; if(cy!=null&&cn!=null){ diff=cy-cn; const se=Math.sqrt(cy*(1-cy)/y.length+cn*(1-cn)/n.length); lo=diff-1.96*se; hi=diff+1.96*se; }
    return {id:f.id,l:f.l,ny:y.length,cy,nn:n.length,cn,diff,lo,hi,sig:lo!=null&&(lo>0||hi<0)}; }); }
function erfc(x){ const z=Math.abs(x),t=1/(1+0.5*z); const r=t*Math.exp(-z*z-1.26551223+t*(1.00002368+t*(0.37409196+t*(0.09678418+t*(-0.18628806+t*(0.27886807+t*(-1.13520398+t*(1.48851587+t*(-0.82215223+t*0.17087277))))))))); return x>=0?r:2-r; }
function inv(M){ const n=M.length, A=M.map((r,i)=>[...r,...Array.from({length:n},(_,j)=>i===j?1:0)]);
  for(let c=0;c<n;c++){ let p=c; for(let r=c+1;r<n;r++) if(Math.abs(A[r][c])>Math.abs(A[p][c])) p=r; if(Math.abs(A[p][c])<1e-10) return null;
    [A[c],A[p]]=[A[p],A[c]]; const d=A[c][c]; for(let j=0;j<2*n;j++) A[c][j]/=d;
    for(let r=0;r<n;r++) if(r!==c){ const f=A[r][c]; if(f) for(let j=0;j<2*n;j++) A[r][j]-=f*A[c][j]; } }
  return A.map(r=>r.slice(n)); }
// Logistic regression (Newton-Raphson) of missing the outcome on all factors together.
function logitModel(R,F,ok){
  const E=R.filter(r=>ok(r)!=null), noVar=[], sep=[];
  const use=F.filter(f=>{ const v=E.map(r=>[f.fn(r),ok(r)]).filter(x=>x[0]!=null); const t=v.filter(x=>x[0]), n=v.filter(x=>!x[0]);
    if(!t.length||!n.length){ noVar.push(f.l); return false; }
    const allSame=g=>g.every(x=>x[1])||g.every(x=>!x[1]); if(allSame(t)||allSame(n)){ sep.push(f.l); return false; } return true; });
  if(!use.length) return {err:'No factor can be modelled in this group.',noVar,sep};
  const rows=E.filter(r=>use.every(f=>f.fn(r)!=null));
  if(rows.length<50) return {noVar,sep,err:`Only ${rows.length} cases have every factor recorded; at least 50 are needed for an adjusted comparison.`};
  const X=rows.map(r=>[1,...use.map(f=>f.fn(r)?1:0)]), y=rows.map(r=>ok(r)?0:1), ev=y.reduce((a,b)=>a+b,0);
  if(ev<10||rows.length-ev<10) return {noVar,sep,err:'Too few cases meet or miss the outcome for an adjusted comparison.'};
  const k=use.length+1; let b=new Array(k).fill(0), Hi=null;
  const hess=()=>{ const H=Array.from({length:k},()=>new Array(k).fill(0)), g=new Array(k).fill(0);
    for(let i=0;i<X.length;i++){ let e=0; for(let a=0;a<k;a++) e+=X[i][a]*b[a]; const p=1/(1+Math.exp(-e)), w=p*(1-p);
      for(let a=0;a<k;a++){ if(!X[i][a]) continue; g[a]+=y[i]-p; for(let c=0;c<k;c++) if(X[i][c]) H[a][c]+=w; } } for(let a=0;a<k;a++) H[a][a]+=1e-6; return {H,g}; };
  for(let it=0;it<40;it++){ const {H,g}=hess(); Hi=inv(H); if(!Hi) return {noVar,sep,err:'The factors overlap too much to separate their effects.'};
    const st=Hi.map(r=>r.reduce((s,v,j)=>s+v*g[j],0)); b=b.map((v,i)=>v+st[i]); if(Math.max(...st.map(Math.abs))<1e-8) break; }
  Hi=inv(hess().H); if(!Hi) return {noVar,sep,err:'The factors overlap too much to separate their effects.'};
  return {n:rows.length,events:ev,noVar,sep,unstable:b.some(v=>Math.abs(v)>10),terms:use.map((f,i)=>{ const bb=b[i+1],se=Math.sqrt(Hi[i+1][i+1]);
    return {id:f.id,l:f.l,or:Math.exp(bb),lo:Math.exp(bb-1.96*se),hi:Math.exp(bb+1.96*se),p:erfc(Math.abs(bb/se)/Math.SQRT2)}; })};
}
// Funnel plot data: each group's rate against the overall rate, with binomial control limits.
function groupVariation(R,keyFn,minN,ok){ const E=R.filter(r=>ok(r)!=null); if(!E.length) return {p0:null,pts:[]};
  const p0=E.filter(ok).length/E.length, g=new Map();
  for(const r of E){ const k=keyFn(r); const o=g.get(k)||{n:0,c:0}; o.n++; if(ok(r)) o.c++; g.set(k,o); }
  const pts=[...g.entries()].filter(([,o])=>o.n>=minN).map(([key,o])=>{ const p=o.c/o.n, sd=Math.sqrt(p0*(1-p0)/o.n)||1e-9;
    const z=(p-p0)/sd; return {key,n:o.n,c:o.c,p,z,flag:z<-3.09?'bad':z<-1.96?'warn':z>1.96?'good':''}; }).sort((a,b)=>a.z-b.z);
  return {p0,pts,total:E.length,minN}; }
// For cases that missed a deadline rule: which steps were still open at the deadline.
function openAtDeadline(R,rule){
  const S=SCH, ka=S.byCol[rule.a], late=R.filter(r=>r.rules&&r.rules[rule.id]==='breach'&&r.t[ka]), n=late.length;
  const rows=S.steps.filter(e=>e.k!==ka&&e.k!==S.start).map(e=>{ let after=0,none=0;
    for(const r of late){ const dl=ruleDeadline(rule,r,S), t=r.t[e.k]; if(!dl) continue;
      if(!t||t>r.t[ka]) none++; else if(t>dl) after++; }
    return {k:e.k,l:e.l,after,none,pa:n?after/n:0,pn:n?none/n:0}; });
  const lastM=new Map(); for(const r of late){ const pre=r.ev.filter(x=>x.k!==ka&&x.t<=r.t[ka]); const k=pre.length?pre[pre.length-1].k:'none'; lastM.set(k,(lastM.get(k)||0)+1); }
  return {n,rows:rows.sort((a,b)=>b.pa-a.pa),last:[...lastM.entries()].map(([k,c])=>({k,c,p:n?c/n:0})).sort((a,b)=>b.c-a.c)};
}
function riskAnalyse(R,rule,o){ const ok=r=>r.rules[rule.id]==='met'?true:r.rules[rule.id]==='breach'?false:null;
  const F=riskFactors(R.filter(r=>ok(r)!=null),o), E=R.filter(r=>ok(r)!=null);
  return {rule,ok,F,table:factorTable(R,F,ok),model:logitModel(R,F,ok),clin:o.clinFn?groupVariation(R,o.clinFn,o.clinMin||10,ok):{p0:null,pts:[]},
    open:(rule.type==='within'||rule.type==='clock')?openAtDeadline(R,rule):null,
    met:E.length?E.filter(ok).length/E.length:null,metN:E.filter(ok).length,n:E.length}; }

/* ---------- rule and risk SVGs ---------- */
function renderForestSvg(M,outcome){ const T=M.terms||[], W=820, rowH=32, H=58+Math.max(1,T.length)*rowH+24, x0=340, x1=W-170;
  let s=svgOpen(W,H);
  if(M.err) return {svg:s+`<text x="20" y="40" font-size="13" fill="${PAL.ink}">${xmlEsc(M.err)}</text></svg>`,w:W,h:H};
  const lo=Math.max(1/16,Math.min(0.5,...T.map(t=>t.lo))), hi=Math.min(16,Math.max(2,...T.map(t=>t.hi))), L=Math.log(lo), R=Math.log(hi), X=v=>x0+(Math.log(Math.min(hi,Math.max(lo,v)))-L)/(R-L)*(x1-x0);
  s+=`<text x="${X(1)-6}" y="16" text-anchor="end" font-size="11" fill="${PAL.teal}">← less likely to miss</text><text x="${X(1)+6}" y="16" font-size="11" fill="${SEM.alert}">more likely to miss →</text><text x="${W-8}" y="16" text-anchor="end" font-size="10" letter-spacing="1" fill="${PAL.ink2}">ODDS RATIO (95% CI)</text>`;
  [0.0625,0.125,0.25,0.5,1,2,4,8,16].filter(v=>v>=lo&&v<=hi).forEach(v=>{ const x=X(v); s+=`<line x1="${x}" x2="${x}" y1="30" y2="${H-24}" stroke="${v===1?PAL.ink:PAL.rule}" stroke-width="${v===1?1.2:1}"${v===1?'':' stroke-dasharray="5 5"'}/><text x="${x}" y="${H-8}" text-anchor="middle" font-size="10.5" fill="${PAL.ink2}">${v<0.25?v.toFixed(3).replace(/0+$/,''):v}</text>`; });
  T.forEach((t,i)=>{ const y=46+i*rowH, up=t.lo>1, dn=t.hi<1, col=up?SEM.alert:dn?PAL.teal:PAL.ink3;
    s+=`<text x="${x0-12}" y="${y+4}" text-anchor="end" font-size="11.5" fill="${PAL.ink}" font-weight="${up||dn?700:500}">${xmlEsc(t.l.length>52?t.l.slice(0,51)+'…':t.l)}</text>`;
    s+=`<line x1="${X(t.lo)}" x2="${X(t.hi)}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="2.5"/><rect x="${X(t.or)-6}" y="${y-6}" width="12" height="12" fill="${col}"/>`;
    s+=`<text x="${W-8}" y="${y+4}" text-anchor="end" font-size="11.5" fill="${up||dn?col:PAL.ink2}" font-weight="600">${xmlEsc(`${fOR(t.or)} (${fOR(t.lo)}–${fOR(t.hi)})${up?' higher':dn?' lower':''}`)}</text>`; });
  return {svg:s+'</svg>',w:W,h:H}; }
function renderVariationSvg(V,labelFn,selKey,outcome){ const W=780,H=380,x0=56,x1=W-20,y0=20,y1=H-46, P=V.pts;
  let s=svgOpen(W,H);
  if(!P.length||V.p0==null) return {svg:s+`<text x="20" y="40" font-size="13" fill="${PAL.ink}">No group reaches the minimum number of ${xmlEsc(SCH.terms.cases)}.</text></svg>`,w:W,h:H};
  const maxN=Math.max(...P.map(p=>p.n))*1.08, X=n=>x0+n/maxN*(x1-x0), Y=p=>y1-p*(y1-y0), p0=V.p0;
  [0,25,50,75,100].forEach(v=>{ s+=`<line x1="${x0}" x2="${x1}" y1="${Y(v/100)}" y2="${Y(v/100)}" stroke="${PAL.rule}"/><text x="${x0-8}" y="${Y(v/100)+4}" text-anchor="end" font-size="10.5" fill="${PAL.ink2}">${v}%</text>`; });
  const lim=(z,sgn)=>{ let d=''; for(let i=0;i<=80;i++){ const nm=Math.max(2,V.minN||2), n=nm+(maxN-nm)*i/80; const v=Math.min(1,Math.max(0,p0+sgn*z*Math.sqrt(p0*(1-p0)/n))); d+=(i?'L':'M')+X(n).toFixed(1)+','+Y(v).toFixed(1); } return d; };
  s+=`<path d="${lim(3.09,-1)}" fill="none" stroke="${PAL.ink}" stroke-dasharray="2 3"/><path d="${lim(1.96,-1)}" fill="none" stroke="${PAL.ink3}" stroke-dasharray="5 5"/><path d="${lim(1.96,1)}" fill="none" stroke="${PAL.ink3}" stroke-dasharray="5 5"/><path d="${lim(3.09,1)}" fill="none" stroke="${PAL.ink}" stroke-dasharray="2 3"/>`;
  s+=`<line x1="${x0}" x2="${x1}" y1="${Y(p0)}" y2="${Y(p0)}" stroke="${PAL.teal}" stroke-width="1.5"/><text x="${x1}" y="${Y(p0)-5}" text-anchor="end" font-size="10.5" fill="${PAL.teal}" font-weight="600">Overall ${pctS(p0)} met</text>`;
  const C={bad:SEM.alert,warn:SEM.skip,good:PAL.teal,'':PAL.ink3};
  const labs=[];
  P.forEach(p=>{ const on=selKey===p.key;
    s+=`<g data-clin="${xmlEsc(p.key)}" style="cursor:pointer"><title>${xmlEsc(labelFn(p.key))}: ${pctS(p.p)} of ${p.n} met ${xmlEsc(outcome)}</title><rect x="${(X(p.n)-(on?7:5)).toFixed(1)}" y="${(Y(p.p)-(on?7:5)).toFixed(1)}" width="${on?14:10}" height="${on?14:10}" fill="${C[p.flag]}" fill-opacity="${p.flag?0.95:0.7}" stroke="${on?PAL.ink:'#FFFFFF'}" stroke-width="${on?2.5:1}"/></g>`;
    if(p.flag==='bad'||p.flag==='warn'||on){ const t=labelFn(p.key)+(p.flag==='bad'?' (below 99.8%)':p.flag==='warn'?' (below 95%)':''); labs.push({x:X(p.n)+9,y:Y(p.p)+4,px:X(p.n),py:Y(p.p),t,w:t.length*6}); } });
  // keep labels apart: push a label down while it overlaps one already placed
  labs.sort((a,b)=>a.y-b.y); const placed=[];
  for(const l of labs){ let moved=true; while(moved){ moved=false; for(const q of placed) if(Math.abs(l.y-q.y)<13&&l.x<q.x+q.w&&q.x<l.x+l.w){ l.y=q.y+13; moved=true; } } placed.push(l);
    if(Math.abs(l.y-4-l.py)>6) s+=`<line x1="${l.px.toFixed(1)}" y1="${l.py.toFixed(1)}" x2="${(l.x-2).toFixed(1)}" y2="${(l.y-4).toFixed(1)}" stroke="${PAL.ink3}" stroke-width="0.8"/>`;
    s+=`<text x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}" font-size="10.5" fill="${PAL.ink}" font-weight="700" pointer-events="none">${xmlEsc(l.t)}</text>`; }
  s+=`<text x="${(x0+x1)/2}" y="${H-10}" text-anchor="middle" font-size="10" letter-spacing="1" fill="${PAL.ink2}">${xmlEsc(SCH.terms.cases.toUpperCase())} (VOLUME)</text><text x="${x0}" y="${H-10}" font-size="10.5" fill="${PAL.ink2}">0</text><text x="${x1}" y="${H-10}" text-anchor="end" font-size="10.5" fill="${PAL.ink2}">${Math.round(maxN)}</text>`;
  s+=`<g font-size="10.5" fill="${PAL.ink2}"><line x1="${x0+8}" x2="${x0+30}" y1="${y1+22}" y2="${y1+22}" stroke="${PAL.ink3}" stroke-dasharray="5 5"/><text x="${x0+34}" y="${y1+26}">95% limits</text><line x1="${x0+110}" x2="${x0+132}" y1="${y1+22}" y2="${y1+22}" stroke="${PAL.ink}" stroke-dasharray="2 3"/><text x="${x0+136}" y="${y1+26}">99.8% limits</text></g>`;
  return {svg:s+'</svg>',w:W,h:H}; }
function renderOpenSvg(O,rule){ const rows=O?O.rows:[], W=820, LW=220, rowH=28, H=40+rows.length*rowH+30, bw=W-LW-190;
  let s=svgOpen(W,H);
  if(!O||!O.n) return {svg:s+`<text x="20" y="40" font-size="13" fill="${PAL.ink}">No ${xmlEsc(SCH.terms.cases)} missed this deadline.</text></svg>`,w:W,h:H};
  s+=`<text x="${LW}" y="18" font-size="11" fill="${PAL.ink2}">Share of the ${O.n.toLocaleString()} ${xmlEsc(SCH.terms.cases)} that missed the deadline</text>`;
  [0,25,50,75,100].forEach(v=>{ const x=LW+bw*v/100; s+=`<line x1="${x}" x2="${x}" y1="28" y2="${H-30}" stroke="${PAL.rule}"/><text x="${x}" y="${H-16}" text-anchor="middle" font-size="10" fill="${PAL.ink2}">${v}%</text>`; });
  rows.forEach((r,i)=>{ const y=36+i*rowH+rowH/2, wa=bw*r.pa, wn=bw*r.pn;
    s+=`<text x="${LW-10}" y="${y+4}" text-anchor="end" font-size="11.5" font-weight="600" fill="${PAL.ink}">${xmlEsc(r.l)}</text>`;
    s+=`<rect x="${LW}" y="${y-8}" width="${wa}" height="16" fill="${PAL.ink}"><title>${xmlEsc(`${r.l}: completed after the deadline in ${r.after} of ${O.n} (${pctS(r.pa)})`)}</title></rect>`;
    s+=`<rect x="${LW+wa}" y="${y-8}" width="${wn}" height="16" fill="${PAL.t4}"><title>${xmlEsc(`${r.l}: not recorded before the rule's step in ${r.none} (${pctS(r.pn)})`)}</title></rect>`;
    s+=`<text x="${LW+bw+10}" y="${y+4}" font-size="11" fill="${PAL.ink}" font-weight="700">${pctS(r.pa)}</text><text x="${LW+bw+56}" y="${y+4}" font-size="10.5" fill="${PAL.ink2}">${r.pn?pctS(r.pn)+' not recorded':''}</text>`; });
  const ly=H-4; s+=`<rect x="${LW}" y="${ly-9}" width="10" height="10" fill="${PAL.ink}"/><text x="${LW+14}" y="${ly}" font-size="10.5" fill="${PAL.ink}">Completed after the deadline (still open at it)</text><rect x="${LW+290}" y="${ly-9}" width="10" height="10" fill="${PAL.t4}"/><text x="${LW+304}" y="${ly}" font-size="10.5" fill="${PAL.ink}">Not recorded before the rule's step</text>`;
  return {svg:s+'</svg>',w:W,h:H}; }
function renderRulesSvg(RS){ const W=860,LW=300,rowH=30,H=30+Math.max(1,RS.length)*rowH+10,bw=W-LW-170;
  let s=svgOpen(W,H);
  if(!RS.length) return {svg:s+`<text x="20" y="36" font-size="13" fill="${PAL.ink}">No rules defined. Add them in Setup → Rules.</text></svg>`,w:W,h:H};
  [0,25,50,75,100].forEach(v=>{ const x=LW+bw*v/100; s+=`<line x1="${x}" x2="${x}" y1="18" y2="${H-8}" stroke="${PAL.rule}"/><text x="${x}" y="13" text-anchor="middle" font-size="10" fill="${PAL.ink2}">${v}%</text>`; });
  RS.forEach((x,i)=>{ const y=30+i*rowH+rowH/2-6, w=x.rate==null?0:bw*x.rate;
    s+=`<text x="${LW-10}" y="${y+4}" text-anchor="end" font-size="11.5" font-weight="600" fill="${PAL.ink}">${xmlEsc(x.label.length>44?x.label.slice(0,43)+'…':x.label)}</text>`;
    s+=`<rect x="${LW}" y="${y-8}" width="${bw}" height="16" fill="${PAL.t6}"/><rect x="${LW}" y="${y-8}" width="${w}" height="16" fill="${PAL.teal}"><title>${xmlEsc(`${x.label}: met in ${x.met} of ${x.n} evaluable (${pctS(x.rate)}); ${x.breach} breaches; ${x.na} not evaluable`)}</title></rect>`;
    s+=`<text x="${LW+bw+10}" y="${y+4}" font-size="11" fill="${PAL.ink}"><tspan font-weight="700">${pctS(x.rate)}</tspan><tspan fill="${PAL.ink2}"> met · ${x.breach.toLocaleString()} breaches</tspan></text>`; });
  return {svg:s+'</svg>',w:W,h:H}; }

/* =====================================================================
   ZIP writer and PPTX writer (stored zip, hand-written OOXML)
   ===================================================================== */
const CRC_T=(()=>{ const t=new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; t[n]=c>>>0; } return t; })();
function crc32(u8){ let c=0xFFFFFFFF; for(let i=0;i<u8.length;i++) c=CRC_T[(c^u8[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
// deflate (optional): a function returning raw-deflated bytes; without it entries are stored.
function zipStore(entries,deflate){
  const te=new TextEncoder(), parts=[], cd=[]; let off=0;
  for(const e of entries){ const nm=te.encode(e.name), d=typeof e.data==='string'?te.encode(e.data):e.data, crc=crc32(d);
    const z=deflate?deflate(d):d, method=deflate?8:0;
    const lh=new DataView(new ArrayBuffer(30)); lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true); lh.setUint16(6,0x0800,true); lh.setUint16(8,method,true);
    lh.setUint16(12,0x21,true); lh.setUint32(14,crc,true); lh.setUint32(18,z.length,true); lh.setUint32(22,d.length,true); lh.setUint16(26,nm.length,true);
    parts.push(new Uint8Array(lh.buffer),nm,z);
    const ch=new DataView(new ArrayBuffer(46)); ch.setUint32(0,0x02014b50,true); ch.setUint16(4,20,true); ch.setUint16(6,20,true); ch.setUint16(8,0x0800,true); ch.setUint16(10,method,true);
    ch.setUint16(14,0x21,true); ch.setUint32(16,crc,true); ch.setUint32(20,z.length,true); ch.setUint32(24,d.length,true); ch.setUint16(28,nm.length,true); ch.setUint32(42,off,true);
    cd.push(new Uint8Array(ch.buffer),nm); off+=30+nm.length+z.length; }
  const cdSize=cd.reduce((a,b)=>a+b.length,0), eo=new DataView(new ArrayBuffer(22));
  eo.setUint32(0,0x06054b50,true); eo.setUint16(8,entries.length,true); eo.setUint16(10,entries.length,true); eo.setUint32(12,cdSize,true); eo.setUint32(16,off,true);
  const all=[...parts,...cd,new Uint8Array(eo.buffer)], out=new Uint8Array(all.reduce((a,b)=>a+b.length,0)); let p=0; for(const a of all){ out.set(a,p); p+=a.length; } return out;
}
const NS='xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const XH='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const RT='http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const emu=i=>Math.round(i*914400);
const hx=c=>(c||PAL.ink).replace('#','').toUpperCase();
const OFFICE_FONT='Segoe UI';
function runXml(r){ return `<a:r><a:rPr lang="en-GB" sz="${Math.round((r.sz||12)*100)}"${r.b?' b="1"':''}${r.i?' i="1"':''} dirty="0"><a:solidFill><a:srgbClr val="${hx(r.color)}"/></a:solidFill><a:latin typeface="${OFFICE_FONT}"/><a:cs typeface="${OFFICE_FONT}"/></a:rPr><a:t>${xmlEsc(r.t)}</a:t></a:r>`; }
function paraXml(p){ const runs=p.runs||[{t:p.t,sz:p.sz,b:p.b,color:p.color}];
  const ppr=`<a:pPr algn="${p.algn||'l'}"${p.bullet?' marL="228600" indent="-228600"':''}>${p.spcAft?`<a:spcAft><a:spcPts val="${p.spcAft*100}"/></a:spcAft>`:''}${p.bullet?`<a:buClr><a:srgbClr val="${hx(PAL.teal)}"/></a:buClr><a:buFont typeface="Segoe UI"/><a:buChar char="■"/>`:'<a:buNone/>'}</a:pPr>`;
  return `<a:p>${ppr}${runs.map(runXml).join('')}<a:endParaRPr lang="en-GB" sz="${Math.round((runs[0].sz||12)*100)}" dirty="0"/></a:p>`; }
function spXml(id,o){ const E=emu;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr${o.paras?' txBox="1"':''}/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${E(o.x)}" y="${E(o.y)}"/><a:ext cx="${E(o.w)}" cy="${E(o.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${o.fill?`<a:solidFill><a:srgbClr val="${hx(o.fill)}"/></a:solidFill>`:'<a:noFill/>'}${o.line?`<a:ln w="${Math.round((o.lineW||0.75)*12700)}"><a:solidFill><a:srgbClr val="${hx(o.line)}"/></a:solidFill></a:ln>`:'<a:ln><a:noFill/></a:ln>'}</p:spPr>`+
   (o.paras?`<p:txBody><a:bodyPr wrap="square" lIns="${E(o.inset!=null?o.inset:0.08)}" tIns="${E(0.05)}" rIns="${E(o.inset!=null?o.inset:0.08)}" bIns="${E(0.05)}" anchor="${o.anchor||'t'}" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${o.paras.map(paraXml).join('')}</p:txBody>`:'')+`</p:sp>`; }
function picXml(id,rid,o){ const E=emu; return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${E(o.x)}" y="${E(o.y)}"/><a:ext cx="${E(o.w)}" cy="${E(o.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`; }
function tblXml(id,o){ const E=emu, w=o.colW.reduce((a,b)=>a+b,0), h=o.rowH*o.rows.length;
  const rows=o.rows.map((row,ri)=>`<a:tr h="${E(o.rowH)}">`+row.map((c,ci)=>{ c=(c!==null&&typeof c==='object')?c:{t:c}; const hdr=ri===0;
    const fill=c.fill||(hdr?PAL.ink:(ri%2===0?PAL.cream:'#FFFFFF')), col=c.color||(hdr?PAL.cream:PAL.ink);
    return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${paraXml({algn:c.algn||(ci===0?'l':'r'),runs:[{t:String(c.t==null?'':c.t),sz:c.sz||o.sz||10,b:hdr||c.b,color:col}]})}</a:txBody><a:tcPr marL="${E(.07)}" marR="${E(.07)}" marT="${E(.03)}" marB="${E(.03)}" anchor="ctr"><a:lnL w="0"><a:noFill/></a:lnL><a:lnR w="0"><a:noFill/></a:lnR><a:lnT w="0"><a:noFill/></a:lnT><a:lnB w="6350"><a:solidFill><a:srgbClr val="${hx(PAL.rule)}"/></a:solidFill></a:lnB><a:solidFill><a:srgbClr val="${hx(fill)}"/></a:solidFill></a:tcPr></a:tc>`; }).join('')+`</a:tr>`).join('');
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${E(o.x)}" y="${E(o.y)}"/><a:ext cx="${E(w)}" cy="${E(h)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${o.colW.map(c=>`<a:gridCol w="${E(c)}"/>`).join('')}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`; }

class Deck{
  constructor(title){ this.title=title; this.slides=[]; this.media=[]; }
  slide(){ const s={xml:[],rels:[],id:2}; this.slides.push(s); return s; }
  text(s,o){ s.xml.push(spXml(s.id++,o)); }
  rect(s,o){ s.xml.push(spXml(s.id++,o)); }
  table(s,o){ s.xml.push(tblXml(s.id++,o)); }
  image(s,png,pw,ph,box){ const idx=this.media.length+1; this.media.push(png); const rid='rId'+(s.rels.length+2); s.rels.push({rid,target:`../media/image${idx}.png`});
    const k=Math.min(box.w/pw,box.h/ph), w=pw*k, h=ph*k; s.xml.push(picXml(s.id++,rid,{x:box.x+(box.w-w)/2,y:box.y,w,h})); return h; }
  build(){
    const n=this.slides.length, E=[];
    E.push({name:'[Content_Types].xml',data:XH+`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${this.slides.map((s,i)=>`<Override PartName="/ppt/slides/slide${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`});
    E.push({name:'_rels/.rels',data:XH+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT}officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${RT}extended-properties" Target="docProps/app.xml"/></Relationships>`});
    // document properties carry the report title and the tool name only: no author, company or file path
    E.push({name:'docProps/core.xml',data:XH+`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(this.title)}</dc:title><dc:creator>Proxy Process Explorer</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0,19)}Z</dcterms:created></cp:coreProperties>`});
    E.push({name:'docProps/app.xml',data:XH+`<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Proxy Process Explorer</Application><Slides>${n}</Slides></Properties>`});
    E.push({name:'ppt/presentation.xml',data:XH+`<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${this.slides.map((s,i)=>`<p:sldId id="${256+i}" r:id="rId${10+i}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`});
    E.push({name:'ppt/_rels/presentation.xml.rels',data:XH+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT}slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="${RT}theme" Target="theme/theme1.xml"/><Relationship Id="rId3" Type="${RT}presProps" Target="presProps.xml"/><Relationship Id="rId4" Type="${RT}viewProps" Target="viewProps.xml"/><Relationship Id="rId5" Type="${RT}tableStyles" Target="tableStyles.xml"/>${this.slides.map((s,i)=>`<Relationship Id="rId${10+i}" Type="${RT}slide" Target="slides/slide${i+1}.xml"/>`).join('')}</Relationships>`});
    E.push({name:'ppt/presProps.xml',data:XH+`<p:presentationPr ${NS}/>`});
    E.push({name:'ppt/viewProps.xml',data:XH+`<p:viewPr ${NS}><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`});
    E.push({name:'ppt/tableStyles.xml',data:XH+`<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`});
    const grp='<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
    E.push({name:'ppt/slideMasters/slideMaster1.xml',data:XH+`<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hx(PAL.cream)}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${grp}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`});
    E.push({name:'ppt/slideMasters/_rels/slideMaster1.xml.rels',data:XH+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT}slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${RT}theme" Target="../theme/theme1.xml"/></Relationships>`});
    E.push({name:'ppt/slideLayouts/slideLayout1.xml',data:XH+`<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${grp}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`});
    E.push({name:'ppt/slideLayouts/_rels/slideLayout1.xml.rels',data:XH+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT}slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`});
    const sc=(n,c)=>`<a:${n}><a:srgbClr val="${c}"/></a:${n}>`, ph='<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
    E.push({name:'ppt/theme/theme1.xml',data:XH+`<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="mmonfar"><a:themeElements><a:clrScheme name="mmonfar">${sc('dk1','17242B')}${sc('lt1','FDFBF7')}${sc('dk2','1E2A32')}${sc('lt2','E3E5E4')}${sc('accent1','008080')}${sc('accent2','00A3A3')}${sc('accent3','60AFAD')}${sc('accent4','89C2C0')}${sc('accent5','ACD4D1')}${sc('accent6','BBDBD8')}${sc('hlink','008080')}${sc('folHlink','60AFAD')}</a:clrScheme><a:fontScheme name="mmonfar"><a:majorFont><a:latin typeface="Segoe UI Semibold"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Plain"><a:fillStyleLst>${ph}${ph}${ph}</a:fillStyleLst><a:lnStyleLst><a:ln w="6350">${ph}</a:ln><a:ln w="12700">${ph}</a:ln><a:ln w="19050">${ph}</a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${ph}${ph}${ph}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`});
    this.slides.forEach((s,i)=>{
      E.push({name:`ppt/slides/slide${i+1}.xml`,data:XH+`<p:sld ${NS}><p:cSld><p:spTree>${grp}${s.xml.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`});
      E.push({name:`ppt/slides/_rels/slide${i+1}.xml.rels`,data:XH+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT}slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${s.rels.map(r=>`<Relationship Id="${r.rid}" Type="${RT}image" Target="${r.target}"/>`).join('')}</Relationships>`}); });
    this.media.forEach((m,i)=>E.push({name:`ppt/media/image${i+1}.png`,data:m}));
    return zipStore(E);
  }
}

/* ---------- report deck ---------- */
function buildDeck(A,ctx,img){
  const S=SCH, T=S.terms, Tc=T.cases.charAt(0).toUpperCase()+T.cases.slice(1);
  const D=new Deck(`${S.name} review`), SW=13.333, st=A.st;
  const frame=(s,title,sub,num)=>{ D.rect(s,{x:0.5,y:0.3,w:0.5,h:0.04,fill:PAL.teal});
    D.text(s,{x:0.45,y:0.4,w:12.4,h:0.55,paras:[{t:title,sz:24,b:true,color:PAL.ink}]});
    if(sub) D.text(s,{x:0.45,y:0.94,w:12.4,h:0.45,paras:[{t:sub,sz:12,color:PAL.ink2}]});
    D.rect(s,{x:0.5,y:7.02,w:12.33,h:0.01,fill:PAL.rule});
    D.text(s,{x:0.45,y:7.06,w:10.8,h:0.3,paras:[{t:`${ctx.scope} · Aggregate data only · Generated ${ctx.generated}`,sz:8,color:PAL.ink2}]});
    D.text(s,{x:11.8,y:7.06,w:1.03,h:0.3,paras:[{t:String(num),sz:8,color:PAL.ink2,algn:'r'}]}); };
  const pic=(s,im,box)=>im?D.image(s,im.png,im.w,im.h,box):0;
  let k=1, s;
  // title
  s=D.slide(); D.rect(s,{x:0,y:0,w:SW,h:7.5,fill:PAL.ink}); D.rect(s,{x:0.8,y:2.35,w:0.9,h:0.05,fill:PAL.teal});
  D.text(s,{x:0.8,y:2.55,w:11.5,h:1.0,paras:[{t:`${S.name} review`,sz:40,b:true,color:PAL.cream}]});
  D.text(s,{x:0.8,y:3.5,w:11.5,h:0.6,paras:[{t:`From ${EVL(S.start).toLowerCase()} to ${EVL(S.end).toLowerCase()}: timings, variation from the reference flow and delays`,sz:18,color:PAL.t5}]});
  D.text(s,{x:0.8,y:4.6,w:11.5,h:1.6,paras:[{t:`Period: ${ctx.period}`,sz:13,color:PAL.cream,spcAft:4},{t:`Scope: ${ctx.scope}`,sz:13,color:PAL.cream,spcAft:4},{t:`${st.n.toLocaleString()} ${T.cases} analysed`,sz:13,color:PAL.cream,spcAft:4},{t:`Generated ${ctx.generated} · aggregate data only`,sz:11,color:PAL.t4}]});
  k++;
  // KPIs
  s=D.slide(); frame(s,'Headline results','All times are calculated from the step timestamps in the file',k++);
  const K=[[fmtMin(st.dur.med),`Median ${S.durLabel}`,`P75 ${fmtMin(st.dur.p75)} · P90 ${fmtMin(st.dur.p90)} · n ${st.dur.n}`],
    [pctS(st.conf),'Followed the reference flow',`${A.model.variants.length} distinct sequences`],[st.n.toLocaleString(),`${Tc} analysed`,ctx.period]];
  if(st.dueN) K.push([pctS(st.due),'Ended by the due date',`${st.dueN.toLocaleString()} with a due date`]);
  if(S.reasons.length) K.push([pctS(st.reason),'Any delay reason recorded',S.reasons.map(r=>r.l).join(', ')]);
  (ctx.kpiExtra||[]).forEach(x=>K.push(x));
  K.slice(0,6).forEach((c,i)=>{ const x=0.5+(i%3)*4.15, y=1.5+Math.floor(i/3)*1.45;
    D.rect(s,{x,y,w:3.95,h:1.25,fill:'#FFFFFF',line:PAL.rule}); D.rect(s,{x,y,w:0.05,h:1.25,fill:PAL.teal});
    D.text(s,{x:x+0.2,y:y+0.08,w:3.6,h:0.6,paras:[{t:c[0],sz:26,b:true,color:PAL.ink}]});
    D.text(s,{x:x+0.2,y:y+0.66,w:3.6,h:0.3,paras:[{t:c[1],sz:12,b:true,color:PAL.ink2}]});
    D.text(s,{x:x+0.2,y:y+0.93,w:3.6,h:0.28,paras:[{t:c[2],sz:9.5,color:PAL.ink2}]}); });
  D.text(s,{x:0.5,y:4.55,w:12.3,h:2.4,paras:A.findings.slice(0,5).map(t=>({t,sz:11.5,color:PAL.ink,bullet:true,spcAft:4}))});
  // map
  s=D.slide(); frame(s,'Process map: reference flow and variations',`Arrows show which step directly followed which; labels show % of ${T.cases} (count)`,k++);
  const mh=pic(s,img.map,{x:0.5,y:1.5,w:12.33,h:4.55});
  D.text(s,{x:0.5,y:1.6+mh,w:12.3,h:0.5,paras:[{runs:[{t:'Reference flow: ',sz:10.5,b:true,color:PAL.ink},{t:ctx.refLabel,sz:10.5,color:PAL.ink}]}]});
  D.text(s,{x:0.5,y:Math.min(6.45,2.2+mh),w:12.3,h:0.5,paras:[{runs:[{t:'Dark: reference flow.  ',sz:10,b:true,color:PAL.ink},{t:'Above: skips ahead of the reference order.  ',sz:10,color:SEM.skip},{t:'Below: recorded earlier than the reference order.  ',sz:10,color:SEM.alert},{t:'Grey: other direct steps. '+(ctx.post?'':'Steps recorded after the end step are excluded.'),sz:10,color:PAL.ink2}]}]});
  // variants
  s=D.slide(); frame(s,'Sequences compared with the reference flow','Most common step sequences and how each differs from the reference',k++);
  const V=A.model.variants.slice(0,11);
  const vr=[['#',{t:'Difference from reference flow',algn:'l'},Tc,'% of total',`Median ${S.durLabel}`]].concat(V.map((v,i)=>{ const d=deviations(v.trace,A.ref,ctx.vmode), ref=v.key===A.refKey, f=ref?PAL.t6:null;
    return [{t:i+1,fill:f,algn:'l'},{t:ref?'Reference flow':d.map(x=>x.l).join(' · ')||'Same steps, same order',fill:f,b:ref,algn:'l'},{t:v.n.toLocaleString(),fill:f},{t:pctS(v.n/st.n),fill:f},{t:fmtMin(v.st.med),fill:f}]; }));
  D.table(s,{x:0.5,y:1.5,colW:[0.45,7.4,1.4,1.3,1.75],rowH:0.42,rows:vr,sz:10});
  // timing
  s=D.slide(); frame(s,`Where time goes, measured from ${EVL(S.start).toLowerCase()}`,`Box: middle half of ${T.cases}; teal line: median; whisker: 75th to 90th percentile`,k++);
  pic(s,img.timing,{x:0.5,y:1.45,w:6.9,h:4.2});
  const tr=[['Step','Recorded','Median','P90',`Before start`,'After end']].concat(A.T.map(t=>[{t:t.l,algn:'l'},pctS(t.recP),fmtMin(t.d.med),fmtMin(t.d.p90),pctS(t.before),t.after==null?'–':pctS(t.after)]));
  D.table(s,{x:7.55,y:1.45,colW:[1.8,0.82,0.66,0.6,0.7,0.7],rowH:0.4,rows:tr,sz:8.5});
  // bottlenecks
  s=D.slide(); frame(s,'Bottlenecks','Slowest direct transitions, and which step was last to be completed before the end',k++);
  const minE=Math.max(5,Math.ceil(st.n*0.02));
  const E=[...A.model.edges.values()].filter(e=>e.a!=='S'&&e.b!=='E'&&e.a!==S.end&&e.st.n>=minE).sort((a,b)=>b.st.med-a.st.med).slice(0,8);
  D.table(s,{x:0.5,y:1.5,colW:[3.9,0.9,1.0,1.0],rowH:0.38,sz:10,rows:[['Transition','n','Median','P90']].concat(E.map(e=>[{t:`${EVL(e.a)} → ${EVL(e.b)}`,algn:'l'},e.n,fmtMin(e.st.med),fmtMin(e.st.p90)]))});
  D.text(s,{x:7.6,y:1.45,w:5.2,h:0.3,paras:[{t:'Last step before the end',sz:11,b:true,color:PAL.ink2}]});
  pic(s,img.last,{x:7.6,y:1.8,w:5.25,h:4.6});
  D.text(s,{x:0.5,y:5.2,w:6.8,h:1.6,paras:[{t:`Transitions shown have at least ${minE} ${T.cases}. A transition is the time between one step and the next one recorded for the same ${T.case}.`,sz:10,color:PAL.ink2}]});
  // reasons
  if(A.RS.length){ s=D.slide(); frame(s,'Recorded delay reasons',`Share of ${T.cases} with each reason, and median ${S.durLabel} for them`,k++);
    A.RS.slice(0,4).forEach((R,i)=>{ const x=0.5+(i%2)*6.25, y=1.45+Math.floor(i/2)*2.75;
      D.text(s,{x,y,w:6,h:0.3,paras:[{t:`${R.l}: ${R.any.toLocaleString()} ${T.cases} (${pctS(R.anyP)})`,sz:11,b:true,color:PAL.ink}]});
      const rows=[['Reason','n','%','Median']].concat(R.rows.slice(0,5).map(x=>[{t:x.v.length>48?x.v.slice(0,46)+'…':x.v,algn:'l'},x.n,pctS(x.p),fmtMin(x.st.med)]));
      if(R.rows.length) D.table(s,{x,y:y+0.35,colW:[3.7,0.6,0.7,0.9],rowH:0.34,rows,sz:9}); else D.text(s,{x,y:y+0.35,w:6,h:0.4,paras:[{t:'None recorded.',sz:10,color:PAL.ink2}]}); }); }
  // groups: one slide per attribute (first four)
  for(const g of A.groups.slice(0,4)){ s=D.slide(); frame(s,`Differences by ${g.a.l.toLowerCase()}`,`Largest groups first. Bold: median more than 25% above the overall median (groups with at least ${ctx.minN} ${T.cases})`,k++);
    const ext=ctx.groupCols||[];
    const rows=[[g.a.l,'n','Median','P90','Ref. flow'].concat(st.dueN?['By due date']:[]).concat(ext.map(c=>c.l))].concat(g.list.slice(0,12).map(x=>{ const hi=x.st.dur.med!=null&&st.dur.med!=null&&x.n>=ctx.minN&&x.st.dur.med>st.dur.med*1.25;
      return [{t:x.key,algn:'l'},x.n,{t:fmtMin(x.st.dur.med)+(hi?' ▲':''),b:hi},fmtMin(x.st.dur.p90),pctS(x.st.conf)].concat(st.dueN?[pctS(x.st.due)]:[]).concat(ext.map(c=>c.f(x))); }));
    rows.push([{t:'All',b:true},{t:st.n,b:true},{t:fmtMin(st.dur.med),b:true},{t:fmtMin(st.dur.p90),b:true},{t:pctS(st.conf),b:true}].concat(st.dueN?[{t:pctS(st.due),b:true}]:[]).concat(ext.map(c=>({t:c.f({st,recs:A.view}),b:true}))));
    const nC=rows[0].length, cw=[3.4].concat(Array(nC-1).fill(Math.min(1.5,8.9/(nC-1))));
    D.table(s,{x:0.5,y:1.5,colW:cw,rowH:0.36,rows,sz:9.5}); }
  // weekday / weekend
  s=D.slide(); frame(s,'Weekdays and weekends',`Day taken from the ${ctx.basisLabel} time; weekend = ${ctx.weekendLabel}`,k++);
  const wrow=[['','n','Median','P75','P90','Ref. flow','Delay reason']].concat(['Weekday','Weekend'].map(key=>{ const x=A.wk[key]; return x?[{t:key,algn:'l',b:true},x.n,fmtMin(x.st.dur.med),fmtMin(x.st.dur.p75),fmtMin(x.st.dur.p90),pctS(x.st.conf),pctS(x.st.reason)]:[{t:key,algn:'l'},0,'–','–','–','–','–']; }))
    .concat(A.dows.map(x=>[{t:x.key,algn:'l'},x.n,fmtMin(x.st.dur.med),fmtMin(x.st.dur.p75),fmtMin(x.st.dur.p90),pctS(x.st.conf),pctS(x.st.reason)]));
  D.table(s,{x:0.5,y:1.5,colW:[1.4,0.7,0.95,0.95,0.95,1.0,1.1],rowH:0.32,rows:wrow,sz:9});
  pic(s,img.hour,{x:0.5,y:4.75,w:8.4,h:2.2});
  D.text(s,{x:9.1,y:1.5,w:3.75,h:5.4,paras:[{t:'Hour of the first and last step',sz:11,b:true,color:PAL.ink2,spcAft:6},{t:`The chart shows when ${EVL(S.start).toLowerCase()} and ${EVL(S.end).toLowerCase()} happen, by hour, for all filtered ${T.cases}.`,sz:10,color:PAL.ink2}]});
  // slides added by optional modules (rules and risk)
  if(ctx.extraSlides) k=ctx.extraSlides(D,frame,pic,k);
  // heat
  s=D.slide(); frame(s,'Time-of-day and day-of-week pattern',ctx.heatLabel,k++);
  pic(s,img.heat,{x:0.5,y:1.5,w:12.33,h:4.8});
  // findings + recommendations
  s=D.slide(); frame(s,'Findings',null,k++);
  D.text(s,{x:0.5,y:1.15,w:12.3,h:5.8,paras:A.findings.map(t=>({t,sz:12,color:PAL.ink,bullet:true,spcAft:7}))});
  if(ctx.recText&&ctx.recText.trim()){ s=D.slide(); frame(s,'Recommendations',null,k++);
    D.text(s,{x:0.5,y:1.15,w:12.3,h:5.8,paras:ctx.recText.split(/\n+/).map(x=>x.replace(/^\s*[•\-*]\s*/,'').trim()).filter(Boolean).map(t=>({t,sz:13,color:PAL.ink,bullet:true,spcAft:8}))}); }
  // method
  s=D.slide(); frame(s,'Method and limitations',null,k++);
  D.text(s,{x:0.5,y:1.15,w:12.3,h:5.8,paras:[
    `Source: one row per ${T.case}, with one timestamp column per step. Only rows with a time in the end step (${EVL(S.end)}) are included.`,
    `Each ${T.case} is turned into a sequence by sorting its step timestamps. A step counts as done when its timestamp is present; steps with the same timestamp keep the configured step order.`,
    'This is proxy process mining: there is one timestamp per step, not an event log with activities, resources and repeated events. Loops, rework and who did each step cannot be seen, and conformance is a comparison with the reference flow, not a fitted process model.',
    `Reference flow: ${ctx.refLabel}. "Followed the reference flow" means the same steps in the same order, nothing missing or added.`,
    `Weekday or weekend is taken from the ${ctx.basisLabel} time; weekend days: ${ctx.weekendLabel}.`,
    'Delay reasons are counted exactly as recorded; free-text variants of the same reason are counted separately.',
    ctx.post?'Steps recorded after the end step are included in the sequences.':'Steps recorded after the end step are excluded from the sequences but kept in the timing table.'
  ].concat(ctx.dq||[]).map(t=>({t,sz:11.5,color:PAL.ink,bullet:true,spcAft:7}))});
  return D.build();
}

/* =====================================================================
   Synthetic sample: a seeded, fully made-up discharge process
   ===================================================================== */
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
// Delay reasons follow categories common in the published literature on discharge delay
// (medicines to take home, transport, results, senior review, family, community care, placement, documentation).
const SYNTH_REASONS={
  nursing:['Awaiting family or carer to collect','Patient not ready to leave','Awaiting equipment for home','Education for self-care not completed'],
  pharmacy:['Awaiting medicines to take home','Prescription query to prescriber','Controlled drug check pending','Stock not available on ward'],
  other:['Awaiting transport','Awaiting test results','Awaiting senior review','Awaiting community care package','Awaiting placement at receiving facility','Discharge letter not completed']
};
function synthRows(seed,n){
  const rnd=mulberry32(seed||42); n=n||1200;
  const pick=a=>a[Math.floor(rnd()*a.length)], norm=()=>{ let u=0,v=0; while(!u) u=rnd(); while(!v) v=rnd(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };
  const logn=(med,sd)=>med*Math.exp(sd*norm());
  const units=['Unit A','Unit B','Unit C','Unit D','Unit E','Unit F'], unitSlow={'Unit E':1.45,'Unit B':1.15};
  const specs=['General medicine','General surgery','Cardiology','Orthopaedics','Respiratory','Care of older people'];
  const cons=Array.from({length:24},(_,i)=>'Consultant '+p2(i+1)), consSlow={'Consultant 07':1.6,'Consultant 19':1.5};
  const disp=[['Home',0.62],['Home with support',0.2],['Care facility',0.1],['Other hospital',0.08]];
  const pickW=a=>{ let x=rnd(); for(const [v,w] of a){ if((x-=w)<=0) return v; } return a[a.length-1][0]; };
  const fmt=d=>d?`${d.getUTCFullYear()}-${p2(d.getUTCMonth()+1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`:'';
  const add=(d,m)=>new Date(d.getTime()+Math.round(m)*6e4);
  const header=['case_id','unit','specialty','consultant','disposition','sex','age','expected_discharge_date','discharge_order_at','med_reconciliation_at','discharge_summary_at','pharmacy_ready_at','nursing_ready_at','transport_arranged_at','discharged_at','nursing_delay_reason','pharmacy_delay_reason','other_delay_reason'];
  const rows=[];
  const t0=Date.UTC(2026,0,5);
  for(let i=0;i<n;i++){
    const unit=pick(units), spec=pick(specs), con=pick(cons), dp=pickW(disp), age=Math.max(18,Math.min(98,Math.round(66+17*norm())));
    const day=Math.floor(rnd()*168), base=new Date(t0+day*864e5), dow=base.getUTCDay(), wkend=dow===0||dow===6;
    // order time: mostly late morning, some the evening before
    const prevEve=rnd()<0.12; let hr=prevEve?18+rnd()*4:8+Math.abs(norm())*3.2+rnd()*2; hr=Math.min(23.5,hr);
    const order=new Date(base.getTime()+(prevEve?-1:0)*864e5+Math.round(hr*60)*6e4);
    const slow=(unitSlow[unit]||1)*(consSlow[con]||1)*(wkend?1.35:1)*(age>80?1.15:1);
    const medrec=rnd()<0.97?add(order,rnd()<0.08?-logn(40,0.6):logn(55,0.7)*slow):null;
    const summary=rnd()<0.94?add(order,logn(80,0.8)*slow):null;
    const pharm=rnd()<0.92?add(medrec||order,logn(95,0.75)*slow):null;
    const nurse=rnd()<0.95?add(new Date(Math.max(order,summary||0,pharm||0)),logn(25,0.6)):null;
    const needsTr=dp==='Care facility'||dp==='Other hospital'||rnd()<0.18;
    const transport=needsTr?add(order,logn(150,0.7)*(wkend?1.3:1)):null;
    const lastPre=Math.max(order,nurse||0,transport||0,pharm||0);
    let dc=add(new Date(lastPre),logn(35,0.6));
    const blank=rnd()<0.004;
    // a small share of summaries are written after the patient has left
    const summaryOut=summary&&rnd()<0.06?add(dc,logn(120,0.8)):summary;
    const edd=new Date(dayKey(order)+(rnd()<0.7?0:rnd()<0.6?-864e5:864e5)*(rnd()<0.85?1:2));
    const rs={nursing:'',pharmacy:'',other:''};
    if(pharm&&(pharm-(medrec||order))/6e4>150&&rnd()<0.65) rs.pharmacy=pick(SYNTH_REASONS.pharmacy);
    if(nurse&&(dc-nurse)/6e4>60&&rnd()<0.5) rs.nursing=pick(SYNTH_REASONS.nursing);
    if(transport&&(transport-order)/6e4>240&&rnd()<0.7) rs.other='Awaiting transport'; else if(rnd()<0.06) rs.other=pick(SYNTH_REASONS.other);
    rows.push(['SYN-'+String(100000+i),unit,spec,con,dp,rnd()<0.52?'F':'M',String(age),fmt(edd).slice(0,10),fmt(order),fmt(medrec),fmt(summaryOut),fmt(pharm),fmt(nurse),fmt(transport),blank?'':fmt(dc),rs.nursing,rs.pharmacy,rs.other]);
  }
  return {header,rows};
}
const SAMPLE_CONFIG={
  schema:CONFIG_SCHEMA, name:'Discharge process', terms:{case:'discharge',cases:'discharges'},
  columns:{
    case_id:{role:'id',label:'Case ID'}, unit:{role:'attribute',label:'Unit',type:'cat',risk:true}, specialty:{role:'attribute',label:'Specialty',type:'cat',risk:true},
    consultant:{role:'attribute',label:'Consultant',type:'cat',risk:false}, disposition:{role:'attribute',label:'Disposition',type:'cat',risk:true},
    sex:{role:'attribute',label:'Sex',type:'cat',risk:false}, age:{role:'attribute',label:'Age',type:'num',risk:true},
    expected_discharge_date:{role:'due',label:'Expected discharge date'},
    discharge_order_at:{role:'step',label:'Discharge order'}, med_reconciliation_at:{role:'step',label:'Medicines reconciled'},
    discharge_summary_at:{role:'step',label:'Discharge summary'}, pharmacy_ready_at:{role:'step',label:'Medicines ready'},
    nursing_ready_at:{role:'step',label:'Nursing ready'}, transport_arranged_at:{role:'step',label:'Transport arranged'},
    discharged_at:{role:'step',label:'Discharged'},
    nursing_delay_reason:{role:'reason',label:'Nursing delay'}, pharmacy_delay_reason:{role:'reason',label:'Pharmacy delay'}, other_delay_reason:{role:'reason',label:'Other delay'}
  },
  stepOrder:['discharge_order_at','med_reconciliation_at','discharge_summary_at','pharmacy_ready_at','nursing_ready_at','transport_arranged_at','discharged_at'],
  happyFlow:['discharge_order_at','med_reconciliation_at','discharge_summary_at','pharmacy_ready_at','nursing_ready_at','discharged_at'],
  rules:[
    {id:'r1',type:'within',a:'discharge_order_at',b:'discharged_at',max:360},
    {id:'r2',type:'clock',a:'discharged_at',time:'14:00',anchor:'own',label:'Discharged before 14:00'},
    {id:'r3',type:'order',a:'discharge_order_at',b:'med_reconciliation_at'},
    {id:'r4',type:'within',a:'pharmacy_ready_at',b:'nursing_ready_at',max:60},
    {id:'r5',type:'present',a:'discharge_summary_at'}
  ],
  settings:{weekend:[6,0],basis:'start'}
};

/* Context summary for the sticky status bar: one plain line plus what is filtered. Pure; no engine change. */
function contextSummary(o){ const n=o.n, tot=o.total, c=o.cases||'cases', f=(o.filters||[]).filter(x=>x&&x.values&&x.values.length);
  const parts=[n===tot?`${n.toLocaleString('en-GB')} ${c}`:`${n.toLocaleString('en-GB')} of ${tot.toLocaleString('en-GB')} ${c}`];
  if(n>0&&o.conf!=null&&isFinite(o.conf)) parts.push(`${o.confText||Math.round(o.conf*100)+'%'} ${o.followed||'followed the happy flow'}`);
  if(n>0&&o.slow) parts.push(`slowest step ${o.slow}`);
  const active=f.length+(o.segment?1:0);
  return {headline:parts.join(' · '),active,filtered:active>0,filterCount:f.length,empty:n===0,
    items:f.map(x=>({label:x.label,text:x.values.join(' or ')})).concat(o.segment?[{label:'Segment',text:o.segment}]:[])}; }

if(typeof module!=='undefined') module.exports={contextSummary,PAL,SEM,CONFIG_SCHEMA,ROLES,parseCsv,readXlsxRows,toTable,findHeader,profileColumns,stepStats,typicalOrder,mergeConfig,isPiiHeader,suggestConfig,normaliseConfig,validateConfig,setSchema,buildRecords,prepare,keyOf,buildModel,layoutOrder,deviations,stats,milestoneTiming,lastMilestone,reasonTables,breakdown,topReason,heatData,analyse,draftRecs,renderMapSvg,renderMapSvgH,renderTimingSvg,renderLastSvg,renderHourSvg,renderHeatSvg,renderEncSvg,buildDeck,zipStore,toDate,RULE_TYPES,parseHM,ruleProblems,ruleLabel,ruleDeadline,evalRule,applyRules,ruleSummary,riskFactors,factorTable,logitModel,groupVariation,openAtDeadline,riskAnalyse,renderForestSvg,renderVariationSvg,renderOpenSvg,renderRulesSvg,fmtMin,pctS,synthRows,SAMPLE_CONFIG,get SCH(){return SCH;}};
