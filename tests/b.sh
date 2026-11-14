#!/bin/sh
# One or more browser checks by name:   sh tests/b.sh <name> …      WIDTH=1480 or DARK=1 in front; the map's take WIDTHS=1280,1480
# A name ending in -site runs the check on the built site (the repository), which has no plan of its own and loads the farm's
# backup; -off runs it on the single offline file. Run "offline" before any -off name: it builds that file.
. "$(dirname "$0")/env.sh"
mkdir -p $S
tally() { python3 -I -c "import json,sys; t=sys.stdin.read(); i=t.rfind('{\"passed\"'); i=i if i>=0 else t.find('{');
try:
    d=json.loads(t[i:]); print(sys.argv[1], d.get('passed'), 'of', d.get('of'), d.get('failed')); [print('   ', json.dumps(x, default=str)[:600]) for x in (d.get('details') or [])[:5]]
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
    stepF) python3 -I $T/stepF_check.py $APP $S/stepF 2>&1 | tally stepF ;;
    plain) python3 -I $T/plain_check.py $APP $S/plain 2>&1 | tally plain-words ;;
    importer) python3 -I $T/importer_check.py $APP $S/imp 2>&1 | tally importer ;;
    importer-site) python3 -I $T/importer_check.py $SITE $S/imp-site $ZIP 2>&1 | tally importer-built-site ;;
    sup) python3 -I $T/sup_check.py $APP $S/sup 2>&1 | tally supplies ;;
    sup-site) python3 -I $T/sup_check.py $SITE $S/sup-site $ZIP 2>&1 | tally supplies-built-site ;;
    r1) python3 -I $T/r1_check.py $APP $S/r1 2>&1 | tally where-things-live ;;
    bedpanel) python3 -I $T/bedpanel_check.py $APP $S/bedpanel 2>&1 | tally bed-panel ;;
    bedpanel-site) python3 -I $T/bedpanel_check.py $SITE $S/bedpanel-site $ZIP 2>&1 | tally bed-panel-built-site ;;
    mixed) python3 -I $T/mixed_check.py $APP $S/mixed 2>&1 | tally mixed-beds ;;
    mixed-site) python3 -I $T/mixed_check.py $SITE $S/mixed-site $ZIP 2>&1 | tally mixed-beds-built-site ;;
    season) python3 -I $T/season_check.py $APP $S/season 2>&1 | tally farm-dates ;;
    season-site) python3 -I $T/season_check.py $SITE $S/season-site $ZIP 2>&1 | tally farm-dates-built-site ;;
    photo) python3 -I $T/photo_keep_check.py $APP $S/photo $REPO 2>&1 | tally farm-photo-two-browsers ;;
    photo-site) python3 -I $T/photo_keep_check.py $SITE $S/photo-site $REPO $ZIP $PHOTO 2>&1 | tally farm-photo-two-browsers-built-site ;;
    ask) python3 -I $T/ask_check.py $APP $S/ask 2>&1 | tally asked-only-from-the-library ;;
    ask-site) python3 -I $T/ask_check.py $SITE $S/ask-site $ZIP 2>&1 | tally asked-only-from-the-library-built-site ;;
    cleanup) python3 -I $T/cleanup_check.py $APP $S/cleanup 2>&1 | tally clean-up ;;
    cleanup-site) python3 -I $T/cleanup_check.py $SITE $S/cleanup-site $ZIP 2>&1 | tally clean-up-built-site ;;
    map) WIDTHS=${WIDTHS:-1280,1480,1707,3440} python3 -I $REPO/tools/map_check.py $APP $S/map 2>&1 | tally map ;;
    map-views) WIDTHS=${WIDTHS:-1280,1707,3440} python3 -I $REPO/tools/map_views_check.py $APP $S/map-views 2>&1 | tally map-and-every-other-view ;;
    mapgeo) node $REPO/tools/mapgeo_test.cjs 2>&1 | tally map-geometry ;;
    offline) node $REPO/tools/build_offline.cjs $APP $FONTS $OFF "$LRF_LABEL" | tail -1 | cut -c1-300 ;;
    ahead-off) python3 -I $T/ahead_check.py $OFF $S/ahead-off 2>&1 | tally ahead-offline ;;
    core-off) python3 -I $T/browser_core.py $OFF $S/core-off file 2>&1 | tally core-offline ;;
    sowing-off) python3 -I $T/sowing_view_check.py $OFF $S/sow-off 2>&1 | tally sowing-offline ;;
    trays-off) python3 -I $T/trays_check.py $OFF $S/trays-off file 2>&1 | tally trays-offline ;;
    step2a-off) python3 -I $T/step2a_check.py $OFF $S/step2a-off 2>&1 | tally step2a-offline ;;
    f018-off) python3 -I $T/fixes_018_check.py $OFF $S/f018-off 2>&1 | tally fixes-0.18-offline ;;
    step2b-off) python3 -I $T/step2b_check.py $OFF $S/step2b-off 2>&1 | tally step2b-offline ;;
    map-off) rm -rf $W/offline-as-site && mkdir -p $W/offline-as-site && cp $OFF $W/offline-as-site/index.html && WIDTHS=${WIDTHS:-1480} python3 -I $REPO/tools/map_check.py $W/offline-as-site $S/map-off 2>&1 | tally map-offline ;;
    carry) python3 -I $T/carry_check.py $SITE $ZIP $S/carry 2>&1 | tally carry ;;
    site) python3 -I $REPO/tools/site_check.py $SITE $ZIP $S/site.png 2>&1 | tail -3 | cut -c1-500 ;;
    step3a-site) python3 -I $T/step3a_check.py $SITE $S/step3a-site $ZIP 2>&1 | tally step3a-built-site ;;
    step3b-site) python3 -I $T/step3b_check.py $SITE $S/step3b-site $ZIP 2>&1 | tally step3b-built-site ;;
    wide-site) python3 -I $T/wide_check.py $SITE $S/wide-site $ZIP 2>&1 | tally wide-and-light-built-site ;;
    step5a-site) python3 -I $T/step5a_check.py $SITE $S/step5a-site $ZIP 2>&1 | tally step5a-built-site ;;
    step5b-site) python3 -I $T/step5b_check.py $SITE $S/step5b-site $ZIP 2>&1 | tally step5b-built-site ;;
    stepF-site) python3 -I $T/stepF_check.py $SITE $S/stepF-site $ZIP 2>&1 | tally stepF-built-site ;;
    plain-site) python3 -I $T/plain_check.py $SITE $S/plain-site $ZIP 2>&1 | tally plain-words-built-site ;;
    r1-site) python3 -I $T/r1_check.py $SITE $S/r1-site $ZIP 2>&1 | tally where-things-live-built-site ;;
    map-site) WIDTHS=${WIDTHS:-1280,1480,1707,3440} python3 -I $REPO/tools/map_check.py $SITE $S/map-site $ZIP 2>&1 | tally map-built-site ;;
    map-views-site) WIDTHS=${WIDTHS:-1480} python3 -I $REPO/tools/map_views_check.py $SITE $S/map-views-site $ZIP 2>&1 | tally map-and-every-other-view-built-site ;;
    sync-site) DARK=1 python3 -I $T/sync_check.py $SITE $S/sync-site $REPO $ZIP $PHOTO 2>&1 | tally sync-and-snapshots-built-site ;;
    tour) python3 -I $T/tour19.py $SITE $ZIP $S/tour $T/step2a_check.py 2>&1 | tail -1 | cut -c1-300 ;;
    *) echo "unknown $n" ;;
  esac
  echo "   ($n: $(( $(date +%s) - s )) s; WIDTH=${WIDTH:-1280} DARK=${DARK:-0})"
done
