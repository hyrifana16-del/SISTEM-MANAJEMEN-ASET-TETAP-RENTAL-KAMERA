const config = window.RENTAL_SUPABASE_CONFIG;
const connectionStatus = document.querySelector('#connection-status');
const notice = document.querySelector('#app-notice');
const rentalForm = document.querySelector('#rental-form');
const cameraForm = document.querySelector('#camera-form');
const tenantForm = document.querySelector('#tenant-form');
const cameraSelect = document.querySelector('#camera-id');
const tenantSelect = document.querySelector('#tenant-id');
const rentalTotalInput = document.querySelector('#rental-total');
const submitButton = rentalForm.querySelector('button[type="submit"]');
const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0
});
const shortDate = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC'
});

let supabaseClient = null;
let cameras = [];
let tenants = [];
let rentals = [];
let journals = [];
let rentedCameraCount = 0;
let activeRentalCounts = new Map();

function showNotice(message, kind = '') {
  notice.textContent = message;
  notice.className = `notice${kind ? ` is-${kind}` : ''}`;
  notice.hidden = false;
}

function setConnection(message, kind = '') {
  connectionStatus.lastElementChild.textContent = message;
  connectionStatus.className = `connection-pill${kind ? ` is-${kind}` : ''}`;
}

function addCell(row, primary, secondary = '') {
  const cell = document.createElement('td');
  if (secondary) {
    const stack = document.createElement('div');
    stack.className = 'asset-cell';
    const mainLine = document.createElement('span');
    mainLine.className = 'asset-name';
    mainLine.textContent = primary;
    const subLine = document.createElement('span');
    subLine.className = 'secondary-line';
    subLine.textContent = secondary;
    stack.append(mainLine, subLine);
    cell.append(stack);
  } else {
    cell.textContent = primary;
  }
  row.append(cell);
}

function setEmptyRow(body, columns, message) {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.className = 'empty-cell';
  cell.colSpan = columns;
  cell.textContent = message;
  row.append(cell);
  body.replaceChildren(row);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return shortDate.format(date);
}

function formatStatus(value) {
  const labels = {
    tersedia: 'Tersedia',
    disewa: 'Disewa',
    perawatan: 'Perawatan',
    pensiun: 'Pensiun',
    berlangsung: 'Berlangsung',
    selesai: 'Selesai',
    dibatalkan: 'Dibatalkan'
  };
  const badge = document.createElement('span');
  badge.className = `status-tag status-${value}`;
  badge.textContent = labels[value] || value;
  return badge;
}

function updateRentalOptions() {
  const selectedCameraId = cameraSelect.value;
  const selectedTenantId = tenantSelect.value;
  const availableCameras = cameras.filter(camera =>
    !['perawatan', 'pensiun'].includes(camera.status)
    && (activeRentalCounts.get(camera.id) || 0) < Number(camera.kuantitas || 1)
  );
  cameraSelect.replaceChildren(new Option('Pilih aset', ''));
  availableCameras.forEach(camera => {
    const availableQuantity = Number(camera.kuantitas || 1) - (activeRentalCounts.get(camera.id) || 0);
    const option = new Option(`${camera.kode_aset} · ${camera.merk_model} (${availableQuantity} tersedia)`, camera.id);
    cameraSelect.add(option);
  });
  cameraSelect.disabled = availableCameras.length === 0;
  cameraSelect.value = availableCameras.some(camera => camera.id === selectedCameraId) ? selectedCameraId : '';

  tenantSelect.replaceChildren(new Option('Pilih penyewa', ''));
  tenants.forEach(tenant => tenantSelect.add(new Option(tenant.nama, tenant.id)));
  tenantSelect.disabled = tenants.length === 0;
  tenantSelect.value = tenants.some(tenant => tenant.id === selectedTenantId) ? selectedTenantId : '';
}

