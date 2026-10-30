import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');

function safeDbError(error) {
  return { code: error?.code || 'unknown', message: String(error?.message || '').split(' at ')[0] };
}

export async function runMigrations(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required to initialize PostgreSQL.');
  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  const client = await pool.connect();
  try {
    const encoding = await client.query('SHOW server_encoding');
    assertUtf8DatabaseEncoding(encoding.rows[0]?.server_encoding);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const files = ['schema.sql', ...(await fs.readdir(path.join(serverRoot, 'migrations'))).filter((file) => file.endsWith('.sql')).sort()];
    for (const file of files) {
      const id = file;
      const alreadyApplied = await client.query('SELECT 1 FROM schema_migrations WHERE id = $1', [id]);
      if (alreadyApplied.rowCount) continue;
      const sql = await fs.readFile(path.join(file === 'schema.sql' ? serverRoot : path.join(serverRoot, 'migrations'), file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [id]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        const safe = safeDbError(error);
        throw new Error(`Database migration ${id} failed (${safe.code}): ${safe.message}`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

export function assertUtf8DatabaseEncoding(encoding) {
  if (String(encoding || '').toUpperCase() !== 'UTF8') {
    throw new Error(`PostgreSQL server encoding must be UTF8 (received ${encoding || 'unknown'}).`);
  }
}
