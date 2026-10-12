import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { migrateLegacyBusiness, legacyBusinessReport } from '../src/finance-business.js';
import { parseFinanceFile, prepareFinanceImport, undoFinanceImport } from '../src/finance-import.js';
import { emptyFinance, financialReport, businessReport } from '../src/finance-domain.js';

const data = () => ({
  channels: [{ id: 'shop', name: 'Negozio di test ', logoUrl: 'data:image/png;base64,AAAA', notes: 'Nota sintetica', totalRevenueYear: 100, netProfit: 80 }],
  products: [{ id: 'product', name: 'Prodotto sintetico', channelId: 'shop', stock: 4, sold: 1, price: 100, costPrice: 10, imageUrl: 'data:image/png;base64,AAAA', category: 'Prodotto Fisico', platforms: ['Etsy'], lastUpdated: '2026-10-01T00:00:00Z' }, { id: 'orphan', name: 'Da assegnare', channelId: 'missing', imageUrl: '', notes: 'Origine conservata' }],
  orders: [{ id: 'sale', type: 'SALE', date: '2026-10-01', channelId: 'shop', productId: 'product', quantity: 1, grossRevenue: 100, expenses: 15, profit: 85, clientNotes: 'Test', platform: 'Etsy', status: 'Venduto' }, { id: 'expense', type: 'EXPENSE', date: '2026-10-02', channelId: 'shop', quantity: 1, grossRevenue: 0, expenses: 5, profit: -5, clientNotes: 'Test costo', platform: '', status: 'Spesa' }],
});
const blob = (body, name = 'synthetic-business.json') => ({ name, arrayBuffer: async () => new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)).buffer });
const envelope = body => ({ app: 'MyBusinessEmpire', dataType: 'full-backup', schemaVersion: 1, exportedAt: '2026-10-01T00:00:00Z', data: body });

test('Legacy mapping preserves historical source semantics, orphan products and omits embedded images', () => {
  const migrated = migrateLegacyBusiness(data(), { batchId: 'batch', now: '2026-10-12T00:00:00Z' });
  assert.equal(migrated.counts.channels, 1); assert.equal(migrated.counts.products, 2); assert.equal(migrated.counts.orders, 2); assert.equal(migrated.counts.orphanProducts, 1);
  assert.equal(migrated.payload.orders[0].grossCents, 10000); assert.equal(migrated.payload.orders[0].directCostCents, 1500); assert.equal(migrated.payload.orders[0].feesCents, null);
  assert.equal(migrated.payload.businessCosts[0].amountCents, 500); assert.equal(migrated.excludedAssets.length, 2);
  assert.equal(JSON.stringify(migrated.payload).includes('base64,AAAA'), false); assert.equal(migrated.payload.businesses[1].sourceData.orphanProducts[0].channelId, 'missing');
  assert.equal(migrated.payload.businesses[0].active, false); assert.equal(migrated.payload.businesses[0].sourceData.name, 'Negozio di test ');
  assert.equal(migrated.payload.transactions, undefined); assert.equal(migrated.payload.accounts, undefined);
});

test('Migration preview never creates bank balances or converts old annual aggregates into revenue', async () => {
  const source = await parseFinanceFile(blob(envelope(data()))); const original = emptyFinance(); const preview = await prepareFinanceImport(source, original);
  assert.equal(original.orders.length, 0); assert.equal(preview.valid, 2); assert.equal(preview.state.accounts.length, 0); assert.equal(preview.state.transactions.length, 0);
  const financial = financialReport(preview.state, { start: '2026-10-01', end: '2026-10-31' }); assert.equal(financial.incomeCents, 0); assert.equal(financial.expenseCents, 0);
  const report = legacyBusinessReport(preview.state); assert.equal(report.revenueCents, 10000); assert.equal(report.knownCostsCents, 2000); assert.equal(report.marginCents, 8000); assert.equal(report.complete, false); assert.equal(report.bankLiquidityCents, null);
  const domainReport = businessReport(preview.state, preview.state.businesses[0].id, { start: '2026-10-01', end: '2026-10-31' }); assert.ok(domainReport);
  assert.equal(preview.report.excludedImages, 2); assert.ok(preview.warnings.some(warning => warning.code === 'historical-only'));
});

test('Business repeated file and differently formatted same source IDs deduplicate without dangling references', async () => {
  const source = await parseFinanceFile(blob(envelope(data()))); const first = await prepareFinanceImport(source, emptyFinance());
  const repeated = await prepareFinanceImport(source, first.state); assert.equal(repeated.valid, 0); assert.equal(repeated.duplicates, 2);
  const formatted = await parseFinanceFile(blob(JSON.stringify(envelope(data()), null, 2)));
  const overlap = await prepareFinanceImport(formatted, first.state); assert.equal(overlap.valid, 0); assert.equal(overlap.duplicates, 2); assert.equal(overlap.state.orders.length, 1); assert.equal(overlap.state.businessCosts.length, 1); assert.equal(overlap.state.businesses.length, 2);
});

test('Invalid business records are reported and original unknown references retained rather than guessed', () => {
  const body = data(); body.orders.push({ ...body.orders[0], id: 'bad', channelId: 'unknown' }); body.orders.push({ ...body.orders[0], id: 'badprofit', profit: 99 });
  const migrated = migrateLegacyBusiness(body, { batchId: 'batch' }); assert.equal(migrated.errors.length, 2); assert.equal(migrated.payload.orders.length, 1); assert.equal(migrated.payload.importRows.filter(row => row.status === 'error').length, 2);
  assert.equal(migrated.payload.importRows.find(row => row.sourceId === 'bad').raw.channelId, 'unknown');
  assert.throws(() => migrateLegacyBusiness({ ...body, channels: [...body.channels, body.channels[0]] }), /duplicati/);
});

test('Undo business session leaves unrelated records intact and removes imported history', async () => {
  const source = await parseFinanceFile(blob(envelope(data()))); const preview = await prepareFinanceImport(source, emptyFinance());
  const undone = await undoFinanceImport(preview.state, preview.batchId); assert.equal(undone.businesses.length, 0); assert.equal(undone.orders.length, 0); assert.equal(undone.businessCosts.length, 0);
});

const legacyPath = 'C:/private/empire-os-fixtures/backup_impero_2026-10-11.json';
test('Supplied My Empire source: 9 channels, 15 products, 68 records, 6 orphan products, 13 images excluded', { skip: !existsSync(legacyPath) }, async () => {
  const source = await parseFinanceFile(new Uint8Array(await readFile(legacyPath)), { name: 'backup_impero_2026-10-11.json' });
  assert.equal(source.kind, 'my-empire'); const preview = await prepareFinanceImport(source, emptyFinance());
  assert.equal(preview.total, 68); assert.equal(preview.valid, 68); assert.equal(preview.errors.length, 0); assert.equal(preview.report.channels, 9); assert.equal(preview.report.products, 15); assert.equal(preview.report.orphanProducts, 6); assert.equal(preview.report.excludedImages, 13);
  assert.equal(preview.state.orders.length, 63); assert.equal(preview.state.businessCosts.length, 5); assert.equal(preview.state.transactions.length, 0); assert.equal(preview.state.accounts.length, 0);
  assert.equal(JSON.stringify(preview.state).includes('data:image/'), false);
  // Source parsing is read-only; no personal records or financial amounts are logged or committed.
});
