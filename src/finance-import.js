import { unzipSync } from 'fflate';
import { emptyFinance, validateFinance, applyFinance, accountBalance, FINANCE_COLLECTIONS } from './finance-domain.js';
import { migrateLegacyBusiness } from './finance-business.js';

const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_XML_BYTES = 40 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 120 * 1024 * 1024;
const MAX_ROWS = 100000;
const MAX_COLUMNS = 256;
const copy = value => structuredClone(value);
const text = value => String(value ?? '');

export async function financeHash(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  if (!globalThis.crypto?.subtle) throw new Error('Impronta del file non disponibile: apri l’app in HTTPS o su localhost.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function xmlText(value) {
  return text(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x[\da-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, entity) => {
    if (entity[0] === '#') {
      const point = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '\uFFFD';
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity];
  });
}
function attributes(value) {
  return Object.fromEntries([...value.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(match => [match[1], xmlText(match[2] ?? match[3])]));
}
function elements(xml, name) {
  const expression = new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b([^>]*?)(?:\\/\\s*>|>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}\\s*>)`, 'g');
  return [...xml.matchAll(expression)].map(match => ({ attrs: attributes(match[1]), inner: match[2] || '' }));
}
function getXml(entries, path, optional = false) {
  if (!entries[path]) { if (optional) return ''; throw new Error(`Componente Excel mancante: ${path}.`); }
  const value = new TextDecoder('utf-8', { fatal: true }).decode(entries[path]);
  if (/<!DOCTYPE|<!ENTITY/i.test(value)) throw new Error('Excel con dichiarazioni XML esterne non supportato.');
  return value;
}
function columnIndex(reference) {
  const letters = /^[A-Z]+/i.exec(reference)?.[0];
  if (!letters) throw new Error('Riferimento cella Excel non valido.');
  let index = 0;
  for (const letter of letters.toUpperCase()) index = index * 26 + letter.charCodeAt(0) - 64;
  if (index > MAX_COLUMNS) throw new Error(`Il foglio supera ${MAX_COLUMNS} colonne.`);
  return index - 1;
}
function normalizePath(path) {
  const parts = [];
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (part === '..') { if (!parts.length) throw new Error('Percorso Excel non valido.'); parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function parseXlsx(bytes, options) {
  let totalBytes = 0, count = 0;
  const entries = unzipSync(bytes, { filter: entry => {
    if (++count > 2048) throw new Error('Archivio Excel con troppi componenti.');
    if (entry.originalSize > MAX_XML_BYTES || (totalBytes += entry.originalSize) > MAX_ARCHIVE_BYTES) throw new Error('Archivio Excel troppo grande dopo la decompressione.');
    return /^(?:xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)|\[Content_Types\]\.xml)$/.test(entry.name);
  } });
  const workbook = getXml(entries, 'xl/workbook.xml');
  const rels = new Map(elements(getXml(entries, 'xl/_rels/workbook.xml.rels'), 'Relationship').map(record => [record.attrs.Id, record.attrs]));
  const sheets = elements(workbook, 'sheet').map((sheet, index) => {
    const rel = rels.get(sheet.attrs['r:id'] || Object.entries(sheet.attrs).find(([key]) => key.endsWith(':id'))?.[1]);
    if (!rel || rel.TargetMode === 'External') throw new Error('Riferimento foglio Excel esterno o assente.');
    return { index, name: sheet.attrs.name || `Foglio ${index + 1}`, path: normalizePath(rel.Target.startsWith('/') ? rel.Target.slice(1) : `xl/${rel.Target}`) };
  });
  const selected = sheets.find(sheet => sheet.index === options.sheet || sheet.name === options.sheet) || (options.sheet == null ? sheets[0] : null);
  if (!selected) throw new Error('Foglio Excel non trovato.');
  const shared = elements(getXml(entries, 'xl/sharedStrings.xml', true), 'si').map(item => elements(item.inner, 't').map(part => xmlText(part.inner)).join(''));
  const xml = getXml(entries, selected.path);
  if (elements(xml, 'f').length) throw new Error('Il foglio contiene formule: esporta i valori in CSV prima di importare.');
  const rows = elements(xml, 'row').map((row, index) => {
    const values = [];
    for (const cell of elements(row.inner, 'c')) {
      const column = columnIndex(cell.attrs.r || `A${index + 1}`);
      const raw = elements(cell.inner, 'v')[0]?.inner ?? '';
      if (cell.attrs.t === 's') {
        if (!/^\d+$/.test(raw) || shared[Number(raw)] === undefined) throw new Error('Stringa condivisa Excel non valida.');
        values[column] = shared[Number(raw)];
      } else if (cell.attrs.t === 'inlineStr') values[column] = elements(cell.inner, 't').map(part => xmlText(part.inner)).join('');
      else if (cell.attrs.t === 'e') throw new Error(`Errore Excel nella cella ${cell.attrs.r}.`);
      else values[column] = xmlText(raw);
    }
    return { rowNumber: Number(row.attrs.r || index + 1), values: Array.from({ length: values.length }, (_, i) => values[i] ?? '') };
  });
  if (rows.length > MAX_ROWS + 1) throw new Error(`Il foglio supera ${MAX_ROWS} righe.`);
  return { headers: rows.shift()?.values || [], rows, sheets: sheets.map(({ index, name }) => ({ index, name })), sheet: selected.name, date1904: /\bdate1904\s*=\s*["'](?:true|1)["']/.test(workbook) };
}

/** RFC4180-style CSV including quoted separators, escaped quotes and multiline notes. */
export function parseFinanceCsv(input, separator = 'auto') {
  const value = input.replace(/^\uFEFF/, '');
  if (separator === 'auto') {
    const candidates = [';', ',', '\t', '|'];
    const scores = candidates.map(candidate => {
      let quoted = false, columns = 1;
      for (let i = 0; i < value.length; i++) {
        if (value[i] === '"') { if (quoted && value[i + 1] === '"') i++; else quoted = !quoted; }
        else if (!quoted && (value[i] === '\n' || value[i] === '\r')) break;
        else if (!quoted && value[i] === candidate) columns++;
      }
      return { candidate, columns };
    }).sort((a, b) => b.columns - a.columns);
    separator = scores[0].candidate;
  }
  if (![';', ',', '\t', '|'].includes(separator)) throw new Error('Separatore CSV non supportato.');
  const rows = []; let row = [], cell = '', quoted = false, closedQuote = false, rowStart = 1, line = 1;
  function pushRow() {
    row.push(cell);
    if (row.length > MAX_COLUMNS) throw new Error('Troppe colonne CSV.');
    if (row.some(value => value !== '')) rows.push({ rowNumber: rowStart, values: row });
    row = []; cell = ''; closedQuote = false; rowStart = line + 1;
    if (rows.length > MAX_ROWS + 1) throw new Error(`Il CSV supera ${MAX_ROWS} righe.`);
  }
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quoted) {
      if (char === '"') { if (value[index + 1] === '"') { cell += '"'; index++; } else { quoted = false; closedQuote = true; } }
      else { cell += char; if (char === '\n') line++; }
    } else if (char === '"') {
      if (cell || closedQuote) throw new Error(`Virgolette CSV non valide alla riga ${line}.`);
      quoted = true;
    } else if (char === separator) { row.push(cell); cell = ''; closedQuote = false; if (row.length > MAX_COLUMNS) throw new Error('Troppe colonne CSV.'); }
    else if (char === '\n' || char === '\r') { if (char === '\r' && value[index + 1] === '\n') index++; pushRow(); line++; }
    else { if (closedQuote && char.trim()) throw new Error(`Testo dopo la chiusura delle virgolette alla riga ${line}.`); cell += char; }
  }
  if (quoted) throw new Error('Virgolette CSV non chiuse.');
  if (cell || row.length) pushRow();
  const headers = rows.shift()?.values || [];
  if (!headers.length) throw new Error('File CSV vuoto.');
  return { headers, rows, separator, sheets: [], sheet: null };
}

export function suggestFinanceMapping(columns, kind) {
  const names = columns.map(column => text(column.name).trim().toLowerCase());
  const find = (...values) => { const index = names.findIndex(name => values.includes(name)); return index < 0 ? null : index; };
  const moneyManager = names[0] === 'giorno' && names[1] === 'conto' && names[6] === 'guadagni/spese' && names[5] === 'eur';
  return {
    preset: moneyManager ? 'money-manager' : 'custom', date: find('giorno', 'data', 'date', 'data operazione'), account: find('conto', 'account', 'account name'),
    category: find('categoria', 'category'), subcategory: find('sotto-categoria', 'sottocategoria', 'subcategory'), notes: find('nota', 'note', 'notes'),
    amount: moneyManager ? 5 : find('importo', 'amount', 'eur'), type: find('guadagni/spese', 'tipo', 'type'), description: find('descrizione', 'description'), currency: find('valuta', 'currency'),
    destination: moneyManager ? 2 : find('conto destinazione', 'destinazione', 'toaccount', 'to_account'), externalId: find('id', 'id transazione', 'transaction id', 'reference'), balance: find('saldo', 'balance'),
    dateFormat: moneyManager && kind === 'xlsx' ? 'excel' : 'auto', decimal: moneyManager && kind === 'xlsx' ? '.' : 'auto',
    typeValues: { Spesa: 'expense', Guadagno: 'income', 'Trasferimento uscita': 'transfer', Uscita: 'expense', Entrata: 'income', Trasferimento: 'transfer', Rimborso: 'refund', Rettifica: 'adjustment', expense: 'expense', income: 'income', transfer: 'transfer', refund: 'refund', adjustment: 'adjustment' },
    accountAliases: {}, categoryAliases: {},
  };
}

export async function parseFinanceFile(file, options = {}) {
  let bytes;
  if (file instanceof Uint8Array) bytes = file;
  else if (file instanceof ArrayBuffer) bytes = new Uint8Array(file);
  else if (typeof file?.arrayBuffer === 'function') bytes = new Uint8Array(await file.arrayBuffer());
  else throw new Error('Seleziona un file CSV, XLSX o JSON.');
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error('File vuoto o superiore a 40 MB.');
  const meta = { name: file.name || options.name || 'Importazione', size: bytes.length, lastModified: file.lastModified || null, fileHash: await financeHash(bytes) };
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const parsed = parseXlsx(bytes, options);
    const columns = makeColumns(parsed.headers);
    return { ...meta, ...parsed, kind: 'xlsx', columns, suggestedMapping: suggestFinanceMapping(columns, 'xlsx'), options: { ...options, encoding: 'utf-8' } };
  }
  let decoded;
  try { decoded = new TextDecoder(options.encoding || 'utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
  catch { throw new Error('Codifica non valida. Se il file è CSV, prova Windows-1252.'); }
  if (/^\s*[{[]/.test(decoded)) {
    let data;
    try { data = JSON.parse(decoded); } catch { throw new Error('File JSON non valido.'); }
    if (data.app === 'MyBusinessEmpire' && data.dataType === 'full-backup' && data.schemaVersion === 1) {
      return { ...meta, kind: 'my-empire', data: data.data, originalMetadata: { app: data.app, dataType: data.dataType, schemaVersion: data.schemaVersion, exportedAt: data.exportedAt }, columns: [], rows: [], sheets: [], suggestedMapping: {}, options };
    }
    if (data.finance || (data.accounts && data.transactions && data.schemaVersion)) return { ...meta, kind: 'empire-finance', data: data.finance || data, columns: [], rows: [], sheets: [], suggestedMapping: {}, options };
    throw new Error('Formato JSON non riconosciuto: scegli un backup Finanze Empire OS o MyBusinessEmpire v1.');
  }
  if (/^\s*</.test(decoded) || bytes[0] === 0xd0) throw new Error('Formato non supportato. Esporta il file come CSV o XLSX.');
  const parsed = parseFinanceCsv(decoded, options.separator || 'auto');
  const columns = makeColumns(parsed.headers);
  if (parsed.headers[0] === 'empireFinanceCsv' && parsed.headers.includes('collection') && parsed.headers.includes('record')) {
    const data = emptyFinance(), collectionIndex = parsed.headers.indexOf('collection'), recordIndex = parsed.headers.indexOf('record');
    for (const row of parsed.rows) {
      const collection = row.values[collectionIndex];
      if (row.values[0] !== '1' || !FINANCE_COLLECTIONS.includes(collection) || ['auditEvents', 'importBatches', 'importRows'].includes(collection)) throw new Error(`CSV Empire OS non valido alla riga ${row.rowNumber}.`);
      let record; try { record = JSON.parse(row.values[recordIndex]); } catch { throw new Error(`Record CSV non valido alla riga ${row.rowNumber}.`); }
      if (!record || Array.isArray(record) || typeof record !== 'object') throw new Error(`Record CSV non valido alla riga ${row.rowNumber}.`);
      data[collection].push(record);
    }
    return { ...meta, ...parsed, kind: 'empire-finance', partial: true, data, columns, suggestedMapping: {}, options };
  }
  return { ...meta, ...parsed, kind: 'csv', columns, suggestedMapping: suggestFinanceMapping(columns, 'csv'), options: { ...options, encoding: options.encoding || 'utf-8', separator: parsed.separator } };
}

function makeColumns(headers) {
  const counts = new Map();
  return headers.map((name, index) => {
    name = text(name); const count = (counts.get(name) || 0) + 1; counts.set(name, count);
    return { index, name, displayName: `${index + 1}. ${name || '(senza nome)'}${count > 1 ? ` (${count})` : ''}` };
  });
}

export function parseImportDate(value, format = 'auto', { date1904 = false } = {}) {
  const input = text(value).trim();
  if (!input) throw new Error('Data assente.');
  if (format === 'excel') {
    if (!/^\d+(?:\.\d+)?$/.test(input)) throw new Error('Data seriale Excel non valida.');
    const serial = Number(input);
    if (!Number.isFinite(serial) || serial < 1 || serial > 2958465 || (!date1904 && Math.floor(serial) === 60)) throw new Error('Data seriale Excel fuori intervallo.');
    const epoch = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : serial < 60 ? 31 : 30);
    const result = new Date(epoch + Math.floor(serial) * 86400000).toISOString().slice(0, 10);
    return result;
  }
  if (/^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(input)) {
    const day = input.slice(0, 10);
    if (new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day) throw new Error('Data non valida.');
    return day;
  }
  const parts = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(input);
  if (!parts) throw new Error('Formato data non riconosciuto.');
  let day, month;
  if (format === 'dd/mm/yyyy') { day = Number(parts[1]); month = Number(parts[2]); }
  else if (format === 'mm/dd/yyyy') { month = Number(parts[1]); day = Number(parts[2]); }
  else if (format === 'auto') {
    if (Number(parts[1]) <= 12 && Number(parts[2]) <= 12 && parts[1] !== parts[2]) throw new Error('Data ambigua: scegli giorno/mese o mese/giorno.');
    if (Number(parts[1]) > 12) { day = Number(parts[1]); month = Number(parts[2]); }
    else { month = Number(parts[1]); day = Number(parts[2]); }
  } else throw new Error('Formato data non coerente con il valore.');
  const result = `${parts[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (month < 1 || month > 12 || day < 1 || day > 31 || new Date(`${result}T12:00:00Z`).toISOString().slice(0, 10) !== result) throw new Error('Data non valida.');
  return result;
}

export function parseImportCents(value, decimal = 'auto') {
  let input = text(value).trim().replace(/\u00a0/g, ' ').replace(/(?:EUR|€|USD|\$|GBP|£)/gi, '').trim();
  if (!input) throw new Error('Importo assente.');
  let negative = false;
  if (/^\(.*\)$/.test(input)) { negative = true; input = input.slice(1, -1); }
  if (input.startsWith('-')) { negative = !negative; input = input.slice(1); }
  if (input.startsWith('+')) input = input.slice(1);
  if (/[^\d., '\u2019]/.test(input)) throw new Error('Importo non numerico.');
  if (decimal === 'auto') {
    if (input.includes('.') && input.includes(',')) decimal = input.lastIndexOf('.') > input.lastIndexOf(',') ? '.' : ',';
    else {
      const separator = input.includes(',') ? ',' : input.includes('.') ? '.' : null;
      if (separator && input.slice(input.lastIndexOf(separator) + 1).length === 3) throw new Error('Importo ambiguo: scegli il separatore decimale.');
      decimal = separator || '.';
    }
  }
  if (![',', '.'].includes(decimal)) throw new Error('Separatore decimale non valido.');
  const grouping = decimal === '.' ? ',' : '.';
  input = input.replace(/[ '\u2019]/g, '');
  const parts = input.split(decimal);
  if (parts.length > 2 || (parts[1] && !/^\d{1,2}$/.test(parts[1]))) throw new Error('Importo con più di due decimali.');
  if (parts[0].includes(grouping) && !new RegExp(`^\\d{1,3}(?:\\${grouping}\\d{3})+$`).test(parts[0])) throw new Error('Raggruppamento delle migliaia non valido.');
  const integer = parts[0].split(grouping).join('');
  if (!/^\d+$/.test(integer)) throw new Error('Importo non valido.');
  const cents = Number(integer) * 100 + Number((parts[1] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('Importo fuori intervallo.');
  return negative ? -cents : cents;
}

function todayRome() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function sourceCell(row, mapping, key) { const index = mapping[key]; return Number.isInteger(Number(index)) && index !== null && index !== '' ? row.values[Number(index)] ?? '' : ''; }
function recordCommon(batchId, now) { return { ownerId: 'local', importBatchId: batchId, createdAt: now, updatedAt: now }; }

export async function prepareFinanceImport(source, finance = emptyFinance(), selectedMapping = source.suggestedMapping, options = {}) {
  const original = validateFinance(copy(finance));
  const priorSessions = (original.importBatches || []).filter(batch => batch.fileHash === source.fileHash).length;
  const batchId = `import_${source.fileHash.slice(0, 24)}_${priorSessions + 1}`;
  const repeated = (original.importBatches || []).some(batch => batch.fileHash === source.fileHash && batch.status !== 'undone');
  const base = { batchId, total: source.rows?.length || 0, valid: 0, errors: [], warnings: [], duplicates: 0, transfers: 0, accounts: [], categories: [], preview: [], requiresReview: false, state: original };
  if (repeated) return { ...base, duplicates: source.rows?.length || source.data?.orders?.length || 0, warnings: [{ code: 'already-imported', message: 'Questo file è già stato importato. Nessun nuovo record.' }], report: { alreadyImported: true } };
  const now = new Date().toISOString();
  let payload, result = base;
  if (source.kind === 'my-empire') {
    const migrated = migrateLegacyBusiness(source.data, { batchId, now, idPrefix: `myempire_${source.fileHash.slice(0, 12)}` });
    payload = migrated.payload;
    const businessAliases = new Map(payload.businesses.map(record => [record.id, original.businesses.find(existing => existing.source === record.source && existing.sourceId && existing.sourceId === record.sourceId)?.id || record.id]));
    for (const collection of ['orders', 'businessCosts']) payload[collection] = payload[collection].map(record => ({ ...record, businessId: businessAliases.get(record.businessId) || record.businessId }));
    let duplicates = 0;
    for (const collection of ['businesses', 'orders', 'businessCosts']) payload[collection] = payload[collection].filter(record => {
      const exists = original[collection].some(existing => existing.id === record.id || record.sourceId && existing.source === record.source && existing.sourceId === record.sourceId);
      if (exists) { if (collection !== 'businesses') duplicates++; return false; } return true;
    });
    result = { ...base, total: migrated.counts.orders, valid: payload.orders.length + payload.businessCosts.length, duplicates, errors: migrated.errors, warnings: migrated.warnings, preview: payload.orders, report: { ...migrated.counts, excludedImages: migrated.excludedAssets.length, historicalOnly: true } };
  } else if (source.kind === 'empire-finance') {
    const incoming = source.partial ? copy(source.data) : validateFinance(copy(source.data));
    const collections = ['accounts', 'categories', 'transactions', 'recurringRules', 'balanceSnapshots', 'budgets', 'assets', 'assetValuations', 'holdings', 'liabilities', 'receivables', 'goals', 'goalAllocations', 'businesses', 'orders', 'businessCosts', 'platformBalances', 'payouts', 'importRows'];
    payload = Object.fromEntries(collections.map(collection => [collection, (incoming[collection] || []).filter(record => !(original[collection] || []).some(existing => existing.id === record.id)).map(record => ({ ...record, importedFromBatchId: record.importBatchId || null, importBatchId: batchId }))]));
    const conflicts = collections.flatMap(collection => (incoming[collection] || []).filter(record => (original[collection] || []).some(existing => existing.id === record.id && JSON.stringify(existing) !== JSON.stringify(record))).map(record => ({ collection, id: record.id })));
    result = { ...base, total: collections.reduce((sum, collection) => sum + (incoming[collection] || []).length, 0), valid: collections.reduce((sum, collection) => sum + payload[collection].length, 0), warnings: conflicts.length ? [{ code: 'backup-conflicts', count: conflicts.length, message: `${conflicts.length} record esistenti non sovrascritti.` }] : [], preview: payload.transactions, report: { conflicts, backup: true } };
  } else {
    const normalized = await normalizeRows(source, original, selectedMapping, { ...options, batchId, now });
    payload = normalized.payload;
    result = { ...base, ...normalized.result };
  }
  const snapshot = copy(original);
  for (const prior of snapshot.importBatches) delete prior.preImportSnapshot;
  const batch = { id: batchId, fileHash: source.fileHash, fileName: source.name, size: source.size, sourceKind: source.kind, sheet: source.sheet || null, status: 'imported', createdAt: now, importedAt: now, mapping: selectedMapping || {}, options, originalColumns: source.columns || [], sourceMetadata: source.originalMetadata || {}, total: result.total, valid: result.valid, duplicates: result.duplicates, errorCount: result.errors.length, createdRefs: {}, report: result.report, preImportSnapshot: snapshot };
  // The caller persists this whole result once, only after explicit confirmation.
  const next = applyFinance(original, { type: 'import_batch', args: { payload, batch } });
  const savedBatch = next.importBatches.find(record => record.id === batchId);
  for (const [collection, records] of Object.entries(payload)) savedBatch.createdRefs[collection] = await Promise.all(records.filter(record => !(original[collection] || []).some(existing => existing.id === record.id)).map(async record => {
    const saved = next[collection].find(existing => existing.id === record.id);
    return { id: record.id, fingerprint: saved ? await financeHash(JSON.stringify(saved)) : null };
  }));
  result.state = next;
  result.report = { ...result.report, fileName: source.name, fileHash: source.fileHash, total: result.total, valid: result.valid, duplicates: result.duplicates, errors: result.errors, warnings: result.warnings, transfers: result.transfers };
  savedBatch.report = copy(result.report);
  return result;
}

async function normalizeRows(source, original, mapping, options) {
  if (!mapping || !['date', 'account', 'amount', 'type'].every(key => Number.isInteger(Number(mapping[key])) && mapping[key] != null && mapping[key] !== '')) throw new Error('Mappa data, conto, importo e tipo prima di continuare.');
  const { batchId, now } = options;
  const payload = { accounts: [], categories: [], transactions: [], importRows: [] };
  const result = { valid: 0, errors: [], warnings: [], duplicates: 0, transfers: 0, accounts: payload.accounts, categories: payload.categories, preview: payload.transactions, requiresReview: false, report: { balances: [], potentialDuplicates: [], adjustmentRows: [], sourceAccounts: [], sourceCategories: [] } };
  const accountMap = new Map(), categoryMap = new Map(), dayCandidates = new Map();
  const existingFingerprints = new Map((original.transactions || []).filter(tx => tx.sourceFingerprint).map(tx => [tx.sourceFingerprint, tx]));
  const existingExternal = new Map((original.transactions || []).filter(tx => tx.sourceId).map(tx => [`${tx.source}:${tx.sourceId}`, tx]));
  const accountsWithObservedBalance = new Map();
  async function account(name, currency) {
    if (!text(name).trim()) throw new Error('Conto assente.');
    const key = `${text(name)}\u0000${currency}`;
    if (accountMap.has(key)) return accountMap.get(key);
    const alias = mapping.accountAliases?.[name];
    const requestedId = typeof alias === 'object' ? alias.id : alias;
    const existing = requestedId ? original.accounts.find(record => record.id === requestedId) : original.accounts.find(record => record.name === name && record.currency === currency);
    if (requestedId && !existing) throw new Error(`Mappatura conto non valida: ${name}.`);
    if (existing && existing.currency !== currency) throw new Error('Valuta del conto mappato diversa dalla riga.');
    const record = existing || { ...recordCommon(batchId, now), id: `import_account_${(await financeHash(key)).slice(0, 24)}`, name: text(name), type: 'current', currency, openingCents: null, openingDate: null, includeInLiquidity: true, active: true, ownershipBps: 10000, source: source.kind === 'xlsx' && mapping.preset === 'money-manager' ? 'money-manager' : 'file-import', sourceName: text(name) };
    if (!existing && !payload.accounts.some(item => item.id === record.id)) payload.accounts.push(record);
    accountMap.set(key, record.id); result.report.sourceAccounts.push({ original: name, accountId: record.id, created: !existing, openingBalance: existing?.openingCents ?? null });
    return record.id;
  }
  async function category(name, parentId = null) {
    if (!text(name).trim()) return null;
    const key = `${parentId || ''}\u0000${name}`;
    if (categoryMap.has(key)) return categoryMap.get(key);
    const alias = mapping.categoryAliases?.[key] || mapping.categoryAliases?.[name];
    const requestedId = typeof alias === 'object' ? alias.id : alias;
    const existing = requestedId ? original.categories.find(record => record.id === requestedId) : original.categories.find(record => record.name === name && (record.parentId || null) === parentId);
    if (requestedId && !existing) throw new Error(`Mappatura categoria non valida: ${name}.`);
    const record = existing || { ...recordCommon(batchId, now), id: `import_category_${(await financeHash(key)).slice(0, 24)}`, name: text(name), parentId, type: 'mixed', source: 'file-import' };
    if (!existing && !payload.categories.some(item => item.id === record.id)) payload.categories.push(record);
    categoryMap.set(key, record.id); result.report.sourceCategories.push({ original: name, categoryId: record.id, created: !existing });
    return record.id;
  }
  for (const row of source.rows) {
    const rawRecord = { id: `${batchId}_row_${row.rowNumber}`, importBatchId: batchId, rowNumber: row.rowNumber, fileHash: source.fileHash, sheet: source.sheet || null, originalColumns: source.columns.map(column => column.name), raw: copy(row.values), status: 'valid' };
    try {
      if (row.values.length > source.columns.length) throw new Error('Numero di colonne superiore alle intestazioni.');
      const dateFormat = options.dateFormat || mapping.dateFormat || 'auto';
      const date = parseImportDate(sourceCell(row, mapping, 'date'), dateFormat, source);
      const currency = text(sourceCell(row, mapping, 'currency') || options.currency || 'EUR').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Valuta assente o non valida.');
      let amountCents = parseImportCents(sourceCell(row, mapping, 'amount'), options.decimal || mapping.decimal || 'auto');
      if (amountCents === 0) throw new Error('Importo nullo: nessun movimento importato.');
      const rawType = text(sourceCell(row, mapping, 'type')).trim();
      let type = mapping.typeValues?.[rawType] || (['income', 'expense', 'transfer', 'refund', 'adjustment'].includes(rawType) ? rawType : null);
      if (!type) throw new Error(`Tipo da mappare: ${rawType || '(vuoto)'}.`);
      if (type === 'refund' && !sourceCell(row, mapping, 'linkedTransactionId')) throw new Error('Rimborso da collegare alla spesa originale: mappa il riferimento prima di importare.');
      if (amountCents < 0 && type !== 'adjustment') throw new Error('Importo negativo: scegli esplicitamente il tipo o correggi la riga.');
      let status = 'posted';
      const categoryName = text(sourceCell(row, mapping, 'category'));
      if (categoryName.trim().toLowerCase() === 'modifica saldo' && ['income', 'expense'].includes(type)) {
        result.report.adjustmentRows.push(row.rowNumber);
        if ((options.adjustments || 'review') === 'review') { type = 'adjustment'; status = 'draft'; result.requiresReview = true; }
        else if (options.adjustments === 'convert') { amountCents *= type === 'expense' ? -1 : 1; type = 'adjustment'; }
        if (status === 'draft' && rawType.toLowerCase().includes('spesa')) amountCents = -Math.abs(amountCents);
      }
      const accountId = await account(sourceCell(row, mapping, 'account'), currency);
      const toAccountId = type === 'transfer' ? await account(sourceCell(row, mapping, 'destination'), currency) : null;
      if (type === 'transfer' && accountId === toAccountId) throw new Error('Trasferimento sullo stesso conto.');
      const categoryId = type === 'transfer' ? null : await category(categoryName);
      const subcategoryName = sourceCell(row, mapping, 'subcategory');
      const subcategoryId = type === 'transfer' ? null : await category(subcategoryName, categoryId);
      const sourceId = text(sourceCell(row, mapping, 'externalId')).trim();
      const sourceKind = mapping.preset === 'money-manager' ? 'money-manager' : 'file-import';
      const normalizedFingerprint = await financeHash(JSON.stringify({ source: sourceKind, date: sourceCell(row, mapping, 'date'), accountId, toAccountId, categoryName, subcategoryName, amountCents, currency, type, notes: sourceCell(row, mapping, 'notes'), description: sourceCell(row, mapping, 'description') }));
      if (sourceId && existingExternal.has(`${sourceKind}:${sourceId}`)) { result.duplicates++; rawRecord.status = 'duplicate'; payload.importRows.push(rawRecord); continue; }
      if (existingFingerprints.has(normalizedFingerprint)) {
        result.report.potentialDuplicates.push({ row: row.rowNumber, transactionId: existingFingerprints.get(normalizedFingerprint).id });
        if (options.duplicatePolicy !== 'keep') { result.duplicates++; rawRecord.status = 'potential-duplicate'; payload.importRows.push(rawRecord); continue; }
      }
      const sourceRowHash = await financeHash(JSON.stringify(row.values));
      const tx = { ...recordCommon(batchId, now), id: `import_tx_${source.fileHash.slice(0, 16)}_${source.sheet ? source.sheets.find(sheet => sheet.name === source.sheet)?.index || 0 : 0}_${row.rowNumber}`, date, type, amountCents, currency, accountId, toAccountId, categoryId, subcategoryId, description: text(sourceCell(row, mapping, 'description')), notes: text(sourceCell(row, mapping, 'notes')), status, source: sourceKind, sourceId: sourceId || null, sourceFingerprint: normalizedFingerprint, sourceRowHash, sourceData: { fileHash: source.fileHash, rowNumber: row.rowNumber, sheet: source.sheet || null, sourceDate: sourceCell(row, mapping, 'date'), originalType: rawType, originalCategory: categoryName, originalSubcategory: subcategoryName } };
      if (type === 'refund') tx.linkedTransactionId = text(sourceCell(row, mapping, 'linkedTransactionId'));
      // Warn about same-day similarities without deleting legitimate repeated payments.
      const dayKey = JSON.stringify({ date, accountId, toAccountId, categoryName, subcategoryName, amountCents, type, notes: tx.notes });
      if (dayCandidates.has(dayKey)) result.warnings.push({ row: row.rowNumber, code: 'similar-row', relatedRow: dayCandidates.get(dayKey), message: 'Movimento simile nello stesso giorno: importato separatamente, verifica che sia distinto.' });
      else dayCandidates.set(dayKey, row.rowNumber);
      if (date > (options.today || todayRome())) result.warnings.push({ row: row.rowNumber, code: 'future-date', message: 'Data futura conservata: verifica prima della conferma.' });
      if (mapping.preset === 'money-manager') {
        for (const amountColumn of [8, 10]) if (row.values[amountColumn] !== '' && parseImportCents(row.values[amountColumn], '.') !== Math.abs(amountCents)) throw new Error('Le colonne importo originali non coincidono.');
      }
      if (mapping.balance != null && sourceCell(row, mapping, 'balance') !== '') accountsWithObservedBalance.set(accountId, { date, observedCents: parseImportCents(sourceCell(row, mapping, 'balance'), options.decimal || mapping.decimal || 'auto'), row: row.rowNumber });
      rawRecord.transactionId = tx.id; rawRecord.sourceRowHash = sourceRowHash; rawRecord.sourceFingerprint = normalizedFingerprint; rawRecord.status = status === 'draft' ? 'review' : 'valid';
      payload.transactions.push(tx); payload.importRows.push(rawRecord); result.valid++; if (type === 'transfer') result.transfers++;
    } catch (error) {
      result.errors.push({ row: row.rowNumber, code: 'invalid-row', message: error.message }); rawRecord.status = 'error'; rawRecord.error = error.message; payload.importRows.push(rawRecord);
    }
  }
  // Do not create accounts/categories used only by rejected or duplicate rows.
  const accountIds = new Set(payload.transactions.flatMap(tx => [tx.accountId, tx.toAccountId]).filter(Boolean));
  payload.accounts = payload.accounts.filter(record => accountIds.has(record.id)); result.accounts = payload.accounts;
  const categoryIds = new Set(payload.transactions.flatMap(tx => [tx.categoryId, tx.subcategoryId]).filter(Boolean));
  payload.categories = payload.categories.filter(record => categoryIds.has(record.id)); result.categories = payload.categories;
  if (payload.accounts.length) result.warnings.push({ code: 'unknown-opening-balances', count: payload.accounts.length, message: `${payload.accounts.length} conti senza saldo iniziale. I saldi assoluti resteranno non disponibili fino alla riconciliazione.` });
  if (result.report.adjustmentRows.length) result.warnings.push({ code: 'adjustment-review', count: result.report.adjustmentRows.length, message: options.adjustments === 'original' ? 'Rettifiche mantenute nella classificazione originale su tua scelta.' : `${result.report.adjustmentRows.length} rettifiche di saldo ${options.adjustments === 'convert' ? 'convertite' : 'in bozza, escluse dai saldi finché non confermate'}.` });
  if (result.report.potentialDuplicates.length) result.warnings.push({ code: 'potential-duplicates', count: result.report.potentialDuplicates.length, message: options.duplicatePolicy === 'keep' ? 'Duplicati potenziali mantenuti su tua scelta.' : 'Duplicati potenziali esclusi dall’importazione. Puoi scegliere di mantenerli.' });
  const combined = { ...original, accounts: [...original.accounts, ...payload.accounts], transactions: [...original.transactions, ...payload.transactions] };
  for (const [accountId, observed] of accountsWithObservedBalance) {
    const balance = accountBalance(combined, accountId, observed.date);
    const expectedCents = typeof balance === 'number' ? balance : balance?.balanceCents ?? balance?.cents ?? null;
    result.report.balances.push({ accountId, ...observed, expectedCents, differenceCents: expectedCents === null ? null : observed.observedCents - expectedCents });
  }
  if (!accountsWithObservedBalance.size) result.report.reconciliation = 'Saldo finale non presente nel file; quadratura assoluta non disponibile.';
  return { payload, result };
}

/** Remove only records introduced by this batch; never restore over later edits. */
export async function undoFinanceImport(finance, batchId) {
  const next = validateFinance(copy(finance));
  const batch = next.importBatches.find(record => record.id === batchId);
  if (!batch || batch.status === 'undone') throw new Error('Importazione assente o già annullata.');
  const removed = [], retained = [], removable = new Map();
  const collectionOrder = ['transactions', 'orders', 'businessCosts', 'payouts', 'goalAllocations', 'assetValuations', 'balanceSnapshots', 'recurringRules', 'budgets', 'assets', 'holdings', 'liabilities', 'receivables', 'goals', 'businesses', 'categories', 'accounts', 'importRows'];
  for (const collection of collectionOrder) {
    const created = new Map((batch.createdRefs?.[collection] || []).map(record => [record.id, record.fingerprint]));
    if (!created.size || !Array.isArray(next[collection])) continue;
    for (const record of next[collection]) {
      if (!created.has(record.id) || record.importBatchId !== batchId) continue;
      if (created.get(record.id) && await financeHash(JSON.stringify(record)) === created.get(record.id)) removable.set(`${collection}:${record.id}`, { collection, id: record.id });
      else retained.push({ collection, id: record.id, reason: 'modified' });
    }
  }
  // Keep dependencies of edited/new records, including category parents and default account.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, candidate] of removable) {
      const referenced = next.settings.defaultAccountId === candidate.id || Object.entries(next).some(([collection, records]) => !['importBatches', 'auditEvents', 'importRows'].includes(collection) && Array.isArray(records) && records.some(record => !removable.has(`${collection}:${record.id}`) && JSON.stringify(record).includes(`"${candidate.id}"`)));
      if (referenced) { removable.delete(key); retained.push({ ...candidate, reason: 'referenced' }); changed = true; }
    }
  }
  for (const collection of collectionOrder) if (Array.isArray(next[collection])) next[collection] = next[collection].filter(record => {
    if (!removable.has(`${collection}:${record.id}`)) return true;
    removed.push({ collection, id: record.id }); return false;
  });
  batch.status = 'undone'; batch.undoneAt = new Date().toISOString(); batch.undoReport = { removed, retained };
  next.auditEvents.push({ id: `undo_${batchId}_${Date.now()}`, type: 'import_undone', date: new Date().toISOString(), importBatchId: batchId, removedCount: removed.length, retainedCount: retained.length });
  return validateFinance(next);
}

export function financeImportErrorCsv(preview) {
  const cell = value => `"${text(value).replaceAll('"', '""').replace(/^[=+@-]/, "'$&")}"`;
  return ['Riga;Codice;Errore', ...preview.errors.map(error => [error.row, error.code, error.message].map(cell).join(';'))].join('\r\n');
}
