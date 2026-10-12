import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredFiles = ['index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
const cachePrefix = 'empire-os-pwa-v1-';

/** Enumerate the finished Vite output without following links outside it. */
export async function collectPrecacheFiles(distDir) {
  const files = [];
  async function visit(directory, segments = []) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'api') continue;
      const next = [...segments, entry.name];
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), next);
      else if (entry.isFile() && !entry.name.endsWith('.map') && next.join('/') !== 'sw.js') {
        files.push({ relativePath: next.join('/'), url: `/${next.map(encodeURIComponent).join('/')}` });
      }
    }
  }
  await visit(distDir);
  files.sort((a, b) => a.url.localeCompare(b.url, 'en'));
  const present = new Set(files.map(file => file.relativePath));
  for (const required of requiredFiles) {
    if (!present.has(required)) throw new Error(`Risorsa PWA mancante dopo la build: ${required}`);
  }
  return files;
}

export function generateServiceWorker(urls, version) {
  return `/* Generated after Vite build. Do not edit. */
'use strict';
const CACHE_PREFIX = ${JSON.stringify(cachePrefix)};
const CACHE_NAME = CACHE_PREFIX + ${JSON.stringify(version)};
const PRECACHE_URLS = ${JSON.stringify(urls, null, 2)};
const PRECACHE_PATHS = new Set(PRECACHE_URLS);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_URLS.map(url => new Request(url, { cache: 'reload' })));
  })());
});

// Activate after existing clients release the previous worker, keeping their
// already-loaded application and hashed assets on the same build version.
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const shell = await cache.match('/index.html');
        return shell || new Response('Apri Empire OS online una volta per usarlo offline.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })());
    return;
  }

  // Only known build assets are cacheable. API responses, uploads and other
  // dynamic requests never enter this cache.
  if (!PRECACHE_PATHS.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(url.pathname)) || fetch(request);
  })());
});
`;
}

export async function finalizePwa({ distDir = path.join(projectRoot, 'dist') } = {}) {
  const files = await collectPrecacheFiles(distDir);
  const hash = createHash('sha256').update(generateServiceWorker.toString());
  for (const file of files) {
    const content = await readFile(path.join(distDir, ...file.relativePath.split('/')));
    hash.update(file.url).update('\0').update(createHash('sha256').update(content).digest());
  }
  const version = hash.digest('hex').slice(0, 20);
  const urls = files.map(file => file.url);
  const source = generateServiceWorker(urls, version);
  await writeFile(path.join(distDir, 'sw.js'), source, 'utf8');
  return { version, urls, serviceWorkerPath: path.join(distDir, 'sw.js') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  finalizePwa().then(result => {
    console.log(`PWA pronta: ${result.urls.length} risorse offline, versione ${result.version}.`);
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
