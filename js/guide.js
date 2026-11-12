/* Little River Farm Planner — crop defaults checked against published guides.
 *
 * Two sources, both read on 10 November 2026:
 *   Johnny's Selected Seeds, "Transplanted Vegetable Crops" chart (version dated 27 March 2026):
 *     days from transplanting to mature crop, as a range per crop.
 *   New England Vegetable Management Guide, 2025-26 (nevegetable.org): figures given in passing in
 *     24 of its 30 crop chapters. It has no maturity table, and gives none for many crops.
 *
 * Neither gives one firm number: maturity depends on variety and season. So the rule is modest.
 * A planner default that sits inside either guide's range is kept and marked as checked. One that
 * sits outside every range moves to the middle of the first range. Crops with no figure in either
 * guide are left out and stay marked as unchecked.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./library.js'));
  else root.LRFGuide = factory(root.LRFLibrary);
})(typeof self !== 'undefined' ? self : this, function (Lib) {
  'use strict';
  const J = 'Johnny’s', N = 'NEVG';
  // [crop name, how the crop is started (TP, DS or either), source, low, high, counted from]
  const ROWS = [
    [/artichoke/i, 'TP', J, 85, 100, 'transplanting'], [/broccoli(?!.*raab)/i, 'TP', J, 45, 70, 'transplanting'], [/broccoli(?!.*raab)/i, 'TP', N, 55, 75, 'transplanting'],
    [/brussels/i, 'TP', J, 100, 110, 'transplanting'], [/brussels/i, 'TP', N, 90, 110, 'transplanting'],
    [/cabbage/i, 'TP', J, 50, 150, 'transplanting'], [/cabbage/i, 'TP', N, 60, 120, 'transplanting'],
    [/cauliflower/i, 'TP', J, 45, 80, 'transplanting'], [/cauliflower/i, 'TP', N, 55, 95, 'transplanting'],
    [/celeriac/i, 'TP', J, 100, 120, 'transplanting'], [/celeriac/i, 'TP', N, 80, 90, 'transplanting'], [/celery/i, 'TP', J, 75, 90, 'transplanting'],
    [/eggplant/i, 'TP', J, 50, 75, 'transplanting'], [/^kale\b/i, 'TP', J, 40, 50, 'transplanting'], [/kohlrabi/i, 'TP', J, 30, 40, 'transplanting'],
    [/^leeks?\b/i, 'TP', J, 75, 100, 'transplanting'], [/lettuce/i, 'TP', J, 35, 65, 'transplanting'], [/lettuce/i, 'TP', N, 40, 50, 'a start it does not state'],
    [/watermelon/i, 'TP', J, 70, 85, 'transplanting'], [/melon/i, 'TP', J, 70, 85, 'transplanting'],
    [/onion.*bulb|^onions?$/i, 'TP', J, 75, 100, 'transplanting'],
    // Johnny's range fits peppers picked green. NEVG adds about 20 days for coloured fruit, which is what this farm grows.
    [/pepper/i, 'TP', J, 50, 70, 'transplanting'], [/pepper/i, 'TP', N, 55, 80, 'transplanting, green to fully coloured'],
    [/tomato/i, 'TP', J, 50, 85, 'transplanting'],
    [/bush bean/i, 'DS', N, 50, 62, 'seeding'], [/snap pea/i, 'DS', N, 52, 70, 'seeding'], [/spinach/i, 'DS', N, 37, 45, 'seeding'],
    [/salad mix/i, 'DS', N, 21, 35, 'seeding'], [/^radish/i, 'DS', N, 21, 28, 'seeding in good conditions; 40 to 50 in cold weather'],
    [/turnip/i, 'DS', N, 35, 50, 'seeding'], [/pickling cucumber/i, 'DS', N, 48, 57, 'seeding'], [/sweet corn/i, 'DS', N, 67, 85, 'a start it does not state']
  ];
  const crops = {};
  for (const c of Lib.crops) {
    if (c.micro) continue;
    const sources = ROWS.filter(([match, method]) => match.test(c.name) && method === (c.method === 'TP' ? 'TP' : 'DS')).map(([, , name, low, high, basis]) => ({ name, range: [low, high], basis }));
    // The melon row would also catch watermelon: keep one row per source.
    const seen = new Set(), unique = sources.filter(s => !seen.has(s.name) && seen.add(s.name));
    if (!unique.length) continue;
    const kept = unique.some(s => c.dtm >= s.range[0] && c.dtm <= s.range[1]);
    crops[c.id] = { dtm: kept ? c.dtm : Math.round((unique[0].range[0] + unique[0].range[1]) / 2), was: c.dtm, kept, sources: unique };
  }
  // ── where a crop's printed days start ──
  // Johnny's says it on each variety page, and for flowers and herbs in one general sentence. The lines below are
  // the ones those pages give (read from the pages kept with the farm's own varieties, 12 November 2026):
  //   tomato, pepper, eggplant, cucumber, cabbage, head lettuce, tomatillo: "from transplanting"
  //   kale, kohlrabi, summer squash: "from direct seeding; subtract about 14 days" for a transplant; beets "14-21"
  //   onion, fennel: "from direct seeding", with no figure for a transplant: the same 14 is offered, marked as such
  //   flowers and herbs: "days to maturity for all flowers and herbs is calculated from seeding date"
  // Its transplant chart agrees with the 14 days: kale 40-50 and bulb onion 75-100 days from transplanting.
  // A crop with no line here keeps counting from the day it goes in the bed. Nothing is applied until it is accepted.
  const STARTS = [
    [/tomat|pepper|eggplant|^cucumber|vining|cabbage|lettuce|salanova|little gem/i, 'transplant', null, 'Johnny’s counts these from transplanting'],
    [/^kale\b|kohlrabi|summer squash|zucchini/i, 'direct', 14, 'Johnny’s: from direct seeding; subtract about 14 days for a transplant'],
    [/^beets?\b/i, 'direct', 14, 'Johnny’s: from direct seeding; subtract 14 to 21 days for a transplant'],
    [/onion|shallot|fennel/i, 'direct', 14, 'Johnny’s: from direct seeding. It gives no figure for a transplant; 14 days is its figure for kale and kohlrabi'],
    [/basil|parsley|cilantro|dill|zinnia|cosmos|snapdragon|^stock\b|celosia|sunflower|marigold|strawflower|yarrow|lisianthus|bachelor|black.eyed|rudbeckia|daucus|ammi|statice|scabiosa|aster\b/i, 'seed', null, 'Johnny’s: days for all flowers and herbs are counted from the seeding date']
  ];
  /** The published starting point for a crop, by its name: { from, less, says }, or null. */
  const startFor = c => { const row = c && !c.micro && STARTS.find(([match]) => match.test(String(c.name || ''))); return row ? { from: row[1], less: row[2], says: row[3] } : null; };
  const guide = { read: '2026-11-10', crops, startFor };
  Lib.guide = guide;
  return guide;
});
