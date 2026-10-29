// ── Icons (Lucide-style, port dari Marketplace-main/js/app.js) ─────────────────
const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';

const ICON_DASHBOARD = SVG_OPEN + '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>';
const ICON_TRACKING  = SVG_OPEN + '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>';
const ICON_SETTINGS  = SVG_OPEN + '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l-.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
const ICON_CHART     = SVG_OPEN + '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>';
const ICON_MAP       = SVG_OPEN + '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
const ICON_ALERT     = SVG_OPEN + '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

// Sidebar produk di-load dinamis dari sku_produk table via renderLayout(activePage, user, products)

const AVATAR_COLORS = ['#4361EE', '#7B2FBE', '#06C270', '#FFB703', '#EF233C', '#0EA5E9'];

// ── Theme ─────────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  return saved;
}
function toggleDarkMode() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = next === 'dark' ? '☀️' : '🌙';
}

// ── Icons produk kecil ────────────────────────────────────────────────────────
const ICON_BOX = SVG_OPEN + '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';

// ── Layout ────────────────────────────────────────────────────────────────────
// products: array of { kode, nama_produk } dari sku_produk table
function renderLayout(activePage, user, products = []) {
  const theme = initTheme();
  const idx = Math.abs(hashStr(user.id || user.email || '')) % AVATAR_COLORS.length;
  const color = AVATAR_COLORS[idx];
  const initial = (user.name || user.email || '?').trim().charAt(0).toUpperCase();

  // Baca produk aktif dari URL param
  const activeProduk = new URLSearchParams(location.search).get('produk') || '';

  // Build produk sub-items
  const produkItems = products.map(p => {
    const isActive = activePage === 'tracking-crm' && activeProduk === p.nama_produk;
    return `<a href="tracking-crm.html?produk=${encodeURIComponent(p.nama_produk)}"
        class="nav-item nav-item-sub ${isActive ? 'active' : ''}">
      <span class="nav-icon">${ICON_BOX}</span>
      <span>${escapeHtml(p.nama_produk)}</span>
    </a>`;
  }).join('');

  const isCRMAll = activePage === 'tracking-crm' && !activeProduk;

  document.getElementById('sidebar-slot').innerHTML = `
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-logo">
        <img src="img/logo-adsy.png" style="height:34px;width:34px;object-fit:contain;flex-shrink:0">
        <div>
          <div class="logo-text">crm-tracking</div>
          <div style="font-size:.66rem;color:var(--text-3);font-weight:600">Tracking Resi CRM</div>
        </div>
      </div>
      <nav class="sidebar-nav">
        <a href="dashboard.html" class="nav-item ${activePage === 'dashboard' ? 'active' : ''}">
          <span class="nav-icon">${ICON_CHART}</span><span>Dashboard</span>
        </a>
        <div class="sidebar-group-label">CRM</div>
        ${_ON_TRACKING_PAGE ? `
        <a href="#" onclick="sidebarToggleProduk();return false;" class="nav-item ${isCRMAll ? 'active' : ''}" id="sidebar-crm-all">
          <span class="nav-icon">${ICON_TRACKING}</span>
          <span style="flex:1">CRM</span>
          <span id="sidebar-chevron" style="font-size:.7rem;transition:transform .2s;display:inline-block">${activeProduk ? '▾' : '▸'}</span>
        </a>
        <div id="sidebar-products" style="overflow:hidden;max-height:${activeProduk ? '600px' : '0'};transition:max-height .25s ease">${produkItems}</div>
        ` : `
        <a href="tracking-crm.html" class="nav-item">
          <span class="nav-icon">${ICON_TRACKING}</span><span>CRM</span>
        </a>
        `}
        <a href="#" onclick="if(typeof openUploadModal==='function')openUploadModal('crm');return false;"
          class="nav-item" style="color:var(--primary);font-weight:600">
          <span class="nav-icon">📥</span><span>Upload Data CRM</span>
        </a>
        <div class="sidebar-group-label">LAPORAN</div>
        <a href="laporan-wilayah.html" class="nav-item ${activePage === 'laporan-wilayah' ? 'active' : ''}">
          <span class="nav-icon">${ICON_MAP}</span><span>Wilayah</span>
        </a>
        <a href="rincian-paket.html" class="nav-item ${activePage === 'rincian-paket' ? 'active' : ''}">
          <span class="nav-icon">${ICON_ALERT}</span><span>Rincian Paket</span>
        </a>
        <a href="pipeline-undell.html" class="nav-item ${activePage === 'pipeline-undell' ? 'active' : ''}">
          <span class="nav-icon">${ICON_ALERT}</span><span>Pipeline Undell</span>
        </a>
        <div class="sidebar-group-label">ROOM WORK</div>
        <a href="room-work.html" class="nav-item ${activePage === 'room-work' ? 'active' : ''}">
          <span class="nav-icon">${ICON_TRACKING}</span><span>Room Work</span>
        </a>
        <a href="rekap-laporan.html" class="nav-item ${activePage === 'rekap-laporan' ? 'active' : ''}">
          <span class="nav-icon">${ICON_CHART}</span><span>Rekap Laporan</span>
        </a>
        <a href="analitik-roomwork.html" class="nav-item ${activePage === 'analitik-roomwork' ? 'active' : ''}">
          <span class="nav-icon">${ICON_CHART}</span><span>Analitik</span>
        </a>
        <div class="sidebar-group-label">PENGATURAN</div>
        <a href="settings-tim.html" class="nav-item ${activePage === 'settings-tim' ? 'active' : ''}">
          <span class="nav-icon">${ICON_SETTINGS}</span><span>Setting</span>
        </a>
      </nav>
      <div class="sidebar-bottom">
        <div class="user-card" style="cursor:default">
          <div class="user-avatar" style="background:${color}">${initial}</div>
          <div class="user-info">
            <div class="user-name">${escapeHtml(user.name || user.email)}</div>
            <div class="user-role">${user.role === 'admin' ? 'Admin' : 'User'}</div>
          </div>
          <button class="logout-btn" onclick="logout()" title="Logout">⏻</button>
        </div>
      </div>
    </aside>
    <div class="sidebar-overlay" id="sidebarOverlay" onclick="closeSidebar()"></div>
  `;

  // Header title: nama produk kalau ada, else "CRM"
  const headerTitle = activeProduk || 'CRM';
  document.getElementById('header-slot').innerHTML = `
    <header class="topbar">
      <button class="hamburger" onclick="openSidebar()">☰</button>
      <div class="topbar-title">
        <h1>${escapeHtml(headerTitle)}</h1>
        <p class="topbar-date">${formatDate(new Date())}</p>
      </div>
      <div class="topbar-right">
        <button class="theme-toggle" id="themeToggle" onclick="toggleDarkMode()">${theme === 'dark' ? '☀️' : '🌙'}</button>
        <div class="divider-v"></div>
        <div class="topbar-user">
          <div class="user-avatar sm" style="background:${color}">${initial}</div>
          <div>
            <div class="topbar-name">${escapeHtml(user.name || user.email)}</div>
            <div class="topbar-role">${user.role === 'admin' ? 'Admin' : 'User'}</div>
          </div>
        </div>
      </div>
    </header>
  `;
}

