"""The Timeline and the library (redesign build 4) in a real browser.
Room for a crop: a crop clicked in the library is drawn on the Timeline in every opening of a whole bed it fits, worked out by the
opening's own test (LRFSuccession.tryCrop), on the first day it can go in; everything else is at half strength; one line in the tools
says how many it fits here and on the farm; a hint card says the days; a click plants it there, through the step a drop takes, with
Undo; x puts it down. A garden that is shut shows a band of how full its ground is, week by week, and while a crop is carried the
weeks it could start there. To place is the third side of the library's switch. An opening's words stand clear of the nursery line
of the planting after it, and the nursery line is drawn at the foot of its bar's row.
Every subject is found on the plan the page was given: nothing here names a crop, a bed, a garden or a number of any plan.
usage: python3 -I room_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1707, STOP_AT_FAIL=1
"""
import functools, http.server, json, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
target, shots = Path(sys.argv[1]), Path(sys.argv[2]); shots.mkdir(parents=True, exist_ok=True)
backup = sys.argv[3] if len(sys.argv) > 3 else None
WIDTH = int(os.environ.get("WIDTH", "1707")); STOP = os.environ.get("STOP_AT_FAIL") == "1"
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(target)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
results, failed, errors = [], [], []
def check(name, ok, detail=None):
    results.append({"name": name, "ok": bool(ok), **({"detail": detail} if detail is not None and not ok else {})})
    if not ok:
        failed.append(name)
        if STOP: finish()
def finish():
    print(json.dumps({"passed": len(results) - len(failed), "of": len(results), "failed": failed, "details": [r for r in results if not r["ok"]][:12], "errors": errors[:6]}, default=str))
    sys.stdout.flush(); os._exit(1 if failed else 0)
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, Su = LRFSuccession, $ = id => document.getElementById(id), eng = S.engine;"
       "const hook = n => document.querySelector('[data-hook=\"' + n + '\"]'), hooks = n => [...document.querySelectorAll('[data-hook=\"' + n + '\"]')];"
       "const drawn = el => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';"
       "const colour = v => { const p = document.createElement('i'); p.style.color = v; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; };"
       # the crop's fits worked out here, apart from the Timeline: every opening of a whole bed, the opening's own test
       "const fitsOf = (cropId, varietyId) => { const c = eng.crop(cropId), out = new Map(); for (const o of Su.openings(eng, { empty: true })) { if (!o.whole || !Su.suits(eng, c, o.bed)) continue; const t = Su.tryCrop(eng, o, c, varietyId ? { varietyId } : {}); if (t.ok) out.set(o.id, { o, t }); } return out; };")
def js(page, body, arg=None):
    return page.evaluate("(arg) => { %s %s }" % (PRE, body), arg)
def press(page, selector, ms=300):
    """A thing a fault has taken away is not pressed: the named line after it fails, and the check goes on."""
    hit = page.locator(selector)
    if not hit.count() or not hit.first.is_visible(): return False
    hit.first.click(timeout=3000); page.wait_for_timeout(ms); return True

