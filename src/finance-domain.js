/** Deterministic local accounting. Money is always expressed in integer minor units. */
export const FINANCE_COLLECTIONS = Object.freeze(['accounts', 'transactions', 'categories', 'recurringRules', 'balanceSnapshots', 'budgets', 'assets', 'assetValuations', 'holdings', 'liabilities', 'receivables', 'goals', 'goalAllocations', 'businesses', 'orders', 'businessCosts', 'platformBalances', 'payouts', 'importBatches', 'importRows', 'auditEvents']);
export const ACCOUNT_TYPES = Object.freeze(['current', 'savings', 'cash', 'prepaid', 'digital', 'business', 'crypto', 'investment', 'credit', 'debit', 'aggregate']);
export const TRANSACTION_TYPES = Object.freeze(['income', 'expense', 'transfer', 'refund', 'adjustment', 'credit_issued', 'credit_received', 'credit_repaid', 'receivable_collection']);
const copy = value => structuredClone(value);
const uid = () => globalThis.crypto.randomUUID();
const fail = message => { throw new Error(message); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const asText = (value, label, max = 1000, required = false) => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`${label}: testo ${required ? 'non vuoto ' : ''}richiesto.`);
  return required ? value.trim() : value;
};
const asId = (value, label = 'Identificativo') => asText(value, label, 180, true);
const asCents = (value, label = 'Importo', { nullable = false, signed = false, zero = true } = {}) => {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (!Number.isSafeInteger(value) || (!signed && value < 0) || (!zero && value === 0)) fail(`${label}: servono centesimi interi validi${signed ? '' : ' non negativi'}.`);
  return value;
};
const sum = values => values.reduce((total, value) => { const next = total + value; if (!Number.isSafeInteger(next)) fail('Totale oltre la precisione monetaria consentita.'); return next; }, 0);
const currency = value => { if (!/^[A-Z]{3}$/.test(value || '')) fail('Valuta: codice ISO di tre lettere richiesto.'); return value; };
export function financeDay(value = new Date()) { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)); }
export function validFinanceDay(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const d = new Date(`${value}T12:00:00Z`); return Number.isFinite(+d) && d.toISOString().slice(0, 10) === value; }
const day = (value, label = 'Data', nullable = false) => { if (nullable && !value) return null; if (!validFinanceDay(value)) fail(`${label}: usa una data valida YYYY-MM-DD.`); return value; };
const oneOf = (value, values, label) => { if (!values.includes(value)) fail(`${label}: valore non supportato.`); return value; };
const bool = (value, fallback, label) => { if (value === undefined) return fallback; if (typeof value !== 'boolean') fail(`${label}: valore vero/falso richiesto.`); return value; };
const owned = (amount, record) => { const n = BigInt(amount) * BigInt(record.ownershipBps ?? 10000); return Number((n + (n < 0n ? -5000n : 5000n)) / 10000n); };
function common(record) {
  if (!plain(record)) fail('Record finanziario non valido.');
  const result = copy(record);
  result.id = asId(record.id); result.ownerId = asId(record.ownerId ?? 'local', 'Proprietario');
  result.createdAt = record.createdAt ?? new Date().toISOString(); result.updatedAt = record.updatedAt ?? result.createdAt;
  for (const key of ['createdAt', 'updatedAt']) if (typeof result[key] !== 'string' || !Number.isFinite(Date.parse(result[key]))) fail(`${key}: timestamp non valido.`);
  result.source = asText(record.source ?? 'manual', 'Origine', 200, true);
  if (record.sourceId !== undefined && record.sourceId !== null) asText(record.sourceId, 'Riferimento sorgente', 1000, true);
  if (record.importBatchId) asId(record.importBatchId, 'Sessione importazione');
  return result;
}
export function emptyFinance() {
  return { schemaVersion: 1, ...Object.fromEntries(FINANCE_COLLECTIONS.map(key => [key, []])), settings: { currency: 'EUR', ownerId: 'local', defaultAccountId: null }, operationIds: [] };
}
/** Exact decimal parsing: accepts Italian grouping/decimal notation or ungrouped dot decimals. */
export function moneyToCents(input) {
  let value = String(input ?? '').trim().replace(/\s|\u00a0/g, '').replace(/(?:EUR|€)/gi, '');
  if (!value || !/^[+-]?[\d.,]+$/.test(value)) fail('Importo non valido. Usa al massimo due decimali.');
  const sign = value.startsWith('-') ? -1n : 1n; value = value.replace(/^[+-]/, '');
  if (value.includes(',')) {
    if (!/^\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$/.test(value) && !/^\d+(?:,\d{1,2})?$/.test(value)) fail('Importo italiano non valido.');
    value = value.replaceAll('.', '').replace(',', '.');
  } else if (!/^\d+(?:\.\d{1,2})?$/.test(value)) fail('Importo non valido. Usa al massimo due decimali; per le migliaia usa 1.000,00.');
  const [whole, fraction = ''] = value.split('.'); const amount = sign * (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER) || amount < BigInt(Number.MIN_SAFE_INTEGER)) fail('Importo troppo grande.');
  return Number(amount);
}

