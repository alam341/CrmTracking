// Endpoint untuk tombol "Sync Resi" di UI -- panggil dari browser, no external secret needed.
// Batch-check semua resi akuisisi aktif (bukan SAMPAI/RETUR) via kurir API, update crm_orders.
// Sama persis dengan cron-check-resi.js tapi tanpa auth header -- aman karena halaman
// sudah di-protect Supabase auth, dan operasi ini non-destruktif (cuma update tracking status).

const { sbFetch }        = require('../lib/supabase-rest');
const { checkResiAuto, AUTO_EKSPEDISI_LIST } = require('../lib/tracking-router');
const { STAGE_STEP }     = require('../lib/stage-engine');
const { insertRoomWork } = require('../lib/room-work-helper');

const ROWS_PER_RUN = 100;
const BATCH        = 5;
const STALE_DAYS   = 60;

function cutoffDate() {
  const d = new Date();
  d.setDate(d.getDate() - STALE_DAYS);
  return d.toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cutoff          = cutoffDate();
  const ekspedisiFilter = AUTO_EKSPEDISI_LIST.map(e => encodeURIComponent(e)).join(',');
  let checked = 0, updated = 0, failed = 0, roomWorkAdded = 0;
  const errors = [];

  // Query param opsional: ?from=2026-10-01&to=2026-10-31
  const fromDate = req.query?.from || null;
  const toDate   = req.query?.to   || null;

  // Ambil resi aktif -- urut dari paling lama dicek supaya tiap run "gantian"
  let rows;
  try {
    let query =
      `crm_orders` +
      `?select=id,ekspedisi,status_resi,status_resi_detail,order_date` +
      `&ekspedisi=in.(${ekspedisiFilter})` +
      `&status_resi=not.in.(SAMPAI,RETUR,MANUAL_CEK)` +
      `&id=not.like.IMP-*` +
      `&order=status_resi_updated_at.asc.nullsfirst` +
      `&limit=${ROWS_PER_RUN}`;

    if (fromDate && toDate) {
      query += `&or=(order_date.is.null,and(order_date.gte.${fromDate},order_date.lte.${toDate}))`;
    } else if (fromDate) {
      query += `&or=(order_date.gte.${fromDate},order_date.is.null)`;
    } else {
      query += `&or=(order_date.gte.2026-09-01,order_date.is.null)`;
    }

    rows = await sbFetch(query);
  } catch (e) {
    return res.status(500).json({ error: 'Gagal fetch crm_orders: ' + e.message });
  }

  const total = rows.length;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await Promise.all(batch.map(async row => {
      checked++;
      try {
        const { stage, detail } = await checkResiAuto(row);

        let detailToSave = detail;
        if (stage === 'BERMASALAH') {
          const existingSince = row.status_resi_detail?.bermasalah_since || null;
          const since = (row.status_resi === 'BERMASALAH' && existingSince)
            ? existingSince
            : new Date().toISOString();
          detailToSave = { ...(detail || {}), bermasalah_since: since };
        }

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

        // Baru jadi BERMASALAH → Room Work + FU Info
        if (stage === 'BERMASALAH' && row.status_resi !== 'BERMASALAH') {
          insertRoomWork({
            resi:      row.id,
            csNama:    '',
            kota:      '',
            ekspedisi: row.ekspedisi   || '',
            caseUndel: detailToSave?.masalah_kategori || '',
            orderDate: row.order_date  || null,
          })
            .then(() => roomWorkAdded++)
            .catch(e => errors.push(`room_work/${row.id}: ${e.message}`));
        }

        // Baru jadi RETUR + sudah lapor → auto investigasi
        if (stage === 'RETUR' && row.status_resi !== 'RETUR') {
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
        // Update timestamp supaya resi gagal tidak terus terpilih di run berikutnya
        sbFetch(`crm_orders?id=eq.${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ status_resi_updated_at: new Date().toISOString() }),
        }).catch(() => {});
      }
    }));
  }

  res.status(200).json({
    total,
    checked,
    updated,
    failed,
    roomWorkAdded,
    hasMore: total === ROWS_PER_RUN, // masih ada resi yang belum dicek kalau true
    staleCutoff: cutoff,
    errors: errors.slice(0, 10),
  });
};
