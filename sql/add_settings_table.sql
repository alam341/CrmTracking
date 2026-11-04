-- Tabel settings: key-value store untuk konfigurasi app (template FU, dll)
create table if not exists settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz default now()
);

-- RLS: allow authenticated users read/write
alter table settings enable row level security;
create policy "auth read settings"  on settings for select using (auth.role() = 'authenticated');
create policy "auth write settings" on settings for all    using (auth.role() = 'authenticated');

-- Insert default template FU (bisa di-override lewat UI)
insert into settings (key, value) values
  ('fu_template_info', '⚠️ *[Info] Paket Bermasalah*

Halo [nama_cs]!

Ada paket yang perlu ditindaklanjuti:

👤 Customer: [nama_customer] ([hp_customer])
📦 Produk: [produk]
🔢 Resi: *[resi]*
🚚 Ekspedisi: [ekspedisi]
📍 Kota: [kota]
❌ Kasus: [kasus]

Mohon segera follow up ke kurir ya! 🙏'),
  ('fu_template_fu1', '📨 *[FU 1] Paket Bermasalah*

Halo [nama_cs], mengingatkan:

👤 Customer: [nama_customer] ([hp_customer])
📦 Produk: [produk]
🔢 Resi: *[resi]*
🚚 Ekspedisi: [ekspedisi]
📍 Kota: [kota]
❌ Kasus: [kasus]

Belum ada update — mohon segera dikonfirmasi! 🙏'),
  ('fu_template_fu2', '🔔 *[FU 2] Pengingat Paket Bermasalah*

Halo [nama_cs], mengingatkan kembali:

👤 Customer: [nama_customer] ([hp_customer])
📦 Produk: [produk]
🔢 Resi: *[resi]*
🚚 Ekspedisi: [ekspedisi]
📍 Kota: [kota]
❌ Kasus: [kasus]

Sudah 2 hari belum ada konfirmasi — tolong segera ditindak! 🙏'),
  ('fu_template_fu3', '🚨 *[FU 3 - Terakhir] Paket Bermasalah*

Halo [nama_cs], ini follow up terakhir:

👤 Customer: [nama_customer] ([hp_customer])
📦 Produk: [produk]
🔢 Resi: *[resi]*
🚚 Ekspedisi: [ekspedisi]
📍 Kota: [kota]
❌ Kasus: [kasus]

Harap konfirmasi hari ini ya! 🙏')
on conflict (key) do nothing;
