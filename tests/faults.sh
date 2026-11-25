#!/bin/sh
# The deliberate faults: each puts one fault into a copy of the app and requires that the check then fails where it passed before
# (ten sets name the line that has to fail: changed, cleanup, join, look, map, merge, scale, screens, shape, windows). They prove that the checks can fail. One way in for all of them:
#   sh tests/faults.sh <set> [mode] [words…]      FROM=0 TO=12 in front runs a part; WIDTH= and DARK= reach the page checks
#   sh tests/faults.sh list                        every set, its modes and the number of faults in each
# With no mode a set runs its first one, which is its fast one where it has one (node, worker: seconds a fault; the page modes
# take about a minute a fault). Words pick out the faults whose names hold them.
# Run tests/setup.sh first. A set first runs its check once with no fault in it: a line that fails then catches nothing, and a
# check that gives no result then catches nothing at all, so a fault is never said to be caught by a check that fails anyway.
# Each line after that is one fault, "caught" or "MISSED" (or "BROKEN": the text to change was not found exactly once, so the
# fault could not be put in), and the last line is the set's result:
#   {"set": "step5a", "mode": "node", "faults": 30, "caught": 30, "missed": [], "broken": []}
# The exit status is 0 only when every fault was caught.
. "$(dirname "$0")/env.sh"
# one set a line, so that two builds that each add a set add two lines and git puts them together by itself
SETS="
step1
f018
step2a
step2b
step3a
step3b
step5a
step5b
stepF
plain
r1
sup
sync
maint
bedpanel
mixed
season
ask
cleanup
look
map
changed
screens
numbers
card
things
windows
scale
loose
f053
room
harvest
frost
frostrule
forecast
trycard
swap
tasks2
yearedge
bought
n1
tlpick
messages
controls
early
e2d
season-work
water
runs
merge
join
shape
shared
"
# the script of a set and what it is given; F is the folder its copies are made in
script() {
  case $1 in
    step1) SCRIPT=$T/mutate1.py; ARGS="$APP $F $T $PLAN" ;;
    f018) SCRIPT=$T/mutate018.py; ARGS="$APP $F $T/fixes_018_check.py" ;;
    step2a) SCRIPT=$T/mutate2a.py; ARGS="$APP $F $T/step2a_check.py" ;;
    step2b) SCRIPT=$T/mutate2b.py; ARGS="$APP $F $T/waiting_test.cjs $T/step2b_check.py $PLAN" ;;
    step3a) SCRIPT=$T/mutate3a.py; ARGS="$APP $F $T $PLAN" ;;
    step3b) SCRIPT=$T/mutate3b.py; ARGS="$APP $F $T $PLAN" ;;
    step5a) SCRIPT=$T/mutate5a.py; ARGS="$APP $F $T $PLAN" ;;
    step5b) SCRIPT=$T/mutate5b.py; ARGS="$APP $F $T $PLAN" ;;
    stepF) SCRIPT=$T/mutateF.py; ARGS="$APP $F $T $PLAN" ;;
    plain) SCRIPT=$T/mutate_plain.py; ARGS="$APP $F $T $REPO" ;;
    r1) SCRIPT=$T/mutate_r1.py; ARGS="$APP $F $T" ;;
    sup) SCRIPT=$T/mutate_sup.py; ARGS="$APP $F $T" ;;
    sync) SCRIPT=$T/mutate_sync.py; ARGS="$APP $REPO $F $T/sync_check.py" ;;
    maint) SCRIPT=$T/mutate_maint.py; ARGS="$APP $F $T/maint_check.py $PLAN" ;;
    bedpanel) SCRIPT=$T/mutate_bp.py; ARGS="$APP $F $T" ;;
    mixed) SCRIPT=$T/mutate_mx.py; ARGS="$APP $F $T" ;;
    season) SCRIPT=$T/mutate_season.py; ARGS="$APP $F $T $REPO" ;;
    card) SCRIPT=$T/mutate_card.py; ARGS="$APP $F $T" ;;
    things) SCRIPT=$T/mutate_things.py; ARGS="$APP $F $T $PLAN $W/old $ZIP" ;;
    ask) SCRIPT=$T/mutate_ask.py; ARGS="$APP $F $T" ;;
    cleanup) SCRIPT=$T/mutate_cleanup.py; ARGS="$APP $F $T" ;;
    look) SCRIPT=$T/mutate_look.py; ARGS="$APP $F $T $PLAN" ;;
    map) SCRIPT=$REPO/tools/mutate_map.py; ARGS="$APP $F $REPO/tools" ;;
    changed) SCRIPT=$T/mutate_changed.py; ARGS="$REPO $F $T $W/old $SCRATCH" ;;
    screens) SCRIPT=$T/mutate_screens.py; ARGS="$REPO $F $T $W/old $ZIP" ;;
    numbers) SCRIPT=$T/mutate_numbers.py; ARGS="$APP $F $T" ;;
    windows) SCRIPT=$T/mutate_windows.py; ARGS="$APP $REPO $F $T" ;;
    merge) SCRIPT=$T/mutate_merge.py; ARGS="$APP $F $T $PLAN $FARM/inventory.json" ;;
    join) SCRIPT=$T/mutate_join.py; ARGS="$APP $REPO $F $T" ;;
    shape) SCRIPT=$T/mutate_shape.py; ARGS="$APP $F $T $PLAN $FARM/inventory.json $SCRATCH" ;;
    shared) SCRIPT=$T/mutate_shared.py; ARGS="$REPO $F $FONTS" ;;
    scale) SCRIPT=$T/mutate_scale.py; ARGS="$REPO $F" ;;
    loose) SCRIPT=$T/mutate_loose.py; ARGS="$APP $F $T" ;;
    f053) SCRIPT=$T/mutate_f053.py; ARGS="$APP $F $T" ;;
    room) SCRIPT=$T/mutate_room.py; ARGS="$APP $F $T" ;;
    harvest) SCRIPT=$T/mutate_harvest.py; ARGS="$APP $F $T" ;;
    frost) SCRIPT=$T/mutate_frost.py; ARGS="$APP $F $T $PLAN" ;;
    frostrule) SCRIPT=$T/mutate_frostrule.py; ARGS="$APP $F $T $PLAN" ;;
    forecast) SCRIPT=$T/mutate_forecast.py; ARGS="$APP $F $T" ;;
    trycard) SCRIPT=$T/mutate_trycard.py; ARGS="$APP $F $T" ;;
    swap) SCRIPT=$T/mutate_swap.py; ARGS="$APP $F $T $PLAN" ;;
    tasks2) SCRIPT=$T/mutate_tasks2.py; ARGS="$APP $F $T $PLAN" ;;
    yearedge) SCRIPT=$T/mutate_yearedge.py; ARGS="$APP $F $T $PLAN" ;;
    bought) SCRIPT=$T/mutate_bought.py; ARGS="$APP $F $T $PLAN" ;;
    n1) SCRIPT=$T/mutate_n1.py; ARGS="$APP $F $T $PLAN" ;;
    early) SCRIPT=$T/mutate_early.py; ARGS="$APP $F $T $PLAN" ;;
    e2d) SCRIPT=$T/mutate_e2d.py; ARGS="$APP $F $T $PLAN" ;;
    season-work) SCRIPT=$T/mutate_season_work.py; ARGS="$APP $F $T" ;;
    water) SCRIPT=$T/mutate_water.py; ARGS="$APP $F $T" ;;   # Water and feed: its arithmetic (node) and its page (page)
    runs) SCRIPT=$T/mutate_runs.py; ARGS="$APP $F $T $PLAN" ;;   # E4 stage 1: the solver of a run (node) and its two steps (page)
    tlpick) SCRIPT=$T/mutate_tlpick.py; ARGS="$APP $F $T" ;;
    messages) SCRIPT=$T/mutate_messages.py; ARGS="$APP $F $T" ;;
    controls) SCRIPT=$T/mutate_controls.py; ARGS="$APP $F $T" ;;
    *) return 1 ;;
  esac
}
# what a set offers: {"node": 30, "page": 14}, the mode run by default first
offers() { F=$W/faults/$1; script $1 && python3 -I $SCRIPT $ARGS list; }