// Update sub-item produk di sidebar setelah order di-load
// Dipanggil dari tracking-common.js setelah load() selesai
let _cachedProdukOptions = []; // cache untuk dipakai sidebarSetProduk
function updateSidebarProducts(produkNames) {
  _cachedProdukOptions = produkNames;
  const container = document.getElementById('sidebar-products');
  if (!container) return;
  const activeProduk = new URLSearchParams(location.search).get('produk') || '';
  container.innerHTML = produkNames.map(nama => {
    const isActive = activeProduk === nama;
    return `<a href="#" onclick="sidebarSetProduk(this.dataset.produk);return false;"
        class="nav-item nav-item-sub ${isActive ? 'active' : ''}" data-produk="${escapeHtml(nama)}">
      <span class="nav-icon">${ICON_BOX}</span>
      <span>${escapeHtml(nama)}</span>
    </a>`;
  }).join('');
  // Auto-expand kalau ada produk aktif
  if (activeProduk) _setSidebarOpen(true);
}

const _ON_TRACKING_PAGE = location.pathname.includes('tracking-crm');

function sidebarToggleProduk() {
  if (!_ON_TRACKING_PAGE) { location.href = 'tracking-crm.html'; return; }
  const container = document.getElementById('sidebar-products');
  if (!container) return;
  const isOpen = container.style.maxHeight !== '0px' && container.style.maxHeight !== '0';
  _setSidebarOpen(!isOpen);
  if (isOpen) sidebarSetProduk('');
}

