-- Tambah kolom lapor_type ke room_work
-- 'antar_ulang' | 'konfirmasi_retur' | null (backward compat = antar_ulang)
ALTER TABLE room_work ADD COLUMN IF NOT EXISTS lapor_type text;
