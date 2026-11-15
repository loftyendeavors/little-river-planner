"""Preview 0.40 (the look and controls, stage A: the map's look) in a real browser: the farm photo in its own colour with the
beds on a plate; a crop in the colour of its group, a bed being picked a deeper shade; the legend as the key to the colours;
free ground standing out while a crop is carried, everything else still in view; what is selected seen on any colour; small
grey text and white-on-orange dark enough to read. It only looks: at its end the plan is the plan it began with.
usage: python3 -I look_a_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1707, STOP_AT_FAIL=1
"""
import functools, http.server, json, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
target, shots = Path(sys.argv[1]), Path(sys.argv[2]); shots.mkdir(parents=True, exist_ok=True)
backup = sys.argv[3] if len(sys.argv) > 3 else None
WIDTH = int(os.environ.get("WIDTH", "1280")); STOP = os.environ.get("STOP_AT_FAIL") == "1"
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(target)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
results, failed, errors = [], [], []
def finish():
    print(json.dumps({"passed": len(results) - len(failed), "of": len(results), "failed": failed, "details": [r for r in results if not r["ok"]][:12], "errors": errors[:6]}, default=str))
    sys.stdout.flush(); os._exit(1 if failed else 0)
def check(name, ok, detail=None):
    results.append({"name": name, "ok": bool(ok), **({"detail": detail} if detail is not None and not ok else {})})
    if not ok:
        failed.append(name)
        if STOP: finish()
