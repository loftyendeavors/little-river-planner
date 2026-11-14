#!/bin/sh
# The fast checks: no browser, a few seconds each. Each is run on the farm as a backup's plan and as the compact plan the app
# folder ships, where the two could differ. The ones given $OLD also prove that the build moves nothing by itself: every date,
# every piece of ground, every yield and every forecast figure is the build before's.
. "$(dirname "$0")/env.sh"
last() { tail -1; }   # the whole line: the verdict reads its end
node $T/what_changed.cjs $REPO $W/old $SCRATCH | last
# the farm kept in the repository is what its generator writes
rm -rf $W/farm-again && mkdir -p $W/farm-again && cp $FARM/farm-map.jpg $W/farm-again/ && node $T/farm/make_farm.cjs $REPO/js $W/farm-again > /dev/null 2>&1
python3 -I -c "import json,sys,os,filecmp; a,b=sys.argv[1:3]; names=['plan.json','backup-plan.json','inventory.json','packs.json','plan-info.json','layout.json']; bad=[n for n in names if not (os.path.exists(os.path.join(b,n)) and filecmp.cmp(os.path.join(a,n),os.path.join(b,n),shallow=False))]; print(json.dumps({'passed': len(names)-len(bad), 'of': len(names), 'failed': ['tests/farm/data/%s is what make_farm.cjs writes' % n for n in bad], 'name': 'the made-up farm'}))" $FARM $W/farm-again
node $T/rockwool_test.cjs $APP $PLAN | last
node $T/step1_test.cjs $APP $PLAN | last
node $T/step1_test.cjs $APP $SHIP | last
node $T/step3a_test.cjs $APP $PLAN $OLD | last
node $T/step3a_test.cjs $APP $SHIP $OLD | last
node $T/step3b_test.cjs $APP $PLAN $OLD | last
node $T/step3b_test.cjs $APP $SHIP $OLD | last
node $T/step5a_test.cjs $APP $PLAN $OLD | last
node $T/step5a_test.cjs $APP $SHIP $OLD | last
node $T/step5b_test.cjs $APP $PLAN $OLD | last
node $T/step5b_test.cjs $APP $SHIP $OLD | last
node $T/succession_test.cjs $APP $SHIP | last
node $T/waiting_test.cjs $APP $PLAN | last
node $T/waiting_test.cjs $APP $SHIP | last
node $T/stepF_test.cjs $APP $PLAN $OLD | last
node $T/stepF_test.cjs $APP $SHIP $OLD | last
node $T/rails_test.cjs $APP $PLAN | python3 -I -c "import json,sys; d=json.load(sys.stdin); print(json.dumps({'passed': d['passed'], 'of': d['checks'], 'failed': d['failed'], 'name': 'rails'}))"
node $T/assume_test.cjs $APP $PLAN | python3 -I -c "import json,sys; d=json.load(sys.stdin); print(json.dumps({'passed': d['passed'], 'of': d['checks'], 'failed': d['failed'], 'name': 'assume'}))"
node $REPO/tools/mapgeo_test.cjs | last
(cd $REPO && node tools/reader_test.mjs 2>&1 | last; node tools/worker_test.mjs 2>&1 | last; node tools/sync_worker_test.mjs 2>&1 | tail -1 | sed 's/^/sync worker /'; node tools/sync_client_test.mjs $APP/js 2>&1 | tail -1 | sed 's/^/sync client /')
