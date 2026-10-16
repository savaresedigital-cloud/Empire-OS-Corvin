import { applyActions, parseCommands, todayKey } from './domain.js';
import { applyFinance, financialReport, moneyToCents, accountBalance } from './finance-domain.js';
import { adviserName, periodMonths, projectCash } from './finance-planning.js';
import { parseFinanceCommand } from './finance-tools.js';
import { businessMetrics, euro, monthPeriod, suggestDay } from './empire-metrics.js';
import { incomeBreakdown, incomeSource, wealthHistory, wealthObservation } from './finance-insights.js';
const taskTypes = new Set(['create_task', 'update_task', 'complete_task', 'create_project', 'update_project', 'set_daily_priorities', 'delete_task', 'restore_task', 'delete_project', 'remember_fact', 'forget_fact', 'add_subtask']);

export function yearlySummaries(finance, currency = 'EUR') {
  const years = [...new Set((finance.transactions || []).filter(t => t.status === 'posted' && t.currency === currency && t.date <= todayKey()).map(t => t.date.slice(0, 4)))].sort();
  return years.map(year => {
    const end = year === todayKey().slice(0, 4) ? todayKey() : `${year}-12-31`;
    const report = financialReport(finance, { start: `${year}-01-01`, end, currency });
    return { year, start: `${year}-01-01`, end, incomeCents: report.incomeCents, expenseCents: report.expenseCents, netCents: report.netCents, txCount: report.transactions.length };
  });
}

