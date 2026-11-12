/* Little River Farm Planner — planning engine.
 *
 * Pure functions over a plan. A plan uses the same record shapes the v7 app
 * saved (schema v3), so a v7 backup loads without transformation and this
 * engine can be checked planting-for-planting against v7.16.169.
 *
 * No DOM and no storage in this file. It runs in the browser and in Node.
 *
 *   const engine = LRFEngine.create(plan, LRFLibrary);
 *   engine.calc(planting)          -> dates, plant counts, occupancy
 *   engine.cropsAt(bedId, date)    -> what stands in a bed on a date
 *   engine.fit(draftPlanting)      -> does a proposed planting fit?
 *
 * An engine is a snapshot: build a new one after the plan changes.
 */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports, api = factory(node ? require('./sowing.js') : root.LRFSowing);
  if (node) module.exports = api; else root.LRFEngine = api;
})(typeof self !== 'undefined' ? self : this, function (Sow) {
  'use strict';

  // ───────────────────────── calendar-day helpers ─────────────────────────
  // Farm dates are calendar days in local time, never UTC timestamps.
  const pad = n => String(n).padStart(2, '0');
  const validDate = d => d instanceof Date && Number.isFinite(d.getTime());
  const d2s = d => validDate(d) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '';
  const s2d = s => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return new Date(NaN);
    const y = +m[1], mo = +m[2], day = +m[3], d = new Date(y, mo - 1, day);
    return y >= 100 && d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === day ? d : new Date(NaN);
  };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const serial = d => { d = new Date(d); return validDate(d) ? Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000 : NaN; };
  const dayDiff = (a, b) => serial(a) - serial(b);
  const yearLen = y => (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 366 : 365;
  const validMonthDay = s => /^\d{2}-\d{2}$/.test(String(s || '')) && validDate(s2d('2000-' + s));
  const monthDayDate = (year, md) => validMonthDay(md) ? s2d(`${year}-${md === '02-29' && yearLen(year) === 365 ? '02-28' : md}`) : null;
  const minDate = list => new Date(Math.min(...list));
  const maxDate = list => new Date(Math.max(...list));

  const finite = (v, fallback = 0) => v !== null && v !== '' && Number.isFinite(+v) ? +v : fallback;
  const positive = (v, fallback = 1) => finite(v) > 0 ? +v : fallback;
  const nonNegative = (v, fallback = 0) => finite(v, fallback) >= 0 ? finite(v, fallback) : fallback;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
  const deepCopy = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));

  /** Whole rows per bed: null = follow spacing, NaN = invalid entry. */
  function rowsPerBedValue(value) {
    if (value == null || value === '' || (typeof value === 'string' && !value.trim())) return null;
    if (typeof value !== 'number' && typeof value !== 'string') return NaN;
    const n = +value;
    return Number.isSafeInteger(n) && n >= 1 && n <= 1000 ? n : NaN;
  }

  const DONE_KINDS = ['sow', 'potup', 'harden', 'amend', 'field', 'move', 'sidedress', 'harvest', 'care', 'flip'];
  const VARIETY_ENV_FIELDS = ['inRow', 'rowSp', 'rowsPerBed', 'dtm', 'gh', 'hw'];
  const ROW_COVER = { rate: 0.10, maxDays: 7 };

  /** The three places a crop's days can start, and how many days a transplant saves on a figure for seed sown in place. */
  const STARTS = ['transplant', 'seed', 'direct'], START_LESS = 14;
  /** Days in the bed, from a figure that starts at `basis`. */
  function inBed(figure, basis, method, nursery, less) {
    if (method !== 'TP' || (basis !== 'seed' && basis !== 'direct')) return { days: figure, off: 0, conversion: 'none' };
    const off = Math.max(0, Math.round(basis === 'direct' ? less : nursery));
    return { days: figure - off, off, conversion: basis === 'direct' ? 'direct-less' : 'seed-minus-nursery' };
  }
  /** Does a catalog's maturity clock start at sowing or at transplanting? */
  function basisFromText(text) {
    const s = String(text || '').toLowerCase();
    const seed = /(?:from|after)\s+(?:the\s+)?(?:date\s+of\s+)?(?:direct\s+)?(?:sowing|seeding|seed\b)/.test(s);
    const transplant = /(?:from|after)\s+(?:the\s+)?(?:date\s+of\s+)?(?:field\s+)?transplant(?:ing|s)?\b/.test(s);
    return seed !== transplant ? (seed ? 'seed' : 'transplant') : 'unspecified';
  }

  // ───────────────────────────── crop colours ─────────────────────────────
  const hashStr = s => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
  function hexToHsl(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return [0, 0, 50];
    const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l * 100];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s * 100, l * 100];
  }
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  }
  const shade = (hex, dl) => { const [h, s, l] = hexToHsl(hex); return hslToHex(h, s, clamp(l + dl, 0, 100)); };

  // ───────────────────────────────── engine ────────────────────────────────
  function create(plan, lib, options = {}) {
    const S = plan, settings = S.settings || {}, DEF = lib.defaults;
    // v7 laid a month multiplier, a house factor and a row-cover saving over every default. The planner
    // no longer does: a number means what it says. `multipliers: true` brings them back for the v7 parity check.
    const legacy = options.multipliers === true;
    const libraryDtm = new Map((lib.crops || []).map(c => [c.id, c.dtm]));
    /** The published guide's figure for a crop, unless the grower has changed that crop's own default. */
    const guideFor = c => { const g = !legacy && lib.guide && c && lib.guide.crops[c.id]; return g && libraryDtm.get(c.id) === c.dtm ? g : null; };

    // Indexes. v7 resolved every lookup with Array.find; first match wins here too.
    const firstWins = (list, key = 'id') => { const m = new Map(); for (const x of list || []) if (x && !m.has(x[key])) m.set(x[key], x); return m; };
    const bedById = firstWins(S.beds), gardenById = firstWins(S.gardens), varietyById = firstWins(S.varieties);
    const plantingById = firstWins(S.plantings);
    const byBed = new Map();
    for (const p of S.plantings || []) { if (!byBed.has(p.bedId)) byBed.set(p.bedId, []); byBed.get(p.bedId).push(p); }
    const plantingsIn = bedId => byBed.get(bedId) || [];

    // ── crop library: built-in crops, overlaid by the farm's own records ──
    const hasHarvestDays = o => !!o && o.hw != null && o.hw !== '' && Number.isFinite(+o.hw) && +o.hw >= 0;
    const deletedCrops = new Set(settings.cropTypeList && settings.cropTypeList.v === 1 && Array.isArray(settings.cropTypeList.deleted) ? settings.cropTypeList.deleted : []);
    const cropMap = new Map(lib.crops.filter(c => !deletedCrops.has(c.id)).map(c => [c.id, c]));
    for (const c of S.crops || []) {
      if (!c || !c.id || deletedCrops.has(c.id)) continue;
      const merged = { ...(cropMap.get(c.id) || {}), ...c };
      if (hasHarvestDays(c) && !['season', 'window'].includes(c.harvestMode)) merged.harvestMode = 'window';
      if (c.harvestMode === 'season' && hasHarvestDays(c) && c.yieldDays == null) merged.yieldDays = positive(c.hw, 1);
      cropMap.set(c.id, merged);
    }
    const cropList = [...cropMap.values()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const crop = id => cropMap.get(id);
    const variety = id => id ? varietyById.get(id) : null;
    const isCoverCrop = c => !!c && (/^cover_/.test(String(c.id || '')) || String(c.family || '').trim().toLowerCase() === 'cover crop');
    const isPerennial = c => !!c && (typeof c.perennial === 'boolean' ? c.perennial : /perennial|raspberry|blackberry/i.test(c.name || ''));

    function cropColor(c) {
      if (!c) return '#9a9d94';
      if (c.color) return c.color;
      const [h, s] = hexToHsl(lib.familyColors[c.family] || '#8a8f7a'), k = hashStr(c.id);
      if (c.family === 'Cover crop') return hslToHex(h, 22, 68);
      return hslToHex((h + ((k % 7) - 3) * 7 + 360) % 360, clamp(s * 0.85 + (((k >> 4) % 3) - 1) * 8, 32, 58), clamp(63 + (((k >> 8) % 5) - 2) * 4, 54, 72));
    }

    // ── growing spaces: soil beds, towers, living-tray benches, containers ──
    const bedOf = id => bedById.get(id);
    const gardenOf = b => gardenById.get(b && b.gardenId);
    const isCt = b => !!b && b.type === 'CT';
    const isTower = b => !!b && b.type !== 'CT' && (/site/i.test(b.type || '') || (gardenOf(b) || {}).type === 'towers');
    const isRack = b => !!b && b.type !== 'CT' && ((gardenOf(b) || {}).type === 'micro' || /^(rack|bench)$/i.test(b.type || ''));
    const isSoilBed = b => !!b && !isTower(b) && !isRack(b) && !isCt(b);
    const spaceKind = b => isTower(b) ? 'tower' : isRack(b) ? 'bench' : isCt(b) ? 'containers' : 'bed';
    const containerTypes = () => (S.containers && S.containers.length ? S.containers : []);
    const ctOf = b => containerTypes().find(x => x.id === b.ct) || containerTypes()[0] || { id: '', name: 'container', shape: 'rect', w: 1, l: 1, plants: 1 };
    const ctDims = ct => ct.shape === 'round' ? [(+ct.diam || 12) / 12, (+ct.diam || 12) / 12] : [+ct.w || 1, +ct.l || 1];
    const sites = b => {
      if (Number.isInteger(b && b.sites) && b.sites > 0) return b.sites;
      const m = /(\d+)\s*site/i.exec((b && b.type) || '');
      return m ? Math.max(1, +m[1]) : positive(b && b.sites, 42);
    };
    // Heated nursery benches. Plug trays, sheltered crates and live trays all stand on them, so their room is one pool,
    // counted in 10 × 20-inch tray spaces the way v7 counts it: bench area × packing ÷ one tray's footprint.
    const TRAY_FT2 = 200 / 144;
    // Crates sheltered under heat until they move outdoors stand on the floor here, so they take no bench room.
    // v7 counts each by its footprint as bench room; `crates: 'bench'` in this app's own settings, or the v7 parity mode, does the same.
    const cratesOnBenches = legacy || !!(S.lrfNext && S.lrfNext.crates === 'bench');
    const benches = () => Array.isArray(S.nursery && S.nursery.spaces) ? S.nursery.spaces.filter(x => x && typeof x === 'object') : [];
    const benchPacking = () => clamp(positive(S.nursery && S.nursery.packing, 85) / 100, 0.3, 1);
    const benchCap = sp => Math.floor(nonNegative(sp.w) * nonNegative(sp.l) * benchPacking() / TRAY_FT2);
    const heatedTraySpaces = () => benches().filter(sp => sp.active !== false && sp.kind !== 'outside').reduce((n, sp) => n + benchCap(sp), 0);
    /** The stand-in space v7 files live trays under: it is every heated bench at once, and has no place of its own. */
    const isPool = b => !!b && b.liveTrayPool === true && isRack(b);
    /** Capacity in the space's own unit: tower sites, trays, containers or bed-feet. */
    const capOf = b => !b ? 0 : isTower(b) ? sites(b) : isRack(b) ? (b.liveTrayPool ? heatedTraySpaces() : nonNegative(b.trays)) : isCt(b) ? nonNegative(b.count) : nonNegative(b.l);
    const capUnit = b => isTower(b) ? 'sites' : isRack(b) ? 'trays' : isCt(b) ? 'containers' : 'ft';
    const lenOf = (p, b) => { if (isTower(b)) return 0; const cap = capOf(b), want = isRack(b) ? finite(p.trays) : finite(p.ft); return want > 0 ? want : cap; };
    const usedSites = (p, b, c) => {
      const capacity = Math.floor(sites(b)), value = p && p.towerUsedSites != null && p.towerUsedSites !== '' ? p.towerUsedSites : c && c.towerUsedSites;
      return value == null || value === '' ? capacity : Math.min(capacity, Math.max(1, Math.round(positive(value, capacity))));
    };
    const shelterValid = b => !!(b && b.shelter && b.shelter.gardenId && (b.shelter.gardenId === 'nursery' || gardenById.has(b.shelter.gardenId)));
    const plantingBed = p => { const b = bedOf(p.bedId); return b && own(p, 'shelter') ? { ...b, shelter: p.shelter } : b; };
    const fieldGardenFor = b => {
      let g = gardenOf(b) || {};
      if (shelterValid(b) && (isTower(b) || isCt(b))) g = gardenById.get(b.shelter.gardenId) || { type: 'greenhouse', frost: false };
      return g;
    };
    const gCurve = g => (g && g.curveMode) || 'crop', gGap = g => (g && g.gapMode) || 'crop';
    const gWindow = (g, year) => ({ open: monthDayDate(year, g && g.open), close: monthDayDate(year, g && g.close) });
    const frostDates = year => ({
      last: monthDayDate(year, settings.frostLast) || monthDayDate(year, DEF.frostLast),
      first: monthDayDate(year, settings.frostFirst) || monthDayDate(year, DEF.frostFirst)
    });

    // ── recorded work (actual dates) stays separate from planned dates ──
    const doneOf = (p, kind) => { const v = p && p.done && p.done[kind]; return typeof v === 'string' && validDate(s2d(v)) ? v : null; };
    const clearDateOf = p => { const v = doneOf(p, 'flip'); return v ? s2d(v) : null; };
    const sowDateOf = (p, planned) => { const d = doneOf(p, 'sow'); return d ? s2d(d) : (validDate(planned) ? new Date(planned) : null); };

    // ── which crop / variety numbers apply to this planting ──
    // A planting may carry a snapshot of library values (growingDefaults) so a
    // later change to the Crop Library does not silently rewrite it.
    function growingRecord(p, kind) {
      const original = kind === 'crop' ? crop(p.cropId) : variety(p.varietyId), snap = p.growingDefaults;
      if (!original || !snap || snap.v !== 1 || snap.cropId !== p.cropId || (kind === 'variety' && snap.varietyId !== (p.varietyId || ''))) return original;
      const fields = snap[kind];
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return original;
      const result = { ...original };
      for (const [key, entry] of Object.entries(fields)) {
        if (!entry || typeof entry !== 'object') continue;
        if (entry.present === false) delete result[key]; else if (entry.present === true) result[key] = deepCopy(entry.value);
      }
      return result;
    }
    const growingCrop = p => growingRecord(p, 'crop');
    const varietyEnvironment = b => { if (!b || isRack(b) || isTower(b)) return ''; const t = (gardenOf(b) || {}).type; return t === 'field' ? 'field' : ['greenhouse', 'tunnel'].includes(t) ? 'greenhouse' : ''; };
    function varietyEnvironmentValid(config) {
      if (config == null) return true;
      if (typeof config !== 'object' || Array.isArray(config) || config.v !== 1) return false;
      for (const env of ['field', 'greenhouse']) {
        const values = config[env];
        if (values == null) continue;
        if (typeof values !== 'object' || Array.isArray(values)) return false;
        for (const key of VARIETY_ENV_FIELDS) {
          if (!own(values, key)) continue;
          const v = values[key];
          if (typeof v !== 'number' || !Number.isFinite(v) || v < (key === 'gh' ? 0 : 0.01) || (key === 'rowsPerBed' && Number.isNaN(rowsPerBedValue(v))) || (['dtm', 'hw'].includes(key) && (!Number.isInteger(v) || v < 1))) return false;
        }
      }
      return true;
    }
    const varietyEnvironmentProfile = (v, b) => { const cfg = v && v.environmentDefaults; return cfg && varietyEnvironmentValid(cfg) ? cfg[varietyEnvironment(b)] || null : null; };
    function growingVariety(p) {
      const v = growingRecord(p, 'variety'), profile = varietyEnvironmentProfile(v, plantingBed(p));
      if (!profile) return v;
      const result = { ...v };
      for (const key of VARIETY_ENV_FIELDS) if (own(profile, key)) result[key] = profile[key];
      if (profile.dtm > 0) result.timingMode = 'manual';
      return result;
    }

    const fieldDateOf = p => { const b = bedOf(p.bedId), c = growingCrop(p); return doneOf(p, 'field') || ((isRack(b) || (c && c.micro)) ? doneOf(p, 'sow') : null) || p.date; };

    // ── days to maturity: seasonal curve, garden factor, catalog clock, row cover ──
    const seasonCurve = c => c.dtmByMonth && c.dtmByMonth.length === 12 ? c.dtmByMonth : lib.seasonCurves[c.season || lib.cropSeason[c.id] || 'neutral'] || lib.seasonCurves.neutral;
    const seasonMult = (c, date) => seasonCurve(c)[date.getMonth()] || 1;
    const fieldSeasonFor = c => c && ['cool', 'warm', 'none'].includes(c.fieldSeason) ? c.fieldSeason : lib.fieldSeasons[c && c.id] || 'none';
    function harvestModeFor(c, v, p) {
      for (const o of [p, v]) {
        if (!o) continue;
        if (o.harvestMode === 'season' || o.harvestMode === 'window') return o.harvestMode;
        if (hasHarvestDays(o)) return 'window';
      }
      const determinate = v && (v._determinate != null ? v._determinate === true : /\bdeterminate\b/i.test(String(v.notes || '')) && !/\bindeterminate\b/i.test(String(v.notes || '')));
      if (c && ['tomato', 'tomato_cherry'].includes(c.id) && determinate) return 'window';
      return c && c.harvestMode === 'season' ? 'season' : 'window';
    }

    /** Layer 1 — crop numbers with variety, garden and per-planting overrides. */
    function baseEffective(p) {
      const c = growingCrop(p), b = plantingBed(p), g = gardenOf(b);
      if (!c || !b) return null;
      const vv = growingVariety(p), v = vv && vv.cropId === p.cropId ? vv : null, profile = varietyEnvironmentProfile(v, b);
      const e = { ...c, vname: '' }, published = guideFor(c);
      if (published) e.dtm = published.dtm;
      if (profile && own(profile, 'gh')) e.gh = profile.gh;
      if (v) {
        if (v.rowsPerBed != null) e.rowsPerBed = v.rowsPerBed;
        if (v.towerSitePreferenceEnabled === true && v.towerUsedSites != null) e.towerUsedSites = v.towerUsedSites;
        if (v.dtm > 0) e.dtm = v.dtm;
        if (v.inRow > 0) e.inRow = v.inRow;
        if (v.rowSp > 0) e.rowSp = v.rowSp;
        if (v.germ > 0) e.germ = v.germ;
        if (v.cost1000 > 0) e.seed1000 = v.cost1000;
        if (v.hw > 0) e.hw = v.hw;
        if (v.seedsPerFt > 0 && e.method === 'DS') e.seedsFt = v.seedsPerFt;
        e.vname = v.active === false || v.deleted === true ? '' : v.name;
      }
      e.dtm = positive(e.dtm, 30); e.hw = nonNegative(e.hw); e.baseDtm = e.dtm;
      const date = s2d(fieldDateOf(p));
      if (!validDate(date)) return null;
      const sm = !legacy || (g && gCurve(g) === 'flat') ? 1 : positive(seasonMult(c, date), 1), house = legacy ? positive(g && g.dtmFactor, 1) : 1;
      if (isTower(b)) {
        e.seasonMult = sm;
        e.dtm = Math.max(1, Math.round(positive(e.towerDays, legacy ? Math.round(e.dtm * 0.8) : e.dtm) * sm * house));
        const cyc = p.towerCycle;
        e.ghDays = cyc && cyc.v === 1 && Number.isInteger(cyc.nurseryDays) && cyc.nurseryDays >= 0 && cyc.nurseryDays <= 366 ? cyc.nurseryDays : nonNegative(e.rockwoolDays, 21);
        e.method = 'TP';
      } else if (isRack(b) || c.micro) { e.method = 'DS'; e.seasonMult = 1; }
      else { e.seasonMult = sm; e.dtm = Math.max(1, Math.round(e.dtm * (legacy ? (g && g.dtmFactor) || 1 : 1) * e.seasonMult)); }
      if (Number.isFinite(+p.dtm) && p.dtm > 0) e.dtm = Math.round(+p.dtm);
      if (p.hw != null && p.hw !== '' && Number.isFinite(+p.hw) && +p.hw >= 0) e.hw = Math.round(+p.hw);
      e.summerOK = !!(v && v.summerOK);
      e.harvestMode = harvestModeFor(c, v, p);
      return e;
    }

    /** Layer 2 — a selected variety uses its printed catalog clock unless told otherwise. */
    const TIMING_MODES = ['catalog', 'manual', 'learned'];
    const wholeDays = x => x !== '' && x != null && Number.isInteger(+x) && +x > 0 && +x <= 3650 ? +x : null;
    function catalogInfo(entry) {
      const min = wholeDays(entry.printedMin ?? entry.dtmMin ?? entry.catalogDtm ?? entry.dtm);
      const max = wholeDays(entry.printedMax ?? entry.dtmMax ?? entry.catalogDtmMax ?? entry.dtm2) || min;
      const said = entry.basis || entry.dtmBasis || entry.catalogMaturityBasis || entry.dtmFrom, stated = legacy && said === 'direct' ? 'seed' : said;
      const basis = STARTS.includes(stated) ? stated
        : entry._basisFromText || basisFromText(entry.sourceText || entry.catalogSourceText || entry.dtmText || entry.catalogDtmText || '');
      // What the supplier's page text suggests when no starting point is stated (see catalogDays).
      const pageTextBasis = entry._pageTextBasis || basisFromText(entry.sourceText || entry.catalogSourceText || '');
      return { printedMin: min, printedMax: max, basis, said: STARTS.includes(stated), pageTextBasis, harvestStage: entry.harvestStage || entry.catalogHarvestStage || 'unspecified', catalogStatus: entry.catalogStatus || '', needsCropReview: entry.needsCropReview === true };
    }
    function catalogSource(v) {
      if (!v) return null;
      if (['url', 'snapshot'].includes(v.catalogSourceChoice)) {
        const value = wholeDays(v.catalogDtm) || wholeDays(v.catalogDtmMax) ? catalogInfo(v) : null;
        if (value) { value.basis = (legacy && v.catalogMaturityBasis === 'direct' ? 'seed' : v.catalogMaturityBasis) || 'unspecified'; value.said = STARTS.includes(value.basis); value.harvestStage = v.catalogHarvestStage || 'unspecified'; }
        return value;
      }
      if (wholeDays(v.catalogDtm) || wholeDays(v.catalogDtmMax)) {
        const value = catalogInfo(v);
        // Older builds copied one crop's convention onto unrelated varieties.
        if (/peione-parsley-seed-5551/.test(v.maturitySource || '') && v.cropId !== 'parsley' && !v.catalogId) { value.basis = v._catalogTextBasis || basisFromText(v.catalogSourceText || ''); value.said = false; }
        return value;
      }
      return null; // bundled-catalog SKU lookup is not part of this build
    }
    /**
     * Printed catalog days converted to days from the field date.
     * v7 behaviour kept for parity: when the variety states no starting point,
     * the supplier page text is searched for "from sowing" / "from transplant"
     * and the match decides. That guess can be wrong (a page that says "weeks
     * from sowing to transplant" reads as a seed clock), so the result records
     * `inferred` and the planner flags it.
     */
    function catalogDays(source, c, { method, environment, environmentReviewed, nurseryDays, rule }) {
      if (source.catalogStatus === 'legacy-invalid' || source.needsCropReview || !source.printedMin) return null;
      if (source.printedMax && source.printedMax < source.printedMin) return null;
      if (['tower', 'living-tray'].includes(environment) && environmentReviewed !== true) return null;
      // Who says where the printed days start: the variety itself, then the crop's rule on the list.
      // Only where neither speaks is v7's reading of the page text still used, and marked as a guess.
      const stated = STARTS.includes(source.basis), set = !!(rule && rule.set) && source.said !== true;
      const basis = set ? rule.from : stated ? source.basis : (options.inferBasisFromPageText !== false ? source.pageTextBasis : 'unspecified');
      if (method === 'DS' && basis === 'transplant') return null;
      const turn = inBed(source.printedMin, basis, method, nurseryDays, rule ? rule.less : START_LESS);
      if (turn.days < 1) return null;
      return { days: turn.days, basis, conversion: turn.conversion, off: turn.off, inferred: !set && !stated && basis !== 'unspecified', by: source.said === true ? 'variety' : set ? 'crop' : stated ? 'variety' : basis !== 'unspecified' ? 'guess' : 'none', printed: source.printedMin, nurseryDays };
    }
    /** Days between sowing and going into the bed: the recorded ones when both days are recorded. */
    function nurseryOf(p, e, c, b) {
      const sow = doneOf(p, 'sow'), field = doneOf(p, 'field');
      return sow && field && s2d(field) >= s2d(sow) ? dayDiff(s2d(field), s2d(sow))
        : isTower(b) ? Math.max(0, Math.round(c.rockwoolDays ?? 21)) : Math.max(0, Math.round((e.gh || 0) * 7));
    }
    function timingMode(p, v) {
      if (TIMING_MODES.includes(p && p.timingMode)) return p.timingMode;
      if (TIMING_MODES.includes(v && v.timingMode)) return v.timingMode;
      return v ? 'catalog' : 'manual';
    }
    function withCatalogTiming(p) {
      const v = growingVariety(p), mode = timingMode(p, v);
      const e = baseEffective(mode === 'learned' ? { ...p, dtm: undefined } : p);
      if (!e) return e;
      const c = growingCrop(p), b = bedOf(p.bedId);
      const result = { mode, activeMode: 'manual', days: e.dtm };
      if (c && b && mode !== 'manual') {
        const source = v && v.cropId === p.cropId ? catalogSource(v) : null;
        result.activeMode = 'fallback';
        if (source) {
          const environment = isTower(b) ? 'tower' : isRack(b) ? 'living-tray' : 'field';
          const reviewed = p.timingEnvironmentReviewed === true || (v.timingEnvironmentReviewed && v.timingEnvironmentReviewed[environment] === true);
          const nurseryDays = nurseryOf(p, e, c, b);
          const conv = catalogDays(source, c, { method: isTower(b) ? 'TP' : e.method, environment, environmentReviewed: reviewed, nurseryDays: (isTower(b) ? 'TP' : e.method) === 'TP' ? nurseryDays : 0, rule: startRule(p.cropId) });
          if (conv) {
            const fieldDate = s2d(fieldDateOf(p)), g = gardenOf(b) || {}, flat = gCurve(g) === 'flat';
            const mult = !legacy || isRack(b) || c.micro ? 1 : (flat ? 1 : positive(seasonMult(c, fieldDate), 1)) * positive(g.dtmFactor, 1);
            Object.assign(result, { activeMode: 'catalog', baseDays: conv.days, days: Math.max(1, Math.round(conv.days * mult)), printed: conv.printed, basis: conv.basis, conversion: conv.conversion, inferredBasis: conv.inferred, nurseryDays: conv.nurseryDays, off: conv.off, basisBy: conv.by });
            e.baseDtm = conv.days; e.seasonMult = mult;
          }
        }
      }
      e.catalogTiming = result; e.dtm = result.days;
      return e;
    }
    /** Layer 3 — row cover brings a cool-season field crop in a little earlier. */
    function withRowCover(p, e) {
      if (!e || !legacy) return e;
      const b = plantingBed(p), field = s2d(fieldDateOf(p)), g = b ? fieldGardenFor(b) : {}, month = validDate(field) ? field.getMonth() + 1 : 0;
      const active = e.catalogTiming && e.catalogTiming.activeMode, vv = variety(p.varietyId), v = vv && vv.cropId === p.cropId ? vv : null;
      const manual = active !== 'catalog' && active !== 'learned' && (p.timingMode === 'manual' || (!p.timingMode && v && v.timingMode === 'manual') || (Number.isFinite(+p.dtm) && +p.dtm > 0));
      const coolSeason = (month >= 3 && month <= 5) || (month >= 9 && month <= 10);
      const applies = p.rowCover === true && g.type === 'field' && !(b && (isTower(b) || isRack(b))) && !e.micro && p.established !== true && !manual && active !== 'learned' && coolSeason;
      if (!applies) return e;
      const days = Math.max(1, Math.round(e.dtm - Math.min(ROW_COVER.maxDays, e.dtm * ROW_COVER.rate)));
      return { ...e, dtm: days, rowCoverSavedDays: e.dtm - days };
    }
    const computed = p => withRowCover(p, withCatalogTiming(p));

    // ── the assumptions list: the grower's own days to harvest, by growing condition ──
    // plan.assumptions = { v: 1, crops: { cropId: { field|tunnel|heated|tower: { dtm } } }, varieties: { varietyId: {…} } }
    // Order of authority: a number typed on the planting, then the grower's number for the variety,
    // then the variety's own figure (the supplier's, or one kept on the variety), then the grower's
    // number for the crop, then the library default. A number from the list is used as it is:
    // no month or house factor is laid over it.
    const ENVS = ['field', 'tunnel', 'heated', 'tower'];
    const envOf = b => !b || isRack(b) || isCt(b) && false ? '' : isTower(b) ? 'tower' : ({ field: 'field', tunnel: 'tunnel', greenhouse: 'heated' })[(gardenOf(b) || {}).type] || (isRack(b) ? '' : 'field');
    const listed = (kind, id, env) => { const a = S.assumptions, x = a && a[kind] && a[kind][id] && a[kind][id][env]; return x && Number.isFinite(+x.dtm) && +x.dtm > 0 ? Math.round(+x.dtm) : null; };
    const pinned = p => Number.isFinite(+p.dtm) && +p.dtm > 0;
    // ── where days start ──
    // plan.assumptions.starts = { cropId: { from: 'transplant' | 'seed' | 'direct', less: days } }
    //   transplant  the figure is days in the bed
    //   seed        the figure counts from sowing in the nursery: the nursery time comes off
    //   direct      the figure is for seed sown in place: as a transplant the crop is in the bed `less` days fewer
    // A variety that says where its own printed days start keeps that. A crop with no rule set counts as v7 did:
    // from the day it goes in the bed, unless the supplier's page text suggested otherwise (shown as a guess).
    function startRule(cropId) {
      const x = !legacy && S.assumptions && S.assumptions.starts ? S.assumptions.starts[cropId] : null;
      const from = x && STARTS.includes(x.from) ? x.from : null, less = x && x.less != null && Number.isFinite(+x.less) && +x.less >= 0 ? Math.round(+x.less) : null;
      return { from: from || 'transplant', less: less == null ? START_LESS : less, set: !!from, lessSet: less != null };
    }
    /** Can this crop's starting point be chosen at all? Sown in place, or planted as a bulb or a bought plant, it cannot. */
    const startFixed = c => !c ? 'sown' : c.micro ? 'tray' : (c.plantingMaterial || c.material) === 'bulb' || c.plantingMaterial === 'plant' ? 'planted' : c.method === 'TP' ? null : 'sown';
    /** The published starting point for a crop, where a guide gives one and the crop's can be chosen. */
    const startHint = cropId => { const c = crop(cropId); return !legacy && c && !startFixed(c) && lib.guide && lib.guide.startFor ? lib.guide.startFor(c) : null; };
    /** Where the numbers in a row of the list start. */
    const rowStart = (c, v, rule) => startFixed(c) ? 'transplant' : v && STARTS.includes(v.catalogMaturityBasis) ? v.catalogMaturityBasis : rule.from;
    /** Does the variety bring its own days to harvest for this planting? */
    function varietyFigure(p, e) {
      const v = growingVariety(p);
      if (!v || v.cropId !== p.cropId) return null;
      if (e.catalogTiming && e.catalogTiming.activeMode === 'catalog') return 'supplier';
      return v.dtm > 0 ? 'variety' : null;
    }
    function effective(p) {
      const e = computed(p);
      if (!e || !S.assumptions || pinned(p)) return e;
      const b = plantingBed(p), env = envOf(b);
      if (!env || isRack(b) || e.micro) return e;
      const v = variety(p.varietyId), own = v && v.cropId === p.cropId ? v : null, mineV = own ? listed('varieties', v.id, env) : null;
      // A number from the list counts from where its row says days start; what the planting needs is days in the bed.
      const mine = (typed, level) => {
        const rule = startRule(p.cropId), c = growingCrop(p), method = isTower(b) ? 'TP' : e.method, basis = rowStart(c, level === 'variety' ? own : null, rule);
        const turn = inBed(typed, basis, method, method === 'TP' ? nurseryOf(p, e, c, b) : 0, rule.less);
        return { ...e, dtm: Math.max(1, turn.days), assumed: { level, env, typed, basis, off: turn.off, conversion: turn.conversion } };
      };
      if (mineV) return mine(mineV, 'variety');
      if (varietyFigure(p, e)) return e;
      const mineC = listed('crops', p.cropId, env);
      return mineC ? mine(mineC, 'crop') : e;
    }
    /**
     * One cell of the list: days to harvest for a crop (or one of its varieties) in one growing condition.
     * `fallback` is what the planner uses when the grower has set nothing, before any month adjustment.
     */
    function timingFor(cropId, varietyId, env) {
      const bed = (S.beds || []).find(b => b.active !== false && envOf(b) === env && !isRack(b) && !isCt(b)) || (S.beds || []).find(b => b.active !== false && envOf(b) === env);
      const v = varietyId ? variety(varietyId) : null, mine = varietyId ? listed('varieties', varietyId, env) : listed('crops', cropId, env);
      if (!bed || !crop(cropId)) return { mine, fallback: null, value: mine, source: 'none' };
      const probe = { id: '\u0000probe', cropId, bedId: bed.id, date: `${positive(settings.year, new Date().getFullYear())}-06-15`, ...(v ? { varietyId: v.id } : {}) };
      const e = computed(probe);
      if (!e) return { mine, fallback: null, value: mine, source: 'none' };
      const g = gardenOf(bed) || {}, factor = !legacy || isRack(bed) || e.micro ? 1 : positive(g.dtmFactor, 1), figure = v ? varietyFigure(probe, e) : null, published = guideFor(crop(cropId));
      const base = e.catalogTiming && e.catalogTiming.activeMode === 'catalog' ? e.catalogTiming.baseDays : isTower(bed) ? positive(e.towerDays, legacy ? Math.round(e.baseDtm * 0.8) : e.baseDtm) : e.baseDtm;
      let inBedDays = Math.max(1, Math.round(base * factor)), source = figure || (published && !(isTower(bed) && e.towerDays > 0) ? 'guide' : 'library');
      // A variety with no figure of its own takes whatever the crop row says.
      if (v && !figure) { const c = timingFor(cropId, null, env); inBedDays = c.bed; source = c.mine ? 'crop-mine' : 'crop'; }
      const curve = seasonCurve(crop(cropId)), swing = !legacy || isRack(bed) || e.micro || gCurve(g) === 'flat' ? [1, 1] : [Math.min(...curve), Math.max(...curve)];
      // The row's numbers are shown, and typed, counted from where the row says days start. `bed` is what a planting gets.
      const c0 = crop(cropId), rule = startRule(cropId), fixed = startFixed(c0), method = isTower(bed) ? 'TP' : e.method, ct = e.catalogTiming || {};
      const nursery = method === 'TP' && !fixed ? nurseryOf(probe, e, growingCrop(probe), bed) : 0;
      // The supplier's figure is shown by the start it is being read with (a guess included); a number of the grower's own by the row's.
      const read = figure === 'supplier' && !fixed && !mine, start = read ? (STARTS.includes(ct.basis) ? ct.basis : 'transplant') : rowStart(c0, v && v.cropId === cropId ? v : null, rule);
      const by = fixed ? 'fixed' : read ? ct.basisBy : v && v.cropId === cropId && STARTS.includes(v.catalogMaturityBasis) ? 'variety' : rule.set ? 'crop' : 'none';
      const off = inBed(0, start, method, nursery, rule.less).off;
      const fallback = figure === 'supplier' ? ct.printed : inBedDays + off, days = mine ? Math.max(1, mine - off) : inBedDays;
      return { mine, fallback, value: mine || fallback, bed: days, nursery, total: nursery + days, off, start, startBy: by, fixed, less: rule.less, method,
        source, guide: source === 'guide' ? published : null, printed: figure === 'supplier' ? ct.printed : null, basis: figure === 'supplier' ? ct.basis : null, swing };
    }

    // ── field-season rules ──
    function fieldPlantingWindow(b, year) {
      const g = gardenOf(b) || {}, kind = g.growingEnvironment && g.growingEnvironment.v === 1 ? g.growingEnvironment.kind : null;
      const outdoor = kind ? kind === 'outdoor' : g.type === 'field' || (g.type === 'towers' && g.frost === true);
      if (!b || isRack(b) || !outdoor || !Number.isInteger(year)) return { from: null, to: null };
      const starts = [monthDayDate(year, settings.firstCoolField) || monthDayDate(year, '04-15'), monthDayDate(year, settings.firstWarmField) || monthDayDate(year, '05-01')].filter(validDate);
      return { from: starts.length ? minDate(starts) : null, to: monthDayDate(year, settings.lastOutdoorField) || monthDayDate(year, '10-01') };
    }
    const rowCoverAdvance = (o, b, c) => {
      const raw = o && o.rowCoverAdvance, n = raw == null || raw === '' ? 0 : (Number.isSafeInteger(+raw) && +raw >= 0 && (typeof raw === 'number' || (typeof raw === 'string' && raw.trim())) ? +raw : null);
      return o && o.rowCover === true && b && !isRack(b) && !(c && c.micro) && fieldGardenFor(b).type === 'field' && n != null ? n : 0;
    };
    function firstFieldDate(c, b, year, options = {}) {
      if (!c || !b || !Number.isInteger(year)) return null;
      const g = fieldGardenFor(b), starts = [], win = gWindow(g, year), category = fieldSeasonFor(c), advance = rowCoverAdvance(options, b, c);
      const shift = d => { const earlier = addDays(d, -advance); return validDate(earlier) ? earlier : d; };
      if (win.open) starts.push(win.open);
      if (!isRack(b) && !c.micro && g.type === 'field' && (validMonthDay(c.firstSafeField) || category !== 'none')) {
        starts.push(shift(monthDayDate(year, validMonthDay(c.firstSafeField) ? c.firstSafeField : settings[category === 'warm' ? 'firstWarmField' : 'firstCoolField']) || monthDayDate(year, category === 'warm' ? '05-01' : '04-15')));
      }
      if (c.frostTender && g.frost) starts.push(shift(addDays(frostDates(year).last, -finite(g.frostOffset))));
      const requested = s2d(options.earliestField);
      if (validDate(requested)) starts.push(requested);
      return starts.length ? maxDate(starts) : null;
    }
    const lastFieldDate = (c, b, year) => c && c.micro ? null : fieldPlantingWindow(b, year).to;

    // ── harvest period ──
    const blackoutOf = c => c.blackout === null ? null : (c.blackout || lib.blackout[c.id] || null);
    function blackoutDates(c, year) {
      const b = blackoutOf(c);
      if (!b || !validMonthDay(b[0]) || !validMonthDay(b[1])) return null;
      return { from: monthDayDate(year, b[0]), to: monthDayDate(b[1] < b[0] ? year + 1 : year, b[1]) };
    }
    function blackoutOverlapDays(c, a, b, v, g) {
      if (!validDate(a) || !validDate(b) || b < a || (v && v.summerOK) || (g && gGap(g) === 'none')) return 0;
      let n = 0;
      for (let y = a.getFullYear() - 1; y <= b.getFullYear(); y++) {
        const bo = blackoutDates(c, y);
        if (!bo) continue;
        const s = Math.max(a, bo.from), e = Math.min(b, bo.to);
        if (e >= s) n += dayDiff(e, s) + 1;
      }
      return n;
    }
    function seasonHarvestEnd(c, b, field) {
      const g = gardenOf(b) || {}, year = field.getFullYear(), ends = [new Date(year, 11, 31)], win = gWindow(g, year);
      if (win.close) ends.push(win.close);
      if (c.frostTender && g.frost) ends.push(addDays(frostDates(year).first, finite(g.frostOffset)));
      const custom = monthDayDate(year, c.harvestUntil);
      if (custom) ends.push(custom);
      return minDate(ends);
    }

    // A perennial or established stand shares one identity across season records.
    const turnoverDays = () => Math.max(0, Math.round(finite(settings.turnover, 7)));
    const turnoverFor = p => p && p.turnover != null ? Math.max(0, Math.round(finite(p.turnover, turnoverDays()))) : turnoverDays();
    const isStandingCrop = (p, r) => !!p && (p.established === true || isPerennial((r && r.c) || growingCrop(p)));
    const standKey = p => isStandingCrop(p) ? (p.standId || p.id) : null;
    const standMates = p => { const key = standKey(p); return [p, ...plantingsIn(p.bedId).filter(q => q !== p && standKey(q) === key)]; };
    function standEndDate(p) {
      if (!standKey(p)) return null;
      const models = standMates(p), actual = models.map(clearDateOf).filter(validDate);
      const ends = actual.length ? actual : models.map(q => s2d(q.standEnd)).filter(validDate);
      return ends.length ? minDate(ends) : null;
    }
    function harvestPeriod(c, b, field, p) {
      if (c.micro && isRack(b)) { const first = addDays(field, c.dtm); return { harvestMode: 'window', first, last: first, modeledLast: first, automaticEnd: first, harvestDays: 1, expectedDays: 1, removal: null }; }
      const mode = harvestModeFor(c, null, p), first = addDays(field, c.dtm);
      const automaticEnd = mode === 'season' ? seasonHarvestEnd(c, b, field) : addDays(first, Math.max(0, c.hw - 1));
      const explicit = s2d(p.harvestEnd), modeledLast = validDate(explicit) ? explicit : automaticEnd, removal = standEndDate(p);
      const last = removal && removal < modeledLast ? removal : modeledLast;
      const expectedDays = Math.max(mode === 'season' ? positive(c.yieldDays, positive(c.hw, 1)) : 0, dayDiff(automaticEnd, first) + 1);
      return { harvestMode: mode, first, last, modeledLast, automaticEnd, harvestDays: Math.max(0, dayDiff(last, first) + 1), expectedDays, removal };
    }

    // ── mixed beds: one planting per row range / length block ──
    function bedSplitGeometry(p, b) {
      const x = p && p.bedLayout;
      if (x == null) return null;
      if (!x || typeof x !== 'object' || Array.isArray(x) || x.v !== 1) return { issue: 'unsupported layout' };
      const totalRows = rowsPerBedValue(p.rowsPerBed), physicalLength = Number(p.ft);
      if (!isSoilBed(b) || typeof x.groupId !== 'string' || !x.groupId.trim() || !Number.isInteger(totalRows) || !Number.isInteger(x.rowStart) || x.rowStart < 0
        || !Number.isInteger(x.rowCount) || x.rowCount < 1 || x.rowStart + x.rowCount > totalRows || typeof x.startFt !== 'number' || !Number.isFinite(x.startFt) || x.startFt < 0
        || !Number.isFinite(physicalLength) || physicalLength <= 0 || x.startFt + physicalLength > capOf(b) + 1e-8 || !Number.isFinite(+p.inRow) || +p.inRow <= 0 || !Number.isFinite(+p.rowSp) || +p.rowSp <= 0) return { issue: 'layout out of range' };
      const capacity = x.rowCount * Math.floor((physicalLength * 12 + 1e-8) / +p.inRow);
      if (own(x, 'plantCount') && (!Number.isSafeInteger(x.plantCount) || x.plantCount < 1 || x.plantCount > capacity)) return { issue: 'plant count out of range' };
      return { ...x, totalRows, physicalLength, fraction: x.rowCount / totalRows };
    }
    const splitIntersects = (a, b) => a.rowStart / a.totalRows < (b.rowStart + b.rowCount) / b.totalRows - 1e-9 && b.rowStart / b.totalRows < (a.rowStart + a.rowCount) / a.totalRows - 1e-9
      && a.startFt < b.startFt + b.physicalLength - 1e-9 && b.startFt < a.startFt + a.physicalLength - 1e-9;

    // ── the central calculation ──
    const cache = new Map();
    function calc(p) {
      if (!p || typeof p !== 'object') return null;
      if (cache.has(p)) return cache.get(p);
      let r = sowingOn ? baseOf(p) : calcRaw(p);
      if (r && sowingOn) {
        // as v7's calc does: what is sown replaces the bare plant count. The base record is left as it was.
        const sowing = sowingFor(p, r);
        if (sowing && !sowing.error) r = { ...r, cells: sowing.cells, seeds: sowing.seeds, trays: sowing.trays, sowing };
      }
      cache.set(p, r);
      return r;
    }

    // ── practical sowing: whole rows of a plug tray, and plantings of one variety sown as one batch (v7's nursery-sowing) ──
    const sowingOn = options.sowing !== false && !!Sow;
    const dayText = value => value && validDate(value) ? d2s(value) : '';
    const baseCache = new Map();
    /** The planting before sowing practice is applied: one seed-cell per buffered plant. */
    function baseOf(p) {
      if (baseCache.has(p)) return baseCache.get(p);
      const r = calcRaw(p);
      baseCache.set(p, r);
      return r;
    }
    const nsHarden = () => Math.round(clamp(nonNegative(S.nursery && S.nursery.harden, 7), 0, 21));
    /** When seedlings move out to harden off: so many days before planting, or the day recorded. */
    function hardenStart(r) {
      if (!r || !r.sow || r.tw || r.established || !nsHarden() || r.field <= r.sow) return null;
      const actual = doneOf(r.planting, 'harden');
      return actual ? s2d(actual) : new Date(Math.max(r.sow, addDays(r.field, -nsHarden())));
    }
    // Tower seedlings are sown in the grower's rockwool sheets (98 cubes, 14 rows of 7). v7 counted them in the crop's plug tray; its mode still does.
    const sheet = legacy ? null : Sow && Sow.ROCKWOOL_SHEET;
    const sowOptions = (p, r) => ({ id: p.id, plants: r.plants, crop: r.c, planting: p, settings, nursery: S.nursery, tower: r.tw, rack: r.rack, sheet: r.tw ? sheet : null,
      sowDate: dayText(r.sow), plannedSowDate: dayText(r.plannedSow), fieldDate: dayText(r.field), potUpDate: dayText(potUpDate(r)), hardenDate: dayText(hardenStart(r)) });
    function sowSingle(p, r) {
      const plan = Sow.sowingPlan(sowOptions(p, r));
      if (!plan || plan.error) return plan;
      return { ...plan, batchId: 'individual:' + p.id, batch: plan, memberIds: [p.id], shared: false, allocation: false };
    }
    let sowBuilt = null;
    function sowBuild() {
      const groups = new Map(), plans = new Map(), batches = [];
      for (const p of S.plantings || []) {
        const r = baseOf(p);
        if (!r || r.b.active === false || r.g.active === false) continue;
        const opts = sowOptions(p, r), key = Sow.batchKey(opts, p.id);
        if (!key) continue;
        // sowings planned for different days stay apart even when their recorded dates happen to meet
        const groupKey = JSON.stringify([key, opts.plannedSowDate]);
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push({ p, r, opts });
      }
      for (const [key, members] of groups) {
        const result = Sow.sowingBatch({ members: members.map(x => x.opts) });
        if (result.error) { for (const item of members) plans.set(item.p, sowSingle(item.p, item.r)); continue; }
        const memberIds = members.map(x => x.p.id), shared = members.length > 1, batch = result.plan;
        for (const item of members) {
          const allocation = result.members.find(x => x.id === item.p.id);
          plans.set(item.p, { ...batch, ...allocation, batchId: key, batch, memberIds, shared, allocation: shared, targetPlants: allocation.plants, extraCells: Math.max(0, allocation.cells - allocation.minimumCells) });
        }
        batches.push({ id: key, plan: batch, memberIds, members: members.map(x => ({ p: x.p, r: x.r })) });
      }
      if (shareTrays) shareOut(batches, plans);
      return (sowBuilt = { plans, batches, known: new Set(S.plantings || []) });
    }
    /**
     * Varieties of one crop sown the same day into the same kind of tray stand in the same trays. (v7 gives every variety
     * whole trays of its own.) Each variety still fills whole rows; the trays are counted once for the lot and shared out
     * by cells, so four varieties taking 24 rows of a 16-row tray hold two trays, not four. Seeds and cells do not change.
     *
     * Rockwool for the towers is freer still. A sheet is perforated, so any crops sown the same day share it (basil beside
     * lettuce), and they need not leave for the towers on the same day. Every sheet, whole or part, rides in one open
     * 10 × 20 tray, which is the room it takes on the bench.
     */
    const shareTrays = sowingOn && !legacy && !(S.lrfNext && S.lrfNext.trays === 'variety');
    function shareOut(batches, plans) {
      const groups = new Map();
      for (const b of batches) {
        const plan = b.plan;
        if (!plan || plan.legacy || plan.medium === 'pots' || !plan.cells) continue;
        let outer;
        try { outer = JSON.parse(b.id); } catch (_) { continue; }
        if (!Array.isArray(outer) || typeof outer[0] !== 'string' || outer[0][0] !== '[') continue;   // a planting that stands alone has no dates to match on
        const inner = JSON.parse(outer[0]), wool = plan.medium === 'rockwool';
        // rockwool: the sowing day and the sheet, nothing else has to match. Plug trays: everything that makes a batch, except the variety.
        const key = JSON.stringify([wool ? ['rockwool', inner[2], ...inner.slice(8, 14)] : inner.filter((_, i) => i !== 1), outer[1]]);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(b);
      }
      for (const [id, list] of groups) {
        if (list.length < 2) continue;
        const tray = list[0].plan.tray, cells = list.reduce((n, b) => n + b.plan.cells, 0), trays = Math.ceil(cells / tray.cells), area = tray.widthIn * tray.lengthIn;
        const wool = list[0].plan.medium === 'rockwool';
        const group = { id, tray, cells, trays, eq: trays * area / Sow.STANDARD_AREA_IN2, ft2: trays * area / 144, apart: list.reduce((n, b) => n + b.plan.trays, 0),
          medium: list[0].plan.medium, crops: new Set(list.map(b => b.members[0].r.c.id)).size, carriers: wool ? trays : 0,
          parts: list.map(b => ({ batchId: b.id, first: b.memberIds[0], cells: b.plan.cells, rows: b.plan.rowsSown })) };
        for (const b of list) {
          const own = b.plan, share = own.cells / cells;
          b.plan = { ...own, trays: trays * share, eq: group.eq * share, ft2: group.ft2 * share, ownTrays: own.trays, trayGroup: group };
          for (const m of b.members) {
            const mine = plans.get(m.p), part = own.cells ? mine.cells / own.cells : 0;
            plans.set(m.p, { ...mine, batch: b.plan, trays: b.plan.trays * part, eq: b.plan.eq * part, ft2: b.plan.ft2 * part, traySpace: b.plan.eq * part, trayGroup: group });
          }
        }
      }
    }
    /** A planting's sowing: its share of a shared batch, or its own when it is not in the plan or stands alone. */
    function sowingFor(p, r) {
      const built = sowBuilt || sowBuild();
      if (!built.known.has(p)) return sowSingle(p, r);
      return built.plans.get(p) || sowSingle(p, r);
    }
    /** Every sowing batch in the plan: the rounded plan, and the plantings it is raised for. */
    const sowingBatches = () => sowingOn ? (sowBuilt || sowBuild()).batches : [];
    function plannedOutDate(p, r) {
      const b = r.b, sh = b.shelter;
      if (!shelterValid(b)) return null;
      if (p.out) return validDate(s2d(p.out)) ? s2d(p.out) : null;
      const field = r.planned || r.field, g = gardenOf(b), dt = monthDayDate(field.getFullYear(), sh.until || (g && g.open) || settings.frostLast);
      return dt && dt > field ? dt : null;
    }
    const outDate = (p, r) => { const actual = doneOf(p, 'move'); return actual ? s2d(actual) : plannedOutDate(p, r); };

    function calcRaw(p) {
      const b = plantingBed(p), c = effective(p);
      if (!b || !c || !p.date || !validDate(s2d(p.date))) return null;
      const g = gardenOf(b) || {};
      const planned = s2d(p.date), field = s2d(fieldDateOf(p));
      const inRow = positive(p.inRow, positive(c.inRow, 12)), rowSp = positive(p.rowSp, positive(c.rowSp, 12));
      const germ = clamp(positive(c.germ, positive(settings.germ, 85)), 0.1, 100) / 100, buffer = 1 + nonNegative(settings.buffer) / 100;
      const tw = isTower(b), rack = isRack(b), ct = isCt(b), physicalLength = lenOf(p, b);
      const split = bedSplitGeometry(p, b), layout = split && !split.issue ? split : null, len = layout ? physicalLength * layout.fraction : physicalLength;
      let rows = 1, plants, seeds, trays = 0, cells = 0, gh = null, seedG = 0, bulbs = 0;
      const plugNeeds = () => { cells = Math.ceil(plants * buffer); seeds = Math.ceil(cells * positive(c.spc, 1) / germ); trays = Math.ceil(cells / positive(c.tray, 72)); };

      if (rack) { plants = len; seedG = len * (c.seedG || 0); seeds = 0; }
      else if (ct) {
        plants = len * positive(p.perC, positive(ctOf(b).plants, 1));
        if (c.method === 'TP') { plugNeeds(); gh = c.gh > 0 ? addDays(planned, -7 * c.gh) : null; } else seeds = Math.ceil(plants / germ);
      } else if (tw) {
        plants = usedSites(p, b, c); plugNeeds(); gh = c.ghDays > 0 ? addDays(planned, -c.ghDays) : null;
      } else {
        const chosen = rowsPerBedValue(own(p, 'rowsPerBed') ? p.rowsPerBed : c.rowsPerBed);
        rows = layout ? layout.rowCount : Number.isFinite(chosen) ? chosen : Math.max(1, Math.floor(b.w * 12 / rowSp));
        const fixedCount = layout && own(layout, 'plantCount');
        plants = fixedCount ? layout.plantCount : rows * Math.floor(physicalLength * 12 / inRow);
        if (c.method === 'TP') { plugNeeds(); gh = c.gh > 0 ? addDays(planned, -7 * c.gh) : null; }
        else seeds = fixedCount ? Math.ceil(plants / germ) : c.seedsFt ? Math.ceil(rows * physicalLength * c.seedsFt) : Math.ceil(plants / germ);
      }
      if (c.material === 'bulb' && !tw && !rack) { bulbs = Math.ceil(plants); seeds = 0; seedG = 0; cells = 0; trays = 0; gh = null; }
      if (p.established === true) { seeds = 0; seedG = 0; cells = 0; trays = 0; bulbs = 0; gh = null; }
      // Not in v7: the day a transplant is sown can be set by hand. It holds while it falls before the day the planting goes out.
      const sowDefault = gh, sowOwn = gh && typeof p.sowOn === 'string' && validDate(s2d(p.sowOn)) && s2d(p.sowOn) < planned ? s2d(p.sowOn) : null;
      const plannedGh = sowOwn || gh; gh = plannedGh ? sowDateOf(p, plannedGh) : null;

      const period = harvestPeriod(c, b, field, p), { first } = period;
      const actualClear = clearDateOf(p), failure = p.workflow && p.workflow.outcome === 'failed' ? s2d(p.workflow.failureDate) : null;
      let last = period.last;
      if (validDate(failure) && failure < last) last = failure;
      if (actualClear && actualClear < last) last = actualClear;
      const harvestDays = Math.max(0, dayDiff(last, first) + 1), days = Math.max(1, dayDiff(last, field) + 1);
      const blackoutDays = last >= first ? blackoutOverlapDays(c, first, last, { summerOK: c.summerOK }, g) : 0;
      const result = {
        planting: p, b, g, c, tw, rack, ct, kind: tw ? 'tower' : rack ? 'bench' : ct ? 'containers' : 'bed',
        established: p.established === true, layout, physicalLength, len, cap: capOf(b), partial: !tw && len < capOf(b),
        rows, totalRows: layout ? layout.totalRows : rows, inRow, rowSp, plants, seeds, seedG, bulbs, cells, trays,
        usedSites: tw ? plants : null, totalSites: tw ? sites(b) : null,
        planned, field, sow: gh, plannedSow: plannedGh, sowDefault, sowSet: !!sowOwn, start: gh || field, slip: dayDiff(field, planned),
        first, last, modeledLast: period.modeledLast, automaticEnd: period.automaticEnd, harvestMode: period.harvestMode,
        harvestDays, expectedHarvestDays: period.expectedDays, removal: period.removal, actualClear,
        area: tw || rack || ct ? 0 : (+b.w || 0) * len, days, blackoutDays,
        occupiedDays: actualClear ? Math.max(1, dayDiff(actualClear, field) + 1) : days + turnoverFor(p)
      };
      result.out = outDate(p, result);
      if (sameDayTowerCycle(p, result) && (!actualClear || actualClear <= last)) result.occupiedDays = Math.max(1, dayDiff(last, field));
      return result;
    }

    // ── occupancy: when and how much of a space a planting holds ──
    function sameDayTowerCycle(p, r) {
      const cyc = p.towerCycle;
      return r.tw && !!cyc && cyc.v === 1 && cyc.replantSameDay === true && Number.isInteger(cyc.days) && cyc.days > 0 && p.harvestMode === 'window' && +p.hw === 1 && turnoverFor(p) === 0 && r.harvestDays === 1;
    }
    function occupancyFrom(p, r) {
      if (p.established !== true) return r.field;
      const models = standMates(p), actual = models.map(q => s2d(doneOf(q, 'field') || (q.established !== true ? fieldDateOf(q) : null))).filter(validDate);
      if (actual.length) return minDate(actual);
      const dates = models.map(q => s2d(q.date)).filter(validDate), first = dates.length ? minDate(dates) : r.field;
      return new Date(first.getFullYear(), 0, 1);
    }
    /** Last day the space is held, turnover days included. Infinity = open-ended stand. */
    function occupancyThrough(p, r) {
      if (r.rack && r.c.micro) { const end = addDays(r.first, -1), clear = clearDateOf(p); return clear && clear < end ? clear : end; }
      if (p.workflow && p.workflow.outcome === 'failed') {
        const shared = isStandingCrop(p, r) ? standMates(p).map(clearDateOf).filter(validDate) : [];
        const cleared = clearDateOf(p) || (shared.length ? minDate(shared) : null);
        if (!cleared) return Infinity;
        return p.established === true ? cleared : new Date(Math.max(r.field, cleared));
      }
      if (isStandingCrop(p, r)) {
        const end = standEndDate(p);
        if (!end) return Infinity;
        const cleared = standMates(p).some(q => doneOf(q, 'flip') === d2s(end));
        return cleared ? end : addDays(end, turnoverFor(p));
      }
      const cleared = clearDateOf(p);
      if (sameDayTowerCycle(p, r) && (!cleared || cleared <= r.last)) return new Date(Math.max(r.field, addDays(r.last, -1)));
      return cleared ? new Date(Math.max(r.field, cleared)) : addDays(new Date(Math.max(r.field, r.last)), turnoverFor(p));
    }
    /** Plantings standing in a bed on a date (turnover days are not shown as crop). */
    function cropsAt(bedId, date) {
      const matches = plantingsIn(bedId).map(p => ({ p, r: calc(p) })).filter(({ p, r }) => {
        if (!r || !(occupancyFrom(p, r) <= date)) return false;
        if (p.established === true && r.planned.getFullYear() > date.getFullYear()) return false;
        const until = (r.rack && r.c.micro) || (p.workflow && p.workflow.outcome === 'failed') ? occupancyThrough(p, r)
          : isStandingCrop(p, r) ? (standEndDate(p) || Infinity) : (clearDateOf(p) || r.last);
        return date <= until;
      }).sort((a, b) => b.r.field - a.r.field);
      const seen = new Set();
      return matches.filter(({ p, r }) => {
        if (sameDayTowerCycle(p, r) && occupancyThrough(p, r) < date && matches.some(({ p: q, r: x }) => q.id !== p.id && x.field >= r.last)) return false;
        const key = standKey(p);
        if (key && seen.has(key)) return false;
        if (key) seen.add(key);
        return true;
      }).map(x => x.r).sort((a, b) => b.len - a.len || b.field - a.field);
    }
    // When each planting holds its space, worked out once per space: a crate group or a bench can hold a hundred plantings,
    // and every one of them is asked about every other.
    const heldCache = new Map();
    function heldIn(b) {
      let list = heldCache.get(b.id);
      if (list) return list;
      list = [];
      for (const q of plantingsIn(b.id)) {
        const r = calc(q);
        if (r) list.push({ p: q, r, field: occupancyFrom(q, r), last: occupancyThrough(q, r), len: r.tw ? capOf(b) : r.len, key: standKey(q) });
      }
      heldCache.set(b.id, list);
      return list;
    }
    function occupants(b, ignoreId, extra) {
      const ignore = plantingById.get(ignoreId), ignoreStand = ignore ? standKey(ignore) : null, byStand = new Map(), out = [];
      for (const held of heldIn(b)) {
        if (held.p.id === ignoreId || (ignoreStand && held.key === ignoreStand)) continue;
        const x = { p: held.p, r: held.r, field: held.field, last: held.last, len: held.len }, key = held.key;
        if (key) {
          const prev = byStand.get(key);
          if (prev) { prev.field = new Date(Math.min(prev.field, x.field)); prev.last = Math.max(prev.last, x.last); prev.len = Math.max(prev.len, x.len); }
          else { byStand.set(key, x); out.push(x); }
        } else out.push(x);
      }
      for (const rest of b.restPeriods || []) {
        if (rest.active !== false && validDate(s2d(rest.from)) && validDate(s2d(rest.to)) && rest.to >= rest.from) out.push({ field: s2d(rest.from), last: s2d(rest.to), len: capOf(b), rest: true });
      }
      for (const x of extra || []) if (x.bedId === b.id) out.push({ ...x, last: x.last === Infinity ? Infinity : addDays(x.last, turnoverFor(x)) });
      return out;
    }
    /** Free capacity of a space over [from, to] (bed-feet, trays or containers), ignoring one planting. */
    function roomFor(b, from, to, ignoreId, extra, candidateTurnover) {
      if (!b || !validDate(from) || (to !== Infinity && !validDate(to)) || to < from) return 0;
      const ignore = plantingById.get(ignoreId);
      const proposed = candidateTurnover == null ? (doneOf(ignore, 'flip') ? 0 : turnoverFor(ignore)) : Math.max(0, Math.round(finite(candidateTurnover)));
      const through = to === Infinity ? Infinity : addDays(to, proposed);
      const oc = occupants(b, ignoreId, extra).filter(x => x.field <= through && x.last >= from);
      if (isTower(b)) return oc.length ? 0 : capOf(b);
      const L = capOf(b);
      if (!oc.length) return L;
      if (!(ignore && ignore.bedLayout) && plantingsIn(b.id).some(q => { if (q.id === ignoreId || !q.bedLayout) return false; const r = calc(q); return r && r.field <= through && occupancyThrough(q, r) >= from; })) return 0;
      // The fullest moment is at the start or on a day something else arrives. Dates are compared as numbers: with a hundred
      // plantings in one group of crates this runs a million times.
      const n = oc.length, a = new Array(n), z = new Array(n), F = +from, T = +through;
      for (let i = 0; i < n; i++) { a[i] = +oc[i].field; z[i] = +oc[i].last; }
      const heldAt = t => { let sum = 0; for (let i = 0; i < n; i++) if (a[i] <= t && z[i] >= t) sum += oc[i].len; return sum; };
      let min = Math.min(L, L - heldAt(F));
      for (let i = 0; i < n; i++) if (a[i] > F && a[i] <= T) min = Math.min(min, L - heldAt(a[i]));
      return min;
    }
    function overlap(p, q) {
      if (p.bedId !== q.bedId || p.id === q.id || (standKey(p) && standKey(p) === standKey(q))) return false;
      const a = calc(p), b = calc(q);
      if (!a || !b) return false;
      return occupancyFrom(p, a) <= occupancyThrough(q, b) && occupancyFrom(q, b) <= occupancyThrough(p, a);
    }
    function splitOverlaps(p, r) {
      if (!r || !r.layout) return [];
      return plantingsIn(p.bedId).filter(q => {
        if (q === p || q.id === p.id) return false;
        const t = calc(q);
        return t && t.layout && t.field <= occupancyThrough(p, r) && occupancyThrough(q, t) >= r.field && splitIntersects(r.layout, t.layout);
      });
    }

    // ── planning flags ──
    /** @returns {{k:string,t:string}[]} k = field | frost | closed | season | rotation | overlap | timing | outcome */
    function warnings(p, r) {
      r = r || calc(p);
      if (!r) return [];
      const out = [], g = r.g || {}, od = outDate(p, r), covered = !!od, year = r.field.getFullYear();
      const category = fieldSeasonFor(r.c), firstField = firstFieldDate(r.c, r.b, year, p), coverAdvance = rowCoverAdvance(p, r.b, r.c);
      if (!p.established && g.type === 'field' && (category !== 'none' || validMonthDay(r.c.firstSafeField)) && firstField && r.field < firstField && !(covered && od >= firstField)) {
        out.push({ k: 'field', t: `${validMonthDay(r.c.firstSafeField) ? 'Crop-specific' : category === 'warm' ? 'Warm-season' : 'Cool-season'} field planting starts ${d2s(firstField)} here; this goes in ${d2s(r.field)}.` });
      }
      const outdoorField = shelterValid(r.b) && (isTower(r.b) || isCt(r.b)) ? outDate(p, r) || r.field : r.field, lastOutdoor = lastFieldDate(r.c, r.b, outdoorField.getFullYear());
      if (!p.established && lastOutdoor && outdoorField > lastOutdoor) out.push({ k: 'field', t: `Outdoor planting ends ${d2s(lastOutdoor)}; this goes in ${d2s(outdoorField)}.` });
      if (p.workflow && p.workflow.outcome === 'failed') out.push({ k: 'outcome', t: `Crop failure recorded ${p.workflow.failureDate}.` });
      else if (!isCoverCrop(r.c) && r.harvestDays === 0) out.push({ k: 'timing', t: `First harvest (${d2s(r.first)}) falls after the harvest period ends (${d2s(r.last)}).` });
      if (!isCoverCrop(r.c) && r.harvestMode === 'season' && r.harvestDays > 0 && r.harvestDays < positive(r.c.yieldDays, positive(r.c.hw, 1))) {
        out.push({ k: 'season', t: `Only ${r.harvestDays} harvest days remain of a ${r.expectedHarvestDays}-day season; yield is reduced in proportion.` });
      }
      if (!isCoverCrop(r.c) && p.harvestEnd && r.harvestMode === 'season' && r.last > r.automaticEnd) out.push({ k: 'season', t: `Harvest end ${d2s(r.last)} runs past the automatic season end ${d2s(r.automaticEnd)}.` });
      if (r.c.frostTender && g.frost) {
        const exposed = od && od > r.field ? od : r.field;
        if (exposed <= r.last) {
          const off = finite(g.frostOffset), spring = addDays(frostDates(exposed.getFullYear()).last, -off - coverAdvance);
          if (exposed < spring) out.push({ k: 'frost', t: `Goes out ${d2s(exposed)}, before the last-frost planning date ${d2s(spring)} in ${g.name}.` });
          const fall = addDays(frostDates(r.last.getFullYear()).first, off);
          if (r.last > fall) out.push({ k: 'frost', t: `Harvest runs past the first frost (${d2s(fall)}).` });
        }
      }
      const win = gWindow(g, year);
      if (win.open && r.field < win.open && !(covered && od >= win.open)) out.push({ k: 'closed', t: `${g.name} opens ${d2s(win.open)}; this goes in ${d2s(r.field)}.` });
      const winEnd = gWindow(g, r.last.getFullYear()).close;
      if (winEnd && r.last > winEnd) out.push({ k: 'closed', t: `${g.name} closes ${d2s(winEnd)}; harvest runs to ${d2s(r.last)}.` });
      if (r.blackoutDays > 0) out.push({ k: 'season', t: `${r.blackoutDays} of ${dayDiff(r.last, r.first) + 1} harvest days fall in ${r.c.name}'s summer gap; expect bolting or bitterness.` });

      const ct = r.c.catalogTiming;
      if (ct && ct.inferredBasis && ct.conversion === 'seed-minus-nursery') {
        out.push({ k: 'model', t: `Maturity is a guess: the supplier prints ${ct.printed} days without saying from when. Its page text mentions sowing, so ${ct.nurseryDays} nursery days were subtracted, leaving ${ct.baseDays}. Confirm the starting point for this variety.` });   // v7's wording, kept for the parity check
      }
      const prev = plantingsIn(p.bedId).filter(q => q.id !== p.id).map(q => ({ q, x: calc(q) })).filter(x => x.x && x.x.field < r.field).sort((a, b) => b.x.field - a.x.field)[0];
      const years = settings.rotationYears || 3;
      if (prev && !r.tw && !r.rack && !r.ct && prev.x.c.family === r.c.family && prev.x.c.id !== r.c.id && prev.x.c.family !== 'Cover crop' && dayDiff(r.field, prev.x.field) < 365 * years) {
        out.push({ k: 'rotation', t: `${r.c.family} follows ${prev.x.c.name} (${d2s(prev.x.field)}) in this bed within ${years} years.` });
      }
      if (!r.tw) {
        const room = roomFor(r.b, occupancyFrom(p, r), occupancyThrough(p, r), p.id, null, 0), u = capUnit(r.b);
        if (room < r.len - 0.01) out.push({ k: 'overlap', t: room <= 0 ? `Overlaps another planting here (turnover days count).` : `Only ${Math.max(0, Math.floor(room))} ${u} free while these ${+r.len.toFixed(2)} ${u} are in use.` });
      } else if (plantingsIn(p.bedId).some(q => overlap(p, q))) out.push({ k: 'overlap', t: 'Overlaps another planting in this tower.' });
      if (r.layout && splitOverlaps(p, r).length && !out.some(w => w.k === 'overlap')) out.push({ k: 'overlap', t: 'Row/block allocations overlap in the bed.' });
      return out;
    }

    // ── footprints and guard rails ──
    // v7 only added lengths up. Here a planting in a soil bed covers a rectangle:
    // feet along the bed and a share of its width. Two plantings collide when they
    // hold the same ground at the same time. Benches and container groups still
    // share by count; a tower is held whole.
    function footprint(p, r) {
      if (!r || !isSoilBed(r.b)) return null;
      if (r.layout) {
        const y = r.layout;
        return { a0: y.startFt, a1: y.startFt + r.physicalLength, x0: y.rowStart / y.totalRows, x1: (y.rowStart + y.rowCount) / y.totalRows, rows: { start: y.rowStart, count: y.rowCount, total: y.totalRows } };
      }
      const len = r.physicalLength, a0 = len >= r.cap - 1e-6 ? 0 : Math.max(0, finite(p.startFt));
      return { a0, a1: a0 + len, x0: 0, x1: 1, rows: null };
    }
    const rectsCross = (f, g) => f.a0 < g.a1 - 1e-6 && g.a0 < f.a1 - 1e-6 && f.x0 < g.x1 - 1e-6 && g.x0 < f.x1 - 1e-6;
    /**
     * Bench room is shown as a load and never enforced. So nothing is ever "too long" or "booked twice" on the stand-in space
     * live trays are filed under, on a bench that has no tray count of its own (a stand-in by another name), or for a tray
     * batch made from weekly demand wherever it stands.
     */
    const unbounded = (p, b) => isPool(b) || (isRack(b) && (!(capOf(b) > 0) || !!(p && p.liveTray)));
    /** Does a planting ask for more than its space holds? */
    function overflow(p, r) {
      if (!r || r.tw || unbounded(p, r.b)) return false;
      const f = footprint(p, r);
      return f ? f.a1 > r.cap + 1e-6 : r.len > r.cap + 1e-6;
    }
    /** Everything that holds part of a space at some point in [from, through], and the part it holds. */
    function holders(b, from, through, ignoreId) {
      const ignore = plantingById.get(ignoreId), ignoreStand = ignore ? standKey(ignore) : null, out = [], cap = capOf(b);
      for (const held of heldIn(b)) {
        if (held.p.id === ignoreId || (ignoreStand && held.key === ignoreStand)) continue;
        if (held.field <= through && held.last >= from) out.push({ p: held.p, r: held.r, from: held.field, through: held.last, rect: footprint(held.p, held.r), len: held.len });
      }
      for (const rest of b.restPeriods || []) {
        const a = s2d(rest.from), z = s2d(rest.to);
        if (rest.active !== false && validDate(a) && validDate(z) && z >= a && a <= through && z >= from) out.push({ rest: true, from: a, through: z, rect: { a0: 0, a1: cap, x0: 0, x1: 1, rows: null }, len: cap });
      }
      return out;
    }
    /** What a planting, saved or proposed, collides with. */
    function conflicts(p, r) {
      r = r || calc(p);
      if (!r || unbounded(p, r.b)) return [];
      const from = occupancyFrom(p, r), through = occupancyThrough(p, r), others = holders(r.b, from, through, p.id);
      if (!others.length || r.tw) return others;
      const mine = footprint(p, r);
      if (mine) return others.filter(o => rectsCross(mine, o.rect));
      return roomFor(r.b, from, through, p.id, null, 0) >= r.len - 0.01 ? [] : others;
    }
    /** Work out a planting that is not in the plan (yet), without caching it. */
    const evaluate = draft => calcRaw(draft);
    /** Check a proposed planting against the guard rails. */
    function fit(draft) {
      const r = calcRaw(draft);
      if (!r) return { ok: false, r: null, blockers: [], over: false };
      const blockers = conflicts(draft, r), over = overflow(draft, r);
      return { ok: !blockers.length && !over, r, from: occupancyFrom(draft, r), through: occupancyThrough(draft, r), blockers, over, rect: footprint(draft, r) };
    }
    /** Occupied length and free length of a space on one date. */
    function bedStatus(b, date) {
      const here = cropsAt(b.id, date), cap = capOf(b);
      const used = isTower(b) ? (here.length ? cap : 0) : Math.min(cap, here.reduce((a, r) => a + (r.len || 0), 0));
      // Turnover days after the last harvest still hold the bed.
      const resting = !here.length && plantingsIn(b.id).some(p => { const r = calc(p); return r && occupancyFrom(p, r) <= date && date <= occupancyThrough(p, r); });
      return { crops: here, cap, used, free: Math.max(0, cap - used), resting };
    }
    // ── heated bench room in use: v7's nursery load ──
    const ctFt2 = ct => { const [w, l] = ctDims(ct); return w * l; };
    function potUpDate(r) {
      if (!r || !r.sow || r.c.prop !== 'potup' || r.tw || r.established) return null;
      const actual = doneOf(r.planting, 'potup');
      return actual ? s2d(actual) : addDays(r.sow, Math.round(Math.max(0, finite(r.c.potUpWk, 2)) * 7));
    }
    /**
     * What one planting's seedlings take up on a date: trays, or carriers of pots once potted up.
     * A planting in a shared batch takes its share of the batch's whole trays or whole carriers.
     */
    function propOf(r, date) {
      if (!r || !r.sow || !r.cells) return null;
      const c = r.c, pd = potUpDate(r), plan = r.sowing, pot = !r.tw && (c.prop === 'pot' || (c.prop === 'potup' && (!date || (pd && date >= pd))));
      if (pot) {
        const per = Math.max(1, Math.round(positive(c.perCarrier, 10))), size = positive(c.potSize, 4.5), cells = plan && plan.potUpCells != null ? plan.potUpCells : r.cells;
        const batchCells = plan && plan.batch && plan.batch.potUpCells != null ? plan.batch.potUpCells : cells;
        const n = plan && plan.shared && batchCells ? Math.ceil(batchCells / per) * cells / batchCells : Math.ceil(cells / per), ft2 = n * size * size * per / 144;
        return { kind: 'pot', n, eq: ft2 / TRAY_FT2, ft2 };
      }
      const n = plan && plan.trays != null ? plan.trays : (r.trays || Math.ceil(r.cells / positive(c.tray, 72)));
      return { kind: r.tw ? 'rockwool' : 'tray', n, eq: plan && plan.eq != null ? plan.eq : n, ft2: plan && plan.ft2 != null ? plan.ft2 : n * TRAY_FT2 };
    }
    let benchItemsCache = null;
    /** Everything that stands on a heated bench at some time: live trays, seedlings, and crates sheltered until they move out. */
    function benchItems() {
      if (benchItemsCache) return benchItemsCache;
      const items = [];
      for (const p of S.plantings) {
        const r = calc(p);
        if (!r || r.b.active === false || r.g.active === false) continue;
        const failure = p.workflow && p.workflow.outcome === 'failed' ? s2d(p.workflow.failureDate) : null, propEnd = validDate(failure) && failure < r.field ? failure : r.field;
        if (r.rack && r.c.micro && r.b.liveTrayPool) { const to = addDays(occupancyThrough(p, r), 1); if (to > r.field) items.push({ p, r, kind: 'live', from: r.field, to, n: r.len, eq: r.len }); }
        if (r.sow && r.cells && r.sow < propEnd) items.push({ p, r, kind: 'prop', from: r.sow, to: propEnd });
        if (r.ct && r.b.shelter && r.b.shelter.gardenId === 'nursery' && r.out && r.out > r.field) {
          const to = r.actualClear && r.actualClear < r.out ? addDays(r.actualClear, 1) : r.out;
          if (to > r.field) items.push({ p, r, kind: 'crate', from: r.field, to, n: r.len, eq: r.len * ctFt2(ctOf(r.b)) / TRAY_FT2, floor: !cratesOnBenches });
        }
      }
      return (benchItemsCache = items);
    }
    /** Heated bench room on one day, in tray spaces: what is there by kind, the total, and what the benches hold. */
    function benchDay(date) {
      const row = { date: new Date(date), cap: heatedTraySpaces(), live: 0, crate: 0, tray: 0, pot: 0, rockwool: 0, total: 0, floorCrates: 0, items: [] };
      for (const it of benchItems()) {
        if (date < it.from || date >= it.to) continue;
        if (it.floor) { row.floorCrates += it.n; continue; }   // under cover, but standing on the floor: no bench room
        const u = it.kind === 'prop' ? propOf(it.r, date) : { kind: it.kind, n: it.n, eq: it.eq };
        if (!u) continue;
        row[u.kind] += u.eq; row.total += u.eq; row.items.push({ p: it.p, r: it.r, kind: u.kind, n: u.n, eq: u.eq });
      }
      row.over = Math.max(0, row.total - row.cap);
      return row;
    }
    /**
     * The trays themselves, on one day: plug trays by kind, the open 10 × 20 trays that carry rockwool sheets, and live trays.
     * A lot counts whole trays for as long as any of it is still in the nursery; once seedlings are potted up they are in pots.
     */
    function traysOn(date) {
      const plug = new Map(), lots = new Map();
      let carriers = 0, live = 0;
      for (const it of benchItems()) {
        if (date < it.from || date >= it.to) continue;
        if (it.kind === 'live') { live += it.n; continue; }
        if (it.kind !== 'prop') continue;
        const u = propOf(it.r, date), plan = it.r.sowing;
        if (!u || u.kind === 'pot') continue;
        const tray = plan && plan.tray, key = plan && plan.trayGroup ? plan.trayGroup : plan && plan.batchId ? plan.batchId : it.p.id;
        const lot = lots.get(key) || { n: 0, wool: u.kind === 'rockwool', name: tray ? tray.name : `${positive(it.r.c.tray, 72)}-cell plug tray`, id: tray ? tray.id : 'tray-' + positive(it.r.c.tray, 72) };
        lot.n += u.n; lots.set(key, lot);
      }
      for (const lot of lots.values()) {
        const n = Math.ceil(lot.n - 1e-9);
        if (lot.wool) carriers += n; else { const row = plug.get(lot.id) || { id: lot.id, name: lot.name, n: 0 }; row.n += n; plug.set(lot.id, row); }
      }
      return { date: new Date(date), plug: [...plug.values()].sort((a, b) => b.n - a.n), carriers, live, flats: carriers + live };
    }

    // ── what a planting is expected to yield (v7's own arithmetic) ──
    const cropUnits = () => (S.cropUnits && typeof S.cropUnits === 'object' ? S.cropUnits : {});
    /** The unit a crop is counted and sold in: trays for microgreens, else the farm's own unit for it, else the crop's. */
    const unitOf = c => !c ? 'each' : c.micro ? 'tray' : String((cropUnits()[c.id] && cropUnits()[c.id].base) || c.baseUnit || 'each');
    /**
     * Marketable yield of one planting over its whole harvest: how many of what it is counted by (plants, bed-feet, trays,
     * containers) × yield each × the marketable share × the part of the expected harvest period that is really there.
     * Live trays are sown to order, so a tray sown is a tray to sell: no share is taken off.
     */
    function yieldOf(p, r) {
      r = r || calc(p);
      if (!r || isCoverCrop(r.c)) return null;
      const c = r.c, own = p.yield != null && p.yield !== '', per = nonNegative(own ? p.yield : c.yield), liveTray = r.rack && !!c.micro;
      const basis = r.rack ? 'tray' : r.ct ? (p.yieldBasis === 'container' ? 'container' : 'plant') : c.yBasis === 'ft' && !r.tw ? 'ft' : 'plant';
      const count = basis === 'tray' || basis === 'container' || basis === 'ft' ? r.len : r.plants;
      // v7 took nothing from a harvest day inside a crop's "summer gap". The planner no longer second-guesses the plan that way:
      // what is planted to be picked in July counts in July. The v7 parity mode keeps the gap.
      const mk = liveTray ? 1 : clamp(finite(c.mk, 0.9), 0, 1), part = clamp((r.harvestDays - (legacy ? r.blackoutDays : 0)) / Math.max(1, r.expectedHarvestDays), 0, 1);
      const each = liveTray ? 1 : per, set = liveTray || (c.yield != null && c.yield !== '' && Number.isFinite(+c.yield)) || own;
      return { basis, count, per: each, mk, part, units: count * each * mk * part, unit: unitOf(c), set, own, price: p.price != null && p.price !== '' ? nonNegative(p.price) : nonNegative(c.price) };
    }
    /** Is this a day the crop is picked? Any day of its harvest period (in the v7 parity mode, not the days in its summer gap). */
    const pickedOn = (r, date) => date >= r.first && date <= r.last && (!legacy || blackoutOverlapDays(r.c, date, date, { summerOK: r.c.summerOK }, r.g) === 0);

    const benchList = () => benches().map(sp => ({ id: sp.id, name: sp.name || 'Bench', area: (((S.nursery || {}).benchAreas || []).find(a => a.id === (sp.benchLayout || {}).areaId) || {}).name || '', w: nonNegative(sp.w), l: nonNegative(sp.l), heated: sp.kind !== 'outside', active: sp.active !== false, cap: benchCap(sp) }));

    function nextPlanting(bedId, date) {
      return plantingsIn(bedId).map(calc).filter(r => r && r.field > date).sort((a, b) => a.field - b.field)[0] || null;
    }

    return {
      plan: S, settings, lib,
      crops: () => cropList, crop, variety, cropColor, isCoverCrop, isPerennial,
      varietiesOf: cropId => (S.varieties || []).filter(v => v.cropId === cropId && v.active !== false && !v.deleted).sort((a, b) => String(a.name).localeCompare(String(b.name))),
      bedOf, gardenOf, isTower, isRack, isCt, isSoilBed, isPool, spaceKind, capOf, capUnit, ctOf, ctDims, sites,
      heatedTraySpaces, benchList, benchItems, benchDay, traysOn, cratesOnBenches, propOf, potUpDate, hardenStart,
      yieldOf, unitOf, pickedOn, fieldPlantingWindow, gWindow, fieldSeasonFor, isStandingCrop,
      sowingBatches, sowingOn, shareTrays, base: baseOf,
      plantingsIn, planting: id => plantingById.get(id),
      effective, ENVS, envOf, timingFor, pinned, startRule, startFixed, startHint, STARTS, START_LESS, calc, evaluate, warnings, cropsAt, bedStatus, nextPlanting, roomFor, overlap, fit,
      footprint, overflow, unbounded, holders, conflicts,
      occupancyFrom, occupancyThrough, turnoverFor, frostDates, firstFieldDate, lastFieldDate, standKey
    };
  }

  return { create, s2d, d2s, addDays, dayDiff, validDate, monthDayDate, basisFromText, shade, hexToHsl, hslToHex, rowsPerBedValue, DONE_KINDS };
});
