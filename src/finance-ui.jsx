import React, { useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, CircleHelp, Compass, LoaderCircle, Pencil, Plus, ShieldCheck, Wallet, X } from 'lucide-react';
import { useFinance } from './finance-context.jsx';
import * as F from './finance-domain.js';
import { todayKey } from './domain.js';
import './finance.css';
import { RecordForm, TransactionForm, Reconcile, Allocation, Imports } from './finance-forms.jsx';
import { FinanceCloudPanel } from './finance-cloud-panel.jsx';
import { Transactions, TransactionTable, Accounts } from './finance-transactions.jsx';
import { Wealth, Goals } from './finance-wealth.jsx';
import { Business } from './finance-business.jsx';
import { FinanceRestore } from './finance-restore.jsx';
import { BusinessBoard } from './business-board.jsx';
import { FlowChart, RingChart } from './empire-charts.jsx';
import { ActionSummary } from './finance-action-summary.jsx';
import { IncomeInsights, WealthProgress } from './finance-insights.jsx';
import { CashPlanning } from './finance-planning.jsx';
import { periodLabel } from './finance-planning.js';

import { InlineAgentChart } from './agent-hub.jsx';
import { yearlySummaries } from './empire-agent.js';

const uid = () => crypto.randomUUID();
export const formatMoney = (value, currency = 'EUR') => value === null || value === undefined ? '—' : new Intl.NumberFormat('it-IT', { style: 'currency', currency }).format(value / 100);
const itemName = (items, id) => items.find(x => x.id === id)?.name || '—';
const views = [['overview', 'Statistiche'], ['transactions', 'Transazioni'], ['accounts', 'Conti'], ['planning', 'Prospetti'], ['wealth', 'Patrimonio'], ['budgets', 'Limiti di spesa'], ['goals', 'Obiettivi'], ['business', 'Business'], ['analysis', 'Analisi'], ['imports', 'Importazioni']];

