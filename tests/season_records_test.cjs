'use strict';
const assert = require('node:assert/strict');
const Merge = require('../js/merge.js');
let passed = 0;
for (const full of [false, true]) {
  const base = {gardens:[], beds:[], plantings:[{id:'p',cropId:'leaf',bedId:'tower',date:'2027-05-01'}]};
  const own = p => full ? p.lrfNextKeep.keep : p.lrfNext;
  if (full) base.lrfNextKeep = {keep:{}}; else base.lrfNext = {};
  const phone = structuredClone(base);
  own(phone).harvestEntries = [{id:'first-pick',plantingId:'p',date:'2027-05-28',unit:'each',marketable:6,culls:1}];
  for (const skip of [false, true]) {
    const desktop = structuredClone(base);
    if (skip) desktop.plantings = []; else desktop.plantings[0].date = '2027-06-01';
    for (const [a,b] of [[phone,desktop],[desktop,phone]]) {
      const joined = Merge.merge(base,a,b);
      assert.equal(joined.ok,true,joined.why);
      assert.equal(joined.plan.plantings[0].date,'2027-05-01');
      assert.deepEqual(own(joined.plan).harvestEntries,own(phone).harvestEntries);
      assert.ok(joined.report.items.length);
      passed++;
    }
  }
  const trays = structuredClone(base);
  trays.liveTrayPlans = [{id:'tray-plan'}];
  Object.assign(trays.plantings[0],{trays:5,liveTray:{planId:'tray-plan',key:'week-1'}});
  const picked = structuredClone(trays), reduced = structuredClone(trays);
  own(picked).harvestEntries = own(phone).harvestEntries;
  reduced.plantings[0].trays = 1;
  for (const [a,b] of [[picked,reduced],[reduced,picked]]) {
    const merged = Merge.merge(trays,a,b);
    assert.equal(merged.ok,true,merged.why);
    assert.equal(merged.plan.plantings[0].trays,5);
    assert.ok(merged.report.items.some(x=>x.what==='tray-demand'));
    passed++;
  }
  const a=structuredClone(base), b=structuredClone(base);
  own(a).buyerDemand = [{id:'buyer-1-week-1',amount:60},{id:'buyer-2-week-1',amount:40}];
  own(b).buyerDemand = [{id:'buyer-1-week-1',amount:65}];
  const joined = Merge.merge(base,a,b);
  assert.equal(joined.ok,true,joined.why);
  assert.equal(own(joined.plan).buyerDemand.reduce((sum,r)=>sum+r.amount,0),105);
  assert.ok(joined.report.items.length);
  passed++;
}
console.log(JSON.stringify({passed,of:14,failed:[]}));