function normalizeRecord(collection, raw) {
  const r = common(raw);
  if (['accounts', 'assets', 'holdings', 'liabilities', 'receivables', 'goals', 'businesses', 'categories', 'recurringRules'].includes(collection)) r.name = asText(r.name ?? r.title, 'Nome', 500, true);
  if (!['categories', 'businesses', 'importBatches', 'importRows', 'auditEvents'].includes(collection)) r.currency = currency(r.currency ?? 'EUR');
  if (['accounts', 'assets', 'holdings', 'liabilities', 'receivables'].includes(collection)) {
    r.ownershipBps = r.ownershipBps ?? 10000;
    if (!Number.isInteger(r.ownershipBps) || r.ownershipBps < 0 || r.ownershipBps > 10000) fail('Quota di proprietà: valore tra 0 e 10000 richiesto.');
  }
  switch (collection) {
    case 'accounts':
      r.type = oneOf(r.type ?? 'current', ACCOUNT_TYPES, 'Tipo conto'); r.active = bool(r.active, true, 'Conto attivo');
      r.openingCents = asCents(r.openingCents, 'Saldo iniziale', { nullable: true, signed: true }); r.openingDate = day(r.openingDate, 'Data saldo iniziale', true);
      if ((r.openingCents === null) !== (r.openingDate === null)) fail('Saldo iniziale e relativa data vanno indicati insieme.');
      r.includeInLiquidity = bool(r.includeInLiquidity, !['crypto', 'investment', 'debit', 'aggregate'].includes(r.type), 'Inclusione liquidità');
      r.openingVerified = bool(r.openingVerified, false, 'Saldo iniziale verificato');
      if (['debit', 'aggregate'].includes(r.type) && r.includeInLiquidity) fail('Carte di debito e prospetti aggregati non costituiscono liquidità separata.');
      break;
    case 'categories': r.type = oneOf(r.type ?? 'mixed', ['income', 'expense', 'mixed'], 'Tipo categoria'); r.parentId = r.parentId || null; break;
    case 'transactions': {
      r.type = oneOf(r.type, TRANSACTION_TYPES, 'Tipo movimento'); r.date = day(r.date); r.valueDate = day(r.valueDate, 'Data valuta', true);
      r.amountCents = asCents(r.amountCents, 'Importo movimento', { signed: r.type === 'adjustment', zero: r.type === 'adjustment' });
      r.accountId = asId(r.accountId, 'Conto'); r.toAccountId = r.toAccountId || null; r.categoryId = r.categoryId || null;
      r.status = oneOf(r.status ?? 'posted', ['posted', 'scheduled', 'draft'], 'Stato movimento');
      if (r.type === 'transfer' && (!r.toAccountId || r.accountId === r.toAccountId)) fail('Un trasferimento richiede due conti diversi.');
      if (r.type !== 'transfer' && r.toAccountId) fail('Il conto di destinazione è previsto soltanto per i trasferimenti.');
      if (r.type === 'refund' && !r.linkedTransactionId) fail('Collega il rimborso alla spesa originale.');
      r.description = asText(r.description ?? '', 'Descrizione', 5000); r.notes = asText(r.notes ?? '', 'Note', 10000);
      if (!Array.isArray(r.tags ?? [])) fail('Tag non validi.'); r.tags = r.tags ?? [];
      r.splits = r.splits ?? [];
      if (!Array.isArray(r.splits)) fail('Ripartizione non valida.');
      r.splits = r.splits.map(s => ({ ...s, categoryId: asId(s.categoryId, 'Categoria ripartizione'), amountCents: asCents(s.amountCents, 'Quota ripartizione') }));
      if (r.splits.length && (!['expense', 'income'].includes(r.type) || sum(r.splits.map(s => s.amountCents)) !== r.amountCents)) fail('Le quote devono coincidere esattamente con l’importo del movimento.');
      break;
    }
    case 'recurringRules':
      r.frequency = oneOf(r.frequency ?? 'monthly', ['daily', 'weekly', 'monthly', 'yearly'], 'Frequenza'); r.nextDate = day(r.nextDate, 'Prossima data'); r.active = bool(r.active, true, 'Ricorrenza attiva');
      r.template = normalizeRecord('transactions', { ...r.template, id: `${r.id}:template`, ownerId: r.ownerId, currency: r.currency, status: 'scheduled', date: r.nextDate });
      break;
    case 'balanceSnapshots': r.accountId = asId(r.accountId, 'Conto'); r.date = day(r.date); r.observedCents = asCents(r.observedCents, 'Saldo osservato', { signed: true }); r.verified = bool(r.verified, false, 'Saldo verificato'); if (r.includedTransactionIds !== undefined && (!Array.isArray(r.includedTransactionIds) || r.includedTransactionIds.some(id => typeof id !== 'string'))) fail('Riferimenti riconciliazione non validi.'); if (r.includedImpacts !== undefined && (!plain(r.includedImpacts) || Object.values(r.includedImpacts).some(value => !Number.isSafeInteger(value)))) fail('Impronte saldo non valide.'); break;
    case 'budgets': r.categoryId = r.categoryId || null; r.limitCents = asCents(r.limitCents, 'Budget'); r.start = day(r.start, 'Inizio budget'); r.end = day(r.end, 'Fine budget'); if (r.start > r.end) fail('Intervallo budget non valido.'); break;
    case 'assets': r.valueCents = asCents(r.valueCents, 'Stima bene', { nullable: true }); r.valuationDate = day(r.valuationDate, 'Data stima', true); r.status = oneOf(r.status ?? 'owned', ['owned', 'sold', 'archived'], 'Stato bene'); if (r.valueCents !== null && !r.valuationDate) fail('Indica la data della stima del bene.'); break;
    case 'assetValuations': r.assetId = asId(r.assetId, 'Bene'); r.date = day(r.date); r.valueCents = asCents(r.valueCents, 'Stima'); break;
    case 'holdings': r.valueCents = asCents(r.valueCents, 'Valore investimento', { nullable: true }); r.valuationDate = day(r.valuationDate, 'Data valutazione', true); r.costCents = asCents(r.costCents, 'Costo storico', { nullable: true }); if (r.valueCents !== null && !r.valuationDate) fail('Indica la data della valutazione.'); break;
    case 'liabilities': case 'receivables': r.amountCents = asCents(r.amountCents, 'Capitale residuo'); if (r.originalCents !== undefined) r.originalCents = asCents(r.originalCents, 'Capitale originale'); r.status = oneOf(r.status ?? 'open', ['open', 'settled', 'cancelled'], 'Stato credito/debito'); r.dueDate = day(r.dueDate, 'Scadenza', true); break;
    case 'goals': r.targetCents = asCents(r.targetCents, 'Obiettivo', { zero: false }); r.targetDate = day(r.targetDate, 'Data obiettivo', true); r.active = bool(r.active, true, 'Obiettivo attivo'); break;
    case 'goalAllocations': r.goalId = asId(r.goalId, 'Obiettivo'); r.accountId = asId(r.accountId, 'Conto allocazione'); r.amountCents = asCents(r.amountCents, 'Accantonamento'); r.date = day(r.date); break;
    case 'businesses': r.active = bool(r.active, true, 'Business attivo'); break;
    case 'orders':
      r.businessId = asId(r.businessId, 'Business'); r.date = day(r.date); r.status = oneOf(r.status ?? 'completed', ['completed', 'pending', 'cancelled'], 'Stato ordine');
      r.grossCents = asCents(r.grossCents, 'Ricavo lordo', { nullable: true }); r.discountCents = asCents(r.discountCents ?? 0, 'Sconto'); r.refundCents = asCents(r.refundCents ?? 0, 'Rimborso ordine');
      r.feesCents = asCents(r.feesCents, 'Commissioni', { nullable: true }); r.directCostCents = asCents(r.directCostCents, 'Costi diretti', { nullable: true });
      if (r.grossCents !== null && sum([r.discountCents, r.refundCents]) > r.grossCents) fail('Sconti e rimborsi superano il ricavo lordo.'); break;
    case 'businessCosts': r.businessId = asId(r.businessId, 'Business'); r.date = day(r.date); r.amountCents = asCents(r.amountCents, 'Costo business'); r.orderId = r.orderId || null; r.transactionId = r.transactionId || null; break;
    case 'platformBalances': r.businessId = asId(r.businessId, 'Business'); r.date = day(r.date); r.observedCents = asCents(r.observedCents, 'Saldo piattaforma', { signed: true }); r.verified = bool(r.verified, false, 'Saldo piattaforma verificato'); if (r.reservesCents !== undefined) r.reservesCents = asCents(r.reservesCents, 'Riserve piattaforma'); break;
    case 'payouts': r.businessId = asId(r.businessId, 'Business'); r.date = day(r.date); r.amountCents = asCents(r.amountCents, 'Payout', { zero: false }); r.status = oneOf(r.status ?? 'pending', ['pending', 'posted', 'cancelled'], 'Stato payout'); r.feesCents = asCents(r.feesCents, 'Commissione payout', { nullable: true }); break;
    case 'importBatches': r.status = oneOf(r.status ?? 'imported', ['imported', 'undone'], 'Stato importazione'); if (r.fileHash) asText(r.fileHash, 'Hash file', 200, true); break;
    case 'importRows': r.importBatchId = asId(r.importBatchId, 'Sessione importazione'); break;
    case 'auditEvents': break;
    default: fail('Collezione finanziaria sconosciuta.');
  }
  return r;
}

