/* Little River Farm Planner — the two windows opened from Backup: Cloud sync and Snapshots, and the strip that asks which plan to keep. */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, { h } = UI;
  const $ = id => document.getElementById(id);
  const sync = () => App.sync();
  const closeBtn = (id, run, title) => h('button.icon-btn.close', { type: 'button', id, 'aria-label': 'Close', title: title || 'Close', onclick: run }, '×');
  const when = iso => { const d = new Date(iso); if (!Number.isFinite(+d)) return 'at an unknown time'; const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); return d.toDateString() === new Date().toDateString() ? `today at ${t}` : `${UI.MONTHS[d.getMonth()]} ${d.getDate()} at ${t}`; };
  const plural = (n, word) => `${UI.num(n)} ${word}${n === 1 ? '' : 's'}`;
  const hereCount = () => App.state.plan.plantings.length;
  /** What the cloud's plan says of itself, as a row of labelled figures. */
  function cloudFacts(cloud) {
    const m = (cloud && cloud.meta) || {};
    return h('span.bk-facts', h('span', 'saved ', h('b', when(m.savedAt))), m.label ? h('span', 'on ', h('b', m.label)) : null, Number.isFinite(m.plantings) ? h('span', h('b', UI.num(m.plantings)), ' plantings') : null);
  }
  function deviceGuess() {
    const ua = (root.navigator && root.navigator.userAgent) || '';
    return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Windows/.test(ua) ? 'Windows computer' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux computer' : '';
  }

  // ───────────────────────── which plan to keep ─────────────────────────
  async function openCloud() {
    const c = App.syncInfo(), dirty = c.status === 'conflict' && !App.isSample();
    if (dirty) {
      const m = (c.cloud && c.cloud.meta) || {};
      const ok = await UI.confirm({ title: 'Open the cloud’s plan here?', body: `The plan in this browser (${plural(hereCount(), 'planting')}) is replaced by the one in the cloud, saved ${when(m.savedAt)}${m.label ? ` on ${m.label}` : ''}${Number.isFinite(m.plantings) ? ` with ${plural(m.plantings, 'planting')}` : ''}. The plan here is kept as a snapshot first: Backup, Snapshots has it.`, confirmLabel: 'Open the cloud’s plan' });
      if (!ok) return false;
    }
    const ok = await sync().openCloud();
    if (ok) UI.toast(`The cloud’s plan is open here${dirty ? '. The plan that was here is under Backup, Snapshots' : ''}.`);
    return ok;
  }
  async function keepMine() {
    const c = App.syncInfo(), m = (c.cloud && c.cloud.meta) || {};
    const ok = await UI.confirm({ title: 'Save this plan over the cloud’s?', body: `The plan in the cloud, saved ${when(m.savedAt)}${m.label ? ` on ${m.label}` : ''}${Number.isFinite(m.plantings) ? ` with ${plural(m.plantings, 'planting')}` : ''}, is replaced by the one in this browser (${plural(hereCount(), 'planting')}). The cloud keeps the replaced plan as a snapshot. Other devices are offered this plan the next time they sync.`, confirmLabel: 'Save over the cloud’s', danger: true });
    if (!ok) return false;
    const done = await sync().keepMine();
    if (done) UI.toast('The cloud now holds this plan. The one it held is kept there as a snapshot.');
    return done;
  }
  function strip() {
    const host = $('syncStrip'), c = App.syncInfo(), show = App.state.ready && (c.status === 'conflict' || !!c.offer);
    host.hidden = !show;
    if (!show) { host.replaceChildren(); return; }
    const busy = !!c.busy, btn = (id, label, run, kind) => h('button.btn' + (kind ? '.' + kind : ''), { type: 'button', id, disabled: busy, onclick: run }, label);
    host.classList.toggle('bad', c.status === 'conflict');
    if (c.status === 'conflict') {
      host.setAttribute('aria-label', 'The cloud and this browser hold different plans');
      host.replaceChildren(
        h('p', { id: 'syncStripText' }, h('b', c.first ? 'The cloud already holds a plan, and so does this browser.' : 'The cloud and this browser hold different plans.'), ' Nothing is sent or replaced until you choose. ',
          h('span.bk-pair', h('span.bk-label', 'In the cloud'), cloudFacts(c.cloud)), h('span.bk-pair', h('span.bk-label', 'Here'), h('span.bk-facts', h('span', h('b', UI.num(hereCount())), ' plantings'), c.first ? null : h('span', 'changed since the last sync')))),
        h('div.first-run-actions', btn('stripOpen', 'Open the cloud’s plan', openCloud), btn('stripKeep', 'Keep this plan, and save it over the cloud’s', keepMine)));
    } else {
      host.setAttribute('aria-label', 'A newer plan is in the cloud');
      host.replaceChildren(
        h('p', { id: 'syncStripText' }, h('b', 'A newer plan is in the cloud.'), ' Nothing has been changed here since the last sync. ', h('span.bk-pair', h('span.bk-label', 'In the cloud'), cloudFacts(c.cloud))),
        h('div.first-run-actions', btn('stripOpen', 'Open it', openCloud, 'primary'), btn('stripLater', 'Not now', () => sync().snooze())));
    }
  }

  // ───────────────────────── Cloud sync ─────────────────────────
  let syncDlg = null;
  function openSync() {
    if (syncDlg) return;
    const body = h('div.bk-body'), say = h('p.dlg-status', { id: 'syncSay', role: 'status', 'aria-live': 'polite' });
    const el = h('dialog.dialog.bk', { id: 'syncDlg', oncancel: e => { e.preventDefault(); close(); } }, closeBtn('syncClose', () => close(), 'Close. Nothing is changed.'), h('h2', 'Cloud sync'), body);
    const close = () => { if (!syncDlg) return; syncDlg = null; el.close(); el.remove(); };
    syncDlg = { el, body, status: say, say: (text, kind) => { say.textContent = text || ''; say.dataset.kind = kind || ''; }, close, typed: { url: null, label: null }, working: false };
    document.body.append(el); drawSync(); el.showModal();
    const first = App.syncInfo().configured ? $('syncDone') : el.querySelector('input'); if (first) first.focus();
  }
  function drawSync() {
    const d = syncDlg; if (!d) return;
    const c = App.syncInfo(), s = sync(), body = d.body, active = document.activeElement && document.activeElement.id;
    if (!c.supported || !s) {
      UI.add(UI.clear(body), h('p.dlg-lead', 'Cloud sync works from the planner’s web address. This copy was opened another way (a file on the computer, or inside another page), so it keeps its plan here only.'), h('div.dialog-actions', h('button.btn', { type: 'button', id: 'syncDone', onclick: d.close }, 'Close')));
      return;
    }
    if (!c.configured) {
      // not set up in this browser, or the passphrase is wanted again
      const again = c.status === 'signin';
      const url = h('input', { id: 'syncUrl', type: 'url', inputMode: 'url', autocomplete: 'off', spellcheck: false, placeholder: 'https://lrf-plan-sync.your-name.workers.dev', value: d.typed.url != null ? d.typed.url : c.url, oninput: e => { d.typed.url = e.target.value; } });
      const key = h('input', { id: 'syncKey', type: 'password', autocomplete: 'off', value: (body.querySelector('#syncKey') || {}).value || '' });
      const label = h('input', { id: 'syncLabel', type: 'text', maxLength: 40, autocomplete: 'off', placeholder: 'Work laptop', value: d.typed.label != null ? d.typed.label : c.label || deviceGuess(), oninput: e => { d.typed.label = e.target.value; } });
      const go = h('button.btn.primary', { type: 'submit', id: 'syncConnect', disabled: d.working }, d.working ? 'Connecting…' : again ? 'Sign in' : 'Connect');
      const connect = async e => {
        e.preventDefault();
        if (d.working) return;
        d.working = true; go.disabled = true; go.textContent = 'Connecting…'; d.say('Asking the service…');
        try {
          const now = await s.connect(url.value, key.value, label.value);
          d.working = false; key.value = '';
          if (!syncDlg) return;
          d.say(now.status === 'in-step' ? (App.isSample() ? '' : 'Connected. This browser and the cloud are in step.') : now.status === 'conflict' ? '' : now.status === 'empty' ? 'Connected. The cloud holds no plan yet; yours is sent once it is open here.' : now.error || '', now.status === 'error' || now.status === 'waiting' ? 'bad' : 'good');
          drawSync();
        } catch (error) {
          d.working = false; go.disabled = false; go.textContent = again ? 'Sign in' : 'Connect';
          d.say(error.kind === 'offline' ? 'That address could not be reached. Check it, and that this computer is online.' : error.message || 'It did not work.', 'bad');
          (error.kind === 'address' || error.kind === 'offline' || error.kind === 'server' ? url : key).focus();
        }
      };
      UI.add(UI.clear(body),
        h('p.dlg-lead', again ? 'The cloud wants the passphrase again: it was changed, or this browser has not synced for six months. The plan here is safe, and is sent once you have signed in.' : 'Keeps a copy of the plan in your own Cloudflare storage, so a second computer or a phone can open it and a lost laptop does not take the plan with it. The plan in this browser stays the one you work on, with or without a connection.'),
        h('form.bk-form', { id: 'syncForm', onsubmit: connect, novalidate: true },
          h('label.fld', h('span', 'Address of your sync service'), url, h('small', 'Shown at the top of the Worker’s page in Cloudflare. Kept in this browser only.')),
          h('label.fld', h('span', 'Passphrase'), key, h('small', 'Typed once. This browser keeps a sign-in token, not the passphrase.')),
          h('label.fld', h('span', 'Name for this device'), label, h('small', 'So a plan can say where it was saved.')),
          d.status,
          h('div.dialog-actions', h('button.btn', { type: 'button', id: 'syncCancel', onclick: d.close }, 'Cancel'), go)));
      if (active && $(active)) $(active).focus();
      return;
    }
    // set up: what each side holds, and the one thing to do about it
    const here = App.state.unreadable ? 'the stored plan could not be opened' : App.isSample() ? 'no plan of yours yet (the sample)' : null;
    const stateLine = { 'in-step': 'In step with the cloud', sending: 'Sending the plan…', receiving: 'Opening the cloud’s plan…', checking: 'Looking at the cloud…', waiting: 'Changes are waiting for a connection', conflict: 'A different plan from the cloud’s', newer: 'Older than the cloud’s plan', error: 'Not syncing', empty: 'Nothing sent yet', held: 'Not syncing' }[c.status] || '';
    const row = (name, id, ...value) => h('div.bk-row', h('span.bk-name', name), h('span.bk-value', { id }, value));
    const busy = !!c.busy, act = [];
    let note = null;
    if (c.status === 'conflict') {
      note = h('p.bk-note.bad', { id: 'syncNote2' }, h('b', c.first ? 'Both hold a plan.' : 'Both have changed.'), ' Plans are never merged. Nothing is sent or replaced until you choose one.');
      act.push(h('button.btn', { type: 'button', id: 'syncOpen', disabled: busy, onclick: openCloud }, 'Open the cloud’s plan'), h('button.btn', { type: 'button', id: 'syncKeep', disabled: busy, onclick: keepMine }, 'Keep this plan, and save it over the cloud’s'));
    } else if (c.status === 'newer') {
      note = h('p.bk-note', { id: 'syncNote2' }, h('b', 'Another device has saved a newer plan.'), ' Nothing has been changed here since the last sync, so opening it loses nothing.');
      act.push(h('button.btn.primary', { type: 'button', id: 'syncOpen', disabled: busy, onclick: openCloud }, 'Open it'));
    } else if ((App.isSample() || App.state.unreadable) && c.cloud) {
      act.push(h('button.btn.primary', { type: 'button', id: 'syncOpen', disabled: busy, onclick: openCloud }, 'Open the plan from the cloud'));
    } else if (c.status === 'waiting') note = h('p.bk-note', { id: 'syncNote2' }, h('b', 'The cloud could not be reached.'), ' The plan is saved in this browser and is sent when there is a connection.');
    else if (c.status === 'error') note = h('p.bk-note.bad', { id: 'syncNote2' }, h('b', 'Cloud sync failed.'), ' ', c.error);
    const label = h('input', { id: 'syncLabel', type: 'text', maxLength: 40, autocomplete: 'off', value: c.label, placeholder: deviceGuess() || 'Work laptop', onchange: e => s.rename(e.target.value) });
    UI.add(UI.clear(body),
      h('div.bk-rows',
        row('Service', 'syncHost', h('span.bk-mono', c.url.replace(/^https?:\/\//, ''))),
        row('In the cloud', 'syncCloud', c.cloud ? cloudFacts(c.cloud) : c.status === 'checking' ? 'looking…' : 'no plan yet'),
        row('In this browser', 'syncHere', here ? here : h('span.bk-facts', h('span', h('b', UI.num(hereCount())), ' plantings')), stateLine ? h('span.bk-state', { id: 'syncState', dataset: { state: c.status } }, stateLine) : null),
        row('This device', 'syncDevice', label)),
      note,
      act.length ? h('div.bk-choice', act) : null,
      c.photoNote ? h('p.dlg-hint', { id: 'syncPhotoNote' }, `The photos could not be synced this time (${c.photoNote}). The plan itself is not affected.`) : null,
      h('p.dlg-hint', 'A change made here is sent a few seconds later. If another device has saved in the meantime, nothing is overwritten: the page asks which plan to keep. The cloud also keeps the plan as it stood at the end of each of the last 30 days.'),
      d.status,
      h('div.dialog-actions',
        h('button.btn', { type: 'button', id: 'syncLeave', disabled: busy, onclick: leave }, 'Disconnect…'), h('span.grow'),
        h('button.btn', { type: 'button', id: 'syncNow', disabled: busy || c.status === 'conflict', onclick: async () => { d.say('Looking at the cloud…'); const now = await s.run('save'); if (syncDlg) d.say(now.status === 'in-step' ? `In step. The cloud’s plan was saved ${when(now.savedAt)}.` : now.status === 'waiting' ? 'The cloud could not be reached.' : now.error || '', now.status === 'in-step' ? 'good' : now.status === 'waiting' || now.status === 'error' ? 'bad' : ''); } }, 'Sync now'),
        h('button.btn.primary', { type: 'button', id: 'syncDone', onclick: d.close }, 'Done')));
    if (active && $(active) && active !== 'syncLabel') $(active).focus();
  }
  async function leave() {
    const ok = await UI.confirm({ title: 'Stop syncing in this browser?', body: 'This browser forgets the service’s address and its sign-in. The plan here and the plan in the cloud are both left exactly as they are, and other devices carry on.', confirmLabel: 'Disconnect' });
    if (!ok) return;
    sync().disconnect();
    if (syncDlg) { syncDlg.typed = { url: null, label: null }; syncDlg.say('Disconnected. Nothing was removed.'); drawSync(); }
  }

  // ───────────────────────── Snapshots ─────────────────────────
  let snapDlg = null;
  function openSnaps() {
    if (snapDlg) return;
    const list = h('ul.snap-list', { id: 'snapList' }), note = h('p.dlg-hint', { id: 'snapNote' }), say = h('p.dlg-status', { id: 'snapSay', role: 'status', 'aria-live': 'polite' });
    const name = h('input', { id: 'snapName', type: 'text', maxLength: 80, autocomplete: 'off', placeholder: 'A name, such as “Before releasing pins”' });
    const take = h('button.btn.primary', { type: 'submit', id: 'snapTake' }, 'Take a snapshot');
    const close = () => { if (!snapDlg) return; snapDlg = null; el.close(); el.remove(); };
    const el = h('dialog.dialog.bk.snaps', { id: 'snapDlg', oncancel: e => { e.preventDefault(); close(); } },
      closeBtn('snapClose', () => close(), 'Close'), h('h2', 'Snapshots'),
      h('p.dlg-lead', 'The whole plan as it stood at a moment. Take one before a large change; go back to it if the change was wrong.'),
      h('form.snap-new', { id: 'snapForm', novalidate: true, onsubmit: async e => {
        e.preventDefault();
        if (take.disabled) return;
        take.disabled = true;
        const made = await App.snapshot(name.value.trim() || `Snapshot of ${UI.day(new Date())}`);
        take.disabled = App.isSample();
        if (made && snapDlg) { name.value = ''; snapDlg.say(`Kept: “${made.name}”.`, 'good'); }
      } }, h('label.fld', h('span', 'New snapshot'), name), take),
      list, note, say,
      h('p.dlg-hint', { id: 'snapRules' }, ''),
      h('div.dialog-actions', h('button.btn.primary', { type: 'button', id: 'snapDone', onclick: () => close() }, 'Done')));
    snapDlg = { el, list, note, name, take, say: (text, kind) => { say.textContent = text || ''; say.dataset.kind = kind || ''; }, close, turn: 0 };
    document.body.append(el); el.showModal(); drawSnaps();
  }
  async function drawSnaps() {
    const d = snapDlg; if (!d) return;
    const turn = ++d.turn, c = App.syncInfo();
    if (!d.list.childElementCount) d.list.replaceChildren(h('li.snap-empty', 'Looking…'));
    const got = await App.snapshots();
    if (!snapDlg || turn !== d.turn) return;
    d.take.disabled = App.isSample() || !!App.state.unreadable || !got.available; d.name.disabled = d.take.disabled;
    $('snapRules').textContent = `The planner also takes one by itself at the start of each day the plan is changed, and before anything that replaces the whole plan. Its newest 20 are kept. A named one is kept until you delete it${c.configured ? ', and is copied to the cloud' : ''}.`;
    d.note.textContent = !got.available ? 'This browser gives the page no database to keep snapshots in (a private window does that). Download a backup instead.' : App.isSample() ? 'This is the sample plan. Snapshots are of your own plan.' : got.cloudNote;
    d.note.hidden = !d.note.textContent;
    if (!got.rows.length) { d.list.replaceChildren(h('li.snap-empty', { id: 'snapEmpty' }, 'None yet.')); return; }
    const where = r => (r.here && r.cloud ? 'this browser + cloud' : r.here ? 'this browser' : 'cloud');
    d.list.replaceChildren(...got.rows.map(r => h('li.snap-row', { dataset: { snap: r.id, kind: r.kind, auto: r.auto ? '1' : '', where: where(r) } },
      h('div.snap-what',
        h('b.snap-name', r.name),
        h('span.bk-facts', h('span', when(r.at)), Number.isFinite(+r.plantings) ? h('span', h('b', UI.num(r.plantings)), ' plantings') : null, r.waiting ? h('span', h('b', UI.num(r.waiting)), ' to place') : null),
        h('small.snap-fine', `${r.auto ? 'automatic · ' : ''}${where(r)}${!r.here && r.label ? ` · from ${r.label}` : ''}`)),
      h('div.snap-acts',
        h('button.btn.small', { type: 'button', dataset: { act: 'restore' }, onclick: async () => { const ok = await App.restoreSnapshot(r); if (ok && snapDlg) snapDlg.close(); } }, 'Go back to it'),
        h('button.btn.small.quiet', { type: 'button', dataset: { act: 'download' }, title: 'A plan file of this snapshot', onclick: () => App.downloadSnapshot(r) }, 'Download'),
        h('button.btn.small.quiet', { type: 'button', dataset: { act: 'delete' }, onclick: async () => {
          const ok = await UI.confirm({ title: `Delete “${r.name}”?`, body: `The snapshot of ${when(r.at)} is removed from ${where(r)}. The plan that is open is not touched.`, confirmLabel: 'Delete', danger: true });
          if (ok) await App.deleteSnapshot(r);
        } }, 'Delete')))));
  }

  // ───────────────────────── the Backup menu, and wiring ─────────────────────────
  function menu() {
    const c = App.syncInfo(), btn = $('syncBtn'), note = $('syncNote');
    btn.hidden = !c.supported;
    if ($('firstCloud')) $('firstCloud').hidden = !c.supported;
    note.textContent = !c.configured && c.status === 'signin' ? 'Needs the passphrase again' : !c.configured ? 'Keep a copy off this computer, for a second computer or a phone' :
      { 'in-step': c.savedAt ? `In step · sent ${when(c.savedAt)}` : 'In step', sending: 'Sending…', receiving: 'Opening the cloud’s plan…', checking: 'Looking…', waiting: 'Waiting for a connection', conflict: 'The cloud holds a different plan: choose', newer: 'A newer plan is in the cloud', error: 'Not syncing: see why', empty: 'Connected · nothing sent yet', held: 'Connected · not syncing' }[c.status] || 'Connected';
    $('snapBtn').hidden = !App.snapshotsKept();
  }
  function init() {
    const closeMenu = () => { $('dataMenu').hidden = true; $('dataBtn').setAttribute('aria-expanded', 'false'); };
    $('syncBtn').addEventListener('click', () => { closeMenu(); openSync(); });
    $('snapBtn').addEventListener('click', () => { closeMenu(); openSnaps(); });
    if ($('firstCloud')) $('firstCloud').addEventListener('click', openSync);
    App.on('sync', () => { menu(); strip(); drawSync(); if (snapDlg && App.syncInfo().status === 'in-step') drawSnaps(); });
    App.on('plan', () => { menu(); strip(); if (syncDlg && App.syncInfo().configured) drawSync(); });
    App.on('snaps', drawSnaps);
    menu();
  }
  root.LRFBackupUI = { init, openSync, openSnaps, openCloud, keepMine };
})(window);
