"""A picture of each main screen, at the widths the planner is used at, compared with the build before: a layout that shifts
is seen without anyone having to look for it.

usage: python3 -I screens_check.py <the built site> <the build before, as setup.sh unpacked it> <backup.zip> <shots-dir> <the repository>

Both builds are served side by side, load the same made-up farm on the same pretended day, and are photographed screen by
screen, each of them twice. A screen that looks different fails its line, unless the build names it under "screens" in its
file under tests/builds (tests/README.md, "What a build changed"): then it has to look different at one width at least, so
the list cannot be longer than the truth. The pictures of every screen that differs are kept in the shots folder: before, now,
and the two side by side with what changed boxed in red.

Two takes of one build are not the same picture to the last pixel: the edge of a rounded corner or of a curve comes out a
few levels lighter or darker from one take to the next. So each build is photographed twice, and what differs between two
takes of the same build is set aside, with the pixels round it, before the two builds are compared. And about one take in
forty draws the names of the gardens on the map in other letter shapes. So a screen that is not plainly the same is
photographed twice more, and of the four takes of a build the ones that agree are compared: a change is there every time, a
fluke is not. Where no two takes of a build agree (a clock, something still loading) the screen fails as not holding still,
since such a picture can prove nothing.

What this cannot see: anything that needs a click or a drag to appear (a panel, a menu, a window), what lies below the first
screenful, a change of colour too slight to see (under 5 levels in 255), a change of fewer than nine pixels, a change that
falls wholly on the few pixels that do not hold still, and whether a change is an improvement. It answers one question: did
this screen change, yes or no.
"""
import functools, http.server, io, json, os, sys, threading
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter
from playwright.sync_api import sync_playwright
now_dir, old_dir, backup, shots, repo = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], Path(sys.argv[4]), Path(sys.argv[5])
shots.mkdir(parents=True, exist_ok=True)
for stale in list(shots.glob("*.png")) + list(shots.glob("changed.json")): stale.unlink()   # what is kept is this run's and nothing older
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
def serve(folder):
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(folder)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{server.server_address[1]}/index.html"
results, failed, errors = [], [], []
def finish():
    print(json.dumps({"passed": len(results) - len(failed), "of": len(results), "failed": failed, "details": [r for r in results if not r["ok"]][:12], "errors": errors[:6]}, default=str))
    sys.stdout.flush(); os._exit(1 if failed else 0)
def check(name, ok, detail=None):
    results.append({"name": name, "ok": bool(ok), **({"detail": detail} if detail is not None and not ok else {})})
    if not ok: failed.append(name)

# what the build says of the screens it changes: its own file under tests/builds, the one the build before does not have
before_files = {f.name for f in (old_dir / "tests" / "builds").glob("*.json")} if (old_dir / "tests" / "builds").is_dir() else set()
named = set()
for f in sorted((repo / "tests" / "builds").glob("*.json")):
    if f.name in before_files: continue
    try: named.update(json.loads(f.read_text(encoding="utf-8")).get("screens") or [])
    except Exception as e: errors.append(f"{f.name}: {e}")

# The screens, by the name a build uses for them: how each is opened, and how to tell that it is the one on show. The pretended
# day is in the middle of the season, so that the map has crops in the ground and Tasks has a week of work.
VIEW = "document.body.dataset.view"
MODE = "(document.querySelector('.view-assume') || { dataset: {} }).dataset.mode"
SCREENS = [
    ("map", "A.setView('map'); A.select(null);", f"{VIEW} === 'map'"),
    ("timeline", "A.setView('timeline');", f"{VIEW} === 'timeline'"),
    ("forecast", "A.setView('harvest');", f"{VIEW} === 'harvest'"),
    ("tasks", "A.setView('sow');", f"{VIEW} === 'sow'"),
    ("nursery-bench-room", "A.setView('trays'); LRFTraysView.setTab('room');", f"{VIEW} === 'trays' && LRFTraysView.tab() === 'room'"),
    ("nursery-live-trays", "A.setView('trays'); LRFTraysView.setTab('live');", f"{VIEW} === 'trays' && LRFTraysView.tab() === 'live'"),
    ("nursery-supplies", "A.setView('trays'); LRFTraysView.setTab('supplies');", f"{VIEW} === 'trays' && LRFTraysView.tab() === 'supplies'"),
    ("nursery-set-up", "A.setView('trays'); LRFTraysView.setTab('setup');", f"{VIEW} === 'trays' && LRFTraysView.tab() === 'setup'"),
    ("seeds", "A.setView('seeds');", f"{VIEW} === 'seeds'"),
    ("assumptions-days", "A.setView('assume'); document.querySelector('[data-as-mode=days]').click();", f"{VIEW} === 'assume' && {MODE} !== 'harvest'"),
    ("assumptions-yield", "A.setView('assume'); document.querySelector('[data-as-mode=harvest]').click();", f"{VIEW} === 'assume' && {MODE} === 'harvest'"),
]
SIZES = [(1707, 960, [s[0] for s in SCREENS]), (3440, 1300, [s[0] for s in SCREENS]), (390, 800, ["tasks"])]   # a laptop, a wide desktop, a phone (which shows Tasks and nothing else)
unknown = sorted(named - {s[0] for s in SCREENS})
# for the deliberate faults only: one screen at one width (ONLY=seeds ONLY_WIDTH=1707). The run of every push takes them all.
if os.environ.get("ONLY"): SIZES = [(w, h, [n for n in names if n in os.environ["ONLY"].split(",")]) for w, h, names in SIZES if not os.environ.get("ONLY_WIDTH") or str(w) == os.environ["ONLY_WIDTH"]]
FAKE = "(() => { const R = Date, off = new R(2027, 5, 9, 10).getTime() - R.now(); class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } } window.Date = D; })();"
STILL = "*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; scroll-behavior: auto !important; }"

