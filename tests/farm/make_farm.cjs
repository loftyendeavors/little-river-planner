'use strict';
// The made-up farm the checks run on. Nothing in it is anyone's: the names, the ground, the dates, the seed and the pictures
// are all written here, from a fixed seed, so two runs give the same farm byte for byte.
//
//   node tests/farm/make_farm.cjs <dir holding the planner's js/> <out dir>
//
// First run: writes layout.json (where every bed lies, for the picture) and stops if farm-map.jpg is not there yet.
// Then:      python3 -I tests/farm/make_pictures.py <out dir>     (draws farm-map.jpg and thumbs.json; needs Pillow)
// Then run this again: it writes plan.json (the compact plan the app folder ships), backup-plan.json (the same plan as a
// full backup file), inventory.json, packs.json and plan-info.json.
//
// The farm has one of every kind of thing the planner knows: field beds, raised beds, a tunnel, greenhouse beds, two rows
// of towers, crates and pots, live trays on the heated benches, cane berries, bulbs, beds shared lengthwise and by rows,
// plantings that carry figures of their own, ground booked twice and plantings longer than their bed.
// There are more than 600 plantings: the page checks take that as the sign that a whole plan is open.
// A check that needs something the farm lacks adds it here, not in a private file.
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const [JS, OUT] = process.argv.slice(2);
if (!JS || !OUT) { console.error('usage: node make_farm.cjs <js dir> <out dir>'); process.exit(2); }
global.window = global;
const E = require(path.join(JS, 'engine.js')), IO = require(path.join(JS, 'planio.js')), Lib = require(path.join(JS, 'library.js'));
require(path.join(JS, 'guide.js'));
const Trays = require(path.join(JS, 'trays.js'));
const YEAR = 2027;

// ── a fixed source of chance ──
let seed = 20270114;
/** Each part of the farm draws from a run of its own, named for it: adding to one part leaves the others as they were. */
const chance = name => { seed = parseInt(crypto.createHash('sha256').update('example farm: ' + name).digest('hex').slice(0, 8), 16) | 0; };
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = list => list[Math.floor(rnd() * list.length)];
const hex = n => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');
const uid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(rnd() * 4)]}${hex(3)}-${hex(12)}`;
const short = () => Math.floor(rnd() * 36 ** 6).toString(36).padStart(6, '0');
const D = E.s2d, S = E.d2s, add = (s, n) => S(E.addDays(D(s), n));
const md = (m, d) => `${YEAR}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const monday = s => { const d = D(s); return add(s, -((d.getDay() + 6) % 7)); };

// ── the farm's own settings ──
const settings = {
  ...JSON.parse(JSON.stringify(Lib.defaults)), year: YEAR, farm: 'Example Farm',
  frostLast: '05-08', frostFirst: '10-18', firstCoolField: '04-12', firstWarmField: '05-15', lastOutdoorField: '09-25',
  benchTrays: 120, turnover: 7, trayCost: 2, timing: 'calendar', microV2: true, theme: 'light', fertilityEnabled: true
};
const containers = [
  { id: 'ct_crate', name: 'Crate 15 × 23 in', shape: 'rect', w: 1.25, l: 23 / 12, plants: 3 },
  { id: 'ct_pot10', name: 'Pot 10 gal (16 in)', shape: 'round', diam: 16, plants: 1 },
  { id: 'ct_pot3', name: 'Pot 3 gal (10 in)', shape: 'round', diam: 10, plants: 1 }
];
const customers = [
  { id: 'c-corner-bistro', name: 'Corner Bistro', kind: 'wholesale', share: 40, prices: {} },
  { id: 'c-grocer', name: 'Main Street Grocer', kind: 'wholesale', share: 30, prices: {} },
  { id: 'c-farm-stand', name: 'Farm Stand', kind: 'retail', share: 30, prices: {} }
];

chance('crops');
// ── crops: the planner's own, with this farm's changes, and a few of the farm's own ──
const own = (name, o) => ({ id: 'c_' + uid(), name, family: 'Aster', method: 'TP', inRow: 12, rowSp: 12, seedsFt: 0, gh: 4, tray: 72, spc: 1, dtm: 60, hw: 21, n: 2.5, p: 2, k: 2.5,
  yBasis: 'plant', yield: 1, baseUnit: 'each', mk: 0.9, price: 2, seed1000: 10, tower: false, frostTender: false, rockwoolDays: 0, towerDays: 0, ...o });
