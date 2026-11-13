# Little River Farm Planner

A crop planner that works on a map of the farm. Drag crops onto beds, move plantings, share beds, and keep one list of the assumptions the plan rests on.

This repository holds the app only. It contains no plan, no farm photo and no farm records. The page's Backup menu says which preview is running (0.35 at the time of writing).

## Using it

1. Open the site (the address is shown under Settings, Pages in this repository).
2. The first time, it opens on a small sample, and a strip across the top says that no plan is in that browser. A plan is kept in the browser it was made in: it does not follow you to another browser or another computer. Bring one in with **Get it from the cloud** (if cloud sync is set up, below), **Load a backup** (a backup downloaded from this planner, or the complete backup from the v7 planner) or, in Chrome or Edge, **Open my plan folder** (the folder the plan is kept in, if you chose one under Backup). Your plan and map photo are then kept in that browser on that computer.
3. In Chrome or Edge, use the install button in the address bar to add it as an app. After the first visit it opens with no connection.
4. If the plan stored in a browser ever cannot be opened, the strip says so. What is stored is kept exactly as it is, and nothing is saved over it until you bring a plan in or choose to carry on; **Download what is stored** gives it to you as a file.
5. When the site has been updated, the planner says so and offers **Reload**. Until it is reloaded it goes on running the version it opened with.

## Where things are

The top bar has seven views in three groups.

| Group | View | What it is for |
|---|---|---|
| The plan, and what it gives | **Map** | Where each crop goes: drag crops onto beds, move and share them |
| | **Timeline** | When each crop goes in and comes out, with the openings between |
| | **Harvest** | What the plan gives week by week, a list to send, and planning a crop to a weekly amount |
| Running the season | **Tasks** | The week's work, nursery and field, ticked as it is done |
| | **Nursery** | Bench room, live trays, supplies, and the benches themselves |
| | **Seeds** | Varieties, seed stock and orders |
| The figures underneath | **Assumptions** | Days to harvest, yield and price, crop by crop |

- **Backup**, at the right, holds saving, the plan folder, Cloud sync, Snapshots and photos.
- **To place** and **To settle**, beside it, count plantings that have no bed yet and places where ground is booked twice or a planting is longer than its bed. They show only when there is something to count; a click goes to the list.
- There is no settings page. A fact is changed where its effect shows: a bed on the map, a bench under Nursery, Set-up, a crop's figures on the Assumptions list.

## Reading a variety from a supplier's page

In **Seeds**, choose **Add from a link** and paste the address of the supplier's product page. On a device that is on Cloud sync the link is read through the sync service, with nothing more to set up (the service must be version 2: paste `worker/lrf-plan-sync.js` into the Worker again if the planner says it is older). The window opens on the link box alone. When a link cannot be read, it says which step failed and what to do (the device is not on Cloud sync, no connection, the supplier refused, the site is not on the list), and only then offers the other way in: copy the page's text (Ctrl+A, Ctrl+C on the product page), paste it, and give the variety's name. That works for any supplier, with no connection. The fetch service in `worker/` can be set up from the same place, under **Use a fetch service of your own instead…**; its address and key are kept in that browser only, never in the plan or a backup.

## How it looks

The planner is light, whatever the computer's own setting says. On a wide screen the farm photo is settled so that no empty strip shows beside it while its other side runs off the screen (on a screen wider than the photo it sits in the middle), and the Harvest table sits in the middle of the page. The map's scale, top left, is a label over a ruler exactly as long as the distance it names, on a small plate with an edge all round.

## Reading the timeline

A bar names its crop first, then its variety ("Carrot · Early Orange"), with a small photo where there is one. Where the bar is too short for both, the variety gives way first, and the crop's name is the last thing to go. Nothing is cut off; hovering a bar gives all of it.

- **What is shown.** The buttons above the chart choose All, Field, Greenhouses and tunnels, Towers or Crates, each with its count of plantings. With All, the kinds of space sit under headings of their own. The choice is remembered in that browser.
- **Summaries that open.** A bank of towers is one row: towers planted alike are one bar ("Lettuce × 7"). Click the bank's heading, or one of its bars, for a row per tower. A crate space with many plantings has a row per crop, and plantings that go in on the same day are one bar; the arrow by the crop's name opens it to every planting. Live trays are one strip, each cell the most trays standing on the benches that week; its heading opens a row per tray crop, and a click on the strip goes to the Trays view.
- **Scrolling and zoom.** The mouse wheel scrolls the rows, and with Shift it scrolls sideways. **Months**, **Weeks** and **Days** set the scale, from the whole year down to single days, and **−** and **+** step it; Ctrl and the wheel zoom about the day under the pointer. Hold and drag empty chart to move it both ways. The scale is remembered in that browser. The plan is one year, so the widest view is that year, edge to edge.
- A summary bar is not dragged: open it and drag the planting's own bar. A bank shown as one row takes no drop.