export function validateFinance(raw) {
  if (!plain(raw) || raw.schemaVersion !== 1) fail('Versione archivio Finanze non supportata.');
  const result = { ...emptyFinance(), ...copy(raw) };
  for (const collection of FINANCE_COLLECTIONS) {
    if (!Array.isArray(result[collection])) fail(`${collection}: elenco richiesto.`);
    result[collection] = result[collection].map(record => normalizeRecord(collection, record));
    if (new Set(result[collection].map(r => r.id)).size !== result[collection].length) fail(`${collection}: identificativi duplicati.`);
  }
  if (!plain(result.settings)) fail('Impostazioni finanziarie non valide.');
  if (result.settings.cashScenarios !== undefined) {
    if (!Array.isArray(result.settings.cashScenarios) || result.settings.cashScenarios.length > 30) fail('Conserva al massimo 30 prospetti.');
    for (const row of result.settings.cashScenarios) {
      asId(row.id); asText(row.name, 'Nome prospetto', 100, true); currency(row.currency); day(row.from);
      if (!Number.isInteger(row.months) || row.months < 1 || row.months > 24) fail('Orizzonte prospetto non valido.');
      for (const field of ['incomeCents','expenseCents','extraIncomeCents','extraExpenseCents']) asCents(row[field], 'Ipotesi prospetto');
      if (row.startingCents !== null) asCents(row.startingCents, 'Saldo prospetto', {signed:true});
      if (!Array.isArray(row.sourceIds) || row.sourceIds.some(id=>typeof id!=='string') || row.sourceIds.length > 300) fail('Fonti prospetto non valide.');
      if (!plain(row.basis)) fail('Periodo di riferimento prospetto non valido.'); day(row.basis.start); day(row.basis.end);
      if (row.basis.start > row.basis.end) fail('Periodo di riferimento prospetto non valido.');
    }
    if (new Set(result.settings.cashScenarios.map(r=>r.id)).size !== result.settings.cashScenarios.length) fail('Prospetti duplicati.');
  }
  if (result.settings.incomeSourceRules !== undefined) {
    if (!Array.isArray(result.settings.incomeSourceRules) || result.settings.incomeSourceRules.length > 300) fail('Collegamenti entrate non validi.');
    for (const rule of result.settings.incomeSourceRules) { asText(rule.key, 'Fonte entrata', 500, true); if (rule.businessId && !result.businesses.some(b => b.id === rule.businessId)) fail('Business della fonte non trovato.'); if (rule.label !== undefined) asText(rule.label, 'Nome fonte', 200); }
    if (new Set(result.settings.incomeSourceRules.map(r=>r.key)).size !== result.settings.incomeSourceRules.length) fail('Collegamenti entrate duplicati.');
  }
  if (result.settings.wealthHistory !== undefined) {
    if (!Array.isArray(result.settings.wealthHistory) || result.settings.wealthHistory.length > 1500) fail('Rilevazioni patrimonio non valide.');
    for (const row of result.settings.wealthHistory) { day(row.date); currency(row.currency); asCents(row.valueCents, 'Rilevazione patrimonio', {signed:true}); bool(row.complete, false, 'Copertura patrimonio'); if (!Array.isArray(row.missing) || row.missing.some(v=>typeof v!=='string')) fail('Copertura patrimonio non valida.'); }
    if (new Set(result.settings.wealthHistory.map(r=>r.date+':'+r.currency)).size !== result.settings.wealthHistory.length) fail('Rilevazioni patrimonio duplicate.');
  }
  result.settings.currency = currency(result.settings.currency ?? 'EUR'); result.settings.ownerId = asId(result.settings.ownerId ?? 'local');
  if (!Array.isArray(result.operationIds) || result.operationIds.some(id => typeof id !== 'string') || new Set(result.operationIds).size !== result.operationIds.length) fail('Identificativi operazione non validi.');
  const get = (collection, id, label) => { const r = result[collection].find(x => x.id === id); if (!r) fail(`${label}: riferimento ${id} non trovato.`); return r; };
  const sameCurrency = (r, linked, label) => { if (r.currency !== linked.currency) fail(`${label}: valute diverse. Serve una conversione esplicita con tasso verificato.`); };
  for (const collection of FINANCE_COLLECTIONS) for (const r of result[collection]) if (r.ownerId !== result.settings.ownerId) fail('Record appartenente a un altro proprietario. Usa una migrazione esplicita.');
  for (const r of result.categories) { if (r.parentId) { if (r.parentId === r.id) fail('Una categoria non può essere padre di sé stessa.'); let p = get('categories', r.parentId, 'Categoria padre'); const seen = new Set([r.id]); while (p) { if (seen.has(p.id)) fail('Categorie: gerarchia circolare.'); seen.add(p.id); p = p.parentId ? get('categories', p.parentId, 'Categoria padre') : null; } } }
  const checkTransaction = r => {
    const account = get('accounts', r.accountId, 'Conto movimento'); sameCurrency(r, account, 'Movimento');
    if (['debit', 'aggregate'].includes(account.type)) fail('Registra il movimento sul conto effettivo, non su carta collegata o prospetto.');
    if (r.status === 'posted' && r.date < (account.openingDate ?? '0000-00-00') && !r.importBatchId) fail('Movimento precedente al saldo iniziale: verifica la data di apertura.');
    if (r.toAccountId) { const to = get('accounts', r.toAccountId, 'Destinazione'); sameCurrency(r, to, 'Trasferimento'); if (['debit', 'aggregate'].includes(to.type)) fail('Destinazione non utilizzabile come conto effettivo.'); }
    if (r.categoryId) get('categories', r.categoryId, 'Categoria');
    for (const s of r.splits ?? []) get('categories', s.categoryId, 'Categoria ripartizione');
    if (r.businessId) get('businesses', r.businessId, 'Business movimento');
    if (r.orderId) get('orders', r.orderId, 'Ordine movimento');
    if (['credit_issued', 'receivable_collection'].includes(r.type)) { const linked = get('receivables', r.receivableId, 'Credito collegato (usa Registra prestito/Incassa credito)'); sameCurrency(r, linked, 'Credito'); if (r.type === 'credit_issued' && linked.originalCents !== undefined && linked.originalCents !== r.amountCents) fail('Il capitale erogato deve coincidere con il credito originale.'); }
    if (['credit_received', 'credit_repaid'].includes(r.type)) { const linked = get('liabilities', r.liabilityId, 'Debito collegato (usa Registra prestito/Rimborsa debito)'); sameCurrency(r, linked, 'Debito'); if (r.type === 'credit_received' && linked.originalCents !== undefined && linked.originalCents !== r.amountCents) fail('Il capitale ricevuto deve coincidere con il debito originale.'); }
    if (r.type === 'refund') { const original = get('transactions', r.linkedTransactionId, 'Spesa rimborsata'); if (original.type !== 'expense' || original.status !== 'posted') fail('Il rimborso deve riferirsi a una spesa contabilizzata.'); sameCurrency(r, original, 'Rimborso'); if (r.date < original.date) fail('Il rimborso precede la spesa originale.'); }
  };
  result.transactions.forEach(checkTransaction); result.recurringRules.forEach(r => checkTransaction(r.template));
  for (const original of result.transactions.filter(r => r.type === 'expense')) if (sum(result.transactions.filter(r => r.type === 'refund' && r.status === 'posted' && r.linkedTransactionId === original.id).map(r => r.amountCents)) > original.amountCents) fail('I rimborsi superano la spesa originale.');
  for (const r of result.accounts) if (r.linkedAccountId) get('accounts', r.linkedAccountId, 'Conto collegato');
  for (const r of result.balanceSnapshots) sameCurrency(r, get('accounts', r.accountId, 'Conto saldo'), 'Saldo');
  for (const r of result.budgets) if (r.categoryId) get('categories', r.categoryId, 'Categoria budget');
  for (const r of result.assetValuations) sameCurrency(r, get('assets', r.assetId, 'Bene valutato'), 'Valutazione');
  for (const collection of ['assets', 'holdings', 'liabilities', 'receivables']) for (const r of result[collection]) { if (r.accountId) sameCurrency(r, get('accounts', r.accountId, 'Conto collegato'), 'Patrimonio'); if (r.originTransactionId) get('transactions', r.originTransactionId, 'Movimento originale prestito'); }
  for (const r of result.goalAllocations) { sameCurrency(r, get('goals', r.goalId, 'Obiettivo allocazione'), 'Allocazione'); sameCurrency(r, get('accounts', r.accountId, 'Conto allocazione'), 'Allocazione'); }
  for (const collection of ['orders', 'businessCosts', 'platformBalances', 'payouts']) for (const r of result[collection]) get('businesses', r.businessId, 'Business');
  const linkedCostTransactions = new Set();
  for (const r of result.businessCosts) { if (r.orderId) { const order = get('orders', r.orderId, 'Ordine costo'); sameCurrency(r, order, 'Costo ordine'); if (order.businessId !== r.businessId) fail('Costo e ordine appartengono a business diversi.'); } if (r.transactionId) { const tx = get('transactions', r.transactionId, 'Movimento costo'); sameCurrency(r, tx, 'Costo collegato'); if (tx.type !== 'expense' || tx.amountCents !== r.amountCents) fail('Il costo collegato deve coincidere con la spesa registrata.'); if (linkedCostTransactions.has(r.transactionId)) fail('Questa spesa è già collegata a un costo business.'); linkedCostTransactions.add(r.transactionId); } }
  for (const r of result.payouts) {
    if (r.fromAccountId) sameCurrency(r, get('accounts', r.fromAccountId, 'Conto piattaforma'), 'Payout');
    if (r.toAccountId) sameCurrency(r, get('accounts', r.toAccountId, 'Conto accredito'), 'Payout');
    if (r.transactionId) { const tx = get('transactions', r.transactionId, 'Movimento payout'); if (tx.type !== 'transfer' || tx.amountCents !== r.amountCents || tx.accountId !== r.fromAccountId || tx.toAccountId !== r.toAccountId) fail('Il payout deve coincidere con il trasferimento collegato.'); }
  }
  if (result.settings.defaultAccountId) get('accounts', result.settings.defaultAccountId, 'Conto predefinito');
  return result;
}

