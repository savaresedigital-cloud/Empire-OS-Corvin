import { financeIdToken } from './finance-cloud.js';
import { applyFinance, financeDay, financialReport, netWorth, validateFinance } from './finance-domain.js';
import { executeFinanceTool, FINANCE_TOOL_SCHEMAS } from './finance-tools.js';

// Keep this projection aligned with the authenticated backend allowlist.
const fields = Object.freeze({
  accounts: ['id', 'ownerId', 'name', 'type', 'currency', 'active', 'openingCents', 'openingDate', 'includeInLiquidity', 'ownershipBps', 'linkedAccountId'],
  categories: ['id', 'ownerId', 'name', 'type', 'parentId'],
  goals: ['id', 'ownerId', 'name', 'currency', 'targetCents', 'targetDate', 'active'],
  businesses: ['id', 'ownerId', 'name', 'active'],
  transactions: ['id', 'ownerId', 'type', 'date', 'valueDate', 'amountCents', 'currency', 'accountId', 'toAccountId', 'categoryId', 'description', 'notes', 'counterparty', 'status', 'tags', 'splits', 'linkedTransactionId', 'businessId', 'historicalImport'],
  assets: ['id', 'ownerId', 'name', 'currency', 'valueCents', 'valuationDate', 'valuationSource', 'status', 'ownershipBps'],
  budgets: ['id', 'ownerId', 'name', 'currency', 'categoryId', 'limitCents', 'start', 'end'],
});
const normalize = value => String(value ?? '').toLocaleLowerCase('it').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const money = (value, currency = 'EUR') => value === null || value === undefined ? 'Non disponibile' : new Intl.NumberFormat('it-IT', { style: 'currency', currency }).format(value / 100);
function projection(record, collection) {
  if (collection === 'transactions' && record.importBatchId) record = { ...record, historicalImport: true };
  return Object.fromEntries(fields[collection].filter(key => record[key] !== undefined).map(key => {
    const value = record[key];
    if (key === 'splits') return [key, value.slice(0, 30).map(split => ({ categoryId: split.categoryId, amountCents: split.amountCents }))];
    if (key === 'tags') return [key, value.slice(0, 20).map(tag => String(tag).slice(0, 100))];
    return [key, typeof value === 'string' ? value.slice(0, ['notes', 'description', 'counterparty'].includes(key) ? 500 : 1200) : value];
  }));
}
function boundedSelection(records, requiredIds, limit, message, dependency = null) {
  requiredIds = new Set(requiredIds);
  if (dependency) closeReferences(records, requiredIds, dependency);
  const required = records.filter(record => requiredIds.has(record.id));
  if (required.length > limit) throw new Error('La richiesta riguarda troppi riferimenti. Specifica un conto, una categoria o un movimento.');
  const rest = records.filter(record => !requiredIds.has(record.id)).sort((a, b) => Number(normalize(message).includes(normalize(b.name))) - Number(normalize(message).includes(normalize(a.name))));
  const selected = [...required], ids = new Set(requiredIds);
  for (const record of rest) {
    if (ids.has(record.id)) continue;
    const candidateIds = new Set([record.id]); if (dependency) closeReferences(records, candidateIds, dependency);
    const additions = records.filter(candidate => candidateIds.has(candidate.id) && !ids.has(candidate.id));
    if (selected.length + additions.length > limit) continue;
    for (const candidate of additions) { selected.push(candidate); ids.add(candidate.id); }
  }
  return selected;
}
function closeReferences(records, ids, field) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) if (ids.has(record.id) && record[field] && !ids.has(record[field])) { ids.add(record[field]); changed = true; }
  }
}

