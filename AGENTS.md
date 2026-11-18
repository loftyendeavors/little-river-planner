# For agents that work on this repository

Follow `tests/README.md` for builds and checks and `DESIGN.md` for screen changes.

## Claude and Codex development workflow

- **Small changes** such as wording or local visual polish use one implementer and a focused check in the app. Keep the usual checks that apply. No separate design review or GPT Zoom Out by default.
- **Contained features and fixes** use one implementer and an independent pull request reviewer. Choose the builder with the strongest context for the task. The reviewer verifies the actual change on the current branch and runs or checks evidence for the relevant grower workflow.
- **Consequential changes** to grower workflows, shared behavior across builds or views, planning figures, or saved data and sync get a short Claude–Codex design review first. On the issue or pull request, record the goal in the grower's words, baseline, scope, overlapping builds or files, and the expected result in a realistic example. Prefer one round of feedback. Assign one owner per change and agree on merge order for overlapping work. The later change owns verification of the combined behavior. Resolve factual disagreements against the running app, code or a reproducible test. Bring material product tradeoffs to the owner in one decision with a recommendation.

## GPT Zoom Out

For consequential changes, Codex owns a read-only GPT Zoom Out before the preview or merge decision. The owner can also ask for **“Zoom out”** at any time to review a proposal, a build or a set of changes. Delegate the check to a fresh GPT reviewer where supported. Use the strongest available GPT with high reasoning or higher (currently GPT-6.2 Astra on this Codex workspace). Record the actual model and any verification gaps. Keep this pass distinct from code review and use a test plan or authorized private preview.

Compare the current app, the proposal or preview, relevant design decisions, nearby builds and unresolved findings from earlier reviews. Walk through a real grower job end to end on the affected views and devices. Check that the next action is clear under field conditions, terminology and figures agree across views, recorded work stays distinct from plans, and mistakes are visible and reversible. Only check data, sync and devices relevant to the change. Look for duplicate controls, extra steps, missing handoffs and changes that should be sequenced or deferred.

Put a short verdict in the shared handoff. Choose **Ready**, **Revise** or **Needs an owner decision**. Give the example walked, the most important findings and what should happen next. Carry forward open issues with an owner or a linked follow-up. Keep private farm data and previews out of public handoffs. The owner decides product tradeoffs and approvals under the existing release process.

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
