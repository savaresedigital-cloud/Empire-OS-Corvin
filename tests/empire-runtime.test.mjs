import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRuntime } from '../worker/runtime.js';
import { emptyState, applyActions } from '../src/domain.js';
import { emptyFinance, applyFinance } from '../src/finance-domain.js';
import { cashSeries, suggestDay } from '../src/empire-metrics.js';
import { ManagedRepository } from '../src/managed-repository.js';
class Bucket {
  data = new Map();
  async head(key) { return this.data.get(key) || null; }
  async get(key) { const item = this.data.get(key); return item ? { ...item, body: new Blob([item.text]).stream(), json: async () => JSON.parse(item.text) } : null; }
  async put(key, value, options = {}) {
    const before = this.data.get(key), condition = options.onlyIf;
    if (condition?.get('If-Match') && before?.httpEtag !== condition.get('If-Match') || condition?.get('If-None-Match') === '*' && before) return null;
    const text = typeof value === 'string' ? value : await new Response(value).text(), etag = createHash('sha256').update(text).digest('hex');
    const object = { text, etag, httpEtag: '"' + etag + '"' }; this.data.set(key, object); return object;
  }
}
const env = () => ({ BUCKET: new Bucket(), EMPIRE_MANAGEMENT_SECRET: Buffer.alloc(32, 7).toString('base64') });
const request = (path, method = 'GET', body, headers = {}) => new Request('https://empire.test' + path, { method, headers: { 'oai-authenticated-user-id': 'owner', Origin: 'https://empire.test', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
test('Private archive denies anonymous and foreign-origin writes; malformed money never persists', async () => {
  const app = createRuntime(), e = env();
  assert.equal((await app.fetch(new Request('https://empire.test/api/archive/finance'), e)).status, 401);
  assert.equal((await app.fetch(request('/api/archive/tasks', 'PUT', emptyState(), { Origin: 'https://other.test' }), e)).status, 403);
  assert.equal((await app.fetch(request('/api/archive/finance', 'PUT', { schemaVersion: 9 }, { 'If-Match': '"missing"' }), e)).status, 500);
  assert.equal(e.BUCKET.data.size, 0);
});
test('Two devices read the same seeded data; stale writes fail and previous versions survive', async () => {
  const app = createRuntime(), e = env(), first = emptyState();
  const write = await app.fetch(request('/api/archive/tasks', 'PUT', first, { 'If-Match': '"missing"' }), e); assert.equal(write.status, 200);
  const a = await (await app.fetch(request('/api/archive/tasks'), e)).json(), b = await (await app.fetch(request('/api/archive/tasks'), e)).json(); assert.deepEqual(a, b);
  const next = applyActions(first, [{ type: 'create_task', args: { title: 'Lavoro reale' } }]);
  assert.equal((await app.fetch(request('/api/archive/tasks', 'PUT', next, { 'If-Match': a.revision }), e)).status, 200);
  assert.equal((await app.fetch(request('/api/archive/tasks', 'PUT', first, { 'If-Match': b.revision }), e)).status, 409);
  assert.ok([...e.BUCKET.data.keys()].some(k => k.startsWith('empire/history/tasks/')));
  assert.equal((await (await app.fetch(request('/api/archive/tasks'), e)).json()).state.tasks[0].title, 'Lavoro reale');
});
test('Missing AI key reports unavailable, never calls Google and never fabricates a model reply', async () => {
  let calls = 0; const app = createRuntime({ fetcher: async () => { calls++; } }), e = env();
  assert.equal((await (await app.fetch(request('/api/status'), e)).json()).aiConfigured, false);
  assert.equal((await app.fetch(request('/api/agent', 'POST', { message: 'Scrivi un’offerta' }), e)).status, 503); assert.equal(calls, 0);
});
test('Agent key is encrypted; model sees selected context and its proposed actions never write the archive', async () => {
  let sent; const app = createRuntime({ fetcher: async (url, options) => {
    if (url.endsWith('/models')) return Response.json({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] });
    sent = JSON.parse(options.body); return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ message: 'Preparo una nuova attività.', taskActions: [{ type: 'create_task', args: JSON.stringify({ title: 'Preparare offerta', areaId: 'business' }) }], financeActions: [] }) }] } }] });
  } }), e = env();
  const key = 'synthetic-test-key-1234567890'; assert.equal((await app.fetch(request('/api/agent/key', 'POST', { key }), e)).status, 200);
  assert.ok(!e.BUCKET.data.get('empire/private/agent-key.json').text.includes(key));
  await e.BUCKET.put('empire/private/tasks.json', JSON.stringify(emptyState())); const f = emptyFinance(); f.privateSourceExample = 'PRIVATE_AUDIT_NOT_FOR_MODEL'; await e.BUCKET.put('empire/private/finance.json', JSON.stringify(f));
  const result = await (await app.fetch(request('/api/agent', 'POST', { message: 'Preparare offerta' }), e)).json();
  assert.equal(result.taskActions[0].args.title, 'Preparare offerta'); assert.ok(!JSON.stringify(sent).includes('PRIVATE_AUDIT_NOT_FOR_MODEL')); assert.equal((await e.BUCKET.get('empire/private/tasks.json')).text, JSON.stringify(emptyState()));
});
test('Daily curve excludes internal transfers and future transactions; suggestions choose due work without fake tasks', () => {
  let f = applyFinance(emptyFinance(), { type: 'upsert', args: { collection: 'accounts', record: { id: 'a', name: 'A', openingCents: null, currency: 'EUR' } } });
  f = applyFinance(f, { type: 'upsert', args: { collection: 'accounts', record: { id: 'b', name: 'B', openingCents: null, currency: 'EUR' } } });
  for (const [id, type, date, amount, toAccountId] of [['i','income','2026-10-01',10000],['e','expense','2026-10-02',2500],['t','transfer','2026-10-02',5000,'b'],['future','expense','2026-11-01',1000]]) f=applyFinance(f,{type:'upsert',args:{collection:'transactions',record:{id,type,date,amountCents:amount,accountId:'a',toAccountId,currency:'EUR'}}});
  assert.deepEqual(cashSeries(f,{start:'2026-10-01',end:'2026-10-03'}).at(-1), {date:'2026-10-03',income:10000,expense:2500,dailyIncome:0,dailyExpense:0});
  const tasks=applyActions(emptyState(),[{type:'create_task',args:{title:'Senza scadenza'}},{type:'create_task',args:{title:'Scadenza',dueAt:'2026-10-12'}},{type:'create_task',args:{title:'TEST QA da ignorare'}}]); assert.equal(suggestDay(tasks,{date:'2026-10-12',count:5})[0].title,'Scadenza'); assert.equal(suggestDay(tasks,{date:'2026-10-12',count:5}).length,2);
});
test('Managed adapter keeps cloud success when optional browser cache fails, and propagates conflicts', async () => {
  const oldFetch=globalThis.fetch; let reads=0; const local={load:async()=>emptyState(),save:async()=>{throw Error('Quota');}};
  globalThis.fetch=async()=>{reads++;return Response.json(reads===1?{state:emptyState(),revision:'"v1"'}:{revision:'"v2"'});};
  try { const repo=new ManagedRepository(local,'tasks');await repo.load();assert.equal(repo.remote,true);await repo.save(emptyState());assert.equal(repo.etag,'"v2"');globalThis.fetch=async()=>Response.json({error:'Conflitto'},{status:409});await assert.rejects(()=>repo.save(emptyState()),/Conflitto/); } finally {globalThis.fetch=oldFetch;}
});
