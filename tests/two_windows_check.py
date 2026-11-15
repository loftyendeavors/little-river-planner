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

How it is mended, and the lines that hold each part of it. One window holds the plan and any other only shows it: the second
window says so, takes no change and leaves what is stored byte for byte; "Use this window instead" hands the plan over, and
the window that had it says so and writes nothing after. A change made just before the page is hidden is saved. A stored plan
that is behind what this browser last noted of the cloud (here: an older text put back under a lower count) is not sent by
itself. The pages of one browser context share storage and locks, as the windows of one browser do.
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
# What this browser stores of the plan and of the cloud, exactly: the plan's text, the count beside it, the note of being in step.
KEPT = "() => ['lrf-next:plan', 'lrf-next:plan-n', 'lrf-next:sync'].map(k => localStorage.getItem(k))"
# The strip of a window that only shows the plan, and what the window says of itself.
STRIP = """() => { const s = document.getElementById('windowStrip'), t = document.getElementById('windowStripText'), l = LRFApp.state.last;
  return { state: LRFApp.windowState(), shown: !!s && !s.hidden && s.getBoundingClientRect().height > 20, text: t ? t.innerText.replace(/\\s+/g, ' ').trim() : '', buttons: s ? [...s.querySelectorAll('button')].map(b => b.textContent.trim()) : [],
    refused: l && l.kind === 'refused' ? l.text : null, save: document.getElementById('saveState').textContent }; }"""
