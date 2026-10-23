import { createApp } from './app.js';
import { serverConfig } from './config/env.js';

if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required in production.');
}

const { app } = createApp();
app.listen(serverConfig.port, () => console.log(`National Handicrafts API listening on http://localhost:${serverConfig.port}`));
