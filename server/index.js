import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    await runMigrations();
  } catch (error) {
    console.error(`Database initialization failed: ${error.message}`);
    process.exit(1);
  }
}

const { app } = createApp();
app.listen(serverConfig.port, serverConfig.host, () => console.log(`National Handicrafts API listening on port ${serverConfig.port}`));
