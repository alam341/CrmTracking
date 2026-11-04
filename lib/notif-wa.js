// Kirim WA via Fonnte (individual + group)
// getCsNoWa: ambil dari team_members (Supabase CRM) — berbeda dari akuisisitracking yang pakai cs_profiles

/**
 * Normalize nomor WA ke format 628xxx
 * 08xxx → 628xxx, +628xxx → 628xxx, sudah 628xxx → tetap
 * Group JID (@g.us) tidak di-normalize
 */
function normalizeWA(no) {
  if (String(no).includes('@')) return String(no); // group JID, biarkan apa adanya
  let n = String(no || '').replace(/\D/g, '');
  if (n.startsWith('0')) n = '62' + n.slice(1);
  if (!n.startsWith('62')) n = '62' + n;
  return n;
}

/**
 * Kirim WA via Fonnte — support nomor individual & group JID
 */
async function sendWA(to, msg) {
  const token = process.env.FONNTE_TOKEN;
  if (!token) throw new Error('FONNTE_TOKEN tidak di-set');
  const target = normalizeWA(to);
  const r = await fetch('https://api.fonnte.com/send', {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, message: msg, countryCode: '62' }),
  });
  const body = await r.json();
  console.log(`[fonnte] target=${target} status=${r.status} response=${JSON.stringify(body)}`);
  if (!r.ok) {
    throw new Error(`Fonnte error ${r.status}: ${JSON.stringify(body)}`);
  }
  if (body.status === false) {
    throw new Error(`Fonnte rejected: ${body.reason || body.message || JSON.stringify(body)}`);
  }
  return body;
}

/**
 * Ambil no_wa CS dari team_members (Supabase CRM) berdasarkan nama
 * @param {string} csNama
 * @returns {string|null}
 */
async function getCsNoWa(csNama) {
  const url        = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey || !csNama) return null;

  const encoded = encodeURIComponent(csNama);
  const r = await fetch(
    `${url}/rest/v1/team_members?select=no_wa&nama=ilike.${encoded}&aktif=eq.true&limit=1`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
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

/**
 * Kirim notif investigasi ke WA group
 * @param {{ resi: string, ekspedisi: string, caseUndel: string }} order
 */
async function notifInvestigasi({ resi, ekspedisi, caseUndel }) {
  const groupId = process.env.INVESTIGASI_GROUP_ID;
  if (!groupId) {
    console.warn('[notif] INVESTIGASI_GROUP_ID tidak di-set — notif group dilewati');
    return;
  }

  const msg =
    `🔍 *INVESTIGASI PAKET*\n\n` +
    `Resi: *${resi}*\n` +
    `Ekspedisi: ${ekspedisi || '-'}\n` +
    `Case: ${caseUndel || '-'}\n\n` +
    `Paket sudah dilaporkan ke ekspedisi tapi tetap retur.\n` +
    `Tolong ditindaklanjuti!`;

  await sendWA(groupId, msg);
  console.log(`[notif] Notif investigasi terkirim ke group untuk resi ${resi}`);
}

module.exports = { notifBermasalah, notifInvestigasi, sendWA, getCsNoWa };
