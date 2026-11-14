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
export TZ=${TZ:-America/New_York}        # the checks were written in this time zone; a day must not turn over under them
