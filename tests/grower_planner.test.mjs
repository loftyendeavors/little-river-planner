import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlannerStore } from '../tools/grower-accounts/src/planner-store.js';
import { backup, readGrowerBackup } from '../tools/grower-accounts/src/farm.js';

const initial = { revision: 7, plan: { gardens: [], beds: [], plantings: [], lrfNext: { runs: [{ id: 'r1' }] },
  __growerFiles: { mapimage: 'cGhvdG8=', thumbs: '{"fixture":"dGh1bWI="}',  'attic-new': '{"varieties":{"v1":{"catalogSourceText":"Notes"}}}' } } };

test('keep an edit made during a save and compare both writes to the acknowledged revision', async () => {
  let finish;
  const calls = [];
  const store = createPlannerStore(initial, async (plan, rev) => {
    calls.push({ plan, rev });
    if (calls.length === 1) await new Promise(resolve => { finish = resolve; });
    return { revision: rev + 1 };
  }, () => {});
  const first = await store.load();
  assert.equal(first.__growerFiles, undefined);
  store.save({ ...first, gardens: [{ name: 'One' }] });
  const saving = store.flush();
  store.save({ ...first, gardens: [{ name: 'Two' }] });
  finish(); await saving;
  assert.deepEqual(calls.map(c => [c.rev, c.plan.gardens[0].name]), [[7, 'One'], [8, 'Two']]);
  assert.equal(calls[1].plan.__growerFiles.mapimage, initial.plan.__growerFiles.mapimage);
  assert.equal(store.pending, false);
  store.dispose();
});

test('preserve a conflicted draft and every attachment through a restorable farm backup', async () => {
  let attempts = 0;
  const states = [];
  const store = createPlannerStore(initial, async () => {
    attempts++;
    throw Object.assign(Error('Newer revision'), { code: '40001' });
  }, s => states.push(s));
  const edit = await store.load();
  edit.lrfNext.runs.push({ id: 'r2' });
  store.save(edit);
  await assert.rejects(store.flush(), /newer farm/);
  await store.retry();
  assert.equal(attempts, 1);
  assert.equal(store.pending, true);
  assert.equal(states.at(-1).state, 'error');
  assert.match(states.at(-1).label, /view recovery options/);
  const file = backup(store.draft());
  assert.deepEqual(readGrowerBackup(file), { ...initial.plan, lrfNext: edit.lrfNext });
  assert.deepEqual(JSON.parse(file).lrfNextKeep.keep.runs, edit.lrfNext.runs);
  assert.equal(store.recover().revision, 7);
  store.dispose();
});

test('a failed save can be retried without advancing the revision', async () => {
  const revisions = [];
  const store = createPlannerStore(initial, async (_, revision) => {
    revisions.push(revision);
    if (revisions.length === 1) throw Error('Offline');
    return { revision: revision + 1 };
  }, () => {});
  store.save(await store.load());
  await assert.rejects(store.flush());
  assert.ok(store.pending);
  await store.flush();
  assert.deepEqual(revisions, [7, 7]);
  assert.equal(store.pending, false);
  store.dispose();
});
