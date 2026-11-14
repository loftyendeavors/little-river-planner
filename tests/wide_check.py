"""Previews 0.24 and 0.25 in a real browser: a very wide screen, light only, and the map's scale marker.

usage: python3 -I wide_check.py <app-dir-or-built-site-dir> <shots-dir> [backup.zip]
The rules under test:
  - the page is light whatever the computer's own setting says;
  - on a wide screen the farm photo leaves no empty strip on one side while its other side runs off the screen; on a screen
    wider than the photo it sits in the middle; every bed stays in view;
  - the Harvest table sits in the middle of the page when it is narrower than the page, and still scrolls when it is wider;
  - the map's scale marker is a plate with an edge on all four sides, its label over a ruler, inside the map and not clipped.
"""
import functools, http.server, json, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright

target, shots = sys.argv[1], sys.argv[2]
BACKUP = sys.argv[3] if len(sys.argv) > 3 else None
os.makedirs(shots, exist_ok=True)
results, failed = [], []


def check(name, ok, detail=None):
    results.append(('ok   ' if ok else 'FAIL ') + name + ('' if ok or detail is None else ' ' + json.dumps(detail, default=str)[:700]))
    if not ok:
        failed.append(name)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=target))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = 'http://127.0.0.1:%d/index.html' % server.server_address[1]
MAP = """(() => { const stage = document.getElementById('map').getBoundingClientRect(), photo = document.getElementById('mapPhoto'), p = photo.getBoundingClientRect(), shown = getComputedStyle(photo).display !== 'none' && p.width > 0;
  const beds = [...document.querySelectorAll('#mapBeds > *')].map(b => b.getBoundingClientRect()).filter(r => r.width > 0);
  return { stage: [Math.round(stage.left), Math.round(stage.right)], photo: shown ? [Math.round(p.left), Math.round(p.right)] : null, left: shown ? p.left - stage.left : 0, right: shown ? stage.right - p.right : 0,
    bedsIn: beds.length > 0 && beds.every(r => r.left >= stage.left - 1 && r.right <= stage.right + 1), beds: beds.length }; })()"""
SCALE = """(() => { const el = document.getElementById('mapScale'), r = el.getBoundingClientRect(), stage = document.getElementById('map').getBoundingClientRect(), b = getComputedStyle(el, '::before'), a = getComputedStyle(el, '::after'), cs = getComputedStyle(el);
  const c = document.createElement('canvas').getContext('2d'); c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const edges = ['Top', 'Right', 'Bottom', 'Left'].map(k => b['border' + k + 'Style'] !== 'none' ? parseFloat(b['border' + k + 'Width']) : 0), out = ['top', 'right', 'bottom', 'left'].map(k => -parseFloat(b[k]) || 0);
  const tools = document.querySelector('.map-tools').getBoundingClientRect();
  return { text: el.textContent, edges, ruler: a.borderBottomStyle !== 'none' ? parseFloat(a.borderBottomWidth) : 0, ticks: [parseFloat(a.borderLeftWidth), parseFloat(a.borderRightWidth), parseFloat(a.borderTopWidth)], fits: c.measureText(el.textContent).width <= r.width + 0.5,
    inMap: r.left - out[3] >= stage.left && r.top - out[0] >= stage.top && r.right + out[1] <= stage.right, clear: r.right + out[1] < tools.left, width: Math.round(r.width) }; })()"""
