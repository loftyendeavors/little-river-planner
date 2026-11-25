// Password checks and session issuance belong to Supabase Auth. Never return the lookup result.
export async function usernameLogin(request, config, send) {
  const cors = {
    'Access-Control-Allow-Origin': config.origin || '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'apikey, content-type',
    'Cache-Control': 'no-store',
    'Vary': 'Origin'
  };
  const reply = (status, message) => Response.json({ message }, { status, headers: cors });
  if (!config.origin || !config.url || !config.publicKey || !config.serverKey) return reply(503, 'Sign-in is unavailable.');
  if (request.headers.get('origin') !== config.origin) return reply(403, 'Origin not allowed.');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return reply(405, 'Use POST.');
  if (!request.headers.get('content-type')?.includes('application/json')) return reply(415, 'Use JSON.');
  const invalid = () => reply(401, 'Check your username and password.');
  const body = await request.json().catch(() => null);
  if (!body || typeof body.username !== 'string' || !/^[a-z][a-z0-9_]{2,29}$/i.test(body.username)
      || typeof body.password !== 'string' || !body.password || body.password.length > 4096) return invalid();
  try {
    const serverHeaders = { apikey: config.serverKey, 'Content-Type': 'application/json' };
    if (!config.serverKey.startsWith('sb_secret_')) serverHeaders.Authorization = 'Bearer ' + config.serverKey;
    const lookup = await send(config.url + '/rest/v1/rpc/grower_login_email', {
      method: 'POST', headers: serverHeaders,
      body: JSON.stringify({ handle: body.username.toLowerCase() })
    });
    if (!lookup.ok) return reply(503, 'Sign-in is temporarily unavailable.');
    const email = await lookup.json();
    // Send unknown names through the same rate-limited password endpoint.
    const session = await send(config.url + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { apikey: config.publicKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email || crypto.randomUUID() + '@invalid.invalid', password: body.password })
    });
    if (session.status === 429) return reply(429, 'Too many attempts. Try again later.');
    if (session.status >= 500) return reply(503, 'Sign-in is temporarily unavailable.');
    if (!session.ok || !email) return invalid();
    const { access_token, refresh_token } = await session.json();
    if (!access_token || !refresh_token) return reply(503, 'Sign-in is temporarily unavailable.');
    return Response.json({ access_token, refresh_token }, { headers: cors });
  } catch {
    return reply(503, 'Sign-in is temporarily unavailable.');
  }
}