def take(pw_browser, url, width, height, wanted):
    """Every wanted screen of one build at one size: {name: PNG bytes}. A screen that did not open is left out, with why in errors."""
    out = {}
    ctx = pw_browser.new_context(viewport={"width": width, "height": height}, color_scheme="light", device_scale_factor=1)
    page = ctx.new_page(); page.add_init_script(FAKE)
    page.on("pageerror", lambda e: errors.append(str(e)[:200]))
    try:
        page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=60000); page.wait_for_timeout(900)
        if page.evaluate("LRFApp.isSample()"):
            page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
            if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
            page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(6000)
        page.add_style_tag(content=STILL)
        page.evaluate("async () => { await Promise.all([...document.fonts].map(f => f.load().catch(() => null))); await document.fonts.ready; }")
    except Exception as e:
        errors.append(f"{url} at {width}: the page did not open: {str(e)[:200]}"); ctx.close(); return out
    for name, how, shown in SCREENS:
        if name not in wanted: continue
        try:   # one screen that fails to open does not take the others with it
            page.evaluate("(() => { const A = LRFApp; " + how + " })()")
            page.wait_for_timeout(1200)
            if not page.evaluate("(() => " + shown + ")()"): errors.append(f"{name} at {width}: another screen is on show"); continue
            # pictures and typefaces in, toasts gone, nothing left to draw
            page.evaluate("""async () => {
                // every typeface the page declares, not only those in use so far: a label drawn a moment ago can still be waiting for its own
                await Promise.all([...document.fonts].map(f => f.load().catch(() => null)));
                await document.fonts.ready;
                await Promise.all([...document.images].filter(i => !i.complete).map(i => new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 4000); })));
                for (const t of document.querySelectorAll('.toast, .toasts > *')) t.remove();
                if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            }""")
            page.mouse.move(0, 0)
            out[name] = page.screenshot(full_page=False, animations="disabled", caret="hide")
        except Exception as e:
            errors.append(f"{name} at {width}: {str(e)[:200]}")
    ctx.close()
    return out

LEVELS, NOISE, SHAKE = 4, 8, 150
def far(a, b):
    """Where two pictures of one size differ by more than LEVELS in 255 in one of their three colours: white there, black elsewhere."""
    r, g, b_ = ImageChops.difference(a, b).split()
    return ImageChops.lighter(ImageChops.lighter(r, g), b_).point(lambda v: 255 if v > LEVELS else 0)
count = lambda mask: mask.histogram()[255]
def settled(takes):
    """Two takes of one build that agree, out of two or four: [a, b] as pictures, or None when no two can be trusted.
    About one take in forty on the computers this was written on draws the names of the gardens on the map in other letter
    shapes (some thousands of pixels; the cause is not known). So where two takes of a build disagree, or the two builds do,
    the screen is photographed twice more, and the takes that agree with most of the others are the ones compared."""
    ims = [Image.open(io.BytesIO(x)).convert("RGB") for x in takes]
    if len({i.size for i in ims}) > 1 or len(ims) < 2: return None
    agree = [[i == j or count(far(ims[i], ims[j])) <= SHAKE for j in range(len(ims))] for i in range(len(ims))]
    best = max(range(len(ims)), key=lambda i: sum(agree[i])); group = [j for j in range(len(ims)) if agree[best][j]]
    rest = [j for j in range(len(ims)) if j not in group]
    if len(group) < 2 or (len(group) == len(rest) and all(agree[i][j] for i in rest for j in rest)): return None   # none agree, or two camps of the same size
    return [ims[group[0]], ims[group[1]]]
