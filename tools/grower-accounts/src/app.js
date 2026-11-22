import { createClient } from '@supabase/supabase-js';
import { starter, addField, backup } from './farm.js';

const returnUrl = location.origin + location.pathname;
const recoveryLink = new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';
const pendingKey = 'grower-account-pending-v1';
const db = createClient(ACCOUNT_URL, ACCOUNT_KEY, {
  auth: { storageKey: 'grower-account-session-v1', storage: sessionStorage, detectSessionInUrl: true }
});
const byId = id => document.getElementById(id);
const sections = ['entry', 'recovery', 'verify', 'reset', 'setup', 'workspace'];
let owner = null;
let farm = null;
let generation = 0;
let challenge = null;
let screen = null;
let busy = false;

function say(text = '', error = false) {
  byId('message').textContent = text;
  byId('message').dataset.error = String(error);
}
function show(id) {
  screen = id;
  for (const section of sections) byId(section).hidden = section !== id;
  byId('reload').hidden = true;
  byId('signout').hidden = !owner;
  say();
}
function entry(mode) {
  challenge = null;
  sessionStorage.removeItem(pendingKey);
  show('entry');
  for (const item of ['signup', 'login']) {
    byId(item).hidden = item !== mode;
    byId('to-' + item).setAttribute('aria-pressed', String(item === mode));
  }
}
function clearPrivate() {
  owner = null;
  farm = null;
  generation++;
  challenge = null;
  for (const form of document.forms) form.reset();
  byId('farm-title').textContent = '';
  byId('summary').textContent = '';
  byId('gardens').replaceChildren();
  byId('sent').textContent = '';
  byId('field-details').open = false;
}
function useIdentity(id) {
  if (owner !== id) { clearPrivate(); owner = id; }
}
function renderFarm(row) {
  if (!row || row.owner_id !== owner) throw Error('Reopen your farm to continue.');
  farm = row;
  show('workspace');
  byId('farm-title').textContent = row.name;
  const { gardens, beds, plantings } = row.plan;
  byId('summary').textContent = gardens.length + ' gardens · ' + beds.length + ' beds and growing spaces · ' + plantings.length + ' plantings';
  byId('gardens').replaceChildren(...gardens.map(g => {
    const li = document.createElement('li');
    const count = beds.filter(b => b.gardenId === g.id).length;
    li.textContent = g.name + ' · ' + count + (count === 1 ? ' space' : ' spaces');
    return li;
  }));
}
function check(result) {
  if (result.error) throw result.error;
  return result.data;
}
async function openFarm() {
  const active = ++generation;
  const id = owner;
  show(null);
  say('Opening your farm…');
  const result = await db.from('grower_farms').select('*').eq('owner_id', id).maybeSingle();
  if (active !== generation || id !== owner) return;
  if (result.error) {
    byId('reload').hidden = false;
    throw Error('Your farm could not be opened. Check your connection and try again.');
  }
  if (result.data) renderFarm(result.data);
  else show('setup');
}
async function enter(session) {
  if (!session?.user?.id) { clearPrivate(); entry('signup'); return; }
  useIdentity(session.user.id);
  sessionStorage.removeItem(pendingKey);
  if (sessionStorage.getItem('grower-password-reset') === owner) show('reset');
  else await openFarm();
}
function lock(value) {
  busy = value;
  for (const button of document.querySelectorAll('button')) button.disabled = value;
}
function run(action) {
  return async event => {
    event?.preventDefault();
    if (busy) return;
    lock(true); say();
    const before = generation;
    try { await action(event); }
    catch (error) {
      if (screen === 'entry' || before === generation || (owner && !screen)) {
        say(error?.message || 'The request failed. Please try again.', true);
      }
    } finally { lock(false); }
  };
}
function submit(id, action) {
  byId(id).addEventListener('submit', run(event => action(new FormData(event.target))));
}
function challengeFor(type, email) {
  challenge = { type, email };
  sessionStorage.setItem(pendingKey, JSON.stringify(challenge));
  show('verify');
  byId('check-code').reset();
  byId('sent').textContent = 'Open the link in the email sent to ' + email + '. If your email contains a code, you can enter it here.';
}
byId('to-signup').onclick = () => entry('signup');
byId('to-login').onclick = () => entry('login');
byId('forgot').onclick = () => show('recovery');
for (const b of document.querySelectorAll('.back')) b.onclick = () => entry('login');
submit('signup', async data => {
  const email = data.get('email').trim();
  const result = check(await db.auth.signUp({ email, password: data.get('password'), options: { emailRedirectTo: returnUrl } }));
  byId('signup').reset();
  if (result.session) await enter(result.session);
  else challengeFor('email', email);
});
submit('login', async data => {
  const identifier = data.get('identifier').trim();
  const password = data.get('password');
  let result;
  if (identifier.includes('@')) result = check(await db.auth.signInWithPassword({ email: identifier, password }));
  else {
    const response = await fetch(ACCOUNT_URL + '/functions/v1/username-login', {
      method: 'POST', headers: { apikey: ACCOUNT_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: identifier, password }), cache: 'no-store', credentials: 'omit'
    });
    const payload = await response.json();
    if (!response.ok) throw Error(payload.message || 'Sign-in failed.');
    result = check(await db.auth.setSession(payload));
  }
  byId('login').reset();
  await enter(result.session);
});
submit('request-code', async data => {
  const email = data.get('email').trim();
  check(await db.auth.resetPasswordForEmail(email, { redirectTo: returnUrl }));
  challengeFor('recovery', email);
});
byId('resend').onclick = run(async () => {
  const { type, email } = challenge;
  check(type === 'recovery' ? await db.auth.resetPasswordForEmail(email, { redirectTo: returnUrl }) : await db.auth.resend({ type: 'signup', email, options: { emailRedirectTo: returnUrl } }));
  say('Check your email for a new message.');
});
submit('check-code', async data => {
  const { email, type } = challenge;
  const result = check(await db.auth.verifyOtp({ type, email, token: data.get('code') }));
  if (!result.session) throw Error('Sign in again to continue.');
  if (type === 'recovery') sessionStorage.setItem('grower-password-reset', result.session.user.id);
  challenge = null;
  await enter(result.session);
});
submit('set-password', async data => {
  check(await db.auth.updateUser({ password: data.get('password') }));
  sessionStorage.removeItem('grower-password-reset');
  byId('set-password').reset();
  await openFarm();
  say('Your password has been changed.');
});
submit('start', async data => {
  const handle = data.get('username').trim().toLowerCase();
  const name = data.get('farm').trim();
  if (!name) throw Error('Enter a farm name.');
  const active = generation;
  const result = await db.rpc('start_grower_farm', {
    expected_owner: owner, handle, farm_name: name, initial_plan: starter(name, data.get('kind'))
  }).single();
  if (active !== generation) return;
  if (result.error?.code === '23505') throw Error('That username is taken. Choose another.');
  renderFarm(check(result));
  say('Farm saved to your account.');
});
submit('add-field', async data => {
  const next = addField(farm.plan, data.get('field'), Number(data.get('count')), Number(data.get('length')), Number(data.get('width')));
  const active = generation;
  const result = await db.rpc('save_grower_farm', { expected_owner: owner, expected_revision: farm.revision, next_plan: next }).single();
  if (active !== generation) return;
  if (result.error?.code === '40001') {
    byId('reload').hidden = false;
    throw Error('Another device saved a newer farm. Reopen it, then add this field again.');
  }
  renderFarm(check(result));
  byId('add-field').reset(); byId('field-details').open = false;
  say('Field saved to your account.');
});
byId('reload').onclick = run(openFarm);
byId('download').onclick = () => {
  const url = URL.createObjectURL(new Blob([backup(farm.plan)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'farm-plan.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
byId('signout').onclick = run(async () => {
  check(await db.auth.signOut({ scope: 'local' }));
  sessionStorage.removeItem('grower-password-reset');
  if (owner) { clearPrivate(); entry('login'); }
  say('Signed out.');
});
db.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || (owner && session?.user?.id && owner !== session.user.id)) {
    clearPrivate(); entry('login');
  }
});
run(async () => {
  const session = check(await db.auth.getSession()).session;
  if (session && recoveryLink) sessionStorage.setItem('grower-password-reset', session.user.id);
  if (!session) {
    let pending;
    try { pending = JSON.parse(sessionStorage.getItem(pendingKey)); } catch { /* discard an incomplete challenge */ }
    if (pending && ['email', 'recovery'].includes(pending.type) && typeof pending.email === 'string') {
      challengeFor(pending.type, pending.email);
      return;
    }
  }
  await enter(session);
})();
