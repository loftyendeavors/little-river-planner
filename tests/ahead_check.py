"""The Harvest view, and planning ahead in place (an opening in the details panel), in a real browser. (The series tool that
stood beside it went with 0.84: successions have a page of their own, held by successions_check.py.)

usage: python3 -I ahead_check.py <app-dir-or-offline.html> <shots-dir>

Serves the app folder (or opens the single offline file), walks them the way a grower would,
and checks what the page shows against what the engine works out in that same page.
"""
import csv, http.server, json, os, socketserver, sys, threading, functools, pathlib
from playwright.sync_api import sync_playwright

target, shots = sys.argv[1], sys.argv[2]
os.makedirs(shots, exist_ok=True)
results, failed = [], []

def check(name, ok, detail=None):
    results.append(('ok   ' if ok else 'FAIL ') + name + ('' if ok or detail is None else ' ' + json.dumps(detail, default=str)[:700]))
    if not ok:
        failed.append(name)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = None
if os.path.isdir(target):
    handler = functools.partial(Quiet, directory=target)
    server = socketserver.TCPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = 'http://127.0.0.1:%d/index.html' % server.server_address[1]
else:
    url = pathlib.Path(target).resolve().as_uri()

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = browser.new_context(viewport={'width': 1480, 'height': 900}, accept_downloads=True)
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'ERR_' not in m.text else None)
    page.goto(url)
    page.wait_for_function('window.LRFApp && LRFApp.state.ready', timeout=30000)
    page.wait_for_timeout(400)
    n0 = page.evaluate('LRFApp.state.plan.plantings.length')
    check('the plan opens', n0 > 100, n0)

    # ── Harvest ──
    page.click('[data-view-btn="harvest"]')
    page.wait_for_selector('#hvTable')
    page.evaluate("LRFApp.setDate(new Date(LRFApp.planYear(), 6, 14))")
    page.wait_for_timeout(150)
    figs = page.evaluate("Object.fromEntries([...document.querySelectorAll('[data-hook=\"fc-fig\"]')].map(e => [e.dataset.fig, e.querySelector('b').textContent]))")
    facts = page.evaluate("""() => { const F = LRFForecast, m = LRFHarvestView.model(), i = m.index(LRFApp.state.date), wk = F.periods(m, 'week', i, i)[0], g = F.glance(m, wk.i0, wk.i1), all = F.glance(m, 0, m.days - 1);
      return { crops: g.crops, worth: Math.round(m.rows.reduce((n, r) => n + F.sum(r.value, wk.i0, wk.i1), 0)), rows: m.rows.filter(r => r.total > 0).length, seasonTrays: F.shown(all.trays), seasonStems: F.shown(all.stems), week: wk.key }; }""")
    # his note of Nov 20: the season's own figures under projected revenue; the week's crops in harvest beside it
    check('the figures: crops in harvest that week, the season’s trays and stems, the harvest season', all(k in figs for k in ('season', 'week', 'ready', 'trays-season', 'stems-season', 'picking')) and figs['ready'].startswith(str(facts['crops'])) and figs['trays-season'].replace(',', '') == str(facts['seasonTrays']).replace('.0', '') and figs['stems-season'].replace(',', '') == str(facts['seasonStems']).replace('.0', ''), [figs, facts])
    check('the week’s figure is its value in dollars', figs.get('week', '').replace('$', '').replace(',', '') == str(facts['worth']), [figs.get('week'), facts['worth']])
    rows = page.eval_on_selector_all('#hvTable tbody tr.hv-row', 'els => els.length')
    groups = page.eval_on_selector_all('#hvTable tbody tr.hv-group', 'els => els.map(e => e.dataset.group)')
    check('a row for every crop with a harvest, under three headings', rows == facts['rows'] and groups == ['produce', 'micro', 'flower'], [rows, facts['rows'], groups])
    # a cell against the model
    cell = page.evaluate("""() => { const F = LRFForecast, m = LRFHarvestView.model(), row = m.rows.find(r => /Lettuce/.test(r.name)), tr = document.querySelector(`#hvTable tr.hv-row[data-crop="${row.cropId}"]`);
      const now = [...document.querySelectorAll('#hvTable thead th')].findIndex(th => th.classList.contains('now')), td = tr.children[now], i = m.index(LRFApp.state.date), wk = F.periods(m, 'week', i, i)[0];
      return { shown: td.textContent, want: F.shown(F.sum(row.days, wk.i0, wk.i1)), total: tr.querySelector('.hv-total').textContent, wantTotal: F.amount(row.total, row.unit, row.group), bg: getComputedStyle(td).backgroundColor }; }""")
    check('a cell shows what the forecast holds for that crop and week', cell['shown'].replace(',', '') == str(int(cell['want'])) and cell['total'] == cell['wantTotal'] and cell['bg'] not in ('rgba(0, 0, 0, 0)', 'transparent'), cell)
    page.screenshot(path=os.path.join(shots, 'harvest-weeks.png'))
    # grains
    page.click('[data-hv-grain="month"]')
    months = page.eval_on_selector_all('#hvTable thead th', 'els => els.length - 2')
    page.click('[data-hv-grain="day"]')
    days = page.eval_on_selector_all('#hvTable thead th', 'els => els.length - 2')
    check('months and days are other cuts of the same table', 6 <= months <= 12 and days == 28, [months, days])
    page.screenshot(path=os.path.join(shots, 'harvest-days.png'))
    page.click('[data-hv-grain="week"]')
    # kinds
    page.click('[data-hv-group="flower"]')
    only = page.eval_on_selector_all('#hvTable tbody tr.hv-group', 'els => els.map(e => e.dataset.group)')
    sumrow = page.eval_on_selector_all('#hvTable tbody tr.hv-sum', 'els => els.map(e => e.querySelector(".hv-name").textContent)')
    check('one kind can be shown alone, and stems add up', only == ['flower'] and sumrow == ['All stems'], [only, sumrow])
    page.click('[data-hv-group="all"]')
    # varieties open
    opened = page.evaluate("""() => { const b = [...document.querySelectorAll('#hvTable .hv-crop')].find(x => !x.disabled); const before = document.querySelectorAll('#hvTable tr.hv-var').length; b.click(); return [before, document.querySelectorAll('#hvTable tr.hv-var').length]; }""")
    check('a crop opens to its varieties', opened[0] == 0 and opened[1] >= 2, opened)
    # the week steps with the planning date
    page.click('#hvNext')
    wk2 = page.inner_text('#hvWeek')
    check('the week steps forward', 'Jul 19' in wk2, wk2)
    # where a figure comes from
    page.evaluate("document.querySelector('#hvTable td.hv-c:not(.zero)').click()")
    page.wait_for_selector('#hvFrom')
    src = page.eval_on_selector_all('#hvFrom ul li', 'els => els.length')
    check('a figure says which plantings it comes from', src >= 1, src)
    page.screenshot(path=os.path.join(shots, 'harvest-sources.png'))
    page.click('#hvFrom .btn.primary')
    # the list to send
    page.click('#hvShareBtn')
    page.wait_for_selector('#hvSheet')
    text1 = page.inner_text('#hvSheet')
    page.select_option('#hvShareRange', 'four')
    page.check('#hvShareVar')
    text4 = page.inner_text('#hvSheet')
    check('the list to send names the farm and the week, then four weeks with varieties', 'what is available' in text1 and text1.count('Week of') == 1 and text4.count('Week of') == 4 and len(text4) > len(text1) and '$' not in text4, [text1[:160]])
    page.check('#hvSharePrice')
    check('prices appear only when asked for', '$' in page.inner_text('#hvSheet'))
    page.click('#hvCopy')
    page.wait_for_timeout(200)
    clip = page.evaluate('navigator.clipboard.readText()')
    check('Copy puts the list on the clipboard', clip.strip() == page.inner_text('#hvSheet').strip() and len(clip) > 200, clip[:120])
    with page.expect_download() as dl:
        page.click('#hvCsv')
    with open(dl.value.path(), encoding='utf-8', newline='') as f:
        rows = list(csv.reader(f))
    weeks = page.evaluate("""() => {
        const start = LRFForecast.monday(LRFApp.state.date), E = LRFEngine;
        return Array.from({ length: 4 }, (_, i) => E.d2s(E.addDays(start, 7 * i)));
    }""")
    header = ['Kind', 'Crop', 'Variety', 'Unit'] + [c for week in weeks for c in (week, f'{week} unit price (USD)')]
    check('the spreadsheet downloads with the four reviewed weeks and their requested price columns',
          dl.value.suggested_filename.endswith('.csv') and len(rows) > 1 and rows[0] == header and all(len(r) == len(header) for r in rows),
          rows[:2])
    page.screenshot(path=os.path.join(shots, 'harvest-share.png'))
    page.click('#hvShare .dialog-actions .btn:not(.primary):not(#hvCsv):not(#hvPrint)')

    # ── successions have a page of their own (0.84, the owner's word of #102); an opening still opens in place ──
    views = page.eval_on_selector_all('[data-view-btn]', 'els => els.map(e => e.dataset.viewBtn)')
    check('eight views: Successions between the Timeline and the Forecast, and no page of its own for planning ahead', views == ['map', 'timeline', 'succession', 'harvest', 'sow', 'trays', 'seeds', 'assume'] and page.query_selector('#aheadView') is None, views)

    # ── an opening, from the timeline ──
    page.click('[data-view-btn="timeline"]')
    page.wait_for_selector('.tl-open')
    marks = page.eval_on_selector_all('.tl-open', 'els => els.length')
    whole = page.evaluate("LRFSuccession.openings(LRFApp.state.engine).filter(o => o.whole).length")
    check('the timeline draws every whole-bed opening', marks == whole and marks > 10, [marks, whole])
    page.screenshot(path=os.path.join(shots, 'timeline-openings.png'))
    # one a crop fits, so there is something to add
    clicked = page.evaluate("""() => { const S = LRFSuccession, eng = LRFApp.state.engine, ids = new Set(S.openings(eng).filter(o => o.whole && S.fits(eng, o).length).map(o => o.id));
      const el = [...document.querySelectorAll('.tl-open')].find(e => ids.has(e.dataset.opening)); el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(), s = document.getElementById('tlScroll').getBoundingClientRect();
      return { id: el.dataset.opening, x: Math.max(r.left, s.left + 150) + Math.min(10, r.width / 2), y: r.top + r.height / 2 }; }""")
    page.mouse.click(clicked['x'], clicked['y'])
    page.wait_for_selector('#ahFits')
    shown = page.evaluate("""() => { const S = LRFSuccession, eng = LRFApp.state.engine, sel = LRFApp.state.sel, o = S.openings(eng, { bedId: sel.bedId }).find(x => x.id === sel.id);
      return { view: LRFApp.state.view, sel, title: document.querySelector('#ahTitle').textContent, expect: LRFUI.span(o.from, o.to), days: document.querySelector('#ahFigures .stat b').textContent, daysExpect: String(o.days),
        chips: document.querySelectorAll('#ahFits .ah-fit').length, more: document.querySelector('#ahMore') ? +document.querySelector('#ahMore').textContent.match(/\\d+/)[0] : 0, fits: S.fits(eng, o).length, marked: document.querySelectorAll('.tl-open.sel').length, markedId: (document.querySelector('.tl-open.sel') || { dataset: {} }).dataset.opening }; }""")
    check('clicking an opening shows it in the details panel, without leaving the timeline', shown['view'] == 'timeline' and shown['sel']['type'] == 'opening' and shown['sel']['id'] == clicked['id'] and shown['title'] == shown['expect'] and shown['days'] == shown['daysExpect'], shown)
    check('the panel lists the crops that fit it, and the opening is marked on the timeline', shown['fits'] >= 1 and shown['chips'] + shown['more'] == shown['fits'] and shown['marked'] == 1 and shown['markedId'] == clicked['id'], shown)
    page.screenshot(path=os.path.join(shots, 'opening-panel.png'))
    # pick a crop
    first = page.evaluate("""() => { const chip = document.querySelector('#ahFits .ah-fit'); chip.click(); return { opening: LRFApp.state.sel.id, crop: chip.dataset.crop }; }""")
    page.wait_for_selector('#ahSched')
    sched = page.inner_text('#ahSched')
    check('picking a crop shows its schedule in that opening', 'Harvest' in sched and 'Ground free again' in sched and 'to spare' in sched.lower(), sched)
    # a day outside the opening is refused in words, and cannot be added
    page.evaluate("""() => { const d = document.querySelector('#ahDate'), E = LRFEngine; d.value = E.d2s(E.addDays(E.s2d(d.min), -1)); d.dispatchEvent(new Event('change')); }""")
    page.wait_for_timeout(100)
    why = page.inner_text('#ahWhy') if page.query_selector('#ahWhy') else ''
    check('a day before the ground is free is refused, in words, and Add is off', len(why) > 10 and page.is_disabled('#ahAdd'), why)
    page.evaluate("""() => { const d = document.querySelector('#ahDate'); d.value = ''; d.dispatchEvent(new Event('change')); }""")
    page.wait_for_selector('#ahSched')
    half = page.evaluate("Math.max(1, Math.floor(+document.querySelector('#ahFt').max / 2))")
    page.fill('#ahFt', str(half)); page.dispatch_event('#ahFt', 'change')
    page.wait_for_selector('#ahSched')
    page.screenshot(path=os.path.join(shots, 'opening-review.png'))
    fit_panel = page.evaluate("(() => { const p = document.getElementById('inspectorBody'); return { wide: p.scrollWidth > p.clientWidth + 1, clipped: [...p.querySelectorAll('.ah-fit, #ahSched li, .ah-around li, .stat')].filter(e => e.scrollWidth > e.clientWidth + 1).length }; })()")
    check('nothing in the opening’s panel is wider than the panel', not fit_panel['wide'] and fit_panel['clipped'] == 0, fit_panel)
    page.click('#ahAdd')
    page.wait_for_timeout(250)
    added = page.evaluate("""() => { const P = LRFApp.state.plan.plantings, p = P[P.length - 1], eng = LRFApp.state.engine, r = eng.calc(p); return { n: P.length, crop: p.cropId, ft: p.ft, clash: eng.conflicts(p, r).length, bed: p.bedId, id: p.id, sel: LRFApp.state.sel, view: LRFApp.state.view, bar: !!document.querySelector('.tl-bar.sel[data-planting="' + p.id + '"]') }; }""")
    check('Add puts one planting in the plan, half the opening long, clear of everything', added['n'] == n0 + 1 and added['crop'] == first['crop'] and added['ft'] == half and added['clash'] == 0 and first['opening'].startswith(added['bed']), [added, half])
    check('and the new planting is the one selected, on the timeline', added['sel']['type'] == 'planting' and added['sel']['id'] == added['id'] and added['view'] == 'timeline' and added['bar'], added)
    page.evaluate('LRFApp.undo()')
    check('and one undo takes it out again', page.evaluate('LRFApp.state.plan.plantings.length') == n0)
    # crops not grown yet are offered only when asked for
    page.mouse.click(clicked['x'], clicked['y'])
    page.wait_for_selector('#ahFits')
    mine = page.evaluate("document.querySelectorAll('#ahFits .ah-fit').length + (document.querySelector('#ahMore') ? +document.querySelector('#ahMore').textContent.match(/\\d+/)[0] : 0)")
    page.check('#ahMine')
    page.wait_for_timeout(150)
    every = page.evaluate("""() => { const S = LRFSuccession, eng = LRFApp.state.engine, sel = LRFApp.state.sel, o = S.openings(eng, { bedId: sel.bedId }).find(x => x.id === sel.id);
      return { shown: document.querySelectorAll('#ahFits .ah-fit').length + (document.querySelector('#ahMore') ? +document.querySelector('#ahMore').textContent.match(/\\d+/)[0] : 0), all: S.fits(eng, o, { mine: false }).length }; }""")
    check('crops not grown yet are offered when asked for', every['shown'] == every['all'] and every['all'] >= mine, [mine, every])
    page.uncheck('#ahMine')
    # an opening that is no longer there gives way to its bed
    gone = page.evaluate("""() => { const sel = LRFApp.state.sel; LRFApp.select({ type: 'opening', id: sel.id + '-gone', bedId: sel.bedId }); return { dims: !!document.querySelector('#bedDims'), title: !!document.querySelector('#ahTitle') }; }""")
    check('an opening that has gone shows its bed instead', gone['dims'] and not gone['title'], gone)
    page.keyboard.press('Escape')
    page.click('#tlOpenToggle')
    check('the openings can be hidden on the timeline', page.eval_on_selector_all('.tl-open', 'els => els.length') == 0 and page.get_attribute('#tlOpenToggle', 'aria-pressed') == 'false')
    page.click('#tlOpenToggle')
    # ── and from a bed's panel, on the map ──
    page.click('[data-view-btn="map"]')
    page.evaluate("LRFApp.select({ type: 'bed', id: LRFSuccession.openings(LRFApp.state.engine)[0].bed.id })")
    page.wait_for_selector('#bedOpenings .p-open')
    check('a bed’s panel lists its openings', page.eval_on_selector_all('#bedOpenings .p-open', 'els => els.length') >= 1)
    want = page.evaluate("document.querySelector('#bedOpenings .p-open').dataset.opening")
    page.click('#bedOpenings .p-open')
    page.wait_for_selector('#ahFits')
    on_map = page.evaluate("({ view: LRFApp.state.view, sel: LRFApp.state.sel, bedMarked: !!document.querySelector('#mapBeds .sel, #mapBeds [class*=\"sel\"]') })")
    check('clicking one shows that opening in the panel, still on the map, with its bed marked', on_map['view'] == 'map' and on_map['sel']['type'] == 'opening' and on_map['sel']['id'] == want and on_map['bedMarked'], on_map)
    page.click('#ahToBed')
    page.wait_for_selector('#bedOpenings')
    check('and a link goes back to the whole bed', page.evaluate("LRFApp.state.sel.type") == 'bed')

    # ── the frost rule (#100): a frost date never stops a planting; it is placed, and marked quietly ──
    def soft(sel):   # a fault fails a named line below, rather than stopping the check here
        try: page.wait_for_selector(sel, timeout=5000)
        except Exception: pass
    # (a) an opening where the first frost cuts a crop's harvest: found by the planner's own test on the plan in hand, Basil first where it is one
    fsub = page.evaluate("""() => { const S = LRFSuccession, eng = LRFApp.state.engine; let best = null;
      for (const o of S.openings(eng, { empty: true })) { const f = S.fits(eng, o), t = f.find(t => t.frost && t.r.frostCut); if (!t) continue; if (!best || t.crop.name === 'Basil') best = { id: o.id, bedId: o.bed.id, crop: t.crop.id, name: t.crop.name, note: t.frost, picked: t.r.harvestDays, of: t.r.frostCut.plannedDays, n: f.length, whole: f.filter(x => !x.frost).length }; if (best.name === 'Basil') break; }
      return best; }""")
    check('a subject: an opening on this plan where the first frost cuts the harvest of a crop that fits it otherwise', bool(fsub), fsub)
    fsub = fsub or {}
    page.evaluate("s => { LRFAhead.state.O.mine = true; LRFApp.select({ type: 'opening', id: s.id, bedId: s.bedId }); }", fsub)
    soft('#ahFits')
    if page.query_selector('#ahMore'): page.click('#ahMore'); page.wait_for_timeout(120)
    chips = page.evaluate("""s => { const all = [...document.querySelectorAll('#ahFits .ah-fit')], el = document.querySelector(`[data-hook="fit-frost"][data-crop="${s.crop}"]`), mark = el && el.querySelector('[data-hook="fit-frost-mark"]');
      return { n: all.length, frostAt: all.map((e, i) => e.dataset.hook === 'fit-frost' ? i : -1).filter(i => i >= 0), whole: all.filter(e => e.dataset.hook !== 'fit-frost').length, there: !!el, mark: mark ? mark.textContent : '', title: el ? el.title : '', note: LRFUI.plainDays(s.note) }; }""", fsub)
    check('(a) the crop is a chip in the opening, marked quietly with what the frost leaves, its note in the title', chips['there'] and chips['mark'] == 'frost: %s of %s days' % (fsub.get('picked'), fsub.get('of')) and chips['note'] in chips['title'] and chips['n'] == fsub.get('n'), chips)
    check('(a) crops the frost cuts come after every crop that fits whole', len(chips['frostAt']) >= 1 and chips['whole'] == fsub.get('whole') and min(chips['frostAt'] or [0]) == chips['whole'], chips)
    page.evaluate("s => { const c = document.querySelector(`[data-hook=\"fit-frost\"][data-crop=\"${s.crop}\"]`); if (c) c.click(); }", fsub)
    soft('#ahSched')
    rev = page.evaluate("""s => { const line = document.querySelector('[data-hook="opening-frost"]'), add = document.getElementById('ahAdd'); return { line: line ? line.textContent : '', after: !!(line && line.previousElementSibling && line.previousElementSibling.id === 'ahSched'), add: !!add && !add.disabled, note: LRFUI.plainDays(s.note) }; }""", fsub)
    check('(a) picked, it shows its schedule with the frost note as one line under it, and Add planting is on', rev['line'] == rev['note'] and rev['after'] and rev['add'], rev)
    page.screenshot(path=os.path.join(shots, 'frost-chip.png'))
    n1 = page.evaluate('LRFApp.state.plan.plantings.length')
    page.evaluate("(document.getElementById('ahAdd') || { click() {} }).click()"); page.wait_for_timeout(250)
    put = page.evaluate("""s => { const P = LRFApp.state.plan.plantings, p = P[P.length - 1], eng = LRFApp.state.engine, w = eng.warnings(p).find(x => x.k === 'frost'); return { n: P.length, crop: p.cropId, bed: p.bedId, note: w ? w.t : null, clash: eng.conflicts(p, eng.calc(p)).length }; }""", fsub)
    check('(a) Add planting adds it, clear of everything, and the planting carries the engine’s own frost note', put['n'] == n1 + 1 and put['crop'] == fsub.get('crop') and put['bed'] == fsub.get('bedId') and put['note'] == fsub.get('note') and put['clash'] == 0, [put, fsub.get('note')])
    if put['n'] == n1 + 1: page.evaluate('LRFApp.undo()'); page.wait_for_timeout(150)
    # typed: a day on which the frost leaves nothing to pick is allowed, and said outright
    zsub = page.evaluate("""() => { const S = LRFSuccession, eng = LRFApp.state.engine, E = LRFEngine;
      for (const o of S.openings(eng, { empty: true })) for (const t of S.fits(eng, o).filter(t => t.frost)) for (let d = E.addDays(t.r.field, 1); d <= o.to; d = E.addDays(d, 1)) { const u = S.tryCrop(eng, o, t.crop, { date: E.d2s(d) }); if (u.ok && u.r.frostCut && !(u.r.harvestDays > 0)) return { id: o.id, bedId: o.bed.id, crop: t.crop.id, date: E.d2s(d), note: u.frost }; }
      return null; }""")
    check('a subject: a crop offered for an opening that, on a later day typed, the frost leaves nothing to pick', bool(zsub), zsub)
    zsub = zsub or {}
    page.evaluate("s => { LRFApp.select({ type: 'opening', id: s.id, bedId: s.bedId }); }", zsub); soft('#ahFits')
    if page.query_selector('#ahMore'): page.click('#ahMore'); page.wait_for_timeout(120)
    page.evaluate("s => { const c = document.querySelector(`#ahFits .ah-fit[data-crop=\"${s.crop}\"]`); if (c) c.click(); }", zsub); soft('#ahDate')
    page.evaluate("""s => { const d = document.querySelector('#ahDate'); if (d) { d.value = s.date; d.dispatchEvent(new Event('change')); } }""", zsub); page.wait_for_timeout(150)
    zr = page.evaluate("""s => { const line = document.querySelector('[data-hook="opening-frost"]'), add = document.getElementById('ahAdd'); return { line: line ? line.textContent : '', add: !!add && !add.disabled, note: LRFUI.plainDays(s.note) }; }""", zsub)
    check('(a) typed, a day the frost leaves nothing to pick is allowed, and the line says nothing is picked', zr['line'] == zr['note'] and 'nothing is picked' in zr['line'] and zr['add'], zr)
    # (b) a day typed before the last-frost planning date: on this farm warm-season planting starts after the last frost, so the
    # last frost is first set two weeks past that start (the Farm dates' own step), then undone
    set0 = page.evaluate("JSON.stringify(LRFApp.state.plan.settings)")
    bsub = page.evaluate("""() => { const A = LRFApp, S = LRFSuccession, E = LRFEngine, FD = LRFFarmDates; let eng = A.state.engine;
      const c0 = eng.crops().find(c => c.frostTender && eng.fieldSeasonFor(c) === 'warm'), bed0 = A.state.plan.beds.find(b => (eng.gardenOf(b) || {}).type === 'field'), year = A.planYear(), start = c0 && bed0 && eng.firstFieldDate(c0, bed0, year, {}, false);
      if (!start || !A.setFarmDates({ ...FD.read(eng).dates, frostLast: E.d2s(E.addDays(start, 14)).slice(5) })) return null; eng = A.state.engine;
      for (const o of S.openings(eng, { empty: true })) for (const t of S.fits(eng, o, { mine: false })) { if (!t.crop.frostTender) continue; const bare = eng.firstFieldDate(t.crop, o.bed, year, {}, false), d = bare && bare > o.from ? bare : o.from;
        if (d >= t.r.field) continue; const u = S.tryCrop(eng, o, t.crop, { date: E.d2s(d) }); if (u.ok && /last-frost planning date/.test(u.frost || '')) return { id: o.id, bedId: o.bed.id, crop: t.crop.id, date: E.d2s(d), note: u.frost, firstDay: E.d2s(t.r.field) }; }
      return { none: true }; }""")
    check('(b) a subject: with the last frost after warm-season planting starts, an opening where a frost-tender crop can be typed in before the last frost', bool(bsub) and not bsub.get('none'), bsub)
    bsub = bsub or {}
    page.evaluate("s => { LRFAhead.state.O.mine = false; LRFApp.select({ type: 'opening', id: s.id, bedId: s.bedId }); }", bsub); soft('#ahFits')
    if page.query_selector('#ahMore'): page.click('#ahMore'); page.wait_for_timeout(120)
    page.evaluate("s => { const c = document.querySelector(`#ahFits .ah-fit[data-crop=\"${s.crop}\"]`); if (c) c.click(); }", bsub); page.wait_for_timeout(120)
    pre = page.evaluate("() => (document.querySelector('#ahDate') || {}).value || ''")
    page.evaluate("""s => { const d = document.querySelector('#ahDate'); if (d) { d.value = s.date; d.dispatchEvent(new Event('change')); } }""", bsub); page.wait_for_timeout(150)
    br = page.evaluate("""s => { const line = document.querySelector('[data-hook="opening-frost"]'), add = document.getElementById('ahAdd'); return { line: line ? line.textContent : '', add: !!add && !add.disabled, note: LRFUI.plainDays(s.note) }; }""", bsub)
    check('(b) the crop offers its own first day after the last frost; a day typed before it is allowed, with the frost note under the schedule', pre == bsub.get('firstDay') and br['line'] == br['note'] and br['add'], [pre, br, bsub.get('firstDay')])
    page.screenshot(path=os.path.join(shots, 'frost-typed-spring.png'))
    nb = page.evaluate('LRFApp.state.plan.plantings.length')
    page.evaluate("(document.getElementById('ahAdd') || { click() {} }).click()"); page.wait_for_timeout(250)
    bput = page.evaluate("""s => { const P = LRFApp.state.plan.plantings, p = P[P.length - 1], w = LRFApp.state.engine.warnings(p).find(x => x.k === 'frost'); return { n: P.length, date: p.date, note: w ? w.t : null }; }""", bsub)
    check('(b) and it adds on the day typed, carrying the engine’s frost note', bput['n'] == nb + 1 and bput['date'] == bsub.get('date') and bput['note'] == bsub.get('note'), bput)
    if bput['n'] == nb + 1: page.evaluate('LRFApp.undo()'); page.wait_for_timeout(150)
    if page.evaluate("JSON.stringify(LRFApp.state.plan.settings)") != set0: page.evaluate('LRFApp.undo()'); page.wait_for_timeout(250)
    page.evaluate("LRFAhead.state.O.mine = true")
    check('two undos take the planting and the last frost back', page.evaluate('LRFApp.state.plan.plantings.length') == n0 and page.evaluate("JSON.stringify(LRFApp.state.plan.settings)") == set0, page.evaluate("LRFApp.state.plan.settings.frostLast"))
    # (c) a run of successions into the fall is held by successions_check.py (0.84: the series tool these lines held went with it).
    # A planting waiting to be placed that the frost touches: made to wait as the series tool made them, for a frost-tender crop
    csub = page.evaluate("""() => { const S = LRFSuccession, eng = LRFApp.state.engine, year = LRFApp.planYear(); for (const c of S.candidates(eng, true).filter(c => c.frostTender)) for (const g of S.gardensFor(eng, c).filter(g => g.kind === 'bed' && g.garden.type === 'field')) {
        const r = S.planRun(eng, { cropId: c.id, gardenIds: [g.garden.id], by: 'beds', datesFor: 'planting', from: year + '-07-20', to: year + '-09-10', every: 10 }); if (!r.error && r.totals.frost >= 2 && r.sowings.length >= 3) return { crop: c.id, garden: g.garden.id, frost: r.totals.frost, n: r.sowings.length }; } return null; }""")
    check('(c) a subject: a frost-tender crop that a frost date touches when sown from late July', bool(csub), csub)
    csub = csub or {}
    page.evaluate("""s => { const A = LRFApp, y = A.planYear(), list = [0, 1, 2, 3, 4, 5].map(k => ({ id: 'frost-wait-' + (k + 1), cropId: s.crop, date: LRFEngine.d2s(LRFEngine.addDays(new Date(y, 6, 20), k * 10)), wait: { s: 'frost-series', k: k + 1, of: 6, every: 10, gardens: [s.garden] } }));
      A.commit('Series to place: 6 plantings', [{ kind: 'own', key: 'waiting', before: (A.state.plan.lrfNext || {}).waiting || null, after: list }]); }""", csub); page.wait_for_timeout(400)
    wsub = page.evaluate("""() => { const S = LRFSuccession, eng = LRFApp.state.engine, list = LRFApp.waiting().map(w => ({ w, h: S.homes(eng, w) })).filter(x => x.h.slice(0, 8).some(h => h.frost)); const x = list[list.length - 1]; return x ? { id: x.w.id, marked: x.h.slice(0, 8).filter(h => h.frost).length, notes: x.h.slice(0, 8).filter(h => h.frost).map(h => LRFUI.plainDays(h.frost)) } : null; }""")
    if wsub: page.evaluate("id => LRFApp.select({ type: 'waiting', id })", wsub['id']); page.wait_for_timeout(200)
    wr = page.evaluate("() => [...document.querySelectorAll('#wtHomes [data-hook=\"home-frost\"]')].map(e => e.title)")
    check('a waiting planting the frost touches is offered those beds, each marked “frost” with its note', bool(wsub) and len(wr) == wsub['marked'] and wr == wsub['notes'], [wsub, wr])
    if page.evaluate('LRFApp.waiting().length'): page.evaluate('LRFApp.undo()'); page.wait_for_timeout(200)
    check('and the plan is back as it was', page.evaluate('LRFApp.state.plan.plantings.length') == n0 and page.evaluate('LRFApp.waiting().length') == 0)
    page.evaluate("LRFApp.select(null)"); page.wait_for_timeout(100)

    # narrower and dark
    for (w, hgt, scheme, name) in [(1280, 720, 'light', '1280'), (1480, 900, 'dark', 'dark')]:
        page.set_viewport_size({'width': w, 'height': hgt}); page.emulate_media(color_scheme=scheme)
        page.click('[data-view-btn="harvest"]'); page.wait_for_timeout(200)
        page.screenshot(path=os.path.join(shots, 'harvest-%s.png' % name))
        page.click('[data-view-btn="timeline"]'); page.wait_for_timeout(250)
        page.evaluate("""() => { const S = LRFSuccession, eng = LRFApp.state.engine, o = S.openings(eng).find(o => o.whole && S.fits(eng, o).length); LRFApp.select({ type: 'opening', id: o.id, bedId: o.bed.id }); document.querySelector('#ahFits .ah-fit').click(); }""")
        page.wait_for_timeout(200)
        page.screenshot(path=os.path.join(shots, 'opening-%s.png' % name))
        wide = page.evaluate("(() => { const p = document.getElementById('inspectorBody'); return p.scrollWidth > p.clientWidth + 1; })()")
        check('the opening’s panel fits at %s' % name, not wide)
        page.evaluate("LRFApp.select(null)")
        overflow = page.evaluate("document.querySelector('.top').scrollWidth > document.querySelector('.top').clientWidth + 1")
        check('the header fits at %s' % name, not overflow)
    check('no script errors', not errors, errors[:4])
    browser.close()
if server:
    server.shutdown()
print('\n'.join(results))
print(json.dumps({'passed': len(results) - len(failed), 'of': len(results), 'failed': failed}))
sys.exit(1 if failed else 0)
