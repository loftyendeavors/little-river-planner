"""The maintenance pass (0.20) in a real browser: what a browser with no plan says and offers, and the small repairs.

usage: python3 -I maint_check.py <app-dir> <shots-dir>

The rules under test:
  - a browser that holds no plan says so across the page in every view, never calls the sample "saved", and offers the two
    ways to bring a plan in: a backup file, or the folder the plan is kept in;
  - "Open my plan folder" opens the plan a folder holds, photos and all, and carries on saving there; a folder with no plan
    in it is let go again and nothing is written to it; with a plan already open it does nothing;
  - the series tool opens on a series to look at for every crop it plans, also one grown nowhere yet, and never opens on
    some other crop than the one asked for;
  - a plan stored in the browser that will not open (cut short, or not a plan at all) is kept exactly as it is: nothing done
    on the page is saved over it until he brings a plan in or says to carry on, and it can be downloaded as it stands;
  - with a plan open, none of this shows.
"""
import http.server, json, os, socketserver, sys, threading, functools
from playwright.sync_api import sync_playwright

target, shots = sys.argv[1], sys.argv[2]
backup = sys.argv[3] if len(sys.argv) > 3 else None   # a plan file to load, for the one check that needs one
os.makedirs(shots, exist_ok=True)
results, failed = [], []

def check(name, ok, detail=None):
    results.append(('ok   ' if ok else 'FAIL ') + name + ('' if ok or detail is None else ' ' + json.dumps(detail, default=str)[:700]))
    if not ok:
        failed.append(name)
    if os.environ.get('LIVE'):
        print(results[-1][:900], file=sys.stderr, flush=True)
    if not ok and os.environ.get('STOP_AT_FAIL'):
        print('\n'.join(results)); print(json.dumps({'passed': len(results) - len(failed), 'of': len(results), 'failed': failed, 'stopped': True}), flush=True); os._exit(1)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=target))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = 'http://127.0.0.1:%d/index.html' % server.server_address[1]

VIEWS = ['map', 'timeline', 'sow', 'trays', 'harvest', 'assume', 'seeds']
# every crop the series tool plans, opened in turn: what the form says first
SERIES = """() => { const A = LRFApp, eng = A.state.engine, S = LRFSuccession, P = LRFSeries.state.P, out = { crops: 0, complaints: [], wrong: [], fresh: [], grown: [] };
  A.setView('timeline');
  for (const c of eng.crops()) {
    const plans = !c.micro && !eng.isCoverCrop(c) && +c.dtm > 0;
    if (!plans) continue;
    A.openAhead({ mode: 'series', cropId: c.id }); out.crops++;
    if (P.cropId !== c.id) { out.wrong.push(c.name); continue; }
    const err = document.getElementById('srError'), gardens = S.gardensFor(eng, c), planted = gardens.filter(g => g.planted).map(g => g.garden.id);
    if (err) out.complaints.push([c.name, err.textContent]);
    if (!planted.length && gardens.length) out.fresh.push([c.name, P.gardenIds.join() === gardens[0].garden.id, !!document.getElementById('srSum') || !!err]);
    if (planted.length) out.grown.push([c.name, P.gardenIds.join() === planted.join()]);
  }
  A.select(null); return out; }"""
