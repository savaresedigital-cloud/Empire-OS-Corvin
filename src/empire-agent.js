import { applyActions, parseCommands, todayKey } from './domain.js';
import { applyFinance, financialReport, moneyToCents } from './finance-domain.js';
import { adviserName, periodMonths, projectCash } from './finance-planning.js';
import { parseFinanceCommand } from './finance-tools.js';
import { businessMetrics, euro, monthPeriod, suggestDay } from './empire-metrics.js';
import { incomeBreakdown, incomeSource, wealthHistory, wealthObservation } from './finance-insights.js';
const taskTypes = new Set(['create_task', 'update_task', 'complete_task', 'create_project', 'update_project', 'set_daily_priorities', 'delete_task', 'restore_task', 'delete_project', 'remember_fact', 'forget_fact']);
export function validateAgentResult(result, tasks, finance) {
  if (!result || typeof result.message !== 'string' || result.message.length > 12000) throw new Error('Risposta agente non valida.');
  const taskActions = result.taskActions || [], financeActions = result.financeActions || [];
  if (!Array.isArray(taskActions) || taskActions.length > 20 || taskActions.some(a => !taskTypes.has(a.type))) throw new Error('Operazioni attività non consentite.');
  if (!Array.isArray(financeActions) || financeActions.length > 10 || financeActions.some(a => !['upsert', 'remove'].includes(a.type) || !['transactions', 'accounts', 'orders', 'businessCosts', 'businesses'].includes(a.args?.collection))) throw new Error('Operazioni finanziarie non consentite.');
  if (taskActions.length) applyActions(tasks, taskActions, crypto.randomUUID());
  if (financeActions.length) applyFinance(finance, financeActions, crypto.randomUUID());
  return { message: result.message, taskActions, financeActions };
}
const normalized = value => String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
export function directAgentRequest(message, tasks, finance) {
  const reply = (text, taskActions = [], financeActions = []) => ({ message: text, taskActions, financeActions });
  const raw = message.trim(), name = [adviserName(tasks.settings), tasks.settings.agentName, 'Nox'].filter(Boolean).find(n=>raw.toLowerCase().startsWith(n.toLowerCase()) && /^[, :]/.test(raw.slice(n.length)));
  const input = name ? raw.slice(name.length).replace(/^[, :]+/, '') : raw;
  if (/prospett|scenario|proiezion|quanto.*guadagner|quanto.*avr[òo]|se\s+.*(?:incasso|guadagno)/i.test(input)) {
    const incoming = input.match(/(?:incasso|guadagno|entrate(?:\s+di)?)\s+([\d.,]+)/i), outgoing = input.match(/(?:spendo|spese(?:\s+di)?)\s+([\d.,]+)/i), horizon = input.match(/\b(\d{1,2})\s+mesi\b/i);
    if (incoming && outgoing && horizon) {
      try { const rows=projectCash({incomeCents:moneyToCents(incoming[1].replace(/[.,]+$/,'')),expenseCents:moneyToCents(outgoing[1].replace(/[.,]+$/,'')),months:Number(horizon[1])}),last=rows.at(-1);return reply(`Con l’ipotesi di ${euro(last.income)} di entrate e ${euro(last.expense)} di spese ogni mese, la differenza sarebbe ${euro(last.net)} al mese e ${euro(last.cumulative)} in ${rows.length} mesi interi, a partire da ${rows[0].date}.\nÈ uno scenario: non è un incasso previsto né il saldo futuro. Per il saldo serve il punto di partenza. Puoi modificare e salvare le ipotesi in Finanze → Prospetti.`); } catch(error) { return reply(error.message); }
    }
    return null;
  }
  const memory = input.match(/^(?:ricorda(?:ti)?|tieni a mente|memorizza)\s+(?:che\s+)?(.+)$/is);
  if (memory) return reply('Terrò a mente: ' + memory[1], [{ type: 'remember_fact', args: { text: memory[1].trim() } }]);
  if (/^(?:cosa|che cosa|quali cose)\s+(?:ti\s+)?ricordi|^mostra (?:la )?memoria/i.test(input)) return reply((tasks.settings.agentMemories || []).map(m => '• ' + m.text).join('\n') || 'Non ho ancora ricordi salvati. Puoi dirmi «Ricorda che…».');
  const forget = input.match(/^dimentica\s+(?:che\s+)?(.+)$/is);
  if (forget) {
    const rows = (tasks.settings.agentMemories || []).filter(m => normalized(m.text).includes(normalized(forget[1])));
    return rows.length === 1 ? reply('Dimenticherò: ' + rows[0].text, [{ type: 'forget_fact', args: { id: rows[0].id } }]) : reply(rows.length ? 'Ho trovato più ricordi. Indica quale vuoi dimenticare.' : 'Non trovo un ricordo corrispondente. Apri «Cosa ricordo» per controllare.');
  }
  const remove = input.match(/^(elimina|cancella|rimuovi|ripristina)\s+(?:il |la |l[’']|un |una )?(task|attivit[àa]|progetto|movimento|transazione|conto|business|ordine|costo)\s+(.+)$/is);
  if (!remove) return null;
  const collection = { task: 'tasks', attività: 'tasks', attivita: 'tasks', progetto: 'projects', movimento: 'transactions', transazione: 'transactions', conto: 'accounts', business: 'businesses', ordine: 'orders', costo: 'businessCosts' }[remove[2].toLowerCase()];
  const restore = remove[1].toLowerCase() === 'ripristina';
  if (restore && collection !== 'tasks') return reply('Posso ripristinare un’attività dal cestino. Per i dati finanziari usa «Annulla ultima modifica» nelle Finanze.');
  const query = normalized(remove[3].replace(/^[«"']|[»"']$/g, ''));
  const rows = restore ? (tasks.settings.agentTrash || []).map(r => r.task) : ['tasks', 'projects'].includes(collection) ? tasks[collection] : finance[collection];
  const label = row => row.title || row.name || row.description || row.notes || row.id;
  const exact = rows.filter(r => normalized(r.id) === query || normalized(label(r)) === query);
  const matches = exact.length ? exact : query.length >= 3 ? rows.filter(r => normalized(label(r)).includes(query)) : [];
  if (matches.length !== 1) return reply(matches.length ? `Ci sono ${matches.length} corrispondenze. Specifica il nome completo o l’ID:\n` + matches.slice(0, 8).map(r => `${label(r)} · ${r.id}`).join('\n') : 'Non trovo un elemento con questo nome. Indica il nome completo o l’ID del movimento.');
  const row = matches[0];
  if (['tasks', 'projects'].includes(collection)) return reply(`${restore ? 'Ripristina' : 'Elimina'}: ${label(row)}${collection === 'projects' ? '. Le attività collegate restano nella tua lista.' : '. L’attività eliminata rimane nel cestino.'}`, [{ type: restore ? 'restore_task' : collection === 'tasks' ? 'delete_task' : 'delete_project', args: { id: row.id } }]);
  return reply(`Elimina ${label(row)}${row.date ? ' del ' + row.date : ''}${row.amountCents != null ? ' · ' + euro(row.amountCents, row.currency) : ''}. Controlla prima di confermare.`, [], [{ type: 'remove', args: { collection, id: row.id } }]);
}
export function localEmpireRequest(message, tasks, finance) {
  const direct = directAgentRequest(message, tasks, finance); if (direct) return direct;
  const text = message.toLocaleLowerCase('it');
  if (/prospett|scenario|proiezion|quanto.*guadagner|quanto.*avr[òo]|se\s+.*(?:incasso|guadagno)/i.test(text)) return {message:'Prepariamo un’ipotesi controllabile. Dimmi entrate e spese al mese e per quanti mesi: per esempio «Scenario: incasso 2000, spendo 900, per 6 mesi». Oppure apri «Crea un prospetto»: trovi le fonti reali da includere e puoi provare un nuovo cliente o una spesa. Senza saldo di partenza calcolo la differenza, non il patrimonio futuro.',taskActions:[],financeActions:[]};
  const businessName = finance.businesses.find(b=>b.name.length>3&&normalized(message).includes(normalized(b.name)));
  if (/entrate|incass|guadagn/.test(text) && (/da dove|fonti|marketing|comunicazione/.test(text) || businessName)) {
    const period = /storico|totale|sempre/.test(text) ? {start:'0000-01-01',end:todayKey()} : monthPeriod();
    let rows = incomeBreakdown(finance,period);
    if (businessName) rows=rows.filter(r=>r.businessId===businessName.id);
    else if (/marketing|comunicazione/.test(text)) rows=rows.filter(r=>r.keys.some(key=>/marketing|comunicazione|communication/i.test(key)));
    return {message:rows.length ? rows.map(r=>`${r.name}: ${euro(r.value)} · ${r.transactions.length} incassi registrati.`).join('\n')+'\nImporti originali Money Manager; trasferimenti e vendite My Empire non sono aggiunti.' : 'Non trovo incassi corrispondenti nel periodo. Posso mostrarti lo storico o le fonti ancora da associare.',taskActions:[],financeActions:[]};
  }
  if (/patrimonio|ricchezza/.test(text) && /tempo|cresc|andament|progress/.test(text)) {
    const current=wealthObservation(finance), history=wealthHistory(finance);
    return {message:`Al ${current.date}: ${euro(current.valueCents)} ${current.complete?'di patrimonio netto stimato':`di valori documentati, con ${current.missing.length} valori ancora mancanti`}.\n`+(history.length?history.slice(-8).map(r=>`${r.date}: ${euro(r.valueCents)} (${r.complete?'completo':'parziale'}).`).join('\n'):'Non ci sono ancora rilevazioni salvate da confrontare. Nelle Finanze puoi completare i saldi e salvare il punto di partenza.'),taskActions:[],financeActions:[]};
  }
  if (/priorit|organizza.*giornat|prepara oggi|organizza oggi|piano.*oggi|cosa.*fare.*oggi/.test(text)) {
    const selected = suggestDay(tasks, { count: /\b5\b|cinque/.test(text) ? 5 : tasks.settings.priorityCount || 3 });
    return { message: selected.length ? 'Per oggi:\n'+selected.map(t=>'• '+t.title).join('\n') : 'Non risultano attività aperte. Dimmi cosa aggiungere.', taskActions: selected.length ? [{ type: 'set_daily_priorities', args: { date: todayKey(), taskIds: selected.map(t => t.id) } }] : [], financeActions: [] };
  }
  if (/mese|mensil/.test(text) && /guadagn|spes|entrate|uscite|quanto.*fatto/.test(text) && !/business|attivit[àa]/.test(text)) {
    const report = financialReport(finance, { ...monthPeriod(), currency: 'EUR' });
    return { message: `Questo mese: ${euro(report.incomeCents)} di entrate ricevute, ${euro(report.expenseCents)} di spese. La differenza è ${euro(report.netCents)}. Include tutte le fonti, anche quelle personali; i trasferimenti sono esclusi. Non è il saldo dei conti.`, taskActions: [], financeActions: [] };
  }
  if (/business|attivit[àa].*(rende|guadagn)|quale.*rende/.test(text) && /rende|guadagn|ricav|andament/.test(text)) {
    const period = /storico|totale|sempre/.test(text) ? { start: '0000-01-01', end: '9999-12-31' } : monthPeriod();
    const rows = businessMetrics(finance, period).filter(r => r.revenueCents > 0 || r.collectedCents > 0);
    return { message: rows.length ? rows.map(r => `${r.name}: incassi Money Manager ${euro(r.collectedCents)}; vendite My Empire ${euro(r.revenueCents)}, margine sui costi registrati ${euro(r.marginCents)}${r.complete ? '' : ' (costi da verificare)'}.`).join('\n') + '\nIncassi e vendite sono due letture degli stessi flussi: non li sommo.' : 'Non ci sono vendite o incassi collegati nel periodo. Nella pagina Business puoi vedere lo storico e associare le fonti.', taskActions: [], financeActions: [] };
  }
  const money = parseFinanceCommand(message, finance);
  if (money.handled) return { message: money.message || money.summary || 'Registrazione pronta da controllare.', taskActions: [], financeActions: money.actions || [] };
  const command = parseCommands(message, tasks);
  return { message: command.message, taskActions: command.actions || [], financeActions: [] };
}
export function agentContext(tasks, finance) {
  const period = monthPeriod(), report = financialReport(finance, { ...period, currency: 'EUR' });
  const historyStart = new Date(todayKey().slice(0,7)+'-01T12:00:00Z'); historyStart.setUTCMonth(historyStart.getUTCMonth()-11);
  return { today: todayKey(), name: tasks.settings.name || 'Alessandro', agentName: adviserName(tasks.settings), memories: (tasks.settings.agentMemories || []).map(({id,text}) => ({id,text})), timezone: 'Europe/Rome', cashHistory:periodMonths(finance,{start:historyStart.toISOString().slice(0,10),end:todayKey()}), scenarios:(finance.settings.cashScenarios||[]).slice(-10).map(s=>({...s,result:projectCash(s).at(-1)})),
    tasks: tasks.tasks.filter(t => t.status !== 'done' && !t.archived).slice(0, 150).map(({ id, title, notes, priority, dueAt, projectId, areaId }) => ({ id, title, notes: notes?.slice(0, 500), priority, dueAt, projectId, areaId })),
    projects: tasks.projects.slice(0, 80).map(({ id, title, goal, areaId }) => ({ id, title, goal, areaId })), todayPriorities: tasks.plans[todayKey()] || [],
    month: { ...period, incomeCents: report.incomeCents, expenseCents: report.expenseCents, netCents: report.netCents }, incomeSources: incomeBreakdown(finance, period).map(r => ({ name: r.name, cents: r.value, businessId: r.businessId, incomeKind: r.incomeKind, needsReview: r.needsReview })), currentWealth: wealthObservation(finance), wealthHistory: wealthHistory(finance).slice(-24),
    accounts: finance.accounts.filter(a => a.active).map(({ id, name, currency, type }) => ({ id, name, currency, type })), categories: finance.categories.map(({ id, name }) => ({ id, name })),
    recentTransactions: finance.transactions.filter(t=>t.date<=todayKey()&&t.status==='posted').sort((a,b)=>b.date.localeCompare(a.date)).slice(0,50).map(t=>({id:t.id,date:t.date,type:t.type,amountCents:t.amountCents,currency:t.currency,accountId:t.accountId,description:t.description,notes:t.notes?.slice(0,200),source:incomeSource(finance,t).name})),
    businesses: businessMetrics(finance, period).map(r => ({ id: r.id, name: r.name, collectedCents: r.collectedCents, revenueCents: r.revenueCents, recordedMarginCents: r.marginCents, historicalRevenueCents: r.historicalRevenue, costDetailsComplete: r.complete, products: r.products.map(p => ({ id: p.id, name: p.name, price: p.price, costPrice: p.costPrice, stock: p.stock, description: p.notes?.slice(0,500) })).slice(0, 40) })),
    history: (tasks.settings.agentConversation || []).slice(-16).map(({ role, text }) => ({ role, text: text.slice(0, 4000) })) };
}
