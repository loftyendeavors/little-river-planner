# The checks, and how a build is made

Everything here runs on a made-up farm. No grower's plan is needed to check a build, and none is kept in this folder.

- [What is here](#what-is-here)
- [Running the checks](#running-the-checks)
- [On GitHub](#on-github)
- [The made-up farm](#the-made-up-farm)
- [What a build changed](#what-a-build-changed)
- [Two builds side by side](#two-builds-side-by-side)
- [The plan's shape](#the-plans-shape)
- [Hooks](#hooks)
- [Deliberate faults](#deliberate-faults)
- [Making a build](#making-a-build)
- [Writing a check](#writing-a-check)

## What is here

| | |
|---|---|
| `setup.sh` | Makes the work folder the checks run in: the app folder (the planner's code with the made-up farm as its data), the farm as a backup file, the scripts of the build before, the typefaces |
| `run.sh` | Everything, in parts. `sh tests/run.sh` runs them all in order; `sh tests/run.sh node app1` runs two |
| `quick.sh` | The fast checks: no browser, a minute or two in all. It is the part called `node` |
| `b.sh` | Browser checks by name: `sh tests/b.sh sowing step2a`, `WIDTH=1480 sh tests/b.sh r1`, `DARK=1 sh tests/b.sh step3a-site` |
| `verdict.py`, `counts.json`, `counts.py`, `known-faults.json` | Reads what `run.sh` printed and says whether every line passed, whether each check ran the number of lines written down for it, and which failing lines are faults already written down. `counts.py` puts the counts of a run together |
| `faults.sh` | The deliberate faults: `sh tests/faults.sh list` |
| `env.sh` | Where everything is. Read by the others; nothing in it is tied to one computer |
| `builds/`, `what_changed.cjs` | What each build changes in what a browser is served, one file a build, and the check that holds the build in hand to its own |
| `screens_check.py` | A picture of each main screen at a laptop's width, a wide desktop's and a phone's, compared with the build before |
| `*_test.cjs` | Checks of the planner's arithmetic, without a browser |
| `*_check.py` | Checks of the page in a real browser |
| `mutate*.py` | The faults themselves |
| `shared_test.cjs` | The files the merge writes (`tools/shared.cjs`) and the taking of main into a branch (`tools/take_main.cjs`), on a copy of the repository with a main of its own ("Two builds side by side") |
| `take_main_job_test.cjs` | The job that takes main in, read as text: no code of a branch runs where a key can write |
| `join_check.py`, `snaps_test.cjs`, `mutate_join.py` | Two devices that both changed the plan, joined record by record, in two real browsers against the sync service's own code (the switch, taking in, undo after it, "Use mine"); which snapshots stay; and their faults. The join rules themselves are `merge_test.cjs`, and the order of taking in is in `tools/sync_client_test.mjs` |
| `hooks_test.cjs` | Every hook a check reads is written by the planner, and nothing styles one ("Hooks") |
| `plan_shape.cjs`, `shape_test.cjs`, `shape_check.py` | The plan's shape written down, and the two checks that hold the farm, the planner and the merge to it ("The plan's shape") |
| `farm/` | The made-up farm: how it is made, and the result |

`tools/scale.mjs` holds every size, corner and speed of the style sheet to the one scale (`DESIGN.md`); it is the check
called `scale` among the fast ones, and it is also the tool that moves a value to its step. The map's own checks (`map_check.py`, `map_views_check.py`, `mapgeo_test.cjs`, `mutate_map.py`), the checks of the sync and
fetch services and `site_check.py` are in `tools/`, beside the code they belong to. `run.sh` runs them with the rest.

## Running the checks

Needs: Node 22, npm, git, Python 3 with `playwright` and `pillow` (`pip install playwright pillow`; no browser download:
the checks use the Chrome at `/usr/bin/google-chrome`).

```
sh tests/setup.sh                  # once, and again after anything in the repository changes
sh tests/run.sh node               # the fast checks
sh tests/run.sh app1 | tee /tmp/part.log     # one part of the browser checks; the log is kept outside the repository's folder
python3 -I tests/verdict.py /tmp/part.log app1    # exit 0: every line passed, and the part ran as many lines as counts.json says
```

- The work folder is `/tmp/lrf-work` unless `LRF_WORK` says otherwise. It can be thrown away.
- A check prints its lines and ends with `{"passed": N, "of": M, "failed": [...]}`. To read one check's lines with their
  details, run its command from `b.sh` by hand, without the part after the `|`.
- A name ending in `-site` runs the check on the built site, which is the repository itself. It has no plan of its own, so
  the check loads the farm's backup file first. A name ending in `-off` runs on the single offline file, which the name
  `offline` builds. `screens` is the pictures (below, "What a build changed").
- Nothing may change the repository or the work folder while a part runs: the page is served from them.
- The parts: `node`, `build` (writes the site and `js/built.js` into the repository with `tools/shared.cjs`, and fails if
  that changes a file: what is kept here must be what the code and the build's own file write), `app1` to `app4` and `new` (the app folder), `off` (the offline file), `site1` to `site10` (the
  built site, the other window widths, a computer set to dark), `screens` (the pictures).
- On a small computer the whole run takes an hour or more, and a check that measures timing can stumble while something else
  is running. Run it again alone before believing it. On GitHub the parts run side by side.
- **`counts.json` holds the number of lines each check runs**, part by part. A check that runs another number fails, and so
  does one that did not run, or ran twice, or that nothing wrote down. That is how a check that stopped early, or a block of
  lines skipped because the plan had no subject for it, is seen, by name. A build that adds or removes lines writes the new
  numbers for the checks it changed and no others: `python3 -I tests/verdict.py <log> <part> /tmp/ran/ran-<part>.json`, then
  `python3 -I tests/counts.py /tmp/ran write`. On GitHub the last job prints the whole file as the run would have it.
- A check's name there is the one it is run by: for a browser check the name given to `b.sh`, with ` @1480` for another width
  and ` dark` for a computer set to dark; for a fast check, and for the two of the `build` part, the name it is given with
  `named` in `quick.sh` and `run.sh`.
- **`known-faults.json` holds faults of the planner that a check has found and that are not yet mended**, each with the one
  line that fails for it, by its exact name. Such a line does not fail the run. The day it passes, the run fails until the
  entry is taken out.

## On GitHub

`.github/workflows/checks.yml` runs every part on every push, side by side: about eight minutes. Beside the parts it runs
**lint**, which reads the scripts without running them (a name used and never made, a key written twice, a branch that
cannot be reached): its rules, and how to run it by hand, are in `tools/eslint.config.mjs`. The result named
**All checks** is the one a merge waits for, and it waits for the parts and for lint. The pictures a failed part took are kept with the run for a week. Two things are
kept with every run: **counts**, the file `tests/counts.json` as that run would have it, and **screens**, the pictures of
every main screen that looks different from the build before (before, now, and the two side by side). The driver of the
browser and the drawing library are installed at versions said outright in the workflow; the browser is the runner's own.

`.github/workflows/faults.yml` runs the deliberate faults, in some eighty pieces side by side. It is not run on every push:
it is started by hand from the Actions page ("Faults", "Run workflow", and the branch to run it on). It is for the build that
changes a check or the part of the planner a check covers.

## The made-up farm

`farm/make_farm.cjs` writes "Example Farm" from a fixed seed: the same farm, byte for byte, every time. `farm/make_pictures.py`
draws its picture from above and a small picture for each variety. `farm/make_backup.py` packs it as a backup file. The
results are kept in `farm/data/`. `setup.sh` packs the backup afresh from them, and `quick.sh` writes the farm again to show
that nothing but the generator made it.

It has one of every kind of thing the planner knows: field beds and raised beds, a tunnel, greenhouse beds, two lines of
towers, crates and pots, live trays on heated benches, cane berries, bulbs, beds shared lengthwise and by rows, plantings
that carry figures of their own, ground booked twice, plantings longer than their bed, empty ground, seed on hand and on
order. Each part of it draws from a run of chance of its own, so adding to one part leaves the rest as it was.

**A check that needs something the farm lacks adds it to the farm**, in `make_farm.cjs`, with a comment saying which check
needs it:

```
node tests/farm/make_farm.cjs js tests/farm/data            # writes layout.json; stops there if there is no picture yet
python3 -I tests/farm/make_pictures.py tests/farm/data      # only when the ground or the varieties changed (needs Pillow)
node tests/farm/make_farm.cjs js tests/farm/data            # writes the plan, the backup's plan, the seed, the pack sizes
sh tests/setup.sh && sh tests/run.sh node                   # then everything: a change to the farm reaches every check
```

A change to the farm changes what every check sees. Run them all after it.

## What a build changed

"This build moves no date, yield, price, seed count or bench figure by itself" is proven in two ways, and a third says whether it changed how a screen looks.

1. **The figures.** `step3a_test`, `step3b_test`, `step5a_test`, `step5b_test` and `stepF_test` work out every planting of the
   farm with this build's scripts and with the scripts of the build before, and compare: every date, the ground it holds,
   its yield, the forecast day for day. `setup.sh` takes the build before from git: where the branch left `main`, or on
   `main` itself the commit before.
2. **The files.** A build adds one file of its own under `tests/builds/` (`tests/builds/the-bed-panel.json`), which names
   what it changes in what a browser is served: under `words` the scripts in which only the text inside strings, or a
   comment, differs, under `code` those whose program differs, `added` and `removed`, and under `page` any other served file
   (`index.html`, `css/app.css`, a typeface, an icon; not `sw.js` nor `js/built.js`, which `tools/shared.cjs` writes from the
   rest and the part `build` holds). It also holds the build's entry for "What changed", under `changes` ("Making a build").
   `what_changed.cjs` holds the build to it: a file named nowhere
   must be the build before's byte for byte, and a script under `words` must be the same program once its strings are set
   aside (both are parsed and compared; one line answers for all of them, so the check runs as many lines for every build). **Which file is this build's is written nowhere: it is the one the build before does
   not have.** So a file another build left cannot speak for this one, no build writes a file another build writes, and
   the files of earlier builds stay as a record (the check fails if one is changed). A reviewer reads one short file to see
   what a build touches. A script under `words` can still change any text, a date written as text among them: the figures
   in 1 are what answer for those.
3. **The pictures.** `screens_check.py` photographs each main screen (the map, the timeline, the forecast table, Tasks, the
   Nursery's four tabs, Seeds, the Assumptions list's two halves) on the built site and on the build before, with the same
   farm on the same pretended day, at 1707 and 3440 wide, and Tasks at a phone's 390. A screen that looks different fails,
   unless the build's file names it under `screens` (`"screens": ["map", "tasks"]`; the names are in the check): then it has
   to look different at one width at least. Each build is photographed twice: the few pixels that differ between two takes
   of one build (the edge of a rounded corner, the end of a curve) are set aside with the pixels round them. A screen that
   is not plainly the same is photographed twice more, and twice more again if the takes of a build stand two against two;
   the takes that agree with most of the others are compared, and a screen whose takes still do not agree fails as not
   holding still. It sees the first screenful of each screen as it opens: not a panel, a menu or a window, not what a click
   or a drag brings up, not a change of fewer than nine pixels or of a colour by less than 5 levels in 255, not a change
   that shows in fewer than half the takes, and not whether a change is for the better. A screen new in a build has no
   picture in the build before: give it its entry in the check in the build after. The check is new: if it fails where
   nothing changed, that is a fault of the check, to be mended there and not worked round.

A build that is meant to change a figure says which, shows it on the page before anything moves, and has a check of its
own that the figure changes there and nowhere else.

The same proof can be run on a real plan, on the computer that holds it: `node tests/step3b_test.cjs <app folder> <plan.json>
<js of the build before>`. A plan file never goes into this repository.

## Two builds side by side

Two builds made at once on two branches collide where they change the same thing. The files every build used to rewrite by
hand are written by a tool instead, so that they never need a hand:

- **`js/built.js`**: the label, and the list behind "What changed". `tools/shared.cjs` writes it from the build before's list
  and the build's own entry (`changes` in its file under `tests/builds`), giving the entry the next label after the build
  before's and the day. Nothing else names the label: the page reads it there, and so do the checks (`LRF_LABEL`, in `env.sh`).
- **the built site** (`index.html`, `sw.js`, `js/pwa.js`, the typefaces, the manifest): written by the same tool, from the code.
  `index.html` no longer carries the label, so it changes only where a build changes the page.
- **`tests/counts.json`**: joined check by check (`python3 -I tests/counts.py join`). A check's line comes from the side that
  changed it; where both changed the same check, each by its own lines, both are counted, and the run on the two together
  says whether that is right.

**Taking main in** is one command, which does all of that and leaves only a conflict in the code for a hand:

```
node tools/take_main.cjs . $LRF_WORK/scratch/node_modules/@fontsource-variable --commit
```

It fetches main, merges it, settles `js/built.js`, `sw.js` and `tests/counts.json`, runs `tools/shared.cjs` and commits. It
ends 0 when the branch holds main; 3 when a file of the code or of a note conflicts, which it names and leaves open: settle
those, then `node tools/shared.cjs . <fonts> origin/main`, `git add -A` and commit. Push, and the checks run on the two together.

**On GitHub it happens by itself.** When main moves, `.github/workflows/take-main.yml` takes it into every open pull request
from this repository that it can take in without a hand, pushes, starts the checks for the branch and says so on the pull request.
Where the code conflicts it pushes nothing and names the files there. The merge runs a branch's own helpers, so it runs with no key,
one job a pull request on a machine of its own; the job that pushes runs nothing of any branch, and pushes only onto the commit the branch was read at
(`take_main_job_test.cjs` holds this). So a chat that is still building may find its branch
moved: **fetch it before each push**, and if the push is refused, `node tools/take_main.cjs . <fonts> --from origin/<branch>
--commit` takes the branch as GitHub holds it in, settled the same way.

What each build still writes of its own, and settles by hand when two builds meet in it:

- its file under `tests/builds/`, which no other build writes;
- its code. The lists every build adds a word to (the sets in `faults.sh`, a part's checks in `run.sh`) are one name a line, so
  two builds that each add one add two lines; where both add at the same place git asks, and both are kept;
- `README.md` and the other notes, which are kept by hand and name no label.

## The plan's shape

`plan_shape.cjs` is the list of what a plan may hold: every place the planner writes (`plantings[].tasks.delay.*.to`), its type,
and how `js/merge.js` joins it when two devices' plans meet: taken whole, the later stamp, a planting's place or time, a
recording, keys of one record joined as one value, a rule of its own, or (with no word) by shape. Its head says each word. It is not served: nothing in it changes what
the planner does.

- `shape_test.cjs` (fast) holds the list to itself; to the merge's own tables, read from `js/merge.js`'s code, both ways, so a
  rule changed on one side alone fails; and to the farm as the planner holds it and as a file holds it, and to the plans the
  planner's own functions make of it: every kind of job recorded and taken back, put off, skipped and noted; seed lots
  added, counted, received, moved and deleted; a variety saved by the variety editor's own functions and a crop added to the
  library (the screens that call them are not on the page's tour).
- `shape_check.py` (in a browser, part `app1`) takes a tour of the page's own functions that change a plan, one for every kind
  of step `withOps` in `js/app.js` applies (a new kind fails a line until the tour makes it), on a pretended day in the season,
  and holds every record each step wrote, the plan the page holds, the plan the browser stores and the plan as a file to the list.

**A build that writes a new field adds its entry**, with the word for how it is joined. An object whose parts only make sense
together (a from and a to) is `whole`, and goes into `WHOLE` in `js/merge.js` in the same build (a place under a key the data
chooses is written with `*`); keys of a record that are read together are `together`, and go into `TOGETHER`. Either is a change to saving.
The checks see the fields the farm and the tour reach; a field written on a path neither takes is the reviewer's to catch
(`AGENTS.md`). What a plan of one's own holds that the list does not name: `node tests/shape_test.cjs --plan <plan file> <app
folder>`, on the computer that holds it (it prints, and checks nothing). The records the planner does not edit, which a file
carries beside the plan, are passed over.

## Hooks

A check finds a thing on the page by its **hook**, a `data-hook` attribute that says what the thing is
(`data-hook="changes-build"`: one build in the list "What changed"), and not by its classes, its place among the others or its
look. The planner writes the hook on the thing (`dataset: { hook: 'changes-build' }`), and a build that changes the look moves
the hook with the thing, so that the checks of that thing do not change.

- A hook names a kind of thing, in words of the planner: `changes-build`, `changes-when`. Several things may carry one hook.
- **No style reads a hook, and no script of the planner finds a thing by one.** Hooks are for the checks, so that neither the
  look nor the code comes to lean on them.
- `hooks_test.cjs` (fast) holds the three ends together: every hook a check reads is written by the planner, nothing styles
  one, no script finds by one. A build that drops a hook a check reads fails there, by name, before any browser starts.
- **Most checks still read classes.** The "What changed" sheet is the first thing read by hooks (`fixes_053_check.py`). A
  build that changes the look of something, and so breaks a check that reads it by its classes, gives the thing its hooks and
  moves that check onto them, rather than onto the new classes: the cost is paid once.

## Deliberate faults

A check that cannot fail proves nothing. Each `mutate*.py` puts one fault at a time into a copy of the app (a rule dropped,
a word changed back, a figure off by one) and requires that the check then fails where it passed before. Eleven sets (`changed`,
`cleanup`, `join`, `look`, `map`, `merge`, `scale`, `screens`, `shape`, `shared`, `windows`) name the line that has to fail; the others count any line that passed with no fault in it and fails with it.

```
sh tests/faults.sh list             # every set, its modes, how many faults
sh tests/faults.sh step5a node      # a fast set
FROM=0 TO=12 sh tests/faults.sh r1 page
```

Each run ends with one line: how many faults, how many caught, and by name any that were missed or could not be put in.
A fault that is missed is a weak check: mend the check. A build that adds a check adds its faults; a build that changes a
piece of the planner runs the faults of the checks that cover it before it asks to be merged.

## Making a build

1. **Branch** from an up-to-date `main`. One build to a branch.
2. **The code** is edited where it is served from: `js/`, `css/app.css`. `index.html`, `sw.js`, `fonts/`, the manifest and
   `js/built.js` are written by `tools/shared.cjs` from the code, so after any change:
   ```
   export LRF_WORK=/tmp/lrf-work
   sh tests/setup.sh                                                          # the work folder, from the repository
   node tools/shared.cjs . $LRF_WORK/scratch/node_modules/@fontsource-variable  # the label, "What changed" and the site
   ```
   It gives the build the next label after the build before's when the build changes what a browser is served, and stops
   when such a build has no entry (step 3). The label is written nowhere by hand. A build that changes nothing a browser is
   served keeps the label and has no file under `tests/builds`. A new script is added to `index.html` in load order
   (`tools/app_folder.cjs` and `tools/README.md` say how the app folder's page and the site's relate). `README.md` is kept by
   hand.
3. **Say what the build changes** in a new file under `tests/builds/`, named for the build: the scripts, the other served
   files, and the screens that will look different ("What a build changed"), and, under `changes`, its entry in "What
   changed", written for a grower who has not read the code: `{ "did": "one line on what is different on the page", "steps":
   ["three things to try at most, each saying what should be seen"] }`, with nothing of any grower's plan in it. Leave the
   files already there alone.
4. **Checks.** Add the build's own; a new screen gets a line in `cleanup_check.py`, which reads every screen for words that
   do not belong on it, and an entry in `screens_check.py`. Push: GitHub runs everything. Write the new numbers of the
   checks the build changed into `counts.json` (the run's "counts" has them). Look at the run's "screens": a picture named
   before, now or side-by-side is a screen the build changed (a picture named take is a screen that did not hold still).
   Run the deliberate faults for what was touched.
5. **Nothing private.** No plan, photo, garden or variety name, address, email or service address goes into this
   repository. Search the lines the build adds before asking for a merge.
6. **Take `main` in** before the merge if it has moved: `node tools/take_main.cjs . <fonts> --commit` ("Two builds side by
   side"; on GitHub the job does it by itself), and let the checks run again on the two together.
7. **Merge** as one commit (squash) or as a merge commit, never by rebase: on `main` the build before is the commit before.
   Then confirm that the Pages run for the merge succeeded. A push to `main` is a release: the site is served from it.

## Writing a check

What has gone wrong before, so that it does not again.

- **A check finds a thing on the page by its hook** where it has one, and gives it one where a change of look broke the
  check ("Hooks").
- **A check finds its subject on the plan it is given** and names nothing from any plan: not a date, a bed, a crop's place
  in a list. Where it needs a week with a shared batch, it looks for one (see `WEEK0` in `sowing_view_check.py`).
- **A check that finds no subject fails a named line.** The older checks do not all do this yet: some skip a block of lines
  when the plan has no subject for it. `counts.json` is what shows it meanwhile, as a part that ran fewer lines.
- **A fault should fail a named line, not stop the check.** In a Node check, register the report on `process.on('exit')`
  first and set a flag on the last line. In a page check, test that a thing is there before acting on it.
- **A bound loose enough to pass the fault it is there for is no check.** After writing a check, put the fault in.
- **"At once" is checked inside the event**, not after it: a listener on `window` hears an event after the page's own
  handler and reads the state there. Reading it after the mouse call returns is a race.
- **A mouse event carries whole pixels**: move the pointer to whole pixels before comparing what lies under it.
- **A check that undoes what it did compares records**, and says so if their order may differ.
- **"Is it in view" can pass on the app folder and fail on the built site**: after a backup is loaded, a notice goes away a
  few seconds later and everything under it moves up. Hold what was scrolled into place.
- **A selector for "the nth tile" is scoped to its view.**
- **In the Forecast table the first cells of a row lie under the crop names**, which stay put: click a later one.
- **A check of clipping looks for spilling too.**
- **To give the page a pretended today**, add an init script that replaces `Date` with a subclass shifted by a fixed offset
  (`fake()` in `step5a_check.py`).
- `page.evaluate` with a string that evaluates to a function calls that function: wrap assignments in `(() => { … })()`.
  It waits for a promise: call a function that resolves only when a question is answered as `void …`.
- A script that ends with `os._exit` flushes its output first.
- Headless Chrome dies when it reads back, from its database, a folder handle of the private file system: hand the folder
  in with `LRFFolder.use(dir, { keep: false })`.
- The time zone is set in `env.sh`. A check that counts days must not depend on where it runs.
- Check new screens at 1280, 1480, 1707 and 3440 wide, with the real typefaces: served from the app folder with no network
  the page falls back to system fonts, so build the site to see them.
