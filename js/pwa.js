/* Little River Farm Planner — keeps a copy of the app in the browser so it opens with no connection. */
(function () {
  'use strict';
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!('serviceWorker' in navigator) || (location.protocol !== 'https:' && !local)) return;
  // A copy already in charge of this page means a later change of copy is an update: say so, and let the grower choose when to reload.
  let hadCopy = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadCopy) { hadCopy = true; return; }
    if (window.LRFUI) window.LRFUI.toast('A newer version of the planner is ready.', { label: 'Reload', run: () => location.reload() });
    const note = document.getElementById('buildNote');
    if (note && !note.dataset.newer) { note.dataset.newer = '1'; note.prepend('A newer version is ready: reload the page to use it. '); }
  });
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').then(reg => { setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000); }).catch(() => { /* the app still works online */ }); });
})();
