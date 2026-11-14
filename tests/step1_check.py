"""Step 1 (preview 0.16) in a real browser: names, the opening label, a seed lot in one line, "To settle" wording,
the garden retyped, and pictures: kept across a plan-only load, added to an open plan, rebuilt from where they came from.

usage: python3 -I step1_check.py <app-dir> <backup-dir> <backup.zip> <shots-dir> [photo-pack.json]

<app-dir>     the app folder with its data/ (plan, thumbnails, farm photo)
<backup-dir>  a complete backup unpacked: plan.json, files/<sha256>
<backup.zip>  the same backup as one .zip
No network is used: supplier addresses are answered here, some with pictures and some refusing, as real suppliers do.
"""
import base64, functools, http.server, json, os, re, shutil, socketserver, sys, tempfile, threading
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

app, backup, backup_zip, shots = sys.argv[1:5]
os.makedirs(shots, exist_ok=True)
results, failed = [], []


def check(name, ok, detail=None):
    results.append(('ok   ' if ok else 'FAIL ') + name + ('' if detail is None else ' ' + json.dumps(detail, default=str)[:600]))
    if not ok:
        failed.append(name)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve(folder):
    server = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=folder))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, 'http://127.0.0.1:%d/index.html' % server.server_address[1]


# The app with nothing of the farm's beside it: it opens on the sample plan, as the public site does.
bare = tempfile.mkdtemp(prefix='lrf-bare-')
for name in ('index.html', 'js', 'css'):
    src = os.path.join(app, name)
    (shutil.copytree if os.path.isdir(src) else shutil.copy)(src, os.path.join(bare, name))
plan_file = os.path.join(backup, 'plan.json')
plan = json.load(open(plan_file, encoding='utf-8'))
all_photos = [v for v in plan['varieties'] if v.get('photo')]                                     # 151: every record with a photo, removed varieties too
with_photo = [v for v in all_photos if v.get('active', True) and not v.get('deleted')]            # the ones in the library now
# Where a picture came from, as the app reads a photo record: its sourceUrl, else its url, when that is an https address.
source = lambda v: next((u for u in (v['photo'].get('sourceUrl'), v['photo'].get('url')) if isinstance(u, str) and re.match(r'https://\S+$', u, re.I)), '') if isinstance(v['photo'], dict) else ''
host = lambda url: urlsplit(url).hostname or ''
hosts = sorted({host(source(v)) for v in with_photo if source(v)})
OPEN = hosts[0] if hosts else ''   # the supplier that hands its pictures to any page: the first of the plan's suppliers by address. Every other refuses.
hands_over = lambda url: (OPEN and host(url) == OPEN) or 'johnnyseeds.com' in url   # and the site whose page is read from a link further down
handed = [v for v in with_photo if source(v) and hands_over(source(v))]
refused = [v for v in with_photo if source(v) and not hands_over(source(v))]   # shown from their supplier's address, and not to be had by a page
map_sha = plan['map']['imageFile']['sha256']
farm_photo = os.path.join(backup, 'files', map_sha)
thumbs_file = os.path.join(app, 'data', 'thumbs.json')
# a small real JPEG to answer supplier requests with
import io
from PIL import Image
_buf = io.BytesIO(); Image.new('RGB', (320, 240), (86, 140, 92)).save(_buf, 'JPEG', quality=80); JPEG = _buf.getvalue()

READY = 'window.LRFApp && LRFApp.state.ready'
asked = {'fetched': 0, 'refused': 0, 'shown': 0}


def suppliers(route):
    """One supplier hands its pictures to any page (a site with open sharing); every other supplier's answer can be shown in an <img> but not read by a page."""
    url, kind = route.request.url, route.request.resource_type
    if url.startswith('http://127.0.0.1'):
        return route.continue_()
    if kind == 'image':
        asked['shown'] += 1
        return route.fulfill(status=200, content_type='image/jpeg', body=JPEG)
    if kind not in ('fetch', 'xhr'):
        return route.abort()   # web fonts and the like: there is no network here
    if hands_over(url):
        asked['fetched'] += 1
        return route.fulfill(status=200, content_type='image/jpeg', headers={'Access-Control-Allow-Origin': '*'}, body=JPEG)
    asked['refused'] += 1
    return route.abort()   # as a supplier with no sharing header: the page's own fetch fails, though an <img> still shows the picture


def new_page(browser, url, width=1480, height=900, scheme='light', net=None):
    ctx = browser.new_context(viewport={'width': width, 'height': height}, color_scheme=scheme)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)[:400]))
    page.on('console', lambda m: errors.append(m.text[:300]) if m.type == 'error' and 'fonts.g' not in m.text and 'ERR_' not in m.text and 'CORS' not in m.text and 'Failed to load resource' not in m.text else None)
    page.route('**/*', net or (lambda route: route.continue_() if route.request.url.startswith('http://127.0.0.1') else route.abort()))
    page.goto(url)
    page.wait_for_function(READY, timeout=30000)
    page.wait_for_timeout(400)
    return ctx, page, errors


def view(page, name):
    page.click('[data-view-btn="%s"]' % name)
    page.wait_for_timeout(350)


def toast(page):
    return page.evaluate("document.getElementById('toast').classList.contains('show') ? document.getElementById('toast').innerText : ''")


