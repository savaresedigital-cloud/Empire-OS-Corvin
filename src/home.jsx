import { EmpireMark } from './empire-icons.jsx';
import React, { useEffect } from 'react';
import { AssistantWorkspace } from './agent-hub.jsx';
import { suggestDay, taskProgress } from './empire-metrics.js';
import { agendaWindow, taskDay } from './agenda.js';
import { ArrowRight, Check, Coffee, Feather, Landmark, Moon, Plus, CalendarDays, Wallet } from 'lucide-react';
import { AREAS, todayKey } from './domain.js';
import { useFinance } from './finance-context.jsx';
import { financialReport } from './finance-domain.js';

const areaDetails = {
  personale: { icon: Moon, subtitle: 'Tempo per te, casa e vita quotidiana' },
  zerilli: { icon: Coffee, subtitle: 'Idee, persone e lavoro al caffè' },
  rep: { icon: Landmark, subtitle: 'Cantieri, clienti e prossimi passi' },
  business: { icon: Feather, subtitle: 'Le tue creazioni e i tuoi progetti' },
};
const money = value => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value / 100);
function FinanceGlance({ navigate }) {
  const { state } = useFinance();
  if (!state) return null;
  const today = todayKey(), report = financialReport(state, { start: today.slice(0,7)+'-01', end: today, currency: 'EUR' });
  return <button className="home-finance" onClick={() => navigate('finance')}><span className="home-finance-icon"><Wallet size={21} strokeWidth={1.4}/></span><span><small>REGISTRO · MESE CORRENTE</small><strong>Entrate {money(report.incomeCents)} · Spese {money(report.expenseCents)}</strong><em>Apri movimenti e fonti</em></span><ArrowRight size={18}/></button>;
}