PRE = ("const A = LRFApp, S = A.state, $ = id => document.getElementById(id), eng = S.engine, q = (s, root) => [...(root || document).querySelectorAll(s)];"
       "const PICK = 0.3, ROWS = 0.22;"
       "const deeper = (hex, k) => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - k)).toString(16).padStart(2, '0')).join('');"
       # any colour the page can name, as the three numbers it is painted with
       "const px = (() => { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d', { willReadFrequently: true }); return (colour, under) => { x.clearRect(0, 0, 1, 1); if (under) { x.fillStyle = under; x.fillRect(0, 0, 1, 1); } x.fillStyle = colour; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data]; }; })();"
       "const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };"
       "const contrast = (a, b) => { const x = lum(a), y = lum(b); return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); };"
       "const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();"
       "const drawn = () => S.plan.beds.filter(b => document.querySelector('#mapBeds [data-bed=\"' + b.id + '\"]'));"
       # the groups in the ground on the planning date: the spaces that grow each, and the crops of each
       "const inGround = date => { const out = {}; for (const bed of drawn()) for (const r of eng.bedStatus(bed, date).crops) { const g = eng.colorGroup(r.c); const row = out[g.id] = out[g.id] || { name: g.name, beds: new Set(), crops: {}, runs: 0 }; row.beds.add(bed.id); row.runs++; (row.crops[r.c.id] = row.crops[r.c.id] || new Set()).add(bed.id); } return out; };"
       "const chips = () => Object.fromEntries(q('#mapLegend .legend-chip.group').map(c => [c.dataset.group, +c.querySelector('b').textContent]));"
       "const clear = () => q('#mapBeds .bed:not(.dim).is-planted').length, dim = () => q('#mapBeds .bed.dim').length;")
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 900}, color_scheme="light")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready"); page.wait_for_timeout(900)
    if backup and page.evaluate("LRFApp.isSample()"):
        page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
        if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
        page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(6000)
    page.evaluate("LRFApp.state.undo.length = 0")
    def js(body):
        try: return page.evaluate("(() => { " + PRE + " " + body + " })()")
        except Exception as e:
            errors.append(str(e)[:300]); return None
    def wait(ms=400): page.wait_for_timeout(ms)
    start = js("return { key: A.contentKey(), n: S.plan.plantings.length };") or {}
    js("A.select(null); A.setView('map'); A.setDate(new Date(A.planYear(), 5, 15)); LRFMap.fit(true);"); wait(700)

    # ── the photo and the plates ──
    ground = js("""const map = $('map'), photo = $('mapPhoto'), plate = document.querySelector('#map .plate'), base = document.querySelector('#map .bed.is-empty .bed-base') || document.querySelector('#map .bed-base'), edge = document.querySelector('#map .bed:not(.sel):not(.has-sel) .bed-edge');
      return { onPhoto: map.classList.contains('on-photo'), filter: photo ? getComputedStyle(photo).filter : null, plate: plate ? px(getComputedStyle(plate).fill, '#000') : null, plateShadow: plate ? getComputedStyle(plate).filter : null, base: base ? px(getComputedStyle(base).fill, '#000') : null, edge: edge ? px(getComputedStyle(edge).stroke, '#fff') : null };""") or {}
    check("the map is drawn on the farm photo: the lines below have their subject", ground.get("onPhoto") and ground.get("plate") and ground.get("base"), ground)
    check("the photo keeps its own colour: nothing greys or darkens it", ground.get("filter") == "none", ground.get("filter"))
    dim = js("""const b = $('mapDimToggle'), f = () => getComputedStyle($('mapPhoto')).filter, kept = () => { try { return localStorage.getItem('lrf.map.dimPhoto'); } catch (_) { return 'refused'; } };
      if (!b) return { there: false };
      const was = [b.getAttribute('aria-pressed'), f()]; b.click(); const on = [b.getAttribute('aria-pressed'), f(), kept()]; b.click();
      return { there: true, was, on, off: [b.getAttribute('aria-pressed'), f(), kept()] };""") or {}
    check("“Dim photo” on the map’s tools greys and darkens the photo a little while it is pressed and lets it go when pressed again, and the computer keeps which", dim.get("was") == ["false", "none"] and len(dim.get("on") or []) == 3 and dim["on"][0] == "true" and "saturate" in dim["on"][1] and "brightness" in dim["on"][1] and dim["on"][2] == "1" and dim.get("off") == ["false", "none", "0"], dim)
    plate = ground.get("plate") or [0, 0, 0, 0]; base = ground.get("base") or [0, 0, 0, 0]
    check("each garden’s beds stand on a light grey-green plate that hides the photo under them and is lifted off it by a shadow", min(plate[:3]) >= 195 and plate[1] >= plate[0] and plate[1] >= plate[2] and max(plate[:3]) <= 232 and "drop-shadow" in (ground.get("plateShadow") or ""), ground)
    check("an empty bed is white on its plate, with a dark edge", min(base[:3]) >= 245 and ground.get("edge") and max(ground["edge"][:3]) <= 190, ground)

    # ── a crop in the colour of its group; a bed being picked a deeper shade ──
    fills = js("""const date = S.date, out = { grow: 0, pick: 0, bad: [], rows: 0, badRows: [], groups: new Set() };
      for (const bed of drawn()) { const g = document.querySelector('#mapBeds [data-bed="' + bed.id + '"]'), by = new Map(eng.bedStatus(bed, date).crops.map(r => [String(r.planting.id), r])), here = new Set();
        for (const el of q('.bed-fill[data-planting]', g)) { const r = by.get(el.dataset.planting); if (!r) { out.bad.push([bed.id, 'no such planting on this date']); continue; }
          const ripe = r.first <= date && date <= r.last, colour = r.c.color || eng.colorGroup(r.c).color, want = ripe ? deeper(colour, PICK) : colour, got = (el.getAttribute('fill') || '').toLowerCase(); here.add(got); out.groups.add(eng.colorGroup(r.c).id);
          if (got !== want || el.classList.contains('pick') !== ripe || el.classList.contains('grow') === ripe) out.bad.push([r.c.name, ripe ? 'picked' : 'growing', want, got]); else out[ripe ? 'pick' : 'grow']++; }
        for (const el of q('.bed-rows', g)) { out.rows++; const got = (el.getAttribute('stroke') || '').toLowerCase(); if (![...here].some(f => deeper(f, ROWS) === got && got !== f)) out.badRows.push([bed.id, got, [...here]]); } }
      out.groups = out.groups.size; out.bad = out.bad.slice(0, 5); out.badRows = out.badRows.slice(0, 5); return out;""") or {}
    check("on the planning date there are beds growing and beds being picked, in six groups or more: the lines below have their subjects", fills.get("grow", 0) >= 10 and fills.get("pick", 0) >= 10 and fills.get("groups", 0) >= 6 and fills.get("rows", 0) >= 10, fills)
    check("a bed still growing is its group’s colour in full; a bed being picked is that colour 30% deeper", fills.get("grow", 0) >= 10 and fills.get("pick", 0) >= 10 and not fills.get("bad"), fills)
    check("the row lines of a bed are a deeper shade of the bed itself, so they show on any colour", fills.get("rows", 0) >= 10 and not fills.get("badRows"), fills)

    # ── the legend: the key to the colours ──
    legend = js("""const want = inGround(S.date), got = chips(), names = Object.fromEntries(q('#mapLegend .legend-chip.group').map(c => [c.dataset.group, c.querySelector('span').textContent]));
      const colours = q('#mapLegend .legend-chip.group').every(c => { const g = eng.lib.colorGroups.groups.find(x => x.id === c.dataset.group); return g && px(c.querySelector('i').style.backgroundColor).join() === px(g.color).join(); });
      const more = $('legendMore'), hidden = q('#mapLegend .legend-chip').filter(c => c.hidden).length;
      return { want: Object.fromEntries(Object.entries(want).map(([k, v]) => [k, v.beds.size])), got, namesRight: Object.keys(got).every(k => want[k] && names[k] === want[k].name), colours, twice: Object.values(want).filter(v => v.runs > v.beds.size).length, shared: Object.values(want).filter(v => Object.values(v.crops).reduce((n, s) => n + s.size, 0) > v.beds.size).length, crops: q('#mapLegend .legend-chip.crop').length,
        more: { hidden: more.hidden, text: more.textContent, chipsHidden: hidden }, order: q('#mapLegend .legend-chip.group').map(c => +c.querySelector('b').textContent) };""") or {}
    check("the line under the map lists the groups in the ground, each by its name and in its colour, with the number of spaces growing it", len(legend.get("got") or {}) >= 6 and legend.get("got") == legend.get("want") and legend.get("namesRight") and legend.get("colours") and legend.get("crops") == 0, legend)
    check("a space counts once for a group however many plantings, or crops, of the group it holds (the farm has spaces of both kinds)", legend.get("twice", 0) >= 1 and legend.get("shared", 0) >= 1 and legend.get("got") == legend.get("want"), legend)
    check("the groups run from the one in most spaces to the one in fewest", len(legend.get("order") or []) >= 6 and legend.get("order") == sorted(legend.get("order") or [], reverse=True), legend.get("order"))
    MORE = "const more = $('legendMore'), hidden = q('#mapLegend .legend-chip').filter(c => c.hidden).length; return { hidden: more.hidden, text: more.textContent, chipsHidden: hidden, title: more.title };"
    seen = []
    for w in (3440, 1000):
        page.set_viewport_size({"width": w, "height": 900}); wait(500); seen.append(js(MORE) or {})
    page.set_viewport_size({"width": WIDTH, "height": 900}); wait(500); js("LRFMap.fit(true);"); wait(500)
    check("the button at the end of the line is always there: “Key” on a window where every group fits, “+n” where n do not; either way it says it leads to how beds are drawn", len(seen) == 2 and seen[0].get("hidden") is False and seen[0].get("chipsHidden") == 0 and seen[0].get("text") == "Key" and seen[1].get("hidden") is False and seen[1].get("chipsHidden", 0) >= 1 and seen[1].get("text") == "+%d" % seen[1].get("chipsHidden") and all("how beds are drawn" in (s.get("title") or "").lower() for s in seen), seen)
    key = js("""$('legendMore').click(); const k = document.querySelector('#mapBar .map-key'), g = k.querySelector('.k-grow'), p = k.querySelector('.k-pick');
      const out = { open: $('mapBar').classList.contains('open'), shown: getComputedStyle(k).display !== 'none' && k.offsetWidth > 0, text: k.textContent, grow: lum(px(getComputedStyle(g).backgroundColor, '#fff')), pick: lum(px(getComputedStyle(p).backgroundColor, '#fff')), all: q('#mapLegend .legend-chip').every(c => !c.hidden) };
      $('legendMore').click(); out.closed = !$('mapBar').classList.contains('open'); return out;""") or {}
    check("it opens every group and the key to how beds are drawn, where harvest is the darker of the two; and closes again", key.get("open") and key.get("shown") and key.get("all") and "growing" in (key.get("text") or "") and "harvest" in (key.get("text") or "") and key.get("pick", 1) < key.get("grow", 0) - 0.05 and key.get("closed"), key)
    alone = js("""const want = inGround(S.date), id = Object.keys(want).filter(k => Object.keys(want[k].crops).length >= 2).sort((a, b) => want[a].beds.size - want[b].beds.size)[0]; if (!id) return null;
      document.querySelector('#mapLegend .legend-chip.group[data-group="' + id + '"]').click();
      const out = { id, n: want[id].beds.size, clear: clear(), dim: dim(), first: document.querySelector('#mapLegend .legend-chip').dataset.group === id, pressed: document.querySelector('#mapLegend .legend-chip.group.on').getAttribute('aria-pressed') };
      out.onlyThese = q('#mapBeds .bed:not(.dim).is-planted').every(g => want[id].beds.has(g.dataset.bed));
      const crops = q('#mapLegend .legend-chip.crop'); out.crops = Object.fromEntries(crops.map(c => [c.dataset.crop, +c.querySelector('b').textContent])); out.wantCrops = Object.fromEntries(Object.entries(want[id].crops).map(([k, v]) => [k, v.size]));
      out.noSwatch = crops.every(c => !c.querySelector('i')); const crop = crops[crops.length - 1]; out.crop = crop.dataset.crop; crop.click();
      out.clearCrop = clear(); out.onlyThisCrop = q('#mapBeds .bed:not(.dim).is-planted').every(g => want[id].crops[out.crop].has(g.dataset.bed)); out.two = q('#mapLegend .legend-chip.on').length;
      document.querySelector('#mapLegend .legend-chip.crop.on').click(); out.back = clear();
      return out;""") or {}
    wait(200); page.screenshot(path=str(shots / f"look-group-{WIDTH}.png"))
    check("a click on a group shows only the spaces that grow it: the rest step back, and the group’s crops are listed beside it with their spaces", alone.get("clear") == alone.get("n") and alone.get("dim", 0) >= 20 and alone.get("onlyThese") and alone.get("first") and alone.get("pressed") == "true" and alone.get("crops") == alone.get("wantCrops") and len(alone.get("crops") or {}) >= 2 and alone.get("noSwatch"), alone)
    check("a click on one of those crops shows only the spaces that grow that crop; a second click shows the group again", alone.get("crop") and alone.get("clearCrop") == (alone.get("wantCrops") or {}).get(alone.get("crop")) and alone.get("onlyThisCrop") and alone.get("two") == 2 and alone.get("back") == alone.get("n"), alone)
    # the group shown alone stays in the line when nothing of it is in the ground, so it can always be let go
    gone = js("""const id = %s; if (!id) return null; let day = null;
      for (let m = 0; m < 12 && !day; m++) for (const d of [3, 17]) { const date = new Date(A.planYear(), m, d), there = inGround(date); if (!there[id] && Object.keys(there).length >= 2) { day = date; break; } }
      if (!day) return { id, day: null };
      A.setDate(day); const chip = document.querySelector('#mapLegend .legend-chip.group.on'), out = { id, day: String(day).slice(4, 10), there: !!chip && chip.dataset.group === id, n: chip ? +chip.querySelector('b').textContent : null, clear: clear(), planted: q('#mapBeds .bed.is-planted').length, crops: q('#mapLegend .legend-chip.crop').length };
      if (chip) chip.click(); out.after = { dim: dim(), on: q('#mapLegend .legend-chip.on').length, listed: q('#mapLegend .legend-chip.group[data-group="' + id + '"]').length };
      A.setDate(new Date(A.planYear(), 5, 15)); return out;""" % json.dumps(alone.get("id"))) or {}
    check("on a day when nothing of the group shown alone is in the ground, it is still in the line, with 0, and a click lets it go", gone.get("day") and gone.get("there") and gone.get("n") == 0 and gone.get("clear") == 0 and gone.get("planted", 0) >= 1 and gone.get("crops") == 0 and gone.get("after") == {"dim": 0, "on": 0, "listed": 0}, gone)
    wait(300)
    check("with nothing shown alone no bed steps back and no crop is listed in the line", js("return { dim: dim(), on: q('#mapLegend .legend-chip.on').length, crops: q('#mapLegend .legend-chip.crop').length };") == {"dim": 0, "on": 0, "crops": 0})

    # ── the whole season: the same colours ──
    season = js("""$('mapSeasonToggle').click(); const bands = q('#mapBeds .bed-fill.season[data-crop]'), bad = bands.filter(el => { const c = eng.crop(el.dataset.crop); return (el.getAttribute('fill') || '').toLowerCase() !== (c.color || eng.colorGroup(c).color); }).length;
      const out = { on: $('mapSeasonToggle').getAttribute('aria-pressed'), bands: bands.length, bad, groups: Object.keys(chips()).length }; $('mapSeasonToggle').click(); out.off = $('mapSeasonToggle').getAttribute('aria-pressed'); return out;""") or {}
    check("in the whole-season picture every band is its group’s colour in full", season.get("on") == "true" and season.get("bands", 0) >= 100 and season.get("bad") == 0 and season.get("groups", 0) >= 8 and season.get("off") == "false", season)
    wait(300)

    # ── what is selected is seen on any colour ──
    sel = js("""const date = S.date; let pick = null; for (const bed of drawn()) { if (!eng.isSoilBed(bed)) continue; const r = eng.bedStatus(bed, date).crops[0]; if (r) { pick = r.planting.id; break; } } if (!pick) return null;
      A.select({ type: 'planting', id: pick }); const box = document.querySelector('#map .sel-box'); if (!box) return { pick, box: false };
      const cs = getComputedStyle(box); return { pick, box: true, filter: cs.filter, width: cs.strokeWidth, stroke: px(cs.stroke).slice(0, 3).join(), flag: px(token('--flag')).slice(0, 3).join() };""") or {}
    wait(300); page.screenshot(path=str(shots / f"look-selected-{WIDTH}.png"))
    f = sel.get("filter") or ""
    check("the selected planting’s outline on the map is orange cased in white, with a dark edge beyond", sel.get("box") and sel.get("stroke") == sel.get("flag") and sel.get("width") == "3px" and f.count("drop-shadow") == 4 and f.count("rgb(255, 255, 255)") == 3, sel)
    js("A.setView('timeline');"); wait(900)
    bar = js("""const b = document.querySelector('#tlBody .tl-bar.sel'); if (!b) return null; const s = getComputedStyle(b).boxShadow; return { shadow: s, white: s.indexOf('rgb(255, 255, 255)'), flag: s.indexOf('rgb(' + px(token('--flag')).slice(0, 3).join(', ') + ')') };""")
    check("on the Timeline the selected bar has a white line between it and its orange outline", bar is not None and 0 <= bar["white"] < bar["flag"], bar)
    bars = js("""const all = q('#tlBody .tl-bar[data-planting]'), bad = [], seen = new Set(); for (const b of all) { const p = eng.planting(b.dataset.planting), r = p && eng.calc(p), want = r && (r.c.color || eng.colorGroup(r.c).color), got = b.style.getPropertyValue('--crop').trim().toLowerCase(); if (!want || got !== want) bad.push([b.dataset.planting, want, got]); else seen.add(got); }
      const grow = document.querySelector('#tlBody .tl-bar[data-planting] .ph-grow'), pick = document.querySelector('#tlBody .tl-bar[data-planting] .ph-pick');
      return { bars: all.length, bad: bad.slice(0, 4), colours: seen.size, growLighter: grow && pick ? lum(px(getComputedStyle(grow).backgroundColor, '#fff')) > lum(px(getComputedStyle(grow.parentElement.querySelector('.ph-pick') || pick).backgroundColor, '#fff')) : null };""") or {}
    check("every bar on the Timeline takes its group’s colour: its growing part a lighter tint, its harvest the colour in full", bars.get("bars", 0) >= 50 and not bars.get("bad") and bars.get("colours", 0) >= 6 and bars.get("growLighter") is True, bars)
    page.screenshot(path=str(shots / f"look-timeline-{WIDTH}.png"))
    js("A.select(null); A.setView('map');"); wait(600)

    # ── carrying a crop: free ground stands out, everything else steps back but stays in view ──
    row = page.locator("#libList .lib-row").first
    box = row.bounding_box() if row.count() else None
    carried = {}
    if box:
        m = js("const r = $('map').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };")
        page.mouse.move(box["x"] + 60, box["y"] + box["height"] / 2); page.mouse.down(); page.mouse.move(box["x"] + 200, box["y"] + 60, steps=4); page.mouse.move(m["x"], m["y"], steps=8); wait(500)
        SURVEY = """const n = c => q('#map .bed.' + c).length, quiet = q('#map .bed:not(.drop-ok):not(.drop-target)'), free = q('#map .bed.drop-ok:not(.drop-target)');
          const op = sel => { const set = new Set(); for (const g of quiet) for (const el of q(sel, g)) set.add(getComputedStyle(el).opacity); return [...set]; };
          const out = { dropping: $('map').classList.contains('dropping'), ok: n('drop-ok'), other: n('drop-partial') + n('drop-swap') + n('drop-split') + n('drop-blocked'), target: n('drop-target'), fills: op('.bed-fill'), rows: op('.bed-rows'),
            beds: [...new Set(quiet.map(g => getComputedStyle(g).opacity))], dashed: quiet.filter(g => getComputedStyle(g.querySelector('.bed-edge')).strokeDasharray !== 'none').length, orange: quiet.filter(g => px(getComputedStyle(g.querySelector('.bed-edge')).stroke).slice(0, 3).join() === px(token('--flag')).slice(0, 3).join()).length,
            freeEdge: [...new Set(free.map(g => { const cs = getComputedStyle(g.querySelector('.bed-edge')); return px(cs.stroke).slice(0, 3).join() + ' ' + cs.strokeWidth + ' ' + cs.strokeDasharray; }))], freeBase: [...new Set(free.map(g => px(getComputedStyle(g.querySelector('.bed-base')).fill, '#000').slice(0, 3).join()))], freeFills: [...new Set(free.flatMap(g => q('.bed-fill', g).map(el => getComputedStyle(el).opacity)))],
            ink: px(token('--ink')).slice(0, 3).join() };
          const spot = kind => { const box = $('map').getBoundingClientRect(); for (const g of q('#map .bed' + kind)) { const r = g.getBoundingClientRect(), x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); if (x < box.left + 20 || x > box.right - 20 || y < box.top + 60 || y > box.bottom - 110) continue; const at = document.elementFromPoint(x, y), over = at && at.closest('[data-bed]'); if (over === g) return { x, y, bed: g.dataset.bed }; } return null; };
          out.aFree = spot('.drop-ok'); out.aTaken = spot('.drop-blocked.is-planted') || spot('.drop-split.is-planted') || spot('.drop-partial.is-planted'); return out;"""
        carried = js(SURVEY) or {}
        page.screenshot(path=str(shots / f"look-carry-{WIDTH}.png"))
        TARGET = """const g = document.querySelector('#map .bed.drop-target'); if (!g) return null; const cs = getComputedStyle(g.querySelector('.bed-edge'));
          return { bed: g.dataset.bed, cls: g.getAttribute('class'), stroke: px(cs.stroke).slice(0, 3).join(), width: cs.strokeWidth, fills: [...new Set(q('.bed-fill', g).map(el => getComputedStyle(el).opacity))], flag: px(token('--flag')).slice(0, 3).join(), bad: px(token('--bad')).slice(0, 3).join() };"""
        for name in ("aFree", "aTaken"):
            at = carried.get(name)
            if at:
                page.mouse.move(at["x"] - 2, at["y"] - 2); page.mouse.move(at["x"], at["y"]); wait(450)
                carried[name + "Target"] = js(TARGET)
        page.keyboard.press("Escape"); page.mouse.up(); wait(450)
    check("while a crop is carried the map marks the ground that is free and the ground that is not: the lines below have their subjects", carried.get("dropping") and carried.get("ok", 0) >= 3 and carried.get("other", 0) >= 20 and carried.get("aFree") and carried.get("aTaken"), carried)
    check("every bed that is not free steps back to 60% of its colour and no further: its crops and rows are still seen, the bed itself is not faded", carried.get("fills") == ["0.6"] and carried.get("rows") in (["0.6"], []) and carried.get("beds") == ["1"], carried)
    check("no bed that is not free is outlined in orange or dashed: only free ground and the bed under the pointer are marked", carried.get("dashed") == 0 and carried.get("orange") == 0, carried)
    check("free ground has a firm dark outline and a white bed, and its own crops, if any, in full colour", carried.get("freeEdge") == ["%s 2.5px none" % carried.get("ink")] and carried.get("freeBase") == ["255,255,255"] and carried.get("freeFills") in ([], ["1"]), carried)
    a, b = carried.get("aFreeTarget") or {}, carried.get("aTakenTarget") or {}
    check("the bed under the pointer has a thick orange outline, or a red one where the crop cannot go, and is in full colour", a.get("stroke") == a.get("flag") and a.get("width") == "4px" and b.get("width") == "4px" and b.get("stroke") in (b.get("flag"), b.get("bad")) and b.get("fills") == ["1"] and a.get("bed") != b.get("bed"), [a, b])
    after = js("return { dropping: $('map').classList.contains('dropping'), faded: q('#map .bed-fill').filter(el => getComputedStyle(el).opacity !== '1').length, marked: q('#map .bed.drop-ok, #map .bed.drop-target, #map .bed.drop-blocked, #map .bed.drop-split').length, n: S.plan.plantings.length, undo: S.undo.length };") or {}
    check("let go with Escape, the map is as it was and nothing was planted", after == {"dropping": False, "faded": 0, "marked": 0, "n": start.get("n"), "undo": 0}, after)

    # ── small text that can be read ──
    ink = js("""const muted = px(token('--muted')), deep = px(token('--flag-deep')), out = { onSurface: contrast(muted, px(token('--surface'))), onPaper: contrast(muted, px(token('--paper'))), onWhite: contrast(muted, [255, 255, 255]), whiteOnDeep: contrast(px(token('--flag-ink')), deep), whiteOnFlag: contrast([255, 255, 255], px(token('--flag'))) };
      let faint = 0, sound = 0; const walk = rules => { for (const r of rules) { if (r.cssRules && r.type !== 1) { if (!r.media || !/dark/.test(r.media.mediaText)) walk(r.cssRules); continue; } if (!r.style || /dark/.test(r.selectorText || '')) continue; const bg = (r.style.getPropertyValue('background') || r.style.getPropertyValue('background-color')).trim(), fg = r.style.getPropertyValue('color').trim(); if (fg === 'var(--flag-ink)') { if (bg === 'var(--flag)') faint++; else if (bg === 'var(--flag-deep)') sound++; } } };
      for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch (_) {} }
      out.faint = faint; out.sound = sound; const more = document.querySelector('#libList .lib-more'); out.more = more ? contrast(px(getComputedStyle(more).color), px(token('--surface'))) : null; return out;""") or {}
    check("small grey text has contrast of 4.5 or more on every ground it stands on", ink.get("onSurface", 0) >= 4.5 and ink.get("onPaper", 0) >= 4.5 and ink.get("onWhite", 0) >= 4.5, ink)
    check("white text never stands on the bright orange, where it is too faint: wherever it stands on orange, it is the deeper one, at 4.5 or more", ink.get("whiteOnDeep", 0) >= 4.5 and ink.get("faint") == 0 and ink.get("sound", 0) >= 4 and ink.get("whiteOnFlag", 9) < 4.5, ink)
    check("the mark that opens a crop’s varieties in the library is seen before the pointer is on its row", (ink.get("more") or 0) >= 4.5, ink)
    tiles = js("""const out = { n: 0, low: [] }; for (const t of q('.thumb.none')) { const s = t.querySelector('span'); if (!s || !t.offsetWidth) continue; out.n++; const bg = px(getComputedStyle(t).backgroundColor, '#fff'), c = contrast(px(getComputedStyle(s).color, '#fff'), bg); if (c < 3) out.low.push([s.textContent, c]); } out.low = out.low.slice(0, 5); return out;""") or {}
    check("a crop with no picture has a letter that stands off its tile (3 to 1 or more, as large bold letters need)", tiles.get("n", 0) >= 1 and not tiles.get("low"), tiles)

    end = js("return { key: A.contentKey(), undo: S.undo.length, n: S.plan.plantings.length };") or {}
    check("looking changed nothing: the same plan, nothing to undo", end.get("key") == start.get("key") and end.get("undo") == 0 and end.get("n") == start.get("n"), [start, end])
    check("no error on the page", not errors, errors[:4])
    page.screenshot(path=str(shots / f"look-{WIDTH}.png"))
    finish()
