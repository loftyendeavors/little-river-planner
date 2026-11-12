/* Little River Farm Planner — plan import / export.
 *
 * The working plan ("core") is what the planning screens read and write.
 * Everything else a v7 backup carries — harvest logs, seed inventory, soil
 * tests, weather, the long supplier page captures on each variety — is kept
 * untouched in the "attic" and stitched back on export, so nothing a later
 * module needs is lost while those screens do not exist yet.
 */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./engine.js') : root.LRFEngine);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LRFPlanIO = api;
})(typeof self !== 'undefined' ? self : this, function (Engine) {
  'use strict';

  /** Top-level collections the core planning screens own. */
  const CORE_KEYS = ['v', 'gardens', 'beds', 'plantings', 'crops', 'varieties', 'customers', 'containers', 'map', 'settings', 'assumptions',
    'cropUnits', 'salesMix', 'products', 'nursery', 'planningPreferences', 'seedInventory', 'liveTrayPlans', 'lrfNext'];
  /** Bulky per-variety captures the planner never reads. */
  const HEAVY_VARIETY_FIELDS = ['webImport', 'webImportHistory', 'catalogSourceText'];
  const DERIVED_VARIETY_FIELDS = ['_basisFromText', '_pageTextBasis', '_catalogTextBasis'];
  const REQUIRED_LISTS = ['gardens', 'beds', 'plantings'];

  function assertPlan(plan) {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('This file is not a farm plan.');
    for (const key of REQUIRED_LISTS) if (!Array.isArray(plan[key])) throw new Error(`This file is not a farm plan: "${key}" is missing.`);
  }

  /** v7 plan.json -> { core, attic }. The input object is not modified. */
  function split(plan) {
    assertPlan(plan);
    const core = {}, attic = { v: 1, rest: {}, varieties: {} };
    for (const [key, value] of Object.entries(plan)) {
      if (CORE_KEYS.includes(key)) core[key] = value; else attic.rest[key] = value;
    }
    for (const key of ['crops', 'varieties', 'customers', 'containers']) if (!Array.isArray(core[key])) core[key] = [];
    core.map = core.map && typeof core.map === 'object' ? core.map : {};
    core.settings = core.settings && typeof core.settings === 'object' ? core.settings : {};
    core.varieties = core.varieties.map(v => {
      const heavy = {}, lean = {};
      for (const [key, value] of Object.entries(v || {})) (HEAVY_VARIETY_FIELDS.includes(key) ? heavy : lean)[key] = value;
      if (Object.keys(heavy).length) {
        attic.varieties[v.id] = heavy;
        // The maturity clock's starting point may only be stated in the page text we are setting aside.
        lean._basisFromText = Engine.basisFromText(v.sourceText || v.catalogSourceText || v.dtmText || v.catalogDtmText || '');
        lean._pageTextBasis = Engine.basisFromText(v.sourceText || v.catalogSourceText || '');
        lean._catalogTextBasis = Engine.basisFromText(v.catalogSourceText || '');
      }
      return lean;
    });
    return { core, attic };
  }

  /** { core, attic } -> a plan the v7 app can restore. */
  function join(core, attic) {
    const plan = { ...((attic && attic.rest) || {}) };
    for (const [key, value] of Object.entries(core)) if (key !== 'lrfNext') plan[key] = value; // lrfNext is this app's own bookkeeping
    plan.varieties = (core.varieties || []).map(v => {
      const heavy = ((attic && attic.varieties) || {})[v.id], out = { ...v, ...(heavy || {}) };
      // Where a variety's maturity is counted from was read out of its supplier text when that text was set aside. With the text
      // going back into the file, split() reads it again; with no text to put back, what was read is all there is, and it stays.
      if (heavy && Object.keys(heavy).length) for (const key of DERIVED_VARIETY_FIELDS) delete out[key];
      return out;
    });
    return plan;
  }

  // ── compact plan: the copy of a farm's plan that ships with the page ──
  // Planning fields and each variety's supplier, product code and page address. Supplier page text, photos, price lists and
  // the provenance of generated plantings stay in the full backup.
  const VARIETY_PLANNING_FIELDS = ['id', 'cropId', 'name', 'stub', 'active', 'deleted', 'dtm', 'hw', 'gh', 'inRow', 'rowSp', 'rowsPerBed', 'germ', 'seedsPerFt',
    'summerOK', 'harvestMode', 'timingMode', 'timingEnvironmentReviewed', 'environmentDefaults', 'towerUsedSites', 'towerSitePreferenceEnabled',
    'catalogSourceChoice', 'catalogDtm', 'catalogDtmMax', 'catalogMaturityBasis',
    // shown in the seed library and used for seeds required
    'source', 'supplier', 'sku', 'url', 'catalogDtmText', 'catalogHarvestStage', 'seedsPerPacket', 'seedsPerOz', 'seedsPerG', 'seedsPerLb'];
  const PLANTING_DROPPED_FIELDS = ['planningSource', 'flagReviews'];
  const isDeterminate = notes => /\bdeterminate\b/i.test(String(notes || '')) && !/\bindeterminate\b/i.test(String(notes || ''));
  /** Group records that differ only in a few fields: one shared template, one short row each. */
  function templated(list, rowOf, restOf) {
    const templates = [], index = new Map(), rows = [];
    for (const item of list) {
      const key = JSON.stringify(restOf(item));
      if (!index.has(key)) { index.set(key, templates.length); templates.push(JSON.parse(key)); }
      rows.push([...rowOf(item), index.get(key)]);
    }
    return { templates, rows };
  }
  /** core plan -> compact plan. Planting ids are not kept; everything the engine reads is. */
  function pack(core) {
    const bedIndex = new Map(core.beds.map((b, i) => [b.id, i])), varietyIndex = new Map(core.varieties.map((v, i) => [v.id, i]));
    const varieties = core.varieties.map(v => {
      const out = {};
      for (const key of VARIETY_PLANNING_FIELDS) if (v[key] !== undefined) out[key] = v[key];
      for (const key of ['_basisFromText', '_pageTextBasis', '_catalogTextBasis']) if (v[key] && v[key] !== 'unspecified') out[key] = v[key];
      if (isDeterminate(v.notes)) out._determinate = true;
      return out;
    });
    const beds = templated(core.beds, b => [b.id, b.bed, b.px ? b.px.x : null, b.px ? b.px.y : null, b.px ? b.px.rot || 0 : 0], b => { const { id, bed, px, ...rest } = b; return rest; });
    const plantings = templated(core.plantings, p => [bedIndex.get(p.bedId), p.date], p => {
      const { id, bedId, date, varietyId, ...rest } = p;
      for (const key of PLANTING_DROPPED_FIELDS) delete rest[key];
      if (varietyId != null) rest.v = varietyIndex.has(varietyId) ? varietyIndex.get(varietyId) : varietyId;
      return rest;
    });
    const out = { format: 'lrf-compact-plan-1' };
    // Left out on purpose: the farm's address and coordinates, the weather station, and the fertilizer price list.
    for (const [key, value] of Object.entries(core)) if (!['beds', 'plantings', 'varieties', 'lrfNext', 'products', 'map', 'settings', 'seedInventory'].includes(key)) out[key] = value;   // seed stock ships beside the plan, in its own file
    const map = core.map || {}, image = map.imageFile;
    out.map = { ftPerPx: map.ftPerPx, imgW: map.imgW, imgH: map.imgH, towerShape: map.towerShape, towerGap: map.towerGap, imageFile: image ? { name: image.name, mime: image.mime, sha256: image.sha256 } : undefined };
    out.settings = { ...core.settings };
    delete out.settings.weather; delete out.settings.whiteboard;
    return { ...out, varieties, bedTemplates: beds.templates, beds: beds.rows, plantingTemplates: plantings.templates, plantings: plantings.rows };
  }
  /** compact plan -> core plan. */
  function unpack(compact) {
    if (!compact || compact.format !== 'lrf-compact-plan-1') throw new Error('This is not a compact plan.');
    const { format, bedTemplates, plantingTemplates, ...core } = compact;
    core.beds = compact.beds.map(([id, bed, x, y, rot, t]) => ({ id, bed, ...bedTemplates[t], px: x == null ? null : { x, y, rot } }));
    core.plantings = compact.plantings.map(([bedIndex, date, t], i) => {
      const { v, ...rest } = plantingTemplates[t], p = { id: 'p' + String(i + 1).padStart(4, '0'), bedId: core.beds[bedIndex].id, date, ...rest };
      if (v != null) p.varietyId = typeof v === 'number' ? compact.varieties[v].id : v;
      return p;
    });
    assertPlan(core);
    return core;
  }

  // ── what was established here, carried onto a newer v7 backup ──
  // The plan itself (plantings, tray demand, seed stock) comes from the backup. What was said here about the farm does not have
  // to be said again: the assumptions list, this app's own settings, and changes made here to a crop, variety, garden or bed.
  // A change is put back only while the backup still holds the value it was changed from; where v7 has moved on, v7's value stands.
  const FACT_LISTS = ['crops', 'varieties', 'gardens', 'beds'];
  const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  const figures = a => a ? ['crops', 'varieties'].reduce((n, k) => n + Object.values(a[k] || {}).reduce((m, envs) => m + Object.keys(envs || {}).length, 0), 0) + Object.keys(a.starts || {}).length : 0;
  /**
   * Record the difference one edit makes to a crop, variety, garden or bed. facts: { crops: { id: { name, set, was } }, … }.
   * `was` is what the record held before it was first changed here; a field put back to that is forgotten.
   * A record made here over one of the planner's built-in crops is kept whole (`create`).
   */
  function note(facts, list, before, after, builtIn) {
    const out = { ...(facts || {}) }, group = { ...(out[list] || {}) };
    if (!after || !FACT_LISTS.includes(list)) return facts || null;
    const id = after.id, name = after.name || after.bed || '';
    if (!before) { if (!builtIn) return facts || null; group[id] = { name, create: after }; }
    else if (group[id] && group[id].create) group[id] = { name, create: after };
    else {
      const entry = { name, set: { ...((group[id] || {}).set || {}) }, was: { ...((group[id] || {}).was || {}) } };
      for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (field === 'id' || field.startsWith('_') || same(before[field], after[field])) continue;
        if (!(field in entry.was)) entry.was[field] = before[field] === undefined ? null : before[field];
        if (same(entry.was[field], after[field])) { delete entry.set[field]; delete entry.was[field]; } else entry.set[field] = after[field] === undefined ? null : after[field];
      }
      if (Object.keys(entry.set).length) group[id] = entry; else delete group[id];
    }
    out[list] = group;
    return FACT_LISTS.some(k => Object.keys(out[k] || {}).length) ? out : null;
  }
  /**
   * prev: the plan being replaced. next: the core plan read from a backup. Returns { plan, keep, notes, gone }:
   * plan is next with what carries applied, keep goes into its lrfNext, notes say in words what was kept,
   * gone lists varieties that exist here and not in the backup.
   */
  function carry(prev, next) {
    const mine = (prev && prev.lrfNext) || {}, plan = { ...next }, keep = {}, notes = [];
    if (!prev || mine.sample) return { plan, keep, notes, gone: [] };
    if (figures(prev.assumptions) && !figures(next.assumptions)) { plan.assumptions = prev.assumptions; const n = figures(prev.assumptions); notes.push(`your assumptions list (${n} figure${n === 1 ? '' : 's'})`); }
    for (const key of ['crates', 'trayStart', 'trays', 'groups']) if (mine[key]) keep[key] = mine[key];
    // Plantings waiting to be placed were made here and are in no v7 backup: they stay, still waiting.
    if (Array.isArray(mine.waiting) && mine.waiting.length) { keep.waiting = mine.waiting; notes.push(`${mine.waiting.length} planting${mine.waiting.length === 1 ? '' : 's'} waiting to be placed`); }
    const facts = {}, changed = [];
    for (const list of FACT_LISTS) {
      const entries = Object.entries((mine.facts || {})[list] || {});
      if (!entries.length) continue;
      const records = (plan[list] || []).slice(), index = new Map(records.map((x, i) => [x.id, i]));
      for (const [id, fact] of entries) {
        if (fact.create) {
          if (!index.has(id)) { records.push(fact.create); changed.push(fact.name || id); (facts[list] = facts[list] || {})[id] = fact; }
          continue;   // the backup has its own record of that crop now: it stands
        }
        if (!index.has(id)) { (facts[list] = facts[list] || {})[id] = fact; continue; }   // not in this backup; perhaps in a later one
        const record = { ...records[index.get(id)] }, set = {}, was = {};
        let applied = false;
        for (const [field, value] of Object.entries(fact.set || {})) {
          if (same(record[field], value)) continue;                                // the backup already says so
          if (!same(record[field], (fact.was || {})[field])) continue;             // v7 has changed it since: v7's value stands
          if (value === null) delete record[field]; else record[field] = value;
          set[field] = value; was[field] = fact.was[field]; applied = true;
        }
        if (applied) { records[index.get(id)] = record; changed.push(fact.name || id); (facts[list] = facts[list] || {})[id] = { name: fact.name, set, was }; }
      }
      plan[list] = records;
    }
    if (changed.length) notes.push(`what was changed here on ${changed.length} record${changed.length === 1 ? '' : 's'} (${changed.slice(0, 4).join(', ')}${changed.length > 4 ? '…' : ''})`);
    if (Object.keys(facts).length) keep.facts = facts;
    const have = new Set((next.varieties || []).map(v => v.id));
    const gone = (prev.varieties || []).filter(v => v && !v.deleted && v.active !== false && !have.has(v.id)).map(v => v.name || v.id);
    return { plan, keep, notes, gone };
  }

  /** What the page shows before a real plan is loaded: the stock layout with a few example plantings. */
  function sample(lib) {
    const year = new Date().getFullYear() + 1, at = (m, d) => `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const examples = [
      ['front-field-south-1', 'lettuce_head', at(4, 20)], ['front-field-south-2', 'lettuce_head', at(5, 4)], ['front-field-south-3', 'lettuce_head', at(5, 18)],
      ['front-field-south-5', 'carrot', at(4, 22)], ['front-field-south-6', 'beet', at(4, 22)], ['front-field-north-1', 'kale', at(4, 26)],
      ['front-field-north-2', 'onion', at(4, 19)], ['front-field-north-4', 'bean_bush', at(5, 24)], ['hill-garden-1', 'potato', at(4, 24)],
      ['hill-garden-2', 'winter_squash', at(5, 28)], ['production-house-a-1', 'tomato', at(4, 12)], ['production-house-a-2', 'cucumber', at(4, 26)],
      ['production-house-b-1', 'pepper', at(4, 28)], ['towers-1', 'lettuce_head', at(4, 15)], ['towers-2', 'basil', at(5, 10)]
    ];
    return {
      v: 3, gardens: JSON.parse(JSON.stringify(lib.sampleGardens)), beds: JSON.parse(JSON.stringify(lib.sampleBeds)),
      plantings: examples.map(([bedId, cropId, date], i) => ({ id: 'sample-' + (i + 1), bedId, cropId, date })),
      crops: [], varieties: [], customers: JSON.parse(JSON.stringify(lib.sampleCustomers)), containers: [], map: {},
      settings: { ...JSON.parse(JSON.stringify(lib.defaults)), year }, cropUnits: {}, salesMix: {}, products: [],
      lrfNext: { sample: true, attic: 'none' }
    };
  }
  function summary(core) {
    return { gardens: core.gardens.length, beds: core.beds.length, plantings: core.plantings.length, varieties: core.varieties.length, year: core.settings && core.settings.year };
  }

  return { split, join, pack, unpack, sample, summary, assertPlan, note, carry, CORE_KEYS, HEAVY_VARIETY_FIELDS };
});
