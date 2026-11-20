"""L3, part 2: the plain controls (#91), in a real browser.
A link goes somewhere and is underlined; a button does something. Every control that was drawn as a link is a link in one look where it
goes somewhere, and a bounded or a quiet button where it changes the plan, takes a step back or starts a job. A planting's panel keeps
Send to To place and Remove planting in "⋯" at its head, as its card does. Days · Weeks · Months is one switch of 32 on the Timeline and
on the Forecast, and the Timeline's growing spaces are filter pills of the Forecast's height. Nursery › Set-up counts trays and crates
with two square ticks. Seeds shows Edit crop and Add a variety on a crop's heading under the pointer or the keyboard. A drop is answered
once. A plant's yield box says a spacing only where its figure is kept for one. Text that carries meaning reads at 4.5:1 or more.
Every subject is found on the plan the page was given, by its hooks: nothing here names a crop, a bed, a garden or a date of any plan.
usage: python3 -I controls_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1707, STOP_AT_FAIL=1
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
# The things a link names: they go somewhere and change nothing. Any other control drawn underlined is a button drawn as a link.
LINKS = ["panel-bed", "bed-planting-back", "panel-live-trays", "panel-mate", "card-bed", "card-full", "card-nursery-full", "bed-planting-full", "opening-back", "fc-from-map",
         "seeds-open-crop", "series-see", "series-find", "yield-to-list", "yield-to-days", "yield-differs", "yield-typed-crop", "thing-open",
         "nursery-to-tasks", "nursery-week-tasks", "bench-line-go", "loose-link", "settle-bed"]
# the title of a card of To settle is a link drawn as that card's title: underlined, no edge and no ground, at its title's size
TITLES = ["settle-bed"]
# How a control looks, read from the page: underlined, an edge, a ground, its height, its type, how strongly it is drawn, and its contrast.
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, UI = LRFUI, eng = () => S.engine, $ = id => document.getElementById(id);"
       "const sleep = ms => new Promise(r => setTimeout(r, ms));"
       "const hook = (n, within) => (within || document).querySelector('[data-hook=\"' + n + '\"]'), hooks = (n, within) => [...(within || document).querySelectorAll('[data-hook=\"' + n + '\"]')];"
       "const drawn = el => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';"
       "const clear = c => !c || c === 'transparent' || /rgba\\(.*,\\s*0\\)$/.test(c);"
       "const parse = c => { c = String(c); let m = c.match(/rgba?\\(([^)]+)\\)/), k = 1; if (!m) { m = c.match(/color\\(srgb ([^)]+)\\)/); k = 255; } if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0] * k, p[1] * k, p[2] * k, p.length > 3 ? p[3] : 1]; };"
       "const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }, lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);"
       "const blend = (t, u) => [0, 1, 2].map(i => t[i] * t[3] + u[i] * (1 - t[3])).concat(1);"
       "const ground = el => { const ls = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) { ls.push(c); if (c[3] >= 1) break; } } let b = [255, 255, 255, 1]; for (const c of ls.reverse()) b = blend(c, b); return b; };"
       "const strength = el => { let o = 1; for (let e = el; e; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };"
       "const contrast = el => { const cs = getComputedStyle(el), g = ground(el), c = parse(cs.color); const f = blend([c[0], c[1], c[2], c[3] * strength(el)], g), a = lum(f), b = lum(g); return Math.round((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) * 100) / 100; };"
       "const look = el => { if (!el) return null; const cs = getComputedStyle(el), r = el.getBoundingClientRect(); return { tag: el.tagName, text: el.textContent.trim().slice(0, 40), under: cs.textDecorationLine.includes('underline'), h: Math.round(r.height), w: Math.round(r.width),"
       "  edge: parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && !clear(cs.borderTopColor), ground: !clear(cs.backgroundColor), size: cs.fontSize, weight: cs.fontWeight, round: parseFloat(cs.borderTopLeftRadius) >= r.height / 2 - 1, strength: Math.round(strength(el) * 100) / 100, type: el.type || '' }; };"
       "const asLink = l => !!l && l.under && !l.edge && !l.ground && ['11px', '13px'].includes(l.size) && l.weight === '600';"
       "const asButton = (l, high) => !!l && l.tag === 'BUTTON' && !l.under && l.h === high;"
       "const ink = (() => { const i = document.createElement('i'); i.style.color = 'var(--ink)'; document.body.append(i); const c = getComputedStyle(i).color; i.remove(); return c; })();"
       "const hush = () => { const t = hook('toast'); if (t) t.replaceChildren(); };"
       "const said = () => { const t = hook('toast'), s = t && t.querySelector('span'); return s ? s.textContent : ''; };"
       "const offers = () => hooks('toast-action').map(b => b.textContent);"
       "const fieldOf = id => { const p = eng().planting(id), r = p && eng().calc(p); return r ? +r.field : null; };")
def run_js(page, body, arg=None):
    return page.evaluate("async (arg) => { %s %s }" % (PRE, body), arg)

def run(pw):
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 960})
    page = ctx.new_page()
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
    js("A.state.undo.length = 0; A.state.redo.length = 0; LRFCard.turn(false); return 1;")
    key0 = js("return A.contentKey();")

    # ══ 1. a planting's panel ══
    # the subject: a planting in a bed whose panel offers several varieties, a longer series and a job to record
    sub = js("""A.setView('timeline'); await sleep(700); let n = 0;
      for (const p of S.plan.plantings) { const r = eng().calc(p); if (!r || !eng().isSoilBed(r.b) || eng().isPool(r.b)) continue;
        A.select({ type: 'planting', id: p.id }); await sleep(30);
        if (drawn(hook('panel-several')) && drawn(hook('panel-series')) && drawn(hook('job-record'))) return { id: p.id, bed: p.bedId, label: A.cropLabel(p), where: A.bedLabel(r.b) };
        if (++n > 200) break; }
      return null;""")
    check("the plan has a planting whose panel offers several varieties, a longer series and a job to record, for the check to work on", bool(sub), sub)
    if sub:
        js("A.setDate(new Date(fieldOf(arg))); A.select({ type: 'planting', id: arg }); await sleep(300); return 1;", sub["id"])
        head = js("""const more = hook('panel-more'), body = $('inspectorBody');
          return { more: drawn(more), inHead: !!more && !!more.closest('header'), aria: more && more.getAttribute('aria-haspopup'),
            loose: [...body.querySelectorAll('button')].filter(b => drawn(b) && !b.closest('[data-hook="card-menu"]') && /^(Send to To place|Remove planting)$/.test(b.textContent.trim())).map(b => b.textContent) };""")
        check("a planting's panel has “⋯” at its head, beside its ×, and Send to To place and Remove planting no longer stand in the panel", head["more"] and head["inHead"] and head["aria"] == "menu" and head["loose"] == [], head)
        page.screenshot(path=str(shots / f"panel-{WIDTH}.png"))
        menu = js("hook('panel-more').click(); await sleep(250); const items = hooks('card-menu-item'); return { items: items.map(b => b.textContent.trim()), acts: items.map(b => b.dataset.act), bad: items.map(b => getComputedStyle(b).color) };")
        page.screenshot(path=str(shots / f"panel-menu-{WIDTH}.png"))
        check("“⋯” opens a menu of the two, Send to To place and then Remove planting, in red", menu["items"] == ["Send to To place", "Remove planting"] and menu["acts"] == ["wait", "remove"] and menu["bad"][0] != menu["bad"][1], menu)
        sent = js("""const b = hooks('card-menu-item').find(x => x.dataset.act === 'wait'); if (!b) return null; b.click(); await sleep(400);
          const out = { waiting: A.waiting().some(w => w.id === arg.id), inBed: eng().planting(arg.id) ? eng().planting(arg.id).bedId || null : null, undo: S.undo.length };
          A.undo(); await sleep(300); out.back = eng().planting(arg.id) ? eng().planting(arg.id).bedId : null; out.after = S.undo.length; return out;""", sub)
        check("Send to To place in it takes the planting out of its bed to wait under To place, and Undo puts it back in its bed", bool(sent) and sent["waiting"] and sent["back"] == sub["bed"] and sent["after"] == sent["undo"] - 1, sent)
        gone = js("""A.select({ type: 'planting', id: arg.id }); await sleep(250); hook('panel-more').click(); await sleep(250);
          const b = hooks('card-menu-item').find(x => x.dataset.act === 'remove'); if (!b) return null; b.click(); await sleep(400);
          const out = { there: !!eng().planting(arg.id) && !A.waiting().some(w => w.id === arg.id), undo: S.undo.length };
          A.undo(); await sleep(300); out.back = !!eng().planting(arg.id) && eng().planting(arg.id).bedId === arg.bed; return out;""", sub)
        check("Remove planting in it takes the planting out of the plan, and Undo puts it back", bool(gone) and gone["there"] is False and gone["back"], gone)
        bed = js("""A.select({ type: 'planting', id: arg.id }); await sleep(250); const el = hook('panel-bed'), l = look(el), key = A.contentKey(), n = S.undo.length;
          if (el) { el.click(); await sleep(250); } return { look: l, text: l && l.text, sel: S.sel, same: A.contentKey() === key && S.undo.length === n };""", sub)
        check("the bed's name at the head of the panel is a link: underlined, with no edge and no ground, at 13 and 600; it goes to the bed and changes nothing",
              asLinkOk(bed["look"]) and bed["text"] == sub["where"] and (bed["sel"] or {}).get("type") == "bed" and (bed["sel"] or {}).get("id") == sub["bed"] and bed["same"], bed)
        quiet = js("""A.select({ type: 'planting', id: arg.id }); await sleep(250); return { several: look(hook('panel-several')), series: look(hook('panel-series')) };""", sub)
        check("Several varieties… and Plan a longer series… are quiet buttons of 28 in the panel: no edge, not underlined",
              all(asButtonOk(quiet[k], 28) and not quiet[k]["edge"] and quiet[k]["text"].endswith("…") for k in ("several", "series")), quiet)
        rec = js("""const b = hook('job-record'), l = look(b); if (b) { b.click(); await sleep(250); } const box = document.querySelector('#jobList [data-job=date]');
          const out = { look: l, box: drawn(box) }; if (box) { box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(250); } return out;""")
        check("the schedule's “record” is a small bounded button, not underlined, and opens its box for the day", asButtonOk(rec["look"], 28) and rec["look"]["edge"] and rec["box"], rec)
        saved = js("""A.select({ type: 'planting', id: arg.id }); await sleep(300); const top0 = hook('panel-schedule').getBoundingClientRect().top, was = eng().planting(arg.id).hw;
          const i = $('fHw'); i.value = '3'; i.dispatchEvent(new Event('change', { bubbles: true })); await sleep(400);
          const line = hook('panel-saved'), undo = hook('panel-saved-undo'), tall = line ? line.getBoundingClientRect().height : 0;
          // the line as tall as its words alone: the button made the height of a word, where it stands
          if (undo) { undo.style.minHeight = '0'; undo.style.height = '17px'; } const words = line ? line.getBoundingClientRect().height : 0; if (undo) { undo.style.minHeight = ''; undo.style.height = ''; }
          return { state: line && line.dataset.state, undo: look(undo), taller: Math.round(tall - words), hw: eng().planting(arg.id).hw, was: was == null ? null : was, n: S.undo.length };""", sub)
        page.screenshot(path=str(shots / f"panel-saved-{WIDTH}.png"))
        check("a box changed in the panel says Saved with its Undo as a small bounded button, which makes that line no taller than its words",
              saved["state"] == "saved" and asButtonOk(saved["undo"], 28) and saved["undo"]["edge"] and saved["taller"] <= 0 and saved["hw"] == 3, saved)
        back = js("const b = hook('panel-saved-undo'); if (b) { b.click(); await sleep(400); } const v = eng().planting(arg.id).hw; return { hw: v == null ? null : v, n: S.undo.length };", sub)
        check("that Undo takes the change back", back["hw"] == saved["was"] and back["n"] == saved["n"] - 1, [saved, back])

    # ══ 2. a drop is answered once ══
    drop = js("""A.setView('timeline'); await sleep(400); LRFCard.turn(false);
      for (const p of S.plan.plantings) { const r = eng().calc(p); if (!r || !eng().isSoilBed(r.b) || p.done) continue;
        const res = A.preview({ plantingId: p.id }, { bedId: p.bedId, date: E.addDays(r.field, 4) }); if (res.state !== 'ok') continue;
        A.setDate(r.field); A.select({ type: 'planting', id: p.id }); await sleep(300); hush();
        A.place({ plantingId: p.id }, p.bedId, E.addDays(r.field, 4)); await sleep(400);
        const line = hook('panel-saved');
        return { id: p.id, was: +r.field, now: fieldOf(p.id), said: said(), offers: offers(), state: line && line.dataset.state, line: line && line.textContent, sel: S.sel && S.sel.id }; }
      return null;""")
    check("a planting its panel shows, dragged four days later, is answered once: the page's answer says how far, with Undo, and the panel's line stays quiet",
          bool(drop) and drop["sel"] == drop["id"] and "4 days later" in drop["said"] and drop["offers"] == ["Undo"] and drop["state"] == "idle" and "Saved" not in (drop["line"] or ""), drop)
    if drop:
        undone = js("const b = hooks('toast-action').find(x => x.textContent === 'Undo'); if (b) b.click(); await sleep(400); return fieldOf(arg);", drop["id"])
        check("Undo in that answer puts it back on its day", undone == drop["was"], [drop, undone])
    # a copy dropped from the planting the panel shows picks the copy: what the page says, it says once (Codex on #97)
    copy = js("""A.setView('timeline'); await sleep(300);
      for (const p of S.plan.plantings) { const r = eng().calc(p); if (!r || !eng().isSoilBed(r.b) || p.done) continue;
        const to = S.plan.beds.find(b => b.id !== p.bedId && b.active !== false && eng().isSoilBed(b) && A.preview({ plantingId: p.id, copy: true }, { bedId: b.id, date: r.field }).state === 'ok'); if (!to) continue;
        A.setDate(r.field); A.select({ type: 'planting', id: p.id }); await sleep(300); hush(); const t = hook('toast'), heard = [];
        const own = t.append; t.append = function (...a) { for (const x of a) if (x && x.tagName === 'SPAN') heard.push(x.textContent); return own.apply(this, a); };   // every message, as it is said
        const n = S.plan.plantings.length; A.place({ plantingId: p.id, copy: true }, to.id, r.field); await sleep(500); delete t.append;
        const out = { heard, made: S.plan.plantings.length === n + 1, picked: !!S.sel && S.sel.id !== p.id, line: hook('panel-saved') && hook('panel-saved').dataset.state };
        A.undo(); await sleep(300); out.back = S.plan.plantings.length === n; return out; }
      return null;""")
    check("a copy dropped from the planting the panel shows picks the copy, and the page says it once: nothing says Saved in passing (Codex on #97)",
          bool(copy) and copy["made"] and copy["picked"] and len(copy["heard"]) == 1 and not copy["heard"][0].startswith("Saved") and copy["line"] == "idle" and copy["back"], copy)

    # ══ 3. the card ══
    if sub:
        card = js("""LRFCard.turn(true); A.setView('timeline'); await sleep(400); A.select({ type: 'planting', id: arg.id }); await sleep(500);
          const row = hooks('card-row').find(r => r.dataset.row === 'nursery'), rh = row && row.querySelector('button'); if (rh && !hook('card-nursery-full')) { rh.click(); await sleep(250); }
          const way = look(hook('card-nursery-full'));
          const el = hook('card-full'), l = look(el), key = A.contentKey(), n = S.undo.length; if (el) { el.click(); await sleep(400); }
          return { look: l, way, full: drawn(hook('panel-schedule', $('inspectorBody'))) && drawn($('inspectorBody')), same: A.contentKey() === key && S.undo.length === n };""", sub)
        check("on a planting's card, Planting details is a link, at its foot and in its nursery row: underlined, with no edge and no ground; it opens every box in the side panel and changes nothing", asLinkOk(card["look"]) and asLinkOk(card["way"]) and card["full"] and card["same"], card)
        cundo = js("""A.select(null); await sleep(200); A.select({ type: 'planting', id: arg.id }); await sleep(400);
          const row = hooks('card-row').find(r => r.dataset.row === 'days'), head = row && row.querySelector('button'); if (head && !hook('card-hw')) { head.click(); await sleep(250); }
          const i = hook('card-hw'); if (!i) return null; const was = eng().planting(arg.id).hw; i.value = '3'; i.dispatchEvent(new Event('change', { bubbles: true })); await sleep(400);
          const u = hook('card-undo'), out = { look: look(u), hw: eng().planting(arg.id).hw }; if (u) { u.click(); await sleep(400); } const v = eng().planting(arg.id).hw; out.back = (v == null ? null : v) === (was == null ? null : was);
          LRFCard.turn(false); A.select(null); return out;""", sub)
        check("a change made on the card says so with its Undo as a small bounded button, and that Undo takes it back", bool(cundo) and asButtonOk(cundo["look"], 28) and cundo["look"]["edge"] and cundo["hw"] == 3 and cundo["back"], cundo)

    # ══ 4. Days · Weeks · Months, and the filter pills ══
    tl = js("""A.select(null); A.setView('timeline'); await sleep(500); const box = hook('tl-by'), ch = hooks('tl-by-choice', box || undefined);
      return { box: look(box), words: ch.map(b => b.textContent.trim()), pressed: ch.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => getComputedStyle(b).backgroundColor), others: ch.filter(b => b.getAttribute('aria-pressed') !== 'true').map(b => getComputedStyle(b).backgroundColor), ink,
        filters: hooks('tl-filter').map(b => ({ ...look(b), count: !!b.querySelector('small') && /^[0-9,]+$/.test(b.querySelector('small').textContent), pressed: b.getAttribute('aria-pressed') })) };""")
    check("the Timeline's scale is one switch of 32, bordered, reading Days · Weeks · Months, the chosen side in ink",
          bool(tl["box"]) and tl["box"]["h"] == 32 and tl["box"]["edge"] and tl["words"] == ["Days", "Weeks", "Months"] and tl["pressed"] == [tl["ink"]] and tl["ink"] not in tl["others"], tl)
    fc = js("""A.setView('harvest'); await sleep(700); const box = hook('fc-by'), ch = hooks('fc-by-choice', box || undefined), season = hook('fc-season-btn');
      return { box: look(box), words: ch.map(b => b.textContent.trim()), last: !!box && !!season && box.lastElementChild === season, season: season && season.textContent, filters: hooks('fc-filter').map(look) };""")
    check("the Forecast's reads the same words in the same order, at the same height, with Whole season its own fourth choice after them",
          bool(fc["box"]) and fc["words"] == tl["words"] and fc["box"]["h"] == (tl["box"] or {}).get("h") and fc["last"] and fc["season"] == "Whole season", [fc, tl["box"]])
    check("the Timeline's growing spaces are filter pills of 32, each with its count, the height of the Forecast's",
          len(tl["filters"]) == 5 and all(f["h"] == 32 and f["round"] and f["edge"] and f["count"] for f in tl["filters"]) and fc["filters"] and all(f["h"] == 32 for f in fc["filters"]), [tl["filters"], fc["filters"][:2]])
    zoom = js("""A.setView('timeline'); await sleep(500); const pick = w => hooks('tl-by-choice').find(b => b.dataset.tlZoom === w);
      pick('days').click(); await sleep(400); const days = { tier: $('tlInner').dataset.tier, pressed: pick('days').getAttribute('aria-pressed') };
      pick('weeks').click(); await sleep(400); const s0 = LRFTimeline.scale(); hook('tl-zoom-in').click(); await sleep(250); const s1 = LRFTimeline.scale(); hook('tl-zoom-out').click(); await sleep(250); const s2 = LRFTimeline.scale();
      pick('months').click(); await sleep(400); return { days, s0, s1, s2, months: $('tlInner').dataset.tier };""")
    check("Days goes to the days scale; + and − still step it by half again, and back", zoom["days"] == {"tier": "days", "pressed": "true"} and abs(zoom["s1"] - zoom["s0"] * 1.5) < 1e-6 and abs(zoom["s2"] - zoom["s0"]) < 1e-6 and zoom["months"] == "months", zoom)
    towers = js("""const pick = f => hooks('tl-filter').find(b => b.dataset.tlFilter === f), kinds = () => [...new Set(hooks('tl-space').filter(drawn).map(r => eng().spaceKind(eng().bedOf(r.dataset.bed))))];
      const all = kinds(); pick('tower').click(); await sleep(500); const only = kinds(), kept = LRFTimeline.prefs().filter, pressed = getComputedStyle(pick('tower')).backgroundColor === ink && pick('tower').getAttribute('aria-pressed') === 'true';
      pick('all').click(); await sleep(500); return { all, only, kept, pressed, again: kinds().length === all.length };""")
    page.screenshot(path=str(shots / f"timeline-{WIDTH}.png"))
    check("Towers hides every other kind of space, its pill in ink, and All shows every kind again", len(towers["all"]) > 1 and all(k == "tower" for k in towers["only"]) and towers["kept"] == "tower" and towers["pressed"] and towers["again"], towers)

    # ══ 5. Nursery › Set-up: how trays and crates are counted ══
    nu = js("""A.setView('trays'); await sleep(300); LRFTraysView.setTab('setup'); await sleep(600); const box = $('bnCount'), a = hook('bench-crates-floor'), b = hook('bench-share-trays');
      const words = el => el && el.closest('label') ? el.closest('label').textContent : '';
      return { a: a && a.type, b: b && b.type, aw: words(a), bw: words(b), buttons: box ? box.querySelectorAll('button').length : null, on: [a && a.checked, b && b.checked] };""")
    check("how trays and crates are counted is two square ticks, each saying what it sets and what that comes to, and no button",
          nu["a"] == "checkbox" and nu["b"] == "checkbox" and nu["aw"].startswith("Sheltered crates stand on the floor") and len(nu["aw"]) > 50 and nu["bw"].startswith("Varieties of one crop share trays") and len(nu["bw"]) > 50 and nu["buttons"] == 0, nu)
    page.screenshot(path=str(shots / f"nursery-set-up-{WIDTH}.png"))
    trays = js("""const t = hook('bench-share-trays'); if (!t) return null; const was = t.checked, n = S.undo.length; t.click(); await sleep(400);
      const out = { was, apart: eng().shareTrays === false, own: (S.plan.lrfNext || {}).trays || null, step: S.undo.length === n + 1, now: hook('bench-share-trays').checked };
      A.undo(); await sleep(400); out.back = eng().shareTrays !== false && hook('bench-share-trays').checked; return out;""")
    check("unticking “Varieties of one crop share trays” counts every variety in trays of its own, as one step, and Undo ticks it again",
          bool(trays) and trays["was"] is True and trays["apart"] and trays["own"] == "variety" and trays["step"] and trays["now"] is False and trays["back"], trays)
    crates = js("""const t = hook('bench-crates-floor'); if (!t) return null; const was = t.checked; t.click(); await sleep(400);
      const out = { was, bench: !!eng().cratesOnBenches, own: (S.plan.lrfNext || {}).crates || null, now: hook('bench-crates-floor').checked };
      A.undo(); await sleep(400); out.back = !eng().cratesOnBenches && hook('bench-crates-floor').checked; return out;""")
    check("unticking “Sheltered crates stand on the floor” counts them on the benches, and Undo puts them back on the floor",
          bool(crates) and crates["was"] is True and crates["bench"] and crates["own"] == "bench" and crates["now"] is False and crates["back"], crates)

    # ══ 6. Seeds: a crop's heading ══
    sd = js("""A.setView('seeds'); await sleep(900); const head = hooks('seeds-crop-head').find(r => hook('seeds-edit-crop', r) && hook('seeds-add-variety', r));
      if (!head) return null; head.scrollIntoView({ block: 'center' }); await sleep(200); window.__head = head;
      return { crop: head.dataset.crop, edit: look(hook('seeds-edit-crop', head)), add: look(hook('seeds-add-variety', head)), open: hook('seeds-crop-fold', head).getAttribute('aria-expanded') };""")
    check("a crop's heading in Seeds holds Edit crop and Add a variety as two small bounded buttons, unseen at rest",
          bool(sd) and all(asButtonOk(sd[k], 28) and sd[k]["edge"] and sd[k]["strength"] == 0 for k in ("edit", "add")), sd)
    if sd:
        page.locator(f'[data-hook="seeds-crop-head"][data-crop="{sd["crop"]}"]').hover(); wait(400)
        pointed = js("const h = window.__head; return [look(hook('seeds-edit-crop', h)).strength, look(hook('seeds-add-variety', h)).strength];")
        page.screenshot(path=str(shots / f"seeds-heading-{WIDTH}.png"))
        check("pointed at, the heading shows them", pointed == [1, 1], pointed)
        page.mouse.move(2, WIDTH // 4 if WIDTH < 900 else 300); wait(300)
        keyed = js("const h = window.__head, away = look(hook('seeds-edit-crop', h)).strength; hook('seeds-crop-fold', h).focus(); await sleep(300); return [away, look(hook('seeds-edit-crop', h)).strength, look(hook('seeds-add-variety', h)).strength];")
        check("with the keyboard on the heading, it shows them too", keyed == [0, 1, 1], keyed)
        edit = js("""const h = window.__head, n = eng().crop(h.dataset.crop).name, before = ($('sdPanel') || {}).textContent || ''; hook('seeds-edit-crop', h).click(); await sleep(500);
          const head = hooks('seeds-crop-head').find(r => r.dataset.crop === h.dataset.crop); const panel = ($('sdPanel') || {}).textContent || '';
          return { name: n, shows: panel.includes(n) && panel !== before, open: head && hook('seeds-crop-fold', head).getAttribute('aria-expanded'), key: A.contentKey() };""")
        check("Edit crop opens that crop and leaves its heading as it was", edit["shows"] and edit["open"] == sd["open"], edit)
        add = js("""const head = hooks('seeds-crop-head').find(r => r.dataset.crop === arg); hook('seeds-add-variety', head).click(); await sleep(500);
          const d = document.querySelector('dialog[open]'), out = { open: !!d, words: d ? d.textContent.slice(0, 200) : '', name: eng().crop(arg).name };
          if (d) { d.dispatchEvent(new Event('cancel', { cancelable: true })); const c = d.querySelector('button'); await sleep(200); if (d.open) d.close(); } return out;""", sd["crop"])
        check("Add a variety opens the window for a new variety of that crop", add["open"] and add["name"] in add["words"], add)
        js("const d = document.querySelector('dialog[open]'); if (d) d.close(); A.select(null); return 1;")

    # ══ 7. a plant's yield box (E2d's card, two wording notes) ══
    yc = js("""const e = eng(), COUNTED = ['each', 'bunch', 'head', 'stem'];
      for (const c of e.crops()) { const hc = e.harvestFor(c.id); if (!hc || hc.micro || hc.basis !== 'plant' || (hc.pattern.value === 'once' && COUNTED.includes(hc.unit.value))) continue;
        for (const env of Object.keys(hc.cells)) { const st = e.statedFor(c.id, env), cell = hc.cells[env]; if (!st || st.spacings > 1 || cell.mine != null || cell.fallback == null) continue;
          return { crop: c.id, env, inRow: st.inRow, figure: Math.round(cell.fallback * 1.5 * 10) / 10 }; } }
      return null;""")
    check("the plan has a crop counted a plant at one spacing with no figure of his, for the check to work on", bool(yc), yc)
    if yc:
        spacing = "%g in apart" % yc["inRow"]
        box = ("const box = document.querySelector(`#ycCard [data-yk=\"y|${arg.env}\"]`), td = box && box.closest('td'), of = td && hook('yield-of', td), say = td && hook('yield-say', td);"
               "return box ? { label: box.getAttribute('aria-label'), tip: box.title, of: of ? of.textContent : '', say: say ? say.textContent : null, sayLook: look(say) } : null;")
        js("await A.setYield('crops', arg.crop, arg.env, arg.figure, 'Typed with no spacing'); A.setView('assume'); LRFAssume.setMode('harvest', 'card', arg.crop); await sleep(700); return 1;", yc)
        unkept = js(box, yc)
        page.screenshot(path=str(shots / f"yield-unkept-{WIDTH}.png"))
        check("a plant's yield typed with no spacing reads as the figure it is: its box, label and tip name no spacing, and only the offer beside it does",
              bool(unkept) and spacing not in unkept["of"] and spacing not in unkept["label"] and spacing not in unkept["tip"] and spacing in (unkept["say"] or "") and asButtonOk(unkept["sayLook"], 28), [spacing, unkept])
        js("A.undo(); await sleep(300); return 1;")
        none = js("""const own = (S.plan.crops || []).find(c => c.id === arg.crop) || null, lib = eng().crop(arg.crop);
          if (!A.commit('Empty the yield', [{ kind: 'crop', before: own, after: { ...(own || { id: arg.crop }), yield: '' } }], { unchecked: true })) return null;
          LRFAssume.setMode('harvest', 'card', arg.crop); await sleep(600); const out = (() => { %s })(); A.undo(); await sleep(300); return out;""" % box, yc)
        check("with no yield at all, a plant's box tip names its spacing, as its label does", bool(none) and spacing in none["label"] and spacing in none["tip"] and none["tip"].startswith("No yield is set"), [spacing, none])

    # ══ 8. text that carries meaning reads ══
    if sub:
        own = js("""LRFCard.turn(false); A.setView('timeline'); await sleep(300); const p = eng().planting(arg.id), r = eng().calc(p); if (!r.sow || !(r.sow < r.field)) return null;
          const d = E.addDays(r.sowDefault || r.sow, -3), iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          A.planSowings([arg.id], iso); await sleep(300); A.select({ type: 'planting', id: arg.id }); await sleep(300); const el = hook('job-own-day');
          const out = { there: drawn(el), ratio: el ? contrast(el) : null, look: look(el) }; A.undo(); await sleep(300); return out;""", sub)
        check("“your day” in a planting's schedule is a quiet button whose words read at 4.5:1 or more", bool(own) and own["there"] and own["ratio"] >= 4.5 and asButtonOk(own["look"], 28), own)
    faint = js("""const out = [];
      const scan = where => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim()) continue; const el = n.parentElement; if (!el || el.closest('svg, [hidden], dialog:not([open]), :disabled')) continue;
          const r = el.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth || !drawn(el) || strength(el) < 0.5) continue;
          // type sized to the thing it is drawn on (the letter that stands for a photograph) is off the scale by design (DESIGN.md), and passed over
          const cs = getComputedStyle(el), size = parseFloat(cs.fontSize); if (![11, 13, 15, 18, 24, 32].includes(size)) continue; const large = size >= 24 || (+cs.fontWeight >= 700 && size >= 18.66), k = contrast(el);
          if (k < (large ? 3 : 4.5)) out.push({ where, text: n.textContent.trim().slice(0, 30), ratio: k }); } };
      A.select(null); A.setView('timeline'); await sleep(700); scan('timeline');
      A.setView('harvest'); await sleep(800); scan('forecast');
      A.setView('trays'); LRFTraysView.setTab('live'); await sleep(700); scan('live trays');
      A.setView('seeds'); await sleep(800); scan('seeds');
      A.setView('assume'); LRFAssume.setMode('days'); await sleep(700); scan('days to harvest');
      LRFAssume.setMode('harvest', 'list'); await sleep(700); scan('yield and price');
      return out.slice(0, 12);""")
    check("on the Timeline, the Forecast, the live trays, Seeds and both halves of Assumptions, no words read below 4.5:1 (disabled controls aside)", faint == [], faint)

    # ══ 9. a link goes somewhere, a button does something: everywhere ══
    sweep = js("""const seen = [];
      const take = where => { for (const b of document.querySelectorAll('button')) { if (!drawn(b) || b.closest('[hidden]')) continue; const l = look(b);
        if (l.under || LINKS.includes(b.dataset.hook)) seen.push({ where, hook: b.dataset.hook || '', text: l.text, ok: LINKS.includes(b.dataset.hook) && (TITLES.includes(b.dataset.hook) ? l.under && !l.edge && !l.ground : asLink(l)) }); } };
      const views = [['map', () => { A.setView('map'); A.select(null); }], ['timeline', () => A.setView('timeline')], ['forecast', () => A.setView('harvest')], ['tasks', () => A.setView('sow')],
        ['bench room', () => { A.setView('trays'); LRFTraysView.setTab('room'); }], ['live trays', () => LRFTraysView.setTab('live')], ['supplies', () => LRFTraysView.setTab('supplies')], ['set-up', () => LRFTraysView.setTab('setup')],
        ['seeds', () => A.setView('seeds')], ['days to harvest', () => { A.setView('assume'); LRFAssume.setMode('days'); }], ['yield and price', () => LRFAssume.setMode('harvest', 'list')]];
      for (const [where, go] of views) { go(); await sleep(700); take(where); }
      A.setView('timeline'); await sleep(400); A.select({ type: 'planting', id: arg.id }); await sleep(400); take('a planting'); A.select({ type: 'bed', id: arg.bed }); await sleep(400); take('a bed');
      A.select(null); return { links: seen.filter(x => x.ok).length, bad: seen.filter(x => !x.ok).slice(0, 10) };""".replace("LINKS", json.dumps(LINKS)).replace("TITLES", json.dumps(TITLES)), sub or {"id": "", "bed": ""})
    check("on every main screen and in a planting's and a bed's panel, every underlined control is a link of one look, and every link is underlined", sweep["links"] >= 3 and sweep["bad"] == [], sweep)
    after = js("A.select(null); return A.contentKey();")
    check("nothing the check looked at was left changed", after == key0, None)
    browser.close()

def asLinkOk(l): return bool(l) and l["under"] and not l["edge"] and not l["ground"] and l["size"] == "13px" and l["weight"] == "600"
def asButtonOk(l, high): return bool(l) and l["tag"] == "BUTTON" and not l["under"] and l["h"] == high

with sync_playwright() as pw:
    try: run(pw)
    except Exception as e: errors.append(repr(e)[:400]); check("the check ran to its end", False, repr(e)[:400])
finish()
