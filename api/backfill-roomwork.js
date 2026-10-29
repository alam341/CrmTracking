// One-time backfill: isi cs_nama, nama_pembeli, hp_pembeli, produk, kota_tujuan
// untuk room_work yang datanya masih kosong (masuk sebelum fix fetchCsInputOrder).
// GET /api/backfill-roomwork?secret=<CRON_SECRET>
// Proses 100 baris per request — ulangi sampai response bilang done: true.

const { sbFetch }  = require('../lib/supabase-rest');
const { getCsNoWa } = require('../lib/notif-wa');

const CS_SUPABASE_URL = 'https://lqpcnzdssvvcayqvdjxs.supabase.co';
const BATCH = 10;

async function fetchCsInputByResi(resiList, key) {
  if (!resiList.length || !key) return {};
  // Fetch semua sekaligus pakai filter in()
  const filter = resiList.map(r => encodeURIComponent(r)).join(',');
  try {
    const r = await fetch(
      `${CS_SUPABASE_URL}/rest/v1/all_orderan?select=resi,nama,hp,jumlah,cs,kabupaten&resi=in.(${filter})`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!r.ok) return {};
    const rows = await r.json();
    const map = {};
    (rows || []).forEach(row => {
      if (!row.resi) return;
      const resiClean = String(row.resi).replace(/^'+/, '').trim();
      map[resiClean] = {
        ...row,
        nama: (row.nama || '').split('|')[0].trim() || row.nama || '',
      };
    });
    return map;
  } catch { return {}; }
}

module.exports = async function handler(req, res) {
  const key = process.env.CS_INPUT_SERVICE_KEY;
  if (!key) return res.status(500).json({ error: 'CS_INPUT_SERVICE_KEY belum di-set' });

  // Ambil room_work yang masih kosong (cs_nama atau nama_pembeli kosong)
  let rows;
  try {
    rows = await sbFetch(
      `room_work?select=id,resi,cs_nama,nama_pembeli,kota_tujuan` +
      `&or=(cs_nama.is.null,cs_nama.eq.,nama_pembeli.is.null,nama_pembeli.eq.)` +
      `&order=id.asc&limit=100`
    );
  } catch (e) {
    return res.status(500).json({ error: 'Gagal fetch room_work: ' + e.message });
  }

  if (!rows?.length) return res.status(200).json({ done: true, updated: 0 });

  const resiList = rows.map(r => r.resi).filter(Boolean);
  const csMap = await fetchCsInputByResi(resiList, key);

  let updated = 0, failed = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await Promise.all(batch.map(async row => {
      const cs = csMap[row.resi];
      if (!cs) return; // resi tidak ditemukan di CS Input — skip

      const csNama = cs.cs || '';
      const csNoWa = csNama ? await getCsNoWa(csNama).catch(() => null) : null;

      const patch = {
        cs_nama:      csNama,
        cs_no_wa:     csNoWa || '',
        nama_pembeli: cs.nama || '',
        hp_pembeli:   cs.hp   || '',
        produk:       cs.jumlah || '',
        kota_tujuan:  cs.kabupaten || '',
      };

      // Hanya update field yang kosong — jangan timpa yang sudah ada
      if (row.cs_nama)      delete patch.cs_nama;
      if (row.kota_tujuan)  delete patch.kota_tujuan;
      if (!Object.keys(patch).length) return;

      try {
        await sbFetch(`room_work?id=eq.${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        });
        updated++;
      } catch (e) {
        failed++;
      }
    }));
  }

  res.status(200).json({
    done: rows.length < 100,
    processed: rows.length,
    updated,
    failed,
  });
};
