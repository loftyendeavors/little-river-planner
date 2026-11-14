/* Little River Farm Planner — the seed library.
 *
 * Varieties and crops are added and edited here. A variety can be read from a supplier's product
 * page: by its link, through the grower's own fetch service, or from the page pasted in, which
 * needs no service and no connection. Nothing is saved until it has been looked over.
 * "Seeds required" adds up what the plan needs of each variety. There are no order reminders.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine, Lib = root.LRFLibrary, SL = root.LRFSeedLib, Reader = root.LRFReader, T = root.LRFThumbs;
  const { h, clear, add, num, toast, day } = UI;
  const $ = id => document.getElementById(id);
  const ui = { tab: 'list', query: '', filter: 'all', sort: 'crop', closed: new Set(), sel: null, rev: 0, panelKey: '', stock: null, sowOpen: null, dirty: true };
  const ENV_LABEL = { field: 'Field', tunnel: 'Unheated tunnel', heated: 'Heated greenhouse', tower: 'Towers' };
  const BASIS_TEXT = { seed: 'seeding', direct: 'direct seeding', transplant: 'transplanting', unspecified: 'not stated' };
  const BASIS_OPTIONS = [['unspecified', 'As the crop'], ['seed', 'Seeding, in the nursery'], ['direct', 'Direct seeding, in place'], ['transplant', 'Transplanting into the bed']];
  const BASIS_SHORT = [['unspecified', 'as the crop'], ['seed', 'seeding'], ['direct', 'direct seeding'], ['transplant', 'transplanting']];
  const STAGE_OPTIONS = [['unspecified', 'Not stated'], ['mature', 'Mature'], ['baby', 'Baby'], ['flower', 'First flower or cut']];
  const NEW_CROP = '__new_crop__', NEW_VARIETY = '__new__';

  // ───────────────────────── link reader settings (this browser only) ─────────────────────────
  const SERVICE_KEY = 'lrf-next:fetch';
  function ownService() { try { const s = JSON.parse(root.localStorage.getItem(SERVICE_KEY) || 'null'); return s && typeof s === 'object' ? { base: String(s.base || ''), key: String(s.key || '') } : { base: '', key: '' }; } catch (_) { return { base: '', key: '' }; } }
  // A link is read through a fetch service of the grower's own where one is set in this browser; otherwise through Cloud sync, which
  // reads supplier pages from its version 2 on, for a device that is signed in. `how` says which: 'own', 'cloud', 'cloud-old' (signed
  // in, but the service is still the older code) or 'none'.
  const cloudService = () => (App.linkService ? App.linkService() : null);
  function linkHow() { const own = ownService(); if (Reader.serviceBase(own.base) && own.key.trim()) return 'own'; const c = cloudService(); return !c ? 'none' : c.v >= 2 ? 'cloud' : 'cloud-old'; }
  function service() { const how = linkHow(), c = cloudService(); return how === 'cloud' ? { base: c.base, key: c.key } : ownService(); }
  function keepService(s) { try { if (s) root.localStorage.setItem(SERVICE_KEY, JSON.stringify(s)); else root.localStorage.removeItem(SERVICE_KEY); return true; } catch (_) { return false; } }
  const serviceReady = () => { const how = linkHow(); return how === 'own' || how === 'cloud'; };

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
    for (const env of eng.ENVS) { const t = eng.timingFor(variety.cropId, variety.id, env); if (t.source !== 'none' && t.bed) out.push({ env, days: t.bed, source: t.source, printed: t.printed, basis: t.basis, off: t.off, by: t.startBy }); }
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
    else if (supplier && field.printed && field.days !== field.printed) why = ` The supplier prints ${field.printed} from ${BASIS_TEXT[field.basis] || 'seeding'}; ${field.basis === 'direct' ? `as a transplant it is in the bed ${field.off} days less` : 'the nursery time is taken off'}.${field.by === 'crop' ? ' That is the crop’s “Days counted from”, set on the Assumptions list.' : field.by === 'guess' ? ' That is a guess from the wording of the page: set it here or on the crop.' : ''}`;
    else if (supplier && (variety.catalogMaturityBasis || 'unspecified') === 'unspecified' && crop.method === 'TP') why = field.by === 'crop' ? ' The crop’s own is used: counted from transplanting.' : field.basis && field.basis !== 'unspecified' ? ` Nothing says where the days are counted from, so the planner goes by the page text and reads it as from ${BASIS_TEXT[field.basis]}.` : ' Nothing here or on the crop says where the days are counted from, so the printed days are counted from the day it goes in the bed.';
    return `The planner will count ${text} from the day it goes in the bed.${why}`;
  }

  // ───────────────────────── importer: a link, review, save; the page's text only once a link has failed ─────────────────────────
  /**
   * Why a link was not read, in plain words: which step failed and what to do about it.
   * { step: 'address' | 'setup' | 'signin' | 'connection' | 'list' | 'supplier' | 'page', text, fallback }.
   * `fallback` says whether a read was tried and failed, which is when copying the page's text is offered; a box left empty or an address that is not one is no failed read.
   */
  function linkFailure(error, address, how = linkHow()) {
    const below = ' Or copy the page’s text instead, below.', only = ' Copy the page’s text instead, below.';
    const msg = error && error.name !== 'TypeError' && error.message ? String(error.message) : '', own = how === 'own';
    let host = ''; try { host = new URL(address).hostname.replace(/^www\./, ''); } catch (_) { host = ''; }
    if (!String(address || '').trim()) return { step: 'address', fallback: false, text: 'Paste the product page’s address first.' };
    if (how === 'none') return { step: 'setup', fallback: true, text: 'Links are read through Cloud sync, and this device is not connected to it. Connect it under Backup, Cloud sync…' + below };
    if (how === 'cloud-old') return { step: 'setup', fallback: true, text: 'Your Cloud sync cannot read links until its newer code is pasted into Cloudflare (one paste, in the Worker lrf-plan-sync).' + below };
    if (/complete HTTPS product URL|public HTTPS supplier product page|does not resolve to a public/i.test(msg)) return { step: 'address', fallback: false, text: 'That is not a complete web address. It starts with https:// and is the page for one variety.' };
    if (/is not one of the supplier sites/i.test(msg)) return { step: 'list', fallback: true, text: `${host || 'That site'} is not on the list of suppliers whose pages can be read from a link.` + only };
    if (root.navigator && root.navigator.onLine === false) return { step: 'connection', fallback: true, text: 'This device is not online, so the link was not read. Try again once it is.' + below };
    if (/fetch service did not answer/i.test(msg)) return { step: 'connection', fallback: true, text: (own ? 'Your fetch service did not answer. Check its address, at the foot of this window, and that this device is online.' : 'Cloud sync did not answer, so the link was not read. Check that this device is online, and try again.') + below };
    if (/refused the key/i.test(msg)) return { step: 'signin', fallback: true, text: (own ? 'Your fetch service refused its key. Check the key, at the foot of this window.' : 'Cloud sync did not accept this device, so the link was not read. Open Backup, Cloud sync… and connect again.') + below };
    if (/no key set|Set the fetch service/i.test(msg)) return { step: 'setup', fallback: true, text: (own ? 'Your fetch service is not fully set up: it needs its address and its key, at the foot of this window.' : 'Cloud sync is not ready to read links on this device. Open Backup, Cloud sync… and connect again.') + below };
    if (/blocked the reader|verification page/i.test(msg)) return { step: 'supplier', fallback: true, text: `${host || 'The supplier'} refused to give its page to the reader.` + only };
    if (/took too long/i.test(msg)) return { step: 'supplier', fallback: true, text: `${host || 'The supplier’s site'} took too long to answer. Try again.` + below };
    if (/could not be reached|could not be verified|could not be resolved|empty response/i.test(msg)) return { step: 'supplier', fallback: true, text: `${host || 'The supplier’s site'} could not be reached. Try again.` + below };
    if (/\(HTTP 404\)/.test(msg)) return { step: 'supplier', fallback: true, text: `${host || 'The supplier'} has no page at that address. Check the link.` + below };
    if (/\(HTTP \d+\)/.test(msg)) return { step: 'supplier', fallback: true, text: `${host || 'The supplier'} did not give the page ${(/\(HTTP \d+\)/.exec(msg) || [''])[0]}. Try again.` + below };
    // the page came, and is not one variety's page: the reader's own sentence says what it found
    if (/several products|an article|could not be identified|redirects too many|Berbee/i.test(msg)) return { step: 'page', fallback: true, text: msg.replace(' or product text.', '.').replace(', or copy the displayed product details.', '.') + below };
    return { step: 'page', fallback: true, text: (msg ? msg.split(/(?<=\.)\s/)[0] : 'The page could not be read.') + only };
  }
  function openImporter(startURL, startCropId) {
    const d = openDialog('Add a variety from a link', 'Nothing is saved until you have looked it over.');
    let busy = false;
    const how = linkHow();
    const url = inp('url', startURL || '', { type: 'text', inputMode: 'url', placeholder: 'https://… the page for one variety', spellcheck: false });
    const pasteName = inp('pasteName', '', { maxLength: 200 });
    const pasteText = h('textarea', { name: 'pasteText', rows: 6, maxLength: 96000, placeholder: 'Ctrl+V' });
    const readBtn = button('Read page', () => read('link'), 'primary'), pasteBtn = button('Read pasted page', () => read('paste'));
    const suppliers = 'Johnny’s, Berbee, Harris, Fedco and 11 other suppliers are on its list.';
    const hint = how === 'cloud' ? 'Paste the product page’s address. It is read through your Cloud sync: ' + suppliers : how === 'own' ? 'Paste the product page’s address. It is read through your fetch service: ' + suppliers
      : how === 'cloud-old' ? 'Your Cloud sync can read links once its newer code is pasted into Cloudflare (one paste, in the Worker lrf-plan-sync).' : 'Links are read through Cloud sync once this device is connected (Backup, Cloud sync…).';
    // said where the link failed, above what to do instead; both stay out of sight until a link has failed
    const failed = h('p.sd-fail', { id: 'sdFail', role: 'alert', hidden: true });
    const fallback = h('section.sd-fallback', { id: 'sdFallback', hidden: true, 'aria-label': 'Copy the page’s text instead' },
      h('h3', 'Copy the page’s text instead'),
      h('ol.sd-steps',
        h('li', 'On the product page, press ', h('kbd', 'Ctrl'), '+', h('kbd', 'A'), ' then ', h('kbd', 'Ctrl'), '+', h('kbd', 'C'), ' (', h('kbd', '⌘'), ' on a Mac).'),
        h('li', h('label', { for: 'sdPasteText' }, 'Paste it here.'), pasteText),
        h('li', h('label', { for: 'sdPasteName' }, 'Type the variety’s name, as the supplier gives it.'), pasteName)),
      h('div.sd-row', pasteBtn, h('span.dlg-hint', 'The link above is kept as the variety’s source.')),
      h('p.dlg-hint.sd-linkhow', { id: 'sdLinkHow', dataset: { how } }, h('button.linkish', { type: 'button', id: 'sdSettings', onclick: () => openSettings() }, how === 'own' ? 'A fetch service of your own is set in this browser…' : 'Use a fetch service of your own instead…')));
    pasteText.id = 'sdPasteText'; pasteName.id = 'sdPasteName';
    const intake = h('form.sd-intake', { dataset: { how }, onsubmit: e => { e.preventDefault(); read('link'); } },
      fld('Product link', url, hint), h('div.sd-row', readBtn, button('Cancel', () => d.close())), failed, fallback);
    d.body.append(intake);
    url.focus();
    const done = () => { busy = false; readBtn.disabled = pasteBtn.disabled = false; };
    const fail = f => {
      d.say(''); failed.textContent = f.text; failed.dataset.step = f.step; failed.hidden = false;
      if (f.fallback && fallback.hidden) { fallback.hidden = false; pasteText.focus({ preventScroll: true }); fallback.scrollIntoView({ block: 'nearest' }); }
      done();
    };

    async function read(from) {
      if (busy) return;
      let data;
      const address = url.value.trim(), now = linkHow();
      if (from === 'link' && (!address || now === 'none' || now === 'cloud-old')) { fail(linkFailure(null, address, now)); return; }
      // copied text does not say which of its lines is the name; page source carries its own
      const name = pasteName.value.trim(), source = /<(?:html|body|main|script)\b/i.test(pasteText.value);
      if (from === 'paste' && !pasteText.value.trim()) { d.say('Paste the page’s text into the box first.', 'bad'); pasteText.focus(); return; }
      if (from === 'paste' && !name && !source) { d.say('Type the variety’s name too: copied text does not say which of its lines is the name.', 'bad'); pasteName.focus(); return; }
      busy = true; readBtn.disabled = pasteBtn.disabled = true; failed.hidden = true; d.say(from === 'link' ? 'Reading the page…' : 'Reading what you pasted…');
      try {
        if (from === 'link') data = await Reader.readLink(address, service());
        else data = Reader.readPasted(pasteText.value, address, name || 'Variety');
      } catch (error) {
        if (d.closed) return;
        if (from === 'link') fail(linkFailure(error, address, now));
        else { d.say(error && error.name !== 'TypeError' && error.message ? error.message : 'What was pasted could not be read as a product page.', 'bad'); done(); }
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
    const basisSel = sel('basis', BASIS_OPTIONS, SL.startOf(f.maturityBasis, ev.maturityBasis && ev.maturityBasis.value));
    const stageSel = sel('stage', STAGE_OPTIONS, 'unspecified');
    const dtmMin = numIn('dtmMin', f.maturity ? f.maturity.min : '', { min: 1, max: 3650, step: 1 }), dtmMax = numIn('dtmMax', f.maturity ? f.maturity.max : '', { min: 1, max: 3650, step: 1 });
    const printed = ev.maturity && ev.maturity.value ? String(ev.maturity.value).slice(0, 120) : '';
    const stageButtons = (data.stages || []).map(s => button(`${s.min === s.max ? s.min : s.min + '–' + s.max} · ${s.stage}`, () => {
      dtmMin.value = s.min; dtmMax.value = s.max;
      stageSel.value = /baby|leaf/.test(s.stage) ? 'baby' : /flower|bloom|cut/.test(s.stage) ? 'flower' : /full|ripe|mature|red|orange|yellow|seed/.test(s.stage) ? 'mature' : stageSel.value;
      refresh();
    }, 'small'));
    const start = data.start || { basis: 'unspecified', statement: '' };
    add(startNote, start.statement ? h('span', `${start.source || 'Supplier page'}: “${start.statement}”`) : h('span', 'The page does not say what its days are counted from.'),
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
          h('div.sd-grid', fld('Earliest day', dtmMin), fld('Latest day', dtmMax), fld('Days counted from', basisSel), fld('Harvest stage', stageSel)),
          startNote, planLine,
          h('h3', 'Growing and seed'),
          h('div.sd-grid',
            fld('In-row spacing (in)', numIn('inRow', exact(f.inRow)), f.inRow && f.inRow.min !== f.inRow.max ? `Page: ${f.inRow.printed}` : ev.inRow && ev.inRow.label === 'Alternative spacing instructions' ? `Page gives ${ev.inRow.value}` : 'Empty uses the crop’s'),
            fld('Rows per bed', numIn('rowsPerBed', '', { min: 1, max: 1000, step: 1 }), 'Empty uses the crop’s'),
            fld('Days in nursery', numIn('nurseryDays', exact(nursery), { max: 728 }), nursery ? `Page: ${nursery.min === nursery.max ? nursery.min : nursery.min + '–' + nursery.max} days` : 'Empty uses the crop’s'),
            fld('Germination (%)', numIn('germ', f.germinationPercent, { max: 100 }), 'Empty uses the plan’s'),
            fld('Seeds per packet', numIn('seedsPerPacket', f.seedsPerPacket, { min: 1 })), fld('Seeds per ounce', numIn('seedsPerOz', f.seedsPerOz, { min: 1 }), f.seedsPerLb ? `Page: ${num(f.seedsPerLb)} per lb` : null))),
        h('aside.sd-side', photo, photo ? h('p.dlg-hint.sd-photo-note', 'Kept with the variety when it is saved.') : null,
          (data.warnings || []).length ? h('ul.sd-warn', data.warnings.map(w => h('li', w))) : null,
          h('p.dlg-hint', `${data.extraction || 'Read'}${(data.refined || []).length ? ' · corrected here: ' + data.refined.map(k => (k === 'maturity' ? 'days' : 'where the days are counted from')).join(', ') : ''}`))),
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
        if (o.dtmMin && crop.method === 'TP' && o.basis === 'unspecified' && !(await UI.confirm({ title: 'Save without saying where the days are counted from?', confirmLabel: 'Save anyway', body: `${crop.name} is transplanted, and the page’s ${o.dtmMin} days could be counted from seeding or from transplanting. Those differ by the whole nursery time. ${planLine.textContent}` }))) return;
        const { saved, after } = candidate(o, crop);
        // The page's first product picture is the variety's photo. One it already has is left alone.
        const picture = data.images && data.images[0] && data.images[0].url;
        if (picture && /^https:\/\//i.test(picture) && !(saved && saved.photo)) after.photo = { sourceUrl: picture, sourcePage: data.url || after.url || '', credit: after.supplier || after.source || '', importedAt: new Date().toISOString() };
        ops.push({ kind: 'variety', before: saved || null, after });
        const label = saved ? `Update ${after.name} from its supplier page` : `Add ${after.name} to the library`;
        if (!(await App.revise(label, ops))) return;
        const previous = saved ? await App.varietyRecord(saved.id) : null;
        const kept = await App.keepVarietyRecord(after.id, SL.record(data, o, previous));
        d.close();
        if (!kept) toast(`${after.name} is saved. This view has nowhere to keep the page text itself, so a backup made here will carry the variety without it.`);
        ui.query = ''; $('sdSearch').value = ''; ui.filter = 'all'; if (ui.tab === 'crops') ui.tab = 'list'; ui.closed.delete(after.cropId); ui.sel = { type: 'variety', id: after.id }; schedule();
        if (!T.get(after.id)) App.rebuildThumbs([after.id]);   // fetched and kept when it can be; shown from the supplier's site until then
      } catch (error) { d.say(error.message || 'That could not be saved.', 'bad'); }
    }
  }
  /** Adding a crop also puts it on the grower's own crop list, as v7 does. */
  function cropListOp(cropId) {
    const settings = App.state.plan.settings || {}, list = settings.cropTypeList && settings.cropTypeList.v === 1 ? settings.cropTypeList : { v: 1, added: [], removed: [], deleted: [] };
    return { kind: 'settings', before: settings, after: { ...settings, cropTypeList: { ...list, added: [...new Set([...(list.added || []), cropId])], removed: (list.removed || []).filter(id => id !== cropId) } } };
  }

  // ───────────────────────── a variety, by hand ─────────────────────────
  function openVariety(variety, startCropId, inPanel) {
    const eng = App.state.engine, crops = sortedCrops(), v = variety || { cropId: startCropId || '' }, n = variety ? usedBy(variety.id) : 0;
    const d = inPanel || openDialog(variety ? variety.name : 'Add a variety by hand', variety ? `${cropName(eng.crop(v.cropId))}${n ? ` · in ${n} planting${n === 1 ? '' : 's'}` : ' · not planted this season'}` : 'For a variety with no supplier page. One with a page is better added from it.');
    const hasSupplierDays = !!v.catalogDtm, evidence = h('p.sd-evidence'), planLine = h('p.sd-plan');
    const form = h('form.sd-review', { novalidate: true, onsubmit: e => { e.preventDefault(); save(); } },
      h('h3', 'Variety and source'),
      h('div.sd-grid', fld('Variety name', inp('name', v.name, { maxLength: 200, required: true })),
        fld('Crop', sel('cropId', [['', 'Choose the crop'], ...crops.map(c => [c.id, c.name])], v.cropId, { disabled: n > 0 }), n ? 'Fixed while plantings use it' : null),
        fld('Supplier', inp('supplier', v.supplier || (v.source === 'Farm entry' ? '' : v.source))), fld('Product code', inp('sku', v.sku)),
        h('label.fld.span2', h('span', 'Product page'), inp('url', v.url, { type: 'text', inputMode: 'url', spellcheck: false }))),
      h('h3', 'Days to maturity'),
      h('div.sd-grid', fld('Supplier’s earliest day', numIn('dtmMin', v.catalogDtm, { min: 1, max: 3650, step: 1 })), fld('Supplier’s latest day', numIn('dtmMax', v.catalogDtmMax, { min: 1, max: 3650, step: 1 })),
        fld('Days counted from', sel('basis', BASIS_OPTIONS, v.catalogMaturityBasis || 'unspecified')), fld('Harvest stage', sel('stage', STAGE_OPTIONS, v.catalogHarvestStage || 'unspecified')),
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
        h('span.grow'), button(inPanel ? 'Revert' : 'Cancel', () => d.close()), h('button.btn.primary', { type: 'submit' }, variety ? 'Save' : 'Add to the library')));
    d.body.append(form);

    // what the supplier's page said, when its text was kept
    if (variety) App.varietyRecord(variety.id).then(record => {
      if (d.closed || !record) return;
      const w = record.webImport || {}, s = Reader.maturityStatement({ url: v.url, sourceText: record.catalogSourceText || w.sourceText || '', specifications: w.specifications || [] });
      const printed = w.evidence && w.evidence.maturity && w.evidence.maturity.value ? String(w.evidence.maturity.value).slice(0, 120) : '';
      const said = SL.startOf(s.basis, s.statement);
      add(clear(evidence), printed ? h('span', `The page printed: “${printed}”. `) : null, s.statement ? h('span', `${s.source}: “${s.statement}”`) : h('span', 'Its saved page does not say what the days are counted from.'),
        said !== 'unspecified' && said !== val(form, 'basis') ? button(`Set to ${BASIS_TEXT[said]}`, () => { form.elements.basis.value = said; refresh(); }, 'small') : null);
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
        if (await App.revise(variety ? `Edit ${after.name}` : `Add ${after.name} to the library`, [{ kind: 'variety', before: variety || null, after }])) { if (!variety) { ui.sel = { type: 'variety', id: after.id }; ui.tab = ui.tab === 'crops' ? 'list' : ui.tab; ui.closed.delete(after.cropId); } d.close(); schedule(); }
      } catch (error) { d.say(error.message || 'That could not be saved.', 'bad'); }
    }
    async function remove() {
      if (await App.revise(`Remove ${variety.name} from the library`, [{ kind: 'variety', before: variety, after: { ...variety, active: false, deleted: true } }])) { d.close(); schedule(); }
    }
  }

  // ───────────────────────── a crop ─────────────────────────
  const CROP_NUMBERS = [['inRow', 'In-row spacing (in)', 0.01, 2400], ['rowSp', 'Row spacing (in)', 0.01, 2400], ['rowsPerBed', 'Rows per bed', 1, 1000, true], ['gh', 'Weeks in nursery', 0, 104], ['tray', 'Cells per tray', 1, 1000, true], ['spc', 'Seeds per cell', 0.1, 50], ['germ', 'Germination (%)', 0.1, 100], ['seedsFt', 'Seeds per foot of row (direct sown)', 0, 1000]];
  function openCrop(crop, inPanel) {
    const eng = App.state.engine, plan = App.state.plan, c = crop || {}, own = crop ? (plan.crops || []).find(x => x.id === crop.id) || null : null;
    const n = crop ? plan.plantings.filter(p => p.cropId === crop.id).length : 0;
    const d = inPanel || openDialog(crop ? crop.name : 'Add a crop', crop ? `${n ? `In ${n} planting${n === 1 ? '' : 's'}. ` : ''}Days to harvest are set on the Assumptions list, per growing condition.` : 'Give it its real numbers here, and its days to harvest on the Assumptions list.');
    const form = h('form.sd-review', { novalidate: true, onsubmit: e => { e.preventDefault(); save(); } },
      h('div.sd-grid', fld('Crop name', inp('name', c.name, { maxLength: 160, required: true })), fld('Plant family', inp('family', c.family, { maxLength: 160 })),
        fld('How it is planted', sel('method', [['TP', 'Transplanted'], ['DS', 'Direct sown']], c.method || 'TP')),
        fld('Planted from', sel('plantingMaterial', [['seed', 'Seed'], ['plant', 'Bought-in plants'], ['bulb', 'Bulbs'], ['clove', 'Cloves'], ['piece', 'Seed pieces']], c.plantingMaterial || (c.material === 'bulb' ? 'bulb' : 'seed'))),
        CROP_NUMBERS.map(([key, label, lo, hi, whole]) => fld(label, numIn(key, c[key] == null ? '' : c[key], { min: lo, max: hi, step: whole ? 1 : 'any' }), key === 'rowsPerBed' ? 'Empty: as many as the bed width takes' : key === 'germ' ? 'Empty uses the plan’s' : null))),
      actions(h('span.grow'), button(inPanel ? 'Revert' : 'Cancel', () => d.close()), h('button.btn.primary', { type: 'submit' }, crop ? 'Save' : 'Add the crop')));
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
          if (await App.revise(`Add the crop ${name}`, [{ kind: 'crop', before: null, after: fresh }, cropListOp(fresh.id)])) { ui.sel = { type: 'crop', id: fresh.id }; ui.tab = 'crops'; d.close(); schedule(); }
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
    const now = ownService(), d = openDialog('A fetch service of your own', 'A web page may not read another website’s pages, so links are read through your own fetch service. Its address and key are kept in this browser only. They are never put in the plan or in a backup.');
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
      actions(now.base || now.key ? button('Forget them', () => { keepService(null); d.close(); toast('The fetch service’s address and key were removed from this browser.'); schedule(); }, 'danger') : null, h('span.grow'), testBtn, button('Cancel', () => d.close()),
        button('Save', () => {
          const s = typed();
          if (s.base && !Reader.serviceBase(s.base)) { d.say('That is not a complete https address.', 'bad'); return; }
          if (!keepService(s.base || s.key ? s : null)) { d.say('This browser would not keep them. Its storage may be switched off.', 'bad'); return; }
          d.close(); toast(s.base && s.key ? 'Fetch service saved in this browser.' : 'Fetch service cleared.'); schedule();
          if (s.base && s.key) App.rebuildThumbs();   // variety photos that could not be fetched without it can be now
        }, 'primary'))));
  }

  // ───────────────────────── one list, a gallery, the crops, and a detail panel ─────────────────────────
  let frame = 0, host = null;
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(render); };
  const SUPPLIER_SHORT = [[/johnny/i, 'Johnny’s'], [/harris/i, 'Harris'], [/fedco/i, 'Fedco'], [/high\s*mowing/i, 'High Mowing'], [/berbee/i, 'Berbee'], [/stark/i, 'Stark Bro’s'], [/true\s*leaf/i, 'True Leaf'], [/territorial/i, 'Territorial'],
    [/paramount/i, 'Paramount'], [/osborne/i, 'Osborne'], [/whaley/i, 'A.P. Whaley'], [/trade\s*winds/i, 'Trade Winds'], [/pepper\s*joe/i, 'Pepper Joe’s'], [/rupp/i, 'Rupp'], [/sandia/i, 'Sandia']];
  const supplierShort = v => { const s = v.supplier || (v.source === 'Farm entry' ? '' : v.source) || ''; const hit = SUPPLIER_SHORT.find(([re]) => re.test(s)); return hit ? hit[1] : s; };
  // A variety whose printed days have no starting point of their own, in a crop that has none set either.
  const noStart = v => !!v.catalogDtm && (v.catalogMaturityBasis || 'unspecified') === 'unspecified' && !App.state.engine.startRule(v.cropId).set;
  const FILTERS = [['all', 'All'], ['planted', 'Planted'], ['tosow', 'To sow'], ['short', 'Short of seed'], ['open', 'Days counted from: not said']];
  const SORTS = [['crop', 'By crop'], ['name', 'Name'], ['days', 'Days'], ['tosow', 'Most to sow'], ['first', 'First sowing'], ['supplier', 'Supplier']];
  const amount = r => [h('b', num(r.toSow, r.unit === 'g' ? 1 : 0)), r.unit === 'seeds' ? null : h('small.sd-unitword', SL.UNIT_WORD[r.unit])];

  /** Everything the three views read: each variety with what the plan needs of it and what is on hand. */
  function model() {
    const eng = App.state.engine, plan = App.state.plan, need = SL.required(eng), stock = App.stockNow();
    const live = plan.varieties.filter(v => v.active !== false && !v.deleted), used = new Map(), usedCrop = new Map(), byV = new Map(), byCrop = new Map();
    for (const p of plan.plantings) { usedCrop.set(p.cropId, (usedCrop.get(p.cropId) || 0) + 1); if (p.varietyId) used.set(p.varietyId, (used.get(p.varietyId) || 0) + 1); }
    for (const r of need.rows) {
      r.stockKey = r.variety ? 'v:' + r.variety.id : 'c:' + (r.crop && r.crop.id); r.stockUnit = SL.stockUnit(r.unit);
      const s = stock[r.stockKey + '|' + r.stockUnit] || { onHand: 0, onOrder: 0 };
      r.onHand = s.onHand; r.onOrder = s.onOrder; r.short = Math.max(0, r.unit === 'g' ? Math.round((r.toSow - s.onHand - s.onOrder) * 10) / 10 : Math.ceil(r.toSow - s.onHand - s.onOrder));
      r.cover = r.variety && r.short > 0 ? App.coverFor(r.short, r.unit, r.variety) : null;   // what covers the shortfall, in the vendor's own sizes
      if (r.variety) { if (!byV.has(r.variety.id) || r.unit === 'seeds') byV.set(r.variety.id, r); }
      else if (r.crop) { if (!byCrop.has(r.crop.id)) byCrop.set(r.crop.id, []); byCrop.get(r.crop.id).push(r); }
    }
    // a variety that is not in this season's plan can still have seed on the shelf
    for (const v of live) {
      if (byV.has(v.id)) continue;
      const crop = eng.crop(v.cropId), unit = SL.STOCK_UNITS.find(u => stock['v:' + v.id + '|' + u]) || unitFor(crop), s = stock['v:' + v.id + '|' + unit] || { onHand: 0, onOrder: 0 };
      byV.set(v.id, { key: 'v:' + v.id + '|' + unit, stockKey: 'v:' + v.id, stockUnit: unit, variety: v, crop, unit, plantings: 0, waiting: 0, toSow: 0, total: 0, first: null, onHand: s.onHand, onOrder: s.onOrder, short: 0 });
    }
    // stock the list cannot count: a lot for a removed variety, or in a unit this variety's row does not use
    const units = new Map([...byV.values()].map(r => [r.stockKey, r.stockUnit])), needed = new Set(need.rows.map(r => r.stockKey + '|' + r.stockUnit));
    const unlisted = SL.unlisted(App.inventoryNow(), plan, units).filter(u => u.why !== 'unit' || !needed.has(u.lot.key + '|' + u.lot.unit));
    for (const u of unlisted) if (u.why === 'unit') { const r = byV.get(u.variety.id); (r.odd || (r.odd = [])).push(u); }
    return { eng, plan, live, need, stock, used, usedCrop, byV, byCrop, unlisted, hasStock: Object.keys(stock).length > 0 };
  }
  // a live-tray crop sown in cells is counted in seeds; broadcast in an open tray, by weight
  const unitFor = crop => (crop && crop.micro ? (App.state.engine.liveSow(crop).how === 'cells' ? 'seeds' : 'g') : crop && crop.plantingMaterial === 'plant' ? 'plants' : 'seeds');
  // ── stock, edited where it is shown ──
  function receive(key, unit, name) {
    const done = App.editStock(`${name}: order arrived`, (lib, ctx) => {
      let next = null;
      for (const lot of SL.lotsFor(lib, key)) if (lot.unit === unit && lot.life === 'ordered') next = SL.receiveLot(next || lib, lot.id, ctx) || next;
      return next;
    }, name);
    if (done) toast(`${name}: the order is now on hand`, { label: 'Undo', run: App.undo });
  }
  async function receiveAll() {
    const lots = (App.inventoryNow().lots || []).filter(l => l && l.deleted !== true && SL.lifeOf(l) === 'ordered');
    if (!lots.length || !(await UI.confirm({ title: 'Mark every order as arrived?', confirmLabel: 'All arrived', body: `${lots.length} lot${lots.length === 1 ? '' : 's'} on order become seed on hand, each at the quantity ordered. One Undo puts them back. If part of the order has not come, mark those varieties one at a time instead.` }))) return;
    if (App.editStock(`${lots.length} orders arrived`, (lib, ctx) => { let next = lib; for (const lot of lots) next = SL.receiveLot(next, lot.id, ctx) || next; return next; })) toast(`${lots.length} orders are now on hand`, { label: 'Undo', run: App.undo });
  }
  const lotText = u => `${num(u.lot.quantity)} ${u.lot.unit} ${u.life === 'ordered' ? 'ordered' : 'on hand'}`;
  /** Put a lot the list cannot count where it can: under the plan's unit, or under the live variety of the same name. */
  function refile(u, to, label) {
    if (App.editStock(label, (lib, ctx) => SL.moveLot(lib, u.lot.id, to, ctx), to.name || u.lot.name || '')) toast(label, { label: 'Undo', run: App.undo });
    else { ui.panelKey = ''; schedule(); }
  }
  const unitWord = unit => (unit === 'g' ? 'grams' : unit);
  /** A crop marked as bought-in plants that is in fact raised from seed: its rows then count seeds, and seed on the shelf counts. */
  function sowFromSeed(crop) {
    const own = (App.state.plan.crops || []).find(x => x.id === crop.id) || null;
    return App.revise(`${crop.name} is sown from seed`, [{ kind: 'crop', before: own, after: { ...(own || { id: crop.id }), plantingMaterial: 'seed' } }]);
  }
  const boughtIn = crop => !!crop && crop.plantingMaterial === 'plant';
  /** Does this variety's vendor list it in seed counts or weights? Canes and plugs come with neither. */
  const soldAsSeed = v => !!v && (App.packsFor(v).list.length > 0 || v.seedsPerPacket > 0 || v.seedsPerOz > 0 || v.seedsPerLb > 0);
  /**
   * A lot in one unit under a variety the plan counts in another. Either the lot is misfiled (canes ordered and
   * recorded as seeds) or the crop is (seed on the shelf for a crop marked as bought-in plants). Only he knows which.
   */
  function unitChoice(u, name) {
    const lot = u.lot, crop = App.state.engine.crop(u.variety.cropId), n = num(lot.quantity);
    // seed bought by weight for a crop counted in seeds (a live tray sown in cells, say), or the reverse: the vendor's seeds per gram turns one into the other
    const rate = SL.perGram(u.variety), q = Number(lot.quantity), turned = !(rate > 0) || !(q > 0) ? null : lot.unit === 'g' && u.unit === 'seeds' ? Math.floor(q * rate) : lot.unit === 'seeds' && u.unit === 'g' ? Math.round(q / rate * 10) / 10 : null;
    const rateText = rate > 0 ? `${num(rate, rate < 10 ? 1 : 0)} seeds a gram` : '';
    return [h('p.sd-odd', `Recorded as ${n} ${unitWord(lot.unit)}, but the plan counts ${name} in ${unitWord(u.unit)}, so no row counts this lot.${turned != null ? '' : ' One of the two is wrong.'}`),
      turned != null ? h('button.link', { type: 'button', dataset: { fix: 'turn' }, onclick: () => refile(u, { unit: u.unit, quantity: turned, reason: `${n} ${unitWord(lot.unit)} turned into ${unitWord(u.unit)} at ${rateText}, the figure on the variety.` }, `${name}: ${n} ${unitWord(lot.unit)} counted as ${num(turned, u.unit === 'g' ? 1 : 0)} ${unitWord(u.unit)}`) }, `Count it as ${num(turned, u.unit === 'g' ? 1 : 0)} ${unitWord(u.unit)} (${rateText}, from the variety’s record)`) : null,
      h('button.link', { type: 'button', dataset: { fix: 'unit' }, onclick: () => refile(u, { unit: u.unit, reason: `Counted in ${u.unit}, as the plan counts ${name}.` }, `${name}: ${n} counted as ${unitWord(u.unit)}`) }, `The lot is wrong: count ${n} ${unitWord(u.unit)}`),
      crop && lot.unit === 'seeds' && u.unit === 'plants' && boughtIn(crop) && soldAsSeed(u.variety) ? h('button.link', { type: 'button', dataset: { fix: 'seed' }, onclick: () => sowFromSeed(crop) }, `The crop is wrong: ${cropName(crop)} is sown from seed`)
        : crop ? h('button.link', { type: 'button', dataset: { fix: 'crop' }, onclick: () => select({ type: 'crop', id: crop.id }) }, `The crop is wrong: open ${cropName(crop)}`) : null];
  }
  /** The On hand cell: a number typed in place, and any order beneath it with one click to mark it arrived. */
  function stockCell(r, name) {
    const lots = SL.lotsFor(App.inventoryNow(), r.stockKey).filter(l => l.unit === r.stockUnit), held = lots.filter(l => l.life === 'usable' && l.usable === true), ordered = lots.some(l => l.life === 'ordered'), many = held.length > 1, word = SL.UNIT_WORD[r.unit] || SL.UNIT_WORD[r.stockUnit] || r.stockUnit;
    const input = h('input.sd-stock', { type: 'number', min: 0, step: r.stockUnit === 'g' ? 'any' : 1, value: held.length ? r.onHand : '', placeholder: '—', readOnly: many, 'aria-label': `${name}: ${word} on hand`, title: many ? `${held.length} lots on hand. Count each one in the panel.` : `What you have on hand, in ${word}`,
      onkeydown: e => { if (e.key === 'Enter') e.target.blur(); },
      onchange: e => {
        const raw = e.target.value.trim();
        if (raw === '' && !held.length) return;
        if (!App.editStock(`${name}: ${raw === '' ? 0 : raw} on hand`, (lib, ctx) => SL.setOnHand(lib, r.stockKey, r.stockUnit, raw === '' ? 0 : raw, ctx), name)) { ui.panelKey = ''; schedule(); }
      } });
    return h('td.sd-num.sd-stockcell', input, ordered ? h('button.sd-recv', { type: 'button', title: 'The order has arrived: count it as on hand', 'aria-label': `${name}: ${num(r.onOrder)} ordered. Mark as arrived.`, onclick: () => receive(r.stockKey, r.stockUnit, name) }, `${num(r.onOrder)} ordered ✓`) : null,
      r.odd ? h('button.sd-oddlot', { type: 'button', title: `${r.odd.map(lotText).join(', ')}, which this row cannot count: the plan counts ${name} in ${word}. Click to see the lot and put it right.`, 'aria-label': `${name}: ${r.odd.map(lotText).join(', ')}, not counted here`, onclick: () => select({ type: 'variety', id: r.variety.id }) }, `${r.odd.map(u => `${num(u.lot.quantity)} ${u.lot.unit}`).join(', ')} ?`) : null);
  }
  /** Every lot of one variety, in the panel: count, where it is, packed-for year. */
  /** Stock the list leaves out, each lot with the one step that puts it right. */
  function unlistedBox(m) {
    const box = h('section.sd-stray', { id: 'sdUnlisted' }, h('b', `${m.unlisted.length} lot${m.unlisted.length === 1 ? ' is' : 's are'} not counted in the list`), h('span', 'Seed that is bought or ordered but filed where no row can see it. Until it is put right, the list asks for that seed again.'));
    for (const u of m.unlisted) {
      const v = u.variety, was = v ? v.name : (u.lot.name || 'a variety that is gone'), crop = v && m.eng.crop(v.cropId), row = h('div.sd-strayrow', { dataset: { lot: u.lot.id, why: u.why } }, h('strong', was), h('small', lotText(u)));
      if (u.why === 'unit') add(row, unitChoice(u, v.name));
      else if (u.twin) {
        const to = u.twin, toCrop = cropName(m.eng.crop(to.cropId));
        row.append(h('p', `Filed under a ${was} that was removed from the library. There is another ${to.name} under ${toCrop}.`),
          h('button.link', { type: 'button', onclick: () => refile(u, { key: 'v:' + to.id, name: `${toCrop} · ${to.name}`, reason: `Moved from a removed variety record (${v.id}).` }, `${to.name}: ${lotText(u)}, moved from the removed record`) }, `Move it to ${to.name} · ${toCrop}`));
      } else if (v && crop && crop.active !== false && !crop.deleted) {
        row.append(h('p', `${was} was removed from the library, so it has no row.`),
          h('button.link', { type: 'button', onclick: async () => { const after = { ...v, active: true }; delete after.deleted; if (await App.revise(`Bring ${v.name} back to the library`, [{ kind: 'variety', before: v, after }])) toast(`${v.name} is back in the library`, { label: 'Undo', run: App.undo }); } }, `Bring ${was} back under ${cropName(crop)}`));
      } else row.append(h('p', 'The variety this was bought for is no longer in the library.'));
      box.append(row);
    }
    return box;
  }
  function lotsBox(key, unit, name, strays) {
    const lots = SL.lotsFor(App.inventoryNow(), key), redo = () => { ui.panelKey = ''; schedule(); };
    const change = (lot, patch, kind, label) => { if (!App.editStock(`${name}: ${label}`, (lib, ctx) => SL.updateLot(lib, lot.id, patch, kind, ctx), name)) redo(); };
    const box = h('section.sd-lots', h('h3.sd-h', lots.length ? `Seed lots · ${lots.length}` : 'Seed lots'));
    for (const lot of lots) {
      const odd = (strays || []).find(u => u.lot.id === lot.id);
      const from = [lot.supplier, lot.packLabel, lot.orderNumber ? 'order ' + lot.orderNumber : '', lot.orderDate || (lot.receivedDate ? 'arrived ' + lot.receivedDate : '')].filter(Boolean).join(' · ');
      box.append(h('div.sd-lot', { dataset: { lot: lot.id } },
        h('input', { type: 'number', min: 0, step: lot.unit === 'g' ? 'any' : 1, value: lot.quantity == null ? '' : lot.quantity, 'aria-label': 'Quantity', onchange: e => change(lot, { quantity: e.target.value }, 'count', `${e.target.value || 0} counted`) }),
        h('span.sd-unit', lot.unit),
        sel('where', [['usable', 'On hand'], ['ordered', 'Ordered'], ['excluded', 'Set aside']], lot.life === 'review' ? 'excluded' : lot.life, { 'aria-label': 'Where it is', onchange: e => {
          const to = e.target.value;
          if (lot.life === 'ordered' && to === 'usable') { if (!App.editStock(`${name}: order arrived`, (lib, ctx) => SL.receiveLot(lib, lot.id, ctx), name)) redo(); }
          else change(lot, { status: to }, 'availability', to === 'usable' ? 'on hand' : to === 'ordered' ? 'on order' : 'set aside');
        } }),
        h('input.sd-year', { type: 'number', min: 1900, max: 2200, step: 1, value: lot.year || '', placeholder: 'year', title: 'Packed-for year', 'aria-label': 'Packed-for year', onchange: e => change(lot, { year: e.target.value }, 'details', 'packed-for year') }),
        h('button.icon-btn', { type: 'button', title: 'Delete this lot', 'aria-label': 'Delete this lot', onclick: () => { if (!App.editStock(`${name}: delete a lot`, (lib, ctx) => SL.deleteLot(lib, lot.id, ctx), name)) redo(); } }, '×'),
        from ? h('small', from) : null,
        odd ? h('div.sd-oddbox', unitChoice(odd, name)) : null));
    }
    box.append(h('button.link', { type: 'button', id: 'sdAddLot', onclick: () => { App.editStock(`${name}: add a lot`, (lib, ctx) => SL.addLot(lib, { key, unit, quantity: 0, status: 'usable' }, ctx), name); } }, lots.length ? '+ Add another lot' : '+ Add a lot'));
    return box;
  }
  const passes = (m, v, id) => { const r = m.byV.get(v.id); return id === 'all' || (id === 'planted' && m.used.has(v.id)) || (id === 'tosow' && !!r && r.toSow > 0) || (id === 'short' && !!r && r.short > 0) || (id === 'open' && noStart(v)); };
  function groupsOf(m, list) {
    const by = new Map();
    for (const v of list) { if (!by.has(v.cropId)) by.set(v.cropId, []); by.get(v.cropId).push(v); }
    return [...by.entries()].map(([id, vs]) => ({ id, crop: m.eng.crop(id), list: vs.sort((a, b) => String(a.name).localeCompare(String(b.name))) })).sort((a, b) => cropName(a.crop).localeCompare(cropName(b.crop)));
  }
  function select(sel, keepFocus) { ui.sel = sel; ui.keepFocus = !!keepFocus; ui.sowOpen = null; schedule(); }
  function rowKey(e) {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') { const first = $('sdPanel').querySelector('input, select, textarea'); if (first) first.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const rows = [...document.querySelectorAll('#sdBody .sd-var')], next = rows[rows.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) select({ type: 'variety', id: next.dataset.variety }, true);
  }

  function render() {
    if (!App.state.ready || App.state.view !== 'seeds') { ui.dirty = true; return; }
    ui.dirty = false;
    App.loadInventory().then(found => { if (found) { ui.panelKey = ''; schedule(); } }).catch(() => {});
    const m = model(), q = ui.query.trim().toLowerCase();
    for (const b of document.querySelectorAll('[data-sd-tab]')) b.setAttribute('aria-pressed', String(b.dataset.sdTab === ui.tab));
    const text = v => `${v.name} ${cropName(m.eng.crop(v.cropId))} ${v.supplier || v.source || ''} ${v.sku || ''}`.toLowerCase();
    const list = m.live.filter(v => passes(m, v, ui.filter) && (!q || text(v).includes(q)));
    $('sdTitle').textContent = ui.tab === 'crops' ? 'Crops' : `${list.length === m.live.length ? 'All' : list.length + ' of'} ${m.live.length} varieties`;
    add(clear($('sdFilters')),
      ui.tab === 'crops' ? h('span.sd-note', 'Click a crop to edit it. Days to harvest are on the Assumptions list.') : FILTERS.map(([id, label]) =>
        h('button.chip', { type: 'button', 'aria-pressed': String(ui.filter === id), onclick: () => { ui.filter = id; schedule(); } }, label, h('small', m.live.filter(v => passes(m, v, id)).length))),
      h('span.grow'),
      ui.tab === 'list' ? sel('sort', SORTS, ui.sort, { 'aria-label': 'Order', id: 'sdSort', onchange: e => { ui.sort = e.target.value; schedule(); } }) : null);
    $('sdTable').hidden = ui.tab === 'gallery'; $('sdGallery').hidden = ui.tab !== 'gallery';
    if (ui.tab === 'crops') cropsTable(m, q); else if (ui.tab === 'gallery') gallery(m, list, q); else listTable(m, list, q);
    if (ui.sel && ui.sel.type === 'variety' && !m.live.some(v => v.id === ui.sel.id)) ui.sel = null;
    if (ui.sel && ui.sel.type === 'crop' && !m.eng.crop(ui.sel.id)) ui.sel = null;
    panel(m);
    for (const el of document.querySelectorAll('#seedsView [data-variety], #seedsView [data-croprow]')) {
      const on = !!ui.sel && ((ui.sel.type === 'variety' && el.dataset.variety === ui.sel.id) || (ui.sel.type === 'crop' && el.dataset.croprow === ui.sel.id));
      el.classList.toggle('sel', on);
      if (on && ui.keepFocus) { el.focus(); el.scrollIntoView({ block: 'nearest' }); }
    }
    ui.keepFocus = false;
  }

  /**
   * The list's columns: id, heading, right-aligned, width in px, and the order in which a column gives way.
   * The variety column takes what is left and never less than NAME_MIN, so a narrow window loses the columns
   * that say least (supplier, then the count of plantings, the first sowing date, the vendor size) before it loses names.
   */
  // ── a seed lot added where the variety is: a line that opens in the list under its row ──
  // The line at the top of the view is for a packet named by typing. From a variety's own row, "+ lot" opens this one
  // under that row, so the eye does not leave it; × or Escape closes it and nothing is added.
  const lotRow = { varietyId: '', vendor: '', year: String(new Date().getFullYear()), amount: '', status: 'usable', focus: '', node: null };
  const stockUnitOf = v => { const stock = App.stockNow(); return SL.STOCK_UNITS.find(u => stock['v:' + v.id + '|' + u]) || unitFor(App.state.engine.crop(v.cropId)); };
  function knownVendors() {
    const seen = new Map(), live = App.state.plan.varieties.filter(v => v.active !== false && !v.deleted);
    for (const s of [...live.map(v => v.supplier || (v.source === 'Farm entry' ? '' : v.source) || ''), ...((App.inventoryNow().lots || []).map(l => (l && l.supplier) || ''))]) { const key = SL.supplierKey(s); if (key && !/\.[a-z]{2,}$/i.test(s.trim()) && !seen.has(key)) seen.set(key, s.trim()); }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }
  function openLotRow(v) {
    if (lotRow.varietyId === v.id) { closeLotRow(); return; }
    Object.assign(lotRow, { varietyId: v.id, vendor: v.supplier || (v.source === 'Farm entry' ? '' : v.source) || '', amount: '', focus: 'lrAmount', node: null });
    schedule();
  }
  function closeLotRow(backTo) {
    const id = lotRow.varietyId;
    Object.assign(lotRow, { varietyId: '', amount: '', focus: '', node: null });
    schedule();
    if (backTo !== false && id) requestAnimationFrame(() => requestAnimationFrame(() => { const row = document.querySelector(`#sdBody .sd-var[data-variety="${CSS.escape(id)}"]`); if (row) row.focus({ preventScroll: true }); }));
  }
  function saveLotRow(v, say) {
    const fail = (text, id) => { say.textContent = text; const el = $(id || 'lrAmount'); if (el) el.focus(); };
    if (App.isSample()) { fail('This is the sample plan. Load your own first.'); return; }
    const ctx = { now: new Date().toISOString(), uid: App.uid, year: App.planYear(), name: '' }, before = App.state.plan.seedInventory || null, unit = stockUnitOf(v);
    let done;
    try { done = SL.quickLot(App.state.plan, App.inventoryNow(), { varietyId: v.id, name: v.name, cropId: '', vendor: lotRow.vendor, year: lotRow.year, quantity: lotRow.amount, unit, status: lotRow.status }, ctx); }
    catch (error) { const text = error.message || 'That lot could not be added.'; fail(text, /year/i.test(text) ? 'lrYear' : 'lrAmount'); return; }
    const what = `${num(done.lot.quantity, unit === 'g' ? 1 : 0)} ${unit === 'g' ? 'g' : unit} of ${v.name}`, state = lotRow.status === 'ordered' ? 'on order' : 'on hand';
    if (!App.commit(`${what} ${state}`, [{ kind: 'inventory', before, after: done.inventory }], { unchecked: true })) { fail('That lot could not be added.'); return; }
    toast(`${what} ${state}`, { label: 'Undo', run: App.undo });
    Object.assign(lotRow, { varietyId: '', amount: '', focus: '', node: null });
    ui.sel = { type: 'variety', id: v.id }; ui.panelKey = ''; schedule();
  }
  /** The line itself: vendor, year, amount, on hand or ordered, Add, and × to leave without adding. */
  function lotLine(v, cols, flat) {
    const unit = stockUnitOf(v), keep = key => e => { lotRow[key] = e.target.value; say.textContent = ''; };
    const say = h('p.ql-say', { id: 'lrSay', role: 'status', 'aria-live': 'polite' });
    const vendors = h('datalist', { id: 'lrVendors' });
    const vendor = h('input', { id: 'lrVendor', type: 'text', placeholder: 'Vendor', autocomplete: 'off', spellcheck: false, 'aria-label': 'Vendor', list: 'lrVendors', value: lotRow.vendor, oninput: keep('vendor'), onfocus: () => { if (!vendors.children.length) add(vendors, knownVendors().map(name => h('option', { value: name }))); } });
    const year = h('input', { id: 'lrYear', type: 'number', min: 1900, max: 2200, step: 1, placeholder: 'Year', title: 'The year the seed was packed for, or bought', 'aria-label': 'Year', value: lotRow.year, oninput: keep('year') });
    const amount = h('input', { id: 'lrAmount', type: 'number', min: 0, step: unit === 'g' ? 'any' : 1, placeholder: unit === 'g' ? 'Grams' : unit === 'plants' ? 'Plants' : 'Seeds', 'aria-label': 'Amount', value: lotRow.amount, oninput: keep('amount') });
    const where = h('div.seg.ql-where', { role: 'group', 'aria-label': 'Where the seed is' }, [['usable', 'On hand'], ['ordered', 'Ordered']].map(([id, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(lotRow.status === id), dataset: { where: id }, onclick: () => { lotRow.status = id; for (const b of where.children) b.setAttribute('aria-pressed', String(b.dataset.where === id)); } }, label)));
    const form = h('form.sd-quick-form.sd-lot-form', { id: 'lrForm', novalidate: true, autocomplete: 'off', 'aria-label': `Add a seed lot of ${v.name}`, onsubmit: e => { e.preventDefault(); saveLotRow(v, say); },
      onkeydown: e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLotRow(); } } },
      h('span.ql-label', 'New lot'), vendor, vendors, year, h('label.ql-amount', amount, h('span.ql-unit', unit === 'g' ? 'grams' : unit)), where,
      h('button.btn', { type: 'submit', id: 'lrAdd' }, 'Add'),
      h('button.icon-btn.lr-close', { type: 'button', id: 'lrClose', title: 'Close without adding a lot (Esc)', 'aria-label': `Cancel adding a lot of ${v.name}`, onclick: () => closeLotRow() }, '×'));
    return h('tr.sd-lotrow' + (flat ? '' : '.in-group'), { dataset: { lotFor: v.id } }, h('td', { colSpan: cols }, form, say));
  }

  const LIST_COLS = [['name', 'Variety'], ['sup', 'Supplier', 0, 122, 1], ['days', 'Days', 1, 84], ['from', 'Days counted from', 0, 138], ['tosow', 'To sow', 1, 88],
    ['hand', 'On hand', 1, 130], ['short', 'Short', 1, 62], ['size', 'Vendor size', 1, 134, 4], ['first', 'First sow', 1, 84, 3], ['uses', 'Plantings', 1, 84, 2]];
  const NAME_MIN = 190;
  function listCols() {
    const room = ($('sdScroll').clientWidth || 1240) - 40;
    let cols = LIST_COLS;
    const fixed = () => cols.reduce((n, c) => n + (c[3] || 0), 0);
    for (const rank of [1, 2, 3, 4]) { if (fixed() + NAME_MIN <= room) break; cols = cols.filter(c => c[4] !== rank); }
    return { cols, fixed: fixed(), key: cols.map(c => c[0]).join(' ') };
  }
  // Rows of the list are kept from one drawing to the next. A row is built again only when what it shows has changed:
  // its variety's record, what the plan needs of it, its lots, its picture, or the columns. The rest stay where they are,
  // so a change to one variety redraws one row, and pictures are not loaded twice.
  const rowCache = new Map(), drawn = { built: 0, kept: 0, moved: 0, builtEver: 0 };
  /** Make `body` hold exactly these rows in this order, touching only what differs. */
  function settle(body, wanted) {
    let at = body.firstChild;
    for (const node of wanted) { if (node === at) at = at.nextSibling; else { body.insertBefore(node, at); drawn.moved++; } }
    while (at) { const next = at.nextSibling; at.remove(); at = next; }
  }
  const lotsSig = r => SL.lotsFor(App.inventoryNow(), r.stockKey).map(l => [l.id, l.quantity, l.unit, l.life, l.usable === true]);
  const needSig = r => !r ? 0 : [r.key, r.unit, r.stockUnit, r.toSow, r.onHand, r.onOrder, r.short, r.first ? +r.first : 0, r.waiting, r.plantings, r.cover ? [r.cover.how, r.cover.text, r.cover.cost, r.cover.total] : 0, r.odd ? r.odd.map(u => [u.lot.id, u.lot.quantity, u.lot.unit, u.unit]) : 0, lotsSig(r)];
  const thumbSig = id => { const uri = T.get(id); return uri ? uri.length + uri.slice(-12) : T.remoteOf(id); };
  function listTable(m, list, q) {
    const { eng } = m, grouped = ui.sort === 'crop', plan = listCols(), ids = plan.cols.map(c => c[0]);
    ui.colsKey = plan.key;
    $('sdTable').style.minWidth = `${plan.fixed + NAME_MIN}px`;
    const folds = grouped ? groupsOf(m, list).map(g => g.id) : [], allShut = folds.length > 0 && folds.every(id => ui.closed.has(id));
    const fold = folds.length > 1 ? h('button.link.sd-fold', { type: 'button', id: 'sdFold', onclick: () => { if (allShut) ui.closed.clear(); else folds.forEach(id => ui.closed.add(id)); schedule(); } }, allShut ? 'Expand all' : 'Collapse all') : null;
    clear($('sdHead')).append(h('tr', plan.cols.map(([id, t, n, w]) => h('th' + (n ? '.sd-num' : ''), w ? { style: { width: w + 'px' } } : {}, t, id === 'name' ? fold : null))));
    // a redraw while a lot is being typed (a photo arriving, say) must not take the cursor out of it
    const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('.sd-lotrow') ? document.activeElement.id : '';
    if (typing && !lotRow.focus) lotRow.focus = typing;
    const body = $('sdBody'), cols = ids.length, wanted = [], seen = new Set();
    drawn.built = drawn.kept = drawn.moved = 0;
    const kept = (key, sig, same, build, extra) => {
      const was = rowCache.get(key);
      seen.add(key);
      if (was && was.sig === sig && same(was)) { drawn.kept++; return was.nodes; }
      const nodes = build();
      rowCache.set(key, { sig, nodes, ...extra }); drawn.built++; drawn.builtEver++;
      return nodes;
    };
    const row = (v, flat) => {
      // a row with a lot being added under it is always drawn afresh: the line beneath it is the one being typed in
      if (lotRow.varietyId === v.id) { rowCache.delete('v:' + v.id); seen.add('v:' + v.id); drawn.built++; drawn.builtEver++; return rowOf(v, flat); }
      const crop = eng.crop(v.cropId);
      return kept('v:' + v.id, JSON.stringify([plan.key, flat, cropName(crop), crop && eng.cropColor(crop), m.used.get(v.id) || 0, thumbSig(v.id), needSig(m.byV.get(v.id))]), was => was.v === v, () => rowOf(v, flat), { v });
    };
    const rowOf = (v, flat) => {
      const r = m.byV.get(v.id), basis = v.catalogMaturityBasis || 'unspecified', crop = eng.crop(v.cropId), site = SL.hostOf(v.url);
      const stage = v.catalogHarvestStage && v.catalogHarvestStage !== 'unspecified' ? v.catalogHarvestStage : '';
      const cell = {
        name: () => h('td', h('div.sd-cell', T.el({ varietyId: v.id, color: crop && eng.cropColor(crop), label: v.name, size: 34 }), h('span.sd-name', h('span.as-vname', v.name), flat ? h('small', cropName(crop)) : null),
          h('button.sd-addlot', { type: 'button', title: lotRow.varietyId === v.id ? 'Close without adding a lot' : `Add a seed lot of ${v.name}: a line opens under this row`, 'aria-label': `Add a seed lot of ${v.name}`, 'aria-expanded': String(lotRow.varietyId === v.id), onclick: () => openLotRow(v) }, '+ lot'))),
        sup: () => h('td.sd-sup', supplierShort(v) || (v.source === 'Farm entry' ? 'By hand' : ''), site ? h('a', { href: v.url, target: '_blank', rel: 'noopener noreferrer', title: `${v.sku ? v.sku + ' · ' : ''}open the page on ${site}` }, ' ↗') : null),
        days: () => h('td.sd-num.sd-days', daysText(v) || '—', stage ? h('small', stage) : null),
        from: () => v.catalogDtm ? h('td.sd-from' + (basis === 'unspecified' ? '.sd-open' : ''), sel('from', BASIS_SHORT, basis, { 'aria-label': `${v.name}: days counted from`, onchange: async e => {
          const value = e.target.value;
          if (!(await App.revise(`${v.name}: days counted from ${BASIS_TEXT[value]}`, [{ kind: 'variety', before: v, after: { ...v, catalogMaturityBasis: value, catalogSourceChoice: v.catalogSourceChoice || 'url' } }]))) schedule();
        } })) : h('td.sd-from', v.dtm > 0 ? h('small', 'the day it goes in') : ''),
        tosow: () => h('td.sd-num', r && r.toSow > 0 ? amount(r) : ''),
        hand: () => stockCell(r, v.name),
        short: () => h('td.sd-num', r && r.short > 0 ? num(r.short, r.unit === 'g' ? 1 : 0) : ''),
        size: () => sizeCell(r, v),
        first: () => h('td.sd-num', r && r.first ? day(r.first) : ''),
        uses: () => h('td.sd-num', m.used.get(v.id) || '')
      };
      const tr = h('tr.sd-var' + (flat ? '' : '.in-group') + (lotRow.varietyId === v.id ? '.adding' : ''), { tabIndex: 0, 'aria-label': `${v.name}, ${cropName(crop)}`, dataset: { variety: v.id }, onclick: e => { if (!e.target.closest('a, select, input, button')) select({ type: 'variety', id: v.id }); }, onkeydown: rowKey }, ids.map(id => cell[id]()));
      if (lotRow.varietyId !== v.id) return [tr];
      // the same line is put back under the row on a redraw, so what is typed in it, and where the cursor is, are kept
      const line = lotRow.node && lotRow.node.dataset.lotFor === v.id ? lotRow.node : (lotRow.node = lotLine(v, cols, flat));
      line.firstChild.colSpan = cols; line.classList.toggle('in-group', !flat);
      return [tr, line];
    };
    let shown = 0;
    if (!grouped) {
      const key = { name: v => v.name, days: v => v.catalogDtm || v.dtm || 9999, tosow: v => -((m.byV.get(v.id) || {}).toSow || 0), first: v => { const r = m.byV.get(v.id); return r && r.first ? +r.first : Infinity; }, supplier: v => supplierShort(v) || '~' }[ui.sort];
      for (const v of list.slice().sort((a, b) => { const x = key(a), y = key(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) || String(a.name).localeCompare(String(b.name)); })) { wanted.push(...row(v, true)); shown++; }
    } else {
      const groups = groupsOf(m, list);
      // crops planted with no variety chosen still need seed
      if (['all', 'planted', 'tosow'].includes(ui.filter)) for (const [id, rows] of m.byCrop) if (!groups.some(g => g.id === id) && rows.some(r => r.toSow > 0) && (!q || cropName(eng.crop(id)).toLowerCase().includes(q))) groups.push({ id, crop: eng.crop(id), list: [] });
      groups.sort((a, b) => cropName(a.crop).localeCompare(cropName(b.crop)));
      for (const g of groups) {
        const closed = ui.closed.has(g.id), color = g.crop ? eng.cropColor(g.crop) : 'var(--line)', plain = (m.byCrop.get(g.id) || []).filter(r => r.toSow > 0 && ui.filter !== 'short' && ui.filter !== 'open');
        const seeds = g.list.reduce((n, v) => { const r = m.byV.get(v.id); return n + (r && r.unit === 'seeds' ? r.toSow : 0); }, 0) + plain.reduce((n, r) => n + (r.unit === 'seeds' ? r.toSow : 0), 0);
        wanted.push(...kept('c:' + g.id, JSON.stringify([cols, closed, color, cropName(g.crop), g.list.length, g.crop ? howPlanted(g.crop) : '', seeds, thumbSig((g.list.find(v => T.has(v.id)) || {}).id), T.forCrop(g.id).length]), () => true, () => [h('tr.sd-crop' + (closed ? '.closed' : ''), { dataset: { crop: g.id }, onclick: e => { if (e.target.closest('.link')) return; closed ? ui.closed.delete(g.id) : ui.closed.add(g.id); schedule(); } }, h('td', { colSpan: cols }, h('div.as-name',
          h('button.as-more', { type: 'button', 'aria-expanded': String(!closed), 'aria-label': `${closed ? 'Show' : 'Hide'} ${cropName(g.crop)}` }, closed ? '▸' : '▾'),
          T.el({ cropId: g.id, color, label: cropName(g.crop), size: 26, cls: 'key' }), h('b', g.crop ? g.crop.name : 'A crop that is no longer in the library'),
          h('small', `${g.list.length} variet${g.list.length === 1 ? 'y' : 'ies'}${g.crop ? ' · ' + howPlanted(g.crop) : ''}${seeds ? ` · ${num(seeds)} seeds to sow` : ''}`),
          h('span.grow'),
          g.crop ? h('button.link', { type: 'button', onclick: () => select({ type: 'crop', id: g.id }) }, 'Edit crop') : null,
          g.crop ? h('button.link', { type: 'button', onclick: () => openVariety(null, g.id) }, 'Add a variety') : null)))]));
        if (closed) continue;
        for (const v of g.list) { wanted.push(...row(v, false)); shown++; }
        for (const r of plain) {
          shown++;
          const cell = {
            name: () => h('td', h('div.sd-cell', T.el({ cropId: g.id, color, label: cropName(g.crop), size: 34, cls: 'faint' }), h('span.sd-name', h('small', 'No variety chosen')))),
            sup: () => h('td.sd-sup'), days: () => h('td'), from: () => h('td'), size: () => h('td'),
            tosow: () => h('td.sd-num', amount(r)), hand: () => stockCell(r, `${cropName(g.crop)}, no variety`), short: () => h('td.sd-num', r.short > 0 ? num(r.short) : ''),
            first: () => h('td.sd-num', r.first ? day(r.first) : ''), uses: () => h('td.sd-num', r.waiting === r.plantings ? r.plantings : `${r.waiting} of ${r.plantings}`)
          };
          wanted.push(...kept('n:' + r.key, JSON.stringify([plan.key, color, cropName(g.crop), T.forCrop(g.id).length, needSig(r)]), () => true, () => [h('tr.sd-need.in-group', { dataset: { key: r.key } }, ids.map(id => cell[id]()))]));
        }
      }
    }
    if (!shown && !wanted.length) wanted.push(h('tr', h('td.empty', { colSpan: cols }, q ? `No variety matches “${ui.query}”.` : ui.filter === 'open' ? 'Every variety with supplier days says where they are counted from.' : ui.filter !== 'all' ? 'No variety fits this filter.' : App.isSample() ? 'The sample plan has no varieties. Load your backup, or add one.' : 'No varieties yet. Add one from a supplier page.')));
    settle(body, wanted);
    for (const key of [...rowCache.keys()]) if (!seen.has(key)) rowCache.delete(key);
    foot(m);
    if (lotRow.focus) {
      const el = $(lotRow.focus), fresh = !typing;
      lotRow.focus = '';
      if (el) { el.focus({ preventScroll: true }); if (fresh) { if (el.select) el.select(); el.closest('tr').scrollIntoView({ block: 'nearest' }); } }
    }
  }
  /** What covers a row's shortfall, in the sizes its vendor sells. Nothing when nothing is short. */
  function sizeCell(r, v) {
    const c = r && r.cover;
    if (!c) return h('td.sd-num.sd-size');
    const vendor = supplierShort(v) || 'the vendor', short = `${num(r.short, r.unit === 'g' ? 1 : 0)} ${r.unit === 'g' ? 'g' : r.unit}`;
    const title = c.how === 'sizes' ? `Covers the ${short} short: ${num(c.total, r.unit === 'g' ? 1 : 0)} ${r.unit === 'g' ? 'g' : 'seeds'}${c.cost != null ? ` for ${SL.money(c.cost)}` : ''}, the least cost among the sizes ${vendor} lists.`
      : c.how === 'unsized' ? `${vendor} sells a packet for ${SL.money(c.packet.price)} but its page gives no seed count. Type it under “Seeds per packet” in the panel.`
        : c.how === 'packet' ? `${vendor}’s size list is not on file; this is the packet size its page gives.` : `${vendor}’s size list is not on file; this is the weight of the ${short} short.`;
    return h('td.sd-num.sd-size' + (c.how === 'sizes' ? '' : '.soft'), { title }, c.text);
  }
  function foot(m) {
    const bare = m.live.filter(v => !v.supplier && !v.url && !v.catalogDtm).length, sown = m.need.rows.reduce((n, r) => n + (r.plantings - r.waiting - r.established), 0);
    const item = (label, ...text) => h('li', h('b', label), h('span', text));
    add(clear($('sdFoot')), h('ul.sd-foot-list',
      m.live.length && bare === m.live.length ? item('Figures only', 'These varieties carry planning figures only. Supplier, product code and page come in when you load your backup here.') : null,
      item('Seed counts', `allow for ${m.need.settings.germ}% germination${m.need.settings.buffer ? ` and ${m.need.settings.buffer}% extra plugs on transplants` : ''}. Transplants are sown in whole rows of their tray; plantings of one variety sown the same day are rounded together, as in Tasks.`),
      sown ? item('Left out', `${sown} planting${sown === 1 ? ' is' : 's are'} already sown or planted.`) : null,
      item('On hand', 'Type what you have; click an order when it arrives. Each variety’s lots and sizes are in its panel.'),
      item('Vendor size', 'What covers a shortfall at least cost, in the sizes that variety’s vendor sells.')),
      h('button.link', { type: 'button', onclick: () => download(m) }, 'Download seeds required (.csv)'));
  }
  function gallery(m, list, q) {
    const host2 = clear($('sdGallery')), { eng } = m, cards = h('div.sd-cards');
    // one continuous wall of photos, in crop order: single-variety crops would otherwise leave most of each row empty
    for (const g of groupsOf(m, list)) {
      const color = g.crop ? eng.cropColor(g.crop) : 'var(--line)';
      for (const v of g.list) {
        const r = m.byV.get(v.id), basis = v.catalogMaturityBasis || 'unspecified', days = daysText(v);
        cards.append(h('button.sd-card', { type: 'button', dataset: { variety: v.id }, 'aria-label': `${v.name}, ${cropName(g.crop)}`, onclick: () => select({ type: 'variety', id: v.id }) },
          T.el({ varietyId: v.id, color, label: v.name, cls: 'fill' }),
          h('span.sd-card-crop', h('i', { style: { background: color } }), cropName(g.crop)), h('b', v.name),
          h('small', days ? `${days} d${v.catalogDtm ? ' · ' + (basis === 'unspecified' ? 'start not stated' : 'from ' + BASIS_TEXT[basis]) : ''}` : supplierShort(v) || '—'),
          r && r.toSow > 0 ? h('span.sd-badge', `${num(r.toSow, r.unit === 'g' ? 1 : 0)} ${r.unit === 'seeds' ? 'to sow' : SL.UNIT_WORD[r.unit]}`) : null));
      }
    }
    host2.append(list.length ? cards : h('p.empty', q ? `No variety matches “${ui.query}”.` : 'No variety fits this filter.'));
    foot(m);
  }
  /** How a crop gets into the ground, as the grower would say it. */
  const howPlanted = c => c.micro ? 'live trays' : (c.plantingMaterial || c.material) === 'bulb' ? 'from bulbs' : c.plantingMaterial === 'plant' ? 'bought-in plants' : c.method === 'TP' ? 'transplanted' : 'direct sown';
  function cropsTable(m, q) {
    const { eng, plan } = m, settings = plan.settings.cropTypeList || {};
    const heads = [['Crop'], ['Planted', 0, 124], ['Nursery days', 1, 104], ['In row (in)', 1, 96], ['Rows apart (in)', 1, 114], ['Rows per bed', 1, 104], ['Varieties', 1, 84], ['Plantings', 1, 84]];
    $('sdTable').style.minWidth = `${heads.reduce((n, c) => n + (c[2] || 0), 0) + NAME_MIN}px`; ui.colsKey = '';
    clear($('sdHead')).append(h('tr', heads.map(([t, n, w]) => h('th' + (n ? '.sd-num' : ''), w ? { style: { width: w + 'px' } } : {}, t))));
    const body = clear($('sdBody'));
    for (const c of sortedCrops()) {
      const vs = eng.varietiesOf(c.id), mine = root.LRFPanels.isMine(c, m.usedCrop, vs, settings);
      if (q ? !String(c.name).toLowerCase().includes(q) : !mine) continue;
      body.append(h('tr.sd-var.sd-croprow', { tabIndex: 0, dataset: { croprow: c.id }, 'aria-label': c.name, onclick: () => select({ type: 'crop', id: c.id }), onkeydown: e => { if (e.key === 'Enter') select({ type: 'crop', id: c.id }); } },
        h('td', h('div.sd-cell', T.el({ cropId: c.id, color: eng.cropColor(c), label: c.name, size: 34, cls: 'key' }), h('span.sd-name', h('b', c.name), c.family ? h('small', c.family) : null))),
        h('td', howPlanted(c)),
        h('td.sd-num', c.method === 'TP' && c.gh ? num(c.gh * 7) : ''), h('td.sd-num', c.inRow ? num(c.inRow, 2) : ''), h('td.sd-num', c.rowSp ? num(c.rowSp, 2) : ''),
        h('td.sd-num', c.rowsPerBed != null && c.rowsPerBed !== '' ? String(c.rowsPerBed) : h('small', 'by width')), h('td.sd-num', vs.length || ''), h('td.sd-num', m.usedCrop.get(c.id) || '')));
    }
    if (!body.children.length) body.append(h('tr', h('td.empty', { colSpan: 8 }, q ? `No crop matches “${ui.query}”.` : 'No crops yet.')));
    add(clear($('sdFoot')), q ? null : 'Your crops: planted this season, or kept with varieties. Search to reach any other crop the planner knows.');
  }

  // ── the detail panel: what is selected, edited in place ──
  function panel(m, force) {
    const key = JSON.stringify(ui.sel) + '|' + ui.rev;
    if (!force && key === ui.panelKey) return;
    ui.panelKey = key;
    if (host) host.closed = true;
    const el = clear($('sdPanel')), body = h('div.dlg-body'), status = h('p.dlg-status', { role: 'status', 'aria-live': 'polite' });
    host = { el, body, closed: false, close() { ui.panelKey = ''; schedule(); }, say(text, kind) { status.textContent = text || ''; status.dataset.kind = kind || ''; } };
    const { eng, plan } = m, shut = h('button.icon-btn.close', { type: 'button', 'aria-label': 'Close', onclick: () => select(null) }, '×');
    const stat = (label, value, small) => h('div.sd-stat', h('small', label), h('b', value), small ? h('span', small) : null);
    if (!ui.sel) {
      const rows = m.need.rows.filter(r => r.toSow > 0), seeds = rows.reduce((n, r) => n + (r.unit === 'seeds' ? r.toSow : 0), 0), open = m.live.filter(noStart).length, short = [...m.byV.values()].filter(r => r.short > 0).length, onOrder = Object.values(m.stock).filter(x => x.onOrder > 0).length;
      add(el, h('header.sd-ph.plain', h('div', h('p.eyebrow', `${App.planYear()} season`), h('h2', 'Seed library'))),
        h('div.sd-stats', stat('Varieties', num(m.live.length), `${m.live.filter(v => m.used.has(v.id)).length} planted`), stat('To sow', num(seeds), 'seeds'), stat('Short', num(short), 'varieties')),
        onOrder ? h('button.sd-task.plain', { type: 'button', id: 'sdReceiveAll', onclick: receiveAll }, h('b', `Seed for ${onOrder} variet${onOrder === 1 ? 'y' : 'ies'} is on order`), h('span', 'When the box comes, click an order in the list to count it as on hand, or click here to mark every order as arrived.')) : null,
        m.unlisted.length ? unlistedBox(m) : null,
        open ? h('button.sd-task', { type: 'button', onclick: () => { ui.filter = 'open'; ui.tab = 'list'; schedule(); } }, h('b', `${open} variet${open === 1 ? 'y has' : 'ies have'} supplier days that do not say where they are counted from`), h('span', 'For a transplanted crop that can move the harvest by the whole nursery time. Set each one in the “Days counted from” column, or set the crop’s once on the Assumptions list.')) : null,
        h('p.dlg-hint', 'Click a variety to see and edit it here. With a row in focus, ↑ and ↓ move between varieties and Enter jumps to its first field.'),
        h('p.dlg-hint', serviceReady() ? 'Links are read for you: paste a product page’s address.' : 'Links are read through Cloud sync once this device is connected. Where a link cannot be read, the page’s text can be copied in instead.'));
      return;
    }
    if (ui.sel.type === 'crop') {
      const c = eng.crop(ui.sel.id), n = m.usedCrop.get(c.id) || 0, vs = eng.varietiesOf(c.id);
      add(el, h('header.sd-ph', T.el({ cropId: c.id, color: eng.cropColor(c), label: c.name, size: 96, cls: 'key' }), h('div', h('p.eyebrow', 'Crop'), h('h2', c.name), h('p.sd-sub', `${vs.length} variet${vs.length === 1 ? 'y' : 'ies'} · ${n} planting${n === 1 ? '' : 's'}`)), shut), body, status);
      openCrop(c, host);
      return;
    }
    const v = eng.variety(ui.sel.id), crop = eng.crop(v.cropId), r = m.byV.get(v.id), n = m.used.get(v.id) || 0, site = SL.hostOf(v.url), color = crop && eng.cropColor(crop);
    const pick = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => {
      const file = e.target.files[0]; e.target.value = '';
      if (!file) return;
      try { const kept = await App.keepThumb(v.id, await T.make(file)); toast(kept === false ? 'Photo set for this session. This view has nowhere to keep it.' : `Photo set for ${v.name}.`); } catch (_) { toast('That file is not a picture this browser can read.'); }
    } });
    add(el, h('header.sd-ph', T.el({ varietyId: v.id, color, label: v.name, size: 120 }),
        h('div', h('p.eyebrow', cropName(crop)), h('h2', v.name),
          h('p.sd-sub', supplierShort(v) || 'Entered by hand', v.sku ? ` · ${v.sku}` : '', site ? h('a', { href: v.url, target: '_blank', rel: 'noopener noreferrer' }, ' ↗') : null),
          h('button.link', { type: 'button', onclick: () => pick.click() }, T.get(v.id) ? 'Change photo' : 'Add a photo'), pick),
        shut),
      h('div.sd-stats', n ? h('button.sd-stat.jump', { type: 'button', title: 'Go to its plantings, where a sowing is recorded', onclick: () => { const to = $('sdPlan'); if (to) to.scrollIntoView({ block: 'start' }); } }, h('small', 'Plantings'), h('b', String(n)), h('span', 'sowing ↓')) : stat('Plantings', '—'),
        stat('To sow', r && r.toSow > 0 ? num(r.toSow, r.unit === 'g' ? 1 : 0) : '—', r && r.toSow > 0 ? (r.unit === 'seeds' ? SL.measures(r.toSow, v).weight || 'seeds' : SL.UNIT_WORD[r.unit]) : null),
        stat('On hand', r && r.onHand ? num(r.onHand) : '—', r && r.onOrder ? `${num(r.onOrder)} ordered` : r && r.short > 0 ? `short ${num(r.short)}` : null)),
      lotsBox('v:' + v.id, r ? r.stockUnit : unitFor(crop), v.name, r && r.odd), sizesBox(v, crop, r), body, status);
    openVariety(v, null, host);
    const mine = plan.plantings.filter(p => p.varietyId === v.id).map(p => ({ p, r: eng.calc(p) })).filter(x => x.r).sort((a, b) => a.r.field - b.r.field);
    const sownCount = mine.filter(({ p }) => { const s = App.sowingOf(p); return s && s.sown; }).length;
    if (mine.length) add(el, h('h3.sd-h', { id: 'sdPlan' }, `In the plan · ${mine.length}${sownCount ? ` · ${sownCount} sown` : ''}`), h('div.sd-pls', mine.slice(0, 40).map(({ p, r: c }) => {
      const s = App.sowingOf(p), open = ui.sowOpen === p.id;
      return [h('div.sd-plrow',
        h('button.sd-pl', { type: 'button', title: 'Show on the map', onclick: () => { App.setView('map'); App.setDate(c.field); App.select({ type: 'planting', id: p.id }); } },
          h('b', day(c.field)), h('span', { title: App.bedLabel(c.b) }, h('em', `${{ bed: 'Bed', tower: 'Tower', bench: 'Bench' }[eng.spaceKind(c.b)] || ''} ${c.b.bed}`.trim()), ` ${(eng.gardenOf(c.b) || {}).name || ''}`), h('small', `harvest ${day(c.first)}${eng.pinned(p) ? ' · own days' : ''}`)),
        s ? h('button.sd-sowbtn' + (s.sown ? '.done' : ''), { type: 'button', 'aria-expanded': String(open), dataset: { sowfor: p.id }, title: s.sown ? 'See what was recorded, or take it back' : 'Record that this was sown: the seed comes off stock', onclick: () => { ui.sowOpen = open ? null : p.id; ui.panelKey = ''; schedule(); } }, s.sown ? '✓ sown' : 'Sown…') : h('span.sd-sowbtn.none', 'in place')),
        open ? root.LRFPanels.sowingBox(p) : null];
    })), mine.length > 40 ? h('p.dlg-hint', `and ${mine.length - 40} more`) : null);
  }

  /** The sizes this variety's vendor sells, and which of them covers what is short. */
  function sizesBox(v, crop, r) {
    // the list the row's answer was worked out from, so the sizes it chose can be marked
    const c = r && r.cover, sizes = (c && c.sizes) || App.packsFor(v), vendor = supplierShort(v) || 'the vendor', picked = new Map(((c && c.items) || []).map(i => [i.pack, i.n]));
    const all = sizes.list.length + sizes.unsized.length, perK = p => (p.price != null && p.seeds ? SL.money(p.price / p.seeds * 1000) : '');
    const box = h('section.sd-sizes', { id: 'sdSizes' }, h('h3.sd-h', all ? `Sizes ${vendor} sells · ${all}` : 'Vendor sizes'));
    if (!all) {
      box.append(h('p.dlg-hint', v.seedsPerPacket > 0 ? `No size list is on file for ${v.name}; its page gives a packet of ${num(v.seedsPerPacket)}. Reading the page again brings the list in.` : v.url ? `No size list is on file for ${v.name}. Reading its page again brings one in.` : 'Entered by hand, so there is no vendor list. Put the vendor’s packet under “Seeds per packet”.'));
      return box;
    }
    const table = h('div.sd-sizetable', h('div.sd-sizerow.head', h('span', ''), h('span', 'Size'), h('span', 'Price'), h('span', 'per 1,000')));
    for (const p of sizes.list) table.append(h('div.sd-sizerow' + (picked.has(p) ? '.on' : ''), { dataset: { size: p.text } },
      h('span', picked.has(p) ? `${picked.get(p)} ×` : ''),
      h('span', p.text, p.repaired ? ' †' : null, p.worked === 'seeds' ? h('small', `≈ ${num(p.seeds)} seeds`) : null),
      h('span', p.price != null ? SL.money(p.price) : '—'), h('span', perK(p))));
    for (const p of sizes.unsized) table.append(h('div.sd-sizerow.soft', h('span', ''), h('span', 'packet', h('small', 'count not given')), h('span', SL.money(p.price)), h('span', '')));
    box.append(table);
    const unit = r && r.unit === 'g' ? 'g' : 'seeds', short = r && r.short > 0 ? `${num(r.short, unit === 'g' ? 1 : 0)} ${unit}` : '';
    if (c && c.how === 'sizes') box.append(h('p.sd-sizesay', h('b', c.text), ` covers the ${short} short${c.cost != null ? ` for ${SL.money(c.cost)}` : ''}, with ${num(c.total - r.short, unit === 'g' ? 1 : 0)} over. It is the least cost among these sizes.`));
    else if (c && c.how === 'unsized') box.append(h('p.sd-odd', `${vendor}’s page gives no seed count for its packet, so it cannot be weighed against the other sizes. Type the count under “Seeds per packet” below.`));
    else if (short && r.unit === 'seeds' && sizes.list.length && sizes.list.every(p => !p.seeds)) box.append(h('p.sd-odd', `These are weights, and the page gives no seeds per ounce, so the plan cannot tell which covers ${short}. Type “Seeds per ounce” below.`));
    else if (r && r.toSow > 0 && !short) box.append(h('p.dlg-hint', 'Seed on hand or on order covers what is still to sow.'));
    for (const text of sizes.notes) box.append(h('p.sd-odd', '† ' + text));
    if (sizes.list.some(p => p.worked === 'seeds')) box.append(h('p.dlg-hint', 'Seed counts marked ≈ come from the page’s seeds per ounce or pound, which is an average.'));
    if (r && r.unit === 'plants' && boughtIn(crop) && soldAsSeed(v)) box.append(h('div.sd-oddbox', h('p.sd-odd', `${vendor} sells ${v.name} as seed, but ${cropName(crop)} is set to bought-in plants, so the plan counts plants and asks for no seed.`),
      h('button.link', { type: 'button', dataset: { fix: 'seed' }, onclick: () => sowFromSeed(crop) }, `${cropName(crop)} is sown from seed`)));
    box.append(h('p.dlg-hint', 'Prices are as the page gave them when it was last read.'));
    return box;
  }

  function download(m) {
    const cell = x => { const s = x == null ? '' : String(x); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [['Crop', 'Variety', 'Supplier', 'Product code', 'To sow', 'Unit', 'On hand', 'Ordered', 'Short', 'By weight', 'Vendor size to cover short', 'Cost', 'First sowing', 'Plantings to sow', 'Plantings']];
    for (const r of m.need.rows) {
      if (!(r.toSow > 0)) continue;
      const v = r.variety, ms = r.unit === 'seeds' ? SL.measures(r.toSow, v) : { weight: '', packets: '' }, c = r.cover;
      lines.push([cropName(r.crop), v ? v.name : '', v ? v.supplier || v.source || '' : '', v ? v.sku || '' : '', Math.round(r.toSow * 10) / 10, r.unit, r.onHand, r.onOrder, r.short, ms.weight, c ? c.text : '', c && c.cost != null ? c.cost.toFixed(2) : '', r.first ? E.d2s(r.first) : '', r.waiting, r.plantings]);
    }
    const blob = new Blob(['﻿' + lines.map(l => l.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }), filename = `seeds-required-${App.planYear()}-${E.d2s(new Date())}.csv`;
    const fallback = () => { const url = URL.createObjectURL(blob), a = h('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); };
    const downloads = root.claude && root.claude.use ? root.claude.use('downloads') : null;
    if (downloads) Promise.resolve(downloads).then(dl => dl.save({ filename, data: blob })).catch(error => { if (!error || error.code !== 'declined') fallback(); }); else fallback();
  }

  // ───────────────────────── the order sheet ─────────────────────────
  // Opened in place over the list. What is short today, by supplier, in each supplier's own sizes; an amount can be changed,
  // a variety that is not short can be added, and a supplier's lines can be marked as ordered in one step.
  let order = null;
  const framed = (() => { try { return root.self !== root.top; } catch (_) { return true; } })();
  function openOrder() {
    if (order) return;
    const amounts = {}, added = new Set(), host = h('div.od-scroll', { id: 'odScroll' }), sum = h('div.od-sum', { id: 'odSum' });
    const close = () => { if (!order) return; order = null; el.close(); el.remove(); };
    const today = () => UI.dayLong(new Date()).replace(/^\w+ /, '');
    const build = () => {
      const m = model(), rows = [...m.need.rows];
      for (const id of added) { const r = m.byV.get(id); if (r && !rows.includes(r)) rows.push(r); }
      const sheet = SL.orderSheet(rows, (amount, unit, v) => App.coverFor(amount, unit, v), amounts), pairs = root.LRFAudit.pairs(m.eng).size, waiting = App.waiting().length;
      const blind = [...new Set(m.need.rows.filter(r => r.unit === 'g' && r.plantings > r.established && !(r.total > 0)).map(r => cropName(r.crop)))];
      const notes = [pairs ? `Seed for both plantings is counted where ground is booked twice (${pairs} pair${pairs === 1 ? '' : 's'} in the plan).` : '', waiting ? `${waiting} planting${waiting === 1 ? '' : 's'} waiting to be placed ${waiting === 1 ? 'is' : 'are'} not counted.` : '',
        blind.length ? `No seed is counted for ${blind.length} tray crop${blind.length === 1 ? '' : 's'} with no seed figure yet: ${blind.join(', ')}.` : '', 'Prices and sizes are as each supplier’s page gave them when it was last read.'].filter(Boolean);
      return { m, sheet, notes };
    };
    const text = () => { const { m, sheet, notes } = build(); return SL.orderText(sheet, { farm: m.plan.settings.farm || 'Farm', year: App.planYear(), date: today(), notes }); };
    const markOrdered = g => {
      const year = new Date().getFullYear();
      const done = App.editStock(`${g.name}: ${g.lines.length} line${g.lines.length === 1 ? '' : 's'} marked as ordered`, (lib, ctx) => g.lines.reduce((l, line) => SL.addLot(l, { key: line.row.stockKey, unit: line.row.stockUnit, quantity: line.unit === 'g' ? Math.round(line.buy * 10) / 10 : Math.ceil(line.buy), status: 'ordered', supplier: g.key ? g.name : '', year }, ctx), lib));
      if (done) { for (const line of g.lines) { delete amounts[line.key]; added.delete(line.variety.id); } UI.toast(`${g.name}: ${g.lines.length} line${g.lines.length === 1 ? '' : 's'} on order. “Order arrived” in the list turns each into seed on hand.`, { label: 'Undo', run: App.undo }); }
    };
    const draw = () => {
      const { m, sheet, notes } = build(), top = host.scrollTop;
      clear(host);
      if (!sheet.groups.length && !sheet.loose.length) host.append(h('p.od-none', { id: 'odNone' }, 'Nothing is short: seed on hand and on order covers everything still to sow.'));
      for (const g of sheet.groups) {
        host.append(h('div.od-group', { dataset: { supplier: g.key || '-' } },
          h('div.od-head', h('b', g.name), h('span', `${g.lines.length} line${g.lines.length === 1 ? '' : 's'}`), h('span.grow'), g.unpriced ? h('small', `${g.unpriced} with no price on file`) : null, h('b.od-cost', g.cost > 0 ? SL.money(g.cost) : '—'),
            h('button.btn.small', { type: 'button', dataset: { ordered: g.key || '-' }, title: 'Adds each line to your seed stock as “on order”, in the amounts shown, so it is no longer short. One undo takes it back.', onclick: () => markOrdered(g) }, 'Mark as ordered')),
          h('table.od', h('tbody', g.lines.map(l => h('tr', { dataset: { line: l.key } },
            h('td.od-name', h('b', l.variety.name), h('small', cropName(l.crop))),
            h('td.od-sku', l.sku),
            h('td.od-n', { title: `Still to sow ${num(l.row.toSow, l.unit === 'g' ? 1 : 0)}, on hand ${num(l.row.onHand || 0)}, on order ${num(l.row.onOrder || 0)}` }, l.short > 0 ? `${num(l.short, l.unit === 'g' ? 1 : 0)} short` : 'not short'),
            h('td.od-amt', h('input', { type: 'number', min: 0, step: l.unit === 'g' ? 'any' : 1, value: amounts[l.key] != null ? amounts[l.key] : '', placeholder: String(l.short || 0), 'aria-label': `${l.variety.name}: amount to buy`, title: 'The amount to cover. Leave it empty for the shortfall.', dataset: { amount: l.key },
              onchange: e => { const raw = e.target.value.trim(); if (raw === '' || !(+raw >= 0)) delete amounts[l.key]; else amounts[l.key] = +raw; draw(); } }), h('small', l.unit === 'g' ? 'g' : SL.UNIT_WORD[l.unit] || l.unit)),
            h('td.od-size' + (l.sized ? '' : '.soft'), { title: l.sized ? `Covers ${num(l.amount, l.unit === 'g' ? 1 : 0)}: ${num(l.buy, l.unit === 'g' ? 1 : 0)} in all, the least cost among the sizes ${g.name} lists.` : 'This supplier’s sizes are not on file for this variety.' }, l.text || 'size not on file'),
            h('td.od-n.od-cost', l.cost != null ? SL.money(l.cost) : '—'))))))); 
      }
      if (sheet.loose.length) host.append(h('div.od-group', { dataset: { supplier: 'loose' } }, h('div.od-head', h('b', 'No variety chosen'), h('span', 'nothing to order by name until a variety is picked for these plantings')),
        h('table.od', h('tbody', sheet.loose.map(l => h('tr', h('td.od-name', h('b', cropName(l.crop))), h('td.od-sku'), h('td.od-n', `${num(l.amount, l.unit === 'g' ? 1 : 0)} ${l.unit === 'g' ? 'g' : SL.UNIT_WORD[l.unit] || l.unit}`), h('td'), h('td'), h('td')))))));
      host.scrollTop = top;
      // a variety that is not short can be added: a top-up
      const on = new Set(sheet.groups.flatMap(g => g.lines.map(l => l.variety.id))), rest = m.live.filter(v => !on.has(v.id) && m.byV.get(v.id) && ['seeds', 'g'].includes(m.byV.get(v.id).unit)).sort((a, b) => cropName(m.eng.crop(a.cropId)).localeCompare(cropName(m.eng.crop(b.cropId))) || String(a.name).localeCompare(String(b.name)));
      const pick = h('select', { id: 'odAdd', 'aria-label': 'Add a variety to the sheet' }, h('option', { value: '' }, 'Add a variety that is not short…'), rest.map(v => h('option', { value: v.id }, `${cropName(m.eng.crop(v.cropId))} · ${v.name}`)));
      const qtyBox = h('input', { type: 'number', min: 1, step: 1, id: 'odAddQty', placeholder: 'amount', 'aria-label': 'Amount to buy' });
      const addLine = () => { const r = m.byV.get(pick.value), n = +qtyBox.value; if (!r || !(n > 0)) { UI.toast('Choose a variety and an amount.'); return; } added.add(pick.value); amounts[r.key] = n; draw(); };
      UI.add(clear(sum),
        h('div.od-add', pick, qtyBox, h('button.btn.small', { type: 'button', id: 'odAddBtn', onclick: addLine }, 'Add')),
        h('b.au-sumhead', { id: 'odTotal' }, sheet.lines ? `${SL.money(sheet.cost)} for ${sheet.lines - sheet.unpriced} of ${sheet.lines} line${sheet.lines === 1 ? '' : 's'}, from ${sheet.groups.length} supplier${sheet.groups.length === 1 ? '' : 's'}` : 'Nothing to order'),
        sheet.unpriced ? h('p.au-line', { id: 'odUnpriced' }, `${sheet.unpriced} line${sheet.unpriced === 1 ? ' has' : 's have'} no price on file, so ${sheet.unpriced === 1 ? 'it is' : 'they are'} not in that total.`) : null,
        h('p.au-fine', { id: 'odNotes' }, `As of ${today()}: what the plan still has to sow, less seed on hand and on order. ${notes.join(' ')}`));
    };
    const el = h('dialog.dialog.bk.wide.order', { id: 'orderDlg', oncancel: e => { e.preventDefault(); close(); } },
      h('button.icon-btn.close', { type: 'button', id: 'odClose', 'aria-label': 'Close', title: 'Close. Nothing is changed.', onclick: () => close() }, '×'),
      h('h2', 'Seed to order'),
      h('p.dlg-lead', 'What is short today, by supplier, in each supplier’s own sizes at the least cost. Change an amount to buy more or less; mark a supplier’s lines as ordered once the order is placed, and they stop counting as short.'),
      host, sum,
      h('div.dialog-actions',
        framed ? null : h('button.btn', { type: 'button', id: 'odCsv', onclick: () => saveText(`seed-order-${App.planYear()}-${E.d2s(new Date())}.csv`, '\ufeff' + SL.orderCsv(build().sheet), 'text/csv') }, 'Download (.csv)'),
        framed ? null : h('button.btn', { type: 'button', id: 'odPrint', onclick: () => printText(text()) }, 'Print'),
        h('span.grow'),
        h('button.btn', { type: 'button', id: 'odDone', onclick: () => close() }, 'Close'),
        h('button.btn.primary', { type: 'button', id: 'odCopy', onclick: async () => { const t = text(); try { await navigator.clipboard.writeText(t); UI.toast('Copied. Paste it into an order or an email.'); } catch (_) { UI.toast('Copying is not available here. Use Print or Download.'); } } }, 'Copy')));
    order = { el, draw, close, text, sheet: () => build().sheet, amounts };
    document.body.append(el); el.showModal(); draw();
  }
  function saveText(filename, text, type) {
    const blob = new Blob([text], { type }), fallback = () => { const url = URL.createObjectURL(blob), a = h('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); };
    const downloads = root.claude && root.claude.use ? root.claude.use('downloads') : null;
    if (downloads) Promise.resolve(downloads).then(dl => dl.save({ filename, data: blob })).catch(error => { if (!error || error.code !== 'declined') fallback(); }); else fallback();
  }
  function printText(text) {
    let sheet = $('printSheet');
    if (!sheet) { sheet = h('div', { id: 'printSheet' }); document.body.append(sheet); }
    sheet.textContent = text;
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); root.removeEventListener('afterprint', done); };
    root.addEventListener('afterprint', done);
    try { root.print(); } catch (_) { UI.toast('Printing is not available in this view. Copy the sheet instead.'); }
    setTimeout(done, 1500);
  }

  // ───────────────────────── a seed lot in one line ─────────────────────────
  // Vendor, variety, year, amount: Enter saves. The variety is found as it is typed; one that is not in the library yet asks
  // for its crop and is added with the lot, in the same step. The line is built once and reads the plan as it is used.
  const quick = { varietyId: '', hits: [], at: 0, open: false, status: 'usable' };
  function initQuick() {
    const host = $('sdQuick');
    if (!host) return;
    const eng = () => App.state.engine, live = () => App.state.plan.varieties.filter(v => v.active !== false && !v.deleted);
    const vendor = h('input', { id: 'qlVendor', type: 'text', placeholder: 'Vendor', autocomplete: 'off', spellcheck: false, 'aria-label': 'Vendor', list: 'qlVendors' }), vendors = h('datalist', { id: 'qlVendors' });
    const name = h('input', { id: 'qlVariety', type: 'text', placeholder: 'Variety', autocomplete: 'off', spellcheck: false, role: 'combobox', 'aria-label': 'Variety', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': 'qlList' });
    const tag = h('span.ql-tag'), listbox = h('ul.ql-list', { id: 'qlList', role: 'listbox', hidden: true });
    const cropPick = h('select', { id: 'qlCrop', hidden: true, 'aria-label': 'Crop of the new variety' });
    const year = h('input', { id: 'qlYear', type: 'number', min: 1900, max: 2200, step: 1, placeholder: 'Year', title: 'The year the seed was packed for, or bought', 'aria-label': 'Year', value: new Date().getFullYear() });
    const amount = h('input', { id: 'qlAmount', type: 'number', min: 0, step: 1, placeholder: 'Seeds', 'aria-label': 'Amount' }), unitWord = h('span.ql-unit', 'seeds');
    const where = h('div.seg.ql-where', { role: 'group', 'aria-label': 'Where the seed is' }, [['usable', 'On hand'], ['ordered', 'Ordered']].map(([id, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(quick.status === id), dataset: { where: id }, onclick: () => { quick.status = id; for (const b of where.children) b.setAttribute('aria-pressed', String(b.dataset.where === id)); } }, label)));
    const say = h('p.ql-say', { id: 'qlSay', role: 'status', 'aria-live': 'polite' });
    const form = h('form.sd-quick-form', { novalidate: true, autocomplete: 'off', onsubmit: e => { e.preventDefault(); save(); } },
      h('span.ql-label', 'Add a seed lot'), vendor, vendors,
      h('div.ql-combo', name, tag, listbox), cropPick, year, h('label.ql-amount', amount, unitWord), where,
      h('button.btn', { type: 'submit', id: 'qlAdd' }, 'Add'));
    add(host, form, say);

    const picked = () => (quick.varietyId ? eng().variety(quick.varietyId) : null);
    const stockUnitOf = v => { const crop = eng().crop(v.cropId), stock = App.stockNow(); return SL.STOCK_UNITS.find(u => stock['v:' + v.id + '|' + u]) || unitFor(crop); };
    const typedMatch = () => { const key = SL.norm(name.value); return key ? live().filter(v => SL.norm(v.name) === key) : []; };
    function unit() { const v = picked(); return v ? stockUnitOf(v) : unitFor(cropPick.value ? eng().crop(cropPick.value) : null); }
    function sync() {
      const v = picked(), u = unit(), fresh = !v && !!name.value.trim() && !typedMatch().length && !quick.open;
      tag.textContent = v ? cropName(eng().crop(v.cropId)) : '';
      form.classList.toggle('has-pick', !!v);
      cropPick.hidden = !fresh;
      if (fresh && !cropPick.options.length) add(cropPick, h('option', { value: '' }, 'Crop of this new variety…'), sortedCrops().map(c => h('option', { value: c.id }, c.name)));
      unitWord.textContent = u === 'g' ? 'grams' : u; amount.placeholder = u === 'g' ? 'Grams' : u === 'plants' ? 'Plants' : 'Seeds'; amount.step = u === 'g' ? 'any' : 1;
    }
    /** Varieties that fit what is typed: every word found in the name, crop or supplier; names that start with it first, the typed vendor's own first among equals. */
    function find(text) {
      const words = SL.norm(text).split(' ').filter(Boolean), want = SL.supplierKey(vendor.value), q = SL.norm(text);
      if (!words.length) return [];
      const out = [];
      for (const v of live()) {
        const crop = eng().crop(v.cropId), n = SL.norm(v.name), hay = `${n} ${SL.norm(cropName(crop))} ${SL.norm(v.supplier || v.source || '')} ${SL.norm(v.sku || '')}`;
        if (!words.every(w => hay.includes(w))) continue;
        const rank = (n === q ? 0 : n.startsWith(q) ? 1 : n.split(' ').some(part => part.startsWith(words[0])) ? 2 : 3) * 2 + (want && SL.supplierKey(v.supplier || v.source || '') === want ? 0 : 1);
        out.push({ v, crop, rank });
      }
      return out.sort((a, b) => a.rank - b.rank || String(a.v.name).localeCompare(String(b.v.name))).slice(0, 8);
    }
    function show() {
      const text = name.value.trim();
      quick.hits = find(text);
      const exact = quick.hits.some(x => SL.norm(x.v.name) === SL.norm(text));
      const rows = quick.hits.map((x, i) => h('li', { role: 'option', id: 'qlOpt' + i, 'aria-selected': String(i === quick.at), dataset: { at: i } },
        T.el({ varietyId: x.v.id, color: eng().cropColor(x.crop), label: x.v.name, size: 22 }), h('b', x.v.name), h('span', cropName(x.crop)), h('small', supplierShort(x.v))));
      if (text && !exact) rows.push(h('li.ql-new', { role: 'option', id: 'qlOpt' + quick.hits.length, 'aria-selected': String(quick.at === quick.hits.length), dataset: { at: quick.hits.length } }, h('b', `New variety: ${text}`), h('span', 'choose its crop next')));
      quick.open = rows.length > 0;
      if (quick.at >= rows.length) quick.at = 0;
      clear(listbox); add(listbox, rows);
      for (const li of listbox.children) li.setAttribute('aria-selected', String(+li.dataset.at === quick.at));
      listbox.hidden = !quick.open; name.setAttribute('aria-expanded', String(quick.open));
      if (quick.open) name.setAttribute('aria-activedescendant', 'qlOpt' + quick.at); else name.removeAttribute('aria-activedescendant');
    }
    function shut() { quick.open = false; listbox.hidden = true; name.setAttribute('aria-expanded', 'false'); name.removeAttribute('aria-activedescendant'); }
    function choose(i) {
      const hit = quick.hits[i];
      shut();
      if (hit) {
        quick.varietyId = hit.v.id; name.value = hit.v.name;
        if (!vendor.value.trim()) vendor.value = hit.v.supplier || (hit.v.source === 'Farm entry' ? '' : hit.v.source) || '';
        sync(); say.textContent = ''; (year.value ? amount : year).focus();
      } else { quick.varietyId = ''; sync(); cropPick.focus(); }   // a new variety: its crop is asked for next
    }
    name.addEventListener('input', () => { quick.varietyId = ''; quick.at = 0; say.textContent = ''; show(); sync(); });
    name.addEventListener('focus', () => { if (!quick.varietyId && name.value.trim()) { show(); sync(); } });
    name.addEventListener('keydown', e => {
      const n = listbox.children.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!quick.open) { show(); return; } quick.at = (quick.at + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; show(); const on = listbox.children[quick.at]; if (on) on.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter' && quick.open) { e.preventDefault(); choose(quick.at); }
      else if (e.key === 'Escape' && quick.open) { e.stopPropagation(); shut(); sync(); }
    });
    // leaving the field with a name typed in full is choosing it, when only one variety has that name
    name.addEventListener('blur', () => setTimeout(() => { if (form.contains(document.activeElement) && document.activeElement === name) return; if (!quick.varietyId) { const same = typedMatch(); if (same.length === 1) { quick.varietyId = same[0].id; name.value = same[0].name; if (!vendor.value.trim()) vendor.value = same[0].supplier || ''; } } shut(); sync(); }, 120));
    listbox.addEventListener('pointerdown', e => { const li = e.target.closest('li'); if (li) { e.preventDefault(); choose(+li.dataset.at); } });
    cropPick.addEventListener('change', () => { sync(); say.textContent = ''; if (cropPick.value) (year.value ? amount : year).focus(); });
    vendor.addEventListener('focus', () => {
      const seen = new Map();
      for (const s of [...live().map(v => v.supplier || (v.source === 'Farm entry' ? '' : v.source) || ''), ...((App.inventoryNow().lots || []).map(l => (l && l.supplier) || ''))]) { const key = SL.supplierKey(s); if (key && !/\.[a-z]{2,}$/i.test(s.trim()) && !seen.has(key)) seen.set(key, s.trim()); }
      clear(vendors); add(vendors, [...seen.values()].sort((a, b) => a.localeCompare(b)).map(v => h('option', { value: v })));
    });

    function save() {
      if (App.isSample()) { say.textContent = 'This is the sample plan. Load your own first.'; return; }
      if (quick.open && quick.hits.length && !quick.varietyId) { choose(quick.at); return; }
      if (!quick.varietyId) { const same = typedMatch(); if (same.length === 1) quick.varietyId = same[0].id; else if (same.length > 1) { say.textContent = `${same.length} varieties are called ${name.value.trim()}. Choose one from the list.`; name.focus(); show(); return; } }
      const ctx = { now: new Date().toISOString(), uid: App.uid, year: App.planYear(), name: '' }, before = App.state.plan.seedInventory || null;
      let done;
      try { done = SL.quickLot(App.state.plan, App.inventoryNow(), { varietyId: quick.varietyId, name: name.value, cropId: cropPick.value, vendor: vendor.value, year: year.value, quantity: amount.value, unit: unit(), status: quick.status }, ctx); }
      catch (error) {
        say.textContent = error.message || 'That lot could not be added.';
        const el = /crop/i.test(say.textContent) && !quick.varietyId && name.value.trim() ? cropPick : /Variety/.test(say.textContent) ? name : /year/i.test(say.textContent) ? year : amount;
        if (el === cropPick) { shut(); sync(); }
        el.focus();
        return;
      }
      const v = done.variety, u = done.unit, what = `${num(done.lot.quantity, u === 'g' ? 1 : 0)} ${u === 'g' ? 'g' : u} of ${v.name}`, state = quick.status === 'ordered' ? 'on order' : 'on hand';
      const ops = [...(done.added ? [{ kind: 'variety', before: null, after: done.added }] : []), { kind: 'inventory', before, after: done.inventory }];
      if (!App.commit(`${what} ${state}`, ops, { unchecked: true })) { say.textContent = 'That lot could not be added.'; return; }
      toast(`${what} ${state}${done.added ? `. ${v.name} was added to the library under ${cropName(eng().crop(v.cropId))}` : ''}`, { label: 'Undo', run: App.undo });
      // ready for the next packet: vendor, year and where it is stay; the list shows the variety just added to
      quick.varietyId = ''; name.value = ''; amount.value = ''; cropPick.value = ''; say.textContent = ''; shut(); sync();
      ui.query = ''; $('sdSearch').value = ''; ui.filter = 'all'; if (ui.tab === 'crops') ui.tab = 'list'; ui.closed.delete(v.cropId); ui.sel = { type: 'variety', id: v.id }; ui.panelKey = ''; schedule();
      name.focus();
    }
    sync();
  }

  function init() {
    initQuick();
    for (const b of document.querySelectorAll('[data-sd-tab]')) b.addEventListener('click', () => { ui.tab = b.dataset.sdTab; if (ui.tab === 'crops' && ui.sel && ui.sel.type === 'variety') ui.sel = null; schedule(); });
    $('sdSearch').addEventListener('input', e => { ui.query = e.target.value; schedule(); });
    // the list drops and regains columns as its room changes
    if (root.ResizeObserver) new ResizeObserver(() => { if (App.state.view === 'seeds' && ui.tab === 'list' && $('sdScroll').clientWidth && listCols().key !== ui.colsKey) schedule(); }).observe($('sdScroll'));
    $('sdAddLink').addEventListener('click', () => openImporter());
    $('sdAddHand').addEventListener('click', () => openVariety(null));
    $('sdAddCrop').addEventListener('click', () => openCrop(null));
    $('sdOrder').addEventListener('click', openOrder);
    App.on('plan', () => { ui.rev++; schedule(); if (order) order.draw(); }); App.on('view', schedule);
    document.addEventListener('keydown', e => { if (e.key === '/' && App.state.view === 'seeds' && !/^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || '') && !document.querySelector('dialog[open]')) { e.preventDefault(); $('sdSearch').focus(); } });
  }
  root.LRFSeeds = { init, render, openImporter, openVariety, openCrop, openSettings, openOrder, order: () => order, service, serviceReady, linkHow, linkFailure, planningLine, select, drawn: () => ({ ...drawn }) };
})(window);