const C = {
  pakChoi: own('Pak Choi', { family: 'Brassica', inRow: 8, gh: 3, tray: 128, dtm: 45, hw: 14, plantingMaterial: 'seed', perennial: false, fieldSeason: 'cool' }),           // a yield of "1 each" nobody has checked
  celeriac: own('Celeriac', { family: 'Umbel', inRow: 8, gh: 10, dtm: 100, hw: 30, yield: 1, baseUnit: 'each', price: 3, plantingMaterial: 'seed', perennial: false }),
  yarrow: own('Yarrow', { inRow: 12, gh: 8, dtm: 110, hw: 42, yield: 1, baseUnit: 'each', price: 2, plantingMaterial: 'seed', perennial: false }),
  statice: own('Statice', { family: 'Plumbaginaceae', inRow: 12, gh: 8, dtm: 100, hw: 45, yield: 1, baseUnit: 'each', price: 0, plantingMaterial: 'seed', perennial: false }),   // no price
  miniCuke: own('Cucumber (Mini)', { family: 'Cucurbit', dtm: 55, hw: 42, yield: 20, mk: 0.85, price: 1.5, fieldSeason: 'warm', rowsPerBed: 2 }),
  bushTomato: own('Tomato (Bush)', { family: 'Solanaceae', inRow: 24, rowSp: 36, gh: 6, tray: 50, dtm: 70, hw: 30, yield: 10, baseUnit: 'lb', price: 3, frostTender: true,
    fieldSeason: 'warm', harvestMode: 'season', harvestUntil: '09-30', yieldDays: 70, prop: 'potup', potUpWk: 3, plantingMaterial: 'seed' }),
  shallot: own('Shallot', { family: 'Allium', inRow: 6, rowSp: 10, gh: 8, tray: 200, dtm: 95, hw: 21, yield: 0.3, baseUnit: 'lb', price: 6, harvestMode: 'window' }),
  freesia: own('Freesia', { family: 'Iridaceae', method: 'DS', plantingMaterial: 'bulb', material: 'bulb', perennial: false, inRow: 4, rowSp: 4, gh: 0, dtm: 100, hw: 14, harvestMode: 'window',
    fieldSeason: 'warm', baseUnit: 'stem', mk: 0.85, price: 1.5, seed1000: 0, frostTender: true, n: 0, p: 0, k: 0 }),
  anemone: own('Anemone', { family: 'Ranunculaceae', method: 'DS', plantingMaterial: 'bulb', material: 'bulb', perennial: false, inRow: 6, rowSp: 6, gh: 0, dtm: 85, hw: 28, harvestMode: 'window',
    fieldSeason: 'warm', baseUnit: 'stem', mk: 0.85, price: 0, seed1000: 0, frostTender: true, n: 0, p: 0, k: 0, note: 'A crate crop. Its timing and its one stem a plant are planning estimates.' }),
  crocosmia: own('Crocosmia', { family: 'Iridaceae', method: 'DS', plantingMaterial: 'bulb', material: 'bulb', perennial: false, inRow: 4, rowSp: 4, gh: 0, dtm: 80, hw: 14, harvestMode: 'window',
    fieldSeason: 'warm', baseUnit: 'stem', mk: 0.85, price: 0, seed1000: 0, frostTender: true, n: 0, p: 0, k: 0 })
};
const micro = name => own('Micro - ' + name, { family: 'Brassica', method: 'DS', dtm: 21, hw: 21, micro: true });
const M = { mizuna: micro('Mizuna'), cress: micro('Cress'), amaranth: micro('Amaranth'), shiso: micro('Shiso'), chervil: micro('Chervil'), nasturtium: micro('Nasturtium') };
const overlays = [
  { id: 'lettuce_head', name: 'Lettuce' }, { id: 'tomato', name: 'Tomato' },   // the farm's own names for two of the planner's crops; several checks look a crop up by these
  { id: 'little_gem', tower: false, blackout: null, price: 2.75 },
  { id: 'fennel', inRow: 12, plantingMaterial: 'plant', price: 3.25, rowsPerBed: 4 },
  { id: 'cucumber_pickling', method: 'TP', inRow: 12, rowSp: 24, gh: 3, trayId: 'tray-50', sowRounding: 'row', rowsPerBed: 2, price: 1.75 },
  { id: 'carrot', price: 4.5, firstSafeField: '04-01', inRow: 1, rowsPerBed: 4, yield: 1, mk: 0.9 },
  { id: 'beet', gh: 4, method: 'TP', rowsPerBed: 4, yield: 1.25 },
  { id: 'tomato_cherry', gh: 8, yield: 4, rowsPerBed: 2, inRow: 16 },
  { id: 'radish', rowsPerBed: 6, price: 3 },
  { id: 'kale', rowsPerBed: 3 },
  { id: 'onion', rowsPerBed: 4, yield: 0.4 }
];
const crops = [...overlays, ...Object.values(C), ...Object.values(M)];
settings.cropTypeList = { v: 1, added: [...Object.values(C), ...Object.values(M)].map(c => c.id).concat(['radish', 'tomato_cherry', 'mg_arugula', 'mg_basil']), removed: ['little_gem'], deleted: [] };
const cropUnits = {
  little_gem: { base: 'head', units: [['head', 1]] }, tomato: { base: 'lb', units: [['lb', 1]] },
  carrot: { base: 'bu', units: [['bu', 1], ['½-lb bag', 0.5], ['case (10 lb)', 10], ['case (25 lb)', 25]] },
  [C.shallot.id]: { base: 'lb', units: [['lb', 1], ['case of 12', 12]] }
};

chance('varieties');
// ── varieties: made-up names, a made-up supplier's figures ──
const WORDS_A = ['Amber', 'Brindle', 'Cinder', 'Dapple', 'Ember', 'Fallow', 'Gable', 'Harbor', 'Indigo', 'Juniper', 'Kestrel', 'Lantern', 'Meadow', 'Nettle', 'Orchard', 'Pewter', 'Quill', 'Russet', 'Sable', 'Thistle', 'Umber', 'Velvet', 'Willow', 'Yarrow', 'Zephyr', 'Marsh', 'Copper', 'Flint'];
const WORDS_B = ['Bell', 'Crown', 'Drift', 'Field', 'Glow', 'Heart', 'Jewel', 'King', 'Lace', 'Moon', 'Pearl', 'Queen', 'Rose', 'Star', 'Tide', 'Wing', 'Spire', 'Brook', 'Dawn', 'Frost', 'Gold', 'Sprite'];
const usedNames = new Set();
const madeName = () => { for (;;) { const n = pick(WORDS_A) + ' ' + pick(WORDS_B); if (!usedNames.has(n)) { usedNames.add(n); return n; } } };
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const SUPPLIERS = [['Example Seed Co.', 'seeds.example'], ['Sample Seed Works', 'sampleseed.example'], ['Made-up Bulb & Plant', 'bulbs.example']];
const varieties = [], byCrop = {};
function variety(cropId, o = {}) {
  const name = o.name || madeName(), cropRec = Lib.crops.find(c => c.id === cropId) || crops.find(c => c.id === cropId) || {};
  const dtm = Math.max(18, Math.round((cropRec.dtm || 60) * (0.85 + rnd() * 0.3)));
  let v;
  if (o.stub) v = { id: 'v_named_' + short(), cropId, name, stub: true, source: 'Farm entry' };
  else {
    const [supplier, host] = o.bulb ? SUPPLIERS[2] : pick(SUPPLIERS.slice(0, 2)), sku = String(int(1000, 9899)) + pick(['', 'G', '.11', 'P']);
    const basis = o.basis || pick(['unspecified', 'unspecified', 'transplant', 'seed']);
    v = { id: (rnd() < 0.5 ? 'v_named_' + short() : 'v_url_' + uid()), cropId, name, catalogSourceChoice: 'url', catalogDtm: dtm, catalogDtmMax: rnd() < 0.3 ? dtm + int(3, 10) : dtm, catalogMaturityBasis: basis,
      source: supplier, supplier, sku, url: `https://${host}/products/${slug(cropRec.name || cropId)}-${slug(name)}`, catalogDtmText: `${dtm} days`, catalogHarvestStage: 'unspecified' };
    if (v.catalogDtmMax !== dtm) v.catalogDtmText = `${dtm}-${v.catalogDtmMax} days`;
    if (!o.bulb) { v.seedsPerPacket = pick([25, 50, 100, 250, 500, 1000]); if (rnd() < 0.6) v.seedsPerLb = int(20, 400) * 1000; else if (rnd() < 0.7) v.seedsPerOz = int(2, 300) * 100; else v.seedsPerG = int(2, 900); }
    if (o.text) { v.stub = true; v.active = true; v._basisFromText = o.text; v._pageTextBasis = o.text; v._catalogTextBasis = o.text; }
  }
  Object.assign(v, o.set || {});
  varieties.push(v); (byCrop[cropId] = byCrop[cropId] || []).push(v);
  return v;
}
const V = (cropId, n, o) => Array.from({ length: n }, () => variety(cropId, o));
V('lettuce_head', 12); V('lettuce_head', 2, { text: 'seed' }); V('tomato', 6); V('tomato', 2, { text: 'transplant' }); V('tomato_cherry', 4); V(C.bushTomato.id, 3);
V('pepper', 4, { set: { gh: 8, environmentDefaults: { v: 1, field: { gh: 8 }, greenhouse: { gh: 8 } } } }); V('eggplant_asian', 2); V('cucumber', 4, { basis: 'unspecified' }); V('cucumber_pickling', 2); V(C.miniCuke.id, 2);
V('carrot', 4); V('radish', 4); V('beet', 3); V('kale', 3); V('cabbage', 3); V('kohlrabi', 2); V('fennel', 2); V('onion', 3); V(C.shallot.id, 2); V('potato', 3, { stub: true });
V('bean_bush', 3); V('basil', 4); V('parsley', 2); V('spinach', 2); V('summer_squash', 2); V('broccoli', 2); V(C.pakChoi.id, 2); V(C.celeriac.id, 1);
V('zinnia', 4); V('cosmos', 2); V('snapdragon', 4); V('stock', 2); V('sunflower', 3); V('dahlia', 6, { stub: true }); V(C.yarrow.id, 2); V(C.statice.id, 2);
V('raspberry', 4, { stub: true }); V('blackberry', 2, { stub: true }); V(C.freesia.id, 5, { bulb: true }); V(C.anemone.id, 3, { bulb: true }); V(C.crocosmia.id, 3, { bulb: true });
for (const m of Object.values(M)) V(m.id, 1);
V('scallion', 2); V('leek', 2); V('chard', 2); V('celery', 1);
// a few that were removed, and one the farm renamed its timing on
for (const v of varieties.filter((_, i) => i % 13 === 5).slice(0, 9)) v.deleted = true;
const lettuceTimed = byCrop.lettuce_head[3]; lettuceTimed.dtm = 48; lettuceTimed.timingMode = 'manual';
const vOf = (cropId, i = null) => { const list = (byCrop[cropId] || []).filter(v => !v.deleted); return list.length ? (i == null ? pick(list) : list[i % list.length]) : null; };

