#!/bin/sh
# The fast checks: no browser, a few seconds each. Each is run on the farm as a backup's plan and as the compact plan the app
# folder ships, where the two could differ. The ones given $OLD also prove that the build moves nothing by itself: every date,
# every piece of ground, every yield and every forecast figure is the build before's.
# Each result is given the name its lines are counted under in tests/counts.json ("named", in env.sh).
. "$(dirname "$0")/env.sh"
node $T/what_changed.cjs $REPO $W/old $SCRATCH | named "what the build changed"
node $T/shared_test.cjs $REPO $FONTS | named "the files the merge writes"   # tools/shared.cjs and tools/take_main.cjs, on a copy with a main of its own
node $T/take_main_job_test.cjs $REPO | named "the job that takes main in"   # no code of a branch runs where a key can write
node $T/hooks_test.cjs $REPO | named "hooks"   # every hook a check reads is written by the planner, and nothing styles one
# the farm kept in the repository is what its generator writes
rm -rf $W/farm-again && mkdir -p $W/farm-again && cp $FARM/farm-map.jpg $W/farm-again/ && node $T/farm/make_farm.cjs $REPO/js $W/farm-again > /dev/null 2>&1
python3 -I $T/farm/make_pictures.py $W/farm-again > /dev/null 2>&1   # the pictures are compared by which varieties have one, not byte for byte: a newer drawing library may pack a picture differently
python3 -I - $FARM $W/farm-again <<'PY' | named "the made-up farm"
import json, sys, os, filecmp
a, b = sys.argv[1:3]; names = ['plan.json', 'backup-plan.json', 'inventory.json', 'packs.json', 'plan-info.json', 'layout.json']
bad = ['tests/farm/data/%s is what make_farm.cjs writes' % n for n in names if not (os.path.exists(os.path.join(b, n)) and filecmp.cmp(os.path.join(a, n), os.path.join(b, n), shallow=False))]
try: same = sorted(json.load(open(os.path.join(a, 'thumbs.json')))) == sorted(json.load(open(os.path.join(b, 'thumbs.json'))))
except Exception: same = False
if not same: bad.append('tests/farm/data/thumbs.json has a picture for the varieties make_pictures.py draws one for, and no other')
print(json.dumps({'passed': len(names) + 1 - len(bad), 'of': len(names) + 1, 'failed': bad}))
PY
# "backup" is the farm as a full backup's plan, "compact" the plan the app folder ships
node $REPO/tools/scale.mjs check $REPO | named "scale"   # every size, corner and speed of the style sheet is a step of the one scale (DESIGN.md)
node $T/rockwool_test.cjs $APP $PLAN | named "rockwool"
node $T/step1_test.cjs $APP $PLAN | named "step1, backup"
node $T/step1_test.cjs $APP $SHIP | named "step1, compact"
node $T/step3a_test.cjs $APP $PLAN $OLD | named "step3a, backup"
node $T/step3a_test.cjs $APP $SHIP $OLD | named "step3a, compact"
node $T/step3b_test.cjs $APP $PLAN $OLD | named "step3b, backup"
node $T/step3b_test.cjs $APP $SHIP $OLD | named "step3b, compact"
node $T/step5a_test.cjs $APP $PLAN $OLD | named "step5a, backup"
node $T/step5a_test.cjs $APP $SHIP $OLD | named "step5a, compact"
node $T/step5b_test.cjs $APP $PLAN $OLD | named "step5b, backup"
node $T/step5b_test.cjs $APP $SHIP $OLD | named "step5b, compact"
node $T/succession_test.cjs $APP $SHIP | named "succession"
node $T/waiting_test.cjs $APP $PLAN | named "waiting, backup"
node $T/waiting_test.cjs $APP $SHIP | named "waiting, compact"
node $T/stepF_test.cjs $APP $PLAN $OLD | named "stepF, backup"
node $T/stepF_test.cjs $APP $SHIP $OLD | named "stepF, compact"
node $T/look_a_test.cjs $APP $PLAN | named "look-a, backup"
node $T/look_a_test.cjs $APP $SHIP | named "look-a, compact"
node $T/things_test.cjs $APP $PLAN $OLD | named "things, backup"
node $T/things_test.cjs $APP $SHIP $OLD | named "things, compact"
node $T/frost_test.cjs $APP $PLAN | named "frost, backup"   # E2c: the first fall frost in open ground, and a last picking for each place
node $T/frost_test.cjs $APP $SHIP | named "frost, compact"
node $T/swap_test.cjs $APP $PLAN | named "swap, backup"   # the variety swap: the sowing days kept, the harvest moved by the difference in days
node $T/swap_test.cjs $APP $SHIP | named "swap, compact"
node $T/failed_test.cjs $APP $PLAN $OLD | named "failed, backup"   # Tasks part 2: a planting marked failed (its bed free from that day, its harvest off the forecast, taken whole by the merge), and a day a year before its plan refused
node $T/failed_test.cjs $APP $SHIP $OLD | named "failed, compact"
node $T/year_edge_test.cjs $APP $PLAN $OLD | named "year edge, backup"   # the year's edge: a December sowing for January's trays counted once in Seeds and on Tasks, stock carried in across Jan 1, the plan's own end; nothing else moves
node $T/year_edge_test.cjs $APP $SHIP $OLD | named "year edge, compact"
node $T/rails_test.cjs $APP $PLAN | named "rails"
node $T/assume_test.cjs $APP $PLAN | named "assume"
node $T/merge_test.cjs $APP $PLAN $FARM/inventory.json | named "merge"   # two copies of one plan joined, record by record: the rules, the five tests, 500 pairs of runs of edits
node $T/shape_test.cjs $APP $PLAN $FARM/inventory.json $SCRATCH | named "shape"   # the plan's shape written down (plan_shape.cjs), held to itself, to the merge's own rules and to the farm and the planner's own edits
node $T/store_test.cjs $APP | named "store"   # saving with two windows of one browser open: the count beside the plan, the one window that holds it
node $T/snaps_test.cjs $APP | named "snapshots kept"   # which snapshots stay: the plans kept before a taking-in from another device have a rule of their own
node $REPO/tools/mapgeo_test.cjs | named "map geometry"
(cd $REPO && node tools/reader_test.mjs 2>&1 | named "page reader"; node tools/worker_test.mjs 2>&1 | named "fetch service"; node tools/sync_worker_test.mjs 2>&1 | named "sync service"; node tools/sync_client_test.mjs $APP/js $OLD 2>&1 | named "sync client")