export function transactionImpact(transaction, accountId) {
  if (transaction.status !== 'posted') return 0;
  if (transaction.type === 'transfer') return transaction.accountId === accountId ? -transaction.amountCents : transaction.toAccountId === accountId ? transaction.amountCents : 0;
  if (transaction.accountId !== accountId) return 0;
  return ['expense', 'credit_issued', 'credit_repaid'].includes(transaction.type) ? -transaction.amountCents : transaction.amountCents;
}
export function accountBalanceDetails(state, accountId, at = financeDay()) {
  day(at); const account = state.accounts.find(r => r.id === accountId); if (!account) fail('Conto non trovato.');
  const snapshots = state.balanceSnapshots.filter(r => r.accountId === accountId && r.verified && r.date <= at).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const snapshot = snapshots[0]; let baseCents = snapshot?.observedCents ?? account.openingCents; const baseDate = snapshot?.date ?? account.openingDate;
  if (baseCents === null || !baseDate || baseDate > at) return { balanceCents: null, known: false, verified: false, date: at, baselineDate: null, movementCents: sum(state.transactions.filter(r => r.date <= at).map(r => transactionImpact(r, accountId))) };
  const included = new Set(snapshot?.includedTransactionIds ?? []); const impacts = snapshot?.includedImpacts;
  const changedTransactionIds = impacts ? Object.entries(impacts).filter(([id, impact]) => { const current = state.transactions.find(t => t.id === id && t.date <= baseDate); return (current ? transactionImpact(current, accountId) : 0) !== impact; }).map(([id]) => id) : [];
  const correctionCents = impacts ? sum(Object.entries(impacts).map(([id, impact]) => { const current = state.transactions.find(t => t.id === id && t.date <= baseDate); return (current ? transactionImpact(current, accountId) : 0) - impact; })) : 0;
  const newHistorical = snapshot && impacts ? state.transactions.filter(t => t.status === 'posted' && t.date < baseDate && !included.has(t.id) && transactionImpact(t, accountId) !== 0) : [];
  changedTransactionIds.push(...newHistorical.map(t => t.id));
  const movementCents = sum([correctionCents, ...newHistorical.map(t => transactionImpact(t, accountId)), ...state.transactions.filter(r => r.date <= at && (snapshot ? r.date > baseDate || r.date === baseDate && Array.isArray(snapshot.includedTransactionIds) && !included.has(r.id) : r.date >= baseDate)).map(r => transactionImpact(r, accountId))]);
  return { balanceCents: sum([baseCents, movementCents]), known: true, verified: (!!snapshot || account.openingVerified === true) && !changedTransactionIds.length, reconciliationChanged: !!changedTransactionIds.length, changedTransactionIds, date: at, baselineDate: baseDate, movementCents };
}
export const accountBalance = (state, accountId, at) => accountBalanceDetails(state, accountId, at).balanceCents;
const within = (r, { start, end, currency: code }) => r.date >= start && r.date <= end && r.currency === code;
const matchesTransaction = (r, options = {}) => (!options.accountId || r.accountId === options.accountId || r.toAccountId === options.accountId) && (!options.businessId || r.businessId === options.businessId) && (!options.query || `${r.description ?? ''} ${r.counterparty ?? ''} ${r.merchant ?? ''} ${r.notes ?? ''}`.toLocaleLowerCase('it').includes(options.query.toLocaleLowerCase('it')));
export function financePeriod({ start = `${financeDay().slice(0, 7)}-01`, end = financeDay(), currency: code = 'EUR' } = {}) { day(start, 'Inizio periodo'); day(end, 'Fine periodo'); if (start > end) fail('Intervallo di date non valido.'); return { start, end, currency: currency(code) }; }
export function financialReport(state, options = {}) {
  const period = financePeriod(options); const posted = state.transactions.filter(r => r.status === 'posted' && within(r, period) && matchesTransaction(r, options));
  const incomeCents = sum(posted.filter(r => r.type === 'income' && !r.orderId).map(r => r.amountCents));
  const expenseCents = sum(posted.map(r => r.type === 'expense' ? r.amountCents : r.type === 'refund' ? -r.amountCents : 0));
  const accounts = state.accounts.filter(r => r.active && r.includeInLiquidity && !['debit', 'aggregate', 'investment', 'crypto'].includes(r.type) && r.currency === period.currency);
  const balances = accounts.map(r => ({ ...accountBalanceDetails(state, r.id, period.end), accountId: r.id, ownershipBps: r.ownershipBps }));
  const unknownAccountIds = balances.filter(r => !r.known).map(r => r.accountId); const unverifiedAccountIds = balances.filter(r => !r.verified).map(r => r.accountId);
  const knownLiquidityCents = sum(balances.filter(r => r.known).map(r => owned(r.balanceCents, r)));
  const categories = state.categories.filter(r => r.type !== 'income' && !r.parentId).map(category => ({ categoryId: category.id, name: category.name, spentCents: categorySpending(state, category.id, { ...options, ...period }) })).filter(r => r.spentCents !== 0).sort((a, b) => b.spentCents - a.spentCents);
  const uncategorizedCents = sum([expenseCents, -sum(categories.map(r => r.spentCents))]);
  if (uncategorizedCents !== 0) categories.push({ categoryId: null, name: 'Senza categoria', spentCents: uncategorizedCents });
  return { ...period, incomeCents, expenseCents, netCents: sum([incomeCents, -expenseCents]), savingsCents: sum([incomeCents, -expenseCents]), savingsRate: incomeCents > 0 ? (incomeCents - expenseCents) / incomeCents : null, liquidityCents: !accounts.length || unknownAccountIds.length ? null : knownLiquidityCents, knownLiquidityCents, unknownAccountIds, unverifiedAccountIds, balances, categories, transactions: posted, scheduled: state.transactions.filter(r => r.status === 'scheduled' && within(r, period)) };
}
export function categorySpending(state, categoryId, options) {
  const period = financePeriod(options); const ids = new Set([categoryId]); let changed = true;
  while (changed) { changed = false; for (const c of state.categories) if (ids.has(c.parentId) && !ids.has(c.id)) { ids.add(c.id); changed = true; } }
  return sum(state.transactions.filter(r => r.status === 'posted' && within(r, period) && matchesTransaction(r, options)).map(r => {
    const original = r.type === 'refund' ? state.transactions.find(t => t.id === r.linkedTransactionId) : r;
    if (!['expense', 'refund'].includes(r.type)) return 0;
    if (!original) fail('Rimborso senza spesa originale: conserva l’archivio completo per i calcoli.');
    const splits = original.splits?.length ? original.splits : [{ categoryId: original.categoryId, amountCents: original.amountCents }];
    if (r.type === 'expense') return sum(splits.filter(s => ids.has(s.categoryId)).map(s => s.amountCents));
    // Largest-remainder apportionment guarantees that split refunds add to the exact cent.
    const allocations = splits.map((s, index) => { const numerator = BigInt(r.amountCents) * BigInt(s.amountCents); return { categoryId: s.categoryId, index, cents: Number(numerator / BigInt(original.amountCents)), remainder: numerator % BigInt(original.amountCents) }; });
    let remainder = r.amountCents - sum(allocations.map(a => a.cents));
    const ranked = [...allocations].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
    for (let i = 0; i < remainder; i++) ranked[i].cents++;
    return -sum(allocations.filter(a => ids.has(a.categoryId)).map(a => a.cents));
  }));
}
export function budgetStatus(state, budgetOrId) {
  const b = typeof budgetOrId === 'string' ? state.budgets.find(r => r.id === budgetOrId) : budgetOrId; if (!b) fail('Budget non trovato.');
  const options = { start: b.start, end: b.end, currency: b.currency }; const spentCents = b.categoryId ? categorySpending(state, b.categoryId, options) : financialReport(state, options).expenseCents;
  return { ...b, spentCents, remainingCents: sum([b.limitCents, -spentCents]), ratio: b.limitCents ? spentCents / b.limitCents : null, exceeded: spentCents > b.limitCents };
}
export function goalProjection(state, goalOrId, { monthlyCents = null, at = financeDay() } = {}) {
  const goal = typeof goalOrId === 'string' ? state.goals.find(r => r.id === goalOrId) : goalOrId; if (!goal) fail('Obiettivo non trovato.'); day(at);
  if (monthlyCents !== null) asCents(monthlyCents, 'Accantonamento mensile');
  const allocations = state.goalAllocations.filter(r => r.goalId === goal.id && r.date <= at); const allocatedCents = sum(allocations.map(r => r.amountCents));
  const unsupportedAccountIds = [...new Set(allocations.filter(r => { const account = state.accounts.find(a => a.id === r.accountId); const balance = accountBalance(state, r.accountId, at); const total = sum(state.goalAllocations.filter(a => a.accountId === r.accountId && a.date <= at).map(a => a.amountCents)); return balance === null || owned(balance, account) < total; }).map(r => r.accountId))];
  const fundedCents = unsupportedAccountIds.length ? null : allocatedCents; const remainingCents = Math.max(0, goal.targetCents - allocatedCents);
  const monthsUntilDeadline = goal.targetDate ? Math.max(0, (Number(goal.targetDate.slice(0, 4)) - Number(at.slice(0, 4))) * 12 + Number(goal.targetDate.slice(5, 7)) - Number(at.slice(5, 7)) + (goal.targetDate.slice(8) > at.slice(8) ? 1 : 0)) : null;
  return { ...goal, allocatedCents, fundedCents, unsupportedAccountIds, remainingCents, ratio: allocatedCents / goal.targetCents, monthsUntilDeadline, requiredMonthlyCents: monthsUntilDeadline ? Math.ceil(remainingCents / monthsUntilDeadline) : remainingCents === 0 ? 0 : null, projectedMonths: monthlyCents > 0 ? Math.ceil(remainingCents / monthlyCents) : remainingCents === 0 ? 0 : null, monthlyCents, projection: true };
}
export function netWorth(state, { at = financeDay(), currency: code = 'EUR' } = {}) {
  day(at); currency(code); const missing = []; const estimated = []; const known = { liquidityCents: 0, investmentsCents: 0, assetsCents: 0, receivablesCents: 0, liabilitiesCents: 0 };
  const add = (key, amount) => { known[key] = sum([known[key], amount]); };
  for (const a of state.accounts.filter(r => r.active && r.currency === code && !['debit', 'aggregate'].includes(r.type))) {
    if (['crypto', 'investment'].includes(a.type) && state.holdings.some(h => h.accountId === a.id)) continue;
    const balance = accountBalance(state, a.id, at); if (balance === null) { missing.push(`account:${a.id}`); continue; }
    if (balance < 0) add('liabilitiesCents', owned(-balance, a)); else add(['crypto', 'investment'].includes(a.type) ? 'investmentsCents' : 'liquidityCents', owned(balance, a));
  }
  for (const h of state.holdings.filter(r => r.currency === code)) {
    if (h.valueCents === null || !h.valuationDate || h.valuationDate > at) { missing.push(`holding:${h.id}`); continue; } add('investmentsCents', owned(h.valueCents, h)); estimated.push({ id: h.id, kind: 'holding', date: h.valuationDate, source: h.valuationSource ?? 'manual' });
  }
  for (const a of state.assets.filter(r => r.currency === code && r.status === 'owned')) {
    if (a.accountId || a.holdingId) continue;
    const valuations = [...state.assetValuations.filter(r => r.assetId === a.id && r.date <= at), ...(a.valueCents !== null && a.valuationDate <= at ? [{ valueCents: a.valueCents, date: a.valuationDate, source: a.valuationSource ?? 'manual' }] : [])].sort((a, b) => b.date.localeCompare(a.date));
    if (!valuations.length) { missing.push(`asset:${a.id}`); continue; } add('assetsCents', owned(valuations[0].valueCents, a)); estimated.push({ id: a.id, kind: 'asset', date: valuations[0].date, source: valuations[0].source });
  }
  for (const r of state.receivables.filter(r => r.currency === code && r.status === 'open')) add('receivablesCents', owned(r.amountCents, r));
  for (const l of state.liabilities.filter(r => r.currency === code && r.status === 'open')) {
    if (l.accountId && state.accounts.some(a => a.id === l.accountId && a.type === 'credit')) continue; add('liabilitiesCents', owned(l.amountCents, l));
  }
  const totalAssetsCents = sum([known.liquidityCents, known.investmentsCents, known.assetsCents, known.receivablesCents]); const knownNetWorthCents = sum([totalAssetsCents, -known.liabilitiesCents]);
  return { at, currency: code, ...known, totalAssetsCents, knownNetWorthCents, netWorthCents: missing.length || !state.accounts.length && !state.assets.length && !state.holdings.length && !state.receivables.length ? null : knownNetWorthCents, immediatelyAvailableCents: sum([known.liquidityCents, -known.liabilitiesCents]), missing, estimated };
}