chance('ground');
// ── the ground ──
// The picture is 2400 × 1200 pixels at a quarter of a foot to the pixel: 600 ft by 300 ft.
const MAP = { ftPerPx: 0.25, imgW: 2400, imgH: 1200, towerShape: 'circle', towerGap: 0 };
const rad = d => d * Math.PI / 180;
const gardens = [], beds = [], blocks = [];
const gardenDefaults = type => ({ ...Lib.gardenTypes[type] });
function garden(id, name, type, extra = {}) {
  const g = { id, name, type, active: true, order: gardens.length, soilN: null, soilP: null, soilK: null, compost: null, ...gardenDefaults(type), notes: '', ...extra };
  gardens.push(g); return g;
}
/** A block of beds side by side: (x, y) is the block's middle in feet from the photo's top-left; `turn` in degrees. */
function block(g, { x, y, turn = 0, n, w, l, path = 1.5, type, orient = 'NS', cols = n, rowGap = 4, names = null, slugged = true, extra = null }) {
  const scale = g.mapScale || 1, rows = Math.ceil(n / cols), made = [];
  const totalW = cols * w + (cols - 1) * path, totalL = rows * l + (rows - 1) * rowGap;
  for (let i = 0; i < n; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const u = (-totalW / 2 + col * (w + path) + w / 2) * scale, v = (-totalL / 2 + row * (l + rowGap) + l / 2) * scale;
    const fx = x + u * Math.cos(rad(turn)) - v * Math.sin(rad(turn)), fy = y + u * Math.sin(rad(turn)) + v * Math.cos(rad(turn));
    const name = names ? names[i] : String(beds.filter(b => b.gardenId === g.id).length + 1);
    const b = { id: slugged ? `${g.id.replace(/^g-/, '')}-${name}` : uid(), bed: name, gardenId: g.id, type, orient, w, l, note: '', active: true, ...(extra ? extra(i) : {}),
      px: { x: +(fx / MAP.ftPerPx).toFixed(3), y: +(fy / MAP.ftPerPx).toFixed(3), rot: turn } };
    beds.push(b); made.push(b);
  }
  blocks.push({ garden: g.id, name: g.name, type: g.type, x, y, turn, w: totalW * scale + 6, l: totalL * scale + 6 });
  return made;
}
const G = {};
// Long Rows comes first: several checks size a planting off the first garden's beds, and expect those to be the farm's longest.
G.long = garden('g-long-rows', 'Long Rows', 'field', { measuredSize: { v: 1, widthFt: 24, lengthFt: 80 } });
G.north = garden('g-north-field', 'North Field', 'field', { mapScale: 1.1, measuredSize: { v: 1, widthFt: 70, lengthFt: 24 } });
G.south = garden('g-south-field', 'South Field', 'field', { measuredSize: { v: 1, widthFt: 70, lengthFt: 22 }, liquidFeedProfile: { v: 1, enabled: true, productName: 'Made-up feed 17-5-17', ppmN: 100 } });
G.east = garden('g-east-strip', 'East Strip', 'field');
G.kitchen = garden('g-kitchen-garden', 'Kitchen Garden', 'field');
G.berry = garden('g-berry-rows', 'Berry Rows', 'field');
G.flower = garden('g-flower-block', 'Flower Block', 'field');
G.shade = garden('g-shade-house', 'Shade House', 'greenhouse');
G.houseA = garden('g-house-a', 'House A', 'greenhouse');
G.houseB = garden('g-house-b', 'House B', 'greenhouse');
G.tunnel = garden('g-tunnel', 'Caterpillar Tunnel', 'tunnel', { measuredSize: { v: 1, widthFt: 16, lengthFt: 40 } });
G.tower1 = garden('g-tower-line-a', 'Tower Line A', 'greenhouse', { mapScale: 0.66 });
G.tower2 = garden('g-tower-line-b', 'Tower Line B', 'greenhouse', { mapScale: 0.66 });
G.crates = garden('g-crate-yard', 'Crate Yard', 'field', { mapScale: 1.3 });
G.fresh = garden('g-new-ground', 'New Ground', 'field');
G.pots = garden('g-potted-berries', 'Potted Berries', 'field', { mapScale: 1.4, growingEnvironment: { v: 1, kind: 'outdoor', minTempF: null } });

