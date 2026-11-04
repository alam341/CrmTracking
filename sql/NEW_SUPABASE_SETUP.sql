-- ============================================================
-- CRM TRACKING — Setup Supabase Baru
-- Jalankan ini di SQL Editor Supabase project baru
-- ============================================================

-- 1. Profiles (auth users)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  role text not null default 'user' check (role in ('admin','user')),
  created_at timestamptz default now()
);
alter table profiles enable row level security;
create policy "User baca profil sendiri" on profiles for select using (auth.uid() = id);
create policy "Admin baca semua profil" on profiles for select using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
create policy "User insert profil sendiri" on profiles for insert with check (auth.uid() = id);
create policy "User update profil sendiri" on profiles for update using (auth.uid() = id);
create policy "Service role full access profiles" on profiles for all using (auth.role() = 'service_role');

-- Auto-create profile saat user baru register
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, email, name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), 'user')
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- 2. Tabel tracking order CRM (upload-based + webhook update)
create table if not exists crm_orders (
  id text primary key,                          -- nomor resi
  order_date date,
  nama text,                                    -- nama pembeli
  hp text,                                      -- no HP pembeli
  alamat text,
  kota_tujuan text,
  produk text,
  qty int default 1,
  total bigint default 0,
  ekspedisi text,
  cs_nama text,                                 -- nama CS yang handle order
  status_resi text,
  status_resi_step int,
  status_resi_updated_at timestamptz,
  status_resi_detail jsonb,                     -- raw response kurir + bermasalah_since + records
  cek_sl boolean default false,                 -- flag manual: perlu cek SL
  followup_attempts int default 0,
  followup_responded boolean default false,
  followup_courier_notified boolean default false,
  upload_batch_id text,                         -- dari upload_batches.id
  uploaded_by uuid references profiles(id),
  created_at timestamptz default now()
);
alter table crm_orders enable row level security;
create policy "Authenticated baca crm_orders" on crm_orders for select using (auth.role() = 'authenticated');
create policy "Authenticated insert crm_orders" on crm_orders for insert with check (auth.role() = 'authenticated');
create policy "Authenticated update crm_orders" on crm_orders for update using (auth.role() = 'authenticated');
create policy "Authenticated delete crm_orders" on crm_orders for delete using (auth.role() = 'authenticated');

-- Service role (webhook Vercel) boleh insert/update tanpa auth session
create policy "Service role full access crm_orders" on crm_orders for all using (auth.role() = 'service_role');

-- Index performa
create index if not exists idx_crm_orders_order_date on crm_orders(order_date desc);
create index if not exists idx_crm_orders_status on crm_orders(status_resi);
create index if not exists idx_crm_orders_updated on crm_orders(status_resi_updated_at asc nulls first);
create index if not exists idx_crm_orders_ekspedisi on crm_orders(ekspedisi);
create index if not exists idx_crm_orders_batch on crm_orders(upload_batch_id);


-- 3. Upload batches — history upload Excel per domain
create table if not exists upload_batches (
  id text primary key,                          -- BATCH-CRM-<timestamp>
  domain text not null default 'crm',
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz default now(),
  record_count int default 0,
  marketplace text,                             -- kosong untuk CRM
  store_name text                               -- kosong untuk CRM
);
alter table upload_batches enable row level security;
create policy "Authenticated baca upload_batches" on upload_batches for select using (auth.role() = 'authenticated');
create policy "Authenticated insert upload_batches" on upload_batches for insert with check (auth.role() = 'authenticated');
create policy "User hapus batch sendiri" on upload_batches for delete using (
  auth.uid() = uploaded_by OR
  exists (select 1 from profiles where id = auth.uid() and role in ('admin'))
);
create policy "Authenticated update upload_batches" on upload_batches for update using (auth.role() = 'authenticated');


