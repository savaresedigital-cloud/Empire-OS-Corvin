import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Mic, MicOff, Send, ShieldCheck, Feather } from 'lucide-react';
import { useFinance } from './finance-context.jsx';
import { parseFinanceCommand } from './finance-tools.js';
import { applyFinance, moneyToCents, validateFinance } from './finance-domain.js';
import { parseCommands, applyActions } from './domain.js';
import { getCloudSession } from './finance-cloud.js';
import { interpretFinanceWithGemini } from './finance-ai.js';
import { ActionSummary } from './finance-action-summary.jsx';

const money = (amount,currency='EUR') => new Intl.NumberFormat('it-IT',{style:'currency',currency}).format(amount/100);
export function AssistantWorkspace({state,commit,backend,openTask,useSpeech}) {
  const finance=useFinance(); const [mode,setMode]=useState('local'); const [text,setText]=useState(''); const [messages,setMessages]=useState([]);const [proposal,setProposal]=useState(null);const [busy,setBusy]=useState(false);const speech=useSpeech(setText);const end=useRef();
  useEffect(()=>{end.current?.scrollIntoView({behavior:'smooth',block:'nearest'});},[messages,proposal]);
  function answer(message) {setMessages(m=>[...m,{role:'assistant',text:message}]);}
  async function send(event) {
    event?.preventDefault(); if(!text.trim()||busy||proposal)return;
    setBusy(true);const input=text.trim();setMessages(m=>[...m,{role:'user',text:input}]);setText('');
    try {
      const parts=input.split(/\s+e\s+(?=ricordami\b)/i); const financeInput=parts[0];
      const result=mode==='gemini' ? await interpretFinanceWithGemini(financeInput,finance.state,{url:`${(import.meta.env.VITE_API_BASE_URL||'').replace(/\/$/,'')}/api/finance/interpret`}) : finance.state?parseFinanceCommand(financeInput,finance.state):{handled:false};
      if(result.handled){
        const financeActions=result.actions||[];
        if(!financeActions.length)answer(result.message);
        let taskActions=[];
        if(parts.length>1){const task=parseCommands(parts.slice(1).join(' e '),state);if(!task.actions.length){answer(task.message);return;}taskActions=task.actions;}
        if(!financeActions.length&&!taskActions.length)return;
        setProposal({financeActions,taskActions,summary:financeActions.length?result.summary:undefined,operationId:result.operationId,financeSnapshot:JSON.stringify(finance.state),taskSnapshot:JSON.stringify(state)});return;
      }
      const task=parseCommands(input,state);
      if(task.actions.length)setProposal({financeActions:[],taskActions:task.actions,taskSnapshot:JSON.stringify(state)});else answer(task.message);
    }catch(e){answer(e.message);}finally{setBusy(false);}
  }
  async function confirm(){
    if(!proposal||busy)return;setBusy(true);
    const operationId=proposal.operationId||crypto.randomUUID();const previousTasks=state;const previousFinance=finance.current();let taskWritten=false;
    try{
      if(proposal.taskActions.length&&JSON.stringify(state)!==proposal.taskSnapshot)throw new Error('Le attività sono cambiate. Invia di nuovo il comando.');
      if(proposal.financeActions.length&&JSON.stringify(finance.current())!==proposal.financeSnapshot)throw new Error('Le finanze sono cambiate. Invia di nuovo il comando.');
      // Validate both domains before the first write. Mixed commands compensate a failed second write.
      if(proposal.taskActions.length)applyActions(state,proposal.taskActions,operationId);
      if(proposal.financeActions.length)applyFinance(previousFinance,proposal.financeActions,operationId);
      if(proposal.taskActions.length){await commit(proposal.taskActions,'Attività salvate');taskWritten=true;}
      if(proposal.financeActions.length)await finance.save(current=>applyFinance(current,proposal.financeActions,operationId));
      answer(`${proposal.financeActions.length?'Movimento salvato. ':''}${proposal.taskActions.length?`${proposal.taskActions.length} attività salvate.`:''}`.trim());setProposal(null);
    }catch(e){
      if(taskWritten&&proposal.financeActions.length){try{await commit([],'Comando misto annullato',()=>previousTasks);answer(`Comando annullato: ${e.message}`);}catch{answer(`Il movimento non è stato salvato. Le attività sono state salvate, ma non è stato possibile ripristinarle: controllale prima di riprovare. ${e.message}`);}}
      else answer(`Operazione non salvata: ${e.message}`);
    }finally{setBusy(false);}
  }
  function editFinancial(index,key,value){setProposal(p=>({...p,financeActions:p.financeActions.map((action,i)=>i===index?{...action,args:{...action.args,record:{...action.args.record,[key]:value}}}:action)}));}
  return <><div className="page-heading"><h1>Assistente</h1><select aria-label="Modalità assistente" value={mode} onChange={e=>setMode(e.target.value)}><option value="local">Comandi locali · non AI</option><option value="gemini" disabled={!backend?.aiConfigured||!getCloudSession()}>Gemini · Finanze{!backend?.aiConfigured||!getCloudSession()?' · da collegare':''}</option></select></div><section className="assistant-layout panel"><aside className="assistant-info"><span className="assistant-emblem"><img src="/empire-seal.svg" alt=""/></span><h2>Comandi disponibili</h2><p>Attività, saldi, spese e trasferimenti. Controlla le registrazioni prima di confermare.</p><div className="assistant-status"><ShieldCheck size={17}/><div><strong>{mode==='local'?'Elaborazione locale':'Interpretazione Gemini'}</strong><small>{mode==='local'?'I comandi non vengono inviati a Gemini. ':'Indice dei dati inviato al backend autenticato per interpretare la richiesta. '}{backend?.aiConfigured?'Backend configurato; accesso Firebase richiesto.':'AI da collegare.'}</small></div></div><div className="voice-support"><Mic size={17}/><span>{speech.supported?'Trascrizione disponibile nel browser. Il servizio vocale può richiedere rete.':'Trascrizione non supportata. Usa il testo.'}</span></div><button className="text-button" onClick={openTask}>Nuova attività <ArrowRight size={14}/></button></aside><div className="conversation"><div className="messages" aria-live="polite">{!messages.length&&<div className="assistant-welcome"><div className="conversation-icon"><Feather size={23}/></div><h3>Scrivi un comando</h3><p>Puoi creare un’attività o interrogare i dati finanziari registrati.</p><div className="suggestions">{['Devo fotografare il banco per Zerilli','Qual è la mia liquidità attuale?','Oggi ho speso 24 euro di benzina'].map(s=><button key={s} onClick={()=>setText(s)}>{s}<ArrowRight size={14}/></button>)}</div></div>}{messages.map((m,i)=><div className={`message ${m.role}`} key={i}>{m.role==='assistant'&&<span className="message-label">ASSISTENTE</span>}<p>{m.text}</p></div>)}{proposal&&<div className="proposal"><span className="eyebrow">ANTEPRIMA OPERAZIONI</span>{proposal.summary&&<h3>{proposal.summary}</h3>}{proposal.financeActions.map((a,i)=>{const record=a.args.collection==='transactions'?{...finance.state.transactions.find(t=>t.id===a.args.record?.id),...a.args.record}:null;if(!record)return <ActionSummary key={i} actions={[a]} state={finance.state}/>;return <div className="assistant-finance-proposal" key={record.id||i}><strong>{record.type==='transfer'?'Trasferimento':record.type==='expense'?'Uscita':'Entrata'} · {money(record.amountCents,record.currency)}</strong><label>Conto<select value={record.accountId} onChange={e=>editFinancial(i,'accountId',e.target.value)}>{finance.state.accounts.filter(x=>x.currency===record.currency&&x.active&&!['debit','aggregate'].includes(x.type)).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>{record.type==='transfer'&&<label>Destinazione<select value={record.toAccountId} onChange={e=>editFinancial(i,'toAccountId',e.target.value)}>{finance.state.accounts.filter(x=>x.currency===record.currency&&x.active&&!['debit','aggregate'].includes(x.type)).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}<label>Data<input type="date" value={record.date} onInput={e=>editFinancial(i,'date',e.target.value)} onChange={()=>{}}/></label><label>Categoria<select value={record.categoryId||''} onChange={e=>editFinancial(i,'categoryId',e.target.value||null)}><option value="">Da classificare</option>{finance.state.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Descrizione<input value={record.description} onChange={e=>editFinancial(i,'description',e.target.value)}/></label></div>;})}{proposal.taskActions.map((a,i)=><div key={i}><Check size={15}/><span>{a.type==='create_task'?`Aggiungi attività: ${a.args.title}`:a.type==='complete_task'?`Completa: ${state.tasks.find(t=>t.id===a.args.id)?.title}`:a.type.replaceAll('_',' ')}</span></div>)}<div className="button-row"><button className="button primary" disabled={busy} onClick={confirm}>{busy?'Salvataggio…':'Conferma e salva'}</button><button className="button ghost" disabled={busy} onClick={()=>setProposal(null)}>Annulla</button></div></div>}<div ref={end}/></div><div className="assistant-composer"><form onSubmit={send}><textarea aria-label="Messaggio all’assistente" maxLength={6000} placeholder="Scrivi o detta un comando…" value={text} onChange={e=>setText(e.target.value)} rows={2} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send(e);}}}/><div><span>{speech.listening?'In ascolto…':'Controlla la trascrizione prima di inviare'}</span><button className="icon-button" aria-label="Microfono assistente" type="button" onClick={speech.toggle}>{speech.listening?<MicOff size={19}/>:<Mic size={19}/>}</button><button className="capture-send" aria-label="Invia messaggio" disabled={!text.trim()||busy||!!proposal}><Send size={17}/></button></div></form>{speech.error&&<p className="form-error" role="alert">{speech.error}</p>}</div></div></section></>;
}
