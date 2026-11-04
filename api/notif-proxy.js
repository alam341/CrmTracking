// api/notif-proxy.js — cek status Fonnte token
// GET /api/notif-proxy?action=status → { configured: bool, token_prefix: string }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const token = process.env.FONNTE_TOKEN;

  if (!token) {
    return res.json({ configured: false });
  }

  // Tampilkan 4 karakter awal token sebagai preview (jangan expose full token)
  const tokenPreview = token.slice(0, 4) + '****';
  return res.json({ configured: true, token_preview: tokenPreview });
};