const B = {};
B.north = block(G.north, { x: 120, y: 50, n: 14, w: 3.5, l: 22, type: 'RB' });
B.south = block(G.south, { x: 120, y: 105, n: 14, w: 3.5, l: 20, type: 'RB' });
B.long = block(G.long, { x: 250, y: 75, turn: 4, n: 4, w: 4, l: 80, path: 2, type: 'IG' });
B.east = block(G.east, { x: 345, y: 45, turn: 90, n: 8, w: 3, l: 35, type: 'RB', orient: 'EW', slugged: false });
B.kitchen = block(G.kitchen, { x: 345, y: 120, turn: 8, n: 8, w: 3.5, l: 24, cols: 4, path: 2.5, rowGap: 4, type: 'SE', slugged: false });
B.berry = block(G.berry, { x: 450, y: 70, turn: 0, n: 5, w: 4, l: 50, path: 6, type: 'SE' });
B.flower = block(G.flower, { x: 520, y: 150, turn: 86, n: 10, w: 3, l: 30, cols: 5, path: 3, rowGap: 3, type: 'RB', orient: 'EW', slugged: false });
B.shade = block(G.shade, { x: 440, y: 225, turn: 82, n: 6, w: 3.5, l: 24, path: 1.5, type: 'SE', orient: 'EW' });
B.houseA = block(G.houseA, { x: 80, y: 215, n: 4, w: 4, l: 40, path: 2, type: 'IG' });
B.houseB = block(G.houseB, { x: 130, y: 215, n: 3, w: 4, l: 40, path: 2, type: 'IG' });
B.tunnel = block(G.tunnel, { x: 190, y: 220, n: 2, w: 5, l: 40, path: 3, type: 'IG', slugged: false });
B.tower1 = block(G.tower1, { x: 270, y: 190, turn: 84, n: 16, w: 3, l: 3, path: 1, type: '42 Site', orient: 'EW', slugged: false });
B.tower2 = block(G.tower2, { x: 270, y: 205, turn: 84, n: 16, w: 3, l: 3, path: 1, type: '42 Site', orient: 'EW', slugged: false });
B.crates = block(G.crates, { x: 300, y: 255, turn: 86, n: 2, w: 0, l: 0, path: 30, type: 'CT', orient: 'EW', slugged: false, names: ['Flower Crates', 'Herb Crates'], extra: i => ({ ct: 'ct_crate', count: i ? 24 : 110 }) });
B.fresh = block(G.fresh, { x: 545, y: 95, n: 8, w: 3.5, l: 25, type: 'RB' });   // broken this year, nothing in it yet
const potNames = ['Cane pots A', 'Cane pots B', 'Cane pots C', 'Trellis pots'];
B.pots = block(G.pots, { x: 540, y: 255, turn: 82, n: 4, w: 0, l: 0, path: 8, type: 'CT', orient: 'EW', slugged: false, names: potNames,
  extra: i => ({ ct: 'ct_pot10', count: [18, 25, 25, 24][i], potLayout: { columns: [18, 25, 25, 1][i], gapFt: 0 }, ...(i >= 2 ? { lrfTrellis: { v: 1, type: 'vertical' } } : {}) }) });
for (const b of [B.houseA[0], B.houseA[1], B.tunnel[0], B.long[0], B.kitchen[0]]) b.lrfTrellis = { v: 1, type: b === B.long[0] ? 'none' : 'vertical' };
G.kitchen.mapLayout = { pathFt: 2.5, endGapFt: 4, columns: 4, locked: true, bedIds: B.kitchen.map(b => b.id), appliedAt: '2026-10-20T15:00:00.000Z' };
G.flower.mapLayout = { pathFt: 3, endGapFt: 3, columns: 5, locked: true, bedIds: B.flower.map(b => b.id), appliedAt: '2026-10-20T15:05:00.000Z' };
G.east.bedOrder = { v: 1, ids: B.east.map(b => b.id) };

chance('nursery');
// ── the nursery: two houses of benches, all under heat ──
const areaA = 'bench-area-' + uid(), areaB = 'bench-area-' + uid();
const nursery = { packing: 85, benchAreas: [{ id: areaA, name: 'Seedling House', w: 15, l: 35 }, { id: areaB, name: 'House A, east end', w: 26, l: 48 }], spaces: [] };
[[4, 3], [3, 6], [3, 4], [3, 4], [3, 4], [3, 4], [4, 12], [4, 12], [3, 6], [3, 6], [3, 6], [3, 6], [4, 12], [4, 12], [4, 12], [4, 12]].forEach(([w, l], i) => nursery.spaces.push(
  { id: 'nursery-bench-' + uid(), name: 'Bench ' + (i + 1), w, l, kind: 'heated', active: true, from: '', to: '', benchLayout: { areaId: i < 8 ? areaA : areaB, x: (i % 4) * 5, y: Math.floor((i % 8) / 4) * 14, rotated: i === 0 } }));

