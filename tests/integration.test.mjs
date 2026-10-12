import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, validateState, parseCommands, applyActions, todayKey, exportTasksCsv, importCsvState, mergeImport, romeDateTime, parseRomeDateTime } from '../src/domain.js';

const action = (type, args) => ({ type, args });
const create = (state, args, operationId) => applyActions(state, [action('create_task', args)], operationId);

test('quick capture multi-attività, scelta priorità, completamento e riapertura formano un flusso coerente', () => {
  const initial = emptyState();
  const proposal = parseCommands('Devo spedire il pacco e comprare la risma A4', initial, new Date('2026-10-12T10:00:00Z'));
  assert.equal(proposal.actions.length, 2);
  let state = applyActions(initial, proposal.actions, 'capture-request');
  assert.equal(state.tasks.length, 2);
  assert.ok(state.tasks.every(t => t.dueAt === null && t.reminderAt === null));
  const taskIds = state.tasks.map(t => t.id);
  state = applyActions(state, [action('set_daily_priorities', { date: '2026-10-12', taskIds })], 'select-priorities');
  state = applyActions(state, [action('complete_task', { id: taskIds[0], completed: true })], 'complete-first');
  assert.equal(state.plans['2026-10-12'].filter(id => state.tasks.find(t => t.id === id).status === 'done').length, 1);
  assert.ok(state.tasks[0].completedAt);
  state = applyActions(state, [action('complete_task', { id: taskIds[0], completed: false })], 'reopen-first');
  assert.equal(state.tasks[0].status, 'todo');
  assert.equal(state.tasks[0].completedAt, null);
  assert.deepEqual(state.plans['2026-10-12'], taskIds);
  assert.equal(initial.tasks.length, 0);
});

test('form piatto conserva identità, origine e metadati mentre modifica progetto e sottoattività', () => {
  let state = applyActions(emptyState(), [action('create_project', { id: 'project-z', title: 'Catalogo Zerilli', areaId: 'zerilli', goal: 'Catalogo pronto' })]);
  state = create(state, { id: 'task-z', title: 'Fotografare', areaId: 'zerilli', projectId: 'project-z', source: 'local-command', subtasks: [{ id: 'sub-z', title: 'Preparare set', done: false }] });
  const before = state.tasks[0];
  state = applyActions(state, [action('update_task', { id: before.id, title: 'Fotografare il banco', notes: 'Luce naturale', areaId: 'zerilli', projectId: 'project-z', priority: 'high', dueAt: null, reminderAt: null, recurrenceRule: null, subtasks: [{ ...before.subtasks[0], done: true }] })]);
  const after = state.tasks[0];
  assert.equal(after.id, before.id);
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.source, 'local-command');
  assert.equal(after.version, before.version + 1);
  assert.deepEqual(after.subtasks, [{ id: 'sub-z', title: 'Preparare set', done: true }]);
  assert.equal(after.status, 'todo', 'una checklist spuntata non completa implicitamente il task principale');
  assert.equal(after.projectId, 'project-z');
});

test('ricorrenza attraversa cambio ora mantenendo ora Roma, sottoattività resettate e nessun duplicato su riapertura', () => {
  let state = create(emptyState(), { id: 'routine', title: 'Controllare ordini', dueAt: '2026-10-24T10:00:00+02:00', reminderAt: '2026-10-24T09:30:00+02:00', recurrenceRule: 'daily', subtasks: [{ id: 'step', title: 'Aprire elenco', done: true }] });
  state = applyActions(state, [action('complete_task', { id: 'routine', completed: true })], 'complete-routine');
  const next = state.tasks.find(t => t.id !== 'routine');
  assert.equal(next.dueAt, '2026-10-25T09:00:00.000Z');
  assert.equal(next.reminderAt, '2026-10-25T08:30:00.000Z');
  assert.equal(next.subtasks[0].done, false);
  assert.equal(next.status, 'todo');
  const afterRetry = applyActions(state, [action('complete_task', { id: 'routine', completed: true })], 'complete-routine');
  assert.equal(afterRetry.tasks.length, 2);
  state = applyActions(afterRetry, [action('complete_task', { id: 'routine', completed: false })], 'reopen-routine');
  state = applyActions(state, [action('complete_task', { id: 'routine', completed: true })], 'recomplete-routine');
  assert.equal(state.tasks.length, 2, 'riaprire e ricompletare la stessa occorrenza non duplica quella successiva');
});

