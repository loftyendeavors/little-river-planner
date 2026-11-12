# Little River Farm Planner

A crop planner that works on a map of the farm. Drag crops onto beds, move plantings, share beds, and keep one list of the assumptions the plan rests on.

This repository holds the app only. It contains no plan, no farm photo and no farm records. The page's Backup menu says which preview is running (0.23 at the time of writing).

## Using it

1. Open the site (the address is shown under Settings, Pages in this repository).
2. The first time, it opens on a small sample, and a strip across the top says that no plan is in that browser. A plan is kept in the browser it was made in: it does not follow you to another browser or another computer. Bring one in with **Get it from the cloud** (if cloud sync is set up, below), **Load a backup** (a backup downloaded from this planner, or the complete backup from the v7 planner) or, in Chrome or Edge, **Open my plan folder** (the folder the plan is kept in, if you chose one under Backup). Your plan and map photo are then kept in that browser on that computer.
3. In Chrome or Edge, use the install button in the address bar to add it as an app. After the first visit it opens with no connection.
4. If the plan stored in a browser ever cannot be opened, the strip says so. What is stored is kept exactly as it is, and nothing is saved over it until you bring a plan in or choose to carry on; **Download what is stored** gives it to you as a file.
5. When the site has been updated, the planner says so and offers **Reload**. Until it is reloaded it goes on running the version it opened with.

## Reading a variety from a supplier's page

In **Seeds**, choose **Add from a supplier page**. Pasting the page works anywhere, with no connection. Reading from a link needs the fetch service in `worker/`: put its address and key under **Link reader…** and use **Test connection**. Both are kept in that browser only, never in the plan or a backup.

## Reading the timeline

A bar names its crop first, then its variety ("Carrot · Early Orange"), with a small photo where there is one. Where the bar is too short for both, the variety gives way first, and the crop's name is the last thing to go. Nothing is cut off; hovering a bar gives all of it.

- **What is shown.** The buttons above the chart choose All, Field, Greenhouses and tunnels, Towers or Crates, each with its count of plantings. With All, the kinds of space sit under headings of their own. The choice is remembered in that browser.
- **Summaries that open.** A bank of towers is one row: towers planted alike are one bar ("Lettuce × 7"). Click the bank's heading, or one of its bars, for a row per tower. A crate space with many plantings has a row per crop, and plantings that go in on the same day are one bar; the arrow by the crop's name opens it to every planting. Live trays are one strip, each cell the most trays standing on the benches that week; its heading opens a row per tray crop, and a click on the strip goes to the Trays view.
- **Scrolling and zoom.** The mouse wheel scrolls the rows, and with Shift it scrolls sideways. **Months**, **Weeks** and **Days** set the scale, from the whole year down to single days, and **−** and **+** step it; Ctrl and the wheel zoom about the day under the pointer. Hold and drag empty chart to move it both ways. The scale is remembered in that browser. The plan is one year, so the widest view is that year, edge to edge.
- A summary bar is not dragged: open it and drag the planting's own bar. A bank shown as one row takes no drop.

## The whole season on the map

**Whole season**, beside the other map tools, shows in every space everything it grows this year at once, instead of what stands on the planning date: a band for each crop in the order they go in, the first at the end nearer the top or left of the page, each as large as its share of the ground and the days it holds it. A tower with several crops is a pie; pots and crates are counted out by crop. Hover a bed for the dates; click it for its panel. The line under the map lists every crop of the season; click one to see only where it grows. Crops can still be dragged onto beds from here.

## A bed's size

Click a bed on the map and its panel shows width, length and area (a tower its sites, a bench its tray spaces). They are for reading: to change them, choose **Change this bed's size…** in that panel. Hovering a bed shows the same figures.

## Photos

