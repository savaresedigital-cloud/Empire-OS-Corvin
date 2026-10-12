import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHandler } from '../server/index.js';
import { financeDay } from '../src/finance-domain.js';

const date = () => financeDay();
const context = () => ({ schemaVersion: 1, ownerId: 'local', settings: { currency: 'EUR', defaultAccountId: null }, accounts: [{ id: 'bank', name: 'Banca test', type: 'current', currency: 'EUR', openingCents: 100000, openingDate: '2026-01-01', active: true, includeInLiquidity: true }, { id: 'cash', name: 'Contanti test', type: 'cash', currency: 'EUR', openingCents: 0, openingDate: '2026-01-01' }], categories: [{ id: 'fuel', name: 'Benzina', type: 'expense', parentId: null }], goals: [], businesses: [], transactions: [], reports: [{ name: 'liquidity', asOf: date(), currency: 'EUR', values: { liquidityCents: 100000, unknownAccounts: 0 } }] });
const proposal = (overrides = {}) => ({ name: 'propose_transaction', args: { type: 'expense', date: date(), amountCents: 2400, currency: 'EUR', accountId: 'bank', categoryId: 'fuel', description: 'Benzina sintetica', ...overrides } });
function transport(calls = [], { env = { GEMINI_API_KEY: 'fixture-only-secret' }, verifyToken = async () => ({ uid: 'owner' }), upstreamStatus = 200, parts, fetcher } = {}) {
  const captured = [];
  const handler = createHandler({ env, verifyToken, fetcher: fetcher || (async (url, options) => { captured.push({ url, headers: options.headers, body: JSON.parse(options.body) }); return { ok: upstreamStatus === 200, status: upstreamStatus, json: async () => ({ candidates: [{ content: { parts: parts || calls.map(functionCall => ({ functionCall })) } }] }) }; }) });
  return { captured, post: async (body = { message: 'Oggi ho speso 24 euro di benzina da Banca test', financeContext: context() }, { headers = {}, url = '/api/finance/interpret' } = {}) => {
    const payload = JSON.stringify(body);
    const req = Readable.from([Buffer.from(payload)]);
    Object.assign(req, { method: 'POST', url, socket: { remoteAddress: '127.0.0.1' }, headers: { 'content-type': 'application/json', authorization: 'Bearer fixture-token', ...headers } });
    let status = 200, response;
    const res = { writableEnded: false, setHeader() {}, writeHead(code) { status = code; }, end(value) { response = value; this.writableEnded = true; } };
    await handler(req, res); return { status, body: JSON.parse(response) };
  } };
}

test('Finance Gemini requires configured key, verified token and allowed origin before upstream transport', async () => {
  const unconfigured = transport([], { env: {} }); assert.equal((await unconfigured.post()).status, 503); assert.equal(unconfigured.captured.length, 0);
  const fixture = transport(); assert.equal((await fixture.post(undefined, { headers: { authorization: '' } })).status, 401); assert.equal((await fixture.post(undefined, { headers: { origin: 'https://foreign.invalid' } })).status, 403); assert.equal(fixture.captured.length, 0);
  const invalidToken = transport([], { verifyToken: async () => { throw Object.assign(new Error('Sessione non valida.'), { status: 401 }); } }); assert.equal((await invalidToken.post()).status, 401);
});

test('Authenticated finance proposal is typed, validated, requires confirmation and never mutates source', async () => {
  const fixture = transport([proposal()]); const original = context(); const snapshot = JSON.stringify(original);
  const result = await fixture.post({ message: 'Oggi ho speso 24 euro di benzina da Banca test', financeContext: original });
  assert.equal(result.status, 200); assert.equal(result.body.saved, false); assert.equal(result.body.requiresConfirmation, true); assert.equal(result.body.provider, 'gemini'); assert.equal(result.body.financeActions.length, 1); assert.equal(result.body.financeActions[0].args.record.amountCents, 2400); assert.equal(result.body.financeToolCalls[0].name, 'propose_transaction'); assert.equal(JSON.stringify(original), snapshot);
  assert.equal(fixture.captured[0].headers['x-goog-api-key'], 'fixture-only-secret'); assert.equal(JSON.stringify(result.body).includes('fixture-only-secret'), false);
  const sent = JSON.parse(fixture.captured[0].body.contents[0].parts[0].text).context;
  assert.equal(sent.transactions.length, 0); assert.equal(sent.reports[0].provenance, 'deterministic-client-report'); assert.equal(sent.importRows, undefined); assert.equal(sent.accounts[0].sourceData, undefined);
});

