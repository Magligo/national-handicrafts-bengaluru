import readline from 'node:readline/promises';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { PostgresRepository } from '../server/repository.js';
import { adminAuthenticationSource } from '../server/auth.js';
import { adminPasswordChangeInput } from '../server/validation.js';

// Keep this standalone utility aligned with server/index.js: the documented
// command must use the project's local configuration without requiring callers
// to expose it in their shell environment. Existing shell/deployment variables
// still take precedence.
try {
  process.loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

function readSecret(prompt) {
  if (!input.isTTY) throw new Error('This command requires an interactive terminal so passwords are never supplied through command-line arguments or standard input.');
  return new Promise((resolve, reject) => {
    let value = '';
    let onData;
    const finish = () => { input.off('data', onData); input.setRawMode(false); input.pause(); output.write('\n'); };
    onData = (chunk) => {
      const key = chunk.toString('utf8');
      if (key === '\u0003') { finish(); reject(new Error('Cancelled')); return; }
      if (key === '\r' || key === '\n') { finish(); resolve(value); return; }
      if (key === '\u007f' || key === '\b') { value = value.slice(0, -1); return; }
      if (!key.includes('\u001b')) value += key;
    };
    output.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

if (!process.argv.includes('--execute')) throw new Error('Refusing to run without --execute.');
if (!process.env.DATABASE_URL || process.env.USE_IN_MEMORY_DB === 'true') throw new Error('DATABASE_URL must reference the production PostgreSQL database; in-memory mode is not supported.');

const terminal = readline.createInterface({ input, output });
let repo;
try {
  const email = (await terminal.question('Existing admin email: ')).trim().toLowerCase();
  terminal.close();
  repo = new PostgresRepository(process.env.DATABASE_URL);
  const source = await adminAuthenticationSource(email, repo);
  if (source.type === 'environment') throw new Error('This administrator is authenticated from ADMIN_EMAIL and ADMIN_PASSWORD_HASH, not the admin_users table. No password was changed. Update ADMIN_PASSWORD_HASH in Render environment settings with a newly generated bcrypt hash, then redeploy.');
  if (source.type !== 'database' || source.user.role !== 'admin') throw new Error('No database-backed administrator account was found for that email. No password was changed.');
  const currentPassword = await readSecret('Current password: ');
  const newPassword = await readSecret('New password: ');
  const confirmPassword = await readSecret('Confirm new password: ');
  if (newPassword !== confirmPassword) throw new Error('New password confirmation does not match.');
  const inputValue = adminPasswordChangeInput({ currentPassword, newPassword });
  if (!(await bcrypt.compare(inputValue.currentPassword, source.user.password_hash))) throw new Error('The existing administrator credentials could not be verified.');
  const updated = await repo.updateAdminPassword(source.user.id, await bcrypt.hash(inputValue.newPassword, 12));
  if (!updated) throw new Error('The administrator account could not be updated.');
  output.write('Administrator password changed. Existing administrator sessions have been invalidated.\n');
} catch (error) {
  terminal.close();
  output.write(`Password change failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await repo?.close();
}
