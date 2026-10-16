'use strict';

const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

function safeEqual(a, b) {
  // Bandingkan lewat hash agar panjang berbeda tidak bocor & timing-safe.
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function cleanText(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function toAmount(value) {
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
function normalizePayload(body) {
  if (!body || typeof body !== 'object') return null;
  const src =
    body.data && typeof body.data === 'object' ? { ...body, ...body.data } : body;

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

/* ------------------------------------------------------------------ */
/* App factory (dipisah supaya mudah dites)                            */
/* ------------------------------------------------------------------ */

function createApp(opts = {}) {
  const cfg = {
    webhookSecret: opts.webhookSecret ?? process.env.WEBHOOK_SECRET,
    apiKey: opts.apiKey ?? process.env.ROBLOX_API_KEY,
    dataFile: opts.dataFile ?? process.env.DATA_FILE ?? '',
    maxQueue: Number(opts.maxQueue ?? process.env.MAX_QUEUE ?? 500),
    logRaw: String(opts.logRaw ?? process.env.LOG_RAW ?? 'false') === 'true',
  };

  if (!cfg.webhookSecret || !cfg.apiKey) {
    throw new Error('WEBHOOK_SECRET dan ROBLOX_API_KEY wajib diisi (lihat .env.example).');
  }

  const state = { seq: 0, donations: [], totals: {}, seen: [] };

  if (cfg.dataFile && fs.existsSync(cfg.dataFile)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(cfg.dataFile, 'utf8'));
      Object.assign(state, {
        seq: Number(loaded.seq) || 0,
        donations: Array.isArray(loaded.donations) ? loaded.donations : [],
        totals: loaded.totals && typeof loaded.totals === 'object' ? loaded.totals : {},
        seen: Array.isArray(loaded.seen) ? loaded.seen : [],
      });
    } catch (err) {
      console.warn('[state] gagal membaca DATA_FILE, mulai dari kosong:', err.message);
    }
  }

  let persistTimer = null;
  function persist() {
    if (!cfg.dataFile || persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      try {
        fs.mkdirSync(path.dirname(cfg.dataFile), { recursive: true });
        const tmp = `${cfg.dataFile}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(state));
        fs.renameSync(tmp, cfg.dataFile);
      } catch (err) {
        console.error('[state] gagal menyimpan:', err.message);
      }
    }, 500);
    persistTimer.unref();
  }

  function pushDonation(d) {
    if (d.externalId && state.seen.includes(d.externalId)) return null; // retry webhook
    if (d.externalId) {
      state.seen.push(d.externalId);
      if (state.seen.length > 500) state.seen.shift();
    }

    state.seq += 1;
    const item = {
      id: state.seq,
      name: d.name,
      amount: d.amount,
      message: d.message,
      createdAt: new Date().toISOString(),
    };
    state.donations.push(item);
    if (state.donations.length > cfg.maxQueue) {
      state.donations.splice(0, state.donations.length - cfg.maxQueue);
    }

    const key = d.name.toLowerCase();
    const t = state.totals[key] || { name: d.name, total: 0, count: 0 };
    t.name = d.name;
    t.total += d.amount;
    t.count += 1;
    state.totals[key] = t;

    persist();
    return item;
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  /* ---------------------------- Publik ---------------------------- */

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // BagiBagi memanggil endpoint ini. Secret ada di path URL.
  app.post('/webhook/:secret', (req, res) => {
    if (!safeEqual(req.params.secret, cfg.webhookSecret)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    if (cfg.logRaw) console.log('[webhook:raw]', JSON.stringify(req.body));

    const parsed = normalizePayload(req.body);
    if (!parsed) {
      console.warn('[webhook] payload tidak dikenali / amount kosong');
      return res.status(400).json({ ok: false, error: 'invalid_payload' });
    }

    const item = pushDonation(parsed);
    if (!item) return res.json({ ok: true, duplicate: true });

    console.log(`[webhook] #${item.id} ${item.name} Rp${item.amount}`);
    return res.json({ ok: true, id: item.id });
  });

  /* ------------------- Dilindungi API key (Roblox) ---------------- */

  function requireApiKey(req, res, next) {
    const key = req.get('x-api-key');
    if (!key || !safeEqual(key, cfg.apiKey)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    next();
  }

  // ?after tidak diisi  -> hanya mengembalikan kursor terbaru (server baru tidak memutar ulang riwayat)
  // ?after=N            -> donasi dengan id > N (maks 50 per panggilan)
  app.get('/api/donations', requireApiKey, (req, res) => {
    const latest = state.seq;
    if (req.query.after === undefined) {
      return res.json({ latest, donations: [] });
    }
    const after = parseInt(String(req.query.after), 10);
    if (Number.isNaN(after) || after < 0) {
      return res.status(400).json({ ok: false, error: 'invalid_after' });
    }
    if (after > latest) {
      // Server di-reset (kursor Roblox lebih besar dari yang ada). Beri tahu klien.
      return res.json({ latest, donations: [], reset: true });
    }
    const donations = state.donations.filter((d) => d.id > after).slice(0, 50);
    return res.json({ latest, donations });
  });

  app.get('/api/top', requireApiKey, (_req, res) => {
    const top = Object.values(state.totals)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
    res.json({ top });
  });

  // Untuk uji coba tanpa uang sungguhan.
  app.post('/api/test', requireApiKey, (req, res) => {
    const item = pushDonation({
      name: cleanText(req.body?.name, 40) || 'Tester',
      amount: toAmount(req.body?.amount) || 10000,
      message: cleanText(req.body?.message, 200) || 'Tes notifikasi donasi',
      externalId: '',
    });
    res.json({ ok: true, id: item.id });
  });

  /* ------------------------- Error handler ------------------------ */

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
      return res.status(400).json({ ok: false, error: 'bad_request' });
    }
    console.error('[error]', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  });

  return app;
}

module.exports = { createApp, normalizePayload, toAmount };

if (require.main === module) {
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`[server] berjalan di port ${port}`));
}
