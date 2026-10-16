import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { GoogleAuth } from 'google-auth-library';
import { createRuntime } from '../worker/runtime.js';
import { emptyState } from '../src/domain.js';
import { emptyFinance } from '../src/finance-domain.js';
import { connectMySQL } from './mysql-bucket.js';
import { ownerSessions, verifyPassword } from './owner-auth.js';

const loginPage = failed => `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Empire OS · Accesso</title><style>body{margin:0;background:#17121e;color:#e8d8c8;font:16px system-ui;min-height:100dvh;display:grid;place-items:center}main{width:min(360px,calc(100% - 64px));padding:30px;border:1px solid #69526c;border-radius:16px;background:#29202f}h1{font:36px Georgia;margin:0 0 24px}label{display:grid;gap:10px}input,button{box-sizing:border-box;width:100%;padding:13px;border-radius:8px;border:1px solid #8b708b;font:inherit}input{background:#17121e;color:#f1e6ef}button{margin-top:20px;background:#d2b681;color:#251c26;cursor:pointer}p{font-size:14px;color:#d9a6b3}</style><main><h1>Empire OS</h1><form method="post" action="/login"><label>Password personale<input type="password" name="password" autocomplete="current-password" required maxlength="1024"></label><button>Entra</button>${failed ? '<p role="alert">Accesso non riuscito. Controlla la password e riprova.</p>' : ''}</form></main></html>`;
const jsonError = (message, status) => Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
const cookieName = 'empire_owner';

export function createHostedApp({ env, bucket, assets = {}, getVertexAccessToken, fetcher = globalThis.fetch, now = () => Date.now() }) {
  const origin = new URL(env.APP_ORIGIN || 'http://localhost:5173').origin;
  if (env.NODE_ENV === 'production' && !origin.startsWith('https://')) throw Error('APP_ORIGIN deve essere un indirizzo HTTPS in produzione.');
  const secure = origin.startsWith('https://'), sessions = ownerSessions(env, now), attempts = new Map(), aiCalls = new Map();
  const runtime = createRuntime({ assets, getVertexAccessToken, fetcher });
  // Only a trusted server-created request may carry the Sites-compatible owner header.
  const runtimeEnv = { ...env, BUCKET: bucket, HOSTED_NODE: 'true', EMPIRE_MANAGEMENT_SECRET: undefined };
  const cookie = (value, maxAge) => `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  function limited(map, id, count, duration) {
    const old = map.get(id), entry = old && now() - old.start < duration ? old : { start: now(), count: 0 };
    entry.count++; map.set(id, entry);
    if (map.size > 1000) for (const [key, value] of map) if (now() - value.start >= duration) map.delete(key);
    return entry.count > count;
  }
  async function handle(request, address) {
    const url = new URL(request.url), path = url.pathname;
    if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('Origin') !== origin) return jsonError('Origine non consentita.', 403);
    if (path === '/login' && request.method === 'GET') return new Response(loginPage(false), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    if (path === '/login' && request.method === 'POST') {
      if (limited(attempts, address || 'unknown', 8, 600000)) return jsonError('Troppi tentativi. Riprova tra dieci minuti.', 429);
      if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) return jsonError('Richiesta non valida.', 415);
      const text = await request.text(); if (Buffer.byteLength(text) > 8192) return jsonError('Richiesta troppo grande.', 413);
      const password = new URLSearchParams(text).get('password');
      if (!await verifyPassword(password, env.EMPIRE_OWNER_PASSWORD_HASH)) return new Response(loginPage(true), { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
      return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': cookie(sessions.issue(), 7 * 86400), 'Cache-Control': 'no-store' } });
    }
    const token = request.headers.get('Cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!sessions.verify(token)) return path.startsWith('/api/') ? jsonError('Accedi al tuo archivio personale.', 401) : new Response(null, { status: 303, headers: { Location: '/login', 'Cache-Control': 'no-store' } });
    if (path === '/logout' && request.method === 'POST') return new Response(null, { status: 303, headers: { Location: '/login', 'Set-Cookie': cookie('', 0), 'Clear-Site-Data': '"cache", "storage"', 'Cache-Control': 'no-store' } });
    if (path === '/api/agent/key') return jsonError('Su questo hosting configura Vertex o Gemini nelle variabili del server.', 409);
    if (path === '/api/agent' && request.method === 'POST' && limited(aiCalls, 'owner', 15, 60000)) return jsonError('Massimo 15 richieste AI al minuto. Riprova tra poco.', 429);
    const headers = new Headers(request.headers);
    for (const name of [...headers.keys()]) if (name.startsWith('oai-') || name === 'x-empire-management' || name === 'authorization') headers.delete(name);
    headers.set('oai-authenticated-user-id', 'empire-owner');
    return runtime.fetch(new Request(request, { headers }), runtimeEnv);
  }
  return { origin, async fetch(request, address) {
    let response;
    try { response = await handle(request, address); } catch { response = jsonError('Richiesta non completata. Riprova.', 500); }
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff'); headers.set('X-Frame-Options', 'DENY'); headers.set('Referrer-Policy', 'same-origin');
    return new Response(response.body, { status: response.status, headers });
  } };
}

export async function seedEmptyArchive(bucket) {
  const state = emptyState(); state.settings = { name: 'Alessandro', agentName: 'Merlino' };
  for (const [name, value] of [['tasks', state], ['finance', emptyFinance()]]) {
    await bucket.put(`empire/private/${name}.json`, JSON.stringify(value), { onlyIf: new Headers({ 'If-None-Match': '*' }) });
  }
}

export async function startHosted(env = process.env) {
  ownerSessions(env);
  const bucket = await connectMySQL(env);
  let assets;
  try { assets = (await import('../worker/assets.generated.js')).default; } catch { await bucket.pool.end(); throw Error('Compila l’app con npm run build prima di avviare il server.'); }
  await seedEmptyArchive(bucket);
  const auth = env.GOOGLE_CLOUD_PROJECT ? new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'], projectId: env.GOOGLE_CLOUD_PROJECT }) : null;
  const app = createHostedApp({ env, bucket, assets, getVertexAccessToken: auth ? () => auth.getAccessToken() : undefined });
  const server = http.createServer(async (req, res) => {
    try {
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 26 * 1024 * 1024) { res.writeHead(413); res.end('Richiesta troppo grande'); return; } chunks.push(chunk); }
      const headers = new Headers(); for (const [name, value] of Object.entries(req.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(',') : value);
      const request = new Request(new URL(req.url, app.origin), { method: req.method, headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) });
      const response = await app.fetch(request, req.socket.remoteAddress);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
    } catch { if (!res.headersSent) res.writeHead(500); res.end('Richiesta non completata'); }
  });
  server.requestTimeout = 60000; server.headersTimeout = 15000;
  server.listen(Number(env.PORT || env.API_PORT || 3000), env.HOST || '0.0.0.0', () => console.log('Empire OS Node pronto. Archivio MySQL e accesso personale attivi.'));
  return { server, close: async () => { await new Promise(resolve => server.close(resolve)); await bucket.pool.end(); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startHosted().catch(error => { console.error(error.message); process.exitCode = 1; });
