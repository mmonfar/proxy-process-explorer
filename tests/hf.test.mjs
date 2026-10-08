// Human-factors state logic: the sticky status bar summary (pure function, synthetic numbers only).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {contextSummary}=createRequire(import.meta.url)('../src/core.js');

test('unfiltered summary: one plain line, nothing active', () => {
  const s=contextSummary({n:1197,total:1197,cases:'discharges',conf:0.2,confText:'20%',slow:'A \u2192 B (1.7 h)'});
  assert.equal(s.headline,'1,197 discharges \u00b7 20% followed the happy flow \u00b7 slowest step A \u2192 B (1.7 h)');
  assert.equal(s.filtered,false); assert.equal(s.active,0); assert.equal(s.filterCount,0);
});
test('filtered summary shows "x of N" and lists each filter', () => {
  const s=contextSummary({n:300,total:1197,cases:'cases',conf:0.5,filters:[{label:'Unit',values:['A','B']},{label:'Sex',values:[]}]});
  assert.match(s.headline,/^300 of 1,197 cases \u00b7 50% followed the happy flow/);
  assert.equal(s.filtered,true); assert.equal(s.filterCount,1);
  assert.deepEqual(s.items,[{label:'Unit',text:'A or B'}]);
});
test('a segment counts as an active filter but not toward Match all/any', () => {
  const s=contextSummary({n:10,total:20,cases:'cases',segment:'Late start'});
  assert.equal(s.active,1); assert.equal(s.filterCount,0); assert.equal(s.filtered,true);
  assert.deepEqual(s.items,[{label:'Segment',text:'Late start'}]);
});
test('empty result drops the metrics instead of printing NaN', () => {
  const s=contextSummary({n:0,total:50,cases:'cases',conf:NaN,slow:'X',filters:[{label:'Unit',values:['Z']}]});
  assert.equal(s.empty,true); assert.equal(s.headline,'0 of 50 cases'); assert.ok(!/NaN/.test(s.headline));
});
test('reference wording and missing slow step are handled', () => {
  const s=contextSummary({n:5,total:5,cases:'cases',conf:0.4,followed:'followed the reference flow'});
  assert.equal(s.headline,'5 cases \u00b7 40% followed the reference flow');
});
