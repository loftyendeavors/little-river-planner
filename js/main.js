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
  root.LRFTraysView.init();
  root.LRFSowView.init();
  root.LRFHarvestView.init();
  root.LRFAheadView.init();

  for (const button of document.querySelectorAll('[data-view-btn]')) button.addEventListener('click', () => App.setView(button.dataset.viewBtn));
  App.on('view', () => { for (const button of document.querySelectorAll('[data-view-btn]')) button.setAttribute('aria-pressed', String(button.dataset.viewBtn === App.state.view)); });
  App.on('plan', () => {
    $('undoBtn').disabled = !App.state.undo.length; $('redoBtn').disabled = !App.state.redo.length;
    $('undoBtn').title = App.state.undo.length ? `Undo: ${App.state.undo[App.state.undo.length - 1].label} (Ctrl+Z)` : 'Nothing to undo';
    $('seasonYear').textContent = App.planYear();
    const plan = App.state.plan, info = plan.lrfNext || {};
    $('buildNote').textContent = `Rebuild preview 0.16 · ${plan.plantings.length} plantings · ${info.sample ? 'sample plan' : info.from ? `loaded from ${info.from} on ${String(info.importedAt).slice(0, 10)}` : info.backup ? `started from your v7 backup of ${String(info.backup).slice(0, 10)}` : ''} · ${info.lastExport ? `last backup downloaded ${String(info.lastExport).slice(0, 10)}` : 'no backup downloaded yet'}`;
  });
  $('undoBtn').addEventListener('click', App.undo);
  $('redoBtn').addEventListener('click', App.redo);
  // The save indicator is also the one-click manual save: with a plan folder it writes the file now; with trouble it retries; otherwise it opens the menu where a file can be had.
  $('saveState').addEventListener('click', e => {
    const f = App.folder(), failed = $('saveState').dataset.state === 'error';
    if (failed) { App.retrySave(); return; }
    if (f.connected && !f.conflict) { App.saveNow(); return; }
    e.stopPropagation(); $('dataMenu').hidden = false; $('dataBtn').setAttribute('aria-expanded', 'true');
  });

  // Backup menu
  const menu = $('dataMenu'), menuButton = $('dataBtn');
  const closeMenu = () => { menu.hidden = true; menuButton.setAttribute('aria-expanded', 'false'); };
  menuButton.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; menuButton.setAttribute('aria-expanded', String(!menu.hidden)); });
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
  $('exportBtn').addEventListener('click', () => { closeMenu(); App.exportBackup(); });
  $('saveNowBtn').addEventListener('click', () => { closeMenu(); App.saveNow(); });
  // Ctrl+S or Cmd+S saves the plan to its file, as it would in any program that has one.
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); if (App.state.ready) App.saveNow(); } });
  /** Where the plan file lives, and the one thing to do about it: choose a folder, reconnect it, settle which plan it holds, or leave it. */
  function folderMenu() {
    const host = $('folderMenu'), f = App.folder(), U = root.LRFUI, h = U.h, when = iso => { const d = new Date(iso); return Number.isFinite(+d) ? `${U.MONTHS[d.getMonth()]} ${d.getDate()}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'an unknown time'; };
    const item = (title, small, run, id) => h('button', { type: 'button', id, onclick: () => { closeMenu(); run(); } }, h('b', title), small ? h('small', small) : null);
    host.replaceChildren();
    $('saveNowNote').textContent = f.connected && !f.conflict ? `Writes the plan file in “${f.name}” (Ctrl+S)` : 'Downloads a backup file (Ctrl+S)';
    if (!f.supported) { host.append(h('p.menu-note', App.storage() === 'cloud' ? 'On this page the plan is saved to the page’s own database as you work. Saving to a file by itself needs the site opened in Chrome or Edge on a computer.' : 'This browser cannot write to a folder by itself; Chrome and Edge on a computer can. The plan is kept in this browser: download a backup now and then.')); return; }
    if (f.needsPermission) host.append(item(`Reconnect the folder “${f.name}”`, 'The browser asks before it lets the planner write there again', App.reconnectFolder, 'folderReconnect'));
    else if (f.conflict) host.append(
      h('p.menu-note', f.conflict.broken ? `“${f.name}” holds a plan file that cannot be read.` : `“${f.name}” holds a plan saved ${when(f.conflict.savedAt || f.conflict.modified)}${f.conflict.mine ? ' from this browser' : ' somewhere else'}, with ${f.conflict.plantings} plantings. Nothing is written there until you choose.`),
      f.conflict.broken ? null : item('Open the folder’s plan', 'Replaces the plan open here', App.openFolderPlan, 'folderOpen'),
      item('Keep this plan, and save it over the folder’s', 'The folder’s plan file is replaced', App.overwriteFolder, 'folderOverwrite'));
    else if (f.connected) host.append(
      h('p.menu-note', { id: 'folderNote' }, `Kept in the folder “${f.name}”${f.savedAt ? `, last written ${when(f.savedAt)}` : ''}. Saved there a moment after every change, with a copy of each earlier day in “history”.`),
      item('Stop saving to this folder', 'Its files are left as they are', App.leaveFolder, 'folderLeave'));
    if (!f.connected && !f.needsPermission) host.append(item('Keep the plan in a folder…', 'Saved there by itself as you work. A synced folder keeps a copy off this computer.', App.chooseFolder, 'folderChoose'));
    else if (f.connected) host.append(item('Change folder…', '', App.chooseFolder, 'folderChange'));
  }
  App.on('folder', folderMenu); App.on('plan', folderMenu);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', e => { const file = e.target.files[0]; e.target.value = ''; closeMenu(); if (file) App.importBackup(file); });
  // Photos for the plan that is open: the plan is never replaced by anything chosen here.
  $('photosBtn').addEventListener('click', () => $('photosFile').click());
  $('photosFile').addEventListener('change', e => { const files = [...e.target.files]; e.target.value = ''; closeMenu(); if (files.length) App.addPhotos(files); });

  // Drop a backup file anywhere on the page. A picture or a photo file dropped is added to the open plan.
  const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  document.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); document.body.classList.add('file-over'); } });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('file-over'); });
  document.addEventListener('drop', e => { if (!hasFiles(e)) return; e.preventDefault(); document.body.classList.remove('file-over'); if (e.dataTransfer.files.length) App.openFiles(e.dataTransfer.files); });

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
