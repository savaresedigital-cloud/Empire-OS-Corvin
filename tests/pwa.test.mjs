import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { finalizePwa } from '../scripts/finalize-pwa.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function buildFixture(t) {
  const tempRoot = path.resolve(os.tmpdir());
  const directory = await mkdtemp(path.join(tempRoot, 'empire-pwa-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), tempRoot);
    assert.ok(path.basename(directory).startsWith('empire-pwa-test-'));
    await rm(directory, { recursive: true, force: true });
  });
  const files = {
    'index.html': '<html><script src="/assets/app-AB12.js"></script></html>',
    'manifest.webmanifest': '{}',
    'icon.svg': '<svg />',
    'icon-192.png': '192',
    'icon-512.png': '512',
    'assets/app-AB12.js': 'console.log("build-one")',
    'assets/style-CD34.css': 'body{color:#101b25}',
    'assets/nested/font-EF56.woff2': 'font',
    'assets/a space.svg': '<svg />',
    'assets/app-AB12.js.map': '{}',
    'api/private.json': '{"private":true}',
    '.env': 'SECRET=never-cache',
    'sw.js': 'old worker',
  };
  for (const [relative, content] of Object.entries(files)) {
    const destination = path.join(directory, ...relative.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  return directory;
}

function workerHarness(source, { network = async () => 'network-response', cachedShell = 'offline-shell' } = {}) {
  const handlers = new Map();
  const opened = [];
  const deleted = [];
  const added = [];
  const knownNames = ['another-app-cache', 'empire-os-pwa-v1-old'];
  let claimed = false;
  class FakeRequest {
    constructor(url, options) { this.url = new URL(url, 'https://empire.example').href; this.options = options; }
  }
  const cache = {
    async addAll(requests) { added.push(...requests); },
    async match(url) {
      if (url === '/index.html') return cachedShell;
      if (url === '/assets/app-AB12.js') return 'cached-bundle';
      return undefined;
    },
  };
  const caches = {
    async open(name) { opened.push(name); if (!knownNames.includes(name)) knownNames.push(name); return cache; },
    async keys() { return [...knownNames]; },
    async delete(name) { deleted.push(name); return true; },
  };
  const self = {
    location: { origin: 'https://empire.example' },
    clients: { async claim() { claimed = true; } },
    addEventListener(event, callback) { handlers.set(event, callback); },
  };
  vm.runInNewContext(source, { self, caches, Request: FakeRequest, Response, URL, fetch: network });
  async function lifecycle(name) {
    let completion;
    handlers.get(name)({ waitUntil(promise) { completion = promise; } });
    await completion;
  }
  function request(url, { method = 'GET', mode = 'cors' } = {}) {
    let result;
    let intercepted = false;
    handlers.get('fetch')({
      request: { url: new URL(url, self.location.origin).href, method, mode },
      respondWith(promise) { intercepted = true; result = promise; },
    });
    return { intercepted, result };
  }
  return { lifecycle, request, opened, deleted, added, claimed: () => claimed };
}

test('manifest and installation icons are complete and match their declared sizes', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'public', 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'Empire OS');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  for (const size of [192, 512]) {
    const declared = manifest.icons.find(icon => icon.src === `/icon-${size}.png`);
    assert.equal(declared.sizes, `${size}x${size}`);
    assert.match(declared.purpose, /maskable/);
    const bytes = await readFile(path.join(root, 'public', `icon-${size}.png`));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
});

test('post-build worker precaches exact emitted assets, excludes API/maps/secrets, and versions content', async t => {
  const distDir = await buildFixture(t);
  const first = await finalizePwa({ distDir });
  assert.equal(first.urls.length, 9);
  for (const required of ['/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/assets/app-AB12.js', '/assets/style-CD34.css', '/assets/nested/font-EF56.woff2', '/assets/a%20space.svg']) {
    assert.ok(first.urls.includes(required), required);
  }
  assert.ok(first.urls.every(url => !url.startsWith('/api') && !url.endsWith('.map') && !url.includes('.env') && url !== '/sw.js'));
  const source = await readFile(first.serviceWorkerPath, 'utf8');
  assert.ok(source.includes(first.version));
  assert.equal((await finalizePwa({ distDir })).version, first.version);
  await writeFile(path.join(distDir, 'assets', 'app-AB12.js'), 'console.log("build-two")');
  assert.notEqual((await finalizePwa({ distDir })).version, first.version);
});

test('installation uses all build resources and activation removes only old Empire OS caches', async t => {
  const result = await finalizePwa({ distDir: await buildFixture(t) });
  const harness = workerHarness(await readFile(result.serviceWorkerPath, 'utf8'));
  await harness.lifecycle('install');
  assert.equal(harness.added.length, result.urls.length);
  assert.ok(harness.added.every(request => request.options.cache === 'reload'));
  assert.ok(harness.added.every(request => !new URL(request.url).pathname.startsWith('/api')));
  await harness.lifecycle('activate');
  assert.deepEqual(harness.deleted, ['empire-os-pwa-v1-old']);
  assert.equal(harness.claimed(), true);
});

test('offline fallback is restricted to local navigations and known static assets', async t => {
  const result = await finalizePwa({ distDir: await buildFixture(t) });
  const harness = workerHarness(await readFile(result.serviceWorkerPath, 'utf8'), {
    network: async () => { throw new TypeError('offline'); },
  });
  assert.equal(await harness.request('/progetti', { mode: 'navigate' }).result, 'offline-shell');
  assert.equal(await harness.request('/assets/app-AB12.js').result, 'cached-bundle');
  for (const url of ['/api', '/api/state', '/api/state?private=true', '/uploads/private.png', '/assets/not-in-build.js']) {
    assert.equal(harness.request(url).intercepted, false, url);
  }
  assert.equal(harness.request('/api/export', { mode: 'navigate' }).intercepted, false);
  assert.equal(harness.request('https://other.example/page', { mode: 'navigate' }).intercepted, false);
  assert.equal(harness.request('/index.html', { method: 'POST', mode: 'navigate' }).intercepted, false);
});

test('online navigations use the server and missing offline shell has an explicit failure', async t => {
  const result = await finalizePwa({ distDir: await buildFixture(t) });
  const source = await readFile(result.serviceWorkerPath, 'utf8');
  const online = workerHarness(source);
  assert.equal(await online.request('/', { mode: 'navigate' }).result, 'network-response');
  const noShell = workerHarness(source, { cachedShell: null, network: async () => { throw new TypeError('offline'); } });
  const response = await noShell.request('/', { mode: 'navigate' }).result;
  assert.equal(response.status, 503);
  assert.match(await response.text(), /online/);
});

test('a missing install asset fails the build instead of generating an incomplete worker', async t => {
  const distDir = await buildFixture(t);
  await rm(path.join(distDir, 'icon-512.png'));
  await assert.rejects(finalizePwa({ distDir }), /icon-512\.png/);
});
