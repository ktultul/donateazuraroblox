// Logika antrean donasi. Dipakai di dalam Durable Object (penyimpanan tahan lama).
// Sengaja tidak mengimpor apa pun dari Cloudflare supaya mudah dites di Node.
//
// Kunci penyimpanan:
//   meta            -> { seq, seen[] }   (nomor donasi terakhir + ID transaksi yang sudah diproses)
//   d:0000000001    -> satu donasi       (id diberi nol di depan supaya urut)
//   t:<nama>        -> total per donatur

const pad = (n) => String(n).padStart(10, '0');
const dKey = (id) => `d:${pad(id)}`;

export class Queue {
  constructor(storage, { maxQueue = 500 } = {}) {
    this.storage = storage;
    this.maxQueue = maxQueue;
  }

  async loadMeta() {
    const m = await this.storage.get('meta');
    return {
      seq: Number(m?.seq) || 0,
      seen: Array.isArray(m?.seen) ? m.seen : [],
    };
  }

  // Mengembalikan item donasi, atau null kalau webhook yang sama dikirim ulang.
  async push(d) {
    const meta = await this.loadMeta();

    if (d.externalId && meta.seen.includes(d.externalId)) return null; // retry webhook
    if (d.externalId) {
      meta.seen.push(d.externalId);
      if (meta.seen.length > 500) meta.seen.shift();
    }

    meta.seq += 1;
    const item = {
      id: meta.seq,
      name: d.name,
      amount: d.amount,
      message: d.message,
      createdAt: new Date().toISOString(),
    };

    const tKey = `t:${d.name.toLowerCase()}`;
    const t = (await this.storage.get(tKey)) ?? { name: d.name, total: 0, count: 0 };
    t.name = d.name;
    t.total += d.amount;
    t.count += 1;

    await this.storage.put({ meta, [dKey(item.id)]: item, [tKey]: t });

    // Buang donasi paling lama bila antrean melebihi batas.
    const old = meta.seq - this.maxQueue;
    if (old > 0) await this.storage.delete(dKey(old));

    return item;
  }

  // after === undefined -> hanya kursor terbaru (server game baru tidak memutar ulang riwayat)
  // after = N           -> donasi dengan id > N (maks 50)
  async list(after) {
    const { seq: latest } = await this.loadMeta();
    if (after === undefined || after === null) return { latest, donations: [] };
    if (after > latest) {
      // Server di-reset (kursor Roblox lebih besar dari yang ada). Beri tahu klien.
      return { latest, donations: [], reset: true };
    }
    const rows = await this.storage.list({ prefix: 'd:', start: dKey(after + 1), limit: 50 });
    return { latest, donations: [...rows.values()] };
  }

  async top() {
    const rows = await this.storage.list({ prefix: 't:' });
    return [...rows.values()].sort((a, b) => b.total - a.total).slice(0, 10);
  }
}
