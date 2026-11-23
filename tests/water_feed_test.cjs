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
const zone={id:'north',gardenId:'field',name:'North line'};
const sampleRun=(id,at,params)=>W.run(zone,{id,at:clock(at),entered:clock(at),elapsed:10,status:'Completed',source:'Observation',...params});
const skipped=sampleRun('skip','09:00',{status:'Skipped',elapsed:''});
const flow=sampleRun('actual','09:00',{status:'Interrupted',elapsed:8,meter:15});
const later=sampleRun('later','10:00',{meter:0});
const runs=(...items)=>W.groups(items.reduce(add,{}),'run');
check('Skipped runs contribute no starts; zero metered, estimated and unknown stay distinct',()=>{
  const estimates={...sampleRun('rating','11:00',{}),rate:2};
  const unknown=sampleRun('unknown','12:00',{elapsed:4,planned:10,status:'Interrupted'});
  const r=W.runSummary(runs(skipped,later,estimates,unknown));
  assert.deepEqual([r.started,r.skipped,r.interrupted,r.minutes,r.metered,r.estimated,r.unknown],[3,1,1,24,0,20,1]);
  assert.throws(()=>sampleRun('bad','08:00',{status:'Skipped',elapsed:8}));
});
check('A disputed start withholds elapsed time and volume in both arrival orders',()=>{
  for (const [first,second] of [[skipped,flow],[flow,skipped]]) {
    const group=runs(first,{...second,entered:clock('11:00')})[0], r=W.runSummary([group]);
    assert.equal(W.water(group).gallons,null);
    assert.deepEqual([r.started,r.skipped,r.minutes,r.unknown,r.disputed,r.reviews.length],[0,0,0,1,1,1]);
  }
});
check('Compatible evidence can supply planned time and a meter after an earlier decision',()=>{
  const origin={...flow,meter:null};
  let b={...add({},origin),accepted:{[flow.job]:origin.id},review:{[origin.id]:'same'}};
  b=add(b,{...flow,id:'controller',planned:20,meter:15,entered:clock('10:00')});
  let g=W.groups(b,'run')[0];assert.equal(g.planned,20);assert.equal(W.water(g).gallons,15);assert.equal(g.unsettled.length,0);
  b=add(b,{...flow,id:'correction',meter:19,entered:clock('11:00')});
  g=W.groups(b,'run')[0];assert.ok(g.unsettled.length);assert.equal(W.water(g).gallons,null);
});
check('Two rated flows with no meter hold the water volume for review, without losing elapsed minutes',()=>{
  const original={...flow,meter:null,rate:1}, other={...original,id:'other',rate:3,entered:clock('11:00')};
  const g=runs(original,other)[0];
  assert.equal(W.water(g).gallons,null);assert.equal(W.runSummary([g]).minutes,8);assert.ok(g.unsettled.length);
  const sameScope={...original,id:'scope',beds:['south']};
  assert.ok(runs(original,sameScope)[0].unsettled.length);
  assert.equal(W.sameRunEvidence(original,sameScope),false);assert.equal(W.sameRunEvidence(original,other),false);
  assert.equal(W.sameRunEvidence({...original,beds:['a','b']},{...original,beds:['b','a']}),true);
  const withheld={...other,rate:null};
  for (const [first,second] of [[original,withheld],[withheld,original]]) {
    const held=runs(first,{...second,entered:clock('12:00')})[0];
    assert.equal(W.water(held).gallons,null);assert.ok(held.unsettled.length);
  }
  const metered=runs(original,{...other,meter:18})[0];assert.equal(W.water(metered).gallons,18);
});
const poundsEqual=(a,b)=>assert.ok(Math.abs(a-b)<1e-9, a+' vs '+b);
const supply=(kind,id,time,bags,loose,reference='')=>W.stockEntry(product,kind,{id,at:time,entered:time,bags,loose,reference});
const count=supply('count','count',clock('07:00'),3,21.3);
const received=supply('delivery','receipt',clock('09:10'),1,3,'Demo line 1');
check('Receiving bags and loose pounds preserves the physical pounds and cannot imply an opening count',()=>{
  const empty=add({},received), s=W.stock(empty,'p');
  assert.equal(s.received,28);assert.equal(s.balance,null);
  assert.equal(W.stock(W.put(empty,'products',{...product,bag:50}),'p').received,28);
  assert.equal(received.bagLb,25);assert.throws(()=>supply('count','empty',clock('09:00'),'',''));
  assert.throws(()=>supply('delivery','fraction',clock('09:00'),1.5,2));
  assert.equal(W.stock(add(empty,supply('count','zero',clock('10:01'),0,'')),'p').balance,0);
});
check('An absolute count resets the stock baseline and a backdated use only changes history before it',()=>{
  const b=add(add(base,count),a), before=W.stock(b,'p');
  poundsEqual(before.balance,93.9);assert.equal(before.rows.at(-1).kind,'refill');
  const old=mix(base,'past',clock('06:20'),'historical',{actual:{p:null}});
  const backfilled=add(b,{...old,entered:clock('12:30')});
  poundsEqual(W.stock(backfilled,'p').balance,93.9);assert.equal(W.stock(backfilled,'p').uncertain,false);
  assert.equal(W.stock({...backfilled,voids:{count:true}},'p').uncertain,true);
  poundsEqual(W.stock(add(b,received),'p').balance,121.9);
});
check('Delivery replay joins once; a disputed receipt prevents ordering until reviewed',()=>{
  const start=add(base,count), next={...received,id:'other',items:{p:{name:product.name,lb:31}}};
  for(const merged of [joined(start,add(start,next),add(start,received)),joined(start,add(start,received),add(start,next))]) {
    const inv=W.stock(merged,'p');assert.equal(inv.rows.filter(r=>r.kind==='delivery').length,1);
    assert.equal(inv.review,true);assert.equal(W.purchase(product,inv,200,10).bags,null);
    const resolved={...merged,accepted:{[received.job]:'other'},review:{receipt:'same',other:'same'}};
    poundsEqual(W.stock(resolved,'p').balance,127.3);assert.equal(W.stock(resolved,'p').review,false);
  }
  const fractional=add(add(add({},supply('count','fractional',clock('06:00'),0,0.3)),
    mix(base,'one',clock('08:00'),'one',{actual:{p:0.1}})),mix(base,'two',clock('10:00'),'two',{actual:{p:0.2}}));
  assert.equal(W.stock(fractional,'p').balance,0);
  const midnight=supply('delivery','cross','2027-03-11T00:01:00.000Z',1,3,'Demo line 1');
  assert.equal(midnight.job,received.job);assert.equal(W.groups(add(add({},received),midnight),'delivery').length,1);
});
check('Same-minute count conflicts and ambiguous movement order require reconciliation',()=>{
  const b=add(base,count), disagree=supply('count','different',clock('07:00'),3,8);
  assert.equal(W.stock(add(b,disagree),'p').review,true);
  const sameMinute={...received,at:'2027-03-10T07:00:45.000Z'};
  assert.equal(W.stock(add(b,sameMinute),'p').review,true);
  assert.equal(W.stock(add(add(b,sameMinute),supply('count','later',clock('12:30'),2,0)),'p').review,false);
  const c1=supply('count','first','2027-03-10T11:00:12.000Z',2,0);
  const c2=supply('count','last','2027-03-10T11:00:48.000Z',2,0);
  const middle=supply('delivery','middle','2027-03-10T11:00:33.000Z',0,5,'line');
  const around=add(add(add({},c1),c2),middle);
  assert.equal(W.stock(around,'p').review,true);
  assert.equal(W.stock({...around,accepted:{[c1.job]:'last'},review:{first:'same',last:'same'}},'p').review,false);
  const amendment={...received,id:'amend',at:clock('11:00')};
  const atEdge=add(add(add({},received),amendment),c1);
  assert.equal(W.stock(atEdge,'p').review,true);
});
check('Whole-bag purchases use reserve before subtracting usable stock, with exact boundaries',()=>{
  assert.equal(W.purchase(product,{balance:5},50,10).bags,2);
  assert.equal(W.purchase(product,{balance:55},50,10).bags,0);
  assert.equal(W.purchase(product,{balance:54.999999},50,10).bags,1);
  assert.equal(W.purchase(product,{balance:null},50,10).bags,null);
  assert.equal(W.purchase(product,{balance:-2},50,10).bags,null);
  assert.equal(W.purchase(product,{balance:50},30,10).bags,0);
  assert.equal(W.purchase(product,{balance:0},0.0001,0).bags,1);
  for(const input of [count,received]) assert.deepEqual(SH.check(JSON.parse(file(add({},input)))),{unknown:[],wrong:[]});
});
const injectedRow=(mode,treated,more={})=>({...sampleRun('fed','13:15',{elapsed:'',meter:200}),
  feed:W.injectedFeed(base,tank,mode,100,treated),...more});
