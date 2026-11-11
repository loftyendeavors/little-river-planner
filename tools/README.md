# Tools

Scripts that produce this site from the planner's working copy. They are not part of the app and nothing loads them.

- `build_site.cjs` — writes `index.html`, `css/`, `js/`, `fonts/`, `manifest.webmanifest` and `sw.js` into this folder from the app's source. Run after `make_icons.py` has made `icons/`.
- `site_check.py` — opens the built site in headless Chrome: empty start, loading a backup, reload, opening with no connection, and with the network still off: stock typed in, vendor sizes shown, a sowing recorded.
- `build_offline.cjs` — packs the app into one self-contained HTML file.
- `make_icons.py` — draws the app icons.
- `build_reader.cjs` — bundles `reader/` (v7's page reader, unchanged, plus the wrapper that sends its requests through the fetch service) and the htmlparser2 package into `js/reader.js`. Needs a folder with `esbuild` and `htmlparser2` installed.
- `reader_test.mjs` — the reader, its fetcher and the Worker's own code together, with supplier sites stubbed out.
- `worker_test.mjs` — the fetch service on its own.
