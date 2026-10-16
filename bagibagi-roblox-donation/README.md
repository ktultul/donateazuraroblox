# Versi Cloudflare (Worker + Durable Objects)

Folder ini adalah pengganti `server/` untuk dijalankan di Cloudflare. Perilaku API-nya sama,
jadi **script Roblox tidak perlu diubah**, kecuali `BASE_URL`.

Antrean donasi disimpan di Durable Object (penyimpanan tahan lama milik Cloudflare), bukan di memori.

## Langkah pemasangan

Butuh: akun Cloudflare (gratis) dan Node.js 20+. Semua perintah dijalankan di terminal, dari folder `cloudflare`.

1. Install alat:
   ```bash
   cd cloudflare
   npm install
   ```
2. (Opsional) Tes di komputer sendiri:
   - Salin `.dev.vars.example` menjadi `.dev.vars`, isi dua rahasianya.
   - Jalankan `npm run dev`, lalu buka `http://localhost:8787/health`.
3. Login ke Cloudflare (browser akan terbuka, klik Allow):
   ```bash
   npx wrangler login
   ```
4. Deploy:
   ```bash
   npm run deploy
   ```
   Di akhir akan tercetak alamat seperti `https://bagibagi-roblox-donation.NAMAKAMU.workers.dev`. Catat.
5. Isi dua rahasia (perintah akan meminta kamu menempel nilainya):
   ```bash
   npx wrangler secret put WEBHOOK_SECRET
   npx wrangler secret put ROBLOX_API_KEY
   ```
   Dua nilai ini harus berbeda dan acak (minimal 24 karakter, tanpa spasi).
6. Cek: buka `https://ALAMATMU.workers.dev/health`, harus muncul `{"status":"ok"}`.
7. Webhook BagiBagi: `https://ALAMATMU.workers.dev/webhook/<WEBHOOK_SECRET>`
8. Roblox: isi `BASE_URL` = `https://ALAMATMU.workers.dev` (tanpa `/` di akhir) dan `API_KEY` = `ROBLOX_API_KEY`.
9. Tes tanpa uang sungguhan, lihat bagian "4. Tes" di README utama (ganti domainnya).

## Melihat payload asli BagiBagi (LOG_RAW)

1. Di `wrangler.jsonc`, ubah `"LOG_RAW": "false"` menjadi `"true"`, lalu `npm run deploy`.
2. Jalankan `npx wrangler tail` (log langsung tampil), lalu buat satu donasi kecil.
3. Sesuaikan `normalizePayload()` di `src/util.js` bila nama field berbeda.
4. Kembalikan `LOG_RAW` ke `"false"` dan deploy lagi.

## Batas paket gratis

Setiap pengecekan dari game = 1 permintaan Worker + 1 permintaan Durable Object.
Dengan `POLL_INTERVAL = 5` ada sekitar 17.000 pengecekan per hari untuk tiap server game yang menyala.
Cek batas harian terbaru di halaman pricing Workers dan Durable Objects. Kalau servermu banyak,
naikkan `POLL_INTERVAL` di script Roblox (mis. 10 detik) atau pakai paket berbayar.

## Deploy otomatis dari GitHub (opsional)

Di dashboard Cloudflare: Workers & Pages → Create → hubungkan repo GitHub, isi **Root directory** dengan
`cloudflare`. Tampilan dashboard bisa berubah, jadi ikuti petunjuk terbaru di sana.
Rahasia tetap diisi lewat `wrangler secret put` atau di Settings → Variables and Secrets.

## Tes

```bash
npm test
```
