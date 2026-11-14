#!/bin/sh
# Everything, in parts, so that each part fits ten minutes on a small computer and GitHub can run them side by side:
#   sh tests/run.sh [part …]        parts: node build app1 app2 app3 app4 new off site1 … site10      (no argument: all, in order)
# Run tests/setup.sh first. Nothing may change the repository or the work folder while a part runs.
# A line is "<name> <passed> of <checks> [failed lines]". tests/verdict.py reads a log of them and says whether all passed.
. "$(dirname "$0")/env.sh"
for part in ${@:-node build app1 app2 app3 app4 new off site1 site2 site3 site4 site5 site6 site7 site8 site9 site10}; do
  echo "== $part"
  case $part in
    node) sh $T/quick.sh ;;
    build) node $REPO/tools/build_site.cjs $APP $FONTS $REPO "$LRF_LABEL" > $W/build.out 2>&1 || echo "build NO RESULT $(tail -2 $W/build.out | cut -c1-300)"; tail -1 $W/build.out | cut -c1-300
      # the site kept in the repository is what its own code builds to: a build that left it stale, or edited it by hand, shows here
      if [ -z "$(git -C $REPO status --porcelain -- index.html sw.js manifest.webmanifest css js fonts icons)" ]; then echo '{"passed":1,"of":1,"failed":[],"name":"the built site in the repository is what the code builds to"}'; else echo '{"passed":0,"of":1,"failed":["the built site in the repository is what the code builds to"]}'; git -C $REPO status --porcelain -- index.html sw.js manifest.webmanifest css js fonts icons | head -5; fi
      sh $T/b.sh offline; (cd $REPO && node tools/sync_client_test.mjs $REPO/js 2>&1 | tail -1 | sed 's/^/sync client, built site /') ;;
    app1) sh $T/b.sh ahead core sowing trays step1 folder step2a ;;
    app2) sh $T/b.sh f018 step2b maint sync step3a step3b ;;
    app3) sh $T/b.sh wide step5a step5b stepF plain r1 bedpanel mixed season photo ask cleanup ;;
    app4) sh $T/b.sh mapgeo; WIDTHS=${WIDTHS:-1280,1480,1707,3440} sh $T/b.sh map; sh $T/b.sh map-views; WIDTH=1480 sh $T/b.sh r1 ;;
    new) sh $T/b.sh sup importer; WIDTH=1480 sh $T/b.sh sup importer; WIDTH=3440 sh $T/b.sh sup importer; sh $T/b.sh sup-site importer-site; WIDTH=1480 sh $T/b.sh sup-site importer-site ;;
    off) sh $T/b.sh offline ahead-off core-off sowing-off trays-off step2a-off f018-off step2b-off map-off ;;
    site1) sh $T/b.sh carry site step3a-site step3b-site wide-site step5a-site ;;
    site2) sh $T/b.sh step5b-site stepF-site plain-site r1-site sync-site tour ;;
    site3) WIDTHS=${WIDTHS:-1280,1480,1707,3440} sh $T/b.sh map-site; sh $T/b.sh map-views-site ;;
    site4) DARK=1 WIDTH=1480 sh $T/b.sh step3a-site step3b-site; WIDTH=1480 sh $T/b.sh step3a-site step3b-site step5a-site step5b-site stepF-site r1-site ;;
    site5) DARK=1 sh $T/b.sh step3a-site step3b-site step5a-site step5b-site stepF-site r1-site; WIDTH=3440 sh $T/b.sh stepF-site r1-site ;;
    site6) sh $T/b.sh bedpanel-site; WIDTH=1707 sh $T/b.sh bedpanel-site; WIDTH=3440 sh $T/b.sh bedpanel-site; WIDTH=1707 sh $T/b.sh bedpanel ;;
    site7) sh $T/b.sh mixed-site; WIDTH=1707 sh $T/b.sh mixed-site; WIDTH=3440 sh $T/b.sh mixed-site; WIDTH=1707 sh $T/b.sh mixed; WIDTH=3440 sh $T/b.sh mixed ;;
    site8) sh $T/b.sh season-site photo-site; WIDTH=1480 sh $T/b.sh season season-site; WIDTH=1707 sh $T/b.sh season season-site; WIDTH=3440 sh $T/b.sh season season-site; DARK=1 sh $T/b.sh season-site ;;
    site9) sh $T/b.sh ask-site; WIDTH=1480 sh $T/b.sh ask ask-site; WIDTH=1707 sh $T/b.sh ask ask-site; WIDTH=3440 sh $T/b.sh ask ask-site; DARK=1 sh $T/b.sh ask-site ;;
    site10) sh $T/b.sh cleanup-site; WIDTH=1480 sh $T/b.sh cleanup cleanup-site; WIDTH=1707 sh $T/b.sh cleanup cleanup-site; WIDTH=3440 sh $T/b.sh cleanup cleanup-site ;;
    *) echo "unknown part $part" ;;
  esac
done
