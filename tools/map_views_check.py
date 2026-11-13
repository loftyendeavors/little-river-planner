"""After the layout of the farm has been changed, every other view of the planner still holds.

usage: python3 -I map_views_check.py <app-dir-or-built-site-dir> <shots-dir> [backup.zip]     env: WIDTHS=1280,1707,3440
Every subject is found on the page: no name from any plan is in here. It makes four changes in Edit layout through the editor's own
functions (the mouse is tools/map_check.py's business): an empty bed made shorter, a bed added to the end of a row, a whole garden
copied (a new garden), an empty bed removed. Then it looks at each view:
  - Map, the plan's own: the new ground is drawn and can be picked; Whole season draws; the bed's panel shows the new size;
  - Timeline: a row for each new bed, none for the removed one;
  - Tasks, Nursery, Harvest, Seeds: word for word what they showed before, because no planting was touched;
  - Assumptions: "Where things grow" lists the new garden;
  - and what the engine works out for every planting is number for number what it was.
It ends by undoing the four changes, which must give back every bed, garden and planting as it was. (The order of the plan's own
list of beds is not compared: a record that Undo puts back is added at the end of its list, in app.js withOps, for every kind of record.
Nothing on the page shows it. It is known, and is to be put right when that function is next changed.) In a short window (720 high)
the layout's panel scrolls and Done stays in reach. Screenshots of the plan's map and of Edit layout are left in <shots-dir> at each width.
"""
import functools, http.server, json, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright

target, shots = sys.argv[1], sys.argv[2]
BACKUP = sys.argv[3] if len(sys.argv) > 3 else None
os.makedirs(shots, exist_ok=True)
results, failed = [], []


def check(name, ok, detail=None):
    results.append(('ok   ' if ok else 'FAIL ') + name + ('' if ok or detail is None else ' ' + json.dumps(detail, default=str)[:900]))
    if not ok:
        failed.append(name)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=target))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = 'http://127.0.0.1:%d/index.html' % server.server_address[1]

HELPERS = """(() => {
  const M = LRFMap, A = LRFApp, eng = () => A.state.engine, plan = () => A.state.plan;
  const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return s.length + ':' + h; };
  window.V = {
    /** everything the engine works out for every planting that is a number or a day, as one string */
    digest() { const e = eng(); return hash(plan().plantings.map(p => { const r = e.calc(p); return p.id + '@' + p.bedId + '=' + (r ? Object.keys(r).sort().map(k => { const v = r[k]; return typeof v === 'number' ? k + Math.round(v * 1000) : v instanceof Date ? k + +v : ''; }).join(',') + ',y' + Math.round(e.yieldOf(p, r) * 1000) : 'none'); }).join('|')); },
    /** what a view says, word for word, as a short mark */
    words(sel) { const el = document.querySelector(sel); return el ? hash(el.innerText.replace(/\\s+/g, ' ').trim()) : null; },
    soil() { return plan().beds.filter(b => b.active !== false && eng().isSoilBed(b) && M.shapeOf(b.id)); },
    /** an empty soil bed on the photo, at least `least` ft long, not among `skip` */
    empty(least, skip = []) { const b = V.soil().find(x => !skip.includes(x.id) && eng().plantingsIn(x.id).length === 0 && +x.l >= least); return b ? { id: b.id, w: +b.w, l: +b.l, gardenId: b.gardenId } : null; },
    /** a garden of soil beds, small enough to copy quickly: the one with the fewest beds, at least two */
    garden() { const by = new Map(); for (const b of V.soil()) by.set(b.gardenId, (by.get(b.gardenId) || 0) + 1); const all = plan().beds.filter(b => b.active !== false); const whole = [...by].filter(([g, n]) => n >= 2 && all.filter(b => b.gardenId === g).length === n).sort((p, q) => p[1] - q[1])[0]; return whole ? { id: whole[0], beds: whole[1] } : null; },
    beds() { return plan().beds.filter(b => b.active !== false).map(b => b.id); },
    /** every bed, garden and planting record, whatever order its list is in */
    records() { const each = list => (list || []).map(x => JSON.stringify(x)).sort().join('~~'); return hash(each(plan().beds) + '#' + each(plan().gardens) + '#' + each(plan().plantings) + '#' + JSON.stringify(plan().map || null)); },
    gardens() { return plan().gardens.map(g => g.id); },
    toast() { const t = document.getElementById('toast'); return t && t.classList.contains('show') ? t.textContent : ''; }
  };
  return true;
})()"""

