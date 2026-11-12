# Tools

Scripts that produce this site from the planner's working copy. They are not part of the app and nothing loads them.

- `build_site.cjs` — writes `index.html`, `css/`, `js/`, `fonts/`, `manifest.webmanifest` and `sw.js` into this folder from the app's source. Run after `make_icons.py` has made `icons/`.
- `site_check.py` — opens the built site in headless Chrome: empty start, loading a backup, reload, opening with no connection, and with the network still off: stock typed in, vendor sizes shown, a sowing recorded.
- `build_offline.cjs` — packs the app into one self-contained HTML file.
- `make_icons.py` — draws the app icons.
- `build_reader.cjs` — bundles `reader/` (v7's page reader, unchanged, plus the wrapper that sends its requests through the fetch service) and the htmlparser2 package into `js/reader.js`. Needs a folder with `esbuild` and `htmlparser2` installed.
- `reader_test.mjs` — the reader, its fetcher and the Worker's own code together, with supplier sites stubbed out.
- `worker_test.mjs` — the fetch service on its own.
- `sync_worker_test.mjs` — the plan sync service on its own, against a stand-in bucket: who is answered, signing in, conditional writes, daily copies, snapshots, and the count of wrong passphrases (a burst of guesses included).
- `sync_client_test.mjs` — the planner's sync client (`js/sync.js`) and the sync service's own code together: two or three made-up browsers with made-up plans, no network. `node tools/sync_client_test.mjs`.
- `fake_r2.mjs` — the stand-in bucket both use.
- `sync_dev_server.mjs` — the sync service on this computer with a bucket in memory, for trying cloud sync without a Cloudflare account: `node tools/sync_dev_server.mjs 8791 "a passphrase"`, then give the planner (served from localhost) the address `http://127.0.0.1:8791`.