if [ "$1" = list ]; then
  for set in $SETS; do
    offers $set | python3 -I -c "import json,sys; d=json.loads(sys.stdin.read() or '{}'); print('%-9s' % sys.argv[1] + ''.join('  %s %d' % (m, n) for m, n in d.items()) if d else sys.argv[1] + '  NO LIST')" $set
  done
  exit 0
fi
set=$1; [ $# -gt 0 ] && shift
if ! script "$set"; then echo "usage: sh tests/faults.sh <set> [mode] [words…]   or   sh tests/faults.sh list      sets: $(echo $SETS)"; exit 2; fi
# the mode: the word after the set if the set offers it, else the set's first
mode=$(offers $set | python3 -I -c "import json,sys; d=json.loads(sys.stdin.read() or '{}'); w=sys.argv[1]; print(w if w in d else '+' + next(iter(d), ''))" "$1")
case $mode in +*) mode=${mode#+} ;; *) shift ;; esac
if [ -z "$mode" ]; then echo "{\"set\": \"$set\", \"mode\": \"\", \"faults\": 0, \"caught\": 0, \"missed\": [], \"broken\": [\"(the fault script did not say what it offers)\"]}"; exit 1; fi
F=$W/faults/$set-$mode; script $set; mkdir -p $F
# OLD: the scripts of the build before, for the faults a check catches only by comparing with them
OLD=$OLD python3 -I $SCRIPT $ARGS $mode "$@" 2>&1 | python3 -I -c "
import json, sys
name, mode = sys.argv[1:3]; last = None
for line in sys.stdin:
    if last is not None: print(last, flush=True)
    last = line.rstrip('\n')
try:
    d = json.loads(last); d = {'set': name, 'mode': mode, 'faults': d['faults'], 'caught': d['caught'], 'missed': list(d['missed']), 'broken': list(d['broken'])}
except Exception:
    if last is not None: print(last)
    d = {'set': name, 'mode': mode, 'faults': 0, 'caught': 0, 'missed': [], 'broken': ['(the fault script stopped before its end)']}
print(json.dumps(d, ensure_ascii=False), flush=True)
sys.exit(0 if d['faults'] and d['caught'] == d['faults'] and not d['missed'] and not d['broken'] else 1)" $set $mode
