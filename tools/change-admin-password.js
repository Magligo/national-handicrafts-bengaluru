import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import bcrypt from 'bcryptjs';
import { PostgresRepository } from '../server/repository.js';
import { adminPasswordChangeInput } from '../server/validation.js';

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
  const currentPassword = await readSecret('Current password: ');
  const newPassword = await readSecret('New password: ');
  const confirmPassword = await readSecret('Confirm new password: ');
  if (newPassword !== confirmPassword) throw new Error('New password confirmation does not match.');
  const inputValue = adminPasswordChangeInput({ currentPassword, newPassword });
  repo = new PostgresRepository(process.env.DATABASE_URL);
  const admin = await repo.findAdmin(email);
  if (!admin || admin.role !== 'admin' || !(await bcrypt.compare(inputValue.currentPassword, admin.password_hash))) throw new Error('The existing administrator credentials could not be verified.');
  const updated = await repo.updateAdminPassword(admin.id, await bcrypt.hash(inputValue.newPassword, 12));
  if (!updated) throw new Error('The administrator account could not be updated.');
  output.write('Administrator password changed. Existing administrator sessions have been invalidated.\n');
} catch (error) {
  terminal.close();
  output.write(`Password change failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await repo?.close();
}