function renderCameras() {
  const body = document.querySelector('#asset-rows');
  const assetQuantity = cameras.reduce((sum, camera) => sum + Number(camera.kuantitas || 1), 0);
  document.querySelector('#asset-count').textContent = `${assetQuantity.toLocaleString('id-ID')} unit`;
  if (!cameras.length) return setEmptyRow(body, 5, 'Belum ada data kamera. Jalankan seed pada schema.sql.');

  const rows = cameras.map(camera => {
    const row = document.createElement('tr');
    addCell(row, camera.merk_model, camera.kode_aset);
    addCell(row, `${Number(camera.kuantitas || 1).toLocaleString('id-ID')} unit`);
    const cost = document.createElement('td');
    cost.className = 'money-cell';
    cost.textContent = rupiah.format(Number(camera.harga_perolehan));
    row.append(cost);
    addCell(row, `${Number(camera.estimasi_total_hari_sewa).toLocaleString('id-ID')} hari`);
    const status = document.createElement('td');
    status.append(formatStatus(camera.status));
    row.append(status);
    return row;
  });
  body.replaceChildren(...rows);
}

function renderJournals() {
  const body = document.querySelector('#journal-rows');
  if (!journals.length) return setEmptyRow(body, 6, 'Jurnal penyusutan akan muncul setelah transaksi dicatat.');

  const cameraById = new Map(cameras.map(camera => [camera.id, camera]));
  const rows = journals.map(journal => {
    const row = document.createElement('tr');
    const camera = cameraById.get(journal.kamera_id);
    addCell(row, formatDate(journal.tanggal_jurnal), journal.transaksi_sewa_id.slice(0, 8).toUpperCase());
    addCell(row, camera?.merk_model || 'Kamera');
    addCell(row, 'Beban Penyusutan');
    addCell(row, 'Akumulasi Penyusutan');
    addCell(row, `${Number(journal.satuan_aktivitas_hari).toLocaleString('id-ID')} hari`);
    const amount = document.createElement('td');
    amount.className = 'money-cell';
    amount.textContent = rupiah.format(Number(journal.beban_penyusutan));
    row.append(amount);
    return row;
  });
  body.replaceChildren(...rows);
}

async function loadAllJournals() {
  const pageSize = 1000;
  const allJournals = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabaseClient.from('jurnal_penyusutan')
      .select('*')
      .order('tanggal_jurnal', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    allJournals.push(...(data || []));
    if (!data || data.length < pageSize) return allJournals;
  }
}

async function memuatPilihanKamera() {
  const { data, error } = await supabaseClient.from('kamera').select('*').order('kode_aset');
  if (error) throw error;
  cameras = data || [];
  renderCameras();
  updateRentalOptions();
}

async function memuatPilihanPenyewa() {
  const { data, error } = await supabaseClient.from('penyewa').select('*').order('nama');
  if (error) throw error;
  tenants = data || [];
  updateRentalOptions();
}

async function tampilkanJurnalPenyusutan() {
  journals = await loadAllJournals();
  renderJournals();
}

function exportJournalCsv() {
  const cameraById = new Map(cameras.map(camera => [camera.id, camera]));
  const csvEscape = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [
    ['Tanggal', 'Nama Aset', 'Akun Debet', 'Akun Kredit', 'Durasi (hari)', 'Nominal (Rp)'],
    ...journals.map(journal => [
      journal.tanggal_jurnal,
      cameraById.get(journal.kamera_id)?.merk_model || 'Kamera',
      'Beban Penyusutan',
      'Akumulasi Penyusutan',
      journal.satuan_aktivitas_hari,
      Number(journal.beban_penyusutan).toFixed(2)
    ])
  ];
  const csvContent = `\uFEFF${rows.map(row => row.map(csvEscape).join(',')).join('\r\n')}`;
  const file = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'file_jurnal_penyusutan.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderRentals() {
  const body = document.querySelector('#transaction-rows');
  document.querySelector('#transaction-count').textContent = `${rentals.length} transaksi`;
  if (!rentals.length) return setEmptyRow(body, 5, 'Belum ada transaksi sewa.');

  const cameraById = new Map(cameras.map(camera => [camera.id, camera]));
  const tenantById = new Map(tenants.map(tenant => [tenant.id, tenant]));
  const activeRentals = rentals.filter(rental => rental.status === 'berlangsung');
  const recentCompletedRentals = rentals
    .filter(rental => rental.status !== 'berlangsung')
    .slice(0, Math.max(0, 6 - activeRentals.length));
  const rows = [...activeRentals, ...recentCompletedRentals].map(rental => {
    const row = document.createElement('tr');
    const tenant = tenantById.get(rental.penyewa_id);
    const camera = cameraById.get(rental.kamera_id);
    addCell(row, tenant?.nama || 'Penyewa', formatStatus(rental.status).textContent);
    addCell(row, camera?.kode_aset || 'Kamera');
    addCell(row, `${formatDate(rental.tanggal_mulai)} – ${formatDate(rental.tanggal_selesai)}`,
      `${Number(rental.durasi_hari).toLocaleString('id-ID')} hari`);
    const amount = document.createElement('td');
    amount.className = 'money-cell';
    amount.textContent = rupiah.format(Number(rental.total_sewa));
    row.append(amount);
    const actionCell = document.createElement('td');
    if (rental.status === 'berlangsung') {
      const returnButton = document.createElement('button');
      returnButton.className = 'button button-primary';
      returnButton.type = 'button';
      returnButton.dataset.returnRentalId = rental.id;
      returnButton.textContent = 'Kamera Kembali';
      actionCell.append(returnButton);
    } else {
      actionCell.textContent = '—';
    }
    row.append(actionCell);
    return row;
  });
  body.replaceChildren(...rows);
}

