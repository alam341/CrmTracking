// ── Tracking Resi -- factory dipakai 3x (Akuisisi/Marketplace/CRM) ──────────────
// UI diporting dari pola AdsyCRM/MarketDash: card grid + tab filter + stat card klik +
// stepper 5 tahap + modal detail + date-range picker.
//
// PENTING: heuristik stage TIDAK ada di sini. Tombol "Cek Ulang"/"Refresh Semua" cuma
// manggil /api/tracking-check dan render hasil {stage, step, detail} yang API balikin --
// lihat lib/stage-engine.js buat satu-satunya tempat logic itu hidup.

const TR_STEP_LABELS = ['Konfirmasi', 'Dikirim', 'Kota Tujuan', 'OTW', 'Sampai'];
const TR_STAGE_META = {
  MENUNGGU_RESI: { label: '⏳ Menunggu Resi', badge: 'badge-warning', step: 1 },
  BELUM_DICEK:   { label: '🔍 Belum Dicek',   badge: 'badge-gray',    step: 1 },
  MANUAL:        { label: '🔧 Cek Manual',    badge: 'badge-orange',  step: 1 },
  DIKIRIM:       { label: '🚚 Dikirim',        badge: 'badge-primary', step: 2 },
  KOTA_TUJUAN:   { label: '🏙️ Kota Tujuan',   badge: 'badge-primary', step: 3 },
  OTW:           { label: '🛵 OTW',            badge: 'badge-warning', step: 4 },
  SAMPAI:        { label: '✅ Sampai',          badge: 'badge-success', step: 5 },
  BERMASALAH:    { label: '⚠️ Bermasalah',     badge: 'badge-danger',  step: 2, problem: true },
  RETUR:         { label: '↩️ Retur',          badge: 'badge-danger',  step: 2, problem: true },
};
const TR_TABS = [
  { key: 'SEMUA',         label: 'Semua' },
  { key: 'MENUNGGU_RESI', label: '⏳ Menunggu Resi' },
  { key: 'MANUAL',        label: '🔧 Cek Manual' },
  { key: 'DIKIRIM',       label: '🚚 Dikirim' },
  { key: 'KOTA_TUJUAN',   label: '🏙️ Kota Tujuan' },
  { key: 'OTW',           label: '🛵 OTW' },
  { key: 'SAMPAI',        label: '✅ Sampai' },
  { key: 'BERMASALAH',    label: '⚠️ Bermasalah' },
  { key: 'RETUR',         label: '↩️ Retur' },
];
const TR_STAT_CARD_FILTER = { SEMUA: 'SEMUA', ON_PROSES: 'ON_PROSES_GROUP', UNDEL: 'BERMASALAH', RETUR: 'RETUR', DELIVERY: 'SAMPAI' };
const TR_BERMASALAH_KATEGORI_META = {
  TIDAK_ADA_ORANG:      { label: 'Tidak Ada Orang',   icon: '🚪' },
  ALAMAT_SALAH:         { label: 'Alamat Salah',       icon: '📍' },
  TIDAK_BISA_DIHUBUNGI: { label: 'Tidak Dihubungi',   icon: '📵' },
  DITOLAK:              { label: 'Ditolak',            icon: '🚫' },
  SIMPAN_GUDANG:        { label: 'Simpan di Gudang',   icon: '📦' },
  LAINNYA:              { label: 'Lainnya',            icon: '❓' },
};
const TR_ON_PROSES_STAGES = ['MENUNGGU_RESI', 'BELUM_DICEK', 'MANUAL', 'DIKIRIM', 'KOTA_TUJUAN', 'OTW'];
const TR_AVATAR_PALETTE = ['#4361EE', '#7B2FBE', '#06C270', '#FFB703', '#EF233C', '#0EA5E9', '#7C3AED', '#0891B2', '#65A30D', '#C026D3'];
const MP_BADGE = { shopee: ['badge-shopee', 'Shopee'], tiktok: ['badge-tiktok', 'TikTok'], lazada: ['badge-lazada', 'Lazada'] };

function trCardState(stage) {
  if (stage === 'SAMPAI')     return 'DELIVERY';
  if (stage === 'RETUR')      return 'RETUR';
  if (stage === 'BERMASALAH') return 'UNDEL';
  return 'ON_PROSES';
}
function trEffectiveStage(o) {
  if (String(o.id).startsWith('IMP-')) return 'MENUNGGU_RESI'; // resi asli gak ketemu di file upload
  if (o.status_resi === 'MANUAL_CEK') return 'MANUAL'; // MANUAL_CEK = cek manual, tampil sama
  if (!o.status_resi || !TR_STAGE_META[o.status_resi]) return 'BELUM_DICEK';
  return o.status_resi;
}
function trAvatarColor(name) {
  const s = name || '?';
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) % 1000000007;
  return TR_AVATAR_PALETTE[Math.abs(hash) % TR_AVATAR_PALETTE.length];
}
function trStepperHtml(stage) {
  const meta = TR_STAGE_META[stage] || TR_STAGE_META.BELUM_DICEK;
  const step = meta.step;
  const allDone = stage === 'SAMPAI';
  return `<div class="tr-stepper">${TR_STEP_LABELS.map((label, i) => {
    const idx = i + 1;
    let cls = 'tr-step';
    if (allDone || idx < step) cls += ' tr-step-done';
    else if (idx === step) cls += meta.problem ? ' tr-step-problem' : ' tr-step-active';
    const icon = (allDone || idx < step) ? '✓' : idx;
    return `<div class="${cls}"><div class="tr-step-line"></div><div class="tr-step-circle">${icon}</div><div class="tr-step-label">${label}</div></div>`;
  }).join('')}</div>`;
}

// ── Deteksi format resi mencurigakan (tampil sebagai hint di modal) ────────────
function trGetResiHint(o) {
  const id  = String(o.id || '');
  const exp = String(o.ekspedisi || '').toLowerCase();

  // 26MNG* → Mengantar order ID, bukan resi pengiriman
  if (/^26MNG/i.test(id)) {
    return {
      title: 'Bukan Nomor Resi',
      body: `<strong>${escapeHtml(id)}</strong> adalah <strong>order ID Mengantar</strong>, bukan nomor resi pengiriman. Minta CS untuk input nomor resi yang benar dari dashboard Mengantar.`,
    };
  }

  // JJ* atau C1* → format J&T, tapi ekspedisi bukan J&T
  const isJtFormat = /^JJ/i.test(id) || /^C1/i.test(id);
  const isJt = /j&t|jnt|jet/i.test(exp);
  if (isJtFormat && !isJt) {
    const ekspLabel = o.ekspedisi ? `<strong>${escapeHtml(o.ekspedisi)}</strong>` : 'tidak tercatat';
    return {
      title: 'Kemungkinan Salah Ekspedisi',
      body: `Format resi <strong>${escapeHtml(id)}</strong> seperti <strong>J&T Express</strong>, tapi ekspedisi tercatat sebagai ${ekspLabel}. Kemungkinan salah pilih ekspedisi saat input — minta CS koreksi.`,
    };
  }

  // JJ* dengan ekspedisi J&T tapi masih gagal → resi tidak ditemukan biasa
  if (isJtFormat && isJt) {
    return {
      title: 'Nomor Resi Tidak Ditemukan',
      body: `Resi <strong>${escapeHtml(id)}</strong> belum terdaftar di sistem J&T Express. Kemungkinan paket belum di-scan pertama kali oleh kurir. Coba cek ulang dalam beberapa jam.`,
    };
  }

  return null;
}

