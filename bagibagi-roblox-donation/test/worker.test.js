import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/app.js';
import { Queue } from '../src/queue.js';
import { normalizePayload, toAmount } from '../src/util.js';

const WEBHOOK_SECRET = 'test-webhook-secret';
const API_KEY = 'test-api-key';

// Penyimpanan palsu yang meniru API Durable Object (get/put/delete/list).
class FakeStorage {
  constructor() {
    this.map = new Map();
  }
  async get(k) {
    return structuredClone(this.map.get(k));
  }
  async put(a, b) {
    if (typeof a === 'string') this.map.set(a, structuredClone(b));
    else for (const [k, v] of Object.entries(a)) this.map.set(k, structuredClone(v));
  }
  async delete(k) {
    for (const key of [].concat(k)) this.map.delete(key);
  }
  async list({ prefix = '', start, limit } = {}) {
    let keys = [...this.map.keys()].filter((k) => k.startsWith(prefix)).sort();
    if (start !== undefined) keys = keys.filter((k) => k >= start);
    if (limit !== undefined) keys = keys.slice(0, limit);
    return new Map(keys.map((k) => [k, structuredClone(this.map.get(k))]));
  }
}

function setup(extraEnv = {}, maxQueue = 500) {
  const queue = new Queue(new FakeStorage(), { maxQueue });
  const env = { WEBHOOK_SECRET, ROBLOX_API_KEY: API_KEY, ...extraEnv };
  const call = (path, init) =>
    handleRequest(new Request(`http://worker.test${path}`, init), env, () => queue);
  const post = (path, body, headers = {}) =>
    call(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  return { call, post, queue };
}

const auth = { 'x-api-key': API_KEY };

test('toAmount memahami format rupiah', () => {
  assert.equal(toAmount('10.000'), 10000);
  assert.equal(toAmount('Rp 25,000'), 25000);
  assert.equal(toAmount(5000), 5000);
  assert.equal(toAmount('abc'), 0);
});

test('normalizePayload menolak amount kosong & membersihkan teks', () => {
  assert.equal(normalizePayload({ name: 'A', amount: 0 }), null);
  const p = normalizePayload({ donator_name: '  Budi\n', nominal: '15.000', pesan: 'halo' });
  assert.equal(p.name, 'Budi');
  assert.equal(p.amount, 15000);
  assert.equal(p.message, 'halo');
});

test('/health tidak butuh login', async () => {
  const { call } = setup();
  const r = await call('/health');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: 'ok' });
});

test('webhook menolak secret salah', async () => {
  const { post } = setup();
  const r = await post('/webhook/salah', { name: 'A', amount: 1000 });
  assert.equal(r.status, 401);
});

test('webhook menolak JSON rusak & payload tak dikenal', async () => {
  const { call, post } = setup();
  const bad = await call(`/webhook/${WEBHOOK_SECRET}`, { method: 'POST', body: '{bukan json' });
  assert.equal(bad.status, 400);
  const empty = await post(`/webhook/${WEBHOOK_SECRET}`, { hello: 'world' });
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error, 'invalid_payload');
});

test('alur webhook -> polling dengan kursor', async () => {
  const { call, post } = setup();

  const first = await (await call('/api/donations', { headers: auth })).json();
  assert.equal(first.latest, 0);

  const w = await post(`/webhook/${WEBHOOK_SECRET}`, {
    name: 'Siti',
    amount: 20000,
    message: 'semangat',
    id: 'trx-1',
  });
  assert.equal(w.status, 200);

  const dup = await (
    await post(`/webhook/${WEBHOOK_SECRET}`, { name: 'Siti', amount: 20000, id: 'trx-1' })
  ).json();
  assert.equal(dup.duplicate, true);

  const list = await (await call('/api/donations?after=0', { headers: auth })).json();
  assert.equal(list.donations.length, 1);
  assert.equal(list.donations[0].name, 'Siti');

  const empty = await (await call(`/api/donations?after=${list.latest}`, { headers: auth })).json();
  assert.equal(empty.donations.length, 0);

  const reset = await (await call('/api/donations?after=999', { headers: auth })).json();
  assert.equal(reset.reset, true);

  const badAfter = await call('/api/donations?after=abc', { headers: auth });
  assert.equal(badAfter.status, 400);
});

test('API Roblox butuh x-api-key', async () => {
  const { call } = setup();
  assert.equal((await call('/api/donations')).status, 401);
  assert.equal((await call('/api/top', { headers: { 'x-api-key': 'x' } })).status, 401);
});

test('/api/test menambah donasi & /api/top menjumlahkan per donatur', async () => {
  const { call, post } = setup();
  await post('/api/test', { name: 'Ani', amount: 5000 }, auth);
  await post('/api/test', { name: 'ani', amount: 7000 }, auth);
  await post('/api/test', { name: 'Budi', amount: 1000 }, auth);
  const { top } = await (await call('/api/top', { headers: auth })).json();
  assert.equal(top[0].total, 12000);
  assert.equal(top[0].count, 2);
  assert.equal(top[1].name, 'Budi');
});

test('antrean dibatasi MAX_QUEUE, donasi terlama dibuang', async () => {
  const { call, post } = setup({}, 3);
  for (let i = 1; i <= 5; i++) await post('/api/test', { name: `D${i}`, amount: 1000 * i }, auth);
  const r = await (await call('/api/donations?after=0', { headers: auth })).json();
  assert.equal(r.latest, 5);
  assert.deepEqual(
    r.donations.map((d) => d.id),
    [3, 4, 5]
  );
});

test('error jelas bila secret belum diisi', async () => {
  const queue = new Queue(new FakeStorage());
  const r = await handleRequest(new Request('http://x/api/top'), {}, () => queue);
  assert.equal(r.status, 500);
  assert.equal((await r.json()).error, 'server_misconfigured');
});
