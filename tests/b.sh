#!/bin/sh
# One or more browser checks by name:   sh tests/b.sh <name> …      WIDTH=1480 or DARK=1 in front; the map's take WIDTHS=1280,1480
# A name ending in -site runs the check on the built site (the repository), which has no plan of its own and loads the farm's
# backup; -off runs it on the single offline file. Run "offline" before any -off name: it builds that file.
. "$(dirname "$0")/env.sh"
mkdir -p $S
tally() { python3 -I -c "import json,sys; t=sys.stdin.read(); i=t.rfind('{\"passed\"'); i=i if i>=0 else t.find('{');
try:
    d=json.loads(t[i:]); print(sys.argv[1], d.get('passed'), 'of', d.get('of'), d.get('failed')); [print('   ', json.dumps(x, default=str)[:1800]) for x in (d.get('details') or [])[:5]]
except Exception as e: print(sys.argv[1], 'NO RESULT', t[-400:])" "$1"; }
for n in "$@"; do
  s=$(date +%s)
  case $n in
    ahead) python3 -I $T/ahead_check.py $APP $S/ahead 2>&1 | tally ahead ;;
    core) python3 -I $T/browser_core.py $APP $S/core 2>&1 | tally core ;;
    sowing) python3 -I $T/sowing_view_check.py $APP $S/sow 2>&1 | tally sowing ;;
    trays) python3 -I $T/trays_check.py $APP $S/trays 2>&1 | tally trays ;;
    step1) python3 -I $T/step1_check.py $APP $W/backup $ZIP $S/step1 2>&1 | tally step1 ;;
    folder) python3 -I $T/folder_check.py $APP $S/folder 2>&1 | tally folder ;;
    step2a) python3 -I $T/step2a_check.py $APP $S/step2a 2>&1 | tally step2a ;;
    f018) python3 -I $T/fixes_018_check.py $APP $S/f018 2>&1 | tally fixes-0.18 ;;
    step2b) python3 -I $T/step2b_check.py $APP $S/step2b 2>&1 | tally step2b ;;
    maint) python3 -I $T/maint_check.py $APP $S/maint $PLAN 2>&1 | tally maintenance ;;
    sync) python3 -I $T/sync_check.py $APP $S/sync $REPO 2>&1 | tally sync-and-snapshots ;;
    step3a) python3 -I $T/step3a_check.py $APP $S/step3a 2>&1 | tally step3a ;;
    step3b) python3 -I $T/step3b_check.py $APP $S/step3b 2>&1 | tally step3b ;;
    wide) python3 -I $T/wide_check.py $APP $S/wide 2>&1 | tally wide-and-light ;;
    step5a) python3 -I $T/step5a_check.py $APP $S/step5a 2>&1 | tally step5a ;;
    step5b) python3 -I $T/step5b_check.py $APP $S/step5b 2>&1 | tally step5b ;;
    succession-spaces) python3 -I $T/succession_spaces_check.py $APP $S/succession-spaces 2>&1 | tally succession-spaces ;;
    succession-spaces-site) python3 -I $T/succession_spaces_check.py $SITE $S/succession-spaces-site $ZIP 2>&1 | tally succession-spaces-site ;;
    successions) python3 -I $T/successions_check.py $APP $S/successions 2>&1 | tally successions ;;   # E4 part 1 (0.84): the Successions page, where the series tool and stepF_check were
    plain) python3 -I $T/plain_check.py $APP $S/plain 2>&1 | tally plain-words ;;
    importer) python3 -I $T/importer_check.py $APP $S/imp 2>&1 | tally importer ;;
    importer-site) python3 -I $T/importer_check.py $SITE $S/imp-site $ZIP 2>&1 | tally importer-built-site ;;
    sup) python3 -I $T/sup_check.py $APP $S/sup 2>&1 | tally supplies ;;
    sup-site) python3 -I $T/sup_check.py $SITE $S/sup-site $ZIP 2>&1 | tally supplies-built-site ;;
    r1) python3 -I $T/r1_check.py $APP $S/r1 2>&1 | tally where-things-live ;;
    bed-season) python3 -I $T/bed_season_check.py $APP $S/bed-season 2>&1 | tally bed-season ;;
    bed-season-site) python3 -I $T/bed_season_check.py $SITE $S/bed-season-site $ZIP 2>&1 | tally bed-season-built-site ;;
    bedpanel) python3 -I $T/bedpanel_check.py $APP $S/bedpanel 2>&1 | tally bed-panel ;;
    bedpanel-site) python3 -I $T/bedpanel_check.py $SITE $S/bedpanel-site $ZIP 2>&1 | tally bed-panel-built-site ;;
    mixed) python3 -I $T/mixed_check.py $APP $S/mixed 2>&1 | tally mixed-beds ;;
    mixed-site) python3 -I $T/mixed_check.py $SITE $S/mixed-site $ZIP 2>&1 | tally mixed-beds-built-site ;;
    season) python3 -I $T/season_check.py $APP $S/season 2>&1 | tally farm-dates ;;
    season-site) python3 -I $T/season_check.py $SITE $S/season-site $ZIP 2>&1 | tally farm-dates-built-site ;;
    photo) python3 -I $T/photo_keep_check.py $APP $S/photo $REPO 2>&1 | tally farm-photo-two-browsers ;;
    windows) python3 -I $T/two_windows_check.py $APP $S/two-windows $REPO 2>&1 | tally two-windows ;;
    join) python3 -I $T/join_check.py $APP $S/join $REPO 2>&1 | tally join ;;
    join-site) python3 -I $T/join_check.py $SITE $S/join-site $REPO $ZIP 2>&1 | tally join-built-site ;;
    photo-site) python3 -I $T/photo_keep_check.py $SITE $S/photo-site $REPO $ZIP $PHOTO 2>&1 | tally farm-photo-two-browsers-built-site ;;
    ask) python3 -I $T/ask_check.py $APP $S/ask 2>&1 | tally asked-only-from-the-library ;;
    ask-site) python3 -I $T/ask_check.py $SITE $S/ask-site $ZIP 2>&1 | tally asked-only-from-the-library-built-site ;;
    card) python3 -I $T/yieldcard_check.py $APP $S/card 2>&1 | tally yield-card ;;
    card-site) python3 -I $T/yieldcard_check.py $SITE $S/card-site $ZIP 2>&1 | tally yield-card-built-site ;;
    things) python3 -I $T/things_check.py $APP $S/things $W/old $ZIP 2>&1 | tally things-sold ;;
    things-site) python3 -I $T/things_check.py $SITE $S/things-site $W/old $ZIP 2>&1 | tally things-sold-built-site ;;
    cleanup) python3 -I $T/cleanup_check.py $APP $S/cleanup 2>&1 | tally clean-up ;;
    cleanup-site) python3 -I $T/cleanup_check.py $SITE $S/cleanup-site $ZIP 2>&1 | tally clean-up-built-site ;;
    look) python3 -I $T/look_a_check.py $APP $S/look 2>&1 | tally the-maps-look ;;
    look-site) python3 -I $T/look_a_check.py $SITE $S/look-site $ZIP 2>&1 | tally the-maps-look-built-site ;;
    numbers) python3 -I $T/number_boxes_check.py $APP $S/numbers 2>&1 | tally number-boxes ;;
    numbers-site) python3 -I $T/number_boxes_check.py $SITE $S/numbers-site $ZIP 2>&1 | tally number-boxes-built-site ;;
    shape) python3 -I $T/shape_check.py $APP $S/shape $REPO 2>&1 | tally shape ;;   # the plan's shape (plan_shape.cjs) held to what the page writes
    runs) python3 -I $T/run_check.py $APP $S/runs 2>&1 | tally runs ;;   # E4 stage 1: a run of successions added and taken out by the page's own steps, one Undo each
    loose) python3 -I $T/loose_check.py $APP $S/loose 2>&1 | tally loose-ends ;;
    loose-site) python3 -I $T/loose_check.py $SITE $S/loose-site $ZIP 2>&1 | tally loose-ends-built-site ;;
    room) python3 -I $T/room_check.py $APP $S/room 2>&1 | tally room-for-a-crop ;;   # the Timeline and the library: room for a crop, a shut garden's band, To place
    room-site) python3 -I $T/room_check.py $SITE $S/room-site $ZIP 2>&1 | tally room-for-a-crop-built-site ;;
    harvest) python3 -I $T/harvest_choice_check.py $APP $S/harvest 2>&1 | tally harvest-choice ;;   # the card's harvest choice: to the season's end, or for a set number of days
    harvest-site) python3 -I $T/harvest_choice_check.py $SITE $S/harvest-site $ZIP 2>&1 | tally harvest-choice-built-site ;;
    trycard) python3 -I $T/trycard_check.py $APP $S/trycard 2>&1 | tally try-the-card ;;   # the card, part 1, behind its tick
    trycard-site) python3 -I $T/trycard_check.py $SITE $S/trycard-site $ZIP 2>&1 | tally try-the-card-built-site ;;
    forecast) python3 -I $T/forecast_check.py $APP $S/forecast 2>&1 | tally forecast-page ;;   # E3: the Forecast page, amounts and dollars, the whole season at one press, the popup, the list to send, the kept forecast
    forecast-site) python3 -I $T/forecast_check.py $SITE $S/forecast-site $ZIP 2>&1 | tally forecast-page-built-site ;;
    year-edge) python3 -I $T/year_edge_check.py $APP $S/year-edge 2>&1 | tally year-edge ;;   # the year's edge: a December sowing for January's trays on Tasks and in Seeds, earlier work in one line, stock carried in on the Forecast
    year-edge-site) python3 -I $T/year_edge_check.py $SITE $S/year-edge-site $ZIP 2>&1 | tally year-edge-built-site ;;
    bought) python3 -I $T/bought_check.py $APP $S/bought 2>&1 | tally bought-in ;;   # N2: a planting's own Seed | Bought in, the grower and the lot, a variety counted two ways, the order sheet in whole lots
    bought-site) python3 -I $T/bought_check.py $SITE $S/bought-site $ZIP 2>&1 | tally bought-in-built-site ;;
    early-young) python3 -I $T/early_young_check.py $APP $S/early-young 2>&1 | tally early-and-young ;;   # E2c part 2: days before on a crop's card, a stand's year planted, the Forecast's tags
    early-young-site) python3 -I $T/early_young_check.py $SITE $S/early-young-site $ZIP 2>&1 | tally early-and-young-built-site ;;
    e2d) python3 -I $T/e2d_check.py $APP $S/e2d 2>&1 | tally rows-in-the-figure ;;   # E2d: a sown crop's yield typed for a bed with its rows on the crop's card, what it moves shown first, the row-foot said
    e2d-site) python3 -I $T/e2d_check.py $SITE $S/e2d-site $ZIP 2>&1 | tally rows-in-the-figure-built-site ;;
    tlpick) python3 -I $T/tlpick_check.py $APP $S/tlpick 2>&1 | tally timeline-shows-the-pick ;;   # #88: the Timeline shows the bed the card is showing; an opening's way back at its head
    tlpick-site) python3 -I $T/tlpick_check.py $SITE $S/tlpick-site $ZIP 2>&1 | tally timeline-shows-the-pick-built-site ;;
    messages) python3 -I $T/messages_check.py $APP $S/messages 2>&1 | tally l3-messages ;;   # #91, L3 part 1: the messages and small fixes
    messages-site) python3 -I $T/messages_check.py $SITE $S/messages-site $ZIP 2>&1 | tally l3-messages-built-site ;;
    controls) python3 -I $T/controls_check.py $APP $S/controls 2>&1 | tally l3-controls ;;   # #91, L3 part 2: the plain controls
    controls-site) python3 -I $T/controls_check.py $SITE $S/controls-site $ZIP 2>&1 | tally l3-controls-built-site ;;
    swap) python3 -I $T/swap_check.py $APP $S/swap 2>&1 | tally variety-swap ;;   # the variety swap: one variety put in the place of another, the sowing days kept
    swap-site) python3 -I $T/swap_check.py $SITE $S/swap-site $ZIP 2>&1 | tally variety-swap-built-site ;;
    tasks2) python3 -I $T/tasks2_check.py $APP $S/tasks2 2>&1 | tally tasks-part-2 ;;   # Tasks part 2: Upcoming weeks, Trays to fill, Mark all done, the bed flag, a tick ahead asked first, everything recorded taken back, a planting marked failed
    tasks2-site) python3 -I $T/tasks2_check.py $SITE $S/tasks2-site $ZIP 2>&1 | tally tasks-part-2-built-site ;;
    f053) python3 -I $T/fixes_053_check.py $APP $S/f053 2>&1 | tally fixes-0.53 ;;
    f053-site) python3 -I $T/fixes_053_check.py $SITE $S/f053-site $ZIP 2>&1 | tally fixes-0.53-built-site ;;
    map) WIDTHS=${WIDTHS:-1280,1480,1707,3440} python3 -I $REPO/tools/map_check.py $APP $S/map 2>&1 | tally map ;;
    map-views) WIDTHS=${WIDTHS:-1280,1707,3440} python3 -I $REPO/tools/map_views_check.py $APP $S/map-views 2>&1 | tally map-and-every-other-view ;;
    mapgeo) node $REPO/tools/mapgeo_test.cjs 2>&1 | tally map-geometry ;;
    offline) node $REPO/tools/build_offline.cjs $APP $FONTS $OFF "$LRF_LABEL" > $W/offline.out 2>&1 || echo "offline NO RESULT $(tail -2 $W/offline.out | cut -c1-300)"; tail -1 $W/offline.out | cut -c1-300 ;;
    ahead-off) python3 -I $T/ahead_check.py $OFF $S/ahead-off 2>&1 | tally ahead-offline ;;
    core-off) python3 -I $T/browser_core.py $OFF $S/core-off file 2>&1 | tally core-offline ;;
    sowing-off) python3 -I $T/sowing_view_check.py $OFF $S/sow-off 2>&1 | tally sowing-offline ;;
    trays-off) python3 -I $T/trays_check.py $OFF $S/trays-off file 2>&1 | tally trays-offline ;;
    step2a-off) python3 -I $T/step2a_check.py $OFF $S/step2a-off 2>&1 | tally step2a-offline ;;
    f018-off) python3 -I $T/fixes_018_check.py $OFF $S/f018-off 2>&1 | tally fixes-0.18-offline ;;
    step2b-off) python3 -I $T/step2b_check.py $OFF $S/step2b-off 2>&1 | tally step2b-offline ;;
    map-off) rm -rf $W/offline-as-site && mkdir -p $W/offline-as-site && cp $OFF $W/offline-as-site/index.html && WIDTHS=${WIDTHS:-1480} python3 -I $REPO/tools/map_check.py $W/offline-as-site $S/map-off 2>&1 | tally map-offline ;;
    carry) python3 -I $T/carry_check.py $SITE $ZIP $S/carry 2>&1 | tally carry ;;
    site) python3 -I $REPO/tools/site_check.py $SITE $ZIP $S/site.png 2>&1 | tail -1 | python3 -I -c "import json,sys; t=sys.stdin.read()
