-- Tambah kolom notif_investigasi_sent ke room_work
-- Diisi otomatis oleh webhook saat auto investigasi (true = berhasil, false = gagal, null = belum)
ALTER TABLE room_work ADD COLUMN IF NOT EXISTS notif_investigasi_sent boolean DEFAULT null;
