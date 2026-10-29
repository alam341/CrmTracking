// Heuristik pure function penentu stage tracking -- SATU-SATUNYA tempat logic ini hidup.
// Dipakai lib/tracking-router.js (dipanggil dari api/tracking-check.js DAN api/cron-check-resi.js).
// Browser (js/tracking-common.js) TIDAK PERNAH punya salinan sendiri -- cuma render hasil API.
// Port dari Marketplace-main/api/cron-check-resi.js (versi paling matang, sudah divalidasi resi asli).

const MENGANTAR_COURIER_MAP = {
  JNE: 'JNE', 'J&T': 'JT', JT: 'JT', JNT: 'JT',
  SICEPAT: 'SiCepat', ANTERAJA: 'anteraja',
  NINJA: 'Ninja', IDEXPRESS: 'iDexpress', LION: 'lion', SAP: 'SAP',
  POS: 'pos',
};

// ── Klasifikasi penyebab BERMASALAH dari teks history kurir ───────────────────
// Dipanggil hanya saat stage === 'BERMASALAH', menerima array records (format seragam:
// { description, tracking_name, actual_time, current_location }).
function extractMasalahKategori(records) {
  const texts = (records || []).map(r =>
    [r.description, r.tracking_name].filter(Boolean).join(' ').toLowerCase()
  );
  const combined = texts.join(' ');
  // Prioritaskan cek dari record TERBARU (records[0] = newest) — masalah terakhir
  // lebih relevan dari masalah sebelumnya (misal: awalnya alamat salah, lalu COD refuse)
  const latest = texts[0] || '';

  // TOLAK_COD: pembeli menolak bayar COD / belum siap (JNE: U08/U21/U25, LION: "biaya cod belum siap")
  // Prioritas tinggi — cek duluan karena sering muncul bersamaan dengan masalah lain
  if (/refuse to pay|refuse.*cod|refused.*cod|tolak.*cod|cod.*belum siap|waiting cod payment|not order/i.test(latest || combined))
    return 'TOLAK_COD';
  // TIDAK_ADA_ORANG: id + en (JNE: U05, LION: "penerima tidak di lokasi")
  if (/tidak ada orang|tidak di tempat|tidak ditempat|tidak ada penerima|rumah kosong|penerima tidak di lokasi|tidak di lokasi|tidak ada di rumah|tidak ada dirumah|nobody at home|no one home|no one at home|not at home/i.test(combined))
    return 'TIDAK_ADA_ORANG';
  // ALAMAT_SALAH: id + en (JNE: U01 "incomplete consignee address", U02 "consignee unknown", LION: "alamat tidak ketemu")
  if (/alamat tidak ditemukan|alamat salah|salah alamat|alamat tidak ketemu|alamat tidak (lengkap|dikenal|valid|jelas)|incomplete consignee address|consignee unknown|wrong address|no such address|address not found|alamat tidak bisa/i.test(combined))
    return 'ALAMAT_SALAH';
  // TIDAK_BISA_DIHUBUNGI: id + en
  if (/nomor tidak aktif|tidak bisa dihubungi|tidak dapat dihubungi|tidak ada respon|hp tidak aktif|cannot contact|no answer|unreachable/i.test(combined))
    return 'TIDAK_BISA_DIHUBUNGI';
  // DITOLAK: id + en (JNE: U03/U08/U21, LION: "customer menolak")
  if (/ditolak|menolak|tidak mau terima|\brefuse\b|\brefused\b|consignee refuse/i.test(combined))
    return 'DITOLAK';
  // SIMPAN_GUDANG: paket dititip di counter/drop point
  if (/disimpan|drop point|pickup point|titip di|simpan di|dititip|counter/i.test(combined))
    return 'SIMPAN_GUDANG';
  return 'LAINNYA';
}

const STAGE_STEP = {
  MENUNGGU_RESI: 1, BELUM_DICEK: 1, DIKIRIM: 2, KOTA_TUJUAN: 3, OTW: 4, SAMPAI: 5,
  BERMASALAH: 2, RETUR: 2,
};

// ── Cocokkan kota tujuan pembeli ke lokasi event ───────────────────────────────
function trNormalizeCity(s) {
  return String(s || '').toUpperCase().replace(/^(KOTA|KAB\.?|KABUPATEN)\s+/g, '').replace(/\s+/g, ' ').trim();
}
function trCityMatches(destCity, locationName) {
  if (!destCity || !locationName) return false;
  const dest = trNormalizeCity(destCity);
  if (!dest) return false;
  const firstWord = dest.split(' ')[0];
  return firstWord.length >= 4 && String(locationName).toUpperCase().includes(firstWord);
}