- A plan file (`.json`) holds the plan only. A complete backup (`.zip`) also brings the farm photo and the variety photos.
- **Backup**, **Add photos…** adds pictures to the plan that is open and never replaces it: a picture file is the farm photo; the plan folder's `thumbnails.json` or a complete backup `.zip` gives variety photos, and the farm photo when none is shown. They can also be dropped anywhere on the page. A variety photo already kept is never written over.
- Loading a plan-only file over a plan that has its pictures keeps them: variety photos stay with the varieties they belong to, and the farm photo stays while the new plan was drawn on the same one.
- A variety whose record says where its picture came from, but whose small photo is not kept in the browser, gets it back without a step: through the fetch service when that is set up, otherwise straight from the supplier where the supplier allows it. Until then the picture is shown from the supplier's site while the computer is online. The plan overview says what is still missing.
- The importer keeps the first product picture of a supplier's page with the variety.

## Seed stock, vendor sizes and sowing

- **Add a seed lot**, the line at the top of Seeds, takes a vendor, a variety, a year and an amount, and saves on Enter. The variety is found as you type. A name that is not in the library asks for its crop and is added with the lot, in one step to undo.
- In the Seeds list a variety sits indented under its crop. Hover a variety (or select it) and **+ lot** opens a line directly under its row, with its vendor filled in and the cursor on the amount: Enter or **Add** records the lot; **×** or Escape closes the line and adds nothing.
- **On hand** is typed in the Seeds list; an order is marked arrived with one click.
- **Vendor size** shows what covers a shortfall at least cost, in the sizes that variety's own vendor sells. The size list comes from the variety's supplier page, so a packet is whatever that vendor says it is.
- Recording a sowing (in a planting's panel on the map, or beside a variety's plantings in Seeds) dates the planting and takes the seed it used off the lots on hand. A planned sowing never touches stock. A recorded one can be taken back, which returns the seed.

- **Order sheet…**, beside the filters in Seeds, opens what is short today: what the plan still has to sow, less seed on hand and on order, set out by supplier in each supplier's own sizes at the least cost, with a subtotal for each and a total. It is right on whatever day it is opened, so it serves the main order and a top-up later. Type an amount on a line to buy more or less than the shortfall; add a variety that is not short; copy, print or download the sheet. **Mark as ordered** puts a supplier's lines into seed stock as on order, in the amounts shown, in one step: they stop counting as short, and "order arrived" in the list later turns each into seed on hand. Where ground is booked twice, seed for both plantings is counted, and the sheet says so.

## Sowing

- **Sowing** lists everything sown from seed, a week at a time, as the acts they are: a batch of plug trays filled for several beds, rockwool for the towers, the week's live trays, a variety drilled into its beds.
- Transplants are sown the way v7 works them out: the plants wanted, plus the buffer, divided by germination, rounded up to whole rows of the plug tray. Plantings of one variety with one schedule are rounded once, as one batch.
- Varieties of one crop sown the same day share trays, each in whole rows: the list says how many trays the lot takes, draws each tray row by row, and tells each variety its rows. (v7 gives every variety trays of its own; the bench section can count that way instead.)
- A day after today is a plan, not a record: choosing one moves the ticked sowings to that day. Nothing is marked sown and no seed leaves stock.
- Tick the lines that were sown and record them in one step. Each planting is dated and its seed comes off the lots on hand, exactly as recording one planting does. One Undo takes the whole step back.

## Openings, series and plantings to place

There is no page for these: they open where you are.

