/* Normalize only documented Ecowitt V3 soil fields. Shared with the local reader. */
(function (root) {
  'use strict';
  const channelPattern = /^(soil_ch|soil_moisture_ec_ch)([1-9]|1[0-6])$/;
  const metrics = {soilmoisture:'Soil moisture', ec:'Soil EC', temperature:'Soil temperature'};
  function gatewayName(raw) {
    const name = String(raw || '').trim();
    if (!/^[a-z0-9][a-z0-9 _-]{0,39}$/i.test(name)) throw Error('Give this gateway a stable name of 1 to 40 letters, digits, spaces, dashes or underscores.');
    return name;
  }
  function decimal(raw) {
    if (typeof raw === 'number') return raw;
    return typeof raw === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim()) ? Number(raw) : NaN;
  }
  function unpack(payload, now = Date.now()) {
    if (payload?.code !== 0 || !payload.data || typeof payload.data !== 'object') throw Error('Choose an Ecowitt V3 real-time JSON snapshot with a successful response.');
    const probes = [];
    for (const [key, fields] of Object.entries(payload.data)) {
      const match = channelPattern.exec(key);
      if (!match || !fields || typeof fields !== 'object') continue;
      const extended = match[1] === 'soil_moisture_ec_ch';
      const probe = {key, label:(extended ? 'WH52' : 'Moisture probe')+' · channel '+ match[2], readings:[], missing:[]};
      for (const kind of extended ? Object.keys(metrics) : ['soilmoisture']) {
        const item = fields[kind], seconds = decimal(item?.time), raw = decimal(item?.value);
        const unit = typeof item?.unit === 'string' ? item.unit.trim().normalize('NFKC').replace(/[º°]/g,'').replace(/μ/g,'u').toLowerCase() : '';
        let value = raw, displayUnit;
        if (kind === 'soilmoisture' && unit === '%' && raw >= 0 && raw <= 100) displayUnit = '%';
        if (kind === 'ec' && ['us/cm','ms/cm'].includes(unit) && raw >= 0) {
          value = unit === 'us/cm' ? raw / 1000 : raw;
          if (value <= 10) displayUnit = 'mS/cm';
        }
        if (kind === 'temperature' && ['f','c','of','oc'].includes(unit)) {
          value = unit.endsWith('c') ? raw * 9 / 5 + 32 : raw;
          if (value >= -40 && value <= 140) displayUnit = '°F';
        }
        if (!displayUnit || !Number.isFinite(value) || !Number.isSafeInteger(seconds) || seconds <= 0 || seconds * 1000 > now + 60000) {
          probe.missing.push(metrics[kind]); continue;
        }
        probe.readings.push({kind, value:Number(value.toFixed(6)), unit:displayUnit, at:new Date(seconds * 1000).toISOString()});
      }
      probes.push(probe);
    }
    if (!probes.length) throw Error('No supported soil channels were found in this snapshot.');
    return probes;
  }
  function readFile(payload, now = Date.now()) {
    if (payload?.format !== 'ecowitt-soil-day-v1') return unpack(payload,now);
    gatewayName(payload.gateway);
    if (!Array.isArray(payload.snapshots) || !payload.snapshots.length || payload.snapshots.length>150) throw Error('This daily archive is empty or too large.');
    const channels = new Map();
    for (const snapshot of payload.snapshots) {
      for (const probe of unpack(snapshot,now)) {
        if (!channels.has(probe.key)) channels.set(probe.key,{...probe,readings:[],missing:[]});
        const joined = channels.get(probe.key);
        joined.readings.push(...probe.readings);
        joined.missing = probe.missing;
      }
    }
    const all=[...channels.values()];
    const date=payload.date || all.flatMap(p=>p.readings.map(r=>r.at.slice(0,10))).sort().at(-1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw Error('The archive needs a UTC capture date.');
    for (const p of all) {
      const seen=new Map(), summary={};
      p.readings.sort((a,b)=>b.at.localeCompare(a.at));
      for (const r of p.readings) {
        if (r.at.slice(0,10)!==date) continue;
        const key=r.kind+' '+r.at;
        if (seen.has(key)) {
          if (seen.get(key)!==r.value) throw Error('Two different values share one sensor timestamp. Check the source archive.');
          continue;
        }
        seen.set(key,r.value);
        // Per metric: smallest, largest, latest, latest sensor epoch, count of distinct timestamps.
        const a=summary[r.kind] ||= [r.value,r.value,r.value,Date.parse(r.at)/1000,0];
        a[0]=Math.min(a[0],r.value); a[1]=Math.max(a[1],r.value); a[4]++;
      }
      p.missing=Object.keys(metrics).filter(k=>(k==='soilmoisture' || p.key.startsWith('soil_moisture_ec_')) && !summary[k]).map(k=>metrics[k]);
      p.day={date,summary};
      p.readings=p.readings.filter((r,i,all)=>all.findIndex(other=>other.kind===r.kind)===i);
    }
    return all;
  }
  function identity(gateway, channel, r) {
    return JSON.stringify([gatewayName(gateway).toLowerCase(),channel,r.kind,r.at]);
  }
  function candidates(existing, gateway, probe, gardenId) {
    const name = gatewayName(gateway), saved = new Map();
    if (!gardenId) throw Error('Choose the garden where this probe was installed.');
    for (const row of existing) {
      const key = identity(row.gateway,row.channel,row);
      if (!saved.has(key)) saved.set(key,[]);
      saved.get(key).push(row);
    }
    const result = [];
    for (const r of probe.readings) {
      const known = saved.get(identity(name,probe.key,r)) || [];
      if (known.some(v=>v.value !== r.value || v.gardenId !== gardenId)) throw Error('A reading at this time has a different value or garden. Check the gateway and placement in reading history.');
      if (known.length) continue;
      // Diverging offline assignments survive a merge as separate evidence.
      const id = JSON.stringify(['soil',identity(name,probe.key,r),gardenId,r.value]);
      const row = {...r,gardenId,gateway:name,channel:probe.key,id};
      saved.set(identity(name,probe.key,r),[row]);
      result.push(row);
    }
    return result;
  }
  function dayRecord(existing,gateway,probe,gardenId) {
    const name=gatewayName(gateway), {date,summary}=probe.day;
    if (!gardenId || !Object.keys(summary).length) throw Error('This channel has no timestamped observations on that UTC day.');
    const fingerprint=Object.keys(metrics).map(kind=>summary[kind] || []);
    const id=JSON.stringify(['day',name.toLowerCase(),probe.key,date,gardenId,...fingerprint]);
    const same=existing.filter(r=>r.gateway.toLowerCase()===name.toLowerCase() && r.channel===probe.key && r.date===date);
    if (same.some(r=>r.id!==id)) throw Error('A different summary already exists for this gateway, channel and day. Review the saved day and its garden.');
    if (same.length) throw Error('This daily summary is already saved.');
    return {id,gardenId,gateway:name,channel:probe.key,date,summary};
  }
  function station(controller, stationNumber) {
    const clock = String(controller || '').trim(), slot = String(stationNumber ?? '').trim();
    if (!clock && !slot) return {};
    if (!clock || clock.length > 60 || !/^[1-9]\d?$/.test(slot)) throw Error('Enter the controller name and its numbered station together.');
    return {controller:clock,station:Number(slot)};
  }
  function measured(raw, unit) {
    const value = decimal(raw);
    if (!Number.isFinite(value) || value < 0 || !['US gal','L'].includes(unit)) throw Error('Enter the measured volume for this run in US gallons or litres.');
    return unit === 'L' ? value / 3.785411784 : value;
  }
  const api = {unpack, readFile, dayRecord, gatewayName, identity, candidates, station, measured, metrics};
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LRFEquipment = api;
})(typeof window === 'object' ? window : globalThis);
