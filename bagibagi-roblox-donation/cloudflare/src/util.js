// Fungsi bantu (dipindahkan dari server/index.js versi Express).

// Bandingkan lewat hash agar panjang berbeda tidak bocor & waktu perbandingan konstan.
export async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(a))),
    crypto.subtle.digest('SHA-256', enc.encode(String(b))),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export function cleanText(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function toAmount(value) {
  if (typeof value === 'number') return Math.floor(value);
  // Rupiah tidak punya desimal: "10.000", "10,000", "Rp 10.000" -> 10000
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
}

/**
 * Ubah payload webhook menjadi bentuk standar.
 * Nama field dibuat toleran karena dokumentasi resmi payload BagiBagi
 * belum bisa diverifikasi. Jalankan dengan LOG_RAW=true, lakukan 1 donasi
 * uji, lalu sesuaikan daftar key di sini bila perlu.
 */
export function normalizePayload(body) {
  if (!body || typeof body !== 'object') return null;
  const src = body.data && typeof body.data === 'object' ? { ...body, ...body.data } : body;

  const amount = toAmount(pick(src, ['amount', 'nominal', 'total', 'price']));
  if (!(amount > 0)) return null;

  return {
    name:
      cleanText(
        pick(src, ['name', 'donator_name', 'donor_name', 'donator', 'donor', 'from']),
        40
      ) || 'Anonim',
    amount,
    message: cleanText(pick(src, ['message', 'pesan', 'note', 'comment']), 200),
    externalId: cleanText(
      pick(src, ['id', 'uuid', 'transaction_id', 'order_id', 'donation_id']),
      80
    ),
  };
}
