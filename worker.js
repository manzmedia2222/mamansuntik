// mamansuntik versi Cloudflare Workers.
// File statis di /public dilayani Cloudflare langsung; Worker ini hanya menangani /api/*.
// Rahasia (API_KEY, SITE_PASSWORD) disimpan sebagai secret Cloudflare, bukan di kode.
const SESSION_MS = 1000 * 60 * 60 * 12;
const enc = new TextEncoder();

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const secretOf = (env) => env.SESSION_SECRET || 'ms:' + env.SITE_PASSWORD + ':' + env.API_KEY;

async function makeToken(env) {
  const exp = String(Date.now() + SESSION_MS);
  return exp + '.' + (await hmac(secretOf(env), exp));
}
async function validToken(env, t) {
  if (!t) return false;
  const [exp, sig] = t.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return same(sig, await hmac(secretOf(env), exp));
}
function cookie(req, name) {
  const m = (req.headers.get('Cookie') || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

async function provider(env, params) {
  const body = new URLSearchParams({ key: env.API_KEY || '', ...params });
  const res = await fetch(env.API_URL || 'https://zefame.com/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: 'Respons penyedia tidak valid' }; }
}

// Cache daftar layanan per isolate selama 5 menit.
let svc = { at: 0, data: null };
async function services(env) {
  if (svc.data && Date.now() - svc.at < 5 * 60 * 1000) return svc.data;
  const data = await provider(env, { action: 'services' });
  if (Array.isArray(data)) svc = { at: Date.now(), data };
  return data;
}

const clean = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== '').map((k) => [k, String(o[k])]));
async function body(req) { try { return await req.json(); } catch { return {}; } }

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(req);

    const secure = url.protocol === 'https:' ? '; Secure' : '';

    if (path === '/api/login' && req.method === 'POST') {
      const { password } = await body(req);
      const want = env.SITE_PASSWORD || '';
      // bandingkan hash agar panjang kata sandi tidak bocor lewat waktu respons
      const ok = want && typeof password === 'string' && same(await sha256(password), await sha256(want));
      if (!ok) return json({ error: 'Kata sandi salah' }, 401);
      return json({ ok: true }, 200, {
        'Set-Cookie': `ms=${await makeToken(env)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`,
      });
    }
    if (path === '/api/logout' && req.method === 'POST') {
      return json({ ok: true }, 200, { 'Set-Cookie': `ms=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}` });
    }
    if (!(await validToken(env, cookie(req, 'ms')))) return json({ error: 'Belum masuk' }, 401);
    if (path === '/api/me') return json({ ok: true });

    try {
      if (path === '/api/services' && req.method === 'GET') return json(await services(env));
      if (path === '/api/balance' && req.method === 'GET') return json(await provider(env, { action: 'balance' }));
      if (path === '/api/status' && req.method === 'GET') {
        const ids = (url.searchParams.get('orders') || '').replace(/[^0-9,]/g, '');
        if (!ids) return json({ error: 'ID pesanan kosong' }, 400);
        return json(await provider(env, { action: 'status', orders: ids }));
      }
      if (req.method !== 'POST') return json({ error: 'Tidak ditemukan' }, 404);
      const b = await body(req);
      if (path === '/api/order') {
        return json(await provider(env, { action: 'add', ...clean(b, ['service', 'link', 'quantity', 'runs', 'interval', 'comments', 'username']) }));
      }
      if (path === '/api/refill') return json(await provider(env, { action: 'refill', ...clean(b, ['order']) }));
      if (path === '/api/cancel') return json(await provider(env, { action: 'cancel', ...clean(b, ['orders']) }));
      return json({ error: 'Tidak ditemukan' }, 404);
    } catch {
      return json({ error: 'Tidak bisa menghubungi penyedia layanan' }, 502);
    }
  },
};
