"""Step 2a (preview 0.17, wheel changed back in 0.18) in a real browser: the timeline's filters, its summaries that open, and its continuous scale.

usage: python3 -I step2a_check.py <app-dir-or-offline.html> <shots-dir>

Everything expected is worked out in the page from the plan that is open, so the check holds for whatever plan ships.
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

# What the page should show, from the plan itself.
FACTS = """(() => { const A = LRFApp, eng = A.state.engine, plan = A.state.plan, out = { all: 0, field: 0, cover: 0, tower: 0, crate: 0, trays: 0, banks: 0, pools: 0 };
  const gardens = new Map(plan.gardens.map(g => [g.id, g]));
  const part = b => eng.isPool(b) ? 'trays' : eng.isTower(b) ? 'tower' : eng.isCt(b) ? 'crate' : eng.isSoilBed(b) && gardens.get(b.gardenId).type === 'field' ? 'field' : 'cover';
  const beds = plan.beds.filter(b => b.active !== false && gardens.get(b.gardenId) && gardens.get(b.gardenId).active !== false);
  out.beds = {}; for (const b of beds) { const s = part(b), n = eng.plantingsIn(b.id).length; out[s] += n; out.all += n; (out.beds[s] = out.beds[s] || []).push(b.id); }
  out.banks = new Set(beds.filter(b => eng.isTower(b)).map(b => b.gardenId)).size; out.pools = beds.filter(b => eng.isPool(b)).length; out.plantings = plan.plantings.length; return out; })()"""
LANES = "(() => { const s = document.getElementById('tlScroll').getBoundingClientRect(); return { left: s.left + 148, right: s.right, top: s.top + 40, bottom: s.bottom, width: s.width - 148 }; })()"
# Is anything on the timeline cut off, or out of its place, at the scale it is drawn at now?
FITS = """(() => { const ppd = LRFTimeline.scale(), bad = [], tally = { bars: 0, named: 0, words: 0, opens: 0, cells: 0, months: 0, ticks: 0 };
  for (const el of document.querySelectorAll('.tl-bar')) { const name = el.querySelector('.tl-name'), b = el.getBoundingClientRect(), n = name.getBoundingClientRect(); tally.bars++;
    if (name.textContent) { tally.named++; tally.words += name.textContent.length; }
    if ((name.textContent || name.querySelector('.thumb:not([hidden])')) && (name.scrollWidth > name.clientWidth + 1 || n.right > b.right + 1 || n.left < b.left - 1)) bad.push({ what: 'bar', text: name.textContent, bar: Math.round(b.width), name: Math.round(n.width) }); }
  for (const el of document.querySelectorAll('.tl-open')) { tally.opens++; if (!el.textContent) continue; const r = document.createRange(); r.selectNodeContents(el); const cs = getComputedStyle(el);
    if (r.getBoundingClientRect().width > el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) + 0.6) bad.push({ what: 'opening', text: el.textContent, box: el.clientWidth }); }
  for (const el of document.querySelectorAll('.tl-cell')) { tally.cells++; if (!el.textContent) continue; const r = document.createRange(); r.selectNodeContents(el); if (r.getBoundingClientRect().width > el.clientWidth + 0.6) bad.push({ what: 'cell', text: el.textContent, box: el.clientWidth }); }
  for (const el of document.querySelectorAll('.tl-month')) { const span = el.querySelector('span'), b = el.getBoundingClientRect(), t = [...span.querySelectorAll('b')].find(x => x.getClientRects().length); tally.months++;
    if (!t || t.getBoundingClientRect().width + 12 > b.width + 0.6) bad.push({ what: 'month', text: t && t.textContent, box: Math.round(b.width) }); }
  const ticks = [...document.querySelectorAll('.tk')].filter(e => e.getClientRects().length).map(e => { const r = document.createRange(); r.selectNodeContents(e); return { x: e.getBoundingClientRect().left, w: r.getBoundingClientRect().width, t: e.textContent }; }).sort((a, b) => a.x - b.x);
  tally.ticks = ticks.length;
  for (let i = 1; i < ticks.length; i++) if (ticks[i - 1].x + ticks[i - 1].w + 3 > ticks[i].x + 3.6) { bad.push({ what: 'tick', a: ticks[i - 1], b: ticks[i] }); break; }
  return { ppd, tally, bad: bad.slice(0, 5), count: bad.length }; })()"""
# Does each bar stand on the days its planting has?
PLACES = """(() => { const A = LRFApp, eng = A.state.engine, E = LRFEngine, ppd = LRFTimeline.scale(), y0 = new Date(A.planYear(), 0, 1), y1 = new Date(A.planYear(), 11, 31), off = [];
  const clamp = d => d < y0 ? y0 : d > y1 ? y1 : d; let n = 0;
  for (const el of document.querySelectorAll('.tl-bar[data-planting]')) { const p = eng.planting(el.dataset.planting), r = eng.calc(p), lane = el.parentElement.getBoundingClientRect(), b = el.getBoundingClientRect();
    const from = clamp(eng.occupancyFrom(p, r)), th = eng.occupancyThrough(p, r), to = clamp(th === Infinity ? y1 : th), left = E.dayDiff(from, y0) * ppd, width = Math.max(4, (E.dayDiff(to, from) + 1) * ppd); n++;
    if (Math.abs(b.left - lane.left - left) > 0.75 || Math.abs(b.width - width) > 0.75) off.push({ id: p.id, left: [b.left - lane.left, left], width: [b.width, width] }); }
  const cur = document.getElementById('tlCursor').getBoundingClientRect(), inner = document.getElementById('tlInner').getBoundingClientRect(), want = 148 + (E.dayDiff(A.state.date, y0) + 0.5) * ppd;
  return { n, off: off.slice(0, 3), count: off.length, cursor: Math.abs(cur.left + cur.width / 2 - inner.left - want) }; })()"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = browser.new_context(viewport={'width': 1480, 'height': 900})
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'ERR_' not in m.text and '404' not in m.text else None)
    page.goto(url)
    page.wait_for_function('window.LRFApp && LRFApp.state.ready', timeout=30000)
    page.wait_for_timeout(400)
    js = page.evaluate
    facts = js(FACTS)
    n0 = facts['plantings']
    js("LRFApp.setDate(new Date(LRFApp.planYear(), 5, 15))")
    page.click('[data-view-btn="timeline"]')
    page.wait_for_selector('.tl-row')
    page.wait_for_timeout(400)

    # ── A. filters ──
    chips = page.eval_on_selector_all('#tlFilters button', 'els => els.map(e => [e.dataset.tlFilter, e.childNodes[0].textContent, +e.querySelector("small").textContent.replace(/,/g, ""), e.getAttribute("aria-pressed")])')
    check('five choices: All, Field, Greenhouses and tunnels, Towers, Crates, each with its plantings counted', [c[0] for c in chips] == ['all', 'field', 'cover', 'tower', 'crate'] and [c[1] for c in chips] == ['All', 'Field', 'Greenhouses and tunnels', 'Towers', 'Crates'] and [c[2] for c in chips] == [facts[k] for k in ('all', 'field', 'cover', 'tower', 'crate')] and chips[0][3] == 'true', [chips, facts['all']])
    check('the counts add up to the plan', facts['all'] == n0 and facts['field'] + facts['cover'] + facts['tower'] + facts['crate'] + facts['trays'] == n0, facts['all'])
    bands = page.eval_on_selector_all('.tl-section', 'els => els.map(e => e.dataset.section)')
    check('with everything shown, the kinds of space are set apart under headings, in a fixed order', bands == [s for s in ('field', 'cover', 'tower', 'crate', 'trays') if facts['beds'].get(s)], bands)
    shown_by = {}
    for f in ('field', 'cover', 'tower', 'crate'):
        page.click('[data-tl-filter="%s"]' % f)
        page.wait_for_timeout(150)
        shown_by[f] = js("""(() => { const eng = LRFApp.state.engine, ids = [...new Set([...document.querySelectorAll('.tl-row[data-bed]')].map(r => r.dataset.bed))];
          return { beds: ids, bands: document.querySelectorAll('.tl-section').length, strips: document.querySelectorAll('.tl-strip').length, banks: document.querySelectorAll('.tl-bank').length, pressed: document.querySelector('#tlFilters [aria-pressed="true"]').dataset.tlFilter, top: document.getElementById('tlScroll').scrollTop }; })()""")
    ok = all(shown_by[f]['pressed'] == f and shown_by[f]['bands'] == 0 and shown_by[f]['strips'] == 0 and shown_by[f]['top'] == 0 for f in shown_by)
    ok = ok and all(sorted(shown_by[f]['beds']) == sorted(facts['beds'].get(f, [])) for f in ('field', 'cover', 'crate')) and shown_by['tower']['beds'] == [] and shown_by['tower']['banks'] == facts['banks']
    check('each choice shows only its own spaces, every one of them, and no live trays', ok, {f: [len(v['beds']), len(facts['beds'].get(f, [])), v['bands'], v['strips'], v['banks']] for f, v in shown_by.items()})
    page.screenshot(path=os.path.join(shots, 'filter-crates.png'))
    page.wait_for_timeout(400)
    page.reload()
    page.wait_for_function('window.LRFApp && LRFApp.state.ready', timeout=30000)
    js("LRFApp.setDate(new Date(LRFApp.planYear(), 5, 15))")
    page.click('[data-view-btn="timeline"]')
    page.wait_for_selector('.tl-row')
    page.wait_for_timeout(300)
    check('the choice is remembered when the page is opened again', page.get_attribute('#tlFilters [aria-pressed="true"]', 'data-tl-filter') == 'crate' and len(js("[...new Set([...document.querySelectorAll('.tl-row[data-bed]')].map(r => r.dataset.bed))]")) == len(facts['beds'].get('crate', [])))
    page.click('[data-tl-filter="all"]')
    page.wait_for_timeout(200)

    # ── B. a bank of towers: one row, opening to single towers ──
    bank = js("""(() => { const eng = LRFApp.state.engine, rows = [...document.querySelectorAll('.tl-row.tl-bank')], out = [];
      for (const row of rows) { const gardenId = row.dataset.fold.split(':')[1], towers = LRFApp.state.plan.beds.filter(b => b.gardenId === gardenId && b.active !== false && eng.isTower(b));
        const plantings = towers.reduce((n, b) => n + eng.plantingsIn(b.id).length, 0), bars = [...row.querySelectorAll('.tl-bar.tl-sum')];
        const counted = bars.reduce((n, b) => n + +(b.title.match(/· ([\\d,]+) towers?/) || [0, 0])[1], 0);
        const alike = new Set(); for (const b of towers) for (const p of eng.plantingsIn(b.id)) { const r = eng.calc(p), th = eng.occupancyThrough(p, r); alike.add([p.cropId, p.varietyId || '', +eng.occupancyFrom(p, r), th === Infinity ? 'x' : +th].join('|')); }
        out.push({ towers: towers.length, plantings, bars: bars.length, counted, alike: alike.size, drag: bars.filter(b => b.dataset.planting).length, head: row.previousElementSibling.textContent }); }
      return out; })()""")
    check('a bank is one row: towers planted alike are one bar, and the bars account for every planting', len(bank) == facts['banks'] and all(b['bars'] == b['alike'] and b['counted'] == b['plantings'] and b['drag'] == 0 and 'as one row' in b['head'] for b in bank), bank)
    if bank:
        # towers planted the same day with different varieties are not one bar: tried by changing one tower's variety
        split = js("""(() => { const eng = LRFApp.state.engine, el = [...document.querySelectorAll('.tl-row.tl-bank .tl-bar.tl-sum')].find(b => +(b.title.match(/· ([\\d,]+) towers/) || [0, 0])[1] >= 2); if (!el) return null;
          const row = el.closest('.tl-row'), before = row.querySelectorAll('.tl-sum').length, p = eng.planting(el.dataset.first), other = eng.varietiesOf(p.cropId).find(v => v.id !== p.varietyId);
          LRFApp.updatePlanting(p.id, { varietyId: other ? other.id : null }, 'Test: another variety in one tower');
          const now = document.querySelector('.tl-row.tl-bank[data-fold="' + row.dataset.fold + '"]'), after = now.querySelectorAll('.tl-sum').length, alone = [...now.querySelectorAll('.tl-sum')].find(b => b.dataset.first === p.id);
          const out = { before, after, alone: alone ? alone.title : '', other: other ? other.name : '(none)' }; LRFApp.undo(); out.back = document.querySelector('.tl-row.tl-bank[data-fold="' + row.dataset.fold + '"]').querySelectorAll('.tl-sum').length; return out; })()""")
        check('one tower given another variety gets a bar of its own in the bank', split and split['after'] == split['before'] + 1 and '1 tower' in split['alone'] and split['back'] == split['before'], split)
        target_bar = js("""(() => { const el = document.querySelector('.tl-row.tl-bank .tl-bar.tl-sum'); el.scrollIntoView({ block: 'center' }); const s = document.getElementById('tlScroll').getBoundingClientRect(), r = el.getBoundingClientRect(); return { x: Math.max(r.left, s.left + 150) + 2, y: r.top + r.height / 2, first: el.dataset.first }; })()""")
        page.mouse.click(target_bar['x'], target_bar['y'])
        page.wait_for_timeout(300)
        opened = js("""(() => { const eng = LRFApp.state.engine, sel = LRFApp.state.sel, bar = sel && document.querySelector('.tl-bar[data-planting="' + sel.id + '"]'), s = document.getElementById('tlScroll').getBoundingClientRect(), r = bar && bar.getBoundingClientRect();
          return { sel, bar: !!bar, marked: bar && bar.classList.contains('sel'), seen: !!r && r.top >= s.top + 38 && r.bottom <= s.bottom + 1, towerRows: [...document.querySelectorAll('.tl-row[data-bed]')].filter(x => eng.isTower(eng.bedOf(x.dataset.bed))).length, banks: document.querySelectorAll('.tl-bank').length }; })()""")
        check('a click on one of those bars opens the bank to single towers and selects a planting there, in view', opened['sel'] and opened['sel']['type'] == 'planting' and opened['sel']['id'] == target_bar['first'] and opened['bar'] and opened['marked'] and opened['seen'] and opened['towerRows'] == bank[0]['towers'] and opened['banks'] == facts['banks'] - 1, [opened, target_bar])
        page.screenshot(path=os.path.join(shots, 'bank-open.png'))
        page.keyboard.press('Escape')
        js("(() => { const head = [...document.querySelectorAll('.tl-group-name')].find(b => /Show the bank as one row/.test(b.title)); head.click(); })()")
        page.wait_for_timeout(150)
        check('and its heading closes it to one row again', js("document.querySelectorAll('.tl-bank').length") == facts['banks'])
        # a planting chosen elsewhere is brought out of its bank
        hidden = js("(() => { const eng = LRFApp.state.engine, p = LRFApp.state.plan.plantings.filter(q => eng.isTower(eng.bedOf(q.bedId))).pop(); LRFApp.select({ type: 'planting', id: p.id }); return p.id; })()")
        page.wait_for_timeout(250)
        check('a tower planting selected from elsewhere is brought out of its bank', js("!!document.querySelector('.tl-bar.sel[data-planting=\"%s\"]')" % hidden))
        page.keyboard.press('Escape')
        js("for (const b of document.querySelectorAll('.tl-group-name')) if (/Show the bank as one row/.test(b.title)) b.click()")
        page.wait_for_timeout(150)

    # ── C. a space of crates: a row per crop, a month's planting as one bar ──
    crates = js("""(() => { const eng = LRFApp.state.engine, out = [];
      for (const row of document.querySelectorAll('.tl-row.tl-crop')) { const list = eng.plantingsIn(row.dataset.bed).filter(p => p.cropId === row.dataset.crop), starts = new Set(list.map(p => +eng.occupancyFrom(p, eng.calc(p))));
        const sums = [...row.querySelectorAll('.tl-bar.tl-sum')], singles = [...row.querySelectorAll('.tl-bar[data-planting]')];
        out.push({ crop: row.querySelector('.tl-fold b').textContent, plantings: list.length, starts: starts.size, bars: sums.length + singles.length, counted: singles.length + sums.reduce((n, b) => n + +b.title.match(/· ([\\d,]+) plantings?/)[1], 0), said: row.querySelector('.tl-label small').textContent }); }
      const crowded = LRFApp.state.plan.beds.filter(b => b.active !== false && eng.isCt(b) && eng.plantingsIn(b.id).length > 6 && new Set(eng.plantingsIn(b.id).map(p => p.cropId)).size > 1);
      return { rows: out, crops: crowded.reduce((n, b) => n + new Set(eng.plantingsIn(b.id).map(p => p.cropId)).size, 0), tallest: Math.max(0, ...[...document.querySelectorAll('.tl-row.tl-crop')].map(r => r.getBoundingClientRect().height)) }; })()""")
    check('a crowded crate space has a row for each crop; plantings that go in together are one bar; none is left out', len(crates['rows']) == crates['crops'] and all(r['bars'] == r['starts'] and r['counted'] == r['plantings'] and r['said'].startswith(str(r['plantings'])) for r in crates['rows']), crates)
    if crates['rows']:
        check('no crate row is taller than a few bars', crates['tallest'] <= 22 * 8 + 6, crates['tallest'])
        js("(() => { const b = document.querySelector('.tl-row.tl-crop .tl-fold'); b.scrollIntoView({ block: 'center' }); b.click(); })()")
        page.wait_for_timeout(200)
        one = js("""(() => { const eng = LRFApp.state.engine, row = document.querySelector('.tl-row.tl-crop .tl-fold[aria-expanded="true"]').closest('.tl-row'), list = eng.plantingsIn(row.dataset.bed).filter(p => p.cropId === row.dataset.crop);
          return { plantings: list.length, bars: row.querySelectorAll('.tl-bar[data-planting]').length, sums: row.querySelectorAll('.tl-sum').length }; })()""")
        check('a crop opens to every one of its plantings, each a bar that can be moved', one['bars'] == one['plantings'] and one['sums'] == 0, one)
        js("document.querySelector('.tl-row.tl-crop .tl-fold[aria-expanded=\"true\"]').click()")
        page.wait_for_timeout(150)

    # ── D. live trays: one strip ──
    strip = js("""(() => { const A = LRFApp, eng = A.state.engine, E = LRFEngine, row = document.querySelector('.tl-row.tl-strip'); if (!row) return null;
      const y0 = new Date(A.planYear(), 0, 1), days = E.dayDiff(new Date(A.planYear(), 11, 31), y0) + 1, load = new Array(days).fill(0);
      for (const p of eng.plantingsIn(row.dataset.bed)) { const r = eng.calc(p); if (!r) continue; const a = Math.max(0, E.dayDiff(eng.occupancyFrom(p, r), y0)), th = eng.occupancyThrough(p, r), b = Math.min(days - 1, th === Infinity ? days - 1 : E.dayDiff(th, y0)); for (let i = a; i <= b; i++) load[i] += r.len || 0; }
      const cells = [...row.querySelectorAll('.tl-cell')].map(c => ({ a: +c.style.getPropertyValue('--a'), n: +c.style.getPropertyValue('--n'), said: +c.title.match(/up to ([\\d,]+) live/)[1].replace(/,/g, '') }));
      const wrong = cells.filter(c => Math.max(...load.slice(c.a, c.a + c.n)) !== c.said || (c.a > 0 && E.addDays(y0, c.a).getDay() !== 1) || c.n > 7);
      const covered = new Set(); for (const c of cells) for (let i = c.a; i < c.a + c.n; i++) covered.add(i);
      return { cells: cells.length, wrong: wrong.slice(0, 3), missed: load.filter((v, i) => v > 0 && !covered.has(i)).length, peak: Math.max(...load), label: row.querySelector('.tl-label').textContent, cropRows: document.querySelectorAll('.tl-pool:not(.tl-strip)').length, bars: row.querySelectorAll('.tl-bar').length }; })()""")
    if facts['pools']:
        check('live trays are one strip: a cell a week, each the most trays standing that week, no week with trays left out', strip and strip['cells'] > 10 and not strip['wrong'] and strip['missed'] == 0 and strip['cropRows'] == 0 and strip['bars'] == 0 and ('most %s at once' % format(strip['peak'], ',')) in strip['label'], strip)
        js("document.querySelector('.tl-row.tl-strip').scrollIntoView({ block: 'center' })")
        page.wait_for_timeout(150)
        page.screenshot(path=os.path.join(shots, 'trays-strip.png'))
        js("document.querySelector('.tl-row.tl-strip').previousElementSibling.querySelector('.tl-group-name').click()")
        page.wait_for_timeout(200)
        crops = js("({ rows: document.querySelectorAll('.tl-pool:not(.tl-strip)').length, crops: new Set(LRFApp.state.plan.plantings.filter(p => LRFApp.state.engine.isPool(LRFApp.state.engine.bedOf(p.bedId))).map(p => p.cropId)).size, strip: document.querySelectorAll('.tl-strip').length })")
        check('opened, there is a row for each tray crop under the strip', crops['rows'] == crops['crops'] and crops['strip'] == facts['pools'], crops)
        js("document.querySelector('.tl-row.tl-strip').previousElementSibling.querySelector('.tl-group-name').click()")
        page.wait_for_timeout(150)
        box = js("(() => { const r = document.querySelector('.tl-row.tl-strip .tl-lane').getBoundingClientRect(), s = document.getElementById('tlScroll').getBoundingClientRect(); return { x: Math.max(r.left, s.left + 150) + 40, y: r.top + r.height / 2 }; })()")
        page.mouse.click(box['x'], box['y'])
        page.wait_for_timeout(200)
        check('a click on the strip goes to the Trays view, where the trays are planned', js("LRFApp.state.view") == 'trays')
        page.click('[data-view-btn="timeline"]')
        page.wait_for_timeout(250)
    js("document.getElementById('tlScroll').scrollTop = 0")

    # ── E. the scale: continuous; the plain wheel scrolls the rows, Ctrl and the wheel zoom about the day under the pointer ──
    lanes = js(LANES)
    start = js("({ ppd: LRFTimeline.scale(), fit: LRFTimeline.fit(), wide: document.getElementById('tlScroll').scrollWidth - document.getElementById('tlScroll').clientWidth, tier: document.getElementById('tlInner').dataset.tier, pressed: document.querySelector('[data-tl-zoom][aria-pressed=\"true\"]').dataset.tlZoom, out: document.getElementById('tlZoomOut').disabled })")
    check('it opens on the whole year, edge to edge, with nothing to scroll sideways', abs(start['ppd'] - start['fit']) < 1e-6 and start['wide'] <= 1 and start['tier'] == 'months' and start['pressed'] == 'months' and start['out'], start)
    px, py = round(lanes['left'] + lanes['width'] * 0.62), round(lanes['top'] + 200)   # whole pixels: that is what the wheel reports
    day_at = "(x => (document.getElementById('tlScroll').scrollLeft + x - document.getElementById('tlScroll').getBoundingClientRect().left - 148) / LRFTimeline.scale())(%d)" % px
    page.mouse.move(px, py)
    # the plain wheel over the bars scrolls the rows, as it did before 0.17, and changes nothing else
    page.mouse.wheel(0, 300)
    page.wait_for_timeout(250)
    plain = js("({ top: document.getElementById('tlScroll').scrollTop, left: document.getElementById('tlScroll').scrollLeft, ppd: LRFTimeline.scale(), fit: LRFTimeline.fit() })")
    check('the plain wheel over the bars scrolls the rows and leaves the scale alone', plain['top'] > 100 and plain['left'] == 0 and abs(plain['ppd'] - plain['fit']) < 1e-6, plain)
    page.mouse.wheel(0, -300)
    page.wait_for_timeout(250)
    check('and back up again', js("document.getElementById('tlScroll').scrollTop") == 0)
    d0 = js(day_at)
    steps, drift, scales = 0, 0.0, [start['ppd']]
    page.keyboard.down('Control')
    for _ in range(40):
        page.mouse.wheel(0, -100)
        page.wait_for_timeout(25)
        steps += 1
        scales.append(js("LRFTimeline.scale()"))
        drift = max(drift, abs(js(day_at) - d0) * scales[-1])
        if scales[-1] >= js("LRFTimeline.levels.max") - 1e-6:
            break
    page.keyboard.up('Control')
    ratios = [scales[i + 1] / scales[i] for i in range(len(scales) - 2)]
    check('Ctrl and the wheel over the bars zoom in smoothly, every notch the same step, as far as two days to the inch', scales[-1] == js("LRFTimeline.levels.max") and 8 < steps < 40 and max(ratios) - min(ratios) < 0.01 and 1.1 < ratios[0] < 1.35, {'steps': steps, 'ratios': [round(r, 3) for r in ratios[:4]], 'last': scales[-1]})
    check('the day under the pointer stays under the pointer all the way in', drift < 1.5, drift)
    check('zoomed in, the rows did not scroll', js("document.getElementById('tlScroll').scrollTop") == 0)
    tiers = js("({ tier: document.getElementById('tlInner').dataset.tier, pressed: document.querySelector('[data-tl-zoom][aria-pressed=\"true\"]').dataset.tlZoom, inOff: document.getElementById('tlZoomIn').disabled, days: [...document.querySelectorAll('.tk')].filter(e => e.getClientRects().length).length, dayLines: [...document.querySelectorAll('.g-day')].filter(e => e.getClientRects().length).length })")
    check('all the way in it is days: every day numbered in the head and ruled on the chart', tiers['tier'] == 'days' and tiers['pressed'] == 'days' and tiers['inOff'] and tiers['days'] >= 365 and tiers['dayLines'] > 300, tiers)
    page.screenshot(path=os.path.join(shots, 'zoom-days.png'))
    # a bar wider than the page keeps its name in sight
    sticky = js("""(() => { const s = document.getElementById('tlScroll').getBoundingClientRect(), left = s.left + 148; let seen = 0, kept = 0, lost = [];
      for (const el of document.querySelectorAll('.tl-bar[data-planting]')) { const b = el.getBoundingClientRect(), name = el.querySelector('.tl-name'); if (!name.textContent || b.top < s.top + 40 || b.bottom > s.bottom || b.left > left - 30 || b.right < left + 260) continue; seen++;
        const n = name.getBoundingClientRect(); if (n.left >= left - 1 && n.left <= left + 4) kept++; else lost.push({ text: name.textContent, at: Math.round(n.left - left) }); }
      return { seen, kept, lost: lost.slice(0, 3) }; })()""")
    check('a bar that runs off the left of the page keeps its name at the edge of what can be seen', sticky['seen'] >= 1 and sticky['kept'] == sticky['seen'], sticky)
    page.keyboard.down('Control')
    for _ in range(60):
        page.mouse.wheel(0, 100)
        page.wait_for_timeout(15)
        if js("document.getElementById('tlZoomOut').disabled"):
            break
    page.keyboard.up('Control')
    back = js("({ ppd: LRFTimeline.scale(), fit: LRFTimeline.fit(), wide: document.getElementById('tlScroll').scrollWidth - document.getElementById('tlScroll').clientWidth })")
    check('and out again as far as the whole year, no further', abs(back['ppd'] - back['fit']) < 1e-6 and back['wide'] <= 1, back)
    # over the names the wheel scrolls the rows
    page.mouse.move(lanes['left'] - 70, py)
    page.mouse.wheel(0, 300)
    page.wait_for_timeout(250)
    names = js("({ top: document.getElementById('tlScroll').scrollTop, ppd: LRFTimeline.scale(), fit: LRFTimeline.fit() })")
    check('over the names the wheel scrolls the rows and leaves the scale alone', names['top'] > 100 and abs(names['ppd'] - names['fit']) < 1e-6, names)
    js("document.getElementById('tlScroll').scrollTop = 0")
    # Shift and the wheel slide the chart sideways
    js("LRFTimeline.setScale(8)")
    page.wait_for_timeout(100)
    page.mouse.move(px, py)
    left0 = js("document.getElementById('tlScroll').scrollLeft")
    page.keyboard.down('Shift'); page.mouse.wheel(0, 240); page.keyboard.up('Shift')
    page.wait_for_timeout(150)
    slid = js("({ left: document.getElementById('tlScroll').scrollLeft, ppd: LRFTimeline.scale(), top: document.getElementById('tlScroll').scrollTop })")
    check('Shift and the wheel slide the chart sideways without zooming', abs(slid['left'] - left0 - 240) < 2 and slid['ppd'] == 8 and slid['top'] == 0, [left0, slid])
    weeks = js("({ tier: document.getElementById('tlInner').dataset.tier, pressed: document.querySelector('[data-tl-zoom][aria-pressed=\"true\"]').dataset.tlZoom, ticks: [...document.querySelectorAll('.tk')].filter(e => e.getClientRects().length).map(e => e.classList.contains('mon')), weekLines: [...document.querySelectorAll('.g-week')].filter(e => e.getClientRects().length).length, full: [...document.querySelectorAll('.tl-month .full')].filter(e => e.getClientRects().length).length })")
    check('in between it is weeks: each Monday numbered and ruled, the months named in full', weeks['tier'] == 'weeks' and weeks['pressed'] == 'weeks' and 50 <= len(weeks['ticks']) <= 53 and all(weeks['ticks']) and weeks['weekLines'] >= 40 and weeks['full'] == 12, {k: (len(v) if isinstance(v, list) else v) for k, v in weeks.items()})
    page.screenshot(path=os.path.join(shots, 'zoom-weeks.png'))

    # ── F. hold and drag empty chart to move it; a plain click still chooses ──
    # a bed with nothing in it, standing in the upper part of the window: one that is there already, or else the first that can be
    # scrolled there (the plan need not have one on its first screen)
    FREE = """const sc = document.getElementById('tlScroll'), s = sc.getBoundingClientRect(), fits = r => { const b = r.getBoundingClientRect(); return b.top > s.top + 60 && b.bottom < s.bottom - 200; };
      const free = [...document.querySelectorAll('.tl-row[data-bed]:not(.tl-pool)')].filter(r => !r.querySelector('.tl-bar, .tl-open'));"""
    top0 = js("document.getElementById('tlScroll').scrollTop")
    js("(() => { " + FREE + " if (free.some(fits)) return; for (const r of free) { sc.scrollTop += Math.round(r.getBoundingClientRect().top - s.top - 120); if (fits(r) && sc.scrollTop + 90 <= sc.scrollHeight - sc.clientHeight) return; } sc.scrollTop = %d; })()" % top0)
    page.wait_for_timeout(150)
    spot = js("(() => { " + FREE + " const row = free.find(fits); if (!row) return null; const r = row.getBoundingClientRect(); return { x: s.left + 148 + 300, y: r.top + r.height / 2, bed: row.dataset.bed, beds: free.length }; })()")
    check('the plan has a bed with nothing in it, to hold and drag the empty chart of', spot, spot)
    if spot:
        before = js("({ left: document.getElementById('tlScroll').scrollLeft, top: document.getElementById('tlScroll').scrollTop, sel: LRFApp.state.sel, date: LRFEngine.d2s(LRFApp.state.date) })")
        page.mouse.move(spot['x'], spot['y']); page.mouse.down(); page.mouse.move(spot['x'] - 130, spot['y'] - 90, steps=6)
        held = js("document.getElementById('tlScroll').classList.contains('panning')")
        page.mouse.up()
        page.wait_for_timeout(120)
        after = js("({ left: document.getElementById('tlScroll').scrollLeft, top: document.getElementById('tlScroll').scrollTop, sel: LRFApp.state.sel, date: LRFEngine.d2s(LRFApp.state.date), panning: document.getElementById('tlScroll').classList.contains('panning') })")
        check('holding and dragging empty chart moves it both ways, and chooses nothing', held and not after['panning'] and abs(after['left'] - before['left'] - 130) < 2 and abs(after['top'] - before['top'] - 90) < 2 and after['sel'] == before['sel'] and after['date'] == before['date'], [before, after])
        js("document.getElementById('tlScroll').scrollTop = %d; document.getElementById('tlScroll').scrollLeft = %d" % (before['top'], before['left']))
        page.wait_for_timeout(80)
        page.mouse.click(spot['x'], spot['y'])
        page.wait_for_timeout(150)
        picked = js("({ sel: LRFApp.state.sel, date: LRFEngine.d2s(LRFApp.state.date), want: LRFEngine.d2s(LRFEngine.addDays(new Date(LRFApp.planYear(), 0, 1), Math.floor((%f - document.querySelector('.tl-row[data-bed=\"%s\"] .tl-lane').getBoundingClientRect().left) / LRFTimeline.scale()))) })" % (spot['x'], spot['bed']))
        check('a plain click there still selects the bed and sets the date under the pointer', picked['sel'] and picked['sel']['type'] == 'bed' and picked['sel']['id'] == spot['bed'] and picked['date'] == picked['want'], picked)
        marks = js("(() => { const m = () => [...document.querySelectorAll('#tlBody .sel')].map(e => e.className.split(' ')[0] + ':' + (e.dataset.bed || e.dataset.planting || e.dataset.opening || '')); const a = m(); const p = LRFApp.state.engine.plantingsIn(document.querySelector('.tl-bar[data-planting]').closest('.tl-row').dataset.bed)[0]; const stamp = document.getElementById('tlBody').firstChild; LRFApp.select({ type: 'planting', id: document.querySelector('.tl-bar[data-planting]').dataset.planting }); const b = m(); LRFApp.select(null); return { bed: a, planting: b, none: m(), same: stamp === document.getElementById('tlBody').firstChild && stamp.isConnected }; })()")
        check('what is selected is marked without the chart being drawn again', marks['bed'] == ['tl-row:' + spot['bed']] and len(marks['planting']) == 1 and marks['planting'][0].startswith('tl-bar:') and marks['none'] == [] and marks['same'], marks)
    js("document.getElementById('tlScroll').scrollTop = %d" % top0)
    page.wait_for_timeout(80)
    js("LRFApp.setDate(new Date(LRFApp.planYear(), 5, 15))")

    # ── G. nothing is cut off and everything stands on its days, at any scale ──
    sample = [0, 1.9, 2.6, 3.3, 4.4, 4.6, 6.2, 9, 13, 15.9, 16.1, 22, 31, 48]
    worst, off, seen = [], [], []
    for value in sample:
        js("LRFTimeline.setScale(%s)" % (value or 'LRFTimeline.fit()'))
        page.wait_for_timeout(60)
        f = js(FITS)
        p = js(PLACES)
        seen.append([round(f['ppd'], 2), f['tally']['words'], f['tally']['ticks']])
        if f['count']:
            worst.append(f)
        if p['count'] or p['cursor'] > 0.75 or p['n'] < 100:
            off.append([value, p])
    check('at fourteen scales from the whole year to single days, no bar, opening, tray count, month or day number is cut off or runs into the next', not worst, worst[:2])
    check('and every bar stands on its own days, the date line on its date', not off, off[:2])
    check('zooming in, more bars have room for their words', seen[0][1] < seen[5][1] <= seen[-1][1], seen)
    # the same, with every summary opened and at a narrower window
    for _ in range(60):
        if not js("(() => { const el = document.querySelector('.tl-group-name[aria-expanded=\"false\"], .tl-fold[aria-expanded=\"false\"]'); if (el) el.click(); return !!el; })()"):
            break
    page.set_viewport_size({'width': 1280, 'height': 720})
    page.wait_for_timeout(250)
    worst, off, bars = [], [], 0
    for value in [0, 3.2, 7, 20]:
        js("LRFTimeline.setScale(%s)" % (value or 'LRFTimeline.fit()'))
        page.wait_for_timeout(80)
        f, p = js(FITS), js(PLACES)
        bars = p['n']
        if f['count']:
            worst.append(f)
        if p['count']:
            off.append([value, p])
    check('with every summary opened there is a bar for every planting, none cut off, each on its days (1280 wide)', bars == n0 and not worst and not off, [bars, n0, worst[:1], off[:1]])
    # shutting them again (once the page has written down the last change, a moment after it)
    page.wait_for_timeout(500)
    js("localStorage.removeItem('lrf-next:timeline')")
    page.set_viewport_size({'width': 1480, 'height': 900})

    # ── H. the room changes: the whole year still fits; a chosen scale is kept ──
    page.reload()
    page.wait_for_function('window.LRFApp && LRFApp.state.ready', timeout=30000)
    js("LRFApp.setDate(new Date(LRFApp.planYear(), 5, 15))")
    page.click('[data-view-btn="timeline"]')
    page.wait_for_selector('.tl-row')
    page.wait_for_timeout(400)
    tip = page.get_attribute('.tl-zoom', 'title') or ''
    check('the zoom buttons say, on hover, that Ctrl and the wheel zoom and dragging moves the chart', 'Ctrl' in tip and 'wheel' in tip and 'drag' in tip, tip)
    page.set_viewport_size({'width': 1280, 'height': 720})
    page.wait_for_timeout(300)
    narrow = js("({ ppd: LRFTimeline.scale(), fit: LRFTimeline.fit(), wide: document.getElementById('tlScroll').scrollWidth - document.getElementById('tlScroll').clientWidth })")
    check('made narrower, the whole year still fits edge to edge', abs(narrow['ppd'] - narrow['fit']) < 1e-6 and narrow['wide'] <= 1, narrow)
    tools = js("(() => { const t = document.querySelector('.tl-tools'), kids = [...t.children].map(e => e.getBoundingClientRect()); return { over: t.scrollWidth > t.clientWidth + 1, out: kids.filter(r => r.right > t.getBoundingClientRect().right + 1).length, rows: new Set(kids.map(r => Math.round((r.top + r.height / 2) / 12))).size }; })()")
    check('the tools above the chart fit at 1280 wide, in two lines at most', not tools['over'] and tools['out'] == 0 and tools['rows'] <= 2, tools)
    page.screenshot(path=os.path.join(shots, 'timeline-1280.png'))
    page.click('[data-tl-zoom="weeks"]')
    page.wait_for_timeout(450)
    centre = js("(() => { const c = document.getElementById('tlCursor').getBoundingClientRect(), s = document.getElementById('tlScroll').getBoundingClientRect(); return { x: c.left, left: s.left + 148, right: s.right, ppd: LRFTimeline.scale() }; })()")
    check('“Weeks” goes to the weeks scale and keeps the planning date in sight', centre['ppd'] == 8 and centre['left'] < centre['x'] < centre['right'], centre)
    page.reload()
    page.wait_for_function('window.LRFApp && LRFApp.state.ready', timeout=30000)
    page.click('[data-view-btn="timeline"]')
    page.wait_for_selector('.tl-row')
    page.wait_for_timeout(400)
    kept = js("({ ppd: LRFTimeline.scale(), toast: document.getElementById('toast').textContent })")
    check('the scale is remembered when the page is opened again, and nothing is announced about the wheel', kept['ppd'] == 8 and 'wheel' not in kept['toast'].lower(), kept)
    page.click('#tlZoomIn'); page.wait_for_timeout(80)
    plus = js("LRFTimeline.scale()")
    page.click('#tlZoomOut'); page.click('#tlZoomOut'); page.wait_for_timeout(80)
    minus = js("LRFTimeline.scale()")
    check('the + and − buttons step the scale for anyone without a wheel', abs(plus - 12) < 1e-6 and abs(minus - 12 / 2.25) < 1e-6, [plus, minus])
    page.click('[data-tl-zoom="months"]')
    page.wait_for_timeout(100)
    page.set_viewport_size({'width': 1480, 'height': 900})
    page.wait_for_timeout(300)

    # ── I. dropping and sliding still land on the day, at a scale that is not a round number ──
    js("LRFTimeline.setScale(5.37)")
    page.wait_for_timeout(120)
    ppd = js("LRFTimeline.scale()")
    free = js("""(() => { const eng = LRFApp.state.engine, s = document.getElementById('tlScroll').getBoundingClientRect(); const row = [...document.querySelectorAll('.tl-row[data-bed]')].find(r => { const b = eng.bedOf(r.dataset.bed); return eng.isSoilBed(b) && !eng.plantingsIn(b.id).length && eng.gardenOf(b).type === 'field'; });
      row.scrollIntoView({ block: 'center' }); const lane = row.querySelector('.tl-lane').getBoundingClientRect(); return { bed: row.dataset.bed, left: lane.left, y: lane.top + lane.height / 2, x: s.left + 148 + 320 }; })()""")
    free = js("(() => { const row = document.querySelector('.tl-row[data-bed=\"%s\"]'), lane = row.querySelector('.tl-lane').getBoundingClientRect(), s = document.getElementById('tlScroll').getBoundingClientRect(); return { bed: row.dataset.bed, left: lane.left, y: lane.top + lane.height / 2, x: s.left + 148 + 320 }; })()" % free['bed'])
    lib = page.locator('.lib-row[data-crop="carrot"]').first.bounding_box()
    page.mouse.move(lib['x'] + 60, lib['y'] + 12); page.mouse.down(); page.mouse.move(free['x'] - 40, free['y'] - 30, steps=5); page.mouse.move(free['x'], free['y'], steps=5)
    ghost = js("(() => { const g = document.getElementById('tlGhost'), r = g.getBoundingClientRect(), row = document.querySelector('.tl-row.drop-target'); return { shown: !g.hidden, left: r.left, row: row && row.dataset.bed }; })()")
    page.mouse.up()
    page.wait_for_timeout(200)
    drop = js("(() => { const P = LRFApp.state.plan.plantings, p = P[P.length - 1], E = LRFEngine; return { added: P.length - %d, bed: p.bedId, date: p.date, want: E.d2s(E.addDays(new Date(LRFApp.planYear(), 0, 1), Math.floor((%f - %f) / %f))) }; })()" % (n0, free['x'], free['left'], ppd))
    check('a crop dropped on a row goes in on the day under the pointer, with the outline shown on that row', drop['added'] == 1 and drop['bed'] == free['bed'] and drop['date'] == drop['want'] and ghost['shown'] and ghost['row'] == free['bed'], [drop, ghost])
    bar = page.locator('.tl-row[data-bed="%s"] .tl-bar' % free['bed']).first.bounding_box()
    page.mouse.move(bar['x'] + 9, bar['y'] + 8); page.mouse.down(); page.mouse.move(bar['x'] + 9 + 7 * ppd, bar['y'] + 8, steps=6); page.mouse.move(bar['x'] + 9 + 21 * ppd, bar['y'] + 8, steps=6); page.mouse.up()
    page.wait_for_timeout(200)
    check('sliding its bar three weeks along moves it three weeks', js("LRFApp.state.plan.plantings[LRFApp.state.plan.plantings.length - 1].date") == js("LRFEngine.d2s(LRFEngine.addDays(LRFEngine.s2d('%s'), 21))" % drop['date']))
    page.keyboard.press('Control+z'); page.keyboard.press('Control+z')
    check('both are undone', js("LRFApp.state.plan.plantings.length") == n0)
    # a crate crop's row takes a drop for its space; a bank's row takes none
    if crates['rows']:
        js("document.querySelector('.tl-row.tl-crop').scrollIntoView({ block: 'center' })")
        page.wait_for_timeout(120)
        cr = js("(() => { const row = document.querySelector('.tl-row.tl-crop'), lane = row.querySelector('.tl-lane').getBoundingClientRect(), s = document.getElementById('tlScroll').getBoundingClientRect(); return { bed: row.dataset.bed, y: lane.top + lane.height / 2, x: s.left + 148 + 500 }; })()")
        page.mouse.move(lib['x'] + 60, lib['y'] + 12); page.mouse.down(); page.mouse.move(cr['x'] - 30, cr['y'] - 20, steps=5); page.mouse.move(cr['x'], cr['y'], steps=4)
        aim = js("({ row: (document.querySelector('.tl-row.drop-target') || { dataset: {} }).dataset.bed, crop: !!document.querySelector('.tl-row.tl-crop.drop-target'), hint: document.querySelector('.drag-ghost .drag-hint').textContent })")
        page.keyboard.press('Escape'); page.mouse.up()
        check('a crate crop’s row is that crate space, for a drop', aim['row'] == cr['bed'] and aim['crop'], aim)
    if bank:
        js("document.querySelector('.tl-row.tl-bank').scrollIntoView({ block: 'center' })")
        page.wait_for_timeout(120)
        br = js("(() => { const lane = document.querySelector('.tl-row.tl-bank .tl-lane').getBoundingClientRect(), s = document.getElementById('tlScroll').getBoundingClientRect(); return { y: lane.top + lane.height - 4, x: s.left + 148 + 40 }; })()")
        page.mouse.move(lib['x'] + 60, lib['y'] + 12); page.mouse.down(); page.mouse.move(br['x'] - 30, br['y'] - 20, steps=5); page.mouse.move(br['x'], br['y'], steps=4)
        aim = js("({ target: document.querySelectorAll('.tl-row.drop-target').length, hint: document.querySelector('.drag-ghost .drag-hint').textContent })")
        page.keyboard.press('Escape'); page.mouse.up()
        check('a bank shown as one row takes no drop: it has to be opened to a tower first', aim['target'] == 0 and 'Drop on a row' in aim['hint'], aim)
    check('nothing was added by those', js("LRFApp.state.plan.plantings.length") == n0)

    # ── J. it keeps up ──
    js("LRFTimeline.setScale(LRFTimeline.fit())")
    speed = js("""(() => { const t0 = performance.now(); let v = LRFTimeline.fit(); for (let i = 0; i < 40; i++) { v *= i < 20 ? 1.19 : 1 / 1.19; LRFTimeline.setScale(v, null, false); document.getElementById('tlInner').getBoundingClientRect(); } const each = (performance.now() - t0) / 40;
      const t1 = performance.now(); LRFApp.select(null); const draw = performance.now() - t1; return { each, draw, bars: document.querySelectorAll('.tl-bar').length }; })()""")
    # this machine is a slow one with no graphics card: the figure is kept low enough here that a desktop has room to spare
    check('a change of scale is drawn in a few hundredths of a second here, across every scale, and selecting something in less', speed['each'] < 30 and speed['draw'] < 40, speed)
    js("LRFTimeline.setScale(LRFTimeline.fit())")
    page.emulate_media(color_scheme='dark')
    page.wait_for_timeout(200)
    page.screenshot(path=os.path.join(shots, 'timeline-dark.png'))
    check('no script errors', not errors, errors[:4])
    browser.close()
if server:
    server.shutdown()
print('\n'.join(results))
print(json.dumps({'passed': len(results) - len(failed), 'of': len(results), 'failed': failed}))
sys.exit(1 if failed else 0)