chance('plantings');
// ── plantings ──
const plantings = [];
const libCrop = id => crops.find(c => c.id === id && c.name) || Lib.crops.find(c => c.id === id);
let soilCount = 0;
/** Figures kept on a planting, as a plan that has been worked in for a while has them: days, harvest days and turnover of its own. */
function dress(p, bed) {
  if (!['RB', 'IG', 'SE'].includes(bed.type) || p.bedLayout || ['raspberry', 'blackberry'].includes(p.cropId)) return p;
  const c = libCrop(p.cropId) || {}, i = soilCount++;
  if (i % 3 === 0 && !('dtm' in p)) { p.dtm = Math.max(20, Math.round((c.dtm || 50) * (i % 2 ? 1 : 0.95))); p.timingMode = 'manual'; }
  if (i % 4 === 1 && !('hw' in p)) { p.hw = c.hw || 14; p.harvestMode = 'window'; p.turnover = 7; }
  if (i % 11 === 2 && !('yield' in p)) p.yield = +(((c.yield || 1) * 0.8).toFixed(2));
  return p;
}
const put = (bed, date, cropId, o = {}) => { const p = dress({ id: 'x', bedId: bed.id, date, cropId, ...o }, bed); plantings.push(p); return p; };
/** The same, on the first day the ground is free again after everything already in that bed, and never before `date`. */
const then = (bed, date, cropId, o = {}) => { const free = plantings.filter(q => q.bedId === bed.id).map(q => add(through(q), 3)).sort().pop(); return put(bed, free && free > date ? free : date, cropId, o); };
/** When a planting gives its ground back, by the planner's own arithmetic. */
function through(p) {
  const eng = E.create({ v: 3, gardens, beds, plantings: [p], crops, varieties, customers, containers, map: MAP, settings, nursery, cropUnits }, Lib);
  const r = eng.calc(p); if (!r) throw Error('the planner cannot work out ' + JSON.stringify(p));
  return S(eng.occupancyThrough(p, r));
}
const COOL = ['lettuce_head', 'radish', 'carrot', 'beet', 'kale', 'kohlrabi', 'spinach', 'cabbage', 'broccoli', 'scallion', C.pakChoi.id, 'fennel'];
const WARM = ['bean_bush', 'cucumber_pickling', 'summer_squash', 'basil', 'zinnia', 'lettuce_head', 'carrot', 'radish'];
const FALL = ['lettuce_head', 'radish', 'kale', 'spinach', 'beet', 'kohlrabi', 'carrot'];
const withV = (cropId, o = {}) => { const v = vOf(cropId); return v ? { ...o, varietyId: v.id } : o; };
/** A bed worked through the season: one crop after another, each going in a little after the last has come out. */
function season(bed, startOffset, { lists = [COOL, WARM, FALL], share = null, dress = null } = {}) {
  let date = add(md(4, 12), startOffset), n = 0;
  for (;;) {
    const warm = date >= md(5, 15) && date <= md(7, 20), late = date > md(7, 20);
    if (date > md(9, 20)) break;
    const list = late ? lists[2] : warm ? lists[1] : lists[0], cropId = list[(bed.bed.length + n * 3 + startOffset) % list.length];
    const o = withV(cropId); if (share) o.ft = share;
    if (dress) Object.assign(o, dress(cropId, n));
    const p = put(bed, date, cropId, o);
    date = add(through(p), pick([3, 5, 8, 12, 20, 30, 45])); n++;   // some beds turn round in days, some stand open for weeks
    if (n > 5) break;
  }
}
chance('north field');
B.north.forEach((b, i) => {
  if (i < 6) {
    // six beds of head lettuce, a planting every ten days, half a bed at a time
    let date = add(md(4, 12), i * 10);
    for (let k = 0; k < 4 && date < md(9, 10); k++) {
      const first = put(b, date, 'lettuce_head', { ft: 11, ...withV('lettuce_head'), ...(k % 2 ? { rowsPerBed: '4', inRow: '10' } : {}) });
      const second = put(b, date, 'lettuce_head', { ft: 11, startFt: 11, ...withV('lettuce_head') });
      date = add([through(first), through(second)].sort().pop(), int(3, 9));
    }
  } else season(b, (i - 6) * 4, { dress: (cropId, n) => n === 1 && cropId === 'carrot' ? { rowsPerBed: '4', inRow: '1', growingDefaults: { v: 1, cropId, crop: { mk: { present: true, value: 1 } } } } : {} });
});
chance('south field');
B.south.forEach((b, i) => i < 12 && season(b, i * 3 % 17, { dress: (cropId, n) => n === 0 && i % 4 === 0 ? { growingDefaults: { v: 1, cropId, crop: {} } } : {} }));
chance('long rows');
// Long Rows: two beds shared by rows, one of onions with a yield of its own, one of shallots
const split = (bed, date, pairs, rowsPerBed, inRow, rowSp, groupId = 'split:' + uid()) => pairs.forEach(([cropId, rowStart, rowCount, ft, startFt, extra], k) => {
  const v = vOf(cropId, k);
  put(bed, date, cropId, { inRow, rowsPerBed, rowSp, ft, variety: v ? v.name : undefined, bedLayout: { v: 1, groupId, rowStart, rowCount, startFt: startFt || 0 }, ...(extra || {}), ...(v ? { varietyId: v.id } : {}) });
});
split(B.long[0], md(4, 20), [['potato', 0, 1, 80], ['potato', 1, 1, 80]], 2, 8, 36);
{ const out = plantings.filter(q => q.bedId === B.long[0].id).map(through).sort().pop(); put(B.long[0], add(out, -10), 'cabbage', { inRow: 16, rowsPerBed: 2, ...withV('cabbage') }); }   // in ten days before the potatoes are out: ground booked twice, on purpose
split(B.long[1], md(5, 17), [['tomato_cherry', 0, 1, 25, 0, { growingDefaults: { v: 1, cropId: 'tomato_cherry', crop: { rowsPerBed: { present: false }, inRow: { present: true, value: 24 } } } }], ['tomato_cherry', 1, 1, 25], ['pepper', 0, 2, 30, 25], ['eggplant_asian', 0, 2, 25, 55]], 2, 16, 48);
put(B.long[2], md(4, 20), 'onion', { growingDefaults: { v: 1, cropId: 'onion', crop: {} }, yield: 0.15, ...withV('onion') });
then(B.long[2], md(8, 20), 'kale', { ft: 50, rowsPerBed: '3', inRow: '12', ...withV('kale') });
put(B.long[3], md(4, 22), C.shallot.id, { inRow: 16, ...withV(C.shallot.id) });
then(B.long[3], md(8, 16), 'cabbage', { inRow: 16, rowsPerBed: 2, ...withV('cabbage') });
chance('east strip');
B.east.forEach((b, i) => i < 7 && season(b, i * 5 % 19));
// Two beds that come free in the last week of July and stay free: a series sent to the field gardens on two days a fortnight
// apart finds ground on the second day that was not there on the first.
for (const [bed, cropId] of [[B.east[7], 'bean_bush'], [B.south[12], 'beet']]) {
  for (let date = md(4, 20); date < md(7, 1); date = add(date, 1)) {
    const p = { id: 'x', bedId: bed.id, date, cropId, ...withV(cropId) }, out = through(p);
    if (out >= md(7, 23) && out <= md(7, 30)) { plantings.push(p); break; }
  }
  if (!plantings.some(p => p.bedId === bed.id)) throw Error('no day puts ' + cropId + ' out of the ground in the last week of July');
}
chance('kitchen garden');
// Kitchen Garden: celeriac, bush tomatoes, fennel, parsley shared by rows
put(B.kitchen[0], md(5, 25), C.bushTomato.id, { inRow: 24, rowsPerBed: 1, growingDefaults: { v: 1, cropId: C.bushTomato.id, crop: { rowsPerBed: { present: false } } }, ...withV(C.bushTomato.id) });
put(B.kitchen[1], md(5, 25), C.bushTomato.id, { rowsPerBed: 1, growingDefaults: { v: 1, cropId: C.bushTomato.id, crop: { rowsPerBed: { present: false } } }, yield: 12, ...withV(C.bushTomato.id) });
put(B.kitchen[2], md(4, 27), 'fennel', { rowsPerBed: 3, ...withV('fennel') });
then(B.kitchen[2], md(7, 30), 'kale', { ft: 20, rowsPerBed: '3', inRow: '12', ...withV('kale') });
put(B.kitchen[3], md(5, 4), C.celeriac.id, withV(C.celeriac.id));
split(B.kitchen[4], md(4, 27), [['parsley', 0, 2, 24, 0, { growingDefaults: { v: 1, cropId: 'parsley', crop: {} } }], ['parsley', 2, 1, 24]], 3, 8, 12);
put(B.kitchen[5], md(5, 18), 'eggplant_asian', { inRow: 16, growingDefaults: { v: 1, cropId: 'eggplant_asian', crop: {} }, ...withV('eggplant_asian') });
season(B.kitchen[6], 2); season(B.kitchen[7], 9);
chance('berry rows');
// Berry Rows: cane berries that stand for years, and two beds of annuals beside them
put(B.berry[0], md(4, 12), 'raspberry', { variety: byCrop.raspberry[0].name, growingDefaults: { v: 1, cropId: 'raspberry', crop: { rowsPerBed: { present: false } } }, yield: 0.75, yieldBasis: 'plant', varietyId: byCrop.raspberry[0].id });
put(B.berry[1], md(4, 12), 'raspberry', { inRow: 32, varietyId: byCrop.raspberry[1].id });
put(B.berry[2], md(4, 12), 'blackberry', { growingDefaults: { v: 1, cropId: 'blackberry', crop: { rowsPerBed: { present: false } } }, varietyId: byCrop.blackberry[0].id });
put(B.berry[3], md(4, 27), 'cabbage', { inRow: 16, rowsPerBed: 2, ...withV('cabbage') });
then(B.berry[3], md(8, 5), 'kale', { ft: 50, rowsPerBed: '3', inRow: '12', ...withV('kale') });
put(B.berry[4], md(5, 18), 'pepper', { inRow: 16, growingDefaults: { v: 1, cropId: 'pepper', crop: {} }, ...withV('pepper') });
chance('flower block');
// Flower Block: dahlias from tubers, and cut flowers from plugs
B.flower.forEach((b, i) => {
  if (i < 4) put(b, md(5, 11), 'dahlia', { inRow: 16, rowsPerBed: 2, growingDefaults: { v: 1, cropId: 'dahlia', crop: { rowsPerBed: { present: false }, inRow: { present: true, value: 18 } } }, ...(i < 3 ? { varietyId: byCrop.dahlia[i].id } : {}) });
  else if (i < 6) put(b, md(5, 18), 'zinnia', { inRow: 12, growingDefaults: { v: 1, cropId: 'zinnia', crop: {} }, ...withV('zinnia') });
  else if (i === 6) put(b, md(6, 1), 'cosmos', { variety: byCrop.cosmos[0].name, growingDefaults: { v: 1, cropId: 'cosmos', crop: {} }, varietyId: byCrop.cosmos[0].id });
  else if (i === 7) { put(b, md(5, 11), C.yarrow.id, withV(C.yarrow.id)); }
  else if (i === 8) { put(b, md(5, 11), C.statice.id, withV(C.statice.id)); }
  else { put(b, md(4, 27), 'snapdragon', withV('snapdragon')); then(b, md(8, 10), 'stock', withV('stock')); }
});
chance('shade house');
// Shade House: beds shared by rows, and pak choi with no checked yield
split(B.shade[0], md(4, 12), [[C.yarrow.id, 0, 1, 10], [C.statice.id, 1, 1, 10], [C.yarrow.id, 2, 2, 10]], 4, 12, 12);
put(B.shade[1], md(4, 27), C.pakChoi.id, withV(C.pakChoi.id)); then(B.shade[1], md(7, 1), C.pakChoi.id, withV(C.pakChoi.id));
put(B.shade[2], md(4, 27), 'lettuce_head', withV('lettuce_head')); then(B.shade[2], md(7, 12), 'basil', withV('basil'));
split(B.shade[3], md(4, 27), [['parsley', 0, 2, 24, 0, { growingDefaults: { v: 1, cropId: 'parsley', crop: {} } }], ['basil', 2, 1, 24]], 3, 8, 12);
put(B.shade[4], md(5, 4), 'chard', withV('chard')); put(B.shade[5], md(5, 4), 'celery', withV('celery'));
chance('houses');
// House A and House B: tomatoes, peppers and cucumbers with yields of their own
split(B.houseA[0], md(5, 15), [['tomato', 0, 2, 20, 0, { growingDefaults: { v: 1, cropId: 'tomato', crop: { inRow: { present: true, value: 24 }, rowsPerBed: { present: false }, price: { present: true, value: 3.5 } } }, yield: 15 }], ['tomato', 0, 2, 20, 20, { yield: 15 }]], 2, 16, 48);
put(B.houseA[1], md(4, 1), 'tomato', { inRow: 16, rowsPerBed: 2, growingDefaults: { v: 1, cropId: 'tomato', crop: { inRow: { present: true, value: 24 }, rowsPerBed: { present: false }, price: { present: true, value: 3.5 } } }, yield: 15, ...withV('tomato') });
put(B.houseA[2], md(4, 1), 'tomato', { inRow: 18, rowsPerBed: 2, rowSp: 20, lrfTrellis: { v: 1, type: 'vertical' }, yield: 6, ...withV('tomato') });
put(B.houseA[3], md(4, 8), 'tomato_cherry', { inRow: 16, rowsPerBed: 2, ...withV('tomato_cherry') });
put(B.houseB[0], md(4, 1), 'cucumber', { growingDefaults: { v: 1, cropId: 'cucumber', crop: {} }, yield: 12, ...withV('cucumber') });
then(B.houseB[0], md(7, 20), 'cucumber', { variety: byCrop.cucumber[1].name, growingDefaults: { v: 1, cropId: 'cucumber', crop: {} }, yield: 12, varietyId: byCrop.cucumber[1].id });
put(B.houseB[1], md(4, 1), 'pepper', { inRow: 16, growingDefaults: { v: 1, cropId: 'pepper', crop: {} }, yield: 4.5, ...withV('pepper') });
put(B.houseB[2], md(4, 8), 'basil', withV('basil')); then(B.houseB[2], md(7, 26), 'basil', withV('basil'));
chance('tunnel');
// The tunnel: mini cucumbers early and late, and two rounds of vining cucumbers
put(B.tunnel[0], md(5, 4), 'cucumber', { growingDefaults: { v: 1, cropId: 'cucumber', crop: {} }, yield: 12, ...withV('cucumber') });
then(B.tunnel[0], md(7, 20), 'cucumber', { growingDefaults: { v: 1, cropId: 'cucumber', crop: {} }, yield: 12, ...withV('cucumber') });
put(B.tunnel[1], md(4, 6), C.miniCuke.id, { inRow: 3, growingDefaults: { v: 1, cropId: C.miniCuke.id, crop: { inRow: { present: true, value: 12 }, price: { present: true, value: 2 }, mk: { present: true, value: 0.9 } } }, ...withV(C.miniCuke.id) });
then(B.tunnel[1], md(9, 8), C.miniCuke.id, { ft: 40, rowsPerBed: '5', inRow: '3', ...withV(C.miniCuke.id) });
chance('towers');
// Towers: a cycle every four weeks, head lettuce in most, basil in three. Eight towers side by side turn over on the same day.
[...B.tower1, ...B.tower2].forEach((b, i) => {
  const basil = i % 9 === 4, cropId = basil ? 'basil' : 'lettuce_head', v = vOf(cropId, i);
  for (let date = add(md(4, 22), Math.floor((i % 16) / 8) * 7 + Math.floor(i / 16) * 14), k = 0; date <= md(10, 12) && k < 7; date = add(date, 28), k++)
    put(b, date, cropId, { dtm: 28, hw: 1, harvestMode: 'window', turnover: 0, timingMode: 'manual', towerCycle: { v: 1, days: 28, replantSameDay: true },
      ...(basil ? { growingDefaults: { v: 1, cropId, crop: { rowsPerBed: { present: false } } } } : {}), varietyId: (k % 3 === 2 ? vOf(cropId, i + k) : v).id });
});
chance('crates');
// Crates: bulbs and cut flowers set out month by month, the first rounds started under cover and moved out
const crate = B.crates[0], herbCrate = B.crates[1];
const crateNote = (month, n, per, what) => `${month} crates: ${n} crate(s), ${per} ${what} to a crate. A planning estimate, to be checked against the first round.`;
[[md(3, 1), 'March', true], [md(4, 5), 'April', true], [md(5, 3), 'May', false], [md(6, 7), 'June', false], [md(7, 5), 'July', false], [md(8, 2), 'August', false]].forEach(([date, month, sheltered], round) => {
  const sh = sheltered ? { shelter: { gardenId: 'nursery' }, out: md(5, 10) } : { shelter: null };
  for (const [c, per, dtm, hw, n] of [[C.freesia, 12, 100, 7, 4], [C.anemone, 8, 56, 28, 2], [C.crocosmia, 30, 80, 14, 2]]) {
    if (round > 3 && c === C.freesia) continue;
    // one number of days to a variety: a variety with two would be two lines of the review, and that is a case of its own
    for (let k = 0; k < n; k++) { const list = byCrop[c.id].filter(v => !v.deleted), vi = (k + round) % list.length;
      put(crate, date, c.id, { dtm: dtm + (vi % 2) * 5, hw, yield: 1, yieldBasis: 'plant', ft: 1, perC: per, harvestMode: 'window', turnover: 7, timingMode: 'manual',
        note: crateNote(month, 1, per, 'bulbs'), ...sh, growingDefaults: { v: 1, cropId: c.id, crop: {} }, varietyId: list[vi].id }); }
  }
  if (round >= 1) for (let k = 0; k < 3; k++) put(crate, date, 'snapdragon', { ft: k ? 1 : 3, perC: 24, harvestMode: 'window', hw: 14, turnover: 7, yield: 1, yieldBasis: 'plant', timingMode: 'manual', dtm: 58 + k * 5, ...sh, note: crateNote(month, k ? 1 : 3, 24, 'plants'), varietyId: vOf('snapdragon', k).id });
  if (round >= 2) for (let k = 0; k < 3; k++) put(crate, date, 'sunflower', { ft: k ? 1 : 2, perC: 24, harvestMode: 'window', hw: 7, turnover: 7, yield: 1, yieldBasis: 'plant', timingMode: 'manual', dtm: 50, shelter: null, note: crateNote(month, k ? 1 : 2, 24, 'seeds'), varietyId: vOf('sunflower', k).id });
  if (round >= 2 && round <= 4) put(crate, date, 'stock', { ft: 1, perC: 24, harvestMode: 'window', hw: 14, turnover: 7, yield: 1, yieldBasis: 'plant', timingMode: 'manual', dtm: 48, shelter: null, note: crateNote(month, 1, 24, 'plants'), varietyId: vOf('stock', round).id });
});
// Herb crates: a few crates of each, set out afresh every month
[md(5, 3), md(6, 7), md(7, 5), md(8, 2), md(9, 6)].forEach((date, round) => { for (const [cropId, n] of [['basil', 2], ['parsley', 1], ['chard', 1], ['scallion', 1], ['lettuce_head', 2], ['spinach', 1]]) put(herbCrate, date, cropId, { ft: n, perC: 6, hw: 21, harvestMode: 'window', turnover: 3, ...withV(cropId) }); });
chance('pots');
// Pots: cane berries, one group on a trellis
put(B.pots[0], md(4, 12), 'raspberry', { growingDefaults: { v: 1, cropId: 'raspberry', crop: { rowsPerBed: { present: false } } }, yield: 0.75, varietyId: byCrop.raspberry[2].id });
put(B.pots[1], md(4, 12), 'raspberry', { growingDefaults: { v: 1, cropId: 'raspberry', crop: { rowsPerBed: { present: false } } }, yield: 2 });
put(B.pots[2], md(4, 12), 'raspberry', { perC: 1, lrfTrellis: { v: 1, type: 'vertical' }, growingDefaults: { v: 1, cropId: 'raspberry', crop: { rowsPerBed: { present: false } } }, yield: 0.75, varietyId: byCrop.raspberry[3].id });
put(B.pots[3], md(4, 12), 'blackberry', { perC: 1, varietyId: byCrop.blackberry[1].id });

