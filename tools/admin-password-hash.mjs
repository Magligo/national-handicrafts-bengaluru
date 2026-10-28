import bcrypt from 'bcryptjs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const bcryptHashPattern = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export async function createAdminPasswordHash(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    throw new Error('Admin password must be between 8 and 200 characters.');
  }

  const hash = await bcrypt.hash(password, 12);
  if (hash.length !== 60 || !bcryptHashPattern.test(hash)) {
    throw new Error('bcrypt returned a hash with an unsupported format.');
  }
  if (!(await bcrypt.compare(password, hash))) {
    throw new Error('The generated bcrypt hash did not verify.');
  }

  return hash;
}

async function main() {
  const password = process.env.NH_ADMIN_PASSWORD;
  if (!password) throw new Error('Run this tool through generate-admin-password-hash.ps1.');

  const hash = await createAdminPasswordHash(password);
  const clipboard = spawnSync('clip.exe', [], { input: hash, encoding: 'utf8', windowsHide: true });
  if (clipboard.error || clipboard.status !== 0) {
    throw new Error('Could not copy the verified hash to the Windows clipboard.');
  }
  console.log('Verified bcrypt hash copied to clipboard. No password or hash was displayed or written to .env.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    delete process.env.NH_ADMIN_PASSWORD;
  }
}
