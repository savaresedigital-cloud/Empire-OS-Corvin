import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import path from 'node:path';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
const assets = {};
async function collect(dir, prefix = '') { for (const entry of await readdir(dir, { withFileTypes: true })) { if (entry.name.startsWith('.') || entry.name === 'server') continue; const file = path.join(dir, entry.name), name = prefix + '/' + entry.name; if (entry.isDirectory()) await collect(file, name); else assets[name] = { type: types[path.extname(file)] || 'application/octet-stream', data: (await readFile(file)).toString('base64') }; } }
await collect('dist');
await mkdir('worker', { recursive: true });
await writeFile('worker/assets.generated.js', 'export default ' + JSON.stringify(assets) + ';\n');
await mkdir('dist/server', { recursive: true }); await mkdir('dist/.openai', { recursive: true });
await build({ entryPoints: ['worker/index.js'], outfile: 'dist/server/index.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true });
await writeFile('dist/.openai/hosting.json', await readFile('.openai/hosting.json'));
const output = await readFile('dist/server/index.js', 'utf8');
const module = await import('data:text/javascript;base64,' + Buffer.from(output).toString('base64'));
if (typeof module.default?.fetch !== 'function') throw new Error('Entrypoint Worker non valido.');
console.log(`Worker pronto: ${Object.keys(assets).length} risorse, ${Buffer.byteLength(output)} byte. Nessun archivio personale nel bundle.`);
