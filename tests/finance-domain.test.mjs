import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyFinance, validateFinance, moneyToCents, applyFinance, accountBalance, accountBalanceDetails, financialReport, categorySpending, budgetStatus, netWorth, goalProjection, businessReport, recurringPreview, nextRecurringDate, exportFinanceCsv, mergeFinanceImport, housingSimulation, financeDay } from '../src/finance-domain.js';
import { FinanceRepository } from '../src/finance-repository.js';
import { parseFinanceCommand, executeFinanceTool } from '../src/finance-tools.js';

const date = '2026-10-12';
const period = { start: '2026-10-01', end: '2026-10-31', currency: 'EUR' };
const upsert = (collection, record) => ({ type: 'upsert', args: { collection, record } });
const account = (id, openingCents = 100000, extra = {}) => upsert('accounts', { id, name: id === 'bank' ? 'Hype' : id === 'cash' ? 'Contanti' : id, type: 'current', currency: 'EUR', openingCents, openingDate: openingCents === null ? null : '2026-10-01', ...extra });
const tx = (id, type, amountCents, extra = {}) => upsert('transactions', { id, type, amountCents, date, accountId: 'bank', currency: 'EUR', ...extra });
const base = () => applyFinance(emptyFinance(), [account('bank'), account('cash', 0, { type: 'cash' }), upsert('categories', { id: 'fuel', name: 'Benzina', type: 'expense' }), upsert('categories', { id: 'food', name: 'Alimentari', type: 'expense' })]);

