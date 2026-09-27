// Writes the synthetic sample (CSV and XLSX) and its setup file into samples/.
// Every value is generated from a fixed seed; no real record is involved.
import {writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {deflateRawSync} from 'node:zlib';
const require=createRequire(import.meta.url);
const core=require('../src/core.js');

const SEED=42, N=1200;
const {header,rows}=core.synthRows(SEED,N);
const out=new URL('../samples/',import.meta.url); mkdirSync(out,{recursive:true});

const q=v=>/[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;
writeFileSync(new URL('synthetic_discharges.csv',out),[header,...rows].map(r=>r.map(q).join(',')).join('\r\n')+'\r\n');

// XLSX: two title rows above the header (as report exports often have), dates as real spreadsheet dates.
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const colL=i=>{ let n=i+1,t=''; while(n>0){ const m=(n-1)%26; t=String.fromCharCode(65+m)+t; n=Math.floor((n-1)/26); } return t; };
const serial=s=>{ const m=s.match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/); if(!m) return null;
  return Date.UTC(+m[1],+m[2]-1,+m[3],+(m[4]||0),+(m[5]||0))/864e5+25569; };
const cell=(v,r,c)=>{ const ref=colL(c)+r; if(v==='') return '';
  const sv=serial(v); if(sv!=null) return `<c r="${ref}" s="${v.length>10?1:2}"><v>${sv}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`; };
const sheetRows=[['SYNTHETIC SAMPLE: made-up discharge process, generated from seed '+SEED],[''],header,...rows]
  .map((r,i)=>`<row r="${i+1}">${r.map((v,c)=>cell(v,i+1,c)).join('')}</row>`).join('');
const XH='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const files=[
  {name:'[Content_Types].xml',data:XH+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'},
  {name:'_rels/.rels',data:XH+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
  {name:'xl/workbook.xml',data:XH+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Discharges" sheetId="1" r:id="rId1"/></sheets></workbook>'},
  {name:'xl/_rels/workbook.xml.rels',data:XH+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
  {name:'xl/styles.xml',data:XH+'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/></cellXfs></styleSheet>'},
  {name:'xl/worksheets/sheet1.xml',data:XH+`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`}
];
writeFileSync(new URL('synthetic_discharges.xlsx',out),core.zipStore(files,b=>new Uint8Array(deflateRawSync(b))));
writeFileSync(new URL('synthetic_discharges.setup.json',out),JSON.stringify(core.normaliseConfig(core.SAMPLE_CONFIG),null,2)+'\n');
console.log(`samples/: ${rows.length} synthetic rows (seed ${SEED}) as .csv and .xlsx, plus synthetic_discharges.setup.json`);