function renderMetrics() {
  const assetQuantity = cameras.reduce((sum, camera) => sum + Number(camera.kuantitas || 1), 0);
  document.querySelector('#metric-assets').textContent = assetQuantity.toLocaleString('id-ID');
  const acquisitionValue = cameras.reduce((sum, camera) =>
    sum + Number(camera.harga_perolehan) * Number(camera.kuantitas || 1), 0
  );
  document.querySelector('#metric-value').textContent = rupiah.format(acquisitionValue);
  document.querySelector('#metric-rentals').textContent = rentedCameraCount.toLocaleString('id-ID');
  const depreciation = journals.reduce((sum, journal) => sum + Number(journal.beban_penyusutan), 0);
  document.querySelector('#metric-depreciation').textContent = rupiah.format(depreciation);
}

async function loadDashboard() {
  const [, , activeRentalResult, rentalResult] = await Promise.all([
    memuatPilihanKamera(),
    memuatPilihanPenyewa(),
    supabaseClient.from('transaksi_sewa').select('*').eq('status', 'berlangsung').order('tanggal_mulai', { ascending: false }),
    supabaseClient.from('transaksi_sewa').select('*').order('tanggal_mulai', { ascending: false }).limit(20),
    tampilkanJurnalPenyusutan()
  ]);
  const failedResult = [activeRentalResult, rentalResult].find(result => result.error);
  if (failedResult) throw failedResult.error;

  const activeRentals = activeRentalResult.data || [];
  rentedCameraCount = activeRentals.length;
  activeRentalCounts = new Map();
  activeRentals.forEach(rental => {
    activeRentalCounts.set(rental.kamera_id, (activeRentalCounts.get(rental.kamera_id) || 0) + 1);
  });
  const rentalsById = new Map((rentalResult.data || []).map(rental => [rental.id, rental]));
  activeRentals.forEach(rental => rentalsById.set(rental.id, rental));
  rentals = [...rentalsById.values()].sort((left, right) =>
    right.tanggal_mulai.localeCompare(left.tanggal_mulai)
  );
  renderCameras();
  renderRentals();
  renderJournals();
  renderMetrics();
  updateRentalOptions();
  updateDepreciationPreview();
}

function rentalDurationDays() {
  const start = document.querySelector('#start-date').value;
  const end = document.querySelector('#end-date').value;
  if (!start || !end) return 0;
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}

function depreciationFor(camera, activityDays) {
  const depreciableBase = Math.max(0, Number(camera.harga_perolehan) - Number(camera.nilai_residu));
  const ratePerDay = depreciableBase / Number(camera.estimasi_total_hari_sewa);
  return { ratePerDay, amount: Math.round(ratePerDay * activityDays) };
}

function updateDepreciationPreview() {
  const preview = document.querySelector('#preview-amount');
  const camera = cameras.find(item => item.id === cameraSelect.value);
  const days = rentalDurationDays();
  if (days < 0) {
    preview.textContent = 'Tanggal selesai harus setelah tanggal mulai';
    return;
  }
  if (!camera || days === 0) {
    preview.textContent = 'Pilih kamera dan tanggal';
    return;
  }
  const depreciation = depreciationFor(camera, days);
  preview.textContent = `${rupiah.format(depreciation.amount)} · ${days} hari`;
}

