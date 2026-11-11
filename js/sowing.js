/* Little River Farm Planner — practical sowing: plug trays, complete rows, and batches shared by plantings.
 *
 * A transplanted crop is not sown one seed per plant wanted. The grower fills whole rows of a plug tray,
 * allowing for germination and a buffer, and plantings of one variety with one schedule are sown together
 * and rounded once. This is v7's own model (its nursery-trays module), carried over function for function
 * so that cells, seeds, trays and bench room come out as v7 shows them; tests/parity.cjs holds the two
 * side by side on every planting.
 *
 *   buffered plants = ceil(plants × (100 + buffer) / 100)
 *   minimum cells   = ceil(buffered plants / germination)
 *   cells sown      = minimum cells rounded up to the chosen increment (complete rows unless set otherwise)
 *   seeds           = ceil(cells sown × seeds per cell)
 *   trays held      = ceil(cells sown / cells per tray): a part-filled tray still takes a whole tray's room
 *
 * A sowing row is a row of cells in a tray, never a row in a bed. Nothing here touches the page or the plan.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LRFSowing = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  const blank = value => value == null || (typeof value === 'string' && !value.trim());
  const number = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(+value) ? +value : null;
  const positive = value => { const n = number(value); return n != null && n > 0 && n <= Number.MAX_SAFE_INTEGER ? n : null; };
  const integer = value => { const n = positive(value); return Number.isSafeInteger(n) ? n : null; };
  const nonnegative = value => { const n = number(value); return n != null && n >= 0 && n <= Number.MAX_SAFE_INTEGER ? n : null; };
  const text = value => value == null ? '' : String(value).trim();
  const fmt = value => Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });

  const MODES = Object.freeze({ row: 'Complete rows', half: 'Half trays', tray: 'Full trays', exact: 'Exact minimum' });
  const STANDARD_AREA_IN2 = 200;
  const preset = (cells, rows, columns) => Object.freeze({ id: 'tray-' + cells, name: cells + '-cell plug tray', cells, rows, columns, widthIn: 10, lengthIn: 20, active: true, template: true });
  // Planning templates. The 10 × 20 inch outside footprint is an assumption until the grower enters his own trays.
  const DEFAULTS = Object.freeze([preset(32, 8, 4), preset(50, 10, 5), preset(72, 12, 6), preset(98, 14, 7), preset(128, 16, 8), preset(200, 20, 10), preset(288, 24, 12),
    Object.freeze({ id: 'tray-flat-1020', name: '10 × 20 flat', cells: 1, rows: 1, columns: 1, widthIn: 10, lengthIn: 20, active: true, template: true })]);

  function validateTray(tray) {
    const errors = [];
    if (!object(tray)) return ['A tray definition must be a record.'];
    if (!text(tray.id) || text(tray.id) !== tray.id || tray.id.length > 200) errors.push('Give the tray a stable identifier.');
    if (!text(tray.name) || text(tray.name).length > 160) errors.push('Give the tray a name of 1 to 160 characters.');
    const cells = integer(tray.cells), rows = integer(tray.rows), columns = integer(tray.columns);
    if (cells == null || cells > 1000000) errors.push('Cells per tray must be a whole number from 1 to 1,000,000.');
    const hasGrid = !blank(tray.rows) || !blank(tray.columns);
    if (hasGrid && (rows == null || columns == null || rows * columns !== cells)) errors.push('Rows per tray × cells per row must equal the total cells.');
    if (positive(tray.widthIn) == null || positive(tray.lengthIn) == null || +tray.widthIn > 10000 || +tray.lengthIn > 10000) errors.push('Enter positive outside tray width and length in inches.');
    if (own(tray, 'active') && typeof tray.active !== 'boolean') errors.push('Tray availability must be on or off.');
    if (own(tray, 'deleted') && typeof tray.deleted !== 'boolean') errors.push('Tray deletion status must be on or off.');
    return errors;
  }

  // The tray library is read many times for one plan, so each nursery record is worked out once.
  const listed = new WeakMap();
  function everyTray(nursery) {
    const key = object(nursery) ? nursery : null;
    if (key && listed.has(key)) return listed.get(key);
    const map = new Map(DEFAULTS.map(tray => [tray.id, clone(tray)]));
    const stored = key && Array.isArray(key.trayTypes) ? key.trayTypes : [];
    const duplicate = new Set(stored.filter(object).filter((tray, index) => stored.findIndex(item => object(item) && item.id === tray.id) !== index).map(tray => tray.id));
    for (const value of stored) {
      if (!object(value) || !text(value.id)) continue;
      const merged = { ...(map.get(value.id) || {}), ...clone(value) };
      if (merged.deleted === true) merged.active = false;
      const errors = validateTray(merged);
      if (duplicate.has(value.id)) errors.push('Duplicate tray identifier; review the saved library before using this tray.');
      map.set(value.id, { ...merged, ...(errors.length ? { invalid: true, errors } : {}) });
    }
    const out = [...map.values()];
    if (key) listed.set(key, out);
    return out;
  }
  /** Every tray the plan knows: the templates, with the plan's own trays and changes laid over them. */
  const list = (nursery = {}, options = {}) => everyTray(nursery).filter(tray => options.includeInactive !== false || tray.active !== false).map(tray => ({ ...tray }));

  function normalizeTray(tray) {
    const out = { ...clone(tray), name: text(tray.name), cells: +tray.cells, widthIn: +tray.widthIn, lengthIn: +tray.lengthIn, active: tray.deleted !== true && tray.active !== false };
    out.rows = blank(tray.rows) ? null : +tray.rows;
    out.columns = blank(tray.columns) ? null : +tray.columns;
    delete out.invalid; delete out.errors;
    return out;
  }

  /** The tray a planting is sown in: its own choice, else its crop's, else the crop's saved cell count matched to a template. */
  function resolve({ crop = {}, planting = {}, nursery = {}, tower = false } = {}) {
    const warnings = [], candidates = everyTray(nursery), selected = text(planting.trayId) || text(crop.trayId);
    const source = text(planting.trayId) ? 'planting' : text(crop.trayId) ? 'crop' : 'legacy';
    if (selected) {
      const tray = candidates.find(t => t.id === selected);
      if (tray && !tray.invalid) {
        if (tray.active === false) warnings.push('This saved planting uses a ' + (tray.deleted === true ? 'deleted' : 'archived') + ' tray; its dimensions and count are retained.');
        return { tray: normalizeTray(tray), source, requestedId: selected, warnings, synthetic: false, medium: tower ? 'rockwool' : 'plugs' };
      }
      warnings.push(tray ? 'The selected tray definition needs review. The crop’s saved cell count is retained.' : 'The selected tray was not found. The crop’s saved cell count is retained.');
    }
    const legacy = integer(crop.tray), cells = legacy || 72;
    if (!blank(crop.tray) && legacy == null) warnings.push('The saved tray cell count is invalid; the existing 72-cell fallback is shown until corrected.');
    // An unassigned cell count is matched to the unmodified template, never to a custom tray that happens to share the count.
    const base = DEFAULTS.find(tray => tray.cells === cells);
    if (base) return { tray: clone(base), source: 'legacy', requestedId: selected, warnings, synthetic: false, medium: tower ? 'rockwool' : 'plugs' };
    const tray = { id: 'legacy-' + cells, name: cells + '-cell saved tray', cells, rows: null, columns: null, widthIn: 10, lengthIn: 20, active: true, legacy: true };
    warnings.push('The saved ' + cells + '-cell tray has no row layout. Add its rows and cells per row in Tray library for complete-row sowing. Its 10 × 20-inch footprint is the retained planning assumption.');
    return { tray, source: 'legacy', requestedId: selected, warnings, synthetic: true, medium: tower ? 'rockwool' : 'plugs' };
  }
  function roundingFor({ planting = {}, crop = {}, nursery = {} } = {}) {
    const raw = !blank(planting.sowRounding) ? planting.sowRounding : !blank(crop.sowRounding) ? crop.sowRounding : !blank(nursery.sowingRounding) ? nursery.sowingRounding : 'row';
    return own(MODES, raw) ? raw : 'exact';
  }
  function roundCells(minimum, tray, mode) {
    if (minimum === 0) return 0;
    if (mode === 'tray') return Math.ceil(minimum / tray.cells) * tray.cells;
    if (mode === 'row') return integer(tray.columns) ? Math.ceil(minimum / tray.columns) * tray.columns : minimum;
    if (mode === 'half') {
      const full = Math.floor(minimum / tray.cells), remainder = minimum - full * tray.cells;
      // with an odd number of rows, half a tray is the next whole row above half
      const half = integer(tray.rows) && integer(tray.columns) ? Math.ceil(tray.rows / 2) * tray.columns : Math.ceil(tray.cells / 2);
      return full * tray.cells + (remainder ? (remainder <= half ? half : tray.cells) : 0);
    }
    return minimum;
  }
  /** What to sow for a number of plants. Null when the planting is not raised in plugs: direct sown, live trays, bulbs, standing crops. */
  function sowingPlan(options = {}) {
    const crop = options.crop || {}, planting = options.planting || {}, settings = options.settings || {}, nursery = options.nursery || {};
    const tower = options.tower === true;
    if (options.rack === true || planting.established === true || crop.micro || (crop.material === 'bulb' && !tower) || (crop.method !== 'TP' && !tower)) return null;
    const plants = nonnegative(options.plants);
    if (plants == null) return { error: 'Planting quantity must be a finite, nonnegative number.', warnings: [] };
    const resolved = resolve({ crop, planting, nursery, tower }), tray = resolved.tray, warnings = resolved.warnings.slice();
    const germValue = positive(crop.germ) || positive(settings.germ) || 85, germination = Math.min(100, Math.max(0.1, germValue)) / 100;
    const buffer = nonnegative(settings.buffer) ?? 10, seedsPerCell = positive(crop.spc) || 1;
    const requestedMode = roundingFor({ planting, crop, nursery }), pots = crop.prop === 'pot' && !tower;
    let mode = requestedMode;
    if (pots) mode = 'exact';
    if (mode === 'row' && !integer(tray.columns)) { mode = 'minimum'; warnings.push('Complete-row rounding is unavailable until this tray’s row layout is entered. Using the germination-adjusted cell minimum.'); }
    const bufferedPlants = Math.ceil(mode === 'exact' ? plants * (1 + buffer / 100) : plants * (100 + buffer) / 100), minimumCells = Math.ceil(bufferedPlants / germination);
    const legacy = mode === 'exact', cells = legacy ? bufferedPlants : roundCells(minimumCells, tray, mode);
    const seeds = Math.ceil(cells * seedsPerCell / (legacy ? germination : 1)), trays = cells ? Math.ceil(cells / tray.cells) : 0;
    const fullTrays = Math.floor(cells / tray.cells), partialCells = cells - fullTrays * tray.cells, areaIn2 = tray.widthIn * tray.lengthIn;
    const expectedPlants = legacy ? bufferedPlants : Math.floor(cells * germination + 1e-9), potUpCells = bufferedPlants;
    if (![cells, seeds, trays, minimumCells, bufferedPlants].every(Number.isSafeInteger) || !Number.isFinite(trays * areaIn2)) return { error: 'The sowing quantity is too large to calculate safely.', warnings };
    if (pots && requestedMode !== 'exact') warnings.push('Sowing directly into pots keeps the existing pot-carrier calculation; plug-tray row rounding does not apply.');
    return { error: null, plants, targetPlants: plants, bufferedPlants, potUpCells, minimumCells, minimumSeeds: Math.ceil(bufferedPlants * seedsPerCell / germination), cells, seeds, trays,
      eq: trays * areaIn2 / STANDARD_AREA_IN2, ft2: trays * areaIn2 / 144, tray, mode, requestedMode, legacy, germination, buffer, seedsPerCell, expectedPlants,
      surplusPlants: Math.max(0, expectedPlants - plants), extraCells: Math.max(0, cells - minimumCells), emptyCells: trays * tray.cells - cells, fullTrays, partialCells,
      partialRows: tray.columns ? partialCells / tray.columns : null, rowsSown: tray.columns ? cells / tray.columns : null, medium: pots ? 'pots' : tower ? 'rockwool' : 'plugs',
      warnings, source: resolved.source, synthetic: resolved.synthetic };
  }
  /** "20 complete rows of 8 · 2 trays · 160 seeds" */
  function description(plan) {
    if (!plan) return '';
    if (plan.error) return plan.error;
    const seedText = fmt(plan.seeds) + ' seed' + (plan.seeds === 1 ? '' : 's');
    if (plan.medium === 'pots') return seedText + ' for ' + fmt(plan.cells) + ' pots';
    const trayText = fmt(plan.trays) + ' tray' + (plan.trays === 1 ? '' : 's');
    const rowText = plan.mode === 'row' && Number.isInteger(plan.rowsSown) ? fmt(plan.rowsSown) + ' complete row' + (plan.rowsSown === 1 ? '' : 's') + ' of ' + fmt(plan.tray.columns) : fmt(plan.cells) + ' cells';
    return rowText + ' · ' + trayText + ' · ' + seedText;
  }
  function trayLabel(tray) {
    if (tray.cells === 1) return tray.name + ' · ' + fmt(tray.widthIn) + ' × ' + fmt(tray.lengthIn) + ' in' + (tray.active === false ? ' · unavailable' : '');
    return tray.name + ' · ' + fmt(tray.cells) + ' cells' + (integer(tray.rows) && integer(tray.columns) ? ' (' + tray.rows + ' rows × ' + tray.columns + ')' : ' · row layout needed') + (tray.deleted === true ? ' · deleted' : tray.active === false ? ' · archived' : '');
  }
  /**
   * What must match for two plantings to be sown as one batch: crop, variety, every nursery date, the way they are
   * raised, the tray and its measurements, and the sowing figures. A planting with a date missing stands alone.
   */
  function batchKey(options = {}, id = '') {
    const crop = options.crop || {}, planting = options.planting || {}, resolved = resolve(options), plan = sowingPlan(options);
    if (!plan || plan.error) return null;
    const sowDate = text(options.sowDate), fieldDate = text(options.fieldDate);
    if (!sowDate || !fieldDate || plan.legacy) return 'individual:' + text(id || planting.id);
    return JSON.stringify([crop.id || planting.cropId, planting.varietyId || '', sowDate, fieldDate, text(options.potUpDate), text(options.hardenDate), crop.prop || 'tray', options.tower === true,
      resolved.tray.id, resolved.tray.cells, resolved.tray.rows, resolved.tray.columns, resolved.tray.widthIn, resolved.tray.lengthIn, plan.requestedMode, plan.germination, plan.buffer, plan.seedsPerCell]);
  }
  /** One rounded batch shared out among its plantings: whole cells and seeds by largest remainder, tray room in proportion. */
  function allocate(plan, members = []) {
    if (!plan || plan.error || !Array.isArray(members) || !members.length) return [];
    const ids = members.map((member, index) => text(member.id || (member.planting && member.planting.id)) || 'member-' + index);
    if (new Set(ids).size !== ids.length) throw new Error('Sowing allocation needs unique planting identifiers.');
    const quantities = members.map(member => nonnegative(member.plants));
    if (quantities.some(value => value == null)) throw new Error('Sowing allocation needs valid nonnegative planting quantities.');
    const total = quantities.reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(total) || (!total && plan.cells) || [plan.cells, plan.seeds, plan.minimumCells, plan.bufferedPlants].some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('Sowing allocation needs a valid planned quantity and matching members.');
    if (Number.isFinite(plan.targetPlants) && Math.abs(total - plan.targetPlants) > Math.max(1e-9, total * Number.EPSILON * 8)) throw new Error('Sowing allocation members must match the batch planting quantity.');
    const rows = members.map((member, index) => ({ id: ids[index], plants: quantities[index], share: total ? quantities[index] / total : 0 }));
    function integerShares(amount, key, weights) {
      for (let i = 0; i < rows.length; i++) rows[i][key] = Math.floor(amount * weights[i]);
      const remaining = amount - rows.reduce((sum, row) => sum + row[key], 0);
      const order = rows.map((row, index) => ({ index, remainder: amount * weights[index] - row[key], id: row.id })).sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id));
      for (let i = 0; i < remaining; i++) rows[order[i % order.length].index][key]++;
    }
    const weights = rows.map(row => row.share);
    integerShares(plan.cells, 'cells', weights);
    const cellWeights = rows.map(row => plan.cells ? row.cells / plan.cells : 0);
    integerShares(plan.seeds, 'seeds', cellWeights);
    integerShares(plan.bufferedPlants, 'potUpCells', weights);
    integerShares(plan.minimumCells, 'minimumCells', weights);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i], share = cellWeights[i];
      row.trays = plan.trays * share; row.eq = plan.eq * share; row.ft2 = plan.ft2 * share;
      row.traySpace = row.eq; row.bufferedPlants = row.potUpCells;
    }
    return rows;
  }
  function sowingBatch(options = {}) {
    const members = Array.isArray(options.members) ? options.members : [];
    if (!members.length) return { error: 'A sowing batch needs at least one planting.', members: [], plan: null };
    const rows = members.map((member, index) => ({ ...options, ...member, members: undefined, id: text(member.id || (member.planting && member.planting.id)) || 'member-' + index }));
    if (new Set(rows.map(row => row.id)).size !== rows.length) return { error: 'A sowing batch contains duplicate planting identifiers.', members: [], plan: null };
    const keys = rows.map(row => batchKey(row, row.id));
    if (keys.some(key => !key) || new Set(keys).size !== 1) return { error: 'Only the same crop, variety, dates, tray and sowing settings can share a batch.', members: [], plan: null };
    const plants = rows.reduce((sum, row) => sum + (nonnegative(row.plants) ?? NaN), 0), plan = sowingPlan({ ...rows[0], plants });
    if (!plan || plan.error) return { error: (plan && plan.error) || 'This planting does not need nursery sowing.', members: [], plan: null };
    return { error: null, key: keys[0], members: allocate(plan, rows), plan };
  }

  return { MODES, DEFAULTS, STANDARD_AREA_IN2, list, validateTray, resolve, roundingFor, roundCells, sowingPlan, sowingBatch, batchKey, allocate, description, trayLabel };
});
