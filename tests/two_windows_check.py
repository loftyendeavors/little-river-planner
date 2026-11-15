"""Two windows of the planner in one browser: no change a window took is lost, here or in the cloud.

usage: python3 -I two_windows_check.py <app-or-site-dir> <shots-dir> <repo-dir>

The fault this is for. The plan is one text in the browser's storage, written whole by whichever window saved last, and
each window writes the plan as it knows it. So with two windows open on one plan:
  - a change taken in the first window is gone from the stored plan as soon as the second window saves a change of its own;
  - and with cloud sync on it goes further. The first window's change reaches the cloud. The second window's save then puts
    an older plan in the browser's storage, beside the first window's note that this browser is in step with the cloud. At
    the next start the page reads that older plan as "changed here" and sends it over the cloud's newer one, asking nothing.
The lines below are written as what must hold, not as how it is mended: every change a window says it took is in the stored
plan once the windows have saved, and the cloud never loses a change that was sent to it unless the page has asked.
The sync service is the Worker's own code, served on this computer (tools/sync_dev_server.mjs), as in sync_check.py.
"""
import functools, gzip, http.server, json, os, socket, socketserver, subprocess, sys, threading, time, urllib.request
from playwright.sync_api import sync_playwright

target, shots, repo = sys.argv[1], sys.argv[2], sys.argv[3]
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
for _ in range(60):
    try:
        with urllib.request.urlopen(urllib.request.Request(SYNC + '/__dev', method='POST', data=b'{}'), timeout=20) as r:
            r.read()
        break
    except Exception:
        time.sleep(0.25)
TOKEN = [None]
def cloud(path, method='GET', body=None, headers=None, raw=False):
    if not TOKEN[0] and path != '/login':
        TOKEN[0] = cloud('/login', 'POST', body=json.dumps({'key': KEY}).encode(), headers={'content-type': 'application/json'})['token']
    req = urllib.request.Request(SYNC + path, method=method, data=body, headers={'origin': ORIGIN, **({'authorization': 'Bearer ' + TOKEN[0]} if TOKEN[0] else {}), **(headers or {})})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = r.read()
        return data if raw else json.loads(data or b'{}')
def cloud_plan():
    """The plan the cloud holds, as text."""
    data = cloud('/plan', raw=True)
    return (gzip.decompress(data) if data[:2] == b'\x1f\x8b' else data).decode('utf-8')

