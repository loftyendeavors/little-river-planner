"""Deliberate faults for N2, bought-in plants: what a planting is started from and what a planting bought in needs (js/engine.js,
js/sowing.js), how Seeds counts it and the order sheet rounds and groups it (js/seedlib.js), the compact plan (js/planio.js), and the
Seeds page that says and sets it (js/seeds.js). Each is put into a copy of the app folder, and a line of bought_test.cjs (node) or
bought_check.py (page) that passed with no fault in it must fail.
usage: python3 -I mutate_bought.py <app> <scratch> <tests-dir> <plan.json> [node | page | list] [words…]     env FROM=, TO= to run a part
node: seconds a fault. page: about twenty seconds a fault. list: how many faults there are, and nothing else.
"""
import json, os, shutil, subprocess, sys
from pathlib import Path
app, scratch, tests, plan = [Path(x).resolve() for x in sys.argv[1:5]]
mode = sys.argv[5] if len(sys.argv) > 5 else "node"; words = [w.lower() for w in sys.argv[6:]]
EN, SW, SL, PI, SD = "js/engine.js", "js/sowing.js", "js/seedlib.js", "js/planio.js", "js/seeds.js"
NODE = [
 ("a planting's own word is not read", EN, "return SOURCES.includes(said) && SOURCES.includes(p.startedFrom) ? p.startedFrom : said;", "return said;"),
 ("a planting's word is read over a bulb crop's", EN, "return SOURCES.includes(said) && SOURCES.includes(p.startedFrom) ? p.startedFrom : said;", "return SOURCES.includes(p.startedFrom) ? p.startedFrom : said;"),
 ("any word a planting says is read", EN, "return SOURCES.includes(said) && SOURCES.includes(p.startedFrom) ? p.startedFrom : said;", "return SOURCES.includes(said) && p.startedFrom ? p.startedFrom : said;"),
 ("the planting's old record of its crop is not read", EN, "const held = c || (p ? growingCrop(p) : null);", "const held = p ? crop(p.cropId) : c;"),
 ("a live tray can be bought in", EN, "if (!held || held.micro) return 'seed';", "if (!held) return 'seed';"),
 ("a bought-in planting is still sown", EN, "if (boughtIn) { seeds = 0; seedG = 0; cells = 0; trays = 0; gh = null; }", "if (boughtIn) { seeds = 0; seedG = 0; }"),
 ("a bought-in planting keeps its sowing day", EN, "if (boughtIn) { seeds = 0; seedG = 0; cells = 0; trays = 0; gh = null; }", "if (boughtIn) { seeds = 0; seedG = 0; cells = 0; trays = 0; }"),
 ("no spare on plants bought in", EN, "const buy = boughtIn ? Math.ceil(plants * buffer - 1e-9) : 0;", "const buy = boughtIn ? Math.ceil(plants) : 0;"),
 ("the spare counted twice", EN, "const buy = boughtIn ? Math.ceil(plants * buffer - 1e-9) : 0;", "const buy = boughtIn ? Math.ceil(plants * buffer * buffer - 1e-9) : 0;"),
 ("a standing crop is bought in", EN, "const boughtIn = !rack && p.established !== true && startedFrom(p, c) === 'plant';", "const boughtIn = !rack && startedFrom(p, c) === 'plant';"),
 ("the sowing plan is made for a planting bought in", SW, "if (options.rack === true || options.boughtIn === true || planting.established", "if (options.rack === true || planting.established"),
 ("Seeds counts by the crop's word alone", SL, "if (engine.startedFrom) return engine.startedFrom(p, r.c);", ""),
 ("Seeds counts the plants without the spare", SL, "unit === 'plants' && r.boughtIn ? r.buy : (r.bulbs", "unit === 'plants' && r.boughtIn ? Math.ceil(r.plants) : (r.bulbs"),
 ("the lot is not rounded up", SL, "const n = Math.ceil(amount / lot - 1e-9);", "const n = Math.round(amount / lot);"),
 ("a lot that is not a whole number is taken", SL, "if (!(Number.isSafeInteger(lot) && lot > 0) || !(amount > 0)) return null;", "if (!(lot > 0) || !(amount > 0)) return null;"),
 ("plants are never rounded to lots", SL, "if (unit !== 'seeds' && unit !== 'g') return lotsOf(amount, unit, v);", ""),
 ("the order sheet buys the shortfall, not whole lots", SL, "sized = !!cover && (cover.how === 'sizes' || cover.how === 'lots');", "sized = !!cover && cover.how === 'sizes';"),
 ("plugs are listed under the seed house", SL, "return crop === 'seed' ? '' : supplierOf(v);", "return supplierOf(v);"),
 ("the grower the variety names is not read", SL, "if (own) return own;", ""),
 ("seed is listed under the plug grower", SL, "if (r.unit === 'seeds' || r.unit === 'g') return supplierOf(v);", "if ((r.unit === 'seeds' || r.unit === 'g') && !own) return supplierOf(v);"),
 ("the seed house's product code is given for plugs from a grower", SL, "sku: house ? v.sku || '' : '', unit: r.unit,", "sku: v.sku || '', unit: r.unit,"),
 ("stock in a variety's second unit is said not to count", SL, "if (isLive(v)) { if (unit && !list.includes(lot.unit)) out.push(", "if (isLive(v)) { if (unit && unit !== lot.unit) out.push("),
 ("the compact plan drops the lot", PI, "'buyFrom', 'buyLot'];", "'buyFrom'];"),
]
PAGE = [
 ("the switch is not drawn", SD, "        choosing ? fromSwitch(p, c, v, s) : null,", "        null,"),
 ("Seed on a planting writes bought in", SD, "const after = eng.startedFrom(plain) === to ? plain : { ...plain, startedFrom: to };", "const after = { ...plain, startedFrom: 'plant' };"),
 ("the switch says the crop's word, not the planting's", SD, "const eng = App.state.engine, now = eng.startedFrom(p), fixed", "const eng = App.state.engine, now = eng.startedFrom({ ...p, startedFrom: undefined }), fixed"),
 ("the answer does not say the sowing that goes", SD, "${need.sow ? `, no sowing on ${day(need.sow)}` : ''}", ""),
 ("the \"?\" gives one term", SD, "const fromHelp = () => UI.help(null, null, FROM_WORDS,", "const fromHelp = () => UI.help(null, null, FROM_WORDS.slice(0, 1),"),
 ("the box shows the crop's supplier as the grower", SD, "const from = h('input', { type: 'text', maxLength: 120, value: v.buyFrom || '',", "const from = h('input', { type: 'text', maxLength: 120, value: v.supplier || '',"),
 ("the lot typed is not kept", SD, "put('buyLot', t === '' ? '' : n,", "put('buyLot', '',"),
 ("a variety counted two ways shows one line", SD, "const alts = (r && r.alt ? r.alt : []).map(a => altRow(v, a, flat, ids));", "const alts = [];"),
 ("no lot on file is not said", SD, "'lot not on file') : h('td.sd-num.sd-size');", "'') : h('td.sd-num.sd-size');"),
 ("the plants to buy are not among the page's figures", SD, "plants ? h('span', { dataset: { hook: 'seeds-plants-figure' } }", "false ? h('span', { dataset: { hook: 'seeds-plants-figure' } }"),
 ("a planting bought in is recorded as sown", SD, "s.kind === 'sow' ? 'Sown…' : 'Planted…'", "'Sown…'"),
]
if mode == "list": print(json.dumps({"node": len(NODE), "page": len(PAGE)})); sys.exit(0)
faults = NODE if mode == "node" else PAGE
if words: faults = [f for f in faults if any(w in f[0].lower() for w in words)]
faults = faults[int(os.environ.get("FROM", "0")):int(os.environ.get("TO", "999"))]
copy = scratch / ("mutant-bought-" + mode); caught, missed, broken = [], [], []
already = None
for name, rel, was, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(was) != 1 or was == new: broken.append(name); print(f"BROKEN {name} :: the text to change is there {s.count(was)} times", flush=True); continue
        f.write_text(s.replace(was, new), encoding="utf-8")
    cmd = ["node", str(tests / "bought_test.cjs"), str(copy), str(plan)] if mode == "node" else ["python3", "-I", str(tests / "bought_check.py"), str(copy), str(scratch / "shots-bought")]
    try: out = subprocess.run(cmd, capture_output=True, text=True, timeout=300).stdout
    except subprocess.TimeoutExpired: out = "timed out"
    try: d = json.loads(out[out.rfind('{"passed"'):]); names = [str(x.get("name") if isinstance(x, dict) else x) for x in d["failed"]]; ran = True
    except Exception: names = []; ran = False; print("   no result: " + out[-300:].replace("\n", " "), flush=True)
    if name is None:
        if not ran: print("with no fault in it the check gives no result: nothing can be shown to be caught", flush=True)
        elif names: print("with no fault in it the check already fails, so these lines catch nothing: " + "; ".join(names)[:700], flush=True)
        already = set(names) if ran else None
        continue
    fails = len(names); names = [n for n in names if already is not None and n not in already]
    (caught if names else missed).append(name)
    print(("caught " if names else "MISSED ") + name + " :: " + ("; ".join(names[:2])[:200] if names or not fails else "(only what fails with no fault in it too)"), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": broken}))
