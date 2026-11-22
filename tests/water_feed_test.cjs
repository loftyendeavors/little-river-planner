'use strict';
const assert = require('node:assert/strict');
const W = require('../js/waterfeed.js'), M = require('../js/merge.js'), SH = require('./plan_shape.cjs');
const check = (name, fn) => { fn(); passed++; console.log('ok', name); };
let passed = 0;
const product = W.product('p',{name:'Test blend',bag:25,n:12,p:3,k:6});
let base = W.put({},'products',product);
base = W.put(base,'recipes',W.recipe('r',{name:'Standard mix',gallons:5,items:{p:4}},base));
const tank = {id:'t',name:'Feed tank',gardenId:'g',gallons:5,recipeId:'r',beds:['bed']};
base = W.put(base,'tanks',tank);
base = W.put(base,'receipts',{id:'stock',productId:'p',at:'2027-01-01T00:00:00.000Z',lb:100});
const clock = h => '2027-03-10T'+h+':00.000Z';
const mix = (book,id,at,job=W.cycle(book,tank.id),extra={}) => W.refill(book,tank,{id,job,at,entered:at,gallons:5,remainder:2,actual:{p:2.4},...extra});
const add = (book,r) => W.put(book,'reports',r);
const pa={gardens:[],beds:[],plantings:[]};
const file = b=>JSON.stringify({...pa,lrfNextKeep:{v:1,keep:{waterFeed:b}}});
function joined(start,l,r) {
  const out=M.joinTexts(file(start),file(l),file(r));
  assert.equal(out.ok,true,out.why);
  return out.plan.lrfNextKeep.keep.waterFeed;
}
const anchor=W.cycle(base,'t'), a=mix(base,'A',clock('07:18')), first=add(base,a), obs={...a,id:'B',entered:clock('08:05')};
check('Measured partial records only fresh fertilizer and preserves carryover',()=>{assert.equal(W.stock(first,'p').balance,97.6);assert.equal(a.remainder,2);assert.deepEqual(a.beds,['bed']);});
check('Actual unknown is distinct from zero',()=>{const r=mix(base,'x',clock('07:18'),anchor,{remainder:null,actual:{p:null}});assert.equal(r.remainder,null);assert.equal(r.items.p.lb,null);assert.equal(W.stock(add(base,r),'p').uncertain,true);assert.equal(mix(base,'x',clock('07:18'),anchor,{remainder:0,actual:{p:0}}).items.p.lb,0);});
check('Label and fresh weights survive recipe edits',()=>{const later=W.put(W.put(first,'products',{...product,n:50}),'recipes',{...base.recipes.r,items:{p:12}});assert.equal(W.groups(later,'refill')[0].chosen.items.p.n,12);assert.equal(W.stock(later,'p').used,2.4);});
check('Both offline arrival orders debit one physical refill; replay stays at one',()=>{for(const b of [joined(base,first,add(base,obs)),joined(base,add(base,obs),first)]){assert.equal(W.groups(b,'refill')[0].reports.length,2);assert.equal(W.stock(b,'p').balance,97.6);assert.equal(W.stock(joined(base,b,first),'p').used,2.4);}});
const two=joined(base,first,add(base,obs));
check('Choosing a different observation of the same physical job preserves the next cycle',()=>assert.equal(W.cycle(two,'t'),W.cycle({...two,accepted:{[anchor]:'B'}},'t')));
check('Late entry uses physical time; a separate later job with the same quantity counts',()=>{const late=W.occurrence(first,'t',clock('07:18'),W.cycle(first,'t'));assert.equal(late,anchor);const separate=add(first,mix(first,'C',clock('13:10')));assert.equal(W.groups(separate,'refill').length,2);assert.equal(W.stock(separate,'p').balance,95.2);});
check('A new disagreement after review remains visible',()=>{const resolved={...two,review:{A:'same',B:'same'},accepted:{[anchor]:'B'}};const r=mix(base,'Z',clock('07:18'),anchor,{actual:{p:9}});const g=W.groups(add(resolved,r),'refill')[0];assert.equal(g.chosen.id,'B');assert.equal(g.unsettled[0].id,'Z');});
check('A reviewed separate physical refill charges once and can be taken back on replay',()=>{const separated={...two,review:{B:'separate'}};assert.equal(W.stock(separated,'p').used,4.8);const back={...separated,voids:{B:true},cancelled:{B:true}};assert.equal(W.stock(joined(two,back,separated),'p').used,2.4);});
check('Undo with a lost response and a later offline observation cannot reinstate a debit',()=>{const back={...first,voids:{A:true},cancelled:{[anchor]:true}};const m=joined(base,back,add(base,obs));assert.equal(W.stock(m,'p').used,0);assert.notEqual(W.nextJob(m,anchor),anchor);});
check('Measured, rated and unknown gallons remain distinct',()=>{const z={id:'z',gardenId:'g',name:'Zone',rate:null,beds:['bed']};const r=W.run(z,{id:'run',at:clock('10:00'),entered:clock('10:00'),elapsed:8,planned:20,status:'Interrupted',source:'Grower'});let b=add(base,r);assert.deepEqual(W.water(W.groups(b,'run')[0]),{basis:'Unknown',gallons:null});b=add(b,{...r,id:'evidence',source:'Controller',meter:11});assert.equal(W.groups(b,'run').length,1);assert.equal(W.water(W.groups(b,'run')[0]).gallons,11);assert.deepEqual(W.water({chosen:{...r,rate:2},reports:[]}),{basis:'Estimated',gallons:16});const cont=W.run(z,{id:'next',at:clock('11:00'),entered:clock('11:00'),elapsed:12,status:'Completed',source:'Grower'});assert.equal(W.groups(add(b,cont),'run').reduce((sum,g)=>sum+g.chosen.elapsed,0),20);assert.equal(W.groups(b,'run')[0].chosen.status,'Interrupted');});
check('Per-acre targets use treated area and unknown analysis stays unknown',()=>{assert.equal(W.targetPounds(4356,{n:100}).n,10);assert.equal(W.targetPounds(4356,{n:100}).p,null);assert.equal(W.nutrientTotals({p:{lb:10,n:12,p:null,k:0}}).p,null);assert.equal(W.nutrientTotals({p:{lb:10,n:12,p:3,k:6}}).n,1.2);});
check('Public plan and portable backup shapes cover the saved records',()=>{for(const plan of [{...pa,lrfNext:{waterFeed:two}},JSON.parse(file(two))])assert.deepEqual(SH.check(plan),{unknown:[],wrong:[]});});
check('A later conflicting observation retains the initially charged quantity until review',()=>{
  const original={...a,id:'z',entered:clock('07:19')};
  const other={...obs,id:'a',items:{p:{...a.items.p,lb:4}}};
  const merged=joined(base,add(base,original),add(base,other));
  assert.equal(W.stock(merged,'p').used,2.4);assert.equal(W.groups(merged,'refill')[0].unsettled.length,1);
});
check('Conflicting controller meter readings stay unknown until reviewed',()=>{
  const r=W.run({id:'z',name:'Drip',gardenId:'g'},{id:'origin',entered:clock('11:00'),at:clock('10:00'),elapsed:8,planned:20,status:'Interrupted',source:'Observation'});
  let b=add(base,r);
  for(const [id,meter] of [['m1',2],['m2',9]]) b=add(b,{...r,id,meter,entered:clock('12:00')});
  let g=W.groups(b,'run')[0];assert.equal(W.water(g).gallons,null);assert.ok(g.unsettled.length);
  g=W.groups({...b,accepted:{[r.job]:'m2'},review:{origin:'same',m1:'same',m2:'same'}},'run')[0];assert.equal(W.water(g).gallons,9);
});
check('Tape estimates use bed length, line count, and the rating per hundred feet',()=>{
  const z={gardenId:'g',beds:['one'],tapeRate:0.4,lines:2};
  assert.equal(W.zoneRate(z,[{id:'one',gardenId:'g',l:50}]),0.4);
  assert.equal(W.zoneRate(z,[{id:'one',gardenId:'g',l:100}]),0.8);
  assert.equal(W.zoneRate(z,[]),null);
  assert.equal(W.tapeFlow([{l:50},{l:50}],2,0.4),0.8);assert.throws(()=>W.tapeFlow([],2,0.4));assert.throws(()=>W.tapeFlow([{l:50}],1.5,0.4));
});
check('Recipe concentration responds to dilution; missing actual batch volume stays unknown',()=>{
  const first=W.recipeConcentration(base,'r',100), next=W.recipeConcentration(base,'r',200);
  assert.ok(Math.abs(first.n-115.033)<0.02);assert.equal(next.n,first.n/2);
  assert.equal(mix(base,'x',clock('07:18'),anchor,{gallons:'',actual:{p:2}}).gallons,null);
});
console.log(JSON.stringify({passed,of:passed,failed:[]}));
