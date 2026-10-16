import React, { useState, useRef, useEffect } from 'react';
import { ArrowUp, ArrowRight, Check, Mic, MicOff, Brain, Trash2, RotateCcw, Sparkles, ListChecks, LoaderCircle, BarChart3, Clock3, Target, FolderOpen, Feather } from 'lucide-react';
import { useFinance } from './finance-context.jsx';
import { getAreas, applyActions, todayKey } from './domain.js';
import { applyFinance } from './finance-domain.js';
import { localEmpireRequest, directAgentRequest, parseSmartPaste, validateAgentResult, buildAgentChart } from './empire-agent.js';
import { ActionSummary } from './finance-action-summary.jsx';
import { displayAdviserName } from './finance-planning.js';

const fmtEuro = value => value == null ? '—' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value / 100);

export function InlineAgentChart({ chart }) {
  const [tab, setTab] = useState('compare');
  const [rent, setRent] = useState(chart?.rent || 500);
  const [utilities, setUtilities] = useState(chart?.utilities || 140);
  if (!chart) return null;
  if (chart.kind === 'housing-sim') {
    const avgNet = (chart.avgIncome || 1400) - (chart.avgExpense || 1100);
    const margin = avgNet - rent - utilities;
    const months = Math.max(1, Math.floor((chart.liquidity || 9134) / Math.max(1, rent + utilities)));
    return (
      <div className="agent-inline-chart">
        <div className="agent-inline-chart-head">
          <div>
            <span className="section-eyebrow">SIMULATORE DINAMICO</span>
            <h4>{chart.title}</h4>
            <small>Basato sul tuo risparmio medio reale (~{avgNet} €/mese) e liquidità ({chart.liquidity} €)</small>
          </div>
        </div>
        <div className="housing-sliders-grid" style={{ margin: '10px 0' }}>
          <label className="housing-slider">
            <div><span>Affitto mensile</span><strong>{rent} €</strong></div>
            <input type="range" min="250" max="950" step="25" value={rent} onChange={e => setRent(Number(e.target.value))} />
          </label>
          <label className="housing-slider">
            <div><span>Bollette / extra</span><strong>{utilities} €</strong></div>
            <input type="range" min="50" max="350" step="10" value={utilities} onChange={e => setUtilities(Number(e.target.value))} />
          </label>
        </div>
        <div className="housing-result-strip" style={{ paddingTop: 10 }}>
          <div><small>COSTO CASA</small><strong style={{ fontSize: 18 }}>{rent + utilities} €/m</strong></div>
          <div><small>MARGINE RESIDUO</small><strong style={{ fontSize: 18, color: margin >= 0 ? '#a8d5ba' : '#e9aca5' }}>{margin >= 0 ? `+${margin}` : margin} €/m</strong></div>
          <div><small>CUSCINETTO</small><strong style={{ fontSize: 18 }}>{months} mesi</strong></div>
        </div>
      </div>
    );
  }
  if (!Array.isArray(chart.rows) || !chart.rows.length) return null;
  const maxVal = Math.max(1, ...chart.rows.flatMap(r => [r.incomeCents || 0, r.expenseCents || 0, Math.abs(r.netCents || 0)]));
  const isSources = chart.kind === 'sources-bars';
  return (
    <div className="agent-inline-chart">
      <div className="agent-inline-chart-head">
        <div>
          <span className="section-eyebrow"><BarChart3 size={12}/> GRAFICO GENERATO</span>
          <h4>{chart.title}</h4>
          {chart.subtitle && <small>{chart.subtitle}</small>}
        </div>
        {!isSources && (
          <div className="segmented">
            <button type="button" className={tab === 'compare' ? 'active' : ''} onClick={() => setTab('compare')}>Entrate / Uscite</button>
            <button type="button" className={tab === 'net' ? 'active' : ''} onClick={() => setTab('net')}>Risparmio Netto</button>
          </div>
        )}
      </div>
      {isSources ? (
        <div className="agent-sources-bars">
          {chart.rows.map((r, i) => (
            <div className="agent-source-row" key={i}>
              <div className="agent-source-top">
                <span>{r.label}</span>
                <strong>{fmtEuro(r.incomeCents)}</strong>
              </div>
              <div className="agent-source-track">
                <i style={{ width: `${Math.max(4, (r.incomeCents / maxVal) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="agent-bars-grid">
            {chart.rows.map((r, i) => {
              const incH = Math.max(4, Math.round(((r.incomeCents || 0) / maxVal) * 100));
              const expH = Math.max(4, Math.round(((r.expenseCents || 0) / maxVal) * 100));
              const netH = Math.max(6, Math.round((Math.abs(r.netCents || 0) / maxVal) * 100));
              return (
                <div className="agent-bar-col" key={i}>
                  <div className="agent-bar-pair">
                    {tab === 'compare' ? (
                      <>
                        <span className="bar-inc" style={{ height: `${incH}%` }} title={`Entrate ${r.label}: ${fmtEuro(r.incomeCents)}`} />
                        <span className="bar-exp" style={{ height: `${expH}%` }} title={`Uscite ${r.label}: ${fmtEuro(r.expenseCents)}`} />
                      </>
                    ) : (
                      <span className={`bar-net ${(r.netCents || 0) >= 0 ? 'pos' : 'neg'}`} style={{ height: `${netH}%` }} title={`Netto ${r.label}: ${fmtEuro(r.netCents)}`} />
                    )}
                  </div>
                  <small>{r.label}</small>
                  <strong className={(r.netCents || 0) >= 0 ? 'pos' : 'neg'}>
                    {tab === 'compare' ? fmtEuro(r.incomeCents) : fmtEuro(r.netCents)}
                  </strong>
                </div>
              );
            })}
          </div>
          <div className="agent-chart-legend">
            {tab === 'compare' ? (
              <>
                <span><i className="dot-inc" /> Entrate</span>
                <span><i className="dot-exp" /> Uscite</span>
              </>
            ) : (
              <span><i className="dot-net" /> Risparmio Netto del periodo</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function AssistantWorkspace({ state, commit, backend, useSpeech, navigate, compact = false, initialDraft = '', onClose, docked = false, onToggleDock }) {
  const finance = useFinance();
  const [text, setText] = useState(initialDraft || '');
  useEffect(() => { if (initialDraft) setText(initialDraft); }, [initialDraft]);
  const [busy, setBusy] = useState(false);
  const [pendingQuery, setPendingQuery] = useState('');
  const [proposal, setProposal] = useState(null);
  const [proposalAreaFilter, setProposalAreaFilter] = useState('');
  const [lastChart, setLastChart] = useState(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(true);
  const messagesEndRef = useRef(null);
  const speech = useSpeech(setText, () => text);
  const messages = state.settings.agentConversation || [];
  const name = 'Merlino';
  const modelLabel = backend?.aiConfigured ? (backend.model || 'gemini-3.5-flash-lite') : 'Motore rapido';

  useEffect(() => {
    if (expanded) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages.length, busy, proposal]);

  async function remember(input, result, actions = []) {
    return commit([], actions.length ? 'Attività aggiornate' : null, current => {
      const next = actions.length ? applyActions(current, actions, crypto.randomUUID()) : structuredClone(current);
      if ((next.plans[todayKey()] || []).length > 3) next.settings.priorityCount = 5;
      next.settings.agentConversation = [...(next.settings.agentConversation || []), { role: 'user', text: input }, { role: 'assistant', text: result }].slice(-40);
      return next;
    });
  }

  async function send(event, supplied) {
    event?.preventDefault();
    const input = (supplied || text).trim();
    if (!input || busy || !finance.state) return;
    if (speech.listening) speech.stop ? speech.stop() : speech.toggle();
    setProposal(null);
    setProposalAreaFilter('');
    setBusy(true); setError(''); setPendingQuery(input); setText(''); setExpanded(true);
    try {
      let result;
      const direct = directAgentRequest(input, state, finance.state);
      const smart = !direct ? parseSmartPaste(input, state, finance.state) : null;
      if (direct) result = direct;
      else if (smart) result = smart;
      else if (backend?.aiConfigured) {
        const response = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: input }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'L’agente non ha risposto. Riprova.');
        result = body;
      } else result = localEmpireRequest(input, state, finance.state);
      result = validateAgentResult(result, state, finance.state, input);
      const chart = result.chart || buildAgentChart(input, finance.state);
      if (chart) setLastChart({ forQuery: input, chart });
      const needsReview = result.financeActions.length > 0 || result.taskActions.length > 1 || result.taskActions.some(a => ['delete_task', 'delete_project', 'forget_fact'].includes(a.type) || (a.args?.subtasks?.length > 0));
      if (needsReview) {
        setProposal({ ...result, chart, input, taskSnapshot: JSON.stringify(state), financeSnapshot: JSON.stringify(finance.current()) });
      } else {
        await remember(input, result.message + (result.taskActions.length ? '\nAggiornamento salvato.' : ''), result.taskActions);
      }
    } catch (e) { setText(input); setError(e.message); } finally { setBusy(false); setPendingQuery(''); }
  }

  function setAllProposalTasksStatus(status) {
    setProposal(prev => {
      if (!prev) return prev;
      const taskActions = prev.taskActions.map(a =>
        a.type === 'create_task'
          ? {
              ...a,
              args: {
                ...a.args,
                status,
                completedAt: status === 'done' ? `${a.args.dueAt?.slice(0, 10) || todayKey()}T18:00:00.000Z` : null,
              },
            }
          : a
      );
      return { ...prev, taskActions };
    });
  }

  function updateProposalTask(index, patch) {
    setProposal(prev => {
      if (!prev) return prev;
      const taskActions = prev.taskActions.map((a, i) => i === index ? { ...a, args: { ...a.args, ...patch } } : a);
      return { ...prev, taskActions };
    });
  }

  function removeProposalTask(index) {
    setProposal(prev => {
      if (!prev) return prev;
      const taskActions = prev.taskActions.filter((_, i) => i !== index);
      return !taskActions.length && !prev.financeActions.length ? null : { ...prev, taskActions };
    });
  }

  function updateProposalFinanceAccount(index, accountId) {
    setProposal(prev => {
      if (!prev) return prev;
      const financeActions = prev.financeActions.map((a, i) => i === index && a.args?.record ? { ...a, args: { ...a.args, record: { ...a.args.record, accountId } } } : a);
      return { ...prev, financeActions };
    });
  }

  async function confirm() {
    setBusy(true); const before = state; let tasksWritten = false, financeWritten = false;
    try {
      if (proposal.taskSnapshot !== JSON.stringify(state) || proposal.financeSnapshot !== JSON.stringify(finance.current())) throw new Error('I dati sono cambiati. Annulla e chiedimi di nuovo la registrazione.');
      validateAgentResult(proposal, state, finance.current());
      if (proposal.taskActions.length) { await commit(proposal.taskActions, 'Attività aggiornate'); tasksWritten = true; }
      if (proposal.financeActions.length) { await finance.save(current => applyFinance(current, proposal.financeActions, crypto.randomUUID())); financeWritten = true; }
      const forgetting = proposal.taskActions.some(a => a.type === 'forget_fact');
      await remember(forgetting ? 'Rimuovi ricordo' : proposal.input, forgetting ? 'Ricordo rimosso. Conversazione precedente svuotata.' : proposal.message + '\nRegistrazione salvata.');
      setProposal(null);
    } catch (e) {
      if (tasksWritten && !financeWritten) { try { await commit([], 'Attività ripristinate', () => before); } catch { setError('Controlla le attività: il ripristino non è riuscito.'); } }
      if (financeWritten) { setProposal(null); setError('Registrazione salvata. Non è stato possibile salvare la conversazione.'); } else setError(e.message);
    } finally { setBusy(false); }
  }

  const activeAccounts = (finance.state?.accounts || []).filter(a => a.active && !['debit', 'aggregate'].includes(a.type));
  const visibleMessages = messages.slice(expanded ? -30 : -2);

  const quickPrompts = [
    { icon: Clock3, label: 'In 30 minuti', prompt: 'Cosa riesco a fare in mezz’ora?' },
    { icon: Target, label: 'Priorità di oggi', prompt: 'Prepara oggi: scegli le priorità migliori' },
    { icon: ListChecks, label: 'Dividi in passaggi', prompt: 'Dividi in passaggi il lavoro più urgente' },
    { icon: FolderOpen, label: 'Sistema attività', prompt: 'Organizza le attività in Da sistemare' },
  ];

  return (
    <section id="agente" className={`agent-hub panel ${compact ? 'is-compact' : 'is-full-chat'} ${docked ? 'is-docked' : ''}`} aria-label="Merlino">
      <header className="agent-hub-header">
        <div className="agent-sigil"><Feather size={20} strokeWidth={1.5}/></div>
        <div>
          <h2>{name}</h2>
          <small className="agent-subtitle">Consigliere operativo e finanziario</small>
        </div>
        <div className="agent-header-actions">
          {onToggleDock && (
            <button type="button" className="button ghost btn-sm desktop-only-btn" onClick={onToggleDock} title={docked ? 'Apri come pannello' : 'Affianca alla pagina'}>
              {docked ? 'Pannello' : 'Affianca'}
            </button>
          )}
          {onClose && (
            <button type="button" className="icon-button" aria-label="Chiudi chat" onClick={onClose}>
              ×
            </button>
          )}
        </div>
      </header>

      <div className="agent-shortcuts" aria-label="Suggerimenti rapidi">
        {quickPrompts.map(({ icon: Icon, label, prompt }) => (
          <button key={label} type="button" disabled={busy || !!proposal} onClick={() => send(null, prompt)}>
            <Icon size={12} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {(!!visibleMessages.length || busy) && (
        <div className="agent-history">
          <div className="agent-history-bar">
            {messages.length > 2 && (
              <button type="button" className="text-button" onClick={() => setExpanded(!expanded)}>
                {expanded ? 'Mostra solo ultimo scambio' : `Vedi conversazione (${messages.length})`}
              </button>
            )}
            {!!messages.length && (
              <button type="button" className="text-button muted" onClick={() => { setLastChart(null); commit([], 'Chat pulita', cur => ({ ...cur, settings: { ...cur.settings, agentConversation: [] } })).catch(() => {}); }}>
                Pulisci chat
              </button>
            )}
          </div>
          <div className={`agent-messages ${expanded ? 'expanded' : ''}`} aria-live="polite">
            {visibleMessages.map((m, i) => {
              const isLastAssistant = m.role === 'assistant' && i === visibleMessages.length - 1;
              const inlineChart = isLastAssistant && lastChart ? lastChart.chart : (m.role === 'user' ? buildAgentChart(m.text, finance.state) : null);
              return (
                <div className={`message-bubble ${m.role}`} key={i}>
                  <span className="message-label">{m.role === 'user' ? 'ALEX' : name.toUpperCase()}</span>
                  <p>{m.text}</p>
                  {isLastAssistant && inlineChart && <InlineAgentChart chart={inlineChart} />}
                </div>
              );
            })}
            {busy && pendingQuery && (
              <>
                <div className="message-bubble user">
                  <span className="message-label">ALEX</span>
                  <p>{pendingQuery}</p>
                </div>
                <div className="message-bubble assistant thinking-bubble" role="status">
                  <LoaderCircle size={16} className="spin" />
                  <span>{backend?.aiConfigured ? `${name} (${modelLabel}) sta analizzando i tuoi dati…` : `${name} sta elaborando la richiesta…`}</span>
                </div>
              </>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      {proposal && (
        <div className="proposal smart-proposal">
          <div className="proposal-header">
            <span className="section-eyebrow"><Sparkles size={13}/> CONTROLLA E CONFERMA</span>
            <span className="quiet-badge">{proposal.taskActions.length} attività{proposal.financeActions.length ? ` · ${proposal.financeActions.length} movimenti` : ''}</span>
          </div>
          <p className="proposal-lead">{proposal.message}</p>

          <div className="button-row proposal-top-actions">
            <button className="button primary btn-sm" disabled={busy} onClick={confirm}>
              Conferma e salva ({proposal.taskActions.length})
            </button>
            {proposal.taskActions.some(a => a.type === 'create_task') && (
              <>
                <button type="button" className="button secondary btn-sm" onClick={() => setAllProposalTasksStatus('done')}>
                  Segna tutte svolte (Log)
                </button>
                <button type="button" className="button ghost btn-sm" onClick={() => setAllProposalTasksStatus('todo')}>
                  Segna tutte da fare
                </button>
              </>
            )}
            <button className="button ghost btn-sm" disabled={busy} onClick={() => setProposal(null)}>Annulla</button>
          </div>

          {proposal.taskActions.length > 3 && (
            <div className="proposal-role-filters">
              <button
                type="button"
                className={!proposalAreaFilter ? 'active' : ''}
                onClick={() => setProposalAreaFilter('')}
              >
                Tutti ({proposal.taskActions.length})
              </button>
              {getAreas(state).map(area => {
                const c = proposal.taskActions.filter(a => a.args?.areaId === area.id).length;
                if (!c) return null;
                return (
                  <button
                    type="button"
                    key={area.id}
                    className={proposalAreaFilter === area.id ? 'active' : ''}
                    onClick={() => setProposalAreaFilter(proposalAreaFilter === area.id ? '' : area.id)}
                  >
                    <i className={`area-dot ${area.id}`} /> {area.name} ({c})
                  </button>
                );
              })}
            </div>
          )}

          {proposal.chart && <InlineAgentChart chart={proposal.chart} />}
          {proposal.financeActions.length > 0 && (
            <div className="proposal-finance-block">
              <ActionSummary actions={proposal.financeActions} state={finance.state} />
              {proposal.financeActions.map((a, i) => a.type === 'upsert' && a.args?.collection === 'transactions' && activeAccounts.length > 1 ? (
                <div key={i} className="proposal-account-switcher">
                  <span>Conto:</span>
                  <div className="account-pills">
                    {activeAccounts.slice(0, 5).map(acc => (
                      <button type="button" key={acc.id} className={`account-pill ${a.args.record.accountId === acc.id ? 'active' : ''}`} onClick={() => updateProposalFinanceAccount(i, acc.id)}>{acc.name}</button>
                    ))}
                  </div>
                </div>
              ) : null)}
            </div>
          )}
          {proposal.taskActions.length > 0 && (
            <div className="proposal-task-cards">
              {proposal.taskActions.map((a, i) => {
                if (proposalAreaFilter && a.args?.areaId !== proposalAreaFilter) return null;
                return (
                  <div className="proposal-task-card" key={i}>
                    <div className="proposal-task-top">
                      <Check size={15} className="proposal-check-icon" />
                      <strong>{a.args.title || ({ delete_task: 'Elimina attività selezionata', delete_project: 'Elimina progetto selezionato', forget_fact: 'Dimentica ricordo selezionato' }[a.type] || 'Aggiorna attività collegate')}</strong>
                      {proposal.taskActions.length > 1 && <button type="button" className="icon-button" aria-label="Rimuovi dalla proposta" onClick={() => removeProposalTask(i)}>×</button>}
                    </div>
                    {a.type === 'create_task' && (
                      <div className="proposal-task-controls">
                        <select aria-label="Dominio task" value={a.args.areaId || 'personale'} onChange={e => updateProposalTask(i, { areaId: e.target.value })}>
                          {getAreas(state).map(area => <option key={area.id} value={area.id}>{area.name}</option>)}
                        </select>
                        <select
                          aria-label="Stato task"
                          value={a.args.status || 'todo'}
                          onChange={e =>
                            updateProposalTask(i, {
                              status: e.target.value,
                              completedAt: e.target.value === 'done' ? `${a.args.dueAt?.slice(0, 10) || todayKey()}T18:00:00.000Z` : null,
                            })
                          }
                        >
                          <option value="done">Svolta (Registro)</option>
                          <option value="todo">Da fare</option>
                        </select>
                        <select aria-label="Priorità task" value={a.args.priority || 'normal'} onChange={e => updateProposalTask(i, { priority: e.target.value })}>
                          <option value="high">Priorità Alta</option>
                          <option value="normal">Normale</option>
                          <option value="low">Bassa</option>
                        </select>
                        <input type="date" aria-label="Data task" value={a.args.dueAt?.slice(0, 10) || ''} onChange={e => updateProposalTask(i, { dueAt: e.target.value || null })} />
                      </div>
                    )}
                    {a.args?.subtasks?.length > 0 && (
                      <ul className="proposal-subtasks">
                        {a.args.subtasks.map((s, si) => <li key={si}><ListChecks size={12}/> {s.title}</li>)}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="button-row proposal-sticky-footer">
            <button className="button primary" disabled={busy} onClick={confirm}>Conferma e salva ({proposal.taskActions.length})</button>
            <button className="button ghost" disabled={busy} onClick={() => setProposal(null)}>Annulla</button>
          </div>
        </div>
      )}

      <form onSubmit={send} className={`agent-input ${speech.listening ? 'is-listening' : ''} ${busy ? 'is-busy' : ''}`}>
        {speech.listening && (
          <div className="voice-live-banner" role="status">
            <span className="pulse-dot" />
            <strong>Microfono attivo: parla ora…</strong>
            <small>Il testo trascritto appare qui sotto in tempo reale</small>
          </div>
        )}
        <textarea
          aria-label="Messaggio al tuo agente"
          placeholder={speech.listening ? 'In ascolto…' : 'Incolla il registro attività del mese o scrivi a Merlino…'}
          value={text}
          onChange={e => setText(e.target.value)}
          maxLength={16000}
          rows={compact ? 2 : 3}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); } }}
        />
        <div>
          <span>
            {busy
              ? `${name} sta elaborando…`
              : speech.listening
              ? 'In ascolto continuo · premi il microfono per fermare'
              : 'Invio per mandare · Maiusc + Invio per andare a capo'}
          </span>
          <button className={`icon-button ${speech.listening ? 'listening' : ''}`} type="button" aria-label="Detta all’agente" onClick={speech.toggle}>
            {speech.listening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <button className="agent-send" aria-label="Invia al tuo agente" disabled={busy || !finance.state || !text.trim()}>
            {busy ? <LoaderCircle size={18} className="spin" /> : <ArrowUp size={20} />}
          </button>
        </div>
      </form>

      {!compact && <AgentMemory {...{ state, commit }} busy={busy || !!proposal}/>}
      {(error || speech.error) && <p className="form-error" role="alert">{error || speech.error}</p>}
    </section>
  );
}

export function AgentMemory({ state, commit, busy = false }) {
  const [name, setName] = useState(displayAdviserName(state.settings)), [error, setError] = useState('');
  const memories = state.settings.agentMemories || [], trash = state.settings.agentTrash || [];
  async function act(actions) { try { await commit(actions, 'Memoria aggiornata'); setError(''); } catch (error) { setError(error.message); } }
  return <details className="agent-memory"><summary><Brain size={14}/>Preferenze & Regole salvate <span>{memories.length}</span></summary><p>Qui ci sono le regole permanenti che seguiamo sempre (es. conto predefinito Hype, organizzazione domini). Puoi aggiungerne altre dicendo «Ricorda che…».</p><form onSubmit={async e => { e.preventDefault(); try { await commit([], 'Nome aggiornato', current => ({ ...current, settings: { ...current.settings, agentName: name.trim() } })); } catch (error) { setError(error.message); } }}><label>Nome dell’assistente<input value={name} maxLength={40} required onChange={e => setName(e.target.value)}/></label><button className="button ghost" disabled={busy}>Salva nome</button></form>{memories.map(m => <div className="memory-row" key={m.id}><p>{m.text}</p><button className="icon-button" disabled={busy} aria-label={'Dimentica: ' + m.text} onClick={() => act([{ type: 'forget_fact', args: { id: m.id } }])}><Trash2 size={14}/></button></div>)}{!!trash.length && <details className="agent-trash"><summary>Cestino attività · {trash.length}</summary>{trash.slice().reverse().map(r => <div className="memory-row" key={r.task.id}><p>{r.task.title}</p><button className="text-button" disabled={busy} onClick={() => act([{ type: 'restore_task', args: { id: r.task.id } }])}><RotateCcw size={13}/>Ripristina</button></div>)}</details>}{error && <p role="alert" className="form-error">{error}</p>}</details>;
}

export function AgentConnection({ backend }) {
  if (!backend?.hosted) return null;
  return (
    <section className="panel agent-connection">
      <h2>Sessione attiva</h2>
      <p>Archivio sincronizzato e Merlino AI operativi.</p>
      <form method="post" action="/logout"><button className="button ghost">Esci dall’archivio</button></form>
    </section>
  );
}
