// Webhook Mengantar — menerima push status order real-time
// POST /api/mengantar-webhook
//
// Setiap kali status order berubah di Mengantar, mereka POST payload ke sini.
// Kita verifikasi HMAC, map status_category → stage kita, update crm_orders.
// Jauh lebih efisien dari polling — update terjadi detik itu juga, bukan nunggu 2 jam.
//
// Docs: https://app.mengantar.com/docs/webhook

const crypto = require('crypto');
const { sbFetch } = require('../lib/supabase-rest');
const { insertRoomWork } = require('../lib/room-work-helper');
const { checkResiAuto } = require('../lib/tracking-router');

// Matikan body parser bawaan Vercel — kita butuh raw body untuk verifikasi HMAC
// (parse ulang JSON → bytes beda → signature tidak cocok)

// ── Stage mapping dari status_category Mengantar ke stage internal ────────────
const STATUS_MAP = {
  'ACTIVE':                 'DIKIRIM',
  'WAITING NEXT PROCESS':   'DIKIRIM',
  'PENDING PICKUP':         'DIKIRIM',
  'PICKED UP':              'DIKIRIM',
  'MANIFESTED':             'DIKIRIM',
  'INBOUND PROCESS':        'DIKIRIM',
  'OUTBOUND PROCESS':       'DIKIRIM',
  'IN TRANSIT':             'DIKIRIM',
  'WITH DELIVERY COURIER':  'OTW',
  'ON DELIVERY':            'OTW',
  'DEL':                    'OTW',
  'OUT FOR DELIVERY':       'OTW',
  'DELIVERED':              'SAMPAI',
  'UNDELIVERED':            'BERMASALAH',
  'PICKUP FAILED':          'BERMASALAH',
  'REJECTED':               'BERMASALAH',
  'RTS':                    'RETUR',
  'RETURN TO SHIPPER':      'RETUR',
  'CANCELED':               'RETUR',
  'CANCELLED':              'RETUR',
  'ERROR':                  'BELUM_DICEK',
};

const STAGE_STEP = {
  MENUNGGU_RESI: 1, BELUM_DICEK: 1, MANUAL: 1,
  DIKIRIM: 2, KOTA_TUJUAN: 3, OTW: 4, SAMPAI: 5,
  BERMASALAH: 2, RETUR: 2,
};

// Normalisasi nama kurir dari Mengantar ke format internal (uppercase konsisten)
const COURIER_NORM = {
  jne: 'JNE', jt: 'J&T', 'j&t': 'J&T', jnt: 'J&T',
  sicepat: 'SICEPAT', anteraja: 'ANTERAJA', ninja: 'NINJA',
  idexpress: 'IDEXPRESS', lion: 'LION', pos: 'POS', spx: 'SPX', sap: 'SAP',
};
function normCourier(c) {
  if (!c) return null;
  return COURIER_NORM[String(c).toLowerCase()] || String(c).toUpperCase();
}

