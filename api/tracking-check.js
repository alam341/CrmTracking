// Cek manual satu resi (tombol "Cek Ulang" di UI). Browser cuma manggil endpoint ini dan
// render hasilnya -- heuristik stage cuma ada di lib/stage-engine.js (lihat lib/tracking-router.js).
// GET /api/tracking-check?table=crm_orders&id=<resi>

const { sbFetch } = require('../lib/supabase-rest');
const { checkResiAuto } = require('../lib/tracking-router');
const { STAGE_STEP } = require('../lib/stage-engine');

const ALLOWED_TABLES = ['crm_orders'];

function detectEkspedisi(resi) {
  const r = String(resi).trim();
  if (/^MGT\d/i.test(r))        return 'SAP';
  if (/^SPXID/i.test(r))        return 'SPX';
  if (/^26MNG\d+$/i.test(r))    return 'POS';
  if (/^C1[A-Z0-9]{5,8}$/i.test(r)) return 'LION';
  if (/^\d{16}$/.test(r))       return 'JNE';
  if (/^(JO|JJ)\d{10}$/i.test(r)) return 'J&T';
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { table, id } = req.query;
  if (!ALLOWED_TABLES.includes(table)) {
    res.status(400).json({ error: 'table tidak valid' });
    return;
  }
  if (!id) {
    res.status(400).json({ error: 'id (resi) wajib diisi' });
    return;
  }

  try {
    let row = null;

    // 1. Cari di akuisisi_orders dulu
    const rows = await sbFetch(`${table}?select=id,ekspedisi,kota_tujuan&id=eq.${encodeURIComponent(id)}`);
    row = rows && rows[0];

    // 2. Kalau tidak ada, fallback: detect ekspedisi dari format resi
    if (!row) {
      const ekspedisi = detectEkspedisi(id);
      if (!ekspedisi) {
        res.status(404).json({ error: 'Order tidak ditemukan dan ekspedisi tidak bisa dideteksi' });
        return;
      }
      row = { id, ekspedisi, kota_tujuan: '' };
    }

    // 3. Override ekspedisi kalau format resi lebih reliable (misal stored JNE tapi resi SPXID)
    const detectedEksp = detectEkspedisi(id);
    if (detectedEksp && detectedEksp !== row.ekspedisi) {
      row.ekspedisi = detectedEksp;
    }

    if (!row.ekspedisi) {
      res.status(400).json({ error: 'Ekspedisi belum diketahui buat order ini' });
      return;
    }

    const { stage, detail } = await checkResiAuto(row);
    const patch = {
      id,
      ekspedisi:              row.ekspedisi,
      status_resi:            stage,
      status_resi_step:       STAGE_STEP[stage],
      status_resi_updated_at: new Date().toISOString(),
      status_resi_detail:     detail,
    };

    // Upsert — insert kalau belum ada, update kalau sudah ada
    await sbFetch(`${table}?on_conflict=id`, {
      method:  'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body:    JSON.stringify(patch),
    });

    res.status(200).json({ stage, step: STAGE_STEP[stage], detail });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