chance('booked twice');
// Ground booked twice: a second crop put in before the first is out, mostly by a week or so of turnover
const taken = new Set();
const firstOf = bed => plantings.find(p => p.bedId === bed.id && !p.bedLayout && !('ft' in p));
[B.south[1], B.south[4], B.south[7], B.south[10], B.east[1], B.east[3], B.east[6], B.north[8], B.north[11], B.kitchen[6], B.kitchen[7], B.south[11]].forEach((b, i) => {
  const first = firstOf(b); if (!first || taken.has(b.id)) return; taken.add(b.id);
  const end = through(first), cropId = ['radish', 'lettuce_head', 'spinach', 'beet'][i % 4];
  put(b, add(end, -int(3, 9)), cropId, withV(cropId));
});
chance('too long');
// Plantings longer than their bed
[B.north[7], B.south[2], B.south[9], B.east[4], B.east[5], B.north[9], B.kitchen[3]].forEach((b, i) => { const p = plantings.find(x => x.bedId === b.id && !x.bedLayout); if (p) p.ft = b.l + 6 + i * 2; });

chance('live trays');
// ── live trays for a restaurant, every week from May to Thanksgiving ──
let farm = { v: 3, gardens, crops, customers, cropUnits, salesMix: {}, containers, nursery,
  planningPreferences: { v: 1, gardenOrder: [G.north.id, G.south.id, G.east.id], sowWeekday: null, minBatch: 1, checkNursery: true, labor: { weeklyHours: null, otherHours: 0, byCrop: {} }, mode: 'beds', dateBasis: 'planting', bedsPerSuccession: 3, every: 10 },
  liveTrayPlans: [], map: MAP, settings, varieties, beds, plantings };
