/* Little River Farm Planner — keeps a copy of the app in the browser so it opens with no connection. */
(function () {
  'use strict';
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!('serviceWorker' in navigator) || (location.protocol !== 'https:' && !local)) return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* the app still works online */ }); });
})();
