/* Little River Farm Planner — wiring: header controls, shortcuts, start. */
(function (root) {
  'use strict';
  const App = root.LRFApp, E = root.LRFEngine;
  const $ = id => document.getElementById(id);

  root.LRFMap.init();
  root.LRFSeason.init();
  root.LRFTimeline.init();
  root.LRFPanels.init();
  root.LRFAssume.init();
  root.LRFSeeds.init();

  for (const button of document.querySelectorAll('[data-view-btn]')) button.addEventListener('click', () => App.setView(button.dataset.viewBtn));
  App.on('view', () => { for (const button of document.querySelectorAll('[data-view-btn]')) button.setAttribute('aria-pressed', String(button.dataset.viewBtn === App.state.view)); });
  App.on('plan', () => {
    $('undoBtn').disabled = !App.state.undo.length; $('redoBtn').disabled = !App.state.redo.length;
    $('undoBtn').title = App.state.undo.length ? `Undo: ${App.state.undo[App.state.undo.length - 1].label} (Ctrl+Z)` : 'Nothing to undo';
    $('seasonYear').textContent = App.planYear();
    const plan = App.state.plan, info = plan.lrfNext || {};
    $('buildNote').textContent = `Rebuild preview 0.6 · ${plan.plantings.length} plantings · ${info.sample ? 'sample plan' : info.from ? `loaded from ${info.from} on ${String(info.importedAt).slice(0, 10)}` : info.backup ? `started from your v7 backup of ${String(info.backup).slice(0, 10)}` : ''} · ${info.lastExport ? `last backup downloaded ${String(info.lastExport).slice(0, 10)}` : 'no backup downloaded yet'}`;
  });
  $('undoBtn').addEventListener('click', App.undo);
  $('redoBtn').addEventListener('click', App.redo);
  $('saveState').addEventListener('click', App.retrySave);

  // Backup menu
  const menu = $('dataMenu'), menuButton = $('dataBtn');
  const closeMenu = () => { menu.hidden = true; menuButton.setAttribute('aria-expanded', 'false'); };
  menuButton.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; menuButton.setAttribute('aria-expanded', String(!menu.hidden)); });
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
  $('exportBtn').addEventListener('click', () => { closeMenu(); App.exportBackup(); });
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', e => { const file = e.target.files[0]; e.target.value = ''; closeMenu(); if (file) App.importBackup(file); });

  // Drop a backup file anywhere on the page.
  const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  document.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); document.body.classList.add('file-over'); } });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('file-over'); });
  document.addEventListener('drop', e => { if (!hasFiles(e)) return; e.preventDefault(); document.body.classList.remove('file-over'); const file = e.dataTransfer.files[0]; if (file) App.importBackup(file); });

  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || '') && e.target.type !== 'range';
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? App.redo() : App.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); App.redo(); return; }
    if (e.key === 'Escape') { if (!menu.hidden) closeMenu(); else if (App.state.armed) App.arm(null); else if (App.state.sel && !typing) App.select(null); return; }
    if (typing || !App.state.ready) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && App.state.sel && App.state.sel.type === 'planting') { e.preventDefault(); App.removePlantings([App.state.sel.id]); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); App.setDate(E.addDays(App.state.date, (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 7 : 1))); }
  });

  App.start().catch(error => {
    $('inspectorBody').textContent = `The planner could not start: ${error && error.message ? error.message : error}`;
    $('saveState').textContent = 'Not loaded'; $('saveState').dataset.state = 'error';
  });
})(window);
