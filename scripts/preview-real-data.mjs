import http from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { GoogleAuth } from 'google-auth-library';
import { createRuntime } from '../worker/runtime.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class LocalFileBucket {
  values = new Map();
  diskMap = new Map();
  async head(key) {
    const item = this.values.get(key);
    return item ? { etag: item.etag, httpEtag: '"' + item.etag + '"' } : null;
  }
  async get(key) {
    const item = this.values.get(key);
    return item ? { etag: item.etag, httpEtag: '"' + item.etag + '"', body: new Blob([item.bytes]).stream(), json: async () => JSON.parse(item.bytes.toString('utf8')) } : null;
  }
  async put(key, value, options = {}) {
    const current = await this.head(key), c = options.onlyIf;
    if (c?.get('If-Match') && c.get('If-Match') !== current?.httpEtag || c?.get('If-None-Match') === '*' && current) return null;
    const bytes = Buffer.from(await new Response(value).arrayBuffer());
    const etag = createHash('sha256').update(bytes).digest('hex');
    this.values.set(key, { bytes, etag });
    if (this.diskMap.has(key)) {
      try { await writeFile(this.diskMap.get(key), bytes); } catch {}
    }
    return this.head(key);
  }
}

async function startLocalPreview() {
  const bucket = new LocalFileBucket();
  const archiveDir = path.join(root, 'archivio-reale-pronto');
  const tasksPath = path.join(archiveDir, 'attivita-reali.json');
  const financePath = path.join(archiveDir, 'finanze-reali-unificate.json');
  const tasksJson = await readFile(tasksPath);
  const financeJson = await readFile(financePath);
  await bucket.put('empire/private/tasks.json', tasksJson);
  await bucket.put('empire/private/finance.json', financeJson);
  bucket.diskMap.set('empire/private/tasks.json', tasksPath);
  bucket.diskMap.set('empire/private/finance.json', financePath);
  try {
    const mediaDir = path.join(archiveDir, 'media');
    for (const name of await readdir(mediaDir)) {
      if (name.endsWith('.webp')) {
        await bucket.put('empire/media/' + name, await readFile(path.join(mediaDir, name)));
      }
    }
  } catch {}

  const assets = (await import('../worker/assets.generated.js')).default;
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'project-ac36114c-c913-495d-94a';
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'], projectId });
  const runtime = createRuntime({
    assets,
    getVertexAccessToken: () => auth.getAccessToken(),
  });
  const env = {
    ...process.env,
    BUCKET: bucket,
    GOOGLE_CLOUD_PROJECT: projectId,
    GOOGLE_CLOUD_LOCATION: process.env.GOOGLE_CLOUD_LOCATION || 'global',
    VERTEX_MODEL: process.env.VERTEX_MODEL || 'gemini-3.5-flash-lite',
    EMPIRE_MANAGEMENT_SECRET: randomBytes(32).toString('base64'),
  };

  const port = Number(process.env.PORT || 4173);
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const origin = `http://${req.headers.host || 'localhost:' + port}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (v) headers.set(k, Array.isArray(v) ? v.join(',') : v);
      headers.set('oai-authenticated-user-id', 'empire-owner');
      if (!headers.get('Origin')) headers.set('Origin', origin);
      const request = new Request(new URL(req.url, origin), {
        method: req.method,
        headers,
        ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}),
      });
      const response = await runtime.fetch(request, env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body).pipe(res);
      else res.end();
    } catch (e) {
      if (!res.headersSent) res.writeHead(500);
      res.end(e.message);
    }
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`Empire OS Merlino (Anteprima Completa con Dati Reali + Vertex AI) attivo su http://localhost:${port}`);
  });
}

startLocalPreview().catch(err => { console.error(err); process.exitCode = 1; });
