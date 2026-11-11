# Little River Farm Planner

A crop planner that works on a map of the farm. Drag crops onto beds, move plantings, share beds, and keep one list of the assumptions the plan rests on.

This repository holds the app only. It contains no plan, no farm photo and no farm records.

## Using it

1. Open the site (the address is shown under Settings, Pages in this repository).
2. The first time, it opens on a small sample. Choose **Backup**, then **Load a v7 backup**, and pick your backup file. Your plan and map photo are then kept in that browser on that computer.
3. In Chrome or Edge, use the install button in the address bar to add it as an app. After the first visit it opens with no connection.

## Reading a variety from a supplier's page

In **Seeds**, choose **Add from a supplier page**. Pasting the page works anywhere, with no connection. Reading from a link needs the fetch service in `worker/`: put its address and key under **Link reader…** and use **Test connection**. Both are kept in that browser only, never in the plan or a backup.

## Seed stock, vendor sizes and sowing

- **On hand** is typed in the Seeds list; an order is marked arrived with one click.
- **Vendor size** shows what covers a shortfall at least cost, in the sizes that variety's own vendor sells. The size list comes from the variety's supplier page, so a packet is whatever that vendor says it is.
- Recording a sowing (in a planting's panel on the map, or beside a variety's plantings in Seeds) dates the planting and takes the seed it used off the lots on hand. A planned sowing never touches stock. A recorded one can be taken back, which returns the seed.

## Sowing

- **Sowing** lists everything sown from seed, a week at a time, as the acts they are: a batch of plug trays filled for several beds, rockwool for the towers, the week's live trays, a variety drilled into its beds.
- Transplants are sown the way v7 works them out: the plants wanted, plus the buffer, divided by germination, rounded up to whole rows of the plug tray. Plantings of one variety with one schedule are rounded once, as one batch.
- Varieties of one crop sown the same day share trays, each in whole rows: the list says how many trays the lot takes, draws each tray row by row, and tells each variety its rows. (v7 gives every variety trays of its own; the bench section can count that way instead.)
- A day after today is a plan, not a record: choosing one moves the ticked sowings to that day. Nothing is marked sown and no seed leaves stock.
- Tick the lines that were sown and record them in one step. Each planting is dated and its seed comes off the lots on hand, exactly as recording one planting does. One Undo takes the whole step back.

## Live trays and heated bench room

- **Trays** holds the weekly demand for whole trays sold live: trays a week for spring, summer and fall, days to grow and price for each crop. Every batch is sown that many days before the Monday it is due. The records are v7's own, so v7 reads a plan edited here.
- A batch that has been sown stays as it was recorded. Changes to the demand reach the batches not yet sown.
- **Heated bench room** shows, week by week, the tray spaces wanted by live trays, seedling trays, tower seedlings and potted seedlings against what the heated benches hold. It is shown, never enforced. Crates sheltered under heat are counted as standing on the floor unless you say otherwise.

## Where the plan lives

- In the browser you loaded it into, on that computer. Nothing is sent anywhere.
- A different browser, computer or phone starts empty until you load a backup there. Copies do not sync.
- Clearing that browser's site data removes the plan. Use **Backup**, **Download a backup** regularly.
- Loading a newer v7 backup replaces plantings, tray demand and seed stock with the backup's. What you settled here and v7 does not know is put back afterwards: the assumptions list, edits to crops, varieties, gardens and beds made here (while the backup still holds the value you changed), where sheltered crates stand, and tray plans opening on a Monday.

## What is here

| Path | What |
|---|---|
| `index.html`, `css/`, `js/` | The app. Plain scripts, no build step needed to run. |
| `js/engine.js` | Planning calculations. |
| `js/rails.js` | The rules that keep two plantings out of the same ground. |
| `js/guide.js` | Crop defaults checked against Johnny's Selected Seeds and the New England Vegetable Management Guide. |
| `js/seeds.js`, `js/seedlib.js` | The seed library: one list of varieties with what the plan needs of each, seed stock, vendor sizes, sowing records, a photo gallery, the crops, a detail panel, and the importer. |
| `js/sowing.js`, `js/sowview.js` | Practical sowing (plug trays, whole rows, batches shared by plantings), carried over from v7's own model, and the weekly sowing list. |
| `js/trays.js`, `js/traysview.js` | Weekly live-tray demand and the batches it produces, in v7's own record format. |
| `js/bench.js` | Heated bench room week by week. |
| `js/thumbs.js` | Small variety photos, shown wherever a crop or variety is named. They are made in the browser from the photos in a backup, or from a file you choose, and kept in that browser. |
| `js/reader.js` | Reads a supplier's product page into variety details. Generated by `tools/build_reader.cjs` from `tools/reader/`; do not edit it here. |
| `worker/` | The small fetch service (a Cloudflare Worker) that fetches supplier pages for the importer. Its key is set on the Worker and typed into the planner's settings; it is never stored in this repository. |
| `fonts/` | Typefaces, under the SIL Open Font License (see `fonts/LICENSES.txt`). |
| `sw.js`, `manifest.webmanifest`, `icons/` | What makes it installable and usable offline. |

The files here are generated from the working copy of the app. Changes made directly in this repository will be overwritten by the next update.