test('finance empty state contains no invented balances and uses the Rome day', () => {
  assert.equal(financialReport(emptyFinance(), period).liquidityCents, null);
  assert.equal(netWorth(emptyFinance()).netWorthCents, null);
  assert.equal(financeDay('2026-10-11T22:30:00Z'), date);
});
test('decimal parsing is exact and rejects fractional cents, ambiguous grouping and overflow', () => {
  assert.equal(moneyToCents('1.234,56 €'), 123456); assert.equal(moneyToCents('0,10'), 10); assert.equal(moneyToCents('0.29'), 29); assert.equal(moneyToCents('-12,04'), -1204);
  assert.equal(moneyToCents(0.1), 10);
  for (const value of ['1.005', '1,234', '1,2,3', 'x12', '9007199254740992', '', 'Infinity']) assert.throws(() => moneyToCents(value));
});
test('1000 initial, 20 expense and 100 transfer yield 880 / 100 and unchanged cash flow', () => {
  const state = applyFinance(base(), [tx('expense', 'expense', 2000), tx('transfer', 'transfer', 10000, { toAccountId: 'cash' })]);
  assert.equal(accountBalance(state, 'bank', date), 88000); assert.equal(accountBalance(state, 'cash', date), 10000);
  const report = financialReport(state, period); assert.equal(report.liquidityCents, 98000); assert.equal(report.incomeCents, 0); assert.equal(report.expenseCents, 2000);
});
test('linked refunds reduce spending without creating economic income', () => {
  const state = applyFinance(base(), [tx('expense', 'expense', 2000, { categoryId: 'fuel' }), tx('refund', 'refund', 500, { linkedTransactionId: 'expense' })]);
  const report = financialReport(state, period); assert.equal(report.incomeCents, 0); assert.equal(report.expenseCents, 1500); assert.equal(accountBalance(state, 'bank', date), 98500); assert.equal(report.categories[0].spentCents, 1500);
  assert.throws(() => applyFinance(state, tx('over-refund', 'refund', 1600, { linkedTransactionId: 'expense' })), /rimborsi superano/);
});
test('credit-card purchase and statement payment create only one expense', () => {
  const state = applyFinance(base(), [account('credit', 0, { type: 'credit', includeInLiquidity: true }), tx('purchase', 'expense', 2000, { accountId: 'credit' }), tx('payment', 'transfer', 2000, { toAccountId: 'credit' })]);
  assert.equal(accountBalance(state, 'credit', date), 0); assert.equal(accountBalance(state, 'bank', date), 98000); assert.equal(financialReport(state, period).expenseCents, 2000); assert.equal(netWorth(state, { at: date }).knownNetWorthCents, 98000);
});
test('split expenses and split refunds conserve every cent', () => {
  const state = applyFinance(base(), [tx('split', 'expense', 3, { splits: [{ categoryId: 'fuel', amountCents: 1 }, { categoryId: 'food', amountCents: 2 }] }), tx('refund', 'refund', 1, { linkedTransactionId: 'split' })]);
  assert.equal(categorySpending(state, 'fuel', period) + categorySpending(state, 'food', period), 2);
  assert.equal(financialReport(state, period).expenseCents, 2);
  assert.throws(() => applyFinance(base(), tx('bad-split', 'expense', 2000, { splits: [{ categoryId: 'fuel', amountCents: 1000 }] })), /quote devono coincidere/);
});
test('child categories contribute once to report composition and to the parent budget', () => {
  const state = applyFinance(base(), [upsert('categories', { id: 'coffee', name: 'Caffè', parentId: 'food', type: 'expense' }), tx('coffee', 'expense', 120, { categoryId: 'coffee' }), upsert('budgets', { id: 'budget', categoryId: 'food', limitCents: 10000, ...period })]);
  assert.equal(categorySpending(state, 'food', period), 120); assert.equal(financialReport(state, period).categories.length, 1); assert.equal(budgetStatus(state, 'budget').spentCents, 120);
});
test('scheduled and draft transactions do not affect balances, cash flow or budget', () => {
  let state = applyFinance(base(), [tx('scheduled', 'expense', 5000, { status: 'scheduled', categoryId: 'food' }), tx('draft', 'income', 50000, { status: 'draft' }), upsert('budgets', { id: 'budget', limitCents: 10000, ...period })]);
  assert.equal(accountBalance(state, 'bank', date), 100000); assert.equal(budgetStatus(state, 'budget').spentCents, 0);
  state = applyFinance(state, { type: 'post_transaction', args: { id: 'scheduled' } }); assert.equal(accountBalance(state, 'bank', date), 95000); assert.equal(budgetStatus(state, 'budget').spentCents, 5000);
});
test('unknown opening balance stays unknown even when transactions exist', () => {
  const state = applyFinance(emptyFinance(), [account('bank', null), tx('expense', 'expense', 2000)]);
  assert.equal(accountBalance(state, 'bank', date), null); assert.equal(financialReport(state, period).liquidityCents, null); assert.deepEqual(financialReport(state, period).unknownAccountIds, ['bank']);
});
test('reconciliation displays the difference and requires explicit adjustment consent', () => {
  const state = applyFinance(base(), tx('expense', 'expense', 2000));
  assert.throws(() => applyFinance(state, { type: 'reconcile', args: { accountId: 'bank', date, observedCents: 97000 } }), /Differenza di saldo/);
  const next = applyFinance(state, { type: 'reconcile', args: { id: 'reconciliation', accountId: 'bank', date, observedCents: 97000, confirmAdjustment: true } });
  assert.equal(next.balanceSnapshots[0].differenceCents, -1000); assert.equal(accountBalance(next, 'bank', date), 97000); assert.equal(financialReport(next, period).expenseCents, 2000);
});
test('new transactions on the reconciliation day change the current balance exactly once', () => {
  let state = applyFinance(base(), { type: 'reconcile', args: { accountId: 'bank', date, observedCents: 100000 } });
  state = applyFinance(state, tx('later-today', 'expense', 1250)); assert.equal(accountBalance(state, 'bank', date), 98750);
  state = applyFinance(state, { type: 'reconcile', args: { accountId: 'bank', date, observedCents: 98750 } }); assert.equal(accountBalance(state, 'bank', date), 98750);
});
test('changes to reconciled transactions adjust the balance and explicitly invalidate verification', () => {
  let state = applyFinance(base(), tx('before-reconciliation', 'expense', 2000, { date: '2026-10-10' }));
  state = applyFinance(state, { type: 'reconcile', args: { accountId: 'bank', date, observedCents: 98000 } });
  state = applyFinance(state, upsert('transactions', { id: 'before-reconciliation', amountCents: 3000 }));
  const changed = accountBalanceDetails(state, 'bank', date); assert.equal(changed.balanceCents, 97000); assert.equal(changed.verified, false); assert.equal(changed.reconciliationChanged, true); assert.deepEqual(changed.changedTransactionIds, ['before-reconciliation']);
  state = applyFinance(state, { type: 'remove', args: { collection: 'transactions', id: 'before-reconciliation' } }); assert.equal(accountBalance(state, 'bank', date), 100000);
});
test('reconciliation provides a baseline when imported history has no opening balance', () => {
  let state = applyFinance(emptyFinance(), [account('bank', null), tx('historical', 'expense', 5000, { date: '2026-10-03' })]);
  state = applyFinance(state, { type: 'reconcile', args: { accountId: 'bank', date, observedCents: 80000 } });
  assert.equal(accountBalance(state, 'bank', '2026-10-11'), null); assert.equal(accountBalance(state, 'bank', date), 80000);
  assert.equal(state.transactions.length, 1);
});
test('estimated laptop raises estimated net worth and never liquid funds', () => {
  const state = applyFinance(base(), [tx('laptop-purchase', 'expense', 90000), upsert('assets', { id: 'laptop', name: 'Laptop', valueCents: 60000, currency: 'EUR', valuationDate: date, valuationSource: 'manual' })]);
  assert.equal(financialReport(state, period).liquidityCents, 10000); const worth = netWorth(state, { at: date }); assert.equal(worth.netWorthCents, 70000); assert.equal(worth.assetsCents, 60000); assert.equal(worth.estimated.length, 1);
});
test('uncollected credits and open debts affect net worth, not available cash', () => {
  const state = applyFinance(base(), [upsert('receivables', { id: 'credit', name: 'Credito verso terzi', amountCents: 10000 }), upsert('liabilities', { id: 'debt', name: 'Debito personale', amountCents: 5000 })]);
  assert.equal(financialReport(state, period).liquidityCents, 100000); assert.equal(netWorth(state, { at: date }).netWorthCents, 105000);
  const settled = applyFinance(state, { type: 'settle_receivable', args: { id: 'credit', accountId: 'bank', date } }); assert.equal(financialReport(settled, period).liquidityCents, 110000); assert.equal(financialReport(settled, period).incomeCents, 0); assert.equal(netWorth(settled, { at: date }).netWorthCents, 105000);
});
test('holdings replace linked investment-account valuation and never duplicate an asset', () => {
  const state = applyFinance(base(), [account('broker', 50000, { type: 'investment', includeInLiquidity: false }), upsert('holdings', { id: 'holding', name: 'Investimento manuale', accountId: 'broker', valueCents: 55000, valuationDate: date }), upsert('assets', { id: 'duplicate', name: 'Riferimento investimento', accountId: 'broker', valueCents: 55000, valuationDate: date })]);
  assert.equal(netWorth(state, { at: date }).netWorthCents, 155000); assert.equal(financialReport(state, period).liquidityCents, 100000);
});
test('historical net worth only uses valuations that actually existed by the requested date', () => {
  const state = applyFinance(base(), [upsert('assets', { id: 'camera', name: 'Fotocamera', valueCents: 60000, valuationDate: '2026-10-20' }), upsert('assetValuations', { id: 'older', assetId: 'camera', valueCents: 65000, date: '2026-10-05' })]);
  assert.equal(netWorth(state, { at: '2026-10-04' }).netWorthCents, null); assert.equal(netWorth(state, { at: '2026-10-10' }).assetsCents, 65000); assert.equal(netWorth(state, { at: '2026-10-22' }).assetsCents, 60000);
});
test('goal allocations reserve existing funds without changing balances or net worth', () => {
  let state = applyFinance(base(), upsert('goals', { id: 'freedom', name: 'Fondo Libertà', targetCents: 300000, targetDate: '2027-10-12' }));
  state = applyFinance(state, { type: 'allocate_goal', args: { goalId: 'freedom', accountId: 'bank', amountCents: 50000, date } });
  assert.equal(accountBalance(state, 'bank', date), 100000); assert.equal(netWorth(state, { at: date }).netWorthCents, 100000); const projection = goalProjection(state, 'freedom', { monthlyCents: 25000, at: date }); assert.equal(projection.fundedCents, 50000); assert.equal(projection.projectedMonths, 10);
  assert.throws(() => applyFinance(state, { type: 'allocate_goal', args: { goalId: 'freedom', accountId: 'bank', amountCents: 60000, date } }), /superano i fondi/);
});
test('spending reserved funds marks allocations unsupported rather than inventing a goal balance', () => {
  let state = applyFinance(base(), upsert('goals', { id: 'goal', name: 'Obiettivo', targetCents: 100000 }));
  state = applyFinance(state, { type: 'allocate_goal', args: { goalId: 'goal', accountId: 'bank', amountCents: 80000, date } }); state = applyFinance(state, tx('expense', 'expense', 50000));
  assert.equal(goalProjection(state, 'goal', { at: date }).fundedCents, null);
});
test('Etsy revenue, fees and payout keep profit separate from cash and avoid a second income', () => {
  let state = applyFinance(base(), [upsert('businesses', { id: 'shop', name: 'Shop di test' }), account('platform', 10000, { type: 'business' }), upsert('orders', { id: 'order', businessId: 'shop', date, currency: 'EUR', grossCents: 10000, feesCents: 1500, directCostCents: 0 }), upsert('platformBalances', { id: 'platform-balance', businessId: 'shop', date, observedCents: 8500, verified: true, reservesCents: 0 })]);
  state = applyFinance(state, { type: 'record_payout', args: { id: 'payout', businessId: 'shop', date, currency: 'EUR', amountCents: 8500, fromAccountId: 'platform', toAccountId: 'bank', feesCents: 0 } });
  assert.equal(businessReport(state, 'shop', period).profitCents, 8500); assert.equal(businessReport(state, 'shop', period).payoutCents, 8500); assert.equal(financialReport(state, period).incomeCents, 0); assert.equal(accountBalance(state, 'bank', date), 108500);
});
test('missing business costs produce an unavailable profit, never a fabricated zero cost', () => {
  const state = applyFinance(base(), [upsert('businesses', { id: 'shop', name: 'Shop' }), upsert('orders', { id: 'sale', businessId: 'shop', date, grossCents: 10000 })]);
  const report = businessReport(state, 'shop', period); assert.equal(report.profitCents, null); assert.equal(report.knownProfitCents, 10000); assert.deepEqual(report.missingOrderIds, ['sale']);
});
test('one personal-account business expense feeds both cash balance and business report', () => {
  let state = applyFinance(base(), upsert('businesses', { id: 'shop', name: 'Shop' })); const proposal = executeFinanceTool('propose_business_expense', { businessId: 'shop', accountId: 'bank', amountCents: 1800, currency: 'EUR', date, description: 'Materiali' }, state);
  assert.equal(state.transactions.length, 0); state = applyFinance(state, proposal.actions);
  assert.equal(state.transactions.length, 1); assert.equal(accountBalance(state, 'bank', date), 98200); assert.equal(businessReport(state, 'shop', period).knownProfitCents, -1800);
});
test('order cost totals and linked cost breakdowns are never deducted twice', () => {
  let state = applyFinance(base(), [upsert('businesses', { id: 'shop', name: 'Shop' }), upsert('orders', { id: 'sale', businessId: 'shop', date, grossCents: 10000, feesCents: 500, directCostCents: 2000 }), upsert('businessCosts', { id: 'material', businessId: 'shop', orderId: 'sale', date, amountCents: 2000, kind: 'material' })]);
  assert.equal(businessReport(state, 'shop', period).profitCents, 7500); assert.equal(businessReport(state, 'shop', period).additionalCostsCents, 0);
  state = applyFinance(state, upsert('businessCosts', { id: 'material', amountCents: 2500 })); const report = businessReport(state, 'shop', period); assert.equal(report.profitCents, null); assert.deepEqual(report.costConflictOrderIds, ['sale']);
});
test('fees and payment business-cost aliases reconcile with the order fee aggregate', () => {
  const state = applyFinance(base(), [upsert('businesses', { id: 'shop', name: 'Shop' }), upsert('orders', { id: 'sale', businessId: 'shop', date, grossCents: 10000, feesCents: 1500, directCostCents: 0 }), upsert('businessCosts', { id: 'listing', businessId: 'shop', orderId: 'sale', date, amountCents: 500, kind: 'fees' }), upsert('businessCosts', { id: 'payment', businessId: 'shop', orderId: 'sale', date, amountCents: 1000, kind: 'payment' })]);
  const report = businessReport(state, 'shop', period); assert.equal(report.profitCents, 8500); assert.equal(report.additionalCostsCents, 0); assert.deepEqual(report.costConflictOrderIds, []);
});
test('payout amount is net credited and a withdrawal fee creates one real expense and business cost', () => {
  let state = applyFinance(base(), [upsert('businesses', { id: 'shop', name: 'Shop' }), account('platform', 10000, { type: 'business' }), upsert('orders', { id: 'sale', businessId: 'shop', date, grossCents: 10000, feesCents: 1500, directCostCents: 0 }), upsert('platformBalances', { id: 'observed', businessId: 'shop', date, observedCents: 10000, verified: true, reservesCents: 0 })]);
  const payout = { type: 'record_payout', args: { id: 'payout', businessId: 'shop', date, amountCents: 8500, feesCents: 200, currency: 'EUR', fromAccountId: 'platform', toAccountId: 'bank' } };
  state = applyFinance(state, payout, 'payout-operation'); assert.equal(accountBalance(state, 'platform', date), 1300); assert.equal(accountBalance(state, 'bank', date), 108500); assert.equal(state.businessCosts.length, 1); assert.equal(financialReport(state, period).expenseCents, 200); assert.equal(businessReport(state, 'shop', period).profitCents, 8300); assert.equal(businessReport(state, 'shop', period).platformBalanceCents, 1300);
  state = applyFinance(state, payout, 'payout-operation'); assert.equal(state.businessCosts.length, 1);
});
test('unknown withdrawal fees leave post-payout platform funds and profit unverified', () => {
  let state = applyFinance(base(), [upsert('businesses', { id: 'shop', name: 'Shop' }), account('platform', 10000, { type: 'business' }), upsert('platformBalances', { id: 'observed', businessId: 'shop', date, observedCents: 10000, verified: true, reservesCents: 0 })]);
  state = applyFinance(state, { type: 'record_payout', args: { id: 'payout', businessId: 'shop', date, amountCents: 8500, feesCents: null, currency: 'EUR', fromAccountId: 'platform', toAccountId: 'bank' } }); const report = businessReport(state, 'shop', period); assert.equal(report.platformBalanceCents, null); assert.equal(report.knownPlatformBalanceCents, 1500); assert.equal(report.platformBalanceVerified, false); assert.equal(report.transferableCents, null); assert.equal(report.profitCents, null); assert.deepEqual(report.missingPayoutFeeIds, ['payout']);
});
const payoutState = () => applyFinance(applyFinance(base(), [upsert('businesses', { id: 'shop', name: 'Shop' }), account('platform', 10000, { type: 'business' })]), { type: 'record_payout', args: { id: 'payout', businessId: 'shop', date, amountCents: 8500, feesCents: 200, currency: 'EUR', fromAccountId: 'platform', toAccountId: 'bank' } });
test('editing a generated payout aligns transfer, fee and business cost atomically, including old manual-source records', () => {
  let state = payoutState(); state.payouts[0].source = 'manual'; delete state.payouts[0].generatedPayout;
  state = applyFinance(state, upsert('transactions', { id: 'payout:withdrawal-fee', categoryId: 'fuel', notes: 'Classification retained' }));
  state = applyFinance(state, upsert('payouts', { id: 'payout', date: '2026-10-13', amountCents: 8000, feesCents: 100 }));
  assert.equal(accountBalance(state, 'bank', '2026-10-13'), 108000); assert.equal(accountBalance(state, 'platform', '2026-10-13'), 1900);
  assert.equal(state.transactions.find(t => t.id === 'payout:transfer').date, '2026-10-13'); assert.equal(state.transactions.find(t => t.id === 'payout:withdrawal-fee').amountCents, 100); assert.equal(state.transactions.find(t => t.id === 'payout:withdrawal-fee').notes, 'Classification retained'); assert.equal(state.businessCosts[0].amountCents, 100); assert.equal(state.payouts[0].source, 'payout');
  state = applyFinance(state, upsert('payouts', { id: 'payout', feesCents: null })); assert.equal(state.businessCosts.length, 0); assert.equal(state.transactions.length, 1); assert.equal(accountBalance(state, 'platform', '2026-10-13'), 2000); assert.equal(businessReport(state, 'shop', period).profitCents, null);
});
test('pending and cancelled payout edits remove cash effects and payout deletion removes only generated records', () => {
  let state = applyFinance(payoutState(), tx('unrelated', 'expense', 1000));
  state = applyFinance(state, upsert('payouts', { id: 'payout', status: 'pending' })); assert.equal(accountBalance(state, 'bank', date), 99000); assert.equal(state.transactions.find(t => t.id === 'payout:transfer').status, 'scheduled'); assert.equal(state.businessCosts.length, 0);
  state = applyFinance(state, upsert('payouts', { id: 'payout', status: 'cancelled' })); assert.equal(state.transactions.length, 1); assert.equal(state.payouts[0].transactionId, null);
  state = applyFinance(state, upsert('payouts', { id: 'payout', status: 'posted' })); assert.equal(state.transactions.length, 3); assert.equal(state.businessCosts.length, 1);
  state = applyFinance(state, { type: 'remove', args: { collection: 'payouts', id: 'payout' } }); assert.deepEqual(state.transactions.map(t => t.id), ['unrelated']); assert.equal(state.businessCosts.length, 0); assert.equal(accountBalance(state, 'bank', date), 99000);
});
test('generated payout and loan money cannot be edited or deleted independently while notes remain editable', () => {
  const payout = payoutState();
  for (const action of [upsert('transactions', { id: 'payout:transfer', amountCents: 1 }), upsert('transactions', { id: 'payout:withdrawal-fee', date: '2026-10-13' }), upsert('businessCosts', { id: 'payout:withdrawal-cost', amountCents: 1 }), { type: 'remove', args: { collection: 'transactions', id: 'payout:transfer' } }, { type: 'remove', args: { collection: 'businessCosts', id: 'payout:withdrawal-cost' } }]) assert.throws(() => applyFinance(payout, action), /payout/);
  let loan = applyFinance(base(), { type: 'receive_loan', args: { id: 'loan', accountId: 'bank', date, amountCents: 10000, counterparty: 'Persona di test' } });
  for (const action of [upsert('transactions', { id: 'loan:received', amountCents: 9000 }), upsert('liabilities', { id: 'loan', amountCents: 9000 }), { type: 'remove', args: { collection: 'transactions', id: 'loan:received' } }, { type: 'remove', args: { collection: 'liabilities', id: 'loan' } }]) assert.throws(() => applyFinance(loan, action), /prestito/);
  loan = applyFinance(loan, [upsert('transactions', { id: 'loan:received', notes: 'Nota corretta', categoryId: 'fuel' }), upsert('liabilities', { id: 'loan', name: 'Nome corretto' })]); assert.equal(loan.transactions[0].notes, 'Nota corretta'); assert.equal(loan.liabilities[0].name, 'Nome corretto'); assert.equal(accountBalance(loan, 'bank', date), 110000);
});
test('external references block deleting a payout instead of cascading into unrelated history', () => {
  const state = applyFinance(payoutState(), tx('fee-refund', 'refund', 50, { accountId: 'platform', linkedTransactionId: 'payout:withdrawal-fee' }));
  assert.throws(() => applyFinance(state, { type: 'remove', args: { collection: 'payouts', id: 'payout' } }), /riferimento/); assert.equal(state.payouts.length, 1); assert.equal(state.transactions.length, 3);
});
test('a single expense cannot be attached twice to business costs', () => {
  const state = applyFinance(base(), [upsert('businesses', { id: 'shop', name: 'Shop' }), tx('cost-tx', 'expense', 1000)]);
  assert.throws(() => applyFinance(state, [upsert('businessCosts', { id: 'one', businessId: 'shop', date, amountCents: 1000, transactionId: 'cost-tx' }), upsert('businessCosts', { id: 'two', businessId: 'shop', date, amountCents: 1000, transactionId: 'cost-tx' })]), /già collegata/);
});
test('granting and collecting a loan changes cash and credits atomically with no false expense/income', () => {
  let state = applyFinance(base(), { type: 'grant_loan', args: { id: 'loan', accountId: 'bank', date, amountCents: 10000, counterparty: 'Persona di test' } });
  assert.equal(accountBalance(state, 'bank', date), 90000); assert.equal(state.receivables[0].amountCents, 10000); assert.equal(netWorth(state, { at: date }).netWorthCents, 100000); assert.equal(financialReport(state, period).expenseCents, 0);
  state = applyFinance(state, { type: 'settle_receivable', args: { id: 'loan', accountId: 'bank', date, amountCents: 4000 } }); assert.equal(accountBalance(state, 'bank', date), 94000); assert.equal(state.receivables[0].amountCents, 6000); assert.equal(financialReport(state, period).incomeCents, 0); assert.equal(netWorth(state, { at: date }).netWorthCents, 100000);
});
test('receiving and repaying a loan separates principal from real interest expense', () => {
  let state = applyFinance(base(), { type: 'receive_loan', args: { id: 'loan', accountId: 'bank', date, amountCents: 10000, counterparty: 'Persona di test' } });
  assert.equal(accountBalance(state, 'bank', date), 110000); assert.equal(netWorth(state, { at: date }).netWorthCents, 100000); assert.equal(financialReport(state, period).incomeCents, 0);
  state = applyFinance(state, { type: 'repay_liability', args: { id: 'loan', accountId: 'bank', date, amountCents: 10000, interestCents: 500 } }); assert.equal(accountBalance(state, 'bank', date), 99500); assert.equal(state.liabilities[0].status, 'settled'); assert.equal(financialReport(state, period).expenseCents, 500); assert.equal(netWorth(state, { at: date }).netWorthCents, 99500);
  assert.throws(() => applyFinance(base(), tx('unpaired', 'credit_received', 10000)), /Debito collegato/);
});
test('repaying a liability linked to a credit card is a transfer and reduces the card debt once', () => {
  let state = applyFinance(base(), [account('card', -10000, { type: 'credit' }), upsert('liabilities', { id: 'statement', name: 'Estratto carta', amountCents: 10000, accountId: 'card' })]);
  assert.equal(netWorth(state, { at: date }).netWorthCents, 90000); state = applyFinance(state, { type: 'repay_liability', args: { id: 'statement', accountId: 'bank', date, amountCents: 10000 } }); assert.equal(accountBalance(state, 'card', date), 0); assert.equal(accountBalance(state, 'bank', date), 90000); assert.equal(financialReport(state, period).expenseCents, 0); assert.equal(netWorth(state, { at: date }).netWorthCents, 90000);
});
test('recurrences remain planned and are idempotent across repeated generation', () => {
  let state = applyFinance(base(), upsert('recurringRules', { id: 'subscription', name: 'Abbonamento', frequency: 'monthly', nextDate: '2026-01-31', currency: 'EUR', template: { type: 'expense', accountId: 'bank', amountCents: 1000, description: 'Servizio' } }));
  assert.equal(nextRecurringDate('2026-01-31', 'monthly'), '2026-02-28'); assert.equal(recurringPreview(state, '2026-03-31').length, 3);
  state = applyFinance(state, { type: 'generate_recurring', args: { through: '2026-03-31' } }); assert.equal(state.transactions.length, 3); assert.equal(state.recurringRules[0].nextDate, '2026-04-30'); assert.equal(accountBalance(state, 'bank', date), 100000);
  state = applyFinance(state, { type: 'generate_recurring', args: { through: '2026-03-31' } }); assert.equal(state.transactions.length, 3);
  state = applyFinance(state, { type: 'cancel_recurring', args: { id: 'subscription', removeScheduled: true } }); assert.equal(state.transactions.length, 0); assert.equal(state.recurringRules[0].active, false);
});
test('generating one selected recurrence leaves other rules and scheduled transactions untouched', () => {
  let state = applyFinance(base(), ['one', 'two'].map(id => upsert('recurringRules', { id, name: id, nextDate: date, frequency: 'monthly', template: { type: 'expense', accountId: 'bank', amountCents: 1000 } })));
  state = applyFinance(state, { type: 'generate_recurring', args: { ruleId: 'one', through: date } }); assert.equal(state.transactions.length, 1); assert.equal(state.transactions[0].recurringRuleId, 'one'); assert.equal(state.recurringRules.find(r => r.id === 'two').nextDate, date);
});
test('same operation identifier never records a second financial transaction', () => {
  const state = applyFinance(base(), tx('expense', 'expense', 2000), 'same-operation'); const next = applyFinance(state, tx('different-id', 'expense', 2000), 'same-operation'); assert.equal(next.transactions.length, 1); assert.equal(accountBalance(next, 'bank', date), 98000);
});
test('repeated import batches deduplicate and a conflicting record cannot overwrite data', () => {
  const payload = { transactions: [{ id: 'imported', type: 'expense', amountCents: 2500, currency: 'EUR', date, accountId: 'bank', source: 'csv', sourceId: 'row-hash' }] }; const action = { type: 'import_batch', args: { batch: { id: 'batch', fileHash: 'hash' }, payload } };
  const state = applyFinance(base(), action); const repeated = applyFinance(state, { ...action, args: { ...action.args, batch: { id: 'second', fileHash: 'hash' } } }); assert.equal(repeated.transactions.length, 1);
  assert.throws(() => mergeFinanceImport(state, { transactions: [{ ...payload.transactions[0], amountCents: 3500 }] }), /in conflitto/);
  const undone = applyFinance(state, { type: 'undo_import', args: { id: 'batch' } }); assert.equal(undone.transactions.length, 0); assert.equal(undone.accounts.length, 2);
});
test('unrecognized metadata survives validated JSON and CSV export without executable formulas', () => {
  const state = applyFinance(base(), tx('expense', 'expense', 2000, { description: '=HYPERLINK("bad")', sourceData: { originalColumn: 'original value' } }));
  const restored = validateFinance(JSON.parse(JSON.stringify(state))); assert.deepEqual(restored.transactions[0].sourceData, { originalColumn: 'original value' }); const csv = exportFinanceCsv(restored); assert.match(csv, /'\=HYPERLINK/); assert.match(csv, /originalColumn/);
});
test('invalid dates, fractional cents, mismatched FX and unresolved references fail atomically', () => {
  const state = base(); for (const action of [tx('fractional', 'expense', 12.5), tx('date', 'expense', 2000, { date: '2026-02-30' }), tx('fx', 'expense', 2000, { currency: 'USD' }), tx('missing', 'expense', 2000, { accountId: 'missing' }), account('debit', 10000, { type: 'debit', includeInLiquidity: true })]) assert.throws(() => applyFinance(state, action));
  assert.equal(state.transactions.length, 0);
});
test('references prevent destructive deletion of an account with transactions', () => {
  const state = applyFinance(base(), tx('expense', 'expense', 2000)); assert.throws(() => applyFinance(state, { type: 'remove', args: { collection: 'accounts', id: 'bank' } }), /riferimento/);
});
test('financial commands propose, require explicit account/date and never save on parsing', () => {
  const state = base(); const incomplete = parseFinanceCommand('Ho speso 24 euro di benzina', state, { now: new Date(`${date}T12:00:00Z`) }); assert.equal(incomplete.handled, true); assert.deepEqual(incomplete.missing, ['date', 'accountId']); assert.equal(incomplete.actions.length, 0);
  const proposal = parseFinanceCommand('Oggi ho speso 24 euro di benzina da Hype', state, { now: new Date(`${date}T12:00:00Z`) }); assert.equal(proposal.actions.length, 1); assert.equal(proposal.actions[0].args.record.amountCents, 2400); assert.equal(proposal.actions[0].args.record.categoryId, 'fuel'); assert.equal(state.transactions.length, 0);
  const updated = applyFinance(state, proposal.actions, 'voice-request'); assert.equal(accountBalance(updated, 'bank', date), 97600);
});
test('visible default account is disclosed, transfer grammar preserves accounting and Etsy stays ambiguous', () => {
  let state = applyFinance(base(), { type: 'settings', args: { settings: { defaultAccountId: 'bank' } } });
  const proposed = parseFinanceCommand('Oggi ho speso 24 euro di benzina', state, { now: new Date(`${date}T12:00:00Z`) }); assert.match(proposed.summary, /conto predefinito/);
  const transfer = parseFinanceCommand('Sposta oggi 100 euro da Hype ai Contanti', state, { now: new Date(`${date}T12:00:00Z`) }); assert.equal(transfer.actions[0].args.record.type, 'transfer'); state = applyFinance(state, transfer.actions); assert.equal(financialReport(state, period).expenseCents, 0);
  assert.deepEqual(parseFinanceCommand('Oggi ho preso 75 euro da Etsy', state).missing, ['businessOperationType']);
});
test('financial commands keep loans, repayments and refunds out of ordinary income and expenses', () => {
  const state = base(); const options = { now: new Date(`${date}T12:00:00Z`) };
  for (const command of ['Oggi ho ricevuto 100 euro in prestito su Hype', 'Oggi ho prestato 100 euro a Marco da Hype', 'Oggi ho pagato 50 euro per restituire il prestito da Hype', 'Oggi ho incassato 50 euro restituiti da Marco su Hype', 'Oggi ho ricevuto 50 euro per un credito incassato su Hype']) {
    const result = parseFinanceCommand(command, state, options);
    assert.equal(result.handled, true, command); assert.deepEqual(result.actions, [], command); assert.deepEqual(result.missing, ['loanOperationType'], command); assert.match(result.message, /Patrimonio/, command);
  }
  for (const command of ['Oggi ho ricevuto 20 euro di rimborso su Hype', 'Oggi ho incassato 20 euro rimborsati su Hype', 'Oggi ho ricevuto uno storno di 20 euro su Hype']) {
    const result = parseFinanceCommand(command, state, options);
    assert.equal(result.handled, true, command); assert.deepEqual(result.actions, [], command); assert.deepEqual(result.missing, ['linkedTransactionId'], command); assert.match(result.message, /spesa originale/, command);
  }
  assert.deepEqual(parseFinanceCommand('Mi hanno restituito il prestito', state, options).missing, ['loanOperationType']);
  assert.deepEqual(parseFinanceCommand('Registra un rimborso', state, options).missing, ['linkedTransactionId']);
  const income = parseFinanceCommand('Oggi ho ricevuto 100 euro di stipendio su Hype', state, options);
  assert.equal(income.actions[0].args.record.type, 'income'); assert.equal(state.transactions.length, 0);
  assert.equal(parseFinanceCommand('Oggi ho speso 20 euro di benzina con la carta di debito Hype', state, options).actions[0].args.record.type, 'expense');
  const read = parseFinanceCommand('Quanto ho speso questo mese dopo i rimborsi?', state, options);
  assert.equal(read.actions.length, 0); assert.equal(read.data.expenseCents, 0);
});
test('tools validate schema and only return proposed writes', () => {
  const state = base(); assert.throws(() => executeFinanceTool('delete_everything', {}, state)); assert.throws(() => executeFinanceTool('get_account_balance', { accountId: 'bank', unexpected: true }, state)); assert.throws(() => executeFinanceTool('propose_transaction', { type: 'expense', date, accountId: 'bank', amountCents: 2.5, currency: 'EUR' }, state));
  assert.equal(executeFinanceTool('get_account_balance', { accountId: 'bank', date }, state).balanceCents, 100000); assert.equal(state.transactions.length, 0);
});
test('business queries calculate a named month from local data and preserve missing-cost warnings', () => {
  const state = applyFinance(base(), [upsert('businesses', { id: 'etsy', name: 'Etsy' }), upsert('orders', { id: 'sale', businessId: 'etsy', date: '2026-09-15', grossCents: 10000, feesCents: 1500, directCostCents: 0 })]); const response = parseFinanceCommand('Quanto ho guadagnato netto con Etsy a settembre 2026?', state);
  assert.equal(response.actions.length, 0); assert.equal(response.data.profitCents, 8500); assert.equal(response.data.start, '2026-09-01'); assert.equal(response.data.end, '2026-09-30');
});
test('housing simulator isolates assumptions from real finance data', () => {
  const state = base(); const result = housingSimulation({ rentCents: 50000, depositCents: 100000, utilitiesCents: 10000, foodCents: 20000, transportCents: 5000, setupCents: 20000, emergencyCents: 100000, stableIncomeCents: 150000, uncertainIncomeCents: 20000, initialCents: 100000 });
  assert.equal(result.monthlyCostCents, 85000); assert.equal(result.entryThresholdCents, 305000); assert.equal(result.monthlyMarginCents, 65000); assert.equal(result.monthsRequired, 4); assert.equal(accountBalance(state, 'bank', date), 100000);
});
test('finance repository refuses unavailable storage rather than claiming success', async () => {
  const repo = new FinanceRepository({ indexedDB: null }); await assert.rejects(repo.load(), /non disponibile/); await assert.rejects(repo.save(emptyFinance()), /non disponibile/);
});
