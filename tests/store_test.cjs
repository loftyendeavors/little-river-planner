'use strict';
// Saving the plan in a browser with more than one window of the planner open (js/store.js), without a browser.
// The rules under test:
//   1. a count is kept beside the stored plan. It is read with the plan and read again before every write: if it has moved,
//      another window has written, and nothing is written. The count is written before the plan.
//   2. one window holds the plan (the browser's lock, asked for once as the page starts). A window without it writes nothing.
//      Asked to, the holder saves what is waiting, lets go, and writes nothing after. A holder that does not answer within
//      1.5 s has the lock taken from it.
//   3. a save that is waiting is written when the page is hidden.
// Each "window" is the store's own script run in a context of its own, with stand-ins for what a browser gives it: the storage
// and the lock are shared by the windows of one made-up browser, the timers are turned by hand.
// usage: node store_test.cjs <app-dir>
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const appDir = process.argv[2] || path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(appDir, 'js/store.js'), 'utf8');
const PLAN = 'lrf-next:plan', COUNT = 'lrf-next:plan-n';
const results = [], fail = [];
let ended = false;
const check = (name, ok, detail) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined && (!ok || process.env.VERBOSE) ? ' ' + JSON.stringify(detail).slice(0, 900) : ''}`); if (!ok) fail.push(name); };
// The report is printed as the process ends, whatever happened on the way: a line that throws is one failed line, not a silent stop.
process.on('exit', () => {
  if (!ended) check('the test ran to its end', false, 'it stopped before its last line');
  console.log(results.join('\n'));
  console.log(JSON.stringify({ passed: results.length - fail.length, of: results.length, failed: fail }));
  process.exitCode = fail.length ? 1 : 0;
});
process.on('uncaughtException', error => { check('the test ran to its end', false, String(error && error.stack || error).slice(0, 400)); ended = true; process.exit(1); });
process.on('unhandledRejection', error => { check('the test ran to its end', false, String(error && error.stack || error).slice(0, 400)); ended = true; process.exit(1); });

const turn = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 6; i++) await turn(); };

/** One made-up browser: the storage, the lock and the channel its windows share. `room`: how many characters a stored text may have. */
function browser({ locks = true, events = true } = {}) {
  const b = { data: new Map(), writes: [], windows: [], room: Infinity, holder: null, asked: 0, locks, events };
  b.text = () => b.data.get(PLAN) ?? null;
  b.count = () => b.data.get(COUNT) ?? null;
  return b;
}
/** A window of that browser, with the store made and connected in it. `deaf`: it hears nothing the other windows say. */
async function open(b, name, { deaf = false, meanwhile = null } = {}) {
  const w = { name, now: 0, timers: [], listeners: {}, docListeners: {}, said: [], asked: 0, closed: false };
  const fire = (list, event) => { for (const fn of list || []) fn(event); };
  const storage = {
    getItem: key => (b.data.has(key) ? b.data.get(key) : null),
    setItem: (key, value) => {
      value = String(value);
      if (value.length > b.room) throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
      const old = storage.getItem(key);
      b.data.set(key, value); b.writes.push({ by: name, key });
      if (b.events && old !== value) for (const other of b.windows) if (other !== w && !other.closed) fire(other.listeners.storage, { key, oldValue: old, newValue: value, storageArea: other.box.localStorage });
    },
    removeItem: key => { b.data.delete(key); }
  };
  const lockManager = {
    request(lockName, options, callback) {
      w.asked++; b.asked++;
      return new Promise((resolve, reject) => {
        const take = () => {
          const mine = { by: w, reject };
          b.holder = mine;
          Promise.resolve().then(() => callback({ name: lockName })).then(value => { if (b.holder === mine) b.holder = null; resolve(value); }, error => { if (b.holder === mine) b.holder = null; reject(error); });
        };
        if (options.steal) { const was = b.holder; b.holder = null; if (was) was.reject(Object.assign(new Error('The lock was taken.'), { name: 'AbortError' })); take(); }
        else if (!b.holder) take();
        else if (options.ifAvailable) Promise.resolve().then(() => callback(null)).then(resolve, reject);
        else reject(new Error('this stand-in does not queue for a lock'));
      });
    }
  };
  class Channel {
    constructor(channelName) { this.name = channelName; this.onmessage = null; w.channels.push(this); }
    postMessage(data) { for (const other of b.windows) if (other !== w && !other.closed && !other.deaf) for (const c of other.channels) if (c.name === this.name) setImmediate(() => { if (c.onmessage) c.onmessage({ data }); }); }
  }
  w.channels = []; w.deaf = deaf;
  w.box = {
    localStorage: storage, navigator: b.locks ? { locks: lockManager } : {}, BroadcastChannel: Channel,
    addEventListener: (type, fn) => { (w.listeners[type] = w.listeners[type] || []).push(fn); },
    document: { visibilityState: 'visible', addEventListener: (type, fn) => { (w.docListeners[type] = w.docListeners[type] || []).push(fn); } },
    setTimeout: (fn, ms) => { const t = { fn, due: w.now + ms }; w.timers.push(t); return t; },
    clearTimeout: t => { w.timers = w.timers.filter(x => x !== t); }
  };
  w.box.self = w.box;
  vm.runInNewContext(SRC, w.box, { filename: 'store.js' });
  /** Let time pass in this window: its timers that fall due fire, in order. */
  w.pass = async ms => { w.now += ms; for (let due; (due = w.timers.filter(t => t.due <= w.now).sort((x, y) => x.due - y.due)[0]);) { w.timers = w.timers.filter(t => t !== due); due.fn(); await settle(); } await settle(); };
  w.hide = () => { w.box.document.visibilityState = 'hidden'; fire(w.docListeners.visibilitychange, {}); };
  w.show = () => { w.box.document.visibilityState = 'visible'; fire(w.docListeners.visibilitychange, {}); };
  w.away = () => fire(w.listeners.pagehide, {});
  /** The page ends: what it held of the lock is free again, and it hears and says nothing more. */
  w.close = () => { w.closed = true; if (b.holder && b.holder.by === w) b.holder = null; };
  /** What this window has written of the plan and its count, in order. */
  w.wrote = () => b.writes.filter(x => x.by === name && (x.key === PLAN || x.key === COUNT)).map(x => x.key);
  b.windows.push(w);
  w.store = w.box.LRFStore.create(info => w.said.push(info.state + (info.detail ? ':' + info.detail : '')));
  // A window that finds the lock taken asks again for a moment before it gives up: time is let pass in it until it has its answer.
  let known = false; const connecting = w.store.connect().then(value => { known = true; return value; });
  await settle(); if (meanwhile) meanwhile(w);
  for (let i = 0; i < 12 && !known; i++) { await w.pass(150); }
  w.backend = await connecting;
  w.plan = await w.store.load();
  return w;
}
const plan = (n, word) => ({ plantings: Array.from({ length: n }, (_, i) => ({ id: `p-${i}` })), beds: [], gardens: [], word });
const refused = async promise => { try { await promise; return null; } catch (error) { return String(error && error.message); } };

(async () => {
  // ── the count beside the stored plan ──
  let b = browser({ locks: false, events: false });
  b.data.set(PLAN, JSON.stringify(plan(3, 'stored with no count')));
  let a = await open(b, 'one');
  check('a stored plan with no count beside it opens: no count reads as 0, and that is not a mismatch', a.backend === 'device' && a.plan && a.plan.word === 'stored with no count' && a.store.count === 0 && a.store.readOnly === '' && b.count() === null, [a.backend, a.store.count, a.store.readOnly]);
  b.writes.length = 0;
  await a.store.saveNow(plan(4, 'first save'));
  check('its first save here is taken, and writes the count 1', JSON.parse(b.text()).word === 'first save' && b.count() === '1' && a.store.count === 1, [b.count(), a.store.count]);
  check('the count is written before the plan', JSON.stringify(a.wrote()) === JSON.stringify([COUNT, PLAN]), a.wrote());
  a.store.save(plan(5, 'second save')); await a.pass(700);
  await a.store.saveNow(plan(6, 'third save'));
  check('each write moves the count by one, and the window that wrote goes on writing', b.count() === '3' && a.store.count === 3 && JSON.parse(b.text()).word === 'third save' && a.store.readOnly === '', [b.count(), a.store.readOnly]);
  check('“saved” is said once nothing is waiting: whoever hears it is told so', a.said[a.said.length - 1] === 'saved' && a.store.pending === false, a.said.slice(-3));

  // two windows that do not hear each other: only the count stands between them
  let c = await open(b, 'two');
  await a.store.saveNow(plan(7, 'from window one'));
  const kept = [b.text(), b.count()]; b.writes.length = 0;
  const why = await refused(c.store.saveNow(plan(2, 'from window two, which read an older count')));
  check('a moved count refuses the write', why !== null && /another window/.test(why) && c.store.readOnly === 'changed' && JSON.parse(b.text()).word === 'from window one', [why, c.store.readOnly, JSON.parse(b.text()).word]);
  check('a refused write leaves the stored text as it was', b.text() === kept[0] && b.count() === kept[1] && c.wrote().length === 0, [b.count(), kept[1], c.wrote()]);
  check('and the page is told: it says the plan was changed in another window', c.said.includes('elsewhere:changed') && c.store.pending === true, c.said);
  c.store.save(plan(2, 'again')); await c.pass(700); c.store.retry(); c.hide(); c.away(); await settle();
  const again = await refused(c.store.saveNow(plan(2, 'and again')));
  check('from then on that window writes nothing: not from its timer, a retry, the page hidden, or a save asked for outright', b.text() === kept[0] && b.count() === kept[1] && c.wrote().length === 0 && again !== null, [c.wrote(), again]);
  await a.store.saveNow(plan(8, 'window one carries on'));
  check('the window that holds the newest count carries on', JSON.parse(b.text()).word === 'window one carries on' && a.store.readOnly === '');
  // the queued save too: the 0.7 s timer goes through the same count
  c = await open(b, 'three');
  await a.store.saveNow(plan(9, 'one again'));
  c.store.save(plan(1, 'three, late')); await c.pass(700);
  check('a save from the timer is refused by a moved count like any other', c.store.readOnly === 'changed' && JSON.parse(b.text()).word === 'one again' && c.wrote().length === 0, [c.store.readOnly, c.wrote()]);

  // ── a write by another window is heard ──
  b = browser({ locks: false, events: true });
  a = await open(b, 'one'); c = await open(b, 'two');
  await a.store.saveNow(plan(3, 'one writes'));
  check('a write by another window stops this one at once, before another change is made in it', c.store.readOnly === 'changed' && c.said.includes('elsewhere:changed') && a.store.readOnly === '', [c.store.readOnly, a.store.readOnly]);
  b.writes.length = 0;
  c.store.save(plan(1, 'two, too late')); await c.pass(700);
  check('and it writes nothing after', c.wrote().length === 0 && JSON.parse(b.text()).word === 'one writes', c.wrote());
  let d = await open(b, 'three');
  a.box.localStorage.setItem('lrf-next:probe', '1'); a.box.localStorage.setItem('lrf-next:sync', '{}'); a.box.localStorage.setItem('some-other-key', 'x');
  check('a window is not stopped by what is written beside the plan and its count', d.store.readOnly === '' && a.store.readOnly === '', [d.store.readOnly]);

  // ── one window holds the plan ──
  b = browser();
  a = await open(b, 'one'); await a.store.saveNow(plan(4, 'held by one'));
  c = await open(b, 'two');
  check('the first window holds the plan; a second is read-only and says why', a.store.readOnly === '' && c.store.readOnly === 'window' && c.said.includes('elsewhere:window') && c.plan && c.plan.word === 'held by one', [a.store.readOnly, c.store.readOnly, c.said]);
  const text0 = [b.text(), b.count()]; b.writes.length = 0;
  c.store.save(plan(1, 'two')); await c.pass(700); c.hide(); c.show(); c.away(); c.store.retry(); await settle();
  const no = await refused(c.store.saveNow(plan(1, 'two, outright')));
  check('a read-only window writes nothing: a queued save, its timer, the page hidden, a save asked for outright', b.text() === text0[0] && b.count() === text0[1] && c.wrote().length === 0 && no !== null && /another window/.test(no), [c.wrote(), no]);
  await a.store.saveNow(plan(5, 'one, again')); a.store.save(plan(6, 'one, queued')); await a.pass(700);
  check('the lock is asked for once in a page that gets it, however often it saves; a page that finds it taken asks ten times over 1.5 s, and then no more', a.asked === 1 && c.asked === 10, [a.asked, c.asked]);
  // a reload: the page after hears, late, of the last write of the page before it
  {
    const br = browser(), first = await open(br, 'before'); await first.store.saveNow(plan(2, 'the last write before the reload')); first.close();
    const after = await open(br, 'after');
    for (const key of [COUNT, PLAN]) for (const fn of after.listeners.storage || []) fn({ key, storageArea: after.box.localStorage });
    check('a page told of a write it has already read is not stopped: the count beside the plan is the one it read', after.store.readOnly === '' && after.plan.word === 'the last write before the reload', [after.store.readOnly]);
    await after.store.saveNow(plan(3, 'and it saves'));
    check('and its next save is taken', JSON.parse(br.text()).word === 'and it saves', [br.count()]);
  }
  // a reload: the page before still holds the lock for a moment as the page after it starts
  {
    const br = browser(), first = await open(br, 'before the reload'); await first.store.saveNow(plan(2, 'saved before the reload'));
    const after = await open(br, 'after the reload', { meanwhile: () => first.close() });
    check('a page that starts while the page before it is still letting go of the lock gets it a moment later: it is not taken to be a second window', after.store.readOnly === '' && after.asked >= 2 && after.asked < 10 && after.plan.word === 'saved before the reload', [after.store.readOnly, after.asked]);
    await after.store.saveNow(plan(3, 'saved after the reload'));
    check('and it saves', JSON.parse(br.text()).word === 'saved after the reload' && br.count() === '2', [br.count()]);
  }

  // handing over
  a.store.save(plan(7, 'waiting in one when it was asked')); b.writes.length = 0;
  let done = false;
  c.store.takeOver().then(() => { done = true; });
  await settle();
  check('asked to hand the plan over, the holder writes at once what was waiting, lets go, and is read-only', done && JSON.parse(b.text()).word === 'waiting in one when it was asked' && a.store.readOnly === 'moved' && a.said.includes('elsewhere:moved') && b.holder === null, [done, JSON.parse(b.text()).word, a.store.readOnly, !!b.holder]);
  const text1 = [b.text(), b.count()]; b.writes.length = 0;
  a.store.save(plan(1, 'one, after letting go')); await a.pass(700); a.hide(); a.away(); a.store.retry(); await settle();
  const gone = await refused(a.store.saveNow(plan(1, 'one, outright')));
  check('after letting go it writes nothing: not from its timer, not when the page is hidden, not when asked outright', b.text() === text1[0] && b.count() === text1[1] && a.wrote().length === 0 && gone !== null, [a.wrote(), gone]);
  c.close();
  c = await open(b, 'two, reloaded');
  await c.store.saveNow(plan(8, 'two holds it now'));
  check('the window that asked takes the lock as it starts again, opens what the holder saved, and saves', c.store.readOnly === '' && c.plan.word === 'waiting in one when it was asked' && JSON.parse(b.text()).word === 'two holds it now' && a.store.readOnly === 'moved', [c.store.readOnly, c.plan.word]);

  // a holder that does not answer
  b = browser();
  a = await open(b, 'asleep', { deaf: true }); await a.store.saveNow(plan(3, 'saved by the one asleep'));
  c = await open(b, 'two');
  done = false; c.store.takeOver().then(() => { done = true; });
  await c.pass(1400);
  const early = done;
  await c.pass(100);
  check('a holder that does not answer within 1.5 s has the lock taken from it', !early && done && b.holder && b.holder.by === c && a.store.readOnly === 'moved', [early, done, a.store.readOnly]);
  const text2 = [b.text(), b.count()]; b.writes.length = 0;
  a.store.save(plan(1, 'the one asleep wakes')); await a.pass(700); a.hide(); a.away(); await settle();
  check('and writes nothing when it wakes', b.text() === text2[0] && b.count() === text2[1] && a.wrote().length === 0, a.wrote());

  // a browser without the lock
  b = browser({ locks: false, events: false });
  a = await open(b, 'one'); c = await open(b, 'two');
  await a.store.saveNow(plan(3, 'no lock: one'));
  const late = await refused(c.store.saveNow(plan(3, 'no lock: two')));
  check('a browser without the lock has no gate: both windows open for changes, and the count refuses the second write', a.asked === 0 && a.store.readOnly === '' && late !== null && c.store.readOnly === 'changed' && JSON.parse(b.text()).word === 'no lock: one', [a.store.readOnly, c.store.readOnly, late]);

  // ── the page is hidden ──
  b = browser();
  a = await open(b, 'one'); await a.store.saveNow(plan(3, 'before'));
  a.store.save(plan(4, 'changed just before the page was hidden')); a.hide();
  const hid = JSON.parse(b.text()).word;
  a.show(); a.store.save(plan(5, 'changed just before the page was put away')); a.away();
  check('a save that is waiting is written as the page is hidden or put away, without its timer', hid === 'changed just before the page was hidden' && JSON.parse(b.text()).word === 'changed just before the page was put away' && a.store.pending === false && a.now === 0, [hid, JSON.parse(b.text()).word]);
  b.writes.length = 0; a.hide(); a.away(); await a.pass(700);
  check('with nothing waiting, hiding the page writes nothing, and the timer that was waiting does not write a second time', a.wrote().length === 0, a.wrote());

  // ── a write the browser refuses ──
  b = browser();
  a = await open(b, 'one'); await a.store.saveNow(plan(3, 'fits'));
  const fits = b.text(); b.room = fits.length + 5;
  const full = await refused(a.store.saveNow(plan(400, 'too large for the room there is')));
  check('a write the browser refuses is said, stays waiting, and leaves the stored plan as it was', full !== null && b.text() === fits && a.store.pending === true && a.said.some(x => x.startsWith('error')) && a.store.readOnly === '', [full, a.store.pending, a.said.slice(-2)]);
  b.room = Infinity; a.store.retry(); await settle();
  check('and is written when there is room again', JSON.parse(b.text()).word === 'too large for the room there is' && a.store.pending === false && Number(b.count()) === a.store.count, [b.count(), a.store.count]);

  ended = true;
})();
