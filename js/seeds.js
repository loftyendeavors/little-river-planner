/* Little River Farm Planner — the seed library.
 *
 * Varieties and crops are added and edited here. A variety can be read from a supplier's product
 * page: by its link, through the grower's own fetch service, or from the page pasted in, which
 * needs no service and no connection. Nothing is saved until it has been looked over.
 * "Seeds required" adds up what the plan needs of each variety. There are no order reminders.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine, Lib = root.LRFLibrary, SL = root.LRFSeedLib, Reader = root.LRFReader;
  const { h, clear, add, num, toast, day } = UI;
  const $ = id => document.getElementById(id);
  const ui = { tab: 'varieties', query: '', filter: 'all', dirty: true };
  const ENV_LABEL = { field: 'Field', tunnel: 'Unheated tunnel', heated: 'Heated greenhouse', tower: 'Towers' };
  const BASIS_TEXT = { seed: 'seeding', transplant: 'transplanting', unspecified: 'not stated' };
  const BASIS_OPTIONS = [['unspecified', 'Not stated'], ['seed', 'Seeding'], ['transplant', 'Transplanting into the bed']];
  const STAGE_OPTIONS = [['unspecified', 'Not stated'], ['mature', 'Mature'], ['baby', 'Baby'], ['flower', 'First flower or cut']];
  const NEW_CROP = '__new_crop__', NEW_VARIETY = '__new__';

  // ───────────────────────── link reader settings (this browser only) ─────────────────────────
  const SERVICE_KEY = 'lrf-next:fetch';
  function service() { try { const s = JSON.parse(root.localStorage.getItem(SERVICE_KEY) || 'null'); return s && typeof s === 'object' ? { base: String(s.base || ''), key: String(s.key || '') } : { base: '', key: '' }; } catch (_) { return { base: '', key: '' }; } }
  function keepService(s) { try { if (s) root.localStorage.setItem(SERVICE_KEY, JSON.stringify(s)); else root.localStorage.removeItem(SERVICE_KEY); return true; } catch (_) { return false; } }
  const serviceReady = () => { const s = service(); return !!(Reader.serviceBase(s.base) && s.key.trim()); };

  // ───────────────────────── small form pieces ─────────────────────────
  const fld = (label, control, hint) => h('label.fld', h('span', label), control, hint ? h('small', hint) : null);
  const inp = (name, value, attrs = {}) => h('input', { name, value: value == null ? '' : value, autocomplete: 'off', ...attrs });
  const numIn = (name, value, attrs = {}) => inp(name, value, { type: 'number', step: 'any', min: 0, ...attrs });
  const sel = (name, options, value, attrs = {}) => h('select', { name, ...attrs }, options.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
  const val = (form, name) => { const el = form.elements[name]; return el ? el.value : undefined; };
  const round = (n, d = 2) => n == null || n === '' || Number.isNaN(+n) ? '' : String(Math.round(+n * 10 ** d) / 10 ** d);
  function openDialog(title, lead) {
    const body = h('div.dlg-body'), status = h('p.dlg-status', { role: 'status', 'aria-live': 'polite' });
    const el = h('dialog.dialog.wide', { oncancel: e => { e.preventDefault(); api.close(); } }, h('h2', title), lead ? h('p.dlg-lead', lead) : null, body, status);
    const api = { el, body, closed: false, close() { if (api.closed) return; api.closed = true; el.close(); el.remove(); }, say(text, kind) { status.textContent = text || ''; status.dataset.kind = kind || ''; } };
    document.body.append(el); el.showModal();
    return api;
  }
  const actions = (...buttons) => h('div.dialog-actions', buttons);
  const button = (label, onclick, kind) => h('button.btn' + (kind ? '.' + kind : ''), { type: 'button', onclick }, label);
  const cropName = c => (c ? c.name : 'Crop');
  const usedBy = id => App.state.plan.plantings.filter(p => p.varietyId === id).length;
  const sortedCrops = () => App.state.engine.crops().slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const daysText = v => v.catalogDtm ? (v.catalogDtmMax && v.catalogDtmMax !== v.catalogDtm ? `${v.catalogDtm}–${v.catalogDtmMax}` : String(v.catalogDtm)) : v.dtm > 0 ? String(v.dtm) : '';

  /** What the planner would count for a variety record, in each growing condition the farm has. */
  function planningDays(variety) {
    const plan = App.state.plan, others = plan.varieties.filter(v => v.id !== variety.id);
    const eng = E.create({ ...plan, varieties: [...others, variety] }, Lib), out = [];
    for (const env of eng.ENVS) { const t = eng.timingFor(variety.cropId, variety.id, env); if (t.source !== 'none' && t.value) out.push({ env, days: t.value, source: t.source, printed: t.printed, basis: t.basis }); }
    return out;
  }
  function planningLine(variety, crop) {
    if (!crop) return 'Choose the crop to see the days the planner will count.';
    let list;
    try { list = planningDays(variety); } catch (_) { return ''; }
    if (!list.length) return '';
    const same = list.every(x => x.days === list[0].days), text = same ? `${list[0].days} days` : list.map(x => `${ENV_LABEL[x.env].toLowerCase()} ${x.days}`).join(' · ') + ' days';
    const supplier = list.some(x => x.source === 'supplier'), field = list.find(x => x.env === 'field') || list[0];
    let why = '';
    if (!variety.catalogDtm && !(variety.dtm > 0)) why = ' That is the crop’s number: this variety has none of its own.';
    else if (variety.catalogDtm && !supplier) why = ` The supplier’s ${variety.catalogDtm} days cannot be used as given (${crop.method === 'DS' && variety.catalogMaturityBasis === 'transplant' ? 'it counts from transplanting and this crop is direct sown' : 'less the nursery time it leaves nothing'}), so the crop’s number stands.`;
    else if (supplier && field.printed && field.days !== field.printed) why = ` The supplier prints ${field.printed} from ${BASIS_TEXT[field.basis] || 'seeding'}; the nursery time is taken off.`;
    else if (supplier && variety.catalogMaturityBasis === 'unspecified' && crop.method === 'TP') why = field.basis && field.basis !== 'unspecified' ? ` No starting point is set, so the planner goes by the page text and reads it as from ${BASIS_TEXT[field.basis]}.` : ' No starting point is set, so the printed days are counted from the day it goes in the bed.';
    return `The planner will count ${text} from the day it goes in the bed.${why}`;
  }

  // ───────────────────────── importer: link or pasted page, review, save ─────────────────────────
  function openImporter(startURL, startCropId) {
    const d = openDialog('Add a variety from a supplier page', 'Nothing is saved until you have looked it over.');
    let busy = false;
    const url = inp('url', startURL || '', { type: 'text', inputMode: 'url', placeholder: 'https://… the page for one variety', spellcheck: false });
    const pasteName = inp('pasteName', '', { maxLength: 200, placeholder: 'Variety name' });
    const pasteText = h('textarea', { name: 'pasteText', rows: 6, maxLength: 96000, placeholder: 'On the product page: select all, copy, paste here. Page source gives a fuller read.' });
    const readBtn = button('Read page', () => read('link'), 'primary'), pasteBtn = button('Read pasted page', () => read('paste'));
    const ready = serviceReady();
    const intake = h('form.sd-intake', { onsubmit: e => { e.preventDefault(); read('link'); } },
      fld('Product link', url, ready ? 'Read through your fetch service. Johnny’s, Berbee, Harris, Fedco and 11 other suppliers are on its list.' : 'Reading from a link needs the link reader set up (Link reader… on the seed library). Pasting the page works without it.'),
      h('div.sd-row', readBtn, button('Cancel', () => d.close())),
      h('details.sd-paste', { open: !ready }, h('summary', 'Paste the page instead'),
        h('p.dlg-hint', 'Works with no connection and for any supplier. Give the link above too, so the variety keeps its source.'),
        fld('Variety name', pasteName), fld('Copied page', pasteText), h('div.sd-row', pasteBtn)));
    d.body.append(intake);
    url.focus();

    async function read(how) {
      if (busy) return;
      let data;
      busy = true; readBtn.disabled = pasteBtn.disabled = true; d.say(how === 'link' ? 'Reading the page…' : 'Reading what you pasted…');
      try {
        if (how === 'link') data = await Reader.readLink(url.value.trim(), service());
        else data = Reader.readPasted(pasteText.value, url.value.trim(), pasteName.value.trim() || ' ');
      } catch (error) {
        const paste = how === 'link' ? ' You can paste the page instead.' : '';
        d.say(error && error.name !== 'TypeError' && error.message ? error.message + (/paste/i.test(error.message) ? '' : paste) : 'The page could not be read.' + paste, 'bad');
        if (how === 'link') intake.querySelector('details').open = true;
        busy = false; readBtn.disabled = pasteBtn.disabled = false;
        return;
      }
      busy = false;
      if (d.closed) return;
      d.say('');
      review(d, data, startCropId, () => { clear(d.body).append(intake); readBtn.disabled = pasteBtn.disabled = false; d.say(''); });
    }
  }

  function review(d, data, startCropId, back) {
    const eng = App.state.engine, plan = App.state.plan, crops = sortedCrops(), f = data.facts || {}, ev = data.evidence || {};
    const guess = SL.inferCrop(data, crops) || startCropId || '';
    const exact = x => (x && x.min === x.max ? x.min : '');
    const nursery = f.nurseryDays || null;
    const form = h('form.sd-review', { novalidate: true, onsubmit: e => { e.preventDefault(); save(); } });
    const cropSel = sel('cropId', [['', 'Choose the crop'], ...crops.map(c => [c.id, c.name]), [NEW_CROP, '+ A new crop…']], guess, { required: true });
    const newCropBox = h('div.sd-grid.sd-newcrop', { hidden: true },
      fld('New crop name', inp('newCropName', '', { maxLength: 160 })), fld('Plant family (optional)', inp('newCropFamily', '', { maxLength: 160 })),
      fld('How it is planted', sel('newCropMethod', [['TP', 'Transplanted'], ['DS', 'Direct sown']], 'TP')), fld('Planted from', sel('newCropMaterial', [['seed', 'Seed'], ['plant', 'Bought-in plants'], ['bulb', 'Bulbs'], ['clove', 'Cloves'], ['piece', 'Seed pieces']], 'seed')));
    const matchBox = h('div.sd-match'), planLine = h('p.sd-plan'), startNote = h('p.sd-evidence');
    const basisSel = sel('basis', BASIS_OPTIONS, f.maturityBasis || 'unspecified');
    const stageSel = sel('stage', STAGE_OPTIONS, 'unspecified');
    const dtmMin = numIn('dtmMin', f.maturity ? f.maturity.min : '', { min: 1, max: 3650, step: 1 }), dtmMax = numIn('dtmMax', f.maturity ? f.maturity.max : '', { min: 1, max: 3650, step: 1 });
    const printed = ev.maturity && ev.maturity.value ? String(ev.maturity.value).slice(0, 120) : '';
    const stageButtons = (data.stages || []).map(s => button(`${s.min === s.max ? s.min : s.min + '–' + s.max} · ${s.stage}`, () => {
      dtmMin.value = s.min; dtmMax.value = s.max;
      stageSel.value = /baby|leaf/.test(s.stage) ? 'baby' : /flower|bloom|cut/.test(s.stage) ? 'flower' : /full|ripe|mature|red|orange|yellow|seed/.test(s.stage) ? 'mature' : stageSel.value;
      refresh();
    }, 'small'));
    const start = data.start || { basis: 'unspecified', statement: '' };
    add(startNote, start.statement ? h('span', `${start.source || 'Supplier page'}: “${start.statement}”`) : h('span', 'The page does not say where its days are counted from.'),
      start.conditional ? h('b', ' It gives a rule per use, so choose.') : null);
    const photo = data.images && data.images[0] ? h('img.sd-photo', { src: data.images[0].url, alt: '', referrerPolicy: 'no-referrer', loading: 'lazy', onerror: e => { const note = e.target.nextElementSibling; if (note && note.classList.contains('sd-photo-note')) note.remove(); e.target.remove(); } }) : null;

    form.append(
      h('div.sd-cols',
        h('div',
          h('h3', 'Variety and source'),
          h('div.sd-grid', fld('Variety name', inp('name', data.name, { maxLength: 200, required: true })), fld('Crop', cropSel), fld('Supplier', inp('supplier', data.supplier)), fld('Product code', inp('sku', data.sku))),
          newCropBox, matchBox,
          h('h3', 'Days to maturity'),
          printed ? h('p.sd-evidence', h('span', `The page prints: “${printed}”`), stageButtons.length ? h('span.sd-stages', stageButtons) : null) : h('p.sd-evidence', 'No days to maturity were found on the page.'),
          h('div.sd-grid', fld('Earliest day', dtmMin), fld('Latest day', dtmMax), fld('Counted from', basisSel), fld('Harvest stage', stageSel)),
          startNote, planLine,
          h('h3', 'Growing and seed'),
          h('div.sd-grid',
            fld('In-row spacing (in)', numIn('inRow', exact(f.inRow)), f.inRow && f.inRow.min !== f.inRow.max ? `Page: ${f.inRow.printed}` : ev.inRow && ev.inRow.label === 'Alternative spacing instructions' ? `Page gives ${ev.inRow.value}` : 'Empty uses the crop’s'),
            fld('Rows per bed', numIn('rowsPerBed', '', { min: 1, max: 1000, step: 1 }), 'Empty uses the crop’s'),
            fld('Days in nursery', numIn('nurseryDays', exact(nursery), { max: 728 }), nursery ? `Page: ${nursery.min === nursery.max ? nursery.min : nursery.min + '–' + nursery.max} days` : 'Empty uses the crop’s'),
            fld('Germination (%)', numIn('germ', f.germinationPercent, { max: 100 }), 'Empty uses the plan’s'),
            fld('Seeds per packet', numIn('seedsPerPacket', f.seedsPerPacket, { min: 1 })), fld('Seeds per ounce', numIn('seedsPerOz', f.seedsPerOz, { min: 1 }), f.seedsPerLb ? `Page: ${num(f.seedsPerLb)} per lb` : null))),
        h('aside.sd-side', photo, photo ? h('p.dlg-hint.sd-photo-note', 'Shown from the supplier’s site. Photos are not saved with the variety yet.') : null,
          (data.warnings || []).length ? h('ul.sd-warn', data.warnings.map(w => h('li', w))) : null,
          h('p.dlg-hint', `${data.extraction || 'Read'}${(data.refined || []).length ? ' · corrected here: ' + data.refined.map(k => (k === 'maturity' ? 'days' : 'starting point')).join(', ') : ''}`))),
      h('details.sd-all', h('summary', `Everything read from the page (${(data.specifications || []).length} details, ${(data.prices || []).length} prices)`),
        h('dl', (data.specifications || []).slice(0, 150).map(p => [h('dt', p.label), h('dd', String(p.value).slice(0, 400))])),
        (data.prices || []).length ? h('p.dlg-hint', data.prices.map(p => `${p.label}: ${p.currency || ''} ${p.price}`).join(' · ')) : null,
        h('pre.sd-source', data.sourceText || '')),
      actions(button('Back', back), button('Cancel', () => d.close()), h('button.btn.primary', { type: 'submit', id: 'sdSave' }, 'Save to the library')));
    clear(d.body).append(form);

    const input = () => {
      const o = {};
      for (const name of ['name', 'cropId', 'supplier', 'sku', 'dtmMin', 'dtmMax', 'basis', 'stage', 'inRow', 'rowsPerBed', 'nurseryDays', 'germ', 'seedsPerPacket', 'seedsPerOz']) o[name] = val(form, name) || '';
      o.existingId = val(form, 'existingId') || '';
      o.newCrop = { name: val(form, 'newCropName'), family: val(form, 'newCropFamily'), method: val(form, 'newCropMethod'), material: val(form, 'newCropMaterial') };
      return o;
    };
    function candidate(o, crop) {
      const result = SL.fields(data, o), saved = o.existingId && o.existingId !== NEW_VARIETY ? eng.variety(o.existingId) : null;
      const base = saved ? { ...saved } : { id: 'v_url_' + App.uid(), cropId: result.patch.cropId };
      return { saved, after: { ...SL.apply(base, result), ...SL.derived(E, data.sourceText, result.patch.catalogDtmText) } };
    }
    function refresh() {
      const o = input(), fresh = o.cropId === NEW_CROP, crop = fresh ? { id: NEW_CROP, method: o.newCrop.method } : eng.crop(o.cropId);
      newCropBox.hidden = !fresh;
      // a saved variety this page belongs to
      const list = crop && !fresh ? SL.matches(plan, data, crop.id) : [], other = crop && !fresh ? SL.elsewhere(plan, data, crop.id) : null, keep = o.existingId;
      clear(matchBox);
      if (other) matchBox.append(h('p.sd-evidence.bad', `This page is already saved as ${other.name} under ${cropName(eng.crop(other.cropId))}. Choose that crop, or remove that variety first.`));
      else if (list.length) matchBox.append(fld('Already in the library', sel('existingId', [...list.map(v => [v.id, `Update ${v.name}${usedBy(v.id) ? ` (${usedBy(v.id)} planting${usedBy(v.id) === 1 ? '' : 's'})` : ''}`]), [NEW_VARIETY, 'Save as another variety']], list.some(v => v.id === keep) || keep === NEW_VARIETY ? keep : list[0].id, { onchange: refresh }),
        'Updating keeps the variety’s plantings. Those without their own days follow the new figures.'));
      const updating = list.length && (val(form, 'existingId') || '') !== NEW_VARIETY;
      $('sdSave').textContent = updating ? 'Update the saved variety' : 'Save to the library';
      $('sdSave').disabled = !!other;
      let line = '';
      if (crop && !fresh) { try { line = planningLine(candidate(input(), crop).after, crop); } catch (error) { line = error.message; } }
      else if (fresh) line = 'A new crop starts at 60 days until you set its number on the Assumptions list.';
      planLine.textContent = line;
    }
    form.addEventListener('input', refresh); form.addEventListener('change', refresh);
    refresh();

    async function save() {
      const o = input(), ops = [];
      try {
        let crop = eng.crop(o.cropId);
        if (o.cropId === NEW_CROP) {
          if (eng.crops().some(c => SL.norm(c.name) === SL.norm(o.newCrop.name))) throw new Error('A crop with that name already exists. Choose it from the list.');
          crop = SL.newCrop(o.newCrop, 'c_' + App.uid());
          ops.push({ kind: 'crop', before: null, after: crop }, cropListOp(crop.id));
          o.cropId = crop.id;
        }
        if (!crop) throw new Error('Choose the crop this variety belongs to.');
        if (o.dtmMin && crop.method === 'TP' && o.basis === 'unspecified' && !(await UI.confirm({ title: 'Save without a starting point?', confirmLabel: 'Save anyway', body: `${crop.name} is transplanted, and the page’s ${o.dtmMin} days could be counted from seeding or from transplanting. Those differ by the whole nursery time. ${planLine.textContent}` }))) return;
        const { saved, after } = candidate(o, crop);
        ops.push({ kind: 'variety', before: saved || null, after });
        const label = saved ? `Update ${after.name} from its supplier page` : `Add ${after.name} to the library`;
        if (!(await App.revise(label, ops))) return;
        const previous = saved ? await App.varietyRecord(saved.id) : null;
        const kept = await App.keepVarietyRecord(after.id, SL.record(data, o, previous));
        d.close();
        if (!kept) toast(`${after.name} is saved. This view has nowhere to keep the page text itself, so a backup made here will carry the variety without it.`);
        ui.query = ''; $('sdSearch').value = ''; ui.tab = 'varieties'; schedule();
      } catch (error) { d.say(error.message || 'That could not be saved.', 'bad'); }
    }
  }
  /** Adding a crop also puts it on the grower's own crop list, as v7 does. */
  function cropListOp(cropId) {
    const settings = App.state.plan.settings || {}, list = settings.cropTypeList && settings.cropTypeList.v === 1 ? settings.cropTypeList : { v: 1, added: [], removed: [], deleted: [] };
    return { kind: 'settings', before: settings, after: { ...settings, cropTypeList: { ...list, added: [...new Set([...(list.added || []), cropId])], removed: (list.removed || []).filter(id => id !== cropId) } } };
  }

  // ───────────────────────── a variety, by hand ─────────────────────────
  function openVariety(variety, startCropId) {
    const eng = App.state.engine, crops = sortedCrops(), v = variety || { cropId: startCropId || '' }, n = variety ? usedBy(variety.id) : 0;
    const d = openDialog(variety ? variety.name : 'Add a variety by hand', variety ? `${cropName(eng.crop(v.cropId))}${n ? ` · in ${n} planting${n === 1 ? '' : 's'}` : ' · not planted this season'}` : 'For a variety with no supplier page. One with a page is better added from it.');
    const hasSupplierDays = !!v.catalogDtm, evidence = h('p.sd-evidence'), planLine = h('p.sd-plan');
    const form = h('form.sd-review', { novalidate: true, onsubmit: e => { e.preventDefault(); save(); } },
      h('h3', 'Variety and source'),
      h('div.sd-grid', fld('Variety name', inp('name', v.name, { maxLength: 200, required: true })),
        fld('Crop', sel('cropId', [['', 'Choose the crop'], ...crops.map(c => [c.id, c.name])], v.cropId, { disabled: n > 0 }), n ? 'Fixed while plantings use it' : null),
        fld('Supplier', inp('supplier', v.supplier || (v.source === 'Farm entry' ? '' : v.source))), fld('Product code', inp('sku', v.sku)),
        h('label.fld.span2', h('span', 'Product page'), inp('url', v.url, { type: 'text', inputMode: 'url', spellcheck: false }))),
      h('h3', 'Days to maturity'),
      h('div.sd-grid', fld('Supplier’s earliest day', numIn('dtmMin', v.catalogDtm, { min: 1, max: 3650, step: 1 })), fld('Supplier’s latest day', numIn('dtmMax', v.catalogDtmMax, { min: 1, max: 3650, step: 1 })),
        fld('Counted from', sel('basis', BASIS_OPTIONS, v.catalogMaturityBasis || 'unspecified')), fld('Harvest stage', sel('stage', STAGE_OPTIONS, v.catalogHarvestStage || 'unspecified')),
        hasSupplierDays ? null : fld('Your own days to harvest', numIn('dtm', v.dtm, { min: 1, max: 3650, step: 1 }), 'From the day it goes in the bed. Use this or the supplier’s days.')),
      evidence, planLine,
      h('h3', 'Growing and seed'),
      h('div.sd-grid',
        fld('In-row spacing (in)', numIn('inRow', v.inRow), 'Empty uses the crop’s'), fld('Row spacing (in)', numIn('rowSp', v.rowSp), 'Empty uses the crop’s'), fld('Rows per bed', numIn('rowsPerBed', v.rowsPerBed, { min: 1, max: 1000, step: 1 }), 'Empty uses the crop’s'),
        fld('Days in nursery', numIn('nurseryDays', v.gh != null ? round(v.gh * 7, 1) : '', { max: 728 }), 'Empty uses the crop’s'), fld('Germination (%)', numIn('germ', v.germ, { max: 100 }), 'Empty uses the plan’s'),
        fld('Seeds per packet', numIn('seedsPerPacket', v.seedsPerPacket, { min: 1 })), fld('Seeds per ounce', numIn('seedsPerOz', v.seedsPerOz, { min: 1 })), fld('Seeds per pound', numIn('seedsPerLb', v.seedsPerLb, { min: 1 })),
        h('label.fld.span2', h('span', 'Notes'), h('textarea', { name: 'notes', rows: 2, value: v.notes || '' }))),
      actions(
        variety && !n ? button('Remove from the library', remove, 'danger') : null,
        variety && v.url ? button('Read its page again', () => { d.close(); openImporter(v.url, v.cropId); }) : null,
        h('span.grow'), button('Cancel', () => d.close()), h('button.btn.primary', { type: 'submit' }, variety ? 'Save' : 'Add to the library')));
    d.body.append(form);

    // what the supplier's page said, when its text was kept
    if (variety) App.varietyRecord(variety.id).then(record => {
      if (d.closed || !record) return;
      const w = record.webImport || {}, s = Reader.maturityStatement({ url: v.url, sourceText: record.catalogSourceText || w.sourceText || '', specifications: w.specifications || [] });
      const printed = w.evidence && w.evidence.maturity && w.evidence.maturity.value ? String(w.evidence.maturity.value).slice(0, 120) : '';
      add(clear(evidence), printed ? h('span', `The page printed: “${printed}”. `) : null, s.statement ? h('span', `${s.source}: “${s.statement}”`) : h('span', 'Its saved page does not say where the days are counted from.'),
        s.basis !== 'unspecified' && s.basis !== val(form, 'basis') ? button(`Set to ${BASIS_TEXT[s.basis]}`, () => { form.elements.basis.value = s.basis; refresh(); }, 'small') : null);
    }).catch(() => {});

    const input = () => {
      const o = {};
      for (const name of ['name', 'cropId', 'supplier', 'sku', 'url', 'dtmMin', 'dtmMax', 'basis', 'stage', 'inRow', 'rowSp', 'rowsPerBed', 'germ', 'seedsPerPacket', 'seedsPerOz', 'seedsPerLb', 'notes']) o[name] = val(form, name) || '';
      if (!hasSupplierDays) o.dtm = val(form, 'dtm') || '';
      // days in nursery are only written when changed, so an untouched variety keeps following its crop
      const nurseryNow = val(form, 'nurseryDays') || '', nurseryWas = v.gh != null ? round(v.gh * 7, 1) : '';
      if (nurseryNow !== nurseryWas) o.nurseryDays = nurseryNow;
      return o;
    };
    function build() {
      const o = input();
      if (o.url && !SL.urlKey(o.url)) throw new Error('Product page: give a complete https address, or leave it empty.');
      const result = SL.fields(null, o, { edit: !!variety, hadSupplierDays: hasSupplierDays });
      if (variety && o.nurseryDays === '') result.cleared.push('gh');
      const base = variety ? { ...variety } : { id: 'v_named_' + App.uid(), cropId: result.patch.cropId };
      const after = SL.apply(base, result);
      // an edit that leaves the days and their starting point alone does not change how they are read
      if (variety && !variety.catalogSourceChoice && after.catalogDtm === variety.catalogDtm && after.catalogMaturityBasis === (variety.catalogMaturityBasis || 'unspecified')) delete after.catalogSourceChoice;
      if (!after.catalogDtm && !variety) for (const key of ['catalogDtm', 'catalogDtmMax', 'catalogMaturityBasis', 'catalogDtmText', 'catalogHarvestStage', 'catalogSupplier', 'catalogTitle', 'catalogPage', 'catalogYear', 'catalogPdfPage', 'maturitySource']) delete after[key];
      return after;
    }
    function refresh() { try { const after = build(); planLine.textContent = planningLine(after, eng.crop(after.cropId)); } catch (error) { planLine.textContent = error.message; } }
    form.addEventListener('input', refresh); form.addEventListener('change', refresh);
    refresh();

    async function save() {
      try {
        const after = build();
        if (!eng.crop(after.cropId)) throw new Error('Choose the crop this variety belongs to.');
        if (!variety && App.state.plan.varieties.some(x => x.active !== false && !x.deleted && x.cropId === after.cropId && SL.varietyKey(x.name) === SL.varietyKey(after.name))) throw new Error(`${after.name} is already in the library under ${cropName(eng.crop(after.cropId))}.`);
        // a placeholder variety stays one until something about it is really changed
        const flat = x => JSON.stringify(Object.keys(x).filter(k => k !== 'stub').sort().map(k => [k, x[k]]));
        if (variety && flat(after) === flat(variety)) { d.close(); return; }
        if (await App.revise(variety ? `Edit ${after.name}` : `Add ${after.name} to the library`, [{ kind: 'variety', before: variety || null, after }])) { d.close(); schedule(); }
      } catch (error) { d.say(error.message || 'That could not be saved.', 'bad'); }
    }
    async function remove() {
      if (await App.revise(`Remove ${variety.name} from the library`, [{ kind: 'variety', before: variety, after: { ...variety, active: false, deleted: true } }])) { d.close(); schedule(); }
    }
  }

  // ───────────────────────── a crop ─────────────────────────
  const CROP_NUMBERS = [['inRow', 'In-row spacing (in)', 0.01, 2400], ['rowSp', 'Row spacing (in)', 0.01, 2400], ['rowsPerBed', 'Rows per bed', 1, 1000, true], ['gh', 'Weeks in nursery', 0, 104], ['tray', 'Cells per tray', 1, 1000, true], ['spc', 'Seeds per cell', 0.1, 50], ['germ', 'Germination (%)', 0.1, 100], ['seedsFt', 'Seeds per foot of row (direct sown)', 0, 1000]];
  function openCrop(crop) {
    const eng = App.state.engine, plan = App.state.plan, c = crop || {}, own = crop ? (plan.crops || []).find(x => x.id === crop.id) || null : null;
    const n = crop ? plan.plantings.filter(p => p.cropId === crop.id).length : 0;
    const d = openDialog(crop ? crop.name : 'Add a crop', crop ? `${n ? `In ${n} planting${n === 1 ? '' : 's'}. ` : ''}Days to harvest are set on the Assumptions list, per growing condition.` : 'Give it its real numbers here, and its days to harvest on the Assumptions list.');
    const form = h('form.sd-review', { novalidate: true, onsubmit: e => { e.preventDefault(); save(); } },
      h('div.sd-grid', fld('Crop name', inp('name', c.name, { maxLength: 160, required: true })), fld('Plant family', inp('family', c.family, { maxLength: 160 })),
        fld('How it is planted', sel('method', [['TP', 'Transplanted'], ['DS', 'Direct sown']], c.method || 'TP')),
        fld('Planted from', sel('plantingMaterial', [['seed', 'Seed'], ['plant', 'Bought-in plants'], ['bulb', 'Bulbs'], ['clove', 'Cloves'], ['piece', 'Seed pieces']], c.plantingMaterial || (c.material === 'bulb' ? 'bulb' : 'seed'))),
        CROP_NUMBERS.map(([key, label, lo, hi, whole]) => fld(label, numIn(key, c[key] == null ? '' : c[key], { min: lo, max: hi, step: whole ? 1 : 'any' }), key === 'rowsPerBed' ? 'Empty: as many as the bed width takes' : key === 'germ' ? 'Empty uses the plan’s' : null))),
      actions(h('span.grow'), button('Cancel', () => d.close()), h('button.btn.primary', { type: 'submit' }, crop ? 'Save' : 'Add the crop')));
    d.body.append(form);
    async function save() {
      try {
        const name = (val(form, 'name') || '').trim();
        if (!name || name.length > 160) throw new Error('Name the crop, using up to 160 characters.');
        if (eng.crops().some(x => x.id !== c.id && SL.norm(x.name) === SL.norm(name))) throw new Error('A crop with that name already exists.');
        const typed = { name, family: (val(form, 'family') || '').trim(), method: val(form, 'method'), plantingMaterial: val(form, 'plantingMaterial') };
        for (const [key, label, lo, hi, whole] of CROP_NUMBERS) {
          const raw = (val(form, key) || '').trim();
          if (raw === '') { typed[key] = null; continue; }
          const value = Number(raw);
          if (!Number.isFinite(value) || value < lo || value > hi || (whole && !Number.isInteger(value))) throw new Error(`${label}: enter ${whole ? 'a whole number' : 'a number'} from ${lo} to ${hi}.`);
          typed[key] = value;
        }
        if (!crop) {
          const fresh = SL.newCrop({ name, family: typed.family, method: typed.method, material: typed.plantingMaterial }, 'c_' + App.uid());
          for (const [key] of CROP_NUMBERS) if (typed[key] != null) fresh[key] = typed[key];
          if (await App.revise(`Add the crop ${name}`, [{ kind: 'crop', before: null, after: fresh }, cropListOp(fresh.id)])) { d.close(); schedule(); }
          return;
        }
        // only what was changed is written over the built-in crop, as v7 does
        const after = { ...(own || { id: crop.id }) };
        let changes = 0;
        for (const [key, value] of Object.entries(typed)) {
          const was = key === 'plantingMaterial' ? crop.plantingMaterial || (crop.material === 'bulb' ? 'bulb' : 'seed') : crop[key];
          if (value === null) { if (was != null && was !== '' && ['rowsPerBed', 'germ'].includes(key)) { after[key] = null; changes++; } continue; }
          if (value === was || (value === '' && was == null)) continue;
          after[key] = value; changes++;
        }
        if (!changes) { d.close(); return; }
        if (await App.revise(`Edit the crop ${name}`, [{ kind: 'crop', before: own, after }])) { d.close(); schedule(); }
      } catch (error) { d.say(error.message || 'That could not be saved.', 'bad'); }
    }
  }

  // ───────────────────────── link reader settings ─────────────────────────
  function openSettings() {
    const now = service(), d = openDialog('Link reader', 'A web page may not read another website’s pages, so links are read through your own fetch service. Its address and key are kept in this browser only. They are never put in the plan or in a backup.');
    const base = inp('base', now.base, { type: 'text', inputMode: 'url', placeholder: 'https://… .workers.dev', spellcheck: false }), key = inp('key', now.key, { type: 'password', spellcheck: false, autocomplete: 'off' });
    const show = h('label.sd-check', h('input', { type: 'checkbox', onchange: e => { key.type = e.target.checked ? 'text' : 'password'; } }), ' Show the key');
    const typed = () => ({ base: base.value.trim(), key: key.value.trim() });
    let testing = false;
    const testBtn = button('Test connection', async () => {
      if (testing) return;
      testing = true; testBtn.disabled = true; d.say('Asking the service…');
      const result = await Reader.testService(typed());
      testing = false; testBtn.disabled = false;
      if (!d.closed) d.say(result.message, result.ok ? 'good' : 'bad');
    });
    d.body.append(h('form.sd-review', { onsubmit: e => { e.preventDefault(); } },
      fld('Service address', base), fld('Key', key), show,
      h('p.dlg-hint', 'The test sends the key to the service and asks it for one supplier’s home page. It reads nothing from your plan.'),
      actions(now.base || now.key ? button('Forget them', () => { keepService(null); d.close(); toast('The link reader’s address and key were removed from this browser.'); schedule(); }, 'danger') : null, h('span.grow'), testBtn, button('Cancel', () => d.close()),
        button('Save', () => {
          const s = typed();
          if (s.base && !Reader.serviceBase(s.base)) { d.say('That is not a complete https address.', 'bad'); return; }
          if (!keepService(s.base || s.key ? s : null)) { d.say('This browser would not keep them. Its storage may be switched off.', 'bad'); return; }
          d.close(); toast(s.base && s.key ? 'Link reader saved in this browser.' : 'Link reader cleared.'); schedule();
        }, 'primary'))));
  }

  // ───────────────────────── the two lists ─────────────────────────
  let frame = 0;
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(render); };
  function render() {
    if (!App.state.ready || App.state.view !== 'seeds') { ui.dirty = true; return; }
    ui.dirty = false;
    for (const b of document.querySelectorAll('[data-sd-tab]')) b.setAttribute('aria-pressed', String(b.dataset.sdTab === ui.tab));
    $('sdSettings').textContent = serviceReady() ? 'Link reader: set' : 'Link reader…';
    const eng = App.state.engine, plan = App.state.plan, q = ui.query.trim().toLowerCase();
    const live = plan.varieties.filter(v => v.active !== false && !v.deleted), need = SL.required(eng);
    document.querySelector('[data-sd-tab="varieties"] small').textContent = live.length;
    document.querySelector('[data-sd-tab="required"] small').textContent = need.rows.filter(r => r.toSow > 0).length;
    $('sdFilters').hidden = ui.tab !== 'varieties';
    if (ui.tab === 'varieties') varieties(eng, plan, live, q); else required(eng, need, q);
  }
  function varieties(eng, plan, live, q) {
    const used = new Map();
    for (const p of plan.plantings) if (p.varietyId) used.set(p.varietyId, (used.get(p.varietyId) || 0) + 1);
    const open = v => !!v.catalogDtm && (v.catalogMaturityBasis || 'unspecified') === 'unspecified';
    const counts = { all: live.length, planted: live.filter(v => used.has(v.id)).length, open: live.filter(open).length };
    add(clear($('sdFilters')), [['all', 'All'], ['planted', 'Planted this season'], ['open', 'Days with no starting point']].map(([id, label]) =>
      h('button.chip', { type: 'button', 'aria-pressed': String(ui.filter === id), onclick: () => { ui.filter = id; schedule(); } }, label, h('small', counts[id]))));
    $('sdLead').textContent = 'Every variety on file, by crop. Click one to edit it. A variety’s own days beat its crop’s; a planting with no variety uses the crop’s.';
    clear($('sdHead')).append(h('tr', ['Variety', 'Supplier', 'Days', 'Counted from', 'Packet', 'Plantings'].map(t => h('th', t))));
    const body = clear($('sdBody')), byCrop = new Map();
    for (const v of live) {
      if (ui.filter === 'planted' && !used.has(v.id)) continue;
      if (ui.filter === 'open' && !open(v)) continue;
      const crop = eng.crop(v.cropId), text = `${v.name} ${cropName(crop)} ${v.supplier || v.source || ''} ${v.sku || ''}`.toLowerCase();
      if (q && !text.includes(q)) continue;
      if (!byCrop.has(v.cropId)) byCrop.set(v.cropId, []);
      byCrop.get(v.cropId).push(v);
    }
    const groups = [...byCrop.entries()].map(([id, list]) => ({ crop: eng.crop(id), id, list: list.sort((a, b) => String(a.name).localeCompare(String(b.name))) })).sort((a, b) => cropName(a.crop).localeCompare(cropName(b.crop)));
    let shown = 0;
    for (const g of groups) {
      body.append(h('tr.sd-crop', h('td', { colSpan: 6 }, h('div.as-name',
        h('i.swatch', { style: { background: g.crop ? eng.cropColor(g.crop) : 'var(--line)' } }), h('b', g.crop ? g.crop.name : 'A crop that is no longer in the library'),
        g.crop ? h('small', g.crop.method === 'TP' ? 'transplanted' : 'direct sown') : null,
        g.crop ? h('button.link', { type: 'button', onclick: () => openCrop(g.crop) }, 'Edit crop') : null,
        g.crop ? h('button.link', { type: 'button', onclick: () => openVariety(null, g.id) }, 'Add a variety') : null))));
      for (const v of g.list) {
        shown++;
        const basis = v.catalogMaturityBasis || 'unspecified', days = daysText(v), host = SL.hostOf(v.url);
        body.append(h('tr.sd-var', { tabIndex: 0, role: 'button', 'aria-label': `Edit ${v.name}`, dataset: { variety: v.id }, onclick: e => { if (!e.target.closest('a')) openVariety(v); }, onkeydown: e => { if (e.key === 'Enter') openVariety(v); } },
          h('td', h('span.as-vname', v.name)),
          h('td.sd-sup', v.supplier || (v.source === 'Farm entry' ? 'Entered by hand' : v.source) || '', v.sku ? h('small', ` ${v.sku}`) : null, host ? h('a', { href: v.url, target: '_blank', rel: 'noopener noreferrer', title: `Open the page on ${host}` }, ' ↗') : null),
          h('td.sd-num', days || '—', v.catalogHarvestStage && v.catalogHarvestStage !== 'unspecified' ? h('small', ` ${v.catalogHarvestStage}`) : null),
          h('td' + (v.catalogDtm && basis === 'unspecified' ? '.sd-open' : ''), v.catalogDtm ? BASIS_TEXT[basis] : v.dtm > 0 ? 'the day it goes in the bed' : ''),
          h('td.sd-num', v.seedsPerPacket ? num(v.seedsPerPacket) : ''),
          h('td.sd-num', used.get(v.id) || '')));
      }
    }
    if (!shown) body.append(h('tr', h('td.empty', { colSpan: 6 }, q ? `No variety matches “${ui.query}”.` : ui.filter === 'open' ? 'Every variety with supplier days has a starting point.' : App.isSample() ? 'The sample plan has no varieties. Load your backup, or add one.' : 'No varieties yet. Add one from a supplier page.')));
    const bare = live.filter(v => !v.supplier && !v.url && !v.catalogDtm).length;
    $('sdFoot').textContent = live.length && bare === live.length ? 'These varieties carry planning figures only. Supplier, product code and page come in when you load your backup here.' : counts.open ? `${counts.open} variet${counts.open === 1 ? 'y has' : 'ies have'} supplier days with no starting point. For a transplanted crop that can move the harvest by the whole nursery time.` : '';
  }
  function required(eng, need, q) {
    const rows = need.rows.filter(r => !q || `${cropName(r.crop)} ${r.variety ? r.variety.name : ''} ${r.variety ? r.variety.supplier || r.variety.source || '' : ''}`.toLowerCase().includes(q));
    const sown = need.rows.reduce((n, r) => n + (r.plantings - r.waiting - r.established), 0), plain = need.rows.filter(r => !r.variety && r.toSow > 0).reduce((n, r) => n + r.waiting, 0);
    $('sdLead').textContent = `What the ${App.planYear()} plan still needs, by variety. Counts allow for ${need.settings.germ}% germination${need.settings.buffer ? ` and ${need.settings.buffer}% extra plugs on transplants` : ''}, or the variety’s own germination where it has one.`;
    clear($('sdHead')).append(h('tr', ['Crop and variety', 'Supplier', 'To sow', 'By weight', 'Packets', 'First sowing', 'Plantings'].map(t => h('th', t))));
    const body = clear($('sdBody'));
    for (const r of rows) {
      if (!(r.toSow > 0) && !q) continue;
      const m = r.unit === 'seeds' ? SL.measures(r.toSow, r.variety) : { weight: '', packets: '' }, v = r.variety;
      body.append(h('tr.sd-need', { dataset: { key: r.key } },
        h('td', h('div.as-name', h('i.swatch', { style: { background: r.crop ? eng.cropColor(r.crop) : 'var(--line)' } }), h('b', cropName(r.crop)), v ? h('span.as-vname', v.name) : h('small', 'no variety chosen'))),
        h('td.sd-sup', v ? v.supplier || (v.source === 'Farm entry' ? '' : v.source) || '' : '', v && v.sku ? h('small', ` ${v.sku}`) : null),
        h('td.sd-num', h('b', num(r.toSow, r.unit === 'g' ? 1 : 0)), h('small', ` ${r.unit === 'seeds' ? '' : SL.UNIT_WORD[r.unit]}`)),
        h('td.sd-num', m.weight), h('td.sd-num', m.packets),
        h('td.sd-num', r.first ? day(r.first) : ''),
        h('td.sd-num', r.waiting === r.plantings ? r.plantings : `${r.waiting} of ${r.plantings}`)));
    }
    if (!body.children.length) body.append(h('tr', h('td.empty', { colSpan: 7 }, q ? `Nothing matches “${ui.query}”.` : 'Nothing left to sow in this plan.')));
    clear($('sdFoot')).append(
      `${sown ? `${sown} planting${sown === 1 ? ' is' : 's are'} already marked sown or planted and left out. ` : ''}${plain ? `${plain} planting${plain === 1 ? ' has' : 's have'} no variety chosen and ${plain === 1 ? 'is' : 'are'} counted under the crop. ` : ''}`,
      h('button.link', { type: 'button', onclick: () => download(need) }, 'Download as a spreadsheet file (.csv)'));
  }
  function download(need) {
    const cell = x => { const s = x == null ? '' : String(x); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [['Crop', 'Variety', 'Supplier', 'Product code', 'To sow', 'Unit', 'By weight', 'Packets', 'First sowing', 'Plantings to sow', 'Plantings']];
    for (const r of need.rows) {
      if (!(r.toSow > 0)) continue;
      const v = r.variety, m = r.unit === 'seeds' ? SL.measures(r.toSow, v) : { weight: '', packets: '' };
      lines.push([cropName(r.crop), v ? v.name : '', v ? v.supplier || v.source || '' : '', v ? v.sku || '' : '', Math.round(r.toSow * 10) / 10, r.unit, m.weight, m.packets, r.first ? E.d2s(r.first) : '', r.waiting, r.plantings]);
    }
    const blob = new Blob(['﻿' + lines.map(l => l.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }), filename = `seeds-required-${App.planYear()}-${E.d2s(new Date())}.csv`;
    const fallback = () => { const url = URL.createObjectURL(blob), a = h('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); };
    const downloads = root.claude && root.claude.use ? root.claude.use('downloads') : null;
    if (downloads) Promise.resolve(downloads).then(dl => dl.save({ filename, data: blob })).catch(error => { if (!error || error.code !== 'declined') fallback(); }); else fallback();
  }

  function init() {
    for (const b of document.querySelectorAll('[data-sd-tab]')) b.addEventListener('click', () => { ui.tab = b.dataset.sdTab; schedule(); });
    $('sdSearch').addEventListener('input', e => { ui.query = e.target.value; schedule(); });
    $('sdAddLink').addEventListener('click', () => openImporter());
    $('sdAddHand').addEventListener('click', () => openVariety(null));
    $('sdAddCrop').addEventListener('click', () => openCrop(null));
    $('sdSettings').addEventListener('click', openSettings);
    App.on('plan', schedule); App.on('view', schedule);
  }
  root.LRFSeeds = { init, openImporter, openVariety, openCrop, openSettings, service, planningLine };
})(window);
