window.RENTAL_SUPABASE_CONFIG = {
  url: "https://poipskdvanesnyzzndut.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvaXBza2R2YW5lc255enpuZHV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0NTIxMjQsImV4cCI6MjEwNjAyODEyNH0.dZLvx-p00rbnqdr1aSNzUhvVt5oinqfle4Jn_NVcubQ"
};

const config = window.RENTAL_SUPABASE_CONFIG;

if (!window.supabase?.createClient) {
  window.SUPABASE_INIT_ERROR = 'Library Supabase belum termuat. Periksa koneksi internet atau muat ulang halaman.';
} else if (!config?.url || !config?.anonKey) {
  window.SUPABASE_INIT_ERROR = 'URL project dan anon key Supabase belum diatur pada backend/app.js.';
} else {
  window.supabaseClient = window.supabase.createClient(config.url, config.anonKey);
}