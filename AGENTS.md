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

### Privacy
- Flag any added line holding a real name, address, email, passphrase,
  service address, or a garden or variety name from a real farm.
  Tests use the made-up farm under tests/farm.

### Checks
- Flag a changed behaviour with no line under tests/ that would fail
  without it, and a check that passes whether or not its subject exists.

### Not to flag
- Style, naming and formatting: the linter owns these.
- The absence of a framework or a dark view: both are deliberate.