# A change that moves no date and no ground: a word in a planting's note. It says whether the window took it.
CHANGE = "([i, word]) => { const p = LRFApp.state.plan.plantings[i]; return { id: p.id, took: LRFApp.updatePlanting(p.id, { note: word }, 'A note') === true }; }"
STORED = "(word) => (localStorage.getItem('lrf-next:plan') || '').includes(word)"
SHOWN = "(id) => (LRFApp.state.engine.planting(id) || {}).note || null"

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    def window(ctx):
        page = ctx.new_page(); page.set_default_timeout(25000)
        page.errors = []
        page.on('pageerror', lambda e: page.errors.append(str(e)[:300]))
        page.goto(url)
        page.wait_for_function('window.LRFApp && LRFApp.state.ready', timeout=40000)
        page.evaluate("LRFSync.timing.push = 250")
        page.wait_for_timeout(900)
        return page
    def settled(page, timeout=60000):
        page.wait_for_function("() => { const c = LRFApp.syncInfo(); return !c.busy && !['checking', 'sending', 'receiving'].includes(c.status); }", timeout=timeout)
        page.wait_for_timeout(400)
        return page.evaluate("LRFApp.syncInfo().status")

    # ── 1. two windows, no cloud ──
    ctx = browser.new_context(viewport={'width': 1480, 'height': 900})
    A = window(ctx); B = window(ctx)
    same = [A.evaluate("LRFApp.state.plan.plantings.length"), B.evaluate("LRFApp.state.plan.plantings.length")]
    check("two windows of one browser open the same plan", same[0] == same[1] and same[0] > 10, same)
    a = A.evaluate(CHANGE, [0, 'word-from-window-one']); A.wait_for_timeout(1300)
    b = B.evaluate(CHANGE, [1, 'word-from-window-two']); B.wait_for_timeout(1300)
    kept = {'one took': a['took'], 'one stored': A.evaluate(STORED, 'word-from-window-one'), 'two took': b['took'], 'two stored': A.evaluate(STORED, 'word-from-window-two')}
    check("every change a window took is in the stored plan once both windows have saved", a['took'] and kept['one stored'] and (kept['two stored'] or not b['took']), kept)
    A.reload(); A.wait_for_function('window.LRFApp && LRFApp.state.ready', timeout=40000); A.wait_for_timeout(600)
    again = {'one': A.evaluate(SHOWN, a['id']), 'two': A.evaluate(SHOWN, b['id'])}
    check("and the first window, opened again, shows them", again['one'] == 'word-from-window-one' and (again['two'] == 'word-from-window-two' or not b['took']), again)
    if not b['took']:
        said = B.evaluate("document.body.innerText.includes('another')")
        check("a window that takes no changes says why", said)
    A.screenshot(path=os.path.join(shots, 'two-windows.png'))
    check("no error on either page", not A.errors and not B.errors, [A.errors, B.errors])
    ctx.close()

    # ── 2. two windows, with cloud sync on ──
    ctx = browser.new_context(viewport={'width': 1480, 'height': 900})
    A = window(ctx)
    A.evaluate("void LRFBackupUI.openSync()"); A.wait_for_selector('#syncUrl')
    A.fill('#syncUrl', SYNC); A.fill('#syncKey', KEY); A.fill('#syncLabel', 'Desk'); A.click('#syncConnect')
    A.wait_for_function("LRFApp.syncInfo().status === 'in-step' && !LRFApp.syncInfo().busy", timeout=60000)
    if A.query_selector('#syncDone'):
        A.click('#syncDone')
    B = window(ctx)
    first = [settled(A), settled(B)]
    check("with cloud sync on, both windows start in step", first == ['in-step', 'in-step'], first)
    a = A.evaluate(CHANGE, [2, 'cloud-word-from-window-one'])
    A.wait_for_function("LRFApp.syncInfo().status === 'in-step' && !LRFApp.syncInfo().busy && LRFApp.contentKey() === JSON.parse(localStorage.getItem('lrf-next:sync')).key", timeout=60000)
    A.wait_for_timeout(600)
    sent = 'cloud-word-from-window-one' in cloud_plan()
    check("the first window's change reaches the cloud", a['took'] and sent, {'took': a['took'], 'in the cloud': sent})
    b = B.evaluate(CHANGE, [3, 'cloud-word-from-window-two']); B.wait_for_timeout(1500)
    after_b = settled(B)
    A.close(); B.close()
    C = window(ctx)
    status = settled(C)
    C.wait_for_timeout(1200); status = settled(C)
    text = cloud_plan()
    held = {'window two took': b['took'], 'window two then': after_b, 'at the next start': status, 'one in the cloud': 'cloud-word-from-window-one' in text, 'two in the cloud': 'cloud-word-from-window-two' in text,
            'one here': C.evaluate(SHOWN, a['id']), 'two here': C.evaluate(SHOWN, b['id'])}
    asking = status in ('conflict', 'newer')
    check("at the next start the cloud has lost nothing that was sent to it, unless the page is asking which plan to keep", held['one in the cloud'] or asking, held)
    check("and nothing was sent over the cloud's plan without a question", held['one in the cloud'], held)
    C.screenshot(path=os.path.join(shots, 'two-windows-cloud.png'))
    check("no error on the page", not C.errors, C.errors)
    ctx.close()
    browser.close()

service.terminate(); server.shutdown()
for line in results:
    print(line)
print(json.dumps({'passed': len(results) - len(failed), 'of': len(results), 'failed': failed}))
sys.exit(0)
