import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { starter, addField, backup } from '../src/farm.js';
import { usernameLogin } from '../supabase/functions/username-login/handler.mjs';

const db = new PGlite();
const idA = '00000000-0000-4000-8000-000000000001', idB = '00000000-0000-4000-8000-000000000002';
const idPending = '00000000-0000-4000-8000-000000000003';
const schema = await readFile(new URL('../supabase/migrations/202611220001_grower_accounts.sql', import.meta.url), 'utf8');
before(async () => {
  await db.exec(`create role authenticated; create role anon; create role service_role;
    create schema auth; create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    insert into auth.users values ('${idA}','one@example.invalid',now()),('${idB}','two@example.invalid',now()),('${idPending}','pending@example.invalid',null);`);
  await db.exec(schema);
});
after(() => db.close());
async function who(role, id = '') {
  await db.exec('reset role; set role ' + role);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
}
const create = (owner, username, name, plan) => db.query('select * from public.start_grower_farm($1,$2,$3,$4)', [owner, username, name, JSON.stringify(plan)]);
const save = (owner, revision, plan) => db.query('select * from public.save_grower_farm($1,$2,$3)', [owner, revision, JSON.stringify(plan)]);
const denied = error => error.code === '42501';
test('new sample and empty farms belong to the grower and produce independent importable backups', () => {
  const sample = starter('Maple Farm','sample'), empty = starter('Field Farm','empty');
  assert.equal(sample.plantings.length,15);
  assert.equal(empty.plantings.length,0);
  const plan = addField(empty,'North',4,20,3.5);
  assert.equal(empty.gardens.length,0); assert.equal(plan.beds.length,4);
  assert.equal(new Set(plan.beds.map(b=>b.id)).size,4);
  assert.equal(plan.beds[0].l,20); assert.equal(JSON.parse(backup(plan)).settings.farm,'Field Farm');
  assert.ok(!sample.lrfNext.sample); assert.throws(()=>addField(plan,'North',0,20,3.5));
});
test('database enforces owner, verification, retry, username uniqueness, revision and private login lookup', async () => {
  const a = starter('Maple','sample'), b = starter('Field','empty');
  await who('anon');
  await assert.rejects(create(idA,'growera','Maple',a),denied);
  await assert.rejects(db.query('select * from public.grower_farms'),denied);
  await who('authenticated',idPending);
  await assert.rejects(create(idPending,'waiting','Maple',a),denied);
  await who('authenticated',idA);
  await assert.rejects(create(idB,'growera','Maple',a),denied);
  assert.equal((await create(idA,'GrowerA','Maple',a)).rows[0].username,'growera');
  assert.deepEqual((await create(idA,'ignored','Ignored',b)).rows[0].plan,a);
  await who('authenticated',idB);
  assert.deepEqual((await db.query('select * from public.grower_farms')).rows,[]);
  await assert.rejects(create(idB,'GROWERA','Field',b),e=>e.code==='23505');
  await assert.rejects(create(idB,'growerb','Field',{gardens:[],beds:[]}),e=>e.code==='23514');
  assert.equal((await create(idB,'growerb','Field',b)).rows[0].revision,1);
  await assert.rejects(save(idA,1,b),denied);
  await assert.rejects(db.query('update public.grower_farms set name=$1',['changed']),denied);
  await assert.rejects(db.query("select public.grower_login_email('growera')"),denied);
  const edited = addField(b,'South',3,25,4);
  assert.equal((await save(idB,1,edited)).rows[0].revision,2);
  await assert.rejects(save(idB,1,b),e=>e.code==='40001');
  assert.deepEqual((await db.query('select plan from public.grower_farms')).rows[0].plan,edited);
  await who('service_role');
  assert.equal((await db.query("select public.grower_login_email('GrowerA') as email")).rows[0].email,'one@example.invalid');
  await who('authenticated',idA);
  assert.deepEqual((await db.query('select plan from public.grower_farms')).rows[0].plan,a);
});
test('username sign-in delegates the password, restricts origin, and returns only session tokens', async () => {
  const cfg = {origin:'https://grower.example',url:'https://auth.example',publicKey:'test-public',serverKey:'test-server'};
  function req(origin = cfg.origin) { return new Request(cfg.origin,{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({username:'GrowerA',password:'test-password'})}); }
  const sent = [];
  const send = async (url, init) => {sent.push({url,init}); return Response.json(sent.length === 1 ? 'one@example.invalid' : {access_token:'test-a',refresh_token:'test-r',user:{email:'one@example.invalid'}});};
  assert.equal((await usernameLogin(req('https://other.example'),cfg,send)).status,403);
  assert.deepEqual(await (await usernameLogin(req(),cfg,send)).json(),{access_token:'test-a',refresh_token:'test-r'});
  assert.equal(sent.length,2); assert.equal(JSON.parse(sent[0].init.body).password,undefined);
  assert.equal(sent[1].init.headers.apikey,cfg.publicKey);
  for (const email of [null,'one@example.invalid']) {
    let calls = 0;
    const bad = await usernameLogin(req(),cfg,async()=> ++calls === 1 ? Response.json(email) : new Response(null,{status:400}));
    assert.equal(calls,2); assert.equal(bad.status,401);
    assert.deepEqual(await bad.json(),{message:'Check your username and password.'});
  }
  assert.equal((await usernameLogin(req(),cfg,async url => url.includes('/rpc/')?Response.json('one@example.invalid'):new Response(null,{status:429}))).status,429);
});
