/** Provider-independent, deterministic business rules. Dates without a time stay dates. */
export const AREAS = [
  { id: 'personale', name: 'Personale', color: '#a4b5ce' },
  { id: 'zerilli', name: 'Gran Caffè Zerilli', color: '#cbb48a' },
  { id: 'rep', name: 'REP Costruzioni', color: '#9bbab5' },
  { id: 'business', name: 'Magie Creative & Progetti', color: '#b9a6cb' },
];
export function getAreas(state) {
  const custom = state?.settings?.areaLabels || {};
  return AREAS.map(a => ({
    ...a,
    name: custom[a.id]?.name?.trim() || a.name,
    subtitle: custom[a.id]?.subtitle?.trim() || '',
  }));
}
export function getAreaName(state, areaId) {
  return getAreas(state).find(a => a.id === areaId)?.name || 'Personale';
}
const TZ = 'Europe/Rome';
const areaIds = new Set(AREAS.map(a => a.id));
const priorities = new Set(['high', 'normal', 'low']);
const taskKeys = ['title', 'notes', 'areaId', 'projectId', 'status', 'priority', 'dueAt', 'reminderAt', 'subtasks', 'recurrenceRule', 'estimateMinutes'];
const fail = message => { throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const stamp = () => new Date().toISOString();
const uid = () => globalThis.crypto?.randomUUID?.() || `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const dateParts = date => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
export function todayKey(date = new Date()) {
  const parts = dateParts(new Date(date));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function emptyState() {
  return { schemaVersion: 1, tasks: [], projects: [], plans: {}, settings: {}, activity: [], operationIds: [] };
}
function string(value, name, max = 10000, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`${name}: testo ${required ? 'non vuoto ' : ''}richiesto (max ${max}).`);
  return required ? value.trim() : value;
}
function id(value, name = 'id') { return string(value, name, 160, true); }
function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function dateValue(value, name, dateOnly = true) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') fail(`${name}: data non valida.`);
  if (dateOnly && validDay(value)) return value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !validDay(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) fail(`${name}: usa YYYY-MM-DD oppure un timestamp ISO con fuso orario.`);
  return new Date(value).toISOString();
}
function validateTask(raw, index) {
  const name = `Attività ${index + 1}`;
  if (!object(raw)) fail(`${name}: oggetto richiesto.`);
  const task = { ...raw };
  task.id = id(raw.id, `${name}.id`);
  task.title = string(raw.title, `${name}.title`, 500, true);
  task.notes = string(raw.notes ?? '', `${name}.notes`, 20000);
  task.areaId = raw.areaId ?? 'personale';
  if (!areaIds.has(task.areaId)) fail(`${name}: area sconosciuta.`);
  task.projectId = raw.projectId || null;
  if (task.projectId) id(task.projectId, `${name}.projectId`);
  task.status = raw.status ?? 'todo';
  if (!['todo', 'done'].includes(task.status)) fail(`${name}: stato non valido.`);
  task.priority = raw.priority ?? 'normal';
  if (!priorities.has(task.priority)) fail(`${name}: priorità non valida.`);
  task.dueAt = dateValue(raw.dueAt, `${name}.dueAt`);
  task.reminderAt = dateValue(raw.reminderAt, `${name}.reminderAt`, false);
  task.recurrenceRule = raw.recurrenceRule || null;
  if (![null, 'daily', 'weekly', 'monthly'].includes(task.recurrenceRule)) fail(`${name}: ricorrenza non valida.`);
  if (!Array.isArray(raw.subtasks ?? [])) fail(`${name}: sottoattività non valide.`);
  task.subtasks = (raw.subtasks ?? []).map((s, i) => {
    if (!object(s)) fail(`${name}: sottoattività ${i + 1} non valida.`);
    if (s.done !== undefined && typeof s.done !== 'boolean') fail(`${name}: stato sottoattività non valido.`);
    return { ...s, id: id(s.id, `${name}.subtasks.id`), title: string(s.title, `${name}.subtasks.title`, 500, true), done: s.done ?? false };
  });
  unique(task.subtasks, `${name}: ID sottoattività duplicato`);
  task.createdAt = dateValue(raw.createdAt, `${name}.createdAt`, false) ?? stamp();
  task.updatedAt = dateValue(raw.updatedAt, `${name}.updatedAt`, false) ?? task.createdAt;
  task.completedAt = dateValue(raw.completedAt, `${name}.completedAt`, false);
  if (task.status === 'todo') task.completedAt = null;
  task.source = string(raw.source ?? 'manual', `${name}.source`, 160, true);
  task.version = raw.version ?? 1;
  if (!Number.isSafeInteger(task.version) || task.version < 1) fail(`${name}: versione non valida.`);
  if (raw.recurrenceRootId !== undefined) id(raw.recurrenceRootId, `${name}.recurrenceRootId`);
  if (raw.recurrenceSequence !== undefined && (!Number.isSafeInteger(raw.recurrenceSequence) || raw.recurrenceSequence < 0)) fail(`${name}: sequenza ricorrenza non valida.`);
  for (const key of ['recurrenceDueDay', 'recurrenceReminderDay']) if (raw[key] !== undefined && raw[key] !== null && (!Number.isInteger(raw[key]) || raw[key] < 1 || raw[key] > 31)) fail(`${name}: giorno ricorrenza non valido.`);
  if (raw.estimateMinutes !== undefined && raw.estimateMinutes !== null && (!Number.isFinite(raw.estimateMinutes) || raw.estimateMinutes < 0 || raw.estimateMinutes > 525600)) fail(`${name}: stima minuti non valida.`);
  return task;
}
function unique(records, message) {
  if (new Set(records.map(r => r.id)).size !== records.length) fail(message);
}
export function validateState(raw) {
  if (!object(raw)) fail('Backup: oggetto JSON richiesto.');
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) fail('Versione backup non supportata: nessun dato modificato.');
  if (!Array.isArray(raw.tasks)) fail('Backup: elenco tasks mancante o non valido.');
  const result = { ...emptyState(), ...clone(raw), schemaVersion: 1 };
  result.tasks = raw.tasks.map(validateTask);
  unique(result.tasks, 'Backup: ID attività duplicati.');
  if (!Array.isArray(result.projects)) fail('Backup: projects deve essere un elenco.');
  result.projects = result.projects.map((p, i) => {
    if (!object(p)) fail(`Progetto ${i + 1}: oggetto richiesto.`);
    const areaId = p.areaId ?? 'personale';
    if (!areaIds.has(areaId)) fail(`Progetto ${i + 1}: area sconosciuta.`);
    if (p.status !== undefined && !['active', 'done', 'archived'].includes(p.status)) fail(`Progetto ${i + 1}: stato non valido.`);
    return { ...p, id: id(p.id), title: string(p.title ?? p.name, 'Titolo progetto', 500, true), areaId, goal: string(p.goal ?? '', 'Obiettivo progetto', 10000), status: p.status ?? 'active' };
  });
  unique(result.projects, 'Backup: ID progetto duplicati.');
  const projectIds = new Set(result.projects.map(p => p.id));
  for (const task of result.tasks) if (task.projectId && !projectIds.has(task.projectId)) fail(`Attività "${task.title}": progetto ${task.projectId} mancante.`);
  if (!object(result.plans)) fail('Backup: plans deve essere un oggetto.');
  const taskIds = new Set(result.tasks.map(t => t.id));
  for (const [day, plan] of Object.entries(result.plans)) {
    if (!validDay(day)) fail(`Piano: data ${day} non valida.`);
    // Plans are a compact mapping from Rome day to ordered task IDs.
    if (!Array.isArray(plan) || plan.length > 5 || new Set(plan).size !== plan.length || plan.some(key => !taskIds.has(key))) fail(`Piano ${day}: massimo cinque ID di attività esistenti, senza duplicati.`);
  }
  if (!object(result.settings)) fail('Backup: settings non valido.');
  if (result.settings.name !== undefined) string(result.settings.name, 'Nome nelle impostazioni', 60);
  if (result.settings.agentName !== undefined) string(result.settings.agentName, 'Nome agente', 40, true);
  if (result.settings.agentMemories !== undefined) {
    if (!Array.isArray(result.settings.agentMemories) || result.settings.agentMemories.length > 100) fail('Memoria: massimo 100 ricordi.');
    for (const memory of result.settings.agentMemories) { id(memory.id); string(memory.text, 'Ricordo', 1500, true); dateValue(memory.createdAt, 'Data ricordo', false); }
    unique(result.settings.agentMemories, 'Memoria: ID duplicato.');
  }
  if (!Array.isArray(result.activity)) fail('Backup: activity non valido.');
  if (!Array.isArray(result.operationIds) || result.operationIds.some(key => typeof key !== 'string') || new Set(result.operationIds).size !== result.operationIds.length) fail('Backup: operationIds non valido.');
  return result;
}
export function romeDateTime(day, hour, minute = 0, second = 0) {
  if (!validDay(day) || !Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59 || !Number.isInteger(second) || second < 0 || second > 59) fail('Data e ora non valide.');
  const [year, month, date] = day.split('-').map(Number);
  const desired = Date.UTC(year, month - 1, date, hour, minute, second);
  let guess = desired;
  for (let i = 0; i < 3; i++) {
    const p = dateParts(new Date(guess));
    guess += desired - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  }
  const p = dateParts(new Date(guess));
  if (`${p.year}-${p.month}-${p.day}` !== day || +p.hour !== hour || +p.minute !== minute) fail('Questa ora non esiste nel fuso Europe/Rome (cambio ora legale). Scegli un’altra ora.');
  return new Date(guess).toISOString();
}
export function parseRomeDateTime(value) {
  if (value === '' || value === null || value === undefined) return null;
  const match = typeof value === 'string' && value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) fail('Usa una data e ora nel formato YYYY-MM-DDTHH:mm.');
  return romeDateTime(match[1], +match[2], +match[3], +(match[4] ?? 0));
}
function shiftDay(day, rule, anchorDay) {
  const [year, month, date] = day.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, date, 12));
  if (rule === 'monthly') {
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(anchorDay ?? date, last));
  } else d.setUTCDate(d.getUTCDate() + (rule === 'weekly' ? 7 : 1));
  return d.toISOString().slice(0, 10);
}
function nextDate(value, rule, fallback, anchorDay) {
  if (!value) return null;
  if (validDay(value)) return shiftDay(value, rule, anchorDay);
  const p = dateParts(new Date(value));
  return romeDateTime(shiftDay(todayKey(value ?? fallback), rule, anchorDay), +p.hour, +p.minute, +p.second);
}
/** All actions are applied to a copy. Any validation error rejects the whole batch. */
export function applyActions(state, actions, operationId) {
  const base = validateState(state);
  if (operationId && base.operationIds.includes(operationId)) return state;
  if (!Array.isArray(actions) || actions.length > 100) fail('Richiesta: massimo 100 azioni.');
  const next = clone(base);
  const now = stamp();
  for (const action of actions) {
    if (!object(action) || !object(action.args)) fail('Azione non valida.');
    const args = action.args;
    let entityId = args.id || null;
    const getTask = () => next.tasks.find(t => t.id === args.id) || fail('Attività non trovata.');
    switch (action.type) {
      case 'create_task': {
        if (Object.keys(args).some(k => ![...taskKeys, 'id', 'source', 'completedAt'].includes(k))) fail('Creazione attività: campo non consentito.');
        const completedAt = args.status === 'done' ? (args.completedAt || (args.dueAt && args.dueAt.length === 10 ? `${args.dueAt}T18:00:00.000Z` : now)) : null;
        const record = validateTask({ ...args, id: args.id || uid(), createdAt: now, updatedAt: now, completedAt, source: args.source || 'manual', version: 1 }, next.tasks.length);
        if (next.tasks.some(t => t.id === record.id)) fail('ID attività già esistente.');
        next.tasks.push(record); entityId = record.id; break;
      }
      case 'update_task': {
        const target = getTask();
        // Accept a flat patch as well as an explicit changes object.
        const changes = args.changes ?? Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'id'));
        if (!object(changes) || Object.keys(changes).some(k => !taskKeys.includes(k)) || (args.changes && Object.keys(args).some(k => !['id', 'changes'].includes(k)))) fail('Modifica attività: campo non consentito.');
        if (changes.status === 'done' && target.status !== 'done') fail('Per completare usa complete_task.');
        Object.assign(target, changes, { updatedAt: now, version: target.version + 1 });
        if ('dueAt' in changes || 'recurrenceRule' in changes) target.recurrenceDueDay = null;
        if ('reminderAt' in changes || 'recurrenceRule' in changes) target.recurrenceReminderDay = null;
        if (target.status === 'todo') target.completedAt = null;
        break;
      }
      case 'complete_task': {
        if (Object.keys(args).some(k => !['id', 'completed'].includes(k)) || (args.completed !== undefined && typeof args.completed !== 'boolean')) fail('Completamento attività: argomenti non validi.');
        const target = getTask();
        if (args.completed === false) {
          if (target.status === 'done') { target.status = 'todo'; target.completedAt = null; target.updatedAt = now; target.version++; }
          break;
        }
        if (target.status === 'done') break;
        target.status = 'done'; target.completedAt = now; target.updatedAt = now; target.version++;
        if (target.recurrenceRule) {
          const rootId = target.recurrenceRootId ?? target.id;
          const sequence = (target.recurrenceSequence ?? 0) + 1;
          let hash = 2166136261;
          for (let i = 0; i < rootId.length; i++) hash = Math.imul(hash ^ rootId.charCodeAt(i), 16777619);
          const nextId = `${rootId.slice(0, 115)}~${(hash >>> 0).toString(36)}~${sequence}`;
          const recurrenceDueDay = target.recurrenceDueDay ?? (target.dueAt ? +(validDay(target.dueAt) ? target.dueAt : todayKey(target.dueAt)).slice(8, 10) : null);
          const recurrenceReminderDay = target.recurrenceReminderDay ?? (target.reminderAt ? +todayKey(target.reminderAt).slice(8, 10) : null);
          if (!next.tasks.some(t => t.id === nextId)) next.tasks.push({ ...clone(target), id: nextId, status: 'todo', completedAt: null, createdAt: now, updatedAt: now, version: 1, dueAt: nextDate(target.dueAt, target.recurrenceRule, now, recurrenceDueDay), reminderAt: nextDate(target.reminderAt, target.recurrenceRule, now, recurrenceReminderDay), subtasks: target.subtasks.map(s => ({ ...s, done: false })), recurrenceParentId: target.id, recurrenceRootId: rootId, recurrenceSequence: sequence, recurrenceDueDay, recurrenceReminderDay });
        }
        break;
      }
      case 'delete_task': {
        if (Object.keys(args).some(k => k !== 'id')) fail('Cancellazione attività: argomenti non validi.');
        const target = getTask();
        next.settings.agentTrash = [...(next.settings.agentTrash || []), { task: clone(target), deletedAt: now }].slice(-100);
        next.tasks = next.tasks.filter(t => t.id !== args.id);
        for (const day of Object.keys(next.plans)) next.plans[day] = next.plans[day].filter(key => key !== args.id);
        break;
      }
      case 'restore_task': {
        const item = (next.settings.agentTrash || []).find(r => r.task.id === args.id) || fail('Attività non presente nel cestino.');
        if (next.tasks.some(t => t.id === args.id)) fail('Attività già presente.');
        next.tasks.push({ ...item.task, projectId: next.projects.some(p => p.id === item.task.projectId) ? item.task.projectId : null });
        next.settings.agentTrash = next.settings.agentTrash.filter(r => r.task.id !== args.id); break;
      }
      case 'delete_project': {
        const target = next.projects.find(p => p.id === args.id) || fail('Progetto non trovato.');
        next.settings.projectTrash = [...(next.settings.projectTrash || []), { project: clone(target), deletedAt: now }].slice(-100);
        next.projects = next.projects.filter(p => p.id !== args.id);
        for (const task of next.tasks) if (task.projectId === args.id) task.projectId = null;
        break;
      }
      case 'remember_fact': {
        const text = string(args.text, 'Ricordo', 1500, true);
        const memories = next.settings.agentMemories || [];
        if (!memories.some(m => m.text.toLowerCase() === text.toLowerCase())) memories.push({ id: uid(), text, createdAt: now, source: 'user-request' });
        next.settings.agentMemories = memories; break;
      }
      case 'forget_fact': {
        if (!(next.settings.agentMemories || []).some(m => m.id === args.id)) fail('Ricordo non trovato.');
        next.settings.agentMemories = next.settings.agentMemories.filter(m => m.id !== args.id);
        // Old conversation must not reintroduce a fact explicitly forgotten.
        next.settings.agentConversation = []; break;
      }
      case 'set_daily_priorities': {
        if (Object.keys(args).some(k => !['date', 'taskIds'].includes(k))) fail('Piano: campo non consentito.');
        const day = args.date || todayKey();
        const ids = args.taskIds;
        if (!validDay(day) || !Array.isArray(ids) || ids.length > 5 || new Set(ids).size !== ids.length || ids.some(key => !next.tasks.some(t => t.id === key))) fail('Scegli al massimo cinque attività esistenti per una data valida.');
        next.plans[day] = [...ids]; break;
      }
      case 'create_project': {
        if (Object.keys(args).some(k => !['id', 'title', 'name', 'areaId', 'goal', 'status'].includes(k))) fail('Creazione progetto: campo non consentito.');
        entityId = args.id || uid();
        next.projects.push({ ...args, id: entityId, createdAt: now, updatedAt: now }); break;
      }
      case 'update_project': {
        const target = next.projects.find(p => p.id === args.id) || fail('Progetto non trovato.');
        const changes = args.changes ?? Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'id'));
        if (!object(changes) || Object.keys(changes).some(k => !['title', 'goal', 'areaId', 'status'].includes(k))) fail('Modifica progetto: campo non consentito.');
        Object.assign(target, changes, { updatedAt: now }); break;
      }
      case 'add_subtask': {
        if (Object.keys(args).some(k => !['id', 'title', 'subtaskId'].includes(k))) fail('Sottoattività: campo non consentito.');
        const target = getTask();
        target.subtasks.push({ id: args.subtaskId || uid(), title: string(args.title, 'Sottoattività', 500, true), done: false });
        target.updatedAt = now; target.version++; break;
      }
      default: fail(`Strumento non consentito: ${action.type}.`);
    }
    next.activity.push({ id: uid(), type: action.type, entityId, at: now, operationId: operationId || null });
  }
  if (operationId) next.operationIds.push(id(operationId, 'Identificativo operazione'));
  return validateState(next);
}
function normalized(text) { return text.toLocaleLowerCase('it').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }
function findTask(query, state) {
  const needle = normalized(query).replace(/^(?:il|la|lo|l'|l’attivita|l'attivita|attivita|task)\s*/i, '');
  const candidates = state.tasks.filter(t => t.status !== 'done' && normalized(t.title).includes(needle));
  return needle.length >= 2 ? candidates : [];
}
/** Small local grammar, explicitly not a language model. It never writes data. */
export function parseCommands(text, state, now = new Date()) {
  string(text, 'Comando', 6000, true);
  const input = text.trim(); const lower = normalized(input); const base = validateState(state);
  const response = (actions, message) => ({ actions, message });
  if (/\b(cancella|elimina|rimuovi|azzera|speso|pagato|guadagnato|euro|saldo|bonifico|trasferisci|€)\b/i.test(lower)) return response([], 'Il parser locale non esegue cancellazioni o operazioni finanziarie. Usa i controlli dedicati e la relativa conferma.');
  if (/^(cosa (?:devo|c'e da) fare|mostra|elenca|cerca|trova|quali)/i.test(lower)) {
    const query = lower.replace(/^(cerca|trova)\s+(?:attivita\s+)?/i, '');
    let found = base.tasks.filter(t => t.status === 'todo');
    if (/^(cerca|trova)/.test(lower)) found = found.filter(t => normalized(`${t.title} ${t.notes}`).includes(query));
    else if (/oggi/.test(lower)) {
      const day = todayKey(now); const ids = base.plans[day] ?? [];
      found = found.filter(t => ids.includes(t.id) || (t.dueAt && (validDay(t.dueAt) ? t.dueAt : todayKey(t.dueAt)) <= day));
    }
    return response([], found.length ? found.map(t => `• ${t.title}${t.dueAt ? ` (${validDay(t.dueAt) ? t.dueAt : new Intl.DateTimeFormat('it-IT', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }).format(new Date(t.dueAt))})` : ''}`).join('\n') : 'Nessuna attività corrispondente.');
  }
  const completion = input.match(/^(?:ho\s+(?:finito|completato|terminato)|completa|segna\s+come\s+fatto)\s+(.+?)[.!]?$/i);
  if (completion) {
    const matches = findTask(completion[1], base);
    if (matches.length !== 1) return response([], matches.length ? 'Ho trovato più attività. Indica il titolo completo o usa la lista Focus.' : 'Non trovo un’attività aperta con quel titolo.');
    return response([{ type: 'complete_task', args: { id: matches[0].id } }], `Completa «${matches[0].title}».`);
  }
  if (/\b(lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica|settimana prossima|piu tardi|stasera|pomeriggio|mattina|fra|tra)\b|\d{1,2}\/\d{1,2}/.test(lower)) return response([], 'Per le date il parser locale riconosce oggi, domani o YYYY-MM-DD, con «alle HH:mm» facoltativo. Riformula la data per evitare interpretazioni arbitrarie.');
  const verb = '(?:compra(?:re)?|acquista(?:re)?|invia(?:re)?|spedi(?:sci|re)|verifica(?:re)?|chiama(?:re)?|prepara(?:re)?|crea(?:re)?|paga(?:re)?|prenota(?:re)?|controlla(?:re)?|aggiungi|ricordami|devo|fare|manda(?:re)?|porta(?:re)?|scrivi|aggiorna(?:re)?)';
  const chunks = input.split(new RegExp(`(?:[;\\n]+|\\s+e\\s+(?=(?:(?:poi|devo)\\s+)?${verb}\\b))`, 'i')).map(s => s.trim()).filter(Boolean);
  if (chunks.length > 20) return response([], 'Invia al massimo 20 attività alla volta.');
  let sharedDay = null;
  if (/^(?:domani|oggi)\b/i.test(input)) sharedDay = /^domani/i.test(input) ? shiftDay(todayKey(now), 'daily') : todayKey(now);
  const actions = [];
  for (let chunk of chunks) {
    const chunkLower = normalized(chunk);
    if (/\b(?:sposta|modifica|aggiorna la scadenza|metti in priorita)\b/.test(chunkLower)) return response([], 'Per modificare un’attività usa la scheda in Focus. Il parser locale gestisce creazione, ricerca e completamento univoco.');
    let dueAt = sharedDay;
    const dates = [...chunk.matchAll(/\b(?:oggi|domani|\d{4}-\d{2}-\d{2})\b/gi)];
    if (dates.length > 1) return response([], 'Sono presenti più date nella stessa attività. Separale in comandi distinti.');
    if (dates.length) {
      const dateText = dates[0][0].toLowerCase();
      dueAt = dateText === 'oggi' ? todayKey(now) : dateText === 'domani' ? shiftDay(todayKey(now), 'daily') : dateText;
      if (!validDay(dueAt)) return response([], 'La data indicata non è valida.');
      chunk = chunk.replace(dates[0][0], '').trim();
    }
    const time = chunk.match(/\balle\s+(\d{1,2})(?:[:.](\d{2}))?\b/i);
    if (time) {
      if (!dueAt) return response([], 'Hai indicato un’ora senza una data. Aggiungi oggi, domani o YYYY-MM-DD.');
      if (+time[1] > 23 || +(time[2] ?? 0) > 59) return response([], 'L’ora indicata non è valida.');
      try { dueAt = romeDateTime(dueAt, +time[1], +(time[2] ?? 0)); } catch (e) { return response([], e.message); }
      chunk = chunk.replace(time[0], '').trim();
    }
    const reminderRequested = /ricordami/i.test(chunk);
    chunk = chunk.replace(/^(?:poi\s+)?(?:devo\s+|aggiungi\s+(?:un(?:a)?\s+)?(?:task|attivit[àa])?\s*[:\-]?\s*|ricordami\s+(?:di\s+)?)/i, '').replace(/\s+/g, ' ').replace(/^[,.:\s]+|[,.:\s]+$/g, '');
    if (!chunk || chunk.length > 500) return response([], 'Scrivi un titolo breve e concreto per ogni attività.');
    const title = chunk.charAt(0).toLocaleUpperCase('it') + chunk.slice(1);
    const duplicate = base.tasks.some(t => t.status === 'todo' && normalized(t.title) === normalized(title) && t.dueAt === dueAt) || actions.some(a => normalized(a.args.title) === normalized(title) && a.args.dueAt === dueAt);
    if (duplicate) return response([], `«${title}» è già presente con la stessa scadenza. Nessuna attività aggiunta.`);
    actions.push({ type: 'create_task', args: { title, dueAt, reminderAt: reminderRequested && dueAt?.includes('T') ? dueAt : null, areaId: /zerilli/i.test(chunk) ? 'zerilli' : /\brep\b/i.test(chunk) ? 'rep' : 'personale', source: 'local-command' } });
  }
  return response(actions, `${actions.length === 1 ? 'Una nuova attività pronta' : `${actions.length} nuove attività pronte`}.${/ricordami/i.test(input) && !actions.some(a => a.args.reminderAt) ? ' Per un promemoria serve anche un’ora; la data indicata resta una scadenza. Le notifiche in background non sono attive.' : ''}`);
}
const csvColumns = ['empireCsv', 'id', 'title', 'notes', 'areaId', 'projectId', 'status', 'priority', 'dueAt', 'reminderAt', 'subtasks', 'recurrenceRule', 'createdAt', 'updatedAt', 'completedAt', 'source', 'version', 'extra', 'project'];
const safeCsvText = value => `'${value ?? ''}`; // Text marker prevents formula execution in spreadsheet apps; import removes exactly once.
export function exportTasksCsv(state) {
  const data = validateState(state);
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = data.tasks.map(t => {
    const extra = Object.fromEntries(Object.entries(t).filter(([k]) => !csvColumns.includes(k)));
    return csvColumns.map(k => k === 'empireCsv' ? '1' : k === 'subtasks' ? JSON.stringify(t.subtasks) : k === 'extra' ? JSON.stringify(extra) : k === 'project' ? JSON.stringify(data.projects.find(p => p.id === t.projectId) ?? null) : ['id', 'title', 'notes', 'projectId', 'source'].includes(k) ? safeCsvText(t[k]) : t[k]);
  });
  return '\uFEFF' + [csvColumns, ...rows].map(row => row.map(quote).join(',')).join('\r\n');
}
function readCsv(text) {
  const result = []; let row = []; let field = ''; let quoted = false; let afterQuote = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; afterQuote = true; } else field += c;
    } else if (c === '"' && !field && !afterQuote) quoted = true;
    else if (c === ',') { row.push(field); field = ''; afterQuote = false; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); if (row.some(Boolean)) result.push(row); row = []; field = ''; afterQuote = false; }
    else { if (afterQuote) fail('CSV: carattere inatteso dopo virgolette.'); field += c; }
  }
  if (quoted) fail('CSV: virgolette non chiuse.');
  row.push(field); if (row.some(Boolean)) result.push(row);
  return result;
}
export function importTasksCsv(text) {
  if (typeof text !== 'string' || text.length > 10000000) fail('CSV troppo grande o non valido (max 10 MB).');
  const [headers, ...rows] = readCsv(text);
  if (!headers || new Set(headers).size !== headers.length || !headers.includes('title') || !headers.includes('id')) fail('CSV: intestazioni id e title richieste, senza duplicati.');
  const tasks = rows.map((row, i) => {
    if (row.length !== headers.length) fail(`CSV riga ${i + 2}: numero colonne non valido.`);
    const record = Object.fromEntries(headers.map((h, j) => [h, row[j]]));
    const own = record.empireCsv === '1';
    let extra = {}; let subtasks = [];
    try { extra = record.extra ? JSON.parse(record.extra) : {}; subtasks = record.subtasks ? JSON.parse(record.subtasks) : []; } catch { fail(`CSV riga ${i + 2}: JSON sottoattività/metadati non valido.`); }
    if (!object(extra)) fail(`CSV riga ${i + 2}: metadati non validi.`);
    delete record.empireCsv; delete record.extra; delete record.project;
    for (const key of ['id', 'title', 'notes', 'projectId', 'source']) if (own && record[key]?.startsWith("'")) record[key] = record[key].slice(1);
    for (const key of ['dueAt', 'reminderAt', 'completedAt', 'projectId', 'recurrenceRule']) if (!record[key]) record[key] = null;
    for (const key of ['createdAt', 'updatedAt']) if (!record[key]) delete record[key];
    return validateTask({ ...extra, ...record, subtasks, version: record.version ? Number(record.version) : 1 }, i);
  });
  unique(tasks, 'CSV: ID attività duplicati.');
  return tasks;
}
export function importCsvState(text) {
  const tasks = importTasksCsv(text);
  const [headers, ...rows] = readCsv(text);
  const projects = []; const column = headers.indexOf('project');
  if (column >= 0) for (let i = 0; i < rows.length; i++) {
    if (!rows[i][column]) continue;
    let project;
    try { project = JSON.parse(rows[i][column]); } catch { fail(`CSV riga ${i + 2}: metadati progetto non validi.`); }
    if (project === null) continue;
    if (!object(project)) fail(`CSV riga ${i + 2}: progetto non valido.`);
    const existing = projects.find(p => p.id === project.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(project)) fail(`CSV: versioni in conflitto del progetto ${project.id}.`);
    if (!existing) projects.push(project);
  }
  return validateState({ ...emptyState(), tasks, projects });
}
/** Conflict-safe import: identical IDs/content deduplicate; changed records are preserved under a new ID. */
export function mergeImport(current, incoming) {
  const base = validateState(current); const source = validateState(incoming); const next = clone(base);
  const same = (a, b) => {
    const canonical = obj => Object.fromEntries(Object.keys(obj).sort().map(k => [k, obj[k]]));
    return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  };
  const projectMap = new Map(); const taskMap = new Map();
  const addedTasks = [];
  const originalReferences = record => {
    const copy = { ...record };
    for (const key of ['recurrenceRootId', 'recurrenceParentId']) {
      if (copy[key]) copy[key] = next.tasks.find(t => t.id === copy[key])?.importOriginalId ?? copy[key];
    }
    return copy;
  };
  for (const project of source.projects) {
    const existing = next.projects.find(p => p.id === project.id);
    if (!existing) { next.projects.push(project); projectMap.set(project.id, project.id); }
    else if (same(existing, project)) projectMap.set(project.id, project.id);
    else {
      const priorCopy = next.projects.find(p => p.importOriginalId === project.id && same({ ...p, id: project.id, importOriginalId: undefined }, { ...project, importOriginalId: undefined }));
      const copy = priorCopy ?? { ...project, id: uid(), importOriginalId: project.id };
      if (!priorCopy) next.projects.push(copy); projectMap.set(project.id, copy.id);
    }
  }
  for (const original of source.tasks) {
    const task = { ...original, projectId: projectMap.get(original.projectId) ?? original.projectId };
    const existing = next.tasks.find(t => t.id === task.id);
    if (!existing) { next.tasks.push(task); addedTasks.push(task); taskMap.set(original.id, task.id); }
    else if (same(existing, task) || same(originalReferences(existing), task)) taskMap.set(original.id, task.id);
    else {
      const priorCopy = next.tasks.find(t => t.importOriginalId === task.id && same({ ...originalReferences(t), id: task.id, importOriginalId: undefined }, { ...task, importOriginalId: undefined }));
      const copy = priorCopy ?? { ...task, id: uid(), importOriginalId: task.id };
      if (!priorCopy) { next.tasks.push(copy); addedTasks.push(copy); } taskMap.set(original.id, copy.id);
    }
  }
  for (const task of addedTasks) {
    for (const key of ['recurrenceRootId', 'recurrenceParentId']) if (taskMap.has(task[key])) task[key] = taskMap.get(task[key]);
  }
  for (const [day, ids] of Object.entries(source.plans)) {
    const translated = ids.map(key => taskMap.get(key));
    if (!next.plans[day]) next.plans[day] = translated;
    else if (JSON.stringify(next.plans[day]) !== JSON.stringify(translated)) {
      next.importedPlans ??= [];
      if (!next.importedPlans.some(p => p.date === day && JSON.stringify(p.taskIds) === JSON.stringify(translated))) next.importedPlans.push({ date: day, taskIds: translated });
    }
  }
  next.operationIds = [...new Set([...base.operationIds, ...source.operationIds])];
  const activityIds = new Set(base.activity.map(a => a.id));
  next.activity.push(...source.activity.filter(a => !activityIds.has(a.id)));
  // Keep source settings and unrecognized collections as an archive instead of overwriting local data.
  const extras = Object.fromEntries(Object.entries(source).filter(([k]) => !['schemaVersion', 'tasks', 'projects', 'plans', 'activity', 'operationIds'].includes(k)));
  if (JSON.stringify(extras) !== JSON.stringify({ settings: base.settings })) {
    next.importArchives ??= [];
    if (!next.importArchives.some(x => JSON.stringify(x) === JSON.stringify(extras))) next.importArchives.push(extras);
  }
  return validateState(next);
}
