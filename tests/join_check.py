"""S1c in two real browsers: two devices that both changed the plan are joined record by record, against the sync Worker's own code
served on this computer.

usage: python3 -I join_check.py <app-or-site-dir> <shots-dir> <repo-dir> [plan-file]

A is a laptop that opens the plan the app folder ships with (against the built site, which ships none, give a plan file: A loads
it first). B is a second device that starts with no plan and opens the cloud's.

The rules under test:
  - a device starts on "Ask me which plan to keep"; "Keep both, record by record" is set on each device, in Cloud sync, and turning
    it on takes a named snapshot and downloads a backup first;
  - with it on, a sowing recorded on one device and a planting changed on the other are both kept on both, seed is drawn once,
    and the page says what was taken in and from which device;
  - the plan that was here is kept as a snapshot before anything is taken in; undo and what is selected are kept;
  - nothing is taken in while a window is open on the page;
  - where both devices changed the same thing the other device's stands, the page says so until it is dismissed, and "Use mine"
    puts this device's value back as a change of its own;
  - undo, after another device changed the same record, takes out only what the step itself changed;
  - turned off, the page asks which plan to keep, as it always did.
"""
import functools, http.server, json, os, socket, socketserver, subprocess, sys, threading, time, urllib.request
from playwright.sync_api import sync_playwright

target, shots, repo = sys.argv[1], sys.argv[2], sys.argv[3]
PLAN_FILE = sys.argv[4] if len(sys.argv) > 4 else None
os.makedirs(shots, exist_ok=True)
results, failed = [], []
KEY = 'two words twice two words twice'

def check(name, ok, detail=None):
    results.append(('ok   ' if ok else 'FAIL ') + name + ('' if ok or detail is None else ' ' + json.dumps(detail, default=str)[:900]))
    if not ok:
        failed.append(name)
    if os.environ.get('LIVE'):
        print(results[-1][:1000], file=sys.stderr, flush=True)

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
        urllib.request.urlopen(urllib.request.Request(SYNC + '/__dev', method='POST', data=b'{}'), timeout=20).read(); break
    except Exception:
        time.sleep(0.25)

# a dialog or a strip that runs off the page, or a button whose words do not fit
FIT = """(() => { const out = []; for (const d of document.querySelectorAll('dialog[open]')) { const r = d.getBoundingClientRect(); if (r.left < 0 || r.top < 0 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) out.push(['dialog off screen', Math.round(r.right), Math.round(r.bottom)]); for (const el of d.querySelectorAll('button')) { const e = el.getBoundingClientRect(); if (e.width && (e.right > r.right + 0.5 || el.scrollWidth > el.clientWidth + 1)) out.push(['button', el.id || el.textContent, Math.round(e.right), Math.round(r.right)]); } }
  if (document.documentElement.scrollWidth > innerWidth) out.push(['page scrolls sideways', document.documentElement.scrollWidth]);
  for (const strip of document.querySelectorAll('.first-run:not([hidden])')) { const r = strip.getBoundingClientRect(); for (const el of strip.querySelectorAll('button, p')) { const e = el.getBoundingClientRect(); if (e.right > r.right + 0.5 || el.scrollWidth > el.clientWidth + 1) out.push(['strip', el.id, Math.round(e.right), Math.round(r.right)]); } }
  return out; })()"""
# a planting that can be sown from one counted lot, found on the plan and named nowhere
SUBJECT = """() => { const A = LRFApp, E = A.state.engine, SL = LRFSeedLib, inv = A.inventoryNow();
  for (const p of A.state.plan.plantings) { if (p.liveTray || p.done) continue; const s = A.sowingOf(p); if (!s || s.kind !== 'sow' || s.stockUnit !== 'seeds' || !(s.estimate > 0)) continue;
    const lots = SL.lotsFor(inv, s.key).filter(l => l.unit === 'seeds' && l.life === 'usable' && l.usable === true && Number(l.quantity) >= s.estimate); if (lots.length !== 1) continue;
    const d = s.planned, day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return { id: p.id, day, lot: lots[0].id, held: lots[0].quantity }; } return null; }"""
