"""The farm photo stays when a plan is opened from the cloud with new variety photos only (0.35), in two real browsers.

usage: python3 -I photo_keep_check.py <app-or-site-dir> <shots-dir> <repo-dir> [plan-file farm-photo]

The fault this is for: browser B is in step and shows the farm photo. Browser A adds a variety photo and changes the plan.
B opens A's plan at its next start. The cloud then hands B the small photos (their stamp moved) and no farm photo (its
stamp did not), and the page used to take "small photos came" for "pictures came" and drop its own farm photo, on that
load and every load after. Two things are checked:
  - the photo is kept through such a load, and through the reload after it;
  - a browser already left without its note of the photo puts it back by itself at its next start, when what it has kept
    is the very photo the plan was drawn on, and leaves any other picture alone.
The sync service is the Worker's own code, served on this computer (tools/sync_dev_server.mjs), as in sync_check.py.
"""
import functools, http.server, json, os, socket, socketserver, subprocess, sys, threading, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

target, shots, repo = sys.argv[1], sys.argv[2], sys.argv[3]
PLAN_FILE = sys.argv[4] if len(sys.argv) > 4 else None
PHOTO = sys.argv[5] if len(sys.argv) > 5 else os.path.join(target, 'data', 'farm-map.jpg')
os.makedirs(shots, exist_ok=True)
results, failed = [], []
KEY = 'two words twice two words twice'

def check(name, ok, detail=None):
    results.append(('ok   ' if ok else 'FAIL ') + name + ('' if ok or detail is None else ' ' + json.dumps(detail, default=str)[:900]))
    if not ok:
        failed.append(name)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=target))
threading.Thread(target=server.serve_forever, daemon=True).start()
ORIGIN = 'http://127.0.0.1:%d' % server.server_address[1]
url = ORIGIN + '/index.html'
sock = socket.socket(); sock.bind(('127.0.0.1', 0)); PORT = sock.getsockname()[1]; sock.close()
SYNC = 'http://127.0.0.1:%d' % PORT
service = subprocess.Popen(['node', os.path.join(repo, 'tools', 'sync_dev_server.mjs'), str(PORT), KEY], env={**os.environ, 'LRF_SYNC_DEV': '1'}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def cloud(path, method='GET', token=None, body=None, headers=None):
    req = urllib.request.Request(SYNC + path, method=method, data=body, headers={'origin': ORIGIN, **({'authorization': 'Bearer ' + token} if token else {}), **(headers or {})})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read() or b'{}')
for _ in range(60):
    try:
        with urllib.request.urlopen(urllib.request.Request(SYNC + '/__dev', method='POST', data=b'{}'), timeout=20) as r:
            r.read()
        break
    except Exception:
        time.sleep(0.25)
TOKEN = [None]
def state():
    if not TOKEN[0]:
        TOKEN[0] = cloud('/login', 'POST', body=json.dumps({'key': KEY}).encode(), headers={'content-type': 'application/json'})['token']
    return cloud('/state', token=TOKEN[0])