export function businessReport(state, businessId, options = {}) {
  const period = financePeriod(options); const business = state.businesses.find(r => r.id === businessId); if (!business) fail('Business non trovato.');
  const orders = state.orders.filter(r => r.businessId === businessId && r.status === 'completed' && within(r, period));
  const costs = state.businessCosts.filter(r => r.businessId === businessId && within(r, period)); const payouts = state.payouts.filter(r => r.businessId === businessId && r.status === 'posted' && within(r, period));
  const missingOrderIds = orders.filter(r => r.grossCents === null || r.feesCents === null || r.directCostCents === null).map(r => r.id);
  const costConflictOrderIds = [];
  const grossCents = sum(orders.map(r => r.grossCents ?? 0)); const revenueCents = sum(orders.map(r => r.grossCents === null ? 0 : r.grossCents - r.discountCents - r.refundCents));
  const feesCents = sum(orders.map(r => r.feesCents ?? 0)); const directCostCents = sum(orders.map(r => r.directCostCents ?? 0));
  const costsAlreadyIncluded = new Set();
  for (const order of orders) {
    const breakdown = costs.filter(c => c.orderId === order.id && !['additional', 'fixed', 'advertising', 'tax'].includes(c.kind));
    for (const [field, entries] of [['feesCents', breakdown.filter(c => ['fee', 'fees', 'commission', 'payment-fee', 'payment'].includes(c.kind))], ['directCostCents', breakdown.filter(c => !['fee', 'fees', 'commission', 'payment-fee', 'payment'].includes(c.kind))]]) {
      if (!entries.length || order[field] === null) continue;
      if (sum(entries.map(c => c.amountCents)) !== order[field]) costConflictOrderIds.push(order.id);
      // A linked breakdown and its aggregate describe the same cost. Never subtract both.
      for (const entry of entries) costsAlreadyIncluded.add(entry.id);
    }
  }
  const additionalCostsCents = sum(costs.filter(c => !costsAlreadyIncluded.has(c.id)).map(r => r.amountCents)); const payoutCents = sum(payouts.map(r => r.amountCents));
  const knownProfitCents = sum([revenueCents, -feesCents, -directCostCents, -additionalCostsCents]);
  const snapshot = state.platformBalances.filter(r => r.businessId === businessId && r.currency === period.currency && r.date <= period.end).sort((a, b) => b.date.localeCompare(a.date))[0];
  const laterPayouts = snapshot ? state.payouts.filter(p => p.businessId === businessId && p.currency === period.currency && p.status === 'posted' && p.date <= period.end && (p.date > snapshot.date || p.date === snapshot.date && Array.isArray(snapshot.includedPayoutIds) && !snapshot.includedPayoutIds.includes(p.id))) : [];
  const platformChanges = sum(laterPayouts.map(p => -sum([p.amountCents, p.feesCents ?? 0])));
  const missingPayoutFeeIds = payouts.filter(p => p.feesCents === null).map(p => p.id);
  const unknownPlatformFees = laterPayouts.some(p => p.feesCents === null);
  const knownPlatformBalanceCents = snapshot ? sum([snapshot.observedCents, platformChanges]) : null;
  const platformBalanceCents = unknownPlatformFees ? null : knownPlatformBalanceCents;
  const platformBalanceVerified = !!snapshot?.verified && !unknownPlatformFees;
  return { ...period, businessId, grossCents, revenueCents, feesCents, directCostCents, additionalCostsCents, payoutCents, knownProfitCents, profitCents: missingOrderIds.length || costConflictOrderIds.length || missingPayoutFeeIds.length ? null : knownProfitCents, missingOrderIds, missingPayoutFeeIds, costConflictOrderIds: [...new Set(costConflictOrderIds)], platformBalanceCents, knownPlatformBalanceCents, platformBalanceDate: snapshot?.date ?? null, platformBalanceVerified, transferableCents: platformBalanceVerified && snapshot.reservesCents !== undefined ? Math.max(0, platformBalanceCents - snapshot.reservesCents) : null, orders, costs, payouts };
}

