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
  // While the card is open (card.js, behind its tick) the answer to an action is said on the card: the one answer (DESIGN.md, rule 3)
  let answerTo = null;
  function toast(message, action) {
    if (answerTo && answerTo(message, action)) return;
    const host = document.getElementById('toast');
    clear(host).append(h('span', message));
    if (action) host.append(h('button.toast-action', { type: 'button', onclick: () => { host.classList.remove('show'); action.run(); } }, action.label));
    host.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => host.classList.remove('show'), action ? 9000 : 4200);
  }

  /** In-page confirmation (the page's frame has no window.confirm). */
  function confirm({ title, body, confirmLabel = 'Confirm', danger = false, detail = null }) {
    return new Promise(resolve => {
      const done = value => { dialog.close(); dialog.remove(); resolve(value); };
      const dialog = h('dialog.dialog', { oncancel: e => { e.preventDefault(); done(false); } },
        h('h2', title), h('p', body), detail,
        h('div.dialog-actions',
          h('button.btn', { type: 'button', onclick: () => done(false) }, 'Cancel'),
          h('button.btn' + (danger ? '.danger' : '.primary'), { type: 'button', onclick: () => done(true) }, confirmLabel)));
      document.body.append(dialog);
      dialog.showModal();
    });
  }

  /** "?": the round button that opens a hint under it (DESIGN.md, the frame). What a page used to say in a standing paragraph is said
   *  here, with what else the caller hands over (a page's figures in full), and what each of the page's own controls does: the
   *  words a control otherwise shows only to a pointer held over it. `lead` and `more` may be functions, read when it opens;
   *  `lead` may give an element in place of a sentence, where what it says has parts (the Forecast page's);
   *  `from` is the element whose controls are listed, or a function that gives it. One hint is open at a time.
   *  `opts`: `id` for the button (its card is that id with "Card"), `label` for what it is called, `cols` for a card in two
   *  columns (a name, and what it does), where the rows are the whole of it, `hook` for the checks (the button carries it, the
   *  card it with "-card"). A row's second part may hold a button: pressing one closes the card, since what it opens takes its place. */
  let hintOpen = null;
  function help(lead, from, more, opts = {}) {
    const btn = h('button.help-btn', { type: 'button', id: opts.id || null, 'aria-label': opts.label || 'What this page is for', 'aria-expanded': 'false', dataset: opts.hook ? { hook: opts.hook } : {} }, '?');
    let box = null;
    const away = e => { if (box && !box.contains(e.target) && !btn.contains(e.target)) close(); };
    const key = e => { if (e.key === 'Escape' && box) { close(); btn.focus(); } };
    function close() {
      if (!box) return;
      box.remove(); box = null; hintOpen = null; btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key, true);
    }
    btn.addEventListener('click', () => {
      if (box) { close(); return; }
      if (hintOpen) hintOpen();
      const text = typeof lead === 'function' ? lead() : lead, host = typeof from === 'function' ? from() : from, extra = (typeof more === 'function' ? more() : more) || [];
      const shown = el => !!(el.offsetWidth || el.offsetHeight) && !el.closest('table, [hidden]');
      const said = host ? [...host.querySelectorAll('button[title], select[title], input[title], summary[title], a[title]')].filter(el => el !== btn && el.title && shown(el))
        .map(el => [(el.getAttribute('aria-label') || el.textContent || el.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 48), el.title]) : [];
      const rows = [...extra, ...said].filter(([name], i, all) => name && all.findIndex(x => x[0] === name) === i).slice(0, 14);
      box = h('div.hint' + (opts.cols ? '.cols' : ''), { role: 'note', id: opts.id ? opts.id + 'Card' : null, dataset: opts.hook ? { hook: opts.hook + '-card' } : {} }, text ? (text.nodeType ? text : h('p', text)) : null, rows.length ? h('dl', rows.map(([name, what]) => [h('dt', name), h('dd', what)])) : null);
      box.addEventListener('click', e => { if (e.target.closest('button')) close(); });
      document.body.append(box);
      const r = btn.getBoundingClientRect(), w = box.offsetWidth;
      box.style.left = Math.round(Math.max(12, Math.min(r.left, root.innerWidth - w - 12))) + 'px';
      box.style.top = Math.round(r.bottom + 6) + 'px';
      box.style.maxHeight = Math.round(Math.max(120, root.innerHeight - r.bottom - 24)) + 'px';
      btn.setAttribute('aria-expanded', 'true'); hintOpen = close;
      document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', key, true);
    });
    return btn;
  }

  root.LRFUI = { h, s, clear, add, day, dayLong, span, num, feet, isoWeek, inkOn, toast, answerHere: fn => { answerTo = fn; }, confirm, help, MONTHS, DAYS };
})(window);