/** Select identifiers and relevant records, never audit/source rows, receipts or complete history. */
export function buildFinanceContext(input, message, { maxTransactions = 80 } = {}) {
  if (typeof message !== 'string' || !message.trim() || message.length > 6000) throw new Error('Scrivi un messaggio tra 1 e 6000 caratteri.');
  if (!Number.isInteger(maxTransactions) || maxTransactions < 0 || maxTransactions > 80) throw new Error('Massimo 80 movimenti nel contesto AI.');
  const state = validateFinance(input), normalized = normalize(message);
  const stop = new Set(['oggi', 'ieri', 'domani', 'conto', 'conti', 'della', 'delle', 'dallo', 'dalla', 'euro', 'spesa', 'spese', 'movimento', 'movimenti', 'transazione', 'transazioni', 'categoria', 'categorie', 'classifica', 'riclassifica', 'correggi', 'modifica', 'quanto', 'quale', 'mostra', 'ultimi', 'mese', 'mesi', 'saldo', 'speso', 'pagato']);
  const terms = normalized.split(/[^\p{L}\p{N}]+/u).filter(term => term.length > 2 && !stop.has(term));
  const needsTransactions = /classific|rimbor|storn|corregg|modific|transazion|moviment/.test(normalized);
  const scored = needsTransactions ? state.transactions.map(record => {
    const category = state.categories.find(item => item.id === record.categoryId);
    const haystack = normalize(`${record.id} ${record.description} ${record.notes} ${record.counterparty ?? ''} ${record.date} ${category?.name ?? ''}`);
    return { record, score: terms.filter(term => haystack.includes(term)).length };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || b.record.date.localeCompare(a.record.date)) : [];
  const transactions = [], selectedIds = new Set();
  for (const { record } of scored) {
    const linked = record.linkedTransactionId && state.transactions.find(item => item.id === record.linkedTransactionId);
    const needed = [linked, record].filter(item => item && !selectedIds.has(item.id));
    if (transactions.length + needed.length > maxTransactions) continue;
    for (const item of needed) { transactions.push(item); selectedIds.add(item.id); }
  }
  const accountIds = new Set(transactions.flatMap(record => [record.accountId, record.toAccountId]).filter(Boolean));
  if (state.settings.defaultAccountId) accountIds.add(state.settings.defaultAccountId);
  closeReferences(state.accounts, accountIds, 'linkedAccountId');
  const budgets = boundedSelection(state.budgets, new Set(), 40, message);
  const categoryIds = new Set([...transactions.flatMap(record => [record.categoryId, ...(record.splits || []).map(split => split.categoryId)]), ...budgets.map(record => record.categoryId)].filter(Boolean));
  closeReferences(state.categories, categoryIds, 'parentId');
  const businesses = boundedSelection(state.businesses, new Set(transactions.map(record => record.businessId).filter(Boolean)), 40, message);
  const accounts = boundedSelection(state.accounts, accountIds, 80, message, 'linkedAccountId');
  const categories = boundedSelection(state.categories, categoryIds, 120, message, 'parentId');
  // Additional selected accounts/categories may themselves have references.
  for (const account of accounts) if (account.linkedAccountId && !accounts.some(record => record.id === account.linkedAccountId)) throw new Error('Troppi conti collegati: specifica il conto nella richiesta.');
  for (const category of categories) if (category.parentId && !categories.some(record => record.id === category.parentId)) throw new Error('Troppe categorie collegate: specifica la categoria nella richiesta.');
  const context = { schemaVersion: 1, ownerId: state.settings.ownerId, asOf: financeDay(), settings: { ownerId: state.settings.ownerId, currency: state.settings.currency, defaultAccountId: state.settings.defaultAccountId || null }, accounts, categories, transactions, goals: boundedSelection(state.goals, new Set(), 40, message), businesses, assets: boundedSelection(state.assets, new Set(), 40, message), budgets, reports: [] };
  for (const collection of Object.keys(fields)) context[collection] = context[collection].map(record => projection(record, collection));
  if (/liquidita|saldo|soldi disponibili/.test(normalized)) {
    const report = financialReport(state, { start: `${context.asOf.slice(0, 7)}-01`, end: context.asOf, currency: state.settings.currency });
    context.reports.push({ name: 'liquidity', asOf: context.asOf, currency: report.currency, values: { liquidityCents: report.liquidityCents, knownLiquidityCents: report.knownLiquidityCents, unknownAccountCount: report.unknownAccountIds.length, unverifiedAccountCount: report.unverifiedAccountIds.length } });
  }
  if (/patrimonio/.test(normalized)) {
    const report = netWorth(state, { at: context.asOf, currency: state.settings.currency });
    context.reports.push({ name: 'net-worth', asOf: context.asOf, currency: report.currency, values: { netWorthCents: report.netWorthCents, missingValuationCount: report.missing.length, estimatedValuationCount: report.estimated.length } });
  }
  // Validate reference closure without changing the projection sent over the network.
  validateFinance({ ...stateForContext(context), settings: context.settings });
  return context;
}
function stateForContext(context) { return { schemaVersion: 1, ...Object.fromEntries(Object.keys(fields).map(key => [key, context[key].map(record => key === 'transactions' && record.historicalImport === true ? { ...record, importBatchId: 'context-history' } : record)])), settings: context.settings }; }

function formatRead(name, args, data, state) {
  const currency = args.currency || state.settings.currency;
  switch (name) {
    case 'list_accounts': return data.length ? data.map(record => `${record.name}: ${money(record.balanceCents, record.currency)}${record.verified ? '' : ' · non verificato'}`).join('\n') : 'Nessun conto disponibile.';
    case 'get_account_balance': return `${state.accounts.find(record => record.id === args.accountId)?.name || 'Conto'}: ${money(data.balanceCents, state.accounts.find(record => record.id === args.accountId)?.currency || currency)} al ${data.date}${data.verified ? '' : ' · saldo non verificato'}.`;
    case 'get_cashflow_report': return `Dal ${data.start} al ${data.end}: entrate ${money(data.incomeCents, data.currency)}, uscite ${money(data.expenseCents, data.currency)}, saldo economico ${money(data.netCents, data.currency)}. Trasferimenti esclusi.`;
    case 'search_transactions': return data.length ? `${data.length} movimenti trovati.\n${data.slice(0, 20).map(record => `${record.date} · ${record.description || record.type} · ${money(record.amountCents, record.currency)}`).join('\n')}${data.length > 20 ? '\nSono mostrati i primi 20.' : ''}` : 'Nessun movimento corrispondente ai filtri.';
    case 'get_budget_status': return `${data.name || 'Budget'} dal ${data.start} al ${data.end}: speso ${money(data.spentCents, data.currency)}, residuo ${money(data.remainingCents, data.currency)}.`;
    case 'get_net_worth': return `Patrimonio netto al ${data.at}: ${money(data.netWorthCents, data.currency)}.${data.missing.length ? ' Alcune valutazioni non sono disponibili.' : ''}${data.estimated.length ? ' Include stime manuali.' : ''}`;
    case 'list_assets': return data.length ? data.map(record => `${record.name}: ${money(record.valueCents, record.currency)} · stima ${record.valuationDate || 'non disponibile'}`).join('\n') : 'Nessun bene registrato.';
    case 'get_goal_projection': return `${data.name}: accantonato verificabile ${money(data.fundedCents, data.currency)}, residuo target ${money(data.remainingCents, data.currency)}.${data.projectedMonths !== null ? ` Simulazione: ${data.projectedMonths} mesi con ${money(data.monthlyCents, data.currency)} al mese.` : ''}${data.unsupportedAccountIds.length ? ' Verifica le allocazioni rispetto ai saldi.' : ''}`;
    case 'get_business_report': return `${state.businesses.find(record => record.id === args.businessId)?.name || 'Business'} dal ${data.start} al ${data.end}: ricavi ${money(data.revenueCents, data.currency)}, utile ${money(data.profitCents, data.currency)}, payout ${money(data.payoutCents, data.currency)}.${data.missingOrderIds.length ? ` Costi incompleti: margine sui dati noti ${money(data.knownProfitCents, data.currency)}.` : ''}`;
    case 'search_import_batches': return data.length ? data.map(record => `${record.fileName || record.name || 'Importazione'} · ${record.status}`).join('\n') : 'Nessuna importazione corrispondente.';
    default: throw new Error('Lettura finanziaria non consentita.');
  }
}

export async function interpretFinanceWithGemini(message, input, { fetcher = globalThis.fetch, getToken = financeIdToken, url = '/api/finance/interpret' } = {}) {
  const state = validateFinance(input), financeContext = buildFinanceContext(state, message);
  const body = JSON.stringify({ message: message.trim(), financeContext });
  if (new TextEncoder().encode(body).length > 120 * 1024) throw new Error('Contesto troppo grande. Specifica un conto o un movimento e riprova.');
  const token = await getToken();
  if (typeof token !== 'string' || !token) throw new Error('Accedi a Firebase per usare Gemini.');
  let response;
  try { response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body, signal: AbortSignal.timeout(25000) }); }
  catch (error) { throw new Error(error.name === 'TimeoutError' || error.name === 'AbortError' ? 'Gemini non ha risposto in tempo. Nessuna operazione salvata.' : 'Backend non raggiungibile. Nessuna operazione salvata.'); }
  let result; try { result = await response.json(); } catch { throw new Error('Risposta del backend non valida. Nessuna operazione salvata.'); }
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error.slice(0, 1200) : 'Richiesta Gemini non riuscita. Nessuna operazione salvata.');
  if (!result || result.provider !== 'gemini' || result.saved !== false || !Array.isArray(result.financeToolCalls) || result.financeToolCalls.length > 20 || !Array.isArray(result.financeActions) || result.financeActions.length > 40) throw new Error('Proposta finanziaria del backend non valida. Nessuna operazione salvata.');
  const actions = result.financeActions;
  if (actions.length && (result.requiresConfirmation !== true || typeof result.operationId !== 'string' || !result.operationId || result.operationId.length > 180)) throw new Error('Conferma o identificativo della proposta non validi.');
  for (const action of actions) if (action.type !== 'upsert' || !['transactions', 'businessCosts', 'assets'].includes(action.args?.collection) || !action.args?.record?.id) throw new Error('Operazione finanziaria del backend non consentita.');
  const reads = [], messages = []; let writeCalls = 0;
  for (const call of result.financeToolCalls) {
    const definition = FINANCE_TOOL_SCHEMAS.find(tool => tool.name === call?.name);
    if (!definition || !call.args || typeof call.args !== 'object' || Array.isArray(call.args)) throw new Error('Strumento finanziario del backend non valido.');
    if (definition.writes) { writeCalls++; continue; }
    const data = executeFinanceTool(call.name, call.args, state);
    reads.push({ name: call.name, args: call.args, data }); messages.push(formatRead(call.name, call.args, data, state));
  }
  if (Boolean(actions.length) !== Boolean(writeCalls)) throw new Error('La proposta contiene operazioni incoerenti. Nessuna operazione salvata.');
  // The server validates a small snapshot; revalidate the exact returned IDs against all local data.
  if (actions.length) applyFinance(state, actions, result.operationId);
  const summary = actions.map(action => {
    const record = action.args.record;
    if (action.args.collection === 'assets') return `Stima ${state.assets.find(asset => asset.id === record.id)?.name || 'bene'}: ${money(record.valueCents, state.assets.find(asset => asset.id === record.id)?.currency || state.settings.currency)}`;
    if (action.args.collection === 'businessCosts') return `Costo business collegato: ${money(record.amountCents, record.currency)}`;
    const accountId = record.accountId || state.transactions.find(transaction => transaction.id === record.id)?.accountId;
    const account = state.accounts.find(item => item.id === accountId);
    return `${record.type === 'transfer' ? 'Trasferimento' : record.type === 'expense' ? 'Uscita' : record.type === 'income' ? 'Entrata' : 'Modifica movimento'}${record.amountCents !== undefined ? ` ${money(record.amountCents, record.currency || account?.currency)}` : ''} · ${account?.name || 'conto'}${record.date ? ` · ${record.date}` : ''}`;
  }).join('\n');
  return { handled: true, provider: 'gemini', actions, operationId: result.operationId, confirmationRequired: actions.length > 0, summary, data: reads, message: messages.length ? messages.join('\n\n') : typeof result.message === 'string' ? result.message.slice(0, 1800) : 'Nessuna operazione proposta.', saved: false };
}