test('routine quotidiana resta valida dopo quaranta occorrenze senza crescita illimitata degli ID', () => {
  let state = create(emptyState(), { id: '8b535cbe-d592-490e-906e-6db3771ab334', title: 'Routine giornaliera', dueAt: '2026-10-12', recurrenceRule: 'daily' });
  for (let index = 0; index < 40; index++) {
    const open = state.tasks.filter(t => t.status === 'todo');
    assert.equal(open.length, 1);
    state = applyActions(state, [action('complete_task', { id: open[0].id })], `routine-${index}`);
  }
  assert.equal(state.tasks.length, 41);
  assert.ok(state.tasks.every(t => t.id.length <= 160));
  assert.equal(new Set(state.tasks.map(t => t.id)).size, 41);
  assert.equal(state.tasks.filter(t => t.status === 'todo').length, 1);
});

test('CSV autonomo ripristina attività assegnate, nomi progetto e formule come testo', () => {
  let state = applyActions(emptyState(), [action('create_project', { id: 'proj', title: 'Campagna, autunno', areaId: 'zerilli', goal: 'Un obiettivo con "virgolette"' })]);
  state = create(state, { id: 'csv-task', title: '=SUM(A1:A3)', notes: 'Prima riga\nSeconda, con "virgolette"', projectId: 'proj', areaId: 'zerilli', subtasks: [{ id: 'csv-step', title: 'Un passo', done: false }] });
  const csv = exportTasksCsv(state);
  const incoming = importCsvState(csv);
  const restored = mergeImport(emptyState(), incoming);
  assert.equal(restored.tasks[0].title, '=SUM(A1:A3)');
  assert.equal(restored.tasks[0].notes, state.tasks[0].notes);
  assert.equal(restored.tasks[0].projectId, 'proj');
  assert.equal(restored.projects[0].title, state.projects[0].title);
  assert.equal(restored.projects[0].goal, state.projects[0].goal);
  assert.deepEqual(restored.tasks[0].subtasks, state.tasks[0].subtasks);
  const repeated = mergeImport(restored, incoming);
  assert.equal(repeated.tasks.length, 1);
  assert.equal(repeated.projects.length, 1);
});

test('merge JSON conserva versioni diverse, collega copie e deduplica reimport', () => {
  let local = applyActions(emptyState(), [action('create_project', { id: 'same-proj', title: 'Locale', areaId: 'personale' })]);
  local = create(local, { id: 'same-task', title: 'Versione locale', projectId: 'same-proj' });
  let incoming = structuredClone(local);
  incoming.projects[0].title = 'Versione del backup';
  incoming.tasks[0].title = 'Task del backup';
  incoming.plans['2026-10-12'] = ['same-task'];
  const merged = mergeImport(local, incoming);
  assert.equal(merged.projects.length, 2);
  assert.equal(merged.tasks.length, 2);
  const copiedTask = merged.tasks.find(t => t.title === 'Task del backup');
  const copiedProject = merged.projects.find(p => p.title === 'Versione del backup');
  assert.equal(copiedTask.projectId, copiedProject.id);
  assert.deepEqual(merged.plans['2026-10-12'], [copiedTask.id]);
  const repeated = mergeImport(merged, incoming);
  assert.equal(repeated.projects.length, 2);
  assert.equal(repeated.tasks.length, 2);
  assert.equal(local.tasks[0].title, 'Versione locale');
});

