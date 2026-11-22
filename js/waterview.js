/* Shared Water dashboards, garden equipment, refill cards and fertilizer stock. */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, W = root.LRFWaterFeed;
  const { h, num } = UI;
  let lens = 'Fertility', period = 'Last 7 days', gardenId = '', activeDialog;
  const book = () => App.state.plan?.lrfNext?.waterFeed || {};
  const gardens = () => App.state.plan.gardens || [];
  const rows = (table, id) => W.values(book()[table]).filter(r => !id || r.gardenId === id);
  const button = (text, act, hook, primary) => h('button.btn' + (primary ? '.primary' : '.small'), { type: 'button', onclick: act, dataset: { hook } }, text);
  const line = (...children) => h('div.wf-line', children.flat(Infinity).map(c => typeof c === 'string' || typeof c === 'number' ? h('span',String(c)) : c));
  const note = text => h('p.wf-note', text);
  const bedNames = ids => ids.map(id => App.state.plan.beds.find(b => b.id === id)?.bed ?? id).join(', ');
  const quantity = (value, unit) => value == null ? 'Unknown' : num(value, 2) + ' ' + unit;
  const gardenName = id => gardens().find(g => g.id === id)?.name || 'Former garden';
  const opts = list => list.map(r => [r.id, r.name]);
  const now = () => new Date().toISOString();
  const local = (date = new Date()) => new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
  const when = stamp => new Date(stamp).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const whenRecorded = raw => {
    const date = new Date(raw);
    if (!Number.isFinite(+date) || +date > Date.now() + 60000) throw Error('Enter the time the work actually happened, up to now.');
    return date.toISOString();
  };
  function save(next, label, undoBook) {
    const ok = App.saveWaterFeed(next, label, undoBook);
    if (ok) UI.toast(label, { label: 'Undo', run: App.undo });
    return ok;
  }
  function storeRow(table, row, label) { return save(W.put(book(), table, row), label); }
  function report(row, label) {
    const next = W.put(book(), 'reports', row);
    const undo = { ...next, voids: { ...next.voids, [row.id]: true } };
    if (!W.groups(book(),row.kind).some(g=>g.id===row.job)) undo.cancelled={...next.cancelled,[row.job]:true};
    return save(next, label, undo);
  }
  function close() { if (activeDialog) { activeDialog.close(); activeDialog.remove(); activeDialog = null; } }
  function sheet(title, fields, action, submit) {
    close();
    const error = h('p.wf-error', { role: 'alert', hidden: true });
    const form = h('form.wf-form', { onsubmit: e => {
      e.preventDefault();
      try { const done = !submit || submit() !== false; if (done && activeDialog?.contains(form)) close(); }
      catch (ex) { error.textContent = ex.message; error.hidden = false; }
    } }, h('h2', title), fields, error, h('div.dialog-actions', submit ? button('Cancel', close, 'wf-cancel') : null,
      h('button.btn.primary', { type: 'submit', dataset: { hook: 'wf-submit' } }, action)));
    activeDialog = h('dialog.dialog.wf-sheet', { 'aria-label': title, oncancel: e => { e.preventDefault(); close(); } }, form);
    document.body.append(activeDialog); activeDialog.showModal();
  }
  function field(label, value, type, options) {
    const control = options ? h('select.field', { 'aria-label': label }, options.map(([id, text]) => h('option', { value: id }, text))) :
      h('input.field', { type: type || 'text', step: type === 'number' ? 'any' : null, min: type === 'number' ? 0 : null, 'aria-label': label });
    control.value = value ?? '';
    return { control, el: h('label.wf-field', h('span', label), control), get: () => control.value };
  }
  function productForm(old = {}, afterSave) {
    const title = field('Product name', old.name), bag = field('Bag weight (lb)', old.bag, 'number');
    const analysis = ['N','P₂O₅','K₂O'].map((n,i) => field(n + ' on label (%)', old[['n','p','k'][i]], 'number'));
    sheet('Fertilizer product', [title.el, bag.el, line(analysis.map(f => f.el))], 'Save product', () => {
      const ok=storeRow('products', W.product(old.id || App.uid(), { name: title.get(), bag: bag.get(), n: analysis[0].get(), p: analysis[1].get(), k: analysis[2].get() }), 'Product saved'); if(ok && afterSave) afterSave(); return ok; });
  }
  function recipeForm(old = {}, afterSave) {
    const products = rows('products');
    if (!products.length) { productForm(); return; }
    const title = field('Recipe name', old.name), batch = field('Final stock volume (gal)', old.gallons, 'number');
    const items = products.map(p => [p.id, field(p.name + ' (lb per batch)', old.items?.[p.id], 'number')]);
    sheet('Stock recipe', [title.el, batch.el, items.map(([,f]) => f.el)], 'Save recipe', () => {
      const ok=storeRow('recipes', W.recipe(old.id || App.uid(), { name: title.get(), gallons: batch.get(), items: Object.fromEntries(items.map(([id,f])=>[id,f.get()])) }, book()), 'Recipe saved'); if(ok && afterSave) afterSave(); return ok; });
  }
  function setup(id, kind, old = {}) {
    const tank = kind === 'tank', recipes = rows('recipes');
    if (tank && !recipes.length) {
      const makeRecipe=()=>recipeForm({},()=>setup(id,kind,old));
      if (rows('products').length) makeRecipe(); else productForm({},makeRecipe);
      return;
    }
    const title = field(tank ? 'Tank name' : 'Zone name', old.name);
    const recipe = field('Stock recipe', old.recipeId || recipes[0]?.id, null, opts(recipes));
    const size = field('Tank batch size (gal)', old.gallons ?? '', 'number');
    const dilution = field('Injector dilution 1 to (optional)',old.ratio,'number');
    const flowPerHundred = field('Tape rating (gal/min per 100 ft)',old.tapeRate,'number'), lines=field('Tape lines per served bed',old.lines,'number');
    const rate = field('Rated flow (gal/min, optional)', old.tapeRate ? '' : old.rate, 'number');
    const beds = App.state.plan.beds.filter(b => b.gardenId === id && b.active !== false);
    const scope = beds.map(b => [b.id, h('input', { type: 'checkbox', checked: (old.beds || []).includes(b.id) })]);
    sheet((tank ? 'Feed tank' : 'Irrigation zone') + ' · ' + gardenName(id), [title.el, tank ? [recipe.el,size.el,dilution.el] : [rate.el,h('details',{open:old.tapeRate!=null},h('summary','Calculate flow from bed tape'),line(flowPerHundred.el,lines.el))],
      h('details', h('summary','Served beds'), note('Leave clear if the served beds are unknown.'), scope.map(([bid,c],i) => h('label.wf-choice', c, String(beds[i].bed || bid))))], 'Save equipment', () => {
      const common = { id: old.id || App.uid(), gardenId: id, name: W.name(title.get(), 'an equipment name'), beds: scope.filter(([,c])=>c.checked).map(([bid])=>bid) };
      if (tank) return storeRow('tanks', { ...common, recipeId: recipe.get(), gallons: W.number(size.get(),'tank batch size',0.000001), ratio: dilution.get()===''?null:W.number(dilution.get(),'injector dilution denominator',1) }, 'Tank saved');
      const fromTape = flowPerHundred.get() !== '' || lines.get() !== '';
      if (fromTape && rate.get() !== '') throw Error('Choose one source for the zone flow: the total or the tape rating.');
      if (fromTape) W.tapeFlow(beds.filter(b=>common.beds.includes(b.id)),lines.get(),flowPerHundred.get());
      const flow = rate.get()==='' ? null : W.number(rate.get(),'rated flow',0.000001);
      return storeRow('zones',{...common,rate:flow,tapeRate:fromTape?Number(flowPerHundred.get()):null,lines:fromTape?Number(lines.get()):null},'Zone saved');
    });
  }
  function library() {
    sheet('Products and recipes', [h('h3','Fertilizer products'), rows('products').map(p => line(h('strong',p.name), num(p.bag,2) + ' lb/bag', button('Edit product',()=>productForm(p),'wf-edit-product'))),
      button('Add product',()=>productForm(),'wf-add-product'),h('h3','Stock recipes'),rows('recipes').map(r => line(h('strong',r.name), num(r.gallons,2)+' gal', button('Edit recipe',()=>recipeForm(r),'wf-edit-recipe'))),
      rows('products').length ? button('Add recipe',()=>recipeForm(),'wf-add-recipe') : note('Add the products from your labels to make a recipe.')], 'Done');
  }
  function stockInput(product) {
    const lb = field('Product received or opening stock (lb)', '', 'number');
    sheet('Add stock · ' + product.name,[lb.el], 'Add to stock', () => storeRow('receipts', { id: App.uid(), productId:product.id, lb:W.number(lb.get(),'pounds on the shelf'), at:now() },'Stock recorded'));
  }
  function supplies() {
    const products = rows('products');
    return h('section.wf-block',h('h3','Fertilizer supplies'), products.map(p => {
      const s = W.stock(book(),p.id), due = rows('tanks').filter(t=>W.reminder(book(),t.id) && book().recipes?.[t.recipeId]).reduce((sum,t)=>sum+(W.snapshot(book(),t.recipeId,t.gallons)[p.id]?.lb||0),0);
      const buy = s.balance == null ? null : Math.ceil(Math.max(0,due-s.balance)/p.bag);
      return line(h('strong',p.name), s.balance == null ? 'Opening stock unknown' : num(s.balance,2)+' lb on hand', num(s.used,2)+' lb recorded use',
        s.review || s.uncertain ? 'Provisional' : null, buy == null ? null : num(buy)+' bags to buy for due refills',button('Add stock',()=>stockInput(p),'wf-add-stock'));
    }),button('Products and recipes',library,'wf-products'));
  }
  const amounts = items => Object.values(items).map(p => (p.lb == null ? 'Unknown lb' : num(p.lb,3) + ' lb')+' '+p.name).join(' + ');
  function approved(tank) {
    const b = book(), recipe = b.recipes?.[tank.recipeId];
    return recipe ? W.snapshot(b, recipe.id, tank.gallons) : null;
  }
  function request(tank) {
    const why = field('Reason','Confirmed empty tank',null,[['Confirmed empty tank','Confirmed empty tank'],['Approved formula change','Approved formula change']]);
    sheet('Refill reminder · '+tank.name,[why.el], 'Add reminder', () => {
      const b = book(); if (W.reminder(b,tank.id)) throw Error('A reminder is already open for this tank.');
      return storeRow('requests',{id:App.uid(),tankId:tank.id,cycle:W.cycle(b,tank.id),reason:why.get(),at:now()},'Refill reminder added');
    });
  }
  function recordMix(tank, task, options) {
    const b = book(), current = b.tanks?.[tank.id], rec = b.recipes?.[tank.recipeId];
    if (!current || !rec || JSON.stringify(current)!==JSON.stringify(tank) || !options.itemsShown || JSON.stringify(options.itemsShown)!==JSON.stringify(approved(current)) || W.cycle(b,tank.id)!==options.job) throw Error('The tank or recipe changed. Open the current refill card.');
    const row = W.refill(b,tank,{id:App.uid(),job:options.job,at:options.at||now(),entered:now(),reminder:!!task,gallons:tank.gallons,remainder:task?.reason === 'Confirmed empty tank' ? 0 : null,...options});
    row.job = options.at ? W.occurrence(b,tank.id,row.at,W.nextJob(b,options.job)) : W.nextJob(b,options.job);
    return report(row,'Refill recorded · '+tank.name);
  }
  function mixDetails(tank) {
    const b=book(), job=W.cycle(b,tank.id), shown=approved(tank), task=W.reminder(b,tank.id);
    const time=field('Back in service at',local(),'datetime-local'), gallons=field('Actual final stock (gal, blank if unknown)','','number'), carry=field('Measured remainder (gal, blank if unknown)',task?.reason==='Confirmed empty tank'?0:'','number');
    const items=rows('products').map(p=>[p.id,field('Fresh '+p.name+' (lb)','','number'),!!shown[p.id]]);
    sheet('Record actual refill · '+tank.name,[time.el,gallons.el,carry.el,note('Enter the fresh pounds actually added. A blank recipe ingredient stays unknown. Enter zero if none went in.'),items.map(([,f])=>f.el)],'Record actual refill',()=>
      recordMix(tank,task,{job,itemsShown:shown,at:whenRecorded(time.get()),gallons:gallons.get(),remainder:carry.get(),actual:Object.fromEntries(items.filter(([,f,used])=>used||f.get()!=='').map(([id,f])=>[id,f.get()]))}));
  }
  function tasks() {
    const tanks=rows('tanks'), phoneZones=document.body.classList.contains('phone')?rows('zones'):[];
    if (!tanks.length && !phoneZones.length) return null;
    const b=book(), due=tanks.filter(t=>W.reminder(b,t.id));
    const cards=due.map(t=>{
      const task=W.reminder(b,t.id), items=approved(t), job=W.cycle(b,t.id);
      return h('article.wf-task',h('h4','Refill '+t.name+' · '+gardenName(t.gardenId)),note(task.reason),
        items ? [h('strong',amounts(items)),note(b.recipes[t.recipeId].name+' · '+num(t.gallons,2)+' gal batch'),
          line(button('Refilled as shown',()=>{try{recordMix(t,task,{job,itemsShown:items});}catch(ex){UI.toast(ex.message);}},'wf-complete',true),button('Actual amounts…',()=>mixDetails(t),'wf-actual'))] : note('Choose a stock recipe for this tank.'));
    });
    return h('section.wf-block',{dataset:{hook:'wf-tasks'}},h('h3','Water and feed'),due.length ? cards : tanks.length?note('Nothing due'):null,
      tanks.map(t=>{const last=W.lastMix(b,t.id);return line(t.name, last?'Last refill '+when(last.chosen.at):'No refill recorded',!W.reminder(b,t.id) && approved(t) ? button('Refill',()=>mixDetails(t),'wf-refill') : null);}),
      phoneZones.length?button('Record irrigation run',()=>pickRunZone(phoneZones),'wf-phone-run'):null);
  }
  function pickRunZone(zones) {
    if (zones.length===1) {runForm(zones[0]);return;}
    const choices=zones.map(z=>[z.id,gardenName(z.gardenId)+' · '+z.name]).sort((a,b)=>a[1].localeCompare(b[1]));
    const choice=field('Garden and zone','',null,[['','Choose a zone'],...choices]);
    sheet('Record irrigation run',[choice.el],'Continue',()=>{
      const zone=book().zones?.[choice.get()];
      if(!zone) throw Error('Choose the zone that ran or was skipped.');
      runForm(zone);
    });
  }
  function runForm(z) {
    const at=field('Run started at',local(),'datetime-local'), elapsed=field('Actual minutes','','number'), planned=field('Planned minutes (optional)','','number'), meter=field('Metered gallons (optional)','','number');
    const status=field('Run status','Completed',null,['Completed','Interrupted','Skipped'].map(x=>[x,x])), source=field('Evidence','Grower observation',null,['Grower observation','Controller record'].map(x=>[x,x]));
    const rate=W.zoneRate(z,App.state.plan.beds), useRate=h('input',{type:'checkbox',checked:rate!=null});
    sheet('Record run · '+gardenName(z.gardenId)+' · '+z.name,[at.el,line(elapsed.el,planned.el),line(status.el,source.el),meter.el,
      rate!=null?h('label.wf-choice',useRate,'Use '+num(rate,3)+' gal/min to estimate unmetered water for this run'):null], 'Record run',()=>{
      const row=W.run({...z,rate:useRate.checked?rate:null},{id:App.uid(),at:whenRecorded(at.get()),entered:now(),elapsed:elapsed.get(),planned:planned.get(),meter:meter.get(),status:status.get(),source:source.get()});
      row.job=W.nextJob(book(),row.job);
      if (rows('reports').some(r=>!book().voids?.[r.id] && r.kind==='run' && r.job===row.job && W.sameRunEvidence(r,row))) throw Error('This run and evidence are already recorded.');
      return report(row,'Run recorded · '+z.name);
    });
  }
  function reconcile(group, kind) {
    const isRun=kind==='run';
    const describe=r=>isRun ? [r.status, quantity(r.elapsed,'min')+' elapsed', (r.planned==null?'Planned time unknown':quantity(r.planned,'min')+' planned'),
      (r.meter==null?'Meter reading unknown':quantity(r.meter,'gal')+' metered'),
      r.rate==null?'No rated flow':num(r.rate,3)+' gal/min rated',r.beds?.length?'Beds '+bedNames(r.beds):'Served beds unknown',r.source].join(' · ') :
      kind==='spread' ? amounts(r.items)+' · '+(r.beds.length?r.beds.length+' treated beds':'whole garden') : amounts(r.items)+' · '+num(r.gallons,2)+' gal final · '+(r.remainder==null?'remainder unknown':num(r.remainder,2)+' gal carried');
    function decide(r,choice) {
      const live=W.groups(book(),kind).find(g=>g.id===group.id);
      if(!live){close();return;}
      if(live.reports.map(x=>x.id).join('/')!==group.reports.map(x=>x.id).join('/')){reconcile(live,kind);return;}
      const b=book(), review={...b.review}, accepted={...b.accepted};
      if(choice==='separate') review[r.id]='separate';
      else { accepted[group.id]=r.id; for(const seen of group.reports) if(review[seen.id]!=='separate') review[seen.id]='same'; }
      if(save({...b,review,accepted},'History decision saved')) close();
    }
    sheet('Review '+(isRun?'run evidence':'application reports'),group.reports.map(r=>h('section.wf-task', h('strong',when(r.at)),note('Entered '+when(r.entered)),note(describe(r)),
      line(button('Use these figures for the same job',()=>decide(r,'same'),'wf-use-report'),kind==='refill' && r.id!==group.chosen.id ? button('Count as a separate refill',()=>decide(r,'separate'),'wf-separate') : null))),'Done');
  }
  function takeBack(group) {
    const current=book(), voids={...current.voids};
    for(const r of group.reports) voids[r.id]=true;
    if(save({...current,voids,cancelled:{...current.cancelled,[group.id]:true}},'Entry taken back')) close();
  }
  function history(group, kind) {
    const r=group.chosen, run=kind==='run', w=run && W.water(group);
    return h('details.wf-history',h('summary',h('b',r.label),' · '+when(r.at)+' · '+(run ? group.workConflict?'Run details disputed':r.status+' · '+num(r.elapsed,2)+' min' : amounts(r.items)),group.unsettled.length?' · Review reports':''),
      note(run ? (group.planned==null?'Planned time unconfirmed':num(group.planned,2)+' min planned')+' · '+(w.gallons==null?(w.basis==='Unknown'?'Gallons unknown':w.basis):num(w.gallons,2)+' gal · '+w.basis)+' · '+[...new Set(group.reports.map(x=>x.source))].join(' + ') :
      kind==='spread' ? 'Applied to '+(r.beds.length?'beds '+bedNames(r.beds):'the whole garden') : r.recipe+' · '+(r.gallons==null?'Final stock volume unknown':num(r.gallons,2)+' gal final stock')+' · '+(r.remainder==null?'Remainder unknown':num(r.remainder,2)+' gal carried')+' · Delivery unknown'),
      run || kind==='refill' ? note(r.beds?.length?'Served beds '+bedNames(r.beds):'Served beds unknown') : null,
      line(group.reports.length>1?button('Review reports',()=>reconcile(group,kind),'wf-review'):null,button('Take back entry',()=>sheet('Take back '+r.label+'?',[note('Remove this physical job from totals. Its reports stay in the plan.')],'Take back',()=>takeBack(group)),'wf-take-back')));
  }
  function labForm(id) {
    const kind=field('Sample type','Soil',null,['Soil','Soil extract','Tissue','Water'].map(x=>[x,x])), sampled=field('Sample date',local().slice(0,10),'date'), lab=field('Lab and report ID',''), method=field('Extraction method or tissue stage',''), analyte=field('Analyte',''), reading=field('Reported value','','text'), unit=field('Original units','');
    const beds=App.state.plan.beds.filter(b=>b.gardenId===id && b.active!==false).map(b=>[b,h('input',{type:'checkbox'})]);
    sheet('Review a lab result',[kind.el,sampled.el,lab.el,method.el,line(analyte.el,reading.el,unit.el),h('details',{open:true},h('summary','Sampled beds'),beds.map(([b,c])=>h('label.wf-choice',c,String(b.bed||b.id))))], 'Accept result',()=>{
      if(!sampled.get() || sampled.get()>local().slice(0,10)) throw Error('Enter the actual sample date.');
      const record={id:App.uid(),gardenId:id,kind:kind.get(),date:sampled.get(),source:W.name(lab.get(),'the lab and report ID'),method:W.name(method.get(),'the method or crop stage'),analyte:W.name(analyte.get(),'the analyte'),value:W.name(reading.get(),'the original reading'),unit:W.name(unit.get(),'the original units'),beds:beds.filter(([,c])=>c.checked).map(([b])=>b.id)};
      if(rows('labs',id).some(x=>['date','source','kind','analyte','method','unit','value'].every(k=>x[k]===record[k]) && JSON.stringify(x.beds)===JSON.stringify(record.beds))) throw Error('This lab result is already in history.');
      return storeRow('labs',record,'Lab result accepted');
    });
  }
  const nutrients = [['n','N'],['p','P₂O₅'],['k','K₂O']];
  function seasonFigures(id) {
    const garden=gardens().find(g=>g.id===id), year=App.planYear(), key=JSON.stringify([id,year]);
    const target=book().targets?.[key], beds=App.state.plan.beds.filter(b=>b.gardenId===id && b.active!==false && App.state.engine.isSoilBed(b));
    const areaBeds=beds.reduce((sum,b)=>sum+b.w*b.l,0), floor=(garden.measuredSize?.widthFt||0)*(garden.measuredSize?.lengthFt||0);
    function recorded(kind) {
      const jobs=W.groups(book(),kind).filter(g=>g.chosen.gardenId===id && new Date(g.chosen.at).getFullYear()===year);
      if (!jobs.length) return null;
      const totals=W.nutrientTotals(jobs.flatMap(g=>Object.values(g.chosen.items)));
      return {totals, disputed:jobs.some(g=>g.unsettled.length)};
    }
    return {garden, year, key, target, beds, areaBeds, floor, applied:recorded('spread'), mixed:recorded('refill')};
  }
  function nutrientTable(figures, targetLb) {
    const cell=(tag,value)=>h(tag,value==null?'Unknown':num(value,3)+' lb');
    const row=(label,amounts)=>h('tr', h('th',{scope:'row'},label), nutrients.map(([k])=>cell('td',amounts?.[k])));
    return h('table.wf-nutrients', h('caption','Season fertility · '+figures.year),
      h('thead',h('tr',h('th',{scope:'col'},'Nutrient amounts'),nutrients.map(([,label])=>h('th',{scope:'col'},label)))),
      h('tbody',targetLb?row('Target · '+(figures.target.basis==='floor'?num(figures.floor,2)+' sq ft floor':num(figures.areaBeds,2)+' sq ft bed tops'),targetLb):null,figures.applied?row('Field applied'+(figures.applied.disputed?' (under review)':''),figures.applied.totals):null,
        figures.mixed?row('Mixed into tanks'+(figures.mixed.disputed?' (under review)':''),figures.mixed.totals):null));
  }
  function seasonSheet(id) {
    const f=seasonFigures(id), {garden:g,year,key,beds,areaBeds,floor}=f, target=f.target || {};
    const options=[...(floor>0?[['floor','Measured garden floor · '+num(floor,2)+' sq ft']]:[]),...(areaBeds>0?[['beds','Active bed tops · '+num(areaBeds,2)+' sq ft']]:[])];
    const basis=field('Rate basis',options.some(x=>x[0]===target.basis)?target.basis:options[0]?.[0],null,options);
    const labels=['N','P₂O₅','K₂O'], keys=['n','p','k'];
    const fs=keys.map((k,i)=>field(labels[i]+' target (lb/acre)',target[k],'number'));
    const totals=h('p.frame-figs',{role:'status'}), byBed=h('div');
    const read=()=>Object.fromEntries(keys.map((k,i)=>[k,fs[i].get()===''?null:W.number(fs[i].get(),'a nonnegative rate')]));
    const summary=(amounts)=>keys.map((k,i)=>labels[i]+' '+(amounts[k]==null?'unknown':num(amounts[k],3)+' lb')).join(' · ');
    function refresh() {
      const area=basis.get()==='floor'?floor:areaBeds;
      if(!area){totals.textContent='Add measured garden dimensions or a soil bed with an area.';return;}
      try {
        totals.textContent='Season target · '+summary(W.targetPounds(area,read()));
        byBed.replaceChildren(...(basis.get()==='beds'?beds.filter(b=>b.w*b.l>0).map(b=>note('Bed '+b.bed+' · '+summary(W.targetPounds(b.w*b.l,read())))):[]));
      } catch(ex){totals.textContent=ex.message;}
    }
    for(const f of [...fs,basis]) f.control.addEventListener('input',refresh); refresh();
    const perBed=h('details',h('summary','Per-bed targets'),byBed);
    const showBasis=()=>{perBed.hidden=basis.get()!=='beds';}; basis.control.addEventListener('input',showBasis);showBasis();
    sheet('Season fertility · '+g.name+' · '+year,[basis.el,line(fs.map(f=>f.el)),totals,perBed,
      f.applied||f.mixed?nutrientTable(f):note('No applications recorded for '+year+'.'),f.mixed?note('Delivery from tanks is unknown until verified at the garden.'):null],
      'Save targets',()=>{if(!basis.get())throw Error('The garden needs a measured floor or bed area.');return storeRow('targets',{id:key,gardenId:id,year,basis:basis.get(),...read()},'Season targets saved');});
  }
  function spreadForm(id) {
    const products=rows('products'); if(!products.length){productForm({},()=>spreadForm(id));return;}
    const pick=field('Product',products[0].id,null,opts(products)), weight=field('Fresh product applied (lb)','','number'), at=field('Applied at',local(),'datetime-local');
    const beds=App.state.plan.beds.filter(b=>b.gardenId===id && b.active!==false && App.state.engine.isSoilBed(b)).map(b=>[b,h('input',{type:'checkbox'})]);
    sheet('Record field application · '+gardenName(id),[pick.el,weight.el,at.el,h('details',h('summary','Treated beds'),note('Leave clear for the whole garden.'),beds.map(([b,c])=>h('label.wf-choice',c,String(b.bed||b.id))))],'Record application',()=>{
      const p=book().products[pick.get()], time=whenRecorded(at.get()), lb=W.number(weight.get(),'the weight applied',0.000001);
      const selected=beds.filter(([,c])=>c.checked).map(([b])=>b.id).sort();
      const job=JSON.stringify(['spread',id,time,p.id,selected]);
      if(W.groups(book(),'spread').some(g=>g.id===job))throw Error('An application for this product, time and area is already in history.');
      return report({id:App.uid(),job:W.nextJob(book(),job),kind:'spread',gardenId:id,at:time,entered:now(),label:p.name,beds:selected,items:{[p.id]:{name:p.name,lb,n:p.n,p:p.p,k:p.k}}},'Field application recorded');
    });
  }
  function gardenCard(id) {
    const g=gardens().find(v=>v.id===id); if(!g) return;
    const b=book(), tanks=rows('tanks',id), zones=rows('zones',id), mixes=W.groups(b,'refill').filter(x=>x.chosen.gardenId===id).reverse(), runs=W.groups(b,'run').filter(x=>x.chosen.gardenId===id).reverse(), labs=rows('labs',id);
    const measured=g.measuredSize, legacy=g.liquidFeedProfile;
    const details=(title,body,open=false)=>h('details.wf-section',{open},h('summary',title),body);
    sheet(g.name,[measured?.widthFt && measured?.lengthFt ? note(num(measured.widthFt)+' × '+num(measured.lengthFt)+' ft · '+num(measured.widthFt*measured.lengthFt)+' sq ft floor') : null,
      details('Equipment · '+tanks.length+' tanks, '+zones.length+' zones',[
        legacy?.enabled ? note('Saved feed profile · '+legacy.productName+' · '+num(legacy.ppmN)+' ppm N') : null,
        tanks.map(t=>line(h('b',t.name),num(t.gallons,2)+' gal',b.recipes?.[t.recipeId]?.name||'Recipe missing',
          t.ratio && b.recipes?.[t.recipeId] ? '1:'+num(t.ratio,2)+' · recipe contributes '+num(W.recipeConcentration(b,t.recipeId,t.ratio).n,1)+' ppm N (estimated)' : null,
          button('Edit tank',()=>setup(id,'tank',t),'wf-edit-tank'), W.reminder(b,t.id)?'Refill due':button('Request refill',()=>request(t),'wf-request'))),
        zones.map(z=>{
          const rate=W.zoneRate(z,App.state.plan.beds);
          return line(h('b',z.name),rate==null?'Flow unknown':num(rate,2)+' gal/min rated',button('Edit zone',()=>setup(id,'zone',z),'wf-edit-zone'),button('Record run',()=>runForm(z),'wf-run'));
        }),
        line(button('Add tank',()=>setup(id,'tank'),'wf-add-tank'),button('Add zone',()=>setup(id,'zone'),'wf-add-zone'))],true),
      details('Fertility history · '+mixes.length+' refills',[
        line(button('Season targets',()=>seasonSheet(id),'wf-targets'),button('Record field application',()=>spreadForm(id),'wf-spread')),
        ...W.groups(b,'spread').filter(x=>x.chosen.gardenId===id).reverse().map(x=>history(x,'spread')),
        ...(mixes.length?mixes.map(x=>history(x,'refill')):[note('No refills recorded.')])]),
      details('Irrigation history · '+runs.length,runs.length?runs.map(x=>history(x,'run')):note('No runs recorded.')),
      details('Soil and tissue · '+labs.length,[labs.map(l=>line(h('b',l.analyte+' '+l.value+' '+l.unit),l.kind+' · '+l.date+' · '+l.method+' · '+l.source,
        l.beds.length ? 'Sampled beds '+l.beds.map(bid=>App.state.plan.beds.find(b=>b.id===bid)?.bed||bid).join(', ') : 'Sampled beds unspecified')),button('Review lab result',()=>labForm(id),'wf-lab')])], 'Done');
  }
  function insidePeriod(r) {
    const whenLocal=local(new Date(r.at)).slice(0,10);
    if(period==='Season') return Number(whenLocal.slice(0,4))===App.planYear();
    const start=new Date(); start.setDate(start.getDate()-6);
    return whenLocal>=local(start).slice(0,10) && whenLocal<=local().slice(0,10);
  }
  function volumeLine(total) {
    const parts=[];
    if (total.metered != null) parts.push(num(total.metered,2)+' gal metered');
    if (total.estimated != null) parts.push(num(total.estimated,2)+' gal estimated');
    if (total.unknown) parts.push(total.unknown+' with gallons unknown');
    if (parts.length) return parts.join(' · ');
    return total.skipped ? '0 gal' : 'No run records';
  }
  function runLine(total) {
    return [total.started+' started', total.interrupted ? total.interrupted+' interrupted' : null,
      total.skipped ? total.skipped+' skipped' : null, total.disputed ? total.disputed+' disputed' : null,
      num(total.minutes,2)+(total.disputed?' confirmed min':' min')].filter(Boolean).join(' · ');
  }
  function weekChart(runs) {
    const days = Array.from({length:7},(_,index)=>{
      const date = new Date();
      date.setDate(date.getDate()-6+index);
      const records = runs.filter(g=>local(new Date(g.chosen.at)).slice(0,10)===local(date).slice(0,10));
      return {date, count:records.length, total:W.runSummary(records)};
    });
    const peak=Math.max(1,...days.map(day=>day.total.minutes));
    return h('figure.wf-chart',{ 'aria-label':'Irrigation minutes by day' },h('figcaption','Confirmed minutes · last 7 days'),
      h('div.wf-bars',days.map(({date,count,total})=>h('div', {title:date.toLocaleDateString()+' · '+(count?runLine(total):'No run logged')},
        h('b',total.started?num(total.minutes,1):total.skipped&&!total.disputed?'0':'—'),
        h('div.wf-track',h('i',{style:{height:(total.minutes/peak*100)+'%'}})),
        h('small',date.toLocaleDateString(undefined,{weekday:'short'})),
        total.skipped?h('small',total.skipped+' skipped'):null,total.disputed?h('small',total.disputed+' disputed'):null))));
  }
  function evidenceList(groups) {
    if (groups.length===1) { reconcile(groups[0],'run'); return; }
    sheet('Run evidence to review',groups.slice().reverse().map(group=>line(h('b',group.chosen.label),
      gardenName(group.chosen.gardenId),when(group.chosen.at),button('Review reports',()=>reconcile(group,'run'),'wf-review'))),'Done');
  }
  function irrigationGarden(g, zones, records) {
    const total=W.runSummary(records);
    return h('section.wf-garden',line(h('h3',g.name),button('Garden details',()=>gardenCard(g.id),'wf-garden')),
      records.length?note(volumeLine(total)+' · '+runLine(total)):note(zones.length?'No runs recorded in this period.':'No irrigation zones set up.'),
      zones.map(z=>{
        const latest=records.filter(group=>group.chosen.zoneId===z.id).at(-1), r=latest?.chosen;
        const last=r ? latest.workConflict?'Run details disputed':r.status+' · '+num(r.elapsed,2)+(latest.planned==null?'':' of '+num(latest.planned,2))+' min' : '';
        return line(h('strong',z.name),r?last+' · '+when(r.at):'No run in this period',button('Record run',()=>runForm(z),'wf-run'));
      }),line(button('Add zone',()=>setup(g.id,'zone'),'wf-add-zone')));
  }
  function fertilityGarden(g, tanks, mixes, dueByTank, selected) {
    const latest=mixes.at(-1), f=selected?seasonFigures(g.id):null;
    const area=f?.target?.basis==='floor'?f.floor:f?.areaBeds;
    const target=f?.target && area>0?W.targetPounds(area,f.target):null;
    return h('section.wf-garden',line(h('h3',g.name),button('Garden details',()=>gardenCard(g.id),'wf-garden')),
      latest?note('Last refill '+when(latest.chosen.at)):null,
      tanks.map(t=>line(h('strong',t.name),book().recipes?.[t.recipeId]?.name||'Recipe missing',
        dueByTank.has(t.id)?button('Refill due · Tasks',()=>App.setView('sow'),'wf-open-tasks'):button('Request refill',()=>request(t),'wf-request'))),
      f && (target||f.applied||f.mixed)?nutrientTable(f,target):null,
      f?.mixed?note('Tank delivery to the garden is unknown.'):null,
      line(button('Record field application',()=>spreadForm(g.id),'wf-spread'),button('Season targets',()=>seasonSheet(g.id),'wf-targets'),
        (selected||!tanks.length)?button('Add tank',()=>setup(g.id,'tank'),'wf-add-tank'):null));
  }
  function render() {
    if (!App.state.ready || App.state.view!=='water') return;
    const host=document.getElementById('wfWrap'), b=book(), all=gardens(), garden=all.find(g=>g.id===gardenId);
    if(!garden) gardenId='';
    const isWater=lens==='Irrigation', tanks=rows('tanks',gardenId), zones=rows('zones',gardenId);
    const dueByTank=new Set(tanks.filter(t=>W.reminder(b,t.id)).map(t=>t.id));
    const dueGardens=new Set(tanks.filter(t=>dueByTank.has(t.id)).map(t=>t.gardenId));
    const groups=W.groups(b,isWater?'run':'refill').filter(r=>!gardenId||r.chosen.gardenId===gardenId);
    const records=isWater?groups.filter(g=>insidePeriod(g.chosen)):groups, total=isWater?W.runSummary(records):null;
    const configured=new Set((isWater?zones:tanks).map(row=>row.gardenId));
    for (const group of groups) configured.add(group.chosen.gardenId);
    if(!isWater) {
      for(const table of ['labs','targets']) for(const row of rows(table)) configured.add(row.gardenId);
      for(const group of W.groups(b,'spread')) configured.add(group.chosen.gardenId);
    }
    const selected=garden?[garden]:all.filter(g=>configured.has(g.id));
    if(!garden && !isWater) selected.sort((a,b)=>Number(dueGardens.has(b.id))-Number(dueGardens.has(a.id)));
    const filter=field('Garden',gardenId,null,[['','All gardens'],...opts(all)]);
    filter.control.onchange=()=>{gardenId=filter.get();render();};
    const toggle=(label,items,value,change)=>h('div.seg',{role:'group','aria-label':label},items.map(item=>h('button',{type:'button','aria-pressed':String(item===value),onclick:()=>{change(item);render();}},item)));
    const content=[h('header.as-head.nu-head',h('h2',lens),UI.help(isWater?'Run time counts completed and interrupted work. Metered and estimated gallons are shown separately. Disputed time stays out of confirmed minutes.':'Record field applications and check season targets here. Tasks records a refill when the tank returns to service.',()=>host)),
      h('p.frame-figs',isWater ? [h('b',volumeLine(total)),records.length?' · '+runLine(total):''] :
        [h('b',dueByTank.size+' refills due'),' · '+tanks.length+(tanks.length===1?' tank':' tanks')]),
      line(toggle('Water dashboard',['Fertility','Irrigation'],lens,x=>{lens=x;}),filter.el,isWater?toggle('Period',['Last 7 days','Season'],period,x=>{period=x;}):button('Products and recipes',library,'wf-products')),
      total?.reviews.length?button('Review run evidence ('+total.reviews.length+')',()=>evidenceList(total.reviews),'wf-review'):null,
      isWater && period==='Last 7 days' && records.length?weekChart(records):null,
      selected.length?null:note(all.length ? isWater?'Choose a garden to add its first irrigation zone.':'Choose a garden to record a field application, set targets or add a feed tank.' : 'Add a garden on the Map to get started.'),
      ...selected.map(g=>{
        const own=records.filter(group=>group.chosen.gardenId===g.id);
        return isWater?irrigationGarden(g,zones.filter(z=>z.gardenId===g.id),own):
          fertilityGarden(g,tanks.filter(t=>t.gardenId===g.id),own,dueByTank,!!garden);
      })];
    host.replaceChildren(...content.filter(Boolean));
  }
  function init() { App.on('view',()=>{close();render();}); App.on('plan',render); }
  root.LRFWaterView={init,render,tasks,supplies,library,gardenCard};
})(window);