function updateRentalTotal() {
  const selectedCamera = cameraSelect.selectedOptions[0];
  const selectedCameraName = cameras.find(camera => camera.id === cameraSelect.value)?.merk_model
    || selectedCamera?.textContent
    || '';
  const normalizedName = selectedCameraName.toLocaleLowerCase('id-ID');
  const dailyRate = normalizedName.includes('canon')
    ? 500000
    : normalizedName.includes('sony')
      ? 450000
      : 350000;
  const days = rentalDurationDays();

  rentalTotalInput.value = cameraSelect.value && days > 0
    ? String(dailyRate * days)
    : '';
}

function updateRentalFormPreviews() {
  updateDepreciationPreview();
  updateRentalTotal();
}

async function saveRental(event) {
  event.preventDefault();
  updateRentalTotal();
  const formData = new FormData(rentalForm);
  const camera = cameras.find(item => item.id === formData.get('kamera_id'));
  const days = rentalDurationDays();
  const total = Number(formData.get('total_sewa'));
  if (!camera) return showNotice('Pilih kamera yang tersedia sebelum menyimpan transaksi.', 'error');
  if (days <= 0) return showNotice('Tanggal selesai harus sesudah tanggal mulai.', 'error');
  if (!Number.isFinite(total) || total < 0) return showNotice('Total sewa harus berupa angka nol atau lebih.', 'error');

  const depreciation = depreciationFor(camera, days);
  submitButton.disabled = true;
  submitButton.lastElementChild.textContent = 'Menyimpan...';
  try {
    const rentalResult = await supabaseClient.from('transaksi_sewa').insert({
      kamera_id: camera.id,
      penyewa_id: formData.get('penyewa_id'),
      tanggal_mulai: formData.get('tanggal_mulai'),
      tanggal_selesai: formData.get('tanggal_selesai'),
      total_sewa: total,
      status: 'berlangsung',
      catatan: formData.get('catatan') || null
    }).select('id').single();
    if (rentalResult.error) throw rentalResult.error;

    const cameraResult = await supabaseClient.from('kamera')
      .update({
        status: (activeRentalCounts.get(camera.id) || 0) + 1 >= Number(camera.kuantitas || 1)
          ? 'disewa'
          : 'tersedia'
      })
      .eq('id', camera.id)
      .select('id')
      .single();
    if (cameraResult.error) {
      throw new Error(`Transaksi tersimpan, tetapi status kamera gagal diperbarui: ${cameraResult.error.message}`);
    }

    const journalResult = await supabaseClient.from('jurnal_penyusutan').upsert({
      transaksi_sewa_id: rentalResult.data.id,
      kamera_id: camera.id,
      tanggal_jurnal: formData.get('tanggal_selesai'),
      satuan_aktivitas_hari: days,
      tarif_penyusutan_per_hari: depreciation.ratePerDay,
      beban_penyusutan: depreciation.amount
    }, { onConflict: 'transaksi_sewa_id' });
    if (journalResult.error) {
      showNotice(`Transaksi tersimpan, tetapi jurnal belum tersimpan: ${journalResult.error.message}. Periksa izin tabel jurnal_penyusutan di Supabase.`, 'error');
    } else {
      showNotice(`Transaksi tersimpan. Beban penyusutan ${days} hari sebesar ${rupiah.format(depreciation.amount)} telah dijurnal.`, 'success');
    }

    rentalForm.reset();
    updateRentalFormPreviews();
    await loadDashboard();
  } catch (error) {
    const message = error.message.startsWith('Transaksi tersimpan,')
      ? error.message
      : `Transaksi gagal disimpan: ${error.message}`;
    showNotice(message, 'error');
  } finally {
    submitButton.disabled = false;
    submitButton.lastElementChild.textContent = 'Simpan transaksi';
  }
}

