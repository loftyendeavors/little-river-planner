# The design rules

Every build that draws or changes a screen follows these. This page is the one statement of them in the repository. A build's
request to merge has a line for each rule that applies: how the screen meets it, or which rule it breaks and why.

The numbers of the scale are held by a check, `tools/scale.mjs`, which runs on every push ("scale", in the fast checks) and
fails on a size, a corner or a speed that is not a step. [How the scale is held](#how-the-scale-is-held) says what it reads
and what it leaves alone.

## The five rules

1. **One frame for every page.** A title that says what is on screen ("Today", "Forecast"). One line of figures; one of them
   may lead, at the largest size. A lead may stand on a line of its own above that line, with a small chart of its own
   course beside it and the period in hand at the right (the Forecast: projected revenue, revenue by week as ink bars on the
   line's baseline with the week in hand in orange, then the season's figures on the one line under it; the work below is
   the full view). In a narrow panel the figures stand one to a line, as below. The page's own
   controls. Then the work. The explanation is behind "?". No eyebrow, no paragraph, no row of tiles, no standing notice.
2. **One card for whatever is picked.** A bed, a planting, an opening, a run or a variety opens the same floating card: head
   (what it is, "⋯", ×), one picture, one line of what it comes to, the one or two boxes changed most, a tick, then rows that
   open in place and show their figures when closed. With nothing picked there is no panel. A hint (what a thing is), a help
   ("?"), a calendar and a right-click menu are the same card, smaller.
3. **One answer for each action, where the action happened, with Undo.** Never two. Nothing that answers lies over a control.
4. **One list for what needs the grower.** Loose ends, in the header, in two kinds: needs you (counted, in orange) and when
   you have a minute (not counted). The button is in the header only while something is counted. A state of things (seed on order) is a filter on its own page, not a notice. A flag
   stands on the row it blocks and opens where it is mended.
5. **One scale under everything**, below.

## The scale

- **Type**: 11, 13, 15, 18, 24, 32. Two weights. A figure the grower typed is ink and bold; a default is grey.
- **Two densities on those steps.**

| | Roomy: a list that is ticked (Tasks, Loose ends, a card's rows) | Dense: a table or a chart (Timeline, Forecast, Seeds, Successions, Assumptions) |
|---|---|---|
| Page title | 32 | 24 |
| Card or section title | 24 | 18 |
| A row | 15 over 13 | 13 over 11 |

- **Space**: 4, 8, 12, 16, 24, 32.
- **Corners**: 4, 8, 12, 20, and the pill. 4 for a tick or a tag; 8 for a control; 12 for a photograph, a part inside a card,
  a menu or a hint; 20 for a card, a popup or a sheet.
- **Controls**: 32 high on a page, 28 inside a card or a table, 44 for anything pressed on a phone. A button does something:
  main (ink), standard (bounded) or quiet. A link goes somewhere and is underlined. One switch: bordered, the chosen side in
  ink. One filter pill. A round tick finishes a job; a square tick sets a yes or a no.
- **Colour**: the ten family hues are for crops and nowhere else. An amount is ink, lighter to darker. Orange means "look
  here now": the thing picked, today's line, where a drop will land, what is late or needs the grower. How a thing stands is
  a dot and a word: green (done, room to spare), amber (short of something), red (cannot be). One amber. Never a coloured
  panel.
- **Depth**: a card rests on the page with a soft shadow and no border; a floating thing has the strong shadow.
- **Motion**: 120 ms for a press or a tick; 240 ms for something that arrives or moves; one easing; none when the computer
  asks for reduced motion.

## Parts, made once

Each part is given once, in the last block of `css/app.css` ("Parts, made once"), under a plain name. A page that already
had a name of its own for the same part is listed beside it there, so the two cannot drift apart.

| Part | Its name | What it is |
|---|---|---|
| A card | `.card`; floating, `.card.float` | Corner 20. On the page: the soft shadow (`--shadow-card`), no border. Floating: the strong shadow (`--shadow-float`) |
| A row | `.row`, with `.row-name`, `.row-detail`, `.row-word` | A photograph 40 square, a name over one line of detail, one word at the right |
| A tick | `.tick.round`; any checkbox | The round one finishes a job; the square one sets a yes or a no, in ink |
| A button | `.btn`; `.btn.primary` (or `.btn.main`); `.btn.quiet`; `.btn.small` | Standard is bounded, main is ink, quiet has no edge. 13 px, weight 600, corner 8 |
| A switch | `.seg` | Bordered, the chosen side in ink |
| A filter pill | `.chip` | A pill; the chosen one in ink |
| A box to type in or choose from | `.field`, `.fld` | As high as a button beside it |
| A menu | `.menu-pop` | Floating, corner 12 |
| A hint and its "?" | `.hint`, `.help-btn`; in a script, `LRFUI.help(lead, from, more)` | Floating, corner 12; "?" is a round button of 28. The hint says what the page's standing paragraph said, then what each of the page's controls does (the words a control shows only under a pointer) |
| A sheet and its foot | `.dialog`; `.sheet-foot` (or `.dialog-actions`) | Corner 20, 24 of padding. The foot: the way back at the left (`.back`), then Cancel and the one dark button at the right |
| A page's line of figures | `.frame-figs` | 13 px, the words in grey and each value in ink and bold. In a narrow panel the figures stand one to a line |
| Loose ends | `#settleBadge`, `.loose`, `.loose-row`; in a script, `LRFPanels.looseEnds()` | The button in the header: the page's own surface, its count alone in orange. The list it opens: floating, corner 12, a row of the parts without its photograph for each loose end, under one of two kinds |

A control's height is one of three, named at the head of the style sheet: `--control` (32, on a page), `--control-in` (28,
inside a card or a table) and `--control-phone` (44, anything pressed on a phone).

- **A row**: a photograph 40 px square, a name over one line of detail, one word at the right. A variety's photograph stands
  wherever a variety is named.
- **A date**: one calendar. It says what a day would move before the day is picked.
- **A place a carried crop fits** (room for a crop): the opening lit white with a 1 px orange edge, and the planting drawn in
  it as the Timeline draws any planting, on the first day it can go. Everything else on the page at half strength.
- **A sheet**: 520, 760 or 960 wide. A title, one sentence, the boxes, what the change will do. One foot: the way back at the
  left, then Cancel and the one dark button at the right. A sheet that changes nothing closes with "Done". No × as well.

## Where the frame stands

Tasks was built to it. Nursery, Seeds and Assumptions stand in it: no eyebrow, no standing paragraph, no standing notice, the
title at 24 with "?" beside it, and one line of figures. On the Nursery the four tabs stand over the figures, not under them:
the figures differ from tab to tab, and over the tabs they made the tabs jump. On Seeds the figures are in the side panel
while nothing is picked, one to a line, because that panel still stands there; they move when the panel becomes the card of
rule 2. The Forecast page (once Harvest) stands in it too: projected revenue leads at 32 with revenue by week drawn beside it,
the week in hand at the right of that line, and the season's own figures on the line under it (0.80; the grower kept the
chart, Nov 20).

