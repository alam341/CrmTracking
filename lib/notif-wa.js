// Kirim WA via baileys-notif VPS
// Dipanggil dari mengantar-webhook.js saat paket jadi BERMASALAH

const NOTIF_URL    = process.env.NOTIF_VPS_URL  || 'http://13.140.178.4:3002';
const NOTIF_SECRET = process.env.NOTIF_SECRET   || 'adsysukses2026';

const CRM_SUPABASE_URL     = process.env.SUPABASE_URL;
const CRM_SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Kirim WA ke satu nomor via baileys-notif VPS
 * @param {string} to   - nomor WA (format: 628xxx)
 * @param {string} msg  - isi pesan
 */
async function sendWA(to, msg) {
  const r = await fetch(`${NOTIF_URL}/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-secret': NOTIF_SECRET,
    },
    body: JSON.stringify({ to, message: msg }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`baileys-notif error ${r.status}: ${txt}`);
  }
  return await r.json();
}

/**
 * Ambil no_wa CS dari team_members (Supabase CRM) berdasarkan nama
 * @param {string} csNama
 * @returns {string|null}
 */
async function getCsNoWa(csNama) {
  if (!CRM_SUPABASE_URL || !CRM_SUPABASE_SERVICE || !csNama) return null;

  const encoded = encodeURIComponent(csNama);
  const r = await fetch(
    `${CRM_SUPABASE_URL}/rest/v1/team_members?select=no_wa&nama=ilike.${encoded}&aktif=eq.true&limit=1`,
    {
      headers: {
        apikey: CRM_SUPABASE_SERVICE,
        Authorization: `Bearer ${CRM_SUPABASE_SERVICE}`,
      },
    }
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return rows?.[0]?.no_wa || null;
}

/**
 * Notif WA ke CS kalau paket bermasalah
 * @param {{ resi: string, csNama: string, kota: string, ekspedisi: string }} order
 */
async function notifBermasalah({ resi, csNama, kota, ekspedisi }) {
  const noWa = await getCsNoWa(csNama);
  if (!noWa) {
    console.warn(`[notif] CS "${csNama}" tidak ditemukan atau no_wa kosong — notif dilewati`);
    return;
  }

  const msg =
    `⚠️ *Paket Bermasalah*\n\n` +
    `Halo ${csNama}, ada paket kamu yang bermasalah:\n\n` +
    `📦 Resi: *${resi}*\n` +
    `🚚 Ekspedisi: ${ekspedisi || '-'}\n` +
    `📍 Kota Tujuan: ${kota || '-'}\n\n` +
    `Segera follow up ke kurir ya! 🙏`;

  await sendWA(noWa, msg);
  console.log(`[notif] WA terkirim ke CS "${csNama}" (${noWa}) untuk resi ${resi}`);
}

module.exports = { notifBermasalah, sendWA, getCsNoWa };