-- 4. Room Work — follow up paket bermasalah
create table if not exists room_work (
  id bigint generated always as identity primary key,
  resi text not null,
  cs_nama text, cs_no_wa text,
  nama_pembeli text, hp_pembeli text,
  produk text, ekspedisi text, kota_tujuan text, case_undel text,
  created_at timestamptz default now(),
  fu_info_at timestamptz,
  fu_1_at timestamptz,
  fu_2_at timestamptz,
  fu_3_at timestamptz,
  fu_count int default 0,
  cs_responded boolean default false,
  cs_responded_at timestamptz,
  lapor_ekspedisi boolean default false,
  lapor_ekspedisi_at timestamptz,
  investigasi boolean default false,
  investigasi_at timestamptz,
  auto_resolved boolean default false,
  auto_resolved_at timestamptz,
  notes text,
  unique(resi)
);
alter table room_work enable row level security;
create policy "Authenticated baca room_work" on room_work for select using (auth.role() = 'authenticated');
create policy "Authenticated insert room_work" on room_work for insert with check (auth.role() = 'authenticated');
create policy "Authenticated update room_work" on room_work for update using (auth.role() = 'authenticated');
create policy "Service role full access room_work" on room_work for all using (auth.role() = 'service_role');

create index if not exists idx_room_work_resi on room_work(resi);
create index if not exists idx_room_work_created on room_work(created_at desc);


-- 5. Team members (CS CRM) — dikelola dari settings-tim.html
create table if not exists team_members (
  id bigint generated always as identity primary key,
  nama text not null,
  no_wa text,
  role text default 'cs',
  aktif boolean default true,
  created_at timestamptz default now()
);
alter table team_members enable row level security;
create policy "Authenticated baca team_members" on team_members for select using (auth.role() = 'authenticated');
create policy "Admin kelola team_members" on team_members for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
create policy "Service role full access team_members" on team_members for all using (auth.role() = 'service_role');


-- 6. Master produk — sumber sidebar menu dinamis
create table if not exists sku_produk (
  kode text primary key,
  nama_produk text not null,
  urutan int default 99,
  aktif boolean default true,
  created_at timestamptz default now()
);
alter table sku_produk enable row level security;
create policy "Authenticated baca sku_produk" on sku_produk for select using (auth.role() = 'authenticated');
create policy "Admin kelola sku_produk" on sku_produk for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- Isi produk awal (sesuaikan dengan produk CRM team)
insert into sku_produk (kode, nama_produk, urutan) values
  ('PRIMA',  'PRIMAGOLD',                1),
  ('HRB',    'HERBAPIL',                 2),
  ('NMA',    'NUMATA',                   3),
  ('MIS',    'MISOHWA',                  4),
  ('MAK',    'MAKSIR',                   5),
  ('MOM',    'MOMTAZA',                  6),
  ('MRP',    'MISTER PRIMA',             7),
  ('VAS',    'VASCO',                    8),
  ('ONR',    'ONAIRE',                   9),
  ('ORI',    'OIRI',                    10),
  ('YOU',    'YOUZHI',                  11),
  ('TBY',    'TUBE YOUZHI',             12),
  ('KOI',    'KOPI KOIKOHI',            13),
  ('PROV',   'PROVIT',                  14),
  ('JWR',    'JAWARA',                  15),
  ('BAJ',    'BAJAKAH PREMIUM',         16),
  ('IDS',    'IWE DARKEN SHAMPO',       17),
  ('MSR',    'MY IWE HAIR',             18),
  ('NSR',    'Serum Notelli',           19),
  ('GS',     'GULA SEMUT "150',         20),
  ('GENDIS', 'GS 200',                  21),
  ('TEH',    'TEH  BIASA',              22),
  ('TM',     'TEH MINI 7',              23),
  ('NRA',    'TEH NOARDIK',             24),
  ('CANA',   'CANA',                    25),
  ('DAL',    'MENDIDIK ANAK LAKI LAKI', 26),
  ('DAP',    'MENDIDIK ANAK PEREMPUAN', 27),
  ('MPA',    'MENGENAL PRIBADI AGUNG',  28),
  ('NTS',    'BUKU',                    29),
  ('SPN',    'TAS SPOUNBOND',           30)
on conflict (kode) do update set nama_produk = excluded.nama_produk, urutan = excluded.urutan;