LAYOUT = "(() => { const w = document.querySelector('main.work').getBoundingClientRect(), f = document.getElementById('firstRun'), fr = f.getBoundingClientRect(), top = document.querySelector('header.top').getBoundingClientRect(); return { shown: !f.hidden && fr.height > 0, under: Math.abs(fr.top - top.bottom) < 1.5, above: Math.abs(w.top - (f.hidden ? top.bottom : fr.bottom)) < 1.5, fills: Math.abs(w.bottom - innerHeight) < 1.5, sideways: document.documentElement.scrollWidth > innerWidth + 1, tall: document.documentElement.scrollHeight > innerHeight + 1, across: fr.width >= innerWidth - 1 }; })()"

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = browser.new_context(viewport={'width': 1480, 'height': 900})
    page = ctx.new_page(); page.set_default_timeout(20000)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)[:300]))
    ev = page.evaluate
    def ready():
        page.wait_for_function('window.LRFApp && LRFApp.state.ready', timeout=30000); page.wait_for_timeout(500)
    def toast():
        return ev("document.getElementById('toast').textContent")

    try:
        # ── 1. with the plan open, nothing of the no-plan state shows; a folder is filled for later ──
        page.goto(url); ready()
        full = ev("({ n: LRFApp.state.plan.plantings.length, sample: LRFApp.isSample(), strip: document.getElementById('firstRun').hidden, welcome: !!document.querySelector('.welcome'), status: document.getElementById('saveState').textContent })")
        check('with a plan open: no strip, no "load your plan" notice', full['n'] > 500 and not full['sample'] and full['strip'] and not full['welcome'], full)
        lay = ev(LAYOUT)
        check('with a plan open the page is laid out as before: the work area starts under the header and fills the window', lay['above'] and lay['fills'] and not lay['sideways'] and not lay['tall'] and not lay['shown'], lay)
        ev("window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Kept plan', { create: true })")
        refused = ev("LRFApp.openMyFolder()"); page.wait_for_timeout(200)
        check('"Open my plan folder" does nothing while a plan is open, and says why', refused is False and 'already open' in toast() and not ev("LRFFolder.info().connected"), toast())
        series_full = ev(SERIES)
        check('the series tool opens on the crop asked for, for every crop it plans (%d)' % series_full['crops'], series_full['crops'] > 40 and not series_full['wrong'], series_full['wrong'])
        check('and never opens on a complaint', not series_full['complaints'], series_full['complaints'][:4])
        check('a crop grown nowhere yet starts with the first garden it can go in (%d crops)' % len(series_full['fresh']), len(series_full['fresh']) > 10 and all(f[1] and f[2] for f in series_full['fresh']), [f for f in series_full['fresh'] if not (f[1] and f[2])][:4])
        check('a crop already grown still starts with the gardens it is grown in (%d crops)' % len(series_full['grown']), len(series_full['grown']) > 10 and all(g[1] for g in series_full['grown']), [g for g in series_full['grown'] if not g[1]][:4])
        # a crop the tool does not plan: said, not swapped
        swap = ev("""() => { const A = LRFApp, eng = A.state.engine, P = LRFSeries.state.P, out = [];
          for (const c of eng.crops().filter(c => c.micro || eng.isCoverCrop(c)).slice(0, 60)) { A.select(null); const before = P.cropId; A.openAhead({ mode: 'series', cropId: c.id }); out.push([c.name, !A.state.sel, P.cropId === before, document.getElementById('toast').textContent]); }
          return out; }""")
        check('asked for a crop it does not plan (live trays, cover crops), the series tool says so and opens nothing (%d crops)' % len(swap), len(swap) >= 3 and all(s[1] and s[2] and ('Live trays in the Nursery view' in s[3] or 'no harvest' in s[3]) for s in swap), [s for s in swap if not (s[1] and s[2])][:3])
        link = ev("""() => { const A = LRFApp, eng = A.state.engine, out = {};
          const first = test => A.state.plan.plantings.find(p => { const c = eng.crop(p.cropId); return c && !p.liveTray && eng.calc(p) && test(c); });
          let cover = first(c => eng.isCoverCrop(c)); const plain = first(c => !c.micro && !eng.isCoverCrop(c) && +c.dtm > 0);
          if (!cover) {   // the plan has none: one is planted for the look, and taken out again
            const crop = eng.crops().find(c => eng.isCoverCrop(c)), date = new Date(A.planYear(), 8, 1);
            for (const bed of A.state.plan.beds) { if (!crop || !eng.isSoilBed(bed) || A.preview({ cropId: crop.id }, { bedId: bed.id, date }).state !== 'ok') continue; const p = A.place({ cropId: crop.id }, bed.id, date); if (p) { cover = A.state.plan.plantings.find(q => q.cropId === crop.id); out.made = true; } break; }
          }
          if (cover) { A.select({ type: 'planting', id: cover.id }); out.cover = { link: !!document.getElementById('fSeriesLink'), quick: !!document.getElementById('fRepeatCount') }; }
          if (out.made) A.undo();
          A.select({ type: 'planting', id: plain.id }); out.plain = { link: !!document.getElementById('fSeriesLink'), quick: !!document.getElementById('fRepeatCount') };
          A.select(null); return out; }""")
        check('a planting still offers the longer series, beside the quick "more, every so many days"', link['plain']['link'] and link['plain']['quick'], link)
        check('a cover crop planting keeps the quick repeat and does not offer a series it cannot have', 'cover' in link and link['cover']['quick'] and not link['cover']['link'], link)
        check('(the cover crop planted for that look is out of the plan again)', ev("LRFApp.state.plan.plantings.length") == full['n'], ev("LRFApp.state.plan.plantings.length"))
        how = ev("(() => { const a = document.getElementById('ovSeries'), li = a && a.closest('li'); return a ? { inSpan: a.parentElement.tagName === 'SPAN', cells: li.children.length, oneBlock: a.getBoundingClientRect().left > li.querySelector('b').getBoundingClientRect().right } : null; })()")
        check('the "Series" line of the how-to list reads as one sentence beside its heading', bool(how) and how['inSpan'] and how['cells'] == 2 and how['oneBlock'], how)
        # the plan goes into a folder, the way he keeps it; then this browser forgets everything but the folder's files
        kept = ev("""async () => { const A = LRFApp, F = LRFFolder, dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Kept plan', { create: true });
          // with a farm photo of its own, as a plan loaded from a backup has
          const canvas = Object.assign(document.createElement('canvas'), { width: 320, height: 200 }), g = canvas.getContext('2d'); g.fillStyle = '#4a7'; g.fillRect(0, 0, 320, 200); g.fillStyle = '#fff'; g.fillRect(40, 40, 60, 30);
          const png = await new Promise(res => canvas.toBlob(res, 'image/png')); await A.addPhotos([new File([png], 'farm.png', { type: 'image/png' })]);
          await F.restore(dir); const done = await A.saveToFolder(); const names = []; for await (const [n] of dir.entries()) names.push(n);
          const file = await (await dir.getFileHandle(F.PLAN)).getFile();
          await F.forget(); return { saved: !!done.saved, names: names.sort(), modified: file.lastModified, size: file.size, n: A.state.plan.plantings.length, map: png.size, photo: names.some(n => /[.](png|jpe?g|webp)$/i.test(n)) }; }""")
        check('(setting up) the plan is kept in a folder, with its farm photo', kept['saved'] and kept['size'] > 10000 and kept['photo'], kept)
        ev("""async () => { localStorage.clear(); const names = (await indexedDB.databases()).map(d => d.name); await Promise.all(names.map(n => new Promise(res => { const r = indexedDB.deleteDatabase(n); r.onsuccess = r.onerror = r.onblocked = () => res(); }))); }""")

        # ── 2. a browser that holds no plan ──
        page.route('**/data/**', lambda r: r.abort())
        page.goto('about:blank'); page.goto(url); ready()
        first = ev("({ sample: LRFApp.isSample(), n: LRFApp.state.plan.plantings.length, text: document.getElementById('firstRun').textContent.replace(/\\s+/g, ' ').trim(), status: document.getElementById('saveState').textContent, load: !!document.getElementById('firstLoad').offsetParent, folder: !!document.getElementById('firstFolder').offsetParent, welcome: (document.querySelector('.welcome') || {}).textContent, welcomeFolder: !!document.getElementById('welcomeFolder') })")
        check('a browser with nothing stored opens on the sample', first['sample'] and first['n'] < 50, first)
        check('and says so across the page: no plan of yours is in this browser, and a plan does not follow you between browsers', 'No plan of yours is in this browser' in first['text'] and 'does not follow you' in first['text'] and 'still there' in first['text'], first['text'])
        check('with both ways to bring one in: a backup file, the plan folder', first['load'] and first['folder'], first)
        check('the notice in the details panel says the same, says which files load and names no other planner', 'No plan in this browser' in (first['welcome'] or '') and '.zip or .json' in first['welcome'] and 'v7' not in first['welcome'] and first['welcomeFolder'], first['welcome'])
        check('the indicator reads "Sample plan"', first['status'] == 'Sample plan', first['status'])
        seen = {}
        for view in VIEWS:
            ev("LRFApp.setView('%s')" % view); page.wait_for_timeout(350); seen[view] = ev(LAYOUT)
        bad = {v: s for v, s in seen.items() if not (s['shown'] and s['under'] and s['above'] and s['fills'] and s['across'] and not s['sideways'] and not s['tall'])}
        check('the strip shows in every view, under the header, and the view below it still fills the window', not bad, bad)
        ev("LRFApp.setView('map')"); page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(shots, 'maint-no-plan.png'))
        for width, height in [(3440, 1300), (1024, 700), (390, 800)]:
            page.set_viewport_size({'width': width, 'height': height}); page.wait_for_timeout(350)
            at = ev("(() => { const f = document.getElementById('firstRun').getBoundingClientRect(), b = document.getElementById('firstLoad').getBoundingClientRect(); return { top: f.top, bottom: f.bottom, button: b.left >= 0 && b.right <= innerWidth + 0.5 && b.bottom <= innerHeight, width: f.width }; })()")
            check('at %d wide the strip and its first button are on the first screen' % width, at['bottom'] > at['top'] and at['bottom'] < height * 0.5 and at['button'], at)
            if width == 3440: page.screenshot(path=os.path.join(shots, 'maint-no-plan-wide.png'))
        page.set_viewport_size({'width': 1480, 'height': 900}); page.wait_for_timeout(300)
        # a change to the sample is kept, and still not called a saved plan
        changed = ev("""async () => { const A = LRFApp, eng = A.state.engine, S = LRFSuccession, c = eng.crops().find(c => !c.micro && !eng.isCoverCrop(c) && +c.dtm > 0);
          const r = S.series(eng, { cropId: c.id, place: 'hold', basis: 'planting', from: A.planYear() + '-06-01', every: 14, count: 1, unit: 'whole', amount: 1 }); A.addSeries({ plantings: [], held: r.held }, 'a try');
          await new Promise(res => setTimeout(res, 1500)); return { w: A.waiting().length, sample: A.isSample(), status: document.getElementById('saveState').textContent, state: document.getElementById('saveState').dataset.state, strip: !document.getElementById('firstRun').hidden }; }""")
        check('after a change to the sample the indicator still reads "Sample plan", not "Saved"', changed['w'] == 1 and changed['sample'] and changed['status'] == 'Sample plan' and changed['state'] == 'sample' and changed['strip'], changed)
        ev("LRFApp.undo()")
        series_sample = ev(SERIES)
        check('on the sample too the series tool never opens on a complaint (%d crops)' % series_sample['crops'], series_sample['crops'] > 30 and not series_sample['complaints'] and not series_sample['wrong'], [series_sample['complaints'][:3], series_sample['wrong'][:3]])

        # ── 3. "Open my plan folder" ──
        # a folder with no plan in it
        ev("window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Holiday photos', { create: true })")
        page.click('#firstFolder'); page.wait_for_timeout(700)
        empty = ev("""async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Holiday photos'); const names = []; for await (const [n] of dir.entries()) names.push(n); return { names, info: LRFFolder.info(), sample: LRFApp.isSample(), toast: document.getElementById('toast').textContent }; }""")
        check('a folder with no plan in it: said so, nothing written there, and the folder is let go', empty['names'] == [] and not empty['info']['connected'] and empty['sample'] and 'holds no plan' in empty['toast'], empty)
        page.reload(); ready()
        after = ev("({ info: LRFFolder.info(), sample: LRFApp.isSample() })")
        check('and it is not remembered after a reload', not after['info']['connected'] and not after['info']['needsPermission'] and after['sample'], after)
        # a folder whose plan file cannot be read
        ev("""async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Broken', { create: true }), h = await dir.getFileHandle(LRFFolder.PLAN, { create: true }), w = await h.createWritable(); await w.write('{ not a plan'); await w.close();
          window.showDirectoryPicker = async () => dir; }""")
        page.click('#firstFolder'); page.wait_for_timeout(700)
        broken = ev("""async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Broken'); const text = await (await (await dir.getFileHandle(LRFFolder.PLAN)).getFile()).text(); return { text, info: LRFFolder.info(), sample: LRFApp.isSample(), toast: document.getElementById('toast').textContent }; }""")
        check('a folder whose plan file cannot be read: said so, the file left as it is, the sample still open', broken['text'] == '{ not a plan' and not broken['info']['connected'] and broken['sample'] and 'cannot be read' in broken['toast'], broken)
        # the folder window closed without choosing
        ev("window.showDirectoryPicker = async () => { const e = new Error('closed'); e.name = 'AbortError'; throw e; }; document.getElementById('toast').textContent = ''")
        page.click('#firstFolder'); page.wait_for_timeout(400)
        check('the folder window closed without choosing: nothing happens, nothing is said', ev("LRFApp.isSample() && !LRFFolder.info().connected && !document.getElementById('toast').classList.contains('show')") or toast() == '', toast())
        # the folder the plan is kept in
        ev("window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Kept plan')")
        page.click('#firstFolder')
        page.wait_for_function('!LRFApp.isSample()', timeout=30000); page.wait_for_timeout(1200)
        opened = ev("""async () => { const A = LRFApp, F = LRFFolder, dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Kept plan'), file = await (await dir.getFileHandle(F.PLAN)).getFile();
          return { n: A.state.plan.plantings.length, sample: A.isSample(), info: F.info(), strip: document.getElementById('firstRun').hidden, welcome: !!document.querySelector('.welcome'), status: document.getElementById('saveState').textContent, modified: file.lastModified, map: String(A.state.mapImageUrl || '').startsWith('blob:') ? (await (await fetch(A.state.mapImageUrl)).blob()).size : 0, undo: A.state.undo.length, w: A.waiting().length }; }""")
        check('the folder the plan is kept in: its plan opens, every planting of it', opened['n'] == kept['n'] and not opened['sample'], [opened['n'], kept['n']])
        check('with its farm photo, byte for byte the size the folder held', opened['map'] == kept['map'] and kept['map'] > 100, [opened['map'], kept['map']])
        check('the strip and the notice go', opened['strip'] and not opened['welcome'], opened)
        check('saving carries on in that folder, with nothing to settle between the two', opened['info']['connected'] and not opened['info']['conflict'] and opened['info']['name'] == 'Kept plan', opened['info'])
        check('opening wrote nothing over the plan file', opened['modified'] == kept['modified'], [opened['modified'], kept['modified']])
        lay = ev(LAYOUT)
        check('and the page is laid out as with any open plan', lay['above'] and lay['fills'] and not lay['shown'] and not lay['sideways'], lay)
        wrote = ev("""async () => { const A = LRFApp, eng = A.state.engine, S = LRFSuccession, c = eng.crops().find(c => !c.micro && !eng.isCoverCrop(c) && +c.dtm > 0);
          const r = S.series(eng, { cropId: c.id, place: 'hold', basis: 'planting', from: A.planYear() + '-06-01', every: 14, count: 1, unit: 'whole', amount: 1 }); A.addSeries({ plantings: [], held: r.held }, 'a try');
          const done = await A.saveToFolder(); const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Kept plan'), text = await (await (await dir.getFileHandle(LRFFolder.PLAN)).getFile()).text(), plan = JSON.parse(text);
          const out = { saved: !!done.saved, skipped: done.skipped || null, waitingInFile: (((plan.lrfNextKeep || {}).keep || {}).waiting || []).length, status: document.getElementById('saveState').textContent }; A.undo(); await A.saveToFolder(); return out; }""")
        check('a change made after that is written to the folder', wrote['saved'] and wrote['waitingInFile'] == 1, wrote)
        # The folder is remembered for the next visit. This test browser dies when it reads back a remembered folder of the private
        # file system it has to use here (Chrome itself, with no planner code involved), so the note is checked and then taken out.
        UNREMEMBER = """() => new Promise(res => { const o = indexedDB.open('lrf-next-folder', 1); o.onupgradeneeded = () => o.result.createObjectStore('handles'); o.onerror = () => res(null);
          o.onsuccess = () => { const tx = o.result.transaction('handles', 'readwrite'), st = tx.objectStore('handles'), q = st.count('folder'); let had = null; q.onsuccess = () => { had = q.result; st.delete('folder'); }; tx.oncomplete = () => { o.result.close(); res(had); }; }; })"""
        remembered = ev(UNREMEMBER)
        check('the folder is remembered for the next visit', remembered == 1 and ev("LRFFolder.info().name") == 'Kept plan', remembered)
        page.reload(); ready(); page.wait_for_timeout(600)
        again = ev("({ n: LRFApp.state.plan.plantings.length, sample: LRFApp.isSample(), strip: document.getElementById('firstRun').hidden })")
        check('after a reload the plan is here, with no strip', again['n'] == kept['n'] and not again['sample'] and again['strip'], again)

        # ── 4. a stored plan that will not open ──
        STORED = "localStorage.getItem('lrf-next:plan')"
        CHANGE = """async () => { const A = LRFApp, eng = A.state.engine, S = LRFSuccession, c = eng.crops().find(c => !c.micro && !eng.isCoverCrop(c) && +c.dtm > 0);
          const r = S.series(eng, { cropId: c.id, place: 'hold', basis: 'planting', from: A.planYear() + '-06-01', every: 14, count: 1, unit: 'whole', amount: 1 }); A.addSeries({ plantings: [], held: r.held }, 'a try');
          await new Promise(res => setTimeout(res, 2200)); return A.waiting().length; }"""
        LOOK = "({ ready: LRFApp.state.ready, sample: LRFApp.isSample(), bad: !!LRFApp.state.unreadable, strip: !document.getElementById('firstRun').hidden, text: document.getElementById('firstRun').innerText.replace(/\\s+/g, ' '), status: document.getElementById('saveState').textContent, state: document.getElementById('saveState').dataset.state, stored: !document.getElementById('firstStored').hidden, use: !document.getElementById('firstUse').hidden, welcome: !!document.querySelector('.welcome') })"
        whole = ev(STORED)
        check('(setting up) the plan is stored in this browser', bool(whole) and len(whole) > 50000, len(whole or ''))
        cut = whole[:len(whole) // 2]
        ev("s => localStorage.setItem('lrf-next:plan', s)", cut)
        page.reload(); ready()
        look = ev(LOOK)
        check('a stored plan cut short: the page opens, and says the stored plan could not be opened and is kept as it is', look['ready'] and look['bad'] and look['strip'] and 'could not be opened' in look['text'] and 'kept exactly as it is' in look['text'], look)
        check('the indicator says it is not saving, and why', 'Not saving' in look['status'] and look['state'] == 'error', look['status'])
        check('it offers what is stored as a file, and carrying on from the plan shown', look['stored'] and look['use'] and not look['welcome'], look)
        made = ev(CHANGE)
        check('a change made on the page is not saved over what is stored', made == 1 and ev(STORED) == cut, [made, len(ev(STORED) or ''), len(cut)])
        check('and the indicator still says it is not saving (not "Saving…", not "Saved")', 'Not saving' in ev("document.getElementById('saveState').textContent"), ev("document.getElementById('saveState').textContent"))
        saved_now = ev("LRFApp.saveNow()"); page.wait_for_timeout(400)
        check('nor does "Save now"', saved_now is None and ev(STORED) == cut and 'could not be opened' in toast(), toast())
        page.reload(); ready()
        check('after a reload it is still there, untouched, and still said', ev(STORED) == cut and ev(LOOK)['bad'], ev(LOOK))
        with page.expect_download() as got:
            page.click('#firstStored')
        text = open(got.value.path(), encoding='utf-8').read()
        check('"Download what is stored" gives exactly what is stored', text == cut and 'unreadable' in got.value.suggested_filename, [len(text), len(cut), got.value.suggested_filename])
        if backup:
            page.set_input_files('#importFile', backup)
            try: page.wait_for_selector('dialog.dialog', timeout=12000)
            except Exception: check('loading a backup over it asks first, and cancelling leaves it untouched', False, 'nothing was asked')
            asked = ev("document.querySelector('dialog.dialog').innerText")
            page.locator('dialog.dialog .btn:not(.danger)').first.click(); page.wait_for_timeout(600)
            check('loading a backup over it asks first, and cancelling leaves it untouched', 'could not be opened' in asked and 'gone for good' in asked and ev(STORED) == cut and ev(LOOK)['bad'], asked[:200])
        # back from the folder, which still holds the plan this browser wrote there
        ev("window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Kept plan')")
        page.click('#firstFolder')
        try: page.wait_for_selector('dialog.dialog', timeout=12000)
        except Exception: check('"Open my plan folder" brings the plan back from the folder (asked first), also when the folder’s copy is one this browser wrote', False, toast())
        page.locator('dialog.dialog .btn.danger').click()
        page.wait_for_function('!LRFApp.state.unreadable', timeout=30000); page.wait_for_timeout(1500)
        back = ev("({ n: LRFApp.state.plan.plantings.length, look: " + LOOK + ", info: LRFFolder.info(), stored: (() => { try { return JSON.parse(localStorage.getItem('lrf-next:plan')).plantings.length; } catch (e) { return String(e); } })() })")
        check('"Open my plan folder" brings the plan back from the folder (asked first), also when the folder’s copy is one this browser wrote', back['n'] == kept['n'] and not back['look']['bad'] and not back['look']['strip'] and back['info']['connected'] and not back['info']['conflict'], back)
        check('and saving is on again: the plan stored in the browser is whole', back['stored'] == kept['n'] and 'Not saving' not in back['look']['status'], [back['stored'], back['look']['status']])
        # something stored that is not a plan at all, in a browser with nothing else
        for name, stored in [('an empty object', '{}'), ('the wrong shape', '{"plantings":"x","beds":3}'), ('a list', '[1,2,3]')]:
            ev("async () => { await LRFFolder.forget(); }"); ev(UNREMEMBER)
            ev("s => localStorage.setItem('lrf-next:plan', s)", stored)
            try: page.reload(); ready(); look = ev(LOOK); ev(CHANGE)
            except Exception as e: check('stored but not a plan (%s): the page opens on the sample, says so, and leaves it as it is' % name, False, str(e)[:160]); continue
            check('stored but not a plan (%s): the page opens on the sample, says so, and leaves it as it is' % name, look['ready'] and look['bad'] and look['sample'] and look['strip'] and 'could not be opened' in look['text'] and ev(STORED) == stored, look)
        page.click('#firstUse'); page.wait_for_selector('dialog.dialog')
        asked = ev("document.querySelector('dialog.dialog').innerText")
        page.locator('dialog.dialog .btn:not(.danger)').first.click(); page.wait_for_timeout(500)
        check('"Carry on from the plan shown" asks first; cancelled, nothing changes', 'gone for good' in asked and ev(STORED) == '[1,2,3]' and ev(LOOK)['bad'], asked[:160])
        page.click('#firstUse'); page.wait_for_selector('dialog.dialog'); page.locator('dialog.dialog .btn.danger').click(); page.wait_for_timeout(1800)
        on = ev("({ look: " + LOOK + ", stored: (() => { try { return Array.isArray(JSON.parse(localStorage.getItem('lrf-next:plan')).plantings); } catch (e) { return String(e); } })() })")
        check('agreed to, saving starts again from the plan shown, and the strip goes back to "no plan of yours"', on['stored'] is True and not on['look']['bad'] and on['look']['strip'] and 'No plan of yours' in on['look']['text'] and on['look']['status'] == 'Sample plan', on)
    except Exception as e:   # a step that cannot be reached is a failure with a name, not a hang
        check('the check ran to its end', False, str(e)[:500])
    check('no error was thrown on the page', not errors, errors[:5])
    browser.close()
server.shutdown()
print('\n'.join(results))
print(json.dumps({'passed': len(results) - len(failed), 'of': len(results), 'failed': failed}))
sys.exit(1 if failed else 0)