VIEWS = (('sow', '#swWrap', 'Tasks'), ('trays', '#trWrap', 'Nursery'), ('harvest', '#hvWrap', 'Harvest'), ('seeds', '#sdBody', 'Seeds'))


def run(page, width):
    js = page.evaluate
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)[:300]))
    tag = '%d wide: ' % width
    page.goto(url)
    page.wait_for_function('window.LRFApp && LRFApp.state.ready && window.LRFMapEdit', timeout=30000)
    if BACKUP:
        page.set_input_files('#importFile', BACKUP)
        page.wait_for_function("!LRFApp.isSample() && /Saved/.test(document.getElementById('saveState').textContent)", timeout=120000)
    page.wait_for_timeout(900)
    js(HELPERS)
    js("LRFApp.setView('map')"); page.wait_for_timeout(400)

    def look():
        """what each of the four views says, and the engine's figures"""
        seen = {}
        for view, sel, _ in VIEWS:
            js("LRFApp.setView('%s')" % view); page.wait_for_timeout(700)
            seen[view] = js("V.words(%s)" % json.dumps(sel))
        js("LRFApp.setView('map')"); page.wait_for_timeout(300)
        seen['digest'] = js('V.digest()')
        return seen

    records0, steps0 = js('V.records()'), js('LRFApp.state.undo.length')
    before = look()
    check(tag + 'each view to be compared was found and says something', all(before[v] and not before[v].startswith('0:') for v, _, _ in VIEWS), before)
    beds0, gardens0 = js('V.beds()'), js('V.gardens()')
    page.screenshot(path=os.path.join(shots, 'plan-map-%d.png' % width))

    # ── four changes to the layout, each one step ──
    a = js('V.empty(6)')
    check(tag + 'there is an empty bed on the photo, at least 6 ft long, to make shorter', a is not None, a)
    made = {'short': False, 'added': None, 'garden': None, 'removed': None}
    if a:
        js("LRFMapEdit.open({ bedId: '%s' })" % a['id']); page.wait_for_timeout(500)
        js("LRFMapEdit.resize('l', %s)" % (a['l'] - 2)); page.wait_for_timeout(250)
        made['short'] = js("LRFApp.state.engine.bedOf('%s').l" % a['id']) == a['l'] - 2
    check(tag + 'in Edit layout the bed is made 2 ft shorter, in one step', made['short'] and js('LRFApp.state.undo.length') == steps0 + 1, [made, js('V.toast()')])

    # a bed added to the end of a row: tried on each garden until one has room
    for gid in js("[...new Set(V.soil().map(b => b.gardenId))]"):
        last = js("(g => { const own = V.soil().filter(b => b.gardenId === g); return own.length >= 2 ? own[own.length - 1].id : null; })('%s')" % gid)
        if not last:
            continue
        js("LRFMapEdit.open({}); LRFMapEdit.pick(['%s']); LRFMapEdit.addNext()" % last); page.wait_for_timeout(250)
        new = [b for b in js('V.beds()') if b not in beds0]
        if new:
            made['added'] = new[0]
            break
    check(tag + 'a bed is added past the end of a row', made['added'] is not None, js('V.toast()'))

    g = js('V.garden()')
    if g:
        js("LRFMapEdit.open({}); LRFMapEdit.pickGarden('%s'); LRFMapEdit.duplicate()" % g['id']); page.wait_for_timeout(400)
        newg = [x for x in js('V.gardens()') if x not in gardens0]
        made['garden'] = newg[0] if newg else None
    copied = [b for b in js('V.beds()') if b not in beds0 and b != made['added']]
    check(tag + 'a whole garden copied is a new garden with as many beds, and no planting', made['garden'] is not None and g is not None and len(copied) == g['beds'] and js("V.soil().filter(b => b.gardenId === '%s').every(b => LRFApp.state.engine.plantingsIn(b.id).length === 0)" % made['garden']), {'garden': g, 'made': made, 'copied': len(copied), 'toast': js('V.toast()')})

    r = js("V.empty(1, %s)" % json.dumps([a['id']] if a else []))
    if r and r['id'] in beds0:
        js("LRFMapEdit.open({}); LRFMapEdit.pick(['%s']); void LRFMapEdit.remove()" % r['id']); page.wait_for_timeout(350)
        made['removed'] = r['id'] if r['id'] not in js('V.beds()') else None
    check(tag + 'an empty bed is removed', made['removed'] is not None, {'bed': r, 'toast': js('V.toast()')})
    new_beds = [b for b in js('V.beds()') if b not in beds0]
    page.screenshot(path=os.path.join(shots, 'edit-layout-%d.png' % width))
    panel = js("(() => { const p = document.getElementById('layoutPanel'), d = document.getElementById('leDone'); const r = d ? d.getBoundingClientRect() : null; return { panel: !!p && p.getClientRects().length > 0, done: !!r && r.width > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth }; })()")
    check(tag + 'the layout’s own panel is up and Done is in reach', panel['panel'] and panel['done'], panel)
    js('LRFMapEdit.close()'); page.wait_for_timeout(300)

    # ── the plan's own map ──
    drawn = js("%s.map(id => !!LRFMap.shapeOf(id) && !!LRFMap.element(id))" % json.dumps(new_beds))
    check(tag + 'Map: every new bed is drawn on the plan’s own map', len(new_beds) >= 2 and all(drawn), {'new': len(new_beds), 'drawn': drawn})
    if made['added']:
        js("LRFApp.select({ type: 'bed', id: '%s' })" % made['added']); page.wait_for_timeout(250)
    picked = js("({ sel: LRFApp.state.sel, figures: ['bedWidth', 'bedLength', 'bedArea'].filter(id => document.getElementById(id)).length, fields: document.querySelectorAll('#inspectorBody input, #inspectorBody select').length })")
    check(tag + 'Map: a new bed can be picked, and its panel shows its size with nothing to type in', picked['sel'] is not None and picked['sel'].get('id') == made['added'] and picked['figures'] == 3 and picked['fields'] == 0, picked)
    if a:
        js("LRFApp.select({ type: 'bed', id: '%s' })" % a['id']); page.wait_for_timeout(250)
        shown = js("(document.querySelector('#bedLength b') || {}).textContent")
        check(tag + 'Map: the shortened bed’s panel shows its new length', shown == ('%g' % (a['l'] - 2)), [shown, a])
    js('LRFApp.select(null)')
    page.click('#mapSeasonToggle'); page.wait_for_timeout(500)
    season = js("({ on: document.getElementById('mapSeasonToggle').getAttribute('aria-pressed') === 'true', beds: document.querySelectorAll('#mapBeds > g').length })")
    page.click('#mapSeasonToggle'); page.wait_for_timeout(300)
    check(tag + 'Map: Whole season draws with the new ground in it', season['on'] and season['beds'] >= len(beds0) - 1 + len(new_beds) - 1, season)

    # ── the timeline ──
    js("LRFApp.setView('timeline')"); page.wait_for_timeout(700)
    rows = js("(ids => ids.map(id => !!document.querySelector('.tl-row[data-bed=\"' + id + '\"]')))(%s)" % json.dumps(new_beds))
    gone = js("!document.querySelector('.tl-row[data-bed=\"%s\"]')" % (made['removed'] or 'none'))
    check(tag + 'Timeline: a row for each new bed, and none for the bed that was removed', len(rows) >= 2 and all(rows) and gone and made['removed'] is not None, {'rows': rows, 'gone': gone})

    # ── the views that list what the plan gives: word for word as before ──
    after = look()
    for view, _, name in VIEWS:
        check(tag + '%s: says word for word what it said before the layout was changed' % name, after[view] == before[view], [before[view], after[view]])
    check(tag + 'what the engine works out for every planting is number for number what it was', after['digest'] == before['digest'], [before['digest'], after['digest']])

    # ── Assumptions: where things grow ──
    js("LRFApp.setView('assume')"); page.wait_for_timeout(600)
    places = js("(g => { const garden = LRFApp.state.plan.gardens.find(x => x.id === g), body = document.getElementById('asPlacesBody'); return { name: garden ? garden.name : null, listed: !!garden && !!body && body.textContent.includes(garden.name), rows: body ? body.querySelectorAll('tr').length : 0 }; })(%s)" % json.dumps(made['garden']))
    check(tag + 'Assumptions: “Where things grow” lists the new garden', places['listed'], {'listed': places['listed'], 'gardens': len(gardens0)})

    # ── and back: undoing the changes gives the plan that was opened ──
    js("LRFApp.setView('map')"); page.wait_for_timeout(200)
    n = js('LRFApp.state.undo.length') - steps0
    for _ in range(max(0, n)):
        js('LRFApp.undo()')
    page.wait_for_timeout(400)
    check(tag + 'four changes were four steps, and undoing them gives back every bed, garden and planting as it was', n == 4 and js('V.records()') == records0 and js('V.digest()') == before['digest'] and sorted(js('V.beds()')) == sorted(beds0) and sorted(js('V.gardens()')) == sorted(gardens0), {'steps': n, 'records': js('V.records()') == records0, 'digest': js('V.digest()') == before['digest']})
    check(tag + 'no error on the page', not errors, errors[:3])


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for width in [int(w) for w in (os.environ.get('WIDTHS') or '1480').split(',')]:
        ctx = browser.new_context(viewport={'width': width, 'height': 900}, service_workers='block')
        page = ctx.new_page()
        if BACKUP:
            page.route('**/*', lambda r: r.continue_() if r.request.url.startswith('http://127.0.0.1') else r.abort())
        try:
            run(page, width)
        except Exception as e:   # a check that cannot go on fails by name, with where it stopped
            check('%d wide: the check ran to its end' % width, False, repr(e)[:600])
        ctx.close()
    # a short window: the layout's panel is longer than the window, so it scrolls, and Done stays in reach
    ctx = browser.new_context(viewport={'width': 1480, 'height': 720}, service_workers='block')
    page = ctx.new_page()
    if BACKUP:
        page.route('**/*', lambda r: r.continue_() if r.request.url.startswith('http://127.0.0.1') else r.abort())
    try:
        page.goto(url)
        page.wait_for_function('window.LRFApp && LRFApp.state.ready && window.LRFMapEdit', timeout=30000)
        if BACKUP:
            page.set_input_files('#importFile', BACKUP)
            page.wait_for_function("!LRFApp.isSample() && /Saved/.test(document.getElementById('saveState').textContent)", timeout=120000)
        page.wait_for_timeout(900)
        page.evaluate(HELPERS)
        page.evaluate("LRFApp.setView('map')"); page.wait_for_timeout(300)
        g = page.evaluate('V.garden()')
        page.evaluate("LRFMapEdit.open({}); LRFMapEdit.pickGarden(%s)" % json.dumps(g['id'] if g else '')); page.wait_for_timeout(500)
        short = page.evaluate("(() => { const p = document.getElementById('layoutPanel'), d = document.getElementById('leDone'), r = d ? d.getBoundingClientRect() : null; let s = p; while (s && !(s.scrollHeight > s.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement; const top = s ? s.scrollTop : 0; if (s) s.scrollTop = 1e6; const moved = s ? s.scrollTop > top : false; const lastBtn = [...p.querySelectorAll('button')].pop(), lr = lastBtn ? lastBtn.getBoundingClientRect() : null; return { picked: LRFMapEdit.picked().length, scrolls: !!s, moved, lastInView: !!lr && lr.bottom <= innerHeight + 1 && lr.top >= 0, done: !!r && r.width > 0 && r.top >= 0 && r.bottom <= innerHeight, page: document.documentElement.scrollHeight <= innerHeight + 1 }; })()")
        check('720 high: with a whole garden picked the layout’s panel scrolls to its last button, Done stays in reach, and the page itself does not scroll', short['picked'] >= 2 and (short['lastInView']) and short['done'] and short['page'], short)
        page.screenshot(path=os.path.join(shots, 'edit-layout-720-high.png'))
        page.click('#leDone'); page.wait_for_timeout(200)
        check('720 high: Done leaves the layout', not page.evaluate('LRFMapEdit.on()'))
    except Exception as e:
        check('720 high: the check ran to its end', False, repr(e)[:600])
    ctx.close()
    browser.close()

print('\n'.join(results))
print(json.dumps({'passed': len(results) - len(failed), 'of': len(results), 'failed': failed}))
sys.stdout.flush()
os._exit(0)
