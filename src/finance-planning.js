import { financialReport, financeDay, validFinanceDay } from './finance-domain.js';
import { incomeBreakdown } from './finance-insights.js';

export const periodLabel = period => {
  const format = value => new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T12:00:00Z'));
  return `${format(period.start)} — ${format(period.end)}`;
};

export function periodMonths(state, period, currency = 'EUR') {
  if (!validFinanceDay(period.start) || !validFinanceDay(period.end) || period.end < period.start) throw new Error('Periodo non valido.');
  const rows = [], date = new Date(period.start.slice(0, 7) + '-01T12:00:00Z');
  while (date.toISOString().slice(0, 10) <= period.end) {
    if (rows.length >= 120) throw new Error('Seleziona al massimo dieci anni.');
    const month = date.toISOString().slice(0, 7), last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12)).toISOString().slice(0, 10);
    const start = month + '-01' < period.start ? period.start : month + '-01', end = last > period.end ? period.end : last;
    const report = financialReport(state, { start, end, currency });
    rows.push({ date: month + '-01', start, end, partial: start !== month + '-01' || end !== last, income: report.incomeCents, expense: report.expenseCents, net: report.netCents });
    date.setUTCMonth(date.getUTCMonth() + 1);
  }
  return rows;
}

export function planningBasis(state, { at = financeDay(), currency = 'EUR' } = {}) {
  const date = new Date(at.slice(0, 7) + '-01T12:00:00Z');
  const endDate = new Date(date); endDate.setUTCDate(0);
  date.setUTCMonth(date.getUTCMonth() - 3);
  const period = { start: date.toISOString().slice(0, 10), end: endDate.toISOString().slice(0, 10) };
  const report = financialReport(state, { ...period, currency });
  const sources = incomeBreakdown(state, period, currency).map(row => ({ id: row.id, name: row.name, businessId: row.businessId, totalCents: row.value, monthlyCents: Math.round(row.value / 3), count: row.transactions.length }));
  const dated = state.transactions.filter(t => t.currency === currency && t.status === 'posted' && t.date <= period.end).map(t => t.date).sort();
  return { period, sources, months: 3, expenseCents: Math.round(report.expenseCents / 3), earliest: dated[0] || null, partialArchive: !dated.length || dated[0] > period.start };
}

export function projectCash({ incomeCents, expenseCents, extraIncomeCents = 0, extraExpenseCents = 0, months = 6, startingCents = null, from = financeDay() }) {
  if (!validFinanceDay(from) || !Number.isInteger(months) || months < 1 || months > 24) throw new Error('Orizzonte non valido.');
  for (const value of [incomeCents, expenseCents, extraIncomeCents, extraExpenseCents]) if (!Number.isSafeInteger(value) || value < 0) throw new Error('Inserisci importi positivi in centesimi.');
  if (startingCents !== null && !Number.isSafeInteger(startingCents)) throw new Error('Saldo iniziale non valido.');
  const monthlyIncome = incomeCents + extraIncomeCents, monthlyExpense = expenseCents + extraExpenseCents, net = monthlyIncome - monthlyExpense;
  const anchor = new Date(from.slice(0, 7) + '-01T12:00:00Z');
  return Array.from({ length: months }, (_, i) => {
    const date = new Date(anchor); date.setUTCMonth(date.getUTCMonth() + i + 1);
    const cumulative = net * (i + 1), balance = startingCents === null ? null : startingCents + cumulative;
    if (![monthlyIncome, monthlyExpense, cumulative, balance ?? 0].every(Number.isSafeInteger)) throw new Error('Importi troppo grandi.');
    return { date: date.toISOString().slice(0, 10), income: monthlyIncome, expense: monthlyExpense, net, cumulative, balance };
  });
}

export const adviserName = settings => !settings.agentName || settings.agentName === 'Nox' ? 'Consigliere' : settings.agentName;
