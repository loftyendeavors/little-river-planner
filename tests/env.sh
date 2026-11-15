# Where everything is. Read by the other scripts in this folder: . "$(dirname "$0")/env.sh"
# Nothing here is tied to one computer: the repository is found from this file's own place, and the work folder can be put
# anywhere with LRF_WORK (it is made by setup.sh and can be thrown away).
REPO=${LRF_REPO:-$(cd "$(dirname "$0")/.." && pwd)}
W=${LRF_WORK:-/tmp/lrf-work}
T=$REPO/tests
APP=$W/app                               # the app folder: the planner's code with the made-up farm as its data
SITE=$REPO                               # the built site is the repository itself
FARM=$T/farm/data                        # the made-up farm
PLAN=$W/backup/plan.json                 # the farm as a full backup's plan.json
SHIP=$APP/data/plan.json                 # the farm as the compact plan the app folder ships
ZIP=$W/backup.zip                        # the farm as a backup file the page loads
PHOTO=$FARM/farm-map.jpg
OLD=$W/old/js                            # the scripts of the build before, for "nothing moved"
FONTS=$W/scratch/node_modules/@fontsource-variable
SCRATCH=$W/scratch
S=${LRF_SHOTS:-$W/shots}
OFF=$W/offline.html
# The label is read from the page's own script, so no check has it written in.
LRF_LABEL=${LRF_LABEL:-$(sed -n 's/.*`Preview \([0-9][0-9.]*\) · .*/\1/p' "$REPO/js/main.js" | head -1)}
export LRF_LABEL
# Gives a check's result the name its lines are counted under in tests/counts.json:   node some_test.cjs … | named "some test"
# It reads the last line the check printed: a result with "passed" and "of" (or "checks"), or "N of M passed".
named() { python3 -I -c "import json, re, sys
t = sys.stdin.read().strip(); l = t.splitlines()[-1] if t else ''
try:
    try: d = json.loads(t)
    except Exception: d = json.loads(l[l.index('{'):])
    print(json.dumps({'passed': d.get('passed'), 'of': d.get('of', d.get('checks')), 'check': sys.argv[1], **({'finished': d['finished']} if 'finished' in d else {}), 'failed': d.get('failed')}, ensure_ascii=False, default=str)[:6000])
except Exception:
    m = re.search(r'(\\d+) of (\\d+) passed', l)
    print(json.dumps({'passed': int(m.group(1)), 'of': int(m.group(2)), 'check': sys.argv[1], 'failed': []}) if m else sys.argv[1] + ' NO RESULT ' + l[-300:])" "$1"; }
export TZ=${TZ:-America/New_York}        # the checks were written in this time zone; a day must not turn over under them
