// The sync Worker's own code served on this computer, with a bucket held in memory: for trying cloud sync and for the
// browser tests, with no Cloudflare account. Nothing is kept once it stops.
//   node tools/sync_dev_server.mjs [port] [passphrase]
// With LRF_SYNC_DEV=1 a test may reach behind the service: POST /__dev { add: seconds to move its clock, key: a new
// passphrase, wipe: true to empty the bucket } answers with the clock's offset and the names of what is stored.
import http from 'node:http';
import worker from '../worker/lrf-plan-sync.js';
import { fakeBucket } from './fake_r2.mjs';

const port = +(process.argv[2] || 8791), key = process.argv[3] || 'dev passphrase';
const { bucket, store } = fakeBucket(), env = { PLAN: bucket, SYNC_KEY: key };
let skew = 0;
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + skew * 1000;

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bodyBytes = Buffer.concat(chunks);
  if (process.env.LRF_SYNC_DEV === '1' && req.url === '/__dev') {
    try { const ask = JSON.parse(bodyBytes.toString() || '{}'); skew += +ask.add || 0; if (typeof ask.key === 'string') env.SYNC_KEY = ask.key; if (ask.wipe) store.clear(); } catch (_) { /* nothing asked */ }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ skew, keys: [...store.keys()].sort() })); return;
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
  const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : bodyBytes });
  const response = await worker.fetch(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, '127.0.0.1', () => console.log(`sync service on http://127.0.0.1:${port}`));