test('Finance read tools return typed calls for full client repository, never partial-server balances', async () => {
  const fixture = transport([{ name: 'get_cashflow_report', args: { start: '2026-01-01', end: '2026-12-31', currency: 'EUR' } }, { name: 'get_account_balance', args: { accountId: 'bank' } }]);
  const result = await fixture.post({ message: 'Mostra saldi e flussi annuali', financeContext: context() });
  assert.equal(result.status, 200); assert.equal(result.body.financeToolCalls.length, 2); assert.deepEqual(result.body.financeActions, []); assert.equal(result.body.requiresConfirmation, false); assert.equal(result.body.results, undefined); assert.equal(result.body.saved, false);
});

test('Finance rejects full history, raw rows, source metadata, foreign owners and >80 transactions before Gemini', async () => {
  for (const mutate of [c => { c.importRows = []; }, c => { c.ownerId = 'other-user'; }, c => { c.accounts[0].ownerId = 'other-user'; }, c => { c.accounts[0].sourceData = { originalNote: 'never-send' }; }, c => { c.transactions = Array.from({ length: 81 }, (_, i) => ({ id: `tx-${i}` })); }, c => { c.reports[0].values.raw = { rows: [] }; }]) {
    const fixture = transport([proposal()]); const c = context(); mutate(c); const result = await fixture.post({ message: 'Oggi spesa 24 euro da Banca test', financeContext: c });
    assert.ok([400, 403].includes(result.status)); assert.equal(fixture.captured.length, 0);
  }
  const fullBody = transport(); assert.equal((await fullBody.post({ message: 'Ciao', financeContext: context(), financeState: {} })).status, 400);
});

test('Finance tool enums, integers, properties, IDs and read limits are validated on server', async () => {
  for (const call of [proposal({ type: 'unrecognised' }), proposal({ amountCents: 24.5 }), proposal({ accountId: 'invented' }), proposal({ exploit: 'disallowed' }), { name: 'delete_finances', args: {} }, { name: 'search_transactions', args: { type: 'invalid' } }, { name: 'search_transactions', args: { limit: -1 } }, { name: 'get_cashflow_report', args: { start: '2026-10-31', end: '2026-01-01' } }]) {
    const result = await transport([call]).post(); assert.equal(result.status, 422); assert.equal(result.body.financeActions, undefined);
  }
});

test('Finance refuses invented/mismatched dates, amount and unnamed account unless visible default exists', async () => {
  assert.equal((await transport([proposal()]).post({ message: 'Ho speso 24 euro di benzina da Banca test', financeContext: context() })).status, 422);
  assert.equal((await transport([proposal({ date: '2020-01-01' })]).post()).status, 422);
  assert.equal((await transport([proposal({ amountCents: 240000 })]).post()).status, 422);
  assert.equal((await transport([proposal()]).post({ message: 'Oggi ho speso 24 euro di benzina', financeContext: context() })).status, 422);
  const defaultContext = context(); defaultContext.settings.defaultAccountId = 'bank';
  assert.equal((await transport([proposal()]).post({ message: 'Oggi ho speso 24 euro di benzina', financeContext: defaultContext })).status, 200);
});

test('Internal transfer proposal uses two existing named accounts and a single validated movement', async () => {
  const call = { name: 'create_transfer', args: { date: date(), accountId: 'bank', toAccountId: 'cash', amountCents: 10000, currency: 'EUR' } };
  const result = await transport([call]).post({ message: 'Sposta oggi 100 euro da Banca test a Contanti test', financeContext: context() });
  assert.equal(result.status, 200); assert.equal(result.body.financeActions.length, 1); assert.equal(result.body.financeActions[0].args.record.type, 'transfer');
  const missing = await transport([call]).post({ message: 'Sposta oggi 100 euro da Banca test', financeContext: context() }); assert.equal(missing.status, 422);
});