// ── Date range picker (dropdown + kalender, default Bulan Ini) ─────────────────
const DRP_MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const DRP_DAYS   = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
function trYmd(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function drpFmtDate(d) { return d ? `${d.getDate()} ${DRP_MONTHS[d.getMonth()].slice(0,3)} ${d.getFullYear()}` : '—'; }

function drpMakeCalendar(calId, selStart, selEnd, clickFn, navFn, viewYear, viewMonth) {
  const firstDay    = new Date(viewYear, viewMonth, 1).getDay();
  const startPad    = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const prevDays    = new Date(viewYear, viewMonth, 0).getDate();
  const today = new Date();

  let html = `<div class="drp-cal-hdr">
      <button class="drp-nav" onclick="${navFn}(-1)">‹</button>
      <div class="drp-cal-title">${DRP_MONTHS[viewMonth]} ${viewYear}</div>
      <button class="drp-nav" onclick="${navFn}(1)">›</button>
    </div>
    <div class="drp-days-hdr">${DRP_DAYS.map(d => `<span>${d}</span>`).join('')}</div>
    <div class="drp-days">`;
  for (let i = startPad; i > 0; i--) html += `<button class="drp-day other-month">${prevDays - i + 1}</button>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const cur = new Date(viewYear, viewMonth, d);
    const isToday = viewYear === today.getFullYear() && viewMonth === today.getMonth() && d === today.getDate();
    const isStart = selStart && cur.getTime() === new Date(selStart.getFullYear(), selStart.getMonth(), selStart.getDate()).getTime();
    const isEnd   = selEnd   && cur.getTime() === new Date(selEnd.getFullYear(), selEnd.getMonth(), selEnd.getDate()).getTime();
    const inRange = selStart && selEnd && cur > selStart && cur < selEnd;
    let cls = 'drp-day';
    if (isStart && isEnd) cls += ' selected';
    else if (isStart) cls += ' range-start';
    else if (isEnd)   cls += ' range-end';
    else if (inRange) cls += ' in-range';
    if (isToday) cls += ' today';
    html += `<button class="${cls}" onclick="${clickFn}(${viewYear},${viewMonth},${d})">${d}</button>`;
  }
  const total = startPad + daysInMonth;
  const rem = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let d = 1; d <= rem; d++) html += `<button class="drp-day other-month">${d}</button>`;
  html += '</div>';
  document.getElementById(calId).innerHTML = html;
}

// ── Factory ──────────────────────────────────────────────────────────────────
// cfg: { table: 'crm_orders', domain: 'crm', domainLabel: 'CRM', hasMarketplaceFilter: bool }
function initTrackingPage(cfg) {
  const st = {
    orders: [],
    filterStage: 'SEMUA',
    subFilter: null,      // sub-filter aktif saat ON_PROSES_GROUP, misal 'DIKIRIM'
    masalahFilter: null,  // sub-filter aktif saat BERMASALAH, misal 'ALAMAT_SALAH'
    agingFilter: null,    // sub-filter aging BERMASALAH, misal 'H1','H2','H3','H4+'
    cekSlFilter: false,   // filter hanya yang sudah cek SL
    belumJawabFilter: false, // filter hanya yang belum dijawab CS (cs_responded=false)
    modalId: null,
    mpFilter: '',
    storeFilter: '',
    storeOptions: [],
    ekspedisiFilter: '',
    csFilter: new Set(),
    produkFilter: cfg.initialProdukFilter || '',
    page: 1,
    pageSize: 50,
  };
  const today = new Date();
  st.filterStart = new Date(today.getFullYear(), today.getMonth(), 1);
  st.filterEnd   = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  st.drpSelStart = st.filterStart; st.drpSelEnd = st.filterEnd;
  st.drpViewYear = today.getFullYear(); st.drpViewMonth = today.getMonth();
  st.drpLabelText = 'Bulan Ini';

  ensureModal();

  window.trDrpToggle = () => {
    const dd = document.getElementById('trDrp-dropdown');
    dd.classList.toggle('open');
    if (dd.classList.contains('open')) { renderDrp(); document.addEventListener('click', drpOutside); }
    else document.removeEventListener('click', drpOutside);
  };
  window.trDrpClose = () => { document.getElementById('trDrp-dropdown').classList.remove('open'); document.removeEventListener('click', drpOutside); };
  function drpOutside(e) {
    const dd = document.getElementById('trDrp-dropdown'), tr = document.getElementById('trDrp-trigger');
    if (!dd.contains(e.target) && !tr.contains(e.target)) window.trDrpClose();
  }
  function markActive(btn) { document.querySelectorAll('#trDrp-dropdown .drp-preset').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
  function updateSel() {
    document.getElementById('trDrp-sel-start').textContent = drpFmtDate(st.drpSelStart);
    document.getElementById('trDrp-sel-end').textContent   = drpFmtDate(st.drpSelEnd);
  }
  function renderDrp() { drpMakeCalendar('trDrp-cal', st.drpSelStart, st.drpSelEnd, 'trDrpClickDay', 'trDrpNav', st.drpViewYear, st.drpViewMonth); }
  window.trDrpPreset = (days, label, btn) => {
    const t = new Date();
    st.drpSelEnd = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    const s = new Date(t); s.setDate(s.getDate() - (days - 1));
    st.drpSelStart = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    markActive(btn); updateSel(); renderDrp();
  };
  window.trDrpPresetYesterday = (btn) => {
    const y = new Date(); y.setDate(y.getDate() - 1);
    st.drpSelStart = st.drpSelEnd = new Date(y.getFullYear(), y.getMonth(), y.getDate());
    markActive(btn); updateSel(); renderDrp();
  };
  window.trDrpPresetThisMonth = (btn) => {
    const t = new Date();
    st.drpSelStart = new Date(t.getFullYear(), t.getMonth(), 1);
    st.drpSelEnd   = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    markActive(btn); updateSel(); renderDrp();
  };
  window.trDrpPresetLastMonth = (btn) => {
    const t = new Date();
    st.drpSelStart = new Date(t.getFullYear(), t.getMonth() - 1, 1);
    st.drpSelEnd   = new Date(t.getFullYear(), t.getMonth(), 0);
    markActive(btn); updateSel(); renderDrp();
  };
  window.trDrpApply = () => {
    if (!st.drpSelStart) return;
    st.filterStart = st.drpSelStart;
    st.filterEnd   = st.drpSelEnd || st.drpSelStart;
    st.drpLabelText = `${drpFmtDate(st.filterStart)} — ${drpFmtDate(st.filterEnd)}`;
    window.trDrpClose();
    load();
  };
  window.trDrpClickDay = (y, m, d) => {
    const clicked = new Date(y, m, d);
    if (!st.drpSelStart || (st.drpSelStart && st.drpSelEnd)) { st.drpSelStart = clicked; st.drpSelEnd = null; }
    else if (clicked < st.drpSelStart) { st.drpSelEnd = st.drpSelStart; st.drpSelStart = clicked; }
    else { st.drpSelEnd = clicked; }
    document.querySelectorAll('#trDrp-dropdown .drp-preset').forEach(b => b.classList.remove('active'));
    updateSel(); renderDrp();
  };
  window.trDrpNav = (dir) => {
    st.drpViewMonth += dir;
    if (st.drpViewMonth > 11) { st.drpViewMonth = 0; st.drpViewYear++; }
    if (st.drpViewMonth < 0)  { st.drpViewMonth = 11; st.drpViewYear--; }
    renderDrp();
  };

  function fmtLastUpdated(d) {
    if (!d) return '';
    const h = String(d.getHours()).padStart(2,'0');
    const m = String(d.getMinutes()).padStart(2,'0');
    const s = String(d.getSeconds()).padStart(2,'0');
    return `${h}:${m}:${s}`;
  }
  function setLastUpdatedIndicator() {
    const el = document.getElementById('trLastUpdated');
    if (el) el.textContent = `diperbarui ${fmtLastUpdated(st.lastUpdated)}`;
  }

  async function load(silent = false) {
    if (!silent) showLoading();
    try {
      const filters = { dateFrom: trYmd(st.filterStart), dateTo: trYmd(st.filterEnd) };
      if (cfg.hasMarketplaceFilter && st.mpFilter) filters.marketplace = st.mpFilter;
      if (cfg.domain === 'crm') {
        st.orders = await dbGetCrmOrders(filters.dateFrom, filters.dateTo);
        // Batch fetch room_work untuk merge FU status ke BERMASALAH orders
        const bermasalahResi = st.orders
          .filter(o => trEffectiveStage(o) === 'BERMASALAH')
          .map(o => o.id);
        if (bermasalahResi.length) {
          try {
            const rwData = await dbGetRoomWorkByResi(bermasalahResi);
            const rwMap = {};
            rwData.forEach(r => { rwMap[r.resi] = r; });
            st.orders.forEach(o => {
              const rw = rwMap[o.id];
              if (rw) {
                o._fuCount      = rw.fu_count      || 0;
                o._csResponded  = rw.cs_responded  || false;
              }
            });
          } catch (e) {
            console.warn('[tracking] Gagal fetch room_work:', e.message);
          }
        }
      } else {
        st.orders = await dbGetTrackableOrders(cfg.table, filters);
      }
      if (cfg.hasMarketplaceFilter && typeof dbGetStores === 'function') {
        st.storeOptions = await dbGetStores(st.mpFilter || undefined);
      }
      st.lastUpdated = new Date();
      renderPage();
      setLastUpdatedIndicator();
      // Update sidebar dengan produk yang benar-benar ada di order periode ini
      if (typeof updateSidebarProducts === 'function') {
        updateSidebarProducts(produkOptions());
      }
    } catch (e) {
      if (!silent) showError('Gagal memuat data tracking: ' + e.message);
    }
  }

  // Opsi filter ekspedisi diambil DINAMIS dari data order yang lagi ke-load, bukan di-hardcode --
  // biar gak ada opsi kosong dan otomatis nyesuain kalau ada ekspedisi baru (pattern sama kayak
  // trStoreFilter, cuma sumbernya dari st.orders langsung karena ekspedisi bukan tabel lookup).
  function ekspedisiOptions() {
    return [...new Set(st.orders.map(o => o.ekspedisi).filter(Boolean))].sort();
  }
  // CS & Produk cuma relevan buat Akuisisi/CRM (cs_nama gak ada konsepnya di Marketplace) --
  // pattern sama kayak ekspedisiOptions, opsi dinamis dari data yang lagi ke-load.
  function csOptions() {
    return [...new Set(st.orders.map(o => o.cs_nama).filter(Boolean))].sort();
  }
  function produkOptions() {
    // Pakai produk pertama sebelum " + " supaya bundle (misal "MISOHWA + MAS") masuk ke opsi "MISOHWA"
    return [...new Set(st.orders.map(o => (o.produk || '').split(' + ')[0].trim()).filter(Boolean))].sort();
  }
  // Opsi produk dari sku_produk (cfg.products) — sumber sama dengan sidebar,
  // jadi filter dropdown & sidebar selalu konsisten
  function skuProdukOptions() {
    if (cfg.products && cfg.products.length) return cfg.products.map(p => p.nama_produk);
    return produkOptions(); // fallback ke order data kalau products tidak dipass
  }

  function renderPage() {
    document.getElementById('pageContent').innerHTML = `
      <div class="stat-grid cols-5">
        <div class="stat-card clickable" id="trStatCard-SEMUA" onclick="trSetFilter('SEMUA')">
          <div class="stat-label">Total</div><div class="stat-value" id="trStatTotal">0</div><div class="stat-icon">📦</div>
        </div>
        <div class="stat-card clickable" id="trStatCard-ON_PROSES" onclick="trSetFilter('ON_PROSES_GROUP')">
          <div class="stat-label">On Proses</div><div class="stat-value" id="trStatOnProses" style="color:var(--primary)">0</div>
          <div id="trStatOnProses-pct" style="font-size:.72rem;color:var(--primary);opacity:.75;margin-top:2px"></div>
          <div class="stat-icon">🔄</div>
        </div>
        <div class="stat-card clickable" id="trStatCard-UNDEL" onclick="trSetFilter('BERMASALAH')">
          <div class="stat-label">Bermasalah</div><div class="stat-value" id="trStatUndel" style="color:var(--danger)">0</div>
          <div id="trStatUndel-pct" style="font-size:.72rem;color:var(--danger);opacity:.75;margin-top:2px"></div>
          <div class="stat-icon">⚠️</div>
        </div>
        <div class="stat-card clickable" id="trStatCard-RETUR" onclick="trSetFilter('RETUR')">
          <div class="stat-label">Retur</div><div class="stat-value" id="trStatRetur" style="color:var(--danger)">0</div>
          <div id="trStatRetur-pct" style="font-size:.72rem;color:var(--danger);opacity:.75;margin-top:2px"></div>
          <div class="stat-icon">↩️</div>
        </div>
        <div class="stat-card clickable" id="trStatCard-DELIVERY" onclick="trSetFilter('SAMPAI')">
          <div class="stat-label">Terkirim</div><div class="stat-value" id="trStatDelivery" style="color:var(--success)">0</div>
          <div id="trStatDelivery-pct" style="font-size:.72rem;color:var(--success);opacity:.75;margin-top:2px"></div>
          <div class="stat-icon">✅</div>
        </div>
      </div>
      <div id="trSubFilter"></div>
      <div id="trMasalahSubFilter"></div>
      <div class="card">
        <div class="card-header">
          <div class="card-header-left"><h3>Tracking Resi ${cfg.domainLabel}</h3><div class="card-sub">Monitor status pengiriman &nbsp;·&nbsp; <span id="trLastUpdated" style="color:var(--text-3);font-size:11px">${st.lastUpdated ? 'diperbarui ' + fmtLastUpdated(st.lastUpdated) : ''}</span></div></div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            ${cfg.hasMarketplaceFilter ? `
              <select class="ctrl-select" id="trMpFilter" onchange="trSetMpFilter(this.value)">
                <option value="">Semua Marketplace</option>
                <option value="shopee" ${st.mpFilter==='shopee'?'selected':''}>Shopee</option>
                <option value="tiktok" ${st.mpFilter==='tiktok'?'selected':''}>TikTok</option>
                <option value="lazada" ${st.mpFilter==='lazada'?'selected':''}>Lazada</option>
              </select>
              <select class="ctrl-select" id="trStoreFilter" onchange="trSetStoreFilter(this.value)">
                <option value="">Semua Toko</option>
                ${st.storeOptions.map(s => `<option value="${escapeHtml(s.name)}" ${st.storeFilter===s.name?'selected':''}>${escapeHtml(s.name)}</option>`).join('')}
              </select>` : ''}
            <select class="ctrl-select" id="trEkspedisiFilter" onchange="trSetEkspedisiFilter(this.value)">
              <option value="">Semua Ekspedisi</option>
              ${ekspedisiOptions().map(e => `<option value="${escapeHtml(e)}" ${st.ekspedisiFilter===e?'selected':''}>${escapeHtml(e)}</option>`).join('')}
            </select>
            ${!cfg.hasMarketplaceFilter ? `
              <div style="position:relative" id="trCSWrap">
                <button class="ctrl-select" id="trCSBtn" onclick="trToggleCSDropdown(event)"
                  style="cursor:pointer;text-align:left;display:flex;align-items:center;gap:6px;min-width:130px">
                  <span id="trCSLabel">${st.csFilter.size ? st.csFilter.size + ' CS dipilih' : 'Semua CS'}</span>
                  <span style="margin-left:auto;font-size:.65rem">▾</span>
                </button>
                <div id="trCSDropdown" style="display:none;position:absolute;top:calc(100% + 4px);left:0;z-index:200;
                  background:var(--card);border:1px solid var(--border);border-radius:10px;
                  box-shadow:0 4px 20px rgba(0,0,0,.12);min-width:200px;max-height:260px;overflow-y:auto;padding:6px 0">
                  <div style="padding:6px 12px 4px;display:flex;gap:8px">
                    <span onclick="trCSSelectAll()" style="font-size:.72rem;color:var(--primary);cursor:pointer;font-weight:600">Pilih Semua</span>
                    <span style="color:var(--border)">|</span>
                    <span onclick="trCSClearAll()" style="font-size:.72rem;color:var(--text-3);cursor:pointer">Reset</span>
                  </div>
                  <div style="height:1px;background:var(--border);margin:4px 0"></div>
                  ${csOptions().map(c => `
                    <label style="display:flex;align-items:center;gap:8px;padding:6px 14px;cursor:pointer;font-size:.8rem"
                      onmouseover="this.style.background='rgba(67,97,238,.06)'" onmouseout="this.style.background=''">
                      <input type="checkbox" value="${escapeHtml(c)}" ${st.csFilter.has(c)?'checked':''}
                        onchange="trToggleCS(this.value,this.checked)"
                        style="accent-color:var(--primary);width:14px;height:14px;cursor:pointer">
                      <span>${escapeHtml(c)}</span>
                    </label>`).join('')}
                </div>
              </div>
              <select class="ctrl-select" id="trProdukFilter" onchange="trSetProdukFilter(this.value)">
                <option value="">Semua Produk</option>
                ${produkOptions().map(p => `<option value="${escapeHtml(p)}" ${st.produkFilter===p?'selected':''}>${escapeHtml(p)}</option>`).join('')}
              </select>` : ''}
            <div class="drp-wrap">
              <button class="drp-trigger" onclick="trDrpToggle()" id="trDrp-trigger">
                <span>📅</span><span id="trDrp-label">${st.drpLabelText}</span><span style="color:var(--text-3)">▾</span>
              </button>
              <div class="drp-dropdown" id="trDrp-dropdown">
                <div class="drp-presets">
                  <button class="drp-preset" onclick="trDrpPreset(1,'Hari Ini',this)">Hari Ini</button>
                  <button class="drp-preset" onclick="trDrpPresetYesterday(this)">Kemarin</button>
                  <hr style="border:none;border-top:1px solid var(--border);margin:6px 0">
                  <button class="drp-preset" onclick="trDrpPreset(7,'7 Hari Terakhir',this)">7 Hari Terakhir</button>
                  <button class="drp-preset" onclick="trDrpPreset(14,'14 Hari Terakhir',this)">14 Hari Terakhir</button>
                  <button class="drp-preset" onclick="trDrpPreset(30,'30 Hari Terakhir',this)">30 Hari Terakhir</button>
                  <button class="drp-preset" onclick="trDrpPreset(90,'90 Hari Terakhir',this)">90 Hari Terakhir</button>
                  <hr style="border:none;border-top:1px solid var(--border);margin:6px 0">
                  <button class="drp-preset active" onclick="trDrpPresetThisMonth(this)">Bulan Ini</button>
                  <button class="drp-preset" onclick="trDrpPresetLastMonth(this)">Bulan Lalu</button>
                </div>
                <div style="display:flex;flex-direction:column;flex:1">
                  <div class="drp-cal" id="trDrp-cal"></div>
                  <div class="drp-footer">
                    <div class="drp-selected-txt"><span id="trDrp-sel-start">—</span> → <span id="trDrp-sel-end">—</span></div>
                    <div style="display:flex;gap:6px">
                      <button class="drp-cancel" onclick="trDrpClose()">Batal</button>
                      <button class="drp-apply" onclick="trDrpApply()">Terapkan</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <button class="btn btn-primary btn-sm" id="trSyncBtn" onclick="trSyncAllResi()">📡 Sync Resi</button>
            <button class="btn btn-outline btn-sm" onclick="trDownloadExcel()">⬇️ Download Excel</button>
            ${typeof openUploadModal === 'function' ? `<button class="btn btn-outline btn-sm" onclick="openUploadModal('${cfg.domain}')">📥 Upload</button>` : ''}
          </div>
        </div>
        <div class="tr-toolbar">
          <div class="tr-tabs" id="trTabs"></div>
          <div id="trAgingSubFilter" style="width:100%;flex-basis:100%"></div>
          <div class="tr-search-wrap">
            <input type="text" id="trSearch" class="ctrl-input" style="width:100%" placeholder="🔍 Cari resi / nama / produk..." onkeyup="trSearch()">
          </div>
          <div class="tr-count" id="trCount">0 pesanan</div>
        </div>
        <div id="trList"></div>
        <div id="trPagination" style="display:flex;align-items:center;justify-content:center;gap:10px;padding:16px 0 4px;flex-wrap:wrap"></div>
      </div>
    `;
    renderTabs();
    applyFilter(); // updateStats() dipanggil di dalam applyFilter
  }

  function renderTabs() {
    document.getElementById('trTabs').innerHTML = TR_TABS.map(t =>
      `<div class="tr-tab ${st.filterStage === t.key ? 'active' : ''}" onclick="trSetFilter('${t.key}')">${t.label}</div>`
    ).join('');
    Object.entries(TR_STAT_CARD_FILTER).forEach(([cardKey, filterKey]) => {
      document.getElementById('trStatCard-' + cardKey)?.classList.toggle('active', st.filterStage === filterKey);
    });
  }

  // baseList = orders sudah difilter produk/CS/ekspedisi/store/search (belum filter stage)
  function updateStats(baseList) {
    const counts = { ON_PROSES: 0, UNDEL: 0, RETUR: 0, DELIVERY: 0 };
    const stageCounts = {};
    baseList.forEach(o => {
      const s = trEffectiveStage(o);
      counts[trCardState(s)]++;
      stageCounts[s] = (stageCounts[s] || 0) + 1;
    });
    const total = baseList.length;
    const pct = (n) => total > 0 ? (n / total * 100).toFixed(1) + '%' : '';
    document.getElementById('trStatTotal').textContent         = total;
    document.getElementById('trStatOnProses').textContent      = counts.ON_PROSES;
    document.getElementById('trStatOnProses-pct').textContent  = pct(counts.ON_PROSES);
    document.getElementById('trStatUndel').textContent         = counts.UNDEL;
    document.getElementById('trStatUndel-pct').textContent     = pct(counts.UNDEL);
    document.getElementById('trStatRetur').textContent         = counts.RETUR;
    document.getElementById('trStatRetur-pct').textContent     = pct(counts.RETUR);
    document.getElementById('trStatDelivery').textContent      = counts.DELIVERY;
    document.getElementById('trStatDelivery-pct').textContent  = pct(counts.DELIVERY);
    renderSubFilter(stageCounts);
    renderMasalahSubFilter();
    renderAgingSubFilter();
  }

  const SUB_FILTER_STAGES = [
    { key: 'MENUNGGU_RESI', icon: '⏳' },
    { key: 'BELUM_DICEK',   icon: '🔍' },
    { key: 'MANUAL',        icon: '🔧' },
    { key: 'DIKIRIM',       icon: '🚚' },
    { key: 'KOTA_TUJUAN',   icon: '🏙️' },
    { key: 'OTW',           icon: '🛵' },
  ];

  function renderSubFilter(stageCounts) {
    const el = document.getElementById('trSubFilter');
    if (!el) return;
    if (st.filterStage !== 'ON_PROSES_GROUP') { el.innerHTML = ''; return; }

    const items = SUB_FILTER_STAGES.map(({ key, icon }) => {
      const count = stageCounts[key] || 0;
      const meta  = TR_STAGE_META[key];
      const label = meta.label.replace(/^\S+\s*/, ''); // strip emoji dari meta
      const isActive = st.subFilter === key;
      return `
        <div class="tr-sub-card ${isActive ? 'active' : ''}" onclick="trSetSubFilter('${key}')">
          <div class="tr-sub-icon">${icon}</div>
          <div class="tr-sub-count">${count}</div>
          <div class="tr-sub-label">${label}</div>
        </div>`;
    });

    el.innerHTML = `<div class="tr-sub-grid">${items.join('')}</div>`;
  }

  function renderMasalahSubFilter() {
    const el = document.getElementById('trMasalahSubFilter');
    if (!el) return;
    if (st.filterStage !== 'BERMASALAH') { el.innerHTML = ''; return; }

    // Hitung per kategori dari semua order BERMASALAH yang sudah melewati base filter
    // (tanpa masalah sub-filter supaya count total per kategori tetap kelihatan)
    const q = (document.getElementById('trSearch')?.value || '').toLowerCase();
    const bermasalahOrders = st.orders.filter(o => {
      if (st.storeFilter && o.store_name !== st.storeFilter) return false;
      if (st.ekspedisiFilter && o.ekspedisi !== st.ekspedisiFilter) return false;
      if (st.csFilter.size && !st.csFilter.has(o.cs_nama)) return false;
      if (st.produkFilter && (o.produk || '').split(' + ')[0].trim() !== st.produkFilter) return false;
      if (q && !(String(o.id).toLowerCase().includes(q) || (o.nama||o.buyer||'').toLowerCase().includes(q) || (o.produk||'').toLowerCase().includes(q))) return false;
      return trEffectiveStage(o) === 'BERMASALAH';
    });

    const kategorCounts = {};
    bermasalahOrders.forEach(o => {
      const k = o.masalah_kategori || 'LAINNYA';
      kategorCounts[k] = (kategorCounts[k] || 0) + 1;
    });

    const items = Object.entries(TR_BERMASALAH_KATEGORI_META).map(([key, meta]) => {
      const count = kategorCounts[key] || 0;
      const isActive = st.masalahFilter === key;
      return `
        <div class="tr-sub-card ${isActive ? 'active' : ''}" onclick="trClickMasalahSub('${key}')">
          <div class="tr-sub-icon">${meta.icon}</div>
          <div class="tr-sub-count">${count}</div>
          <div class="tr-sub-label">${meta.label}</div>
        </div>`;
    });

    el.innerHTML = `<div class="tr-sub-grid">${items.join('')}</div>`;
  }

  const AGING_BUCKETS = [
    { key: 'H1', label: 'H+1', icon: '🟢', test: h => h === 1 },
    { key: 'H2', label: 'H+2', icon: '🟡', test: h => h === 2 },
    { key: 'H3', label: 'H+3', icon: '🟠', test: h => h === 3 },
    { key: 'H4', label: 'H+4+', icon: '🔴', test: h => h >= 4 },
  ];

  function getAging(o) {
    if (!o.bermasalah_since) return null;
    const diffMs = Date.now() - new Date(o.bermasalah_since).getTime();
    return Math.max(1, Math.floor(diffMs / 86400000) + 1);
  }

  function renderAgingSubFilter() {
    const el = document.getElementById('trAgingSubFilter');
    if (!el) return;
    if (st.filterStage !== 'BERMASALAH') { el.innerHTML = ''; return; }

    const q = (document.getElementById('trSearch')?.value || '').toLowerCase();
    const bermasalahOrders = st.orders.filter(o => {
      if (st.storeFilter && o.store_name !== st.storeFilter) return false;
      if (st.ekspedisiFilter && o.ekspedisi !== st.ekspedisiFilter) return false;
      if (st.csFilter.size && !st.csFilter.has(o.cs_nama)) return false;
      if (st.produkFilter && (o.produk || '').split(' + ')[0].trim() !== st.produkFilter) return false;
      if (q && !(String(o.id).toLowerCase().includes(q) || (o.nama||o.buyer||'').toLowerCase().includes(q) || (o.produk||'').toLowerCase().includes(q))) return false;
      if (st.masalahFilter && (o.masalah_kategori || 'LAINNYA') !== st.masalahFilter) return false;
      return trEffectiveStage(o) === 'BERMASALAH';
    });

    const agingCounts = {};
    bermasalahOrders.forEach(o => {
      const h = getAging(o);
      if (!h) return;
      const bucket = AGING_BUCKETS.find(b => b.test(h));
      if (bucket) agingCounts[bucket.key] = (agingCounts[bucket.key] || 0) + 1;
    });

    const items = AGING_BUCKETS.map(b => {
      const count = agingCounts[b.key] || 0;
      const isActive = st.agingFilter === b.key;
      return `<div class="tr-tab ${isActive ? 'active' : ''}" onclick="trClickAgingSub('${b.key}')">${b.icon} ${b.label} <span style="font-weight:700">${count}</span></div>`;
    });

    const cekSlCount      = bermasalahOrders.filter(o => o.cek_sl).length;
    const belumJawabCount = bermasalahOrders.filter(o => !o._csResponded).length;
    const sepStyle  = 'align-self:center;width:1px;height:18px;background:var(--border);margin:0 2px';
    const cekSlStyle     = st.cekSlFilter     ? '' : 'border-color:var(--success,#06C270);color:var(--success,#06C270)';
    const belumJawabStyle = st.belumJawabFilter ? '' : 'border-color:var(--danger,#EF233C);color:var(--danger,#EF233C)';
    const extraItems = [
      `<div style="${sepStyle}"></div>`,
      `<div class="tr-tab ${st.cekSlFilter ? 'active' : ''}" onclick="trClickCekSlFilter()" style="${cekSlStyle}">✅ Cek SL <span style="font-weight:700">${cekSlCount}</span></div>`,
      `<div class="tr-tab ${st.belumJawabFilter ? 'active' : ''}" onclick="trClickBelumJawabFilter()" style="${belumJawabStyle}">❌ Belum Dijawab CS <span style="font-weight:700">${belumJawabCount}</span></div>`,
    ];

    el.innerHTML = `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0 10px">${[...items, ...extraItems].join('')}</div>`;
  }

  window.trSetFilter = (key) => {
    st.filterStage = key;
    st.subFilter = null;
    st.masalahFilter = null;
    st.agingFilter = null;
    st.cekSlFilter = false;
    st.belumJawabFilter = false;
    st.page = 1;
    renderTabs();
    applyFilter();
  };
  window.trSetSubFilter = (key) => {
    // toggle: klik lagi = deselect
    st.subFilter = st.subFilter === key ? null : key;
    st.page = 1;
    // update active state sub-cards
    document.querySelectorAll('.tr-sub-card').forEach(el => el.classList.toggle('active', el.getAttribute('onclick') === `trSetSubFilter('${st.subFilter}')`));
    applyFilter();
  };
  window.trClickAgingSub = (key) => {
    st.agingFilter = st.agingFilter === key ? null : key;
    st.page = 1;
    renderAgingSubFilter();
    applyFilter();
  };
  window.trClickCekSlFilter = () => {
    st.cekSlFilter = !st.cekSlFilter;
    st.page = 1;
    renderAgingSubFilter();
    applyFilter();
  };
  window.trClickBelumJawabFilter = () => {
    st.belumJawabFilter = !st.belumJawabFilter;
    st.page = 1;
    renderAgingSubFilter();
    applyFilter();
  };
  window.trClickMasalahSub = (key) => {
    // toggle: klik lagi = deselect
    st.masalahFilter = st.masalahFilter === key ? null : key;
    st.agingFilter = null;
    st.page = 1;
    renderMasalahSubFilter();
    renderAgingSubFilter();
    applyFilter();
  };
  window.trSetMpFilter = (val) => { st.mpFilter = val; st.storeFilter = ''; st.page = 1; load(); };
  window.trSetStoreFilter = (val) => { st.storeFilter = val; st.page = 1; applyFilter(); };
  window.trSetEkspedisiFilter = (val) => { st.ekspedisiFilter = val; st.page = 1; applyFilter(); };
  window.trToggleCSDropdown = (e) => {
    e.stopPropagation();
    const dd = document.getElementById('trCSDropdown');
    if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
  };
  window.trToggleCS = (val, checked) => {
    checked ? st.csFilter.add(val) : st.csFilter.delete(val);
    trUpdateCSLabel();
    st.page = 1; applyFilter();
  };
  window.trCSSelectAll = () => {
    document.querySelectorAll('#trCSDropdown input[type=checkbox]').forEach(cb => { cb.checked = true; st.csFilter.add(cb.value); });
    trUpdateCSLabel(); st.page = 1; applyFilter();
  };
  window.trCSClearAll = () => {
    st.csFilter.clear();
    document.querySelectorAll('#trCSDropdown input[type=checkbox]').forEach(cb => cb.checked = false);
    trUpdateCSLabel(); st.page = 1; applyFilter();
  };
  function trUpdateCSLabel() {
    const el = document.getElementById('trCSLabel');
    if (!el) return;
    el.textContent = st.csFilter.size ? `${st.csFilter.size} CS dipilih` : 'Semua CS';
    el.style.color = st.csFilter.size ? 'var(--primary)' : '';
  }
  document.addEventListener('click', e => {
    if (!document.getElementById('trCSWrap')?.contains(e.target)) {
      const dd = document.getElementById('trCSDropdown');
      if (dd) dd.style.display = 'none';
    }
  });
  window.trSetProdukFilter = (val) => {
    st.produkFilter = val;
    st.page = 1;
    // Sync dropdown supaya selalu sesuai (penting kalau filter di-set dari sidebar, bukan dropdown)
    const sel = document.getElementById('trProdukFilter');
    if (sel) sel.value = val;
    applyFilter();
  };

  function applyFilter() {
    const q = (document.getElementById('trSearch').value || '').toLowerCase();

    // Base list: filter produk/CS/ekspedisi/store/search — TANPA stage filter
    // Ini yang dipakai updateStats() supaya stat cards ikut filter aktif
    const baseList = st.orders.filter(o => {
      if (st.storeFilter && o.store_name !== st.storeFilter) return false;
      if (st.ekspedisiFilter && o.ekspedisi !== st.ekspedisiFilter) return false;
      if (st.csFilter.size && !st.csFilter.has(o.cs_nama)) return false;
      if (st.produkFilter && (o.produk || '').split(' + ')[0].trim() !== st.produkFilter) return false;
      if (q && !(String(o.id).toLowerCase().includes(q) || (o.nama||o.buyer||'').toLowerCase().includes(q) || (o.produk||'').toLowerCase().includes(q))) return false;
      return true;
    });
    updateStats(baseList);

    // List tampilan: base list + stage filter
    const list = baseList.filter(o => {
      const stage = trEffectiveStage(o);
      if (st.filterStage === 'ON_PROSES_GROUP') {
        if (!TR_ON_PROSES_STAGES.includes(stage)) return false;
        if (st.subFilter && stage !== st.subFilter) return false;
      } else if (st.filterStage !== 'SEMUA' && stage !== st.filterStage) return false;
      // Sub-filter kategori masalah: hanya aktif saat tab BERMASALAH
      if (st.filterStage === 'BERMASALAH' && st.masalahFilter) {
        if (!(o.masalah_kategori === st.masalahFilter ||
              (!o.masalah_kategori && st.masalahFilter === 'LAINNYA'))) return false;
      }
      // Sub-filter aging: hanya aktif saat tab BERMASALAH
      if (st.filterStage === 'BERMASALAH' && st.agingFilter) {
        const bucket = AGING_BUCKETS.find(b => b.key === st.agingFilter);
        if (bucket && !bucket.test(getAging(o) || 0)) return false;
      }
      // Filter Cek SL
      if (st.filterStage === 'BERMASALAH' && st.cekSlFilter && !o.cek_sl) return false;
      // Filter Belum Dijawab CS
      if (st.filterStage === 'BERMASALAH' && st.belumJawabFilter && o._csResponded) return false;
      return true;
    });
    // Tab Bermasalah: otomatis urutin yang paling belum ditindak duluan (percobaan/direspon/
    // diinfo kurir paling sedikit) -- biar yang paling butuh perhatian gampang keliatan tanpa
    // perlu kontrol sort manual. Stage lain gak diubah urutannya (tetap by order_date desc
    // dari query).
    if (st.filterStage === 'BERMASALAH') {
      // Urut: yang belum di-cek SL & FU count paling sedikit duluan (paling butuh perhatian)
      const followupScore = o => (o._fuCount || 0) + (o.cek_sl ? 10 : 0);
      list.sort((a, b) => followupScore(a) - followupScore(b));
    }
    // Tab BELUM_DICEK (langsung atau via sub-filter On Proses): resi yang format-nya
    // mencurigakan (order ID Mengantar, salah ekspedisi, dll) naik ke paling atas
    // supaya CS langsung tahu mana yang perlu dikoreksi.
    const isBelumDicekView = st.filterStage === 'BELUM_DICEK' ||
      (st.filterStage === 'ON_PROSES_GROUP' && st.subFilter === 'BELUM_DICEK');
    if (isBelumDicekView) {
      list.sort((a, b) => (trGetResiHint(a) ? 0 : 1) - (trGetResiHint(b) ? 0 : 1));
    }
    st.filteredList = list; // simpan full list untuk Excel export

    const totalPages = Math.max(1, Math.ceil(list.length / st.pageSize));
    if (st.page > totalPages) st.page = totalPages;
    const pageList = list.slice((st.page - 1) * st.pageSize, st.page * st.pageSize);

    document.getElementById('trCount').textContent = `${list.length} pesanan`;
    document.getElementById('trList').innerHTML = pageList.length
      ? pageList.map(o => cardHtml(o)).join('')
      : '<div class="tr-card" style="grid-column:1/-1;text-align:center;color:var(--text-3);cursor:default">Tidak ada data.</div>';

    const pag = document.getElementById('trPagination');
    if (pag) {
      if (totalPages <= 1) { pag.innerHTML = ''; return; }
      const btnStyle = 'padding:6px 14px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text-1);cursor:pointer;font-size:.82rem';
      const disabledStyle = btnStyle + ';opacity:.4;cursor:not-allowed';
      const start = (st.page - 1) * st.pageSize + 1;
      const end   = Math.min(st.page * st.pageSize, list.length);
      pag.innerHTML = `
        <button style="${st.page <= 1 ? disabledStyle : btnStyle}" ${st.page <= 1 ? 'disabled' : ''} onclick="trGoPage(${st.page - 1})">← Sebelumnya</button>
        <span style="font-size:.82rem;color:var(--text-2)">${start}–${end} dari ${list.length} &nbsp;·&nbsp; Hal. ${st.page}/${totalPages}</span>
        <button style="${st.page >= totalPages ? disabledStyle : btnStyle}" ${st.page >= totalPages ? 'disabled' : ''} onclick="trGoPage(${st.page + 1})">Selanjutnya →</button>
      `;
    }
  }
  window.trApplyFilter = applyFilter;
  window.trSearch = () => { st.page = 1; applyFilter(); };
  window.trGoPage = (p) => { st.page = p; applyFilter(); window.scrollTo({ top: document.getElementById('trList')?.offsetTop - 80 || 0, behavior: 'smooth' }); };

  // Export Excel -- ngikutin filter yang lagi aktif (tab/search/toko/ekspedisi/tanggal),
  // bukan seluruh st.orders, biar hasil download = persis yang lagi keliatan di layar.
  window.trDownloadExcel = () => {
    const list = st.filteredList || [];
    if (!list.length) { showToast('Tidak ada data untuk didownload', 'info'); return; }
    const rows = list.map(o => {
      const stage = trEffectiveStage(o);
      const statusLabel = (TR_STAGE_META[stage] || TR_STAGE_META.BELUM_DICEK).label.replace(/^\S+\s*/, '');
      const row = {
        Resi: String(o.id).startsWith('IMP-') ? '' : o.id,
        Tanggal: o.order_date || '',
        Nama: o.nama || o.buyer || '',
      };
      if (cfg.hasMarketplaceFilter) {
        row['Toko'] = o.store_name || '';
        row['Marketplace'] = o.marketplace ? (MP_BADGE[o.marketplace]?.[1] || o.marketplace) : '';
      } else {
        row['No HP'] = o.hp || '';
        row['Alamat'] = o.alamat || '';
      }
      row['Produk'] = o.produk || '';
      row['Qty'] = o.qty || 1;
      row['Total'] = o.total || 0;
      row['Ekspedisi'] = o.ekspedisi || '';
      row['Kota Tujuan'] = o.kota_tujuan || '';
      row['Status'] = statusLabel;
      // status_resi_detail tidak di-fetch saat list (hemat egress) -- kolom Keterangan dikosongkan di export
      row['Keterangan'] = '';
      if (o.cs_nama) row['CS'] = o.cs_nama;
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, cfg.domainLabel);
    XLSX.writeFile(wb, `Tracking-${cfg.domainLabel}-${trYmd(new Date())}.xlsx`);
    showToast(`✅ ${rows.length} data diexport`, 'success');
  };

  function fmtCheckedAt(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    if (isNaN(d)) return null;
    const now = new Date();
    const hm = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const sameYear = d.getFullYear() === now.getFullYear();
    const diffDays = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    if (diffDays === 0) return `Hari ini, ${hm}`;
    if (diffDays === 1) return `Kemarin, ${hm}`;
    const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agt','Sep','Okt','Nov','Des'];
    return `${d.getDate()} ${months[d.getMonth()]}${sameYear ? '' : ' ' + d.getFullYear()}, ${hm}`;
  }

  function cardHtml(o) {
    const stage = trEffectiveStage(o);
    const meta  = TR_STAGE_META[stage] || TR_STAGE_META.BELUM_DICEK;
    const hasResi = !String(o.id).startsWith('IMP-');
    const name  = o.nama || o.buyer || 'Pembeli';
    const sub   = o.store_name || o.hp || '-';
    const initial = name.trim().charAt(0).toUpperCase() || '?';
    const mpBadge = cfg.hasMarketplaceFilter && o.marketplace && MP_BADGE[o.marketplace]
      ? `<span class="badge ${MP_BADGE[o.marketplace][0]}">${MP_BADGE[o.marketplace][1]}</span>` : '';
    const fuLabel = (() => {
      const fc = o._fuCount || 0;
      if (fc >= 4) return '<span class="badge badge-danger">🚨 FU 3 Terkirim</span>';
      if (fc >= 3) return '<span class="badge badge-warning">🔔 FU 2 Terkirim</span>';
      if (fc >= 2) return '<span class="badge badge-warning">📨 FU 1 Terkirim</span>';
      if (fc >= 1) return '<span class="badge badge-gray">📨 FU Info</span>';
      return '';
    })();
    const followupBadge = stage === 'BERMASALAH' ? [
      o.cek_sl ? `<span class="badge badge-success">✅ Cek SL</span>` : '',
      fuLabel,
    ].join('') : '';
    const checkedAt = fmtCheckedAt(o.status_resi_updated_at);
    const checkedLabel = checkedAt
      ? `<div class="tr-checked-at">🕐 Terakhir cek: ${checkedAt}</div>`
      : (stage === 'BELUM_DICEK' ? `<div class="tr-checked-at tr-checked-never">Belum pernah dicek</div>` : '');
    // Label aging BERMASALAH: "Hari ke-1", "Hari ke-2", dst
    let agingLabel = '';
    if (stage === 'BERMASALAH' && o.bermasalah_since) {
      const diffMs = Date.now() - new Date(o.bermasalah_since).getTime();
      const diffDays = Math.floor(diffMs / 86400000);
      const hari = Math.max(1, diffDays + 1); // minimal hari ke-1
      const agingClass = hari >= 4 ? 'tr-aging-danger' : hari >= 2 ? 'tr-aging-warn' : 'tr-aging-ok';
      agingLabel = `<span class="tr-aging ${agingClass}">📅 Hari ke-${hari}</span>`;
    }

    return `<div class="tr-card" onclick="trOpenDetail('${o.id}')">
      <div class="tr-card-top">
        <div class="tr-card-left">
          <div class="tr-avatar" style="background:${trAvatarColor(name)}">${initial}</div>
          <div style="min-width:0">
            <div class="tr-name">${escapeHtml(name)}</div>
            <div class="tr-sub">${escapeHtml(sub)}</div>
            <div class="tr-meta">
              <span class="badge ${meta.badge}">${meta.label}</span>
              ${agingLabel}
              ${mpBadge}
              ${o.ekspedisi ? `<span class="badge badge-gray">${escapeHtml(o.ekspedisi)}</span>` : ''}
              ${o.cs_nama ? `<span class="badge badge-primary">👤 ${escapeHtml(o.cs_nama)}</span>` : ''}
              ${followupBadge}
              ${stage === 'BERMASALAH' && o.masalah_kategori ? `<span class="badge badge-danger">${TR_BERMASALAH_KATEGORI_META[o.masalah_kategori]?.icon || '❓'} ${TR_BERMASALAH_KATEGORI_META[o.masalah_kategori]?.label || o.masalah_kategori}</span>` : ''}
              ${o.redeliver_attempts > 0 ? `<span class="badge badge-warning">🔄 Percobaan pengiriman ulang ke-${o.redeliver_attempts}</span>` : ''}
            </div>
            <div class="tr-produk" title="${escapeHtml(o.produk || '-')}">${escapeHtml(o.produk || '-')} × ${o.qty || 1}</div>
          </div>
        </div>
        <div>
          <div class="tr-price">${fmtFull(o.total || 0)}</div>
          <div class="tr-date">${o.order_date || '-'}</div>
          ${hasResi ? `<div class="tr-resi">${escapeHtml(o.id)}</div>` : ''}
          ${checkedLabel}
        </div>
      </div>
      <div class="tr-divider">${trStepperHtml(stage)}</div>
    </div>`;
  }

  function renderModalBody(o, detail) {
    const stage = trEffectiveStage(o);
    const meta  = TR_STAGE_META[stage] || TR_STAGE_META.BELUM_DICEK;
    const records = detail?.records || [];
    let historyHtml = '<div style="font-size:.78rem;color:var(--text-3);margin-top:12px">Belum ada history — klik "Cek Ulang".</div>';
    if (records.length) {
      const fmtTs = (ts) => {
        if (!ts) return '';
        const d = new Date(ts * 1000);
        if (isNaN(d)) return '';
        const now = new Date();
        const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agt','Sep','Okt','Nov','Des'];
        const hm = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        const diffDays = Math.floor((new Date(now.getFullYear(),now.getMonth(),now.getDate()) - new Date(d.getFullYear(),d.getMonth(),d.getDate())) / 86400000);
        if (diffDays === 0) return `Hari ini ${hm}`;
        if (diffDays === 1) return `Kemarin ${hm}`;
        return `${d.getDate()} ${months[d.getMonth()]} ${hm}`;
      };
      historyHtml = `<div style="margin-top:14px">${records.map((r, i) => {
        const ts = fmtTs(r.actual_time);
        const loc = r.current_location?.location_name;
        const meta = [ts, loc ? escapeHtml(loc) : ''].filter(Boolean).join(' · ');
        return `
        <div class="tr-history-item">
          <div class="tr-history-dot" style="background:${i === 0 ? 'var(--primary)' : 'var(--border)'}"></div>
          <div>
            <div style="font-size:.78rem;${i === 0 ? 'font-weight:700' : ''}">${escapeHtml(r.description || r.tracking_name || '-')}</div>
            ${meta ? `<div style="font-size:.68rem;color:var(--text-3);margin-top:2px">${meta}</div>` : ''}
          </div>
        </div>`;
      }).join('')}</div>`;
    }
    const followupHtml = stage === 'BERMASALAH' ? `
      <div style="margin-top:16px;padding:12px 14px;border-radius:10px;background:var(--bg-2,rgba(0,0,0,.03));border:1px solid var(--border)">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" id="trCekSLCheck" ${o.cek_sl ? 'checked' : ''}
            onchange="trToggleCekSL(this.checked)"
            style="accent-color:var(--primary);width:16px;height:16px;cursor:pointer;flex-shrink:0">
          <span style="font-size:.85rem;font-weight:600">Sudah dicek SL</span>
          ${o.cek_sl ? `<span style="font-size:.72rem;color:var(--success);font-weight:600">✅ Sudah</span>` : `<span style="font-size:.72rem;color:var(--text-3)">Belum</span>`}
        </label>
      </div>
    ` : '';
    const manualHtml = stage === 'MANUAL' ? `
      <div style="margin-top:14px;padding:12px 14px;border-radius:10px;background:rgba(255,140,0,.08);border:1px solid rgba(255,140,0,.25)">
        <div style="font-weight:700;font-size:.82rem;margin-bottom:6px">🔧 Resi Autolaris (COD JNE)</div>
        <div style="font-size:.78rem;color:var(--text-2);line-height:1.5">Resi dengan prefix <strong>AK</strong> hanya bisa dilacak via website Autolaris. Sistem tidak bisa cek otomatis karena proteksi reCAPTCHA.</div>
        <a href="https://autolaris.com/lacak-paket" target="_blank" style="display:inline-block;margin-top:8px;font-size:.78rem;color:var(--primary);text-decoration:none;font-weight:600">🔗 Cek di Autolaris →</a>
      </div>
    ` : '';
    const resiHint = trGetResiHint(o);
    const resiHintHtml = resiHint ? `
      <div style="margin-top:14px;padding:12px 14px;border-radius:10px;background:rgba(239,35,60,.06);border:1px solid rgba(239,35,60,.2)">
        <div style="font-weight:700;font-size:.82rem;margin-bottom:4px">⚠️ ${escapeHtml(resiHint.title)}</div>
        <div style="font-size:.78rem;color:var(--text-2);line-height:1.6">${resiHint.body}</div>
      </div>
    ` : '';
    const EKSPEDISI_LIST = ['JNE','J&T','SICEPAT','ANTERAJA','NINJA','IDEXPRESS','LION','POS','SPX','SAP'];
    const ekspedisiHtml = `
      <div style="margin-top:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:.78rem;color:var(--text-3);white-space:nowrap">Ekspedisi:</span>
        <select id="trEkspedisiSelect" style="font-size:.78rem;padding:4px 8px;border-radius:8px;border:1px solid var(--border);background:var(--input-bg);color:var(--text-1);flex:1;min-width:120px">
          <option value="">— Tidak diketahui —</option>
          ${EKSPEDISI_LIST.map(e => `<option value="${e}" ${o.ekspedisi === e ? 'selected' : ''}>${e}</option>`).join('')}
        </select>
        <button class="btn btn-primary btn-sm" onclick="trSaveEkspedisi()" style="white-space:nowrap">Simpan</button>
      </div>
    `;
    document.getElementById('trkModalBody').innerHTML = `
      <div style="margin-top:10px"><span class="badge ${meta.badge}">${meta.label}</span></div>
      ${stage !== 'MANUAL' ? trStepperHtml(stage) : ''}
      ${ekspedisiHtml}
      ${manualHtml}
      ${resiHintHtml}
      ${followupHtml}
      ${historyHtml}
    `;
  }

  // status_resi_detail TIDAK ada di st.orders (sengaja dikecualikan dari list query untuk hemat
  // egress). Fetch per-order hanya saat modal dibuka -- 1 baris saja, bukan seluruh tabel.
  window.trOpenDetail = async (id) => {
    st.modalId = id;
    const o = st.orders.find(x => String(x.id) === String(id));
    if (!o) return;
    document.getElementById('trkModalTitle').textContent = o.produk || 'Detail Pengiriman';
    document.getElementById('trkModalSub').textContent = o.id + (o.ekspedisi ? ' · ' + o.ekspedisi : '');
    document.getElementById('trkModalBody').innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-3);font-size:.85rem">Memuat detail...</div>';
    document.getElementById('trkModalOverlay').classList.add('open');
    try {
      const full = await dbGetOrderDetail(cfg.table, id);
      // Sync status_resi_detail ke entry di st.orders supaya trManualCheckFromModal tetap jalan
      if (full) Object.assign(o, { status_resi_detail: full.status_resi_detail });
      renderModalBody(o, full?.status_resi_detail);
      const checkBtn = document.getElementById('trkModalCheckBtn');
      if (checkBtn) checkBtn.disabled = trEffectiveStage(o) === 'MANUAL';
    } catch (e) {
      document.getElementById('trkModalBody').innerHTML = `<div style="padding:24px;text-align:center;color:var(--danger);font-size:.85rem">Gagal memuat detail: ${escapeHtml(e.message)}</div>`;
    }
  };

  window.trToggleCekSL = async (checked) => {
    const o = st.orders.find(x => String(x.id) === String(st.modalId));
    if (!o) return;
    try {
      await dbUpdateFollowup(cfg.table, o.id, { cek_sl: checked });
      o.cek_sl = checked;
      // Update label langsung tanpa tutup modal
      const lbl = document.getElementById('trCekSLCheck')?.parentElement?.querySelector('span:last-child');
      if (lbl) {
        lbl.textContent = checked ? '✅ Sudah' : 'Belum';
        lbl.style.color = checked ? 'var(--success)' : 'var(--text-3)';
      }
      applyFilter();
      showToast(checked ? '✅ Sudah dicek SL' : 'Cek SL dibatalkan', 'success');
    } catch (e) {
      showToast('❌ ' + e.message, 'error');
    }
  };

  window.trSaveEkspedisi = async () => {
    const o = st.orders.find(x => String(x.id) === String(st.modalId));
    if (!o) return;
    const val = document.getElementById('trEkspedisiSelect')?.value || '';
    try {
      await dbUpdateFollowup(cfg.table, o.id, { ekspedisi: val || null });
      o.ekspedisi = val || null;
      applyFilter();
      showToast('✅ Ekspedisi disimpan: ' + (val || '—'), 'success');
    } catch (e) {
      showToast('❌ ' + e.message, 'error');
    }
  };

  window.trCloseModal = () => document.getElementById('trkModalOverlay').classList.remove('open');

  async function checkOne(o) {
    const r = await fetch(`/api/tracking-check?table=${cfg.table}&id=${encodeURIComponent(o.id)}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Gagal cek resi');
    Object.assign(o, {
      status_resi: data.stage,
      status_resi_step: data.step,
      status_resi_detail: data.detail,
      status_resi_updated_at: new Date().toISOString(),
    });
    return data;
  }

  window.trManualCheckFromModal = async () => {
    const o = st.orders.find(x => String(x.id) === String(st.modalId));
    if (!o) return;
    try {
      const data = await checkOne(o);
      applyFilter();
      window.trOpenDetail(st.modalId);
      showToast('✅ Status diperbarui: ' + (TR_STAGE_META[data.stage]?.label || data.stage), 'success');
    } catch (e) {
      showToast('❌ ' + e.message, 'error');
    }
  };

  // ── Sync Resi: server-side batch check semua resi aktif (bukan cuma yang di layar) ──
  // Berguna saat webhook Mengantar miss / backlog lama belum terupdate.
  // Tiap klik proses 100 resi; kalau `hasMore: true` otomatis lanjut run berikutnya.
  window.trSyncAllResi = async () => {
    const btn = document.getElementById('trSyncBtn');
    btn.disabled = true;
    let totalUpdated = 0, totalFailed = 0, round = 0;

    // Ambil semua resi BELUM_DICEK dari filter aktif di layar
    const belumDicek = (st.orders || []).filter(o =>
      !o.id.startsWith('IMP-') && (!o.status_resi || o.status_resi === 'BELUM_DICEK')
    );

    try {
      // Cek satu per satu persis seperti tombol "Cek Ulang"
      const BATCH = 5;
      for (let i = 0; i < belumDicek.length; i += BATCH) {
        const chunk = belumDicek.slice(i, i + BATCH);
        btn.textContent = `📡 Sync... (${i}/${belumDicek.length})`;
        await Promise.all(chunk.map(async o => {
          try {
            const r = await fetch(`/api/tracking-check?table=crm_orders&id=${encodeURIComponent(o.id)}`);
            const d = await r.json();
            if (d.stage && d.stage !== 'BELUM_DICEK') totalUpdated++;
            else totalFailed++;
          } catch (_) { totalFailed++; }
        }));
      }

      // Clear cache supaya tracking status terbaru langsung keliatan
      const cacheKey = `cs_orders_${trYmd(st.filterStart)}_${trYmd(st.filterEnd)}`;
      sessionStorage.removeItem(cacheKey);
      await load(true); // reload list tanpa spinner
      applyFilter();
      const msg = `✅ Sync selesai — ${totalUpdated} resi diupdate` +
        (totalFailed ? `, ${totalFailed} belum ada data` : '');
      showToast(msg, totalFailed ? 'warning' : 'success');
    } catch (e) {
      showToast('❌ Sync gagal: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '📡 Sync Resi';
    }
  };

  window.trReload = load; // dipanggil upload-common.js abis upload sukses, biar list ke-refresh

  load();

  // Auto-refresh tiap 60 detik secara silent (tanpa loading spinner)
  setInterval(() => load(true), 60 * 1000);
}

function ensureModal() {
  if (document.getElementById('trkModalOverlay')) return;
  const div = document.createElement('div');
  div.innerHTML = `
    <div class="modal-overlay" id="trkModalOverlay" onclick="if(event.target===this) trCloseModal()">
      <div class="modal" style="max-width:480px">
        <div class="modal-header">
          <h3 id="trkModalTitle">Detail Pengiriman</h3>
          <button class="modal-close" onclick="trCloseModal()">✕</button>
        </div>
        <div class="modal-body">
          <div style="font-size:.78rem;color:var(--text-3)" id="trkModalSub"></div>
          <div id="trkModalBody"></div>
          <div style="display:flex;gap:10px;margin-top:18px">
            <button class="btn btn-secondary" style="flex:1" onclick="trCloseModal()">Tutup</button>
            <button class="btn btn-primary" style="flex:1" id="trkModalCheckBtn" onclick="trManualCheckFromModal()">🔄 Cek Ulang</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(div.firstElementChild);
}
