// Router HTTP. Sama perilakunya dengan server Express di folder /server.
import { cleanText, normalizePayload, safeEqual, toAmount } from './util.js';

const MAX_BODY = 10 * 1024; // 10 KB

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

async function readJson(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) return { bad: true };
  const text = await request.text();
  if (text.length > MAX_BODY) return { bad: true };
  if (!text) return { value: {} };
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { bad: true };
  }
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * @param request  Request dari Cloudflare
 * @param env      WEBHOOK_SECRET, ROBLOX_API_KEY, MAX_QUEUE, LOG_RAW
 * @param getQueue fungsi (env) => objek dengan push(), list(), top()
 */
export async function handleRequest(request, env, getQueue) {
  try {
    return await route(request, env, getQueue);
  } catch (err) {
    console.error('[error]', err);
    return json({ ok: false, error: 'server_error' }, 500);
  }
}

async function route(request, env, getQueue) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  if (method === 'GET' && pathname === '/health') return json({ status: 'ok' });

  if (!env.WEBHOOK_SECRET || !env.ROBLOX_API_KEY) {
    console.error('WEBHOOK_SECRET / ROBLOX_API_KEY belum diisi (wrangler secret put ...)');
    return json({ ok: false, error: 'server_misconfigured' }, 500);
  }

  /* ---------------------------- Webhook ---------------------------- */
  const hook = pathname.match(/^\/webhook\/([^/]+)$/);
  if (method === 'POST' && hook) {
    if (!(await safeEqual(safeDecode(hook[1]), env.WEBHOOK_SECRET))) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }
    const body = await readJson(request);
    if (body.bad) return json({ ok: false, error: 'bad_request' }, 400);

    if (String(env.LOG_RAW) === 'true') console.log('[webhook:raw]', JSON.stringify(body.value));

    const parsed = normalizePayload(body.value);
    if (!parsed) {
      console.warn('[webhook] payload tidak dikenali / amount kosong');
      return json({ ok: false, error: 'invalid_payload' }, 400);
    }

    const item = await getQueue(env).push(parsed);
    if (!item) return json({ ok: true, duplicate: true });

    console.log(`[webhook] #${item.id} ${item.name} Rp${item.amount}`);
    return json({ ok: true, id: item.id });
  }

  /* ------------------- Dilindungi API key (Roblox) ------------------ */
  if (pathname.startsWith('/api/')) {
    const key = request.headers.get('x-api-key');
    if (!key || !(await safeEqual(key, env.ROBLOX_API_KEY))) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }

    if (method === 'GET' && pathname === '/api/donations') {
      const raw = url.searchParams.get('after');
      if (raw === null) return json(await getQueue(env).list(undefined));
      const after = parseInt(raw, 10);
      if (Number.isNaN(after) || after < 0) {
        return json({ ok: false, error: 'invalid_after' }, 400);
      }
      return json(await getQueue(env).list(after));
    }

    if (method === 'GET' && pathname === '/api/top') {
      return json({ top: await getQueue(env).top() });
    }

    // Untuk uji coba tanpa uang sungguhan.
    if (method === 'POST' && pathname === '/api/test') {
      const body = await readJson(request);
      if (body.bad) return json({ ok: false, error: 'bad_request' }, 400);
      const b = body.value && typeof body.value === 'object' ? body.value : {};
      const item = await getQueue(env).push({
        name: cleanText(b.name, 40) || 'Tester',
        amount: toAmount(b.amount) || 10000,
        message: cleanText(b.message, 200) || 'Tes notifikasi donasi',
        externalId: '',
      });
      return json({ ok: true, id: item.id });
    }
  }

  return json({ ok: false, error: 'not_found' }, 404);
}