const demand = { ...Trays.draft(YEAR), name: 'Corner Bistro · 2027 live trays', customerId: 'c-corner-bistro', from: monday(md(5, 3)),
  rows: [[M.mizuna, 21, 24, 4, 7, 1], [M.cress, 21, 24, 3, 6, 0], [M.amaranth, 35, 26, 2, 3, 2], [M.shiso, 35, 26, 2, 3, 1], [M.chervil, 35, 26, 2, 3, 1], [M.nasturtium, 35, 26, 1, 2, 2]]
    .map(([c, days, price, spring, summer, fall]) => ({ id: uid(), name: c.name.replace(/^Micro - /, ''), days, price, spring, summer, fall, cropId: c.id })) };
farm = Trays.apply(farm, demand, { uid, crop: id => crops.find(c => c.id === id), now: '2026-11-01T12:00:00.000Z' }).plan;
farm.plantings.forEach((p, i) => { p.id = 'p' + String(i + 1).padStart(4, '0'); });

// ── what the planner makes of it ──
const eng = E.create(farm, Lib);
const bad = farm.plantings.filter(p => !eng.calc(p));
if (bad.length) throw Error(`${bad.length} plantings the planner cannot work out, the first ${JSON.stringify(bad[0])}`);
let over = 0; const pairs = new Set();
for (const p of farm.plantings) { const r = eng.calc(p); if (eng.overflow(p, r)) over++; for (const o of eng.conflicts(p, r)) pairs.add([p.id, o.p ? o.p.id : 'rest'].sort().join('|')); }
const kinds = {}; for (const p of farm.plantings) { const k = eng.calc(p).kind; kinds[k] = (kinds[k] || 0) + 1; }

