// Akses Supabase REST langsung (bukan JS client) pakai service-role key -- dipakai di
// serverless function (api/*.js) buat bypass RLS. Port dari
// Marketplace-main/api/cron-check-resi.js.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sbFetch(path, options = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum di-set di environment variables');
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.method === 'PATCH' ? { Prefer: 'return=minimal' } : {}),
      ...options.headers,
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  if (options.method === 'PATCH') return null;
  const returnMinimal = String(options.headers?.Prefer || '').includes('return=minimal');
  if (returnMinimal) return null;
  return r.json();
}

module.exports = { sbFetch };
