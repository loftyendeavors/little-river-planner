// The map's look (preview 0.40): a crop takes the colour of its group. What can be proven without a browser, and stays true
// of every build after it:
//   - the colours can be told apart, by ordinary sight and by red-green colour-blind sight, growing and being picked;
//   - every crop of the farm falls in a group, by the rule the build states.
// (That the build touched nothing in engine.js and library.js but cropColor, colorGroup and the colour groups was proven
// once, on the build itself, by comparing the two programs with those set aside. That proof belongs to one build and would
// fail the next one that changes the engine, so it is not kept here; that no figure moves is proven on every build by the
// checks that are given the build before's scripts: tests/quick.sh.)
// node look_a_test.cjs <app-dir> <plan.json: a backup's or the shipped compact one>
const path = require('path'), fs = require('fs');
const [APP, PLAN] = process.argv.slice(2);
const results = [], fail = [];
let finished = false, stopped = '';
process.on('uncaughtException', e => { stopped = String(e && e.stack || e).split('\n').slice(0, 3).join(' | '); process.exit(1); });
process.on('exit', () => { if (!finished) { results.push(`FAIL (the test stopped before its end) ${stopped}`); fail.push('(the test stopped before its end)'); } console.log(results.join('\n')); console.log(JSON.stringify({ passed: results.length - fail.length, of: results.length, failed: fail, figures: FIG })); });
const check = (name, ok, detail) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 700)}`); if (!ok) fail.push(name); };
const FIG = {};
global.window = global;
const E = require(path.join(APP, 'js/engine.js')), IO = require(path.join(APP, 'js/planio.js'));
const L = require(path.join(APP, 'js/library.js')), Lib = global.LRFLibrary || L;
const F = require(path.join(APP, 'js/forecast.js'));
const raw = JSON.parse(fs.readFileSync(PLAN, 'utf8')), core = raw.format ? IO.unpack(raw) : IO.split(raw).core;
const clone = x => JSON.parse(JSON.stringify(x));
const eng = E.create(core, Lib);

// ── 1. the colours ──
const look = Lib.colorGroups || {}, groups = look.groups || [];
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lab = ([r, g, b]) => { [r, g, b] = [lin(r), lin(g), lin(b)]; const t = v => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const x = t((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = t(0.2126 * r + 0.7152 * g + 0.0722 * b), z = t((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883); return [116 * y - 16, 500 * (x - y), 200 * (y - z)]; };
const apart = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));   // how far apart two colours look (CIE76)
// red-green colour-blind sight, the commonest kind (deuteranopia; Machado, Oliveira and Fernandes 2009)
const deut = ([r, g, b]) => { const v = [lin(r), lin(g), lin(b)], M = [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]];
  return M.map(row => { const x = Math.min(1, Math.max(0, row[0] * v[0] + row[1] * v[1] + row[2] * v[2])); return Math.round((x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255); }); };
const mapText = fs.readFileSync(path.join(APP, 'js/map.js'), 'utf8'), PICK = +((/const PICK = ([0-9.]+)/.exec(mapText) || [])[1] || NaN), ROWS = +((/ROWS = ([0-9.]+)/.exec(mapText) || [])[1] || NaN);
const deeper = (c, k) => c.map(v => Math.round(v * (1 - k)));
{
  const ok = groups.length === 12 && groups.every(g => /^[a-z]+$/.test(g.id) && g.name && /^#[0-9a-f]{6}$/.test(g.color)) && new Set(groups.map(g => g.id)).size === 12 && new Set(groups.map(g => g.name)).size === 12;
  check('there are twelve groups, each with a name and a colour of its own', ok, groups.map(g => g.id));
  check('every family the library sends to a group sends it to one that is there', Object.keys(look.byFamily || {}).length >= 10 && Object.values(look.byFamily || {}).every(id => groups.some(g => g.id === id)), look.byFamily);
  const pairs = []; for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) pairs.push([groups[i], groups[j]]);
  const least = (fn) => pairs.map(([a, b]) => ({ d: +fn(rgb(a.color), rgb(b.color)).toFixed(1), pair: a.id + ' / ' + b.id })).sort((x, y) => x.d - y.d)[0] || { d: 0 };
  const plain = least(apart), blind = least((a, b) => apart(deut(a), deut(b)));
  FIG.closest = plain; FIG.closestColourBlind = blind;
  check('any two groups are plainly different colours (20 apart or more; a difference of about 2 can just be seen)', plain.d >= 20, plain);
  check('and they stay apart for red-green colour-blind sight (10 apart or more)', blind.d >= 10, blind);
  check('a bed being picked is 30% deeper than one growing, and its row lines deeper again', PICK === 0.3 && ROWS > 0.1 && ROWS < 0.5, { PICK, ROWS });
  const stage = groups.map(g => ({ id: g.id, d: +apart(rgb(g.color), deeper(rgb(g.color), PICK)).toFixed(1) })).sort((a, b) => a.d - b.d)[0];
  FIG.growingAgainstPicked = stage;
  check('in every group a bed being picked can be told from one growing (12 apart or more)', stage && stage.d >= 12, stage);
  const crossed = []; for (const a of groups) for (const b of groups) if (a !== b) crossed.push({ d: +apart(deeper(rgb(a.color), PICK), rgb(b.color)).toFixed(1), pair: a.id + ' picked / ' + b.id });
  crossed.sort((x, y) => x.d - y.d); FIG.pickedAgainstAnother = crossed[0];
  check('and a bed being picked is not taken for another group’s growing (15 apart or more)', crossed.length > 100 && crossed[0].d >= 15, crossed[0]);
  // against the ground they are drawn on: an empty bed (white) and a garden’s plate (grey-green)
  const ground = groups.map(g => ({ id: g.id, d: +Math.min(apart(rgb(g.color), [251, 252, 251]), apart(rgb(g.color), [214, 223, 217])).toFixed(1) })).sort((a, b) => a.d - b.d)[0];
  check('every group stands off an empty bed and off its garden’s plate (25 apart or more)', ground && ground.d >= 25, ground);
}

// ── 2. which group a crop falls in ──
{
  const crops = eng.crops(), by = id => groups.find(g => g.id === id);
  const forecast = new Map(F.build(eng).rows.map(r => [r.cropId, r.group]));
  const wrong = [], seen = new Set();
  for (const c of crops) {
    const g = eng.colorGroup(c); seen.add(g.id);
    if (!by(g.id) || by(g.id) !== g) wrong.push([c.name, 'no such group', g.id]);
    else if (!c.color && eng.cropColor(c) !== g.color) wrong.push([c.name, 'colour is not its group’s', eng.cropColor(c)]);
    const kind = F.groupOf(c, (core.cropUnits && core.cropUnits[c.id] && core.cropUnits[c.id].base) || c.baseUnit || 'each', (core.lrfNext || {}).groups);
    const want = kind === 'micro' ? 'micro' : kind === 'flower' ? 'flowers' : (look.byFamily || {})[c.family] || 'other';
    if (g.id !== want) wrong.push([c.name, 'want ' + want, g.id]);
    if (forecast.has(c.id) && (forecast.get(c.id) === 'flower') !== (g.id === 'flowers')) wrong.push([c.name, 'the forecast says ' + forecast.get(c.id), g.id]);
    if (forecast.has(c.id) && (forecast.get(c.id) === 'micro') !== (g.id === 'micro')) wrong.push([c.name, 'the forecast says ' + forecast.get(c.id), g.id]);
  }
  FIG.crops = crops.length; FIG.groupsOnTheFarm = seen.size;
  check('the farm has crops in eight groups or more, flowers and microgreens among them: the lines below have their subjects', seen.size >= 8 && seen.has('flowers') && seen.has('micro') && forecast.size > 20, [...seen]);
  check('every crop falls in a group: flowers and microgreens as the forecast keeps them, the rest by plant family, and its colour is the group’s', crops.length > 60 && !wrong.length, wrong.slice(0, 6));
  check('no crop and a crop that is not known have a colour all the same', /^#[0-9a-f]{6}$/.test(eng.cropColor(null)) && eng.colorGroup(null).id === 'other' && eng.colorGroup({ id: 'x', name: 'Nothing known' }).id === 'other');
  // a colour given to the crop itself still wins, and does not move its group
  const produce = crops.find(c => !c.color && eng.colorGroup(c).id === 'brassicas'), flower = crops.find(c => !c.color && eng.colorGroup(c).id === 'flowers' && (look.byFamily || {})[c.family]);
  check('the farm has a brassica and a flower of a family that has a group: the lines below have their subjects', !!produce && !!flower, { produce: !!produce, flower: !!flower });
  if (produce && flower) {
    check('a colour given to the crop itself still wins, and its group is as before', eng.cropColor({ ...produce, color: '#123456' }) === '#123456' && eng.colorGroup({ ...produce, color: '#123456' }).id === 'brassicas');
    // what the plan says of a crop comes before its unit and its name, as in the forecast
    const said = E.create({ ...clone(core), lrfNext: { ...clone(core.lrfNext || {}), groups: { ...((core.lrfNext || {}).groups || {}), [produce.id]: 'flower', [flower.id]: 'produce' } } }, Lib);
    check('what the plan says of a crop, flower or produce, decides its colour too', said.colorGroup(said.crop(produce.id)).id === 'flowers' && said.colorGroup(said.crop(flower.id)).id === look.byFamily[flower.family], [said.colorGroup(said.crop(produce.id)).id, said.colorGroup(said.crop(flower.id)).id]);
    check('a crop whose family has no group is among the other crops, and one with no family too', eng.colorGroup({ ...produce, family: 'Grass' }).id === 'other' && eng.colorGroup({ ...produce, family: '' }).id === 'other' && eng.colorGroup({ ...produce, family: 'Cover crop' }).id === 'other');
  }
}

finished = true;