## The whole season on the map

**Whole season**, beside the other map tools, shows in every space everything it grows this year at once, instead of what stands on the planning date: a band for each crop in the order they go in, the first at the end nearer the top or left of the page, each as large as its share of the ground and the days it holds it. A tower with several crops is a pie; pots and crates are counted out by crop. Hover a bed for the dates; click it for its panel. The line under the map lists every crop of the season; click one to see only where it grows. Crops can still be dragged onto beds from here.

## A bed's size

Click a bed on the map and its panel shows width, length and area (a tower its sites, a bench its tray spaces). They are for reading: nothing in that panel changes them. A size is changed in one place, **Edit layout** on the map, and **Edit the layout…** under the figures goes there with that bed picked. Hovering a bed shows the same figures.

**Changes in the right-hand panel apply as you make them.** There is no Save to press: a field is taken the moment it is left, and each change is one Undo. The line under the panel's heading says so, and for a few seconds after a change it says **Saved**, what changed and when, with its Undo. A change the guard rails refuse says **Not changed**, and why, in the same place. If the click that leaves a field also closes the panel, the same is said once at the foot of the page. Edit layout's panel has the same line.

**Mixed beds.** A bed in the ground can hold several plantings at once, each on its own feet of the bed or its own rows.

- **Drag a crop or a variety onto a bed that is held** and a question opens at the bed: **Split the length** (everything there closes up and the newcomer takes an equal share at the end), **Split the rows** (where the bed's rows divide), or **Replace** (what was there leaves the bed and waits under To place, with its date; nothing is deleted). Each line says what it will do, with the plant counts that follow, before it is pressed. ×, Escape or a click elsewhere leaves without planting anything. No date is moved by any of them.
- **After a split the bed is being mixed**: a pill on the map says so, and the next varieties dropped on it split it again the same way without asking, until Done, Escape, a drop on another bed or another bed being selected. Each drop is one Undo.
- **Several varieties in this bed…**, under Variety in a planting's panel, lists the crop's varieties to tick. It says what the division will come to, and **Divide the bed** makes each ticked variety a planting of its own beside this one, on its date, in equal shares along the bed or by rows.
- **Sizes.** Shares start equal and are kept exact, so each comes to the same number of plants. On the map, push a selected planting's end into its neighbour to move the line between the two (pulled back, an end gives up feet as before). A planting's panel lists who it shares the bed with, with **Make them equal**. Once shares are no longer equal, a drop takes half of the share it is dropped on.
- **Send to To place**, in a planting's panel, takes it out of its bed and keeps it with its date; what it shared the bed with takes up its ground.
- A planting with recorded work, a crop that stands for years and a tray batch give up no ground and are not replaced; the drop says why. Towers are held whole; benches, pots and crates share by count as before. A planting dragged onto ground it can trade places with still trades. A planting waiting under To place still asks with its own window when dropped on a bed that one crop holds.

**Personal use or commercial.** A planting is grown to sell unless it is marked for personal use: **Grown for** in a planting's panel, or, for a whole bed or a whole garden, in Edit layout (a bed's panel shows it and links there). A planting follows its bed and a bed its garden, until one says otherwise; a bed that is part personal is a bed where one planting says otherwise. A personal planting is sown, grown, picked and counted like any other: seed, tasks, bench room and supplies do not change. It is left out of revenue (the season's worth, and every dollar figure on Harvest) and out of **A list to send**. Once anything is marked, Harvest offers Everything, Commercial and Personal use, and says in its headline figures which it is counting. It is a flag, not a share: **Sold %** under Yield and price stays the one percentage. Marking says at the time how many plantings it takes out of revenue and what the season's worth goes from and to.

## Editing the layout

**Edit layout**, the first of the map's tools, turns the map from a plan into a drawing of the ground. The crop library gives way to a list of the gardens, the details panel to the size and place of what is picked, and plantings are shown faintly: they stay with their beds, and nothing here plans a crop. **Done**, or Escape with nothing picked, goes back. Going to another view goes back too, and so does a press on either count in the header (to place, to settle), so that the list it opens can be seen.

- **Pick.** Click a bed; Shift-click picks more; Shift-drag picks a box; a garden's name on the map, or its line in the list, picks all of it; a double click on a bed picks its garden.
- **Move.** Drag what is picked. It lines up with spaces lying the same way and takes the path the row beside it already keeps, with guide lines and the path in feet; Ctrl moves freely. Alt-drag leaves it where it is and sets down a copy (a whole garden copied is a new garden). The arrow keys nudge half a foot (Shift 5 ft, Alt a tenth), and a run of presses is one Undo; they do not move the planning date while the layout is being edited.
- **Size.** With one bed picked, drag an end to change its real length or a side to change its real width, in half feet; near a neighbour's length it takes that length and says whose. The other end stays where it is. Width and length can also be typed, for every bed picked.
- **Turn.** Drag the round handle. A turn settles on a neighbour's line or a square one when it comes close, otherwise on a whole degree.
- **New garden.** Drag a block on the map: it takes the lines of the ground beside it (Ctrl draws it square to the photo) and beds fill it as it is drawn, at the bed width and path the farm mostly uses. Name it, choose the kind of place, the bed width, the path and which way the beds run, or pots and crates instead of beds, then make it. It is made in one step and is picked, ready to move or turn.
- **Tidy.** With several picked: line up sides, ends or middles; space them a typed path apart, or even out the paths between the two outer ones; set them out in rows; number them as they read on the map.
- **A whole garden** can be renamed, given another kind of place (which says first what it does to harvest dates), and drawn larger or smaller than true size to match the photo, its beds' real sizes unchanged.
- **Pots and crates.** A group is set out by how many, of what kind, how many side by side and how far apart.
- **Measure.** Drag between two points for the distance in feet. Typing what that line really measures sets the photo's scale.

Guard rails, not flags. A change that would lay one space on top of another does not happen: it is shown in red while it is held and goes back when let go (an overlap that came with the plan may stay). A space that holds plantings cannot be removed, and a bed cannot be made shorter than what is planted in it. Every change is one Undo.

On the plan's own map, a crop keeps the same pots or crates for as long as it stands, with its name on them, in place of crates filled afresh in order on every date. Dragging a crop within its own group gives it other containers; a crop that went in earlier keeps its place, and later ones make room. Fit farm, the zoom buttons, a garden's name and a double click move the view in one eased motion. The wheel is not eased: it zooms at once, about the pointer. A window that changes size is fitted again unless the view has been moved by hand.

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

## Tasks

- **Tasks** lists the week's work as the acts it is made of, in two halves. **Nursery** is the raising of the plant: a batch of plug trays filled for several beds, rockwool for the towers, the week's live trays, potting up, hardening off. **Field** is planting, wherever the plant goes (beds, tunnels, greenhouses, towers, crates; bulbs, canes and bought-in plants with the transplants), seed sown in the ground, and crates moved out.
- **Everything, Nursery, Field**, beside the week, shows both halves or one. The title, the tiles, the earlier tasks not recorded and the printed sheet follow it, so the nursery's list can be printed on its own. The choice is remembered in that browser, with how far ahead is listed: the week, two weeks or four.
- Transplants are sown the way v7 works them out: the plants wanted, plus the buffer, divided by germination, rounded up to whole rows of the plug tray. Plantings of one variety with one schedule are rounded once, as one batch.
- Varieties of one crop sown the same day share trays, each in whole rows: the list says how many trays the lot takes, draws each tray row by row, and tells each variety its rows. (v7 gives every variety trays of its own; Nursery, Set-up can count that way instead.)
- Tick what was done and record it in one step, on the day it was done. Each planting is dated, and what a sowing or a planting used comes off stock. A transplant sown or hardened off late goes out as many days later: the bar says what would move before anything is recorded, and it can be declined. Work done early moves nothing. One Undo takes the whole step back, and a recorded task can be taken back.
- A day after today is a plan, not a record: choosing one moves the ticked sowings to that day. Nothing is marked sown and no seed leaves stock.
- One line under the list says what stands on the benches that week, and leads to Bench room in the Nursery.
- On a phone the planner is this view and nothing else.

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

**Assumptions** has two tables. **Days to harvest** is the first: each row says where its days are counted from (transplanting, seeding in trays, or direct seeding). **Yield and price** is the second, opened with the buttons under the heading:

- **Sold by** is the unit a crop is counted and sold in (each, bunch, lb, pint, quart, clamshell, head, stem). The yield and the price are in that unit; one unit is never turned into another. A variety can have its own unit and its own price: open the crop's row.
- **Picked** says how the harvest comes in. *Gradually*: the yield is one week's picking, so a longer harvest gives more. *Clear*: the yield is a total, all of it counted the day the crop is ready. *On demand*: the yield is a total, held and taken evenly over the harvest days. Switching between a total and a weekly figure turns the yields already typed into the other, over the crop's harvest days. **Comes to** shows the total and the weekly figure side by side.
- **Days** is how long the crop is picked, and so how long its ground is held. A crop picked to the end of the season says "season"; a number typed there picks it for that many days instead.
- **Yield** is from one plant or one bed-foot (the row says which), in each growing condition the farm has: field, unheated tunnel, heated greenhouse, towers.
- **Sold %** is the part of what is picked that is good enough to sell. **Keeps wk** is how many weeks the crop keeps after picking: what is picked is then counted as there to sell evenly over those weeks, and the Harvest view gains **To sell** and **Picked**. **Turnover** is the days a crop's ground is held after its last harvest; where it settles ground that was booked twice, the planner says how many.
- Grey is what the plan uses now, from the crop's own record. A figure typed is used by every planting that has none of its own, is one step, and is said with what it does to the season's worth; clearing a cell goes back to grey. A yield that is still a new crop's starting value ("1 each"), and a crop with no price, are marked in the row and counted above the table.
- A planting with a yield, harvest days or turnover of its own keeps it. Above either table, **Move onto the list what changes nothing…** works out which of those plantings can follow the list with no date, yield, ground or dollar changing, says what it found, and asks once. **See what differs…** lists the rest in groups, crop by crop, and says for each what letting it go would change: dates, yield, the season's worth, ground booked twice. Nothing changes until Apply; the plan as it stood is kept as a snapshot first, and one undo takes the step back. A tower cycle's single harvest day and a tray batch's figures are left alone.

## Harvest forecast

- **Harvest** shows what the plan is expected to give by day, week or month: vegetables, microgreen trays and flower stems, a row to a crop, each counted in the unit it is sold in, coming in as the crop's line under Assumptions says (evenly over its harvest days, a week at a time, or all at once). A planting's yield is what it is counted by (plants, bed-feet, trays) × the crop's yield each × its marketable share, spread evenly over the days it is picked. A live tray is counted whole on the Monday it is due.
- The tiles give the week at a glance: crops ready, what they are worth at each crop's own price, trays and stems.
- Click a figure to see which plantings it comes from. A crop sorted under the wrong heading can be moved between vegetables and flowers.
- **Plan to a weekly amount…**, at the head of the page, opens the series tool asked from the harvest end: so much of a crop wanted each week between two days, and the planner says how many plantings, when and how large, less what the plan already gives. **plan…** on a crop's row (it shows when the row is pointed at) opens it on that crop; so does the window a figure opens.
- **A list to send** makes a plain-text availability list for a week, four weeks or the season, to copy into an email, print, or download as a spreadsheet. Quantities are rounded down, never up. Prices appear only if asked for.
- Days to harvest are the same in every month, and no "summer gap" is taken out of a crop's yield: what is planted to be picked in July counts in July.

## The Nursery

**Nursery** holds everything raised on a bench, in four tabs. A visit opens on Bench room.

- **Bench room** shows, week by week, the tray spaces wanted against what the benches hold, with a line and a chart for each kind of bench that has room: heated greenhouse, unheated greenhouse, outside. Live trays, seedling trays, tower seedlings and potted seedlings stand under heat. From the day hardening off starts (so many days before planting out, or the day recorded in Tasks), seedlings stand on the unheated benches as far as those have room, then outside, and what fits on neither stays under heat. A crop listed under **Grown on without heat** stands on the unheated benches between its two days of the year, once its trays have had their days under heat to come up; tower seedlings stay under heat. It is shown, never enforced. The tiles give the fullest day, the planning week, hardening off at its most, and what is to do in the nursery that week, with the way to that list in Tasks.
- **Live trays** holds the weekly demand for whole trays sold live: trays a week for spring, summer and fall, days to grow and price for each crop. Every batch is sown that many days before the Monday it is due; the same batches are listed week by week under the demand. The records are v7's own, so v7 reads a plan edited here. A batch that has been sown stays as it was recorded; changes to the demand reach the batches not yet sown.
- **How a tray is sown** is said per crop in the demand table: in cells (cells a tray × seeds a cell, and its seed is then counted in seeds) or in an open tray (grams a tray, counted by weight). A tray crop with no weight on record is taken as sown in cells until you say otherwise. No figure is assumed: a crop sown in cells counts no seed until both figures are there.
- **Supplies** counts what is used once over the season: every plug tray filled (bought by the case of 50), the trays that leave as live trays, rockwool sheets (by the case of 30) and pots. What comes back is counted at the most in use on one day: carrying trays for pots (15 pots a tray, or 10), the open trays under rockwool, and crates. Each is less what you say is on hand. Potting mix is in cubic feet and in bags of 2.8 cu ft: every tray, pot and crate starts from a round figure, shown in grey, and your own figure typed over it is used instead (0 says it takes no mix). The mix row says how many crates were counted, since they carry most of the total.
- **Set-up** is always open, in three parts under a line of the room the benches give. **Benches**: name, house, kind, width and length, whether the bench is in use, and its place in the list; a bench holds its area × the share that takes trays ÷ one 10 × 20 tray, unless you type what it holds. **Hardening off and growing on**: the days of hardening off, and the crops grown on without heat. **How trays and crates are counted**: whether varieties of one crop share trays, and whether sheltered crates stand on the floor or the benches. Every change is one step, says what it does to the room, and can be undone; none moves a sowing, planting or harvest day.
- Tower crops sown the same day share rockwool sheets, whatever the crop. A sheet is 98 cells, 14 rows of 7, and rides in one open 10 × 20 tray with drainage holes. (v7 counted a tower sowing in the crop's plug tray.)

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
| `js/map.js` | The farm map: every space drawn where it lies, what stands in it on the planning date or through the season, dropping and moving plantings, and the view. |
| `js/mapgeo.js` | The geometry of the map, with no page: frames turned to the beds, lining up and spacing, snapping to a neighbour's line and path, filling a block with beds, the rule that keeps one space off another, and which containers a crop stands in. Tested by `tools/mapgeo_test.cjs` on made-up shapes. |
| `js/mapedit.js` | Editing the layout: picking, moving, sizing, turning, copying, adding and removing spaces, a new garden drawn as a block, tidying, pots and crates, measuring and the photo's scale. |
| `js/guide.js` | Crop defaults checked against Johnny's Selected Seeds and the New England Vegetable Management Guide. |
| `js/seeds.js`, `js/seedlib.js` | The seed library: one list of varieties with what the plan needs of each, seed stock, vendor sizes, sowing records, a photo gallery, the crops, a detail panel, and the importer. |
| `js/sowing.js`, `js/week.js`, `js/sowview.js` | Practical sowing (plug trays, whole rows, batches shared by plantings), carried over from v7's own model; the tasks of a planting and what recording one moves; and the Tasks view, nursery and field. |
| `js/succession.js` | Planning ahead, as pure functions: a series of plantings, openings and what fits them, and plantings that have no bed yet (where one would land, how a bed could be shared). All obey the guard rails and the season. |
| `js/ahead.js`, `js/series.js` | The same, opened in place: an opening in the details panel; the series tool with its ghost bars; the "To place" list, its count in the header, and the question a held bed asks. |
| `js/timeline.js` | The season timeline: filters, summaries that open, one continuous scale. |
| `js/forecast.js`, `js/harvestview.js` | The harvest forecast: yield by crop and day, the three kinds it is sold as, and the lists that go to a chef. |
| `js/trays.js`, `js/traysview.js` | Weekly live-tray demand and the batches it produces, in v7's own record format; and the Nursery view with its four tabs. |
| `js/nursery.js` | The nursery, with no page: bench records and their edits, the room on each kind of bench through a season, and what the season uses (trays, rockwool, pots, carrying trays, crates, mix in cubic feet and bags). |
| `js/bench.js` | What the Nursery draws of the benches: Bench room (a line and a chart for each kind of bench), Set-up (the benches, hardening off and growing on, how trays are counted), Supplies, and the one line Tasks shows. |
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
