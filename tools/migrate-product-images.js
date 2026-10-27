import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(projectRoot, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const { PostgresRepository } = await import('../server/repository.js');
const { cloudinaryConfigured, uploadProductImage } = await import('../server/storage/cloudinary.js');

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for image migration.');
if (!cloudinaryConfigured()) throw new Error('Cloudinary image storage is not configured.');

const repository = new PostgresRepository();
const localPath = (value) => path.join(projectRoot, 'public', String(value).replace(/^\/+/, ''));
const asPaths = (value) => Array.isArray(value) ? value : typeof value === 'string' ? JSON.parse(value || '[]') : [];

try {
  const result = await repository.query("SELECT id, image_path, image_paths FROM products WHERE image_path LIKE '/uploads/%' OR image_paths::text LIKE '%/uploads/%'");
  let migrated = 0;
  let missing = 0;

  for (const product of result.rows) {
    const paths = [...new Set([product.image_path, ...asPaths(product.image_paths)].filter(Boolean))];
    const migratedPaths = [];
    let changed = false;

    for (const imagePath of paths) {
      if (!String(imagePath).startsWith('/uploads/')) {
        migratedPaths.push(imagePath);
        continue;
      }

      try {
        const buffer = await fs.readFile(localPath(imagePath));
        const uploaded = await uploadProductImage({ buffer, originalname: path.basename(imagePath), mimetype: 'image/png' });
        migratedPaths.push(uploaded.url);
        changed = true;
      } catch (error) {
        if (error.code === 'ENOENT') missing += 1;
        else throw error;
        migratedPaths.push(imagePath);
      }
    }

    if (changed) {
      const mainIndex = paths.indexOf(product.image_path);
      await repository.updateProduct(product.id, {
        image_paths: migratedPaths,
        image_path: migratedPaths[mainIndex >= 0 ? mainIndex : 0] || null,
      });
      migrated += 1;
    }
  }

  console.log(`Image migration complete: ${migrated} product records updated; ${missing} unavailable local files left unchanged.`);
} finally {
  await repository.close();
}