OTHERS = "(skip) => LRFApp.state.plan.plantings.filter(p => !p.liveTray && !p.done && p.id !== skip && !p.bedLayout).slice(0, 4).map(p => p.id)"
P = "(id) => { const p = LRFApp.state.plan.plantings.find(x => x.id === id); return p ? { note: p.note || '', price: p.price === undefined ? null : p.price, sown: (p.done || {}).sow || null, use: ((p.workflow || {}).seedUse || []).length } : null; }"
LOT = "(id) => (LRFApp.inventoryNow().lots.find(l => l.id === id) || {}).quantity"

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    def device(width, sample=False):
        ctx = browser.new_context(viewport={'width': width, 'height': 900}, accept_downloads=True)
        page = ctx.new_page(); page.set_default_timeout(25000)
        # the page's clock: late in the plan's year, so that the season's work can be recorded (work that has not happened yet is refused)
        page.add_init_script("(() => { const R = Date, off = new R(2027, 11, 20, 10).getTime() - R.now(); class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } } window.Date = D; })();")
        # a browser whose storage is full, for as long as the check says so (it holds over a reload): the plan cannot be written, everything else can
        page.add_init_script("(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (sessionStorage.getItem('check-full') && String(k).startsWith('lrf-next:plan')) throw new DOMException('full', 'QuotaExceededError'); return set.call(this, k, v); }; })();")
        # a join interrupted at a named moment, for as long as the check says so: the plan changed here, or the page made busy, as the records beside the plan
        # are written ('attic') or just after the joined plan is ('save'); and a browser that cannot read the records beside the plan
        page.add_init_script("""(() => { const S = sessionStorage, set = Storage.prototype.setItem, put = IDBObjectStore.prototype.put, get = IDBObjectStore.prototype.get;
          const busy = () => { if (document.body && !document.querySelector('dialog.check-busy')) { const d = document.createElement('dialog'); d.className = 'check-busy bk'; d.setAttribute('open', ''); d.style.display = 'none'; document.body.appendChild(d); } };
          if (S.getItem('check-busy')) addEventListener('DOMContentLoaded', busy);
          const at = where => { if (S.getItem('check-at') !== where) return; S.removeItem('check-at'); S.setItem('check-hit', where);
            const id = S.getItem('check-edit'); S.removeItem('check-edit'); if (id) window.LRFApp.updatePlanting(id, { note: S.getItem('check-edit-note') }, 'A note');
            S.setItem('check-busy', '1'); busy(); };
          Storage.prototype.setItem = function (k, v) { const r = set.call(this, k, v); if (this === localStorage && k === 'lrf-next:plan') { order('s'); at('save'); } return r; };
          IDBObjectStore.prototype.put = function (v, k) { if (this.name === 'blobs' && k === 'attic') at('attic'); return put.apply(this, arguments); };
          const order = what => S.setItem('check-order', (S.getItem('check-order') || '') + what), del = IDBObjectStore.prototype.delete;
          IDBObjectStore.prototype.delete = function (k) { if (this.name === 'blobs' && k === 'attic-new') order('c'); return del.apply(this, arguments); };
          IDBObjectStore.prototype.get = function (k) { if (this.name === 'blobs' && (k === 'attic' || k === 'attic-new') && S.getItem('check-noread')) throw new DOMException('unreadable', 'UnknownError'); return get.apply(this, arguments); };
        })();""")
        page.errors = []
        page.on('pageerror', lambda e: page.errors.append(str(e)[:300]))
        if sample:
            page.route('**/data/**', lambda r: r.abort())
        return page
    def ready(page):
        page.wait_for_function('window.LRFApp && LRFApp.state.ready', timeout=40000)
        page.evaluate("LRFSync.timing.push = 250; LRFSync.timing.idle = 300")
        page.wait_for_timeout(600)
    def settled(page, status=None, timeout=40000):
        # "in step" is asked for with nothing unsent: the plan open here is the very one this browser noted as the cloud's
        page.wait_for_function("(want) => { const c = LRFApp.syncInfo(); return !c.busy && !['checking', 'sending', 'receiving'].includes(c.status) && (!want || c.status === want) && (want !== 'in-step' || LRFApp.contentKey() === (JSON.parse(localStorage.getItem('lrf-next:sync') || '{}').key)); }", arg=status, timeout=timeout)
        page.wait_for_timeout(250)
        return page.evaluate("LRFApp.syncInfo()")
    def look(page, status='in-step'):
        """A look at the cloud, and whatever follows from it, until the page is in the state asked for."""
        page.wait_for_timeout(1700)   # a pause: nothing is taken in within a moment of a press or a change
        page.evaluate("void LRFApp.sync().run('poll')")
        return settled(page, status)
    def answer(page, yes=True):
        try:
            page.wait_for_function("[...document.querySelectorAll('dialog[open]')].some(d => !d.classList.contains('bk'))", timeout=8000)
        except Exception:
            return None
        text = page.evaluate("[...document.querySelectorAll('dialog[open]')].filter(d => !d.classList.contains('bk')).pop().innerText")
        page.evaluate("(yes) => { const d = [...document.querySelectorAll('dialog[open]')].filter(x => !x.classList.contains('bk')).pop(), b = d.querySelectorAll('.dialog-actions .btn'); (yes ? b[b.length - 1] : b[0]).click(); }", yes)
        return text
    toast = lambda page: page.evaluate("document.getElementById('toast').textContent")
    snaps = lambda page: page.evaluate("LRFApp.snapshots().then(s => s.rows.map(r => ({ name: r.name, auto: !!r.auto, here: !!r.here, cloud: !!r.cloud })))")

    A = device(1480); B = device(1280, sample=True)
    where = 'start'
    try:
        A.goto(url); ready(A)
        if PLAN_FILE:
            A.set_input_files('#importFile', PLAN_FILE); A.wait_for_function("!LRFApp.isSample()", timeout=60000)
            A.wait_for_function("document.getElementById('saveState').dataset.state === 'saved'", timeout=180000); A.wait_for_timeout(1500)
        # Seed on hand is the plan's own from the first change made to it, so that both devices count from the same lots: a lot is
        # added here for a sowing that has none (the built site's plan comes with no seed on hand at all).
        A.evaluate("""(() => { const A = LRFApp, SL = LRFSeedLib; for (const p of A.state.plan.plantings) { if (p.liveTray || p.done) continue; const s = A.sowingOf(p);
          if (!s || s.kind !== 'sow' || s.stockUnit !== 'seeds' || !(s.estimate > 0) || SL.lotsFor(A.inventoryNow(), s.key).length) continue;
          return A.editStock('Add', (inv, ctx) => SL.addLot(inv, { key: s.key, unit: 'seeds', quantity: Math.ceil(s.estimate * 3), status: 'usable' }, ctx)); } return null; })()"""); A.wait_for_timeout(300)
        A.evaluate("([u, k]) => LRFApp.sync().connect(u, k, 'Work laptop')", [SYNC, KEY]); settled(A, 'in-step')
        B.goto(url); ready(B)
        B.evaluate("([u, k]) => LRFApp.sync().connect(u, k, 'Phone')", [SYNC, KEY]); settled(B, 'in-step')
        B.wait_for_function("!LRFApp.isSample()", timeout=60000)
        sub = A.evaluate(SUBJECT)
        check('the plan has a planting that one counted lot can sow, and both devices hold the plan', bool(sub) and B.evaluate("LRFApp.state.plan.plantings.length") == A.evaluate("LRFApp.state.plan.plantings.length"), sub)
        if not sub:
            raise RuntimeError('no subject')
        X1, X2, X3, X4 = A.evaluate(OTHERS, sub['id'])

        # ── 1. the switch ──
        where = 'the switch'
        A.evaluate("LRFBackupUI.openSync()"); A.wait_for_timeout(300)
        row = A.evaluate("({ there: !!document.getElementById('syncJoin'), on: document.getElementById('syncJoinOn').getAttribute('aria-pressed'), off: document.getElementById('syncJoinOff').getAttribute('aria-pressed'), words: document.getElementById('syncJoin').closest('.bk-row').innerText, info: LRFApp.syncInfo().join })")
        check('Cloud sync has one line, "When two devices have both changed the plan", and it starts on "Ask me which plan to keep"', row['there'] and row['on'] == 'false' and row['off'] == 'true' and row['info'] is False and 'When two devices have both changed the plan' in row['words'] and 'Keep both, record by record' in row['words'], row)
        # L3: a choice of one of two is one switch, bordered, the chosen side in ink (DESIGN.md, "One switch")
        seg = A.evaluate("""(() => { const s = document.querySelector('[data-hook="sync-join"]'), ways = s ? [...s.querySelectorAll('[data-hook="sync-join-way"]')] : [], cs = s && getComputedStyle(s);
          const i = document.createElement('i'); i.style.color = 'var(--ink)'; document.body.append(i); const ink = getComputedStyle(i).color; i.remove();
          return { ways: ways.map(b => b.id), bordered: !!cs && parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none', one: ways.length ? Math.abs(ways[0].getBoundingClientRect().top - ways[ways.length - 1].getBoundingClientRect().top) < 1 : false,
            inked: ways.filter(b => getComputedStyle(b).backgroundColor === ink).map(b => b.getAttribute('aria-pressed')) }; })()""")
        check('the choice is one switch: its two sides in one bordered box, side by side, the chosen one in ink (L3)', seg['ways'] == ['syncJoinOn', 'syncJoinOff'] and seg['bordered'] and seg['one'] and seg['inked'] == ['true'], seg)
        check('the Cloud sync window fits at 1480 with the line in it', A.evaluate(FIT) == [], A.evaluate(FIT))
        A.screenshot(path=os.path.join(shots, 'switch-off.png'))
        A.click('#syncJoinOn'); said = answer(A, yes=False); A.wait_for_timeout(300)
        check('turning it on asks first, in words that say what it does, and Cancel leaves it off', bool(said) and 'record by record' in said and 'snapshot' in said and A.evaluate("LRFApp.syncInfo().join") is False, said)
        A.evaluate("(() => { window.__export = LRFApp.exportBackup; LRFApp.exportBackup = async () => false; })()")
        A.click('#syncJoinOn'); answer(A, yes=True); A.wait_for_timeout(2500)
        nofile = A.evaluate("({ join: LRFApp.syncInfo().join, on: document.getElementById('syncJoinOn').getAttribute('aria-pressed'), toast: document.getElementById('toast').textContent })")
        check('when the backup file cannot be saved, nothing is turned on, and the page says so', nofile['join'] is False and nofile['on'] == 'false' and 'nothing was turned on' in nofile['toast'], nofile)
        A.evaluate("(() => { LRFApp.exportBackup = window.__export; })()")
        files = []
        A.on('download', lambda d: files.append(d.suggested_filename))
        A.click('#syncJoinOn'); answer(A, yes=True)
        A.wait_for_function("LRFApp.syncInfo().join === true", timeout=60000); A.wait_for_timeout(1500)
        named = [s for s in snaps(A) if s['name'].startswith('Before joining plans from two devices') and not s['auto']]
        on = A.evaluate("({ on: document.getElementById('syncJoinOn').getAttribute('aria-pressed'), kept: JSON.parse(localStorage.getItem('lrf-next:sync')).join, how: document.getElementById('syncHow').textContent })")
        check('turned on: a named snapshot is taken and a backup file downloaded first, and the switch is kept in this browser', len(named) >= 1 and len(files) == 1 and bool(files[0]) and on['on'] == 'true' and on['kept'] is True and 'joined record by record' in on['how'], [named, files, on])
        A.screenshot(path=os.path.join(shots, 'switch-on.png'))
        A.click('#syncDone'); A.wait_for_timeout(200)
        B.evaluate("void LRFApp.sync().setJoin(true)"); settled(B, 'in-step')

        # ── 2. a sowing recorded on one device, a planting changed on the other: both kept on both ──
        where = 'both kept'
        A.evaluate("(id) => LRFApp.updatePlanting(id, { note: 'moved on the laptop' }, 'A note')", X1); settled(A, 'in-step')
        B.evaluate("(id) => LRFApp.select({ type: 'planting', id })", X2)
        OWN = "(() => { const n = LRFApp.state.plan.lrfNext || {}; return JSON.stringify([n.attic, n.from, n.importedAt, n.backup, n.mapImage || null]); })()"
        own_was = B.evaluate(OWN)
        B.evaluate("(s) => LRFApp.recordSowing(s.id, { date: s.day })", sub)
        info = settled(B, 'in-step')
        b = { 'x1': B.evaluate(P, X1), 'sub': B.evaluate(P, sub['id']), 'lot': B.evaluate(LOT, sub['lot']), 'toast': toast(B), 'sel': B.evaluate("LRFApp.state.sel"), 'undo': B.evaluate("LRFApp.state.undo.length") }
        check('the device that sowed takes the other device\'s change in: the note is here and so is the sowing', b['x1']['note'] == 'moved on the laptop' and b['sub']['sown'] == sub['day'] and b['lot'] < sub['held'], b)
        check('and says what was taken in, and from which device', 'Taken in from Work laptop' in b['toast'] and '1 planting changed' in b['toast'], b['toast'])
        check('undo and what was selected are kept through it', b['undo'] == 1 and b['sel'] and b['sel'].get('id') == X2, [b['undo'], b['sel']])
        check('what this device notes for itself about the plan it holds is still its own: where it came from, where its records are kept, its farm photo', B.evaluate(OWN) == own_was and '"cloud"' in own_was, [own_was, B.evaluate(OWN)])
        before = [s for s in snaps(B) if s['name'] == 'Before taking in changes from Work laptop' and s['auto']]
        check('the plan that was here is kept as a snapshot before anything is taken in', len(before) == 1, snaps(B)[:4])
        kept = B.evaluate("LRFSnaps.list().then(async l => { const s = l.find(x => x.join); if (!s) return null; const t = await LRFSnaps.text(s.id), plan = t ? JSON.parse(t) : null; return { read: !!plan, bytes: s.bytes, same: !!t && t.length === s.bytes, note: plan ? (plan.plantings.find(p => p.id === '%s') || {}).note || '' : null, sown: plan ? !!(plan.plantings.find(p => p.id === '%s') || {}).done : null }; })" % (X1, sub['id']))
        check('that snapshot reads back as the plan as it stood here: with this device\'s sowing, without the other device\'s change', bool(kept) and kept['read'] and kept['same'] and kept['note'] == '' and kept['sown'] is True, kept)
        look(A)
        a = { 'sub': A.evaluate(P, sub['id']), 'lot': A.evaluate(LOT, sub['lot']), 'toast': toast(A) }
        check('the other device takes the sowing in by itself, with the seed drawn once, and says so', a['sub']['sown'] == sub['day'] and a['sub']['use'] >= 1 and a['lot'] == b['lot'] and 'Taken in from Phone' in a['toast'] and '1 sowing recorded' in a['toast'], a)
        check('the two devices hold the same plan', A.evaluate("LRFApp.contentKey()") == B.evaluate("LRFApp.contentKey()"))
        B.evaluate("LRFApp.undo()"); settled(B, 'in-step')
        after = { 'sub': B.evaluate(P, sub['id']), 'x1': B.evaluate(P, X1), 'lot': B.evaluate(LOT, sub['lot']) }
        check('undo there takes the sowing back, seed and all, and leaves the other device\'s change', after['sub']['sown'] is None and after['lot'] == sub['held'] and after['x1']['note'] == 'moved on the laptop', after)
        look(A)
        check('and the take-back reaches the first device', A.evaluate(P, sub['id'])['sown'] is None and A.evaluate(LOT, sub['lot']) == sub['held'] and 'taken back' in toast(A), toast(A))

        # ── 3. not while a window is open ──
        where = 'idle'
        A.evaluate("(id) => LRFApp.updatePlanting(id, { note: 'second laptop note' }, 'A note')", X1); settled(A, 'in-step')
        B.evaluate("LRFBackupUI.openSnaps()"); B.wait_for_timeout(300)
        B.evaluate("void LRFApp.sync().run('poll')"); B.wait_for_timeout(2500)
        held = B.evaluate("({ status: LRFApp.syncInfo().status, save: document.getElementById('saveState').textContent })")
        check('with a window open on the page nothing is taken in: the indicator says changes are waiting', held['status'] == 'joining' and B.evaluate(P, X1)['note'] == 'moved on the laptop' and 'Taking in' in held['save'], held)
        B.click('#snapDone'); settled(B, 'in-step', 20000)
        check('and it is taken in once the window is closed', B.evaluate(P, X1)['note'] == 'second laptop note')

        # ── 4. the same thing changed on both: the other device's stands, and "Use mine" ──
        where = 'use mine'
        A.evaluate("(id) => LRFApp.updatePlanting(id, { note: 'the laptop says this' }, 'A note')", X3); settled(A, 'in-step')
        B.evaluate("(id) => LRFApp.updatePlanting(id, { note: 'the phone says that' }, 'A note')", X3)
        settled(B, 'in-step')
        strip = B.evaluate("({ shown: !document.getElementById('syncStrip').hidden, text: document.getElementById('syncStrip').innerText, note: LRFApp.state.plan.plantings.find(p => p.id === '%s').note, rows: LRFApp.joined().rows.length })" % X3)
        check('both changed one note: the other device\'s stands here, and a strip says something was changed on both devices', strip['note'] == 'the laptop says this' and strip['shown'] and 'Work laptop' in strip['text'] and 'changed on both devices' in strip['text'] and strip['rows'] == 1, strip)
        check('the strip fits', B.evaluate(FIT) == [], B.evaluate(FIT))
        B.screenshot(path=os.path.join(shots, 'strip.png'))
        B.click('#stripDiffered'); B.wait_for_timeout(300)
        dlg = B.evaluate("({ open: !!document.querySelector('#joinDlg[open]'), rows: [...document.querySelectorAll('[data-hook=\"join-row\"]')].map(r => r.innerText), use: document.querySelectorAll('[data-hook=\"join-use\"]').length })")
        check('"See what differed" lists it: what it is, what it is now, what this device had, with "Use mine"', dlg['open'] and len(dlg['rows']) == 1 and 'the laptop says this' in dlg['rows'][0] and 'the phone says that' in dlg['rows'][0] and dlg['use'] == 1, dlg)
        check('the window fits', B.evaluate(FIT) == [], B.evaluate(FIT))
        B.screenshot(path=os.path.join(shots, 'differed.png'))
        B.click('[data-hook="join-use"]'); B.wait_for_timeout(400)
        used = B.evaluate("({ note: LRFApp.state.plan.plantings.find(p => p.id === '%s').note, use: document.querySelectorAll('[data-hook=\"join-use\"]').length, row: document.querySelector('[data-hook=\"join-row\"]').innerText, undo: LRFApp.state.undo[LRFApp.state.undo.length - 1].label })" % X3)
        check('"Use mine" puts this device\'s value back as a change of its own, and the row says so', used['note'] == 'the phone says that' and used['use'] == 0 and 'Yours is back' in used['row'] and 'Used this device' in used['undo'], used)
        B.click('#joinDone'); B.wait_for_timeout(300)
        check('Done closes it and the strip goes', B.evaluate("!document.querySelector('#joinDlg') && document.getElementById('syncStrip').hidden && LRFApp.joined() === null"))
        settled(B, 'in-step'); look(A)
        check('and that value reaches the other device as an ordinary change', A.evaluate(P, X3)['note'] == 'the phone says that' and A.evaluate("document.getElementById('syncStrip').hidden"))

        # ── 5. undo after another device changed the same record ──
        where = 'undo'
        B.evaluate("(id) => LRFApp.updatePlanting(id, { note: 'a note to undo' }, 'A note')", X4); settled(B, 'in-step')
        look(A)
        A.evaluate("(id) => LRFApp.updatePlanting(id, { price: 7.25 }, 'A price')", X4); settled(A, 'in-step')
        look(B)
        got = B.evaluate(P, X4)
        B.evaluate("LRFApp.undo()"); B.wait_for_timeout(300)
        undone = { 'p': B.evaluate(P, X4), 'toast': toast(B), 'redo': B.evaluate("LRFApp.state.redo.length") }
        check('a step undone after another device changed the same planting takes out only what the step changed: the note goes, the price stays', got['note'] == 'a note to undo' and got['price'] == 7.25 and undone['p']['note'] == '' and undone['p']['price'] == 7.25 and undone['redo'] == 0, [got, undone])
        settled(B, 'in-step'); look(A)
        check('and the other device ends with the same planting', A.evaluate(P, X4) == undone['p'], A.evaluate(P, X4))

        # ── 5a. a run of successions (E4, 0.84): the same run made on both devices before either saw the other joins to one run ──
        where = 'a run on two devices'
        RUN = """(() => { const S = LRFSuccession, eng = LRFApp.state.engine, year = LRFApp.planYear();
          for (const c of S.candidates(eng, true)) for (const g of S.gardensFor(eng, c).filter(g => g.kind === 'bed')) {
            const r = S.planRun(eng, { cropId: c.id, by: 'beds', every: 14, datesFor: 'planting', from: year + '-06-01', to: year + '-07-13', gardenIds: [g.garden.id] });
            if (!r.error && r.sowings.length >= 2) return { run: r.run, sowings: r.sowings.map(x => ({ p: x.p })) }; } return null; })()"""
        made = A.evaluate(RUN)
        RUNS = "(id => ({ runs: LRFApp.runs().filter(r => r.id === id).length, plantings: LRFApp.state.plan.plantings.filter(p => p.run && p.run.id === id).length, all: LRFApp.state.plan.plantings.length }))"
        n_before = A.evaluate("LRFApp.state.plan.plantings.length")
        # each device also changes something of its own, so that the two plans differ and are joined record by record
        both = made and A.evaluate("r => LRFApp.addRun(r)", made) and B.evaluate("r => LRFApp.addRun(r)", made) and B.evaluate("(id) => LRFApp.updatePlanting(id, { note: 'the phone, with the run' }, 'A note')", X2)
        if made:
            try: settled(A, 'in-step'); look(B); settled(B, 'in-step'); look(A)
            except Exception as e: errors_run = str(e)[:200]   # the two never come to one plan: the line below says so, and the check goes on
        rb, ra = (B.evaluate(RUNS, made['run']['id']), A.evaluate(RUNS, made['run']['id'])) if made else ({}, {})
        check('the same run of successions added on both devices before either saw the other joins to one run, its plantings once each, on both', bool(both) and B.evaluate(P, X2)['note'] == 'the phone, with the run' and A.evaluate(P, X2)['note'] == 'the phone, with the run' and rb == ra == {'runs': 1, 'plantings': len(made['sowings']), 'all': n_before + len(made['sowings'])} and A.evaluate("LRFApp.contentKey()") == B.evaluate("LRFApp.contentKey()"), [made and made['run']['id'], ra, rb])

        # ── 5b. the plan here cannot be kept first: nothing is taken in ──
        where = 'kept first'
        B.evaluate("(() => { window.__add = LRFSnaps.add; LRFSnaps.add = () => Promise.reject(new Error('The database is full.')); })()")
        A.evaluate("(id) => LRFApp.updatePlanting(id, { note: 'laptop, while the phone cannot keep a snapshot' }, 'A note')", X1); settled(A, 'in-step')
        B.evaluate("(id) => LRFApp.updatePlanting(id, { note: 'phone, no snapshot' }, 'A note')", X2)
        B.wait_for_function("(() => { const c = LRFApp.syncInfo(); return !c.busy && (c.status === 'conflict' || (c.status === 'in-step' && LRFApp.contentKey() === JSON.parse(localStorage.getItem('lrf-next:sync') || '{}').key)); })()", timeout=40000)
        nok = B.evaluate("LRFApp.syncInfo()")
        check('when the plan here cannot be kept first, nothing is taken in: the page asks, and says why', nok['status'] == 'conflict' and 'kept first' in nok['joinNote'] and B.evaluate(P, X1)['note'] != 'laptop, while the phone cannot keep a snapshot' and 'not joined' in B.evaluate("document.getElementById('syncStrip').innerText"), [nok['status'], nok['joinNote']])
        B.evaluate("(() => { LRFSnaps.add = window.__add; })()")
        look(B)
        check('and once it can be kept, the two are joined', B.evaluate(P, X1)['note'] == 'laptop, while the phone cannot keep a snapshot' and B.evaluate(P, X2)['note'] == 'phone, no snapshot')
        look(A)

        # ── 5c. the records kept beside the plan (the ones the planner does not edit) travel with it, and are put back when a joined plan is not saved ──
        where = 'records beside the plan'
        BESIDE = "(async () => { const s = await LRFApp.snapshot('for the check ' + Date.now()); const t = await LRFSnaps.text(s.id); await LRFSnaps.remove(s.id); return Object.prototype.hasOwnProperty.call(JSON.parse(t), 'checkLog'); })()"
        # one device gains a record of that kind; the other takes it in
        A.evaluate("(async (id) => { const a = await LRFApp.snapshot('warm ' + Date.now()); await LRFSnaps.remove(a.id); LRFApp.state.attic.rest.checkLog = { picked: 3 }; LRFApp.updatePlanting(id, { note: 'with a record beside the plan' }, 'A note'); })(%s)" % json.dumps(X1)); settled(A, 'in-step')
        look(B)
        check('a record the planner does not edit, gained on one device, is taken in on the other with the plan', B.evaluate(P, X1)['note'] == 'with a record beside the plan' and B.evaluate(BESIDE) is True)
        B.reload(); ready(B); settled(B, 'in-step')
        check('and is still there after the page is opened again: it was kept in the browser, not only held', B.evaluate(BESIDE) is True)
        # the first device loses it again; on the other the joined plan cannot be saved: the record must still be there
        A.evaluate("(id) => { delete LRFApp.state.attic.rest.checkLog; LRFApp.updatePlanting(id, { note: 'and without it again' }, 'A note'); }", X1); settled(A, 'in-step')
        B.evaluate("(() => { sessionStorage.setItem('check-full', '1'); })()")
        B.wait_for_timeout(1700); B.evaluate("void LRFApp.sync().run('poll')")
        B.wait_for_function("(() => { const c = LRFApp.syncInfo(); return !c.busy && (c.status === 'error' || c.status === 'in-step'); })()", timeout=40000)
        full = B.evaluate("LRFApp.syncInfo()")
        note_then = B.evaluate(P, X1)['note']
        B.reload(); ready(B); B.wait_for_timeout(3000)   # opened again, its storage still full: what is kept in the browser is read afresh
        kept_beside = B.evaluate(BESIDE); note_again = B.evaluate(P, X1)['note']
        check('a joined plan that cannot be saved here is not taken in, and the records kept beside the plan are as they were: nothing of them is lost with it', full['status'] == 'error' and note_then == 'with a record beside the plan' and note_again == 'with a record beside the plan' and kept_beside is True, [full['status'], full['error'], note_then, note_again, kept_beside])
        B.evaluate("(() => { sessionStorage.removeItem('check-full'); })()")
        B.reload(); ready(B)
        look(B)
        check('once it can be saved the plan is taken in, and the record the other device took out is gone here too', B.evaluate(P, X1)['note'] == 'and without it again' and B.evaluate(BESIDE) is False)
        look(A)

        # ── 5d. a join interrupted after the records beside the plan were written: every way out leaves the plan and those records as they were ──
        where = 'interrupted'
        A.evaluate("(async (id) => { LRFApp.state.attic.rest.checkLog = { picked: 4 }; LRFApp.updatePlanting(id, { note: 'beside it once more' }, 'A note'); })(%s)" % json.dumps(X1)); settled(A, 'in-step')
        look(B)
        B.evaluate("(() => { sessionStorage.setItem('check-noread', '1'); })()")
        B.reload(); ready(B); settled(B, 'in-step')
        A.evaluate("(id) => { delete LRFApp.state.attic.rest.checkLog; LRFApp.updatePlanting(id, { note: 'taken out, and interrupted' }, 'A note'); }", X1); settled(A, 'in-step')
        B.evaluate("(id) => LRFApp.updatePlanting(id, { note: 'phone, unread' }, 'A note')", X2)
        B.wait_for_function("(() => { const c = LRFApp.syncInfo(); return !c.busy && (c.status === 'conflict' || c.status === 'error' || (c.status === 'in-step' && LRFApp.contentKey() === JSON.parse(localStorage.getItem('lrf-next:sync') || '{}').key)); })()", timeout=40000)
        unread = B.evaluate("LRFApp.syncInfo()")
        check('when the records kept beside the plan cannot be read, nothing is joined: the page asks, and says why', unread['status'] == 'conflict' and 'could not be read' in unread['joinNote'] and B.evaluate(P, X1)['note'] == 'beside it once more' and B.evaluate(P, X2)['note'] == 'phone, unread', [unread['status'], unread['joinNote'], unread['error']])
        def interrupted(at, edit=None):
            """The join is made again with one interruption armed; the page is then held busy and opened again: what the browser kept is read afresh."""
            B.evaluate("([at, id, note]) => { const S = sessionStorage; S.removeItem('check-noread'); S.removeItem('check-hit'); S.removeItem('check-busy'); S.setItem('check-at', at); if (id) { S.setItem('check-edit', id); S.setItem('check-edit-note', note); } }", [at, X2 if edit else None, edit])
            B.reload(); ready(B)
            B.wait_for_function("sessionStorage.getItem('check-hit') !== null", timeout=40000)
            hit = B.evaluate("sessionStorage.getItem('check-hit')")
            B.wait_for_timeout(2500)   # the plan open here is written back, and the records put back
            B.reload(); ready(B); B.wait_for_timeout(2500)   # still busy: nothing is joined, and what is seen is what was kept
            return [hit, B.evaluate(P, X1)['note'], B.evaluate(P, X2)['note'], B.evaluate(BESIDE), B.evaluate("LRFApp.syncInfo().status")]
        got = interrupted('save')
        check('the page turned busy just as the joined plan was saved: nothing is taken in, the plan here is the one kept, and the records beside it are as they were', got[:4] == ['save', 'beside it once more', 'phone, unread', True] and got[4] != 'in-step', got)
        got = interrupted('save', 'phone, during the save')
        check('the plan changed here as the joined plan was saved: the change is kept, nothing is taken in yet, and the records beside the plan are as they were', got[:4] == ['save', 'beside it once more', 'phone, during the save', True] and got[4] != 'in-step', got)
        got = interrupted('attic', 'phone, as the records were written')
        check('the plan changed here as the records beside it were written: the change is kept, and those records are put back as they were', got[:4] == ['attic', 'beside it once more', 'phone, as the records were written', True] and got[4] != 'in-step', got)
        B.evaluate("(() => { for (const k of ['check-busy', 'check-hit', 'check-at', 'check-edit', 'check-edit-note']) sessionStorage.removeItem(k); })()")
        B.reload(); ready(B)
        look(B)
        check('left alone at last, the two are joined: both changes, and the record the other device took out is gone here too', B.evaluate(P, X1)['note'] == 'taken out, and interrupted' and B.evaluate(P, X2)['note'] == 'phone, as the records were written' and B.evaluate(BESIDE) is False, [B.evaluate(P, X1), B.evaluate(P, X2)])
        look(A)
        check('and the other device takes in the change made during the interruptions', A.evaluate(P, X2)['note'] == 'phone, as the records were written' and A.evaluate(P, X1)['note'] == 'taken out, and interrupted')

        # ── 5e. a supplier's page record changed on both devices: the joined record is the one read, and one kept just after stays ──
        where = 'page record'
        VID = A.evaluate("LRFApp.state.plan.varieties[0].id")
        REC = "(id) => LRFApp.varietyRecord(id).then(r => r && r.catalogSourceText)"
        A.evaluate("(async ([v, id]) => { await LRFApp.keepVarietyRecord(v, { catalogSourceText: 'first' }); LRFApp.updatePlanting(id, { note: 'a page record, first' }, 'A note'); })(%s)" % json.dumps([VID, X1])); settled(A, 'in-step')
        look(B)
        first = B.evaluate(REC, VID)
        A.evaluate("(async ([v, id]) => { await LRFApp.keepVarietyRecord(v, { catalogSourceText: 'the laptop' }); LRFApp.updatePlanting(id, { note: 'a page record, the laptop' }, 'A note'); })(%s)" % json.dumps([VID, X1])); settled(A, 'in-step')
        B.evaluate("(async ([v, id]) => { await LRFApp.keepVarietyRecord(v, { catalogSourceText: 'the phone' }); LRFApp.updatePlanting(id, { note: 'a page record, the phone' }, 'A note'); })(%s)" % json.dumps([VID, X2]))
        settled(B, 'in-step')
        B.reload(); ready(B); settled(B, 'in-step')
        check('a page record both devices changed is the cloud\'s after the join, and still is when the page is opened again: what it had kept before the join is not read over it', first == 'first' and B.evaluate(P, X1)['note'] == 'a page record, the laptop' and B.evaluate(REC, VID) == 'the laptop', [first, B.evaluate(REC, VID)])
        B.evaluate("(async ([v, id]) => { await LRFApp.keepVarietyRecord(v, { catalogSourceText: 'the phone, after' }); })(%s)" % json.dumps([VID, X2]))
        B.reload(); ready(B); settled(B, 'in-step')
        check('a page record kept here just after the join is still the one read when the page is opened again', B.evaluate(REC, VID) == 'the phone, after', B.evaluate(REC, VID))
        B.evaluate("(async ([v, id]) => { await LRFApp.keepVarietyRecord(v, { catalogSourceText: 'the laptop' }); })(%s)" % json.dumps([VID, X2]))
        look(A)
        check('and the other device reads the same record', A.evaluate(REC, VID) == 'the laptop' and A.evaluate(P, X2)['note'] == 'a page record, the phone', A.evaluate(REC, VID))

        # ── 5f. one live-tray demand plan widened alike on both devices: one batch a week; undo takes the week back with its batches ──
        where = 'tray batches'
        DEMAND = "() => { const t = (LRFApp.state.plan.liveTrayPlans || [])[0]; return t ? { through: t.through } : null; }"
        WEEK = "(w) => LRFApp.state.plan.plantings.filter(p => p.liveTray && p.liveTray.week === w).map(p => ({ id: p.id, note: p.note || '', sown: !!(p.done || {}).sow })).sort((a, b) => a.id < b.id ? -1 : 1)"
        t0 = A.evaluate(DEMAND)
        later = A.evaluate("(d) => LRFTrays.add(d, 7)", t0['through']) if t0 else None
        wk = A.evaluate("(d) => LRFTrays.add(LRFTrays.monday(d), 7)", t0['through']) if t0 else None
        for D in (A, B): D.evaluate("LRFSync.timing.push = 600000")
        # each device sets the plan's last week a week later through the page's own save, before it has seen the other's; the second notes one of its new batches
        WIDEN = "(d) => LRFApp.saveTrays('Last week', { ...LRFApp.state.plan.liveTrayPlans[0], through: d })"
        if t0:
            A.evaluate(WIDEN, later); A.wait_for_timeout(600); B.evaluate(WIDEN, later); B.wait_for_timeout(600)
        mine_b = B.evaluate(WEEK, wk) if t0 else []
        if len(mine_b) > 1:
            B.evaluate("(id) => LRFApp.updatePlanting(id, { note: 'checked on the bench' }, 'A note')", mine_b[0]['id'])
            B.evaluate("(id) => LRFApp.updatePlanting(id, { note: 'picked early' }, 'A note')", mine_b[1]['id'])
        A.evaluate("void LRFApp.sync().run('change')"); settled(A, 'in-step')
        B.wait_for_timeout(1700); B.evaluate("void LRFApp.sync().run('change')"); settled(B, 'in-step', 60000)
        look(A)
        wa, wb = A.evaluate(WEEK, wk), B.evaluate(WEEK, wk)
        check('one live-tray demand plan widened alike on both devices before either saw the other: joined, each holds one batch for each crop of the new week, under the ids both made, the note the second wrote on one kept',
              bool(t0) and len(mine_b) > 1 and wa == wb and [x['id'] for x in wa] == [x['id'] for x in mine_b] and sum(1 for x in wa if x['note'] == 'checked on the bench') == 1 and A.evaluate("LRFApp.contentKey()") == B.evaluate("LRFApp.contentKey()"), [t0, mine_b, wa, wb])
        # a harvest of the second, among the records kept beside the plan on the first device (as a backup brings them): work recorded there
        if len(mine_b) > 1:
            A.evaluate("(id) => { const a = LRFApp.state.attic || { v: 1, rest: {}, varieties: {} }; LRFApp.state.attic = { ...a, rest: { ...(a.rest || {}), harvests: { ...((a.rest || {}).harvests || {}), [id]: { '2027-12-06': 1 } } } }; }", mine_b[1]['id'])
        A.evaluate("LRFApp.undo()"); A.wait_for_timeout(800)
        undone = {'through': (A.evaluate(DEMAND) or {}).get('through'), 'week': A.evaluate(WEEK, wk), 'toast': toast(A)}
        A.evaluate("LRFSync.timing.push = 250; void LRFApp.sync().run('change')"); settled(A, 'in-step')
        B.evaluate("LRFSync.timing.push = 250"); look(B)
        left = [x['id'] for x in undone['week']]
        check('undo of that widening on the first device, after the join: the week goes from the demand plan and its batches with it, the other device\'s note too; the one with a harvest kept beside the plan stays, and the other device takes that in',
              bool(t0) and len(mine_b) > 1 and undone['through'] == t0['through'] and left == [mine_b[1]['id']] and (B.evaluate(DEMAND) or {}).get('through') == t0['through'] and [x['id'] for x in B.evaluate(WEEK, wk)] == left and A.evaluate("LRFApp.contentKey()") == B.evaluate("LRFApp.contentKey()"), undone)
        # the Delete key on a batch that follows a demand plan: it stays, and the page says where the demand is changed
        tied = A.evaluate("() => (LRFApp.state.plan.plantings.find(p => p.liveTray && (LRFApp.state.plan.liveTrayPlans || []).some(t => t.id === p.liveTray.planId)) || {}).id")
        steps = A.evaluate("LRFApp.state.undo.length")
        A.evaluate("(id) => LRFApp.select({ type: 'planting', id })", tied); A.wait_for_timeout(300)
        A.evaluate("document.activeElement && document.activeElement.blur && document.activeElement.blur()"); A.keyboard.press('Delete'); A.wait_for_timeout(400)
        kept = {'there': A.evaluate("(id) => LRFApp.state.plan.plantings.some(p => p.id === id)", tied), 'toast': toast(A), 'steps': A.evaluate("LRFApp.state.undo.length")}
        check('the Delete key on a batch that follows a weekly demand plan removes nothing: the batch stays, no step is added, and the page says the demand is changed on Live trays',
              bool(tied) and kept['there'] and kept['steps'] == steps and 'weekly demand' in kept['toast'] and 'Live trays' in kept['toast'], kept)

        # the other device widens further than this one's own widening; this one then takes its own back: the plan stays as the other
        # left it, and every week it lists keeps its batches
        if t0:
            A.evaluate(WIDEN, later); settled(A, 'in-step'); look(B)
            further = B.evaluate("(d) => LRFTrays.add(d, 7)", later); wk2 = B.evaluate("(d) => LRFTrays.add(LRFTrays.monday(d), 7)", later)
            B.evaluate(WIDEN, further); settled(B, 'in-step'); look(A)
            had = A.evaluate(WEEK, wk)
            A.evaluate("LRFApp.undo()"); A.wait_for_timeout(800)
            after_undo = {'through': (A.evaluate(DEMAND) or {}).get('through'), 'week': A.evaluate(WEEK, wk), 'week2': len(A.evaluate(WEEK, wk2)), 'toast': toast(A)}
        check('the other device widened the demand plan a week further; undo of this device\'s own widening leaves the plan as the other device left it, and the week this device added keeps every batch, since the plan still lists it',
              bool(t0) and len(had) > 1 and after_undo['through'] == further and after_undo['week'] == had and after_undo['week2'] > 0, [had, after_undo] if t0 else None)

        # ── 6. turned off: the question it always was ──
        where = 'off'
        B.evaluate("void LRFApp.sync().setJoin(false)"); B.wait_for_timeout(300)
        A.evaluate("(id) => LRFApp.updatePlanting(id, { note: 'laptop, with the phone off' }, 'A note')", X1)
        # the same run of successions planned on each device on its own (two runs, two ids), the phone set to "Ask me" (E4): the
        # laptop's goes to the cloud; the phone asks, sends nothing, and keeps its own run whole; turned on, both runs stand whole
        ra, rb = A.evaluate(RUN), B.evaluate(RUN)
        added = bool(ra and rb) and A.evaluate("r => LRFApp.addRun(r)", ra) and B.evaluate("r => LRFApp.addRun(r)", rb)
        settled(A, 'in-step')
        B.evaluate("(id) => LRFApp.updatePlanting(id, { note: 'phone, off' }, 'A note')", X2)
        off = settled(B, 'conflict')
        if ra and rb:
            asked = { 'B': [B.evaluate(RUNS, ra['run']['id']), B.evaluate(RUNS, rb['run']['id'])], 'A': A.evaluate(RUNS, ra['run']['id']) }
            check('a run planned on each device, the phone set to "Ask me": the laptop\'s run goes to the cloud; the phone asks, sends nothing, and keeps its own run whole, with none of the other\'s', bool(added) and ra['run']['id'] != rb['run']['id'] and off['status'] == 'conflict' and asked['A']['runs'] == 1 and asked['A']['plantings'] == len(ra['sowings']) and asked['B'][0]['runs'] == 0 and asked['B'][0]['plantings'] == 0 and asked['B'][1]['runs'] == 1 and asked['B'][1]['plantings'] == len(rb['sowings']), asked)
        else: check('a run planned on each device, the phone set to "Ask me": the laptop\'s run goes to the cloud; the phone asks, sends nothing, and keeps its own run whole, with none of the other\'s', False, 'no run to plan')
        text = B.evaluate("document.getElementById('syncStrip').innerText")
        check('on a device set back to "Ask me", both changed is the question it always was, and nothing is sent', off['status'] == 'conflict' and 'different plans' in text and B.evaluate(P, X1)['note'] != 'laptop, with the phone off', [off['status'], text])
        B.evaluate("LRFBackupUI.openSync()"); B.wait_for_timeout(300)
        hint = B.evaluate("({ note: document.getElementById('syncNote2').innerText, fit: %s })" % FIT)
        check('the Cloud sync window says so without claiming plans are never joined, and fits', 'Both have changed' in hint['note'] and 'never merged' not in hint['note'] and hint['fit'] == [], hint)
        B.screenshot(path=os.path.join(shots, 'off-conflict.png'))
        B.evaluate("document.getElementById('syncJoinOn').click()"); answer(B, yes=True)
        B.wait_for_function("LRFApp.syncInfo().join === true", timeout=60000)
        B.evaluate("document.getElementById('syncDone') && document.getElementById('syncDone').click()")
        settled(B, 'in-step', 60000)
        check('turned on from there, the two plans are joined at once', B.evaluate(P, X1)['note'] == 'laptop, with the phone off' and B.evaluate(P, X2)['note'] == 'phone, off')
        joined_runs = [B.evaluate(RUNS, ra['run']['id']), B.evaluate(RUNS, rb['run']['id'])] if ra and rb else None
        check('and both runs stand whole, each with its own plantings once: none lost, none half of each', bool(joined_runs) and joined_runs[0]['runs'] == 1 and joined_runs[0]['plantings'] == len(ra['sowings']) and joined_runs[1]['runs'] == 1 and joined_runs[1]['plantings'] == len(rb['sowings']), joined_runs)
        check('no error on either page', A.errors == [] and B.errors == [], [A.errors[:3], B.errors[:3]])
    except Exception as e:
        check('the check ran to its end', False, [repr(e)[:300], where])
    finally:
        try:
            browser.close()
        except Exception:
            pass
        service.terminate()

print('\n'.join(results))
print(json.dumps({'passed': len(results) - len(failed), 'of': len(results), 'failed': failed}))
