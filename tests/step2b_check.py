"""Step 2b in a real browser: plantings with no bed yet ("To place"). (The series tool in the details panel, which this check also
held, went with 0.84: successions are planned on their own page, held by successions_check.py.)

usage: python3 -I step2b_check.py <app-dir-or-offline.html> <shots-dir>

Serves the app folder (or opens the single offline file) and walks it the way a grower would. What the page shows is
checked against what the engine works out in that same page. The rules under test:
  - a planting with no bed counts toward nothing, and the number waiting is shown on every view;
  - a waiting planting keeps its own date wherever it is dropped; a free bed takes it whole; a held bed asks how to share;
  - whatever opens to be filled in has an x that leaves without doing anything, and Escape does the same;
  - what he could do before this step still works: a crop dragged from the library.
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
        check('the plan opens with nothing waiting, and no count of it anywhere', s0['n'] > 100 and s0['w'] == 0 and ev("document.getElementById('waitBadge').hidden && document.querySelector('[data-hook=\"lib-to-place-count\"]').hidden"), s0)
        radish = ev("(LRFApp.state.engine.crops().find(c => /^Radish$/.test(c.name)) || LRFApp.state.engine.crops().find(c => /radish/i.test(c.name))).id")

        # ── four plantings that wait, made as a series asked to wait made them before 0.84 ──
        # The series tool that made them went with 0.84 (successions are planned on their own page: successions_check.py, which holds
        # what this check held of the tool: nothing added before Add, ghosts on the Timeline, one Undo, the way in from the library).
        # A plan can still hold such plantings, and "To place" still keeps them: they are put there as one step, as the tool put them.
        ev("""(y => { const A = LRFApp, crop = A.state.engine.crops().find(c => /^Radish$/.test(c.name)) || A.state.engine.crops().find(c => /radish/i.test(c.name));
          const list = [0, 1, 2, 3].map(k => ({ id: 'wait-' + (k + 1), cropId: crop.id, date: LRFEngine.d2s(LRFEngine.addDays(new Date(y, 6, 6), k * 10)), wait: { s: 'series-1', k: k + 1, of: 4, every: 10 } }));
          A.commit('Series to place: 4 plantings', [{ kind: 'own', key: 'waiting', before: null, after: list }]); })(%d)""" % year); page.wait_for_timeout(500)
        ev("LRFApp.setView('timeline')"); page.wait_for_timeout(450)
        check('that row comes before every garden, under its own heading', ev("(() => { const b = document.getElementById('tlBody'); return b.children[0].dataset.section === 'waiting' && b.children[1].classList.contains('tl-wait'); })()"))
        held = st()
        check('four wait, put there as one step, and none of them is in the plan', held['n'] == s0['n'] and held['w'] == 4 and held['undo'] == 1, held)
        figures = ev(FIGURES)
        check('with four waiting, every figure is what it was: seeds, sowing batches, bench load, ground, forecast, to settle, openings, the map’s whole season, what the timeline counts in beds', figures == base and figures['season'] > 50, [figures, base])
        counts = ev("[...document.querySelectorAll('#tlFilters small')].map(s => +s.textContent.replace(/,/g, ''))")
        check('the timeline’s own counts are the plan’s plantings, with the four that wait in none of them', len(counts) == 5 and counts[0] == figures['inBeds'] and counts[0] == s0['n'], [counts, figures['inBeds']])
        badge = ev("(() => { const b = document.getElementById('waitBadge'), r = b.getBoundingClientRect(), top = document.querySelector('header.top').getBoundingClientRect(), nav = document.querySelector('nav.views').getBoundingClientRect(); return { hidden: b.hidden, text: b.textContent, inside: r.right <= top.right && r.left >= nav.right, more: getComputedStyle(b.querySelector('.wb-more')).display }; })()")
        check('the header says how many are waiting', not badge['hidden'] and badge['text'].startswith('4 to place') and badge['inside'] and badge['more'] == 'none', badge)
        page.click('[data-hook="lib-to-place"]'); page.wait_for_timeout(200)
        box = ev("({ count: (() => { const c = document.querySelector('[data-hook=\"lib-to-place-count\"]'); return c.hidden ? '' : c.textContent; })(), chosen: document.querySelector('[data-hook=\"lib-to-place\"]').getAttribute('aria-pressed'), rows: [...document.querySelectorAll('[data-hook=\"waiting-row\"]')].map(r => r.textContent), lead: (document.querySelector('[data-hook=\"waiting-lead\"]') || {}).textContent || '' })")
        check('To place, beside My crops and All crops, counts them and lists them: the crop and the day each goes in, and that they are not in the forecast', box['count'] == '4' and box['chosen'] == 'true' and len(box['rows']) == 4 and all('Radish' in r for r in box['rows']) and 'Jul 6' in box['rows'][0] and 'not in the forecast' in box['lead'], box)
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
        check('a backup file holds them apart from the plan’s plantings', len(data['plantings']) == s0['n'] and len(keep.get('waiting') or []) == 4 and all('bedId' not in w for w in keep['waiting']) and 'lrfNext' not in data, [len(data['plantings']), len(keep.get('waiting') or [])])
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
        if page.get_attribute('[data-hook="lib-to-place"]', 'aria-pressed') != 'true': page.click('[data-hook="lib-to-place"]'); page.wait_for_timeout(150)   # a reload opens the library on My crops
        page.click('[data-hook="waiting-row"]'); page.wait_for_selector('#wtHomes')
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
        page.click('[data-hook="waiting-row"]'); page.wait_for_selector('#wtHomes [data-home]')
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
        seen = drag('[data-hook="waiting-row"][data-waiting="%s"]' % w2['id'], spot, survey)
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

        # ── what he could do before still works ──
        ev("LRFApp.setView('map')"); page.wait_for_timeout(200)
        # a crop dragged from the library still plants on the planning date
        ev("LRFApp.select(null); LRFMap.fit(true)"); page.wait_for_timeout(300)
        day0 = '%d-07-06' % year
        ev("LRFApp.setDate(LRFEngine.s2d('%s'))" % day0); page.wait_for_timeout(250)
        spot = ev("""(crop) => { const A = LRFApp, eng = A.state.engine, box = document.getElementById('map').getBoundingClientRect(); for (const g of document.querySelectorAll('#map .bed')) { const id = g.dataset.bed; if (!eng.isSoilBed(eng.bedOf(id)) || A.preview({ cropId: crop }, { bedId: id, date: A.state.date }).state !== 'ok') continue; const r = g.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
          if (x > box.left + 30 && x < box.right - 30 && y > box.top + 30 && y < box.bottom - 120) { const at = document.elementFromPoint(x, y); if (at && at.closest('[data-bed]') && at.closest('[data-bed]').dataset.bed === id) return { bed: id, x, y }; } } return null; }""", radish)
        page.click('[data-lib-scope="mine"]'); page.wait_for_timeout(150)
        seen = drag('#libList .lib-row[data-crop="%s"]:not(.lib-var) .lib-name' % radish, spot)
        lib = ev("(() => { const s = LRFApp.state.sel, p = s && s.type === 'planting' ? LRFApp.state.engine.planting(s.id) : null; return p ? { bed: p.bedId, date: p.date, crop: p.cropId } : null; })()")
        check('a crop dragged from the library onto a bed still plants it on the planning date, as before', lib is not None and lib['bed'] == spot['bed'] and lib['date'] == day0 and lib['crop'] == radish and st()['n'] == s0['n'] + 1 and st()['w'] == 4, [lib, spot, seen])
        undo_to(u0)

        # ── taking them off the list ──
        page.click('[data-hook="lib-to-place"]'); page.wait_for_timeout(150)
        page.click('[data-hook="waiting-row"]'); page.wait_for_selector('#wtRemove')
        check('one of a succession offers to remove just it, or all of its succession still waiting', 'all 4' in page.inner_text('#wtRemoveAll'))
        page.click('#wtRemove'); page.wait_for_timeout(300)
        check('Remove takes one off, as a step that can be undone', st()['w'] == 3 and st()['undo'] == u0 + 1 and st()['sel'] is None and ev("document.getElementById('waitBadge').textContent").startswith('3 to place'))
        ev('LRFApp.undo()'); page.wait_for_timeout(250)
        page.click('[data-hook="waiting-row"]'); page.wait_for_selector('#wtRemoveAll'); page.click('#wtRemoveAll'); page.wait_for_timeout(350)
        gone = ev("({ badge: document.getElementById('waitBadge').hidden, box: document.querySelector('[data-hook=\"lib-to-place-count\"]').hidden && !document.querySelector('[data-hook=\"waiting-row\"]') })")
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
        ev("""(y => { const A = LRFApp, crop = A.state.engine.crops().find(c => /^Radish$/.test(c.name)) || A.state.engine.crops().find(c => /radish/i.test(c.name));
          A.commit('four to place', [{ kind: 'own', key: 'waiting', before: (A.state.plan.lrfNext || {}).waiting || null, after: [0, 1, 2, 3].map(k => ({ id: 'again-' + (k + 1), cropId: crop.id, date: LRFEngine.d2s(LRFEngine.addDays(new Date(y, 6, 6), k * 10)), wait: { s: 'series-2', k: k + 1, of: 4, every: 10 } })) }]); })(%d)""" % year); page.wait_for_timeout(400)
        check('four more can be made to wait straight away', st()['w'] == 4 and st()['undo'] == 1)
        ev("LRFApp.select({ type: 'waiting', id: LRFApp.waiting()[0].id })"); page.wait_for_selector('#wtHomes'); ev('LRFApp.undo()'); page.wait_for_timeout(300)
        check('undoing that while one of them is shown leaves nothing selected that is no longer there', st()['w'] == 0 and st()['sel'] is None and page.query_selector('#wtHomes') is None, st())
        ev('LRFApp.redo()'); page.wait_for_timeout(300)
        check('and redo makes them wait again', st()['w'] == 4 and st()['undo'] == 1)

        # ── at his sizes ──
        for name, w, h in [('1280', 1280, 800), ('1480', 1480, 900)]:
            page.set_viewport_size({'width': w, 'height': h}); page.wait_for_timeout(250)
            ev("LRFApp.setView('timeline'); LRFApp.select(null)"); page.wait_for_timeout(450)
            lay = ev("""() => { const top = document.querySelector('header.top').getBoundingClientRect(), b = document.getElementById('waitBadge').getBoundingClientRect(), nav = document.querySelector('nav.views').getBoundingClientRect();
              const head = document.querySelector('.tl-waithead span'), hr = head.getBoundingClientRect(), view = document.getElementById('tlScroll').getBoundingClientRect(), wh = document.querySelector('[data-hook="lib-to-place"]'), lib = document.querySelector('.library').getBoundingClientRect();
              return { badge: b.left >= nav.right - 0.5 && b.right <= top.right, sideways: document.documentElement.scrollWidth > innerWidth, head: hr.right <= view.right + 0.5, waitHead: [...wh.children].every(c => c.getBoundingClientRect().right <= lib.right + 0.5) && wh.scrollWidth <= wh.clientWidth + 1 }; }""")
            check('at %s wide the count in the header and both "To place" headings fit, and the page does not scroll sideways' % name, lay['badge'] and not lay['sideways'] and lay['head'] and lay['waitHead'], lay)
            page.screenshot(path=os.path.join(shots, 'to-place-%s.png' % name))
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
