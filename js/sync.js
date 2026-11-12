/* Little River Farm Planner — cloud sync: one copy of the plan kept off this computer, in the grower's own storage.
 *
 * The plan open in this browser is always the one worked on; nothing here waits for a connection. When there is one:
 *
 *   a change made here is sent a few seconds later, and lands only if the cloud still holds the plan this browser
 *   last saw there. If another device has saved since, nothing is sent and nothing is replaced: the page says so and
 *   asks which plan to keep. Plans are never merged.
 *
 *   a newer plan in the cloud is opened by itself only at start-up, and only when nothing has been changed here since
 *   the last sync (the plan here is kept as a snapshot first). While the page is in use it is offered, never swapped in.
 *
 * What this browser remembers (localStorage "lrf-next:sync"): the service's address, a sign-in token (not the
 * passphrase, which is typed once and not kept), the stamp of the cloud plan it is in step with, and a fingerprint of
 * the plan as it stood then, which is how it knows whether anything has been changed here since.
 *
 * No page of the app is touched here. The app is reached through `host`:
 *   mode()          'plan' | 'sample' | 'held'      a real plan, the sample, or a stored plan that would not open
 *   key()           a fingerprint of the plan's content
 *   payload()       -> { text, savedAt, key, plantings, waiting, year }
 *   extrasKey()     -> a fingerprint of the photos        extras() -> { map: { bytes, mime } | null, thumbs: text | null }
 *   open(text, { image, thumbs, why, from })  -> true once the plan is open here          photos({ image, thumbs })
 *   loads()         how many whole plans have been loaded over the open one       device()   say(message)
 */
