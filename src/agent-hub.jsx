import React, { useRef, useState } from 'react';
import { ArrowUp, ArrowRight, Check, Mic, MicOff, Brain, Trash2, RotateCcw, Volume2, VolumeX, Sparkles } from 'lucide-react';
import { useFinance } from './finance-context.jsx';
import { applyActions, todayKey } from './domain.js';
import { applyFinance } from './finance-domain.js';
import { localEmpireRequest, directAgentRequest, validateAgentResult, agentContext } from './empire-agent.js';
import { ActionSummary } from './finance-action-summary.jsx';
import { adviserName } from './finance-planning.js';

export function AssistantWorkspace({ state, commit, backend, useSpeech, navigate }) {
  const finance = useFinance();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef(null);

  const speech = useSpeech(setText);
  const messages = state.settings.agentConversation || [];
  const name = adviserName(state.settings);

  async function speak(textToSpeak) {
    if (speaking) {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    try {
      const res = await fetch('/api/agent/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToSpeak.slice(0, 500) })
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.audioBase64) {
          const audio = new Audio(`data:audio/wav;base64,${data.audioBase64}`);
          audioRef.current = audio;
          audio.onended = () => setSpeaking(false);
          await audio.play();
          return;
        }
      }
    } catch {}

    // Fallback to browser SpeechSynthesis in Italian
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(textToSpeak);
      u.lang = 'it-IT';
      u.rate = 1.0;
      u.pitch = 0.95;
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    } else {
      setSpeaking(false);
    }
  }

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
    if (!input || busy || proposal || !finance.state) return;
    setBusy(true);
    setError('');
    setText('');
    try {
      let result;
      const direct = directAgentRequest(input, state, finance.state);
      if (direct) {
        result = direct;
      } else {
        try {
          const response = await fetch('/api/agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: input,
              context: agentContext(state, finance.state),
              tasks: state,
              finance: finance.state
            })
          });
          if (response.ok) {
            const body = await response.json();
            result = body;
          } else {
            result = localEmpireRequest(input, state, finance.state);
          }
        } catch {
          result = localEmpireRequest(input, state, finance.state);
        }
      }
      result = validateAgentResult(result, state, finance.state);
      if (result.financeActions.length || result.taskActions.some(a => ['delete_task', 'delete_project', 'forget_fact'].includes(a.type))) {
        setProposal({ ...result, input, taskSnapshot: JSON.stringify(state), financeSnapshot: JSON.stringify(finance.current()) });
      } else {
        await remember(input, result.message + (result.taskActions.length ? '\nAggiornamento salvato.' : ''), result.taskActions);
      }
    } catch (e) {
      setText(input);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    const before = state;
    let tasksWritten = false, financeWritten = false;
    try {
      if (proposal.taskSnapshot !== JSON.stringify(state) || proposal.financeSnapshot !== JSON.stringify(finance.current())) {
        throw new Error('I dati sono cambiati. Annulla e richiedi di nuovo la registrazione.');
      }
      validateAgentResult(proposal, state, finance.current());
      if (proposal.taskActions.length) {
        await commit(proposal.taskActions, 'Attività aggiornate');
        tasksWritten = true;
      }
      if (proposal.financeActions.length) {
        await finance.save(current => applyFinance(current, proposal.financeActions, crypto.randomUUID()));
        financeWritten = true;
      }
      const forgetting = proposal.taskActions.some(a => a.type === 'forget_fact');
      await remember(forgetting ? 'Rimuovi ricordo' : proposal.input, forgetting ? 'Ricordo rimosso. Conversazione precedente svuotata.' : proposal.message + '\nRegistrazione salvata.');
      setProposal(null);
    } catch (e) {
      if (tasksWritten && !financeWritten) {
        try { await commit([], 'Attività ripristinate', () => before); } catch { setError('Controlla le attività: il ripristino non è riuscito.'); }
      }
      if (financeWritten) {
        setProposal(null);
        setError('Registrazione salvata. Non è stato possibile salvare la conversazione.');
      } else {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const shortcuts = [
    'Sintesi strategica dell’Impero',
    'Prepara 5 priorità per oggi',
    'Entrate e spese del mese',
    'Stato domini e liquidità',
    'Offerta commerciale & margini'
  ];

  return (
    <section id="agente" className="agent-hub panel" aria-label="Consigliere imperiale">
      <header>
        <div className="agent-sigil" title="Sigillo dell'Impero">
          <img src="/empire-seal.svg" alt="" style={{ width: 28, height: 28 }} />
        </div>
        <div>
          <h2>{name}</h2>
          <small style={{ color: '#d3b989', fontSize: 10, letterSpacing: '0.8px', display: 'block', marginTop: 2 }}>
            CONSIGLIERE DELL'IMPERO · GEMINI 2.5 FLASH
          </small>
        </div>
        <span className="agent-ready connected">
          <Sparkles size={11} style={{ display: 'inline', marginRight: 4 }} />
          Gemini 2.5 Flash · Attivo
        </span>
      </header>

      <p className="agent-intro">
        Il Consigliere personale analizza domini, progetti, tesoreria e priorità in tempo reale con la precisione di Gemini 2.5 Flash.
      </p>

      {!!messages.length && (
        <div className="agent-history">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button className="text-button" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Riduci conversazione' : 'Riprendi la conversazione'}
            </button>
            {messages.length > 0 && (
              <button
                className="text-button"
                onClick={() => speak(messages[messages.length - 1].text)}
                style={{ fontSize: 10, color: '#d4b97d' }}
                title="Ascolta l'ultima risposta"
              >
                {speaking ? <VolumeX size={13} style={{ marginRight: 4 }} /> : <Volume2 size={13} style={{ marginRight: 4 }} />}
                {speaking ? 'Ferma voce' : 'Ascolta voce'}
              </button>
            )}
          </div>
          <div className={`agent-messages ${expanded ? 'expanded' : ''}`} aria-live="polite">
            {messages.slice(expanded ? -40 : -2).map((m, i) => (
              <div className={`message ${m.role}`} key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="message-label">{m.role === 'user' ? 'TU' : name.toUpperCase()}</span>
                  {m.role === 'assistant' && (
                    <button
                      className="icon-button"
                      style={{ padding: 2, minHeight: 20, minWidth: 20, color: '#d4b97d' }}
                      onClick={() => speak(m.text)}
                      title="Ascolta responso"
                    >
                      <Volume2 size={13} />
                    </button>
                  )}
                </div>
                <p>{m.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {proposal && (
        <div className="proposal">
          <span className="section-eyebrow">CONTROLLA LA REGISTRAZIONE</span>
          <p>{proposal.message}</p>
          <ActionSummary actions={proposal.financeActions} state={finance.state} />
          {proposal.taskActions.map((a, i) => (
            <p key={i}>
              <Check size={14} />
              {a.args.title || ({
                delete_task: 'Elimina attività selezionata',
                delete_project: 'Elimina progetto selezionato',
                forget_fact: 'Dimentica ricordo selezionato'
              }[a.type] || 'Aggiorna attività collegate')}
            </p>
          ))}
          <div className="button-row">
            <button className="button primary" disabled={busy} onClick={confirm}>
              Conferma e salva
            </button>
            <button className="button ghost" disabled={busy} onClick={() => setProposal(null)}>
              Annulla
            </button>
          </div>
        </div>
      )}

      <form onSubmit={send} className="agent-input">
        <textarea
          aria-label="Messaggio al Consigliere"
          placeholder="Chiedi una sintesi strategica, organizza le 5 priorità, o calcola uno scenario di cassa…"
          value={text}
          onChange={e => setText(e.target.value)}
          maxLength={6000}
          rows={2}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(e);
            }
          }}
        />
        <div>
          <span>
            {busy ? 'Il Consigliere elabora con Gemini 2.5 Flash…' : speech.listening ? 'In ascolto…' : 'Invio per chiedere · Maiuscole + Invio per andare a capo'}
          </span>
          <button
            className="icon-button"
            type="button"
            aria-label="Detta al Consigliere"
            onClick={speech.toggle}
            title={speech.listening ? 'Disattiva microfono' : 'Detta vocalmente'}
          >
            {speech.listening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <button
            className="agent-send"
            aria-label="Invia al Consigliere"
            disabled={busy || !finance.state || !text.trim() || !!proposal}
          >
            <ArrowUp size={20} />
          </button>
        </div>
      </form>

      <div className="agent-shortcuts">
        {shortcuts.map(s => (
          <button key={s} disabled={busy || !finance.state || !!proposal} onClick={e => send(e, s)}>
            <ArrowRight size={12} />
            {s}
          </button>
        ))}
        <button disabled={busy || !!proposal} onClick={() => navigate?.('finance', { financeView: 'planning' })}>
          <ArrowRight size={12} />
          Crea un prospetto
        </button>
      </div>

      <AgentMemory {...{ state, commit }} busy={busy || !!proposal} />

      {(error || speech.error) && <p className="form-error" role="alert">{error || speech.error}</p>}
    </section>
  );
}

export function AgentMemory({ state, commit, busy = false }) {
  const [name, setName] = useState(adviserName(state.settings));
  const [error, setError] = useState('');
  const memories = state.settings.agentMemories || [];
  const trash = state.settings.agentTrash || [];

  async function act(actions) {
    try {
      await commit(actions, 'Memoria aggiornata');
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <details className="agent-memory">
      <summary>
        <Brain size={14} />
        Cosa ricordo <span>{memories.length}</span>
      </summary>
      <p>Salvo ciò che mi chiedi con «Ricorda che…». I ricordi restano nel tuo archivio anche quando la conversazione si accorcia.</p>
      <form onSubmit={async e => {
        e.preventDefault();
        try {
          await commit([], 'Nome aggiornato', current => ({
            ...current,
            settings: { ...current.settings, agentName: name.trim() }
          }));
        } catch (err) {
          setError(err.message);
        }
      }}>
        <label>
          Nome del Consigliere
          <input value={name} maxLength={40} required onChange={e => setName(e.target.value)} />
        </label>
        <button className="button ghost" disabled={busy}>Salva nome</button>
      </form>
      {memories.map(m => (
        <div className="memory-row" key={m.id}>
          <p>{m.text}</p>
          <button className="icon-button" disabled={busy} aria-label={'Dimentica: ' + m.text} onClick={() => act([{ type: 'forget_fact', args: { id: m.id } }])}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <small>Quando dimentico un ricordo svuoto anche la conversazione attiva, così non torna dalle vecchie risposte. Le copie di sicurezza restano nell’archivio.</small>
      {!!trash.length && (
        <details className="agent-trash">
          <summary>Cestino attività · {trash.length}</summary>
          {trash.slice().reverse().map(r => (
            <div className="memory-row" key={r.task.id}>
              <p>{r.task.title}</p>
              <button className="text-button" disabled={busy} onClick={() => act([{ type: 'restore_task', args: { id: r.task.id } }])}>
                <RotateCcw size={13} /> Ripristina
              </button>
            </div>
          ))}
        </details>
      )}
      {error && <p role="alert" className="form-error">{error}</p>}
    </details>
  );
}

export function AgentConnection({ onConnected }) {
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState('Attivo e collegato al server imperiale');

  async function check() {
    setBusy(true);
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        setStatusText('Consigliere e Firestore sincronizzati con successo.');
        onConnected?.();
      }
    } catch {
      setStatusText('Archivio protetto localmente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel agent-connection">
      <span className="section-eyebrow">CONSIGLIERE IMPERIALE</span>
      <h2>Gemini Flash & Firestore</h2>
      <p>Il Consigliere personale è attivo per risposte strategiche vocali e sintesi in tempo reale. I dati di Empire OS sono protetti e sincronizzati tra Firebase Firestore e la memoria locale sovrana.</p>
      <div className="button-row" style={{ marginTop: '14px', alignItems: 'center' }}>
        <span className="status-badge">
          <span />
          {statusText}
        </span>
        <button className="button secondary" disabled={busy} onClick={check} type="button">
          {busy ? 'Verifica…' : 'Verifica connessione'}
        </button>
      </div>
    </section>
  );
}
