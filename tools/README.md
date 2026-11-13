# Tools

Scripts that produce this site from the planner's working copy. They are not part of the app and nothing loads them.

- `build_site.cjs` — writes `index.html`, `css/`, `js/`, `fonts/`, `manifest.webmanifest` and `sw.js` into this folder from the app's source. Run after `make_icons.py` has made `icons/`. It stops when the app folder lacks a script this site already serves: that means the app folder was put together before another piece of work added the script, and building from it would take that work off the site. Copy `js/` and `css/app.css` from the repo into the app folder, put your own changes back on top, and build again; `--drop` as a last argument removes a script on purpose. It stops too when the app folder holds a script its own `index.html` does not load: the app's `index.html` is kept apart from this repo and can be the stale part. Add the missing `<script>` lines in the order this repo's `index.html` has them.
- `site_check.py` — opens the built site in headless Chrome: empty start, loading a backup, reload, opening with no connection, and with the network still off: stock typed in, vendor sizes shown, a sowing recorded.
- `build_offline.cjs` — packs the app into one self-contained HTML file.
- `make_icons.py` — draws the app icons.
- `build_reader.cjs` — bundles `reader/` (v7's page reader, unchanged, plus the wrapper that sends its requests through the fetch service) and the htmlparser2 package into `js/reader.js`. Needs a folder with `esbuild` and `htmlparser2` installed.
- `reader_test.mjs` — the reader, its fetcher and the Worker's own code together, with supplier sites stubbed out.
- `worker_test.mjs` — the fetch service on its own.
- `sync_worker_test.mjs` — the plan sync service on its own, against a stand-in bucket: who is answered, signing in, conditional writes, daily copies, snapshots, and the count of wrong passphrases (a burst of guesses included).
- `sync_client_test.mjs` — the planner's sync client (`js/sync.js`) and the sync service's own code together: two or three made-up browsers with made-up plans, no network. `node tools/sync_client_test.mjs`.
- `fake_r2.mjs` — the stand-in bucket both use.
- `mapgeo_test.cjs` — the geometry of the map (`js/mapgeo.js`) on made-up shapes: frames, overlap, snapping, lining up, spacing, rows, filling a block, container places, the photo's scale. No browser and no plan: `node tools/mapgeo_test.cjs`.
- `map_check.py` — the map in headless Chrome, with a real mouse: the eased view, crates that keep their place, and all of editing the layout (pick, move, snap, guard rails, stretch, turn, nudge, copy, add, remove, a new garden, tidying, containers, measuring, the photo's scale). It finds its subjects on the page and names nothing from any plan, so it needs a plan to look at: the app folder with its plan, or the built site and a backup. `python3 -I tools/map_check.py <app-or-site> <shots> [backup.zip]`; `WIDTHS=1280,1480,3440` for more than one width.
- `mutate_map.py` — deliberate faults in the map's code, each of which a named line of the two checks above has to catch. `python3 -I tools/mutate_map.py <app> <scratch> tools node`, or `… page` (about a minute a fault; run it alone).
- `sync_dev_server.mjs` — the sync service on this computer with a bucket in memory, for trying cloud sync without a Cloudflare account: `node tools/sync_dev_server.mjs 8791 "a passphrase"`, then give the planner (served from localhost) the address `http://127.0.0.1:8791`.