// ── SPX ─────────────────────────────────────────────────────────────────────
const SPX_STAGE_BY_MILESTONE = { 1: 'DIKIRIM', 5: 'KOTA_TUJUAN', 6: 'OTW', 8: 'SAMPAI' };
const TR_STAGE_ORDER = ['DIKIRIM', 'KOTA_TUJUAN', 'OTW', 'SAMPAI'];

function mapSpxStage(apiData, destCity) {
  const info = apiData?.data?.sls_tracking_info || null;
  const records = info?.records || [];
  if (!records.length) return { stage: 'DIKIRIM', detail: info };

  const problemWords   = ['retur', 'return', 'gagal', 'bermasalah', 'batal', 'cancel', 'rts', 'ditolak', 'undelivered'];
  const deliveredWords = ['delivered', 'terkirim', 'diterima', 'selesai', 'complete'];
  const otwWords       = ['out for delivery', 'otw', 'sedang diantar', 'dalam pengiriman', 'kurir sedang', 'menuju alamat'];

  let stage = 'DIKIRIM';
  let problem = false;
  let retur = false; // milestone_code 10 = "Delivery Unsuccessful" (F671-F999, retur ke penjual)
  const higher = s => { if (TR_STAGE_ORDER.indexOf(s) > TR_STAGE_ORDER.indexOf(stage)) stage = s; };

  records.forEach(r => {
    const text = [r.milestone_name, r.tracking_name, r.description].filter(Boolean).join(' ').toLowerCase();
    if (r.milestone_code === 10) { retur = true; return; }
    if (problemWords.some(w => text.includes(w))) problem = true;
    if (deliveredWords.some(w => text.includes(w))) { higher('SAMPAI'); return; }
    if (otwWords.some(w => text.includes(w))) { higher('OTW'); return; }
    const ms = SPX_STAGE_BY_MILESTONE[r.milestone_code];
    if (ms === 'KOTA_TUJUAN') {
      if (trCityMatches(destCity, r.current_location?.location_name)) higher('KOTA_TUJUAN');
    } else if (ms) {
      higher(ms);
    }
  });

  if (retur) stage = 'RETUR';
  else if (problem) stage = 'BERMASALAH';

  // Trim: simpan hanya field yang dipakai di modal -- bukan full raw sls_tracking_info.
  // SPX bisa balikin object besar per record (thumbnail, koordinat, dsb) yang tidak dipakai.
  // Pattern sama kayak POS & Mengantar yang sudah trim duluan.
  const trimmedRecords = records.map(r => ({
    description: r.description || null,
    tracking_name: r.tracking_name || r.milestone_name || null,
    actual_time: r.actual_time || null,
    current_location: r.current_location?.location_name
      ? { location_name: r.current_location.location_name }
      : undefined,
  }));
  const detail = { records: trimmedRecords };
  if (stage === 'BERMASALAH') detail.masalah_kategori = extractMasalahKategori(trimmedRecords);
  return { stage, detail };
}

// ── POS (via bosampuh.id) ──────────────────────────────────────────────────────
// - history[].state === "FAILEDTODELIVERED" -> percobaan antar gagal, masih bisa dicoba
//   ulang -> BERMASALAH.
// - connote_customfield.is_retur === true ATAU connote_state akhir "DELIVERED (RETURN
//   DELIVERY)" (BUKAN "DELIVERED" polos!) -> paket beneran balik ke pengirim -> RETUR.
const POS_TRANSIT_STATES = ['inBag', 'INVEHICLE', 'INLOCATION', 'unBag'];

