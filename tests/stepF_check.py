"""Step F in a real browser: the series tool asked from the harvest end (so much wanted each week), what it shows before
anything is added, what Add and Undo do, the crop whose yield nobody has checked, the way in from the Harvest view, and that
looking changes nothing.
usage: python3 -I stepF_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1480, DARK=1, STOP_AT_FAIL=1
"""
import functools, http.server, json, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
target, shots = Path(sys.argv[1]), Path(sys.argv[2]); shots.mkdir(parents=True, exist_ok=True)
backup = sys.argv[3] if len(sys.argv) > 3 else None
WIDTH = int(os.environ.get("WIDTH", "1280")); DARK = os.environ.get("DARK") == "1"; STOP = os.environ.get("STOP_AT_FAIL") == "1"
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(target)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
results, failed, errors = [], [], []
def check(name, ok, detail=None):
    results.append({"name": name, "ok": bool(ok), **({"detail": detail} if detail is not None and not ok else {})})
    if not ok:
        failed.append(name)
        if STOP: finish()
def finish():
    print(json.dumps({"passed": len(results) - len(failed), "of": len(results), "failed": failed, "details": [r for r in results if not r["ok"]][:12], "errors": errors[:6]}, default=str))
    sys.stdout.flush(); os._exit(1 if failed else 0)
PRE = "const A = LRFApp, St = A.state, E = LRFEngine, S = LRFSuccession, F = LRFForecast, SR = LRFSeries, P = SR.state.P, $ = id => document.getElementById(id), eng = St.engine, year = A.planYear(), txt = id => $(id) ? $(id).textContent : null;"
# the series the page should be showing, worked out again from the form's own state
ASK = """const model = LRFHarvestView.model(), pc = S.pace(eng, { place: P.place, gardenIds: P.gardenIds, bedIds: P.bedIds, cropId: P.cropId, varietyId: P.varietyId || undefined, sourceId: P.sourceId || undefined, from: P.hFrom });
  const rows = model.rows.filter(r => r.cropId === P.cropId && r.unit === pc.unit), supply = (a, b) => rows.reduce((n, r) => n + F.sum(r.days, model.index(a), model.index(b)), 0);
  const res = S.series(eng, { cropId: P.cropId, varietyId: P.varietyId || undefined, sourceId: P.sourceId || undefined, place: P.place, gardenIds: P.gardenIds, bedIds: P.bedIds, unit: 'yield', want: P.want, from: P.hFrom, to: P.hTo, every: P.hEvery, net: P.net, supply: P.net ? supply : undefined });"""