- **An opening** is ground that stands free before, after or between the crops planned in a bed (three weeks or longer). Openings are drawn on the Timeline as dashed boxes and listed in a bed's panel. Click one and the details panel shows it: how long it is open, what comes before and after, and the crops whose whole cycle goes into it: growing, the full harvest and turnover, in season. Radishes before the eggplant; cabbage after the potatoes. Pick a crop to check its dates, change the day, the variety or the length, and add it.
- Field and tunnel ground is not offered before the first day the plan itself puts anything into unheated ground. Heated houses are offered from January.
- **A series** is one crop every so many days, counted between the days the plantings go in the ground: so many of them or until a date, whole beds or feet of bed each time. The series tool opens in the details panel, from a crop in the library (the small **series** button on its row), a planting's panel (**Plan a longer series**, which copies that planting: this is how tower cycles keep their days), a bed's panel, or an opening. What it would add is drawn on the Timeline as dashed **ghost bars**, and marked on the map, before anything is added. One button adds the whole series, and one Undo takes it out.
- The plantings go to the **gardens** ticked (each into the first free space, in that order), to the **beds** named (click beds on the map or rows on the timeline while the tool asks for them), or nowhere yet: **To place**.
- **To place** holds plantings that have no bed. A series asked to wait puts all of its plantings there; one sent to gardens or beds leaves there whatever found no ground. **A date is never moved to make a planting fit.** A planting with no bed counts toward nothing: not seeds required, the sowing lists, bench load or the forecast. So the number waiting is shown in the header on every view, above the crop library, and on a row of its own at the top of the Timeline.
- Drag a waiting planting onto a bed, on the map or the timeline: it keeps its own date. A free bed takes it whole. A bed that one other crop holds then asks how to share: split the length (the crop there gives up its last feet) or split the rows. Or click one to see the spaces free for all of its days, and place it with a click.
- **Where could this crop go this season?**, at the foot of the series tool, lists every opening the crop's whole cycle fits, soonest first, and the beds with nothing planned all year.
- The quick **N more, every N days** in a planting's panel is unchanged.

## Yield and price

**Assumptions** has two tables. **Days to harvest** is the first. **Yield and price** is the second, opened with the buttons under the heading:

- **Sold by** is the unit a crop is counted and sold in (each, bunch, lb, pint, quart, clamshell, head, stem). The yield and the price are in that unit; one unit is never turned into another. A variety can have its own unit and its own price: open the crop's row.
- **Picked** says how the harvest comes in. *Over the days*: the yield is a total, picked evenly over the harvest days (held, and taken as it is wanted). *Each week*: the yield is one week's picking, so a longer harvest gives more. *All at once*: the whole total is counted the day the crop is ready. Switching between a total and a weekly figure turns the yields already typed into the other, over the crop's harvest days. **Comes to** shows the total and the weekly figure side by side.
- **Days** is how long the crop is picked, and so how long its ground is held. A crop picked to the end of the season says "season"; a number typed there picks it for that many days instead.
- **Yield** is from one plant or one bed-foot (the row says which), in each growing condition the farm has: field, unheated tunnel, heated greenhouse, towers.
- **Sold %** is the part of what is picked that is good enough to sell. **Keeps wk** is how many weeks the crop keeps after picking: what is picked is then counted as there to sell evenly over those weeks, and the Harvest view gains **To sell** and **Picked**. **Turnover** is the days a crop's ground is held after its last harvest; where it settles ground that was booked twice, the planner says how many.
- Grey is what the plan uses now, from the crop's own record. A figure typed is used by every planting that has none of its own, is one step, and is said with what it does to the season's worth; clearing a cell goes back to grey. A yield that is still a new crop's starting value ("1 each"), and a crop with no price, are marked in the row and counted above the table.
- A planting with a yield, harvest days or turnover of its own keeps it. **Review…**, above either table, lists those plantings in groups, with the old planner's copies of crop values beside them, and says for each what letting it go would change: dates, yield, the season's worth, ground booked twice. Where the list can take a group's figure so that nothing changes, that is what is suggested. Nothing changes until Apply; the plan as it stood is kept as a snapshot first, and one undo takes the step back. A tower cycle's single harvest day and a tray batch's figures are left alone.

## Harvest forecast

- **Harvest** shows what the plan is expected to give by day, week or month: vegetables, microgreen trays and flower stems, a row to a crop, each counted in the unit it is sold in, coming in as the crop's line under Assumptions says (evenly over its harvest days, a week at a time, or all at once). A planting's yield is what it is counted by (plants, bed-feet, trays) × the crop's yield each × its marketable share, spread evenly over the days it is picked. A live tray is counted whole on the Monday it is due.
- The tiles give the week at a glance: crops ready, what they are worth at each crop's own price, trays and stems.
- Click a figure to see which plantings it comes from. A crop sorted under the wrong heading can be moved between vegetables and flowers.
- **A list to send** makes a plain-text availability list for a week, four weeks or the season, to copy into an email, print, or download as a spreadsheet. Quantities are rounded down, never up. Prices appear only if asked for.
- Days to harvest are the same in every month, and no "summer gap" is taken out of a crop's yield: what is planted to be picked in July counts in July.

