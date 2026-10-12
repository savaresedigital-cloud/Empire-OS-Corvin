import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, CircleHelp, Pencil, Plus, Trash2, Wallet, X } from 'lucide-react';
import { accountBalanceDetails, applyFinance, financeDay, goalProjection, housingSimulation, moneyToCents, netWorth, validFinanceDay } from './finance-domain.js';
import './finance-wealth.css';
import { WealthProgress } from './finance-insights.jsx';

const money = (value, currency = 'EUR') => value === null || value === undefined ? '—' : new Intl.NumberFormat('it-IT', { style: 'currency', currency }).format(value / 100);
const amountInput = value => { if (value === null || value === undefined) return ''; const absolute = BigInt(value < 0 ? -value : value); return `${value < 0 ? '-' : ''}${absolute / 100n},${String(absolute % 100n).padStart(2, '0')}`; };
const nameOf = (rows, id) => rows.find(r => r.id === id)?.name ?? 'Riferimento non disponibile';
const accountOptions = (state, currency) => state.accounts.filter(a => a.active && a.currency === currency && !['debit', 'aggregate'].includes(a.type));
function Stat({ label, value, currency, note }) { return <article className="finance-stat"><span>{label}</span><strong>{money(value, currency)}</strong>{note && <small>{note}</small>}</article>; }
function Empty({ text, action, onClick }) { return <div className="finance-empty"><Wallet size={25} strokeWidth={1.3}/><p>{text}</p>{action && <button className="button secondary" onClick={onClick}><Plus size={15}/>{action}</button>}</div>; }
function Field({ label, children, hint }) { return <label>{label}{children}{hint && <small className="finance-muted">{hint}</small>}</label>; }
function Dialog({ title, close, children }) {
  const ref = useRef(null);
  useEffect(() => { const element = ref.current; element.showModal(); return () => element.close(); }, []);
  return <dialog ref={ref} className="modal finance-loan-dialog" onCancel={close} onClick={e => { if (e.target === ref.current) close(); }}><header><h2>{title}</h2><button className="icon-button" onClick={close} aria-label="Chiudi finestra"><X size={20}/></button></header>{children}</dialog>;
}
function LoanForm({ kind, record, state, currency, request, close }) {
  const code = record?.currency ?? currency;
  const options = accountOptions(state, code);
  const preferred = options.find(a => a.id === state.settings.defaultAccountId)?.id ?? '';
  const [values, setValues] = useState({ date: financeDay(), accountId: preferred, amount: amountInput(record?.amountCents), counterparty: '', name: '', interest: '0', dueDate: '' });
  const [error, setError] = useState('');
  const titles = { grant: 'Registra prestito concesso', receive: 'Registra prestito ricevuto', settle: 'Incassa credito', repay: 'Rimborsa debito' };
  const set = (key, value) => { setValues(current => ({ ...current, [key]: value })); setError(''); };
  function submit(event) {
    event.preventDefault();
    try {
      if (!validFinanceDay(values.date)) throw new Error('Indica una data valida.');
      if (!values.accountId) throw new Error('Seleziona il conto effettivo.');
      const amountCents = moneyToCents(values.amount); if (amountCents <= 0) throw new Error('L’importo deve essere maggiore di zero.');
      const common = { date: values.date, accountId: values.accountId, amountCents, currency: code };
      let action;
      if (kind === 'grant' || kind === 'receive') {
        if (!values.counterparty.trim()) throw new Error('Indica la controparte del prestito.');
        action = { type: kind === 'grant' ? 'grant_loan' : 'receive_loan', args: { ...common, counterparty: values.counterparty.trim(), ...(values.name.trim() ? { name: values.name.trim() } : {}), dueDate: values.dueDate || null } };
      } else if (kind === 'settle') action = { type: 'settle_receivable', args: { ...common, id: record.id } };
      else action = { type: 'repay_liability', args: { ...common, id: record.id, interestCents: moneyToCents(values.interest) } };
      applyFinance(state, action);
      close(); request(action, titles[kind]);
    } catch (error) { setError(error.message); }
  }
  return <Dialog title={titles[kind]} close={close}><form className="finance-form" onSubmit={submit}>
    {record && <p className="field-help">{record.name} · Capitale residuo {money(record.amountCents, code)}</p>}
    <div className="form-grid"><Field label="Data operazione"><input type="date" required value={values.date} onInput={e => set('date', e.currentTarget.value)} onChange={e => set('date', e.target.value)}/></Field>
      <Field label={kind === 'grant' || kind === 'repay' ? 'Conto di addebito' : 'Conto di accredito'}><select required value={values.accountId} onChange={e => set('accountId', e.target.value)}><option value="">Seleziona conto</option>{options.map(a => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}</select></Field>
      <Field label={`Capitale (${code})`}><input required inputMode="decimal" value={values.amount} onChange={e => set('amount', e.target.value)} placeholder="Importo"/></Field>
      {kind === 'repay' && <Field label={`Interessi e costi effettivi (${code})`} hint="Separati dal capitale, contabilizzati come spesa."><input required inputMode="decimal" value={values.interest} onChange={e => set('interest', e.target.value)}/></Field>}
    </div>
    {(kind === 'grant' || kind === 'receive') && <><Field label="Controparte"><input required maxLength={500} value={values.counterparty} onChange={e => set('counterparty', e.target.value)} placeholder="Nome della persona o dell’istituto"/></Field><Field label="Descrizione facoltativa"><input maxLength={500} value={values.name} onChange={e => set('name', e.target.value)} placeholder="Descrizione del prestito"/></Field><Field label="Scadenza facoltativa"><input type="date" value={values.dueDate} onInput={e => set('dueDate', e.currentTarget.value)} onChange={e => set('dueDate', e.target.value)}/></Field></>}
    <p className="field-help">{kind === 'grant' ? 'Il pagamento riduce il saldo e crea un credito. Il capitale prestato non è una spesa economica.' : kind === 'receive' ? 'L’accredito aumenta il saldo e crea un debito. Il capitale ricevuto non è reddito.' : kind === 'settle' ? 'L’incasso aumenta il saldo e riduce il credito. Il capitale riscosso non è una nuova entrata economica.' : 'Il pagamento riduce il saldo e il debito residuo. Solo gli interessi e i costi sono spesa economica.'}</p>
    {!options.length && <div className="finance-alert" role="alert">Registra prima un conto in {code}. Le carte collegate e i prospetti aggregati non sono conti effettivi.</div>}
    {error && <p className="finance-alert error" role="alert">{error}</p>}
    <footer><button className="button ghost" type="button" onClick={close}>Annulla</button><button className="button primary" disabled={!options.length}>Controlla operazione</button></footer>
  </form></Dialog>;
}

function historicalWealth(state, currency, period) {
  const dates = new Set();
  const add = value => { if (validFinanceDay(value) && value >= period.start && value <= period.end) dates.add(value); };
  state.balanceSnapshots.filter(s => s.currency === currency).forEach(s => add(s.date));
  state.assetValuations.filter(s => s.currency === currency).forEach(s => add(s.date));
  state.assets.filter(s => s.currency === currency).forEach(s => add(s.valuationDate));
  state.holdings.filter(s => s.currency === currency).forEach(s => add(s.valuationDate));
  state.accounts.filter(s => s.currency === currency && s.openingCents !== null).forEach(s => add(s.openingDate));
  state.transactions.filter(s => s.currency === currency && s.status === 'posted').forEach(s => add(s.date));
  // Residual debts/credits and sold assets have no immutable valuation history in this schema.
  // A current balance must never be presented as an observed historical value.
  const currentOnly = state.receivables.some(s => s.currency === currency) || state.liabilities.some(s => s.currency === currency) || state.assets.some(s => s.currency === currency && s.status !== 'owned');
  const rows = [...dates].sort().map(date => {
    const calculated = netWorth(state, { at: date, currency });
    const historyUnavailable = currentOnly && date < financeDay();
    return { date, valueCents: historyUnavailable ? null : calculated.netWorthCents, estimated: calculated.estimated.length > 0, missing: calculated.missing.length, historyUnavailable };
  });
  return { rows, currentOnly };
}
function WealthHistory({ state, currency, period }) {
  const { rows, currentOnly } = useMemo(() => historicalWealth(state, currency, period), [state, currency, period.start, period.end]);
  const known = rows.filter(r => r.valueCents !== null); const max = Math.max(1, ...known.map(r => Math.abs(r.valueCents))); const width = 760; const height = 170; const baseline = height / 2;
  const positions = rows.map((r, i) => ({ ...r, x: 26 + (rows.length > 1 ? i / (rows.length - 1) : .5) * (width - 52), y: r.valueCents === null ? null : baseline - r.valueCents / max * (height / 2 - 20) }));
  const segments = []; let current = [];
  positions.forEach(r => { if (r.valueCents === null) { if (current.length) segments.push(current); current = []; } else current.push(r); }); if (current.length) segments.push(current);
  return <section className="finance-card"><header><h2>Patrimonio alle date registrate</h2><span className="finance-muted">{period.start} — {period.end} · {currency}</span></header>
    {currentOnly && <p className="finance-alert"><CircleHelp size={16}/><span>Crediti, passività o beni dismessi hanno valori correnti. I totali passati non vengono ricostruiti senza uno storico completo.</span></p>}
    {known.length ? <div className="wealth-history-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Patrimonio alle date registrate: ${known.map(r => `${r.date} ${money(r.valueCents, currency)}${r.estimated ? ' con stime' : ''}`).join('; ')}`}>
      <line x1="14" x2={width - 14} y1={baseline} y2={baseline} className="wealth-zero"/>
      {segments.filter(s => s.length > 1).map((s, i) => <polyline key={i} points={s.map(r => `${r.x},${r.y}`).join(' ')} fill="none" className="wealth-history-line"/>)}
      {positions.filter(r => r.valueCents !== null).map(r => <circle key={r.date} cx={r.x} cy={r.y} r="4" className="wealth-history-point"><title>{r.date}: {money(r.valueCents, currency)}{r.estimated ? ' · include stime' : ''}</title></circle>)}
    </svg><div className="wealth-history-labels"><span>{rows[0].date}</span><span>{money(max, currency)} / {money(-max, currency)}</span><span>{rows[rows.length - 1].date}</span></div></div> : <p className="finance-muted">Nessun totale storico completo nel periodo selezionato.</p>}
    <p className="finance-muted">Calcoli alle date con movimenti, saldi o valutazioni registrati. I periodi mancanti restano non disponibili.</p>
    {!!rows.length && <details><summary>Dati e copertura dello storico ({rows.length} date)</summary><div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>Data</th><th>Patrimonio netto</th><th>Qualità del dato</th></tr></thead><tbody>{rows.map(r => <tr key={r.date}><td>{r.date}</td><td>{money(r.valueCents, currency)}</td><td>{r.historyUnavailable ? 'Residui storici non disponibili' : r.missing ? `${r.missing} valori mancanti` : r.estimated ? 'Include stime datate' : 'Saldi registrati'}</td></tr>)}</tbody></table></div></details>}
  </section>;
}

export function Wealth({ state, currency = 'EUR', period = { start: `${financeDay().slice(0, 7)}-01`, end: financeDay() }, edit, request, execute }) {
  const [section, setSection] = useState('assets'); const [loan, setLoan] = useState(null);
  const worth = netWorth(state, { at: period.end, currency });
  const config = { assets: 'Beni materiali', holdings: 'Investimenti', receivables: 'Crediti', liabilities: 'Passività' };
  const rows = state[section].filter(r => r.currency === currency);
  const noRecords = !['accounts', 'assets', 'holdings', 'receivables', 'liabilities'].some(c => state[c].some(r => r.currency === currency));
  const hasCash = state.accounts.some(a => a.currency === currency && a.active && !['crypto', 'investment', 'debit', 'aggregate'].includes(a.type));
  const hasInvestments = state.holdings.some(a => a.currency === currency) || state.accounts.some(a => a.currency === currency && a.active && ['crypto', 'investment'].includes(a.type));
  const hasAssets = state.assets.some(a => a.currency === currency && a.status === 'owned');
  const missingAccounts = worth.missing.filter(r => r.startsWith('account:') && state.accounts.some(a => a.id === r.slice(8) && !['crypto', 'investment', 'debit', 'aggregate'].includes(a.type))); const missingAssets = worth.missing.filter(r => r.startsWith('asset:')); const missingHoldings = worth.missing.filter(r => r.startsWith('holding:') || r.startsWith('account:') && state.accounts.some(a => a.id === r.slice(8) && ['crypto', 'investment'].includes(a.type)));
  const missingName = reference => { const separator = reference.indexOf(':'); const type = reference.slice(0, separator); const id = reference.slice(separator + 1); return nameOf(state[{ account: 'accounts', asset: 'assets', holding: 'holdings' }[type]] ?? [], id); };
  const stats = [
    ['Liquidità', !hasCash || missingAccounts.length ? null : worth.liquidityCents, missingAccounts.length ? `Parziale noto ${money(worth.liquidityCents, currency)}` : `Conti registrati · ${period.end}`],
    ['Investimenti', !hasInvestments || missingHoldings.length ? null : worth.investmentsCents, missingHoldings.length ? 'Valutazioni mancanti' : 'Valori manuali con data'],
    ['Beni materiali stimati', !hasAssets || missingAssets.length ? null : worth.assetsCents, missingAssets.length ? 'Stime mancanti' : 'Esclusi dalla liquidità'],
    ['Patrimonio netto stimato', noRecords ? null : worth.netWorthCents, 'Attività meno passività'],
  ];
  return <div className="finance-wealth"><WealthProgress {...{state,currency,execute}}/><div className="finance-stats">{stats.map(([label, value, note]) => <Stat key={label} {...{ label, value, currency, note }}/>)}</div>
    {!!worth.missing.length && <div className="finance-alert"><CircleHelp size={17}/><div><strong>Patrimonio incompleto</strong><p>Valori non disponibili: {worth.missing.map(missingName).join(', ')}. Il patrimonio netto complessivo resta non disponibile.</p><small>Totale parziale noto: {money(worth.knownNetWorthCents, currency)}.</small></div></div>}
    {!!worth.estimated.length && <details className="wealth-estimates"><summary>Valutazioni incluse ({worth.estimated.length})</summary><div className="finance-rows">{worth.estimated.map(v => <div className="finance-row" key={`${v.kind}:${v.id}`}><span>{nameOf(v.kind === 'asset' ? state.assets : state.holdings, v.id)}<small>{v.date} · {v.source || 'manuale'}</small></span><span className="finance-chip warning">{v.date < period.start ? 'Valutazione precedente al periodo' : 'Stima manuale'}</span></div>)}</div></details>}
    <div className="finance-toolbar"><div className="area-tabs" role="tablist" aria-label="Tipologie patrimonio">{Object.entries(config).map(([id, label]) => <button role="tab" aria-selected={section === id} className={section === id ? 'active' : ''} key={id} onClick={() => setSection(id)}>{label}</button>)}</div><button className="button secondary" onClick={() => edit(section)}><Plus size={16}/>Aggiungi {section === 'assets' ? 'bene' : section === 'holdings' ? 'investimento' : section === 'receivables' ? 'credito' : 'passività'}</button></div>
    {(section === 'receivables' || section === 'liabilities') && <div className="finance-toolbar wealth-loan-toolbar"><p className="finance-muted">Registra insieme movimento del conto e capitale residuo.</p><button className="button secondary" onClick={() => setLoan({ kind: section === 'receivables' ? 'grant' : 'receive' })}>{section === 'receivables' ? <ArrowUpFromLine size={15}/> : <ArrowDownToLine size={15}/>}Registra prestito {section === 'receivables' ? 'concesso' : 'ricevuto'}</button></div>}
    <section className="finance-card"><header><h2>{config[section]}</h2><span className="finance-muted">{section === 'assets' || section === 'holdings' ? 'Valori manuali · nessuna quotazione live' : 'Capitale residuo · non è denaro disponibile'}</span></header>
      {rows.length ? <div className="finance-rows">{rows.map(r => <div className="finance-row wealth-record-row" key={r.id}><div><strong>{r.name}</strong><small>{r.category || r.counterparty || r.symbol || ''}{r.valuationDate ? ` · Valutazione ${r.valuationDate}` : ''}{r.status ? ` · ${{ open: 'Aperto', settled: 'Saldato', cancelled: 'Annullato', owned: 'Posseduto', sold: 'Venduto', archived: 'Archiviato' }[r.status] ?? r.status}` : ''}</small>{r.ownershipBps !== undefined && r.ownershipBps !== 10000 && <small>Quota di proprietà {r.ownershipBps / 100}%</small>}{r.valuationDate && r.valuationDate < period.start && <small className="finance-negative">Valutazione precedente al periodo</small>}</div><strong>{money(r.valueCents ?? r.amountCents, currency)}</strong><div className="finance-actions">
        {section === 'receivables' && r.status === 'open' && r.amountCents > 0 && <button className="button ghost" onClick={() => setLoan({ kind: 'settle', record: r })}>Incassa</button>}
        {section === 'liabilities' && r.status === 'open' && r.amountCents > 0 && <button className="button ghost" onClick={() => setLoan({ kind: 'repay', record: r })}>Rimborsa</button>}
        <button className="icon-button" aria-label={`Modifica ${r.name}`} onClick={() => edit(section, r)}><Pencil size={15}/></button><button className="icon-button danger-text" aria-label={`Elimina ${r.name}`} onClick={() => request({ type: 'remove', args: { collection: section, id: r.id } }, 'Elimina registrazione')}><Trash2 size={15}/></button>
      </div></div>)}</div> : <Empty text={`Nessuna registrazione in ${config[section].toLocaleLowerCase('it')}.`}/>}
    </section>
    <section className="finance-card"><header><h2>Composizione del patrimonio</h2><span className="finance-muted">{currency} · quota di proprietà applicata</span></header><div className="finance-rows">{[
      ['Liquidità', !hasCash || missingAccounts.length ? null : worth.liquidityCents], ['Investimenti', !hasInvestments || missingHoldings.length ? null : worth.investmentsCents], ['Beni stimati', !hasAssets || missingAssets.length ? null : worth.assetsCents], ['Crediti', noRecords ? null : worth.receivablesCents], ['Totale attività', worth.missing.length || noRecords ? null : worth.totalAssetsCents], ['Passività', noRecords ? null : worth.liabilitiesCents], ['Patrimonio netto', noRecords ? null : worth.netWorthCents],
    ].map(([label, value]) => <div className="finance-row" key={label}><span>{label}</span><strong>{money(value, currency)}</strong></div>)}</div><p className="finance-muted">Totali delle registrazioni presenti. Stime dei beni e crediti non riscossi non sono liquidità. Le valutazioni collegate a conti o holdings non vengono aggiunte due volte.</p></section>
    <WealthHistory {...{ state, currency, period }}/>
    <section className="finance-card"><header><h2>Valutazioni storiche dei beni</h2><button className="button ghost" onClick={() => edit('assetValuations')}>Registra valutazione</button></header>{state.assetValuations.some(v => v.currency === currency) ? <div className="finance-rows">{state.assetValuations.filter(v => v.currency === currency).sort((a, b) => b.date.localeCompare(a.date)).map(v => <div className="finance-row" key={v.id}><span>{nameOf(state.assets, v.assetId)}<small>{v.date} · {v.valuationSource || v.source}</small></span><strong>{money(v.valueCents, v.currency)}</strong><div className="finance-actions"><button className="icon-button" aria-label={`Modifica valutazione ${nameOf(state.assets, v.assetId)} del ${v.date}`} onClick={() => edit('assetValuations', v)}><Pencil size={15}/></button><button className="icon-button danger-text" aria-label={`Elimina valutazione del ${v.date}`} onClick={() => request({ type: 'remove', args: { collection: 'assetValuations', id: v.id } }, 'Elimina valutazione')}><Trash2 size={15}/></button></div></div>)}</div> : <p className="finance-muted">Nessuna valutazione storica registrata.</p>}</section>
    {loan && <LoanForm {...{ state, currency, request }} {...loan} close={() => setLoan(null)}/>}
  </div>;
}

function GoalCard({ goal, state, currency, period, edit, setModal, request }) {
  const [monthly, setMonthly] = useState(''); const [scenario, setScenario] = useState(null); const [error, setError] = useState('');
  const at = period?.end ?? financeDay(); const projection = goalProjection(state, goal.id, { at });
  const allocations = state.goalAllocations.filter(a => a.goalId === goal.id && a.date <= at);
  const unverifiedAccountIds = [...new Set(allocations.filter(a => !accountBalanceDetails(state, a.accountId, at).verified).map(a => a.accountId))];
  const verifiedFunding = projection.fundedCents === null || unverifiedAccountIds.length ? null : projection.fundedCents;
  const allAllocations = state.goalAllocations.filter(a => a.goalId === goal.id);
  function project(event) { event.preventDefault(); try { if (!monthly.trim()) throw new Error('Indica l’accantonamento mensile da simulare.'); const value = moneyToCents(monthly); if (value <= 0) throw new Error('L’accantonamento mensile deve essere maggiore di zero.'); const base = goalProjection(state, goal.id, { monthlyCents: value, at }); setScenario(base); setError(''); } catch (e) { setError(e.message); setScenario(null); } }
  return <article className="finance-record wealth-goal-card"><header><span className="finance-chip">{goal.active === false ? 'Inattivo' : goal.targetDate || 'Senza scadenza'}</span><button className="icon-button" aria-label={`Modifica obiettivo ${goal.name}`} onClick={() => edit('goals', goal)}><Pencil size={15}/></button></header><h2>{goal.name}</h2>
    <dl><div><dt>Target</dt><dd>{money(goal.targetCents, currency)}</dd></div><div><dt>Allocazioni virtuali</dt><dd>{money(projection.allocatedCents, currency)}</dd></div><div><dt>Fondi verificati</dt><dd>{money(verifiedFunding, currency)}</dd></div><div><dt>Residuo sulle allocazioni</dt><dd>{money(projection.remainingCents, currency)}</dd></div></dl>
    <div className={`progress-track ${verifiedFunding === null ? 'wealth-progress-unverified' : ''}`} aria-label={`Allocazioni virtuali ${Math.round(projection.ratio * 100)}% del target`}><span style={{ width: `${Math.max(0, Math.min(100, projection.ratio * 100))}%` }}/></div><small className="finance-muted">Le allocazioni non trasferiscono denaro e non aumentano il patrimonio.</small>
    {projection.unsupportedAccountIds.length > 0 ? <p className="finance-alert"><CircleHelp size={16}/><span>Fondi insufficienti o saldi sconosciuti su {projection.unsupportedAccountIds.map(id => nameOf(state.accounts, id)).join(', ')}. Le allocazioni restano registrate, il progresso finanziato non è verificabile.</span></p> : unverifiedAccountIds.length > 0 ? <p className="finance-alert"><CircleHelp size={16}/><span>Allocazioni coperte dai saldi inseriti, ancora da riconciliare: {unverifiedAccountIds.map(id => nameOf(state.accounts, id)).join(', ')}.</span></p> : null}
    {projection.requiredMonthlyCents !== null && <p className="finance-muted">Accantonamento mensile necessario sulle allocazioni attuali: {money(projection.requiredMonthlyCents, currency)}.</p>}
    <div className="button-row"><button className="button secondary" onClick={() => setModal({ kind: 'allocate', record: goal })}>Alloca fondi</button><button className="text-button danger-text" onClick={() => request({ type: 'remove', args: { collection: 'goals', id: goal.id } }, 'Elimina obiettivo')}>Elimina</button></div>
    <details><summary>Allocazioni ({allAllocations.length})</summary>{allAllocations.map(a => <div className="finance-row" key={a.id}><span>{a.date}<small>{nameOf(state.accounts, a.accountId)}{a.date > at ? ' · successiva al periodo' : ''}</small></span><strong>{money(a.amountCents, currency)}</strong><button className="icon-button danger-text" aria-label={`Rimuovi allocazione del ${a.date}`} onClick={() => request({ type: 'remove', args: { collection: 'goalAllocations', id: a.id } }, 'Rimuovi allocazione')}><X size={14}/></button></div>)}</details>
    <details><summary>Simula accantonamento mensile</summary><form className="wealth-goal-scenario" onSubmit={project}><Field label={`Accantonamento mensile (${currency})`}><input inputMode="decimal" required value={monthly} onChange={e => { setMonthly(e.target.value); setScenario(null); setError(''); }} placeholder="Importo mensile"/></Field><button className="button ghost">Calcola scenario</button></form>{error && <p role="alert" className="finance-alert error">{error}</p>}{scenario && <p role="status" className="finance-muted">Simulazione: {scenario.projectedMonths} mesi con {money(scenario.monthlyCents, currency)} al mese, partendo dalle allocazioni virtuali attuali. {verifiedFunding === null ? 'Il capitale iniziale non è verificato. ' : ''}La proiezione non modifica i saldi.</p>}</details>
  </article>;
}
export function Goals({ state, currency = 'EUR', period, edit, setModal, request }) {
  const goals = state.goals.filter(g => g.currency === currency);
  return <><div className="finance-toolbar"><h2>Obiettivi di risparmio</h2><button className="button secondary" onClick={() => edit('goals')}><Plus size={16}/>Nuovo obiettivo</button></div><div className="finance-record-grid">{goals.map(goal => <GoalCard key={goal.id} {...{ goal, state, currency, period, edit, setModal, request }}/>)}</div>{!goals.length && <section className="finance-card"><Empty text={`Nessun obiettivo impostato in ${currency}. Aggiungi un target e scegli quali fondi allocare.`} action="Nuovo obiettivo" onClick={() => edit('goals')}/></section>}<Simulator currency={currency}/></>;
}

const simulationFields = [
  ['rentCents', 'Affitto mensile'], ['depositCents', 'Cauzione'], ['setupCents', 'Spese iniziali una tantum'], ['utilitiesCents', 'Utenze mensili'], ['foodCents', 'Alimentari mensili'], ['transportCents', 'Trasporti mensili'], ['otherMonthlyCents', 'Altre spese mensili'], ['stableIncomeCents', 'Entrate stabili mensili'], ['uncertainIncomeCents', 'Extra incerti mensili'], ['emergencyCents', 'Fondo imprevisti'], ['initialCents', 'Saldo iniziale confermato'], ['monthlySavingCents', 'Accantonamento mensile previsto'],
];
export function Simulator({ currency = 'EUR' }) {
  const [values, setValues] = useState(() => Object.fromEntries(simulationFields.map(([id]) => [id, '']))); const [result, setResult] = useState(null); const [error, setError] = useState('');
  const incomplete = simulationFields.some(([id]) => !values[id].trim());
  function calculate(event) {
    event.preventDefault();
    try {
      const parsed = {};
      for (const [id, label] of simulationFields) { if (!values[id].trim()) throw new Error(`${label}: inserisci un importo, anche 0 se non previsto.`); try { parsed[id] = moneyToCents(values[id]); } catch (e) { throw new Error(`${label}: ${e.message}`); } if (parsed[id] < 0) throw new Error(`${label}: l’importo non può essere negativo.`); }
      setResult(housingSimulation(parsed)); setError('');
    } catch (error) { setError(error.message); setResult(null); }
  }
  return <section className="finance-card wealth-simulator"><header><div><h2>Simulatore autonomia abitativa</h2><p className="finance-muted">Ipotesi manuali in {currency}. I campi vuoti non valgono zero.</p></div><span className="finance-chip neutral">Simulazione</span></header><form onSubmit={calculate} noValidate><div className="wealth-simulator-fields">{simulationFields.map(([id, label]) => <Field key={id} label={`${label} (${currency})`}><input required inputMode="decimal" value={values[id]} placeholder="Da inserire" onChange={e => { setValues(current => ({ ...current, [id]: e.target.value })); setResult(null); setError(''); }}/></Field>)}</div><div className="button-row"><button className="button secondary">Calcola simulazione</button><button className="button ghost" type="button" onClick={() => { setValues(Object.fromEntries(simulationFields.map(([id]) => [id, '']))); setResult(null); setError(''); }}>Svuota campi</button></div>{incomplete && !error && <p className="finance-muted wealth-simulator-help">Completa tutti i valori. Inserisci 0 soltanto per costi o entrate che vuoi escludere esplicitamente.</p>}{error && <p role="alert" className="finance-alert error">{error}</p>}</form>
    <div className="finance-stats wealth-simulator-results"><Stat label="Costo mensile" value={result?.monthlyCostCents ?? null} currency={currency}/><Stat label="Soglia di ingresso" value={result?.entryThresholdCents ?? null} currency={currency} note="Cauzione, costi iniziali, imprevisti e primo mese"/><Stat label="Margine mensile stabile" value={result?.monthlyMarginCents ?? null} currency={currency} note="Extra incerti esclusi"/><article className="finance-stat"><span>Mesi stimati</span><strong>{result?.monthsRequired ?? '—'}</strong><small>{result?.monthsRequired === null ? 'Accantonamento insufficiente per raggiungere la soglia' : 'Secondo l’accantonamento mensile inserito'}</small></article></div>
    {result && <div className="finance-summary"><span>Capitale ancora necessario <strong>{money(result.remainingCents, currency)}</strong></span><span>Margine con extra incerti <strong>{money(result.marginWithUncertainIncomeCents, currency)}</strong></span></div>}
    <p className="finance-muted">La simulazione non modifica conti, obiettivi o patrimonio e non garantisce la sostenibilità futura.</p>
  </section>;
}
