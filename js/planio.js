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
    'cropUnits', 'salesMix', 'products', 'nursery', 'planningPreferences', 'lrfNext'];
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
      const out = { ...v, ...(((attic && attic.varieties) || {})[v.id] || {}) };
      for (const key of DERIVED_VARIETY_FIELDS) delete out[key];
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
    for (const [key, value] of Object.entries(core)) if (!['beds', 'plantings', 'varieties', 'lrfNext', 'products', 'map', 'settings'].includes(key)) out[key] = value;
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

  return { split, join, pack, unpack, sample, summary, assertPlan, CORE_KEYS, HEAVY_VARIETY_FIELDS };
});