test('Multi-write finance response fails atomically on second invalid call', async () => {
  const fixture = transport([proposal(), proposal({ accountId: 'missing' })]); const result = await fixture.post();
  assert.equal(result.status, 422); assert.equal(result.body.financeActions, undefined); assert.equal(result.body.saved, undefined);
});

test('Finance no-call replies cannot claim saved operations or fabricated numeric balances', async () => {
  const result = await transport([], { parts: [{ text: 'Ho salvato la spesa. Il saldo è 999 euro.' }] }).post();
  assert.equal(result.status, 200); assert.equal(result.body.saved, false); assert.equal(result.body.requiresConfirmation, false); assert.equal(result.body.message.includes('999'), false); assert.equal(result.body.message.includes('Ho salvato'), false);
});

test('Gemini finance outages and timeout have no partial actions or false success', async () => {
  const upstream = await transport([proposal()], { upstreamStatus: 429 }).post(); assert.equal(upstream.status, 429); assert.equal(upstream.body.financeActions, undefined);
  const timeout = await transport([], { fetcher: async () => { throw Object.assign(new Error('fixture-timeout'), { name: 'TimeoutError' }); } }).post(); assert.equal(timeout.status, 504); assert.equal(timeout.body.financeActions, undefined);
});

test('Finance and Task share the authenticated per-user rate limit', async () => {
  const fixture = transport([]);
  for (let index = 0; index < 15; index++) assert.equal((await fixture.post()).status, 200);
  assert.equal((await fixture.post()).status, 429); assert.equal(fixture.captured.length, 15);
});

test('Authenticated UID-owned snapshot is accepted while owner fields must agree', async () => {
  const c = context(); c.ownerId = 'owner'; c.settings.ownerId = 'owner'; c.accounts.forEach(record => { record.ownerId = 'owner'; }); c.categories.forEach(record => { record.ownerId = 'owner'; });
  assert.equal((await transport([proposal()]).post({ message: 'Oggi ho speso 24 euro di benzina da Banca test', financeContext: c })).status, 200);
  c.settings.ownerId = 'foreign'; assert.equal((await transport().post({ message: 'Ciao', financeContext: c })).status, 403);
});

test('Finance rejects mismatched EUR request versus USD proposal and validates explicit day', async () => {
  const usd = context(); usd.accounts[0].currency = 'USD';
  const wrongCurrency = await transport([proposal({ currency: 'USD' })]).post({ message: 'Oggi ho speso 24 euro di benzina da Banca test', financeContext: usd }); assert.equal(wrongCurrency.status, 422);
  const rightCurrency = await transport([proposal({ currency: 'USD' })]).post({ message: 'Oggi ho speso 24 USD di benzina da Banca test', financeContext: usd }); assert.equal(rightCurrency.status, 200);
  const noDay = await transport([proposal()]).post({ message: 'A ottobre ho speso 24 euro di benzina da Banca test', financeContext: context() }); assert.equal(noDay.status, 422);
  const wrongDay = await transport([proposal({ date: '2026-10-02' })]).post({ message: 'Il 01/10/2026 ho speso 24 euro di benzina da Banca test', financeContext: context() }); assert.equal(wrongDay.status, 422);
});

test('Historical imported transaction context uses only derived boolean and accepts classification before opening date', async () => {
  const c = context(); c.transactions.push({ id: 'legacy', type: 'expense', date: '2025-01-01', amountCents: 2400, currency: 'EUR', accountId: 'bank', categoryId: 'fuel', historicalImport: true });
  const result = await transport([{ name: 'classify_transaction', args: { id: 'legacy', categoryId: 'fuel' } }]).post({ message: 'Riclassifica benzina', financeContext: c }); assert.equal(result.status, 200); assert.equal(result.body.financeActions.length, 1);
  c.transactions[0].historicalImport = 'private-batch'; assert.equal((await transport().post({ message: 'Riclassifica benzina', financeContext: c })).status, 400);
});
