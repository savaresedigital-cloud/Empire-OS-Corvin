import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { emptyFinance, accountBalance, financialReport, applyFinance, exportFinanceCsv } from '../src/finance-domain.js';
import { parseFinanceFile, prepareFinanceImport, undoFinanceImport, parseImportCents, parseImportDate, parseFinanceCsv, financeImportErrorCsv } from '../src/finance-import.js';

const file = (content, name = 'synthetic.csv') => ({ name, arrayBuffer: async () => new TextEncoder().encode(content).buffer });
const synthetic = 'Data;Conto;Categoria;Importo;Tipo;Valuta;Destinazione;Nota\r\n2026-10-01;Banca;Alimentari;20,50;Spesa;EUR;;Pane\r\n2026-10-02;Banca;;100;Trasferimento;EUR;Contanti;\r\n2026-10-03;Banca;Lavoro;75;Guadagno;EUR;;\r\n';

test('CSV quoted separators, multiline fields, escaped quotes and original duplicate headers survive', () => {
  const parsed = parseFinanceCsv('Data;Nota;Conto;Conto\r\n2026-10-01;"riga;uno\ncon ""virgolette""";Banca;20\r\n');
  assert.equal(parsed.separator, ';'); assert.deepEqual(parsed.headers, ['Data', 'Nota', 'Conto', 'Conto']);
  assert.equal(parsed.rows[0].values[1], 'riga;uno\ncon "virgolette"'); assert.equal(parsed.rows[0].rowNumber, 2);
  assert.throws(() => parseFinanceCsv('A;B\n"aperta;1'), /non chiuse/);
});

test('Exact cents parser rejects ambiguity and excess precision', () => {
  assert.equal(parseImportCents('1.234,56', ','), 123456); assert.equal(parseImportCents('1,234.56', '.'), 123456);
  assert.equal(parseImportCents('(24,90)', ','), -2490); assert.equal(parseImportCents('0.01', '.'), 1);
  assert.throws(() => parseImportCents('1.234'), /ambiguo/); assert.throws(() => parseImportCents('12.3456', '.'), /due decimali/);
  assert.throws(() => parseImportCents('1,2,3', '.'), /migliaia/); assert.throws(() => parseImportCents('Infinity'), /numerico/);
});

test('Dates never guess ambiguous locale and preserve Excel local calendar day', () => {
  assert.equal(parseImportDate('01/02/2026', 'dd/mm/yyyy'), '2026-02-01'); assert.equal(parseImportDate('01/02/2026', 'mm/dd/yyyy'), '2026-01-02');
  assert.throws(() => parseImportDate('01/02/2026'), /ambigua/); assert.throws(() => parseImportDate('31/02/2026', 'dd/mm/yyyy'), /non valida/);
  assert.equal(parseImportDate('1', 'excel'), '1900-01-01'); assert.equal(parseImportDate('61.99', 'excel'), '1900-03-01'); assert.throws(() => parseImportDate('60', 'excel'), /intervallo/);
  assert.equal(parseImportDate('1.75', 'excel', { date1904: true }), '1904-01-02');
});

test('Preview is non-mutating, cents exact, transfers single records, opening balances unknown', async () => {
  const source = await parseFinanceFile(file(synthetic)); const original = emptyFinance();
  const preview = await prepareFinanceImport(source, original, source.suggestedMapping, { decimal: ',', today: '2026-10-12' });
  assert.equal(original.accounts.length, 0); assert.equal(preview.valid, 3); assert.equal(preview.transfers, 1); assert.equal(preview.errors.length, 0);
  assert.equal(preview.state.transactions.length, 3); assert.equal(preview.accounts.length, 2);
  assert.equal(accountBalance(preview.state, preview.accounts[0].id), null);
  const report = financialReport(preview.state, { start: '2026-10-01', end: '2026-10-31' });
  assert.equal(report.incomeCents, 7500); assert.equal(report.expenseCents, 2050);
  assert.equal(preview.state.importRows.length, 3); assert.deepEqual(preview.state.importRows[0].raw, source.rows[0].values);
  assert.equal(preview.state.importBatches[0].preImportSnapshot.transactions.length, 0);
});

test('Same file twice creates no duplicates, no second batch and changed filename is irrelevant', async () => {
  const source = await parseFinanceFile(file(synthetic)); const first = await prepareFinanceImport(source, emptyFinance(), source.suggestedMapping, { decimal: ',' });
  const repeat = await prepareFinanceImport({ ...source, name: 'renamed.csv' }, first.state, source.suggestedMapping, { decimal: ',' });
  assert.equal(repeat.valid, 0); assert.equal(repeat.duplicates, 3); assert.equal(repeat.state.transactions.length, 3); assert.equal(repeat.state.importBatches.length, 1);
});

