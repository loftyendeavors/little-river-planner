# For agents that read or review this repository

How a build is made and checked is in `tests/README.md`. The rules below are for a reviewer of a pull request.

## Code Review Rules

### The plan's figures
- Flag any change that can move a date, a yield, a price, a seed count
  or a bench's room in an existing plan without the user setting it.
  Why: a build never changes a grower's figures by itself.
  Safe path: new behaviour applies only where the user turns it on,
  and shows what it will change first.

### Saving and sync (js/store.js, js/sync.js, js/merge.js, the Worker)
- Flag any path where a stored plan can be overwritten by an older one.
- Flag any merge rule that can drop, duplicate or double-count a record.
  A sowing recorded on two devices must draw seed once.
- Flag a save or a send whose failure is swallowed.
- For each finding here, give two input plans and the wrong result.

### The plan's shape (tests/plan_shape.cjs)
- Flag a field a change writes into a plan (on a planting, a bed, a garden,
  a crop, a variety, a seed lot, the list of assumptions, the settings, the
  nursery, or the planner's own record under lrfNext) that
  tests/plan_shape.cjs does not name.
  Why: the checks see only the fields the made-up farm and their tour reach.
  A field named nowhere is joined by shape when two devices' plans meet,
  which can keep half of a thing from each device.
- Flag an object whose parts only make sense together (a from and a to,
  an x and a y) entered without "whole".
  Safe path: its entry in tests/plan_shape.cjs, and, for "whole", the same
  place in js/merge.js WHOLE (keys of one record read together: "together",
  and js/merge.js TOGETHER). A change to js/merge.js is a change to saving
  and sync, with the rules above.

### Privacy
- Flag any added line holding a real name, address, email, passphrase,
  service address, or a garden or variety name from a real farm.
  Tests use the made-up farm under tests/farm.

### Checks
- Flag a changed behaviour with no line under tests/ that would fail
  without it, and a check that passes whether or not its subject exists.
- Flag a check that finds a thing by its classes or its place where the
  thing has a hook (data-hook), and a style rule or a planner script that
  reads a hook. Why: hooks are what let a change of look leave the checks
  alone (tests/README.md, "Hooks").
- Flag a hand edit to js/built.js or sw.js, or a label written anywhere
  but by tools/shared.cjs. A build's entry for "What changed" is "changes"
  in its own file under tests/builds.

### Not to flag
- Style, naming and formatting: the linter owns these.
- The absence of a framework or a dark view: both are deliberate.
