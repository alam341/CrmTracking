// Endpoint buat di-hit cron eksternal (cron-job.org dkk) tiap beberapa jam -- Vercel Hobby
// plan cuma dukung cron native 1x/hari. Auth via header "Authorization: Bearer <CRON_SECRET>"
// ATAU query "?secret=<CRON_SECRET>".
//
// Setiap run: ambil ≤100 resi akuisisi yang belum SAMPAI/RETUR (urut dari paling lama dicek),
// query kurir, update crm_orders.
// - Baru jadi BERMASALAH  → insertRoomWork() + kirim FU Info (sama seperti webhook Mengantar)
// - Baru jadi RETUR       → auto investigasi room_work kalau lapor_ekspedisi sudah true
// - Resi > 60 hari & masih aktif → di-skip cron (bisa tetap cek manual)

const { sbFetch }         = require('../lib/supabase-rest');
const { checkResiAuto, AUTO_EKSPEDISI_LIST } = require('../lib/tracking-router');
const { STAGE_STEP }      = require('../lib/stage-engine');
const { insertRoomWork }  = require('../lib/room-work-helper');

const ROWS_PER_RUN   = 100;
const BATCH          = 5;
const STALE_DAYS     = 60;

function cutoffDate() {
  const d = new Date();
  d.setDate(d.getDate() - STALE_DAYS);
  return d.toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  // ── Auth ──────────────────────────────────────────────────────────────────────
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.query.secret;
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const cutoff          = cutoffDate();
  const ekspedisiFilter = AUTO_EKSPEDISI_LIST.map(e => encodeURIComponent(e)).join(',');
  let checked = 0, updated = 0, failed = 0, roomWorkAdded = 0;
  const errors = [];

  // ── Fetch resi aktif ──────────────────────────────────────────────────────────
  // Urut status_resi_updated_at ASC nullsfirst → resi yang paling lama dicek duluan,
  // bukan by id (kalau by id, tiap run balik ke resi yang sama terus — starvation).
  let rows;
  try {
    rows = await sbFetch(
      `crm_orders` +
      `?select=id,ekspedisi,kota_tujuan,status_resi,status_resi_detail,cs_nama,order_date` +
      `&ekspedisi=in.(${ekspedisiFilter})` +
      `&status_resi=not.in.(SAMPAI,RETUR)` +
      `&id=not.like.IMP-*` +
      `&order_date=gte.${cutoff}` +
      `&order=status_resi_updated_at.asc.nullsfirst` +
      `&limit=${ROWS_PER_RUN}`
    );
  } catch (e) {
    return res.status(500).json({ error: 'Gagal fetch crm_orders: ' + e.message });
  }

  // ── Proses batch ──────────────────────────────────────────────────────────────
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await Promise.all(batch.map(async row => {
      checked++;
      try {
        const { stage, detail } = await checkResiAuto(row);

        // Preserve bermasalah_since saat pertama kali jadi BERMASALAH
        let detailToSave = detail;
        if (stage === 'BERMASALAH') {
          const existingSince = row.status_resi_detail?.bermasalah_since || null;
          const since = (row.status_resi === 'BERMASALAH' && existingSince)
            ? existingSince
            : new Date().toISOString();
          detailToSave = { ...(detail || {}), bermasalah_since: since };
        }

        // Update crm_orders
        await sbFetch(`crm_orders?id=eq.${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status_resi:            stage,
            status_resi_step:       STAGE_STEP[stage],
            status_resi_updated_at: new Date().toISOString(),
            status_resi_detail:     detailToSave,
          }),
        });
        updated++;

        const wasBermasalah = row.status_resi === 'BERMASALAH';
        const wasRetur      = row.status_resi === 'RETUR';

        // Baru jadi BERMASALAH → masukkan Room Work + FU Info
        if (stage === 'BERMASALAH' && !wasBermasalah) {
          const caseUndel = detailToSave?.masalah_kategori || '';
          insertRoomWork({
            resi:      row.id,
            csNama:    row.cs_nama      || '',
            kota:      row.kota_tujuan  || '',
            ekspedisi: row.ekspedisi    || '',
            caseUndel,
          })
            .then(() => roomWorkAdded++)
            .catch(e => errors.push(`room_work/${row.id}: ${e.message}`));
        }

        // Baru jadi RETUR → auto investigasi kalau lapor_ekspedisi sudah true
        if (stage === 'RETUR' && !wasRetur) {
          const now = new Date().toISOString();
          sbFetch(
            `room_work?resi=eq.${encodeURIComponent(row.id)}&lapor_ekspedisi=eq.true&investigasi=eq.false&select=id`
          )
            .then(rwRows => {
              if (!rwRows?.length) return;
              return sbFetch(`room_work?resi=eq.${encodeURIComponent(row.id)}`, {
                method: 'PATCH',
                body: JSON.stringify({ investigasi: true, investigasi_at: now }),
              });
            })
            .catch(e => errors.push(`investigasi/${row.id}: ${e.message}`));
        }

      } catch (e) {
        failed++;
        errors.push(`${row.id}: ${e.message}`);
      }
    }));
  }

  res.status(200).json({
    checked, updated, failed, roomWorkAdded,
    staleCutoff: cutoff,
    errors: errors.slice(0, 20),
  });
};