try:
    d=json.loads(t); bad=[k for k,v in d.items() if (v != 0 if k == 'errors' else v is not True)]; print('site', len(d)-len(bad), 'of', len(d), bad)
except Exception: print('site NO RESULT', t[-300:])" ;;
    step3a-site) python3 -I $T/step3a_check.py $SITE $S/step3a-site $ZIP 2>&1 | tally step3a-built-site ;;
    step3b-site) python3 -I $T/step3b_check.py $SITE $S/step3b-site $ZIP 2>&1 | tally step3b-built-site ;;
    wide-site) python3 -I $T/wide_check.py $SITE $S/wide-site $ZIP 2>&1 | tally wide-and-light-built-site ;;
    step5a-site) python3 -I $T/step5a_check.py $SITE $S/step5a-site $ZIP 2>&1 | tally step5a-built-site ;;
    step5b-site) python3 -I $T/step5b_check.py $SITE $S/step5b-site $ZIP 2>&1 | tally step5b-built-site ;;
    successions-site) python3 -I $T/successions_check.py $SITE $S/successions-site $ZIP 2>&1 | tally successions-built-site ;;
    plain-site) python3 -I $T/plain_check.py $SITE $S/plain-site $ZIP 2>&1 | tally plain-words-built-site ;;
    r1-site) python3 -I $T/r1_check.py $SITE $S/r1-site $ZIP 2>&1 | tally where-things-live-built-site ;;
    map-site) WIDTHS=${WIDTHS:-1280,1480,1707,3440} python3 -I $REPO/tools/map_check.py $SITE $S/map-site $ZIP 2>&1 | tally map-built-site ;;
    map-views-site) WIDTHS=${WIDTHS:-1480} python3 -I $REPO/tools/map_views_check.py $SITE $S/map-views-site $ZIP 2>&1 | tally map-and-every-other-view-built-site ;;
    sync-site) DARK=1 python3 -I $T/sync_check.py $SITE $S/sync-site $REPO $ZIP $PHOTO 2>&1 | tally sync-and-snapshots-built-site ;;
    screens) python3 -I $T/screens_check.py $SITE $W/old $ZIP $S/screens $REPO 2>&1 | tally screens ;;
    tour) python3 -I $T/tour19.py $SITE $ZIP $S/tour $T/step2a_check.py 2>&1 | tail -1 | cut -c1-300 ;;
    *) echo "unknown $n" ;;
  esac
  echo "   ($n: $(( $(date +%s) - s )) s; WIDTH=${WIDTH:-1280} DARK=${DARK:-0})"
done
