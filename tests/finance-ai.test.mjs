import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { buildFinanceContext, interpretFinanceWithGemini } from '../src/finance-ai.js';
import { emptyFinance, validateFinance, financeDay } from '../src/finance-domain.js';
import { createHandler } from '../server/index.js';

function data(count = 0) {
  const state = emptyFinance();
  state.accounts.push({ id: 'bank', name: 'Banca test', type: 'current', currency: 'EUR', openingCents: 100000, openingDate: '2026-01-01', openingVerified: true, sourceData: { neverSend: 'raw-private-source' } });
  state.categories.push({ id: 'fuel', name: 'Benzina', type: 'expense', parentId: null });
  for (let index = 0; index < count; index++) state.transactions.push({ id: `test-${index}`, type: 'expense', date: '2026-10-01', accountId: 'bank', currency: 'EUR', amountCents: 1000, categoryId: 'fuel', description: 'Benzina sintetica', notes: 'Nota di test', status: 'posted', sourceData: { neverSend: 'source-row' }, receipt: 'data:image/png;base64,do-not-send' });
  state.importRows.push({ id: 'raw-row', importBatchId: 'old-import', raw: ['never-send'] });
  return validateFinance(state);
}
const call = () => ({ name: 'propose_transaction', args: { type: 'expense', date: financeDay(), accountId: 'bank', amountCents: 2400, currency: 'EUR', categoryId: 'fuel' } });
const action = () => ({ type: 'upsert', args: { collection: 'transactions', record: { ...call().args, id: 'fixed-server-id', status: 'posted', source: 'gemini-proposal' } } });
const response = (calls = [], actions = []) => ({ provider: 'gemini', saved: false, financeToolCalls: calls, financeActions: actions, operationId: 'fixed-server-operation', requiresConfirmation: actions.length > 0, message: 'Conferma la proposta.' });
function options(body, capture = []) { return { getToken: async () => 'fixture-token', fetcher: async (url, request) => { capture.push({ url, ...request, parsed: JSON.parse(request.body) }); return new Response(JSON.stringify(body), { status: 200 }); } }; }

test('AI context projection excludes source metadata, audit, receipts, verification internals and whole history', () => {
  const context = buildFinanceContext(data(200), 'Qual è la mia liquidità attuale?');
  assert.equal(context.transactions.length, 0); assert.equal(context.accounts[0].openingVerified, undefined); assert.equal(context.accounts[0].sourceData, undefined); assert.equal(context.importRows, undefined);
  const encoded = JSON.stringify(context); assert.equal(encoded.includes('never-send'), false); assert.equal(encoded.includes('raw-private-source'), false); assert.equal(encoded.includes('source-row'), false); assert.equal(encoded.includes('data:image'), false);
  assert.equal(context.reports[0].values.liquidityCents, -100000); assert.equal(context.reports[0].name, 'liquidity');
});

test('AI context selects at most 80 relevant records and keeps referenced categories/accounts', () => {
  const state = data(200), context = buildFinanceContext(state, 'Riclassifica il movimento benzina');
  assert.equal(context.transactions.length, 80); assert.equal(context.transactions.every(record => record.categoryId === 'fuel'), true); assert.equal(context.categories[0].id, 'fuel'); assert.equal(context.accounts[0].id, 'bank');
  assert.throws(() => buildFinanceContext(state, 'Benzina', { maxTransactions: 81 }), /80/);
  assert.equal(context.transactions.some(record => 'receipt' in record || 'sourceData' in record), false);
});

test('AI context retains derived historical import marker without batch identifiers or raw metadata', () => {
  const state = data(); state.accounts[0].openingDate = '2026-10-01'; state.transactions.push({ id: 'historical', type: 'expense', date: '2025-01-01', amountCents: 2000, currency: 'EUR', accountId: 'bank', categoryId: 'fuel', description: 'Benzina storica', importBatchId: 'private-batch-hash', sourceData: { raw: 'private-original' } });
  const context = buildFinanceContext(validateFinance(state), 'Riclassifica benzina storica');
  assert.equal(context.transactions[0].historicalImport, true); assert.equal(context.transactions[0].importBatchId, undefined); assert.equal(JSON.stringify(context).includes('private-batch-hash'), false);
});

