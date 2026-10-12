import { financialReport, financeDay, netWorth } from './finance-domain.js';
const norm = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
export function sourceKey(state, transaction) {
  const category = state.categories.find(c => c.id === transaction.categoryId);
  const sub = state.categories.find(c => c.id === transaction.subcategoryId);
  return [category?.name || transaction.sourceData?.originalCategory || 'Senza categoria', sub?.name || transaction.sourceData?.originalSubcategory].filter(Boolean).join(' / ');
}
export function incomeSource(state, transaction) {
  const key = sourceKey(state, transaction);
  const rule = (state.settings.incomeSourceRules || []).find(r => r.key === key);
  let business = state.businesses.find(b => b.id === (rule ? rule.businessId : transaction.businessId));
  let method = rule ? 'Scelto da te' : business ? 'Collegamento registrato' : '';
  if (!rule && !business) {
    const source = norm(key), text = norm([transaction.description, transaction.notes, transaction.counterparty].join(' '));
    const explicit = state.businesses.filter(b => norm(b.name).length > 5 && (source.includes(norm(b.name)) || text.includes(norm(b.name))));
    if (explicit.length === 1) { business = explicit[0]; method = 'Nome presente nei dati'; }
    const alias = source.includes('marketingecomunicazione') ? 'Digital Communication' : source === 'attivitapc' ? 'PC' : source === 'zeroaimpero' ? 'Zero a Impero' : source === '3d' ? '3DGLab' : null;
    if (!business && alias) { business = state.businesses.find(b => norm(b.name) === norm(alias)); method = 'Categoria Money Manager'; }
  }
  const label = rule?.label?.trim() || business?.name || key.replace(/^attività \/ /i, '');
  return { key, id: business?.id || 'source:' + key, name: label, businessId: business?.id || null, method, incomeKind: rule?.incomeKind || 'not-classified', needsReview: !business && /attivit|3d/.test(norm(key)) };
}
export const cashIncome = (state, period, currency = 'EUR') => state.transactions.filter(t => t.type === 'income' && t.status === 'posted' && !t.orderId && t.currency === currency && t.date >= period.start && t.date <= period.end);
export function incomeBreakdown(state, period, currency = 'EUR') {
  const groups = new Map();
  for (const transaction of cashIncome(state, period, currency)) {
    const source = incomeSource(state, transaction), row = groups.get(source.id) || { ...source, value: 0, transactions: [], keys: [] };
    row.value += transaction.amountCents; row.transactions.push(transaction); if (!row.keys.includes(source.key)) row.keys.push(source.key); groups.set(source.id, row);
  }
  return [...groups.values()].sort((a, b) => b.value - a.value);
}
export function incomeMonths(state, { end = financeDay(), count = 6, currency = 'EUR', businessId } = {}) {
  const anchor = new Date(end + 'T12:00:00Z'); anchor.setUTCDate(1);
  return Array.from({ length: count }, (_, i) => {
    const startDate = new Date(anchor); startDate.setUTCMonth(startDate.getUTCMonth() - count + 1 + i);
    const start = startDate.toISOString().slice(0, 10), stopDate = new Date(startDate); stopDate.setUTCMonth(stopDate.getUTCMonth() + 1); stopDate.setUTCDate(0);
    const stop = [stopDate.toISOString().slice(0, 10), end].sort()[0];
    const rows = incomeBreakdown(state, { start, end: stop }, currency);
    return { date: start, end: stop, income: rows.filter(r => !businessId || r.businessId === businessId).reduce((n, r) => n + r.value, 0), partial: stop !== stopDate.toISOString().slice(0, 10) };
  });
}
// Matching date + amount + business is evidence to review, never proof of payment.
export function reconciliationCandidates(state, period, currency = 'EUR') {
  return cashIncome(state, period, currency).flatMap(t => {
    const source = incomeSource(state, t); if (!source.businessId) return [];
    const orders = state.orders.filter(o => o.businessId === source.businessId && o.currency === currency && o.status !== 'cancelled' && o.date === t.date && o.grossCents !== null && o.grossCents - (o.discountCents || 0) - (o.refundCents || 0) === t.amountCents);
    return orders.length ? [{ transaction: t, orders, source }] : [];
  });
}
export function monthlyComparison(state, period, currency = 'EUR') {
  const from = new Date(period.start + 'T12:00:00Z'), to = new Date(period.end + 'T12:00:00Z');
  if (period.start.slice(0, 7) !== period.end.slice(0, 7)) return null;
  const year = from.getUTCFullYear(), month = from.getUTCMonth(), last = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  const start = new Date(Date.UTC(year, month - 1, Math.min(from.getUTCDate(), last), 12)).toISOString().slice(0, 10), end = new Date(Date.UTC(year, month - 1, Math.min(to.getUTCDate(), last), 12)).toISOString().slice(0, 10);
  return { start, end, report: financialReport(state, { start, end, currency }) };
}
export function wealthObservation(state, date = financeDay(), currency = 'EUR') {
  const value = netWorth(state, { at: date, currency });
  return { date, currency, valueCents: value.knownNetWorthCents, complete: value.netWorthCents !== null, missing: [...value.missing], recordedAt: new Date().toISOString() };
}
export function wealthHistory(state, currency = 'EUR', end = financeDay()) {
  return (state.settings.wealthHistory || []).filter(r => r.currency === currency && r.date <= end).sort((a, b) => a.date.localeCompare(b.date));
}
export function recordWealthObservation(state, date = financeDay(), currency = 'EUR') {
  const observation = wealthObservation(state, date, currency);
  return [...(state.settings.wealthHistory || []).filter(r=>r.date!==date || r.currency!==currency), observation].sort((a,b)=>a.date.localeCompare(b.date)).slice(-1500);
}
