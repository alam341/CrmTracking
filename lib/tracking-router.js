// Satu fungsi dispatch dipakai api/tracking-check.js (cek manual) DAN api/cron-check-resi.js
// (batch). Rute otomatis berdasar row.ekspedisi -- gak peduli row itu dari akuisisi_orders,
// marketplace_orders, atau crm_orders (kontrak kolom `ekspedisi`/`kota_tujuan` sama persis).

const { fetchMengantar, fetchPos, fetchSpx } = require('./courier-clients');
const { MENGANTAR_COURIER_MAP, mapSpxStage, mapPosStage, mapMengantarStage } = require('./stage-engine');

async function checkSpxResi(resi, destCity) {
  const data = await fetchSpx(resi);
  if (data.retcode !== 0) throw new Error(data.message || 'Resi tidak ditemukan');
  return mapSpxStage(data, destCity);
}

async function checkPosResi(resi, destCity) {
  const data = await fetchPos(resi);
  if (data.error || !data.connote_code) throw new Error(data.error || 'Resi tidak ditemukan');
  return mapPosStage(data, destCity);
}

async function checkMengantarResi(resi, ekspedisi) {
  const courier = MENGANTAR_COURIER_MAP[ekspedisi];
  if (!courier) throw new Error('Ekspedisi belum didukung');
  const data = await fetchMengantar(resi, courier);
  return mapMengantarStage(data);
}

// Deteksi ekspedisi dari format resi — lebih reliable dari field ekspedisi yang mungkin salah input
function detectEkspedisiFromResi(resi) {
  const r = String(resi || '').trim();
  if (/^MGT\d/i.test(r))             return 'SAP';
  if (/^SPXID/i.test(r))             return 'SPX';
  if (/^26MNG\d+$/i.test(r))         return 'POS';
  if (/^C1[A-Z0-9]{5,8}$/i.test(r)) return 'LION';
  if (/^\d{16}$/.test(r))            return 'JNE';
  if (/^(JO|JJ)\d{10}$/i.test(r))   return 'J&T';
  return null;
}

// row: { id (resi), ekspedisi, kota_tujuan }. id dipakai sebagai nomor resi.
async function checkResiAuto(row) {
  // Override ekspedisi kalau format resi lebih reliable (misal stored JNE tapi resi SPXID)
  const detected = detectEkspedisiFromResi(row.id);
  const eksp = (detected || String(row.ekspedisi || '')).toUpperCase().trim();
  if (eksp === 'SPX') return checkSpxResi(row.id, row.kota_tujuan);
  if (MENGANTAR_COURIER_MAP[eksp]) return checkMengantarResi(row.id, eksp);
  throw new Error('Ekspedisi tidak didukung: ' + row.ekspedisi);
}

const AUTO_EKSPEDISI_LIST = ['SPX', 'POS', 'JNE', 'J&T', 'SICEPAT', 'ANTERAJA', 'NINJA', 'IDEXPRESS', 'LION', 'SAP'];

module.exports = { checkResiAuto, AUTO_EKSPEDISI_LIST };