test('AI generated actions are revalidated on full repository and preserve exact server IDs/operation ID', async () => {
  const state = data(), before = JSON.stringify(state), capture = [];
  const result = await interpretFinanceWithGemini('Oggi ho speso 24 euro di benzina da Banca test', state, options(response([call()], [action()]), capture));
  assert.equal(result.actions[0].args.record.id, 'fixed-server-id'); assert.equal(result.operationId, 'fixed-server-operation'); assert.equal(result.confirmationRequired, true); assert.equal(result.saved, false); assert.equal(JSON.stringify(state), before);
  assert.equal(capture[0].headers.Authorization, 'Bearer fixture-token'); assert.equal(capture[0].parsed.financeContext.transactions.length, 0); assert.equal(capture[0].parsed.state, undefined);
});

test('AI read tools calculate against complete state, never the limited context snapshot', async () => {
  const state = data(200), capture = [];
  const result = await interpretFinanceWithGemini('Quanto ho speso quest’anno?', state, options(response([{ name: 'get_cashflow_report', args: { start: '2026-01-01', end: '2026-12-31', currency: 'EUR' } }]), capture));
  assert.equal(capture[0].parsed.financeContext.transactions.length, 0); assert.equal(result.data[0].data.expenseCents, 200000); assert.equal(result.actions.length, 0); assert.equal(result.message.includes('Trasferimenti esclusi.'), true);
});

test('AI response invalid foreign references, deletion, unknown tools and false saved state are rejected', async () => {
  const invalidReference = action(); invalidReference.args.record.accountId = 'foreign-bank';
  await assert.rejects(() => interpretFinanceWithGemini('Oggi spesa 24 euro', data(), options(response([call()], [invalidReference]))), /riferimento/);
  await assert.rejects(() => interpretFinanceWithGemini('Oggi spesa 24 euro', data(), options(response([call()], [{ type: 'remove', args: { collection: 'accounts', id: 'bank' } }]))), /non consentita/);
  await assert.rejects(() => interpretFinanceWithGemini('Saldo', data(), options(response([{ name: 'unknown', args: {} }]))), /non valido/);
  await assert.rejects(() => interpretFinanceWithGemini('Saldo', data(), options({ ...response(), saved: true })), /non valida/);
  await assert.rejects(() => interpretFinanceWithGemini('Saldo', data(), options(response([], [action()]))), /incoerenti/);
});

test('AI unavailable network, timeout, missing auth and HTTP errors never produce successful proposals', async () => {
  await assert.rejects(() => interpretFinanceWithGemini('Saldo', data(), { getToken: async () => { throw new Error('Accesso richiesto'); } }), /Accesso richiesto/);
  await assert.rejects(() => interpretFinanceWithGemini('Saldo', data(), { getToken: async () => 'token', fetcher: async () => { throw new Error('offline'); } }), /non raggiungibile/);
  await assert.rejects(() => interpretFinanceWithGemini('Saldo', data(), { getToken: async () => 'token', fetcher: async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); } }), /tempo/);
  await assert.rejects(() => interpretFinanceWithGemini('Saldo', data(), { getToken: async () => 'token', fetcher: async () => new Response(JSON.stringify({ error: 'Limite raggiunto' }), { status: 429 }) }), /Limite raggiunto/);
});

test('Client context and authenticated backend agree end to end without raw metadata', async () => {
  const handler = createHandler({ env: { GEMINI_API_KEY: 'synthetic-only' }, verifyToken: async () => ({ uid: 'owner' }), fetcher: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: call() }] } }] }) }) });
  const fetcher = async (url, request) => {
    const req = Readable.from([Buffer.from(request.body)]); Object.assign(req, { method: request.method, url, socket: { remoteAddress: '127.0.0.1' }, headers: Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), value])) });
    let status = 200, body; const res = { writableEnded: false, setHeader() {}, writeHead(code) { status = code; }, end(value) { body = value; this.writableEnded = true; } };
    await handler(req, res); return new Response(body, { status });
  };
  const result = await interpretFinanceWithGemini('Oggi ho speso 24 euro di benzina da Banca test', data(200), { getToken: async () => 'fixture-token', fetcher });
  assert.equal(result.actions.length, 1); assert.equal(result.confirmationRequired, true); assert.equal(result.saved, false);
});