READY = 'window.LRFApp && LRFApp.state.ready'

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
    # before anything is changed anywhere: the second window already says it only shows the plan, and a change tried in it is turned down in words
    tried = B.evaluate(CHANGE, [4, 'word-never-taken']); second = B.evaluate(STRIP); first_w = A.evaluate(STRIP)
    check("a second window says why it takes no change", second['state'] == 'window' and second['shown'] and 'open in another window of this browser' in second['text'] and second['buttons'] == ['Use this window instead']
          and tried['took'] is False and 'another window' in (second['refused'] or '') and first_w['state'] == '' and not first_w['shown'], [tried, second, first_w])
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
    # everything a window that only shows the plan can be asked to do: a change, undo, the manual save, a whole plan loaded over it, going
    # back to a snapshot, the page hidden, the store's own timer. What the browser stores is the same text after it, to the byte.
    before = B.evaluate(KEPT)
    asked = B.evaluate("""async () => { const A = LRFApp, p = A.state.plan.plantings[7], out = {};
      out.change = A.updatePlanting(p.id, { note: 'word-never-stored' }, 'A note') === true;
      A.undo(); A.redo(); out.saved = await A.saveNow();
      out.loaded = await A.importBackup(new File([JSON.stringify({ ...A.state.plan, plantings: A.state.plan.plantings.slice(0, 5) })], 'five.json', { type: 'application/json' }), { asked: true, exact: true, quiet: true });
      const snaps = (await A.snapshots()).rows; out.back = snaps.length ? await A.restoreSnapshot(snaps[0], { asked: true }) : 'no snapshot to go back to';
      out.folder = await A.saveToFolder();
      window.dispatchEvent(new Event('pagehide'));
      await new Promise(res => setTimeout(res, 1300));
      return { ...out, n: A.state.plan.plantings.length, snaps: (await A.snapshots()).rows.length === snaps.length }; }""")
    after = B.evaluate(KEPT)
    check("a reading window leaves the stored text byte for byte", before == after and before[0] is not None and len(before[0]) > 1000 and asked['change'] is False and not asked['saved'] and asked['loaded'] is False and asked['back'] in (False, 'no snapshot to go back to')
          and asked['n'] == same[0] and asked['snaps'], [asked, [len(x or '') for x in before], [len(x or '') for x in after]])
    A.screenshot(path=os.path.join(shots, 'two-windows.png')); B.screenshot(path=os.path.join(shots, 'two-windows-second.png'))
    # the plan is handed to the second window. The first has a change still waiting to be saved: it saves it at once, lets go, and says so.
    last = A.evaluate(CHANGE, [5, 'word-just-before-handing-over'])
    moved = {'asked': False}
    if B.query_selector('#windowUse'):
        with B.expect_navigation(timeout=30000):
            B.click('#windowUse')
        B.wait_for_function(READY, timeout=40000); B.wait_for_timeout(600)
        now_b, now_a = B.evaluate(STRIP), A.evaluate(STRIP)
        took_b = B.evaluate(CHANGE, [6, 'word-from-the-window-that-took-over']); B.wait_for_timeout(1300)
        count = B.evaluate("localStorage.getItem('lrf-next:plan-n')")
        late = A.evaluate("""async ([i, word]) => { const p = LRFApp.state.plan.plantings[i], took = LRFApp.updatePlanting(p.id, { note: word }, 'A note') === true;
          window.dispatchEvent(new Event('pagehide')); await new Promise(res => setTimeout(res, 1300)); return took; }""", [8, 'word-from-the-window-that-let-go'])
        moved = {'asked': True, 'here': now_b, 'there': now_a, 'the change that was waiting': B.evaluate(SHOWN, last['id']), 'took here': took_b['took'], 'stored': B.evaluate(STORED, 'word-from-the-window-that-took-over'),
                 'the first took after': late, 'and wrote': B.evaluate(STORED, 'word-from-the-window-that-let-go') or B.evaluate("localStorage.getItem('lrf-next:plan-n')") != count}
    check("Use this window instead moves the plan to that window and the first says so", moved['asked'] and moved['here']['state'] == '' and not moved['here']['shown'] and moved['the change that was waiting'] == 'word-just-before-handing-over'
          and moved['took here'] and moved['stored'] and moved['there']['state'] == 'moved' and moved['there']['shown'] and 'now being worked on in another window' in moved['there']['text'] and moved['there']['buttons'] == ['Reload']
          and moved['the first took after'] is False and not moved['and wrote'], moved)
    A.screenshot(path=os.path.join(shots, 'two-windows-let-go.png'))
    # a change, and the page hidden straight after it: the save does not wait for its timer. Hidden as a phone hides a page (it says so), and as a reload puts one away.
    H = next((w for w in (B, A) if w.evaluate("LRFApp.windowState()") == ''), None)
    hid = {'window': H is not None}
    if H:
        hid['at once'] = H.evaluate("""([i, word]) => { const p = LRFApp.state.plan.plantings[i]; LRFApp.updatePlanting(p.id, { note: word }, 'A note');
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); delete document.visibilityState;
          return (localStorage.getItem('lrf-next:plan') || '').includes(word); }""", [9, 'word-just-before-hiding'])
        g = H.evaluate(CHANGE, [10, 'word-just-before-putting-away']); H.reload(); H.wait_for_function(READY, timeout=40000); H.wait_for_timeout(400)
        hid.update({'took': g['took'], 'again': H.evaluate(SHOWN, g['id']), 'holds the plan again': H.evaluate("LRFApp.windowState()") == ''})
    check("a change made within 0.2 s of the page being hidden is there when it is opened again", hid['window'] and hid.get('at once') and hid.get('took') and hid.get('again') == 'word-just-before-putting-away' and hid.get('holds the plan again'), hid)
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
    # the second window only shows the plan, so it sends and opens nothing by itself ("held"): it is in step when the plan it shows is the one this browser noted
    noted = B.evaluate("LRFApp.contentKey() === (JSON.parse(localStorage.getItem('lrf-next:sync') || '{}').key || null)")
    check("with cloud sync on, both windows start in step", first[0] == 'in-step' and (first[1] == 'in-step' or (first[1] == 'held' and noted)), first + [noted])
    old = A.evaluate(KEPT)   # the plan as it is stored before anything is changed, and its count: put back further down, as a plan that is behind
    a = A.evaluate(CHANGE, [2, 'cloud-word-from-window-one'])
    A.wait_for_function("LRFApp.syncInfo().status === 'in-step' && !LRFApp.syncInfo().busy && LRFApp.contentKey() === JSON.parse(localStorage.getItem('lrf-next:sync')).key", timeout=60000)
    A.wait_for_timeout(600)
    sent = 'cloud-word-from-window-one' in cloud_plan()
    check("the first window's change reaches the cloud", a['took'] and sent, {'took': a['took'], 'in the cloud': sent})
    A.wait_for_timeout(900)
    note = A.evaluate("({ ...JSON.parse(localStorage.getItem('lrf-next:sync') || '{}'), token: undefined, count: Number(localStorage.getItem('lrf-next:plan-n')), stored: undefined, plan: JSON.parse(localStorage.getItem('lrf-next:sync') || '{}').stored })")
    check("the browser notes the count of the stored plan it is in step with, and that this plan is the one stored", note.get('n') == note['count'] and note['count'] > 0 and note.get('plan') is True and note.get('key') == A.evaluate("LRFApp.contentKey()"), note)
    kept = B.evaluate(KEPT)
    quiet = B.evaluate("async () => { const s = LRFApp.sync(); s.rename('The other window'); const now = await s.run('poll'); return { status: now.status, sent: await LRFApp.saveNow() }; }")
    check("the window that only shows the plan sends nothing, and leaves this browser's note of the cloud as it was", quiet['status'] == 'held' and not quiet['sent'] and B.evaluate(KEPT) == kept and 'cloud-word-from-window-one' in cloud_plan(), quiet)
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
    # A stored plan that is behind. The older text is put back under its older count, by a page of this site that is not the planner,
    # as a window that wrote without looking would leave it. At the next start nothing is sent: the page asks which plan to keep.
    newest = C.evaluate(KEPT)
    C.close()
    P = ctx.new_page(); P.goto(ORIGIN + '/css/app.css')
    P.evaluate("([plan, n]) => { localStorage.setItem('lrf-next:plan', plan); if (n === null) localStorage.removeItem('lrf-next:plan-n'); else localStorage.setItem('lrf-next:plan-n', n); }", old[:2]); P.close()
    D = window(ctx)
    status = settled(D); D.wait_for_timeout(1200); status = settled(D)
    text = cloud_plan()
    asks = D.evaluate("({ strip: !document.getElementById('syncStrip').hidden, text: (document.getElementById('syncStripText') || { innerText: '' }).innerText.replace(/\\s+/g, ' '), save: document.getElementById('saveState').textContent })")
    behind = {'count stored': old[1], 'count noted': json.loads(newest[2] or '{}').get('n'), 'status': status, 'one in the cloud': 'cloud-word-from-window-one' in text, 'one here': D.evaluate(SHOWN, a['id']), 'asks': asks}
    check("a stored plan that is behind what was last sent is not sent by itself: the page asks which plan to keep", int(old[1] or 0) < (behind['count noted'] or 0) and status == 'conflict' and behind['one in the cloud'] and behind['one here'] is None
          and asks['strip'] and 'different plans' in asks['text'], behind)
    D.screenshot(path=os.path.join(shots, 'two-windows-behind.png'))
    check("no error on the page", not C.errors and not D.errors, [C.errors, D.errors])
    ctx.close()
    browser.close()

service.terminate(); server.shutdown()
for line in results:
    print(line)
print(json.dumps({'passed': len(results) - len(failed), 'of': len(results), 'failed': failed, 'details': [r for r in results if r.startswith('FAIL')]}))
sys.exit(0)