export function TodayWorkspace({ state, commit, onEdit, onToggle, onPriority, navigate, choose, WeeklyChart, backend, useSpeech }) {
  const progress = taskProgress(state), today = todayKey(), limit = state.settings.priorityCount === 5 ? 5 : 3;
  useEffect(() => { if (state.settings.lastDailyPlan === today) return; const tasks = suggestDay(state, { date: today, count: limit }); commit([], null, current => { if (current.settings.lastDailyPlan === today) return current; const next = structuredClone(current); if (!(next.plans[today] || []).length) next.plans[today] = tasks.map(t => t.id); next.settings.lastDailyPlan = today; return next; }).catch(() => {}); }, [today]);
  const ids = state.plans[today] || [];
  const selected = ids.map(id => state.tasks.find(t => t.id === id)).filter(Boolean), done = selected.filter(t => t.status === 'done').length;
  const pending = state.tasks.filter(t => t.status !== 'done' && !t.archived), dates = agendaWindow(state, today);
  const dateText = task => {
    const day = taskDay(task), label = day < today ? 'Da recuperare' : day === today ? 'Oggi' : new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(day+'T12:00:00Z'));
    return label + (task.dueAt.length > 10 ? ' · '+new Intl.DateTimeFormat('it-IT', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Rome' }).format(new Date(task.dueAt)) : '');
  };
  return <div className="home-world personal-home">
    <div className="home-sanctuary" aria-hidden="true"/>
    <header className="world-hero">
      <div className="world-hero-art" aria-hidden="true" />
      <div className="world-hero-content">
        <div className="world-date">
          <span />
          <span>{new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' }).format(new Date())}</span>
          <i>Santuario di Corvin</i>
        </div>
        <span className="hero-overline">EMPIRE OS · SPAZIO PERSONALE SOVRANO</span>
        <h1>Benvenuto nel tuo <span>Santuario</span>, {state.settings?.name || 'Alessandro'}</h1>
        <p className="hero-copy">Il tuo mondo, al tuo ritmo. Attività, progetti e finanze raccolti sotto il sigillo dell'impero.</p>
        <div className="hero-actions">
          <button className="button primary" onClick={() => onEdit({})}>
            <Plus size={16} /> Nuova attività
          </button>
          <button className="text-button hero-add" onClick={choose}>
            <CalendarDays size={14} /> Scegli priorità
          </button>
        </div>
      </div>
      <div className="world-hero-caption" aria-hidden="true">
        <EmpireMark size={16} /> SANTUARIO DI CORVIN · SIGILLO DELL'IMPERO
      </div>
    </header>
    <AssistantWorkspace {...{state,commit,backend,useSpeech,navigate}}/>
    <div className="home-main-grid">
      <section className="panel home-priorities"><div className="home-panel-heading"><div><span className="section-eyebrow"><CalendarDays size={13}/>AGENDA</span><h2>Oggi</h2></div><span className="quiet-badge">{done} / {selected.length} fatte</span></div>
        <div className="home-priority-options"><button className="text-button" onClick={choose}>Scegli attività</button><label>Fino a<select aria-label="Numero di priorità giornaliere" value={limit} onChange={e => { const n=Number(e.target.value); commit([], null, current=>({...current,settings:{...current.settings,priorityCount:n},plans:{...current.plans,[today]:(current.plans[today]||[]).slice(0,n)}})).catch(()=>{}); }}><option value={3}>3</option><option value={5}>5</option></select></label></div>
        <div className="home-priority-list">{selected.map((task,index)=><div className={`home-priority-slot ${task.status==='done'?'is-complete':''}`} key={task.id}><span className="home-priority-number">{['I','II','III','IV','V'][index]}</span><button className="home-priority-task" onClick={()=>onEdit(task)}><strong>{task.title}</strong><span><i className={`area-dot ${task.areaId}`}/>{AREAS.find(a=>a.id===task.areaId)?.name || 'Personale'}{task.dueAt && ' · '+dateText(task)}</span></button><button className="task-check" aria-label={`${task.status==='done'?'Riapri':'Completa'} ${task.title}`} onClick={()=>onToggle(task)}>{task.status==='done'&&<Check size={16}/>}</button><div className="home-priority-controls"><button className="icon-button" aria-label={`Sposta priorità ${task.title} in alto`} disabled={index===0} onClick={()=>{ const order=[...ids]; [order[index-1],order[index]]=[order[index],order[index-1]]; commit([{type:'set_daily_priorities',args:{date:today,taskIds:order}}],null).catch(()=>{}); }}>↑</button><button className="icon-button" aria-label={`Rimuovi ${task.title} dalle priorità`} onClick={()=>onPriority(task)}>×</button></div></div>)}</div>
        {!selected.length&&<p className="agenda-empty">Nessuna attività scelta per oggi.</p>}
        <div className="home-panel-footer"><button className="text-button" onClick={()=>onEdit({})}><Plus size={14}/>Nuova attività</button><button className="text-button" onClick={()=>navigate('focus')}>Agenda completa<ArrowRight size={14}/></button></div>
      </section>
      <section className="panel agenda-dates"><header><span className="section-eyebrow">SCADENZE</span><h2>Entro i prossimi 7 giorni</h2></header>{dates.length?<div>{dates.slice(0,6).map(task=><button key={task.id} onClick={()=>onEdit(task)}><time className={taskDay(task)<today?'is-late':''}>{dateText(task)}</time><strong>{task.title}</strong><small>{AREAS.find(a=>a.id===task.areaId)?.name}</small></button>)}</div>:<p className="agenda-empty">Nessuna scadenza registrata nei prossimi 7 giorni.</p>}<button className="text-button" onClick={()=>navigate('focus',{view:'upcoming'})}>Apri scadenze<ArrowRight size={14}/></button></section>
    </div>
    <section className="home-atlas" aria-labelledby="atlas-title"><div className="home-section-heading"><div><h2 id="atlas-title">I domini</h2></div><span className="atlas-line" aria-hidden="true"><EmpireMark size={20}/></span></div><div className="home-area-grid">{AREAS.map(area=>{const detail=areaDetails[area.id],Icon=detail.icon,count=pending.filter(t=>t.areaId===area.id).length;return <button className={`home-area ${area.id}`} key={area.id} onClick={()=>navigate('projects',{area:area.id})}><div className="area-landscape" aria-hidden="true"><span className="area-sigil"><Icon size={38} strokeWidth={.9}/></span><i/><b/><span className="area-horizon"/></div><div className="home-area-body"><span className="home-area-icon"><Icon size={18} strokeWidth={1.35}/></span><h3>{area.name}</h3><p>{detail.subtitle}</p><div><span>{count} {count===1?'attività aperta':'attività aperte'}</span><ArrowRight size={15}/></div></div></button>;})}</div></section>
    <FinanceGlance navigate={navigate}/>
    <details className="panel personal-progress"><summary>Registro dei progressi <span>{progress.total} {progress.total===1?'attività completata':'attività completate'}</span></summary><div className="task-milestones"><div><h2>Traguardo: {progress.next} attività</h2></div><div><span>{progress.total} / {progress.next}</span><progress max={progress.next} value={progress.total} aria-label="Progresso verso il prossimo traguardo"/></div></div><WeeklyChart tasks={state.tasks}/></details>
  </div>;
}
