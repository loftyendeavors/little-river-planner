"""Step A (0.21) in a real browser: cloud sync and snapshots, against the sync Worker's own code served on this computer.

usage: python3 -I sync_check.py <app-or-site-dir> <shots-dir> <repo-dir> [plan-file farm-photo]

Two browsers stand in for two computers. A opens the plan the app folder ships with; B starts with no plan. Against the built
site (which ships no plan, and has the real typefaces and the service worker) give a plan file and a farm photo: A loads them
first. DARK=1 runs the second browser in the dark theme.

The rules under test:
  - the plan open in a browser is the one worked on, connection or none; a change is sent a moment after it is made;
  - a write never lands on a plan the sender has not seen: when both have changed, nothing is sent and nothing is replaced,
    the page says so in every view, and the choice is his; plans are never merged;
  - a newer plan is opened by itself only at start-up and only over a plan that has not been changed; while the page is in
    use it is offered;
  - whatever replaces a whole plan (the cloud's plan, a snapshot, a backup file), the plan that was open is kept as a
    snapshot first, and can be gone back to from the page;
  - the passphrase is typed once and is not kept in the browser;
  - anything that opens to be filled in has an x that leaves without doing anything, and Escape does the same.
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
    if os.environ.get('LIVE'):
        print(results[-1][:1000], file=sys.stderr, flush=True)
    if not ok and os.environ.get('STOP_AT_FAIL'):
        print('\n'.join(results)); print(json.dumps({'passed': len(results) - len(failed), 'of': len(results), 'failed': failed, 'stopped': True}), flush=True); os._exit(1)

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

def cloud(path, method='GET', token=None, body=None, headers=None, raw=False):
    req = urllib.request.Request(SYNC + path, method=method, data=body, headers={'origin': ORIGIN, **({'authorization': 'Bearer ' + token} if token else {}), **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read()
            return (r.status, data if raw else json.loads(data or b'{}'), dict(r.headers))
    except urllib.error.HTTPError as e:
        data = e.read()
        return (e.code, data if raw else json.loads(data or b'{}'), dict(e.headers))
def dev(**ask):
    with urllib.request.urlopen(urllib.request.Request(SYNC + '/__dev', method='POST', data=json.dumps(ask).encode()), timeout=20) as r:
        return json.loads(r.read())
for _ in range(60):
    try:
        dev(); break
    except Exception:
        time.sleep(0.25)
TOKEN = [None]
def token():
    if not TOKEN[0]:
        TOKEN[0] = cloud('/login', 'POST', body=json.dumps({'key': CURRENT[0]}).encode(), headers={'content-type': 'application/json'})[1]['token']
    return TOKEN[0]
CURRENT = [KEY]
def state():
    return cloud('/state', token=token())[1]

FIT = """(() => { const out = []; for (const d of document.querySelectorAll('dialog[open]')) { const r = d.getBoundingClientRect(); if (r.left < 0 || r.top < 0 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) out.push(['dialog off screen', Math.round(r.right), Math.round(r.bottom)]); for (const el of d.querySelectorAll('button, b, span, small, p, h2, label, input')) { if (!el.offsetParent) continue; if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible' && el.tagName !== 'INPUT') out.push(['clipped', el.id || el.className, el.textContent.slice(0, 40)]); const e = el.getBoundingClientRect(); if (e.right > r.right + 0.5 || e.left < r.left - 0.5) out.push(['outside its window', el.id || el.className, el.textContent.slice(0, 40)]); } }
  const top = document.querySelector('header.top'), s = document.getElementById('saveState'), sr = s.getBoundingClientRect(), nav = document.querySelector('nav.views').getBoundingClientRect(), bk = document.getElementById('dataBtn').getBoundingClientRect();
  if (document.documentElement.scrollWidth > innerWidth) out.push(['page scrolls sideways', document.documentElement.scrollWidth]);
  if (s.offsetParent && (s.scrollWidth > s.clientWidth + 1 || sr.left < nav.right - 0.5 || sr.right > bk.left + 0.5)) out.push(['save indicator does not fit', s.textContent, Math.round(sr.left), Math.round(nav.right), Math.round(sr.right), Math.round(bk.left)]);
  for (const strip of document.querySelectorAll('.first-run:not([hidden])')) { const r = strip.getBoundingClientRect(); for (const el of strip.querySelectorAll('button, p')) { const e = el.getBoundingClientRect(); if (e.right > r.right + 0.5 || el.scrollWidth > el.clientWidth + 1) out.push(['strip', el.id, Math.round(e.right), Math.round(r.right)]); } }
  return out; })()"""
PLANTS = "(() => { let x = 2166136261; const t = JSON.stringify(LRFApp.state.plan.plantings.map(p => [p.id, p.bedId, p.date, p.cropId, p.varietyId, p.ft])); for (let i = 0; i < t.length; i++) x = Math.imul(x ^ t.charCodeAt(i), 16777619); return (x >>> 0) + ':' + LRFApp.state.plan.plantings.length; })()"
STORED = "(() => { const t = localStorage.getItem('lrf-next:plan'); return t ? JSON.parse(t).plantings.length : null; })()"

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    def device(width, sample=False, scheme=None):
        ctx = browser.new_context(viewport={'width': width, 'height': 900}, accept_downloads=True, **({'color_scheme': scheme} if scheme else {}))
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
    def settled(page, status=None, timeout=40000):
        page.wait_for_function("(want) => { const c = LRFApp.syncInfo(); return !c.busy && c.status !== 'checking' && c.status !== 'sending' && c.status !== 'receiving' && (!want || c.status === want); }", arg=status, timeout=timeout)
        page.wait_for_timeout(250)
        return page.evaluate("LRFApp.syncInfo()")
    def appears(page, fn, timeout=8000):
        try:
            page.wait_for_function(fn, timeout=timeout); return True
        except Exception:
            return False
    def answer(page, yes=True):
        """The in-page question on top: press its button."""
        ok = appears(page, "document.querySelectorAll('dialog[open]').length && [...document.querySelectorAll('dialog[open]')].pop().querySelector('.dialog-actions .btn.primary, .dialog-actions .btn.danger') && ![...document.querySelectorAll('dialog[open]')].pop().classList.contains('bk')")
        if not ok:
            return None
        text = page.evaluate("[...document.querySelectorAll('dialog[open]')].pop().innerText")
        page.evaluate("(yes) => { const d = [...document.querySelectorAll('dialog[open]')].pop(), b = d.querySelectorAll('.dialog-actions .btn'); (yes ? b[b.length - 1] : b[0]).click(); }", yes)
        page.wait_for_timeout(200)
        return text
    def toast(page):
        return page.evaluate("document.getElementById('toast').textContent")
    def change(page, n=1):
        page.evaluate("(n) => { for (let i = 0; i < n; i++) LRFApp.removePlantings([LRFApp.state.plan.plantings[LRFApp.state.plan.plantings.length - 1].id]); }", n)
    def save_text(page):
        return page.evaluate("document.getElementById('saveState').textContent")
    def snaps(page):
        return page.evaluate("LRFApp.snapshots().then(s => s.rows.map(r => ({ id: r.id, name: r.name, auto: !!r.auto, here: !!r.here, cloud: !!r.cloud, n: r.plantings, kind: r.kind })))")

    A = device(1480); B = device(1280, sample=True, scheme='dark' if os.environ.get('DARK') else None)
    try:
        # ── 1. before anything is set up ──
        A.goto(url); ready(A)
        if PLAN_FILE:
            A.set_input_files('#importFile', PLAN_FILE); A.wait_for_function("!LRFApp.isSample()", timeout=60000)
            A.wait_for_function("LRFThumbs.count() > 100 && document.getElementById('saveState').dataset.state === 'saved'", timeout=180000); A.wait_for_timeout(2500)
        n0 = A.evaluate("LRFApp.state.plan.plantings.length")
        A.set_input_files('#photosFile', PHOTO); A.wait_for_timeout(1500)
        first = A.evaluate("({ sync: LRFApp.syncInfo(), save: document.getElementById('saveState').textContent, stored: localStorage.getItem('lrf-next:sync'), strip: document.getElementById('syncStrip').hidden, label: document.getElementById('buildNote').textContent })")
        check('with no cloud set up, nothing about it shows but two lines in the Backup menu', first['sync']['status'] == 'off' and not first['sync']['configured'] and first['stored'] is None and first['strip'] and 'cloud' not in first['save'].lower() and '0.39' in first['label'], first)
        A.click('#dataBtn'); A.wait_for_timeout(150)
        menu = A.evaluate("({ sync: document.getElementById('syncBtn').innerText, snap: document.getElementById('snapBtn').innerText, shown: !document.getElementById('syncBtn').hidden && !document.getElementById('snapBtn').hidden, fits: [...document.querySelectorAll('#dataMenu button')].every(b => b.scrollWidth <= b.clientWidth + 1) })")
        check('the Backup menu offers Cloud sync and Snapshots', menu['shown'] and 'Cloud sync' in menu['sync'] and 'Snapshots' in menu['snap'] and menu['fits'], menu)
        A.screenshot(path=os.path.join(shots, 'menu.png'))
        A.click('#syncBtn'); A.wait_for_timeout(250)
        form = A.evaluate("({ open: !!document.querySelector('#syncDlg[open]'), menu: document.getElementById('dataMenu').hidden, fields: ['syncUrl', 'syncKey', 'syncLabel'].map(id => !!document.getElementById(id)), type: document.getElementById('syncKey').type, focus: document.activeElement.id })")
        check('Cloud sync opens as a window with three fields, the passphrase hidden as it is typed', form['open'] and form['menu'] and all(form['fields']) and form['type'] == 'password' and form['focus'] == 'syncUrl', form)
        check('it fits at 1480', A.evaluate(FIT) == [], A.evaluate(FIT))
        A.screenshot(path=os.path.join(shots, 'sync-form.png'))
        A.fill('#syncUrl', SYNC); A.fill('#syncKey', 'half typed'); A.keyboard.press('Escape'); A.wait_for_timeout(200)
        gone = A.evaluate("({ open: !!document.querySelector('#syncDlg'), stored: localStorage.getItem('lrf-next:sync'), status: LRFApp.syncInfo().status })")
        check('Escape leaves it, from inside a field, and nothing is kept or sent', not gone['open'] and gone['stored'] is None and gone['status'] == 'off' and state()['plan'] is None, gone)
        A.evaluate("LRFBackupUI.openSync()"); A.wait_for_timeout(200); A.fill('#syncUrl', SYNC); A.click('#syncClose'); A.wait_for_timeout(200)
        check('so does the x', A.evaluate("!document.querySelector('#syncDlg') && localStorage.getItem('lrf-next:sync') === null"))

        # ── 2. signing in ──
        A.evaluate("LRFBackupUI.openSync()"); A.wait_for_timeout(200)
        A.fill('#syncUrl', SYNC); A.fill('#syncKey', 'not the passphrase'); A.fill('#syncLabel', 'Work laptop'); A.click('#syncConnect')
        appears(A, "document.getElementById('syncSay') && /not the passphrase/i.test(document.getElementById('syncSay').textContent)")
        wrong = A.evaluate("({ say: document.getElementById('syncSay').textContent, kind: document.getElementById('syncSay').dataset.kind, open: !!document.querySelector('#syncDlg[open]'), stored: localStorage.getItem('lrf-next:sync'), url: document.getElementById('syncUrl').value, focus: document.activeElement.id })")
        check('a wrong passphrase is refused in words, the window stays, the address typed is kept', 'not the passphrase' in wrong['say'].lower() and 'more tr' in wrong['say'] and wrong['kind'] == 'bad' and wrong['open'] and wrong['stored'] is None and wrong['url'] == SYNC and wrong['focus'] == 'syncKey', wrong)
        A.fill('#syncUrl', 'http://127.0.0.1:9'); A.fill('#syncKey', KEY); A.click('#syncConnect')
        appears(A, "/could not be reached/.test(document.getElementById('syncSay').textContent)", 60000)
        check('an address nothing answers at says so', 'could not be reached' in A.evaluate("document.getElementById('syncSay').textContent") and A.evaluate("localStorage.getItem('lrf-next:sync')") is None)
        A.fill('#syncUrl', SYNC); A.fill('#syncKey', KEY); A.click('#syncConnect')
        a1 = settled(A, 'in-step')
        A.wait_for_timeout(300)
        held = state()
        stored = A.evaluate("localStorage.getItem('lrf-next:sync')")
        everything = A.evaluate("JSON.stringify(Object.entries(localStorage)) + document.documentElement.innerHTML")
        check('the right one connects, and the plan is sent', a1['status'] == 'in-step' and held['plan'] and held['plan']['meta']['plantings'] == n0 and held['plan']['meta']['label'] == 'Work laptop' and held['plan']['meta']['enc'] == 'gzip', [a1['status'], held['plan']])
        check('the passphrase is nowhere in the browser afterwards: not stored, not left in the page', KEY not in everything and '"token":"v1.' in stored, stored[:200])
        check('the photos went with it', held['files']['map'] and held['files']['map']['size'] > 500000 and held['files']['thumbs'] and held['files']['thumbs']['size'] > 100000, held['files'])
        dlg = A.evaluate("({ host: document.getElementById('syncHost').innerText, cloud: document.getElementById('syncCloud').innerText.replace(/\\s+/g, ' '), here: document.getElementById('syncHere').innerText.replace(/\\s+/g, ' '), state: document.getElementById('syncState').dataset.state, say: document.getElementById('syncSay').textContent, label: document.getElementById('syncLabel').value })")
        check('the window then says what each side holds', dlg['host'] == SYNC.replace('http://', '') and 'Work laptop' in dlg['cloud'] and str(n0) in dlg['cloud'] and str(n0) in dlg['here'] and 'In step' in dlg['here'] and dlg['state'] == 'in-step' and 'in step' in dlg['say'] and dlg['label'] == 'Work laptop', dlg)
        check('and fits', A.evaluate(FIT) == [], A.evaluate(FIT))
        A.screenshot(path=os.path.join(shots, 'sync-connected.png'))
        A.click('#syncDone'); A.wait_for_timeout(200)
        ind = A.evaluate("({ text: document.getElementById('saveState').textContent, state: document.getElementById('saveState').dataset.state, title: document.getElementById('saveState').title })")
        check('the save indicator answers for the cloud copy too', ind['text'].startswith('Saved · cloud ') and ind['state'] == 'saved' and 'sent to the cloud' in ind['title'], ind)
        A.click('#dataBtn'); A.wait_for_timeout(150)
        check('the menu says it is in step, and what "Save now" does', 'In step' in A.evaluate("document.getElementById('syncNote').textContent") and 'cloud' in A.evaluate("document.getElementById('saveNowNote').textContent"), A.evaluate("[document.getElementById('syncNote').textContent, document.getElementById('saveNowNote').textContent]"))
        A.click('#dataBtn')

        # ── 3. a change is sent ──
        e1 = state()['plan']['etag']; puts = len(dev()['keys'])
        change(A)
        went = appears(A, "LRFApp.contentKey() && LRFApp.syncInfo().cloud && LRFApp.syncInfo().cloud.etag !== '%s' && LRFApp.syncInfo().status === 'in-step'" % e1, 30000)
        s2 = state()
        check('a change made here is in the cloud a moment later', went and s2['plan']['etag'] != e1 and s2['plan']['meta']['plantings'] == n0 - 1, s2['plan'])
        A.evaluate("LRFApp.undo()"); A.wait_for_function("LRFApp.syncInfo().cloud.etag !== '%s' && LRFApp.syncInfo().status === 'in-step' && !LRFApp.syncInfo().busy" % s2['plan']['etag'], timeout=30000)
        check('so is undoing it', state()['plan']['meta']['plantings'] == n0)
        calls = A.evaluate("(async () => { const before = (await LRFApp.sync().run('poll')).cloud.etag; await new Promise(r => setTimeout(r, 900)); return [before, LRFApp.syncInfo().cloud.etag, LRFApp.syncInfo().status]; })()")
        check('with nothing changed, a look at the cloud sends nothing', calls[0] == calls[1] == state()['plan']['etag'] and calls[2] == 'in-step', calls)
        A.keyboard.press('Control+s'); appears(A, "/Saved to the cloud at/.test(document.getElementById('toast').textContent)")
        check('Ctrl+S, with a cloud and no folder, sends the plan now and downloads nothing', 'Saved to the cloud at' in toast(A), toast(A))

        # ── 4. the second computer ──
        B.goto(url); ready(B)
        b0 = B.evaluate("({ sample: LRFApp.isSample(), strip: !document.getElementById('firstRun').hidden, text: document.getElementById('firstNone').textContent, cloud: !document.getElementById('firstCloud').hidden, map: !!LRFApp.state.mapImageUrl })")
        check('a browser with no plan offers "Get it from the cloud" on its strip', b0['sample'] and b0['strip'] and b0['cloud'] and 'from the cloud' in b0['text'] and not b0['map'], b0)
        check('the strip still fits at 1280', B.evaluate(FIT) == [], B.evaluate(FIT))
        B.click('#firstCloud'); B.wait_for_timeout(250)
        B.fill('#syncUrl', SYNC.replace('http://', 'http://')); B.fill('#syncKey', KEY); B.fill('#syncLabel', 'Second computer'); B.click('#syncConnect')
        b1 = settled(B, 'in-step', 60000); B.wait_for_timeout(800)
        got = B.evaluate("({ n: LRFApp.state.plan.plantings.length, sample: LRFApp.isSample(), strip: document.getElementById('firstRun').hidden, toast: document.getElementById('toast').textContent, map: LRFApp.state.mapImageUrl.slice(0, 5), thumbs: LRFThumbs.count(), note: document.getElementById('buildNote').textContent, undo: LRFApp.state.undo.length, stored: %s })" % STORED)
        check('it signs in and the plan opens there: every planting, the farm photo, the variety photos', b1['status'] == 'in-step' and got['n'] == n0 and not got['sample'] and got['strip'] and got['map'] == 'blob:' and got['thumbs'] > 100 and got['stored'] == n0 and 'from the cloud' in got['note'], got)
        check('the two browsers hold the same plantings', A.evaluate(PLANTS) == B.evaluate(PLANTS), [A.evaluate(PLANTS), B.evaluate(PLANTS)])
        same_key = A.evaluate("LRFApp.contentKey()") == B.evaluate("LRFApp.contentKey()")
        check('and the same plan altogether (one fingerprint)', same_key, [A.evaluate("LRFApp.contentKey()"), B.evaluate("LRFApp.contentKey()")])
        e2 = state()['plan']['etag']; B.wait_for_timeout(1500); settled(B)
        check('opening it there sends nothing back', state()['plan']['etag'] == e2 and B.evaluate("LRFApp.syncInfo().status") == 'in-step', [e2, state()['plan']['etag']])
        check('the window fits at 1280 too', B.evaluate(FIT) == [], B.evaluate(FIT))
        B.evaluate("document.querySelector('#syncDlg') && document.getElementById('syncDone').click()")
        B.reload(); ready(B); bs = settled(B, 'in-step')
        check('after a reload it is still there, still in step, and nothing is sent', B.evaluate("LRFApp.state.plan.plantings.length") == n0 and state()['plan']['etag'] == e2 and B.evaluate("LRFApp.state.mapImageUrl.slice(0, 5)") == 'blob:', bs['status'])

        # ── 5. a newer plan is offered, not swapped in ──
        change(A, 2); A.wait_for_function("LRFApp.syncInfo().cloud.etag !== '%s' && LRFApp.syncInfo().status === 'in-step' && !LRFApp.syncInfo().busy" % e2, timeout=30000)
        e3 = state()['plan']['etag']
        B.evaluate("LRFApp.setView('timeline')")
        B.evaluate("LRFApp.sync().run('focus')"); bn = settled(B, 'newer')
        offer = B.evaluate("({ n: LRFApp.state.plan.plantings.length, strip: !document.getElementById('syncStrip').hidden, text: (document.getElementById('syncStripText') || { innerText: '' }).innerText.replace(/\\s+/g, ' '), buttons: [...document.querySelectorAll('#syncStrip button')].map(b => b.textContent), save: document.getElementById('saveState').textContent, ask: document.getElementById('saveState').dataset.ask, view: document.body.dataset.view })")
        check('while the page is in use, a newer plan is offered across the page and the plan here stays', bn['status'] == 'newer' and offer['n'] == n0 and offer['strip'] and 'newer plan is in the cloud' in offer['text'] and 'Work laptop' in offer['text'] and str(n0 - 2) in offer['text'] and offer['buttons'] == ['Open it', 'Not now'] and offer['view'] == 'timeline', offer)
        check('the indicator says so and a click on it opens Cloud sync', offer['save'] == 'Newer plan in the cloud · click' and offer['ask'] == 'cloud', offer['save'])
        check('strip and indicator fit at 1280', B.evaluate(FIT) == [], B.evaluate(FIT))
        B.screenshot(path=os.path.join(shots, 'newer-strip.png'))
        B.evaluate("document.getElementById('stripLater') && document.getElementById('stripLater').click()"); B.wait_for_timeout(200)
        check('"Not now" puts the strip away; the indicator still says it', B.evaluate("document.getElementById('syncStrip').hidden") and save_text(B) == 'Newer plan in the cloud · click' and B.evaluate("LRFApp.state.plan.plantings.length") == n0)
        B.click('#saveState'); B.wait_for_timeout(250)
        win = B.evaluate("({ open: !!document.querySelector('#syncDlg[open]'), note: (document.getElementById('syncNote2') || {}).innerText, btn: (document.getElementById('syncOpen') || {}).textContent, state: document.getElementById('syncState').textContent })")
        check('the window explains it and has the one button', win['open'] and 'newer plan' in (win['note'] or '') and win['btn'] == 'Open it' and 'Older than' in win['state'], win)
        B.click('#syncOpen'); bo = settled(B, 'in-step'); B.wait_for_timeout(500)
        after = B.evaluate("({ n: LRFApp.state.plan.plantings.length, stored: %s, strip: document.getElementById('syncStrip').hidden, save: document.getElementById('saveState').textContent })" % STORED)
        check('"Open it" brings the newer plan over, with no further question since nothing here had changed', after['n'] == n0 - 2 and after['stored'] == n0 - 2 and after['strip'] and after['save'].startswith('Saved · cloud') and A.evaluate(PLANTS) == B.evaluate(PLANTS), after)
        bsn = snaps(B)
        check('the plan that was there is kept as a snapshot', any(s['auto'] and s['here'] and s['n'] == n0 and 'Before opening the plan from the cloud' in s['name'] for s in bsn), bsn)
        B.evaluate("document.querySelector('#syncDlg') && document.getElementById('syncDone').click()")

        # ── 6. both changed: nothing is sent, nothing is replaced ──
        change(A); A.wait_for_function("LRFApp.syncInfo().cloud.etag !== '%s' && LRFApp.syncInfo().status === 'in-step' && !LRFApp.syncInfo().busy" % e3, timeout=30000)
        e4 = state()['plan']['etag']
        change(B, 3); bc = settled(B, 'conflict'); B.wait_for_timeout(1000)
        conflict = B.evaluate("({ n: LRFApp.state.plan.plantings.length, stored: %s, strip: !document.getElementById('syncStrip').hidden, bad: document.getElementById('syncStrip').classList.contains('bad'), text: document.getElementById('syncStripText').innerText.replace(/\\s+/g, ' '), buttons: [...document.querySelectorAll('#syncStrip button')].map(b => b.textContent), save: document.getElementById('saveState').textContent })" % STORED)
        check('a change on the computer that is behind is kept there and not sent: the cloud is as the other left it', bc['status'] == 'conflict' and state()['plan']['etag'] == e4 and state()['plan']['meta']['plantings'] == n0 - 3 and conflict['n'] == n0 - 5 and conflict['stored'] == n0 - 5, [bc['status'], conflict])
        check('the page says so in words, with both plans described and both choices', conflict['strip'] and conflict['bad'] and 'different plans' in conflict['text'] and str(n0 - 3) in conflict['text'] and str(n0 - 5) in conflict['text'] and 'Nothing is sent or replaced until you choose' in conflict['text'] and conflict['buttons'] == ['Open the cloud’s plan', 'Keep this plan, and save it over the cloud’s'] and conflict['save'] == 'Cloud holds another plan · click', conflict)
        check('it fits at 1280', B.evaluate(FIT) == [], B.evaluate(FIT))
        B.screenshot(path=os.path.join(shots, 'conflict-strip.png'))
        for v in ['map', 'sow', 'harvest', 'seeds']:
            B.evaluate("(v) => LRFApp.setView(v)", v); B.wait_for_timeout(120)
            if B.evaluate("document.getElementById('syncStrip').hidden || document.getElementById('syncStrip').getBoundingClientRect().height < 20"):
                check('the strip shows on every view (%s)' % v, False)
        check('the strip shows on every view', True)
        change(B); B.wait_for_timeout(1500)
        check('more work there is kept and still not sent', state()['plan']['etag'] == e4 and B.evaluate(STORED) == n0 - 6 and B.evaluate("LRFApp.syncInfo().status") == 'conflict')
        B.evaluate("LRFApp.sync().run('poll')"); settled(B, 'conflict')
        B.keyboard.press('Control+s'); B.wait_for_timeout(1200)
        check('neither a look at the cloud nor Ctrl+S sends it', state()['plan']['etag'] == e4 and 'Not sent to the cloud' in toast(B), toast(B))
        B.click('#saveState'); B.wait_for_timeout(250)
        cw = B.evaluate("({ note: document.getElementById('syncNote2').innerText, buttons: [...document.querySelectorAll('.bk-choice button')].map(b => b.textContent), now: document.getElementById('syncNow').disabled, fit: %s })" % FIT)
        check('the window offers the same two choices, and "Sync now" is off until one is taken', 'never merged' in cw['note'] and cw['buttons'] == ['Open the cloud’s plan', 'Keep this plan, and save it over the cloud’s'] and cw['now'] and cw['fit'] == [], cw)
        B.screenshot(path=os.path.join(shots, 'conflict-window.png'))
        B.click('#syncKeep'); asked = answer(B, False)
        check('"Keep this plan" asks first, in figures; Cancel changes nothing', asked and str(n0 - 6) in asked and str(n0 - 3) in asked and 'keeps the replaced plan as a snapshot' in asked and state()['plan']['etag'] == e4 and B.evaluate("LRFApp.syncInfo().status") == 'conflict', asked)
        B.click('#syncKeep'); answer(B, True); settled(B, 'in-step')
        s6 = state(); kept = [k for k in dev()['keys'] if k.startswith('snap/auto-')]
        check('confirmed, the cloud holds this plan', s6['plan']['etag'] != e4 and s6['plan']['meta']['plantings'] == n0 - 6 and s6['plan']['meta']['label'] == 'Second computer', s6['plan'])
        check('and the cloud has kept the plan it replaced', len(kept) == 1, dev()['keys'])
        B.evaluate("document.querySelector('#syncDlg') && document.getElementById('syncDone').click()")
        e5 = s6['plan']['etag']
        # A, unchanged since its last send, is offered that plan; then changes before answering
        A.evaluate("LRFApp.sync().run('focus')"); settled(A, 'newer')
        check('the other computer, unchanged since, is offered it', A.evaluate("!document.getElementById('syncStrip').hidden && LRFApp.state.plan.plantings.length") == n0 - 3)
        check('the strip fits at 1480', A.evaluate(FIT) == [], A.evaluate(FIT))
        change(A); A.wait_for_timeout(1100); ac = settled(A, 'conflict')
        check('changed before answering, it becomes a choice between two plans, and nothing is sent', ac['status'] == 'conflict' and state()['plan']['etag'] == e5 and 'different plans' in A.evaluate("document.getElementById('syncStripText').innerText"), ac['status'])
        A.click('#stripOpen'); asked = answer(A, False)
        check('"Open the cloud’s plan" over changed work asks first, and says the plan here is kept as a snapshot', asked and 'kept as a snapshot first' in asked and str(n0 - 4) in asked and A.evaluate("LRFApp.state.plan.plantings.length") == n0 - 4, asked)
        A.click('#stripOpen'); answer(A, True); settled(A, 'in-step'); A.wait_for_timeout(400)
        asn = snaps(A)
        check('confirmed, the cloud’s plan is open here and the two browsers agree again', A.evaluate("LRFApp.state.plan.plantings.length") == n0 - 6 and A.evaluate(PLANTS) == B.evaluate(PLANTS) and A.evaluate("document.getElementById('syncStrip').hidden") and state()['plan']['etag'] == e5, A.evaluate("LRFApp.state.plan.plantings.length"))
        check('and the work that was replaced can be gone back to', any(s['auto'] and s['here'] and s['n'] == n0 - 4 for s in asn), asn)

        # ── 7. start-up ──
        change(B, 1); B.wait_for_function("LRFApp.syncInfo().cloud.etag !== '%s' && LRFApp.syncInfo().status === 'in-step' && !LRFApp.syncInfo().busy" % e5, timeout=30000)
        e6 = state()['plan']['etag']
        A.reload(); ready(A); settled(A, 'in-step', 60000); A.wait_for_timeout(500)
        up = A.evaluate("({ n: LRFApp.state.plan.plantings.length, toast: document.getElementById('toast').textContent, strip: document.getElementById('syncStrip').hidden })")
        check('opened again with nothing changed since its last sync, a browser takes the newer plan by itself and says so', up['n'] == n0 - 7 and 'newer plan was opened from the cloud' in up['toast'] and 'Snapshots' in up['toast'] and up['strip'] and state()['plan']['etag'] == e6, up)
        check('keeping the plan it had as a snapshot', any(s['auto'] and s['n'] == n0 - 6 for s in snaps(A)), snaps(A))
        change(A, 1); A.wait_for_function("LRFApp.syncInfo().cloud.etag !== '%s' && LRFApp.syncInfo().status === 'in-step' && !LRFApp.syncInfo().busy" % e6, timeout=30000)
        e7 = state()['plan']['etag']
        B.evaluate("LRFSync.timing.push = 600000"); change(B, 2); B.wait_for_timeout(1200)   # changed there, and closed before it was sent
        B.reload(); ready(B); bcs = settled(B, 'conflict', 60000)
        check('opened again with unsent work, and the cloud moved on: nothing is opened over it and nothing is sent', bcs['status'] == 'conflict' and B.evaluate("LRFApp.state.plan.plantings.length") == n0 - 9 and state()['plan']['etag'] == e7 and not B.evaluate("document.getElementById('syncStrip').hidden"), bcs['status'])
        B.click('#stripOpen'); answer(B, True); settled(B, 'in-step')

        # ── 8. no connection ──
        A.route(SYNC + '/**', lambda r: r.abort())
        change(A, 1); aw = settled(A, 'waiting'); A.wait_for_timeout(1000)
        off = A.evaluate("({ save: document.getElementById('saveState').textContent, state: document.getElementById('saveState').dataset.state, n: LRFApp.state.plan.plantings.length, stored: %s, strip: document.getElementById('syncStrip').hidden, fit: %s })" % (STORED, FIT))
        check('with no connection a change is kept here, and the indicator says the cloud is waiting, without alarm', aw['status'] == 'waiting' and off['save'] == 'Saved here · cloud waiting' and off['state'] == 'saved' and off['n'] == n0 - 9 and off['stored'] == n0 - 9 and off['strip'] and off['fit'] == [], off)
        A.reload(); ready(A); settled(A, 'waiting', 60000)
        check('the planner opens and works with no connection, the unsent change still there', A.evaluate("LRFApp.state.plan.plantings.length") == n0 - 9 and A.evaluate("LRFApp.syncInfo().status") == 'waiting')
        A.unroute(SYNC + '/**')
        A.evaluate("window.dispatchEvent(new Event('online'))"); settled(A, 'in-step')
        check('when the connection is back the change is sent, with no question', state()['plan']['meta']['plantings'] == n0 - 9 and state()['plan']['etag'] != e7)

        # ── 9. snapshots ──
        A.click('#dataBtn'); A.click('#snapBtn'); appears(A, "document.querySelectorAll('#snapList .snap-row').length > 0")
        lst = A.evaluate("({ rows: [...document.querySelectorAll('#snapList .snap-row')].map(r => [r.querySelector('.snap-name').textContent, r.dataset.auto, r.dataset.where]), rules: document.getElementById('snapRules').textContent, fit: %s })" % FIT)
        check('Snapshots lists what has been kept so far: this browser’s automatic ones, and what the cloud keeps', any(r[1] == '1' and r[2] == 'this browser' for r in lst['rows']) and any(r[2] == 'cloud' and 'before it was replaced' in r[0] for r in lst['rows']) and 'copied to the cloud' in lst['rules'] and lst['fit'] == [], lst)
        check('the first change of the day kept the plan as it stood before it, once, however often the page was opened since', len([r for r in lst['rows'] if r[0].startswith('Start of ') and r[1] == '1' and r[2] == 'this browser']) == 1, lst['rows'])
        A.fill('#snapName', 'Before releasing pins'); A.click('#snapTake')
        appears(A, "[...document.querySelectorAll('#snapList .snap-row')].some(r => r.querySelector('.snap-name').textContent === 'Before releasing pins' && r.dataset.where === 'this browser + cloud')", 15000)
        row = A.evaluate("(() => { const r = [...document.querySelectorAll('#snapList .snap-row')].find(r => r.querySelector('.snap-name').textContent === 'Before releasing pins'); return r && { where: r.dataset.where, auto: r.dataset.auto, text: r.innerText.replace(/\\s+/g, ' '), first: r === document.querySelector('#snapList .snap-row'), say: document.getElementById('snapSay').textContent, name: document.getElementById('snapName').value }; })()")
        check('a named snapshot is taken with one click, listed first, and copied to the cloud', row and row['where'] == 'this browser + cloud' and row['auto'] == '' and str(n0 - 9) in row['text'] and row['first'] and 'Kept' in row['say'] and row['name'] == '', row)
        check('the list fits at 1480', A.evaluate(FIT) == [], A.evaluate(FIT))
        A.screenshot(path=os.path.join(shots, 'snapshots.png'))
        A.keyboard.press('Escape'); A.wait_for_timeout(150)
        check('Escape closes it', A.evaluate("!document.querySelector('#snapDlg')"))
        change(A, 4); A.wait_for_timeout(300)
        before_restore = A.evaluate(PLANTS)
        A.evaluate("LRFBackupUI.openSnaps()"); appears(A, "[...document.querySelectorAll('#snapList .snap-name')].some(n => n.textContent === 'Before releasing pins')")
        A.evaluate("[...document.querySelectorAll('#snapList .snap-row')].find(r => r.querySelector('.snap-name').textContent === 'Before releasing pins').querySelector('[data-act=restore]').click()")
        asked = answer(A, False)
        check('going back asks first and says what will happen; Cancel changes nothing', asked and 'Go back to “Before releasing pins”?' in asked and str(n0 - 9) in asked and 'kept as a snapshot first' in asked and A.evaluate(PLANTS) == before_restore, asked)
        A.evaluate("[...document.querySelectorAll('#snapList .snap-row')].find(r => r.querySelector('.snap-name').textContent === 'Before releasing pins').querySelector('[data-act=restore]').click()")
        answer(A, True); appears(A, "/as it was at/.test(document.getElementById('toast').textContent)", 20000)
        back = A.evaluate("({ n: LRFApp.state.plan.plantings.length, stored: %s, toast: document.getElementById('toast').innerText, dlg: !!document.querySelector('#snapDlg'), map: LRFApp.state.mapImageUrl.slice(0, 5), thumbs: LRFThumbs.count(), note: document.getElementById('buildNote').textContent, undo: LRFApp.state.undo.length })" % STORED)
        check('confirmed, the plan is what it was, photos and all', back['n'] == n0 - 9 and back['stored'] == n0 - 9 and 'Before releasing pins' in back['toast'] and 'Take it back' in back['toast'] and not back['dlg'] and back['map'] == 'blob:' and back['thumbs'] > 100, back)
        A.click('#toast .toast-action'); appears(A, "LRFApp.state.plan.plantings.length === %d" % (n0 - 13), 20000); appears(A, "/Taken back/.test(document.getElementById('toast').textContent)", 30000)
        check('"Take it back" returns to the plan as it was before going back, with no second question', A.evaluate(PLANTS) == before_restore and 'Taken back' in toast(A), [A.evaluate(PLANTS), before_restore, toast(A)])
        sent = appears(A, "LRFApp.syncInfo().status === 'in-step' && !LRFApp.syncInfo().busy && LRFApp.syncInfo().cloud.meta.plantings === %d" % (n0 - 13), 60000)
        check('and what is open is what the cloud holds', sent and state()['plan']['meta']['plantings'] == n0 - 13, state()['plan']['meta'])
        # the other computer sees the named snapshot, and can go back to it
        B.evaluate("LRFApp.sync().run('focus')"); settled(B); B.evaluate("document.getElementById('stripOpen') && document.getElementById('stripOpen').click()"); settled(B, 'in-step')
        B.evaluate("LRFBackupUI.openSnaps()"); appears(B, "[...document.querySelectorAll('#snapList .snap-name')].some(n => n.textContent === 'Before releasing pins')", 15000)
        brow = B.evaluate("(() => { const r = [...document.querySelectorAll('#snapList .snap-row')].find(r => r.querySelector('.snap-name').textContent === 'Before releasing pins'); return r && { where: r.dataset.where, text: r.innerText.replace(/\\s+/g, ' '), fit: %s }; })()" % FIT)
        check('a named snapshot taken on one computer is listed on the other', brow and brow['where'] == 'cloud' and 'from Work laptop' in brow['text'] and brow['fit'] == [], brow)
        B.screenshot(path=os.path.join(shots, 'snapshots-1280.png'))
        B.evaluate("[...document.querySelectorAll('#snapList .snap-row')].find(r => r.querySelector('.snap-name').textContent === 'Before releasing pins').querySelector('[data-act=restore]').click()")
        answer(B, True); appears(B, "LRFApp.state.plan.plantings.length === %d" % (n0 - 9), 20000)
        check('and can be gone back to from there', B.evaluate("LRFApp.state.plan.plantings.length") == n0 - 9)
        B.wait_for_function("LRFApp.syncInfo().status === 'in-step' && !LRFApp.syncInfo().busy && LRFApp.syncInfo().cloud.meta.plantings === %d" % (n0 - 9), timeout=40000)
        A.evaluate("LRFApp.sync().run('focus')"); settled(A, 'newer'); A.click('#stripOpen'); settled(A, 'in-step'); A.wait_for_timeout(400)
        check('which the first computer is then offered in its turn', A.evaluate("LRFApp.state.plan.plantings.length") == n0 - 9 and A.evaluate(PLANTS) == B.evaluate(PLANTS))
        with A.expect_download() as dl:
            A.evaluate("LRFBackupUI.openSnaps()"); appears(A, "[...document.querySelectorAll('#snapList .snap-name')].some(n => n.textContent === 'Before releasing pins')")
            A.evaluate("[...document.querySelectorAll('#snapList .snap-row')].find(r => r.querySelector('.snap-name').textContent === 'Before releasing pins').querySelector('[data-act=download]').click()")
        path = dl.value.path(); text = open(path, encoding='utf-8').read(); filed = json.loads(text)
        check('a snapshot downloads as an ordinary plan file', dl.value.suggested_filename.endswith('Before-releasing-pins.json') and len(filed['plantings']) == n0 - 9 and 'lrfNextKeep' in filed, dl.value.suggested_filename)
        A.evaluate("[...document.querySelectorAll('#snapList .snap-row')].find(r => r.querySelector('.snap-name').textContent === 'Before releasing pins').querySelector('[data-act=delete]').click()")
        asked = answer(A, True); A.wait_for_timeout(1200)
        check('deleting one asks first and removes it here and in the cloud; the plan is not touched', asked and 'Delete “Before releasing pins”?' in asked and not any(s['name'] == 'Before releasing pins' for s in snaps(A)) and not any('s-' in k and k.startswith('snap/s-') for k in dev()['keys']) and A.evaluate("LRFApp.state.plan.plantings.length") == n0 - 9, [asked, dev()['keys']])
        A.click('#snapClose')
        # a backup file loaded over the plan
        change(A, 2); A.wait_for_function("LRFApp.syncInfo().status === 'in-step' && !LRFApp.syncInfo().busy && LRFApp.syncInfo().cloud.meta.plantings === %d" % (n0 - 11), timeout=40000)
        autos_before = len([k for k in dev()['keys'] if k.startswith('snap/auto-')])
        A.set_input_files('#importFile', path); answer(A, True); appears(A, "LRFApp.state.plan.plantings.length === %d" % (n0 - 9), 20000); A.wait_for_timeout(500)
        check('loading a backup file over the plan keeps the plan that was open as a snapshot first', any(s['auto'] and s['n'] == n0 - 11 and s['name'].startswith('Before loading ') for s in snaps(A)), snaps(A))
        A.wait_for_function("LRFApp.syncInfo().status === 'in-step' && !LRFApp.syncInfo().busy && LRFApp.syncInfo().cloud.meta.plantings === %d" % (n0 - 9), timeout=40000)
        check('and the cloud keeps the plan it held before the loaded one was sent', len([k for k in dev()['keys'] if k.startswith('snap/auto-')]) == autos_before + 1, dev()['keys'])
        many = A.evaluate("(async () => { for (let i = 0; i < 24; i++) { LRFApp.removePlantings([LRFApp.state.plan.plantings[0].id]); await LRFApp.snapshot('auto ' + i, { auto: true }); } const s = (await LRFApp.snapshots()).rows.filter(r => r.here); LRFApp.state.undo.length && 0; return { autos: s.filter(r => r.auto).length, named: s.filter(r => !r.auto).length }; })()")
        check('the newest 20 automatic snapshots are kept', many['autos'] == 20, many)
        for _ in range(24): A.evaluate("LRFApp.undo()")
        A.wait_for_timeout(1500); settled(A, 'in-step', 60000)

        # ── 10. the passphrase is changed ──
        dev(key='another phrase entirely'); CURRENT[0] = 'another phrase entirely'; TOKEN[0] = None
        change(A, 1); asg = settled(A, 'signin'); A.wait_for_timeout(1000)
        sg = A.evaluate("({ save: document.getElementById('saveState').textContent, n: LRFApp.state.plan.plantings.length, stored: %s, note: document.getElementById('syncNote').textContent })" % STORED)
        check('when the passphrase is changed, the browser says it needs it again, and the work is kept here', asg['status'] == 'signin' and sg['save'] == 'Cloud needs the passphrase · click' and sg['stored'] == sg['n'] and 'passphrase' in sg['note'], sg)
        A.click('#saveState'); A.wait_for_timeout(250)
        again = A.evaluate("({ url: document.getElementById('syncUrl').value, btn: document.getElementById('syncConnect').textContent, lead: document.querySelector('#syncDlg .dlg-lead').textContent, label: document.getElementById('syncLabel').value, fit: %s })" % FIT)
        check('a click opens the window with the address already there, asking for the passphrase only', again['url'] == SYNC and again['btn'] == 'Sign in' and 'passphrase again' in again['lead'] and again['label'] == 'Work laptop' and again['fit'] == [], again)
        A.fill('#syncKey', 'another phrase entirely'); A.click('#syncConnect'); settled(A, 'in-step')
        check('signed in again, the waiting change is sent with no question', state()['plan']['meta']['plantings'] == sg['n'] and state()['plan']['meta']['label'] == 'Work laptop', state()['plan']['meta'])
        A.evaluate("document.querySelector('#syncDlg') && document.getElementById('syncDone').click()")

        # ── 11. too many wrong passphrases ──
        C = device(1280, sample=True); C.goto(url); ready(C); C.click('#firstCloud'); C.wait_for_timeout(200)
        C.fill('#syncUrl', SYNC)
        for i in range(6):
            C.fill('#syncKey', 'guess %d' % i); C.click('#syncConnect'); C.wait_for_function("!document.getElementById('syncConnect').disabled", timeout=20000)
        lock = C.evaluate("document.getElementById('syncSay').textContent")
        check('after five wrong tries the service shuts, and the window says until when', 'Too many wrong passphrases' in lock and 'until' in lock, lock)
        C.fill('#syncKey', 'another phrase entirely'); C.click('#syncConnect'); C.wait_for_function("!document.getElementById('syncConnect').disabled", timeout=20000)
        check('the right one is refused too while it is shut, and nothing is opened', 'Too many wrong passphrases' in C.evaluate("document.getElementById('syncSay').textContent") and C.evaluate("LRFApp.isSample()"))
        A.evaluate("LRFApp.sync().run('poll')"); settled(A, 'in-step')
        check('a browser already signed in carries on meanwhile', A.evaluate("LRFApp.syncInfo().status") == 'in-step')
        dev(add=901)
        C.click('#syncConnect'); settled(C, 'in-step', 60000)
        check('a quarter of an hour later the right one works, and the plan opens there', not C.evaluate("LRFApp.isSample()") and C.evaluate(PLANTS) == A.evaluate(PLANTS), [C.evaluate(PLANTS), A.evaluate(PLANTS)])
        C.context.close()

        # ── 12. a plan in each ──
        D = device(1480); D.goto(url); ready(D)
        if PLAN_FILE:
            D.set_input_files('#importFile', PLAN_FILE); D.wait_for_function("!LRFApp.isSample()", timeout=60000); D.wait_for_timeout(2500)
        change(D, 30)
        D.evaluate("LRFBackupUI.openSync()"); D.fill('#syncUrl', SYNC); D.fill('#syncKey', 'another phrase entirely'); D.fill('#syncLabel', 'Third'); D.click('#syncConnect'); dc = settled(D, 'conflict', 60000)
        both = D.evaluate("({ strip: document.getElementById('syncStripText').innerText.replace(/\\s+/g, ' '), note: document.getElementById('syncNote2').innerText, n: LRFApp.state.plan.plantings.length, fit: %s })" % FIT)
        check('a browser that has its own plan, signing in to a cloud that holds another, is asked which is the plan and sends nothing', dc['status'] == 'conflict' and dc['first'] and 'already holds a plan, and so does this browser' in both['strip'] and 'Both hold a plan' in both['note'] and both['n'] == n0 - 30 and state()['plan']['meta']['label'] == 'Work laptop' and both['fit'] == [], [dc['status'], both])
        D.screenshot(path=os.path.join(shots, 'both-hold-a-plan.png'))
        D.click('#syncLeave'); answer(D, True); D.wait_for_timeout(300)
        left = D.evaluate("({ stored: localStorage.getItem('lrf-next:sync'), status: LRFApp.syncInfo().status, strip: document.getElementById('syncStrip').hidden, n: LRFApp.state.plan.plantings.length, save: document.getElementById('saveState').textContent, form: !!document.getElementById('syncUrl') })")
        check('"Disconnect" forgets the address and the sign-in there, and leaves both plans alone', left['stored'] is None and left['status'] == 'off' and left['strip'] and left['n'] == n0 - 30 and 'loud' not in left['save'] and left['form'] and state()['plan']['meta']['label'] == 'Work laptop', left)
        D.context.close()

        # ── 13. a stored plan that will not open ──
        A.evaluate("localStorage.setItem('lrf-next:plan', localStorage.getItem('lrf-next:plan').slice(0, 5000))")
        e9 = state()['plan']['etag']
        A.reload(); ready(A); A.wait_for_timeout(1500)
        heldA = A.evaluate("({ unreadable: !!LRFApp.state.unreadable, status: LRFApp.syncInfo().status, stored: localStorage.getItem('lrf-next:plan').length })")
        check('with a stored plan that will not open, nothing is sent and nothing is opened by itself', heldA['unreadable'] and heldA['status'] == 'held' and heldA['stored'] == 5000 and state()['plan']['etag'] == e9, heldA)
        A.evaluate("LRFBackupUI.openSync()"); A.wait_for_timeout(400)
        A.evaluate("LRFApp.sync().run('poll')"); A.wait_for_timeout(600)
        A.evaluate("void LRFBackupUI.openCloud()"); asked = answer(A, True); settled(A, 'in-step', 60000)
        check('the cloud’s plan can be asked for from there; it asks before replacing what is stored', asked and 'could not be opened' in asked and not A.evaluate("!!LRFApp.state.unreadable") and A.evaluate("LRFApp.state.plan.plantings.length") == state()['plan']['meta']['plantings'] and A.evaluate("document.getElementById('firstRun').hidden"), asked)
        A.evaluate("document.querySelector('#syncDlg') && document.getElementById('syncDone').click()")

        # ── 14. with a plan folder as well ──
        A.evaluate("(async () => { const root = await navigator.storage.getDirectory(); const dir = await root.getDirectoryHandle('plan-folder', { create: true }); await LRFFolder.use(dir, { keep: false }); await LRFApp.saveToFolder(); })()"); A.wait_for_timeout(1200)
        fold = A.evaluate("({ save: document.getElementById('saveState').textContent, title: document.getElementById('saveState').title, note: document.getElementById('saveNowNote').textContent, fit: %s })" % FIT)
        check('with a folder and a cloud, the indicator answers for both and still fits', fold['save'].startswith('Saved · folder + cloud ') and 'plan-folder' in fold['title'] and 'sent to the cloud' in fold['title'] and 'and sends it to the cloud' in fold['note'] and fold['fit'] == [], fold)
        A.set_viewport_size({'width': 1280, 'height': 800}); A.wait_for_timeout(200)
        check('at 1280 as well', A.evaluate(FIT) == [], [save_text(A), A.evaluate(FIT)])
        A.screenshot(path=os.path.join(shots, 'folder-and-cloud-1280.png'))

        check('no page errors on any of the browsers', A.errors == [] and B.errors == [], [A.errors, B.errors])
    except Exception as e:
        where = []
        for pg in (A, B):
            try:
                where.append(pg.evaluate("({ sync: LRFApp.syncInfo(), n: LRFApp.state.plan.plantings.length, toast: document.getElementById('toast').textContent, save: document.getElementById('saveState').textContent })"))
            except Exception as e2:
                where.append(repr(e2)[:100])
        try:
            A.screenshot(path=os.path.join(shots, 'where-it-stopped-A.png')); B.screenshot(path=os.path.join(shots, 'where-it-stopped-B.png'))
        except Exception:
            pass
        check('the check ran to its end', False, [repr(e)[:300], where])
    finally:
        try:
            browser.close()
        except Exception:
            pass
        service.terminate()

print('\n'.join(results))
print(json.dumps({'passed': len(results) - len(failed), 'of': len(results), 'failed': failed}))
