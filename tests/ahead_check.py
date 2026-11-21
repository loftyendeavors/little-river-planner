"""The Harvest view, and planning ahead in place (an opening and the series tool, both in the details panel), in a real browser.

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

    # ── there is no Successions page: planning ahead opens in place ──
    views = page.eval_on_selector_all('[data-view-btn]', 'els => els.map(e => e.dataset.viewBtn)')
    check('seven views, and none of them is a Successions page', views == ['map', 'timeline', 'harvest', 'sow', 'trays', 'seeds', 'assume'] and page.query_selector('#aheadView') is None, views)

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
    # (c) a series a frost date used to hold back: placed, and its summary says how many cross a frost date
    csub = page.evaluate("""() => { const S = LRFSuccession, eng = LRFApp.state.engine, year = LRFApp.planYear(); for (const c of S.candidates(eng, true).filter(c => c.frostTender)) for (const g of S.gardensFor(eng, c).filter(g => g.kind === 'bed' && g.garden.type === 'field')) {
        const r = S.series(eng, { cropId: c.id, gardenIds: [g.garden.id], place: 'gardens', basis: 'planting', from: year + '-07-20', every: 10, count: 6, unit: 'whole', amount: 1 }); if (!r.error && r.frost >= 2 && r.plantings.length >= 3) return { crop: c.id, garden: g.garden.id, frost: r.frost, n: r.plantings.length }; } return null; }""")
    check('(c) a subject: a series of a frost-tender crop into the fall in which the frost touches some plantings', bool(csub), csub)
    csub = csub or {}
    page.evaluate("LRFApp.select(null)"); page.evaluate("s => LRFApp.openAhead({ mode: 'series', cropId: s.crop, gardenId: s.garden })", csub); soft('#srForm')
    def setc(sel, value):
        page.evaluate("""([sel, value]) => { const el = document.querySelector(sel); if (el) { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); } }""", [sel, value]); page.wait_for_timeout(120)
    for _ in range(40):
        if not page.evaluate("""g => { const box = [...document.querySelectorAll('#srGardens input')].find(b => b.checked !== (b.value === g)); if (box) box.click(); return !!box; }""", csub.get('garden')): break
        page.wait_for_timeout(60)
    year_c = page.evaluate('LRFApp.planYear()')
    setc('#srFrom', '%d-07-20' % year_c); setc('#srEvery', '10'); setc('#srCount', '6'); setc('#srAmount', '1')
    soft('#srSum')
    cr = page.evaluate("""s => { const el = document.querySelector('#srSum [data-hook="series-frost"]'), g = LRFSeries.ghosts(); return { said: el ? el.textContent.trim() : '', placed: g.placed.length, marked: g.placed.filter(x => x.frost).length }; }""", csub)
    check('(c) the series places the plantings the frost touches and says how many in its summary', cr['said'] == '%s of %s cross a frost date.' % (csub.get('frost'), csub.get('n')) and cr['placed'] == csub.get('n'), [cr, csub])
    page.screenshot(path=os.path.join(shots, 'frost-series.png'))
    nc = page.evaluate('LRFApp.state.plan.plantings.length')
    page.evaluate("(document.getElementById('srAdd') || { click() {} }).click()"); page.wait_for_timeout(400)
    cput = page.evaluate("""n => { const eng = LRFApp.state.engine, fresh = LRFApp.state.plan.plantings.slice(n); return { n: fresh.length, frost: fresh.filter(p => eng.warnings(p).some(x => x.k === 'frost') || eng.fieldFrostOnly(p)).length }; }""", nc)
    check('(c) added, they are in the plan, as many carrying a frost note as the summary said', cput['n'] == csub.get('n') and cput['frost'] == csub.get('frost'), [cput, csub])
    if cput['n'] > 0: page.evaluate('LRFApp.undo()'); page.wait_for_timeout(200)
    # a series whose only planting the frost leaves nothing to pick: no harvest is said, and that nothing is picked is
    nsub = page.evaluate("""() => { const S = LRFSuccession, eng = LRFApp.state.engine, E = LRFEngine, year = LRFApp.planYear(); for (const c of S.candidates(eng, true).filter(c => c.frostTender)) for (const g of S.gardensFor(eng, c).filter(g => g.kind === 'bed' && g.garden.type === 'field'))
        for (let d = new Date(year, 7, 15); d < new Date(year, 9, 1); d = E.addDays(d, 7)) { const r = S.series(eng, { cropId: c.id, gardenIds: [g.garden.id], place: 'gardens', basis: 'planting', from: E.d2s(d), every: 7, count: 1, unit: 'whole', amount: 1 }); if (!r.error && r.plantings.length === 1 && r.frost === 1 && !r.firstHarvest) return { crop: c.id, garden: g.garden.id, from: E.d2s(d) }; } return null; }""")
    check('a subject: a one-planting series of a frost-tender crop that the frost leaves nothing to pick', bool(nsub), nsub)
    nsub = nsub or {}
    page.evaluate("LRFApp.select(null)"); page.evaluate("s => LRFApp.openAhead({ mode: 'series', cropId: s.crop, gardenId: s.garden })", nsub); soft('#srForm')
    for _ in range(40):
        if not page.evaluate("""g => { const box = [...document.querySelectorAll('#srGardens input')].find(b => b.checked !== (b.value === g)); if (box) box.click(); return !!box; }""", nsub.get('garden')): break
        page.wait_for_timeout(60)
    setc('#srFrom', nsub.get('from', '')); setc('#srEvery', '7'); setc('#srCount', '1'); setc('#srAmount', '1'); soft('#srSum')
    nr = page.evaluate("() => ({ sum: (document.getElementById('srSum') || {}).textContent || '', when: [...document.querySelectorAll('#srWaves .sr-when')].map(e => e.textContent) })")
    check('(c) its summary says no harvest span, says that nothing is picked, and its row says nothing picked', 'Harvest' not in nr['sum'] and 'Nothing is picked' in nr['sum'] and '1 of 1 cross a frost date.' in nr['sum'] and len(nr['when']) == 1 and 'nothing picked' in nr['when'][0] and 'pick ' not in nr['when'][0], nr)
    page.evaluate("LRFApp.select(null)"); page.evaluate("s => LRFApp.openAhead({ mode: 'series', cropId: s.crop, gardenId: s.garden })", csub); soft('#srForm')
    for _ in range(40):
        if not page.evaluate("""g => { const box = [...document.querySelectorAll('#srGardens input')].find(b => b.checked !== (b.value === g)); if (box) box.click(); return !!box; }""", csub.get('garden')): break
        page.wait_for_timeout(60)
    setc('#srFrom', '%d-07-20' % year_c); setc('#srEvery', '10'); setc('#srAmount', '1')
    # and a planting of that series waiting for a bed is offered the beds the frost touches, marked
    setc('#srCount', '6')
    page.evaluate("(document.querySelector('#srPlace [data-place=\"hold\"]') || { click() {} }).click()"); page.wait_for_timeout(200)
    page.evaluate("(document.getElementById('srAdd') || { click() {} }).click()"); page.wait_for_timeout(400)
    wsub = page.evaluate("""() => { const S = LRFSuccession, eng = LRFApp.state.engine, list = LRFApp.waiting().map(w => ({ w, h: S.homes(eng, w) })).filter(x => x.h.slice(0, 8).some(h => h.frost)); const x = list[list.length - 1]; return x ? { id: x.w.id, marked: x.h.slice(0, 8).filter(h => h.frost).length, notes: x.h.slice(0, 8).filter(h => h.frost).map(h => LRFUI.plainDays(h.frost)) } : null; }""")
    if wsub: page.evaluate("id => LRFApp.select({ type: 'waiting', id })", wsub['id']); page.wait_for_timeout(200)
    wr = page.evaluate("() => [...document.querySelectorAll('#wtHomes [data-hook=\"home-frost\"]')].map(e => e.title)")
    check('a waiting planting the frost touches is offered those beds, each marked “frost” with its note', bool(wsub) and len(wr) == wsub['marked'] and wr == wsub['notes'], [wsub, wr])
    if page.evaluate('LRFApp.waiting().length'): page.evaluate('LRFApp.undo()'); page.wait_for_timeout(200)
    check('and the plan is back as it was', page.evaluate('LRFApp.state.plan.plantings.length') == n0 and page.evaluate('LRFApp.waiting().length') == 0)
    page.evaluate("LRFApp.select(null)"); page.wait_for_timeout(100)

    # ── a series: the tool in the details panel (step 2b; its ghost bars and what waits to be placed are in step2b_check.py) ──
    page.evaluate("LRFApp.openAhead({ mode: 'series' })")
    page.wait_for_selector('#inspectorBody #srForm')
    check('a series opens in the details panel: not a page, and no sheet over the page', page.evaluate("LRFApp.state.view") == 'map' and page.evaluate("LRFApp.state.sel.type") == 'series' and page.query_selector('dialog[open]') is None and page.query_selector('#ahSheet') is None)
    def setv(sel, value):
        page.evaluate("""([sel, value]) => { const el = document.querySelector(sel); el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }""", [sel, value])
        page.wait_for_timeout(120)
    radish = page.evaluate("""(() => { const eng = LRFApp.state.engine, c = eng.crops().find(x => /^Radish$/.test(x.name)) || eng.crops().find(x => /radish/i.test(x.name)); return c.id; })()""")
    setv('#srCrop', radish)
    year = page.evaluate('LRFApp.planYear()')
    # a garden of the plan that takes the whole series, none left to place: the first of the tool's own choices that does
    garden = page.evaluate("""cropId => { const eng = LRFApp.state.engine, ids = [...document.querySelectorAll('#srGardens input')].map(box => box.value);
      return ids.find(id => { const r = LRFSuccession.series(eng, { cropId, gardenIds: [id], place: 'gardens', basis: 'planting', from: LRFApp.planYear() + '-08-01', every: 10, count: 5, unit: 'whole', amount: 1 }); return !r.error && r.plantings.length >= 3 && !r.held.length; }) || null; }""", radish)
    for _ in range(40):   # one box at a time: each click draws the boxes again
        if not page.evaluate("""garden => { const box = [...document.querySelectorAll('#srGardens input')].find(b => b.checked !== (b.value === garden)); if (box) box.click(); return !!box; }""", garden): break
        page.wait_for_timeout(60)
    check('the plan has a garden that takes a series of radishes from the first of August, and it alone is ticked', bool(garden) and page.evaluate("LRFSeries.state.P.gardenIds") == [garden], garden)
    page.wait_for_timeout(150)
    setv('#srFrom', '%d-08-01' % year); setv('#srEvery', '10'); setv('#srCount', '5'); setv('#srAmount', '1')
    page.wait_for_selector('#srWaves')
    waves = page.eval_on_selector_all('#srWaves li', 'els => els.length')
    summary = page.inner_text('#srSum')
    label = page.inner_text('#srAdd')
    check('five plantings ten days apart are previewed, with a sentence that sums them up', waves == 5 and 'planting' in summary and 'Harvest' in summary and label.startswith('Add '), [waves, summary, label])
    strip = page.evaluate("""() => { const rows = [...document.querySelectorAll('#srStrip .ah-strip-row')]; const now = rows[0].querySelectorAll('i.on').length, then = rows[1].querySelectorAll('i.on, i.new').length, added = rows[1].querySelectorAll('i.new').length; return { now, then, added, cells: rows[0].querySelectorAll('i').length }; }""")
    check('the weeks of harvest are shown now and with the series, and the series adds some', strip['cells'] > 20 and strip['then'] >= strip['now'] and strip['added'] >= 1, strip)
    page.screenshot(path=os.path.join(shots, 'series.png'), full_page=False)
    inputs = page.evaluate("[...document.querySelectorAll('#srForm select, #srForm input[type=date], #srForm input[type=number]')].map(e => Math.round(e.getBoundingClientRect().height))")
    check('the form’s fields are all one height', len(inputs) > 5 and min(inputs) == max(inputs) and min(inputs) in (28, 32), inputs)   # a control's height (DESIGN.md): 28 inside a card, 32 on a page
    expected = page.evaluate("LRFSeries.ghosts().placed.length")
    page.click('#srAdd')
    page.wait_for_selector('#srDone')
    after = page.evaluate("""() => { const eng = LRFApp.state.engine, P = LRFApp.state.plan.plantings, fresh = P.slice(-%d); return { n: P.length, clash: fresh.filter(p => eng.conflicts(p, eng.calc(p)).length).length, dates: fresh.map(p => p.date), undo: LRFApp.state.undo[LRFApp.state.undo.length - 1].label }; }""" % max(1, expected))
    check('Add places them all as one step, none on held ground', after['n'] == n0 + expected and after['clash'] == 0 and 'series' in after['undo'] and expected >= 3, [after, expected])
    page.click('#srSee')
    page.wait_for_timeout(250)
    check('“See them on the timeline” goes there', page.evaluate("LRFApp.state.view") == 'timeline')
    page.evaluate('LRFApp.undo()')
    check('one undo removes the whole series', page.evaluate('LRFApp.state.plan.plantings.length') == n0)
    # counted back from harvest, in feet
    page.evaluate("LRFApp.openAhead({ mode: 'series', cropId: '%s' })" % radish)
    page.wait_for_selector('#srForm')
    setv('#srFrom', '%d-08-20' % year)
    page.click('#srMore'); page.wait_for_selector('#srBasisHarvest'); page.click('#srBasisHarvest'); page.wait_for_timeout(200)
    setv('#srUnit', 'ft'); setv('#srAmount', '25')
    page.wait_for_selector('#srWaves')
    basis = page.evaluate("""() => { const g = LRFSeries.ghosts(), E = LRFEngine; return { n: g.placed.length, firsts: g.placed.map(x => E.d2s(x.r.first)), label: document.querySelector('#srFrom').closest('label').querySelector('span').textContent, ft: g.placed.every(x => x.r.physicalLength <= 25 + 1e-6), text: document.getElementById('srWaves').textContent }; }""")
    check('dates can be for first harvest, and the amount in feet of bed', 'harvest' in basis['label'].lower() and basis['n'] >= 1 and ('%d-08-20' % year) in basis['firsts'] and basis['ft'] and ' ft' in basis['text'], basis)
    setv('#srEvery', '0')
    check('a request that makes no sense is refused in words', page.query_selector('#srError') is not None and len(page.inner_text('#srError')) > 10)
    setv('#srEvery', '10')
    page.click('#srBasisPlant'); page.wait_for_timeout(150)
    page.click('#srClose'); page.wait_for_timeout(150)
    check('the x closes the tool and adds nothing', page.evaluate("LRFApp.state.sel") is None and page.evaluate('LRFApp.state.plan.plantings.length') == n0)
    # from a planting's panel
    page.click('[data-view-btn="map"]')
    page.evaluate("""() => { const eng = LRFApp.state.engine, p = LRFApp.state.plan.plantings.find(q => { const r = eng.calc(q); return r && r.tw; }); LRFApp.select({ type: 'planting', id: p.id }); }""")
    page.wait_for_selector('#fSeriesLink')
    page.click('#fSeriesLink')
    page.wait_for_selector('#srForm')
    from_panel = page.evaluate("""() => ({ view: LRFApp.state.view, model: LRFSeries.state.P.sourceId, gardens: [...document.querySelectorAll('#srGardens input:checked')].length, waves: document.querySelectorAll('#srWaves li').length, unit: (document.querySelector('#srUnitWord') || {}).value })""")
    check('a planting’s panel starts a series copied from it, in its own garden', from_panel['view'] == 'map' and len(from_panel['model']) > 3 and from_panel['gardens'] == 1 and from_panel['waves'] >= 1 and from_panel['unit'] == 'whole towers', from_panel)
    page.screenshot(path=os.path.join(shots, 'series-towers.png'))
    page.click('#srClose')

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
        page.evaluate("LRFApp.openAhead({ mode: 'series' })"); page.wait_for_selector('#srWaves, #srSum, #srError'); page.wait_for_timeout(200)
        page.screenshot(path=os.path.join(shots, 'series-%s.png' % name))
        tool = page.evaluate("(() => { const p = document.getElementById('inspectorBody'), box = document.querySelector('.inspector').getBoundingClientRect(); return { sideways: p.scrollWidth > p.clientWidth + 1, inside: [...p.querySelectorAll('select, input:not([type=checkbox]), button')].filter(e => e.getClientRects().length).every(e => e.getBoundingClientRect().right <= box.right + 0.5) }; })()")
        check('the series tool fits the panel at %s' % name, tool['inside'] and not tool['sideways'], tool)
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
