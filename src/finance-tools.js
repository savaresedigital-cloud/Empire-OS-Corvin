import { TRANSACTION_TYPES, accountBalanceDetails, applyFinance, businessReport, financialReport, financeDay, goalProjection, moneyToCents, netWorth, validateFinance, validFinanceDay, budgetStatus, categorySpending } from './finance-domain.js';

/** Schemas describe application tools. They do not imply a connected language model. */
const schema = (name, properties, required = [], writes = false) => ({ name, writes, parameters: { type: 'object', additionalProperties: false, properties, required } });
const string = { type: 'string' }; const integer = { type: 'integer' };
export const FINANCE_TOOL_SCHEMAS = Object.freeze([
  schema('list_accounts', { currency: string }),
  schema('get_account_balance', { accountId: string, date: string }, ['accountId']),
  schema('search_transactions', { query: string, start: string, end: string, accountId: string, categoryId: string, type: { type: 'string', enum: TRANSACTION_TYPES }, currency: string, limit: integer }),
  schema('propose_transaction', { type: { type: 'string', enum: TRANSACTION_TYPES }, date: string, accountId: string, toAccountId: string, categoryId: string, amountCents: integer, currency: string, description: string, linkedTransactionId: string }, ['type', 'date', 'accountId', 'amountCents', 'currency'], true),
  schema('create_transfer', { date: string, accountId: string, toAccountId: string, amountCents: integer, currency: string }, ['date', 'accountId', 'toAccountId', 'amountCents', 'currency'], true),
  schema('classify_transaction', { id: string, categoryId: string }, ['id', 'categoryId'], true),
  schema('get_cashflow_report', { start: string, end: string, currency: string }),
  schema('get_budget_status', { budgetId: string }, ['budgetId']),
  schema('get_net_worth', { date: string, currency: string }),
  schema('list_assets', { currency: string }),
  schema('propose_asset_update', { id: string, valueCents: integer, valuationDate: string, valuationSource: string }, ['id', 'valueCents', 'valuationDate'], true),
  schema('get_goal_projection', { goalId: string, monthlyCents: integer, date: string }, ['goalId']),
  schema('get_business_report', { businessId: string, start: string, end: string, currency: string }, ['businessId']),
  schema('propose_business_expense', { businessId: string, date: string, accountId: string, amountCents: integer, currency: string, description: string, categoryId: string }, ['businessId', 'date', 'accountId', 'amountCents', 'currency'], true),
  schema('search_import_batches', { query: string }),
]);
const normalize = text => text.toLocaleLowerCase('it').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const euros = (value, currency = 'EUR') => value === null ? 'Non disponibile' : new Intl.NumberFormat('it-IT', { style: 'currency', currency }).format(value / 100);
const res = (message, extra = {}) => ({ handled: true, message, actions: [], ...extra });

