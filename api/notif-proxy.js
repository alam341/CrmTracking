// api/notif-proxy.js — proxy ke VPS baileys-notif service
// GET  /api/notif-proxy?action=status  → { ready, status }
// GET  /api/notif-proxy?action=qr      → { qr: "data:image/png;base64,..." } atau { connected: true }
// POST /api/notif-proxy?action=send    → { to, message } — kirim WA manual (test / dari browser)

const NOTIF_URL    = process.env.NOTIF_VPS_URL;
const NOTIF_SECRET = process.env.NOTIF_SECRET || 'adsysukses2026';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // Kalau NOTIF_VPS_URL belum di-set → belum dikonfigurasi
  if (!NOTIF_URL) {
    return res.json({ unconfigured: true });
  }

  const action = req.query.action || 'status';

  try {
    if (action === 'status') {
      const r = await fetch(`${NOTIF_URL}/health`);
      const data = await r.json();
      return res.json(data);
    }

    if (action === 'qr') {
      const r = await fetch(`${NOTIF_URL}/qr-data`, {
        headers: { 'x-secret': NOTIF_SECRET },
      });
      const data = await r.json();
      return res.json(data);
    }

    if (action === 'send') {
      if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
      const { to, message } = req.body || {};
      if (!to || !message) { res.status(400).json({ error: 'to dan message wajib diisi' }); return; }
      const r = await fetch(`${NOTIF_URL}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-secret': NOTIF_SECRET },
        body: JSON.stringify({ to, message }),
      });
      const data = await r.json();
      return res.json(data);
    }

    res.status(400).json({ error: 'action tidak dikenal' });
  } catch (e) {
    res.status(503).json({ error: 'Notif service tidak bisa dihubungi: ' + e.message });
  }
};
