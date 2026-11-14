"""Step 3b (preview 0.23) in a real browser: the list's second table (yield and price), the review of yield, harvest
days, turnover and old copies kept on plantings, and the seed order sheet.

usage: python3 -I step3b_check.py <app-dir-or-built-site-dir> <shots-dir> [backup.zip]
       DARK=1 for a dark page; WIDTH=1480 for the wider window (default 1280); LIVE=1 prints as it goes; STOP_AT_FAIL=1.
       The app folder opens the plan it ships with. A built site ships none: give it a backup to load.

Everything expected is worked out in the page from the plan that is open, so the check holds for whatever plan ships.
The rules under test:
  - "Yield and price" is a second table in the Assumptions view, opened in place; looking changes nothing;
  - grey is what the plan uses now; a figure typed is used by every planting with none of its own, is one step, is said
    in a toast with what it does to the season's worth, and one undo takes it back; clearing a cell goes back to grey;
  - switching between a total and a weekly figure turns the typed yields into the other, and back;
  - harvest days move the last harvest and are said; turnover days that settle double bookings say so;
  - a crop that keeps shows "To sell" and "Picked" in the Harvest view;
  - the review window lists yield, harvest days, turnover and copies; its suggested step changes nothing; using the
    list's figure says what it does to yield and worth before anything changes; Apply keeps a snapshot and is one step;
  - the order sheet opens in place, closes without doing anything, follows amounts typed, and marking a supplier's lines
    as ordered is one step that one undo takes back;
  - a label is never clipped and nothing spills out of its cell.
"""
import functools, http.server, json, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright

target, shots = sys.argv[1], sys.argv[2]
BACKUP = sys.argv[3] if len(sys.argv) > 3 else None
DARK, WIDTH = os.environ.get('DARK') == '1', int(os.environ.get('WIDTH', '1280'))
os.makedirs(shots, exist_ok=True)
results, failed = [], []


def check(name, ok, detail=None):
    results.append(('ok   ' if ok else 'FAIL ') + name + ('' if ok or detail is None else ' ' + json.dumps(detail, default=str)[:900]))
    if not ok:
        failed.append(name)
    if os.environ.get('LIVE') == '1':
        print(results[-1], flush=True)
    if not ok and os.environ.get('STOP_AT_FAIL') == '1':
        print('\n'.join(results)); print(json.dumps({'passed': len(results) - len(failed), 'of': len(results), 'failed': failed}), flush=True)
        os._exit(0)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=target))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = 'http://127.0.0.1:%d/index.html' % server.server_address[1]

# Every planting's dates, ground and yield, to compare before and after a step.
FIGS = "(() => { const e = LRFApp.state.engine; return Object.fromEntries(LRFApp.state.plan.plantings.map(p => { const f = LRFAudit.figure(e, p); return [p.id, f ? [f.first, f.last, f.sow, f.through, Math.round(f.units * 1e6) / 1e6, f.unit, f.price].join('/') : '']; })); })()"
WORTH = "LRFForecast.build(LRFApp.state.engine).rows.reduce((n, r) => n + r.worth, 0)"
# A planting in a soil bed with no figures of its own, picked over a set number of days, with a variety (see the Node test).
SUBJECT = """(() => { const e = LRFApp.state.engine, has = (p, k) => p[k] != null && p[k] !== '';
  for (const p of LRFApp.state.plan.plantings) { if (p.liveTray || p.done || has(p, 'yield') || has(p, 'hw') || has(p, 'price') || has(p, 'turnover') || p.harvestMode || p.harvestEnd || p.established || !p.varietyId) continue;
    const r = e.calc(p), b = e.bedOf(p.bedId); if (!r || !b || !e.isSoilBed(b) || e.isStandingCrop(p, r) || r.harvestMode !== 'window' || r.harvestDays < 10 || r.harvestDays !== r.expectedHarvestDays) continue;
    const y = e.yieldOf(p, r); if (!y || !(y.units > 0)) continue; const h = e.harvestFor(p.cropId);
    return { id: p.id, cropId: p.cropId, crop: e.crop(p.cropId).name, varietyId: p.varietyId, variety: e.variety(p.varietyId).name, env: e.envOf(b), per: y.per, price: y.price, unit: y.unit, days: r.harvestDays, nominal: h.nominal, turnover: e.turnoverFor(p),
      followers: LRFApp.state.plan.plantings.filter(q => q.cropId === p.cropId && !q.liveTray && !has(q, 'yield') && e.envOf(e.bedOf(q.bedId)) === e.envOf(b)).map(q => q.id), priced: LRFApp.state.plan.plantings.filter(q => q.cropId === p.cropId && !has(q, 'price')).map(q => q.id) }; }
  return null; })()"""
