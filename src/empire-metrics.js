import { financialReport, financeDay } from './finance-domain.js';
import { legacyBusinessReport } from './finance-business.js';
import { incomeBreakdown } from './finance-insights.js';

export const euro = (value, currency = 'EUR') => value == null ? '—' : new Intl.NumberFormat('it-IT', { style: 'currency', currency }).format(value / 100);
export function monthPeriod(month = financeDay().slice(0, 7)) {
  const [year, number] = month.split('-').map(Number);
  const end = new Date(Date.UTC(year, number, 0, 12)).toISOString().slice(0, 10);
  return { start: month + '-01', end: month === financeDay().slice(0, 7) ? financeDay() : end };
}
export function cashSeries(state, period, currency = 'EUR') {
  const rows = []; let income = 0, expense = 0;
  const dailyRows = new Map();
  for (const transaction of financialReport(state,{...period,currency}).transactions) {
    const daily = dailyRows.get(transaction.date) || { incomeCents:0,expenseCents:0 };
    if (transaction.type === 'income' && !transaction.orderId) daily.incomeCents += transaction.amountCents;
    if (transaction.type === 'expense') daily.expenseCents += transaction.amountCents;
    if (transaction.type === 'refund') daily.expenseCents -= transaction.amountCents;
    dailyRows.set(transaction.date,daily);
  }
  for (let date = period.start; date <= period.end;) {
    const daily = dailyRows.get(date) || { incomeCents:0,expenseCents:0 };
    income += daily.incomeCents; expense += daily.expenseCents;
    rows.push({ date, income, expense, dailyIncome: daily.incomeCents, dailyExpense: daily.expenseCents });
    if (date === period.end) break;
    const next = new Date(date + 'T12:00:00Z'); next.setUTCDate(next.getUTCDate() + 1); date = next.toISOString().slice(0, 10);
  }
  return rows;
}
export function businessMetrics(state, period, currency = 'EUR') {
  const income = incomeBreakdown(state, period, currency);
  return state.businesses.filter(b => b.sourceId !== '__unassigned_legacy_products__').map(business => {
    const report = legacyBusinessReport(state, { businessId: business.id, ...period, currency });
    const history = legacyBusinessReport(state, { businessId: business.id, currency });
    const products = business.sourceData?.products || [];
    const collections = income.filter(r => r.businessId === business.id);
    return { ...report, id: business.id, name: business.name, products, collectedCents: collections.reduce((n, r) => n + r.value, 0), receiptCount: collections.reduce((n, r) => n + r.transactions.length, 0), count: state.orders.filter(o => o.businessId === business.id && o.status !== 'cancelled' && o.date >= period.start && o.date <= period.end).length, historicalCount: state.orders.filter(o => o.businessId === business.id).length, historicalRevenue: history.revenueCents, historicalMargin: history.marginCents };
  }).sort((a, b) => b.revenueCents - a.revenueCents || b.historicalRevenue - a.historicalRevenue);
}
export function taskProgress(state) {
  const done = new Map([...state.tasks, ...(state.settings.agentTrash || []).map(r => r.task)].filter(t => t.status === 'done' && !/^test qa\b/i.test(t.title)).map(t => [t.id, t]));
  const milestones = [1, 5, 15, 30, 60, 100, 250], total = done.size;
  const next = milestones.find(n => n > total) || Math.ceil((total + 1) / 100) * 100;
  return { total, next, achieved: milestones.filter(n => n <= total), ratio: Math.min(1, total / next) };
}
export function suggestDay(state, { date = financeDay(), count = 3 } = {}) {
  const limit = count === 5 ? 5 : 3;
  const candidates = state.tasks.filter(t => t.status !== 'done' && !t.archived && !/^test qa\b|^verifica interfaccia/i.test(t.title));
  const score = t => {
    const due = t.dueAt?.slice(0, 10);
    return (due && due < date ? 100 : due === date ? 80 : 0) + ({ high: 30, normal: 10, low: 0 }[t.priority] || 0) + (t.projectId ? 5 : 0);
  };
  return candidates.sort((a, b) => score(b) - score(a) || (a.dueAt || 'z').localeCompare(b.dueAt || 'z') || a.createdAt.localeCompare(b.createdAt)).slice(0, limit);
}