SEEN = PRE + ASK + """ const lis = [...document.querySelectorAll('#srWaves li')];
  return { err: res.error || null, shownErr: txt('srError'), n: res.error ? 0 : res.plantings.length, m: res.error ? 0 : res.held.length, waves: res.error ? 0 : res.waves.length, covered: res.error ? 0 : res.sized.covered, feet: res.error ? 0 : Math.round(res.sized.feet),
    lis: lis.length, liCovered: lis.filter(l => l.dataset.state === 'covered').length, add: txt('srAdd'), addOff: $('srAdd') ? $('srAdd').disabled : null, sum: txt('srSum'), title: txt('srTitle'), rests: txt('srRests'), restsBy: $('srRests') ? $('srRests').dataset.by : null, by: res.error ? null : res.sized.rests.by,
    ghosts: SR.ghosts() ? SR.ghosts().placed.length : null, ghostsHeld: SR.ghosts() ? SR.ghosts().held.length : null, pc: { every: pc.every, unit: pc.unit, days: pc.days, open: pc.open }, P: { by: P.by, want: P.want, hFrom: P.hFrom, hTo: P.hTo, hEvery: P.hEvery, net: P.net, cropId: P.cropId, place: P.place } };"""
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 900}, color_scheme="dark" if DARK else "light")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready"); page.wait_for_timeout(900)
    if backup:
        page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
        if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
        page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(1200)
    js = lambda body: page.evaluate("(() => { " + PRE + " " + body + " })()")
    seen = lambda: page.evaluate("(() => { " + SEEN + " })()")
    wait = lambda ms=350: page.wait_for_timeout(ms)
    def fill(sel, value):   # a field a fault has removed is not typed into: the named line after it fails, and the check goes on
        loc = page.locator(sel)
        if not loc.count(): wait(100); return False
        loc.fill(str(value)); loc.dispatch_event("change"); wait(450); return True
    def click(sel):
        loc = page.locator(sel)
        if not loc.count(): wait(100); return False
        loc.first.click(); wait(450); return True
    has = lambda sel: page.locator(sel).count() > 0

    start = js("return { key: A.contentKey(), n: St.plan.plantings.length, w: A.waiting().length, undo: St.undo.length, bg: getComputedStyle(document.body).backgroundColor };")
    check('the page is light, whatever the computer says', start['bg'] in ('rgb(246, 244, 238)', 'rgb(247, 245, 240)') or sum(int(x) for x in start['bg'].replace('rgb(', '').replace(')', '').split(',')[:3]) > 600, start['bg'])
    subject = js("""const used = new Set(St.plan.plantings.map(p => p.cropId)), ok = c => !c.micro && !eng.isCoverCrop(c) && +c.dtm > 0 && !eng.harvestFor(c.id).open.yield && S.gardensFor(eng, c).some(g => g.kind === 'bed' && g.planted);
      const c = eng.crops().find(c => c.name === 'Radish' && ok(c)) || eng.crops().find(c => used.has(c.id) && ok(c) && c.yBasis === 'ft') || eng.crops().find(c => used.has(c.id) && ok(c));
      const open = eng.crops().find(c => used.has(c.id) && !c.micro && +c.dtm > 0 && eng.harvestFor(c.id).open.yield && S.gardensFor(eng, c).length), micro = eng.crops().find(c => c.micro && used.has(c.id));
      return { id: c && c.id, name: c && c.name, open: open && { id: open.id, name: open.name }, micro: micro && micro.id };""")
    check('there is a crop to plan to a weekly amount', bool(subject['id']), subject)
    if not subject['id']: finish()

    # ── the tool as it always opened: so many days apart ──
    page.click('[data-view-btn="timeline"]'); wait(500)
    js("void A.openAhead({ mode: 'series', cropId: '%s' });" % subject['id']); wait(700)
    first = js("return { by: P.by, pressed: [...document.querySelectorAll('#srBy button')].map(b => [b.dataset.by, b.getAttribute('aria-pressed'), b.textContent]), old: ['srFrom', 'srEvery', 'srEnd', 'srAmount'].every(id => !!$(id)), fresh: ['srWant', 'srHFrom', 'srHTo', 'srHEvery', 'srNet'].some(id => !!$(id)), title: txt('srTitle'), rests: !!$('srRests') };")
    check('the series tool opens as it always did: so many days apart, with its own fields', first['by'] == 'spacing' and first['old'] and not first['fresh'] and 'every' in (first['title'] or '') and not first['rests'], first)
    check('it offers the two ways of planning, the first one pressed', first['pressed'] == [['spacing', 'true', 'Every so many days'], ['harvest', 'false', 'To a weekly amount']], first['pressed'])
    spacing_sum = js("return txt('srSum');")

    # ── asked from the harvest end ──
    click('#srBy [data-by="harvest"]')
    a = seen()
    form = js("return { old: ['srFrom', 'srEvery', 'srEnd', 'srCount', 'srAmount', 'srUnit'].filter(id => !!$(id)), fresh: ['srWant', 'srWantUnit', 'srHFrom', 'srHTo', 'srHEvery', 'srNet'].filter(id => !$(id)), unit: $('srWantUnit') && $('srWantUnit').value, unitOff: $('srWantUnit') && $('srWantUnit').disabled, want: $('srWant') && +$('srWant').value, every: $('srHEvery') && +$('srHEvery').value, net: $('srNet') && $('srNet').checked, where: !!$('srPlace'), help: ($('srHEvery') && $('srHEvery').closest('label').querySelector('small') || {}).textContent };")
    check('asked for a weekly amount, the form asks how much, between which days and how far apart, and no longer how many or how large', form['old'] == [] and form['fresh'] == [] and form['where'] and form['unitOff'], form)
    check('it opens on something to look at: an amount, the crop’s own season, plantings as far apart as one is picked, what the plan gives taken off', a['P']['by'] == 'harvest' and form['want'] > 0 and a['P']['hFrom'] < a['P']['hTo'] and form['every'] == a['pc']['every'] and form['net'] is True and a['err'] is None and a['shownErr'] is None, [a['P'], a['pc'], a['err']])
    check('on its own season, with what the plan gives taken off, the stretches the plan already fills are left out and said so', a['liCovered'] == a['covered'] and a['lis'] == a['waves'] and (a['covered'] >= 1 or subject['name'] != 'Radish') and (a['add'] is None or ((str(a['n']) in a['add']) if a['n'] else ('to place' in a['add'] or 'Nothing' in a['add']))), [a['covered'], a['liCovered'], a['n'], a['m'], a['add']])
    check('the amount is in the unit the crop is sold by', bool(form['unit']) and (a['pc']['unit'] in form['unit'] or form['unit'].rstrip('es').rstrip('s') in a['pc']['unit'] or form['unit'] == 'each'), [form['unit'], a['pc']['unit']])
    check('the title says the crop and the amount each week', subject['name'] in (a['title'] or '') and 'a week' in (a['title'] or ''), a['title'])
    check('the help under the days apart says how long one planting is picked', 'picked' in (form['help'] or ''), form['help'])

    # a want of our own: enough that plantings are needed, on a stretch of summer
    yr = js("return year;")
    fill('#srHFrom', f'{yr}-06-14'); fill('#srHTo', f'{yr}-08-15')
    big = js("const pc = S.pace(eng, { place: P.place, gardenIds: P.gardenIds, bedIds: P.bedIds, cropId: P.cropId, from: P.hFrom }); return Math.max(2, Math.round(pc.per * (pc.soil ? pc.cap : 1) * 0.6 * 7 / pc.every));")
    fill('#srWant', big)
    click('#srNet')   # nothing taken off: every stretch gets its planting
    b = seen()
    check('with nothing taken off, every stretch asked for gets a planting or one to place', b['err'] is None and b['P']['net'] is False and b['covered'] == 0 and b['liCovered'] == 0 and b['n'] + b['m'] >= b['waves'] > 3, b)
    check('the list has a line for every stretch, and the button says what it would add', b['lis'] == b['waves'] and b['add'] is not None and (str(b['n']) in b['add'] if b['n'] else 'to place' in b['add']) and (b['m'] == 0 or 'to place' in b['add']), [b['lis'], b['waves'], b['add']])
    check('what it would plant is drawn dashed before anything is added: as many ghosts as plantings', b['ghosts'] == b['n'] and b['ghostsHeld'] == b['m'] and (b['n'] == 0 or page.locator('.tl-ghost-bar').count() > 0), [b['ghosts'], b['n'], page.locator('.tl-ghost-bar').count()])
    check('the summary says the plantings and the feet of bed', b['sum'] is not None and (b['n'] == 0 or ('planting' in b['sum'] and (b['feet'] == 0 or f"{b['feet']:,} ft of bed" in b['sum']))), [b['sum'], b['feet']])
    check('a line says what the sizes rest on, and whose figure that is', b['rests'] is not None and 'Sized at' in b['rests'] and 'to sell from' in b['rests'] and b['restsBy'] == b['by'] and ('your list' in b['rests'] or 'own record' in b['rests'] or 'planting copied' in b['rests']), [b['rests'], b['restsBy'], b['by']])
    check('nothing is in the plan yet', js("return St.plan.plantings.length;") == start['n'] and js("return St.undo.length;") == start['undo'])
    wave = js("""const li = document.querySelector('#srWaves li[data-wave="1"]'); return li ? { head: li.querySelector('b').textContent, asked: (li.querySelector('.sr-asked') || {}).textContent, when: (li.querySelector('.sr-when') || {}).textContent } : null;""")
    check('each line says the day it is first picked, what was wanted of it and what it gives', wave is not None and wave['head'] == 'Jun 14' and 'wanted' in (wave['asked'] or '') and ('give' in wave['asked'] or 'to place' in js("return document.querySelector('#srWaves li[data-wave=\"1\"]').textContent;")), wave)

    # the weeks, judged on the forecast with the plantings in it
    STRIP = ASK + """ const cells = id => [...document.querySelectorAll('#srStrip .ah-strip-row')][id].querySelectorAll('.ah-cells i');
      const eng2 = E.create({ ...St.plan, plantings: [...St.plan.plantings, ...res.plantings] }, LRFLibrary), after = F.build(eng2, { year }), i0 = model.index(res.waves[0].target), i1 = model.index(res.waves[res.waves.length - 1].window.to), cols = F.periods(model, 'week', i0, i1);
      const q = (m, c) => m.rows.filter(r => r.cropId === P.cropId && r.unit === pc.unit).reduce((n, r) => n + F.sum(r.days, Math.max(c.i0, i0), Math.min(c.i1, i1)), 0), want = +P.want;
      const st = (v, c) => { const asked = want * (Math.min(c.i1, i1) - Math.max(c.i0, i0) + 1) / 7; return v >= asked * (1 - S.NEAR) ? 'full' : v > 1e-9 ? 'part' : 'none'; };
      return { there: !!$('srStrip'), now: [...cells(0)].map(i => i.dataset.state), then: [...cells(1)].map(i => i.dataset.state), wantNow: cols.map(c => st(q(model, c), c)), wantThen: cols.map(c => st(q(after, c), c)), meet: txt('srMeet'), short: txt('srShort'), same: txt('srSame'), cls: [...cells(1)].map(i => i.className) };"""
    strip = js(STRIP)
    check('two rows of weeks, now and with the series: each week full, part or empty as the forecast has it', strip['there'] and strip['now'] == strip['wantNow'] and strip['then'] == strip['wantThen'] and len(strip['then']) >= 8, strip)
    check('a full week is solid and a week with less is pale', all((c == 'on') == (s == 'full') and (c == 'part') == (s == 'part') for c, s in zip(strip['cls'], strip['then'])), strip['cls'])
    full_now, full_then = strip['wantNow'].count('full'), strip['wantThen'].count('full')
    check('the line under them counts the full weeks, now and with the series', strip['meet'] is not None and f"{full_now} now, {full_then} with these, of {len(strip['then'])}" in strip['meet'], strip['meet'])
    check('weeks still short are named, when there are any', (strip['short'] is not None) == (full_then < len(strip['then'])), [strip['short'], full_then, len(strip['then'])])
    check('it says that days to harvest are the same in every month', strip['same'] is not None and 'same in every month' in strip['same'], strip['same'])
    check('the series fills weeks the plan left short', full_then > full_now or b['n'] == 0, [full_now, full_then])
    page.screenshot(path=str(shots / f"stepF-tool-{WIDTH}.png"))

    # fit: nothing clipped, nothing spilling, no sideways scroll in the panel
    fit = js("""const insp = document.querySelector('#srForm').closest('.inspector') || document.querySelector('#srForm').parentElement, bad = [];
      for (const el of insp.querySelectorAll('#srForm *, #srOut *')) { const cs = getComputedStyle(el); if (el.children.length === 0 || el.tagName === 'LABEL') { if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible' && el.tagName !== 'SELECT' && el.tagName !== 'INPUT') bad.push(['clipped', el.id || el.className || el.tagName, el.textContent.slice(0, 40)]); }
        const r = el.getBoundingClientRect(), box = insp.getBoundingClientRect(); if (r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1)) bad.push(['spills', el.id || el.className || el.tagName, Math.round(r.right - box.right)]); }
      return { bad: bad.slice(0, 6), sideways: insp.scrollWidth > insp.clientWidth + 1, seg: [...document.querySelectorAll('#srBy button')].map(b => b.scrollWidth <= b.clientWidth + 1) };""")
    check('nothing in the tool is clipped or spills out of the panel, and the panel does not scroll sideways', fit['bad'] == [] and not fit['sideways'] and all(fit['seg']), fit)

    # how far apart: closer overlaps, further leaves gaps, and the help says so
    every0 = b['P']['hEvery']
    fill('#srHEvery', max(2, int(b['pc']['every']) // 2)); near = seen(); help_near = js("return $('srHEvery').closest('label').querySelector('small').textContent;")
    check('closer together than one is picked gives more, smaller plantings, and the help says they overlap', near['err'] is None and near['waves'] > b['waves'] and ('overlap' in help_near or b['pc']['every'] <= 7) and f"every {b['pc']['every']} would follow" in help_near, [near['waves'], b['waves'], help_near])
    fill('#srHEvery', int(b['pc']['every']) * 2); far = seen(); help_far = js("return $('srHEvery').closest('label').querySelector('small').textContent;")
    check('further apart gives fewer, and the help says days are left with nothing', far['err'] is None and far['waves'] < b['waves'] and 'days with nothing' in help_far, [far['waves'], help_far])
    gaps = js("return [...document.querySelectorAll('#srStrip .ah-cells i')].map(i => [i.className, i.dataset.state]);")
    far_strip = js(STRIP)
    check('and each week is judged as the forecast has it: full only within a twentieth of the amount', far_strip['then'] == far_strip['wantThen'] and far_strip['now'] == far_strip['wantNow'], [far_strip['then'], far_strip['wantThen']])
    check('twice as far apart, weeks come up with less or nothing, and each is drawn as what it is: solid, pale or empty', any(st == 'part' for _, st in gaps) and all((c == 'on') == (st == 'full') and (c == 'part') == (st == 'part') and (c == '') == (st == 'none') for c, st in gaps) and js("return !!$('srShort');"), gaps[-12:])
    fill('#srHEvery', every0)
    fill('#srWant', ''); none = seen()
    check('with no amount it says so in words and offers nothing to add', none['shownErr'] is not None and 'How much each week' in none['shownErr'] and none['add'] is None and none['ghosts'] == 0, none)
    fill('#srWant', big)

    # what the plan gives, taken off again
    click('#srNet'); c = seen()
    check('taking off what the plan gives never asks for more plantings than not taking it off', c['P']['net'] is True and c['err'] is None and c['n'] + c['m'] <= b['n'] + b['m'] and c['lis'] == c['waves'] and c['liCovered'] == c['covered'], [c['n'], c['m'], b['n'], b['m'], c['covered']])
    click('#srNet')

    # held to place
    click('#srPlace [data-place="hold"]'); h = seen()
    check('asked to wait, every planting is to place, sized in feet, and none is drawn on a bed', h['err'] is None and h['n'] == 0 and h['m'] >= h['waves'] and 'to place' in (h['add'] or '') and h['ghosts'] == 0 and 'ft' in js("return document.querySelector('#srWaves li[data-wave=\"1\"]').textContent;"), h)
    click('#srPlace [data-place="gardens"]')

    # ── Add, and Undo ──
    d = seen()
    week_before = js(ASK + " return res.error ? null : { i0: model.index(res.waves[0].target), i1: model.index(res.waves[res.waves.length - 1].window.to), total: rows.reduce((n, r) => n + F.sum(r.days, model.index(res.waves[0].target), model.index(res.waves[res.waves.length - 1].window.to)), 0), units: res.units, unit: pc.unit };")
    click('#srAdd'); wait(500)
    added = js("const m = LRFHarvestView.model(); return { n: St.plan.plantings.length, w: A.waiting().length, undo: St.undo.length, done: txt('srDone'), label: St.undo.length ? St.undo[St.undo.length - 1].label : '', toast: $('toast').classList.contains('show') ? $('toast').firstChild.textContent : '' };")
    check('Add puts them in the plan as one step: the plantings on beds, the rest to place', added['n'] == start['n'] + d['n'] and added['w'] == start['w'] + d['m'] and added['undo'] == start['undo'] + 1 and added['done'] is not None, [added, d['n'], d['m']])
    check('the step is named for what was asked: the crop and the weekly amount', 'a week' in added['label'] and subject['name'].lower() in added['label'].lower(), added['label'])
    after_total = js("const m = LRFHarvestView.model(); return m.rows.filter(r => r.cropId === '%s' && r.unit === '%s').reduce((n, r) => n + F.sum(r.days, %d, %d), 0);" % (subject['id'], week_before['unit'], week_before['i0'], week_before['i1'])) if week_before else None
    check('the forecast for those weeks rises by what the plantings give in them', week_before is not None and (d['n'] == 0 or (after_total > week_before['total'] + 1e-6 and after_total <= week_before['total'] + week_before['units'] + 1e-6)), [week_before, after_total])
    click('#srUndo'); wait(400)
    back = js("return { key: A.contentKey(), n: St.plan.plantings.length, w: A.waiting().length, add: txt('srAdd') };")
    check('one Undo takes all of it out again, and the form is back as it was', back['key'] == start['key'] and back['n'] == start['n'] and back['w'] == start['w'] and back['add'] == d['add'], [back['n'], back['w'], back['add'], d['add']])

    # ── another crop in the same form keeps the way of planning ──
    other = js("const used = new Set(St.plan.plantings.map(p => p.cropId)); const c = eng.crops().find(c => c.id !== P.cropId && used.has(c.id) && !c.micro && !eng.isCoverCrop(c) && +c.dtm > 0 && !eng.harvestFor(c.id).open.yield && S.gardensFor(eng, c).some(g => g.planted)); return c && { id: c.id, name: c.name };")
    if other:
        page.select_option('#srCrop', other['id']); wait(600); o = seen()
        check('another crop chosen in the form is planned the same way, on its own amount and season', o['P']['by'] == 'harvest' and o['P']['cropId'] == other['id'] and other['name'] in (o['title'] or '') and float(o['P']['want']) > 0 and int(o['P']['hEvery']) == o['pc']['every'], [o['P'], o['title'], o['pc']])
    else: check('another crop chosen in the form is planned the same way, on its own amount and season', False, 'no other crop to try')

    # ── a crop standing on a yield nobody has checked ──
    if subject['open']:
        js("void A.openAhead({ mode: 'series', by: 'harvest', cropId: '%s' });" % subject['open']['id']); wait(700)
        u = js("return { err: txt('srError'), flag: $('srError') ? $('srError').dataset.unchecked : null, add: !!$('srAdd'), go: txt('srToYield'), ghosts: SR.ghosts() ? SR.ghosts().placed.length + SR.ghosts().held.length : 0, by: P.by, crop: P.cropId, rests: !!$('srRests') };")
        check('a crop standing on a yield nobody has checked is not sized: it says why and where to set it, and offers nothing to add', u['err'] is not None and 'nobody has checked' in u['err'] and u['flag'] == '1' and not u['add'] and u['ghosts'] == 0 and not u['rests'] and u['crop'] == subject['open']['id'] and u['by'] == 'harvest', u)
        check('a button goes to Yield and price', u['go'] == 'Open Yield and price', u['go'])
        click('#srBy [data-by="spacing"]')
        sp = js("return { err: txt('srError'), sum: txt('srSum'), add: !!$('srAdd') };")
        check('planned so many days apart, the same crop is planned as ever', sp['err'] is None or 'nobody has checked' not in sp['err'], sp)
        click('#srBy [data-by="harvest"]'); click('#srToYield'); wait(600)
        there = js("return { view: St.view, mode: LRFAssume.mode(), table: !!$('ahTable') };")
        check('and it lands on the second table of the Assumptions list', there['view'] == 'assume' and there['mode'] == 'harvest' and there['table'], there)
        js("LRFAssume.setMode('days'); A.select(null);")
    else:
        check('a crop standing on a yield nobody has checked is not sized: it says why and where to set it, and offers nothing to add', False, 'no such crop in this plan')

    # ── the way in from the Harvest view ──
    page.click('[data-view-btn="harvest"]'); wait(700)
    cell = page.locator(f'tr.hv-row[data-crop="{subject["id"]}"] td.hv-c')
    if cell.count():
        col = js("const th = document.querySelectorAll('table.hv thead th[data-col]'); return th.length ? th[Math.min(3, th.length - 1)].dataset.col : null;")
        cell.nth(min(3, cell.count() - 1)).click(); wait(400)
        check('the window that says where a figure comes from offers to plan the crop to a weekly amount', has('#hvFrom #hvPlan') and page.locator('#hvPlan').text_content().startswith('Plan to a weekly amount'))
        click('#hvPlan'); wait(700)
        hv = js("return { dialog: !!$('hvFrom'), sel: St.sel && St.sel.type, view: St.view, by: P.by, crop: P.cropId, from: P.hFrom, to: P.hTo, want: +P.want, title: txt('srTitle') };")
        check('it opens the tool on that crop, asked from the harvest end, from the week that was clicked', not hv['dialog'] and hv['sel'] == 'series' and hv['view'] in ('timeline', 'map') and hv['by'] == 'harvest' and hv['crop'] == subject['id'] and hv['from'] == col and hv['to'] > hv['from'] and hv['want'] > 0, [hv, col])
        page.keyboard.press('Escape'); wait(300)
        check('Escape closes the tool and adds nothing', js("return St.sel;") is None and js("return St.plan.plantings.length;") == start['n'])
    else:
        check('the window that says where a figure comes from offers to plan the crop to a weekly amount', False, 'the crop has no row in the Harvest view')
    if subject['micro']:
        page.click('[data-view-btn="harvest"]'); wait(600)
        mc = page.locator(f'tr.hv-row[data-crop="{subject["micro"]}"] td.hv-c')
        if mc.count():
            mc.nth(min(8, mc.count() - 1)).click(); wait(400)   # a cell clear of the names, which stay put over the first ones
            check('a tray crop is not offered it: trays are planned from weekly demand', has('#hvFrom') and not has('#hvPlan'))
            page.keyboard.press('Escape'); wait(200)
            if has('#hvFrom'): js("document.getElementById('hvFrom').close(); document.getElementById('hvFrom').remove();")

    # ── opened again with nothing said, it is so many days apart ──
    js("void A.openAhead({ mode: 'series', cropId: '%s' });" % subject['id']); wait(600)
    again = js("return { by: P.by, sum: txt('srSum'), old: !!$('srEvery') };")
    check('opened again from a crop, the tool is back to so many days apart, with what it showed before', again['by'] == 'spacing' and again['old'] and again['sum'] == spacing_sum, [again, spacing_sum])
    js("A.select(null);"); page.click('[data-view-btn="map"]'); wait(400)
    end = js("return { key: A.contentKey(), n: St.plan.plantings.length, w: A.waiting().length, sel: St.sel };")
    check('after all the looking the plan is what it was', end['key'] == start['key'] and end['n'] == start['n'] and end['w'] == start['w'], end)
    check('the page raised no error', errors == [], errors[:4])
    browser.close()
finish()
