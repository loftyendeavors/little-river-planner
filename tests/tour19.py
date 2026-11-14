"""Screens of the built site with the real typefaces, and the timeline's fit checked in them: python3 -I tour19.py <site-dir> <backup.zip> <shots-dir> <step2a_check.py>"""
import functools, http.server, json, os, re, socketserver, sys, threading
from playwright.sync_api import sync_playwright
site, backup_zip, shots, check_file = sys.argv[1:5]
os.makedirs(shots, exist_ok=True)
FITS = re.search(r'FITS = """(.*?)"""', open(check_file, encoding='utf-8').read(), re.S).group(1)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=site)); threading.Thread(target=srv.serve_forever, daemon=True).start()
url = 'http://127.0.0.1:%d/index.html' % srv.server_address[1]
out = {}
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for width, height, scheme in ((1480, 900, 'light'), (1280, 720, 'dark'), (1280, 720, 'light'), (1480, 900, 'dark')):
        ctx = b.new_context(viewport={'width': width, 'height': height}, color_scheme=scheme, service_workers='block')
        page = ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)[:300]))
        page.route('**/*', lambda r: r.continue_() if r.request.url.startswith('http://127.0.0.1') else r.abort())
        page.goto(url); page.wait_for_function('window.LRFApp && LRFApp.state.ready', timeout=30000)
        page.set_input_files('#importFile', backup_zip)
        page.wait_for_function("!LRFApp.isSample() && LRFThumbs.count() > 100 && LRFApp.state.mapImageUrl.startsWith('blob:')", timeout=180000)
        page.evaluate('document.fonts.ready'); page.wait_for_timeout(800)
        tag = '%d-%s' % (width, scheme)
        shot = lambda name: page.screenshot(path=os.path.join(shots, '%s-%s.png' % (name, tag)))
        fonts = page.evaluate("[...document.fonts].filter(f => f.status === 'loaded').map(f => f.family)")
        page.evaluate("LRFApp.setDate(new Date(LRFApp.planYear(), 5, 15))")
        page.click('[data-view-btn="timeline"]'); page.wait_for_timeout(5200)   # the line about the wheel has gone by then
        fits = {}
        shot('tl-all'); fits['all'] = page.evaluate(FITS)
        for f in ('field', 'cover', 'tower', 'crate'):
            page.click('[data-tl-filter="%s"]' % f); page.wait_for_timeout(250); shot('tl-' + f); fits[f] = page.evaluate(FITS)
        page.click('.tl-fold'); page.wait_for_timeout(200); shot('tl-crate-open'); page.click('.tl-fold[aria-expanded="true"]')
        page.click('[data-tl-filter="tower"]'); page.click('.tl-group-name'); page.wait_for_timeout(250); shot('tl-tower-open'); fits['towers-open'] = page.evaluate(FITS); page.click('.tl-group-name')
        page.click('[data-tl-filter="all"]'); page.wait_for_timeout(200)
        page.evaluate("document.querySelector('.tl-section[data-section=tower]').scrollIntoView()"); page.wait_for_timeout(200); shot('tl-towers-crates')
        page.evaluate("document.querySelector('.tl-section[data-section=trays]').scrollIntoView()"); page.wait_for_timeout(200); shot('tl-trays')
        page.evaluate("document.getElementById('tlScroll').scrollTop = 0")
        for zoom, value in (('weeks', 8), ('mid', 3.6), ('days', 26)):
            page.evaluate("LRFTimeline.setScale(%s, document.getElementById('tlCursor').getBoundingClientRect().left)" % value); page.wait_for_timeout(300); shot('tl-z' + zoom); fits['z' + zoom] = page.evaluate(FITS)
        page.click('[data-tl-zoom="months"]'); page.wait_for_timeout(200)
        page.evaluate("""() => { const S = LRFSuccession, eng = LRFApp.state.engine, o = S.openings(eng).find(o => o.whole && S.fits(eng, o).length > 3); LRFApp.select({ type: 'opening', id: o.id, bedId: o.bed.id }); document.querySelector('#ahFits .ah-fit').click(); document.querySelector('.tl-open.sel').scrollIntoView({ block: 'center' }); }""")
        page.wait_for_timeout(300); shot('opening')
        panel = page.evaluate("(() => { const p = document.getElementById('inspectorBody'); return { wide: p.scrollWidth > p.clientWidth + 1, clipped: [...p.querySelectorAll('.ah-fit, #ahSched li, .ah-around li, .stat')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.slice(0, 40)) }; })()")
        page.evaluate("document.getElementById('inspectorBody').scrollTop = 9999"); page.wait_for_timeout(150); shot('opening-review')
        # step 2b: the series tool with its ghost bars, what waits to be placed, and the question a held bed asks
        page.evaluate("document.getElementById('tlScroll').scrollTop = 0; LRFApp.openAhead({ mode: 'series', cropId: 'radish' })"); page.wait_for_selector('#srSum, #srError'); page.wait_for_timeout(350)
        page.evaluate("LRFTimeline.showGhosts()"); page.wait_for_timeout(250); shot('series'); fits['ghosts'] = page.evaluate(FITS)
        CLIP = "(() => { const p = document.getElementById('inspectorBody'), box = document.querySelector('.inspector').getBoundingClientRect(); return { wide: p.scrollWidth > p.clientWidth + 1, clipped: [...p.querySelectorAll('select, input:not([type=checkbox]), button, .sr-chip, #srWaves li > b, #srTitle, #wtTitle, .schedule li, .p-open b, h3, .eyebrow')].filter(e => e.getClientRects().length && (e.getBoundingClientRect().right > box.right + 0.5 || (!/^(SELECT|INPUT)$/.test(e.tagName) && e.scrollWidth > e.clientWidth + 1))).map(e => (e.id || e.className) + ':' + e.textContent.slice(0, 30)) }; })()"
        tool = page.evaluate(CLIP)
        page.evaluate("document.getElementById('inspectorBody').scrollTop = 9999"); page.wait_for_timeout(150); shot('series-result')
        page.click('#srPlace [data-place="beds"]'); page.wait_for_timeout(250)
        page.evaluate("(() => { const eng = LRFApp.state.engine, S = LRFSuccession, list = S.spaces(eng, eng.crop('radish'), LRFSeries.state.P.gardenIds).slice(0, 3); for (const b of list) LRFSeries.toggleBed(b.id); })()"); page.wait_for_timeout(250)
        page.evaluate("document.getElementById('inspectorBody').scrollTop = 250"); shot('series-beds'); beds = page.evaluate(CLIP)
        page.click('#srPlace [data-place="hold"]'); page.wait_for_timeout(250)
        page.evaluate("document.getElementById('srCount').value = 5; document.getElementById('srCount').dispatchEvent(new Event('change', { bubbles: true }))"); page.wait_for_timeout(300)
        page.click('#srAdd'); page.wait_for_timeout(450)
        page.evaluate("document.getElementById('tlScroll').scrollTop = 0; LRFApp.select({ type: 'waiting', id: LRFApp.waiting()[0].id })"); page.wait_for_selector('#wtHomes'); page.wait_for_timeout(300)
        shot('to-place'); fits['waiting'] = page.evaluate(FITS); wait_panel = page.evaluate(CLIP)
        heads = page.evaluate("(() => { const lib = document.querySelector('.library').getBoundingClientRect(), wh = document.getElementById('waitHead'), band = document.querySelector('.tl-waithead span').getBoundingClientRect(), view = document.getElementById('tlScroll').getBoundingClientRect(), badge = document.getElementById('waitBadge').getBoundingClientRect(), nav = document.querySelector('nav.views').getBoundingClientRect(), undo = document.getElementById('undoBtn').getBoundingClientRect(), label = document.querySelector('.tl-wait .tl-label'); return { box: [...wh.children].every(c => c.getBoundingClientRect().right <= lib.right + 0.5), rows: [...document.querySelectorAll('#waitList .wait-row')].every(r => r.scrollWidth <= r.clientWidth + 1), band: band.right <= view.right + 0.5, badge: badge.left >= nav.right - 0.5 && badge.right <= undo.left + 0.5, label: [...label.children].every(c => c.scrollWidth <= label.clientWidth + 1) }; })()")
        page.evaluate("""(() => { const A = LRFApp, eng = A.state.engine, S = LRFSuccession, w = A.waiting()[0]; for (const b of A.state.plan.beds.filter(b => eng.isSoilBed(b) && b.active !== false)) { const res = S.landing(eng, w, { bedId: b.id }); if (res.state === 'split' && res.ways.length === 2) { void A.placeWaiting(w.id, b.id); return; } } })()"""); page.wait_for_selector('#shareDlg[open]'); page.wait_for_timeout(200)
        shot('share')
        dlg = page.evaluate("(() => { const d = document.getElementById('shareDlg'), r = d.getBoundingClientRect(); return { inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, clipped: [...d.querySelectorAll('b, small, span, h2, p, button')].filter(e => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > r.right).map(e => e.textContent.slice(0, 30)) }; })()")
        page.click('#shareClose'); page.wait_for_timeout(150)
        for view in ('sow', 'harvest', 'seeds'):
            page.click('[data-view-btn="%s"]' % view); page.wait_for_timeout(300)
            heads['badge-' + view] = page.evaluate("(() => { const badge = document.getElementById('waitBadge').getBoundingClientRect(), nav = document.querySelector('nav.views').getBoundingClientRect(), undo = document.getElementById('undoBtn').getBoundingClientRect(); return badge.width > 60 && badge.left >= nav.right - 0.5 && badge.right <= undo.left + 0.5 && document.querySelector('header.top').scrollWidth <= document.querySelector('header.top').clientWidth + 1; })()")
        shot('seeds-with-count')
        page.click('[data-view-btn="map"]'); page.wait_for_timeout(400); shot('map-to-place')
        page.evaluate("LRFMap.wholeSeason(true)"); page.wait_for_timeout(400); shot('map-season'); page.evaluate("LRFMap.wholeSeason(false)")
        page.evaluate("LRFApp.undo()"); page.wait_for_timeout(250)
        panel['tool'] = [tool, beds, wait_panel, dlg, heads]
        for part in (tool, beds, wait_panel):
            panel['wide'] = panel['wide'] or part['wide']; panel['clipped'] = panel['clipped'] + part['clipped']
        panel['clipped'] = panel['clipped'] + dlg['clipped'] + ([] if dlg['inside'] else ['share dialog outside the window']) + [k for k, v in heads.items() if not v]
        page.click('[data-view-btn="map"]'); page.evaluate('LRFApp.select(null)'); page.wait_for_timeout(500); shot('map')
        out[tag] = {'fonts': sorted(set(fonts)), 'fits': {k: [round(v['ppd'], 2), v['tally'], v['count'], v['bad'][:2]] for k, v in fits.items()}, 'panel': panel, 'errors': errs[:3], 'views': page.eval_on_selector_all('[data-view-btn]', 'els => els.map(e => e.textContent)')}
        ctx.close()
    b.close()
srv.shutdown()
bad = {k: v for k, v in out.items() if v['errors'] or v['panel']['wide'] or v['panel']['clipped'] or any(f[2] for f in v['fits'].values()) or len(v['fonts']) < 3}
print(json.dumps(out, indent=1)[:6000])
print(json.dumps({'passed': len(out) - len(bad), 'of': len(out), 'failed': sorted(bad)}))