export function buildAgentChart(message, finance) {
  const text = String(message || '').toLowerCase();
  if (/affitt|casa|vivere da solo|indipendenz|sostenibilit|canone|bollett/.test(text)) {
    const rentMatch = text.match(/(?:affitto|canone|casa)\s*(?:da|di|a)?\s*(\d{2,4})/i) || text.match(/\b(\d{3})\s*(?:euro|€)\b/i);
    const y2026 = financialReport(finance, { start: `${todayKey().slice(0, 4)}-01-01`, end: todayKey(), currency: 'EUR' });
    const elapsedMonths = Math.max(1, Number(todayKey().slice(5, 7)));
    return {
      kind: 'housing-sim',
      title: 'Simulatore Sostenibilità Casa & Affitto',
      rent: rentMatch ? Number(rentMatch[1]) : 500,
      utilities: 140,
      avgIncome: Math.round((y2026.incomeCents / 100) / elapsedMonths),
      avgExpense: Math.round((y2026.expenseCents / 100) / elapsedMonths),
      liquidity: Math.round((y2026.liquidityCents || 0) / 100),
    };
  }
  const yearsMatch = [...text.matchAll(/\b(202[1-9])\b/g)].map(m => m[1]);
  const wantsMultiYear = yearsMatch.length >= 2 || /anni|anno per anno|storico|dal 202|confronta.*202|evoluzione|crescita negli anni/.test(text);
  if (wantsMultiYear) {
    const allYears = yearlySummaries(finance);
    const minY = yearsMatch.length >= 2 ? Math.min(...yearsMatch.map(Number)) : 2021;
    const maxY = yearsMatch.length >= 2 ? Math.max(...yearsMatch.map(Number)) : 2026;
    const filtered = allYears.filter(r => Number(r.year) >= minY && Number(r.year) <= maxY);
    if (filtered.length) {
      return {
        kind: 'yearly-bars',
        title: `Andamento Annuale (${filtered[0].year} – ${filtered.at(-1).year})`,
        subtitle: 'Entrate vs Uscite e Risparmio Netto in EUR',
        rows: filtered.map(r => ({ label: r.year, incomeCents: r.incomeCents, expenseCents: r.expenseCents, netCents: r.netCents })),
      };
    }
  }
  const singleYear = yearsMatch.length === 1 ? yearsMatch[0] : (/quest'anno|2026|mesi del 2026|ogni mese/.test(text) ? '2026' : null);
  if (singleYear && /mes[ei]|andamento|grafico|entrate|uscite|spes|guadagn|risparmi/.test(text)) {
    const end = singleYear === todayKey().slice(0, 4) ? todayKey() : `${singleYear}-12-31`;
    const months = periodMonths(finance, { start: `${singleYear}-01-01`, end });
    if (months.some(m => m.income > 0 || m.expense > 0)) {
      const mNames = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
      return {
        kind: 'monthly-bars',
        title: `Mese per Mese · ${singleYear}`,
        subtitle: 'Entrate, Uscite e Risparmio Netto mensile',
        rows: months.map(m => ({ label: mNames[Number(m.date.slice(5, 7)) - 1] || m.date.slice(5, 7), incomeCents: m.income, expenseCents: m.expense, netCents: m.net })),
      };
    }
  }
  if (/business|attivit[aà]|quale.*rende|fonti|da dove/.test(text) && /guadagn|incass|rende|ricav|entrate/.test(text)) {
    const rows = incomeBreakdown(finance, { start: '2021-01-01', end: todayKey() }).slice(0, 8);
    if (rows.length) {
      return {
        kind: 'sources-bars',
        title: 'Fonti di Entrata Principali',
        subtitle: 'Incassi reali registrati per fonte/attività',
        rows: rows.map(r => ({ label: r.name, incomeCents: r.value, expenseCents: 0, netCents: r.value })),
      };
    }
  }
  return null;
}

export function validateAgentResult(result, tasks, finance, requestMessage = '') {
  if (!result || typeof result.message !== 'string' || result.message.length > 16000) throw new Error('Risposta agente non valida.');
  const taskActions = result.taskActions || [], financeActions = result.financeActions || [];
  if (!Array.isArray(taskActions) || taskActions.length > 100 || taskActions.some(a => !taskTypes.has(a.type))) throw new Error('Operazioni attività non consentite.');
  if (!Array.isArray(financeActions) || financeActions.length > 25 || financeActions.some(a => !['upsert', 'remove'].includes(a.type) || !['transactions', 'accounts', 'orders', 'businessCosts', 'businesses'].includes(a.args?.collection))) throw new Error('Operazioni finanziarie non consentite.');
  for (const action of taskActions) {
    if (action.type === 'create_task' && Array.isArray(action.args?.subtasks)) {
      action.args.subtasks = action.args.subtasks.map((s, idx) => typeof s === 'string' ? { id: `sub_${idx}_${crypto.randomUUID().slice(0, 8)}`, title: s.trim(), done: false } : { id: s.id || `sub_${idx}_${crypto.randomUUID().slice(0, 8)}`, title: String(s.title || '').trim(), done: !!s.done }).filter(s => s.title);
    }
  }
  if (taskActions.length) applyActions(structuredClone(tasks), taskActions, crypto.randomUUID());
  if (financeActions.length) applyFinance(structuredClone(finance), financeActions, crypto.randomUUID());
  const chart = result.chart || (requestMessage ? buildAgentChart(requestMessage, finance) : null);
  return { message: result.message, taskActions, financeActions, ...(chart ? { chart } : {}) };
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
export function inferArea(text, state) {
  const s = normalized(text);
  const custom = state?.settings?.areaLabels || {};
  for (const [id, info] of Object.entries(custom)) {
    const words = normalized(info?.name || '').split(/\s+/).filter(w => w.length >= 3);
    if (words.some(w => s.includes(w))) return id;
  }
  // 1. REP Costruzioni: cantieri, Vittorio Maresca, Angelo, app/portale REP, caschi, cartelloni, gare, offerte lavoro REP, 50 aziende via mail
  if (/\b(rep\b|costruzioni|cantier[ei]|maresca|vittorio maresca|vitt maresca|piazzi|caschi|cartellon[ei]|cartello|app rep|portale|angelo|offerte lavoro|50 aziende|aziende da contattare|gara|appalt[oi]|sal\b|operai|fornitor[ei] edili|architetto|ingegnere|computo|furgone|scia|cila|durc|cassa edile)\b/.test(s)) {
    return 'rep';
  }
  // 2. Magie Creative & Progetti Digitali: siti web clienti, strategy documenti, laser, 3D, quadretti anime, Etsy/e-commerce
  if (/\b(siti web|sito web|ripristinat|documenti strategy|strategy|magie creative|etsy|vinted|ebay|3d|stampa 3d|laser|incisor[ei]|quadrett[oi]|yugioh|arcana|landing|video editing|videomaking|dvrkos)\b/.test(s)) {
    return 'business';
  }
  // 3. Gran Caffè Zerilli: pasticceria, panettoni, catalogo Natale/panettoni, pain suisse, cornetti, limone a morsi, recensioni google, Antonio divise, PC Zerilli, database clip, story/reel/post social
  if (/\b(zerilli|zerillo|gran caffe|caffe|bar|pasticceri[ae]|cornett[oi]|pain suisse|panetton[ei]|marzapanettum|limone a morsi|sorsi e morsi|tort[ae]|catalogo|recensioni google|recensioni|antonio|divise|database clip|story|reel|sondaggio|insta|programmazione contenuti|programmazione post|sponsorizzat[ae]|post per aziende)\b/.test(s)) {
    return 'zerilli';
  }
  for (const p of state?.projects || []) {
    if (p.status === 'active') {
      const words = normalized(p.title).split(/\s+/).filter(w => w.length >= 4);
      if (words.some(w => s.includes(w))) return p.areaId;
    }
  }
  return 'personale';
}
export function inferProject(text, areaId, state) {
  const projects = (state?.projects || []).filter(p => p.status === 'active');
  if (!projects.length) return null;
  const s = normalized(text);
  const direct = projects.find(p => p.areaId === areaId && normalized(p.title).split(/\s+/).filter(w => w.length >= 4).some(w => s.includes(w)));
  if (direct) return direct.id;
  const areaDefault = projects.find(p => p.areaId === areaId);
  return areaDefault ? areaDefault.id : null;
}
const ITALIAN_MONTHS = {
  gen: '01', gennaio: '01',
  feb: '02', febbraio: '02',
  mar: '03', marzo: '03',
  apr: '04', aprile: '04',
  mag: '05', maggio: '05',
  giu: '06', giugno: '06',
  lug: '07', luglio: '07',
  ago: '08', agosto: '08',
  set: '09', sett: '09', settembre: '09',
  ott: '10', ottobre: '10',
  nov: '11', novembre: '11',
  dic: '12', dicembre: '12',
};
export function parseItalianDateHeader(line, defaultYear = todayKey().slice(0, 4)) {
  const clean = normalized(line).replace(/^(?:lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)\s+/i, '').replace(/[.:,-]+$/, '').trim();
  const m1 = clean.match(/^(\d{1,2})\s+(gen(?:naio)?|feb(?:braio)?|mar(?:zo)?|apr(?:ile)?|mag(?:gio)?|giu(?:gno)?|lug(?:lio)?|ago(?:sto)?|set(?:t(?:embre)?)?|ott(?:obre)?|nov(?:embre)?|dic(?:embre)?)(?:\s+(20\d{2}|\d{2}))?$/);
  if (m1) {
    const day = m1[1].padStart(2, '0');
    const month = ITALIAN_MONTHS[m1[2]];
    const year = m1[3] ? (m1[3].length === 2 ? `20${m1[3]}` : m1[3]) : defaultYear;
    return `${year}-${month}-${day}`;
  }
  const m2 = clean.match(/^(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?$/);
  if (m2) {
    const day = m2[1].padStart(2, '0');
    const month = m2[2].padStart(2, '0');
    const year = m2[3] ? (m2[3].length === 2 ? `20${m2[3]}` : m2[3]) : defaultYear;
    return `${year}-${month}-${day}`;
  }
  if (/^20\d{2}-\d{2}-\d{2}$/.test(clean)) return clean;
  return null;
}
export function formatRoleWorkLog(tasks, targetAreaId = null) {
  const areaLabels = {
    zerilli: 'Gran Caffè Zerilli (Marketing, Social, Pasticceria, Catalogo Panettoni)',
    rep: 'REP Costruzioni (Cantieri, App REP, Grafica Cantiere, Gare & B2B)',
    business: 'Magie Creative & Progetti (Siti Web, Laser/3D, Quadretti, Strategy)',
    personale: 'Personale',
  };
  const list = (tasks?.tasks || []).filter(t => !t.archived && (!targetAreaId || t.areaId === targetAreaId));
  if (!list.length) return 'Non ci sono ancora attività registrate per questo dominio.';
  const sorted = [...list].sort((a, b) => (a.dueAt || a.createdAt || '').localeCompare(b.dueAt || b.createdAt || ''));
  const byDate = new Map();
  for (const t of sorted) {
    const d = t.dueAt ? t.dueAt.slice(0, 10) : 'Senza data';
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(t);
  }
  const sections = [];
  for (const [d, rows] of byDate.entries()) {
    const label = d === 'Senza data' ? d : new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
    sections.push(`${label.toUpperCase()}:\n` + rows.map(r => `• [${r.status === 'done' ? 'Fatto' : 'Da fare'}] ${r.title}${!targetAreaId ? ` (${r.areaId})` : ''}`).join('\n'));
  }
  const doneCount = list.filter(t => t.status === 'done').length;
  const todoCount = list.length - doneCount;
  const header = targetAreaId ? `Registro per ${areaLabels[targetAreaId] || targetAreaId}: ${list.length} attività (${doneCount} svolte, ${todoCount} da fare)` : `Registro completo: ${list.length} attività (${doneCount} svolte, ${todoCount} da fare)`;
  return `${header}\n\n${sections.join('\n\n')}`;
}
export function buildDailyCounsel(state) {
  const today = todayKey();
  const open = (state?.tasks || []).filter(t => t.status !== 'done' && !t.archived && !/^test qa\b/i.test(t.title));
  const doneToday = (state?.tasks || []).filter(t => t.status === 'done' && t.completedAt && todayKey(new Date(t.completedAt)) === today).length;
  if (!open.length) {
    return {
      recommendedCount: 0,
      headline: doneToday > 0 ? `Hai chiuso ${doneToday} ${doneToday === 1 ? 'attività' : 'attività'} oggi.` : 'Nessuna attività aperta.',
      advice: 'La lista è libera. Aggiungi solo ciò che ti serve davvero ricordare.',
      topTask: null,
      nextStep: null,
      suggestedIds: [],
    };
  }
  const overdue = open.filter(t => t.dueAt && t.dueAt.slice(0, 10) < today);
  const dueToday = open.filter(t => t.dueAt && t.dueAt.slice(0, 10) === today);
  const inProgress = open.filter(t => (t.subtasks || []).some(s => s.done) && (t.subtasks || []).some(s => !s.done));
  const ranked = suggestDay(state, { date: today, count: 3 });
  const topTask = inProgress[0] || dueToday[0] || overdue[0] || ranked[0] || open[0];
  const nextStep = (topTask?.subtasks || []).find(s => !s.done)?.title || null;
  const heavyCount = ranked.filter(t => (t.subtasks || []).length >= 2 || t.priority === 'high').length;
  const recommendedCount = Math.min(open.length, heavyCount >= 2 ? 2 : 3);
  let reason = 'è la priorità più alta in lista';
  if (inProgress.includes(topTask)) {
    const doneSubs = topTask.subtasks.filter(s => s.done).length;
    reason = `è già avviata (${doneSubs}/${topTask.subtasks.length} passaggi completati)`;
  } else if (dueToday.includes(topTask)) {
    reason = 'scade oggi';
  } else if (overdue.includes(topTask)) {
    reason = 'è rimasta in sospeso ed è pronta da chiudere';
  }
  const countAdvice =
    doneToday >= recommendedCount
      ? `Hai già completato ${doneToday} ${doneToday === 1 ? 'attività' : 'attività'} oggi: ottimo ritmo, non serve aggiungere altro carico.`
      : `Oggi concentrati su ${recommendedCount} ${recommendedCount === 1 ? 'attività' : 'attività'} (ne hai ${open.length} aperte in totale).`;
  return {
    recommendedCount,
    headline: countAdvice,
    advice: `Inizia da «${topTask.title}» perché ${reason}.${nextStep ? ` Primo passo: ${nextStep}.` : ''}`,
    topTask,
    nextStep,
    suggestedIds: ranked.slice(0, recommendedCount).map(t => t.id),
  };
}
export function parseSmartPaste(message, tasks, finance) {
  const raw = String(message || '').trim();
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const bulletLines = lines.filter(l => /^(?:[-*•▪▸▹→>]|\d+[.)]|\[[ xX]?\])\s+/.test(l));
  const dateHeaderLines = lines.filter(l => !!parseItalianDateHeader(l));
  const isMultiLineNote = lines.length >= 2 && (bulletLines.length >= 2 || lines.length >= 3 || dateHeaderLines.length >= 1);
  if (!isMultiLineNote) return null;
  const cleanLine = l => l.replace(/^(?:[-*•▪▸▹→>]|\d+[.)]|\[[ xX]?\])\s+/, '').trim();
  const taskActions = [];
  const financeActions = [];
  const defaultAcc = finance.accounts.find(a => a.id === finance.settings?.defaultAccountId && a.active) || finance.accounts.find(a => a.id === 'hype' && a.active) || finance.accounts.find(a => a.active && !['debit', 'aggregate'].includes(a.type));
  let currentTask = null;
  let currentDate = null;
  const today = todayKey();
  const isHistoricalLog = dateHeaderLines.length >= 2;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 1. Check if this line is a standalone date header (e.g. "1 ott", "2 ott", "13 ott")
    const headerDate = parseItalianDateHeader(line);
    if (headerDate) {
      currentDate = headerDate;
      currentTask = null;
      continue;
    }
    const isSubBullet = /^\s{2,}(?:[-*•]|\d+[.)])/.test(raw.split(/\r?\n/).filter(l => l.trim())[i] || '') || (/^(?:sub|sotto|checklist|-\s*\[)\b/i.test(line) && currentTask);
    let cleaned = cleanLine(line);
    if (!cleaned || cleaned.length < 2) continue;

    // Also support inline date prefix like "1 ott - contattare antonio..."
    const inlineDateMatch = cleaned.match(/^(\d{1,2}\s+(?:gen|feb|mar|apr|mag|giu|lug|ago|set|sett|ott|nov|dic)[a-z]*)\s*[-–:]\s*(.+)$/i);
    if (inlineDateMatch) {
      const parsedInline = parseItalianDateHeader(inlineDateMatch[1]);
      if (parsedInline) {
        currentDate = parsedInline;
        cleaned = inlineDateMatch[2].trim();
      }
    }

    // Check if the line is an explicit money record inside the note
    const moneyMatch = cleaned.match(/^(?:speso|pagato|incassato|ricevuto)\s+([+-]?\d[\d.,]*)\s*(?:euro|€)\s*(?:per|di|da|su)?\s*(.*)$/i);
    if (moneyMatch && defaultAcc) {
      try {
        const cents = moneyToCents(moneyMatch[1]);
        const isInc = /^(?:incassato|ricevuto)/i.test(cleaned);
        const accMatch = finance.accounts.find(a => a.active && normalized(cleaned).includes(normalized(a.name))) || defaultAcc;
        const catMatch = finance.categories.find(c => normalized(cleaned).includes(normalized(c.name)));
        if (cents > 0 && financeActions.length < 20) {
          financeActions.push({ type: 'upsert', args: { collection: 'transactions', record: { id: crypto.randomUUID(), type: isInc ? 'income' : 'expense', date: currentDate || today, amountCents: cents, currency: accMatch.currency || 'EUR', accountId: accMatch.id, categoryId: catMatch?.id || null, description: moneyMatch[2]?.trim() || cleaned, status: 'posted', source: 'smart-paste' } } });
          continue;
        }
      } catch {}
    }
    if (isSubBullet && currentTask) {
      currentTask.subtasks.push({ id: `sub_${currentTask.subtasks.length}_${crypto.randomUUID().slice(0, 6)}`, title: cleaned.slice(0, 400), done: false });
      continue;
    }
    const areaId = inferArea(cleaned, tasks);
    const priority = /\b(urgente|priorit[aà]|subito|importante|entro oggi|critico|alta)\b|!+/i.test(cleaned) ? 'high' : 'normal';
    let dueAt = currentDate || null;
    if (!dueAt) {
      if (/\boggi\b/i.test(cleaned)) dueAt = today;
      else if (/\bdomani\b/i.test(cleaned)) { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); dueAt = d.toISOString().slice(0, 10); }
      else { const iso = cleaned.match(/\b(20\d{2}-\d{2}-\d{2})\b/); if (iso) dueAt = iso[1]; }
    }
    const projectId = inferProject(cleaned, areaId, tasks);
    const title = cleaned.replace(/\b(?:urgente|priorit[aà] alta)\b/gi, '').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!title) continue;
    const isPastLogEntry = (isHistoricalLog && dueAt && dueAt < today) || /^(?:risolt[oi]|fatto|completat[oa]|chiusura|pubblicazione)\b/i.test(title);
    currentTask = {
      title: title.charAt(0).toUpperCase() + title.slice(1),
      areaId,
      projectId,
      priority,
      dueAt,
      status: isPastLogEntry ? 'done' : 'todo',
      ...(isPastLogEntry ? { completedAt: `${dueAt || today}T18:00:00.000Z` } : {}),
      notes: '',
      subtasks: [],
      source: 'smart-paste',
    };
    if (taskActions.length < 100) taskActions.push({ type: 'create_task', args: currentTask });
  }
  if (!taskActions.length && !financeActions.length) return null;
  const countsByArea = {};
  for (const a of taskActions) {
    const name = { zerilli: 'Gran Caffè Zerilli', rep: 'REP Costruzioni', business: 'Magie Creative & Progetti', personale: 'Personale' }[a.args.areaId] || a.args.areaId;
    countsByArea[name] = (countsByArea[name] || 0) + 1;
  }
  const breakdownText = Object.entries(countsByArea).map(([k, v]) => `${k}: ${v}`).join(' · ');
  return {
    message: `Ho riconosciuto e smistato ${taskActions.length} ${taskActions.length === 1 ? 'attività' : 'attività'} in base ai tuoi ruoli (${breakdownText})${financeActions.length ? ` e ${financeActions.length} movimenti` : ''}. Puoi controllarle qui sotto e scegliere se salvarle come registro attività svolte o da fare.`,
    taskActions,
    financeActions,
  };
}
export function generateSubtasksForTask(task) {
  const title = String(task?.title || '').toLowerCase();
  const area = task?.areaId || inferArea(title);
  const make = titles => titles.map((t, i) => ({ id: `sub_${i}_${crypto.randomUUID().slice(0, 6)}`, title: t, done: false }));
  if (/post|instagram|social|carosell|catalogo|grafic|foto/i.test(title)) {
    return make(['Raccogliere foto o asset definitivi', 'Impaginare grafica e scrivere il copy', 'Controllo rapido e pubblicazione/programmazione']);
  }
  if (/portale|gara|cantiere|preventiv|computo|document|rep\b/i.test(title) || area === 'rep') {
    return make(['Verificare dati e documenti richiesti', 'Completare controllo tecnico / operativo', 'Inviare o aggiornare lo stato sul portale']);
  }
  if (/laser|3d|stampa|campion|ordine|spedir|pacco|etsy|magie/i.test(title) || area === 'business') {
    return make(['Preparare file e parametri di lavorazione', 'Eseguire produzione / test sul pezzo', 'Controllo qualità finale e messa da parte']);
  }
  if (area === 'zerilli') {
    return make(['Definire i dettagli operativi per il locale', 'Preparare il materiale necessario', 'Verificare con il banco / team e chiudere']);
  }
  return make(['Preparare tutto l’occorrente (5 min)', 'Completare il passaggio principale (15 min)', 'Controllo finale e archiviazione']);
}
export function localEmpireRequest(message, tasks, finance) {
  const direct = directAgentRequest(message, tasks, finance); if (direct) return direct;
  const smart = parseSmartPaste(message, tasks, finance); if (smart) return smart;
  const text = message.toLocaleLowerCase('it');
  if (/(?:cosa ho fatto|registro|log\b|riepilogo|mostra.*task|filtra.*task|elenco.*attivit|lavori svolti|cosa faccio)/i.test(text)) {
    const area = /zerill|pasticceri|panetton/i.test(text) ? 'zerilli' : /\brep\b|costruzion|cantier/i.test(text) ? 'rep' : /magie|laser|3d|siti web/i.test(text) ? 'business' : null;
    return {
      message: formatRoleWorkLog(tasks, area),
      taskActions: [],
      financeActions: [],
    };
  }
  if (/mezz['’]?ora|30\s*minut|cosa.*faccio.*adesso|veloce.*fare/i.test(text)) {
    const open = tasks.tasks.filter(t => t.status !== 'done' && !t.archived);
    if (!open.length) return { message: 'Hai la lista libera! Puoi rilassarti o aggiungere una nuova idea al volo.', taskActions: [], financeActions: [] };
    const today = todayKey();
    const picks = [...open].sort((a, b) => {
      const aSub = (a.subtasks || []).some(s => !s.done) ? 1 : 0;
      const bSub = (b.subtasks || []).some(s => !s.done) ? 1 : 0;
      const aPri = (tasks.plans[today] || []).includes(a.id) ? 2 : a.priority === 'high' ? 1 : 0;
      const bPri = (tasks.plans[today] || []).includes(b.id) ? 2 : b.priority === 'high' ? 1 : 0;
      return (bPri + bSub) - (aPri + aSub);
    }).slice(0, 3);
    const lines = picks.map((t, i) => {
      const nextStep = (t.subtasks || []).find(s => !s.done);
      return `${i + 1}. ${t.title}${nextStep ? `\n   ↳ Parti da questo passaggio (10 min): «${nextStep.title}»` : ''}`;
    });
    return {
      message: `In 30 minuti puoi toglierti subito dalla testa una di queste:\n\n${lines.join('\n\n')}\n\nConsiglio: fai solo il primo passaggio della n. 1, così sblocchi subito il ritmo senza appesantirti.`,
      taskActions: [],
      financeActions: [],
    };
  }
  if (/dividi.*passagg|scomponi|dividi.*lavoro|crea.*sottoattivit|spezza/i.test(text)) {
    const open = tasks.tasks.filter(t => t.status !== 'done' && !t.archived);
    const cleanedQuery = normalized(text.replace(/dividi|in passaggi|scomponi|il lavoro|questo lavoro|l'attività|attività|task|per favore|merlino/g, ''));
    const target = (cleanedQuery.length >= 3 && open.find(t => normalized(t.title).includes(cleanedQuery))) || open.find(t => (tasks.plans[todayKey()] || []).includes(t.id) && !(t.subtasks || []).length) || open[0];
    if (target) {
      const subs = generateSubtasksForTask(target);
      return {
        message: `Ho diviso «${target.title}» in ${subs.length} passaggi rapidi e concreti. Conferma qui sotto per salvarli nell’attività:`,
        taskActions: [{ type: 'update_task', args: { id: target.id, subtasks: subs } }],
        financeActions: [],
      };
    }
  }
  if (/organizza.*da sistemare|sistema.*inbox|organizza.*inbox|assegna.*progett/i.test(text)) {
    const inbox = tasks.tasks.filter(t => t.status !== 'done' && !t.projectId);
    if (!inbox.length) return { message: 'Non hai attività in «Da sistemare»: è già tutto ordinato nei progetti!', taskActions: [], financeActions: [] };
    const actions = inbox.slice(0, 15).map(t => {
      const areaId = t.areaId && t.areaId !== 'personale' ? t.areaId : inferArea(t.title);
      const proj = tasks.projects.find(p => p.status === 'active' && p.areaId === areaId);
      return { type: 'update_task', args: { id: t.id, areaId, ...(proj ? { projectId: proj.id } : {}) } };
    });
    return {
      message: `Ho preparato l’organizzazione automatica per ${actions.length} ${actions.length === 1 ? 'attività' : 'attività'} in «Da sistemare», assegnando area e progetto corrispondente:`,
      taskActions: actions,
      financeActions: [],
    };
  }
  const chart = buildAgentChart(message, finance);
  if (chart && chart.kind === 'housing-sim') {
    const net = chart.avgIncome - chart.avgExpense;
    const margin = net - chart.rent - chart.utilities;
    return {
      message: `Ti ho aperto qui sotto il simulatore di sostenibilità: con la tua media attuale di ~${chart.avgIncome} €/mese di entrate e ~${chart.avgExpense} €/mese di spese, ipotizzando ${chart.rent} € di affitto e ${chart.utilities} € di bollette ti resta un margine di ${margin >= 0 ? '+' : ''}${margin} €/mese. Muovi i cursori qui sotto per provare altre cifre!`,
      taskActions: [],
      financeActions: [],
      chart,
    };
  }
  if (chart && chart.kind === 'yearly-bars') {
    const lines = chart.rows.map(r => `• ${r.label}: entrate ${euro(r.incomeCents)}, uscite ${euro(r.expenseCents)} → netto ${euro(r.netCents)}`);
    return { message: `Ecco il confronto anno per anno (${chart.rows[0].label}–${chart.rows.at(-1).label}):\n${lines.join('\n')}`, taskActions: [], financeActions: [], chart };
  }
  if (/prospett|scenario|proiezion|quanto.*guadagner|quanto.*avr[òo]|se\s+.*(?:incasso|guadagno)/i.test(text)) return {message:'Prepariamo un’ipotesi controllabile. Dimmi entrate e spese al mese e per quanti mesi: per esempio «Scenario: incasso 2000, spendo 900, per 6 mesi». Oppure apri «Crea un prospetto»: trovi le fonti reali da includere e puoi provare un nuovo cliente o una spesa. Senza saldo di partenza calcolo la differenza, non il patrimonio futuro.',taskActions:[],financeActions:[]};
  const businessName = finance.businesses.find(b=>b.name.length>3&&normalized(message).includes(normalized(b.name)));
  if (/entrate|incass|guadagn/.test(text) && (/da dove|fonti|marketing|comunicazione/.test(text) || businessName)) {
    const period = /storico|totale|sempre/.test(text) ? {start:'0000-01-01',end:todayKey()} : monthPeriod();
    let rows = incomeBreakdown(finance,period);
    if (businessName) rows=rows.filter(r=>r.businessId===businessName.id);
    else if (/marketing|comunicazione/.test(text)) rows=rows.filter(r=>r.keys.some(key=>/marketing|comunicazione|communication/i.test(key)));
    return {message:rows.length ? rows.map(r=>`${r.name}: ${euro(r.value)} · ${r.transactions.length} incassi registrati.`).join('\n')+'\nImporti originali Money Manager; trasferimenti e vendite My Empire non sono aggiunti.' : 'Non trovo incassi corrispondenti nel periodo. Posso mostrarti lo storico o le fonti ancora da associare.',taskActions:[],financeActions:[],...(chart?{chart}:{})};
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
    return { message: `Questo mese: ${euro(report.incomeCents)} di entrate ricevute, ${euro(report.expenseCents)} di spese. La differenza è ${euro(report.netCents)}. Include tutte le fonti, anche quelle personali; i trasferimenti sono esclusi. Non è il saldo dei conti.`, taskActions: [], financeActions: [], ...(chart ? { chart } : {}) };
  }
  if (/business|attivit[àa].*(rende|guadagn)|quale.*rende/.test(text) && /rende|guadagn|ricav|andament/.test(text)) {
    const period = /storico|totale|sempre/.test(text) ? { start: '0000-01-01', end: '9999-12-31' } : monthPeriod();
    const rows = businessMetrics(finance, period).filter(r => r.revenueCents > 0 || r.collectedCents > 0);
    return { message: rows.length ? rows.map(r => `${r.name}: incassi Money Manager ${euro(r.collectedCents)}; vendite My Empire ${euro(r.revenueCents)}, margine sui costi registrati ${euro(r.marginCents)}${r.complete ? '' : ' (costi da verificare)'}.`).join('\n') + '\nIncassi e vendite sono due letture degli stessi flussi: non li sommo.' : 'Non ci sono vendite o incassi collegati nel periodo. Nella pagina Business puoi vedere lo storico e associare le fonti.', taskActions: [], financeActions: [], ...(chart ? { chart } : {}) };
  }
  const money = parseFinanceCommand(message, finance);
  if (money.handled) return { message: money.message || money.summary || 'Registrazione pronta da controllare.', taskActions: [], financeActions: money.actions || [] };
  const command = parseCommands(message, tasks);
  return { message: command.message, taskActions: command.actions || [], financeActions: [] };
}
export function agentContext(tasks, finance) {
  const period = monthPeriod(), report = financialReport(finance, { ...period, currency: 'EUR' });
  const historyStart = new Date(todayKey().slice(0,7)+'-01T12:00:00Z'); historyStart.setUTCMonth(historyStart.getUTCMonth()-11);
  return { today: todayKey(), name: tasks.settings.name || 'Alex', agentName: adviserName(tasks.settings), memories: (tasks.settings.agentMemories || []).map(({id,text}) => ({id,text})), timezone: 'Europe/Rome',
    yearlyHistory: yearlySummaries(finance, 'EUR'),
    cashHistory: periodMonths(finance, { start: historyStart.toISOString().slice(0,10), end: todayKey() }),
    scenarios: (finance.settings.cashScenarios||[]).slice(-10).map(s=>({...s,result:projectCash(s).at(-1)})),
    tasks: tasks.tasks.filter(t => t.status !== 'done' && !t.archived).slice(0, 150).map(({ id, title, notes, priority, dueAt, projectId, areaId }) => ({ id, title, notes: notes?.slice(0, 500), priority, dueAt, projectId, areaId })),
    projects: tasks.projects.slice(0, 80).map(({ id, title, goal, areaId }) => ({ id, title, goal, areaId })), todayPriorities: tasks.plans[todayKey()] || [],
    month: { ...period, incomeCents: report.incomeCents, expenseCents: report.expenseCents, netCents: report.netCents, liquidityCents: report.liquidityCents },
    incomeSources: incomeBreakdown(finance, period).map(r => ({ name: r.name, cents: r.value, businessId: r.businessId, incomeKind: r.incomeKind, needsReview: r.needsReview })),
    historicalIncomeSources: incomeBreakdown(finance, { start: '2021-01-01', end: todayKey() }).slice(0, 12).map(r => ({ name: r.name, cents: r.value, count: r.transactions.length, businessId: r.businessId })),
    currentWealth: wealthObservation(finance), wealthHistory: wealthHistory(finance).slice(-24),
    accounts: finance.accounts.filter(a => a.active).map(a => ({ id: a.id, name: a.name, currency: a.currency, type: a.type, balanceCents: accountBalance(finance, a.id, todayKey()) })),
    categories: finance.categories.map(({ id, name }) => ({ id, name })),
    recentTransactions: finance.transactions.filter(t=>t.date<=todayKey()&&t.status==='posted').sort((a,b)=>b.date.localeCompare(a.date)).slice(0,50).map(t=>({id:t.id,date:t.date,type:t.type,amountCents:t.amountCents,currency:t.currency,accountId:t.accountId,description:t.description,notes:t.notes?.slice(0,200),source:incomeSource(finance,t).name})),
    businesses: businessMetrics(finance, period).map(r => ({ id: r.id, name: r.name, collectedCents: r.collectedCents, revenueCents: r.revenueCents, recordedMarginCents: r.marginCents, historicalRevenueCents: r.historicalRevenue, costDetailsComplete: r.complete, products: r.products.map(p => ({ id: p.id, name: p.name, price: p.price, costPrice: p.costPrice, stock: p.stock, description: p.notes?.slice(0,500) })).slice(0, 40) })),
    history: (tasks.settings.agentConversation || []).slice(-16).map(({ role, text }) => ({ role, text: text.slice(0, 4000) })) };
}
