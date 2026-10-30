import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertUtf8DatabaseEncoding } from './db/migrate.js';

test('database startup accepts UTF8 and rejects incompatible encodings', () => {
  assert.doesNotThrow(() => assertUtf8DatabaseEncoding('UTF8'));
  assert.throws(() => assertUtf8DatabaseEncoding('SQL_ASCII'), /must be UTF8/);
  assert.throws(() => assertUtf8DatabaseEncoding(undefined), /must be UTF8/);
});

test('PostgreSQL temporary text storage round-trips Indian Unicode and punctuation', { skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to run the PostgreSQL UTF-8 round-trip integration check.' }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    const encoding = await client.query('SHOW server_encoding');
    assertUtf8DatabaseEncoding(encoding.rows[0]?.server_encoding);
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE nh_utf8_roundtrip (value TEXT) ON COMMIT DROP');
    const sample = 'ಬೆಂಗಳೂರು • पीतल · Brass — திருவிழா';
    await client.query('INSERT INTO nh_utf8_roundtrip (value) VALUES ($1)', [sample]);
    const result = await client.query('SELECT value FROM nh_utf8_roundtrip');
    assert.equal(result.rows[0].value, sample);
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); await pool.end(); }
  }
});