function mapPosStage(apiData, destCity) {
  const history = apiData?.connote_history || [];
  const state = apiData?.connote_state || '';
  const cf = apiData?.connote_customfield || {};
  // destNopen = kode cabang tujuan akhir order (bukan kprk/hub induk), dari data resmi API kurir
  // -- lebih reliable daripada trCityMatches yang gantung isian kolom kota_tujuan di Excel user
  // (kalau isiannya level kecamatan, bukan kabupaten, trCityMatches gak pernah match sama sekali;
  // ketauan pas port fix AdsyCRM sesi 2026-07-10, divalidasi pake resi asli BAC04072635010ACF3B9).
  const destNopen = cf.destination_nopen || null;

  // BUG (ketauan sesi 2026-07-11, validasi 4 resi asli BAC0607.../BAC0407.../BAC0307...x2):
  // history[].state === "Irregularity" DULU dipakai sebagai sinyal retur, padahal "Irregularity"
  // itu kategori umum buat macem-macem insiden (gagal X-Ray, salah rute, dll) yang BUKAN retur --
  // paket tetap lanjut jalan (INVEHICLE/INLOCATION lagi) setelahnya. 3 dari 4 resi tes salah
  // ke-cap RETUR selamanya gara-gara ini padahal is_retur beneran cuma true di 1 resi. Ganti ke
  // connote_customfield.is_retur -- field resmi dari POS yang emang didesain buat nunjukin ini.
  const hasRetur = cf.is_retur === true || /return/i.test(state);
  // hasProblem = ANY percobaan antar gagal/reschedule (reason_delivery keisi), bukan cuma
  // FAILEDTODELIVERED — keputusan user (sesi 2026-07-10, AdsyCRM): langsung Bermasalah dari
  // percobaan pertama gagal walau bakal di-retry otomatis, biar CS bisa proaktif follow up.
  const hasProblem = history.some(h => h.state === 'FAILEDTODELIVERED' || !!h.reason_delivery);

  let stage;
  if (hasRetur) stage = 'RETUR';
  else if (state === 'DELIVERED') stage = 'SAMPAI';
  else if (hasProblem) stage = 'BERMASALAH';
  else if (state === 'DELIVERYRUNSHEET') stage = 'OTW';
  else if (POS_TRANSIT_STATES.includes(state)) {
    const latest = history.length ? history[history.length - 1] : null;
    const atDestination = !!(destNopen && latest && latest.state === 'INLOCATION' && latest.nopen === destNopen);
    stage = (atDestination || trCityMatches(destCity, latest?.city)) ? 'KOTA_TUJUAN' : 'DIKIRIM';
  } else {
    stage = 'DIKIRIM';
  }

  const records = history.slice().reverse().map(h => ({
    description: h.content2 || h.content,
    tracking_name: h.action,
    actual_time: h.created_at ? Math.floor(new Date(h.created_at.replace(' ', 'T')).getTime() / 1000) : null,
    current_location: { location_name: h.location_name || h.city || '' },
  }));
  const detail = { records };
  if (stage === 'BERMASALAH') detail.masalah_kategori = extractMasalahKategori(records);
  return { stage, detail };
}

// ── Kurir lain via Mengantar (JNE/J&T/SiCepat/Anteraja/Ninja/IDExpress/Lion) ────
const TR_RETUR_PATTERN   = /retur|dikembalikan|\brts\b|\brto\b|return to sender/i;
const TR_PROBLEM_PATTERN = /gagal|kendala|bermasalah|problematic|tidak ditemukan|alamat tidak (lengkap|dikenal)|tidak ada orang|tidak ditempat|tidak dihuni|menunggu konfirmasi|disimpan di gudang|ditolak|pindah alamat|box undel/i;
const TR_OTW_PATTERN     = /sedang diantar|dalam pengantaran|out for delivery|kurir menuju|\botw\b|akan dikirim ke alamat penerima|with delivery courier|delivery courier|diantar ke alamat|on delivery|1st attempt|2nd attempt|percobaan/i;
const TR_KOTA_TUJUAN_PATTERN = /kota tujuan|gudang tujuan|tiba di kota|received at destination|received at warehouse|process and forward|inbound|sti-dest/i;

