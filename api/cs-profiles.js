// GET /api/cs-profiles
// Fetch semua CS CRM dari tabel team_members di Supabase CRM (service role, bypass RLS)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') { res.status(405).end(); return; }

  const SUPA_URL     = process.env.SUPABASE_URL;
  const SUPA_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPA_URL || !SUPA_SERVICE) {
    res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum di-set di Vercel env vars' });
    return;
  }

  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/team_members?select=id,nama,no_wa,role&order=nama.asc`, {
      headers: {
        apikey: SUPA_SERVICE,
        Authorization: `Bearer ${SUPA_SERVICE}`,
      },
    });
    if (!r.ok) throw new Error(`Supabase error: ${r.status} ${await r.text()}`);
    const data = await r.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
