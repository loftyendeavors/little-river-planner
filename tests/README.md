# The checks, and how a build is made

Everything here runs on a made-up farm. No grower's plan, photo or records are in this repository, and none is needed to
check a build.

- [What is here](#what-is-here)
- [Running the checks](#running-the-checks)
- [On GitHub](#on-github)
- [The made-up farm](#the-made-up-farm)
- [What a build changed](#what-a-build-changed)
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
| `verdict.py` | Reads what `run.sh` printed and says whether every line passed |
| `faults.sh` | The deliberate faults: `sh tests/faults.sh list` |
| `env.sh` | Where everything is. Read by the others; nothing in it is tied to one computer |
| `this-build.json`, `what_changed.cjs` | What the build in hand changes in the page's scripts, and the check that holds it to that |
| `*_test.cjs` | Checks of the planner's arithmetic, without a browser |
| `*_check.py` | Checks of the page in a real browser |
| `mutate*.py` | The faults themselves |
| `farm/` | The made-up farm: how it is made, and the result |

The map's own checks (`map_check.py`, `map_views_check.py`, `mapgeo_test.cjs`, `mutate_map.py`), the checks of the sync and
fetch services and `site_check.py` are in `tools/`, beside the code they belong to. `run.sh` runs them with the rest.

## Running the checks

Needs: Node 22, npm, git, Python 3 with `playwright` and `pillow` (`pip install playwright pillow`; no browser download:
the checks use the Chrome at `/usr/bin/google-chrome`).

```
sh tests/setup.sh                  # once, and again after anything in the repository changes
sh tests/run.sh node               # the fast checks
sh tests/run.sh app1 | tee log     # one part of the browser checks
python3 -I tests/verdict.py log    # exit 0: every line passed
```

- The work folder is `/tmp/lrf-work` unless `LRF_WORK` says otherwise. It can be thrown away.
- A check prints its lines and ends with `{"passed": N, "of": M, "failed": [...]}`. To read one check's lines with their
  details, run its command from `b.sh` by hand, without the part after the `|`.
- A name ending in `-site` runs the check on the built site, which is the repository itself. It has no plan of its own, so
  the check loads the farm's backup file first. A name ending in `-off` runs on the single offline file, which the name
  `offline` builds.
- Nothing may change the repository or the work folder while a part runs: the page is served from them.
- The parts: `node`, `build` (builds the site into the repository and fails if that changes a file: the site kept here must be
  what the code builds to), `app1` to `app4` and `new` (the app folder), `off` (the offline file), `site1` to `site10` (the
  built site, the other window widths, a computer set to dark).
- On a small computer the whole run is about an hour, and a check that measures timing can stumble while something else is
  running. Run it again alone before believing it. On GitHub the parts run side by side.

## On GitHub

`.github/workflows/checks.yml` runs every part on every push, on every branch, side by side: about twelve minutes. The result
named **All checks** is the one to require before a merge. The pictures a failed part took are kept with the run for a week.

`.github/workflows/faults.yml` runs the deliberate faults. It is started by hand, from the Actions page: it is slow, and it
is for the build that changes a check or the part of the planner a check covers.

## The made-up farm

`farm/make_farm.cjs` writes "Example Farm" from a fixed seed: the same farm, byte for byte, every time. `farm/make_pictures.py`
draws its picture from above and a small picture for each variety. `farm/make_backup.py` packs it as a backup file. The
results are kept in `farm/data/`, so running the checks needs none of the three.

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

"This build moves no date, yield, price, seed count or bench figure by itself" is proven in two ways.

1. **The figures.** `step3a_test`, `step3b_test`, `step5a_test`, `step5b_test` and `stepF_test` work out every planting of the
   farm with this build's scripts and with the scripts of the build before, and compare: every date, the ground it holds,
   its yield, the forecast day for day. `setup.sh` takes the build before from git: where the branch left `main`, or on
   `main` itself the commit before.
2. **The scripts.** `this-build.json` names the scripts a build changes: under `words` those in which only the text inside
   strings differs, under `code` those whose program differs, and `added` and `removed`. `what_changed.cjs` holds the build
   to it: a script named nowhere must be the build before's file byte for byte, and a script under `words` must be the same
   program once its strings are set aside (both are parsed and compared). So a build that says it changes only words is
   shown to, and a reviewer reads one short file to see what a build touches. **Empty the lists when a build has merged.**

A build that is meant to change a figure says which, shows it on the page before anything moves, and has a check of its
own that the figure changes there and nowhere else.

The same proof can be run on a real plan, on the computer that holds it: `node tests/step3b_test.cjs <app folder> <plan.json>
<js of the build before>`. A plan file never goes into this repository.

## Deliberate faults

A check that cannot fail proves nothing. Each `mutate*.py` puts one fault at a time into a copy of the app (a rule dropped,
a word changed back, a figure off by one) and requires that a named line of a check fails.

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
2. **The code** is edited where it is served from: `js/`, `css/app.css`. `index.html`, `sw.js`, `fonts/` and the manifest are
   written by `tools/build_site.cjs` from the app folder, so after any change:
   ```
   sh tests/setup.sh                                                                  # the app folder, from the repository
   node tools/build_site.cjs $LRF_WORK/app $LRF_WORK/scratch/node_modules/@fontsource-variable . "0.40"
   ```
   The last argument is the label the page shows in its Backup menu. It is written in one place, `js/main.js`
   ("Preview 0.40 ·"); the checks read it from there. **Read the next free label from `main` at the moment of the merge.**
   A new script is added to the app folder's `index.html` in load order (`tools/app_folder.cjs` and `tools/README.md` say
   how the two pages relate). `README.md` is kept by hand.
3. **Say what the build changes** in `tests/this-build.json`.
4. **Checks.** Add the build's own; a new screen gets a line in `cleanup_check.py`, which reads every screen for words that
   do not belong on it. Push: GitHub runs everything. Run the deliberate faults for what was touched.
5. **Nothing private.** No plan, photo, garden or variety name, address, email or service address goes into this
   repository. Search the lines the build adds before asking for a merge.
6. **Take `main` in** before the merge if it has moved, and let the checks run again on the two together.
7. **Merge**, then confirm that the Pages run for the merge succeeded. A push to `main` is a release: the site is served
   from it.

## Writing a check

What has gone wrong before, so that it does not again.

- **A check finds its subject on the plan it is given** and names nothing from any plan: not a date, a bed, a crop's place
  in a list. Where it needs a week with a shared batch, it looks for one (see `WEEK0` in `sowing_view_check.py`).
- **A check that finds no subject fails a named line.** It never skips in silence.
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
- **In the Harvest table the first cells of a row lie under the crop names**, which stay put: click a later one.
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