export function nextRecurringDate(date, frequency, anchorDay = Number(date.slice(8))) {
  day(date); oneOf(frequency, ['daily', 'weekly', 'monthly', 'yearly'], 'Frequenza'); const d = new Date(`${date}T12:00:00Z`);
  if (frequency === 'daily' || frequency === 'weekly') d.setUTCDate(d.getUTCDate() + (frequency === 'daily' ? 1 : 7));
  else { const year = d.getUTCFullYear() + (frequency === 'yearly' ? 1 : 0); const month = d.getUTCMonth() + (frequency === 'monthly' ? 1 : 0); const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); d.setUTCDate(1); d.setUTCFullYear(year, month, Math.min(anchorDay, last)); }
  return d.toISOString().slice(0, 10);
}
export function recurringPreview(state, through = financeDay(), ruleId = null) {
  day(through); const result = [];
  if (ruleId && !state.recurringRules.some(r => r.id === ruleId)) fail('Ricorrenza non trovata.');
  for (const rule of state.recurringRules.filter(r => r.active && (!ruleId || r.id === ruleId))) {
    let date = rule.nextDate; let count = 0;
    while (date <= through) { if (++count > 1000) fail('Intervallo ricorrenza troppo ampio: genera al massimo 1000 scadenze alla volta.'); const id = `${rule.id}:${date}`; if (!state.transactions.some(t => t.id === id || t.recurringRuleId === rule.id && t.date === date)) result.push({ ...rule.template, id, date, status: 'scheduled', recurringRuleId: rule.id, source: 'recurring', sourceId: id }); date = nextRecurringDate(date, rule.frequency, rule.anchorDay ?? Number(rule.nextDate.slice(8))); }
  }
  return result;
}

