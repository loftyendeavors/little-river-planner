"""Step 2b in a real browser: the series tool in the details panel, its ghost bars, and plantings with no bed yet ("To place").

usage: python3 -I step2b_check.py <app-dir-or-offline.html> <shots-dir>

Serves the app folder (or opens the single offline file) and walks it the way a grower would. What the page shows is
checked against what the engine works out in that same page. The rules under test:
  - nothing is added until its button is pressed; what would be added is drawn as ghost bars where it would go;
  - a planting with no bed counts toward nothing, and the number waiting is shown on every view;
  - a waiting planting keeps its own date wherever it is dropped; a free bed takes it whole; a held bed asks how to share;
  - whatever opens to be filled in has an x that leaves without doing anything, and Escape does the same;
  - what he could do before this step still works: the quick "N more, every N days", a crop dragged from the library.
"""
import http.server, json, os, socketserver, sys, threading, functools, pathlib
from playwright.sync_api import sync_playwright

target, shots = sys.argv[1], sys.argv[2]
os.makedirs(shots, exist_ok=True)
results, failed = [], []

def check(name, ok, detail=None):
    results.append(('ok   ' if ok else 'FAIL ') + name + ('' if ok or detail is None else ' ' + json.dumps(detail, default=str)[:700]))
    if not ok:
        failed.append(name)
    if os.environ.get('LIVE'):
        print(results[-1][:900], file=sys.stderr, flush=True)
    if not ok and os.environ.get('STOP_AT_FAIL'):   # for the deliberate faults: the first line that catches one is enough
        print('\n'.join(results)); print(json.dumps({'passed': len(results) - len(failed), 'of': len(results), 'failed': failed, 'stopped': True}), flush=True); os._exit(1)

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

FIGURES = """() => { const A = LRFApp, eng = A.state.engine, year = A.planYear(), F = LRFForecast, m = F.build(eng, { year });
  let bench = 0; for (let d = new Date(year, 0, 1); d.getFullYear() === year; d = LRFEngine.addDays(d, 1)) bench += eng.benchDay(d).total;
  let ground = 0; for (const b of A.state.plan.beds) for (const mth of [3, 5, 7, 9]) ground += eng.cropsAt(b.id, new Date(year, mth, 15)).length;
  const hash = s => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
  return { plantings: A.state.plan.plantings.length, seeds: hash(JSON.stringify(LRFSeedLib.required(eng))), batches: eng.sowingBatches().length, bench: Math.round(bench * 100), ground,
    forecast: hash(JSON.stringify(m.rows.map(r => [r.cropId, Math.round(r.total * 1000)]))), settle: LRFRails.cleanup(eng).count, openings: LRFSuccession.openings(eng).length,
    season: A.state.plan.beds.reduce((n, b) => n + LRFMap.seasonOf(eng, b).length, 0), inBeds: A.state.plan.beds.reduce((n, b) => n + eng.plantingsIn(b.id).length, 0) }; }"""
