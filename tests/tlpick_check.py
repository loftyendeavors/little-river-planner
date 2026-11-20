"""The Timeline shows the bed the card is showing (#88), in a real browser, and an opening's way back to its bed.
A bed picked is edged in orange along its Timeline row; the planting row open in the bed's season (in the side panel with the card
off, in the card with it on) has its bar ringed, and the ring follows as rows are opened and closed. Going to the Timeline, or a pick
made anywhere but on the Timeline, brings the row into view when none of it could be seen, up or down only; a row that shows at all is
left where it is. An opening's panel leads with "‹" and the bed's name as the way back, and opened from the bed's card it goes back to
that card; "Everything in ..." is no longer at its foot.
Every subject is found on the plan the page was given: nothing here names a crop, a bed, a garden or a number of any plan.
usage: python3 -I tlpick_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1707, STOP_AT_FAIL=1
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
# What the page shows of the pick, read from what is drawn: the rows edged in orange (a line along a row's top and bottom, drawn on that
# row and as tall as it, not on the Timeline round it: Codex on #89), the bars ringed in
# orange, where the row of a bed stands in the Timeline's window, and the Timeline's scroll.
PRE = ("const A = LRFApp, S = A.state, eng = S.engine, sc = document.getElementById('tlScroll');"
       "const sleep = ms => new Promise(r => setTimeout(r, ms));"
       "const hook = n => document.querySelector('[data-hook=\"' + n + '\"]');"
       "const drawn = el => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';"
       "const flag = (() => { const d = document.createElement('i'); d.style.color = 'var(--flag)'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; })();"
       "const rowOf = id => document.querySelector('#tlBody [data-hook=\"tl-space\"][data-bed=\"' + CSS.escape(id) + '\"]');"
       "const barOf = id => document.querySelector('#tlBody [data-hook=\"tl-planting\"][data-planting=\"' + CSS.escape(id) + '\"]');"
       "const edged = () => [...document.querySelectorAll('#tlBody [data-hook=\"tl-space\"]')].filter(r => { const a = getComputedStyle(r, '::after'), h = r.getBoundingClientRect().height; return a.borderTopWidth === '2px' && a.borderTopColor === flag && a.borderBottomColor === flag && a.top === '0px' && parseFloat(a.height) >= h - 2 && parseFloat(a.height) <= h; }).map(r => r.dataset.bed);"
       "const ringed = () => [...document.querySelectorAll('#tlBody [data-hook=\"tl-planting\"]')].filter(b => getComputedStyle(b).boxShadow.includes(flag)).map(b => b.dataset.planting);"
       "const seen = id => { const r = rowOf(id); if (!r) return null; const b = r.getBoundingClientRect(), v = sc.getBoundingClientRect(), top = v.top + sc.querySelector('.tl-head').offsetHeight, bottom = v.top + sc.clientHeight; return b.bottom > top && b.top < bottom; };"
       "const at = () => ({ top: Math.round(sc.scrollTop), left: Math.round(sc.scrollLeft) });")
def run_js(page, body, arg=None):
    return page.evaluate("async (arg) => { %s %s }" % (PRE, body), arg)

def run(pw):
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    page = browser.new_context(viewport={"width": WIDTH, "height": 960}).new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    js = lambda body, arg=None: run_js(page, body, arg)
    wait = page.wait_for_timeout
    def open_page():
        page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=20000)
        if backup and page.evaluate("LRFApp.isSample()"):
            page.set_input_files("#importFile", backup); wait(400)
            if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
            page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); wait(1500)
    open_page()
    page.evaluate("try { localStorage.removeItem('lrf.tryCard'); } catch (_) {}")
    open_page()

    # ── the subjects: field beds whose plantings are drawn as bars of their own, with an opening; the lowest on the Timeline, and another ──
    pick = js("""A.setView('timeline'); await sleep(700); sc.scrollTop = 0; await sleep(200);
      const fits = [...document.querySelectorAll('#tlBody [data-hook="tl-space"]')].map(row => {
        const b = eng.bedOf(row.dataset.bed);
        if (!b || !eng.isSoilBed(b) || b.active === false || !LRFCard.bedSeasonOn(b) || !LRFSuccession.openings(eng, { bedId: b.id }).length) return null;
        const own = eng.plantingsIn(b.id).filter(p => eng.calc(p) && barOf(p.id) && barOf(p.id).closest('[data-hook="tl-space"]') === row).map(p => p.id);
        return own.length >= 2 ? { bed: b.id, label: A.bedLabel(b), own, y: Math.round(row.getBoundingClientRect().top) } : null;
      }).filter(Boolean).sort((a, b) => a.y - b.y);
      const low = fits[fits.length - 1], other = fits.find(x => x !== low && x.y > sc.getBoundingClientRect().top + sc.clientHeight + 200);
      return low && other && !seen(low.bed) && !seen(other.bed) ? { low, other, left: at().left } : null;""")
    check("the plan has two field beds out of sight on the Timeline, each with an opening and two plantings drawn as bars of their own, for the check to work on", bool(pick), pick)
    if not pick: finish()
    BED, P1, P2, OTHER = pick["low"]["bed"], pick["low"]["own"][0], pick["low"]["own"][1], pick["other"]["bed"]
    arg = {"bed": BED, "p1": P1, "p2": P2, "other": OTHER, "label": pick["low"]["label"]}

    # ══ the card off: the bed's season stands in the side panel ══
    # zoomed in, so the year runs past the window and there is a date across to keep
    went = js("""LRFTimeline.setScale(LRFTimeline.scale() * 4); await sleep(400); sc.scrollLeft = Math.round((sc.scrollWidth - sc.clientWidth) / 2); sc.scrollTop = 0; await sleep(200); const before = at();
      A.setView('map'); await sleep(300); A.select({ type: 'bed', id: arg.bed }); await sleep(300);
      A.setView('timeline'); await sleep(800);
      return { edged: edged(), ringed: ringed(), seen: seen(arg.bed), before, after: at() };""", arg)
    check("a bed picked on the Map is edged in orange along its Timeline row, and no other row is; no bar is ringed while no planting is open", went["edged"] == [BED] and went["ringed"] == [], went)
    check("going to the Timeline with that bed picked, its row out of sight, brings the row into view", went["seen"] is True and went["after"]["top"] > went["before"]["top"], went)
    check("it is brought into view up or down only: the date across stays where it was", went["before"]["left"] > 0 and went["after"]["left"] == went["before"]["left"], went)

    rows = js("""const trig = id => document.querySelector('.inspector [data-hook="card-planting"][data-planting="' + CSS.escape(id) + '"]');
      const out = {}; if (!trig(arg.p1)) return { none: true };
      trig(arg.p1).click(); await sleep(300); out.one = ringed();
      trig(arg.p2).click(); await sleep(300); out.two = ringed();
      trig(arg.p2).click(); await sleep(300); out.shut = ringed(); out.edged = edged();
      return out;""", arg)
    check("with the card off, opening one of the bed's plantings in the side panel rings its bar on the Timeline, and no other bar", rows.get("one") == [P1], rows)
    check("opening another of its plantings moves the ring to that one's bar", rows.get("two") == [P2], rows)
    check("closing the open row takes the ring away, and the bed stays edged", rows.get("shut") == [] and rows.get("edged") == [BED], rows)
    # the Timeline hears a new pick before the card has let go of the row it had open: the ring must not stay on the first bed's planting
    moved = js("""const trig = id => document.querySelector('.inspector [data-hook="card-planting"][data-planting="' + CSS.escape(id) + '"]');
      if (!trig(arg.p1)) return { none: true };
      trig(arg.p1).click(); await sleep(300); const open = ringed();
      A.select({ type: 'bed', id: arg.other }); await sleep(400);
      return { open, ringed: ringed(), edged: edged() };""", arg)
    check("with a planting open in the bed's season, another bed picked takes the ring off it: only the new bed is edged", moved.get("open") == [P1] and moved.get("ringed") == [] and moved.get("edged") == [OTHER], moved)

    far = js("""A.select(null); await sleep(150); sc.scrollTop = 0; await sleep(200); const before = at(), hidden = seen(arg.bed);
      A.select({ type: 'bed', id: arg.bed }); await sleep(400);
      return { hidden, seen: seen(arg.bed), edged: edged(), before, after: at() };""", arg)
    check("a bed picked from elsewhere while the Timeline is shown (as from the card), its row out of sight, is brought into view, up or down only", far["hidden"] is False and far["seen"] is True and far["edged"] == [BED] and far["before"]["left"] > 0 and far["after"]["left"] == far["before"]["left"], far)

    edge = js("""A.select(null); await sleep(150);
      const r = rowOf(arg.other), v = sc.getBoundingClientRect(), bottom = v.top + sc.clientHeight;
      sc.scrollTop += r.getBoundingClientRect().top - (bottom - 10); await sleep(250);
      const before = at(), part = seen(arg.other);
      A.select({ type: 'bed', id: arg.other }); await sleep(400);
      return { part, before, after: at(), edged: edged() };""", arg)
    check("a bed picked from elsewhere whose row shows at all, if only its edge, is left where it is: nothing jumps", edge["part"] is True and edge["after"] == edge["before"] and edge["edged"] == [OTHER], edge)

    plant = js("""A.select(null); await sleep(150); sc.scrollTop = 0; await sleep(200); const before = at(), hidden = seen(arg.bed);
      A.select({ type: 'planting', id: arg.p1 }); await sleep(400);
      return { hidden, seen: seen(arg.bed), ringed: ringed(), before, after: at() };""", arg)
    check("a planting picked from elsewhere, its row out of sight, is ringed and brought into view, up or down only", plant["hidden"] is False and plant["seen"] is True and plant["ringed"] == [P1] and plant["before"]["left"] > 0 and plant["after"]["left"] == plant["before"]["left"], plant)

    # ── hidden by the Timeline's own settings, kept by the browser: its kind filtered out, its garden closed (Codex on #89) ──
    hid = js("""const T = LRFTimeline, P = T.prefs(), g = eng.gardenOf(eng.bedOf(arg.bed)).id;
      A.select(null); await sleep(150);
      let left = null;
      for (const k of ['field', 'cover', 'tower', 'crate']) { T.setFilter(k); await sleep(300); if (!rowOf(arg.bed)) { left = k; break; } }
      const out = { left };
      if (left) {
        A.setView('map'); await sleep(300); A.select({ type: 'bed', id: arg.bed }); await sleep(300);
        A.setView('timeline'); await sleep(800);
        out.filtered = { row: !!rowOf(arg.bed), edged: edged(), seen: seen(arg.bed) };
      }
      T.setFilter('all'); await sleep(300); A.select(null); await sleep(150);
      P.shut['field:' + g] = true; P.shut['cover:' + g] = true; T.setFilter('field'); T.setFilter('all'); await sleep(400);
      out.shutRow = !!rowOf(arg.bed);
      A.select({ type: 'bed', id: arg.bed }); await sleep(500);
      out.shut = { row: !!rowOf(arg.bed), edged: edged(), seen: seen(arg.bed) };
      delete P.shut['field:' + g]; delete P.shut['cover:' + g]; T.setFilter('field'); T.setFilter('all'); await sleep(300);
      return out;""", arg)
    f = hid.get("filtered") or {}
    check("with the Timeline filtered to another kind of space, going to it with a bed picked opens its kind, and its row is edged and in view", bool(hid.get("left")) and f.get("row") and f.get("edged") == [BED] and f.get("seen") is True, hid)
    s = hid.get("shut") or {}
    check("with the bed's garden closed on the Timeline, a bed picked from elsewhere opens its garden, and its row is edged and in view", hid.get("shutRow") is False and s.get("row") and s.get("edged") == [BED] and s.get("seen") is True, hid)

    # ══ the card on ══
    page.evaluate("try { localStorage.setItem('lrf.tryCard', '1'); } catch (_) {}")
    open_page()
    away = js("""A.setView('timeline'); await sleep(700); A.select({ type: 'bed', id: arg.bed }); await sleep(400);
      A.setView('map'); await sleep(400);
      const trig = id => document.querySelector('[data-hook="card"] [data-hook="card-planting"][data-planting="' + CSS.escape(id) + '"]');
      if (!drawn(hook('card')) || !trig(arg.p1)) return { card: drawn(hook('card')), row: !!trig(arg.p1) };
      trig(arg.p1).click(); await sleep(300);
      A.setView('timeline'); await sleep(800);
      const one = ringed(), seenNow = seen(arg.bed);
      trig(arg.p2).click(); await sleep(300);
      return { card: true, one, seen: seenNow, two: ringed(), edged: edged() };""", arg)
    check("with the card on, a planting opened in the bed's card on the Map is ringed on the Timeline when it is next shown", away.get("one") == [P1] and away.get("seen") is True, away)
    check("on the Timeline, opening another of the bed's plantings in the docked card moves the ring to it, the bed still edged", away.get("two") == [P2] and away.get("edged") == [BED], away)

    back = js("""const op = document.querySelector('[data-hook="card"] [data-hook="card-opening"]');
      if (!op) return { opening: false };
      op.click(); await sleep(400);
      const b = hook('opening-back'), head = b && b.closest('header');
      const out = { opening: S.sel && S.sel.type, first: !!head && head.firstElementChild === b, text: b ? b.textContent : null,
        foot: (document.querySelector('.inspector') || document.body).innerText.includes('Everything in') };
      if (!b) return out;
      b.click(); await sleep(400);
      return { ...out, sel: S.sel, card: drawn(hook('card')), edged: edged() };""", arg)
    check("an opening of the bed's card opens with the way back first in its head: ‹ and the bed's name", back.get("opening") == "opening" and back.get("first") and bool(back.get("text")) and back["text"].startswith("‹") and pick["low"]["label"] in back["text"], back)
    check("and the old way back, “Everything in …” at its foot, is gone", back.get("opening") == "opening" and back.get("foot") is False, back)
    check("the way back goes back to the bed's card", isinstance(back.get("sel"), dict) and back["sel"].get("type") == "bed" and back["sel"].get("id") == BED and not back["sel"].get("fromBedSeason") and back.get("card") and back.get("edged") == [BED], back)

    page.screenshot(path=str(shots / "tlpick.png"))
    check("no error on the page", not [e for e in errors if "pageerror" in e], errors[:4])
    page.evaluate("try { localStorage.removeItem('lrf.tryCard'); } catch (_) {}")
    browser.close()

try:
    with sync_playwright() as pw: run(pw)
except Exception as e:
    check("the check ran to its end", False, repr(e)[:600])
finish()
