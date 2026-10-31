import path from 'node:path';
import { fileURLToPath } from 'node:url';

const startupStartedAt = process.hrtime.bigint();
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(projectRoot, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const { createApp } = await import('./app.js');
const { serverConfig } = await import('./config/env.js');
const { runMigrations } = await import('./db/migrate.js');

if (process.env.USE_IN_MEMORY_DB !== 'true') {
  try {
    const migrationStartedAt = process.hrtime.bigint();
    await runMigrations();
    console.info('[startup] Database migrations ready', { durationMs: Number(process.hrtime.bigint() - migrationStartedAt) / 1e6 });
  } catch (error) {
    console.error('Database initialization failed', { code: error.code || 'database_error', name: error.name || 'Error' });
    process.exit(1);
  }
}

const { app } = createApp();
app.listen(serverConfig.port, serverConfig.host, () => console.log('National Handicrafts API listening', { port: serverConfig.port, startupDurationMs: Number(process.hrtime.bigint() - startupStartedAt) / 1e6 }));