function _setSidebarOpen(open) {
  const container = document.getElementById('sidebar-products');
  const chevron = document.getElementById('sidebar-chevron');
  if (container) container.style.maxHeight = open ? '600px' : '0';
  if (chevron) chevron.style.transform = open ? 'rotate(0deg)' : 'rotate(-90deg)';
}

function sidebarSetProduk(nama) {
  if (!_ON_TRACKING_PAGE) {
    location.href = nama ? `tracking-crm.html?produk=${encodeURIComponent(nama)}` : 'tracking-crm.html';
    return;
  }
  // Update URL dulu sebelum rebuild sidebar (updateSidebarProducts baca URL untuk active state)
  history.pushState({}, '', nama ? `tracking-crm.html?produk=${encodeURIComponent(nama)}` : 'tracking-crm.html');

  // Rebuild sidebar dengan active state yang benar (baca URL baru)
  if (_cachedProdukOptions.length) {
    updateSidebarProducts(_cachedProdukOptions);
  } else {
    document.querySelectorAll('#sidebar-products .nav-item-sub').forEach(el => {
      el.classList.toggle('active', el.dataset.produk === nama);
    });
  }

  const crmAll = document.getElementById('sidebar-crm-all');
  if (crmAll) crmAll.classList.toggle('active', !nama);

  const h1 = document.querySelector('.topbar-title h1');
  if (h1) h1.textContent = nama || 'CRM';

  if (typeof trSetProdukFilter === 'function') trSetProdukFilter(nama);
}

function openSidebar()  { document.getElementById('sidebar')?.classList.add('open'); document.getElementById('sidebarOverlay')?.classList.add('open'); }
function closeSidebar() { document.getElementById('sidebar')?.classList.remove('open'); document.getElementById('sidebarOverlay')?.classList.remove('open'); }

// ── Loading/Error helpers ────────────────────────────────────────────────────
function showLoading(id = 'pageContent') {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="page-loading"><div class="spinner"></div><div>Memuat data...</div></div>`;
}
function showError(msg, id = 'pageContent') {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="page-loading"><div style="font-size:2rem">⚠️</div><div style="color:var(--danger)">${escapeHtml(msg)}</div><button class="btn btn-outline btn-sm" onclick="location.reload()">Coba Lagi</button></div>`;
}

// ── Format helpers ────────────────────────────────────────────────────────────
function formatDate(d) {
  return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function fmtFull(n) { return 'Rp ' + Math.round(n || 0).toLocaleString('id-ID'); }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}

// WIB-aware date helpers (port dari adsycrm-main/js/shared.js) -- dipakai date-range picker
function wibYMD(d = new Date()) {
  const wib = new Date(d.getTime() + 7 * 3600 * 1000);
  return wib.toISOString().slice(0, 10);
}
function wibDayStart(ymd) { return new Date(ymd + 'T00:00:00+07:00'); }
function wibDayEnd(ymd)   { return new Date(ymd + 'T23:59:59+07:00'); }
function wibYMDOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return wibYMD(d);
}

function showToast(msg, type = 'success') {
  const colors = { success: '#06C270', error: '#EF233C', info: '#4361EE' };
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;background:${colors[type] || colors.info};
    color:white;padding:12px 20px;border-radius:12px;font-weight:700;font-size:.875rem;
    box-shadow:0 4px 20px rgba(0,0,0,.25);transition:opacity .3s;`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
}
