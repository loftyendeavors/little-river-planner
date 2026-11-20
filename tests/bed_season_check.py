"""The desktop bed's season, in the sidebar and the opt-in card, on the made-up farm.
usage: python3 -I bed_season_check.py <app-or-site-dir> <shots-dir> [backup.zip]
"""
import functools
import http.server
import json
import re
import os
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright


target, shots = Path(sys.argv[1]), Path(sys.argv[2])
backup = sys.argv[3] if len(sys.argv) > 3 else None
shots.mkdir(parents=True, exist_ok=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(target)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
passed, failed, errors = [], [], []


def check(name, ok, detail=None):
    if ok:
        passed.append(name)
    else:
        failed.append({"name": name, "detail": detail})


def hook(name):
    return f'[data-hook="{name}"]'


def planting(pid):
    return hook('card-planting') + f'[data-planting={json.dumps(pid)}]'


def opening(oid):
    return hook('card-opening') + f'[data-opening={json.dumps(oid)}]'


def load(page):
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url)
    page.wait_for_function("window.LRFApp && LRFApp.state.ready && LRFThumbs.count() > 0" if not backup else "window.LRFApp && LRFApp.state.ready")
    if backup and page.evaluate("LRFApp.isSample()"):
        page.set_input_files("#importFile", backup)
        page.wait_for_function("!LRFApp.isSample() || !!document.querySelector('dialog[open] .btn.primary')")
        confirm = page.locator("dialog[open] .btn.primary")
        if confirm.is_visible():
            confirm.click()
        page.wait_for_function("!LRFApp.isSample() && LRFThumbs.count() > 0", timeout=60000)


SUBJECT = """() => {
  const a = LRFApp, e = a.state.engine, E = LRFEngine, S = LRFSuccession;
  for (const b of a.state.plan.beds) {
    if (!e.isSoilBed(b) || b.active === false || !LRFMap.element(b.id) || LRFForecast.useOfBed(e, b).personal) continue;
    const list = e.plantingsIn(b.id).map(p => ({p, r: e.calc(p)})).filter(x => x.r).sort((x,y) => x.r.field - y.r.field);
    if (list.length < 3) continue;
    const gaps = S.openings(e, {bedId: b.id, empty: true});
    const gap = gaps.map(o => ({o, fits: LRFAhead.fitsIn(e, o)})).find(x => x.o.after && x.fits.length > 3);
    if (!gap) continue;
    const subject = list.find(({p, r}) => p.varietyId && LRFThumbs.get(p.varietyId) && r.harvestDays > 0 &&
      +E.s2d(p.date) === +r.field && r.field.getDate() < 28 && e.varietiesOf(p.cropId).some(v => v.id !== p.varietyId) &&
      e.bedStatus(b, r.first).crops.some(x => x.planting.id === p.id));
    if (!subject) continue;
    const {p, r} = subject;
    const turnover = list.find(({p, r}) => {
      const day = E.addDays(r.last, 1), t = e.occupancyThrough(p, r);
      return E.validDate(t) && day >= e.occupancyFrom(p,r) && day <= t && e.bedStatus(b, day).resting;
    });
    if (!turnover) continue;
    const replacement = e.varietiesOf(p.cropId).find(v => v.id !== p.varietyId).id;
    return {bed: b.id, id: p.id, photo: LRFThumbs.get(p.varietyId), date: p.date, replacement,
      revised: E.d2s(E.addDays(E.s2d(p.date), 1)), picking: E.d2s(r.first),
      turnover: {id: turnover.p.id, day: E.d2s(E.addDays(turnover.r.last, 1)), clear: LRFUI.day(E.addDays(e.occupancyThrough(turnover.p, turnover.r), 1))},
      rows: list.map(x => x.p.id), gap: {id: gap.o.id, date: E.d2s(gap.o.from), label: LRFUI.day(gap.o.from), days: gap.o.days,
        after: [gap.o.after.r.c.vname, gap.o.after.r.c.name.toLowerCase()].filter(Boolean).join(' '), fits: gap.fits.slice(0, 3).map(f => f.crop.name),
        cropIds: gap.fits.slice(0, 3).map(f => f.crop.id), more: gap.fits.length - 3},
      empty: a.state.plan.beds.find(x => e.isSoilBed(x) && x.active !== false && x.px && !e.plantingsIn(x.id).length &&
        S.openings(e, {bedId: x.id, empty: true}).length)?.id};
  }
  return null;
}"""


