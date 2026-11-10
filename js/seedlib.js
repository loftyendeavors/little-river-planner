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
  /**
   * Seed on hand and on order from v7's lot records, by the same rule v7 uses: a lot counts when it has a whole,
   * non-negative quantity, a yes-or-no "usable", and an identifier no other lot shares. "ordered" lots are on order;
   * usable lots are on hand; anything else is left out. Keys match required(): "v:<variety>|seeds".
   */
  function stock(inventory) {
    const out = {}, lots = inventory && Array.isArray(inventory.lots) ? inventory.lots.filter(l => l && typeof l === 'object') : [], seen = new Map();
    for (const lot of lots) seen.set(lot.id, (seen.get(lot.id) || 0) + 1);
    for (const lot of lots) {
      if (lot.deleted === true || !lot.key || !lot.id || seen.get(lot.id) !== 1 || typeof lot.usable !== 'boolean' || lot.quantity == null || lot.quantity === '') continue;
      const q = Number(lot.quantity);
      if (!Number.isFinite(q) || q < 0 || (['seeds', 'plants'].includes(lot.unit) && !Number.isSafeInteger(q)) || !['seeds', 'g', 'plants'].includes(lot.unit)) continue;
      const life = typeof lot.status === 'string' ? lot.status : lot.usable === true ? 'usable' : 'excluded';
      const row = out[lot.key + '|' + lot.unit] || (out[lot.key + '|' + lot.unit] = { onHand: 0, onOrder: 0, lots: 0 });
      if (life === 'ordered') { row.onOrder += q; row.lots++; } else if (life === 'usable' && lot.usable === true) { row.onHand += q; row.lots++; }
    }
    return out;
  }
  // ───────────────────────────── editing stock ─────────────────────────────
  // Lots and their change log are written exactly as v7 writes them (seed-inventory.js: normalizeLot, addLot,
  // updateLot, deleteLot; seed-buying-model.js: receive), so a backup made here restores there.
  // Every function takes an inventory and returns a changed copy. ctx: { now: ISO time, uid(), year, name }.
  const STOCK_UNITS = ['seeds', 'g', 'plants'];
  const emptyInventory = () => ({ v: 1, lots: [], adjustments: [], legacyImported: {}, performanceNotes: {}, importReceipts: [] });
  /** v7 keeps bulbs, cloves and seed pieces under "seeds"; only plants and grams have their own unit. */
  const stockUnit = unit => (unit === 'g' || unit === 'plants' ? unit : 'seeds');
  const lifeOf = lot => (typeof lot.status === 'string' ? lot.status : lot.usable === true ? 'usable' : 'excluded');
  function readable(inventory) {
    const lib = inventory && typeof inventory === 'object' ? copy(inventory) : emptyInventory();
    for (const key of ['lots', 'adjustments']) if (!Array.isArray(lib[key])) throw new Error('The saved seed stock cannot be read. It is kept as it is; nothing was changed.');
    for (const key of ['legacyImported', 'performanceNotes']) if (!lib[key] || typeof lib[key] !== 'object' || Array.isArray(lib[key])) lib[key] = {};
    return lib;
  }
  /** The live lots for one variety or crop key ("v:<id>" or "c:<id>"), each with how it counts. */
  function lotsFor(inventory, key) {
    const lots = inventory && Array.isArray(inventory.lots) ? inventory.lots : [];
    return lots.filter(l => l && typeof l === 'object' && l.deleted !== true && l.key === key).map(l => ({ ...l, life: lifeOf(l) }));
  }
  function amountOf(raw, unit, what) {
    if (raw == null || String(raw).trim() === '') throw new Error(`${what}: enter a number. Use 0 for an empty packet.`);
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER || (unit !== 'g' && !Number.isInteger(n))) throw new Error(`${what}: enter ${unit === 'g' ? 'a number' : 'a whole number'} of ${unit === 'g' ? 'grams' : unit}, 0 or more.`);
    return n;
  }
  function yearOf(raw) {
    if (raw == null || String(raw).trim() === '') return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1900 || n > 2200) throw new Error('Packed-for year: enter a year such as 2026, or leave it empty.');
    return n;
  }
  const logged = (lib, kind, before, after, reason, ctx) => { lib.adjustments.push({ id: 'seed_adjustment_' + ctx.uid(), lotId: after.id, at: after.updatedAt, kind, reason: reason || '', before: before ? copy(before) : null, after: copy(after) }); };
  function findLot(lib, id) {
    const found = lib.lots.filter(l => l && l.id === id && l.deleted !== true);
    if (found.length !== 1) throw new Error('That lot is no longer there.');
    return found[0];
  }
  /** A new lot. input: { key, unit, quantity, status: 'usable' | 'ordered' | 'excluded', year?, supplier?, note? } */
  function addLot(inventory, input, ctx) {
    const lib = readable(inventory), unit = STOCK_UNITS.includes(input.unit) ? input.unit : 'seeds', status = ['usable', 'ordered', 'excluded'].includes(input.status) ? input.status : 'usable';
    if (!/^[vc]:.+/.test(String(input.key || ''))) throw new Error('Choose the variety this seed belongs to.');
    const lot = { quantity: amountOf(input.quantity, unit, 'Quantity'), year: yearOf(input.year === undefined ? ctx.year : input.year), supplier: String(input.supplier || '').trim(), lotNumber: String(input.lotNumber || '').trim(), usable: status === 'usable',
      storageNote: '', note: String(input.note || '').trim(), key: input.key, unit, status, id: 'seed_lot_' + ctx.uid(), createdAt: ctx.now, updatedAt: ctx.now, name: ctx.name || '' };
    if (status !== 'ordered') lot.reviewedForYear = ctx.year;
    lib.lots.push(lot); logged(lib, 'add', null, lot, '', ctx);
    return lib;
  }
  /** Change a lot. patch may hold quantity, status, year, lotNumber, note, supplier. `kind` is v7's word for the change. */
  function updateLot(inventory, id, patch, kind, ctx, reason) {
    const lib = readable(inventory), before = findLot(lib, id), after = { ...before };
    if ('quantity' in patch) after.quantity = amountOf(patch.quantity, before.unit, 'Quantity');
    if ('year' in patch) after.year = yearOf(patch.year);
    for (const key of ['lotNumber', 'note', 'supplier']) if (key in patch) after[key] = String(patch[key] || '').trim();
    if ('status' in patch) {
      if (!['usable', 'ordered', 'excluded'].includes(patch.status)) throw new Error('Choose on hand, ordered or set aside.');
      after.status = patch.status; after.usable = patch.status === 'usable';
      if (patch.status !== 'ordered') after.reviewedForYear = ctx.year;
    }
    for (const key of ['receivedDate', 'reviewedForYear']) if (key in patch) after[key] = patch[key];
    if (JSON.stringify(after) === JSON.stringify(before)) return null;
    after.updatedAt = ctx.now; lib.lots[lib.lots.indexOf(before)] = after; logged(lib, kind || 'details', before, after, reason || '', ctx);
    return lib;
  }
  /** An ordered lot arrives: it becomes seed on hand, as v7's Received does. */
  function receiveLot(inventory, id, ctx, details = {}) {
    const lot = findLot(readable(inventory), id);
    if (lifeOf(lot) !== 'ordered') throw new Error('That lot is not on order.');
    return updateLot(inventory, id, { status: 'usable', year: details.year === undefined ? lot.year || ctx.year : details.year, lotNumber: details.lotNumber === undefined ? lot.lotNumber : details.lotNumber, receivedDate: String(ctx.now).slice(0, 10), reviewedForYear: ctx.year }, 'received', ctx);
  }
  function deleteLot(inventory, id, ctx) {
    const lib = readable(inventory), before = findLot(lib, id), after = { ...before, deleted: true, deletedAt: ctx.now, usable: false, updatedAt: ctx.now };
    lib.lots[lib.lots.indexOf(before)] = after; logged(lib, 'delete', before, after, 'Deleted from available stock; previous count and import receipt retained.', ctx);
    return lib;
  }
  /** A lot filed under the wrong variety or the wrong unit is refiled. v7 logs that as a details change. to: { key?, unit?, name?, reason? } */
  function moveLot(inventory, id, to, ctx) {
    const lib = readable(inventory), before = findLot(lib, id), after = { ...before };
    if (to.key !== undefined) { if (!/^[vc]:.+/.test(String(to.key || ''))) throw new Error('Choose the variety this seed belongs to.'); after.key = to.key; }
    if (to.unit !== undefined) {
      if (!STOCK_UNITS.includes(to.unit)) throw new Error('Choose seeds, grams or plants.');
      after.unit = to.unit;
      if (after.quantity != null && after.quantity !== '') after.quantity = amountOf(after.quantity, to.unit, 'Quantity');
    }
    if (to.name) after.name = to.name;
    if (JSON.stringify(after) === JSON.stringify(before)) return null;
    after.updatedAt = ctx.now; lib.lots[lib.lots.indexOf(before)] = after; logged(lib, 'details', before, after, to.reason || '', ctx);
    return lib;
  }
  /**
   * Lots that no row of the list counts: the variety was removed from the library, or the lot is recorded in a unit
   * the list does not use for that variety. Hidden stock makes seed already bought look like seed still to buy.
   * units: Map of 'v:<id>' → the unit that variety's row counts in.
   */
  function unlisted(inventory, plan, units) {
    const all = (plan && plan.varieties) || [], byId = new Map(all.map(v => [v.id, v])), isLive = v => !!v && v.active !== false && !v.deleted, out = [];
    for (const lot of inventory && Array.isArray(inventory.lots) ? inventory.lots : []) {
      if (!lot || typeof lot !== 'object' || lot.deleted === true || !/^v:/.test(String(lot.key || '')) || !STOCK_UNITS.includes(lot.unit)) continue;
      const life = lifeOf(lot);
      if ((life !== 'ordered' && !(life === 'usable' && lot.usable === true)) || !(Number(lot.quantity) > 0)) continue;
      const v = byId.get(lot.key.slice(2)), unit = units.get(lot.key);
      if (isLive(v)) { if (unit && unit !== lot.unit) out.push({ lot, life, why: 'unit', variety: v, unit }); continue; }
      const same = v ? all.filter(x => isLive(x) && varietyKey(x.name) === varietyKey(v.name)) : [];
      out.push({ lot, life, why: 'removed', variety: v || null, twin: same.find(x => x.cropId === v.cropId) || (same.length === 1 ? same[0] : null) });
    }
    return out;
  }
  /**
   * Set what is on hand for a variety in one step, from the list. With no lot on hand it makes one; with one it
   * recounts it; with several it cannot know which was meant, and says so.
   */
  function setOnHand(inventory, key, unit, quantity, ctx) {
    const held = lotsFor(inventory, key).filter(l => l.unit === unit && l.life === 'usable' && l.usable === true);
    if (held.length > 1) throw new Error('This variety has several lots on hand. Count each one in the panel beside the list.');
    if (!held.length) return addLot(inventory, { key, unit, quantity, status: 'usable' }, ctx);
    return updateLot(inventory, held[0].id, { quantity, reviewedForYear: ctx.year }, 'count', ctx);
  }

  // ───────────────────────────── the sizes a vendor sells ─────────────────────────────
  // A packet is whatever its vendor says it is: 15 tomato seeds from one, 500 arugula seeds from another, and most seed
  // is not bought by the packet at all. Each variety carries the size list read from its vendor's page (supplierPacks,
  // as v7 keeps it). What covers a shortfall is worked out from that list and from nothing else.
  const OZ_G = 28.349523125, LB_G = 453.59237;
  const grouped = n => Number(n).toLocaleString('en-US');
  const money = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const perGram = v => (!v ? null : v.seedsPerG > 0 ? +v.seedsPerG : v.seedsPerOz > 0 ? v.seedsPerOz / OZ_G : v.seedsPerLb > 0 ? v.seedsPerLb / LB_G : null);
  const plainNumber = text => { const s = String(text).replace(/,/g, '').trim(), f = s.match(/^(\d+)\s*\/\s*(\d+)$/); return f ? (+f[2] ? +f[1] / +f[2] : NaN) : Number(s); };
  const WEIGHT = /^(\d+\s*\/\s*\d+|\d[\d,]*(?:\.\d+)?)\s*(ounces?|oz|pounds?|lbs?|kg|grams?|g)\b/i;
  const isPacket = label => /^(packet|pkt)$/i.test(String(label || '').trim());
  /** What a size label says: { seeds } for a count, { grams } for a weight, {} when it names no size (a product code, "Listed offer"). */
  function sizeOf(label) {
    const text = String(label || '').trim();
    let m = text.match(/(?:^|[\s/·])(\d[\d,]*)\s*\+?\s*seeds?\b(?!\s*(?:\/|per\b))/i);   // "250 Seeds", "10+ Seeds", "100 seeds · treated"
    if (m) return { seeds: plainNumber(m[1]) };
    m = text.match(/^(\d[\d,]*(?:\.\d+)?)\s*M$/);                                           // the trade's thousand: "5 M"
    if (m) return { seeds: Math.round(plainNumber(m[1]) * 1000) };
    m = text.match(/-(\d+)(K?)SDS?$/i);                                                     // a coded size: "…-50SD", "…-1KSD"
    if (m) return { seeds: +m[1] * (m[2] ? 1000 : 1) };
    m = text.match(WEIGHT);                                                                 // "1/4 Pound", "1 Oz", "28g($)"
    if (m) { const n = plainNumber(m[1]), u = m[2].toLowerCase(), g = /^o/.test(u) ? n * OZ_G : /^[pl]/.test(u) ? n * LB_G : u === 'kg' ? n * 1000 : n; return Number.isFinite(g) && g > 0 ? { grams: g } : {}; }
    return {};
  }
  function sizeText(pack) {
    if (pack.stated === 'weight') {
      const m = pack.label.match(WEIGHT), u = m ? m[2].toLowerCase() : 'g';
      return m ? `${m[1].replace(/\s+/g, '')} ${/^o/.test(u) ? 'oz' : /^[pl]/.test(u) ? 'lb' : u === 'kg' ? 'kg' : 'g'}` : `${grouped(Math.round(pack.grams * 10) / 10)} g`;
    }
    return isPacket(pack.label) ? `packet of ${grouped(pack.seeds)}` : `${grouped(pack.seeds)} seeds`;
  }
  /** The longest run of sizes, smallest first, in which every larger size costs more: the ones outside it were misread. */
  function consistent(list, dim) {
    const rows = list.filter(p => p.price != null && p[dim] > 0).sort((a, b) => a[dim] - b[dim] || a.price - b.price), n = rows.length, len = new Array(n).fill(1), prev = new Array(n).fill(-1);
    let end = -1;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i; j++) if ((rows[j][dim] === rows[i][dim] || rows[j].price < rows[i].price) && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
      if (end < 0 || len[i] > len[end]) end = i;
    }
    const keep = new Set();
    for (let i = end; i >= 0; i = prev[i]) keep.add(rows[i]);
    return rows.filter(p => !keep.has(p));
  }
  /**
   * The sizes a vendor sells one variety in: { list, notes, unsized, own }.
   * list: [{ label, text, price, seeds, grams, worked, stated }] smallest first. `seeds` and `grams` are what the vendor
   * states, or are worked out from one another with the page's own seeds per ounce, pound or gram (worked: 'seeds' or
   * 'grams'), so a quarter pound can be weighed against a count of seeds. Entries that name no size are left out.
   * notes: what was set right or left out, in words. `given`: a list kept beside the plan for a variety with none of its own.
   */
  function packs(v, given) {
    const own = v && [v.supplierPacks, v.prices].find(l => Array.isArray(l) && l.length), raw = own || (Array.isArray(given) ? given : []);
    const rate = perGram(v), notes = [], seen = new Set(), unsized = [];
    let list = [];
    for (const p of raw) {
      if (!p || typeof p !== 'object') continue;
      const currency = String(p.currency || '').toUpperCase();
      if (currency && currency !== 'USD' && currency !== '$') continue;
      const label = String(p.label || '').trim(), said = sizeOf(label), price = p.price == null || p.price === '' || !(Number(p.price) > 0) ? null : Number(p.price);
      let seeds = Number.isSafeInteger(p.seeds) && p.seeds > 0 ? p.seeds : said.seeds > 0 ? said.seeds : null, grams = Number(p.grams) > 0 ? Number(p.grams) : said.grams || null, worked = '';
      if (!seeds && !grams && isPacket(label) && v && v.seedsPerPacket > 0) seeds = Math.round(v.seedsPerPacket);
      if (!seeds && !grams) { if (isPacket(label) && price != null) unsized.push({ label, price }); continue; }
      const stated = seeds ? 'count' : 'weight';
      if (!seeds && rate) { seeds = Math.round(grams * rate); worked = 'seeds'; } else if (!grams && rate) { grams = seeds / rate; worked = 'grams'; }
      const key = `${stated === 'count' ? seeds : Math.round(grams * 100) + 'cg'}|${price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ label, price, seeds: seeds || null, grams: grams || null, worked, stated });
    }
    // A size that holds more seed for less money than a smaller one was misread. Where its count is the page's seeds per
    // pound, ounce or gram, the reader took that figure for the packet's size, and the packet is put back.
    for (const dim of ['seeds', 'grams']) {
      const pool = dim === 'seeds' ? list : list.filter(p => !p.seeds);
      for (const bad of consistent(pool, dim)) {
        list = list.filter(p => p !== bad);
        const density = dim === 'seeds' && v && [['pound', v.seedsPerLb], ['ounce', v.seedsPerOz], ['gram', v.seedsPerG]].find(([, d]) => d > 0 && Math.round(d) === bad.seeds);
        const packet = v && v.seedsPerPacket > 0 ? Math.round(v.seedsPerPacket) : 0;
        if (density && packet && !list.some(p => p.seeds === packet) && list.every(p => p.price == null || !p.seeds || (p.seeds < packet ? p.price < bad.price : p.price > bad.price))) {
          list.push({ label: 'Packet', price: bad.price, seeds: packet, grams: rate ? packet / rate : null, worked: rate ? 'grams' : '', stated: 'count', repaired: true });
          notes.push(`“${bad.label}” at ${money(bad.price)} is the page’s seeds per ${density[0]}, read as a size. It is counted as the packet of ${grouped(packet)}.`);
        } else notes.push(`“${bad.label}” at ${money(bad.price)} is left out: it would hold more seed than a smaller size for less money, so the page was misread.`);
      }
    }
    for (const p of list) p.text = sizeText(p);
    list.sort((a, b) => (a.seeds || Infinity) - (b.seeds || Infinity) || (a.grams || 0) - (b.grams || 0) || (a.price || 0) - (b.price || 0));
    // a packet whose page gives no count cannot be weighed against the other sizes; it is named, not guessed at
    return { list, notes, unsized, own: !!own };
  }
  /**
   * The cheapest way to cover an amount from a vendor's sizes: least cost, and of equal costs the one with least left
   * over. This is v7's rule (chooseSeedPacks), so both planners name the same sizes. unit: 'seeds' or 'g'.
   * Returns { items: [{ n, pack }], total, cost } or null when no size can be counted in that unit. A list with no
   * prices is covered with the least left over.
   */
  function cover(amount, list, unit) {
    const dim = unit === 'g' ? 'grams' : 'seeds', scale = unit === 'g' ? 100 : 1, need = Math.ceil(amount * scale - 1e-9);
    if (!(need > 0) || !Number.isFinite(need) || need > Number.MAX_SAFE_INTEGER) return null;
    const usable = (list || []).map(p => ({ pack: p, size: Math.round(p[dim] * scale), price: p.price })).filter(x => x.size >= 1);
    const priced = usable.filter(x => x.price > 0), sizes = priced.length ? priced : usable;
    if (!sizes.length) return null;
    let best = null;
    const offer = items => {
      const total = items.reduce((n, i) => n + i.n * i.x.size, 0), cost = priced.length ? items.reduce((n, i) => n + i.n * i.x.price, 0) : 0, count = items.reduce((n, i) => n + i.n, 0);
      if (total < need) return;
      if (!best || cost < best.cost - 0.00001 || (Math.abs(cost - best.cost) < 0.00001 && (total < best.total || (!priced.length && total === best.total && count < best.count)))) best = { items, total, cost, count };
    };
    for (const x of sizes) offer([{ n: Math.ceil(need / x.size), x }]);
    if (priced.length > 1) {
      const gcd = (a, b) => (b ? gcd(b, a % b) : a), step = sizes.reduce((g, x) => gcd(g, x.size), 0), goal = Math.ceil(need / step);
      if (goal <= 250000) {
        const cost = new Float64Array(goal + 1).fill(Infinity), previous = new Int32Array(goal + 1), choice = new Int32Array(goal + 1).fill(-1), quantity = new Float64Array(goal + 1);
        cost[0] = 0;
        for (let q = 0; q < goal; q++) {
          if (!Number.isFinite(cost[q])) continue;
          for (let i = 0; i < sizes.length; i++) {
            const x = sizes[i], next = Math.min(goal, q + x.size / step), value = cost[q] + x.price, qty = quantity[q] + x.size;
            if (value < cost[next] - 0.00001 || (Math.abs(value - cost[next]) < 0.00001 && qty < quantity[next])) { cost[next] = value; previous[next] = q; choice[next] = i; quantity[next] = qty; }
          }
        }
        if (choice[goal] >= 0) { const counts = new Map(); for (let q = goal; q > 0; q = previous[q]) counts.set(choice[q], (counts.get(choice[q]) || 0) + 1); offer([...counts].map(([i, n]) => ({ n, x: sizes[i] }))); }
      } else {
        for (let i = 0; i < sizes.length; i++) for (let j = i + 1; j < sizes.length; j++) {
          const a = sizes[i], b = sizes[j], limit = Math.min(2000, Math.ceil(need / a.size));
          for (let n = 0; n <= limit; n++) { const m = Math.max(0, Math.ceil((need - n * a.size) / b.size)); offer([{ n, x: a }, { n: m, x: b }].filter(k => k.n)); }
        }
      }
    }
    return { items: best.items.map(i => ({ n: i.n, pack: i.x.pack })).sort((a, b) => (b.pack[dim] || 0) - (a.pack[dim] || 0)), total: best.total / scale, cost: priced.length ? best.cost : null };
  }
  /**
   * What covers a shortfall of one variety, in its vendor's own sizes: { how: 'sizes', text, items, total, cost, sizes }
   * with text such as "1 × 250 seeds". Otherwise the nearest thing known, and `how` says which: 'unsized' when the
   * vendor's packet is the cheaper buy but its page gives no count; 'packet' or 'weight' when the size list is not on
   * file and only the page's packet size or seeds per ounce is. Null when nothing is known.
   */
  function toCover(amount, unit, v, given) {
    if (!v || !(amount > 0)) return null;
    const sizes = packs(v, given), best = unit === 'seeds' || unit === 'g' ? cover(amount, sizes.list, unit) : null;
    const packet = sizes.unsized.slice().sort((a, b) => a.price - b.price)[0];
    if (unit === 'seeds' && packet && (!best || best.cost == null || packet.price < best.cost)) return { how: 'unsized', sizes, items: [], total: null, cost: null, packet, text: 'packet, count not given' };
    if (best) return { ...best, how: 'sizes', sizes, text: best.items.map(i => `${grouped(i.n)} × ${i.pack.text}`).join(' + ') };
    if (unit !== 'seeds') return null;
    if (v.seedsPerPacket > 0) { const n = Math.ceil(amount / v.seedsPerPacket); return { how: 'packet', sizes, items: [], total: n * v.seedsPerPacket, cost: null, text: `${grouped(n)} × packet of ${grouped(v.seedsPerPacket)}` }; }
    const weight = measures(amount, v).weight;
    return weight ? { how: 'weight', sizes, items: [], total: amount, cost: null, text: weight } : null;
  }

  // ───────────────────────────── sowing draws stock down ─────────────────────────────
  // A planned sowing never touches stock. Recording that it happened does: the planting gets its actual date, and the
  // seed it used comes off the lots on hand. The records are v7's own (done, workflow.history, workflow.seedUse, and a
  // "use" entry in the lot's change log), so either planner reads what the other recorded.
  const SOWN_KINDS = ['sow', 'field', 'harvest', 'flip'];
  const realDay = s => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const d = new Date(s + 'T12:00:00Z'); return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === s; };
  const doneDate = (p, kind) => { const v = p && p.done && typeof p.done === 'object' ? p.done[kind] : null; return realDay(v) ? v : null; };
  const DONE_ORDER = [['sow', 'potup'], ['sow', 'harden'], ['sow', 'field'], ['potup', 'harden'], ['potup', 'field'], ['harden', 'field'], ['amend', 'field'], ['field', 'move'], ['field', 'sidedress'], ['field', 'harvest'],
    ...['sow', 'potup', 'harden', 'amend', 'field', 'move', 'sidedress', 'harvest', 'care'].map(k => [k, 'flip'])];
  const DONE_WORD = { sow: 'sowing', potup: 'potting up', harden: 'hardening off', amend: 'amending', field: 'planting', move: 'moving out', sidedress: 'side-dressing', harvest: 'harvest', care: 'care', flip: 'clearing' };
  const trim6 = n => Math.round(n * 1e6) / 1e6;
  const listOf = (flow, key) => { const x = flow[key]; if (x != null && !Array.isArray(x)) throw new Error('The saved work history of this planting cannot be read. It is kept as it is; nothing was changed.'); return x || []; };
  /**
   * What sowing one planting uses, and where it stands; null when it needs nothing (an established planting).
   * kind is the work that uses the seed: 'sow' in the nursery or on a bench, 'field' when it goes straight into the ground.
   * unit is the unit its row is counted in; stockUnit the unit its lots are kept in.
   */
  function sowing(engine, p) {
    const r = engine.calc(p);
    if (!r || p.established === true) return null;
    const c = r.c, saved = engine.variety(p.varietyId), v = saved && saved.cropId === p.cropId ? saved : null;
    const material = r.rack ? 'seed' : c.plantingMaterial || (c.material === 'bulb' ? 'bulb' : 'seed');
    const unit = r.rack ? 'g' : material === 'seed' ? 'seeds' : material + 's', stock = stockUnit(unit);
    const kind = material === 'seed' && (r.rack || r.plannedSow) ? 'sow' : 'field';
    const amount = (unit === 'g' ? r.seedG : unit === 'seeds' ? r.seeds : (r.bulbs || Math.ceil(r.plants))) || 0;
    const flow = p.workflow && typeof p.workflow === 'object' ? p.workflow : {}, uses = Array.isArray(flow.seedUse) ? flow.seedUse : [];
    const prior = uses.reduce((n, u) => n + (u && u.unit === stock && Number(u.quantity) > 0 ? Number(u.quantity) : 0), 0);
    return { kind, unit, stockUnit: stock, key: v ? 'v:' + v.id : 'c:' + p.cropId, variety: v, crop: c, amount, prior, estimate: Math.max(0, stock === 'g' ? trim6(amount - prior) : Math.ceil(amount - prior - 1e-9)),
      planned: kind === 'sow' && !r.rack ? r.plannedSow : r.planned, done: doneDate(p, kind), sown: SOWN_KINDS.some(k => doneDate(p, k)), uses, r };
  }
  /** Lots on hand for a sowing, in the order they are drawn from: oldest packed-for year first, then oldest record. */
  const lotsToUse = (inventory, key, unit) => lotsFor(inventory, key).filter(l => l.unit === unit && l.life === 'usable' && l.usable === true && Number(l.quantity) > 0)
    .sort((a, b) => (a.year || 9999) - (b.year || 9999) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  /**
   * Record a sowing. input: { date: 'YYYY-MM-DD', quantity?: what was used (the plan's own count when left out), note? }.
   * ctx adds today: 'YYYY-MM-DD'. Seed comes off the lots on hand, oldest first; whatever was used beyond them is
   * recorded as used without a counted lot, as v7 does, and no lot goes below zero.
   * Returns { planting, inventory (null when no lot changed), used: [{ lotId, quantity }], untracked, quantity, kind, unit, stockUnit, batchId }.
   */
  function recordSowing(engine, inventory, p, input, ctx) {
    const s = sowing(engine, p);
    if (!s) throw new Error('This planting is already established, so there is nothing to sow.');
    if (s.done) throw new Error(`This ${DONE_WORD[s.kind]} is already recorded, on ${s.done}.`);
    const date = String((input && input.date) || '');
    if (!realDay(date)) throw new Error('Choose a real calendar date.');
    if (date > ctx.today) throw new Error('Work that has not happened yet cannot be recorded. Choose today or an earlier day.');
    if (p.done != null && (typeof p.done !== 'object' || Array.isArray(p.done))) throw new Error('The recorded work of this planting cannot be read. It is kept as it is; nothing was changed.');
    const done = { ...(p.done || {}), [s.kind]: date };
    for (const [a, b] of DONE_ORDER) {
      const first = doneDate({ done }, a), second = doneDate({ done }, b);
      if (first && second && first > second) throw new Error(a === s.kind ? `That is after the ${DONE_WORD[b]} already recorded for this planting (${second}).` : `That is before the ${DONE_WORD[a]} already recorded for this planting (${first}).`);
    }
    const flow = p.workflow && typeof p.workflow === 'object' ? p.workflow : {}, history = listOf(flow, 'history'), uses = listOf(flow, 'seedUse');
    const unit = s.stockUnit, raw = input ? input.quantity : undefined, quantity = amountOf(raw === undefined || raw === null || String(raw).trim() === '' ? s.estimate : raw, unit, 'Seed used');
    const batchId = ctx.uid(), used = [];
    let lib = inventory, left = quantity;
    for (const lot of lotsToUse(inventory, s.key, unit)) {
      if (!(left > 1e-9)) break;
      const take = Math.min(left, Number(lot.quantity));
      lib = updateLot(lib, lot.id, { quantity: unit === 'g' ? trim6(lot.quantity - take) : lot.quantity - take }, 'use', ctx, `Reviewed sowing ${batchId}: ${take} ${unit}`) || lib;
      used.push({ lotId: lot.id, quantity: take }); left = unit === 'g' ? trim6(left - take) : left - take;
    }
    const entries = used.map(u => ({ lotId: u.lotId, quantity: u.quantity, unit, date, batchId, source: 'sowing' }));
    if (left > 1e-9) entries.push({ lotId: null, quantity: left, unit, date, batchId, source: 'sowing', untracked: true });
    const workflow = { ...flow, history: [...history, { action: 'complete', date, note: String((input && input.note) || '').trim(), at: ctx.now, kind: s.kind, previousActual: null, sowingReview: { v: 1, batchId, unit } }] };
    if (entries.length) workflow.seedUse = [...uses, ...entries];
    return { planting: { ...p, done, workflow }, inventory: used.length ? lib : null, used, untracked: left > 1e-9 ? left : 0, quantity, kind: s.kind, unit: s.unit, stockUnit: unit, batchId };
  }
  /**
   * Take a recorded sowing back: the date is cleared (v7's "clear-work"), and the seed that came off counted lots goes
   * back onto them. Seed taken from a lot that has since been deleted cannot go back, and is reported as `lost`.
   * Returns { planting, inventory (null when no lot changed), returned, lost, kind, unit, stockUnit }.
   */
  function takeBackSowing(engine, inventory, p, ctx) {
    const s = sowing(engine, p);
    if (!s || !s.done) throw new Error('No sowing is recorded for this planting.');
    const flow = p.workflow && typeof p.workflow === 'object' ? p.workflow : {}, history = listOf(flow, 'history'), uses = listOf(flow, 'seedUse');
    const last = history.slice().reverse().find(x => x && x.action === 'complete' && x.kind === s.kind && x.sowingReview && x.sowingReview.batchId), batchId = last ? last.sowingReview.batchId : null;
    const mine = batchId ? uses.filter(u => u && u.batchId === batchId) : [], rest = uses.filter(u => !mine.includes(u));
    let lib = inventory, returned = 0, lost = 0;
    for (const u of mine) {
      const q = Number(u.quantity);
      if (!u.lotId || !(q > 0)) continue;
      const lot = (lib && Array.isArray(lib.lots) ? lib.lots : []).find(l => l && l.id === u.lotId && l.deleted !== true && l.unit === u.unit);
      if (!lot) { lost = trim6(lost + q); continue; }
      lib = updateLot(lib, lot.id, { quantity: u.unit === 'g' ? trim6((Number(lot.quantity) || 0) + q) : (Number(lot.quantity) || 0) + q }, 'count', ctx, `Sowing ${batchId} taken back: ${q} ${u.unit} returned`) || lib;
      returned = trim6(returned + q);
    }
    const done = { ...p.done };
    delete done[s.kind];
    const workflow = { ...flow, history: [...history, { action: 'clear-work', kind: s.kind, previousActual: s.done, date: ctx.today, note: returned ? `${returned} ${s.stockUnit} returned to stock` : '', at: ctx.now }] };
    if (rest.length) workflow.seedUse = rest; else delete workflow.seedUse;
    const planting = { ...p, workflow };
    if (Object.keys(done).length) planting.done = done; else delete planting.done;
    return { planting, inventory: returned ? lib : null, returned, lost, kind: s.kind, unit: s.unit, stockUnit: s.stockUnit };
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

  return { norm, supplierKey, varietyKey, urlKey, hostOf, inferCrop, matches, elsewhere, fields, apply, record, derived, newCrop, required, stock, measures, emptyInventory, stockUnit, lifeOf, lotsFor, addLot, updateLot, receiveLot, deleteLot, moveLot, unlisted, setOnHand,
    sizeOf, packs, cover, toCover, money, sowing, lotsToUse, recordSowing, takeBackSowing, STOCK_UNITS, UNIT_WORD, BASES, STAGES };
});
