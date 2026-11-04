// Backfill room_work: isi nama_pembeli, hp_pembeli, produk, cs_nama, kota_tujuan
// yang masih kosong dari crm_orders (terjadi kalau webhook Mengantar fire sebelum
// order di-upload Excel, sehingga crm_orders belum punya data lengkap saat itu).
//
// GET /api/backfill-roomwork          → proses 100 baris kosong per request
// GET /api/backfill-roomwork?mode=all → loop semua sampai done (max 10 iterasi)

const { sbFetch }   = require('../lib/supabase-rest');
const { getCsNoWa } = require('../lib/notif-wa');

const BATCH = 10;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  let totalUpdated  = 0;
  let totalFailed   = 0;
  let totalSkipped  = 0;
  let iterations    = 0;
  const MAX_ITER    = req.query.mode === 'all' ? 10 : 1;

  while (iterations < MAX_ITER) {
    iterations++;

    // 1. Ambil room_work yang masih ada field kosong
    let rwRows;
    try {
      rwRows = await sbFetch(
        `room_work?select=id,resi,cs_nama,cs_no_wa,nama_pembeli,hp_pembeli,produk,kota_tujuan` +
        `&or=(nama_pembeli.is.null,nama_pembeli.eq.,hp_pembeli.is.null,hp_pembeli.eq.,produk.is.null,produk.eq.)` +
        `&order=id.asc&limit=100`
      );
    } catch (e) {
      return res.status(500).json({ error: 'Gagal fetch room_work: ' + e.message });
    }

    if (!rwRows?.length) break;

    // 2. Ambil data lengkap dari crm_orders
    const resiList = rwRows.map(r => r.resi).filter(Boolean);
    const orderMap = {};
    const CHUNK = 100;
    for (let i = 0; i < resiList.length; i += CHUNK) {
      const chunk = resiList.slice(i, i + CHUNK);
      try {
        const orders = await sbFetch(
          `crm_orders?select=id,nama,hp,produk,cs_nama,kota_tujuan` +
          `&id=in.(${chunk.map(r => encodeURIComponent(r)).join(',')})`
        );
        (orders || []).forEach(o => { orderMap[o.id] = o; });
      } catch (_) {}
    }

    // 3. Patch room_work dengan data dari crm_orders
    for (let i = 0; i < rwRows.length; i += BATCH) {
      const batch = rwRows.slice(i, i + BATCH);
      await Promise.all(batch.map(async row => {
        const order = orderMap[row.resi];
        if (!order) { totalSkipped++; return; } // resi belum ada di crm_orders

        // Kalau crm_orders juga masih kosong (webhook create row tapi Excel belum diupload)
        if (!order.nama && !order.hp && !order.produk) { totalSkipped++; return; }

        const patch = {};

        // Hanya isi field yang masih kosong
        if (!row.nama_pembeli && order.nama)      patch.nama_pembeli = order.nama;
        if (!row.hp_pembeli   && order.hp)        patch.hp_pembeli   = order.hp;
        if (!row.produk       && order.produk)    patch.produk       = order.produk;
        if (!row.kota_tujuan  && order.kota_tujuan) patch.kota_tujuan = order.kota_tujuan;

        // cs_nama + cs_no_wa — update kalau kosong
        if (!row.cs_nama && order.cs_nama) {
          patch.cs_nama = order.cs_nama;
          const csNoWa = await getCsNoWa(order.cs_nama).catch(() => null);
          if (csNoWa) patch.cs_no_wa = csNoWa;
        }

        if (!Object.keys(patch).length) { totalSkipped++; return; }

        try {
          await sbFetch(`room_work?id=eq.${row.id}`, {
            method: 'PATCH',
            body:   JSON.stringify(patch),
          });
          totalUpdated++;
        } catch (_) {
          totalFailed++;
        }
      }));
    }

    // Kalau kurang dari 100 artinya sudah habis
    if (rwRows.length < 100) break;
  }

  res.status(200).json({
    done:    true,
    updated: totalUpdated,
    failed:  totalFailed,
    skipped: totalSkipped,
  });
};