/** Same validated adapter can be called by a future authenticated backend. Writes remain proposals. */
export function executeFinanceTool(name, args, input) {
  const definition = FINANCE_TOOL_SCHEMAS.find(t => t.name === name); if (!definition) throw new Error('Strumento finanziario non consentito.');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Parametri strumento non validi.');
  for (const key of Object.keys(args)) if (!Object.hasOwn(definition.parameters.properties, key)) throw new Error(`Parametro strumento non consentito: ${key}.`);
  for (const key of definition.parameters.required) if (!(key in args)) throw new Error(`Parametro richiesto: ${key}.`);
  for (const [key, value] of Object.entries(args)) { const property = definition.parameters.properties[key]; const type = property.type; if (type === 'string' && typeof value !== 'string' || type === 'integer' && !Number.isSafeInteger(value) || property.enum && !property.enum.includes(value)) throw new Error(`Parametro non valido: ${key}.`); }
  for (const key of ['date', 'start', 'end', 'valuationDate']) if (args[key] !== undefined && !validFinanceDay(args[key])) throw new Error(`Data strumento non valida: ${key}.`);
  if (args.start && args.end && args.start > args.end) throw new Error('Intervallo strumento non valido.');
  if (args.currency && !/^[A-Z]{3}$/.test(args.currency)) throw new Error('Valuta strumento non valida.');
  if (args.limit !== undefined && (args.limit < 1 || args.limit > 1000)) throw new Error('Limite risultati: scegli un valore da 1 a 1000.');
  const state = validateFinance(input); const now = financeDay();
  switch (name) {
    case 'list_accounts': return state.accounts.filter(a => a.active && (!args.currency || a.currency === args.currency)).map(a => ({ id: a.id, name: a.name, type: a.type, currency: a.currency, ...accountBalanceDetails(state, a.id) }));
    case 'get_account_balance': return accountBalanceDetails(state, args.accountId, args.date ?? now);
    case 'search_transactions': return state.transactions.filter(t => (!args.query || normalize(`${t.description} ${t.notes} ${t.counterparty ?? ''}`).includes(normalize(args.query))) && (!args.start || t.date >= args.start) && (!args.end || t.date <= args.end) && (!args.accountId || t.accountId === args.accountId || t.toAccountId === args.accountId) && (!args.categoryId || t.categoryId === args.categoryId || t.splits.some(s => s.categoryId === args.categoryId)) && (!args.type || t.type === args.type) && (!args.currency || t.currency === args.currency)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, Math.max(1, Math.min(args.limit ?? 100, 1000)));
    case 'propose_transaction': case 'create_transfer': { const action = { type: 'upsert', args: { collection: 'transactions', record: { ...args, type: name === 'create_transfer' ? 'transfer' : args.type, id: crypto.randomUUID(), status: 'posted', source: 'assistant-local' } } }; applyFinance(state, action); return { confirmationRequired: true, actions: [action] }; }
    case 'classify_transaction': { const action = { type: 'upsert', args: { collection: 'transactions', record: args } }; if (!state.transactions.some(t => t.id === args.id)) throw new Error('Movimento non trovato.'); applyFinance(state, action); return { confirmationRequired: true, actions: [action] }; }
    case 'get_cashflow_report': return financialReport(state, args);
    case 'get_budget_status': return budgetStatus(state, args.budgetId);
    case 'get_net_worth': return netWorth(state, { at: args.date ?? now, currency: args.currency ?? 'EUR' });
    case 'list_assets': return state.assets.filter(a => !args.currency || a.currency === args.currency);
    case 'propose_asset_update': { if (!state.assets.some(a => a.id === args.id)) throw new Error('Bene non trovato.'); const action = { type: 'upsert', args: { collection: 'assets', record: args } }; applyFinance(state, action); return { confirmationRequired: true, actions: [action] }; }
    case 'get_goal_projection': return goalProjection(state, args.goalId, { monthlyCents: args.monthlyCents ?? null, at: args.date ?? now });
    case 'get_business_report': { const { businessId, ...period } = args; return businessReport(state, businessId, period); }
    case 'propose_business_expense': { const txId = crypto.randomUUID(); const actions = [{ type: 'upsert', args: { collection: 'transactions', record: { ...args, id: txId, type: 'expense', status: 'posted', source: 'assistant-local' } } }, { type: 'upsert', args: { collection: 'businessCosts', record: { ...args, id: crypto.randomUUID(), transactionId: txId, source: 'assistant-local' } } }]; applyFinance(state, actions); return { confirmationRequired: true, actions }; }
    case 'search_import_batches': return state.importBatches.filter(b => !args.query || normalize(`${b.filename ?? b.name ?? ''} ${b.fileHash ?? ''}`).includes(normalize(args.query)));
    default: throw new Error('Strumento non implementato.');
  }
}

