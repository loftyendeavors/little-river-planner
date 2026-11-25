import { usernameLogin } from './handler.mjs'

function projectKey(name: string, legacyName: string) {
  const keys = JSON.parse(Deno.env.get(name) || '{}')
  return keys.default || Deno.env.get(legacyName)
}

Deno.serve(request => usernameLogin(request, {
  origin: Deno.env.get('ACCOUNT_SITE_ORIGIN'),
  url: Deno.env.get('SUPABASE_URL'),
  publicKey: projectKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'),
  serverKey: projectKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
}, fetch))
