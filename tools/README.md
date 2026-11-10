# Tools

Scripts that produce this site from the planner's working copy. They are not part of the app and nothing loads them.

- `build_site.cjs` — writes `index.html`, `css/`, `js/`, `fonts/`, `manifest.webmanifest` and `sw.js` into this folder from the app's source. Run after `make_icons.py` has made `icons/`.
- `site_check.py` — opens the built site in headless Chrome: empty start, loading a backup, reload, and opening with no connection.
- `build_offline.cjs` — packs the app into one self-contained HTML file.
- `make_icons.py` — draws the app icons.