## Words

The grower's word of Nov 20: every word on a screen is technical or financial, brief, and makes sense on its own. Money is
said as a farm's books say it: **projected revenue** for the season (not "the season's worth"), **revenue** for a week, a kind
or a crop, **peak week**, and **Harvest** for a span of picking. A term once chosen reads the same on every screen and in every
message, toast and sheet. A build that names a figure takes its word from the glossary the project keeps, and a new term is
put to the grower before it is used. The Forecast page speaks this way from 0.80. **Still to change, as a build of its own**:
"the season's worth" in the messages, sheets and cards of the other pages, and the checks that read those words.

## Loose ends

The one list for what needs the grower is in the header. Its button says "Loose ends"; its count is orange and counts only the
first kind.

| Kind | What is listed | Where it opens |
|---|---|---|
| Needs you (counted) | Ground booked twice, or plantings longer than their bed | The Map, at its list of fixes |
| | Seed no row can count | Seeds, with the lots shown in the panel as the thing picked |
| When you have a minute (not counted) | Plantings that differ from the list | The Assumptions list, with a sheet: one press for what changes nothing, and the window of what differs |
| | Published guidance not yet used | The Assumptions list on Days to harvest, with a sheet naming the crops |
| | Supplier days that do not say where they are counted from | Seeds, filtered to them |

A page hands its rows over with a function named `loose` (`LRFSeeds.loose`, `LRFAssume.loose`); the header asks each page and
sorts what comes back. A state of things is not a loose end: seed on order is a filter of the Seeds list, and late work is on
Tasks. A new notice is never the way to say that something needs the grower: it is a row here, or a flag on the row it blocks.

## Leave alone

The Timeline's bars. The drag and the tooltip that names the dates before a drop. The bench chart and the supplies table. The
seed gallery. The density of the Timeline and of the Forecast table. The three typefaces. The farm photograph in colour. No
glass, no blur.

## How the scale is held

The steps of type, corners, space and motion are named once, at the head of `css/app.css` (`--type-13`, `--corner-8`,
`--space-12`, `--speed-press`, `--speed-move`, `--ease`), and every size, corner, padding, gap and speed in the style sheet is
written by one of those names. `node tools/scale.mjs check` reads the style sheet and fails on one that is not; `node tools/scale.mjs move` puts a
value that is off the scale on its nearest step (under 12 to 11; 12 to under 14 to 13; 14 to under 16.5 to 15; 16.5 to 20 to
18; over 20 to 27 to 24; above that 32. Corners: up to 5 to 4; 6 to 9 to 8; 10 to 15 to 12; 16 and over to 20; 50 % and 99
and over to the pill. A padding or a gap from 3 px to 32 to the nearest step, and to the lower one when it stands midway. A
speed under 180 ms to the press, the others to the move). It is safe to run again.

What the check leaves alone, each written in a list at the head of `tools/scale.mjs` with its reason, and each failing the
check on the day it no longer matches anything:

- **The corners of marks on a chart**: a bar, a cell or an opening of the Timeline, a meter, the swatch of a key. They are
  drawn to the chart's own measure (a day, a foot of bed), not to a control's.
- **Type sized to the thing it is drawn on**: a label on the map grows with the map; a letter that stands for a photograph
  grows with its tile.
- **Sizes in points**: the printed sheets. Paper is not a screen.
- **Space inside the parts listed under "Leave alone"**: the Timeline, the Forecast table, the bench chart and the supplies
  table, the seed gallery, the printed week. And any padding or gap of 2 px or less (a hair), or over 32 (a placement: a line
  set in under a photograph, a column kept for a label). A placement that follows a padding has to be kept in step by hand.
- **Four animations that are not an arrival or a press**: a message that waits before it fades, a flash that draws the eye,
  the flourish of a tick.

What the check does not hold yet: margins, the heights of controls (no check measures them: the parts above give them, and
a page's own rule can still say otherwise), colour, and which step a thing takes (it sees that a title is on a step, not that it is on the right one).
It reads `css/app.css` and looks for a size set by a script in `js/`; it does not look at the page in a browser, so a size
the browser gives a tag by itself is not seen.