test('Overlapping files flag exact source fingerprints and preserve separate same-day payments', async () => {
  const source = await parseFinanceFile(file(synthetic)); const first = await prepareFinanceImport(source, emptyFinance(), source.suggestedMapping, { decimal: ',' });
  const secondSource = await parseFinanceFile(file(synthetic + '2026-10-04;Banca;Alimentari;10;Spesa;EUR;;Frutta\r\n'));
  const second = await prepareFinanceImport(secondSource, first.state, secondSource.suggestedMapping, { decimal: ',' });
  assert.equal(second.valid, 1); assert.equal(second.duplicates, 3); assert.equal(second.state.transactions.length, 4);
  const repeatedPaymentsSource = await parseFinanceFile(file('Data;Conto;Importo;Tipo\n2026-10-01;Banca;2;Spesa\n2026-10-01;Banca;2;Spesa\n'));
  const payments = await prepareFinanceImport(repeatedPaymentsSource, emptyFinance());
  assert.equal(payments.valid, 2); assert.ok(payments.warnings.some(warning => warning.code === 'similar-row'));
});

test('Bad dates, bad amounts and zero are reported by row and never silently saved', async () => {
  const source = await parseFinanceFile(file('Data;Conto;Importo;Tipo\n31/02/2026;Banca;20;Spesa\n2026-10-02;Banca;venti;Spesa\n2026-10-03;Banca;0;Spesa\n2026-10-04;Banca;10;Spesa\n'));
  const preview = await prepareFinanceImport(source, emptyFinance(), source.suggestedMapping, { dateFormat: 'dd/mm/yyyy' });
  assert.equal(preview.errors.length, 3); assert.equal(preview.valid, 1); assert.equal(preview.state.transactions.length, 1);
  assert.deepEqual(preview.errors.map(error => error.row), [2, 3, 4]); assert.match(financeImportErrorCsv(preview), /Importo nullo/);
});

test('Explicit aliases map accounts and destinations without making additional money', async () => {
  const state = applyFinance(emptyFinance(), { type: 'upsert', args: { collection: 'accounts', record: { id: 'bank', name: 'Conto confermato', type: 'current', currency: 'EUR', openingCents: 100000, openingDate: '2026-09-30' } } });
  const source = await parseFinanceFile(file(synthetic)); const mapping = { ...source.suggestedMapping, accountAliases: { Banca: 'bank' } };
  const preview = await prepareFinanceImport(source, state, mapping, { decimal: ',' });
  assert.equal(preview.accounts.length, 1); assert.equal(preview.state.accounts.length, 2); assert.equal(accountBalance(preview.state, 'bank', '2026-10-31'), 95450);
  assert.equal(preview.state.accounts.find(account => account.id === 'bank').openingCents, 100000);
});

test('Undo removes only batch records, keeps preexisting data and permits reimport', async () => {
  const state = applyFinance(emptyFinance(), { type: 'upsert', args: { collection: 'accounts', record: { id: 'unrelated', name: 'Preesistente', currency: 'EUR', type: 'cash', openingCents: 5000, openingDate: '2026-01-01' } } });
  const source = await parseFinanceFile(file(synthetic)); const first = await prepareFinanceImport(source, state, source.suggestedMapping, { decimal: ',' });
  const undone = await undoFinanceImport(first.state, first.batchId);
  assert.equal(undone.transactions.length, 0); assert.equal(undone.accounts.length, 1); assert.equal(undone.accounts[0].id, 'unrelated'); assert.equal(undone.importBatches[0].status, 'undone');
  const reimported = await prepareFinanceImport(source, undone, source.suggestedMapping, { decimal: ',' });
  assert.equal(reimported.state.transactions.length, 3); assert.notEqual(reimported.batchId, first.batchId);
});

test('Undo retains edited imported transaction and its referenced account/category', async () => {
  const source = await parseFinanceFile(file(synthetic)); const first = await prepareFinanceImport(source, emptyFinance(), source.suggestedMapping, { decimal: ',' });
  const edited = applyFinance(first.state, { type: 'upsert', args: { collection: 'transactions', record: { id: first.state.transactions[0].id, description: 'Correzione successiva' } } });
  const undone = await undoFinanceImport(edited, first.batchId);
  assert.equal(undone.transactions.length, 1); assert.equal(undone.transactions[0].description, 'Correzione successiva'); assert.equal(undone.accounts.length, 1); assert.equal(undone.categories.length, 1);
  assert.ok(undone.importBatches[0].undoReport.retained.length >= 3);
});

