/* Little River Farm Planner — the build in view, and what each build changed.
 *
 * The header says which build is running. A press on it opens "What changed": every build, latest first, with one line on
 * what it did and three things to try.
 *
 * The label and the list are not written here, nor by hand: tools/shared.cjs writes them into js/built.js, from the build
 * before's list and the entry each build writes in its own file under tests/builds ("changes": { did, steps }). An entry is
 * written for a grower who has not read the code: "did" is one line on what is different on the page, "steps" three things to
 * try at most, each saying what should be seen. Nothing of any grower's plan goes in one: no garden, bed, variety or figure.
 *
 * The checks find the sheet's parts by their hooks (data-hook), which say what a thing is and are never styled: a change of
 * look keeps them where they are.
 */
(function (root) {
  'use strict';
  // The list is written by tools/shared.cjs into js/built.js, from each build's own file under tests/builds.
  const BUILDS = (root.LRFBuilt && root.LRFBuilt.builds) || [];

  const UI = root.LRFUI, h = UI && UI.h;
  const $ = id => document.getElementById(id);
  const SEEN_KEY = 'lrf.changes.seen';
  /** "0.53" as numbers that can be compared part by part. */
  const parts = label => String(label || '').split('.').map(n => parseInt(n, 10) || 0);
  const later = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  // Which builds this browser has opened the list for is how this computer has been used, not part of the plan: it is kept
  // in the browser and nowhere else.
  const seen = () => { try { return root.localStorage.getItem(SEEN_KEY) || ''; } catch (_) { return ''; } };
  const keep = label => { try { root.localStorage.setItem(SEEN_KEY, label); } catch (_) { /* a browser that keeps nothing still works */ } };

  let running = '', newer = false, dlg = null;
  const when = iso => { const [y, m, d] = String(iso).split('-').map(Number); return UI.day(new Date(y, m - 1, d)); };
  function close() { if (!dlg) return; dlg.close(); dlg.remove(); dlg = null; }   // the browser gives the focus back to the chip that opened it
  /** The sheet: every build, latest first. Builds this browser has not opened the list for are marked. It changes nothing. */
  function open() {
    if (dlg || !h) return;
    const last = seen();
    dlg = h('dialog.dialog.wc', { id: 'changesDlg', oncancel: e => { e.preventDefault(); close(); } },
      h('h2', 'What changed'),
      h('p.wc-lead', { dataset: { hook: 'changes-lead' } }, 'Every build, latest first: what it did, and three things to try on your own plan.'),
      newer ? h('p.wc-newer', { id: 'changesNewer', dataset: { hook: 'changes-newer' } }, h('span', 'A newer build than this one is ready.'), h('button.btn', { type: 'button', onclick: () => root.location.reload() }, 'Reload')) : null,
      h('div.wc-list', { id: 'changesList' }, BUILDS.map(b => h('section.wc-build', { dataset: { hook: 'changes-build', build: b.label, fresh: later(b.label, last) ? '1' : '' } },
        h('h3', { dataset: { hook: 'changes-head' } }, `Preview ${b.label}`, later(b.label, last) ? h('span.wc-new', { dataset: { hook: 'changes-new' } }, 'New') : null, h('small', { dataset: { hook: 'changes-when' } }, b.label === running ? `${when(b.on)} · this build` : when(b.on))),
        h('p', { dataset: { hook: 'changes-did' } }, b.did),
        h('ol', b.steps.map(step => h('li', { dataset: { hook: 'changes-step' } }, step)))))),
      h('div.sheet-foot', h('button.btn.primary', { type: 'button', id: 'changesDone', onclick: close }, 'Done')));
    document.body.append(dlg);
    dlg.showModal();
    // opened: the builds up to the one running are no longer new here
    const known = BUILDS.map(b => b.label).filter(l => !later(l, running)).sort((a, b) => (later(a, b) ? -1 : 1))[0];
    if (known && later(known, last)) keep(known);
  }
  /** The header's chip says the build that is running ("Preview 0.53"), and opens the sheet. */
  function init(label) {
    running = String(label || '').replace(/^Preview\s+/, '');
    const chip = $('buildChip');
    if (!chip || !h) return;
    chip.replaceChildren(h('span', 'Preview '), h('b', running));
    chip.setAttribute('aria-label', `Preview ${running}: what changed`);
    chip.addEventListener('click', open);
  }
  /** A newer build has been fetched and waits for a reload: the chip carries a dot, and the sheet says so with the one press. */
  function ready() {
    newer = true;
    const chip = $('buildChip');
    if (chip) { chip.dataset.newer = '1'; chip.title = 'A newer build is ready: reload the page to use it. Press for what changed.'; }
  }

  root.LRFChanges = { builds: BUILDS, init, open, close, ready, later, running: () => running };
})(typeof window !== 'undefined' ? window : globalThis);
