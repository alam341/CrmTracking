// ── Supabase Client ───────────────────────────────────────────────────────────
// URL & anon key gak di-hardcode di sini -- diambil dari /api/config (baca Vercel
// Environment Variables). WAJIB panggil `await initSupabaseClient()` di awal tiap
// halaman sebelum manggil fungsi apa pun lain di file ini.
let _sb = null;
async function initSupabaseClient() {
  if (_sb) return _sb;
  const res = await fetch('/api/config');
  const cfg = await res.json();
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY belum di-set di Environment Variables Vercel');
  }
  _sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  return _sb;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function sbSignUp(email, password, name) {
  const { data, error } = await _sb.auth.signUp({
    email, password,
    options: { data: { name } },
  });
  if (error) throw error;
  if (data.user) {
    // Self-heal: pastikan row profiles kebentuk walau trigger DB gagal
    await _sb.from('profiles').upsert({ id: data.user.id, email, name, role: 'user' });
  }
  return data;
}

async function sbLogin(email, password) {
  const { data, error } = await _sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

async function sbLogout() {
  await _sb.auth.signOut();
  sessionStorage.clear();
  window.location.href = 'index.html';
}

async function sbGetSession() {
  const { data } = await _sb.auth.getSession();
  return data.session;
}

// ── Profiles ──────────────────────────────────────────────────────────────────
async function dbGetProfile(userId) {
  const { data, error } = await _sb.from('profiles').select('*').eq('id', userId).single();
  if (error) throw error;
  return data;
}


// Fetch 1 order lengkap termasuk status_resi_detail -- dipanggil hanya saat buka modal detail.
// Dipisah dari dbGetTrackableOrders supaya status_resi_detail (JSONB besar) tidak ikut
// ditarik saat list biasa → hemat egress signifikan.
async function dbGetOrderDetail(table, id) {
  const { data, error } = await _sb.from(table).select('*').eq('id', id).single();
  if (error) {
    if (error.code === 'PGRST116') return null; // row not found — order baru belum dicek
    throw error;
  }
  return data;
}

// Follow-up manual buat resi Bermasalah (percobaan/direspon/diinfo kurir) -- status ringkas
// aja, gak ada tabel histori terpisah (keputusan user 2026-07-11, lihat sql/006).
async function dbUpdateFollowup(table, id, patch) {
  const { error } = await _sb.from(table).update(patch).eq('id', id);
  if (error) throw error;
}


// ── CRM: query langsung dari crm_orders (single table, upload-based) ─────────
// Order diupload via Excel → disimpan ke crm_orders.
// Webhook Mengantar update status_resi di tabel yang sama.
const _AUTO_EKSPEDISI = ['SPX','POS','JNE','J&T','SICEPAT','ANTERAJA','NINJA','IDEXPRESS','LION'];

async function dbGetCrmOrders(dateFrom, dateTo) {
  const PAGE = 1000;
  let all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await _sb
      .from('crm_orders')
      .select('id,order_date,nama,hp,alamat,produk,qty,total,ekspedisi,kota_tujuan,cs_nama,status_resi,status_resi_step,status_resi_updated_at,cek_sl,followup_attempts,followup_responded,followup_courier_notified,status_resi_detail->>masalah_kategori,status_resi_detail->>bermasalah_since,status_resi_detail->>redeliver_attempts')
      .gte('order_date', dateFrom)
      .lte('order_date', dateTo)
      .order('order_date', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if ((data || []).length < PAGE) break;
    offset += PAGE;
  }
  // Normalize shape
  return all.map(o => ({
    ...o,
    followup_attempts:       o.followup_attempts       || 0,
    followup_responded:      o.followup_responded      || false,
    followup_courier_notified: o.followup_courier_notified || false,
    cek_sl:                  o.cek_sl                  || false,
    masalah_kategori:        o.masalah_kategori         || null,
    bermasalah_since:        o.bermasalah_since         || null,
    redeliver_attempts:      o.redeliver_attempts ? parseInt(o.redeliver_attempts) : 0,
  }));
}

// ── Upload: bulk insert/refresh ke crm_orders (dipanggil dari upload-common.js) ─
async function dbBulkInsertOrders(table, rows, batchId, uploaderId) {
  const inserts = rows.map(r => ({ ...r, upload_batch_id: batchId, uploaded_by: uploaderId }));

  const seen = new Map();
  inserts.forEach(r => seen.set(r.id, r));
  const unique = Array.from(seen.values());
  const duplicateInBatch = inserts.length - unique.length;

  const allIds = unique.map(r => r.id);
  const existingIds = new Set();
  const CHECK_CHUNK = 500;
  for (let i = 0; i < allIds.length; i += CHECK_CHUNK) {
    const chunk = allIds.slice(i, i + CHECK_CHUNK);
    const { data } = await _sb.from(table).select('id').in('id', chunk);
    (data || []).forEach(r => existingIds.add(r.id));
  }

  const newRows    = unique.filter(r => !existingIds.has(r.id));
  const updateRows = unique.filter(r =>  existingIds.has(r.id));

  const CHUNK = 500;
  for (let i = 0; i < newRows.length; i += CHUNK) {
    const chunk = newRows.slice(i, i + CHUNK);
    const { error } = await _sb.from(table).upsert(chunk, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
  }

  // Update row lama: hanya kolom sumber (nama/produk/ekspedisi/dll), jangan timpa status tracking
  const REFRESH_FIELDS = ['nama', 'hp', 'alamat', 'kota_tujuan', 'produk', 'qty', 'total', 'ekspedisi', 'order_date', 'cs_nama', 'upload_batch_id', 'uploaded_by'];
  if (updateRows.length) {
    const patches = updateRows.map(r => {
      const patch = {};
      REFRESH_FIELDS.forEach(f => { if (r[f] !== undefined) patch[f] = r[f]; });
      patch.id = r.id;
      return patch;
    });
    for (let i = 0; i < patches.length; i += CHUNK) {
      const chunk = patches.slice(i, i + CHUNK);
      const { error } = await _sb.from(table).upsert(chunk, { onConflict: 'id' });
      if (error) throw error;
    }
  }

  return { saved: newRows.length, updated: updateRows.length, duplicateInBatch };
}

// ── Upload batches — track history upload ────────────────────────────────────
async function dbInsertUploadBatch(batch) {
  const { error } = await _sb.from('upload_batches').insert(batch);
  if (error) throw error;
}

async function dbDeleteUploadBatchRow(batchId) {
  await _sb.from('upload_batches').delete().eq('id', batchId);
}

async function dbUpdateUploadBatchCount(batchId, count) {
  await _sb.from('upload_batches').update({ record_count: count }).eq('id', batchId);
}

async function dbGetUploadBatches(domain) {
  const { data, error } = await _sb
    .from('upload_batches')
    .select('*, profiles(name)')
    .eq('domain', domain)
    .order('uploaded_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function dbDeleteUploadBatch(batchId, table) {
  const { error: delOrdersErr } = await _sb.from(table).delete().eq('upload_batch_id', batchId);
  if (delOrdersErr) throw delOrdersErr;
  const { error: delBatchErr } = await _sb.from('upload_batches').delete().eq('id', batchId);
  if (delBatchErr) throw delBatchErr;
}

// ── CS Profiles — diambil dari team_members di Supabase CRM ──────────────────
async function dbGetTeamMembers(domain) {
  const r = await fetch('/api/cs-profiles');
  if (!r.ok) throw new Error('Gagal fetch CS profiles: ' + r.status);
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return (data || []).map(cs => ({
    id: cs.id,
    name: cs.nama || cs.name,
    no_wa: cs.no_wa,
    domain: 'crm',
    role: cs.role,
  }));
}

// ── Room Work — ambil FU status untuk BERMASALAH resi via API (service role) ──
async function dbGetRoomWorkByResi(resiList) {
  if (!resiList || !resiList.length) return [];
  const r = await fetch('/api/room-work', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ resi: resiList }),
  });
  if (!r.ok) throw new Error('room-work API error: ' + r.status);
  return r.json();
}

// ── Mapping kode SKU -> nama produk ──────────────────────────────────────────
async function dbGetSkuMap() {
  const { data, error } = await _sb.from('sku_produk').select('kode,nama_produk,urutan').order('urutan', { nullsLast: true });
  if (error) throw error;
  const map = new Map();
  (data || []).forEach(r => map.set(String(r.kode).trim().toUpperCase(), r.nama_produk));
  return map;
}