test('due serie ricorrenti in conflitto restano indipendenti dopo importazione', () => {
  let local = create(emptyState(), { id: 'routine-root', title: 'Routine locale', dueAt: '2026-10-12', recurrenceRule: 'daily' });
  local = applyActions(local, [action('complete_task', { id: 'routine-root' })]);
  const incoming = structuredClone(local);
  incoming.tasks.forEach(t => { t.title = 'Routine importata'; });
  local = applyActions(local, [action('complete_task', { id: local.tasks.find(t => t.status === 'todo').id })]);
  const merged = mergeImport(local, incoming);
  const copiedRoot = merged.tasks.find(t => t.title === 'Routine importata' && t.status === 'done');
  const copiedNext = merged.tasks.find(t => t.title === 'Routine importata' && t.status === 'todo');
  assert.equal(copiedNext.recurrenceRootId, copiedRoot.id);
  assert.equal(copiedNext.recurrenceParentId, copiedRoot.id);
  const completed = applyActions(merged, [action('complete_task', { id: copiedNext.id })]);
  assert.equal(completed.tasks.length, merged.tasks.length + 1);
  assert.equal(completed.tasks.filter(t => t.title === 'Routine importata' && t.status === 'todo').length, 1);
  assert.equal(completed.tasks.filter(t => t.title === 'Routine locale' && t.status === 'todo').length, 1);
  const repeated = mergeImport(merged, incoming);
  assert.equal(repeated.tasks.length, merged.tasks.length);
  assert.equal(repeated.tasks.find(t => t.id === copiedNext.id).recurrenceRootId, copiedRoot.id);
});

test('errore nel secondo comando respinge tutto il lotto senza perdita di dati', () => {
  const state = create(emptyState(), { id: 'original', title: 'Attività già salvata' });
  const snapshot = JSON.stringify(state);
  const proposal = parseCommands('compra carta igienica', state);
  assert.throws(() => applyActions(state, [...proposal.actions, action('update_task', { id: 'missing', title: 'Non salvare' })], 'invalid-batch'), /non trovata/i);
  assert.equal(JSON.stringify(state), snapshot);
  assert.equal(state.operationIds.includes('invalid-batch'), false);
});

test('cancellazione elimina i riferimenti a priorità di ogni giorno e lascia le altre selezioni', () => {
  let state = create(emptyState(), { id: 'a', title: 'Prima' });
  state = create(state, { id: 'b', title: 'Seconda' });
  state = applyActions(state, [action('set_daily_priorities', { date: '2026-10-12', taskIds: ['b', 'a'] }), action('set_daily_priorities', { date: '2026-10-13', taskIds: ['a'] })]);
  state = applyActions(state, [action('delete_task', { id: 'a' })]);
  assert.deepEqual(state.plans['2026-10-12'], ['b']);
  assert.deepEqual(state.plans['2026-10-13'], []);
  assert.equal(state.tasks.length, 1);
});

test('import rifiuta preferenze incompatibili prima che possano rompere l’interfaccia', () => {
  assert.throws(() => validateState({ ...emptyState(), settings: { name: 123 } }), /nome|name|testo/i);
  assert.throws(() => validateState({ ...emptyState(), settings: { name: 'x'.repeat(61) } }), /nome|name|testo/i);
  assert.equal(validateState({ ...emptyState(), settings: { name: 'Il mio spazio', customFlag: true } }).settings.customFlag, true);
});

test('conversione del form promemoria è indipendente dal fuso host e rifiuta ora inesistente', () => {
  assert.equal(parseRomeDateTime('2026-10-12T16:30'), '2026-10-12T14:30:00.000Z');
  assert.equal(romeDateTime('2026-10-12', 16, 30), '2026-10-12T14:30:00.000Z');
  assert.equal(todayKey('2026-10-11T22:30:00.000Z'), '2026-10-12');
  assert.throws(() => parseRomeDateTime('2026-03-29T02:30'), /ora|legale|esiste/i);
});