HARVEST = """(() => { const wrap = document.getElementById('hvWrap').getBoundingClientRect(), s = document.getElementById('hvScroll'), r = s.getBoundingClientRect(), cs = getComputedStyle(document.getElementById('hvWrap'));
  const inner = [wrap.left + parseFloat(cs.paddingLeft), wrap.right - parseFloat(cs.paddingRight)], table = document.getElementById('hvTable').getBoundingClientRect();
  return { left: Math.round(r.left - inner[0]), right: Math.round(inner[1] - r.right), fits: s.scrollWidth <= s.clientWidth + 1, hug: Math.abs(r.width - table.width) <= 4, tableWider: table.width > inner[1] - inner[0], inside: r.left >= inner[0] - 1 && r.right <= inner[1] + 1 }; })()"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for width, height, dark in [(1280, 860, True), (2560, 1300, False), (3440, 1340, True), (5120, 1340, False)]:
        ctx = browser.new_context(viewport={'width': width, 'height': height}, color_scheme='dark' if dark else 'light', service_workers='block')
        page = ctx.new_page()
        if BACKUP:
            page.route('**/*', lambda r: r.continue_() if r.request.url.startswith('http://127.0.0.1') else r.abort())
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(url); page.wait_for_function('window.LRFApp && LRFApp.state.ready', timeout=90000)
        if BACKUP and page.evaluate('LRFApp.isSample()'):
            page.set_input_files('#importFile', BACKUP)
            page.wait_for_function("!LRFApp.isSample() && LRFThumbs.count() > 100", timeout=240000)
        page.evaluate("LRFApp.setView('map'); LRFMap.fit()"); page.wait_for_timeout(1200)
        tag = '%d wide%s' % (width, ', the computer set to dark' if dark else '')
        look = page.evaluate("({ bg: getComputedStyle(document.body).backgroundColor, ink: getComputedStyle(document.body).color, scheme: getComputedStyle(document.documentElement).colorScheme, theme: document.documentElement.dataset.theme })")
        rgb = [int(x) for x in look['bg'].replace('rgb(', '').replace(')', '').split(',')[:3]]
        check('%s: the page is light' % tag, sum(rgb) > 600 and look['scheme'] == 'light' and look['theme'] == 'light', look)
        m = page.evaluate(MAP)
        check('%s: every bed is in view on the map' % tag, m['bedsIn'], m)
        if m['photo']:
            gapL, gapR = m['left'], m['right']
            check('%s: the farm photo leaves no empty strip on one side while the other runs off, and is centred where it is the narrower' % tag,
                  (gapL <= 1 and gapR <= 1) or (gapL > 1 and gapR > 1 and abs(gapL - gapR) <= 2) or not m['bedsIn'], m)
        sc = page.evaluate(SCALE)
        check('%s: the scale marker has an edge on all four sides, a ruler with end ticks under its label, and sits inside the map clear of the tools' % tag,
              all(e > 0 for e in sc['edges']) and sc['ruler'] > 0 and sc['ticks'][0] > 0 and sc['ticks'][1] > 0 and sc['ticks'][2] == 0 and sc['fits'] and sc['inMap'] and sc['clear'] and sc['text'].endswith(' ft'), sc)
        page.screenshot(path=os.path.join(shots, 'map-%d.png' % width))
        page.evaluate("LRFApp.setView('harvest')"); page.wait_for_timeout(1300)
        hv = page.evaluate(HARVEST)
        check('%s: the Harvest table is in the middle of the page, or fills it and scrolls' % tag, hv['inside'] and (abs(hv['left'] - hv['right']) <= 2 and hv['hug'] if hv['fits'] else hv['left'] <= 2 and hv['right'] <= 2), hv)
        page.evaluate("document.querySelector('[data-hv-grain=\"day\"]').click()"); page.wait_for_timeout(900)
        hv2 = page.evaluate(HARVEST)
        check('%s: by days too' % tag, hv2['inside'] and (abs(hv2['left'] - hv2['right']) <= 2 and hv2['hug'] if hv2['fits'] else hv2['left'] <= 2 and hv2['right'] <= 2), hv2)
        page.screenshot(path=os.path.join(shots, 'harvest-%d.png' % width))
        check('%s: no error on the page' % tag, not errors, errors[:3])
        ctx.close()
    browser.close()

print('\n'.join(results))
print(json.dumps({'passed': len(results) - len(failed), 'of': len(results), 'failed': failed}))
