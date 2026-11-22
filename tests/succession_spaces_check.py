"""Exercise tower, container and bench succession runs in Chromium using only the made-up farm.

Usage: python3 -I tests/succession_spaces_check.py <app folder or built site> <shots folder> [backup.zip]
"""
import functools
import http.server
import json
import os
from pathlib import Path
import sys
import threading

from playwright.sync_api import sync_playwright

target, shots = map(Path, sys.argv[1:3])
backup = sys.argv[3] if len(sys.argv) > 3 else None


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


# A mixed garden has an unrelated field bed, 36 towers providing 42 sites each, twelve container
# spaces and a physical twelve-tray bench. On June 1, existing plantings leave room for exactly one
# sowing of each source. A second sowing on June 2 must be reported as unplaced.
FIXTURE = """() => {
  const A = LRFApp, eng = A.state.engine, base = A.state.plan;
  const example = base.plantings.find(p => eng.isTower(eng.bedOf(p.bedId)) && p.towerCycle && eng.crop(p.cropId).tower);
  const crate = base.beds.find(b => eng.isCt(b)), micro = eng.crops().find(c => c.micro && c.dtm > 0);
  if (!example || !crate || !micro) throw Error('The test farm must contain a tower crop, a container and a live-tray crop.');
  const year = A.planYear(), gardenId = 'test-mixed-spaces', tower = eng.bedOf(example.bedId);
  const garden = {...eng.gardenOf(tower), id: gardenId, name: 'Mixed test garden', type: 'greenhouse', frost: false};
  const reserve = {...garden, id:'test-reserve-spaces', name:'Reserve test garden'};
  const ops = [garden, reserve].map(after => ({kind:'garden', before:null, after}));
  const bed = (id, changes) => {
    const after = {...tower, id, gardenId, bed: id, ...changes};
    ops.push({kind: 'bed', before: null, after}); return id;
  };
  const planting = (id, bedId, date, cropId, fields) => {
    ops.push({before: null, after: {id, bedId, date: year + date, cropId, ...fields}});
    return id;
  };
  const towers = Array.from({length: 36}, (_, i) => bed('test-tower-' + i, {type:'42 Site', sites:42}));
  const containers = bed('test-container-group', {type:'CT', ct:crate.ct, count:12});
  const bench = bed('test-physical-bench', {type:'Bench', trays:12});
  bed('test-field-bed', {type:'Bed', w:3.5, l:50});
  for (const [kind, dimensions] of Object.entries({tower:{type:'42 Site',sites:42}, containers:{type:'CT',ct:crate.ct,count:12}, bench:{type:'Bench',trays:12}}))
    bed('reserve-' + kind, {...dimensions, gardenId:reserve.id});
  const cycle = {v:1, days:28, nurseryDays:17, replantSameDay:true};
  const grow = {varietyId:example.varietyId, dtm:28, hw:1, harvestMode:'window', turnover:0};
  const source = {
    tower: planting('test-source-tower', towers[0], '-03-10', example.cropId, {...grow, towerCycle:cycle, towerUsedSites:21}),
    containers: planting('test-source-containers', containers, '-03-10', example.cropId, {...grow, ft:3, perC:2}),
    bench: planting('test-source-bench', bench, '-03-10', micro.id, {trays:3, dtm:13, hw:1})
  };
  for (const id of towers.slice(0, -1)) planting('occupied-' + id, id, '-06-01', example.cropId, {...grow, towerCycle:cycle});
  planting('occupied-containers', containers, '-06-01', example.cropId, {...grow, ft:9});
  planting('occupied-bench', bench, '-06-01', micro.id, {trays:9, dtm:13, hw:1});
  if (!A.commit('Prepare the made-up garden', ops, {unchecked:true})) throw Error('Fixture not loaded');
  return {year, source, gardenId, reserve:reserve.id, reserveName:reserve.name, expected:{tower:towers.at(-1), containers, bench}};
}"""

READ_MEMBER = """id => {
  const e=LRFApp.state.engine, p=e.planting(id);
  if (!p) return null;
  const r=e.calc(p), s=r.sowing;
  return {id:p.id, crop:p.cropId, variety:p.varietyId || '', date:p.date, bed:p.bedId,
    kind:e.spaceKind(r.b), run:p.run, capacity:e.capOf(r.b), space:r.physicalLength,
    plants:r.plants, perC:p.perC, cycle:p.towerCycle, trays:p.trays,
    sow:LRFEngine.d2s(r.sow || r.field), medium:s && s.medium, cells:s && s.cells,
    batchIds:s && s.memberIds, sheetCells:s && s.tray && s.tray.cells,
    batchPlants:s?.batch?.targetPlants, batchCells:s?.batch?.cells, sheets:s?.batch?.trays};
}"""