function commandDate(text, now) {
  const dates = [...text.matchAll(/\b(oggi|ieri|domani|\d{4}-\d{2}-\d{2})\b/gi)];
  if (!dates.length) return { missing: 'date' };
  if (dates.length > 1) return { error: 'Indica una sola data per il movimento.' };
  const word = normalize(dates[0][0]); const d = new Date(`${financeDay(now)}T12:00:00Z`); if (word === 'ieri') d.setUTCDate(d.getUTCDate() - 1); if (word === 'domani') d.setUTCDate(d.getUTCDate() + 1);
  const date = ['oggi', 'ieri', 'domani'].includes(word) ? d.toISOString().slice(0, 10) : word;
  return validFinanceDay(date) ? { date } : { error: 'La data indicata non è valida.' };
}
function matchingAccounts(text, state) {
  const n = normalize(text); return state.accounts.filter(a => a.active && !['aggregate', 'debit'].includes(a.type) && n.includes(normalize(a.name)));
}
function reportPeriod(text, now) {
  const current = financeDay(now); const date = new Date(`${current}T12:00:00Z`); const n = normalize(text); let months = 1;
  const namedMonths = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const named = namedMonths.findIndex(m => new RegExp(`\\b${m}\\b`).test(n));
  if (named >= 0) { const year = n.match(/\b(20\d{2})\b/)?.[1] ?? current.slice(0, 4); const start = `${year}-${String(named + 1).padStart(2, '0')}-01`; const end = new Date(Date.UTC(Number(year), named + 1, 0, 12)).toISOString().slice(0, 10); return { start, end }; }
  if (/ultimi?\s+(?:tre|3)\s+mesi/.test(n)) months = 3; if (/ultimi?\s+(?:sei|6)\s+mesi/.test(n)) months = 6; if (/ultimi?\s+(?:dodici|12)\s+mesi/.test(n)) months = 12;
  if (/mese scorso|mese precedente/.test(n)) { date.setUTCDate(0); const end = date.toISOString().slice(0, 10); return { start: `${end.slice(0, 7)}-01`, end }; }
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - months + 1); return { start: date.toISOString().slice(0, 10), end: current };
}

