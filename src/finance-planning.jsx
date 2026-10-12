import React, { useState } from 'react';
import { Compass, Save, ArrowRight } from 'lucide-react';
import { financeDay, financialReport, moneyToCents } from './finance-domain.js';
import { euro } from './empire-metrics.js';
import { planningBasis, projectCash, periodLabel } from './finance-planning.js';

const decimal = value => value == null ? '' : String(value / 100).replace('.', ',');
const monthLabel = date => new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));

export function CashPlanning({ state, currency, execute }) {
  const today = financeDay(), basis = planningBasis(state, { at: today, currency });
  const defaultSources = basis.sources.filter(r => r.businessId).map(r => r.id);
  const average = ids => Math.round(basis.sources.filter(r => ids.includes(r.id)).reduce((n, r) => n + r.totalCents, 0) / basis.months);
  const report = financialReport(state, { start: today, end: today, currency });
  const [sources, setSources] = useState(defaultSources), [name, setName] = useState('Piano dei prossimi mesi');
  const [income, setIncome] = useState(decimal(average(defaultSources))), [expense, setExpense] = useState(decimal(basis.expenseCents));
  const [extraIncome, setExtraIncome] = useState('0'), [extraExpense, setExtraExpense] = useState('0');
  const [starting, setStarting] = useState(decimal(report.liquidityCents)), [months, setMonths] = useState(6);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  let rows = [], issue = '';
  try { rows = projectCash({ incomeCents: moneyToCents(income), expenseCents: moneyToCents(expense), extraIncomeCents: moneyToCents(extraIncome), extraExpenseCents: moneyToCents(extraExpense), startingCents: starting.trim() ? moneyToCents(starting) : null, months, from: today }); } catch (error) { issue = error.message; }
  const end = rows.at(-1), saved = (state.settings.cashScenarios || []).filter(s => s.currency === currency);
  function selectSource(id, checked) {
    const ids = checked ? [...sources, id] : sources.filter(v => v !== id);
    setSources(ids); setIncome(decimal(average(ids))); setMessage('');
  }
  async function save() {
    if (issue || !name.trim()) return;
    setBusy(true); setMessage('');
    const record = { id: saved.find(s => s.name === name.trim())?.id || crypto.randomUUID(), name: name.trim(), currency, from: today, months, incomeCents: moneyToCents(income), expenseCents: moneyToCents(expense), extraIncomeCents: moneyToCents(extraIncome), extraExpenseCents: moneyToCents(extraExpense), startingCents: starting.trim() ? moneyToCents(starting) : null, sourceIds: sources, basis: basis.period };
    try { const ok = await execute({ type: 'settings', args: { settings: { cashScenarios: [...(state.settings.cashScenarios || []).filter(s => s.id !== record.id), record] } } }, 'Prospetto salvato'); if (ok !== false) setMessage('Prospetto salvato. Le ipotesi restano modificabili.'); } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  function load(record) {
    setName(record.name); setIncome(decimal(record.incomeCents)); setExpense(decimal(record.expenseCents)); setExtraIncome(decimal(record.extraIncomeCents)); setExtraExpense(decimal(record.extraExpenseCents)); setStarting(decimal(record.startingCents)); setMonths(record.months); setSources(record.sourceIds || []); setMessage(`Ipotesi riprese dal prospetto del ${record.from}. La simulazione parte dal prossimo mese.`);
  }
  return <section className="panel cash-planning" id="prospetti">
    <header><div><span className="section-eyebrow"><Compass size={14}/>PROSPETTI</span><h2>Se continuo così, cosa cambia?</h2></div><span className="quiet-badge">Scenario modificabile</span></header>
    <p className="planning-intro">Ripeti un’ipotesi mensile, aggiungi un lavoro o una spesa e confronta il risultato. È una simulazione, non denaro già incassato.</p>
    <details className="planning-basis" open><summary>Da quali dati parto · {periodLabel(basis.period)}</summary><p>Media degli ultimi tre mesi conclusi. Ho incluso le fonti già collegate ai business; puoi includere le altre o scrivere un importo diverso.</p>{basis.partialArchive && <p className="planning-warning">Lo storico non copre tutto il periodo: {basis.earliest ? 'primo movimento disponibile ' + basis.earliest : 'nessun movimento disponibile'}. Controlla le ipotesi.</p>}<div className="planning-sources">{basis.sources.map(r => <label key={r.id}><input type="checkbox" checked={sources.includes(r.id)} onChange={e => selectSource(r.id, e.target.checked)}/><span>{r.name}<small>{euro(r.totalCents, currency)} ricevuti in tre mesi</small></span><strong>{euro(r.monthlyCents, currency)}<small>/ mese, media</small></strong></label>)}</div></details>
    <div className="planning-fields">
      <label>Entrate ipotizzate al mese<input inputMode="decimal" value={income} onChange={e => setIncome(e.target.value)}/><small>Media selezionata o importo scelto da te · {currency}</small></label>
      <label>Spese ipotizzate al mese<input inputMode="decimal" value={expense} onChange={e => setExpense(e.target.value)}/><small>Media storica, al netto dei rimborsi · {currency}</small></label>
      <label>Nuove entrate al mese<input inputMode="decimal" value={extraIncome} onChange={e => setExtraIncome(e.target.value)}/><small>Per esempio un nuovo cliente · {currency}</small></label>
      <label>Nuove spese al mese<input inputMode="decimal" value={extraExpense} onChange={e => setExtraExpense(e.target.value)}/><small>Per esempio un abbonamento o un affitto · {currency}</small></label>
      <label>Saldo di partenza, facoltativo<input inputMode="decimal" placeholder="Da completare" value={starting} onChange={e => setStarting(e.target.value)}/><small>{report.liquidityCents === null ? 'Saldo totale non documentato: inseriscilo tu o lascia vuoto.' : 'Saldo documentato di oggi, modificabile.'}</small></label>
      <label>Per quanti mesi<select value={months} onChange={e => setMonths(Number(e.target.value))}>{[3, 6, 12, 24].map(n => <option key={n} value={n}>{n} mesi interi</option>)}</select><small>Dal prossimo mese, senza estrapolare quello in corso.</small></label>
    </div>
    {issue ? <p className="form-error" role="alert">{issue}</p> : <><div className="planning-result"><div><small>DIFFERENZA OGNI MESE</small><strong>{euro(end.net, currency)}</strong></div><div><small>{end.cumulative >= 0 ? 'AGGIUNGERESTI NEL PERIODO' : 'CONSUMERESTI NEL PERIODO'}</small><strong>{euro(Math.abs(end.cumulative), currency)}</strong></div><div><small>SALDO A {monthLabel(end.date).toUpperCase()}</small><strong>{euro(end.balance, currency)}</strong><span>{end.balance === null ? 'Serve il saldo di partenza' : 'Nello scenario scelto'}</span></div></div><details className="planning-table"><summary>Vedi mese per mese</summary><div className="planning-table-scroll"><table><thead><tr><th>Mese</th><th>Entrate</th><th>Spese</th><th>Differenza cumulata</th><th>Saldo ipotizzato</th></tr></thead><tbody>{rows.map(row => <tr key={row.date}><td>{monthLabel(row.date)}</td><td>{euro(row.income, currency)}</td><td>{euro(row.expense, currency)}</td><td>{euro(row.cumulative, currency)}</td><td>{euro(row.balance, currency)}</td></tr>)}</tbody></table></div></details></>}
    <div className="planning-save"><label>Nome del prospetto<input value={name} maxLength={100} onChange={e => setName(e.target.value)}/></label><button className="button secondary" disabled={busy || !!issue || !name.trim()} onClick={save}><Save size={15}/>Salva prospetto</button></div>{message && <p role="status" className="insight-note">{message}</p>}
    {!!saved.length && <div className="planning-saved"><h3>Prospetti salvati</h3>{saved.map(record => { const last = projectCash(record).at(-1); return <button key={record.id} onClick={() => load(record)}><span>{record.name}<small>{record.months} mesi · ipotesi salvate il {record.from}</small></span><strong>{euro(last.cumulative, currency)}<small>differenza nel periodo</small></strong><ArrowRight size={16}/></button>; })}</div>}
    <p className="insight-note">Le somme simulate non cambiano movimenti, conti o patrimonio. Non includono rendimenti, inflazione o costi non presenti nelle ipotesi.</p>
  </section>;
}