STATE = "({ n: LRFApp.state.plan.plantings.length, w: LRFApp.waiting().length, undo: LRFApp.state.undo.length, sel: LRFApp.state.sel && LRFApp.state.sel.type, view: LRFApp.state.view })"

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = browser.new_context(viewport={'width': 1480, 'height': 900}, accept_downloads=True)
    page = ctx.new_page()
    page.set_default_timeout(15000)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'ERR_' not in m.text else None)
    page.goto(url)
    page.wait_for_function('window.LRFApp && LRFApp.state.ready', timeout=30000)
    page.wait_for_timeout(500)
    ev = page.evaluate
    st = lambda: ev(STATE)
    def setv(sel, value):
        ev("""([sel, value]) => { const el = document.querySelector(sel); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }""", [sel, value])
        page.wait_for_timeout(120)
    def appears(sel, ms=5000):
        try:
            page.wait_for_selector(sel, timeout=ms); return True
        except Exception:
            return False
    def close_dialogs():
        ev("for (const d of document.querySelectorAll('dialog[open]')) { d.dispatchEvent(new Event('cancel', { cancelable: true })); }")
        page.wait_for_timeout(80)
    def undo_to(n):
        for _ in range(60):
            if ev('LRFApp.state.undo.length') <= n: break
            ev('LRFApp.undo()')
        page.wait_for_timeout(120)
    try:
        year = ev('LRFApp.planYear()')
        s0, base = st(), ev(FIGURES)
        check('the plan opens with nothing waiting, and no count of it anywhere', s0['n'] > 100 and s0['w'] == 0 and ev("document.getElementById('waitBadge').hidden && document.getElementById('waitBox').hidden"), s0)
        radish = ev("(LRFApp.state.engine.crops().find(c => /^Radish$/.test(c.name)) || LRFApp.state.engine.crops().find(c => /radish/i.test(c.name))).id")

        # ── the tool opens in place ──
        page.wait_for_selector('#ovSeries'); page.click('#ovSeries'); page.wait_for_selector('#srForm')
        check('"plan a series" opens the tool in the details panel: no page of its own, no sheet over the page', st()['sel'] == 'series' and st()['view'] == 'map' and ev("!document.querySelector('dialog[open]') && !!document.querySelector('#inspectorBody #srForm') && !document.querySelector('#ahSheet')"))
        setv('#srCrop', radish)
        # a garden of the plan that takes the whole series, none left to place: the first of the tool's own choices that does
        garden = ev("""cropId => { const eng = LRFApp.state.engine, ids = [...document.querySelectorAll('#srGardens input')].map(box => box.value);
          return ids.find(id => { const r = LRFSuccession.series(eng, { cropId, gardenIds: [id], place: 'gardens', basis: 'planting', from: LRFApp.planYear() + '-08-01', every: 10, count: 5, unit: 'whole', amount: 1 }); return !r.error && r.plantings.length >= 3 && !r.held.length; }) || null; }""", radish)
        for _ in range(40):   # one box at a time: each click draws the boxes again, and a box no longer on the page tells nobody it was clicked
            if not ev("""garden => { const box = [...document.querySelectorAll('#srGardens input')].find(b => b.checked !== (b.value === garden)); if (box) box.click(); return !!box; }""", garden): break
            page.wait_for_timeout(60)
        check('the plan has a garden that takes a series of radishes from the first of August, a bed each, with none left to place', garden and ev("LRFSeries.state.P.gardenIds") == [garden], garden)
        page.wait_for_timeout(150)
        setv('#srFrom', '%d-08-01' % year); setv('#srEvery', '10'); setv('#srCount', '5'); setv('#srAmount', '1')
        page.wait_for_selector('#srWaves')
        want = ev("""() => { const P = LRFSeries.state.P, r = LRFSuccession.series(LRFApp.state.engine, { cropId: P.cropId, gardenIds: P.gardenIds, place: 'gardens', basis: 'planting', from: P.from, every: 10, count: 5, unit: 'whole', amount: 1 });
          return { n: r.plantings.length, m: r.held.length, beds: r.waves.flatMap(w => w.placed.map(x => x.bed.id)).sort(), days: r.waves.map(w => LRFEngine.d2s(w.target)) }; }""")
        summary, label = page.inner_text('#srSum'), page.inner_text('#srAdd')
        check('the summary and the button say what the engine works out: so many onto beds, so many to place', want['n'] >= 3 and str(want['n']) in summary and str(want['n']) in label and ((want['m'] == 0) == ('to place' not in label)), [want, summary, label])
        check('five lines, one for each day asked for, ten days apart', ev("[...document.querySelectorAll('#srWaves li > b')].map(b => b.textContent)") == ev("%s.map(d => LRFUI.day(LRFEngine.s2d(d)))" % json.dumps(want['days'])), ev("[...document.querySelectorAll('#srWaves li > b')].map(b => b.textContent)"))
        check('the title says it in his words: the crop, every so many days', 'every 10 days' in page.inner_text('#srTitle'))
        marked = ev("[...document.querySelectorAll('#map .bed.will-plant')].map(g => g.dataset.bed).sort()")
        check('on the map the beds it would plant are marked', marked == sorted(set(want['beds'])), [marked, want['beds']])
        check('nothing is in the plan yet', st()['n'] == s0['n'] and st()['w'] == 0 and st()['undo'] == 0)
        page.screenshot(path=os.path.join(shots, 'series-map.png'))
        fit = ev("""() => { const box = document.querySelector('.inspector').getBoundingClientRect(); return [...document.querySelectorAll('#srForm select, #srForm input:not([type=checkbox]), #srForm .seg, #srOut button, #srWaves li')].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return r.left >= box.left - 0.5 && r.right <= box.right + 0.5; }); }""")
        check('every field, line and button of the tool is inside the panel', len(fit) >= 10 and all(fit), fit)

        # ── ghost bars on the timeline ──
        page.click('#srSee'); page.wait_for_timeout(500)
        GHOSTS = """() => [...document.querySelectorAll('#tlBody .tl-bar.tl-ghost-bar')].map(b => { const row = b.closest('.tl-row'); return { bed: row.dataset.bed || null, wait: row.classList.contains('tl-wait'), a: +b.style.getPropertyValue('--a'), id: b.dataset.ghost, planting: b.dataset.planting || null, drag: getComputedStyle(b).cursor }; })"""
        ghosts = ev(GHOSTS)
        expect = ev("""() => { const g = LRFSeries.ghosts(), eng = LRFApp.state.engine, y0 = new Date(LRFApp.planYear(), 0, 1); return g.placed.map(x => ({ bed: x.bed.id, a: LRFEngine.dayDiff(eng.occupancyFrom(x.p, x.r), y0) })).sort((p, q) => p.a - q.a); }""")
        check('"see it on the timeline" goes there, with the tool still open', st()['view'] == 'timeline' and st()['sel'] == 'series')
        check('each planting it would add is a ghost bar in the row of its bed, on its day', len(ghosts) == want['n'] and sorted([[g['bed'], g['a']] for g in ghosts]) == sorted([[e['bed'], e['a']] for e in expect]), [ghosts, expect])
        check('a ghost bar is not a planting: no id of one, and no hand to drag it', all(g['planting'] is None and g['drag'] == 'default' for g in ghosts))
        first = page.query_selector('#tlBody .tl-bar.tl-ghost-bar'); first.scroll_into_view_if_needed(); first.click(); page.wait_for_timeout(150)
        check('a click on a ghost bar selects nothing and leaves the tool open', st()['sel'] == 'series' and st()['n'] == s0['n'])
        page.screenshot(path=os.path.join(shots, 'series-ghosts.png'))
        setv('#srEvery', '14'); page.wait_for_timeout(350)
        moved = ev(GHOSTS)
        check('changing the days apart moves the ghosts at once', sorted(g['a'] for g in moved) != sorted(g['a'] for g in ghosts) and len(moved) >= 3 and 'every 14 days' in page.inner_text('#srTitle'), [sorted(g['a'] for g in moved), sorted(g['a'] for g in ghosts)])
        setv('#srEvery', '0'); page.wait_for_timeout(250)
        check('a request that makes no sense is refused in words, and draws nothing', page.query_selector('#srError') is not None and len(page.inner_text('#srError')) > 10 and len(ev(GHOSTS)) == 0 and page.query_selector('#srAdd') is None)
        setv('#srEvery', '10'); page.wait_for_timeout(300)
        n_add = ev("LRFSeries.ghosts().placed.length")
        page.click('#srAdd'); page.wait_for_timeout(500)
        after_add = st()
        check('Add puts them in the plan as one step, and the ghosts become plantings', after_add['n'] == s0['n'] + n_add and after_add['undo'] == 1 and len(ev(GHOSTS)) == 0 and page.query_selector('#srDone') is not None, after_add)
        page.click('#srUndo'); page.wait_for_timeout(400)
        check('one undo takes the whole series out, and the form is back with its ghosts', st()['n'] == s0['n'] and len(ev(GHOSTS)) == n_add and page.query_selector('#srAdd') is not None, st())
        page.click('#srClose'); page.wait_for_timeout(300)
        check('the x closes the tool: nothing added, no ghost left', st()['sel'] is None and st()['n'] == s0['n'] and len(ev(GHOSTS)) == 0 and st()['undo'] == 0, st())
        ev("LRFApp.openAhead({ mode: 'series' })"); page.wait_for_selector('#srForm'); page.wait_for_timeout(250)
        kept = ev("[LRFSeries.state.P.cropId, LRFSeries.state.P.every]")
        page.focus('#srEvery'); page.keyboard.press('Escape'); page.wait_for_timeout(250)
        check('Escape closes it too, from inside one of its fields, and what was typed is still there when it is opened again', st()['sel'] is None and len(ev(GHOSTS)) == 0 and kept[0] == radish and str(kept[1]) == '10', [st(), kept])

        # ── from a crop in the library, left to place ──
        ev("LRFApp.setView('map')"); page.wait_for_timeout(200)
        row = page.query_selector('#libList .lib-row[data-crop="%s"]:not(.lib-var)' % radish); row.scroll_into_view_if_needed(); row.hover(); page.wait_for_timeout(100)
        check('a crop in the library has a way into the tool, shown when the pointer is on it', ev("getComputedStyle(document.querySelector('#libList .lib-row[data-crop=\"%s\"] .lib-series')).display" % radish) != 'none')
        page.click('#libList .lib-row[data-crop="%s"] .lib-series' % radish); page.wait_for_selector('#srForm')
        check('it opens the tool on that crop, and does not arm the crop for planting', ev("LRFSeries.state.P.cropId") == radish and ev("LRFApp.state.armed") is None and st()['sel'] == 'series')
        setv('#srFrom', '%d-07-06' % year); setv('#srEvery', '10'); setv('#srCount', '4')
        page.click('#srPlace [data-place="hold"]'); page.wait_for_timeout(300)
        check('"To place" asks for no garden, and says they count toward nothing until placed', page.query_selector('#srGardens') is None and 'counts toward nothing' in page.inner_text('#srHoldNote') and '4' in page.inner_text('#srAdd') and 'to place' in page.inner_text('#srAdd'))
        ev("LRFApp.setView('timeline')"); page.wait_for_timeout(450)
        gw = ev(GHOSTS)
        check('on the timeline they are ghosts on a row of their own at the top, each on its day', len(gw) == 4 and all(g['wait'] and g['bed'] is None for g in gw) and sorted(g['a'] for g in gw) == ev("[0, 1, 2, 3].map(k => LRFEngine.dayDiff(LRFEngine.addDays(new Date(%d, 6, 6), k * 10), new Date(%d, 0, 1)))" % (year, year)), gw)
        check('that row comes before every garden, under its own heading', ev("(() => { const b = document.getElementById('tlBody'); return b.children[0].dataset.section === 'waiting' && b.children[1].classList.contains('tl-wait'); })()"))
        page.click('#srAdd'); page.wait_for_timeout(500)
        held = st()
        check('Add puts none of them in the plan: four wait, as one step', held['n'] == s0['n'] and held['w'] == 4 and held['undo'] == 1, held)
        figures = ev(FIGURES)
        check('with four waiting, every figure is what it was: seeds, sowing batches, bench load, ground, forecast, to settle, openings, the map’s whole season, what the timeline counts in beds', figures == base and figures['season'] > 50, [figures, base])
        counts = ev("[...document.querySelectorAll('#tlFilters small')].map(s => +s.textContent.replace(/,/g, ''))")
        check('the timeline’s own counts are the plan’s plantings, with the four that wait in none of them', len(counts) == 5 and counts[0] == figures['inBeds'] and counts[0] == s0['n'], [counts, figures['inBeds']])
        badge = ev("(() => { const b = document.getElementById('waitBadge'), r = b.getBoundingClientRect(), top = document.querySelector('header.top').getBoundingClientRect(), nav = document.querySelector('nav.views').getBoundingClientRect(); return { hidden: b.hidden, text: b.textContent, inside: r.right <= top.right && r.left >= nav.right, more: getComputedStyle(b.querySelector('.wb-more')).display }; })()")
        check('the header says how many are waiting', not badge['hidden'] and badge['text'].startswith('4 to place') and badge['inside'] and badge['more'] == 'none', badge)
        box = ev("({ hidden: document.getElementById('waitBox').hidden, rows: [...document.querySelectorAll('#waitList .wait-row')].map(r => r.textContent), head: document.getElementById('waitHead').textContent })")
        check('above the crop library a list of them: the crop and the day each goes in', not box['hidden'] and len(box['rows']) == 4 and all('Radish' in r for r in box['rows']) and 'Jul 6' in box['rows'][0] and '4' in box['head'] and 'not counted' in box['head'], box)
        bars = ev("[...document.querySelectorAll('#tlBody .tl-wait .tl-bar')].map(b => ({ w: b.dataset.waiting || null, ghost: b.classList.contains('tl-ghost-bar'), cursor: getComputedStyle(b).cursor }))")
        check('on the timeline they are bars now, to be picked up', len(bars) == 4 and all(b['w'] and not b['ghost'] and b['cursor'] == 'grab' for b in bars), bars)
        check('the heading says they are counted nowhere until placed', 'not counted' in ev("document.querySelector('.tl-waithead').textContent") or 'counted nowhere' in ev("document.querySelector('.tl-waithead').textContent"))
        page.screenshot(path=os.path.join(shots, 'to-place-timeline.png'))
        seen = {}
        for view in ['sow', 'harvest', 'seeds', 'trays', 'assume', 'map']:
            ev("LRFApp.setView('%s')" % view); page.wait_for_timeout(250)
            seen[view] = ev("(() => { const b = document.getElementById('waitBadge'), r = b.getBoundingClientRect(), nav = document.querySelector('nav.views').getBoundingClientRect(), next = document.getElementById('undoBtn').getBoundingClientRect(); return { shown: !b.hidden && r.width > 0, more: getComputedStyle(b.querySelector('.wb-more')).display !== 'none', clear: r.left >= nav.right - 0.5 && r.right <= next.left + 0.5 && r.right <= innerWidth }; })()")
        check('the count is on every view', all(v['shown'] and v['clear'] for v in seen.values()), seen)
        check('where totals are read (Sowing, Harvest, Seeds, Trays) it adds that they are not counted here', all(seen[v]['more'] for v in ['sow', 'harvest', 'seeds', 'trays']) and not seen['map']['more'], seen)
        ev("LRFApp.setView('sow')"); page.wait_for_timeout(300)
        check('the Sowing view lists nothing for them', ev("LRFApp.waiting().every(w => !document.querySelector('[data-planting=\"' + w.id + '\"], [data-id=\"' + w.id + '\"]'))"))
        check('going to a view with no details panel closes the tool', st()['sel'] is None)
        ev("LRFApp.setView('map')"); page.wait_for_timeout(250)
        check('the overview says so too', page.query_selector('#ovWaiting') is not None and '4' in page.inner_text('#ovWaiting'))

        # ── kept: a reload, and a backup file ──
        storage = ev('LRFApp.storage()')
        if storage != 'memory':
            page.wait_for_timeout(1200); page.reload(); page.wait_for_function('window.LRFApp && LRFApp.state.ready', timeout=30000); page.wait_for_timeout(500)
            check('after a reload the four are still waiting, and still counted nowhere', st()['w'] == 4 and st()['n'] == s0['n'] and ev(FIGURES) == base and not ev("document.getElementById('waitBadge').hidden"), st())
        else:
            check('after a reload the four are still waiting, and still counted nowhere', True)
        with page.expect_download() as dl:
            page.click('#dataBtn'); page.click('#exportBtn')
        saved = os.path.join(shots, 'plan-with-waiting.json'); dl.value.save_as(saved)
        data = json.load(open(saved, encoding='utf-8'))
        keep = (data.get('lrfNextKeep') or {}).get('keep') or {}
        check('a backup file holds them apart from the plantings v7 reads', len(data['plantings']) == s0['n'] and len(keep.get('waiting') or []) == 4 and all('bedId' not in w for w in keep['waiting']) and 'lrfNext' not in data, [len(data['plantings']), len(keep.get('waiting') or [])])
        ids = ev("LRFApp.waiting().map(w => w.id)")
        ev("LRFApp.removeWaiting(LRFApp.waiting().slice(0, 3).map(w => w.id))"); page.wait_for_timeout(200)
        check('three removed in one step: one is left', st()['w'] == 1 and 'to place' in ev("document.getElementById('waitBadge').textContent"))
        page.set_input_files('#importFile', saved); page.wait_for_selector('dialog[open] .btn.danger'); page.click('dialog[open] .btn.danger')
        page.wait_for_function('LRFApp.waiting().length === 4', timeout=20000); page.wait_for_timeout(600)
        check('opening that file again brings back the four it held, not the one that was open', ev("LRFApp.waiting().map(w => w.id)") == ids and st()['n'] == s0['n'], st())
        u0 = st()['undo']
        # the file was loaded over the plan the page ships with: from here on, the figures to hold to are this plan's
        loaded = ev(FIGURES)
        # (a plan saved and opened again differs a little from the copy the page ships with, as it did before this step: live trays are planned again from their demand, and vendor size lists come from the file)
        check('the plan read back from the file has the same plantings, forecast and overlaps to settle as before', loaded['plantings'] == base['plantings'] and loaded['forecast'] == base['forecast'] and loaded['settle'] == base['settle'], [loaded, base])
        base = loaded

        # ── a waiting planting in the details panel ──
        ev("LRFApp.setView('map'); LRFApp.setDate(new Date(LRFApp.planYear(), 3, 20))"); page.wait_for_timeout(250)
        page.click('#waitList .wait-row'); page.wait_for_selector('#wtHomes')
        w1 = ev("LRFApp.waitingOne(LRFApp.state.sel.id)")
        check('a click on one shows it in the details panel and turns the map to its day', st()['sel'] == 'waiting' and ev("LRFEngine.d2s(LRFApp.state.date)") == w1['date'] and 'counts toward nothing' in page.inner_text('#wtNote'), [st(), w1['date']])
        homes = ev("LRFSuccession.homes(LRFApp.state.engine, LRFApp.waitingOne(LRFApp.state.sel.id)).map(h => h.bed.id)")
        listed = ev("[...document.querySelectorAll('#wtHomes [data-home]')].map(b => b.dataset.home)")
        check('it lists the spaces free for all of its days, in season', len(homes) > 0 and listed == homes[:8] and (len(homes) <= 8 or page.query_selector('#wtMore') is not None), [len(homes), listed])
        check('and shows its days, read off ground like the ground it is headed for', page.query_selector('#wtSched') is not None and ev("LRFUI.day(LRFEngine.s2d('%s'))" % w1['date']) in page.inner_text('#wtSched'))
        page.screenshot(path=os.path.join(shots, 'waiting-panel.png'))
        setv('#wtDate', '%d-07-09' % year); page.wait_for_timeout(250)
        check('its date can be changed while it waits, as a step that can be undone', ev("LRFApp.waitingOne('%s').date" % w1['id']) == '%d-07-09' % year and st()['undo'] == u0 + 1 and st()['w'] == 4)
        ev('LRFApp.undo()'); page.wait_for_timeout(250)
        check('undo puts the date back', ev("LRFApp.waitingOne('%s').date" % w1['id']) == w1['date'])
        page.click('#waitList .wait-row'); page.wait_for_selector('#wtHomes [data-home]')
        page.click('#wtHomes [data-home]'); page.wait_for_timeout(500)
        placed = ev("(() => { const A = LRFApp, p = A.state.engine.planting('%s'), r = p && A.state.engine.calc(p); return p ? { bed: p.bedId, date: p.date, whole: r.physicalLength >= r.cap - 1e-6 || r.tw, wait: 'wait' in p, sel: A.state.sel && A.state.sel.id, trouble: LRFRails.cleanup(A.state.engine).count } : null; })()" % w1['id'])
        check('a click on a free space puts it there whole, on its own date', placed is not None and placed['bed'] == homes[0] and placed['date'] == w1['date'] and placed['whole'] and not placed['wait'] and placed['sel'] == w1['id'] and placed['trouble'] == base['settle'], placed)
        check('it is a planting now: one fewer waits, one more is planted, in one step', st()['n'] == s0['n'] + 1 and st()['w'] == 3 and st()['undo'] == u0 + 1 and ev(FIGURES)['seeds'] != base['seeds'], st())
        ev('LRFApp.undo()'); page.wait_for_timeout(300)
        check('one undo sends it back to wait, and nothing that is gone stays selected', st()['n'] == s0['n'] and st()['w'] == 4 and ev(FIGURES) == base and st()['sel'] is None, st())

        # ── dragged onto the map: it keeps its own date ──
        def centre(sel):
            return ev("""(sel) => { const el = document.querySelector(sel); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }""", sel)
        def drag(src, dst, hold=None):
            a = centre(src) if isinstance(src, str) else src
            page.mouse.move(a['x'], a['y']); page.mouse.down(); page.mouse.move(a['x'] + 8, a['y'] + 8, steps=3); page.wait_for_timeout(60)
            start = ev("(() => { const g = document.querySelector('.drag-ghost .drag-hint'); return g ? g.textContent : ''; })()")
            b = dst() if callable(dst) else centre(dst) if isinstance(dst, str) else dst
            page.mouse.move(b['x'], b['y'], steps=8); page.wait_for_timeout(180)
            seen = ev("(() => { const g = document.querySelector('.drag-ghost'); return g ? { state: g.dataset.state, hint: g.querySelector('.drag-hint').textContent, label: g.querySelector('b').textContent } : null; })()")
            if hold: hold()
            page.mouse.up(); page.wait_for_timeout(450)
            if seen is not None: seen['start'] = start
            return seen
        ev("LRFApp.select(null); LRFApp.setView('map'); LRFMap.fit(true); LRFApp.setDate(new Date(LRFApp.planYear(), 3, 20))"); page.wait_for_timeout(400)
        w2 = ev("LRFApp.waiting()[1]")
        # a free soil bed that can be seen on the map
        spot = ev("""(id) => { const A = LRFApp, eng = A.state.engine, w = A.waitingOne(id), box = document.getElementById('map').getBoundingClientRect();
          for (const h of LRFSuccession.homes(eng, w)) { if (!eng.isSoilBed(h.bed)) continue; const el = document.querySelector('#map [data-bed="' + h.bed.id + '"]'); if (!el) continue; const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
            if (x > box.left + 30 && x < box.right - 30 && y > box.top + 30 && y < box.bottom - 120) { const at = document.elementFromPoint(x, y); if (at && at.closest('[data-bed]') && at.closest('[data-bed]').dataset.bed === h.bed.id) return { bed: h.bed.id, x, y }; } }
          return null; }""", w2['id'])
        states = {}
        def survey():
            states.update(ev("({ ok: document.querySelectorAll('#map .bed.drop-ok').length, split: document.querySelectorAll('#map .bed.drop-split').length, blocked: document.querySelectorAll('#map .bed.drop-blocked').length })"))
        seen = drag('#waitList .wait-row[data-waiting="%s"]' % w2['id'], spot, survey)
        p2 = ev("(() => { const p = LRFApp.state.engine.planting('%s'), r = p && LRFApp.state.engine.calc(p); return p ? { bed: p.bedId, date: p.date, whole: r.physicalLength >= r.cap - 1e-6 } : null; })()" % w2['id'])
        check('dragged from the list onto a free bed on the map, it takes the whole bed', spot is not None and p2 is not None and p2['bed'] == spot['bed'] and p2['whole'], [spot, p2, seen])
        check('it keeps its own date, though the map stood on another day', p2 is not None and p2['date'] == w2['date'] and ev("LRFEngine.d2s(LRFApp.state.date)") != w2['date'], [p2, w2['date']])
        check('picked up, before it is over any bed, the hint says it keeps its date and names that date', seen is not None and 'keeps its date' in seen['start'] and ev("LRFUI.day(LRFEngine.s2d('%s'))" % w2['date']) in seen['start'], seen)
        check('over a free bed the hint is that bed and its own day, and the map marks free beds and beds that could be shared', seen is not None and seen['state'] == 'ok' and ev("LRFUI.day(LRFEngine.s2d('%s'))" % w2['date']) in seen['hint'] and states.get('ok', 0) > 5 and states.get('split', 0) > 0, [seen, states])
        undo_to(u0)

        # ── dragged on the timeline ──
        ev("LRFApp.setView('timeline'); LRFTimeline.setFilter('field')"); page.wait_for_timeout(500)
        w3 = ev("LRFApp.waiting()[2]")
        ev("document.getElementById('tlScroll').scrollTop = 0"); page.wait_for_timeout(200)
        # a free bed whose row can be seen together with the row they wait on; or, on a plan whose free beds are all further down than
        # the window is tall, the first free bed with a row at all: the wheel brings that row up while the bar is held
        SEEN = "(r, v) => r.top > v.top + 60 && r.bottom < v.bottom - 10"
        row = ev("""(id) => { const A = LRFApp, eng = A.state.engine, w = A.waitingOne(id), v = document.getElementById('tlScroll').getBoundingClientRect(), seen = %s; let first = null; for (const h of LRFSuccession.homes(eng, w)) { const el = document.querySelector('#tlBody .tl-row[data-bed="' + h.bed.id + '"]'); if (!el) continue; first = first || h.bed.id; if (seen(el.getBoundingClientRect(), v)) return h.bed.id; } return first; }""" % SEEN, w3['id'])
        check('one that waits has a free bed with a row on the timeline, to be dropped on', row is not None, w3)
        scroll = ev("(() => { const r = document.getElementById('tlScroll').getBoundingClientRect(); return { left: r.left, right: r.right }; })()")
        def far():   # far from its own day: February, at this scale
            down = ev("(sel) => { const r = document.querySelector(sel).getBoundingClientRect(), v = document.getElementById('tlScroll').getBoundingClientRect(); return (%s)(r, v) ? 0 : Math.round(r.top - v.top - 120); }" % SEEN, '#tlBody .tl-row[data-bed="%s"]' % row)
            if down: page.mouse.wheel(0, down); page.wait_for_timeout(300)
            lane = ev("(sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { y: r.top + r.height / 2 }; }", '#tlBody .tl-row[data-bed="%s"] .tl-lane' % row)
            return {'x': scroll['left'] + 148 + 40, 'y': lane['y']}
        src = ev("(sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + Math.min(10, r.width / 2), y: r.top + r.height / 2 }; }", '#tlBody .tl-bar[data-waiting="%s"]' % w3['id'])
        tl = {}
        def ghost_at():
            tl.update(ev("(() => { const g = document.getElementById('tlGhost'), row = document.querySelector('#tlBody .tl-row.drop-target'); return { shown: !g.hidden, state: g.dataset.state, row: row && row.dataset.bed, left: parseFloat(g.style.left) }; })()"))
        seen = drag(src, far, ghost_at)
        p3 = ev("(() => { const p = LRFApp.state.engine.planting('%s'); return p ? { bed: p.bedId, date: p.date } : null; })()" % w3['id'])
        own_x = ev("148 + LRFEngine.dayDiff(LRFEngine.s2d('%s'), new Date(%d, 0, 1)) * LRFTimeline.scale()" % (w3['date'], year))
        check('picked up from its row on the timeline and dropped on a bed’s row, far from its own day, it goes into that bed on its own date', p3 is not None and p3['bed'] == row and p3['date'] == w3['date'], [p3, row, w3['date'], seen])
        check('the outline of where it would land is drawn at its own date, not under the pointer', tl.get('shown') and tl.get('row') == row and abs(tl.get('left', 0) - own_x) < 3, [tl, own_x])
        undo_to(u0)
        ev("document.getElementById('tlScroll').scrollTop = 0; LRFTimeline.setFilter('all')"); page.wait_for_timeout(300)

        # ── a bed that is held: how to share it ──
        share = ev("""() => { const A = LRFApp, eng = A.state.engine, S = LRFSuccession, w = A.waiting()[0], out = { w: w.id };
          for (const b of A.state.plan.beds.filter(b => eng.isSoilBed(b) && b.active !== false)) { const res = S.landing(eng, w, { bedId: b.id }); if (res.state !== 'split') continue;
            const ids = res.ways.map(x => x.id).join('+'); if (!out[ids]) out[ids] = { bed: b.id, holder: res.holder.p.id, len: eng.calc(res.holder.p).physicalLength, ways: res.ways.map(x => ({ id: x.id, min: x.min, max: x.max, def: x.def, total: x.total })) }; }
          return out; }""")
        both = share.get('length+rows') or share.get('length') or share.get('rows')
        check('for a radish that waits there are beds held by one crop on its day', both is not None, share)
        before = st()
        ev("void LRFApp.placeWaiting('%s', '%s')" % (share['w'], both['bed'])); asked = appears('#shareDlg[open]')
        lead = page.inner_text('#shareLead') if asked else ''
        check('placed on a bed that one crop holds, it asks how to share the bed, and says its date does not change', asked and 'holds' in lead and 'date does not change' in lead and len(ev("[...document.querySelectorAll('#shareDlg .share-way')].map(e => e.dataset.way)")) == len(both['ways']), [lead, both])
        inside = ev("(() => { const r = document.getElementById('shareDlg').getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()")
        check('the question fits the window', inside)
        page.screenshot(path=os.path.join(shots, 'share.png'))
        page.click('#shareClose'); page.wait_for_timeout(250)
        check('its x leaves without doing anything', st() == before and page.query_selector('#shareDlg') is None, st())
        ev("void LRFApp.placeWaiting('%s', '%s')" % (share['w'], both['bed'])); page.wait_for_selector('#shareDlg[open]'); page.keyboard.press('Escape'); page.wait_for_timeout(250)
        check('Escape does the same', st() == before and page.query_selector('#shareDlg') is None, st())
        ev("void LRFApp.placeWaiting('%s', '%s')" % (share['w'], both['bed'])); page.wait_for_selector('#shareDlg[open]'); page.click('#shareCancel'); page.wait_for_timeout(250)
        check('and so does Cancel', st() == before and page.query_selector('#shareDlg') is None, st())
        for way_id in ['length', 'rows']:
            case = share.get('length+rows') if share.get('length+rows') else share.get(way_id)
            way = next((x for x in (case or {}).get('ways', []) if x['id'] == way_id), None)
            if not way:
                check('sharing by %s' % way_id, False, 'no bed in this plan offers it'); continue
            ev("void LRFApp.placeWaiting('%s', '%s')" % (share['w'], case['bed'])); page.wait_for_selector('#shareDlg[open]')
            field, button = ('#shareFt', '#shareLength') if way_id == 'length' else ('#shareRows', '#shareByRows')
            n = way['max'] if way_id == 'rows' else min(way['max'], 7)
            setv(field, str(way['max'] + 1))
            check('by %s: a number it cannot give up switches Place off and says the limits' % way_id, ev("document.querySelector('%s').disabled" % button) and 'Between' in ev("document.querySelector('#shareDlg .share-way[data-way=%s] small').textContent" % way_id))
            setv(field, str(n))
            said = ev("document.querySelector('#shareDlg .share-way[data-way=%s] small').textContent" % way_id)
            page.click(button); page.wait_for_timeout(500)
            got = ev("""([wid, hid]) => { const A = LRFApp, eng = A.state.engine, p = eng.planting(wid), h = eng.planting(hid); if (!p) return null; const r = eng.calc(p), hr = eng.calc(h), f = eng.footprint(p, r), hf = eng.footprint(h, hr);
              return { bed: p.bedId, date: p.date, len: r.physicalLength, rows: f.rows && f.rows.count, hlen: hr.physicalLength, hrows: hf.rows && hf.rows.count, clash: eng.conflicts(p, r).length, hdate: h.date }; }""", [share['w'], case['holder']])
            ok = got is not None and got['bed'] == case['bed'] and got['clash'] == 0 and st()['undo'] == u0 + 1 and st()['w'] == 3 and st()['n'] == s0['n'] + 1
            if way_id == 'length':
                ok = ok and abs(got['len'] - n) < 0.6 and abs(got['hlen'] - (case['len'] - got['len'])) < 0.01 and 'keeps' in said
            else:
                ok = ok and got['rows'] == n and got['hrows'] == way['total'] - n if way.get('total') and case.get('rowsAll', True) else ok and got['rows'] == n
            check('by %s: the crop there gives up what was asked, the new one takes it, and nothing overlaps: one step' % way_id, ok, [got, n, case, said, st()])
            ev('LRFApp.undo()'); page.wait_for_timeout(300)
            back = ev("(hid) => LRFApp.state.engine.calc(LRFApp.state.engine.planting(hid)).physicalLength", case['holder'])
            check('by %s: one undo gives the crop its bed back and sends the other back to wait' % way_id, st()['n'] == s0['n'] and st()['w'] == 4 and abs(back - case['len']) < 0.01 and ev(FIGURES) == base, [st(), back])
        # dropped there by hand, the same question
        ev("LRFApp.setView('timeline'); LRFTimeline.setFilter('all')"); page.wait_for_timeout(400)
        ev("(bed) => LRFTimeline.reveal(LRFApp.state.engine.plantingsIn(bed)[0].id)", both['bed']); page.wait_for_timeout(300)
        src = ev("(sel) => { const el = document.querySelector(sel); el.scrollIntoView({ block: 'center' }); return null; }", '#tlBody .tl-row[data-bed="%s"]' % both['bed'])
        can_see = ev("(() => { const a = document.querySelector('#tlBody .tl-bar[data-waiting=\"%s\"]').getBoundingClientRect(), b = document.querySelector('#tlBody .tl-row[data-bed=\"%s\"]').getBoundingClientRect(), v = document.getElementById('tlScroll').getBoundingClientRect(); return a.top > v.top + 40 && a.bottom < v.bottom && b.top > v.top + 40 && b.bottom < v.bottom; })()" % (share['w'], both['bed']))
        if can_see:
            srcp = ev("(sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + Math.min(10, r.width / 2), y: r.top + r.height / 2 }; }", '#tlBody .tl-bar[data-waiting="%s"]' % share['w'])
            dstp = ev("(sel) => { const r = document.querySelector(sel).getBoundingClientRect(), v = document.getElementById('tlScroll').getBoundingClientRect(); return { x: Math.min(v.right - 60, Math.max(v.left + 200, r.left + r.width / 2)), y: r.top + r.height / 2 }; }", '#tlBody .tl-row[data-bed="%s"] .tl-lane' % both['bed'])
            seen = drag(srcp, dstp)
            opened = page.query_selector('#shareDlg[open]') is not None
            check('dropped on that bed by hand it asks the same question, and the hint said it would', opened and seen is not None and seen['state'] == 'split' and 'share' in seen['hint'], seen)
            close_dialogs()
        else:
            # the two rows are too far apart to see at once at this size: ask through the same door a drop uses
            ev("LRFApp.place({ waitingId: '%s' }, '%s', new Date())" % (share['w'], both['bed'])); page.wait_for_timeout(300)
            check('dropped on that bed by hand it asks the same question, and the hint said it would', page.query_selector('#shareDlg[open]') is not None and ev("LRFApp.preview({ waitingId: '%s' }, { bedId: '%s' }).state" % (share['w'], both['bed'])) == 'split')
            close_dialogs()
        check('nothing was placed by asking', st()['n'] == s0['n'] and st()['w'] == 4)
        two = ev("""() => { const A = LRFApp, eng = A.state.engine, w = A.waiting()[0]; for (const b of A.state.plan.beds.filter(b => eng.isSoilBed(b))) { const res = A.preview({ waitingId: w.id }, { bedId: b.id }); if (res.state === 'blocked' && res.why === 'held') return { bed: b.id, text: res.text }; } return null; }""")
        if two:
            ev("void LRFApp.placeWaiting('%s', '%s')" % (share['w'], two['bed'])); page.wait_for_timeout(300)
            check('where the ground cannot be shared it is refused in words, with no question', page.query_selector('#shareDlg') is None and st()['n'] == s0['n'] and st()['w'] == 4 and len(two['text']) > 5, two)
        else:
            check('where the ground cannot be shared it is refused in words, with no question', True)

        # ── named beds: from a bed, and by clicking ──
        ev("LRFApp.setView('timeline'); LRFTimeline.setFilter('field')"); page.wait_for_timeout(400)
        beds3 = ev("""() => { const A = LRFApp, eng = A.state.engine, w = A.waiting()[0]; return LRFSuccession.homes(eng, w).filter(h => eng.isSoilBed(h.bed) && document.querySelector('#tlBody .tl-row[data-bed="' + h.bed.id + '"]')).slice(0, 3).map(h => h.bed.id); }""")
        ev("LRFApp.select({ type: 'bed', id: '%s' })" % beds3[0]); page.wait_for_selector('#bedSeries'); page.click('#bedSeries'); page.wait_for_selector('#srForm')
        setv('#srCrop', radish)
        chips = lambda: ev("[...document.querySelectorAll('#srBeds .sr-chip')].map(c => c.dataset.bed)")
        check('from a bed’s panel the tool opens on that bed, named', appears('#srBeds', 1500) and st()['sel'] == 'series' and ev("LRFSeries.state.P.place") == 'beds' and chips() == [beds3[0]], [chips(), beds3])
        def click_row(bed):
            r = ev("(bed) => { const el = document.querySelector('#tlBody .tl-row[data-bed=\"' + bed + '\"] .tl-label'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; }", bed)
            page.mouse.click(r['x'], r['y']); page.wait_for_timeout(250)
        click_row(beds3[1])
        check('while it asks for beds, a click on a row of the timeline names that bed and leaves the tool open', chips() == beds3[:2] and st()['sel'] == 'series', chips())
        click_row(beds3[1])
        check('a second click takes it off the list', chips() == [beds3[0]] and st()['sel'] == 'series', chips())
        opts = ev("[...document.querySelectorAll('#srBedAdd option')].map(o => o.value)")
        setv('#srBedAdd', beds3[2])
        check('a bed can be added from the list as well', chips() == [beds3[0], beds3[2]] and beds3[2] in opts and beds3[0] not in opts, chips())
        ev("LRFApp.setView('map')"); page.wait_for_timeout(300)
        check('on the map the named beds are marked', ev("[...document.querySelectorAll('#map .bed.named')].map(g => g.dataset.bed).sort()") == sorted([beds3[0], beds3[2]]))
        mapbed = ev("""(skip) => { const box = document.getElementById('map').getBoundingClientRect(), eng = LRFApp.state.engine; for (const g of document.querySelectorAll('#map .bed')) { const id = g.dataset.bed, b = eng.bedOf(id); if (skip.includes(id) || !eng.isSoilBed(b)) continue; const r = g.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
          if (x > box.left + 30 && x < box.right - 30 && y > box.top + 30 && y < box.bottom - 120) { const at = document.elementFromPoint(x, y); if (at && at.closest('[data-bed]') && at.closest('[data-bed]').dataset.bed === id) return { id, x, y }; } } return null; }""", [beds3[0], beds3[2]])
        page.mouse.click(mapbed['x'], mapbed['y']); page.wait_for_timeout(300)
        check('a click on a bed on the map names it too', mapbed['id'] in chips() and st()['sel'] == 'series', [mapbed, chips()])
        blank = ev("(() => { const r = document.getElementById('map').getBoundingClientRect(); for (let x = r.left + 20; x < r.right - 20; x += 37) for (let y = r.top + 70; y < r.bottom - 140; y += 29) { const at = document.elementFromPoint(x, y); if (at && at.closest('#map') && !at.closest('[data-bed], .garden-label, .map-tools, .map-foot')) { let near = false; for (const g of document.querySelectorAll('#map .bed')) { const b = g.getBoundingClientRect(); if (x > b.left - 14 && x < b.right + 14 && y > b.top - 14 && y < b.bottom + 14) { near = true; break; } } if (!near) return { x, y }; } } return null; })()")
        if blank:
            page.mouse.click(blank['x'], blank['y']); page.wait_for_timeout(250)
        check('a stray click on the photo does not throw the half-filled tool away', st()['sel'] == 'series', blank)
        ev("LRFSeries.state.P.bedIds = %s; LRFApp.emit('sel')" % json.dumps([beds3[0]])); page.wait_for_timeout(200)
        setv('#srFrom', '%d-07-06' % year); setv('#srEvery', '5'); setv('#srCount', '6')
        spill = ev("(() => { const r = LRFSeries.ghosts(); return { n: r.placed.length, m: r.held.length, why: r.held.map(w => w.wait.why), beds: [...new Set(r.placed.map(x => x.bed.id))], dates: r.held.map(w => w.date) }; })()")
        label = page.inner_text('#srAdd')
        check('six radishes five days apart into one bed: what fits goes in, the rest would wait, and the button says both', spill['n'] >= 1 and spill['m'] >= 1 and spill['n'] + spill['m'] == 6 and spill['beds'] == [beds3[0]] and str(spill['n']) in label and str(spill['m']) in label and 'to place' in label, [spill, label])
        check('each line that waits says what stands in its way', ev("[...document.querySelectorAll('#srWaves li.wait')].length") == spill['m'] and all(spill['why']) and ev("[...document.querySelectorAll('#srWaves li.wait small')].every(s => s.textContent.length > 3)"), spill)
        check('what waits keeps the day it was asked for: no date is moved', spill['dates'] == ev("(() => { const r = LRFSeries.ghosts(), all = [0, 1, 2, 3, 4, 5].map(k => LRFEngine.d2s(LRFEngine.addDays(new Date(%d, 6, 6), k * 5))), used = new Set(r.placed.map(x => x.p.date)); return all.filter(d => !used.has(d)); })()" % year), spill)
        page.screenshot(path=os.path.join(shots, 'series-beds.png'))
        page.click('#srAdd'); page.wait_for_timeout(500)
        check('Add does both as one step', st()['n'] == s0['n'] + spill['n'] and st()['w'] == 4 + spill['m'] and st()['undo'] == u0 + 1, st())
        ev('LRFApp.undo()'); page.wait_for_timeout(300); ev("LRFApp.select(null)"); page.wait_for_timeout(200)
        check('and one undo takes both back', st()['n'] == s0['n'] and st()['w'] == 4)
        tower = ev("(() => { const eng = LRFApp.state.engine, t = LRFApp.state.plan.beds.find(b => eng.isTower(b)); return t ? t.id : null; })()")
        if tower:
            ev("LRFApp.openAhead({ mode: 'series', cropId: '%s' }); LRFSeries.state.P.place = 'beds'; LRFApp.emit('sel')" % radish); page.wait_for_timeout(250)
            used = ev("LRFSeries.toggleBed('%s')" % tower)
            check('a space the crop cannot go in is not named, and the page says why', used is True and tower not in chips() and 'cannot go in' in page.inner_text('#toast'))
            ev("LRFApp.select(null)"); page.wait_for_timeout(150)
        else:
            check('a space the crop cannot go in is not named, and the page says why', True)

        # ── from a planting; and what he could do before still works ──
        ev("LRFApp.setView('map')"); page.wait_for_timeout(200)
        src = ev("""() => { const A = LRFApp, eng = A.state.engine; const p = A.state.plan.plantings.find(p => { const r = eng.calc(p); return r && eng.isSoilBed(r.b) && !p.liveTray && !eng.standKey(p) && /radish|lettuce|bean/i.test(r.c.name); }) || A.state.plan.plantings.find(p => { const r = eng.calc(p); return r && eng.isSoilBed(r.b); }); return { id: p.id, crop: p.cropId, garden: eng.bedOf(p.bedId).gardenId }; }""")
        ev("LRFApp.select({ type: 'planting', id: '%s' })" % src['id']); page.wait_for_selector('#fSeriesLink')
        check('the quick "N more, every N days" is still in a planting’s panel', page.query_selector('#fRepeatCount') is not None and page.query_selector('#fRepeatEvery') is not None)
        setv('#fRepeatCount', '2'); ev("document.querySelector('#fRepeatCount').closest('.repeat').querySelector('button').click()"); page.wait_for_timeout(450)
        quick = st()
        check('and it still adds straight away, or says there is no room: nothing is sent to wait by it', quick['w'] == 4 and quick['n'] >= s0['n'] and quick['n'] <= s0['n'] + 2 and (quick['n'] > s0['n']) == (quick['undo'] == u0 + 1), quick)
        undo_to(u0)
        ev("LRFApp.select({ type: 'planting', id: '%s' })" % src['id']); page.wait_for_selector('#fSeriesLink'); page.click('#fSeriesLink'); page.wait_for_selector('#srForm')
        from_p = ev("({ crop: LRFSeries.state.P.cropId, source: LRFSeries.state.P.sourceId, gardens: LRFSeries.state.P.gardenIds, view: LRFApp.state.view })")
        check('its longer-series link opens the tool copied from that planting, in its garden, without leaving the map', from_p['crop'] == src['crop'] and from_p['source'] == src['id'] and from_p['gardens'] == [src['garden']] and from_p['view'] == 'map', from_p)
        page.click('#srMore'); page.wait_for_selector('#srMoreBody')
        check('"more settings" holds the rest: which planting it copies, what the first date means, leaving out what is covered', ev("document.querySelector('#srModel').value") == src['id'] and page.query_selector('#srBasisHarvest') is not None and page.query_selector('#srSkip') is not None)
        page.click('#srClose'); page.wait_for_timeout(250)
        check('closing it goes back to the planting it was opened from', st()['sel'] == 'planting' and ev("LRFApp.state.sel.id") == src['id'])
        # a crop dragged from the library still plants on the planning date
        ev("LRFApp.select(null); LRFMap.fit(true)"); page.wait_for_timeout(300)
        day0 = '%d-07-06' % year
        ev("LRFApp.setDate(LRFEngine.s2d('%s'))" % day0); page.wait_for_timeout(250)
        spot = ev("""(crop) => { const A = LRFApp, eng = A.state.engine, box = document.getElementById('map').getBoundingClientRect(); for (const g of document.querySelectorAll('#map .bed')) { const id = g.dataset.bed; if (!eng.isSoilBed(eng.bedOf(id)) || A.preview({ cropId: crop }, { bedId: id, date: A.state.date }).state !== 'ok') continue; const r = g.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
          if (x > box.left + 30 && x < box.right - 30 && y > box.top + 30 && y < box.bottom - 120) { const at = document.elementFromPoint(x, y); if (at && at.closest('[data-bed]') && at.closest('[data-bed]').dataset.bed === id) return { bed: id, x, y }; } } return null; }""", radish)
        seen = drag('#libList .lib-row[data-crop="%s"]:not(.lib-var) .lib-name' % radish, spot)
        lib = ev("(() => { const s = LRFApp.state.sel, p = s && s.type === 'planting' ? LRFApp.state.engine.planting(s.id) : null; return p ? { bed: p.bedId, date: p.date, crop: p.cropId } : null; })()")
        check('a crop dragged from the library onto a bed still plants it on the planning date, as before', lib is not None and lib['bed'] == spot['bed'] and lib['date'] == day0 and lib['crop'] == radish and st()['n'] == s0['n'] + 1 and st()['w'] == 4, [lib, spot, seen])
        undo_to(u0)

        # ── from an opening; and "where could this crop go?" ──
        ev("LRFApp.setView('map'); LRFApp.openAhead({ mode: 'series', cropId: '%s' })" % radish); page.wait_for_selector('#srRoomToggle')
        page.click('#srRoomToggle'); page.wait_for_selector('#srRoom .p-open, #srRoomNone')
        room = ev("(() => { const r = LRFSuccession.room(LRFApp.state.engine, LRFSeries.state.P.cropId, {}); return { n: r.openings.length, first: r.openings[0] && r.openings[0].opening.id, bed: r.openings[0] && r.openings[0].opening.bed.id, empty: r.empty.length }; })()")
        listed = ev("[...document.querySelectorAll('#srRoom [data-room-opening]')].map(b => b.dataset.roomOpening)")
        check('"where could radish go this season?" lists the openings its whole cycle fits, soonest first', room['n'] >= 3 and len(listed) == min(8, room['n']) and listed[0] == room['first'] and (room['n'] <= 8 or page.query_selector('#srRoomMore') is not None) and ((room['empty'] > 0) == (page.query_selector('#srRoomEmpty') is not None)), [room, listed])
        page.screenshot(path=os.path.join(shots, 'series-room.png'))
        page.click('#srRoom [data-room-opening]'); page.wait_for_selector('#ahReview')
        check('a click on one shows that opening, with the crop already chosen in it', st()['sel'] == 'opening' and ev("LRFApp.state.sel.id") == room['first'] and ev("LRFAhead.state.O.pick.cropId") == radish)
        day_in = ev("document.getElementById('ahDate').value")
        page.click('#ahSeries'); page.wait_for_selector('#srForm')
        from_o = ev("({ crop: LRFSeries.state.P.cropId, from: LRFSeries.state.P.from, gardens: LRFSeries.state.P.gardenIds, place: LRFSeries.state.P.place })")
        check('from an opening a series starts on that day, in that garden', from_o['crop'] == radish and from_o['from'] == day_in and from_o['gardens'] == [ev("LRFApp.state.engine.bedOf('%s').gardenId" % room['bed'])] and from_o['place'] == 'gardens', [from_o, day_in])
        ev("LRFApp.select(null)"); page.wait_for_timeout(200)

        # ── taking them off the list ──
        page.click('#waitList .wait-row'); page.wait_for_selector('#wtRemove')
        check('one of a series offers to remove just it, or all of its series still waiting', 'all 4' in page.inner_text('#wtRemoveAll'))
        page.click('#wtRemove'); page.wait_for_timeout(300)
        check('Remove takes one off, as a step that can be undone', st()['w'] == 3 and st()['undo'] == u0 + 1 and st()['sel'] is None and ev("document.getElementById('waitBadge').textContent").startswith('3 to place'))
        ev('LRFApp.undo()'); page.wait_for_timeout(250)
        page.click('#waitList .wait-row'); page.wait_for_selector('#wtRemoveAll'); page.click('#wtRemoveAll'); page.wait_for_timeout(350)
        gone = ev("({ badge: document.getElementById('waitBadge').hidden, box: document.getElementById('waitBox').hidden })")
        ev("LRFApp.setView('timeline')"); page.wait_for_timeout(400)
        check('with all of them removed the count, the list and the timeline’s row are gone', st()['w'] == 0 and gone['badge'] and gone['box'] and page.query_selector('#tlBody .tl-wait') is None and page.query_selector('#tlBody .tl-waithead') is None and ev(FIGURES) == base, [st(), gone])
        ev('LRFApp.undo()'); page.wait_for_timeout(350)
        check('and one undo brings all four back', st()['w'] == 4 and page.query_selector('#tlBody .tl-wait') is not None)

        # ── a file saved with nothing waiting says so ──
        none = dict(data); none['lrfNextKeep'] = dict(data['lrfNextKeep']); none['lrfNextKeep']['keep'] = {k: v for k, v in keep.items() if k != 'waiting'}
        bare = os.path.join(shots, 'plan-none-waiting.json'); json.dump(none, open(bare, 'w', encoding='utf-8'))
        ev("LRFApp.setView('map')"); page.wait_for_timeout(200)
        page.set_input_files('#importFile', bare); page.wait_for_selector('dialog[open] .btn.danger')
        said = page.inner_text('dialog[open] p')
        page.click('dialog[open] .btn.danger'); page.wait_for_function('LRFApp.state.undo.length === 0', timeout=20000); page.wait_for_timeout(900)
        check('a file this app saved with nothing waiting brings none: the four waiting here do not ride over it, and the question said they would be gone', st()['w'] == 0 and st()['n'] == s0['n'] and ev("document.getElementById('waitBadge').hidden") and 'waiting to be placed' not in said and '4 plantings still to place here are not in that file' in said, [st(), said[-300:]])
        ev("(() => { const A = LRFApp, r = LRFSuccession.series(A.state.engine, { cropId: '%s', place: 'hold', basis: 'planting', from: '%d-07-06', every: 10, count: 4, unit: 'whole', amount: 1 }); A.addSeries(r, 'four to place'); })()" % (radish, year)); page.wait_for_timeout(300)
        check('four more can be made to wait straight away', st()['w'] == 4 and st()['undo'] == 1)
        ev("LRFApp.select({ type: 'waiting', id: LRFApp.waiting()[0].id })"); page.wait_for_selector('#wtHomes'); ev('LRFApp.undo()'); page.wait_for_timeout(300)
        check('undoing that while one of them is shown leaves nothing selected that is no longer there', st()['w'] == 0 and st()['sel'] is None and page.query_selector('#wtHomes') is None, st())
        ev('LRFApp.redo()'); page.wait_for_timeout(300)
        check('and redo makes them wait again', st()['w'] == 4 and st()['undo'] == 1)

        # ── at his sizes ──
        for name, w, h in [('1280', 1280, 800), ('1480', 1480, 900)]:
            page.set_viewport_size({'width': w, 'height': h}); page.wait_for_timeout(250)
            ev("LRFApp.setView('timeline'); LRFApp.openAhead({ mode: 'series', cropId: '%s' })" % radish); page.wait_for_selector('#srForm'); page.wait_for_timeout(350)
            lay = ev("""() => { const box = document.querySelector('.inspector').getBoundingClientRect(), top = document.querySelector('header.top').getBoundingClientRect(), b = document.getElementById('waitBadge').getBoundingClientRect(), nav = document.querySelector('nav.views').getBoundingClientRect();
              const inside = [...document.querySelectorAll('#srForm select, #srForm input:not([type=checkbox]), #srForm .seg, #srOut button, #srWaves li, #srTitle')].filter(e => e.getClientRects().length).every(e => { const r = e.getBoundingClientRect(); return r.left >= box.left - 0.5 && r.right <= box.right + 0.5; });
              const head = document.querySelector('.tl-waithead span'), hr = head.getBoundingClientRect(), view = document.getElementById('tlScroll').getBoundingClientRect(), wh = document.getElementById('waitHead'), lib = document.querySelector('.library').getBoundingClientRect();
              return { inside, badge: b.left >= nav.right - 0.5 && b.right <= top.right, sideways: document.documentElement.scrollWidth > innerWidth, head: hr.right <= view.right + 0.5, waitHead: [...wh.children].every(c => c.getBoundingClientRect().right <= lib.right + 0.5) && wh.scrollWidth <= wh.clientWidth + 1, title: document.getElementById('srTitle').scrollWidth <= document.getElementById('srTitle').clientWidth + 1 }; }""")
            check('at %s wide the tool, the count in the header and both "To place" headings fit, and the page does not scroll sideways' % name, lay['inside'] and lay['badge'] and not lay['sideways'] and lay['head'] and lay['waitHead'] and lay['title'], lay)
            page.screenshot(path=os.path.join(shots, 'series-%s.png' % name))
            ev("LRFApp.select(null)")
        page.set_viewport_size({'width': 1480, 'height': 900})
        undo_to(0)
        check('undone to the start, nothing waits and the plantings are as they were', st()['w'] == 0 and st()['n'] == s0['n'])
        check('no errors on the page', not errors, errors[:4])
    except Exception as error:   # a step that could not be taken: say so by name and end the run in order
        check('the check ran to its end', False, str(error)[:400])
    browser.close()
if server:
    server.shutdown()
print('\n'.join(results))
print(json.dumps({'passed': len(results) - len(failed), 'of': len(results), 'failed': failed}))
sys.exit(1 if failed else 0)
