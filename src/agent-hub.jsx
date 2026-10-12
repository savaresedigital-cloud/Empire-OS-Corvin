import React, { useState } from 'react';
import { ArrowUp, ArrowRight, Check, Mic, MicOff, Brain, Trash2, RotateCcw, Feather } from 'lucide-react';
import { useFinance } from './finance-context.jsx';
import { applyActions, todayKey } from './domain.js';
import { applyFinance } from './finance-domain.js';
import { localEmpireRequest, directAgentRequest, validateAgentResult } from './empire-agent.js';
import { ActionSummary } from './finance-action-summary.jsx';
import { adviserName } from './finance-planning.js';
export function AssistantWorkspace({ state, commit, backend, useSpeech, navigate }) {
  const finance = useFinance(), [text, setText] = useState(''), [busy, setBusy] = useState(false), [proposal, setProposal] = useState(null), [error, setError] = useState(''), [expanded, setExpanded] = useState(false);
  const speech = useSpeech(setText), messages = state.settings.agentConversation || [];
  const name = adviserName(state.settings);
  async function remember(input, result, actions = []) {
    return commit([], actions.length ? 'Attività aggiornate' : null, current => {
      const next = actions.length ? applyActions(current, actions, crypto.randomUUID()) : structuredClone(current);
      if ((next.plans[todayKey()] || []).length > 3) next.settings.priorityCount = 5;
      next.settings.agentConversation = [...(next.settings.agentConversation || []), { role: 'user', text: input }, { role: 'assistant', text: result }].slice(-40); return next;
    });
  }
  async function send(event, supplied) {
    event?.preventDefault(); const input = (supplied || text).trim(); if (!input || busy || proposal || !finance.state) return;
    setBusy(true); setError(''); setText('');
    try {
      let result;
      const direct = directAgentRequest(input, state, finance.state);
      if (direct) result = direct;
      else if (backend?.aiConfigured) {
        const response = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: input }) });
        const body = await response.json(); if (!response.ok) throw new Error(body.error || 'L’agente non ha risposto. Riprova.'); result = body;
      } else result = localEmpireRequest(input, state, finance.state);
      result = validateAgentResult(result, state, finance.state);
      if (result.financeActions.length || result.taskActions.some(a => ['delete_task', 'delete_project', 'forget_fact'].includes(a.type))) setProposal({ ...result, input, taskSnapshot: JSON.stringify(state), financeSnapshot: JSON.stringify(finance.current()) });
      else await remember(input, result.message + (result.taskActions.length ? '\nAggiornamento salvato.' : ''), result.taskActions);
    } catch (e) { setText(input); setError(e.message); } finally { setBusy(false); }
  }
  async function confirm() {
    setBusy(true); const before = state; let tasksWritten = false, financeWritten = false;
    try {
      if (proposal.taskSnapshot !== JSON.stringify(state) || proposal.financeSnapshot !== JSON.stringify(finance.current())) throw new Error('I dati sono cambiati. Annulla e chiedimi di nuovo la registrazione.');
      validateAgentResult(proposal, state, finance.current());
      if (proposal.taskActions.length) { await commit(proposal.taskActions, 'Attività aggiornate'); tasksWritten = true; }
      if (proposal.financeActions.length) { await finance.save(current => applyFinance(current, proposal.financeActions, crypto.randomUUID())); financeWritten = true; }
      const forgetting = proposal.taskActions.some(a=>a.type==='forget_fact');
      await remember(forgetting ? 'Rimuovi ricordo' : proposal.input, forgetting ? 'Ricordo rimosso. Conversazione precedente svuotata.' : proposal.message + '\nRegistrazione salvata.'); setProposal(null);
    } catch (e) {
      if (tasksWritten && !financeWritten) { try { await commit([], 'Attività ripristinate', () => before); } catch { setError('Controlla le attività: il ripristino non è riuscito.'); } }
      if (financeWritten) { setProposal(null); setError('Registrazione salvata. Non è stato possibile salvare la conversazione.'); } else setError(e.message);
    } finally { setBusy(false); }
  }
  return <section id="agente" className="agent-hub panel" aria-label="Agente personale"><header><div className="agent-sigil"><Feather size={27} strokeWidth={1.2}/></div><h2>{name}</h2><span className={`agent-ready ${backend?.aiConfigured ? 'connected' : ''}`}>{backend?.aiConfigured ? 'AI collegata' : 'AI non collegata'}</span></header>{!backend?.aiConfigured && <p className="agent-intro">Sono attivi i comandi per attività, memoria e calcoli. Per ragionare insieme su richieste libere serve collegare l’AI.</p>}
    {!!messages.length && <div className="agent-history"><button className="text-button" onClick={() => setExpanded(!expanded)}>{expanded ? 'Riduci conversazione' : 'Riprendi la conversazione'}</button><div className={`agent-messages ${expanded ? 'expanded' : ''}`} aria-live="polite">{messages.slice(expanded ? -40 : -2).map((m, i) => <div className={`message ${m.role}`} key={i}><span className="message-label">{m.role === 'user' ? 'TU' : name.toUpperCase()}</span><p>{m.text}</p></div>)}</div></div>}
    {proposal && <div className="proposal"><span className="section-eyebrow">CONTROLLA LA REGISTRAZIONE</span><p>{proposal.message}</p><ActionSummary actions={proposal.financeActions} state={finance.state} />{proposal.taskActions.map((a, i) => <p key={i}><Check size={14} />{a.args.title || ({delete_task:'Elimina attività selezionata',delete_project:'Elimina progetto selezionato',forget_fact:'Dimentica ricordo selezionato'}[a.type] || 'Aggiorna attività collegate')}</p>)}<div className="button-row"><button className="button primary" disabled={busy} onClick={confirm}>Conferma e salva</button><button className="button ghost" disabled={busy} onClick={() => setProposal(null)}>Annulla</button></div></div>}
    <form onSubmit={send} className="agent-input"><textarea aria-label="Messaggio al tuo agente" placeholder="Aggiungi un’attività, ricorda un dettaglio o calcola uno scenario…" value={text} onChange={e => setText(e.target.value)} maxLength={6000} rows={2} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); } }} /><div><span>{busy ? 'Un momento…' : speech.listening ? 'In ascolto…' : 'Invio per chiedere · Maiuscole + Invio per andare a capo'}</span><button className="icon-button" type="button" aria-label="Detta all’agente" onClick={speech.toggle}>{speech.listening ? <MicOff size={18} /> : <Mic size={18} />}</button><button className="agent-send" aria-label="Invia al tuo agente" disabled={busy || !finance.state || !text.trim() || !!proposal}><ArrowUp size={20} /></button></div></form>
    <div className="agent-shortcuts">{['Prepara oggi', 'Entrate e spese del mese'].map(s => <button key={s} disabled={busy || !finance.state || !!proposal} onClick={e => send(e, s)}><ArrowRight size={12} />{s}</button>)}<button disabled={busy || !!proposal} onClick={()=>navigate?.('finance',{financeView:'planning'})}><ArrowRight size={12}/>Crea un prospetto</button></div>
    <AgentMemory {...{state,commit}} busy={busy || !!proposal}/>
    {!backend?.aiConfigured && <button className="text-button agent-connect" onClick={() => navigate?.('settings')}>Collega l’AI per richieste libere, offerte e pianificazione</button>}{(error || speech.error) && <p className="form-error" role="alert">{error || speech.error}</p>}
  </section>;
}
export function AgentMemory({ state, commit, busy = false }) {
  const [name, setName] = useState(adviserName(state.settings)), [error, setError] = useState('');
  const memories = state.settings.agentMemories || [], trash = state.settings.agentTrash || [];
  async function act(actions) { try { await commit(actions, 'Memoria aggiornata'); setError(''); } catch (error) { setError(error.message); } }
  return <details className="agent-memory"><summary><Brain size={14}/>Cosa ricordo <span>{memories.length}</span></summary><p>Salvo ciò che mi chiedi con «Ricorda che…». I ricordi restano nel tuo archivio anche quando la conversazione si accorcia.</p><form onSubmit={async e => { e.preventDefault(); try { await commit([], 'Nome aggiornato', current => ({...current, settings:{...current.settings,agentName:name.trim()}})); } catch(error) { setError(error.message); } }}><label>Come vuoi chiamarmi<input value={name} maxLength={40} required onChange={e => setName(e.target.value)}/></label><button className="button ghost" disabled={busy}>Salva nome</button></form>{memories.map(m => <div className="memory-row" key={m.id}><p>{m.text}</p><button className="icon-button" disabled={busy} aria-label={'Dimentica: ' + m.text} onClick={() => act([{type:'forget_fact',args:{id:m.id}}])}><Trash2 size={14}/></button></div>)}<small>Quando dimentico un ricordo svuoto anche la conversazione attiva, così non torna dalle vecchie risposte. Le copie di sicurezza restano nell’archivio.</small>{!!trash.length && <details className="agent-trash"><summary>Cestino attività · {trash.length}</summary>{trash.slice().reverse().map(r => <div className="memory-row" key={r.task.id}><p>{r.task.title}</p><button className="text-button" disabled={busy} onClick={() => act([{type:'restore_task',args:{id:r.task.id}}])}><RotateCcw size={13}/>Ripristina</button></div>)}</details>}{error && <p role="alert" className="form-error">{error}</p>}</details>;
}
export function AgentConnection({ onConnected }) {
  const [key, setKey] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  return <section className="panel agent-connection"><span className="section-eyebrow">AGENTE PERSONALE</span><h2>Collega Gemini</h2><p>La chiave resta sul server privato. L’agente riceve le attività, i prodotti e i riepiloghi necessari alla richiesta.</p><form onSubmit={async e => { e.preventDefault(); setBusy(true); setMessage(''); try { const response = await fetch('/api/agent/key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setKey(''); setMessage('Agente collegato. Puoi tornare alla home.'); onConnected?.(); } catch (error) { setMessage(error.message); } finally { setBusy(false); } }}><label>Chiave API Gemini<input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} required minLength={20} /></label><button className="button primary" disabled={busy}>{busy ? 'Verifica collegamento…' : 'Verifica e collega'}</button></form>{message && <p role="status">{message}</p>}</section>;
}
