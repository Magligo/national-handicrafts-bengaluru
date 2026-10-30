import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from './app.js';
import { MemoryRepository } from './repository.js';

test('password reset is generic, hashed, single-use, expires, and invalidates customer sessions', async () => {
  const oldHash = await bcrypt.hash('customer-password', 10);
  const repo = new MemoryRepository({ customers: [{ id: 'c1', email: 'asha@example.com', name: 'Asha', password_hash: oldHash }] });
  let sentUrl = '';
  const { app } = createApp({ repo, secret: 'recovery-test-secret', passwordResetMailer: async ({ resetUrl }) => { sentUrl = resetUrl; } });
  const known = await request(app).post('/api/customer/auth/password/forgot').send({ email: 'asha@example.com' });
  const unknown = await request(app).post('/api/customer/auth/password/forgot').send({ email: 'missing@example.com' });
  assert.equal(known.status, 202);
  assert.equal(known.body.message, unknown.body.message);
  const token = new URL(sentUrl).searchParams.get('token');
  assert.ok(token);
  assert.notEqual(repo.customers[0].password_reset_token_hash, token);
  const login = await request(app).post('/api/customer/auth/login').send({ email: 'asha@example.com', password: 'customer-password' });
  const reset = await request(app).post('/api/customer/auth/password/reset').send({ token, password: 'new-password' });
  assert.equal(reset.status, 200);
  assert.equal((await request(app).get('/api/customer/auth/me').set('Cookie', login.headers['set-cookie'])).status, 401);
  assert.equal((await request(app).post('/api/customer/auth/password/reset').send({ token, password: 'another-password' })).status, 400);
  assert.equal((await request(app).post('/api/customer/auth/login').send({ email: 'asha@example.com', password: 'new-password' })).status, 200);
  assert.equal((await request(app).post('/api/customer/auth/login').send({ email: 'asha@example.com', password: 'customer-password' })).status, 401);
});

test('password recovery rejects invalid and expired reset tokens and validates passwords', async () => {
  const repo = new MemoryRepository({ customers: [{ id: 'c1', email: 'asha@example.com', name: 'Asha', password_hash: await bcrypt.hash('customer-password', 10), password_reset_token_hash: 'expired-hash', password_reset_expires_at: new Date(Date.now() - 1000).toISOString() }] });
  const { app } = createApp({ repo, secret: 'recovery-test-secret' });
  assert.equal((await request(app).post('/api/customer/auth/password/reset').send({ token: 'not-a-token', password: 'new-password' })).status, 400);
  const { createHash } = await import('node:crypto');
  const expiredToken = 'expired-token-012345678901234567890123456789012345678901';
  repo.customers[0].password_reset_token_hash = createHash('sha256').update(expiredToken).digest('hex');
  assert.equal((await request(app).post('/api/customer/auth/password/reset').send({ token: expiredToken, password: 'new-password' })).status, 400);
  assert.equal((await request(app).post('/api/customer/auth/password/reset').send({ token: expiredToken, password: 'short' })).status, 400);
});

test('password reset requests and token attempts consume rate limits', async () => {
  const { app } = createApp({ repo: new MemoryRepository(), secret: 'recovery-test-secret' });
  for (let i = 0; i < 5; i++) assert.equal((await request(app).post('/api/customer/auth/password/forgot').send({ email: `unknown${i}@example.com` })).status, 202);
  assert.equal((await request(app).post('/api/customer/auth/password/forgot').send({ email: 'unknown@example.com' })).status, 429);
  const tokenApp = createApp({ repo: new MemoryRepository(), secret: 'recovery-test-secret' }).app;
  for (let i = 0; i < 10; i++) assert.equal((await request(tokenApp).post('/api/customer/auth/password/reset').send({ token: 'invalid-token' })).status, 400);
  assert.equal((await request(tokenApp).post('/api/customer/auth/password/reset').send({ token: 'invalid-token' })).status, 429);
});