// ── Baca raw body dari stream ─────────────────────────────────────────────────
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // 1. Baca raw body sebelum parse apapun
  const rawBody = await readRawBody(req);

  // 2. Verifikasi HMAC-SHA256 — support 2 akun Mengantar (secret berbeda per akun)
  const secrets = [
    process.env.MENGANTAR_WEBHOOK_SECRET,
    process.env.MENGANTAR_WEBHOOK_SECRET_2,
  ].filter(Boolean);

  const timestamp = req.headers['x-timestamp'] || '';
  const received  = req.headers['x-signature'] || '';

  if (secrets.length > 0) {
    const valid = secrets.some(secret => {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');
      return expected.length === received.length &&
        crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
    });

    if (!valid) {
      console.error('[webhook] Signature tidak valid');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // Tolak request yang terlalu lama (replay attack) — toleransi 5 menit
    if (timestamp && Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) {
      console.error('[webhook] Request kadaluarsa, timestamp:', timestamp);
      res.status(401).json({ error: 'Request expired' });
      return;
    }
  }

  // 3. Parse payload
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  const { cnote_no, order_id, courier, status_category } = payload;

  if (!cnote_no || !status_category) {
    res.status(400).json({ error: 'cnote_no dan status_category wajib ada' });
    return;
  }

  // 4. Map ke stage internal
  const stage = STATUS_MAP[status_category?.toUpperCase?.()] || STATUS_MAP[status_category];
  if (!stage) {
    // Status tidak dikenal — acknowledge saja agar Mengantar tidak retry terus
    console.warn('[webhook] Status tidak dikenal:', status_category, '— diabaikan');
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  const now = new Date().toISOString();

  try {
    // 5. Cek apakah order sudah ada (untuk preserve bermasalah_since + ambil cs_nama)
    let existingRows = [];
    try {
      existingRows = await sbFetch(`crm_orders?select=id,status_resi,status_resi_detail,order_date,cs_nama,kota_tujuan&id=eq.${encodeURIComponent(cnote_no)}`);
    } catch (_) {}
    const existing = existingRows?.[0];

    // 6. Bangun patch
    const patch = {
      id: cnote_no,
      ekspedisi: normCourier(courier),
      status_resi: stage,
      status_resi_step: STAGE_STEP[stage] || 1,
      status_resi_updated_at: now,
    };

    // Kalau jadi BERMASALAH → set bermasalah_since (jangan timpa kalau sudah ada)
    if (stage === 'BERMASALAH') {
      const existingDetail = existing?.status_resi_detail || {};
      const alreadySince = existingDetail.bermasalah_since;
      patch.status_resi_detail = {
        ...existingDetail,
        bermasalah_since: alreadySince || now,
        webhook_status: status_category,
      };
    } else if (stage === 'SAMPAI' || stage === 'RETUR') {
      // Simpan status akhir untuk referensi
      const existingDetail = existing?.status_resi_detail || {};
      patch.status_resi_detail = { ...existingDetail, webhook_status: status_category };
    }

    // 7. Upsert ke crm_orders
    // Kalau paket sudah BERMASALAH, jangan downgrade ke OTW/DIKIRIM/KOTA_TUJUAN
    // (kurir sedang retry — biarkan tetap BERMASALAH sampai benar-benar SAMPAI atau RETUR)
    const wasBemasalah = existing?.status_resi === 'BERMASALAH';
    const isRetryStage = ['OTW', 'DIKIRIM', 'KOTA_TUJUAN'].includes(stage);
    if (wasBemasalah && isRetryStage) {
      // Kurir retry kirim — tetap BERMASALAH tapi increment counter percobaan ulang
      const existingDetail = existing?.status_resi_detail || {};
      const attempts = (existingDetail.redeliver_attempts || 0) + 1;
      await sbFetch(`crm_orders?id=eq.${encodeURIComponent(cnote_no)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status_resi_detail: { ...existingDetail, redeliver_attempts: attempts, last_retry_stage: stage },
          status_resi_updated_at: now,
        }),
      }).catch(e => console.warn('[webhook] Update redeliver_attempts gagal:', e.message));
      console.log(`[webhook] ${cnote_no} retry ke-${attempts} (${stage}) — tetap BERMASALAH`);
      res.status(200).json({ ok: true, resi: cnote_no, stage, retry: attempts });
      return;
    }

    // Pakai upsert — kalau resi belum ada di tabel (baru pertama kali dapat webhook) → insert
    await sbFetch('crm_orders?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(patch),
    });

    console.log(`[webhook] ${cnote_no} → ${stage} (${status_category})`);

    // 7b. Fetch detail tracking dari API kurir — dapat masalah_kategori + records
    // Untuk LION dengan UNDELIVERED: Mengantar push UNDELIVERED saat kurir baru mau antar
    // (false alarm), bukan hanya saat gagal. Yang jadi sinyal gagal beneran adalah kode DEX
    // di history (group === 'UNDELIVERED' di entry history). Kalau tidak ada → bukan gagal.
    let masalahKategori = '';
    let apiStage = null;
    try {
      const { stage: fetchedStage, detail } = await checkResiAuto({ id: cnote_no, ekspedisi: normCourier(courier), kota_tujuan: '' });
      apiStage = fetchedStage || null;
      if (detail) {
        masalahKategori = detail.masalah_kategori || '';
        const existingDetail = existing?.status_resi_detail || {};
        const mergedDetail = {
          ...existingDetail,
          ...detail,
          ...(existingDetail.bermasalah_since ? { bermasalah_since: existingDetail.bermasalah_since } : {}),
          webhook_status: status_category,
        };
        await sbFetch(`crm_orders?id=eq.${encodeURIComponent(cnote_no)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status_resi_detail: mergedDetail,
            status_resi_updated_at: new Date().toISOString(),
          }),
        });
      }
    } catch (e) {
      console.warn('[webhook] Fetch detail gagal (non-fatal):', e.message);
    }

    // 8. Masukkan ke Room Work + kirim FU Info kalau baru jadi BERMASALAH
    // LION: skip room_work kalau API tidak konfirmasi BERMASALAH (tidak ada DEX di history).
    // Koreksi juga status di DB kalau API bilang bukan BERMASALAH (false alarm webhook).
    if (stage === 'BERMASALAH' && existing?.status_resi !== 'BERMASALAH') {
      const isLion = normCourier(courier) === 'LION';
      const isLionFalseAlarm = isLion && !masalahKategori && apiStage && apiStage !== 'BERMASALAH';
      if (isLionFalseAlarm) {
        console.log(`[webhook] ${cnote_no} LION false alarm (webhook: ${status_category}, API: ${apiStage}) — koreksi ke ${apiStage}, skip room_work`);
        await sbFetch(`crm_orders?id=eq.${encodeURIComponent(cnote_no)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status_resi:      apiStage,
            status_resi_step: STAGE_STEP[apiStage] || 2,
          }),
        }).catch(e => console.warn('[webhook] Koreksi LION stage gagal:', e.message));
      } else {
        await insertRoomWork({
          resi:      cnote_no,
          csNama:    existing?.cs_nama     || '',
          kota:      existing?.kota_tujuan || '',
          ekspedisi: normCourier(courier)  || '',
          caseUndel: masalahKategori       || status_category || '',
          orderDate: existing?.order_date  || null,
        }).catch(e => console.error('[room-work] Gagal insert:', e.message));
      }
    }

    // 9. Auto resolve room_work kalau paket SAMPAI (berhasil terkirim setelah sempat bermasalah)
    if (stage === 'SAMPAI') {
      await sbFetch(`room_work?resi=eq.${encodeURIComponent(cnote_no)}&auto_resolved=eq.false&investigasi=eq.false&select=id`)
        .then(rows => {
          if (!rows?.length) return;
          return sbFetch(`room_work?resi=eq.${encodeURIComponent(cnote_no)}`, {
            method: 'PATCH',
            body: JSON.stringify({ auto_resolved: true, auto_resolved_at: now }),
          });
        })
        .catch(e => console.error('[room-work] Auto resolve gagal:', e.message));
    }

    // 10. Auto investigasi kalau paket RETUR dan sudah lapor ekspedisi
    if (stage === 'RETUR') {
      await sbFetch(`room_work?resi=eq.${encodeURIComponent(cnote_no)}&lapor_ekspedisi=eq.true&investigasi=eq.false&select=id`)
        .then(rows => {
          if (!rows?.length) return;
          return sbFetch(`room_work?resi=eq.${encodeURIComponent(cnote_no)}`, {
            method: 'PATCH',
            body: JSON.stringify({ investigasi: true, investigasi_at: now }),
          });
        })
        .catch(e => console.error('[room-work] Auto investigasi gagal:', e.message));
    }

    res.status(200).json({ ok: true, resi: cnote_no, stage });

  } catch (e) {
    console.error('[webhook] Error update DB:', e.message);
    res.status(500).json({ error: e.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
