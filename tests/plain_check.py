"""Preview 0.30 in a real browser: the Tasks view and how far ahead it lists, the words for where days are counted from and for how
a crop is picked, links read with nothing to set up, the one press that moves onto the list what changes nothing, and the window
that shows only what differs.
usage: python3 -I plain_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1480, DARK=1, STOP_AT_FAIL=1
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
PRE = "const A = LRFApp, St = A.state, E = LRFEngine, V = LRFSowView, $ = id => document.getElementById(id), eng = St.engine, year = A.planYear(), txt = id => $(id) ? $(id).textContent : null;"
SIG = "JSON.stringify(St.plan.plantings.map(p => { const r = St.engine.calc(p), y = r && St.engine.yieldOf(p, r); return [p.id, r ? E.d2s(r.field) : '', r ? E.d2s(r.first) : '', r ? E.d2s(r.last) : '', r && r.sow ? E.d2s(r.sow) : '', y ? Math.round(y.units * 1000) : 0, y ? y.price : 0]; }))"
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    def open_page(width, height=900):
        ctx = browser.new_context(viewport={"width": width, "height": height}, color_scheme="dark" if DARK else "light")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
        page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready"); page.wait_for_timeout(900)
        if backup:
            page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
            if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
            page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(1200)
        return ctx, page
    ctx, page = open_page(WIDTH)
    js = lambda body: page.evaluate("(() => { " + PRE + " " + body + " })()")
    wait = lambda ms=350: page.wait_for_timeout(ms)
    has = lambda sel: page.locator(sel).count() > 0
    def click(sel):
        loc = page.locator(sel)
        if not loc.count(): wait(100); return False
        loc.first.click(); wait(450); return True
    toast = lambda: page.evaluate("document.getElementById('toast').classList.contains('show') ? document.getElementById('toast').firstChild.textContent : ''")
    start = js("return { key: A.contentKey(), n: St.plan.plantings.length, undo: St.undo.length, sig: " + SIG + " };")

    # ── Tasks: the name, and how far ahead it lists ──
    nav = js("return [...document.querySelectorAll('nav.views [data-view-btn]')].map(b => b.textContent.trim());")
    check('the views are Map, Timeline, Harvest, Tasks, Nursery, Seeds, Assumptions (0.31: three groups, Trays is Nursery)', nav == ['Map', 'Timeline', 'Harvest', 'Tasks', 'Nursery', 'Seeds', 'Assumptions'], nav)
    js("A.setDate(new Date(year, 4, 5));"); page.click('[data-view-btn="sow"]'); wait(800)
    COUNT = """const now = LRFTrays.monday(E.d2s(St.date)), until = n => E.d2s(E.addDays(E.s2d(now), 7 * n - 1)), inSpan = n => l => l.week >= now && l.week <= until(n);
      const want = n => V.figures().list.filter(inSpan(n)).length + V.jobs().filter(l => inSpan(n)(l) && !l.passed).length;
      const rows = () => document.querySelectorAll('#swWrap section.sw-kind tr[data-line], #swWrap section.wk-kind tr[data-line]').length - document.querySelectorAll('#swWrap details.sw-earlier tr[data-line]').length;"""
    t1 = js(COUNT + " return { h2: txt('wkTitle'), eyebrow: document.querySelector('#swWrap .eyebrow').textContent, span: [...document.querySelectorAll('#wkSpan button')].map(b => [b.dataset.span, b.textContent, b.getAttribute('aria-pressed')]), stretch: txt('wkStretch'), rows: rows(), want: [want(1), want(2), want(4)], print: txt('wkPrint'), words: (document.getElementById('swWrap').textContent.match(/\\bjobs?/gi) || []).length, tiles: [...document.querySelectorAll('#swWrap .tr-stat span')].map(x => x.textContent), tile: document.querySelector('#swWrap .tr-stat span').textContent };")
    check('it opens on this week’s tasks, and says so', t1['h2'] == 'This week’s tasks' and t1['eyebrow'].startswith('Tasks') and t1['stretch'].startswith('Week of') and t1['tile'] == t1['stretch'] and t1['print'] == 'Print the week', t1)
    check('how far ahead to list can be chosen: the week, two weeks or four, the week pressed', t1['span'] == [['1', 'Week', 'true'], ['2', '2 weeks', 'false'], ['4', '4 weeks', 'false']], t1['span'])
    check('the week lists the week’s sowings and other tasks', t1['rows'] == t1['want'][0] and t1['want'][0] > 0 and t1['want'][1] > t1['want'][0] and t1['want'][2] > t1['want'][1], [t1['rows'], t1['want']])
    check('nothing on it is called a job any more: the other work is “Other tasks”', t1['words'] == 0 and 'Other tasks' in t1['tiles'], [t1['words'], t1['tiles']])
    click('#wkSpan [data-span="2"]')
    t2 = js(COUNT + " return { h2: txt('wkTitle'), stretch: txt('wkStretch'), rows: rows(), pressed: [...document.querySelectorAll('#wkSpan button')].map(b => b.getAttribute('aria-pressed')), print: txt('wkPrint'), head: [...document.querySelectorAll('#swWrap section.wk-kind thead th')].map(t => t.textContent).slice(0, 3), sheet: (() => { const s = V.sheet(); return { h1: s.querySelector('h1').textContent, rows: s.querySelectorAll('tbody tr').length }; })(), span: V.span() };")
    check('two weeks lists both weeks’ tasks, says the days it covers, and prints both', t2['rows'] == t1['want'][1] and t2['h2'] == 'Tasks for 2 weeks' and '–' in t2['stretch'] and not t2['stretch'].startswith('Week of') and t2['pressed'] == ['false', 'true', 'false'] and t2['print'] == 'Print the 2 weeks' and t2['sheet']['h1'].startswith('2 weeks from') and t2['span'] == 2, t2)
    page.evaluate("(() => { window.print = () => { window.__printed = { h1: document.querySelector('#printSheet h1').textContent, rows: document.querySelectorAll('#printSheet tbody tr').length }; }; })()")
    click('#wkPrint'); wait(300)
    pr = page.evaluate('window.__printed || null')
    check('the print button prints what is listed: both weeks', pr is not None and pr['h1'].startswith('2 weeks from') and pr['rows'] == t2['sheet']['rows'], [pr, t2['sheet']])
    click('#wkSpan [data-span="4"]')
    t4 = js(COUNT + " return { rows: rows(), h2: txt('wkTitle') };")
    check('four weeks lists four', t4['rows'] == t1['want'][2] and t4['h2'] == 'Tasks for 4 weeks', [t4, t1['want']])
    page.screenshot(path=str(shots / f"plain-tasks-{WIDTH}.png"))
    fit = js("const w = $('swWrap'); return { sideways: w.scrollWidth > w.clientWidth + 1, seg: [...document.querySelectorAll('#wkSpan button')].every(b => b.scrollWidth <= b.clientWidth + 1) };")
    check('the choice fits: no sideways scroll, no label cut', not fit['sideways'] and fit['seg'], fit)
    click('#wkSpan [data-span="1"]')
    check('back to the week it is the week again', js(COUNT + " return rows();") == t1['want'][0] and js("return txt('wkTitle');") == 'This week’s tasks')

    # ── where days are counted from ──
    page.click('[data-view-btn="assume"]'); wait(700)
    js("LRFAssume.setMode('days');"); wait(400)
    d = js("""const head = [...document.querySelectorAll('#asTable thead th')].map(t => t.textContent.trim()), sel = document.querySelector('#asBody select[data-start]'), view = $('assumeView') || document.querySelector('.view-assume');
      return { head, opts: sel ? [...sel.options].map(o => o.textContent) : null, old: /Days start at|starting point|Direct sowing/.test(view.textContent), tip: (document.querySelector('#asTable thead th.as-th-start') || {}).title || '' };""")
    check('the column is “Days counted from”, with Transplanting, Seeding in trays and Direct seeding', 'Days counted from' in d['head'] and d['opts'] is not None and all(w in d['opts'] for w in ['Transplanting', 'Seeding in trays', 'Direct seeding']) and 'Seeding in trays' in d['tip'], d)
    check('the old words are gone from the list', not d['old'], d['old'])

    # ── how a crop is picked ──
    js("LRFAssume.setMode('harvest');"); wait(500)
    pk = js("""const sel = document.querySelector('#ahTable select[data-hk^="pick|"]'), cropId = sel ? sel.dataset.hk.split('|')[1] : null, th = document.querySelector('#ahTable thead th.ah-pick');
      return { opts: sel ? [...sel.options].map(o => [o.value, o.textContent]) : null, cropId, name: cropId && eng.crop(cropId).name, value: sel && sel.value, tip: th ? th.title : '', old: /Over the days|Each week|All at once/.test(document.querySelector('#ahTable').textContent + (th ? th.title : '')) };""")
    check('a crop is picked Gradually, Clear or On demand, in that order', pk['opts'] is not None and pk['opts'][:3] == [['weekly', 'Gradually'], ['once', 'Clear'], ['spread', 'On demand']] and not pk['old'] and all(w in pk['tip'] for w in ['Gradually', 'Clear', 'On demand']), pk)
    check('with nothing set a crop is On demand, as every crop has been counted so far', pk['value'] == 'spread', pk['value'])
    if pk['cropId']:
        page.select_option(f'#ahTable select[data-hk="pick|{pk["cropId"]}"]', 'weekly'); wait(600)
        if has('dialog[open] .btn.primary'): click('dialog[open] .btn.primary')
        g = js("return { rule: eng.sellRule('%s').pattern, label: St.undo.length ? St.undo[St.undo.length - 1].label : '', undo: St.undo.length };" % pk['cropId'])
        check('Gradually is the crop picked week by week, and the step says so in words', g['rule'] == 'weekly' and 'picked gradually' in g['label'] and g['undo'] == start['undo'] + 1, g)
        js("A.undo();"); wait(500)
        page.select_option(f'#ahTable select[data-hk="pick|{pk["cropId"]}"]', 'once'); wait(600)
        if has('dialog[open] .btn.primary'): click('dialog[open] .btn.primary')
        c = js("return { rule: eng.sellRule('%s').pattern, label: St.undo.length ? St.undo[St.undo.length - 1].label : '' };" % pk['cropId'])
        check('Clear is all of it the day it is ready', c['rule'] == 'once' and 'cleared at once' in c['label'], c)
        js("A.undo();"); wait(500)
        check('undone, the plan is what it was', js("return A.contentKey();") == start['key'])

    # ── one press for what changes nothing ──
    js("LRFAssume.setMode('days');"); wait(500)
    note = js("""const host = $('asAudit'), s = A.auditStudy(), ch = Object.fromEntries(s.rows.map(r => [r.key, r.choice])), v = A.auditPreview(s.rows, ch), more = $('asAuditMore');
      return { head: host.querySelector('.au-head b').textContent, tidy: txt('asTidy'), review: txt('asReview'), line: txt('asDiffLine'), more: more ? { open: more.open, figs: more.querySelectorAll('.au-figs span').length } : null,
        step: { plantings: v.step.plantings, taken: v.step.taken, kept: v.step.kept }, quiet: !v.harvest && !v.sowing && !v.yields.length && !v.ground.length && !v.fresh.length, rows: s.rows.length, differ: s.rows.filter(r => r.choice === 'keep').length, own: A.auditSurvey().days.own, worth: Math.round(v.worth[0]) };""")
    check('above the list: plantings that differ from it, one button for what changes nothing and one to see what differs', note['head'] == 'Plantings that differ from your list' and note['tidy'] is not None and note['tidy'].startswith('Move onto the list what changes nothing') and note['review'] == 'See what differs…' and 'your list does not decide' in (note['line'] or ''), note)
    check('the count kind by kind is folded away, and still there', note['more'] is not None and note['more']['open'] is False and note['more']['figs'] >= 5, note['more'])
    check('there is something to move that changes nothing, and something that differs', note['step']['plantings'] > 0 and note['quiet'] and note['differ'] > 0, note)
    click('#asTidy'); wait(900)
    ask = js("const d = document.querySelector('dialog[open]'); return d ? { title: d.querySelector('h2').textContent, body: d.querySelector('p').textContent, ok: d.querySelector('.btn.primary').textContent } : null;")
    check('the press works it out first and says it: how many plantings, how many lines, and that no date, yield or dollar changes', ask is not None and f"{note['step']['plantings']:,} planting" in ask['title'] and f"{note['step']['taken']:,} line" in ask['body'] and 'No harvest date, no sowing date, no yield and no dollar changes' in ask['body'] and f"${note['worth']:,}" in ask['body'] and 'snapshot' in ask['body'] and ask['ok'] == 'Move them', ask)
    check('nothing has changed yet', js("return A.contentKey();") == start['key'])
    click('dialog[open] .btn:not(.primary)'); wait(400)
    check('Cancel leaves the plan as it was', js("return A.contentKey();") == start['key'] and not has('dialog[open]'))
    click('#asTidy'); wait(900); click('dialog[open] .btn.primary'); wait(1500)
    after = js("const s = A.auditStudy(), ch = Object.fromEntries(s.rows.map(r => [r.key, r.choice])), v = A.auditPreview(s.rows, ch); return { key: A.contentKey(), undo: St.undo.length, label: St.undo.length ? St.undo[St.undo.length - 1].label : '', own: A.auditSurvey().days.own, sig: " + SIG + ", left: v.step.plantings, rows: s.rows.length, differ: s.rows.filter(r => r.choice === 'keep').length, tidy: !!$('asTidy'), worth: Math.round(LRFForecast.build(St.engine, { year }).rows.reduce((n, r) => n + r.worth, 0)) };")
    check('agreed to, it is one step: those plantings follow the list', after['key'] != start['key'] and after['undo'] == start['undo'] + 1 and f"{note['step']['plantings']} planting" in after['label'] and after['own'] < note['own'], [after['undo'], after['label'], after['own'], note['own']])
    check('and no planting’s dates, yield or price moved', after['sig'] == start['sig'])
    check('what is left is only what differs: nothing more can be moved without a change', after['left'] == 0 and after['differ'] == note['differ'] and after['rows'] == note['differ'], [after['left'], after['differ'], after['rows'], note['differ']])
    snaps = page.evaluate("LRFApp.snapshots().then(s => s.rows.map(r => r.name))")
    check('the plan as it stood was kept as a snapshot first', any('Before plantings followed the list' in n for n in snaps), snaps[:4])
    click('#asTidy'); wait(900)
    check('pressed again, it says there is nothing more to move and changes nothing', 'Nothing can go onto the list' in toast() and not has('dialog[open]') and js("return A.contentKey();") == after['key'], toast())

    # ── the window shows what differs, crop by crop ──
    click('#asReview'); wait(900)
    w = js("""const d = $('auditDlg'); if (!d) return null; const rows = [...d.querySelectorAll('tr.au-row')], secs = [...d.querySelectorAll('tr.au-sec')];
      return { title: d.querySelector('h2').textContent, by: [...d.querySelectorAll('#auBy button')].map(b => [b.dataset.by, b.getAttribute('aria-pressed')]), rows: rows.length, crops: secs.map(s => s.querySelector('b').textContent), allCrop: secs.every(s => s.classList.contains('au-crop')),
        sorted: secs.map(s => s.querySelector('b').textContent).every((x, i, a) => i === 0 || a[i - 1].localeCompare(x) <= 0), first: rows[0] ? rows[0].querySelector('.au-name b').textContent : '', kept: rows.every(r => r.querySelector('select').value === 'keep'), all: !!$('auAll'),
        names: new Set(eng.crops().map(c => c.name)), kinds: ['Days to harvest', 'Nursery weeks', 'To place', 'Yield', 'Harvest days', 'Turnover days', 'Copied value'], sum: txt('auHead'), sideways: d.querySelector('.au-scroll').scrollWidth > d.querySelector('.au-scroll').clientWidth + 1 };""")
    check('the window is “Plantings that differ from your list”, set out by crop', w is not None and w['title'] == 'Plantings that differ from your list' and w['by'] == [['crop', 'true'], ['kind', 'false']] and w['allCrop'] and w['sorted'] and len(w['crops']) > 0, w)
    check('it lists only the groups that would change, each kept as it is until he says otherwise', w is not None and w['rows'] == note['differ'] and w['kept'] and w['first'] in w['kinds'] and w['sum'] == 'Nothing will change', w)
    page.screenshot(path=str(shots / f"plain-differs-{WIDTH}.png"))
    click('#auBy [data-by="kind"]')
    k = js("const d = $('auditDlg'); return { secs: [...d.querySelectorAll('tr.au-sec b')].map(b => b.textContent), rows: d.querySelectorAll('tr.au-row').length, crop: d.querySelectorAll('tr.au-crop').length };")
    check('or by kind of figure, as before', k['rows'] == note['differ'] and k['crop'] == 0 and all(s in ['Days to harvest', 'Nursery weeks', 'To place', 'Yield', 'Harvest days', 'Turnover days', 'Copied crop values'] for s in k['secs']) and len(k['secs']) > 0, k)
    page.keyboard.press('Escape'); wait(300)
    check('Escape closes it and changes nothing', not has('#auditDlg') and js("return A.contentKey();") == after['key'])
    js("A.undo();"); wait(900)
    back = js("return { key: A.contentKey(), sig: " + SIG + " };")
    check('one undo takes the whole move back', back['key'] == start['key'] and back['sig'] == start['sig'])
    # the press never trusts the suggestion: handed one that would move a date, it leaves that group out and moves only the rest
    forced = js("const real = A.auditStudy; A.__study = real; let hit = null; A.auditStudy = () => { const s = real(), r = s.rows.find(x => x.choice === 'keep' && x.kind === 'days'); if (r) { r.choice = 'follow'; hit = r.key; } return s; }; A.auditStudy(); return hit;")
    click('#asTidy'); wait(900)
    if has('dialog[open] .btn.primary'): click('dialog[open] .btn.primary'); wait(1500)
    f2 = js("const out = { sig: " + SIG + ", undo: St.undo.length }; A.auditStudy = A.__study; delete A.__study; return out;")
    check('handed a suggestion that would move a date, the press leaves that group out: still no date, yield or price moves', forced is not None and f2['undo'] == start['undo'] + 1 and f2['sig'] == start['sig'], [forced, f2['undo']])
    js("A.undo();"); wait(900)
    check('and that too is undone in one step', js("return A.contentKey();") == start['key'])
    click('#asReview'); wait(900)
    w0 = js("const d = $('auditDlg'); return d ? { rows: d.querySelectorAll('tr.au-row').length, label: $('auAll') ? $('auAll').closest('label').textContent : null, head: txt('auHead') } : null;")
    check('before the move, the window still opens on what differs, and offers the rest', w0 is not None and w0['rows'] == note['differ'] and w0['label'] is not None and f"{note['rows'] - note['differ']} group" in w0['label'] and f"{note['step']['plantings']:,} planting" in (w0['head'] or ''), [w0, note['rows'], note['differ']])
    click('#auAll')
    check('ticked, every group is listed', js("return $('auditDlg').querySelectorAll('tr.au-row').length;") == note['rows'])
    js("LRFAssume.auditView({ by: 'crop', all: false });"); page.keyboard.press('Escape'); wait(300)

    # ── links: nothing to set up on the Seeds bar ──
    page.click('[data-view-btn="seeds"]'); wait(900)
    bar = js("const b = [...document.querySelectorAll('#seedsView button, .view-seeds button')].map(x => x.textContent.trim()); return { add: txt('sdAddLink'), reader: b.filter(t => /Link reader/.test(t)), how: LRFSeeds.linkHow(), ready: LRFSeeds.serviceReady() };")
    check('the Seeds bar adds a variety from a link, and has no “Link reader” on it', bar['add'] == 'Add from a link' and bar['reader'] == [] and bar['how'] == 'none' and bar['ready'] is False, bar)
    click('#sdAddLink'); wait(500)
    im = js("const d = document.querySelector('dialog[open]'); return d ? { link: !!d.querySelector('input[name=url], input[type=url]'), hint: (d.querySelector('label.fld small') || {}).textContent || '', how: ($('sdLinkHow') || {}).dataset ? $('sdLinkHow').dataset.how : null, own: txt('sdSettings'), paste: !!($('sdFallback') && !$('sdFallback').hidden && $('sdFallback').getClientRects().length) } : null;")
    check('the importer leads with the link alone (0.33), says links are read through Cloud sync once connected, and keeps the copied-text route out of sight until a link fails', im is not None and 'Cloud sync' in im['hint'] and im['how'] == 'none' and not im['paste'] and im['own'] is not None and 'fetch service of your own' in im['own'], im)
    page.keyboard.press('Escape'); wait(300)
    # a device signed in to a sync service that reads links (version 2): nothing more to set up
    js("A.linkService = () => ({ base: 'https://sync.example', key: 'v1.1234567890.abcdefghijklmnopqrstuvwx', v: 2 });")
    click('#sdAddLink'); wait(500)
    c2 = js("const d = document.querySelector('dialog[open]'), s = LRFSeeds.service(); return { how: LRFSeeds.linkHow(), ready: LRFSeeds.serviceReady(), base: s.base, keyed: s.key.startsWith('v1.'), hint: (d.querySelector('label.fld small') || {}).textContent || '', paste: !!($('sdFallback') && !$('sdFallback').hidden && $('sdFallback').getClientRects().length) };")
    check('signed in to Cloud sync, a link is read through it with nothing else to set up', c2['how'] == 'cloud' and c2['ready'] and c2['base'] == 'https://sync.example' and c2['keyed'] and 'read through your Cloud sync' in c2['hint'] and not c2['paste'], c2)
    page.keyboard.press('Escape'); wait(300)
    js("A.linkService = () => ({ base: 'https://sync.example', key: 'v1.1234567890.abcdefghijklmnopqrstuvwx', v: 1 });")
    click('#sdAddLink'); wait(500)
    c1 = js("const d = document.querySelector('dialog[open]'); return { how: LRFSeeds.linkHow(), ready: LRFSeeds.serviceReady(), hint: (d.querySelector('label.fld small') || {}).textContent || '' };")
    check('with the older sync service it says what one paste in Cloudflare would do, and does not pretend to read links', c1['how'] == 'cloud-old' and not c1['ready'] and 'Cloudflare' in c1['hint'], c1)
    page.fill('dialog[open] input[name="url"]', 'https://www.johnnyseeds.com/vegetables/kale/zz.html'); page.locator('dialog[open] button', has_text='Read page').first.click(); wait(400)   # 0.33: the fetch service is offered once a link has failed
    click('#sdSettings'); wait(500)
    own = js("const d = [...document.querySelectorAll('dialog[open]')].pop(); return d ? d.querySelector('h2').textContent : null;")
    check('a fetch service of his own can still be set, from inside the importer', own == 'A fetch service of your own', own)
    page.keyboard.press('Escape'); wait(200); page.keyboard.press('Escape'); wait(300)
    js("localStorage.setItem('lrf-next:fetch', JSON.stringify({ base: 'https://mine.example.workers.dev', key: 'k'.repeat(24) })); A.linkService = () => ({ base: 'https://sync.example', key: 'v1.1234567890.abcdefghijklmnopqrstuvwx', v: 2 });")
    o = js("const s = LRFSeeds.service(); return { how: LRFSeeds.linkHow(), base: s.base };")
    check('where his own fetch service is set in this browser, it is the one used', o['how'] == 'own' and o['base'] == 'https://mine.example.workers.dev', o)
    js("localStorage.removeItem('lrf-next:fetch'); delete A.linkService;")

    # ── a phone still has the week and nothing else ──
    ctx2, phone = open_page(390, 800)
    ph = phone.evaluate("(() => ({ phone: document.body.classList.contains('phone'), span: !!document.getElementById('wkSpan'), h2: (document.getElementById('wkTitle') || {}).textContent }))()")
    check('on a phone the week is the whole page: no choice of how far ahead', ph['phone'] and not ph['span'], ph)
    ctx2.close()

    page.click('[data-view-btn="map"]'); wait(300)
    end = js("return { key: A.contentKey(), n: St.plan.plantings.length, bg: getComputedStyle(document.body).backgroundColor };")
    check('after all of it the plan is what it was', end['key'] == start['key'] and end['n'] == start['n'], end)
    check('the page is light, whatever the computer says', sum(int(x) for x in end['bg'].replace('rgb(', '').replace(')', '').split(',')[:3]) > 600, end['bg'])
    check('the page raised no error', errors == [], errors[:4])
    browser.close()
finish()