def run(pw):
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    page = browser.new_context(viewport={"width": WIDTH, "height": 960}).new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=20000)
    if backup and page.evaluate("LRFApp.isSample()"):
        page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
        if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
        page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(1500)
    page.evaluate("try { localStorage.removeItem('lrf-next:timeline'); } catch (_) {}")
    js(page, "A.setView('timeline'); A.select(null); A.arm(null); return null;"); page.wait_for_timeout(700)
    js(page, "for (let k = 0; k < 60; k++) { const b = document.querySelector('#tlBody .tl-group-name[aria-expanded=\"false\"]'); if (!b) break; b.click(); } return null;")
    page.wait_for_timeout(300)

    # ── the subject: the crop that fits the most openings, and a garden holding some of them ──
    # the crop that fits the most openings among those with an opening it could go into on more than one day, so that "on the first
    # day it can go in" is told apart from any other day it could
    pick = js(page, """const best = { n: 0 }; for (const c of Su.candidates(eng)) { const f = [...fitsOf(c.id).values()], late = f.filter(x => x.t.latest && +x.t.latest > +x.t.earliest); if (late.length && f.length > best.n) Object.assign(best, { n: f.length, id: c.id, name: c.name, late: late[0].o.id }); }
      const fits = best.id ? [...fitsOf(best.id).values()] : [], byG = new Map(); for (const f of fits) byG.set(f.o.garden.id, (byG.get(f.o.garden.id) || 0) + 1);
      const g = [...byG.entries()].sort((a, b) => b[1] - a[1])[0];
      return { crop: best.id || null, name: best.name || '', farm: best.n, late: best.late || null, garden: g ? g[0] : null, inGarden: g ? g[1] : 0, gardenName: g ? eng.plan.gardens.find(x => x.id === g[0]).name : '' };""")
    check("the plan has a crop that fits openings of whole beds, one of them on more than one day, for the check to work on", pick["crop"] and pick["farm"] >= 3 and pick["inGarden"] >= 1 and pick["late"], pick)

    # ── nothing carried ──
    still = js(page, "return { line: drawn(hook('room-line')), lit: hooks('room-opening').length, bars: hooks('room-bar').length, quiet: $('tlBody').classList.contains('room'), key: drawn(document.querySelector('.tl-key')), open: document.querySelectorAll('#tlBody .tl-open').length };")
    check("with nothing carried the Timeline is as it was: no line in the tools, nothing lit, nothing at half strength, the key shown", not still["line"] and still["lit"] == 0 and still["bars"] == 0 and not still["quiet"] and still["key"] and still["open"] > 0, still)

    # ── the nursery line at the foot, and an opening's words clear of it ──
    def clear_of_nursery():
        return js(page, """const out = { words: 0, narrowed: 0, crossed: [], foot: 0, notFoot: [] };
          for (const lane of document.querySelectorAll('#tlBody .tl-lane')) {
            const lines = [...lane.querySelectorAll('.ph-nursery')].map(i => i.getBoundingClientRect()).filter(r => r.width > 0);
            for (const box of lane.querySelectorAll('.tl-open')) {
              const t = box.querySelector('.tl-ow span'); if (!t || !t.textContent) continue; out.words++;
              const r = document.createRange(); r.selectNodeContents(t); const tr = r.getBoundingClientRect(), br = box.getBoundingClientRect();
              const into = lines.filter(l => l.left < br.right && l.right > br.left);
              if (into.length) out.narrowed++;
              for (const l of into) if (l.left < tr.right - 0.5 && l.right > tr.left + 0.5) out.crossed.push(box.dataset.opening + ' · ' + t.textContent);
            }
          }
          for (const i of document.querySelectorAll('#tlBody .tl-bar .ph-nursery')) { const r = i.getBoundingClientRect(), b = i.parentElement.getBoundingClientRect(); if (!r.width) continue; if (r.top >= b.bottom - 0.5 && r.height <= 2.5) out.foot++; else if (out.notFoot.length < 3) out.notFoot.push([r.top, b.bottom, r.height]); }
          out.crossed = out.crossed.slice(0, 5); return out;""")
    for scale in ("months", "weeks"):
        if scale == "weeks": press(page, '[data-tl-zoom="weeks"]', 400)
        seen = clear_of_nursery()
        check("at the %s scale no opening's words are crossed by the nursery line of a planting that reaches into the opening (some openings are reached into, and keep words)" % scale, seen["words"] > 0 and seen["narrowed"] > 0 and not seen["crossed"], seen)
        if scale == "months":
            check("every nursery line is 2 px at the foot of its bar, under the line of text", seen["foot"] > 0 and not seen["notFoot"], seen)
    press(page, '[data-tl-zoom="months"]', 400)

    # ── carrying the crop: clicked in the library ──
    js(page, "const r = document.querySelector('#libList .lib-row[data-crop=\"' + arg + '\"]:not(.lib-var)'); if (r) r.scrollIntoView({ block: 'center' }); return null;", pick["crop"])
    row = page.query_selector('#libList .lib-row[data-crop="%s"]:not(.lib-var) .lib-name' % pick["crop"])
    if row: row.click()
    page.wait_for_timeout(600)
    lit = js(page, """const want = fitsOf(arg, ''), ppd = LRFTimeline.scale(), out = { late: 0, carried: !!S.armed && S.armed.cropId === arg, rowInk: '', line: drawn(hook('room-line')), count: (hook('room-count') || {}).textContent || '', key: drawn(document.querySelector('.tl-key')), farm: want.size, lit: [], off: [], wrongDay: [], wrongLen: [], extra: [] };
      const ink = colour('var(--ink)'), libRow = document.querySelector('#libList .lib-row.armed'); out.rowInk = !!libRow && getComputedStyle(libRow).backgroundColor === ink;
      for (const box of hooks('room-opening')) { const id = box.dataset.opening, f = want.get(id); out.lit.push(id); if (!f) { out.extra.push(id); continue; }
        const bar = document.querySelector('#tlBody [data-hook="room-bar"][data-room="' + CSS.escape(id) + '"]'); if (!bar) { out.off.push(id); continue; }
        const b = bar.getBoundingClientRect(), o = box.getBoundingClientRect(), r = f.t.r, days = E.dayDiff(eng.occupancyFrom(f.t.p, r), f.o.from), held = f.t.through === Infinity ? null : E.dayDiff(f.t.through, eng.occupancyFrom(f.t.p, r)) + 1;
        if (f.t.latest && +f.t.latest > +f.t.earliest) out.late++;
        if (Math.abs(b.left - (o.left + days * ppd)) > 1.5) out.wrongDay.push([id, b.left, o.left + days * ppd]);
        if (held != null && Math.abs(b.width - Math.max(4, held * ppd)) > 1.5) out.wrongLen.push([id, b.width, held * ppd]); }
      return out;""", pick["crop"])
    check("a crop clicked in the library is carried, its row in ink like the chosen side of a switch", lit["carried"] and lit["rowInk"], lit)
    check("every opening lit is one the crop fits by the opening's own test, and each holds the crop's bar", lit["lit"] and not lit["extra"] and not lit["off"], {k: lit[k] for k in ("lit", "extra", "off")})
    check("the bar in each stands on the first day the crop can go in (in some it could go later), for the days it holds the ground", lit["lit"] and lit["late"] > 0 and not lit["wrongDay"] and not lit["wrongLen"], {k: lit[k] for k in ("late", "wrongDay", "wrongLen")})
    empty = js(page, "const f = [...fitsOf(arg, '').values()].filter(x => !x.o.planted), lit = new Set(hooks('room-opening').map(b => b.dataset.opening)); return { empty: f.length, lit: f.filter(x => lit.has(x.o.id)).length, bars: f.filter(x => document.querySelector('[data-hook=\"room-bar\"][data-room=\"' + CSS.escape(x.o.id) + '\"]')).length };", pick["crop"])
    check("a bed with nothing planned all year that the crop fits is lit too, with the crop drawn in it", empty["empty"] > 0 and empty["lit"] == empty["empty"] and empty["bars"] == empty["empty"], empty)
    check("one line in the tools, in the key's place, says how many it fits here and on the farm", lit["line"] and not lit["key"] and ("fits %d here" % len(lit["lit"]) in lit["count"] or (not lit["lit"] and "none here" in lit["count"])) and ("%d on the farm" % lit["farm"]) in lit["count"], lit)
    look = js(page, """const flag = colour('var(--flag)'), raised = getComputedStyle(document.body).getPropertyValue('--raised'), white = colour('var(--raised)');
      const box = hook('room-opening'), bar = hook('room-bar'), other = document.querySelector('#tlBody .tl-bar[data-planting]'), dim = document.querySelector('#tlBody .tl-open:not(.fit)');
      const cs = box && getComputedStyle(box);
      return { edge: cs ? cs.borderTopColor === flag && parseFloat(cs.borderTopWidth) === 1 : false, fill: cs ? cs.backgroundColor === white : false, bar: bar ? +getComputedStyle(bar).opacity : null, other: other ? +getComputedStyle(other).opacity : null, dim: dim ? +getComputedStyle(dim).opacity : null };""")
    check("an opening it fits is lit white with a 1 px orange edge; the crop's bar at full strength, every other bar at half, the openings it does not fit fainter", look["edge"] and look["fill"] and look["bar"] == 1 and look["other"] == 0.5 and (look["dim"] is None or look["dim"] < 0.5), look)
    words = js(page, """const out = { shown: 0, outside: [], overBar: [], said: [] }, F = LRFForecast;
      for (const w of hooks('room-words')) { if (!drawn(w)) continue; out.shown++; const id = w.dataset.room || '', bar = document.querySelector('[data-hook="room-bar"][data-room="' + CSS.escape(id) + '"]');
        const box = document.querySelector('[data-hook="room-opening"][data-opening="' + CSS.escape(id) + '"]'); if (!box || !bar) { out.outside.push('no opening for ' + w.textContent); continue; }
        const r = w.getBoundingClientRect(), o = box.getBoundingClientRect(), b = bar.getBoundingClientRect();
        if (r.right > o.right + 0.5 || r.left < o.left - 0.5 || r.bottom > o.bottom + 0.5) out.outside.push(w.textContent);
        if (r.left < b.right - 0.5 && r.right > b.left + 0.5 && r.top < b.bottom - 0.5 && r.bottom > b.top + 0.5) out.overBar.push(w.textContent);
        if (out.said.length < 3) out.said.push(w.textContent); }
      return out;""")
    check("the words of what it gives stand inside their opening and clear of its bar, beside it or under it", words["shown"] > 0 and not words["outside"] and not words["overBar"], words)
    said = js(page, """const f = fitsOf(arg, ''), first = hooks('room-words').find(drawn), fit = first && f.get(first.dataset.room); if (!fit) return null; const t = fit.t, F = LRFForecast;
      return { text: first.textContent, amount: F.amount(t.units, t.unit, F.groupOf(t.r.c, t.unit, (eng.plan.lrfNext || {}).groups)) };""", pick["crop"])
    check("they say what it would give in the unit it is sold in, and when it is picked", said and said["amount"] and said["text"].startswith(said["amount"]) and ("pick" in said["text"] or said["text"] == said["amount"]), said)

    # ── the hint card under the pointer ──
    # the planting that could go in on more than one day, brought into view
    js(page, "const b = document.querySelector('[data-hook=\"room-bar\"][data-room=\"' + CSS.escape(arg) + '\"]'); if (b) b.scrollIntoView({ block: 'center', inline: 'center' }); return null;", pick["late"]); page.wait_for_timeout(300)
    spot = js(page, "const b = document.querySelector('[data-hook=\"room-bar\"][data-room=\"' + CSS.escape(arg) + '\"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { id: b.dataset.room, x: Math.round(r.left + Math.min(8, r.width / 2)), y: Math.round(r.top + r.height / 2) };", pick["late"])
    check("a lit opening can be pointed at", spot is not None, spot)
    if spot:
        page.mouse.move(spot["x"], spot["y"]); page.wait_for_timeout(300)
        hint = js(page, """const h = hook('room-hint'), f = fitsOf(arg.crop, '').get(arg.id), bar = document.querySelector('[data-hook="room-bar"][data-room="' + CSS.escape(arg.id) + '"]'); if (!h || !f) return null;
          const t = f.t, r = t.r, hr = h.getBoundingClientRect(), flag = colour('var(--flag)');
          return { shown: drawn(h), text: h.textContent, bed: A.bedLabel(f.o.bed), go: LRFUI.day(r.field), pick: LRFUI.day(r.first), last: LRFUI.day(r.last), ring: !!bar && getComputedStyle(bar).boxShadow.includes(flag), inside: hr.left >= 0 && hr.right <= innerWidth && hr.top >= 0 && hr.bottom <= innerHeight };""", {"crop": pick["crop"], "id": spot["id"]})
        check("pointed at, the planting takes an orange ring and one hint card says where it is, that it is not planted yet, the day it goes in, when it is picked, and that a click plants it", hint and hint["shown"] and hint["ring"] and hint["inside"] and hint["bed"] in hint["text"] and "not planted yet" in hint["text"] and hint["go"] in hint["text"] and hint["pick"] in hint["text"] and hint["last"] in hint["text"] and "Click to plant it here" in hint["text"], hint)
        page.mouse.move(5, 500); page.wait_for_timeout(200)
        check("the hint goes when the pointer leaves", not js(page, "return drawn(hook('room-hint'));"))

        # ── a click plants it, through the step a drop takes ──
        before = js(page, """const f = fitsOf(arg.crop, '').get(arg.id), drop = A.preview({ cropId: arg.crop }, { bedId: f.o.bed.id, date: E.s2d(f.t.p.date) });
          return { n: S.plan.plantings.length, undo: S.undo.length, bed: f.o.bed.id, date: f.t.p.date, drop: drop.p ? { bedId: drop.p.bedId, date: drop.p.date, cropId: drop.p.cropId, ft: drop.p.ft || null, startFt: drop.p.startFt || null } : null };""", {"crop": pick["crop"], "id": spot["id"]})
        page.mouse.click(spot["x"], spot["y"]); page.wait_for_timeout(500)
        after = js(page, """const s = S.sel, p = s && s.type === 'planting' ? eng.planting(s.id) : null, toast = $('toast');
          return { n: S.plan.plantings.length, undo: S.undo.length, p: p ? { bedId: p.bedId, date: p.date, cropId: p.cropId, ft: p.ft || null, startFt: p.startFt || null } : null, toast: toast ? toast.textContent : '', still: !!S.armed && S.armed.cropId === arg };""", pick["crop"])
        check("a click plants it in that bed on the first day it can go in, as one step, exactly as a drop there would", after["n"] == before["n"] + 1 and after["undo"] == before["undo"] + 1 and after["p"] == before["drop"] and after["p"] and after["p"]["bedId"] == before["bed"] and after["p"]["date"] == before["date"], [before, after])
        check("the answer offers Undo, and the crop is still carried for the next", "Undo" in after["toast"] and after["still"], after)
        relit = js(page, "return { lit: hooks('room-opening').map(b => b.dataset.opening), has: hooks('room-opening').some(b => b.dataset.opening === arg) };", spot["id"])
        check("the opening it was planted in is lit no more", not relit["has"], relit)
        page.screenshot(path=os.path.join(shots, "room-planted.png"))
        js(page, "A.undo(); return null;"); page.wait_for_timeout(400)
        back = js(page, "return { n: S.plan.plantings.length, has: hooks('room-opening').some(b => b.dataset.opening === arg) };", spot["id"])
        check("Undo takes it out, and the opening is lit again", back["n"] == before["n"] and back["has"], back)

    # ── a garden that is shut: its band, and the weeks the crop could start ──
    shut = js(page, """const btn = [...document.querySelectorAll('#tlBody .tl-group-name')].find(b => b.closest('.tl-group') && b.firstChild && b.textContent.includes(arg.name)); if (!btn) return null; btn.click(); return true;""", {"name": pick["gardenName"]})
    page.wait_for_timeout(500)
    band = js(page, """const g = [...document.querySelectorAll('#tlBody .tl-group')].find(x => x.textContent.includes(arg.name) && x.querySelector('[data-hook="garden-band"]')); if (!g) return null;
      const b = g.querySelector('[data-hook="garden-band"]'), cells = [...b.querySelectorAll('i')], br = b.getBoundingClientRect(), gr = g.getBoundingClientRect(), name = g.querySelector('.tl-group-name').getBoundingClientRect();
      const garden = eng.plan.gardens.find(x => x.name === arg.name), beds = eng.plan.beds.filter(x => x.gardenId === garden.id && x.active !== false), y = A.planYear(), weeks = new Set();
      for (let d = new Date(y, 0, 1); d.getFullYear() === y; d = E.addDays(d, 1)) weeks.add(+E.addDays(d, -((d.getDay() + 6) % 7)));
      // the fullest and the emptiest week, counted here: the feet held on the week's middle day
      const held = d => beds.reduce((t, bed) => { const L = +eng.capOf(bed) || 0; let f = 0; for (const p of eng.plantingsIn(bed.id)) { const r = eng.calc(p); if (!r) continue; const a = eng.occupancyFrom(p, r), z = eng.occupancyThrough(p, r); if (a <= d && (z === Infinity || z >= d)) f += Math.min(L, +r.physicalLength || +r.len || L); } return t + Math.min(L, f); }, 0);
      const p = cells.map(c => parseFloat(c.style.getPropertyValue('--p')) || 0);
      const starts = [...b.querySelectorAll('[data-hook="band-start"]')].length, fits = (g.querySelector('[data-hook="band-fits"]') || {}).textContent || '';
      return { cells: cells.length, weeks: weeks.size, some: p.some(x => x > 0), none: p.some(x => x === 0) || p.every(x => x > 0), height: Math.round(br.height), under: br.top >= name.bottom - 1, inLanes: br.left >= gr.left + 140, starts, fits, titled: cells.every(c => /Week of .*% of its ground held/.test(c.title)) };""", {"name": pick["gardenName"]})
    check("a garden shut by its name shows an 8 px band under its name, one mark a week, in the lanes", band and band["cells"] == band["weeks"] and band["height"] == 8 and band["under"] and band["inLanes"] and band["some"] and band["titled"], band)
    check("while the crop is carried, an orange line under the weeks it could start for each opening it fits there, and how many on the garden's own line", band and band["starts"] == pick["inGarden"] and ("fits %d" % pick["inGarden"]) in band["fits"], [band, pick["inGarden"]])
    page.screenshot(path=os.path.join(shots, "room-shut.png"))
    # every week of the band is what holds the garden's ground, counted here by the guard rails' own list (plantings by their
    # footprint, and a bed set to rest), and a bed set to rest over weeks it held nothing in fills them
    AGREE = """const g = [...document.querySelectorAll('#tlBody .tl-group')].find(x => x.textContent.includes(arg.name) && x.querySelector('[data-hook="garden-band"]')); if (!g) return null;
      const garden = eng.plan.gardens.find(x => x.name === arg.name), beds = eng.plan.beds.filter(x => x.gardenId === garden.id && x.active !== false), y = A.planYear(), y0 = new Date(y, 0, 1), y1 = new Date(y, 11, 31), n = E.dayDiff(y1, y0) + 1;
      const held = new Float64Array(n), cap = beds.reduce((t, b) => t + (+eng.capOf(b) || 0), 0);
      for (const b of beds) { const L = +eng.capOf(b) || 0, mine = new Float64Array(n); for (const x of eng.holders(b, y0, y1, null)) { const f = x.rect, a = Math.max(0, E.dayDiff(x.from < y0 ? y0 : x.from, y0)), z = x.through === Infinity || x.through > y1 ? n - 1 : E.dayDiff(x.through, y0), ft = Math.min(L, f ? (f.a1 - f.a0) * (f.x1 - f.x0) : +x.len || L); for (let i = a; i <= z; i++) mine[i] += ft; } for (let i = 0; i < n; i++) held[i] += Math.min(L, mine[i]); }
      const want = []; for (let i = 0; i < n;) { let j = i; while (j + 1 < n && E.addDays(y0, j + 1).getDay() !== 1) j++; let t = 0; for (let k = i; k <= j; k++) t += held[k]; const sh = t / (j - i + 1) / cap; want.push(sh > 0 ? Math.round(6 + 50 * sh) : 0); i = j + 1; }
      const got = [...g.querySelector('[data-hook="garden-band"]').querySelectorAll('i')].map(c => parseFloat(c.style.getPropertyValue('--p')) || 0);
      return { got, want, off: got.map((v, i) => v === want[i] ? null : [i, v, want[i]]).filter(Boolean).slice(0, 4) };"""
    agree = js(page, AGREE, {"name": pick["gardenName"]})
    check("each week of the band is the share of the garden's ground held then, as the guard rails count it", agree and agree["got"] and not agree["off"] and len(agree["got"]) == len(agree["want"]), agree)
    rest = js(page, """const g = eng.plan.gardens.find(x => x.name === arg.name), y = A.planYear(), beds = eng.plan.beds.filter(b => b.gardenId === g.id && b.active !== false && eng.isSoilBed(b));
      for (const b of beds) { const hs = eng.holders(b, new Date(y, 0, 1), new Date(y, 11, 31), null); for (let m = 0; m < 11; m++) { const a = new Date(y, m, 1), z = new Date(y, m + 1, 0); if (!hs.some(h => h.from <= z && (h.through === Infinity || h.through >= a))) { A.updateBeds([b.id], { restPeriods: [{ from: E.d2s(a), to: E.d2s(z) }] }, 'Rest a bed'); return { bed: b.id, month: m }; } } } return null;""", {"name": pick["gardenName"]})
    page.wait_for_timeout(400)
    rested = js(page, AGREE, {"name": pick["gardenName"]}) if rest else None
    check("a bed set to rest fills the weeks it rests, as a planting does", rest and rested and not rested["off"] and sum(rested["got"]) > sum(agree["got"]), [rest, rested and rested["off"], rested and sum(rested["got"]), agree and sum(agree["got"])])
    if rest: js(page, "A.undo(); return null;"); page.wait_for_timeout(300)
    tools = js(page, "return { line: hook('room-line').getBoundingClientRect().height, wrap: document.querySelector('.tl-tools').getBoundingClientRect().height };")

    # ── Openings off: only the openings the crop fits ──
    press(page, '#tlOpenToggle', 400)
    off = js(page, "return { all: document.querySelectorAll('#tlBody .tl-open').length, lit: hooks('room-opening').length };")
    check("with Openings off, the openings the crop fits are still drawn, and no other", off["lit"] > 0 and off["all"] == off["lit"], off)

    # ── put down ──
    if not press(page, '[data-hook="room-line"] button', 400): js(page, "A.arm(null); return null;"); page.wait_for_timeout(400)
    down = js(page, "return { armed: !!S.armed, line: drawn(hook('room-line')), lit: hooks('room-opening').length, bars: hooks('room-bar').length, starts: hooks('band-start').length, quiet: $('tlBody').classList.contains('room'), open: document.querySelectorAll('#tlBody .tl-open').length, key: drawn(document.querySelector('.tl-key')), bands: hooks('garden-band').length, tools: document.querySelector('.tl-tools').getBoundingClientRect().height };")
    check("x puts it down: the line, the lit openings and the orange lines go, the key is back, the tools keep their height, and Openings off is off again", not down["armed"] and not down["line"] and down["lit"] == 0 and down["bars"] == 0 and down["starts"] == 0 and not down["quiet"] and down["open"] == 0 and down["key"] and down["bands"] >= 1 and abs(down["tools"] - tools["wrap"]) < 0.5, [down, tools])
    press(page, '#tlOpenToggle')

    # ── To place: the third side of the library's switch ──
    sw = js(page, """const btns = [...document.querySelectorAll('.library .seg button')], lib = document.querySelector('.library').getBoundingClientRect(), n = hook('lib-to-place-count');
      return { names: btns.map(b => b.childNodes[0].textContent.trim()), oneLine: new Set(btns.map(b => Math.round(b.getBoundingClientRect().height))).size === 1 && btns.every(b => b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().height < 40), inside: btns.every(b => b.getBoundingClientRect().right <= lib.right + 0.5), count: n && !n.hidden, crops: btns.some(b => b.querySelector('small') && b !== hook('lib-to-place')) };""")
    check("the library's switch reads My crops, All crops, To place, on one line, with no count while nothing waits and no count of crops", sw["names"] == ["My crops", "All crops", "To place"] and sw["oneLine"] and sw["inside"] and not sw["count"] and not sw["crops"], sw)
    sent = js(page, "const ps = S.plan.plantings.filter(p => { const r = eng.calc(p); return r && eng.isSoilBed(r.b) && !eng.isStandingCrop(p, r) && !p.done; }).slice(0, 2); for (const p of ps) A.sendToWait(p.id); return A.waiting().length;")
    page.wait_for_timeout(300)
    waits = js(page, "const n = hook('lib-to-place-count'), flag = getComputedStyle(n).backgroundColor, deep = (() => { const p = document.createElement('i'); p.style.background = 'var(--flag-deep)'; document.body.append(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; })(); return { shown: drawn(n), text: n.textContent, orange: flag === deep, chosen: hook('lib-to-place').getAttribute('aria-pressed'), crops: document.querySelectorAll('#libList .lib-row[data-crop]').length };")
    check("with plantings waiting, To place carries their count in orange, seen from the list of crops", sent == 2 and waits["shown"] and waits["text"] == "2" and waits["orange"] and waits["chosen"] == "false" and waits["crops"] > 0, [sent, waits])
    press(page, '[data-hook="lib-to-place"]')
    listed = js(page, "return { rows: hooks('waiting-row').length, lead: (hook('waiting-lead') || {}).textContent || '', crops: document.querySelectorAll('#libList .lib-row[data-crop]:not([data-waiting])').length, box: !!document.getElementById('waitBox'), pic: hooks('waiting-row').every(r => { const t = r.querySelector('.thumb'); return t && Math.round(t.getBoundingClientRect().width) === 40; }) };")
    check("chosen, the library lists what waits, a picture of 40 to a row, under one line saying it is not in the forecast; no box stands above the library", listed["rows"] == 2 and "not in the forecast" in listed["lead"] and listed["crops"] == 0 and not listed["box"] and listed["pic"], listed)
    press(page, '[data-hook="waiting-row"]')
    picked = js(page, "const r = document.querySelector('[data-hook=\"waiting-row\"].armed'), ink = colour('var(--ink)'), light = colour('var(--surface)'); return r ? { hover: r.matches(':hover'), bg: getComputedStyle(r).backgroundColor === ink, name: getComputedStyle(r.querySelector('.lib-name')).color === light, sel: S.sel && S.sel.type } : null;")
    check("a waiting planting clicked is picked, its row in ink with light words while the pointer is still on it", picked and picked["hover"] and picked["bg"] and picked["name"] and picked["sel"] == "waiting", picked)
    press(page, '[data-lib-scope="mine"]', 200)
    press(page, '#waitBadge')
    badge = js(page, "return { chosen: hook('lib-to-place').getAttribute('aria-pressed'), rows: hooks('waiting-row').length, view: S.view };")
    check("the count in the header opens To place", badge["chosen"] == "true" and badge["rows"] == 2 and badge["view"] in ("map", "timeline"), badge)
    js(page, "A.undo(); A.undo(); return null;"); page.wait_for_timeout(300)
    empty = js(page, "const n = hook('lib-to-place-count'); return { count: !n.hidden, rows: hooks('waiting-row').length, lead: (hook('waiting-lead') || {}).textContent || '', chosen: hook('lib-to-place').getAttribute('aria-pressed') };")
    check("with nothing left waiting, To place keeps its place, with no count, and says nothing waits", not empty["count"] and empty["rows"] == 0 and "Nothing waits" in empty["lead"] and empty["chosen"] == "true", empty)
    press(page, '[data-lib-scope="mine"]', 200)
    page.screenshot(path=os.path.join(shots, "room-end.png"))
    # a crop with varieties, picked and opened: everything on its row stays light on the ink, the pointer on it or not
    js(page, "A.arm(null); const b = document.querySelector('#libList .lib-crop:not(.open) > .lib-row button.lib-more'); if (b) b.closest('.lib-row').scrollIntoView({ block: 'center' }); return null;"); page.wait_for_timeout(200)
    crop = js(page, "const b = document.querySelector('#libList .lib-crop:not(.open) > .lib-row button.lib-more'); return b ? b.closest('.lib-row').dataset.crop : null;")
    if crop:
        press(page, '#libList .lib-row[data-crop="%s"]:not(.lib-var) .lib-name' % crop, 200)
        press(page, '#libList .lib-row[data-crop="%s"]:not(.lib-var) button.lib-more' % crop, 200)
    LIGHT = "const r = document.querySelector('#libList .lib-row.armed:not(.lib-var)'), light = colour('var(--surface)'); return r ? { open: !!r.closest('.lib-crop.open'), hover: r.matches(':hover'), parts: [...r.querySelectorAll('.lib-name, .lib-count, button.lib-more')].map(e => getComputedStyle(e).color === light) } : null;"
    page.mouse.move(5, 5); page.wait_for_timeout(150)
    away = js(page, LIGHT)
    box = page.locator('#libList .lib-row.armed:not(.lib-var)').first.bounding_box() if crop else None
    if box: page.mouse.move(box["x"] + 30, box["y"] + box["height"] / 2); page.wait_for_timeout(150)
    over = js(page, LIGHT)
    check("a picked crop opened to its varieties keeps its name, count and triangle light on the ink, the pointer on it or away", crop and away and over and away["open"] and over["hover"] and all(away["parts"]) and all(over["parts"]) and len(away["parts"]) == 3, [crop, away, over])
    js(page, "A.arm(null); return null;"); page.wait_for_timeout(200)
    check("no error on the page", not errors, errors[:3])
    check("the check ran to its end", True)

# A fault that leaves something out can make a step of this check throw: then the line below fails by name, and the lines run so far stand.
with sync_playwright() as pw:
    try: run(pw)
    except Exception as e: check("the check ran to its end", False, str(e)[:300])
    finish()