async function saveCamera(event) {
  event.preventDefault();
  const formData = new FormData(cameraForm);
  const acquisitionCost = Number(formData.get('harga_perolehan'));
  const residualValue = Number(formData.get('nilai_residu'));
  const activityQuota = Number(formData.get('total_kuota_hari'));
  const cameraName = formData.get('nama_kamera').trim();
  if (residualValue > acquisitionCost) {
    return showNotice('Nilai residu tidak boleh lebih besar dari harga perolehan.', 'error');
  }

  const button = cameraForm.querySelector('button[type="submit"]');
  button.disabled = true;
  button.lastElementChild.textContent = 'Menyimpan...';
  try {
    const existingCamera = cameras.find(camera =>
      camera.merk_model.trim().toLocaleLowerCase('id-ID') === cameraName.toLocaleLowerCase('id-ID')
    );
    let cameraId;
    if (existingCamera) {
      const { data, error } = await supabaseClient.from('kamera')
        .update({ kuantitas: Number(existingCamera.kuantitas || 1) + 1 })
        .eq('id', existingCamera.id)
        .select('id')
        .single();
      if (error) throw error;
      cameraId = data.id;
    } else {
      const { data, error } = await supabaseClient.from('kamera').insert({
        kode_aset: `CAM-${Date.now()}`,
        merk_model: cameraName,
        tanggal_perolehan: new Date().toISOString().slice(0, 10),
        harga_perolehan: acquisitionCost,
        nilai_residu: residualValue,
        estimasi_total_hari_sewa: activityQuota,
        kuantitas: 1
      }).select('id').single();
      if (error) throw error;
      cameraId = data.id;
    }

    cameraForm.reset();
    try {
      await loadDashboard();
      cameraSelect.value = cameraId;
      updateRentalFormPreviews();
      showNotice(existingCamera
        ? `Stok ${cameraName} berhasil ditambah menjadi ${Number(existingCamera.kuantitas || 1) + 1} unit.`
        : 'Aset kamera berhasil ditambahkan dan tersedia pada pilihan transaksi sewa.', 'success');
    } catch (refreshError) {
      showNotice(`Aset berhasil disimpan, tetapi dashboard gagal diperbarui: ${refreshError.message}`, 'error');
    }
  } catch (error) {
    showNotice(`Aset kamera gagal disimpan: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
    button.lastElementChild.textContent = 'Simpan aset kamera';
  }
}

async function returnRental(rentalId, button) {
  const rental = rentals.find(item => item.id === rentalId && item.status === 'berlangsung');
  if (!rental) return showNotice('Transaksi aktif tidak ditemukan. Muat ulang data dan coba lagi.', 'error');
  const camera = cameras.find(item => item.id === rental.kamera_id);
  if (!camera) return showNotice('Data kamera untuk transaksi ini tidak ditemukan.', 'error');

  button.disabled = true;
  button.textContent = 'Memproses...';
  try {
    const cameraResult = await supabaseClient.from('kamera')
      .update({ status: 'tersedia' })
      .eq('id', camera.id)
      .select('id')
      .single();
    if (cameraResult.error) throw cameraResult.error;

    const rentalResult = await supabaseClient.from('transaksi_sewa')
      .update({ status: 'selesai' })
      .eq('id', rental.id)
      .eq('status', 'berlangsung')
      .select('id')
      .single();
    if (rentalResult.error) {
      const rollbackResult = await supabaseClient.from('kamera')
        .update({ status: camera.status })
        .eq('id', camera.id);
      if (rollbackResult.error) {
        throw new Error(`Status kamera sudah diperbarui, tetapi transaksi gagal ditandai selesai (${rentalResult.error.message}) dan pemulihan status kamera gagal (${rollbackResult.error.message}).`);
      }
      throw rentalResult.error;
    }
  } catch (error) {
    showNotice(`Pengembalian kamera gagal diproses: ${error.message}`, 'error');
    button.disabled = false;
    button.textContent = 'Kamera Kembali';
    return;
  }

  try {
    await loadDashboard();
    showNotice('Kamera berhasil dikembalikan. Transaksi ditandai selesai dan data tetap tersimpan untuk audit.', 'success');
  } catch (error) {
    showNotice(`Kamera berhasil dikembalikan, tetapi dashboard gagal diperbarui: ${error.message}`, 'error');
  }
}

async function saveTenant(event) {
  event.preventDefault();
  const formData = new FormData(tenantForm);
  const button = tenantForm.querySelector('button[type="submit"]');
  button.disabled = true;
  button.lastElementChild.textContent = 'Menyimpan...';
  try {
    const { data, error } = await supabaseClient.from('penyewa').insert({
      nama: formData.get('nama_penyewa').trim(),
      nomor_telepon: formData.get('nomor_telepon').trim()
    }).select('id').single();
    if (error) throw error;

    tenantForm.reset();
    try {
      await loadDashboard();
      tenantSelect.value = data.id;
      showNotice('Penyewa berhasil ditambahkan dan tersedia pada pilihan transaksi sewa.', 'success');
    } catch (refreshError) {
      showNotice(`Penyewa berhasil disimpan, tetapi dashboard gagal diperbarui: ${refreshError.message}`, 'error');
    }
  } catch (error) {
    showNotice(`Penyewa gagal disimpan: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
    button.lastElementChild.textContent = 'Simpan penyewa';
  }
}

function initialize() {
  const currentDate = new Date();
  rentalTotalInput.readOnly = true;
  const greetingHour = currentDate.getHours();
  const greetingTime = greetingHour < 11 ? 'pagi'
    : greetingHour < 15 ? 'siang'
      : greetingHour < 19 ? 'sore'
        : 'malam';
  document.querySelector('#work-greeting').textContent =
    `· Selamat ${greetingTime}, Admin Rifana! Siap mengelola aset hari ini?`;
  document.querySelector('#today-label').textContent = new Intl.DateTimeFormat('id-ID', {
    month: 'long', year: 'numeric'
  }).format(currentDate).toUpperCase();
  document.querySelector('#start-date').value = currentDate.toISOString().slice(0, 10);
  document.querySelector('#end-date').value = new Date(currentDate.getTime() + 86400000).toISOString().slice(0, 10);

  if (window.lucide) window.lucide.createIcons();
  if (!window.isSupabaseConfigured || !window.isSupabaseConfigured()) {
    setConnection('Konfigurasi diperlukan', 'error');
    showNotice('Isi URL project dan anon key Supabase pada backend/app.js, lalu jalankan SQL database/schema.sql di Supabase SQL Editor.', 'error');
    setEmptyRow(document.querySelector('#asset-rows'), 5, 'Hubungkan project Supabase untuk memuat inventaris.');
    setEmptyRow(document.querySelector('#journal-rows'), 4, 'Hubungkan project Supabase untuk memuat jurnal.');
    setEmptyRow(document.querySelector('#transaction-rows'), 5, 'Hubungkan project Supabase untuk memuat transaksi.');
    cameraSelect.disabled = true;
    tenantSelect.disabled = true;
    submitButton.disabled = true;
    return;
  }
  if (!window.supabase?.createClient) {
    setConnection('CDN tidak tersedia', 'error');
    showNotice('Library Supabase belum termuat. Periksa koneksi internet atau muat ulang halaman.', 'error');
    return;
  }

  supabaseClient = window.supabase.createClient(config.url, config.anonKey);
  setConnection('Menghubungkan...');
  loadDashboard().then(() => setConnection('Supabase terhubung', 'connected')).catch(error => {
    setConnection('Gagal terhubung', 'error');
    showNotice(`Data gagal dimuat: ${error.message}. Pastikan schema.sql sudah dijalankan dan akses tabel tersedia.`, 'error');
    setEmptyRow(document.querySelector('#asset-rows'), 5, 'Tidak dapat memuat inventaris.');
    setEmptyRow(document.querySelector('#journal-rows'), 4, 'Tidak dapat memuat jurnal.');
    setEmptyRow(document.querySelector('#transaction-rows'), 5, 'Tidak dapat memuat transaksi.');
  });
}

cameraSelect.addEventListener('change', updateRentalFormPreviews);
document.querySelector('#start-date').addEventListener('change', updateRentalFormPreviews);
document.querySelector('#end-date').addEventListener('change', updateRentalFormPreviews);
rentalForm.addEventListener('submit', saveRental);
cameraForm.addEventListener('submit', saveCamera);
tenantForm.addEventListener('submit', saveTenant);
document.querySelector('#export-journal').addEventListener('click', exportJournalCsv);
document.querySelector('#transaction-rows').addEventListener('click', event => {
  const button = event.target.closest('[data-return-rental-id]');
  if (button) returnRental(button.dataset.returnRentalId, button);
});
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach(item => item.classList.remove('is-active'));
    link.classList.add('is-active');
  });
});

initialize();