test('Native JSON restores a complete finance backup; native CSV retains references and never overwrites conflicts', async () => {
  const source = await parseFinanceFile(file(synthetic)); const first = await prepareFinanceImport(source, emptyFinance(), source.suggestedMapping, { decimal: ',' });
  const backup = await parseFinanceFile(file(JSON.stringify({ app: 'Empire OS', finance: first.state }), 'backup.json'));
  const restored = await prepareFinanceImport(backup, emptyFinance()); assert.equal(restored.state.transactions.length, 3); assert.equal(restored.state.accounts.length, 2);
  const exportedCsv = await parseFinanceFile(file(exportFinanceCsv(first.state)));
  assert.equal(exportedCsv.kind, 'empire-finance'); assert.equal(exportedCsv.partial, true);
  const csvRepeat = await prepareFinanceImport(exportedCsv, first.state); assert.equal(csvRepeat.valid, 0); assert.equal(csvRepeat.state.transactions.length, 3);
  await assert.rejects(() => prepareFinanceImport(exportedCsv, emptyFinance()), /riferimento/);
});

function xlsxFixture() {
  return zipSync(Object.fromEntries(Object.entries({
    'xl/workbook.xml': '<workbook xmlns:r="r"><workbookPr date1904="false"/><sheets><sheet name="Primo" r:id="rId1"/><sheet name="Secondo" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Data</t></si><si><t>Conto</t></si><si><t>Importo</t></si><si><t>Tipo</t></si><si><t>Banca &amp; carta</t></si><si><t>Spesa</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row r="2"><c r="A2"><v>46296.75</v></c><c r="B2" t="s"><v>4</v></c><c r="C2"><v>12.34</v></c><c r="D2" t="s"><v>5</v></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Altro</t></is></c></row></sheetData></worksheet>',
  }).map(([key, value]) => [key, strToU8(value)])));
}

test('XLSX byte sniff works without extension and supports sheet selection, shared/inline XML strings', async () => {
  const bytes = xlsxFixture(); const source = await parseFinanceFile(bytes);
  assert.equal(source.kind, 'xlsx'); assert.equal(source.sheets.length, 2); assert.equal(source.rows[0].values[1], 'Banca & carta');
  const mapping = { ...source.suggestedMapping, dateFormat: 'excel', decimal: '.' }; const preview = await prepareFinanceImport(source, emptyFinance(), mapping);
  assert.equal(preview.valid, 1); assert.equal(preview.preview[0].amountCents, 1234);
  const second = await parseFinanceFile(bytes, { sheet: 'Secondo' }); assert.equal(second.columns[0].name, 'Altro'); assert.equal(second.rows.length, 0);
  await assert.rejects(() => parseFinanceFile(bytes, { sheet: 'Mancante' }), /non trovato/);
});

test('Encoding fallback is explicit and malformed legacy XLS never pretends to be supported', async () => {
  const bytes = new Uint8Array([68, 97, 116, 97, 59, 78, 111, 116, 97, 10, 50, 48, 50, 54, 45, 49, 48, 45, 48, 49, 59, 99, 97, 102, 102, 232]);
  await assert.rejects(() => parseFinanceFile(bytes), /Codifica/); const source = await parseFinanceFile(bytes, { encoding: 'windows-1252' }); assert.equal(source.rows[0].values[1], 'caffè');
  await assert.rejects(() => parseFinanceFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])), /Codifica|Formato/);
});

const moneyPath = 'C:/private/empire-os-fixtures/Money Manager - Excel_';
test('Supplied Money Manager file: 2202 rows, 299 transfers, positional duplicate headers, 17 draft adjustments', { skip: !existsSync(moneyPath) }, async () => {
  const source = await parseFinanceFile(new Uint8Array(await readFile(moneyPath)), { name: 'Money Manager - Excel_' });
  assert.equal(source.rows.length, 2202); assert.equal(source.columns.length, 11); assert.equal(source.columns[1].name, 'Conto'); assert.equal(source.columns[10].name, 'Conto');
  assert.equal(source.suggestedMapping.account, 1); assert.equal(source.suggestedMapping.amount, 5); assert.equal(source.suggestedMapping.destination, 2);
  const preview = await prepareFinanceImport(source, emptyFinance(), source.suggestedMapping, { today: '2026-10-12' });
  assert.equal(preview.valid, 2202); assert.equal(preview.errors.length, 0); assert.equal(preview.transfers, 299); assert.equal(preview.accounts.length, 19);
  assert.equal(preview.preview.filter(tx => tx.status === 'draft').length, 17); assert.equal(preview.warnings.filter(warning => warning.code === 'future-date').length, 1);
  assert.equal(preview.state.accounts.every(account => account.openingCents === null), true);
  assert.equal(preview.state.transactions.filter(tx => tx.type === 'transfer').every(tx => tx.toAccountId && !tx.categoryId), true);
  const repeat = await prepareFinanceImport(source, preview.state); assert.equal(repeat.duplicates, 2202); assert.equal(repeat.valid, 0);
  // Assertions inspect counts/schema only; private source rows are never written or logged.
});