/** A bounded Italian grammar, explicitly not AI. It never saves or fabricates account/date data. */
export function parseFinanceCommand(text, input, { defaultAccountId = input?.settings?.defaultAccountId, now = new Date() } = {}) {
  if (typeof text !== 'string' || !text.trim() || text.length > 6000) return { handled: false, message: '', actions: [] };
  const n = normalize(text); const financial = /\b(spes[oa]|spendo|pagato|entrata|uscita|euro|saldo|liquidita|patrimonio|etsy|guadagn|budget|bonifico|trasferisci|fondo|accantona|rimbors\w*|storn\w*|prestit[oi]|prestat[oaie]|debit[oi]|restitu\w*|incass|ricevuto|ho preso|spos?ta)\b|€/.test(n);
  if (!financial) return { handled: false, message: '', actions: [] };
  let state; try { state = validateFinance(input); } catch (e) { return res(e.message); }
  if (/\b(cancella|elimina|azzera|rimuovi)\b/.test(n)) return res('Per eliminare dati finanziari usa la relativa pagina e la conferma.');
  if (/etsy|marketplace|payout/.test(n) && /(?:ho preso|incass|ricevuto|guadagn|registra|speso|pagato|accredit)/.test(n) && !/^(?:quanto|quale|mostra|dimmi)/.test(n)) return res('Indica se si tratta di una vendita, di un saldo sulla piattaforma o di un payout al conto. Il payout è un trasferimento, non una seconda entrata.', { missing: ['businessOperationType'] });
  if (/quanto.*(?:guadagn|netto|utile|rende)/.test(n)) {
    const businesses = state.businesses.filter(b => n.includes(normalize(b.name)) || /etsy/.test(n) && /etsy/i.test(b.name));
    if (businesses.length !== 1) return res('Indica il nome completo del business da consultare.', { missing: ['businessId'] });
    const data = businessReport(state, businesses[0].id, { ...reportPeriod(n, now), currency: state.settings.currency });
    return res(`${businesses[0].name}: utile ${euros(data.profitCents, data.currency)} dal ${data.start} al ${data.end}.${data.missingOrderIds.length ? ' Costi o ricavi mancanti: risultato non completo.' : data.costConflictOrderIds.length ? ' Costi di dettaglio da riconciliare con i totali.' : ''} Payout esclusi dai ricavi.`, { data });
  }
  if (/liquidita|soldi disponibili/.test(n) && /quanto|qual|mostra|dimmi/.test(n)) { const report = financialReport(state, { ...reportPeriod(n, now), currency: state.settings.currency }); return res(`Liquidità al ${report.end}: ${euros(report.liquidityCents, report.currency)}.${report.unknownAccountIds.length ? ' Mancano saldi iniziali o riconciliazioni.' : report.unverifiedAccountIds.length ? ' Sono presenti saldi non verificati.' : ''}`, { data: report }); }
  if (/patrimonio/.test(n) && /quanto|qual|mostra|dimmi/.test(n)) { const report = netWorth(state, { at: financeDay(now), currency: state.settings.currency }); return res(`Patrimonio netto al ${report.at}: ${euros(report.netWorthCents, report.currency)}.${report.missing.length ? ' Alcune valutazioni non sono disponibili.' : report.estimated.length ? ' Include stime manuali.' : ''}`, { data: report }); }
  if (/saldo/.test(n) && /quanto|qual|mostra|dimmi/.test(n)) { const matches = matchingAccounts(text, state); if (matches.length !== 1) return res('Indica il nome di un solo conto.', { missing: ['accountId'] }); const data = accountBalanceDetails(state, matches[0].id, financeDay(now)); return res(`${matches[0].name}: ${euros(data.balanceCents, matches[0].currency)} al ${data.date}.${data.verified ? '' : ' Saldo non verificato.'}`, { data }); }
  if (/quanto.*(?:speso|spendo|uscit)/.test(n)) {
    const period = { ...reportPeriod(n, now), currency: state.settings.currency }; const cats = state.categories.filter(c => n.includes(normalize(c.name))); const matches = matchingAccounts(text, state);
    const search = n.match(/(?:al|da|per)\s+(.+?)(?:\s+(?:negli|nell|questo|il mese|ultimi)|$)/)?.[1];
    const options = { ...period, accountId: matches.length === 1 ? matches[0].id : null, query: !cats.length && search ? search : null };
    const report = financialReport(state, options); const amount = cats.length === 1 ? categorySpending(state, cats[0].id, options) : report.expenseCents;
    return res(`Uscite ${cats.length === 1 ? cats[0].name : search ?? ''}: ${euros(amount, period.currency)} dal ${period.start} al ${period.end}. Rimborsi sottratti; trasferimenti esclusi.`, { data: report });
  }
  if (/quanto.*(?:manca|fondo|obiettivo)|quando.*(?:raggiung|target)|se metto da parte/.test(n)) {
    const matches = state.goals.filter(g => g.active && n.includes(normalize(g.name))); if (matches.length !== 1) return res('Indica il nome completo dell’obiettivo.', { missing: ['goalId'] });
    const amount = n.match(/(?:metto da parte|accantono)\s+(\d[\d.,]*)\s*(?:euro|€)/); let data; try { data = goalProjection(state, matches[0].id, { monthlyCents: amount ? moneyToCents(amount[1]) : null, at: financeDay(now) }); } catch (e) { return res(e.message); }
    return res(`${data.name}: residuo ${euros(data.remainingCents, data.currency)}.${data.projectedMonths !== null ? ` Simulazione: ${data.projectedMonths} mesi con ${euros(data.monthlyCents, data.currency)} al mese.` : ''}${data.unsupportedAccountIds.length ? ' Allocazioni da verificare rispetto ai saldi attuali.' : ''}`, { data });
  }
  if (/\b(?:prestit[oi]|prestat[oaie]|restitu\w*)\b/.test(n) || /\bdebit[oi]\b/.test(n.replace(/\b(?:carta|carte)\s+(?:di\s+)?debito\b/g, '')) || /\b(?:incassat[oaie]|riscoss[oaie]|ricevut[oaie])\b.*\bcredit[oi]\b/.test(n)) return res('Per prestiti, incassi di crediti e rimborsi di debiti usa Patrimonio: il movimento deve aggiornare anche il credito o il debito collegato.', { missing: ['loanOperationType'] });
  if (/\b(?:rimbors\w*|storn\w*)\b/.test(n)) return res('Registra il rimborso nella pagina Movimenti e collegalo alla spesa originale. Il rimborso riduce la spesa, senza creare un’entrata.', { missing: ['linkedTransactionId'] });
  const transfer = /^(?:sposta|trasferisci)\b/.test(n); const expense = /\b(?:ho speso|speso|ho pagato|pagato|registra.*spesa)\b/.test(n); const income = /\b(?:ho ricevuto|ricevuto|ho incassato|incassato|registra.*entrata)\b/.test(n);
  if (!transfer && !expense && !income) return res('Comando finanziario non riconosciuto. Usa «Oggi ho speso 24 euro di benzina dal conto Hype», «Sposta oggi 100 euro da Hype a Contanti» o una domanda sulla liquidità.');
  const amountMatch = text.match(/([+-]?\d[\d.,]*)\s*(?:euro|€)/i); if (!amountMatch) return res('Indica l’importo in euro.', { missing: ['amountCents'] });
  let amountCents; try { amountCents = moneyToCents(amountMatch[1]); if (amountCents <= 0) throw new Error('L’importo deve essere maggiore di zero.'); } catch (e) { return res(e.message, { missing: ['amountCents'] }); }
  const dateResult = commandDate(text, now); if (dateResult.error) return res(dateResult.error, { missing: ['date'] });
  const missing = dateResult.missing ? ['date'] : []; const matches = matchingAccounts(text, state); let account; let to;
  if (transfer) {
    const fromPhrase = normalize(text).match(/\bda\s+(.+?)\s+(?:a|al|ai|alla|alle)\s+(.+?)(?:[.!]|$)/);
    if (fromPhrase) { const froms = matches.filter(a => fromPhrase[1].includes(normalize(a.name))); const tos = matches.filter(a => fromPhrase[2].includes(normalize(a.name))); if (froms.length === 1) account = froms[0]; if (tos.length === 1) to = tos[0]; }
    if (!account) missing.push('accountId'); if (!to) missing.push('toAccountId');
  } else { account = matches.length === 1 ? matches[0] : !matches.length && defaultAccountId ? state.accounts.find(a => a.id === defaultAccountId && a.active && !['debit', 'aggregate'].includes(a.type)) : null; if (!account) missing.push('accountId'); }
  if (account && account.currency !== 'EUR' || to && to.currency !== 'EUR') return res('Il conto non usa EUR. Registra una conversione con importi e tasso verificati nella pagina Movimenti.');
  if (missing.length) return res(`${missing.includes('date') ? 'Indica la data: oggi, ieri, domani o YYYY-MM-DD. ' : ''}${missing.some(k => k.includes('Account') || k === 'accountId') ? transfer ? 'Indica conto di origine e destinazione.' : matches.length > 1 ? 'Sono presenti più conti: indica quello da usare.' : 'Indica il conto o seleziona un conto predefinito nelle Finanze.' : ''}`.trim(), { missing });
  const categoryMatches = state.categories.filter(c => c.type !== (expense ? 'income' : 'expense') && n.includes(normalize(c.name))); const categoryId = categoryMatches.length === 1 ? categoryMatches[0].id : null;
  const type = transfer ? 'transfer' : expense ? 'expense' : 'income';
  const record = { id: crypto.randomUUID(), type, date: dateResult.date, amountCents, currency: 'EUR', accountId: account.id, toAccountId: to?.id ?? null, categoryId, description: text.trim(), status: 'posted', source: 'assistant-local', usedDefaultAccount: !matches.length && !!defaultAccountId };
  const action = { type: 'upsert', args: { collection: 'transactions', record } };
  try { applyFinance(state, action); } catch (e) { return res(e.message); }
  const summary = `${transfer ? 'Trasferimento' : expense ? 'Uscita' : 'Entrata'} ${euros(amountCents)} · ${account.name}${to ? ` → ${to.name}` : ''} · ${record.date}${record.usedDefaultAccount ? ' · conto predefinito' : ''}${categoryId ? ` · ${categoryMatches[0].name}` : ''}`;
  return res('Controlla e conferma la registrazione.', { actions: [action], summary, confirmationRequired: true });
}