def run_surface(context, floating):
    page = context.new_page()
    mode = "floating card" if floating else "sidebar"
    verify = lambda name, ok, detail=None: check(f"{mode}: {name}", ok, detail)
    loc = lambda name: page.locator(hook(name))
    load(page)
    page.evaluate("LRFApp.setView('map')")
    if floating:
        page.locator("#mapHelp").click()
        loc("card-try").check()
        page.keyboard.press("Escape")
    sample = page.evaluate(SUBJECT)
    verify("the fixture has photos, several rows, turnover, and an opening with crop fits", bool(sample and sample["empty"]))
    if not sample or not sample["empty"]:
        return

    def select_bed(bid):
        page.evaluate("bedId => LRFApp.select({type: 'bed', id: bedId})", bid)

    def date(day):
        page.evaluate("day => LRFApp.setDate(LRFEngine.s2d(day))", day)

    def record(pid):
        return page.evaluate("id => LRFApp.state.engine.planting(id)", pid)

    def key():
        return page.evaluate("LRFApp.contentKey()")

    def selection():
        return page.evaluate("LRFApp.state.sel")

    def undo():
        if floating and loc("card-undo").is_visible():
            loc("card-undo").click()
        else:
            page.keyboard.press("Control+z")

    row = page.locator(planting(sample["id"]))
    date(sample["picking"])
    page.evaluate("id => LRFMap.fitSpaces([id], false, .65)", sample["bed"])
    fill = page.locator(f'#mapBeds [data-planting={json.dumps(sample["id"])}]').first
    fill.click()
    season = loc("bed-season")
    verify("an ordinary click on a painted planting opens its bed's season", selection() == {"type": "bed", "id": sample["bed"]} and season.is_visible(), selection())
    if not season.is_visible():
        select_bed(sample["bed"])
    verify("a painted planting opens its own date and variety row", row.get_attribute("aria-expanded") == "true" and loc("bed-planting-date").is_visible() and loc("bed-planting-variety").is_visible())
    year = loc("card-year")
    months = year.locator("span").all_text_contents()
    verify("the season strip labels every month clearly and the plantings are in chronological order",
           year.is_visible() and months == "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
           and loc("card-planting").evaluate_all("rows => rows.map(r => r.dataset.planting)") == sample["rows"], months)
    image = row.locator("img")
    verify("a kept variety photo renders at 40 px in the row", image.count() == 1 and image.get_attribute("src") == sample["photo"] and image.evaluate("el => el.getBoundingClientRect().width") == 40)
    picking = row.locator(hook("bed-planting-status") + '[data-state="picking"]')
    verify("the picking row is marked in words", picking.is_visible() and picking.inner_text() == "Picking")
    page.screenshot(path=str(shots / ("floating-card.png" if floating else "sidebar.png")))
    if row.get_attribute("aria-expanded") == "true":
        row.click()

    if floating:
        # Frame a bed that can take the planting; put the card over it without editing the layout.
        bed = page.evaluate("""id => {
          const a = LRFApp, e = a.state.engine, p = e.planting(id), date = LRFEngine.s2d(p.date);
          return e.plan.beds.find(b => b.id !== p.bedId && LRFMap.element(b.id) && e.isSoilBed(b) &&
            !e.plantingsIn(b.id).length && a.preview({plantingId: id}, {bedId: b.id, date}).state === 'ok')?.id;
        }""", sample["id"])
        before = key()
        if bed:
            page.evaluate("id => LRFMap.fitSpaces([id], false, .65)", bed)
            end = page.evaluate("""id => {
              const r = LRFMap.element(id).querySelector('.bed-base').getBoundingClientRect();
              return {x: r.left + r.width / 2, y: r.top + r.height / 2};
            }""", bed)
            card = loc("card")
            row.scroll_into_view_if_needed()
            start = row.bounding_box()
            card.evaluate("(el, offset) => { el.style.transform = `translate(${offset.x}px,${offset.y}px)`; }",
                          {"x": end["x"] - start["x"] - 40, "y": end["y"] - start["y"] - start["height"] / 2})
            covered = page.evaluate("""({id, x, y}) =>
              document.elementFromPoint(x, y)?.closest('.lrf-card') &&
              document.elementsFromPoint(x, y).some(el => el.closest('#map [data-bed]')?.dataset.bed === id) &&
              document.elementFromPoint(x - 12, y)?.closest('.lrf-card') != null""", {"id": bed, **end})
            page.mouse.move(end["x"] - 12, end["y"])
            page.mouse.down()
            page.mouse.move(end["x"], end["y"])
            page.mouse.up()
            verify("a drag that ends inside the card cannot drop into the covered map bed", covered and key() == before)
            if key() != before:
                page.evaluate("LRFApp.undo()")
                select_bed(sample["bed"])
            card.evaluate("el => { el.style.transform = ''; }")
            row.scroll_into_view_if_needed()
            start = row.bounding_box()
            page.mouse.move(start["x"] + 40, start["y"] + start["height"] / 2)
            page.mouse.down()
            page.mouse.move(end["x"], end["y"], steps=8)
            page.mouse.up()
            verify("a drag out of the card can still move a planting into a visible bed", record(sample["id"])["bedId"] == bed)
            if key() != before:
                page.evaluate("LRFApp.undo()")
            select_bed(sample["bed"])
            page.evaluate("id => LRFMap.fitSpaces([id], false, .65)", sample["bed"])
        else:
            verify("a drag that ends inside the card cannot drop into the covered map bed", False, "no bed takes the planting")
            verify("a drag out of the card can still move a planting into a visible bed", False, "no bed takes the planting")

    date(sample["turnover"]["day"])
    turn = sample["turnover"]
    marker = page.locator(planting(turn["id"])).locator(hook("bed-planting-status") + '[data-state="turnover"]')
    hatch = page.evaluate("id => LRFMap.element(id).classList.contains('is-resting')", sample["bed"])
    verify("on a hatched day, the corresponding row shows the engine's turnover date", hatch and marker.is_visible() and turn["clear"] in marker.inner_text())
    gap = sample["gap"]
    date(gap["date"])
    gap_card = page.locator(opening(gap["id"]))
    fits = gap_card.locator(hook("bed-opening-fit")).all_text_contents() if gap_card.count() else []
    verify("an opening shows the engine's days, predecessor, three crop fits with amounts each with its unit (a crop sold each says each), and remaining count", gap_card.is_visible() and all(part in gap_card.inner_text() for part in (f"Open {gap['days']} days", gap["after"], f"+{gap['more']} more")) and len(fits) == 3 and all(re.fullmatch(re.escape(name) + r" [\d,.]+ [a-z]+.*", fit) for name, fit in zip(gap["fits"], fits)), fits)
    verify("the planning date marks the opening that contains it", gap_card.locator(hook("bed-opening-now")).is_visible() and gap["label"] in gap_card.locator(hook("bed-opening-now")).inner_text())
    gap_card.click()
    top_fits = page.locator("#ahFits button[data-crop]").evaluate_all("chips => chips.slice(0, 3).map(chip => chip.dataset.crop)")
    verify("opening details rank the same first three crops and show the full count", top_fits == gap["cropIds"] and f"{gap['more'] + 3:,}" in page.locator("#ahFits h3").inner_text(), top_fits)
    page.locator("#ahToBed").click()

    row.click()
    date_field, variety_field, full = loc("bed-planting-date"), loc("bed-planting-variety"), loc("bed-planting-full")
    verify("opening one row gives date, variety and the full record while the bed stays selected", row.get_attribute("aria-expanded") == "true" and date_field.is_visible() and variety_field.is_visible() and full.is_visible() and selection()["type"] == "bed")
    second = page.locator(planting(next(pid for pid in sample["rows"] if pid != sample["id"])))
    second.click()
    verify("only one row can be open at a time", row.get_attribute("aria-expanded") == "false" and second.get_attribute("aria-expanded") == "true" and date_field.count() == variety_field.count() == 1)
    row.click()
    full.click()
    verify("the full record still opens its existing inspector controls", selection()["type"] == "planting" and page.locator("#fDate").is_visible() and page.locator("#fVariety").is_visible() and page.locator("#fUse").is_visible())
    loc("bed-planting-back").click()
    verify("the bed name returns to the same open row", selection() == {"type": "bed", "id": sample["bed"]} and row.get_attribute("aria-expanded") == "true")

    initial = key()
    old = record(sample["id"])
    variety_field.select_option(sample["replacement"])
    revised = record(sample["id"])
    verify("changing variety writes only the chosen variety and keeps the entered date", revised["varietyId"] == sample["replacement"] and revised["date"] == old["date"])
    undo()
    verify("one Undo restores the planting after a variety change", key() == initial)
    date_field.click()
    choice = page.locator(hook("card-cal-day") + f'[data-day={json.dumps(sample["revised"])}]')
    choice.focus()
    says = loc("card-cal-says").inner_text()
    verify("choosing a calendar day previews when picking starts and when the bed is free before saving", "first pick" in says and "ground free" in says and key() == initial, says)
    page.keyboard.press("Escape")
    verify("Escape closes the calendar, restores focus to the date, and leaves the plan alone", not loc("card-cal").is_visible() and date_field.evaluate("el => document.activeElement === el") and key() == initial)
    date_field.click()
    choice.click()
    verify("changing the date uses the plan's edit path and leaves the variety in place", record(sample["id"])["date"] == sample["revised"] and record(sample["id"])["varietyId"] == old["varietyId"])
    undo()
    verify("one Undo restores the planting after a date change", key() == initial)

    sale = loc("card-sale")
    sale.focus()
    page.keyboard.press("Space")
    impact = loc("card-said") if floating else page.locator("#toast")
    verify("the sale checkbox reports which plantings and season worth changed", not sale.is_checked() and "left out of revenue" in impact.inner_text() and "worth" in impact.inner_text() and "Undo" in impact.inner_text())
    verify("the sale checkbox keeps keyboard focus after it changes", sale.evaluate("el => document.activeElement === el"))
    undo()
    verify("one Undo restores the previous sale status", sale.is_checked() and key() == initial)

    full.click()
    page.locator('#inspectorBody button[aria-label="Close"]').click()
    verify("the full inspector's × closes the selection", selection() is None and not season.is_visible())
    page.evaluate("id => LRFApp.select({type: 'planting', id})", sample["id"])
    if floating:
        loc("card-full").click()
    page.locator('#inspectorBody button[aria-label="Close"]').click()
    verify("the full inspector's × also closes a planting opened directly", selection() is None and not season.is_visible())

    # Two crops share the same painted bed on this date in the bundled farm.
    split_bed = "north-field-1"
    date("2027-04-20")
    page.evaluate("id => LRFMap.fitSpaces([id], false, .6)", split_bed)
    first_fill = page.locator('#mapBeds [data-planting="p0001"]').first
    second_fill = page.locator('#mapBeds [data-planting="p0002"]').first
    first_fill.click()
    first_open = page.locator(planting("p0001")).get_attribute("aria-expanded") == "true"
    second_fill.click()
    verify("the second painted crop in a split bed replaces the first open row",
           first_open and selection() == {"type": "bed", "id": split_bed} and
           page.locator(planting("p0001")).get_attribute("aria-expanded") == "false" and
           page.locator(planting("p0002")).get_attribute("aria-expanded") == "true" and
           loc("bed-planting-date").count() == loc("bed-planting-variety").count() == 1 and key() == initial)

    select_bed(sample["empty"])
    empty_opening = loc("card-opening").first
    empty_opening.click()
    verify("an empty bed's opening opens the full fit planner", selection()["type"] == "opening" and page.locator("#ahTitle").is_visible())
    page.evaluate("""() => {
      const { type, id, bedId } = LRFApp.state.sel;
      LRFApp.select({ type, id, bedId });
    }""")
    verify("an empty bed's opening resolves when reached without the bed-season route", page.locator("#ahTitle").is_visible())
    page.locator("#ahToBed").click()

    layout_bed = "north-field-7"
    def worth():
        return page.evaluate("Math.round(LRFForecast.kept(LRFApp.state.engine).rows.reduce((total, r) => total + r.worth, 0))")

    select_bed(layout_bed)
    loc("card-layout").click()
    length = page.locator("#fLayL")
    before = float(length.input_value())
    was = worth()
    length.fill(str(before - 4))
    length.press("Tab")
    shorten = loc("layout-shorten-impact")
    now = worth()
    verify("shortening a planted bed reports the exact before and after forecast values beside Undo",
           float(length.input_value()) == before - 4 and was != now and shorten.is_visible() and f"goes from ${was:,} to ${now:,}" in shorten.inner_text(), {"before": was, "after": now})
    loc("layout-shorten-undo").click()
    verify("the layout Undo restores the original length, forecast and plan", float(length.input_value()) == before and worth() == was and key() == initial)
    page.locator("#leDone").click()
    verify("Done returns to the same bed's season", selection() == {"type": "bed", "id": layout_bed} and season.is_visible())
    loc("card-layout").click()
    page.keyboard.press("Escape")
    verify("Escape returns to the same bed's season", selection() == {"type": "bed", "id": layout_bed} and season.is_visible())
    loc("card-layout").click()
    page.evaluate("id => LRFMap.fitSpaces([id], false, .65)", split_bed)
    page.locator(f'#mapBeds [data-bed={json.dumps(split_bed)}] .bed-base').click(force=True)
    other_picked = page.evaluate("LRFMapEdit.picked()") == [split_bed]
    page.keyboard.press("Escape")
    verify("Escape clears a different layout pick without closing Edit layout",
           other_picked and page.evaluate("LRFMapEdit.on() && LRFMapEdit.picked().length === 0"))
    page.keyboard.press("Escape")
    verify("Escape after clearing layout picks returns to the original bed", selection() == {"type": "bed", "id": layout_bed} and season.is_visible())
    loc("card-layout").click()
    page.locator("#leClose").click()
    verify("the layout's × leaves no selection", selection() is None and not season.is_visible())

    date(sample["picking"])
    select_bed(sample["bed"])
    failed_date = page.evaluate("""id => {
      const a = LRFApp, p = a.state.engine.planting(id), r = a.state.engine.calc(p);
      const failureDate = LRFEngine.d2s(r.first);
      const change = {workflow: {...p.workflow, outcome: 'failed', failureDate}, done: {...p.done, flip: failureDate}};
      if (a.updatePlanting(id, change, 'Record a legacy failure and clearance')) {
        return LRFUI.day(r.first);
      }
      return null;
    }""", sample["id"])
    failed_marker = row.locator(hook("bed-planting-status") + '[data-state="failed"]')
    strip_title = season.locator(hook("card-year")).evaluate("el => Array.from(el.querySelectorAll('[title]'), item => item.title)")
    verify("an older failed planting has a Failed row and is marked on the season strip",
           failed_date and failed_marker.is_visible() and failed_marker.inner_text() == "Failed" and
           any(f" · Failed {failed_date}" in title for title in strip_title))
    if failed_date:
        undo()
    verify("Undo restores the crop's picking status and plan", key() == initial and picking.is_visible())

    select_bed(sample["bed"])
    second_page = context.new_page()
    load(second_page)
    second_page.wait_for_function("!!LRFApp.windowState()")
    second_page.evaluate("id => { LRFApp.setView('map'); LRFApp.select({type: 'bed', id}); }", sample["bed"])
    second_page.locator(planting(sample["id"])).click()
    verify("a secondary window can browse the season but cannot change date, variety, or sale use", second_page.locator(hook("bed-season")).is_visible() and second_page.locator(hook("bed-planting-date")).is_disabled() and second_page.locator(hook("bed-planting-variety")).is_disabled() and second_page.locator(hook("card-sale")).is_disabled())


def run():
    chrome = os.environ.get("LRF_CHROME", "/usr/bin/google-chrome")
    width = int(os.environ.get("WIDTH", "1280"))
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chrome, args=["--no-sandbox"])
        for floating in (False, True):
            with browser.new_context(viewport={"width": width, "height": 900}) as context:
                run_surface(context, floating)
        browser.close()


try:
    run()
    check("no page errors", not errors, errors)
except Exception as error:
    check("the checks ran to their end", False, str(error))
print(json.dumps({"passed": len(passed), "of": len(passed) + len(failed), "failed": [r["name"] for r in failed], "details": failed}))
sys.exit(bool(failed))
