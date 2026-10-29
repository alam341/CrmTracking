// HTTP mentah aja ke tiap sumber tracking -- TIDAK ada logic penentu stage di sini.
// Port dari adsycrm-main/lib/mengantar.js + Marketplace-main/api/cron-check-resi.js.
// Pakai global fetch (tersedia native di runtime Node Vercel).

async function fetchMengantar(trackingNumber, courier) {
  const url = `https://app.mengantar.com/api/order/getPublic?tracking_number=${encodeURIComponent(trackingNumber)}&courier=${encodeURIComponent(courier)}`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      Accept: 'application/json',
      Referer: 'https://www.mengantar.com/',
      Origin: 'https://www.mengantar.com',
    },
  });
  return r.json();
}

async function fetchPos(resi) {
  const body = new URLSearchParams({ kode_booking: resi }).toString();
  const r = await fetch('https://www.bosampuh.id/api_home/lacak_kiriman', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36',
      Referer: 'https://www.bosampuh.id/',
      Origin: 'https://www.bosampuh.id',
    },
    body,
  });
  const raw = await r.text();
  // bosampuh.id kadang balikin JSON yang di-double-encode (string JSON isi JSON lagi).
  return typeof raw === 'string' && raw.startsWith('"') ? JSON.parse(JSON.parse(raw)) : JSON.parse(raw);
}

async function fetchSpx(resi) {
  const url = `https://spx.co.id/shipment/order/open/order/get_order_info?spx_tn=${encodeURIComponent(resi)}&language_code=id`;
  const r = await fetch(url, {
    headers: {
      accept: 'application/json, text/plain, */*',
      referer: `https://spx.co.id/track?${encodeURIComponent(resi)}`,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  return r.json();
}

module.exports = { fetchMengantar, fetchPos, fetchSpx };
