import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { validateState } from '../src/domain.js';
import { validateFinance } from '../src/finance-domain.js';
import { connectMySQL } from '../server/mysql-bucket.js';

const unwrap = value => value.state || value;
export function migrationRecords(tasks, finance) {
  const t = validateState(unwrap(tasks)), f = validateFinance(unwrap(finance));
  // The requested name belongs to the copied archive, not to any credential.
  t.settings = { ...t.settings, agentName: 'Merlino' };
  return [['empire/private/tasks.json', JSON.stringify(t)], ['empire/private/finance.json', JSON.stringify(f)]];
}
function nonEmpty(key, bytes) {
  const value = JSON.parse(Buffer.from(bytes).toString('utf8'));
  if (key.endsWith('tasks.json')) return value.tasks?.length || value.projects?.length || value.activity?.length || value.settings?.agentMemories?.length || value.settings?.agentConversation?.length || value.settings?.agentTrash?.length;
  return Object.entries(value).some(([name, rows]) => name !== 'operationIds' && Array.isArray(rows) && rows.length) || value.settings?.cashScenarios?.length;
}
export async function importPrivate(pool, records) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [current] = await connection.execute('SELECT object_key, body FROM empire_objects WHERE object_key IN (?, ?) FOR UPDATE', ['empire/private/tasks.json', 'empire/private/finance.json']);
    if (current.some(row => nonEmpty(row.object_key, row.body))) throw Error('Il database contiene già dati personali. Importazione interrotta senza sovrascrivere.');
    for (const [key, value] of records) {
      const bytes = Buffer.from(value), etag = createHash('sha256').update(bytes).digest('hex');
      await connection.execute('INSERT INTO empire_objects (object_key, body, etag) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE body = VALUES(body), etag = VALUES(etag)', [key, bytes, etag]);
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}
async function main() {
  const [tasksPath, financePath, mediaPath] = process.argv.slice(2);
  if (!tasksPath || !financePath) throw Error('Uso: npm run import:private -- file-attivita.json file-finanze.json [cartella-immagini-private]');
  const records = migrationRecords(JSON.parse(await readFile(tasksPath, 'utf8')), JSON.parse(await readFile(financePath, 'utf8')));
  if (mediaPath) for (const name of await readdir(mediaPath)) {
    if (!/^[a-f0-9]{32}\.webp$/.test(name)) continue;
    const bytes = await readFile(path.join(mediaPath, name));
    if (bytes.length > 1024 * 1024 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') throw Error('Immagine privata non valida. Nessun dato importato.');
    records.push(['empire/media/' + name, bytes]);
  }
  const bucket = await connectMySQL(process.env);
  try { await importPrivate(bucket.pool, records); console.log('Archivio e immagini trasferiti nel database. File originali conservati. Nessuna credenziale importata.'); } finally { await bucket.pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message?.startsWith('Il database') || error.message?.startsWith('Uso:') || error.message?.includes('Nessun dato') ? error.message : 'Importazione non completata. Nessun dato confermato. Controlla file e database.'); process.exitCode = 1; });
