// Notif WA via Fonnte -- dibangun tapi AKTIVASINYA DITUNDA (lihat task 8 / step 7 plan).
// Aman no-op selama FONNTE_TOKEN belum di-set di environment variables.
// Port dari Marketplace-main/api/cron-check-resi.js.

async function sendFonnteWA(target, message) {
  if (!process.env.FONNTE_TOKEN || !target) return;
  const body = new URLSearchParams({ target, message }).toString();
  await fetch('https://api.fonnte.com/send', {
    method: 'POST',
    headers: { Authorization: process.env.FONNTE_TOKEN, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}

module.exports = { sendFonnteWA };
