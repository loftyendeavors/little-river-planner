// Run beside the portable planner. No npm packages are required.
import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const port = 8741;
export function reader(env, request = fetch, clock = Date.now) {
  let next = 0;
  return async function capture() {
    const { ECOWITT_APPLICATION_KEY: app, ECOWITT_API_KEY: key, ECOWITT_MAC: mac, ECOWITT_GATEWAY: alias } = env;
    if (!app || !key || !mac || !/^[a-z0-9][a-z0-9 _-]{0,39}$/i.test(alias || '')) throw Error('Set the Ecowitt keys, gateway MAC and gateway name in equipment.env, then restart the reader.');
    if (clock() < next) throw Error('Wait before reading this gateway again.');
    next = clock() + 2000;
    const url = new URL('https://api.ecowitt.net/api/v3/device/real_time');
    url.search = new URLSearchParams({application_key:app, api_key:key, mac, call_back:'all'}).toString();
    let response, body;
    try {
      response = await request(url, {redirect:'error', signal:AbortSignal.timeout(12000)});
      if (response.ok) body = await response.json();
    } catch { throw Error('Could not read Ecowitt. Check your network and try again.'); }
    if (response.status === 429) {
      const delay = Number(response.headers?.get('retry-after'));
      next = clock() + Math.max(60, Number.isFinite(delay) ? Math.min(86400, delay) : 60) * 1000;
      throw Error('Ecowitt limited requests. Wait at least a minute before trying again.');
    }
    if (!response.ok || body?.code !== 0) throw Error('Ecowitt did not return a successful reading. Check gateway upload, credentials and device access.');
    const data = {};
    for (const [channel, fields] of Object.entries(body.data || {})) {
      if (!/^(?:soil_ch|soil_moisture_ec_ch)(?:[1-9]|1[0-6])$/.test(channel)) continue;
      data[channel] = {};
      for (const metric of ['soilmoisture','temperature','ec']) {
        const item = fields?.[metric];
        if (!item || !['number','string'].includes(typeof item.value) || !['number','string'].includes(typeof item.time) || typeof item.unit !== 'string') continue;
        data[channel][metric] = {value:item.value,unit:item.unit,time:item.time};
      }
    }
    if (!Object.keys(data).length) throw Error('Ecowitt returned no soil channels. Check probe pairing, gateway firmware and cloud upload.');
    return {code:0,gateway:alias,data};
  };
}

export async function archiveSoil(folder, snapshot, at = new Date()) {
  const gateway=snapshot.gateway;
  if (!/^[a-z0-9][a-z0-9 _-]{0,39}$/i.test(gateway || '')) throw Error('Invalid gateway name.');
  const days=new Map();
  for (const [channel,fields] of Object.entries(snapshot.data)) {
    if (!/^(?:soil_ch|soil_moisture_ec_ch)(?:[1-9]|1[0-6])$/.test(channel)) continue;
    for (const kind of ['soilmoisture','temperature','ec']) {
      const item=fields[kind], seconds=Number(item?.time);
      if (!Number.isSafeInteger(seconds) || seconds<=0 || seconds*1000>at.getTime()+60000) continue;
      const day=new Date(seconds*1000).toISOString().slice(0,10);
      if (!days.has(day)) days.set(day,{});
      const data=days.get(day);
      (data[channel] ||= {})[kind]=item;
    }
  }
  if (!days.size) throw Error('No timestamped soil readings to archive.');
  for (const [day,data] of days) await appendDay(folder,gateway,day,data);
}

async function appendDay(folder,gateway,date,data) {
  // Distinct configured aliases (including spaces, underscores and dashes) get separate files.
  const file = resolve(folder, encodeURIComponent(gateway.toLowerCase())+'-'+date+'.json');
  await mkdir(folder,{recursive:true,mode:0o700});
  let archive;
  try { archive=JSON.parse(await readFile(file,'utf8')); }
  catch (error) {
    if (error.code!=='ENOENT') throw Error('Could not read the existing archive. It was left in place.');
    archive={format:'ecowitt-soil-day-v1',gateway,date,snapshots:[]};
  }
  if (archive.format!=='ecowitt-soil-day-v1' || archive.gateway.toLowerCase()!==gateway.toLowerCase() || !Array.isArray(archive.snapshots)) throw Error('Unexpected archive format.');
  const known=new Set();
  const signature=(ch,k,x)=>JSON.stringify([ch,k,String(x.time),String(x.value),x.unit]);
  for (const entry of archive.snapshots) {
    for (const [ch,fields] of Object.entries(entry.data)) for (const [kind,item] of Object.entries(fields)) known.add(signature(ch,kind,item));
  }
  const fresh={};
  for (const [ch,fields] of Object.entries(data)) {
    for (const [kind,item] of Object.entries(fields)) if (!known.has(signature(ch,kind,item))) (fresh[ch] ||= {})[kind]=item;
  }
  if (!Object.keys(fresh).length) return;
  const entry={code:0,data:fresh};
  if (archive.snapshots.length>=150) throw Error('Daily archive is full.');
  archive.snapshots.push(entry);
  const temp=file+'.tmp';
  await writeFile(temp,JSON.stringify(archive),{mode:0o600});
  await rename(temp,file);
}

function startArchive(minutes,folder,capture) {
  let timer, stopped=false;
  const tick=async()=>{
    try { await archiveSoil(folder,await capture()); }
    catch (error) { console.error('Archive sample missed. '+(error.code?'Check the archive folder.':error.message)); }
    if (!stopped) timer=setTimeout(tick,minutes*60000);
  };
  tick();
  return ()=>{stopped=true;clearTimeout(timer);};
}

export function serverFor(planner, capture, listenPort = port) {
  const host = '127.0.0.1:' + listenPort;
  return http.createServer(async (req,res) => {
    const send = (status,type,body) => { res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY'}); res.end(body); };
    if (req.headers.host !== host) return send(403,'text/plain','Local access only.');
    if (req.url === '/' && req.method === 'GET') return send(200,'text/html; charset=utf-8',planner);
    if (req.url !== '/equipment-api/soil') return send(404,'text/plain','Unknown page.');
    if (req.method !== 'POST' || req.headers.origin !== 'http://'+host || req.headers['content-type'] !== 'application/json' || req.headers['x-lrf-reader'] !== '1') return send(403,'text/plain','Open the local planner to request a reading.');
    try { send(200,'application/json',JSON.stringify(await capture())); }
    catch (error) { send(503,'application/json',JSON.stringify({error:error.message})); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const planner = await readFile(new URL('./Planner.html',import.meta.url));
    const minutes=Number(process.env.ECOWITT_ARCHIVE_MINUTES || 0);
    if (minutes!==0 && (!Number.isInteger(minutes) || minutes<15 || minutes>1440)) throw Error('Set ECOWITT_ARCHIVE_MINUTES to 0 or a whole number from 15 to 1440.');
    const capture=reader(process.env), server=serverFor(planner,capture);
    server.on('error',()=>{console.error('Could not open port 8741. Close any earlier reader and start again.');process.exitCode=1;});
    server.listen(port,'127.0.0.1',()=>{
      console.log('Open http://127.0.0.1:8741/ in your browser. Keep this window open for live Ecowitt readings.');
      if (minutes) {
        const stop=startArchive(minutes,fileURLToPath(new URL('./soil-archive/',import.meta.url)),capture);
        server.once('close',stop);
        console.log('Collecting a private soil archive every '+minutes+' minutes while this reader is running.');
      }
    });
  } catch (error) { console.error(error.code?'Keep equipment-reader.mjs next to Planner.html.':error.message);process.exitCode=1; }
}
