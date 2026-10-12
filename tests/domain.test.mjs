import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { applyActions, emptyState, exportTasksCsv, importTasksCsv, importCsvState, mergeImport, parseCommands, parseRomeDateTime, todayKey, validateState } from '../src/domain.js';
import { LocalRepository } from '../src/repository.js';
import { createHandler } from '../server/index.js';

const create = (title, extras = {}) => ({ type: 'create_task', args: { title, ...extras } });
const withTasks = (...titles) => applyActions(emptyState(), titles.map(title => create(title)));
const fixed = new Date('2026-10-11T22:30:00Z');

test('empty data is honest and Rome day differs from UTC near midnight', () => {
  assert.deepEqual(emptyState().tasks, []);
  assert.equal(todayKey(fixed), '2026-10-12');
});
test('local parser captures two tasks without inventing due dates', () => {
  const parsed = parseCommands('Devo spedire il pacco Yu-Gi-Oh e comprare la risma A4', emptyState(), fixed);
  assert.equal(parsed.actions.length, 2);
  assert.equal(parsed.actions[0].args.title, 'Spedire il pacco Yu-Gi-Oh');
  assert.equal(parsed.actions[1].args.title, 'Comprare la risma A4');
  assert.ok(parsed.actions.every(a => a.args.dueAt === null && a.args.reminderAt === null));
});
test('semicolon and newline separate tasks, conjunction inside a title stays intact', () => {
  const parsed = parseCommands('Comprare pane e latte; chiamare Mario\nverificare SPID', emptyState(), fixed);
  assert.equal(parsed.actions.length, 3);
  assert.equal(parsed.actions[0].args.title, 'Comprare pane e latte');
});
test('tomorrow 16 is converted using Rome summer time', () => {
  const parsed = parseCommands('Domani alle 16 ricordami di verificare assicurazione', emptyState(), fixed);
  assert.equal(parsed.actions[0].args.dueAt, '2026-10-13T14:00:00.000Z');
  assert.equal(parsed.actions[0].args.reminderAt, parsed.actions[0].args.dueAt);
});
test('date-only reminders do not invent a reminder hour', () => {
  const parsed = parseCommands('Domani ricordami di comprare carta', emptyState(), fixed);
  assert.equal(parsed.actions[0].args.dueAt, '2026-10-13');
  assert.equal(parsed.actions[0].args.reminderAt, null);
  assert.match(parsed.message, /ora/);
});
test('time without date and ambiguous dates require clarification', () => {
  assert.equal(parseCommands('Chiama Mario alle 16', emptyState()).actions.length, 0);
  assert.equal(parseCommands('Chiama Mario lunedì', emptyState()).actions.length, 0);
  assert.equal(parseCommands('Chiama Mario oggi domani', emptyState()).actions.length, 0);
  assert.equal(parseCommands('Chiama Mario 2026-02-30', emptyState()).actions.length, 0);
});
test('DST nonexistent local times reject and winter time converts correctly', () => {
  assert.throws(() => parseRomeDateTime('2026-03-29T02:30'), /non esiste/);
  assert.equal(parseRomeDateTime('2026-12-12T16:00'), '2026-12-12T15:00:00.000Z');
  assert.equal(parseRomeDateTime(''), null);
});
test('read command lists actual tasks and ambiguous completion writes nothing', () => {
  const state = withTasks('QR Zerilli vetrina', 'QR Zerilli tavoli');
  assert.equal(parseCommands('Ho finito QR Zerilli', state).actions.length, 0);
  assert.match(parseCommands('Cerca QR Zerilli', state).message, /vetrina/);
  const parsed = parseCommands('Ho finito QR Zerilli vetrina', state);
  assert.equal(parsed.actions[0].args.id, state.tasks[0].id);
});
test('repeated local title is detected without partial create', () => {
  const state = withTasks('Compra carta igienica');
  const parsed = parseCommands('Chiama Mario; compra carta igienica', state);
  assert.equal(parsed.actions.length, 0);
  assert.equal(state.tasks.length, 1);
});
test('local parser refuses financial and destructive actions', () => {
  assert.equal(parseCommands('Ho speso 35 euro di benzina', emptyState()).actions.length, 0);
  assert.equal(parseCommands('Cancella tutte le attività', emptyState()).actions.length, 0);
});
test('action batches are atomic when a later tool is invalid', () => {
  const state = emptyState();
  assert.throws(() => applyActions(state, [create('Prima'), { type: 'erase_database', args: {} }]), /non consentito/);
  assert.equal(state.tasks.length, 0);
});
test('operation IDs prevent repeat writes and survive JSON reload', () => {
  const next = applyActions(emptyState(), [create('Una volta')], 'request-1');
  const reloaded = validateState(JSON.parse(JSON.stringify(next)));
  assert.strictEqual(applyActions(reloaded, [create('Una volta')], 'request-1'), reloaded);
  assert.equal(reloaded.tasks.length, 1);
});
test('daily priority maximum is enforced and ordered selection persists', () => {
  const state = withTasks('Uno', 'Due', 'Tre', 'Quattro', 'Cinque', 'Sei');
  const ids = state.tasks.map(t => t.id);
  assert.throws(() => applyActions(state, [{ type: 'set_daily_priorities', args: { date: '2026-10-12', taskIds: ids } }]), /massimo cinque/);
  const next = applyActions(state, [{ type: 'set_daily_priorities', args: { date: '2026-10-12', taskIds: [ids[2], ids[0]] } }]);
  assert.deepEqual(next.plans['2026-10-12'], [ids[2], ids[0]]);
});
test('recurring completion creates one successor; reopening does not duplicate it', () => {
  let state = applyActions(emptyState(), [create('Routine', { dueAt: '2026-10-24T14:00:00Z', reminderAt: '2026-10-24T14:00:00Z', recurrenceRule: 'daily' })]);
  const original = state.tasks[0].id;
  state = applyActions(state, [{ type: 'complete_task', args: { id: original } }]);
  assert.equal(state.tasks.length, 2);
  assert.equal(state.tasks[1].dueAt, '2026-10-25T15:00:00.000Z');
  state = applyActions(state, [{ type: 'complete_task', args: { id: original, completed: false } }]);
  assert.equal(state.tasks[0].status, 'todo');
  assert.equal(state.tasks[0].completedAt, null);
  state = applyActions(state, [{ type: 'complete_task', args: { id: original } }]);
  assert.equal(state.tasks.length, 2);
});
test('monthly recurrence clamps to month end and IDs remain short after many completions', () => {
  let state = applyActions(emptyState(), [create('Monthly', { dueAt: '2026-01-31', recurrenceRule: 'monthly' })]);
  state = applyActions(state, [{ type: 'complete_task', args: { id: state.tasks[0].id } }]);
  assert.equal(state.tasks[1].dueAt, '2026-02-28');
  state = applyActions(state, [{ type: 'complete_task', args: { id: state.tasks[1].id } }]);
  assert.equal(state.tasks[2].dueAt, '2026-03-31');
  for (let i = 0; i < 40; i++) state = applyActions(state, [{ type: 'complete_task', args: { id: state.tasks.at(-1).id } }]);
  assert.ok(state.tasks.every(t => t.id.length <= 160));
});
test('CSV round trip preserves commas, quotes, newline, metadata, formula-like text and project', () => {
  let state = applyActions(emptyState(), [{ type: 'create_project', args: { id: 'p1', title: 'Progetto Zerilli', areaId: 'zerilli' } }]);
  state = applyActions(state, [create('=SUM(1,2) "test"', { notes: 'riga 1\nriga 2', projectId: 'p1', recurrenceRule: 'weekly', dueAt: '2026-12-11' })]);
  state.tasks[0].legacyField = 'keep me';
  const csv = exportTasksCsv(state);
  assert.match(csv, /'=SUM/);
  assert.deepEqual(importTasksCsv(csv), state.tasks);
  const restored = importCsvState(csv);
  assert.deepEqual(restored.tasks, state.tasks);
  assert.deepEqual(restored.projects, state.projects);
});
test('CSV rejects malformed rows and duplicate IDs', () => {
  assert.throws(() => importTasksCsv('id,title\na,"broken'), /virgolette/);
  assert.throws(() => importTasksCsv('id,title\na,one\na,two'), /duplicati/);
  assert.throws(() => importTasksCsv('id,title\na,one,extra'), /colonne/);
});
test('CSV treats formula-like imported IDs and project references as reversible text', () => {
  const projectId = '@SUM(1,2)';
  const taskId = '=2+2';
  let state = applyActions(emptyState(), [{ type: 'create_project', args: { id: projectId, title: 'Archivio importato' } }]);
  state = applyActions(state, [create('Task importato', { id: taskId, projectId }), create('Apostrofo originale', { id: "'=3+4" })]);
  const csv = exportTasksCsv(state);
  assert.ok(csv.includes('"\'=2+2"'));
  assert.ok(csv.includes('"\'@SUM(1,2)"'));
  assert.ok(csv.includes('"\'\'=3+4"'));
  const restored = importCsvState(csv);
  assert.deepEqual(restored.tasks, state.tasks);
  assert.deepEqual(restored.projects, state.projects);
});
test('today read query compares timed due dates in Rome, preserving date-only due dates', () => {
  const state = applyActions(emptyState(), [
    create('Domani appena dopo mezzanotte', { dueAt: '2026-10-12T00:15:00+02:00' }),
    create('Scadenza del giorno', { dueAt: '2026-10-11' }),
    create('Arretrato a mezzanotte', { dueAt: '2026-10-10T00:15:00+02:00' }),
  ]);
  const message = parseCommands('Cosa devo fare oggi?', state, new Date('2026-10-11T18:00:00Z')).message;
  assert.doesNotMatch(message, /Domani appena/);
  assert.match(message, /Scadenza del giorno/);
  assert.match(message, /Arretrato a mezzanotte/);
});
test('backup validation rejects unknown schemas and invalid known settings while preserving extensions', () => {
  assert.throws(() => validateState({ ...emptyState(), schemaVersion: 999 }), /non supportata/);
  assert.throws(() => validateState({ ...emptyState(), settings: { name: 123 } }), /testo/);
  assert.throws(() => validateState({ ...emptyState(), settings: [] }), /settings/);
  const data = { ...emptyState(), settings: { name: 'Salvatore', futurePreference: { mode: 'quiet' } }, legacyCollection: [{ id: 'external-1', original: true }] };
  assert.deepEqual(validateState(data).settings, data.settings);
  assert.deepEqual(validateState(data).legacyCollection, data.legacyCollection);
});
test('unknown schema and dangling project references reject without touching source', () => {
  assert.throws(() => validateState({ ...emptyState(), schemaVersion: 2 }), /non supportata/);
  const state = withTasks('Task'); state.tasks[0].projectId = 'missing';
  assert.throws(() => validateState(state), /progetto.*mancante/);
  assert.equal(state.tasks[0].projectId, 'missing');
});
test('import deduplicates repeated data, preserves conflicts and settings', () => {
  const base = withTasks('Originale'); base.settings.name = 'Salvatore';
  const source = structuredClone(base); source.tasks[0].title = 'Versione importata'; source.settings.name = 'Altro';
  const first = mergeImport(base, source); const second = mergeImport(first, source);
  assert.equal(first.tasks.length, 2);
  assert.equal(second.tasks.length, 2);
  assert.equal(second.settings.name, 'Salvatore');
  assert.equal(second.importArchives[0].settings.name, 'Altro');
  assert.equal(mergeImport(base, base).tasks.length, 1);
});
test('project conflicts retain incoming relationships and reimport does not duplicate', () => {
  let base = applyActions(emptyState(), [{ type: 'create_project', args: { id: 'p1', title: 'Originale' } }, create('Task', { id: 't1', projectId: 'p1' })]);
  const source = structuredClone(base); source.projects[0].title = 'Importato';
  const merged = mergeImport(base, source); const repeated = mergeImport(merged, source);
  assert.equal(repeated.projects.length, 2);
  assert.equal(repeated.tasks.length, 2);
  const importedTask = repeated.tasks.find(t => t.importOriginalId === 't1');
  assert.equal(repeated.projects.find(p => p.id === importedTask.projectId).title, 'Importato');
});
test('IndexedDB unavailable rejects both load and save without fallback', async () => {
  const repo = new LocalRepository({ indexedDB: null });
  await assert.rejects(repo.load(), /non disponibile/);
  await assert.rejects(repo.save(emptyState()), /non disponibile/);
});

async function api(t, options) {
  const handler = createHandler(options);
  return async (url, options = {}) => {
    const req = Readable.from(options.body ? [Buffer.from(options.body)] : []);
    Object.assign(req, { method: options.method || 'GET', url, socket: { remoteAddress: '127.0.0.1' }, headers: Object.fromEntries(Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])) });
    let payload; let status = 200;
    const res = { writableEnded: false, setHeader() {}, writeHead(value) { status = value; }, end(body) { payload = body; this.writableEnded = true; } };
    await handler(req, res);
    return { status, json: async () => JSON.parse(payload) };
  };
}
test('backend without key reports honest state and makes no network request', async t => {
  let calls = 0;
  const base = await api(t, { env: {}, fetcher: () => { calls++; throw new Error('must not call'); } });
  const status = await (await base('/api/status')).json();
  assert.equal(status.aiConfigured, false);
  assert.equal(status.push, false);
  assert.equal((await base('/api/assistant', { method: 'POST' })).status, 503);
  assert.equal(calls, 0);
});
test('backend rejects foreign origin and requires Firebase auth before Gemini', async t => {
  let calls = 0;
  const base = await api(t, { env: { GEMINI_API_KEY: 'unit-test-only' }, fetcher: () => { calls++; } });
  assert.equal((await base('/api/status', { headers: { Origin: 'https://attacker.invalid' } })).status, 403);
  assert.equal((await base('/api/assistant', { method: 'POST' })).status, 401);
  assert.equal(calls, 0);
});
test('authenticated structured Gemini proposal validates but never commits data (transport fixture)', async t => {
  const state = emptyState();
  const base = await api(t, { env: { GEMINI_API_KEY: 'unit-test-only' }, verifyToken: async () => ({ uid: 'owner' }), fetcher: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: 'create_task', args: { title: 'Compra carta' } } }] } }] }) }) });
  const result = await base('/api/assistant', { method: 'POST', headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Compra carta', state }) });
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.saved, false);
  assert.equal(body.requiresConfirmation, true);
  assert.equal(body.actions[0].type, 'create_task');
  assert.equal(state.tasks.length, 0);
});
test('Gemini invented due date is refused and cross-owner context is refused (transport fixture)', async t => {
  const base = await api(t, { env: { GEMINI_API_KEY: 'unit-test-only' }, verifyToken: async () => ({ uid: 'owner' }), fetcher: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: 'create_task', args: { title: 'Compra carta', dueAt: '2026-10-12' } } }] } }] }) }) });
  const post = state => base('/api/assistant', { method: 'POST', headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Compra carta', state }) });
  assert.equal((await post(emptyState())).status, 422);
  const foreign = withTasks('Private'); foreign.tasks[0].userId = 'another-owner';
  assert.equal((await post(foreign)).status, 403);
});
