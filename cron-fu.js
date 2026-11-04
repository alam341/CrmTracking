#!/usr/bin/env node
// cron-fu.js — Cek room_work & kirim FU 1/2/3 otomatis via Fonnte
// Crontab: */5 * * * * cd /root/adsytraking-scripts && node cron-fu-crm.js >> /var/log/crmtracking-fu.log 2>&1
//
require('dotenv').config({ path: '/root/adsytraking-scripts/.env.crm' });
const fs = require('fs');
// Flow FU:
//   fu_count=1 (FU Info, langsung saat bermasalah) → besok: FU 1 (fu_count=2)
//   fu_count=2 (FU 1) → besok: FU 2 (fu_count=3)
//   fu_count=3 (FU 2) → besok: FU 3 (fu_count=4) ← terakhir
//   fu_count=4 → stop, masuk tab "CS Tidak Bales"

'use strict';

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // wajib di-set di env VPS
const MAX_PER_RUN  = 30;   // max pesan per run (*/5 menit) → max 360/jam, Fonnte tidak rate-limit
const DELAY_MS     = 5000; // jeda antar pesan (ms)
const LOCK_FILE    = '/tmp/cron-fu-crm.lock';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[cron-fu] ERROR: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum di-set di .env.crm');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!r.ok) throw new Error(`Supabase GET error ${r.status}: ${await r.text()}`);
  return r.json();
}

async function sbPatch(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey:          SUPABASE_KEY,
      Authorization:   `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      Prefer:          'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Supabase PATCH error ${r.status}: ${await r.text()}`);
}

function normalizeWA(no) {
  let n = String(no || '').replace(/\D/g, '');
  if (n.startsWith('0')) n = '62' + n.slice(1);
  if (!n.startsWith('62')) n = '62' + n;
  return n;
}

async function sendWA(to, message) {
  const token = process.env.FONNTE_TOKEN;
  if (!token) throw new Error('FONNTE_TOKEN tidak di-set di .env.crm');
  const r = await fetch('https://api.fonnte.com/send', {
    method:  'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ target: normalizeWA(to), message, countryCode: '62' }),
  });
  if (!r.ok) throw new Error(`Fonnte error ${r.status}: ${await r.text()}`);
  return r.json();
}

// ── Default template (fallback kalau Supabase gagal) ─────────────────────────
const FU_DEFAULTS = {
  fu1: `📨 *[FU 1] Paket Bermasalah*\n\nHalo [nama_cs], mengingatkan:\n\n👤 Customer: [nama_customer] ([hp_customer])\n📦 Produk: [produk]\n🔢 Resi: *[resi]*\n🚚 Ekspedisi: [ekspedisi]\n📍 Kota: [kota]\n❌ Kasus: [kasus]\n\nBelum ada update — mohon segera dikonfirmasi! 🙏`,
  fu2: `🔔 *[FU 2] Pengingat Paket Bermasalah*\n\nHalo [nama_cs], mengingatkan kembali:\n\n👤 Customer: [nama_customer] ([hp_customer])\n📦 Produk: [produk]\n🔢 Resi: *[resi]*\n🚚 Ekspedisi: [ekspedisi]\n📍 Kota: [kota]\n❌ Kasus: [kasus]\n\nSudah 2 hari belum ada konfirmasi — tolong segera ditindak! 🙏`,
  fu3: `🚨 *[FU 3 - Terakhir] Paket Bermasalah*\n\nHalo [nama_cs], ini follow up terakhir:\n\n👤 Customer: [nama_customer] ([hp_customer])\n📦 Produk: [produk]\n🔢 Resi: *[resi]*\n🚚 Ekspedisi: [ekspedisi]\n📍 Kota: [kota]\n❌ Kasus: [kasus]\n\nHarap konfirmasi hari ini ya! 🙏`,
};

