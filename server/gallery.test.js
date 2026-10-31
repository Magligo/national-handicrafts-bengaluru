import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from './app.js';
import { MemoryRepository } from './repository.js';

async function setup({ galleryImageUploader, galleryImageDeleter } = {}) {
  const repo = new MemoryRepository({ adminUsers: [{ id: 'gallery-admin', email: 'admin@test.local', password_hash: await bcrypt.hash('correct horse battery staple', 10), role: 'admin' }] });
  const deleted = [];
  const { app } = createApp({ repo, secret: 'gallery-test-secret', galleryImageUploader: galleryImageUploader || (async (file) => ({ url: `https://media.test/${file.originalname}`, publicId: `gallery/${file.originalname}` })), galleryImageDeleter: galleryImageDeleter || (async (publicId) => { deleted.push(publicId); }) });
  const login = await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'correct horse battery staple' });
  const cookie = login.headers['set-cookie'];
  const csrf = await request(app).get('/api/auth/csrf').set('Cookie', cookie);
  return { app, repo, deleted, auth: { cookie, token: csrf.body.data.token } };
}

const admin = (app, auth, method, path) => request(app)[method](path).set('Cookie', auth.cookie).set('X-CSRF-Token', auth.token);
const imageBytes = (type = 'image/png') => type === 'image/png'
  ? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  : type === 'image/webp' ? Buffer.from('RIFF0000WEBP') : Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);

test('gallery endpoints require admin auth and expose only published records publicly', async () => {
  const { app, auth, deleted } = await setup();
  assert.equal((await request(app).get('/api/admin/gallery')).status, 401);
  const deniedMutation = await request(app).post('/api/admin/gallery').attach('images', Buffer.from('image'), { filename: 'hidden.png', contentType: 'image/png' });
  assert.equal(deniedMutation.status, 401);
  const upload = await admin(app, auth, 'post', '/api/admin/gallery')
    .field('titles', JSON.stringify(['Temple bells', 'Hand-carved detail']))
    .field('description', 'Made by hand in Bengaluru.')
    .field('category', 'Craft')
    .attach('images', imageBytes('image/webp'), { filename: 'bells.webp', contentType: 'image/webp' })
    .attach('images', imageBytes('image/png'), { filename: 'carving.png', contentType: 'image/png' });
  assert.equal(upload.status, 201);
  assert.deepEqual(upload.body.data.map((image) => image.title), ['Temple bells', 'Hand-carved detail']);
  assert.deepEqual((await request(app).get('/api/gallery')).body.data, []);
  const publicWithoutAuth = await request(app).get('/api/admin/gallery');
  assert.equal(publicWithoutAuth.status, 401);
  const listed = await admin(app, auth, 'get', '/api/admin/gallery');
  assert.equal(listed.body.data.length, 2);
  const publish = await admin(app, auth, 'patch', `/api/admin/gallery/${listed.body.data[0].id}`).send({ published: true, title: 'Temple bells in brass', orderIndex: 2 });
  assert.equal(publish.status, 200);
  const publicList = await request(app).get('/api/gallery');
  assert.deepEqual(publicList.body.data.map((image) => image.title), ['Temple bells in brass']);
  assert.equal('storage_public_id' in publicList.body.data[0], false);
  assert.equal((await admin(app, auth, 'patch', `/api/admin/gallery/${listed.body.data[1].id}`).send({ published: true })).status, 200);
  assert.equal((await request(app).get('/api/gallery')).body.data.length, 2);
  assert.equal((await admin(app, auth, 'delete', `/api/admin/gallery/${listed.body.data[1].id}`)).status, 204);
  assert.deepEqual((await admin(app, auth, 'get', '/api/admin/gallery')).body.data.map((image) => image.title), ['Temple bells in brass']);
  assert.deepEqual(deleted, ['gallery/carving.png']);
});

test('gallery rejects missing files, invalid mime types, malformed titles and invalid updates', async () => {
  const { app, auth } = await setup();
  assert.equal((await admin(app, auth, 'post', '/api/admin/gallery')).status, 400);
  const invalidFile = await admin(app, auth, 'post', '/api/admin/gallery').attach('images', Buffer.from('not image'), { filename: 'script.svg', contentType: 'image/svg+xml' });
  assert.equal(invalidFile.status, 400);
  const invalidTitles = await admin(app, auth, 'post', '/api/admin/gallery').field('titles', 'not-json').attach('images', imageBytes(), { filename: 'image.png', contentType: 'image/png' });
  assert.equal(invalidTitles.status, 400);
  const spoofedImage = await admin(app, auth, 'post', '/api/admin/gallery').attach('images', Buffer.from('not a png file'), { filename: 'image.png', contentType: 'image/png' });
  assert.equal(spoofedImage.status, 400);
  const upload = await admin(app, auth, 'post', '/api/admin/gallery').attach('images', imageBytes(), { filename: 'image.png', contentType: 'image/png' });
  assert.equal(upload.status, 201);
  const badTitle = await admin(app, auth, 'patch', `/api/admin/gallery/${upload.body.data[0].id}`).send({ title: '' });
  assert.equal(badTitle.status, 400);
  const badOrder = await admin(app, auth, 'patch', `/api/admin/gallery/${upload.body.data[0].id}`).send({ orderIndex: -1 });
  assert.equal(badOrder.status, 400);
});

test('gallery upload failure cleans up earlier Cloudinary uploads and creates no partial gallery records', async () => {
  let calls = 0;
  const { app, auth, repo, deleted } = await setup({ galleryImageUploader: async (file) => {
    calls += 1;
    if (calls === 2) { const error = new Error('Cloudinary could not store the gallery image.'); error.status = 502; throw error; }
    return { url: `https://media.test/${file.originalname}`, publicId: `gallery/${file.originalname}` };
  } });
  const response = await admin(app, auth, 'post', '/api/admin/gallery')
    .field('titles', JSON.stringify(['First', 'Second']))
    .attach('images', imageBytes(), { filename: 'first.png', contentType: 'image/png' })
    .attach('images', imageBytes('image/webp'), { filename: 'second.webp', contentType: 'image/webp' });
  assert.equal(response.status, 502);
  assert.match(response.body.error, /Cloudinary could not store/);
  assert.equal(repo.galleryImages.length, 0);
  assert.deepEqual(deleted, ['gallery/first.png']);
});