CLIPPED = """(() => { const bad = [];
  for (const el of document.querySelectorAll('#ahTable th, #ahBody .as-name b, #ahBody .as-fixed, #ahBody .ah-comes b, #ahBody .ah-comes small, #ahOpen b, .as-mode button, #asAudit b, #asAudit i, #auditDlg th, #auditDlg .au-n, #auFigs b, #auFigs i, #orderDlg .od-head b, #orderDlg .od-head .btn, #orderDlg .od-n, #orderDlg .od-size, #odTotal, #sdOrder, .hv-series button')) {
    if (!el.getClientRects().length) continue; if (el.scrollWidth > el.clientWidth + 1) bad.push([el.className || el.tagName, el.textContent.slice(0, 40), el.scrollWidth, el.clientWidth]); }
  for (const el of document.querySelectorAll('#ahBody select.as-from, #auditDlg select')) { if (!el.getClientRects().length) continue; const o = el.selectedOptions[0], c = document.createElement('canvas').getContext('2d'), cs = getComputedStyle(el); c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if (o && c.measureText(o.textContent).width + 26 > el.getBoundingClientRect().width + 1) bad.push(['select', o.textContent, Math.round(c.measureText(o.textContent).width), Math.round(el.getBoundingClientRect().width)]); }
  // a number typed, or its grey default, must fit its box
  for (const el of document.querySelectorAll('#ahBody .as-cell input')) { if (!el.getClientRects().length) continue; const text = el.value || el.placeholder, c = document.createElement('canvas').getContext('2d'), cs = getComputedStyle(el); c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if (c.measureText(text).width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) > el.getBoundingClientRect().width + 1) bad.push(['input', text, Math.round(c.measureText(text).width), Math.round(el.getBoundingClientRect().width)]); }
  // nothing may spill out of its own cell into the next column
  for (const el of document.querySelectorAll('#ahBody .as-nc, #ahBody select, #ahBody .as-cell input, #ahBody .ah-comes b, #ahBody .ah-comes small, #ahBody .as-fixed, #orderDlg .od-amt input, #orderDlg td b')) { if (!el.getClientRects().length) continue; const td = el.closest('td').getBoundingClientRect(), r = el.getBoundingClientRect();
    if (r.right > td.right + 0.6 || r.left < td.left - 0.6) bad.push(['spills', (el.textContent || el.value || el.placeholder || el.className).slice(0, 40), Math.round(r.right), Math.round(td.right)]); }
  const view = document.getElementById('assumeView');
  return { bad: bad.slice(0, 6), count: bad.length, sideways: view.scrollWidth > view.clientWidth + 1 }; })()"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = browser.new_context(viewport={'width': WIDTH, 'height': 860}, color_scheme='dark' if DARK else 'light', service_workers='block')
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    page = ctx.new_page()
    if BACKUP:
        page.route('**/*', lambda r: r.continue_() if r.request.url.startswith('http://127.0.0.1') else r.abort())
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    ev = page.evaluate

    def ready():
        page.wait_for_function('window.LRFApp && LRFApp.state.ready', timeout=90000)
        if BACKUP and page.evaluate('LRFApp.isSample()'):
            page.set_input_files('#importFile', BACKUP)
            page.wait_for_function("!LRFApp.isSample() && LRFThumbs.count() > 100", timeout=240000)
            page.evaluate('document.fonts.ready'); page.wait_for_timeout(1500)
            page.evaluate("LRFApp.state.undo.length = 0; LRFApp.state.redo.length = 0; document.getElementById('toast').classList.remove('show')")
        page.wait_for_function('!LRFApp.isSample()', timeout=90000)

    def settle(ms=350):
        page.wait_for_timeout(ms)

    def toast():
        return ev("document.getElementById('toast').classList.contains('show') ? document.getElementById('toast').textContent : ''")

    def asking():
        return ev("(() => { const d = [...document.querySelectorAll('dialog.dialog[open]')].find(x => x.id !== 'auditDlg' && x.id !== 'orderDlg'); return d ? { title: d.querySelector('h2').textContent, body: d.querySelector('p').textContent } : null; })()")

    def answer(yes):
        page.click("dialog.dialog[open]:not(#auditDlg):not(#orderDlg) .dialog-actions .btn%s" % ('.primary' if yes else ':not(.primary)'))
        settle()

    def appears(selector, ms=4000):
        try:
            page.wait_for_selector(selector, timeout=ms); return True
        except Exception:
            return False

    def typed(key, value):
        """Type into a cell of the second table as a person would, and leave it. Answers yes if the planner asks first. Returns what it asked."""
        sel = '#ahBody [data-hk="%s"]' % key
        page.fill(sel, str(value)); page.press(sel, 'Tab'); settle(450)
        asked = asking()
        if asked:
            answer(True)
        return asked

    def chosen(key, value):
        page.select_option('#ahBody [data-hk="%s"]' % key, value); settle(450)
        asked = asking()
        if asked:
            answer(True)
        return asked

    def undo():
        ev("LRFApp.undo()"); settle()

    def shot(name):
        page.screenshot(path=os.path.join(shots, '%s-%d-%s.png' % (name, WIDTH, 'dark' if DARK else 'light')))

    page.goto(url); ready()
    key0, figs0, worth0, steps0 = ev("LRFApp.contentKey()"), ev(FIGS), ev(WORTH), ev("LRFApp.state.undo.length")
    S = ev(SUBJECT)
    check('(the plan has a bed planting with no figures of its own to test with)', bool(S), S)
    cid, env = S['cropId'], S['env']

    # ── the second table opens in place ──
    ev("LRFApp.setView('assume')"); settle(900)
    start = ev("({ days: !document.getElementById('asTable').hidden, harvest: !document.getElementById('ahTable').hidden, title: document.getElementById('asTitle').textContent, pressed: document.querySelector('[data-as-mode=\"days\"]').getAttribute('aria-pressed') })")
    check('the Assumptions view opens on days to harvest, as before', start == {'days': True, 'harvest': False, 'title': 'Days to first harvest', 'pressed': 'true'}, start)
    page.click('[data-as-mode="harvest"]'); settle(900)
    seen = ev("""(() => { const e = LRFApp.state.engine, rows = [...document.querySelectorAll('#ahBody tr.as-crop')];
      return { days: !document.getElementById('asTable').hidden, harvest: !document.getElementById('ahTable').hidden, title: document.getElementById('asTitle').textContent, heads: document.querySelectorAll('#ahHead th').length, rows: rows.length,
        mine: +document.querySelector('[data-as-scope="mine"] small').textContent, cells: rows.every(r => r.children.length === 13), set: document.querySelectorAll('#ahBody .mine').length, hints: document.getElementById('asHints').hidden, audit: !!document.getElementById('asReview') }; })()""")
    check('“Yield and price” shows the second table in the same view, and hides the first', seen['harvest'] and not seen['days'] and seen['title'] == 'Yield and price' and seen['hints'] and seen['audit'], seen)
    check('a row for each of my crops, thirteen columns each', seen['heads'] == 13 and seen['rows'] == seen['mine'] and seen['rows'] > 0 and seen['cells'], seen)
    check('with no list, nothing in it is marked as mine', seen['set'] == 0 or ev("!!LRFApp.state.plan.assumptions"), seen)
    check('looking changes nothing', ev("LRFApp.contentKey()") == key0 and ev("LRFApp.state.undo.length") == steps0)
    row = ev("""(() => { const e = LRFApp.state.engine, h = e.harvestFor('%s'), tr = document.querySelector('#ahBody tr[data-crop="%s"]'), q = k => tr.querySelector('[data-hk="' + k + '"]'), fig = LRFAssume.fig;
      return { price: q('price|%s').placeholder === fig(h.price.fallback), unit: q('unit|%s').value === h.unit.value, pick: q('pick|%s').value === 'spread', days: q('days|%s').placeholder === String(h.days.fallback), y: q('y|crops|%s|%s').placeholder === fig(h.cells['%s'].fallback),
        share: q('share|%s').placeholder === String(h.share.fallback), keep: q('keep|%s').placeholder === '0', turn: q('turn|%s').placeholder === String(h.turnover.fallback), empty: [...tr.querySelectorAll('input')].every(i => i.value === ''), comes: tr.querySelector('.ah-comes').textContent }; })()""" % ((cid,) * 7 + (env, env) + (cid,) * 3))
    check('grey is what the plan uses now: every cell of a crop’s row shows the crop’s own figure, and none is typed', all(row[k] for k in ['price', 'unit', 'pick', 'days', 'y', 'share', 'keep', 'turn', 'empty']), row)
    marks = ev("""(() => { const e = LRFApp.state.engine, rows = [...document.querySelectorAll('#ahBody tr.as-crop')], open = rows.filter(r => { const h = e.harvestFor(r.dataset.crop); return h.open.yield; }), price = rows.filter(r => e.harvestFor(r.dataset.crop).open.price);
      const said = r => [...r.querySelectorAll('small.as-guess')].map(x => x.textContent); const note = document.getElementById('ahOpen');
      return { open: open.length, price: price.length, marked: open.every(r => said(r).some(t => /yield/.test(t))) && price.every(r => said(r).includes('no price')), others: rows.filter(r => !open.includes(r)).every(r => !said(r).some(t => /yield/.test(t))), note: note.hidden ? '' : note.textContent }; })()""")
    check('a yield nobody has checked, and a crop with no price, are marked in the row and counted above the table', marks['marked'] and marks['others'] and ((marks['open'] + marks['price'] == 0 and marks['note'] == '') or ((str(marks['open']) in marks['note'] or marks['open'] == 0) and (str(marks['price']) in marks['note'] or marks['price'] == 0))), marks)
    micro = ev("(() => { const e = LRFApp.state.engine, tr = [...document.querySelectorAll('#ahBody tr.as-crop')].find(r => e.crop(r.dataset.crop).micro); return tr ? { inputs: tr.querySelectorAll('input').length, selects: tr.querySelectorAll('select').length, unit: tr.children[1].textContent } : null; })()")
    check('a tray crop’s row has its price to set and nothing else', micro is None or micro == {'inputs': 1, 'selects': 0, 'unit': 'tray'}, micro)
    clip = ev(CLIPPED)
    check('nothing in the table is clipped, spills out of its cell, or pushes the page sideways', clip['count'] == 0 and not clip['sideways'], clip)
    shot('3b-table')

    # ── a price ──
    price = round(S['price'] + 1.25, 2)
    typed('price|%s' % cid, price)
    t = toast()
    got = ev("(() => { const e = LRFApp.state.engine; return { prices: %s.map(id => e.yieldOf(e.planting(id)).price), line: ((LRFApp.state.plan.assumptions || {}).sell || {})['%s'], mine: document.querySelector('#ahBody [data-hk=\"price|%s\"]').closest('td').classList.contains('mine'), steps: LRFApp.state.undo.length, count: document.getElementById('asCount').textContent }; })()" % (json.dumps(S['priced']), cid, cid))
    check('a price typed on a crop’s row is used by every planting of the crop with no price of its own', got['line'] == {'price': price} and all(abs(p - price) < 1e-9 for p in got['prices']) and got['mine'], got)
    check('it is one step, said in a toast with what it does to the season’s worth', got['steps'] == steps0 + 1 and S['crop'] in t and 'season’s worth goes from' in t and abs(ev(WORTH) - worth0) > 0.4, t)
    check('the line under the search counts it', 'other figure' in got['count'], got['count'])
    undo()
    check('one undo takes the price back', ev("LRFApp.contentKey()") == key0 and abs(ev(WORTH) - worth0) < 1e-6)

    # ── a yield, in one growing condition ──
    y = S['nominal'] * 1.0
    typed('y|crops|%s|%s' % (cid, env), y)
    t = toast()
    got = ev("(() => { const e = LRFApp.state.engine; return { per: %s.map(id => e.yieldOf(e.planting(id)).per), by: %s.map(id => e.yieldOf(e.planting(id)).by), cell: (((LRFApp.state.plan.assumptions || {}).crops || {})['%s'] || {})['%s'], comes: document.querySelector('#ahBody tr[data-crop=\"%s\"] .ah-comes').textContent }; })()" % (json.dumps(S['followers']), json.dumps(S['followers']), cid, env, cid))
    figs1 = ev(FIGS)
    moved = [k for k in figs0 if figs0[k] != figs1[k]]
    check('a yield typed for one growing condition is used there by every planting of the crop with none of its own', got['cell'] == {'yield': y} and all(abs(p - y) < 1e-9 for p in got['per']), got)
    check('and by no other planting: own yields, other conditions and other crops stand', sorted(moved) == sorted(S['followers']) and all(figs0[k].split('/')[:4] == figs1[k].split('/')[:4] for k in figs0), {'moved': len(moved), 'followers': len(S['followers'])})
    check('the toast says what it does to the season’s worth, and that no date changes is not news', S['crop'] in t and 'season’s worth' in t, t)

    # ── a total, or a week's picking ──
    chosen('pick|%s' % cid, 'weekly')
    wk = ev("(() => { const e = LRFApp.state.engine, a = LRFApp.state.plan.assumptions; return { cell: a.crops['%s']['%s'].yield, pattern: a.sell['%s'].pattern, shown: document.querySelector('#ahBody [data-hk=\"y|crops|%s|%s\"]').value, comes: document.querySelector('#ahBody tr[data-crop=\"%s\"] .ah-comes').textContent, units: e.yieldOf(e.planting('%s')).units, weekly: e.yieldOf(e.planting('%s')).perWeek }; })()" % (cid, env, cid, cid, env, cid, S['id'], S['id']))
    before_units = float(figs1[S['id']].split('/')[4])
    check('“Each week” turns the yield already typed into a week’s picking, over the crop’s harvest days', wk['pattern'] == 'weekly' and abs(wk['cell'] - 7.0) < 1e-9 and wk['shown'] == '7' and abs(wk['weekly'] - 7.0) < 1e-9, wk)
    check('so the choice of words does not change what a planting picked for those days is forecast to give', abs(wk['units'] - before_units) < 1e-4 and '×' in wk['comes'], {'before': before_units, 'after': wk['units'], 'comes': wk['comes']})
    chosen('pick|%s' % cid, 'unset')
    back = ev("(() => { const a = LRFApp.state.plan.assumptions; return { cell: a.crops['%s']['%s'].yield, sell: (a.sell || {})['%s'] || null }; })()" % (cid, env, cid))
    check('and back again gives the total back', abs(back['cell'] - y) < 1e-9 and back['sell'] is None, back)
    typed('y|crops|%s|%s' % (cid, env), '')
    check('clearing the cell goes back to grey, and an empty list is no list', ev("LRFApp.contentKey()") == key0 and ev("!LRFApp.state.plan.assumptions"))
    # the keyboard: Tab from a cell lands in the next one, and the redraw does not lose the place
    page.fill('#ahBody [data-hk="share|%s"]' % cid, '80'); page.press('#ahBody [data-hk="share|%s"]' % cid, 'Tab'); settle(500)
    focus = ev("(document.activeElement && document.activeElement.dataset.hk) || ''")
    check('Tab from a cell moves to the next cell, and the redraw keeps the place', focus == 'keep|%s' % cid, focus)
    undo()

    # ── harvest days ──
    d = S['days'] + 5
    asked = typed('days|%s' % cid, d)
    t = toast()
    figs2 = ev(FIGS)
    later = [k for k in figs0 if figs0[k].split('/')[1] != figs2[k].split('/')[1]]
    exp = ev("LRFApp.state.plan.plantings.filter(p => p.cropId === '%s' && !p.liveTray && (p.hw == null || p.hw === '') && !p.harvestMode && !(p.towerCycle && p.towerCycle.v === 1)).map(p => p.id)" % cid)
    check('harvest days typed on a crop’s row move the last harvest of its plantings that have none of their own, and of nothing else', len(later) > 0 and set(later) <= set(exp) and all(figs0[k].split('/')[0] == figs2[k].split('/')[0] for k in figs0), {'later': len(later), 'expected': len(exp)})
    check('what moves is said: asked first where ground ends up booked twice, in the toast otherwise', (asked and 'booked into the same ground' in asked['body']) or ('harvest ends on another day' in t or 'planting' in t), {'asked': asked, 'toast': t})
    undo()
    check('one undo takes the harvest days back', ev("LRFApp.contentKey()") == key0)

    # ── turnover that settles double bookings ──
    turn = ev("""(() => { const e = LRFApp.state.engine, has = (p, k) => p[k] != null && p[k] !== '', by = new Map(), pairs = LRFAudit.pairs(e);
      for (const k of pairs) { const [a, b] = k.split('|').map(id => e.planting(id)), ra = e.calc(a), rb = e.calc(b), [x, rx, ry] = ra.field <= rb.field ? [a, ra, rb] : [b, rb, ra]; if (ry.field > rx.last && !has(x, 'turnover')) by.set(x.cropId, (by.get(x.cropId) || 0) + 1); }
      const best = [...by].sort((a, b) => b[1] - a[1])[0]; return best ? { cropId: best[0], n: best[1], pairs: pairs.size, shown: !!document.querySelector('#ahBody tr[data-crop="' + best[0] + '"]') } : null; })()""")
    if turn and turn['shown']:
        typed('turn|%s' % turn['cropId'], 0)
        t = toast()
        now = ev("LRFAudit.pairs(LRFApp.state.engine).size")
        check('turnover days that settle double bookings say how many they settle', now == turn['pairs'] - turn['n'] and ('%d double booking' % turn['n']) in t and 'settled' in t, {'toast': t, 'now': now, 'turn': turn})
        undo()
        check('and one undo brings them back', ev("LRFAudit.pairs(LRFApp.state.engine).size") == turn['pairs'] and ev("LRFApp.contentKey()") == key0)
    else:
        check('(no double booking in this plan is turnover only)', True)

    # ── a variety's own unit and price ──
    page.click('#ahBody tr[data-crop="%s"] button.as-more' % cid); settle(600)
    vrow = ev("(() => { const tr = document.querySelector('#ahBody tr.as-var[data-variety=\"%s\"]'); return tr ? { cells: tr.children.length, inputs: tr.querySelectorAll('input').length, unit: tr.querySelector('select').value } : null; })()" % S['varietyId'])
    check('opening a crop shows its varieties, each with a unit, a price and its yields, indented under the crop', vrow is not None and vrow['cells'] == 13 and vrow['unit'] == '' and vrow['inputs'] >= 2 and ev("(() => { const c = document.querySelector('#ahBody tr[data-crop=\"%s\"] .as-nc').getBoundingClientRect().left, v = document.querySelector('#ahBody tr.as-var[data-variety=\"%s\"] .as-nc').getBoundingClientRect().left; return v >= c; })()" % (cid, S['varietyId'])), vrow)
    typed('vprice|%s' % S['varietyId'], round(S['price'] + 2, 2))
    chosen('vunit|%s' % S['varietyId'], 'pint')
    v = ev("(() => { const e = LRFApp.state.engine, y = e.yieldOf(e.planting('%s')), rows = LRFForecast.build(e).rows.filter(r => r.cropId === '%s').map(r => r.unit), sis = LRFApp.state.plan.plantings.find(p => p.cropId === '%s' && p.varietyId !== '%s' && !p.liveTray && (p.price == null || p.price === '')); return { unit: y.unit, price: y.price, rows, sister: sis ? e.yieldOf(sis).unit + '/' + e.yieldOf(sis).price : null }; })()" % (S['id'], cid, cid, S['varietyId']))
    check('a variety’s own unit and price are used for its plantings only, in a forecast row of their own', v['unit'] == 'pint' and abs(v['price'] - round(S['price'] + 2, 2)) < 1e-9 and 'pint' in v['rows'] and (v['sister'] is None or v['sister'] == '%s/%s' % (S['unit'], S['price'])), v)
    undo(); undo()
    check('two undos take the variety’s line back', ev("LRFApp.contentKey()") == key0)
    page.click('#ahBody tr[data-crop="%s"] button.as-more' % cid); settle(400)

    # ── a crop that keeps: To sell and Picked in the Harvest view ──
    ev("LRFApp.setView('harvest')"); settle(1200)
    check('with nothing keeping, the Harvest view has one way of counting', ev("!document.querySelector('.hv-series')"))
    ev("LRFApp.setView('assume')"); settle(600)
    chosen('pick|%s' % cid, 'once'); typed('keep|%s' % cid, 4)
    ev("LRFApp.setView('harvest')"); settle(1400)
    hv = ev("""(() => { const m = LRFHarvestView.model(), row = m.rows.find(r => r.cropId === '%s'), seg = document.querySelector('.hv-series'), tr = document.querySelector('#hvTable tr.hv-row[data-crop="%s"]');
      return { seg: seg ? [...seg.querySelectorAll('button')].map(b => b.textContent + ':' + b.getAttribute('aria-pressed')) : null, keeps: m.keeps, rowKeeps: row.keeps, differ: Array.from(row.days).some((v, i) => Math.abs(v - row.picked[i]) > 1e-9), cells: tr ? [...tr.querySelectorAll('td.hv-c')].map(c => c.textContent).join('|') : '' }; })()""" % (cid, cid))
    check('a crop that keeps brings “To sell” and “Picked” to the Harvest view, opening on what there is to sell', hv['seg'] == ['To sell:true', 'Picked:false'] and hv['keeps'] and hv['rowKeeps'] == 4 and hv['differ'], hv)
    page.click('.hv-series [data-hv-series="picked"]'); settle(700)
    hv2 = ev("(() => { const tr = document.querySelector('#hvTable tr.hv-row[data-crop=\"%s\"]'); return { cells: tr ? [...tr.querySelectorAll('td.hv-c')].map(c => c.textContent).join('|') : '', series: LRFHarvestView.series() }; })()" % cid)
    check('“Picked” shows what comes out of the ground: a different row of figures for that crop', hv2['series'] == 'picked' and hv2['cells'] != hv['cells'], {'sell': hv['cells'][:120], 'picked': hv2['cells'][:120]})
    check('the Harvest view’s buttons are not clipped', ev(CLIPPED)['count'] == 0, ev(CLIPPED))
    shot('3b-harvest')
    page.click('.hv-series [data-hv-series="days"]'); settle(300)
    undo(); undo()
    check('two undos take the pattern and the keeping back', ev("LRFApp.contentKey()") == key0)

    # ── the review window: yield, harvest days, turnover, copies ──
    ev("LRFApp.setView('assume')"); settle(900)
    summary = ev("(() => { const s = LRFApp.auditSurvey().harvest, host = document.getElementById('asAudit'), figs = Object.fromEntries([...host.querySelectorAll('.au-figs span')].map(x => [x.querySelector('i').textContent, x.querySelector('b').textContent.replace(/,/g, '')])); return { s, figs, line: (document.getElementById('asHarvestLine') || {}).textContent || '', fine: host.querySelector('.au-fine').textContent }; })()")
    sv = summary['s']
    check('the summary counts plantings with their own yield, harvest days and turnover, and says tower cycles are left alone', summary['figs'].get('own yield') == str(sv['yield']) and summary['figs'].get('own harvest days') == str(sv['window']) and summary['figs'].get('own turnover') == str(sv['turnover']) and (sv['cycles'] == 0 or summary['figs'].get('tower cycles') == str(sv['cycles'])) and 'Still to come' not in summary['fine'], summary)
    study = ev("(() => { const s = LRFApp.auditStudy(), later = s.rows.filter(r => ['yield', 'window', 'turn', 'copy'].includes(r.kind)); return { kinds: Object.fromEntries(['yield', 'window', 'turn', 'copy'].map(k => [k, later.filter(r => r.kind === k).length])), differ: (later.find(r => r.kind === 'yield' && !r.agrees && r.take) || {}).key || '', n: later.length, all: s.rows.length }; })()")
    if study['n']:
        page.evaluate("LRFAssume.auditView({ by: 'kind', all: true })"); page.click('#asReview'); check('the review window opens', appears('#auditDlg[open]')); settle(900)
        dlg = ev("""(() => { const d = document.getElementById('auditDlg'), secs = [...d.querySelectorAll('tr.au-sec b')].map(b => b.textContent), rows = [...d.querySelectorAll('tr.au-row')];
          const later = rows.filter(r => ['yield', 'window', 'turn', 'copy'].includes(r.dataset.kind));
          return { secs, rows: rows.length, later: later.length, effects: [...new Set(later.map(r => r.querySelector('.au-effect').textContent.replace(/ · .*/, '')))], figs: Object.fromEntries([...d.querySelectorAll('#auFigs span')].map(x => [x.querySelector('i').textContent, x.querySelector('b').textContent])), worth: document.getElementById('auWorth').textContent, moving: later.filter(r => r.querySelector('.au-effect').classList.contains('moves')).length, crops: !!document.getElementById('auCrops') }; })()""")
        want = [name for kind, name in [('yield', 'Yield'), ('window', 'Harvest days'), ('turn', 'Turnover days'), ('copy', 'Copied crop values')] if study['kinds'][kind]]
        check('it has a section for each kind of figure the plan keeps on plantings, a row for each group', all(w in dlg['secs'] for w in want) and dlg['rows'] == study['all'] and dlg['later'] == study['n'], {'secs': dlg['secs'], 'want': want, 'rows': dlg['rows'], 'all': study['all']})
        check('as suggested, nothing changes: no date, no yield, no worth, no double booking', dlg['figs'].get('harvest dates moved') == '0' and dlg['figs'].get('new double bookings') == '0' and '→' not in dlg['worth'] and dlg['moving'] == 0 and not dlg['crops'] and set(dlg['effects']) <= {'nothing changes', 'stays as it is'}, dlg)
        clip = ev(CLIPPED)
        check('nothing in the window is clipped', clip['count'] == 0, clip)
        ev("document.querySelector('#auditDlg tr.au-row[data-kind=\"yield\"], #auditDlg tr.au-row[data-kind=\"window\"]').scrollIntoView({ block: 'start' })"); settle(300)
        shot('3b-review')
        if study['differ']:
            sel = '#auditDlg select[data-row="%s"]' % study['differ'].replace('"', '\\"')
            page.select_option(sel, 'follow'); settle(700)
            alt = ev("(() => { const d = document.getElementById('auditDlg'), tr = d.querySelector('tr.au-row[data-key=\"%s\"]'); return { effect: tr.querySelector('.au-effect').textContent, moves: tr.querySelector('.au-effect').classList.contains('moves'), worth: document.getElementById('auWorth').textContent, crops: (document.getElementById('auCrops') || {}).textContent || '', bad: document.getElementById('auWorth').classList.contains('bad') }; })()" % study['differ'].replace('"', '\\"'))
            check('using the list’s yield instead says, before anything changes, what it does to the yield and to the season’s worth', 'yield' in alt['effect'] and '→' in alt['effect'] and alt['moves'] and ('→' in alt['worth']) == alt['bad'] and alt['crops'] != '', alt)
            check('still nothing has changed', ev("LRFApp.contentKey()") == key0)
            page.click('#auSuggested'); settle(600)
            check('“Suggested” puts the choices back', ev("document.querySelector('#auditDlg select[data-row=\"%s\"]').value" % study['differ'].replace('"', '\\"')) == 'take' and '→' not in ev("document.getElementById('auWorth').textContent"))
        page.click('#auClose'); settle(300)
        check('× closes the window and changes nothing', ev("!document.getElementById('auditDlg')") and ev("LRFApp.contentKey()") == key0)
        page.evaluate("LRFAssume.auditView({ by: 'kind', all: true })"); page.click('#asReview'); appears('#auditDlg[open]'); settle(500); page.keyboard.press('Escape'); settle(300)
        check('Escape does the same', ev("!document.getElementById('auditDlg')") and ev("LRFApp.contentKey()") == key0)
        # apply only the new kinds, as suggested: the days rows are kept, so this part stands apart from step 3a's
        page.evaluate("LRFAssume.auditView({ by: 'kind', all: true })"); page.click('#asReview'); appears('#auditDlg[open]'); settle(600)
        ev("(() => { for (const s of document.querySelectorAll('#auditDlg tr.au-row')) { if (['days', 'weeks', 'wait'].includes(s.dataset.kind)) { const sel = s.querySelector('select'); sel.value = 'keep'; sel.dispatchEvent(new Event('change', { bubbles: true })); } } })()"); settle(900)
        head = ev("document.getElementById('auHead').textContent")
        snaps0 = ev("(async () => (await LRFApp.snapshots()).rows.filter(x => x.name === 'Before plantings followed the list').length)()")
        stepsA = ev("LRFApp.state.undo.length")
        page.click('#auApply'); settle(2500)
        done = ev("(async () => { const A = LRFApp, s = A.auditSurvey().harvest, st = A.auditStudy().rows.filter(r => ['yield', 'window', 'turn'].includes(r.kind)); return { open: !!document.getElementById('auditDlg'), steps: A.state.undo.length, label: A.state.undo[A.state.undo.length - 1].label, snaps: (await A.snapshots()).rows.filter(x => x.name === 'Before plantings followed the list').length, left: st.length, keepOnly: st.every(r => r.choice === 'keep'), yield: s.yield, count: document.getElementById('asCount').textContent }; })()")
        t = toast()
        figs3 = ev(FIGS)
        check('Apply is one step, with the plan as it stood kept as a snapshot first', not done['open'] and done['steps'] == stepsA + 1 and done['snaps'] == snaps0 + 1 and 'follow' in done['label'] and done['label'].split(' ')[0] == head.split(' ')[0], {'done': done, 'head': head})
        check('nothing moved and nothing is forecast differently: every planting has the dates, the ground and the yield it had', figs3 == figs0 and abs(ev(WORTH) - worth0) < 1e-6 and 'no date moved' in t, {'toast': t, 'changed': len([k for k in figs0 if figs0[k] != figs3[k]])})
        check('only the rows that were to be kept are left to review', done['keepOnly'], done)
        page.click('[data-as-mode="harvest"]'); settle(700)
        taken = ev("(() => { const a = LRFApp.state.plan.assumptions || {}, cells = Object.entries(a.crops || {}).flatMap(([id, envs]) => Object.entries(envs).filter(([, c]) => c.yield != null).map(([env]) => 'y|crops|' + id + '|' + env)); return { cells: cells.length, marked: cells.filter(k => { const el = document.querySelector('#ahBody [data-hk=\"' + k + '\"]'); return !el || el.closest('td').classList.contains('mine'); }).length, count: document.getElementById('asCount').textContent }; })()")
        check('the figures the list took are on its lines, shown as yours', taken['cells'] == taken['marked'] and (taken['cells'] == 0 or 'yield' in taken['count']), taken)
        shot('3b-after')
        undo()
        check('one undo takes the whole step back', ev("LRFApp.contentKey()") == key0)
    else:
        check('(this plan keeps no yield, harvest days or turnover on plantings)', True)

    # ── the seed order sheet ──
    ev("LRFApp.setView('seeds')"); settle(1500)
    check('the Seeds view offers the order sheet, and its button is not clipped', ev("(() => { const b = document.getElementById('sdOrder'); return !!b && b.getClientRects().length > 0 && b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().right <= b.parentElement.getBoundingClientRect().right + 1; })()"))
    stepsO = ev("LRFApp.state.undo.length")
    page.click('#sdOrder'); check('the order sheet opens in place', appears('#orderDlg[open]')); settle(900)
    sheet = ev("""(() => { const o = LRFSeeds.order(), s = o.sheet(), d = document.getElementById('orderDlg');
      return { lines: s.lines, groups: s.groups.length, cost: s.cost, unpriced: s.unpriced, rows: d.querySelectorAll('tr[data-line]').length, heads: d.querySelectorAll('.od-group[data-supplier]:not([data-supplier="loose"])').length, total: document.getElementById('odTotal').textContent, notes: document.getElementById('odNotes').textContent,
        first: (s.groups.flatMap(g => g.lines).find(l => l.sized && l.cost != null) || {}).key || '', firstCost: (s.groups.flatMap(g => g.lines).find(l => l.sized && l.cost != null) || {}).cost || 0, group: s.groups[0] ? { key: s.groups[0].key || '-', n: s.groups[0].lines.length, keys: s.groups[0].lines.map(l => [l.row.stockKey + '|' + l.row.stockUnit, l.buy]) } : null,
        pairs: LRFAudit.pairs(LRFApp.state.engine).size, spare: ([...document.querySelectorAll('#odAdd option')].find(x => x.value) || {}).value || '' }; })()""")
    check('a line for every variety that is short, under its supplier, with the total', sheet['rows'] == sheet['lines'] and sheet['heads'] == sheet['groups'] and (sheet['lines'] == 0 or ('$' in sheet['total'] and str(sheet['lines']) in sheet['total'])), sheet)
    check('it says as of when, and that seed is counted twice where ground is booked twice', 'As of' in sheet['notes'] and (sheet['pairs'] == 0 or 'booked twice' in sheet['notes']), sheet['notes'])
    clip = ev(CLIPPED)
    check('nothing on the sheet is clipped', clip['count'] == 0, clip)
    shot('3b-order')
    if sheet['first']:
        sel = '#orderDlg [data-amount="%s"]' % sheet['first'].replace('"', '\\"')
        base = ev("document.querySelector('#orderDlg tr[data-line=\"%s\"] .od-cost').textContent" % sheet['first'].replace('"', '\\"'))
        page.fill(sel, '99999'); page.press(sel, 'Tab'); settle(600)
        more = ev("(() => ({ cost: document.querySelector('#orderDlg tr[data-line=\"%s\"] .od-cost').textContent, total: document.getElementById('odTotal').textContent }))()" % sheet['first'].replace('"', '\\"'))
        check('an amount typed on a line is what the line covers: its sizes, its cost and the total follow', more['cost'] != base and more['total'] != sheet['total'], more)
        page.fill(sel, ''); page.press(sel, 'Tab'); settle(600)
        check('clearing it goes back to the shortfall', ev("document.getElementById('odTotal').textContent") == sheet['total'])
    if sheet['spare']:
        page.select_option('#odAdd', sheet['spare']); page.fill('#odAddQty', '25'); page.click('#odAddBtn'); settle(700)
        check('a variety that is not short can be added, for a top-up', ev("LRFSeeds.order().sheet().lines") == sheet['lines'] + 1 and ev("document.querySelectorAll('#orderDlg tr[data-line]').length") == sheet['lines'] + 1)
        ev("(() => { const o = LRFSeeds.order(); for (const k of Object.keys(o.amounts)) delete o.amounts[k]; o.draw(); })()"); settle(400)
    text = ev("LRFSeeds.order().text()")
    check('the sheet as text has every supplier, the total and the date', 'seed to order' in text and ('Total:' in text or 'Nothing is short.' in text) and 'As of' not in text.split('\n')[0], text[:200])
    check('opening the sheet and typing on it has changed nothing in the plan', ev("LRFApp.contentKey()") == key0 and ev("LRFApp.state.undo.length") == stepsO)
    if sheet['group']:
        g = sheet['group']
        page.click('#orderDlg [data-ordered="%s"]' % g['key']); settle(1200)
        t = toast()
        after = ev("(() => { const st = LRFApp.stockNow(), s = LRFSeeds.order().sheet(); return { onOrder: %s.map(([k, n]) => [(st[k] || {}).onOrder || 0, n]), lines: s.lines, groups: s.groups.map(g => g.key || '-'), steps: LRFApp.state.undo.length, open: !!document.getElementById('orderDlg') }; })()" % json.dumps(g['keys']))
        check('“Mark as ordered” puts a supplier’s lines on order in the amounts shown, as one step, and they stop counting as short', after['steps'] == stepsO + 1 and after['open'] and all(a >= n - 1e-9 for a, n in after['onOrder']) and after['lines'] == sheet['lines'] - g['n'] and g['key'] not in after['groups'] and 'on order' in t, {'after': after, 'toast': t})
        undo(); settle(500)
        check('one undo takes the order back, and the sheet shows it short again', ev("LRFApp.contentKey()") == key0 and ev("LRFSeeds.order().sheet().lines") == sheet['lines'])
    page.keyboard.press('Escape'); settle(300)
    check('Escape closes the sheet', ev("!document.getElementById('orderDlg')"))
    page.click('#sdOrder'); appears('#orderDlg[open]'); settle(400); page.click('#odClose'); settle(300)
    check('× closes it too, and nothing has changed', ev("!document.getElementById('orderDlg')") and ev("LRFApp.contentKey()") == key0)

    # ── back where it started ──
    ev("LRFApp.setView('assume')"); settle(600); page.click('[data-as-mode="days"]'); settle(700)
    check('“Days to harvest” brings the first table back as it was', ev("!document.getElementById('asTable').hidden && document.getElementById('ahTable').hidden && document.getElementById('asTitle').textContent === 'Days to first harvest' && document.querySelectorAll('#asBody tr.as-crop').length > 0"))
    check('at the end the plan is the plan it began as', ev("LRFApp.contentKey()") == key0 and ev(FIGS) == figs0)
    check('no error on the page', not errors, errors[:3])
    browser.close()

print('\n'.join(results))
print(json.dumps({'passed': len(results) - len(failed), 'of': len(results), 'failed': failed}))
