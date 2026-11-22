"""Grower workflows on the fictional farm. Run against the prepared app folder."""
import functools
import http.server
import json
from pathlib import Path
import sys
import threading

from playwright.sync_api import sync_playwright


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


target = Path(sys.argv[1])
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=target))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_port}/"
passed = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1480, "height": 950})
    errors = []
    page.set_default_timeout(6000)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.clock.set_fixed_time("2027-06-01T16:00:00Z")
    page.goto(url)
    page.wait_for_function("window.LRFApp?.state.ready")
    page.evaluate("""() => {
      const A = LRFApp, eng = A.state.engine;
      const source = eng.plan.plantings.find(p => eng.isTower(eng.bedOf(p.bedId)) && p.towerCycle && eng.crop(p.cropId).tower);
      const tower = eng.bedOf(source.bedId), crop = eng.crop(source.cropId);
      const run = {id:'check-saved-run', cropId: crop.id, kind:'tower', by:'beds', datesFor:'planting',
        from:'2027-03-01', to:'2027-04-19', every:7, wholeBeds:true};
      const ops = [], members = [];
      for (let i=0; i<8; i++) {
        const bed = {...tower, id:'check-run-tower-'+i, bed:'Test tower '+(i+1), sites:42};
        ops.push({kind:'bed', before:null, after:bed});
        const date = LRFEngine.d2s(LRFEngine.addDays(LRFEngine.s2d(run.from), i*7));
        const p = {id:'check-member-'+i, bedId:bed.id, cropId:crop.id, date, towerUsedSites:42,
          towerCycle:{v:1,days:28,nurseryDays:17,replantSameDay:true}, run:{id:run.id,n:i+1,gap:7}};
        if (i<2) p.done = {sow:'2027-02-12'};
        members.push(p); ops.push({before:null, after:p});
      }
      ops.push({kind:'own',key:'runs',before:null,after:[run]});
      A.commit('Prepare tower run',ops,{unchecked:true});
      window.testKey = A.contentKey();
      A.setView('succession');
    }""")
    hook = lambda name: page.locator(f'[data-hook="{name}"]')
    page.locator('[data-hook="succ-run"][data-run="check-saved-run"]').click()
    hook("succ-edit").click()
    page.get_by_label("Shift planting dates by days").fill("7")
    assert page.get_by_role("dialog").get_by_text("Recorded", exact=True).count() == 2
    assert hook("succ-edit-apply").is_enabled(), [errors, page.get_by_role("dialog").inner_text()]
    assert page.get_by_role("dialog").locator("details li").count() > 0
    hook("succ-edit-apply").click()
    dates = page.evaluate("LRFSuccession.runPlantings(LRFApp.state.plan,'check-saved-run').map(p=>p.date)")
    assert dates[:3] == ["2027-03-01","2027-03-08","2027-03-22"]
    hook("succ-undo").click()
    assert page.evaluate("LRFApp.contentKey() === window.testKey")
    passed.append("Seven-day change, weekly forecast, recorded work and one-step undo")
    page.evaluate("""() => {
      const A=LRFApp, p=A.state.engine.planting('check-member-7');
      const blocker={...p,id:'check-next-crop',date:LRFEngine.d2s(LRFEngine.addDays(A.state.engine.occupancyThrough(p,A.state.engine.calc(p)),2))};
      delete blocker.run; A.commit('Plant the following crop',[{before:null,after:blocker}]);
    }""")
    hook("succ-edit").click()
    page.get_by_label("Shift planting dates by days").fill("7")
    assert not hook("succ-edit-apply").is_enabled()
    assert "overlap" in page.get_by_role("alert").inner_text()
    page.get_by_label("Skip sowing 8", exact=True).check()
    assert hook("succ-edit-apply").is_enabled()
    page.get_by_label("Days between planting slots").fill("8")
    hook("succ-edit-apply").click()
    assert page.evaluate("LRFSuccession.runPlantings(LRFApp.state.plan,'check-saved-run').length===7")
    passed.append("Conflicting tower, skip, and change interval")
    page.evaluate("LRFApp.setView('harvest')")
    hook("fc-buyers").click()
    sale = page.evaluate("""() => {
      const m=LRFHarvestView.model('commercial'), E=LRFEngine, F=LRFForecast;
      const r=m.rows.find(r=>r.total>0 && !r.thing && LRFSuccessions.plans(LRFApp.state.engine,LRFApp.state.engine.crop(r.cropId)) && r.unit===LRFApp.state.engine.unitOf(LRFApp.state.engine.crop(r.cropId)));
      const w=F.periods(m,'week').find(w=>w.i1-w.i0===6 && F.sum(r.days,w.i0,w.i1)>1);
      return {key:r.key, week:w.key, have:F.sendShown(F.sum(r.days,w.i0,w.i1),r.unit)};
    }""")
    page.get_by_label("Demand product").select_option(sale["key"])
    page.get_by_label("Demand week").select_option(sale["week"])
    page.get_by_label("Buyer",exact=True).fill("First test buyer")
    page.get_by_role("spinbutton",name="Ordered quantity").fill(str(sale["have"]))
    page.get_by_role("button",name="Add buyer").click()
    page.get_by_label("Buyer",exact=True).last.fill("Second test buyer")
    page.get_by_role("spinbutton",name="Ordered quantity").last.fill("14")
    assert "14 more needed" in page.get_by_role("dialog").get_by_role("status").inner_text()
    page.get_by_role("button", name="Save and plan the shortfall").click()
    assert page.locator("#suWant").input_value() == "14"
    assert page.evaluate("LRFApp.state.plan.lrfNext.buyerDemand.length") == 2
    page.evaluate("LRFApp.setView('harvest')")
    hook("fc-buyers").click()
    page.get_by_label("Demand product").select_option(sale["key"])
    page.get_by_label("Demand week").select_option(sale["week"])
    assert page.get_by_label("Buyer",exact=True).last.input_value() == "Second test buyer"
    page.get_by_role("spinbutton",name="Ordered quantity").last.fill("0")
    assert not page.get_by_role("button", name="Save and plan the shortfall").is_enabled()
    page.get_by_role("button",name="Save demand",exact=True).click()
    assert page.evaluate("LRFApp.state.plan.lrfNext.buyerDemand.length") == 1
    passed.append("Buyer totals, covered demand, and only the shortfall goes to Successions")
    page.set_viewport_size({"width":390,"height":844})
    page.evaluate("LRFApp.setView('sow')")
    hook("task-pick").click()
    page.get_by_label("Harvest date").fill("2027-05-10")
    page.get_by_label("Find planting").fill("Test tower 3")
    page.get_by_label("Harvest planting").select_option("check-member-2")
    page.get_by_label("Marketable quantity").fill("72")
    page.get_by_label("Cull quantity").fill("8")
    hook("pick-save").click()
    assert page.evaluate("LRFApp.harvestEntries().length") == 1
    hook("task-pick").click()
    page.get_by_label("Harvest date").fill("2027-05-10")
    assert "72 marketable, 8 culls" in page.get_by_role("dialog").inner_text()
    page.get_by_role("button",name="Close",exact=True).click()
    page.set_viewport_size({"width":1480,"height":950})
    page.evaluate("LRFApp.setView('harvest')")
    hook("fc-recorded").click()
    assert "72 marketable · 8 culls · forecast picking" in page.get_by_role("dialog").inner_text()
    page.get_by_role("button",name="Done",exact=True).click()
    assert page.evaluate("LRFApp.editMembers('check-saved-run',{}).find(x=>x.p.id==='check-member-2').locked")
    assert not page.evaluate("LRFApp.updatePlanting('check-member-2',{date:'2027-03-23'},'Move picked planting')")
    passed.append("Phone harvest, re-opened record, forecast comparison and protection")
    page.evaluate("LRFApp.setView('trays'); LRFTraysView.setTab('room')")
    peak = page.evaluate("""() => {
      const fig=LRFBench.figures(), eng=LRFApp.state.engine;
      const week = fig.weeks.reduce((a,w)=>w.pools?.heated.used > (a?.pools?.heated.used || 0) ? w : a,null);
      const p = week.pools.heated, day=eng.benchDay(p.date,true);
      for(const k of ['heated','unheated','outside']) if (Math.abs(day.items.reduce((n,i)=>n+i.space[k],0)-day.pools[k].used)>1e-6) throw Error('Contributions do not reconcile');
      return {week:week.week, used:LRFUI.num(p.used,1), cap:LRFUI.num(p.cap,1)};
    }""")
    col = page.locator('[data-pool="heated"] [data-hook="bench-week"][data-week="'+peak["week"]+'"]').first
    col.press("Enter")
    info=hook("bench-week-details")
    assert peak["used"]+" of "+peak["cap"]+" tray spaces" in info.inner_text()
    info.locator("summary").first.click()
    assert "leaves nursery" in info.inner_text()
    page.get_by_role("button",name="Done",exact=True).click()
    passed.append("Pool-specific peak, batch spaces, whole trays, release dates and keyboard access")

    with page.expect_download() as download:
        page.evaluate("LRFApp.exportBackup()")
    backup = json.loads(Path(download.value.path()).read_text())
    owned = backup["lrfNextKeep"]["keep"]
    assert len(owned["harvestEntries"]) == 1 and len(owned["buyerDemand"]) == 1
    restored = browser.new_page()
    restored.goto(url)
    restored.wait_for_function("window.LRFApp?.state.ready")
    assert restored.evaluate("""async backup => LRFApp.importBackup(new File([JSON.stringify(backup)],'example.json',{type:'application/json'}),{quiet:true,asked:true})""",backup)
    assert restored.evaluate("LRFApp.harvestEntries()[0].marketable") == 72
    assert restored.evaluate("LRFApp.state.plan.lrfNext.buyerDemand.length") == 1
    assert restored.evaluate("LRFSuccession.runPlantings(LRFApp.state.plan,'check-saved-run').length") == 7
    passed.append("Downloaded JSON backup restores the edited run, buyers and actual picking")

    page.clock.set_fixed_time("2027-12-31T16:00:00Z")
    sale = page.evaluate("""async () => {
      const A = LRFApp, F = LRFForecast, E = LRFEngine;
      await A.setSell('basil', {pattern:'once', keep:3, days:1}, 'Test basil kept for three weeks');
      const m = LRFHarvestView.model('commercial'), row = m.rows.find(r => r.key === 'basil|lb');
      const weeks = F.periods(m, 'week'), col = weeks.find(w => F.sum(row.picked,w.i0,w.i1) === 0 && F.sum(row.days,w.i0,w.i1) > 2);
      if (!col) throw Error('Test crop needs a week of stock carried from an earlier picking');
      const source = row.plantings[0].p, own = {...source, id:'check-personal-basil', use:'personal'};
      A.commit('Prepare a household planting', [{before:null,after:own}], {unchecked:true});
      const eng = A.state.engine, bed = eng.bedOf(source.bedId);
      const winter = {...eng.gardenOf(bed), id:'check-winter-garden', frost:false};
      const space = {...bed, id:'check-winter-bed', gardenId:winter.id};
      const dec = {...source, id:'check-dec-basil', bedId:space.id, date:'2026-12-29', timingMode:'manual', dtm:1};
      const jan = {...dec, id:'check-jan-basil', date:'2027-01-01'};
      A.commit('Prepare two winter pickings', [{kind:'garden',before:null,after:winter},{kind:'bed',before:null,after:space},
        {before:null,after:dec},{before:null,after:jan}], {unchecked:true});
      function pick(id, plantingId, date, marketable, culls) {
        if (!A.recordHarvest({id,plantingId,date,thing:'',unit:'lb',marketable,culls})) throw Error('Could not record ' + id);
      }
      const first = E.d2s(col.start), last = E.d2s(col.end);
      pick('check-basil-first', source.id, first, 2.25, 1.25);
      pick('check-basil-last', source.id, last, 3.5, 0);
      pick('check-basil-next', source.id, E.d2s(E.addDays(col.end,1)), 20, 0);
      pick('check-basil-household', own.id, first, 90, 0);
      pick('check-basil-december', source.id, '2026-12-31', 7, 1);
      pick('check-basil-january', source.id, '2027-01-01', 3, 2);
      pick('check-basil-culls', source.id, '2027-01-04', 0, 6);
      // Existing entries can name a former selling form or unit after the grower changes how a crop is sold.
      const entries = A.harvestEntries(), example = entries.find(x => x.id === 'check-basil-first');
      A.commit('Prepare earlier products', [{kind:'own',key:'harvestEntries',before:entries,after:[...entries,
        {...example,id:'check-form',thing:'check-form',name:'Earlier pack',marketable:50,culls:0},
        {...example,id:'check-unit',unit:'bunch',marketable:40,culls:0}]}]);
      A.setView('harvest');
      return {week:col.key, firstWeek:weeks[0].key, cullWeek:weeks[1].key, emptyWeek:weeks[2].key,
        available:F.sendShown(F.sum(row.days,col.i0,col.i1),row.unit)};
    }""")
    hook("fc-buyers").click()
    page.get_by_label("Demand product").select_option("basil|lb")
    page.get_by_label("Demand week").select_option(sale["week"])
    comparison = hook("fc-week-comparison")
    assert "Forecast picking 0 lb" in comparison.inner_text()
    assert "5.75 marketable picked · 1.25 culls" in comparison.inner_text().splitlines()
    amount = page.get_by_role("spinbutton",name="Ordered quantity")
    amount.fill("2.5")
    page.get_by_role("button",name="Add buyer").click()
    amount.last.fill("1.25")
    assert "3.75 ordered" in comparison.inner_text() and "Marketable picking 5.75 lb above forecast · 2 lb above orders" in comparison.inner_text()
    amount.last.fill(str(sale["available"] + 5))
    assert "7.5 more needed" in comparison.inner_text()
    page.get_by_role("button",name="Cancel",exact=True).click()
    hook("fc-buyers").click()
    page.get_by_label("Demand product").select_option("basil|lb|check-form")
    page.get_by_label("Demand week").select_option(sale["week"])
    assert "50 marketable picked · 0 culls" in comparison.inner_text() and "0 forecast available" in comparison.inner_text()
    page.get_by_label("Demand product").select_option("basil|lb")
    page.get_by_label("Demand week").select_option(sale["firstWeek"])
    assert "Dec 28, 2026 – Jan 3, 2027" in page.get_by_label("Demand week").locator("option:checked").inner_text()
    page.get_by_label("Buyer",exact=True).fill("Winter test buyer")
    amount.fill("10")
    assert "10 marketable picked · 3 culls" in comparison.inner_text().splitlines() and "· matches orders" in comparison.inner_text()
    assert "10 ordered · 18 forecast available · 8 above orders" in comparison.inner_text()
    assert "Marketable picking 98 lb below forecast · matches orders" in comparison.inner_text()
    page.get_by_role("button",name="Save demand",exact=True).click()
    hook("fc-buyers").click()
    page.get_by_label("Demand product").select_option("basil|lb")
    page.get_by_label("Demand week").select_option(sale["cullWeek"])
    assert "0 marketable picked · 6 culls" in comparison.inner_text()
    page.get_by_label("Demand week").select_option(sale["emptyWeek"])
    assert "No commercial harvest recorded" in comparison.inner_text()
    page.get_by_role("button",name="Cancel",exact=True).click()
    page.evaluate("""() => {const A=LRFApp, before=A.state.plan.settings;
      A.commit('View previous calendar year',[{kind:'settings',before,after:{...before,year:2026}}]);}""")
    hook("fc-buyers").click()
    page.get_by_label("Demand product").select_option("basil|lb")
    page.get_by_label("Demand week").select_option(sale["firstWeek"])
    assert amount.input_value() == "10" and "10 marketable picked · 3 culls" in comparison.inner_text().splitlines()
    assert "10 ordered · 18 forecast available · 8 above orders" in comparison.inner_text()
    assert "Marketable picking 98 lb below forecast · matches orders" in comparison.inner_text()
    amount.fill("27")
    page.get_by_role("button",name="Save and plan the shortfall").click()
    assert page.locator("#suWant").input_value() == "9"
    passed.append("Commercial week compares demand, kept stock and actual harvest by product, unit and date")
    assert not errors, errors
    browser.close()
server.shutdown()
print(json.dumps({"passed":len(passed), "of":len(passed), "failed":[]}))
