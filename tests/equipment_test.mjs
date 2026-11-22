import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import E from '../js/equipment.js';
import W from '../js/waterfeed.js';
import {reader,serverFor,archiveSoil} from '../tools/equipment-reader.mjs';

const now=1800000000000, tick=now/1000-10;
const item=(value,unit,time=tick)=>({value,unit,time});
const raw={code:0,time:now/1000,data:{
  soil_moisture_ec_ch1:{soilmoisture:item('0','%'),ec:item(1450,'μS/cm',tick-1500),temperature:item(10,'℃'),ad:item(90,'')},
  soil_ch2:{soilmoisture:item(43,'%'),ec:item(50,'µS/cm')},soil_ch17:{soilmoisture:item(99,'%')},rainfall:{daily:item(1,'in')}
}};
const samples=E.unpack(raw,now);
test('channel types and units retain source times, true zero, and ignore raw AD and rain',()=>{
  assert.deepEqual(samples.map(p=>p.key),['soil_moisture_ec_ch1','soil_ch2']);
  assert.deepEqual(samples[0].readings.map(r=>[r.kind,r.value,r.unit]),[['soilmoisture',0,'%'],['ec',1.45,'mS/cm'],['temperature',50,'°F']]);
  assert.equal(Date.parse(samples[0].readings[1].at),(tick-1500)*1000);
  assert.equal(samples[1].readings.length,1);
});
test('unsupported units, missing/future timestamps, sensor sentinel and empty data remain unknown',()=>{
  const source={code:0,data:{soil_moisture_ec_ch1:{soilmoisture:item(50,'%',tick+700),ec:item(1,'ppm'),temperature:item(999,'°C')}}};
  assert.equal(E.unpack(source,now)[0].missing.length,3);
  for(const bad of [{code:1,data:{}},{code:0,data:{wind:{}}}]) assert.throws(()=>E.unpack(bad));
});
test('same reading in different snapshots is idempotent and requires the same placement or explicit correction',()=>{
  const first=E.candidates([],'Clock house',samples[0],'garden-a');
  assert.equal(first.length,3);
  assert.deepEqual(E.candidates(first,'CLOCK HOUSE',samples[0],'garden-a'),[]);
  assert.throws(()=>E.candidates(first,'Clock house',samples[0],'garden-b'));
  assert.equal(E.candidates(first,'Second gateway',samples[0],'garden-b').length,3);
  const other=structuredClone(samples[0]); other.readings[0].value=13;
  assert.throws(()=>E.candidates(first,'Clock house',other,'garden-a'));
});
test('meter values distinguish volumes from rates, legacy zones from new mappings, and protect physical run count',()=>{
  assert.deepEqual(E.station('',''),{});
  assert.deepEqual(E.station('Clock A','1'),{controller:'Clock A',station:1});
  assert.throws(()=>E.station('Clock A','')); assert.throws(()=>E.measured(-1,'L')); assert.throws(()=>E.measured(1,'GPM'));
  assert.equal(E.measured(3.785411784,'L'),1);assert.equal(E.measured(0,'US gal'),0);
  const run={id:'1',job:'single',at:'2026-10-01',entered:'2026-10-01',kind:'run',elapsed:8,status:'Completed',meter:null,rate:2,controller:'One',station:1};
  const meter={...run,id:'2',source:'Hunter flow report',meter:12}, reports={'1':run,'2':meter};
  const summary=W.runSummary(W.groups({reports},'run'));
  assert.deepEqual([summary.started,summary.minutes,summary.metered,summary.estimated],[1,8,12,null]);
  assert.ok(W.groups({reports:{...reports,'3':{...meter,id:'3',controller:'Two'}}},'run')[0].meterConflict);
});
const env={ECOWITT_APPLICATION_KEY:'synthetic-app',ECOWITT_API_KEY:'synthetic-key',ECOWITT_MAC:'00:00:00:00:00:00',ECOWITT_GATEWAY:'Trial'};
test('cloud adapter sends only to documented endpoint, returns soil-only data and enforces cooldown',async()=>{
  let url, options, calls=0;
  const capture=reader(env,async(u,o)=>{url=u;options=o;calls++;return Response.json(raw);},()=>now);
  const out=await capture();
  assert.equal(url.origin+url.pathname,'https://api.ecowitt.net/api/v3/device/real_time');assert.equal(url.searchParams.get('api_key'),env.ECOWITT_API_KEY);
  assert.equal(options.redirect,'error');assert.equal(out.gateway,'Trial');assert.deepEqual(Object.keys(out.data),['soil_moisture_ec_ch1','soil_ch2']);
  assert.doesNotMatch(JSON.stringify(out),/synthetic|rainfall|ad"/);
  await assert.rejects(capture(),/Wait/);assert.equal(calls,1);
});
test('provider errors, invalid credentials and network failures leave secrets out of error text',async()=>{
  await assert.rejects(reader({},()=>{throw Error('should not fetch');})(),/Set the Ecowitt/);
  await assert.rejects(reader(env,()=>{throw Error(env.ECOWITT_API_KEY);})(),/Could not read Ecowitt/);
  await assert.rejects(reader(env,()=>Response.json({code:40012,msg:env.ECOWITT_API_KEY}))(),/did not return/);
  let when=now,calls=0;const limited=reader(env,()=>{calls++;return new Response('',{status:429});},()=>when);
  await assert.rejects(limited(),/limited/);when+=3000;await assert.rejects(limited(),/Wait/);assert.equal(calls,1);
});
test('daily archive round trips partial updates once, preserves both times, and leaves corrupt source in place',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'soil-day-'));
  try {
    const snap={...raw,gateway:'Trial'};
    for(const v of [snap,snap]) await archiveSoil(folder,v,new Date(now));
    const change=structuredClone(snap);change.data.soil_moisture_ec_ch1.soilmoisture=item(6,'%',tick+1);
    await archiveSoil(folder,change,new Date(now));
    const [name]=await readdir(folder), file=join(folder,name), day=JSON.parse(await readFile(file,'utf8'));
    assert.equal(day.snapshots.length,2);const channel=E.readFile(day,now)[0], row=E.dayRecord([],'Trial',channel,'garden-a');
    assert.deepEqual(row.summary.soilmoisture,[0,6,6,tick+1,2]);
    assert.equal(row.summary.ec[4],1);assert.equal(channel.readings.length,3);
    assert.throws(()=>E.dayRecord([row],'Trial',channel,'garden-a'),/already saved/);
    const {writeFile}=await import('node:fs/promises');await writeFile(file,'bad');await assert.rejects(archiveSoil(folder,snap,new Date(now)),/left in place/);assert.equal(await readFile(file,'utf8'),'bad');
  } finally {await rm(folder,{recursive:true});}
});
test('loopback reader requires the local origin, fixed host, JSON and explicit POST',async()=>{
  let reads=0;const host='127.0.0.1:8741', server=serverFor('<title>Planner</title>',async()=>{reads++;return {code:0};});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  const send=(path,method,headers)=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path,method,headers},res=>{res.resume();resolve(res.statusCode);});
    req.on('error',reject);req.end();
  });
  try {
    const headers={host,origin:'http://'+host,'content-type':'application/json','x-lrf-reader':'1'};
    assert.equal(await send('/','GET',{host}),200);
    for(const patch of [{origin:'https://example.invalid'},{host:'elsewhere.invalid'},{'x-lrf-reader':'0'}]) assert.equal(await send('/equipment-api/soil','POST',{...headers,...patch}),403);
    assert.equal(await send('/equipment-api/soil','GET',headers),403);
    assert.equal(await send('/equipment-api/soil','POST',headers),200);assert.equal(reads,1);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
test('offline duplicate station and start under different zones hold all volume until the extra run is taken back',()=>{
  const r={id:'a',job:'one',zoneId:'z1',gardenId:'g1',kind:'run',status:'Completed',elapsed:5,meter:8,at:'2026-11-21T10:00:00Z',entered:'2026-11-21',controller:'East',station:1};
  const b={...r,id:'b',job:'two',zoneId:'z2',gardenId:'g2'};
  const reports={a:r,b};const both=W.runSummary(W.groups({reports},'run'));
  assert.deepEqual([both.minutes,both.metered,both.reviews.length],[0,null,2]);
  assert.equal(W.runSummary(W.groups({reports,cancelled:{two:true}},'run')).metered,8);
  assert.equal(W.sameRunEvidence(r,{...r,station:2}),false);
});

test('readings arriving after midnight extend the correct sensor day',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'soil-midnight-'));
  const seconds=value=>Date.parse(value)/1000;
  const sample=(m,v)=>({code:0,gateway:'Trial',data:{soil_ch1:{soilmoisture:item(v,'%',seconds(m))}}});
  try {
    await archiveSoil(folder,sample('2026-11-20T23:45Z',48),new Date('2026-11-20T23:46Z'));
    await archiveSoil(folder,sample('2026-11-20T23:59Z',87),new Date('2026-11-21T00:02Z'));
    await archiveSoil(folder,sample('2026-11-21T00:15Z',49),new Date('2026-11-21T00:16Z'));
    const names=(await readdir(folder)).sort();assert.equal(names.length,2);
    const daily=E.readFile(JSON.parse(await readFile(join(folder,names[0]))),now)[0].day;
    assert.deepEqual(daily.summary.soilmoisture,[48,87,87,seconds('2026-11-20T23:59Z'),2]);
  } finally {await rm(folder,{recursive:true});}
});