(function (root) {
  'use strict';
  const KEY = 'lrf-next:sync';
  const timing = { push: 4000, poll: 300000, focus: 60000, timeout: 45000, retry: 30000, retryMost: 300000 };

  /** What to do, from what each side holds. base: the cloud stamp this browser is in step with; cloud: the stamp there now. */
  function decide({ base, cloud, dirty, sample }) {
    if (!cloud) return sample ? 'nothing' : 'push-first';
    if (sample) return 'pull';
    if (!base) return 'ask-first';
    if (cloud === base) return dirty ? 'push' : 'in-step';
    return dirty ? 'conflict' : 'newer';
  }
  /** The service's address as it is used: https, no sign-in part, no trailing slash. '' when it is not one. */
  function address(value) {
    let text = String(value || '').trim(), u;
    if (text && !/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = 'https://' + text;
    try { u = new URL(text); } catch (_) { return ''; }
    const local = /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
    if ((u.protocol !== 'https:' && !(local && u.protocol === 'http:')) || u.username || u.password || !u.hostname.includes('.') && !local) return '';
    return u.origin + u.pathname.replace(/\/+$/, '');
  }
  const viaStream = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  /** Text packed for the trip: a plan is a megabyte of JSON and a tenth of that packed. */
  async function pack(text) {
    const raw = new TextEncoder().encode(text);
    if (typeof CompressionStream !== 'function') return { bytes: raw, enc: 'none' };
    try { return { bytes: await viaStream(raw, new CompressionStream('gzip')), enc: 'gzip' }; } catch (_) { return { bytes: raw, enc: 'none' }; }
  }
  async function unpack(bytes, enc) {
    if (enc === 'gzip') {
      if (typeof DecompressionStream !== 'function') throw problem('server', 'This browser cannot open a packed plan. Use a current Chrome, Edge, Firefox or Safari.');
      bytes = await viaStream(bytes, new DecompressionStream('gzip'));
    }
    return new TextDecoder().decode(bytes);
  }
  const problem = (kind, message, detail) => Object.assign(new Error(message), { kind, detail: detail || null });
  const sha256 = async bytes => { try { return [...new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join(''); } catch (_) { return null; } };
  const framed = () => { try { return root.self !== root.top; } catch (_) { return true; } };
  /** Can this page sync at all? Only from a web address: the service answers the planner's own site, not a file on disk or another site's frame. */
  const supported = () => typeof root.fetch === 'function' && !!root.location && /^https?:$/.test(root.location.protocol) && !framed() && !(root.claude && typeof root.claude.use === 'function');

  function create(host, env = {}) {
    const store = env.storage || { get: () => { try { return root.localStorage.getItem(KEY); } catch (_) { return null; } }, set: v => { try { if (v == null) root.localStorage.removeItem(KEY); else root.localStorage.setItem(KEY, v); } catch (_) { /* the session still syncs */ } } };
    const doFetch = env.fetch || ((...a) => root.fetch(...a)), later = env.setTimeout || ((fn, ms) => root.setTimeout(fn, ms)), cancel = env.clearTimeout || (id => root.clearTimeout(id));
    const listeners = [];
    let cfg = {};
    try { cfg = JSON.parse(store.get() || '{}') || {}; } catch (_) { cfg = {}; }
    const st = { status: cfg.url && cfg.token ? 'checking' : cfg.url ? 'signin' : 'off', cloud: null, files: null, first: false, error: '', until: null, checkedAt: 0, busy: false, snoozed: null, loads: 0, tries: 0, photoNote: '' };
    let timer = null, again = null, running = null;
    const keep = change => { cfg = { ...cfg, ...change }; for (const k of Object.keys(cfg)) if (cfg[k] == null) delete cfg[k]; store.set(Object.keys(cfg).length ? JSON.stringify(cfg) : null); };
    const emit = () => { const now = info(); for (const fn of listeners) { try { fn(now); } catch (_) { /* a listener's fault is not the sync's */ } } };
    const set = (status, error) => { st.status = status; st.error = error || ''; emit(); };
    const configured = () => !!(cfg.url && cfg.token);
    function info() {
      return { supported: env.supported !== undefined ? !!env.supported : supported(), configured: configured(), url: cfg.url || '', label: cfg.label || '', status: st.status, cloud: st.cloud, first: st.first, error: st.error, until: st.until,
        savedAt: cfg.savedAt || null, busy: st.busy, checkedAt: st.checkedAt, offer: st.status === 'newer' && !!st.cloud && st.cloud.etag !== st.snoozed, photoNote: st.photoNote };
    }

    async function call(method, path, { body, headers, raw, at, token } = {}) {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null, t = later(() => ctl && ctl.abort(), timing.timeout), bearer = token === undefined ? cfg.token : token;
      let res;
      try { res = await doFetch((at || cfg.url) + path, { method, body, headers: { ...(bearer ? { authorization: 'Bearer ' + bearer } : {}), ...(headers || {}) }, signal: ctl ? ctl.signal : undefined, cache: 'no-store' }); }
      catch (_) { throw problem('offline', 'The cloud could not be reached.'); }
      finally { cancel(t); }
      const renewed = res.headers.get('x-lrf-token');
      if (renewed && configured() && !at) keep({ token: renewed });
      if (res.ok) {
        if (raw) return res;
        try { return await res.json(); } catch (_) { throw problem('server', 'That address did not answer like the plan sync service.'); }
      }
      let said = {};
      try { said = (await res.json()) || {}; } catch (_) { said = {}; }
      if (res.status === 401 && said.error === 'wrong') throw problem('wrong', said.left > 0 ? `That is not the passphrase. ${said.left} more tr${said.left === 1 ? 'y' : 'ies'} before the service shuts for a while.` : 'That is not the passphrase. One more wrong try shuts the service for a while.', said);
      if (res.status === 401) throw problem('signin', 'The cloud needs the passphrase again.');
      if (res.status === 429) throw problem('locked', `Too many wrong passphrases have been tried. The service takes no passphrase until ${clock(said.until)}.`, said);
      if (res.status === 412) throw problem('changed', 'The cloud holds a different plan.', said);
      if (res.status === 404 && typeof said.error === 'string' && /stored here/.test(said.error)) throw problem('missing', said.error, said);
      throw problem('server', typeof said.error === 'string' && said.error !== 'signin' ? said.error : res.status === 404 || res.status === 405 ? 'That address did not answer like the plan sync service.' : `The sync service answered with an error (${res.status}).`, said);
    }
    const clock = iso => { const d = new Date(iso); return Number.isFinite(+d) ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'later'; };
    const metaHeader = meta => encodeURIComponent(JSON.stringify(meta));
    const readMeta = res => { try { return JSON.parse(decodeURIComponent(res.headers.get('x-lrf-meta') || '%7B%7D')); } catch (_) { return {}; } };

    /** Send the plan open here, on condition that the cloud still holds `base` ('none': holds nothing). */
    async function push(base, replace) {
      const p = await host.payload(), packed = await pack(p.text);
      set('sending');
      const meta = { savedAt: p.savedAt, device: host.device(), label: cfg.label || '', plantings: p.plantings, waiting: p.waiting, year: p.year, enc: packed.enc, bytes: p.text.length };
      const done = await call('PUT', '/plan', { body: packed.bytes, headers: { 'x-lrf-base': base || 'none', 'x-lrf-meta': metaHeader(meta), ...(replace || host.loads() !== st.loads ? { 'x-lrf-replace': '1' } : {}) } });
      keep({ base: done.plan.etag, key: p.key, savedAt: p.savedAt });
      st.cloud = done.plan; st.first = false; st.snoozed = null; st.loads = host.loads();
      await photosUp(null).catch(error => { st.photoNote = error.message; });
      set('in-step');
      if (host.mode() === 'plan' && host.key() !== p.key) schedule('change', timing.push);   // changed again while it was on its way
      return true;
    }
    /** The photos travel beside the plan: the farm photo and the small variety photos. Sent when they have changed here. */
    async function photosUp(remote) {
      const mine = await host.extrasKey(), stampOf = f => (f ? f.etag : null);
      if (mine === cfg.extrasKey) {
        if (!remote) return false;
        const gone = (cfg.mapEtag && !remote.map) || (cfg.thumbsEtag && !remote.thumbs);   // the cloud has lost a photo file this browser sent: send it again
        if (!gone) return stampOf(remote.map) !== (cfg.mapEtag || null) || stampOf(remote.thumbs) !== (cfg.thumbsEtag || null) ? photosDown(remote) : false;   // unchanged here, changed there: another device added photos
      }
      const ex = await host.extras(), change = { extrasKey: mine };
      if (ex && ex.map && ex.map.bytes) change.mapEtag = (await call('PUT', '/file/map', { body: ex.map.bytes, headers: { 'x-lrf-type': ex.map.mime || 'image/jpeg' } })).etag;
      if (ex && ex.thumbs) { const packed = await pack(ex.thumbs); change.thumbsEtag = (await call('PUT', '/file/thumbs', { body: packed.bytes, headers: { 'x-lrf-type': packed.enc } })).etag; }
      keep(change); st.photoNote = '';
      return true;
    }
    async function fetchPhotos(files) {
      const out = { image: null, thumbs: null, etags: {} };
      if (files && files.map && files.map.etag !== cfg.mapEtag) {
        const res = await call('GET', '/file/map', { raw: true }), bytes = new Uint8Array(await res.arrayBuffer()), mime = res.headers.get('x-lrf-type') || 'image/jpeg';
        out.image = { bytes, mime: /^image\/(jpeg|png|webp)$/.test(mime) ? mime : 'image/jpeg', sha256: await sha256(bytes) }; out.etags.mapEtag = res.headers.get('x-lrf-etag') || files.map.etag;
      }
      if (files && files.thumbs && files.thumbs.etag !== cfg.thumbsEtag) {
        const res = await call('GET', '/file/thumbs', { raw: true });
        out.thumbs = await unpack(new Uint8Array(await res.arrayBuffer()), res.headers.get('x-lrf-type') === 'gzip' ? 'gzip' : 'none'); out.etags.thumbsEtag = res.headers.get('x-lrf-etag') || files.thumbs.etag;
      }
      return out;
    }
    async function photosDown(files) {
      const got = await fetchPhotos(files);
      if (!got.image && !got.thumbs) return false;
      await host.photos({ image: got.image, thumbs: got.thumbs });
      keep({ ...got.etags, extrasKey: await host.extrasKey() });
      return true;
    }
    /** Open the cloud's plan here. The plan open here is kept as a snapshot first (the app sees to that). */
    async function pull(why) {
      set('receiving');
      const res = await call('GET', '/plan', { raw: true }), meta = readMeta(res), etag = res.headers.get('x-lrf-etag');
      const text = await unpack(new Uint8Array(await res.arrayBuffer()), meta.enc);
      let photos = { image: null, thumbs: null, etags: {} };
      try { photos = await fetchPhotos(st.files); } catch (error) { st.photoNote = error.message; }
      const ok = await host.open(text, { image: photos.image, thumbs: photos.thumbs, why: why || 'Before opening the plan from the cloud', from: 'the cloud' });
      if (!ok) return false;
      keep({ base: etag, key: host.key(), savedAt: meta.savedAt || null, ...photos.etags, extrasKey: await host.extrasKey() });
      st.cloud = { ...(st.cloud || {}), etag, meta }; st.first = false; st.snoozed = null; st.loads = host.loads();
      set('in-step');
      return true;
    }

    function failed(error) {
      const kind = error && error.kind;
      if (kind === 'offline') { st.tries += 1; set('waiting', error.message); schedule('retry', Math.min(timing.retry * 2 ** (st.tries - 1), timing.retryMost)); return; }
      if (kind === 'signin') { keep({ token: null }); set('signin', error.message); return; }
      if (kind === 'changed') {
        // the cloud moved between this browser's last look and its write: nothing was stored. Look again and say what is there.
        st.cloud = (error.detail && error.detail.plan) || null;
        if (!st.cloud) { keep({ base: null }); schedule('recheck', 50); set('checking'); return; }
        st.first = !cfg.base; set('conflict'); return;
      }
      set('error', (error && error.message) || 'Cloud sync failed.');
    }
    /** One piece of work with the cloud at a time: a look, a send, an open. */
    function solo(work) {
      if (running) return running.then(() => solo(work));
      running = (async () => {
        st.busy = true;
        try { return await work(); }
        catch (error) { failed(error); return false; }
        finally { st.busy = false; running = null; emit(); if (again) { const r = again; again = null; schedule(r, 50); } }
      })();
      return running;
    }
    /** One look at the cloud, and whatever follows from it. */
    function run(reason) {
      if (!configured()) return Promise.resolve(info());
      if (running) { again = again || reason; return running.then(info); }
      cancel(timer); timer = null;
      return solo(async () => {
          const mode = host.mode();
          if (mode === 'held') { set('held'); return; }
          // a change made here, while in step: straight to the conditional write, which says by itself if the cloud has moved
          if (reason === 'change' && cfg.base && st.status === 'in-step' && mode === 'plan' && host.key() !== cfg.key) { emit(); await push(cfg.base); st.tries = 0; return; }
          if (st.status === 'off' || st.status === 'signin') st.status = 'checking';
          emit();
          const remote = await call('GET', '/state');
          st.cloud = remote.plan || null; st.files = remote.files || null; st.checkedAt = Date.now(); st.tries = 0;
          const dirty = mode === 'plan' && host.key() !== cfg.key;
          const act = decide({ base: cfg.base || null, cloud: st.cloud && st.cloud.etag, dirty, sample: mode === 'sample' });
          if (act === 'nothing') set('empty');
          else if (act === 'push-first') await push('none');
          else if (act === 'push') await push(cfg.base);
          else if (act === 'pull') { if (await pull('Before opening the plan from the cloud')) host.say(`Your plan was opened from the cloud: ${what(st.cloud)}.`); else set('newer'); }
          else if (act === 'in-step') { st.first = false; await photosUp(st.files).catch(error => { st.photoNote = error.message; }); set('in-step'); }
          else if (act === 'newer') {
            if (reason === 'start' || reason === 'connect') { if (await pull()) host.say(`A newer plan was opened from the cloud: ${what(st.cloud)}. The plan that was here is under Backup, Snapshots.`); else set('newer'); }
            else set('newer');
          }
          else { st.first = act === 'ask-first'; set('conflict'); }
      }).then(info);
    }
    const what = cloud => { const m = (cloud && cloud.meta) || {}; return `saved ${when(m.savedAt)}${m.label ? ` on ${m.label}` : ''}${Number.isFinite(m.plantings) ? `, ${m.plantings} plantings` : ''}`; };
    const when = iso => { const d = new Date(iso); if (!Number.isFinite(+d)) return 'at an unknown time'; const today = new Date().toDateString() === d.toDateString(); return `${today ? 'today' : d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${clock(iso)}`; };
    function schedule(reason, ms) { cancel(timer); timer = later(() => { timer = null; run(reason); }, ms); }

    /** The plan has been changed here. Sent a few seconds after the last change, when in step; otherwise it waits for the choice. */
    function touch() {
      if (!configured() || st.status === 'conflict' || st.status === 'signin') return;
      if (st.status === 'newer') { if (host.mode() === 'plan' && host.key() !== cfg.key) { st.first = false; set('conflict'); } return; }
      schedule('change', timing.push);
    }
    /** Set the service up in this browser. The passphrase is sent once, for a token, and is not kept. */
    async function connect(url, passphrase, label) {
      const at = address(url);
      if (!at) throw problem('address', 'That is not an address the planner can use. It looks like https://lrf-plan-sync.your-name.workers.dev');
      if (!String(passphrase || '').length) throw problem('wrong', 'Type the passphrase.');
      let got;
      try { got = await call('POST', '/login', { at, token: null, body: JSON.stringify({ key: String(passphrase) }), headers: { 'content-type': 'application/json' } }); }
      catch (error) { if (error.kind === 'locked') st.until = error.detail && error.detail.until; throw error; }
      if (!got || typeof got.token !== 'string') throw problem('server', 'That address did not answer like the plan sync service.');
      const sameHome = cfg.url === at;
      cfg = sameHome ? cfg : {};
      keep({ url: at, token: got.token, label: String(label == null ? cfg.label || '' : label).trim().slice(0, 40) });
      st.until = null; st.status = 'checking'; st.loads = host.loads();
      return run('connect');
    }
    function disconnect() { cancel(timer); timer = null; cfg = {}; store.set(null); Object.assign(st, { status: 'off', cloud: null, files: null, first: false, error: '', snoozed: null, tries: 0 }); emit(); }
    const rename = label => { keep({ label: String(label || '').trim().slice(0, 40) }); emit(); };
    /** The user's answer to "which plan": the cloud's. */
    function openCloud() {
      if (!configured()) return Promise.resolve(false);
      return solo(async () => {
        const remote = await call('GET', '/state');
        st.cloud = remote.plan || null; st.files = remote.files || null; st.checkedAt = Date.now();
        if (!st.cloud) { set('empty'); return false; }
        const before = st.status, ok = await pull('Before opening the plan from the cloud');
        if (!ok) set(before === 'receiving' ? 'newer' : before);
        return ok;
      });
    }
    /** The user's answer to "which plan": this one. The cloud's is kept there as a snapshot first. */
    function keepMine() {
      if (!configured() || !st.cloud || host.mode() !== 'plan') return Promise.resolve(false);
      return solo(() => push(st.cloud.etag, true));
    }
    const snooze = () => { if (st.cloud) st.snoozed = st.cloud.etag; emit(); };

    // snapshots kept in the cloud beside the plan
    const snaps = async () => (await call('GET', '/snaps')).snaps || [];
    async function putSnap(id, meta, text) { const packed = await pack(text); await call('PUT', '/snap/' + id, { body: packed.bytes, headers: { 'x-lrf-meta': metaHeader({ ...meta, enc: packed.enc, device: host.device(), label: cfg.label || '' }) } }); return true; }
    async function getSnap(kind, id) { const res = await call('GET', `/${kind === 'day' ? 'day' : 'snap'}/${id}`, { raw: true }); return unpack(new Uint8Array(await res.arrayBuffer()), readMeta(res).enc); }
    const dropSnap = (kind, id) => call('DELETE', `/${kind === 'day' ? 'day' : 'snap'}/${id}`);

    let listening = false;
    function start() {
      st.loads = host.loads();
      if (root.addEventListener && !listening) {
        listening = true;
        root.addEventListener('online', () => { if (configured()) run('online'); });
        if (root.document) root.document.addEventListener('visibilitychange', () => { if (root.document.visibilityState === 'visible' && configured() && Date.now() - st.checkedAt > timing.focus) run('focus'); });
        if (root.setInterval) root.setInterval(() => { if (configured() && (!root.document || root.document.visibilityState === 'visible') && Date.now() - st.checkedAt > timing.poll * 0.9) run('poll'); }, Math.max(1000, Math.min(timing.poll, 60000)));
      }
      if (!configured()) { emit(); return Promise.resolve(info()); }
      return run('start');
    }
    return { info, on: fn => listeners.push(fn), start, run, touch, connect, disconnect, rename, openCloud, keepMine, snooze, snaps, putSnap, getSnap, dropSnap, configured, when, describe: what };
  }

  const api = { create, decide, address, pack, unpack, supported, timing, KEY };
  root.LRFSync = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