// ── Ambil template dari Supabase (sekali per run) ─────────────────────────────
let _tplCache = null;
async function getTemplates() {
  if (_tplCache) return _tplCache;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/settings?select=key,value&key=in.(fu_template_fu1,fu_template_fu2,fu_template_fu3)`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await r.json();
    const map = {};
    (rows || []).forEach(row => { map[row.key] = row.value; });
    _tplCache = {
      fu1: map['fu_template_fu1'] || FU_DEFAULTS.fu1,
      fu2: map['fu_template_fu2'] || FU_DEFAULTS.fu2,
      fu3: map['fu_template_fu3'] || FU_DEFAULTS.fu3,
    };
    console.log('[cron-fu] Template dimuat dari Supabase');
  } catch(e) {
    console.warn('[cron-fu] Gagal load template dari Supabase, pakai default:', e.message);
    _tplCache = { ...FU_DEFAULTS };
  }
  return _tplCache;
}

function fillTemplate(tpl, row) {
  return tpl
    .replace(/\[nama_cs\]/g,       row.cs_nama       || '-')
    .replace(/\[nama_customer\]/g, row.nama_pembeli   || '-')
    .replace(/\[hp_customer\]/g,   row.hp_pembeli     || '-')
    .replace(/\[produk\]/g,        row.produk         || '-')
    .replace(/\[resi\]/g,          row.resi           || '-')
    .replace(/\[ekspedisi\]/g,     row.ekspedisi      || '-')
    .replace(/\[kota\]/g,          row.kota_tujuan    || '-')
    .replace(/\[kasus\]/g,         row.case_undel     || '-');
}

// ── Pesan FU 1 / 2 / 3 ───────────────────────────────────────────────────────
async function fuMsg(fuNum, row) {
  const tpls = await getTemplates();
  const tpl  = tpls[`fu${fuNum}`] || FU_DEFAULTS[`fu${fuNum}`];
  return fillTemplate(tpl, row);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Lock file — cegah overlap kalau run sebelumnya masih jalan
  if (fs.existsSync(LOCK_FILE)) {
    console.log('[cron-fu] Lock file ada — run sebelumnya masih jalan atau crash. Hapus manual kalau stuck.');
    process.exit(0);
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));

  const now    = Date.now();
  const H24    = 24 * 60 * 60 * 1000;
  const nowISO = new Date().toISOString();

  console.log(`[cron-fu] Mulai — ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`);

  try {
    // Ambil semua room_work yang aktif (belum bales, belum lapor, belum investigasi)
    // dan fu_count < 4 (belum sampai FU 3)
    const rows = await sbGet(
      'room_work?select=*&cs_responded=eq.false&lapor_ekspedisi=eq.false&investigasi=eq.false&fu_count=lt.4&order=created_at.asc&limit=500'
    );

    console.log(`[cron-fu] Ditemukan ${rows.length} entri aktif`);

    let sent = 0, skipped = 0, errors = 0;

    for (const row of rows) {
      if (sent >= MAX_PER_RUN) {
        console.log(`[cron-fu] Batas ${MAX_PER_RUN} pesan per run tercapai, sisanya akan dikirim run berikutnya`);
        break;
      }
      try {
        const fuCount = row.fu_count || 0;
        if (fuCount < 1) { skipped++; continue; } // FU Info belum dikirim, skip

        // Tentukan timestamp FU terakhir yang dikirim
        // fu_count=1 → FU Info dikirim → cek fu_info_at
        // fu_count=2 → FU 1 dikirim    → cek fu_1_at
        // fu_count=3 → FU 2 dikirim    → cek fu_2_at
        const lastFuAt = fuCount === 1 ? row.fu_info_at
                       : fuCount === 2 ? row.fu_1_at
                       : fuCount === 3 ? row.fu_2_at
                       : null;

        if (!lastFuAt) { skipped++; continue; }

        const lastFuMs = now - new Date(lastFuAt).getTime();
        if (lastFuMs < H24) { skipped++; continue; } // belum 24 jam sejak FU terakhir

        // nextFu: 2=FU1, 3=FU2, 4=FU3
        const nextFuCount = fuCount + 1;
        const nextFuNum   = fuCount;     // label pesan: fu_count=1→FU1, 2→FU2, 3→FU3

        if (!row.cs_no_wa || !row.cs_nama) {
          console.warn(`[cron-fu] Skip ${row.resi} — no WA kosong`);
          skipped++;
          continue;
        }

        // Kirim FU
        const msg = await fuMsg(nextFuNum, row);
        await sendWA(row.cs_no_wa, msg);

        // Update room_work
        const patch = { fu_count: nextFuCount };
        if (nextFuCount === 2) patch.fu_1_at = nowISO;
        if (nextFuCount === 3) patch.fu_2_at = nowISO;
        if (nextFuCount === 4) patch.fu_3_at = nowISO;
        await sbPatch(`room_work?id=eq.${row.id}`, patch);

        console.log(`[cron-fu] FU ${nextFuNum} terkirim → ${row.cs_nama} (${row.cs_no_wa}) resi ${row.resi}`);
        sent++;

        // Jeda antar kirim WA (hindari rate limit)
        await new Promise(r => setTimeout(r, DELAY_MS));

      } catch (e) {
        console.error(`[cron-fu] Error resi ${row.resi}:`, e.message);
        errors++;
      }
    }

    console.log(`[cron-fu] Selesai — terkirim: ${sent}, dilewati: ${skipped}, error: ${errors}`);
  } finally {
    // Selalu hapus lock file di akhir
    try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
  }
}

main().catch(e => {
  console.error('[cron-fu] Fatal:', e.message);
  try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
  process.exit(1);
});
