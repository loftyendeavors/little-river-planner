"""The map build in a real browser: the everyday map (eased view, crates that keep their place) and editing the layout
(pick, move, snap, guard rails, stretch, turn, nudge, copy, add, remove, new garden, tidy, containers, measure, scale).

usage: python3 -I map_check.py <app-dir-or-built-site-dir> <shots-dir> [backup.zip]
Every subject is found on the page (a row of like beds, a group of containers, open ground): no name from any plan is in here.
The rules under test:
  - opening and leaving the layout mode changes nothing; moving, turning and copying ground changes no planting's dates or yield;
  - a crop keeps the same containers on every day it stands, and no container holds two crops;
  - what is dragged lines up with its neighbours and keeps their path; a change that would lay one space on another does not happen;
  - a bed with plantings cannot be removed, nor made shorter than what is planted in it;
  - every change is one Undo; arrow keys move ground and leave the planning date alone;
  - the wheel zooms at once, about the pointer; a bed's panel shows its size and never changes it;
  - nothing is clipped or wrapped in the panel at 1280, 1480 or 3440 wide.
"""
import functools, http.server, json, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright

target, shots = sys.argv[1], sys.argv[2]
BACKUP = sys.argv[3] if len(sys.argv) > 3 else None
ONLY = os.environ.get('ONLY', '')
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
  const G = LRFMapGeo, M = LRFMap, A = LRFApp;
  const eng = () => A.state.engine, plan = () => A.state.plan;
  const drawn = () => M.spaces().map(id => M.shapeOf(id));
  window.T = {
    client(x, y) { const r = document.getElementById('map').getBoundingClientRect(), p = M.toScreen(x, y); return { x: r.left + p[0], y: r.top + p[1] }; },
    at(id, lu = 0, lv = 0) { const s = M.shapeOf(id), [dx, dy] = G.outOf(s.rot, lu * s.W / 2, lv * s.L / 2); return T.client(s.x + dx, s.y + dy); },
    px(id) { const b = eng().bedOf(id); return b && b.px ? { x: b.px.x, y: b.px.y, rot: b.px.rot } : null; },
    /** every planting's dates and yield, as one string: the plan as the engine reads it */
    digest() { const e = eng(); return plan().plantings.map(p => { const r = e.calc(p); return r ? [p.id, p.bedId, +r.field, +r.first, +r.last, Math.round(e.yieldOf(p, r) * 1000), Math.round((r.len || 0) * 100)].join(':') : p.id + ':none'; }).join('|'); },
    /** a row of like beds: at least `least` soil beds of one garden, one size, one turn, in a line */
    row(least = 4, skip = []) {
      for (const g of plan().gardens) {
        if (skip.includes(g.id)) continue;
        const own = plan().beds.filter(b => b.gardenId === g.id && b.active !== false && eng().isSoilBed(b) && M.shapeOf(b.id));
        if (own.length < least || !own.every(b => +b.w === +own[0].w && +b.l === +own[0].l && b.px && b.px.rot === own[0].px.rot)) continue;
        if (!own.every(b => /^\\d+$/.test(String(b.bed)))) continue;
        const frame = G.upright(own[0].px.rot), boxes = own.map(b => G.box(M.shapeOf(b.id), frame)), level = boxes.every(x => Math.abs(x.v - boxes[0].v) < 1);
        if (!level) continue;
        const sorted = own.map((b, i) => ({ b, u: boxes[i].u })).sort((p, q) => p.u - q.u).map(o => o.b.id);
        return { gardenId: g.id, ids: sorted, w: +own[0].w, l: +own[0].l, frame, k: M.shapeOf(own[0].id).W / own[0].w };
      }
      return null;
    },
    /** how far (in the frame of `ids`) the group can be shifted to stand on open ground: the first offset that clears everything */
    openShift(ids, frame, grow = 1.0) {
      const set = new Set(ids), still = drawn().filter(s => !set.has(s.id)), own = ids.map(id => M.shapeOf(id)), box = G.boxAll(own, frame);
      const step = Math.max(box.u1 - box.u0, box.v1 - box.v0) * 0.25 + 20;
      for (let ring = 1; ring < 40; ring++) for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const [dx, dy] = G.outOf(frame, a * ring * step, b * ring * step);
        const moved = own.map(s => ({ ...s, x: s.x + dx, y: s.y + dy, W: s.W * grow, L: s.L * grow }));
        if (!moved.some(m => still.some(s => G.overlaps({ ...m, W: m.W + 30, L: m.L + 30 }, s)))) return { dx, dy };
      }
      return null;
    },
    undoLabel() { const u = A.state.undo; return u.length ? u[u.length - 1].label : ''; },
    toast() { const t = document.getElementById('toast'); return t.classList.contains('show') ? t.textContent : ''; },
    fits(sel) { return [...document.querySelectorAll(sel)].every(e => e.scrollWidth <= e.clientWidth + 1 && e.getClientRects().length === 1); }
  };
  return true;
})()"""


def run(page, width):
    js = page.evaluate
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(url); page.wait_for_function('window.LRFApp && LRFApp.state.ready', timeout=90000)
    if BACKUP and js('LRFApp.isSample()'):
        page.set_input_files('#importFile', BACKUP)
        page.wait_for_function("!LRFApp.isSample() && LRFThumbs.count() > 100", timeout=240000)
    js("LRFApp.setView('map'); LRFApp.setDate(new Date(LRFApp.planYear(), 5, 15)); LRFMap.fit()"); page.wait_for_timeout(500)
    js(HELPERS)
    tag = '%d wide: ' % width

    def drag(a, b, steps=8, keys=(), hold=None, settle=120):
        for k in keys: page.keyboard.down(k)
        page.mouse.move(a['x'], a['y']); page.mouse.down()
        for i in range(1, steps + 1):
            page.mouse.move(a['x'] + (b['x'] - a['x']) * i / steps, a['y'] + (b['y'] - a['y']) * i / steps)
        page.wait_for_timeout(60)
        seen = hold() if hold else None
        page.mouse.up()
        for k in keys: page.keyboard.up(k)
        page.wait_for_timeout(settle)
        return seen

    key0, digest0, n_beds0, n_gardens0 = js('LRFApp.contentKey()'), js('T.digest()'), js('LRFApp.state.plan.beds.length'), js('LRFApp.state.plan.gardens.length')

    # ───────────── the everyday map ─────────────
    # crates keep their place
    group = js("""(() => { const e = LRFApp.state.engine; let best = null; for (const id of LRFMap.spaces()) { const b = e.bedOf(id); if (!e.isCt(b)) continue; const n = e.plantingsIn(id).length; if (!best || n > best.n) best = { id, n, count: +b.count }; } return best; })()""")
    if group and group['n'] >= 3:
        seats = js("""(id => { const e = LRFApp.state.engine, year = LRFApp.planYear(), out = { clash: 0, moved: 0, short: 0, days: 0, seen: 0 }, where = new Map();
          for (let m = 0; m < 12; m++) for (const d of [5, 19]) { LRFApp.setDate(new Date(year, m, d)); out.days++;
            const cells = new Set(), here = e.cropsAt(id, LRFApp.state.date);
            for (const g of document.querySelectorAll('#mapBeds [data-bed="' + id + '"] g[data-planting]')) {
              const at = [...g.children].map(c => (c.getAttribute('x') || c.getAttribute('cx')) + ',' + (c.getAttribute('y') || c.getAttribute('cy'))).sort().join(' ');
              for (const c of at.split(' ')) { if (c && cells.has(c)) out.clash++; cells.add(c); }
              const was = where.get(g.dataset.planting); if (was !== undefined && was !== at) out.moved++; where.set(g.dataset.planting, at); out.seen++;
            }
            const room = +e.bedOf(id).count, want = here.reduce((n, r) => n + Math.max(1, Math.round(r.len)), 0);
            if (cells.size !== Math.min(room, want) && want <= room) out.short++; }
          LRFApp.setDate(new Date(year, 5, 15)); return out; })('%s')""" % group['id'])
        check(tag + 'a crop keeps the same containers on every day it stands, no container holds two crops, and every crop that fits is drawn whole', seats['clash'] == 0 and seats['moved'] == 0 and seats['short'] == 0 and seats['seen'] > 0, seats)
        js("LRFMap.fitSpaces(['%s'], false)" % group['id']); page.wait_for_timeout(250)
        named = js("""[...document.querySelectorAll('#mapBeds [data-bed="%s"] .bed-label')].filter(e => e.style.display !== 'none' && e.textContent).length""" % group['id'])
        check(tag + 'zoomed in, the crops in a group of containers are named', named >= 1, named)
        page.screenshot(path=os.path.join(shots, 'crates-%d.png' % width))
        # a crop dragged within its own group takes other containers; one that went in before it keeps its place
        CELL = "((id, i) => { const s = LRFMap.shapeOf(id), c = LRFMap.cellsOf(id), G = LRFMapGeo, p = G.outOf(s.rot, -s.W / 2 + (i %% c.columns) * (c.w + c.gap) + c.w / 2, -s.L / 2 + Math.floor(i / c.columns) * (c.l + c.gap) + c.l / 2); return T.client(s.x + p[0], s.y + p[1]); })('%s', %d)"
        here = js("""(id => { const e = LRFApp.state.engine, seats = LRFMap.seatsOf(id), date = LRFApp.state.date, used = new Set();
          const list = e.cropsAt(id, date).map(r => ({ id: r.planting.id, from: +e.occupancyFrom(r.planting, r), at: seats.get(r.planting.id) || [] })).filter(x => x.at.length);
          for (const x of list) for (const i of x.at) used.add(i);
          const free = []; for (let i = 0; i < LRFMap.cellsOf(id).count; i++) if (!used.has(i)) free.push(i);
          return { list, free }; })('%s')""" % group['id'])
        late = sorted(here['list'], key=lambda x: -x['from'])
        moved_ok, tried = None, 0
        for cand in late[:4]:
            for tgt in here['free'][:12]:
                tried += 1
                a, b = js(CELL % (group['id'], cand['at'][0])), js(CELL % (group['id'], tgt))
                seen = drag(a, b, hold=lambda: js("({ ghost: document.querySelectorAll('#mapOver .drop-ghost.cell').length, state: (document.querySelector('#mapOver .drop-ghost.cell') || { dataset: {} }).dataset.state || '' })"), settle=200)
                if js('LRFApp.contentKey()') != key0:
                    moved_ok = {'cand': cand, 'tgt': tgt, 'seen': seen}
                    break
            if moved_ok: break
        if moved_ok:
            after = js("(pid => { const e = LRFApp.state.engine, p = e.planting(pid); return { seat: p.seat, at: LRFMap.seatsOf(p.bedId).get(pid), bed: p.bedId, label: T.undoLabel(), toast: T.toast(), sel: LRFApp.state.sel }; })('%s')" % moved_ok['cand']['id'])
            n = len(moved_ok['cand']['at'])
            check(tag + 'a crop dragged within its own group of containers takes the containers it is set down on: shown one by one while it is held, one step, and nothing else about it changes',
                  after['bed'] == group['id'] and after['at'] == list(range(after['seat'], after['seat'] + n)) and after['seat'] != moved_ok['cand']['at'][0] and moved_ok['seen']['ghost'] == n and moved_ok['seen']['state'] == 'ok' and 'containers' in after['label'] and js('T.digest()') == digest0, {'moved': moved_ok, 'after': after})
            drawn_at = js("""((id, pid) => { const c = LRFMap.cellsOf(id), s = LRFMap.shapeOf(id), g = document.querySelector('#mapBeds [data-bed="' + id + '"] g[data-planting="' + pid + '"]'); return g ? [...g.children].map(el => { const x = +(el.getAttribute('x') || el.getAttribute('cx')), y = +(el.getAttribute('y') || el.getAttribute('cy')); return Math.round((y + s.L / 2) / (c.l + c.gap) - 0.25) * c.columns + Math.round((x + s.W / 2) / (c.w + c.gap) - 0.25); }).sort((p, q) => p - q) : []; })('%s', '%s')""" % (group['id'], moved_ok['cand']['id']))
            check(tag + 'and it is drawn there', drawn_at == after['at'], [drawn_at, after['at']])
            page.keyboard.press('Control+z'); page.wait_for_timeout(150)
            check(tag + 'Undo puts it back in its own containers', js('LRFApp.contentKey()') == key0 and js("LRFMap.seatsOf('%s').get('%s')" % (group['id'], moved_ok['cand']['id'])) == moved_ok['cand']['at'])
        else:
            check(tag + 'a crop could be dragged to free containers in its own group', False, {'tried': tried, 'free': here['free'][:8], 'late': late[:2]})
        early = sorted(here['list'], key=lambda x: x['from'])
        if len(early) >= 2 and early[0]['from'] < early[-1]['from']:
            a, b = js(CELL % (group['id'], early[-1]['at'][0])), js(CELL % (group['id'], early[0]['at'][0]))
            seen = drag(a, b, hold=lambda: js("(document.querySelector('#mapOver .drop-ghost.cell') || { dataset: {} }).dataset.state || ''"), settle=200)
            check(tag + 'set down on containers a crop that went in earlier holds, it goes back: those are shown as taken, and the message says why', js('LRFApp.contentKey()') == key0 and seen == 'blocked' and 'taken' in js('T.toast()'), [seen, js('T.toast()')])
        js('LRFApp.select(null); LRFMap.fit()')
    else:
        check(tag + 'a group of containers with several crops was found to test', False, group)

    # the view: asked for by hand it is eased, asked for by the planner it lands at once
    home = js('LRFMap.zoom()')
    page.click('#mapZoomIn'); mid = js('LRFMap.zoom()'); page.wait_for_timeout(450); zoomed = js('LRFMap.zoom()')
    check(tag + 'the zoom button is eased: the map is on its way a moment after the click and there after it', home <= mid < zoomed and abs(zoomed / home - 1.5) < 0.01, [home, mid, zoomed])
    page.click('#mapFit'); part = js('LRFMap.zoom()'); page.wait_for_timeout(500); back = js('LRFMap.zoom()')
    check(tag + 'Fit farm glides back to the whole farm', part > back and abs(back - home) < 1e-6, [part, back, home])
    js('document.getElementById("mapZoomIn").click()'); js('LRFMap.fit()'); now = js('LRFMap.zoom()'); page.wait_for_timeout(350)
    check(tag + 'a fit asked for by the planner lands at once, and a glide in progress gives way to it', abs(now - home) < 1e-6 and abs(js('LRFMap.zoom()') - home) < 1e-6, [now, home])
    # The wheel is not eased. What the view is, is read inside the wheel event itself, after the map's own handler has run
    # (a listener on the window hears the event last), so "at once" is not a race with the browser. The pointer is held off
    # the middle of the map, so a zoom about the middle shows as ground sliding under the pointer.
    box = page.locator('#map').bounding_box()
    wx, wy = round(box['x'] + box['width'] * 0.3), round(box['y'] + box['height'] * 0.38)   # whole pixels: the event carries no fractions
    js("""(() => { window.__wheelSeen = []; window.__wheelSpy = e => window.__wheelSeen.push({ z: LRFMap.zoom(), at: LRFMap.toWorld(e.clientX, e.clientY) }); window.addEventListener('wheel', window.__wheelSpy, { passive: true }); })()""")
    page.mouse.move(wx, wy); under = js('LRFMap.toWorld(%d, %d)' % (wx, wy))
    page.mouse.wheel(0, -100); page.wait_for_timeout(450)
    seen = js('window.__wheelSeen'); w2 = js('LRFMap.zoom()'); js("window.removeEventListener('wheel', window.__wheelSpy)")
    first = seen[0] if seen else {'z': 0, 'at': [1e9, 1e9]}
    check(tag + 'one notch of the mouse wheel zooms at once and ends where a notch always ended: the view is there before the event is over, and does not move after it', len(seen) == 1 and abs(first['z'] / home - 1.1735) < 0.004 and abs(w2 - first['z']) < 1e-9, [home, seen, w2])
    check(tag + 'the wheel zooms about the pointer: the ground under it stays under it', len(seen) == 1 and abs(first['at'][0] - under[0]) < 1e-6 and abs(first['at'][1] - under[1]) < 1e-6, [under, seen])
    js('LRFMap.fit()')
    # a window that changes size is fitted again, unless the view was moved by hand
    page.set_viewport_size({'width': width - 180, 'height': 760}); page.wait_for_timeout(350)
    inview = js("""(() => { const r = document.getElementById('map').getBoundingClientRect(); return [...document.querySelectorAll('#mapBeds > g')].every(g => { const b = g.getBoundingClientRect(); return b.left >= r.left - 1 && b.right <= r.right + 1 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1; }); })()""")
    check(tag + 'a window made smaller is fitted again: every space is still in view', inview and js('LRFMap.zoom()') < home, [inview, js('LRFMap.zoom()'), home])
    page.set_viewport_size({'width': width, 'height': 900}); page.wait_for_timeout(350)
    check(tag + 'and back at its first size it is fitted as it was', abs(js('LRFMap.zoom()') - home) < 1e-6, [js('LRFMap.zoom()'), home])
    box = page.locator('#map').bounding_box()
    blank = js("""(() => { const r = document.getElementById('map').getBoundingClientRect(); for (let x = r.left + 30; x < r.right - 30; x += 41) for (let y = r.top + 80; y < r.bottom - 120; y += 37) { if (!LRFMap.nearest(x, y, 40) && !document.elementFromPoint(x, y).closest('.plate, .garden-label, [data-bed]')) return { x, y }; } return null; })()""")
    page.mouse.move(blank['x'], blank['y']); page.mouse.wheel(0, -100); page.wait_for_timeout(400)
    moved = js('LRFMap.zoom()')
    page.set_viewport_size({'width': width - 180, 'height': 760}); page.wait_for_timeout(350)
    check(tag + 'a view the grower has zoomed is left alone when the window changes size', abs(js('LRFMap.zoom()') - moved) < 1e-6 and moved > home, [moved, js('LRFMap.zoom()')])
    page.set_viewport_size({'width': width, 'height': 900}); page.wait_for_timeout(250)
    js('LRFMap.fit()'); page.wait_for_timeout(120)
    spot0 = js('LRFMap.toScreen(0, 0)')
    drag(blank, {'x': blank['x'] + 60, 'y': blank['y'] + 25})
    spot1 = js('LRFMap.toScreen(0, 0)')
    page.set_viewport_size({'width': width - 180, 'height': 760}); page.wait_for_timeout(350)
    spot2 = js('LRFMap.toScreen(0, 0)')
    check(tag + 'a drag on open ground moves the view, and a view moved that way is left alone when the window changes size too', abs(spot1[0] - spot0[0] - 60) < 1 and abs(spot1[1] - spot0[1] - 25) < 1 and spot2 == spot1 and abs(js('LRFMap.zoom()') - home) < 1e-6, [spot0, spot1, spot2])
    page.set_viewport_size({'width': width, 'height': 900}); page.wait_for_timeout(250)
    js('LRFMap.fit()')

    # ───────────── the layout mode ─────────────
    tools = js("""(() => { const t = document.querySelector('.map-tools').getBoundingClientRect(), s = document.getElementById('mapScale').getBoundingClientRect(), b = document.getElementById('mapEditToggle'); return { first: document.querySelector('.map-tools').firstElementChild === b, clear: s.right + 12 < t.left, text: b.textContent, fits: b.scrollWidth <= b.clientWidth + 1 }; })()""")
    check(tag + '“Edit layout” leads the map’s tools, is not clipped, and the tools stay clear of the scale marker', tools['first'] and tools['clear'] and tools['fits'] and tools['text'] == 'Edit layout', tools)
    page.click('#mapEditToggle'); page.wait_for_timeout(200)
    mode = js("""({ on: LRFMapEdit.on(), body: document.body.dataset.layout, lib: getComputedStyle(document.getElementById('libList')).display, side: getComputedStyle(document.getElementById('layoutSide')).display,
      insp: getComputedStyle(document.getElementById('inspectorBody')).display, panel: getComputedStyle(document.getElementById('layoutPanel')).display, season: getComputedStyle(document.getElementById('mapSeasonToggle')).display,
      pressed: document.getElementById('mapEditToggle').getAttribute('aria-pressed'), title: document.querySelector('#layoutPanel h2').textContent, gardens: document.querySelectorAll('#leList .le-garden').length, pill: !document.getElementById('lePill').hidden })""")
    check(tag + 'the button turns the map into a drawing of the ground: its own list on the left, its own panel on the right, the crop library and the plan’s panel put away',
          mode['on'] and mode['body'] == 'on' and mode['lib'] == 'none' and mode['side'] != 'none' and mode['insp'] == 'none' and mode['panel'] != 'none' and mode['season'] == 'none' and mode['pressed'] == 'true' and mode['gardens'] >= 1 and mode['pill'], mode)
    stats = js("({ fits: T.fits('#layoutPanel .stat span, #layoutPanel .stat b, #layoutSide .le-garden b, #layoutSide .le-tool b, #lePill b, #lePill span'), spaces: +document.querySelector('#leSpaces b').textContent.replace(/,/g, ''), drawn: LRFMap.spaces().length })")
    check(tag + 'the panel counts the spaces on the map, and no label in it is clipped or wrapped', stats['fits'] and stats['spaces'] == stats['drawn'], stats)
    page.screenshot(path=os.path.join(shots, 'layout-%d.png' % width))

    hov = js("(() => { const id = LRFMap.spaces().find(id => { const r = LRFMap.element(id).getBoundingClientRect(), m = document.getElementById('map').getBoundingClientRect(); return r.width > 3 && r.height > 3 && r.left > m.left + 20 && r.right < m.right - 20 && r.top > m.top + 60 && r.bottom < m.bottom - 80; }); const r = LRFMap.element(id).querySelector('.bed-base').getBoundingClientRect(); return { id, x: r.left + r.width / 2, y: r.top + r.height / 2, name: LRFApp.state.engine.bedOf(id).bed }; })()")
    page.mouse.move(hov['x'] - 1, hov['y'] - 1); page.mouse.move(hov['x'], hov['y']); page.wait_for_timeout(80)
    card = js("({ hidden: document.querySelector('.le-read').hidden, text: document.querySelector('.le-read').textContent, plan: document.getElementById('tip').hidden })")
    check(tag + 'the pointer over a space reads its garden, its name and what it measures; the plan’s own hover card stays away', not card['hidden'] and str(hov['name']) in card['text'] and card['plan'], card)

    row = js('T.row(4)')
    if not row:
        check(tag + 'a row of like beds was found to test', False)
        return errors
    ids, k = row['ids'], row['k']
    js("LRFMap.fitSpaces(%s, false, 0.9)" % json.dumps(ids)); page.wait_for_timeout(250)
    z = js('LRFMap.zoom()')

    # a planting cannot be picked up while the ground is being edited
    fill = js("""(() => { const el = document.querySelector('#mapBeds [data-planting]'); if (!el) return null; const r = el.getBoundingClientRect(), m = document.getElementById('map').getBoundingClientRect(); return r.left > m.left && r.right < m.right && r.top > m.top + 50 && r.bottom < m.bottom - 60 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()""")
    if fill:
        page.mouse.move(fill['x'], fill['y']); page.mouse.down(); page.mouse.move(fill['x'] + 3, fill['y'] + 2)
        ghost = js("!!document.querySelector('.drag-ghost')"); page.mouse.up(); page.wait_for_timeout(80)
        check(tag + 'pressing on a planting picks its bed: plantings are not picked up while the ground is edited', not ghost and js('LRFApp.state.sel') is None and len(js('LRFMapEdit.picked()')) == 1, [ghost, js('LRFApp.state.sel')])
    js("LRFMapEdit.pick([LRFMap.spaces()[0]])"); page.keyboard.press('Escape'); page.wait_for_timeout(60)
    stays = js("({ on: LRFMapEdit.on(), picked: LRFMapEdit.picked().length })")
    check(tag + 'Escape lets go of what is picked and stays in the mode', stays['on'] and stays['picked'] == 0, stays)
    if not stays['on']:
        js('LRFMapEdit.open()')

    # pick: click, Shift-click, a garden's name, the list
    last, first = ids[-1], ids[0]
    c = js("T.at('%s')" % last); page.mouse.click(c['x'], c['y']); page.wait_for_timeout(80)
    one = js("""({ picked: LRFMapEdit.picked(), outlines: document.querySelectorAll('#mapEdit .le-pick').length, grips: document.querySelectorAll('#mapEdit .le-grip').length, turn: document.querySelectorAll('#mapEdit .le-turn').length,
      w: document.querySelector('#leWidth b').textContent, l: document.querySelector('#leLength b').textContent, fw: document.getElementById('fLayW').value, fl: document.getElementById('fLayL').value, word: [...document.querySelectorAll('#mapEdit .le-word')].map(e => e.textContent) })""")
    check(tag + 'a click picks a bed: it is outlined, its size is read on the map and in the panel, and it has ends, sides and a round handle to drag',
          one['picked'] == [last] and one['outlines'] == 1 and one['grips'] >= 2 and one['turn'] == 1 and float(one['fw']) == row['w'] and float(one['fl']) == row['l'] and any('×' in w for w in one['word']), one)
    c2 = js("T.at('%s')" % ids[-2]); page.keyboard.down('Shift'); page.mouse.click(c2['x'], c2['y']); page.keyboard.up('Shift'); page.wait_for_timeout(80)
    two = js("({ picked: LRFMapEdit.picked(), grips: document.querySelectorAll('#mapEdit .le-grip').length, box: document.querySelectorAll('#mapEdit .le-box').length, tidy: !!document.getElementById('leTidy') })")
    check(tag + 'Shift-click picks another: the two are boxed, and the panel offers lining up and spacing', two['picked'] == [last, ids[-2]] and two['grips'] == 0 and two['box'] == 1 and two['tidy'], two)
    lab = js("""(g => { const el = document.querySelector('#mapGardens .garden-label[data-garden="' + g + '"]'); if (!el || el.style.visibility === 'hidden') return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })('%s')""" % row['gardenId'])
    if lab:
        page.mouse.click(lab['x'], lab['y']); page.wait_for_timeout(80)
        check(tag + 'a click on a garden’s name picks all of it', sorted(js('LRFMapEdit.picked()')) == sorted(ids) and js("!!document.getElementById('leGarden')"), js('LRFMapEdit.picked()'))
    page.keyboard.press('Escape'); page.wait_for_timeout(60)
    check(tag + 'with a whole garden picked, Escape lets go of it too', js('LRFMapEdit.picked()') == [] and js('LRFMapEdit.on()'))
    if not js('LRFMapEdit.on()'):
        js('LRFMapEdit.open()')
    page.click('#leList .le-garden[data-garden="%s"]' % row['gardenId']); page.wait_for_timeout(450)
    listed = js("({ picked: LRFMapEdit.picked().length, on: document.querySelector('#leList .le-garden.on').dataset.garden })")
    check(tag + 'the list on the left picks a whole garden and brings it into view', listed['picked'] == len(ids) and listed['on'] == row['gardenId'], listed)
    js("LRFMap.fitSpaces(%s, false, 0.9)" % json.dumps(ids)); page.wait_for_timeout(200)

    # move: a bed dragged off to open ground, freely
    js("LRFMapEdit.pick([])")
    was = js("T.px('%s')" % last); a = js("T.at('%s')" % last)
    shift = js("T.openShift(['%s'], %s)" % (last, row['frame']))
    b = js("(() => { const s = LRFMap.shapeOf('%s'); return T.client(s.x + %f, s.y + %f); })()" % (last, shift['dx'], shift['dy']))
    box = page.locator('#map').bounding_box()
    b = {'x': min(max(b['x'], box['x'] + 30), box['x'] + box['width'] - 30), 'y': min(max(b['y'], box['y'] + 70), box['y'] + box['height'] - 90)}
    still0 = js('LRFMap.toScreen(0, 0)')
    seen = drag(a, b, keys=('Control',), hold=lambda: js("({ read: document.querySelector('.le-read').textContent, hidden: document.querySelector('.le-read').hidden, pick: document.querySelectorAll('#mapEdit .le-pick').length })"))
    check(tag + 'the map itself stays still while a bed is dragged over it', js('LRFMap.toScreen(0, 0)') == still0 and js('LRFMapEdit.picked()') == [last], [still0, js('LRFMap.toScreen(0, 0)'), js('LRFMapEdit.picked()')])
    now = js("T.px('%s')" % last); z = js('LRFMap.zoom()')
    want = ((b['x'] - a['x']) / z, (b['y'] - a['y']) / z)
    free_ok = abs(now['x'] - was['x'] - want[0]) < 0.6 and abs(now['y'] - was['y'] - want[1]) < 0.6 and now['rot'] == was['rot']
    if abs(want[0]) + abs(want[1]) < 3:
        check(tag + 'open ground was found beside the row to drag a bed to', False, [shift, a, b])
    check(tag + 'a bed dragged with Ctrl goes exactly where it is dropped, and the card beside the pointer says how far', free_ok and 'ft' in seen['read'] and not seen['hidden'] and seen['pick'] == 1, {'was': was, 'now': now, 'want': want, 'seen': seen})
    check(tag + 'the move is one step, named', js('T.undoLabel()').startswith('Move '), js('T.undoLabel()'))
    check(tag + 'moving ground changes no planting’s dates or yield', js('T.digest()') == digest0)
    # dragged back roughly where it was: it finds the row's path and its line again by itself
    a = js("T.at('%s')" % last); home_at = js("(() => T.client(%f, %f))()" % (was['x'], was['y']))
    seen = drag(a, {'x': home_at['x'] + 3, 'y': home_at['y'] - 4}, hold=lambda: js("({ guides: document.querySelectorAll('#mapEdit .le-guide').length, gap: document.querySelectorAll('#mapEdit .le-gap').length, read: document.querySelector('.le-read').textContent })"))
    back = js("T.px('%s')" % last)
    check(tag + 'dropped a few pixels off its old place, a bed settles on the row’s own path and line: guide lines show what it matched',
          abs(back['x'] - was['x']) < 0.02 and abs(back['y'] - was['y']) < 0.02 and seen['guides'] >= 2 and seen['gap'] >= 1 and 'path' in seen['read'], {'was': was, 'back': back, 'seen': seen})
    page.keyboard.press('Control+z'); page.wait_for_timeout(120); page.keyboard.press('Control+z'); page.wait_for_timeout(120)
    check(tag + 'two Undos put the plan back exactly as it was', js('LRFApp.contentKey()') == key0, [js('LRFApp.contentKey()'), key0])

    # the guard rail: one space may not lie on another
    a = js("T.at('%s')" % last); onto = js("T.at('%s')" % ids[-2])
    seen = drag(a, onto, keys=('Control',), hold=lambda: js("({ bad: document.querySelectorAll('#mapEdit .le-pick.bad').length, read: document.querySelector('.le-read').textContent })"))
    check(tag + 'a bed dropped on its neighbour goes back where it was: red while it is held there, and the plan untouched',
          js('LRFApp.contentKey()') == key0 and seen['bad'] == 1 and 'would lie on' in seen['read'] and 'would lie on' in js('T.toast()'), {'seen': seen, 'toast': js('T.toast()')})

    # stretch: the real length, the far end staying put
    js("LRFMapEdit.pick(['%s'])" % last); page.wait_for_timeout(60)
    grip = js("""(() => { const g = document.querySelector('#mapEdit .le-grip[data-le="v1"]'); if (!g) return null; const r = g.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()""")
    far0 = js("(() => { const s = LRFMap.shapeOf('%s'), p = LRFMapGeo.outOf(s.rot, 0, -s.L / 2); return [s.x + p[0], s.y + p[1]]; })()" % last)
    out = js("(() => { const s = LRFMap.shapeOf('%s'), p = LRFMapGeo.outOf(s.rot, 0, s.L / 2 + 3.2 * %f); return T.client(s.x + p[0], s.y + p[1]); })()" % (last, k))
    seen = drag(grip, out, hold=lambda: js("document.querySelector('.le-read').textContent"))
    grown = js("(() => { const b = LRFApp.state.engine.bedOf('%s'), s = LRFMap.shapeOf('%s'), p = LRFMapGeo.outOf(s.rot, 0, -s.L / 2); return { l: b.l, w: b.w, far: [s.x + p[0], s.y + p[1]] }; })()" % (last, last))
    check(tag + 'an end dragged out 3.2 ft lengthens the bed by 3 ft (half feet), the other end stays where it was, and the width is untouched',
          grown['l'] == row['l'] + 3 and grown['w'] == row['w'] and abs(grown['far'][0] - far0[0]) < 0.05 and abs(grown['far'][1] - far0[1]) < 0.05 and '×' in seen, {'grown': grown, 'far0': far0, 'seen': seen})
    check(tag + 'the new length is one step, named', 'length' in js('T.undoLabel()'), js('T.undoLabel()'))
    # dragged back to within reach of its neighbours' length, it takes their length exactly
    grip = js("""(() => { const r = document.querySelector('#mapEdit .le-grip[data-le="v1"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()""")
    out = js("(() => { const s = LRFMap.shapeOf('%s'), p = LRFMapGeo.outOf(s.rot, 0, s.L / 2 - 2.6 * %f); return T.client(s.x + p[0], s.y + p[1]); })()" % (last, k))
    seen = drag(grip, out, hold=lambda: js("document.querySelector('.le-read').textContent"))
    check(tag + 'dragged back near its neighbours’ length it takes theirs, and says whose', js("LRFApp.state.engine.bedOf('%s').l" % last) == row['l'] and 'same as' in seen, [js("LRFApp.state.engine.bedOf('%s').l" % last), seen])
    page.keyboard.press('Control+z'); page.wait_for_timeout(100); page.keyboard.press('Control+z'); page.wait_for_timeout(100)
    check(tag + 'and two Undos put it back', js('LRFApp.contentKey()') == key0)
    # shorter than what is planted in it: the planner's own rule refuses
    full = js("""(() => { const e = LRFApp.state.engine; for (const id of LRFMap.spaces()) { const b = e.bedOf(id); if (!e.isSoilBed(b) || b.l < 12) continue; if (e.plantingsIn(id).some(p => { const r = e.calc(p); return r && r.len >= b.l - 0.01; })) return id; } return null; })()""")
    if full:
        js("LRFMapEdit.pick(['%s']); LRFMapEdit.resize('l', LRFApp.state.engine.bedOf('%s').l - 5)" % (full, full)); page.wait_for_timeout(120)
        check(tag + 'a bed cannot be made shorter than what is planted in it', js('LRFApp.contentKey()') == key0 and 'run past the end' in js('T.toast()'), js('T.toast()'))

    # turn
    js("LRFMapEdit.pick(%s)" % json.dumps(ids)); page.wait_for_timeout(80)
    knob = js("(() => { const r = document.querySelector('#mapEdit .le-turn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()")
    mid_at = js("(() => { const b = LRFMapGeo.boxAll(%s.map(id => LRFMap.shapeOf(id)), %s), p = LRFMapGeo.outOf(%s, b.u, b.v); return T.client(p[0], p[1]); })()" % (json.dumps(ids), row['frame'], row['frame']))
    import math
    ang = math.atan2(knob['y'] - mid_at['y'], knob['x'] - mid_at['x']) + math.radians(17.3); rad = math.hypot(knob['x'] - mid_at['x'], knob['y'] - mid_at['y'])
    seen = drag(knob, {'x': mid_at['x'] + rad * math.cos(ang), 'y': mid_at['y'] + rad * math.sin(ang)}, steps=10, hold=lambda: js("document.querySelector('.le-read').textContent"))
    rots = js("%s.map(id => T.px(id).rot)" % json.dumps(ids)); rot0 = was['rot']
    turned = [((r - rot0 + 540) % 360) - 180 for r in rots]
    if any(js("!!LRFMapEdit.clash") and False for _ in [0]):
        pass
    if js('LRFApp.contentKey()') == key0:
        check(tag + 'a garden turned by its round handle turns (or is refused where it would lie on another: here it was refused)', 'would lie on' in js('T.toast()'), [seen, js('T.toast()')])
    else:
        same = all(abs(t - turned[0]) < 1e-6 for t in turned)
        check(tag + 'a garden turned by its round handle turns as one, to a whole degree or a neighbour’s line, and the card says the angle', same and abs(turned[0] - 17.3) < 2.6 and abs(turned[0] * 10 - round(turned[0] * 10)) < 1e-6 and '°' in seen, {'turned': turned[:3], 'seen': seen})
        check(tag + 'turning ground changes no planting’s dates or yield', js('T.digest()') == digest0)
        page.keyboard.press('Control+z'); page.wait_for_timeout(120)
    check(tag + 'Undo puts the turn back', js('LRFApp.contentKey()') == key0)

    # arrow keys: ground moves, the planning date does not; a run of presses is one step
    js("LRFMapEdit.pick(%s)" % json.dumps(ids)); date0 = js('+LRFApp.state.date'); undo0 = js('LRFApp.state.undo.length')
    shift = js("T.openShift(%s, %s)" % (json.dumps(ids), row['frame']))
    for _ in range(3): page.keyboard.press('ArrowUp' if shift and shift['dy'] < 0 and abs(shift['dy']) >= abs(shift['dx']) else 'ArrowDown' if shift and abs(shift['dy']) >= abs(shift['dx']) else 'ArrowLeft' if shift and shift['dx'] < 0 else 'ArrowRight')
    during = js('LRFApp.state.undo.length'); page.wait_for_timeout(900)
    after = js("({ undo: LRFApp.state.undo.length, date: +LRFApp.state.date, px: T.px('%s'), label: T.undoLabel(), toast: T.toast() })" % last)
    dist = math.hypot(after['px']['x'] - was['x'], after['px']['y'] - was['y']) * js('LRFMap.feetPerPx()')
    if after['undo'] == undo0:
        check(tag + 'three presses of an arrow key nudge the garden (here there was no room: it was refused, and said so)', 'would lie on' in after['toast'], after)
    else:
        check(tag + 'three presses of an arrow key move the garden a foot and a half, as one step once the keys rest, and leave the planning date alone',
              during == undo0 and after['undo'] == undo0 + 1 and after['date'] == date0 and abs(dist - 1.5) < 0.01 and after['label'].startswith('Nudge '), {'after': after, 'dist': dist})
        page.keyboard.press('Control+z'); page.wait_for_timeout(120)
    check(tag + 'Undo puts the nudge back', js('LRFApp.contentKey()') == key0)

    # copy: Alt-drag leaves the bed and sets down a copy
    js("LRFMapEdit.pick([]); LRFMap.fitSpaces(%s, false, 0.9)" % json.dumps(ids)); page.wait_for_timeout(200)
    highest = js("Math.max(...LRFApp.state.plan.beds.filter(b => b.gardenId === '%s').map(b => +b.bed))" % row['gardenId'])
    a = js("T.at('%s')" % last); shift = js("T.openShift(['%s'], %s)" % (last, row['frame']))
    b = js("(() => { const s = LRFMap.shapeOf('%s'); return T.client(s.x + %f, s.y + %f); })()" % (last, shift['dx'], shift['dy']))
    box = page.locator('#map').bounding_box()
    b = {'x': min(max(b['x'], box['x'] + 30), box['x'] + box['width'] - 30), 'y': min(max(b['y'], box['y'] + 70), box['y'] + box['height'] - 90)}
    drag(a, b, keys=('Alt',))
    copied = js("""(() => { const P = LRFApp.state.plan, picked = LRFMapEdit.picked(), nb = P.beds.find(b => b.id === picked[0]), src = P.beds.find(b => b.id === '%s');
      return { n: P.beds.length, name: nb && nb.bed, garden: nb && nb.gardenId === src.gardenId, w: nb && nb.w, l: nb && nb.l, srcAt: T.px('%s'), names: P.beds.filter(b => b.gardenId === src.gardenId).map(b => +b.bed), plantings: nb ? LRFApp.state.engine.plantingsIn(nb.id).length : -1, label: T.undoLabel() }; })()""" % (last, last))
    check(tag + 'Alt-drag leaves the bed where it is and sets down a copy: the same size, the next number, in the same garden, with nothing planted in it',
          copied['n'] == n_beds0 + 1 and copied['garden'] and copied['w'] == row['w'] and copied['l'] == row['l'] and copied['srcAt'] == was and copied['name'] == str(highest + 1) and len(set(copied['names'])) == len(copied['names']) and copied['plantings'] == 0 and copied['label'].startswith('Copy '), copied)
    # the copy is empty, so it can go; a bed with plantings cannot
    page.keyboard.press('Delete'); page.wait_for_timeout(150)
    check(tag + 'an empty bed is removed with Delete, as one step with an Undo on the message', js('LRFApp.state.plan.beds.length') == n_beds0 and js('T.undoLabel()').startswith('Remove ') and 'removed' in js('T.toast()'), [js('T.undoLabel()'), js('T.toast()')])
    page.keyboard.press('Control+z'); page.wait_for_timeout(100); page.keyboard.press('Control+z'); page.wait_for_timeout(100)
    planted = js("(() => { const e = LRFApp.state.engine; return LRFMap.spaces().find(id => e.plantingsIn(id).length > 0); })()")
    js("LRFMapEdit.pick(['%s'])" % planted); page.keyboard.press('Delete'); page.wait_for_timeout(150)
    check(tag + 'a space that holds plantings cannot be removed, and the message says how many it holds', js('LRFApp.contentKey()') == key0 and 'holds' in js('T.toast()') and 'planting' in js('T.toast()'), js('T.toast()'))

    # add the next bed of a row
    js("LRFMapEdit.pick(['%s'])" % last); page.wait_for_timeout(60)
    page.click('#leAdd'); page.wait_for_timeout(150)
    added = js("""(() => { const P = LRFApp.state.plan, id = LRFMapEdit.picked()[0], nb = P.beds.find(b => b.id === id), G = LRFMapGeo, s = id && LRFMap.shapeOf(id), prev = LRFMap.shapeOf('%s'), before = LRFMap.shapeOf('%s');
      return { n: P.beds.length, toast: T.toast(), step: s ? [s.x - prev.x, s.y - prev.y] : null, pitch: [prev.x - before.x, prev.y - before.y], l: nb && nb.l, name: nb && nb.bed }; })()""" % (last, ids[-2]))
    if added['n'] == n_beds0:
        check(tag + '“Add the next one” adds a bed past the end of the row (here there was no room, and it said so)', 'No room' in added['toast'], added)
    else:
        check(tag + '“Add the next one” sets a bed one step past the end of the row: the step the row keeps, the same size, the next number',
              abs(added['step'][0] - added['pitch'][0]) < 0.02 and abs(added['step'][1] - added['pitch'][1]) < 0.02 and added['l'] == row['l'] and int(added['name']) == len(ids) + 1 or int(added['name']) > 0 and abs(added['step'][0] - added['pitch'][0]) < 0.02, added)
        page.keyboard.press('Control+z'); page.wait_for_timeout(120)
    check(tag + 'and Undo takes it away again', js('LRFApp.contentKey()') == key0)

    # ───────────── a new garden ─────────────
    js("LRFMapEdit.pick([]); LRFMap.fit()"); page.wait_for_timeout(200)
    page.click('#leNew'); page.wait_for_timeout(80)
    # open ground: a block of about 60 x 90 ft that lies on nothing
    spot = js("""(() => { const G = LRFMapGeo, M = LRFMap, k = 1 / M.feetPerPx(), r = document.getElementById('map').getBoundingClientRect(), still = M.spaces().map(id => M.shapeOf(id));
      for (let x = r.left + 60; x < r.right - 60 - 60 * k * M.zoom(); x += 23) for (let y = r.top + 90; y < r.bottom - 150 - 90 * k * M.zoom(); y += 19) {
        const [wx, wy] = M.toWorld(x, y), W = 60 * k, L = 90 * k, blk = { x: wx + W / 2, y: wy + L / 2, rot: 0, W: W * 1.25, L: L * 1.25 };
        if (!still.some(s => G.overlaps(blk, s))) return { x, y, x2: x + W * M.zoom(), y2: y + L * M.zoom() }; }
      return null; })()""")
    if not spot:
        check(tag + 'open ground for a new garden was found on the map', False)
        return errors
    seen = drag({'x': spot['x'], 'y': spot['y']}, {'x': spot['x2'], 'y': spot['y2']}, keys=('Control',), hold=lambda: js("({ ghosts: document.querySelectorAll('#mapOver .le-new').length, read: document.querySelector('.le-read').textContent })"))
    draft = js("""(() => { const d = LRFMapEdit.draft(), made = LRFMapEdit.drafted(); return { has: !!d, beds: made.beds.length, text: made.text, on: made.on, ghosts: document.querySelectorAll('#mapOver .le-new').length, button: document.getElementById('leCreate').textContent, disabled: document.getElementById('leCreate').disabled,
      focus: document.activeElement.id, bedFt: +document.getElementById('leBedFt').value, pathFt: +document.getElementById('lePathFt').value, typical: LRFMapEdit.typical(), W: d.block.W * LRFMap.feetPerPx(), L: d.block.L * LRFMap.feetPerPx() }; })()""")
    fit = int((draft['W'] + draft['pathFt'] + 1e-9) // (draft['bedFt'] + draft['pathFt']))
    check(tag + 'a block dragged on open ground is filled with beds as it is drawn: as many as fit across it at the farm’s usual width and path, running the long way',
          draft['has'] and draft['beds'] == fit and draft['ghosts'] == fit and seen['ghosts'] >= 1 and 'bed' in seen['read'] and draft['bedFt'] == draft['typical']['bedFt'] and draft['pathFt'] == draft['typical']['pathFt'] and not draft['on'] and not draft['disabled'] and str(fit) in draft['button'] and draft['focus'] == 'leName', draft)
    page.screenshot(path=os.path.join(shots, 'new-garden-%d.png' % width))
    page.fill('#leBedFt', '5'); page.press('#leBedFt', 'Tab'); page.wait_for_timeout(80)
    fit5 = int((draft['W'] + draft['pathFt'] + 1e-9) // (5 + draft['pathFt']))
    check(tag + 'a wider bed typed in the panel redraws the block at once', js('LRFMapEdit.drafted().beds.length') == fit5 and js("document.querySelectorAll('#mapOver .le-new').length") == fit5, [fit5, js('LRFMapEdit.drafted().beds.length')])
    page.click('#leRunShort'); page.wait_for_timeout(80)
    short = js("LRFMapEdit.drafted().beds")
    check(tag + 'the beds can run the short way instead: more of them, each as long as the block is wide', len(short) > fit5 and all(abs(b['l'] - math.floor(draft['W'] * 2) / 2) < 1e-6 for b in short), [len(short), short[0] if short else None, draft['W']])
    page.click('#leRunLong'); page.fill('#leName', 'Test ground'); page.wait_for_timeout(60)
    page.click('#leCreate'); page.wait_for_timeout(200)
    made = js("""(() => { const P = LRFApp.state.plan, g = P.gardens.find(g => g.name === 'Test ground'), own = g ? P.beds.filter(b => b.gardenId === g.id) : [], G = LRFMapGeo, shapes = own.map(b => LRFMap.shapeOf(b.id)), others = LRFMap.spaces().filter(id => !own.some(b => b.id === id)).map(id => LRFMap.shapeOf(id));
      return { garden: !!g, type: g && g.type, frost: g && g.frost, n: own.length, names: own.map(b => b.bed), w: own.map(b => b.w), placed: own.every(b => b.px && Number.isFinite(b.px.x)), picked: LRFMapEdit.picked().length, tool: LRFMapEdit.tool(),
        clear: shapes.every((s, i) => shapes.every((t, j) => i >= j || !G.overlaps(s, t)) && !others.some(o => G.overlaps(s, o))), undo: T.undoLabel(), title: document.querySelector('#layoutPanel h2').textContent, listed: !!document.querySelector('#leList .le-garden.on'), gid: g && g.id,
        free: own.every(b => LRFApp.state.engine.bedStatus(b, LRFApp.state.date).free > 0), env: own.length ? LRFApp.state.engine.envOf(own[0]) : '' }; })()""")
    check(tag + '“Make” creates the garden and its beds in one step: numbered from 1, on the map, clear of each other and of everything else, a field the engine can plant in, and picked ready to move',
          made['garden'] and made['type'] == 'field' and made['n'] == fit5 and made['names'] == [str(i + 1) for i in range(fit5)] and all(w == 5 for w in made['w']) and made['placed'] and made['picked'] == fit5 and made['tool'] is None and made['clear'] and made['undo'].startswith('New garden') and made['title'] == 'Test ground' and made['listed'] and made['free'] and made['env'] == 'field', made)
    check(tag + 'a new garden changes no planting already in the plan', js('T.digest()') == digest0)
    plantable = js("""(gid => { const P = LRFApp.state.plan, bed = P.beds.find(b => b.gardenId === gid), date = LRFApp.state.date; let ok = 0, tried = 0;
      for (const c of P.crops.slice(0, 60)) { tried++; const r = LRFApp.preview({ cropId: c.id }, { bedId: bed.id, date, survey: true }); if (r.state === 'ok') ok++; }
      return { ok, tried, rows: (() => { LRFApp.setView('timeline'); const n = document.querySelectorAll('.tl-row[data-bed="' + bed.id + '"]').length; LRFApp.setView('map'); return n; })() }; })('%s')""" % made['gid'])
    check(tag + 'its beds take crops like any other field bed', plantable['ok'] >= 1, plantable)
    js("LRFMapEdit.open(); LRFMapEdit.pick(%s)" % json.dumps(js("LRFApp.state.plan.beds.filter(b => b.gardenId === '%s').map(b => b.id)" % made['gid'])))
    key_new = js('LRFApp.contentKey()')
    new_ids = js('LRFMapEdit.picked()')
    js("LRFMap.fitSpaces(%s, false, 0.8)" % json.dumps(new_ids)); page.wait_for_timeout(200)

    # tidy: space, even out, line up, rows, number
    k1 = js("LRFMap.shapeOf('%s').W / 5" % new_ids[0])
    gaps = "(() => { const G = LRFMapGeo, s = LRFMapEdit.picked().map(id => LRFMap.shapeOf(id)), f = G.upright(s[0].rot), b = s.map(x => G.box(x, f)).sort((p, q) => p.u - q.u); return b.slice(1).map((x, i) => (x.u0 - b[i].u1) / %f); })()" % k1
    page.fill('#lePath', '3'); page.click('#leSpread'); page.wait_for_timeout(150)
    g3 = js(gaps)
    check(tag + '“Space them this far apart” sets every path to the figure typed', len(g3) == fit5 - 1 and all(abs(g - 3) < 0.01 for g in g3) and js('T.undoLabel()').startswith('Space '), g3)
    js("(() => { const id = LRFMapEdit.picked()[1], s = LRFMap.shapeOf(id), [dx, dy] = LRFMapGeo.outOf(s.rot, 1.1 * %f, 4 * %f); LRFMapEdit.pick([id]); })()" % (k1, k1))
    page.keyboard.press('ArrowRight'); page.keyboard.press('ArrowRight'); page.keyboard.press('ArrowDown'); page.wait_for_timeout(900)
    js("LRFMapEdit.pick(%s)" % json.dumps(new_ids)); page.wait_for_timeout(80)
    page.click('#leEven'); page.wait_for_timeout(150)
    ge = js(gaps)
    check(tag + '“Even out the paths” keeps the two outer beds and makes the paths between them equal', all(abs(g - ge[0]) < 0.01 for g in ge) and abs(sum(ge) - 3 * (fit5 - 1)) < 0.02, ge)
    page.click('#leTidy [data-align="v0"]'); page.wait_for_timeout(150)
    tops = js("(() => { const G = LRFMapGeo, s = LRFMapEdit.picked().map(id => LRFMap.shapeOf(id)), f = G.upright(s[0].rot); return s.map(x => G.box(x, f).v0); })()")
    check(tag + '“Top ends” lines every bed’s top end up on one line', max(tops) - min(tops) < 0.02, tops)
    if fit5 >= 4:
        page.fill('#leCols', str(fit5 // 2)); page.fill('#lePath', '2'); page.fill('#leEnd', '6'); page.click('#leRows'); page.wait_for_timeout(180)
        rows = js("(() => { const G = LRFMapGeo, s = %s.map(id => LRFMap.shapeOf(id)), f = G.upright(s[0].rot), b = s.map(x => G.box(x, f)); return { v: b.map(x => Math.round(x.v0 * 10) / 10), gap: (b[1].u0 - b[0].u1) / %f, end: (b[%d].v0 - b[0].v1) / %f, toast: T.toast(), label: T.undoLabel() }; })()" % (json.dumps(new_ids), k1, fit5 // 2, k1))
        if rows['label'].startswith('Set '):
            check(tag + '“Set out in rows” puts so many side by side with the path typed, and the next row past the end gap typed', len(set(rows['v'])) == math.ceil(fit5 / (fit5 // 2)) and abs(rows['gap'] - 2) < 0.01 and abs(rows['end'] - 6) < 0.01, rows)
        else:
            check(tag + '“Set out in rows” (here the rows would lie on other ground, and it said so)', 'would lie on' in rows['toast'], rows)
    # numbering follows how they read
    js("(() => { const ids = %s, a = LRFApp.state.engine.bedOf(ids[0]), b = LRFApp.state.engine.bedOf(ids[1]); LRFApp.commit('swap two numbers', [{ kind: 'bed', before: a, after: { ...a, bed: b.bed } }, { kind: 'bed', before: b, after: { ...b, bed: a.bed } }]); LRFMapEdit.pick([...ids].reverse()); })()" % json.dumps(new_ids)); page.wait_for_timeout(120)
    page.click('#leNumber'); page.wait_for_timeout(150)
    order = js("(() => { const G = LRFMapGeo, ids = LRFMapEdit.picked(), s = G.reading(ids.map(id => LRFMap.shapeOf(id))); return s.map(x => LRFApp.state.engine.bedOf(x.id).bed); })()")
    check(tag + '“Number in order” numbers the beds as they read on the map', order == [str(i + 1) for i in range(fit5)], order)
    js("LRFMapEdit.pick(%s)" % json.dumps(new_ids)); page.wait_for_timeout(80)
    # sizes typed for many at once
    page.fill('#fLayW', '4'); page.press('#fLayW', 'Tab'); page.wait_for_timeout(150)
    ws = js("%s.map(id => LRFApp.state.engine.bedOf(id).w)" % json.dumps(new_ids))
    check(tag + 'a width typed with several beds picked sets them all, as one step', all(w == 4 for w in ws) and 'width' in js('T.undoLabel()'), ws)
    page.fill('#fLayW', '14'); page.press('#fLayW', 'Tab'); page.wait_for_timeout(150)
    check(tag + 'a width that would lay the beds on each other is refused', all(w == 4 for w in js("%s.map(id => LRFApp.state.engine.bedOf(id).w)" % json.dumps(new_ids))) and 'would lie on' in js('T.toast()'), js('T.toast()'))
    page.fill('#fLayW', '40'); page.press('#fLayW', 'Tab'); page.wait_for_timeout(150)
    check(tag + 'and so is one no bed could be', all(w == 4 for w in js("%s.map(id => LRFApp.state.engine.bedOf(id).w)" % json.dumps(new_ids))) and 'width is between' in js('T.toast()'), js('T.toast()'))
    # the whole garden: its name, and how large it is drawn against the photo
    page.fill('#leGarden', 'Test ground B'); page.press('#leGarden', 'Tab'); page.wait_for_timeout(120)
    check(tag + 'a garden is renamed from the panel', js("LRFApp.state.plan.gardens.some(g => g.name === 'Test ground B')") and js('T.undoLabel()').startswith('Rename '))
    mid0 = js("(() => { const s = %s.map(id => LRFMap.shapeOf(id)), b = LRFMapGeo.boxAll(s, 0); return { u: b.u, v: b.v, w: b.u1 - b.u0, W: s[0].W }; })()" % json.dumps(new_ids))
    page.fill('#leDrawn', '90'); page.press('#leDrawn', 'Tab'); page.wait_for_timeout(150)
    mid1 = js("(() => { const s = %s.map(id => LRFMap.shapeOf(id)), b = LRFMapGeo.boxAll(s, 0), g = LRFApp.state.plan.gardens.find(g => g.name === 'Test ground B'); return { u: b.u, v: b.v, w: b.u1 - b.u0, W: s[0].W, scale: g.mapScale, wft: LRFApp.state.engine.bedOf('%s').w }; })()" % (json.dumps(new_ids), new_ids[0]))
    check(tag + 'a garden drawn at 90% shrinks on the map about its middle, and its beds’ real sizes do not change',
          abs(mid1['scale'] - 0.9) < 1e-9 and abs(mid1['W'] / mid0['W'] - 0.9) < 1e-6 and abs(mid1['w'] / mid0['w'] - 0.9) < 1e-3 and abs(mid1['u'] - mid0['u']) < 0.05 and abs(mid1['v'] - mid0['v']) < 0.05 and mid1['wft'] == 4, {'before': mid0, 'after': mid1})
    page.screenshot(path=os.path.join(shots, 'garden-picked-%d.png' % width))
    wrap = js("T.fits('#layoutPanel .stat span, #layoutPanel .stat b, #layoutPanel .field > span, #layoutPanel .fix-btn b, #lePill span')")
    check(tag + 'with a garden picked, no label or figure in the panel is clipped or wrapped', wrap)

    # a block drawn over ground that is taken cannot be made
    js("LRFMapEdit.pick([]); LRFMap.fitSpaces(%s, false, 1.6)" % json.dumps(new_ids)); page.wait_for_timeout(200)
    page.click('#leNew'); page.wait_for_timeout(60)
    c0 = js("(() => { const s = %s.map(id => LRFMap.shapeOf(id)), b = LRFMapGeo.boxAll(s, 0); return [T.client(b.u0 - 8, b.v0 - 8), T.client(b.u1 + 8, b.v1 + 8)]; })()" % json.dumps(new_ids))
    drag(c0[0], c0[1], keys=('Control',))
    over = js("({ on: LRFMapEdit.drafted().on, disabled: document.getElementById('leCreate').disabled, bad: document.querySelectorAll('#mapOver .le-new.bad').length, text: document.getElementById('leMade').textContent })")
    check(tag + 'a block drawn over ground that is taken is shown in red, says whose ground it is, and cannot be made', over['on'] == 'Test ground B' and over['disabled'] and over['bad'] >= 1 and 'Test ground B' in over['text'], over)
    page.keyboard.press('Escape'); page.wait_for_timeout(80)
    check(tag + 'Escape leaves the new garden without making it', js('LRFMapEdit.draft()') is None and js('LRFMapEdit.tool()') is None and js("!document.querySelector('#mapOver .le-new')"))

    # remove the whole test garden, with one question
    js("LRFMapEdit.pick(%s)" % json.dumps(new_ids)); page.keyboard.press('Delete'); page.wait_for_timeout(150)
    asked = js("(() => { const d = document.querySelector('dialog[open]'); return d ? d.textContent : ''; })()")
    page.click('dialog[open] .btn.danger'); page.wait_for_timeout(200)
    check(tag + 'removing a whole garden asks once, and the garden goes with its last bed', 'Test ground B' in asked and 'Undo' in asked and js('LRFApp.state.plan.beds.length') == n_beds0 and js('LRFApp.state.plan.gardens.length') == n_gardens0, asked)
    check(tag + 'with the test garden gone the plan reads to the engine exactly as at the start', js('T.digest()') == digest0)
    n_undo = js('LRFApp.state.undo.length')
    for _ in range(n_undo): page.keyboard.press('Control+z')
    page.wait_for_timeout(250)
    check(tag + 'every step taken back, the plan is the one it was at the start', js('LRFApp.contentKey()') == key0, [n_undo, js('LRFApp.state.undo.length')])

    # ───────────── pots and crates ─────────────
    if group:
        js("LRFMapEdit.pick(['%s']); LRFMap.fitSpaces(['%s'], false, 1.2)" % (group['id'], group['id'])); page.wait_for_timeout(200)
        g0 = js("(() => { const s = LRFMap.shapeOf('%s'), c = LRFMap.cellsOf('%s'); return { W: s.W, L: s.L, columns: c.columns, count: c.count, shown: +document.getElementById('leColumns').value, many: +document.getElementById('leCount').value }; })()" % (group['id'], group['id']))
        rows_now = math.ceil(g0['count'] / g0['columns'])
        page.fill('#leColumns', str(rows_now)); page.press('#leColumns', 'Tab'); page.wait_for_timeout(180)
        g1 = js("(() => { const s = LRFMap.shapeOf('%s'), c = LRFMap.cellsOf('%s'), b = LRFApp.state.engine.bedOf('%s'); return { W: s.W, L: s.L, columns: c.columns, layout: b.potLayout, toast: T.toast(), label: T.undoLabel() }; })()" % (group['id'], group['id'], group['id']))
        if g1['label'].startswith('Set out'):
            check(tag + 'a group of containers is set out with so many side by side: the block on the map takes the new shape and the number of containers is unchanged',
                  g0['shown'] == g0['columns'] and g0['many'] == g0['count'] and g1['columns'] == rows_now and g1['layout']['columns'] == rows_now and (g1['W'] != g0['W'] or rows_now == g0['columns']) and js('T.digest()') == digest0, {'before': g0, 'after': g1})
            page.keyboard.press('Control+z'); page.wait_for_timeout(120)
        else:
            check(tag + 'a group of containers set out another way (here it would lie on other ground, and it said so)', 'would lie on' in g1['toast'], g1)
        check(tag + 'Undo puts the containers back', js('LRFApp.contentKey()') == key0)
        js("LRFMapEdit.pick([])")

    # ───────────── measure, and the photo's scale ─────────────
    js('LRFMap.fit()'); page.wait_for_timeout(150)
    page.click('#leTape'); page.wait_for_timeout(60)
    box = page.locator('#map').bounding_box(); z = js('LRFMap.zoom()'); fpp = js('LRFMap.feetPerPx()')
    p1 = {'x': box['x'] + 120, 'y': box['y'] + 160}; p2 = {'x': p1['x'] + 300, 'y': p1['y'] + 125}
    seen = drag(p1, p2, hold=lambda: js("document.querySelector('.le-read').textContent"))
    true_ft = math.hypot(300, 125) / z * fpp
    tape = js("({ shown: document.querySelector('#leMeasured b').textContent, lines: document.querySelectorAll('#mapEdit .le-tape').length, focus: document.activeElement.id })")
    check(tag + 'a line dragged with the measure reads its length in feet from the photo’s scale, on the map and in the panel', abs(float(tape['shown'].replace(',', '').replace(' ft', '')) - true_ft) < 0.11 and tape['lines'] >= 2 and tape['focus'] == 'leReal' and 'ft' in seen, {'tape': tape, 'true': true_ft})
    page.fill('#leReal', str(round(true_ft * 1.1, 2))); page.click('#leSetScale'); page.wait_for_timeout(200)
    scaled = js("({ fpp: LRFApp.state.plan.map.ftPerPx, drawn: LRFMap.feetPerPx(), label: T.undoLabel(), toast: T.toast(), W: LRFMap.shapeOf('%s').W, px: T.px('%s') })" % (last, last))
    check(tag + 'typing what the line really measures sets the photo’s scale: every space is drawn to it, about its own middle, and the message says by how much',
          abs(scaled['fpp'] / fpp - 1.1) < 0.002 and abs(scaled['drawn'] - scaled['fpp']) < 1e-12 and scaled['px'] == was and 'scale' in scaled['label'] and 'smaller' in scaled['toast'], scaled)
    check(tag + 'a new scale changes no planting’s dates or yield', js('T.digest()') == digest0)
    page.keyboard.press('Control+z'); page.wait_for_timeout(150)
    check(tag + 'one Undo puts the scale back', js('LRFApp.contentKey()') == key0 and abs(js('LRFMap.feetPerPx()') - fpp) < 1e-12)

    # ───────────── leaving ─────────────
    page.keyboard.press('Escape'); page.wait_for_timeout(60); page.keyboard.press('Escape'); page.wait_for_timeout(120)
    if js('LRFMapEdit.on()'):
        page.keyboard.press('Escape'); page.wait_for_timeout(120)
    left = js("""({ on: LRFMapEdit.on(), body: document.body.dataset.layout || '', lib: getComputedStyle(document.getElementById('libList')).display, insp: getComputedStyle(document.getElementById('inspectorBody')).display, season: getComputedStyle(document.getElementById('mapSeasonToggle')).display,
      overlay: document.getElementById('mapEdit').childElementCount, pill: document.getElementById('lePill').hidden, legend: getComputedStyle(document.querySelector('.map-foot')).display })""")
    check(tag + 'Escape, with nothing picked, leaves the mode: the crop library, the plan’s panel, the legend and Whole season are back and nothing of the editor is left on the map',
          not left['on'] and left['body'] == '' and left['lib'] != 'none' and left['insp'] != 'none' and left['season'] != 'none' and left['overlay'] == 0 and left['pill'] and left['legend'] != 'none', left)
    check(tag + 'after all of it, the plan is exactly the one that was opened', js('LRFApp.contentKey()') == key0 and js('T.digest()') == digest0)
    # the plan's own tools work again: a planting can be picked, and the bed panel leads into the mode
    js("LRFMap.fitSpaces(%s, false, 0.9)" % json.dumps(ids)); page.wait_for_timeout(200)
    c = js("T.at('%s')" % ids[1]); page.mouse.click(c['x'], c['y']); page.wait_for_timeout(120)
    sel = js('LRFApp.state.sel')
    check(tag + 'back in the plan, a click on a bed opens its panel as before', sel is not None and sel['type'] in ('bed', 'planting'), sel)
    js("LRFApp.select({ type: 'bed', id: '%s' })" % ids[1]); page.wait_for_timeout(100)
    links = js("(() => { const host = document.getElementById('inspectorBody'), b = document.getElementById('bedLayoutEdit'), spill = e => e.scrollWidth > e.clientWidth + 1; return { figures: ['bedWidth', 'bedLength', 'bedArea'].filter(id => document.getElementById(id)).length, fields: host.querySelectorAll('input, select, textarea').length, size: !!document.getElementById('bedSizeEdit') || !!document.getElementById('bedSizeForm'), layout: !!b, links: host.querySelectorAll('.insp-aside button').length, oneLine: !!b && b.getClientRects().length === 1 && !spill(b), words: b ? b.textContent : '' }; })()")
    check(tag + 'the bed’s panel shows the size and holds nothing that changes it: three figures, no field, no size form', links['figures'] == 3 and links['fields'] == 0 and not links['size'], links)
    if links['layout']:
        page.click('#bedLayoutEdit'); page.wait_for_timeout(500)
    via = js("({ on: LRFMapEdit.on(), picked: LRFMapEdit.picked(), sel: LRFApp.state.sel, w: (document.getElementById('fLayW') || {}).value, l: (document.getElementById('fLayL') || {}).value })")
    check(tag + 'its one link, “Edit the layout…”, on one line, opens the mode with that bed picked and its width and length there to type', links['layout'] and links['links'] == 1 and links['oneLine'] and via['on'] and via['picked'] == [ids[1]] and via['sel'] is None and via['w'] not in (None, '') and via['l'] not in (None, ''), {'links': links, 'via': via})
    js("LRFApp.setView('timeline')"); page.wait_for_timeout(120)
    check(tag + 'going to another view ends the editing', not js('LRFMapEdit.on()') and js("!document.body.dataset.layout"))
    js("LRFApp.setView('map')"); page.wait_for_timeout(120)
    check(tag + 'no error on the page', not errors, errors[:3])
    return errors


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
    browser.close()

print('\n'.join(results))
print(json.dumps({'passed': len(results) - len(failed), 'of': len(results), 'failed': failed}))
sys.stdout.flush()
os._exit(0)