function YearlyProgressCard({ state, currency, onSelectYear }) {
  const rows = yearlySummaries(state, currency);
  if (!rows.length) return null;
  const chart = {
    kind: 'yearly-bars',
    title: `La tua crescita anno per anno (${rows[0].year} – ${rows.at(-1).year})`,
    subtitle: 'Tutti i 2.202 movimenti reali Money Manager · Clicca un anno qui sotto per isolarlo',
    rows: rows.map(r => ({ label: r.year, incomeCents: r.incomeCents, expenseCents: r.expenseCents, netCents: r.netCents })),
  };
  return (
    <section className="panel yearly-progress-section" style={{ padding: 22, marginBottom: 22 }}>
      <InlineAgentChart chart={chart} />
      <div className="yearly-pills-row">
        {rows.map(r => (
          <button type="button" key={r.year} className="yearly-pill" onClick={() => onSelectYear(r.year)}>
            <strong>{r.year}</strong>
            <span>Entrate {formatMoney(r.incomeCents, currency)}</span>
            <small className={r.netCents >= 0 ? 'pos' : 'neg'}>Netto {r.netCents >= 0 ? '+' : ''}{formatMoney(r.netCents, currency)}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function HousingSimulatorCard({ state }) {
  const [rent, setRent] = useState(500);
  const [utilities, setUtilities] = useState(140);
  const y2026 = F.financialReport(state, { start: '2026-01-01', end: todayKey(), currency: 'EUR' });
  const elapsedMonths = Math.max(1, Number(todayKey().slice(5, 7)));
  const avgIncome = Math.round((y2026.incomeCents / 100) / elapsedMonths);
  const avgExpense = Math.round((y2026.expenseCents / 100) / elapsedMonths);
  const currentMonthlyNet = avgIncome - avgExpense;
  const projectedMargin = currentMonthlyNet - rent - utilities;
  const liquidity = (y2026.liquidityCents || 0) / 100;
  const target = 6000;
  const pct = Math.min(100, Math.round((liquidity / target) * 100));

  return (
    <section className="panel housing-sim-card" style={{ padding: 24, marginBottom: 22 }}>
      <div className="proposal-header">
        <div>
          <span className="section-eyebrow">PROGETTO VITA · VIVERE DA SOLO</span>
          <h2 style={{ fontFamily: 'var(--display)', fontSize: 28, margin: '6px 0 4px', color: '#f0e1cb' }}>Simulatore Sostenibilità & Indipendenza</h2>
          <p style={{ fontSize: 12 }}>Calcolato sulle tue medie reali 2026 (Entrate medie ~{avgIncome} €/mese · Spese attuali ~{avgExpense} €/mese · Risparmio medio ~{currentMonthlyNet} €/mese)</p>
        </div>
        <span className="quiet-badge">Liquidità pronta: {formatMoney(y2026.liquidityCents, 'EUR')} ({pct}% del target 6.000 €)</span>
      </div>
      <div className="housing-sliders-grid">
        <label className="housing-slider">
          <div><span>Canone Affitto Mensile ipotizzato</span><strong>{rent} € / mese</strong></div>
          <input type="range" min="250" max="950" step="25" value={rent} onChange={e => setRent(Number(e.target.value))} />
        </label>
        <label className="housing-slider">
          <div><span>Bollette & Spese Casa extra</span><strong>{utilities} € / mese</strong></div>
          <input type="range" min="50" max="350" step="10" value={utilities} onChange={e => setUtilities(Number(e.target.value))} />
        </label>
      </div>
      <div className="housing-result-strip">
        <div>
          <small>COSTO CASA TOTALE</small>
          <strong>{rent + utilities} € / mese</strong>
        </div>
        <div>
          <small>MARGINE MENSILE RESIDUO</small>
          <strong style={{ color: projectedMargin >= 0 ? '#a8d5ba' : '#e9aca5' }}>
            {projectedMargin >= 0 ? `+${projectedMargin} € / mese` : `${projectedMargin} € / mese`}
          </strong>
        </div>
        <div>
          <small>AUTONOMIA CUSCINETTO ATTUALE</small>
          <strong>{Math.max(1, Math.floor(liquidity / Math.max(1, rent + utilities)))} mesi coperti</strong>
        </div>
      </div>
    </section>
  );
}
function download(name, content, type = 'application/json') { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
function Modal({ title, children, close, wide = false }) { const ref = useRef(); React.useEffect(() => { ref.current.showModal(); return () => ref.current?.close(); }, []); return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onCancel={close} onClick={e => { if (e.target === ref.current) close(); }}><header><h2>{title}</h2><button className="icon-button" onClick={close} aria-label="Chiudi finestra"><X size={20}/></button></header>{children}</dialog>; }
function Empty({ text, action, onClick }) { return <div className="finance-empty"><Wallet size={26} strokeWidth={1.2}/><p>{text}</p>{action && <button className="button secondary" onClick={onClick}><Plus size={15}/>{action}</button>}</div>; }
function Stat({ title, value, note, tone, currency }) { return <article className={`finance-stat ${tone || ''}`}><span>{title}</span><strong>{formatMoney(value, currency)}</strong>{note && <small>{note}</small>}</article>; }

function getPeriod(preset) { const now = todayKey(); const y = Number(now.slice(0,4)); const m = Number(now.slice(5,7)); const day = (year,month,date) => todayKey(new Date(Date.UTC(year,month,date,12))); if (preset === 'year') return { start: `${y}-01-01`, end: now }; if (preset === 'previous') return { start: day(y,m-2,1), end: day(y,m-1,0) }; const n = { month:1, '3months':3, '6months':6, '12months':12 }[preset] || 1; return { start: day(y,m-n,1), end: now }; }
function monthlyData(state, period, currency) { const map = new Map(); const start = period.start.slice(0,7); let d = new Date(`${start}-01T12:00:00Z`); let count = 0; while (todayKey(d).slice(0,7) <= period.end.slice(0,7) && count++ < 120) { const key = todayKey(d).slice(0,7); map.set(key, { month:key, income:0, expense:0 }); d.setUTCMonth(d.getUTCMonth()+1); } for (const [key,row] of map) { const end = todayKey(new Date(Date.UTC(Number(key.slice(0,4)),Number(key.slice(5,7)),0,12))); const report = F.financialReport(state,{ start: key+'-01' < period.start ? period.start : key+'-01', end: end > period.end ? period.end : end,currency }); row.income = report.incomeCents; row.expense = report.expenseCents; } return [...map.values()]; }
function CashChart({ state, period, currency }) { const rows = monthlyData(state,period,currency); const max = Math.max(1,...rows.flatMap(r => [r.income,r.expense])); return <section className="finance-card"><header><h2>Entrate e uscite</h2><span className="finance-muted">{period.start} — {period.end} · {currency}</span></header><div className="finance-chart-bars" role="img" aria-label={rows.map(r => `${r.month}: entrate ${formatMoney(r.income,currency)}, uscite ${formatMoney(r.expense,currency)}`).join('; ')}>{rows.map(row => <div className="finance-bar-group" key={row.month}><div><span title={`Entrate ${formatMoney(row.income,currency)}`} style={{height:`${row.income/max*100}%`}}/><span title={`Uscite ${formatMoney(row.expense,currency)}`} style={{height:`${row.expense/max*100}%`}}/></div><small>{row.month.slice(5)}/{row.month.slice(2,4)}</small></div>)}</div><div className="finance-legend"><span>Entrate</span><span>Uscite</span></div><details className="chart-data"><summary>Dati del grafico</summary><table><thead><tr><th>Mese</th><th>Entrate</th><th>Uscite</th></tr></thead><tbody>{rows.map(r => <tr key={r.month}><td>{r.month}</td><td>{formatMoney(r.income,currency)}</td><td>{formatMoney(r.expense,currency)}</td></tr>)}</tbody></table></details></section>; }
function CategoryChart({ state, period, currency, drill }) { const rows = F.financialReport(state,{...period,currency}).categories.map(c=>({id:c.categoryId,name:c.name,value:c.spentCents})).filter(c=>c.value>0); const max = Math.max(1,...rows.map(r=>r.value)); return <section className="finance-card"><header><h2>Uscite per categoria</h2><span className="finance-muted">{currency} · Rimborsi detratti dal costo</span></header>{rows.length ? <div className="finance-category-bars">{rows.slice(0,10).map(r=><button onClick={()=>drill(r.id)} key={r.id}><span>{r.name}</span><strong>{formatMoney(r.value,currency)}</strong><i style={{width:`${r.value/max*100}%`}}/></button>)}</div> : <Empty text="Nessuna uscita nel periodo selezionato."/>}</section>; }

export function FinanceWorkspace({ businessMode = false, initialView = 'overview', initialAction = null }) {
  const finance = useFinance(); const {state,status,error,save,undo,canUndo} = finance;
  const [view,setView] = useState(businessMode ? 'business' : views.some(v=>v[0]===initialView)?initialView:'overview'); const [preset,setPreset] = useState('month'); const [period,setPeriod] = useState(()=>getPeriod('month')); const [currency,setCurrency] = useState('EUR');
  const [modal,setModal] = useState(() => initialAction === 'new-transaction' ? { kind: 'transaction', record: null } : null); const [notice,setNotice] = useState(''); const [localError,setError] = useState(''); const [confirm,setConfirm] = useState(null); const [txFilters,setTxFilters] = useState({});
  function request(actions, title='Conferma operazione') { setConfirm({actions,title}); setError(''); }
  async function perform(updater,message) { try { await save(updater); setNotice(message); setError(''); return true; } catch(e) { setError(e.message); return false; } }
  async function execute(actions,message='Operazione salvata') { return perform(current=>F.applyFinance(current,actions,uid()),message); }
  function edit(collection, record=null) { setModal({kind:'record',collection,record}); }
  function editTransaction(record=null) { setModal({kind:'transaction',record}); }
  function backup() { if(state) download(`empire-os-finanze-${todayKey()}.json`,JSON.stringify(state,null,2)); }
  if(!state) return <div className="finance-workspace"><div className="page-heading"><h1>Finanze</h1></div>{error ? <div role="alert" className="finance-alert">{error}<button className="button ghost" onClick={()=>location.reload()}>Riprova</button></div> : <p><LoaderCircle className="spin"/>Caricamento archivio finanziario…</p>}</div>;
  const report = F.financialReport(state,{...period,currency}); const worth = F.netWorth(state,{currency,at:period.end});
  function goTransactions(filters={}) { setTxFilters(filters); setView('transactions'); }
  function updatePeriod(key,value) { if(!F.validFinanceDay(value)){setError('Completa una data valida per il periodo.');return;} const next=key==='start'?{start:value,end:value>period.end?value:period.end}:{end:value,start:value<period.start?value:period.start}; const span=(Number(next.end.slice(0,4))-Number(next.start.slice(0,4)))*12+Number(next.end.slice(5,7))-Number(next.start.slice(5,7)); if(span>=120){setError('Seleziona un periodo fino a dieci anni.');return;} setPreset('custom');setError('');setPeriod(next); }
  const common = {state,currency,period,edit,request,editTransaction,setModal,execute,goTransactions};
  return <div className="finance-workspace"><div className="page-heading"><div><p className="eyebrow">{businessMode ? "MY BUSINESS EMPIRE" : "REGISTRO FINANZIARIO"}</p><h1>{view==='overview'?'Entrate e spese':views.find(v=>v[0]===view)?.[1]}</h1></div><button className="button primary" onClick={()=>businessMode ? edit("orders",{businessId:state.businesses[0]?.id,currency}) : editTransaction()}><Plus size={17}/>{businessMode ? "Nuova vendita" : "Aggiungi movimento"}</button></div>
    <div className="finance-storage"><span className="finance-chip"><ShieldCheck size={13}/>{status==='saving'?'Salvataggio…':finance.storageMode === 'cloud' ? 'Archivio personale online' : 'Dati su questo dispositivo'}</span><button className="text-button" onClick={backup}>Backup JSON <ArrowDownToLine size={13}/></button>{canUndo && <button className="text-button" disabled={status==='saving'} onClick={()=>setConfirm({title:'Annulla ultima modifica',undo:true})}>Annulla ultima modifica</button>}</div>
    <nav hidden={businessMode} className="finance-nav" aria-label="Sezioni finanziarie">{views.filter(([id])=>['overview','transactions','accounts','imports'].includes(id)).map(([id,label])=><button key={id} className={view===id?'active':''} onClick={()=>{setView(id);setError('');}}>{label}</button>)}</nav>
    <div className="finance-toolbar">{view!=='planning' && <div className="finance-period"><select aria-label="Periodo finanziario" value={preset} onChange={e=>{setPreset(e.target.value);if(e.target.value!=='custom')setPeriod(getPeriod(e.target.value));}}>{[['month','Mese corrente'],['previous','Mese precedente'],['3months','Ultimi 3 mesi'],['6months','Ultimi 6 mesi'],['12months','Ultimi 12 mesi'],['year',`Anno ${todayKey().slice(0,4)}`],['custom','Personalizzato']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><input aria-label="Dal giorno" type="date" value={period.start} onInput={e=>{updatePeriod('start',e.target.value);}} onChange={()=>{}}/><span>—</span><input aria-label="Al giorno" type="date" value={period.end} onInput={e=>{updatePeriod('end',e.target.value);}} onChange={()=>{}}/></div>}<select aria-label="Valuta del report" value={currency} onChange={e=>setCurrency(e.target.value)}>{[...new Set(['EUR',...state.accounts.map(a=>a.currency),...state.assets.map(a=>a.currency)])].map(c=><option key={c}>{c}</option>)}</select></div>
    {(localError||error) && <p className="finance-alert" role="alert">{localError||error}</p>}{notice && <div className="finance-notice" role="status"><Check size={16}/>{notice}<button className="icon-button" aria-label="Chiudi avviso" onClick={()=>setNotice('')}><X size={15}/></button></div>}
    {view==='overview' && <><div className="finance-stats"><Stat title="Entrate" value={report.incomeCents} currency={currency} note="Nel periodo selezionato" tone="finance-positive"/><Stat title="Spese" value={report.expenseCents} currency={currency} note="Al netto dei rimborsi"/><Stat title="Bilancio netto" value={report.netCents} currency={currency} note="Entrate meno spese"/><Stat title="Liquidità conti" value={report.liquidityCents} currency={currency} note="Totale disponibile oggi"/></div>
      {!state.accounts.length && <section className="finance-card"><Empty text="Nessun conto registrato. Aggiungi un conto o importa lo storico." action="Aggiungi conto" onClick={()=>edit('accounts')}/><button className="text-button" onClick={()=>setView('imports')}>Importa Money Manager <ArrowRight size={14}/></button></section>}
      <IncomeInsights {...{state,period,currency,execute}} spendingRows={report.categories.map(c=>({id:c.categoryId,name:c.name,value:c.spentCents}))} onSpend={category=>goTransactions(category?{category}:{uncategorized:true})} goPeriod={value=>{setPeriod(value);setPreset('custom');}}/>
      <details className="finance-secondary"><summary>Confronto storico per anno (2021–{todayKey().slice(0,4)})</summary><YearlyProgressCard state={state} currency={currency} onSelectYear={y => { setPreset('custom'); setPeriod({ start: `${y}-01-01`, end: y === todayKey().slice(0, 4) ? todayKey() : `${y}-12-31` }); }} /></details>
      <section className="finance-card"><header><h2>Ultimi movimenti</h2><button className="text-button" onClick={()=>setView('transactions')}>Tutte le transazioni <ArrowRight size={14}/></button></header><TransactionTable {...common} records={state.transactions.filter(t=>t.date>=period.start&&t.date<=period.end&&t.currency===currency).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8)}/></section></>}
    {view==='transactions' && <Transactions {...common} filters={txFilters} setFilters={setTxFilters}/>}
    {view==='planning' && <><HousingSimulatorCard state={state} /><CashPlanning key={currency} {...{state,currency,execute}}/><Goals {...common}/></>}
    {view==='accounts' && <Accounts {...common}/>}
    {view==='wealth' && <Wealth {...common} worth={worth}/>}
    {view==='budgets' && <Budgets {...common}/>}
    {view==='goals' && <Goals {...common}/>}
    {view==='business' && <BusinessBoard {...common} renderDetail={(selectedId,detailPeriod)=><Business {...common} selectedId={selectedId} period={detailPeriod}/>}/>}
    {view==='analysis' && <Analysis {...common}/>}
    {view==='imports' && <><Imports {...{state,save,backup,perform,setConfirm,setNotice,setError}}/><FinanceRestore {...{state,save,backup,setConfirm}}/>{finance.storageMode !== 'cloud' && <FinanceCloudPanel {...{state,save,backup,setConfirm}}/>}<section className="finance-card"><h2>Archivio locale</h2><p className="finance-muted">Esporta un backup prima di svuotare i dati finanziari. L’archivio attività è separato.</p><button className="button ghost danger-text" onClick={()=>setConfirm({title:'Svuota archivio finanziario locale',description:'Verrà scaricato un backup, quindi conti, movimenti e registrazioni finanziarie locali verranno rimossi. Puoi annullare l’operazione.',run:async()=>{backup();await save(F.emptyFinance());setNotice('Archivio finanziario locale svuotato. Backup scaricato.');}})}>Backup e svuota Finanze</button></section></>}
    {modal?.kind==='transaction' && <TransactionForm {...{state}} record={modal.record} close={()=>setModal(null)} save={async record=>{const ok=await execute({type:'upsert',args:{collection:'transactions',record}},'Movimento salvato');if(ok)setModal(null);return ok;}}/>}
    {modal?.kind==='record' && <RecordForm {...{state}} collection={modal.collection} record={modal.record} close={()=>setModal(null)} save={async record=>{let actions={type:'upsert',args:{collection:modal.collection,record}};if(modal.collection==='payouts'&&record.status==='posted'&&!record.transactionId){actions=[...(state.payouts.some(p=>p.id===record.id)?[{type:'remove',args:{collection:'payouts',id:record.id}}]:[]),{type:'record_payout',args:record}];}const ok=await execute(actions,'Dati salvati');if(ok)setModal(null);return ok;}}/>}
    {modal?.kind==='reconcile' && <Reconcile {...{state}} account={modal.record} close={()=>setModal(null)} submit={action=>{setModal(null);request(action,'Conferma riconciliazione');}}/>}
    {modal?.kind==='allocate' && <Allocation {...{state}} goal={modal.record} close={()=>setModal(null)} submit={action=>{setModal(null);request(action,'Conferma allocazione');}}/>}
    {confirm && <Modal title={confirm.title||'Conferma operazione'} close={()=>setConfirm(null)}><div className="guide-body"><p>{confirm.description||'L’operazione verrà salvata nell’archivio finanziario locale.'}</p>{confirm.actions && <ActionSummary actions={confirm.actions} state={state}/>}<div className="button-row"><button className="button primary" disabled={status==='saving'} onClick={async()=>{try{if(confirm.undo){await undo();setNotice('Ultima modifica annullata');}else if(confirm.run){await confirm.run();}else{if(!await execute(confirm.actions))return;}setConfirm(null);}catch(e){setError(e.message);}}}>{status==='saving'?'Salvataggio…':'Conferma'}</button><button className="button ghost" onClick={()=>setConfirm(null)}>Annulla</button></div></div></Modal>}
  </div>;
}




function Budgets({state,currency,period,edit,request}) { return <><div className="finance-toolbar"><h2>Budget per categoria</h2><button className="button secondary" onClick={()=>edit('budgets')}><Plus size={16}/>Nuovo budget</button></div><div className="finance-record-grid">{state.budgets.filter(b=>b.currency===currency).map(b=>{const s=F.budgetStatus(state,b);const spent=s.spentCents||0;return <article className="finance-record" key={b.id}><header><span className="finance-chip">{itemName(state.categories,b.categoryId)}</span><button className="icon-button" aria-label={`Modifica budget ${b.name||b.id}`} onClick={()=>edit('budgets',b)}><Pencil size={15}/></button></header><h2>{b.name||itemName(state.categories,b.categoryId)}</h2><p>{b.start} — {b.end}</p><strong className="finance-record-value">{formatMoney(spent,currency)} <small>/ {formatMoney(b.limitCents,currency)}</small></strong><div className="progress-track"><span style={{width:`${Math.min(100,b.limitCents?spent/b.limitCents*100:0)}%`}}/></div><p className={spent>b.limitCents?'finance-negative':'finance-muted'}>Residuo {formatMoney(b.limitCents-spent,currency)}</p><button className="text-button danger-text" onClick={()=>request({type:'remove',args:{collection:'budgets',id:b.id}},'Elimina budget')}>Elimina</button></article>;})}</div>{!state.budgets.length&&<section className="finance-card"><Empty text="Nessun budget impostato." action="Nuovo budget" onClick={()=>edit('budgets')}/></section>}<section className="finance-card"><header><h2>Abbonamenti e ricorrenze</h2><button className="button secondary" onClick={()=>edit('recurringRules')}><Plus size={16}/>Nuova ricorrenza</button></header>{state.recurringRules.length?<div className="finance-rows">{state.recurringRules.map(r=><div className="finance-row" key={r.id}><div><strong>{r.name}</strong><small>{r.frequency} · Prossima data {r.nextDate} · {r.active?'Attiva':'Interrotta'}</small></div><strong>{formatMoney(r.template?.amountCents,r.currency)}</strong><span className="finance-muted">Costo annuo stimato {formatMoney(r.template.amountCents*({daily:365,weekly:52,monthly:12,yearly:1}[r.frequency]||1),r.currency)}</span><div className="finance-actions"><button className="icon-button" aria-label={`Modifica ricorrenza ${r.name}`} onClick={()=>edit('recurringRules',r)}><Pencil size={15}/></button><button className="button ghost" disabled={!r.active} onClick={()=>request({type:'generate_recurring',args:{through:period.end,ruleId:r.id}},'Genera movimenti previsti')}>Genera previsti</button></div></div>)}</div>:<p className="finance-muted">Nessuna ricorrenza registrata.</p>}<p className="finance-muted">I movimenti previsti non modificano i saldi. Contabilizzali dopo l’effettivo pagamento. Un abbonamento interrotto non genera nuove entrate.</p></section></>; }



function Analysis({state,period,currency,edit,request,goTransactions}) {const rows=monthlyData(state,period,currency);const [snapshotDate,setSnapshotDate]=useState(todayKey());const snapshots=state.platformBalances.filter(p=>p.kind==='net-worth');return <><div className="finance-two-col"><FlowChart {...{state,period,currency}}/><CategoryChart {...{state,period,currency}} drill={id=>goTransactions(id?{category:id}:{uncategorized:true})}/></div><section className="finance-card"><header><h2>Confronto mensile</h2><span className="finance-muted">Date effettive del filtro · mesi parziali inclusi</span></header><div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>Mese</th><th>Entrate</th><th>Uscite</th><th>Differenza del periodo</th><th>Variazione uscite</th></tr></thead><tbody>{rows.map((r,i)=><tr key={r.month}><td>{r.month}</td><td>{formatMoney(r.income,currency)}</td><td>{formatMoney(r.expense,currency)}</td><td>{formatMoney(r.income-r.expense,currency)}</td><td>{i?formatMoney(r.expense-rows[i-1].expense,currency):'—'}</td></tr>)}</tbody></table></div></section><section className="finance-card"><h2>Qualità dei dati</h2><div className="finance-rows"><div className="finance-row"><span>Saldi di apertura mancanti</span><strong>{state.accounts.filter(a=>a.openingCents===null||a.openingCents===undefined).length}</strong></div><div className="finance-row"><span>Valutazioni materiali non disponibili</span><strong>{state.assets.filter(a=>a.valueCents===null).length}</strong></div><div className="finance-row"><span>Movimenti previsti o in bozza</span><strong>{state.transactions.filter(t=>t.status!=='posted').length}</strong></div><div className="finance-row"><span>Ordini con costi mancanti</span><strong>{state.orders.filter(o=>o.feesCents===null||o.directCostCents===null).length}</strong></div></div></section><section className="finance-card"><header><h2>Storico modifiche</h2><button className="button ghost" onClick={()=>download(`audit-finanze-${todayKey()}.json`,JSON.stringify(state.auditEvents,null,2))}>Esporta storico</button></header><div className="finance-rows">{state.auditEvents.slice(-30).reverse().map((a,i)=><div className="finance-row" key={a.id||i}><span>{a.type||a.action}<small>{a.createdAt||a.at}</small></span><span className="finance-muted">{a.collection||a.entity||'Archivio'}</span></div>)}</div></section></>; }