def compare(was, now):
    """was and now are the takes of each build, two or four. Returns ("same" | "differs" | "shakes", detail)."""
    a, b = settled(was), settled(now)
    if a is None or b is None: return "shakes", "the takes of one build do not agree with each other, so nothing can be said (%d of the build before, %d of this one)" % (len(was), len(now))
    (a1, a2), (b1, b2) = a, b
    if a1.size != b1.size: return "differs", {"sizes": [a1.size, b1.size]}
    own = ImageChops.lighter(far(a1, a2), far(b1, b2))   # what does not hold still between two takes of one build that agree
    seen = ImageChops.multiply(far(a1, b1), ImageChops.invert(own.filter(ImageFilter.MaxFilter(5))))   # with those pixels, and the two round each, set aside
    if count(seen) <= NOISE: return "same", None
    return "differs", {"pixels": count(seen), "box": list(seen.getbbox())}
def keep(name, width, a, b, box):
    x, y = Image.open(io.BytesIO(a)).convert("RGB"), Image.open(io.BytesIO(b)).convert("RGB")
    x.save(shots / f"{name}-{width}-before.png"); y.save(shots / f"{name}-{width}-now.png")
    side = Image.new("RGB", (x.width + y.width + 12, max(x.height, y.height)), "white"); side.paste(x, (0, 0)); side.paste(y, (x.width + 12, 0))
    if box:
        g = ImageDraw.Draw(side); pad = 4
        for dx in (0, x.width + 12): g.rectangle([box[0] - pad + dx, box[1] - pad, box[2] + pad + dx, box[3] + pad], outline=(220, 30, 30), width=3)
    side.save(shots / f"{name}-{width}-side-by-side.png")

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--font-render-hinting=none", "--disable-lcd-text"])
    url_now, url_old = serve(now_dir), serve(old_dir)
    check("the build names only screens this check knows", not unknown, unknown)
    changed, got = [], {}
    for width, height, wanted in SIZES:
        was = [take(browser, url_old, width, height, wanted) for _ in (1, 2)]
        now = [take(browser, url_now, width, height, wanted) for _ in (1, 2)]
        of = lambda takes, name: [t[name] for t in takes if name in t]
        first = {name: compare(of(was, name), of(now, name)) if all(name in t for t in was + now) else ("none", None) for name in wanted}
        again = [name for name in wanted if first[name][0] != "same"]
        if again:   # whatever is not plainly the same is photographed twice more: a change is there both times, a fluke is not
            was += [take(browser, url_old, width, height, again) for _ in (1, 2)]; now += [take(browser, url_now, width, height, again) for _ in (1, 2)]
        for name in wanted:
            if name not in again: got[(name, width)] = first[name]; continue
            w, n = of(was, name), of(now, name)
            if len(w) < 2 or len(n) < 2: got[(name, width)] = ("none", "no picture was taken: " + "; ".join(e for e in errors if name in e or "did not open" in e)[-400:]); continue
            state, detail = compare(w, n)
            if state == "shakes":
                for i, x in enumerate(w): (shots / f"{name}-{width}-before-take-{i + 1}.png").write_bytes(x)
                for i, x in enumerate(n): (shots / f"{name}-{width}-now-take-{i + 1}.png").write_bytes(x)
            if state == "differs":
                a, b = settled(w), settled(n); pa, pb = io.BytesIO(), io.BytesIO(); a[0].save(pa, "PNG"); b[0].save(pb, "PNG")
                keep(name, width, pa.getvalue(), pb.getvalue(), detail.get("box")); changed.append(f"{name} at {width}")
            got[(name, width)] = (state, detail)
    # A screen the build does not name looks the same at every width. One it names looks different at one width at least.
    for (name, width), (state, detail) in got.items():
        if name in named:
            somewhere = any(s == "differs" for (n, w), (s, d) in got.items() if n == name)
            check(f"{name} at {width} px: the build names this screen as changed, and it has changed", state in ("differs", "same") and somewhere, detail if state in ("none", "shakes") else "it looks the same at every width")
        else:
            check(f"{name} at {width} px looks as it did in the build before", state == "same", detail)
    browser.close()
    (shots / "changed.json").write_text(json.dumps({"named": sorted(named), "changed": changed}, indent=1), encoding="utf-8")
finish()
