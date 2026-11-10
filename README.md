# Little River Farm Planner

A crop planner that works on a map of the farm. Drag crops onto beds, move plantings, share beds, and keep one list of the assumptions the plan rests on.

This repository holds the app only. It contains no plan, no farm photo and no farm records.

## Using it

1. Open the site (the address is shown under Settings, Pages in this repository).
2. The first time, it opens on a small sample. Choose **Backup**, then **Load a v7 backup**, and pick your backup file. Your plan and map photo are then kept in that browser on that computer.
3. In Chrome or Edge, use the install button in the address bar to add it as an app. After the first visit it opens with no connection.

## Where the plan lives

- In the browser you loaded it into, on that computer. Nothing is sent anywhere.
- A different browser, computer or phone starts empty until you load a backup there. Copies do not sync.
- Clearing that browser's site data removes the plan. Use **Backup**, **Download a backup** regularly.

## What is here

| Path | What |
|---|---|
| `index.html`, `css/`, `js/` | The app. Plain scripts, no build step needed to run. |
| `js/engine.js` | Planning calculations. |
| `js/rails.js` | The rules that keep two plantings out of the same ground. |
| `js/guide.js` | Crop defaults checked against Johnny's Selected Seeds and the New England Vegetable Management Guide. |
| `fonts/` | Typefaces, under the SIL Open Font License (see `fonts/LICENSES.txt`). |
| `sw.js`, `manifest.webmanifest`, `icons/` | What makes it installable and usable offline. |

The files here are generated from the working copy of the app. Changes made directly in this repository will be overwritten by the next update.