const canonical = value => JSON.stringify(value, (_, v) => plain(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const generatedPayout = (state, record) => record.generatedPayout === true || state.transactions.some(t => t.source === 'payout' && t.payoutId === record.id);
const managedTransaction = record => record.source === 'payout' && record.payoutId || record.source === 'loan' && record.liabilityId || record.source === 'loan' && record.receivableId || record.source === 'receivable' && record.receivableId;
function assertCompoundEdit(collection, existing, record) {
  let fields; let message;
  if (collection === 'transactions' && managedTransaction(existing)) {
    fields = ['type', 'date', 'valueDate', 'amountCents', 'currency', 'accountId', 'toAccountId', 'status', 'source', 'payoutId', 'liabilityId', 'receivableId'];
    message = existing.payoutId ? 'Questo movimento appartiene a un payout. Modifica il payout nella sezione Business; note e categoria si possono aggiornare qui.' : 'Questo movimento appartiene a un prestito o a un incasso. Per correggere i dati monetari annulla l’operazione completa; per nuovi pagamenti usa Incassa o Rimborsa. Note e categoria si possono aggiornare qui.';
  } else if (collection === 'businessCosts' && existing.source === 'payout' && existing.payoutId) {
    fields = ['amountCents', 'date', 'currency', 'businessId', 'transactionId', 'source', 'payoutId']; message = 'Questa commissione appartiene a un payout. Modifica importo e data dal payout nella sezione Business.';
  } else if (['receivables', 'liabilities'].includes(collection) && existing.originTransactionId) {
    fields = ['amountCents', 'originalCents', 'currency', 'accountId', 'originTransactionId', 'status', 'source']; message = 'Questo capitale è collegato a un prestito. Usa Incassa o Rimborsa per modificarne il residuo; per correggere l’operazione originaria usa l’annullamento completo. Nome e note si possono aggiornare qui.';
  }
  if (fields?.some(key => canonical(existing[key] ?? null) !== canonical(record[key] ?? null))) fail(message);
}
function assertCompoundRemoval(collection, record) {
  if (collection === 'transactions' && managedTransaction(record)) fail(record.payoutId ? 'Elimina il payout nella sezione Business per annullare insieme trasferimento e commissione.' : 'Non eliminare un solo movimento del prestito: il capitale residuo diventerebbe incoerente. Usa l’annullamento dell’operazione completa.');
  if (collection === 'businessCosts' && record.source === 'payout' && record.payoutId) fail('Elimina o modifica la commissione dal payout nella sezione Business.');
  if (['receivables', 'liabilities'].includes(collection) && record.originTransactionId) fail('Questo prestito ha movimenti collegati. Usa Incassa o Rimborsa, oppure annulla l’operazione completa; il solo capitale non può essere eliminato.');
}
/** Rebuild only the records generated by this payout, preserving their user notes/classification. */
function syncGeneratedPayout(state, input) {
  const record = normalizeRecord('payouts', { ...input, source: 'payout', generatedPayout: true, transactionId: input.status === 'cancelled' ? null : `${input.id}:transfer` });
  const oldTransactions = state.transactions.filter(t => t.source === 'payout' && t.payoutId === record.id);
  const oldCosts = state.businessCosts.filter(c => c.source === 'payout' && c.payoutId === record.id);
  state.transactions = state.transactions.filter(t => !(t.source === 'payout' && t.payoutId === record.id));
  state.businessCosts = state.businessCosts.filter(c => !(c.source === 'payout' && c.payoutId === record.id));
  if (record.status === 'cancelled') return record;
  if (!record.fromAccountId || !record.toAccountId) fail('Indica conto piattaforma e conto di accredito del payout.');
  const txId = record.transactionId;
  const oldTransfer = oldTransactions.find(t => t.id === txId);
  state.transactions.push(normalizeRecord('transactions', { ...oldTransfer, id: txId, type: 'transfer', date: record.date, currency: record.currency, amountCents: record.amountCents, accountId: record.fromAccountId, toAccountId: record.toAccountId, businessId: record.businessId, description: oldTransfer?.description ?? 'Payout netto piattaforma', status: record.status === 'posted' ? 'posted' : 'scheduled', source: 'payout', payoutId: record.id, ownerId: state.settings.ownerId, updatedAt: new Date().toISOString() }));
  if (record.status === 'posted' && record.feesCents > 0) {
    const feeTxId = `${record.id}:withdrawal-fee`; const costId = `${record.id}:withdrawal-cost`;
    const oldFee = oldTransactions.find(t => t.id === feeTxId); const oldCost = oldCosts.find(c => c.id === costId);
    state.transactions.push(normalizeRecord('transactions', { ...oldFee, id: feeTxId, type: 'expense', date: record.date, currency: record.currency, amountCents: record.feesCents, accountId: record.fromAccountId, toAccountId: null, businessId: record.businessId, status: 'posted', description: oldFee?.description ?? 'Commissione prelievo payout', source: 'payout', payoutId: record.id, ownerId: state.settings.ownerId, updatedAt: new Date().toISOString() }));
    state.businessCosts.push(normalizeRecord('businessCosts', { ...oldCost, id: costId, businessId: record.businessId, date: record.date, currency: record.currency, amountCents: record.feesCents, transactionId: feeTxId, kind: oldCost?.kind ?? 'payment', description: oldCost?.description ?? 'Commissione prelievo payout', source: 'payout', payoutId: record.id, ownerId: state.settings.ownerId, updatedAt: new Date().toISOString() }));
  }
  return record;
}
/** Merge only new imported records. It cannot silently overwrite an existing financial record. */
export function mergeFinanceImport(state, payload, { batchId = null } = {}) {
  const next = validateFinance(state); if (!plain(payload)) fail('Dati importazione non validi.');
  for (const collection of FINANCE_COLLECTIONS.filter(k => !['auditEvents', 'importBatches'].includes(k))) {
    if (!payload[collection]) continue; if (!Array.isArray(payload[collection])) fail(`Importazione: ${collection} non è un elenco.`);
    for (const raw of payload[collection]) {
      const record = normalizeRecord(collection, { ...raw, ...(batchId ? { importBatchId: batchId } : {}) });
      const existing = next[collection].find(r => r.id === record.id || record.sourceId && r.sourceId === record.sourceId && r.source === record.source);
      if (existing) { if (existing.id === record.id && canonical({ ...existing, importBatchId: undefined, createdAt: undefined, updatedAt: undefined }) !== canonical({ ...record, importBatchId: undefined, createdAt: undefined, updatedAt: undefined })) fail(`Importazione in conflitto: ${collection} / ${record.id}. Nessun dato sovrascritto.`); continue; }
      next[collection].push(record);
    }
  }
  return validateFinance(next);
}

export function applyFinance(state, actions, operationId = null) {
  const next = validateFinance(state); const list = Array.isArray(actions) ? actions : [actions];
  if (operationId && next.operationIds.includes(operationId)) return next;
  if (operationId) asId(operationId, 'Operazione');
  for (const action of list) {
    if (!plain(action) || !plain(action.args ?? {})) fail('Operazione finanziaria non valida.'); const args = action.args ?? {}; const at = new Date().toISOString();
    switch (action.type) {
      case 'upsert': {
        const collection = oneOf(args.collection, FINANCE_COLLECTIONS.filter(c => !['auditEvents', 'importRows', 'importBatches'].includes(c)), 'Collezione');
        if (!plain(args.record)) fail('Record richiesto.'); const existing = next[collection].find(r => r.id === args.record.id);
        let record = normalizeRecord(collection, { ...existing, ...args.record, id: args.record.id || uid(), ownerId: next.settings.ownerId, createdAt: existing?.createdAt ?? args.record.createdAt ?? at, updatedAt: at });
        if (existing) assertCompoundEdit(collection, existing, record);
        if (collection === 'payouts' && existing && generatedPayout(next, existing)) record = syncGeneratedPayout(next, record);
        if (collection === 'platformBalances') record.includedPayoutIds = next.payouts.filter(p => p.businessId === record.businessId && p.currency === record.currency && p.status === 'posted' && p.date <= record.date).map(p => p.id);
        if (existing) next[collection][next[collection].indexOf(existing)] = record; else next[collection].push(record); break;
      }
      case 'remove': {
        const collection = oneOf(args.collection, FINANCE_COLLECTIONS.filter(c => !['auditEvents', 'importRows', 'importBatches'].includes(c)), 'Collezione');
        const index = next[collection].findIndex(r => r.id === args.id); if (index < 0) fail('Record da eliminare non trovato.'); const record = next[collection][index]; assertCompoundRemoval(collection, record);
        if (collection === 'payouts' && generatedPayout(next, record)) { next.transactions = next.transactions.filter(t => !(t.source === 'payout' && t.payoutId === record.id)); next.businessCosts = next.businessCosts.filter(c => !(c.source === 'payout' && c.payoutId === record.id)); }
        next[collection].splice(index, 1); break;
      }
      case 'settings': case 'update_settings': {
        if (!plain(args.settings ?? args)) fail('Impostazioni richieste.'); const settings = args.settings ?? args; if ('ownerId' in settings && settings.ownerId !== next.settings.ownerId) fail('La modifica del proprietario richiede una migrazione.'); next.settings = { ...next.settings, ...settings }; break;
      }
      case 'reconcile': {
        const account = next.accounts.find(r => r.id === args.accountId); if (!account) fail('Conto da riconciliare non trovato.'); const date = day(args.date); const observedCents = asCents(args.observedCents, 'Saldo osservato', { signed: true });
        const expectedCents = accountBalance(next, account.id, date); const differenceCents = expectedCents === null ? null : sum([observedCents, -expectedCents]);
        if (differenceCents !== null && differenceCents !== 0 && !args.confirmAdjustment) fail(`Differenza di saldo: ${differenceCents} centesimi. Conferma esplicitamente la rettifica.`);
        const snapshotId = args.id || uid();
        if (differenceCents) next.transactions.push(normalizeRecord('transactions', { id: `${snapshotId}:adjustment`, type: 'adjustment', accountId: account.id, date, amountCents: differenceCents, currency: account.currency, description: 'Rettifica saldo confermata', source: 'reconciliation', reconciliationId: snapshotId, ownerId: next.settings.ownerId }));
        const includedTransactions = next.transactions.filter(t => t.date <= date && t.status === 'posted' && (t.accountId === account.id || t.toAccountId === account.id));
        next.balanceSnapshots.push(normalizeRecord('balanceSnapshots', { id: snapshotId, accountId: account.id, currency: account.currency, date, observedCents, expectedCents, differenceCents, includedTransactionIds: includedTransactions.map(t => t.id), includedImpacts: Object.fromEntries(includedTransactions.map(t => [t.id, transactionImpact(t, account.id)])), verified: true, source: 'reconciliation', ownerId: next.settings.ownerId })); break;
      }
      case 'allocate_goal': {
        const goal = next.goals.find(r => r.id === args.goalId); const account = next.accounts.find(r => r.id === args.accountId); if (!goal || !account) fail('Conto o obiettivo non trovato.');
        const amountCents = asCents(args.amountCents, 'Accantonamento', { zero: false }); const date = day(args.date); const balance = accountBalance(next, account.id, date);
        const committed = sum(next.goalAllocations.filter(r => r.accountId === account.id && r.id !== args.id && r.date <= date).map(r => r.amountCents));
        if (balance === null) fail('Verifica prima il saldo del conto: non è possibile accantonare fondi sconosciuti.');
        if (sum([committed, amountCents]) > owned(balance, account)) fail('Le allocazioni superano i fondi disponibili secondo la quota di proprietà del conto.');
        const record = normalizeRecord('goalAllocations', { ...args, id: args.id || uid(), currency: goal.currency, ownerId: next.settings.ownerId }); const index = next.goalAllocations.findIndex(r => r.id === record.id); if (index < 0) next.goalAllocations.push(record); else next.goalAllocations[index] = record; break;
      }
      case 'generate_recurring': {
        const through = day(args.through ?? financeDay()); const records = recurringPreview(next, through, args.ruleId); next.transactions.push(...records);
        for (const rule of next.recurringRules.filter(r => r.active && (!args.ruleId || r.id === args.ruleId))) { const anchor = rule.anchorDay ?? Number(rule.nextDate.slice(8)); rule.anchorDay = anchor; let loops = 0; while (rule.nextDate <= through) { if (++loops > 1000) fail('Intervallo ricorrenza troppo ampio.'); rule.nextDate = nextRecurringDate(rule.nextDate, rule.frequency, anchor); } rule.updatedAt = at; }
        break;
      }
      case 'post_transaction': { const record = next.transactions.find(r => r.id === args.id); if (!record) fail('Movimento previsto non trovato.'); if (managedTransaction(record)) fail(record.payoutId ? 'Contabilizza il payout nella sezione Business, insieme al trasferimento e alla commissione.' : 'Questo movimento è parte di un prestito: usa la relativa operazione completa.'); record.status = 'posted'; record.updatedAt = at; if (args.date) record.date = day(args.date); break; }
      case 'cancel_recurring': { const rule = next.recurringRules.find(r => r.id === args.id); if (!rule) fail('Ricorrenza non trovata.'); rule.active = false; rule.updatedAt = at; if (args.removeScheduled) next.transactions = next.transactions.filter(t => t.recurringRuleId !== rule.id || t.status !== 'scheduled'); break; }
      case 'record_payout': {
        const id = args.id || uid(); const txId = `${id}:transfer`; let record = normalizeRecord('payouts', { ...args, id, status: 'posted', transactionId: txId, source: 'payout', generatedPayout: true, ownerId: next.settings.ownerId });
        if (!record.fromAccountId || !record.toAccountId) fail('Per contabilizzare il payout indica conto piattaforma e conto di accredito.');
        if (next.payouts.some(r => r.id === id) || next.transactions.some(r => r.id === txId)) fail('Payout già registrato.');
        record = syncGeneratedPayout(next, record); next.payouts.push(record);
        break;
      }
      case 'settle_receivable': {
        const record = next.receivables.find(r => r.id === args.id); if (!record || record.status !== 'open') fail('Credito aperto non trovato.'); const amountCents = asCents(args.amountCents ?? record.amountCents, 'Incasso credito', { zero: false }); if (amountCents > record.amountCents) fail('L’incasso supera il credito residuo.');
        next.transactions.push(normalizeRecord('transactions', { id: args.transactionId || uid(), type: 'receivable_collection', date: day(args.date), accountId: args.accountId, amountCents, currency: record.currency, receivableId: record.id, description: `Incasso credito: ${record.name}`, source: 'receivable', ownerId: next.settings.ownerId })); record.amountCents -= amountCents; if (!record.amountCents) record.status = 'settled'; record.updatedAt = at; break;
      }
      case 'grant_loan': case 'receive_loan': {
        const id = args.id || uid(); const date = day(args.date); const amountCents = asCents(args.amountCents, 'Capitale prestito', { zero: false }); const account = next.accounts.find(a => a.id === args.accountId); if (!account) fail('Conto del prestito non trovato.');
        const code = currency(args.currency ?? account.currency); const counterparty = asText(args.counterparty, 'Controparte prestito', 500, true); const name = asText(args.name ?? counterparty, 'Nome prestito', 500, true); const issued = action.type === 'grant_loan'; const collection = issued ? 'receivables' : 'liabilities'; const txId = `${id}:${issued ? 'issued' : 'received'}`;
        if (next[collection].some(r => r.id === id) || next.transactions.some(r => r.id === txId)) fail('Prestito già registrato.');
        next[collection].push(normalizeRecord(collection, { ...args, id, name, counterparty, currency: code, amountCents, originalCents: amountCents, status: 'open', originTransactionId: txId, source: 'loan', ownerId: next.settings.ownerId }));
        next.transactions.push(normalizeRecord('transactions', { id: txId, type: issued ? 'credit_issued' : 'credit_received', date, accountId: account.id, amountCents, currency: code, ...(issued ? { receivableId: id } : { liabilityId: id }), description: `${issued ? 'Prestito concesso' : 'Prestito ricevuto'}: ${counterparty}`, source: 'loan', ownerId: next.settings.ownerId })); break;
      }
      case 'repay_liability': {
        const liability = next.liabilities.find(r => r.id === args.id && r.status === 'open'); if (!liability) fail('Debito aperto non trovato.'); const amountCents = asCents(args.amountCents ?? liability.amountCents, 'Capitale rimborsato', { zero: false }); const interestCents = asCents(args.interestCents ?? 0, 'Interessi/costi'); if (amountCents > liability.amountCents) fail('Il rimborso supera il capitale residuo.'); const date = day(args.date); const txId = args.transactionId || uid();
        const linkedCreditCard = liability.accountId && next.accounts.find(a => a.id === liability.accountId && a.type === 'credit');
        next.transactions.push(normalizeRecord('transactions', { id: txId, type: linkedCreditCard ? 'transfer' : 'credit_repaid', date, accountId: args.accountId, ...(linkedCreditCard ? { toAccountId: linkedCreditCard.id } : {}), amountCents, currency: liability.currency, liabilityId: liability.id, description: `Rimborso capitale: ${liability.name}`, source: 'loan', ownerId: next.settings.ownerId }));
        if (interestCents) next.transactions.push(normalizeRecord('transactions', { id: `${txId}:interest`, type: 'expense', date, accountId: args.accountId, amountCents: interestCents, currency: liability.currency, liabilityId: liability.id, categoryId: args.interestCategoryId || null, description: `Interessi/costi: ${liability.name}`, source: 'loan', ownerId: next.settings.ownerId }));
        liability.amountCents -= amountCents; if (!liability.amountCents) liability.status = 'settled'; liability.updatedAt = at; break;
      }
      case 'import_batch': {
        const batch = normalizeRecord('importBatches', { ...args.batch, id: args.batch?.id || uid(), ownerId: next.settings.ownerId });
        if (next.importBatches.some(r => r.id === batch.id || batch.fileHash && r.fileHash === batch.fileHash && r.status !== 'undone')) continue;
        const merged = mergeFinanceImport(next, args.payload, { batchId: batch.id }); Object.assign(next, merged); next.importBatches.push(batch); break;
      }
      case 'undo_import': {
        const batch = next.importBatches.find(r => r.id === args.id && r.status === 'imported'); if (!batch) fail('Sessione importazione non trovata.');
        for (const collection of FINANCE_COLLECTIONS.filter(c => !['importBatches', 'auditEvents'].includes(c))) next[collection] = next[collection].filter(r => r.importBatchId !== batch.id); batch.status = 'undone'; batch.updatedAt = at; break;
      }
      default: fail(`Operazione finanziaria non supportata: ${action.type}.`);
    }
    next.auditEvents.push(normalizeRecord('auditEvents', { id: uid(), ownerId: next.settings.ownerId, type: action.type, collection: args.collection ?? null, entityId: args.id ?? args.record?.id ?? null, operationId, at, source: 'application' }));
  }
  if (operationId) next.operationIds.push(operationId);
  return validateFinance(next);
}

export function exportFinanceCsv(state, { collection = 'transactions' } = {}) {
  const data = validateFinance(state); oneOf(collection, FINANCE_COLLECTIONS, 'Collezione export'); const rows = data[collection];
  const columns = ['empireFinanceCsv', 'collection', 'id', 'date', 'type', 'description', 'amountCents', 'currency', 'accountId', 'toAccountId', 'categoryId', 'status', 'record'];
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`; const text = value => value == null ? '' : `'${value}`;
  return '\uFEFF' + [columns, ...rows.map(r => columns.map(k => k === 'empireFinanceCsv' ? '1' : k === 'collection' ? collection : k === 'record' ? JSON.stringify(r) : typeof r[k] === 'string' ? text(r[k]) : r[k]))].map(r => r.map(quote).join(',')).join('\r\n');
}

/** Values supplied here are a simulation; they never mutate any account or goal. */
export function housingSimulation({ rentCents, depositCents, utilitiesCents, foodCents, transportCents, otherMonthlyCents = 0, setupCents = 0, emergencyCents = 0, stableIncomeCents, uncertainIncomeCents = 0, initialCents, monthlySavingCents = null }) {
  const values = { rentCents, depositCents, utilitiesCents, foodCents, transportCents, otherMonthlyCents, setupCents, emergencyCents, stableIncomeCents, uncertainIncomeCents, initialCents }; for (const [key, value] of Object.entries(values)) asCents(value, key);
  if (monthlySavingCents !== null) asCents(monthlySavingCents, 'Risparmio mensile previsto');
  const monthlyCostCents = sum([rentCents, utilitiesCents, foodCents, transportCents, otherMonthlyCents]); const entryThresholdCents = sum([depositCents, setupCents, emergencyCents, monthlyCostCents]); const monthlyMarginCents = sum([stableIncomeCents, -monthlyCostCents]); const remainingCents = Math.max(0, entryThresholdCents - initialCents); const saving = monthlySavingCents ?? Math.max(0, monthlyMarginCents);
  return { simulation: true, monthlyCostCents, entryThresholdCents, monthlyMarginCents, marginWithUncertainIncomeCents: sum([monthlyMarginCents, uncertainIncomeCents]), remainingCents, monthsRequired: saving > 0 ? Math.ceil(remainingCents / saving) : remainingCents === 0 ? 0 : null, monthlySavingCents: saving };
}
