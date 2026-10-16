# BagiBagi → Roblox Donation Alert

Notifikasi donasi [BagiBagi](https://bagibagi.co) yang muncul langsung di game Roblox.
Setiap kali ada donasi masuk, semua pemain di server game melihat kartu notifikasi berisi nama donatur, nominal, dan pesan.

```
 Donatur ──► BagiBagi ──webhook──► Server (Node.js) ◄──poll tiap 5 dtk── Server game Roblox ──► Notifikasi di pemain
                                   antrean + kursor                       (HttpService)
```

Roblox tidak bisa menerima request masuk, jadi alurnya: BagiBagi mengirim webhook ke server kecil milikmu,
lalu game Roblox yang **menarik (poll)** donasi baru dari server tersebut.

## Isi repo

| Path | Fungsi |
| --- | --- |
| `server/` | Server Express: terima webhook, simpan antrean, sediakan API untuk Roblox |
| `roblox/server/init.server.luau` | Script server game (poll API, filter teks, kirim ke pemain) |
| `roblox/client/init.client.luau` | LocalScript UI notifikasi |
| `default.project.json` | Konfigurasi [Rojo](https://rojo.space) (opsional) |
| `.github/workflows/ci.yml` | Menjalankan tes server di GitHub Actions |

## Fitur

- Banyak server game sekaligus: tiap server punya kursor sendiri, jadi semua server menampilkan setiap donasi (tidak "rebutan" antrean).
- Server baru tidak memutar ulang donasi lama.
- Dedup bila BagiBagi mengirim ulang webhook dengan ID yang sama (jika payload membawa ID).
- Webhook dilindungi secret di URL, API Roblox dilindungi `x-api-key`, perbandingan timing-safe.
- Nama & pesan donatur difilter lewat `TextService:FilterStringAsync` sebelum tampil (wajib di Roblox).
- Antrean notifikasi di klien: donasi beruntun tampil satu per satu.
- Endpoint uji `/api/test` sehingga bisa dites tanpa uang sungguhan.

## 1. Jalankan server

Butuh Node.js 20+.

```bash
cd server
npm install
cp .env.example .env      # lalu isi WEBHOOK_SECRET dan ROBLOX_API_KEY
npm run dev
```

Buat nilai acak untuk secret/API key:

```bash
openssl rand -hex 24
```

### Deploy

Server ini menyimpan antrean di memori (opsional ke file), jadi butuh proses yang **berjalan terus**:
Railway, Render, Fly.io, VPS, atau Docker (`server/Dockerfile`).
**Jangan** pakai platform serverless (mis. Vercel Functions): state antrean bisa hilang di antara request.

Set environment variable yang sama dengan `.env.example` di dashboard hosting.
Jika ingin antrean/total donatur bertahan saat restart, arahkan `DATA_FILE` ke volume persisten.

Cek server hidup: `https://DOMAIN-KAMU/health` → `{"status":"ok"}`.

## 2. Pasang webhook di BagiBagi

Di dashboard BagiBagi, cari pengaturan **Webhook URL** (menurut panduan komunitas ada di Dashboard → Settings; letaknya bisa berubah, cek tampilan terbaru), lalu isi:

```
https://DOMAIN-KAMU/webhook/<WEBHOOK_SECRET>
```

> **Catatan payload.** Saya tidak menemukan dokumentasi resmi format payload webhook BagiBagi.
> `normalizePayload()` di `server/index.js` membaca beberapa nama field umum (`name`, `amount`, `message`, dll.).
> Set `LOG_RAW=true`, buat satu donasi uji, lihat payload asli di log, lalu sesuaikan daftar key bila ada yang berbeda. Matikan `LOG_RAW` setelahnya.

## 3. Pasang di Roblox

1. Game Settings → Security → aktifkan **Allow HTTP Requests**.
2. Salin `roblox/server/init.server.luau` ke **ServerScriptService** sebagai `Script`.
3. Salin `roblox/client/init.client.luau` ke **StarterPlayer → StarterPlayerScripts** sebagai `LocalScript`.
4. Edit `CONFIG` di script server: isi `BASE_URL` dan `API_KEY` (sama dengan `ROBLOX_API_KEY`).
5. Publish game, lalu tes.

Pakai Rojo? Jalankan `rojo serve` dari root repo; `default.project.json` sudah memetakan kedua script.

> Script server **harus** tetap di `ServerScriptService`. Jangan taruh `API_KEY` di LocalScript atau `ReplicatedStorage`, karena itu bisa dibaca klien.

## 4. Tes

Tes otomatis server: `cd server && npm test`

Kirim donasi uji tanpa uang sungguhan (saat game berjalan):

```bash
curl -X POST https://DOMAIN-KAMU/api/test \
  -H "x-api-key: <ROBLOX_API_KEY>" -H "Content-Type: application/json" \
  -d '{"name":"Tester","amount":25000,"message":"Halo dari curl"}'
```

Simulasi webhook BagiBagi:

```bash
curl -X POST https://DOMAIN-KAMU/webhook/<WEBHOOK_SECRET> \
  -H "Content-Type: application/json" \
  -d '{"name":"Budi","amount":15000,"message":"Semangat!"}'
```

Notifikasi muncul dalam ≤ `POLL_INTERVAL` detik (default 5).

## API

| Endpoint | Auth | Keterangan |
| --- | --- | --- |
| `POST /webhook/:secret` | secret di path | Dipanggil BagiBagi |
| `GET /api/donations` | `x-api-key` | Tanpa `after`: hanya kursor terbaru. `?after=N`: donasi dengan id > N (maks 50) |
| `GET /api/top` | `x-api-key` | 10 donatur dengan total tertinggi |
| `POST /api/test` | `x-api-key` | Tambah donasi uji |
| `GET /health` | – | Status server |

## Troubleshooting

| Gejala | Penyebab umum |
| --- | --- |
| `HTTP requests are not enabled` | Allow HTTP Requests belum dicentang / game belum dipublish |
| `HTTP 401` di Output | `API_KEY` di Roblox ≠ `ROBLOX_API_KEY` di server |
| Webhook masuk tapi tidak muncul di game | Cek `BASE_URL`, buka Output (F9) di server, pastikan polling tidak error |
| `invalid_payload` di log server | Nama field payload BagiBagi beda; pakai `LOG_RAW=true` lalu sesuaikan |
| Nama/pesan tampil `####` | Hasil filter Roblox; ini normal untuk teks yang tidak lolos |
| Notifikasi tidak ada di Studio | Di Studio unpublished, filter memakai pemain lokal; coba tes di game yang sudah publish |

## Keamanan & catatan

- Jangan commit `.env`. Ganti secret jika pernah bocor.
- Webhook hanya diamankan dengan secret di URL (BagiBagi, sejauh yang saya temukan, hanya menyediakan kolom URL). Jangan bagikan URL webhook, dan hindari mencatat URL lengkap di log publik.
- Server ini hanya **menampilkan notifikasi**; tidak memproses uang dan tidak memberi item/Robux ke donatur.
- Cek [Roblox Community Standards](https://en.help.roblox.com/hc/en-us/articles/203313410-Roblox-Community-Standards) soal ajakan/tautan pembayaran di luar platform. Sebaiknya notifikasi tidak memuat link donasi.

## Lisensi

MIT. Ganti nama pemilik di `LICENSE`.
