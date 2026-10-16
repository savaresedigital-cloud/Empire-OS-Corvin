import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';

/** Preserve the existing archive API and its compare-and-swap writes on MySQL. */
export class MySQLBucket {
  constructor(pool) { this.pool = pool; }
  async init() {
    await this.pool.execute('CREATE TABLE IF NOT EXISTS empire_objects (object_key VARCHAR(512) COLLATE utf8mb4_bin PRIMARY KEY, body LONGBLOB NOT NULL, etag CHAR(64) NOT NULL, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
  }
  async head(key) {
    const [rows] = await this.pool.execute('SELECT etag FROM empire_objects WHERE object_key = ?', [key]);
    return rows.length ? { etag: rows[0].etag, httpEtag: '"' + rows[0].etag + '"' } : null;
  }
  async get(key) {
    const [rows] = await this.pool.execute('SELECT body, etag FROM empire_objects WHERE object_key = ?', [key]);
    if (!rows.length) return null;
    const bytes = Buffer.from(rows[0].body), etag = rows[0].etag;
    return { etag, httpEtag: '"' + etag + '"', body: new Blob([bytes]).stream(), json: async () => JSON.parse(bytes.toString('utf8')) };
  }
  async put(key, value, options = {}) {
    const bytes = Buffer.from(await new Response(value).arrayBuffer()), etag = createHash('sha256').update(bytes).digest('hex');
    const result = { etag, httpEtag: '"' + etag + '"' }, condition = options.onlyIf;
    if (!condition) {
      await this.pool.execute('INSERT INTO empire_objects (object_key, body, etag) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE body = VALUES(body), etag = VALUES(etag)', [key, bytes, etag]);
      return result;
    }
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute('SELECT etag FROM empire_objects WHERE object_key = ? FOR UPDATE', [key]);
      const current = rows.length ? '"' + rows[0].etag + '"' : null;
      if (condition.get('If-Match') && condition.get('If-Match') !== current || condition.get('If-None-Match') === '*' && current) { await connection.rollback(); return null; }
      if (current) await connection.execute('UPDATE empire_objects SET body = ?, etag = ? WHERE object_key = ?', [bytes, etag, key]);
      else await connection.execute('INSERT INTO empire_objects (object_key, body, etag) VALUES (?, ?, ?)', [key, bytes, etag]);
      await connection.commit(); return result;
    } catch (error) {
      await connection.rollback();
      if (['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) return null;
      throw error;
    } finally { connection.release(); }
  }
}
export async function connectMySQL(env) {
  if (!env.DB_HOST || !env.DB_USER || !env.DB_PASSWORD || !env.DB_NAME) throw Error('Configura DB_HOST, DB_USER, DB_PASSWORD e DB_NAME nel pannello hosting.');
  const pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, waitForConnections: true, connectionLimit: 5, maxIdle: 3, connectTimeout: 10000, ...(env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {}) });
  const bucket = new MySQLBucket(pool);
  try { await bucket.init(); return bucket; } catch { await pool.end(); throw Error('Database MySQL non raggiungibile. Controlla connessione e autorizzazioni nel pannello hosting.'); }
}
