/* Shared Water dashboards, garden equipment, refill cards and fertilizer stock. */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, W = root.LRFWaterFeed;
  const { h, num } = UI;
  let lastWateredGarden='', lens = 'Fertility', period = 'Today', fertilityView = 'Now', gardenId = '', activeDialog, refreshSheet;
  const book = () => App.state.plan?.lrfNext?.waterFeed || {};
  // Water and feed is shown where it is in use. A browser that has said neither way shows it once the plan holds a record of
  // it, so a device that takes such a plan in has the page without being told; the tick under the Map's "?" says otherwise,
  // either way, for this browser only. Off, nothing recorded is touched: the records stay in the plan and its backups.
  const KEY = 'lrf.water', TABLES = ['products','recipes','tanks','zones','requests','reports','receipts','targets','labs','soil','soilDays'];
  const hasRecords = () => TABLES.some(table => Object.keys(book()[table] || {}).length > 0);
  function on() {
    let said = null;
    try { said = root.localStorage.getItem(KEY); } catch (_) { /* a browser that keeps nothing: the plan decides */ }
    return said === '1' || (said !== '0' && hasRecords());
  }
  function turn(yes) {
    try { root.localStorage.setItem(KEY, yes ? '1' : '0'); } catch (_) { /* kept nowhere: the plan decides again at the next load */ }
    show();
    root.LRFPanels.redraw();   // a bed's panel carries a way into its garden's records
  }
  /** Put the page's ways in (its tab, Assumptions' button) where the switch stands, and leave the page when it goes off. */
  function show() {
    const yes = on();
    for (const el of [document.querySelector('[data-view-btn="water"]'), document.getElementById('wfAssumptions')]) if (el) el.hidden = !yes;
    document.body.classList.toggle('water-on', yes);
    if (!yes && App.state.view === 'water') { close(); App.setView(document.body.classList.contains('phone') ? 'sow' : 'map'); }
  }
  function tick() {
    const box = h('input', { type: 'checkbox', checked: on(), dataset: { hook: 'water-on' }, onchange: e => turn(e.target.checked) });
    return h('label.card-try', box, h('span', 'Fertilizer and irrigation records by garden: a Water page, refills on Tasks, fertilizer on Supplies. Kept in this browser only. Off, what was recorded stays in the plan.'));
  }
  const gardens = () => App.state.plan.gardens || [];
  const rows = (table, id) => W.values(book()[table]).filter(r => !id || r.gardenId === id);
  const button = (text, act, hook, primary) => h('button.btn' + (primary ? '.primary' : '.small'), { type: 'button', onclick: act, dataset: { hook } }, text);
  const line = (...children) => h('div.wf-line', children.flat(Infinity).map(c => typeof c === 'string' || typeof c === 'number' ? h('span',String(c)) : c));
  const note = text => h('p.wf-note', text);
  const bedNames = ids => ids.map(id => App.state.plan.beds.find(b => b.id === id)?.bed ?? id).join(', ');
  const duration = value => value==null?'Duration unknown':num(value,2)+' min';
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
  function close() { refreshSheet=null; if (activeDialog) { activeDialog.close(); activeDialog.remove(); activeDialog = null; } }
  function sheet(title, fields, action, submit, layout = '', dismiss=close, back=null) {
    close();
    const error = h('p.wf-error', { role: 'alert', hidden: true });
    const form = h('form.wf-form', { onsubmit: e => {
      e.preventDefault();
      try { const done = !submit || submit() !== false; if (done && activeDialog?.contains(form)) close(); }
      catch (ex) { error.textContent = ex.message; error.hidden = false; }
    } }, h('h2', title), fields, error, h('div.dialog-actions', back, submit ? button('Cancel', dismiss, 'wf-cancel') : null,
      h('button.btn.primary', { type: 'submit', dataset: { hook: 'wf-submit' } }, action)));
    form.addEventListener('input',()=>{error.hidden=true;});
    activeDialog = h('dialog.dialog.wf-sheet' + (layout ? '.' + layout : ''), { 'aria-label': title, oncancel: e => { e.preventDefault(); dismiss(); } }, form);
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
  function setUsual(b, tank, on) {
    const saved=b.constantFeed?.[tank.gardenId];
    if(!on && saved?.tankId!==tank.id) return b;
    if(on && !tank.ratio) throw Error('Enter the injector ratio to use constant feed.');
    const since=new Date(Math.floor(Date.now()/60000)*60000).toISOString();
    return {...b,constantFeed:{...b.constantFeed,[tank.gardenId]:{tankId:on?tank.id:'',since}}};
  }
  const constantLabel='Use constant feed for this garden';
  function constantChoice(check) {
    return h('label.wf-choice',check,constantLabel);
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
    const dilution = field('Injection ratio (optional)',old.ratio?'1:'+old.ratio:'');
    const flowPerHundred = field('Tape rating (gal/min per 100 ft)',old.tapeRate,'number'), lines=field('Tape lines per served bed',old.lines,'number');
    const rate = field('Rated flow (gal/min, optional)', old.tapeRate ? '' : old.rate, 'number');
    const controller=field('Hydrawise controller name',old.controller), station=field('Hunter station number',old.station,'number');
    const prior=book().constantFeed?.[id], usual=h('input',{type:'checkbox',checked:!!old.id && prior?.tankId===old.id});
    const beds = App.state.plan.beds.filter(b => b.gardenId === id && b.active !== false);
    const scope = beds.map(b => [b.id, h('input', { type: 'checkbox', checked: (old.beds || []).includes(b.id) })]);
    sheet((tank ? 'Feed tank' : 'Irrigation zone') + ' · ' + gardenName(id), [title.el, tank ? [recipe.el,size.el,dilution.el,constantChoice(usual)] : [rate.el,h('details',{open:old.tapeRate!=null},h('summary','Calculate flow from bed tape'),line(flowPerHundred.el,lines.el))],
      tank ? null : h('details',{open:!!old.controller},h('summary','Hunter controller and station'),line(controller.el,station.el)),
      h('details', h('summary','Served beds'), note('Leave clear if the served beds are unknown.'), scope.map(([bid,c],i) => h('label.wf-choice', c, String(beds[i].bed || bid))))], 'Save equipment', () => {
      const common = { id: old.id || App.uid(), gardenId: id, name: W.name(title.get(), 'an equipment name'), beds: scope.filter(([,c])=>c.checked).map(([bid])=>bid) };
      if (tank) {
        const b=book(), edited={ ...common, recipeId: recipe.get(), gallons: W.number(size.get(),'tank batch size',0.000001), ratio: dilution.get()===''?null:readRatio(dilution.get()) };
        if((old.id && JSON.stringify(b.tanks?.[old.id])!==JSON.stringify(old)) || JSON.stringify(b.constantFeed?.[id])!==JSON.stringify(prior)) throw Error('The garden setup changed. Reopen the injector to edit its current settings.');
        return save(setUsual(W.put(b,'tanks',edited),edited,usual.checked),'Tank saved');
      }
      const fromTape = flowPerHundred.get() !== '' || lines.get() !== '';
      if (fromTape && rate.get() !== '') throw Error('Choose one source for the zone flow: the total or the tape rating.');
      if (fromTape) W.tapeFlow(beds.filter(b=>common.beds.includes(b.id)),lines.get(),flowPerHundred.get());
      const flow = rate.get()==='' ? null : W.number(rate.get(),'rated flow',0.000001);
      const mapping=E.station(controller.get(),station.get());
      if(mapping.controller && rows('zones').some(z=>z.id!==common.id && z.controller?.toLowerCase()===mapping.controller.toLowerCase() && z.station===mapping.station)) throw Error('This controller and station already belong to another planner zone.');
      return storeRow('zones',{...common,...mapping,rate:flow,tapeRate:fromTape?Number(flowPerHundred.get()):null,lines:fromTape?Number(lines.get()):null},'Zone saved');
    });
  }
  function addInjector(initialGarden, afterSave, dismiss=close) {
    const garden=field('Garden for this injector',initialGarden || '',null,[['','Choose a garden'],...opts(gardens())]);
    garden.control.disabled=!!afterSave;
    const name=field('Injector name','Dosatron');
    const recipes=rows('recipes'), products=rows('products');
    const recipe=field('Fertilizer setup','ppm',null,[['ppm','Mix to a target ppm N'],['weight','Enter my stock mix by weight'],...recipes.map(r=>[r.id,'Use saved mix · '+r.name])]);
    const product=field('Fertilizer',products.length?'':'new',null,[['','Choose a fertilizer'],...opts(products),['new','Add a fertilizer from its label']]);
    const productName=field('Fertilizer name',''), bag=field('Bag weight (lb)','','number');
    const analysis=nutrients.map(([,label])=>field(label+' on label (%)','','number'));
    const pounds=field('Fertilizer in this batch (lb)','','number'), size=field('Final stock volume (gal)','5','number');
    const ppm=field('Target ppm N','','number'), ratio=field('Injection ratio','');
    const status=h('p.wf-result',{role:'status'}), served=h('div.wf-choice-list');
    const usual=h('input',{type:'checkbox'}), optionName=h('details.wf-section',h('summary','Injector name and served beds'),name.el,served);
    ratio.control.placeholder='e.g. 1:100';
    product.el.hidden=!products.length;
    const newProduct=h('div.wf-stack',productName.el,analysis[0].el,
      h('details.wf-section',h('summary','Other label nutrients and bag size'),line(analysis[1].el,analysis[2].el,bag.el)));
    const ingredients=h('div.wf-stack',product.el,newProduct);
    const recipeId=App.uid(), productId=App.uid(), tankId=App.uid();
    let shownMix, prior, scope=[];
    function update() {
      const mixed=recipe.get()==='ppm' || recipe.get()==='weight';
      ingredients.hidden=!mixed;
      newProduct.hidden=product.get()!=='new';
      ppm.el.hidden=recipe.get()!=='ppm'; pounds.el.hidden=recipe.get()!=='weight';
      try {
        const {next,tank}=draft();
        shownMix=JSON.stringify(W.snapshot(next,tank.recipeId,1));
        const n=W.recipeConcentration(next,tank.recipeId,tank.ratio).n;
        status.textContent='Mix '+amounts(W.snapshot(next,tank.recipeId,tank.gallons))+' to make '+num(tank.gallons,2)+' gal of stock · '+(n==null?'N unknown':num(n,1)+' ppm N at the emitter');
      } catch {shownMix=null;status.textContent='';}
    }
    function draft() {
      const id=garden.get(), label=W.name(name.get(),'an injector name');
      if(!gardens().some(g=>g.id===id)) throw Error('Choose the garden this injector serves.');
      if(rows('tanks',id).some(t=>t.name.toLowerCase()===label.toLowerCase())) throw Error('This garden already has equipment with that name. Choose another name.');
      const gallons=W.number(size.get(),'the final stock volume',0.000001);
      let next=book(), mix=next.recipes?.[recipe.get()];
      if(recipe.get()==='ppm' || recipe.get()==='weight') {
        let chosen=next.products?.[product.get()];
        if(product.get()==='new') {
          const [n,p,k]=analysis.map(f=>f.get());
          chosen=W.product(productId,{name:productName.get(),bag:bag.get(),n,p,k});
          next=W.put(next,'products',chosen);
        }
        if(!chosen) throw Error('Choose a fertilizer or add one from its label.');
        const weight=recipe.get()==='ppm'?W.stockWeight(ppm.get(),chosen.n,gallons,readRatio(ratio.get())):W.number(pounds.get(),'the pounds of fertilizer in this batch',0.000001);
        mix=W.recipe(recipeId,{name:chosen.name+' · '+(recipe.get()==='ppm'?num(Number(ppm.get()),1)+' ppm N at 1:'+num(readRatio(ratio.get()),2):num(weight,3)+' lb / '+num(gallons,2)+' gal'),gallons,items:{[chosen.id]:weight}},next);
        next=W.put(next,'recipes',mix);
      }
      if(!mix) throw Error('Choose or create the stock recipe.');
      const tank={id:tankId,name:label,gardenId:id,recipeId:mix.id,gallons,ratio:readRatio(ratio.get()),
        beds:scope.filter(([,check])=>check.checked).map(([key])=>key)};
      return {next:W.put(next,'tanks',tank),tank};
    }
    function selectGarden() {
      const id=garden.get(); prior=book().constantFeed?.[id];
      usual.checked=!!id && !prior?.tankId;
      const names=new Set(rows('tanks',id).map(t=>t.name.toLowerCase()));
      let n=1;
      while(names.has(n===1?'dosatron':'dosatron '+n)) n++;
      name.control.value=n===1?'Dosatron':'Dosatron '+n;
      scope=[];
      served.replaceChildren(...App.state.plan.beds.filter(b=>b.gardenId===id && b.active!==false).map(b=>{
        const check=h('input',{type:'checkbox'});scope.push([b.id,check]);return h('label.wf-choice',check,String(b.bed||b.id));
      }));
      update();
    }
    recipe.control.addEventListener('change',()=>{
      const selected=book().recipes?.[recipe.get()];
      if(selected) size.control.value=selected.gallons;
      update();
    });
    for(const f of [name,product,productName,bag,...analysis,ppm,pounds,size,ratio]) f.control.addEventListener('input',update);
    garden.control.addEventListener('change',selectGarden);
    selectGarden();
    sheet('Add Dosatron',[garden.el,recipe.el,ingredients,pounds.el,ppm.el,line(ratio.el,size.el),status,constantChoice(usual),optionName],
      'Save Dosatron',()=>{
        const {next,tank}=draft();
        if(JSON.stringify(book().constantFeed?.[tank.gardenId])!==JSON.stringify(prior)) throw Error('The constant feed setting changed. Select the garden again to review it.');
        if(shownMix!==JSON.stringify(W.snapshot(next,tank.recipeId,1))) {
          update();throw Error('The stock recipe changed. Check the updated mix before saving.');
        }
        if(!save(setUsual(next,tank,usual.checked),'Dosatron saved')) return false;
        if(afterSave) {afterSave(tank);return;}
        gardenId=tank.gardenId;render();
      },'wf-work-sheet',dismiss);
  }
  function readRatio(value) {
    return W.number(String(value).trim().replace(/^1\s*:\s*/,''),'the ratio shown on the injector dial (for example 1:100)',1);
  }
  function library() {
    const products = rows('products'), recipes = rows('recipes');
    sheet('Products and recipes', [
      board('Fertilizers', products.length, products.length ? h('div.wf-table-scroll',h('table.wf-grid-table',
        h('thead',h('tr',['Product','Bag',...nutrients.map(([,name])=>name),''].map(label=>h('th',{scope:'col'},label)))),
        h('tbody',products.map(p=>h('tr',h('th',{scope:'row'},p.name),h('td',p.bag?num(p.bag,2)+' lb':'—'),
          nutrients.map(([k])=>h('td',p[k]==null?'—':num(p[k],2)+'%')),h('td',button('Edit product',()=>productForm(p),'wf-edit-product'))))))):note('No fertilizers recorded.'),
        button('Add product',()=>productForm(),'wf-add-product')),
      board('Stock recipes', recipes.length, recipes.map(r=>h('div.wf-entry',h('strong',r.name),
        note(amounts(W.snapshot(book(),r.id,1))+' per gallon of stock'),note(num(r.gallons,2)+' gal batch · '+amounts(W.snapshot(book(),r.id,r.gallons))),
        button('Edit recipe',()=>recipeForm(r),'wf-edit-recipe'))),products.length?button('Add recipe',()=>recipeForm(),'wf-add-recipe'):note('Add a fertilizer to make a stock recipe.')),
      note('Tanks and zones belong to their garden.'),
      button('Open garden setup',()=>{close();lens='Fertility';fertilityView='Now';App.setView('water');render();},'wf-open-water')
    ], 'Done', null, 'wf-wide');
  }
  function stockForm(p,kind) {
    const delivery=kind==='delivery', bags=field('Full bags','','number'), loose=field(p.bag?'Loose pounds':'Total pounds','','number');
    const opened=new Date(), shownTime=local(opened);
    const time=field('Received at',shownTime,'datetime-local'), ref=field('Delivery or invoice line reference (optional)','');
    const result=note('');
    function input() {
      return {bags:bags.get(),loose:loose.get(),at:delivery?(time.get()===shownTime?opened.toISOString():whenRecorded(time.get())):now(),entered:now(),reference:delivery?ref.get():''};
    }
    function refresh() {
      try {const row=W.stockEntry(p,kind,input());result.textContent=(delivery?'Receiving ':'Shelf count ')+num(row.items[p.id].lb,3)+' lb';}
      catch {result.textContent='';}
    }
    for(const f of [bags,loose,time]) f.control.addEventListener('input',refresh);
    sheet((delivery?'Receive delivery':'Count shelf')+' · '+p.name,[
      note(p.bag?'Full bags weigh '+num(p.bag,3)+' lb each.':'Enter total pounds, or add a bag weight in Products and recipes.'),line(p.bag?bags.el:null,loose.el),result,
      delivery?[time.el,ref.el,note('Use a unique invoice and line reference. Two reports with the same reference can be reviewed together.')]:
        note('Count what is on the shelf now. This becomes the starting balance for later work.')],delivery?'Record delivery':'Save shelf count',()=>{
      const current=book();
      if(current.products?.[p.id]?.bag!==p.bag) throw Error('The bag weight changed. Reopen this form for the current weight.');
      const row=W.stockEntry(p,kind,{...input(),id:App.uid()});
      row.job=W.nextJob(current,row.job);
      const existing=W.groups(current,kind).find(g=>g.id===row.job);
      if(existing?.reports.some(r=>r.items[p.id].lb===row.items[p.id].lb && (!delivery || r.at.slice(0,16)===row.at.slice(0,16)))) throw Error('This entry is already in stock history.');
      if (!report(row,delivery?'Delivery recorded':'Shelf count saved')) return false;
      stockHistory(p);
    });
  }
  function balanceText(s) {
    if (s.balance==null) return 'Shelf count needed';
    if (s.balance<0) return num(s.balance,2)+' lb calculated · recount needed';
    return num(s.balance,2)+' lb '+(s.uncertain||s.review?'provisional':'on hand');
  }
  const movementName={count:'Shelf count',delivery:'Delivery',legacy:'Stock added',refill:'Tank refill',spread:'Field application'};
  function stockHistory(p) {
    const inventory=W.stock(book(),p.id);
    sheet('Stock history · '+p.name,[h('strong',balanceText(inventory)),
      inventory.timing?note('A movement overlaps the shelf count. Review its recorded time or count the shelf again.'):
        inventory.review?note('Reports disagree. Open the movement to review the figures.'):null,
      inventory.uncertain?note('A fresh quantity is unknown. A new shelf count can establish the current balance.'):null,
      line(button('Receive delivery',()=>stockForm(p,'delivery'),'wf-delivery'),button('Count shelf',()=>stockForm(p,'count'),'wf-count')),
      inventory.rows.length ? inventory.rows.slice().reverse().map(r=>{
        const debit=r.kind==='spread'||r.kind==='refill', chosen=r.group?.chosen;
        const change=r.lb==null?'Fresh weight unknown':(r.kind==='count'?'Counted ':debit?'−':'+')+num(r.lb,3)+' lb';
        return h('details.wf-history',h('summary',h('b',movementName[r.kind]),' · '+when(r.at)+' · '+change),
          chosen?.gardenId?note(gardenName(chosen.gardenId)+' · '+chosen.label):null,
          chosen?.bagLb!=null?note(num(chosen.bags)+' × '+num(chosen.bagLb,3)+' lb bags + '+num(chosen.loose,3)+' lb loose'):null,
          chosen?.reference?note(chosen.reference):null,
          note('Balance after entry · '+balanceText({balance:r.balance,review:r.provisional})),
          r.group?line(r.group.reports.length>1?button('Review reports',()=>reconcile(r.group,r.kind),'wf-review'):null,
            button('Take back entry',()=>sheet('Take back '+movementName[r.kind].toLowerCase()+'?',[note('Its effect on stock will be reversed.')],'Take back',()=>takeBack(r.group)),'wf-take-back')):null);
      }) : note('No stock movements yet.')], 'Done');
  }
  function orderSheet() {
    const products=rows('products'), b=book(), tanks=rows('tanks');
    const batches=tanks.map(t=>({tank:t, count:field(gardenName(t.gardenId)+' · '+t.name+' (remaining full batches)',W.reminder(b,t.id)?1:0,'number')}));
    const fieldPounds=products.map(p=>field(p.name+' (field lb)',0,'number'));
    const spare=field('Spare product (%)',10,'number'), output=h('div',{role:'status'});
    const capturedInputs=()=>JSON.stringify([book().products,book().recipes,book().tanks]);
    const snapshot=capturedInputs();
    function figures() {
      if(snapshot!==capturedInputs()) throw Error('Equipment, products or recipes changed. Reopen the worksheet.');
      const need=Object.fromEntries(products.map((p,i)=>[p.id,W.number(fieldPounds[i].get()||0,'planned field pounds')]));
      for(const {tank,count} of batches) {
        const n=W.number(count.get()||0,'remaining full batches');
        if(!Number.isSafeInteger(n)) throw Error('Enter whole batches.');
        if(!n) continue;
        const mix=W.snapshot(b,tank.recipeId,tank.gallons);
        for(const [id,item] of Object.entries(mix)) need[id]+=n*item.lb;
      }
      const accepted=W.stockGroups(book());
      return products.map(p=>{
        const shelf=W.stock(book(),p.id,accepted);
        return {product:p,shelf,need:need[p.id],...W.purchase(p,shelf,need[p.id],spare.get())};
      }).filter(row=>row.need>0);
    }
    function resultText(row) {
      return row.bags==null?(row.short==null?'Check shelf balance':num(row.short,3)+' lb to buy · bag weight unknown'):row.bags===0?'Covered by stock':row.bags+(row.bags===1?' bag':' bags')+' × '+num(row.product.bag,3)+' lb';
    }
    function refresh() {
      try {
        const orders=figures();
        output.replaceChildren(...(orders.length?orders.map(row=>h('section.wf-task',h('strong',row.product.name+' · '+resultText(row)),
          note(num(row.need,3)+' lb planned · '+num(row.gross,3)+' lb including spare · '+balanceText(row.shelf)))):
          [note('Enter remaining batches or field pounds to calculate an order.')]));
      } catch(ex){output.textContent=ex.message;}
    }
    function download() {
      try {
        const orders=figures();
        if(!orders.length) throw Error('Enter remaining work before downloading.');
        const title='Fertilizer order worksheet · '+App.planYear(), prepared=new Date().toLocaleDateString();
        const batchesPlanned=batches.filter(row=>Number(row.count.get())>0).map(({tank,count})=>
          gardenName(tank.gardenId)+' · '+tank.name+' · '+count.get()+' batch(es) × '+num(tank.gallons,3)+' gal · '+b.recipes[tank.recipeId].name);
        const fieldPlanned=products.flatMap((p,i)=>Number(fieldPounds[i].get())>0?[p.name+' · '+num(Number(fieldPounds[i].get()),3)+' lb']:[]);
        const lines=[title,'Prepared '+prepared+' · '+spare.get()+'% spare','', 'Remaining tank batches',...(batchesPlanned.length?batchesPlanned:['None']),
          '', 'Remaining field applications',...(fieldPlanned.length?fieldPlanned:['None']),'','Shopping list',...orders.map(row=>row.product.name+' · '+resultText(row)+' · '+num(row.need,3)+' lb planned · '+num(row.gross,3)+' lb with spare · '+balanceText(row.shelf))];
        const url=URL.createObjectURL(new Blob([lines.join('\n')+'\n'],{type:'text/plain;charset=utf-8'}));
        const link=h('a',{href:url,download:'fertilizer-order-'+App.planYear()+'.txt'});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      } catch(ex){output.textContent=ex.message;}
    }
    for(const f of [spare,...fieldPounds,...batches.map(row=>row.count)]) f.control.addEventListener('input',refresh);
    refresh();
    sheet('Plan fertilizer order · '+App.planYear(),[note('Estimate the work still ahead. One batch is filled in for each refill currently due. Download the list to keep these figures.'),
      batches.length?h('details',{open:true},h('summary','Remaining tank batches'),batches.map(row=>row.count.el)):null,
      h('details',{open:!batches.length},h('summary','Remaining field applications'),fieldPounds.map(f=>f.el)),spare.el,output,
      button('Download order list',download,'wf-download-order')], 'Done');
    refreshSheet=refresh;
  }
  function supplies() {
    if (!on()) return null;
    const products=rows('products'), b=book(), accepted=W.stockGroups(b);
    const due={};
    for(const t of rows('tanks')) {
      if(!W.reminder(b,t.id) || !b.recipes?.[t.recipeId]) continue;
      for(const [id,item] of Object.entries(W.snapshot(b,t.recipeId,t.gallons))) due[id]=(due[id] || 0)+item.lb;
    }
    return h('section.wf-block',h('h3',{id:'wfSuppliesHeading',tabIndex:-1},'Fertilizer supplies'),products.map(p=>{
      const s=W.stock(b,p.id,accepted), dueBags=due[p.id]?W.purchase(p,s,due[p.id],0).bags:null;
      return line(h('strong',p.name),balanceText(s),num(s.used,2)+' lb recorded use',due[p.id]?num(due[p.id],3)+' lb for due refills'+(dueBags==null?'':dueBags?' · buy '+dueBags+(dueBags===1?' bag':' bags'):' · covered'):null,button('Stock history',()=>stockHistory(p),'wf-stock-history'));
    }),line(products.length?button('Plan fertilizer order',orderSheet,'wf-order'):null,button('Products and recipes',library,'wf-products')));
  }
  function openSupplies() {
    App.setView('trays');
    root.LRFTraysView.setTab('supplies');
    requestAnimationFrame(()=>{
      const heading=document.getElementById('wfSuppliesHeading');
      if (heading) {heading.focus({preventScroll:true});heading.scrollIntoView({block:'start'});}
    });
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
  function openRefill(id) {
    close(); App.setView('sow');
    requestAnimationFrame(()=>{
      const card=document.getElementById('wf-refill-'+id);
      if(card) {card.focus({preventScroll:true});card.scrollIntoView({block:'center'});}
    });
  }
  function tasks() {
    const phone=document.body.classList.contains('phone'), tanks=rows('tanks');
    if (!on() || (!tanks.length && !phone)) return null;
    const b=book(), due=tanks.filter(t=>W.reminder(b,t.id));
    const cards=due.map(t=>{
      const task=W.reminder(b,t.id), items=approved(t), job=W.cycle(b,t.id);
      const finish=button('Refilled as shown',()=>{try{recordMix(t,task,{job,itemsShown:items});}catch(ex){UI.toast(ex.message);}},'wf-complete',true);
      finish.prepend(h('span.wf-tick',{'aria-hidden':'true'},'✓'));
      return h('article.wf-task.wf-refill-card',{id:'wf-refill-'+t.id,tabIndex:-1},h('h4','Refill '+t.name+' · '+gardenName(t.gardenId)),note(task.reason),
        items ? [h('div.wf-weights',Object.values(items).map(item=>h('p',h('strong',num(item.lb,3)+' lb'),' '+item.name))),note(b.recipes[t.recipeId].name+' · '+num(t.gallons,2)+' gal batch'),
          line(finish,button('Actual amounts…',()=>mixDetails(t),'wf-actual'))] : note('Choose a stock recipe for this tank.'));
    });
    return h('section.wf-block',{dataset:{hook:'wf-tasks'}},h('h3','Water and feed'),due.length ? cards : tanks.length?note('Nothing due'):null,
      tanks.map(t=>{const last=W.lastMix(b,t.id);return line(t.name, last?'Last refill '+when(last.chosen.at):'No refill recorded',!W.reminder(b,t.id) && approved(t) ? button('Refill',()=>mixDetails(t),'wf-refill') : null);}),
      phone && gardens().length?button('Record watering',()=>runForm(null,''),'wf-phone-run'):null,
      phone?button('Irrigation and soil readings',()=>{lens='Irrigation';root.LRFSowView.openWater();},'wf-phone-soil'):null);
  }
  const E = root.LRFEquipment;
  const nativeLink = () => h('a.btn.small',{href:'https://app.hydrawise.com/',target:'_blank',rel:'noopener noreferrer'},'Open Hydrawise');
  const stationText = z => z?.controller ? z.controller+' · station '+z.station : '';
  const activeSoil = (table='soil') => rows(table).filter(r=>!book().voids?.[r.id]);
  const stale = at => Date.now()-Date.parse(at)>15*60000;
  const soilLabel = r => E.metrics[r.kind]+' '+num(r.value,r.kind==='ec'?3:1)+' '+r.unit;
  function attachMeter(group) {
    const r = group.chosen;
    const clock=field('Controller on Hunter report',r.controller || book().zones?.[r.zoneId]?.controller);
    const slot=field('Station on report',r.station || book().zones?.[r.zoneId]?.station,'number');
    const volume=field('Measured run volume','','number'), unit=field('Volume unit','US gal',null,[['US gal','US gallons'],['L','Litres']]);
    const confirm=h('input',{type:'checkbox'});
    sheet('Attach Hunter meter reading',[h('strong',gardenName(r.gardenId)+' · '+r.label),note(when(r.at)+' · '+duration(group.elapsed ?? r.elapsed)+' · '+r.status),
      nativeLink(),line(clock.el,slot.el),line(volume.el,unit.el),
      h('label.wf-choice',confirm,'I matched this zone and start time to a single run volume in Hydrawise.'),
      note('A daily meter total can cover several runs. A flow rate in gal/min is a different measurement.')],'Attach reading',()=>{
      const live=W.groups(book(),'run').find(g=>g.id===group.id);
      if (!live || live.workConflict || live.chosen.id!==r.id || live.chosen.status==='Skipped') throw Error('This run changed. Reopen it and review its evidence first.');
      const mapping=E.station(clock.get(),slot.get()), meter=E.measured(volume.get(),unit.get());
      if (!mapping.controller || !confirm.checked) throw Error('Confirm the controller, station and matching run before attaching the reading.');
      if (!r.controller && rows('zones').some(z=>z.id!==r.zoneId && z.controller?.toLowerCase()===mapping.controller.toLowerCase() && z.station===mapping.station)) throw Error('This station belongs to a different planner zone. Verify the recorded run and the station assignments.');
      if (r.controller && (r.controller.toLowerCase()!==mapping.controller.toLowerCase() || r.station!==mapping.station)) throw Error('The report must match the controller and station recorded on this run.');
      if (live.reports.some(x=>x.source==='Hunter flow report' && x.controller?.toLowerCase()===mapping.controller.toLowerCase() && x.station===mapping.station && Math.abs(x.meter-meter)<1e-8)) throw Error('This Hunter reading is already attached.');
      const evidence={...r,...mapping,id:App.uid(),job:group.id,entered:now(),meter,source:'Hunter flow report',reference:volume.get()+' '+unit.get()};
      delete evidence.feed;
      return report(evidence,'Hunter reading attached');
    });
  }
  const soilDayLine=(kind,v)=>E.metrics[kind]+' · '+num(v[0],3)+'–'+num(v[1],3)+' '+({soilmoisture:'%',ec:'mS/cm',temperature:'°F'})[kind]+' · '+v[4]+' readings · latest '+num(v[2],3)+' at '+when(v[3]*1000);
  const probeName=r=>r.gateway+' · '+(r.channel.startsWith('soil_moisture_ec_')?'WH52':'Moisture probe')+' · channel '+r.channel.split('ch').at(-1);
  function soilDays(id) {
    const data=activeSoil('soilDays'), own=data.filter(r=>r.gardenId===id).sort((a,b)=>b.date.localeCompare(a.date));
    if (!own.length) return null;
    return h('details.wf-section',h('summary','Daily soil summaries · '+own.length),own.map(r=>h('details.wf-history',
      h('summary',r.date+' UTC · '+probeName(r)),
      data.some(other=>other.id!==r.id && other.channel===r.channel && other.date===r.date && other.gateway.toLowerCase()===r.gateway.toLowerCase())?note('Conflicting day summaries. Review the source archive and remove the incorrect entry.'):null,
      Object.entries(r.summary).map(([kind,v])=>note(soilDayLine(kind,v))),
      button('Remove summary',()=>sheet('Remove daily summary?',[note(probeName(r)+' · '+r.date+' UTC')],'Remove summary',()=>{
        const b=book();return save({...b,voids:{...b.voids,[r.id]:true}},'Daily summary removed');
      }),'wf-soil-day-remove'))));
  }
  function soilImport(id) {
    const upload=h('input.field',{type:'file',accept:'.json,application/json','aria-label':'Ecowitt snapshot JSON'});
    const gateway=field('Gateway name',''), choice=field('Probe channel','',null,[]);
    const preview=h('div',{'aria-live':'polite'}), status=note('Choose an Ecowitt V3 real-time snapshot or a daily archive from the local reader.');
    let probes=[], payload=null, sequence=0;
    const submitLabel=()=>{const el=preview.closest('form')?.querySelector('button[type=submit]');if(el) el.textContent=payload?.format==='ecowitt-soil-day-v1'?'Save daily summary':'Save channel to garden';};
    function draw() {
      const p=probes.find(item=>item.key===choice.get());
      preview.replaceChildren(...(!p?[]:[
        ...(p.day?[note('Daily range · '+p.day.date+' UTC'),...Object.entries(p.day.summary).map(([k,v])=>note(soilDayLine(k,v))),
        note(p.day.date>=new Date().toISOString().slice(0,10)?'Collection is still in progress. Review today and save the summary after the UTC day closes.':'Only this one daily summary is saved. The full samples stay in the archive.')]:[]),
        ...(p.day?[]:p.readings).map(r=>note(soilLabel(r)+' · '+when(r.at)+(stale(r.at)?' · Over 15 minutes old':''))),
        ...(p.missing.length?[note('Unavailable or invalid · '+p.missing.join(', '))]:[])]));
    }
    async function read(get) {
      const seq=++sequence;
      probes=[]; payload=null; choice.control.replaceChildren(); draw(); gateway.control.value='';
      submitLabel(); status.textContent='Reading snapshot…';
      try {
        const imported=await get();
        if (seq!==sequence || !preview.isConnected) return;
        const parsed=E.readFile(imported);
        probes=parsed; payload=imported; gateway.control.value=imported.gateway ? E.gatewayName(imported.gateway) : '';
        choice.control.replaceChildren(h('option',{value:''},'Choose the installed channel'),...parsed.map(p=>h('option',{value:p.key},p.label)));
        status.textContent='Match a channel to its installed location in '+gardenName(id)+'.'; submitLabel(); draw();
      } catch (ex) { if (seq===sequence) {probes=[];payload=null;status.textContent=ex.message;} }
    }
    upload.onchange=()=>read(async()=>{
      const f=upload.files[0];
      if (!f || f.size>4*1024*1024) throw Error('Choose a real-time snapshot or daily soil archive under 4 MB.');
      try { return JSON.parse(await f.text()); } catch { throw Error('The selected file is not readable JSON.'); }
    });
    const localReader=location.origin==='http://127.0.0.1:8741';
    const refresh=()=>read(async()=>{
      const res=await fetch('/equipment-api/soil',{method:'POST',headers:{'content-type':'application/json','x-lrf-reader':'1'},body:'{}',signal:AbortSignal.timeout(16000)});
      const body=await res.json();
      if (!res.ok) throw Error(body.error || 'The local reader could not reach Ecowitt.');
      return body;
    });
    function download() {
      if (!payload || !probes.length) throw Error('Read a snapshot first.');
      const name=E.gatewayName(gateway.get()), data={};
      if (payload.format==='ecowitt-soil-day-v1') throw Error('This daily archive is already a portable file.');
      for (const p of probes) {
        data[p.key]={};
        for (const r of p.readings) data[p.key][r.kind]={value:r.value,unit:r.unit,time:Date.parse(r.at)/1000};
      }
      const url=URL.createObjectURL(new Blob([JSON.stringify({code:0,gateway:name,data})],{type:'application/json'}));
      const link=h('a',{href:url,download:'Ecowitt-soil-'+local().replace(/:/g,'-')+'.json'}); link.click(); setTimeout(()=>URL.revokeObjectURL(url),30000);
    }
    choice.control.onchange=draw;
    sheet('Ecowitt soil readings · '+gardenName(id),[localReader?button('Read gateway now',refresh,'wf-probe-read',true):null,
      h('label.wf-field','Import soil snapshot',upload),status,gateway.el,choice.el,preview,
      localReader?button('Download soil snapshot',()=>{try {download();} catch(ex) {status.textContent=ex.message;}},'wf-soil-export'):null],
      'Save channel to garden',()=>{
        const p=probes.find(item=>item.key===choice.get());
        if (!p?.readings.length) throw Error('Choose a channel with at least one timestamped reading.');
        const b=book();
        if (p.day) {
          if (p.day.date>=new Date().toISOString().slice(0,10)) throw Error('Save the daily summary after this UTC day closes.');
          const row=E.dayRecord(activeSoil('soilDays'),gateway.get(),p,id);
          if (b.voids?.[row.id]) throw Error('This summary was previously removed.');
          const next=W.put(b,'soilDays',row);
          return save(next,'Daily soil summary saved',{...next,voids:{...b.voids,[row.id]:true}});
        }
        const add=E.candidates(activeSoil(),gateway.get(),p,id).filter(row=>!b.voids?.[row.id]);
        if (!add.length) throw Error('These readings were already saved or removed for this garden.');
        const soil={...b.soil};
        for (const row of add) soil[row.id]=row;
        const undone={...b,soil,voids:{...b.voids,...Object.fromEntries(add.map(r=>[r.id,true]))}};
        return save({...b,soil},'Soil readings saved',undone);
      });
  }
  function soilHistory(id) {
    const data=activeSoil(), all=data.filter(r=>r.gardenId===id).sort((a,b)=>b.at.localeCompare(a.at));
    if (!all.length) return null;
    const byKey=new Map(), latest=new Map();
    for (const r of data) {
      const key=E.identity(r.gateway,r.channel,r);
      byKey.set(key,(byKey.get(key)||0)+1);
    }
    function observation(r) {
      const key=E.identity(r.gateway,r.channel,r);
      const conflict=byKey.get(key)>1;
      return line(h('b',conflict?'Conflicting probe reports':soilLabel(r)), conflict?soilLabel(r):null,when(r.at),stale(r.at)?'Over 15 minutes old':null);
    }
    for (const r of all) {
      const key=JSON.stringify([r.gateway.toLowerCase(),r.channel,r.kind]);
      if (!latest.has(key)) latest.set(key,r);
    }
    return h('details.wf-section',h('summary','Soil readings · '+all.length),
      [...latest.values()].map(r=>line(probeName(r),observation(r))),
      button('Reading history',()=>sheet('Probe history · '+gardenName(id),all.map(r=>h('section.wf-task',
        h('strong',probeName(r)),observation(r),button('Remove reading',()=>sheet('Remove this reading?',[note(probeName(r)+' · '+soilLabel(r)+' · '+when(r.at))],'Remove reading',()=>{
          const b=book();return save({...b,voids:{...b.voids,[r.id]:true}},'Probe reading removed');
        }),'wf-soil-remove'))),'Done'),'wf-soil-history'));
  }
  function runForm(initialZone, initialGarden=initialZone?.gardenId || gardenId) {
    const last=lastWateredGarden || W.groups(book(),'run').at(-1)?.chosen.gardenId;
    const start=initialGarden || gardens().find(g=>g.id===last)?.id || (gardens().length===1?gardens()[0].id:'');
    const garden=field('Garden watered',start,null,[['','Choose a garden'],...opts(gardens())]);
    const zone=field('Irrigation zone','',null,[]), injector=field('Fertilizer used','',null,[]);
    const stockRecipe=field('Stock recipe used','',null,[]);
    const portion=field('When was the injector on?','whole',null,[['whole','Entire watering'],['part','Part of the watering']]);
    const ratio=field('Ratio used',''), treated=field('Gallons with fertilizer','','number');
    const openedAt=local();
    const at=field('Run started at',openedAt,'datetime-local'), elapsed=field('Actual minutes','','number'), meter=field('Metered gallons','','number');
    const planned=field('Planned minutes (optional)','','number');
    const status=field('Run status','Completed',null,['Completed','Interrupted','Skipped'].map(x=>[x,x]));
    const source=field('Evidence','Grower observation',null,['Grower observation','Controller record'].map(x=>[x,x]));
    const useRate=h('input',{type:'checkbox'}), rateText=h('span'), rateChoice=h('label.wf-choice',useRate,rateText);
    const preview=h('p.wf-result',{role:'status'}), mixInfo=note('');
    let waterArea=null;
    const sameJob=h('input',{type:'checkbox'}), sameTime=note('');
    const collision=h('div.wf-stack',{hidden:true},sameTime,h('label.wf-choice',sameJob,'Add another report to this same watering'));
    let collisionJob='';
    const partial=h('div.wf-stack',treated.el,note('Leave the fertilized gallons blank if unknown.'));
    const feedFields=h('div.wf-stack',stockRecipe.el,mixInfo,line(ratio.el,portion.el),partial);
    const feedSummary=h('strong'), editFeed=h('details.wf-section',h('summary','Change feed for this watering'));
    const timeMethod=h('details.wf-section',h('summary','Use actual minutes'),elapsed.el,rateChoice);
    let shownTank=null, shownStock=null, shownZone=null, automatic=false, prefAtOpen, forThisRun=false;
    const add=button('Add Dosatron',()=>{
      if(!garden.get()) {garden.control.focus();return;}
      addInjector(garden.get(),tank=>{garden.control.value=tank.gardenId;loadChoices(zone.get(),tank.id);show();},show);
    },'wf-inline-injector');
    editFeed.append(injector.el,feedFields,add);
    const feedSection=h('div.wf-stack',feedSummary,editFeed);
    function usual() {
      if(at.get()!==openedAt || at.get().slice(0,10)!==local().slice(0,10)) return null;
      return W.usualInjector(book(),garden.get(),shownZone,at.get());
    }
    function useDefault() {
      const t=usual();
      automatic=!!t;forThisRun=false;
      prefAtOpen=book().constantFeed?.[garden.get()];
      injector.control.value=t?.id || '';
      portion.control.value='whole';treated.control.value='';
      editFeed.open=false;
      selectTank();
    }
    function options(f,entries,selected) {
      f.control.replaceChildren(...entries.map(([value,label])=>h('option',{value},label)));
      f.control.value=selected;
    }
    function loadChoices(zoneId,tankId) {
      waterArea=garden.get()?acreBasis(seasonFigures(garden.get())):null;
      const zones=garden.get()?rows('zones',garden.get()):[], tanks=garden.get()?rows('tanks',garden.get()):[];
      const general={id:JSON.stringify(['garden watering',garden.get()]),name:'Garden watering',gardenId:garden.get(),beds:[]};
      const own=zones.filter(z=>z.id!==general.id);
      options(zone,[['','Choose a zone'],...opts(own),[general.id,'Garden watering · no specific zone']],
        zones.some(z=>z.id===zoneId) || zoneId===general.id?zoneId:(own.length===1?own[0].id:own.length && !book().constantFeed?.[garden.get()]?.tankId?'':general.id));
      options(injector,[['','Unspecified'],['plain','Water only'],...tanks.map(t=>[t.id,t.name+' · '+(book().recipes?.[t.recipeId]?.name || 'Recipe missing')])],tankId || '');
      zone.el.hidden=!garden.get() || (!own.length && !initialZone);
      feedSection.hidden=!garden.get();
      function selectZone(keepOverride=false) {
        shownZone=zones.find(z=>z.id===zone.get()) || (zone.get()===general.id?general:null);
        const rate=shownZone && W.zoneRate(shownZone,App.state.plan.beds);
        useRate.checked=rate!=null; rateChoice.hidden=rate==null;
        rateText.textContent=rate==null?'':'Use '+num(rate,3)+' gal/min to estimate unmetered water for this run';
        if(keepOverride && forThisRun) refresh();else useDefault();
      }
      zone.control.onchange=()=>selectZone(true);
      selectZone();
      if(tankId && injector.get()!==tankId) {
        injector.control.value=tankId;automatic=false;forThisRun=true;selectTank();
      }
    }
    function selectTank() {
      shownTank=book().tanks?.[injector.get()] || null;
      const mixes=rows('recipes');
      options(stockRecipe,opts(mixes),shownTank?.recipeId || '');
      stockRecipe.el.hidden=mixes.length<=1;
      ratio.control.value=shownTank?.ratio?'1:'+shownTank.ratio:'';
      feedFields.hidden=!shownTank;
      add.hidden=!!shownTank;
      readStock();
    }
    function readStock() {
      shownStock=shownTank && book().recipes?.[stockRecipe.get()]?W.snapshot(book(),stockRecipe.get(),1):null;
      mixInfo.textContent=shownStock?'Confirm the mix and dial used during this watering. Stock per gallon · '+amounts(shownStock):'';
      refresh();
    }
    function record() {
      if(!garden.get() || !gardens().some(g=>g.id===garden.get())) throw Error('Choose the garden you watered.');
      if(!shownZone) throw Error('Choose a zone or select garden watering.');
      const rate=W.zoneRate(shownZone,App.state.plan.beds);
      const r=W.run({...shownZone,rate:useRate.checked?rate:null},{id:'',at:whenRecorded(at.get()),elapsed:elapsed.get(),meter:meter.get(),planned:planned.get(),status:status.get(),source:source.get()});
      if(automatic && status.get()!=='Skipped' && (usual()?.id!==shownTank?.id ||
          JSON.stringify(book().constantFeed?.[garden.get()])!==JSON.stringify(prefAtOpen))) throw Error('Constant feed changed. Open the feed options and choose what ran.');
      if(status.get()!=='Skipped' && injector.get()) {
        if(shownTank && (!shownStock || JSON.stringify(book().tanks?.[shownTank.id])!==JSON.stringify(shownTank) ||
            JSON.stringify(W.snapshot(book(),stockRecipe.get(),1))!==JSON.stringify(shownStock))) throw Error('The mix changed. Select the injector again to confirm it.');
        r.feed=injector.get()==='plain'?W.injectedFeed(null,null,'plain'):W.injectedFeed(book(),{...shownTank,recipeId:stockRecipe.get()},portion.get(),readRatio(ratio.get()),treated.get());
        const volume=W.water({chosen:r,reports:[r]});
        if(r.feed.mode==='part' && volume.gallons!=null && r.feed.treated>volume.gallons) throw Error('Gallons with fertilizer exceed the total water applied.');
      }
      return r;
    }
    function refresh() {
      partial.hidden=portion.get()!=='part';
      const feedName=shownStock?Object.values(shownStock).map(p=>p.name).join(' + '):'';
      let setting='';
      if(shownTank && shownStock && ratio.get()) {
        try {
          const dial=readRatio(ratio.get());
          const n=W.stockConcentration(shownStock,dial).n;
          setting=feedName+' · 1:'+num(dial,2)+(n==null?'':' · '+num(n,1)+' ppm N');
        } catch {setting=feedName;}
      }
      feedSummary.textContent=shownTank?(automatic?'Constant feed · ':'')+(setting || shownTank.name)+(portion.get()==='part'?' · partial':''):injector.get()==='plain'?'Water only':'';
      feedSummary.hidden=!feedSummary.textContent;
      editFeed.querySelector('summary').textContent=automatic || forThisRun?'Change feed for this watering':('Fertilizer'+(book().constantFeed?.[garden.get()]?.tankId?' · choose what ran':' (optional)'));
      feedSection.hidden=!garden.get() || status.get()==='Skipped';
      collision.hidden=true;
      try {
        const row=record(), group={chosen:row,reports:[row]}, volume=W.water(group);
        const job=W.nextJob(book(),row.job);
        if(job!==collisionJob) {sameJob.checked=false;collisionJob=job;}
        collision.hidden=!rows('reports',garden.get()).some(r=>r.kind==='run' && r.job===job && !book().voids?.[r.id]);
        if(!collision.hidden) sameTime.textContent='A watering here already starts at '+when(row.at)+'. For a separate watering, change the start time below.';
        const delivery=W.feedDelivery(group);
        const estimate=delivery?.totals?.n;
        preview.textContent=[volume.gallons==null?'Gallons unknown':num(volume.gallons,2)+' gal · '+volume.basis,
          estimate!=null?num(estimate,4)+' lb N estimated'+(waterArea?.area>0?' · '+num(estimate*43560/waterArea.area,2)+' lb N/acre over '+waterArea.label:''):deliveryLine(delivery)].filter(Boolean).join(' · ');
      } catch(error) {preview.textContent=meter.get() || elapsed.get()?error.message:'Enter metered gallons, actual minutes, or both.';}
    }
    function show() {
      sheet('Record watering',[garden.el,zone.el,h('fieldset.wf-group',h('legend','Water applied'),meter.el,timeMethod),feedSection,collision,
        h('details.wf-section',h('summary','Time, status and controller details'),at.el,line(status.el,planned.el),source.el),preview],'Save watering',()=>{
        const row=record(), b=book(), z=b.zones?.[shownZone.id];
        if(shownZone.id!==JSON.stringify(['garden watering',garden.get()]) && JSON.stringify(z)!==JSON.stringify(shownZone)) throw Error('The zone changed. Choose the zone again before saving.');
        row.id=App.uid();row.entered=now();row.job=W.nextJob(b,row.job);
        Object.assign(row,E.station(shownZone.controller,shownZone.station));
        const related=rows('reports',row.gardenId).filter(r=>!b.voids?.[r.id] && r.kind==='run' && r.job===row.job);
        if(related.some(r=>W.sameRunEvidence(r,row))) throw Error('This watering is already recorded. For a separate watering, change the start time.');
        if(related.length && (!sameJob.checked || collisionJob!==row.job)) {
          refresh();at.el.closest('details').open=true;
          throw Error('Change the start time or confirm that both reports describe the same watering.');
        }
        const proposed=W.put(b,'reports',row), group=W.groups(proposed,'run').find(g=>g.id===row.job);
        const water=group && W.water(group), dose=group && W.feedDelivery(group);
        const receipt=group?.unsettled.length?['Watering saved for review']:[
          'Watering recorded',water?.gallons!=null?num(water.gallons,2)+' gal'+(water.basis==='Estimated'?' estimated':''):null,
          dose?.plain?'Water only':dose?.totals?.n!=null?num(dose.totals.n,4)+' lb N estimated':null];
        const ok=report(row,[...receipt,gardenName(row.gardenId)].filter(Boolean).join(' · '));
        if(ok) lastWateredGarden=row.gardenId;
        if(ok && App.state.view==='water') {
          gardenId=row.gardenId; lens='Irrigation';
          const date=new Date(row.at);
          period=local(date).slice(0,10)===local().slice(0,10)?'Today':'Last 7 days';
          if(!insidePeriod(row)) period='Season';
          render();
          if(!insidePeriod(row)) {
            const saved=W.groups(book(),'run').find(g=>g.id===row.job);
            if(saved) sheet('Watering recorded',[note(gardenName(row.gardenId)),history(saved,'run')],'Done');
          }
        }
        return ok;
      },'wf-work-sheet');
      refresh();
      (garden.get()?meter.control:garden.control).focus({preventScroll:true});
    }
    garden.control.addEventListener('change',()=>loadChoices());
    function override() {automatic=false;forThisRun=true;}
    injector.control.addEventListener('change',()=>{override();portion.control.value='whole';treated.control.value='';selectTank();});
    stockRecipe.control.addEventListener('change',()=>{override();readStock();});
    for(const f of [portion,ratio,treated]) f.control.addEventListener('input',()=>{override();refresh();});
    at.control.addEventListener('input',()=>{if(!forThisRun) useDefault();else refresh();});
    for(const f of [meter,elapsed,status,planned,source]) f.control.addEventListener('input',refresh);
    useRate.addEventListener('change',refresh);
    loadChoices(initialZone?.id); show();
  }
  function deliveryLine(result) {
    if(!result) return '';
    if(result.held) return 'Fertilizer estimate awaiting review';
    if(result.plain) return 'Water only';
    const {feed,totals}=result;
    const concentration=W.stockConcentration(feed.stock,feed.ratio).n;
    const products=Object.values(feed.stock).map(p=>p.name).join(' + ');
    return feed.tankName+' · '+products+' · 1:'+num(feed.ratio,2)+(concentration==null?'':' · '+num(concentration,1)+' ppm N')+' · '+(totals?
      num(result.gallons,2)+' gal with fertilizer · '+(totals.n==null?'N unknown':num(totals.n,4)+' lb N estimated'):'fertilized volume unknown');
  }
  function reconcile(group, kind) {
    const isRun=kind==='run', supply=kind==='count'||kind==='delivery';
    if (group.overlap) {
      const matches=W.groups(book(),'run').filter(g=>group.overlap.includes(g.id));
      sheet('Check duplicate station runs',[note('The same Hunter station and start time occur on multiple runs. Their minutes and gallons are held until the extra entry is taken back.'),matches.map(g=>line(
        h('b',gardenName(g.chosen.gardenId)+' · '+g.chosen.label),when(g.chosen.at),duration(g.elapsed ?? g.chosen.elapsed),quantity(g.chosen.meter,'gal'),
        button('Take back this run',()=>sheet('Take back '+g.chosen.label+'?',[note(gardenName(g.chosen.gardenId)+' · '+when(g.chosen.at))],'Take back',()=>takeBack(g)),'wf-overlap-remove')))],'Done');
      return;
    }
    const describe=r=>supply ? amounts(r.items)+(r.bagLb?' · '+num(r.bags)+' bags × '+num(r.bagLb,3)+' lb + '+num(r.loose,3)+' lb loose':'')+(r.reference?' · '+r.reference:'') : isRun ? [r.status, quantity(r.elapsed,'min')+' elapsed', (r.planned==null?'Planned time unknown':quantity(r.planned,'min')+' planned'),
      (r.meter==null?'Meter reading unknown':quantity(r.meter,'gal')+' metered'),
      r.rate==null?'No rated flow':num(r.rate,3)+' gal/min rated',r.beds?.length?'Beds '+bedNames(r.beds):'Served beds unknown',r.source,stationText(r),r.reference,r.feed?deliveryLine(W.feedDelivery({chosen:r,reports:[r]})):'Injector use unspecified'].filter(Boolean).join(' · ') :
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
    sheet('Review '+(isRun?'run evidence':supply?'stock reports':'application reports'),group.reports.map(r=>h('section.wf-task', h('strong',when(r.at)),note('Entered '+when(r.entered)),note(describe(r)),
      line(button('Use these figures for the same job',()=>decide(r,'same'),'wf-use-report'),(kind==='refill'||kind==='delivery') && r.id!==group.chosen.id ? button(kind==='refill'?'Count as a separate refill':'Count as a separate delivery',()=>decide(r,'separate'),'wf-separate') : null))),'Done');
  }
  function takeBack(group) {
    const current=book(), voids={...current.voids};
    for(const r of group.reports) voids[r.id]=true;
    if(save({...current,voids,cancelled:{...current.cancelled,[group.id]:true}},'Entry taken back')) close();
  }
  function history(group, kind) {
    const r=group.chosen, run=kind==='run', w=run && W.water(group);
    return h('details.wf-history',h('summary',h('b',r.label),' · '+when(r.at)+' · '+(run ? group.workConflict?'Run details disputed':r.status+' · '+duration(group.elapsed ?? r.elapsed) : amounts(r.items)),group.unsettled.length?' · Review reports':''),
      note(run ? (group.planned==null?'Planned time unconfirmed':num(group.planned,2)+' min planned')+' · '+(w.gallons==null?(w.basis==='Unknown'?'Gallons unknown':w.basis):num(w.gallons,2)+' gal · '+w.basis)+' · '+[...new Set(group.reports.map(x=>x.source))].join(' + ') :
      kind==='spread' ? 'Applied to '+(r.beds.length?'beds '+bedNames(r.beds):'the whole garden') : r.recipe+' · '+(r.gallons==null?'Final stock volume unknown':num(r.gallons,2)+' gal final stock')+' · '+(r.remainder==null?'Remainder unknown':num(r.remainder,2)+' gal carried')+' · Delivery unknown'),
      run && W.feedDelivery(group)?note(deliveryLine(W.feedDelivery(group))):null,
      run || kind==='refill' ? note(r.beds?.length?'Served beds '+bedNames(r.beds):'Served beds unknown') : null,
      run && !group.workConflict && r.status!=='Skipped'?button('Attach Hunter meter reading',()=>attachMeter(group),'wf-hunter-meter'):null,
      line(group.reports.length>1 || group.overlap?button('Review reports',()=>reconcile(group,kind),'wf-review'):null,button('Take back entry',()=>sheet('Take back '+r.label+'?',[note('Remove this physical job from totals. Its reports stay in the plan.')],'Take back',()=>takeBack(group)),'wf-take-back')));
  }
  function labKey(row) {
    return JSON.stringify([row.kind,row.date,row.source,row.method,row.analyte,row.value,row.unit,[...(row.beds || [])].sort()]);
  }
  function labForm(id, drafts = [], previous = {}, excluded = new Set()) {
    const kind=field('Sample type',previous.kind || 'Soil',null,['Soil','Soil extract','Tissue','Water'].map(x=>[x,x]));
    const sampled=field('Sample date',previous.date || local().slice(0,10),'date'), lab=field('Lab and report ID',previous.source);
    const method=field('Extraction method or tissue stage',previous.method), analyte=field('Analyte','');
    const reading=field('Reported value',''), unit=field('Original units','');
    const paste=h('textarea.field',{rows:4,'aria-label':'Readings from spreadsheet',placeholder:'Analyte   Value   Unit'});
    const beds=App.state.plan.beds.filter(b=>b.gardenId===id && b.active!==false).map(b=>[b,h('input',{type:'checkbox',checked:previous.beds?.includes(b.id)})]);
    sheet('Enter lab reading · '+gardenName(id),[line(kind.el,sampled.el),lab.el,method.el,line(analyte.el,reading.el,unit.el),
      h('details.wf-section',h('summary','Paste readings from a spreadsheet'),note('Paste three tab-separated columns in this order: analyte, value, unit. Omit the heading.'),paste),
      h('details.wf-section',{open:true},h('summary','Sampled beds'),beds.map(([b,c])=>h('label.wf-choice',c,String(b.bed||b.id)))),
      drafts.length?button('Back to report',()=>reviewLab(id,drafts,excluded),'wf-lab-back'):null], 'Review reading',()=>{
      if(!sampled.get() || sampled.get()>local().slice(0,10)) throw Error('Enter the actual sample date.');
      const meta={gardenId:id,kind:kind.get(),date:sampled.get(),source:W.name(lab.get(),'the lab and report ID'),method:W.name(method.get(),'the method or crop stage'),beds:beds.filter(([,c])=>c.checked).map(([b])=>b.id)};
      const input=paste.value.trim()?paste.value.trim().split(/\r?\n/).map(line=>line.split('\t')):[];
      if(analyte.get() || reading.get() || unit.get() || !input.length) input.unshift([analyte.get(),reading.get(),unit.get()]);
      const seen=new Set([...drafts,...rows('labs',id)].map(labKey));
      const records=input.map(cols=>{
        if(cols.length!==3) throw Error('Each pasted row needs three columns.');
        const record={...meta,id:App.uid(),analyte:W.name(cols[0],'the analyte'),value:W.name(cols[1],'the original reading'),unit:W.name(cols[2],'the original units')};
        const key=labKey(record);
        if(seen.has(key)) throw Error('This reading is already in the report or garden history.');
        seen.add(key);
        return record;
      });
      reviewLab(id,[...drafts,...records],excluded);
    });
  }
  function reviewLab(id,drafts,excluded=new Set()) {
    const picks=drafts.map(row=>[row,h('input',{type:'checkbox',checked:!excluded.has(row.id),'aria-label':'Include '+row.analyte})]);
    const omissions=()=>new Set(picks.filter(([,c])=>!c.checked).map(([r])=>r.id));
    const table=h('div.wf-table-scroll',h('table.wf-grid-table',h('thead',h('tr',['Include','Analyte','As reported','Sample'].map(label=>h('th',{scope:'col'},label)))),
      h('tbody',picks.map(([r,c])=>h('tr',h('td',c),h('th',{scope:'row'},r.analyte),h('td',r.value+' '+r.unit),
        h('td',r.kind+' · '+r.date,note(r.source+' · '+r.method),note(r.beds.length?'Beds '+bedNames(r.beds):'Sampled beds unspecified')))))));
    sheet('Review lab report · '+gardenName(id),[table,line(button('Add reading',()=>labForm(id,drafts,drafts.at(-1),omissions()),'wf-lab-another'),
      button('Skip this report',close,'wf-lab-skip'))], 'Import selected readings',()=>{
      const chosen=picks.filter(([,c])=>c.checked).map(([r])=>r);
      if(!chosen.length) throw Error('Select at least one reading.');
      const existing=new Set(rows('labs',id).map(labKey));
      if(chosen.some(r=>existing.has(labKey(r)))) throw Error('A selected reading is already in this garden. Uncheck it before importing.');
      let next=book(); for(const r of chosen) next=W.put(next,'labs',r);
      return save(next,'Lab readings imported');
    },'wf-wide');
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
    const byWeek=new Map(), deliveries=[];
    for(const group of W.groups(book(),'run')) {
      const date=new Date(group.chosen.at);
      if(group.chosen.gardenId!==id || date.getFullYear()!==year) continue;
      const delivery=W.feedDelivery(group);
      if(!delivery || delivery.plain) continue;
      delivery.at=group.chosen.at;
      date.setDate(date.getDate()-(date.getDay()+6)%7);
      const week=local(date).slice(0,10);
      if(!byWeek.has(week)) byWeek.set(week,[]);
      byWeek.get(week).push(delivery);deliveries.push(delivery);
    }
    const injected=deliveries.length?deliveredTotals(deliveries):null;
    const knownN=deliveries.filter(d=>d.totals?.n!=null);
    const partialN=knownN.length && knownN.length<deliveries.length?
      num(knownN.reduce((sum,d)=>sum+d.totals.n,0),4)+' lb N estimated from '+countOf(knownN.length,'watering')+' · '+(deliveries.length-knownN.length)+' awaiting a complete estimate':null;
    // The tank is the meter: a mix counts as fed when it is recorded. Logged waterings estimate the same fertilizer and stand
    // in its place only where they account for more (W.injectorFeed).
    const mixes=W.groups(book(),'refill').filter(g=>g.chosen.gardenId===id && new Date(g.chosen.at).getFullYear()===year)
      .map(g=>({...W.nutrientTotals(Object.values(g.chosen.items)),at:g.chosen.at,review:g.unsettled.length>0}));
    const feed=W.injectorFeed(mixes,deliveries.map(d=>({n:d.totals?.n ?? null,p:d.totals?.p ?? null,k:d.totals?.k ?? null,at:d.at})));
    feed.rows=feed.basis==='tanks'?mixes:feed.basis?deliveries.map(d=>({n:d.totals?.n ?? null,at:d.at})):[];
    return {garden, year, key, target, beds, areaBeds, floor, byWeek, injected, partialN, feed, applied:recorded('spread'), mixed:recorded('refill')};
  }
  function deliveredTotals(deliveries) {
    return Object.fromEntries(nutrients.map(([k])=>[k,deliveries.every(d=>d.totals?.[k]!=null)?
      deliveries.reduce((sum,d)=>sum+d.totals[k],0):null]));
  }
  function acreBasis(f) {
    const floor=f.target?f.target.basis==='floor':f.floor>0;
    return {area:floor?f.floor:f.areaBeds,label:floor?'garden floor':'active bed tops'};
  }
  function injectorRates(f) {
    if(!f.injected) return null;
    const {area,label:basis}=acreBasis(f);
    const row=(label,totals)=>h('tr',h('th',{scope:'row'},label),nutrients.map(([k])=>
      h('td', totals[k]==null?'Unknown':num(totals[k]*43560/area,2))));
    return h('details.wf-section',h('summary','Logged waterings by week and season'),
      area>0?h('table.wf-nutrients',h('caption','Estimated lb/acre over '+num(area,2)+' sq ft of '+basis),
        h('thead',h('tr',['Period',...nutrients.map(([,name])=>name)].map(name=>h('th',{scope:'col'},name)))),
        h('tbody',row('Season '+f.year,f.injected),Array.from(f.byWeek,([week,deliveries])=>row('Week of '+week,deliveredTotals(deliveries))))):
        note('Set a measured garden floor or bed-top area to see lb/acre. Choose the area basis in Season targets.'));
  }
  function nutrientTable(figures, targetLb) {
    const cell=(tag,value)=>h(tag,value==null?'Unknown':num(value,3)+' lb');
    const row=(label,amounts)=>h('tr', h('th',{scope:'row'},label), nutrients.map(([k])=>cell('td',amounts?.[k])));
    return h('table.wf-nutrients', h('caption','Season fertility · '+figures.year,figures.partialN?note(figures.partialN):null),
      h('thead',h('tr',h('th',{scope:'col'},'Nutrient amounts'),nutrients.map(([,label])=>h('th',{scope:'col'},label)))),
      h('tbody',targetLb?row('Target · '+(figures.target.basis==='floor'?num(figures.floor,2)+' sq ft floor':num(figures.areaBeds,2)+' sq ft bed tops'),targetLb):null,figures.applied?row('Field applied'+(figures.applied.disputed?' (under review)':''),figures.applied.totals):null,
        figures.mixed?row('Mixed into tanks'+(figures.mixed.disputed?' (under review)':'')+(figures.feed.basis==='waterings'?' · not added':''),figures.mixed.totals):null,
        figures.injected?row('Logged waterings (estimate)'+(figures.feed.basis==='tanks'?' · not added':''),figures.injected):null));
  }
  /** One line on which count of the injector's feed stands, where a garden has both. */
  function feedNote(f) {
    if(!f.mixed || !f.injected) return f.mixed?note('A tank mix counts as fed when it is recorded.'):null;
    return note(f.feed.basis==='tanks'?'Tank mixes are counted as fed. Logged waterings estimate the same fertilizer and are not added.':
      'Logged waterings account for more than the mixes recorded, so they are counted. A mix may be unrecorded.');
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
      f.applied||f.injected||f.mixed?nutrientTable(f):note('No applications recorded for '+year+'.'),feedNote(f)],
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
  /** A garden's floor, typed once: the area its lb/acre is worked out over. Empty, the rates use its bed tops. */
  function floorForm(id) {
    const g=gardens().find(v=>v.id===id), size=g.measuredSize;
    const width=field('Floor width (ft)',size?.widthFt,'number'), length=field('Floor length (ft)',size?.lengthFt,'number');
    const result=h('p.wf-result',{role:'status'});
    const read=()=>width.get()==='' && length.get()===''?[null,null]:[W.number(width.get(),'the floor’s width in feet',0.000001),W.number(length.get(),'the floor’s length in feet',0.000001)];
    function refresh() {
      try { const [w,l]=read(); result.textContent=w==null?'No floor · rates use the bed tops':num(w*l,2)+' sq ft floor · rates in lb/acre are worked out over it'; }
      catch { result.textContent=''; }
    }
    for(const f of [width,length]) f.control.addEventListener('input',refresh); refresh();
    sheet('Floor · '+g.name,[note('The whole floor under cover, or the whole plot outdoors: beds and paths together. Leave both empty to use the bed tops.'),line(width.el,length.el),result],'Save floor',()=>{
      const [w,l]=read(), before=JSON.stringify(g.measuredSize || null);
      if(JSON.stringify(gardens().find(v=>v.id===id)?.measuredSize || null)!==before) throw Error('The floor changed. Reopen it to see its current size.');
      if(JSON.stringify(w==null?null:{v:1,widthFt:w,lengthFt:l})!==before) {
        if(!App.setGardenFloor(id,w,l)) return false;
        UI.toast(w==null?'Floor size removed · '+g.name:'Floor saved · '+g.name,{label:'Undo',run:App.undo});
      }
      gardenCard(id);
    },'',()=>gardenCard(id));
  }
  function gardenCard(id) {
    const g=gardens().find(v=>v.id===id); if(!g) return;
    const b=book(), tanks=rows('tanks',id), zones=rows('zones',id), mixes=W.groups(b,'refill').filter(x=>x.chosen.gardenId===id).reverse(), runs=W.groups(b,'run').filter(x=>x.chosen.gardenId===id).reverse(), labs=rows('labs',id);
    const measured=g.measuredSize, legacy=g.liquidFeedProfile;
    const details=(title,body,open=false)=>h('details.wf-section',{open},h('summary',title),body);
    const f=seasonFigures(id), due=tanks.filter(t=>W.reminder(b,t.id));
    const weeksRuns=runs.filter(group=>{const date=new Date(group.chosen.at);const first=new Date();first.setHours(0,0,0,0);first.setDate(first.getDate()-6);return date>=first && date<=new Date();});
    sheet(g.name,[measured?.widthFt && measured?.lengthFt ? note(num(measured.widthFt)+' × '+num(measured.lengthFt)+' ft · '+num(measured.widthFt*measured.lengthFt)+' sq ft floor') : null,
      nitrogen(f),seasonHistory(f),due.length?line(h('strong','Refill '+due[0].name),button('Open Tasks',()=>openRefill(due[0].id),'wf-open-tasks')):null,
      details('This week · '+countOf(due.length,'refill')+' due',[
        tanks.map(t=>line(t.name,W.reminder(b,t.id)?'Refill due':'No refill due')),note(runLine(W.runSummary(weeksRuns))),
        runs.length?details('Irrigation history · '+runs.length,runs.map(x=>history(x,'run'))):null]),
      details('Season plan · '+f.year,[line(button('View full season',()=>fullSeason(id),'wf-full-season'),button('Season targets',()=>seasonSheet(id),'wf-targets'),button('Record field application',()=>spreadForm(id),'wf-spread')),
        W.groups(b,'spread').filter(x=>x.chosen.gardenId===id).reverse().map(x=>history(x,'spread')),mixes.map(x=>history(x,'refill'))]),
      details('Soil and tissue tests · '+labs.length,[labHistory(id),button('Review lab result',()=>labForm(id),'wf-lab')]),
      details('Setup · '+countOf(tanks.length,'tank')+', '+countOf(zones.length,'zone'),[
        legacy?.enabled ? note('Saved feed profile · '+legacy.productName+' · '+num(legacy.ppmN)+' ppm N') : null,
        line(h('b','Floor'),measured?.widthFt && measured?.lengthFt?num(measured.widthFt)+' × '+num(measured.lengthFt)+' ft':'Not set · rates use the bed tops',
          button(measured?'Edit floor size':'Set floor size',()=>floorForm(id),'wf-floor')),
        tanks.map(t=>line(h('b',t.name),num(t.gallons,2)+' gal',b.recipes?.[t.recipeId]?.name||'Recipe missing',
          t.ratio && b.recipes?.[t.recipeId] ? '1:'+num(t.ratio,2)+' · recipe contributes '+quantity(W.recipeConcentration(b,t.recipeId,t.ratio).n,'ppm N (estimated)') : null,
          button(t.ratio?'Edit injector':'Edit tank',()=>setup(id,'tank',t),'wf-edit-tank'), W.reminder(b,t.id)?'Refill due':button('Request refill',()=>request(t),'wf-request'))),
        zones.map(z=>{
          const rate=W.zoneRate(z,App.state.plan.beds);
          return line(h('b',z.name),rate==null?'Flow unknown':num(rate,2)+' gal/min rated',button('Edit zone',()=>setup(id,'zone',z),'wf-edit-zone'),button('Record run',()=>runForm(z),'wf-run'));
        }),
        line(button('Add tank',()=>setup(id,'tank'),'wf-add-tank'),button('Add zone',()=>setup(id,'zone'),'wf-add-zone'))])], 'Done',null,'wf-garden-sheet');
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
      total.unknownMinutes===total.started && total.unknownMinutes?'Duration unknown':num(total.minutes,2)+(total.disputed || total.unknownMinutes?' confirmed min':' min'),total.unknownMinutes && total.unknownMinutes<total.started?total.unknownMinutes+' with duration unknown':null].filter(Boolean).join(' · ');
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
        h('b',total.started && total.unknownMinutes!==total.started?num(total.minutes,1):total.skipped&&!total.disputed?'0':'—'),
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
    return h('section.wf-board.wf-garden',line(tile(g),h('h3',g.name),button('Garden details',()=>gardenCard(g.id),'wf-garden')),
      records.length?note(volumeLine(total)+' · '+runLine(total)):note(zones.length?'No runs recorded in this period.':'No irrigation zones set up.'),
      zones.map(z=>{
        const latest=records.filter(group=>group.chosen.zoneId===z.id).at(-1), r=latest?.chosen;
        const last=r ? latest.workConflict?'Run details disputed':r.status+' · '+(latest.elapsed==null?'Duration unknown':num(latest.elapsed,2)+(latest.planned==null?'':' of '+num(latest.planned,2))+' min') : '';
        return line(h('strong',z.name),stationText(z)||null,r?last+' · '+when(r.at):'No run in this period',button('Record run',()=>runForm(z),'wf-run'));
      }),soilHistory(g.id),soilDays(g.id),line(button('Add zone',()=>setup(g.id,'zone'),'wf-add-zone'),button('Read soil probes',()=>soilImport(g.id),'wf-soil-import')),
      records.length ? h('details.wf-section',h('summary','Irrigation history · '+records.length),records.slice().reverse().map(x=>history(x,'run'))) : null);
  }
  function enableConstant(tank) {
    const current=book(), prior=current.constantFeed?.[tank.gardenId], stock=W.snapshot(current,tank.recipeId,1);
    const detail=W.stockConcentration(stock,tank.ratio).n;
    sheet('Use constant feed',[note(gardenName(tank.gardenId)+' · '+tank.name+' · '+current.recipes[tank.recipeId].name+' · 1:'+num(tank.ratio,2)),
      note((detail==null?'':num(detail,1)+' ppm N estimated. ')+'New waterings will use this injector unless you change the feed for that watering.')],
      'Use constant feed',()=>{
        const b=book();
        if(JSON.stringify(b.tanks?.[tank.id])!==JSON.stringify(tank) || JSON.stringify(b.constantFeed?.[tank.gardenId])!==JSON.stringify(prior) ||
            JSON.stringify(W.snapshot(b,tank.recipeId,1))!==JSON.stringify(stock)) throw Error('The setup changed. Reopen the injector to see its current mix.');
        return save(setUsual(b,tank,true),'Constant feed saved');
      },'wf-work-sheet');
  }
  function fertilityGarden(g, tanks, mixes, dueByTank, selected) {
    const latest=mixes.at(-1), f=selected?seasonFigures(g.id):null;
    const area=f?.target?.basis==='floor'?f.floor:f?.areaBeds;
    const target=f?.target && area>0?W.targetPounds(area,f.target):null;
    return h('section.wf-board.wf-garden',line(tile(g),h('h3',g.name),button('Garden details',()=>gardenCard(g.id),'wf-garden')),
      f?nitrogen(f):null,
      latest?note('Last refill '+when(latest.chosen.at)):null,
      tanks.map(t=>line(h('strong',t.name),book().recipes?.[t.recipeId]?.name||'Recipe missing',
        t.ratio?'1:'+num(t.ratio,2):null,book().constantFeed?.[g.id]?.tankId===t.id?'Constant feed':null,
        t.ratio && book().constantFeed?.[g.id]?.tankId!==t.id?button('Use constant feed',()=>enableConstant(t),'wf-enable-constant'):null,button(t.ratio?'Edit injector':'Edit tank',()=>setup(g.id,'tank',t),'wf-edit-tank'),
        dueByTank.has(t.id)?button('Refill due · Tasks',()=>openRefill(t.id),'wf-open-tasks'):button('Request refill',()=>request(t),'wf-request'))),
      f && (target||f.applied||f.injected||f.mixed)?nutrientTable(f,target):null,f?injectorRates(f):null,
      f?feedNote(f):null,
      line(button('Record field application',()=>spreadForm(g.id),'wf-spread'),button('Season targets',()=>seasonSheet(g.id),'wf-targets'),
        (selected||!tanks.length)?button('Add tank',()=>setup(g.id,'tank'),'wf-add-tank'):null));
  }
  const countOf = (n, word) => n+' '+word+(n===1?'':'s');
  function board(title, meta, ...parts) {
    return h('section.wf-board', h('header.wf-board-head',h('h3',title),meta != null ? h('span',String(meta)) : null),parts);
  }
  function switcher(label,items,value,change) {
    return h('div.seg',{role:'group','aria-label':label},items.map(item=>h('button',{type:'button','aria-pressed':String(item===value),
      onclick:()=>{change(item);render();}},item)));
  }
  function selectGarden(id) { gardenId=id; render(); }
  function tile(g) {
    const eng=App.state.engine;
    const planting=App.state.plan.plantings.find(p=>!p.deleted && eng.bedOf(p.bedId)?.gardenId===g.id && eng.crop(p.cropId));
    const crop=planting && eng.crop(planting.cropId);
    return root.LRFThumbs.el({cropId:crop?.id,varietyId:planting?.varietyId,label:crop?.name || g.name,color:crop?eng.cropColor(crop):'var(--paper)',size:42,cls:'wf-tile'});
  }
  function gardenLink(g,detail) {
    return h('button.wf-place',{type:'button',onclick:()=>gardenCard(g.id),'aria-label':'Garden details · '+g.name},
      tile(g),h('span',h('strong',g.name),detail?h('small',detail):null));
  }
  function gardenTools(g) {
    sheet('Set up '+g.name,[button('Add Dosatron',()=>addInjector(g.id),'wf-add-injector'),
      button('Add irrigation zone',()=>setup(g.id,'zone'),'wf-add-zone'),
      button('Set season targets',()=>seasonSheet(g.id),'wf-targets'),
      button('Review lab result',()=>labForm(g.id),'wf-lab')],'Done',null,'wf-work-sheet');
  }
  function setupRows(list,isWater) {
    if(!list.length) return null;
    const item=g=>h('div.wf-quiet-row',gardenLink(g),note('Not set up'),button('Set up',()=>gardenTools(g),'wf-select-garden'));
    return [note(isWater?'Choose a garden to add its first irrigation zone.':'Choose a garden to record a field application, set targets or add a feed tank.'),
      list.slice(0,6).map(item),list.length>6?h('details.wf-more',h('summary','Show '+(list.length-6)+' more gardens'),list.slice(6).map(item)):null];
  }
  function nitrogenFigures(f) {
    const counted=f.feed.counted;
    const area=f.target || counted?acreBasis(f).area:null;
    const goal=f.target?.n;
    const hasRecords=!!(f.applied || counted);
    const measured=hasRecords && (!f.applied || (f.applied.totals.n!=null && !f.applied.disputed)) && (!counted || counted.n!=null);
    const applied=measured?(f.applied?.totals.n || 0)+(counted?.n || 0):null;
    const perAcre=measured && area>0?applied*43560/area:null;
    return {goal,applied,measured,perAcre};
  }
  /** What stands behind the nitrogen figure, said beside it: the mixes or the waterings it counts, and any it could not. */
  function feedSource(f) {
    const {basis,counted}=f.feed;
    if(!basis) return '';
    const unknown=counted.unknown?' · '+counted.unknown+(basis==='tanks'?' with weight unknown':' without an estimate'):'';
    return ' · '+(basis==='tanks'?counted.count+(counted.count===1?' tank mix':' tank mixes'):countOf(counted.count,'logged watering')+' (estimate)')+unknown;
  }
  function nitrogen(f) {
    const {goal,applied,measured,perAcre}=nitrogenFigures(f);
    const show=perAcre!=null && goal!=null && goal>0, counted=f.feed.counted;
    const unsure=f.applied && (f.applied.disputed || f.applied.totals.n==null);
    const amount=perAcre!=null?num(perAcre,1)+' lb/acre':measured?num(applied,3)+' lb':unsure?'Unconfirmed':counted?'Weight unknown':'Nothing recorded';
    return h('div.wf-nitrogen',h('small','Nitrogen applied'+feedSource(f)),h('strong',show?num(perAcre,1)+' of '+num(goal,1)+' lb N/acre':amount),
      show?h('progress',{max:goal,value:Math.min(perAcre,goal),'aria-label':'Recorded nitrogen against season target'}):null,
      goal!=null?h('small',(show?'':'Target '+num(goal,1)+' lb/acre · ')+(f.target.basis==='floor'?'Garden floor':'Bed tops')):counted && perAcre!=null?h('small','Over '+acreBasis(f).label):null);
  }
  function seasonHistory(f) {
    const groups=W.groups(book(),'spread').filter(g=>g.chosen.gardenId===f.garden.id && new Date(g.chosen.at).getFullYear()===f.year);
    const first=new Date(f.year,0,1), monday=new Date(first);
    monday.setDate(first.getDate()-(first.getDay()+6)%7);
    const weeks=[];
    for(let date=new Date(monday);date.getFullYear()<=f.year;date.setDate(date.getDate()+7)) weeks.push({date:new Date(date),lb:0,known:true,count:0});
    // field applications, and the injector's feed as it is counted: the tank mixes, or the logged waterings in their place
    const entries=[...groups.map(group=>({at:group.chosen.at,n:group.unsettled.length?null:W.nutrientTotals(group.chosen.items).n})),
      ...f.feed.rows.map(row=>({at:row.at,n:row.n}))];
    for(const entry of entries) {
      const day=local(new Date(entry.at)).slice(0,10);
      const week=weeks.findLast(w=>local(w.date).slice(0,10)<=day);
      if(!week) continue;
      week.count++;
      if(entry.n==null) week.known=false; else week.lb+=entry.n;
    }
    const peak=Math.max(0,...weeks.filter(w=>w.known).map(w=>w.lb));
    return h('figure.wf-season-chart',h('figcaption','Nitrogen applied by week · '+f.year),
      h('div.wf-columns',{'aria-hidden':'true'},weeks.map(w=>h('i',{className:w.count&&!w.known?'unknown':'',
        style:{height:w.count&&!w.known?'4px':(peak>0?100*w.lb/peak:0)+'%'}}))),
      h('div.wf-year-axis',h('span','Jan'),h('span','Apr'),h('span','Jul'),h('span','Oct'),h('span','Dec')),
      weeks.some(w=>!w.known)?note('Hatched marker · amount unconfirmed'):null,
      entries.length?h('details.wf-more',h('summary','Weekly amounts'),weeks.filter(w=>w.count).map(w=>note('Week of '+UI.day(w.date)+' · '+(w.known?num(w.lb,2)+' lb N':'Unconfirmed')))):note('No fertilizer recorded this season.'));
  }
  function labHistory(id) {
    const readings=rows('labs',id).sort((a,b)=>b.date.localeCompare(a.date));
    if(!readings.length) return note('No lab results recorded.');
    const comparable=new Map();
    for(const r of readings) {
      const key=JSON.stringify([r.kind,r.analyte,r.method,r.unit,[...(r.beds||[])].sort()]);
      if(!comparable.has(key)) comparable.set(key,[]);
      comparable.get(key).push(r);
    }
    const detail=r=>note(r.date+' · '+r.source+' · '+r.method+' · '+(r.beds?.length?'Beds '+bedNames(r.beds):'Sampled beds unspecified'));
    return h('div.wf-table-scroll',h('table.wf-grid-table',h('caption','Latest comparable readings'),
      h('thead',h('tr',['Analyte','As reported','Sample and history'].map(label=>h('th',{scope:'col'},label)))),
      h('tbody',[...comparable.values()].map(([r,...older])=>h('tr',h('th',{scope:'row'},r.analyte,note(r.kind)),
        h('td',h('b',r.value+' '+r.unit)),h('td',detail(r),older.length?h('details.wf-more',h('summary','Earlier readings ('+older.length+')'),
          older.map(v=>h('div',h('b',v.value+' '+v.unit),detail(v)))):null))))));
  }
  function gardenTests(g) {
    return board(g.name, 'Soil and tissue tests',labHistory(g.id),button('Review lab result',()=>labForm(g.id),'wf-lab'));
  }
  function seasonBoard(g) {
    const f=seasonFigures(g.id), area=f.target?.basis==='floor'?f.floor:f.areaBeds;
    return board(g.name,f.year,nitrogen(f),seasonHistory(f),f.target || f.applied || f.injected || f.mixed ? nutrientTable(f,f.target&&area>0?W.targetPounds(area,f.target):null):null,injectorRates(f),
      f.mixed?[feedNote(f),h('details.wf-section',h('summary','Recent mixes'),
        W.groups(book(),'refill').filter(x=>x.chosen.gardenId===g.id && new Date(x.chosen.at).getFullYear()===f.year).reverse().map(x=>history(x,'refill')))]:null,
      line(button('Edit season targets',()=>seasonSheet(g.id),'wf-targets'),button('Record field application',()=>spreadForm(g.id),'wf-spread'),button('Fertilizer to buy',openSupplies,'wf-open-supplies')));
  }
  function fullSeason(id) {
    sheet('Season plan · '+gardenName(id),[seasonBoard(gardens().find(g=>g.id===id)),button('Back to garden',()=>gardenCard(id),'wf-return-garden')],'Done',null,'wf-wide');
  }
  function fertilityOverview(list, due, configured) {
    const ready=list.filter(g=>configured.has(g.id)), waiting=list.filter(g=>!configured.has(g.id));
    const pending=g=>due.filter(t=>t.gardenId===g.id);
    const b=book(), mixes=W.groups(b,'refill'), spreads=W.groups(b,'spread');
    const runs=W.groups(b,'run').filter(g=>g.reports.some(r=>r.feed && r.feed.mode!=='plain'));
    const reviews=[...mixes,...spreads,...runs].filter(x=>x.unsettled.length || x.overlap);
    const reviewFor=g=>reviews.filter(x=>x.chosen.gardenId===g.id);
    const figures=new Map(ready.map(g=>[g.id,seasonFigures(g.id)]));
    const attention=ready.filter(g=>pending(g).length || reviewFor(g).length);
    const quiet=ready.filter(g=>!attention.includes(g));
    const work=g=>{
      const tanks=pending(g), outstanding=reviewFor(g);
      return h('article.wf-summary-row',gardenLink(g,tanks.length?W.reminder(b,tanks[0].id).reason:'Application records need review'),nitrogen(figures.get(g.id)),
        h('div.wf-jobs',tanks.map(t=>h('button.wf-job',{type:'button',onclick:()=>openRefill(t.id)},h('span',h('strong','Refill '+t.name),
          h('small',num(t.gallons,2)+' gal batch · Open refill card ›')))),outstanding.map(x=>button('Review '+x.chosen.label,()=>reconcile(x,x.chosen.kind),'wf-review'))));
    };
    function settled(g) {
      const last=mixes.filter(r=>r.chosen.gardenId===g.id).at(-1);
      return h('div.wf-quiet-row',gardenLink(g,last?'Last refill '+when(last.chosen.at):'No refill requested'),nitrogen(figures.get(g.id)),b.constantFeed?.[g.id]?.tankId?button('Record watering',()=>runForm(null,g.id),'wf-garden-watering'):button('View garden',()=>selectGarden(g.id),'wf-select-garden'));
    }
    const cleared=quiet.filter(g=>figures.get(g.id).injected || [...mixes,...spreads].some(r=>r.chosen.gardenId===g.id));
    const unrecorded=quiet.filter(g=>!cleared.includes(g));
    const pendingCount=countOf(attention.length,'garden')+' · '+countOf(due.length,'refill')+' due';
    return [board('Needs attention',pendingCount,attention.length?attention.map(work):
      h('div.wf-clear',h('span',{'aria-hidden':'true'},'✓'),h('div',h('strong','No refills due'),note(ready.length?'No outstanding refill requests.':'Set up a garden below to track its feed tanks and applications.')))),
      cleared.length?board('Nothing due','No refill requested · no reports to review',cleared.map(settled)):null,
      unrecorded.length||waiting.length?board('Your gardens',unrecorded.length+' awaiting records · '+waiting.length+' not set up',
        unrecorded.map(g=>h('div.wf-quiet-row',gardenLink(g),note('No applications or refills recorded'),button('View garden',()=>selectGarden(g.id),'wf-select-garden'))),setupRows(waiting,false)):null];
  }
  function timeLabel(date) { return date.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}); }
  function todayRuns(all,groups,zones) {
    const nowDate=new Date(), start=new Date(nowDate), end=new Date(nowDate);
    start.setHours(0,0,0,0); end.setHours(24,0,0,0);
    const from=new Date(start), to=new Date(start);from.setHours(5);to.setHours(19);
    const events=groups.map(group=>{
      const r=group.chosen, at=new Date(r.at), finish=new Date(+at+(group.workConflict?0:group.elapsed || 0)*60000);
      return {group,r,at,finish};
    }).filter(e=>e.at<end && (e.finish>start || e.at>=start));
    const lo=Math.min(+from,...events.map(e=>Math.max(+start,+e.at)));
    const hi=Math.max(+to,...events.map(e=>Math.min(+end,+e.finish)));
    const pos=t=>Math.max(0,Math.min(100,(t-lo)/(hi-lo)*100));
    const printed=(e)=>e.r.label+' · '+(e.at<start?UI.day(e.at)+' ':'')+timeLabel(e.at)+' · '+(e.group.workConflict?'Under review':e.r.status+' · '+duration(e.group.elapsed ?? e.r.elapsed));
    const axis=h('div.wf-time-axis',Array.from({length:5},(_,i)=>h('span',timeLabel(new Date(lo+(hi-lo)*i/4)))));
    const list=all.filter(g=>zones.some(z=>z.gardenId===g.id)||events.some(e=>e.r.gardenId===g.id));
    function openRun(e) {
      const details=history(e.group,'run');
      details.open=true;
      sheet(gardenName(e.r.gardenId)+' · '+e.r.label,[details],'Done');
    }
    function lane(g) {
      const own=events.filter(e=>e.r.gardenId===g.id).sort((a,b)=>a.at-b.at);
      const tracks=[];
      for(const event of own) {
        let track=tracks.find(t=>+t.at(-1).finish+120000<+event.at);
        if(!track) {track=[]; tracks.push(track);}
        track.push(event);
      }
      if(!tracks.length) tracks.push([]);
      return h('div.wf-lane',h('button.wf-lane-name',{type:'button',onclick:()=>selectGarden(g.id)},g.name),
        h('div.wf-lane-plot',tracks.map(track=>h('div.wf-time-track',track.map(e=>h('button.wf-run-block',{type:'button',dataset:{status:e.group.workConflict?'review':e.r.status},
          style:{left:'min(calc(100% - 8px), '+pos(+e.at)+'%)',width:(pos(+e.finish)-pos(+e.at))+'%'},title:printed(e),'aria-label':printed(e),
          onclick:()=>openRun(e)})))),
          +nowDate>=lo&&+nowDate<=hi?h('i.wf-now',{title:'Now · '+timeLabel(nowDate),'aria-hidden':'true',style:{left:pos(+nowDate)+'%'}}):null));
    }
    const completed=events.filter(e=>!e.group.workConflict&&e.r.status==='Completed').length;
    return board('Today',UI.dayLong(nowDate),h('div.wf-day-lead',h('strong',events.length?completed+' completed':'No runs recorded today'),
      events.length?note(events.length+' recorded · select a run for its details'):note('Runs appear here when you record them.')),
      h('div.wf-schedule',h('div.wf-axis-wrap',h('span','Garden'),axis),list.map(lane)),
      events.length?h('div.wf-legend',Array.from(new Set(events.map(e=>e.group.workConflict?'Under review':e.r.status))).map(status=>h('span',h('i',{dataset:{status},'aria-hidden':'true'}),status))):null,
      events.length?h('details.wf-more',h('summary','Run list · '+events.length),events.map(e=>button(gardenName(e.r.gardenId)+' · '+printed(e),()=>openRun(e),'wf-open-run'))):null);
  }

  function render() {
    show();
    if (!App.state.ready || App.state.view!=='water') return;
    const host=document.getElementById('wfWrap'), b=book(), all=gardens(), garden=all.find(g=>g.id===gardenId);
    if(!garden) gardenId='';
    const isWater=lens==='Irrigation', tanks=rows('tanks',gardenId), zones=rows('zones',gardenId);
    const dueByTank=new Set(tanks.filter(t=>W.reminder(b,t.id)).map(t=>t.id));
    const groups=W.groups(b,isWater?'run':'refill').filter(r=>!gardenId||r.chosen.gardenId===gardenId);
    const records=isWater?groups.filter(g=>insidePeriod(g.chosen)):groups, total=isWater?W.runSummary(records):null;
    const configured=new Set((isWater?zones:tanks).map(row=>row.gardenId));
    if(isWater) for(const r of [...activeSoil(),...activeSoil('soilDays')]) configured.add(r.gardenId);
    for (const group of groups) configured.add(group.chosen.gardenId);
    if(!isWater) {
      for(const table of ['labs','targets']) for(const row of rows(table)) configured.add(row.gardenId);
      for(const group of W.groups(b,'spread')) configured.add(group.chosen.gardenId);
    }
    const selected=garden?[garden]:all.filter(g=>configured.has(g.id));
    const filter=field('Garden',gardenId,null,[['','All gardens'],...opts(all)]);
    filter.control.onchange=()=>selectGarden(filter.get());
    const navigation=switcher('Water dashboard',['Fertility','Irrigation'],lens,x=>{lens=x;});
    const timeLens=isWater?switcher('Irrigation period',['Today','Last 7 days','Season'],period,x=>{period=x;}):
      switcher('Fertility view',['Now','Season','Soil tests'],fertilityView,x=>{fertilityView=x;});
    const title=h('header.wf-dashboard-head',h('div',h('div.wf-title',h('h2',lens),navigation),
      note(UI.dayLong(new Date())+(isWater?' · Recorded irrigation':(' · '+countOf(dueByTank.size,'refill')+' due')))),timeLens);
    const tools=line(document.body.classList.contains('phone')?button('Back to Tasks',()=>App.setView('sow'),'wf-return-tasks'):null,filter.el,isWater?nativeLink():[button('Products and recipes',library,'wf-products'),button('Fertilizer supplies',openSupplies,'wf-open-supplies')]);
    tools.classList.add('wf-tools');
    const actions=all.length?h('div.wf-work-actions',
      button('Record watering',()=>runForm(null,gardenId),'wf-log-watering',zones.length>0 || tanks.length>0),
      button('Add Dosatron',()=>addInjector(gardenId),'wf-add-injector',!zones.length && !tanks.length)):null;
    const content=[title,actions,tools];
    if(!all.length) content.push(board('Growing areas',null,note('Add a garden on the Map to get started.'),button('Open Map',()=>{
      if(document.body.classList.contains('phone')) root.LRFSowView.leavePhone();
      App.setView('map');
    },'wf-open-map')));
    else if(isWater) {
      if(period==='Today') content.push(todayRuns(garden?[garden]:all,groups,zones));
      const reviews=W.runSummary(groups).reviews;
      if(reviews.length || !garden) content.push(board('Needs attention',reviews.length+' to review',reviews.length ?
        [...new Set(reviews.map(r=>r.chosen.gardenId))].map(id=>{
          const own=reviews.filter(r=>r.chosen.gardenId===id), g=all.find(item=>item.id===id);
          return h('div.wf-quiet-row',g?gardenLink(g):gardenName(id),note(own.length+' run records need review'),button('Review run evidence ('+own.length+')',()=>evidenceList(own),'wf-review'));
        }):note('No run evidence awaiting review.')));
      const span=period==='Season'?'Season · '+App.planYear():'Last 7 days';
      const summary=h('div.wf-stats',h('div',h('small','Water applied'),h('strong',volumeLine(total))),h('div',h('small','Recorded runs'),h('strong',runLine(total))));
      const summaryBoard=board(span,null,summary,period==='Last 7 days' && records.length?weekChart(records):null,
        period==='Today'?button('Season totals',()=>{period='Season';render();},'wf-season-totals'):null);
      if(period!=='Today') content.push(summaryBoard);
      if(garden) content.push(irrigationGarden(garden,zones,records));
      else {
        const quiet=selected.filter(g=>!reviews.some(r=>r.chosen.gardenId===g.id));
        const waiting=all.filter(g=>!configured.has(g.id));
        const samples=activeSoil().filter(r=>r.kind==='soilmoisture').sort((a,b)=>b.at.localeCompare(a.at));
        const tracked=quiet.filter(g=>records.some(r=>r.chosen.gardenId===g.id));
        const awaiting=quiet.filter(g=>!tracked.includes(g));
        if(tracked.length) content.push(board('Recorded','No reports to review',tracked.map(g=>{
          const own=records.filter(r=>r.chosen.gardenId===g.id), last=samples.find(r=>r.gardenId===g.id);
          const conflicting=last && samples.some(r=>r!==last && E.identity(r.gateway,r.channel,r)===E.identity(last.gateway,last.channel,last));
          const moisture=last?(conflicting?'Moisture reading disputed':soilLabel(last))+' · '+when(last.at):'No soil moisture reading';
          return h('div.wf-quiet-row',gardenLink(g),h('div',h('strong',volumeLine(W.runSummary(own))),note(moisture)),button('View irrigation',()=>selectGarden(g.id),'wf-select-garden'));
        })));
        if(awaiting.length||waiting.length) content.push(board('Your gardens',awaiting.length+' awaiting runs · '+waiting.length+' not set up',
          awaiting.map(g=>h('div.wf-quiet-row',gardenLink(g),note('No runs recorded in this period'),button('View irrigation',()=>selectGarden(g.id),'wf-select-garden'))),setupRows(waiting,true)));
      }
      if(period==='Today') content.push(summaryBoard);
    } else if(fertilityView==='Now') {
      if(garden) content.push(fertilityGarden(garden,tanks,records,dueByTank,true));
      else content.push(...fertilityOverview(all,tanks.filter(t=>dueByTank.has(t.id)),configured));
    } else if(fertilityView==='Season') {
      content.push(...selected.map(seasonBoard));
      if(!garden) {
        const waiting=all.filter(g=>!configured.has(g.id));
        if(waiting.length) content.push(board('Gardens to set up',waiting.length,setupRows(waiting,false)));
      }
    } else if(garden) content.push(gardenTests(garden));
    else {
      const labs=rows('labs'), withReports=all.filter(g=>labs.some(r=>r.gardenId===g.id));
      content.push(board('Soil and tissue tests',labs.length+' readings',withReports.length?withReports.map(g=>
        h('div.wf-summary-row',gardenLink(g),button('View readings',()=>selectGarden(g.id),'wf-select-garden'))):
        note('Choose a garden to review its first lab report.')));
    }
    host.replaceChildren(...content.filter(Boolean));
  }
  function init() { App.on('view',()=>{close();render();}); App.on('plan',()=>{render();if(activeDialog?.open && refreshSheet) refreshSheet();}); }
  root.LRFWaterView={init,render,tasks,supplies,library,gardenCard,on,tick};
})(window);
