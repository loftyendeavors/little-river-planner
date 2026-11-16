/* Little River Farm Planner — the build in view, and what each build changed.
 *
 * The header says which build is running. A press on it opens "What changed": every build, latest first, with one line on
 * what it did and three things to try.
 *
 * EVERY BUILD ADDS ITS OWN ENTRY AT THE HEAD OF `BUILDS`, in the commit that sets its label in js/main.js. The checks fail a
 * build whose label is not the first entry here. An entry is written for a grower who has not read the code:
 *   label   the build's label, as js/main.js has it after "Preview"
 *   on      the day it was merged, year-month-day
 *   did     one line: what is different on the page
 *   steps   three things to try at most, each saying what should be seen
 * Nothing of any grower's plan goes in here: no garden, bed, variety or figure. The file is public.
 */
(function (root) {
  'use strict';
  const BUILDS = [
    { label: '0.53', on: '2026-11-16', did: 'The build’s number is in the header, with what each build changed behind it. Loose ends is in the header only while something needs you. On the Map, what can be done is behind “?”.',
      steps: ['Press the build’s number beside the farm’s name: this list, with the builds not yet opened in this browser marked “New”.',
        'On the Map, press “?” at the end of the tools: what can be done on the map, in two columns. The side panel no longer carries that list.',
        'On a planting, press “Several varieties…”, scroll the list and tick one: the list stays where it was.'] },
    { label: '0.52', on: '2026-11-16', did: 'Ctrl+Z in a box takes back the typing in that box, not the plan’s last change.',
      steps: ['Change something on the Map, type in the library’s search box and press Ctrl+Z: the letters go, the change stays.',
        'Click on empty page and press Ctrl+Z: the change goes back, and Ctrl+Y brings it again.',
        'On Assumptions type a number of days, press Enter, then Ctrl+Z: it goes back, as before.'] },
    { label: '0.51', on: '2026-11-16', did: 'Loose ends in the header: one list for what needs you, each row opening where it is mended. The notices are off Assumptions and Seeds.',
      steps: ['Top right, press Loose ends: what needs you first, in orange, and what can wait under it.',
        'Press “Plantings that differ from your list”: the Assumptions list opens with a sheet. Done, and the page is its title, one line of figures and the list.',
        'On Seeds, press “On order” beside “Short of seed”.'] },
    { label: '0.50', on: '2026-11-16', did: 'On Nursery, Seeds and Assumptions the standing paragraph is behind a round “?” beside the title, and the Nursery’s four tiles are one line of figures.',
      steps: ['Nursery: the tabs stand right under the title, with one line of figures under them.',
        'Press “?” beside “Bench room”: the paragraph, each figure with its second line, and what each control does.',
        'Assumptions, Days to harvest: the title, “?”, and the list sooner.'] },
    { label: '0.49', on: '2026-11-16', did: 'One card, row, tick and switch, and three kinds of button, on every screen. Boxes are one height in a panel and one on a page.',
      steps: ['Tasks: the Day and Week switch is bordered with the chosen side dark, and “Delay…” in a row is a bounded button.',
        'On the Map click a planted bed, then a planting: the boxes are lower, and “Expected” is in view without scrolling.',
        'Press “Season…”: the sheet has a rounder corner, and its foot keeps to the edge.'] },
    { label: '0.48', on: '2026-11-15', did: 'One scale of type, corners and motion under every screen. Nothing was added to a screen or taken off one.',
      steps: ['On the Timeline scroll the gardens: no name is cut that was whole.',
        'On the Map click a planted bed: the panel reads as before, in slightly larger words.',
        'Tasks on a phone: the header is one line, and a late task ticked brings the calendar up as before.'] },
    { label: '0.47', on: '2026-11-15', did: 'Tasks opens on today, with what is late above it. A tick records the work; a late task is asked its day; Delay, Skip and a note are in each row.',
      steps: ['Open Tasks: a day, then Week, then the date at the top left.',
        'Tick one task, read the message, and press Undo.',
        'Open a row: “Delay…” to another day, Undo; then “Skip this task”, Undo.'] }
  ];

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
      h('p.wc-lead', 'Every build, latest first: what it did, and three things to try on your own plan.'),
      newer ? h('p.wc-newer', { id: 'changesNewer' }, h('span', 'A newer build than this one is ready.'), h('button.btn', { type: 'button', onclick: () => root.location.reload() }, 'Reload')) : null,
      h('div.wc-list', { id: 'changesList' }, BUILDS.map(b => h('section.wc-build', { dataset: { build: b.label, fresh: later(b.label, last) ? '1' : '' } },
        h('h3', `Preview ${b.label}`, later(b.label, last) ? h('span.wc-new', 'New') : null, h('small', b.label === running ? `${when(b.on)} · this build` : when(b.on))),
        h('p', b.did),
        h('ol', b.steps.map(step => h('li', step)))))),
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
