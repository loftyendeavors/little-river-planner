/* Little River Farm Planner — small DOM and formatting helpers shared by the views. */
(function (root) {
  'use strict';
  const E = root.LRFEngine;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** h('div.card', {onclick}, child, ...) — a tiny element builder. Text is always set as text. */
  function build(ns, spec, attrs, children) {
    const [tag, ...classes] = spec.split('.');
    const el = ns ? document.createElementNS(ns, tag || 'g') : document.createElement(tag || 'div');
    if (classes.length) el.setAttribute('class', classes.join(' '));
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (key === 'style' && typeof value === 'object') { for (const [prop, v] of Object.entries(value)) { if (prop.startsWith('--')) el.style.setProperty(prop, v); else el.style[prop] = v; } }
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key in el && !ns && key !== 'list' && key !== 'form') { try { el[key] = value; } catch (_) { el.setAttribute(key, value); } }
      else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      el.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return el;
  }
  const isAttrs = x => x && typeof x === 'object' && !x.nodeType && !Array.isArray(x);
  const h = (spec, a, ...c) => isAttrs(a) ? build(null, spec, a, c) : build(null, spec, null, [a, ...c]);
  const s = (spec, a, ...c) => isAttrs(a) ? build(SVG_NS, spec, a, c) : build(SVG_NS, spec, null, [a, ...c]);
  const clear = el => { el.replaceChildren(); return el; };
  /** Append, skipping the nulls that conditional sections leave behind. */
  const add = (host, ...nodes) => { host.append(...nodes.flat(Infinity).filter(n => n != null && n !== false)); return host; };

  // ── dates and numbers as a grower reads them ──
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = d => E.validDate(d) ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : '—';
  const dayLong = d => E.validDate(d) ? `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : '—';
  const span = (a, b) => `${day(a)} – ${day(b)}`;
  const num = (n, digits = 0) => n == null || Number.isNaN(+n) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: digits });
  const feet = n => `${num(n, 1)} ft`;
  /** ISO week number, the planning unit growers schedule by. */
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), dow = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dow);
    return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  }
  /** Readable ink for text on a crop colour. */
  function inkOn(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return '#14231c';
    const [r, g, b] = [1, 2, 3].map(i => parseInt(m[i], 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#14231c' : '#ffffff';
  }

  // ── toast with an optional action (Undo) ──
  let toastTimer = null;
  function toast(message, action) {
    const host = document.getElementById('toast');
    clear(host).append(h('span', message));
    if (action) host.append(h('button.toast-action', { type: 'button', onclick: () => { host.classList.remove('show'); action.run(); } }, action.label));
    host.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => host.classList.remove('show'), action ? 9000 : 4200);
  }

  /** In-page confirmation (the page's frame has no window.confirm). */
  function confirm({ title, body, confirmLabel = 'Confirm', danger = false }) {
    return new Promise(resolve => {
      const done = value => { dialog.close(); dialog.remove(); resolve(value); };
      const dialog = h('dialog.dialog', { oncancel: e => { e.preventDefault(); done(false); } },
        h('h2', title), h('p', body),
        h('div.dialog-actions',
          h('button.btn', { type: 'button', onclick: () => done(false) }, 'Cancel'),
          h('button.btn' + (danger ? '.danger' : '.primary'), { type: 'button', onclick: () => done(true) }, confirmLabel)));
      document.body.append(dialog);
      dialog.showModal();
    });
  }

  root.LRFUI = { h, s, clear, add, day, dayLong, span, num, feet, isoWeek, inkOn, toast, confirm, MONTHS };
})(window);
