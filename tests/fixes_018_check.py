"""Preview 0.18 in a real browser: the map's whole-season view, and a seed lot added under its variety's own row.

usage: python3 -I fixes_018_check.py <app-dir-or-offline.html> <shots-dir>
"""
import functools, http.server, json, os, pathlib, socketserver, sys, threading
from playwright.sync_api import sync_playwright

target, shots = sys.argv[1], sys.argv[2]
os.makedirs(shots, exist_ok=True)
results, failed = [], []


def check(name, ok, detail=None):
    results.append(('ok   ' if ok else 'FAIL ') + name + ('' if ok or detail is None else ' ' + json.dumps(detail, default=str)[:900]))
    if not ok:
        failed.append(name)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = None
if os.path.isdir(target):
    server = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=target))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = 'http://127.0.0.1:%d/index.html' % server.server_address[1]
else:
    url = pathlib.Path(target).resolve().as_uri()

# What each space grows over the year, worked out here and not by the map's own code: runs of one crop in the order they
# go in; pots and crates one entry per crop.
EXPECT = """(() => { const A = LRFApp, eng = A.state.engine, E = LRFEngine, y0 = new Date(A.planYear(), 0, 1), y1 = new Date(A.planYear(), 11, 31), out = {};
  for (const bed of A.state.plan.beds) { if (bed.active === false || eng.isPool(bed)) continue; const g = eng.gardenOf(bed); if (!g || g.active === false) continue;
    const list = eng.plantingsIn(bed.id).map(p => ({ p, r: eng.calc(p) })).filter(x => x.r).filter(x => { const th = eng.occupancyThrough(x.p, x.r), from = eng.occupancyFrom(x.p, x.r); return (th === Infinity || th >= y0) && from <= y1; })
      .sort((a, b) => a.r.field - b.r.field || String(a.p.id).localeCompare(String(b.p.id)));
    const crops = [];
    for (const x of list) { if (eng.isCt(bed) || eng.isRack(bed)) { if (!crops.includes(x.r.c.id)) crops.push(x.r.c.id); } else if (crops[crops.length - 1] !== x.r.c.id) crops.push(x.r.c.id); }
    out[bed.id] = crops; }
  return out; })()"""
