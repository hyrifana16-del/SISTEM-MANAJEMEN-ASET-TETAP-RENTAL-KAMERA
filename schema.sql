create extension if not exists pgcrypto;

create table if not exists kamera (
  id uuid primary key default gen_random_uuid(),
  kode_aset text not null unique,
  merk_model text not null,
  nomor_seri text unique,
  tanggal_perolehan date not null,
  harga_perolehan numeric(14, 2) not null check (harga_perolehan >= 0),
  nilai_residu numeric(14, 2) not null default 0 check (nilai_residu >= 0),
  estimasi_total_hari_sewa integer not null check (estimasi_total_hari_sewa > 0),
  kuantitas integer not null default 1 check (kuantitas > 0),
  status text not null default 'tersedia'
    check (status in ('tersedia', 'disewa', 'perawatan', 'pensiun')),
  created_at timestamptz not null default now(),
  check (nilai_residu <= harga_perolehan)
);

alter table kamera
  add column if not exists kuantitas integer not null default 1 check (kuantitas > 0);

create table if not exists penyewa (
  id uuid primary key default gen_random_uuid(),
  nama text not null,
  nomor_telepon text not null,
  email text,
  nomor_identitas text unique,
  alamat text,
  created_at timestamptz not null default now()
);

create table if not exists transaksi_sewa (
  id uuid primary key default gen_random_uuid(),
  kamera_id uuid not null references kamera(id) on update cascade on delete restrict,
  penyewa_id uuid not null references penyewa(id) on update cascade on delete restrict,
  tanggal_mulai date not null,
  tanggal_selesai date not null,
  durasi_hari integer generated always as (tanggal_selesai - tanggal_mulai) stored,
  total_sewa numeric(14, 2) not null check (total_sewa >= 0),
  status text not null default 'selesai'
    check (status in ('berlangsung', 'selesai', 'dibatalkan')),
  catatan text,
  created_at timestamptz not null default now(),
  check (tanggal_selesai > tanggal_mulai)
);

create table if not exists jurnal_penyusutan (
  id uuid primary key default gen_random_uuid(),
  transaksi_sewa_id uuid not null unique
    references transaksi_sewa(id) on update cascade on delete restrict,
  kamera_id uuid not null references kamera(id) on update cascade on delete restrict,
  tanggal_jurnal date not null default current_date,
  satuan_aktivitas_hari integer not null check (satuan_aktivitas_hari > 0),
  tarif_penyusutan_per_hari numeric(14, 6) not null check (tarif_penyusutan_per_hari >= 0),
  beban_penyusutan numeric(14, 2) not null check (beban_penyusutan >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_transaksi_sewa_kamera on transaksi_sewa(kamera_id);
create index if not exists idx_transaksi_sewa_penyewa on transaksi_sewa(penyewa_id);
create index if not exists idx_transaksi_sewa_tanggal on transaksi_sewa(tanggal_mulai desc);
create index if not exists idx_jurnal_penyusutan_kamera on jurnal_penyusutan(kamera_id);

insert into kamera (
  kode_aset, merk_model, nomor_seri, tanggal_perolehan,
  harga_perolehan, nilai_residu, estimasi_total_hari_sewa, status
) values
  ('CAM-001', 'Canon EOS R6 Mark II', 'CN-R6M2-24001', '2025-01-15', 42500000, 5000000, 1200, 'tersedia'),
  ('CAM-002', 'Sony A7 IV', 'SN-A7IV-24018', '2025-03-08', 38900000, 4500000, 1100, 'tersedia'),
  ('CAM-003', 'Fujifilm X-T5', 'FJ-XT5-24007', '2025-05-22', 27800000, 3000000, 1000, 'perawatan')
on conflict (kode_aset) do nothing;

insert into penyewa (nama, nomor_telepon, email, nomor_identitas, alamat) values
  ('Nadia Putri', '0812-3456-7801', 'nadia@example.com', '3174010101900001', 'Jakarta Selatan'),
  ('Raka Pratama', '0813-7890-1202', 'raka@example.com', '3273011202950002', 'Bandung'),
  ('Studio Lensa', '0821-4567-8903', 'halo@studiolensa.example', '3175020303800003', 'Jakarta Barat')
on conflict (nomor_identitas) do nothing;
