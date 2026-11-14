#!/bin/sh
# Makes the work folder the checks run in. Safe to run again: it rebuilds everything from the repository.
#   sh tests/setup.sh [commit of the build before]
# With no argument the build before is where this branch left main; on main itself, the commit before; with script changes
# not yet committed on main's own commit, that commit. LRF_BASE says it outright.
# Needs: node 22, npm, git, and python3 with playwright and pillow (pip install playwright pillow; no browser download: the
# checks use Chrome at /usr/bin/google-chrome).
set -e
. "$(dirname "$0")/env.sh"
mkdir -p "$W" "$APP/data" "$W/backup" "$W/old" "$SCRATCH" "$S"

# 1. the app folder: the code as it stands in the repository, and the made-up farm as its data
node "$REPO/tools/app_folder.cjs" "$REPO" "$APP" > /dev/null
cp "$FARM/plan.json" "$FARM/inventory.json" "$FARM/packs.json" "$FARM/plan-info.json" "$FARM/thumbs.json" "$FARM/farm-map.jpg" "$APP/data/"

# 2. the farm as a backup: a folder (plan.json, files/) and a zip the page loads
python3 -I "$T/farm/make_backup.py" "$FARM" "$W/backup" "$ZIP" > /dev/null

# 3. the scripts of the build before
BASE=${1:-${LRF_BASE:-}}
if [ -z "$BASE" ]; then
  HEADC=$(git -C "$REPO" rev-parse HEAD); MAINC=$(git -C "$REPO" merge-base HEAD origin/main 2> /dev/null || true)
  if [ -n "$MAINC" ] && [ "$MAINC" != "$HEADC" ]; then BASE=$MAINC                               # on a branch: where it left main
  elif git -C "$REPO" diff --quiet HEAD -- js; then BASE=HEAD~1                                  # on main itself: the commit before
  else BASE=HEAD; fi                                                                             # scripts changed and not committed yet
fi
if git -C "$REPO" rev-parse -q --verify "$BASE^{commit}" > /dev/null 2>&1; then
  rm -rf "$W/old/js"; git -C "$REPO" archive "$BASE" js | tar -x -C "$W/old"
  echo "build before: $BASE ($(git -C "$REPO" rev-parse --short "$BASE"))"
else
  # no history to read (a shallow copy): the build is compared with itself, and the run says so
  rm -rf "$W/old/js"; cp -r "$REPO/js" "$W/old/js"
  echo "build before: NOT FOUND ($BASE). Compared with itself: fetch more history to prove that nothing moved."
fi

# 4. typefaces for the built site, and the parser that compares two scripts
if [ ! -d "$FONTS/bricolage-grotesque" ] || [ ! -d "$SCRATCH/node_modules/acorn" ]; then
  (cd "$SCRATCH" && npm i --no-audit --no-fund --silent @fontsource-variable/bricolage-grotesque @fontsource-variable/instrument-sans @fontsource-variable/jetbrains-mono acorn > /dev/null)
fi
echo "work folder: $W   label: $LRF_LABEL   farm: $(python3 -I -c "import json,sys; print(json.load(open(sys.argv[1]))['counts'])" "$FARM/plan-info.json")"