chance('seed');
// ── seed on hand and on order, and what the supplier sells it in ──
const lots = [], adjustments = [], receipts = [], packs = {};
const live = farm.varieties.filter(v => !v.deleted && !v.stub);
const order = (n, date, at, status) => {
  const orderNumber = String(int(10000000, 99999999)), id = 'order-' + crypto.createHash('sha256').update('order ' + orderNumber).digest('hex'), mine = [], lines = [];
  for (let k = 0; k < n; k++) {
    const v = live[(lots.length * 7 + 3) % live.length], size = v.seedsPerPacket || 100, cost = +(4 + rnd() * 30).toFixed(2), cropName = (libCrop(v.cropId) || {}).name || '';
    const lot = { quantity: size, year: status === 'ordered' ? 2026 : null, supplier: v.supplier, lotNumber: '', usable: status !== 'ordered', storageNote: '', note: status === 'ordered' ? 'On order · use Received when delivered.' : 'Received seed order / invoice',
      key: 'v:' + v.id, unit: 'seeds', ...(status === 'ordered' ? { status: 'ordered', orderDate: date, packLabel: `${size} Seeds`, purchasedQuantity: size, cost } : {}), unitPrice: cost, packSize: size, packs: 1, purchaseWeightG: null,
      seedCountSource: `Order size: ${size} Seeds`, invoiceId: id, orderNumber, orderLineId: `line-${v.sku}-${k}`, productCode: v.sku, productURL: v.url, sourceText: `${v.name} · ${cropName} seed · Product ID: ${v.sku} · Size: ${size} Seeds · Quantity: 1`,
      id: 'seed_lot_' + uid(), createdAt: at, updatedAt: at, name: `${cropName} · ${v.name}` };
    lots.push(lot); mine.push(lot.id); lines.push(lot.orderLineId);
    adjustments.push({ id: 'seed_adjustment_' + uid(), lotId: lot.id, at, kind: 'add', reason: '', before: null, after: { ...lot } });
  }
  receipts.push({ id, orderNumber, orderDate: date, sourceName: 'Order history (made up).html', lotIds: mine, lineIds: lines });
};
order(9, '10/2/26', '2026-10-06T16:21:45.028Z', 'usable'); order(12, '10/20/26', '2026-10-24T14:02:11.000Z', 'usable'); order(14, '11/5/26', '2026-11-07T19:06:43.565Z', 'ordered'); order(10, '11/9/26', '2026-11-10T09:30:00.000Z', 'ordered');
// stock typed in by hand: seed, and plants for the cane berries
for (const [v, quantity, unit] of [[byCrop.radish[0], 1000, 'seeds'], [byCrop.carrot[0], 5000, 'seeds'], [byCrop.bean_bush[0], 800, 'seeds'], [byCrop.blackberry[0], 7, 'plants'], [byCrop.raspberry[0], 12, 'plants'], [byCrop.lettuce_head[0], 2000, 'seeds'], [byCrop.kale[0], 300, 'seeds']]) {
  const at = '2026-11-08T02:31:45.274Z', lot = { quantity, year: unit === 'plants' ? 2025 : 2026, supplier: '', lotNumber: '', usable: true, storageNote: '', note: '', key: 'v:' + v.id, unit, status: 'usable', germination: { percent: null, date: '' },
    id: 'seed_lot_' + uid(), createdAt: at, updatedAt: at, name: `${(libCrop(v.cropId) || {}).name || ''} · ${v.name}` };
  lots.push(lot); adjustments.push({ id: 'seed_adjustment_' + uid(), lotId: lot.id, at, kind: 'add', reason: '', before: null, after: { ...lot } });
}
for (const v of live) {
  if (rnd() < 0.15) continue;
  const base = +(3 + rnd() * 6).toFixed(2), sizes = [v.seedsPerPacket || 50, 250, 1000, 5000].filter((x, i, a) => a.indexOf(x) === i).sort((a, b) => a - b);
  packs[v.id] = [{ label: 'Listed offer', price: base }, ...sizes.map((n, i) => ({ label: i ? `${n.toLocaleString('en-US')} Seeds` : 'Packet', price: +(base * (1 + i * 2.6)).toFixed(2), seeds: n }))];
}
const inventory = { v: 1, lots, adjustments, legacyImported: {}, performanceNotes: {}, importReceipts: receipts };

// ── write ──
fs.mkdirSync(OUT, { recursive: true });
const write = (name, value) => fs.writeFileSync(path.join(OUT, name), typeof value === 'string' ? value : JSON.stringify(value));
write('layout.json', JSON.stringify({ map: MAP, blocks, beds: farm.beds.filter(b => b.px).map(b => ({ garden: b.gardenId, type: b.type, w: b.w, l: b.l, x: b.px.x, y: b.px.y, rot: b.px.rot, count: b.count || 0 })),
  scale: Object.fromEntries(gardens.map(g => [g.id, g.mapScale || 1])), varieties: farm.varieties.filter(v => !v.deleted).map((v, i) => ({ id: v.id, color: eng.cropColor(eng.crop(v.cropId)), n: i })) }, null, 1));
const photoFile = path.join(OUT, 'farm-map.jpg');
if (!fs.existsSync(photoFile)) { console.log(JSON.stringify({ wrote: 'layout.json', next: 'python3 -I make_pictures.py <out dir>, then run this again' })); process.exit(0); }
const sha = crypto.createHash('sha256').update(fs.readFileSync(photoFile)).digest('hex');
farm.map = { ...MAP, imageFile: { name: 'farm-map.jpg', mime: 'image/jpeg', sha256: sha } };
const compact = IO.pack(farm), back = IO.unpack(compact);
const canon = x => JSON.stringify(x, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
if (canon(back.plantings) !== canon(farm.plantings) || canon(back.beds) !== canon(farm.beds)) throw Error('the compact plan does not give the beds and plantings back as they were written');
farm.plantings = back.plantings; farm.beds = back.beds;   // one order of fields in both files
write('plan.json', compact);
write('backup-plan.json', IO.join(farm, { v: 1, rest: {}, varieties: {} }));
write('inventory.json', inventory); write('packs.json', packs);
const made = '2026-11-14T12:00:00.000Z';
write('plan-info.json', JSON.stringify({ backup: made, counts: IO.summary(farm), mapImage: { src: 'data/farm-map.jpg', sha256: sha }, inventory: 'data/inventory.json', thumbs: 'data/thumbs.json', packs: 'data/packs.json',
  corrections: [], keep: { trayStart: 'monday' } }, null, 1));
console.log(JSON.stringify({ ...IO.summary(farm), kinds, bookedTwice: pairs.size, longerThanBed: over, lots: lots.length, packs: Object.keys(packs).length, varietiesWithPhoto: farm.varieties.filter(v => !v.deleted).length, photo: sha.slice(0, 12) }));