def confirm(page, label=None):
    """Press the confirming button of the dialog that is open, if one is."""
    if page.locator('dialog.dialog[open] .dialog-actions .btn.primary, dialog.dialog[open] .dialog-actions .btn.danger').count():
        page.locator('dialog.dialog[open] .dialog-actions .btn.primary, dialog.dialog[open] .dialog-actions .btn.danger').last.click()
        page.wait_for_timeout(300)
        return True
    return False


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])

    # ═══ A. the app with its own data: names, labels, the one-line lot, wording, the garden ═══
    server_a, url_a = serve(app)
    ctx, page, errors = new_page(browser, url_a)
    check('the build says 0.39', '0.39' in page.evaluate("document.getElementById('buildNote').textContent"))
    seen = {}
    for name in ('map', 'timeline', 'sow', 'trays', 'harvest', 'assume', 'seeds'):
        view(page, name)
        seen[name] = page.evaluate("document.body.innerText")
    old = [n for n, text in seen.items() if 'Shared heated space' in text or 'shared heated' in text.lower() or 'Counted from' in text]
    check('no view says “Shared heated space” or “Counted from”', not old, old)
    check('the timeline has the heated greenhouse benches as a group', 'heated greenhouse benches' in seen['timeline'].lower())
    check('the seed list’s column is “Days counted from”', 'Days counted from' in seen['seeds'])
    note = page.evaluate("""(() => { const p = LRFApp.state.plan, g = p.gardens.filter(x => x.liveTrayPool === true), f = ((p.lrfNext || {}).facts || {}).gardens || {};
      return { names: g.map(x => x.name), noted: g.some(x => f[x.id]) }; })()""")
    check('the garden record is renamed in the plan as it opens, with nothing for a later backup to be told', note['names'] == ['Heated greenhouse benches'] and not note['noted'], note)

    # the opening label is never clipped, at any zoom
    view(page, 'timeline')
    kinds = {'full': 0, 'short': 0, 'bare': 0}
    clipped = []
    for zoom in page.eval_on_selector_all('[data-tl-zoom]', 'els => els.map(e => e.dataset.tlZoom)'):
        page.click('[data-tl-zoom="%s"]' % zoom)
        page.wait_for_timeout(300)
        boxes = page.eval_on_selector_all('.tl-open', """els => els.map(e => { const r = document.createRange(); r.selectNodeContents(e); const t = r.getBoundingClientRect(), b = e.getBoundingClientRect(), cs = getComputedStyle(e);
          return { text: e.textContent, box: b.width, inner: e.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), ink: t.width, title: e.title, days: e.title.match(/: ([\\d,]+) days/)[1] }; })""")
        for b in boxes:
            kind = 'bare' if not b['text'] else 'short' if b['text'].endswith(' d') else 'full' if b['text'].endswith(' days open') else '?'
            kinds[kind] = kinds.get(kind, 0) + 1
            if b['text'] and (b['ink'] > b['inner'] + 0.6 or not b['text'].startswith(b['days'])):
                clipped.append({'zoom': zoom, **b})
            if not b['title'].startswith('Open '):
                clipped.append({'zoom': zoom, 'no title': b})
    check('every opening’s label fits its box: words in full, “26 d”, or none, with the detail on hover', not clipped and kinds.get('?', 0) == 0 and kinds['full'] > 0 and kinds['short'] > 0, {'kinds': kinds, 'clipped': clipped[:3]})
    # a bar names its crop first, then its variety; the crop's name is the last thing to give way, and nothing is cut off
    bars_by_zoom = {}
    for zoom in page.eval_on_selector_all('[data-tl-zoom]', 'els => els.map(e => e.dataset.tlZoom)'):
        page.click('[data-tl-zoom="%s"]' % zoom)
        page.wait_for_timeout(300)
        bars_by_zoom[zoom] = page.evaluate("""(() => { const eng = LRFApp.state.engine, out = { bars: 0, both: 0, crop: 0, bare: 0, pics: 0, bad: [] };
          const plain = n => String(n || '').replace(/\\s*\\([^)]*\\)\\s*$/, '').trim() || String(n || '');
          for (const el of document.querySelectorAll('.tl-row:not(.tl-pool) .tl-bar[data-planting]')) {
            const p = eng.planting(el.dataset.planting), r = eng.calc(p), name = el.querySelector('.tl-name'), text = name.textContent, crop = r.c.name, variety = r.c.vname || '';
            out.bars++; if (name.querySelector('.thumb img')) out.pics++;
            const ok = text === '' || text === crop || text === plain(crop) || (variety && (text === crop + ' · ' + variety || text === plain(crop) + ' · ' + variety));
            if (!text) out.bare++; else if (text.includes(' · ')) out.both++; else out.crop++;
            const fits = name.scrollWidth <= name.clientWidth + 1 && name.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1;
            if (!ok || !fits || !el.title.toLowerCase().includes(crop.toLowerCase())) out.bad.push({ text, crop, variety, ok, fits, w: Math.round(el.getBoundingClientRect().width) });
          }
          out.bad = out.bad.slice(0, 4); return out; })()""")
    worst = [z for z, b in bars_by_zoom.items() if b['bad']]
    widest = bars_by_zoom['days']
    check('every timeline bar names its crop first, then its variety where there is room; none is cut off; the hover names both', not worst and all(b['bars'] > 100 for b in bars_by_zoom.values()) and widest['both'] > widest['crop'] and widest['pics'] > 100, bars_by_zoom)
    # pressing on a picture starts the planner's drag, not the browser's dragging of the image (which cancels it)
    page.evaluate("window.__ev = []; for (const t of ['dragstart', 'pointercancel']) window.addEventListener(t, e => window.__ev.push(t), true)")
    grabbed = {}
    for what, selector in (('a bar on the timeline', '.tl-row:not(.tl-pool) .tl-bar[data-planting] .thumb img'), ('a crop in the library', '#libList .lib-row .thumb img')):
        page.evaluate("(sel) => { const s = document.getElementById('tlScroll').getBoundingClientRect(), el = [...document.querySelectorAll(sel)].find(e => { const r = e.getBoundingClientRect(); return !sel.startsWith('.tl-row') || (r.left > s.left + 160 && r.right < s.right - 60); }); el.setAttribute('data-grab', '1'); el.scrollIntoView({ block: 'center' }); }", selector)
        page.wait_for_timeout(150)
        box = page.locator('[data-grab="1"]').bounding_box()
        page.evaluate("document.querySelector('[data-grab]').removeAttribute('data-grab')")
        page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        page.mouse.down()
        page.mouse.move(box['x'] + 30, box['y'] + 30, steps=4)
        page.wait_for_timeout(80)
        grabbed[what] = {'dragging': page.evaluate('LRFDrag.active()'), 'events': page.evaluate('window.__ev.splice(0)')}
        page.keyboard.press('Escape')
        page.mouse.up()
        page.wait_for_timeout(100)
    check('a drag can start on a photo: on a timeline bar and in the crop library', all(g['dragging'] and not g['events'] for g in grabbed.values()), grabbed)
    page.click('[data-tl-zoom="months"]')
    page.screenshot(path=os.path.join(shots, 'timeline-openings-1480.png'))

    # a seed lot in one line
    view(page, 'seeds')
    lots0 = page.evaluate("(LRFApp.inventoryNow().lots || []).filter(l => !l.deleted).length")
    pick = page.evaluate("""(() => { const eng = LRFApp.state.engine, vs = LRFApp.state.plan.varieties.filter(v => v.active !== false && !v.deleted && v.supplier && !eng.crop(v.cropId).micro && eng.crop(v.cropId).plantingMaterial !== 'plant');
      const names = new Map(); for (const v of LRFApp.state.plan.varieties) names.set(v.name.toLowerCase(), (names.get(v.name.toLowerCase()) || 0) + 1);
      const v = vs.find(x => names.get(x.name.toLowerCase()) === 1 && x.name.length > 6); return { id: v.id, name: v.name, supplier: v.supplier, crop: eng.crop(v.cropId).name }; })()""")
    page.fill('#qlVariety', pick['name'][:-1])
    page.wait_for_timeout(150)
    listed = page.eval_on_selector_all('#qlList li', 'els => els.map(e => e.innerText.replace(/\\s+/g, " "))')
    check('typing part of a name lists the varieties that fit, with crop and supplier', any(pick['name'] in x for x in listed) and len(listed) <= 9, listed[:4])
    page.fill('#qlVariety', pick['name'])
    page.wait_for_timeout(150)
    page.press('#qlVariety', 'Enter')
    page.wait_for_timeout(150)
    state = page.evaluate("({ vendor: document.getElementById('qlVendor').value, tag: document.querySelector('.ql-tag').textContent, focus: document.activeElement.id, year: document.getElementById('qlYear').value, unit: document.querySelector('.ql-unit').textContent })")
    check('Enter picks it: its crop is shown, its vendor filled in, the year is this year, the cursor is on the amount', state['vendor'] == pick['supplier'] and state['tag'] == pick['crop'] and state['focus'] == 'qlAmount' and len(state['year']) == 4 and state['unit'] == 'seeds', state)
    page.screenshot(path=os.path.join(shots, 'seeds-quick-lot-1480.png'))
    before = page.evaluate("(LRFApp.stockNow()['v:%s|seeds'] || { onHand: 0 }).onHand" % pick['id'])
    page.fill('#qlAmount', '500')
    page.press('#qlAmount', 'Enter')
    page.wait_for_timeout(400)
    after = page.evaluate("""(() => { const lots = LRFApp.inventoryNow().lots.filter(l => !l.deleted), lot = lots[lots.length - 1];
      return { lots: lots.length, onHand: (LRFApp.stockNow()['v:%s|seeds'] || { onHand: 0 }).onHand, lot: { key: lot.key, q: lot.quantity, year: lot.year, supplier: lot.supplier, status: lot.status },
        sel: document.querySelector('#sdPanel h2') && document.querySelector('#sdPanel h2').textContent, focus: document.activeElement.id, name: document.getElementById('qlVariety').value, amount: document.getElementById('qlAmount').value, vendor: document.getElementById('qlVendor').value, undo: LRFApp.state.undo.length }; })()""" % pick['id'])
    check('Enter saves: one lot more, 500 seeds on hand for that variety, vendor and year on the lot', after['lots'] == lots0 + 1 and after['onHand'] == before + 500 and after['lot']['q'] == 500 and after['lot']['key'] == 'v:' + pick['id'] and after['lot']['supplier'] == pick['supplier'] and after['lot']['status'] == 'usable' and str(after['lot']['year']) == state['year'], after)
    check('the line is ready for the next packet: variety and amount cleared, vendor kept, cursor back on the variety, and the panel shows the variety just added to', after['name'] == '' and after['amount'] == '' and after['vendor'] == pick['supplier'] and after['focus'] == 'qlVariety' and after['sel'] == pick['name'], after)
    check('it says what it did, with Undo', pick['name'] in toast(page) and '500' in toast(page) and 'Undo' in toast(page), toast(page))
    page.click('#toast .toast-action')
    page.wait_for_timeout(300)
    check('one Undo takes the lot back', page.evaluate("(LRFApp.inventoryNow().lots || []).filter(l => !l.deleted).length") == lots0)
    # a variety that is not in the library yet, ordered
    page.fill('#qlVendor', 'Fedco Seeds')
    page.fill('#qlVariety', 'Zz Quick Line Test')
    page.wait_for_timeout(150)
    offered = page.eval_on_selector_all('#qlList li', 'els => els.map(e => e.innerText.replace(/\\s+/g, " "))')
    page.press('#qlVariety', 'Enter')
    page.wait_for_timeout(200)
    crop_shown = page.evaluate("({ hidden: document.getElementById('qlCrop').hidden, focus: document.activeElement.id, options: document.getElementById('qlCrop').options.length })")
    check('a name that is not in the library is offered as a new variety, and its crop is asked for next', any('New variety' in x for x in offered) and crop_shown['hidden'] is False and crop_shown['focus'] == 'qlCrop' and crop_shown['options'] > 20, {'offered': offered, **crop_shown})
    page.fill('#qlAmount', '40')
    page.press('#qlAmount', 'Enter')
    page.wait_for_timeout(200)
    check('without a crop it is not saved, and says why', 'Choose its crop' in page.inner_text('#qlSay') and page.evaluate("(LRFApp.inventoryNow().lots || []).filter(l => !l.deleted).length") == lots0, page.inner_text('#qlSay'))
    crop_id = page.evaluate("LRFApp.state.engine.crops().find(c => /^Kale/.test(c.name)).id")
    page.select_option('#qlCrop', crop_id)
    page.click('.ql-where [data-where="ordered"]')
    page.fill('#qlAmount', '40')
    page.press('#qlAmount', 'Enter')
    page.wait_for_timeout(400)
    made = page.evaluate("""(() => { const v = LRFApp.state.plan.varieties.find(x => x.name === 'Zz Quick Line Test'), lots = LRFApp.inventoryNow().lots.filter(l => !l.deleted), lot = lots[lots.length - 1];
      return v ? { crop: v.cropId, supplier: v.supplier, lotKey: lot.key === 'v:' + v.id, status: lot.status, q: lot.quantity, onOrder: (LRFApp.stockNow()['v:' + v.id + '|seeds'] || {}).onOrder, steps: LRFApp.state.undo.length, inList: !!document.querySelector('[data-variety="' + v.id + '"]') } : null; })()""")
    check('with its crop chosen, the variety and its lot are added in one step, as an order', bool(made) and made['crop'] == crop_id and made['supplier'] == 'Fedco Seeds' and made['lotKey'] and made['status'] == 'ordered' and made['q'] == 40 and made['onOrder'] == 40 and made['inList'], made)
    page.evaluate('LRFApp.undo()')
    page.wait_for_timeout(300)
    check('one Undo takes both back', page.evaluate("!LRFApp.state.plan.varieties.some(x => x.name === 'Zz Quick Line Test') && (LRFApp.inventoryNow().lots || []).filter(l => !l.deleted).length") == lots0)
    for width in (1280, 1480):
        page.set_viewport_size({'width': width, 'height': 900})
        page.wait_for_timeout(250)
        fit = page.evaluate("(() => { const f = document.querySelector('.sd-quick-form'), kids = [...f.children].filter(e => e.offsetParent && e.tagName !== 'DATALIST'), tops = new Set(kids.map(e => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2))), r = f.getBoundingClientRect(), last = kids[kids.length - 1].getBoundingClientRect(); return { lines: tops.size, inside: last.right <= r.right + 0.5, variety: document.getElementById('qlVariety').getBoundingClientRect().width }; })()")
        check('at %d wide the line is one line, inside its box, with room to type a name' % width, fit['lines'] == 1 and fit['inside'] and fit['variety'] >= 150, fit)
        page.screenshot(path=os.path.join(shots, 'seeds-%d.png' % width))
    page.set_viewport_size({'width': 1480, 'height': 900})

    # the seed list: a variety sits under its crop; a lot can be started from its row; the panel's plantings keep their bed number
    view(page, 'seeds')
    page.evaluate("LRFSeeds.select(null)")
    page.wait_for_timeout(300)
    tiers = page.evaluate("""(() => { let crop = null, bad = 0, n = 0; for (const tr of document.querySelectorAll('#sdBody tr')) { const t = tr.querySelector('.thumb'); if (!t) continue; const x = t.getBoundingClientRect().left; if (tr.classList.contains('sd-crop')) crop = x; else if (tr.classList.contains('sd-var')) { n++; if (crop == null || !(x >= crop + 16)) bad++; } } return { rows: n, bad }; })()""")
    check('in the seed list every variety is plainly indented under its crop, never level with it or to its left', tiers['rows'] > 50 and tiers['bad'] == 0, tiers)
    row = page.evaluate("""(() => { const eng = LRFApp.state.engine, v = LRFApp.state.plan.varieties.find(x => x.active !== false && !x.deleted && x.supplier && !eng.crop(x.cropId).micro && eng.crop(x.cropId).plantingMaterial !== 'plant' && document.querySelector('.sd-var[data-variety="' + x.id + '"]')); document.querySelector('.sd-var[data-variety="' + v.id + '"]').scrollIntoView({ block: 'center' }); return { id: v.id, name: v.name, supplier: v.supplier, lots: LRFApp.inventoryNow().lots.filter(l => !l.deleted).length }; })()""")
    page.hover('.sd-var[data-variety="%s"]' % row['id'])
    page.wait_for_timeout(150)
    page.click('.sd-var[data-variety="%s"] .sd-addlot' % row['id'])
    page.wait_for_timeout(200)
    filled = page.evaluate("({ under: (document.querySelector('.sd-lotrow') || { previousElementSibling: { dataset: {} } }).previousElementSibling.dataset.variety, vendor: (document.getElementById('lrVendor') || {}).value, focus: document.activeElement.id, top: document.getElementById('qlVariety').value })")
    page.keyboard.type('250')
    page.keyboard.press('Enter')
    page.wait_for_timeout(400)
    got = page.evaluate("(() => { const lots = LRFApp.inventoryNow().lots.filter(l => !l.deleted), lot = lots[lots.length - 1]; return { n: lots.length, key: lot.key, q: lot.quantity }; })()")
    check('“+ lot” on a variety’s row opens a line under that row with its vendor, waiting for the amount; Enter adds the lot', filled['under'] == row['id'] and filled['vendor'] == row['supplier'] and filled['focus'] == 'lrAmount' and filled['top'] == '' and got['n'] == row['lots'] + 1 and got['key'] == 'v:' + row['id'] and got['q'] == 250, {'filled': filled, 'got': got})
    page.evaluate('LRFApp.undo()')
    page.wait_for_timeout(300)
    by_name = page.evaluate("(() => { const s = document.getElementById('sdSort'); s.value = 'name'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()")
    page.wait_for_timeout(400)
    flat = page.evaluate("({ grouped: document.querySelectorAll('#sdBody .sd-var.in-group').length, rows: document.querySelectorAll('#sdBody .sd-var').length })")
    page.evaluate("(() => { const s = document.getElementById('sdSort'); s.value = 'crop'; s.dispatchEvent(new Event('change', { bubbles: true })); })()")
    page.wait_for_timeout(400)
    check('sorted by name there are no groups, so nothing is indented', flat['rows'] > 50 and flat['grouped'] == 0, flat)
    shared = page.evaluate("""(() => { const eng = LRFApp.state.engine; for (const p of LRFApp.state.plan.plantings) { const r = eng.calc(p); if (r && r.sowing && r.sowing.shared && p.varietyId && !r.tw) { LRFSeeds.select({ type: 'variety', id: p.varietyId }); const b = r.sowing.batch; return { p: p.id, v: p.varietyId, seeds: b.seeds, rows: b.rowsSown, cols: b.tray.columns, tray: b.tray.name, trays: b.trayGroup ? b.trayGroup.trays : b.trays, members: r.sowing.memberIds.length, cells: r.sowing.cells, mine: r.sowing.seeds }; } } })()""")
    page.wait_for_timeout(400)
    where = page.evaluate("[...document.querySelectorAll('#sdPanel .sd-pl')].map(b => { const p = null, em = b.querySelector('span em'), s = b.querySelector('span'); return { em: em && em.textContent, title: s.title, emShown: em && em.getBoundingClientRect().right <= b.getBoundingClientRect().right }; })")
    check('each planting in the variety’s panel shows its bed’s own number, ahead of the garden’s name', len(where) > 1 and all(w['em'] and w['emShown'] and w['title'].endswith(w['em'].split(' ')[-1]) for w in where), where[:3])
    # the sowing note, set out as figures
    view(page, 'map')
    page.evaluate("LRFApp.select({ type: 'planting', id: '%s' })" % shared['p'])
    page.wait_for_timeout(400)
    note = page.evaluate("(() => { const el = document.getElementById('sowHow'); if (!el) return null; const figs = Object.fromEntries([...el.querySelectorAll('.sow-fig')].map(f => [f.querySelector('span').textContent, f.querySelector('b').textContent.replace(/,/g, '')])); return { head: el.querySelector('.sow-head b').textContent, tag: (el.querySelector('.sow-tag') || {}).textContent, figs, share: [...el.querySelectorAll('.sow-share b')].map(b => b.textContent.replace(/,/g, '')), foot: (el.querySelector('.sow-foot') || {}).textContent, prose: el.textContent.includes('Sown as one batch with'), oneLine: [...el.querySelectorAll('.sow-fig b, .sow-fig span')].every(x => x.getClientRects().length === 1) }; })()")
    want_trays = 'Trays (shared)' if note and 'Trays (shared)' in note['figs'] else 'Trays'
    check('the sowing note is set out as figures: what it is sown in, seeds, rows and trays of the batch, this planting’s share, then the allowances', bool(note) and note['head'] == shared['tray'] and note['tag'] == 'one batch · %d plantings of this variety' % shared['members'] and note['figs'].get('Seeds') == str(shared['seeds']) and note['figs'].get('Rows of %d' % shared['cols']) == str(shared['rows']) and note['figs'].get(want_trays) == str(shared['trays']) and note['share'] == ['%d cells' % shared['cells'], '%d seeds' % shared['mine']] and 'germination' in note['foot'] and not note['prose'] and note['oneLine'], {'note': note, 'engine': shared})
    gaps = page.evaluate("[...document.querySelectorAll('#inspectorBody .stats')].map(s => { const last = s.lastElementChild.getBoundingClientRect(), box = s.getBoundingClientRect(); return Math.abs(last.right - box.right) < 1.5; })")
    check('no row of figures in the panel ends in an empty grey block', len(gaps) >= 1 and all(gaps), gaps)
    page.screenshot(path=os.path.join(shots, 'sowing-note-1480.png'))

    # "To settle" in plain words
    view(page, 'map')
    page.evaluate('LRFApp.select(null)')
    setup = page.evaluate("""(() => { const eng = LRFApp.state.engine, plan = LRFApp.state.plan;
      for (const g of plan.gardens) { const beds = plan.beds.filter(b => b.gardenId === g.id && b.active !== false && eng.isSoilBed(b)), full = beds.filter(b => eng.plantingsIn(b.id).some(p => { const r = eng.calc(p); return r && !r.partial; }));
        if (beds.length >= 3 && full.length >= 2 && beds.every(b => b.l === beds[0].l)) { const l = beds[0].l; LRFApp.commit('test: shorter beds', beds.map(b => ({ kind: 'bed', before: b, after: { ...b, l: l - 2 } })), { unchecked: true }); return { garden: g.name, was: l, now: l - 2 }; } }
      return null; })()""")
    page.wait_for_timeout(500)
    cards = page.eval_on_selector_all('.cleanup .fix p:not(.help)', 'els => els.map(e => e.textContent)')
    if page.locator('.cleanup .fix-more').count():
        page.click('.cleanup .fix-more')
        page.wait_for_timeout(200)
        cards = page.eval_on_selector_all('.cleanup .fix p:not(.help)', 'els => els.map(e => e.textContent)')
    import re
    want = setup and [c for c in cards if re.search(r'^\d+ plantings? (is|are) [\d.]+ ft long, but (the beds in %s are|bed .+ in %s is) [\d.]+ ft\.$' % (re.escape(setup['garden']), re.escape(setup['garden'])), c)]
    check('an over-long set reads “N plantings are X ft long, but the beds in <garden> are Y ft.”', bool(want), {'setup': setup, 'cards': cards[:4]})
    check('no card speaks of trays, batches or a 0-sized space', not [c for c in cards if re.search(r'tray|batch|\b0-| 0 ft', c)], cards[:6])
    page.screenshot(path=os.path.join(shots, 'to-settle-1480.png'))
    page.evaluate('LRFApp.undo()')
    page.wait_for_timeout(300)

    # a bed's size: read at a glance from its panel, and changed in one place only, the layout on the map
    view(page, 'map')
    bed = page.evaluate("""(() => { const eng = LRFApp.state.engine, b = LRFApp.state.plan.beds.find(x => x.active !== false && eng.isSoilBed(x) && eng.plantingsIn(x.id).length === 0 && x.px && x.l >= 6); if (!b) return null; LRFApp.select({ type: 'bed', id: b.id }); return { id: b.id, w: b.w, l: b.l }; })()""")
    check('there is an empty bed on the photo, at least 6 ft long, to try sizes on', bed is not None, bed)
    bed = bed or {'id': 'none', 'w': 0, 'l': 0}   # with no subject the lines below fail by name; the check does not stop
    page.wait_for_timeout(300)
    PANEL = "({ w: (document.querySelector('#bedWidth b') || {}).textContent || '', l: (document.querySelector('#bedLength b') || {}).textContent || '', a: (document.querySelector('#bedArea b') || {}).textContent || '', inputs: document.querySelectorAll('#inspectorBody input, #inspectorBody select').length, edit: !!document.getElementById('bedSizeEdit'), form: !!document.getElementById('bedSizeForm'), layout: !!document.getElementById('bedLayoutEdit') })"
    shown = page.evaluate(PANEL)
    fmt = lambda n: ('%g' % n)
    check('a selected bed shows its width, length and area, and the panel holds nothing to type a size in: no field, no size form, one link to the layout', shown['w'] == fmt(bed['w']) and shown['l'] == fmt(bed['l']) and shown['a'].replace(',', '') == fmt(round(bed['w'] * bed['l'])) and shown['inputs'] == 0 and not shown['edit'] and not shown['form'] and shown['layout'], {'bed': bed, 'shown': shown})
    lines = {}
    for width in (1100, 1280, 1480):
        page.set_viewport_size({'width': width, 'height': 900})
        page.wait_for_timeout(200)
        lines[width] = page.evaluate("[...document.querySelectorAll('#bedDims .stat')].map(e => [...e.children].every(c => c.getClientRects().length === 1 && c.scrollWidth <= c.clientWidth + 1))")
    page.set_viewport_size({'width': 1480, 'height': 900})
    check('each figure and its label sit on one line, unclipped, down to a narrow window', all(all(v) and len(v) == 3 for v in lines.values()), lines)
    page.screenshot(path=os.path.join(shots, 'bed-panel-1480.png'))
    # the one way to a size from here: the link opens the layout on the map, with this bed picked and its length ready to type
    if shown['layout']:
        page.click('#bedLayoutEdit')
    page.wait_for_timeout(600)
    steps = page.evaluate('LRFApp.state.undo.length')
    opened = page.evaluate("({ on: !!(window.LRFMapEdit && LRFMapEdit.on()), picked: window.LRFMapEdit ? LRFMapEdit.picked() : null, sel: LRFApp.state.sel, w: (document.getElementById('fLayW') || {}).value, l: (document.getElementById('fLayL') || {}).value })")
    check('“Edit the layout…” opens the layout with that bed picked, its width and length there to type', opened['on'] and opened['picked'] == [bed['id']] and opened['sel'] is None and opened['w'] not in (None, '') and opened['l'] not in (None, '') and float(opened['w']) == bed['w'] and float(opened['l']) == bed['l'], opened)
    if opened['l'] is not None and opened['on']:
        page.fill('#fLayL', str(bed['l'] - 2))
        page.press('#fLayL', 'Tab')
    page.wait_for_timeout(300)
    typed = page.evaluate("({ l: (LRFApp.state.engine.bedOf('%s') || {}).l, steps: LRFApp.state.undo.length, undo: (LRFApp.state.undo[LRFApp.state.undo.length - 1] || {}).label || '' })" % bed['id'])
    page.evaluate("window.LRFMapEdit && LRFMapEdit.close()")
    page.evaluate("LRFApp.select({ type: 'bed', id: '%s' })" % bed['id'])
    page.wait_for_timeout(250)
    after = page.evaluate(PANEL)
    check('a length typed in the layout is one undoable step, and the bed’s panel shows it once the layout is left, still with nothing to type in', typed['l'] == bed['l'] - 2 and typed['steps'] == steps + 1 and 'length' in typed['undo'] and after['l'] == fmt(bed['l'] - 2) and after['a'].replace(',', '') == fmt(round(bed['w'] * (bed['l'] - 2))) and after['inputs'] == 0 and not after['form'], {'typed': typed, 'after': after, 'steps': steps})
    page.evaluate('LRFApp.undo()')
    page.wait_for_timeout(250)
    undone = page.evaluate("({ l: (LRFApp.state.engine.bedOf('%s') || {}).l, shown: (document.querySelector('#bedLength b') || {}).textContent, steps: LRFApp.state.undo.length })" % bed['id'])
    check('one Undo puts the length back, in the plan and in the panel', undone['l'] == bed['l'] and undone['shown'] == fmt(bed['l']) and undone['steps'] == steps, undone)
    tower = page.evaluate("(() => { const eng = LRFApp.state.engine, b = LRFApp.state.plan.beds.find(x => x.active !== false && eng.isTower(x)); LRFApp.select({ type: 'bed', id: b.id }); return eng.capOf(b); })()")
    page.wait_for_timeout(250)
    held = page.evaluate("({ label: document.querySelector('#bedHolds span').textContent, n: document.querySelector('#bedHolds b').textContent, inputs: document.querySelectorAll('#inspectorBody input, #inspectorBody select').length, form: !!document.getElementById('bedSizeForm') })")
    check('a tower shows its sites the same way, with nothing to type in', held['label'] == 'Sites' and held['n'] == str(tower) and held['inputs'] == 0 and not held['form'], held)
    page.evaluate('LRFApp.select(null)')

    # the garden retyped: one choice on the Assumptions view, shown before it lands, one undo
    view(page, 'assume')
    page.evaluate("document.querySelector('#asPlaces') && (document.querySelector('#asPlaces').open = true)")
    # a garden of the plan typed as a greenhouse, whose conditions can be chosen (beds, not towers or living trays) and which has plantings: the first as the list shows them
    garden = page.evaluate("""(() => { const eng = LRFApp.state.engine, plan = LRFApp.state.plan, offered = new Set([...document.querySelectorAll('#asPlacesBody select')].map(s => s.getAttribute('aria-label')));
      const g = [...plan.gardens].sort((a, b) => String(a.name).localeCompare(String(b.name))).find(g => g.type === 'greenhouse' && g.active !== false && offered.has('Growing conditions in ' + g.name) && plan.beds.some(b => b.gardenId === g.id && b.active !== false && eng.plantingsIn(b.id).length));
      return g ? { id: g.id, name: g.name, type: g.type } : null; })()""")
    check('the plan has a garden typed as a greenhouse, with plantings in it, to retype', garden is not None, garden)
    if garden:
        page.evaluate("(() => { for (const d of document.querySelectorAll('details')) d.open = true; })()")
        sel = 'select[aria-label="Growing conditions in %s"]' % garden['name']
        page.select_option(sel, 'field')
        page.wait_for_timeout(500)
        asked_first = confirm(page)
        page.wait_for_timeout(400)
        now = page.evaluate("(() => { const g = LRFApp.state.plan.gardens.find(x => x.id === '%s'); return { type: g.type, frost: g.frost, env: LRFApp.state.engine.envOf(LRFApp.state.plan.beds.find(b => b.gardenId === g.id)), undo: LRFApp.state.undo[LRFApp.state.undo.length - 1].label }; })()" % garden['id'])
        said = toast(page)
        check('“%s” becomes open field in one choice (asked first when it books ground twice: %s)' % (garden['name'], asked_first), now['type'] == 'field' and now['frost'] is True and now['env'] == 'field', now)
        check('and it says what that did to the plan, not that nothing grows there', 'uses it yet' not in said and ('dates change' in said or 'harvest' in said or 'shift' in said), said)
        page.evaluate('LRFApp.undo()')
        page.wait_for_timeout(300)
        check('and one Undo puts it back', page.evaluate("LRFApp.state.plan.gardens.find(x => x.id === '%s').type" % garden['id']) == 'greenhouse')
    check('A: no errors on the page', not errors, errors[:3])
    ctx.close()

    # ═══ B. a plan-only file, as he loaded it: what is missing is said, fetched where it can be, and added from files ═══
    server_b, url_b = serve(bare)
    ctx, page, errors = new_page(browser, url_b, net=suppliers)
    check('with nothing beside it the app opens on the sample plan, and says nothing of missing pictures', page.evaluate('LRFApp.isSample()') and page.locator('#photoGaps').count() == 0)
    page.set_input_files('#importFile', plan_file)
    page.wait_for_function("!LRFApp.isSample() && LRFApp.state.plan.plantings.length > 100", timeout=60000)
    said = toast(page)
    check('loading a plan-only file says so, and what did not come with it', 'holds the plan only' in said and 'no farm photo' in said and 'variety photo' in said, said)
    check('the plan’s pictures name where they came from, at two suppliers or more: one to hand its pictures over, the rest to refuse', len(handed) >= 1 and len(refused) >= 1, {'suppliers': hosts, 'handed': len(handed), 'refused': len(refused), 'photos': len(with_photo)})
    page.wait_for_function("LRFThumbs.count() >= %d && !LRFApp.photoGaps().working" % len(handed), timeout=120000)
    page.wait_for_timeout(600)
    gaps = page.evaluate('LRFApp.photoGaps()')
    kept = page.evaluate('LRFThumbs.count()')
    check('pictures a supplier hands over are fetched and kept by themselves (%d of %d here)' % (len(handed), len(with_photo)), kept == len(handed) >= 1 and gaps['varieties'] == len(with_photo) - len(handed) and asked['fetched'] == len(handed), {'kept': kept, 'gaps': gaps, 'asked': asked})
    far = page.evaluate("LRFApp.state.plan.varieties.filter(v => v.photo && !LRFThumbs.get(v.id) && LRFThumbs.remoteOf(v.id)).length")
    # "the rest": every picture with an address that was not handed over. (A photo record with no address has nowhere to be shown from.)
    check('the rest are shown from the supplier’s own address meanwhile', far == len(refused) >= 1 and gaps['shown'] == far, {'far': far, 'refused': len(refused)})
    view(page, 'seeds')
    page.click('[data-sd-tab="gallery"]')
    page.wait_for_timeout(1200)
    tiles = page.evaluate("(() => { const imgs = [...document.querySelectorAll('#sdGallery .thumb img')]; return { kept: imgs.filter(i => i.src.startsWith('data:')).length, far: imgs.filter(i => i.src.startsWith('https:')).length, noReferrer: imgs.filter(i => i.src.startsWith('https:')).every(i => i.referrerPolicy === 'no-referrer') }; })()")
    check('the gallery shows both kinds, and tells a supplier nothing about where the request came from', tiles['kept'] >= 1 and tiles['far'] >= 1 and tiles['noReferrer'], tiles)
    page.click('[data-sd-tab="list"]')
    view(page, 'map')
    page.evaluate('LRFApp.select(null)')
    page.wait_for_timeout(300)
    card = page.inner_text('#photoGaps') if page.locator('#photoGaps').count() else ''
    check('the overview says what is missing: the farm photo, and how many variety photos are not kept here', 'The farm photo' in card and ('%d variety photos' % gaps['varieties']) in card and 'Add photos' in card, card[:300])
    page.screenshot(path=os.path.join(shots, 'pictures-missing-1480.png'))
    missed = page.evaluate("Object.keys(JSON.parse(localStorage.getItem('lrf-next:thumb-miss') || '{}')).length")
    again = dict(asked)
    page.evaluate('LRFApp.rebuildThumbs()')
    page.wait_for_timeout(800)
    check('a picture that could not be had is not asked for again on every visit', missed == len(refused) >= 1 and asked['refused'] == again['refused'] == missed and asked['fetched'] == again['fetched'], {'missed': missed, 'before': again, 'after': asked})

    # the farm photo and the thumbnails, added from files: the plan is not replaced
    count0 = page.evaluate('LRFApp.state.plan.plantings.length')
    undo0 = page.evaluate('LRFApp.state.undo.length')
    page.set_input_files('#photosFile', [farm_photo + '.jpg' if os.path.exists(farm_photo + '.jpg') else farm_photo, thumbs_file])
    page.wait_for_function("LRFApp.state.mapImageUrl.startsWith('blob:') && LRFThumbs.count() >= %d" % len(all_photos), timeout=60000)
    page.wait_for_timeout(500)
    said = toast(page)
    now = page.evaluate("({ plantings: LRFApp.state.plan.plantings.length, thumbs: LRFThumbs.count(), gaps: LRFApp.photoGaps(), mapInfo: (LRFApp.state.plan.lrfNext || {}).mapImage, ref: LRFApp.state.plan.map.imageFile.sha256, card: !!document.getElementById('photoGaps'), href: document.getElementById('mapPhoto').getAttribute('href') || '', w: document.getElementById('mapPhoto').getAttribute('width') })")
    check('Add photos takes the farm photo and the thumbnails: every variety with a photo has one kept, the photo is on the map, the plan is the same plan', now['plantings'] == count0 and now['thumbs'] == len(all_photos) and not now['gaps']['map'] and now['gaps']['varieties'] == 0 and not now['card'] and now['href'].startswith('blob:') and str(now['w']) == str(plan['map']['imgW']), {k: now[k] for k in ('plantings', 'thumbs', 'gaps', 'card', 'w')})
    check('it is recognised as the photo the plan was drawn on', now['mapInfo'] and now['mapInfo']['sha256'] == now['ref'] and 'not the same file' not in said and 'farm photo is set' in said, said)
    check('a picture fetched earlier is not written over by the file’s', ('%d variety photos added' % (len(all_photos) - len(handed))) in said, said)
    page.screenshot(path=os.path.join(shots, 'map-with-photo-1480.png'))
    view(page, 'seeds')
    page.click('[data-sd-tab="gallery"]')
    page.wait_for_timeout(600)
    page.screenshot(path=os.path.join(shots, 'gallery-1480.png'))
    page.click('[data-sd-tab="list"]')
    page.wait_for_function("document.getElementById('saveState').dataset.state === 'saved'", timeout=30000)
    page.reload()
    page.wait_for_function(READY, timeout=30000)
    page.wait_for_function("LRFApp.state.mapImageUrl.startsWith('blob:') && LRFThumbs.count() >= %d" % len(all_photos), timeout=30000)
    check('after a reload they are still here', page.evaluate('LRFThumbs.count()') == len(all_photos) and page.evaluate('LRFApp.photoGaps().map') is False)
    # the same plan-only file loaded again: nothing is stripped
    stamp = page.evaluate("LRFApp.state.plan.lrfNext.importedAt")
    page.set_input_files('#importFile', plan_file)
    page.wait_for_selector('dialog.dialog[open]', timeout=30000)
    confirm(page)
    page.wait_for_function("LRFApp.state.plan.lrfNext.importedAt !== '%s' && document.getElementById('saveState').dataset.state === 'saved'" % stamp, timeout=60000)
    page.wait_for_timeout(1500)
    said = toast(page)
    still = page.evaluate("({ thumbs: LRFThumbs.count(), map: LRFApp.state.mapImageUrl.startsWith('blob:'), gaps: LRFApp.photoGaps() })")
    check('loading a plan-only file over a plan that has its pictures keeps them', still['thumbs'] == len(all_photos) and still['map'] and not still['gaps']['map'] and still['gaps']['varieties'] == 0 and 'holds the plan only' not in said, {'still': still, 'said': said})
    page.reload()
    page.wait_for_function(READY, timeout=30000)
    page.wait_for_function("LRFApp.state.mapImageUrl.startsWith('blob:') && LRFThumbs.count() >= %d" % len(all_photos), timeout=30000)
    check('and they are still kept after that load and a reload', True)

    # a picture dropped on the page is the farm photo, not a plan to load
    dropped = page.evaluate("""(async () => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; c.getContext('2d').fillRect(0, 0, 400, 300); const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const n = LRFApp.state.plan.plantings.length; await LRFApp.openFiles([new File([blob], 'other.png', { type: 'image/png' })]);
      return { same: LRFApp.state.plan.plantings.length === n, info: LRFApp.state.plan.lrfNext.mapImage, said: document.getElementById('toast').innerText }; })()""")
    check('a picture dropped on the page becomes the farm photo; one of another shape is said to be', dropped['same'] and dropped['info']['mime'] == 'image/png' and 'beds may not sit where they should' in dropped['said'], dropped)
    refused = page.evaluate("""(async () => { await LRFApp.addPhotos([new File([JSON.stringify(%s)], 'plan.json')]); return document.getElementById('toast').innerText; })()""" % json.dumps({'gardens': [], 'beds': [], 'plantings': []}))
    check('a plan chosen under Add photos is refused in words, and nothing is loaded', 'is a plan, not photos' in refused, refused)
    evil = page.evaluate("""(async () => { const id = LRFApp.state.plan.varieties.find(v => !LRFThumbs.get(v.id)).id; await LRFApp.addPhotos([new File([JSON.stringify({ [id]: 'javascript:alert(1)', x: 'data:image/svg+xml;base64,AAAA', y: 'data:image/jpeg;base64,AAAA' })], 't.json')]); return { got: LRFThumbs.get(id), said: document.getElementById('toast').innerText }; })()""")
    check('only small JPEG, PNG or WebP pictures are taken from a thumbnails file', evil['got'] == '' and 'not in this plan' in evil['said'], evil)

    # the importer keeps the page's first picture with the variety
    view(page, 'seeds')
    page.click('#sdAddLink')
    page.wait_for_selector('dialog.dialog[open] input[name="url"]')
    page.fill('dialog.dialog[open] input[name="url"]', 'https://www.johnnyseeds.com/vegetables/kale/zz-test-kale-9999.html')
    page.locator('dialog.dialog[open] button', has_text='Read page').first.click()   # 0.33: no way to read a link here, so the read fails and the copied-text route appears
    page.wait_for_selector('dialog.dialog[open] #sdFallback:not([hidden])', timeout=5000)
    page.fill('dialog.dialog[open] input[name="pasteName"]', 'Zz Importer Test Kale')
    html = '<html><head><title>Zz Importer Test Kale</title><meta property="og:image" content="https://www.johnnyseeds.com/dw/image/zz-test-kale.jpg"><meta property="og:title" content="Zz Importer Test Kale"></head><body><h1>Zz Importer Test Kale</h1><img src="https://www.johnnyseeds.com/dw/image/zz-test-kale.jpg" alt="Zz Importer Test Kale"><p>55 days to maturity from transplanting.</p></body></html>'
    page.fill('dialog.dialog[open] textarea[name="pasteText"]', html)
    page.click('dialog.dialog[open] button:has-text("Read pasted page")')
    page.wait_for_selector('dialog.dialog[open] #sdSave', timeout=15000)
    shown = page.evaluate("(() => { const i = document.querySelector('dialog.dialog[open] img.sd-photo'), n = document.querySelector('dialog.dialog[open] .sd-photo-note'); return { src: i && i.src, note: n && n.textContent }; })()")
    kale = page.evaluate("LRFApp.state.engine.crops().find(c => /^Kale/.test(c.name)).id")
    page.select_option('dialog.dialog[open] select[name="cropId"]', kale)
    page.click('dialog.dialog[open] #sdSave')
    page.wait_for_timeout(600)
    confirm(page)
    page.wait_for_function("LRFApp.state.plan.varieties.some(v => v.name === 'Zz Importer Test Kale')", timeout=15000)
    page.wait_for_function("(() => { const v = LRFApp.state.plan.varieties.find(v => v.name === 'Zz Importer Test Kale'); return !!LRFThumbs.get(v.id); })()", timeout=15000)
    imported = page.evaluate("(() => { const v = LRFApp.state.plan.varieties.find(v => v.name === 'Zz Importer Test Kale'); return { photo: v.photo, kept: LRFThumbs.get(v.id).slice(0, 23) }; })()")
    check('the importer shows the page’s picture and says it is kept', bool(shown['src']) and 'zz-test-kale.jpg' in shown['src'] and shown['note'] == 'Kept with the variety when it is saved.', shown)
    check('saved, the variety records where its picture came from, and its thumbnail is fetched and kept with no further step', imported['photo'] and imported['photo']['sourceUrl'].endswith('zz-test-kale.jpg') and imported['photo']['sourcePage'].endswith('zz-test-kale-9999.html') and imported['kept'].startswith('data:image/jpeg;base64,'), imported)
    check('B: no errors on the page', not errors, errors[:3])
    ctx.close()

    # ═══ C. the complete backup .zip, used only for its pictures ═══
    ctx, page, errors = new_page(browser, url_b)
    page.set_input_files('#importFile', plan_file)
    page.wait_for_function("!LRFApp.isSample() && LRFApp.state.plan.plantings.length > 100 && document.getElementById('saveState').dataset.state === 'saved'", timeout=60000)
    moved = page.evaluate("(() => { const p = LRFApp.state.plan.plantings.find(p => !p.liveTray && LRFApp.state.engine.isSoilBed(LRFApp.state.engine.bedOf(p.bedId))); return LRFApp.removePlantings([p.id]) || LRFApp.state.plan.plantings.length; })()")
    page.set_input_files('#photosFile', backup_zip)
    page.wait_for_function("LRFApp.state.mapImageUrl.startsWith('blob:') && LRFThumbs.count() >= %d" % len(with_photo), timeout=180000)
    page.wait_for_timeout(500)
    after = page.evaluate("({ plantings: LRFApp.state.plan.plantings.length, thumbs: LRFThumbs.count(), from: LRFApp.state.plan.lrfNext.from, gaps: LRFApp.photoGaps(), said: document.getElementById('toast').innerText })")
    check('a complete backup chosen under Add photos gives its pictures only: the plan open, with a change made since, is untouched', after['plantings'] == moved and after['thumbs'] == len(with_photo) and after['from'] == 'plan.json' and not after['gaps']['map'] and after['gaps']['varieties'] == 0, after)
    check('C: no errors on the page', not errors, errors[:3])
    ctx.close()

    # ═══ F. the one-file photo pack (farm photo and thumbnails together), when given as a fifth argument ═══
    pack = sys.argv[5] if len(sys.argv) > 5 else None
    if pack:
        ctx, page, errors = new_page(browser, url_b)
        page.set_input_files('#importFile', plan_file)
        page.wait_for_function("!LRFApp.isSample() && LRFApp.state.plan.plantings.length > 100 && document.getElementById('saveState').dataset.state === 'saved'", timeout=60000)
        page.evaluate("(async () => { const dt = new DataTransfer(); })()")
        page.set_input_files('#photosFile', pack)
        page.wait_for_function("LRFApp.state.mapImageUrl.startsWith('blob:') && LRFThumbs.count() >= %d" % len(all_photos), timeout=60000)
        page.wait_for_timeout(400)
        got = page.evaluate("({ plantings: LRFApp.state.plan.plantings.length, thumbs: LRFThumbs.count(), same: LRFApp.state.plan.lrfNext.mapImage.sha256 === LRFApp.state.plan.map.imageFile.sha256, gaps: LRFApp.photoGaps(), said: document.getElementById('toast').innerText })")
        check('the one-file photo pack sets the farm photo and every thumbnail, and leaves the plan alone', got['plantings'] == len(plan['plantings']) and got['thumbs'] == len(all_photos) and got['same'] and not got['gaps']['map'] and got['gaps']['varieties'] == 0, got)
        check('F: no errors on the page', not errors, errors[:3])
        ctx.close()

    # ═══ E. with a plan folder: pictures added here go into the folder beside the plan ═══
    ctx, page, errors = new_page(browser, url_b)
    page.set_input_files('#importFile', plan_file)
    page.wait_for_function("!LRFApp.isSample() && LRFApp.state.plan.plantings.length > 100 && document.getElementById('saveState').dataset.state === 'saved'", timeout=60000)
    FOLDER = """const dirOf = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Farm plan', { create: true });
      const names = async () => { const out = []; for await (const [n, h] of (await dirOf()).entries()) out.push(n + (h.kind === 'file' ? ':' + (await h.getFile()).size : '')); return out.sort(); };
      const wait = ms => new Promise(r => setTimeout(r, ms));"""
    start = page.evaluate("(async () => { " + FOLDER + " await LRFFolder.use(await dirOf(), { keep: false }); const done = await LRFApp.saveToFolder(); return { done, files: await names() }; })()")
    check('a plan with no pictures puts only the plan in its folder', start['done'].get('saved') and [f.split(':')[0] for f in start['files']] == ['little-river-plan.json'], start)
    page.set_input_files('#photosFile', [farm_photo, thumbs_file])
    page.wait_for_function("LRFApp.state.mapImageUrl.startsWith('blob:') && LRFThumbs.count() >= %d" % len(all_photos), timeout=60000)
    page.wait_for_timeout(3500)
    then = page.evaluate("(async () => { " + FOLDER + " const d = await dirOf(), plan = JSON.parse(await (await (await d.getFileHandle('little-river-plan.json')).getFile()).text()), t = JSON.parse(await (await (await d.getFileHandle('thumbnails.json')).getFile()).text()); return { files: await names(), thumbs: Object.keys(t).length, plantings: plan.plantings.length, mine: plan.lrfNextKeep.device === LRFFolder.device(), info: LRFFolder.info() }; })()")
    sizes = dict(f.split(':') for f in then['files'] if ':' in f)
    check('added photos are written into the folder by themselves: the farm photo whole, and every thumbnail', int(sizes.get('map-photo.jpg', 0)) == os.path.getsize(farm_photo) and then['thumbs'] == len(all_photos) and then['plantings'] == len(plan['plantings']) and then['mine'] and not then['info']['conflict'] and not then['info']['error'], then)
    check('E: no errors on the page', not errors, errors[:3])
    ctx.close()

    # ═══ D. the new screens at 1280, in the dark ═══
    ctx, page, errors = new_page(browser, url_a, width=1280, height=800, scheme='dark')
    view(page, 'seeds')
    page.fill('#qlVariety', 'gre')
    page.wait_for_timeout(250)
    page.screenshot(path=os.path.join(shots, 'seeds-quick-lot-1280-dark.png'))
    page.press('#qlVariety', 'Escape')
    view(page, 'timeline')
    page.screenshot(path=os.path.join(shots, 'timeline-1280-dark.png'))
    check('D: no errors on the page', not errors, errors[:3])
    ctx.close()
    server_a.shutdown()
    server_b.shutdown()
    browser.close()

shutil.rmtree(bare, ignore_errors=True)
print('\n'.join(results))
print(json.dumps({'passed': len(results) - len(failed), 'of': len(results), 'failed': failed}))
