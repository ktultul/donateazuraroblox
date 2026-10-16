'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, normalizePayload, toAmount } = require('../index');

const WEBHOOK_SECRET = 'test-webhook-secret';
const API_KEY = 'test-api-key';

async function withServer(fn) {
  const app = createApp({ webhookSecret: WEBHOOK_SECRET, apiKey: API_KEY, dataFile: '' });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

const post = (url, body, headers = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

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

test('webhook menolak secret salah', async () => {
  await withServer(async (base) => {
    const r = await post(`${base}/webhook/salah`, { name: 'A', amount: 1000 });
    assert.equal(r.status, 401);
  });
});

test('alur webhook -> polling dengan kursor', async () => {
  await withServer(async (base) => {
    const h = { 'x-api-key': API_KEY };

    const first = await (await fetch(`${base}/api/donations`, { headers: h })).json();
    assert.equal(first.latest, 0);

    const w = await post(`${base}/webhook/${WEBHOOK_SECRET}`, {
      name: 'Siti',
      amount: 20000,
      message: 'semangat',
      id: 'trx-1',
    });
    assert.equal(w.status, 200);

    const dup = await (
      await post(`${base}/webhook/${WEBHOOK_SECRET}`, { name: 'Siti', amount: 20000, id: 'trx-1' })
    ).json();
    assert.equal(dup.duplicate, true);

    const list = await (await fetch(`${base}/api/donations?after=0`, { headers: h })).json();
    assert.equal(list.donations.length, 1);
    assert.equal(list.donations[0].name, 'Siti');

    const empty = await (
      await fetch(`${base}/api/donations?after=${list.latest}`, { headers: h })
    ).json();
    assert.equal(empty.donations.length, 0);

    const reset = await (await fetch(`${base}/api/donations?after=999`, { headers: h })).json();
    assert.equal(reset.reset, true);
  });
});

test('API Roblox butuh x-api-key', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/api/donations`)).status, 401);
    assert.equal((await fetch(`${base}/api/top`, { headers: { 'x-api-key': 'x' } })).status, 401);
  });
});
