/* Little River Farm Planner — the seed library's rules, with no screen attached.
 *
 * What a supplier page becomes when it is saved as a variety (the same fields v7 filled, so a
 * backup made here restores there), which saved variety a page belongs to, and how many seeds
 * the plan needs of each variety.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LRFSeedLib = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const copy = x => JSON.parse(JSON.stringify(x));
  const norm = x => String(x || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  /** One key per supplier however its name is written ("Johnny's", "Johnny's Selected Seeds", "johnnyseeds.com"). */
  function supplierKey(x) {
    const key = norm(x).replace(/\b(?:selected|organic|inc|company|co|the|com)\b/g, '').replace(/\bseeds?\b/g, '').replace(/\s+/g, ' ').trim();
    const known = [['johnny', 'johnnys'], ['harris', 'harris'], ['osborne', 'osborne'], ['seedway', 'seedway'], ['territorial', 'territorial'], ['whaley', 'whaley'], ['high mowing', 'highmowing'], ['highmowing', 'highmowing'], ['paramount', 'paramount'], ['fedco', 'fedco'], ['berbee', 'berbee']];
    const hit = known.find(([part]) => key.includes(part));
    return hit ? hit[1] : key;
  }
  const varietyKey = x => norm(x).replace(/\b(?:f1|organic|non gmo|untreated|treated|raw|seeds?|tomatoes|tomato|lettuce|cucumber)\b/g, '').replace(/\s+/g, ' ').trim();
  /** A product address with tracking tags removed, or '' when it is not an https address. */
  function urlKey(value) {
    try { const u = new URL(value); if (u.protocol !== 'https:') return ''; u.hash = ''; for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|srsltid$|mc_)/i.test(k)) u.searchParams.delete(k); return u.href; } catch (_) { return ''; }
  }
  const hostOf = value => { try { return new URL(value).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };

  /** Which crop a product page is most likely for, or ''. The grower confirms it. */
  function inferCrop(data, crops) {
    let path = '';
    try { path = decodeURIComponent(new URL(data.url).pathname); } catch (_) { /* no address */ }
    const name = norm(data.name), latin = norm(data.facts && data.facts.latin), evidence = norm([data.name, data.description, path].join(' '));
    const specific = [['tomato_cherry', /\b(?:cherry|grape) tomato(?:es)?\b|\btomato(?:es)? (?:cherry|grape)\b/], ['little_gem', /\blittle gem\b/], ['salanova', /\bsalanova\b/], ['cucumber_pickling', /\bpickling cucumber(?:s)?\b/], ['eggplant_asian', /\b(?:asian|japanese) eggplant(?:s)?\b/]];
    for (const [id, re] of specific) if (re.test(evidence) && crops.some(c => c.id === id)) return id;
    const ranked = crops.map(c => { const words = norm(c.name).split(' ').filter(w => !['seeds', 'seed', 'crop', 'microgreens', 'head'].includes(w)); return { c, score: words.length && words.every(w => name.includes(w)) ? words.join(' ').length : 0 }; }).filter(x => x.score).sort((a, b) => b.score - a.score);
    if (ranked.length && (!ranked[1] || ranked[0].score > ranked[1].score)) return ranked[0].c.id;
    const botanical = [['tomato', 'solanum lycopersicum'], ['lettuce_head', 'lactuca sativa'], ['eggplant', 'solanum melongena'], ['cucumber', 'cucumis sativus'], ['pepper', 'capsicum annuum']];
    const hit = botanical.find(([id, l]) => latin === l && crops.some(c => c.id === id));
    return hit ? hit[0] : '';
  }
  /** Saved varieties of this crop that a product page belongs to: same address, same supplier and code, or same name. */
  function matches(plan, data, cropId) {
    const key = urlKey(data.url), vendor = supplierKey(data.supplier), name = varietyKey(data.name);
    const codes = new Set([data.sku, ...(data.productCodes || []).map(x => x.value)].filter(Boolean).map(x => String(x).toLowerCase()));
    return (plan.varieties || []).filter(v => {
      if (v.active === false || v.deleted === true || v.cropId !== cropId) return false;
      const saved = supplierKey(v.supplier || v.source), manual = !saved || saved === 'farm entry';
      return (key && urlKey(v.url) === key) || (vendor && saved === vendor && v.sku && codes.has(String(v.sku).toLowerCase())) || (name && varietyKey(v.name) === name && (manual || (vendor && saved === vendor)));
    });
  }
  /** The same product saved under a different crop: v7 refuses that, and so does this. */
  const elsewhere = (plan, data, cropId) => (plan.varieties || []).find(v => v.active !== false && v.deleted !== true && v.cropId !== cropId && urlKey(data.url) && urlKey(v.url) === urlKey(data.url)) || null;

  function number(raw, min, max, what, whole) {
    if (raw == null || String(raw).trim() === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max || (whole && !Number.isInteger(n))) throw new Error(`${what}: enter ${whole ? 'a whole number' : 'a number'} from ${min} to ${max.toLocaleString('en-US')}, or leave it empty.`);
    return n;
  }
  const BASES = ['seed', 'transplant', 'unspecified'], STAGES = ['unspecified', 'mature', 'baby', 'flower'];
  /**
   * The variety fields a reviewed supplier page fills. `data` is what the reader returned; `input` is the review form.
   * Returns { patch, cleared }: values to set, and names to remove when the form leaves them empty.
   */
  function fields(data, input, options = {}) {
    const name = String(input.name || '').trim(), cropId = String(input.cropId || ''), url = urlKey((data && data.url) || input.url || '');
    if (!name || name.length > 200) throw new Error('Give the variety a name of up to 200 characters.');
    if (!cropId) throw new Error('Choose the crop this variety belongs to.');
    if (data && !url && !options.pasteWithoutLink) throw new Error('The product address is not a complete https address.');
    const min = number(input.dtmMin, 1, 3650, 'Earliest days to maturity', true), max = number(input.dtmMax, 1, 3650, 'Latest days to maturity', true);
    if ((max != null && min == null) || (min != null && max != null && max < min)) throw new Error('Days to maturity: give the earliest day first, and a latest day on or after it.');
    const basis = BASES.includes(input.basis) ? input.basis : 'unspecified', stage = STAGES.includes(input.stage) ? input.stage : 'unspecified';
    const supplier = String(input.supplier || (data && data.supplier) || '').trim(), facts = (data && data.facts) || {};
    const patch = { name, cropId, source: supplier || 'Farm entry', sku: String(input.sku || '').trim() }, cleared = [];
    if (supplier) patch.supplier = supplier; else cleared.push('supplier');
    if (url) patch.url = url; else cleared.push('url');
    if (data) Object.assign(patch, { description: data.description || '', latin: facts.latin || '', depth: facts.depth || '', notes: data.description || '' });
    else if (input.notes !== undefined) patch.notes = String(input.notes || '').trim();
    if (min != null || data || options.hadSupplierDays) {
      Object.assign(patch, {
        catalogDtm: min, catalogDtmMax: min == null ? null : (max == null ? min : max), catalogMaturityBasis: basis,
        catalogDtmText: min == null ? '' : min === (max == null ? min : max) ? `${min} days` : `${min}–${max} days`, catalogHarvestStage: stage,
        catalogSupplier: patch.source, catalogTitle: (url ? 'Product page · ' : 'Entered by hand · ') + patch.source, catalogPage: null, catalogYear: null, catalogPdfPage: null, maturitySource: url || ''
      });
      if (min != null || data) patch.catalogSourceChoice = 'url';
    }
    const nurseryDays = number(input.nurseryDays, 0, 728, 'Days in nursery');
    const numeric = [['inRow', input.inRow, 0.01, 2400, 'In-row spacing'], ['rowSp', input.rowSp, 0.01, 2400, 'Row spacing'], ['gh', nurseryDays == null ? undefined : nurseryDays / 7, 0, 104, 'Days in nursery'], ['germ', input.germ, 0.1, 100, 'Germination'],
      ['seedsPerPacket', input.seedsPerPacket, 1, 1e9, 'Seeds per packet'], ['seedsPerOz', input.seedsPerOz, 1, 1e9, 'Seeds per ounce'], ['seedsPerLb', input.seedsPerLb !== undefined ? input.seedsPerLb : facts.seedsPerLb, 1, 1e10, 'Seeds per pound'], ['seedsPerG', input.seedsPerG !== undefined ? input.seedsPerG : facts.seedsPerG, 1, 1e9, 'Seeds per gram'], ['dtm', input.dtm, 1, 3650, 'Your own days to harvest']];
    for (const [key, raw, lo, hi, what] of numeric) {
      const n = number(raw, lo, hi, what, key === 'dtm');
      if (n != null) patch[key] = n; else if (options.edit && raw !== undefined) cleared.push(key);
    }
    if (input.rowsPerBed != null && String(input.rowsPerBed).trim()) patch.rowsPerBed = number(input.rowsPerBed, 1, 1000, 'Rows per bed', true); else if (options.edit && input.rowsPerBed !== undefined) cleared.push('rowsPerBed');
    if (data && data.prices && data.prices.length) { patch.prices = copy(data.prices); patch.supplierPacks = copy(data.prices); }
    for (const key of ['sku', 'description', 'latin', 'depth', 'notes']) if (key in patch && !patch[key]) { delete patch[key]; if (options.edit || !data) cleared.push(key); }
    return { patch, cleared, nurseryDays };
  }
  /** Apply a reviewed patch to a variety record (new, or a copy of the saved one). */
  function apply(variety, result) {
    const v = { ...variety, ...result.patch };
    for (const key of result.cleared) delete v[key];
    delete v.stub;
    if (v.active === false) { v.active = true; delete v.deleted; }
    if (result.nurseryDays != null) { const config = variety.environmentDefaults || {}; v.environmentDefaults = { ...config, v: 1, field: { ...(config.field || {}), gh: result.patch.gh }, greenhouse: { ...(config.greenhouse || {}), gh: result.patch.gh } }; }
    return v;
  }
  /** The bulky record kept beside the plan: what the page said and what was confirmed, as v7 keeps it. */
  function record(data, input, previous, now) {
    const stamp = (now || new Date()).toISOString();
    const webImport = { v: 1, url: data.url, retrievedAt: data.retrievedAt, extraction: data.extraction, productCodes: copy(data.productCodes || []), facts: copy(data.facts || {}), evidence: copy(data.evidence || {}),
      specifications: copy(data.specifications || []), sourceText: data.sourceText || '', textTruncated: data.textTruncated === true, prices: copy(data.prices || []), imageCandidates: copy(data.images || []), warnings: copy(data.warnings || []),
      reviewed: true, reviewedAt: stamp, reviewedFields: copy(input), sourceChoice: 'url' };
    const out = { webImport, catalogSourceText: data.sourceText || '' };
    const history = [...((previous && previous.webImportHistory) || []), ...(previous && previous.webImport ? [copy(previous.webImport)] : [])];
    if (history.length) out.webImportHistory = history;
    return out;
  }
  /** What the planner derives from page text that is set aside (see planio.split). */
  const derived = (Engine, text, dtmText) => ({ _basisFromText: Engine.basisFromText(text || dtmText || ''), _pageTextBasis: Engine.basisFromText(text || ''), _catalogTextBasis: Engine.basisFromText(text || '') });
  /** A new crop with v7's starting values. The grower sets its real numbers on the crop and on the assumptions list. */
  function newCrop(details, id) {
    const name = String(details.name || '').trim(), family = String(details.family || '').trim(), method = String(details.method || ''), material = String(details.material || 'seed');
    if (!name || name.length > 160) throw new Error('Name the new crop, using up to 160 characters.');
    if (!['DS', 'TP'].includes(method)) throw new Error('Say whether the new crop is direct sown or transplanted.');
    if (!['seed', 'piece', 'bulb', 'clove', 'plant'].includes(material)) throw new Error('Choose what the new crop is planted from.');
    return { id, name, family, method, plantingMaterial: material, perennial: details.perennial === true, inRow: 12, rowSp: 12, seedsFt: 0, gh: method === 'TP' ? 4 : 0, tray: 72, spc: 1, dtm: 60, hw: 21, n: 2.5, p: 2, k: 2.5,
      yBasis: 'plant', yield: 1, baseUnit: 'each', mk: 0.9, price: 2, seed1000: 10, tower: false, frostTender: false, rockwoolDays: 0, towerDays: 0 };
  }

  // ───────────────────────────── seeds required ─────────────────────────────
  const UNIT_WORD = { seeds: 'seeds', g: 'g of seed', plants: 'plants', bulbs: 'bulbs', cloves: 'cloves', pieces: 'seed pieces' };
  /**
   * What the plan needs, one row per variety (or per crop where no variety is chosen) and unit.
   * Counts are the engine's own: germination and the tray margin are already in them.
   * A planting marked sown, planted or harvested no longer needs seed; one marked established never did.
   */
  function required(engine) {
    const plan = engine.plan, year = String(plan.settings && plan.settings.year), rows = new Map();
    for (const p of plan.plantings || []) {
      if (String(p.date).slice(0, 4) !== year) continue;
      const r = engine.calc(p);
      if (!r || r.b.active === false) continue;
      const c = r.c, saved = engine.variety(p.varietyId), v = saved && saved.cropId === p.cropId ? saved : null;
      const material = r.rack ? 'seed' : c.plantingMaterial || (c.material === 'bulb' ? 'bulb' : 'seed');
      const unit = r.rack ? 'g' : material === 'seed' ? 'seeds' : material + 's';
      const key = (v ? 'v:' + v.id : 'c:' + p.cropId) + '|' + unit;
      let row = rows.get(key);
      if (!row) rows.set(key, row = { key, crop: engine.crop(p.cropId), variety: v, unit, plantings: 0, waiting: 0, total: 0, toSow: 0, trays: 0, first: null, established: 0 });
      row.plantings++;
      if (p.established === true) { row.established++; continue; }
      const amount = unit === 'g' ? r.seedG : unit === 'seeds' ? r.seeds : (r.bulbs || Math.ceil(r.plants));
      row.total += amount || 0;
      const done = p.done || {}, sown = ['sow', 'field', 'harvest', 'flip'].some(k => typeof done[k] === 'string' && done[k]);
      if (sown) continue;
      row.waiting++; row.toSow += amount || 0; row.trays += r.trays || 0;
      const start = r.sow || r.field;
      if (start && (!row.first || start < row.first)) row.first = start;
    }
    const list = [...rows.values()].sort((a, b) => String(a.crop && a.crop.name).localeCompare(String(b.crop && b.crop.name)) || String((a.variety && a.variety.name) || '').localeCompare(String((b.variety && b.variety.name) || '')));
    return { rows: list, settings: { germ: +(plan.settings && plan.settings.germ) || 85, buffer: +(plan.settings && plan.settings.buffer) || 0 } };
  }
  /** A seed count as a weight and as packets, where the variety's page gave the figures. */
  function measures(seeds, v) {
    const out = { weight: '', packets: '' };
    if (!v || !(seeds > 0)) return out;
    const fix = (n, unit) => `${n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 10 ? n.toFixed(1) : n.toFixed(2)} ${unit}`;
    const oz = v.seedsPerOz > 0 ? seeds / v.seedsPerOz : v.seedsPerLb > 0 ? seeds / v.seedsPerLb * 16 : null;
    if (oz != null) out.weight = oz >= 16 ? fix(oz / 16, 'lb') : oz >= 0.05 ? fix(oz, 'oz') : fix(oz * 28.3495, 'g');
    else if (v.seedsPerG > 0) { const g = seeds / v.seedsPerG; out.weight = g >= 28.3495 ? fix(g / 28.3495, 'oz') : fix(g, 'g'); }
    if (v.seedsPerPacket > 0) { const n = Math.ceil(seeds / v.seedsPerPacket); out.packets = `${n.toLocaleString('en-US')} × ${v.seedsPerPacket.toLocaleString('en-US')}`; }
    return out;
  }

  return { norm, supplierKey, varietyKey, urlKey, hostOf, inferCrop, matches, elsewhere, fields, apply, record, derived, newCrop, required, measures, UNIT_WORD, BASES, STAGES };
});
