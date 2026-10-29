// Expose Supabase URL + anon key ke browser dari Vercel Environment Variables.
// Anon key aman di-expose (akses sebenarnya dibatasi RLS di sql/001_init.sql) --
// tapi dengan pola ini nilainya gak perlu ke-commit ke git sama sekali, tinggal
// diisi lewat Vercel dashboard dan gampang diganti tanpa commit baru.
// Port dari adsycrm-main/api/config.js.
module.exports = function handler(req, res) {
  res.status(200).json({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  });
};
