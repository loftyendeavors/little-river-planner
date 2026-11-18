"""The card, part 1 (redesign build 5), in a real browser, behind its tick "Try the card".
Off (as the page opens with nothing kept): nothing of the card is drawn, the side panel holds a bed and a planting as before.
The tick is in the Map's "?", and the browser keeps it across a reload. On: on the Map and the Timeline the side panel leaves; a
bed or a planting picked opens one floating card; the bed's name in a planting's card is the way back; x closes. Every change made
through the card gives the planting the panel's own control gives it, for a date, a variety, a share of the bed and "Grown for sale",
and its Undo gives the plan back. A drop is answered on the card, not in a toast. The menu (the card's "..." and a right-click), the
calendar and the hint on a bar. What the card does not hold stands in the side panel. To place's two lines, in his words of Nov 17.
Every subject is found on the plan the page was given: nothing here names a crop, a bed, a garden or a number of any plan.
usage: python3 -I trycard_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1707, STOP_AT_FAIL=1
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
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, $ = id => document.getElementById(id), eng = S.engine;"
       "const hook = n => document.querySelector('[data-hook=\"' + n + '\"]'), hooks = n => [...document.querySelectorAll('[data-hook=\"' + n + '\"]')];"
       "const drawn = el => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';"
       "const card = () => hook('card'), shown = () => drawn(card()), panel = () => drawn(document.querySelector('.inspector'));"
       "const rec = id => JSON.stringify(S.plan.plantings.find(p => p.id === id) || null), all = () => JSON.stringify(S.plan.plantings);"
       "const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');")
def run_js(page, body, arg=None):
    return page.evaluate("(arg) => { %s %s }" % (PRE, body), arg)
def press(page, selector, ms=300, button="left"):
    """A thing a fault has taken away is not pressed: the named line after it fails, and the check goes on."""
    hit = page.locator(selector)
    if not hit.count() or not hit.first.is_visible(): return False
    hit.first.click(timeout=3000, button=button); page.wait_for_timeout(ms); return True

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

    # ── the subjects: a field bed with three plantings or more and an opening, a planting in it with a variety and another variety to swap to ──
    pick = js("""const S2 = LRFSuccession;
      for (const b of S.plan.beds) {
        if (!eng.isSoilBed(b) || b.active === false) continue;
        const list = eng.plantingsIn(b.id).filter(p => { const r = eng.calc(p); return r && !eng.isPool(r.b); });
        if (list.length < 3 || !S2.openings(eng, { bedId: b.id }).length) continue;
        const p = list.find(p => { const r = eng.calc(p), f = eng.footprint(p, r); return p.varietyId && !LRFForecast.useOf(eng, p).personal && eng.varietiesOf(p.cropId).length >= 2 && r.cap >= 8 && !r.layout && f && !(f.rows && f.rows.count < f.rows.total); });
        if (!p) continue;
        return { bed: b.id, bedName: String(b.bed), label: A.bedLabel(b), n: eng.plantingsIn(b.id).filter(q => eng.calc(q)).length, open: S2.openings(eng, { bedId: b.id }).length, p: p.id, crop: p.cropId, other: eng.varietiesOf(p.cropId).find(v => v.id !== p.varietyId).id, cap: eng.calc(p).cap, date: p.date, title: eng.calc(p).c.vname || eng.calc(p).c.name };
      } return null;""")
    check("the plan has a field bed with three plantings or more and an opening, and in it a planting whose variety can be changed, for the check to work on", bool(pick), pick)
    if not pick: finish()
    BED, PID = pick["bed"], pick["p"]

    # ══ off ══
    off = js(f"""A.setView('map'); A.select({{ type: 'bed', id: '{BED}' }}); await new Promise(r => setTimeout(r, 400));
      const bed = {{ card: !!card(), panel: panel(), dims: !!$('bedDims'), attr: document.body.dataset.card || null }};
      A.select({{ type: 'planting', id: '{PID}' }}); await new Promise(r => setTimeout(r, 400));
      const pl = {{ card: !!card(), panel: panel(), date: !!$('fDate') }};
      let kept = 'x'; try {{ kept = localStorage.getItem('lrf.tryCard'); }} catch (_) {{}}
      A.select(null); return {{ bed, pl, kept, on: LRFCard.on() }};""".replace("await new Promise(r => setTimeout(r, 400));", "") )
    check("off, as the page opens with nothing kept: a bed and a planting open in the side panel as before, and nothing of the card is drawn",
          off and not off["bed"]["card"] and off["bed"]["panel"] and off["bed"]["dims"] and not off["bed"]["attr"] and not off["pl"]["card"] and off["pl"]["panel"] and off["pl"]["date"] and off["kept"] is None and not off["on"], off)

    # ══ the tick, in the Map's "?" ══
    press(page, "#mapHelp", 400)
    tick = js("const t = hook('card-try'), c = $('mapHelpCard'); return { there: !!t && !!c && c.contains(t), checked: t ? t.checked : null, said: t ? t.closest('dd').previousElementSibling.textContent : '' };")
    check("the Map's “?” holds a tick, “Try the card”, not ticked", tick["there"] and tick["checked"] is False and tick["said"] == "Try the card", tick)
    press(page, "[data-hook='card-try']", 400)
    turned = js("let kept = null; try { kept = localStorage.getItem('lrf.tryCard'); } catch (_) {} return { kept, attr: document.body.dataset.card || null, panel: panel(), card: !!card() };")
    check("ticked: the browser keeps it, and with nothing picked there is no side panel and no card", turned["kept"] == "1" and turned["attr"] == "on" and not turned["panel"] and not turned["card"], turned)
    page.keyboard.press("Escape"); wait(200)
    open_page(); wait(300)
    again = js("return { on: LRFCard.on(), attr: document.body.dataset.card || null, panel: panel() };")
    check("the tick is still on after the page is opened again", again["on"] and again["attr"] == "on" and not again["panel"], again)

    # ══ the Map: a bed's card ══
    js(f"A.setView('map'); A.select(null); return null;"); wait(500)
    box = js(f"const el = document.querySelector('#map [data-bed=\"{BED}\"]'); if (!el) return null; const r = el.getBoundingClientRect(); return {{ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }};")
    if box: page.mouse.click(box["x"], box["y"]); wait(500)
    bed = js(f"""const c = card(); if (!c) return null; const r = c.getBoundingClientRect(), v = $('mapView').getBoundingClientRect(), t = document.querySelector('.map-tools').getBoundingClientRect(), use = LRFForecast.useOfBed(eng, eng.bedOf('{BED}'));
      return {{ kind: c.dataset.kind, title: hook('card-title').textContent, rows: hooks('card-planting').length, opens: hooks('card-opening').length, year: drawn(hook('card-year')), layout: drawn(hook('card-layout')), sale: hook('card-sale') ? hook('card-sale').checked : null, saleWant: !use.personal,
        panel: panel(), sel: S.sel && S.sel.id, w: Math.round(r.width), inside: r.left >= v.left && r.right <= v.right + 1 && r.top >= t.bottom && r.bottom <= v.bottom + 1, right: Math.round(v.right - r.right), radius: getComputedStyle(c).borderTopLeftRadius }};""")
    check("a click on a bed on the map opens its card in place of the side panel: the bed's name, Edit layout as a button, the bed's year, its plantings and its openings, Grown for sale as a tick",
          bool(bed) and bed["kind"] == "bed" and bed["title"].endswith(" " + pick["bedName"]) and bed["rows"] == pick["n"] and bed["opens"] == pick["open"] and bed["year"] and bed["layout"] and bed["sale"] == bed["saleWant"] and not bed["panel"] and bed["sel"] == BED, [bed, pick])
    check("the card floats at the top right of the map, under its tools, inside the map, 340 wide, on a corner of 20", bool(bed) and bed["inside"] and bed["w"] == min(340, WIDTH) and 8 <= bed["right"] <= 16 and bed["radius"] == "20px", bed)
    page.screenshot(path=str(shots / f"map-bed-{WIDTH}.png"))

    # a planting from the bed's card, the bed's name back, x to close
    press(page, f"[data-hook='card-planting'][data-planting='{PID}']", 400)
    pl = js(f"""const c = card(), p = S.plan.plantings.find(x => x.id === '{PID}'); if (!c) return null;
      return {{ kind: c.dataset.kind, title: hook('card-title').textContent, bed: hook('card-bed') ? hook('card-bed').textContent : '', date: hook('card-date') ? hook('card-date').textContent : '', want: LRFUI.day(E.s2d(p.date)), variety: hook('card-variety') ? hook('card-variety').value : null, bar: drawn(hook('card-bar')), sums: hook('card-sums') ? hook('card-sums').textContent : '', rows: hooks('card-row').map(x => x.dataset.row), panel: panel() }};""")
    check("a planting in the bed's card opens the planting's card: its name, the bed's name, its life as a bar, what it comes to, its date and variety, its rows",
          bool(pl) and pl["kind"] == "planting" and pl["title"] == pick["title"] and pl["bed"] == pick["label"] and pl["date"] == pl["want"] and pl["variety"] and pl["bar"] and len(pl["sums"]) > 4 and pl["rows"] == ["share", "days", "nursery", "repeat"] and not pl["panel"], pl)
    page.screenshot(path=str(shots / f"map-planting-{WIDTH}.png"))
    press(page, "[data-hook='card-bed']", 400)
    back = js("return { kind: card() && card().dataset.kind, sel: S.sel && S.sel.type + ':' + S.sel.id };")
    check("the bed's name in a planting's card goes back to the bed's card", back["kind"] == "bed" and back["sel"] == "bed:" + BED, back)
    press(page, "[data-hook='card-close']", 400)
    closed = js("return { card: !!card(), sel: S.sel, panel: panel() };")
    check("× closes the card, and with nothing picked there is no side panel", not closed["card"] and closed["sel"] is None and not closed["panel"], closed)

    # ══ the Timeline: a bar, a row ══
    js("A.setView('timeline'); A.select(null); return null;"); wait(800)
    js("for (let k = 0; k < 60; k++) { const b = document.querySelector('#tlBody .tl-group-name[aria-expanded=\"false\"]'); if (!b) break; b.click(); } return null;"); wait(300)
    tb = js("""const v = $('timelineView').getBoundingClientRect(); const bar = [...document.querySelectorAll('#tlBody .tl-bar[data-planting]')].find(b => { const r = b.getBoundingClientRect(); const p = eng.planting(b.dataset.planting), x = p && eng.calc(p); return x && !eng.isPool(x.b) && r.width > 40 && r.top > v.top + 140 && r.bottom < v.bottom - 260 && r.right < v.right - 420; });
      if (!bar) return null; const r = bar.getBoundingClientRect(); return { id: bar.dataset.planting, x: Math.round(r.left + Math.min(20, r.width / 2)), y: Math.round(r.top + r.height / 2), bed: eng.planting(bar.dataset.planting).bedId };""")
    check("the Timeline has a bar clear of where the card stands, for the check to click", bool(tb), tb)
    if tb:
        page.mouse.click(tb["x"], tb["y"]); wait(500)
        t1 = js("const c = card(); return { kind: c && c.dataset.kind, sel: S.sel && S.sel.id, panel: panel(), top: c ? Math.round(c.getBoundingClientRect().top - document.querySelector('.tl-tools').getBoundingClientRect().bottom) : null };")
        check("on the Timeline a click on a bar opens the planting's card under the Timeline's tools, in place of the side panel", t1["kind"] == "planting" and t1["sel"] == tb["id"] and not t1["panel"] and t1["top"] is not None and 4 <= t1["top"] <= 12, t1)
        page.screenshot(path=str(shots / f"timeline-planting-{WIDTH}.png"))
        press(page, "[data-hook='card-bed']", 400)
        t2 = js("return { kind: card() && card().dataset.kind, sel: S.sel && S.sel.type + ':' + S.sel.id };")
        check("on the Timeline the bed's name goes back to the bed's card", t2["kind"] == "bed" and t2["sel"] == "bed:" + tb["bed"], t2)
        press(page, "[data-hook='card-close']", 300)
        # the hint on a bar, in place of its hover text
        page.mouse.move(tb["x"], tb["y"]); wait(800)
        hn = js(f"const h = hook('card-hint'), b = document.querySelector('#tlBody .tl-bar[data-planting=\"{tb['id']}\"]'), p = eng.planting('{tb['id']}'), r = eng.calc(p); return {{ hint: drawn(h), text: h ? h.textContent : '', crop: r.c.name, title: b ? b.getAttribute('title') : 'gone', field: LRFUI.day(r.field) }};")
        check("held over a bar, a hint card says what it is (its crop, its days, how to open it), and the bar's own hover text is held back", hn["hint"] and hn["crop"] in hn["text"] and hn["field"] in hn["text"] and "right-click for more" in hn["text"] and hn["title"] is None, hn)
        page.mouse.move(5, 300); wait(300)
        hn2 = js(f"const b = document.querySelector('#tlBody .tl-bar[data-planting=\"{tb['id']}\"]'); return {{ hint: !!hook('card-hint'), title: b ? b.getAttribute('title') : null }};")
        check("the pointer gone, the hint goes and the bar's hover text is back", not hn2["hint"] and bool(hn2["title"]), hn2)
        # the right-click menu
        page.mouse.click(tb["x"], tb["y"], button="right"); wait(400)
        mn = js("const m = hook('card-menu'); return { menu: drawn(m), acts: hooks('card-menu-item').map(x => x.dataset.act), sel: S.sel && S.sel.id, card: card() && card().dataset.kind };")
        check("a right-click on a bar opens the card's menu where the pointer is: Open, Change the date…, All of this planting…, Send to To place, Remove planting; the planting is picked",
              mn["menu"] and all(a in mn["acts"] for a in ["open", "date", "full", "wait", "remove"]) and mn["sel"] == tb["id"] and mn["card"] == "planting", mn)
        page.screenshot(path=str(shots / f"timeline-menu-{WIDTH}.png"))
        press(page, "[data-hook='card-menu-item'][data-act='date']", 400)
        cl = js("return { menu: !!hook('card-menu'), cal: drawn(hook('card-cal')), days: hooks('card-cal-day').length };")
        check("“Change the date…” in the menu opens the calendar", not cl["menu"] and cl["cal"] and cl["days"] >= 28, cl)
        page.keyboard.press("Escape"); wait(200)
        check("Escape closes the calendar", not js("return !!hook('card-cal');"))
    js("A.setView('map'); A.select(null); return null;"); wait(500)

    # ══ the same result as the side panel, and Undo, for a date, a variety, a share of the bed and Grown for sale ══
    def set_value(selector, value):
        """A box given a value and left, once: one change, as a hand makes it."""
        page.evaluate("([s, v]) => { const el = document.querySelector(s); if (!el) return; el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }", [selector, value])
    def quiet():
        page.evaluate("document.getElementById('toast').classList.remove('show')")
    def through_panel(do):
        js("LRFCard.turn(false); return null;"); js(f"A.select({{ type: 'planting', id: '{PID}' }}); return null;"); wait(400)
        before = js("return all();")
        do(); wait(500)
        after = js(f"return rec('{PID}');")
        js("A.undo(); return null;"); wait(400)
        back = js("return all();") == before
        return after, back, before
    def through_card(do, undo_link=True):
        js("LRFCard.turn(true); return null;"); js(f"A.select({{ type: 'planting', id: '{PID}' }}); return null;"); wait(400)
        before = js("return all();")
        quiet(); do(); wait(500)
        after = js(f"return rec('{PID}');")
        said = js("const s = hook('card-said'); return { said: drawn(s) ? s.textContent : '', undo: drawn(hook('card-undo')), toast: $('toast').classList.contains('show') };")
        if undo_link and said["undo"]: press(page, "[data-hook='card-undo']", 500)
        else: js("A.undo(); return null;"); wait(400)
        back = js("return all();") == before
        return after, back, said, before
    target_day = js(f"const d = E.addDays(E.s2d('{pick['date']}'), 5); return iso(d);")
    def panel_date():
        set_value("#fDate", target_day)
    def card_date():
        press(page, "[data-hook='card-date']", 300)
        if not page.locator(f"[data-hook='card-cal-day'][data-day='{target_day}']").count(): press(page, ".card-cal-month .icon-btn >> nth=1", 200)
        hit = page.locator(f"[data-hook='card-cal-day'][data-day='{target_day}']")
        if hit.count():
            hit.first.hover(); wait(200)
            says = js("const s = hook('card-cal-says'); return s ? s.textContent : '';")
            check("pointed at, a day of the calendar says what it would move before it is picked: the day, how far, the first pick and the ground free", "5 days later" in says and "first pick" in says and "ground free" in says, says)
            hit.first.click(); wait(300)
    a, aback, _ = through_panel(panel_date)
    b, bback, bsaid, _ = through_card(card_date)
    check("a date picked on the card's calendar gives the planting what the panel's date box gives it", a == b and a != js(f"return rec('{PID}');") and target_day in (b or ""), [a, b])
    check("the card's change of date is answered on the card, “Saved” with Undo, and not in a toast as well", "Saved" in bsaid["said"] and bsaid["undo"] and not bsaid["toast"], bsaid)
    check("Undo on the card after its change of date gives the plan back as it was (and so does the panel's)", aback and bback, [aback, bback])

    def panel_variety(): page.select_option("#fVariety", pick["other"])
    def card_variety(): page.select_option("[data-hook='card-variety']", pick["other"])
    a, aback, _ = through_panel(panel_variety)
    b, bback, bsaid, _ = through_card(card_variety)
    check("a variety chosen on the card gives the planting what the panel's variety box gives it, and Undo gives the plan back", a == b and pick["other"] in (b or "") and aback and bback, [a, b, aback, bback])

    half = js(f"const p = eng.planting('{PID}'), r = eng.calc(p); let n = Math.round(r.cap * 0.4); if (Math.abs(n - r.physicalLength) < 1) n = Math.round(r.cap * 0.6); return n;")
    def panel_length(): set_value("#fLength", str(half))
    def card_length():
        if not page.locator("[data-hook='card-length']").count(): press(page, "[data-hook='card-row'][data-row='share'] .card-row-head", 300)
        set_value("[data-hook='card-length']", str(half))
    a, aback, _ = through_panel(panel_length)
    b, bback, bsaid, _ = through_card(card_length)
    check("a share of the bed typed in the card's row gives the planting what the panel's length box gives it, and Undo gives the plan back", a == b and a != js(f"return rec('{PID}');") and aback and bback, [a, b, aback, bback])

    def panel_sale(): press(page, "#fUse button[data-use='personal']", 300)
    def card_sale(): page.locator("[data-hook='card-sale']").uncheck(); wait(200)
    a, aback, _ = through_panel(panel_sale)
    b, bback, bsaid, _ = through_card(card_sale)
    check("“Grown for sale” unticked on the card gives the planting what the panel's “Personal use” gives it, and Undo gives the plan back", a == b and '"use":"personal"' in (b or "") and aback and bback, [a, b, aback, bback])
    check("its answer, with what it does to the season's worth, is said on the card with Undo, and not in a toast as well", "season’s worth" in bsaid["said"] and bsaid["undo"] and not bsaid["toast"], bsaid)

    # ══ a drop: answered on the card ══
    js("LRFCard.turn(true); A.setView('map'); A.select(null); return null;"); wait(400); quiet()
    drop = js("""const before = all(), date = S.date; let bed = null, crop = null;
      const c = S.plan.plantings.map(p => eng.crop(p.cropId)).find(c => c && eng.varietiesOf(c.id).length >= 2 && +c.dtm > 0 && !c.micro);
      if (!c) return null; let p = null;
      for (const b of S.plan.beds) { if (b.active === false || !eng.isSoilBed(b) || eng.plantingsIn(b.id).length) continue; p = A.place({ cropId: c.id }, b.id, date); if (p) { bed = b; break; } }
      if (!p) return { placed: false };
      return { placed: true, id: p.id, before, crop: c.name };""")
    wait(400)
    if drop and drop.get("placed"):
        dr = js(f"const s = hook('card-said'), v = hook('card-variety'); return {{ kind: card() && card().dataset.kind, sel: S.sel && S.sel.id, said: drawn(s) ? s.textContent : '', undo: drawn(hook('card-undo')), toast: $('toast').classList.contains('show'), ask: !!v && v.classList.contains('ask') && !v.value }};")
        check("a crop dropped on a bed opens its planting's card, which says what was planted with Undo; no toast; the variety box is ringed when no variety came with it",
              dr["kind"] == "planting" and dr["sel"] == drop["id"] and drop["crop"] in dr["said"] and dr["undo"] and not dr["toast"] and dr["ask"], dr)
        page.screenshot(path=str(shots / f"map-drop-{WIDTH}.png"))
        press(page, "[data-hook='card-undo']", 500)
        un = js(f"return {{ same: all() === {json.dumps(drop['before'])}, sel: S.sel, card: !!card() }};")
        check("Undo on the card takes the drop back: the plan is as it was, and the card closes", un["same"] and un["sel"] is None and not un["card"], un)
    else:
        check("a crop dropped on a bed opens its planting's card, which says what was planted with Undo; no toast; the variety box is ringed when no variety came with it", False, drop)
        check("Undo on the card takes the drop back: the plan is as it was, and the card closes", False, drop)

    # ══ what the card does not hold stands in the side panel ══
    js(f"A.select({{ type: 'planting', id: '{PID}' }}); return null;"); wait(400)
    press(page, "[data-hook='card-full']", 400)
    fl = js("return { card: !!card(), panel: panel(), date: drawn($('fDate')) };")
    check("“All of this planting…” opens it whole in the side panel, in place of the card", not fl["card"] and fl["panel"] and fl["date"], fl)
    js(f"A.select({{ type: 'bed', id: '{BED}' }}); return null;"); wait(400)
    press(page, "[data-hook='card-opening']", 400)
    op = js("return { card: !!card(), panel: panel(), sel: S.sel && S.sel.type };")
    check("an opening in the bed's card opens in the side panel, as before", not op["card"] and op["panel"] and op["sel"] == "opening", op)
    js("A.select(null); return null;"); wait(300)
    st = js("LRFPanels.showSettle(); return null;"); wait(500)
    st = js("return { panel: panel(), settle: drawn($('toSettle')) };")
    check("the list of what to settle, asked for from Loose ends, stands in the side panel", st["panel"] and st["settle"], st)
    js(f"A.select({{ type: 'bed', id: '{BED}' }}); return null;"); wait(300)
    js("A.select(null); return null;"); wait(300)
    check("once something else has been picked and closed, there is no side panel again", not js("return panel();"))

    # ══ To place's two lines, in his words ══
    wt = js(f"""A.sendToWait('{PID}'); LRFPanels.setScope('wait'); return {{ lead: hook('waiting-lead') ? hook('waiting-lead').textContent : '', foot: hook('lib-hint') ? hook('lib-hint').textContent : '' }};""")
    wait(200)
    check("To place chosen: the line under the switch reads “Not in a bed yet, so not in the forecast, seed or sowing lists.” and the line at the library's foot “Drag one onto a bed or a row. It keeps its date.”",
          wt["lead"] == "Not in a bed yet, so not in the forecast, seed or sowing lists." and wt["foot"] == "Drag one onto a bed or a row. It keeps its date.", wt)
    js("A.undo(); LRFPanels.setScope('mine'); A.select(null); return null;"); wait(300)

    # ══ unticked: as before ══
    js("A.setView('map'); return null;"); wait(300)
    press(page, "#mapHelp", 400); press(page, "[data-hook='card-try']", 400); page.keyboard.press("Escape"); wait(200)
    js(f"A.select({{ type: 'bed', id: '{BED}' }}); return null;"); wait(400)
    un = js("let kept = 'x'; try { kept = localStorage.getItem('lrf.tryCard'); } catch (_) {} return { kept, card: !!card(), panel: panel(), dims: drawn($('bedDims')), attr: document.body.dataset.card || null };")
    check("unticked, the browser forgets it and a bed opens in the side panel again, with nothing of the card", un["kept"] is None and not un["card"] and un["panel"] and un["dims"] and not un["attr"], un)
    js("A.select(null); return null;")
    browser.close()

with sync_playwright() as pw:
    try: run(pw)
    except Exception as e:  # noqa: BLE001 — a check that stops says why, as a failed line
        check("the check ran to its end", False, repr(e)[:600])
finish()
