window.RENTAL_SUPABASE_CONFIG = {
  url: "https://poipskdvanesnyzzndut.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvaXBza2R2YW5lc255enpuZHV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0NTIxMjQsImV4cCI6MjEwNjAyODEyNH0.dZLvx-p00rbnqdr1aSNzUhvVt5oinqfle4Jn_NVcubQ"
};

window.isSupabaseConfigured = function () {
  return Boolean(
    window.RENTAL_SUPABASE_CONFIG.url &&
    window.RENTAL_SUPABASE_CONFIG.anonKey &&
    !window.RENTAL_SUPABASE_CONFIG.url.includes("YOUR_PROJECT_ID") &&
    !window.RENTAL_SUPABASE_CONFIG.anonKey.includes("YOUR_SUPABASE_ANON_KEY")
  );
};