def run_case(page, fixture, kind, check):
    def hook(name):
        return page.locator('[data-hook="' + name + '"]')

    def value(expression, arg=None):
        return page.evaluate(expression, arg)

    def set_field(name, text):
        field = hook(name)
        field.fill(str(text))
        field.dispatch_event('change')

    def open_kept(run_id):
        page.locator('[data-hook="view-tab"][data-view-btn="succession"]').click()
        hook('succ-run').and_(page.locator('[data-run="' + run_id + '"]')).click()

    def undo_depth():
        return value('LRFApp.state.undo.length')

    before = value('LRFApp.contentKey()')
    depth = undo_depth()
    source = fixture['source'][kind]
    expected_bed = fixture['expected'][kind]
    start = str(fixture['year']) + '-06-01'
    end = str(fixture['year']) + '-06-02'
    value("id => {LRFApp.setView('map'); LRFApp.select({type:'planting', id});}", source)
    hook('panel-succession').click()
    page.wait_for_selector('[data-hook="succ-every"]')
    draft = value('({...LRFSuccessions.state.D})')
    correct_source = (draft['kind'], draft['sourceId'], draft['gardenId']) == (kind, source, fixture['gardenId'])
    amount = hook('succ-plan-by').locator('[data-value="amount"]')
    check('the source planting opens its own garden, space kind and planning method',
          correct_source and (kind != 'bench' or not amount.count() or amount.is_disabled()), draft)
    # Set the end first so neither field passes through a reversed interval.
    set_field('succ-to', end)
    set_field('succ-from', start)
    set_field('succ-every', 1)
    rows = hook('succ-row')
    preview = rows.evaluate_all("els => els.map(el => ({n:+el.dataset.n,bed:el.dataset.bed}))")
    unplaced = hook('succ-unplaced').evaluate_all("els => els.map(el => +el.dataset.n)")
    explanation = hook('succ-unplaced').all_text_contents()
    check('the first sowing fits and the unplaced date names the reserve garden',
          preview == [{'n': 1, 'bed': expected_bed}] and unplaced == [2]
          and any(fixture['reserveName'] in message for message in explanation), [preview, unplaced, explanation])
    reserve = hook('succ-then-garden').and_(page.locator('[data-garden="' + fixture['reserve'] + '"]'))
    reserve.click()
    overflow = rows.evaluate_all("els => els.map(el => el.dataset.bed)")
    reserve.click()
    check('trying the suggested garden puts the second sowing in the right kind of space without changing the plan',
          overflow == [expected_bed, 'reserve-' + kind] and hook('succ-unplaced').count() == 1
          and value('LRFApp.contentKey()') == before and undo_depth() == depth, overflow)
    hook('succ-add').click()
    page.wait_for_selector('[data-hook="succ-kept-row"]')
    saved = value("""() => {const A=LRFApp, r=A.runs().at(-1);
      return {id:r.id, kind:r.kind, source:r.sourceId, ids:A.state.plan.plantings.filter(p=>p.run?.id===r.id).map(p=>p.id)};}""")
    check('Add saves the one placed sowing in a kept run as one step',
          saved['kind'] == kind and saved['source'] == source and len(saved['ids']) == 1
          and hook('succ-kept-row').count() == 1 and undo_depth() == depth + 1, saved)
    member = saved['ids'][0]
    initial = value(READ_MEMBER, member)
    if kind == 'tower':
        quantity_ok = (initial['capacity'] == initial['plants'] == 42 and initial['cycle']['days'] == 28
                       and initial['medium'] == 'rockwool' and initial['cells'] >= 42
                       and initial['sow'] == str(fixture['year']) + '-05-15'
                       and initial['sheetCells'] == 98 and member in initial['batchIds']
                       and initial['batchPlants'] == 36 * 42 and initial['sheets'] == (initial['batchCells'] + 97) // 98)
    elif kind == 'containers':
        quantity_ok = initial['space'] == 3 and initial['capacity'] == 12 and initial['perC'] == 2 and initial['plants'] == 6
    else:
        quantity_ok = initial['trays'] == initial['space'] == 3 and initial['capacity'] == 12
    check('the planting uses the promised capacity, source settings and date',
          quantity_ok and initial['kind'] == kind and initial['bed'] == expected_bed and initial['date'] == start, initial)
    hook('succ-kept-link').click()
    hook('panel-more').click()
    hook('card-menu-item').and_(page.locator('[data-act="wait"]')).click()
    held = value('id => LRFApp.waitingOne(id)', member)
    check('sending the planting to To place keeps its run number and takes it out of production',
          held and held['run'] == initial['run'] and value(READ_MEMBER, member) is None and undo_depth() == depth + 2, held)
    open_kept(saved['id'])
    check('the kept run counts its waiting member and offers to remove it',
          hook('succ-kept-waiting').is_visible() and '1 planting' in hook('succ-kept-waiting').inner_text()
          and hook('succ-remove-all').is_visible())
    page.locator('#waitBadge').click()
    waiting_row = hook('waiting-row').and_(page.locator('[data-waiting="' + member + '"]'))
    unit = {'tower': 'One tower', 'containers': '3 containers', 'bench': '3 trays'}[kind]
    label_ok = unit in waiting_row.inner_text()
    waiting_row.click()
    label_ok = label_ok and page.get_by_text(unit, exact=True).is_visible() and not page.locator('#wtFt').count()
    home = page.locator('[data-home="' + expected_bed + '"]')
    if not home.count() and page.locator('#wtMore').count():
        page.locator('#wtMore').click()
    home.click()
    page.wait_for_function('id => !!LRFApp.state.engine.planting(id)', arg=member)
    restored = value(READ_MEMBER, member)
    check('placing it back restores the same date, crop, variety, quantity, seedling and run figures',
          restored == initial and label_ok and not value('id => !!LRFApp.waitingOne(id)', member), [initial, restored, label_ok])
    open_kept(saved['id'])
    hook('succ-remove-all').check()
    hook('succ-remove').click()
    check('removing the run and its plantings takes out its sole member in one step',
          value('id => !LRFApp.runs().some(r=>r.id===id)', saved['id'])
          and value(READ_MEMBER, member) is None and undo_depth() == depth + 4)
    hook('succ-undo').click()
    recovered = value(READ_MEMBER, member)
    for _ in range(3):
        page.locator('#undoBtn').click()
    check('Undo restores the complete member and undoing the other steps restores the starting plan',
          recovered == initial and undo_depth() == depth and value('LRFApp.contentKey()') == before, recovered)


def main():
    failures, errors = [], []
    count = 0
    shots.mkdir(parents=True, exist_ok=True)
    serve = functools.partial(Quiet, directory=str(target))
    with http.server.ThreadingHTTPServer(('127.0.0.1', 0), serve) as server, sync_playwright() as pw:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        for kind in ('tower', 'containers', 'bench'):
            def check(name, ok, detail=None):
                nonlocal count
                count += 1
                if not ok:
                    failures.append(f'{kind}: {name}')
                if not ok or os.environ.get('LIVE'):
                    print(('ok' if ok else 'FAIL'), kind, name, '' if ok else detail, file=sys.stderr, flush=True)
            context = browser.new_context(viewport={'width': int(os.environ.get('WIDTH', 1480)), 'height':1000})
            page = context.new_page()
            page.set_default_timeout(20000)
            page.on('pageerror', lambda e: errors.append(str(e)))
            try:
                page.goto(f'http://127.0.0.1:{server.server_address[1]}/index.html')
                page.wait_for_function('window.LRFApp && LRFApp.state.ready')
                if backup and page.evaluate('LRFApp.isSample()'):
                    page.set_input_files('#importFile', backup)
                    page.wait_for_function("!LRFApp.isSample() || !!document.querySelector('dialog[open] .btn.primary')", timeout=60000)
                    confirm = page.locator('dialog[open] .btn.primary')
                    if confirm.count():
                        confirm.click()
                    page.wait_for_function('LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()', timeout=60000)
                fixture = page.evaluate(FIXTURE)
                run_case(page, fixture, kind, check)
            except Exception as exc:
                check('workflow completed', False, str(exc))
                page.screenshot(path=str(shots / f'succession-{kind}-failed.png'))
            finally:
                context.close()
        browser.close()
    count += 1
    if errors:
        failures.append('no browser errors: ' + ', '.join(errors))
    print(json.dumps({'passed': count - len(failures), 'of': count, 'failed': failures}))
    return int(bool(failures))


if __name__ == '__main__':
    sys.exit(main())