check('Injected nutrients use the immutable stock concentration and treated gallons',()=>{
  const partial=injectedRow('part',100), all=injectedRow('whole'), g=runs(partial)[0];
  assert.ok(Math.abs(W.feedDelivery(g).totals.n-0.096)<1e-12);
  assert.ok(Math.abs(W.feedDelivery(runs(all)[0]).totals.n-0.192)<1e-12);
  const altered=W.put(add(base,partial),'products',{...product,n:88});
  assert.ok(Math.abs(W.feedDelivery(W.groups(altered,'run')[0]).totals.n-0.096)<1e-12);
  assert.equal(W.stock(altered,product.id).used,W.stock(base,product.id).used);
  assert.deepEqual(SH.check(JSON.parse(file(altered))),{unknown:[],wrong:[]});
});
check('Legacy runs, water-only runs, and missing volume have separate delivery states',()=>{
  const old=sampleRun('old','13:15',{meter:120});
  assert.equal(W.feedDelivery(runs(old)[0]),null);
  assert.equal(W.feedDelivery(runs({...old,feed:{mode:'plain'}})[0]).plain,true);
  const unknown=injectedRow('whole',null,{meter:null,elapsed:10,rate:null});
  assert.equal(W.feedDelivery(runs(unknown)[0]).gallons,null);
  assert.ok(Math.abs(W.feedDelivery(runs({...unknown,feed:{...unknown.feed,mode:'part',treated:100}})[0]).totals.n-0.096)<1e-12);
  assert.equal(W.feedDelivery(runs({...old,feed:W.injectedFeed(base,tank,'part',100,'')})[0]).gallons,null);
  assert.throws(()=>W.injectedFeed(base,tank,'whole',0));
});
check('Complementary time and gallon reports yield the same metered delivery in either order',()=>{
  const timed=injectedRow('whole',null,{id:'time',meter:null,elapsed:20,rate:2});
  const metered={...timed,id:'meter',meter:120,elapsed:null,rate:null,source:'Hunter flow report'};
  delete metered.feed;
  for(const [first,second] of [[timed,metered],[metered,timed]]) {
    const group=runs(first,{...second,entered:clock('14:00')})[0];
    assert.equal(group.unsettled.length,0);assert.equal(group.elapsed,20);
    assert.equal(W.water(group).gallons,120);assert.equal(W.feedDelivery(group).gallons,120);
    assert.equal(W.runSummary([group]).minutes,20);
  }
});
check('Two conflicting injector observations hold nutrients without losing measured water',()=>{
  const fed=injectedRow('whole'), plain={...fed,id:'off',feed:{mode:'plain'}};
  assert.equal(W.sameRunEvidence(fed,plain),false);
  const group=runs(fed,plain)[0];
  assert.equal(W.water(group).gallons,200);assert.equal(W.feedDelivery(group).held,true);
  assert.equal(W.runSummary([group]).reviews.length,1);
});
check('A lower subsequent meter reading puts partial fertilized gallons under review',()=>{
  const fed=injectedRow('part',100,{meter:null,elapsed:15,rate:10});
  const lower={...fed,id:'meter',meter:40,source:'Hunter flow report'};
  delete lower.feed;
  const group=runs(fed,lower)[0];
  assert.equal(W.water(group).gallons,40);assert.equal(W.feedDelivery(group).held,true);assert.equal(group.unsettled.length,1);
  const only=runs(injectedRow('whole'))[0];
  assert.equal(W.runSummary([only]).unknownMinutes,1);assert.equal(W.water(only).gallons,200);
});
check('Target nitrogen ppm scales with ratio and volume and returns to the same ppm from the actual mix',()=>{
  for(const ratio of [50,100,200]) for(const gallons of [5,20,50]) {
    const lb=W.stockWeight(100,17,gallons,ratio);
    const b=W.put(base,'recipes',W.recipe('target',{name:'Mix',gallons,items:{p:lb}},base));
    assert.ok(Math.abs(W.recipeConcentration({...b,products:{p:{...product,n:17}}},'target',ratio).n-100)<1e-9);
  }
  assert.throws(()=>W.stockWeight(100,0,5,100)); assert.throws(()=>W.stockWeight('',17,5,100));
});
check('A garden default respects activation time, garden, and served beds',()=>{
  const cfg={tankId:tank.id,since:clock('12:00')}, z={gardenId:tank.gardenId,beds:[]};
  const injector={...tank,ratio:100,beds:[]}, b={...base,tanks:{[tank.id]:injector},constantFeed:{[tank.gardenId]:cfg}};
  assert.equal(W.usualInjector(b,tank.gardenId,z,clock('12:00')).id,tank.id);
  assert.equal(W.usualInjector(b,tank.gardenId,z,clock('11:59')),null);
  assert.equal(W.usualInjector(b,'another',z,clock('12:00')),null);
  injector.beds=['bed1'];assert.equal(W.usualInjector(b,tank.gardenId,z,clock('12:00')),null);
  assert.equal(W.usualInjector(b,tank.gardenId,{...z,beds:['bed1']},clock('12:00')).id,tank.id);
  assert.equal(W.usualInjector(b,tank.gardenId,{...z,beds:['bed1','bed2']},clock('12:00')),null);
});
check('Two devices keep each garden setting whole and preserve settings for independent gardens',()=>{
  const initial={tankId:'first',since:clock('10:00')}, off={tankId:'',since:clock('12:00')}, other={tankId:'next',since:clock('11:00')};
  const b={...base,constantFeed:{g:initial}}, m=joined(b,{...b,constantFeed:{g:off,a:initial}},{...b,constantFeed:{g:other,b:other}});
  assert.ok([off,other].some(v=>JSON.stringify(v)===JSON.stringify(m.constantFeed.g)));
  assert.deepEqual(m.constantFeed.a,initial);assert.deepEqual(m.constantFeed.b,other);
  assert.deepEqual(SH.check({...pa,lrfNext:{waterFeed:m}}),{unknown:[],wrong:[]});
});
check('Mixing needs no bag size; loose stock still counts and missing pack sizes never round an order',()=>{
  const p=W.product('p',{name:'Sample',n:10}), input={at:clock('10:00'),bags:0,loose:12};
  assert.equal(p.bag,null);assert.equal(W.stockEntry(p,'count',input).items.p.lb,12);
  assert.throws(()=>W.stockEntry(p,'count',{...input,bags:1}));assert.equal(W.purchase(p,{balance:10},30,0).bags,null);
  assert.equal(W.purchase(p,{balance:30},30,0).bags,0);
});
console.log(JSON.stringify({passed,of:passed,failed:[]}));
