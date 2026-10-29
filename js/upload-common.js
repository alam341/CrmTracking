// Modal upload shared dipakai 3 domain (Akuisisi/Marketplace/CRM) -- dipicu dari sidebar
// "Upload X" (js/app.js handleUploadNavClick) atau tombol di halaman tracking.
// Port pola modal dari Marketplace-main/js/upload.js, disederhanakan: gak ada engine
// dup/RTS/risk-scoring (di luar scope, cuma parse -> map kolom -> dedup -> insert).

const DOMAIN_TABLE = { akuisisi: 'akuisisi_orders', marketplace: 'marketplace_orders', crm: 'crm_orders' };
const DOMAIN_LABEL = { akuisisi: 'Akuisisi', marketplace: 'Marketplace', crm: 'CRM' };

let _upState = { step: 1, domain: null, detectedMp: null, parsedRows: [], storeName: '', storeOptions: [] };

function openUploadModal(domain) {
  _upState = { step: 1, domain, detectedMp: null, parsedRows: [], storeName: '', storeOptions: [] };
  ensureUploadModal();
  renderUploadModal();
  document.getElementById('uploadModalOverlay').classList.add('open');
}
function closeUploadModal() { document.getElementById('uploadModalOverlay')?.classList.remove('open'); }

function ensureUploadModal() {
  if (document.getElementById('uploadModalOverlay')) return;
  const el = document.createElement('div');
  el.id = 'uploadModalOverlay';
  el.className = 'modal-overlay';
  el.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3 id="uploadModalTitle">📥 Upload Data</h3>
        <button class="modal-close" onclick="closeUploadModal()">✕</button>
      </div>
      <div class="modal-body" id="uploadModalBody"></div>
    </div>
  `;
  el.addEventListener('click', e => { if (e.target === el) closeUploadModal(); });
  document.body.appendChild(el);

  const manage = document.createElement('div');
  manage.id = 'manageModalOverlay';
  manage.className = 'modal-overlay';
  manage.innerHTML = `
    <div class="modal" style="max-width:640px">
      <div class="modal-header">
        <h3>🗂️ Kelola Upload</h3>
        <button class="modal-close" onclick="closeManageModal()">✕</button>
      </div>
      <div class="modal-body" id="manageModalBody"><div class="page-loading"><div class="spinner"></div></div></div>
    </div>
  `;
  manage.addEventListener('click', e => { if (e.target === manage) closeManageModal(); });
  document.body.appendChild(manage);
}

function renderUploadModal() {
  const domain = _upState.domain;
  document.getElementById('uploadModalTitle').textContent = `📥 Upload ${DOMAIN_LABEL[domain]}`;
  let content = '';

  if (_upState.step === 1) {
    let info = '';
    if (_upState.parsedRows.length) {
      const mpTag = domain === 'marketplace' ? MP_CONFIG[_upState.detectedMp].label + ' terdeteksi · ' : '';
      info = `<div style="background:rgba(6,194,112,.1);border-radius:8px;padding:10px 14px;margin-top:12px;display:flex;gap:10px;align-items:center">
        <span style="font-size:1.2rem">✅</span>
        <div><div style="font-weight:700;font-size:.85rem">${mpTag}${_upState.parsedRows.length} baris data siap diimport</div></div>
      </div>`;
      if (domain === 'marketplace') {
        const isNew = _upState.storeName === '__new__';
        info += `<div style="margin-top:12px">
          <label style="font-size:.82rem;font-weight:700;color:var(--text-2);display:block;margin-bottom:6px">Nama Toko *</label>
          <select id="storeNameSelect" class="ctrl-select" style="width:100%" onchange="onStoreSelectChange(this.value)">
            <option value="">-- Pilih Toko --</option>
            ${_upState.storeOptions.map(s => `<option value="${escapeHtml(s.name)}" ${_upState.storeName === s.name ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
            <option value="__new__" ${isNew ? 'selected' : ''}>+ Tambah toko baru...</option>
          </select>
          <div id="newStoreWrap" style="display:${isNew ? 'block' : 'none'};margin-top:8px">
            <input type="text" id="newStoreNameInput" class="ctrl-input" style="width:100%" placeholder="Nama toko baru, mis. Adsy Official">
          </div>
          <div style="font-size:.72rem;color:var(--text-3);margin-top:4px">Belum ada di daftar? Kelola lewat menu "Kelola Toko" atau tambah langsung di sini.</div>
        </div>`;
      }
    }

    content = `
      <div class="upload-steps">
        <span class="step-pill active">1 Upload</span><span class="step-arrow">›</span><span class="step-pill">2 Preview</span>
      </div>
      <p style="font-size:.85rem;color:var(--text-2);margin-bottom:14px">
        ${domain === 'marketplace'
          ? 'Upload file Excel dari <strong>Shopee</strong>, <strong>TikTok Shop</strong>, atau <strong>Lazada</strong>. Marketplace terdeteksi otomatis.'
          : `Upload file Excel order ${DOMAIN_LABEL[domain]} (kolom resi/nama/hp/produk dikenali otomatis dari header).`}
      </p>
      <div class="drop-zone-modal" id="uploadDropZone" onclick="document.getElementById('uploadFileInput').click()">
        <div class="dz-icon">📁</div>
        <p><strong>Klik atau drag & drop</strong> file Excel di sini</p>
        <div class="dz-hint">.xlsx / .xls</div>
      </div>
      <input type="file" id="uploadFileInput" accept=".xlsx,.xls" style="display:none" onchange="handleUploadFile(this.files[0])">
      <div id="uploadFileInfo">${info}</div>
      <div style="margin-top:16px;display:flex;gap:10px;justify-content:space-between;align-items:center">
        <button class="btn btn-outline btn-sm" onclick="openManageModal('${domain}')">🗂️ Kelola Upload</button>
        <div style="display:flex;gap:10px">
          <button class="btn btn-outline btn-sm" onclick="closeUploadModal()">Batal</button>
          <button class="btn btn-primary btn-sm" id="btnUploadNext" onclick="goToUploadPreview()" ${!_upState.parsedRows.length ? 'disabled' : ''}>Preview →</button>
        </div>
      </div>
    `;
  } else {
    const preview = _upState.parsedRows.slice(0, 5);
    content = `
      <div class="upload-steps">
        <span class="step-pill done">✓ Upload</span><span class="step-arrow">›</span><span class="step-pill active">2 Preview</span>
      </div>
      <div style="background:rgba(67,97,238,.07);border-radius:10px;padding:12px 16px;margin-bottom:14px;font-size:.85rem">
        <strong>${_upState.parsedRows.length}</strong> baris · Preview 5 pertama:
      </div>
      <div class="table-wrap preview-table">
        <table>
          <thead><tr><th>Resi</th><th>Tanggal</th><th>Nama/Produk</th><th>Total</th><th>Ekspedisi</th></tr></thead>
          <tbody>
            ${preview.map(r => `<tr>
              <td style="font-size:.72rem;font-family:monospace">${escapeHtml(String(r.id))}</td>
              <td>${r.order_date}</td>
              <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.nama || r.produk || '-')}</td>
              <td style="color:var(--primary);font-weight:700">${fmtFull(r.total)}</td>
              <td><span style="font-size:.72rem">${escapeHtml(r.ekspedisi || '-')}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-outline btn-sm" onclick="_upState.step=1;renderUploadModal()">← Kembali</button>
        <button class="btn btn-success btn-sm" id="btnUploadApply" onclick="applyUploadData()">✅ Simpan ke Database</button>
      </div>
    `;
  }

  document.getElementById('uploadModalBody').innerHTML = content;

  if (_upState.step === 1) {
    const dz = document.getElementById('uploadDropZone');
    if (dz) {
      dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
      dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); handleUploadFile(e.dataTransfer.files[0]); });
    }
  }
}

function handleUploadFile(file) {
  if (!file) return;
  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    document.getElementById('uploadFileInfo').innerHTML = `<span style="color:var(--danger)">❌ File harus .xlsx atau .xls</span>`;
    return;
  }
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const domain = _upState.domain;

      if (domain === 'marketplace') {
        const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        let headerRow = rawRows[0]?.map(String) || [];
        let mp = _detectMarketplace(headerRow);
        let isTransposed = false;
        if (!mp) {
          const colA = rawRows.map(r => String(r[0] || ''));
          mp = _detectMarketplace(colA);
          if (mp) isTransposed = true;
        }
        if (!mp) {
          document.getElementById('uploadFileInfo').innerHTML = `<span style="color:var(--danger)">❌ Marketplace tidak dikenali. Pastikan file dari Shopee, TikTok, atau Lazada.</span>`;
          return;
        }
        const cfg = MP_CONFIG[mp];
        const { headers, rows } = _readSheet(ws, isTransposed);
        const mapping = {};
        for (const [field, fn] of Object.entries(cfg.map)) mapping[field] = fn(headers);
        _upState.detectedMp = mp;
        _upState.parsedRows = _parseMarketplaceRows(rows, mp, mapping);
        _upState.storeOptions = await dbGetStores(mp);
      } else {
        const cfg = domain === 'akuisisi' ? AKUISISI_CONFIG : CRM_CONFIG;
        const { headers, rows } = _readSheet(ws, false);
        const mapping = {};
        for (const [field, fn] of Object.entries(cfg.map)) mapping[field] = fn(headers);
        if (!mapping.id) {
          document.getElementById('uploadFileInfo').innerHTML = `<span style="color:var(--danger)">❌ Kolom resi/nomor resi tidak ditemukan di header file.</span>`;
          return;
        }
        const skuMap = await dbGetSkuMap();
        _upState.parsedRows = _parseSimpleOrderRows(rows, mapping, domain, skuMap);
      }

      renderUploadModal();
    } catch (err) {
      document.getElementById('uploadFileInfo').innerHTML = `<span style="color:var(--danger)">❌ Gagal membaca file: ${escapeHtml(err.message)}</span>`;
    }
  };
  reader.readAsBinaryString(file);
}

function onStoreSelectChange(val) {
  _upState.storeName = val;
  const wrap = document.getElementById('newStoreWrap');
  if (val === '__new__') { wrap.style.display = 'block'; document.getElementById('newStoreNameInput').focus(); }
  else { wrap.style.display = 'none'; }
}

async function goToUploadPreview() {
  if (_upState.domain === 'marketplace') {
    const btn = document.getElementById('btnUploadNext');
    if (_upState.storeName === '__new__') {
      const newName = document.getElementById('newStoreNameInput')?.value.trim() || '';
      if (!newName) {
        document.getElementById('newStoreNameInput').style.borderColor = 'var(--danger)';
        document.getElementById('newStoreNameInput').focus();
        return;
      }
      if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan toko...'; }
      try {
        await dbAddStore(_upState.detectedMp, newName);
        _upState.storeName = newName;
      } catch (e) {
        // Toko udah ada duluan (race dgn upload lain) -- gapapa, tetep pakai nama itu.
        _upState.storeName = newName;
      }
      if (btn) { btn.disabled = false; btn.textContent = 'Preview →'; }
    }
    if (!_upState.storeName) {
      document.getElementById('storeNameSelect').style.borderColor = 'var(--danger)';
      document.getElementById('storeNameSelect').focus();
      return;
    }
  }
  _upState.step = 2;
  renderUploadModal();
}

async function applyUploadData() {
  const btn = document.getElementById('btnUploadApply');
  if (btn) { btn.textContent = 'Menyimpan...'; btn.disabled = true; }

  const domain = _upState.domain;
  const table = DOMAIN_TABLE[domain];
  const batchId = 'BATCH-' + domain.toUpperCase() + '-' + Date.now();

  try {
    const session = await sbGetSession();
    await dbInsertUploadBatch({
      id: batchId,
      domain,
      marketplace: domain === 'marketplace' ? _upState.detectedMp : null,
      store_name: domain === 'marketplace' ? _upState.storeName : null,
      uploaded_by: session.user.id,
      record_count: _upState.parsedRows.length,
    });

    // Inject store_name & marketplace ke tiap row supaya bisa difilter di halaman tracking.
    // Sebelumnya hanya disimpan di upload_batches, tapi marketplace_orders.store_name
    // dibiarkan NULL sehingga filter per toko tidak pernah bisa match.
    const rowsToInsert = domain === 'marketplace'
      ? _upState.parsedRows.map(r => ({ ...r, store_name: _upState.storeName || null }))
      : _upState.parsedRows;

    let result;
    try {
      result = await dbBulkInsertOrders(table, rowsToInsert, batchId, session.user.id);
    } catch (e) {
      await dbDeleteUploadBatchRow(batchId);
      throw e;
    }

    if (result.saved === 0 && result.updated === 0) {
      await dbDeleteUploadBatchRow(batchId);
      closeUploadModal();
      const msg = result.duplicateInBatch > 0
        ? `ℹ️ Tidak ada yang ditambahkan (${result.duplicateInBatch} duplikat dalam file).`
        : 'ℹ️ Tidak ada yang ditambahkan.';
      showToast(msg, 'info');
      return;
    }

    await dbUpdateUploadBatchCount(batchId, result.saved);
    closeUploadModal();
    const parts = [];
    if (result.saved > 0) parts.push(`${result.saved} baru disimpan`);
    // Resi yang udah ada di database di-refresh datanya (nama/produk/ekspedisi/dll dari file
    // ini), bukan di-skip -- dipakai buat backfill order lama yang kena bug parsing versi lama.
    if (result.updated > 0) parts.push(`${result.updated} data lama diperbarui`);
    let msg = `✅ ${parts.join(', ')}!`;
    if (result.duplicateInBatch > 0) msg += ` (${result.duplicateInBatch} duplikat dalam file dilewati)`;
    showToast(msg, 'success');
    if (typeof trReload === 'function') trReload();
  } catch (e) {
    showToast('❌ Gagal simpan: ' + (e.message || e), 'error');
    if (btn) { btn.textContent = '✅ Simpan ke Database'; btn.disabled = false; }
  }
}

// ── Kelola Upload ────────────────────────────────────────────────────────────
function openManageModal(domain) {
  ensureUploadModal();
  document.getElementById('manageModalOverlay').classList.add('open');
  loadManageBatches(domain);
}
function closeManageModal() { document.getElementById('manageModalOverlay')?.classList.remove('open'); }

async function loadManageBatches(domain) {
  const body = document.getElementById('manageModalBody');
  body.innerHTML = `<div class="page-loading"><div class="spinner"></div><div>Memuat data...</div></div>`;
  try {
    const [batches, me] = await Promise.all([dbGetUploadBatches(domain), getCurrentUser()]);
    if (!batches.length) {
      body.innerHTML = `<div class="page-loading"><div style="font-size:2rem">📭</div><div>Belum ada data upload</div></div>`;
      return;
    }
    // Hapus cuma boleh buat batch sendiri, kecuali role admin/spv (permintaan user 2026-07-10).
    // Enforce beneran-nya di RLS (sql/005_delete_permission.sql) -- ini cuma nyamain tampilan
    // biar gak ada tombol yang bakal gagal diklik.
    const canDeleteAll = ['admin', 'spv'].includes(me?.role);
    body.innerHTML = `
      <p style="font-size:.82rem;color:var(--text-3);margin-bottom:12px">Klik Hapus buat hapus semua data dalam satu batch upload.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>${domain === 'marketplace' ? 'Marketplace / Toko' : 'Batch'}</th><th>Upload Oleh</th><th>Tanggal</th><th>Jumlah</th><th></th></tr></thead>
          <tbody>
            ${batches.map(b => {
              const p = b.profiles || {};
              const d = new Date(b.uploaded_at);
              const tgl = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
              const jam = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
              const label = domain === 'marketplace' ? `${(b.marketplace || '-').toUpperCase()} · ${b.store_name || '-'}` : b.id;
              const canDelete = canDeleteAll || b.uploaded_by === me?.id;
              return `<tr>
                <td style="font-weight:600;font-size:.82rem">${escapeHtml(label)}</td>
                <td style="font-size:.8rem;color:var(--text-3)">${escapeHtml((p.name || '-').split(' ')[0])}</td>
                <td style="font-size:.78rem;color:var(--text-3)">${tgl}<br>${jam}</td>
                <td style="font-weight:700;text-align:center">${b.record_count}</td>
                <td>${canDelete ? `<button class="btn btn-sm" style="background:#FEE2E2;color:#EF233C;border:none;cursor:pointer;border-radius:8px;padding:5px 12px;font-weight:700;font-size:.78rem"
                  onclick="confirmDeleteBatch('${domain}','${b.id}',${b.record_count})">Hapus</button>` : `<span style="font-size:.72rem;color:var(--text-3)">-</span>`}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    body.innerHTML = `<div style="color:var(--danger);padding:20px">Gagal memuat: ${escapeHtml(e.message)}</div>`;
  }
}

function confirmDeleteBatch(domain, batchId, count) {
  const body = document.getElementById('manageModalBody');
  body.innerHTML = `
    <div style="text-align:center;padding:24px 0">
      <div style="font-size:2.5rem;margin-bottom:12px">⚠️</div>
      <div style="font-weight:800;font-size:1rem;margin-bottom:8px">Hapus upload ini?</div>
      <div style="color:var(--danger);font-weight:700;font-size:.9rem;margin-bottom:24px">${count} data akan dihapus permanen</div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button class="btn btn-outline btn-sm" onclick="loadManageBatches('${domain}')">Batal</button>
        <button class="btn btn-sm" style="background:#EF233C;color:white;border:none;cursor:pointer;border-radius:10px;padding:8px 20px;font-weight:700"
          id="btnConfirmDeleteBatch" onclick="doDeleteBatch('${domain}','${batchId}')">Ya, Hapus Semua</button>
      </div>
    </div>
  `;
}

async function doDeleteBatch(domain, batchId) {
  const btn = document.getElementById('btnConfirmDeleteBatch');
  if (btn) { btn.textContent = 'Menghapus...'; btn.disabled = true; }
  try {
    await dbDeleteUploadBatch(batchId, DOMAIN_TABLE[domain]);
    showToast('✅ Data berhasil dihapus', 'success');
    await loadManageBatches(domain);
    if (typeof trReload === 'function') trReload();
  } catch (e) {
    showToast('❌ Gagal hapus: ' + e.message, 'error');
    await loadManageBatches(domain);
  }
}
