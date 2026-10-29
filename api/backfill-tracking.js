// Backfill tracking: bulk insert resi CS Input ke akuisisi_orders sebagai BELUM_DICEK
// GET /api/backfill-tracking?offset=0
// Tidak call API kurir — cuma DB insert, sangat cepat.
// Setelah selesai, jalankan Sync Resi untuk update status aktual.

const { sbFetch }     = require('../lib/supabase-rest');
const CS_SUPABASE_URL = 'https://lqpcnzdssvvcayqvdjxs.supabase.co';
const ROWS_PER_RUN    = 500;
const DAYS_BACK       = 60;

function cutoffDate() {
  const d = new Date();
  d.setDate(d.getDate() - DAYS_BACK);
  return d.toISOString().slice(0, 10);
}

function extractEkspedisi(pembayaran, resi) {
  // Deteksi dari format resi (lebih reliable dari field pembayaran)
  if (resi) {
    const r = String(resi).trim();
    if (/^MGT\d/i.test(r)) return 'SAP';
    if (/^SPXID/i.test(r)) return 'SPX';
    if (/^26MNG\d+$/i.test(r)) return 'POS';
    if (/^C1[A-Z0-9]{5,8}$/i.test(r)) return 'LION';  // C1XXXXXX = LION
    if (/^\d{16}$/.test(r)) return 'JNE';              // 16 digit = JNE
    if (/^(JO|JJ)\d{10}$/i.test(r)) return 'J&T';     // JO/JJ + 10 digit
  }
  if (!pembayaran) return '';
  const p = pembayaran.toUpperCase();
  const map = [
    ['SPX','SPX'],['SICEPAT','SICEPAT'],['ANTERAJA','ANTERAJA'],
    ['IDEXPRESS','IDEXPRESS'],['NINJA','NINJA'],['LION','LION'],
    ['J&T','J&T'],['JNT','J&T'],['JNE','JNE'],['POS','POS'],['SAP','SAP'],
  ];
  for (const [k, v] of map) if (p.includes(k)) return v;
  return '';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.CS_INPUT_SERVICE_KEY;
  if (!key) return res.status(500).json({ error: 'CS_INPUT_SERVICE_KEY belum di-set' });

  const cutoff   = req.query.from || cutoffDate();
  const dateTo   = req.query.to   || null;
  const offset   = parseInt(req.query.offset || '0');

  // 1. Fetch batch dari CS Input
  let csRows;
  try {
    const r = await fetch(
      `${CS_SUPABASE_URL}/rest/v1/all_orderan` +
      `?select=resi,pembayaran,tanggal` +
      `&sumber=eq.cs_input` +
      `&tanggal=gte.${cutoff}` +
      (dateTo ? `&tanggal=lte.${dateTo}` : '') +
      `&resi=not.is.null` +
      `&order=id.asc` +
      `&limit=${ROWS_PER_RUN}&offset=${offset}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!r.ok) throw new Error('CS Input fetch gagal: ' + r.status);
    csRows = await r.json();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const hasMore = csRows.length === ROWS_PER_RUN;

  if (!csRows.length) {
    return res.status(200).json({ done: true, inserted: 0, skipped: 0, offset, hasMore: false });
  }

  // 2. Map ke rows valid dengan ekspedisi dikenal
  const eligible = csRows
    .map(r => {
      const id = String(r.resi || '').replace(/^'+/, '').trim();
      return { id, ekspedisi: extractEkspedisi(r.pembayaran, id), order_date: r.tanggal || null };
    })
    .filter(r => r.id && !r.id.startsWith('IMP-') && r.ekspedisi);

  if (!eligible.length) {
    return res.status(200).json({ done: !hasMore, inserted: 0, skipped: csRows.length, offset: offset + ROWS_PER_RUN, hasMore });
  }

  // 3. Cek mana yang belum ada di akuisisi_orders
  const resiIds = eligible.map(r => r.id);
  let existingMap = {};
  try {
    const existing = await sbFetch(
      `akuisisi_orders?select=id&id=in.(${resiIds.map(encodeURIComponent).join(',')})`
    );
    (existing || []).forEach(r => { existingMap[r.id] = true; });
  } catch (_) {}

  const toInsert  = eligible.filter(r => !existingMap[r.id]);
  const toUpdate  = eligible.filter(r =>  existingMap[r.id]);

  // 4a. Insert baru sebagai BELUM_DICEK
  if (toInsert.length) {
    const records = toInsert.map(r => ({
      id:               r.id,
      ekspedisi:        r.ekspedisi,
      order_date:       r.order_date,
      status_resi:      'BELUM_DICEK',
      status_resi_step: 1,
    }));
    try {
      await sbFetch('akuisisi_orders?on_conflict=id', {
        method:  'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body:    JSON.stringify(records),
      });
    } catch (e) {
      return res.status(500).json({ error: 'Gagal insert: ' + e.message });
    }
  }

  // 4b. Update order_date saja untuk baris yang sudah ada (tidak overwrite status_resi)
  if (toUpdate.length) {
    await Promise.all(toUpdate.map(r =>
      sbFetch(`akuisisi_orders?id=eq.${encodeURIComponent(r.id)}`, {
        method: 'PATCH',
        body:   JSON.stringify({ order_date: r.order_date }),
      }).catch(() => {})
    ));
  }

  return res.status(200).json({
    done:     !hasMore,
    inserted: toInsert.length,
    updated:  toUpdate.length,
    offset:   offset + ROWS_PER_RUN,
    hasMore,
  });
};