## Live trays and heated bench room

- **Trays** holds the weekly demand for whole trays sold live: trays a week for spring, summer and fall, days to grow and price for each crop. Every batch is sown that many days before the Monday it is due. The records are v7's own, so v7 reads a plan edited here.
- A batch that has been sown stays as it was recorded. Changes to the demand reach the batches not yet sown.
- **Heated bench room** shows, week by week, the tray spaces wanted by live trays, seedling trays, tower seedlings and potted seedlings against what the heated benches hold. It is shown, never enforced. Crates sheltered under heat are counted as standing on the floor unless you say otherwise.
- Tower crops sown the same day share rockwool sheets, whatever the crop. A sheet is 98 cells, 14 rows of 7, and rides in one open 10 × 20 tray with drainage holes. (v7 counted a tower sowing in the crop's plug tray.) Under the chart, **Trays in use** gives the most plug trays of each kind in use on one day, the open trays under rockwool, and the live trays that leave with the sale.

## Saving to a file

- In Chrome or Edge on a computer, choose **Backup**, **Keep the plan in a folder…** and pick a folder. From then on the whole plan is written there a moment after every change: `little-river-plan.json`, the farm photo, the small variety photos, and a `history` folder with the plan as it stood at the end of each earlier day (the newest 30).
- **Save now** (in the Backup menu, by clicking the save indicator, or with Ctrl+S) writes the file at once. With no folder it downloads a backup file instead.
- A folder inside a synced drive keeps a copy off the computer. If the plan file was changed somewhere else, the planner stops writing and asks which plan to keep; it never writes over a plan it did not put there.
- Firefox and Safari cannot write to a folder. There the plan stays in the browser and **Save now** downloads a file.

## Cloud sync

Optional. It keeps one copy of the plan off your computers, in storage of your own, so a second computer or a phone can open it and a lost laptop does not take the plan with it.

- **The plan in the browser stays the one you work on**, with or without a connection. A change is sent a few seconds after it is made.
- **A write never lands on a plan the sender has not seen.** If another device has saved since this one last looked, nothing is sent and nothing is replaced: a strip across the page says so, describes both plans, and asks which to keep. Plans are never merged.
- **A newer plan is opened by itself only when the planner starts, and only over a plan that has not been changed since its last sync.** While the page is in use it is offered (**Open it**, **Not now**), never swapped in.
- Whatever replaces a whole plan, the plan that was open is kept as a snapshot first (below). The cloud also keeps the plan as it stood at the end of each of the last 30 days, and keeps any plan that was replaced on purpose.
- The save indicator answers for the cloud copy: "Saved · cloud 9:14", "cloud waiting" with no connection, or what it needs from you.
- The farm photo and the small variety photos travel with the plan.

Setting it up, once (a free Cloudflare account is enough):

1. Create an R2 bucket. Create a Worker and paste `worker/lrf-plan-sync.js` into it with **Edit code**, then **Deploy**.
2. In the Worker's **Settings**, under **Bindings**, add the R2 bucket under the variable name `PLAN`. Under **Variables and secrets**, add a secret named `SYNC_KEY`: the passphrase.
3. Open the Worker's address in a browser. It should say the bucket is bound and the passphrase is set.
4. In the planner: **Backup**, **Cloud sync…**. Type the Worker's address, the passphrase, and a name for the device. On the next device, do the same, or use **Get it from the cloud…** on the strip.

The passphrase is typed once per device and is not kept: the browser keeps a sign-in token instead, which is renewed as long as the device is in use and ends when the passphrase is changed. Wrong passphrases are counted by the service: five tries in a quarter of an hour, then it takes no passphrase for a quarter of an hour, then half an hour, doubling to a day. A device already signed in is not affected. The service answers the planner's own address only. Neither the Worker's address nor the passphrase is in this repository or in a plan file.

Sync works from the planner's web address, in any current browser. The single offline file keeps its plan in that browser only.

## Snapshots

**Backup**, **Snapshots…** lists the whole plan as it stood at earlier moments, and goes back to any of them.

- **Take a snapshot** before a large change, with a name of your own. A named snapshot is kept until you delete it, and is copied to the cloud when sync is set up, so it is listed on every device.
- The planner takes one by itself at the first change of each day, and before anything that replaces the whole plan: opening the cloud's plan, going back to a snapshot, loading a backup file. Its newest 20 are kept.
- **Go back to it** asks first, keeps the plan as it is now as a snapshot, and then opens the earlier plan with its photos. **Take it back** undoes that. **Download** gives a snapshot as an ordinary plan file.
- Snapshots live in the browser's database, beside the plan. They are not in a plan file or a backup.

## Where the plan lives

- In the browser you loaded it into, on that computer. Unless cloud sync is set up, nothing is sent anywhere.
- A different browser, computer or phone starts empty until you bring the plan in there: from the cloud, from a backup, or from the plan folder. Without cloud sync, copies do not sync.
- Clearing that browser's site data removes the plan and its snapshots. Keep a copy somewhere else: cloud sync, a plan folder, or **Backup**, **Download a backup**.
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
| `js/succession.js` | Planning ahead, as pure functions: a series of plantings, openings and what fits them, and plantings that have no bed yet (where one would land, how a bed could be shared). All obey the guard rails and the season. |
| `js/ahead.js`, `js/series.js` | The same, opened in place: an opening in the details panel; the series tool with its ghost bars; the "To place" list, its count in the header, and the question a held bed asks. |
| `js/timeline.js` | The season timeline: filters, summaries that open, one continuous scale. |
| `js/forecast.js`, `js/harvestview.js` | The harvest forecast: yield by crop and day, the three kinds it is sold as, and the lists that go to a chef. |
| `js/trays.js`, `js/traysview.js` | Weekly live-tray demand and the batches it produces, in v7's own record format. |
| `js/bench.js` | Heated bench room week by week. |
| `js/folder.js` | The plan kept as a file in a folder the user chose: written as it changes, daily history, and the rule that it never writes over a plan it did not put there. |
| `js/sync.js` | Cloud sync: what to send, what to open, and when to stop and ask. It talks to the Worker in `worker/lrf-plan-sync.js`. |
| `js/snapshots.js` | Snapshots of the whole plan, kept in the browser's database. |
| `js/backupui.js` | The Cloud sync and Snapshots windows, and the strip that asks which plan to keep. |
| `js/thumbs.js` | Small variety photos, shown wherever a crop or variety is named. They are made in the browser from the photos in a backup, from a file you choose, or from the address a variety's record names, and kept in that browser. |
| `js/reader.js` | Reads a supplier's product page into variety details. Generated by `tools/build_reader.cjs` from `tools/reader/`; do not edit it here. |
| `worker/lrf-variety-fetch.js` | The small fetch service (a Cloudflare Worker) that fetches supplier pages for the importer. Its key is set on the Worker and typed into the planner's settings; it is never stored in this repository. |
| `worker/lrf-plan-sync.js` | The plan sync service (a Cloudflare Worker with an R2 bucket): conditional writes, daily copies, snapshots, and a count of wrong passphrases. Its passphrase is set on the Worker; it is never stored in this repository. |
| `fonts/` | Typefaces, under the SIL Open Font License (see `fonts/LICENSES.txt`). |
| `sw.js`, `manifest.webmanifest`, `icons/` | What makes it installable and usable offline. |

The files here are generated from the working copy of the app. Changes made directly in this repository will be overwritten by the next update.