# what a browser shows of the farm photo, and what it has noted of it
PHOTO_STATE = """(() => { const el = document.getElementById('mapPhoto'), info = (LRFApp.state.plan.lrfNext || {}).mapImage || null, stored = JSON.parse(localStorage.getItem('lrf-next:plan') || 'null');
  return { href: el ? String(el.getAttribute('href') || el.getAttribute('xlink:href') || '').slice(0, 5) : 'no element', url: LRFApp.state.mapImageUrl.slice(0, 5), gap: LRFApp.photoGaps().map, note: info, storedNote: stored && stored.lrfNext ? stored.lrfNext.mapImage || null : null,
    ref: ((LRFApp.state.plan.map || {}).imageFile || {}).sha256 || null, n: LRFApp.state.plan.plantings.length, thumbs: LRFThumbs.count(), sample: LRFApp.isSample() }; })()"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    def device(width, sample=False):
        ctx = browser.new_context(viewport={'width': width, 'height': 900})
        page = ctx.new_page(); page.set_default_timeout(25000)
        page.errors = []
        page.on('pageerror', lambda e: page.errors.append(str(e)[:300]))
        if sample:
            page.route('**/data/**', lambda r: r.abort())
        return page
    def ready(page):
        page.wait_for_function('window.LRFApp && LRFApp.state.ready', timeout=40000)
        page.evaluate("LRFSync.timing.push = 250")
        page.wait_for_timeout(600)
    def settled(page, status=None, timeout=60000):
        page.wait_for_function("(want) => { const c = LRFApp.syncInfo(); return !c.busy && c.status !== 'checking' && c.status !== 'sending' && c.status !== 'receiving' && (!want || c.status === want); }", arg=status, timeout=timeout)
        page.wait_for_timeout(300)
        return page.evaluate("LRFApp.syncInfo()")
    def connect(page, label):
        page.evaluate("void LRFBackupUI.openSync()"); page.wait_for_selector('#syncUrl')
        page.fill('#syncUrl', SYNC); page.fill('#syncKey', KEY); page.fill('#syncLabel', label); page.click('#syncConnect')
        got = settled(page, 'in-step')
        if page.query_selector('#syncDone'):
            page.click('#syncDone')
        return got
    def photo(page, wait=True):
        if wait:
            try:
                page.wait_for_function("LRFApp.state.mapImageUrl.startsWith('blob:')", timeout=6000)
            except Exception:
                pass
        page.wait_for_timeout(400)
        return page.evaluate(PHOTO_STATE)

    A = device(1480); B = device(1280, sample=True)
    try:
        # ── A has the plan and both kinds of photo, and sends them ──
        A.goto(url); ready(A)
        if PLAN_FILE:
            A.set_input_files('#importFile', PLAN_FILE); A.wait_for_function("!LRFApp.isSample()", timeout=60000)
            A.wait_for_function("document.getElementById('saveState').dataset.state === 'saved'", timeout=180000); A.wait_for_timeout(2500)
        A.set_input_files('#photosFile', PHOTO); A.wait_for_timeout(1500)
        n0 = A.evaluate("LRFApp.state.plan.plantings.length")
        # a plan loaded from a file may bring no small photos: give A a few, so that the cloud holds a file of them
        seeded = A.evaluate("""(async () => { if (LRFThumbs.count() >= 3) return 0; const c = document.createElement('canvas'); c.width = c.height = 8; c.getContext('2d').fillRect(0, 0, 8, 8); const uri = c.toDataURL('image/jpeg');
            const some = LRFApp.state.plan.varieties.filter(v => v.active !== false && !v.deleted).slice(0, 3), found = {}; for (const v of some) found[v.id] = uri;
            await LRFApp.addPhotos([new File([JSON.stringify(found)], 'seed-photos.json', { type: 'application/json' })]); return some.length; })()""")
        a1 = connect(A, 'First computer'); A.wait_for_timeout(500)
        held = state()
        check('A is in step, and the cloud holds the plan, the farm photo and the small photos', a1['status'] == 'in-step' and held['plan'] and held['plan']['meta']['plantings'] == n0 and held['files'].get('map') and held['files'].get('thumbs'), [a1['status'], held.get('files'), seeded])
        a0 = photo(A)
        check('A shows the farm photo', a0['href'] == 'blob:' and not a0['gap'] and a0['note'], a0)

        # ── B gets the plan from the cloud, photo and all ──
        B.goto(url); ready(B)
        b1 = connect(B, 'Second computer'); B.wait_for_timeout(800)
        b = photo(B)
        check('B opens the plan from the cloud with the farm photo', b1['status'] == 'in-step' and b['n'] == n0 and not b['sample'] and b['href'] == 'blob:' and not b['gap'] and b['note'] and b['storedNote'], b)
        thumbs_before, map_stamp, thumb_stamp = b['thumbs'], held['files']['map']['etag'], held['files']['thumbs']['etag']

        # ── A adds a variety photo and changes the plan; only the small photos' stamp moves ──
        added = A.evaluate("""(async () => { const without = LRFApp.state.plan.varieties.find(v => v.active !== false && !v.deleted && !LRFThumbs.get(v.id)), withOne = LRFApp.state.plan.varieties.find(v => LRFThumbs.get(v.id));
            if (!without || !withOne) return { none: true, without: !!without, withOne: !!withOne };
            const out = await LRFApp.addPhotos([new File([JSON.stringify({ [without.id]: LRFThumbs.get(withOne.id) })], 'one-more.json', { type: 'application/json' })]);
            LRFApp.removePlantings([LRFApp.state.plan.plantings[LRFApp.state.plan.plantings.length - 1].id]);
            return { id: without.id, added: out && out.added, thumbs: LRFThumbs.count() }; })()""")
        check('A adds one variety photo and takes one planting out', bool(added) and added.get('added') == 1, added)
        try:
            A.wait_for_function("(n) => { const c = LRFApp.syncInfo(); return !c.busy && c.status === 'in-step' && c.cloud && c.cloud.plantings === n; }", arg=n0 - 1, timeout=40000)
        except Exception:
            pass
        for _ in range(40):
            s2 = state()
            if s2['plan']['meta']['plantings'] == n0 - 1 and s2['files']['thumbs']['etag'] != thumb_stamp:
                break
            time.sleep(0.5)
        check('the cloud then holds the newer plan and newer small photos, and the same farm photo as before', s2['plan']['meta']['plantings'] == n0 - 1 and s2['files']['thumbs']['etag'] != thumb_stamp and s2['files']['map']['etag'] == map_stamp, [s2['plan']['meta'], s2['files'], map_stamp, thumb_stamp])

        # ── B starts again and opens A's plan: the farm photo is still there ──
        B.reload(); ready(B)
        try:
            B.wait_for_function("(n) => LRFApp.state.plan.plantings.length === n && !LRFApp.syncInfo().busy", arg=n0 - 1, timeout=60000)
        except Exception:
            pass
        settled(B); b2 = photo(B)
        check('B opens the newer plan at its next start', b2['n'] == n0 - 1 and b2['thumbs'] == thumbs_before + 1, b2)
        check('and still shows the farm photo: the map has it, nothing is listed as missing, the note of it is kept', b2['href'] == 'blob:' and b2['url'] == 'blob:' and not b2['gap'] and bool(b2['note']) and bool(b2['storedNote']), b2)
        B.screenshot(path=os.path.join(shots, 'after-cloud-open.png'))
        B.reload(); ready(B); settled(B); b3 = photo(B)
        check('and again after one more reload', b3['href'] == 'blob:' and not b3['gap'] and bool(b3['storedNote']) and b3['n'] == n0 - 1, b3)

        # ── a browser already left without its note puts the photo back by itself ──
        key_before = B.evaluate("LRFApp.contentKey()"); stamp = state()['plan']['etag']
        B.evaluate("(() => { const t = JSON.parse(localStorage.getItem('lrf-next:plan')); delete t.lrfNext.mapImage; localStorage.setItem('lrf-next:plan', JSON.stringify(t)); })()")
        B.reload(); ready(B); settled(B); b4 = photo(B)
        check('with the note gone and the photo still kept in the browser, the next start shows it and writes the note back', b4['href'] == 'blob:' and not b4['gap'] and bool(b4['note']) and b4['note'].get('sha256') == b4['ref'] and b4['note'].get('mime') == 'image/jpeg', b4)
        B.wait_for_timeout(1200)
        stored = B.evaluate(PHOTO_STATE)
        check('the note is stored, so the start after that needs no mending', bool(stored['storedNote']) and stored['storedNote'].get('sha256') == stored['ref'], stored)
        check('mending it changes nothing the plan says and sends nothing', B.evaluate("LRFApp.contentKey()") == key_before and state()['plan']['etag'] == stamp and B.evaluate("LRFApp.syncInfo().status") == 'in-step' and B.evaluate("LRFApp.state.undo.length") == 0, [key_before, B.evaluate("LRFApp.contentKey()"), stamp, state()['plan']['etag']])

        # ── a kept picture that is not the one the plan was drawn on is left alone ──
        B.evaluate("(() => { const t = JSON.parse(localStorage.getItem('lrf-next:plan')); delete t.lrfNext.mapImage; t.map.imageFile = { ...t.map.imageFile, sha256: '0'.repeat(64) }; localStorage.setItem('lrf-next:plan', JSON.stringify(t)); })()")
        B.reload(); ready(B); B.wait_for_timeout(2500); b5 = photo(B, wait=False)
        check('a kept picture that is some other photo is not shown and not noted', b5['url'] == '' and b5['note'] is None and b5['storedNote'] is None and b5['gap'] is True, b5)

        check('no page errors in either browser', A.errors == [] and B.errors == [], [A.errors, B.errors])
    except Exception as e:
        try:
            A.screenshot(path=os.path.join(shots, 'where-it-stopped-A.png')); B.screenshot(path=os.path.join(shots, 'where-it-stopped-B.png'))
        except Exception:
            pass
        check('the check ran to its end', False, repr(e)[:400])
    finally:
        try:
            browser.close()
        except Exception:
            pass
        service.terminate()

print('\n'.join(results))
print(json.dumps({'passed': len(results) - len(failed), 'of': len(results), 'failed': failed}))