// Port dari js/shared.js AdsyCRM (sesi 2026-07-10, validasi ~15 resi asli JNT/Lion/JNE):
// - isPickupPhase: entry code ada kata "PICKUP" (fase jemput dari pengirim di kota ASAL) di-skip
//   dari cek OTW/Bermasalah/Kota Tujuan — kata "gagal"/"percobaan" di fase ini soal jemput dari
//   toko, bukan progress ke penerima (resi Lion asli C1QSTIEB: "GAGAL DIJEMPUT...PERCOBAAN
//   PENJEMPUTAN ULANG" kepancing OTW/Bermasalah padahal blm sampai kota tujuan sama sekali).
// - isSelfReceipt: "diterima oleh X" cuma SAMPAI kalau X beda dari counter/kota entry itu sendiri
//   (J&T pake frasa sama buat "diterima oleh COUNTER ASAL buat manifest" vs "diterima oleh
//   PENERIMA" — resi asli JJ6000055580).
// - hasReceivedBy: field `receiver` J&T cuma keisi PAS beneran diterima penerima; J&T juga punya
//   format "Paket telah diterima" TANPA kata "oleh X" yang gak ketangkep regex (resi JJ6000043832).
function isPickupPhase(e) {
  return !!(e && e.code && /pickup/i.test(e.code));
}
function isSelfReceipt(e) {
  if (!e || !e.place) return false;
  const m = /diterima oleh\s+(.+)/i.exec(e.descOnly || '');
  if (!m) return false;
  const norm = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return norm(m[1]) === norm(e.place);
}
function hasReceivedBy(e) {
  return !!(e && e.receivedBy);
}

function mengantarComputeStep(entries) {
  let step = 2;
  (entries || []).forEach(e => {
    if (isPickupPhase(e)) return;
    const d = (e.desc || '').toLowerCase();
    if (TR_OTW_PATTERN.test(d)) step = Math.max(step, 4);
    else if (TR_KOTA_TUJUAN_PATTERN.test(d)) step = Math.max(step, 3);
  });
  return step;
}

function mapMengantarStage(json) {
  if (!json || !json.success || !json.data) throw new Error(json?.message || 'Resi tidak ditemukan');
  const d = json.data;
  const history = Array.isArray(d.history) ? d.history : [];
  const entries = history.map(h => ({
    desc: [h.desc, h.code].filter(Boolean).join(' '),
    descOnly: h.desc || '',
    code: h.code || null,
    place: h.counter_name || h.city_name || null,
    receivedBy: (h.receiver || '').trim() || null,
    group: h.type?.group || null, tag: h.type?.tag || null
  }));
  const cat = (d.statusCategory || d.status || '').toUpperCase();
  const latest = entries.length ? entries[entries.length - 1] : null;
  const latestDesc = (latest ? latest.desc : '').toLowerCase();
  const reachedStep = mengantarComputeStep(entries);

  let stage;
  if (cat.includes('RETUR') || cat.includes('RETURN') || entries.some(e => TR_RETUR_PATTERN.test(e.desc || ''))) {
    stage = 'RETUR';
  } else if (cat === 'DELIVERED' || ((/diterima oleh|\bpod\b/.test(latestDesc) || (/\bdelivered\b/.test(latestDesc) && !/\bfailed\b/i.test(latestDesc))) && !isSelfReceipt(latest)) || hasReceivedBy(latest)) {
    stage = 'SAMPAI';
  } else {
    const hasStructuredProblem = entries.some(e => !isPickupPhase(e) && (e.group === 'UNDELIVERED' || e.tag === 'actionRequired'));
    if (hasStructuredProblem || entries.some(e => !isPickupPhase(e) && TR_PROBLEM_PATTERN.test(e.desc || ''))) stage = 'BERMASALAH';
    else if (reachedStep >= 4) stage = 'OTW';
    else if (reachedStep >= 3) stage = 'KOTA_TUJUAN';
    else stage = 'DIKIRIM';
  }

  const records = history.slice().reverse().map(h => {
    let actual_time = null;
    // Mengantar format: "DD-MM-YYYY HH:MM"
    if (h.date) {
      const m = String(h.date).match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})/);
      if (m) {
        const dt = new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5]);
        if (!isNaN(dt)) actual_time = Math.floor(dt.getTime() / 1000);
      } else {
        const dt = new Date(h.date);
        if (!isNaN(dt)) actual_time = Math.floor(dt.getTime() / 1000);
      }
    }
    return {
      description: [h.desc, h.code].filter(Boolean).join(' ') || '-',
      actual_time,
      current_location: (h.location || h.counter_name || h.city_name)
        ? { location_name: h.location || h.counter_name || h.city_name }
        : undefined,
    };
  });
  const detail = { records };
  if (stage === 'BERMASALAH') detail.masalah_kategori = extractMasalahKategori(records);
  return { stage, detail };
}

module.exports = {
  MENGANTAR_COURIER_MAP,
  STAGE_STEP,
  trCityMatches,
  extractMasalahKategori,
  mapSpxStage,
  mapPosStage,
  mapMengantarStage,
};