DRAWN = """(() => { const out = {}; for (const g of document.querySelectorAll('#mapBeds [data-bed]')) { const seq = []; for (const el of g.querySelectorAll('.bed-fill.season')) { if (seq[seq.length - 1] !== el.dataset.crop) seq.push(el.dataset.crop); } out[g.dataset.bed] = seq; } return out; })()"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = browser.new_context(viewport={'width': 1480, 'height': 900})
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'ERR_' not in m.text and '404' not in m.text else None)
    page.goto(url)
    page.wait_for_function('window.LRFApp && LRFApp.state.ready', timeout=30000)
    page.wait_for_timeout(700)
    js = page.evaluate
    n0 = js("LRFApp.state.plan.plantings.length")
    js("LRFApp.setDate(new Date(LRFApp.planYear(), 5, 15))")
    page.wait_for_timeout(200)

    # ═══ A. the map: the whole season at once ═══
    before = js("({ pressed: document.getElementById('mapSeasonToggle').getAttribute('aria-pressed'), label: document.getElementById('mapSeasonToggle').textContent, title: document.querySelector('#mapBar .bar-title').textContent, dated: document.querySelectorAll('#mapBeds .bed-fill[data-planting]').length, season: document.querySelectorAll('#mapBeds .bed-fill.season').length })")
    check('the map opens on the planning date, with a “Whole season” button beside the other map tools', before['pressed'] == 'false' and before['label'] == 'Whole season' and before['title'].lower() == 'in the ground' and before['dated'] > 20 and before['season'] == 0, before)
    page.click('#mapSeasonToggle')
    page.wait_for_timeout(300)
    want, got = js(EXPECT), js(DRAWN)
    wrong = [[k, want[k], got.get(k)] for k in want if want[k] != got.get(k)]
    on = js("({ pressed: document.getElementById('mapSeasonToggle').getAttribute('aria-pressed'), title: document.querySelector('#mapBar .bar-title').textContent, dated: document.querySelectorAll('#mapBeds .bed-fill[data-planting]').length, planted: document.querySelectorAll('#mapBeds .bed.is-planted').length })")
    planted = len([k for k in want if want[k]])
    check('pressed, every space shows each crop it grows this year, in the order they go in', not wrong and planted > 60 and on['planted'] == planted and on['pressed'] == 'true' and on['dated'] == 0 and on['title'].lower() == 'through the season', {'wrong': wrong[:3], 'planted': [planted, on['planted']], 'on': on})
    page.screenshot(path=os.path.join(shots, 'map-season.png'))
    # the bands tile the bed, and the first crop is at the end nearer the top or left of the page
    bands = js("""(() => { const out = { beds: 0, gaps: [], order: [], share: [] }, eng = LRFApp.state.engine;
      for (const g of document.querySelectorAll('#mapBeds [data-bed]')) { const bed = eng.bedOf(g.dataset.bed); if (!eng.isSoilBed(bed)) continue; const rects = [...g.querySelectorAll('rect.bed-fill.season')]; if (rects.length < 2) continue; out.beds++;
        const base = g.querySelector('.bed-base').getBBox(), sum = rects.reduce((n, r) => n + r.getBBox().height, 0), ys = rects.map(r => r.getBBox()).sort((a, b) => a.y - b.y);
        let tight = Math.abs(sum - base.height) < base.height * 0.002 + 0.01; for (let i = 1; i < ys.length; i++) if (Math.abs(ys[i - 1].y + ys[i - 1].height - ys[i].y) > 0.01) tight = false;
        if (!tight) out.gaps.push([bed.bed, sum, base.height]);
        const a = rects[0].getBoundingClientRect(), b = rects[rects.length - 1].getBoundingClientRect();
        if ((a.left + a.width / 2 + a.top + a.height / 2) > (b.left + b.width / 2 + b.top + b.height / 2)) out.order.push(bed.bed);
        const runs = LRFMap.seasonOf(eng, bed), total = runs.reduce((n, x) => n + x.weight, 0);
        rects.forEach((r, i) => { if (Math.abs(r.getBBox().height / base.height - runs[i].weight / total) > 0.002) out.share.push([bed.bed, i]); }); }
      return out; })()""")
    check('in a bed with more than one crop the bands fill the bed with no gap, each as large as its share of the ground and the days', bands['beds'] > 10 and not bands['gaps'] and not bands['share'], bands)
    check('the first crop is always at the end nearer the top or left of the page', not bands['order'], bands['order'][:5])
    towers = js("""(() => { const eng = LRFApp.state.engine, out = { one: 0, pie: 0, bad: [] };
      for (const g of document.querySelectorAll('#mapBeds [data-bed]')) { const bed = eng.bedOf(g.dataset.bed); if (!eng.isTower(bed)) continue; const runs = LRFMap.seasonOf(eng, bed), circles = g.querySelectorAll('circle.bed-fill.season').length, wedges = g.querySelectorAll('path.bed-fill.season').length;
        if (runs.length === 1 && circles === 1 && !wedges) out.one++; else if (runs.length > 1 && wedges === runs.length && !circles) out.pie++; else if (runs.length) out.bad.push([bed.bed, runs.length, circles, wedges]); }
      return out; })()""")
    check('a tower with one crop is one colour; with several it is a pie, a slice for each', towers['one'] + towers['pie'] > 10 and not towers['bad'], towers)
    legend = js("""(() => { const eng = LRFApp.state.engine, counts = {}; document.getElementById('legendMore').click();
      for (const bed of LRFApp.state.plan.beds) { if (bed.active === false || eng.isPool(bed) || !document.querySelector('#mapBeds [data-bed="' + bed.id + '"]')) continue; for (const id of new Set(LRFMap.seasonOf(eng, bed).map(x => x.c.id))) counts[eng.crop(id).name] = (counts[eng.crop(id).name] || 0) + 1; }
      const chips = {}; for (const c of document.querySelectorAll('#mapLegend .legend-chip')) chips[c.querySelector('span').textContent] = +c.querySelector('b').textContent; document.getElementById('legendMore').click();
      return { counts, chips }; })()""")
    check('the line under the map lists every crop of the season with the number of spaces it is grown in', len(legend['chips']) > 20 and legend['chips'] == legend['counts'], {'chips': len(legend['chips']), 'counts': len(legend['counts'])})
    # hovering a band tells the whole story of that bed; clicking selects the bed
    spot = js("""(() => { const eng = LRFApp.state.engine, s = document.getElementById('map').getBoundingClientRect(); for (const g of document.querySelectorAll('#mapBeds [data-bed]')) { const bed = eng.bedOf(g.dataset.bed), runs = LRFMap.seasonOf(eng, bed); if (!eng.isSoilBed(bed) || runs.length < 2) continue; LRFMap.fitGarden(bed.gardenId);
        const r = g.querySelector('rect.bed-fill.season').getBoundingClientRect(); return { bed: bed.id, label: LRFApp.bedLabel(bed), crops: runs.map(x => x.c.name), x: r.left + r.width / 2, y: r.top + r.height / 2 }; } })()""")
    page.wait_for_timeout(350)
    spot.update(js("(() => { const r = document.querySelector('#mapBeds [data-bed=\"%s\"] rect.bed-fill.season').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()" % spot['bed']))
    page.mouse.move(spot['x'] - 3, spot['y'] - 3); page.mouse.move(spot['x'], spot['y'])
    page.wait_for_timeout(200)
    tip = js("({ shown: !document.getElementById('tip').hidden, text: document.getElementById('tip').innerText })")
    check('hovering a bed lists everything it grows this season, with the dates', tip['shown'] and spot['label'] in tip['text'] and all(c in tip['text'] for c in spot['crops']) and 'harvest' in tip['text'], [tip, spot['crops']])
    page.screenshot(path=os.path.join(shots, 'map-season-bed.png'))
    page.mouse.click(spot['x'], spot['y'])
    page.wait_for_timeout(200)
    picked = js("({ sel: LRFApp.state.sel, grips: document.querySelectorAll('.sel-grip').length, panel: !!document.querySelector('#bedDims') })")
    check('a click on a band selects the bed, not one planting', picked['sel'] and picked['sel']['type'] == 'bed' and picked['sel']['id'] == spot['bed'] and picked['grips'] == 0 and picked['panel'], picked)
    # a planting selected from the bed's panel does not put handles on the season picture
    js("(() => { const p = LRFApp.state.engine.plantingsIn('%s')[0]; LRFApp.select({ type: 'planting', id: p.id }); })()" % spot['bed'])
    page.wait_for_timeout(150)
    held = js("({ grips: document.querySelectorAll('.sel-grip, .sel-box').length, marked: !!document.querySelector('#mapBeds [data-bed=\"%s\"].has-sel') })" % spot['bed'])
    check('with one of its plantings selected the bed is marked, and nothing can be stretched in this view', held['grips'] == 0 and held['marked'], held)
    page.keyboard.press('Escape')
    # the day does not matter here
    js("window.__band = document.querySelector('#mapBeds .bed-fill.season')")
    js("LRFApp.setDate(new Date(LRFApp.planYear(), 9, 1))")
    page.wait_for_timeout(150)
    check('moving the planning date changes nothing in this view', js("window.__band.isConnected") and js(DRAWN) == got)
    # one crop on its own
    one = js("""(() => { document.getElementById('legendMore').click(); const chip = [...document.querySelectorAll('#mapLegend .legend-chip')].find(c => +c.querySelector('b').textContent >= 2 && +c.querySelector('b').textContent <= 12); const name = chip.querySelector('span').textContent, n = +chip.querySelector('b').textContent; chip.click();
      const out = { name, n, clear: document.querySelectorAll('#mapBeds .bed:not(.dim).is-planted').length, dim: document.querySelectorAll('#mapBeds .bed.dim').length }; document.querySelector('#mapLegend .legend-chip.on').click(); document.getElementById('legendMore').click(); return out; })()""")
    check('clicking a crop in that line shows only the spaces that grow it at some time this season', one['clear'] == one['n'] and one['dim'] > 20, one)
    # a crop can still be dragged onto a bed from here: it goes in on the planning date
    js("LRFApp.setDate(new Date(LRFApp.planYear(), 5, 15)); LRFMap.fit()")
    page.wait_for_timeout(300)
    free = js("""(() => { const eng = LRFApp.state.engine, m = document.getElementById('map').getBoundingClientRect(); let best = null;
      for (const g of document.querySelectorAll('#mapBeds [data-bed]')) { const bed = eng.bedOf(g.dataset.bed); if (!eng.isSoilBed(bed) || eng.plantingsIn(bed.id).length || eng.gardenOf(bed).type !== 'field') continue; LRFMap.fitGarden(bed.gardenId); best = bed.id; break; }
      return best; })()""")
    page.wait_for_timeout(350)
    at = js("(() => { const r = document.querySelector('#mapBeds [data-bed=\"%s\"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()" % free)
    lib = page.locator('.lib-row[data-crop="carrot"]').first.bounding_box()
    page.mouse.move(lib['x'] + 60, lib['y'] + 12); page.mouse.down(); page.mouse.move(at['x'] - 20, at['y'] - 20, steps=5); page.mouse.move(at['x'], at['y'], steps=4); page.mouse.up()
    page.wait_for_timeout(300)
    dropped = js("(() => { const P = LRFApp.state.plan.plantings, p = P[P.length - 1]; return { added: P.length - %d, bed: p.bedId, date: p.date, want: LRFEngine.d2s(LRFApp.state.date), band: document.querySelectorAll('#mapBeds [data-bed=\"%s\"] .bed-fill.season').length }; })()" % (n0, free))
    check('a crop dragged onto a bed in this view is planted on the planning date, and the bed shows it at once', dropped['added'] == 1 and dropped['bed'] == free and dropped['date'] == dropped['want'] and dropped['band'] == 1, dropped)
    js("LRFApp.undo()")
    check('undone', js("LRFApp.state.plan.plantings.length") == n0)
    js("LRFMap.fit()")
    page.wait_for_timeout(250)
    page.click('#mapSeasonToggle')
    page.wait_for_timeout(250)
    off = js("({ pressed: document.getElementById('mapSeasonToggle').getAttribute('aria-pressed'), title: document.querySelector('#mapBar .bar-title').textContent, dated: document.querySelectorAll('#mapBeds .bed-fill[data-planting]').length, season: document.querySelectorAll('#mapBeds .bed-fill.season').length })")
    check('pressed again, the map is back on the planning date as it was', off['pressed'] == 'false' and off['title'].lower() == 'in the ground' and off['dated'] == before['dated'] and off['season'] == 0, [off, before['dated']])
    for (w, hgt, scheme) in ((1280, 720, 'dark'), (1480, 900, 'light')):
        page.set_viewport_size({'width': w, 'height': hgt}); page.emulate_media(color_scheme=scheme)
        js("LRFMap.wholeSeason(true); LRFMap.fit()")
        page.wait_for_timeout(350)
        tools = js("(() => { const t = document.querySelector('.map-tools').getBoundingClientRect(), m = document.getElementById('mapView').getBoundingClientRect(), kids = [...document.querySelector('.map-tools').children].map(e => e.getBoundingClientRect()); return { inside: t.left >= m.left && t.right <= m.right + 1, rows: new Set(kids.map(r => Math.round(r.top))).size }; })()")
        check('the map tools fit on one line at %d wide' % w, tools['inside'] and tools['rows'] == 1, tools)
        page.screenshot(path=os.path.join(shots, 'map-season-%d-%s.png' % (w, scheme)))
        js("LRFMap.wholeSeason(false)")

    # ═══ B. a seed lot added under the variety's own row ═══
    page.click('[data-view-btn="seeds"]')
    page.wait_for_selector('#sdBody .sd-var')
    page.wait_for_timeout(300)
    pick = """(() => { const eng = LRFApp.state.engine, rows = [...document.querySelectorAll('#sdBody .sd-var[data-variety]')].map(r => eng.variety(r.dataset.variety)).filter(v => v && v.supplier && !eng.crop(v.cropId).micro && eng.crop(v.cropId).plantingMaterial !== 'plant');
      const v = rows[%d]; document.querySelector('.sd-var[data-variety="' + v.id + '"]').scrollIntoView({ block: 'center' }); return { id: v.id, name: v.name, supplier: v.supplier, lots: LRFApp.inventoryNow().lots.filter(l => !l.deleted).length }; })()"""
    row = js(pick % 3)
    page.wait_for_timeout(150)

    def open_lot(r):
        page.hover('.sd-var[data-variety="%s"]' % r['id'])
        page.wait_for_timeout(120)
        page.click('.sd-var[data-variety="%s"] .sd-addlot' % r['id'])
        page.wait_for_selector('.sd-lotrow')
        page.wait_for_timeout(150)

    state = """(() => { const line = document.querySelector('.sd-lotrow'), lots = LRFApp.inventoryNow().lots.filter(l => !l.deleted); if (!line) return { open: false, lots: lots.length, focus: document.activeElement.id || document.activeElement.className };
      const row = line.previousElementSibling, f = line.querySelector('form').getBoundingClientRect(), thumb = row.querySelector('.thumb').getBoundingClientRect(), scroll = document.getElementById('sdScroll').getBoundingClientRect();
      return { open: true, under: row.dataset.variety, lines: document.querySelectorAll('.sd-lotrow').length, vendor: document.getElementById('lrVendor').value, year: document.getElementById('lrYear').value, amount: document.getElementById('lrAmount').value, focus: document.activeElement.id,
        indent: f.left - thumb.left, inside: f.right <= scroll.right + 1, oneLine: new Set([...line.querySelectorAll('form > input, form > label, form > div, form > button')].map(e => Math.round((e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2) / 8))).size,
        close: !!document.getElementById('lrClose'), top: document.getElementById('qlVariety').value, lots: lots.length, said: document.getElementById('lrSay').textContent, pressed: row.querySelector('.sd-addlot').getAttribute('aria-expanded') }; })()"""
    open_lot(row)
    st = js(state)
    check('“+ lot” on a variety’s row opens a line in the list directly under that row, with its vendor filled in and the cursor on the amount', st['open'] and st['under'] == row['id'] and st['lines'] == 1 and st['vendor'] == row['supplier'] and st['year'] == str(js("new Date().getFullYear()")) and st['focus'] == 'lrAmount' and st['pressed'] == 'true', st)
    check('the line sits under the variety, not to its left, inside the list, on one line, and the line at the top of the page is left alone', st['indent'] >= 0 and st['inside'] and st['oneLine'] == 1 and st['top'] == '', st)
    page.screenshot(path=os.path.join(shots, 'seeds-lot-under-row.png'))
    check('it has an × to leave without adding', st['close'])
    page.click('#lrClose')
    page.wait_for_timeout(200)
    shut = js(state)
    check('× closes it and nothing is added', not shut['open'] and shut['lots'] == row['lots'], shut)
    open_lot(row)
    page.keyboard.type('75')
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)
    shut = js(state)
    check('Escape closes it too, with an amount typed and nothing added', not shut['open'] and shut['lots'] == row['lots'], shut)
    js("(() => { const x = document.getElementById('lrClose'); if (x) x.click(); })()")   # so a failure above is reported, and the rest still runs
    page.wait_for_timeout(150)
    # what is typed survives the list being drawn again (a photo arriving, a change elsewhere)
    open_lot(row)
    page.keyboard.type('12')
    page.keyboard.press('ArrowLeft')   # the cursor between the 1 and the 2
    js("LRFSeeds.select(null)")
    page.wait_for_timeout(250)
    page.keyboard.type('5')
    kept = js(state)
    check('if the list is drawn again while typing, the line keeps what was typed and the cursor stays where it was', kept['open'] and kept['amount'] == '152' and kept['focus'] == 'lrAmount', kept)
    # an amount is needed
    js("document.getElementById('lrAmount').value = ''; document.getElementById('lrAmount').dispatchEvent(new Event('input', { bubbles: true }))")
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    empty = js(state)
    check('Enter with no amount says what is missing and adds nothing', empty['open'] and len(empty['said']) > 5 and empty['lots'] == row['lots'], empty)
    # another row: the line moves there
    other = js(pick % 6)
    open_lot(other)
    moved = js(state)
    check('“+ lot” on another row moves the line under that one', moved['open'] and moved['under'] == other['id'] and moved['lines'] == 1 and moved['vendor'] == other['supplier'] and moved['amount'] == '', moved)
    page.keyboard.type('250')
    page.click('.sd-lotrow [data-where="ordered"]')
    page.keyboard.press('Tab') if False else None
    page.click('#lrAdd')
    page.wait_for_timeout(400)
    done = js("(() => { const lots = LRFApp.inventoryNow().lots.filter(l => !l.deleted), lot = lots[lots.length - 1]; return { n: lots.length, key: lot.key, q: lot.quantity, status: lot.status, supplier: lot.supplier, open: !!document.querySelector('.sd-lotrow'), toast: document.getElementById('toast').textContent, sel: document.querySelector('#sdPanel h2') && document.querySelector('#sdPanel h2').textContent, undo: LRFApp.state.undo.length }; })()")
    check('Add records the lot for that variety, as ordered, closes the line and shows the variety', done['n'] == other['lots'] + 1 and done['key'] == 'v:' + other['id'] and done['q'] == 250 and done['status'] == 'ordered' and done['supplier'] == other['supplier'] and not done['open'] and other['name'] in done['toast'] and done['sel'] == other['name'], done)
    js("LRFApp.undo()")
    page.wait_for_timeout(300)
    check('one undo takes the lot back', js("LRFApp.inventoryNow().lots.filter(l => !l.deleted).length") == other['lots'])
    # the line at the top still adds a lot by typing a variety's name
    page.fill('#qlVariety', row['name'][:5])
    page.wait_for_timeout(200)
    check('the line at the top of the page still finds a variety as it is typed', js("!document.getElementById('qlList').hidden && document.querySelectorAll('#qlList li').length >= 1"))
    page.fill('#qlVariety', '')
    page.set_viewport_size({'width': 1280, 'height': 720})
    page.wait_for_timeout(250)
    js("document.querySelector('.sd-var[data-variety=\"%s\"]').scrollIntoView({ block: 'center' })" % row['id'])
    open_lot(row)
    narrow = js(state)
    check('at 1280 wide the line still fits inside the list, under its variety', narrow['open'] and narrow['inside'] and narrow['indent'] >= 0 and narrow['oneLine'] <= 2, narrow)
    page.emulate_media(color_scheme='dark')
    page.wait_for_timeout(150)
    page.screenshot(path=os.path.join(shots, 'seeds-lot-1280-dark.png'))
    page.click('#lrClose')
    check('no script errors', not errors, errors[:4])
    browser.close()
if server:
    server.shutdown()
print('\n'.join(results))
print(json.dumps({'passed': len(results) - len(failed), 'of': len(results), 'failed': failed}))
sys.exit(1 if failed else 0)
